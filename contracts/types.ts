// Shared contracts for pipeline (writes the data files), api (serves them) and web (reads them).
// Python pipeline output must match these shapes exactly. Change here first, then in every track.

/** "surah:ayah", e.g. "2:255". */
export type Ref = string;

// ---------------------------------------------------------------------------
// Static data files — written by pipeline/, published under apps/web/public/data/
// (served as static assets; the Worker reads them through the ASSETS binding)
// ---------------------------------------------------------------------------

/** data/surahs.json */
export interface Surah {
  n: number;            // 1..114
  name_ar: string;      // سُورَةُ ٱلْفَاتِحَةِ
  name_en: string;      // Al-Faatiha
  meaning: string;      // The Opening
  ayahs: number;        // number of ayahs
}

/** data/ayahs-en.json — English text used for search results and Luna rerank descriptions. */
export type AyahsEn = Record<Ref, string>;

/** data/topics.json — search topics, each with an offline-ranked ayah list (EmbeddingGemma 2 shortlist → Luna ranking). */
export interface TopicsFile {
  version: string;      // ISO date of the build
  topics: Topic[];
}
export interface Topic {
  id: string;           // "patience"
  label: string;        // English label shown to Luna in the router question
  refs: Ref[];          // ranked best-first, up to 30
}

/** data/ayah-groups.json — ayahs that must not be shown alone (pipeline A1b): ref → [from, to], the smallest range of
 *  that surah a design of it shows ("107:4" → [4, 7]: "So woe to those who pray" needs 107:5-7). Absent = stands alone. */
export type AyahGroups = Record<Ref, [number, number]>;

/** data/bg/{surah}.json — precomputed background suggestions per ayah of that surah. */
export interface SurahBackgrounds {
  surah: number;
  /** ayah number → clip ids ranked best-first (up to 8). */
  ayahs: Record<string, string[]>;
  /** ayah numbers flagged sensitive (punishment, hellfire, war) — their suggestions are calm/abstract only. */
  sensitive: number[];
}

/** data/clips.json — the library catalogue (active clips only). */
export interface Clip {
  id: string;           // "pb283533" (pb = Pixabay, px = Pexels)
  duration: number;     // seconds (stored loop length, ≤ 12)
  caption: string;      // short English description, used for library search
  tags: string[];
  /** Paths are relative to the media base (`/media/` today, a media host such as `https://media.ayahshare.com/` later).
   *  Two renditions so neither orientation is an upscaled crop. Square = centre crop of either. */
  video: { portrait: string; landscape: string };   // "clips/p/pb283533.mp4" 720×1280, "clips/l/pb283533.mp4" 1280×720 (H.264, no audio, ≤ 12 s loop, ~1–2.5 MB, faststart)
  poster: { portrait: string; landscape: string };  // "posters/p/pb283533.jpg", "posters/l/pb283533.jpg" (frame at 1 s, same size as video; used for image export)
  thumb: string;        // "thumbs/pb283533.webp" (portrait crop, 240×426)
  /** 1080p renditions, same frames and crop as `video` (H.264 High, ≤ ~3 Mbps, no audio, faststart). Present only for
   *  clips whose source reaches 1080p with ≤ 1.25× upscaling, per orientation: most clips have `landscape`
   *  (1920×1080), fewer have `portrait` (1080×1920, needs a 4K / 1440p+ or portrait source). Fall back to `video`. */
  hd?: { portrait?: string; landscape?: string };   // "clips/p1080/pb283533.mp4", "clips/l1080/pb283533.mp4"
  /** Added 2026-10-12: a small moving version for the search result tiles, same frames as `video.portrait` (360×640,
   *  H.264, no audio, ~100–400 KB, faststart). Missing on clips added before their preview was made: show `thumb`. */
  preview?: string;     // "previews/pb283533.mp4"
}

// ---------------------------------------------------------------------------
// Design recipe — everything needed to re-create a design (share links, My creations)
// ---------------------------------------------------------------------------
export interface Recipe {
  v: 1;
  surah: number;
  from: number;
  to: number;                          // ≤ from + 19 (ayahs shown one after another — each for its full recitation — over the same background). People pick up to 3; an ayah that must not be shown alone (AyahGroups) widens to its group, up to 17 ayahs; longer ranges are clamped
  reciter: string;                     // everyayah.com folder, e.g. "Alafasy_128kbps" (audio via /audio/:folder/:SSSAAA.mp3)
  translation: string;                 // edition id: alquran.cloud ("en.sahih"), Quran Foundation ("ta.qf-133"), or "none"
  orientation: "portrait" | "square" | "landscape";
  bg: { type: "clip"; id: string } | { type: "colour"; colour: string };
  font: string;
  quranSize: number;                   // 1..8
  transSize: number;                   // 1..8
  textColor: string;                   // #rrggbb
  boxColor: string;
  boxOpacity: number;                  // 0..100
  borderColor: string;
  borderWidth: number;                 // 0..8
  // Added with the phone app (2026-10). Optional on input: missing fields take the defaults shown, so older links
  // and saved designs keep working. Readers should treat them as always present after validation.
  effect?: "glass" | "solid" | "shadow" | "outline" | "none" | "shade";   // text block look; missing = "solid". "shade" (added 2026-10-12, new designs' default): one even dark shade over the whole frame, its strength from the background (Auto contrast), no box
  showSurah?: boolean;                 // surah-name header; default true
  showTranslation?: boolean;           // default true
  showRef?: boolean;                   // ayah numbers and the reference; default true
  /** Video text animation: each ayah's text block enters as its recitation starts and exits as it ends. Default
   *  "none". (8 Oct 2026, owner-approved: "typewriter" was removed; readers accept it from older links, saved designs and
   *  profile preferences and treat it as "fade".) */
  animation?: "none" | "fade" | "rise" | "zoom";
  textX?: number;                      // centre of the text block, fraction of the frame width 0..1; default 0.5
  textY?: number;                      // centre of the text block, fraction of the frame height 0..1; default 0.54
  textWidth?: number;                  // fraction of the frame width 0.3..1, or 0 = automatic (86 %, landscape 72 %); default 0
  headerX?: number;                    // centre of the surah-name header (movable like the text block), fraction 0..1; default 0.5
  headerY?: number;                    // fraction of the frame height 0..1; default 0.11
  /** Auto contrast (8 Oct 2026): the device measures the background behind the text and the surah name and adds the
   *  least visible fix (halo, soft scrim, darker box or dark text) that keeps them readable. Only this switch is
   *  stored; the measured values are derived each time. Default true (older links too). */
  autoContrast?: boolean;
  /** Split long ayahs (8 Oct 2026): an ayah too long to show whole at the design's size is shown in parts, one after
   *  another during its recitation, each with its share of the translation; the Arabic is cut only at the mushaf's pause
   *  marks. Only this switch is stored; the parts are derived each time from the layout. Default true (older links too). */
  splitLong?: boolean;
  /** Translation voice (8 Oct 2026, owner-approved): after each ayah's recitation a recorded human voice reads its
   *  translation, then the next ayah comes (contracts/voices.ts: a voice id, or "none" = recitation only, the default for
   *  older links too). With a voice, `translation` is the edition it reads (readers turn a voice that does not match
   *  the translation off). The ayah's text stays on screen through both. */
  voice?: string;
}

// ---------------------------------------------------------------------------
// HTTP API — implemented by apps/api, called by apps/web
// ---------------------------------------------------------------------------

/** GET /api/search?q=...&mode=fast|full[&page=2..6]
 *  fast: embedding order only (< 300 ms), full: Luna-refined (cached in D1).
 *  page ≥ 2: the next 10 of up to 60 results, in embedding order above a confidence floor, without the ayahs of page 1
 *  (no Luna). References (2:255, 94:5-6) have no further pages. */
export interface SearchResponse {
  q: string;
  mode: "fast" | "full";
  topic: string | null;
  results: { ref: Ref; text: string }[];   // up to 10, text = English
  /** Added 2026-10-08 (older servers and references leave both out = no more): whether another page exists, and its
   *  number for `page`. */
  more?: boolean;
  next?: number;
}

/** GET /api/clips?q=...&limit=24 (no q → curated default order) */
export interface ClipsResponse { results: Clip[] }

/** POST /api/shares  body: { recipe: Recipe, og?: string (data:image/jpeg;base64, ≤ 200 KB) }
 *  → { code, url }.  GET /api/shares/:code → { recipe }.  GET /s/:code → HTML page with OG tags that opens the app. */
export interface ShareCreated { code: string; url: string }

/** POST /api/reports */
export interface ReportBody {
  kind: "background" | "search" | "text" | "other";
  ref?: Ref;
  clip?: string;
  note?: string;
}

/** GET /api/config → public runtime config for the web app. */
export interface PublicConfig {
  appName: string;
  googleClientId: string | null;
  /** Added 2026-10-08: sign-in with a code sent by email is offered (missing = no; older servers). */
  emailSignIn?: boolean;
  mediaBase: string;
  /** Added 2026-10-08: the Cloudflare Turnstile site key when the server asks for a bot check before sending an email
   *  code (POST /api/auth/email/start `turnstile`); missing = no check. */
  turnstileSiteKey?: string;
  /** Added 2026-10-12: the public VAPID key (base64url, uncompressed P-256) for the web's daily reminder (Web Push);
   *  missing = no web reminder. */
  vapidPublicKey?: string;
  /** Added 2026-10-15: what the admin turned off (admin Library): no longer offered in the app. Ids: tafsir ids as
   *  strings, reciter folders (contracts/reciters.ts), voice ids (contracts/voices.ts). Missing = everything on. */
  off?: TurnedOff;
  /** Added 2026-10-16: the oldest app version still allowed ("1.0.2"); an older iOS / Android app shows only an
   *  Update screen (MIN_APP_VERSION_IOS / _ANDROID in apps/api/wrangler.jsonc). Missing = any version. */
  minAppVersion?: { ios?: string; android?: string };
}
export interface TurnedOff { tafsirs: string[]; reciters: string[]; voices: string[] }

/** Auth (Google Identity Services on the web, the native Google sign-in in the iOS / Android app, or a code by email).
 *  POST /api/auth/google { credential } → sets HTTP-only session cookie, returns Me (SignedIn).
 *  POST /api/auth/email/start { email, turnstile? } → { ok: true } (a 6-digit code is on its way; the same answer for any
 *    address); 400 { error: "invalid email" }, 403 { error: "bot_check" } (PublicConfig turnstileSiteKey set and the
 *    Turnstile token missing or not passing), 429 too soon (one code per 30 s, five an hour), 503 { error: "unavailable" }.
 *  POST /api/auth/email/verify { email, code, anon? } → like /api/auth/google (SignedIn); 401 { error: "wrong_code" },
 *    410 { error: "expired" } (or no code), 429 { error: "too_many_attempts" } (5 guesses, then a new code is needed).
 *    An address that already has an account (Google too) signs into it; Google later joins an email-only account.
 *  POST /api/auth/apple { idToken, authorizationCode?, name?, anon? } → like /api/auth/google (SignedIn): Sign in with
 *    Apple, the iOS app only. 401 invalid token, 503 Apple's keys unavailable. Joins the account with the token's email only
 *    when Apple verified it and it is not a private relay address; `name` (given by Apple on the first sign-in) names a new
 *    or nameless account. `authorizationCode` (iOS build 2 on) is exchanged for the refresh token that deleting the
 *    account revokes; sign-in never fails because of it.
 *  POST /api/auth/logout.  GET /api/me → Me | 401.  DELETE /api/me → deletes account data (and revokes Sign in with Apple).
 *  The app (Origin capacitor://localhost or https://localhost) also gets `token`, which it keeps on the device and
 *  sends as `Authorization: Bearer <token>` instead of the cookie; /api/* answers those origins with CORS headers. */
export interface Me {
  /** `name` is the name from Google (refreshed at every sign-in; "" for an account made by email); `displayName` is the
   *  one the person chose (null = use `name`). */
  id: string; name: string; email: string; avatar: string | null;
  /** "My language" (an ISO 639-1 code such as "ur"), kept with the account; null until the person picks one. */
  lang?: string | null;
  // Profile (Track G, 2026-10). GET /api/me and PATCH /api/me return all of them; older clients ignore them.
  displayName?: string | null;
  /** First sign-in (ms). */
  memberSince?: number;
  /** Defaults for new designs (any field may be missing = the app's default). */
  prefs?: Prefs;
  /** Topic ids from data/topics.json (at most 10) that weight the Discover feed. */
  interests?: string[];
  /** ISO 3166-1 alpha-2 country, chosen by the person (optional). */
  country?: string | null;
  city?: string | null;
  /** WhatsApp / mobile number in E.164 (+<country code><number>), optional and not verified. */
  phone?: string | null;
  /** Explicit opt-in to a daily ayah on WhatsApp (coming later). Always false without a phone number. */
  phoneOptIn?: boolean;
  /** Designs saved to the account and share links created while signed in. */
  stats?: { creations: number; shares: number };
  /** The country this request comes from (Cloudflare), to suggest one when `country` is empty. Not stored. */
  requestCountry?: string | null;
}
export interface SignedIn extends Me { token?: string }
/** PUT /api/me/lang { lang } → Me. Saves "My language" to the account (the device keeps its own copy). */

/** Defaults for new designs. reciter: an everyayah folder the app offers; translation: an edition id or "none"
 *  (missing = the translation of My language). */
export interface Prefs {
  reciter?: string;
  translation?: string;
  orientation?: Recipe["orientation"];
  effect?: NonNullable<Recipe["effect"]>;
  animation?: NonNullable<Recipe["animation"]>;
  /** Translation voice on for new designs (where the translation's language has one). Default off. */
  voice?: boolean;
  /** Discover feed reels read the translation aloud after the recitation, with My language's voice. Default off. */
  feedVoice?: boolean;
  /** Who recites the reels (Reels' My preferred reciter): a reciter's folder (every reel), or "mix" (a different one
   *  now and then). Not set: not chosen yet (the mix; Reels asks once). */
  reelReciter?: string;
}

/** PATCH /api/me — every field optional; null (or "" for text) clears it. Validated strictly: displayName 1–60
 *  characters, prefs fields from their lists, interests ≤ 10 existing topic ids, country ISO alpha-2, city ≤ 80
 *  characters, phone E.164, phoneOptIn only with a phone number. 400 { error, field } on the first invalid field. → Me */
export interface ProfilePatch {
  displayName?: string | null;
  prefs?: Prefs | null;
  interests?: string[] | null;
  country?: string | null;
  city?: string | null;
  phone?: string | null;
  phoneOptIn?: boolean;
  lang?: string | null;
}

/** How a design was saved: exported as a video or an image, or shared as a link. */
export type CreationKind = "video" | "image" | "link";

/** Saved designs (Track G: saved automatically on every export and share link; the files themselves are not stored —
 *  "Download again" re-renders on the device from the recipe).
 *  GET /api/creations → Creation[] (newest first by updated_at)
 *  POST /api/creations { recipe, title?, kind, thumb?: "data:image/jpeg;base64,…" (≤ 60 KB), at?: ms }
 *       → 201 Creation, or 200 with the existing one when the same recipe is already saved (its time, thumbnail and
 *         kind are updated; a link never replaces video/image). At most 500 per account: the oldest make room.
 *  GET /api/creations/:id/thumb → the thumbnail (owner only)   DELETE /api/creations/:id → also removes the thumbnail
 *  GET /api/favourites, PUT/DELETE /api/favourites/:ref */
export interface Creation {
  id: string; recipe: Recipe; title: string; created_at: number;
  kind?: CreationKind;
  updated_at?: number;
  /** Thumbnail URL (same origin, needs the session), or null. */
  thumb?: string | null;
}

/** GET /api/trending?days=7..30 (default 30) → the most exported and shared ayahs (D1 counters, no personal data),
 *  edge-cached for about an hour. The Discover feed mixes them in. */
export interface TrendingResponse { days: number; refs: { ref: Ref; n: number }[] }

/** GET /api/stats/ayahs?refs=94:5,2:153 (up to 60) → anonymous counts per ayah, never with names: favourites (`likes`),
 *  shares (exports, share sheet, links copied), designs people made from someone's shared link (`makes`), and `week`,
 *  the number of shares in the last 7 days. Counts the server does not have yet are 0. Cached at the edge briefly. */
export interface AyahStats { ref: Ref; likes: number; shares: number; makes: number; week: number }
export interface AyahStatsResponse { stats: AyahStats[] }

/** GET /api/stats/me → the person's private impact over the last `days` days (signed in: their account; signed out:
 *  this device's anonymous id): opens of the links they shared, shares made from those opens, and designs people made
 *  from them. Only this person ever sees it. Added 2026-10-12 (Notifications): `links`, their links used most in those
 *  days (most opened first, at most 5, only links that were used), and `total`, the same counts over all days. */
export interface ImpactResponse {
  days: number; opens: number; reshares: number; makes: number;
  links?: LinkImpact[];
  total?: { opens: number; reshares: number; makes: number };
}
/** One share link over the impact's days: its first ayah (`to`: the last, for a range) and the clip its design shows
 *  (null: a plain colour). Never who opened it. */
export interface LinkImpact { code: string; ref: Ref; to?: number; clip: string | null; opens: number; reshares: number; makes: number }

/** Classes the Worker puts on tafsir HTML (the only `class` values that survive sanitising, on the server and again in
 *  the browser). They re-present what the source sent; no text is added, changed or reordered:
 *  rf-q     a quoted Arabic passage (ayah or hadith) given as its own paragraph, with the translation that follows it
 *  rf-ar    the Arabic paragraph inside rf-q (lang="ar" dir="rtl")
 *  rf-tr    the translation of a quote (in rf-q, or inline where the source marks one)
 *  rf-ref   a reference the source gives (e.g. "2:45", "[ البقرة : 45 ]")
 *  rf-aya   an ayah the source quotes inside a sentence (lang="ar")
 *  rf-fn    a footnote paragraph
 *  rf-mark  a footnote or ayah-number marker such as "[1]" or "(153)"
 *  rf-page  a page number of the printed edition */
export type TafsirClass = "rf-q" | "rf-ar" | "rf-tr" | "rf-ref" | "rf-aya" | "rf-fn" | "rf-mark" | "rf-page";

/** GET /api/tafsir/:ref?lang=<iso>&id=<tafsir id> → the tafsir for the ayah from the Quran Foundation API: `id` when it
 *  is one the app offers (GET /api/tafsirs, any language), else the requested language's first, else English's
 *  (`fallback`). Never machine-translated. `html` is sanitised (basic formatting only, headings h3/h4, classes from
 *  TafsirClass). One tafsir passage often covers several ayahs (`from`–`to`, within the ayah's surah). */
export interface TafsirResponse {
  ref: Ref;
  /** Language of the tafsir served (ISO code). */
  lang: string;
  /** True when the requested language has no tafsir (another language is shown). */
  fallback: boolean;
  tafsir: { id: TafsirId; name: string; author: string | null };
  from: Ref;
  to: Ref;
  html: string;
  /** The tafsirs in the requested language (English's when it has none), first = its default. */
  options: { id: TafsirId; name: string }[];
}

/** One tafsir the app offers, named as the Quran Foundation API names it; `lang` = its language (ISO code). */
export interface TafsirInfo { id: TafsirId; name: string; author: string | null; lang: string }
/** A tafsir's id: a Quran Foundation resource id (number), or one of our own, a non-numeric string "<lang>.<name>"
 *  (/^[a-z]{2,3}\.[a-z0-9]{1,30}$/; its `lang` is the part before the dot):
 *  - "ml.thafheem" = Thafheemul Quran (Malayalam, Sayyid Abul A'la Maududi), served from our own storage, text only, with
 *    its numbered notes: `html` = a header line with the ayahs the notes cover, the ayah's own summary when there is
 *    one, then every note of that block, each starting with its number in bold ("11."). Malayalam's default.
 *  - "en.tafheem" = Tafhim al-Qur'an (English, Maududi), live from the Quran Foundation (translation 95): `html` = the
 *    ayah's translation as <p class="rf-tr"> with its note numbers in <sup>, then each note as <p><strong>1.</strong> …</p>.
 *  - "<lang>.mukhtasar" (Al-Mukhtasar, Tafsir Center for Quranic Studies, 30 languages), "en.jalalayn", "<lang>.saadi",
 *    "tr.ibnkathir", "ru.ibnkathir": our copy of spa5k/tafsir_api in storage (pipeline/spa5k_tafsirs.py; the list in
 *    apps/api/src/lib/owntafsir-editions.ts): `html` = plain <p> paragraphs; `from`–`to` is the passage when one text covers
 *    several ayahs (Al-Sa'di), else the ayah; `html` is "" when the edition has nothing for the ayah.
 *  Our ids are listed, and served, without the Quran Foundation's credentials (except "en.tafheem"). */
export type TafsirId = number | string;
/** GET /api/tafsirs → every tafsir the app offers (those that return text), each language's in preference order (its
 *  default first). */
export interface TafsirListResponse { tafsirs: TafsirInfo[] }

/** GET /api/reflections/:ref?lang=<iso>&page=<n>[&kind=lessons] → QuranReflect posts about the ayah. Posts in the
 *  served language (`lang`) come first, then the others (as QuranReflect orders them); `total` counts every language.
 *  Bodies are plain text. `lang` is the requested language when it has posts, else English (`fallback`).
 *  kind=reflections (default): community reflections; page 1 merges QuranReflect's first popular pages with its
 *  moderator-reviewed ones, ranked verified authors first, then posts in `lang`, then reviewed, then likes; page n > 1
 *  is the next popular page.
 *  kind=lessons: QuranReflect lessons (mostly by verified teachers), verified authors first, then posts in `lang`,
 *  within each page. */
export interface ReflectionsResponse {
  ref: Ref;
  lang: string;
  /** True when the requested language has no posts here, so English is served. */
  fallback?: boolean;
  kind?: "reflections" | "lessons";
  total: number;
  page: number;
  pages: number;
  posts: ReflectionPost[];
}

export interface ReflectionPost {
  id: number;
  body: string;
  /** The author's QuranReflect username (kept for older apps; `by` has the rest). */
  author: string;
  likes: number;
  lang: string;
  date: string;
  url: string;
  by?: ReflectAuthor;
  kind?: "reflection" | "lesson";
  /** Reviewed or promoted by QuranReflect's moderators. */
  reviewed?: boolean;
}

/** `verified`: QuranReflect's verified tick (teachers and scholars). `avatar`: the photo through our own Worker
 *  (GET /api/avatar/qr/<path>, same origin), or null. */
export interface ReflectAuthor { name: string; username: string; verified: boolean; avatar: string | null }

/** Proxies (edge-cached, CORS enabled):
 *  GET /qapi/*                → https://api.alquran.cloud/v1/*   (cache 30 days)
 *  GET /audio/:folder/:file   → https://everyayah.com/data/:folder/:file (cache 1 year)
 *  GET /audio/voice/:id/:SSSAAA.mp3 → a translation voice's file (contracts/voices.ts sources only; cache 1 year)
 *  GET /media/*               → R2 bucket (immutable)            */

// ---------------------------------------------------------------------------
// Analytics events — POST /api/events { events: AppEvent[] } (batched, sendBeacon)
// Server adds: country, device, browser, colo. Written to Analytics Engine.
// No names, emails or IPs in events.
// ---------------------------------------------------------------------------
export type EventName =
  | "app_open" | "search" | "search_click" | "ayah_select"
  | "bg_select" | "customise" | "preview_play"
  | "export_start" | "export_done" | "export_failed"
  | "share_native" | "link_copy" | "share_open"
  | "sign_in" | "creation_save" | "report" | "error"
  // Discover feed and Reflect (owner-approved, 2026-10-08): a reel watched (ms = watch time), a reel skipped (left
  // within 2 s), the Reflect sheet opened (key = where: "feed" | "create" | "results" | "discover" | "profile").
  | "feed_view" | "feed_skip" | "reflect_open"
  // Today's ayah (owner, 12 Oct 2026; props.ref = the day's ayah): watched (Home's button, the reminder or Discover's
  // card), opened from the daily reminder, shared or saved from its reel; the daily reminder turned on or off on a
  // device. Counted by name per UTC day like the others (admin Daily ayah).
  | "today_seen" | "today_opened" | "today_shared" | "reminder_on" | "reminder_off";

/** GET /api/daily?from=YYYY-MM-DD&days=N (1–31): the days an admin chose the ayah for (the person's local date);
 *  every other day is the app's own pick (apps/web src/discover.ts loadAyahOfTheDay). */
export interface DailyPicks { picks: { day: string; ref: Ref }[] }

/** GET /api/announcements → news from AyahShare for everyone (owner, 12 Oct 2026: written on the admin's Announcements
 *  page; Notifications shows them, newest first): the last 5 from the last 60 days. `link`: an app path ("/discover") or
 *  an https address, or null. Cached for five minutes. */
export interface Announcement { id: number; title: string; body: string; link: string | null; at: number }
export interface AnnouncementsResponse { items: Announcement[] }

/** The daily reminder on the web (owner, 12 Oct 2026): Web Push, sent by the Worker at the person's time.
 *  POST /api/push with this body subscribes (or updates the time) → 204; DELETE /api/push { endpoint } stops → 204.
 *  `time` is "HH:MM" in `tz` (an IANA zone such as "Asia/Kolkata"). The public VAPID key is PublicConfig.vapidPublicKey. */
export interface PushSubscribeBody { endpoint: string; keys: { p256dh: string; auth: string }; time: string; tz: string }
/** A push message's payload (JSON): the service worker shows it and a tap opens `url` (/app?today=reminder). */
export interface PushMessage { title: string; body: string; url: string }

export interface AppEvent {
  name: EventName;
  ts: number;                 // ms since epoch (client clock)
  anon: string;               // anonymous device id (uuid in localStorage)
  session: string;            // per tab session id
  props?: {
    ref?: Ref;                // first ayah
    ayahs?: number;           // count in range
    clip?: string;            // clip id or "colour"
    reciter?: string;
    translation?: string;
    orientation?: string;
    source?: "suggested" | "library" | "colour" | "share";
    key?: string;             // customise: which setting; feed_view / feed_skip: the feed mood or "you"; reflect_open: "feed" | "create"
    kind?: "video" | "image";
    ms?: number;              // export duration; feed_view / feed_skip: watch time
    bytes?: number;           // export size
    reason?: string;          // export_failed / error message (truncated 200)
    q?: string;               // search query (truncated 100)
  };
}

// ---------------------------------------------------------------------------
// Counts and impact, as implemented (apps/api/src/routes/stats.ts, migration 0007). Only counts; never who.
//   AyahStats.likes  = accounts with the ayah as a favourite (device-only favourites are not known to the server).
//   AyahStats.shares = exports + share links created. A link counts once however it is sent (share sheet or copied); a
//                      file sent through the share sheet counts once, as its export.
//   AyahStats.makes  = changed designs exported or linked by people who opened a shared link of the ayah.
//   AyahStats.week   = shares in the last 7 UTC days (today included).
//   ImpactResponse   = the last 7 UTC days over the person's own links: signed in, the account's links and those made
//                      on its devices before sign-in; signed out, the links of the device id sent as the `X-Anon` header
//                      (GET /api/stats/me, 400 with neither). opens = opened in the app; reshares = the same design
//                      exported or linked again by someone who opened it; makes = a changed design (ShareReuse below).
// POST /api/shares also takes `anon` (the anonymous device id), kept with links made signed out.
// ---------------------------------------------------------------------------

/** POST /api/shares/:code/reuse — someone who opened this share link exported or linked its design: unchanged
 *  ("share") or changed ("make"). → 204; 404 for an unknown code. Counted per link and day, without who. */
export interface ShareReuse { kind: "share" | "make" }
