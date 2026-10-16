import { afterEach, expect, it, vi } from "vitest";
import { getAyahText, getEditions } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("loads ayah text as whole surahs per edition: the Arabic is shared by translations, the next ayah needs no request", async () => {
  const urls: string[] = [];
  let failNext = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (failNext) { failNext = false; return new Response("busy", { status: 503 }); }
    const edition = url.split("/").pop();
    const ayahs = Array.from({ length: 8 }, (_, i) => ({ numberInSurah: i + 1, text: `${edition} ${i + 1}` }));
    return Response.json({ data: { ayahs } });
  }));

  const [ar, tr] = await getAyahText(94, 5, 6, "en.sahih");
  expect(ar.ayahs.map((a) => a.text)).toEqual(["quran-uthmani 5", "quran-uthmani 6"]);
  expect(tr.ayahs.map((a) => a.numberInSurah)).toEqual([5, 6]);
  expect(urls).toEqual(["/qapi/surah/94/quran-uthmani", "/qapi/surah/94/en.sahih"]);

  await getAyahText(94, 7, 7, "en.sahih"); // next ayah: already here
  const [, ml] = await getAyahText(94, 1, 1, "ml.abdulhameed"); // another translation: only that edition
  expect(ml.ayahs).toEqual([{ numberInSurah: 1, text: "ml.abdulhameed 1" }]);
  expect(await getAyahText(94, 8, 8, "none")).toHaveLength(1);
  expect(urls).toHaveLength(3);

  failNext = true; // a failed request is not remembered
  await expect(getAyahText(1, 1, 1, "none")).rejects.toThrow();
  expect((await getAyahText(1, 1, 1, "none"))[0].ayahs[0].text).toBe("quran-uthmani 1");
});

it("loads the translations from data/translations.json (with our own), else the Quran API's list", async () => {
  const urls: string[] = [];
  let dataFile = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (url === "/data/translations.json") {
      return dataFile ? Response.json({ editions: [{ identifier: "ta.qf-133", language: "ta", englishName: "Abdul Hameed Baqavi", name: "Abdul Hameed Baqavi" }] })
        : new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }); // the static host's fallback page
    }
    return Response.json({ data: [{ identifier: "en.sahih", language: "en", englishName: "Saheeh International", name: "Saheeh International" }] });
  }));
  expect((await getEditions()).map((e) => e.identifier)).toEqual(["ta.qf-133", "ml.lalithasaram"]);
  expect(urls).toEqual(["/data/translations.json"]);
  dataFile = false;
  expect((await getEditions()).map((e) => e.identifier)).toEqual(["en.sahih", "ml.lalithasaram"]);
  expect(urls.at(-1)).toBe("/qapi/edition?format=text&type=translation");
});

it("a Quran Foundation translation loads through the same text path (the Worker serves it in the Quran API's shape)", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    return Response.json({ data: { ayahs: [1, 2, 3, 4].map((n) => ({ numberInSurah: n, text: `${url.split("/").pop()} ${n}` })) } });
  }));
  const [, tr] = await getAyahText(112, 2, 3, "ta.qf-133");
  expect(tr.ayahs.map((a) => a.text)).toEqual(["ta.qf-133 2", "ta.qf-133 3"]);
  expect(urls).toContain("/qapi/surah/112/ta.qf-133");
});

it("the translations list hides the second of two identical translations (ids stay loadable)", async () => {
  const e = (identifier: string, englishName: string) => ({ identifier, language: identifier.split(".")[0], englishName, name: englishName });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/data/translations.json") {
      return Response.json({ editions: [
        e("ml.karakunnu", "Karakunnu & Elayavoor"), e("zh.majian", "Ma Jian"), e("zh.jian", "Ma Jian"),
        e("uz.qf-127", "Muhammad Sodik Muhammad Yusuf"), e("uz.sodik", "Muhammad Sodik Muhammad Yusuf"), e("en.sahih", "Saheeh International"),
      ] });
    }
    return Response.json({ data: { ayahs: [{ numberInSurah: 1, text: `${url.split("/").pop()} 1` }] } });
  }));
  expect((await getEditions()).map((x) => x.identifier)).toEqual(["zh.jian", "uz.sodik", "en.sahih", "ml.lalithasaram"]);
  // A design that still uses a hidden id loads its text.
  const [, tr] = await getAyahText(1, 1, 1, "ml.karakunnu");
  expect(tr.ayahs[0].text).toBe("ml.karakunnu 1");
});
