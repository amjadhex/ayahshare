// Thafheemul Quran (id "ml.thafheem", Malayalam's default tafsir) on GET /api/tafsir/:ref: read from our own storage
// (R2 tafsir/ml.thafheem/v2/<surah>.json), never from the Quran Foundation. A small made-up surah file stands in for the
// real one (fixtures/tafsir/ml.thafheem-2.json; the real surah 2 is 1.7 MB).
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/tafsir/ml.thafheem-2.json";
import { call, makeEnv, mockFetch } from "./helpers";

const put = (surah: number, body: unknown) => env.MEDIA.put(`tafsir/ml.thafheem/v2/${surah}.json`, JSON.stringify(body));
const get = async (path: string) => (await call(path, {}, makeEnv())).json<any>();
afterEach(() => vi.restoreAllMocks());

describe("GET /api/tafsir/:ref for Thafheemul Quran", () => {
  it("ayah by ayah (2:8): only the note pinned to 2:8, then the passage's unplaced notes under their own label", async () => {
    await put(2, fixture);
    const fetch = mockFetch(async () => Response.json({}, { status: 500 }));
    const res = await call("/api/tafsir/2:8?lang=ml", {}, makeEnv()); // no Quran Foundation credentials at all
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const body = await res.json<any>();
    expect(body).toMatchObject({
      ref: "2:8", lang: "ml", fallback: false, from: "2:8", to: "2:8",
      tafsir: { id: "ml.thafheem", name: "തഫ്ഹീമുല്‍ ഖുര്‍ആന്‍", author: "Sayyid Abul A'la Maududi" },
      options: [{ id: "ml.thafheem", name: "തഫ്ഹീമുല്‍ ഖുര്‍ആന്‍" }, { id: "ml.amani", name: "അമാനി തഫ്സീർ" }, { id: "ml.mukhtasar", name: "Al-Mukhtasar" }],
    });
    expect(body.html).toBe(
      '<p><strong>11.</strong> First note of the block, with &lt;script&gt;alert(1)&lt;/script&gt; &amp; an ampersand.</p>'
      + "<p>Its second paragraph.</p>"
      + "<h4>ഈ ഭാഗത്തെ മറ്റു കുറിപ്പുകൾ (2:8–20)</h4>"
      + '<p><strong>13.</strong> Third note, then a quoted passage:</p>'
      + '<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">ابجد هوز حطي كلمن</p></div>'
      + '<p><strong>14.</strong> Note for 2:8–20 as well.</p>');
    expect(body.html).not.toMatch(/<script|<strong>12\.|<strong>21\.|<strong>1\./); // escaped; other ayahs' notes left out
    expect(fetch).not.toHaveBeenCalled(); // nothing from the Quran Foundation
  });

  it("an ayah with a summary and its own note (2:9): summary, its note, then the passage's unplaced notes", async () => {
    await put(2, fixture);
    const body = await get("/api/tafsir/2:9?lang=ml");
    expect(body).toMatchObject({ from: "2:9", to: "2:9" });
    expect(body.html.startsWith("<p>Summary of the ninth ayah.</p><p>Its second paragraph.</p><p><strong>12.</strong> Second note")).toBe(true);
    expect(body.html.match(/<strong>/g)).toHaveLength(3); // 12, then 13 and 14
    expect((await get("/api/tafsir/2:23?lang=ml")).html).not.toContain("<strong>11.</strong>"); // outside the block
  });

  it("a pinned ayah in a one-ayah block (2:1 → only note 1); an ayah with only unplaced notes (2:10)", async () => {
    await put(2, fixture);
    expect((await get("/api/tafsir/2:1?lang=ml")).html).toBe("<p>Summary of the first ayah.</p><p><strong>1.</strong> Note one, alone for 2:1.</p>");
    const only = (await get("/api/tafsir/2:10?lang=ml")).html;
    expect(only.startsWith("<h4>ഈ ഭാഗത്തെ മറ്റു കുറിപ്പുകൾ (2:8–20)</h4><p><strong>13.</strong>")).toBe(true);
    expect(only).not.toMatch(/<strong>1[12]\./);
  });

  it("an ayah with nothing of its own in a passage whose notes explain other ayahs; only a summary; nothing at all", async () => {
    await put(2, fixture);
    expect((await get("/api/tafsir/2:22?lang=ml")).html).toBe(
      "<p><em>ഈ ആയത്തിന് പ്രത്യേക കുറിപ്പില്ല; 2:21–22 ഭാഗത്തിന്റെ കുറിപ്പുകൾ:</em></p><p><strong>21.</strong> (2:21) A note for the next block.</p>");
    expect((await get("/api/tafsir/2:30?lang=ml")).html).toBe("<p>Summary with no notes.</p>");
    const none = await get("/api/tafsir/2:200?lang=ml");
    expect(none).toMatchObject({ html: "", from: "2:200", to: "2:200", tafsir: { id: "ml.thafheem" } });
  });

  it("drops the glossary references glued to names (ഖസ്‌റജ്N327), keeping note numbers and Latin text", async () => {
    await put(2, { ayahs: [{ numberInSurah: 5, summary: "ഔസ്N255 ഗോത്രം" }], notes: [{ n: 7, text: "ഖസ്‌റജ്N327 ഗോത്രം, ഉമര്‍(റ)N1512 പറഞ്ഞു, AN12 ok", from: 5, to: 5, ayah: 5 }] });
    expect((await get("/api/tafsir/2:5?lang=ml")).html).toBe("<p>ഔസ് ഗോത്രം</p><p><strong>7.</strong> ഖസ്‌റജ് ഗോത്രം, ഉമര്‍(റ) പറഞ്ഞു, AN12 ok</p>");
  });

  it("an unknown or malformed id with lang=ml gets Thafheem too", async () => {
    await put(2, fixture);
    for (const id of ["&id=abc", "&id=", "&id=ml.other"]) {
      expect((await get(`/api/tafsir/2:1?lang=ml${id}`)).tafsir.id, id).toBe("ml.thafheem");
    }
  });

  it("the answer is cached by ayah (the content never changes); a missing surah file is a 404, not cached", async () => {
    await put(2, fixture);
    const first = await get("/api/tafsir/2:12?lang=ml");
    await put(2, { ...fixture, notes: [] });
    expect(await get("/api/tafsir/2:12?lang=ml")).toEqual(first);
    const res = await call("/api/tafsir/112:1?lang=ml", {}, makeEnv());
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await put(112, { ayahs: [{ numberInSurah: 1, summary: "Placeholder." }], notes: [{ n: 1, text: "A note.", from: 1, to: 4, ayah: 1 }, { n: 4, text: "Later.", from: 1, to: 4, ayah: 2 }] });
    expect((await get("/api/tafsir/112:1?lang=ml")).html).toBe("<p>Placeholder.</p><p><strong>1.</strong> A note.</p>");
  });

  it("reads the surah's file once per request", async () => {
    await put(2, fixture);
    const getSpy = vi.spyOn(env.MEDIA, "get");
    await call("/api/tafsir/2:14?lang=ml", {}, { ...makeEnv(), MEDIA: env.MEDIA } as Env);
    expect(getSpy.mock.calls.filter(([k]) => k === "tafsir/ml.thafheem/v2/2.json")).toHaveLength(1);
  });
});
