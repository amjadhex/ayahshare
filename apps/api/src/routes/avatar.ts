// QuranReflect authors' photos through our Worker, so the app never loads a third-party image:
//   GET /api/avatar/qr/<path>   → https://s3.amazonaws.com/qreflect-bucket/<path>   edge cache 30 days
// Not an open proxy: only paths inside that one bucket (plain file names, no "..", no query), no redirects followed,
// raster images only (checked by their first bytes, never SVG), at most 200 KB, and upstream misses are rate limited.
import { Hono } from "hono";
import { withinLimit } from "../lib/http";

const BUCKET = "https://s3.amazonaws.com/qreflect-bucket/";
const MAX_BYTES = 200 * 1024;
const MONTH = 30 * 86400;
const TIMEOUT_MS = 8000;
const SEGMENT = /^[\p{L}\p{N}_\-.~ ()+,@!']{1,120}$/u;

/** The bucket path, each segment decoded, checked and encoded again, or null. `raw` is the URL-encoded path after the
 *  bucket name. */
export function bucketPath(raw: string): string | null {
  if (raw.length > 400 || /[?#\\]/.test(raw)) return null;
  const parts = raw.split("/");
  if (parts.length > 12) return null;
  const out: string[] = [];
  for (const part of parts) {
    let segment: string;
    try { segment = decodeURIComponent(part); } catch { return null; }
    if (!SEGMENT.test(segment) || /^\.+$/.test(segment)) return null;
    out.push(encodeURIComponent(segment));
  }
  return out.join("/");
}

/** Our URL for a QuranReflect avatar URL (https://s3.amazonaws.com/qreflect-bucket/…), or null for anything else. */
export function avatarPath(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(BUCKET)) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  // The URL as written, with no dot segments or backslashes for the parser to resolve.
  if (u.origin + u.pathname !== url.split(/[?#]/)[0] || !u.pathname.startsWith("/qreflect-bucket/")) return null;
  const path = bucketPath(u.pathname.slice("/qreflect-bucket/".length));
  return path ? `/api/avatar/qr/${path}` : null;
}

/** The image type from its first bytes (JPEG, PNG, GIF, WebP), or null. */
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** The body, or null when it is larger than MAX_BYTES (stops reading there). */
async function capped(res: Response): Promise<Uint8Array | null> {
  if (Number(res.headers.get("Content-Length")) > MAX_BYTES) { await res.body?.cancel(); return null; }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

const miss = (status: number) => new Response(null, { status, headers: { "Cache-Control": status === 429 ? "no-store" : "public, max-age=3600" } });

export const avatar = new Hono<{ Bindings: Env }>();

avatar.get("/qr/*", async (c) => {
  const url = new URL(c.req.url);
  const path = bucketPath(url.pathname.slice("/api/avatar/qr/".length));
  if (!path || url.search) return miss(404);
  const key = new Request(`${url.origin}/api/avatar/qr/${path}`);
  const hit = await caches.default.match(key);
  if (hit) return hit;
  if (!(await withinLimit(c, "SEARCH_LIMITER", 300))) return miss(429);

  let res: Response;
  try {
    res = await fetch(BUCKET + path, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    console.warn("avatar upstream failed:", String(e));
    return miss(502);
  }
  const type = res.headers.get("Content-Type") ?? "";
  if (res.status !== 200 || !/^image\/(jpeg|jpg|pjpeg|png|gif|webp)\b/i.test(type)) { await res.body?.cancel(); return miss(404); }
  const body = await capped(res);
  const sniffed = body && sniff(body);
  if (!body || !sniffed) return miss(404);
  const out = new Response(body, {
    headers: {
      "Content-Type": sniffed,
      "Cache-Control": `public, max-age=${MONTH}, immutable`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
  c.executionCtx.waitUntil(caches.default.put(key, out.clone()));
  return out;
});
