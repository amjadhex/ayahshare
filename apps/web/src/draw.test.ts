// drawLayers' choice of which ayahs to show in parts, on a stand-in canvas (jsdom has none): text widths are
// proportional to the number of characters and the font size (about as wide as the real fonts: the Arabic counts its
// vowel marks as characters), and every line drawn is recorded.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Recipe, Surah } from "../../../contracts/types";
import { DEFAULT_RECIPE, SIZES } from "./config";
import { arabicDigits, drawLayers } from "./draw";
// The app's own text, fetched from its API; never typed by hand.
import fixture from "./test/long-ayahs.json";

const A = fixture.ayahs;
let drawn: { text: string; font: string; x: number; align: string; dir: string; canvas: HTMLCanvasElement }[] = [];
let zeroOnLayers = false; // the drawing contexts (not the 1×1 measuring one) measure every line as 0 wide
const sizeOf = (font: unknown) => parseFloat(String(font).match(/([\d.]+)px/)?.[1] ?? "10");
const widthIn = (font: string, s: string) => s.length * sizeOf(font) * (font.includes("Quran") ? 0.2 : 0.5);
function context(canvas: HTMLCanvasElement) {
  const state: Record<string | symbol, unknown> = { font: "10px sans-serif", canvas, globalAlpha: 1 };
  return new Proxy(state, {
    get(target, key) {
      if (key === "measureText") return (s: string) => ({ width: zeroOnLayers && canvas.width > 1 ? 0 : widthIn(String(target.font), s) });
      if (key === "fillText") return (s: string, x: number) => void drawn.push({ text: s, font: String(target.font), x, align: String(target.textAlign), dir: String(target.direction), canvas });
      if (key in target) return target[key];
      return () => ({ addColorStop() {} });
    },
    set(target, key, v) { target[key] = v; return true; },
  });
}
const original = HTMLCanvasElement.prototype.getContext;
beforeAll(() => { HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) { return context(this); } as never; });
afterAll(() => { HTMLCanvasElement.prototype.getContext = original; });
beforeEach(() => { drawn = []; zeroOnLayers = false; });

const surah: Surah = { n: 2, name_ar: "S", name_en: "Al-Baqarah", meaning: "The Cow", ayahs: 286 };
type Ref = keyof typeof A;
function draw(ref: Ref, opts: { recipe?: Partial<Recipe>; size?: [number, number]; tr?: string; lang?: string; inset?: number } = {}) {
  const [n, num] = ref.split(":").map(Number), a = A[ref];
  const recipe = { ...DEFAULT_RECIPE, surah: n, from: num, to: num, ...opts.recipe };
  const [W, H] = opts.size ?? SIZES.hd[recipe.orientation];
  return drawLayers(W, H, [{ num, ar: a.ar, tr: opts.tr ?? a.en }], { recipe, surah: { ...surah, n }, lang: opts.lang ?? "en", brand: "AyahShare", backdrop: null, ...(opts.inset !== undefined ? { inset: opts.inset } : {}) });
}
/** The words drawn in the Quran font (the ayah's lines, without the header's surah name). */
const arabicWords = () => drawn.filter((d) => d.font.includes("Amiri Quran") && d.text !== "S").flatMap((d) => d.text.split(" "));

describe("long ayahs are shown in parts; normal ones stay whole", () => {
  it("a normal ayah stays whole", () => {
    const l = draw("2:153");
    expect(l.plan.sections).toEqual([[0]]);
    expect(l.plan.parts.map((p) => [p.kind, p.section])).toEqual([["ar", 0], ["tr", 0]]);
  });

  it("2:255 in parts, each with its translation; together every word of the ayah, the number marker on the last", () => {
    const l = draw("2:255");
    const n = l.plan.sections![0].length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(l.plan.parts.map((p) => `${p.kind}${p.section}`)).toEqual(Array.from({ length: n }, (_, j) => [`ar${j}`, `tr${j}`]).flat());
    expect(arabicWords()).toEqual(`${A["2:255"].ar} ۝${arabicDigits(255)}`.split(" "));
    const english = drawn.filter((d) => d.font.includes("Noto Sans")).map((d) => d.text).join(" ");
    expect(english).toBe(`${A["2:255"].en} (2:255)`);
  });

  it("2:282 needs more parts, in every orientation", () => {
    for (const orientation of ["portrait", "square", "landscape"] as const) {
      const n = draw("2:282", { recipe: { orientation } }).plan.sections![0].length;
      expect(n, orientation).toBeGreaterThan(2);
      expect(n, orientation).toBeLessThanOrEqual(8);
    }
  });

  it("larger text never makes a normal ayah long", () => {
    for (const orientation of ["portrait", "square", "landscape"] as const) {
      expect(draw("2:153", { recipe: { orientation, quranSize: 8, transSize: 8 } }).plan.sections, orientation).toEqual([[0]]);
    }
  });

  it("the same parts at every size of the frame (preview, both export sizes, thumbnails)", () => {
    const at = (size: [number, number]) => draw("2:282", { size }).plan.sections;
    expect(at([720, 1280])).toEqual(at([1080, 1920]));
    expect(at([360, 640])).toEqual(at([1080, 1920]));
  });

  it("stays whole with the switch off, or without pause marks", () => {
    expect(draw("2:255", { recipe: { splitLong: false } }).plan.sections).toEqual([[0]]);
    drawn = [];
    expect(draw("33:35").plan.sections).toEqual([[0]]);
    expect(arabicWords()).toEqual(`${A["33:35"].ar} ۝${arabicDigits(35)}`.split(" "));
  });

  it("a translation that cannot be cut is shown whole with every part", () => {
    const hi = A["2:255"].hi;
    const l = draw("2:255", { tr: hi, lang: "hi" });
    const n = l.plan.sections![0].length;
    expect(n).toBeGreaterThanOrEqual(2);
    const lines = drawn.filter((d) => d.font.includes("Devanagari")).map((d) => d.text).join(" ");
    expect(lines).toBe(Array(n).fill(`${hi} (2:255)`).join(" "));
  });
});

describe("the text block never covers the surah header", () => {
  const FORMATS: [string, Recipe["orientation"], [number, number]][] = [
    ["1:1", "square", [1080, 1080]], ["4:5", "portrait", [1080, 1350]], ["9:16", "portrait", [1080, 1920]], ["16:9", "landscape", [1920, 1080]],
    ["reel", "portrait", [720, 1280]], ["tall reel", "portrait", [720, 1600]],
  ];
  // The Reels' own placement (feed.ts: header lower, text centred and narrower), the default, and headers the person moved.
  const PLACES: Partial<Recipe>[] = [{}, { headerY: 0.19, textY: 0.5, textWidth: 0.8 }, { headerY: 0.05 }, { headerY: 0.3 }, { headerY: 0.5 },
    { headerY: 0.85 }, { headerY: 0.19, textY: 0.2 }, { textY: 0.1 }, { headerX: 0.2, headerY: 0.4 }];

  it("long ayahs (in parts or whole), every format, the header anywhere: no overlap, inside the frame", () => {
    for (const ref of ["8:26", "2:282", "33:35"] as Ref[]) for (const [name, orientation, size] of FORMATS) {
      for (const place of PLACES) for (const splitLong of [true, false]) {
        const { plan } = draw(ref, { size, recipe: { orientation, splitLong, ...place } });
        const b = plan.box, h = plan.header!.rect, at = `${ref} ${name} ${JSON.stringify(place)} split ${splitLong}`;
        const apart = b.x + b.w <= h.x || h.x + h.w <= b.x || b.y + b.h <= h.y || h.y + h.h <= b.y;
        expect(apart, at).toBe(true);
        expect(b.y, at).toBeGreaterThanOrEqual(plan.area.top - 0.01);
        expect(b.y + b.h, at).toBeLessThanOrEqual(plan.area.bottom + 0.01);
      }
    }
  }, 30_000); // a few hundred layouts

  it("8:26 in a reel: the box starts a gap below the header", () => {
    const { plan } = draw("8:26", { size: [720, 1280], recipe: { headerY: 0.19, textY: 0.5, textWidth: 0.8 } });
    const h = plan.header!.rect;
    expect(plan.box.y).toBeGreaterThanOrEqual(h.y + h.h + 12 * (720 / 1080) - 0.01);
  });
});

describe("Reels and stories keep the text above their own details (Scene.inset); exports are unchanged", () => {
  const reel: [number, number] = [1080, 1920];
  const plain = { splitLong: false } as Partial<Recipe>;
  const bottom = (l: ReturnType<typeof draw>) => l.plan.box.y + l.plan.box.h;

  it("a long ayah on a reel ends above the details at the bottom (it shrinks or moves up)", () => {
    const inset = 0.21;
    for (const ref of ["2:255", "2:282"] as Ref[]) {
      const l = draw(ref, { size: reel, recipe: plain, inset });
      expect(bottom(l)).toBeLessThanOrEqual(reel[1] * (1 - inset) + 0.5);
      expect(l.plan.box.y).toBeGreaterThanOrEqual(0);
      const without = draw(ref, { size: reel, recipe: plain });
      expect(bottom(without)).toBeGreaterThan(reel[1] * (1 - inset)); // without the inset it would run under the details
    }
  });

  it("the export (no inset) is exactly what it was; a zero inset changes nothing either", () => {
    for (const ref of ["2:153", "2:255"] as Ref[]) {
      drawn = [];
      const a = draw(ref, { size: reel });
      const linesA = drawn.map((d) => `${d.font}|${d.text}`);
      drawn = [];
      const b = draw(ref, { size: reel, inset: 0 });
      expect(b.plan.box).toEqual(a.plan.box);
      expect(drawn.map((d) => `${d.font}|${d.text}`)).toEqual(linesA);
    }
  });
});

describe("translation lines are placed by their measured width, not the canvas's textAlign (Safari on iPhone)", () => {
  // On iOS 26 Safari the Malayalam lines started at the box's centre (textAlign "center" applied no offset), so each
  // translation line is drawn left-aligned at centre - width / 2, its width measured on the context that draws it.
  const lines = (l: ReturnType<typeof draw>, kind: "ar" | "tr") => drawn.flatMap((d) => {
    const k = l.parts.indexOf(d.canvas);
    if (k < 0 || l.plan.parts[k].kind !== kind || d.canvas.width <= 1) return [];
    return [{ ...d, centre: l.plan.box.x + l.plan.box.w / 2 - l.plan.parts[k].x }];
  });

  for (const [lang, tr, dir] of [["ml", "അതായത് വിശ്വസിക്കുകയും അല്ലാഹുവെ പറ്റിയുള്ള ഓർമ കൊണ്ട് മനസ്സുകൾ ശാന്തമായിത്തീരുകയും ചെയ്യുന്നവരെ", "ltr"],
    ["ta", "அதாவது நம்பிக்கை கொண்டவர்கள் அல்லாஹ்வை நினைவு கூர்வதால் அவர்களுடைய இதயங்கள் அமைதி பெறுகின்றன", "ltr"],
    ["ur", "یعنی وہ لوگ جو ایمان لائے اور جن کے دل اللہ کی یاد سے اطمینان پاتے ہیں", "rtl"]] as const) {
    it(`${lang}: every line left-aligned, centred in the box by its width, with a generic fallback font`, () => {
      const l = draw("2:153", { tr, lang });
      const got = lines(l, "tr");
      expect(got.length).toBeGreaterThan(1);
      for (const d of got) {
        expect(d.align).toBe("left");
        expect(d.dir).toBe(dir);
        expect(d.font).toMatch(/", sans-serif$/);
        expect(d.x + widthIn(d.font, d.text) / 2).toBeCloseTo(d.centre, 6);
      }
    });
  }

  it("a drawing context that measures 0 falls back to the layout's measure (still centred)", () => {
    zeroOnLayers = true;
    const l = draw("2:153", { tr: "അതായത് വിശ്വസിക്കുകയും അല്ലാഹുവെ പറ്റിയുള്ള ഓർമ കൊണ്ട് മനസ്സുകൾ", lang: "ml" });
    for (const d of lines(l, "tr")) expect(d.x + widthIn(d.font, d.text) / 2).toBeCloseTo(d.centre, 6);
  });

  it("the Arabic is drawn as before: textAlign centre at the box's centre, in the Quran font alone", () => {
    const l = draw("2:153", { lang: "ml", tr: "അതായത്" });
    const ar = lines(l, "ar");
    expect(ar.length).toBeGreaterThan(0);
    for (const d of ar) {
      expect(d.align).toBe("center");
      expect(d.x).toBeCloseTo(d.centre, 6);
      expect(d.font).toMatch(/px "Amiri Quran"$/);
    }
  });
});
