// Signing in through a fake Google: an RS256 key pair whose public half the mocked Google JWKS serves.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { makeEnv, mockFetch, send, sessionCookie } from "./helpers";

export const CLIENT_ID = "test-client.apps.googleusercontent.com";
export const withGoogle = (extra: Record<string, unknown> = {}) => ({ ...makeEnv(), GOOGLE_CLIENT_ID: CLIENT_ID, ...extra }) as Env;

let keys: Promise<{ privateKey: CryptoKey; jwks: unknown }> | null = null;
const keyPair = () => (keys ??= generateKeyPair("RS256").then(async (k) => ({
  privateKey: k.privateKey,
  jwks: { keys: [{ ...(await exportJWK(k.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] },
})));

/** Signs in as Google user `sub` (a new account the first time) → the session cookie and the response. */
export async function signIn(sub: string, claims: Record<string, unknown> = {}, env: Env = withGoogle()) {
  const { privateKey, jwks } = await keyPair();
  mockFetch((url) => (url.startsWith("https://www.googleapis.com/oauth2/v3/certs") ? Response.json(jwks) : new Response("unexpected", { status: 500 })));
  const credential = await new SignJWT({ email: `${sub}@example.com`, email_verified: true, name: `User ${sub}`, picture: null, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(sub).setIssuer("https://accounts.google.com").setAudience(CLIENT_ID)
    .setIssuedAt().setExpirationTime("1h").sign(privateKey);
  const res = await send("POST", "/api/auth/google", { credential }, { env });
  return { res, cookie: sessionCookie(res) };
}
