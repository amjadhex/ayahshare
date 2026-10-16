// GET /api/announcements → contracts AnnouncementsResponse: news from AyahShare for everyone (owner, 12 Oct 2026),
// written on the admin's Announcements page (admin.ts), shown in the app's Notifications. The newest SHOWN from the last
// MAX_AGE; the same for everyone, cached for five minutes.
import { Hono } from "hono";
import type { Announcement, AnnouncementsResponse } from "../../../../contracts/types";

export const SHOWN = 5;
const MAX_AGE = 60 * 86400_000;
export const TITLE_MAX = 80, BODY_MAX = 280, LINK_MAX = 300;

/** An announcement's link: an app path ("/discover", "/s/abc") or an https address; anything else is not a link. */
export function parseLink(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > LINK_MAX || /\s/.test(v)) return undefined;
  if (/^\/(?!\/)[\w\-./?=&%#]*$/.test(v)) return v;
  try { return new URL(v).protocol === "https:" ? v : undefined; } catch { return undefined; }
}

export async function latest(db: D1Database, n: number, since = 0): Promise<Announcement[]> {
  const { results } = await db.prepare(
    "SELECT id, title, body, link, created_at AS at FROM announcements WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?",
  ).bind(since, n).all<Announcement>();
  return results;
}

export const announcements = new Hono<{ Bindings: Env }>();

announcements.get("/", async (c) => {
  try {
    const items = await latest(c.env.DB, SHOWN, Date.now() - MAX_AGE);
    return c.json<AnnouncementsResponse>({ items }, 200, { "Cache-Control": "public, max-age=300" });
  } catch (e) {
    console.warn("announcements failed:", String(e));
    return c.json<AnnouncementsResponse>({ items: [] }, 200, { "Cache-Control": "no-store" }); // the page simply has none
  }
});
