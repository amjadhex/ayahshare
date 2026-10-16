// Messages between the page and the export worker.
import type { TextLayers, Timing } from "../compose";

export interface VideoJob {
  width: number;
  height: number;
  fps: number;
  /** Video and audio bitrates (bits per second): index.ts videoSettings. */
  bitrate: number;
  audioBitrate: number;
  /** The text layers as transparent PNGs, drawn by the page (same code as the preview), and where they go. */
  text: TextLayers<Blob>;
  /** When each ayah is recited and how the text animates (compose.ts turns this into each frame's text). */
  timing: Timing;
  /** Full length in seconds, including the tail after the recitation. */
  duration: number;
  /** Mono recitation, already padded with silence to `duration`. */
  pcm: Float32Array;
  sampleRate: number;
  /** The clip is downloaded whole by the page (so the offline cache keeps it), then read from memory. */
  bg: { type: "clip"; blob: Blob } | { type: "colour"; colour: string };
}

export type ToWorker = { type: "start"; job: VideoJob } | { type: "cancel" };

export type FromWorker =
  | { type: "progress"; p: number }
  /** `aac`: which audio encoder ran (the browser's own, or the bundled one where the browser has none). */
  | { type: "done"; buffer: ArrayBuffer; aac: "native" | "wasm" }
  | { type: "error"; reason: string; unsupported: boolean };

/** Decodes the job's text layers once (worker or page). */
export async function decodeLayers(text: TextLayers<Blob>): Promise<TextLayers<ImageBitmap>> {
  const [brand, header, box, ...parts] = await Promise.all(
    [text.brand, text.header, text.box, ...text.parts].map((b) => (b ? createImageBitmap(b) : null)));
  return { plan: text.plan, brand: brand!, header, box, parts: parts as ImageBitmap[] };
}

export function closeLayers(l: TextLayers<ImageBitmap>) {
  for (const b of [l.brand, l.header, l.box, ...l.parts]) b?.close();
}
