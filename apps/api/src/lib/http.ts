// Request guards shared by the routes: same-origin writes (CSRF), per-client rate limits, body size, JSON bodies.
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const isWrite = (c: Context) => WRITES.has(c.req.method);

/** The iOS app (capacitor://localhost) and the Android app (https://localhost): their pages load from the device and
 *  call /api/* across origins. They send the session as a Bearer token, never the cookie (a cross-site request does
 *  not carry the SameSite=Lax cookie), so letting their writes through opens no CSRF hole. */
export const APP_ORIGINS = ["capacitor://localhost", "https://localhost"];
export const isAppOrigin = (c: Context) => APP_ORIGINS.includes(c.req.header("Origin") ?? "");

/** The public site. Links the Worker makes (share links, Open Graph URLs) use it when the request came to ayahshare.com
 *  or www.ayahshare.com; any other host (the workers.dev test address, local dev) gets links to itself. */
export const PUBLIC_ORIGIN = "https://ayahshare.com";
const PUBLIC_HOSTS = new Set(["ayahshare.com", "www.ayahshare.com"]);
export function publicOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return PUBLIC_HOSTS.has(url.hostname) ? PUBLIC_ORIGIN : url.origin;
}

/** Writes must come from this origin (or, with `allowApps`, from the apps), and any body must be JSON: a cross-site
 *  form can do neither. Each host that serves the app (ayahshare.com, www.ayahshare.com, the workers.dev address) is
 *  its own origin, with its own host-only session cookie, so a page writes only to the host it came from. /api/events also takes text/plain, because browsers refuse navigator.sendBeacon() with a JSON
 *  Blob type; the Origin check still applies there. */
export function crossSite(c: Context, allowApps = false): Response | null {
  if (c.req.header("Origin") !== new URL(c.req.url).origin && !(allowApps && isAppOrigin(c))) return c.json({ error: "bad origin" }, 403);
  const hasBody = c.req.raw.body !== null && c.req.header("Content-Length") !== "0";
  const type = c.req.header("Content-Type") ?? "";
  const ok = /^application\/json\b/i.test(type) || (c.req.path === "/api/events" && /^text\/plain\b/i.test(type));
  if (hasBody && !ok) return c.json({ error: "JSON body required" }, 415);
  return null;
}

/** /api/* writes: this origin or the apps. */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  const blocked = isWrite(c) ? crossSite(c, true) : null;
  if (blocked) return blocked;
  await next();
};

/** CORS on /api/* for the apps only (no credentials: their session is the Bearer header). Other origins get no CORS
 *  headers, so a browser keeps them same-origin as before. */
export const appCors = cors({
  origin: APP_ORIGINS,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization", "X-Anon"], // X-Anon: the device id for GET /api/stats/me
  maxAge: 86400,
});

type Limiter = "SEARCH_LIMITER" | "LUNA_LIMITER" | "EVENTS_LIMITER" | "WRITE_LIMITER" | "AUTH_LIMITER";
const windows = new Map<string, { n: number; reset: number }>();

/** The rate-limit key for a client address: IPv4 as is, IPv6 by its /64, since one subscriber usually holds a whole
 *  /64 and could otherwise send every request from a new address. */
export function ipKey(ip: string): string {
  const v4 = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/); // also IPv4-mapped IPv6 (::ffff:1.2.3.4)
  if (v4 || !ip.includes(":")) return v4?.[1] ?? ip;
  const [head, tail] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  const full = tail === undefined ? a : [...a, ...Array<string>(Math.max(8 - a.length - b.length, 0)).fill("0"), ...b];
  return `${full.slice(0, 4).map((h) => (parseInt(h, 16) || 0).toString(16)).join(":")}::/64`;
}

/** True while this client (IP, or IPv6 /64) is within `perMinute` requests on `binding`: the Workers rate limiting
 *  binding when bound (limits in wrangler.jsonc), else a per-isolate counter with the same limit. The IP is only a key
 *  in memory; it is never stored. */
export async function withinLimit(c: Context<{ Bindings: Env }>, binding: Limiter, perMinute: number): Promise<boolean> {
  const key = `${binding}:${ipKey(c.req.header("CF-Connecting-IP") ?? "local")}`;
  const limiter = c.env[binding] as RateLimit | undefined;
  return limiter ? (await limiter.limit({ key })).success : count(key, perMinute);
}

/** Per-client limit per minute (see withinLimit); over it → 429. */
export const rateLimit = (binding: Limiter, perMinute: number): MiddlewareHandler<{ Bindings: Env }> => async (c, next) => {
  if (!(await withinLimit(c, binding, perMinute))) return c.json({ error: "too many requests" }, 429, { "Retry-After": "60" });
  await next();
};

function count(key: string, limit: number): boolean {
  const now = Date.now();
  if (windows.size > 10_000) for (const [k, w] of windows) if (w.reset < now) windows.delete(k);
  const w = windows.get(key);
  if (!w || w.reset < now) {
    windows.set(key, { n: 1, reset: now + 60_000 });
    return true;
  }
  return ++w.n <= limit;
}

export const maxBody = (kb: number) => bodyLimit({ maxSize: kb * 1024, onError: (c) => c.json({ error: "body too large" }, 413) });

/** The JSON body as an object, or null when it is missing or malformed. */
export async function readJson<T extends object>(c: Context): Promise<Partial<T> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** Lower-case hex SHA-256. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Random URL-safe string from `bytes` random bytes. */
export function randomToken(bytes: number): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time check of an `Authorization: Bearer <token>` header against `secret`. */
export async function bearerIs(c: Context, secret: string | undefined): Promise<boolean> {
  const got = c.req.header("Authorization");
  if (!secret || !got) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([got, `Bearer ${secret}`].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Integer query parameter clamped to [min, max]. */
export const intParam = (c: Context, name: string, fallback: number, min: number, max: number) =>
  Math.min(Math.max(Math.floor(Number(c.req.query(name) ?? fallback)) || fallback, min), max);
