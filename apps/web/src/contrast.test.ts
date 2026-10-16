import { describe, expect, it } from "vitest";
import {
  areaStats, blend, contrastRatio, cost, DARK_TEXT, HALO_K, luminanceOf, SHADE_MAX, SHADE_MIN, shadeFor, solve, TARGET_LARGE, TARGET_TEXT, toLinear,
  type Backdrop, type Need,
} from "./contrast";

/** A backdrop whose cells come from `f(x, y, frame)` (gamma-encoded grey 0..1). */
const backdrop = (w: number, h: number, f: (x: number, y: number, k: number) => number, frames = 8): Backdrop => ({
  key: "t", w, h, frames: Array.from({ length: frames }, (_, k) => Float32Array.from({ length: w * h }, (_, i) => toLinear(f(i % w, Math.floor(i / w), k)))),
});
const flat = (grey: number) => backdrop(9, 16, () => grey);
const W = 1080, H = 1920, BLOCK = { x: 76, y: 700, w: 928, h: 520 };
const light: Need = { text: "#ffffff", target: TARGET_TEXT, box: null };
const stats = (b: Backdrop) => areaStats(b, W, H, BLOCK);

describe("colour maths", () => {
  it("WCAG luminance and contrast", () => {
    expect(luminanceOf("#ffffff")).toBeCloseTo(1, 5);
    expect(luminanceOf("#000000")).toBe(0);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 5);
    expect(contrastRatio(luminanceOf("#767676"), 1)).toBeCloseTo(4.54, 1);
    expect(blend(1, 0, 0.5)).toBeCloseTo(toLinear(0.5), 5); // canvas blends gamma-encoded values
  });
});

describe("reading the area behind the text", () => {
  it("reads the cells behind the area through the cover crop, every frame", () => {
    // Top half white, bottom half black; a block in the lower half sees only black.
    const half = backdrop(9, 16, (_x, y) => (y < 8 ? 1 : 0));
    expect(areaStats(half, W, H, { x: 100, y: 1100, w: 800, h: 400 }).p95).toBe(0);
    expect(areaStats(half, W, H, { x: 100, y: 200, w: 800, h: 400 }).p5).toBeCloseTo(1, 5);
    // A square frame shows the middle of a portrait clip.
    expect(areaStats(half, 1080, 1080, { x: 0, y: 0, w: 1080, h: 500 }).p95).toBeCloseTo(1, 5);
    // A frame that brightens later counts: the brightest moments break readability.
    const later = backdrop(9, 16, (_x, _y, k) => (k === 7 ? 0.9 : 0.1));
    expect(stats(later).p95).toBeCloseTo(toLinear(0.9), 4);
  });

  it("the same answer at preview and export sizes", () => {
    const b = backdrop(36, 64, (x, y) => ((x * 7 + y * 13) % 17) / 17);
    const preview = areaStats(b, 1080, 1920, { x: 75.6, y: 691.2, w: 928.8, h: 518.4 });
    const exported = areaStats(b, 720, 1280, { x: 50.4, y: 460.8, w: 619.2, h: 345.6 });
    expect(exported).toEqual(preview);
  });
});

describe("the least visible fix", () => {
  it("dark backgrounds: nothing at all", () => {
    for (const grey of [0, 0.15, 0.3, 0.42]) {
      const tr = solve(stats(flat(grey)), light);
      expect(tr.level, `grey ${grey}`).toBe("none");
      expect(tr.contrast).toBeGreaterThanOrEqual(TARGET_TEXT);
    }
  });

  it("mid-bright: a halo; brighter: a soft scrim solved for the target; white and plain: dark text", () => {
    expect(solve(stats(flat(0.6)), light).level).toBe("halo");
    // Bright but not plain (light clouds): a gentle gradient across the block.
    const clouds = backdrop(36, 64, (x) => 0.72 + 0.16 * Math.sin(x / 3));
    const scrim = solve(stats(clouds), light);
    expect(scrim.level).toBe("scrim");
    expect(scrim.scrim!.alpha).toBeGreaterThan(0.3);
    expect(scrim.scrim!.alpha).toBeLessThan(0.6);
    expect(contrastRatio(1, blend(scrim.stats.p95, 0, scrim.scrim!.alpha))).toBeGreaterThanOrEqual(TARGET_TEXT);
    const sky = solve(stats(flat(0.95)), light);
    expect(sky).toMatchObject({ level: "dark", text: DARK_TEXT, scrim: null });
    expect(sky.contrast).toBeGreaterThanOrEqual(TARGET_TEXT);
  });

  it("busy textures push one step stronger and never go dark-text", () => {
    const busy = backdrop(36, 64, (x, y) => ((x + y) % 2 ? 0.95 : 0.35));
    const tr = solve(stats(busy), light);
    expect(tr.stats.busy).toBeGreaterThan(0.13);
    expect(tr.level).toBe("scrim");
    expect(tr.contrast).toBeGreaterThanOrEqual(TARGET_TEXT);
    const calmTwin = solve(stats(flat(0.6)), light), busyTwin = solve(stats(backdrop(36, 64, (x, y) => ((x + y) % 2 ? 0.66 : 0.3))), light);
    expect(calmTwin.level).toBe("halo");
    expect(busyTwin.level).toBe("scrim");
  });

  it("large Arabic alone needs less than the translation", () => {
    const b = stats(flat(0.5));
    expect(solve(b, { ...light, target: TARGET_LARGE }).level).toBe("none");
    expect(solve(b, light).level).not.toBe("none");
  });

  it("glass and solid boxes keep their look: opacity raised only as far as needed", () => {
    const solid: Need = { ...light, box: { color: "#000000", opacity: 40, max: 1 } };
    expect(solve(stats(flat(0.3)), solid)).toMatchObject({ level: "none", boxOpacity: 40 });
    const raised = solve(stats(flat(0.9)), solid);
    expect(raised.level).toBe("box");
    expect(raised.boxOpacity).toBeGreaterThan(40);
    expect(raised.boxOpacity).toBeLessThan(66);
    expect(raised.contrast).toBeGreaterThanOrEqual(TARGET_TEXT);
    // No more than needed (with the 10 % safety margin the opacity is solved for).
    expect(contrastRatio(1, blend(raised.stats.p95, 0, (raised.boxOpacity - 1) / 100))).toBeLessThan(TARGET_TEXT * 1.1);
    expect(raised.scrim).toBeNull();
    expect(raised.text).toBe("#ffffff");
    // Glass: its white sheen is counted, so it needs a little more than a solid box.
    const glass = solve(stats(flat(0.9)), { ...light, box: { color: "#000000", opacity: 22, max: 0.9, sheen: 0.1 } });
    expect(glass.level).toBe("box");
    expect(glass.boxOpacity).toBeGreaterThan(raised.boxOpacity);
    expect(contrastRatio(1, blend(blend(glass.stats.p95, 0, glass.boxOpacity / 100), 1, 0.1))).toBeGreaterThanOrEqual(TARGET_TEXT);
  });

  it("dark text works the other way round", () => {
    const dark: Need = { text: "#000000", target: TARGET_TEXT, box: null };
    expect(solve(stats(flat(0.9)), dark).level).toBe("none");
    const night = solve(stats(flat(0.05)), dark);
    expect(night).toMatchObject({ level: "dark", text: "#ffffff" }); // flipped to light text
    const dusk = solve(stats(flat(0.35)), dark);
    expect(["halo", "scrim"]).toContain(dusk.level);
    if (dusk.scrim) expect(dusk.scrim.color).toBe("#ffffff");
  });

  it("the halo is a glow as strong as needed (its effect calibrated), within its range; beyond it, a scrim", () => {
    const slight = solve(stats(flat(0.5)), light), more = solve(stats(flat(0.6)), light);
    expect(slight.level).toBe("halo");
    expect(more.level).toBe("halo");
    expect(more.halo!.alpha).toBeGreaterThan(slight.halo!.alpha);
    expect(more.halo!.alpha).toBeLessThanOrEqual(0.85);
    expect(more.contrast).toBeGreaterThanOrEqual(TARGET_TEXT);
    expect(contrastRatio(1, blend(more.stats.p95, 0, HALO_K * more.halo!.alpha))).toBeGreaterThanOrEqual(TARGET_TEXT);
    expect(solve(stats(backdrop(36, 64, (x) => 0.72 + 0.16 * Math.sin(x / 3))), light).level).toBe("scrim"); // more than a glow can do
  });

  it("cost orders the fixes from calm to strong", () => {
    const levels = [0.2, 0.6, 0.82].map((g) => cost(solve(stats(flat(g)), light)));
    expect(levels[0]).toBeLessThan(levels[1]);
    expect(levels[1]).toBeLessThan(levels[2]);
  });
});

describe("effect Shade: one shade over the whole frame", () => {
  it("dark clips get the least shade, bright ones as much as white text needs, never past the maximum", () => {
    expect(shadeFor([stats(flat(0.1))], "#ffffff", TARGET_TEXT)).toEqual({ color: "#000000", alpha: SHADE_MIN });
    const mid = shadeFor([stats(flat(0.8))], "#ffffff", TARGET_TEXT);
    expect(mid.alpha).toBeGreaterThan(SHADE_MIN);
    expect(mid.alpha).toBeLessThan(SHADE_MAX);
    expect(contrastRatio(1, blend(toLinear(0.8), 0, mid.alpha))).toBeGreaterThanOrEqual(TARGET_TEXT);
    const white = shadeFor([stats(flat(1))], "#ffffff", TARGET_TEXT).alpha;
    expect(white).toBeGreaterThan(mid.alpha);
    expect(white).toBeLessThanOrEqual(SHADE_MAX);
    // The brightest area decides (the block and the surah line).
    expect(shadeFor([stats(flat(0.1)), stats(flat(0.8))], "#ffffff", TARGET_TEXT)).toEqual(mid);
  });
  it("a busy texture gets more; dark text gets a light shade; a plain colour is not darkened past its need", () => {
    const stripes = backdrop(9, 16, (x) => (x % 2 ? 0.05 : 0.3));
    expect(shadeFor([stats(stripes)], "#ffffff", TARGET_TEXT).alpha).toBeGreaterThan(SHADE_MIN);
    expect(shadeFor([stats(flat(0.9))], DARK_TEXT, TARGET_TEXT).color).toBe("#ffffff");
    expect(shadeFor([stats(flat(0))], "#ffffff", TARGET_TEXT, 0).alpha).toBe(0);
  });
});
