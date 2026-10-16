// Admin API contract (apps/api implements it, the admin dashboard calls it). Times are unix ms, days "YYYY-MM-DD" (UTC).
//
// Auth: every path below needs a valid Cloudflare Access JWT (Cf-Access-Jwt-Assertion, added by Access in front of
// /admin) or `Authorization: Bearer <ADMIN_TOKEN>`. 401 otherwise. Writes signed in through Access must come from the
// same origin (Origin header) with a JSON body.
//
// Event metrics (exports, funnel, top ayahs, ...) come from D1 counters that POST /api/events adds to per UTC day
// (daily_stats, COUNTER_METRICS below; device_stage for the funnel). Analytics Engine only archives the raw events; no
// Cloudflare API token is needed. Until the first event is counted, those fields are null and `eventsEnabled` is false.
// Event ranges are whole UTC days: the last `days` days up to and including today (`from`..`to`).
import type { Announcement } from "../../../contracts/types";

export const ADMIN_API = {
  whoami: "GET /admin/api/whoami",
  overview: "GET /admin/api/overview?days=30",
  content: "GET /admin/api/content?days=30&limit=20",
  clips: "GET /admin/api/clips?status=all|active|hidden|rejected&limit=100&offset=0",
  clipStatus: "PATCH /admin/api/clips/:id  { status: ClipStatus }",
  reports: "GET /admin/api/reports?status=open|done|dismissed|all&limit=100&offset=0",
  reportStatus: "PATCH /admin/api/reports/:id  { status: ReportStatus }",
  users: "GET /admin/api/users?limit=100&offset=0",
  luna: "GET /admin/api/luna?days=30",
  rollup: "POST /admin/api/rollup?day=YYYY-MM-DD  (re-runs the nightly snapshot for one day; default yesterday)",
} as const;

/** GET /admin/api/whoami */
export interface AdminWhoami { via: "access" | "account" | "token"; email: string | null }

/** A ranked count, e.g. { key: "2:255", n: 42 }. */
export interface Count { key: string; n: number }

/** Export numbers for one kind over the range. avgMs / avgBytes / successRate are null when there is nothing to divide. */
export interface ExportStats {
  done: number;
  failed: number;
  avgMs: number | null;           // average render time of finished exports
  avgBytes: number | null;        // average file size of finished exports
  successRate: number | null;     // done / (done + failed), 0..1
}

/** GET /admin/api/overview?days=30 (days 1..90 sets the window of the event metrics). */
export interface AdminOverview {
  eventsEnabled: boolean;
  days: number;
  from: string;                   // first UTC day of the event range (YYYY-MM-DD)
  to: string;                     // last UTC day (today)
  /** Anonymous devices (every visitor) from D1: active = last seen within 1 / 7 / 30 days. */
  devices: { total: number; dau: number; wau: number; mau: number; new1: number; new7: number; new30: number };
  /** Signed-in accounts; active30 = accounts with a device seen in the last 30 days. */
  users: { total: number; new7: number; active30: number };
  shares: { total: number; new7: number; opens: number };
  reports: { open: number };
  /** Devices seen in the last `days`, by country (ISO code, "" unknown) and by OS (android, ios, windows, mac, ...). */
  countries: Count[];
  platforms: Count[];
  /** Signed-in accounts by the country they chose on their profile (ISO code; accounts without one left out), all time. */
  accountCountries: Count[];
  /** Topics people picked as interests on their profile (topic id → accounts), all time. */
  interests: Count[];
  /** Event metrics over `from`..`to` (null until the first event is counted). */
  exports: { video: ExportStats; image: ExportStats } | null;
  /** export_failed by short reason (lower-case first line, long numbers as "#", URLs as "<url>"). */
  exportFailures: Count[] | null;
  /** Distinct devices that reached each stage in the range: opened the app, searched, selected an ayah, finished an
   *  export, shared (share_native or link_copy). Each stage is counted on its own (a device can export without an
   *  app_open in the range). */
  funnel: { open: number; search: number; ayah: number; export: number; share: number } | null;
  /** Event counts by name (app_open, search, export_done, share_native, link_copy, share_open, ...). */
  events: Count[] | null;
  devicesByType: Count[] | null;   // app_open by mobile / tablet / desktop
  browsers: Count[] | null;        // app_open by browser
  opensByCountry: Count[] | null;  // app_open by country (ISO code, "XX" unknown)
  /** Per-day series, oldest first, days without data left out. Keys:
   *    SNAPSHOT_METRICS names (nightly rollup, e.g. "devices_total"),
   *    "event:<name>" (events by name), "export:<video|image>", "export_fail:<video|image>",
   *    "funnel:<open|search|ayah|export|share>" (distinct devices that day). */
  daily: Record<string, { day: string; value: number }[]>;
}

/** Snapshot metrics written by the nightly rollup (daily_stats.metric, dim ""), one value per day. */
export const SNAPSHOT_METRICS = {
  devices_total: "all devices so far", devices_new: "devices first seen that day",
  devices_active: "devices whose last visit was that day or later (D1 approximation of DAU)",
  users_total: "signed-in accounts so far", users_new: "accounts created that day",
  shares_new: "share links created", reports_new: "reports received",
  luna_calls: "AI calls", luna_cost_usd: "AI spend (USD)",
} as const;

/** Counters added by POST /api/events (daily_stats.metric, dim = the key, value summed over the day); empty keys are
 *  skipped. Key "other" (in any Count list) = values outside the metric's known set (reciters, clip ids, orientations,
 *  sources, kinds, translation ids) or beyond its caps: per request 3 keys per metric (event names exempt) and 24 in
 *  all; per UTC day 300 keys for search, search_click, export_fail_reason, export_translation and export_ref.
 *  search, search_click and export_fail_reason rows are deleted after 120 days (outside every admin range). */
export const COUNTER_METRICS = {
  event: "events (dim = event name)",
  export: "export_done (dim = video|image|other)",
  export_ms: "sum of export_done ms (dim = kind; / export = average render time)",
  export_bytes: "sum of export_done bytes (dim = kind; / export = average size)",
  export_ref: "export_done (dim = first ayah, e.g. 2:255)",
  export_surah: "export_done (dim = surah number)",
  export_reciter: "export_done (dim = reciter folder)",
  export_translation: "export_done (dim = translation edition id or none)",
  export_orientation: "export_done (dim = orientation)",
  export_clip: "export_done (dim = clip id or colour)",
  export_fail: "export_failed (dim = kind)",
  export_fail_reason: "export_failed (dim = short reason)",
  search: "search (dim = normalised query: lower case, trimmed, spaces collapsed, at most 60 characters)",
  search_click: "search_click (dim = normalised query)",
  bg_source: "bg_select (dim = suggested|library|colour)",
  bg_clip: "bg_select (dim = clip id or colour)",
  open_device: "app_open (dim = mobile|tablet|desktop)",
  open_browser: "app_open (dim = browser)",
  open_country: "app_open (dim = country, XX unknown)",
} as const;
export type CounterMetric = keyof typeof COUNTER_METRICS;

/** device_stage.stage: a device reached this funnel stage on that day. */
export const STAGES = ["open", "search", "ayah", "export", "share"] as const;
export type Stage = (typeof STAGES)[number];

/** GET /admin/api/daily?from=YYYY-MM-DD&days=14 (1–31): the admin's picks from `from` on, and the Today's ayah
 *  counts (daily_stats metric "event", by UTC day) for the 7 days before `from` and `from` itself. */
export interface AdminDaily {
  eventsEnabled: boolean;
  /** Days with an admin pick in from..from+days-1 (every other day is the app's own pick). */
  picks: { day: string; ref: string; at: number }[];
  /** Oldest first; a day with no events has zeros. */
  stats: { day: string; seen: number; opened: number; shared: number }[];
  /** reminder_on minus reminder_off over all days (devices with the reminder on, approximately); null without events. */
  remindersOn: number | null;
}
/** PUT /admin/api/daily/:day { ref } sets that day's ayah (a day from today on; ref "2:255" checked against the
 *  surah's ayah count) → { day, ref, at }; DELETE /admin/api/daily/:day goes back to the app's own pick → 204. */
export interface AdminDailyPick { ref: string }

/** GET /admin/api/announcements → the 50 newest announcements (contracts Announcement), newest first. POST
 *  /admin/api/announcements AdminAnnouncementNew → 201 with the announcement (title 1–80 characters, body up to 280, link
 *  an app path like "/discover" or an https address, or empty); DELETE /admin/api/announcements/:id removes it for
 *  everyone → 204. The app shows the newest 5 from the last 60 days (GET /api/announcements). */
export interface AdminAnnouncements { items: Announcement[] }
export interface AdminAnnouncementNew { title: string; body?: string; link?: string | null }

/** GET /admin/api/library: every tafsir, reciter and translation voice, and whether the admin turned it off (owner,
 *  15 Oct 2026). PUT /admin/api/library/:kind/:id { off: boolean } → 204 (kind: tafsir | reciter | voice); 400 for an
 *  unknown id or the last reciter left on. The app follows within a minute (/api/config `off`; tafsir lists in 5). */
export interface AdminLibraryItem { id: string; name: string; detail: string | null; lang: string | null; off: boolean }
export interface AdminLibrary { tafsirs: AdminLibraryItem[]; reciters: AdminLibraryItem[]; voices: AdminLibraryItem[] }

/** GET /admin/api/content?days=30&limit=20 */
export interface AdminContent {
  eventsEnabled: boolean;
  days: number;
  from: string;
  to: string;
  /** Searches answered by the full search, from the D1 query cache: n = times asked (all time). */
  cachedSearches: { q: string; topic: string | null; n: number; created_at: number }[];
  /** Profile interests (topic id → accounts that picked it), all time. */
  interests: Count[];
  /** The rest is from event counters over `from`..`to` (null until the first event is counted). */
  ayahs: Count[] | null;          // export_done by first ayah ref
  surahs: Count[] | null;         // export_done by surah number
  searches: Count[] | null;       // search by normalised query
  noClickSearches: Count[] | null; // searches whose query had no search_click in the range ("other" left out)
  clips: Count[] | null;          // bg_select by clip id ("colour" = solid colour)
  exportClips: Count[] | null;    // export_done by clip id
  bgSources: Count[] | null;      // bg_select by source: suggested | library | colour
  reciters: Count[] | null;       // export_done by reciter
  translations: Count[] | null;   // export_done by translation
  orientations: Count[] | null;   // export_done by orientation
}

export type ClipStatus = "active" | "hidden" | "rejected";

/** GET /admin/api/clips → { clips, total, eventsEnabled }. Hidden/rejected clips disappear from the app within a minute. */
export interface AdminClip {
  id: string;
  source: string;                 // pixabay | pexels
  author: string | null;
  page_url: string | null;
  caption: string | null;
  tags: string[];
  duration: number | null;
  thumb: string;                  // path under the media base (PublicConfig.mediaBase), e.g. "thumbs/pb1.webp"
  video: { portrait: string; landscape: string } | null;
  quality: number | null;
  safety: Record<string, number> | null;
  status: ClipStatus;
  created_at: number;
  reports: number;                // reports that name this clip (any status)
  uses: number | null;            // bg_select events in the last 30 UTC days (null until the first event is counted)
}
export interface AdminClipsResponse { clips: AdminClip[]; total: number; eventsEnabled: boolean }

export type ReportStatus = "open" | "done" | "dismissed";

/** GET /admin/api/reports → { reports, total } */
export interface AdminReport {
  id: number;
  created_at: number;
  kind: "background" | "search" | "text" | "other";
  ref: string | null;
  clip_id: string | null;
  note: string | null;
  status: ReportStatus;
  anon_id: string | null;
  user_id: string | null;
}
export interface AdminReportsResponse { reports: AdminReport[]; total: number }

/** GET /admin/api/users → { users, total } (signed-in accounts, most recently active first) */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: number;
  last_login: number;
  /** Latest of last sign-in and the newest last_seen of the person's devices. */
  last_active: number;
  creations: number;
  favourites: number;
  devices: number;
  // Profile (all optional, set by the person):
  display_name: string | null;
  lang: string | null;
  country: string | null;      // ISO code
  city: string | null;
  /** Only the last three digits are shown ("•••••••••123"); the full number never leaves the API. */
  phone: string | null;
  phone_opt_in: boolean;
  interests: string[];         // topic ids
  updated_at: number | null;   // last profile change
}
export interface AdminUsersResponse { users: AdminUser[]; total: number }

/** GET /admin/api/luna?days=30 */
export interface AdminLuna {
  capUsd: number;
  days: { day: string; calls: number; input_tokens: number; cost_usd: number }[];
  /** D1 search cache: rows = distinct cached queries, hits = answers served from it (no AI call). */
  cache: { rows: number; hits: number };
}

/** POST /admin/api/rollup → what was written. */
export interface AdminRollup { day: string; rows: number; eventsEnabled: boolean }
