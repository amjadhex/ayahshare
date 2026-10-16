# apps/web — the AyahShare editor (PWA)

Live at **https://ayahshare.com** (also www.ayahshare.com; the test address
https://quran-design.rapid-sun-0190.workers.dev serves the same build). The Worker is still named `quran-design`, and
storage keys (`qd.*`, the `__Host-qd_session` cookie), event names and resource names keep their old names on purpose:
renaming them would lose people's data.

React 19 + Vite + TypeScript (strict), a client-side app served as static assets (no Next.js). One codebase for the web
and the iOS / Android apps (Capacitor, `apps/mobile`: this build is bundled into them). Video and image are made on the
user's device.

Only `src/ui/` (and the entry `src/main.tsx`) use React. Everything else — the canvas renderer, the export engine and
its worker, the API client, analytics, the platform adapter, the state store, the router and the app logic — is plain
TypeScript, so the native app can plug in its own pieces (`src/frameworkFree.test.ts` checks this).

## Commands

```sh
npm install
npm run dev      # Vite dev server; API calls are proxied (see below)
npm run build    # strict type check, then build to dist/
npm test         # unit and component tests (vitest + Testing Library, jsdom)
sh scripts/icons.sh   # regenerate PNG icons from public/icons/*.svg (headless Chrome)
```

`npm run dev` proxies `/api`, `/qapi`, `/audio`, `/media`, `/s/` and `/admin/api` to the test address
`https://quran-design.rapid-sun-0190.workers.dev` by default. Point it elsewhere with `API_TARGET`, e.g.
`API_TARGET=http://localhost:8787 npm run dev` for `wrangler dev` in `apps/api`. `/data/*` is served from
`public/data/` (written by the pipeline; this app never writes there).

## Build output and the admin app

The admin app (`apps/admin`) builds into `dist/admin/`. The web build empties `dist/` before writing (like Vite's
`emptyOutDir`) **but keeps `dist/admin/`** (`emptyOutDirKeepAdmin` in `vite.config.ts`; Vite's own `emptyOutDir` is off).
So the web app can be rebuilt on its own without deleting the admin build. The normal order is still:

1. `npm --prefix apps/web run build` (empties `dist/` except `dist/admin/`, writes the app, `sw.js`, icons, `data/`)
2. `npm --prefix apps/admin run build` (writes `dist/admin/`; it must empty only `dist/admin/`, never `dist/`)
3. `wrangler deploy` from `apps/api` (serves `apps/web/dist` as static assets)

The service worker never handles `/admin/*`, `/api/*`, `/audio/*` or `/s/*`.

## Legal pages

`public/privacy.html` and `public/terms.html` are served as static pages at **/privacy** and **/terms** (Workers static
assets serve `privacy.html` for `/privacy`; `npm run dev` only knows `/privacy.html`). **Their source of truth is
`legal/` at the repo root**: edit there, then copy both files here (`cp legal/*.html apps/web/public/`);
`src/legal.test.ts` fails while a copy differs. The Profile page (sign-in card and Account card) and a small footer on
tablet and desktop link them (`LegalLinks` in `ui/Account.tsx`; in the apps they open from the deployed site).

## Name, domain and links

- The name lives in `src/strings.ts` (`appName`) and, for the running app, in `/api/config` → `appName`
  (`APP_NAME` in `apps/api/wrangler.jsonc`), which sets the page title, the share sheet title and the branding line.
- `index.html` carries the site's own Open Graph / Twitter tags and canonical link (https://ayahshare.com/); a share
  link's page `/s/:code` replaces them with the design's (apps/api `routes/shares.ts`).
- Share links come from the API: `https://ayahshare.com/s/<code>` when the request came to ayahshare.com or www, the
  request's own host otherwise (the test address keeps working).

## Layout

Screens: phones (< 760 px) get an app shell — app bar (brand / back / account, Export on Create), one screen at a time
(Find · Feed · Create · Saved · Profile), the bottom navigation (Find · Feed · Create · Saved) or, on Create, the tool bar
(Ayahs · Background · Text · Style) that opens bottom sheets, and an Export sheet. Tablets (760–1179 px) show two columns,
desktops (≥ 1180 px) the three-column layout (Find · preview · Customise); their top bar switches between Create and
the Feed (a centred column of portrait reels). Screens and sheets are history entries: the back button closes a sheet
first, then returns Create → Find. `/s/:code` and `?r=<code>` open Create, `/feed` the feed. The app opens on Find.

## Saved and Profile (Track G)

- **Saved is automatic** (`autoSave` in `src/actions.ts`, called from `ui/exportJob.tsx`): every finished video or
  image export and every share link saves the design — no Save button. Signed in it goes to the account
  (`POST /api/creations` with `kind` video|image|link and a thumbnail); signed out, or when the account cannot be
  reached, to this device (`src/history.ts`: IndexedDB, the newest 50, memory fallback where IndexedDB is blocked).
  The same recipe is updated instead of copied (a link never replaces a video/image kind). An image is saved as the
  design of the ayah it shows, so "Download again" makes the same picture.
- **Thumbnails** (`thumbnail()` in `src/export/index.ts`): the clip's poster plus the text layer, 360 px wide, JPEG
  ≤ 60 KB. Account thumbnails are private (`GET /api/creations/:id/thumb`, needs the session; the app fetches them with
  its Bearer token).
- **Exported files are never uploaded.** "Download again" re-renders on the device from the saved recipe
  (`sceneFromRecipe` + the normal export).
- **Saved screen** (`ui/Saved.tsx`): thumbnail grid, newest first, badges (Video · Image · Link), filters All ·
  Videos · Images · Favourite ayahs, actions Open in Create · Download again · Share link · Delete with an Undo
  snackbar (the delete is sent after 5 s, or at once when leaving Saved). Signed out: a sign-in invitation. Signed in
  with designs still on the device: "Move to my account" (oldest first, keeping their times).
- **Profile** (`ui/screens/ProfileScreen.tsx`; phones: the Profile screen; larger screens the same, in the column): a top bar with the
  small streak pill (a tap opens the streak's details, `ui/Streak.tsx`), the header (picture, name, three numbers) and two
  buttons that lead to the two places below, then the creations grid and the saved ayahs. Signed out (where sign-in is
  offered) only the sign-up card shows.
- **Preferences** (a sheet on Profile, `PreferencesPanel` in `ui/Profile.tsx`, styles `ui/prefs.css`): *Language and
  translation* (My language, the default translation in the two-step picker, the translation voice), *Recitation* (default
  reciter), *Design defaults* (orientation, text effect, animation; wrapping chips) and *Interests* (up to 10 topics from
  `data/topics.json`: the chosen ones and a few suggestions, "Show all" opens every topic, searchable, in a sheet). The defaults
  of new designs are `src/prefs.ts`; interests weigh the Discover feed (`interests` in `createMixer`). Signed out the device
  keeps them (`qd.prefs`, `qd.interests`); after sign-in the account's apply, and an account without them receives the device's.
- **Settings** (a page, `ui/screens/Settings.tsx`, `settings.css`): *Account* (sign-in card, or the header with the editable
  display name, email, member since; Location and WhatsApp: country, city, E.164 number with an explicit opt-in, Remove number;
  Sign out; Delete account, type DELETE), *The app* (Install, Help and support, Report a problem) and *About & legal* (Privacy
  policy, Terms, the credits). Nothing in it is wider than the screen.
- **The app's own dropdown** (`ui/PickerRow.tsx`, `dropdown.css`): a row with the label over the current value and a chevron;
  a tap opens a bottom sheet (a centred dialog from 760 px) with radio rows, the current one marked, a search when the list has
  more than 12 rows. A modal `<dialog>` (focus trapped, Escape closes it) and a history entry stacked over the sheet under it
  (`openSheet(id, true)`), so Back closes only it. There is no native `<select>` left in the app (default reciter, country).
- **Two-step pickers** (`ui/GroupedPicker.tsx`, one component for translations and tafsirs): first the language (My language
  first, then the others by name, a search over names and translators, each row with its native and English name and how many
  items it has), then that language's items with short names, the full name under them and badges (Default, Voice); step 2 opens
  on the current choice's language with "‹ Languages" to go back; a language with one item is picked by picking the language.
  Used by `TranslationPicker` (the editor's Language tool, Preferences, `ui/TranslationPicker.tsx`) and Reflect's tafsir chooser.
- **The streak** (`ui/Streak.tsx`, `streak.css`): a 28 px pill (flame and days; a 44 px touch area) on Home's and Profile's top
  bars; its sheet shows the ring towards the next milestone, where it stands, Current / Best / This week, the last 16 weeks and
  today's ayah when today is not done. "Your ayahs this week" was removed from Profile.
- **Focus** (`ui/focus.ts`, the rule at the top of `styles.css`): a dialog that opens takes focus itself (no ring, never one of
  its buttons); a ring shows only for the keyboard (`:focus-visible`), inside the element where a parent could clip it; a script
  moves focus after a change only when the last input was a key (`focusForKeyboard`).

## Discover feed, Reflect and My language (Track F)

- **Feed** (`ui/Feed.tsx`, `src/feed.ts`, `src/reels.ts`, `src/signals.ts`): full-height reels that swipe vertically
  (CSS scroll snap; on a computer the arrow keys, Page Up/Down, j/k, the wheel — one reel per turn — and the up/down
  buttons). Each reel is the live design, like the Create preview: the clip, the canvas text layer (`draw.ts` +
  `compose.ts`, the same timeline as the export) and the recitation; nothing is encoded to watch. The reel on screen
  plays muted until the first tap (browsers allow sound only after a tap), later taps pause and resume; one shared
  `<audio>` element plays the recitation (phones let a page play sound on an element it already unlocked). The next
  three reels are prepared in memory (text, layers drawn for the reel's size, the clip and recitation downloaded as
  object URLs, the poster): measured in headless Chrome, a prepared reel plays 10–40 ms after it comes on screen, a cold
  one 0.5–2 s. Reels more than two back or four ahead are released (object URLs revoked); only five keep media mounted.
- **The mix** (`createMixer`, no AI at view time): the day (time of day; Friday → Surah Al-Kahf first; Ramadan and its
  last ten nights, Hajj days, Arafah, the Eids, Muharram, the new Hijri year), the person's own signals kept on the
  device (what their searches found, mood chips picked, favourites, reels watched to the end, reels skipped within 2 s),
  the mood chips on top (14 moods, labelled in My language) and popular ayahs (`GET /api/trending`, most exported and
  shared over 30 days), plus discovery from uplifting topics in `data/topics.json`. No ayah twice in a visit, nor one
  shown on this device in the last three days; consecutive reels get a different text effect / entry-exit animation
  (rise, fade, zoom, none), and every reel has Auto contrast. Each reel uses its ayah's precomputed backgrounds
  (`data/bg`), avoiding the last six clips; an ayah flagged sensitive only gets a clip whose tags are calm (nothing
  stormy, dark or violent) or a plain dark colour. A reel's text sits in the middle band (`textY` 0.5), clear of the
  reel's buttons and title, so Auto contrast never moves it into them.
- **Reel actions**: favourite (kept on the device signed out, with the account signed in), Reflect, Share (the export
  engine makes the reel's MP4, then the Export sheet's Share / Save / Copy link; the share button shows the progress),
  Edit this (opens Create with the reel's design), sound. Events: `feed_view` (ms = watch time, key = mood or "you"),
  `feed_skip`, `reflect_open` (key = feed | create), plus the usual export and share events.
- **Reflect** (`ui/Reflect.tsx`, on every reel and under the Create preview): a sheet with Tafsir (`GET /api/tafsir`:
  the tafsir in My language where the source has one — Arabic, Bengali, English, Kurdish, Russian, Swahili, Urdu —
  else English, labelled so; never translated; a picker when the language has several; sanitised again in the browser by
  `src/sanitize.ts`) and Reflections (`GET /api/reflections`: QuranReflect posts, the person's language first, with the
  author's username, likes, Show more, "Read on QuranReflect" and Report; Load more pages through them).
- **My language** (`src/lang.ts`, `ui/Language.tsx`): asked once on first open (skippable; it suggests the device's
  language), then, for a language with several translations, a second question in the same dialog: which one to read by
  default (its recommended translation first, a Voice badge where a recorded voice reads it, Decide later), stored as the
  default-translation preference. Changeable on Find (next to Results), on the feed, in the top bar and in Preferences. It sets the
  translation of new designs and feed reels (Arabic → no translation), the chip and mood language, the tafsir language
  and the reflections language. Kept in `localStorage` (`qd.lang`) and, signed in, with the account (`PUT /api/me/lang`;
  a device that never picked one takes the account's). The dialog has a search over the languages' own and English
  names (any script, case and accents ignored).
- **Translations** (`public/data/translations.json`, built by `pipeline/translations.py`; `src/translations.ts`): 200 in
  80 languages, the Quran API's (alquran.cloud) and the Quran Foundation's that are not among them (ids
  `<lang>.qf-<id>`, served by the Worker at `/qapi/surah/:n/<lang>.qf-<id>` in the Quran API's shape), plus our own
  (`ml.lalithasaram`). One picker (`ui/TranslationPicker.tsx`, two steps) in the editor's Language tool and for the default
  translation in Preferences. Names in the UI are short (`shortTranslationName` in `src/translations.ts`: "Abdul Hameed &
  Parappoor"; the full name is secondary text). The same translation listed twice is shown once (`dedupeEditions`, applied in
  `getEditions`: same language and English name keeps the one a recorded voice reads, else the non-`qf` id; `ml.karakunnu` is
  `ml.lalithasaram`); hidden ids still load, so old designs and links work, and show their twin's name (`editionOf`).

## Designs (owner feedback, 2026-10-08)

- **Topic chips** (`src/topics.ts`): a pool of ~68 feelings, situations and themes. Each visit shows 8: the moment's own
  chips first (morning / evening / before sleep by local time, Surah Al-Kahf on Friday and Thursday evening, Ramadan,
  the last ten nights, Eid, Hajj and Arafah, Muharram, read from `Intl.DateTimeFormat`'s Islamic (Umm al-Qura)
  calendar), then a weighted random mix. A refresh button re-picks them; one chip is swapped every 9 s while Find is on
  screen and not hovered or focused (never with reduced motion). Labels follow the selected translation's language
  (Malayalam, Arabic, Urdu, Hindi, Indonesian; English otherwise); the search itself uses the English query, so
  popular searches stay cached. A chip can also open a reference (Friday → 18:10).
- **Result cards** (`ui/Find.tsx` `ResultCard`, `src/results.ts`): the ayah in Arabic (RTL, Amiri Quran) first, then
  the selected translation (else the English the search returned) and the reference. The Arabic and translation come
  from the surah's cached `/qapi` file (at most 3 loading at once, one retry), the same file the editor then uses.
  Each card shows its own background: its ayah's best suggestion (`data/bg/{surah}.json`, else a library search for the
  query) not already used by a card above it; picking the card opens the design with that background and that ayah's
  suggestion list. Saved favourites use the same cards.
- **Up to 3 ayahs, one after another** (`MAX_AYAHS` in `src/config.ts`; contracts `to ≤ from + 2`): the ayahs take
  turns in the same text block. In the video each ayah is on screen for its whole recitation (the recitations play back
  to back): its text enters as its recitation starts and leaves as it ends, then the next one enters (see Video text
  animation). The last ayah stays through the 1.5 s tail and leaves at the very end. The block is sized for the longest of the ayahs
  (one text size for all of them) and each ayah is centred in it, so the block never jumps. The background clip is the
  same for the whole video, looped as needed. The preview plays the same sequence; paused, it shows the ayah chosen with
  the arrows / a swipe, and an image export is that ayah (named `ayah-<surah>-<ayah>.jpg`). Link previews show the first.
- **Text effect** (`effect`): Glass (the background behind the box is blurred: CSS `backdrop-filter` in the preview,
  the same area blurred on every frame in the export with `ctx.filter`, or a downscale blur where the canvas has no
  filter), Solid box, Shadow, Outline, None. The box colour and opacity colour the glass tint / box / shadow / outline;
  the border applies to every effect.
- **Show** toggles: surah name header, translation, ayah number and reference.
- **Branding**: "Created with AyahShare" (the app name from `/api/config`) on a soft pill at the bottom of the
  preview and of every image and video. It is the only part of the design with a fixed place. It is drawn in one
  place, `drawBranding()` in `src/draw.ts`, for the Create preview, exports, Feed reels and the videos shared from
  them, link previews and saved-design thumbnails; the owner's logo will go there.
- **Video text animation** (`animation`, owner decision 8 Oct 2026): entry/exit animations None (a cut) · Fade · Rise
  (fades in rising 2.4 % of the frame, leaves drifting up) · Zoom (a soft scale, 94 % → 100 % → 103 %). Each ayah's
  whole text block (Arabic, translation and reference together) enters over 0.42 s from the moment its recitation
  starts and leaves over the last 0.36 s of it (eased); the surah header, the box and the branding stay put. The text's
  clock is the recitation itself: the preview and the Feed read the playing `<audio>` element's time. In the preview
  two audio elements take turns: while one plays an ayah, the other holds the next one (downloaded into memory) loaded
  and paused at its start, so the next recitation starts the moment one ends (both are started by the person's tap,
  as phones require; if one may not play on its own, the other switches its source instead). Measured in headless
  Chrome: 12–49 ms between recitations (one element switching its source: 57–265 ms), and the next ayah's text waits
  for its voice; the export places each ayah from the decoded recitation's
  length, and the worker starts the audio timestamps before zero by the AAC encoder's delay (2112 samples for the
  browser's encoder, 1024 for the bundled one) so the file's edit list skips it and each recitation starts on the frame
  its text enters. People who reduce motion see Rise and Zoom as a fade (on screen only; the file keeps the design's
  animation). Images always show the full text. The removed Typewriter (it revealed words on a letter-count estimate
  that drifted from the recitation) is read as Fade from older links, saved designs, device history and preferences
  (`parseAnimation` in `src/config.ts`; the API does the same). The text is drawn once per paragraph and never cut up;
  a frame only places, fades and scales whole layers, so animations cost almost nothing per frame.
- **Translation voice** (`voice`, default `"none"`; a switch in Recite, shown when the translation's language has a
  recorded voice; `src/voice.ts`, the voice table in `contracts/voices.ts`): after each ayah's recitation a recorded
  human voice reads its translation, then the next ayah (up to 3). Turning it on switches the design to the edition the
  voice reads (a short line says so), and changing the translation to another one turns it off, so what is heard is
  what is read. The ayah's text stays on screen through its recitation and its voice, then leaves; a long ayah's parts
  come again while the voice reads. The preview, the Feed and the export all play `audioTracks()` in order (the
  export's video is as long as all of them plus the tail; images are unchanged). Files come through the Worker at
  `/audio/voice/<id>/<SSSAAA>.mp3` (only the table's sources), except Malayalam (Quran Lalithasaram, read by Noushad
  Ibrahim), which is in our media bucket (`/media/voice/ml.lalithasaram/…`, text at
  `/media/translations/ml.lalithasaram/<n>.json`, offered as the translation `ml.lalithasaram`). There, 21 pairs of
  ayahs share one sentence and one recording: it is read once, after the pair's second ayah when both are in the
  design. Profile → Preferences has "Translation voice in new designs" and "Translation voice in Feed" (My language's
  voice), both off by default.
- **Auto contrast** (`autoContrast`, default on; a switch in Style; `src/backdrop.ts` + `src/contrast.ts`): the
  device measures what is behind the text block and the surah header and picks the least visible fix that reaches
  WCAG contrast (4.5:1 for the translation and the surah line, 3:1 for the Arabic alone): nothing; a soft glow around
  the letters (a blurred stroke, its opacity solved from the calibrated effect: 34 % darker right around the letters at
  full strength); a Glass / Solid box with more opacity (the glass sheen counted), never more than needed; a feathered
  scrim behind the block only, opacity solved exactly; or, on very bright plain backgrounds (white sky, snow, light
  patterns), dark text with a light glow instead of darkening the picture. Busy textures (spread / edges of the luma)
  push one step stronger. The measurement: the clip file the design uses, 8 frames at fixed times ((k + ½)/8 of its
  length), each drawn into a 64-cell grid (each cell the mean of 4×4 pixels) as relative luminance; the 95th
  percentile (light text) or 5th (dark text) of the cells behind the area over all frames, the area rounded to 1 % of
  the frame so the preview, the Feed and the exports read the same cells. Opacities are solved for 10 % above the
  target. A colour background is one flat frame. One decision per design (no flicker); the measurement is cached per
  clip file and never stored: only the switch is in the recipe (missing in older links = on). When the text block has
  not been moved by the person, it may move to the upper or lower third when that clearly needs less (a whole level).
  With the switch off, the design's own colours and effect are drawn exactly as chosen. The clip is downloaded whole
  once (`clipBlob`, the last 4 kept): the preview plays that copy (its poster shows meanwhile), the measurement reads it
  and the export encodes it; a slow download shows the poster's measurement after 1.5 s, replaced by the clip's. Each
  decision is also left as a `qd-contrast` performance mark (for checks).
- **Movable text block and surah header** (`textX`, `textY`, `textWidth`; `headerX`, `headerY`, default 0.5 / 0.11):
  drag either on the preview (pointer events, touch and mouse; `touch-action: none` on them only, so a drag never
  scrolls or fights a sheet), with snapping guides at the centre and the thirds; the block's side handle changes its
  width (30–100 %); arrow keys move the focused one (Shift: 5 %). Both may go anywhere inside the frame above the
  branding line. Reset text / Reset surah name in the Text panel, and one reset for both under the preview. Positions
  are fractions of the frame, so they carry across orientations and share links; the export uses exactly the same
  layout code. The text size is budgeted from the header's usual place, so moving the header never resizes the text.

Older share links and saved designs (no newer fields, ranges up to 50 ayahs) open with the defaults and at most 3 ayahs
(`sanitizeRecipe` in `src/config.ts`; the API clamps them too).

| File | What it does |
|---|---|
| `src/main.tsx` | Entry: store, router, service worker, platform adapter, `startApp`, then renders `ui/App`. |
| `src/state.ts` | App state: pure reducer + tiny store. `recipe` (contracts `Recipe`) is the single source of truth for a design. |
| `src/app.ts` | Start-up (config, shared design, surahs, translations, account) and what follows the design: ayah text and background suggestions. |
| `src/actions.ts` | Everything a person can do (select ayahs, customise, backgrounds, reports, sign-in, favourites, saved designs, profile, preferences, interests) with its analytics event. |
| `src/history.ts` | Saved designs kept on the device while signed out (IndexedDB, newest 50). |
| `src/prefs.ts` | Preferences (defaults for new designs), interests, phone-number normalising (E.164), the country list. |
| `src/router.ts` | Minimal History-API router (screens and sheets). |
| `src/strings.ts` | Every user-facing string (i18n-ready). |
| `src/config.ts` | Sizes, fonts, reciters (everyayah folders), palettes, default recipe, recipe sanitising (≤ 3 ayahs; newer recipe fields kept). |
| `src/design.ts` | Small recipe helpers (titles, file names, analytics props, range clamping, translation language). |
| `src/api.ts` | Every network call (data files, API, `/qapi` Quran text as whole surahs per edition, share links, account) and the clip catalogue. |
| `src/draw.ts` | Lays out and draws the text layers (branding line, movable surah header, box and Auto contrast's scrim, one layer per ayah's Arabic and translation, the glow) with the browser's text engine. The same code serves the preview and every export (WYSIWYG). |
| `src/compose.ts` | Places the layers on a frame for time t: which ayah is on screen (`ayahWindow`), its entry and exit (none, fade, rise, zoom), glass blur, dragging (`shiftPlan`, `shiftHeader`, `clampCentre`). DOM-free: used by the preview, the Feed, the image export, the export worker and the recorder fallback. |
| `src/contrast.ts` | Auto contrast: WCAG luminance maths, what lies behind an area, and the least visible fix (none, glow, box opacity, scrim, dark text). Pure; tested on its own. |
| `src/backdrop.ts` | Auto contrast's measurement on the device (8 clip frames, a colour), cached per clip file; the shared whole-clip download (`clipBlob`). |
| `src/topics.ts` | Topic chips: the pool, moments (time of day, Friday, Islamic calendar) and the weighted pick. Chips speak My language. |
| `src/feed.ts` | The Discover feed's mix (day, moods, signals, popular, discovery; no repeats) and each reel's background and look. |
| `src/reels.ts` | Prepares feed reels ahead (text, layers, clip and recitation in memory) and releases the far ones. |
| `src/signals.ts` | What the feed learns, on the device only: searches' ayahs, moods, watch time, skips, last shown. |
| `src/lang.ts` | My language: the languages, their default translations, stored choice and the device's guess. |
| `src/sanitize.ts` | Tafsir HTML cleaned in the browser (basic formatting, `lang`/`dir` only). |
| `src/results.ts` | What a result card needs: Arabic + translation, and one different background per card. |
| `src/search.ts` | Progressive topic search (quick and refined requests sent together; the refined order replaces the quick one) and references (`2:255`, `94:5-6`). When the server could not search (503, e.g. a slow first query) it tries once more, then Find offers "Try again" instead of "Nothing found". |
| `src/backgrounds.ts` | Suggestions from `data/bg/{surah}.json` (falls back to the library) and library search. |
| `src/export/` | On-device export engine, loaded only on the first export or link. `worker.ts` encodes MP4 (H.264 + AAC) with Mediabunny in a Web Worker; the WASM AAC encoder loads only when the browser has no AAC encoder (Safari). `recorder.ts` is the real-time fallback (MediaRecorder). No encoder at all → image only. |
| `src/share.ts` | Share links (`POST /api/shares`), reading `/s/:code` or `?r=<code>`, and the code in a link that opened the app (`qurandesign://s/<code>`, `https://<site>/s/<code>`). |
| `src/endpoint.ts` | Where requests go: relative paths and the session cookie on the web; in the app, the Worker's paths (`/api`, `/qapi`, `/audio`, `/media`, `/s`, `/data/clips.json`, `/data/bg/*`) go to the deployed Worker with the session as a Bearer header, everything else loads from the app. |
| `src/platform.ts` | Platform adapter (share sheet, saving files, clipboard, haptics, Google sign-in, session, launch/deep links, launch screen) and its web implementation. |
| `src/platform-native.ts` | The iOS / Android implementation on Capacitor plugins (share via the cache folder, save to Photos / Gallery, haptics, status bar, splash, Android back button, deep links, native Google sign-in, session token in app storage). Loaded only inside the app; see `apps/mobile/README.md` for its build-time settings (`VITE_APP_API_BASE`, `VITE_GOOGLE_IOS_CLIENT_ID`, `VITE_GOOGLE_ANDROID_CLIENT_ID`). |
| `src/analytics.ts` | Batched events (contracts `AppEvent`, sent every 30 s or 20 events), `sendBeacon` on page hide. New device id after sign-out or account deletion. Never blocks the UI. |
| `src/pwa.ts`, `src/sw.ts` | Install prompt and service worker (built to `/sw.js`; the build injects the app-shell list). Not registered inside the iOS / Android app. |
| `src/ui/` | React components: `App` (layouts), `Bars` (app bar, bottom navigation, tool bar, top bar), `Find`, `Stage` (preview, tap to play, swipe between ayahs), `Sheet` (bottom sheet on a modal `<dialog>`: scrim, focus trap, Escape, swipe down), `panels` (Ayahs · Background · Text · Style and the desktop tabs), `ExportPanel` + `exportJob` (the export in progress survives closing the sheet), `Account` (sign-in button, Profile button, account menu), `Saved` (saved designs and favourite ayahs), `Profile` (profile page), `Dialogs` (report, Saved and Profile on desktop, toast), `Feed` (reels), `Reflect` (tafsir and reflections sheet), `Language` (My language picker and button). |

## Export pipeline

1. Page measures the background for Auto contrast (the clip file it then encodes, usually already in memory) and draws
   the text layers at the export size (720p, or 1080p with HD) as transparent PNGs: the branding line, the surah
   header, the box (with the scrim, if any), and one layer per paragraph, plus the plan (where each goes). The
   recitations load meanwhile.
2. Page downloads and decodes each ayah's recitation (`/audio/<folder>/<SSSAAA>.mp3`), and its translation voice when
   the design has one, to mono PCM, back to back in playing order, plus 1.5 s of silence,
   and downloads the clip rendition for the orientation (`clips/p/…` or `clips/l/…`; square = centre crop of portrait).
3. Worker loops the clip to the audio length, cover-crops it, blurs the area behind the box (glass), places the text
   layers for that frame's time with `compose.ts` (each ayah's start and length come from the decoded recitation) and
   encodes 30 fps H.264 (1.4 Mbps, so WhatsApp status keeps the file as it is) + AAC (96 kbps mono) into a fast-start MP4. The text is
   drawn once; a frame only places, fades and scales layers, so the animation costs almost nothing. Audio timestamps
   start before zero by the AAC encoder's delay, so the edit list skips it: measured with ffmpeg, each recitation starts
   in the file's audio exactly at its planned time (0 ms), and its text starts entering on the next frame.
4. Phones get Share (Web Share API with the file, when the browser can share it; a fresh tap is needed after a long
   export), Save to device and Copy link in the Export sheet; larger screens download the file at once. The apps get
   the system share sheet and Save to Photos (iOS) / Save to Gallery (Android).
5. The console notes which encoder ran (`[export] encoded in the worker (H.264, native|bundled AAC)` or the real-time
   fallback); in the apps' debug builds this reaches the native log.

## Contract notes

- `GET /api/favourites` and `GET /api/creations` are read either as a bare array or as `{ favourites: [...] }` /
  `{ creations: [...] }`; favourites may be refs or `{ ref }` objects.
- Search reports send `note: "\"<query>\" — <user note>"` because `ReportBody` has no query field.
- `POST /api/reports` and `POST /api/auth/google` also send `anon` (the analytics device id) so the server can link
  the report / sign-in to the device. Not in `contracts/types.ts` yet; the API accepts it as optional.
- In the apps, `POST /api/auth/google` answers with `token` as well (contracts `SignedIn`); the app keeps it and sends
  `Authorization: Bearer <token>`. Analytics beacons from the app are `text/plain` (a cross-origin JSON beacon is refused).

## Testing it

`wrangler dev --remote` in `apps/api` serves the built app plus the real API, R2 media and indexes on
`http://localhost:8787` (rebuild the web app and it picks up the new files). Things checked there in headless Chrome:
search → select → preview → image and video export (portrait, square, landscape, HD), cancel, the real-time
(MediaRecorder) fallback, the image-only message, the WASM AAC path (Safari's), share links (`/?r=` and `/s/`),
sign-in flows with a mocked API, offline start from the service worker, and 375 px / 1440 px layouts.
Writes (`/api/events`, shares, reports) answer 403 "bad origin" under `--remote`, because the Worker sees its preview
hostname rather than `localhost`; they work on the deployed URL.

In `npm run dev` (never in the production build) the store is on `window.__qdStore`, so automated checks can read
and set the design.

The production build can also be checked with `vite preview` (it uses the same proxy as `npm run dev`):
`npm run build && npm run preview` — reads work against the deployed API; writes answer 403 there for the same reason.
