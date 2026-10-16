// The real-time recorder (browsers whose worker cannot encode, e.g. iOS Safari) always ends: without sound when the
// audio context stays suspended (its clock frozen; the page's clock keeps time), with an error when no frame comes or
// the recorder never finishes, and at once when canceled. The browser's media APIs are stand-ins (export/testing.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoJob } from "./protocol";
import { RECORD_STALL_MS, RESUME_MS, record } from "./recorder";
import { FakeAudioContext, FakeMediaRecorder, fakeClock, installRecorderFakes } from "./testing";

vi.mock("../compose", () => ({ composeText: () => {}, drawGlass: () => {} }));
vi.mock("../draw", () => ({ drawCover: () => {} }));
vi.mock("./protocol", () => ({ decodeLayers: async () => ({ plan: { blur: 0 } }), closeLayers: () => {} }));

const job = (over: Partial<VideoJob> = {}): VideoJob => ({
  width: 720, height: 1280, fps: 30, bitrate: 2_000_000, audioBitrate: 96_000, text: {} as never, timing: {} as never,
  duration: 2, pcm: new Float32Array(8), sampleRate: 44100, bg: { type: "colour", colour: "#000" }, ...over,
});

let restore: () => void;
beforeEach(() => {
  restore = installRecorderFakes();
  fakeClock();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); restore(); });

/** Settles to the result or the error, so a test can advance time first. */
const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: v }), (e: Error) => ({ error: e }));

describe("real-time recorder", () => {
  it("a suspended audio context (its clock frozen): the video is made without sound on the page's clock", async () => {
    const ac = new FakeAudioContext(); // made "in the tap", but Safari kept it suspended
    const seen: number[] = [], silent = vi.fn();
    const out = settle(record(job(), (p) => seen.push(p), new AbortController().signal, { audio: ac as never, onSilent: silent }));
    await vi.advanceTimersByTimeAsync(RESUME_MS + 2_500);
    const r = await out;
    expect(r).toMatchObject({ ok: expect.any(Blob) });
    expect(silent).toHaveBeenCalledTimes(1);
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.at(-1)!).toBeGreaterThan(0.9);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true); // forward only
    const rec = FakeMediaRecorder.made[0];
    expect(rec.stream.getAudioTracks()).toEqual([]);
    expect(rec.options.mimeType).toBe("video/mp4"); // no audio codec in the type
    expect(ac.closed).toBe(false); // the context from the tap is closed by its owner
  });

  it("a running context: the recitation is recorded and the audio clock keeps time", async () => {
    FakeAudioContext.canRun = true;
    const ac = new FakeAudioContext();
    await ac.resume();
    const silent = vi.fn(), seen: number[] = [];
    const out = settle(record(job(), (p) => seen.push(p), new AbortController().signal, { audio: ac as never, onSilent: silent }));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await out).toMatchObject({ ok: expect.any(Blob) });
    expect(silent).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.made[0].stream.getAudioTracks()).toHaveLength(1);
    expect(ac.sources[0]).toMatchObject({ started: true, stopped: true });
    expect(seen.at(-1)!).toBeGreaterThan(0.9);
  });

  it("a running context whose clock does not move: the page's clock takes over", async () => {
    FakeAudioContext.canRun = true;
    FakeAudioContext.frozen = true;
    const ac = new FakeAudioContext();
    await ac.resume();
    const out = settle(record(job(), () => {}, new AbortController().signal, { audio: ac as never }));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await out).toMatchObject({ ok: expect.any(Blob) });
  });

  it("without a context from the tap it makes its own, and closes it", async () => {
    const out = settle(record(job(), () => {}, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(RESUME_MS + 2_500);
    expect(await out).toMatchObject({ ok: expect.any(Blob) });
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(FakeAudioContext.made[0].closed).toBe(true);
  });

  it("a recorder that never fires onstop is given up after RECORD_STALL_MS, and everything is let go", async () => {
    FakeMediaRecorder.stops = false;
    const out = settle(record(job(), () => {}, new AbortController().signal, { audio: new FakeAudioContext() as never }));
    await vi.advanceTimersByTimeAsync(RESUME_MS + 2_500);
    await vi.advanceTimersByTimeAsync(RECORD_STALL_MS);
    const r = await out;
    expect(r).toMatchObject({ error: { message: "recorder stalled", unsupported: true } });
    const rec = FakeMediaRecorder.made[0];
    expect(rec.onstop).toBeNull();
    expect(rec.stream.getTracks().every((tr) => tr.stopped)).toBe(true);
  });

  it("no frame at all (the page stopped drawing): given up after RECORD_STALL_MS", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const seen: number[] = [];
    const out = settle(record(job(), (p) => seen.push(p), new AbortController().signal, { audio: new FakeAudioContext() as never }));
    await vi.advanceTimersByTimeAsync(RECORD_STALL_MS + RESUME_MS + 100);
    expect(await out).toMatchObject({ error: { message: "recorder stalled" } });
    expect(seen).toEqual([]);
  });

  it("Cancel while recording rejects at once and tears the recorder and the audio down, though onstop never comes", async () => {
    FakeMediaRecorder.stops = false;
    FakeAudioContext.canRun = true;
    const ac = new FakeAudioContext();
    await ac.resume();
    const ctl = new AbortController(), seen: number[] = [];
    const out = settle(record(job({ duration: 30 }), (p) => seen.push(p), ctl.signal, { audio: ac as never }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.length).toBeGreaterThan(0);
    ctl.abort();
    const r = await out; // no time passes
    expect(r).toMatchObject({ error: { name: "AbortError" } });
    const n = seen.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.length).toBe(n); // no more frames
    const rec = FakeMediaRecorder.made[0];
    expect(rec.state).toBe("inactive");
    expect(rec.stream.getTracks().every((tr) => tr.stopped)).toBe(true);
    expect(ac.sources[0].stopped).toBe(true);
  });

  it("Cancel while the clip is starting (its play() never settles) rejects at once", async () => {
    URL.createObjectURL ??= () => "blob:clip";
    URL.revokeObjectURL ??= () => {};
    vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(new Promise<void>(() => {}));
    const ctl = new AbortController();
    const out = settle(record(job({ bg: { type: "clip", blob: new Blob() } }), () => {}, ctl.signal));
    await vi.advanceTimersByTimeAsync(100);
    ctl.abort();
    expect(await out).toMatchObject({ error: { name: "AbortError" } });
    expect(FakeMediaRecorder.made).toEqual([]);
  });
});
