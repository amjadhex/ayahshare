// The tafsirs the Reflect sheet offers (GET /api/tafsirs), grouped by language for its chooser (the two-step picker,
// ui/GroupedPicker.tsx), and the tafsir last picked for each My language, kept on this device.
// Framework-free.
import type { TafsirId, TafsirInfo } from "../../../contracts/types";
import { languageName, type LanguageName } from "./translations";

const KEY = "qd.tafsir";

function stored(): Record<string, TafsirId> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, TafsirId>) : {};
  } catch { return {}; }
}

/** The tafsir last picked while My language was `lang` (an id: a number, or one of ours such as "ml.thafheem"; the Worker
 *  checks it is still offered). */
export function rememberedTafsir(lang: string): TafsirId | undefined {
  const id = stored()[lang];
  return (typeof id === "number" && Number.isInteger(id) && id > 0) || (typeof id === "string" && /^[a-z]{2,3}\.[a-z0-9]{1,30}$/.test(id)) ? id : undefined;
}

export function rememberTafsir(lang: string, id: TafsirId) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...stored(), [lang]: id })); } catch { /* private mode: kept for this visit */ }
}

export interface TafsirGroup extends LanguageName { tafsirs: TafsirInfo[] }

/** By language: the `first` languages in that order (My language, then the current tafsir's), then the others in
 *  English name order; each language's tafsirs in the list's order (its default first). */
export function tafsirGroups(list: TafsirInfo[], first: string[]): TafsirGroup[] {
  const groups = new Map<string, TafsirInfo[]>();
  for (const t of list) groups.set(t.lang, [...(groups.get(t.lang) ?? []), t]);
  const rank = (code: string) => { const i = first.indexOf(code); return i < 0 ? first.length : i; };
  return [...groups].map(([code, tafsirs]) => ({ ...languageName(code), tafsirs }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.english.localeCompare(b.english));
}
