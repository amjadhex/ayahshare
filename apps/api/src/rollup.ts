// Nightly job (cron, wrangler.jsonc): yesterday's D1 snapshot numbers into daily_stats (admin-contract
// SNAPSHOT_METRICS), so history outlives the D1 tables that only keep "last seen". Also removes expired sessions and
// email sign-in codes, search results older than 30 days (query_cache), and device_stage days and free-text counters
// (searches, failure reasons) older than 120 days (src/lib/stats.ts). Event counters need no rollup: POST /api/events
// adds them to daily_stats as events arrive (src/lib/counters.ts), and nothing here reads Analytics Engine, so no
// Cloudflare API token is needed.
import type { SNAPSHOT_METRICS } from "./admin-contract";
import { pruneStatements } from "./lib/stats";
import { CACHE_DAYS } from "./routes/search";

type Row = [metric: keyof typeof SNAPSHOT_METRICS, value: number];

/** Snapshots one UTC day (default: yesterday) and returns the number of rows written. */
export async function rollup(env: Env, day = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)): Promise<number> {
  const start = Date.parse(`${day}T00:00:00Z`);
  const end = start + 86400_000;
  const db = env.DB;
  const one = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<{ n: number }>().then((r) => r?.n ?? 0);

  const [devicesTotal, devicesNew, devicesActive, usersTotal, usersNew, sharesNew, reportsNew, luna] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM devices WHERE first_seen < ?", end),
    one("SELECT COUNT(*) AS n FROM devices WHERE first_seen >= ? AND first_seen < ?", start, end),
    one("SELECT COUNT(*) AS n FROM devices WHERE last_seen >= ?", start),
    one("SELECT COUNT(*) AS n FROM users WHERE created_at < ?", end),
    one("SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?", start, end),
    one("SELECT COUNT(*) AS n FROM shares WHERE created_at >= ? AND created_at < ?", start, end),
    one("SELECT COUNT(*) AS n FROM reports WHERE created_at >= ? AND created_at < ?", start, end),
    db.prepare("SELECT calls, cost_usd FROM luna_usage WHERE day = ?").bind(day).first<{ calls: number; cost_usd: number }>(),
  ]);
  const rows: Row[] = [
    ["devices_total", devicesTotal], ["devices_new", devicesNew], ["devices_active", devicesActive],
    ["users_total", usersTotal], ["users_new", usersNew], ["shares_new", sharesNew], ["reports_new", reportsNew],
    ["luna_calls", luna?.calls ?? 0], ["luna_cost_usd", luna?.cost_usd ?? 0],
  ];

  const insert = db.prepare("INSERT OR REPLACE INTO daily_stats (day, metric, dim, value) VALUES (?, ?, '', ?)");
  await db.batch([
    ...rows.map(([metric, value]) => insert.bind(day, metric, value)),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()),
    // Email sign-in rows whose code has expired and whose hour of sends is over (migrations/0008).
    db.prepare("DELETE FROM email_codes WHERE expires_at < ?1 AND window_start < ?1 - 3600000").bind(Date.now()),
    db.prepare("DELETE FROM query_cache WHERE created_at < ?").bind(Date.now() - CACHE_DAYS * 86400_000),
    ...pruneStatements(db),
  ]);
  return rows.length;
}
