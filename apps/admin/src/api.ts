// Admin API client (contract: apps/api/src/admin-contract.ts).
// Sign-in: the app's own session cookie (Google sign-in, for an address on the Worker's ADMIN_EMAILS), or Cloudflare Access
// when it is set up in front of /admin. ADMIN_TOKEN is for scripts only; the page never asks for it.
import type {
  AdminAnnouncementNew, AdminAnnouncements, AdminClipsResponse, AdminContent, AdminDaily, AdminLibrary, AdminLuna, AdminOverview, AdminReportsResponse,
  AdminUsersResponse, AdminWhoami, ClipStatus, ReportStatus,
} from "../../api/src/admin-contract";
import type { Announcement as AdminAnnouncement, Surah } from "../../../contracts/types";

export type { AdminClip, AdminDaily, AdminLibraryItem, AdminReport, AdminUser, ClipStatus, ReportStatus } from "../../api/src/admin-contract";
export type { AdminAnnouncement };

export type LibraryKind = "tafsir" | "reciter" | "voice";

/** The server answered 401: not signed in, or signed in with an account that is not an admin. */
export class Unauthorized extends Error {
  constructor() { super("unauthorized"); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new Error("Could not reach the server. If your sign-in has expired, reload the page.");
  }
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : res.json();
}

const get = <T>(path: string, params: Record<string, string | number> = {}) =>
  request<T>(`/admin/api/${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`);
const patch = (path: string, body: unknown) => request<unknown>(`/admin/api/${path}`, { method: "PATCH", body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(`/admin/api/${path}`, { method: "PUT", body: JSON.stringify(body) });
const post = <T>(path: string, body: unknown) => request<T>(`/admin/api/${path}`, { method: "POST", body: JSON.stringify(body) });

export const api = {
  whoami: () => get<AdminWhoami>("whoami"),
  overview: (days: number) => get<AdminOverview>("overview", { days }),
  content: (days: number, limit = 20) => get<AdminContent>("content", { days, limit }),
  clips: (offset: number, limit = 500) => get<AdminClipsResponse>("clips", { status: "all", limit, offset }),
  setClipStatus: (id: string, status: ClipStatus) => patch(`clips/${encodeURIComponent(id)}`, { status }),
  reports: (status: ReportStatus | "all", offset: number, limit = 100) => get<AdminReportsResponse>("reports", { status, limit, offset }),
  reportCount: (status: ReportStatus) => get<AdminReportsResponse>("reports", { status, limit: 1 }).then((r) => r.total),
  setReportStatus: (id: number, status: ReportStatus) => patch(`reports/${id}`, { status }),
  users: (offset: number, limit = 100) => get<AdminUsersResponse>("users", { limit, offset }),
  luna: (days: number) => get<AdminLuna>("luna", { days }),
  daily: (from: string, days: number) => get<AdminDaily>("daily", { from, days }),
  setDaily: (day: string, ref: string) => put<{ day: string; ref: string; at: number }>(`daily/${day}`, { ref }),
  clearDaily: (day: string) => request<void>(`/admin/api/daily/${day}`, { method: "DELETE" }),
  announcements: () => get<AdminAnnouncements>("announcements"),
  addAnnouncement: (a: AdminAnnouncementNew) => post<AdminAnnouncement>("announcements", a),
  deleteAnnouncement: (id: number) => request<void>(`/admin/api/announcements/${id}`, { method: "DELETE" }),
  library: () => get<AdminLibrary>("library"),
  setOff: (kind: LibraryKind, id: string, off: boolean) => put<void>(`library/${kind}/${encodeURIComponent(id)}`, { off }),
};

/** All rows of a paged list, page by page. */
export async function loadAll<T>(page: (offset: number) => Promise<{ rows: T[]; total: number }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const p = await page(rows.length);
    rows.push(...p.rows);
    if (!p.rows.length || rows.length >= p.total) return rows;
  }
}

// --- public files of the web app (same origin) ------------------------------------------------------------------------

let mediaBase = "/media/";
/** Reads the clip files' base path from the web app's public config (falls back to /media/). */
let googleClientId: string | null = null;
/** The Google client id for the sign-in button (null when Google sign-in is off). */
export const googleId = () => googleClientId;
export const loadConfig = (): Promise<void> =>
  fetch("/api/config").then((r) => r.json()).then((c: { mediaBase: string; googleClientId: string | null }) => {
    mediaBase = c.mediaBase;
    googleClientId = c.googleClientId;
  }, () => undefined);

/** Signs in with a Google ID token (the app's own endpoint; it sets the session cookie). */
export async function googleSignIn(credential: string): Promise<void> {
  const res = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }) });
  if (!res.ok) throw new Error("Google sign-in did not work. Try again.");
}
export const signOut = (): Promise<unknown> => fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
/** URL of a clip file or thumbnail, e.g. "thumbs/pb1.webp". */
export const media = (path: string): string => mediaBase + path;

let surahs: Promise<Map<number, Surah>> | undefined;
let ayahsEn: Promise<Record<string, string>> | undefined;
/** The English translation of every ayah (ref → text), for showing what a day's ayah says; empty when it can't be loaded. */
export function ayahTexts(): Promise<Record<string, string>> {
  ayahsEn ??= fetch("/data/ayahs-en.json").then((r) => r.json(), () => ({}));
  return ayahsEn;
}

/** Surah names for labelling refs like "2:255"; empty when the file can't be loaded. */
export function surahNames(): Promise<Map<number, Surah>> {
  surahs ??= fetch("/data/surahs.json").then((r) => r.json()).then((list: Surah[]) => new Map(list.map((x) => [x.n, x])), () => new Map());
  return surahs;
}
