// Ayahs that must not be shown alone (data/ayah-groups.json, pipeline A1b): "So woe to those who pray" (107:4) is only
// ever shown with 107:5-7. Framework-free.
import type { AyahGroups } from "../../../contracts/types";

let groups: AyahGroups = {};

/** The groups file, once loaded (api.loadAyahGroups); until then every ayah stands alone. */
export const setAyahGroups = (g: AyahGroups) => { groups = g; };

/** surah:from-to widened so that no ayah in it is shown without the ayahs its meaning needs: 107:4 → 107:4-7,
 *  107:4-5 → 107:4-7, 2:255 → 2:255. */
export function withGroups(surah: number, from: number, to: number): { from: number; to: number } {
  const a = groups[`${surah}:${from}`], b = groups[`${surah}:${to}`];
  return { from: Math.min(from, a?.[0] ?? from), to: Math.max(to, b?.[1] ?? to) };
}
