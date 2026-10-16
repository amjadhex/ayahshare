// Find: topic search in any language (progressive: quick results first, then the refined order, then more pages on
// request) and references like 2:255 or 94:5-6. Framework-free; the Find screen renders what this returns.
import type { Ref, SearchResponse, Surah } from "../../../contracts/types";
import * as api from "./api";
import { MAX_AYAHS } from "./config";
import { withGroups } from "./groups";
import { SEARCH_EDITION } from "./results";

export type SearchResult = SearchResponse["results"][number];

/** One tile on Results: an ayah, or the 2–3 ayahs of a typed range. `ref` is the first ayah ("94:5"), `to` the number of
 *  the last one, `text` the English text (what a search answers with) shown when there is no translation. */
export interface Hit { ref: Ref; to: number; text: string }
export const hitOf = (r: SearchResult): Hit => ({ ref: r.ref, to: +r.ref.split(":")[1], text: r.text });
export const hitKey = (h: Hit) => `${h.ref}-${h.to}`;

const REF = /^(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/;

/** "2:255" or "94:5-6" → the range; anything else → null (a topic search). */
export function parseRef(q: string): { surah: number; from: number; to: number } | null {
  const m = q.trim().match(REF);
  return m ? { surah: +m[1], from: +m[2], to: +(m[3] || m[2]) } : null;
}

type OnResults = (results: SearchResult[], mode: "fast" | "full", next: number | null) => void;

/** The page to ask for after this answer, or null when there is none (references, older servers). */
const nextOf = (d: SearchResponse) => (d.more ? d.next ?? null : null);

/** Both requests start at once: the quick answer shows first, and the refined one replaces it (the list reorders in
 *  place). A cached query answers "full" to either request; a quick answer that arrives after a full one is dropped.
 *  An empty answer never replaces results already shown. When neither request answers (the server says 503 when it
 *  could not search, e.g. a slow first query), the search is tried once more after `retryMs`. `next` is the page
 *  that follows the answer shown (searchPage), or null.
 *  Resolves "shown" when anything was shown, "empty" when the search answered with nothing, "failed" otherwise. */
export async function progressiveSearch(
  q: string, signal: AbortSignal, onResults: OnResults, retryMs = 600,
): Promise<"shown" | "empty" | "failed" | "aborted"> {
  const first = await searchOnce(q, signal, onResults);
  if (first !== "failed" || retryMs < 0) return first;
  await new Promise((resolve) => setTimeout(resolve, retryMs));
  return signal.aborted ? "aborted" : searchOnce(q, signal, onResults);
}

async function searchOnce(q: string, signal: AbortSignal, onResults: OnResults): Promise<"shown" | "empty" | "failed" | "aborted"> {
  let shown = false, answered = false, final = false;
  await Promise.all((["fast", "full"] as const).map(async (mode) => {
    try {
      const d = await api.search(q, mode, signal);
      if (signal.aborted || final) return;
      answered = true;
      final = d.mode === "full";
      if (d.results.length) {
        onResults(d.results, d.mode, nextOf(d));
        shown = true;
      }
    } catch { /* the other request may still answer */ }
  }));
  if (signal.aborted) return "aborted";
  return shown ? "shown" : answered ? "empty" : "failed";
}

/** A later page of a topic search (`page` from the answer before it): its results and the page after it, or null. */
export async function searchPage(q: string, page: number, signal: AbortSignal): Promise<{ results: SearchResult[]; next: number | null }> {
  const d = await api.search(q, "full", signal, page);
  return { results: d.results, next: nextOf(d) };
}

/** What a typed reference shows on Results: one tile for the ayah, or for each run of up to 3 ayahs of a range (the most
 *  a design can hold), at most `limit` tiles. [] when the surah or ayah does not exist. */
export async function referenceHits(range: { surah: number; from: number; to: number }, surahs: Surah[], limit = 10): Promise<Hit[]> {
  const total = surahs[range.surah - 1]?.ayahs ?? 0;
  if (range.from < 1 || range.from > total) return [];
  const last = Math.min(Math.max(range.to, range.from), total);
  const hits: Hit[] = [];
  for (let a = range.from; a <= last && hits.length < limit; a += MAX_AYAHS) {
    hits.push({ ref: `${range.surah}:${a}`, to: Math.min(a + MAX_AYAHS - 1, last), text: "" });
  }
  return withText(hits, range.surah);
}

/** What a surah chip shows on Results (owner, 16 Oct 2026: "Surah Al-Kahf" is the whole surah, not 18:1-10): the surah
 *  from its first ayah, one ayah a tile, `size` tiles a page; scrolling down adds the next page. An ayah that is never
 *  shown alone comes with the ayahs its meaning needs (groups.ts). `next` is the page after this one, or null. */
export async function surahPage(surah: number, surahs: Surah[], page = 1, size = 10): Promise<{ results: Hit[]; next: number | null }> {
  const total = surahs[surah - 1]?.ayahs ?? 0;
  const tiles: Hit[] = [];
  for (let a = 1; a <= total; ) {
    const to = Math.min(Math.max(withGroups(surah, a, a).to, a), a + MAX_AYAHS - 1, total);
    tiles.push({ ref: `${surah}:${a}`, to, text: "" });
    a = to + 1;
  }
  const end = page * size;
  return { results: await withText(tiles.slice(end - size, end), surah), next: end < tiles.length ? page + 1 : null };
}

/** Fills in each hit's English text (the ayahs of a range joined). */
async function withText(hits: Hit[], surah: number): Promise<Hit[]> {
  await Promise.all(hits.map(async (h) => {
    const from = +h.ref.split(":")[1];
    const parts = await Promise.all(Array.from({ length: h.to - from + 1 }, (_, i) =>
      api.getAyahFromSurah(surah, from + i, SEARCH_EDITION).catch(() => "")));
    h.text = parts.filter(Boolean).join(" ");
  }));
  return hits;
}
