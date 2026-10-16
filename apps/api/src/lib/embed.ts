// Embeddings with Gemini Embedding 2 (EMBED_MODEL) through OpenRouter, matching the Vectorize indexes that
// pipeline/common.py fills with the same model, formats and size (EMBED_DIM, a Matryoshka cut). Ayahs are indexed as
// text; clips as the unit sum of their poster image and caption vectors, found by text queries.
import { cacheUrl, edgeJson, normalise } from "./edge";

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
export const EMBED_KINDS = ["query", "query_text", "clip_query", "document"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];
/** Gemini Embedding 2 search formats (Gemini API embeddings guide). "Quran verses about" in the ayah query took hit@3
 *  on pipeline/eval/search_eval.json from 74 % to 93 % (pipeline/eval/embed_models.md). Same as common.EMBED_FORMATS. */
const FORMATS: Record<EmbedKind, (t: string) => string> = {
  query: (t) => `task: search result | query: Quran verses about ${t}`, // ayah search
  query_text: (t) => `task: search result | query: ${t}`, // ayah search, worded for the kind of search (routes/search.ts)
  clip_query: (t) => `task: search result | query: ${t}`, // background library search
  document: (t) => `title: none | text: ${t}`,
};
// A search never waits longer for its query vector; then it has no vector results, which are never cached (the search
// answers 503 when nothing else was found, and the app tries again). 2 s was too short for a cold first query.
export const QUERY_TIMEOUT_MS = 5000;
const QUERY_TTL = 30 * 86400; // seconds a query vector stays in a colo's cache (the key names the model and size)

type Input = string | { content: { type: "image_url"; image_url: { url: string } }[] };

/** Unit vectors of EMBED_DIM for texts in one of the formats above. Throws on any error or after `timeoutMs`. */
export const embed = (env: Env, texts: string[], kind: EmbedKind, timeoutMs = 30_000) =>
  request(env, texts.map(FORMATS[kind]), timeoutMs);

/** Unit vectors of EMBED_DIM for images (https: or data: URLs), one per image. */
export const embedImages = (env: Env, urls: string[], timeoutMs = 60_000) =>
  request(env, urls.map((url) => ({ content: [{ type: "image_url" as const, image_url: { url } }] })), timeoutMs);

/** A search query's vector, kept in this colo's cache by model, size, kind and normalised query. Throws like embed(). */
export async function queryVector(env: Env, requestUrl: string, q: string, kind: EmbedKind): Promise<number[]> {
  const name = `embed?m=${encodeURIComponent(env.EMBED_MODEL)}&d=${env.EMBED_DIM}&k=${kind}&q=${encodeURIComponent(normalise(q))}`;
  const v = await edgeJson(cacheUrl(requestUrl, name), QUERY_TTL, async () => (await embed(env, [q], kind, QUERY_TIMEOUT_MS))[0]);
  if (!v) throw new Error("no query vector");
  return v;
}

async function request(env: Env, input: Input[], timeoutMs: number): Promise<number[][]> {
  const dim = Number(env.EMBED_DIM);
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.EMBED_MODEL, input, dimensions: dim }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { data, error } = await res.json<{ data?: { index: number; embedding: number[] }[]; error?: { message?: string } }>();
  if (!data || data.length !== input.length) throw new Error(`embeddings: ${error?.message ?? "missing vectors"}`);
  // The API already cuts to `dimensions`; cutting and re-normalising here as well keeps every vector index-sized.
  return data.sort((a, b) => a.index - b.index).map(({ embedding }) => {
    const v = embedding.slice(0, dim);
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  });
}
