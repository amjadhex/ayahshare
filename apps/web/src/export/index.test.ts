// The export engine's quality settings: what the encoder is given for Standard and HD (size, video and audio bitrate),
// and the image's size and JPEG quality. The worker, the audio decoder, the canvas and the text drawing are stand-ins:
// the test reads the job the page sends to the worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe, Surah } from "../../../../contracts/types";
import { DEFAULT_RECIPE } from "../config";
import { exportImage, exportVideo, imageSettings, runWorker, STALL_MS, videoSettings, type ExportScene } from "./index";
import type { VideoJob } from "./protocol";

vi.mock("../draw", () => ({
  fontsReady: async () => {},
  drawCover: () => {},
  drawLayers: (W: number, H: number) => ({ plan: { width: W, height: H, blur: 0 }, brand: document.createElement("canvas"), header: null, box: null, parts: [] }),
}));
vi.mock("../compose", () => ({ composeText: () => {}, drawGlass: () => {} }));
vi.mock("../backdrop", () => ({ backdropFor: async () => null, clipBlob: async () => new Blob() }));
/** The real-time recorder (browsers without a worker encoder): off unless a test turns it on. */
const recorder = vi.hoisted(() => ({ type: null as string | null, record: vi.fn(async () => new Blob(["webm"], { type: "video/webm" })) }));
vi.mock("./recorder", () => ({ recorderType: () => recorder.type, record: recorder.record }));
vi.mock("../voice", () => ({
  audioTracks: () => [{ ayah: 0, kind: "recitation", url: "/audio/a.mp3" }],
  trackTiming: () => ({ timing: { end: 5 }, total: 5, at: [0] }),
}));

const scene = (hd: boolean, orientation: Recipe["orientation"] = "portrait"): ExportScene => ({
  recipe: { ...structuredClone(DEFAULT_RECIPE), orientation, bg: { type: "colour", colour: "#10241f" } },
  surah: { n: 1, name_ar: "", name_en: "Al-Faatiha", meaning: "", ayahs: 7 } as Surah, lang: "en", brand: "AyahShare",
  ayahs: [{ num: 1, ar: "نص", tr: "Text" }], current: 0, clip: null, hd,
});

let jobs: VideoJob[];
let blobs: { type: string; quality?: number; width: number; height: number }[];
beforeEach(() => {
  jobs = [];
  blobs = [];
  vi.stubGlobal("VideoEncoder", class {});
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
  vi.stubGlobal("OfflineAudioContext", class {
    async decodeAudioData() { return { duration: 2, numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array(4) }; }
  });
  vi.stubGlobal("Worker", class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror = null;
    postMessage(m: { type: string; job: VideoJob }) {
      if (m.type !== "start") return;
      jobs.push(m.job);
      queueMicrotask(() => this.onmessage?.({ data: { type: "done", buffer: new ArrayBuffer(8), aac: "native" } }));
    }
    terminate() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string, quality?: number) {
    blobs.push({ type: type ?? "image/png", quality, width: this.width, height: this.height });
    cb(new Blob(["x"], { type: type ?? "image/png" }));
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, { get: (_, k) => (k === "imageSmoothingQuality" ? "low" : () => {}), set: () => true }) as never);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("export quality", () => {
  it("Standard video: 720p at 1.4 Mbps, AAC 96 kbps (light enough for WhatsApp status to keep it as it is)", () => {
    expect(videoSettings(scene(false))).toEqual({ width: 720, height: 1280, bitrate: 1_400_000, audioBitrate: 96_000 });
    expect(videoSettings(scene(false, "square"))).toMatchObject({ width: 720, height: 720 });
    expect(videoSettings(scene(false, "landscape"))).toMatchObject({ width: 1280, height: 720 });
  });

  it("HD video: 1080p at the same 1.4 Mbps and AAC 96 kbps, every orientation", () => {
    expect(videoSettings(scene(true))).toEqual({ width: 1080, height: 1920, bitrate: 1_400_000, audioBitrate: 96_000 });
    expect(videoSettings(scene(true, "square"))).toEqual({ width: 1080, height: 1080, bitrate: 1_400_000, audioBitrate: 96_000 });
    expect(videoSettings(scene(true, "landscape"))).toMatchObject({ width: 1920, height: 1080, bitrate: 1_400_000 });
  });

  it("the encoder gets the scene's size and bitrates", async () => {
    const signal = new AbortController().signal;
    await exportVideo(scene(true), signal, () => {});
    await exportVideo(scene(false), signal, () => {});
    expect(jobs.map((j) => [j.width, j.height, j.bitrate, j.audioBitrate])).toEqual([[1080, 1920, 1_400_000, 96_000], [720, 1280, 1_400_000, 96_000]]);
  });

  it("an HD video the device's encoder refuses is not recorded in real time (the caller makes it in Standard); a Standard one is", async () => {
    recorder.type = "video/webm";
    vi.stubGlobal("Worker", class {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror = null;
      postMessage(m: { type: string }) { if (m.type === "start") queueMicrotask(() => this.onmessage?.({ data: { type: "error", reason: "h264 encoder", unsupported: true } })); }
      terminate() {}
    });
    await expect(exportVideo(scene(true), new AbortController().signal, () => {})).rejects.toThrow("h264 encoder");
    expect(recorder.record).not.toHaveBeenCalled();
    expect((await exportVideo(scene(false), new AbortController().signal, () => {})).type).toBe("video/webm");
    expect(recorder.record).toHaveBeenCalledTimes(1);
    recorder.type = null;
  });

  it("images: Standard is a 720p JPEG at 0.92; HD is 1440 px on the short side at 0.95", async () => {
    expect(imageSettings(scene(false))).toEqual({ width: 720, height: 1280, type: "image/jpeg", quality: 0.92 });
    expect(imageSettings(scene(true))).toEqual({ width: 1440, height: 2560, type: "image/jpeg", quality: 0.95 });
    expect(imageSettings(scene(true, "landscape"))).toMatchObject({ width: 2560, height: 1440 });
    await exportImage(scene(true));
    await exportImage(scene(false, "square"));
    expect(blobs.filter((b) => b.type === "image/jpeg")).toEqual([
      { type: "image/jpeg", quality: 0.95, width: 1440, height: 2560 },
      { type: "image/jpeg", quality: 0.92, width: 720, height: 720 },
    ]);
  });
});

describe("worker watchdog", () => {
  it("gives the job up as unsupported when the encoder stops reporting progress", async () => {
    vi.useFakeTimers();
    const terminated: boolean[] = [];
    class StuckWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage() { setTimeout(() => this.onmessage?.({ data: { type: "progress", p: 0.12 } } as MessageEvent), 100); }
      terminate() { terminated.push(true); }
    }
    vi.stubGlobal("Worker", StuckWorker);
    const seen: number[] = [];
    const run = runWorker({} as never, (p) => seen.push(p), new AbortController().signal);
    const result = run.then(() => "done", (e: Error & { unsupported?: boolean }) => e);
    await vi.advanceTimersByTimeAsync(STALL_MS + 200);
    const e = await result;
    expect(seen).toEqual([0.12]);
    expect(e).toMatchObject({ message: "encoder stalled", unsupported: true });
    expect(terminated).toEqual([true]);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
