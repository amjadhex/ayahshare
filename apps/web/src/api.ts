// Every network call the app makes. Paths follow contracts/types.ts.
import type {
  Clip, ClipsResponse, Creation, CreationKind, Me, ProfilePatch, PublicConfig, Recipe, Ref, ReflectionsResponse, ReportBody, SearchResponse, ShareCreated, SignedIn, Surah,
  SurahBackgrounds, TafsirId, TafsirInfo, TafsirListResponse, TafsirResponse, TopicsFile, TrendingResponse, AyahStatsResponse, ImpactResponse, AyahGroups,
  DailyPicks, PushSubscribeBody, Announcement, AnnouncementsResponse,
} from "../../../contracts/types";
import { anon } from "./analytics";
import type { Edition } from "./design";
import { VOICES } from "../../../contracts/voices";
import { apiBase, apiUrl, request } from "./endpoint";
import { setAyahGroups } from "./groups";
import { dedupeEditions } from "./translations";

export class HttpError extends Error {
  constructor(public status: number, url: string) { super(`${status} ${url}`); }
}

/** `local`: the copy bundled with the app (only differs from the Worker's in the iOS / Android app). */
async function json<T>(url: string, init?: RequestInit, local = false): Promise<T> {
  const r = await (local ? fetch(url) : request(url, init));
  if (!r.ok) throw new HttpError(r.status, url);
  if (r.headers.get("content-type")?.includes("json")) return r.json() as Promise<T>;
  // Writes may answer with no body. A read that gets HTML is the static host's fallback page: "not found".
  if (init?.method && init.method !== "GET") return undefined as T;
  throw new HttpError(404, url);
}

const send = <T>(method: string, url: string, body?: unknown) =>
  json<T>(url, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

let mediaBase = "/media/";
/** Where clips, posters and thumbnails live (`/api/config` → mediaBase). */
export function setMediaBase(base: string) {
  mediaBase = base;
  // Clips, posters and recitations on another host than the page (the iOS / Android app, a media host): connect to
  // it now, so the first reel or thumbnail does not wait for the connection too.
  preconnect(mediaUrl(""));
  preconnect(apiUrl("/audio/"));
}
export const mediaUrl = (path: string) => new URL(apiUrl(mediaBase + path), location.href).href;
const connected = new Set<string>();
/** <link rel="preconnect"> to the host of `url` when it is not the page's own: one for fetch() (CORS, no cookies)
 *  and one for <img> / <video>. */
export function preconnect(url: string) {
  let origin: string;
  try { origin = new URL(url, location.href).origin; } catch { return; }
  if (origin === location.origin || connected.has(origin) || typeof document === "undefined") return;
  connected.add(origin);
  for (const cors of [true, false]) {
    const link = Object.assign(document.createElement("link"), { rel: "preconnect", href: origin });
    if (cors) link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}
/** The rendition that matches the orientation (square is a centre crop of the portrait one). */
export const clipUrl = (clip: Clip, kind: "video" | "poster", orientation: Recipe["orientation"]) =>
  mediaUrl(clip[kind][orientation === "landscape" ? "landscape" : "portrait"]);
/** The app path of an ayah's recitation (what onDevice and the service worker see). */
export const audioPath = (folder: string, surah: number, ayah: number) =>
  `/audio/${folder}/${String(surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}.mp3`;
export const audioUrl = (folder: string, surah: number, ayah: number) => apiUrl(audioPath(folder, surah, ayah));

/** Data files the Worker filters (clips hidden in admin drop out). The app falls back to the copy it was built with
 *  when the Worker cannot be reached. */
const workerData = <T>(path: string) => json<T>(path).catch((e) => (apiBase() ? json<T>(path, undefined, true) : Promise.reject(e)));

export const getConfig = () => json<PublicConfig>("/api/config");

/** data/surahs.json, or the Quran API's surah list while the data file is not published. */
export async function getSurahs(): Promise<Surah[]> {
  try {
    return await json<Surah[]>("/data/surahs.json");
  } catch {
    const d = await json<{ data: { number: number; name: string; englishName: string; englishNameTranslation: string; numberOfAyahs: number }[] }>("/qapi/surah");
    return d.data.map((s) => ({ n: s.number, name_ar: s.name, name_en: s.englishName, meaning: s.englishNameTranslation, ayahs: s.numberOfAyahs }));
  }
}

/** Translations kept in our own media bucket (same shape as the Quran API's), offered with the Quran API's own. */
const OWN_EDITIONS: Edition[] = [
  // Quran Lalithasaram (Karakunnu & Elayavoor), the text its recorded voice reads; used with the publisher's permission.
  { identifier: "ml.lalithasaram", language: "ml", englishName: "ഖുര്‍ആന്‍ ലളിതസാരം (Karakunnu & Elayavoor)", name: "ഖുര്‍ആന്‍ ലളിതസാരം" },
];
const ownEdition = (edition: string) => OWN_EDITIONS.some((e) => e.identifier === edition);

/** The translations a recorded voice reads: kept when the same translation is listed twice. */
const VOICED = new Set(VOICES.map((v) => v.text));

/** Every translation the app offers: data/translations.json (pipeline/translations.py: the Quran API's translations and
 *  the Quran Foundation's that are not among them, each loaded and checked), else the Quran API's own list; then ours. */
export const getEditions = () =>
  workerData<{ editions: Edition[] }>("/data/translations.json")
    .then((d) => d.editions, () => json<{ data: Edition[] }>("/qapi/edition?format=text&type=translation").then((d) => d.data))
    .then((list) => dedupeEditions([...list, ...OWN_EDITIONS], VOICED));

interface QapiAyah { numberInSurah: number; text: string }
const surahTexts = new Map<string, Promise<QapiAyah[]>>();
/** A whole surah in one edition: one cached file per surah and edition (not per range), so the Arabic is shared by every
 *  translation and the next ayah of the same surah needs no request. */
function surahText(surah: number, edition: string) {
  const key = `${surah}/${edition}`;
  if (!surahTexts.has(key)) {
    const url = ownEdition(edition) ? mediaUrl(`translations/${edition}/${surah}.json`) : `/qapi/surah/${key}`;
    surahTexts.set(key, json<{ data: { ayahs: QapiAyah[] } }>(url).then((d) => d.data.ayahs, (e) => {
      surahTexts.delete(key); // try again next time
      throw e;
    }));
  }
  return surahTexts.get(key)!;
}

/** One ayah's text in one edition, from that surah's cached file (so opening the ayah afterwards needs no request). */
export async function getAyahFromSurah(surah: number, ayah: number, edition: string) {
  return (await surahText(surah, edition))[ayah - 1]?.text ?? "";
}

/** Arabic (Uthmani) and, unless "none", the translation for surah:from-to. */
export function getAyahText(surah: number, from: number, to: number, translation: string) {
  const editions = ["quran-uthmani", ...(translation !== "none" ? [translation] : [])];
  return Promise.all(editions.map(async (e) => ({ ayahs: (await surahText(surah, e)).slice(from - 1, to) })));
}

export const getAyahEnglish = (ref: Ref) => json<{ data: { text: string } }>(`/qapi/ayah/${ref}/en.sahih`).then((d) => d.data.text);


/** `page` ≥ 2: the further results that page 1 offered with `more` / `next`. */
export const search = (q: string, mode: "fast" | "full", signal?: AbortSignal, page = 1) =>
  json<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&mode=${mode}${page > 1 ? `&page=${page}` : ""}`, { signal });

export const searchClips = (q: string, limit = 24) =>
  json<ClipsResponse>(`/api/clips?limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((d) => remember(d.results));

/** Library catalogue (data/clips.json plus any clip returned by the API), by id. */
const catalogue = new Map<string, Clip>();
const catalogueListeners = new Set<() => void>();
export const clipById = (id: string) => catalogue.get(id) ?? null;
export const allClips = () => [...catalogue.values()];
/** Called whenever clips are added (the app re-renders so a design can show a clip that just arrived). */
export function onCatalogue(fn: () => void) {
  catalogueListeners.add(fn);
  return () => void catalogueListeners.delete(fn);
}

/** Adds clips to the catalogue so a recipe can refer to them by id. */
export function remember(clips: Clip[]) {
  const before = catalogue.size;
  for (const c of clips) catalogue.set(c.id, c);
  if (catalogue.size !== before) for (const fn of catalogueListeners) fn();
  return clips;
}

let catalogueLoad: Promise<void> | null = null;
export const loadCatalogue = () =>
  (catalogueLoad ??= workerData<Clip[]>("/data/clips.json").then(remember, () => [] as Clip[]).then(() => undefined));

/** Makes sure a clip referenced by a recipe is in the catalogue (the library list, or the API for a single clip). */
export async function ensureClip(id: string) {
  await loadCatalogue();
  if (!catalogue.has(id)) await json<Clip>(`/api/clips/${encodeURIComponent(id)}`).then((c) => remember([c]), () => {});
}

const surahBgs = new Map<number, Promise<SurahBackgrounds | null>>();
export function getSurahBackgrounds(surah: number) {
  if (!surahBgs.has(surah)) surahBgs.set(surah, workerData<SurahBackgrounds>(`/data/bg/${surah}.json`).catch(() => null));
  return surahBgs.get(surah)!;
}

// ---------- Discover feed and Reflect ----------

let groupsLoad: Promise<void> | null = null;
/** data/ayah-groups.json into groups.ts (once per visit; without it every ayah stands alone, and a later call retries). */
export const loadAyahGroups = () =>
  (groupsLoad ??= workerData<AyahGroups>("/data/ayah-groups.json").then(setAyahGroups, () => { groupsLoad = null; }));

let topics: Promise<TopicsFile> | null = null;
/** data/topics.json: the topic lists the feed mixes from (loaded once, kept for the visit). */
export const getTopics = () => (topics ??= workerData<TopicsFile>("/data/topics.json").catch((e) => { topics = null; throw e; }));

/** News from AyahShare (Notifications; the bell's dot): asked again after five minutes, none when it cannot load. */
let news: { at: number; items: Promise<Announcement[]> } | null = null;
export function getAnnouncements(): Promise<Announcement[]> {
  if (!news || Date.now() - news.at > 300_000) {
    news = { at: Date.now(), items: json<AnnouncementsResponse>("/api/announcements").then((r) => r.items, () => { news = null; return []; }) };
  }
  return news.items;
}
let trending: Promise<Ref[]> | null = null;
/** Most exported and shared ayahs of the last 30 days (once per visit; nothing when unavailable). */
/** The web's daily reminder (Web Push, webpush.ts): subscribe or change the time; stop. */
export const pushSubscribe = (body: PushSubscribeBody) => send<void>("POST", "/api/push", body);
export const pushUnsubscribe = (endpoint: string) => send<void>("DELETE", "/api/push", { endpoint });
/** The days an admin chose the ayah for, from `from` (YYYY-MM-DD, local date) on (today.ts). */
export const getDailyPicks = (from: string, days: number) => json<DailyPicks>(`/api/daily?from=${from}&days=${days}`);
export const getTrending = () => (trending ??= json<TrendingResponse>("/api/trending").then((d) => d.refs.map((r) => r.ref), () => [] as Ref[]));
/** Trending with its counts (Discover · Most shared today). */
export const getTrendingCounts = (days: number) => json<TrendingResponse>(`/api/trending?days=${days}`);
/** Anonymous counts per ayah (stats.ts caches them). */
export const getAyahStats = (refs: Ref[]) => json<AyahStatsResponse>(`/api/stats/ayahs?refs=${encodeURIComponent(refs.join(","))}`);
/** The person's private impact (Profile). */
export const getMyImpact = () => json<ImpactResponse>("/api/stats/me");

export const getTafsir = (ref: Ref, lang: string, id?: TafsirId) =>
  json<TafsirResponse>(`/api/tafsir/${ref}?lang=${encodeURIComponent(lang)}${id ? `&id=${encodeURIComponent(id)}` : ""}`);
let tafsirs: Promise<TafsirInfo[]> | null = null;
/** Every tafsir the app offers, for the Reflect sheet's chooser (loaded once, kept for the visit). */
export const getTafsirs = () => (tafsirs ??= json<TafsirListResponse>("/api/tafsirs?v=5") /* ?v: a new list (15 Oct 2026: admin Library turns tafsirs off) is not held back by a cached old one */.then((d) => d.tafsirs, (e) => { tafsirs = null; throw e; }));
export const getReflections = (ref: Ref, lang: string, page = 1) =>
  json<ReflectionsResponse>(`/api/reflections/${ref}?lang=${encodeURIComponent(lang)}&page=${page}`);
/** QuranReflect lessons for the ayah (mostly by verified teachers): the Scholars' notes. */
export const getLessons = (ref: Ref, lang: string, page = 1) =>
  json<ReflectionsResponse>(`/api/reflections/${ref}?lang=${encodeURIComponent(lang)}&page=${page}&kind=lessons`);
/** An author's photo, only ever through our own Worker (/api/avatar/…); anything else is not loaded. */
export const avatarSrc = (path: string | null | undefined) => (path?.startsWith("/api/avatar/") ? apiUrl(path) : null);

/** `anon` lets a signed-out person see the impact of their own links (Profile); the server ignores it when signed in. */
export const createShare = (recipe: Recipe, og?: string) => send<ShareCreated>("POST", "/api/shares", { recipe, og, anon });
export const getShare = (code: string) => json<{ recipe: Recipe }>(`/api/shares/${encodeURIComponent(code)}`);

export const sendReport = (body: ReportBody) => send<unknown>("POST", "/api/reports", { ...body, anon });

// Account. List responses are accepted either as a bare array or wrapped in an object.
const list = <T>(d: unknown, key: string): T[] =>
  Array.isArray(d) ? d : Array.isArray((d as Record<string, unknown>)?.[key]) ? ((d as Record<string, T[]>)[key]) : [];

/** The app (not the web) also gets the session token to send as a Bearer header (contracts SignedIn). */
export const signInWithGoogle = (credential: string) => send<SignedIn>("POST", "/api/auth/google", { credential, anon });
/** Sign in with Apple (the iOS app): the identity token, the name Apple gives the first time, and the authorization code
 *  (the Worker exchanges it for the refresh token that deleting the account revokes). */
export const signInWithApple = (idToken: string, name?: string, authorizationCode?: string) =>
  send<SignedIn>("POST", "/api/auth/apple", { idToken, name, authorizationCode, anon });

/** A refused email sign-in step: the HTTP status and the server's `error` (contracts: "wrong_code", "expired"…). */
export class AuthError extends HttpError {
  constructor(status: number, url: string, public reason: string) { super(status, url); }
}
async function authPost<T>(url: string, body: unknown): Promise<T> {
  const r = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return r.json() as Promise<T>;
  const reason = await r.json().then((b: { error?: unknown }) => (typeof b?.error === "string" ? b.error : ""), () => "");
  throw new AuthError(r.status, url, reason);
}
/** Email sign-in: a 6-digit code to `email` (`turnstile`: the bot check's token, when the server asks for one), then
 *  signing in with it (same answer as Google's). */
export const startEmailSignIn = (email: string, turnstile?: string) =>
  authPost<{ ok: true }>("/api/auth/email/start", turnstile ? { email, turnstile } : { email });
export const verifyEmailCode = (email: string, code: string) => authPost<SignedIn>("/api/auth/email/verify", { email, code, anon });
export const signOut = () => send<unknown>("POST", "/api/auth/logout");
export const getMe = () => json<Me>("/api/me");
export const deleteMe = () => send<unknown>("DELETE", "/api/me");
/** Keeps "My language" with the account. */
export const saveLang = (lang: string) => send<Me>("PUT", "/api/me/lang", { lang });
/** Profile fields (contracts ProfilePatch); the server checks each one and answers 400 { error, field }. */
export const patchMe = (patch: ProfilePatch) => send<Me>("PATCH", "/api/me", patch);
export const getCreations = () => json<unknown>("/api/creations").then((d) => list<Creation>(d, "creations"));
/** Saves a design to the account (an identical one is updated). `thumb`: a JPEG data URL ≤ 60 KB; `at`: when it was
 *  made (designs moved from the device). */
export const saveCreation = (c: { recipe: Recipe; title: string; kind: CreationKind; thumb?: string; at?: number }) =>
  send<Creation>("POST", "/api/creations", c);
export const deleteCreation = (id: string) => send<unknown>("DELETE", `/api/creations/${encodeURIComponent(id)}`);
export const getFavourites = () =>
  json<unknown>("/api/favourites").then((d) => list<Ref | { ref: Ref }>(d, "favourites").map((f) => (typeof f === "string" ? f : f.ref)));
export const setFavourite = (ref: Ref, on: boolean) => send<unknown>(on ? "PUT" : "DELETE", `/api/favourites/${encodeURIComponent(ref)}`);

// ---------- counts and impact (Profile, Activity) ----------

/** The person's private impact (GET /api/stats/me): the account's when signed in, else this device's (its anonymous id
 *  goes in a header, never in the address). */
export const getImpact = () => json<ImpactResponse>("/api/stats/me", { headers: { "X-Anon": anon } });
/** Someone who opened share link `code` exported or linked its design: unchanged ("share") or changed ("make"). */
export const reuseShare = (code: string, kind: "share" | "make") => send<unknown>("POST", `/api/shares/${encodeURIComponent(code)}/reuse`, { kind });
