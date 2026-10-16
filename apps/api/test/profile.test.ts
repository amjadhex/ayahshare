// Track G: the profile (GET / PATCH /api/me), saved designs with thumbnails, account deletion with the thumbnails, and
// the profile fields in admin.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { e164, isCountry, maskPhone, requestCountry } from "../src/lib/profile";
import { RECIPE, call, send } from "./helpers";
import { signIn } from "./google";

afterEach(() => vi.restoreAllMocks());

const ADMIN = { Authorization: "Bearer test-admin" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);
const dataUrl = (bytes: Uint8Array) => `data:image/jpeg;base64,${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))}`;
const get = async (path: string, cookie: string) => (await call(path, { headers: { Cookie: cookie } })).json<any>();

describe("profile", () => {
  it("GET /api/me: the whole profile with defaults, member since and stats", async () => {
    const { res, cookie } = await signIn("p-defaults");
    const signedIn = await res.json<any>();
    expect(signedIn).toMatchObject({ name: "User p-defaults", displayName: null, prefs: {}, interests: [], country: null, city: null,
      phone: null, phoneOptIn: false, stats: { creations: 0, shares: 0 } });
    expect(signedIn.memberSince).toBeGreaterThan(Date.now() - 60_000);
    await send("POST", "/api/shares", { recipe: RECIPE }, { cookie });
    await send("POST", "/api/creations", { recipe: RECIPE, title: "t", kind: "video" }, { cookie });
    expect((await get("/api/me", cookie)).stats).toEqual({ creations: 1, shares: 1 });
  });

  it("PATCH /api/me saves every field, normalises text and numbers, and a new sign-in keeps the chosen name", async () => {
    const { cookie } = await signIn("p-full");
    const patch = {
      displayName: "  Amina   K ", prefs: { reciter: "Husary_128kbps", translation: "ur.jalandhry", orientation: "square", effect: "glass", animation: "typewriter" },
      interests: ["patience", "hope", "patience"], country: "in", city: " Kochi ", phone: "+91 98765-43210", phoneOptIn: true, lang: "ml",
    };
    const res = await send("PATCH", "/api/me", patch, { cookie });
    expect(res.status).toBe(200);
    const me = await res.json<any>();
    // The removed typewriter animation is kept as fade.
    const prefs = { ...patch.prefs, animation: "fade" };
    expect(me).toMatchObject({ displayName: "Amina K", prefs, interests: ["patience", "hope"], country: "IN", city: "Kochi",
      phone: "+919876543210", phoneOptIn: true, lang: "ml" });
    expect(await get("/api/me", cookie)).toEqual(me);
    const row = await env.DB.prepare("SELECT updated_at, prefs FROM users WHERE id = ?").bind(me.id).first<any>();
    expect(row.updated_at).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.parse(row.prefs)).toEqual(prefs);
    for (const animation of ["none", "fade", "rise", "zoom"]) {
      expect((await (await send("PATCH", "/api/me", { prefs: { animation } }, { cookie })).json<any>()).prefs).toEqual({ animation });
    }
    // Translation voice for new designs and in the feed: on / off only.
    const voices = { voice: true, feedVoice: false };
    expect((await (await send("PATCH", "/api/me", { prefs: voices }, { cookie })).json<any>()).prefs).toEqual(voices);
    for (const bad of [{ voice: "yes" }, { feedVoice: 1 }]) {
      const res = await send("PATCH", "/api/me", { prefs: bad }, { cookie });
      expect(res.status).toBe(400);
      expect((await res.json<any>()).field).toBe(`prefs.${Object.keys(bad)[0]}`);
    }
    // Reels' My preferred reciter: the mix or one of the app's reciters.
    for (const reelReciter of ["mix", "Alafasy_128kbps"]) {
      expect((await (await send("PATCH", "/api/me", { prefs: { reelReciter } }, { cookie })).json<any>()).prefs).toEqual({ reelReciter });
    }
    expect((await send("PATCH", "/api/me", { prefs: { reelReciter: "someone" } }, { cookie })).status).toBe(400);
    // Preferences stored by the previous version read as fade.
    await env.DB.prepare("UPDATE users SET prefs = ? WHERE id = ?").bind(JSON.stringify({ effect: "glass", animation: "typewriter" }), me.id).run();
    expect((await get("/api/me", cookie)).prefs).toEqual({ effect: "glass", animation: "fade" });
    await send("PATCH", "/api/me", { prefs: patch.prefs }, { cookie });

    // Google's name changes at the next sign-in; the chosen name stays.
    const again = await (await signIn("p-full", { name: "New Google Name" })).res.json<any>();
    expect(again).toMatchObject({ name: "New Google Name", displayName: "Amina K", city: "Kochi" });

    // Clearing: null / "" remove a field; removing the phone also ends the opt-in; partial prefs replace the old ones.
    const cleared = await (await send("PATCH", "/api/me", { displayName: "", city: null, phone: "", prefs: { orientation: "landscape" }, interests: [] }, { cookie })).json<any>();
    expect(cleared).toMatchObject({ displayName: null, city: null, phone: null, phoneOptIn: false, prefs: { orientation: "landscape" }, interests: [], country: "IN" });
  });

  it("PATCH /api/me rejects each invalid field with its name and writes nothing", async () => {
    const { cookie } = await signIn("p-invalid");
    await send("PATCH", "/api/me", { city: "Leeds" }, { cookie });
    const cases: [Record<string, unknown>, string][] = [
      [{ displayName: "x".repeat(61) }, "displayName"],
      [{ displayName: "bad\u0007name" }, "displayName"],
      [{ displayName: 42 }, "displayName"],
      [{ prefs: { reciter: "Someone_Else_64kbps" } }, "prefs.reciter"],
      [{ prefs: { translation: "English" } }, "prefs.translation"],
      [{ prefs: { orientation: "tall" } }, "prefs.orientation"],
      [{ prefs: { effect: "sparkle" } }, "prefs.effect"],
      [{ prefs: { animation: "spin" } }, "prefs.animation"],
      [{ prefs: { font: "Arial" } }, "prefs.font"],
      [{ prefs: ["glass"] }, "prefs"],
      [{ interests: ["patience", "no-such-topic"] }, "interests"],
      [{ interests: Array.from({ length: 11 }, (_, i) => `t${i}`) }, "interests"],
      [{ interests: "patience" }, "interests"],
      [{ country: "India" }, "country"],
      [{ country: "XX" }, "country"],
      [{ city: "y".repeat(81) }, "city"],
      [{ phone: "98765 43210" }, "phone"],
      [{ phone: "+0123456789" }, "phone"],
      [{ phone: "+1234567890123456" }, "phone"],
      [{ phone: "+44 7700 900123 ext 5" }, "phone"],
      [{ phoneOptIn: true }, "phoneOptIn"],
      [{ phoneOptIn: "yes" }, "phoneOptIn"],
      [{ lang: "Urdu" }, "lang"],
      [{ email: "new@example.com" }, "email"],
      [{ city: "Leeds 2", country: "ZZ" }, "country"],
    ];
    for (const [body, field] of cases) {
      const res = await send("PATCH", "/api/me", body, { cookie });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json<any>()).field, JSON.stringify(body)).toBe(field);
    }
    expect((await get("/api/me", cookie)).city).toBe("Leeds"); // the half-valid PATCH wrote nothing
    // Opting in together with a number is fine.
    expect((await (await send("PATCH", "/api/me", { phone: "+447700900123", phoneOptIn: true }, { cookie })).json<any>()).phoneOptIn).toBe(true);
  });

  it("PATCH /api/me needs a session and the same origin", async () => {
    expect((await send("PATCH", "/api/me", { city: "x" })).status).toBe(401);
    const { cookie } = await signIn("p-origin");
    const res = await call("/api/me", { method: "PATCH", headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ city: "x" }) });
    expect(res.status).toBe(403);
    // The apps (capacitor://localhost) may PATCH with their Bearer token; CORS allows the method.
    const pre = await call("/api/me", { method: "OPTIONS", headers: { Origin: "capacitor://localhost", "Access-Control-Request-Method": "PATCH" } });
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
  });

  it("helpers: E.164, countries, masked phone, request country", () => {
    expect(e164("+44 (0) 7700-900.123")).toBe("+447700900123");
    expect(e164("+1 415 555 2671")).toBe("+14155552671");
    expect(e164("+91 98765 43210")).toBe("+919876543210");
    expect(e164("0044 7700 900123")).toBeUndefined();
    expect(isCountry("IN") && isCountry("GB") && isCountry("PS")).toBe(true);
    expect(isCountry("XX") || isCountry("QQ") || isCountry("in")).toBe(false);
    expect(maskPhone("+447700900123")).toBe("••••••••••123");
    expect(maskPhone(null)).toBeNull();
    expect(requestCountry({ cf: { country: "IN" } } as unknown as Request)).toBe("IN");
    expect(requestCountry({ cf: { country: "T1" } } as unknown as Request)).toBeNull();
    expect(requestCountry({} as Request)).toBeNull();
  });
});

describe("saved designs", () => {
  it("POST with kind + thumbnail → R2 creations/<id>.jpg, thumbnail URL for the owner only, never under /media", async () => {
    const { cookie } = await signIn("s-thumb");
    const res = await send("POST", "/api/creations", { recipe: RECIPE, title: "Ash-Sharh 94:5–6", kind: "video", thumb: dataUrl(JPEG) }, { cookie });
    expect(res.status).toBe(201);
    const c = await res.json<any>();
    expect(c).toMatchObject({ title: "Ash-Sharh 94:5–6", kind: "video", recipe: { surah: 94, from: 5, to: 6 } });
    expect(c.thumb).toBe(`/api/creations/${c.id}/thumb?v=${c.updated_at}`);
    const obj = await env.MEDIA.get(`creations/${c.id}.jpg`);
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(JPEG);

    const img = await call(c.thumb, { headers: { Cookie: cookie } });
    expect(img.status).toBe(200);
    expect(img.headers.get("Content-Type")).toBe("image/jpeg");
    expect(img.headers.get("Cache-Control")).toContain("private");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(JPEG);
    const other = await signIn("s-thumb-other");
    expect((await call(c.thumb, { headers: { Cookie: other.cookie } })).status).toBe(404);
    expect((await call(c.thumb)).status).toBe(401);
    expect((await call(`/media/creations/${c.id}.jpg`)).status).toBe(404);
  });

  it("the same recipe again updates the saved design (time, thumbnail, kind) instead of adding a copy", async () => {
    const { cookie } = await signIn("s-dedupe");
    const first = await (await send("POST", "/api/creations", { recipe: RECIPE, title: "A", kind: "video", thumb: dataUrl(JPEG) }, { cookie })).json<any>();
    await new Promise((r) => setTimeout(r, 5));
    const second = await send("POST", "/api/creations", { recipe: { ...RECIPE, extra: "ignored" }, title: "A", kind: "link" }, { cookie });
    expect(second.status).toBe(200);
    const s = await second.json<any>();
    expect(s).toMatchObject({ id: first.id, kind: "video", created_at: first.created_at }); // a link does not replace the video
    expect(s.updated_at).toBeGreaterThan(first.updated_at);
    expect(s.thumb).toContain(`v=${s.updated_at}`);
    const newer = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1]);
    const third = await (await send("POST", "/api/creations", { recipe: RECIPE, title: "A", kind: "image", thumb: dataUrl(newer) }, { cookie })).json<any>();
    expect(third).toMatchObject({ id: first.id, kind: "image" });
    expect(new Uint8Array(await (await env.MEDIA.get(`creations/${first.id}.jpg`))!.arrayBuffer())).toEqual(newer);
    // A different design is a new entry; the list is newest first by last save.
    const other = await (await send("POST", "/api/creations", { recipe: { ...RECIPE, from: 1, to: 1 }, kind: "link" }, { cookie })).json<any>();
    const list = await get("/api/creations", cookie);
    expect(list.map((x: any) => x.id)).toEqual([other.id, first.id]);
    expect(list[0]).toMatchObject({ kind: "link", thumb: null, title: "" });
  });

  it("designs saved before Auto contrast and the typewriter's removal read in the current form and are still the same design", async () => {
    const { cookie } = await signIn("s-legacy");
    const me = await get("/api/me", cookie);
    // As the previous version stored them: no autoContrast; one with the typewriter animation.
    const base = { ...RECIPE, effect: "solid", showSurah: true, showTranslation: true, showRef: true, animation: "none", textX: 0.5, textY: 0.54,
      textWidth: 0, headerX: 0.5, headerY: 0.11 };
    const insert = (id: string, recipe: object, at: number) => env.DB.prepare(
      "INSERT INTO creations (id, user_id, title, recipe, kind, thumb_key, created_at, updated_at) VALUES (?, ?, 'old', ?, 'video', NULL, ?, ?)",
    ).bind(id, me.id, JSON.stringify(recipe), at, at).run();
    await insert("legacy-a", base, Date.now() - 2000);
    await insert("legacy-b", { ...base, from: 7, to: 7, animation: "typewriter" }, Date.now() - 1000);
    const list = await get("/api/creations", cookie);
    expect(list.find((x: any) => x.id === "legacy-b").recipe).toMatchObject({ animation: "fade", autoContrast: true, from: 7 });
    expect(list.find((x: any) => x.id === "legacy-a").recipe).toMatchObject({ animation: "none", autoContrast: true });
    // Exporting the first one again (the app now sends autoContrast) updates it instead of adding a copy.
    const again = await send("POST", "/api/creations", { recipe: { ...base, autoContrast: true }, kind: "image" }, { cookie });
    expect(again.status).toBe(200);
    expect(await again.json<any>()).toMatchObject({ id: "legacy-a", recipe: { autoContrast: true } });
    const row = await env.DB.prepare("SELECT recipe FROM creations WHERE id = 'legacy-a'").first<any>();
    expect(JSON.parse(row.recipe).autoContrast).toBe(true);
    expect((await get("/api/creations", cookie))).toHaveLength(2);
    // Turned off, it is a different design.
    expect((await send("POST", "/api/creations", { recipe: { ...base, autoContrast: false }, kind: "image" }, { cookie })).status).toBe(201);
    // Saved after Auto contrast but before Split long ayahs: read with the switch on, and the same design again.
    await insert("legacy-c", { ...base, from: 9, to: 9, autoContrast: true }, Date.now() - 500);
    expect((await get("/api/creations", cookie)).find((x: any) => x.id === "legacy-c").recipe).toMatchObject({ splitLong: true, autoContrast: true });
    const split = await send("POST", "/api/creations", { recipe: { ...base, from: 9, to: 9, autoContrast: true, splitLong: true }, kind: "image" }, { cookie });
    expect(split.status).toBe(200);
    expect(await split.json<any>()).toMatchObject({ id: "legacy-c", recipe: { splitLong: true } });
    expect((await send("POST", "/api/creations", { recipe: { ...base, from: 9, to: 9, splitLong: false }, kind: "image" }, { cookie })).status).toBe(201);
    // Saved before the translation voice (no voice field = off): the same design again, unless the voice is on.
    await insert("legacy-d", { ...base, from: 11, to: 11, autoContrast: true, splitLong: true }, Date.now() - 400);
    expect((await get("/api/creations", cookie)).find((x: any) => x.id === "legacy-d").recipe).toMatchObject({ voice: "none" });
    const voiced = { ...base, from: 11, to: 11, autoContrast: true, splitLong: true };
    expect(await (await send("POST", "/api/creations", { recipe: { ...voiced, voice: "none" }, kind: "image" }, { cookie })).json<any>())
      .toMatchObject({ id: "legacy-d", recipe: { voice: "none" } });
    expect((await send("POST", "/api/creations", { recipe: { ...voiced, voice: "en.walk" }, kind: "video" }, { cookie })).status).toBe(201);
  });

  it("rejects a bad kind or thumbnail; `at` (moving designs from the device) is kept but clamped", async () => {
    const { cookie } = await signIn("s-invalid");
    expect((await send("POST", "/api/creations", { recipe: RECIPE, kind: "gif" }, { cookie })).status).toBe(400);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect((await send("POST", "/api/creations", { recipe: RECIPE, kind: "image", thumb: dataUrl(png) }, { cookie })).status).toBe(400);
    const big = new Uint8Array(61 * 1024).fill(1);
    big.set([0xff, 0xd8, 0xff]);
    expect((await send("POST", "/api/creations", { recipe: RECIPE, kind: "image", thumb: dataUrl(big) }, { cookie })).status).toBe(400);
    expect((await send("POST", "/api/creations", { recipe: RECIPE, kind: "image", thumb: "data:image/jpeg;base64,!!" }, { cookie })).status).toBe(400);
    const day = Date.now() - 86400_000;
    const moved = await (await send("POST", "/api/creations", { recipe: RECIPE, kind: "image", at: day }, { cookie })).json<any>();
    expect(moved).toMatchObject({ created_at: day, updated_at: day });
    const future = await (await send("POST", "/api/creations", { recipe: { ...RECIPE, from: 2, to: 2 }, kind: "image", at: Date.now() + 1e9 }, { cookie })).json<any>();
    expect(future.created_at).toBeLessThanOrEqual(Date.now());
  });

  it("DELETE removes the row and its thumbnail; a full account drops its oldest designs to make room", async () => {
    const { res, cookie } = await signIn("s-delete");
    const { id: userId } = await res.json<any>();
    const c = await (await send("POST", "/api/creations", { recipe: RECIPE, kind: "video", thumb: dataUrl(JPEG) }, { cookie })).json<any>();
    expect((await send("DELETE", `/api/creations/${c.id}`, undefined, { cookie })).status).toBe(200);
    expect(await env.MEDIA.get(`creations/${c.id}.jpg`)).toBeNull();
    expect((await send("DELETE", `/api/creations/${c.id}`, undefined, { cookie })).status).toBe(404);

    // 500 saved designs (the oldest with a thumbnail): the next one replaces the oldest.
    const db = env.DB;
    await env.MEDIA.put("creations/oldest.jpg", JPEG);
    await db.batch(Array.from({ length: 500 }, (_, i) => db.prepare(
      "INSERT INTO creations (id, user_id, title, recipe, kind, thumb_key, created_at, updated_at) VALUES (?, ?, 't', '{}', 'video', ?, ?, ?)",
    ).bind(i === 0 ? "oldest" : `old-${i}`, userId, i === 0 ? "creations/oldest.jpg" : null, 1000 + i, 1000 + i)));
    const added = await send("POST", "/api/creations", { recipe: RECIPE, kind: "image" }, { cookie });
    expect(added.status).toBe(201);
    const ids = (await get("/api/creations", cookie)).map((x: any) => x.id);
    expect(ids.length).toBe(500);
    expect(ids).not.toContain("oldest");
    expect(await env.MEDIA.get("creations/oldest.jpg")).toBeNull();
  });

  it("DELETE /api/me removes the profile, saved designs and their thumbnails", async () => {
    const { res, cookie } = await signIn("s-leaving");
    const { id } = await res.json<any>();
    await send("PATCH", "/api/me", { city: "Doha", phone: "+97412345678", interests: ["hope"] }, { cookie });
    const a = await (await send("POST", "/api/creations", { recipe: RECIPE, kind: "video", thumb: dataUrl(JPEG) }, { cookie })).json<any>();
    const b = await (await send("POST", "/api/creations", { recipe: { ...RECIPE, from: 3, to: 3 }, kind: "image", thumb: dataUrl(JPEG) }, { cookie })).json<any>();
    expect((await send("DELETE", "/api/me", undefined, { cookie })).status).toBe(200);
    expect(await env.MEDIA.get(`creations/${a.id}.jpg`)).toBeNull();
    expect(await env.MEDIA.get(`creations/${b.id}.jpg`)).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first()).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM creations WHERE user_id = ?").bind(id).first<any>()).n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE phone = '+97412345678'").first<any>()).n).toBe(0);
  });
});

describe("admin: profile fields", () => {
  it("users list shows the profile with the phone masked; overview and content show interests and countries", async () => {
    const a = await signIn("adm-a");
    await send("PATCH", "/api/me", { displayName: "Aisha", country: "GB", city: "Leeds", phone: "+447700900123", phoneOptIn: true, interests: ["hope", "patience"], lang: "ur" }, { cookie: a.cookie });
    const b = await signIn("adm-b");
    await send("PATCH", "/api/me", { country: "GB", interests: ["hope"] }, { cookie: b.cookie });

    const users = await (await call("/admin/api/users?limit=500", { headers: ADMIN })).json<any>();
    const row = users.users.find((u: any) => u.email === "adm-a@example.com");
    expect(row).toMatchObject({ display_name: "Aisha", country: "GB", city: "Leeds", phone: "••••••••••123", phone_opt_in: true, interests: ["hope", "patience"], lang: "ur" });
    expect(JSON.stringify(users)).not.toContain("7700900");

    const o = await (await call("/admin/api/overview", { headers: ADMIN })).json<any>();
    expect(o.accountCountries).toEqual(expect.arrayContaining([{ key: "GB", n: 2 }]));
    expect(o.interests.slice(0, 2)).toEqual([{ key: "hope", n: 2 }, { key: "patience", n: 1 }]);
    const content = await (await call("/admin/api/content", { headers: ADMIN })).json<any>();
    expect(content.interests.slice(0, 2)).toEqual([{ key: "hope", n: 2 }, { key: "patience", n: 1 }]);
  });
});
