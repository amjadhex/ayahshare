// The translations the app offers, by language, and the search over them and over languages, for the translation
// picker (ui/TranslationPicker.tsx) and the My language dialog. Framework-free.
import { RTL } from "./config";
import type { Edition } from "./design";
import { LANGUAGES } from "./lang";

// ---------- Short names ----------

const SHORT_MAX = 32;
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{Mn}\p{Lm}]+$/u;
const latin = (s: string) => LATIN.test(s);
const TITLES = /^(?:shaykh|sheikh|shaikh|maulana|mawlawi|dr\.?|prof\.?|imam)\s+/i;

/** A translation's name as the UI shows it (pickers, rows, toasts): short, in Latin letters where the edition has them.
 *  The edition's own `name` when it is short and Latin ("Hilali & Khan"); else the English name tidied (titles dropped, a
 *  Latin name in brackets taken from a name in another script); else, for several translators, their family names
 *  ("Cheriyamundam Abdul Hameed and Kunhi Mohammed Parappoor" becomes "Abdul Hameed & Parappoor"). The full name stays
 *  as secondary text where there is room. */
export function shortTranslationName(e: Pick<Edition, "englishName" | "name">): string {
  let full = e.englishName.replace(/\s+/g, " ").trim().replace(/^quran translation by /i, "").replace(/^translation by /i, "");
  // "ഖുര്‍ആന്‍ ലളിതസാരം (Karakunnu & Elayavoor)": the Latin part in brackets when the rest is not Latin. A short note
  // such as "(Latin)" stays: it tells two editions of one translator apart.
  const bracket = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(full);
  if (bracket && bracket[2].length <= 8 && latin(bracket[1])) {
    const base = shortTranslationName({ englishName: bracket[1], name: "" }), note = ` (${bracket[2]})`;
    return (base.length + note.length <= SHORT_MAX ? base : base.split(" ").slice(-3).join(" ")) + note;
  }
  if (bracket && (bracket[2].length > 8 || !latin(bracket[1]))) full = latin(bracket[1]) || !latin(bracket[2]) ? bracket[1] || bracket[2] : bracket[2];
  const name = e.name.trim();
  if (latin(full) && full.length <= SHORT_MAX) return full;
  if (latin(name) && name.length <= SHORT_MAX && name.length < full.length) return name;
  if (!latin(full)) return full.length <= SHORT_MAX ? full : name && name.length < full.length ? name : full;
  full = full.replace(TITLES, "");
  if (full.length <= SHORT_MAX) return full;
  // Several translators: the first one's family name(s) and the others' last names.
  const people = full.split(/\s*(?:&|,|\band\b)\s*/i).filter(Boolean);
  if (people.length > 1) {
    const last = (p: string, n: number) => p.split(" ").slice(-n).join(" ");
    const short = people.map((p, i) => last(p, i === 0 ? 2 : 1)).join(" & ");
    if (short.length <= SHORT_MAX) return short;
  }
  return full; // one long name: the screen shortens it with an ellipsis
}

export interface LanguageName { code: string; native: string; english: string; rtl: boolean }

const englishNames = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "language" }); } catch { return null; }
})();

/** A language's own name and its English name: from LANGUAGES, else the browser's names, else the code. */
export function languageName(code: string): LanguageName {
  const l = LANGUAGES.find((x) => x.code === code);
  if (l) return { code, native: l.native, english: l.english, rtl: RTL.has(code) };
  let english = code, native = code;
  try { english = englishNames?.of(code) ?? code; } catch { /* not a language code the browser knows */ }
  try { native = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? english; } catch { native = english; }
  return { code, native, english, rtl: RTL.has(code) };
}

/** For matching: lower case, accents and vowel marks removed, dotless i as i, no spaces, punctuation or modifier letters
 *  (the ʻ of Oʻzbekcha). "Francais", "français" and "FRANÇAIS" are the same; so are "al-hilali" and "Al Hilali". Any
 *  script: both sides of a match are folded the same way. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/ı/g, "i").replace(/[\s\p{P}\p{S}\p{Lm}]+/gu, "");
}

/** The query's words, folded (empty words dropped). */
export const queryWords = (q: string) => q.normalize("NFKD").split(/[\s\p{P}\p{S}]+/u).map(fold).filter(Boolean);

/** True when every word of the query is in one of the texts. */
export function matches(words: string[], texts: string[]): boolean {
  const hay = texts.map(fold).join(" ");
  return words.every((w) => hay.includes(w));
}

export interface LanguageGroup extends LanguageName { editions: Edition[] }

/** The translations grouped by language, each language's default first (lang.ts translationFor), then in the list's
 *  order. Languages are in English name order. */
export function byLanguage(editions: Record<string, Edition>, defaultOf: (code: string) => string): LanguageGroup[] {
  const groups = new Map<string, Edition[]>();
  for (const e of Object.values(editions)) groups.set(e.language, [...(groups.get(e.language) ?? []), e]);
  return [...groups].map(([code, list]) => {
    const def = defaultOf(code);
    return { ...languageName(code), editions: [...list].sort((a, b) => Number(b.identifier === def) - Number(a.identifier === def)) };
  }).sort((a, b) => a.english.localeCompare(b.english));
}

/** What a search finds: the languages whose names match, and the translations whose translator, edition name or language
 *  match (every word somewhere), grouped by language. */
export function search(groups: LanguageGroup[], q: string) {
  const words = queryWords(q);
  if (!words.length) return { languages: [], translations: [] };
  const languages = groups.filter((g) => matches(words, [g.native, g.english]));
  const translations = groups
    .map((g) => ({ ...g, editions: g.editions.filter((e) => matches(words, [e.englishName, e.name, g.native, g.english])) }))
    .filter((g) => g.editions.length);
  return { languages, translations };
}

// ---------- The same translation twice ----------

/** Editions known to be another edition's text under another id; explicit, for the ones whose names differ. */
const ALIASES: Record<string, string> = { "ml.karakunnu": "ml.lalithasaram" };
let twins: Record<string, string> = { ...ALIASES };

/** The edition that stands for `id` in lists and names: the kept twin of a hidden duplicate, else `id` itself. */
export const canonicalEdition = (id: string) => twins[id] ?? id;
/** An edition by id, the kept twin's when `id` is a hidden duplicate (old designs and share links keep their ids). */
export const editionOf = (editions: Record<string, Edition>, id: string): Edition | undefined => editions[id] ?? editions[canonicalEdition(id)];

const isFoundation = (id: string) => /\.qf-\d+$/.test(id);
const sameName = (e: Edition) => `${e.language}|${fold(e.englishName)}`;

/** The list the pickers show: when two editions of one language have the same English name, only one stays (the one a
 *  recorded voice reads, else the one that is not the Quran Foundation's copy, else the first), and a known alias
 *  (ml.karakunnu is ml.lalithasaram) is hidden too. Hidden ids still load (the texts are the same) and are remembered
 *  here, so a design that uses one shows its twin's name. */
export function dedupeEditions(list: Edition[], voiced: ReadonlySet<string> = new Set()): Edition[] {
  const hidden: Record<string, string> = {};
  const byName = new Map<string, Edition[]>();
  for (const e of list) byName.set(sameName(e), [...(byName.get(sameName(e)) ?? []), e]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const rank = (e: Edition) => (voiced.has(e.identifier) ? 0 : isFoundation(e.identifier) ? 2 : 1);
    const keep = [...group].sort((a, b) => rank(a) - rank(b))[0];
    for (const e of group) if (e !== keep) hidden[e.identifier] = keep.identifier;
  }
  const ids = new Set(list.map((e) => e.identifier));
  for (const [from, to] of Object.entries(ALIASES)) if (ids.has(to)) hidden[from] = to;
  twins = { ...ALIASES, ...hidden };
  return list.filter((e) => !(e.identifier in hidden));
}
