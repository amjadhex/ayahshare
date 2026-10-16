// Test env: real local D1, R2 and cache from the pool; the embeddings API, Vectorize and the static data files are fakes.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import { app } from "../src/index";

export const AYAHS_EN: Record<string, string> = {
  "2:153": "O you who have believed, seek help through patience and prayer.",
  "2:155": "And We will surely test you with something of fear and hunger.",
  "2:255": "Allah - there is no deity except Him, the Ever-Living, the Sustainer of existence.",
  "3:200": "O you who have believed, persevere and endure and remain stationed.",
  "39:10": "Indeed, the patient will be given their reward without account.",
  "94:5": "For indeed, with hardship will be ease.",
  "94:6": "Indeed, with hardship will be ease.",
  "103:3": "Except for those who have believed and done righteous deeds and advised each other to patience.",
};
export const TOPICS = {
  version: "2026-10-08",
  topics: [
    { id: "patience", label: "patience", refs: ["2:153", "39:10", "3:200", "103:3"] },
    { id: "hope", label: "hope", refs: ["94:5", "94:6"] },
  ],
};
export const SURAHS = Array.from({ length: 114 }, (_, i) => ({ n: i + 1, name_ar: "", name_en: `S${i + 1}`, meaning: "", ayahs: i === 93 ? 8 : 286 }));
export const clip = (id: string) => ({
  id, duration: 10, caption: `clip ${id}`, tags: [],
  video: { portrait: `clips/p/${id}.mp4`, landscape: `clips/l/${id}.mp4` },
  poster: { portrait: `posters/p/${id}.jpg`, landscape: `posters/l/${id}.jpg` },
  thumb: `thumbs/${id}.webp`,
});
// pb3 has the optional 1080p renditions (portrait only would be valid too): the routes must pass them through as they are
export const CLIPS = ["pb1", "pb2", "pb3", "px4"].map((id) =>
  id === "pb3" ? { ...clip(id), hd: { portrait: `clips/p1080/${id}.mp4`, landscape: `clips/l1080/${id}.mp4` } } : clip(id));
export const FULL_DATA: Record<string, unknown> = { "ayahs-en.json": AYAHS_EN, "topics.json": TOPICS, "surahs.json": SURAHS, "clips.json": CLIPS };

export const INDEX_HTML = `<!doctype html><html><head><title>AyahShare</title>
<meta name="description" content="Create beautiful Quran images and videos to share.">
<link rel="canonical" href="https://ayahshare.com/">
<meta property="og:title" content="old"></head><body><div id="app"></div></body></html>`;

/** Fake bindings over the pool's real D1/R2. `data` = files served under /data/ (others fall back to index.html like the SPA). */
export function makeEnv(data: Record<string, unknown> = FULL_DATA, vectorIds = ["94:6", "2:155", "94:5"], clipIds = ["px4", "gone", "pb2"]) {
  return {
    ...env,
    OPENROUTER_API_KEY: "test-key",
    ADMIN_TOKEN: "test-admin",
    ASSETS: {
      fetch: vi.fn(async (input: string | URL | Request) => {
        const name = new URL(input instanceof Request ? input.url : String(input)).pathname.replace(/^\/data\//, "");
        return name in data ? Response.json(data[name]) : new Response(INDEX_HTML, { headers: { "Content-Type": "text/html", ETag: '"app"' } });
      }),
    },
    AYAHS_INDEX: { query: vi.fn(async (_v: number[], o: { topK: number }) => ({ matches: vectorIds.slice(0, o.topK).map((id, i) => ({ id, score: 1 - i / 10 })) })) },
    CLIPS_INDEX: { query: vi.fn(async (_v: number[], o: { topK: number }) => ({ matches: clipIds.slice(0, o.topK).map((id, i) => ({ id, score: 1 - i / 10 })) })) },
  } as unknown as Env & { AYAHS_INDEX: { query: ReturnType<typeof vi.fn> }; CLIPS_INDEX: { query: ReturnType<typeof vi.fn> } };
}

/** A D1 binding whose every query fails, as when the account's daily D1 quota is used up. */
export const BROKEN_DB = (() => {
  const fail = async () => { throw new Error("D1_ERROR: Exceeded maximum daily rows written"); };
  const statement = { bind: () => statement, first: fail, all: fail, run: fail, raw: fail };
  return { prepare: () => statement, batch: fail, exec: fail } as unknown as D1Database;
})();

/** One request through the app. Each call gets its own client IP unless one is given, so rate limits stay out of the way. */
export async function call(path: string, init: RequestInit = {}, e: Env = makeEnv()) {
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`);
  const res = await app.request(path, { ...init, headers }, e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export const ORIGIN = "http://localhost";

/** A same-origin JSON write, as the app sends it. `cookie` = a Cookie header value. */
export function send(method: string, path: string, body?: unknown, opts: { cookie?: string; env?: Env; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...opts.headers };
  if (opts.cookie) headers.Cookie = opts.cookie;
  return call(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, opts.env);
}

/** "name=value" of the session cookie set by a response, for the next request. */
export const sessionCookie = (res: Response) => res.headers.get("Set-Cookie")?.match(/__Host-qd_session=[^;]*/)?.[0] ?? "";

export const RECIPE = {
  v: 1, surah: 94, from: 5, to: 6, reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "portrait",
  bg: { type: "clip", id: "pb1" }, font: "Amiri Quran", quranSize: 4, transSize: 3,
  textColor: "#ffffff", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0,
};

export const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
/** Fake OpenRouter embeddings API, gets the request body. Its 768-d vectors are not unit length, so the Worker's own cut
 *  to EMBED_DIM and re-normalising are exercised. Reset before every test (test/setup.ts). */
export const embeddings = vi.fn(async (body: { model: string; input: unknown[]; dimensions: number }) =>
  Response.json({ data: body.input.map((_, index) => ({ index, embedding: Array.from({ length: 768 }, (_, i) => (i < 256 ? 2 : 1)) })) }));

/** Mock outbound fetch; `handler` gets (url, init) and returns a Response. Embedding requests always go to `embeddings`
 *  and are not recorded on the returned mock. */
export function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const other = vi.fn(handler);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return url === EMBEDDINGS_URL ? embeddings(JSON.parse(String(init!.body))) : other(url, init);
  });
  return other;
}

/** A Luna (OpenRouter Decisions) reply. */
export const luna = (answers: Record<string, unknown>, cost = 0.0001) => Response.json({ answers, usage: { input_tokens: 300, cost } });

/** A realistic app session for one device, as two batches of the web client (picking, then exporting and sharing). */
export const SESSION = (anon: string) => {
  const ev = (name: string, a: string, props: Record<string, unknown>) => ({ name, ts: Date.now(), anon: a, session: "s-1", props });
  const design = { ref: "94:5", ayahs: 2, clip: "pb1", reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "portrait" };
  return [[
    ev("app_open", anon, design),
    ev("search", anon, { q: "  Patience\n IN   Hardship " }),
    ev("search_click", anon, { ref: "94:5", q: "patience in hardship" }),
    ev("search", anon, { q: "Lost  query" }),
    ev("ayah_select", anon, design),
    ev("bg_select", anon, { ...design, source: "library" }),
  ], [
    ev("export_start", anon, { ...design, kind: "video" }),
    ev("export_done", anon, { ...design, kind: "video", ms: 8000, bytes: 2_000_000 }),
    ev("export_failed", anon, { ...design, kind: "video", reason: "Encoder error 1234567 at https://x.example/a.mp4\nstack" }),
    ev("export_done", anon, { ...design, ref: "2:255", clip: "colour", kind: "image", ms: 300, bytes: 100_000 }),
    ev("share_native", anon, { ...design, kind: "video" }),
    ev("link_copy", anon, design),
  ]];
};

/** Decrypts a Web Push aes128gcm body (RFC 8291) as the browser would, with the receiver's private key 'd' and public
 *  key (base64url), for checking what the Worker sends. */
export async function decryptPush(body: Uint8Array, receiver: { d: string; p256dh: string; auth: string }): Promise<string> {
  const { b64url, unb64url } = await import("../src/lib/webpush");
  const enc = new TextEncoder();
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const point = unb64url(receiver.p256dh)!;
  const ecdh = { name: "ECDH", namedCurve: "P-256" };
  const jwk = { kty: "EC", crv: "P-256", x: b64url(point.slice(1, 33)), y: b64url(point.slice(33)), d: receiver.d };
  const priv = await crypto.subtle.importKey("jwk", jwk, ecdh, false, ["deriveBits"]);
  const algorithm = { name: "ECDH", public: await crypto.subtle.importKey("raw", asPublic, ecdh, false, []) } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = await crypto.subtle.deriveBits(algorithm, priv, 256);
  const hkdf = async (salt: Uint8Array, ikm: ArrayBuffer, info: Uint8Array, n: number) =>
    crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8);
  const ikm = await hkdf(unb64url(receiver.auth)!, shared, new Uint8Array([...enc.encode("WebPush: info\0"), ...point, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(nonce) }, key, body.slice(21 + idlen)));
  if (plain[plain.length - 1] !== 2) throw new Error("no last-record padding delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}
