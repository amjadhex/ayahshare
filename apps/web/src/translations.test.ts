// The translations data (public/data/translations.json, pipeline/translations.py) against the app's languages, and the
// picker's search: any script, case and accents ignored. Edition names here are the data's own; no translation text.
import { describe, expect, it } from "vitest";
import data from "../public/data/translations.json";
import { RTL } from "./config";
import type { Edition } from "./design";
import { LANGUAGES, translationFor } from "./lang";
import { VOICES } from "../../../contracts/voices";
import { byLanguage, canonicalEdition, dedupeEditions, editionOf, fold, languageName, matches, queryWords, search, shortTranslationName } from "./translations";

const editions = data.editions as Edition[];
const record = Object.fromEntries(editions.map((e) => [e.identifier, e]));

describe("data/translations.json", () => {
  it("lists every translation once, with ids the recipe accepts, in languages the app names", () => {
    expect(editions.length).toBeGreaterThan(117); // the Quran API's translations, and the Quran Foundation's others
    expect(new Set(editions.map((e) => e.identifier)).size).toBe(editions.length);
    for (const e of editions) {
      expect(e.identifier).toMatch(/^[a-z]{2,3}\.[\w-]{1,40}$/);
      expect(e.englishName.trim()).toBeTruthy();
      expect(LANGUAGES.some((l) => l.code === e.language), e.identifier).toBe(true);
    }
    const qf = editions.filter((e) => /\.qf-\d+$/.test(e.identifier));
    expect(qf.length).toBeGreaterThan(0);
    for (const e of qf) expect(e.identifier.startsWith(`${e.language}.qf-`)).toBe(true);
  });

  it("every language's default translation is in it, in that language; the curated defaults are kept", () => {
    for (const l of LANGUAGES) {
      if (l.translation === "none") continue;
      expect(record[l.translation]?.language, `${l.code} → ${l.translation}`).toBe(l.code);
    }
    // Every language has translations, except Arabic (its default is the Arabic alone).
    expect(new Set(editions.map((e) => e.language))).toEqual(new Set(LANGUAGES.filter((l) => l.translation !== "none").map((l) => l.code)));
    for (const [code, id] of [["en", "en.sahih"], ["ur", "ur.jalandhry"], ["ml", "ml.abdulhameed"], ["tr", "tr.diyanet"], ["id", "id.indonesian"]]) {
      expect(translationFor(code)).toBe(id);
    }
  });

  it("names each language in its own script and in English; right-to-left ones are marked", () => {
    expect(languageName("ml")).toEqual({ code: "ml", native: "മലയാളം", english: "Malayalam", rtl: false });
    expect(languageName("ur")).toMatchObject({ native: "اردو", rtl: true });
    expect(languageName("prs")).toMatchObject({ english: "Dari", rtl: true });
    for (const l of LANGUAGES) expect(l.native.trim() && l.english.trim(), l.code).toBeTruthy();
    expect(RTL.has("bm")).toBe(true); // Bambara's translations are in N'Ko
  });
});

describe("search", () => {
  it("folds case, accents and punctuation in any script", () => {
    expect(fold("FRANÇAIS")).toBe(fold("francais"));
    expect(fold("Al-Hilali")).toBe(fold("al hilali"));
    expect(fold("Türkçe")).toBe("turkce");
    expect(fold("Oʻzbekcha")).toBe("ozbekcha");
    expect(fold("مَوْدُودِی")).toBe(fold("مودودی")); // Arabic vowel marks
    expect(matches(queryWords("urdu  maududi"), ["Abul Ala Maududi", "Urdu"])).toBe(true);
    expect(matches(queryWords("urdu hilali"), ["Abul Ala Maududi", "Urdu"])).toBe(false);
  });

  it("finds languages and translations by translator, edition name or language, any script", () => {
    const groups = byLanguage(record, translationFor);
    const ids = (q: string) => search(groups, q).translations.flatMap((g) => g.editions.map((e) => e.identifier));
    const langs = (q: string) => search(groups, q).languages.map((g) => g.code);
    expect(ids("karakunnu")).toContain("ml.karakunnu");
    expect(ids("SAHEEH")).toContain("en.sahih");
    expect(langs("മലയാളം")).toEqual(["ml"]);
    const malayalam = ids("മലയാളം");
    expect(new Set(malayalam)).toEqual(new Set(editions.filter((e) => e.language === "ml").map((e) => e.identifier)));
    expect(malayalam[0]).toBe("ml.abdulhameed"); // the default first
    expect(langs("اردو")).toEqual(["ur"]);
    expect(langs("francais")).toEqual(["fr"]);
    expect(langs("tieng viet")).toEqual(["vi"]);
    expect(search(groups, "  ").translations).toEqual([]);
    expect(search(groups, "zzzz")).toEqual({ languages: [], translations: [] });
  });

  it("groups by language with the language's default first", () => {
    const groups = byLanguage(record, translationFor);
    expect(groups.find((g) => g.code === "en")!.editions[0].identifier).toBe("en.sahih");
    expect(groups.find((g) => g.code === "ur")!.editions[0].identifier).toBe("ur.jalandhry");
    expect(groups.map((g) => g.english)).toEqual([...groups.map((g) => g.english)].sort((a, b) => a.localeCompare(b)));
  });
});

const own: Edition = { identifier: "ml.lalithasaram", language: "ml", englishName: "ഖുര്‍ആന്‍ ലളിതസാരം (Karakunnu & Elayavoor)", name: "ഖുര്‍ആന്‍ ലളിതസാരം" };
const voiced = new Set(VOICES.map((v) => v.text));

describe("shortTranslationName", () => {
  const short = (id: string) => shortTranslationName(id === own.identifier ? own : record[id]);
  it("shortens the long names the pickers used to show", () => {
    expect(short("ml.abdulhameed")).toBe("Abdul Hameed & Parappoor");
    expect(short("ml.lalithasaram")).toBe("Karakunnu & Elayavoor");
    expect(short("en.hilali")).toBe("Hilali & Khan"); // the edition's own short name
    expect(short("en.qaribullah")).toBe("Qaribullah & Darwish");
    expect(short("hi.hindi")).toBe("Farooq Khan & Nadwi");
    expect(short("de.aburida")).toBe("Abu Rida");
    expect(short("ba.mehanovic")).toBe("Muhamed Mehanovic"); // "Quran translation by" dropped
    expect(short("ur.qf-158")).toBe("Bayan-ul-Quran"); // a long note in brackets dropped
    expect(short("yo.qf-125")).toBe("Abu Rahimah Mikael Aykyuni"); // a title dropped
  });
  it("keeps names that are short, and a short note that tells two editions apart", () => {
    expect(short("en.sahih")).toBe(record["en.sahih"].englishName);
    expect(short("uz.qf-55")).toBe("Sodiq Muhammad Yusuf (Latin)");
    expect(short("uz.sodik")).not.toBe(short("uz.qf-55"));
  });
  it("no name in the list is long, except one person's or an organisation's own long name", () => {
    for (const e of editions) expect(shortTranslationName(e).length, e.identifier).toBeLessThanOrEqual(40);
    for (const e of editions) expect(shortTranslationName(e), e.identifier).not.toMatch(/\band\b.*\band\b/);
  });
});

describe("dedupeEditions", () => {
  const all = [...editions, own];
  const kept = dedupeEditions(all, voiced).map((e) => e.identifier);
  it("hides the second of each duplicate pair: the voiced one stays, else the one that is not the Foundation's copy", () => {
    for (const hidden of ["ml.karakunnu", "az.qf-75", "it.qf-153", "sq.qf-88", "uz.qf-127", "zh.majian"]) expect(kept, hidden).not.toContain(hidden);
    for (const stays of ["ml.lalithasaram", "az.musayev", "it.piccardo", "sq.nahi", "uz.sodik", "zh.jian"]) expect(kept, stays).toContain(stays);
    expect(kept).toHaveLength(all.length - 6);
  });
  it("prefers the voiced edition even when it comes second, and a non-Foundation id otherwise", () => {
    const a: Edition = { identifier: "xx.qf-1", language: "xx", englishName: "Same Name", name: "a" };
    const b: Edition = { identifier: "xx.plain", language: "xx", englishName: "same  name", name: "b" };
    expect(dedupeEditions([a, b]).map((e) => e.identifier)).toEqual(["xx.plain"]);
    expect(dedupeEditions([b, a], new Set(["xx.qf-1"])).map((e) => e.identifier)).toEqual(["xx.qf-1"]);
    expect(dedupeEditions([a, { ...b, language: "yy" }])).toHaveLength(2); // another language: not a duplicate
  });
  it("an alias is hidden only when its twin is in the list; hidden ids still resolve to the twin's name", () => {
    expect(dedupeEditions(editions, voiced).map((e) => e.identifier)).toContain("ml.karakunnu");
    const list = dedupeEditions(all, voiced);
    const rec = Object.fromEntries(list.map((e) => [e.identifier, e]));
    expect(canonicalEdition("ml.karakunnu")).toBe("ml.lalithasaram");
    expect(canonicalEdition("zh.majian")).toBe("zh.jian");
    expect(canonicalEdition("en.sahih")).toBe("en.sahih");
    expect(editionOf(rec, "az.qf-75")?.identifier).toBe("az.musayev");
    expect(editionOf(rec, "nope.x")).toBeUndefined();
  });
});
