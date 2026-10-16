// CORS-enabled proxies for content that never changes, so the browser never waits on a slow third party twice:
//   GET /qapi/*                → https://api.alquran.cloud/v1/*          edge cache 30 days
//   GET /qapi/surah/:n/<lang>.qf-<id> → that Quran Foundation translation of the surah, in the same shape
//                                (lib/translations.ts; the app offers those in data/translations.json), edge cache 30 days
//   GET /audio/:folder/:file   → https://everyayah.com/data/:folder/:file  edge cache 1 year (CDN has no CORS); our own
//                                reciters (contracts/reciters.ts OWN_RECITERS) from the media bucket, audio/:folder/:file
//   GET /audio/voice/:id/:file → a translation voice's file (contracts/voices.ts: only its listed sources, never an
//                                address from the request), edge cache 1 year
//   GET /media/*               → R2 via the edge cache, with Range (videos must seek), ETag / If-None-Match, immutable
//                                (except creations/*, the private thumbnails of saved designs; legal/* — the privacy
//                                notice and terms, which change — is read from R2 every time and cached for 5 minutes)
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { OWN_RECITERS } from "../../../../contracts/reciters";
import { isAyah, voiceById, voiceSource } from "../../../../contracts/voices";
import { cacheUrl, edgeJson } from "../lib/edge";
import { rateLimit } from "../lib/http";
import { QfError, qfConfigured } from "../lib/qf";
import { QF_EDITION, qfSurah } from "../lib/translations";

const DAY = 86400;
const TYPES: Record<string, string> = { mp4: "video/mp4", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", json: "application/json" };

export const proxy = new Hono<{ Bindings: Env }>();

const corsHeaders = cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS"],
  allowHeaders: ["Range"],
  exposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "X-Cache"],
  maxAge: DAY,
});
for (const path of ["/qapi/*", "/audio/*", "/media/*"]) proxy.use(path, corsHeaders);

proxy.get("/qapi/surah/:surah{[0-9]{1,3}}/:edition{[a-z]{2,3}\\.qf-[0-9]{1,6}}", rateLimit("SEARCH_LIMITER", 300), async (c) => {
  const surah = Number(c.req.param("surah")), id = Number(c.req.param("edition").match(QF_EDITION)?.[1]);
  if (surah < 1 || surah > 114 || !id) return c.json({ error: "bad path" }, 400);
  if (!qfConfigured(c.env)) return c.json({ error: "not available" }, 503, { "Cache-Control": "no-store" });
  // Keyed by translation and surah: the language in the id cannot multiply the cached copies.
  const key = cacheUrl(c.req.url, `qf-translation-${c.env.QF_ENV || "production"}/${id}/${surah}`);
  try {
    const body = await edgeJson(key, 30 * DAY, () => qfSurah(c.env, id, surah));
    return c.json(body!, 200, { "Cache-Control": `public, max-age=${30 * DAY}, immutable` });
  } catch (e) {
    const status = e instanceof QfError ? e.status : 502;
    if (status >= 500) console.warn("quran foundation translation:", String(e));
    return c.json({ error: status === 404 ? "not found" : "upstream unavailable" }, status === 404 ? 404 : 502, { "Cache-Control": "no-store" });
  }
});

proxy.get("/qapi/*", async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.slice("/qapi/".length);
  if (!/^[\w\-.,:/]+$/.test(path) || path.includes("..")) return c.json({ error: "bad path" }, 400);
  return edgeCached(c, 30 * DAY, `https://api.alquran.cloud/v1/${path}${url.search}`);
});

proxy.get("/audio/:folder/:file", async (c) => {
  const { folder, file } = c.req.param();
  const n = file.match(/^(\d{3})(\d{3})\.mp3$/);
  if (!/^[A-Za-z0-9][\w.-]{0,79}$/.test(folder) || !n || +n[1] < 1 || +n[1] > 114 || +n[2] < 1 || +n[2] > 286) {
    return c.json({ error: "bad audio path" }, 400);
  }
  if (OWN_RECITERS.has(folder)) return serveMedia(c, `audio/${folder}/${file}`);
  return edgeCached(c, 365 * DAY, `https://everyayah.com/data/${folder}/${file}`);
});

proxy.get("/audio/voice/:id/:file", async (c) => {
  const { id, file } = c.req.param();
  const voice = voiceById(id), n = file.match(/^(\d{3})(\d{3})\.mp3$/);
  if (!voice || !n || !isAyah(+n[1], +n[2])) return c.json({ error: "bad voice path" }, 400);
  const upstream = voiceSource(voice, +n[1], +n[2]);
  // Voices in our own bucket are served at /media/ (same origin already).
  if (!upstream.startsWith("https://")) return c.json({ error: "not found" }, 404);
  return edgeCached(c, 365 * DAY, upstream);
});

/** Serve from this colo's cache, else fetch upstream and cache a 200. Bodies are small (JSON, one ayah's MP3),
 *  so they are buffered: the cached copy then has a Content-Length and later Range requests get a 206. */
async function edgeCached(c: Context<{ Bindings: Env }>, maxAge: number, upstream: string): Promise<Response> {
  const range = c.req.header("Range");
  const key = new Request(c.req.url, range ? { headers: { Range: range } } : {});
  const hit = await caches.default.match(key);
  if (hit) return withHeader(hit, "X-Cache", "HIT");

  let res: Response;
  try {
    res = await fetch(upstream);
  } catch (e) {
    console.warn("upstream failed:", upstream, String(e));
    return c.json({ error: "upstream unavailable" }, 502);
  }
  const ok = res.status === 200;
  const out = new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": ok ? `public, max-age=${maxAge}, immutable` : "no-store",
      "X-Cache": "MISS",
    },
  });
  if (ok) c.executionCtx.waitUntil(caches.default.put(new Request(c.req.url), out.clone()));
  return out;
}

const withHeader = (res: Response, name: string, value: string) => {
  const out = new Response(res.body, res);
  out.headers.set(name, value);
  return out;
};

const MEDIA_CACHE_MAX = 25 * 1024 * 1024; // clips are ~1–2.5 MB; larger objects are served from R2 only

proxy.get("/media/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/media/".length));
  // creations/ holds the thumbnails of people's saved designs: private, served only by GET /api/creations/:id/thumb.
  if (!/^[\w\-./]+$/.test(key) || key.includes("..") || /^\/*creations\//.test(key)) return c.json({ error: "not found" }, 404);
  return serveMedia(c, key);
});

/** An object of the media bucket at this request's URL. */
async function serveMedia(c: Context<{ Bindings: Env }>, key: string): Promise<Response> {
  const url = new URL(c.req.url);

  // This colo's cache first; it answers Range (206) and If-None-Match (304) by itself. Documents that change skip it.
  const changing = key.startsWith("legal/");
  const cacheKey = `${url.origin}${url.pathname}`;
  const conditional = new Headers();
  for (const h of ["Range", "If-None-Match"]) if (c.req.header(h)) conditional.set(h, c.req.header(h)!);
  const hit = changing ? undefined : await caches.default.match(new Request(cacheKey, { headers: conditional }));
  if (hit) return withHeader(hit, "X-Cache", "HIT");

  let obj: R2Object | R2ObjectBody | null;
  try {
    obj = await c.env.MEDIA.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  } catch {
    return new Response(null, { status: 416 }); // unsatisfiable Range
  }
  if (!obj) return c.json({ error: "not found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", TYPES[key.split(".").pop()!.toLowerCase()] ?? "application/octet-stream");
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", changing ? "public, max-age=300" : `public, max-age=${365 * DAY}, immutable`);
  if (!("body" in obj)) return new Response(null, { status: 304, headers }); // If-None-Match matched
  if (!changing && obj.size <= MEDIA_CACHE_MAX) c.executionCtx.waitUntil(cacheMedia(c.env, key, cacheKey, new Headers(headers)));
  headers.set("X-Cache", "MISS");

  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!c.req.header("Range") || !r) return new Response(obj.body, { headers });
  const start = r.suffix !== undefined ? obj.size - r.suffix : (r.offset ?? 0);
  const length = r.length ?? obj.size - start;
  headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${obj.size}`);
  return new Response(obj.body, { status: 206, headers });
}

/** Stores the whole object in this colo's cache (one extra R2 read per colo), so later requests and seeks skip R2. */
async function cacheMedia(env: Env, key: string, cacheKey: string, headers: Headers) {
  const obj = await env.MEDIA.get(key);
  if (obj) await caches.default.put(cacheKey, new Response(await obj.arrayBuffer(), { headers }));
}
