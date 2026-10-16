// The text block's timeline and compositing, shared by the preview, the Feed, the image export and the video export
// (worker and the real-time fallback), so all of them show the same thing at the same moment. Framework-free and
// DOM-free: it runs in the export worker too. The text itself is drawn once by draw.ts (main thread, browser text
// engine); this module only places those layers and moves them in and out. It never cuts text up: each paragraph is
// drawn whole (draw.ts and split.ts decide the paragraphs).
//
// A design has up to 3 ayahs, shown one after another in the same text block. Each ayah's whole text (its Arabic, its
// translation and the reference) enters as its recitation starts and leaves as it ends (with a translation voice, once
// the voice has read its translation), then the next one enters, so the text on screen is always the ayah being heard. A long ayah (owner, 8 Oct 2026) is shown in parts: each part, with
// its meaning, has its share of the ayah's recitation (proportional to its Arabic length: the recitation files carry no
// word timings) and enters and leaves like an ayah, on the same clock. The last ayah stays through the short tail. Animations
// (owner decision, 8 Oct 2026): none (a cut), fade, rise and zoom (a soft scale), short and eased. The surah header,
// the box and the branding line stay on screen throughout.
import type { Recipe } from "../../../contracts/types";
import type { Treatment } from "./contrast";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Animation = NonNullable<Recipe["animation"]>;
export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

/** One paragraph of the text block (an ayah's Arabic or its translation, or those of one part of a long ayah), drawn
 *  whole on its own layer. */
export interface PartSpec {
  /** Index into the design's ayahs. */
  ayah: number;
  /** Which part of a long ayah it belongs to (TextPlan.sections); 0 or missing: the ayah is shown whole. */
  section?: number;
  kind: "ar" | "tr";
  /** Where the layer's top-left corner goes on the frame. */
  x: number;
  y: number;
}

/** Where everything goes on a W×H frame. Coordinates are frame pixels. */
export interface TextPlan {
  width: number;
  height: number;
  /** The text block (box, border, glass). The same block holds each ayah in turn. */
  box: Rect & { radius: number };
  /** Top-left corner of the box layer (the box plus a margin for its border and Auto contrast's scrim). */
  boxAt: Point;
  /** Where the block and the header may go: inside the frame, above the branding line. */
  area: { top: number; bottom: number };
  /** Effect "shade": the even shade over the whole frame, drawn under everything else (missing = none). */
  shade?: { color: string; alpha: number } | null;
  /** Frosted glass: blur radius (px) of the background behind the box; 0 = no glass. */
  blur: number;
  parts: PartSpec[];
  /** Long ayahs shown in parts: for each ayah, where each of its parts starts in its recitation (fractions of it, the
   *  first 0). Missing, or [0]: the ayah is shown whole. */
  sections?: number[][];
  /** The surah-name header (null = hidden): the area it covers (dragging) and where its layer goes. */
  header: { rect: Rect; at: Point } | null;
  /** Top-left corner of the branding line's layer (fixed). */
  brandAt: Point;
  /** What Auto contrast measured and chose for the block and the header (derived, for checks; null when off). */
  contrast?: { block: Treatment | null; header: Treatment | null; moved: boolean } | null;
}

/** The drawn layers: the branding line, the surah header (null = hidden), the box (null = no box) and one per part. */
export interface TextLayers<I> { plan: TextPlan; brand: I; header: I | null; box: I | null; parts: I[] }

/** When each ayah is recited (seconds from the start of the playback) and how the text moves. `durations`: each ayah's
 *  recitation. `voices`: with a translation voice (voice.ts), how long the voice reads each ayah's translation right
 *  after its recitation (0 or missing: none); the ayah stays on screen through both. `end`: when the timeline ends
 *  (after the tail), so the last ayah leaves then; default: the end of its recitation (and voice). */
export interface Timing { starts: number[]; durations: number[]; voices?: number[]; animation: Animation; end?: number }

export interface PartState { alpha: number; dy: number; scale: number }

export const ENTER = 0.42; // seconds for an ayah to come in, from the start of its recitation
export const EXIT = 0.36;  // seconds for it to leave, ending as its recitation ends
const RISE = 0.024;        // rise: distance travelled while entering, fraction of the frame height (and 60 % of it leaving)
const ZOOM_IN = 0.06;      // zoom: grows from 94 % to full size while entering
const ZOOM_OUT = 0.03;     // and on to 103 % while leaving

const FULL: PartState = { alpha: 1, dy: 0, scale: 1 };
const HIDDEN: PartState = { alpha: 0, dy: 0, scale: 1 };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeInOut = (p: number) => (1 - Math.cos(Math.PI * p)) / 2;

/** Reduced motion (the viewer's setting): rise and zoom play as a fade. Exported files keep the design's animation. */
export const calmer = (a: Animation, reduce: boolean): Animation => (reduce && (a === "rise" || a === "zoom") ? "fade" : a);

/** How long the translation voice reads ayah i's translation after its recitation (0: none). */
const voiceLength = (timing: Timing, i: number) => timing.voices?.[i] ?? 0;

/** The time ayah i is on screen: from the start of its recitation to the start of the next one (the last one to the
 *  end of the timeline). */
export function ayahWindow(timing: Timing, i: number): [number, number] {
  const n = timing.starts.length, from = timing.starts[i] ?? 0;
  const last = (timing.starts[n - 1] ?? 0) + (timing.durations[n - 1] ?? 0) + voiceLength(timing, n - 1);
  return [from, i + 1 < n ? timing.starts[i + 1] : Math.max(last, timing.end ?? last)];
}

/** Index of the ayah on screen at time t (-1 before the first and after the end). */
export function ayahAt(timing: Timing, t: number) {
  for (let i = 0; i < timing.starts.length; i++) {
    const [from, to] = ayahWindow(timing, i);
    if (t >= from && t < to) return i;
  }
  return -1;
}

/** How many parts ayah i is shown in (1: whole). */
export const sectionCount = (plan: Pick<TextPlan, "sections">, i: number) => Math.max(1, plan.sections?.[i]?.length ?? 1);

/** The times part j of ayah i is on screen: its share of the ayah's recitation, from where it starts in the recitation
 *  to where the next part starts; the last part stays as long as the ayah does (through the tail after the last ayah).
 *  With a translation voice the parts come again, in order, while the voice reads the translation, each for the same
 *  share of the voice (split.ts cuts the translation where its length matches the Arabic parts), so what is read on
 *  screen is what is heard: then a part has two windows, the second one in the voice. */
export function sectionWindows(plan: Pick<TextPlan, "sections">, timing: Timing, i: number, j: number): [number, number][] {
  const [from, to] = ayahWindow(timing, i), cuts = plan.sections?.[i];
  if (!cuts || cuts.length < 2) return [[from, to]];
  const run = (start: number, length: number, end: number): [number, number] => {
    const at = (k: number) => (k <= 0 ? start : k >= cuts.length ? end : Math.min(end, start + length * cuts[k]));
    return [at(j), at(j + 1)];
  };
  const d = timing.durations[i] ?? 0, v = voiceLength(timing, i);
  if (!v) return [run(from, d, to)];
  const mid = Math.min(to, from + d);
  return [run(from, d, mid), run(mid, v, to)];
}

/** Part j of ayah i's (first) time on screen, in the ayah's recitation. */
export const sectionWindow = (plan: Pick<TextPlan, "sections">, timing: Timing, i: number, j: number): [number, number] =>
  sectionWindows(plan, timing, i, j)[0];

/** The part of ayah i on screen at time t (before its first part: 0; after its last: the last). */
export function sectionAt(plan: Pick<TextPlan, "sections">, timing: Timing, i: number, t: number) {
  const n = sectionCount(plan, i);
  for (let k = 0; k < n; k++) if (sectionWindows(plan, timing, i, k).some(([a, b]) => t >= a && t < b)) return k;
  return t < ayahWindow(timing, i)[0] ? 0 : n - 1;
}

/** How a block on screen from `from` to `to` looks at time t: it enters as its time starts and leaves as it ends. */
function windowState(plan: Pick<TextPlan, "height">, animation: Animation, from: number, to: number, t: number): PartState {
  if (!(t >= from && t < to)) return HIDDEN;
  if (animation === "none") return FULL;
  // A very short ayah (or part): entering and leaving share at most 70 % of its time.
  const k = Math.min(1, ((to - from) * 0.7) / (ENTER + EXIT));
  const vin = easeOut(clamp01((t - from) / (ENTER * k))), vout = easeInOut(clamp01((to - t) / (EXIT * k)));
  const alpha = vin * vout;
  if (animation === "rise") {
    const d = plan.height * RISE;
    return { alpha, dy: (1 - vin) * d - (1 - vout) * d * 0.6, scale: 1 };
  }
  if (animation === "zoom") return { alpha, dy: 0, scale: (1 - ZOOM_IN * (1 - vin)) * (1 + ZOOM_OUT * (1 - vout)) };
  return { alpha, dy: 0, scale: 1 };
}

/** How ayah `ayah` (shown whole) looks at time t. No timing (images, a paused preview): only ayah `still` is shown, in
 *  full. */
export function ayahState(plan: Pick<TextPlan, "height">, ayah: number, timing: Timing | null, t: number, still = 0): PartState {
  if (!timing) return ayah === still ? FULL : HIDDEN;
  const [from, to] = ayahWindow(timing, ayah);
  return windowState(plan, timing.animation, from, to, t);
}

/** How a layer looks at time t: its ayah's (or, for a long ayah, its part's) time on screen. No timing (images, a
 *  paused preview): only part `section` of ayah `still` is shown, in full (its last part when it has fewer). */
export function partState(plan: TextPlan, part: PartSpec, timing: Timing | null, t: number, still = 0, section = 0): PartState {
  const j = part.section ?? 0;
  if (!timing) return part.ayah === still && j === Math.min(section, sectionCount(plan, still) - 1) ? FULL : HIDDEN;
  const windows = sectionWindows(plan, timing, part.ayah, j);
  const [from, to] = windows.find(([a, b]) => t >= a && t < b) ?? windows[0];
  return windowState(plan, timing.animation, from, to, t);
}

/** Draws the text layers for time t on top of whatever is on `ctx` (the background, and the glass under the box).
 *  Without timing, ayah `still` (its part `section`, for a long ayah) is drawn in full. */
export function composeText<I extends CanvasImageSource>(ctx: Ctx2D, layers: TextLayers<I>, timing: Timing | null, t: number, still = 0, section = 0) {
  const { plan } = layers;
  if (plan.shade) {
    ctx.save();
    ctx.globalAlpha = plan.shade.alpha;
    ctx.fillStyle = plan.shade.color;
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.restore();
  }
  ctx.drawImage(layers.brand, plan.brandAt.x, plan.brandAt.y);
  // The box before the header: the box never covers the header (draw.ts), and the soft edge of Auto contrast's shade
  // that reaches past the box goes under the header, not over it.
  if (layers.box) ctx.drawImage(layers.box, plan.boxAt.x, plan.boxAt.y);
  if (layers.header && plan.header) ctx.drawImage(layers.header, plan.header.at.x, plan.header.at.y);
  const cx = plan.box.x + plan.box.w / 2, cy = plan.box.y + plan.box.h / 2;
  plan.parts.forEach((part, k) => {
    const s = partState(plan, part, timing, t, still, section);
    if (s.alpha <= 0.004) return;
    ctx.save();
    ctx.globalAlpha = s.alpha;
    if (s.scale !== 1) { ctx.translate(cx, cy); ctx.scale(s.scale, s.scale); ctx.translate(-cx, -cy); }
    if (s.dy) ctx.translate(0, s.dy);
    ctx.drawImage(layers.parts[k], part.x, part.y);
    ctx.restore();
  });
}

const moveRect = <R extends Rect>(r: R, dx: number, dy: number): R => ({ ...r, x: r.x + dx, y: r.y + dy });

/** Moves the text block by (dx, dy) without redrawing it (dragging). */
export function shiftPlan(plan: TextPlan, dx: number, dy: number): TextPlan {
  if (!dx && !dy) return plan;
  return {
    ...plan,
    box: moveRect(plan.box, dx, dy),
    boxAt: { x: plan.boxAt.x + dx, y: plan.boxAt.y + dy },
    parts: plan.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
}

/** Moves the surah header by (dx, dy) without redrawing it (dragging). */
export function shiftHeader(plan: TextPlan, dx: number, dy: number): TextPlan {
  if ((!dx && !dy) || !plan.header) return plan;
  const { rect, at } = plan.header;
  return { ...plan, header: { rect: moveRect(rect, dx, dy), at: { x: at.x + dx, y: at.y + dy } } };
}

/** Where the centre of a w×h block (the text block or the header) may go: inside the frame, above the branding. */
export function clampCentre(plan: Pick<TextPlan, "width" | "area">, w: number, h: number, cx: number, cy: number) {
  const { top, bottom } = plan.area;
  const x = w >= plan.width ? plan.width / 2 : Math.min(plan.width - w / 2, Math.max(w / 2, cx));
  const y = h >= bottom - top ? (top + bottom) / 2 : Math.min(bottom - h / 2, Math.max(top + h / 2, cy));
  return { x, y };
}

// ---------- glass ----------

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
const scratch: AnyCanvas[] = [];
function scratchCanvas(i: number, w: number, h: number): AnyCanvas {
  let c = scratch[i];
  if (!c) c = scratch[i] = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else (c.getContext("2d") as Ctx2D).clearRect(0, 0, w, h);
  return c;
}

/** True when the canvas can blur (ctx.filter). Older browsers fall back to a downscale blur. */
export const canvasCanFilter = (ctx: Ctx2D) => typeof (ctx as { filter?: unknown }).filter === "string";

/** Frosted glass: blurs what is already drawn on `ctx` inside the box (call after the background, before the text
 *  layers). Blurs a downscaled copy of the area (fast enough for every video frame), with a downscale-only blur where
 *  the canvas has no filter. */
export function drawGlass(ctx: Ctx2D, plan: TextPlan) {
  const { box, blur, width: W, height: H } = plan;
  if (!blur) return;
  const m = blur * 2;
  const sx = Math.max(0, Math.floor(box.x - m)), sy = Math.max(0, Math.floor(box.y - m));
  const sw = Math.min(W, Math.ceil(box.x + box.w + m)) - sx, sh = Math.min(H, Math.ceil(box.y + box.h + m)) - sy;
  if (sw <= 0 || sh <= 0) return;
  const filter = canvasCanFilter(ctx), k = 4;
  const w = Math.max(1, Math.round(sw / k)), h = Math.max(1, Math.round(sh / k));
  let small = scratchCanvas(0, w, h);
  const sctx = small.getContext("2d") as Ctx2D;
  sctx.imageSmoothingQuality = "high";
  if (filter) {
    sctx.filter = `blur(${blur / k}px)`;
    sctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, w, h);
    sctx.filter = "none";
  } else {
    // No filter: shrink twice more and grow back; the bilinear scaling smears the detail away.
    sctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, w, h);
    const w2 = Math.max(1, Math.round(w / 6)), h2 = Math.max(1, Math.round(h / 6));
    const tiny = scratchCanvas(1, w2, h2), tctx = tiny.getContext("2d") as Ctx2D;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(small, 0, 0, w2, h2);
    small = scratchCanvas(0, w, h);
    const s2 = small.getContext("2d") as Ctx2D;
    s2.imageSmoothingQuality = "high";
    s2.drawImage(tiny, 0, 0, w, h);
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, box.radius);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, w, h, sx, sy, sw, sh);
  ctx.restore();
}
