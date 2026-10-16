// Admin API (contract: src/admin-contract.ts). Guard: Bearer ADMIN_TOKEN (scripts), a Cloudflare Access JWT, or the
// app's own sign-in (Google or email code) with an address on ADMIN_EMAILS.
// Everything comes from D1; event numbers from the counters POST /api/events keeps (src/lib/stats.ts), null with
// eventsEnabled: false until the first event is counted.
import { Hono, type Context } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type {
  AdminAnnouncementNew, AdminAnnouncements, AdminClip, AdminLibrary, AdminLibraryItem, AdminClipsResponse, AdminContent, AdminDaily, AdminLuna, AdminOverview, AdminReport,
  AdminReportsResponse, AdminRollup, AdminUser, AdminUsersResponse, AdminWhoami, ClipStatus, Count, ExportStats, ReportStatus,
} from "../admin-contract";
import { RECITERS } from "../../../../contracts/reciters";
import { VOICES } from "../../../../contracts/voices";
import { resetHiddenClips } from "../lib/data";
import { bearerIs, crossSite, intParam, isWrite, maxBody, readJson } from "../lib/http";
import { maskPhone } from "../lib/profile";
import { sessionUser } from "../lib/session";
import { clipUses, countersExist, dailySeries, dayRange, funnel, noClickSearches, tops, utcDay } from "../lib/stats";
import { turnedOff, type OffKind } from "../lib/turnedoff";
import { rollup } from "../rollup";
import { BODY_MAX, latest, parseLink, TITLE_MAX } from "./announcements";
import { addDays, existingRef, parseDay, picksIn, rangeParams } from "./daily";
import { allTafsirs } from "./reflect";

type AdminEnv = { Bindings: Env; Variables: { admin: AdminWhoami } };
const DAY = 86400_000;

const accessKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** The email in a valid Cloudflare Access JWT for this application, or null. */
async function accessEmail(c: Context<AdminEnv>): Promise<string | null> {
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  const team = c.env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!token || !team || !c.env.ACCESS_AUD) return null;
  let keys = accessKeys.get(team);
  if (!keys) accessKeys.set(team, (keys = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))));
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${team}`, audience: c.env.ACCESS_AUD });
    return typeof payload.email === "string" ? payload.email : "";
  } catch (e) {
    console.warn("access token rejected:", String(e));
    return null;
  }
}

/** The signed-in account's email when it is on ADMIN_EMAILS (comma-separated), or null. */
async function accountEmail(c: Context<AdminEnv>): Promise<string | null> {
  const allowed = (c.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return null;
  const user = await sessionUser(c);
  return user && allowed.includes(user.email.toLowerCase()) ? user.email : null;
}

export const admin = new Hono<AdminEnv>();

admin.use("*", async (c, next) => {
  if (await bearerIs(c, c.env.ADMIN_TOKEN)) {
    c.set("admin", { via: "token", email: null });
    return next();
  }
  const email = await accessEmail(c);
  const account = email === null ? await accountEmail(c) : null;
  if (email === null && account === null) return c.json({ error: "unauthorized" }, 401);
  const blocked = isWrite(c) ? crossSite(c) : null; // the Access and session cookies ride along with cross-site requests
  if (blocked) return blocked;
  c.set("admin", email !== null ? { via: "access", email: email || null } : { via: "account", email: account });
  await next();
});

admin.get("/whoami", (c) => c.json<AdminWhoami>(c.var.admin));

const first = async <T>(c: Context<AdminEnv>, sql: string, ...args: unknown[]) => (await c.env.DB.prepare(sql).bind(...args).first<T>())!;
const all = async <T>(c: Context<AdminEnv>, sql: string, ...args: unknown[]) => (await c.env.DB.prepare(sql).bind(...args).all<T>()).results;
const n = (c: Context<AdminEnv>, sql: string, ...args: unknown[]) => first<{ n: number }>(c, sql, ...args).then((r) => r.n);
/** Profile interests across accounts (topic id → accounts), and the countries accounts chose. */
const interestCounts = (c: Context<AdminEnv>, limit: number) =>
  all<Count>(c, "SELECT j.value AS key, COUNT(*) AS n FROM users u, json_each(u.interests) j WHERE u.interests IS NOT NULL GROUP BY j.value ORDER BY n DESC, key LIMIT ?", limit);
const accountCountries = (c: Context<AdminEnv>) =>
  all<Count>(c, "SELECT country AS key, COUNT(*) AS n FROM users WHERE country IS NOT NULL GROUP BY country ORDER BY n DESC, key LIMIT 30");

admin.get("/overview", async (c) => {
  const days = intParam(c, "days", 30, 1, 90);
  const now = Date.now();
  const range = dayRange(days, now);
  const db = c.env.DB;
  // One round trip for the counters; each subquery uses an index (migrations/0002).
  const [d, countries, platforms, enabled, top, stages, daily, chosenCountries, interests] = await Promise.all([
    first<AdminOverview["devices"] & { users: number; users_new7: number; users_active30: number; shares: number; shares_new7: number; opens: number; open_reports: number }>(c,
      `SELECT (SELECT COUNT(*) FROM devices) AS total,
        (SELECT COUNT(*) FROM devices WHERE last_seen >= ?1) AS dau, (SELECT COUNT(*) FROM devices WHERE last_seen >= ?2) AS wau,
        (SELECT COUNT(*) FROM devices WHERE last_seen >= ?3) AS mau, (SELECT COUNT(*) FROM devices WHERE first_seen >= ?1) AS new1,
        (SELECT COUNT(*) FROM devices WHERE first_seen >= ?2) AS new7, (SELECT COUNT(*) FROM devices WHERE first_seen >= ?3) AS new30,
        (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE created_at >= ?2) AS users_new7,
        (SELECT COUNT(DISTINCT user_id) FROM devices WHERE user_id IS NOT NULL AND last_seen >= ?3) AS users_active30,
        (SELECT COUNT(*) FROM shares) AS shares, (SELECT COUNT(*) FROM shares WHERE created_at >= ?2) AS shares_new7,
        (SELECT COALESCE(SUM(opens), 0) FROM shares) AS opens, (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports`,
      now - DAY, now - 7 * DAY, now - 30 * DAY),
    all<Count>(c, "SELECT COALESCE(country, '') AS key, COUNT(*) AS n FROM devices WHERE last_seen >= ? GROUP BY key ORDER BY n DESC LIMIT 30", now - days * DAY),
    all<Count>(c, "SELECT COALESCE(platform, '') AS key, COUNT(*) AS n FROM devices WHERE last_seen >= ? GROUP BY key ORDER BY n DESC", now - days * DAY),
    countersExist(db),
    tops(db, ["event", "export", "export_ms", "export_bytes", "export_fail", "export_fail_reason", "open_device", "open_browser", "open_country"], range, 50),
    funnel(db, range),
    dailySeries(db, range),
    accountCountries(c),
    interestCounts(c, 20),
  ]);
  const sum = (list: Count[], key: string) => list.find((r) => r.key === key)?.n ?? 0;
  const kind = (k: string): ExportStats => {
    const done = sum(top.export, k), failed = sum(top.export_fail, k);
    return {
      done, failed,
      avgMs: done ? Math.round(sum(top.export_ms, k) / done) : null,
      avgBytes: done ? Math.round(sum(top.export_bytes, k) / done) : null,
      successRate: done + failed ? Math.round((done / (done + failed)) * 1000) / 1000 : null,
    };
  };
  const on = <T>(v: T) => (enabled ? v : null);
  return c.json<AdminOverview>({
    eventsEnabled: enabled,
    days,
    ...range,
    devices: { total: d.total, dau: d.dau, wau: d.wau, mau: d.mau, new1: d.new1, new7: d.new7, new30: d.new30 },
    users: { total: d.users, new7: d.users_new7, active30: d.users_active30 },
    shares: { total: d.shares, new7: d.shares_new7, opens: d.opens },
    reports: { open: d.open_reports },
    countries,
    platforms,
    accountCountries: chosenCountries,
    interests,
    exports: on({ video: kind("video"), image: kind("image") }),
    exportFailures: on(top.export_fail_reason),
    funnel: on(stages),
    events: on(top.event),
    devicesByType: on(top.open_device),
    browsers: on(top.open_browser),
    opensByCountry: on(top.open_country),
    daily,
  });
});

admin.get("/content", async (c) => {
  const days = intParam(c, "days", 30, 1, 90);
  const limit = intParam(c, "limit", 20, 1, 200);
  const range = dayRange(days);
  const db = c.env.DB;
  const [cachedSearches, enabled, top, noClick, interests] = await Promise.all([
    all<AdminContent["cachedSearches"][number]>(c, "SELECT q, topic, hits + 1 AS n, created_at FROM query_cache ORDER BY hits DESC, created_at DESC LIMIT ?", limit),
    countersExist(db),
    tops(db, ["export_ref", "export_surah", "search", "bg_clip", "export_clip", "bg_source", "export_reciter", "export_translation", "export_orientation"], range, limit),
    noClickSearches(db, range, limit),
    interestCounts(c, limit),
  ]);
  const on = <T>(v: T) => (enabled ? v : null);
  return c.json<AdminContent>({
    eventsEnabled: enabled,
    days,
    ...range,
    cachedSearches,
    interests,
    ayahs: on(top.export_ref),
    surahs: on(top.export_surah),
    searches: on(top.search),
    noClickSearches: on(noClick),
    clips: on(top.bg_clip),
    exportClips: on(top.export_clip),
    bgSources: on(top.bg_source),
    reciters: on(top.export_reciter),
    translations: on(top.export_translation),
    orientations: on(top.export_orientation),
  });
});

const CLIP_STATUS: ClipStatus[] = ["active", "hidden", "rejected"];

admin.get("/clips", async (c) => {
  const status = c.req.query("status") ?? "all";
  const filter = CLIP_STATUS.includes(status as ClipStatus) ? status : "";
  const limit = intParam(c, "limit", 100, 1, 500);
  const offset = intParam(c, "offset", 0, 0, 1e9);
  const [rows, total, reported, enabled, uses] = await Promise.all([
    all<Record<string, string | number | null>>(c,
      `SELECT id, source, author, page_url, caption, tags, duration, thumb_key, video_key, quality, safety, status, created_at
       FROM clips WHERE (?1 = '' OR status = ?1) ORDER BY created_at DESC, id LIMIT ?2 OFFSET ?3`, filter, limit, offset),
    n(c, "SELECT COUNT(*) AS n FROM clips WHERE (?1 = '' OR status = ?1)", filter),
    all<{ clip_id: string; n: number }>(c, "SELECT clip_id, COUNT(*) AS n FROM reports WHERE clip_id IS NOT NULL GROUP BY clip_id"),
    countersExist(c.env.DB),
    clipUses(c.env.DB, dayRange(30)),
  ]);
  const reports = new Map(reported.map((r) => [r.clip_id, r.n]));
  const json = <T>(s: unknown): T | null => {
    try { return typeof s === "string" ? JSON.parse(s) : null; } catch { return null; }
  };
  const clips = rows.map((r): AdminClip => ({
    id: r.id as string, source: r.source as string, author: r.author as string | null, page_url: r.page_url as string | null,
    caption: r.caption as string | null, tags: r.tags ? String(r.tags).split(",") : [], duration: r.duration as number | null,
    thumb: r.thumb_key as string, video: json(r.video_key), quality: r.quality as number | null, safety: json(r.safety),
    status: r.status as ClipStatus, created_at: r.created_at as number,
    reports: reports.get(r.id as string) ?? 0, uses: enabled ? uses.get(r.id as string) ?? 0 : null,
  }));
  return c.json<AdminClipsResponse>({ clips, total, eventsEnabled: enabled });
});

admin.patch("/clips/:id", maxBody(4), async (c) => {
  const status = (await readJson<{ status: ClipStatus }>(c))?.status;
  if (!CLIP_STATUS.includes(status as ClipStatus)) return c.json({ error: "status must be active, hidden or rejected" }, 400);
  const { meta } = await c.env.DB.prepare("UPDATE clips SET status = ? WHERE id = ?").bind(status, c.req.param("id")).run();
  if (!meta.changes) return c.json({ error: "not found" }, 404);
  await resetHiddenClips(c.req.url);
  return c.json({ id: c.req.param("id"), status });
});

const REPORT_STATUS: ReportStatus[] = ["open", "done", "dismissed"];

admin.get("/reports", async (c) => {
  const status = c.req.query("status") ?? "open";
  const filter = REPORT_STATUS.includes(status as ReportStatus) ? status : "";
  const limit = intParam(c, "limit", 100, 1, 500);
  const offset = intParam(c, "offset", 0, 0, 1e9);
  const [reports, total] = await Promise.all([
    all<AdminReport>(c, `SELECT id, created_at, kind, ref, clip_id, note, status, anon_id, user_id FROM reports
      WHERE (?1 = '' OR status = ?1) ORDER BY id DESC LIMIT ?2 OFFSET ?3`, filter, limit, offset),
    n(c, "SELECT COUNT(*) AS n FROM reports WHERE (?1 = '' OR status = ?1)", filter),
  ]);
  return c.json<AdminReportsResponse>({ reports, total });
});

admin.patch("/reports/:id", maxBody(4), async (c) => {
  const status = (await readJson<{ status: ReportStatus }>(c))?.status;
  if (!REPORT_STATUS.includes(status as ReportStatus)) return c.json({ error: "status must be open, done or dismissed" }, 400);
  const { meta } = await c.env.DB.prepare("UPDATE reports SET status = ? WHERE id = ?").bind(status, Number(c.req.param("id"))).run();
  return meta.changes ? c.json({ id: Number(c.req.param("id")), status }) : c.json({ error: "not found" }, 404);
});

admin.get("/users", async (c) => {
  const limit = intParam(c, "limit", 100, 1, 500);
  const offset = intParam(c, "offset", 0, 0, 1e9);
  const [rows, total] = await Promise.all([
    all<Omit<AdminUser, "interests" | "phone_opt_in"> & { interests: string | null; phone_opt_in: number }>(c,
      `SELECT u.id, u.email, u.name, u.avatar_url, u.created_at, u.last_login,
        (SELECT COUNT(*) FROM creations WHERE user_id = u.id) AS creations,
        (SELECT COUNT(*) FROM favourites WHERE user_id = u.id) AS favourites,
        (SELECT COUNT(*) FROM devices WHERE user_id = u.id) AS devices,
        MAX(u.last_login, COALESCE((SELECT MAX(last_seen) FROM devices WHERE user_id = u.id), 0)) AS last_active,
        u.display_name, u.lang, u.country, u.city, u.phone, u.phone_opt_in, u.interests, u.updated_at
      FROM users u ORDER BY last_active DESC, u.last_login DESC LIMIT ? OFFSET ?`, limit, offset),
    n(c, "SELECT COUNT(*) AS n FROM users"),
  ]);
  const list = (s: string | null): string[] => {
    try { const v: unknown = s ? JSON.parse(s) : []; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
  };
  const users = rows.map((u): AdminUser => ({
    ...u, phone: maskPhone(u.phone), phone_opt_in: !!u.phone_opt_in && !!u.phone, interests: list(u.interests),
  }));
  return c.json<AdminUsersResponse>({ users, total });
});

admin.get("/luna", async (c) => {
  const days = intParam(c, "days", 30, 1, 365);
  const [rows, cache] = await Promise.all([
    all<AdminLuna["days"][number]>(c, "SELECT day, calls, input_tokens, cost_usd FROM luna_usage WHERE day >= ? ORDER BY day",
      new Date(Date.now() - days * DAY).toISOString().slice(0, 10)),
    first<AdminLuna["cache"]>(c, "SELECT COUNT(*) AS rows, COALESCE(SUM(hits), 0) AS hits FROM query_cache"),
  ]);
  return c.json<AdminLuna>({ capUsd: Number(c.env.LUNA_DAILY_CAP_USD || 1), days: rows, cache });
});

// Today's ayah (owner, 12 Oct 2026): the admin's picks and how the day's ayah did. The counts are the event counters by UTC
// day (the app counts today_seen, today_opened and today_shared by name), the 7 days before `from` and `from` itself.
const DAILY_EVENTS = { today_seen: "seen", today_opened: "opened", today_shared: "shared" } as const;

admin.get("/daily", async (c) => {
  const range = rangeParams((name) => c.req.query(name));
  if (!range) return c.json({ error: "from must be YYYY-MM-DD and days 1 to 31" }, 400);
  const db = c.env.DB;
  const since = addDays(range.from, -7);
  const [picks, enabled, counts, reminders] = await Promise.all([
    picksIn(db, range.from, range.days),
    countersExist(db),
    all<{ day: string; dim: string; value: number }>(c,
      "SELECT day, dim, value FROM daily_stats WHERE metric = 'event' AND dim IN ('today_seen', 'today_opened', 'today_shared') AND day BETWEEN ? AND ?",
      since, range.from),
    first<{ n: number | null }>(c, "SELECT SUM(CASE dim WHEN 'reminder_on' THEN value ELSE -value END) AS n FROM daily_stats WHERE metric = 'event' AND dim IN ('reminder_on', 'reminder_off')"),
  ]);
  const value = new Map(counts.map((r) => [`${r.day}:${r.dim}`, r.value]));
  const stats = Array.from({ length: 8 }, (_, i) => {
    const day = addDays(since, i);
    const at = (dim: keyof typeof DAILY_EVENTS) => value.get(`${day}:${dim}`) ?? 0;
    return { day, seen: at("today_seen"), opened: at("today_opened"), shared: at("today_shared") };
  });
  return c.json<AdminDaily>({ eventsEnabled: enabled, picks, stats, remindersOn: enabled ? Math.max(0, reminders.n ?? 0) : null });
});

/** The day of a /daily/:day request: today (UTC) or later, with a day of slack for time zones ahead of UTC, else null. */
const pickableDay = (v: string) => {
  const day = parseDay(v);
  return day && day >= utcDay(Date.now() - DAY) ? day : null;
};

admin.put("/daily/:day", maxBody(4), async (c) => {
  const day = pickableDay(c.req.param("day"));
  if (!day) return c.json({ error: "day must be YYYY-MM-DD, today or later" }, 400);
  const ref = await existingRef(c.env, (await readJson<{ ref: string }>(c))?.ref);
  if (!ref) return c.json({ error: "ref must be an ayah like 2:255" }, 400);
  const at = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO daily_ayah (day, ref, set_by, set_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (day) DO UPDATE SET ref = ?2, set_by = ?3, set_at = ?4",
  ).bind(day, ref, c.var.admin.email, at).run();
  return c.json({ day, ref, at });
});

// ---------- announcements (Notifications' news from AyahShare) ----------

admin.get("/announcements", async (c) => c.json<AdminAnnouncements>({ items: await latest(c.env.DB, 50) }));

admin.post("/announcements", maxBody(4), async (c) => {
  const body = await readJson<AdminAnnouncementNew>(c);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  const link = parseLink(typeof body?.link === "string" ? body.link.trim() : body?.link);
  if (!title || title.length > TITLE_MAX) return c.json({ error: `title is required, at most ${TITLE_MAX} characters` }, 400);
  if (text.length > BODY_MAX) return c.json({ error: `body is at most ${BODY_MAX} characters` }, 400);
  if (link === undefined) return c.json({ error: "link must be an app path like /discover or an https address" }, 400);
  const at = Date.now();
  const row = await c.env.DB.prepare(
    "INSERT INTO announcements (title, body, link, created_by, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
  ).bind(title, text, link, c.var.admin.email, at).first<{ id: number }>();
  return c.json({ id: row!.id, title, body: text, link, at }, 201);
});

admin.delete("/announcements/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "id must be a number" }, 400);
  await c.env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});

admin.delete("/daily/:day", async (c) => {
  const day = parseDay(c.req.param("day"));
  if (!day) return c.json({ error: "day must be YYYY-MM-DD" }, 400);
  await c.env.DB.prepare("DELETE FROM daily_ayah WHERE day = ?").bind(day).run();
  return c.body(null, 204);
});

admin.post("/rollup", async (c) => {
  const day = c.req.query("day") ?? new Date(Date.now() - DAY).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return c.json({ error: "day must be YYYY-MM-DD" }, 400);
  return c.json<AdminRollup>({ day, rows: await rollup(c.env, day), eventsEnabled: await countersExist(c.env.DB) });
});

// ---------- library (tafsirs, reciters and translation voices the app offers) ----------

/** Every item of each kind, before the admin's choices. */
async function library(c: Context<AdminEnv>): Promise<Record<OffKind, Omit<AdminLibraryItem, "off">[]>> {
  return {
    tafsir: (await allTafsirs(c as unknown as Context<{ Bindings: Env }>)).map((t) => ({ id: String(t.id), name: t.name, detail: t.author, lang: t.lang })),
    reciter: RECITERS.map(([id, name]) => ({ id, name, detail: null, lang: null })),
    voice: VOICES.map((v) => ({ id: v.id, name: v.narrator, detail: `reads ${v.text}`, lang: v.lang })),
  };
}

admin.get("/library", async (c) => {
  const [all, off] = await Promise.all([library(c), turnedOff(c.env.DB)]);
  const mark = (items: Omit<AdminLibraryItem, "off">[], ids: string[]) => items.map((x) => ({ ...x, off: ids.includes(x.id) }));
  return c.json<AdminLibrary>({ tafsirs: mark(all.tafsir, off.tafsirs), reciters: mark(all.reciter, off.reciters), voices: mark(all.voice, off.voices) });
});

admin.put("/library/:kind/:id", maxBody(1), async (c) => {
  const kind = c.req.param("kind") as OffKind, id = c.req.param("id");
  const body = await readJson<{ off?: unknown }>(c);
  if (!["tafsir", "reciter", "voice"].includes(kind)) return c.json({ error: "kind must be tafsir, reciter or voice" }, 400);
  if (typeof body?.off !== "boolean") return c.json({ error: "off must be true or false" }, 400);
  if (!(await library(c))[kind].some((x) => x.id === id)) return c.json({ error: `no such ${kind}` }, 400);
  if (body.off) {
    if (kind === "reciter" && (await turnedOff(c.env.DB)).reciters.filter((r) => r !== id).length >= RECITERS.length - 1) {
      return c.json({ error: "at least one reciter must stay on" }, 400);
    }
    await c.env.DB.prepare("INSERT OR REPLACE INTO turned_off (kind, id, by, at) VALUES (?, ?, ?, ?)").bind(kind, id, c.var.admin.email, Date.now()).run();
  } else {
    await c.env.DB.prepare("DELETE FROM turned_off WHERE kind = ? AND id = ?").bind(kind, id).run();
  }
  return c.body(null, 204);
});
