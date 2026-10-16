import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUERY_TIMEOUT_MS } from "../src/lib/embed";
import { FLOOR, namesTopic, normalise, SEARCH_VERSION } from "../src/routes/search";
import { AYAHS_EN, BROKEN_DB, call, embeddings, luna, makeEnv, mockFetch, TOPICS } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const VERSION = TOPICS.version + SEARCH_VERSION;
const today = () => new Date().toISOString().slice(0, 10);
const lunaBodies = (spy: ReturnType<typeof mockFetch>) =>
  spy.mock.calls.filter(([u]) => String(u).includes("openrouter.ai/api/alpha/decisions")).map(([, init]) => JSON.parse(String(init!.body)));

describe("GET /api/search", () => {
  it("requires q", async () => {
    expect((await call("/api/search?q=%20")).status).toBe(400);
  });

  it("answers references directly, without AI", async () => {
    const e = makeEnv();
    const fetch = mockFetch(() => new Response("unexpected", { status: 500 }));
    const one = await (await call("/api/search?q=2:255&mode=full", {}, e)).json<any>();
    expect(one.results).toEqual([{ ref: "2:255", text: AYAHS_EN["2:255"] }]);
    const range = await (await call("/api/search?q=94%3A5-6", {}, e)).json<any>();
    expect(range.results.map((r: any) => r.ref)).toEqual(["94:5", "94:6"]);
    const clamped = await (await call("/api/search?q=94:7-20", {}, e)).json<any>();
    expect(clamped.results.map((r: any) => r.ref)).toEqual(["94:7", "94:8"]); // surah 94 has 8 ayahs here
    expect((await (await call("/api/search?q=115:1", {}, e)).json<any>()).results).toEqual([]);
    expect(embeddings).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fast: query embedding → vector top 10, no Luna", async () => {
    const e = makeEnv();
    const fetch = mockFetch(() => new Response("unexpected", { status: 500 }));
    const res = await (await call("/api/search?q=hope%20after%20hardship&mode=fast", {}, e)).json<any>();
    expect(res).toMatchObject({ mode: "fast", topic: null });
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
    expect(res.results[0].text).toBe(AYAHS_EN["94:6"]);
    expect(embeddings.mock.calls[0][0]).toEqual({
      model: "google/gemini-embedding-2", dimensions: 384, input: ["task: search result | query: Quran verses about hope after hardship"],
    });
    const v = e.AYAHS_INDEX.query.mock.calls[0][0] as number[];
    expect(v).toHaveLength(384);
    expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(e.AYAHS_INDEX.query.mock.calls[0][1]).toEqual({ topK: 16 }); // the rest say whether more pages exist and fill in for repeated texts
    expect(fetch).not.toHaveBeenCalled();
  });

  it("full: confident generic topic → precomputed list (router and kind calls only), cached, spend recorded", async () => {
    const e = makeEnv();
    const fetch = mockFetch(() => luna({ topic: { choice: "patience", probabilities: { patience: 0.9, hope: 0.05, other: 0.05 } }, generic: { noul: 1 } }, 0.0002));
    const res = await (await call("/api/search?q=Patience%3F&mode=full", {}, e)).json<any>();
    expect(res).toMatchObject({ q: "Patience?", mode: "full", topic: "patience" });
    expect(res.results.map((r: any) => r.ref)).toEqual(["2:153", "39:10", "3:200", "103:3"]);
    const router = lunaBodies(fetch).find((b) => b.questions.topic);
    expect(lunaBodies(fetch).map((b) => Object.keys(b.questions)[0]).sort()).toEqual(["kind", "topic"]); // no pick
    expect(router.model).toBe("openai/gpt-6-luna-decisions");
    expect(Object.keys(router.questions.topic.criteria)).toEqual(["patience", "hope", "other"]);

    const row = await env.DB.prepare("SELECT topic, hits FROM query_cache WHERE q = 'patience'").first<any>();
    expect(row).toEqual({ topic: "patience", hits: 0 });
    const usage = await env.DB.prepare("SELECT calls, cost_usd FROM luna_usage WHERE day = ?").bind(today()).first<any>();
    expect(usage.calls).toBeGreaterThanOrEqual(1);

    // Same query again (any mode, any spelling): served from the cache, no Luna.
    fetch.mockClear();
    const e2 = makeEnv();
    const again = await (await call("/api/search?q=%20PATIENCE%20&mode=fast", {}, e2)).json<any>();
    expect(again).toMatchObject({ q: "PATIENCE", mode: "full", topic: "patience" });
    expect(again.results).toEqual(res.results);
    expect(fetch).not.toHaveBeenCalled();
    expect(embeddings).toHaveBeenCalledTimes(1); // the first search only: the second is answered from this colo's cache
    expect((await env.DB.prepare("SELECT hits FROM query_cache WHERE q = 'patience'").first<any>()).hits).toBe(1);
  });

  it("full: specific query → union(the topic wording's 70, vector 30, topic 20) → Luna pick", async () => {
    const e = makeEnv();
    const fetch = mockFetch((_u, init) => {
      const body = JSON.parse(String(init!.body));
      // What the real router answers for this query: a confident topic, and "generic" (it says so for most short phrases).
      if (body.questions.topic) return luna({ topic: { choice: "hope", probabilities: { hope: 0.97, patience: 0.01 } }, generic: { noul: 1 } });
      if (body.questions.kind) return luna({ kind: { choice: "topic", probabilities: { topic: 0.9, feeling: 0.1 } } });
      return luna({ pick: { choice: "94:5", probabilities: { "94:5": 0.6, "94:6": 0.3, "2:155": 0.1 } } });
    });
    const res = await (await call("/api/search?q=hope%20after%20hardship&mode=full", {}, e)).json<any>();
    expect(res.topic).toBe("hope");
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:5", "94:6", "2:155"]);
    const rerank = lunaBodies(fetch).find((b) => b.questions.pick);
    expect(rerank.state).toBe('Someone typed this into a Quran search: "hope after hardship"');
    expect(rerank.questions.pick.instructions).toBe("Which verse best gives this person what they are looking for with this search?");
    expect(Object.keys(rerank.questions.pick.criteria)).toEqual(["94:6", "2:155", "94:5"]); // vector top 30 ∪ topic top 20, deduplicated
    expect(e.AYAHS_INDEX.query.mock.calls[0][1]).toEqual({ topK: 30 });
    expect(await env.DB.prepare("SELECT 1 FROM query_cache WHERE q = 'hope after hardship'").first()).not.toBeNull();
  });

  it("D1 cache without an edge copy: full answers from D1 and fills the edge cache; fast never waits on D1", async () => {
    const stored = { q: "d1 only", mode: "full", topic: "hope", results: [{ ref: "94:5", text: AYAHS_EN["94:5"] }] };
    await env.DB.prepare("INSERT INTO query_cache (q, topic, result, created_at, version) VALUES ('d1 only', 'hope', ?, ?, ?)")
      .bind(JSON.stringify(stored), Date.now(), VERSION).run();
    mockFetch(() => new Response("unexpected", { status: 500 }));
    const fast = await (await call("/api/search?q=D1%20only&mode=fast")).json<any>();
    expect(fast.mode).toBe("fast"); // vector results; D1 is ~0.4 s away from some colos
    const full = await (await call("/api/search?q=D1%20only&mode=full")).json<any>();
    expect(full).toEqual({ ...stored, q: "D1 only" });
    const e = makeEnv();
    const prepare = vi.spyOn(e.DB, "prepare");
    const again = await (await call("/api/search?q=d1%20only&mode=fast", {}, e)).json<any>();
    expect(again.mode).toBe("full");
    // Only the hit counter (the counter buffer, written after the response); no cache lookup.
    expect(prepare.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes("query_cache"))).toEqual(["UPDATE query_cache SET hits = hits + ?2 WHERE q = ?1"]);
    expect((await env.DB.prepare("SELECT hits FROM query_cache WHERE q = 'd1 only'").first<any>()).hits).toBe(2);
  });

  it("D1 cache rows from another topics.json build or older than 30 days are misses", async () => {
    const stored = (q: string) => JSON.stringify({ q, mode: "full", topic: "hope", results: [{ ref: "15:3", text: "stale" }] });
    const row = env.DB.prepare("INSERT INTO query_cache (q, topic, result, created_at, version) VALUES (?, 'hope', ?, ?, ?)");
    await env.DB.batch([
      row.bind("old build", stored("old build"), Date.now(), "2026-01-01"),
      row.bind("old row", stored("old row"), Date.now() - 31 * 86400_000, VERSION),
    ]);
    mockFetch(() => new Response("unexpected", { status: 500 }));
    for (const q of ["old build", "old row"]) {
      const res = await (await call(`/api/search?q=${encodeURIComponent(q)}&mode=full`)).json<any>();
      expect(res.results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]); // embedding order, not the stored row
    }
  });

  it("full: a failed embedding still routes and reranks the topic list, but the result is not cached", async () => {
    const e = makeEnv();
    embeddings.mockResolvedValue(new Response("quota", { status: 429 }));
    mockFetch((_u, init) => {
      const body = JSON.parse(String(init!.body));
      if (body.questions.topic) return luna({ topic: { probabilities: { hope: 0.97 } }, generic: { noul: 1 } });
      return luna({ pick: { probabilities: { "94:6": 0.7, "94:5": 0.3 } } });
    });
    const res = await call("/api/search?q=ease%20after%20difficulty%20please&mode=full", {}, e);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).results.map((r: any) => r.ref)).toEqual(["94:6", "94:5"]);
    expect(await env.DB.prepare("SELECT 1 FROM query_cache WHERE q = 'ease after difficulty please'").first()).toBeNull();
  });

  it("full: over this client's LUNA_LIMITER → embedding order, no Luna call, not cached", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const e = { ...makeEnv(), LUNA_LIMITER: { limit } } as unknown as Env;
    const fetch = mockFetch(() => luna({}));
    const res = await (await call("/api/search?q=limited%20client&mode=full", { headers: { "CF-Connecting-IP": "2001:db8:5:6::9" } }, e)).json<any>();
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
    expect(fetch).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith({ key: "LUNA_LIMITER:2001:db8:5:6::/64" });
    expect(await env.DB.prepare("SELECT 1 FROM query_cache WHERE q = 'limited client'").first()).toBeNull();
    // Answers that need no Luna do not count: references and cached queries never reach the limiter.
    limit.mockClear();
    await call("/api/search?q=2:255&mode=full", {}, e);
    expect(limit).not.toHaveBeenCalled();
  });

  it("full: D1 failing (quota used up) → embedding order instead of a 500", async () => {
    const e = { ...makeEnv(), DB: BROKEN_DB } as Env;
    const fetch = mockFetch(() => luna({}));
    const res = await call("/api/search?q=d1%20is%20down&mode=full", {}, e);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
    expect(fetch).not.toHaveBeenCalled(); // the spend cap cannot be checked, so no Luna
  });

  it("full: Luna timeout → embedding order, not cached", async () => {
    const e = { ...makeEnv(), LUNA_TIMEOUT_MS: "50", INTENT_TIMEOUT_MS: "50" } as ReturnType<typeof makeEnv>;
    mockFetch((_u, init) => new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))));
    const t0 = Date.now();
    const res = await (await call("/api/search?q=slow%20luna&mode=full", {}, e)).json<any>();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res).toMatchObject({ mode: "full", topic: null });
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
    expect(await env.DB.prepare("SELECT 1 FROM query_cache WHERE q = 'slow luna'").first()).toBeNull();
  });

  it("full: Luna HTTP error → embedding order", async () => {
    mockFetch(() => new Response("rate limited", { status: 429 }));
    const res = await (await call("/api/search?q=luna%20error&mode=full")).json<any>();
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
  });

  it("full: above the daily spend cap or the daily call cap → no Luna call", async () => {
    const fetch = mockFetch(() => luna({}));
    // The call cap also holds when the replies carry no cost.
    for (const [calls, cost] of [[1, 5], [6000, 0]]) {
      await env.DB.prepare("INSERT OR REPLACE INTO luna_usage (day, calls, input_tokens, cost_usd) VALUES (?, ?, 1, ?)").bind(today(), calls, cost).run();
      const res = await (await call(`/api/search?q=over%20cap%20${calls}&mode=full`)).json<any>();
      expect(res.results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
    }
    expect(fetch).not.toHaveBeenCalled();
    await env.DB.prepare("DELETE FROM luna_usage").run();
  });

  it("a failed embedding with nothing else to show → 503 (try again), never an empty result, and nothing is cached", async () => {
    embeddings.mockRejectedValueOnce(new Error("network down"));
    const res = await call("/api/search?q=anything&mode=fast");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(await res.json<any>()).toEqual({ error: "search unavailable, try again" });
    // An embedding reply that is not a list of vectors, or a slow one, is an error too.
    embeddings.mockResolvedValueOnce(Response.json({ error: { message: "upstream" } }));
    expect((await call("/api/search?q=anything%20else&mode=fast")).status).toBe(503);
    // Full mode without Luna (here: the router has no answer) has nothing else to show either.
    embeddings.mockResolvedValueOnce(new Response("quota", { status: 429 }));
    mockFetch(() => new Response("rate limited", { status: 429 }));
    expect((await call("/api/search?q=cold%20start&mode=full")).status).toBe(503);
    expect(await env.DB.prepare("SELECT 1 FROM query_cache WHERE q = 'cold start'").first()).toBeNull();
    // The next try works: the failure was not kept as an empty answer.
    const again = await call("/api/search?q=anything&mode=fast");
    expect(again.status).toBe(200);
    expect((await again.json<any>()).results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
    const full = await call("/api/search?q=cold%20start&mode=full");
    expect(full.status).toBe(200);
    expect((await full.json<any>()).results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
  });

  it("query vectors are cached per colo by normalised query, and sent with a 5 s timeout", async () => {
    expect(QUERY_TIMEOUT_MS).toBe(5000); // 2 s left a cold first search empty
    const spy = vi.spyOn(globalThis, "fetch");
    await call("/api/search?q=Light%20upon%20light&mode=fast");
    expect((spy.mock.calls.at(-1)![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    const e = makeEnv();
    const res = await (await call("/api/search?q=light%20UPON%20light!&mode=fast", {}, e)).json<any>();
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:6", "2:155", "94:5"]);
    expect(embeddings).toHaveBeenCalledTimes(1);
    expect(e.AYAHS_INDEX.query.mock.calls[0][0]).toHaveLength(384);
  });
});

describe("GET /api/search pages", () => {
  /** An index whose matches for any query are 2:1, 2:2, ... with these scores (best first). */
  const scored = (scores: number[], ids = scores.map((_, i) => `2:${i + 1}`)) => {
    const e = makeEnv();
    const matches = scores.map((score, i) => ({ id: ids[i], score }));
    e.AYAHS_INDEX.query.mockImplementation(async (_v: number[], o: { topK: number }) => ({ matches: matches.slice(0, o.topK) }));
    return e;
  };
  const refs = (res: any) => res.results.map((r: any) => r.ref);
  const page = async (q: string, n: number, e: Env) => (await call(`/api/search?q=${encodeURIComponent(q)}&page=${n}`, {}, e)).json<any>();

  it("a broad query: page 1 as before, then pages of 10 in embedding order above the floor, up to 60 in all", async () => {
    const e = scored(Array.from({ length: 90 }, (_, i) => 0.9 - i / 1000)); // all well above the floor
    const fetch = mockFetch(() => new Response("unexpected", { status: 500 }));
    const first = await (await call("/api/search?q=broad%20query&mode=fast", {}, e)).json<any>();
    expect(refs(first)).toEqual(Array.from({ length: 10 }, (_, i) => `2:${i + 1}`));
    expect(first).toMatchObject({ more: true, next: 2 });
    const seen = [...refs(first)];
    let res = first;
    for (let n = 2; res.more; n++) {
      res = await page("broad query", res.next, e);
      expect(res.results.length).toBe(10);
      seen.push(...refs(res));
      if (n === 2) expect(e.AYAHS_INDEX.query.mock.calls.at(-1)![1]).toEqual({ topK: 60 });
    }
    expect(res.next).toBeUndefined();
    expect(seen).toEqual(Array.from({ length: 60 }, (_, i) => `2:${i + 1}`)); // the cap, in order, nothing twice
    expect(refs(await page("broad query", 7, e))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled(); // no Luna for pages
  });

  it("the floor: only ayahs scoring at least FLOOR come after page 1, so a weak query has no more pages", async () => {
    expect(FLOOR).toBe(0.77);
    // 14 above the floor: page 1 shows 10, page 2 the other 4 and says there is nothing after it.
    const some = scored([...Array.from({ length: 14 }, (_, i) => 0.85 - i / 200), 0.769, 0.76, 0.75]);
    const first = await (await call("/api/search?q=some%20more&mode=fast", {}, some)).json<any>();
    expect(first).toMatchObject({ more: true, next: 2 });
    const second = await page("some more", 2, some);
    expect(refs(second)).toEqual(["2:11", "2:12", "2:13", "2:14"]);
    expect(second.more).toBe(false);
    expect(second.next).toBeUndefined();

    // Off-topic: every match below the floor. Page 1 still shows its 10 (as before), but there is no page 2.
    const weak = scored(Array.from({ length: 60 }, (_, i) => 0.765 - i / 1000));
    const res = await (await call("/api/search?q=pizza%20recipe&mode=fast", {}, weak)).json<any>();
    expect(res.results).toHaveLength(10);
    expect(res.more).toBe(false);
    expect(res.next).toBeUndefined();
    expect(refs(await page("pizza recipe", 2, weak))).toEqual([]);
    // Exactly 10 above the floor: the 11th match (fast asks for one more) says page 1 is all there is.
    const ten = scored([...Array.from({ length: 10 }, () => 0.8), 0.76]);
    expect((await (await call("/api/search?q=just%20ten&mode=fast", {}, ten)).json<any>()).more).toBe(false);
  });

  it("pages leave out the refined page 1 in this colo's cache, and each page is cached under its own key", async () => {
    // The query names a topic: page 1 is the topic's list; the vector matches start with two of its ayahs.
    const ids = ["39:10", "2:153", ...Array.from({ length: 20 }, (_, i) => `2:${i + 1}`)];
    const e = scored(ids.map((_, i) => 0.9 - i / 1000), ids);
    mockFetch(() => luna({ topic: { probabilities: { patience: 0.9 } }, generic: { noul: 1 } }));
    const first = await (await call("/api/search?q=Topic%20pages&mode=full", {}, e)).json<any>();
    expect(refs(first)).toEqual(["2:153", "39:10", "3:200", "103:3"]);
    expect(first).toMatchObject({ topic: "patience", more: true, next: 2 });

    const fetch = mockFetch(() => new Response("unexpected", { status: 500 }));
    const second = await page("topic PAGES", 2, e);
    expect(refs(second)).toEqual(Array.from({ length: 10 }, (_, i) => `2:${i + 1}`)); // not 39:10 or 2:153 again
    expect(second).toMatchObject({ topic: "patience", more: true, next: 3 });
    const third = await page("topic pages", 3, e);
    expect(refs(third)).toEqual(Array.from({ length: 10 }, (_, i) => `2:${i + 11}`));
    expect(third.more).toBe(false);
    expect(fetch).not.toHaveBeenCalled();

    const key = (p?: number) => `http://localhost/api/_cache/search?v=${encodeURIComponent(VERSION)}&q=topic%20pages${p ? `&p=${p}` : ""}`;
    expect(refs(await (await caches.default.match(key(2)))!.json())).toEqual(refs(second));
    expect(refs(await (await caches.default.match(key(3)))!.json())).toEqual(refs(third));
    expect(refs(await (await caches.default.match(key()))!.json())).toEqual(refs(first)); // page 1 unchanged
    // Asked again: from the cache, without the query vector or the index.
    const e2 = makeEnv();
    const again = await page("Topic pages", 2, e2);
    expect(again).toEqual({ ...second, q: "Topic pages" });
    expect(e2.AYAHS_INDEX.query).not.toHaveBeenCalled();
    expect(embeddings).toHaveBeenCalledTimes(1); // the first search only; its vector is cached in this colo
  });

  it("old clients are unaffected: page 1 keeps its fields and results; references have no pages; rate limits still apply", async () => {
    const res = await (await call("/api/search?q=old%20client&mode=fast")).json<any>();
    expect(res).toEqual({
      q: "old client", mode: "fast", topic: null, more: false,
      results: ["94:6", "2:155", "94:5"].map((ref) => ({ ref, text: AYAHS_EN[ref] })),
    });
    const ref = await (await call("/api/search?q=2:255")).json<any>();
    expect(Object.keys(ref).sort()).toEqual(["mode", "q", "results", "topic"]);
    expect((await (await call("/api/search?q=2:255&page=2")).json<any>()).results).toEqual([]);
    // A full page cached before results had pages may have more: page 2 finds out.
    const ten = Array.from({ length: 10 }, (_, i) => ({ ref: `2:${i + 1}`, text: "" }));
    await env.DB.prepare("INSERT INTO query_cache (q, topic, result, created_at, version) VALUES ('before pages', null, ?, ?, ?)")
      .bind(JSON.stringify({ q: "before pages", mode: "full", topic: null, results: ten }), Date.now(), VERSION).run();
    expect(await (await call("/api/search?q=before%20pages&mode=full")).json<any>()).toMatchObject({ results: ten, more: true, next: 2 });
    const limited = { ...makeEnv(), SEARCH_LIMITER: { limit: async () => ({ success: false }) } } as unknown as Env;
    expect((await call("/api/search?q=anything&page=2", {}, limited)).status).toBe(429);
  });
});

describe("kinds of search (owner, 15 Oct 2026)", () => {
  const CHAT = "https://openrouter.ai/api/v1/chat/completions";
  const DESC = "Verses that tell a grieving person that with hardship comes ease.";
  /** Luna answers as for a search of `kind`; the intent model answers DESC (or `chatStatus`). */
  const as = (kind: string, { surah = "", chatStatus = 200 } = {}) => mockFetch((u, init) => {
    if (u === CHAT) {
      return chatStatus === 200 ? Response.json({ choices: [{ message: { content: ` ${DESC} ` } }], usage: { prompt_tokens: 120, cost: 0.00005 } })
        : new Response("down", { status: chatStatus });
    }
    const b = JSON.parse(String(init!.body));
    if (b.questions.kind) return luna({ kind: { choice: kind, probabilities: { [kind]: 0.95, topic: 0.05 } } });
    if (b.questions.surah) return luna({ surah: { choice: surah, probabilities: { [surah]: 0.99 } } });
    if (b.questions.topic) return luna({ topic: { probabilities: { other: 0.9 } }, generic: { noul: 0 } });
    return luna({ pick: { probabilities: { "94:5": 0.8, "2:155": 0.15, "94:6": 0.05 } } });
  });
  const bodies = (fetch: ReturnType<typeof mockFetch>, url: string) =>
    fetch.mock.calls.filter(([u]) => u === url).map(([, i]) => JSON.parse(String(i!.body)));

  it("a feeling: the intent step says what the person is after; that is searched and the pick sees it; cached", async () => {
    const e = makeEnv();
    const fetch = as("feeling");
    const res = await (await call("/api/search?q=I%20am%20sad&mode=full", {}, e)).json<any>();
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:5", "2:155", "94:6"]);
    const [chat] = bodies(fetch, CHAT);
    expect(chat).toMatchObject({ model: "anthropic/claude-haiku-5.5", reasoning: { enabled: false } });
    expect(chat.messages[1]).toEqual({ role: "user", content: "I am sad" });
    expect(embeddings.mock.calls.map(([b]) => b.input[0])).toContain(`title: none | text: ${DESC}`);
    expect(e.AYAHS_INDEX.query.mock.calls.map(([, o]) => o.topK)).toContain(70);
    const pick = lunaBodies(fetch).find((b) => b.questions.pick);
    expect(pick.state).toBe(`Someone typed this into a Quran search: "I am sad"\nWhat they are looking for: ${DESC}`);
    expect(await env.DB.prepare("SELECT 1 FROM query_cache WHERE q = 'i am sad' AND version = ?").bind(VERSION).first()).not.toBeNull();
  });

  it("a story (and topic, question, dua): its own wording; the intent step (started alongside) is not used", async () => {
    const fetch = as("story");
    await call("/api/search?q=Musa&mode=full");
    expect(bodies(fetch, CHAT)).toHaveLength(1);
    expect(embeddings.mock.calls.map(([b]) => b.input[0])).not.toContain(`title: none | text: ${DESC}`);
    expect(lunaBodies(fetch).find((b) => b.questions.pick).state).toBe('Someone typed this into a Quran search: "Musa"');
    expect(embeddings.mock.calls.map(([b]) => b.input[0])).toContain("task: search result | query: Quran verses that tell the story of Musa");
  });

  it("a surah's name → that surah from its first ayah, no pick", async () => {
    const fetch = as("surah", { surah: "36" });
    const res = await (await call("/api/search?q=surah%20yaseen&mode=full")).json<any>();
    expect(res.results.map((r: any) => r.ref)).toEqual(Array.from({ length: 10 }, (_, i) => `36:${i + 1}`));
    const surah = lunaBodies(fetch).find((b) => b.questions.surah);
    expect(Object.keys(surah.questions.surah.criteria)).toHaveLength(115); // 114 and "other"
    expect(lunaBodies(fetch).some((b) => b.questions.pick)).toBe(false);
  });

  it("the intent step failing: still a picked result, but not cached", async () => {
    as("situation", { chatStatus: 500 });
    const res = await (await call("/api/search?q=lost%20my%20job&mode=full")).json<any>();
    expect(res.results.map((r: any) => r.ref)).toEqual(["94:5", "2:155", "94:6"]);
    expect(await env.DB.prepare("SELECT 1 FROM query_cache WHERE q = 'lost my job'").first()).toBeNull();
  });
});

describe("namesTopic", () => {
  it("is a plain topic name: one or two words, or the topic's label or id", () => {
    const trust = { id: "trust-in-allah", label: "trust in Allah", refs: [] };
    expect(namesTopic("patience", trust)).toBe(true);
    expect(namesTopic("بر الوالدين", trust)).toBe(true);
    expect(namesTopic("trust in allah", trust)).toBe(true);
    expect(namesTopic(normalise("Allah's mercy"), { id: "mercy", label: "Allah's mercy", refs: [] })).toBe(true);
    expect(namesTopic("hope after hardship", trust)).toBe(false);
    expect(namesTopic("ayat al kursi", { id: "throne", label: "the Throne of Allah", refs: [] })).toBe(false);
  });
});

describe("normalise", () => {
  it("folds case, width, punctuation and spaces", () => {
    expect(normalise("  Hope,  after\thardship?! ")).toBe("hope after hardship");
    expect(normalise("ക്ഷമ")).toBe("ക്ഷമ");
    expect(normalise("ＡＢＣ")).toBe("abc");
  });
});
