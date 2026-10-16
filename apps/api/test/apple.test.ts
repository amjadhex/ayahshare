// Sign in with Apple (POST /api/auth/apple): a fake Apple — an RS256 key pair whose public half the mocked JWKS at
// https://appleid.apple.com/auth/keys serves.
import { env } from "cloudflare:test";
import { decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { APPLE_KEYS_URL, APPLE_REVOKE_URL, APPLE_TOKEN_URL, appleClientSecret, openAppleRefresh } from "../src/lib/apple";
import { signIn as googleSignIn, withGoogle } from "./google";
import { call, makeEnv, mockFetch, send, sessionCookie } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const BUNDLE_ID = "com.ayahshare.app";
const IOS = "capacitor://localhost";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>; // not Apple's
let jwks: unknown;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  other = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: "apple-1", alg: "RS256", use: "sig" }] };
});

const apple = () => mockFetch((url) => (url === APPLE_KEYS_URL ? Response.json(jwks) : new Response("unexpected", { status: 500 })));

function idToken(sub: string, claims: Record<string, unknown> = {}, opts: { aud?: string; iss?: string; exp?: string | number; key?: CryptoKey } = {}) {
  return new SignJWT({ email: `${sub}@example.com`, email_verified: "true", is_private_email: "false", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "apple-1" })
    .setSubject(sub)
    .setIssuer(opts.iss ?? "https://appleid.apple.com")
    .setAudience(opts.aud ?? BUNDLE_ID)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "10m")
    .sign(opts.key ?? keys.privateKey);
}

async function signIn(token: string | Promise<string>, extra: Record<string, unknown> = {}, opts: { env?: Env; headers?: Record<string, string> } = {}) {
  const res = await send("POST", "/api/auth/apple", { idToken: await token, ...extra }, { env: opts.env ?? makeEnv(), headers: opts.headers });
  return { res, cookie: sessionCookie(res) };
}
const userRow = (id: string) => env.DB.prepare("SELECT google_sub, apple_sub, email, name FROM users WHERE id = ?").bind(id).first<any>();

describe("Sign in with Apple", () => {
  // First, while nothing has Apple's keys yet (the keys are then kept in the isolate and the edge cache).
  it("503 when Apple's keys cannot be fetched", async () => {
    mockFetch(() => new Response("down", { status: 502 }));
    expect((await signIn(idToken("keys-down"))).res.status).toBe(503);
  });

  it("a valid identity token → a new account, session cookie and Me; the keys are fetched once, then cached", async () => {
    const fetched = apple();
    const { res, cookie } = await signIn(idToken("apple-new"), { anon: "anon-apple-1" });
    expect(res.status).toBe(200);
    const me = await res.json<any>();
    expect(me).toMatchObject({ email: "apple-new@example.com", name: "", avatar: null });
    expect(me.token).toBeUndefined(); // the web never gets the token
    expect(await userRow(me.id)).toEqual({ google_sub: `apple:${me.id}`, apple_sub: "apple-new", email: "apple-new@example.com", name: "" });
    expect((await env.DB.prepare("SELECT user_id FROM devices WHERE anon_id = 'anon-apple-1'").first<any>()).user_id).toBe(me.id);
    expect((await (await call("/api/me", { headers: { Cookie: cookie } })).json<any>()).id).toBe(me.id);
    expect(fetched).toHaveBeenCalledTimes(1);

    const again = apple();
    const second = await signIn(idToken("apple-new"));
    expect((await second.res.json<any>()).id).toBe(me.id); // same Apple id → same account
    expect(again).not.toHaveBeenCalled();
  });

  it("the iOS app gets the session token (Bearer) and CORS", async () => {
    apple();
    const { res } = await signIn(idToken("apple-ios"), {}, { headers: { Origin: IOS } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(IOS);
    const { token, id } = await res.json<any>();
    expect(token).toMatch(/^[\w-]{43}$/);
    const read = await call("/api/me", { headers: { Authorization: `Bearer ${token}`, Origin: IOS } });
    expect((await read.json<any>()).id).toBe(id);
  });

  it("rejects: wrong audience, wrong issuer, expired, bad signature, garbage, missing token", async () => {
    apple();
    const status = async (t: string | Promise<string>) => (await signIn(t)).res.status;
    expect(await status(idToken("bad-1", {}, { aud: "com.someone.else" }))).toBe(401);
    expect(await status(idToken("bad-2", {}, { iss: "https://accounts.google.com" }))).toBe(401);
    expect(await status(idToken("bad-3", {}, { exp: Math.floor(Date.now() / 1000) - 60 }))).toBe(401);
    expect(await status(idToken("bad-4", {}, { key: other.privateKey }))).toBe(401); // same kid, signed by someone else
    expect(await status("not.a.token")).toBe(401);
    expect((await send("POST", "/api/auth/apple", {}, { env: makeEnv() })).status).toBe(400);
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE apple_sub LIKE 'bad-%'").first()).toBeNull();
  });

  it("APPLE_CLIENT_IDS sets the audiences (comma-separated)", async () => {
    apple();
    const e = { ...makeEnv(), APPLE_CLIENT_IDS: "com.example.web, com.example.other" } as Env;
    expect((await signIn(idToken("aud-1", {}, { aud: "com.example.other" }), {}, { env: e })).res.status).toBe(200);
    expect((await signIn(idToken("aud-2"), {}, { env: e })).res.status).toBe(401); // the default is replaced
  });

  it("joins the existing account with the same verified email (not a relay); keeps its name and email", async () => {
    const g = await googleSignIn("4242", { email: "Linked@Example.com", name: "Google Name" }, withGoogle());
    const google = await g.res.json<any>();
    apple();
    const { res } = await signIn(idToken("apple-link", { email: "linked@example.com" }), { name: "Apple Name" });
    const me = await res.json<any>();
    expect(me.id).toBe(google.id);
    expect(me.name).toBe("Google Name");
    expect(await userRow(me.id)).toMatchObject({ google_sub: "4242", apple_sub: "apple-link", email: "Linked@Example.com" });
  });

  it("an unverified email never joins an account: a new one is made", async () => {
    const g = await googleSignIn("4343", { email: "unverified@example.com" }, withGoogle());
    const google = await g.res.json<any>();
    apple();
    const me = await (await signIn(idToken("apple-unverified", { email: "unverified@example.com", email_verified: "false" }))).res.json<any>();
    expect(me.id).not.toBe(google.id);
    expect(await userRow(me.id)).toMatchObject({ apple_sub: "apple-unverified", email: "unverified@example.com" });
  });

  it("a private relay address makes a new account, even when an account has that address", async () => {
    const relay = "x7k2p9@privaterelay.appleid.com";
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, created_at, last_login) VALUES ('relay-owner', 'email:relay-owner', ?, '', 1, 1)")
      .bind(relay).run();
    apple();
    const me = await (await signIn(idToken("apple-relay", { email: relay, is_private_email: "true" }))).res.json<any>();
    expect(me.id).not.toBe("relay-owner");
    expect(await userRow(me.id)).toEqual({ google_sub: `apple:${me.id}`, apple_sub: "apple-relay", email: relay, name: "" });
    expect((await userRow("relay-owner")).apple_sub).toBeNull();
    // Recognised by its domain alone too (boolean claims as Apple may send them).
    const byDomain = await (await signIn(idToken("apple-relay-2", { email: "q1w2@privaterelay.appleid.com", email_verified: true, is_private_email: undefined }))).res.json<any>();
    expect((await userRow(byDomain.id)).google_sub).toBe(`apple:${byDomain.id}`);
  });

  it("the name Apple gives on the first sign-in names the new account; later names never replace it", async () => {
    apple();
    const first = await (await signIn(idToken("apple-named"), { name: "  Amina Khan  " })).res.json<any>();
    expect(first.name).toBe("Amina Khan");
    const later = await (await signIn(idToken("apple-named"), { name: "Someone Else" })).res.json<any>();
    expect(later).toMatchObject({ id: first.id, name: "Amina Khan" });
    // An account without a name takes it.
    const nameless = await (await signIn(idToken("apple-nameless"))).res.json<any>();
    expect(nameless.name).toBe("");
    expect((await (await signIn(idToken("apple-nameless"), { name: "Late Name" })).res.json<any>()).name).toBe("Late Name");
  });

  it("Google with the same verified email joins an account Apple made", async () => {
    apple();
    const made = await (await signIn(idToken("apple-first", { email: "both@example.com" }))).res.json<any>();
    const g = await googleSignIn("5151", { email: "both@example.com" }, withGoogle());
    expect((await g.res.json<any>()).id).toBe(made.id);
    expect(await userRow(made.id)).toMatchObject({ google_sub: "5151", apple_sub: "apple-first" });
  });

  it("DELETE /api/me removes an Apple account; signing in again makes a new one", async () => {
    apple();
    const { res, cookie } = await signIn(idToken("apple-leaving"));
    const { id } = await res.json<any>();
    expect((await send("DELETE", "/api/me", undefined, { cookie })).status).toBe(200);
    expect(await userRow(id)).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").bind(id).first<any>()).n).toBe(0);
    const again = await (await signIn(idToken("apple-leaving"))).res.json<any>();
    expect(again.id).not.toBe(id);
  });
});

// Token revocation (guideline 5.1.1(v)): a fake Apple token and revoke endpoint, and a generated P-256 key standing in
// for the .p8 (APPLE_SIGNIN_KEY). The ids come from wrangler.jsonc (APPLE_TEAM_ID, APPLE_KEY_ID).
describe("Sign in with Apple: refresh token and revocation", () => {
  let p8: { privateKey: CryptoKey; publicKey: CryptoKey; pem: string };
  beforeAll(async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    p8 = { ...pair, pem: await exportPKCS8(pair.privateKey) };
  });
  const keyed = (extra: Record<string, unknown> = {}) =>
    ({ ...makeEnv(), APPLE_SIGNIN_KEY: p8.pem, AUTH_CODE_SECRET: "test-code-secret", ...extra }) as Env;

  type Call = { url: string; form: URLSearchParams };
  /** Apple's keys, token and revoke endpoints; `token` / `revoke` answer those two (default: a good answer). */
  function fakeApple(opts: { token?: (form: URLSearchParams) => Response | Promise<Response>; revoke?: () => Response | Promise<Response> } = {}) {
    const calls: Call[] = [];
    mockFetch(async (url, init) => {
      if (url === APPLE_KEYS_URL) return Response.json(jwks);
      const form = new URLSearchParams(String(init?.body));
      calls.push({ url, form });
      if (url === APPLE_TOKEN_URL) {
        if (opts.token) return opts.token(form);
        const sub = form.get("code")!.replace(/^code-/, "");
        return Response.json({ access_token: "at", token_type: "Bearer", expires_in: 3600, refresh_token: `rt-${sub}`, id_token: await idToken(sub) });
      }
      if (url === APPLE_REVOKE_URL) return opts.revoke ? opts.revoke() : new Response(null, { status: 200 });
      return new Response("unexpected", { status: 500 });
    });
    return calls;
  }
  const stored = async (id: string) =>
    (await env.DB.prepare("SELECT apple_refresh FROM users WHERE id = ?").bind(id).first<{ apple_refresh: string | null }>())?.apple_refresh;

  it("the client secret: ES256, kid = APPLE_KEY_ID, iss = team, sub = the app, aud = Apple, at most 6 months; kept", async () => {
    const e = keyed();
    const jwt = await appleClientSecret(e);
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "JCMSTAL9C4" });
    const { payload } = await jwtVerify(jwt, p8.publicKey, { algorithms: ["ES256"] });
    expect(payload).toMatchObject({ iss: "F9FZQJ3FT6", sub: BUNDLE_ID, aud: "https://appleid.apple.com" });
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs(payload.iat! - now)).toBeLessThan(10);
    expect(payload.exp! - payload.iat!).toBeGreaterThanOrEqual(3600);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(180 * 86400);
    expect(await appleClientSecret(e)).toBe(jwt); // reused within the hour
  });

  it("the authorization code is exchanged and the refresh token kept, encrypted", async () => {
    const calls = fakeApple();
    const e = keyed();
    const { res } = await signIn(idToken("rv-keep"), { authorizationCode: "code-rv-keep" }, { env: e });
    expect(res.status).toBe(200);
    const { id } = await res.json<any>();
    expect(calls).toHaveLength(1);
    const { url, form } = calls[0];
    expect(url).toBe(APPLE_TOKEN_URL);
    expect(Object.fromEntries([...form].filter(([k]) => k !== "client_secret")))
      .toEqual({ client_id: BUNDLE_ID, grant_type: "authorization_code", code: "code-rv-keep" });
    await jwtVerify(form.get("client_secret")!, p8.publicKey, { issuer: "F9FZQJ3FT6", subject: BUNDLE_ID, audience: "https://appleid.apple.com" });
    const kept = (await stored(id))!;
    expect(kept).toMatch(/^v1:/);
    expect(kept).not.toContain("rt-rv-keep");
    expect(await openAppleRefresh(e, id, kept)).toBe("rt-rv-keep");
    await expect(openAppleRefresh(e, "another-user", kept)).rejects.toThrow(); // bound to its row
  });

  it("no authorization code (iOS build 1): signs in as before; nothing is exchanged or kept", async () => {
    const calls = fakeApple();
    const { res } = await signIn(idToken("rv-old"), {}, { env: keyed() });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(await stored((await res.json<any>()).id)).toBeNull();
  });

  it("a failed exchange still signs in (Apple refuses, is down, or the code is someone else's)", async () => {
    const answers = [
      () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      () => { throw new TypeError("network down"); },
      async () => Response.json({ refresh_token: "rt-x", id_token: await idToken("someone-else") }),
      () => Response.json({ access_token: "at" }), // no refresh token
    ];
    for (const [i, token] of answers.entries()) {
      const calls = fakeApple({ token });
      const { res, cookie } = await signIn(idToken(`rv-fail-${i}`), { authorizationCode: `code-rv-fail-${i}` }, { env: keyed() });
      expect(res.status).toBe(200);
      expect(cookie).not.toBe("");
      expect(calls.map((c) => c.url)).toEqual([APPLE_TOKEN_URL]);
      expect(await stored((await res.json<any>()).id)).toBeNull();
    }
  });

  it("without APPLE_SIGNIN_KEY the code is ignored", async () => {
    const calls = fakeApple();
    const { res } = await signIn(idToken("rv-nokey"), { authorizationCode: "code-rv-nokey" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(await stored((await res.json<any>()).id)).toBeNull();
  });

  it("DELETE /api/me revokes the refresh token with Apple, then deletes the account", async () => {
    const e = keyed();
    let rowAtRevoke: unknown = "not called";
    let id = "";
    const calls = fakeApple({
      revoke: async () => {
        rowAtRevoke = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
        return new Response(null, { status: 200 });
      },
    });
    const { res, cookie } = await signIn(idToken("rv-delete"), { authorizationCode: "code-rv-delete" }, { env: e });
    id = (await res.json<any>()).id;
    expect((await send("DELETE", "/api/me", undefined, { cookie, env: e })).status).toBe(200);
    const revoke = calls.find((c) => c.url === APPLE_REVOKE_URL)!;
    expect(Object.fromEntries([...revoke.form].filter(([k]) => k !== "client_secret")))
      .toEqual({ client_id: BUNDLE_ID, token: "rt-rv-delete", token_type_hint: "refresh_token" });
    await jwtVerify(revoke.form.get("client_secret")!, p8.publicKey, { issuer: "F9FZQJ3FT6", subject: BUNDLE_ID, audience: "https://appleid.apple.com" });
    expect(rowAtRevoke).toEqual({ id }); // before the row went
    expect(await userRow(id)).toBeNull();
  });

  it("a failed revocation does not stop the deletion", async () => {
    for (const revoke of [() => new Response("{\"error\":\"invalid_client\"}", { status: 400 }), (): Response => { throw new TypeError("network down"); }]) {
      const e = keyed();
      const calls = fakeApple({ revoke });
      const { res, cookie } = await signIn(idToken("rv-revoke-fails"), { authorizationCode: "code-rv-revoke-fails" }, { env: e });
      const { id } = await res.json<any>();
      expect(await stored(id)).toMatch(/^v1:/);
      expect((await send("DELETE", "/api/me", undefined, { cookie, env: e })).status).toBe(200);
      expect(calls.map((c) => c.url)).toEqual([APPLE_TOKEN_URL, APPLE_REVOKE_URL]);
      expect(await userRow(id)).toBeNull();
    }
  });

  it("nothing to revoke (no refresh token, or no key set): the account is deleted without calling Apple", async () => {
    // Signed in without a code: an apple_sub but no refresh token.
    let calls = fakeApple();
    const old = await signIn(idToken("rv-norefresh"), {}, { env: keyed() });
    const oldId = (await old.res.json<any>()).id;
    expect((await send("DELETE", "/api/me", undefined, { cookie: old.cookie, env: keyed() })).status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(await userRow(oldId)).toBeNull();
    // A kept token, but the key is gone by the time of deletion.
    calls = fakeApple();
    const kept = await signIn(idToken("rv-keygone"), { authorizationCode: "code-rv-keygone" }, { env: keyed() });
    const keptId = (await kept.res.json<any>()).id;
    expect(await stored(keptId)).toMatch(/^v1:/);
    expect((await send("DELETE", "/api/me", undefined, { cookie: kept.cookie, env: keyed({ APPLE_SIGNIN_KEY: undefined }) })).status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([APPLE_TOKEN_URL]);
    expect(await userRow(keptId)).toBeNull();
  });

  it("without AUTH_CODE_SECRET the refresh token is kept as it is, and still revoked", async () => {
    const e = keyed({ AUTH_CODE_SECRET: undefined });
    const calls = fakeApple();
    const { res, cookie } = await signIn(idToken("rv-plain"), { authorizationCode: "code-rv-plain" }, { env: e });
    const { id } = await res.json<any>();
    expect(await stored(id)).toBe("rt-rv-plain");
    expect((await send("DELETE", "/api/me", undefined, { cookie, env: e })).status).toBe(200);
    expect(calls.find((c) => c.url === APPLE_REVOKE_URL)!.form.get("token")).toBe("rt-rv-plain");
    expect(await userRow(id)).toBeNull();
  });
});
