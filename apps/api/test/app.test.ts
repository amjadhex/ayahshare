import { expect, it, vi } from "vitest";
import { ipKey } from "../src/lib/http";
import { call, embeddings, makeEnv, send } from "./helpers";

it("GET /api/health", async () => {
  expect(await (await call("/api/health")).json()).toEqual({ ok: true, app: "AyahShare" });
});

it("GET / is the landing page; an old share link (/?r=) opens the app", async () => {
  const e = makeEnv();
  await call("/", {}, e);
  await call("/?r=abc", {}, e);
  const asked = vi.mocked(e.ASSETS.fetch).mock.calls.map(([r]) => new URL((r as Request).url).pathname);
  expect(asked).toEqual(["/landing", "/app"]);
});

it("GET /api/config: no Google client id → null", async () => {
  const none = { ...makeEnv(), GOOGLE_CLIENT_ID: "" } as Env; // independent of the id configured in wrangler.jsonc
  expect(await (await call("/api/config", {}, none)).json()).toEqual({ appName: "AyahShare", googleClientId: null, emailSignIn: false, mediaBase: "/media/",
    off: { tafsirs: [], reciters: [], voices: [] } });
  const e = { ...makeEnv(), GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com" } as Env;
  expect((await (await call("/api/config", {}, e)).json<any>()).googleClientId).toBe("abc.apps.googleusercontent.com");
  const old = { ...makeEnv(), MIN_APP_VERSION_ANDROID: "1.0.3" } as Env;
  expect((await (await call("/api/config", {}, old)).json<any>()).minAppVersion).toEqual({ android: "1.0.3" });
});

it("ingest still requires the admin token and embeds texts and images to 384-d unit vectors", async () => {
  expect((await call("/admin/api/ingest/embed", { method: "POST", body: "{}" })).status).toBe(401);
  const res = await call("/admin/api/ingest/embed", {
    method: "POST",
    headers: { Authorization: "Bearer test-admin", "Content-Type": "application/json" },
    body: JSON.stringify({ texts: ["a", "b"], kind: "document" }),
  });
  const { vectors } = await res.json<{ vectors: number[][] }>();
  expect(vectors).toHaveLength(2);
  expect(vectors[0]).toHaveLength(384);
  expect(Math.hypot(...vectors[0])).toBeCloseTo(1);
  expect(embeddings.mock.calls[0][0].input).toEqual(["title: none | text: a", "title: none | text: b"]);

  const admin = { Authorization: "Bearer test-admin", "Content-Type": "application/json" };
  const image = "data:image/jpeg;base64,AAAA";
  const img = await call("/admin/api/ingest/embed", { method: "POST", headers: admin, body: JSON.stringify({ images: [image] }) });
  expect((await img.json<any>()).vectors[0]).toHaveLength(384);
  expect(embeddings.mock.calls[1][0].input).toEqual([{ content: [{ type: "image_url", image_url: { url: image } }] }]);
  const bad = await call("/admin/api/ingest/embed", { method: "POST", headers: admin, body: JSON.stringify({ texts: ["a"], kind: "other" }) });
  expect(bad.status).toBe(400);
});

it("search is rate limited per IP; unknown API paths are JSON 404s", async () => {
  const limited = { ...makeEnv(), SEARCH_LIMITER: { limit: async () => ({ success: false }) } } as unknown as Env;
  const res = await call("/api/search?q=2:255", {}, limited);
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("60");
  const missing = await call("/api/nope");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });
});

it("rate limits key IPv4 by address and IPv6 by its /64", async () => {
  expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
  expect(ipKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
  expect(ipKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
  expect(ipKey("2001:0DB8:0001:0002::abcd")).toBe("2001:db8:1:2::/64");
  expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  expect(ipKey("::1")).toBe("0:0:0:0::/64");

  // A new address from the same /64 on every request still hits the one limit (per-isolate counter: 60 a minute).
  const unbound = { ...makeEnv(), EVENTS_LIMITER: undefined } as unknown as Env;
  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) {
    const ip = `2001:db8:77:1:${(i + 1).toString(16)}::${Math.floor(Math.random() * 0xffff).toString(16)}`;
    statuses.push((await send("POST", "/api/events", { events: [] }, { env: unbound, headers: { "CF-Connecting-IP": ip } })).status);
  }
  expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
  expect(statuses[60]).toBe(429);
  expect((await send("POST", "/api/events", { events: [] }, { env: unbound, headers: { "CF-Connecting-IP": "2001:db8:77:2::1" } })).status).toBe(200);
});

it("request size limits on writes", async () => {
  const big = "x".repeat(401 * 1024);
  const res = await call("/api/shares", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ og: big }) });
  expect(res.status).toBe(413);
  const report = await call("/api/reports", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ kind: "other", note: "x".repeat(17 * 1024) }) });
  expect(report.status).toBe(413);
});

it("ingest: PUT media → R2, POST vectors → the named index", async () => {
  const { env } = await import("cloudflare:test");
  const auth = { Authorization: "Bearer test-admin" };
  const put = await call("/admin/api/ingest/media/thumbs/test.webp", { method: "PUT", headers: { ...auth, "Content-Type": "image/webp" }, body: "webp-bytes" });
  expect(await put.json()).toEqual({ key: "thumbs/test.webp" });
  const obj = await env.MEDIA.get("thumbs/test.webp");
  expect(obj?.httpMetadata?.contentType).toBe("image/webp");
  expect(await obj!.text()).toBe("webp-bytes");

  const upsert = vi.fn(async (v: unknown[]) => ({ mutationId: "m1", count: v.length }));
  const e = { ...makeEnv(), AYAHS_INDEX: { upsert }, CLIPS_INDEX: { upsert: vi.fn() } } as unknown as Env;
  const vectors = [{ id: "2:255", values: [0.1, 0.2], metadata: { ref: "2:255" } }];
  const res = await call("/admin/api/ingest/vectors/ayahs", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ vectors }) }, e);
  expect(await res.json()).toEqual({ mutationId: "m1", count: 1 });
  expect(upsert).toHaveBeenCalledWith(vectors);
});
