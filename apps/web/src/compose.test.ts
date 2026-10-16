import { describe, expect, it } from "vitest";
import {
  ayahAt, ayahWindow, calmer, clampCentre, ENTER, EXIT, partState, sectionAt, sectionCount, sectionWindow, shiftHeader, shiftPlan, type PartSpec,
  type TextPlan, type Timing,
} from "./compose";

const part = (ayah: number, kind: "ar" | "tr"): PartSpec => ({ ayah, kind, x: 0, y: 0 });
const plan: TextPlan = {
  width: 1080, height: 1920, box: { x: 76, y: 800, w: 928, h: 400, radius: 28 }, boxAt: { x: 74, y: 798 },
  area: { top: 58, bottom: 1800 }, blur: 0,
  parts: [part(0, "ar"), part(0, "tr"), part(1, "ar"), part(1, "tr"), part(2, "ar")],
  header: { rect: { x: 340, y: 145, w: 400, h: 132 }, at: { x: 340, y: 145 } }, brandAt: { x: 420, y: 1814 },
};
const [ar0, tr0, ar1, tr1, ar2] = plan.parts;
// Three ayahs recited back to back: 0–4 s, 4–10 s, 10–15 s, then a 1.5 s tail.
const timing = (animation: Timing["animation"]): Timing => ({ starts: [0, 4, 10], durations: [4, 6, 5], animation, end: 16.5 });
const at = (p: PartSpec, tm: Timing | null, t: number, still?: number) => partState(plan, p, tm, t, still);
const ANIMATIONS = ["none", "fade", "rise", "zoom"] as const;

describe("each ayah's text is on screen exactly while it is recited", () => {
  it("windows: from its recitation's start to the next one's; the last one to the end of the tail", () => {
    const tm = timing("fade");
    expect(ayahWindow(tm, 0)).toEqual([0, 4]);
    expect(ayahWindow(tm, 1)).toEqual([4, 10]);
    expect(ayahWindow(tm, 2)).toEqual([10, 16.5]);
    expect(ayahWindow({ ...tm, end: undefined }, 2)).toEqual([10, 15]); // no tail given: the end of the recitation
    expect([-0.1, 0, 3.99, 4, 9.99, 10, 16.49, 16.5].map((t) => ayahAt(tm, t))).toEqual([-1, 0, 0, 1, 1, 2, 2, -1]);
  });

  for (const a of ANIMATIONS) {
    it(`${a}: never two ayahs at once, never an ayah outside its recitation`, () => {
      const tm = timing(a);
      for (let t = -0.5; t < 17; t += 0.01) {
        const visible = [0, 1, 2].filter((i) => at(plan.parts.find((p) => p.ayah === i)!, tm, t).alpha > 0);
        expect(visible.length, `t=${t}`).toBeLessThanOrEqual(1);
        if (visible.length) expect(visible[0], `t=${t}`).toBe(ayahAt(tm, t));
      }
    });
  }

  it("Arabic, translation and reference move together (the whole block)", () => {
    for (const a of ANIMATIONS) for (const t of [0.1, 2, 3.8, 4.2, 9.9]) {
      expect(at(ar0, timing(a), t)).toEqual(at(tr0, timing(a), t));
      expect(at(ar1, timing(a), t)).toEqual(at(tr1, timing(a), t));
    }
  });
});

describe("entry and exit", () => {
  it("none: a cut exactly at the recitation boundaries", () => {
    const none = timing("none");
    expect(at(ar0, none, 0)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(at(ar0, none, 3.999).alpha).toBe(1);
    expect(at(ar0, none, 4).alpha).toBe(0);
    expect(at(ar1, none, 4)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(at(ar2, none, 16)).toEqual({ alpha: 1, dy: 0, scale: 1 }); // the tail
  });

  it("fade: enters from nothing as the recitation starts, is steady, and is gone as it ends", () => {
    const fade = timing("fade");
    expect(at(ar1, fade, 4).alpha).toBe(0); // starts entering exactly at its recitation's start
    const mid = at(ar1, fade, 4 + ENTER / 2);
    expect(mid.alpha).toBeGreaterThan(0.5);
    expect(mid.alpha).toBeLessThan(1);
    expect(at(ar1, fade, 4 + ENTER)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(at(ar1, fade, 7)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(at(ar1, fade, 10 - EXIT).alpha).toBe(1); // leaving starts EXIT before the end
    const out = at(ar1, fade, 10 - EXIT / 2).alpha;
    expect(out).toBeGreaterThan(0.3);
    expect(out).toBeLessThan(0.7);
    expect(at(ar1, fade, 9.999).alpha).toBeLessThan(0.01);
    expect(at(ar2, fade, 16.4).alpha).toBeLessThan(0.2); // the last one leaves at the end of the tail
  });

  it("rise comes up from below and drifts on upwards; zoom grows softly", () => {
    const rise = timing("rise"), zoom = timing("zoom");
    expect(at(ar1, rise, 4.1).dy).toBeGreaterThan(0);
    expect(at(ar1, rise, 7).dy).toBe(0);
    expect(at(ar1, rise, 9.9).dy).toBeLessThan(0);
    expect(Math.abs(at(ar1, rise, 4.01).dy)).toBeLessThanOrEqual(1920 * 0.03);
    expect(at(ar1, zoom, 4.1).scale).toBeLessThan(1);
    expect(at(ar1, zoom, 4.1).scale).toBeGreaterThan(0.93);
    expect(at(ar1, zoom, 7).scale).toBe(1);
    expect(at(ar1, zoom, 9.9).scale).toBeGreaterThan(1);
    expect(at(ar1, zoom, 9.9).scale).toBeLessThan(1.04);
  });

  it("a very short ayah still gets its full moment on screen", () => {
    const short: Timing = { starts: [0, 0.6], durations: [0.6, 3], animation: "fade" };
    const peak = Math.max(...Array.from({ length: 60 }, (_, k) => at(ar0, short, k / 100).alpha));
    expect(peak).toBeGreaterThan(0.9);
    expect(at(ar0, short, 0.6).alpha).toBe(0);
  });

  it("reduced motion plays rise and zoom as a fade", () => {
    expect(calmer("rise", true)).toBe("fade");
    expect(calmer("zoom", true)).toBe("fade");
    expect(calmer("none", true)).toBe("none");
    expect(calmer("zoom", false)).toBe("zoom");
  });

  it("no timing shows only the chosen ayah, in full (images, paused preview)", () => {
    expect(at(ar1, null, 0, 1)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(at(tr1, null, 0, 1)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(at(ar0, null, 0, 1).alpha).toBe(0);
    expect(at(ar2, null, 0).alpha).toBe(0); // default: the first ayah
    expect(at(ar0, null, 0).alpha).toBe(1);
  });
});

describe("moving the block and the header", () => {
  it("keeps a block inside the frame and above the branding", () => {
    expect(clampCentre(plan, 928, 400, 0, 0)).toEqual({ x: 464, y: 258 });
    expect(clampCentre(plan, 928, 400, 2000, 5000)).toEqual({ x: 1080 - 464, y: 1600 });
    expect(clampCentre(plan, 500, 400, 300, 900)).toEqual({ x: 300, y: 900 });
    expect(clampCentre(plan, 500, 3000, 300, 900).y).toBe((58 + 1800) / 2); // taller than the area: centred in it
  });

  it("shiftPlan moves the box and the layers together; shiftHeader moves only the header", () => {
    const moved = shiftPlan(plan, 10, -20);
    expect(moved.box).toMatchObject({ x: 86, y: 780 });
    expect(moved.boxAt).toEqual({ x: 84, y: 778 });
    expect(moved.parts[2]).toMatchObject({ x: 10, y: -20 });
    expect(moved.header).toBe(plan.header);
    expect(shiftPlan(plan, 0, 0)).toBe(plan);
    const head = shiftHeader(plan, -40, 300);
    expect(head.header).toEqual({ rect: { x: 300, y: 445, w: 400, h: 132 }, at: { x: 300, y: 445 } });
    expect(head.box).toBe(plan.box);
    expect(head.brandAt).toBe(plan.brandAt);
    expect(shiftHeader({ ...plan, header: null }, 5, 5).header).toBeNull();
  });
});

describe("a long ayah in parts", () => {
  // Ayah 1 (4–10 s) is shown in three parts, starting at 0 %, 40 % and 75 % of its recitation.
  const split: TextPlan = {
    ...plan, sections: [[0], [0, 0.4, 0.75], [0]],
    parts: [part(0, "ar"), { ...part(1, "ar"), section: 0 }, { ...part(1, "tr"), section: 0 }, { ...part(1, "ar"), section: 1 },
      { ...part(1, "tr"), section: 1 }, { ...part(1, "ar"), section: 2 }, part(2, "ar")],
  };
  const layer = (ayah: number, section: number) => split.parts.find((p) => p.ayah === ayah && (p.section ?? 0) === section && p.kind === "ar")!;
  const st = (p: PartSpec, tm: Timing | null, t: number, still?: number, section?: number) => partState(split, p, tm, t, still, section);

  it("each part is on screen for its share of the recitation; the ayahs around it are unchanged", () => {
    const none = timing("none");
    expect(sectionWindow(split, none, 1, 0)).toEqual([4, 4 + 6 * 0.4]);
    expect(sectionWindow(split, none, 1, 1)).toEqual([4 + 6 * 0.4, 4 + 6 * 0.75]);
    expect(sectionWindow(split, none, 1, 2)).toEqual([4 + 6 * 0.75, 10]);
    expect(sectionCount(split, 1)).toBe(3);
    expect(sectionCount(split, 0)).toBe(1);
    expect(sectionCount(plan, 1)).toBe(1); // a plan without parts
    expect(st(layer(1, 0), none, 4)).toEqual({ alpha: 1, dy: 0, scale: 1 });
    expect(st(layer(1, 0), none, 6.39).alpha).toBe(1);
    expect(st(layer(1, 0), none, 6.4).alpha).toBe(0);
    expect(st(layer(1, 1), none, 6.4).alpha).toBe(1);
    expect(st(layer(1, 2), none, 9.99).alpha).toBe(1);
    expect(st(layer(0, 0), none, 3.99).alpha).toBe(1);
    expect(st(layer(2, 0), none, 10).alpha).toBe(1);
  });

  for (const a of ANIMATIONS) {
    it(`${a}: never two parts at once; a part's Arabic and translation move together`, () => {
      const tm = timing(a);
      for (let t = -0.5; t < 17; t += 0.01) {
        const on = split.parts.filter((p) => st(p, tm, t).alpha > 0).map((p) => `${p.ayah}.${p.section ?? 0}`);
        expect(new Set(on).size, `t=${t}`).toBeLessThanOrEqual(1);
      }
      for (const t of [4.1, 6.5, 8.9]) expect(st(split.parts[3], tm, t)).toEqual(st(split.parts[4], tm, t));
    });
  }

  it("parts enter and leave with the design's animation", () => {
    const fade = timing("fade"), b = 4 + 6 * 0.4;
    expect(st(layer(1, 1), fade, b).alpha).toBe(0); // enters at its start
    expect(st(layer(1, 1), fade, b + ENTER).alpha).toBe(1);
    expect(st(layer(1, 0), fade, b - EXIT / 2).alpha).toBeLessThan(0.7); // the part before leaves as it ends
    expect(st(layer(1, 0), fade, b - EXIT / 2).alpha).toBeGreaterThan(0.3);
  });

  it("no timing: part `section` of ayah `still`, clamped to its last part", () => {
    expect(st(layer(1, 1), null, 0, 1, 1).alpha).toBe(1);
    expect(st(layer(1, 0), null, 0, 1, 1).alpha).toBe(0);
    expect(st(layer(1, 0), null, 0, 1).alpha).toBe(1); // default: the first part
    expect(st(layer(1, 2), null, 0, 1, 7).alpha).toBe(1);
    expect(st(layer(0, 0), null, 0, 0, 2).alpha).toBe(1); // a whole ayah has only its one part
  });

  it("the part being recited", () => {
    const tm = timing("fade");
    expect([4, 6.39, 6.4, 8.4, 8.9, 9.99, 3].map((t) => sectionAt(split, tm, 1, t))).toEqual([0, 0, 1, 1, 2, 2, 0]);
    expect(sectionAt(split, tm, 0, 2)).toBe(0);
  });
});
