import { describe, expect, it } from "vitest";
import { sectionAt, sectionWindow, type Timing } from "./compose";
import { clauseCuts, letters, pauseCuts, splitArabic, splitAyah, splitTranslation, TRANSLATION_TOLERANCE } from "./split";
// The app's own text (quran-uthmani, en.sahih, hi.hindi), fetched from its API; never typed by hand.
import fixture from "./test/long-ayahs.json";

const A = fixture.ayahs;
/** The pause marks split.ts may cut after, and the ones it must never cut at. */
const CUT_MARKS = /[ۖۗۘۚ]$/;
const LONG = ["2:255", "2:282", "24:31", "73:20"] as const;

describe("the Arabic is cut only at pause marks, and every character is kept", () => {
  it("finds the pause marks of 2:255, each cut starting right after one", () => {
    const ar = A["2:255"].ar, cuts = pauseCuts(ar);
    expect(cuts.length).toBe((ar.match(/[ۖۗۘۚ]/g) ?? []).length); // none of them ends the ayah
    expect(cuts.length).toBeGreaterThan(4);
    for (const c of cuts) expect(ar.slice(0, c).trimEnd()).toMatch(CUT_MARKS);
  });

  it("never cuts at ۙ (do not stop) or ۛ (a pair: stop at one only)", () => {
    expect(pauseCuts(A["2:2"].ar)).toEqual([]); // 2:2 has only the ۛ pair
    const ar = A["73:20"].ar;
    expect(ar).toContain("ۙ");
    for (const c of pauseCuts(ar)) expect(ar.slice(0, c).trimEnd()).not.toMatch(/[ۙۛۜ]$/);
  });

  it("parts are contiguous and together are the whole ayah, character for character", () => {
    for (const ref of LONG) {
      const ar = A[ref].ar;
      for (let n = 2; n <= 8; n++) {
        const s = splitArabic(ar, n);
        if (!s) continue;
        expect(s.parts).toHaveLength(n);
        expect(s.parts.join(" ")).toBe(ar); // only the single space at each cut is not drawn
        expect(s.parts.map((p) => p.length).reduce((a, b) => a + b) + n - 1).toBe(ar.length);
        s.parts.slice(0, -1).forEach((p) => expect(p).toMatch(CUT_MARKS));
        expect(s.starts[0]).toBe(0);
        expect(s.starts).toEqual([...s.starts].sort((a, b) => a - b));
      }
    }
  });

  it("chooses the most even cuts among the marks (checked against every combination)", () => {
    const ar = A["2:282"].ar, total = letters(ar);
    const at = pauseCuts(ar).map((c) => letters(ar.slice(0, c)));
    for (const n of [2, 3, 4]) {
      const targets = Array.from({ length: n - 1 }, (_, j) => ((j + 1) * total) / n);
      let best = Infinity;
      const walk = (from: number, picked: number[]) => {
        if (picked.length === n - 1) { best = Math.min(best, picked.reduce((s, p, j) => s + (p - targets[j]) ** 2, 0)); return; }
        for (let i = from; i < at.length; i++) walk(i + 1, [...picked, at[i]]);
      };
      walk(0, []);
      const got = splitArabic(ar, n)!.starts.slice(1).map((f) => f * total);
      expect(got.reduce((s, p, j) => s + (p - targets[j]) ** 2, 0)).toBeCloseTo(best, 6);
    }
    // 2:255 in two: close to halves.
    const two = splitArabic(A["2:255"].ar, 2)!;
    expect(Math.abs(two.starts[1] - 0.5)).toBeLessThan(0.1);
  });

  it("an ayah without pause marks stays whole", () => {
    expect(pauseCuts(A["33:35"].ar)).toEqual([]);
    expect(splitArabic(A["33:35"].ar, 2)).toBeNull();
    expect(splitAyah(A["33:35"].ar, A["33:35"].en, 2)).toBeNull();
    expect(splitArabic(A["2:255"].ar, 1)).toEqual({ parts: [A["2:255"].ar], starts: [0] });
    expect(splitArabic(A["2:255"].ar, 20)).toBeNull(); // more parts than marks allow
  });
});

describe("the translation follows the Arabic parts", () => {
  it("is cut at clause ends, proportionally to the Arabic, never mid-word, every character kept", () => {
    for (const ref of ["2:255", "2:282", "73:20"] as const) {
      const { ar, en } = A[ref];
      for (let n = 2; n <= 5; n++) {
        const s = splitAyah(ar, en, n);
        if (!s || !s.trSplit) continue;
        const parts = s.sections.map((p) => p.tr), total = letters(en);
        expect(parts.join(" ")).toBe(en);
        parts.slice(0, -1).forEach((p) => expect(p).toMatch(/[.,;:!?]["'”’)\]]*$/));
        let before = 0;
        parts.forEach((p, j) => {
          if (j) expect(Math.abs(before / total - s.starts[j])).toBeLessThanOrEqual(TRANSLATION_TOLERANCE);
          before += letters(p);
        });
      }
    }
    // 2:255 in two: the Arabic and English halves meet at the same sentence.
    const two = splitAyah(A["2:255"].ar, A["2:255"].en, 2)!;
    expect(two.trSplit).toBe(true);
    expect(two.sections[0].tr.endsWith("?")).toBe(true);
  });

  it("no sensible cut (no punctuation, or none close enough): every part shows the whole translation", () => {
    const { ar, hi } = A["2:255"];
    expect(clauseCuts(hi)).toEqual([]);
    const s = splitAyah(ar, hi, 2)!;
    expect(s.trSplit).toBe(false);
    expect(s.sections.map((p) => p.tr)).toEqual([hi, hi]);
    // 24:31: its marks are uneven (a quarter, then the rest) and the English has no clause end close enough to that.
    const w = splitAyah(A["24:31"].ar, A["24:31"].en, 2)!;
    expect(w.trSplit).toBe(false);
    expect(w.sections.every((p) => p.tr === A["24:31"].en)).toBe(true);
    expect(splitTranslation(A["24:31"].en, w.starts)).toBeNull();
  });

  it("no translation: only the Arabic is cut", () => {
    const s = splitAyah(A["2:255"].ar, "", 3)!;
    expect(s.trSplit).toBe(true);
    expect(s.sections.map((p) => p.tr)).toEqual(["", "", ""]);
  });

  it("clause ends: not inside brackets, not before a letter, with closing quotes kept, in scripts without spaces", () => {
    const text = "One [two, three] four, five. \"Six,\" seven";
    expect(clauseCuts(text).map((c) => text.slice(c, c + 4))).toEqual(["five", "\"Six", "seve"]);
    expect(clauseCuts("A 2:255 b, c")).toEqual([11]);
    const wide = "甲乙，丙丁。戊";
    expect(clauseCuts(wide).map((c) => wide[c])).toEqual(["丙", "戊"]);
  });
});

describe("timing: each part's share of the ayah's recitation follows its Arabic length", () => {
  const cut = splitAyah(A["2:255"].ar, A["2:255"].en, 3)!;
  const plan = { sections: [[0], cut.starts] };
  // Ayah 0: 0–6 s; ayah 1 (2:255, in three parts): 6–46 s; then a 1.5 s tail.
  const timing: Timing = { starts: [0, 6], durations: [6, 40], animation: "fade", end: 47.5 };

  it("part boundaries over the ayah's duration", () => {
    const lengths = cut.sections.map((p) => letters(p.ar)), total = lengths.reduce((a, b) => a + b);
    expect(sectionWindow(plan, timing, 1, 0)).toEqual([6, 6 + 40 * cut.starts[1]]);
    expect(sectionWindow(plan, timing, 1, 1)[0]).toBeCloseTo(6 + (40 * lengths[0]) / total, 6);
    expect(sectionWindow(plan, timing, 1, 2)[0]).toBeCloseTo(6 + (40 * (lengths[0] + lengths[1])) / total, 6);
    expect(sectionWindow(plan, timing, 1, 2)[1]).toBe(47.5); // the last part stays through the tail
    expect(sectionWindow(plan, timing, 0, 0)).toEqual([0, 6]); // a whole ayah: its own window
    const [, b1] = sectionWindow(plan, timing, 1, 1);
    expect([5.9, 6, b1 - 0.01, b1, 47].map((t) => sectionAt(plan, timing, 1, t))).toEqual([0, 0, 1, 2, 2]);
  });
});
