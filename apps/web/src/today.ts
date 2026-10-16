// Today's ayah (owner, 12 Oct 2026): one ayah a day for everyone, to watch, share and be reminded of.
// The day's ayah is the admin's pick for that local date (GET /api/daily, the admin's Daily ayah page) or else the app's
// own pick (discover.ts loadAyahOfTheDay: the same for everyone on that date). Home's "Watch today's ayah", Discover's
// card and the daily reminder all use dayAyah, so they always agree.
// The daily reminder: in the app, local notifications the device shows by itself at the chosen time, for the next
// REMINDER_DAYS days, each with that day's ayah, scheduled again whenever the app opens on a new day so the window keeps
// rolling (platform-native.ts); on the web, Web Push the Worker sends at that time (webpush.ts). Its setting is kept on
// the device. Framework-free.
import type { Ref, Surah } from "../../../contracts/types";
import { track } from "./analytics";
import * as api from "./api";
import { backgroundFor, loadAyahOfTheDay, loadText, type DayAyah } from "./discover";
import { reelFor, startReelsAt } from "./feed";
import { platform, type Reminders } from "./platform";
import { t } from "./strings";
import { webReminders } from "./webpush";

/** The reminder this device can have: the app's local notifications, else the web's push, else none. */
const reminders = (): Reminders | undefined => platform.reminders ?? webReminders();
/** "Remind me" is offered (Reels' today header). */
export const remindersAvailable = () => !!reminders();

/** A local date as YYYY-MM-DD (the person's day, not UTC). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Days ahead the reminders are scheduled (and the admin's picks asked for). */
export const REMINDER_DAYS = 7;

// ---------- the day's ayah ----------

let picks: { from: string; at: number; days: Promise<Map<string, Ref>> } | null = null;
const PICKS_MS = 30 * 60_000;
/** The admin's picks from today on (kept half an hour; none when they cannot be loaded). */
function adminPicks(now: Date): Promise<Map<string, Ref>> {
  const from = dayKey(now);
  if (!picks || picks.from !== from || Date.now() - picks.at > PICKS_MS) {
    const days = Promise.resolve()
      .then(() => api.getDailyPicks(from, REMINDER_DAYS + 1))
      .then((r) => new Map((r?.picks ?? []).map((p) => [p.day, p.ref] as [string, Ref])), () => new Map<string, Ref>());
    picks = { from, at: Date.now(), days };
  }
  return picks.days;
}
/** For tests: forget the picks loaded. */
export const resetDayAyah = () => { picks = null; };

/** The ayah of `date` (a local day): the admin's pick, else the app's own. null when nothing loads. */
export async function dayAyah(date: Date, translation: string): Promise<DayAyah | null> {
  const ref = (await adminPicks(new Date())).get(dayKey(date));
  if (ref) {
    try {
      const [text, picked] = await Promise.all([loadText(ref, translation), backgroundFor(ref)]);
      return { ref, ...text, bg: picked.bg, clip: picked.clip };
    } catch { /* the app's own pick */ }
  }
  const file = await api.getTopics();
  return loadAyahOfTheDay(file.topics, date, translation);
}

/** Today's ayah was watched today (this device, local date), from Home, Discover or the reminder: Home's button becomes
 *  "Create new" and Discover's card "Watch again". A new day starts over. */
const WATCHED_KEY = "qd.todayWatched";
export const watchedOn = (d: Date) => { try { return localStorage.getItem(WATCHED_KEY) === dayKey(d); } catch { return false; } };
export const watchedToday = () => watchedOn(new Date());
const rememberWatched = () => { try { localStorage.setItem(WATCHED_KEY, dayKey(new Date())); } catch { /* the buttons stay "Watch" / "View" */ } };

/** Opens Reels on today's ayah (its own reel, with the day and "Remind me" on top), and remembers it was watched today.
 *  Resolves false when it cannot load. */
export async function openToday(translation: string, from: "home" | "reminder" | "discover" | "activity"): Promise<boolean> {
  const day = await dayAyah(new Date(), translation).catch(() => null);
  if (!day) return false;
  startReelsAt([{ item: reelFor(day.ref, { kind: "today" }, 0), bg: day.bg }], 0);
  rememberWatched();
  track("today_seen", { ref: day.ref, key: from });
  if (from === "reminder") track("today_opened", { ref: day.ref });
  return true;
}

// ---------- the daily reminder ----------

export interface ReminderSetting { on: boolean; time: string }
const KEY = "qd.reminder", SCHEDULED_KEY = "qd.reminderScheduled";
export const DEFAULT_TIME = "07:00";
/** The times the reminder sheet offers first (the person can choose any other). */
export const REMINDER_TIMES = ["07:00", "13:00", "20:00"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function reminderSetting(): ReminderSetting {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ReminderSetting> | null;
    return { on: s?.on === true, time: typeof s?.time === "string" && TIME.test(s.time) ? s.time : DEFAULT_TIME };
  } catch { return { on: false, time: DEFAULT_TIME }; }
}
const saveSetting = (s: ReminderSetting) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* kept for this visit only */ } };

/** "7:00" for "07:00" (the way the sheet and the button show a time). */
export const shownTime = (time: string) => time.replace(/^0(\d)/, "$1");

/** The reminders for the next REMINDER_DAYS days at `time`, from `now` (a time already past today starts tomorrow). */
export async function remindersFrom(now: Date, time: string, translation: string, surahs: Surah[]) {
  const [h, m] = time.split(":").map(Number);
  const out: { id: number; at: Date; title: string; body: string }[] = [];
  for (let i = 0; i <= REMINDER_DAYS && out.length < REMINDER_DAYS; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m);
    if (at.getTime() <= now.getTime()) continue;
    const day = await dayAyah(at, translation).catch(() => null);
    const name = day ? surahs[Number(day.ref.split(":")[0]) - 1]?.name_en ?? "" : "";
    out.push({
      id: 7000 + out.length, at,
      title: day ? t.reminderTitle(name, day.ref) : t.reminderTitle("", ""),
      body: day?.tr ? clip(day.tr, 180) : t.reminderBody,
    });
  }
  return out;
}
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Schedules the coming reminders when the reminder is on (else removes them). `force`: even if done today already. */
export async function scheduleReminders(translation: string, surahs: Surah[], force = false): Promise<void> {
  const r = reminders();
  if (!r) return;
  const s = reminderSetting();
  if (!s.on) return void (await r.cancel().catch(() => {}));
  const stamp = `${dayKey(new Date())} ${s.time} ${translation}`;
  if (!force && (() => { try { return localStorage.getItem(SCHEDULED_KEY) === stamp; } catch { return false; } })()) return;
  // The web's push needs only the time (the server writes the message); the app is given each day's reminder.
  await r.schedule(r.kind === "push" ? [] : await remindersFrom(new Date(), s.time, translation, surahs), s.time);
  try { localStorage.setItem(SCHEDULED_KEY, stamp); } catch { /* scheduled again next time */ }
}

/** Turns the reminder on at `time` (asking for permission first): "on", "denied" (notifications not allowed) or
 *  "failed" (it could not be set up, e.g. offline on the web; the setting stays as it was). */
export async function turnOnReminder(time: string, translation: string, surahs: Surah[]): Promise<"on" | "denied" | "failed"> {
  const r = reminders();
  if (!r || !(await r.allow().catch(() => false))) return "denied";
  const was = reminderSetting();
  saveSetting({ on: true, time });
  try {
    await scheduleReminders(translation, surahs, true);
  } catch {
    saveSetting(was);
    return "failed";
  }
  if (!was.on) track("reminder_on");
  return "on";
}

export async function turnOffReminder(): Promise<void> {
  if (reminderSetting().on) track("reminder_off");
  saveSetting({ ...reminderSetting(), on: false });
  try { localStorage.removeItem(SCHEDULED_KEY); } catch { /* nothing to forget */ }
  await reminders()?.cancel().catch(() => {});
}
