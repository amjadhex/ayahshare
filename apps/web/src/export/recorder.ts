// Fallback for browsers without video encoding in the worker: record the composition in real time.
// It always ends: canceled at once, given up when no new frame comes for RECORD_STALL_MS (its clock stopped, the tab
// was hidden, or the recorder never finishes), and made without sound when the audio cannot start (Safari keeps an
// AudioContext created without a tap suspended, and its clock then never moves: the page's clock keeps time instead).
import { composeText, drawGlass } from "../compose";
import { drawCover } from "../draw";
import { closeLayers, decodeLayers, type VideoJob } from "./protocol";

const TYPES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

export const recorderType = () =>
  typeof MediaRecorder === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)
    ? null : TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;

/** No new frame (or no finished file after the last one) for this long: the recording is given up. */
export const RECORD_STALL_MS = 15_000;
/** How long a context that is not running gets to start before the video is made without sound. */
export const RESUME_MS = 1_000;
/** The audio clock counts as stopped when it has not moved for this long (ms): the page's clock takes over. */
const AUDIO_STILL_MS = 500;

export interface RecordOptions {
  /** A context started inside the person's tap (ui/exportJob.tsx). Its owner closes it; without one the recorder makes
   *  (and closes) its own. */
  audio?: AudioContext | null;
  /** The sound could not start: the video is being made without it. */
  onSilent?: () => void;
}

const canceled = () => new DOMException("canceled", "AbortError");
/** A failure of this device's recorder: the caller says the video cannot be made here. */
const failure = (reason: string) => Object.assign(new Error(reason), { unsupported: true });
const running = (ac: BaseAudioContext) => ac.state === "running";

export async function record(job: VideoJob, onProgress: (p: number) => void, signal: AbortSignal, { audio, onSilent }: RecordOptions = {}): Promise<Blob> {
  const type = recorderType();
  if (!type) throw failure("no recorder");
  if (signal.aborted) throw canceled();
  /** Undone in reverse order whatever happens (finished, failed, canceled). */
  const undo: (() => void)[] = [];
  let fail: (e: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {});
  const onAbort = () => fail(canceled());
  signal.addEventListener("abort", onAbort, { once: true });
  undo.push(() => signal.removeEventListener("abort", onAbort));
  let stall: ReturnType<typeof setTimeout> | undefined;
  const watch = () => { clearTimeout(stall); stall = setTimeout(() => fail(failure("recorder stalled")), RECORD_STALL_MS); };
  undo.push(() => clearTimeout(stall));
  /** Each step ends early when the job is canceled or stalls. */
  const step = <T>(p: Promise<T>) => Promise.race([p, failed]);
  watch();
  try {
    const { width: W, height: H } = job;
    const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = canvas.getContext("2d")!;
    const layers = await step(decodeLayers(job.text));
    undo.push(() => closeLayers(layers));

    let video: HTMLVideoElement | null = null;
    if (job.bg.type === "clip") {
      const v = (video = Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, src: URL.createObjectURL(job.bg.blob) }));
      undo.push(() => { v.pause(); URL.revokeObjectURL(v.src); v.removeAttribute("src"); });
      await step(v.play());
    }

    // The sound: the context from the tap, or one made here; started if it is not running yet.
    const ac = audio ?? (typeof AudioContext !== "undefined" ? new AudioContext() : null);
    if (ac && !audio) undo.push(() => void ac.close().catch(() => {}));
    if (ac && !running(ac)) {
      let wait: ReturnType<typeof setTimeout> | undefined;
      await step(Promise.race([ac.resume().catch(() => {}), new Promise<void>((ok) => (wait = setTimeout(ok, RESUME_MS)))]));
      clearTimeout(wait);
    }
    const sound = !!ac && running(ac);

    const stream = canvas.captureStream(job.fps);
    undo.push(() => stream.getTracks().forEach((tr) => tr.stop()));
    let source: AudioBufferSourceNode | null = null;
    if (sound) {
      const buffer = ac.createBuffer(1, job.pcm.length, job.sampleRate);
      buffer.copyToChannel(job.pcm as Float32Array<ArrayBuffer>, 0);
      const src = (source = ac.createBufferSource()), dest = ac.createMediaStreamDestination();
      src.buffer = buffer;
      src.connect(dest);
      stream.addTrack(dest.stream.getAudioTracks()[0]);
      undo.push(() => { try { src.stop(); } catch { /* not started */ } src.disconnect(); });
    } else {
      console.info("[export] the audio could not start: recording without sound");
      onSilent?.();
    }
    const mimeType = sound ? type : type.split(";")[0];
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.max(4_000_000, Math.min(job.bitrate, 8_000_000)), audioBitsPerSecond: job.audioBitrate });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: type.split(";")[0] }));
      rec.onerror = () => reject(failure("recorder error"));
    });
    undo.push(() => {
      rec.ondataavailable = rec.onstop = rec.onerror = null;
      if (rec.state !== "inactive") try { rec.stop(); } catch { /* already stopping */ }
    });

    const draw = (t: number) => {
      if (video && video.videoWidth) drawCover(ctx, video, video.videoWidth, video.videoHeight, W, H);
      else { ctx.fillStyle = job.bg.type === "colour" ? job.bg.colour : "#000"; ctx.fillRect(0, 0, W, H); }
      if (video && layers.plan.blur) drawGlass(ctx, layers.plan);
      composeText(ctx, layers, job.timing, t);
    };
    draw(0);
    rec.start(1000);
    source?.start();

    // The clock: the audio's while it moves (the text keeps time with the recitation), else the page's. It never goes
    // back, and every step forward is progress for the watchdog.
    const a0 = ac?.currentTime ?? 0, p0 = performance.now();
    let lastAudio = -1, movedAt = p0, t = 0, raf = 0;
    const clock = (now: number) => {
      const wall = (now - p0) / 1000;
      if (!sound) return wall;
      const a = ac.currentTime - a0;
      if (a !== lastAudio) { lastAudio = a; movedAt = now; }
      return running(ac) && now - movedAt < AUDIO_STILL_MS ? a : wall;
    };
    undo.push(() => cancelAnimationFrame(raf));
    const tick = () => {
      const next = clock(performance.now());
      if (next > t) { t = next; watch(); }
      if (t >= job.duration) {
        if (rec.state !== "inactive") rec.stop(); // the watchdog still runs: a recorder that never stops is given up
        return;
      }
      draw(t);
      onProgress(t / job.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return await step(stopped);
  } finally {
    for (const f of undo.reverse()) {
      try { f(); } catch { /* keep undoing the rest */ }
    }
  }
}
