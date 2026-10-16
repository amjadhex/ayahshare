// The private streak: days in a row on which the person shared or made at least one ayah. Kept on this device only
// (never shown to anyone else, no leaderboard). A day is the person's local calendar day. Framework-free; the UI reads it
// with useStreak (ui/hooks.ts) and calls recordDay() when a share, a saved file or a copied link completes.
//
// Everything shown (current streak, best, total, the calendar) is computed from the list of active days, never from
// separate counters, so nothing can drift. Only history older than ~3 years is dropped, and its totals are kept (below).
//
// The grace rule: one missed day does not break a streak. A single day with no activity between two active days is
// forgiven (a "rest day") unless another rest day lies within the 6 days before it, so at most one per any 7 days.
// Two missed days in a row, or a second single gap inside 7 days, end the streak; the next active day starts a new one
// with a clean slate. A rest day only keeps the chain: it never counts as an active day (not in the streak, the best or
// the total). Today being empty never breaks anything: the streak stays alive through today, and also when only
// yesterday is missing and would be forgiven once today is done.

const KEY = "ayahshare.streak.v2";
const KEY_V1 = "ayahshare.streak.v1"; // { days: string[] }, capped at 400 days; moved to v2 on first load
const KEEP_DAYS = 1095; // ~3 years of history are kept; a streak still running is never cut
const REST_SPACING = 7; // rest days are at least this many days apart
const MS_DAY = 86400_000;

/** Weeks the calendar shows. */
export const WEEKS = 16;
export const MILESTONES = [7, 30, 100, 365]; // then every further 365

/** v2: sorted, unique local dates (YYYY-MM-DD) with activity, plus the totals of the days dropped when pruning. */
interface Stored { v: 2; days: string[]; oldDays: number; oldBest: number }
interface Old { days: number; best: number }
export type DayState = "none" | "done" | "rest";
export interface Streak {
  /** Active days in the streak that is still alive; 0 when there is none (never started, or it ended). */
  days: number;
  /** Something was done today. */
  today: boolean;
  /** The longest streak ever (active days; never less than `days`). */
  best: number;
  /** Active days ever. */
  total: number;
  /** Yesterday was missed but is forgiven once today is done: the streak is alive and needs today. */
  missedYesterday: boolean;
  /** The last WEEKS * 7 days, oldest first, today last. */
  cells: DayState[];
}

// Days are counted as whole numbers of calendar days (the local date read as if it were UTC), so DST, 23/25-hour days
// and month lengths cannot shift a day.
const ordOf = (y: number, m: number, d: number) => Date.UTC(y, m, d) / MS_DAY;
const ordOfDate = (d: Date) => ordOf(d.getFullYear(), d.getMonth(), d.getDate());
const fmt = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const keyOfOrd = (n: number) => { const d = new Date(n * MS_DAY); return fmt(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const dayKey = (d: Date) => fmt(d.getFullYear(), d.getMonth(), d.getDate());
function ordOfKey(k: unknown): number | null {
  const m = typeof k === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(k) : null;
  if (!m) return null;
  const n = ordOf(+m[1], +m[2] - 1, +m[3]);
  return keyOfOrd(n) === k ? n : null; // rejects 2026-02-30 and the like
}
/** Valid dates only, unique, oldest first. */
const clean = (keys: unknown): number[] =>
  [...new Set((Array.isArray(keys) ? keys : []).map(ordOfKey).filter((n): n is number => n !== null))].sort((a, b) => a - b);
const count = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0);

interface Run { start: number; end: number; active: number; rests: number[] }
const canRest = (r: Run, day: number) => r.rests.length === 0 || day - r.rests[r.rests.length - 1] >= REST_SPACING;

/** The streaks in these active days (day numbers, oldest first), applying the grace rule. */
function runsOf(ords: number[]): Run[] {
  const runs: Run[] = [];
  for (const o of ords) {
    const r = runs[runs.length - 1];
    if (r && o === r.end + 1) { r.end = o; r.active++; }
    else if (r && o === r.end + 2 && canRest(r, o - 1)) { r.rests.push(o - 1); r.end = o; r.active++; }
    else runs.push({ start: o, end: o, active: 1, rests: [] });
  }
  return runs;
}

/** Drops the streaks that ended more than KEEP_DAYS ago, adding their days and best to the old totals. Only whole
 *  streaks go, so counting from the first kept day gives exactly what counting from the beginning would. */
function prune(ords: number[], old: Old, today: number): { ords: number[]; old: Old } {
  const runs = runsOf(ords);
  let cut = 0, days = old.days, best = old.best;
  while (cut < runs.length && runs[cut].end < today - KEEP_DAYS) { days += runs[cut].active; best = Math.max(best, runs[cut].active); cut++; }
  if (!cut) return { ords, old };
  const from = cut < runs.length ? runs[cut].start : Infinity;
  return { ords: ords.filter((o) => o >= from), old: { days, best } };
}

function read(key: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}
function write(s: Stored): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; /* private mode: this visit only */ }
}
const build = (days: unknown, oldDays?: unknown, oldBest?: unknown): Stored =>
  ({ v: 2, days: clean(days).map(keyOfOrd), oldDays: count(oldDays), oldBest: count(oldBest) });

function load(): Stored {
  const v2 = read(KEY);
  if (v2) return build(v2.days, v2.oldDays, v2.oldBest);
  const v1 = read(KEY_V1);
  const s = build(v1?.days);
  // The old list moves over once; it is removed only after the new one is safely stored.
  if (v1 && write(s)) try { localStorage.removeItem(KEY_V1); } catch { /* it is only ignored from now on */ }
  return s;
}

let stored = load();
let cached: { day: string; value: Streak } | null = null;
const listeners = new Set<() => void>();
const changed = () => { cached = null; for (const fn of [...listeners]) fn(); };

/** The streak as of `now`, from the active days (YYYY-MM-DD) and the totals of any days dropped long ago. */
export function computeStreak(days: string[], now = new Date(), old: Old = { days: 0, best: 0 }): Streak {
  const ords = clean(days), set = new Set(ords), today = ordOfDate(now);
  const runs = runsOf(ords), last = runs[runs.length - 1];
  const missedYesterday = !!last && last.end === today - 2 && canRest(last, today - 1);
  const alive = last !== undefined && (last.end >= today - 1 || missedYesterday);
  const rest = new Set(runs.flatMap((r) => r.rests));
  if (missedYesterday) rest.add(today - 1);
  const cells = Array.from({ length: WEEKS * 7 }, (_, i): DayState => {
    const o = today - WEEKS * 7 + 1 + i;
    return set.has(o) ? "done" : rest.has(o) ? "rest" : "none";
  });
  return {
    days: last && alive ? last.active : 0,
    today: set.has(today),
    best: Math.max(old.best, ...runs.map((r) => r.active)),
    total: old.days + ords.length,
    missedYesterday,
    cells,
  };
}

/** The next milestone above n days: 7, 30, 100, 365, then every further 365. */
export const nextMilestone = (n: number) => MILESTONES.find((m) => m > n) ?? (Math.floor(n / 365) + 1) * 365;

export function getStreak(): Streak {
  const day = dayKey(new Date()); // a new day (the app left open overnight) needs a fresh answer
  if (cached?.day !== day) cached = { day, value: computeStreak(stored.days, new Date(), { days: stored.oldDays, best: stored.oldBest }) };
  return cached.value;
}

export function subscribeStreak(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Stores these days (YYYY-MM-DD): sorted, unique, and without the history older than ~3 years (its totals stay). */
function commit(keys: string[], now: Date) {
  const p = prune(clean(keys), { days: stored.oldDays, best: stored.oldBest }, ordOfDate(now));
  stored = { v: 2, days: p.ords.map(keyOfOrd), oldDays: p.old.days, oldBest: p.old.best };
  write(stored);
}

/** Marks today as done (a share, a saved file or a copied link). Safe to call more than once a day. */
export function recordDay(now = new Date()) {
  const k = dayKey(now);
  if (!stored.days.includes(k)) commit([...stored.days, k], now);
  changed();
}

/** Adds the local days of these times (ms): when saved designs were made (Profile), so the streak also knows days on
 *  which designs were saved on another device or before this streak existed. Only adds; never removes a day. */
export function recordDays(times: number[]) {
  const have = new Set(stored.days);
  const add = [...new Set(times.filter((ms) => Number.isFinite(ms) && ms > 0 && ms <= Date.now() + 86400_000).map((ms) => dayKey(new Date(ms))))]
    .filter((k) => !have.has(k));
  if (!add.length) return;
  commit([...stored.days, ...add], new Date());
  changed();
}

/** Tests only. */
export function resetStreak(days: string[] = []) {
  stored = build(days);
  write(stored);
  cached = null;
}
