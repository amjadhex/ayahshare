// /api/tafsir and /api/reflections with a mocked Quran Foundation API: token caching, language choice and fallback,
// sanitising, edge caching, errors; lessons, the ranking of verified authors, proxied photos. Arabic in the fixtures is
// placeholder text (abjad letters), never Quran text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetQfToken } from "../src/lib/qf";
import { plainText, sanitizeHtml } from "../src/lib/sanitize";
import { call, makeEnv, mockFetch } from "./helpers";

const TOKEN_URL = "https://oauth2.quran.foundation/oauth2/token";
const BASE = "https://apis.quran.foundation";
const qfEnv = (extra: Record<string, string> = {}) =>
  ({ ...makeEnv(), QF_CLIENT_ID: "client-1", QF_CLIENT_SECRET: "secret-1", QF_ENV: "production", ...extra }) as unknown as Env;

const TAFSIRS = {
  tafsirs: [
    { id: 926, name: "Arabic Jalalayn Tafseer", author_name: null, language_name: "arabic", translated_name: { name: "Tafseer Jalalayn" } },
    { id: 169, name: "Ibn Kathir (Abridged)", author_name: "Hafiz Ibn Kathir", language_name: "english", translated_name: { name: "Ibn Kathir (Abridged)" } },
    { id: 168, name: "Ma'arif al-Qur'an", author_name: "Mufti Muhammad Shafi", language_name: "english", translated_name: { name: "Ma'arif al-Qur'an" } },
    { id: 159, name: "Bayan ul Quran", author_name: "Dr. Israr Ahmad", language_name: "urdu", translated_name: { name: "Bayan ul Quran" } },
    { id: 160, name: "تفسیر ابنِ کثیر", author_name: "Hafiz Ibn Kathir", language_name: "urdu", translated_name: { name: "Tafsir Ibn Kathir" } },
    { id: 16, name: "Tafsir Muyassar", author_name: "المیسر", language_name: "arabic", translated_name: { name: "Tafsir Muyassar" } },
  ],
};
const TEXT = `<h2 class="title">Patience</h2><p onclick="steal()">Seek help <a href="javascript:alert(1)">through</a> patience.</p>`
  + `<script>alert(1)</script><img src=x onerror=alert(2)><span class="arabic qpc-hafs">ابجد</span><style>p{}</style>`;

type Post = Record<string, unknown>;
const post = (id: number, extra: Post = {}): Post => ({
  id, body: `Reflection ${id}\r\n\r\n\r\n<b>bold</b> &amp; more`, likesCount: id, languageName: "English", publishedAt: "2025-04-18T05:08:01.000Z",
  reported: false, toxicityScore: 10, author: { username: `user${id}`, firstName: "Private", lastName: "Name", verified: false, avatarUrls: { small: "", medium: "", large: "" } }, ...extra,
});
const PHOTO = "https://s3.amazonaws.com/qreflect-bucket/avatars/000/006/medium/photo.jpg?1600000000";
const teacher = (id: number, name: string, avatarUrls: Record<string, string> = { small: "", medium: "", large: "" }) =>
  ({ username: `teacher${id}`, fullName: name, firstName: "Private", lastName: "Name", verified: true, avatarUrls });

/** QuranReflect's feed, the same for every ayah (each test asks its own ayahs: the edge cache lasts through the file).
 *  English, by tab, type and page. */
interface Feed { data: Post[]; total: number; pages: number }
const FEEDS: Record<string, Feed> = {
  "popular/1/1": {
    data: [post(1), post(2, { reported: true }), post(3, { toxicityScore: 90 }), post(4, { languageName: "Arabic" }), post(5, { body: "<p></p>" }),
      post(6, { author: teacher(6, "Teacher Six", { small: "", medium: PHOTO, large: "" }) })],
    total: 143, pages: 15,
  },
  "popular/1/2": { data: [post(11, { likesCount: 50 }), post(12, { likesCount: 0, author: teacher(12, "Teacher Twelve", { medium: "https://evil.example/x.png" }) }), post(1)], total: 143, pages: 15 },
  "qdc/1/1": { data: [post(20, { likesCount: 2 }), post(11, { likesCount: 50 })], total: 2, pages: 1 },
  "popular/2/1": { data: [post(31, { author: teacher(31, "Teacher One") }), post(32, { likesCount: 9 }), post(33, { author: teacher(33, "Teacher Two") })], total: 3, pages: 1 },
};

/** The fake Quran Foundation API; records every request. `feeds` replaces the feed answers for some keys
 *  ("<tab>/<postTypeIds>/<page>", or "<languages>:<tab>/<postTypeIds>/<page>" for one language). */
function qfApi(overrides: { tokenStatus?: number; firstApi401?: boolean; feeds?: Record<string, Feed | number> } = {}) {
  let first401 = overrides.firstApi401 ?? false;
  return mockFetch(async (url, init) => {
    if (url === TOKEN_URL) {
      if (overrides.tokenStatus) return Response.json({ error: "invalid_client" }, { status: overrides.tokenStatus });
      return Response.json({ access_token: "token-1", token_type: "bearer", expires_in: 3600, scope: "content post.read" });
    }
    const headers = new Headers(init?.headers);
    if (headers.get("x-auth-token") !== "token-1" || headers.get("x-client-id") !== "client-1") return Response.json({ message: "unauthorized" }, { status: 401 });
    if (first401) { first401 = false; return Response.json({ message: "expired" }, { status: 401 }); }
    const u = new URL(url);
    if (u.pathname === "/content/api/v4/resources/tafsirs") return Response.json(TAFSIRS);
    const m = u.pathname.match(/^\/content\/api\/v4\/tafsirs\/(\d+)\/by_ayah\/(\d+:\d+)$/);
    if (m) return Response.json({ tafsir: { resource_id: +m[1], verses: { "2:153": { id: 160 }, "2:154": { id: 161 } }, text: TEXT } });
    if (u.pathname === "/quran-reflect/v1/posts/feed") {
      const q = u.searchParams;
      const key = `${q.get("tab")}/${q.get("filter[postTypeIds]")}/${q.get("page")}`;
      const answer = overrides.feeds?.[`${q.get("languages")}:${key}`] ?? overrides.feeds?.[key] ?? FEEDS[key] ?? { data: [], total: 143, pages: 15 };
      if (typeof answer === "number") return Response.json({ message: "error" }, { status: answer });
      return Response.json({ ...answer, limit: 10, currentPage: Number(q.get("page")) });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  });
}
const feedCalls = (fetch: ReturnType<typeof qfApi>) =>
  fetch.mock.calls.map(([u]) => new URL(u)).filter((u) => u.pathname.endsWith("/posts/feed")).map((u) => Object.fromEntries(u.searchParams));

beforeEach(() => resetQfToken());
afterEach(() => vi.restoreAllMocks());

describe("sanitising", () => {
  it("tafsir HTML keeps basic formatting only", () => {
    const html = sanitizeHtml(TEXT);
    expect(html).toBe('<h2>Patience</h2><p>Seek help through patience.</p><span lang="ar" class="rf-aya">ابجد</span>');
    // Only the source classes that carry meaning survive, as ours; everything else is dropped.
    expect(sanitizeHtml('<span class="reference brown">[1]</span><div class="ur page-number">7</div><p class="evil" onclick="x">t</p>'))
      .toBe('<span class="rf-ref">[1]</span><div class="rf-page">7</div><p>t</p>');
    expect(sanitizeHtml('<p class="rf-q x">a</p><span class="&quot;onclick=x">b</span>')).toBe("<p>a</p><span>b</span>");
    expect(sanitizeHtml('<p lang="ur" dir="rtl" style="x">a < b</p><br/><iframe src="x"></iframe>')).toBe('<p lang="ur" dir="rtl">a &lt; b</p><br>');
    expect(sanitizeHtml('<p title="a>b">x</p>')).not.toMatch(/title/);
  });

  it("reflections become plain text", () => {
    expect(plainText("Line 1\r\n\r\n\r\n\r\n<b>Line</b> 2 &amp; &#1576; &lt;tag&gt;<script>bad()</script>")).toBe("Line 1\n\nLine 2 & ب <tag>");
    expect(plainText("x".repeat(20), 10)).toBe(`${"x".repeat(10)}…`);
  });
});

describe("GET /api/tafsir/:ref", () => {
  it("serves the language's preferred tafsir, sanitised, and caches the token and the answer", async () => {
    const fetch = qfApi();
    const res = await call("/api/tafsir/2:153?lang=ur", {}, qfEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const body = await res.json<any>();
    expect(body).toMatchObject({
      ref: "2:153", lang: "ur", fallback: false, tafsir: { id: 160, name: "Tafsir Ibn Kathir", author: "Hafiz Ibn Kathir" },
      from: "2:153", to: "2:154", options: [{ id: 160, name: "Tafsir Ibn Kathir" }, { id: "ur.tafheem", name: "Tafheem ul Quran" }, { id: 159, name: "Bayan ul Quran" },
        { id: "ur.usmani", name: "Tafsir-e-Usmani" }, { id: "ur.saadi", name: "Tafsir al-Sa'di" }],
    });
    expect(body.html).not.toMatch(/script|onclick|onerror|javascript|<a|<img/);
    expect(body.html).toBe('<h3>Patience</h3><p>Seek help through patience.</p><p><span lang="ar" class="rf-aya">ابجد</span></p>');
    // Basic auth with the client id and secret, client-credentials grant with both scopes.
    const [tokenUrl, tokenInit] = fetch.mock.calls[0];
    expect(tokenUrl).toBe(TOKEN_URL);
    expect(new Headers(tokenInit!.headers).get("Authorization")).toBe(`Basic ${btoa("client-1:secret-1")}`);
    expect(String(tokenInit!.body)).toBe("grant_type=client_credentials&scope=content+post.read");
    expect(fetch.mock.calls.map(([u]) => new URL(u).pathname)).toEqual(["/oauth2/token", "/content/api/v4/resources/tafsirs", "/content/api/v4/tafsirs/160/by_ayah/2:153"]);
    // The secret is never in the answer.
    expect(JSON.stringify(body)).not.toMatch(/secret-1|token-1/);

    // Same request: the edge cache answers. Another ayah: the token and the tafsir list are reused.
    await call("/api/tafsir/2:153?lang=ur", {}, qfEnv());
    expect(fetch).toHaveBeenCalledTimes(3);
    const other = await (await call("/api/tafsir/94:5?lang=ur&id=159", {}, qfEnv())).json<any>();
    expect(other.tafsir.id).toBe(159);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3][0]).toBe(`${BASE}/content/api/v4/tafsirs/159/by_ayah/94:5`);
  });

  it("English when the language has no tafsir (fallback), Ibn Kathir first; unknown languages too", async () => {
    qfApi();
    const ka = await (await call("/api/tafsir/2:153?lang=ka", {}, qfEnv())).json<any>(); // (Malayalam has Thafheem: thafheem.test.ts)
    expect(ka).toMatchObject({ lang: "en", fallback: true, tafsir: { id: 169 } });
    expect(ka.options.map((o: { id: number }) => o.id)).toEqual([169, "en.tafheem", 168, "en.mukhtasar", "en.jalalayn"]);
    const en = await (await call("/api/tafsir/2:153", {}, qfEnv())).json<any>();
    expect(en).toMatchObject({ lang: "en", fallback: false, tafsir: { id: 169 } });
    const ar = await (await call("/api/tafsir/2:153?lang=ar", {}, qfEnv())).json<any>();
    expect(ar.tafsir.id).toBe(16); // Muyassar before Jalalayn
  });

  it("gets a new token once when the API refuses the cached one", async () => {
    const fetch = qfApi({ firstApi401: true });
    expect((await call("/api/tafsir/1:1?lang=en", {}, qfEnv())).status).toBe(200);
    expect(fetch.mock.calls.filter(([u]) => u === TOKEN_URL)).toHaveLength(2);
  });

  it("validates the ref; 503 without credentials; 502 when the token is refused; nothing cached on errors", async () => {
    const fetch = qfApi({ tokenStatus: 401 });
    for (const bad of ["/api/tafsir/0:1", "/api/tafsir/115:1", "/api/tafsir/2:300", "/api/tafsir/abc", "/api/tafsir/2:153-154"]) {
      expect((await call(bad, {}, qfEnv())).status, bad).toBe(400);
    }
    expect((await call("/api/tafsir/2:153", {}, { ...makeEnv(), QF_CLIENT_ID: "", QF_CLIENT_SECRET: "" } as unknown as Env)).status).toBe(503);
    const res = await call("/api/tafsir/3:1?lang=en", {}, qfEnv());
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(await res.json())).not.toMatch(/secret|token/i);
    await call("/api/tafsir/3:1?lang=en", {}, qfEnv());
    expect(fetch.mock.calls.filter(([u]) => u === TOKEN_URL)).toHaveLength(2);
  });

  it("prelive uses its own token and API hosts", async () => {
    const fetch = mockFetch((url) => (url.includes("oauth2") ? Response.json({ access_token: "token-1", expires_in: 3600 })
      : url.endsWith("/resources/tafsirs") ? Response.json(TAFSIRS) : Response.json({ tafsir: { text: "<p>x</p>", verses: { "1:1": {} } } })));
    expect((await call("/api/tafsir/1:2?lang=en", {}, qfEnv({ QF_ENV: "prelive" }))).status).toBe(200);
    expect(fetch.mock.calls.map(([u]) => new URL(u).host)).toEqual(["prelive-oauth2.quran.foundation", "apis-prelive.quran.foundation", "apis-prelive.quran.foundation"]);
  });
});

describe("GET /api/reflections/:ref", () => {
  it("English: popular pages 1–2 and the reviewed page in three requests, ranked verified, reviewed, likes; cached", async () => {
    const fetch = qfApi();
    const res = await call("/api/reflections/2:153?lang=en", {}, qfEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const body = await res.json<any>();
    expect(body).toMatchObject({ ref: "2:153", lang: "en", fallback: false, kind: "reflections", total: 143, page: 1, pages: 14 });
    // 6 and 12 are verified (more likes first), 11 and 20 reviewed, then 1 and 4: English before the Arabic post that
    // the feed adds; reported, toxic, empty and repeated posts are left out.
    expect(body.posts.map((p: { id: number }) => p.id)).toEqual([6, 12, 11, 20, 1, 4]);
    expect(body.posts.find((p: { id: number }) => p.id === 1)).toEqual({
      id: 1, body: "Reflection 1\n\nbold & more", author: "user1", likes: 1, lang: "en", date: "2025-04-18T05:08:01.000Z",
      url: "https://quranreflect.com/posts/1", kind: "reflection", reviewed: false,
      by: { name: "user1", username: "user1", verified: false, avatar: null },
    });
    expect(body.posts[0].by).toEqual({ name: "Teacher Six", username: "teacher6", verified: true, avatar: "/api/avatar/qr/avatars/000/006/medium/photo.jpg" });
    expect(body.posts[1].by.avatar).toBeNull(); // not QuranReflect's bucket: never passed on
    expect(body.posts.find((p: { id: number }) => p.id === 20).reviewed).toBe(true);
    expect(body.posts.find((p: { id: number }) => p.id === 4).lang).toBe("ar");
    expect(JSON.stringify(body)).not.toMatch(/Private|firstName|s3\.amazonaws|evil/); // public name only; our own photo URL
    const calls = feedCalls(fetch);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      tab: "popular", languages: "2", page: "1", "filter[postTypeIds]": "1",
      "filter[references][0][chapterId]": "2", "filter[references][0][from]": "153", "filter[references][0][to]": "153",
    });
    expect(calls.map((q) => `${q.tab}/${q.page}`).sort()).toEqual(["popular/1", "popular/2", "qdc/1"]);
    // Cached for the day.
    await call("/api/reflections/2:153?lang=en", {}, qfEnv());
    expect(feedCalls(fetch)).toHaveLength(3);
  });

  it("page n > 1 is popular page n + 1, one request; the page is clamped", async () => {
    const fetch = qfApi({ feeds: { "popular/1/3": { data: [post(41)], total: 143, pages: 15 } } });
    const body = await (await call("/api/reflections/2:153?lang=en&page=2", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ page: 2, pages: 14, posts: [{ id: 41 }] });
    expect(feedCalls(fetch).map((q) => `${q.tab}/${q.page}`)).toEqual(["popular/3"]);
    const last = await (await call("/api/reflections/94:5?lang=en&page=999", {}, qfEnv())).json<any>();
    expect(last.page).toBe(50);
    expect(feedCalls(fetch).at(-1)).toMatchObject({ page: "51", "filter[references][0][chapterId]": "94", "filter[references][0][from]": "5" });
    expect((await call("/api/reflections/94:0", {}, qfEnv())).status).toBe(400);
  });

  it("My language when it has posts here (its first page doubles as the check)", async () => {
    const urdu = { data: [post(51, { languageName: "Urdu" }), post(52)], total: 20, pages: 2 };
    const fetch = qfApi({ feeds: { "5:popular/1/1": urdu, "5:popular/1/2": { data: [post(53)], total: 20, pages: 2 }, "5:qdc/1/1": { data: [], total: 0, pages: 0 } } });
    const body = await (await call("/api/reflections/3:1?lang=ur", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ lang: "ur", fallback: false, pages: 1 });
    expect(body.posts.map((p: { id: number; lang: string }) => `${p.id}:${p.lang}`)).toEqual(["51:ur", "53:en", "52:en"]); // My language first, then by likes
    const calls = feedCalls(fetch);
    expect(calls).toHaveLength(3);
    expect(calls.every((q) => q.languages === "5")).toBe(true);
  });

  it("English when my language has none here (said so), shared with English readers; at most four requests", async () => {
    const fetch = qfApi(); // the Urdu feed answers English posts only
    const body = await (await call("/api/reflections/3:2?lang=ur", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ lang: "en", fallback: true });
    expect(body.posts.map((p: { id: number }) => p.id)).toEqual([6, 12, 11, 20, 1, 4]);
    const calls = feedCalls(fetch);
    expect(calls.map((q) => q.languages)).toEqual(["5", "2", "2", "2"]);
    // English readers now get the cached English page; Urdu readers the cached answer.
    expect((await (await call("/api/reflections/3:2?lang=en", {}, qfEnv())).json<any>()).fallback).toBe(false);
    expect((await (await call("/api/reflections/3:2?lang=ur", {}, qfEnv())).json<any>()).fallback).toBe(true);
    expect(feedCalls(fetch)).toHaveLength(4);
  });

  it("languages QuranReflect does not have ask for English directly", async () => {
    const fetch = qfApi();
    const body = await (await call("/api/reflections/94:5?lang=ml", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ lang: "en", fallback: true });
    expect(feedCalls(fetch).every((q) => q.languages === "2" && q["filter[references][0][chapterId]"] === "94")).toBe(true);
  });

  it("the reviewed and second pages only add to the ranking: page 1 is served when they fail", async () => {
    const fetch = qfApi({ feeds: { "qdc/1/1": 500, "popular/1/2": 400 } });
    const body = await (await call("/api/reflections/3:3?lang=en", {}, qfEnv())).json<any>();
    expect(body.posts.map((p: { id: number }) => p.id)).toEqual([6, 1, 4]);
    expect(feedCalls(fetch)).toHaveLength(3);
  });

  it("an ayah without reflections costs one request", async () => {
    const fetch = qfApi({ feeds: { "popular/1/1": { data: [], total: 0, pages: 0 } } });
    const body = await (await call("/api/reflections/3:4?lang=en", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ total: 0, pages: 0, posts: [] });
    expect(feedCalls(fetch)).toHaveLength(1);
  });

  it("kind=lessons: QuranReflect lessons (post type 2), one request a page, verified teachers first", async () => {
    const fetch = qfApi();
    const body = await (await call("/api/reflections/3:5?lang=en&kind=lessons", {}, qfEnv())).json<any>();
    expect(body).toMatchObject({ kind: "lessons", lang: "en", fallback: false, total: 3, page: 1, pages: 1 });
    expect(body.posts.map((p: { id: number; kind: string; by: { verified: boolean } }) => `${p.id}:${p.kind}:${p.by.verified}`))
      .toEqual(["33:lesson:true", "31:lesson:true", "32:lesson:false"]);
    expect(body.posts[0].by).toEqual({ name: "Teacher Two", username: "teacher33", verified: true, avatar: null });
    expect(feedCalls(fetch)).toEqual([expect.objectContaining({ tab: "popular", "filter[postTypeIds]": "2", page: "1", languages: "2" })]);
    // Lessons and reflections are cached apart.
    await call("/api/reflections/3:5?lang=en", {}, qfEnv());
    expect(feedCalls(fetch).filter((q) => q["filter[postTypeIds]"] === "1")).toHaveLength(3);
    // In Arabic: no Arabic lessons here, so the English ones (one more request, then shared).
    const ar = await (await call("/api/reflections/3:5?lang=ar&kind=lessons", {}, qfEnv())).json<any>();
    expect(ar).toMatchObject({ lang: "en", fallback: true, kind: "lessons" });
    expect(feedCalls(fetch).filter((q) => q["filter[postTypeIds]"] === "2").map((q) => q.languages)).toEqual(["2", "1"]);
  });

  it("verified teachers: the served language before the other languages QuranReflect adds when it has few", async () => {
    qfApi({ feeds: { "popular/2/1": { data: [
      post(41, { languageName: "Malay", likesCount: 99, author: teacher(41, "Teacher Malay") }),
      post(42, { likesCount: 1, author: teacher(42, "Teacher English") }),
      post(43, { likesCount: 500 }), // not verified: after both
    ], total: 3, pages: 1 } } });
    const body = await (await call("/api/reflections/3:6?lang=en&kind=lessons", {}, qfEnv())).json<any>();
    expect(body.posts.map((p: { id: number; lang: string }) => `${p.id}:${p.lang}`)).toEqual(["42:en", "41:ms", "43:en"]);
  });
});
