// The export job never stays stuck: Cancel ends it at once in every phase (the engine tears its worker, recorder and
// audio down), and the whole fallback chain (worker in HD → stall → Standard → stall → real-time recorder → stall)
// ends in an error with the job cleared, so another export works straight away. The real export engine runs with its
// browser APIs as stand-ins: a worker whose encoder stops reporting, Safari's suspended audio context, a MediaRecorder
// that never fires onstop (export/testing.ts). The text drawing and the network are stand-ins too.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../../contracts/types";
import surahList from "../../public/data/surahs.json";
import { STALL_MS } from "../export";
import { RECORD_STALL_MS } from "../export/recorder";
import { FakeAudioContext, FakeMediaRecorder, fakeClock, installRecorderFakes } from "../export/testing";
import { platform } from "../platform";
import { initRouter } from "../router";
import { createStore, type Store } from "../state";
import { t } from "../strings";
import { ExportProvider, JOB_STALL_MS, sceneOf, useExport, type ExportApi } from "./exportJob";
import { StoreContext } from "./hooks";

vi.mock("../analytics", () => ({ anon: "test", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../actions", async (original) => ({ ...(await original<typeof import("../actions")>()), autoSave: vi.fn(async () => {}) }));
vi.mock("../stats", () => ({ madeFromLink: () => {}, ayahStats: async () => new Map(), formatCount: String }));
vi.mock("../api", () => ({
  clipById: () => null, ensureClip: async () => {}, clipUrl: () => "/media/clip.mp4", mediaUrl: (p: string) => `/media/${p}`,
  createShare: async () => ({ code: "abc", url: "https://example.test/s/abc" }), saveCreation: async () => ({}),
}));
vi.mock("../draw", () => ({
  fontsReady: async () => {},
  drawCover: () => {},
  drawLayers: (W: number, H: number) => ({ plan: { width: W, height: H, blur: 0 }, brand: document.createElement("canvas"), header: null, box: null, parts: [] }),
}));
vi.mock("../compose", () => ({ composeText: () => {}, drawGlass: () => {} }));
vi.mock("../backdrop", () => ({ backdropFor: async () => null, clipBlob: async () => new Blob() }));
vi.mock("../voice", () => ({
  audioTracks: () => [{ ayah: 0, kind: "recitation", url: "/audio/a.mp3" }],
  trackTiming: () => ({ timing: { end: 5 }, total: 5, at: [0] }),
}));
vi.mock("../export/protocol", () => ({ decodeLayers: async () => ({ plan: { blur: 0 } }), closeLayers: () => {} }));

/** How the worker behaves: its encoder reports `p` once and then nothing (the stall seen in the iOS simulator). */
const workers = vi.hoisted(() => ({ made: 0, terminated: 0 }));
class StallingWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror = null;
  constructor() { workers.made++; }
  postMessage(m: { type: string }) { if (m.type === "start") setTimeout(() => this.onmessage?.({ data: { type: "progress", p: 0.02 } }), 50); }
  terminate() { workers.terminated++; }
}

const surahs = surahList as Surah[];
let store: Store, api: ExportApi, toasts: string[], restore: () => void;
function Probe() { api = useExport(); return null; }

function start() {
  history.replaceState(null, "", "/create");
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, mediaBase: "/media/" }, surahs, recipe: null });
  store.dispatch({ type: "select", surah: 94, from: 5, to: 5 });
  store.dispatch({ type: "ayahs", ayahs: [{ num: 5, ar: "نص", tr: "Text" }] });
  toasts = [];
  const dispatch = store.dispatch;
  store.dispatch = (a) => { if (a.type === "toast") toasts.push(a.text); dispatch(a); };
  render(<StoreContext.Provider value={store}><ExportProvider phone><Probe /></ExportProvider></StoreContext.Provider>);
}
const scene = (hd: boolean) => ({ ...sceneOf(store.getState())!, hd });
/** Lets `ms` pass (timers, frames and the page's clock). */
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
/** A video export, its result once it settles. */
function video(hd = false) {
  let result: boolean | undefined;
  act(() => { void api.video(scene(hd)).then((r) => (result = r)); });
  return () => result;
}

beforeEach(() => {
  workers.made = workers.terminated = 0;
  restore = installRecorderFakes();
  fakeClock();
  vi.stubGlobal("VideoEncoder", class {});
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("Worker", StallingWorker);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
  vi.stubGlobal("OfflineAudioContext", class {
    async decodeAudioData() { return { duration: 2, numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array(4) }; }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback, type?: string) => cb(new Blob(["x"], { type: type ?? "image/png" })));
  vi.spyOn(platform, "haptic").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  start();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); restore(); });

/** After the job ended: idle, and an image export works at once (it is not blocked by the old job). */
async function imageWorks() {
  expect(api.job.phase).toBe("idle");
  let made: boolean | undefined;
  await act(async () => { made = await api.image(scene(false)); });
  expect(made).toBe(true);
  expect(api.job.phase).toBe("ready");
}

describe("export job: Cancel", () => {
  it("while preparing (the recitation never arrives): the job is idle at once and the audio context closed", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const result = video();
    await pass(100);
    expect(api.job).toMatchObject({ phase: "busy", kind: "video", label: t.preparing });
    act(() => api.cancel());
    expect(api.job.phase).toBe("idle");
    expect(api.status).toBe(t.canceled);
    await pass(0);
    expect(result()).toBe(false);
    expect(FakeAudioContext.made[0].closed).toBe(true); // the one started in the tap
    await imageWorks();
  });

  it("while the worker encodes: the job is idle at once and the worker is terminated", async () => {
    const result = video();
    await pass(1_000);
    expect(api.job).toMatchObject({ phase: "busy", label: t.rendering(12) });
    act(() => api.cancel());
    expect(api.job.phase).toBe("idle");
    await pass(600);
    expect(result()).toBe(false);
    expect(workers.terminated).toBe(1);
    await imageWorks();
  });

  it("while recording in real time with Safari's suspended audio (the recorder would never stop)", async () => {
    vi.stubGlobal("VideoEncoder", undefined); // no worker encoder: the recorder at once
    FakeMediaRecorder.stops = false;
    const result = video();
    await pass(3_000);
    expect(api.job).toMatchObject({ phase: "busy", label: expect.stringContaining("keep this tab open") });
    expect((api.job as { pct: number }).pct).toBeGreaterThan(10); // the page's clock moves the bar
    expect(toasts).toContain(t.videoNoSound);
    act(() => api.cancel());
    expect(api.job.phase).toBe("idle");
    await pass(0);
    expect(result()).toBe(false);
    const rec = FakeMediaRecorder.made[0];
    expect(rec.state).toBe("inactive");
    expect(rec.stream.getTracks().every((tr) => tr.stopped)).toBe(true);
    expect(FakeAudioContext.made[0].closed).toBe(true);
    await imageWorks();
  });

  it("late progress after Cancel does not bring the job back", async () => {
    const result = video();
    await pass(1_000);
    act(() => api.cancel());
    await pass(STALL_MS);
    expect(api.job.phase).toBe("idle");
    expect(result()).toBe(false);
  });
});

describe("export job: the fallback chain", () => {
  it("HD worker stalls → Standard worker stalls → the recorder never finishes → the error, with the job cleared", async () => {
    FakeMediaRecorder.stops = false;
    const labels: string[] = [];
    const result = video(true);
    const watch = async (ms: number) => {
      for (let left = ms; left > 0; left -= 500) {
        await pass(500);
        if (api.job.phase === "busy" && labels.at(-1) !== api.job.label) labels.push(api.job.label);
      }
    };
    await watch(STALL_MS + 1_000);
    expect(toasts).toContain(t.hdFallback);
    expect(api.job).toMatchObject({ phase: "busy", scene: { hd: false } });
    await watch(STALL_MS + 1_000 + 7_000); // Standard stalls too; the recorder makes 6.5 s, then never stops
    expect(labels.some((l) => l.includes("keep this tab open"))).toBe(true);
    expect(api.job.phase).toBe("busy");
    await watch(RECORD_STALL_MS);
    expect(result()).toBe(false);
    expect(api.job.phase).toBe("idle");
    expect(api.status).toBe(t.videoFailed);
    expect(toasts.at(-1)).toBe(t.videoFailed);
    expect(workers).toMatchObject({ made: 2, terminated: 2 });
    expect(FakeAudioContext.made[0].closed).toBe(true);
    await imageWorks();
  });

  it("with sound that cannot start, the recorder still makes the video (without it) and says so", async () => {
    vi.stubGlobal("VideoEncoder", undefined);
    const result = video();
    await pass(10_000);
    expect(result()).toBe(true);
    expect(api.job.phase).toBe("ready");
    expect(toasts).toContain(t.videoNoSound);
    expect(FakeMediaRecorder.made[0].stream.getAudioTracks()).toEqual([]);
  });

  it("anything else that hangs (here the engine's preparation) is given up after JOB_STALL_MS with the error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const result = video();
    await pass(JOB_STALL_MS + 100);
    expect(result()).toBe(false);
    expect(api.job.phase).toBe("idle");
    expect(toasts.at(-1)).toBe(t.videoFailed);
    await imageWorks();
  });
});
