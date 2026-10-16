// GET /api/tafsirs and choosing a tafsir by id on GET /api/tafsir/:ref, with the Quran Foundation's real list of tafsirs
// (fixtures/tafsir/resources.json, fetched from the API in Oct 2026) behind a mocked API: what is offered and in which
// order, a tafsir in another language by id, ids not on the list never reaching the source, and the ayahs a passage
// explains kept to the ayah's surah. Tafsir text here is made up.
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TafsirInfo } from "../../../contracts/types";
import { SPA5K_EDITIONS } from "../src/lib/owntafsir-editions";
import { resetQfToken } from "../src/lib/qf";
import resources from "./fixtures/tafsir/resources.json";
import { call, makeEnv, mockFetch } from "./helpers";

const qfEnv = (extra: Record<string, string> = {}) =>
  ({ ...makeEnv(), QF_CLIENT_ID: "client-1", QF_CLIENT_SECRET: "secret-1", QF_ENV: "production", ...extra }) as unknown as Env;

/** The fake API: the real tafsir list; by ayah, a line naming the tafsir. For 94:5 the passage lists ayahs of other
 *  surahs too, as Tazkir ul Quran does. */
function qfApi() {
  return mockFetch(async (url) => {
    if (url.includes("oauth2")) return Response.json({ access_token: "token-1", expires_in: 3600 });
    const u = new URL(url);
    if (u.pathname === "/content/api/v4/resources/tafsirs") return Response.json(resources);
    const m = u.pathname.match(/^\/content\/api\/v4\/tafsirs\/(\d+)\/by_ayah\/(\d+):(\d+)$/);
    if (!m) return Response.json({ message: "not found" }, { status: 404 });
    const verses = m[2] === "94" ? ["84:1", "93:11", "94:1", "94:5", "94:8"] : [`${m[2]}:${m[3]}`];
    return Response.json({ tafsir: { resource_id: +m[1], verses: Object.fromEntries(verses.map((v) => [v, {}])), text: `<p>Tafsir number ${m[1]}.</p>` } });
  });
}
const byAyahCalls = (fetch: ReturnType<typeof qfApi>) =>
  fetch.mock.calls.map(([u]) => new URL(u).pathname).filter((p) => p.includes("/by_ayah/"));

beforeEach(() => resetQfToken());
afterEach(() => vi.restoreAllMocks());

describe("GET /api/tafsirs", () => {
  it("every tafsir the source lists, by language, each language's default first; Fathul Majid left out (no text)", async () => {
    qfApi();
    const res = await call("/api/tafsirs", {}, qfEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const { tafsirs } = await res.json<{ tafsirs: TafsirInfo[] }>();
    expect(resources.tafsirs).toHaveLength(23);
    expect(tafsirs).toHaveLength(22 + 2 + SPA5K_EDITIONS.length + 3); // the source's 22 offered + Thafheemul Quran and Amani Thafseer + our spa5k editions + Tafhim (English, Urdu) and Tafsir-e-Usmani
    expect(tafsirs.find((t) => t.id === 381)).toBeUndefined();
    const ids = (lang: string) => tafsirs.filter((t) => t.lang === lang).map((t) => t.id);
    expect(ids("en")).toEqual([169, "en.tafheem", 168, "en.mukhtasar", 817, "en.jalalayn"]); // en.ibnabbas did not pass the quality gate
    expect(ids("ur")).toEqual([160, "ur.tafheem", 159, "ur.usmani", 818, 157, "ur.saadi"]);
    expect(ids("ar")).toEqual([16, 91, 14, 15, 90, 93, 94, 926, 925]);
    expect(ids("bn")).toEqual([164, 165, 166, "bn.mukhtasar"]);
    expect(ids("ml")).toEqual(["ml.thafheem", "ml.amani", "ml.mukhtasar"]); // Thafheem is Malayalam's default; all from our own storage
    expect(ids("hi")).toEqual(["hi.mukhtasar"]); // a language only we have a tafsir in
    expect(ids("ru")).toEqual([170, "ru.mukhtasar", "ru.ibnkathir"]); // the source's first, then ours
    expect(ids("sw")).toEqual([231]);
    expect(ids("ku")).toEqual([804, "ku.mukhtasar"]); // "Kurdish", capitalised in the source
    // Named as the source names them (its English name), with its author.
    const source = resources.tafsirs.find((t) => t.id === 925)!;
    expect(tafsirs.find((t) => t.id === "ml.thafheem")).toEqual({ id: "ml.thafheem", name: "തഫ്ഹീമുല്‍ ഖുര്‍ആന്‍", author: "Sayyid Abul A'la Maududi", lang: "ml" });
    expect(tafsirs.find((t) => t.id === "en.tafheem")).toEqual({ id: "en.tafheem", name: "Tafhim al-Qur'an", author: "Sayyid Abul A'la Maududi", lang: "en" });
    expect(tafsirs.find((t) => t.id === "ml.mukhtasar")).toEqual({ id: "ml.mukhtasar", name: "Al-Mukhtasar", author: "Tafsir Center for Quranic Studies", lang: "ml" });
    // Every id of ours is "<lang>.<name>" (the web app validates remembered ids with this), in its own language's group.
    for (const t of tafsirs.filter((t) => typeof t.id === "string")) expect(t.id, String(t.id)).toMatch(new RegExp(`^${t.lang}\\.[a-z0-9]{1,30}$`));
    expect(tafsirs.find((t) => t.id === 925)).toEqual({ id: 925, name: source.translated_name.name, author: source.author_name, lang: "ar" });
    expect(tafsirs.find((t) => t.id === 926)!.author).toBeNull();
  });

  it("without credentials: ours only (Thafheem and the spa5k editions), nothing that needs the source (Tafhim in English)", async () => {
    const fetch = mockFetch(async () => Response.json({}, { status: 500 }));
    const res = await call("/api/tafsirs", {}, { ...makeEnv(), QF_CLIENT_ID: "", QF_CLIENT_SECRET: "" } as unknown as Env);
    expect(res.status).toBe(200);
    const { tafsirs } = await res.json<{ tafsirs: TafsirInfo[] }>();
    expect(tafsirs).toHaveLength(2 + SPA5K_EDITIONS.length); // Thafheem, Amani and the spa5k editions
    expect(tafsirs.filter((t) => t.lang === "en").map((t) => t.id)).toEqual(["en.mukhtasar", "en.jalalayn"]);
    expect(tafsirs.filter((t) => t.lang === "ml").map((t) => t.id)).toEqual(["ml.thafheem", "ml.amani", "ml.mukhtasar"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("502 when the source is down (nothing cached)", async () => {
    mockFetch(async () => Response.json({}, { status: 500 }));
    expect((await call("/api/tafsirs", {}, qfEnv({ QF_ENV: "prelive" }))).status).toBe(502); // (its own cache key: production's list is cached by the tests above)
  });
});

describe("GET /api/tafsir/:ref with an id", () => {
  it("serves a tafsir in another language when asked by id; the options stay the language's own", async () => {
    const fetch = qfApi();
    const body = await (await call("/api/tafsir/2:153?lang=en&id=160", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ lang: "ur", fallback: false, tafsir: { id: 160, author: "Hafiz Ibn Kathir" }, html: "<p>Tafsir number 160.</p>" });
    expect(body.options.map((o: { id: number }) => o.id)).toEqual([169, "en.tafheem", 168, "en.mukhtasar", 817, "en.jalalayn"]);
    // My language without a tafsir: still said so, whichever tafsir is shown (Kurdish has none from the source here).
    const km = await (await call("/api/tafsir/2:153?lang=ka&id=16", {}, qfEnv())).json<any>();
    expect(km).toMatchObject({ lang: "ar", fallback: true, tafsir: { id: 16 } });
    expect(km.options.map((o: { id: number }) => o.id)).toEqual([169, "en.tafheem", 168, "en.mukhtasar", 817, "en.jalalayn"]);
    // Malayalam has Thafheem: its options are its own, and an Arabic tafsir by id is not a fallback.
    const ml = await (await call("/api/tafsir/2:153?lang=ml&id=16", {}, qfEnv())).json<any>();
    expect(ml).toMatchObject({ lang: "ar", fallback: false, tafsir: { id: 16 } });
    expect(ml.options.map((o: { id: unknown }) => o.id)).toEqual(["ml.thafheem", "ml.amani", "ml.mukhtasar"]);
    // The text is cached by ayah and tafsir only: Urdu readers get the same one without another request.
    const ur = await (await call("/api/tafsir/2:153?lang=ur&id=160", {}, qfEnv())).json<any>();
    expect(ur).toMatchObject({ lang: "ur", fallback: false, html: "<p>Tafsir number 160.</p>" });
    expect(ur.options[0].id).toBe(160);
    expect(byAyahCalls(fetch)).toEqual(["/content/api/v4/tafsirs/160/by_ayah/2:153", "/content/api/v4/tafsirs/16/by_ayah/2:153"]);
  });

  it("Thafheem by id from another language, and as Malayalam's default: from our storage, never from the source", async () => {
    const fetch = qfApi();
    await env.MEDIA.put("tafsir/ml.thafheem/v2/2.json", JSON.stringify({ ayahs: [], notes: [{ n: 7, text: "Placeholder note.", from: 150, to: 154 }] }));
    const en = await (await call("/api/tafsir/2:153?lang=en&id=ml.thafheem", {}, qfEnv())).json<any>();
    expect(en).toMatchObject({ lang: "ml", fallback: false, from: "2:153", to: "2:153", tafsir: { id: "ml.thafheem" }, html: "<h4>ഈ ഭാഗത്തെ മറ്റു കുറിപ്പുകൾ (2:150–154)</h4><p><strong>7.</strong> Placeholder note.</p>" });
    expect(en.options.map((o: { id: number }) => o.id)).toEqual([169, "en.tafheem", 168, "en.mukhtasar", 817, "en.jalalayn"]);
    const ml = await (await call("/api/tafsir/2:153?lang=ml", {}, qfEnv())).json<any>();
    expect(ml).toMatchObject({ lang: "ml", fallback: false, tafsir: { id: "ml.thafheem" }, html: en.html });
    expect(ml.options.map((o: { id: unknown }) => o.id)).toEqual(["ml.thafheem", "ml.amani", "ml.mukhtasar"]);
    expect((await (await call("/api/tafsir/2:153?lang=ml&id=99999", {}, qfEnv())).json<any>()).tafsir.id).toBe("ml.thafheem");
    expect(byAyahCalls(fetch)).toEqual([]);
  });

  it("an id not on the list (left out, unknown, malformed) gets the language's default: the source is never asked for it", async () => {
    const fetch = qfApi();
    for (const id of ["381", "99999", "abc", "16.5", "-16", ""]) {
      const body = await (await call(`/api/tafsir/3:7?lang=bn&id=${id}`, {}, qfEnv())).json<any>();
      expect(body.tafsir.id, id).toBe(164);
    }
    expect(byAyahCalls(fetch)).toEqual(["/content/api/v4/tafsirs/164/by_ayah/3:7"]);
  });

  it("the ayahs a passage explains are those of the ayah's surah", async () => {
    qfApi();
    const body = await (await call("/api/tafsir/94:5?lang=ur&id=818", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ tafsir: { id: 818 }, from: "94:1", to: "94:8" });
  });
});
