// What the Discover feed learns about the person, kept on this device only (never sent anywhere as such): what they
// searched (the ayahs their searches found), which mood chips they pick, how long they watched each reel and which
// ones they skipped, and when each ayah was last shown (so the feed does not repeat itself). Small and capped.
// Framework-free.
import type { Ref } from "../../../contracts/types";

export interface Signals {
  /** Interest per ayah: searches that found it, reels watched to the end (positive), reels skipped (negative). */
  refs: Record<Ref, number>;
  /** Mood chips picked, by id. */
  moods: Record<string, number>;
  /** Last searches (newest first). */
  searches: string[];
  /** When each ayah was last shown in the feed (ms). */
  seen: Record<Ref, number>;
}

const KEY = "qd.signals";
const MAX_REFS = 300, MAX_SEEN = 600, MAX_SEARCHES = 20;
export const empty = (): Signals => ({ refs: {}, moods: {}, searches: [], seen: {} });

let cache: Signals | null = null;

export function loadSignals(): Signals {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Signals> | null;
    cache = { ...empty(), ...(raw && typeof raw === "object" ? raw : {}) };
  } catch {
    cache = empty();
  }
  return cache;
}

/** Keeps the largest `max` entries of a score map. */
function cap<T extends Record<string, number>>(map: T, max: number, by: (v: number) => number = Math.abs): T {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  return Object.fromEntries(keys.sort((a, b) => by(map[b]) - by(map[a])).slice(0, max).map((k) => [k, map[k]])) as T;
}

function save(s: Signals) {
  cache = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: kept for this visit */ }
}

function update(fn: (s: Signals) => void) {
  const s = structuredClone(loadSignals());
  fn(s);
  s.refs = cap(s.refs, MAX_REFS);
  s.seen = cap(s.seen, MAX_SEEN, (v) => v);
  s.searches = s.searches.slice(0, MAX_SEARCHES);
  save(s);
}

const bump = (map: Record<string, number>, key: string, by: number) => { map[key] = Math.round(((map[key] ?? 0) + by) * 100) / 100; };

/** A search and the ayahs it found (best first): the top ones become interests. */
export function recordSearch(q: string, refs: Ref[]) {
  update((s) => {
    const query = q.trim().slice(0, 100);
    if (query) s.searches = [query, ...s.searches.filter((x) => x !== query)];
    refs.slice(0, 5).forEach((ref, i) => bump(s.refs, ref, 1 - i * 0.15));
  });
}

export const recordMood = (id: string) => update((s) => bump(s.moods, id, 1));

/** A reel left after `ms` of its `total` length: watched most of it → more like it; left within 2 s → a skip. */
export function recordWatch(ref: Ref, ms: number, total: number) {
  update((s) => {
    if (ms < 2000) bump(s.refs, ref, -1);
    else if (ms >= Math.min(8000, total * 0.7)) bump(s.refs, ref, 1.5);
  });
}

export function recordSeen(refs: Ref[], now = Date.now()) {
  update((s) => { for (const r of refs) s.seen[r] = now; });
}

/** Forget everything (tests). */
export function resetSignals() {
  cache = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
