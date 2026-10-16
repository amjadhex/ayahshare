// On-device export engine: video (MP4) and image (JPEG), each in Standard or HD (videoSettings, imageSettings). Framework-free and loaded only when someone exports or shares
// (the app imports it lazily). The page draws the text layers with the same code as the preview (draw.ts), with the
// same Auto contrast measurement (backdrop.ts); the worker places them on every frame with the same compositor
// (compose.ts) and encodes. Each ayah's text enters on the video frame where its recitation starts in the audio track;
// with a translation voice (voice.ts) the voice reading its translation follows its recitation in the audio track, and
// the text stays on screen until the voice ends, so the video is as long as all the recordings played (plus the tail).
import type { Clip } from "../../../../contracts/types";
import { clipUrl } from "../api";
import { backdropFor, clipBlob } from "../backdrop";
import { FPS, SIZES, TAIL_SECONDS, type Size } from "../config";
import { composeText, drawGlass, type TextLayers } from "../compose";
import type { LoadedAyah } from "../design";
import { drawCover, drawLayers, fontsReady, type Layers, type Scene } from "../draw";
import { audioTracks, trackTiming } from "../voice";
import type { FromWorker, ToWorker, VideoJob } from "./protocol";
import { record, recorderType, type RecordOptions } from "./recorder";

export type { RecordOptions } from "./recorder";

/** Everything an export needs: the design and its text, the clip (if any) and the size. A video shows every ayah of
 *  the design one after another (a long one in parts); an image shows the ayah on screen in the preview (`current`,
 *  and for a long ayah shown in parts, the part on screen: `section`). */
export interface ExportScene extends Scene {
  ayahs: LoadedAyah[];
  current: number;
  section?: number;
  clip: Clip | null;
  hd: boolean;
}

export type Phase = "preparing" | "rendering" | "recording";

const SAMPLE_RATE = 44100;

/** The video's size: Standard 720p, HD 1080p (1080×1920, 1080×1080, 1920×1080). */
export const exportSize = (s: ExportScene): Size => SIZES[s.hd ? "hd" : "standard"][s.recipe.orientation];

/** Every video, Standard or HD, is about 1.5 Mbps in all, so WhatsApp status sends it as it is. Measured with the
 *  owner's WhatsApp status (16 Oct 2026): files of 1.5 Mbps in all reached viewers untouched, even at 1080p; files of
 *  2.5 Mbps and more (720p or 1080p, our HD was ~10) were shrunk to 720p and re-encoded at ~0.9 Mbps, which broke the
 *  letters' edges. At 1.4 Mbps this encoder keeps 1080p text nearly as clean as at 10 Mbps. A video on a plain colour
 *  needs far less and stays far below. */
const VIDEO_BITRATE = 1_400_000, AUDIO_BITRATE = 96_000;

/** What the encoder is given for this scene (size, video and audio bitrates). */
export function videoSettings(s: ExportScene) {
  const [width, height] = exportSize(s);
  return { width, height, bitrate: VIDEO_BITRATE, audioBitrate: AUDIO_BITRATE };
}

/** Images: Standard is the video's size as a JPEG (0.92); HD is 1440 px on the short side (1440×2560, 1440×1440,
 *  2560×1440) at JPEG 0.95. The text is drawn at that size, so it is sharp however far the photo is zoomed. */
export function imageSettings(s: ExportScene) {
  const [W, H] = SIZES.standard[s.recipe.orientation], k = s.hd ? 2 : 1;
  return { width: W * k, height: H * k, type: "image/jpeg", quality: s.hd ? 0.95 : 0.92 };
}
const canvasOf = (W: number, H: number) => Object.assign(document.createElement("canvas"), { width: W, height: H });
const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), type, quality));

const canEncodeInWorker = () => typeof VideoEncoder !== "undefined" && typeof OffscreenCanvas !== "undefined";
/** False when this browser can make no video at all (then only images). */
export const canExportVideo = () => canEncodeInWorker() || !!recorderType();

// ---------- shared rendering ----------

/** The design's text layers at W×H (after its fonts have loaded and, with Auto contrast, its background has been
 *  measured: the clip file the video uses, `clip` when the caller already has it). */
async function textLayers(s: ExportScene, W: number, H: number, clip?: Promise<Blob>): Promise<Layers> {
  const [backdrop] = await Promise.all([backdropFor(s.recipe, s.clip, clip), fontsReady(s.ayahs, s)]);
  return drawLayers(W, H, s.ayahs, { ...s, backdrop });
}

/** Background still (clip poster or colour), glass and the full text of ayah `ayah` (its part `section`, for a long
 *  ayah shown in parts). Used for images and link previews. */
export async function renderStill(s: ExportScene, W: number, H: number, ayah: number, section = 0) {
  const canvas = canvasOf(W, H), ctx = canvas.getContext("2d")!, bg = s.recipe.bg;
  ctx.imageSmoothingQuality = "high"; // the poster is 720p: HD images scale it up
  ctx.fillStyle = bg.type === "colour" ? bg.colour : "#000";
  ctx.fillRect(0, 0, W, H);
  let photo = false;
  if (s.clip) {
    const res = await fetch(clipUrl(s.clip, "poster", s.recipe.orientation));
    if (res.ok) {
      const img = await createImageBitmap(await res.blob());
      drawCover(ctx, img, img.width, img.height, W, H);
      img.close();
      photo = true;
    }
  }
  const layers = await textLayers(s, W, H);
  if (photo) drawGlass(ctx, layers.plan);
  composeText(ctx, layers, null, 0, ayah, section);
  return canvas;
}

/** The design's audio (each ayah's recitation, and its translation voice when on), one after another, as mono PCM, and
 *  the text's timeline for it. */
async function loadRecitation(s: ExportScene, signal: AbortSignal, onProgress: (p: number) => void) {
  const r = s.recipe, ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const tracks = audioTracks(r, s.ayahs.map((a) => a.num));
  let loaded = 0;
  const buffers = await Promise.all(tracks.map(async (tk) => {
    const res = await fetch(tk.url, { signal });
    if (!res.ok) throw new Error(`audio ${res.status}`);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    onProgress(++loaded / tracks.length);
    return buf;
  }));
  // The last ayah leaves at the very end, after the tail.
  const { timing, total } = trackTiming(tracks, buffers.map((b) => b.duration), s.ayahs.length, s.recipe.animation ?? "none", TAIL_SECONDS);
  const duration = total + TAIL_SECONDS;
  const pcm = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  let offset = 0;
  for (const b of buffers) {
    const channels = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
    for (let i = 0; i < b.length; i++) {
      let sum = 0;
      for (const ch of channels) sum += ch[i];
      pcm[offset + i] = sum / channels.length;
    }
    offset += b.length;
  }
  return { timing, duration, pcm };
}

/** No progress from the worker for this long means its encoder stalled (seen with WebCodecs H.264 in the iOS
 *  simulator: frames stop after ~7 and nothing errors). The job is then given up as unsupported, so the real-time
 *  recorder takes over instead of a bar that never moves. */
export const STALL_MS = 20_000;

export function runWorker(job: VideoJob, onProgress: (p: number) => void, signal: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let stall: ReturnType<typeof setTimeout> | undefined;
    const watch = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        worker.onmessage = null;
        end();
        reject(Object.assign(new Error("encoder stalled"), { unsupported: true }));
      }, STALL_MS);
    };
    const end = () => { clearTimeout(stall); worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => {
      worker.onmessage = null; // late progress messages must not overwrite "Canceled"
      worker.postMessage({ type: "cancel" } satisfies ToWorker);
      setTimeout(end, 500);
      reject(new DOMException("canceled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "progress") { watch(); onProgress(m.p); }
      else if (m.type === "done") {
        end();
        console.info(`[export] encoded in the worker (H.264, ${m.aac === "wasm" ? "bundled" : "native"} AAC)`);
        resolve(new Blob([m.buffer], { type: "video/mp4" }));
      }
      else { end(); reject(Object.assign(new Error(m.reason), { unsupported: m.unsupported })); }
    };
    worker.onerror = (e) => { end(); reject(Object.assign(new Error(e.message || "worker"), { unsupported: true })); };
    worker.postMessage({ type: "start", job } satisfies ToWorker); // copied, so the real-time fallback can reuse the job
    watch();
  });
}

// ---------- video ----------

/** Makes the MP4 (or WebM from the real-time fallback). Progress: preparation is the first 10 %, encoding the rest.
 *  Rejects with an AbortError when `signal` aborts. `recording`: what the real-time fallback needs from the page (the
 *  audio context started in the tap, and what to do when the video has to be made without sound). */
export async function exportVideo(s: ExportScene, signal: AbortSignal, onProgress: (p: number, phase: Phase) => void, recording: RecordOptions = {}): Promise<Blob> {
  const { width: W, height: H, bitrate, audioBitrate } = videoSettings(s), bg = s.recipe.bg;
  let shown = 0; // preparation steps run side by side: the bar only moves forward
  const prepared = (p: number) => { if (p > shown) onProgress((shown = p), "preparing"); };
  onProgress(0, "preparing");
  // The clip file (usually already in memory: the preview plays it, the Feed downloaded it) and the recitation load
  // while the text is drawn.
  const clip = s.clip ? clipBlob(s.clip, s.recipe.orientation, s.hd) : null; // HD: the 1080p background when there is one
  let loaded = 0;
  const recitation = loadRecitation(s, signal, (p) => { loaded = p; prepared(0.04 + p * 0.06); });
  recitation.catch(() => {}); // awaited below
  const layers = await textLayers(s, W, H, clip ?? undefined);
  const images = [layers.brand, layers.header, layers.box, ...layers.parts];
  let encoded = 0;
  const [brand, header, box, ...parts] = await Promise.all(images.map(async (c) => {
    if (!c) return null;
    const blob = await toBlob(c, "image/png");
    prepared((0.04 * ++encoded) / images.length + loaded * 0.06);
    return blob;
  }));
  if (signal.aborted) throw new DOMException("canceled", "AbortError");
  const text: TextLayers<Blob> = { plan: layers.plan, brand: brand!, header, box, parts: parts as Blob[] };
  const [audio, clipFile] = await Promise.all([recitation, clip]);
  if (signal.aborted) throw new DOMException("canceled", "AbortError");
  const job: VideoJob = {
    width: W, height: H, fps: FPS, bitrate, audioBitrate, text, sampleRate: SAMPLE_RATE, duration: audio.duration, pcm: audio.pcm, timing: audio.timing,
    bg: clipFile ? { type: "clip", blob: clipFile } : { type: "colour", colour: bg.type === "colour" ? bg.colour : "#000000" },
  };
  try {
    if (!canEncodeInWorker()) throw Object.assign(new Error("no encoder"), { unsupported: true });
    return await runWorker(job, (p) => onProgress(0.1 + p * 0.9, "rendering"), signal);
  } catch (e) {
    // HD that this device's encoder refuses is not recorded in real time at 1080p (slow, and heavy on a phone): the
    // caller makes it in Standard instead (exportJob.tsx).
    if (!(e as { unsupported?: boolean }).unsupported || !recorderType() || (s.hd && canEncodeInWorker())) throw e;
    console.info(`[export] worker encoder unavailable (${(e as Error).message}); recording in real time as ${recorderType()}`);
    return await record(job, (p) => onProgress(0.1 + p * 0.9, "recording"), signal, recording);
  }
}

// ---------- image ----------

/** The ayah on screen in the preview (the part on screen, for a long ayah shown in parts), full text, as a JPEG. */
export async function exportImage(s: ExportScene): Promise<Blob> {
  if (!s.ayahs.length) throw new Error("no ayah");
  const { width, height, type, quality } = imageSettings(s);
  return toBlob(await renderStill(s, width, height, Math.min(Math.max(0, s.current), s.ayahs.length - 1), s.section ?? 0), type, quality);
}

const THUMB_WIDTH = 360;
const THUMB_MAX = 60 * 1024;

/** Saved designs' thumbnail: ayah `ayah` (its part `section`, for a long ayah) on the clip's poster (the video's first
 *  frame) at 360 px wide, as a JPEG of at most 60 KB (null if even the lowest quality is larger). */
export async function thumbnail(s: ExportScene, ayah = 0, section = 0): Promise<Blob | null> {
  if (!s.ayahs.length) return null;
  const [W, H] = SIZES.standard[s.recipe.orientation];
  const canvas = await renderStill(s, THUMB_WIDTH, Math.round((H * THUMB_WIDTH) / W), Math.min(Math.max(0, ayah), s.ayahs.length - 1), section);
  for (const q of [0.78, 0.62, 0.45, 0.3]) {
    const blob = await toBlob(canvas, "image/jpeg", q);
    if (blob.size <= THUMB_MAX) return blob;
  }
  return null;
}

/** Small JPEG for link previews (≤ 200 KB as a data URL): the first ayah, as the link opens. */
export async function previewImage(s: ExportScene): Promise<string | undefined> {
  if (!s.ayahs.length) return undefined;
  const [W, H] = SIZES.standard[s.recipe.orientation];
  const k = 600 / Math.max(W, H);
  const canvas = await renderStill(s, Math.round(W * k), Math.round(H * k), 0);
  for (const q of [0.8, 0.6, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= 200_000) return url;
  }
  return undefined;
}
