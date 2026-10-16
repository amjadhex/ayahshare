// GET /api/stats/ayahs (anonymous counts per ayah), GET /api/stats/me (the person's private impact) and what feeds them:
// share links with their first ayah and device, opens per day, POST /api/shares/:code/reuse.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { BROKEN_DB, RECIPE, call, makeEnv, send } from "./helpers";
import { signIn } from "./google";

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
const json = async (path: string, init?: RequestInit) => (await call(path, init)).json<any>();
const link = async (recipe: object, opts: Parameters<typeof send>[3] = {}, anon?: string) =>
  (await (await send("POST", "/api/shares", { recipe, ...(anon ? { anon } : {}) }, opts)).json<any>()).code as string;

describe("GET /api/stats/ayahs", () => {
  it("validates refs: required, at most 60, each surah:ayah", async () => {
    expect((await call("/api/stats/ayahs")).status).toBe(400);
    expect((await call("/api/stats/ayahs?refs=,")).status).toBe(400);
    const bad = await call("/api/stats/ayahs?refs=2:153,115:1");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid ref", ref: "115:1" });
    expect((await call("/api/stats/ayahs?refs=2:153,<script>")).status).toBe(400);
    const many = Array.from({ length: 61 }, (_, i) => `2:${i + 1}`).join(",");
    expect((await call(`/api/stats/ayahs?refs=${many}`)).status).toBe(400);
    expect((await call(`/api/stats/ayahs?refs=${many.split(",").slice(0, 60).join(",")}`)).status).toBe(200);
  });

  it("counts favourites, exports + links (all time and this week) and changed designs, in the order asked, without names", async () => {
    const stat = env.DB.prepare("INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, 'export_ref', ?, ?)");
    await env.DB.batch([
      stat.bind(day(0), "93:5", 3), stat.bind(day(6), "93:5", 2), stat.bind(day(7), "93:5", 10), // 10 is older than a week
      stat.bind(day(1), "93:3", 1),
    ]);
    const a = await link({ ...RECIPE, surah: 93, from: 5, to: 6 });
    await link({ ...RECIPE, surah: 93, from: 5, to: 5 });
    await env.DB.prepare("UPDATE shares SET created_at = ? WHERE code = ?").bind(Date.now() - 10 * 86400_000, a).run(); // an old link
    for (const sub of ["st-a", "st-b"]) {
      const { cookie } = await signIn(sub);
      expect((await send("PUT", "/api/favourites/93:5", undefined, { cookie })).status).toBeLessThan(300);
    }
    // Someone opened link a, changed the design and exported it twice; another exported it unchanged.
    for (const kind of ["make", "make", "share"]) expect((await send("POST", `/api/shares/${a}/reuse`, { kind })).status).toBe(204);

    const res = await call("/api/stats/ayahs?refs=93:3,93:5,93:7,93:5");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({ stats: [
      { ref: "93:3", likes: 0, shares: 1, makes: 0, week: 1 },
      { ref: "93:5", likes: 2, shares: 3 + 2 + 10 + 2, makes: 2, week: 3 + 2 + 1 },
      { ref: "93:7", likes: 0, shares: 0, makes: 0, week: 0 },
    ] });

    // The same set in another order comes from this colo's cache.
    const e = makeEnv();
    const prepare = vi.spyOn(e.DB, "prepare");
    const again = await (await call("/api/stats/ayahs?refs=93:7,93:5,93:3", {}, e)).json<any>();
    expect(again.stats.map((s: { ref: string }) => s.ref)).toEqual(["93:7", "93:5", "93:3"]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("answers 503 (not zeros) while D1 fails", async () => {
    const res = await call("/api/stats/ayahs?refs=80:1", {}, { ...makeEnv(), DB: BROKEN_DB } as Env);
    expect(res.status).toBe(503);
  });
});

describe("share links feed the counts", () => {
  it("POST /api/shares keeps the first ayah, and the device id only for a link made signed out", async () => {
    const out = await link({ ...RECIPE, surah: 2, from: 255, to: 256 }, {}, "dev-out");
    const { cookie } = await signIn("st-link");
    const inside = await link(RECIPE, { cookie }, "dev-in");
    const bad = await link(RECIPE, {}, "not valid!");
    const row = (code: string) => env.DB.prepare("SELECT ref, anon_id, user_id IS NOT NULL AS signed FROM shares WHERE code = ?").bind(code).first<any>();
    expect(await row(out)).toEqual({ ref: "2:255", anon_id: "dev-out", signed: 0 });
    expect(await row(inside)).toEqual({ ref: "94:5", anon_id: null, signed: 1 });
    expect((await row(bad)).anon_id).toBeNull();
  });

  it("each open counts for today; reuse takes share or make for a known link only", async () => {
    const code = await link(RECIPE);
    await call(`/api/shares/${code}`);
    await call(`/api/shares/${code}`);
    expect((await send("POST", `/api/shares/${code}/reuse`, { kind: "share" })).status).toBe(204);
    expect((await send("POST", `/api/shares/${code}/reuse`, { kind: "copy" })).status).toBe(400);
    expect((await send("POST", "/api/shares/nope1234/reuse", { kind: "make" })).status).toBe(404);
    // Writes need this origin (or the apps), like every write.
    expect((await call(`/api/shares/${code}/reuse`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: '{"kind":"make"}' })).status).toBe(403);
    expect(await env.DB.prepare("SELECT day, opens, reshares, makes FROM share_daily WHERE code = ?").bind(code).first()).toEqual({ day: day(0), opens: 2, reshares: 1, makes: 0 });
  });
});

describe("GET /api/stats/me", () => {
  it("signed out: this device's links over the last 7 days; another device sees nothing; no id → 400", async () => {
    const mine = await link(RECIPE, {}, "dev-impact");
    await link(RECIPE, {}, "dev-other");
    await call(`/api/shares/${mine}`);
    await send("POST", `/api/shares/${mine}/reuse`, { kind: "make" });
    await env.DB.prepare("INSERT INTO share_daily (code, day, opens, reshares, makes) VALUES (?, ?, 50, 5, 5)").bind(mine, day(7)).run(); // too old
    await env.DB.prepare("INSERT INTO share_daily (code, day, opens, reshares, makes) VALUES (?, ?, 4, 2, 0)").bind(mine, day(6)).run();

    const res = await call("/api/stats/me", { headers: { "X-Anon": "dev-impact" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json<any>();
    expect(body).toMatchObject({ days: 7, opens: 5, reshares: 2, makes: 1 });
    // Notifications: the link used (its ayah and clip, the week's counts) and all days (the old row included).
    expect(body.links).toEqual([{ code: mine, ref: "94:5", to: 6, clip: "pb1", opens: 5, reshares: 2, makes: 1 }]);
    expect(body.total).toEqual({ opens: 55, reshares: 7, makes: 6 });
    expect(await json("/api/stats/me", { headers: { "X-Anon": "dev-nobody" } }))
      .toEqual({ days: 7, opens: 0, reshares: 0, makes: 0, links: [], total: { opens: 0, reshares: 0, makes: 0 } });
    expect((await call("/api/stats/me")).status).toBe(400);
    expect((await call("/api/stats/me", { headers: { "X-Anon": "bad id!" } })).status).toBe(400);
  });

  it("signed in: the account's links and those made on its devices before sign-in", async () => {
    const before = await link(RECIPE, {}, "dev-before");
    const { cookie } = await signIn("st-me");
    // The sign-in links the device (the app sends its anon id with the credential).
    const user = await env.DB.prepare("SELECT id FROM users WHERE google_sub = 'st-me'").first<{ id: string }>("id");
    await env.DB.prepare("INSERT INTO devices (anon_id, user_id, first_seen, last_seen) VALUES ('dev-before', ?, 1, 1)").bind(user).run();
    const after = await link(RECIPE, { cookie });
    await call(`/api/shares/${before}`);
    await call(`/api/shares/${after}`);
    await call(`/api/shares/${after}`);
    expect(await json("/api/stats/me", { headers: { Cookie: cookie } })).toMatchObject({ days: 7, opens: 3, reshares: 0, makes: 0 });
    expect(await json("/api/stats/me", { headers: { "X-Anon": "dev-st-nobody" } })).toMatchObject({ opens: 0 });
  });

  it("answers 503 while D1 fails", async () => {
    expect((await call("/api/stats/me", { headers: { "X-Anon": "dev-x" } }, { ...makeEnv(), DB: BROKEN_DB } as Env)).status).toBe(503);
  });
});
