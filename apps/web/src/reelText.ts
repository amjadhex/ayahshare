// Reels' text size (owner, 12 Oct 2026): Small, Medium or Large in Reels' Language and audio, kept on this device. It
// sets the Arabic and translation sizes of every reel's design (feed.ts reelDesign), so the reels, the stories, today's
// ayah, the search tiles and the videos shared or downloaded from a reel all follow it. Framework-free.
import type { Recipe } from "../../../contracts/types";
import { DEFAULT_STYLE } from "./config";

export type ReelTextSize = "small" | "medium" | "large";
export const REEL_TEXT_SIZES: ReelTextSize[] = ["small", "medium", "large"];
const KEY = "qd.reelTextSize";
/** Steps from a new design's sizes (config.ts DEFAULT_STYLE), [Arabic, translation]: Large grows the translation more. */
const STEPS: Record<ReelTextSize, [number, number]> = { small: [-1, -1], medium: [0, 0], large: [1, 2] };

export function reelTextSize(): ReelTextSize {
  try {
    const v = localStorage.getItem(KEY);
    return REEL_TEXT_SIZES.includes(v as ReelTextSize) ? (v as ReelTextSize) : "medium";
  } catch {
    return "medium";
  }
}

export function storeReelTextSize(size: ReelTextSize) {
  try { if (size === "medium") localStorage.removeItem(KEY); else localStorage.setItem(KEY, size); } catch { /* this visit only */ }
}

const clamp = (n: number) => Math.max(1, Math.min(8, n));
/** A reel's design at the text size (`size`, else the one kept on the device). */
export function sizedReel(r: Recipe, size = reelTextSize()): Recipe {
  const [q, tr] = STEPS[size];
  return { ...r, quranSize: clamp(DEFAULT_STYLE.quranSize + q), transSize: clamp(DEFAULT_STYLE.transSize + tr) };
}
