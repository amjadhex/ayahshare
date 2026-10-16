// Auto contrast (owner decision, 8 Oct 2026): keeps the ayah, its translation and the surah name readable on any
// background. backdrop.ts measures the background on the device (a few frames of the clip, drawn very small); this
// module reads what lies behind a given area of the frame and picks the least visible fix that reaches WCAG contrast
// (4.5:1 for the translation and the surah line, 3:1 for large Arabic):
//   none  → the background is already dark enough (light text) or light enough (dark text)
//   halo  → a soft halo around the letters
//   box   → a glass or solid box gets more opacity, only as much as needed (the person's own effect stays)
//   scrim → a soft, feathered shade behind the block only, its opacity solved from the contrast needed
//   dark  → very bright, plain backgrounds (white sky, snow): dark text with a light halo instead of darkening the image
// Busy textures push one step stronger. Everything here is derived from the measurement; only the on/off switch is
// stored in the design. Pure and framework-free (tests run it directly).

/** Luminance samples of a background: `frames` grids of w×h relative luminance (0..1, linear light), taken at fixed
 *  times across a clip (one frame for a colour or a still), keeping the source's own aspect ratio. */
export interface Backdrop { key: string; w: number; h: number; frames: Float32Array[] }

export interface Area { x: number; y: number; w: number; h: number }

/** What lies behind an area, over every sampled frame. Luminance values are relative luminance (WCAG); `busy` and
 *  `edges` are measured on gamma-encoded luma (0..1), as the eye sees texture. */
export interface AreaStats {
  /** The brightest 5 % (95th percentile): what breaks light text. */
  p95: number;
  /** The darkest 5 %: what breaks dark text. */
  p5: number;
  mean: number;
  /** Texture: the spread of luma inside the area (standard deviation, averaged over the frames). */
  busy: number;
  /** Detail: the mean luma step between neighbouring cells. */
  edges: number;
}

export type Level = "none" | "halo" | "box" | "scrim" | "dark";

export interface Treatment {
  level: Level;
  /** Text colour to draw with: the design's, or the opposite one for "dark". */
  text: string;
  /** A halo drawn around the letters (null = none). */
  halo: { color: string; alpha: number } | null;
  /** The feathered shade behind the block or the header (null = none). */
  scrim: { color: string; alpha: number } | null;
  /** Glass / solid box opacity to draw (0..100); the design's own when nothing is raised. */
  boxOpacity: number;
  /** Contrast reached against the measured background, and the target. */
  contrast: number;
  target: number;
  stats: AreaStats;
}

export const TARGET_TEXT = 4.5;   // translation, surah line (normal size text)
export const TARGET_LARGE = 3;    // the Arabic (large text)
/** The halo is a soft glow behind the letters (a blurred stroke, draw.ts drawGlow). Measured in the browser on the
 *  app's fonts: at full opacity it darkens the background 2–6 px around the letters by at least 34 % (95th
 *  percentile, Arabic; 36–46 % for the translation and the surah line), and proportionally less at lower opacity.
 *  Shadows alone (the design's own Shadow effect, the surah name's usual halo) do almost nothing there and are not
 *  counted. */
export const HALO_K = 0.34;
const HALO_MAX = 0.85;
const MAX_SCRIM = 0.8;
/** Opacities are solved for 10 % more than the target: the measurement averages small areas, and single pixels around
 *  the letters can be a little brighter than the brightest cell. */
const AIM = 1.1;
const BUSY = 0.13;
const EDGES = 0.075;
export const DARK_TEXT = "#141414";
export const LIGHT_TEXT = "#ffffff";

/** Effect "shade" (owner, 12 Oct 2026): one even shade over the whole frame instead of a box, so the text needs no box,
 *  halo or colour change. On a clip it is never lighter than SHADE_MIN (the look); never darker than SHADE_MAX (the
 *  clip must still show). Without a measurement (Auto contrast off), SHADE_FIXED. With nothing else helping the
 *  letters, it is solved for SHADE_AIM times the target, and a busy texture behind the text gets SHADE_BUSY more. */
export const SHADE_MIN = 0.4, SHADE_MAX = 0.7, SHADE_FIXED = 0.5;
const SHADE_AIM = 1.25, SHADE_BUSY = 0.1;

// ---------- colour maths ----------

const LINEAR = new Float32Array(256).map((_, i) => toLinear(i / 255));
export function toLinear(c: number) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function toSrgb(l: number) { return l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; }

/** WCAG relative luminance of 8-bit sRGB. */
export const luminance = (r: number, g: number, b: number) => 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
export function luminanceOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return luminance(n >> 16, (n >> 8) & 255, n & 255);
}
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Luminance of `l` under a colour of luminance `over` at opacity `a`. The canvas blends in sRGB, so the mix is done
 *  on gamma-encoded values. */
export const blend = (l: number, over: number, a: number) => toLinear(toSrgb(l) * (1 - a) + toSrgb(over) * a);

/** Text on a light background needs it darker, and the other way round. */
export const isLight = (hex: string) => luminanceOf(hex) > 0.179;

// ---------- reading an area ----------

/** Cells of the backdrop behind `area` of a W×H frame on which the source is drawn to cover (centre crop, as drawCover
 *  does). The area is rounded to 1 % of the frame first, so the preview, the Feed and the export (other pixel sizes)
 *  read exactly the same cells. */
function cellsOf(b: Backdrop, W: number, H: number, area: Area) {
  const k = Math.max(W / b.w, H / b.h), ox = (W - b.w * k) / 2, oy = (H - b.h * k) / 2;
  const r = (v: number, d: number) => (Math.round((v / d) * 100) / 100) * d;
  const x0 = r(area.x, W), y0 = r(area.y, H), x1 = r(area.x + area.w, W), y1 = r(area.y + area.h, H);
  const cx = (x: number) => Math.min(b.w - 1, Math.max(0, Math.floor((x - ox) / k)));
  const cy = (y: number) => Math.min(b.h - 1, Math.max(0, Math.floor((y - oy) / k)));
  return { c0: cx(x0), c1: cx(Math.max(x0, x1 - 0.001)), r0: cy(y0), r1: cy(Math.max(y0, y1 - 0.001)) };
}

export function areaStats(b: Backdrop, W: number, H: number, area: Area): AreaStats {
  const { c0, c1, r0, r1 } = cellsOf(b, W, H, area);
  const all: number[] = [];
  let busy = 0, edges = 0, steps = 0;
  for (const f of b.frames) {
    let sum = 0, sq = 0, n = 0;
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const l = f[y * b.w + x], v = toSrgb(l);
        all.push(l);
        sum += v; sq += v * v; n++;
        if (x < c1) { edges += Math.abs(toSrgb(f[y * b.w + x + 1]) - v); steps++; }
        if (y < r1) { edges += Math.abs(toSrgb(f[(y + 1) * b.w + x]) - v); steps++; }
      }
    }
    const mean = sum / n;
    busy += Math.sqrt(Math.max(0, sq / n - mean * mean));
  }
  all.sort((p, q) => p - q);
  const at = (q: number) => all[Math.min(all.length - 1, Math.max(0, Math.round(q * (all.length - 1))))];
  return {
    p95: at(0.95), p5: at(0.05), mean: all.reduce((s, v) => s + v, 0) / all.length,
    busy: busy / b.frames.length, edges: steps ? edges / steps : 0,
  };
}

// ---------- choosing the fix ----------

export interface Need {
  /** The design's text colour. */
  text: string;
  target: number;
  /** The design's glass / solid box (null for shadow, outline and none); `sheen`: the white glass sheen drawn over it
   *  (at most, at its top). */
  box: { color: string; opacity: number; max: number; sheen?: number } | null;
}

const up = (v: number, step: number) => Math.round(Math.ceil(v / step - 1e-9) * step * 100) / 100;

/** The smallest opacity `a` (0..1) of colour `over` that brings `bg` to `target` against the text; Infinity if none. */
function opacityFor(text: number, bg: number, over: number, target: number) {
  if (contrastRatio(text, bg) >= target) return 0;
  if (contrastRatio(text, over) < target) return Infinity;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(text, blend(bg, over, mid)) >= target) hi = mid; else lo = mid;
  }
  return hi;
}

/** The shade for effect "shade": the least opacity that brings the brightest part behind every area (the text block,
 *  the surah line) to `target` against text of colour `text`, between `min` and SHADE_MAX. Light text gets a black
 *  shade, dark text a white one. */
export function shadeFor(areas: AreaStats[], text: string, target: number, min = SHADE_MIN): { color: string; alpha: number } {
  const lt = luminanceOf(text), light = lt > 0.179;
  const worst = light ? Math.max(...areas.map((a) => a.p95)) : Math.min(...areas.map((a) => a.p5));
  const busy = areas.some((s) => s.busy > BUSY || s.edges > EDGES);
  const a = Math.max(min, opacityFor(lt, worst, light ? 0 : 1, target * SHADE_AIM)) + (busy ? SHADE_BUSY : 0);
  return { color: light ? "#000000" : "#ffffff", alpha: Math.round(Math.min(SHADE_MAX, a) * 100) / 100 };
}

/** The least visible treatment that keeps text of colour `need.text` readable over an area with these stats. */
export function solve(stats: AreaStats, need: Need): Treatment {
  const lt = luminanceOf(need.text), light = lt > 0.179, target = need.target, aim = target * AIM;
  // Light text is broken by the brightest parts, dark text by the darkest.
  const worst = light ? stats.p95 : stats.p5, towards = light ? 0 : 1;
  const shade = light ? "#000000" : "#ffffff";
  const c0 = contrastRatio(lt, worst);
  const busy = (stats.busy > BUSY || stats.edges > EDGES) && c0 < target * 2;
  const result = (t: Partial<Treatment> & { level: Level; contrast: number }): Treatment => ({
    text: need.text, halo: null, scrim: null, boxOpacity: need.box ? need.box.opacity : 0, target, stats, ...t,
  });
  const glow = (alpha: number) => ({ color: shade, alpha: Math.min(HALO_MAX, up(alpha, 0.05)) });

  // Glass / solid: raise the box's opacity only as far as needed (and a little more on a busy background).
  if (need.box) {
    const boxL = luminanceOf(need.box.color), o0 = need.box.opacity / 100, sheen = need.box.sheen ?? 0;
    const under = (o: number) => blend(blend(worst, boxL, o), 1, sheen); // what the letters sit on
    const reached = (o: number) => contrastRatio(lt, under(o));
    if (reached(o0) >= aim && !busy) return result({ level: "none", contrast: reached(o0) });
    let needed = Infinity;
    for (let o = o0; o <= need.box.max + 1e-9; o += 0.01) if (reached(o) >= aim) { needed = o; break; }
    if (Number.isFinite(needed)) {
      const o = Math.min(need.box.max, up(Math.max(o0, needed + (busy ? 0.08 : 0)), 0.01));
      return result({ level: o > o0 ? "box" : "none", boxOpacity: Math.round(o * 100), contrast: reached(o) });
    }
    // The box cannot get there on its own (its colour is too close to the text's): as far as it helps, plus a glow.
    const o = reached(need.box.max) > reached(o0) ? need.box.max : o0;
    const halo = glow(HALO_MAX);
    return result({ level: "box", boxOpacity: Math.round(o * 100), halo, contrast: contrastRatio(lt, blend(under(o), towards, HALO_K * halo.alpha)) });
  }

  if (c0 >= aim && !busy) return result({ level: "none", contrast: c0 });
  // A soft glow around the letters, as strong as needed; a busy background that is dark enough still gets a light one.
  const cover = opacityFor(lt, worst, towards, aim);
  if (cover <= HALO_K * HALO_MAX && !(busy && c0 < aim)) {
    const halo = glow(Math.max(cover / HALO_K, busy ? 0.5 : 0.35));
    return result({ level: "halo", halo, contrast: contrastRatio(lt, blend(worst, towards, HALO_K * halo.alpha)) });
  }

  // A soft scrim behind the block, solved exactly; busy backgrounds get a little more, and a light glow for the edges.
  let a = cover;
  if (busy) a = Math.max(a + 0.1, 0.25);
  a = Math.min(MAX_SCRIM, up(a, 0.05));
  const scrimmed = contrastRatio(lt, blend(worst, towards, a));

  // Very bright (or, for dark text, very dark) plain backgrounds: switch the text instead of shading the image.
  const flip = light ? DARK_TEXT : LIGHT_TEXT, lf = luminanceOf(flip);
  const other = light ? stats.p5 : stats.p95; // the flipped text is broken by the other extreme
  const flipped = contrastRatio(lf, other);
  const plain = stats.busy < BUSY * 0.6 && stats.edges < EDGES * 0.6;
  if (plain && a >= 0.3 && flipped >= target * 1.25 && (light ? toSrgb(stats.p5) >= 0.6 : toSrgb(stats.p95) <= 0.2)) {
    return result({ level: "dark", text: flip, halo: { color: light ? "#ffffff" : "#000000", alpha: 0.5 }, contrast: flipped });
  }
  return result({ level: "scrim", scrim: { color: shade, alpha: a }, halo: busy ? glow(0.4) : null, contrast: scrimmed });
}

/** How visible a treatment is (lower is calmer); used to decide whether moving the text block clearly helps. */
export function cost(t: Treatment, ownOpacity = 0) {
  switch (t.level) {
    case "none": return 0;
    case "halo": return 1;
    case "box": return 1 + Math.max(0, t.boxOpacity - ownOpacity) / 25 + (t.halo ? 1 : 0);
    case "dark": return 2.5;
    case "scrim": return 2 + (t.scrim?.alpha ?? 0) * 3;
  }
}
