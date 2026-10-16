// Typed references on Results (referenceHits) and the topic matches behind Home's suggestions (matchChips).
import { describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../contracts/types";
import surahList from "../public/data/surahs.json";
import { hitKey, hitOf, parseRef, referenceHits, surahPage } from "./search";
import { matchChips } from "./topics";

vi.mock("./api", () => ({
  search: vi.fn(),
  searchClips: async () => [],
  loadCatalogue: async () => {},
  allClips: () => [],
  clipById: () => null,
  getSurahBackgrounds: async () => null,
  getAyahFromSurah: vi.fn(async (surah: number, ayah: number, edition: string) => (ayah === 3 ? "" : `${edition} ${surah}:${ayah}`)),
}));

const surahs = surahList as Surah[];
const range = (q: string) => parseRef(q)!;

describe("referenceHits", () => {
  it("is one hit for an ayah, with its English text", async () => {
    expect(await referenceHits(range("2:255"), surahs)).toEqual([{ ref: "2:255", to: 255, text: "en.sahih 2:255" }]);
  });

  it("keeps a range of up to 3 ayahs in one hit and splits longer ones into runs of 3", async () => {
    expect((await referenceHits(range("94:5-6"), surahs)).map(hitKey)).toEqual(["94:5-6"]);
    expect((await referenceHits(range("2:1-7"), surahs)).map(hitKey)).toEqual(["2:1-3", "2:4-6", "2:7-7"]);
    // A run joins its ayahs' text and skips one that has none.
    expect((await referenceHits(range("2:1-3"), surahs))[0].text).toBe("en.sahih 2:1 en.sahih 2:2");
  });

  it("stops at the end of the surah and at the most tiles asked for", async () => {
    expect((await referenceHits(range("1:6-40"), surahs)).map(hitKey)).toEqual(["1:6-7"]);
    expect(await referenceHits(range("2:1-200"), surahs, 4)).toHaveLength(4);
  });

  it("finds nothing for a surah or ayah that does not exist", async () => {
    expect(await referenceHits(range("115:1"), surahs)).toEqual([]);
    expect(await referenceHits(range("1:8"), surahs)).toEqual([]);
    expect(await referenceHits(range("2:0"), surahs)).toEqual([]);
    expect(await referenceHits(range("2:255"), [])).toEqual([]);
  });

  it("a backwards range shows its first ayah", async () => {
    expect((await referenceHits(range("2:10-5"), surahs)).map(hitKey)).toEqual(["2:10-10"]);
  });
});

describe("surahPage", () => {
  it("is the whole surah from its first ayah, one ayah a tile, 10 tiles a page, then the next page", async () => {
    const one = await surahPage(18, surahs);
    expect(one.results.map((h) => h.ref)).toEqual(Array.from({ length: 10 }, (_, i) => `18:${i + 1}`));
    expect(one.next).toBe(2);
    expect(one.results[0].text).toBe("en.sahih 18:1");
    let page: number | null = 1, last = 0;
    const seen: string[] = [];
    while (page !== null) {
      const p: Awaited<ReturnType<typeof surahPage>> = await surahPage(18, surahs, page);
      for (const h of p.results) { expect(+h.ref.split(":")[1]).toBe(last + 1); last = h.to; seen.push(h.ref); }
      page = p.next;
    }
    expect(last).toBe(110); // every ayah of Al-Kahf, none twice
  });

  it("a short surah is one page; a surah that does not exist shows nothing", async () => {
    expect(await surahPage(108, surahs)).toMatchObject({ results: [{ ref: "108:1" }, { ref: "108:2" }, { ref: "108:3" }], next: null });
    expect(await surahPage(115, surahs)).toEqual({ results: [], next: null });
  });
});

describe("hitOf", () => {
  it("makes a one-ayah hit from a search answer", () => {
    expect(hitOf({ ref: "94:5", text: "x" })).toEqual({ ref: "94:5", to: 5, text: "x" });
  });
});

describe("matchChips", () => {
  it("matches topic names by their start or any word, best first", () => {
    const labels = matchChips("patien", "en", 5).map((c) => c.label);
    expect(labels).toContain("Patience");
    expect(matchChips("hardship", "en").map((c) => c.id)).toContain("hope");
    expect(matchChips("", "en")).toEqual([]);
    expect(matchChips("zzzzq", "en")).toEqual([]);
  });

  it("matches in the chip's language and by its English name too", () => {
    const ml = matchChips("patience", "ml").map((c) => c.label);
    expect(ml.length).toBeGreaterThan(0);
    expect(matchChips("ക്ഷമ", "ml").map((c) => c.id)).toContain("patience");
    expect(matchChips("kahf", "en")[0].ref).toBe("18:1-10");
  });
});
