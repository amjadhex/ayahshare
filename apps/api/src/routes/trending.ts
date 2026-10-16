// GET /api/trending?days=1..30 (default 30) → contracts TrendingResponse: the ayahs people exported and shared most over
// the last days (days=1: today, UTC), for the Discover feed and "Most shared today". Read from the D1 counters (daily_stats metric export_ref, one row per ayah and day) and
// the share links created in that time; a share link counts twice. Only ayah references and counts: no personal data.
// Edge-cached for an hour; an unavailable D1 answers an empty list (cached briefly) so the feed still works.
import { Hono } from "hono";
import type { Ref, TrendingResponse } from "../../../../contracts/types";
import { cacheUrl, edgeJson } from "../lib/edge";
import { parseRef } from "../lib/recipe";

const HOUR = 3600;
const TOP = 30;
const SHARE_WEIGHT = 2;

export const trending = new Hono<{ Bindings: Env }>();

trending.get("/", async (c) => {
  const days = Math.min(30, Math.max(1, Math.floor(Number(c.req.query("days")) || 30)));
  // Whole UTC days, today included (the export counters are per UTC day; links from the start of the same day).
  const from = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  try {
    const body = await edgeJson<TrendingResponse>(cacheUrl(c.req.url, `trending-${days}`), HOUR, async () => {
      const db = c.env.DB;
      const [exports, shares] = await db.batch<{ ref: string; n: number }>([
        db.prepare("SELECT dim AS ref, SUM(value) AS n FROM daily_stats WHERE metric = 'export_ref' AND day >= ? GROUP BY dim")
          .bind(from),
        db.prepare(
          `SELECT json_extract(recipe, '$.surah') || ':' || json_extract(recipe, '$.from') AS ref, COUNT(*) AS n
           FROM shares WHERE created_at >= ? GROUP BY ref`,
        ).bind(Date.parse(`${from}T00:00:00Z`)),
      ]);
      const score = new Map<Ref, number>();
      const add = (rows: { ref: string; n: number }[], k: number) => {
        for (const r of rows) {
          const ref = parseRef(r.ref);
          if (ref && r.n > 0) score.set(ref, (score.get(ref) ?? 0) + r.n * k);
        }
      };
      add(exports.results, 1);
      add(shares.results, SHARE_WEIGHT);
      const refs = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP).map(([ref, n]) => ({ ref, n }));
      return { days, refs };
    });
    return c.json(body!, 200, { "Cache-Control": `public, max-age=${HOUR}` });
  } catch (e) {
    console.warn("trending failed:", String(e));
    return c.json<TrendingResponse>({ days, refs: [] }, 200, { "Cache-Control": "public, max-age=300" });
  }
});
