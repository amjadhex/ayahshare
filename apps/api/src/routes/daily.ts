// GET /api/daily?from=YYYY-MM-DD&days=N (1..31, default 14; from defaults to today, UTC) → contracts DailyPicks: the days
// an admin chose Today's ayah for (admin Daily ayah, table daily_ayah). Every other day is the app's own pick, made on the
// device (apps/web src/discover.ts), so most days are missing here. Same for everyone; the app asks once and keeps it for
// five minutes. Days are the person's local date, as the app sends them.
import { Hono } from "hono";
import type { DailyPicks, Ref, Surah } from "../../../../contracts/types";
import { readData } from "../lib/data";
import { parseRef } from "../lib/recipe";
import { utcDay } from "../lib/stats";

export const DAY = 86400_000;
export const MAX_DAYS = 31;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-12" when it is a real calendar date, else null. */
export const parseDay = (v: unknown): string | null => {
  const ms = typeof v === "string" && DAY_FORMAT.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN; // 2026-02-30 and month 13 are NaN or roll over
  return Number.isNaN(ms) || utcDay(ms) !== v ? null : (v as string);
};

/** The day `n` days after `day` (n may be negative). */
export const addDays = (day: string, n: number) => utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY);

/** `from` and `days` from the query, or null when either is present and invalid. */
export function rangeParams(query: (name: string) => string | undefined): { from: string; days: number } | null {
  const from = query("from") === undefined ? utcDay(Date.now()) : parseDay(query("from"));
  const raw = query("days");
  const days = raw === undefined ? 14 : /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
  return from && days >= 1 && days <= MAX_DAYS ? { from, days } : null;
}

/** "2:255" when it is an ayah of the Quran (checked against the surah's ayah count when surahs.json is published). */
export async function existingRef(env: Env, v: unknown): Promise<Ref | null> {
  const ref = parseRef(v);
  if (!ref) return null;
  const [surah, ayah] = ref.split(":").map(Number);
  const surahs = await readData<Surah[]>(env, "surahs.json");
  return ayah <= (surahs?.[surah - 1]?.ayahs ?? 286) ? ref : null;
}

/** The admin picks from `from` for `days` days, oldest first. */
export async function picksIn(db: D1Database, from: string, days: number) {
  const { results } = await db.prepare("SELECT day, ref, set_at AS at FROM daily_ayah WHERE day BETWEEN ?1 AND ?2 ORDER BY day")
    .bind(from, addDays(from, days - 1)).all<{ day: string; ref: Ref; at: number }>();
  return results;
}

export const daily = new Hono<{ Bindings: Env }>();

daily.get("/", async (c) => {
  const range = rangeParams((name) => c.req.query(name));
  if (!range) return c.json({ error: "from must be YYYY-MM-DD and days 1 to 31" }, 400);
  const picks = (await picksIn(c.env.DB, range.from, range.days)).map(({ day, ref }) => ({ day, ref }));
  return c.json<DailyPicks>({ picks }, 200, { "Cache-Control": "public, max-age=300" });
});
