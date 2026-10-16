// Email sign-in: a 6-digit code by email (POST /api/auth/email/start, /verify). The Email Sending binding is a fake that
// keeps what it was asked to send.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalEmail } from "../src/routes/auth";
import { CLIENT_ID, signIn } from "./google";
import { call, makeEnv, mockFetch, send, sessionCookie } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const IOS = "capacitor://localhost";
type Sent = { from: { name: string; email: string }; to: string; subject: string; text: string; html: string };

/** An env with email sign-in on (and Google, for the joining tests); `fail` makes every send throw. */
function mailer(opts: { fail?: boolean; secret?: string | null; bound?: boolean } = {}) {
  const sent: Sent[] = [];
  const EMAIL = {
    send: vi.fn(async (m: Sent) => {
      if (opts.fail) throw new Error(`domain not onboarded; could not send ${m.subject} to ${m.to}`);
      sent.push(m);
      return { messageId: `m${sent.length}` };
    }),
  };
  const e = {
    ...makeEnv(), GOOGLE_CLIENT_ID: CLIENT_ID,
    EMAIL: opts.bound === false ? undefined : EMAIL, // the pool binds wrangler.jsonc's EMAIL itself; never used here
    ...(opts.secret === null ? {} : { AUTH_CODE_SECRET: opts.secret ?? "test-code-secret" }),
  } as unknown as Env;
  return { env: e, sent, EMAIL, last: () => sent[sent.length - 1], code: () => sent[sent.length - 1].subject.match(/(\d{6})$/)![1] };
}

const start = (e: Env, email: unknown, headers: Record<string, string> = {}) => send("POST", "/api/auth/email/start", { email }, { env: e, headers });
const verify = (e: Env, email: string, code: string, headers: Record<string, string> = {}, anon?: string) =>
  send("POST", "/api/auth/email/verify", { email, code, anon }, { env: e, headers });
const row = (email: string) => env.DB.prepare("SELECT * FROM email_codes WHERE email = ?").bind(email).first<any>();
/** As if the last code had been sent `ms` ago (past the 30 s wait). */
const age = (email: string, ms = 31_000) => env.DB.prepare("UPDATE email_codes SET created_at = created_at - ? WHERE email = ?").bind(ms, email).run();
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("email sign-in: configuration", () => {
  it("is offered only with the EMAIL binding and AUTH_CODE_SECRET; otherwise start and verify answer 503 unavailable", async () => {
    const config = async (e: Env) => (await (await call("/api/config", {}, e)).json<any>()).emailSignIn;
    expect(await config(makeEnv())).toBe(false);
    for (const off of [mailer({ bound: false }), mailer({ secret: null })]) {
      expect(await config(off.env)).toBe(false);
      const s = await start(off.env, "someone@example.com");
      expect(s.status).toBe(503);
      expect(await s.json()).toEqual({ error: "unavailable" });
      expect((await verify(off.env, "someone@example.com", "123456")).status).toBe(503);
      expect(off.EMAIL.send).not.toHaveBeenCalled();
    }
    expect(await config(mailer().env)).toBe(true);
  });
});

describe("email sign-in", () => {
  it("start sends one code (only its keyed hash is stored); verify signs up with a host-only cookie; the code works once", async () => {
    const m = mailer();
    const res = await start(m.env, "  New.Person@Example.COM ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.EMAIL.send).toHaveBeenCalledTimes(1);
    const mail = m.last();
    const code = m.code();
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.from).toEqual({ name: "AyahShare", email: "hello@ayahshare.com" });
    expect(mail.to).toBe("new.person@example.com");
    expect(mail.subject).toBe(`Your AyahShare code: ${code}`);
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain(code);
      expect(body).toContain("It expires in 10 minutes.");
      expect(body).toContain("If you didn't ask for this, you can ignore this email.");
    }
    expect(mail.html).not.toMatch(/<script|url\(/i); // no scripts, no tracking
    expect([...mail.html.matchAll(/<img[^>]*src="([^"]*)"/g)].map((x) => x[1])).toEqual(["https://ayahshare.com/brand/email-lockup.png"]); // only our logo
    expect([...mail.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1])).toEqual(["https://ayahshare.com"]);
    const stored = await row("new.person@example.com");
    expect(stored).toMatchObject({ attempts: 0, sends: 1 });
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.code_hash).not.toContain(code);
    expect(stored.expires_at - stored.created_at).toBe(10 * 60_000);

    const ok = await verify(m.env, "new.person@example.com", code, {}, "anon-email-1");
    expect(ok.status).toBe(200);
    const me = await ok.json<any>();
    expect(me).toMatchObject({ email: "new.person@example.com", name: "", avatar: null });
    expect(me.token).toBeUndefined(); // the web has the cookie only
    expect(ok.headers.get("Set-Cookie")).toMatch(/^__Host-qd_session=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect((await (await call("/api/me", { headers: { Cookie: sessionCookie(ok) } })).json<any>()).id).toBe(me.id);
    expect((await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(me.id).first<any>()).google_sub).toBe(`email:${me.id}`);
    expect((await env.DB.prepare("SELECT user_id FROM devices WHERE anon_id = 'anon-email-1'").first<any>()).user_id).toBe(me.id);
    expect((await row("new.person@example.com")).code_hash).toBeNull(); // used

    const again = await verify(m.env, "new.person@example.com", code);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: "expired" });

    // A later sign-in by email finds the same account.
    await age("new.person@example.com");
    await start(m.env, "new.person@example.com");
    expect((await (await verify(m.env, "NEW.person@example.com", m.code())).json<any>()).id).toBe(me.id);
  });

  it("the iOS / Android app gets the session token and uses it as a Bearer header", async () => {
    const m = mailer();
    expect((await start(m.env, "app.user@example.com", { Origin: IOS })).status).toBe(200);
    const res = await verify(m.env, "app.user@example.com", m.code(), { Origin: IOS });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(IOS);
    const { token, ...me } = await res.json<any>();
    expect(token).toMatch(/^[\w-]{43}$/);
    const read = await call("/api/me", { headers: { Authorization: `Bearer ${token}`, Origin: IOS } });
    expect(await read.json()).toEqual(me);
  });

  it("a wrong code → 401 wrong_code; the right one still works after it", async () => {
    const m = mailer();
    await start(m.env, "typo@example.com");
    const bad = await verify(m.env, "typo@example.com", wrong(m.code()));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "wrong_code" });
    expect((await row("typo@example.com")).attempts).toBe(1);
    expect((await verify(m.env, "typo@example.com", m.code())).status).toBe(200);
  });

  it("five wrong guesses void the code (429 too_many_attempts, even for the right one); a new code works", async () => {
    const m = mailer();
    await start(m.env, "guesser@example.com");
    const code = m.code();
    for (let i = 0; i < 4; i++) expect((await verify(m.env, "guesser@example.com", wrong(code))).status).toBe(401);
    const fifth = await verify(m.env, "guesser@example.com", wrong(code));
    expect(fifth.status).toBe(429);
    expect(await fifth.json()).toEqual({ error: "too_many_attempts" });
    const right = await verify(m.env, "guesser@example.com", code);
    expect(right.status).toBe(429);
    expect(await right.json()).toEqual({ error: "too_many_attempts" });
    expect((await row("guesser@example.com")).attempts).toBe(5);

    await age("guesser@example.com");
    await start(m.env, "guesser@example.com");
    expect((await row("guesser@example.com")).attempts).toBe(0);
    expect((await verify(m.env, "guesser@example.com", m.code())).status).toBe(200);
  });

  it("guesses sent all at once still get five in all", async () => {
    const m = mailer();
    await start(m.env, "burst@example.com");
    const statuses = await Promise.all(Array.from({ length: 12 }, () => verify(m.env, "burst@example.com", wrong(m.code())).then((r) => r.status)));
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
    expect(statuses.filter((s) => s === 429)).toHaveLength(8);
    expect((await verify(m.env, "burst@example.com", m.code())).status).toBe(429);
  });

  it("an expired code, or none at all → 410 expired; a new code replaces the old one", async () => {
    const m = mailer();
    expect(await (await verify(m.env, "nobody-asked@example.com", "123456")).json()).toEqual({ error: "expired" });
    await start(m.env, "late@example.com");
    const first = m.code();
    await env.DB.prepare("UPDATE email_codes SET expires_at = ? WHERE email = 'late@example.com'").bind(Date.now() - 1).run();
    const late = await verify(m.env, "late@example.com", first);
    expect(late.status).toBe(410);
    expect(await late.json()).toEqual({ error: "expired" });

    await age("late@example.com");
    await start(m.env, "late@example.com");
    const second = m.code();
    if (second !== first) expect((await verify(m.env, "late@example.com", first)).status).toBe(401); // the old one is gone
    expect((await verify(m.env, "late@example.com", second)).status).toBe(200);
  });

  it("per address: one code per 30 s and five an hour (429), whatever the client", async () => {
    const m = mailer();
    const a = "busy@example.com";
    expect((await start(m.env, a)).status).toBe(200);
    const soon = await start(m.env, a);
    expect(soon.status).toBe(429);
    expect(soon.headers.get("Retry-After")).toBe("30");
    for (let i = 2; i <= 5; i++) {
      await age(a);
      expect((await start(m.env, a)).status, `code ${i}`).toBe(200);
    }
    await age(a);
    expect((await start(m.env, a)).status).toBe(429); // the sixth within the hour
    expect(m.EMAIL.send).toHaveBeenCalledTimes(5);
    await env.DB.prepare("UPDATE email_codes SET window_start = window_start - 3600000 WHERE email = ?").bind(a).run();
    expect((await start(m.env, a)).status).toBe(200); // a new hour
    expect((await row(a)).sends).toBe(1);
  });

  it("per client IP: at most 20 starts and verifies a minute", async () => {
    const m = mailer();
    const ip = { "CF-Connecting-IP": "203.0.113.77" };
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await start(m.env, `ip-${i}@example.com`, ip)).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect((await verify(m.env, "ip-0@example.com", "123456", ip)).status).toBe(429);
    expect((await start(m.env, "ip-other@example.com", { "CF-Connecting-IP": "203.0.113.78" })).status).toBe(200);
  });

  it("answers the same whether or not the address has an account (no enumeration)", async () => {
    const m = mailer();
    await signIn("enum-google", { email: "member@example.com" }, m.env);
    const known = await start(m.env, "member@example.com");
    const unknown = await start(m.env, "stranger@example.com");
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(await known.text()).toBe(await unknown.text());
    expect([...known.headers.keys()].sort()).toEqual([...unknown.headers.keys()].sort());
    expect(m.EMAIL.send).toHaveBeenCalledTimes(2);
  });

  it("checks addresses and codes", async () => {
    const m = mailer();
    for (const bad of ["", "plain", "a@b", "a@-b.com", "a b@example.com", "a@example.com\r\nBcc: x@evil.example", ".a@example.com",
      "a..b@example.com", "<a@example.com>", `${"x".repeat(65)}@example.com`, `a@${"b".repeat(250)}.com`, "üser@example.com", 5, null]) {
      expect((await start(m.env, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(m.EMAIL.send).not.toHaveBeenCalled();
    expect(normalEmail(" Some.One+tag@Mail.Example.co.uk ")).toBe("some.one+tag@mail.example.co.uk");
    expect(normalEmail("x@xn--80ak6aa92e.xn--p1ai")).toBe("x@xn--80ak6aa92e.xn--p1ai");
    for (const code of ["12345", "1234567", "12345a", "", "12 456"]) {
      expect((await verify(m.env, "someone@example.com", code)).status, code).toBe(400);
    }
    expect((await send("POST", "/api/auth/email/verify", { email: "someone@example.com", code: 123456 }, { env: m.env })).status).toBe(400);
  });

  it("writes need the same origin (or the apps) and a JSON body", async () => {
    const m = mailer();
    for (const headers of [{ Origin: "https://evil.example" }, { Origin: "http://localhost:5173" }]) {
      expect((await start(m.env, "csrf@example.com", headers)).status).toBe(403);
      expect((await verify(m.env, "csrf@example.com", "123456", headers)).status).toBe(403);
    }
    const noOrigin = await call("/api/auth/email/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "csrf@example.com" }) }, m.env);
    expect(noOrigin.status).toBe(403);
    const form = await call("/api/auth/email/start", {
      method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/x-www-form-urlencoded" }, body: "email=csrf%40example.com",
    }, m.env);
    expect(form.status).toBe(415);
    expect(m.EMAIL.send).not.toHaveBeenCalled();
  });

  it("a failed send → 503 unavailable, logged without the code or the address; trying again is allowed at once", async () => {
    const failing = mailer({ fail: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await start(failing.env, "unlucky@example.com");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("example.com");
    expect(logged).not.toContain("unlucky");
    expect(logged).not.toMatch(/\d{6}/);
    expect((await row("unlucky@example.com")).code_hash).toBeNull();

    const working = mailer();
    expect((await start(working.env, "unlucky@example.com")).status).toBe(200); // no 30 s wait after a failure
    expect((await verify(working.env, "unlucky@example.com", working.code())).status).toBe(200);
  });
});

describe("email and Google are one account", () => {
  it("email first, then Google with the same verified email: Google joins that account (no second one)", async () => {
    const m = mailer();
    await start(m.env, "first.email@example.com");
    const byEmail = await (await verify(m.env, "first.email@example.com", m.code())).json<any>();
    const { res } = await signIn("join-sub-1", { email: "First.Email@example.com", name: "Joined Person", picture: "https://lh3.example/j.jpg" }, m.env);
    const byGoogle = await res.json<any>();
    expect(byGoogle).toMatchObject({ id: byEmail.id, name: "Joined Person", avatar: "https://lh3.example/j.jpg" });
    expect((await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(byEmail.id).first<any>()).google_sub).toBe("join-sub-1");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'first.email@example.com'").first<any>()).n).toBe(1);
    // Both ways keep reaching it.
    expect((await (await signIn("join-sub-1", { email: "first.email@example.com" }, m.env)).res.json<any>()).id).toBe(byEmail.id);
    await age("first.email@example.com");
    await start(m.env, "first.email@example.com");
    expect((await (await verify(m.env, "first.email@example.com", m.code())).json<any>()).id).toBe(byEmail.id);
  });

  it("Google first, then email: the code signs into the Google account", async () => {
    const m = mailer();
    const google = await (await signIn("google-first", { email: "Google.First@example.com" }, m.env)).res.json<any>();
    await start(m.env, "google.first@example.com");
    const byEmail = await (await verify(m.env, "google.first@example.com", m.code())).json<any>();
    expect(byEmail.id).toBe(google.id);
    expect(byEmail.name).toBe("User google-first");
    expect((await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(google.id).first<any>()).google_sub).toBe("google-first");
  });

  it("Google without a verified email, or a second Google account, does not take over an email account", async () => {
    const m = mailer();
    await start(m.env, "kept@example.com");
    const byEmail = await (await verify(m.env, "kept@example.com", m.code())).json<any>();
    const unverified = await (await signIn("no-verified-claim", { email: "kept@example.com", email_verified: undefined }, m.env)).res.json<any>();
    expect(unverified.id).not.toBe(byEmail.id);
    expect((await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(byEmail.id).first<any>()).google_sub).toBe(`email:${byEmail.id}`);

    // Once joined to one Google account, another Google account with that email gets its own.
    const joined = await (await signIn("owner-sub", { email: "kept@example.com" }, m.env)).res.json<any>();
    expect(joined.id).toBe(byEmail.id);
    const other = await (await signIn("other-sub", { email: "kept@example.com" }, m.env)).res.json<any>();
    expect(other.id).not.toBe(byEmail.id);
  });
});

describe("Turnstile before a code is sent", () => {
  const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  const PASS = { success: true, hostname: "localhost", action: "email-code", "error-codes": [] };
  const VERDICTS: Record<string, unknown> = {
    good: PASS,
    "good-site": { ...PASS, hostname: "ayahshare.com" },
    "other-host": { ...PASS, hostname: "evil.example" },
    "other-action": { ...PASS, action: "login" },
  };
  /** Email sign-in with Turnstile on; siteverify is a fake that knows the tokens above (anything else fails). */
  function guarded(keys: { site?: string; secret?: string } = { site: "0x4AAAAAAAtest", secret: "ts-secret" }, broken = false) {
    const m = mailer();
    const e = { ...m.env, TURNSTILE_SITE_KEY: keys.site ?? "", TURNSTILE_SECRET: keys.secret } as Env;
    const siteverify = mockFetch((url, init) => {
      if (url !== SITEVERIFY) return new Response("unexpected", { status: 500 });
      if (broken) return new Response("busy", { status: 502 });
      const body = JSON.parse(String(init!.body));
      return Response.json(VERDICTS[body.response] ?? { success: false, "error-codes": ["invalid-input-response"] });
    });
    return { ...m, env: e, siteverify };
  }
  const startWith = (e: Env, email: string, turnstile?: unknown, headers: Record<string, string> = {}) =>
    send("POST", "/api/auth/email/start", { email, turnstile }, { env: e, headers });

  it("/api/config gives the site key only when the secret is set too", async () => {
    const key = async (e: Env) => (await (await call("/api/config", {}, e)).json<any>()).turnstileSiteKey;
    expect(await key(guarded().env)).toBe("0x4AAAAAAAtest");
    expect(await key(guarded({ site: "0x4AAAAAAAtest" }).env)).toBeUndefined();
    expect(await key(guarded({ secret: "ts-secret" }).env)).toBeUndefined();
    expect(await key(mailer().env)).toBeUndefined(); // wrangler.jsonc's empty TURNSTILE_SITE_KEY
  });

  it("configured: no token, a bad one, another hostname or action → 403 bot_check, nothing sent or counted", async () => {
    const g = guarded();
    for (const token of [undefined, "", 42, "forged", "other-host", "other-action", "x".repeat(2049)]) {
      const res = await startWith(g.env, "bot-target@example.com", token);
      expect(res.status, String(token)).toBe(403);
      expect(await res.json()).toEqual({ error: "bot_check" });
    }
    expect(g.EMAIL.send).not.toHaveBeenCalled();
    expect(await row("bot-target@example.com")).toBeNull(); // the address's own limits are untouched
    // Only real-looking tokens reach siteverify, with the secret and the client's IP.
    expect(g.siteverify).toHaveBeenCalledTimes(3);
    const asked = JSON.parse(String(g.siteverify.mock.calls[0][1]!.body));
    expect(asked).toMatchObject({ secret: "ts-secret", response: "forged" });
    expect(asked.remoteip).toMatch(/^10\.0\./);
    expect((await startWith(g.env, "bot-target@example.com", "good")).status).toBe(200);
    expect(g.EMAIL.send).toHaveBeenCalledTimes(1);
    expect((await verify(g.env, "bot-target@example.com", g.code())).status).toBe(200); // verify needs no token
  });

  it("checks the hostname of the page the request came from; the apps' pages are on localhost", async () => {
    const g = guarded();
    const site = (token: string) => call("https://ayahshare.com/api/auth/email/start", {
      method: "POST", headers: { Origin: "https://ayahshare.com", "Content-Type": "application/json" },
      body: JSON.stringify({ email: `site-${token}@example.com`, turnstile: token }),
    }, g.env);
    expect((await site("good")).status).toBe(403); // a token made on localhost
    expect((await site("good-site")).status).toBe(200);
    expect((await startWith(g.env, "ios@example.com", "good", { Origin: IOS })).status).toBe(200);
    expect((await startWith(g.env, "android@example.com", "good-site", { Origin: "https://localhost" })).status).toBe(403);
  });

  it("fails closed when siteverify cannot answer", async () => {
    const g = guarded(undefined, true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await startWith(g.env, "outage@example.com", "good")).status).toBe(403);
    expect(g.EMAIL.send).not.toHaveBeenCalled();
  });

  it("not required while the site key or the secret is missing", async () => {
    for (const keys of [{ site: "0x4AAAAAAAtest" }, { secret: "ts-secret" }]) {
      const g = guarded(keys);
      const email = `no-check-${keys.site ? "site" : "secret"}@example.com`;
      expect((await startWith(g.env, email)).status).toBe(200);
      expect(g.siteverify).not.toHaveBeenCalled();
    }
  });
});
