// Preferences (defaults for new designs) and interests (topics that weight the Discover feed). Kept on the device, and
// with the account when signed in (actions.ts). Framework-free.
import type { Prefs, Recipe } from "../../../contracts/types";
import { parseAnimation, RECITERS } from "./config";
import { translationFor } from "./lang";
import { voiceFor } from "./voice";

const PREFS = "qd.prefs", INTERESTS = "qd.interests";
export const MAX_INTERESTS = 10;

const ORIENTATIONS = ["portrait", "square", "landscape"];
const EFFECTS = ["glass", "solid", "shadow", "outline", "none", "shade"];

/** Only known keys with valid values (stored data and the account's copy are both checked). */
export function cleanPrefs(input: unknown): Prefs {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Prefs = {};
  if (RECITERS.some(([f]) => f === p.reciter)) out.reciter = p.reciter as string;
  if (typeof p.translation === "string" && /^(none|[a-z]{2,3}\.[\w-]{1,40})$/.test(p.translation)) out.translation = p.translation;
  if (ORIENTATIONS.includes(p.orientation as string)) out.orientation = p.orientation as Prefs["orientation"];
  if (EFFECTS.includes(p.effect as string)) out.effect = p.effect as Prefs["effect"];
  const animation = parseAnimation(p.animation); // a stored "typewriter" (removed) reads as fade
  if (animation) out.animation = animation;
  if (typeof p.voice === "boolean") out.voice = p.voice;
  if (typeof p.feedVoice === "boolean") out.feedVoice = p.feedVoice;
  if (p.reelReciter === "mix" || RECITERS.some(([f]) => f === p.reelReciter)) out.reelReciter = p.reelReciter as string;
  return out;
}

export const cleanInterests = (input: unknown): string[] =>
  Array.isArray(input) ? [...new Set(input.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,60}$/.test(x)))].slice(0, MAX_INTERESTS) : [];

const read = (key: string): unknown => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: kept for this visit */ }
};

// ---------- export quality ----------

const HD = "qd.hd";
/** What a file is made for: kept on the device (Download, Save) or sent to an app (Share). */
export type Purpose = "save" | "share";
/** The quality the person picked (true = HD), null until they pick one. Kept on this device only. */
export const storedHd = (): boolean | null => { const v = read(HD); return typeof v === "boolean" ? v : null; };
export const storeHd = (hd: boolean) => write(HD, hd);
/** Until the person picks, a saved file is HD and a file sent to an app is Standard (chat apps compress it again
 *  anyway, and Standard is made faster); once they pick, their choice for both. */
export const hdFor = (picked: boolean | null, purpose: Purpose) => picked ?? purpose === "save";

export const storedPrefs = (): Prefs => cleanPrefs(read(PREFS));
export const storePrefs = (p: Prefs) => write(PREFS, cleanPrefs(p));
// ---------- appearance ----------

const THEME = "qd.theme";
/** System (the device's light or dark), Light or Dark. */
export type Theme = "system" | "light" | "dark";
export const cleanTheme = (v: unknown): Theme => (v === "light" || v === "dark" ? v : "system");
/** The appearance the person picked, system until they do. Kept on this device only (index.html reads it too). */
export const storedTheme = (): Theme => cleanTheme(read(THEME));
export const storeTheme = (theme: Theme) => write(THEME, theme);

export const storedInterests = (): string[] => cleanInterests(read(INTERESTS));
export const storeInterests = (ids: string[]) => write(INTERESTS, cleanInterests(ids));

/** The translation new designs use: the preference, else My language's. */
export const defaultTranslation = (prefs: Prefs, lang: string) => prefs.translation ?? translationFor(lang);

/** The translation voice a design with this translation gets from the preference (none when it is off or the
 *  translation's language has no voice): with it, the design shows the translation the voice reads. */
export function voicePatch(on: boolean | undefined, translation: string): Pick<Recipe, "voice"> & Partial<Pick<Recipe, "translation">> {
  const v = on && translation !== "none" ? voiceFor(translation.split(".")[0], translation) : null;
  return v ? { voice: v.id, translation: v.text } : { voice: "none" };
}

/** The preferences' part of a design (what a new design starts with). */
export function prefsPatch(prefs: Prefs, lang: string): Partial<Recipe> {
  const translation = defaultTranslation(prefs, lang);
  return {
    translation,
    ...voicePatch(prefs.voice, translation),
    ...(prefs.reciter ? { reciter: prefs.reciter } : {}),
    ...(prefs.orientation ? { orientation: prefs.orientation } : {}),
    ...(prefs.effect ? { effect: prefs.effect } : {}),
    ...(prefs.animation ? { animation: prefs.animation } : {}),
  };
}

export const samePrefs = (a: Prefs, b: Prefs) => JSON.stringify(cleanPrefs(a)) === JSON.stringify(cleanPrefs(b));

/** A phone number as typed → E.164 ("+919876543210"): spaces, dashes, dots, brackets and a "(0)" trunk prefix dropped,
 *  a leading 00 read as +. "" → null (no number); undefined when it is not a valid international number. */
export function normalizePhone(v: string): string | null | undefined {
  let s = v.trim();
  if (!s) return null;
  s = s.replace(/\(0\)/g, "").replace(/[\s\-.()]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : undefined;
}

/** ISO 3166-1 alpha-2 codes for the country list (names come from the browser, in English). */
export const COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA "
  + "CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG "
  + "GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY "
  + "KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO "
  + "NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV "
  + "SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");
