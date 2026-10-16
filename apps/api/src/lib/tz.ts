// Wall-clock time in an IANA zone, for the web's daily reminder (owner, 12 Oct 2026): the person picks "07:00" in their
// own zone, and the Worker (UTC) works out when that is. Offsets come from Intl.DateTimeFormat for the target day itself,
// so a reminder follows daylight saving changes. Each local date maps to exactly one instant (a time skipped by a DST
// jump lands an hour off, a repeated time on its first occurrence), so a reminder never fires twice on one date.

const formats = new Map<string, Intl.DateTimeFormat>();
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formats.set(tz, f);
  }
  return f;
}

/** True for an IANA zone name Intl knows ("Asia/Kolkata", "UTC"). */
export function validZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    format(tz);
    return true;
  } catch {
    return false;
  }
}

/** True for "HH:MM" (00:00 to 23:59). */
export const validTime = (time: unknown): time is string => typeof time === "string" && TIME.test(time);

/** The wall clock in `tz` at instant `t`, as if it were UTC (ms, whole seconds). */
function wall(t: number, tz: string): number {
  const p = Object.fromEntries(format(tz).formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** The zone's offset from UTC at instant `t` (ms; +5:30 → 19800000). */
const offset = (t: number, tz: string) => wall(t, tz) - (t - (((t % 1000) + 1000) % 1000));

/** "YYYY-MM-DD", the local date in `tz` at instant `t`. */
export const localDay = (t: number, tz: string) => new Date(wall(t, tz)).toISOString().slice(0, 10);

/** The instant when the wall clock in `tz` shows `local` (a wall time written as a UTC ms value). */
function toUtc(local: number, tz: string): number {
  const first = local - offset(local, tz);
  return local - offset(first, tz); // again with the offset in force at that moment (DST)
}

/** The first instant after `after` (ms) at which the wall clock in `tz` reads `time` ("HH:MM"). */
export function nextSendAt(time: string, tz: string, after: number): number {
  const m = time.match(TIME);
  if (!m) throw new Error(`bad time ${time}`);
  const today = new Date(wall(after, tz));
  for (let k = 0; k <= 2; k++) {
    const t = toUtc(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + k, Number(m[1]), Number(m[2])), tz);
    if (t > after) return t;
  }
  throw new Error("unreachable"); // tomorrow's time is always within 2 days of now
}
