// The bell on Home shows a dot when Notifications has something new since it was last opened (owner, 12 Oct 2026): a
// new day (its ayah, not watched yet), more opens, reshares or designs from the person's links, or a newer announcement
// from AyahShare. Kept on this device only. Framework-free.
import type { ImpactResponse } from "../../../contracts/types";
import { dayKey, watchedOn } from "./today";

const KEY = "qd.activitySeen";
interface Seen { day: string; opens: number; reshares: number; makes: number; news?: number }

function read(): Seen | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null") as Seen | null; } catch { return null; }
}

/** Notifications was opened now, showing `impact` (null: signed out or not loaded) and the newest announcement `news`
 *  (its id; 0 or less: none). */
export function markActivitySeen(impact: ImpactResponse | null, now = new Date(), news = 0) {
  const old = read();
  const seen: Seen = {
    day: dayKey(now),
    opens: impact?.opens ?? old?.opens ?? 0, reshares: impact?.reshares ?? old?.reshares ?? 0, makes: impact?.makes ?? old?.makes ?? 0,
    news: Math.max(news, old?.news ?? 0),
  };
  try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch { /* the dot shows again next time */ }
}

/** Something new since Notifications was last opened (`news`: the newest announcement's id). */
export function activityHasNew(impact: ImpactResponse | null, now = new Date(), news = 0): boolean {
  const seen = read();
  if ((!seen || seen.day !== dayKey(now)) && !watchedOn(now)) return true;
  if (news > (seen?.news ?? 0)) return true;
  if (!impact) return false;
  return impact.opens > (seen?.opens ?? 0) || impact.reshares > (seen?.reshares ?? 0) || impact.makes > (seen?.makes ?? 0);
}
