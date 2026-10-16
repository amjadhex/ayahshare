// Play a whole surah (owner, 12 Oct 2026; the "Play a surah" canvas): a surah picked in Discover plays in Reels from its
// first ayah (or where the person stopped) to its last, each reel going on to the next by itself. A reel is an ayah with
// the ayahs its meaning needs (groups.ts), like any reel, with its own background; one reciter for the whole surah.
// Where the person stopped is kept on the device (one surah: the last played), so Discover can offer "Continue".
// Framework-free.
import type { Surah } from "../../../contracts/types";
import * as api from "./api";
import { DEFAULT_RECIPE, RECITERS } from "./config";
import { reelFor, type FeedItem } from "./feed";
import { withGroups } from "./groups";
import { navigate } from "./router";

/** The surahs Discover's row offers first: Al-Mulk, Ya-Sin, Al-Kahf, Ar-Rahman, Al-Waqi'ah. */
export const POPULAR_SURAHS = [67, 36, 18, 55, 56] as const;

/** The reels of `surah` in order from the reel holding ayah `from`: each an ayah widened to its group. */
export function surahItems(surah: Surah, from = 1): FeedItem[] {
  const items: FeedItem[] = [];
  let a = withGroups(surah.n, Math.min(Math.max(1, from), surah.ayahs), Math.min(Math.max(1, from), surah.ayahs)).from;
  while (a <= surah.ayahs) {
    const g = withGroups(surah.n, a, a), to = Math.min(surah.ayahs, Math.max(a, g.to));
    items.push({ ...reelFor(`${surah.n}:${a}`, { kind: "surah", surah: surah.n }, items.length, to), key: `${surah.n}:${a}#surah` });
    a = to + 1;
  }
  return items;
}

// ---------- where the person stopped ----------

export interface SurahProgress { surah: number; ayah: number; reciter: string }
const PROGRESS_KEY = "qd.surahProgress", RECITER_KEY = "qd.surahReciter";

/** The surah last played and the ayah it was at; null when none, or it was played to the end. */
export function surahProgress(): SurahProgress | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null") as Partial<SurahProgress> | null;
    return p && Number.isInteger(p.surah) && Number.isInteger(p.ayah) && typeof p.reciter === "string"
      ? { surah: p.surah!, ayah: p.ayah!, reciter: p.reciter } : null;
  } catch { return null; }
}
export function saveSurahProgress(p: SurahProgress | null) {
  try { if (p) localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); else localStorage.removeItem(PROGRESS_KEY); } catch { /* this visit only */ }
}

/** The reciter whole surahs play with: the one chosen in All surahs, else the person's own, else the app's first. */
export function surahReciter(own?: string): string {
  let chosen: string | null = null;
  try { chosen = localStorage.getItem(RECITER_KEY); } catch { /* none */ }
  const ok = (f: string | null | undefined): f is string => !!f && RECITERS.some(([r]) => r === f);
  return ok(chosen) ? chosen : ok(own) ? own : DEFAULT_RECIPE.reciter;
}
export function setSurahReciter(folder: string) {
  try { localStorage.setItem(RECITER_KEY, folder); } catch { /* this visit only */ }
}

// ---------- handing the surah to Reels ----------

export interface SurahSession { surah: Surah; reciter: string; items: FeedItem[] }
let handedOver: SurahSession | null = null;
export const hasSurahStart = () => handedOver !== null;
/** Reels takes the surah handed over (once). */
export function takeSurahStart(): SurahSession | null {
  const s = handedOver;
  handedOver = null;
  return s;
}

export interface SurahOptions { from?: number; reciter?: string; own?: string }
/** `surah` from ayah `from` (default: where the person stopped in it, else the first), with its reciter (default: the
 *  one it was being played with, else surahReciter). */
export async function surahSession(surah: Surah, opts: SurahOptions = {}): Promise<SurahSession> {
  await api.loadAyahGroups();
  const p = surahProgress(), resume = p?.surah === surah.n && opts.from === undefined ? p : null;
  const reciter = opts.reciter ?? resume?.reciter ?? surahReciter(opts.own);
  return { surah, reciter, items: surahItems(surah, opts.from ?? resume?.ayah ?? 1) };
}

/** Opens Reels on `surah` (surahSession). */
export async function openSurah(surah: Surah, opts: SurahOptions = {}): Promise<void> {
  handedOver = await surahSession(surah, opts);
  navigate("feed");
}
