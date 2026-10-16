import type { Recipe } from "../../../contracts/types";
import { RECITERS as ALL_RECITERS } from "../../../contracts/reciters";
import { voiceById } from "../../../contracts/voices";

/** People pick at most 3 ayahs per design, shown one after another. */
export const MAX_AYAHS = 3;
/** A design holds at most 20 (contracts Recipe: to ≤ from + 19): an ayah that must not be shown alone widens to its
 *  group (data/ayah-groups.json), up to 17 ayahs. Longer links and saved designs are clamped. */
export const MAX_RANGE = 20;
export const FPS = 30;
export const TAIL_SECONDS = 1.5; // the last ayah stays on screen after the recitation ends

export type Orientation = Recipe["orientation"];
export type Size = [number, number];

/** Export sizes. Standard is the default (fast, WhatsApp-friendly); HD is optional. The preview canvas uses HD. */
export const SIZES: Record<"standard" | "hd", Record<Orientation, Size>> = {
  standard: { portrait: [720, 1280], square: [720, 720], landscape: [1280, 720] },
  hd: { portrait: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] },
};

export const QURAN_FONTS = ["Amiri Quran", "Scheherazade New", "Noto Naskh Arabic"];

/** everyayah.com folders (audio via /audio/<folder>/<SSSAAA>.mp3) and display names. */
/** The reciters offered: all of them (contracts/reciters.ts) less those the admin turned off (applyTurnedOff). */
export let RECITERS = ALL_RECITERS;

export const BG_COLOURS = ["#0b0f14", "#10241f", "#152238", "#2a1c2e", "#3b2a1a", "#f4efe6", "#ffffff", "#000000"];
export const TEXT_COLOURS = ["#ffffff", "#f4efe6", "#e3b25e", "#000000", "#10241f"];
export const BOX_COLOURS = ["#000000", "#ffffff", "#0b0f14", "#10241f", "#152238"];
export const BORDER_COLOURS = ["#e3b25e", "#ffffff", "#000000", "#10241f"];

// Translation script -> font + direction (fonts are fetched from Google Fonts on first use).
// Bambara's translations (data/translations.json) are in N'Ko, written right to left.
export const RTL = new Set(["ar", "ur", "fa", "ps", "sd", "ku", "dv", "ug", "he", "prs", "bm"]);
export const LANG_FONT: Record<string, string> = {
  ar: "Noto Naskh Arabic", ur: "Noto Nastaliq Urdu", fa: "Vazirmatn", ps: "Noto Naskh Arabic", sd: "Noto Naskh Arabic",
  ku: "Noto Naskh Arabic", ug: "Noto Naskh Arabic", dv: "Noto Sans Thaana", ml: "Noto Sans Malayalam",
  ta: "Noto Sans Tamil", bn: "Noto Sans Bengali", hi: "Noto Sans Devanagari", si: "Noto Sans Sinhala",
  th: "Noto Sans Thai", my: "Noto Sans Myanmar", am: "Noto Sans Ethiopic", zh: "Noto Sans SC",
  ja: "Noto Sans JP", ko: "Noto Sans KR",
  prs: "Vazirmatn", he: "Noto Sans Hebrew", bm: "Noto Sans NKo", as: "Noto Sans Bengali", mr: "Noto Sans Devanagari",
  ne: "Noto Sans Devanagari", gu: "Noto Sans Gujarati", pa: "Noto Sans Gurmukhi", kn: "Noto Sans Kannada", te: "Noto Sans Telugu",
  km: "Noto Sans Khmer",
};
export const LINE_HEIGHT: Record<string, number> = { ur: 2.1 };
/** Reflect's tafsir reader only (owner, 12 Oct 2026): a serif Malayalam for long reading. The reels, videos and every
 *  other place keep the sans (LANG_FONT), whose firmer strokes read better small and over a picture. */
export const TAFSIR_FONT: Record<string, string> = { ml: "Noto Serif Malayalam" };

// New designs start with the Shade effect (owner, 12 Oct 2026); a design without an effect (older links and saved
// designs) keeps reading as Solid (RECIPE_EXTRAS).
export const DEFAULT_STYLE = {
  effect: "shade", font: "Amiri Quran", quranSize: 4, transSize: 3,
  textColor: "#ffffff", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0, autoContrast: true,
} satisfies Partial<Recipe>;

/** Fields added with the phone app (contracts Recipe): text effect, what to show, video animation and the positions of
 *  the text block and the surah header. Missing in older links and saved designs; these defaults then apply. */
export const RECIPE_EXTRAS = {
  effect: "solid", showSurah: true, showTranslation: true, showRef: true, animation: "none", textX: 0.5, textY: 0.54, textWidth: 0,
  headerX: 0.5, headerY: 0.11, autoContrast: true, splitLong: true, voice: "none",
} satisfies Partial<Recipe>;

/** The text block's default position and width (Reset text position). */
export const DEFAULT_POSITION = { textX: RECIPE_EXTRAS.textX, textY: RECIPE_EXTRAS.textY, textWidth: RECIPE_EXTRAS.textWidth } satisfies Partial<Recipe>;
/** The surah header's default position (Reset surah name position). */
export const DEFAULT_HEADER = { headerX: RECIPE_EXTRAS.headerX, headerY: RECIPE_EXTRAS.headerY } satisfies Partial<Recipe>;

/** True when the design's text block or header is not where it starts. */
export const textMoved = (r: Recipe) => (Object.keys(DEFAULT_POSITION) as (keyof typeof DEFAULT_POSITION)[])
  .some((k) => (r[k] ?? DEFAULT_POSITION[k]) !== DEFAULT_POSITION[k]);
export const headerMoved = (r: Recipe) => (Object.keys(DEFAULT_HEADER) as (keyof typeof DEFAULT_HEADER)[])
  .some((k) => (r[k] ?? DEFAULT_HEADER[k]) !== DEFAULT_HEADER[k]);

export const DEFAULT_RECIPE: Recipe = {
  v: 1, surah: 1, from: 1, to: 1, reciter: RECITERS[0][0], translation: "en.sahih", orientation: "portrait",
  bg: { type: "colour", colour: BG_COLOURS[0] }, ...DEFAULT_STYLE, ...RECIPE_EXTRAS, effect: DEFAULT_STYLE.effect,
};

/** Hides the reciters the admin turned off (admin Library, /api/config `off`); called once at start, before the first
 *  render. At least one reciter always stays; the first one left is the new designs' default. */
export function applyTurnedOff(off: string[] = []) {
  const left = ALL_RECITERS.filter(([f]) => !off.includes(f));
  RECITERS = left.length ? left : ALL_RECITERS;
  DEFAULT_RECIPE.reciter = RECITERS[0][0];
}
/** A new design whose reciter was turned off gets the default one. */
export const offeredReciter = (r: Recipe): Recipe => (RECITERS.some(([f]) => f === r.reciter) ? r : { ...r, reciter: DEFAULT_RECIPE.reciter });

const HEX = /^#[0-9a-f]{6}$/i;
const EFFECTS = ["glass", "solid", "shadow", "outline", "none", "shade"] as const;
export const ANIMATIONS = ["none", "fade", "rise", "zoom"] as const;
export type Animation = (typeof ANIMATIONS)[number];

/** A video text animation from a link, a saved design or stored preferences: the removed typewriter (8 Oct 2026) reads
 *  as fade; anything else unknown is undefined. */
export const parseAnimation = (v: unknown): Animation | undefined => (v === "typewriter" ? "fade" : ANIMATIONS.find((a) => a === v));

/** Recipes arrive from share links and saved creations: keep only known values, clamp the rest. */
export function sanitizeRecipe(input: unknown): Recipe {
  const r = (input && typeof input === "object" ? input : {}) as Partial<Recipe> & Record<string, unknown>;
  const d = DEFAULT_RECIPE;
  const int = (v: unknown, min: number, max: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v as number))) : fallback;
  const colour = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
  const fraction = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 1000) / 1000 : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const x = RECIPE_EXTRAS;
  const surah = int(r.surah, 1, 114, d.surah);
  const from = int(r.from, 1, 286, 1);
  const bg = r.bg as Recipe["bg"] | undefined;
  return {
    v: 1, surah, from,
    to: int(r.to, from, from + MAX_RANGE - 1, from),
    // A link keeps a reciter the admin turned off later (it is only no longer offered).
    reciter: ALL_RECITERS.some(([f]) => f === r.reciter) ? (r.reciter as string) : d.reciter,
    translation: typeof r.translation === "string" && /^(none|[a-z]{2,3}\.[\w-]+)$/.test(r.translation) ? r.translation : d.translation,
    orientation: (["portrait", "square", "landscape"] as const).find((o) => o === r.orientation) ?? d.orientation,
    bg: bg?.type === "clip" && typeof bg.id === "string" && /^[\w-]{1,40}$/.test(bg.id) ? { type: "clip", id: bg.id }
      : { type: "colour", colour: colour(bg?.type === "colour" ? bg.colour : null, BG_COLOURS[0]) },
    font: QURAN_FONTS.includes(r.font as string) ? (r.font as string) : d.font,
    quranSize: int(r.quranSize, 1, 8, d.quranSize),
    transSize: int(r.transSize, 1, 8, d.transSize),
    textColor: colour(r.textColor, d.textColor),
    boxColor: colour(r.boxColor, d.boxColor),
    boxOpacity: int(r.boxOpacity, 0, 100, d.boxOpacity),
    borderColor: colour(r.borderColor, d.borderColor),
    borderWidth: int(r.borderWidth, 0, 8, d.borderWidth),
    effect: EFFECTS.find((e) => e === r.effect) ?? x.effect,
    showSurah: bool(r.showSurah, x.showSurah),
    showTranslation: bool(r.showTranslation, x.showTranslation),
    showRef: bool(r.showRef, x.showRef),
    animation: parseAnimation(r.animation) ?? x.animation,
    textX: fraction(r.textX, 0, 1, x.textX),
    textY: fraction(r.textY, 0, 1, x.textY),
    textWidth: r.textWidth === 0 ? 0 : fraction(r.textWidth, 0.3, 1, x.textWidth),
    headerX: fraction(r.headerX, 0, 1, x.headerX),
    headerY: fraction(r.headerY, 0, 1, x.headerY),
    autoContrast: bool(r.autoContrast, x.autoContrast),
    splitLong: bool(r.splitLong, x.splitLong),
    // A translation voice reads one translation (contracts/voices.ts): with any other one it is off.
    voice: voiceById(r.voice)?.text === r.translation ? (r.voice as string) : x.voice,
  };
}
