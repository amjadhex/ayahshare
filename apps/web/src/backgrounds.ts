// Backgrounds: precomputed suggestions per ayah (static JSON, no waiting) and the clip library. Framework-free.
import type { Clip } from "../../../contracts/types";
import { allClips, clipById, getSurahBackgrounds, loadCatalogue, searchClips } from "./api";

/** Library search without the network (offline, or while the search endpoint is unavailable). */
function localClips(q: string, limit: number) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return allClips()
    .filter((c) => words.every((w) => `${c.caption} ${c.tags.join(" ")}`.toLowerCase().includes(w)))
    .slice(0, limit);
}

const recent = new Map<string, Promise<Clip[]>>();

/** Library search (`/api/clips`), falling back to the local catalogue. Answers are kept for the session.
 *  No query: the catalogue's first clips (the server's default order too), so opening the library needs no request. */
export function findClips(q: string, limit: number): Promise<Clip[]> {
  if (!q) return loadCatalogue().then(() => localClips("", limit));
  const key = `${limit}:${q}`;
  if (!recent.has(key)) {
    recent.set(key, searchClips(q, limit).catch(async () => {
      recent.delete(key); // try the network again next time
      await loadCatalogue();
      return localClips(q, limit);
    }));
  }
  return recent.get(key)!;
}

/** Suggestions for one ayah: the precomputed list for its surah, else a library search for `fallbackQuery`. */
export async function suggestionsFor(surah: number, ayah: number, fallbackQuery: string): Promise<Clip[]> {
  try {
    const [file] = await Promise.all([getSurahBackgrounds(surah), loadCatalogue()]);
    const clips = (file?.ayahs[String(ayah)] ?? []).map((id) => clipById(id)).filter((c): c is Clip => !!c);
    // No precomputed list for this surah yet: ask the library instead.
    return clips.length ? clips : await findClips(fallbackQuery, 8);
  } catch {
    return [];
  }
}
