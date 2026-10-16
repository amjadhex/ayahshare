// Sign in with Apple: checks the identity token (a JWT, RS256) the iOS app gets from Apple (routes/auth.ts
// POST /api/auth/apple). Apple's public keys are kept in this isolate and in this colo's cache (edge.ts), and fetched
// again, at most once a minute, when a token names a key we do not have (Apple rotates its keys).
// Token revocation (App Store guideline 5.1.1(v)): the app's one-time authorization code is exchanged for a refresh token,
// kept encrypted on the user (users.apple_refresh), and revoked when the account is deleted. Both calls to Apple carry a
// client secret (an ES256 JWT signed with the APPLE_SIGNIN_KEY .p8); without that key neither happens.
import { createLocalJWKSet, decodeJwt, errors, importPKCS8, jwtVerify, SignJWT, type JSONWebKeySet, type JWTVerifyGetKey } from "jose";
import { cacheUrl, edgeJson } from "./edge";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
/** client_id of the code exchange and revocation: the iOS app's bundle id (the Sign in with Apple key's primary App ID). */
export const APPLE_APP_ID = "com.ayahshare.app";
const SECRET_TTL = 24 * 3600; // seconds a client secret is valid (Apple allows up to 6 months)…
const SECRET_KEEP_MS = 3600_000; // …and how long this isolate reuses one
const APPLE_TIMEOUT_MS = 8000;
/** The audiences accepted when APPLE_CLIENT_IDS is not set: the iOS app's bundle id. */
const DEFAULT_CLIENT_IDS = "com.ayahshare.app";
const KEYS_TTL = 6 * 3600; // seconds, in the isolate and the edge cache
const REFETCH_MS = 60_000; // an unknown key id fetches the keys again at most this often

export interface AppleClaims {
  sub: string;
  email: string | null;
  /** Apple vouches for the address (true for Hide My Email relay addresses too). */
  emailVerified: boolean;
  /** A Hide My Email address (…@privaterelay.appleid.com). */
  privateRelay: boolean;
}

/** Apple's keys could not be had (the token itself was not judged). */
export class AppleKeysUnavailable extends Error {}

let keys: { get: JWTVerifyGetKey; until: number } | null = null;
let fetchedAt = 0;

/** APPLE_CLIENT_IDS (comma-separated), else the app's bundle id. */
export const appleClientIds = (env: Env): string[] =>
  (env.APPLE_CLIENT_IDS || DEFAULT_CLIENT_IDS).split(",").map((s) => s.trim()).filter(Boolean);

async function keySet(requestUrl: string, fresh: boolean): Promise<JWTVerifyGetKey> {
  const now = Date.now();
  if (!fresh && keys && now < keys.until) return keys.get;
  const url = cacheUrl(requestUrl, "apple-keys");
  if (fresh) await caches.default.delete(url);
  const jwks = await edgeJson<JSONWebKeySet>(url, KEYS_TTL, async () => {
    const res = await fetch(APPLE_KEYS_URL);
    if (!res.ok) throw new AppleKeysUnavailable(`HTTP ${res.status}`);
    const body = await res.json<JSONWebKeySet>();
    return Array.isArray(body?.keys) ? body : null;
  }).catch((e) => { throw e instanceof AppleKeysUnavailable ? e : new AppleKeysUnavailable(String(e)); });
  if (!jwks) throw new AppleKeysUnavailable("no key set");
  fetchedAt = now;
  keys = { get: createLocalJWKSet(jwks), until: now + KEYS_TTL * 1000 };
  return keys.get;
}

const yes = (v: unknown) => v === true || v === "true";

/** The verified claims of an Apple identity token (signature, issuer, audience, expiry); throws when it does not pass. */
export async function verifyAppleToken(env: Env, requestUrl: string, idToken: string): Promise<AppleClaims> {
  const options = { issuer: APPLE_ISSUER, audience: appleClientIds(env), algorithms: ["RS256"], requiredClaims: ["exp", "sub"] };
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, await keySet(requestUrl, false), options));
  } catch (e) {
    if (!(e instanceof errors.JWKSNoMatchingKey) || Date.now() - fetchedAt < REFETCH_MS) throw e;
    ({ payload } = await jwtVerify(idToken, await keySet(requestUrl, true), options));
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("apple token: no subject");
  const email = typeof payload.email === "string" && payload.email ? payload.email.trim() : null;
  return {
    sub: payload.sub,
    email,
    emailVerified: yes(payload.email_verified),
    privateRelay: yes(payload.is_private_email) || !!email?.toLowerCase().endsWith("@privaterelay.appleid.com"),
  };
}

// ---------- token revocation ----------

/** The code exchange and revocation can run: the .p8 secret and both ids are set. */
export const appleRevocationOn = (env: Env): boolean => !!(env.APPLE_SIGNIN_KEY && env.APPLE_KEY_ID && env.APPLE_TEAM_ID);

let clientSecret: { jwt: string; until: number; for: string } | null = null;

/** The client secret for Apple's token and revoke endpoints: an ES256 JWT signed with the .p8, kept for an hour. */
export async function appleClientSecret(env: Env): Promise<string> {
  const pem = env.APPLE_SIGNIN_KEY!.replace(/\\n/g, "\n").trim(); // tolerates a key pasted with literal \n
  const id = `${env.APPLE_TEAM_ID}\n${env.APPLE_KEY_ID}\n${pem}`;
  const now = Date.now();
  if (clientSecret && clientSecret.for === id && now < clientSecret.until) return clientSecret.jwt;
  const iat = Math.floor(now / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SECRET_TTL)
    .setAudience(APPLE_ISSUER)
    .setSubject(APPLE_APP_ID)
    .sign(await importPKCS8(pem, "ES256"));
  clientSecret = { jwt, until: now + SECRET_KEEP_MS, for: id };
  return jwt;
}

/** A form POST to Apple with the client id and secret; throws on a non-2xx answer (Apple's body is only an error code). */
async function applePost(env: Env, url: string, params: Record<string, string>): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: APPLE_APP_ID, client_secret: await appleClientSecret(env), ...params }),
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res;
}

/** Exchanges the app's authorization code for Apple's refresh token. The code must belong to `sub` (the identity token's
 *  subject), so no one can attach another person's code to their own account. Throws when it does not work. */
export async function exchangeAppleCode(env: Env, code: string, sub: string): Promise<string> {
  const res = await applePost(env, APPLE_TOKEN_URL, { grant_type: "authorization_code", code });
  const body = await res.json<{ refresh_token?: unknown; id_token?: unknown }>();
  if (typeof body?.refresh_token !== "string" || !body.refresh_token) throw new Error("apple token: no refresh token");
  if (typeof body.id_token !== "string" || decodeJwt(body.id_token).sub !== sub) throw new Error("apple token: another subject");
  return body.refresh_token;
}

/** Revokes a refresh token, which ends the app's Sign in with Apple link for that person. Throws when it does not work. */
export async function revokeAppleToken(env: Env, refreshToken: string): Promise<void> {
  await applePost(env, APPLE_REVOKE_URL, { token: refreshToken, token_type_hint: "refresh_token" });
}

// The refresh token at rest: AES-GCM with a key derived (HKDF-SHA256) from AUTH_CODE_SECRET, the user id as additional
// data (a value copied to another row does not open). Stored as "v1:" + base64(IV ‖ ciphertext); as it is when that
// secret is not set. Changing AUTH_CODE_SECRET makes the stored tokens unreadable (their revocation is then skipped).
const SEALED = "v1:";
const te = new TextEncoder();

async function refreshKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", te.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: te.encode("ayahshare/apple-refresh"), info: te.encode("v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export async function sealAppleRefresh(env: Env, userId: string, token: string): Promise<string> {
  if (!env.AUTH_CODE_SECRET) return token;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: te.encode(userId) }, await refreshKey(env.AUTH_CODE_SECRET), te.encode(token)));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  return SEALED + btoa(String.fromCharCode(...all));
}

export async function openAppleRefresh(env: Env, userId: string, stored: string): Promise<string> {
  if (!stored.startsWith(SEALED)) return stored;
  if (!env.AUTH_CODE_SECRET) throw new Error("apple refresh token: AUTH_CODE_SECRET is not set");
  const all = Uint8Array.from(atob(stored.slice(SEALED.length)), (ch) => ch.charCodeAt(0));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: all.slice(0, 12), additionalData: te.encode(userId) }, await refreshKey(env.AUTH_CODE_SECRET), all.slice(12));
  return new TextDecoder().decode(pt);
}

/** Sign-in: exchanges the code and keeps the refresh token on the user. Never throws (sign-in goes on either way). */
export async function keepAppleRefresh(env: Env, userId: string, sub: string, code: string): Promise<void> {
  try {
    const token = await exchangeAppleCode(env, code, sub);
    await env.DB.prepare("UPDATE users SET apple_refresh = ?1 WHERE id = ?2 AND apple_sub = ?3")
      .bind(await sealAppleRefresh(env, userId, token), userId, sub).run();
  } catch (e) {
    console.warn("apple code exchange failed:", String(e));
  }
}

/** Account deletion: revokes the stored refresh token. Never throws (the account is deleted either way). */
export async function revokeAppleLink(env: Env, userId: string, stored: string): Promise<void> {
  if (!appleRevocationOn(env)) return void console.warn("apple revocation skipped: APPLE_SIGNIN_KEY / APPLE_KEY_ID / APPLE_TEAM_ID not set");
  try {
    await revokeAppleToken(env, await openAppleRefresh(env, userId, stored));
  } catch (e) {
    console.warn("apple revocation failed:", String(e));
  }
}
