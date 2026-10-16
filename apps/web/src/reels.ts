// Getting Discover feed reels ready before they are on screen: the ayah's Arabic and translation, the background clip
// downloaded into memory and measured for Auto contrast (backdrop.ts), the text layers drawn for the reel's size (same
// drawing code as the editor and the export), the recitation (and the translation voice, when the reel has one) and the
// poster. preloadPlan says which reels around the one on screen get what: the reel on screen and the next two in full,
// the third ahead lightly (text and poster), one with data saver; the rest are released (their memory too), so
// scrolling for a long time never piles up clips. Downloads go one reel at a time until the reel on screen has
// everything, then two at a time, nearest first; a reel skipped past stops downloading (what it has stays).
// Framework-free.
import type { Clip, Prefs, Recipe, Surah } from "../../../contracts/types";
import * as api from "./api";
import { backdropFor, posterBackdrop, type Backdrop } from "./backdrop";
import { stripBasmala, translationLang, type Edition, type LoadedAyah } from "./design";
import { drawLayers, fontsReady, type Layers, type Scene } from "./draw";
import { onDevice } from "./endpoint";
import { createMixer, fixedReciter, groupItem, pickBackground, pickReciter, reelDesign, type FeedItem } from "./feed";
import { translationFor } from "./lang";
import { loadSignals } from "./signals";
import { audioTracks, voiceFor, type Voice } from "./voice";
import { sizedReel } from "./reelText";

/** The file a reel plays its clip from, and its poster: the one place that chooses them (Reels, Discover stories and
 *  the downloads into memory all ask here). */
export const reelClipUrl = (clip: Clip) => api.clipUrl(clip, "video", "portrait");
export const reelPosterUrl = (clip: Clip) => api.clipUrl(clip, "poster", "portrait");
/** The clip's 1080p portrait file, when it has one (the reel on screen switches to it: see upgradeVideo). */
export const reelHdUrl = (clip: Clip): string | null => (clip.hd?.portrait ? api.mediaUrl(clip.hd.portrait) : null);

/** One reel: the ayah the mix chose and its whole design. */
export interface Reel { item: FeedItem; recipe: Recipe }

/** What the reels built so far used, so the next ones vary (shared by one list of reels). */
export interface ReelMix { recentClips: string[]; recentReciters: string[]; built: number }
export const newReelMix = (): ReelMix => ({ recentClips: [], recentReciters: [], built: 0 });

/** The reels' designs for these items: each ayah's precomputed background (or `given`, the one a thumbnail showed, by
 *  reel key), a reciter in rotation, and the preferences (translation, the Feed's translation voice). Offline (the app),
 *  a reel whose recitation is not on the device is left out, and one whose clip is not gets a plain background instead
 *  of a spinner that never ends. */
/** `reciter`: every reel recited by this one (a whole surah, surah.ts) instead of the mix's rotation. */
export async function buildReels(items: FeedItem[], mix: ReelMix, prefs: Prefs, lang: string, given?: Map<string, Recipe["bg"]>, reciter?: string): Promise<Reel[]> {
  await Promise.all([api.loadCatalogue(), api.loadAyahGroups()]);
  const list = await Promise.all(items.map(groupItem).map(async (item) => {
    const file = await api.getSurahBackgrounds(item.surah);
    const clips = (file?.ayahs[String(item.ayah)] ?? []).map((id) => api.clipById(id)).filter((c) => !!c);
    return { item, clips, sensitive: !!file?.sensitive.includes(item.ayah) };
  }));
  return list.flatMap(({ item, clips, sensitive }) => {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    let bg = given?.get(item.key) ?? pickBackground(clips, sensitive, mix.recentClips, mix.built++);
    if (offline && bg.type === "clip") {
      const clip = api.clipById(bg.id);
      if (!clip || !onDevice(`/media/${clip.video.portrait}`)) bg = pickBackground([], sensitive, [], mix.built);
    }
    // Reels rotate through the app's reciters (the person's own comes in now and then): a reel keeps its reciter.
    const by = reciter ?? fixedReciter(prefs) ?? pickReciter(item.ref, mix.recentReciters, prefs.reciter);
    const ayahs = Array.from({ length: (item.to ?? item.ayah) - item.ayah + 1 }, (_, i) => item.ayah + i);
    if (offline && !ayahs.every((a) => onDevice(api.audioPath(by, item.surah, a)))) return [];
    if (bg.type === "clip") mix.recentClips = [bg.id, ...mix.recentClips].slice(0, 6);
    if (!reciter) mix.recentReciters = [by, ...mix.recentReciters].slice(0, 6);
    // With the Feed's translation voice on, My language's voice reads the translation after the recitation (feed.ts).
    return [{ item, recipe: reelDesign(item, bg, by, prefs, lang) }];
  });
}

/** The voice reels in My language read their translation with when the Feed's translation voice is on (feed.ts
 *  reelDesign); null when the language has no recorded voice (the reel then has no voice switch). */
export const feedVoiceOf = (lang: string): Voice | null => voiceFor(lang, translationFor(lang));

/** The reels with the Feed's translation voice as the preferences now say (on or off). A reel whose design does not
 *  change keeps its object, so it does not start again. */
export function withFeedVoice<R extends Reel>(reels: R[], prefs: Prefs, lang: string): R[] {
  let changed = false;
  const next = reels.map((r) => {
    const d = reelDesign(r.item, r.recipe.bg, r.recipe.reciter, prefs, lang), voice = d.voice ?? "none";
    if (voice === (r.recipe.voice ?? "none") && d.translation === r.recipe.translation) return r;
    changed = true;
    return { ...r, recipe: { ...r.recipe, voice, translation: d.translation } };
  });
  return changed ? next : reels;
}

/** The reels at the text size now kept (reelText.ts), changed in place (the same array when nothing changes). */
export function withReelTextSize<R extends Reel>(reels: R[]): R[] {
  let changed = false;
  const next = reels.map((r) => {
    const d = sizedReel(r.recipe);
    if (d.quranSize === r.recipe.quranSize && d.transSize === r.recipe.transSize) return r;
    changed = true;
    return { ...r, recipe: d };
  });
  return changed ? next : reels;
}

/** `inset`: the share of the frame's height, from the bottom, that the screen covers with its own details (the surah,
 *  the reciter and Customize on Reels): the text stays above it. Only the screens pass it; exports have no overlay. */
export interface ReelScene { surahs: Surah[]; editions: Record<string, Edition>; brand: string; inset?: number }

export interface Prepared {
  ayahs: LoadedAyah[] | null;
  /** Drawn for `size`; null until the text and fonts are there. */
  layers: Layers | null;
  size: [number, number];
  clip: Clip | null;
  /** In-memory copies (object URLs) once downloaded; null until then (the network address is used meanwhile). `audio`:
   *  one per recording in playing order (voice.ts audioTracks: each ayah's recitation, then its translation voice). */
  video: string | null;
  audio: (string | null)[];
  /** Recording lengths (s), from the downloaded files; 0 = not known yet. */
  durations: number[];
  /** Everything is in memory: the reel starts at once. */
  warm: boolean;
  failed: boolean;
}

/** How much of a reel to get ready (preloadPlan). */
export type Level = "full" | "light" | "keep";

/** The reels around the one on screen (`index`, of `count`) to get ready, best first, and how much:
 *  - full: text, layers, the clip and the recitation in memory, so it starts at once: the reel on screen, the next two
 *    (only the next one with data saver), then the one before (to swipe back to; usually ready already)
 *  - light: the text, its layers (measured on the poster) and the poster: the third ahead
 *    (with data saver, the one before is kept drawn this way: it is still on the page to swipe back to)
 *  - keep: nothing new, an unfinished download stops (the bandwidth goes to the nearer reels) and the text layers are
 *    let go (drawn again if it comes back); the downloads already in memory stay: two back and the fourth ahead (with
 *    data saver: two back and the second ahead).
 *  Any other reel is released. */
export function preloadPlan(index: number, count: number, saveData = false): { i: number; level: Level }[] {
  const plan: [number, Level][] = saveData
    ? [[index, "full"], [index + 1, "full"], [index - 1, "light"], [index - 2, "keep"], [index + 2, "keep"]]
    : [[index, "full"], [index + 1, "full"], [index + 2, "full"], [index - 1, "full"], [index + 3, "light"], [index - 2, "keep"], [index + 4, "keep"]];
  return plan.filter(([i]) => i >= 0 && i < count).map(([i, level]) => ({ i, level }));
}

/** The reel canvas's size in pixels for a scroller of cssW × cssH: the screen's own pixels (CSS width × device pixel
 *  ratio), at least 720 and at most 1440 wide (1080 on a device with 4 GB of memory or less), the height in proportion
 *  (between 1.25 and 2.22 times the width). draw.ts scales everything by the short side, so the layout is the same at
 *  any size: only the sharpness changes. */
export function reelCanvasSize(cssW: number, cssH: number, dpr: number, deviceMemory?: number): [number, number] {
  if (!cssW || !cssH) return [720, 1280];
  const cap = deviceMemory !== undefined && deviceMemory <= 4 ? 1080 : 1440;
  const W = Math.round(Math.max(720, Math.min(cap, cssW * (dpr || 1))));
  return [W, Math.round(W * Math.min(1600 / 720, Math.max(900 / 720, cssH / cssW)))];
}

type Connection = { saveData?: boolean; effectiveType?: string };
/** The browser's data saver is on, or the connection is 2G: reels get ready one ahead only. */
export function saveData(nav: { connection?: Connection } = navigator as { connection?: Connection }): boolean {
  const c = nav.connection;
  return !!c && (c.saveData === true || /2g$/.test(c.effectiveType ?? ""));
}

// ---------- 1080p while watching ----------

/** How long a reel has been the one on screen before its 1080p file loads. */
export const HD_AFTER_MS = 1_500;
/** A 1080p file that has not taken over this long after it started loading is given up (the 720p one plays on). */
export const HD_STALL_MS = 10_000;
/** The connection a 1080p reel needs (Mbps): the browser's estimate, or (without one, e.g. iOS) the measured download
 *  of the 720p clips. */
export const HD_MBPS = 5;
/** Shorter downloads than this are not measured: they came from a cache, which says nothing about the network. */
const CACHED_MS = 100;

type NetInfo = Connection & { downlink?: number };
let measuredMbps: number | null = null;

/** Notes how fast a 720p clip downloaded (bytes in ms). */
export function noteClipDownload(bytes: number, ms: number) {
  if (ms >= CACHED_MS && bytes > 0) measuredMbps = (bytes * 8) / (ms * 1000);
}
export const resetClipSpeed = () => { measuredMbps = null; };

/** Whether the reel on screen may switch to its 1080p file: with the Network Information API, no data saver, 4G and
 *  (when the browser says) at least HD_MBPS; without it, only when the last 720p clip measured downloaded that fast. */
export function canUpgrade(nav: { connection?: NetInfo } = navigator as { connection?: NetInfo }, mbps: number | null = measuredMbps): boolean {
  const c = nav.connection;
  if (c) return c.saveData !== true && c.effectiveType === "4g" && (c.downlink === undefined || c.downlink >= HD_MBPS);
  return mbps !== null && mbps >= HD_MBPS;
}

/** Loads `url` in a hidden muted video under `visible` (it paints behind it); once it can play through, starts it
 *  where `visible` is and swaps it in on its first painted frame (requestVideoFrameCallback, else "playing"), so the
 *  picture neither flashes nor jumps. `visible` is then hidden and let go of (its file too). Resolves with the new
 *  element; rejects, leaving `visible` as it was, when the file fails or `signal` aborts (the reel left the screen). */
export function upgradeVideo(visible: HTMLVideoElement, url: string, signal: AbortSignal): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("canceled", "AbortError")); return; }
    const hd = document.createElement("video");
    hd.muted = true;
    hd.loop = visible.loop;
    hd.playsInline = true;
    hd.preload = "auto";
    hd.setAttribute("aria-hidden", "true");
    let settled = false;
    const off = () => {
      hd.removeEventListener("canplaythrough", ready);
      hd.removeEventListener("error", failed);
      hd.removeEventListener("playing", painted);
      signal.removeEventListener("abort", aborted);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      off();
      hd.pause();
      hd.removeAttribute("src");
      hd.load();
      hd.remove();
      reject(e);
    };
    const failed = () => fail(new Error("hd clip"));
    const aborted = () => fail(new DOMException("canceled", "AbortError"));
    const rvfc = typeof hd.requestVideoFrameCallback === "function";
    let realigned = false;
    function painted() {
      if (settled) return;
      // The seek took a moment while the 720p one played on: catch up once more before showing it.
      const lag = visible.currentTime - hd.currentTime;
      if (rvfc && !realigned && !visible.paused && Math.abs(lag) > 0.1 && Math.abs(lag) < 1) {
        realigned = true;
        hd.currentTime = visible.currentTime;
        hd.requestVideoFrameCallback(() => painted());
        return;
      }
      settled = true;
      off();
      if (visible.paused) hd.pause();
      visible.style.visibility = "hidden";
      visible.pause();
      visible.removeAttribute("src");
      visible.load();
      resolve(hd);
    }
    function ready() {
      hd.removeEventListener("canplaythrough", ready);
      hd.currentTime = visible.currentTime;
      if (rvfc) hd.requestVideoFrameCallback(() => painted());
      else hd.addEventListener("playing", painted);
      hd.play().catch(() => fail(new Error("hd play")));
    }
    hd.addEventListener("canplaythrough", ready);
    hd.addEventListener("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    visible.before(hd);
    hd.src = url;
  });
}

interface Entry {
  key: string;
  recipe: Recipe;
  prepared: Prepared;
  /** Aborted when the reel is released. */
  controller: AbortController;
  /** The downloads in flight (null when none): aborted when the reel is skipped past. */
  media: AbortController | null;
  /** All downloads have finished (or failed: the reel then streams from the network). */
  mediaDone: boolean;
  urls: string[];
  /** The clip file, once downloaded (Auto contrast measures it), and a promise of it for the first drawing's race. */
  clipBlob: Blob | null;
  clipArrived: Promise<Blob>;
  arrived: (b: Blob) => void;
  /** The text's scene and the measurement it was last drawn with (undefined: not drawn yet). */
  scene?: Scene;
  drawn?: Backdrop | null;
  poster: boolean;
  /** The text is being fetched and drawn; how many times it failed (it is tried again, RETRY_MS later). */
  loading: boolean;
  tries: number;
}

/** How long a reel's text waits for its clip's measurement before the poster's stands in. */
const SLOW_MS = 700;
/** A reel is never left without its text (a spinner on black) because something it waits for is slow: the ayah text
 *  is given TEXT_MS (then tried again RETRY_MS later, up to TRIES times); Auto contrast's measurement MEASURE_MS
 *  (then the text is drawn without it, and drawn again once the clip's measurement is here); the fonts FONTS_MS (then
 *  drawn with what has loaded, and again once they are here). A download that receives nothing for STALL_MS is
 *  dropped (the reel streams instead), so a stalled one never holds up the others. */
export const TEXT_MS = 8_000, RETRY_MS = 3_000, TRIES = 3, MEASURE_MS = 2_500, FONTS_MS = 3_000, STALL_MS = 10_000;

/** `p`, or `fallback` once `ms` have passed. */
export const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((ok) => setTimeout(() => ok(fallback), ms))]);
/** `p`, or a rejection once `ms` have passed. */
export const timeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

/** A whole file into memory; dropped when `signal` aborts or nothing arrives for STALL_MS. */
const blobOf = async (url: string, signal: AbortSignal, priority: RequestPriority) => {
  const ctl = new AbortController(), stop = () => ctl.abort();
  signal.addEventListener("abort", stop, { once: true });
  let timer = setTimeout(stop, STALL_MS);
  const alive = () => { clearTimeout(timer); timer = setTimeout(stop, STALL_MS); };
  try {
    const res = await fetch(url, { signal: ctl.signal, priority });
    if (!res.ok) throw new Error(`${res.status}`);
    const body = res.body;
    if (!body) return await res.blob();
    const reader = body.getReader(), parts: BlobPart[] = [];
    for (;;) {
      alive();
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return new Blob(parts, { type: res.headers.get("content-type") ?? "" });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
};

/** The reel's ayah numbers. */
export const numsOf = (r: Recipe) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i);

/** Length of a recitation file (s), read from its metadata. */
export function durationOf(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (d: number) => { a.removeAttribute("src"); resolve(Number.isFinite(d) ? d : 0); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = url;
    setTimeout(() => done(a.duration), 4000);
  });
}

/** One planned reel for ReelCache.sync. */
export interface PlannedReel { key: string; recipe: Recipe; level: Level }

/** `parallel`: reels downloading at once once the reel on screen has everything. */
export function createReelCache(onChange: () => void, { parallel = 2 } = {}) {
  let notify = onChange;
  const entries = new Map<string, Entry>();
  /** Reels that want their downloads, best first (the first is the reel on screen). */
  let order: string[] = [];

  function update(e: Entry, patch: Partial<Prepared>) {
    if (entries.get(e.key) !== e) return; // dropped meanwhile
    e.prepared = { ...e.prepared, ...patch };
    const p = e.prepared;
    p.warm = !!p.layers && p.audio.every(Boolean) && (!p.clip || !!p.video);
    notify();
  }

  function create(key: string, recipe: Recipe, size: [number, number]): Entry {
    const clip = recipe.bg.type === "clip" ? api.clipById(recipe.bg.id) : null;
    const n = audioTracks(recipe, numsOf(recipe)).length;
    let arrived: (b: Blob) => void = () => {};
    const e: Entry = {
      key, recipe, controller: new AbortController(), media: null, mediaDone: false, urls: [], clipBlob: null,
      clipArrived: new Promise<Blob>((ok) => (arrived = ok)), arrived: (b) => arrived(b), poster: false, loading: false, tries: 0,
      prepared: { ayahs: null, layers: null, size, clip, video: null, audio: Array(n).fill(null), durations: Array(n).fill(0), warm: false, failed: false },
    };
    entries.set(key, e);
    return e;
  }

  /** The screen's bottom inset now (ReelScene.inset, from the latest sync): every drawing uses it, whenever the text
   *  arrives. */
  let inset: number | undefined;
  function draw(e: Entry, backdrop: Backdrop | null) {
    if (e.controller.signal.aborted || !e.scene || !e.prepared.ayahs) return;
    e.drawn = backdrop;
    e.scene = { ...e.scene, inset };
    const [W, H] = e.prepared.size;
    update(e, { layers: drawLayers(W, H, e.prepared.ayahs, { ...e.scene, backdrop }) });
  }

  /** Draws the reel again with its clip's own measurement (the one its shared video uses), once the clip is here. */
  async function measure(e: Entry) {
    if (e.drawn === undefined || !e.clipBlob) return;
    const b = await backdropFor(e.recipe, e.prepared.clip, e.clipBlob);
    if (b !== e.drawn) draw(e, b);
  }

  async function loadText(e: Entry, scene: ReelScene) {
    const r = e.recipe, surah = scene.surahs[r.surah - 1];
    e.loading = true;
    try {
      const [ar, tr] = await timeout(api.getAyahText(r.surah, r.from, r.to, r.translation), TEXT_MS);
      if (e.recipe.translation !== r.translation) return; // the voice switch changed the translation meanwhile (retarget)
      const ayahs = ar.ayahs.map((a, i) => ({ num: a.numberInSurah, ar: stripBasmala(a.text, r.surah, a.numberInSurah), tr: tr ? tr.ayahs[i].text : "" }));
      update(e, { ayahs, failed: false });
      if (!surah) return;
      e.scene = { recipe: r, surah, lang: translationLang(r.translation, scene.editions), brand: scene.brand, inset };
      // Auto contrast measures the clip once it is downloaded; while that is slow (or not wanted yet: a reel warmed
      // lightly) the poster's measurement stands in, and the reel is drawn again when the clip is here. Neither holds
      // the text back for long (MEASURE_MS, FONTS_MS): it is drawn, then drawn again when they come.
      const clip = e.prepared.clip, auto = !!clip && r.autoContrast !== false;
      const first = (!auto ? backdropFor(r, clip)
        : Promise.race([e.clipArrived.then((b) => backdropFor(r, clip, b)), new Promise<void>((ok) => setTimeout(ok, SLOW_MS)).then(() => posterBackdrop(clip!, r.orientation))]))
        .catch(() => null);
      const fonts = fontsReady(ayahs, e.scene).then(() => true, () => true);
      const [backdrop, fontsIn] = await Promise.all([within(first, MEASURE_MS, null), within(fonts, FONTS_MS, false)]);
      if (e.recipe.translation !== r.translation) return;
      draw(e, backdrop);
      if (!fontsIn) void fonts.then(() => { if (e.drawn !== undefined && e.recipe.translation === r.translation) draw(e, e.drawn); });
      if (auto && !backdrop) void first.then((b) => { if (b && e.drawn === null && e.recipe.translation === r.translation) draw(e, b); });
      void measure(e);
    } catch {
      update(e, { failed: true });
      // Tried again a moment later (also when the reel is planned again: sync).
      if (++e.tries < TRIES) setTimeout(() => { if (entries.get(e.key) === e && e.prepared.failed && !e.loading) void loadText(e, scene); }, RETRY_MS);
    } finally {
      e.loading = false;
    }
  }

  /** The poster, into the HTTP cache for the reel's <video poster>. */
  function warmPoster(e: Entry, priority: "high" | "low") {
    const clip = e.prepared.clip;
    if (e.poster || !clip) return;
    e.poster = true;
    const img = new Image();
    img.fetchPriority = priority;
    img.src = reelPosterUrl(clip);
  }

  /** Downloads what the reel is still missing (the clip, each recording). */
  function startMedia(e: Entry, onScreen: boolean) {
    const ctl = (e.media = new AbortController()), signal = ctl.signal, priority: RequestPriority = onScreen ? "high" : "low";
    const clip = e.prepared.clip;
    warmPoster(e, priority === "high" ? "high" : "low");
    const jobs: Promise<unknown>[] = [];
    if (clip && !e.prepared.video) {
      const t0 = performance.now();
      jobs.push(blobOf(reelClipUrl(clip), signal, priority).then((blob) => {
        noteClipDownload(blob.size, performance.now() - t0);
        if (entries.get(e.key) !== e) return;
        e.clipBlob = blob;
        e.arrived(blob);
        const url = URL.createObjectURL(blob);
        e.urls.push(url);
        update(e, { video: url });
        void measure(e);
      }));
    }
    audioTracks(e.recipe, numsOf(e.recipe)).forEach((tk, i) => {
      if (e.prepared.audio[i]) return;
      jobs.push(blobOf(tk.url, signal, priority).then(async (blob) => {
        if (entries.get(e.key) !== e) return;
        const url = URL.createObjectURL(blob);
        e.urls.push(url);
        const d = await durationOf(url);
        update(e, { audio: e.prepared.audio.map((a, k) => (k === i ? url : a)), durations: e.prepared.durations.map((x, k) => (k === i ? d : x)) });
      }));
    });
    // A failed download just means the reel streams from the network instead; one stopped (skipped past) can resume.
    void Promise.allSettled(jobs).then(() => {
      if (e.media !== ctl) return;
      e.media = null;
      if (!signal.aborted) e.mediaDone = true;
      pump();
    });
  }

  /** Starts downloads in `order`: the reel on screen always; others one at a time until it has everything, then
   *  `parallel` at once. */
  function pump() {
    const want = order.map((key) => entries.get(key)).filter((e): e is Entry => !!e && !e.mediaDone);
    const head = entries.get(order[0]);
    if (head && want[0] === head && !head.media) startMedia(head, true);
    const limit = head && !head.mediaDone ? 1 : parallel;
    let running = want.filter((e) => e.media).length;
    for (const e of want) {
      if (running >= limit) break;
      if (e.media) continue;
      startMedia(e, false);
      running++;
    }
  }

  /** Stops a reel's unfinished downloads (what has arrived stays). */
  function pause(e: Entry) {
    e.media?.abort();
    e.media = null;
  }

  /** The reel's design changed in place (the translation voice turned on or off): the recordings it still has are kept,
   *  the new ones are downloaded, and the text is loaded and drawn again only when the translation changed (the old
   *  text shows meanwhile). The clip, its measurement and the poster stay. */
  function retarget(e: Entry, recipe: Recipe, scene: ReelScene) {
    const before = audioTracks(e.recipe, numsOf(e.recipe)), after = audioTracks(recipe, numsOf(recipe));
    const text = recipe.translation !== e.recipe.translation;
    const sized = recipe.quranSize !== e.recipe.quranSize || recipe.transSize !== e.recipe.transSize;
    e.recipe = recipe;
    pause(e);
    e.mediaDone = false;
    const from = after.map((tk) => before.findIndex((b) => b.url === tk.url));
    const patch: Partial<Prepared> = {
      audio: from.map((i) => (i >= 0 ? e.prepared.audio[i] : null)),
      durations: from.map((i) => (i >= 0 ? e.prepared.durations[i] : 0)),
    };
    if (text) {
      // The text on screen stays until the new translation is drawn (no spinner in between).
      e.scene = undefined;
      e.drawn = undefined;
      update(e, patch);
      void loadText(e, scene);
    } else {
      if (e.scene) e.scene = { ...e.scene, recipe };
      update(e, patch);
      // The text size changed (reelText.ts): drawn again at once, with the measurement it had.
      if (sized && e.scene && e.drawn !== undefined) draw(e, e.drawn);
    }
  }

  function drop(key: string) {
    const e = entries.get(key);
    if (!e) return;
    entries.delete(key);
    e.controller.abort();
    e.media?.abort();
    for (const url of e.urls) URL.revokeObjectURL(url);
  }

  return {
    /** Gets the planned reels ready (best first, preloadPlan), at this size, and releases every other reel. */
    sync(plan: PlannedReel[], size: [number, number], scene: ReelScene) {
      inset = scene.inset;
      const wanted = new Set(plan.map((x) => x.key));
      for (const key of [...entries.keys()]) if (!wanted.has(key)) drop(key);
      order = [];
      for (const { key, recipe, level } of plan) {
        let e = entries.get(key);
        if (e && e.recipe !== recipe) retarget(e, recipe, scene);
        if (level === "keep") {
          if (e) { pause(e); if (e.prepared.layers) update(e, { layers: null }); }
          continue;
        }
        if (!e) {
          e = create(key, recipe, size);
          void loadText(e, scene);
        } else if (e.prepared.failed && !e.loading) {
          void loadText(e, scene); // its text failed to load: again now it is wanted
        } else if (e.prepared.size[0] !== size[0] || e.prepared.size[1] !== size[1] || (e.scene && e.scene.inset !== inset)) {
          // A new size (rotation, resize) or a new bottom inset only needs the text drawn again; the downloads stay.
          // (Text still loading is drawn at the new size when it arrives.)
          update(e, { size, layers: null });
          if (e.drawn !== undefined) draw(e, e.drawn);
        } else if (!e.prepared.layers && e.drawn !== undefined) {
          draw(e, e.drawn); // let go while it was far away
        }
        if (level === "full") order.push(key);
        else { pause(e); warmPoster(e, "low"); }
      }
      pump();
    },
    get: (key: string) => entries.get(key)?.prepared ?? null,
    /** Who is told when a reel has more ready (the Feed, once it takes over a cache warmed on Home). */
    listen(fn: () => void) { notify = fn; },
    clear() { order = []; for (const key of [...entries.keys()]) drop(key); },
    size: () => entries.size,
    /** Reels downloading now (for tests and checks). */
    downloading: () => [...entries.values()].filter((e) => e.media).map((e) => e.key),
    /** Memory held by the text layers drawn (bytes, 4 per pixel), for checks. */
    layerBytes: () => [...entries.values()].reduce((sum, e) => {
      const l = e.prepared.layers;
      return sum + (l ? [l.brand, l.header, l.box, ...l.parts].reduce((n, c) => n + (c ? c.width * c.height * 4 : 0), 0) : 0);
    }, 0),
  };
}

export type ReelCache = ReturnType<typeof createReelCache>;

/** Wheel and trackpad gestures → one reel at a time. A trackpad swipe keeps sending events for a second or more (its
 *  momentum), and a mouse wheel one event per notch: the first strong push of a gesture steps, and the rest of the same
 *  gesture (events less than `gapMs` apart) is ignored, so one swipe never moves two reels. A new swipe begins after a
 *  pause, or as a clearly stronger push (or one the other way) once the step has had `settleMs` to land. Time is passed
 *  in (ms), so it can be tested. step() → 1 (next), -1 (previous) or 0. */
export function createWheelStepper({ gapMs = 160, settleMs = 450, threshold = 24 } = {}) {
  let sum = 0, last = -Infinity, lastAbs = 0, lockedAt = -Infinity, lockDir = 0, locked = false;
  return function step(deltaY: number, deltaMode: number, now: number): -1 | 0 | 1 {
    const d = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 800 : deltaY;
    const abs = Math.abs(d), dir = Math.sign(d);
    if (!dir) return 0;
    if (now - last > gapMs) { locked = false; sum = 0; lastAbs = 0; } // a pause: a new gesture
    last = now;
    if (locked) {
      const fresh = now - lockedAt > settleMs && abs >= threshold * 2 && (abs > lastAbs * 1.8 || dir !== lockDir);
      lastAbs = abs;
      if (!fresh) return 0; // the rest of the gesture that already stepped
      locked = false; sum = 0;
    }
    lastAbs = abs;
    if (sum && Math.sign(sum) !== dir) sum = 0;
    sum += d;
    if (Math.abs(sum) < threshold) return 0;
    locked = true; lockedAt = now; lockDir = dir; sum = 0;
    return dir > 0 ? 1 : -1;
  };
}

/** The reel at this scroll position (the reels are one screen high). */
export const reelAt = (scrollTop: number, height: number, count: number) =>
  Math.max(0, Math.min(count - 1, height ? Math.round(scrollTop / height) : 0));

// ---------- sound (owner, 8 Oct 2026: reels and stories play with sound unless the person muted them) ----------

const MUTED = "qd.reelsMuted";
/** The person muted reels on this device (the default is sound on). Shared by Reels and Discover's stories. */
export const storedMuted = (): boolean => { try { return localStorage.getItem(MUTED) === "1"; } catch { return false; } };
export const storeMuted = (muted: boolean) => {
  try { if (muted) localStorage.setItem(MUTED, "1"); else localStorage.removeItem(MUTED); } catch { /* kept for this visit */ }
};

let heard = false;
/** The recitation has played with sound on this visit. From then on the person's choice of sound is kept on every reel
 *  and story: a later play the browser refuses shows "Tap for sound" but does not turn the sound switch off. */
export const noteSoundHeard = () => { heard = true; };
export const soundHeard = () => heard;
export const resetSoundHeard = () => { heard = false; };

/** A twentieth of a second of silence (8-bit mono WAV), to unlock an audio element inside a tap. */
const SILENCE = (() => {
  const n = 400, b = new Uint8Array(44 + n), v = new DataView(b.buffer), ascii = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  ascii(0, "RIFF"); v.setUint32(4, 36 + n, true); ascii(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); ascii(36, "data"); v.setUint32(40, n, true);
  b.fill(128, 44);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`;
})();

/** Lets `el()` play with sound later: on the person's first tap or key anywhere in the app (opening the Reels or Discover
 *  tab is one), the element plays a moment of silence inside that gesture. Browsers that remember a gesture per element
 *  (Safari) then allow the recitation's sound without another tap; others allow it after any tap anyway. Returns the
 *  clean-up. */
export function unlockOnGesture(el: () => HTMLAudioElement | null): () => void {
  const events = ["click", "touchend", "keydown"] as const;
  const off = () => events.forEach((e) => document.removeEventListener(e, unlock, true));
  function unlock() {
    const a = el();
    if (!a) return;
    off();
    if (a.getAttribute("src") || !a.paused) return; // it has played already
    a.src = SILENCE;
    void a.play().then(() => { if (a.getAttribute("src") === SILENCE) { a.pause(); a.removeAttribute("src"); } }, () => {});
  }
  events.forEach((e) => document.addEventListener(e, unlock, true));
  return off;
}

// ---------- the first reel, warmed on Home (owner, 8 Oct 2026: Reels open at once) ----------

/** Reels a new mix starts with (Feed.tsx). */
export const FIRST_REELS = 6;

/** What the Feed's mix depends on: a warmed start is used only when it still matches. */
export const feedKey = (lang: string, prefs: Prefs, interests: string[]) =>
  `${lang}|${interests.join(",")}|${prefs.reciter ?? ""}|${fixedReciter(prefs) ?? ""}|${prefs.translation ?? ""}|${prefs.feedVoice ? "voice" : ""}`;

/** A feed started ahead: its mix, its first reels, and a cache holding the first reel ready (text and layers, clip,
 *  recordings, poster). */
export interface WarmFeed { mixer: ReturnType<typeof createMixer>; mix: ReelMix; reels: Reel[]; cache: ReelCache }

let warmed: { key: string; at: number; done: Promise<WarmFeed | null> } | null = null;
/** A warmed start older than this is let go (its mix would be stale). */
const WARM_MS = 30 * 60_000;

/** The reel box the Feed will have on this screen (phones: the screen above the bottom bar; larger screens: the centred
 *  portrait column), for drawing the first reel's text at the Feed's own size. */
export function guessReelBox(w = window.innerWidth, h = window.innerHeight): [number, number] {
  if (w < 760) return [w, h - 53];
  const H = h - 72 - 32;
  return [Math.min(Math.round(H * 9 / 16), w), H];
}

/** Starts the Feed's mix exactly as the Feed would (same pick of first reels, same designs: buildReels) and gets the
 *  first reel ready in memory, so opening Reels later plays it with no wait. Once per visit; nothing with data saver or
 *  on 2G. The Feed takes it over with takeWarmFeed. */
export function warmFirstReel(s: {
  lang: string; prefs: Prefs; interests: string[]; favourites: string[]; scene: ReelScene; size?: [number, number];
  /** A refresh warmed while watching: the mood chip on, and the ayahs already shown this visit (left out). */
  mood?: string | null; exclude?: Iterable<string>;
}) {
  if (warmed || saveData()) return;
  const key = `${feedKey(s.lang, s.prefs, s.interests)}|${s.mood ?? ""}`;
  const done = (async () => {
    const [topics, trending] = await Promise.all([api.getTopics(), api.getTrending()]);
    const mixer = createMixer({
      topics: topics.topics, trending, now: new Date(), signals: loadSignals(), favourites: s.favourites, interests: s.interests, mood: s.mood ?? null,
      exclude: [...(s.exclude ?? [])],
    });
    const items = Array.from({ length: FIRST_REELS }, () => mixer.next()).filter((x): x is FeedItem => !!x);
    const mix = newReelMix();
    const reels = await buildReels(items, mix, s.prefs, s.lang);
    if (!reels.length) return null;
    const [w, h] = s.size ?? guessReelBox();
    const cache = createReelCache(() => {});
    cache.sync([{ key: reels[0].item.key, recipe: reels[0].recipe, level: "full" }], reelCanvasSize(w, h, window.devicePixelRatio || 1,
      (navigator as { deviceMemory?: number }).deviceMemory), s.scene);
    return { mixer, mix, reels, cache };
  })().catch(() => null);
  warmed = { key, at: Date.now(), done };
}

/** Whether a warmed start is waiting (or on its way). */
export const hasWarmFeed = () => warmed !== null;

/** The warmed start (once), when it matches the Feed's key (feedKey, then "|" and the mood) and is recent; else null
 *  (and its memory is let go). */
export async function takeWarmFeed(key: string): Promise<WarmFeed | null> {
  const w = warmed;
  warmed = null;
  const got = w ? await w.done : null;
  if (!got) return null;
  if (w!.key !== key || Date.now() - w!.at > WARM_MS) { got.cache.clear(); return null; }
  return got;
}
/** Forgets a warmed start (tests). */
export const resetWarmFeed = () => { warmed = null; };
