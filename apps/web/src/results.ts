// What a search result card shows besides the search answer: the ayah in Arabic, its translation in the selected
// translation (English when there is none), and its own suggested background. Framework-free; answers are cached.
import type { Clip, Ref } from "../../../contracts/types";
import * as api from "./api";
import { suggestionsFor } from "./backgrounds";
import { stripBasmala } from "./design";

/** The edition the search answers already carry (data/ayahs-en.json). */
export const SEARCH_EDITION = "en.sahih";

export interface ResultText { ar: string; tr: string | null }

const texts = new Map<string, Promise<ResultText>>();

// At most a few surah files load at once (the Quran text service limits bursts), each retried once after a pause.
const MAX_LOADS = 3;
let loading = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (loading >= MAX_LOADS) await new Promise<void>((resolve) => queue.push(resolve));
  loading++;
  try {
    return await fn().catch(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      return fn();
    });
  } finally {
    loading--;
    queue.shift()?.();
  }
}

function loadText(ref: Ref, tr: string | null): Promise<ResultText> {
  const key = `${ref}/${tr ?? ""}`;
  if (!texts.has(key)) {
    const [surah, ayah] = ref.split(":").map(Number);
    texts.set(key, limited(() => Promise.all([
      api.getAyahFromSurah(surah, ayah, "quran-uthmani"),
      tr ? api.getAyahFromSurah(surah, ayah, tr) : Promise.resolve(""),
    ])).then(
      ([ar, t]) => ({ ar: stripBasmala(ar, surah, ayah), tr: t || null }),
      (e) => { texts.delete(key); throw e; }, // try again next time
    ));
  }
  return texts.get(key)!;
}

/** Arabic and (unless the search text already is it) the translation of one ayah. Read from the surah's cached text
 *  (one file per surah and edition, shared with the editor), so opening a result afterwards needs no request. */
export const resultText = (ref: Ref, translation: string) =>
  loadText(ref, translation === "none" || translation === SEARCH_EDITION ? null : translation);

/** Arabic and the translation of one ayah in any edition (the ayah picker's preview shows the design's own translation,
 *  English included). Shares the cache with `resultText`. */
export const ayahText = (ref: Ref, translation: string) => loadText(ref, translation === "none" ? null : translation);

/** The background suggestions of each result's ayah (precomputed per surah, else a library search for the query). */
export const resultClips = (ref: Ref, q: string): Promise<Clip[]> => {
  const [surah, ayah] = ref.split(":").map(Number);
  return suggestionsFor(surah, ayah, q);
};

/** One background per result, in list order: each takes its best suggestion not already used by a result above it,
 *  so every card (and every design opened from one) looks different. */
export function assignClips(refs: Ref[], lists: Record<Ref, Clip[] | undefined>): Record<Ref, Clip | null> {
  const used = new Set<string>(), out: Record<Ref, Clip | null> = {};
  for (const ref of refs) {
    const list = lists[ref] ?? [];
    const pick = list.find((c) => !used.has(c.id)) ?? list[0] ?? null;
    if (pick) used.add(pick.id);
    out[ref] = pick;
  }
  return out;
}
