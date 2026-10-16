// Web Push for the web's daily reminder (owner, 12 Oct 2026), with Web Crypto only (no npm package):
//   - VAPID (RFC 8292): an ES256 JWT for the push service's origin, signed with VAPID_PRIVATE_KEY (secret: the base64url
//     P-256 private scalar 'd') and sent with VAPID_PUBLIC_KEY (var: base64url uncompressed point, the key the browser
//     subscribed with, PublicConfig.vapidPublicKey).
//   - Payload encryption (RFC 8291, aes128gcm content coding of RFC 8188): a fresh ECDH key and salt per message, one
//     record of at most 4096 bytes. test/webpush.test.ts checks it against the RFC 8291 section 5 example.
// The cron that sends the reminders is src/reminders.ts; subscriptions come in through src/routes/push.ts.

const enc = new TextEncoder();
const SUBJECT = "mailto:hello@ayahshare.com";
const JWT_HOURS = 12; // RFC 8292 allows up to 24
const RECORD_SIZE = 4096;
/** The largest plaintext that fits one record and the 4096-byte body push services accept (86-byte header, padding
 *  delimiter, 16-byte tag). */
export const MAX_PLAINTEXT = RECORD_SIZE - 86 - 1 - 16;
export const TTL_SECONDS = 4 * 3600; // a reminder that waits longer than this at the push service is dropped

export type VapidKeys = { publicKey: string; privateKey: string };
/** A browser's PushSubscription: endpoint and keys (p256dh, auth) as base64url. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** Both VAPID keys when the var and the secret are set, else null (no web reminder). */
export const vapidKeys = (env: Env): VapidKeys | null =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of a base64url string (padding optional), or null when it is not one. */
export function unb64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[\w-]*={0,2}$/.test(text)) return null;
  const plain = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(atob(plain + "=".repeat((4 - (plain.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

function concat(...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A P-256 public key (65-byte uncompressed point) and optional private scalar as a JWK. */
function ecJwk(point: Uint8Array, d?: string): JsonWebKey {
  if (point.length !== 65 || point[0] !== 4) throw new Error("not an uncompressed P-256 point");
  return { kty: "EC", crv: "P-256", x: b64url(point.slice(1, 33)), y: b64url(point.slice(33)), ...(d ? { d } : {}) };
}

/** The ES256 signing key from the VAPID key pair; throws when the keys are malformed. */
export async function importVapidKey(keys: VapidKeys): Promise<CryptoKey> {
  const point = unb64url(keys.publicKey);
  if (!point) throw new Error("VAPID_PUBLIC_KEY is not base64url");
  return crypto.subtle.importKey("jwk", ecJwk(point, keys.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The VAPID JWT for a push service origin (RFC 8292 section 2), valid for 12 hours from `now`. */
export async function vapidJwt(key: CryptoKey, audience: string, now = Date.now()): Promise<string> {
  const part = (o: object) => b64url(enc.encode(JSON.stringify(o)));
  const input = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp: Math.floor(now / 1000) + JWT_HOURS * 3600, sub: SUBJECT })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input)); // raw r || s
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

async function hkdf(salt: Uint8Array, ikm: ArrayBuffer | Uint8Array<ArrayBuffer>, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** For the test vector only: a fixed salt and sender (application server) key pair instead of fresh ones. */
export type FixedKeys = { salt: Uint8Array<ArrayBuffer>; senderPublic: string; senderPrivate: string };

/** The aes128gcm body (RFC 8291 section 3 and 4) of `plaintext` for the subscription's keys. */
export async function encryptPayload(plaintext: Uint8Array, target: Pick<PushTarget, "p256dh" | "auth">, fixed?: FixedKeys): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = unb64url(target.p256dh);
  const authSecret = unb64url(target.auth);
  if (!uaPublic || uaPublic.length !== 65 || !authSecret || authSecret.length !== 16) throw new Error("bad subscription keys");
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("push payload too large");
  const ecdh = { name: "ECDH", namedCurve: "P-256" };

  let asPrivate: CryptoKey, asPublic: Uint8Array<ArrayBuffer>;
  if (fixed) {
    asPublic = unb64url(fixed.senderPublic)!;
    asPrivate = await crypto.subtle.importKey("jwk", ecJwk(asPublic, fixed.senderPrivate), ecdh, false, ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, ecdh, false, []);
  // Web Crypto's ECDH parameter is `public`; workers-types spells it `$public`.
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivate, 256);
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, [2])); // 0x02: last record, no padding
  const header = concat(salt, [0, 0, RECORD_SIZE >> 8, RECORD_SIZE & 0xff], [asPublic.length], asPublic); // salt, rs, idlen, keyid
  return concat(header, new Uint8Array(sealed));
}

/** Sends push messages for one run: the VAPID JWT is signed once per push service origin. */
export function pushSender(publicKey: string, signingKey: CryptoKey, now = Date.now()) {
  const jwts = new Map<string, Promise<string>>();
  return async (target: PushTarget, payload: string): Promise<Response> => {
    const audience = new URL(target.endpoint).origin;
    let jwt = jwts.get(audience);
    if (!jwt) jwts.set(audience, (jwt = vapidJwt(signingKey, audience, now)));
    const body = await encryptPayload(enc.encode(payload), target);
    return fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${await jwt}, k=${publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(TTL_SECONDS),
        Urgency: "normal",
      },
      body,
    });
  };
}
