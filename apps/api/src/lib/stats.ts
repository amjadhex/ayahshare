// Event metrics in D1: POST /api/events tallies each batch in memory and adds it to daily_stats (counters per UTC day)
// and device_stage (funnel) through the counter buffer (src/lib/counters.ts); the admin API reads them back. Metric
// names: admin-contract COUNTER_METRICS and STAGES.
//
// Keys are bounded, so a client cannot make the table, the D1 writes or the admin reads over it grow without limit:
//   - fixed sets: kinds, orientations, sources, reciters, clip ids (clips.json), ayah refs; anything else counts as "other"
//   - OPEN_METRICS (queries, failure reasons, translations, ayah refs) keep at most DAY_KEYS keys per metric per UTC day;
//     later new keys count as "other". A "day_keys" row per (day, metric) counts the new keys for this cap.
//   - per batch: at most PER_METRIC keys per metric (event names exempt; more fold into "other"), MAX_COUNTERS in all,
//     and the funnel stages of one device (the batch's first anon id; the app sends one)
//   - the free-text counters (search, search_click, export_fail_reason) are deleted after KEEP_DAYS (nightly)
//
// D1 rows written (free tier: 100k/day): POST /api/events adds each batch to the per-isolate counter buffer
// (src/lib/counters.ts), which writes the merged tally (+ the devices of app_open batches) as one db.batch() every few
// seconds, so a counter that many requests touch in one window costs one row. An existing counter costs 1 row written,
// a counter's first row of the day ~3 (row + primary key + daily_stats_metric index); device_stage writes only the first
// time a device reaches a stage that day. Worst case for one crafted request written on its own (20 events, a fresh
// device; measured in test/events.test.ts): ≈ 60 rows while its open keys are new (the day caps allow 5 × DAY_KEYS of
// those a day), ≈ 30 once the keys exist or the caps are reached. Whatever the traffic, the counters stop at
// COUNTER_ROWS_PER_DAY rows a day (counters.ts), leaving the rest of the D1 quota to sign-in, shares and search.
import { RECITERS as RECITER_LIST } from "../../../../contracts/reciters";
import type { Count, CounterMetric, Stage } from "../admin-contract";
import { SNAPSHOT_METRICS, STAGES } from "../admin-contract";
import { parseRef } from "./recipe";

/** Distinct keys per metric per batch (event names are a fixed set and exempt); more fold into OTHER. */
export const PER_METRIC = 3;
/** Distinct (metric, dim) counters per batch. */
export const MAX_COUNTERS = 24;
/** Distinct keys per open metric per UTC day; later new keys fold into OTHER. */
export const DAY_KEYS = 300;
/** device_stage rows and the free-text counters are kept this long (the admin range is at most 90 days). */
export const KEEP_DAYS = 120;
/** The key for values outside a metric's known set or beyond its caps. */
export const OTHER = "other";
/** Metrics whose keys are not a small fixed set: capped at DAY_KEYS a day. */
export const OPEN_METRICS = new Set<CounterMetric>(["search", "search_click", "export_fail_reason", "export_translation", "export_ref"]);
/** Free-text metrics deleted after KEEP_DAYS (the other counters stay as history). */
const FREE_TEXT: CounterMetric[] = ["search", "search_click", "export_fail_reason"];

/** Reciter folders the app offers (contracts/reciters.ts). */
export const RECITERS = new Set(RECITER_LIST.map(([folder]) => folder));
const ORIENTATIONS = new Set(["portrait", "square", "landscape"]);
const SOURCES = new Set(["suggested", "library", "colour", "share"]);
const TRANSLATION = /^(none|[a-z]{2,3}\.[\w-]{1,40})$/; // as lib/recipe.ts

export type TallyEvent = { name: string; anon: string; props: Record<string, string | number> };
export type Origin = { country: string; device: string; browser: string };
export interface Tally {
  counters: Map<CounterMetric, Map<string, number>>;
  stages: { anon: string; stage: Stage }[];
}

const STAGE_OF: Record<string, Stage | undefined> = {
  app_open: "open", search: "search", ayah_select: "ayah", export_done: "export", share_native: "share", link_copy: "share",
};

/** A short, single-line key: control characters and runs of spaces become one space, trimmed, at most `max` chars. */
export function dim(s: unknown, max = 60): string {
  return typeof s === "string" ? s.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max).trim() : "";
}
/** Search query as counted: lower case, trimmed, spaces collapsed, at most 60 characters. */
export const normQuery = (q: unknown) => dim(q).toLowerCase();
/** export_failed reason as counted: lower-case first line, URLs as <url>, long numbers as #. */
export const shortReason = (r: unknown) =>
  dim(typeof r === "string" ? r.split("\n")[0].replace(/https?:\/\/\S+/g, "<url>").replace(/\d{4,}/g, "#") : "").toLowerCase() || "unknown";
/** A string prop as counted: "" when missing (not counted), itself when `known`, else OTHER. */
const known = (v: unknown, ok: (s: string) => boolean) => (typeof v !== "string" || !v ? "" : ok(v) ? v : OTHER);

const clamp = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), max) : 0);

/** Counters and funnel stages for one batch of valid events, with the caps above. `clips` = the known clip ids. */
export function tally(list: TallyEvent[], origin: Origin, clips: ReadonlySet<string>): Tally {
  const counters = new Map<CounterMetric, Map<string, number>>();
  let total = 0;
  const add = (metric: CounterMetric, key: string, value = 1) => {
    if (!key) return;
    let dims = counters.get(metric);
    if (metric !== "event" && !dims?.has(key) && (dims?.size ?? 0) >= PER_METRIC) key = OTHER;
    if (dims?.has(key)) return void dims.set(key, dims.get(key)! + value);
    if (total >= MAX_COUNTERS) return;
    if (!dims) counters.set(metric, (dims = new Map()));
    dims.set(key, value);
    total++;
  };
  const clip = (v: unknown) => known(v, (s) => s === "colour" || clips.has(s));
  const kind = (v: unknown) => (v === "video" || v === "image" ? v : OTHER);

  for (const e of list) add("event", e.name); // first, so the caps never drop an event name
  for (const { name, props: p } of list) {
    if (name === "export_done") {
      add("export", kind(p.kind));
      add("export_ms", kind(p.kind), clamp(p.ms, 3_600_000));
      add("export_bytes", kind(p.kind), clamp(p.bytes, 4e9));
      const ref = parseRef(p.ref);
      if (ref) {
        add("export_ref", ref);
        add("export_surah", ref.split(":")[0]);
      }
      add("export_reciter", known(p.reciter, (s) => RECITERS.has(s)));
      add("export_translation", known(p.translation, (s) => TRANSLATION.test(s)));
      add("export_orientation", known(p.orientation, (s) => ORIENTATIONS.has(s)));
      add("export_clip", clip(p.clip));
    } else if (name === "export_failed") {
      add("export_fail", kind(p.kind));
      add("export_fail_reason", shortReason(p.reason));
    } else if (name === "search") add("search", normQuery(p.q));
    else if (name === "search_click") add("search_click", normQuery(p.q));
    else if (name === "bg_select") {
      add("bg_source", known(p.source, (s) => SOURCES.has(s)));
      add("bg_clip", clip(p.clip));
    } else if (name === "app_open") {
      add("open_device", origin.device);
      add("open_browser", origin.browser);
      add("open_country", dim(origin.country, 8) || "XX");
    }
  }

  const anon = list[0]?.anon;
  const stages = [...new Set(list.flatMap((e) => (e.anon === anon && STAGE_OF[e.name]) || []))].map((stage) => ({ anon, stage }));
  return { counters, stages };
}

export const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const UPSERT = "ON CONFLICT (day, metric, dim) DO UPDATE SET value = daily_stats.value + excluded.value";
const EXISTS = "EXISTS (SELECT 1 FROM daily_stats s WHERE s.day = ?1 AND s.metric = v.column1 AND s.dim = v.column2)";

/** Statements adding a tally to `day`: multi-row statements under D1's 100 bound parameters (?1 = day). Open metrics
 *  take two: the first adds the batch's new keys to day_keys, the second keeps a new key only while that count is
 *  within DAY_KEYS (else it counts as OTHER). */
export function tallyStatements(db: D1Database, day: string, t: Tally): D1PreparedStatement[] {
  const rows = [...t.counters].flatMap(([metric, dims]) => [...dims].map(([key, value]) => [metric, key, value] as const));
  const values = (n: number, width: number, from: number) =>
    Array.from({ length: n }, (_, i) => `(${Array.from({ length: width }, (_, j) => `?${from + width * i + j}`).join(", ")})`).join(", ");
  return [
    ...chunks(rows.filter(([m]) => !OPEN_METRICS.has(m)), 33).map((part) => db.prepare(
      `INSERT INTO daily_stats (day, metric, dim, value) VALUES ${part.map((_, i) => `(?1, ?${3 * i + 2}, ?${3 * i + 3}, ?${3 * i + 4})`).join(", ")} ${UPSERT}`,
    ).bind(day, ...part.flat())),
    ...chunks(rows.filter(([m]) => OPEN_METRICS.has(m)), 32).flatMap((part) => [
      db.prepare(
        `INSERT INTO daily_stats (day, metric, dim, value)
         SELECT ?1, 'day_keys', v.column1, COUNT(*) FROM (VALUES ${values(part.length, 2, 2)}) AS v
         WHERE v.column2 != '${OTHER}' AND NOT ${EXISTS} GROUP BY v.column1 ${UPSERT}`,
      ).bind(day, ...part.flatMap(([metric, key]) => [metric, key])),
      db.prepare(
        `INSERT INTO daily_stats (day, metric, dim, value)
         SELECT ?1, v.column1, CASE WHEN v.column2 = '${OTHER}' OR ${EXISTS}
           OR (SELECT k.value FROM daily_stats k WHERE k.day = ?1 AND k.metric = 'day_keys' AND k.dim = v.column1) <= ?2
           THEN v.column2 ELSE '${OTHER}' END, v.column3
         FROM (VALUES ${values(part.length, 3, 3)}) AS v WHERE true ${UPSERT}`,
      ).bind(day, DAY_KEYS, ...part.flat()),
    ]),
    ...chunks(t.stages, 49).map((part) => db.prepare(
      `INSERT OR IGNORE INTO device_stage (day, anon, stage) VALUES ${part.map((_, i) => `(?1, ?${2 * i + 2}, ?${2 * i + 3})`).join(", ")}`,
    ).bind(day, ...part.flatMap((s) => [s.anon, s.stage]))),
  ];
}

// ---- reading (admin API) ----

const DAY = 86400_000;
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export type Range = { from: string; to: string };

/** The last `days` UTC days up to and including today. */
export const dayRange = (days: number, now = Date.now()): Range => ({ from: utcDay(now - (days - 1) * DAY), to: utcDay(now) });

/** True once any event has been counted. */
export const countersExist = async (db: D1Database) =>
  !!(await db.prepare("SELECT 1 AS n FROM daily_stats WHERE metric = 'event' LIMIT 1").first());

/** The top `limit` dims of each metric over the range (sums), in one statement. */
export async function tops<M extends CounterMetric>(db: D1Database, metrics: M[], r: Range, limit: number): Promise<Record<M, Count[]>> {
  const { results } = await db.prepare(
    `SELECT metric, key, n FROM (
       SELECT metric, dim AS key, SUM(value) AS n, ROW_NUMBER() OVER (PARTITION BY metric ORDER BY SUM(value) DESC, dim) AS rank
       FROM daily_stats WHERE metric IN (${metrics.map((_, i) => `?${i + 4}`).join(", ")}) AND day BETWEEN ?1 AND ?2 GROUP BY metric, dim
     ) WHERE rank <= ?3 ORDER BY metric, rank`,
  ).bind(r.from, r.to, limit, ...metrics).all<{ metric: M; key: string; n: number }>();
  const out = Object.fromEntries(metrics.map((m) => [m, [] as Count[]])) as Record<M, Count[]>;
  for (const row of results) out[row.metric].push({ key: row.key, n: row.n });
  return out;
}

/** Searches whose normalised query had no search_click in the range, most asked first (OTHER left out). */
export async function noClickSearches(db: D1Database, r: Range, limit: number): Promise<Count[]> {
  const { results } = await db.prepare(
    `SELECT dim AS key, SUM(CASE WHEN metric = 'search' THEN value ELSE 0 END) AS n FROM daily_stats
     WHERE metric IN ('search', 'search_click') AND day BETWEEN ?1 AND ?2 AND dim != '${OTHER}'
     GROUP BY dim HAVING n > 0 AND SUM(metric = 'search_click') = 0 ORDER BY n DESC, key LIMIT ?3`,
  ).bind(r.from, r.to, limit).all<Count>();
  return results;
}

/** Distinct devices per funnel stage over the range. */
export async function funnel(db: D1Database, r: Range): Promise<Record<Stage, number>> {
  const { results } = await db.prepare("SELECT stage, COUNT(DISTINCT anon) AS n FROM device_stage WHERE day BETWEEN ?1 AND ?2 GROUP BY stage")
    .bind(r.from, r.to).all<{ stage: Stage; n: number }>();
  const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const row of results) if (row.stage in out) out[row.stage] = row.n;
  return out;
}

/** Per-day series (contract AdminOverview.daily): snapshot metrics, events / exports / failures by key, funnel stages. */
export async function dailySeries(db: D1Database, r: Range): Promise<Record<string, { day: string; value: number }[]>> {
  const snapshot = Object.keys(SNAPSHOT_METRICS);
  const [stats, stages] = await db.batch<{ day: string; key: string; value: number }>([
    db.prepare(
      `SELECT day, CASE WHEN dim = '' THEN metric ELSE metric || ':' || dim END AS key, value FROM daily_stats
       WHERE metric IN ('event', 'export', 'export_fail', ${snapshot.map((_, i) => `?${i + 3}`).join(", ")}) AND day BETWEEN ?1 AND ?2 ORDER BY day`,
    ).bind(r.from, r.to, ...snapshot),
    db.prepare("SELECT day, 'funnel:' || stage AS key, COUNT(*) AS value FROM device_stage WHERE day BETWEEN ?1 AND ?2 GROUP BY day, stage ORDER BY day")
      .bind(r.from, r.to),
  ]);
  const series: Record<string, { day: string; value: number }[]> = {};
  for (const row of [...stats.results, ...stages.results]) (series[row.key] ??= []).push({ day: row.day, value: row.value });
  return series;
}

/** bg_select count per clip id over the range. */
export async function clipUses(db: D1Database, r: Range): Promise<Map<string, number>> {
  const { results } = await db.prepare("SELECT dim AS key, SUM(value) AS n FROM daily_stats WHERE metric = 'bg_clip' AND day BETWEEN ?1 AND ?2 GROUP BY dim")
    .bind(r.from, r.to).all<Count>();
  return new Map(results.map((row) => [row.key, row.n]));
}

/** Nightly: drops device_stage days and free-text counters (with the day_keys counts) older than KEEP_DAYS. */
export function pruneStatements(db: D1Database, now = Date.now()): D1PreparedStatement[] {
  const before = utcDay(now - KEEP_DAYS * DAY);
  return [
    db.prepare("DELETE FROM device_stage WHERE day < ?").bind(before),
    db.prepare(`DELETE FROM daily_stats WHERE metric IN (${[...FREE_TEXT, "day_keys"].map((m) => `'${m}'`).join(", ")}) AND day < ?`).bind(before),
  ];
}
