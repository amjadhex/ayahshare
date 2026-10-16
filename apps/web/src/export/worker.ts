// Export worker: background clip (looped, cover-cropped) + glass + the text layers (placed, faded and revealed by
// compose.ts, the same code as the preview) + recitation → MP4 (H.264 + AAC). Runs off the main thread so the page
// stays responsive.
import {
  AudioSample, AudioSampleSource, BufferTarget, CanvasSink, CanvasSource, Input, MP4, Mp4OutputFormat, Output,
  BlobSource, canEncodeAudio, canEncodeVideo, type WrappedCanvas,
} from "mediabunny";
import { composeText, drawGlass } from "../compose";
import { closeLayers, decodeLayers, type FromWorker, type ToWorker, type VideoJob } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

class Unsupported extends Error {}

/** AAC encoder delay in samples (measured on exported files): the browser's own encoder, the bundled one. */
const PRIMING = { native: 2112, wasm: 1024 };

let output: Output | null = null;
let canceled = false;
let aac: "native" | "wasm" = "native";

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  if (e.data.type === "cancel") {
    canceled = true;
    await output?.cancel().catch(() => {});
    return;
  }
  try {
    const buffer = await render(e.data.job);
    post({ type: "done", buffer, aac }, [buffer]);
  } catch (err) {
    if (!canceled) post({ type: "error", reason: err instanceof Error ? err.message : String(err), unsupported: err instanceof Unsupported });
  }
};

async function render(job: VideoJob): Promise<ArrayBuffer> {
  const { width: W, height: H, fps, sampleRate } = job;
  if (typeof VideoEncoder === "undefined" || !(await canEncodeVideo("avc", { width: W, height: H, bitrate: job.bitrate, frameRate: fps }))) {
    throw new Unsupported("h264 encoder");
  }
  if (!(await canEncodeAudio("aac", { numberOfChannels: 1, sampleRate, bitrate: job.audioBitrate }))) {
    // e.g. Safari: no native AAC encoder → WASM encoder, loaded only when needed.
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
    aac = "wasm";
  }

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const out = (output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() }));
  // Fixed bitrates (index.ts videoSettings): ~1.5 Mbps in all, light enough for WhatsApp status to send it as it is.
  const video = new CanvasSource(canvas, { codec: "avc", bitrate: job.bitrate });
  const audio = new AudioSampleSource({ codec: "aac", bitrate: job.audioBitrate });
  out.addVideoTrack(video, { frameRate: fps });
  out.addAudioTrack(audio);
  await out.start();

  // Audio first, in one-second samples. Each sample gets its own copy (slice, not subarray): the native encoder path
  // reads the view's whole underlying buffer from offset 0, so a subarray would repeat the first second.
  // AAC encoders put a few silent samples (encoder delay) in front of the sound without saying so; timestamps that
  // start that much earlier let the file's edit list skip them, so each recitation starts on the frame its text enters
  // (measured without this: 48 ms late with the browser's encoder, 23 ms with the bundled one).
  const lead = PRIMING[aac] / sampleRate;
  for (let i = 0; i < job.pcm.length; i += sampleRate) {
    const sample = new AudioSample({ data: job.pcm.slice(i, i + sampleRate), format: "f32", numberOfChannels: 1, sampleRate, timestamp: i / sampleRate - lead });
    await audio.add(sample);
    sample.close();
  }
  audio.close();

  // Video: one frame per 1/fps. The text layers are decoded once; each frame places them for its time.
  const frames = Math.ceil(job.duration * fps);
  const layers = await decodeLayers(job.text);
  // Glass blurs the clip behind the box; on a plain colour there is nothing to blur.
  const glass = job.bg.type === "clip" && job.text.plan.blur > 0;
  let lastPct = -1;
  const addFrame = async (k: number, drawBackground: () => void) => {
    if (canceled) throw new Error("canceled");
    const t = k / fps;
    drawBackground();
    if (glass) drawGlass(ctx, layers.plan);
    composeText(ctx, layers, job.timing, t);
    await video.add(t, 1 / fps);
    const pct = Math.floor((k / frames) * 100);
    if (pct !== lastPct) post({ type: "progress", p: (lastPct = pct) / 100 });
  };

  if (job.bg.type === "colour") {
    const colour = job.bg.colour;
    for (let k = 0; k < frames; k++) await addFrame(k, () => { ctx.fillStyle = colour; ctx.fillRect(0, 0, W, H); });
  } else {
    const input = new Input({ source: new BlobSource(job.bg.blob), formats: [MP4] });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Unsupported("video decoder");
    const first = await track.getFirstTimestamp();
    const clipLength = (await track.computeDuration()) - first;
    if (!(clipLength >= 0.5)) throw new Error("clip too short");
    // The sink scales and centre-crops every frame to the output size ("cover").
    const sink = new CanvasSink(track, { width: W, height: H, fit: "cover", poolSize: 2 });
    let last: WrappedCanvas | null = null;
    const drawBg = () => {
      if (last) ctx.drawImage(last.canvas, 0, 0);
      else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    };
    // Loop the clip: each pass asks for monotonically increasing timestamps inside the clip.
    for (let k = 0, pass = 0; k < frames; pass++) {
      const passEnd = Math.min(frames, Math.ceil((pass + 1) * clipLength * fps));
      const times: number[] = [];
      for (let j = k; j < passEnd; j++) times.push(first + j / fps - pass * clipLength);
      if (!times.length) break;
      for await (const wc of sink.canvasesAtTimestamps(times)) {
        if (wc) last = wc;
        await addFrame(k++, drawBg);
      }
    }
    input.dispose();
  }
  closeLayers(layers);
  video.close();
  await out.finalize();
  return out.target.buffer!;
}
