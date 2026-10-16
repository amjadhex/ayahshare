import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sendDueReminders } from "../src/reminders";
import { b64url, unb64url } from "../src/lib/webpush";
import { call, decryptPush, makeEnv, mockFetch, ORIGIN, send } from "./helpers";

afterEach(() => vi.restoreAllMocks());

// A real receiver key pair (RFC 8291 section 5), so the Worker can encrypt to it.
const P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const RECEIVER = { d: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94", p256dh: P256DH, auth: AUTH };
const FCM = "https://fcm.googleapis.com/fcm/send/abc";
const sub = (over: Record<string, unknown> = {}) => ({ endpoint: FCM, keys: { p256dh: P256DH, auth: AUTH }, time: "07:00", tz: "Asia/Kolkata", ...over });
const row = (endpoint: string) => env.DB.prepare("SELECT * FROM push_reminders WHERE endpoint = ?").bind(endpoint).first<any>();

let vapid: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string };
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  vapid = {
    VAPID_PUBLIC_KEY: b64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
    VAPID_PRIVATE_KEY: ((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey).d!,
  };
});
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM push_reminders"), env.DB.prepare("DELETE FROM daily_ayah")]);
});

describe("GET /api/config vapidPublicKey", () => {
  it("is there only when both the public key var and the private key secret are set", async () => {
    expect(env.VAPID_PUBLIC_KEY).toMatch(/^B[\w-]{86}$/); // wrangler.jsonc var
    expect((await (await call("/api/config")).json<any>()).vapidPublicKey).toBeUndefined();
    const withSecret = { ...makeEnv(), VAPID_PRIVATE_KEY: "secret" } as Env;
    expect((await (await call("/api/config", {}, withSecret)).json<any>()).vapidPublicKey).toBe(env.VAPID_PUBLIC_KEY);
    const noPublic = { ...makeEnv(), VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "secret" } as Env;
    expect((await (await call("/api/config", {}, noPublic)).json<any>()).vapidPublicKey).toBeUndefined();
  });
});

describe("POST /api/push", () => {
  it("subscribes with the next send at the chosen local time", async () => {
    const before = Date.now();
    expect((await send("POST", "/api/push", sub())).status).toBe(204);
    const r = await row(FCM);
    expect(r).toMatchObject({ p256dh: P256DH, auth: AUTH, time: "07:00", tz: "Asia/Kolkata", fails: 0 });
    expect(r.created_at).toBeGreaterThanOrEqual(before);
    expect(r.next_at).toBeGreaterThan(before);
    expect(r.next_at - before).toBeLessThanOrEqual(86400_000);
    expect(new Date(r.next_at).toISOString().slice(11, 16)).toBe("01:30"); // 07:00 IST
  });

  it("upserts by endpoint: a new time replaces the old one and resets failures", async () => {
    await send("POST", "/api/push", sub());
    const first = await row(FCM);
    await env.DB.prepare("UPDATE push_reminders SET fails = 3 WHERE endpoint = ?").bind(FCM).run();
    // padded keys are stored without the padding
    expect((await send("POST", "/api/push", sub({ time: "21:15", tz: "Europe/London", keys: { p256dh: P256DH, auth: `${AUTH}==` } }))).status).toBe(204);
    const r = await row(FCM);
    expect(r).toMatchObject({ time: "21:15", tz: "Europe/London", fails: 0, auth: AUTH, created_at: first.created_at });
    expect(r.next_at).not.toBe(first.next_at);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_reminders").first<any>()).n).toBe(1);
  });

  it("validates the subscription, time and zone", async () => {
    const shortKey = b64url(new Uint8Array(16).fill(4));
    const notUncompressed = b64url(new Uint8Array(65).fill(3));
    const bad: Record<string, unknown>[] = [
      { endpoint: "http://fcm.googleapis.com/x" },
      { endpoint: "not a url" },
      { endpoint: `https://push.example/${"a".repeat(1000)}` },
      { endpoint: "https://evil.example/push" }, // not a browser push service
      { endpoint: 42 },
      { keys: undefined },
      { keys: { p256dh: shortKey, auth: AUTH } },
      { keys: { p256dh: notUncompressed, auth: AUTH } },
      { keys: { p256dh: P256DH, auth: P256DH } },
      { keys: { p256dh: P256DH, auth: "BTBZMqHH6r4Tts7J+aSIgg" } }, // standard base64, not base64url
      { keys: { p256dh: P256DH } },
      { time: "7:00" }, { time: "24:00" }, { time: "12:60" }, { time: 700 }, { time: undefined },
      { tz: "Mars/Base" }, { tz: "" }, { tz: "x".repeat(65) }, { tz: undefined },
    ];
    for (const over of bad) expect((await send("POST", "/api/push", sub(over))).status, JSON.stringify(over).slice(0, 80)).toBe(400);
    expect((await send("POST", "/api/push", "[]")).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_reminders").first<any>()).toEqual({ n: 0 });
  });

  it("refuses cross-site, non-JSON and oversized bodies", async () => {
    const body = JSON.stringify(sub());
    expect((await call("/api/push", { method: "POST", body, headers: { Origin: "https://evil.example", "Content-Type": "application/json" } })).status).toBe(403);
    expect((await call("/api/push", { method: "POST", body, headers: { Origin: ORIGIN, "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await send("POST", "/api/push", { ...sub(), pad: "x".repeat(5000) })).status).toBe(413);
    expect(await row(FCM)).toBeNull();
  });

  it("is rate-limited per client", async () => {
    const headers = { "CF-Connecting-IP": "10.9.9.9" };
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await send("POST", "/api/push", sub({ endpoint: `${FCM}${i}` }), { headers })).status;
    expect(last).toBe(429);
  });
});

describe("DELETE /api/push", () => {
  it("removes the subscription; again or unknown is still 204", async () => {
    await send("POST", "/api/push", sub());
    expect((await send("DELETE", "/api/push", { endpoint: FCM })).status).toBe(204);
    expect(await row(FCM)).toBeNull();
    expect((await send("DELETE", "/api/push", { endpoint: FCM })).status).toBe(204);
    expect((await send("DELETE", "/api/push", { endpoint: "nope" })).status).toBe(400);
    expect((await send("DELETE", "/api/push", {})).status).toBe(400);
  });
});

describe("sendDueReminders", () => {
  const NOW = Date.parse("2026-10-12T02:00:00Z"); // 07:30 in Kolkata, 22:00 (11 Oct) in New York
  const insert = (endpoint: string, next_at: number, over: { time?: string; tz?: string; fails?: number } = {}) =>
    env.DB.prepare("INSERT INTO push_reminders (endpoint, p256dh, auth, time, tz, next_at, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(endpoint, P256DH, AUTH, over.time ?? "07:00", over.tz ?? "Asia/Kolkata", next_at, NOW - 86400_000, over.fails ?? 0).run();
  const withKeys = () => ({ ...makeEnv(), ...vapid }) as Env;

  it("sends what is due with VAPID and aes128gcm, then moves each to its next local time", async () => {
    await insert("https://fcm.googleapis.com/fcm/send/a", NOW - 30 * 60_000);
    await insert("https://updates.push.services.mozilla.com/wpush/v2/b", NOW - 5 * 60_000, { time: "22:00", tz: "America/New_York" });
    await insert("https://web.push.apple.com/c", NOW + 60_000); // not yet
    const fetched = mockFetch(() => new Response(null, { status: 201 }));

    expect(await sendDueReminders(withKeys(), NOW)).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(fetched).toHaveBeenCalledTimes(2);
    const [url, init] = fetched.mock.calls.find(([u]) => u.includes("mozilla"))!;
    expect(url).toBe("https://updates.push.services.mozilla.com/wpush/v2/b");
    const h = new Headers(init!.headers);
    expect(h.get("Content-Encoding")).toBe("aes128gcm");
    expect(h.get("Content-Type")).toBe("application/octet-stream");
    expect(h.get("TTL")).toBe("14400");
    expect(h.get("Urgency")).toBe("normal");
    const m = h.get("Authorization")!.match(/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/)!;
    expect(m[2]).toBe(vapid.VAPID_PUBLIC_KEY);
    expect(JSON.parse(new TextDecoder().decode(unb64url(m[1].split(".")[1])!)).aud).toBe("https://updates.push.services.mozilla.com");
    const body = init!.body as Uint8Array;
    expect([...body.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]);

    expect((await row("https://fcm.googleapis.com/fcm/send/a")).next_at).toBe(Date.parse("2026-10-13T01:30:00Z"));
    expect((await row("https://updates.push.services.mozilla.com/wpush/v2/b")).next_at).toBe(Date.parse("2026-10-13T02:00:00Z"));
    expect((await row("https://web.push.apple.com/c")).next_at).toBe(NOW + 60_000);
    // a minute later only c is due; a and b are not sent again
    expect(await sendDueReminders(withKeys(), NOW + 60_000)).toEqual({ sent: 1, removed: 0, failed: 0 });
  });

  it("a reminder a day late goes once and then keeps to its time", async () => {
    await insert(FCM, NOW - 26 * 3600_000);
    const fetched = mockFetch(() => new Response(null, { status: 201 }));
    expect((await sendDueReminders(withKeys(), NOW)).sent).toBe(1);
    expect((await row(FCM)).next_at).toBe(Date.parse("2026-10-13T01:30:00Z"));
    expect((await sendDueReminders(withKeys(), NOW + 15 * 60_000)).sent).toBe(0);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("removes subscriptions the push service says are gone (404/410)", async () => {
    await insert("https://fcm.googleapis.com/fcm/send/gone", NOW - 1);
    await insert("https://fcm.googleapis.com/fcm/send/missing", NOW - 1);
    mockFetch((url) => new Response(null, { status: url.endsWith("gone") ? 410 : 404 }));
    expect(await sendDueReminders(withKeys(), NOW)).toEqual({ sent: 0, removed: 2, failed: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_reminders").first<any>()).toEqual({ n: 0 });
  });

  it("other errors retry an hour later; the 10th failure in a row removes the row; success resets the count", async () => {
    await insert("https://fcm.googleapis.com/fcm/send/flaky", NOW - 1, { fails: 2 });
    await insert("https://fcm.googleapis.com/fcm/send/dead", NOW - 1, { fails: 9 });
    await insert("https://fcm.googleapis.com/fcm/send/throws", NOW - 1);
    mockFetch((url) => {
      if (url.endsWith("throws")) throw new Error("network down");
      return new Response("busy", { status: 503 });
    });
    expect(await sendDueReminders(withKeys(), NOW)).toEqual({ sent: 0, removed: 1, failed: 3 });
    expect(await row("https://fcm.googleapis.com/fcm/send/flaky")).toMatchObject({ fails: 3, next_at: NOW + 3600_000 });
    expect(await row("https://fcm.googleapis.com/fcm/send/throws")).toMatchObject({ fails: 1, next_at: NOW + 3600_000 });
    expect(await row("https://fcm.googleapis.com/fcm/send/dead")).toBeNull();

    mockFetch(() => new Response(null, { status: 201 }));
    expect((await sendDueReminders(withKeys(), NOW + 3600_000)).sent).toBe(2);
    expect(await row("https://fcm.googleapis.com/fcm/send/flaky")).toMatchObject({ fails: 0, next_at: Date.parse("2026-10-13T01:30:00Z") });
  });

  it("names the admin's pick for the person's local date, else the plain message", async () => {
    // 02:00Z is 12 Oct in Kolkata and still 11 Oct in New York
    await env.DB.prepare("INSERT INTO daily_ayah (day, ref, set_by, set_at) VALUES ('2026-10-12', '2:255', NULL, ?)").bind(NOW).run();
    await insert("https://fcm.googleapis.com/fcm/send/in", NOW - 1);
    await insert("https://fcm.googleapis.com/fcm/send/us", NOW - 1, { tz: "America/New_York" });
    const fetched = mockFetch(() => new Response(null, { status: 201 }));
    await sendDueReminders(withKeys(), NOW);
    expect(fetched).toHaveBeenCalledTimes(2);
    const payloads = new Map<string, string>();
    for (const [, init] of fetched.mock.calls) {
      const msg = JSON.parse(await decryptPush(init!.body as Uint8Array, RECEIVER));
      payloads.set(msg.title, msg.body);
      expect(msg.url).toBe("/app?today=reminder");
    }
    expect(Object.fromEntries(payloads)).toEqual({
      "Today's ayah · S2 2:255": "Allah - there is no deity except Him, the Ever-Living, the Sustainer of existence.",
      "Today's ayah": "Today's ayah is ready to watch and share.",
    });
  });

  it("does nothing without both VAPID keys, or with a malformed private key", async () => {
    await insert(FCM, NOW - 1);
    const fetched = mockFetch(() => new Response(null, { status: 201 }));
    expect(await sendDueReminders(makeEnv(), NOW)).toEqual({ sent: 0, removed: 0, failed: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendDueReminders({ ...makeEnv(), ...vapid, VAPID_PRIVATE_KEY: "bad" } as Env, NOW)).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(fetched).not.toHaveBeenCalled();
    expect(await row(FCM)).toMatchObject({ fails: 0, next_at: NOW - 1 });
  });

  it("the 15-minute cron sends reminders; the nightly one does not", async () => {
    await insert(FCM, Date.now() - 1);
    const fetched = mockFetch(() => new Response(null, { status: 201 }));
    const run = async (cron: string) => {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron }), withKeys(), ctx);
      await waitOnExecutionContext(ctx);
    };
    await run("30 0 * * *");
    expect(fetched).not.toHaveBeenCalled();
    await run("*/15 * * * *");
    expect(fetched).toHaveBeenCalledTimes(1);
    expect((await row(FCM)).next_at).toBeGreaterThan(Date.now());
  });
});
