// What the screens hand each other when they move: the search the Results screen shows (from Home, a Discover story or
// a collection) and where the ayah picker starts (Create, or "Choose different ayahs" in the editor). Framework-free;
// the screens read it with useSearchQuery / usePickStart (ui/hooks.ts).
import { navigate } from "./router";

export interface PickStart { surah: number; from?: number; to?: number }

/** A search Results shows. `surah`: a surah chip (Friday's Al-Kahf), which shows the whole surah in order, page by page
 *  (owner, 16 Oct 2026; topic searches keep their ranked order). Every open is a new object, so tapping the same chip
 *  again searches again. */
export interface Search { q: string; surah?: number }
let search: Search = { q: "" };
let pickStart: PickStart | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const fn of [...listeners]) fn(); };

export const getQuery = () => search.q;
export const getSearch = () => search;
export const getPickStart = () => pickStart;
export function subscribeNav(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

let storiesPlaying = false;
/** Discover is playing its stories (dark, full screen) rather than showing Browse; the page colours follow (ui/App.tsx). */
export const getStoriesPlaying = () => storiesPlaying;
export function setStoriesPlaying(on: boolean) {
  if (storiesPlaying === on) return;
  storiesPlaying = on;
  emit();
}

/** Shows the Results screen for `q` (a feeling in any language, a topic, or a reference like 2:255). */
export function openSearch(q: string, opts: Omit<Search, "q"> = {}) {
  const next = q.trim();
  if (!next) return;
  search = { q: next, ...opts };
  emit();
  navigate("results");
}

/** Changes the search shown on Results without leaving it (the refine box). */
export function setQuery(q: string) {
  search = { q: q.trim() };
  emit();
}

const retaps = new Set<(tab: string) => void>();
/** The tab already open was tapped again (Reels: back to the top with fresh reels, like Instagram). */
export function retapTab(tab: string) { for (const fn of [...retaps]) fn(tab); }
export function onRetap(fn: (tab: string) => void) {
  retaps.add(fn);
  return () => void retaps.delete(fn);
}

/** Opens the ayah picker: the surah list, or a surah with ayahs already selected. */
export function openPicker(start?: PickStart) {
  pickStart = start ?? null;
  emit();
  navigate("pick");
}
