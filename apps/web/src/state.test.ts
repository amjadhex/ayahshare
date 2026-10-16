import { describe, expect, it } from "vitest";
import type { Surah } from "../../../contracts/types";
import surahList from "../public/data/surahs.json";
import { DEFAULT_RECIPE, sanitizeRecipe } from "./config";
import { EDITS_MAX, initialState, reducer, type AppState } from "./state";

const surahs = surahList as Surah[];
const ready = (): AppState => reducer(initialState(), { type: "booted", config: null, surahs, recipe: null });

describe("recipe updates (reducer)", () => {
  it("select clamps to the surah and to 20 ayahs (an ayah group; people pick up to 3), and lets suggestions pick the background again", () => {
    let s = reducer(ready(), { type: "bg", bg: { type: "colour", colour: "#000000" }, manual: true });
    s = reducer(s, { type: "select", surah: 2, from: 255, to: 280 });
    expect([s.recipe.surah, s.recipe.from, s.recipe.to]).toEqual([2, 255, 274]);
    expect(s.bgManual).toBe(false);
    s = reducer(s, { type: "select", surah: 1, from: 7, to: 9 }); // Al-Fatiha has 7 ayahs
    expect([s.recipe.from, s.recipe.to]).toEqual([7, 7]);
    expect(reducer(s, { type: "select", surah: 200, from: 1, to: 1 })).toBe(s); // unknown surah: ignored
  });

  it("patch changes settings and keeps the range valid", () => {
    let s = reducer(ready(), { type: "select", surah: 94, from: 5, to: 5 });
    s = reducer(s, { type: "patch", patch: { to: 6, textColor: "#e3b25e", quranSize: 6 } });
    expect(s.recipe).toMatchObject({ surah: 94, from: 5, to: 6, textColor: "#e3b25e", quranSize: 6 });
    s = reducer(s, { type: "patch", patch: { to: 9 } });
    expect(s.recipe.to).toBe(8); // Ash-Sharh has 8 ayahs
    s = reducer(reducer(s, { type: "select", surah: 1, from: 6, to: 6 }), { type: "patch", patch: { to: 8 } });
    expect([s.recipe.from, s.recipe.to]).toEqual([6, 7]); // and never past the surah's end
  });

  it("a shared or saved design keeps its background; resetStyle restores only the style", () => {
    const shared = { ...DEFAULT_RECIPE, surah: 2, from: 153, to: 153, bg: { type: "clip" as const, id: "pb1" }, textColor: "#000000" };
    let s = reducer(initialState(), { type: "booted", config: null, surahs, recipe: shared });
    expect(s.bgManual).toBe(true);
    s = reducer(s, { type: "resetStyle" });
    expect(s.recipe.textColor).toBe(DEFAULT_RECIPE.textColor);
    expect(s.recipe.bg).toEqual({ type: "clip", id: "pb1" });
  });

  it("new text goes back to the first ayah and stops the recitation", () => {
    let s = reducer(ready(), { type: "ayahs", ayahs: [{ num: 1, ar: "a", tr: "b" }, { num: 2, ar: "c", tr: "d" }] });
    s = reducer(reducer(s, { type: "goTo", index: 5 }), { type: "play", on: true });
    expect([s.current, s.playing]).toEqual([1, true]);
    s = reducer(s, { type: "ayahs", ayahs: [{ num: 3, ar: "e", tr: "f" }] });
    expect([s.current, s.playing, s.loading]).toEqual([0, false, false]);
  });

  it("the part of a long ayah on screen: set with the ayah, back to the first with another ayah or new text", () => {
    let s = reducer(ready(), { type: "ayahs", ayahs: [{ num: 1, ar: "a", tr: "b" }, { num: 2, ar: "c", tr: "d" }] });
    s = reducer(s, { type: "goTo", index: 1, section: 2 });
    expect([s.current, s.section]).toEqual([1, 2]);
    expect(reducer(s, { type: "goTo", index: 0 }).section).toBe(0);
    expect(reducer(s, { type: "ayahs", ayahs: [{ num: 3, ar: "e", tr: "f" }] }).section).toBe(0);
  });

  it("favourites toggle and clear on sign-out", () => {
    let s = reducer(ready(), { type: "me", me: { id: "u", name: "A", email: "a@b.c", avatar: null } });
    s = reducer(s, { type: "favourite", ref: "2:153", on: true });
    expect(s.favourites).toEqual(["2:153"]);
    expect(reducer(s, { type: "favourite", ref: "2:153", on: true })).toBe(s);
    expect(reducer(s, { type: "me", me: null }).favourites).toEqual([]);
  });
});

describe("sanitizeRecipe", () => {
  it("clamps older 50-ayah links to 20 ayahs and fills the newer fields", () => {
    const old: Record<string, unknown> = { ...DEFAULT_RECIPE, from: 1, to: 40 };
    for (const k of ["effect", "showSurah", "showTranslation", "showRef", "animation", "textX", "textY", "textWidth", "headerX", "headerY", "autoContrast", "splitLong"]) delete old[k];
    const r = sanitizeRecipe(old);
    expect(r.to).toBe(20);
    expect(r).toMatchObject({
      effect: "solid", showSurah: true, showTranslation: true, showRef: true, animation: "none", textX: 0.5, textY: 0.54, textWidth: 0,
      headerX: 0.5, headerY: 0.11, autoContrast: true, splitLong: true,
    });
  });
  it("keeps valid newer fields and drops invalid ones", () => {
    const r = sanitizeRecipe({ ...DEFAULT_RECIPE, effect: "glass", showRef: false, animation: "zoom", textX: 0.25, textWidth: 0.2, headerX: 0.3, headerY: 1.4, autoContrast: false });
    expect(r).toMatchObject({ effect: "glass", showRef: false, animation: "zoom", textX: 0.25, textWidth: 0, headerX: 0.3, headerY: 0.11, autoContrast: false });
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, effect: "neon" }).effect).toBe("solid");
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, animation: "spin", autoContrast: "yes" })).toMatchObject({ animation: "none", autoContrast: true });
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, splitLong: false }).splitLong).toBe(false);
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, splitLong: "no" }).splitLong).toBe(true);
    for (const a of ["none", "fade", "rise", "zoom"]) expect(sanitizeRecipe({ ...DEFAULT_RECIPE, animation: a }).animation).toBe(a);
  });
  it("an old link or saved design with the removed typewriter animation opens with fade", () => {
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, animation: "typewriter" }).animation).toBe("fade");
  });
});

describe("the editor's undo and redo (edits)", () => {
  const at94 = () => reducer(ready(), { type: "select", surah: 94, from: 5, to: 5 });

  it("every change of the design is a step; undo and redo walk them; a new change clears redo", () => {
    let s = reducer(at94(), { type: "patch", patch: { textColor: "#e3b25e" } });
    s = reducer(s, { type: "bg", bg: { type: "colour", colour: "#152238" }, manual: true });
    s = reducer(s, { type: "resetStyle" });
    expect(s.edits.past).toHaveLength(3);
    s = reducer(reducer(s, { type: "undo" }), { type: "undo" });
    expect(s.recipe).toMatchObject({ textColor: "#e3b25e", bg: { type: "colour", colour: DEFAULT_RECIPE.bg.type === "colour" ? DEFAULT_RECIPE.bg.colour : "" } });
    expect(s.edits.future).toHaveLength(2);
    s = reducer(s, { type: "redo" });
    expect(s.recipe.bg).toEqual({ type: "colour", colour: "#152238" });
    s = reducer(s, { type: "patch", patch: { quranSize: 6 } });
    expect(s.edits.future).toHaveLength(0);
    expect(reducer(reducer(at94(), { type: "undo" }), { type: "redo" }).edits.past).toHaveLength(0); // nothing to undo
  });

  it("a burst of the same change is one step; a suggestion filling in the background, or the same value again, is none", () => {
    let s = at94();
    for (const c of ["#111111", "#222222", "#333333"]) s = reducer(s, { type: "patch", patch: { textColor: c } });
    expect(s.edits.past).toHaveLength(1);
    s = reducer(s, { type: "patch", patch: { quranSize: 5 } });
    expect(s.edits.past).toHaveLength(2);
    expect(reducer(s, { type: "patch", patch: { quranSize: 5 } })).toBe(s);
    s = reducer(s, { type: "bg", bg: { type: "clip", id: "pb1" }, manual: false });
    expect(s.edits.past).toHaveLength(2);
    expect(reducer(s, { type: "undo" }).recipe).toMatchObject({ textColor: "#333333", quranSize: 4 });
  });

  it("keeps at most 50 steps, and starts again with a new design", () => {
    let s = at94();
    for (let i = 0; i < 60; i++) s = reducer(s, { type: "range", from: 5, to: 5 + (i % 3) });
    expect(s.edits.past.length).toBe(EDITS_MAX);
    s = reducer(s, { type: "select", surah: 2, from: 255, to: 255 });
    expect(s.edits).toMatchObject({ past: [], future: [] });
  });

  it("range: an ayah added or removed at either end keeps the background (suggestions do not replace it) and the surah's end", () => {
    let s = reducer(at94(), { type: "range", from: 4, to: 5 });
    expect(s.recipe).toMatchObject({ from: 4, to: 5 });
    expect(s.bgManual).toBe(true);
    s = reducer(s, { type: "range", from: 4, to: 9 });
    expect(s.recipe.to).toBe(8);
    expect(reducer(s, { type: "undo" }).recipe).toMatchObject({ from: 4, to: 5 });
  });

  it("format: video or image; an image stops the recitation", () => {
    let s = reducer(at94(), { type: "play", on: true });
    s = reducer(s, { type: "format", format: "image" });
    expect(s).toMatchObject({ format: "image", playing: false });
  });
});
