// Measuring a design's background on the device for Auto contrast (contrast.ts reads the result). A clip is sampled at 8
// fixed times across its length, each frame drawn into a tiny canvas (64 cells on the long side) as relative
// luminance; a colour is one flat frame. The times are fixed and the clip file is the same everywhere, so the preview,
// the Feed, the exports and a shared link measure the same thing. Clips are downloaded whole once (clipBlob, kept in
// memory for the last few clips): the preview plays that copy, the measurement reads it, and the export encodes it.
import type { Clip, Recipe } from "../../../contracts/types";
import { clipUrl, mediaUrl } from "./api";
import { luminance, luminanceOf, type Backdrop } from "./contrast";

export type { Backdrop } from "./contrast";

const FRAMES = 8;
const CELLS = 64;     // cells on the long side
const SUPER = 4;      // each cell averages SUPER × SUPER pixels, so small bright details still count
const KEEP_BLOBS = 4;
const KEEP_BACKDROPS = 40;
const TIMEOUT = 20_000;

type Orientation = Recipe["orientation"];
/** The clip file a design uses (square designs use the portrait one, centre-cropped). */
const rendition = (o: Orientation) => (o === "landscape" ? "landscape" : "portrait");

// ---------- clip files ----------

const blobs = new Map<string, Promise<Blob>>();

/** The whole clip file for an orientation, downloaded once and kept for the last few clips. */
/** The clip's file, kept in memory for the next use. `hd`: the 1080p rendition when the clip has one (HD exports),
 *  falling back to the 720p file if it cannot be loaded. */
export function clipBlob(clip: Clip, orientation: Orientation, hd = false): Promise<Blob> {
  const hdPath = hd ? clip.hd?.[orientation === "landscape" ? "landscape" : "portrait"] : undefined;
  if (hdPath) return load(mediaUrl(hdPath)).catch(() => clipBlob(clip, orientation));
  return load(clipUrl(clip, "video", orientation));
}

function load(url: string): Promise<Blob> {
  let p = blobs.get(url);
  if (p) { blobs.delete(url); blobs.set(url, p); return p; } // most recent last
  p = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`clip ${res.status}`);
    return res.blob();
  });
  p.catch(() => blobs.delete(url));
  blobs.set(url, p);
  while (blobs.size > KEEP_BLOBS) blobs.delete(blobs.keys().next().value!);
  return p;
}

// ---------- sampling ----------

const once = (el: HTMLMediaElement, ok: string) => new Promise<void>((resolve, reject) => {
  const done = (e: Event) => {
    el.removeEventListener(ok, done); el.removeEventListener("error", done);
    if (e.type === "error") reject(new Error("media error")); else resolve();
  };
  el.addEventListener(ok, done); el.addEventListener("error", done);
});

/** Relative luminance grid (w×h) of what `draw` puts on a small canvas, each cell the mean of SUPER² pixels. */
function grid(ctx: CanvasRenderingContext2D, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Float32Array {
  const W = w * SUPER, H = h * SUPER;
  ctx.clearRect(0, 0, W, H);
  draw(ctx);
  const px = ctx.getImageData(0, 0, W, H).data, out = new Float32Array(w * h);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      out[Math.floor(y / SUPER) * w + Math.floor(x / SUPER)] += luminance(px[i], px[i + 1], px[i + 2]);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= SUPER * SUPER;
  return out;
}

function sizeFor(sw: number, sh: number) {
  return sw >= sh ? { w: CELLS, h: Math.max(1, Math.round((CELLS * sh) / sw)) } : { w: Math.max(1, Math.round((CELLS * sw) / sh)), h: CELLS };
}

function canvasFor(w: number, h: number) {
  const c = Object.assign(document.createElement("canvas"), { width: w * SUPER, height: h * SUPER });
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/** 8 frames of a clip file at fixed times ((k + ½) / 8 of its length). */
async function sampleVideo(key: string, blob: Blob): Promise<Backdrop> {
  const url = URL.createObjectURL(blob);
  const v = Object.assign(document.createElement("video"), { muted: true, playsInline: true, preload: "auto" });
  const timer = setTimeout(() => v.dispatchEvent(new Event("error")), TIMEOUT);
  try {
    const loaded = once(v, "loadeddata");
    v.src = url;
    v.load();
    // Some phones load nothing for a video that is not playing: a muted play starts the loading (paused below).
    void v.play()?.catch(() => {});
    await loaded;
    v.pause();
    const { w, h } = sizeFor(v.videoWidth, v.videoHeight);
    const ctx = canvasFor(w, h), d = v.duration;
    if (!(d > 0)) throw new Error("no duration");
    const frames: Float32Array[] = [];
    for (let k = 0; k < FRAMES; k++) {
      const seeked = once(v, "seeked");
      v.currentTime = ((k + 0.5) / FRAMES) * d;
      await seeked;
      frames.push(grid(ctx, w, h, (c) => c.drawImage(v, 0, 0, w * SUPER, h * SUPER)));
    }
    return { key, w, h, frames };
  } finally {
    clearTimeout(timer);
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** One frame: the clip's poster (frame at 1 s), when the clip itself cannot be read. */
async function samplePoster(key: string, url: string): Promise<Backdrop> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`poster ${res.status}`);
  const img = await createImageBitmap(await res.blob());
  try {
    const { w, h } = sizeFor(img.width, img.height);
    return { key, w, h, frames: [grid(canvasFor(w, h), w, h, (c) => c.drawImage(img, 0, 0, w * SUPER, h * SUPER))] };
  } finally {
    img.close();
  }
}

// ---------- per design ----------

const backdrops = new Map<string, Promise<Backdrop | null>>();
const remember = (key: string, p: Promise<Backdrop | null>) => {
  backdrops.set(key, p);
  while (backdrops.size > KEEP_BACKDROPS) backdrops.delete(backdrops.keys().next().value!);
  return p;
};

export const colourBackdrop = (hex: string): Backdrop => ({ key: hex, w: 1, h: 1, frames: [Float32Array.of(luminanceOf(hex))] });

/** The clip's measurement (cached per clip file). `blob`: the file when the caller already has it (the Feed, the
 *  export). Falls back to the poster if the clip cannot be read (not kept: the next design tries the clip again); null
 *  if neither can be read (then the text is drawn without Auto contrast). */
export function clipBackdrop(clip: Clip, orientation: Orientation, blob?: Promise<Blob> | Blob): Promise<Backdrop | null> {
  const key = `${clip.id}|${rendition(orientation)}`;
  let p = backdrops.get(key);
  if (!p) {
    const mine = Promise.resolve(blob ?? clipBlob(clip, orientation))
      .catch(() => clipBlob(clip, orientation)) // the caller's download was dropped or failed: our own
      .then((b) => sampleVideo(key, b))
      .catch(() => null);
    void mine.then((b) => { if (!b && backdrops.get(key) === mine) backdrops.delete(key); });
    p = remember(key, mine);
  }
  return p.then((b) => b ?? posterBackdrop(clip, orientation));
}

/** Which measurement a design needs: its clip file or its colour. */
export const backdropKey = (r: Recipe) => (r.bg.type === "clip" ? `${r.bg.id}|${rendition(r.orientation)}` : r.bg.colour);

/** A quick first measurement from the poster alone (frame at 1 s), for a preview whose clip is slow to download. */
export function posterBackdrop(clip: Clip, orientation: Orientation): Promise<Backdrop | null> {
  const key = `${clip.id}|${rendition(orientation)}|poster`;
  return backdrops.get(key) ?? remember(key, samplePoster(key, clipUrl(clip, "poster", orientation)).catch(() => null));
}

/** The measurement a design's text layer uses: null when Auto contrast is off. */
export function backdropFor(r: Recipe, clip: Clip | null, blob?: Promise<Blob> | Blob): Promise<Backdrop | null> {
  if (r.autoContrast === false) return Promise.resolve(null);
  if (r.bg.type === "colour") return Promise.resolve(colourBackdrop(r.bg.colour));
  return clip ? clipBackdrop(clip, r.orientation, blob) : Promise.resolve(null);
}
