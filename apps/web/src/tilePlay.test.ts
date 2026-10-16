// Search tiles that move: only the few nearest the middle of the screen play, the rest hold still, off-screen ones let
// their file go, and nothing plays when the screen is not shown or motion / data must be spared.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canMove, registerTile, setTilesActive } from "./tilePlay";

type Cb = (list: { target: Element; isIntersecting: boolean; intersectionRatio: number }[]) => void;
let fire: Cb;
const media = () => ({ matches: false }) as MediaQueryList;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: Cb) { fire = cb; } observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", media);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  setTilesActive(true);
});
afterEach(() => vi.restoreAllMocks());

function tile(top: number) {
  const el = document.createElement("li"), video = document.createElement("video");
  el.getBoundingClientRect = () => ({ top, height: 200 }) as DOMRect;
  return { el, video, stop: registerTile(el, video, `/media/previews/${top}.mp4`) };
}
const seen = (el: Element, ratio: number) => fire([{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio }]);

describe("tilePlay", () => {
  it("plays the 4 tiles nearest the middle, loads nothing for the rest", () => {
    const mid = window.innerHeight / 2 - 100;
    const tiles = [0, 1, 2, 3, 4, 5].map((i) => tile(mid + (i % 2 ? 1 : -1) * i * 50));
    for (const t of tiles) seen(t.el, 1);
    const playing = tiles.filter((t) => t.video.getAttribute("src"));
    expect(playing.map((t) => tiles.indexOf(t))).toEqual([0, 1, 2, 3]);
    expect(tiles[0].video.muted).toBe(true);
    tiles.forEach((t) => t.stop());
  });

  it("a tile barely in view holds still; one that leaves the screen lets its file go", () => {
    const t = tile(100);
    seen(t.el, 0.3);
    expect(t.video.getAttribute("src")).toBeNull();
    seen(t.el, 0.9);
    expect(t.video.getAttribute("src")).toBe("/media/previews/100.mp4");
    seen(t.el, 0);
    expect(t.video.getAttribute("src")).toBeNull();
    t.stop();
  });

  it("nothing plays while Results is not the screen shown", () => {
    const t = tile(100);
    setTilesActive(false);
    seen(t.el, 1);
    expect(t.video.getAttribute("src")).toBeNull();
    setTilesActive(true);
    expect(t.video.getAttribute("src")).not.toBeNull();
    t.stop();
  });

  it("spares motion and data", () => {
    expect(canMove({ connection: { effectiveType: "4g" } })).toBe(true);
    expect(canMove({ connection: { saveData: true } })).toBe(false);
    expect(canMove({ connection: { effectiveType: "2g" } })).toBe(false);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList);
    expect(canMove({})).toBe(false);
  });
});
