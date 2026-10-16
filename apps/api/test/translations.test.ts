// /qapi/surah/:n/<lang>.qf-<id>: a Quran Foundation translation in the Quran API's shape, with a mocked Quran
// Foundation API. The fixture text is placeholder words, never translation text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetQfToken } from "../src/lib/qf";
import { qfText } from "../src/lib/translations";
import { call, makeEnv, mockFetch } from "./helpers";

const TOKEN_URL = "https://oauth2.quran.foundation/oauth2/token";
const BASE = "https://apis.quran.foundation";
const qfEnv = () => ({ ...makeEnv(), QF_CLIENT_ID: "client-1", QF_CLIENT_SECRET: "secret-1", QF_ENV: "production" }) as unknown as Env;

/** The fake Quran Foundation API: surah 112 (4 ayahs) of every translation, listed out of order; `ayahs` overrides. */
function qfApi(ayahs?: { verse_key: string; text: string }[]) {
  return mockFetch(async (url) => {
    if (url === TOKEN_URL) return Response.json({ access_token: "token-1", expires_in: 3600 });
    const m = url.match(/\/content\/api\/v4\/quran\/translations\/(\d+)\?chapter_number=(\d+)&fields=verse_key$/);
    if (!m) return Response.json({ message: "not found" }, { status: 404 });
    return Response.json({ translations: ayahs ?? [
      { resource_id: +m[1], verse_key: "112:2", text: "<p>word two</p><p>more</p>" },
      { resource_id: +m[1], verse_key: "112:1", text: "word one<sup foot_note=9>1</sup> &amp; <a class=f><sup foot_note=10>2</sup></a>end" },
      { resource_id: +m[1], verse_key: "112:3", text: "word three" },
      { resource_id: +m[1], verse_key: "112:4", text: "word  four" },
    ] });
  });
}

afterEach(() => { vi.restoreAllMocks(); resetQfToken(); });

describe("Quran Foundation translations at /qapi/surah/:n/<lang>.qf-<id>", () => {
  it("serves the surah in the Quran API's shape, in ayah order, footnote markers and tags removed; then from the edge cache", async () => {
    const fetch = qfApi();
    const res = await call("/qapi/surah/112/ta.qf-133", {}, qfEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=2592000, immutable");
    expect(await res.json()).toEqual({ code: 200, data: { number: 112, ayahs: [
      { numberInSurah: 1, text: "word one & end" },
      { numberInSurah: 2, text: "word two more" },
      { numberInSurah: 3, text: "word three" },
      { numberInSurah: 4, text: "word four" },
    ] } });
    const api = fetch.mock.calls.find(([url]) => url.startsWith(BASE))!;
    expect(api[0]).toBe(`${BASE}/content/api/v4/quran/translations/133?chapter_number=112&fields=verse_key`);
    // The same translation with another language in its id is the same cached answer.
    const again = await call("/qapi/surah/112/en.qf-133", {}, qfEnv());
    expect((await again.json<{ data: { ayahs: unknown[] } }>()).data.ayahs).toHaveLength(4);
    expect(fetch.mock.calls.filter(([url]) => url.startsWith(BASE))).toHaveLength(1);
  });

  it("an answer without every ayah, or with no text, is an error and is not cached", async () => {
    const fetch = qfApi([{ verse_key: "112:1", text: "word one" }]);
    const res = await call("/qapi/surah/112/ml.qf-7", {}, qfEnv());
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await call("/qapi/surah/112/ml.qf-7", {}, qfEnv());
    expect(fetch.mock.calls.filter(([url]) => url.startsWith(BASE))).toHaveLength(2);
    vi.restoreAllMocks();
    qfApi([]);
    expect((await call("/qapi/surah/112/ml.qf-8", {}, qfEnv())).status).toBe(404);
  });

  it("checks the surah, needs the API credentials, and leaves other editions to alquran.cloud", async () => {
    const fetch = qfApi();
    expect((await call("/qapi/surah/115/ta.qf-133", {}, qfEnv())).status).toBe(400);
    expect((await call("/qapi/surah/0/ta.qf-133", {}, qfEnv())).status).toBe(400);
    expect((await call("/qapi/surah/112/ta.qf-133")).status).toBe(503); // no QF_CLIENT_ID / QF_CLIENT_SECRET
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    const alquran = mockFetch(() => Response.json({ code: 200, data: { ayahs: [] } }));
    await call("/qapi/surah/112/ta.tamil", {}, qfEnv());
    expect(alquran.mock.calls[0][0]).toBe("https://api.alquran.cloud/v1/surah/112/ta.tamil");
  });

  it("qfText keeps the words and drops markup only", () => {
    expect(qfText("a<sup foot_note=1>1</sup>, b")).toBe("a, b");
    expect(qfText("<p>one</p><p>two</p>")).toBe("one two");
    expect(qfText("x &quot;y&quot; &#39;z&#39;")).toBe(`x "y" 'z'`);
  });
});
