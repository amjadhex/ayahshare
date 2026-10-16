// The reel cache (reels.ts createReelCache): what downloads when, for a plan from preloadPlan. The network is a stand-in
// whose downloads finish when the test says; text drawing and Auto contrast are stand-ins too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "../../../contracts/types";
import { DEFAULT_RECIPE } from "./config";
import { createReelCache, FONTS_MS, MEASURE_MS, preloadPlan, RETRY_MS, TEXT_MS, type PlannedReel } from "./reels";

/** Stand-ins that can hang: the ayah text (`textHangs` calls never answer), the fonts and the poster's measurement. */
const slowNet = vi.hoisted(() => ({ textHangs: 0, fontsHang: false, measureHangs: false }));
const never = () => new Promise<never>(() => {});

vi.mock("./api", () => ({
  clipById: (id: string) => ({ id, duration: 8, caption: id, tags: [], thumb: `thumbs/${id}.webp`, video: { portrait: `clips/p/${id}.mp4`, landscape: "" }, poster: { portrait: `posters/p/${id}.jpg`, landscape: "" } }),
  clipUrl: (clip: { id: string }, kind: string) => `/media/${kind}/${clip.id}`,
  audioUrl: (folder: string, surah: number, ayah: number) => `/audio/${folder}/${surah}-${ayah}.mp3`,
  mediaUrl: (p: string) => `/media/${p}`,
  getAyahText: async (_s: number, from: number, to: number) => {
    if (slowNet.textHangs > 0) { slowNet.textHangs--; return never(); }
    const ayahs = Array.from({ length: to - from + 1 }, (_, i) => ({ numberInSurah: from + i, text: "نص" }));
    return [{ ayahs }, { ayahs }];
  },
}));
vi.mock("./backdrop", () => ({
  backdropFor: async () => (slowNet.measureHangs ? never() : null),
  posterBackdrop: async () => (slowNet.measureHangs ? never() : null),
}));
vi.mock("./draw", () => ({ fontsReady: async () => (slowNet.fontsHang ? never() : undefined), drawLayers: (W: number, H: number) => ({ plan: { width: W, height: H }, brand: { width: W, height: 10 }, header: null, box: null, parts: [] }) }));

/** Downloads in flight, by address; each finishes (or fails) when the test says. */
let pending: Map<string, { resolve: () => void; reject: (e: Error) => void; priority?: string }>;
const started = () => [...pending.keys()];
/** The poster's measurement stands in for a clip not downloaded after 700 ms (reels.ts SLOW_MS). */
const slow = () => new Promise((r) => setTimeout(r, 800));
async function finish(match: RegExp) {
  for (const [url, p] of [...pending]) if (match.test(url)) { pending.delete(url); p.resolve(); }
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  Object.assign(slowNet, { textHangs: 0, fontsHang: false, measureHangs: false });
  pending = new Map();
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const signal = init.signal;
    signal?.addEventListener("abort", () => { pending.delete(url); reject(new DOMException("aborted", "AbortError")); });
    pending.set(url, { resolve: () => resolve(new Response(new Blob([url]))), reject, priority: init.priority });
  })));
  // Recording lengths: the stand-in Audio element answers at once.
  vi.stubGlobal("Audio", class { preload = ""; onloadedmetadata: (() => void) | null = null; duration = 5; removeAttribute() {} set src(_: string) { queueMicrotask(() => this.onloadedmetadata?.()); } });
});
afterEach(() => vi.unstubAllGlobals());

const reel = (n: number): Recipe => ({ ...structuredClone(DEFAULT_RECIPE), surah: 2, from: n, to: n, reciter: "R", bg: { type: "clip", id: `pb${n}` }, voice: "none" });
const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
const planAt = (i: number, data = false): PlannedReel[] => preloadPlan(i, keys.length, data).map(({ i: k, level }) => ({ key: keys[k], recipe: reel(k), level }));
const scene = { surahs: [{ n: 1 }, { n: 2 }] as never, editions: {}, brand: "AyahShare" };

describe("the reel cache", () => {
  it("a reel whose translation voice is switched keeps its clip, text and recitation, and downloads only the voice", async () => {
    const c = createReelCache(() => {});
    const plain: Recipe = { ...reel(0), translation: "en.sahih" }, voiced: Recipe = { ...plain, voice: "en.walk" };
    c.sync([{ key: "k0", recipe: plain, level: "full" }], [720, 1280], scene);
    await finish(/pb0|2-0\.mp3/);
    await slow();
    expect(c.get("k0")).toMatchObject({ warm: true });
    const layers = c.get("k0")!.layers;
    c.sync([{ key: "k0", recipe: voiced, level: "full" }], [720, 1280], scene);
    expect(c.get("k0")!.audio).toHaveLength(2);
    expect(c.get("k0")!.audio[0]).toBeTruthy(); // the recitation stays
    expect(c.get("k0")!.audio[1]).toBeNull();
    expect(c.get("k0")!.layers).toBe(layers); // same translation: not drawn again
    expect(started().filter((u) => !u.includes("poster"))).toEqual(["/audio/voice/en.walk/2-0.mp3"]); // not the clip again
    await finish(/voice/);
    expect(c.get("k0")).toMatchObject({ warm: true });
    c.sync([{ key: "k0", recipe: plain, level: "full" }], [720, 1280], scene); // off again: nothing to download
    expect(c.get("k0")!.audio).toHaveLength(1);
    expect(c.get("k0")).toMatchObject({ warm: true });
    expect(started()).toEqual([]);
  });

  it("downloads the reel on screen first and alone (high priority), then two at a time, nearest first (low priority)", async () => {
    const c = createReelCache(() => {});
    c.sync(planAt(0), [720, 1280], scene);
    expect(c.downloading()).toEqual(["k0"]);
    expect(started().filter((u) => !u.includes("poster")).sort()).toEqual(["/audio/R/2-0.mp3", "/media/video/pb0"]);
    expect(pending.get("/media/video/pb0")?.priority).toBe("high");
    await finish(/pb0|2-0\.mp3/);
    expect(c.get("k0")?.warm).toBe(true);
    expect(c.downloading()).toEqual(["k1", "k2"]);
    expect(pending.get("/media/video/pb1")?.priority).toBe("low");
    await finish(/pb1|2-1\.mp3/);
    expect(c.downloading()).toEqual(["k2"]); // nothing else is full: the third ahead is light (text and poster only)
    expect(c.get("k3")).toMatchObject({ video: null, warm: false });
    await slow();
    expect(c.get("k3")?.layers).toBeTruthy(); // drawn with the poster's measurement
  });

  it("a reel skipped past stops downloading (what arrived stays); far reels are released", async () => {
    const c = createReelCache(() => {});
    c.sync(planAt(0), [720, 1280], scene);
    await finish(/pb0|2-0\.mp3/);
    await finish(/2-1\.mp3/); // reel 1: the recitation is here, the clip still coming
    expect(c.downloading()).toEqual(["k1", "k2"]);
    await slow();
    expect(c.get("k2")?.layers).toBeTruthy();
    c.sync(planAt(4), [720, 1280], scene); // a fast swipe to reel 4: reels 0 and 1 are out of reach
    expect(c.get("k0")).toBeNull();
    expect(c.get("k1")).toBeNull();
    expect(started().some((u) => /pb1$/.test(u))).toBe(false); // its clip download was stopped
    expect(c.downloading()).toEqual(["k4"]);
    expect(c.get("k2")?.layers).toBeNull(); // two back: kept (its downloads) but not drawn
    c.sync(planAt(3), [720, 1280], scene); // back one: reel 2 is the one before now, drawn again, its download resumes
    expect(c.get("k2")?.layers).toBeTruthy();
  });

  it("with data saver only the next reel downloads", async () => {
    const c = createReelCache(() => {});
    c.sync(planAt(0, true), [720, 1280], scene);
    await finish(/pb0|2-0\.mp3/);
    expect(c.downloading()).toEqual(["k1"]);
    await finish(/pb1|2-1\.mp3/);
    expect(c.downloading()).toEqual([]);
    expect(c.size()).toBe(2);
  });

  it("a new size redraws the text without downloading again", async () => {
    const c = createReelCache(() => {});
    c.sync(planAt(0), [720, 1280], scene);
    await finish(/pb0|2-0\.mp3/);
    const before = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    c.sync(planAt(0), [1125, 2436], scene);
    expect(c.get("k0")).toMatchObject({ size: [1125, 2436], warm: true });
    expect(c.get("k0")?.layers?.plan).toMatchObject({ width: 1125, height: 2436 });
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
  });
});

describe("a reel is never left without its text", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
  afterEach(() => vi.useRealTimers());
  const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it("text that does not come is given up after TEXT_MS and asked again RETRY_MS later; then the reel is drawn", async () => {
    slowNet.textHangs = 1;
    const c = createReelCache(() => {});
    c.sync([{ key: "k0", recipe: reel(0), level: "full" }], [720, 1280], scene);
    await pass(TEXT_MS - 100);
    expect(c.get("k0")).toMatchObject({ ayahs: null, layers: null, failed: false });
    await pass(200);
    expect(c.get("k0")?.failed).toBe(true);
    await pass(RETRY_MS + 1_000);
    expect(c.get("k0")?.failed).toBe(false);
    expect(c.get("k0")?.ayahs).toHaveLength(1);
    expect(c.get("k0")?.layers).toBeTruthy();
  });

  it("text that failed is asked again when the reel is planned again (a swipe)", async () => {
    slowNet.textHangs = 1;
    const c = createReelCache(() => {});
    c.sync([{ key: "k0", recipe: reel(0), level: "full" }], [720, 1280], scene);
    await pass(TEXT_MS + 10);
    expect(c.get("k0")?.failed).toBe(true);
    c.sync([{ key: "k0", recipe: reel(0), level: "full" }], [720, 1280], scene);
    await pass(1_000); // (before the timed retry: RETRY_MS)
    expect(c.get("k0")?.layers).toBeTruthy();
  });

  it("fonts or an Auto contrast measurement that hang do not hold the text back: it is drawn after a moment", async () => {
    slowNet.fontsHang = true;
    slowNet.measureHangs = true;
    const c = createReelCache(() => {});
    c.sync([{ key: "k0", recipe: reel(0), level: "full" }], [720, 1280], scene);
    await pass(10);
    expect(c.get("k0")?.ayahs).toHaveLength(1);
    expect(c.get("k0")?.layers).toBeNull();
    await pass(Math.max(FONTS_MS, MEASURE_MS) + 50);
    expect(c.get("k0")?.layers).toBeTruthy();
  });

  it("the bottom inset (Reels' details) is part of the text's scene; a new inset draws the text again", async () => {
    const c = createReelCache(() => {});
    c.sync([{ key: "k0", recipe: reel(0), level: "full" }], [720, 1280], { ...scene, inset: 0.2 });
    await pass(1_000);
    const first = c.get("k0")!.layers;
    expect(first).toBeTruthy();
    c.sync([{ key: "k0", recipe: reel(0), level: "full" }], [720, 1280], { ...scene, inset: 0.25 });
    expect(c.get("k0")!.layers).toBeTruthy();
    expect(c.get("k0")!.layers).not.toBe(first);
  });
});
