// The iOS / Android apps: their pages load from the device (capacitor://localhost, https://localhost) and call the API
// across origins with a Bearer session token; the web's cookie flow and same-origin rule stay as they were.
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { crossSite } from "../src/lib/http";
import { ORIGIN, RECIPE, call, makeEnv, mockFetch, send, sessionCookie } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const IOS = "capacitor://localhost";
const ANDROID = "https://localhost";
const CLIENT_ID = "web-client.apps.googleusercontent.com";
const withGoogle = () => ({ ...makeEnv(), GOOGLE_CLIENT_ID: CLIENT_ID }) as Env;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: unknown;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
});

const idToken = (sub: string) =>
  new SignJWT({ email: `${sub}@example.com`, email_verified: true, name: "App User" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(sub).setIssuer("https://accounts.google.com")
    .setAudience(CLIENT_ID).setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);

async function signIn(sub: string, origin: string) {
  mockFetch((url) => (url.startsWith("https://www.googleapis.com/oauth2/v3/certs") ? Response.json(jwks) : new Response("unexpected", { status: 500 })));
  return send("POST", "/api/auth/google", { credential: await idToken(sub) }, { env: withGoogle(), headers: { Origin: origin } });
}

const bearer = (token: string, origin = IOS) => ({ Authorization: `Bearer ${token}`, Origin: origin });

describe("CORS for the apps on /api/*", () => {
  it("answers the apps' preflight with their origin, methods and the Authorization header", async () => {
    for (const origin of [IOS, ANDROID]) {
      const res = await call("/api/creations", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Authorization,X-Anon");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    }
  });

  it("other origins get no CORS headers; reads from the apps do", async () => {
    const evil = await call("/api/config", { headers: { Origin: "https://evil.example" } });
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const app = await call("/api/config", { headers: { Origin: ANDROID } });
    expect(app.headers.get("Access-Control-Allow-Origin")).toBe(ANDROID);
    expect(app.headers.get("Vary")).toContain("Origin");
    expect((await app.json<any>()).appName).toBe("AyahShare");
  });

  it("writes from the apps pass the Origin check; other sites still get 403", async () => {
    const share = await send("POST", "/api/shares", { recipe: RECIPE }, { headers: { Origin: IOS } });
    expect(share.status).toBe(201);
    expect(share.headers.get("Access-Control-Allow-Origin")).toBe(IOS);
    expect((await send("POST", "/api/shares", { recipe: RECIPE }, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await send("POST", "/api/shares", { recipe: RECIPE }, { headers: { Origin: "http://localhost:5173" } })).status).toBe(403);
    // A beacon from the app (text/plain) reaches events.
    const events = await call("/api/events", {
      method: "POST", headers: { Origin: ANDROID, "Content-Type": "text/plain" },
      body: JSON.stringify({ events: [{ name: "app_open", ts: Date.now(), anon: "anon-app", session: "s" }] }),
    });
    expect(await events.json()).toEqual({ accepted: 1 });
  });

  it("other users of the CSRF check (admin) still refuse the apps' origins", async () => {
    const h = new Hono().post("/w", (c) => crossSite(c) ?? c.text("ok"));
    const post = (origin: string) => h.request("http://localhost/w", { method: "POST", headers: { Origin: origin } });
    expect((await post(IOS)).status).toBe(403);
    expect((await post(ANDROID)).status).toBe(403);
    expect((await post(ORIGIN)).status).toBe(200);
  });

  it("the public data files and proxies can be read from any origin", async () => {
    const clips = await call("/data/clips.json", { headers: { Origin: IOS } });
    expect(clips.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(Array.isArray(await clips.json())).toBe(true);
  });
});

describe("Bearer sessions for the apps", () => {
  it("sign-in from an app returns the session token; from the web it does not", async () => {
    const app = await signIn("app-user", IOS);
    expect(app.status).toBe(200);
    const me = await app.json<any>();
    expect(me.token).toMatch(/^[\w-]{43}$/);
    expect(me).toMatchObject({ name: "App User", email: "app-user@example.com" });

    const web = await signIn("web-user", ORIGIN);
    const webMe = await web.json<any>();
    expect(webMe.token).toBeUndefined();
    expect(sessionCookie(web)).not.toBe("");
  });

  it("the token signs requests in place of the cookie: me, creations, favourites, logout", async () => {
    const { token, id } = await (await signIn("bearer-user", ANDROID)).json<any>();
    const me = await call("/api/me", { headers: bearer(token, ANDROID) });
    expect(me.status).toBe(200);
    expect((await me.json<any>()).id).toBe(id);

    const created = await send("POST", "/api/creations", { recipe: RECIPE, title: "From the app" }, { headers: bearer(token, ANDROID) });
    expect(created.status).toBe(201);
    expect((await (await call("/api/creations", { headers: bearer(token, ANDROID) })).json<any[]>()).map((c) => c.title)).toEqual(["From the app"]);
    expect((await send("PUT", "/api/favourites/94:5", undefined, { headers: bearer(token, ANDROID) })).status).toBe(200);
    expect(await (await call("/api/favourites", { headers: bearer(token, ANDROID) })).json()).toEqual(["94:5"]);

    // A share made while signed in belongs to the user.
    const share = await (await send("POST", "/api/shares", { recipe: RECIPE }, { headers: bearer(token, ANDROID) })).json<any>();
    const { env } = await import("cloudflare:test");
    expect((await env.DB.prepare("SELECT user_id FROM shares WHERE code = ?").bind(share.code).first<any>()).user_id).toBe(id);

    expect((await send("POST", "/api/auth/logout", undefined, { headers: bearer(token, ANDROID) })).status).toBe(200);
    expect((await call("/api/me", { headers: bearer(token, ANDROID) })).status).toBe(401);
  });

  it("unknown or malformed tokens are not signed in", async () => {
    expect((await call("/api/me", { headers: bearer("x".repeat(43)) })).status).toBe(401);
    expect((await call("/api/me", { headers: bearer("not a token") })).status).toBe(401);
    expect((await call("/api/me", { headers: { Authorization: "Basic abc" } })).status).toBe(401);
  });

  it("DELETE /api/me with the token removes the account", async () => {
    const { token } = await (await signIn("leaving-app-user", IOS)).json<any>();
    expect((await send("DELETE", "/api/me", undefined, { headers: bearer(token) })).status).toBe(200);
    expect((await call("/api/me", { headers: bearer(token) })).status).toBe(401);
  });
});

describe("app links", () => {
  it("iOS: the team id in wrangler.jsonc names the app (Universal Links for share links)", async () => {
    const aasa = await call("/.well-known/apple-app-site-association");
    expect(aasa.headers.get("Content-Type")).toContain("application/json");
    expect(await aasa.json()).toEqual({
      applinks: { details: [{ appIDs: ["F9FZQJ3FT6.com.ayahshare.app"], components: [{ "/": "/s/*", comment: "share links" }] }] },
    });
  });

  it("serves placeholders until the team id and signing fingerprint are set", async () => {
    const e = { ...makeEnv(), APPLE_TEAM_ID: "", ANDROID_CERT_SHA256: "" } as Env;
    expect((await (await call("/.well-known/apple-app-site-association", {}, e)).json<any>()).applinks.details[0].appIDs).toEqual(["APPLE_TEAM_ID.com.ayahshare.app"]);
    const links = await (await call("/.well-known/assetlinks.json", {}, e)).json<any[]>();
    expect(links[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(links[0].target).toEqual({ namespace: "android_app", package_name: "com.ayahshare.app", sha256_cert_fingerprints: ["ANDROID_SIGNING_CERT_SHA256"] });
  });

  it("uses APPLE_TEAM_ID and ANDROID_CERT_SHA256 once configured", async () => {
    const e = { ...makeEnv(), APPLE_TEAM_ID: "ABCDE12345", ANDROID_CERT_SHA256: "AA:BB, CC:DD" } as Env;
    expect((await (await call("/.well-known/apple-app-site-association", {}, e)).json<any>()).applinks.details[0].appIDs).toEqual(["ABCDE12345.com.ayahshare.app"]);
    expect((await (await call("/.well-known/assetlinks.json", {}, e)).json<any[]>())[0].target.sha256_cert_fingerprints).toEqual(["AA:BB", "CC:DD"]);
  });
});
