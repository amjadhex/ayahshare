// Looks (Editor v2): one-tap presets over the design's existing fields. Each sets the Arabic font, the text colour, the
// box effect with its colour and opacity, the border and the video animation together; the rest of the design (sizes,
// position, background, what is shown) stays. Framework-free.
import type { Recipe } from "../../../contracts/types";
import { DEFAULT_STYLE, RECIPE_EXTRAS } from "./config";

export type Look = Required<Pick<Recipe, "font" | "textColor" | "effect" | "boxColor" | "boxOpacity" | "borderColor" | "borderWidth" | "animation">>;

/** In the Look tab's order (names: strings edLookNames). */
export const LOOKS: Look[] = [
  { font: "Amiri Quran", textColor: "#ffffff", effect: "shade", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0, animation: "none" },
  { font: "Amiri Quran", textColor: "#ffffff", effect: "shadow", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0, animation: "fade" },
  { font: "Amiri Quran", textColor: "#ffffff", effect: "glass", boxColor: "#000000", boxOpacity: 50, borderColor: "#ffffff", borderWidth: 0, animation: "rise" },
  { font: "Noto Naskh Arabic", textColor: "#f4efe6", effect: "solid", boxColor: "#10241f", boxOpacity: 80, borderColor: "#e3b25e", borderWidth: 2, animation: "fade" },
  { font: "Scheherazade New", textColor: "#e3b25e", effect: "shadow", boxColor: "#000000", boxOpacity: 60, borderColor: "#e3b25e", borderWidth: 0, animation: "zoom" },
  { font: "Noto Naskh Arabic", textColor: "#10241f", effect: "solid", boxColor: "#ffffff", boxOpacity: 90, borderColor: "#e3b25e", borderWidth: 0, animation: "none" },
  { font: "Amiri Quran", textColor: "#ffffff", effect: "outline", boxColor: "#ffffff", boxOpacity: 80, borderColor: "#ffffff", borderWidth: 0, animation: "rise" },
  { font: "Scheherazade New", textColor: "#ffffff", effect: "none", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0, animation: "none" },
];

const KEYS = Object.keys(LOOKS[0]) as (keyof Look)[];

/** The Look the design has now (every one of its fields matches), or -1. */
export function lookOf(r: Recipe): number {
  const x = { ...RECIPE_EXTRAS, ...r } as Recipe;
  return LOOKS.findIndex((l) => KEYS.every((k) => x[k] === l[k]));
}

/** Reset the look: the fields a Look sets, and Auto contrast, back to where a new design starts. */
export const LOOK_RESET: Partial<Recipe> = {
  font: DEFAULT_STYLE.font, textColor: DEFAULT_STYLE.textColor, effect: DEFAULT_STYLE.effect as Recipe["effect"],
  boxColor: DEFAULT_STYLE.boxColor, boxOpacity: DEFAULT_STYLE.boxOpacity, borderColor: DEFAULT_STYLE.borderColor,
  borderWidth: DEFAULT_STYLE.borderWidth, autoContrast: DEFAULT_STYLE.autoContrast, animation: RECIPE_EXTRAS.animation as Recipe["animation"],
};

/** Reset size, font and colour (the Text tab). */
export const TEXT_RESET: Partial<Recipe> = {
  font: DEFAULT_STYLE.font, quranSize: DEFAULT_STYLE.quranSize, transSize: DEFAULT_STYLE.transSize, textColor: DEFAULT_STYLE.textColor,
};
