// Validation of client input that is stored: design recipes (shares, creations) and ayah refs.
import type { Recipe, Ref } from "../../../../contracts/types";
import { voiceById } from "../../../../contracts/voices";

const HEX = /^#[0-9a-f]{6}$/i;
const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** "2:255" with surah 1..114 and ayah 1..286, else null. */
export function parseRef(ref: unknown): Ref | null {
  const m = typeof ref === "string" ? ref.match(/^(\d{1,3}):(\d{1,3})$/) : null;
  return m && int(+m[1], 1, 114) && int(+m[2], 1, 286) ? `${+m[1]}:${+m[2]}` : null;
}

export const isClipId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,40}$/.test(id);

const EFFECTS = ["glass", "solid", "shadow", "outline", "none", "shade"] as const;
const ANIMATIONS = ["none", "fade", "rise", "zoom"] as const;
const MAX_RANGE = 20; // contracts Recipe: to ≤ from + 19 (an ayah group reaches 17)

/** The video text animation, with the removed "typewriter" (older links, saved designs, profile preferences) read as
 *  "fade"; undefined when it is not one of them. */
export function parseAnimation(v: unknown): NonNullable<Recipe["animation"]> | undefined {
  if (v === "typewriter") return "fade";
  return ANIMATIONS.find((a) => a === v);
}

/** Fields added later are optional on input: missing → default, present but invalid → the recipe is rejected. */
function optional<T>(v: unknown, fallback: T, valid: (v: unknown) => boolean): T | undefined {
  return v === undefined ? fallback : valid(v) ? (v as T) : undefined;
}
const fraction = (min: number, max: number) => (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A contract-conforming Recipe rebuilt from known fields only, or null when any field is invalid.
 *  Ranges are capped at 20 ayahs (older clients could send up to 50; those are clamped, not rejected). */
export function parseRecipe(input: unknown): Required<Recipe> | null {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const bg = (r.bg && typeof r.bg === "object" ? r.bg : {}) as Record<string, unknown>;
  const ok =
    r.v === 1 &&
    int(r.surah, 1, 114) && int(r.from, 1, 286) && int(r.to, r.from as number, Math.min((r.from as number) + 49, 286)) &&
    typeof r.reciter === "string" && /^[A-Za-z0-9][\w.-]{0,79}$/.test(r.reciter) &&
    typeof r.translation === "string" && /^(none|[a-z]{2,3}\.[\w-]{1,40})$/.test(r.translation) &&
    ["portrait", "square", "landscape"].includes(r.orientation as string) &&
    ((bg.type === "clip" && isClipId(bg.id)) || (bg.type === "colour" && typeof bg.colour === "string" && HEX.test(bg.colour))) &&
    typeof r.font === "string" && /^[\w -]{1,40}$/.test(r.font) &&
    int(r.quranSize, 1, 8) && int(r.transSize, 1, 8) &&
    [r.textColor, r.boxColor, r.borderColor].every((c) => typeof c === "string" && HEX.test(c)) &&
    int(r.boxOpacity, 0, 100) && int(r.borderWidth, 0, 8);
  if (!ok) return null;
  const extra = {
    effect: optional<Recipe["effect"]>(r.effect, "solid", (v) => EFFECTS.includes(v as never)),
    showSurah: optional(r.showSurah, true, (v) => typeof v === "boolean"),
    showTranslation: optional(r.showTranslation, true, (v) => typeof v === "boolean"),
    showRef: optional(r.showRef, true, (v) => typeof v === "boolean"),
    animation: r.animation === undefined ? "none" : parseAnimation(r.animation),
    textX: optional(r.textX, 0.5, fraction(0, 1)),
    textY: optional(r.textY, 0.54, fraction(0, 1)),
    textWidth: optional(r.textWidth, 0, (v) => v === 0 || fraction(0.3, 1)(v)),
    headerX: optional(r.headerX, 0.5, fraction(0, 1)),
    headerY: optional(r.headerY, 0.11, fraction(0, 1)),
    autoContrast: optional(r.autoContrast, true, (v) => typeof v === "boolean"),
    splitLong: optional(r.splitLong, true, (v) => typeof v === "boolean"),
    voice: optional<string>(r.voice, "none", (v) => v === "none" || !!voiceById(v)),
  };
  if (Object.values(extra).some((v) => v === undefined)) return null;
  return {
    v: 1, surah: r.surah as number, from: r.from as number, to: Math.min(r.to as number, (r.from as number) + MAX_RANGE - 1),
    reciter: r.reciter as string, translation: r.translation as string, orientation: r.orientation as Recipe["orientation"],
    bg: bg.type === "clip" ? { type: "clip", id: bg.id as string } : { type: "colour", colour: bg.colour as string },
    font: r.font as string, quranSize: r.quranSize as number, transSize: r.transSize as number,
    textColor: r.textColor as string, boxColor: r.boxColor as string, boxOpacity: r.boxOpacity as number,
    borderColor: r.borderColor as string, borderWidth: r.borderWidth as number,
    effect: extra.effect!, showSurah: extra.showSurah!, showTranslation: extra.showTranslation!, showRef: extra.showRef!,
    animation: extra.animation!, textX: round3(extra.textX!), textY: round3(extra.textY!), textWidth: round3(extra.textWidth!),
    headerX: round3(extra.headerX!), headerY: round3(extra.headerY!), autoContrast: extra.autoContrast!,
    splitLong: extra.splitLong!,
    // A voice reads one translation: with any other translation (never sent by the app) it is turned off.
    voice: voiceById(extra.voice)?.text === r.translation ? extra.voice! : "none",
  };
}

/** A recipe as stored (validated when it was saved, possibly by an older version): the fields added since then get
 *  their defaults and the removed "typewriter" animation reads as "fade", so readers always get the current contract.
 *  Unparseable JSON or an invalid recipe (never stored by this API) comes back as it was. */
export function storedRecipe(json: string): Recipe {
  const raw = JSON.parse(json) as Recipe;
  return parseRecipe(raw) ?? raw;
}
