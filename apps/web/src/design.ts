// Small helpers about a design (recipe) that every part of the app uses. Framework-free.
import type { Recipe, Surah } from "../../../contracts/types";
import { MAX_RANGE } from "./config";

/** alquran.cloud edition (translations list). */
export interface Edition { identifier: string; language: string; englishName: string; name: string }

/** One ayah of the design, as shown: Arabic and the translation (empty for "none"). */
export interface LoadedAyah { num: number; ar: string; tr: string }

/** "1" or "1–2". */
export const rangeText = (r: Recipe) => (r.to > r.from ? `${r.from}–${r.to}` : `${r.from}`);

/** "Al-Baqarah 2:153–154" (titles of saved designs, the app bar). */
export const designTitle = (r: Recipe, s: Surah | undefined) => `${s?.name_en ?? ""} ${r.surah}:${rangeText(r)}`.trim();

/** "ayah-2-153-155" for the design; "ayah-2-154" for one of its ayahs (an image shows the ayah on screen). */
export const fileName = (r: Recipe, ayah?: number) =>
  ayah !== undefined ? `ayah-${r.surah}-${ayah}` : `ayah-${r.surah}-${r.from}${r.to > r.from ? `-${r.to}` : ""}`;

/** Design properties attached to analytics events. */
export function designProps(r: Recipe) {
  return {
    ref: `${r.surah}:${r.from}`, ayahs: r.to - r.from + 1, clip: r.bg.type === "clip" ? r.bg.id : "colour",
    reciter: r.reciter, translation: r.translation, orientation: r.orientation,
  };
}

/** Keeps from/to inside the surah and the design's limit (links and saved designs are only checked against 1..286). */
export function clampRange(r: Recipe, surahs: Surah[]): Recipe {
  const max = surahs[r.surah - 1]?.ayahs ?? 286;
  const from = Math.min(Math.max(1, r.from), max);
  const to = Math.min(Math.max(from, r.to), max, from + MAX_RANGE - 1);
  return from === r.from && to === r.to ? r : { ...r, from, to };
}

/** Language of a translation: from the editions list, else the edition id's prefix ("ml.abdulhameed" → "ml"). */
export function translationLang(translation: string, editions: Record<string, Edition>) {
  return editions[translation]?.language ?? (translation === "none" ? "en" : translation.split(".")[0] || "en");
}

/** alquran.cloud prefixes ayah 1 of most surahs with the basmala. */
export function stripBasmala(text: string, surah: number, num: number) {
  text = text.replace(/^﻿/, "");
  if (num === 1 && surah !== 1 && surah !== 9 && text.startsWith("بِسْمِ")) return text.split(" ").slice(4).join(" ");
  return text;
}
