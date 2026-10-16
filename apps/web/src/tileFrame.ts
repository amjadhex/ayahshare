// A search result tile drawn as the first frame of the reel it opens: the same design (the Arabic, the translation, the
// box and the surah line, in the reel's own fonts and colours) laid out for the tile's size (draw.ts scales everything
// by the short side, so it is the reel's look, only smaller). The tile's moving background shows through, under the
// reel's own shade (effect "shade"); the app's name line is left out (the tile shows its surah and reference below
// instead). Framework-free; frames are drawn one at a time (each takes a few milliseconds on the main thread) and kept
// per ayah, background, size and language.
import type { Clip, Prefs, Ref, Surah } from "../../../contracts/types";
import * as api from "./api";
import { posterBackdrop } from "./backdrop";
import { composeText, type Rect } from "./compose";
import { stripBasmala, translationLang, type Edition } from "./design";
import { drawLayers, fontsReady } from "./draw";
import { fixedReciter, groupItem, pickReciter, reelDesign, reelFor } from "./feed";
import { FONTS_MS, MEASURE_MS, TEXT_MS, timeout, within } from "./reels";
import { reelTextSize } from "./reelText";

export interface TileScene { prefs: Prefs; lang: string; surahs: Surah[]; editions: Record<string, Edition>; brand: string }
/** `box` and `blur`: the frosted glass under the text box (in canvas pixels; blur 0 = none), shown by the tile. */
export interface TileFrame { canvas: HTMLCanvasElement; box: Rect & { radius: number }; blur: number }

/** The share of the tile's height its surah and reference line covers from the bottom: the text stays above it. */
const INSET = 0.16;
const KEEP = 40;
const TILE_TR_STEPS = 2;

const frames = new Map<string, Promise<TileFrame>>();
let chain: Promise<unknown> = Promise.resolve();

/** The tile's frame for `ref` (to `to`) on `clip`, `width` canvas pixels wide (3:4, like the tile). */
export function tileFrame(ref: Ref, to: number, clip: Clip, width: number, scene: TileScene): Promise<TileFrame> {
  const key = `${ref}-${to}|${clip.id}|${width}|${scene.lang}|${scene.prefs.translation ?? ""}|${scene.prefs.feedVoice ? 1 : 0}|${reelTextSize()}`;
  let p = frames.get(key);
  if (!p) {
    p = draw(ref, to, clip, width, scene);
    frames.set(key, p);
    p.catch(() => frames.delete(key)); // tried again next time
    while (frames.size > KEEP) frames.delete(frames.keys().next().value!);
  }
  return p;
}

async function draw(ref: Ref, to: number, clip: Clip, width: number, { prefs, lang, surahs, editions, brand }: TileScene): Promise<TileFrame> {
  // As opening the result builds the reel (warm.ts), so the tile shows the design the reel opens with.
  const item = groupItem(reelFor(ref, { kind: "discover" }, 0, to));
  const recipe = reelDesign(item, { type: "clip", id: clip.id }, fixedReciter(prefs) ?? pickReciter(item.ref, [], prefs.reciter), prefs, lang);
  const surah = surahs[recipe.surah - 1];
  if (!surah) throw new Error("surahs not loaded");
  const [ar, tr] = await timeout(api.getAyahText(recipe.surah, recipe.from, recipe.to, recipe.translation), TEXT_MS);
  const ayahs = ar.ayahs.map((a, i) => ({ num: a.numberInSurah, ar: stripBasmala(a.text, recipe.surah, a.numberInSurah), tr: tr ? tr.ayahs[i].text : "" }));
  // The tile is about a third of a reel's width on a phone: its translation is drawn TILE_TR_STEPS sizes larger than the
  // reel's (owner, 12 Oct 2026: it was too small to read), the rest of the design as it is.
  const s = { recipe: { ...recipe, transSize: Math.min(8, recipe.transSize + TILE_TR_STEPS) }, surah, lang: translationLang(recipe.translation, editions), brand, inset: INSET };
  // Auto contrast reads the poster (the reel's own first measurement too, and the poster it shows while loading).
  const [backdrop] = await Promise.all([
    recipe.autoContrast === false ? null : within(posterBackdrop(clip, recipe.orientation), MEASURE_MS, null),
    within(fontsReady(ayahs, s).then(() => true, () => true), FONTS_MS, false),
  ]);
  const run = chain.then(() => {
    const W = width, H = Math.round((width * 4) / 3);
    const layers = drawLayers(W, H, ayahs, { ...s, backdrop });
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const none = document.createElement("canvas");
    none.width = none.height = 1;
    composeText(canvas.getContext("2d")!, { ...layers, brand: none }, null, 0);
    return { canvas, box: layers.plan.box, blur: layers.plan.blur };
  });
  chain = run.catch(() => {});
  return run;
}
