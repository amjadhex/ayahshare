import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sha256 } from "../src/lib/http";
import { utcDay } from "../src/lib/stats";
import { call, makeEnv, mockFetch, send, SESSION } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const ADMIN = { Authorization: "Bearer test-admin" };
const TEAM = "team.cloudflareaccess.com";
const AUD = "access-aud-tag";
const withAccess = () => ({ ...makeEnv(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }) as Env;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: unknown;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: "a1", alg: "RS256" }] };
  const now = Date.now();
  const db = env.DB;
  await db.batch([
    db.prepare("INSERT INTO devices (anon_id, country, platform, first_seen, last_seen, sessions) VALUES ('d1', 'IN', 'android', ?, ?, 3)").bind(now - 40 * 86400_000, now - 1000),
    db.prepare("INSERT INTO devices (anon_id, country, platform, first_seen, last_seen, sessions) VALUES ('d2', 'GB', 'ios', ?, ?, 1)").bind(now - 3 * 86400_000, now - 3 * 86400_000),
    db.prepare("INSERT INTO devices (anon_id, country, platform, first_seen, last_seen, sessions) VALUES ('d3', 'IN', 'windows', ?, ?, 1)").bind(now - 60 * 86400_000, now - 50 * 86400_000),
    db.prepare("INSERT INTO users (id, google_sub, email, name, created_at, last_login) VALUES ('u1', 'g1', 'a@example.com', 'A', ?, ?)").bind(now - 86400_000, now),
    db.prepare("UPDATE devices SET user_id = 'u1' WHERE anon_id = 'd1'"),
    db.prepare("INSERT INTO shares (code, recipe, created_at, opens) VALUES ('sh1', '{}', ?, 4)").bind(now - 1000),
    db.prepare("INSERT INTO reports (created_at, kind, clip_id, note) VALUES (?, 'background', 'pb7', 'person visible')").bind(now),
    db.prepare("INSERT INTO reports (created_at, kind, ref, status) VALUES (?, 'search', '2:255', 'done')").bind(now),
    db.prepare(`INSERT INTO clips (id, source, source_id, author, caption, tags, duration, video_key, thumb_key, poster_key, safety, quality, status, created_at)
      VALUES ('pb7', 'pixabay', '7', 'someone', 'calm sea', 'sea,calm', 9.5, '{"portrait":"clips/p/pb7.mp4","landscape":"clips/l/pb7.mp4"}', 'thumbs/pb7.webp', '{}', '{"people":0.01}', 0.9, 'active', ?)`).bind(now),
    db.prepare("INSERT INTO luna_usage (day, calls, input_tokens, cost_usd) VALUES (?, 12, 3600, 0.0024)").bind(new Date().toISOString().slice(0, 10)),
    db.prepare("INSERT INTO query_cache (q, topic, result, created_at, hits) VALUES ('patience', 'patience', '{}', ?, 5)").bind(now),
  ]);
});

describe("admin guard", () => {
  it("needs Bearer ADMIN_TOKEN or a valid Access JWT", async () => {
    expect((await call("/admin/api/whoami")).status).toBe(401);
    expect((await call("/admin/api/whoami", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    expect(await (await call("/admin/api/whoami", { headers: ADMIN })).json()).toEqual({ via: "token", email: null });
  });

  it("accepts the app's sign-in for an address on ADMIN_EMAILS only", async () => {
    const now = Date.now();
    const admin = "a".repeat(43), other = "b".repeat(43);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, google_sub, email, name, created_at, last_login) VALUES ('uadm', 'gadm', 'Owner@Example.com', 'O', ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 'uadm', ?, ?)").bind(await sha256(admin), now, now + 86400_000),
      env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 'u1', ?, ?)").bind(await sha256(other), now, now + 86400_000),
    ]);
    const e = { ...makeEnv(), ADMIN_EMAILS: "someone@else.org, owner@example.com" } as Env;
    const as = (token: string, env = e) => call("/admin/api/whoami", { headers: { Cookie: `__Host-qd_session=${token}` } }, env);
    expect(await (await as(admin)).json()).toEqual({ via: "account", email: "Owner@Example.com" });
    expect((await as(other)).status).toBe(401);
    expect((await as(admin, { ...makeEnv(), ADMIN_EMAILS: "" } as Env)).status).toBe(401);
    // Leave the seeded numbers as the other tests expect them.
    await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE user_id IN ('uadm', 'u1')"), env.DB.prepare("DELETE FROM users WHERE id = 'uadm'")]);
  });

  it("accepts a Cloudflare Access JWT for this application only", async () => {
    mockFetch((url) => (url === `https://${TEAM}/cdn-cgi/access/certs` ? Response.json(jwks) : new Response("unexpected", { status: 500 })));
    const jwt = (aud = AUD, iss = `https://${TEAM}`) => new SignJWT({ email: "owner@example.com" }).setProtectedHeader({ alg: "RS256", kid: "a1" })
      .setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("10m").sign(keys.privateKey);
    const e = withAccess();
    const ok = await call("/admin/api/whoami", { headers: { "Cf-Access-Jwt-Assertion": await jwt() } }, e);
    expect(await ok.json()).toEqual({ via: "access", email: "owner@example.com" });
    expect((await call("/admin/api/whoami", { headers: { "Cf-Access-Jwt-Assertion": await jwt("other-app") } }, e)).status).toBe(401);
    expect((await call("/admin/api/whoami", { headers: { "Cf-Access-Jwt-Assertion": await jwt(AUD, "https://evil.example") } }, e)).status).toBe(401);
    // Not configured → Access tokens are not accepted at all.
    expect((await call("/admin/api/whoami", { headers: { "Cf-Access-Jwt-Assertion": await jwt() } })).status).toBe(401);
    // Writes through Access must be same-origin.
    const patch = (origin: string) => call("/admin/api/reports/1", {
      method: "PATCH", body: JSON.stringify({ status: "open" }),
      headers: { "Cf-Access-Jwt-Assertion": "", Origin: origin, "Content-Type": "application/json" },
    }, e);
    const token = await jwt();
    const cross = await call("/admin/api/reports/1", { method: "PATCH", body: "{}", headers: { "Cf-Access-Jwt-Assertion": token, Origin: "https://evil.example", "Content-Type": "application/json" } }, e);
    expect(cross.status).toBe(403);
    expect((await patch("http://localhost")).status).toBe(401); // empty assertion
  });

  it("ingest keeps its own Bearer-only guard", async () => {
    expect((await call("/admin/api/ingest/embed", { method: "POST", body: "{}" })).status).toBe(401);
    const res = await call("/admin/api/ingest/embed", { method: "POST", headers: { ...ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ texts: ["a"], kind: "query" }) });
    expect((await res.json<any>()).vectors[0]).toHaveLength(384);
  });
});

describe("admin API before any event is counted", () => {
  it("overview: D1 numbers, event fields null, eventsEnabled false", async () => {
    const o = await (await call("/admin/api/overview?days=30", { headers: ADMIN })).json<any>();
    expect(o.eventsEnabled).toBe(false);
    expect(o.devices).toMatchObject({ dau: 1, wau: 2, mau: 2, new7: 1 });
    expect(o.devices.total).toBeGreaterThanOrEqual(3);
    expect(o.users).toMatchObject({ total: 1, new7: 1, active30: 1 });
    expect(o.shares).toMatchObject({ total: 1, opens: 4 });
    expect(o.reports).toEqual({ open: 1 });
    expect(o.countries).toEqual(expect.arrayContaining([{ key: "IN", n: 1 }, { key: "GB", n: 1 }]));
    expect(o.platforms).toEqual(expect.arrayContaining([{ key: "android", n: 1 }]));
    for (const k of ["exports", "exportFailures", "funnel", "events", "devicesByType", "browsers", "opensByCountry"]) expect(o[k]).toBeNull();
  });

  it("content: cached searches from D1, the rest null", async () => {
    const c = await (await call("/admin/api/content", { headers: ADMIN })).json<any>();
    expect(c.cachedSearches[0]).toMatchObject({ q: "patience", topic: "patience", n: 6 });
    expect(c.ayahs).toBeNull();
    expect(c.noClickSearches).toBeNull();
  });

  it("clips: list with status, reports and safety; PATCH status hides it from the app", async () => {
    const list = await (await call("/admin/api/clips?status=active", { headers: ADMIN })).json<any>();
    expect(list.total).toBe(1);
    expect(list.clips[0]).toMatchObject({
      id: "pb7", tags: ["sea", "calm"], thumb: "thumbs/pb7.webp", video: { portrait: "clips/p/pb7.mp4", landscape: "clips/l/pb7.mp4" },
      safety: { people: 0.01 }, status: "active", reports: 1, uses: null,
    });
    const patch = await send("PATCH", "/admin/api/clips/pb7", { status: "hidden" }, { headers: ADMIN });
    expect(await patch.json()).toEqual({ id: "pb7", status: "hidden" });
    expect((await call("/admin/api/clips?status=hidden", { headers: ADMIN }).then((r) => r.json<any>())).clips[0].id).toBe("pb7");
    expect((await send("PATCH", "/admin/api/clips/pb7", { status: "gone" }, { headers: ADMIN })).status).toBe(400);
    expect((await send("PATCH", "/admin/api/clips/nope", { status: "hidden" }, { headers: ADMIN })).status).toBe(404);
    const { hiddenClips } = await import("../src/lib/data");
    expect((await hiddenClips(env as unknown as Env, "http://localhost/")).has("pb7")).toBe(true);
  });

  it("reports: queue by status, PATCH status", async () => {
    const open = await (await call("/admin/api/reports", { headers: ADMIN })).json<any>();
    expect(open.total).toBe(1);
    expect(open.reports[0]).toMatchObject({ kind: "background", clip_id: "pb7", note: "person visible", status: "open" });
    expect((await (await call("/admin/api/reports?status=all", { headers: ADMIN })).json<any>()).total).toBe(2);
    const id = open.reports[0].id;
    expect(await (await send("PATCH", `/admin/api/reports/${id}`, { status: "dismissed" }, { headers: ADMIN })).json()).toEqual({ id, status: "dismissed" });
    expect((await (await call("/admin/api/reports", { headers: ADMIN })).json<any>()).total).toBe(0);
    expect((await send("PATCH", "/admin/api/reports/99999", { status: "done" }, { headers: ADMIN })).status).toBe(404);
  });

  it("users and AI cost", async () => {
    const users = await (await call("/admin/api/users", { headers: ADMIN })).json<any>();
    expect(users.total).toBe(1);
    expect(users.users[0]).toMatchObject({ id: "u1", email: "a@example.com", creations: 0, favourites: 0, devices: 1 });
    expect(users.users[0].last_active).toBe(users.users[0].last_login);
    const luna = await (await call("/admin/api/luna?days=7", { headers: ADMIN })).json<any>();
    expect(luna.capUsd).toBe(1);
    expect(luna.days).toEqual([{ day: new Date().toISOString().slice(0, 10), calls: 12, input_tokens: 3600, cost_usd: 0.0024 }]);
    expect(luna.cache).toEqual({ rows: 1, hits: 5 });
  });

  it("rollup writes the D1 metrics for a day; the cron handler runs it for yesterday", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await (await send("POST", `/admin/api/rollup?day=${today}`, undefined, { headers: ADMIN })).json<any>();
    expect(res).toMatchObject({ day: today, eventsEnabled: false });
    const rows = (await env.DB.prepare("SELECT metric, value FROM daily_stats WHERE day = ? ORDER BY metric").bind(today).all<any>()).results;
    expect(Object.fromEntries(rows.map((r) => [r.metric, r.value]))).toMatchObject({ devices_active: 1, users_new: 0, luna_calls: 12, luna_cost_usd: 0.0024, shares_new: 1 });
    expect((await send("POST", "/admin/api/rollup?day=yesterday", undefined, { headers: ADMIN })).status).toBe(400);

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: "30 0 * * *" }), env as unknown as Env, ctx);
    await waitOnExecutionContext(ctx);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    expect(await env.DB.prepare("SELECT value FROM daily_stats WHERE day = ? AND metric = 'devices_total'").bind(yesterday).first()).not.toBeNull();
    // The overview shows the history.
    const o = await (await call("/admin/api/overview", { headers: ADMIN })).json<any>();
    expect(o.daily.devices_total.length).toBeGreaterThanOrEqual(1);
  });
});

describe("admin API from D1 event counters", () => {
  const today = utcDay(Date.now());
  const daysAgo = (n: number) => utcDay(Date.now() - n * 86400_000);
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const post = (events: unknown[], ua = IPHONE) => send("POST", "/api/events", { events }, { headers: { "User-Agent": ua } });

  beforeAll(async () => {
    // Two devices today (one full session each), plus a third that only opens the app and searches.
    for (const batch of [...SESSION("smoke-a"), ...SESSION("smoke-b")]) await post(batch);
    const e = (name: string, props: Record<string, unknown> = {}) => ({ name, ts: Date.now(), anon: "smoke-c", session: "s", props });
    await post([e("app_open"), e("search", { q: "Mercy" }), e("export_failed", { kind: "image", reason: "canvas tainted" })],
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36");
    // Older counters: 5 days ago is inside 7 and 30 days, 40 days ago only inside 90.
    const db = env.DB;
    const row = db.prepare("INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, ?, ?, ?)");
    await db.batch([
      row.bind(daysAgo(5), "event", "app_open", 10), row.bind(daysAgo(5), "export_ref", "2:255", 4), row.bind(daysAgo(5), "export_surah", "2", 4),
      row.bind(daysAgo(5), "search_click", "mercy", 1),
      row.bind(daysAgo(40), "export_ref", "1:1", 50), row.bind(daysAgo(40), "export_surah", "1", 50), row.bind(daysAgo(40), "search", "old query", 9),
      db.prepare("INSERT INTO device_stage (day, anon, stage) VALUES (?, 'smoke-a', 'open'), (?, 'old', 'open'), ('2000-01-01', 'gone', 'open')")
        .bind(daysAgo(5), daysAgo(40)),
    ]);
  });

  it("overview: exports, success rate and time, funnel, events, devices, browsers, countries, daily series", async () => {
    const o = await (await call("/admin/api/overview?days=7", { headers: ADMIN })).json<any>();
    expect(o).toMatchObject({ eventsEnabled: true, days: 7, from: daysAgo(6), to: today });
    expect(o.exports).toEqual({
      video: { done: 2, failed: 2, avgMs: 8000, avgBytes: 2_000_000, successRate: 0.5 },
      image: { done: 2, failed: 1, avgMs: 300, avgBytes: 100_000, successRate: 0.667 },
    });
    expect(o.exportFailures).toEqual([{ key: "encoder error # at <url>", n: 2 }, { key: "canvas tainted", n: 1 }]);
    expect(o.funnel).toEqual({ open: 3, search: 3, ayah: 2, export: 2, share: 2 });
    expect(o.events).toEqual(expect.arrayContaining([{ key: "app_open", n: 13 }, { key: "export_done", n: 4 }, { key: "search", n: 5 }, { key: "link_copy", n: 2 }]));
    expect(o.devicesByType).toEqual([{ key: "mobile", n: 2 }, { key: "desktop", n: 1 }]);
    expect(o.browsers).toEqual([{ key: "safari", n: 2 }, { key: "chrome", n: 1 }]);
    expect(o.opensByCountry).toEqual([{ key: "XX", n: 3 }]);
    expect(o.daily["event:app_open"]).toEqual([{ day: daysAgo(5), value: 10 }, { day: today, value: 3 }]);
    expect(o.daily["export:video"]).toEqual([{ day: today, value: 2 }]);
    expect(o.daily["funnel:open"]).toEqual([{ day: daysAgo(5), value: 1 }, { day: today, value: 3 }]);
    // The D1 device numbers are unchanged in shape.
    expect(o.devices.total).toBeGreaterThanOrEqual(6);
  });

  it("overview: the day range bounds the event metrics", async () => {
    const one = await (await call("/admin/api/overview?days=1", { headers: ADMIN })).json<any>();
    expect(one.events).toEqual(expect.arrayContaining([{ key: "app_open", n: 3 }]));
    expect(one.funnel.open).toBe(3);
    const ninety = await (await call("/admin/api/overview?days=90", { headers: ADMIN })).json<any>();
    expect(ninety.funnel.open).toBe(4); // + the device from 40 days ago; the year-2000 row is outside
  });

  it("content: top ayahs, surahs, searches, no-click searches, clips, reciters, translations, orientations", async () => {
    const c = await (await call("/admin/api/content?days=30&limit=5", { headers: ADMIN })).json<any>();
    expect(c).toMatchObject({ eventsEnabled: true, days: 30, from: daysAgo(29), to: today });
    expect(c.ayahs).toEqual([{ key: "2:255", n: 6 }, { key: "94:5", n: 2 }]);
    expect(c.surahs).toEqual([{ key: "2", n: 6 }, { key: "94", n: 2 }]);
    expect(c.searches).toEqual([{ key: "lost query", n: 2 }, { key: "patience in hardship", n: 2 }, { key: "mercy", n: 1 }]);
    // "patience in hardship" was clicked today, "mercy" 5 days ago; "old query" is outside the range.
    expect(c.noClickSearches).toEqual([{ key: "lost query", n: 2 }]);
    expect(c.clips).toEqual([{ key: "pb1", n: 2 }]);
    expect(c.exportClips).toEqual([{ key: "colour", n: 2 }, { key: "pb1", n: 2 }]);
    expect(c.bgSources).toEqual([{ key: "library", n: 2 }]);
    expect(c.reciters).toEqual([{ key: "Alafasy_128kbps", n: 4 }]);
    expect(c.translations).toEqual([{ key: "en.sahih", n: 4 }]);
    expect(c.orientations).toEqual([{ key: "portrait", n: 4 }]);

    const wide = await (await call("/admin/api/content?days=90&limit=1", { headers: ADMIN })).json<any>();
    expect(wide.ayahs).toEqual([{ key: "1:1", n: 50 }]);
    expect(wide.surahs).toEqual([{ key: "1", n: 50 }]);
    expect(wide.noClickSearches).toEqual([{ key: "old query", n: 9 }]);
  });

  it("clips: uses from bg_select counters", async () => {
    await env.DB.prepare("INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, 'bg_clip', 'pb7', 6)").bind(daysAgo(2)).run();
    const list = await (await call("/admin/api/clips", { headers: ADMIN })).json<any>();
    expect(list.eventsEnabled).toBe(true);
    expect(list.clips.find((c: any) => c.id === "pb7").uses).toBe(6);
  });

  it("the nightly job prunes device_stage and free-text counters after 120 days and needs no API token", async () => {
    // Old rows: free-text counters (and their day_keys counts) go; snapshots, events and the other counters stay.
    const row = env.DB.prepare("INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, ?, ?, 1)");
    const old = [["search", "ancient"], ["search_click", "ancient"], ["export_fail_reason", "old bug"], ["day_keys", "search"],
      ["devices_total", ""], ["event", "app_open"], ["export", "video"], ["export_ref", "1:1"], ["export_translation", "en.sahih"]];
    await env.DB.batch(old.map(([metric, key]) => row.bind(daysAgo(130), metric, key)));
    const res = await (await send("POST", `/admin/api/rollup?day=${daysAgo(1)}`, undefined, { headers: ADMIN })).json<any>();
    expect(res).toMatchObject({ day: daysAgo(1), rows: 9, eventsEnabled: true });
    const left = (await env.DB.prepare("SELECT day FROM device_stage WHERE anon IN ('gone', 'old')").all<any>()).results;
    expect(left).toEqual([{ day: daysAgo(40) }]);
    const kept = (await env.DB.prepare("SELECT metric FROM daily_stats WHERE day = ? ORDER BY metric").bind(daysAgo(130)).all<any>()).results;
    expect(kept.map((r) => r.metric)).toEqual(["devices_total", "event", "export", "export_ref", "export_translation"]);
    // Free-text counters inside the admin range stay.
    expect(await env.DB.prepare("SELECT value FROM daily_stats WHERE day = ? AND metric = 'search' AND dim = 'old query'").bind(daysAgo(40)).first("value")).toBe(9);
    // Counters are left alone by the snapshot.
    expect((await env.DB.prepare("SELECT value FROM daily_stats WHERE day = ? AND metric = 'event' AND dim = 'app_open'").bind(today).first<any>()).value).toBe(3);
  });
});
