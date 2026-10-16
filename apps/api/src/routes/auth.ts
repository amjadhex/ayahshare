// Sign-in (optional: Google, a code sent by email, or Apple in the iOS app) and the account itself:
//   POST /api/auth/google { credential, anon? } → verifies the Google ID token, upserts the user, starts a session
//                                                 (HTTP-only cookie), links the device, returns Me; the iOS / Android
//                                                 app (lib/http APP_ORIGINS) also gets the session `token` (SignedIn),
//                                                 which it sends as `Authorization: Bearer <token>`.
//                                                 503 while GOOGLE_CLIENT_ID is not configured. A new Google subject
//                                                 whose verified email is an email-only account's joins that account.
//   POST /api/auth/email/start { email, turnstile? } → { ok } once a 6-digit code is sent (the same answer whether or not
//                                                 an account exists); 400 invalid email, 403 { error: "bot_check" } when
//                                                 Turnstile is configured (lib/turnstile.ts) and the token does not pass,
//                                                 429 too soon / too many codes, 503 { error: "unavailable" } without a
//                                                 sender or when sending fails.
//   POST /api/auth/email/verify { email, code, anon? } → the same as Google's (SignedIn): the account with that email
//                                                 (a Google one too), else a new one. 401 wrong_code, 410 expired (or
//                                                 none), 429 too_many_attempts (the code is void after 5 guesses).
//   POST /api/auth/apple { idToken, authorizationCode?, name?, anon? } → the same as Google's (SignedIn), for the iOS
//                                                 app's Sign in with Apple (lib/apple.ts verifies the identity token). The
//                                                 account with that Apple id, else the account with the token's email when
//                                                 Apple has verified it and it is not a Hide My Email relay address, else a
//                                                 new one. `name` (Apple gives it to the app on the first sign-in only) names
//                                                 a new account, or one without a name. `authorizationCode` (iOS build 2 on;
//                                                 optional) is exchanged after the answer for the refresh token that DELETE
//                                                 /api/me revokes; a failed exchange is only logged. 401 invalid token, 503
//                                                 when Apple's keys cannot be had.
//   POST /api/auth/logout   GET /api/me → Me (the whole profile) | 401
//   PATCH /api/me (contracts ProfilePatch) → Me; 400 { error, field } on the first invalid field
//   PUT /api/me/lang { lang } → Me (My language, kept with the account)
//   DELETE /api/me → account and profile, sessions, saved designs and their thumbnails (R2), favourites; first revokes the
//                    Sign in with Apple refresh token, if one is kept (a failure there is logged and does not stop it)
// Events stay anonymous: devices, shares and reports only lose their link to the user.
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context } from "hono";
import type { Me, SignedIn } from "../../../../contracts/types";
import { appleRevocationOn, AppleKeysUnavailable, keepAppleRefresh, revokeAppleLink, verifyAppleToken } from "../lib/apple";
import { CODE_MINUTES, codeEmail, emailSignInEnabled, scrubbed, sendEmail } from "../lib/email";
import { isAppOrigin, maxBody, rateLimit, readJson } from "../lib/http";
import { passesTurnstile, turnstileOn } from "../lib/turnstile";
import { parsePatch, profileOf } from "../lib/profile";
import { endSession, requireUser, startSession, type AppEnv, type User } from "../lib/session";
import { thumbKeysOf } from "./account";

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
/** users.google_sub of an account made by email sign-in is this + its id (migrations/0008); Google subjects are numbers. */
const EMAIL_SUB = "email:";
/** …and of an account made by Sign in with Apple (migrations/0009). */
const APPLE_SUB = "apple:";

const basic = (u: User): Me => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar_url, lang: u.lang ?? null });
/** The whole profile (falls back to the basic fields if it cannot be read). */
const me = async (c: Context<AppEnv>, u: User): Promise<Me> => (await profileOf(c.env.DB, u.id, c.req.raw)) ?? basic(u);

export const auth = new Hono<AppEnv>();

auth.post("/auth/google", rateLimit("WRITE_LIMITER", 60), maxBody(16), async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: "sign-in is not available yet" }, 503);
  const body = await readJson<{ credential: string; anon: string }>(c);
  if (typeof body?.credential !== "string") return c.json({ error: "credential required" }, 400);

  let claims: { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  try {
    ({ payload: claims } = await jwtVerify(body.credential, GOOGLE_KEYS, {
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      audience: c.env.GOOGLE_CLIENT_ID,
    }));
  } catch (e) {
    console.warn("google token rejected:", String(e));
    return c.json({ error: "invalid credential" }, 401);
  }
  if (!claims.sub || !claims.email || claims.email_verified === false) return c.json({ error: "invalid credential" }, 401);

  const now = Date.now();
  const name = (claims.name ?? "").slice(0, 200);
  const db = c.env.DB;
  // A Google subject seen for the first time, whose email Google has verified, joins the account with that address that
  // email sign-in or Apple made, instead of making a second one: its placeholder google_sub becomes this subject.
  const joined = claims.email_verified === true ? await db.prepare(
    `UPDATE users SET google_sub = ?1, email = ?2, name = ?3, avatar_url = ?4, last_login = ?5
     WHERE id = (SELECT id FROM users WHERE lower(email) = lower(?2) AND google_sub IN (?6 || id, ?7 || id) ORDER BY last_login DESC LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM users WHERE google_sub = ?1)
     RETURNING id, email, name, avatar_url, lang`,
  ).bind(claims.sub, claims.email, name, claims.picture ?? null, now, EMAIL_SUB, APPLE_SUB).first<User>() : null;
  const user = joined ?? (await db.prepare(
    `INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url,
       last_login = excluded.last_login
     RETURNING id, email, name, avatar_url, lang`,
  ).bind(crypto.randomUUID(), claims.sub, claims.email, name, claims.picture ?? null, now, now).first<User>())!;
  return signedIn(c, user, body.anon, now);
});

auth.post("/auth/apple", rateLimit("AUTH_LIMITER", 20), maxBody(16), async (c) => {
  const body = await readJson<{ idToken: string; authorizationCode: string; name: string; anon: string }>(c);
  if (typeof body?.idToken !== "string" || !body.idToken) return c.json({ error: "idToken required" }, 400);
  let claims: Awaited<ReturnType<typeof verifyAppleToken>>;
  try {
    claims = await verifyAppleToken(c.env, c.req.url, body.idToken);
  } catch (e) {
    if (e instanceof AppleKeysUnavailable) {
      console.warn("apple keys unavailable:", String(e));
      return c.json({ error: "unavailable" }, 503);
    }
    console.warn("apple token rejected:", String(e));
    return c.json({ error: "invalid credential" }, 401);
  }
  const now = Date.now();
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const db = c.env.DB;
  // Returning: the account with this Apple id. The name fills an account without one, and never replaces a name.
  const known = await db.prepare(
    `UPDATE users SET last_login = ?2, name = CASE WHEN name = '' THEN ?3 ELSE name END WHERE apple_sub = ?1
     RETURNING id, email, name, avatar_url, lang`,
  ).bind(claims.sub, now, name).first<User>();
  // First time: joins the account with the same address, only when Apple has verified it and it is the person's own (a
  // relay address is new for each app, so it never names someone's existing account).
  const linkable = claims.email && claims.emailVerified && !claims.privateRelay;
  const joined = !known && linkable ? await db.prepare(
    `UPDATE users SET apple_sub = ?1, last_login = ?3, name = CASE WHEN name = '' THEN ?4 ELSE name END
     WHERE id = (SELECT id FROM users WHERE lower(email) = lower(?2) AND apple_sub IS NULL ORDER BY last_login DESC LIMIT 1)
     RETURNING id, email, name, avatar_url, lang`,
  ).bind(claims.sub, claims.email, now, name).first<User>() : null;
  const id = crypto.randomUUID();
  const user = known ?? joined ?? (await db.prepare(
    `INSERT INTO users (id, google_sub, apple_sub, email, name, avatar_url, created_at, last_login) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)
     ON CONFLICT(apple_sub) DO UPDATE SET last_login = excluded.last_login
     RETURNING id, email, name, avatar_url, lang`,
  ).bind(id, APPLE_SUB + id, claims.sub, claims.email ?? "", name, now).first<User>())!;
  // The refresh token to revoke when the account is deleted (guideline 5.1.1(v)), fetched after the answer is sent. Build 1
  // of the iOS app sends no code: nothing is kept, and nothing can be revoked later.
  const code = typeof body.authorizationCode === "string" ? body.authorizationCode.trim() : "";
  if (code && code.length <= 1024 && appleRevocationOn(c.env)) c.executionCtx.waitUntil(keepAppleRefresh(c.env, user.id, claims.sub, code));
  return signedIn(c, user, body.anon, now);
});

/** Starts the session and links the device; the same answer for every way of signing in (SignedIn). */
async function signedIn(c: Context<AppEnv>, user: User, anon: unknown, now: number) {
  const token = await startSession(c, user.id);
  if (typeof anon === "string" && /^[\w-]{1,64}$/.test(anon)) {
    await c.env.DB.prepare(
      `INSERT INTO devices (anon_id, user_id, first_seen, last_seen) VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(anon_id) DO UPDATE SET user_id = ?2, last_seen = ?3`,
    ).bind(anon, user.id, now).run();
  }
  const profile = await me(c, user);
  return c.json<SignedIn>(isAppOrigin(c) ? { ...profile, token } : profile);
}

// ---------- email sign-in: a 6-digit code ----------

const CODE_MS = CODE_MINUTES * 60_000;
const RESEND_MS = 30_000; // at most one code per address per 30 s…
const HOUR_MS = 3600_000;
const SENDS_PER_HOUR = 5; // …and five an hour
const MAX_ATTEMPTS = 5; // guesses per code, then it is void

/** Trimmed and lower case, if it looks like an address (ASCII, at most 254 characters, a domain with a dot), else null.
 *  Only these characters ever reach the email's headers. */
export function normalEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  const m = email.match(/^([a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59}))$/);
  if (!m || m[1].startsWith(".") || m[1].endsWith(".") || m[1].includes("..")) return null;
  return email;
}

/** A uniformly random 6-digit code: 32-bit values at or above the last whole multiple of 10^6 are drawn again. */
function newCode(): string {
  const limit = 2 ** 32 - (2 ** 32 % 1_000_000);
  const n = new Uint32Array(1);
  do crypto.getRandomValues(n); while (n[0] >= limit);
  return String(n[0] % 1_000_000).padStart(6, "0");
}

const enc = new TextEncoder();
/** HMAC-SHA256 of the address and code, keyed with AUTH_CODE_SECRET: only this is stored, and without the key a copy of
 *  the table cannot be turned back into codes (there are only a million). */
async function codeHash(secret: string, email: string, code: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${email}\n${code}`)));
}
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

auth.post("/auth/email/start", rateLimit("AUTH_LIMITER", 20), maxBody(4), async (c) => {
  if (!emailSignInEnabled(c.env)) return c.json({ error: "unavailable" }, 503);
  const body = await readJson<{ email: string; turnstile: string }>(c);
  const email = normalEmail(body?.email);
  if (!email) return c.json({ error: "invalid email" }, 400);
  // The bot check (when configured) comes before the address's own limits, so bots cannot use those up either.
  if (turnstileOn(c.env) && !(await passesTurnstile(c, body?.turnstile))) return c.json({ error: "bot_check" }, 403);
  const code = newCode();
  const now = Date.now();
  // One statement, so requests at the same moment cannot pass the limits together. A new code replaces the old one.
  const stored = await c.env.DB.prepare(
    `INSERT INTO email_codes (email, code_hash, expires_at, attempts, created_at, window_start, sends) VALUES (?1, ?2, ?3, 0, ?4, ?4, 1)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       created_at = excluded.created_at,
       sends = CASE WHEN window_start <= ?4 - ?5 THEN 1 ELSE sends + 1 END,
       window_start = CASE WHEN window_start <= ?4 - ?5 THEN ?4 ELSE window_start END
     WHERE created_at <= ?4 - ?6 AND (window_start <= ?4 - ?5 OR sends < ?7)
     RETURNING email`,
  ).bind(email, toHex(await codeHash(c.env.AUTH_CODE_SECRET!, email, code)), now + CODE_MS, now, HOUR_MS, RESEND_MS, SENDS_PER_HOUR).first();
  if (!stored) return c.json({ error: "too many requests" }, 429, { "Retry-After": String(RESEND_MS / 1000) });
  try {
    await sendEmail(c.env, codeEmail(email, code));
  } catch (e) {
    console.warn("sign-in code not sent to an address at", email.split("@")[1], scrubbed(e));
    // It never arrived: void it, and let a retry through now (it still counts towards the hour's five).
    await c.env.DB.prepare("UPDATE email_codes SET code_hash = NULL, created_at = 0 WHERE email = ?").bind(email).run();
    return c.json({ error: "unavailable" }, 503);
  }
  return c.json({ ok: true });
});

auth.post("/auth/email/verify", rateLimit("AUTH_LIMITER", 20), maxBody(2), async (c) => {
  if (!emailSignInEnabled(c.env)) return c.json({ error: "unavailable" }, 503);
  const body = await readJson<{ email: string; code: string; anon: string }>(c);
  const email = normalEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const now = Date.now();
  // The guess is counted before it is compared, so even guesses sent all at once get five in all.
  const row = await db.prepare(
    `UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND code_hash IS NOT NULL AND expires_at > ? AND attempts < ?
     RETURNING code_hash, attempts`,
  ).bind(email, now, MAX_ATTEMPTS).first<{ code_hash: string; attempts: number }>();
  if (!row) {
    const live = await db.prepare("SELECT 1 FROM email_codes WHERE email = ? AND code_hash IS NOT NULL AND expires_at > ?").bind(email, now).first();
    return live ? c.json({ error: "too_many_attempts" }, 429) : c.json({ error: "expired" }, 410);
  }
  const guess = await codeHash(c.env.AUTH_CODE_SECRET!, email, code);
  const stored = fromHex(row.code_hash);
  if (stored.byteLength !== guess.byteLength || !crypto.subtle.timingSafeEqual(stored, guess)) {
    return row.attempts >= MAX_ATTEMPTS ? c.json({ error: "too_many_attempts" }, 429) : c.json({ error: "wrong_code" }, 401);
  }
  // Used once: a second request with the same code at the same moment finds it gone.
  const used = await db.prepare("UPDATE email_codes SET code_hash = NULL WHERE email = ? AND code_hash = ? RETURNING email")
    .bind(email, row.code_hash).first();
  if (!used) return c.json({ error: "expired" }, 410);

  // The account with this address (one made with Google too), else a new one: no name (the person can set one; Google
  // fills it if they join it later), no picture, the placeholder google_sub.
  const found = await db.prepare(
    `UPDATE users SET last_login = ?2 WHERE id = (SELECT id FROM users WHERE lower(email) = ?1 ORDER BY last_login DESC LIMIT 1)
     RETURNING id, email, name, avatar_url, lang`,
  ).bind(email, now).first<User>();
  const id = crypto.randomUUID();
  const user = found ?? (await db.prepare(
    `INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_login) VALUES (?1, ?2, ?3, '', NULL, ?4, ?4)
     RETURNING id, email, name, avatar_url, lang`,
  ).bind(id, EMAIL_SUB + id, email, now).first<User>())!;
  return signedIn(c, user, body?.anon, now);
});

auth.post("/auth/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

auth.get("/me", requireUser, async (c) => c.json(await me(c, c.var.user)));

/** Profile fields (contracts ProfilePatch), validated strictly; nothing is written when one field is invalid. */
auth.patch("/me", requireUser, rateLimit("WRITE_LIMITER", 60), maxBody(8), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const current = await c.env.DB.prepare("SELECT phone FROM users WHERE id = ?").bind(c.var.user.id).first<{ phone: string | null }>();
  const parsed = await parsePatch(c.env, body as Record<string, unknown> | null, current?.phone ?? null);
  if (!parsed.ok) return c.json({ error: parsed.error, field: parsed.field }, 400);
  const cols = Object.keys(parsed.set);
  if (cols.length) {
    await c.env.DB.prepare(`UPDATE users SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...cols.map((k) => parsed.set[k]), Date.now(), c.var.user.id).run();
  }
  return c.json(await me(c, c.var.user));
});

/** "My language": an ISO 639 code (2–3 letters), or null to forget it. */
auth.put("/me/lang", requireUser, maxBody(1), async (c) => {
  const body = await readJson<{ lang: unknown }>(c);
  const lang = body?.lang === null ? null : typeof body?.lang === "string" && /^[a-z]{2,3}$/.test(body.lang) ? body.lang : undefined;
  if (lang === undefined) return c.json({ error: "invalid lang" }, 400);
  await c.env.DB.prepare("UPDATE users SET lang = ? WHERE id = ?").bind(lang, c.var.user.id).run();
  return c.json(await me(c, { ...c.var.user, lang }));
});

auth.delete("/me", requireUser, async (c) => {
  const id = c.var.user.id;
  const db = c.env.DB;
  const thumbs = await thumbKeysOf(db, id);
  // Sign in with Apple: revoke the app's link first (only possible with a refresh token; accounts that signed in before
  // build 2 of the iOS app have none). It never blocks the deletion.
  const apple = await db.prepare("SELECT apple_refresh FROM users WHERE id = ?").bind(id).first<{ apple_refresh: string | null }>();
  if (apple?.apple_refresh) await revokeAppleLink(c.env, id, apple.apple_refresh);
  await db.batch([
    db.prepare("DELETE FROM favourites WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM creations WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    db.prepare("UPDATE devices SET user_id = NULL WHERE user_id = ?").bind(id),
    db.prepare("UPDATE shares SET user_id = NULL WHERE user_id = ?").bind(id),
    db.prepare("UPDATE reports SET user_id = NULL WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
  // Thumbnails after the rows: a failure here leaves only unreachable images (no row points to them).
  for (let i = 0; i < thumbs.length; i += 1000) await c.env.MEDIA.delete(thumbs.slice(i, i + 1000));
  await endSession(c);
  return c.json({ ok: true });
});
