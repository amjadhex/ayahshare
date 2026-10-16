// Anonymous counts: per ayah for everyone, and the person's own impact for them alone. Counts only, never names or who.
//
// GET /api/stats/ayahs?refs=94:5,2:153 (1..60 refs, each surah:ayah; duplicates are answered once) → contracts
//   AyahStatsResponse, in the order asked, 0 where nothing is counted yet. Edge-cached for 5 minutes per set of refs.
//   likes   accounts that keep the ayah as a favourite (favourites kept only on a device are not known to the server)
//   shares  exports (export_done events, daily_stats export_ref) + share links created (shares.ref). A link counts once
//           however it is sent (share sheet or copied); a file sent through the share sheet counts once, as its export.
//   makes   designs someone changed and then exported or linked after opening a shared link of the ayah (share_daily)
//   week    shares (as above) in the last 7 UTC days, today included
// GET /api/stats/me → contracts ImpactResponse for the last 7 UTC days, over the links this person created: signed in,
//   the account's links and those of its devices (devices.user_id, linked at sign-in); signed out, the links of the
//   device id in the X-Anon header (the app's anonymous id). opens = the links opened in the app, reshares = the same
//   design exported or linked again by someone who opened one, makes = a changed design (POST /api/shares/:code/reuse).
//   Also `links` (the links used most in those days, at most 5) and `total` (all days), for Notifications' per-ayah
//   lines and milestones. Never cached; 400 without a session or device id.
// Both answer 503 while D1 fails, so the app hides the numbers instead of showing zeros.
import { Hono } from "hono";
import type { AyahStats, AyahStatsResponse, ImpactResponse, LinkImpact, Ref } from "../../../../contracts/types";
import { cacheUrl, edgeJson } from "../lib/edge";
import { parseRef } from "../lib/recipe";
import { sessionUser } from "../lib/session";
import { utcDay } from "../lib/stats";

export const MAX_REFS = 60;
const DAYS = 7;
const TTL = 300;
const ANON = /^[\w-]{1,64}$/;
const DAY = 86400_000;

/** The first day of the last `DAYS` UTC days (today included), as a day and as ms. */
function weekStart(now = Date.now()) {
  const day = utcDay(now - (DAYS - 1) * DAY);
  return { day, ms: Date.parse(`${day}T00:00:00Z`) };
}

type Row = { ref: string; n: number; week?: number };

async function load(db: D1Database, refs: Ref[]): Promise<AyahStats[]> {
  const week = weekStart();
  const list = refs.map(() => "?").join(", ");
  const [exports, links, likes, makes] = await db.batch<Row>([
    db.prepare(`SELECT dim AS ref, SUM(value) AS n, SUM(CASE WHEN day >= ? THEN value ELSE 0 END) AS week FROM daily_stats
                WHERE metric = 'export_ref' AND dim IN (${list}) GROUP BY dim`).bind(week.day, ...refs),
    db.prepare(`SELECT ref, COUNT(*) AS n, SUM(created_at >= ?) AS week FROM shares WHERE ref IN (${list}) GROUP BY ref`).bind(week.ms, ...refs),
    db.prepare(`SELECT ref, COUNT(*) AS n FROM favourites WHERE ref IN (${list}) GROUP BY ref`).bind(...refs),
    db.prepare(`SELECT s.ref AS ref, SUM(d.makes) AS n FROM shares s JOIN share_daily d ON d.code = s.code
                WHERE s.ref IN (${list}) GROUP BY s.ref`).bind(...refs),
  ]);
  const by = (rows: Row[]) => new Map(rows.map((r) => [r.ref, r]));
  const [e, l, f, m] = [exports, links, likes, makes].map((r) => by(r.results));
  return refs.map((ref) => ({
    ref,
    likes: f.get(ref)?.n ?? 0,
    shares: (e.get(ref)?.n ?? 0) + (l.get(ref)?.n ?? 0),
    makes: m.get(ref)?.n ?? 0,
    week: (e.get(ref)?.week ?? 0) + (l.get(ref)?.week ?? 0),
  }));
}

export const stats = new Hono<{ Bindings: Env }>();

stats.get("/ayahs", async (c) => {
  const parts = (c.req.query("refs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return c.json({ error: "refs required" }, 400);
  if (parts.length > MAX_REFS) return c.json({ error: `at most ${MAX_REFS} refs` }, 400);
  const refs: Ref[] = [];
  for (const p of parts) {
    const ref = parseRef(p);
    if (!ref) return c.json({ error: "invalid ref", ref: p.slice(0, 16) }, 400);
    if (!refs.includes(ref)) refs.push(ref);
  }
  const sorted = [...refs].sort();
  try {
    const all = await edgeJson<AyahStats[]>(cacheUrl(c.req.url, `stats/ayahs/${encodeURIComponent(sorted.join(","))}`), TTL, () => load(c.env.DB, sorted));
    const map = new Map(all!.map((s) => [s.ref, s]));
    return c.json<AyahStatsResponse>({ stats: refs.map((r) => map.get(r)!) }, 200, { "Cache-Control": `public, max-age=${TTL}` });
  } catch (e) {
    console.warn("ayah stats failed:", String(e));
    return c.json({ error: "try again later" }, 503, { "Retry-After": "60" });
  }
});

stats.get("/me", async (c) => {
  const header = c.req.header("X-Anon");
  const anon = header && ANON.test(header) ? header : null;
  const noStore = { "Cache-Control": "private, no-store" };
  try {
    const user = await sessionUser(c);
    if (!user && !anon) return c.json({ error: "sign in or send the device id" }, 400, noStore);
    const row = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(d.opens), 0) AS opens, COALESCE(SUM(d.reshares), 0) AS reshares, COALESCE(SUM(d.makes), 0) AS makes
       FROM share_daily d JOIN shares s ON s.code = d.code
       WHERE d.day >= ?1 AND (s.user_id = ?2 OR s.anon_id = ?3 OR s.anon_id IN (SELECT anon_id FROM devices WHERE user_id = ?2))`,
    ).bind(weekStart().day, user?.id ?? null, anon).first<Omit<ImpactResponse, "days">>();
    // Notifications (12 Oct 2026): the links used most in these days, and the counts over all days (milestones).
    const mine = "(s.user_id = ?2 OR s.anon_id = ?3 OR s.anon_id IN (SELECT anon_id FROM devices WHERE user_id = ?2))";
    const [links, total] = await Promise.all([
      c.env.DB.prepare(
        `SELECT s.code AS code, s.ref AS ref, json_extract(s.recipe, '$.to') AS "to",
           CASE json_extract(s.recipe, '$.bg.type') WHEN 'clip' THEN json_extract(s.recipe, '$.bg.id') END AS clip,
           SUM(d.opens) AS opens, SUM(d.reshares) AS reshares, SUM(d.makes) AS makes
         FROM share_daily d JOIN shares s ON s.code = d.code
         WHERE d.day >= ?1 AND s.ref IS NOT NULL AND ${mine}
         GROUP BY s.code HAVING SUM(d.opens) + SUM(d.reshares) + SUM(d.makes) > 0
         ORDER BY opens DESC, reshares + makes DESC LIMIT 5`,
      ).bind(weekStart().day, user?.id ?? null, anon).all<LinkImpact>(),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(d.opens), 0) AS opens, COALESCE(SUM(d.reshares), 0) AS reshares, COALESCE(SUM(d.makes), 0) AS makes
         FROM share_daily d JOIN shares s ON s.code = d.code WHERE ${mine}`,
      ).bind(null, user?.id ?? null, anon).first<NonNullable<ImpactResponse["total"]>>(),
    ]);
    return c.json<ImpactResponse>({
      days: DAYS, opens: row?.opens ?? 0, reshares: row?.reshares ?? 0, makes: row?.makes ?? 0,
      // A range's last ayah only when it is one (`to` above `from`).
      links: links.results.map((l) => ({ ...l, to: l.to && l.to > Number(l.ref.split(":")[1]) ? l.to : undefined })),
      total: { opens: total?.opens ?? 0, reshares: total?.reshares ?? 0, makes: total?.makes ?? 0 },
    }, 200, noStore);
  } catch (e) {
    console.warn("impact failed:", String(e));
    return c.json({ error: "try again later" }, 503, { ...noStore, "Retry-After": "60" });
  }
});
