import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECITERS as APP_RECITERS } from "../../web/src/config";
import { MAX_EVENTS } from "../src/routes/events";
import {
  DAY_KEYS, MAX_COUNTERS, noClickSearches, normQuery, OTHER, PER_METRIC, RECITERS, shortReason, tally, tallyStatements, utcDay,
} from "../src/lib/stats";
import { parseAgent } from "../src/lib/ua";
import { call, makeEnv, send, SESSION } from "./helpers";

const ev = (name: string, anon = "anon-1", props: Record<string, unknown> = {}) => ({ name, ts: 1_700_000_000_000, anon, session: "s-1", props });
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

describe("POST /api/events", () => {
  it("validates, upserts the batch's first device in one statement, and writes nothing to Analytics Engine when it is not bound", async () => {
    const e = makeEnv();
    const prepare = vi.spyOn(e.DB, "prepare");
    const res = await send("POST", "/api/events", {
      events: [ev("app_open"), ev("search", "anon-1", { q: "x".repeat(500) }), ev("bogus"), { name: "search" }, ev("app_open", "anon-2"), "junk"],
    }, { env: e, headers: { "User-Agent": ANDROID } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 3 });
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("INSERT INTO devices"))).toHaveLength(1);
    const rows = (await env.DB.prepare("SELECT anon_id, platform, sessions, user_id FROM devices WHERE anon_id IN ('anon-1', 'anon-2') ORDER BY anon_id").all()).results;
    // The app sends one device per batch; only the first is recorded (bounds the D1 writes per request).
    expect(rows).toEqual([{ anon_id: "anon-1", platform: "android", sessions: 1, user_id: null }]);
    // A later batch updates last_seen and adds sessions.
    await send("POST", "/api/events", { events: [ev("app_open"), ev("ayah_select")] }, { env: e });
    expect((await env.DB.prepare("SELECT sessions FROM devices WHERE anon_id = 'anon-1'").first<any>()).sessions).toBe(2);
  });

  it("the app's devices (User-Agent with AyahShareApp) are <os>-app, and its browser is \"app\"", async () => {
    const e = makeEnv();
    await send("POST", "/api/events", { events: [ev("app_open", "anon-app")] }, { env: e, headers: { "User-Agent": `${ANDROID} AyahShareApp` } });
    await new Promise((r) => setTimeout(r, 50));
    expect((await env.DB.prepare("SELECT platform FROM devices WHERE anon_id = 'anon-app'").first<any>())?.platform).toBe("android-app");
    expect(parseAgent(`${ANDROID} AyahShareApp`)).toMatchObject({ os: "android", browser: "app", app: true });
    expect(parseAgent(ANDROID)).toMatchObject({ browser: "chrome", app: false });
  });

  it("writes one data point per event when EVENTS is bound (layout from src/routes/events.ts)", async () => {
    const writeDataPoint = vi.fn();
    const e = { ...makeEnv(), EVENTS: { writeDataPoint } } as unknown as Env;
    const props = { ref: "2:255", ayahs: 3, clip: "pb1", reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "portrait",
      kind: "video", ms: 4200, bytes: 1234567, reason: "r".repeat(300), source: "suggested", secret: "dropped" };
    await send("POST", "/api/events", { events: [ev("export_done", "anon-3", props)] }, { env: e, headers: { "User-Agent": ANDROID } });
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    const point = writeDataPoint.mock.calls[0][0];
    expect(point.indexes).toEqual(["anon-3"]);
    expect(point.blobs).toHaveLength(17);
    expect(point.blobs.slice(0, 10)).toEqual(["export_done", "s-1", "2:255", "pb1", "Alafasy_128kbps", "en.sahih", "portrait", "suggested", "", "video"]);
    expect(point.blobs[10]).toHaveLength(200); // reason truncated
    expect(point.blobs.slice(13, 16)).toEqual(["mobile", "chrome", "android"]);
    expect(point.doubles).toEqual([3, 4200, 1234567, 1_700_000_000_000]);
    expect(JSON.stringify(point)).not.toContain("dropped");
  });

  it("refuses more than 20 events (the app's batch size), bodies over 64 KB, non-JSON and cross-site posts", async () => {
    expect(MAX_EVENTS).toBe(20);
    expect((await send("POST", "/api/events", { events: Array.from({ length: 20 }, () => ev("search")) })).status).toBe(200);
    expect((await send("POST", "/api/events", { events: Array.from({ length: 21 }, () => ev("search")) })).status).toBe(413);
    expect((await send("POST", "/api/events", { events: [ev("search", "a", { q: "x".repeat(70_000) })] })).status).toBe(413);
    expect((await send("POST", "/api/events", { nope: 1 })).status).toBe(400);
    expect((await call("/api/events", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/x-www-form-urlencoded" }, body: "a=1" })).status).toBe(415);
    // sendBeacon-style text/plain is accepted here (same origin only).
    const beacon = await call("/api/events", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ events: [ev("app_open", "anon-beacon")] }) });
    expect(await beacon.json()).toEqual({ accepted: 1 });
    expect((await send("POST", "/api/reports", undefined, { headers: { "Content-Type": "text/plain" } })).status).toBe(400);
    expect((await call("/api/reports", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await call("/api/events", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
    expect((await call("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
  });

  it("rate limits per IP (binding when bound, else per isolate)", async () => {
    const limited = { ...makeEnv(), EVENTS_LIMITER: { limit: vi.fn(async () => ({ success: false })) } } as unknown as Env;
    const res = await send("POST", "/api/events", { events: [ev("search")] }, { env: limited });
    expect(res.status).toBe(429);

    const unbound = { ...makeEnv(), EVENTS_LIMITER: undefined } as unknown as Env;
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await send("POST", "/api/events", { events: [] }, { env: unbound, headers: { "CF-Connecting-IP": "10.9.9.9" } })).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
  });
});

/** Today's counters as { "metric|dim": value } (without the day_keys and counter_rows bookkeeping). */
async function counters(day = utcDay(Date.now())) {
  const rows = (await env.DB.prepare("SELECT metric, dim, value FROM daily_stats WHERE day = ? AND metric NOT IN ('day_keys', 'counter_rows')").bind(day).all<any>()).results;
  return Object.fromEntries(rows.map((r) => [`${r.metric}|${r.dim}`, r.value])) as Record<string, number>;
}
const delta = (after: Record<string, number>, before: Record<string, number>) =>
  Object.fromEntries(Object.entries(after).filter(([k, v]) => v !== (before[k] ?? 0)).map(([k, v]) => [k, v - (before[k] ?? 0)]));

describe("event counters in D1", () => {
  afterEach(() => vi.restoreAllMocks());
  const origin = { country: "IN", device: "mobile", browser: "chrome" };
  const CLIPS = new Set(["pb1", "pb2"]);

  it("adds each batch to today's counters and funnel stages in one D1 batch per request", async () => {
    const e = makeEnv();
    const before = await counters();
    const batch = vi.spyOn(e.DB, "batch");
    const prepare = vi.spyOn(e.DB, "prepare");
    for (const [i, events] of SESSION("anon-c1").entries()) {
      batch.mockClear();
      prepare.mockClear();
      const res = await call("/api/events", {
        method: "POST", body: JSON.stringify({ events }),
        headers: { Origin: "http://localhost", "Content-Type": "application/json", "User-Agent": ANDROID },
      }, e);
      expect(await res.json()).toEqual({ accepted: 6 });
      expect(batch).toHaveBeenCalledTimes(1);
      // Outside the batch only the daily counter budget: read before, rows written added after (src/lib/counters.ts).
      expect(prepare).toHaveBeenCalledTimes(batch.mock.calls[0][0].length + 2);
      // device (app_open batch only: once per app session), fixed-set counters, open counters (day_keys + insert), device_stage
      expect(batch.mock.calls[0][0]).toHaveLength(i === 0 ? 5 : 4);
    }

    const once = delta(await counters(), before);
    expect(once).toEqual({
      "event|app_open": 1, "event|search": 2, "event|search_click": 1, "event|ayah_select": 1, "event|bg_select": 1,
      "event|export_start": 1, "event|export_done": 2, "event|export_failed": 1, "event|share_native": 1, "event|link_copy": 1,
      "export|video": 1, "export|image": 1, "export_ms|video": 8000, "export_ms|image": 300,
      "export_bytes|video": 2_000_000, "export_bytes|image": 100_000,
      "export_ref|94:5": 1, "export_ref|2:255": 1, "export_surah|94": 1, "export_surah|2": 1,
      "export_reciter|Alafasy_128kbps": 2, "export_translation|en.sahih": 2, "export_orientation|portrait": 2,
      "export_clip|pb1": 1, "export_clip|colour": 1,
      "export_fail|video": 1, "export_fail_reason|encoder error # at <url>": 1,
      "search|patience in hardship": 1, "search|lost query": 1, "search_click|patience in hardship": 1,
      "bg_source|library": 1, "bg_clip|pb1": 1,
      "open_device|mobile": 1, "open_browser|chrome": 1, "open_country|XX": 1,
    });
    const stages = () => env.DB.prepare("SELECT stage FROM device_stage WHERE anon = 'anon-c1' AND day = ? ORDER BY stage").bind(utcDay(Date.now())).all<any>()
      .then((r) => r.results.map((x) => x.stage));
    expect(await stages()).toEqual(["ayah", "export", "open", "search", "share"]);

    // The same session again: counters add up, stages stay one row per device and stage.
    for (const events of SESSION("anon-c1")) await send("POST", "/api/events", { events }, { env: e, headers: { "User-Agent": ANDROID } });
    const twice = delta(await counters(), before);
    for (const [k, v] of Object.entries(once)) expect(twice[k]).toBe(v * 2);
    expect(await stages()).toHaveLength(5);
  });

  it("counts the country from Cloudflare", async () => {
    const before = await counters();
    const res = await call("/api/events", {
      method: "POST", body: JSON.stringify({ events: [ev("app_open", "anon-c2")] }),
      headers: { Origin: "http://localhost", "Content-Type": "application/json" }, cf: { country: "IN" },
    } as RequestInit);
    expect(res.status).toBe(200);
    expect(delta(await counters(), before)).toMatchObject({ "event|app_open": 1, "open_country|IN": 1, "open_device|desktop": 1 });
  });

  it("normalises queries and failure reasons", () => {
    expect(normQuery("  Patience\n\tIN   hardship ")).toBe("patience in hardship");
    expect(normQuery("x".repeat(100))).toHaveLength(60);
    expect(normQuery("   ")).toBe("");
    expect(normQuery(undefined)).toBe("");
    expect(shortReason("Failed to fetch https://cdn.example/clip.mp4?x=1 (code 12345)\nat foo")).toBe("failed to fetch <url> (code #)");
    expect(shortReason(" ")).toBe("unknown");
  });

  it("counts fixed-set props only for known values (else other), and valid ayah refs only", () => {
    const done = (props: Record<string, unknown>) => ({ name: "export_done", anon: "a", props: props as Record<string, string> });
    const t = tally([
      done({ kind: "video", ref: "002:255", reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "square", clip: "pb1" }),
      done({ kind: "gif", ref: "115:1", reciter: "Evil_Reciter", translation: "<script>", orientation: "diagonal", clip: "pb999" }),
      done({ kind: "image", ref: "2:287" }), // no reciter / translation / orientation / clip: not counted
    ], origin, CLIPS);
    const bg = tally([
      { name: "bg_select", anon: "a", props: { source: "library", clip: "colour" } },
      { name: "bg_select", anon: "a", props: { source: "hacked", clip: "x".repeat(40) } },
    ], origin, CLIPS);
    const get = (m: string) => Object.fromEntries((t.counters.get(m as never) ?? bg.counters.get(m as never)) ?? []);
    expect(get("export")).toEqual({ video: 1, other: 1, image: 1 });
    expect(get("export_ref")).toEqual({ "2:255": 1 });
    expect(get("export_surah")).toEqual({ 2: 1 });
    expect(get("export_reciter")).toEqual({ Alafasy_128kbps: 1, other: 1 });
    expect(get("export_translation")).toEqual({ "en.sahih": 1, other: 1 });
    expect(get("export_orientation")).toEqual({ square: 1, other: 1 });
    expect(get("export_clip")).toEqual({ pb1: 1, other: 1 });
    expect(get("bg_source")).toEqual({ library: 1, other: 1 });
    expect(get("bg_clip")).toEqual({ colour: 1, other: 1 });
  });

  it("the reciter list matches the app's (apps/web/src/config.ts)", () => {
    expect([...RECITERS].sort()).toEqual(APP_RECITERS.map(([folder]) => folder).sort());
  });

  it("caps distinct keys per metric (folding the rest into other) and per batch, skips empty keys, never drops event names", () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ name: "search", anon: "a", props: { q: `query ${i}` } }));
    const t1 = tally([...many, { name: "search", anon: "a", props: { q: "   " } }, { name: "search", anon: "a", props: { q: "query 0" } }], origin, CLIPS);
    expect(Object.fromEntries(t1.counters.get("search")!)).toEqual({ "query 0": 2, "query 1": 1, "query 2": 1, [OTHER]: 15 });
    expect(PER_METRIC).toBe(3);
    expect(t1.counters.get("event")!.get("search")).toBe(20);

    // A batch with every event name and many distinct values: at most MAX_COUNTERS keys, all event names among them.
    const names = ["app_open", "ayah_select", "customise", "preview_play", "export_start", "share_native", "link_copy", "share_open",
      "sign_in", "creation_save", "report", "error"];
    const wide = Array.from({ length: 4 }, (_, i) => [
      { name: "search", anon: "a", props: { q: `q${i}` } },
      { name: "search_click", anon: "a", props: { q: `c${i}` } },
      { name: "bg_select", anon: "a", props: { source: "library", clip: `pb${i}` } },
      { name: "export_failed", anon: "a", props: { kind: "video", reason: `r${i}` } },
      { name: "export_done", anon: "a", props: { kind: "video", reciter: "Hudhaify_128kbps", translation: `en.t${i}`, ref: `${i + 1}:1` } },
    ]).flat();
    const t2 = tally([...names.map((name) => ({ name, anon: "a", props: {} })), ...wide], origin, CLIPS);
    const total = [...t2.counters.values()].reduce((n, m) => n + m.size, 0);
    expect(MAX_COUNTERS).toBe(24);
    expect(total).toBe(MAX_COUNTERS);
    expect([...t2.counters.get("event")!.keys()].sort()).toEqual([...names, "search", "search_click", "bg_select", "export_failed", "export_done"].sort());
    expect([...t2.counters].filter(([m]) => m !== "event").every(([, dims]) => dims.size <= PER_METRIC + 1)).toBe(true);
  });

  it("records funnel stages for the batch's first device only, once per stage", () => {
    const list = ["d1", "d2", "d3"].flatMap((anon) => [
      { name: "app_open", anon, props: {} }, { name: "app_open", anon, props: {} }, { name: "customise", anon, props: {} },
      { name: "share_native", anon, props: {} }, { name: "link_copy", anon, props: {} },
    ]);
    expect(tally(list, origin, CLIPS).stages).toEqual([{ anon: "d1", stage: "open" }, { anon: "d1", stage: "share" }]);
  });

  it("writes large tallies in chunks that D1 accepts (≤ 100 bound parameters per statement)", async () => {
    const counters = new Map([
      ["event", new Map(Array.from({ length: 17 }, (_, i) => [`e${i}`, 1]))],
      ["search", new Map(Array.from({ length: 33 }, (_, i) => [`q${i}`, i]))],
    ]) as ReturnType<typeof tally>["counters"];
    const stages = Array.from({ length: 60 }, (_, i) => ({ anon: `x${i}`, stage: "open" as const }));
    const statements = tallyStatements(env.DB, "2000-01-01", { counters, stages });
    expect(statements).toHaveLength(7); // 17 fixed-set counters → 1, 33 open → 2 × (day_keys + insert), 60 stages → 49 + 11
    await env.DB.batch(statements);
    await env.DB.batch(tallyStatements(env.DB, "2000-01-01", { counters, stages }));
    const sum = await env.DB.prepare("SELECT COUNT(*) AS rows, SUM(value) AS total FROM daily_stats WHERE day = '2000-01-01' AND metric != 'day_keys'").first<any>();
    expect(sum).toEqual({ rows: 50, total: 2 * (17 + (32 * 33) / 2) });
    expect(await env.DB.prepare("SELECT value FROM daily_stats WHERE day = '2000-01-01' AND metric = 'day_keys' AND dim = 'search'").first("value")).toBe(33);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM device_stage WHERE day = '2000-01-01'").first<any>()).n).toBe(60);
  });

  it("keeps at most DAY_KEYS keys per open metric per day; later new keys count as other", async () => {
    const day = "2001-01-01";
    const write = (metric: string, keys: string[]) => env.DB.batch(tallyStatements(env.DB, day, {
      counters: new Map([[metric, new Map(keys.map((k) => [k, 1]))]]) as ReturnType<typeof tally>["counters"], stages: [],
    }));
    await write("search", Array.from({ length: DAY_KEYS }, (_, i) => `q${i}`));
    const rows = (metric: string) => env.DB.prepare("SELECT dim, value FROM daily_stats WHERE day = ? AND metric = ?").bind(day, metric).all<any>()
      .then((r) => Object.fromEntries(r.results.map((x) => [x.dim, x.value])));
    expect(Object.keys(await rows("search"))).toHaveLength(DAY_KEYS);
    // Full: an existing key still counts, new keys go to other (written as one row), other metrics are not affected.
    await write("search", ["q0", "new 1", "new 2"]);
    const after = await rows("search");
    expect(Object.keys(after)).toHaveLength(DAY_KEYS + 1);
    expect(after).toMatchObject({ q0: 2, [OTHER]: 2 });
    expect(after["new 1"]).toBeUndefined();
    const results = await write("search", ["new 3"]);
    expect((await rows("search"))[OTHER]).toBe(3);
    expect(results.reduce((n, r) => n + r.meta.rows_written, 0)).toBe(2); // the day_keys count and other
    await write("search_click", ["new 1"]);
    expect(await rows("search_click")).toEqual({ "new 1": 1 });
  });

  it("leaves other out of the no-click searches", async () => {
    const row = env.DB.prepare("INSERT INTO daily_stats (day, metric, dim, value) VALUES ('2001-02-03', 'search', ?, ?)");
    await env.DB.batch([row.bind(OTHER, 50), row.bind("unanswered", 2)]);
    expect(await noClickSearches(env.DB, { from: "2001-02-03", to: "2001-02-03" }, 10)).toEqual([{ key: "unanswered", n: 2 }]);
  });

  it("merges the requests of one window into one D1 batch, so rows grow with distinct keys", async () => {
    const e = { ...makeEnv(), COUNTER_FLUSH_SECONDS: "0.3" } as Env;
    const before = await counters();
    const batch = vi.spyOn(e.DB, "batch");
    const anons = Array.from({ length: 5 }, (_, i) => `anon-w${i}`);
    await Promise.all(anons.map((a) => send("POST", "/api/events", { events: [ev("app_open", a), ev("customise", a)] }, { env: e })));
    expect(batch).toHaveBeenCalledTimes(1);
    expect(delta(await counters(), before)).toMatchObject({ "event|app_open": 5, "event|customise": 5 });
    const devices = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(sessions) AS s FROM devices WHERE anon_id LIKE 'anon-w%'`).first<any>();
    expect(devices).toEqual({ n: 5, s: 5 });
  });

  it("writes only the device of app_open batches (once per app session)", async () => {
    await send("POST", "/api/events", { events: [ev("customise", "anon-no-open"), ev("preview_play", "anon-no-open")] });
    expect(await env.DB.prepare("SELECT 1 FROM devices WHERE anon_id = 'anon-no-open'").first()).toBeNull();
  });

  it("stops writing counters for the day once COUNTER_ROWS_PER_DAY rows are used (the app still gets 200)", async () => {
    const day = utcDay(Date.now());
    const used = await env.DB.prepare("SELECT value FROM daily_stats WHERE day = ? AND metric = 'counter_rows'").bind(day).first<number>("value");
    expect(used).toBeGreaterThan(0); // the requests above were counted
    const e = { ...makeEnv(), COUNTER_ROWS_PER_DAY: String(used) } as Env;
    const before = await counters();
    const res = await send("POST", "/api/events", { events: [ev("app_open", "anon-over-budget"), ev("customise", "anon-over-budget")] }, { env: e });
    expect(await res.json()).toEqual({ accepted: 2 });
    expect(delta(await counters(), before)).toEqual({});
    expect(await env.DB.prepare("SELECT 1 FROM devices WHERE anon_id = 'anon-over-budget'").first()).toBeNull();
  });

  it("bounds the D1 rows written per request (crafted batches: fresh devices, random keys)", async () => {
    const e = makeEnv();
    const rnd = () => Math.random().toString(36).slice(2, 12);
    const all = ["app_open", "search", "search_click", "ayah_select", "bg_select", "customise", "preview_play", "export_start", "export_done",
      "export_failed", "share_native", "link_copy", "share_open", "sign_in", "creation_save", "report", "error"];
    // Every event name, or only the events with open keys (searches, failure reasons, translations, ayah refs).
    const crafted = (names: string[]) => Array.from({ length: MAX_EVENTS }, (_, i) => ({
      name: names[i % names.length], ts: Date.now(), anon: `smoke-${rnd()}`, session: "s",
      props: { q: rnd(), reason: rnd(), translation: `en.${rnd()}`, ref: `${1 + Math.floor(Math.random() * 114)}:${1 + Math.floor(Math.random() * 7)}`,
        source: rnd(), clip: rnd(), reciter: rnd(), orientation: rnd(), kind: "video", ms: 1, bytes: 1 },
    }));
    const written = async (events: unknown[]) => {
      const batch = vi.spyOn(e.DB, "batch");
      batch.mockClear();
      expect((await send("POST", "/api/events", { events }, { env: e })).status).toBe(200);
      const results = await batch.mock.results[0].value as D1Result[];
      return results.reduce((n, r) => n + r.meta.rows_written, 0);
    };
    await written(crafted(all)); // today's fixed-set counters exist from here on, as after the day's first visit
    const fresh: number[] = [], steady: number[] = [];
    for (const names of [all, ["search", "search_click", "export_failed", "export_done", "app_open"], ["export_done", "search", "search_click", "export_failed"]]) {
      fresh.push(await written(crafted(names))); // every open key new
      const again = crafted(names);
      await written(again);
      steady.push(await written(again.map((x) => ({ ...x, anon: `smoke-${rnd()}` })))); // the same keys, a new device
    }
    console.log(`rows written per crafted request: new keys ${fresh}, existing keys ${steady}`);
    expect(Math.max(...fresh)).toBeLessThanOrEqual(70); // was 187 with 50 events, 10 devices and 8 keys per metric
    expect(Math.max(...steady)).toBeLessThanOrEqual(35); // was 131
  });
});
