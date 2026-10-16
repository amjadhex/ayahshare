// Share links (a recipe behind a short code):
//   POST /api/shares { recipe, og?, anon? } → { code, url }; og = small JPEG preview (data URL, ≤ 200 KB) → R2
//                                       og/<code>.jpg; anon = the app's anonymous device id, kept with a link made signed
//                                       out so that device can see how its links did (GET /api/stats/me)
//   GET  /api/shares/:code            → { recipe }; counts an open, in all and for today (only the app calls this, so
//                                       crawlers don't count; through the D1 counter buffer, src/lib/counters.ts); 503
//                                       while D1 fails
//   POST /api/shares/:code/reuse { kind: "share" | "make" } → 204. Someone who opened this link exported or linked its
//                                       design unchanged ("share") or changed ("make"); counted for today (share_daily),
//                                       never who did it
//   GET  /s/:code                     → the app's index.html with Open Graph / Twitter tags and a canonical link;
//                                       the app reads the code from the path and loads the recipe (plain app page
//                                       while D1 fails)
// og/ objects expire after 90 days (R2 lifecycle rule); the preview then falls back to the app icon.
// Links use https://ayahshare.com when the request came to ayahshare.com or www (lib/http publicOrigin), else this host.
import { Hono } from "hono";
import type { AyahsEn, ShareCreated, Surah } from "../../../../contracts/types";
import { increment, linkKey } from "../lib/counters";
import { readData } from "../lib/data";
import { cacheUrl, edgeJson } from "../lib/edge";
import { maxBody, publicOrigin, rateLimit, randomToken, readJson } from "../lib/http";
import { parseRecipe, storedRecipe } from "../lib/recipe";
import { sessionUser } from "../lib/session";

const OG_MAX = 200 * 1024;
const OG_DAYS = 90;
const CODE = /^[\w-]{4,16}$/;
const ANON = /^[\w-]{1,64}$/;

export const shares = new Hono<{ Bindings: Env }>();

shares.post("/", rateLimit("WRITE_LIMITER", 60), maxBody(400), async (c) => {
  const body = await readJson<{ recipe: unknown; og: unknown; anon: unknown }>(c);
  const recipe = parseRecipe(body?.recipe);
  if (!recipe) return c.json({ error: "invalid recipe" }, 400);
  const og = jpeg(body?.og);
  const user = await sessionUser(c);
  const anon = !user && typeof body?.anon === "string" && ANON.test(body.anon) ? body.anon : null;

  for (let attempt = 0; ; attempt++) {
    const code = randomToken(6); // 8 characters
    try {
      await c.env.DB.prepare("INSERT INTO shares (code, recipe, ref, og_key, user_id, anon_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(code, JSON.stringify(recipe), `${recipe.surah}:${recipe.from}`, og ? `og/${code}.jpg` : null, user?.id ?? null, anon, Date.now()).run();
    } catch (e) {
      if (attempt < 2 && String(e).includes("UNIQUE")) continue;
      throw e;
    }
    if (og) c.executionCtx.waitUntil(c.env.MEDIA.put(`og/${code}.jpg`, og, { httpMetadata: { contentType: "image/jpeg" } }));
    return c.json<ShareCreated>({ code, url: `${publicOrigin(c.req.url)}/s/${code}` }, 201);
  }
});

/** The bytes of a `data:image/jpeg;base64,...` URL up to 200 KB, else null (the share still works without a preview). */
function jpeg(og: unknown): Uint8Array | null {
  const m = typeof og === "string" ? og.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/) : null;
  if (!m || m[1].length > Math.ceil(OG_MAX / 3) * 4) return null;
  const bytes = Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0));
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.length <= OG_MAX ? bytes : null;
}

type ShareRow = { recipe: string; og_key: string | null; created_at: number };

/** A share never changes, so this colo's cache can answer for D1 (~0.4 s away from some colos). undefined when D1
 *  fails (e.g. its daily quota is used up). */
const shareRow = (url: string, env: Env, code: string): Promise<ShareRow | null | undefined> =>
  CODE.test(code)
    ? edgeJson(cacheUrl(url, `share/${code}`), 30 * 86400, () =>
        env.DB.prepare("SELECT recipe, og_key, created_at FROM shares WHERE code = ?").bind(code).first<ShareRow>())
        .catch((e) => void console.warn("share lookup failed:", String(e)))
    : Promise.resolve(null);

shares.get("/:code", async (c) => {
  const code = c.req.param("code");
  const row = await shareRow(c.req.url, c.env, code);
  if (row === undefined) return c.json({ error: "try again later" }, 503, { "Retry-After": "60" });
  if (!row) return c.json({ error: "not found" }, 404);
  c.executionCtx.waitUntil(Promise.all([increment(c.env, "opens", code), increment(c.env, "link_open", linkKey(code))]));
  return c.json({ recipe: storedRecipe(row.recipe) }); // older links: current fields and defaults
});

shares.post("/:code/reuse", rateLimit("WRITE_LIMITER", 60), maxBody(1), async (c) => {
  const body = await readJson<{ kind: unknown }>(c);
  const kind = body?.kind;
  if (kind !== "share" && kind !== "make") return c.json({ error: "kind must be share or make" }, 400);
  const code = c.req.param("code");
  const row = await shareRow(c.req.url, c.env, code);
  if (row === undefined) return c.json({ error: "try again later" }, 503, { "Retry-After": "60" });
  if (!row) return c.json({ error: "not found" }, 404);
  c.executionCtx.waitUntil(increment(c.env, kind === "share" ? "link_reshare" : "link_make", linkKey(code)));
  return c.body(null, 204);
});

export const sharePage = new Hono<{ Bindings: Env }>();

sharePage.get("/s/:code", async (c) => {
  const code = c.req.param("code");
  const origin = publicOrigin(c.req.url);
  const [row, app] = await Promise.all([shareRow(c.req.url, c.env, code), c.env.ASSETS.fetch(new URL("/", c.req.url))]);
  if (row === undefined) return app; // D1 unavailable: the plain app page, which loads the recipe (and can retry)
  if (!row) return new Response(app.body, { status: 404, headers: app.headers }); // the app shows "link not found"

  const r = storedRecipe(row.recipe);
  const [surahs, ayahsEn] = await Promise.all([readData<Surah[]>(c.env, "surahs.json"), readData<AyahsEn>(c.env, "ayahs-en.json")]);
  const name = surahs?.[r.surah - 1]?.name_en ?? `Surah ${r.surah}`;
  const title = `${name} ${r.surah}:${r.from}${r.to > r.from ? `-${r.to}` : ""}`;
  const first = ayahsEn?.[`${r.surah}:${r.from}`];
  const description = first ? (first.length > 200 ? `${first.slice(0, 197)}…` : first) : `${c.env.APP_NAME} — Quran images and videos to share`;
  const fresh = row.og_key && Date.now() - row.created_at < (OG_DAYS - 1) * 86400_000;
  const image = fresh ? `${origin}/media/${row.og_key}` : `${origin}/icons/icon-512.png`;
  const tags: [string, string, string][] = [
    ["name", "description", description], ["property", "og:type", "website"], ["property", "og:site_name", c.env.APP_NAME], ["property", "og:title", title],
    ["property", "og:description", description], ["property", "og:url", `${origin}/s/${code}`], ["property", "og:image", image],
    ["name", "twitter:card", fresh ? "summary_large_image" : "summary"], ["name", "twitter:title", title],
    ["name", "twitter:description", description], ["name", "twitter:image", image],
  ];
  const meta = [...tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`),
    `<link rel="canonical" href="${escapeHtml(`${origin}/s/${code}`)}">`].join("\n");

  const page = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(`${title} · ${c.env.APP_NAME}`) })
    .on('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(meta, { html: true }) })
    .transform(app);
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "public, max-age=60");
  headers.delete("ETag");
  return new Response(page.body, { status: 200, headers });
});

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
