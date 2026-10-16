// Our own tafsirs besides Thafheem (thafheem.test.ts), on GET /api/tafsir/:ref: the spa5k editions read from R2
// (tafsir/<id>/v1/<surah>.json, {surah, ayahs: [{ayah, text, to?}]}), never from the Quran Foundation, and Tafhim al-Qur'an in
// English (id "en.tafheem"), read live from the Quran Foundation's translation 95 and its footnotes (mocked here). The
// texts are made up.
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetQfToken } from "../src/lib/qf";
import resources from "./fixtures/tafsir/resources.json";
import { call, makeEnv, mockFetch } from "./helpers";

const put = (id: string, surah: number, body: unknown) => env.MEDIA.put(`tafsir/${id}/v1/${surah}.json`, JSON.stringify(body));
const noQf = () => makeEnv();
const qfEnv = () => ({ ...makeEnv(), QF_CLIENT_ID: "client-1", QF_CLIENT_SECRET: "secret-1", QF_ENV: "production" }) as unknown as Env;
const get = async (path: string, e: Env = noQf()) => (await call(path, {}, e)).json<any>();

beforeEach(() => resetQfToken());
afterEach(() => vi.restoreAllMocks());

describe("our own editions from R2", () => {
  it("one ayah's text in escaped paragraphs, with no Quran Foundation credentials and no request to it", async () => {
    await put("ml.mukhtasar", 2, { surah: 2, ayahs: [{ ayah: 152, text: "Other ayah." }, { ayah: 153, text: "First <b>paragraph</b> & more.\nSecond paragraph.\n\n  Third.  " }] });
    const fetch = mockFetch(async () => Response.json({}, { status: 500 }));
    const res = await call("/api/tafsir/2:153?lang=ml&id=ml.mukhtasar", {}, noQf());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const body = await res.json<any>();
    expect(body).toMatchObject({
      ref: "2:153", lang: "ml", fallback: false, from: "2:153", to: "2:153",
      tafsir: { id: "ml.mukhtasar", name: "Al-Mukhtasar", author: "Tafsir Center for Quranic Studies" },
      options: [{ id: "ml.thafheem", name: "തഫ്ഹീമുല്‍ ഖുര്‍ആന്‍" }, { id: "ml.amani", name: "അമാനി തഫ്സീർ" }, { id: "ml.mukhtasar", name: "Al-Mukhtasar" }],
    });
    expect(body.html).toBe("<p>First &lt;b&gt;paragraph&lt;/b&gt; &amp; more.</p><p>Second paragraph.</p><p>Third.</p>");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an edition by id from another language (the options stay the language's own); a language only we cover gets ours as its default", async () => {
    await put("hi.mukhtasar", 1, { surah: 1, ayahs: [{ ayah: 2, text: "हिंदी पाठ" }] });
    const hi = await get("/api/tafsir/1:2?lang=hi"); // no id, no credentials: Hindi's only tafsir is ours
    expect(hi).toMatchObject({ lang: "hi", fallback: false, tafsir: { id: "hi.mukhtasar" }, html: "<p>हिंदी पाठ</p>", options: [{ id: "hi.mukhtasar" }] });
    const ml = await get("/api/tafsir/1:2?lang=ml&id=hi.mukhtasar"); // asked by id from Malayalam
    expect(ml).toMatchObject({ lang: "hi", fallback: false, tafsir: { id: "hi.mukhtasar" } });
    expect(ml.options.map((o: { id: string }) => o.id)).toEqual(["ml.thafheem", "ml.amani", "ml.mukhtasar"]);
    expect((await get("/api/tafsir/1:2?lang=hi&id=hi.other")).tafsir.id).toBe("hi.mukhtasar"); // unknown own id: the language's default
  });

  it("a passage that covers several ayahs (to): any of them gets the whole text and the range; an ayah with no text gets none", async () => {
    await put("sq.saadi", 3, { surah: 3, ayahs: [{ ayah: 1, text: "Alif.", to: 1 }, { ayah: 2, text: "One long passage.", to: 4 }, { ayah: 6, text: "Six." }] });
    for (const a of [2, 3, 4]) {
      expect(await get(`/api/tafsir/3:${a}?lang=sq`), String(a)).toMatchObject({ from: "3:2", to: "3:4", html: "<p>One long passage.</p>", tafsir: { id: "sq.saadi" } });
    }
    expect(await get("/api/tafsir/3:5?lang=sq")).toMatchObject({ from: "3:5", to: "3:5", html: "" }); // nothing for 3:5 (200: the card says so)
    expect(await get("/api/tafsir/3:6?lang=sq")).toMatchObject({ from: "3:6", to: "3:6", html: "<p>Six.</p>" });
  });

  it("a surah that is not in storage is a 404 and is not cached; an Arabic-script edition is served as paragraphs too", async () => {
    await put("fa.saadi", 1, { surah: 1, ayahs: [{ ayah: 1, text: "بسم الله\nترجمه" }] });
    const fa = await get("/api/tafsir/1:1?lang=fa&id=fa.saadi");
    expect(fa.tafsir.id).toBe("fa.saadi");
    expect(fa.html).toContain("<p>");
    const res = await call("/api/tafsir/112:1?lang=sq&id=sq.saadi", {}, noQf());
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await put("sq.saadi", 112, { surah: 112, ayahs: [{ ayah: 1, text: "Now here." }] });
    expect((await get("/api/tafsir/112:1?lang=sq&id=sq.saadi")).html).toBe("<p>Now here.</p>");
  });

  it("with the source's credentials: the list's order decides the default, an unknown id still gets it", async () => {
    mockFetch(async (url) => url.includes("oauth2") ? Response.json({ access_token: "t", expires_in: 3600 })
      : new URL(url).pathname === "/content/api/v4/resources/tafsirs" ? Response.json(resources)
      : Response.json({ tafsir: { verses: { "1:1": {} }, text: "<p>Source text.</p>" } }));
    await put("ru.mukhtasar", 1, { surah: 1, ayahs: [{ ayah: 1, text: "Our Russian." }] });
    expect(await get("/api/tafsir/1:1?lang=ru", qfEnv())).toMatchObject({ tafsir: { id: 170 }, html: "<p>Source text.</p>" }); // the source's Al-Sa'di first
    const ours = await get("/api/tafsir/1:1?lang=ru&id=ru.mukhtasar", qfEnv());
    expect(ours).toMatchObject({ tafsir: { id: "ru.mukhtasar" }, html: "<p>Our Russian.</p>" });
    expect(ours.options.map((o: { id: unknown }) => o.id)).toEqual([170, "ru.mukhtasar", "ru.ibnkathir"]);
    expect((await get("/api/tafsir/1:1?lang=en&id=en.nope", qfEnv())).tafsir.id).toBe(169);
  });

  it("503 when the language's default would come from the source and there are no credentials", async () => {
    expect((await call("/api/tafsir/2:153?lang=en", {}, noQf())).status).toBe(503);
  });
});

const TRANSLATION_95 = (ref: string) => ({
  "2:153": 'Believers!<sup foot_note="177159">1</sup> Seek help in patience and in Prayer; Allah is with those that are patient.<sup foot_note="177160">2</sup>',
  "112:1": "Say: He is Allah, the One.",
  "1:1": 'In the name of Allah<sup foot_note=9>1</sup>', // unquoted, as Tafsir-e-Usmani's are
}[ref]);
const NOTES: Record<string, string> = { "177159": "First note, with <i>italics</i> & <script>bad()</script>text.", "177160": "Second note.", "9": "Bismillah note." };

function tafheemApi(fail = false) {
  return mockFetch(async (url) => {
    if (url.includes("oauth2")) return Response.json({ access_token: "token-1", expires_in: 3600 });
    const u = new URL(url);
    if (u.pathname === "/content/api/v4/resources/tafsirs") return Response.json(resources);
    const tr = u.pathname.match(/^\/content\/api\/v4\/quran\/translations\/(95|97|151)$/);
    const t = tr && TRANSLATION_95(u.searchParams.get("verse_key")!);
    if (t) return Response.json({ translations: [{ resource_id: +tr[1], text: t }] });
    const n = u.pathname.match(/^\/content\/api\/v4\/foot_notes\/(\d+)$/);
    if (n && NOTES[n[1]] && !fail) return Response.json({ foot_note: { id: +n[1], text: NOTES[n[1]], language_name: "english" } });
    return Response.json({ message: "not found" }, { status: n && fail ? 500 : 404 });
  });
}
const paths = (fetch: ReturnType<typeof tafheemApi>) => fetch.mock.calls.map(([u]) => new URL(u)).filter((u) => u.pathname.includes("translations/95") || u.pathname.includes("foot_notes")).map((u) => u.pathname + u.search);

describe("Tafhim al-Qur'an in English (en.tafheem), from the Quran Foundation's translation 95", () => {
  it("the translation with its note numbers in superscript, then each note, numbered, as Thafheem does", async () => {
    const fetch = tafheemApi();
    const res = await call("/api/tafsir/2:153?lang=en&id=en.tafheem", {}, qfEnv());
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toMatchObject({
      ref: "2:153", lang: "en", fallback: false, from: "2:153", to: "2:153",
      tafsir: { id: "en.tafheem", name: "Tafhim al-Qur'an", author: "Sayyid Abul A'la Maududi" },
    });
    expect(body.options.map((o: { id: unknown }) => o.id)).toEqual([169, "en.tafheem", 168, "en.mukhtasar", 817, "en.jalalayn"]);
    expect(body.html).toBe(
      '<p class="rf-tr">Believers!<sup>1</sup> Seek help in patience and in Prayer; Allah is with those that are patient.<sup>2</sup></p>'
      + "<p><strong>1.</strong> First note, with <i>italics</i> &amp; text.</p>"
      + "<p><strong>2.</strong> Second note.</p>");
    expect(body.html).not.toMatch(/script|foot_note/);
    expect(paths(fetch)).toEqual([
      "/content/api/v4/quran/translations/95?verse_key=2:153", "/content/api/v4/foot_notes/177159", "/content/api/v4/foot_notes/177160"]);
    // Cached by ayah (30 days): a second request asks the source for nothing.
    await call("/api/tafsir/2:153?lang=en&id=en.tafheem", {}, qfEnv());
    expect(paths(fetch)).toHaveLength(3);
  });

  it("an ayah without notes: just the translation line", async () => {
    tafheemApi();
    expect((await get("/api/tafsir/112:1?lang=en&id=en.tafheem", qfEnv())).html).toBe('<p class="rf-tr">Say: He is Allah, the One.</p>');
  });

  it("is offered second in English and is never the default; without credentials it is not served", async () => {
    tafheemApi();
    expect((await get("/api/tafsir/1:1?lang=en", qfEnv())).tafsir.id).toBe(169);
    expect((await call("/api/tafsir/1:1?lang=en&id=en.tafheem", {}, noQf())).status).toBe(503);
  });

  it("a note that cannot be fetched fails the answer (502), and nothing is cached", async () => {
    tafheemApi(true);
    const res = await call("/api/tafsir/1:1?lang=en&id=en.tafheem", {}, qfEnv());
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    tafheemApi();
    expect((await get("/api/tafsir/1:1?lang=en&id=en.tafheem", qfEnv())).html).toContain("<strong>1.</strong> Bismillah note.");
  });
});

describe("Urdu: Tafheem ul Quran (translation 97) and Tafsir-e-Usmani (151), the same way as Tafhim in English", () => {
  it("listed for Urdu with credentials, each read from its own translation and footnotes", async () => {
    const fetch = tafheemApi();
    const list = (await get("/api/tafsirs", qfEnv())).tafsirs as { id: unknown; lang: string; name: string }[];
    expect(list.filter((x) => x.id === "ur.tafheem" || x.id === "ur.usmani").map((x) => [x.id, x.lang, x.name]))
      .toEqual([["ur.tafheem", "ur", "Tafheem ul Quran"], ["ur.usmani", "ur", "Tafsir-e-Usmani"]]);
    const body = await get("/api/tafsir/1:1?lang=ur&id=ur.tafheem", qfEnv());
    expect([body.lang, body.tafsir.id]).toEqual(["ur", "ur.tafheem"]);
    expect(body.html).toContain("<strong>1.</strong> Bismillah note.");
    await get("/api/tafsir/1:1?lang=ur&id=ur.usmani", qfEnv());
    const asked = fetch.mock.calls.map(([u]) => new URL(u).pathname);
    expect(asked).toContain("/content/api/v4/quran/translations/97");
    expect(asked).toContain("/content/api/v4/quran/translations/151");
  });
  it("not offered without the Quran Foundation's credentials", async () => {
    tafheemApi();
    const ids = ((await get("/api/tafsirs", noQf())).tafsirs as { id: unknown }[]).map((x) => x.id);
    expect(ids).not.toContain("ur.tafheem");
    expect(ids).not.toContain("ur.usmani");
  });
});
