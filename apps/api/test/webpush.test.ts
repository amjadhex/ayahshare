import { describe, expect, it } from "vitest";
import { localDay, nextSendAt, validZone } from "../src/lib/tz";
import { b64url, encryptPayload, importVapidKey, unb64url, vapidJwt } from "../src/lib/webpush";
import { decryptPush } from "./helpers";

// RFC 8291 section 5 (and appendix A): the receiver's keys and auth secret, the sender's fixed key pair and salt.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
const enc = new TextEncoder();

describe("Web Push encryption (RFC 8291)", () => {
  it("matches the RFC 8291 section 5 example with its fixed keys and salt", async () => {
    const body = await encryptPayload(enc.encode(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, {
      salt: unb64url(RFC.salt)!, senderPublic: RFC.asPublic, senderPrivate: RFC.asPrivate,
    });
    expect(b64url(body)).toBe(RFC.body);
    expect(body.length).toBe(144); // 86-byte header + 41 + delimiter + 16-byte tag
  });

  it("uses a fresh key and salt each time, which the receiver can decrypt", async () => {
    const target = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const [a, b] = await Promise.all([encryptPayload(enc.encode("hello"), target), encryptPayload(enc.encode("hello"), target)]);
    expect(b64url(a.slice(0, 16))).not.toBe(b64url(b.slice(0, 16)));
    expect([...a.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]); // rs 4096, idlen 65
    expect(a[21]).toBe(4);
    const receiver = { d: RFC.uaPrivate, p256dh: RFC.uaPublic, auth: RFC.auth };
    expect(await decryptPush(a, receiver)).toBe("hello");
    expect(await decryptPush(b, receiver)).toBe("hello");
  });

  it("refuses malformed subscription keys and oversized payloads", async () => {
    await expect(encryptPayload(enc.encode("x"), { p256dh: RFC.auth, auth: RFC.auth })).rejects.toThrow();
    await expect(encryptPayload(enc.encode("x"), { p256dh: RFC.uaPublic, auth: "short" })).rejects.toThrow();
    await expect(encryptPayload(new Uint8Array(4000), { p256dh: RFC.uaPublic, auth: RFC.auth })).rejects.toThrow("too large");
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs an ES256 JWT for the push service origin that the public key verifies", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const publicKey = b64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
    const key = await importVapidKey({ publicKey, privateKey: jwk.d! });
    const now = Date.parse("2026-10-12T10:00:00Z");
    const jwt = await vapidJwt(key, "https://fcm.googleapis.com", now);

    const [h, p, s] = jwt.split(".");
    const json = (part: string) => JSON.parse(new TextDecoder().decode(unb64url(part)!));
    expect(json(h)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(json(p)).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:hello@ayahshare.com" });
    const sig = unb64url(s)!;
    expect(sig.length).toBe(64); // raw r || s, not DER
    const verifier = await crypto.subtle.importKey("raw", unb64url(publicKey)!, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, sig, enc.encode(`${h}.${p}`))).toBe(true);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, sig, enc.encode(`${h}.${p}x`))).toBe(false);
  });

  it("rejects a malformed key pair", async () => {
    await expect(importVapidKey({ publicKey: "not a key!", privateKey: "x" })).rejects.toThrow();
    await expect(importVapidKey({ publicKey: RFC.auth, privateKey: RFC.asPrivate })).rejects.toThrow();
  });
});

describe("nextSendAt", () => {
  const at = Date.parse;

  it("Asia/Kolkata (+5:30, no DST)", () => {
    expect(nextSendAt("07:00", "Asia/Kolkata", at("2026-10-12T00:00:00Z"))).toBe(at("2026-10-12T01:30:00Z"));
    expect(nextSendAt("07:00", "Asia/Kolkata", at("2026-10-12T01:30:00Z"))).toBe(at("2026-10-13T01:30:00Z")); // strictly after
    expect(nextSendAt("00:00", "Asia/Kolkata", at("2026-10-12T20:00:00Z"))).toBe(at("2026-10-13T18:30:00Z"));
    expect(nextSendAt("23:59", "Asia/Kolkata", at("2026-10-12T18:00:00Z"))).toBe(at("2026-10-12T18:29:00Z"));
  });

  it("Europe/London across the change back to GMT (25 Oct 2026) and to BST (28 Mar 2027)", () => {
    expect(nextSendAt("08:00", "Europe/London", at("2026-10-24T06:00:00Z"))).toBe(at("2026-10-24T07:00:00Z")); // BST
    expect(nextSendAt("08:00", "Europe/London", at("2026-10-24T07:30:00Z"))).toBe(at("2026-10-25T08:00:00Z")); // GMT
    expect(nextSendAt("08:00", "Europe/London", at("2027-03-27T09:00:00Z"))).toBe(at("2027-03-28T07:00:00Z")); // BST again
  });

  it("America/New_York, including a repeated hour that still fires once per date", () => {
    expect(nextSendAt("21:00", "America/New_York", at("2026-10-31T12:00:00Z"))).toBe(at("2026-11-01T01:00:00Z")); // EDT
    expect(nextSendAt("21:00", "America/New_York", at("2026-11-01T01:01:00Z"))).toBe(at("2026-11-02T02:00:00Z")); // EST
    // 01:30 happens twice on 1 Nov 2026: sent at the first, the next is 2 Nov, not the second 01:30.
    const first = nextSendAt("01:30", "America/New_York", at("2026-11-01T04:00:00Z"));
    expect(first).toBe(at("2026-11-01T05:30:00Z"));
    expect(nextSendAt("01:30", "America/New_York", first + 60_000)).toBe(at("2026-11-02T06:30:00Z"));
    // 02:30 does not happen on 14 Mar 2027 (DST starts at 07:00Z): one send that day, then back to 02:30 EDT.
    const gap = nextSendAt("02:30", "America/New_York", at("2027-03-13T12:00:00Z"));
    expect(localDay(gap, "America/New_York")).toBe("2027-03-14");
    expect(nextSendAt("02:30", "America/New_York", gap + 60_000)).toBe(at("2027-03-15T06:30:00Z"));
  });

  it("after a long outage, the next time is in the future, not a backlog", () => {
    const now = at("2026-10-20T12:00:00Z");
    expect(nextSendAt("07:00", "Asia/Kolkata", now)).toBe(at("2026-10-21T01:30:00Z"));
  });

  it("localDay and validZone", () => {
    expect(localDay(at("2026-10-12T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-13");
    expect(localDay(at("2026-10-12T02:00:00Z"), "America/New_York")).toBe("2026-10-11");
    expect(validZone("Asia/Kolkata")).toBe(true);
    expect(validZone("UTC")).toBe(true);
    for (const tz of ["Mars/Base", "", "x".repeat(65), 5, null]) expect(validZone(tz)).toBe(false);
  });
});
