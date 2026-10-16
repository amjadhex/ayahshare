// Test stand-ins for the real-time recorder's browser APIs (AudioContext, MediaRecorder, canvas.captureStream), shared
// by export/recorder.test.ts and ui/exportJob.test.tsx. Not used by the app.
import { vi } from "vitest";

export class FakeTrack {
  stopped = false;
  constructor(public kind: "audio" | "video") {}
  stop() { this.stopped = true; }
}

export class FakeStream {
  tracks: FakeTrack[] = [new FakeTrack("video")];
  addTrack(t: FakeTrack) { this.tracks.push(t); }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
}

export interface FakeSource { started: boolean; stopped: boolean; buffer: unknown; connect(): void; disconnect(): void; start(): void; stop(): void }

/** `canRun`: resume() starts it (else it stays suspended and resume() never settles, as Safari does without a tap).
 *  `frozen`: running, but its clock does not move. */
export class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  static canRun = false;
  static frozen = false;
  state: AudioContextState = "suspended";
  sampleRate = 44100;
  destination = {};
  closed = false;
  sources: FakeSource[] = [];
  private from = 0;
  constructor() { FakeAudioContext.made.push(this); }
  get currentTime() { return this.state === "running" && !FakeAudioContext.frozen ? (performance.now() - this.from) / 1000 : 0; }
  resume() {
    if (!FakeAudioContext.canRun) return new Promise<void>(() => {});
    if (this.state !== "running") { this.state = "running"; this.from = performance.now(); }
    return Promise.resolve();
  }
  close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }
  createBuffer(_channels: number, length: number, sampleRate: number) { return { length, sampleRate, copyToChannel() {} }; }
  createBufferSource() {
    const s: FakeSource = {
      started: false, stopped: false, buffer: null, connect() {}, disconnect() {},
      start() { s.started = true; }, stop() { s.stopped = true; },
    };
    this.sources.push(s);
    return s;
  }
  createMediaStreamDestination() {
    const stream = new FakeStream();
    stream.tracks = [new FakeTrack("audio")];
    return { stream };
  }
}

/** `stops`: stop() is followed by the last chunk and `onstop` (else it never is: the hang seen in iOS Safari). */
export class FakeMediaRecorder {
  static made: FakeMediaRecorder[] = [];
  static stops = true;
  static isTypeSupported(t: string) { return t.startsWith("video/mp4"); }
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: FakeStream, public options: { mimeType: string }) { FakeMediaRecorder.made.push(this); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    if (FakeMediaRecorder.stops) setTimeout(() => { this.ondataavailable?.({ data: new Blob(["video"]) }); this.onstop?.(); }, 10);
  }
}

/** Installs the stand-ins (undo with vi.unstubAllGlobals and restore()). */
export function installRecorderFakes() {
  FakeAudioContext.made = [];
  FakeAudioContext.canRun = false;
  FakeAudioContext.frozen = false;
  FakeMediaRecorder.made = [];
  FakeMediaRecorder.stops = true;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  const proto = HTMLCanvasElement.prototype as unknown as { captureStream?: () => FakeStream };
  proto.captureStream = () => new FakeStream();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy({}, { get: (_, k) => (k === "imageSmoothingQuality" ? "low" : () => {}), set: () => true }) as never);
  return () => { delete proto.captureStream; };
}

/** Timers, animation frames and the page's clock under the test's control. */
export const fakeClock = () => vi.useFakeTimers({
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"],
});
