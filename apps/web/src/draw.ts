// The text layer. The same code lays out and draws the preview and every exported image and video frame, so what you
// see is what you get. Arabic is shaped by the browser's text engine (canvas), whole lines at a time, never by a video
// tool and never letter by letter. Framework-free: everything it needs comes in as arguments.
//
// The design is drawn as layers (compose.ts puts them together): the branding line (fixed), the surah header (movable),
// the text box (glass / solid / border, and Auto contrast's soft scrim), and one layer per paragraph: each ayah's Arabic
// and its translation. The ayahs take turns in the same box, so the box is sized for the longest one and each ayah is
// centred in it. Separate layers let the video move each ayah in and out without redrawing text.
//
// Long ayahs in parts (owner, 8 Oct 2026; Recipe.splitLong, on by default): an ayah that would have to shrink well below
// the design's text size to fit whole is shown in parts that take turns like ayahs, each part's Arabic with its share of
// the translation (split.ts cuts them, at the mushaf's pause marks only). Normal ayahs stay whole.
//
// Auto contrast (contrast.ts): with a measurement of the background (backdrop.ts), the block and the header each get
// the least visible fix that keeps them readable, decided once per design (no flicker). With it off, the design's own
// colours and effect are drawn as they are.
import type { Recipe, Surah } from "../../../contracts/types";
import { clampCentre, type PartSpec, type Rect, type TextLayers, type TextPlan } from "./compose";
import { DEFAULT_STYLE, LANG_FONT, LINE_HEIGHT, RECIPE_EXTRAS, RTL } from "./config";
import { areaStats, cost, HALO_K, isLight, SHADE_FIXED, SHADE_MIN, shadeFor, solve, TARGET_LARGE, TARGET_TEXT, type Backdrop, type Need, type Treatment } from "./contrast";
import type { LoadedAyah } from "./design";
import { splitAyah } from "./split";
import { t } from "./strings";

/** What the text layer depends on besides the ayahs: the design, its surah, the translation's language, the app's name
 *  (the branding line) and, for Auto contrast, the measured background (null or missing: drawn without it). */
/** `inset`: the share of the frame's height, from the bottom, that the screen covers with its own controls (Reels and
 *  the stories: the surah, reciter and Customize); the header and text stay above it (they shrink to fit). Exports and
 *  the editor pass none, so their layout is unchanged. */
export interface Scene { recipe: Recipe; surah: Surah; lang: string; brand: string; backdrop?: Backdrop | null; inset?: number }

export type Canvas = HTMLCanvasElement;
export type Layers = TextLayers<Canvas>;

const PRELOADED = ["Amiri Quran", "Inter", "Noto Sans"]; // #fontsCss in index.html, loaded without blocking paint
let baseFonts: Promise<void> | null = null;
const whenBaseFonts = () => (baseFonts ??= new Promise<void>((resolve) => {
  // The preload turns into a stylesheet on load; wait until it is applied (at most 4 s, e.g. offline).
  const link = document.getElementById("fontsCss") as HTMLLinkElement | null, started = Date.now();
  const check = () => (!link || link.sheet || Date.now() - started > 4000 ? resolve() : setTimeout(check, 50));
  check();
}));
const fontLinks = new Map<string, Promise<void>>();

/** Loads a Google Fonts family on first use (translations in other scripts, alternative Quran fonts). */
export function ensureFont(family: string): Promise<void> {
  if (PRELOADED.includes(family)) return whenBaseFonts();
  if (!fontLinks.has(family)) {
    fontLinks.set(family, new Promise((resolve) => {
      const link = Object.assign(document.createElement("link"), {
        rel: "stylesheet",
        href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;600&display=swap`,
      });
      link.onload = link.onerror = () => resolve();
      document.head.append(link);
    }));
  }
  return fontLinks.get(family)!;
}

export const arabicDigits = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
const trFont = (lang: string) => LANG_FONT[lang] || "Noto Sans";
/** The translation's canvas font: its web font, then the generic sans-serif, so a script the web font does not cover
 *  (or a web font that has not loaded) falls back the same way when measuring and when drawing. */
export const trFontCss = (px: number, family: string) => `${px}px "${family}", sans-serif`;

/** Waits for every font the design needs. */
export async function fontsReady(ayahs: LoadedAyah[], { recipe: r, lang }: Scene) {
  const family = trFont(lang);
  await Promise.all([ensureFont(family), ensureFont(r.font), whenBaseFonts(), brandMarkReady()]);
  await Promise.all([
    document.fonts.load(`40px "${r.font}"`, `${ayahs.map((a) => a.ar).join(" ")} ۝٠١٢٣٤٥٦٧٨٩`),
    document.fonts.load(`40px "${family}"`, ayahs.map((a) => a.tr).join(" ") || "a"),
    document.fonts.load('500 30px "Inter"'),
    document.fonts.load('400 30px "Inter"'), // the watermark's website
  ]);
}

type Ctx = CanvasRenderingContext2D;

// The brand mark for the watermark (drawBranding), loaded once with the fonts. Drawing it needs the decoded image, so
// fontsReady waits for it (at most 2 s; without it the watermark is the website alone).
const BRAND_MARK = "/brand/mark-white.svg";
let brandMark: HTMLImageElement | null = null;
let brandMarkLoad: Promise<void> | null = null;
function brandMarkReady() {
  return (brandMarkLoad ??= new Promise<void>((resolve) => {
    const img = new Image();
    const done = () => resolve();
    img.onload = () => { brandMark = img; done(); };
    img.onerror = done;
    setTimeout(done, 2000);
    img.src = BRAND_MARK;
  }));
}

export function hexA(hex: string, opacity: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${opacity})`;
}

const newCanvas = (w: number, h: number) =>
  Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });

function wrap(ctx: Ctx, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** One screen of the text block, as drawn: a whole ayah, or one part of a long one (its ayah-number marker and reference
 *  end the ayah's last part). */
interface Screen { ayah: number; section: number; ar: string; tr: string }

const SHRINK = 0.92; // each step of the size loop (the text shrinks until the longest screen fits)
// Long ayahs (Recipe.splitLong): a screen is too much when, shrunk to fit, its Arabic takes more than MAX_LINES lines or
// it has to shrink more than LONG_SHRINKS steps (below 78 % of its size, no longer comfortably readable). An ayah is long
// when it is too much whole at the design's text size, or at the default size when the design's is larger (larger
// text never makes a normal ayah long). Measured on the 1080 px layout of the design's orientation, at the default
// sizes: 3.6 % of ayahs in portrait (2:255 among them), 7.6 % in square, 1.6 % in landscape.
const MAX_LINES = 5;
const LONG_SHRINKS = 3;
const MAX_PARTS = 8;

const BRAND_HEIGHT = 64; // at 1080 px (owner, 9 and 12 Oct 2026: a bigger watermark; the text block keeps clear of it)

/** The brand watermark (owner, 8 Oct 2026): the AyahShare mark and the website, like a logo watermark, in place of the
 *  old "Created with AyahShare" line. The only place it is drawn: the Create preview, exported images and videos, Feed
 *  reels and the videos shared from them, link previews and saved-design thumbnails all get it from here. `u` is the
 *  frame's scale (short side / 1080). White and quiet with a soft shadow, so it reads on light and dark backgrounds;
 *  if the mark has not loaded (offline first run), the website is drawn alone. */
export function drawBranding(_name: string, u: number): Canvas {
  // Owner, 12 Oct 2026: about a fifth bigger, the website in a lighter weight (regular, was semibold).
  const height = BRAND_HEIGHT * u, size = 48 * u, gap = 13 * u, pad = 12 * u, font = `400 ${34 * u}px Inter`, label = t.brandSite;
  const measure = newCanvas(1, 1).getContext("2d")!;
  measure.direction = "ltr"; measure.font = font;
  const logo = brandMark;
  const width = pad * 2 + (logo ? size + gap : 0) + measure.measureText(label).width;
  const layer = newCanvas(width, height), ctx = layer.getContext("2d")!;
  ctx.globalAlpha = 0.9;
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 6 * u; ctx.shadowOffsetY = 1 * u;
  if (logo) ctx.drawImage(logo, pad, (height - size) / 2, size, size);
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.direction = "ltr"; ctx.font = font;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, pad + (logo ? size + gap : 0), height / 2 + 1 * u);
  return layer;
}

/** A soft shade: a rounded rectangle blurred at its edges (a canvas shadow, so it works where the canvas has no blur
 *  filter), drawn at (x, y, w, h) on `c`. */
function drawScrim(c: Ctx, x: number, y: number, w: number, h: number, radius: number, color: string, alpha: number, feather: number) {
  const away = 4 * (w + h + feather); // the shape itself is drawn off the canvas; only its shadow lands here
  c.save();
  c.shadowColor = hexA(color, alpha);
  c.shadowBlur = feather;
  c.shadowOffsetX = away;
  c.fillStyle = "#000";
  c.beginPath();
  c.roundRect(x - away, y, w, h, radius);
  c.fill();
  c.restore();
}

/** Auto contrast's halo: a soft glow behind the letters of `text` at (x, y), a blurred stroke (also a canvas shadow,
 *  drawn from off the canvas). Draw the text itself after it. Its strength is calibrated in contrast.ts (HALO_K). */
function drawGlow(c: Ctx, text: string, x: number, y: number, color: string, alpha: number, u: number) {
  const away = 4 * (c.canvas.width + c.canvas.height);
  c.save();
  c.shadowColor = hexA(color, alpha);
  c.shadowBlur = 12 * u;
  c.shadowOffsetX = away;
  c.shadowOffsetY = 0;
  c.lineJoin = "round";
  c.lineWidth = 18 * u;
  c.strokeStyle = "#000";
  c.fillStyle = "#000";
  c.strokeText(text, x - away, y);
  c.fillText(text, x - away, y);
  c.restore();
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** The text block was placed by the person (dragged or nudged), so Auto contrast leaves it where it is. */
const placed = (r: Recipe) => (r.textX ?? RECIPE_EXTRAS.textX) !== RECIPE_EXTRAS.textX || (r.textY ?? RECIPE_EXTRAS.textY) !== RECIPE_EXTRAS.textY;

/** For checks: the last few Auto contrast decisions, as performance marks named "qd-contrast". */
function report(detail: Record<string, unknown>) {
  try {
    if (performance.getEntriesByName("qd-contrast").length >= 40) performance.clearMarks("qd-contrast");
    performance.mark("qd-contrast", { detail });
  } catch { /* old browsers */ }
}
const summary = (tr: Treatment | null) => tr && {
  level: tr.level, contrast: Math.round(tr.contrast * 100) / 100, target: tr.target, text: tr.text, scrim: tr.scrim?.alpha ?? 0,
  halo: !!tr.halo, boxOpacity: tr.boxOpacity, p95: +tr.stats.p95.toFixed(3), p5: +tr.stats.p5.toFixed(3),
  busy: +tr.stats.busy.toFixed(3), edges: +tr.stats.edges.toFixed(3),
};

/** Lays out and draws the design's text layers on a W×H frame (the layout scales with the frame's short side). Call
 *  after fontsReady(), or a font that is still loading is drawn with a fallback. */
export function drawLayers(W: number, H: number, ayahs: LoadedAyah[], { recipe: r, surah: s, lang, brand, backdrop, inset = 0 }: Scene): Layers {
  const x = RECIPE_EXTRAS, effect = r.effect ?? x.effect;
  const showSurah = r.showSurah ?? x.showSurah, showRef = r.showRef ?? x.showRef;
  const showTr = (r.showTranslation ?? x.showTranslation) && ayahs.some((a) => a.tr);
  const u = Math.min(W, H) / 1080, land = W > H;
  const family = trFont(lang), trDir: CanvasDirection = RTL.has(lang) ? "rtl" : "ltr";
  const measure = newCanvas(1, 1).getContext("2d")!;
  const onClip = r.bg.type === "clip";
  const auto = r.autoContrast !== false && backdrop ? backdrop : null;
  // Effect "shade": the whole frame is shaded (below) instead of Auto contrast treating the block and the header.
  const shaded = effect === "shade";

  // The branding line keeps its place at the bottom; the text block and the header may go anywhere above it.
  // Owner, 12 Oct 2026: the mark a little lower (3.5 % up, was 4.5 %), centred between the reel's reciter row and the
  // bottom edge (reels.css .reel-info). The text keeps its old room (from 4.5 %), so no layout or long-ayah split changes.
  const brandH = BRAND_HEIGHT * u, brandY = H - H * (land ? 0.06 : 0.035), textFloor = H - H * (land ? 0.06 : 0.045);
  const area = { top: H * 0.03, bottom: Math.min(textFloor - brandH / 2 - 16 * u, H * (1 - Math.min(0.5, Math.max(0, inset)))) };

  // ---------- surah header (movable) ----------
  let header: Canvas | null = null, headerPlan: TextPlan["header"] = null, headTreat: Treatment | null = null;
  const headH = 132 * u, headCentre = (r.headerY ?? x.headerY) * H;
  if (showSurah) {
    const range = r.to > r.from ? `${r.from}–${r.to}` : `${r.from}`;
    const sub = [s.name_en, s.meaning, showRef ? `${r.surah}:${range}` : ""].filter(Boolean).join(" · ");
    const arFont = `${44 * u}px "${r.font}"`, subFont = `500 ${26 * u}px Inter`;
    measure.direction = "rtl"; measure.font = arFont;
    const arW = measure.measureText(s.name_ar).width;
    measure.direction = "ltr"; measure.font = subFont;
    const headW = Math.min(W, Math.max(arW, measure.measureText(sub).width) + 64 * u);
    const c = clampCentre({ width: W, area }, headW, headH, (r.headerX ?? x.headerX) * W, headCentre);
    const rect = { x: c.x - headW / 2, y: c.y - headH / 2, w: headW, h: headH };
    // The header sits on the background itself. Its surah line is normal-size text.
    if (auto && !shaded) headTreat = solve(areaStats(auto, W, H, rect), { text: r.textColor, target: TARGET_TEXT, box: null });
    // A clean label (owner, 8 Oct 2026): no outline and no doubled shadow. Where the background already gives enough
    // contrast, the name sits on it with one soft shadow. Where it does not, Auto contrast's strength becomes a rounded
    // chip behind the name: a chip of alpha a blends the background like the centre of a scrim or halo of that strength,
    // so it reaches the same contrast.
    const chip = headTreat?.scrim ?? (headTreat?.halo ? { color: headTreat.halo.color, alpha: HALO_K * headTreat.halo.alpha } : null);
    const m = Math.ceil(16 * u);
    header = newCanvas(headW + 2 * m, headH + 2 * m);
    const h = header.getContext("2d")!;
    if (chip) {
      h.fillStyle = hexA(chip.color, Math.min(0.7, Math.max(0.24, chip.alpha)));
      h.beginPath(); h.roundRect(m, m, headW, headH, 28 * u); h.fill();
    }
    const lines: [string, string, CanvasDirection, number, number][] = [
      [s.name_ar, arFont, "rtl", 42 * u, 1], [sub, subFont, "ltr", 94 * u, 0.85],
    ];
    h.textAlign = "center"; h.textBaseline = "middle";
    h.fillStyle = headTreat?.text ?? r.textColor;
    if (!chip && onClip && headTreat?.level !== "dark") {
      h.shadowColor = "rgba(0,0,0,0.35)"; h.shadowBlur = 10 * u; h.shadowOffsetY = 1 * u;
    }
    for (const [text, font, dir, y, alpha] of lines) {
      h.direction = dir; h.font = font; h.globalAlpha = alpha;
      h.fillText(text, m + headW / 2, m + y);
    }
    h.shadowColor = "transparent"; h.shadowBlur = 0; h.shadowOffsetY = 0;
    h.globalAlpha = 1;
    headerPlan = { rect, at: { x: Math.round(rect.x - m), y: Math.round(rect.y - m) } }; // whole pixels: see the text layers
  }

  // ---------- branding line (fixed) ----------
  const brandLayer = drawBranding(brand, u);
  const brandAt = { x: Math.round((W - brandLayer.width) / 2), y: Math.round(brandY - brandH / 2) }; // whole pixels: see the text layers

  // ---------- text block: sized for the longest screen, shrinking the text until it fits ----------
  // The block never covers the surah header: it goes in the band below the header (or above it, when the block's place
  // is above the header's centre or there is too little room below), a gap away from it, and is sized to fit there.
  // The size budget is at most the room between the header's usual place and the branding, so moving the header up
  // never changes the text size; moving it down into the block's way makes the text smaller (or a long ayah split).
  const boxW = (r.textWidth || (land ? 0.72 : 0.86)) * W;
  const pad = Math.min(48 * u, boxW * 0.07), maxW = boxW - 2 * pad;
  const roomTop = showSurah ? x.headerY * H + headH / 2 + 12 * u : H * 0.06;
  const gap = 12 * u, boxX = clampCentre({ width: W, area }, boxW, 0, (r.textX ?? x.textX) * W, 0).x;
  const head = headerPlan?.rect;
  let band = area;
  if (head && head.x < boxX + boxW / 2 && boxX - boxW / 2 < head.x + head.w) {
    const below = { top: Math.min(area.bottom, head.y + head.h + gap), bottom: area.bottom };
    const above = { top: area.top, bottom: Math.max(area.top, head.y - gap) };
    const size = (b: typeof area) => b.bottom - b.top;
    const wantBelow = (r.textY ?? x.textY) * H >= head.y + head.h / 2;
    band = wantBelow ? (size(below) < H * 0.3 && size(above) > size(below) ? above : below)
      : (size(above) < H * 0.3 && size(below) > size(above) ? below : above);
  }
  const maxH = Math.min(band.bottom - band.top, area.bottom - roomTop, H * 0.72);
  const qs0 = (28 + r.quranSize * 10) * u, ts0 = (20 + r.transSize * 6) * u;
  const trLine = LINE_HEIGHT[lang] || 1.45, blockGap = 26 * u;
  /** The screens' lines at Quran size q and translation size s, and their heights. */
  const lay = (screens: Screen[], q: number, s: number) => {
    measure.font = `${q}px "${r.font}"`; measure.direction = "rtl";
    const ar = screens.map((sc) => wrap(measure, sc.ar, maxW));
    measure.font = trFontCss(s, family); measure.direction = trDir;
    const tr = screens.map((sc) => (sc.tr ? wrap(measure, sc.tr, maxW) : []));
    const heights = ar.map((lines, k) => lines.length * q * 1.9 + (tr[k].length ? blockGap + tr[k].length * s * trLine : 0));
    return { ar, tr, heights, textH: Math.max(0, ...heights) };
  };
  // Deciding which ayahs to show in parts tries many layouts, so it counts lines from word widths measured once (at
  // 100 px, scaled): fast, and the same at every size of the frame, so the preview, both export sizes and the
  // thumbnails cut an ayah the same way. The drawn layout (lay) measures whole lines.
  const widths = new Map<string, number>();
  const widthOf = (font: (px: number) => string, dir: CanvasDirection, word: string) => {
    const key = `${font(100)}|${dir}|${word}`;
    let w = widths.get(key);
    if (w === undefined) {
      measure.font = font(100); measure.direction = dir;
      widths.set(key, (w = measure.measureText(word).width / 100));
    }
    return w;
  };
  const count = (text: string, font: (px: number) => string, dir: CanvasDirection, size: number) => {
    const space = widthOf(font, dir, " ") * size;
    let lines = 0, line = -1;
    for (const word of text.split(/\s+/)) {
      if (!word) continue;
      const w = widthOf(font, dir, word) * size;
      if (line >= 0 && line + space + w > maxW) { lines++; line = w; } else line = line < 0 ? w : line + space + w;
    }
    return line < 0 ? lines : lines + 1;
  };
  /** How these screens fit, starting at sizes q and s: the shrink steps they need (more than `max`: max + 1) and the
   *  most Arabic lines on one of them at that size. */
  const fit = (screens: Screen[], q: number, s: number, max: number) => {
    let lines = 0;
    for (let k = 0; k <= max; k++, q *= SHRINK, s *= SHRINK) {
      const ar = screens.map((sc) => count(sc.ar, (px) => `${px}px "${r.font}"`, "rtl", q));
      const textH = Math.max(0, ...screens.map((sc, j) => {
        const tr = sc.tr ? count(sc.tr, (px) => trFontCss(px, family), trDir, s) : 0;
        return ar[j] * q * 1.9 + (tr ? blockGap + tr * s * trLine : 0);
      }));
      lines = Math.max(0, ...ar);
      if (textH + 2 * pad <= maxH) return { steps: k, lines };
    }
    return { steps: max + 1, lines };
  };
  type Fit = ReturnType<typeof fit>;
  const fine = (f: Fit) => f.steps <= LONG_SHRINKS && f.lines <= MAX_LINES;
  const better = (a: Fit, b: Fit) => a.steps < b.steps || (a.steps === b.steps && a.lines < b.lines);
  const marker = (a: LoadedAyah) => (showRef ? ` ۝${arabicDigits(a.num)}` : "");
  const ref = (a: LoadedAyah) => (showRef ? ` (${r.surah}:${a.num})` : "");
  const trOf = (a: LoadedAyah) => (showTr ? a.tr : "");
  // Each ayah whole, or a long one in parts: the fewest parts that are each fine on one screen, else the parts that keep
  // the text largest (then with the fewest lines). An ayah without pause marks stays whole (and shrinks as before).
  const qsNormal = Math.min(qs0, (28 + DEFAULT_STYLE.quranSize * 10) * u), tsNormal = Math.min(ts0, (20 + DEFAULT_STYLE.transSize * 6) * u);
  const sections: number[][] = [];
  const screens = ayahs.flatMap((a, i): Screen[] => {
    const whole: Screen = { ayah: i, section: 0, ar: a.ar + marker(a), tr: trOf(a) && trOf(a) + ref(a) };
    sections[i] = [0];
    if (!(r.splitLong ?? x.splitLong) || fine(fit([whole], qsNormal, tsNormal, LONG_SHRINKS))) return [whole];
    let need = fit([whole], qs0, ts0, 16), best: Screen[] | null = null;
    for (let n = 2; n <= MAX_PARTS; n++) {
      const cut = splitAyah(a.ar, trOf(a), n);
      if (!cut) break; // no more pause marks
      const parts = cut.sections.map((p, j): Screen => {
        const last = j === n - 1;
        // A translation that could not be cut is shown whole with every part, reference included.
        return { ayah: i, section: j, ar: p.ar + (last ? marker(a) : ""), tr: p.tr && p.tr + (last || !cut.trSplit ? ref(a) : "") };
      });
      const f = fit(parts, qs0, ts0, need.steps);
      if (better(f, need)) { need = f; best = parts; sections[i] = cut.starts; }
      if (fine(f)) break;
    }
    return best ?? [whole];
  });
  let qs = qs0, ts = ts0, laid = lay(screens, qs, ts);
  // Until it fits (at worst very small: the block never covers the header or runs off the frame).
  for (let k = 1; k < 60 && laid.textH + 2 * pad > maxH; k++) { qs *= SHRINK; ts *= SHRINK; laid = lay(screens, qs, ts); }
  const { heights, textH } = laid, arLH = qs * 1.9, trLH = ts * trLine;
  const boxH = textH + 2 * pad;
  const strength = Math.min(1, 0.3 + r.boxOpacity / 100);
  const boxed = effect === "solid" || effect === "glass";

  // ---------- Auto contrast for the block, and where it goes ----------
  const placeAt = (cy: number) => clampCentre({ width: W, area: band }, boxW, boxH, (r.textX ?? x.textX) * W, cy);
  const rectAt = (c: { x: number; y: number }): Rect => ({ x: c.x - boxW / 2, y: c.y - boxH / 2, w: boxW, h: boxH });
  let centre = placeAt((r.textY ?? x.textY) * H), block: Treatment | null = null, moved = false;
  if (auto && !shaded) {
    const need: Need = {
      text: r.textColor, target: showTr ? TARGET_TEXT : TARGET_LARGE,
      box: boxed ? { color: r.boxColor, opacity: r.boxOpacity, max: effect === "glass" ? 0.9 : 1, sheen: effect === "glass" ? 0.1 : 0 } : null,
    };
    const judge = (c: { x: number; y: number }) => solve(areaStats(auto, W, H, rectAt(c)), need);
    block = judge(centre);
    // Not placed by the person: the block may move to a calmer, darker band (upper or lower third) when that clearly helps.
    if (!placed(r)) {
      const before = cost(block, r.boxOpacity);
      let best = before;
      for (const fy of [0.34, 0.72]) {
        const c = placeAt(fy * H);
        if (Math.abs(c.y - centre.y) < boxH * 0.3) continue; // no real move
        if (headerPlan && overlaps(rectAt(c), { ...headerPlan.rect, y: headerPlan.rect.y - 12 * u, h: headerPlan.rect.h + 24 * u })) continue;
        const tr = judge(c), k = cost(tr, r.boxOpacity);
        if (k <= before - 1 && k < best) { best = k; block = tr; centre = c; moved = true; }
      }
    }
  }
  const box = { ...rectAt(centre), radius: 28 * u };
  // The shade's strength: from what lies behind the block and the surah line, or fixed without a measurement. A plain
  // colour background is not darkened more than its text needs.
  const target = showTr || showSurah ? TARGET_TEXT : TARGET_LARGE;
  const shade = !shaded ? null : auto
    ? shadeFor([box, ...(headerPlan ? [headerPlan.rect] : [])].map((a) => areaStats(auto, W, H, a)), r.textColor, target, onClip ? SHADE_MIN : 0)
    : { color: isLight(r.textColor) ? "#000000" : "#ffffff", alpha: SHADE_FIXED };

  // ---------- box layer: Auto contrast's scrim, glass tint / solid fill, border ----------
  const bw = r.borderWidth * 2 * u;
  const opacity = block ? block.boxOpacity : r.boxOpacity;
  const filled = boxed && opacity > 0;
  // A wide, soft edge (it reads as a shade on the picture, not a box); the letters sit well inside its full strength.
  const scrim = block?.scrim, feather = 100 * u, grow = 48 * u;
  const bm = Math.ceil(Math.max(bw + 2 * u, scrim ? grow + feather * 1.6 : 0));
  let boxLayer: Canvas | null = null;
  if (filled || bw > 0 || effect === "glass" || scrim) {
    boxLayer = newCanvas(boxW + 2 * bm, boxH + 2 * bm);
    const b = boxLayer.getContext("2d")!;
    const path = () => { b.beginPath(); b.roundRect(bm, bm, boxW, boxH, box.radius); };
    if (scrim) drawScrim(b, bm - grow, bm - grow, boxW + 2 * grow, boxH + 2 * grow, box.radius + grow, scrim.color, scrim.alpha, feather);
    if (filled) { b.fillStyle = hexA(r.boxColor, opacity / 100); path(); b.fill(); }
    if (effect === "glass") {
      // A faint light edge and sheen make the blurred area read as glass.
      const sheen = b.createLinearGradient(0, bm, 0, bm + boxH);
      sheen.addColorStop(0, "rgba(255,255,255,0.10)"); sheen.addColorStop(0.5, "rgba(255,255,255,0.02)"); sheen.addColorStop(1, "rgba(255,255,255,0.04)");
      b.fillStyle = sheen; path(); b.fill();
      b.strokeStyle = "rgba(255,255,255,0.22)"; b.lineWidth = Math.max(1, 1.5 * u);
      b.beginPath(); b.roundRect(bm + 0.75 * u, bm + 0.75 * u, boxW - 1.5 * u, boxH - 1.5 * u, box.radius); b.stroke();
    }
    if (bw > 0) { b.strokeStyle = r.borderColor; b.lineWidth = bw; path(); b.stroke(); }
  }

  // ---------- text layers ----------
  const textColor = block?.text ?? r.textColor, halo = block?.halo ?? null;
  // Dark text on a bright background: the design's shadow or outline turns light with it.
  const effectColor = block?.level === "dark" && halo ? halo.color : r.boxColor;
  const style = (c: Ctx, size: number) => {
    c.fillStyle = textColor;
    c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0;
    if (effect === "shadow") {
      c.shadowColor = hexA(effectColor, strength); c.shadowBlur = 18 * u; c.shadowOffsetY = 3 * u;
    } else if (boxed && r.boxOpacity < 30) {
      c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 14 * u;
    }
    if (effect === "outline") {
      c.strokeStyle = hexA(effectColor, strength); c.lineWidth = Math.max(2 * u, size * 0.09); c.lineJoin = "round";
    }
  };
  const margin = 44 * u; // room for shadows, outlines and glyphs reaching past the line
  const parts: Canvas[] = [], specs: PartSpec[] = [];
  // Each screen is centred vertically in the box: its Arabic, then its translation.
  screens.forEach((sc, k) => {
    let y = box.y + pad + (textH - heights[k]) / 2;
    for (const kind of ["ar", "tr"] as const) {
      const ar = kind === "ar", lines = ar ? laid.ar[k] : laid.tr[k], lh = ar ? arLH : trLH, size = ar ? qs : ts;
      if (!ar && !lines.length) continue;
      if (!ar) y += blockGap;
      const top = y, h = lines.length * lh;
      const layer = newCanvas(boxW + 2 * margin, h + 2 * margin), c = layer.getContext("2d")!;
      // The layer goes on whole pixels, so every frame copies it 1:1. At a fractional place the browser resamples it,
      // blending each pixel with its neighbours: every letter's edge went soft, and thin strokes and vowel marks broke up
      // further when WhatsApp re-encoded the video (owner, 16 Oct 2026). The lines are drawn relative to (lx, ly), so
      // they keep their exact place.
      const lx = Math.round(box.x - margin), ly = Math.round(top - margin);
      // The translation's lines are placed by their own measured width (left edge at centre - width / 2), not by the
      // canvas's textAlign "center": Safari on iPhone (iOS 26, Malayalam) drew them starting at the centre, as if each
      // line had no width, so they ran off the box to the right. "left" puts a line's left edge at x in every browser
      // and either direction. The Arabic keeps "center" (unchanged).
      c.textAlign = ar ? "center" : "left"; c.textBaseline = "middle";
      c.direction = ar ? "rtl" : trDir;
      c.font = ar ? `${size}px "${r.font}"` : trFontCss(size, family);
      if (!ar) {
        c.globalAlpha = 0.95;
        measure.font = trFontCss(size, family); measure.direction = trDir;
      }
      lines.forEach((line, i) => {
        const cy = top + i * lh + lh / 2 - ly;
        let tx = centre.x - lx; // the centre (Arabic), or the line's left edge (translation)
        if (!ar) {
          const w = c.measureText(line).width; // on this context, after its font is set; the layout's measure if 0
          tx -= (w > 0 ? w : measure.measureText(line).width) / 2;
        }
        if (halo) drawGlow(c, line, tx, cy, halo.color, halo.alpha, u); // Auto contrast's halo, under the design's own look
        style(c, size);
        if (effect === "outline") c.strokeText(line, tx, cy);
        c.fillText(line, tx, cy);
      });
      parts.push(layer);
      specs.push({ ayah: sc.ayah, section: sc.section, kind, x: lx, y: ly });
      y += h;
    }
  });

  const plan: TextPlan = {
    width: W, height: H, box, boxAt: { x: box.x - bm, y: box.y - bm }, area, shade,
    blur: effect === "glass" ? 22 * u : 0, parts: specs, sections, header: headerPlan, brandAt,
    contrast: auto ? { block, header: headTreat, moved } : null,
  };
  if (auto) report({ key: auto.key, W, H, effect, moved, textY: +(centre.y / H).toFixed(3), block: summary(block), header: summary(headTreat) });
  return { plan, brand: brandLayer, header, box: boxLayer, parts };
}

/** Draws an image of size iw×ih scaled to cover the whole W×H canvas (centre crop). */
export function drawCover(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, W: number, H: number) {
  const k = Math.max(W / iw, H / ih), w = iw * k, h = ih * k;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}
