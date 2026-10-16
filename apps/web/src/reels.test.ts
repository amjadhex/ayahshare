// Reels: one reel per wheel / trackpad gesture, and a different reciter on neighbouring reels.
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECITERS } from "./config";
import { pickReciter, reelReciters } from "./feed";
import { canUpgrade, createWheelStepper, noteClipDownload, preloadPlan, reelAt, reelCanvasSize, resetClipSpeed, saveData, upgradeVideo } from "./reels";

/** Feeds a gesture to a stepper: events `every` ms apart from `from`, with these deltas. Returns the steps taken. */
function play(step: ReturnType<typeof createWheelStepper>, from: number, every: number, deltas: number[], mode = 0) {
  return deltas.map((d, i) => step(d, mode, from + i * every)).filter(Boolean);
}
/** A trackpad swipe: a quick push, then momentum that fades over about `ms` (events every 16 ms). */
const swipe = (ms: number, peak = 90) => Array.from({ length: Math.round(ms / 16) }, (_, i) => Math.max(1, Math.round(peak * Math.exp(-i / (ms / 16 / 4)))));

describe("one reel per wheel gesture", () => {
  it("a trackpad swipe with a long momentum tail moves exactly one reel, however long it lasts", () => {
    for (const ms of [400, 900, 1500, 2500]) {
      const step = createWheelStepper();
      expect(play(step, 1000, 16, swipe(ms))).toEqual([1]);
    }
  });

  it("the same for a swipe up, and a slow start that builds up", () => {
    expect(play(createWheelStepper(), 0, 16, swipe(1200).map((d) => -d))).toEqual([-1]);
    expect(play(createWheelStepper(), 0, 16, [3, 5, 9, 20, 40, 80, 60, 40, 20, 8, 3, 1])).toEqual([1]);
  });

  it("two swipes with a pause between them move two reels", () => {
    const step = createWheelStepper();
    expect(play(step, 0, 16, swipe(900))).toEqual([1]);
    expect(play(step, 2000, 16, swipe(900))).toEqual([1]);
  });

  it("a mouse wheel: one reel per notch, and a spinning wheel is one gesture", () => {
    expect(play(createWheelStepper(), 0, 300, [100, 100, 100])).toEqual([1, 1, 1]);
    expect(play(createWheelStepper(), 0, 40, Array(12).fill(100))).toEqual([1]);
    expect(play(createWheelStepper(), 0, 300, [3, 3, 3], 1)).toEqual([1, 1, 1]); // line mode (Firefox): 3 lines a notch
  });

  it("a new swipe that starts while the old momentum is still fading counts, once the step has landed", () => {
    const step = createWheelStepper();
    const tail = swipe(1500);
    expect(play(step, 0, 16, tail)).toEqual([1]);
    // No pause at all (events 16 ms apart) between the tail's last event and a strong new push that builds up.
    expect(play(step, 16 * tail.length, 16, [6, 30, 70, 110, 90, 60])).toEqual([1]);
  });

  it("the other way after a step counts as a new gesture", () => {
    const step = createWheelStepper();
    expect(step(120, 0, 0)).toBe(1);
    expect(step(-90, 0, 100)).toBe(0); // too soon: still the same gesture
    expect(step(-90, 0, 700)).toBe(-1);
  });

  it("tiny movements add up but sideways or zero ones do not step", () => {
    const step = createWheelStepper();
    expect(play(step, 0, 16, [4, 4, 4, 4, 4, 4, 4])).toEqual([1]);
    expect(createWheelStepper()(0, 0, 0)).toBe(0);
  });

  it("the reel on screen is the one the scroll position shows", () => {
    expect(reelAt(0, 800, 6)).toBe(0);
    expect(reelAt(390, 800, 6)).toBe(0);
    expect(reelAt(410, 800, 6)).toBe(1);
    expect(reelAt(99999, 800, 6)).toBe(5);
    expect(reelAt(100, 0, 6)).toBe(0);
  });
});

const refs = Array.from({ length: 300 }, (_, i) => `${(i * 7) % 114 + 1}:${(i * 13) % 20 + 1}`);
/** The reciters of reels in a row, chosen the way the feed does (each one against the last few). */
function sequence(preferred?: string, list = refs) {
  const out: string[] = [];
  let recent: string[] = [];
  for (const ref of list) {
    const r = pickReciter(ref, recent, preferred);
    out.push(r);
    recent = [r, ...recent].slice(0, 6);
  }
  return out;
}

describe("reel reciters", () => {
  const known = new Set(RECITERS.map(([f]) => f));

  it("come from the app's reciters, without the slow Mujawwad styles", () => {
    expect(reelReciters().length).toBeGreaterThan(10);
    for (const f of reelReciters()) expect(known.has(f), f).toBe(true);
    expect(reelReciters().some((f) => /Mujawwad/i.test(f))).toBe(false);
    for (const r of sequence()) expect(known.has(r), r).toBe(true);
  });

  it("neighbouring reels never share a reciter, and the last few are all different", () => {
    for (const preferred of [undefined, "Alafasy_128kbps", "Husary_128kbps_Mujawwad"]) {
      const seq = sequence(preferred);
      for (let i = 1; i < seq.length; i++) expect(seq[i], `${preferred} #${i}`).not.toBe(seq[i - 1]);
      for (let i = 4; i < seq.length; i++) if (seq[i] !== preferred) expect(seq.slice(i - 4, i), `${preferred} #${i}`).not.toContain(seq[i]);
    }
  });

  it("without a preference every reciter gets a turn, none dominates", () => {
    const seq = sequence();
    const counts = new Map<string, number>();
    for (const r of seq) counts.set(r, (counts.get(r) ?? 0) + 1);
    expect(counts.size).toBe(reelReciters().length);
    expect(Math.max(...counts.values())).toBeLessThan(seq.length * 0.2);
  });

  it("the person's reciter comes in on about one reel in three, and is never the only one", () => {
    const seq = sequence("Husary_128kbps");
    const own = seq.filter((r) => r === "Husary_128kbps").length / seq.length;
    expect(own).toBeGreaterThan(0.2);
    expect(own).toBeLessThan(0.45);
    expect(new Set(seq).size).toBeGreaterThan(10);
  });

  it("is the same for the same ayah and neighbours (a reel keeps its reciter)", () => {
    expect(sequence("Alafasy_128kbps")).toEqual(sequence("Alafasy_128kbps"));
    expect(pickReciter("94:5", ["Alafasy_128kbps"], undefined)).toBe(pickReciter("94:5", ["Alafasy_128kbps"], undefined));
    expect(pickReciter("94:5", [], undefined)).not.toBe(pickReciter("94:5", [pickReciter("94:5", [], undefined)], undefined));
  });
});

describe("which reels are got ready (preloadPlan)", () => {
  const plan = (i: number, n = 20, data = false) => preloadPlan(i, n, data).map(({ i: k, level }) => `${k}:${level}`);

  it("the reel on screen and the next two in full, nearest first, then the one before; the third ahead lightly", () => {
    expect(plan(5)).toEqual(["5:full", "6:full", "7:full", "4:full", "8:light", "3:keep", "9:keep"]);
  });

  it("at the start and the end of the list only the reels that exist", () => {
    expect(plan(0)).toEqual(["0:full", "1:full", "2:full", "3:light", "4:keep"]);
    expect(plan(19)).toEqual(["19:full", "18:full", "17:keep"]);
  });

  it("with data saver, only one ahead; the one before stays drawn, nothing new downloads for the others", () => {
    expect(plan(5, 20, true)).toEqual(["5:full", "6:full", "4:light", "3:keep", "7:keep"]);
  });

  it("data saver is the browser's setting or a 2G connection", () => {
    expect(saveData({})).toBe(false);
    expect(saveData({ connection: { saveData: false, effectiveType: "4g" } })).toBe(false);
    expect(saveData({ connection: { saveData: true, effectiveType: "4g" } })).toBe(true);
    expect(saveData({ connection: { effectiveType: "2g" } })).toBe(true);
    expect(saveData({ connection: { effectiveType: "slow-2g" } })).toBe(true);
    expect(saveData({ connection: { effectiveType: "3g" } })).toBe(false);
  });
});

describe("the reel canvas's size (reelCanvasSize)", () => {
  it("has the screen's own pixels: CSS width × device pixel ratio, the height in proportion", () => {
    expect(reelCanvasSize(375, 812, 3)).toEqual([1125, 2436]);
    expect(reelCanvasSize(390, 844, 2)).toEqual([780, 1688]);
    expect(reelCanvasSize(412, 915, 2.625)).toEqual([1082, 2403]);
  });

  it("is never under 720 wide (DPR 1, a narrow column)", () => {
    expect(reelCanvasSize(375, 812, 1)).toEqual([720, 1559]);
    expect(reelCanvasSize(300, 600, 2)).toEqual([720, 1440]);
  });

  it("is at most 1440 wide, and 1080 on a device with 4 GB of memory or less", () => {
    expect(reelCanvasSize(430, 932, 3)).toEqual([1290, 2796]);
    expect(reelCanvasSize(600, 1000, 3)).toEqual([1440, 2400]);
    expect(reelCanvasSize(375, 812, 3, 4)).toEqual([1080, 2339]);
    expect(reelCanvasSize(375, 812, 3, 2)).toEqual([1080, 2339]);
    expect(reelCanvasSize(375, 812, 3, 8)).toEqual([1125, 2436]);
    expect(reelCanvasSize(390, 844, 2, 2)).toEqual([780, 1688]); // under the cap: the screen's own pixels
  });

  it("keeps the old shape limits (1.25 to 2.22 times the width) and a default before the feed is measured", () => {
    expect(reelCanvasSize(800, 600, 1)).toEqual([800, 1000]);
    expect(reelCanvasSize(300, 1000, 3)).toEqual([900, 2000]);
    expect(reelCanvasSize(0, 0, 3)).toEqual([720, 1280]);
  });
});


describe("1080p while watching", () => {
  afterEach(() => {
    resetClipSpeed();
    delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("upgrades only on a good connection: no data saver, 4G, at least 5 Mbps when the browser says", () => {
    expect(canUpgrade({ connection: { effectiveType: "4g", downlink: 10 } })).toBe(true);
    expect(canUpgrade({ connection: { effectiveType: "4g" } })).toBe(true); // downlink unknown
    expect(canUpgrade({ connection: { effectiveType: "4g", downlink: 4.9 } })).toBe(false);
    expect(canUpgrade({ connection: { effectiveType: "3g", downlink: 10 } })).toBe(false);
    expect(canUpgrade({ connection: { effectiveType: "4g", downlink: 10, saveData: true } })).toBe(false);
  });

  it("without the Network Information API (iOS), only when the 720p clips measured downloaded fast", () => {
    expect(canUpgrade({}, null)).toBe(false); // nothing measured
    expect(canUpgrade({})).toBe(false);
    noteClipDownload(2_000_000, 4_000); // 4 Mbps
    expect(canUpgrade({})).toBe(false);
    noteClipDownload(3_000_000, 1_200); // 20 Mbps
    expect(canUpgrade({})).toBe(true);
    noteClipDownload(3_000_000, 40); // from a cache: not a measurement of the network
    expect(canUpgrade({})).toBe(true);
    noteClipDownload(3_000_000, 8_000); // 3 Mbps
    expect(canUpgrade({})).toBe(false);
  });

  /** The reel's frame with its 720p video playing at `at` seconds. */
  function reel(at: number) {
    const frame = document.createElement("div"), visible = document.createElement("video");
    let time = at;
    Object.defineProperty(visible, "currentTime", { get: () => time, set: (x: number) => (time = x), configurable: true });
    Object.defineProperty(visible, "paused", { value: false, configurable: true });
    visible.loop = true;
    visible.src = "/media/clips/p/a.mp4";
    frame.append(visible);
    document.body.append(frame);
    return { frame, visible, setTime: (x: number) => (time = x) };
  }
  const hdOf = (frame: HTMLElement) => {
    const hd = frame.querySelector("video")!;
    let time = 0;
    Object.defineProperty(hd, "currentTime", { get: () => time, set: (x: number) => (time = x), configurable: true });
    return hd;
  };
  /** requestVideoFrameCallback, with the frames painted by the test. */
  function frames() {
    const queued: (() => void)[] = [];
    (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback = function (cb: VideoFrameRequestCallback) {
      queued.push(() => cb(0, {} as VideoFrameCallbackMetadata));
      return queued.length;
    };
    return queued;
  }

  it("loads hidden under the 720p video, starts where it is, and swaps on its first painted frame", async () => {
    const queued = frames();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const { frame, visible } = reel(3.2);
    const done = upgradeVideo(visible, "/media/clips/p1080/a.mp4", new AbortController().signal);
    const hd = hdOf(frame);
    expect(hd).not.toBe(visible);
    expect([...frame.children]).toEqual([hd, visible]); // behind it: the 720p one paints on top until the swap
    expect(hd.getAttribute("src")).toBe("/media/clips/p1080/a.mp4");
    expect(hd).toMatchObject({ muted: true, loop: true, playsInline: true, preload: "auto" });
    expect(play).not.toHaveBeenCalled();
    hd.dispatchEvent(new Event("canplaythrough"));
    expect(hd.currentTime).toBe(3.2);
    expect(play.mock.contexts).toEqual([hd]);
    expect(visible.style.visibility).toBe(""); // nothing swapped before it has painted
    queued[0]();
    expect(await done).toBe(hd);
    expect(visible.style.visibility).toBe("hidden");
    expect(visible.hasAttribute("src")).toBe(false); // the 720p file is let go of
    expect(hd.isConnected).toBe(true);
  });

  it("catches up once when the 720p one played on during the seek", async () => {
    const queued = frames();
    const { frame, visible, setTime } = reel(1);
    const done = upgradeVideo(visible, "/hd.mp4", new AbortController().signal);
    const hd = hdOf(frame);
    hd.dispatchEvent(new Event("canplaythrough"));
    setTime(1.4);
    queued[0]();
    expect(hd.currentTime).toBe(1.4);
    expect(visible.style.visibility).toBe("");
    queued[1]();
    expect(await done).toBe(hd);
  });

  it("without requestVideoFrameCallback it swaps on 'playing'", async () => {
    const { frame, visible } = reel(0.5);
    const done = upgradeVideo(visible, "/hd.mp4", new AbortController().signal);
    const hd = hdOf(frame);
    hd.dispatchEvent(new Event("canplaythrough"));
    hd.dispatchEvent(new Event("playing"));
    expect(await done).toBe(hd);
    expect(visible.style.visibility).toBe("hidden");
  });

  it("a failed 1080p file, or one that cannot play, leaves the 720p one as it was", async () => {
    for (const how of ["error", "play"] as const) {
      const { frame, visible } = reel(2);
      if (how === "play") vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new Error("NotAllowedError"));
      const done = upgradeVideo(visible, "/hd.mp4", new AbortController().signal);
      const hd = hdOf(frame);
      hd.dispatchEvent(new Event(how === "error" ? "error" : "canplaythrough"));
      await expect(done).rejects.toThrow();
      expect(hd.isConnected).toBe(false);
      expect(visible.getAttribute("src")).toBe("/media/clips/p/a.mp4");
      expect(visible.style.visibility).toBe("");
    }
  });

  it("swiping away (abort) cancels the load", async () => {
    const queued = frames();
    const { frame, visible } = reel(2);
    const ctl = new AbortController();
    const done = upgradeVideo(visible, "/hd.mp4", ctl.signal);
    const hd = hdOf(frame);
    ctl.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(hd.isConnected).toBe(false);
    expect(hd.hasAttribute("src")).toBe(false);
    hd.dispatchEvent(new Event("canplaythrough")); // late events do nothing
    expect(queued).toEqual([]);
    expect(visible.style.visibility).toBe("");
  });
});
