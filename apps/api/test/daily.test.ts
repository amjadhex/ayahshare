import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { utcDay } from "../src/lib/stats";
import { call, makeEnv, send } from "./helpers";

const ADMIN = { Authorization: "Bearer test-admin" };
const DAY = 86400_000;
const day = (offset: number) => utcDay(Date.now() + offset * DAY);
const put = (d: string, ref: unknown) => send("PUT", `/admin/api/daily/${d}`, { ref }, { headers: ADMIN });

describe("GET /api/daily", () => {
  it("lists the admin's picks in the range, sorted, cacheable for five minutes", async () => {
    await put(day(3), "2:255");
    await put(day(1), "94:5");
    await put(day(40), "1:1");
    const res = await call(`/api/daily?from=${day(0)}&days=14`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({ picks: [{ day: day(1), ref: "94:5" }, { day: day(3), ref: "2:255" }] });
    // the range is inclusive of its last day and starts at `from`
    expect((await (await call(`/api/daily?from=${day(1)}&days=1`)).json<any>()).picks).toEqual([{ day: day(1), ref: "94:5" }]);
    expect((await (await call(`/api/daily?from=${day(4)}&days=3`)).json<any>()).picks).toEqual([]);
    // days defaults to 14, from to today
    expect((await (await call("/api/daily")).json<any>()).picks.map((p: any) => p.day)).toEqual([day(1), day(3)]);
    expect((await (await call(`/api/daily?from=${day(0)}&days=31`)).json<any>()).picks).toHaveLength(2);
  });

  it("is public and rejects bad input", async () => {
    for (const q of ["from=2026-13-01", "from=2026-02-30", "from=tomorrow", "from=2026-1-1", "days=0", "days=32", "days=abc", "days=-1", "days=1.5"]) {
      expect((await call(`/api/daily?${q}`)).status, q).toBe(400);
    }
  });
});

describe("admin daily", () => {
  it("needs the admin guard", async () => {
    expect((await call("/admin/api/daily")).status).toBe(401);
    expect((await send("PUT", `/admin/api/daily/${day(2)}`, { ref: "2:255" })).status).toBe(401);
    expect((await send("DELETE", `/admin/api/daily/${day(3)}`)).status).toBe(401);
  });

  it("PUT sets a day (replacing an earlier pick), GET and DELETE read and clear it", async () => {
    const d = day(5);
    const before = Date.now();
    const res = await put(d, "3:200");
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toMatchObject({ day: d, ref: "3:200" });
    expect(body.at).toBeGreaterThanOrEqual(before);
    expect(await env.DB.prepare("SELECT ref, set_by FROM daily_ayah WHERE day = ?").bind(d).first()).toEqual({ ref: "3:200", set_by: null });
    await put(d, "39:10");
    const list = await (await call(`/admin/api/daily?from=${day(0)}&days=14`, { headers: ADMIN })).json<any>();
    expect(list.picks.find((p: any) => p.day === d)).toMatchObject({ ref: "39:10" });
    expect(list.picks.filter((p: any) => p.day === d)).toHaveLength(1);

    expect((await send("DELETE", `/admin/api/daily/${d}`, undefined, { headers: ADMIN })).status).toBe(204);
    expect((await send("DELETE", `/admin/api/daily/${d}`, undefined, { headers: ADMIN })).status).toBe(204);
    expect((await (await call(`/api/daily?from=${d}&days=1`)).json<any>()).picks).toEqual([]);
    expect((await send("DELETE", "/admin/api/daily/soon", undefined, { headers: ADMIN })).status).toBe(400);
  });

  it("records who set the day when signed in with an address on ADMIN_EMAILS", async () => {
    const { sha256 } = await import("../src/lib/http");
    const now = Date.now(), token = "c".repeat(43);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, google_sub, email, name, created_at, last_login) VALUES ('udaily', 'gdaily', 'Owner@Example.com', 'O', ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 'udaily', ?, ?)").bind(await sha256(token), now, now + DAY),
    ]);
    const e = { ...makeEnv(), ADMIN_EMAILS: "owner@example.com" } as Env;
    const res = await send("PUT", `/admin/api/daily/${day(6)}`, { ref: "2:255" }, { cookie: `__Host-qd_session=${token}`, env: e });
    expect(res.status).toBe(200);
    expect((await env.DB.prepare("SELECT set_by FROM daily_ayah WHERE day = ?").bind(day(6)).first<any>()).set_by).toBe("Owner@Example.com");
    // a cross-site write is refused like the other admin writes
    const cross = await call(`/admin/api/daily/${day(6)}`, { method: "PUT", body: JSON.stringify({ ref: "2:255" }), headers: { Cookie: `__Host-qd_session=${token}`, Origin: "https://evil.example", "Content-Type": "application/json" } }, e);
    expect(cross.status).toBe(403);
  });

  it("PUT validates the day and the reference", async () => {
    // one day of slack for time zones ahead of UTC; earlier is refused
    expect((await put(day(-1), "2:255")).status).toBe(200);
    expect((await put(day(-2), "2:255")).status).toBe(400);
    expect((await put("2026-02-30", "2:255")).status).toBe(400);
    expect((await put("tomorrow", "2:255")).status).toBe(400);
    for (const ref of ["", "2", "2:0", "115:1", "2:287", "94:9", "abc", "2:255:1", 255, null, undefined, { a: 1 }]) {
      expect((await put(day(7), ref)).status, String(ref)).toBe(400);
    }
    expect((await put(day(7), "94:8")).status).toBe(200); // surahs.json: surah 94 has 8 ayahs
    expect((await send("PUT", `/admin/api/daily/${day(7)}`, undefined, { headers: ADMIN })).status).toBe(400);
    const big = await send("PUT", `/admin/api/daily/${day(7)}`, { ref: "2:255", pad: "x".repeat(5000) }, { headers: ADMIN });
    expect(big.status).toBe(413);
  });

  it("stats: zeros and remindersOn null before any event is counted", async () => {
    const d = await (await call(`/admin/api/daily?from=${day(0)}&days=14`, { headers: ADMIN })).json<any>();
    expect(d.eventsEnabled).toBe(false);
    expect(d.remindersOn).toBeNull();
    expect(d.stats).toHaveLength(8);
    expect(d.stats[0].day).toBe(day(-7));
    expect(d.stats[7].day).toBe(day(0));
    expect(d.stats.every((s: any) => s.seen === 0 && s.opened === 0 && s.shared === 0)).toBe(true);
    expect((await call("/admin/api/daily?days=40", { headers: ADMIN })).status).toBe(400);
    expect((await call("/admin/api/daily?from=nope", { headers: ADMIN })).status).toBe(400);
  });

  it("stats: the 7 days before `from` and `from`, oldest first; reminders on minus off over all days", async () => {
    const row = (dayStr: string, dim: string, value: number) => env.DB.prepare("INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, 'event', ?, ?)").bind(dayStr, dim, value);
    await env.DB.batch([
      row(day(-1), "today_seen", 120), row(day(-1), "today_opened", 30), row(day(-1), "today_shared", 9),
      row(day(-3), "today_seen", 80),
      row(day(-8), "today_seen", 999),                     // before the window
      row(day(0), "today_seen", 7),                        // `from` itself
      row(day(1), "today_seen", 555),                      // after `from`
      row(day(-1), "app_open", 1000),                      // other events are not counted
      row(day(-40), "reminder_on", 50), row(day(-2), "reminder_on", 25), row(day(-1), "reminder_off", 15),
    ]);
    const d = await (await call(`/admin/api/daily?from=${day(0)}&days=14`, { headers: ADMIN })).json<any>();
    expect(d.eventsEnabled).toBe(true);
    expect(d.remindersOn).toBe(60);
    expect(d.stats.map((s: any) => s.day)).toEqual(Array.from({ length: 8 }, (_, i) => day(i - 7)));
    expect(d.stats[6]).toEqual({ day: day(-1), seen: 120, opened: 30, shared: 9 });
    expect(d.stats[4]).toEqual({ day: day(-3), seen: 80, opened: 0, shared: 0 });
    expect(d.stats[7]).toEqual({ day: day(0), seen: 7, opened: 0, shared: 0 });
    expect(d.stats[0]).toEqual({ day: day(-7), seen: 0, opened: 0, shared: 0 });
    // a window moved back: `from` = day(-3) covers day(-10)..day(-3)
    const back = await (await call(`/admin/api/daily?from=${day(-3)}&days=1`, { headers: ADMIN })).json<any>();
    expect(back.stats[7]).toEqual({ day: day(-3), seen: 80, opened: 0, shared: 0 });
    expect(back.stats[1]).toEqual({ day: day(-9), seen: 0, opened: 0, shared: 0 });
    expect(back.stats[2].seen).toBe(999);
  });

  it("the five new events are accepted by POST /api/events and counted by name", async () => {
    const names = ["today_seen", "today_opened", "today_shared", "reminder_on", "reminder_off"];
    const res = await send("POST", "/api/events", { events: names.map((name) => ({ name, ts: Date.now(), anon: "a-daily", session: "s-daily", props: { ref: "2:255" } })) });
    expect(await res.json()).toEqual({ accepted: 5 });
    await new Promise((r) => setTimeout(r, 50));
    const rows = (await env.DB.prepare("SELECT dim, value FROM daily_stats WHERE metric = 'event' AND day = ? AND dim IN (?, ?, ?, ?, ?)").bind(day(0), ...names).all<any>()).results;
    expect(rows.map((r) => r.dim).sort()).toEqual([...names].sort());
  });
});
