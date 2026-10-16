import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { AYAHS_EN, BROKEN_DB, RECIPE, call, makeEnv, send } from "./helpers";

// A tiny valid JPEG header is enough: the API only checks the magic bytes and the size.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const dataUrl = (bytes: Uint8Array) => `data:image/jpeg;base64,${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))}`;
// Fields added later (text effect, show toggles, animation, text position) default when an older client leaves them out.
const DEFAULTS = { effect: "solid", showSurah: true, showTranslation: true, showRef: true, animation: "none", textX: 0.5, textY: 0.54, textWidth: 0, headerX: 0.5, headerY: 0.11, autoContrast: true, splitLong: true, voice: "none" };
const STORED = { ...RECIPE, ...DEFAULTS };

describe("shares", () => {
  it("POST /api/shares → code + url, OG JPEG to R2 og/, GET /api/shares/:code → recipe and counts opens", async () => {
    const res = await send("POST", "/api/shares", { recipe: { ...RECIPE, extra: "dropped" }, og: dataUrl(JPEG) });
    expect(res.status).toBe(201);
    const { code, url } = await res.json<any>();
    expect(code).toMatch(/^[\w-]{8}$/);
    expect(url).toBe(`http://localhost/s/${code}`);
    const obj = await env.MEDIA.get(`og/${code}.jpg`);
    expect(obj?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(JPEG);

    const got = await (await call(`/api/shares/${code}`)).json<any>();
    expect(got).toEqual({ recipe: STORED });
    const e = makeEnv();
    const prepare = vi.spyOn(e.DB, "prepare");
    expect(await (await call(`/api/shares/${code}`, {}, e)).json()).toEqual({ recipe: STORED }); // from this colo's cache
    expect(prepare.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes("FROM shares"))).toEqual([]);
    expect(prepare.mock.calls.map(([sql]) => sql)).toContain("UPDATE shares SET opens = opens + ?2 WHERE code = ?1"); // counter buffer
    expect((await env.DB.prepare("SELECT opens FROM shares WHERE code = ?").bind(code).first<any>()).opens).toBe(2);
  });

  it("keeps the new design fields, clamps ranges to 20 ayahs and rejects invalid new fields", async () => {
    const full = { ...RECIPE, effect: "glass", showSurah: false, showTranslation: true, showRef: false, animation: "rise",
      textX: 0.25, textY: 0.6666666, textWidth: 0.7, headerX: 0.3, headerY: 0.05, autoContrast: false, splitLong: false, voice: "en.walk" };
    const { code } = await (await send("POST", "/api/shares", { recipe: full })).json<any>();
    expect((await (await call(`/api/shares/${code}`)).json<any>()).recipe).toEqual({ ...full, textY: 0.667 });
    for (const animation of ["none", "fade", "rise", "zoom"]) {
      const made = await (await send("POST", "/api/shares", { recipe: { ...RECIPE, animation } })).json<any>();
      expect((await (await call(`/api/shares/${made.code}`)).json<any>()).recipe.animation).toBe(animation);
    }
    // An ayah group (107:4-7) is kept whole; an older client sending a longer range: kept as the first 20 ayahs.
    const group = await (await send("POST", "/api/shares", { recipe: { ...RECIPE, surah: 107, from: 4, to: 7 } })).json<any>();
    expect((await (await call(`/api/shares/${group.code}`)).json<any>()).recipe).toMatchObject({ from: 4, to: 7 });
    const long = await (await send("POST", "/api/shares", { recipe: { ...RECIPE, from: 1, to: 40 } })).json<any>();
    expect((await (await call(`/api/shares/${long.code}`)).json<any>()).recipe).toMatchObject({ from: 1, to: 20 });
    for (const bad of [{ effect: "neon" }, { showRef: "yes" }, { animation: "spin" }, { animation: "Typewriter" }, { textX: 1.5 }, { textY: -0.1 },
      { textWidth: 0.1 }, { textX: "0.5" }, { headerX: 2 }, { headerY: "top" }, { autoContrast: "yes" }, { autoContrast: 1 }, { splitLong: "no" }, { splitLong: 0 }, { voice: "en.robot" }, { voice: 1 }, { voice: "" }]) {
      expect((await send("POST", "/api/shares", { recipe: { ...RECIPE, ...bad } })).status).toBe(400);
    }
    // A translation voice reads one translation: with another translation it is turned off; with its own it is kept.
    const other = await (await send("POST", "/api/shares", { recipe: { ...RECIPE, voice: "ur.khan" } })).json<any>();
    expect((await (await call(`/api/shares/${other.code}`)).json<any>()).recipe.voice).toBe("none");
    const ml = await (await send("POST", "/api/shares", { recipe: { ...RECIPE, translation: "ml.lalithasaram", voice: "ml.lalithasaram" } })).json<any>();
    expect((await (await call(`/api/shares/${ml.code}`)).json<any>()).recipe).toMatchObject({ translation: "ml.lalithasaram", voice: "ml.lalithasaram" });
  });

  it("the removed typewriter animation: accepted from older clients and read as fade, also from links stored before", async () => {
    const sent = await (await send("POST", "/api/shares", { recipe: { ...RECIPE, animation: "typewriter" } })).json<any>();
    expect((await (await call(`/api/shares/${sent.code}`)).json<any>()).recipe).toEqual({ ...STORED, animation: "fade" });
    // A link stored by the previous version: typewriter, and no Auto contrast or Split long ayahs switch (both on for older
    // links).
    const old = { ...RECIPE, effect: "outline", showSurah: true, showTranslation: true, showRef: true, animation: "typewriter", textX: 0.5,
      textY: 0.54, textWidth: 0, headerX: 0.5, headerY: 0.11 };
    await env.DB.prepare("INSERT INTO shares (code, recipe, og_key, user_id, created_at) VALUES (?, ?, NULL, NULL, ?)")
      .bind("oldtypew", JSON.stringify(old), Date.now()).run();
    expect((await (await call("/api/shares/oldtypew")).json<any>()).recipe).toEqual({ ...old, animation: "fade", autoContrast: true, splitLong: true, voice: "none" });
    const page = await (await call("/s/oldtypew")).text();
    expect(page).toContain("94:5-6"); // the share page reads it too
  });

  it("rejects invalid recipes; ignores a bad or oversized preview", async () => {
    for (const bad of [{}, { ...RECIPE, v: 2 }, { ...RECIPE, to: RECIPE.from + 50 }, { ...RECIPE, to: RECIPE.from - 1 }, { ...RECIPE, surah: 115 }, { ...RECIPE, textColor: "red" },
      { ...RECIPE, bg: { type: "clip", id: "../x" } }, { ...RECIPE, reciter: "../../etc" }, { ...RECIPE, quranSize: 9 }]) {
      expect((await send("POST", "/api/shares", { recipe: bad })).status).toBe(400);
    }
    for (const og of ["data:image/png;base64,AAAA", dataUrl(new Uint8Array([1, 2, 3])), dataUrl(new Uint8Array(210 * 1024).fill(0xff))]) {
      const { code } = await (await send("POST", "/api/shares", { recipe: RECIPE, og })).json<any>();
      expect((await env.DB.prepare("SELECT og_key FROM shares WHERE code = ?").bind(code).first<any>()).og_key).toBeNull();
    }
    expect((await call("/api/shares/nope-nope")).status).toBe(404);
    expect((await call("/api/shares/%3Cx%3E")).status).toBe(404);
  });

  it("GET /s/:code → the app shell with OG/Twitter tags (title = surah + ayahs, image = OG JPEG)", async () => {
    const { code } = await (await send("POST", "/api/shares", { recipe: RECIPE, og: dataUrl(JPEG) })).json<any>();
    const res = await call(`/s/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>S94 94:5-6 · AyahShare</title>");
    expect(html).toContain('<meta property="og:title" content="S94 94:5-6">');
    expect(html).toContain(`<meta property="og:image" content="http://localhost/media/og/${code}.jpg">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`<meta property="og:description" content="${AYAHS_EN["94:5"]}">`);
    expect(html).not.toContain('content="old"'); // the shell's own OG tags are replaced
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).toContain('<div id="app">');
    // Opening the page itself does not count (crawlers fetch it too); the app's GET /api/shares/:code does.
    expect((await env.DB.prepare("SELECT opens FROM shares WHERE code = ?").bind(code).first<any>()).opens).toBe(0);
    // The OG image is served from R2 by /media.
    const img = await call(`/media/og/${code}.jpg`);
    expect(img.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("GET /s/:code without a preview uses the app icon; unknown code → app shell with 404", async () => {
    const { code } = await (await send("POST", "/api/shares", { recipe: { ...RECIPE, from: 5, to: 5 } })).json<any>();
    const html = await (await call(`/s/${code}`)).text();
    expect(html).toContain('<meta property="og:image" content="http://localhost/icons/icon-512.png">');
    expect(html).toContain('<meta property="og:title" content="S94 94:5">');
    const missing = await call("/s/unknown1");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('<div id="app">');
  });
});

describe("shares on ayahshare.com", () => {
  const at = (host: string, path: string, init: RequestInit = {}) => call(`https://${host}${path}`, init);
  const post = (host: string, origin = `https://${host}`) => at(host, "/api/shares", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ recipe: RECIPE, og: dataUrl(JPEG) }),
  });

  it("links made on ayahshare.com or www use https://ayahshare.com; other hosts keep their own", async () => {
    for (const host of ["ayahshare.com", "www.ayahshare.com"]) {
      const res = await post(host);
      expect(res.status).toBe(201);
      const { code, url } = await res.json<any>();
      expect(url).toBe(`https://ayahshare.com/s/${code}`);
      const html = await (await at(host, `/s/${code}`)).text();
      expect(html).toContain(`<meta property="og:url" content="https://ayahshare.com/s/${code}">`);
      expect(html).toContain(`<meta property="og:image" content="https://ayahshare.com/media/og/${code}.jpg">`);
      expect(html).toContain(`<link rel="canonical" href="https://ayahshare.com/s/${code}">`);
      expect(html).toContain('<meta property="og:site_name" content="AyahShare">');
      expect(html.match(/rel="canonical"/g)).toHaveLength(1); // the shell's own canonical link is replaced
    }
    const test = "quran-design.rapid-sun-0190.workers.dev";
    const { code, url } = await (await post(test)).json<any>();
    expect(url).toBe(`https://${test}/s/${code}`);
    expect(await (await at(test, `/s/${code}`)).text()).toContain(`<link rel="canonical" href="https://${test}/s/${code}">`);
  });

  it("writes are accepted from each host's own pages only", async () => {
    expect((await post("www.ayahshare.com", "https://ayahshare.com")).status).toBe(403);
    expect((await post("ayahshare.com", "https://www.ayahshare.com")).status).toBe(403);
    expect((await post("ayahshare.com", "https://evil.example")).status).toBe(403);
    expect((await post("quran-design.rapid-sun-0190.workers.dev", "https://ayahshare.com")).status).toBe(403);
  });
});

describe("shares while D1 fails", () => {
  it("GET /api/shares/:code → 503 (the app can retry); GET /s/:code → the plain app page", async () => {
    const e = { ...makeEnv(), DB: BROKEN_DB } as Env;
    const api = await call("/api/shares/Zz9-d1down", {}, e);
    expect(api.status).toBe(503);
    expect(api.headers.get("Retry-After")).toBe("60");
    const page = await call("/s/Zz9-d1down", {}, e);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<div id="app">');
    expect(html).not.toContain('property="og:image"');
  });
});

describe("POST /api/reports", () => {
  it("stores a report", async () => {
    const res = await send("POST", "/api/reports", { kind: "background", ref: "2:255", clip: "pb1", note: `  ${"n".repeat(2000)} `, anon: "anon-r" });
    expect(res.status).toBe(201);
    const { id } = await res.json<any>();
    const row = await env.DB.prepare("SELECT kind, ref, clip_id, note, status, anon_id, user_id FROM reports WHERE id = ?").bind(id).first<any>();
    expect(row).toMatchObject({ kind: "background", ref: "2:255", clip_id: "pb1", status: "open", anon_id: "anon-r", user_id: null });
    expect(row.note).toHaveLength(1000);
    expect((await send("POST", "/api/reports", { kind: "other" })).status).toBe(201);
  });

  it("validates kind, ref and clip", async () => {
    expect((await send("POST", "/api/reports", { kind: "spam" })).status).toBe(400);
    expect((await send("POST", "/api/reports", { kind: "text", ref: "999:1" })).status).toBe(400);
    expect((await send("POST", "/api/reports", { kind: "background", clip: "<script>" })).status).toBe(400);
    expect((await send("POST", "/api/reports", "not an object")).status).toBe(400);
  });
});
