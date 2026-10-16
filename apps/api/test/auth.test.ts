import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RECIPE, call, makeEnv, mockFetch, send, sessionCookie } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const withGoogle = () => ({ ...makeEnv(), GOOGLE_CLIENT_ID: CLIENT_ID }) as Env;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: unknown;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
});

function idToken(claims: Record<string, unknown> = {}, opts: { aud?: string; iss?: string; exp?: string | number } = {}) {
  return new SignJWT({ email: "user@example.com", email_verified: true, name: "Test User", picture: "https://lh3.example/p.jpg", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject(String(claims.sub ?? "google-sub-1"))
    .setIssuer(opts.iss ?? "https://accounts.google.com")
    .setAudience(opts.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(keys.privateKey);
}
const google = () => mockFetch((url) => (url.startsWith("https://www.googleapis.com/oauth2/v3/certs") ? Response.json(jwks) : new Response("unexpected", { status: 500 })));

async function signIn(claims: Record<string, unknown> = {}, anon?: string) {
  google();
  const res = await send("POST", "/api/auth/google", { credential: await idToken(claims), anon }, { env: withGoogle() });
  return { res, cookie: sessionCookie(res) };
}

describe("auth", () => {
  it("ayahshare.com, www and workers.dev: a bad Google token → 401; a good one → a host-only session cookie", async () => {
    for (const host of ["ayahshare.com", "www.ayahshare.com", "quran-design.rapid-sun-0190.workers.dev"]) {
      google();
      const write = async (credential: string) => call(`https://${host}/api/auth/google`, {
        method: "POST", headers: { Origin: `https://${host}`, "Content-Type": "application/json" }, body: JSON.stringify({ credential }),
      }, withGoogle());
      expect((await write("not-a-token")).status).toBe(401);
      expect((await write(await idToken({}, { aud: "someone-else" }))).status).toBe(401);
      const ok = await write(await idToken({ sub: `host-${host}` }));
      expect(ok.status).toBe(200);
      const setCookie = ok.headers.get("Set-Cookie")!;
      expect(setCookie).toMatch(/^__Host-qd_session=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/); // no Domain
      const me = await call(`https://${host}/api/me`, { headers: { Cookie: sessionCookie(ok) } });
      expect((await me.json<any>()).email).toBe("user@example.com");
    }
  });

  it("503 while GOOGLE_CLIENT_ID is not configured", async () => {
    const none = { ...makeEnv(), GOOGLE_CLIENT_ID: "" } as Env; // independent of the id configured in wrangler.jsonc
    expect((await send("POST", "/api/auth/google", { credential: "x" }, { env: none })).status).toBe(503);
  });

  it("verifies the Google ID token → user, session cookie (__Host-, HttpOnly, Secure, Lax, 30 days), device link, Me", async () => {
    const { res, cookie } = await signIn({}, "anon-auth-1");
    expect(res.status).toBe(200);
    const me = await res.json<any>();
    expect(me).toMatchObject({ name: "Test User", email: "user@example.com", avatar: "https://lh3.example/p.jpg" });
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/^__Host-qd_session=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    const token = cookie.split("=")[1];
    const session = await env.DB.prepare("SELECT id, user_id FROM sessions WHERE user_id = ?").bind(me.id).first<any>();
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(session.id).not.toContain(token); // only the hash is stored
    expect((await env.DB.prepare("SELECT user_id FROM devices WHERE anon_id = 'anon-auth-1'").first<any>()).user_id).toBe(me.id);

    expect(await (await call("/api/me", { headers: { Cookie: cookie } })).json()).toEqual(me);
    // Signing in again keeps the same user and updates the profile.
    const again = await signIn({ name: "Renamed" });
    expect((await again.res.json<any>())).toMatchObject({ id: me.id, name: "Renamed" });
  });

  it("rejects bad tokens: wrong audience, wrong issuer, expired, unverified email, garbage", async () => {
    google();
    const e = withGoogle();
    const tokens = [
      await idToken({}, { aud: "someone-else" }),
      await idToken({}, { iss: "https://evil.example" }),
      await idToken({}, { exp: Math.floor(Date.now() / 1000) - 60 }),
      await idToken({ email_verified: false }),
      "not-a-jwt",
    ];
    for (const credential of tokens) expect((await send("POST", "/api/auth/google", { credential }, { env: e })).status).toBe(401);
    expect((await send("POST", "/api/auth/google", {}, { env: e })).status).toBe(400);
  });

  it("GET /api/me without a session → 401; logout ends the session", async () => {
    expect((await call("/api/me")).status).toBe(401);
    const { cookie } = await signIn({ sub: "logout-user" });
    const out = await send("POST", "/api/auth/logout", undefined, { cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get("Set-Cookie")).toMatch(/^__Host-qd_session=; Max-Age=0/);
    expect((await call("/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("writes need the same origin", async () => {
    const { cookie } = await signIn({ sub: "csrf-user" });
    const res = await call("/api/me", { method: "DELETE", headers: { Cookie: cookie, Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect((await call("/api/me", { headers: { Cookie: cookie } })).status).toBe(200);
  });
});

describe("creations and favourites", () => {
  it("need a session", async () => {
    expect((await call("/api/creations")).status).toBe(401);
    expect((await call("/api/favourites")).status).toBe(401);
    expect((await send("PUT", "/api/favourites/2:255")).status).toBe(401);
  });

  it("creations: create, list newest first, delete own only", async () => {
    const { cookie } = await signIn({ sub: "creator" });
    const a = await (await send("POST", "/api/creations", { recipe: RECIPE, title: "  First  " }, { cookie })).json<any>();
    expect(a).toMatchObject({ title: "First", recipe: RECIPE });
    const b = await (await send("POST", "/api/creations", { recipe: { ...RECIPE, surah: 1, from: 1, to: 7 }, title: "Second" }, { cookie })).json<any>();
    const list = await (await call("/api/creations", { headers: { Cookie: cookie } })).json<any[]>();
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(list[1]).toEqual(a);
    expect((await send("POST", "/api/creations", { recipe: { ...RECIPE, v: 9 }, title: "x" }, { cookie })).status).toBe(400);

    const other = await signIn({ sub: "someone-else" });
    expect((await send("DELETE", `/api/creations/${a.id}`, undefined, { cookie: other.cookie })).status).toBe(404);
    expect((await send("DELETE", `/api/creations/${a.id}`, undefined, { cookie })).status).toBe(200);
    expect((await (await call("/api/creations", { headers: { Cookie: cookie } })).json<any[]>()).map((x) => x.id)).toEqual([b.id]);
  });

  it("favourites: put (idempotent), list, delete, validate refs", async () => {
    const { cookie } = await signIn({ sub: "fav-user" });
    for (const ref of ["2:255", "94:5", "2:255"]) expect((await send("PUT", `/api/favourites/${ref}`, undefined, { cookie })).status).toBe(200);
    expect(new Set(await (await call("/api/favourites", { headers: { Cookie: cookie } })).json<string[]>())).toEqual(new Set(["2:255", "94:5"]));
    expect((await send("PUT", "/api/favourites/115:1", undefined, { cookie })).status).toBe(400);
    await send("DELETE", "/api/favourites/2:255", undefined, { cookie });
    expect(await (await call("/api/favourites", { headers: { Cookie: cookie } })).json()).toEqual(["94:5"]);
  });

  it("DELETE /api/me removes the account, sessions, creations and favourites; devices/shares stay, unlinked", async () => {
    const { res, cookie } = await signIn({ sub: "leaving" }, "anon-leaving");
    const { id } = await res.json<any>();
    await send("POST", "/api/creations", { recipe: RECIPE, title: "t" }, { cookie });
    await send("PUT", "/api/favourites/1:1", undefined, { cookie });
    const share = await (await send("POST", "/api/shares", { recipe: RECIPE }, { cookie })).json<any>();
    expect((await env.DB.prepare("SELECT user_id FROM shares WHERE code = ?").bind(share.code).first<any>()).user_id).toBe(id);

    const del = await send("DELETE", "/api/me", undefined, { cookie });
    expect(del.status).toBe(200);
    expect(del.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    for (const table of ["users WHERE id", "sessions WHERE user_id", "creations WHERE user_id", "favourites WHERE user_id", "devices WHERE user_id", "shares WHERE user_id"]) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} = ?`).bind(id).first<any>()).n).toBe(0);
    }
    expect(await env.DB.prepare("SELECT 1 FROM devices WHERE anon_id = 'anon-leaving'").first()).not.toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM shares WHERE code = ?").bind(share.code).first()).not.toBeNull();
    expect((await call("/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("events from a signed-in browser link the device to the account (on its next app session)", async () => {
    const { res, cookie } = await signIn({ sub: "events-user" });
    const { id } = await res.json<any>();
    await send("POST", "/api/events", { events: [{ name: "app_open", ts: Date.now(), anon: "anon-linked", session: "s" }] }, { cookie });
    expect((await env.DB.prepare("SELECT user_id FROM devices WHERE anon_id = 'anon-linked'").first<any>()).user_id).toBe(id);
  });
});

describe("My language", () => {
  it("PUT /api/me/lang keeps the language with the account; /api/me and a new sign-in return it", async () => {
    const { res, cookie } = await signIn({ sub: "lang-user" });
    expect((await res.json<any>()).lang).toBeNull();
    const put = await send("PUT", "/api/me/lang", { lang: "ur" }, { cookie });
    expect(put.status).toBe(200);
    expect((await put.json<any>()).lang).toBe("ur");
    expect((await (await call("/api/me", { headers: { Cookie: cookie } })).json<any>()).lang).toBe("ur");
    expect((await (await signIn({ sub: "lang-user" })).res.json<any>()).lang).toBe("ur");
    for (const bad of [{ lang: "urdu" }, { lang: "UR" }, { lang: 5 }, {}]) {
      expect((await send("PUT", "/api/me/lang", bad, { cookie })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await (await send("PUT", "/api/me/lang", { lang: null }, { cookie })).json<any>()).lang).toBeNull();
    expect((await send("PUT", "/api/me/lang", { lang: "ur" })).status).toBe(401);
  });
});
