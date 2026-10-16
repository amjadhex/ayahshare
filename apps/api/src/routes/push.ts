// The web's daily reminder (owner, 12 Oct 2026; contracts PushSubscribeBody):
//   POST   /api/push { endpoint, keys: { p256dh, auth }, time: "HH:MM", tz } → 204. Subscribes, or changes the time of a
//          subscription the browser already has (the endpoint is the key); the next send is the next `time` in `tz`.
//   DELETE /api/push { endpoint } → 204 (also when there was none).
// No account or device id is kept: only the browser's push subscription and the chosen time. The 15-minute cron sends
// the reminders (src/reminders.ts). Same-origin or app writes only (lib/http sameOrigin on /api/*), rate-limited per client.
import { Hono } from "hono";
import type { PushSubscribeBody } from "../../../../contracts/types";
import { maxBody, rateLimit, readJson } from "../lib/http";
import { nextSendAt, validTime, validZone } from "../lib/tz";
import { b64url, unb64url } from "../lib/webpush";

const MAX_ENDPOINT = 1000;

/** The browsers' push services (Chrome/Edge on Android and desktop, Firefox, Safari, Windows), so the Worker never
 *  sends to a URL someone made up. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

/** The endpoint when it is an https URL of a known push service, at most 1000 characters, else null. */
function endpointOf(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_ENDPOINT) return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(url.hostname)) ? v : null;
  } catch {
    return null;
  }
}

/** The bytes of a base64url key when it decodes to `bytes` bytes, else null. */
function keyOf(v: unknown, bytes: number): Uint8Array | null {
  const raw = typeof v === "string" && v.length <= 128 ? unb64url(v) : null;
  return raw?.length === bytes ? raw : null;
}

export const push = new Hono<{ Bindings: Env }>();

push.post("/", rateLimit("WRITE_LIMITER", 60), maxBody(4), async (c) => {
  const body = await readJson<PushSubscribeBody>(c);
  const endpoint = endpointOf(body?.endpoint);
  if (!endpoint) return c.json({ error: "endpoint must be an https URL" }, 400);
  const keys = (body?.keys && typeof body.keys === "object" ? body.keys : {}) as Record<string, unknown>;
  const p256dh = keyOf(keys.p256dh, 65);
  const auth = keyOf(keys.auth, 16);
  if (p256dh?.[0] !== 4 || !auth) return c.json({ error: "invalid keys" }, 400);
  if (!validTime(body?.time)) return c.json({ error: "time must be HH:MM" }, 400);
  if (!validZone(body?.tz)) return c.json({ error: "unknown time zone" }, 400);

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO push_reminders (endpoint, p256dh, auth, time, tz, next_at, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, time = excluded.time, tz = excluded.tz,
       next_at = excluded.next_at, fails = 0`,
  ).bind(endpoint, b64url(p256dh), b64url(auth), body.time, body.tz, nextSendAt(body.time, body.tz, now), now).run();
  return c.body(null, 204);
});

push.delete("/", rateLimit("WRITE_LIMITER", 60), maxBody(4), async (c) => {
  const endpoint = endpointOf((await readJson<{ endpoint: string }>(c))?.endpoint);
  if (!endpoint) return c.json({ error: "endpoint must be an https URL" }, 400);
  await c.env.DB.prepare("DELETE FROM push_reminders WHERE endpoint = ?").bind(endpoint).run();
  return c.body(null, 204);
});
