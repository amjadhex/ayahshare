// Anonymous counts shown on ayahs (favourites, shares, people who made their own) and the person's private impact.
// Counts never carry names. Cached for the visit; a count that fails to load is simply not shown, so nothing here ever
// blocks or breaks a screen. Framework-free. The server side: GET /api/stats/ayahs and /api/stats/me (apps/api
// src/routes/stats.ts, where each count is defined), and POST /api/shares/:code/reuse for "made from a shared link".
import type { AyahStats, ImpactResponse, Recipe, Ref } from "../../../contracts/types";
import { getAyahStats, getImpact, getTrendingCounts, reuseShare } from "./api";
import { recipeKey } from "./history";

const cache = new Map<Ref, AyahStats>();
const pending = new Map<Ref, Promise<void>>();

/** Counts for these ayahs (missing ones are left out). Asks the server once per ayah per visit. */
export async function ayahStats(refs: Ref[]): Promise<Map<Ref, AyahStats>> {
  const want = [...new Set(refs)].filter((r) => !cache.has(r) && !pending.has(r));
  if (want.length) {
    const job = getAyahStats(want.slice(0, 60))
      .then((res) => { for (const s of res.stats) cache.set(s.ref, s); })
      .catch(() => { /* counts are optional */ })
      .finally(() => { for (const r of want) pending.delete(r); });
    for (const r of want) pending.set(r, job);
  }
  await Promise.all(refs.map((r) => pending.get(r)).filter(Boolean));
  return new Map(refs.flatMap((r) => (cache.has(r) ? [[r, cache.get(r)!] as const] : [])));
}

/** The ayahs shared most over the last `days` days (Discover · Most shared today). */
export async function mostShared(limit = 5, days = 1): Promise<{ ref: Ref; shares: number }[]> {
  try {
    const res = await getTrendingCounts(days);
    return res.refs.slice(0, limit).map((x) => ({ ref: x.ref, shares: x.n }));
  } catch { return []; }
}

/** The person's private impact (Profile · Your ayahs this week), or null when it cannot load. */
export async function myImpact(): Promise<ImpactResponse | null> {
  try { return await getImpact(); } catch { return null; }
}

// ---------- designs made from someone's shared link ----------
// The share link this visit opened (its code and the design as it came), so an export or a new link made from it can be
// counted for the person who shared it: "shared them on" when the design is unchanged, "made their own" when it was
// changed. Only the count reaches the server, never who. Wired by the code that opens links (app.ts: after loadShared)
// and the code that finishes an export or creates a link (exportJob.tsx).

let opened: { code: string; recipe: Recipe; key: string } | null = null;
const counted = new Set<string>();

/** A share link was opened and its design loaded. */
export function openedFromLink(code: string, recipe: Recipe) {
  opened = { code, recipe, key: recipeKey(recipe) };
}

/** An export finished or a link was created for `recipe`: if it is the opened link's ayah, counts it once per design. */
export function madeFromLink(recipe: Recipe) {
  if (!opened || recipe.surah !== opened.recipe.surah || recipe.from !== opened.recipe.from) return;
  const key = recipeKey(recipe);
  if (counted.has(key)) return;
  counted.add(key);
  try { void reuseShare(opened.code, key === opened.key ? "share" : "make").catch(() => {}); } catch { /* optional */ }
}

/** 9610 → "9.6k", 24800 → "25k", 1.2m … for counts on thumbnails, reels and the profile. */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)));
  if (n < 10_000) return `${Math.round(n / 100) / 10}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n / 100_000) / 10}m`;
}
