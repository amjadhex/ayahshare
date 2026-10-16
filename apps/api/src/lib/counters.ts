// D1 counters behind a per-isolate buffer: event metrics (devices, daily_stats, device_stage; src/lib/stats.ts), search
// cache hits, share opens, and a share link's opens, reshares and makes per day (share_daily, src/routes/stats.ts). Requests add to the buffer in memory; the request that opens a window writes it as one
// D1 batch COUNTER_FLUSH_SECONDS later (from waitUntil, which may run up to 30 s after the response). So the rows
// written grow with the distinct keys per window, not with the requests: a counter that 50 requests touch is one row.
//
// A daily budget (COUNTER_ROWS_PER_DAY rows written, kept in daily_stats as metric 'counter_rows') stops these counters
// from using up the account's D1 writes (free plan: 100k rows a day, after which every D1 query fails until 00:00
// UTC): above it a window is dropped, and sign-in, shares and search keep working. Analytics Engine, when bound, still
// gets every event (src/routes/events.ts).
import { chunks, tallyStatements, utcDay, type Tally } from "./stats";

/** One device's row (devices table); added once per app session. */
export interface Device { userId: string | null; country: string | null; platform: string; seen: number; sessions: number }

/** A share link's counts per UTC day (share_daily); the key is linkKey(code). */
const daily = (column: "opens" | "reshares" | "makes") =>
  `INSERT INTO share_daily (day, code, ${column}) VALUES (substr(?1, 1, 10), substr(?1, 12), ?2)
   ON CONFLICT (code, day) DO UPDATE SET ${column} = ${column} + excluded.${column}`;

/** Counter columns bumped by key (?1 = key, ?2 = amount). */
const INCREMENTS = {
  hits: "UPDATE query_cache SET hits = hits + ?2 WHERE q = ?1",
  opens: "UPDATE shares SET opens = opens + ?2 WHERE code = ?1",
  link_open: daily("opens"),
  link_reshare: daily("reshares"),
  link_make: daily("makes"),
};

/** The key of a share link's per-day counters: "YYYY-MM-DD <code>" (today, UTC). */
export const linkKey = (code: string, now = Date.now()) => `${utcDay(now)} ${code}`;

interface Pending { tally: Tally; devices: Map<string, Device>; adds: Map<keyof typeof INCREMENTS, Map<string, number>> }
let pending: Pending | null = null;

/** Adds to the buffer. The promise (for waitUntil) settles once the window is written, if this call opened it. */
function add(env: Env, update: (p: Pending) => void): Promise<void> {
  const opened = !pending;
  pending ??= { tally: { counters: new Map(), stages: [] }, devices: new Map(), adds: new Map() };
  update(pending);
  if (!opened) return Promise.resolve();
  return new Promise((done) => setTimeout(done, Number(env.COUNTER_FLUSH_SECONDS || 15) * 1000)).then(() => flush(env));
}

/** query_cache.hits, shares.opens or a share_daily count + 1 for `key`. */
export const increment = (env: Env, name: keyof typeof INCREMENTS, key: string) => add(env, (p) => {
  const keys = p.adds.get(name) ?? new Map<string, number>();
  p.adds.set(name, keys.set(key, (keys.get(key) ?? 0) + 1));
});

/** One events request: its tally and, for an app_open batch, its device. */
export const addEvents = (env: Env, t: Tally, device: [anon: string, Device] | null) => add(env, (p) => {
  for (const [metric, dims] of t.counters) {
    const into = p.tally.counters.get(metric) ?? new Map<string, number>();
    for (const [key, n] of dims) into.set(key, (into.get(key) ?? 0) + n);
    p.tally.counters.set(metric, into);
  }
  p.tally.stages.push(...t.stages);
  if (!device) return;
  const [anon, d] = device;
  const old = p.devices.get(anon);
  p.devices.set(anon, old ? { ...d, userId: d.userId ?? old.userId, country: d.country ?? old.country, sessions: old.sessions + d.sessions } : d);
});

const UPSERT = "ON CONFLICT (day, metric, dim) DO UPDATE SET value = daily_stats.value + excluded.value";

async function flush(env: Env) {
  const p = pending;
  pending = null;
  if (!p) return;
  const db = env.DB;
  const day = utcDay(Date.now());
  const stages = [...new Map(p.tally.stages.map((s) => [`${s.anon} ${s.stage}`, s])).values()];
  const statements = [
    ...chunks([...p.devices], 14).map((part) => db.prepare(
      `INSERT INTO devices (anon_id, user_id, country, platform, first_seen, last_seen, sessions) VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}
       ON CONFLICT(anon_id) DO UPDATE SET last_seen = excluded.last_seen, sessions = devices.sessions + excluded.sessions,
         country = COALESCE(excluded.country, devices.country), platform = excluded.platform,
         user_id = COALESCE(excluded.user_id, devices.user_id)`,
    ).bind(...part.flatMap(([anon, d]) => [anon, d.userId, d.country, d.platform, d.seen, d.seen, d.sessions]))),
    ...tallyStatements(db, day, { counters: p.tally.counters, stages }),
    ...[...p.adds].flatMap(([name, keys]) => [...keys].map(([key, n]) => db.prepare(INCREMENTS[name]).bind(key, n))),
  ];
  if (!statements.length) return;
  try {
    const used = await db.prepare("SELECT value FROM daily_stats WHERE day = ? AND metric = 'counter_rows' AND dim = ''").bind(day).first<number>("value");
    if ((used ?? 0) >= Number(env.COUNTER_ROWS_PER_DAY || 50000)) return console.warn("D1 counter budget for today is used up; window dropped");
    const results = await db.batch(statements);
    const rows = results.reduce((n, r) => n + (r.meta.rows_written ?? 0), 1); // + this budget row
    await db.prepare(`INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, 'counter_rows', '', ?) ${UPSERT}`).bind(day, rows).run();
  } catch (e) {
    console.warn("counter write failed:", String(e));
  }
}
