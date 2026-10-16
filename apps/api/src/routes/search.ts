// GET /api/search?q=...&mode=fast|full.
//   "2:255" / "94:5-6"  → those ayahs, no AI.
//   cached query        → the stored full result: this colo's cache, else D1 query_cache (full mode only), keyed by the
//                         normalised query and the topics.json build, and used for at most CACHE_DAYS.
//   fast                → query embedding → AYAHS_INDEX top 10 (a few more, for `more` and repeated texts; never waits
//                         on D1).
//   full                → Luna kind of search ∥ Luna topic router ∥ vector top 30 (owner, 15 Oct 2026: a search should
//                         find what the person is after, not their words). A surah's name → that surah from its first
//                         ayah. A plain topic name (confident topic, one or two words or the topic's label) → its
//                         precomputed list. Otherwise the kind's own wording (topic, question, story, dua), or for a
//                         feeling, a situation, a remembered verse and anything else what the person is after
//                         (lib/intent.ts), embedded → top 70; union(that, vector 30, topic 20) → Luna pick "what this
//                         person is looking for" → top 10 → cached.
//   page ≥ 2           → the next K of up to CAP results: embedding order above FLOOR, without the ayahs of page 1, no
//                         Luna (kept in this colo's cache once page 1 is). Page 1 says `more` / `next` when they exist.
// Ayahs that repeat word for word (55:13 thirty-one times) are shown once. Every Luna step falls back to embedding order (timeout, error, spend or call cap, LUNA_LIMITER, data files not
// published yet), and a failed embedding (OpenRouter error, or no answer within 5 s, lib/embed QUERY_TIMEOUT_MS) leaves
// the topic list and the rerank; such a result is not cached. A failed embedding with nothing else to show answers
// 503 (never an empty result that looks like "nothing found"); the app tries again. D1 errors count as a cache miss and
// as no Luna, never as a 500.
import { Hono } from "hono";
import type { AyahsEn, Ref, SearchResponse, Surah, Topic, TopicsFile } from "../../../../contracts/types";
import { increment } from "../lib/counters";
import { readData } from "../lib/data";
import { cacheUrl, normalise, putJson } from "../lib/edge";
import { queryVector } from "../lib/embed";
import { rateLimit, withinLimit } from "../lib/http";
import { describeIntent } from "../lib/intent";
import { decide, lunaAllowed, ranked, type Answer } from "../lib/luna";

const K = 10;
const CAP = 60; // most results a search shows over all its pages: page 1 and five more of K
/** Confidence floor for the ayahs after page 1: cosine similarity of the query and the ayah in AYAHS_INDEX. Derived on
 *  2026-10-08 from the index's own vectors (pipeline/out/ayah_index_vectors.npy) and real query vectors (the 66 queries
 *  of pipeline/eval/search_eval.json and 20 probes), labelled with Luna's per-topic relevance scores of the topic build
 *  (pipeline/cache/luna/a3_topics), over ranks 11-100:
 *    similarity                  < 0.75   0.75-0.76   0.76-0.77   0.77-0.78   >= 0.78
 *    "related to it" or better      9 %        12 %        21 %        35 %       40 %
 *  Scores are compressed (the median ayah scores 0.66-0.74 for every query, gibberish too), so up to 0.76 is noise; at
 *  0.77 relevant ayahs are three to four times as common, and 79 % of those Luna scored there are related. Off-topic
 *  queries ("football", "car insurance", "bitcoin price", "pizza recipe") have their best ayah at 0.75-0.77, so they
 *  get nothing after page 1, while "Quran", "mercy" and "paradise" fill the cap, "patience" has 45 above it, "prayer" 46,
 *  and specific queries 5-30. Re-derive when EMBED_MODEL, EMBED_DIM or the ayah documents change. */
export const FLOOR = 0.77;
const REFERENCE = /^(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/;
const TOPIC_MIN = 0.6; // router probability for answering with a topic's precomputed list
const GENERIC_MIN = 0.5; // ... and the router must call the query a plain topic, not a specific idea within it
const TOPIC_HINT_MIN = 0.2; // topic candidates still join the rerank pool above this
const MAX_CHOICES = 150; // a Luna choice question takes at most 255 options, so ~300 topics go out as two requests
const EDGE_TTL = 86400; // seconds a full result stays in a colo's cache
export const CACHE_DAYS = 30; // days a full result in D1 is used (rows are pruned nightly after that, src/rollup.ts)
/** Added to the topics.json build in the cache keys: a new way of searching starts a fresh cache. */
export const SEARCH_VERSION = "+kinds2";
const KIND_TOP = 70; // the kind's own query's share of the pick's options
const POOL = 100; // options for the final Luna pick (a choice question takes at most 255)
const KIND_TIMEOUT_MS = 2500;

/** The kinds of search (owner, 15 Oct 2026), for Luna to tell apart. */
export const KINDS = {
  topic: "A subject, word, practice or theme to find verses on (e.g. patience, interest, hijab, charity, Allah's mercy, Ramadan)",
  feeling: "The person's own feeling or state of mind (e.g. I am sad, I feel lonely, I am afraid, hopeless)",
  situation: "Something happening in the person's life or a loved one's (e.g. lost my job, my mother died, my friend is sick, I am in debt)",
  question: "A question about belief, a ruling, or the unseen (e.g. is music haram, what happens after death, how to pray)",
  story: "The story of a prophet, person, people or event (e.g. Musa and Pharaoh, Yusuf, Maryam)",
  dua: "A supplication or verses to recite for a need (e.g. dua for rain, before travelling, for parents, protection)",
  verse: "A particular verse the person remembers by its name, words, Arabic or transliteration (e.g. ayat al kursi, inna ma'al usri yusra, fabi ayyi ala i rabbikuma)",
  surah: "A surah by its name (e.g. Surah Yaseen, al Mulk, Kahf)",
  other: "None of these, or not about the Quran",
};
export type Kind = keyof typeof KINDS;
/** How each of these kinds is put to the embedding; the others go through the intent step. */
const WORDING: Partial<Record<Kind, (q: string) => string>> = {
  topic: (q) => `Quran verses about ${q}`,
  question: (q) => `Quran verses that answer: ${q}`,
  story: (q) => `Quran verses that tell the story of ${q}`,
  dua: (q) => `Quran supplications and verses to recite for ${q}`,
};

export const search = new Hono<{ Bindings: Env }>();

search.get("/", rateLimit("SEARCH_LIMITER", 300), async (c) => {
  const env = c.env;
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const mode = c.req.query("mode") === "full" ? "full" : "fast";
  const page = Math.max(1, Math.trunc(Number(c.req.query("page"))) || 1);
  if (!q) return c.json({ error: "q is required" }, 400);

  const ayahsEn = await readData<AyahsEn>(env, "ayahs-en.json");
  const text = (ref: Ref) => ayahsEn?.[ref] ?? "";
  const results = (refs: Ref[]) => refs.map((ref) => ({ ref, text: text(ref) }));
  /** Each text once, as its first ayah in the Quran (55:13 for the 31 of 55:13; `seen`: texts already shown). */
  const unique = (refs: Ref[], seen = new Set<string>()) => {
    const first = ayahsEn ? firstAyahs(ayahsEn) : null;
    return refs.flatMap((ref) => {
      const t = normalise(text(ref)) || ref;
      return seen.has(t) || !seen.add(t) ? [] : [first?.get(t) ?? ref];
    });
  };
  /** Page 1: the first K of `refs`. With `matches` (the query's vector matches; null when the embedding failed), also
   *  whether later pages have ayahs; without them only a full page 1 offers more, and page 2 finds out. */
  const body = (refs: Ref[], topic: string | null = null, matches?: Match[] | null): SearchResponse => {
    const first = unique(refs).slice(0, K);
    if (matches === undefined) return { q, mode, topic, results: results(first) };
    const more = matches ? matches.some((m) => m.score >= FLOOR && !first.includes(m.ref)) : first.length === K;
    return { q, mode, topic, results: results(first), more, ...(more && { next: 2 }) };
  };

  const reference = q.match(REFERENCE);
  if (reference) return c.json(body(page > 1 ? [] : await referenceRefs(env, +reference[1], +reference[2], +(reference[3] ?? reference[2]))));

  const key = normalise(q);
  const topics = await readData<TopicsFile>(env, "topics.json");
  const version = (topics?.version ?? "") + SEARCH_VERSION; // a rebuilt topics.json starts a fresh cache
  const edgeKey = cacheUrl(c.req.url, `search?v=${encodeURIComponent(version)}&q=${encodeURIComponent(key)}`);
  // No query vector and nothing else to show: not "nothing found", so the app tries again instead of saying so.
  const unavailable = () => c.json({ error: "search unavailable, try again" }, 503, { "Retry-After": "1" });
  if (page > 1) {
    if (page > CAP / K) return c.json({ ...body([]), more: false });
    const pageKey = `${edgeKey}&p=${page}`;
    const kept = await caches.default.match(pageKey);
    if (kept) return c.json({ ...(await kept.json<SearchResponse>()), q, mode });
    // Page 1 is the full result in this colo's cache (it was answered just before, and stored unless Luna was not
    // used), else the embedding top K, which is also what full answers without Luna.
    const [first, matches] = await Promise.all([
      caches.default.match(edgeKey).then((r) => (r ? r.json<SearchResponse>() : null)),
      vectorMatches(env, c.req.url, q, CAP),
    ]);
    if (!matches) return unavailable();
    const shown = first ? first.results.map((r) => r.ref) : matches.slice(0, K).map((m) => m.ref);
    const rest = unique(matches.filter((m) => m.score >= FLOOR && !shown.includes(m.ref)).map((m) => m.ref), new Set(shown.map((r) => normalise(text(r)) || r)))
      .slice(0, CAP - K);
    const more = rest.length > (page - 1) * K;
    const result: SearchResponse = {
      q, mode, topic: first?.topic ?? null, results: results(rest.slice((page - 2) * K, (page - 1) * K)), more, ...(more && { next: page + 1 }),
    };
    // Kept only after page 1 was: until then a refined page 1 with other ayahs may still be on its way to the cache.
    if (first) c.executionCtx.waitUntil(putJson(pageKey, EDGE_TTL, result));
    return c.json(result);
  }
  const countHit = () => c.executionCtx.waitUntil(increment(env, "hits", key));
  const edge = await caches.default.match(edgeKey); // a few ms
  if (edge) {
    countHit();
    return c.json({ ...stored(await edge.json<SearchResponse>()), q });
  }
  // The query embedding (OpenRouter, cached per colo) runs alongside the D1 lookup instead of after it. Fast asks for
  // a few more than it shows: they say whether more pages exist, and fill in for repeated texts.
  const vector = vectorMatches(env, c.req.url, q, mode === "fast" ? K + 6 : 30);
  if (mode === "fast") {
    const matches = await vector;
    return matches ? c.json(body(matches.map((m) => m.ref), null, matches)) : unavailable();
  }

  const [cached, allowed] = await Promise.all([
    env.DB.prepare("SELECT result FROM query_cache WHERE q = ? AND version = ? AND created_at > ?")
      .bind(key, version, Date.now() - CACHE_DAYS * 86400_000).first<{ result: string }>().catch(() => null),
    lunaAllowed(env).catch(() => false),
  ]);
  if (cached) {
    countHit();
    const result = stored(JSON.parse(cached.result) as SearchResponse);
    c.executionCtx.waitUntil(putJson(edgeKey, EDGE_TTL, result));
    return c.json({ ...result, q });
  }
  // Only searches about to call Luna count towards this client's LUNA_LIMITER; above it they get the embedding order.
  const luna = allowed && (await withinLimit(c, "LUNA_LIMITER", 20));

  // The AI steps share one time budget: Luna's, and the intent step's when it runs.
  const started = Date.now();
  // The intent step starts with the kind's question (owner, 15 Oct 2026: ~0.7 s sooner); its answer is used only for the
  // kinds that need it.
  const intent = luna && ayahsEn ? describeIntent(env, c.executionCtx, c.req.url, q) : Promise.resolve(null);
  c.executionCtx.waitUntil(intent); // an answer not waited for still finishes (and is cached for the next search)
  const [matches, routed, kind] = await Promise.all([
    vector,
    luna && topics ? route(env, c.executionCtx, q, topics.topics) : null,
    luna && ayahsEn ? kindOf(env, c.executionCtx, q) : null, // without the ayahs' texts there is no pick either
  ]);
  const vec = matches?.map((m) => m.ref) ?? null;
  const p = routed?.p ?? 0;
  const topic = routed && p >= TOPIC_HINT_MIN ? routed.topic : null;

  const reply = (result: SearchResponse, store: boolean) => {
    if (store) {
      c.executionCtx.waitUntil(Promise.all([
        env.DB.prepare("INSERT OR REPLACE INTO query_cache (q, topic, result, created_at, version) VALUES (?, ?, ?, ?, ?)")
          .bind(key, result.topic, JSON.stringify(result), Date.now(), version).run(),
        putJson(edgeKey, EDGE_TTL, result),
      ]).catch((e) => console.warn("search cache write failed:", String(e))));
    }
    return c.json(result);
  };
  if (kind === "surah") {
    const surahs = await readData<Surah[]>(env, "surahs.json");
    const n = surahs ? await surahOf(env, c.executionCtx, q, surahs) : null;
    if (n) return reply(body(Array.from({ length: Math.min(K, surahs![n - 1].ayahs) }, (_, i) => `${n}:${i + 1}`)), true);
  }
  // The router calls almost any short phrase generic ("hope after hardship", "ayat al kursi"), so the precomputed list
  // also needs a query that is no more than a topic's name.
  if ((!kind || kind === "topic") && topic && p >= TOPIC_MIN && (routed?.generic ?? 0) >= GENERIC_MIN && namesTopic(key, topic)) {
    return reply(body(topic.refs, topic.id, matches), true);
  }

  // What the person is after: the kind's own wording, else (a feeling, a situation, a remembered verse, anything else)
  // the intent step's description of the verses that would answer them.
  const wording = kind ? WORDING[kind] : undefined;
  const desc = kind && !wording ? await intent : null;
  const meant = wording ? await refsFor(env, c.req.url, wording(q), "query_text") : desc ? await refsFor(env, c.req.url, desc, "document") : null;

  // A topic list holds the verses most about a topic ("grief": the verses that mention grief), not the ones that answer a
  // feeling or a situation, so it joins only the other kinds.
  const listed = !kind || wording ? topic?.refs.slice(0, 20) ?? [] : [];
  const pool = [...new Set([...(meant ?? []), ...(vec ?? []), ...listed])].slice(0, POOL);
  if (!vec && !pool.length) return unavailable();
  const left = started + (Number(env.LUNA_TIMEOUT_MS) || 4000) + (kind && !wording ? Number(env.INTENT_TIMEOUT_MS) || 5000 : 0) - Date.now();
  if (!luna || !ayahsEn || pool.length < 2 || left < 300) return c.json(body(pool, topic?.id ?? null, matches));
  const answers = await decide(env, c.executionCtx, `Someone typed this into a Quran search: "${q}"${desc ? `\nWhat they are looking for: ${desc}` : ""}`, {
    pick: {
      type: "choice",
      instructions: "Which verse best gives this person what they are looking for with this search?",
      criteria: Object.fromEntries(pool.map((ref) => [ref, text(ref).slice(0, 200)])),
    },
  }, left);
  const order = ranked(answers?.pick, pool);
  // Without the vector candidates (failed embedding) or what the person is after, the result is worse than usual, so it
  // is not stored.
  return order ? reply(body(order, topic?.id ?? null, matches), vec !== null && meant !== null) : c.json(body(pool, topic?.id ?? null, matches));
});

const firsts = new WeakMap<AyahsEn, Map<string, Ref>>();
/** Normalised text → the first ayah with it (ayahs-en.json is in Quran order), once per data file. */
function firstAyahs(ayahs: AyahsEn): Map<string, Ref> {
  let m = firsts.get(ayahs);
  if (!m) {
    m = new Map();
    for (const [ref, t] of Object.entries(ayahs)) if (!m.has(normalise(t))) m.set(normalise(t), ref);
    firsts.set(ayahs, m);
  }
  return m;
}

/** A cached result stored before results had pages: a full page 1 may have more (page 2 finds out). */
const stored = (r: SearchResponse): SearchResponse => (r.more === undefined && r.results.length === K ? { ...r, more: true, next: 2 } : r);

/** The query is no more than the topic's name: one or two words, or the topic's label or id. */
export const namesTopic = (key: string, topic: Topic) =>
  key.split(" ").length <= 2 || key === normalise(topic.label) || key === normalise(topic.id);

/** Luna topic router. The topics are split over parallel requests that each also offer "other"; the highest
 *  non-"other" probability wins. The first request also asks whether the query is just a topic name. */
async function route(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, q: string, topics: Topic[]) {
  const size = Math.ceil(topics.length / Math.ceil(topics.length / MAX_CHOICES));
  const groups = Array.from({ length: Math.ceil(topics.length / size) }, (_, i) => topics.slice(i * size, (i + 1) * size));
  const answers = await Promise.all(groups.map((group, i) =>
    decide(env, ctx, `Search query: ${q}`, {
      topic: {
        type: "choice",
        instructions: "Which topic is this Quran search query about? The query may be in any language.",
        criteria: { ...Object.fromEntries(group.map((t) => [t.id, t.label])), other: "None of these topics" },
      },
      ...(i === 0 && {
        generic: {
          type: "noul" as const,
          instructions: "Is the query simply a topic name (one word or a short general phrase) rather than a specific situation, question or idea within a topic?",
        },
      }),
    })));
  if (answers.every((a) => !a)) return null;
  const probs = (a: Answer | undefined) => a?.probabilities ?? (a?.choice ? { [a.choice]: 1 } : {});
  const [id, p] = answers.flatMap((a) => Object.entries(probs(a?.topic))).filter(([k]) => k !== "other")
    .sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { topic: topics.find((t) => t.id === id) ?? null, p, generic: answers[0]?.generic?.noul ?? 0 };
}

export { normalise }; // lives in lib/edge.ts, shared with the query-vector cache

interface Match { ref: Ref; score: number }

/** Luna: what kind of search this is (KINDS); null when it did not answer. */
async function kindOf(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, q: string): Promise<Kind | null> {
  const answers = await decide(env, ctx, `Quran search query: "${q}"`, {
    kind: { type: "choice", instructions: "What kind of search is this? The query may be in any language.", criteria: KINDS },
  }, Math.min(KIND_TIMEOUT_MS, Number(env.LUNA_TIMEOUT_MS) || 4000));
  return (ranked(answers?.kind, Object.keys(KINDS))?.[0] as Kind | undefined) ?? null;
}

/** Luna: the surah a query names (1..114), or null. */
async function surahOf(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, q: string, surahs: Surah[]): Promise<number | null> {
  const answers = await decide(env, ctx, `Quran search query: "${q}"`, {
    surah: {
      type: "choice", instructions: "Which surah does this query name? The query may be in any language or transliteration.",
      criteria: { ...Object.fromEntries(surahs.map((s) => [String(s.n), `${s.name_en} (${s.meaning}) ${s.name_ar}`])), other: "No surah" },
    },
  }, Math.min(KIND_TIMEOUT_MS, Number(env.LUNA_TIMEOUT_MS) || 4000));
  const n = Number(ranked(answers?.surah, [...surahs.map((s) => String(s.n)), "other"])?.[0]);
  return Number.isInteger(n) && n >= 1 && n <= surahs.length ? n : null;
}

/** The KIND_TOP ayahs nearest to `text` (embedded as `kind`), best first; null on any failure. */
async function refsFor(env: Env, requestUrl: string, text: string, kind: "query_text" | "document"): Promise<Ref[] | null> {
  try {
    const v = await queryVector(env, requestUrl, text, kind);
    return (await env.AYAHS_INDEX.query(v, { topK: KIND_TOP })).matches.map((m) => m.id);
  } catch (e) {
    console.warn("kind search failed:", String(e));
    return null;
  }
}

/** The nearest ayahs, best first; vector ids in AYAHS_INDEX are refs ("2:255"). null when the embedding or the index
 *  failed (no 500). */
async function vectorMatches(env: Env, requestUrl: string, q: string, topK: number): Promise<Match[] | null> {
  try {
    const v = await queryVector(env, requestUrl, q, "query");
    return (await env.AYAHS_INDEX.query(v, { topK })).matches.map((m) => ({ ref: m.id, score: m.score }));
  } catch (e) {
    console.warn("vector search failed:", String(e));
    return null;
  }
}

async function referenceRefs(env: Env, surah: number, from: number, to: number): Promise<Ref[]> {
  const surahs = await readData<Surah[]>(env, "surahs.json");
  const max = surahs?.[surah - 1]?.ayahs ?? 286;
  if (surah < 1 || surah > 114 || from < 1 || from > max) return [];
  const last = Math.min(Math.max(from, to), max, from + K - 1);
  return Array.from({ length: last - from + 1 }, (_, i) => `${surah}:${from + i}`);
}
