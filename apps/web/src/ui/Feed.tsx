// The Discover feed: full-height reels that swipe vertically (CSS scroll snap; arrow keys, Page Up/Down and the wheel on
// a computer). Each reel is the live design, like the preview in Create: the background clip, the canvas text layer
// (same drawing and timeline code as the export) and the recitation; nothing is encoded to watch it. The reel on
// screen plays with sound (owner, 8 Oct 2026) unless the person muted reels on this device (reels.ts storedMuted); when the
// browser refuses sound without a tap (a cold link), it plays muted with "Tap for sound" and the first tap anywhere
// turns the sound on. Opening the tab is a tap: reels.ts unlockOnGesture uses it. It and the next two are prepared
// (text, layers, clip, recitation, poster) so they start at once, the third ahead lightly (text and poster), one ahead
// with data saver; reels further away are released (reels.ts preloadPlan). The text layers are drawn at the screen's
// own pixel density (reelCanvasSize), so the text is as sharp as the phone can show it.
// Swiping is scroll snap (a touch swipe moves one reel; wheel and trackpad gestures are stepped one reel each, reels.ts);
// nothing on screen changes while it moves: the reel on screen, the preparing of the next ones and the painting wait
// until the scrolling settles. On top (owner, 12 Oct 2026): the mood as the title ("For you ▾"), which opens "How are you
// feeling?" (a bottom sheet of the moods; one re-steers the mix, feed.ts), then the sound switch and a settings button
// that opens Language and audio (a bottom sheet: My language and, where it has a recorded translation voice, the voice
// switch). On each reel, on the right: Like (the favourite, with its count), Save
// (keeps the design in Saved), Share (the MP4 is made on the device with the export engine, then the share/save sheet,
// with its count), Download (the same MP4 in HD, saved straight to the device) and Reflect (where the ayah has scholars'
// notes, their names come in beside it for a moment, on every such reel: ScholarsNudge.tsx); at the bottom: the surah, the
// reciter with Customize beside them (opens Create with the reel's design, reciter and background); no reason line and
// no "Shared by" line (owner, 12 Oct 2026: the counts on the rail say it). The voice switch is the Feed voice preference (prefs.feedVoice, shared with Profile): it applies at
// once to the reel on screen (its audio starts again from the ayah being heard, with or without the voice) and to every
// other reel, without a new mix. Discover can open the feed on chosen reels ("Watch and listen", feed.ts startReelsWith); its stories play
// the same live reels (ReelMedia, exported for it). Counts come from stats.ts and are hidden when unknown.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { AyahStats, Recipe, Ref } from "../../../../contracts/types";
import { autoSave, openReflect, setPrefs, toast, toggleFavourite } from "../actions";
import { track } from "../analytics";
import * as api from "../api";
import { calmer, composeText, type Timing } from "../compose";
import { RECITERS, TAIL_SECONDS } from "../config";
import { designProps, translationLang } from "../design";
import type { ExportScene } from "../export";
import { createMixer, fixedReciter, hasReelStart, MOODS, reelStarts, subscribeReelStarts, takeReelStart, type FeedItem, type Reason } from "../feed";
import { defaultTranslation, hdFor, type Purpose } from "../prefs";
import { platform } from "../platform";
import { REMINDER_TIMES, reminderSetting, remindersAvailable, shownTime, turnOffReminder, turnOnReminder } from "../today";
import {
  buildReels, createReelCache, feedKey, FIRST_REELS, hasWarmFeed, takeWarmFeed, warmFirstReel, storedMuted, storeMuted, unlockOnGesture, createWheelStepper, feedVoiceOf, newReelMix, numsOf, preloadPlan, reelAt, reelCanvasSize, reelClipUrl, reelPosterUrl, saveData,
  canUpgrade, HD_AFTER_MS, HD_STALL_MS, noteSoundHeard, reelHdUrl, soundHeard, timeout, upgradeVideo, withFeedVoice, withReelTextSize, type Prepared, type Reel, type ReelCache,
  type WarmFeed,
} from "../reels";
import { languageOf } from "../lang";
import { onRetap } from "../nav";
import { languageName } from "../translations";
import { back, closeSheet, getRoute, navigate, openSheet } from "../router";
import { loadSignals, recordMood, recordSeen, recordWatch } from "../signals";
import { ayahStats, formatCount } from "../stats";
import { hasSurahStart, saveSurahProgress, setSurahReciter, surahSession, takeSurahStart, type SurahSession } from "../surah";
import { t } from "../strings";
import { chipOf, TOPICS } from "../topics";
import { audioTracks, estimateTrack, trackTiming, type Track } from "../voice";
import { REEL_TEXT_SIZES, reelTextSize, storeReelTextSize, type ReelTextSize } from "../reelText";
import { Segmented, Toggle } from "./controls";
import { FormatSheet, useFormatChoice, type Format, type Shape } from "./FormatSheet";
import { useExport } from "./exportJob";
import { coarsePointer, reducedMotion, useAppState, useLayout, useRoute, useStore } from "./hooks";
import { ArrowUpIcon, BackIcon, BellIcon, CloseIcon, BookmarkIcon, CheckIcon, DownIcon, DownloadIcon, EditIcon, HeartIcon, PlayIcon, ReflectIcon, SendIcon, SlidersIcon, SoundOffIcon, SoundOnIcon, UpIcon, WaveIcon } from "./icons";
import { PickRowButton } from "./PickerRow";
import { ScholarsNudge } from "./ScholarsNudge";
import { SampleButton, useReciterSample } from "./ReciterSample";
import { Sheet } from "./Sheet";
import "./screens/reels.css";

export type { Reel };

const MORE = 5;
/** Pull to refresh: how far (px) the first reel is pulled down to refresh. The New reels pill shows at this reel and
 *  every this many more, for PILL_MS each time (owner, 12 Oct 2026: it goes by itself), and the next mix is warmed a few
 *  reels before. */
const PULL_PX = 90, PILL_AT = 8, PILL_MS = 4000, WARM_REFRESH_AT = 5;
/** Reels around the one on screen that keep their media mounted (what is prepared in memory: reels.ts preloadPlan). */
const MOUNT_BEFORE = 1, MOUNT_AFTER = 3;
const SKIP_MS = 2000;
/** A whole surah played to its end: the next one starts after this many seconds (the end screen counts them). */
const END_COUNT = 5;
/** A whole surah's reel fades out over this long before the next one fades in (reels.css [data-fade]). */
const FADE_MS = 350;
/** The reel on screen changes once the scrolling has stopped: this long after the last scroll event (a scroll that
 *  starts no scroll event at all is taken as done after the longer time). */
const SETTLE_MS = 90, SETTLE_NO_SCROLL_MS = 180;
/** New reels (a refresh) or more reels that take longer than this are given up: the reels there are stay. */
export const REFRESH_MS = 12_000;
/** Room kept at the bottom of a reel (CSS px, above 7% of the height) for its details (reels.css .reel-info:
 *  the surah and reciter row with Customize) and the scholars' names beside Reflect at the foot of the rail; the text
 *  layer stays above it. */
const INFO_PX = 100, STORY_INFO_PX = 48;
/** The share of a reel's height (cssH) its details cover from the bottom (reels.ts ReelScene.inset): the canvas text is
 *  laid out above it, so a long ayah shrinks instead of running under the details. Exports have no details: no inset. */
export const reelInset = (cssH: number, infoPx = INFO_PX) => (cssH > 0 ? (cssH * 0.07 + infoPx + 8) / cssH : 0);
export const storyInset = (cssH: number) => reelInset(cssH, STORY_INFO_PX);

/** Time from a reel coming on screen to playing (background, text and recitation), kept for checks: the latest 50. */
export const reelTimings: { ref: Ref; warm: boolean; ms: number }[] = [];

export function reasonText(r: Reason, lang: string) {
  if (r.kind === "moment") return t.reasonMoment[r.moment] ?? "";
  if (r.kind === "mood") return moodLabel(r.mood, lang);
  if (r.kind === "search") return t.resultsFor(r.q);
  if (r.kind === "today") return t.ayahOfTheDay;
  return r.kind === "you" ? t.reasonYou : r.kind === "popular" ? t.reasonPopular : t.reasonDiscover;
}
const moodLabel = (id: string, lang: string) => { const tp = TOPICS.find((x) => x.id === id); return tp ? chipOf(tp, lang).label : id; };
export const reciterName = (folder: string) => RECITERS.find(([f]) => f === folder)?.[1] ?? "";
/** A count under a button, or nothing when it is 0 or unknown. */
const count = (n: number | undefined) => (n && n > 0 ? formatCount(n) : null);

/** The swipe hint shows once, on the first reel, until the person has swiped. */
const HINT_KEY = "qd.reelsHint";
const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return false; } };
const rememberHint = () => { try { localStorage.setItem(HINT_KEY, "1"); } catch { /* shown again next visit */ } };
/** The bubble under the settings button (the voice switch is in its sheet) shows once on this device, the first time
 *  the Reels show reels in a language with a voice. */
const COACH_KEY = "qd.meaningCoach";
const coachSeen = () => { try { return localStorage.getItem(COACH_KEY) === "1"; } catch { return false; } };
const rememberCoach = () => { try { localStorage.setItem(COACH_KEY, "1"); } catch { /* shown again next visit */ } };
const COACH_DELAY_MS = 800, COACH_MS = 5000;
/** "Who would you like to hear?" (My preferred reciter) is asked once on this device, a moment after the first reels
 *  start, when no reciter was chosen yet (owner, 12 Oct 2026). */
const ASK_KEY = "qd.reciterAsked", ASK_DELAY_MS = 1500;
const askedReciter = () => { try { return localStorage.getItem(ASK_KEY) === "1"; } catch { return true; } };
const rememberAsked = () => { try { localStorage.setItem(ASK_KEY, "1"); } catch { /* asked again next visit */ } };

/** Width × height of the scroller (each reel fills it). */
export function useBox(el: React.RefObject<HTMLElement | null>, on: boolean) {
  const [box, setBox] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const node = el.current;
    if (!node || !on) return;
    // A hidden feed measures 0 × 0: keep the last real size, so nothing is redrawn while it is away.
    const set = () => setBox((old) => (!node.clientWidth || !node.clientHeight || (old[0] === node.clientWidth && old[1] === node.clientHeight)
      ? old : [node.clientWidth, node.clientHeight]));
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el, on]);
  return box;
}

/** `active`: the feed is on screen (else nothing plays). */
export function Feed({ active }: { active: boolean }) {
  const store = useStore();
  const { ready, lang, surahs, editions, config, favourites, prefs, interests, hd } = useAppState();
  const layout = useLayout();
  const ex = useExport();
  const scroller = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [mood, setMood] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [sound, setSound] = useState(() => !storedMuted());
  /** The browser refused the sound (no tap yet): muted for now, "Tap for sound", and the next tap anywhere turns it on. */
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState<Record<Ref, AyahStats>>({});
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [swiped, setSwiped] = useState(hintSeen);
  const [, changed] = useReducer((n: number) => n + 1, 0);
  /** The reels are moving: downloads that finish meanwhile redraw the screen once they have stopped. */
  const scrolling = useRef(false), dirty = useRef(false);
  const cache = useRef<ReelCache | null>(null);
  const onCacheChange = () => { if (scrolling.current) dirty.current = true; else changed(); };
  cache.current ??= createReelCache(onCacheChange);
  if (import.meta.env.DEV) Object.assign(window, { __qdReels: cache.current }); // for checks: downloading(), layerBytes()
  useEffect(() => () => cache.current?.clear(), []);

  // ---------- size: each reel fills the scroller; the canvas has the screen's own pixels (reelCanvasSize) ----------
  const [cw, ch] = useBox(scroller, active && status === "ready");
  const size = useMemo<[number, number]>(
    () => reelCanvasSize(cw, ch, window.devicePixelRatio || 1, (navigator as { deviceMemory?: number }).deviceMemory),
    [cw, ch]);
  const scene = useMemo(() => ({ surahs, editions, brand: config.appName, inset: reelInset(ch) }), [surahs, editions, config.appName, ch]);

  // ---------- the mix ----------
  const mixer = useRef<ReturnType<typeof createMixer> | null>(null);
  const mix = useRef(newReelMix());
  const busy = useRef(false);
  const favRef = useRef(favourites);
  favRef.current = favourites;
  const interestsRef = useRef(interests);
  interestsRef.current = interests;

  // ---------- a whole surah (surah.ts): its reels in order, each going on to the next by itself ----------
  /** The surah playing (null: the mix). `queue`: its reels not built yet. */
  const [session, setSession] = useState<SurahSession | null>(null);
  const sessionRef = useRef<SurahSession | null>(null);
  const queue = useRef<FeedItem[]>([]);
  /** The surah played to its end: the end screen, then the next surah. */
  const [surahDone, setSurahDone] = useState(false);
  /** Bumped when a surah's next reel is wanted and none is built (a failed try is tried again). */
  const [moreTry, setMoreTry] = useState(0);
  const setSurah = (s: SurahSession | null) => { sessionRef.current = s; setSession(s); setSurahDone(false); };

  /** `given`: backgrounds already chosen (the thumbnails Discover showed), by reel key. */
  // Offline (the app), reels.ts buildReels leaves out a reel whose recitation is not on the device (onDevice).
  const build = useCallback((items: FeedItem[], given?: Map<string, Recipe["bg"]>): Promise<Reel[]> =>
    buildReels(items, mix.current, prefs, lang, given), [lang, prefs]);

  const take = (n: number) => Array.from({ length: n }, () => mixer.current?.next() ?? null).filter((x): x is FeedItem => !!x);

  /** The reels of a new mix (nothing on screen changes yet). Reels Discover handed over come first, in its order; the
   *  mix goes on after them. The first mix of the visit may have been started on Home (reels.ts warmFirstReel): the same
   *  reels, the first one already in memory; a refresh takes the next mix warmed while watching, the same way. */
  const newMix = async (moodId: string | null, refresh: boolean) => {
    const lead = takeReelStart() ?? [];
    // Reels handed over start their own reciter rotation, so the first one plays the recitation Results or Discover
    // warmed (warm.ts).
    if (lead.length) { moodId = null; mix.current.recentReciters = []; }
    const shownBefore = mixer.current?.shown ?? new Set<Ref>();
    let warm: WarmFeed | null = !lead.length && ((moodId === null && !mixer.current) || refresh)
      ? await takeWarmFeed(`${feedKey(lang, prefs, interestsRef.current)}|${moodId ?? ""}`) : null;
    if (warm && (!warm.reels.length || shownBefore.has(warm.reels[0].item.ref))) { warm.cache.clear(); warm = null; } // shown since it was warmed
    if (warm) {
      warm.reels = warm.reels.filter((r) => !shownBefore.has(r.item.ref));
      for (const ref of shownBefore) warm.mixer.shown.add(ref);
      return { lead, warm, mixer: warm.mixer, mix: warm.mix, first: warm.reels };
    }
    const [topics, trending] = await Promise.all([api.getTopics(), api.getTrending()]);
    const m = createMixer({
      topics: topics.topics, trending, now: new Date(), signals: loadSignals(), favourites: favRef.current, interests: interestsRef.current, mood: moodId,
      exclude: [...shownBefore, ...lead.map((l) => l.item.ref)], startAt: lead.length,
    });
    const items = Array.from({ length: Math.max(0, FIRST_REELS - lead.length) }, () => m.next()).filter((x): x is FeedItem => !!x);
    const first = await build([...lead.map((l) => l.item), ...items], new Map(lead.flatMap((l) => (l.bg ? [[l.item.key, l.bg] as const] : []))));
    return { lead, warm: null, mixer: m, mix: mix.current, first };
  };

  /** Which start() is the latest: a refresh given up (too slow, or the person swiped on) is let go when it comes. */
  const runs = useRef(0);
  const refreshingRef = useRef(false), refreshAtTop = useRef(false);
  /** Gives up the refresh in progress: the indicator goes, the reels on screen stay. */
  const dropRefresh = () => {
    if (!refreshingRef.current) return;
    runs.current++;
    refreshingRef.current = false;
    busy.current = false;
    setRefreshing(false);
  };
  /** A new mix. `refresh`: the person asked for new reels (the Reels tab tapped again, pull down on the first reel, the
   *  New reels pill): the reels on screen stay until the new ones are here, and the ayahs already shown this visit are
   *  left out. A refresh always ends: with the new reels, or (failed, or REFRESH_MS passed) with a toast and the reels
   *  there are. */
  const start = useCallback(async (moodId: string | null, refresh = false) => {
    const id = ++runs.current;
    busy.current = true;
    setSurah(null);
    refreshingRef.current = refresh;
    refreshAtTop.current = false;
    if (refresh) setRefreshing(true); else setStatus("loading");
    const failed = () => {
      if (runs.current !== id) return;
      if (refresh) { dropRefresh(); toast(store, t.refreshFailed); } else { busy.current = false; setStatus("failed"); }
    };
    const timer = refresh ? window.setTimeout(failed, REFRESH_MS) : 0;
    try {
      const got = await newMix(moodId, refresh);
      if (runs.current !== id) { got.warm?.cache.clear(); return; } // given up meanwhile
      if (!got.first.length) throw new Error("empty");
      mixer.current = got.mixer;
      mix.current = got.mix;
      cache.current!.clear();
      if (got.warm) {
        cache.current = got.warm.cache;
        got.warm.cache.listen(onCacheChange);
        if (import.meta.env.DEV) Object.assign(window, { __qdReels: cache.current });
      }
      setReels(got.first);
      setIndex(0);
      setPaused(false);
      if (got.lead.length) setMood(null);
      target.current = 0;
      scroller.current?.scrollTo?.({ top: 0 });
      setStatus("ready");
      busy.current = false;
      refreshingRef.current = false;
      setRefreshing(false);
    } catch {
      failed(); // a refresh that fails keeps the reels there are
    } finally {
      clearTimeout(timer);
    }
  }, [build]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Plays the surah `s` from its first reel (the surah's reciter for every reel). */
  const startSurah = useCallback(async (s: SurahSession) => {
    const id = ++runs.current;
    busy.current = true;
    setStatus("loading");
    try {
      const first = await buildReels(s.items.slice(0, FIRST_REELS), mix.current, prefs, lang, undefined, s.reciter);
      if (runs.current !== id) return;
      if (!first.length) throw new Error("empty");
      queue.current = s.items.slice(FIRST_REELS);
      cache.current!.clear();
      setSurah(s);
      setReels(first);
      setIndex(0);
      setPaused(false);
      target.current = 0;
      scroller.current?.scrollTo?.({ top: 0 });
      setStatus("ready");
    } catch {
      if (runs.current === id) setStatus("failed");
    } finally {
      if (runs.current === id) busy.current = false;
    }
  }, [lang, prefs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- new reels, like Instagram: the Reels tab tapped again, pull down on the first reel, the New reels pill ----------
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    if (busy.current || status !== "ready" || sessionRef.current) return;
    platform.haptic();
    finish();
    go(0); // back to the top (smoothly), while the new reels are fetched
    void start(mood, true);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => onRetap((tab) => { if (tab === "feed" && active) refreshRef.current(); }), [active]);
  // The next mix gets ready a few reels before the New reels pill shows (its first reel in memory, like on Home).
  const warmedAt = useRef(-1);
  useEffect(() => {
    if (status !== "ready" || session || index < WARM_REFRESH_AT || hasWarmFeed() || warmedAt.current === reels.length) return;
    warmedAt.current = reels.length;
    warmFirstReel({ lang, prefs, interests, favourites, scene, size: [cw, ch], mood, exclude: [...(mixer.current?.shown ?? [])] });
  }, [index, status]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pull to refresh on the first reel (touch): a drag down from its top past PULL_PX. Only a downward drag on the first
   *  reel counts, so swiping to the next reel (up) is untouched; the browser's own pull-to-refresh is off (reels.css). */
  const [pull, setPull] = useState(0);
  const pullFrom = useRef<number | null>(null);
  const touchY = (e: React.TouchEvent) => e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0;
  const onTouchStart = (e: React.TouchEvent) => {
    pullFrom.current = status === "ready" && !sessionRef.current && target.current === 0 && (scroller.current?.scrollTop ?? 0) <= 0 ? touchY(e) : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullFrom.current === null) return;
    const dy = touchY(e) - pullFrom.current;
    if (dy < 0 && pull === 0) { pullFrom.current = null; return; } // a swipe up: the next reel
    setPull(Math.max(0, dy));
  };
  const onTouchEnd = () => {
    const pulled = pull;
    pullFrom.current = null;
    setPull(0);
    if (pulled >= PULL_PX) refresh();
  };

  // First shown (and whenever My language changes): a new mix.
  useEffect(() => {
    if (!active || !ready || status !== "idle") return;
    const s = takeSurahStart();
    if (s) void startSurah(s); else void start(mood);
  }, [active, ready, status, mood, start, startSurah]);
  // Discover opened the feed on chosen reels (or a whole surah) while reels were already there: start again from them.
  const handOvers = useSyncExternalStore(subscribeReelStarts, reelStarts);
  useEffect(() => {
    if (!active || !ready || (status !== "ready" && status !== "failed") || busy.current) return;
    if (hasSurahStart()) void startSurah(takeSurahStart()!);
    else if (hasReelStart()) void start(null);
  }, [active, ready, status, start, startSurah, handOvers]);
  // My language, the interests or the reciter / translation preferences changed: a new mix.
  const mixKey = `${lang}|${interests.join(",")}|${prefs.reciter ?? ""}|${fixedReciter(prefs) ?? ""}|${prefs.translation ?? ""}`;
  const mixSeen = useRef(mixKey);
  useEffect(() => {
    if (mixSeen.current === mixKey) return;
    mixSeen.current = mixKey;
    const s = sessionRef.current;
    if (s) {
      const at = s.items.findIndex((it) => it.key === reels[index]?.item.key);
      void startSurah({ ...s, reciter: fixedReciter(prefs) ?? s.reciter, items: s.items.slice(Math.max(0, at)) });
    } else if (status !== "idle") void start(mood);
  }, [mixKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- translation voice: one switch on the reels, the same preference as in Profile (prefs.feedVoice) ----------
  // Turned on or off (here or in Profile), every reel follows in place: no new mix, the reel on screen goes on.
  const feedVoice = !!prefs.feedVoice;
  useEffect(() => {
    setReels((old) => withFeedVoice(old, { ...prefs, feedVoice }, lang));
  }, [feedVoice]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---------- text size (reelText.ts): Small, Medium or Large; every reel follows in place, the one on screen at once ----------
  const [textSize, setTextSize] = useState(reelTextSize);
  const chooseTextSize = (size: ReelTextSize) => { storeReelTextSize(size); setTextSize(size); setReels((old) => withReelTextSize(old)); };
  const voiceOption = feedVoiceOf(lang);
  const [voiceHint, setVoiceHint] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!voiceHint) return;
    const timer = setTimeout(() => setVoiceHint(null), 2200);
    return () => clearTimeout(timer);
  }, [voiceHint]);
  const toggleVoice = () => {
    if (!voiceOption) return;
    const on = !feedVoice;
    // Profile's one switch keeps both (new designs and the Feed); the design open in Create is left as it is.
    setPrefs(store, { ...prefs, feedVoice: on, voice: on }, { design: false });
    setVoiceHint((h) => ({ text: on ? t.meaningOn(lang) : t.meaningOff(lang), n: (h?.n ?? 0) + 1 }));
    closeCoach();
    platform.haptic();
  };
  // One-time bubble under the settings button: after the "Tap for sound" chip and the pull-refresh indicator are gone (a moment
  // later, since the browser's refusal of sound arrives just after the reel starts), gone on any tap, a toggle or 5 s.
  const [coach, setCoach] = useState(false);
  const coachDone = useRef(coachSeen());
  const [askDue, setAskDue] = useState(() => !askedReciter() && !prefs.reelReciter);
  const coachWaits = blocked || pull > 0 || refreshing || askDue;
  /** Seen: gone for good on this device. */
  const closeCoach = () => { coachDone.current = true; rememberCoach(); setCoach(false); };
  useEffect(() => {
    if (coachDone.current || !active || status !== "ready" || !voiceOption || coachWaits) return;
    const timer = setTimeout(() => setCoach(true), COACH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, status, voiceOption, coachWaits]);
  // One of the two appeared after it: it steps aside and comes back (not yet seen) once they are gone.
  useEffect(() => { if (coachWaits) setCoach(false); }, [coachWaits]);
  useEffect(() => {
    if (!coach) return;
    const timer = setTimeout(closeCoach, COACH_MS);
    document.addEventListener("pointerdown", closeCoach, true);
    return () => { clearTimeout(timer); document.removeEventListener("pointerdown", closeCoach, true); };
  }, [coach]); // eslint-disable-line react-hooks/exhaustive-deps

  const route = useRoute();
  const moodsOpen = active && route.sheet === "moods", settingsOpen = active && route.sheet === "reelSettings";
  const reciterOpen = active && route.sheet === "reelReciter";
  // My preferred reciter: asked once, a moment after the first reels start (not over a surah or today's ayah).
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!askDue || !active || status !== "ready" || session || route.sheet || blocked) return;
    const timer = setTimeout(() => { rememberAsked(); setAsking(true); openSheet("reelReciter"); }, ASK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [askDue, active, status, session, route.sheet, blocked]);
  useEffect(() => { if (asking && !reciterOpen) { setAsking(false); setAskDue(false); } }, [asking, reciterOpen]);
  /** "mix" or a reciter's folder: every reel from now on (a new mix with it), and whole surahs too. */
  const chooseReciter = (choice: string) => {
    if (choice !== "mix") setSurahReciter(choice);
    if (choice !== prefs.reelReciter) setPrefs(store, { ...prefs, reelReciter: choice }, { design: false });
    platform.haptic();
    closeSheet();
  };
  const reciterChoice = fixedReciter(prefs) ?? "mix";
  // A reciter's sample: the reel on screen pauses for it and plays on once the list closes.
  const sample = useReciterSample(reciterOpen);
  const pausedForSample = useRef(false);
  const hearSample = (folder: string) => {
    if (!paused && !pausedForSample.current) { pausedForSample.current = true; setPaused(true); }
    sample.toggle(folder);
  };
  useEffect(() => {
    if (!reciterOpen && pausedForSample.current) { pausedForSample.current = false; setPaused(false); }
  }, [reciterOpen]);
  /** A mood picked in "How are you feeling?": the sheet closes and the reels follow it. */
  const pickMood = (id: string | null) => {
    if (getRoute().sheet === "moods") closeSheet();
    if (id === mood) return;
    setMood(id);
    if (id) recordMood(id);
    platform.haptic();
    void start(id);
  };

  // More reels before the end comes into view.
  useEffect(() => {
    if (status !== "ready" || busy.current || index < reels.length - 4) return;
    const s = sessionRef.current;
    if (s && !queue.current.length) return; // the surah's last reels are all here
    busy.current = true;
    const id = runs.current;
    // A surah's reels leave the queue only once they are built, so a failed try never skips an ayah.
    const items = s ? queue.current.slice(0, MORE) : take(MORE);
    const next = s ? buildReels(items, mix.current, prefs, lang, undefined, s.reciter) : build(items);
    void timeout(next, REFRESH_MS).then((more) => {
      if (runs.current !== id) return;
      if (s) queue.current = queue.current.slice(items.length);
      setReels((old) => [...old, ...more]);
    }, () => {})
      .finally(() => { if (runs.current === id) busy.current = false; });
  }, [index, reels.length, status, build, moreTry]);

  // ---------- preparing the reels around the one on screen (reels.ts preloadPlan: nearest first) ----------
  useEffect(() => {
    if (status !== "ready" || !surahs.length) return;
    const plan = preloadPlan(index, reels.length, saveData());
    cache.current!.sync(plan.map(({ i, level }) => ({ key: reels[i].item.key, recipe: reels[i].recipe, level })), size, scene);
  }, [index, reels, size, scene, status, surahs.length]);

  // ---------- counts: the reel on screen and the next few (anonymous; hidden when the server has none) ----------
  const asked = useRef(new Set<Ref>());
  /** Whether each ayah was a favourite when its count came, so the Like count follows the person's own tap. */
  const likedThen = useRef<Record<Ref, boolean>>({});
  useEffect(() => {
    if (status !== "ready" || !active) return;
    const refs = reels.slice(index, index + 5).map((r) => r.item.ref).filter((r) => !asked.current.has(r));
    if (!refs.length) return;
    refs.forEach((r) => asked.current.add(r)); // each ayah is asked once, even when the server cannot answer
    void ayahStats(refs).then((got) => {
      if (!got.size) return;
      for (const ref of got.keys()) likedThen.current[ref] ??= favRef.current.includes(ref);
      setStats((old) => ({ ...old, ...Object.fromEntries(got) }));
    });
  }, [index, reels, status, active]);

  // The swipe hint is for the first reel only, and goes for good once the person has moved on.
  useEffect(() => {
    if (index > 0 && !swiped) { setSwiped(true); rememberHint(); }
  }, [index, swiped]);

  // ---------- which reel is on screen ----------
  // Scrolling is the browser's (scroll snap, one reel per gesture). The reel on screen changes only when the scrolling has
  // stopped: a state change in the middle of a swipe would start the next reel's video, audio and drawing and redraw all
  // the reels while the swipe is still animating.
  const target = useRef(0); // the reel being scrolled to (or on screen): keys and the wheel step from here
  const total = useRef(0);
  total.current = reels.length;
  const settleTimer = useRef(0);
  const dropRefreshRef = useRef(dropRefresh);
  dropRefreshRef.current = dropRefresh;
  /** Decides the reel on screen after `delay`: the one the scroll position shows, or `forced` when nothing scrolled. */
  const settleIn = useCallback((delay: number, forced?: number) => {
    clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = scroller.current;
      const i = forced ?? (el ? reelAt(el.scrollTop, el.clientHeight, total.current) : 0);
      target.current = i;
      scrolling.current = false;
      // Swiped on to another reel while new reels were coming: the person is watching these, so the refresh is let go.
      // (Only once the refresh's own scroll back to the first reel has landed.)
      if (refreshingRef.current && i === 0) refreshAtTop.current = true;
      else if (refreshingRef.current && refreshAtTop.current) dropRefreshRef.current();
      setIndex(i);
      if (dirty.current) { dirty.current = false; changed(); }
    }, delay);
  }, []);
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  const onScroll = () => {
    scrolling.current = true;
    settleIn(SETTLE_MS);
  };
  const go = useCallback((i: number, instant = false) => {
    const to = Math.max(0, Math.min(total.current - 1, i));
    const el = scroller.current;
    target.current = to;
    scrolling.current = true;
    el?.scrollTo?.({ top: to * (el.clientHeight || 0), behavior: instant || reducedMotion() ? "auto" : "smooth" });
    settleIn(SETTLE_NO_SCROLL_MS, to); // replaced by the scroll's own settling as soon as it starts
  }, [settleIn]);
  /** A whole surah going on by itself (owner, 12 Oct 2026): the reels fade through black to the next one instead of
   *  scrolling, so it feels like one continuous recitation. Swipes and keys still scroll. */
  const fadeTimer = useRef(0);
  const fadeTo = useCallback((i: number) => {
    const el = scroller.current;
    if (!el || reducedMotion() || document.visibilityState === "hidden") return go(i, true);
    clearTimeout(fadeTimer.current);
    el.dataset.fade = "out";
    fadeTimer.current = window.setTimeout(() => {
      go(i, true);
      fadeTimer.current = window.setTimeout(() => { delete el.dataset.fade; }, 60);
    }, FADE_MS);
  }, [go]);
  useEffect(() => () => clearTimeout(fadeTimer.current), []);

  // When a reel comes on screen: when (for the time to play), whether it was ready, and its watch time.
  const shown = useRef<{ key: string; ref: Ref; at: number; recipe: Recipe; total: number } | null>(null);
  const finish = useCallback(() => {
    const s = shown.current;
    if (!s) return;
    shown.current = null;
    const ms = Math.round(performance.now() - s.at);
    const props = { ...designProps(s.recipe), ms, key: mood ?? "you" };
    if (ms < SKIP_MS) track("feed_skip", props); else track("feed_view", props);
    recordWatch(s.ref, ms, s.total * 1000);
  }, [mood]);
  const current = active && status === "ready" ? reels[index] : undefined;
  /** A whole surah: the ayah being recited now, which moves on within a reel of two or more ayahs (36:3–4). */
  const [heard, setHeard] = useState<{ key: string; ayah: number } | null>(null);
  const ayahNow = (heard && heard.key === reels[index]?.item.key ? heard.ayah : reels[index]?.item.ayah) ?? 1;
  useEffect(() => {
    if (!current) return;
    setPaused(false);
    shown.current = { key: current.item.key, ref: current.item.ref, at: performance.now(), recipe: current.recipe, total: 0 };
    recordSeen([current.item.ref]);
    return finish;
  }, [current, finish]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") finish(); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [finish]);
  const onLength = (key: string, seconds: number) => { if (shown.current?.key === key) shown.current.total = seconds; };

  // ---------- a whole surah: on to the next reel by itself, where it stopped, the lock screen ----------
  /** The reel on screen ended: the next one (once it is built), or the end screen after the surah's last. */
  const waitNext = useRef(false);
  const onSurahEnd = useCallback(() => {
    if (target.current < total.current - 1) fadeTo(target.current + 1);
    else if (queue.current.length) { waitNext.current = true; setMoreTry((n) => n + 1); }
    else { saveSurahProgress(null); setSurahDone(true); }
  }, [fadeTo]);
  useEffect(() => {
    if (waitNext.current && index < reels.length - 1) { waitNext.current = false; fadeTo(index + 1); }
  }, [reels.length, index, fadeTo]);
  // Where the person is, kept on the device ("Continue" in Discover).
  useEffect(() => {
    if (session && current) saveSurahProgress({ surah: session.surah.n, ayah: current.item.ayah, reciter: session.reciter });
  }, [session, current]);
  // The lock screen and the notification: the surah and ayah, the reciter, and its buttons.
  const nowPlaying = platform.nowPlaying;
  const playingRef = current && session ? (current.item.to ? `${current.item.ref}–${current.item.to}` : current.item.ref) : null;
  useEffect(() => {
    if (!session || !playingRef) return;
    nowPlaying.set({ title: `${session.surah.name_en} · ${playingRef}`, artist: reciterName(session.reciter), album: config.appName,
      artwork: new URL("/icons/icon-512.png", location.href).href });
  }, [session, playingRef]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (session && active) nowPlaying.state(paused || surahDone ? "paused" : "playing");
  }, [session, active, paused, surahDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const fadeRef = useRef(fadeTo);
  fadeRef.current = fadeTo;
  const onSurahEndRef = useRef(onSurahEnd);
  onSurahEndRef.current = onSurahEnd;
  useEffect(() => {
    if (!session) return;
    nowPlaying.handle("play", () => setPaused(false));
    nowPlaying.handle("pause", () => setPaused(true));
    nowPlaying.handle("nexttrack", () => onSurahEndRef.current());
    nowPlaying.handle("previoustrack", () => fadeRef.current(target.current - 1));
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack"] as const) nowPlaying.handle(a, null);
      nowPlaying.state("none");
      nowPlaying.set(null);
    };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  // The end screen: the next surah starts by itself after a short count, unless the person chooses.
  const nextSurah = session && session.surah.n < 114 ? surahs[session.surah.n] : undefined;
  const [endCount, setEndCount] = useState(0);
  const playSurah = (n: number, from?: number) => {
    const surah = surahs[n - 1];
    if (!surah) return;
    setSurahDone(false);
    void surahSession(surah, { from: from ?? 1, reciter: session?.reciter }).then(startSurah);
  };
  useEffect(() => {
    if (!surahDone) return;
    setEndCount(END_COUNT);
    const timer = setInterval(() => setEndCount((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [surahDone]);
  useEffect(() => {
    if (surahDone && endCount <= 0 && nextSurah) playSurah(nextSurah.n);
  }, [endCount]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Back out of the surah: the mix comes back the next time Reels opens. */
  const leaveSurah = () => {
    runs.current++;
    busy.current = false;
    setSurah(null);
    setReels([]);
    setStatus("idle");
    back();
  };

  // Nothing plays while the feed is not on screen.
  useEffect(() => { if (!active) audio.current?.pause(); }, [active]);

  // ---------- keys (computer): arrows / Page Up/Down / j k for the next reel, space to pause, m for sound ----------
  useEffect(() => {
    if (!active || status !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]")) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key;
      if (k === "ArrowDown" || k === "PageDown" || k === "j") { if (!e.repeat) go(target.current + 1); }
      else if (k === "ArrowUp" || k === "PageUp" || k === "k") { if (!e.repeat) go(target.current - 1); }
      else if (k === " " && !(el && el.closest("button, a"))) setPaused((p) => !p);
      else if (k === "m") toggleSound();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }); // every render: it reads the current state

  // ---------- wheel (computer): one reel per wheel notch, wheel spin or trackpad swipe ----------
  // A trackpad swipe sends wheel events for a second or more (its momentum): the stepper (reels.ts) steps once per gesture.
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const el = scroller.current;
    if (!el || status !== "ready") return;
    const stepper = createWheelStepper();
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // pinch zoom, sideways
      e.preventDefault();
      const dir = stepper(e.deltaY, e.deltaMode, performance.now());
      if (dir) goRef.current(target.current + dir);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [status]);

  // ---------- sound and pause ----------
  /** Sound on or off (inside a tap, so phones allow it), remembered on this device unless `remember` is false. */
  function setSoundOn(on: boolean, remember = true) {
    const a = audio.current;
    setSound(on);
    blockedRef.current = false;
    setBlocked(false);
    if (remember) storeMuted(!on);
    // play() inside the tap, even while it plays muted: that is what lets this element play with sound from now on
    // (Safari), so the next reels start with sound too.
    if (a) { a.muted = !on; if (on && !paused && a.getAttribute("src")) void a.play().then(() => { if (!a.muted) noteSoundHeard(); }, () => {}); }
  }
  function toggleSound() { setSoundOn(!sound); }
  // Coming back to the feed: the choice made here or in Discover's stories.
  useEffect(() => { if (active) setSound(!storedMuted()); }, [active]);
  // The first tap or key anywhere in the app lets this element play with sound (Safari remembers it per element).
  useEffect(() => unlockOnGesture(() => audio.current), []);
  // Refused before any sound was heard (a cold link): muted until a tap. Refused after the person already heard it: their
  // choice stays (the switch stays on; this reel plays muted with "Tap for sound", the next one tries with sound again).
  const onBlocked = useCallback(() => { blockedRef.current = true; setBlocked(true); if (!soundHeard()) setSound(false); }, []);
  // Sound refused: the first tap anywhere turns it on.
  useEffect(() => {
    if (!blocked || !active) return;
    const on = () => { if (blockedRef.current) setSoundOn(true); };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }); // every render: setSoundOn reads the current state
  /** A tap on the reel: sound on when the browser had refused it; else pause / resume. */
  const onReelTap = () => {
    if (blockedRef.current) { setSoundOn(true); return; }
    setPaused((p) => !p);
  };

  // ---------- actions ----------
  /** The reel as an export: Download always saves HD (owner, 12 Oct 2026: no quality choice on the reels); Share sends
   *  by the quality picked elsewhere (prefs.ts hdFor). */
  const sceneOfReel = (reel: Reel, purpose: Purpose): ExportScene | null => {
    const p = cache.current!.get(reel.item.key), surah = surahs[reel.recipe.surah - 1];
    if (!p?.ayahs || !surah) return null;
    return {
      recipe: reel.recipe, surah, lang: translationLang(reel.recipe.translation, editions), brand: config.appName,
      ayahs: p.ayahs, current: 0, clip: p.clip, hd: purpose === "save" || hdFor(hd, purpose),
    };
  };
  /** Which button started the export on screen, so its progress shows on that one (both make the same MP4). */
  const [via, setVia] = useState<"share" | "download">("share");
  /** Today's ayah shared or saved from its reel (admin Daily ayah counts it). */
  const countToday = (reel: Reel) => { if (reel.item.reason.kind === "today") track("today_shared", { ref: reel.item.ref }); };
  /** Share or Download asks first: a video or an image (FormatSheet; the last choice comes first). Download: the file
   *  goes straight to the device (a download on the web, Photos / Gallery in the app). */
  const format = useFormatChoice((reel: Reel, save: boolean, kind: Format, shape: Shape) => {
    const made = sceneOfReel(reel, save ? "save" : "share");
    if (!made) return;
    const s = { ...made, recipe: { ...made.recipe, orientation: shape } }; // the shape chosen (FormatSheet)
    countToday(reel);
    setVia(save ? "download" : "share");
    if (kind === "image") void ex.image(s, reel.item.key, save ? { save: true } : undefined);
    else void ex.video(s, reel.item.key, save ? { save: true } : undefined);
  });
  const share = (reel: Reel) => format.ask(reel, false);
  const download = (reel: Reel) => format.ask(reel, true);
  const edit = (reel: Reel) => {
    store.dispatch({ type: "recipe", recipe: structuredClone(reel.recipe) });
    track("ayah_select", { ...designProps(reel.recipe), source: "suggested" });
    navigate("create");
  };
  const reflect = (reel: Reel) => {
    openReflect(store, reel.item.ref, "feed");
    openSheet("reflect");
  };
  /** The scholars' names beside Reflect (ScholarsNudge) show on every reel whose ayah has them (owner, 12 Oct 2026:
   *  always, not now and then). */
  const allowNudge = () => true;
  const nudgeShown = () => {};
  /** Keeps the reel's design in Saved without making the file (an identical design is updated, not added again). */
  const keep = (reel: Reel) => {
    const key = reel.item.key, s = sceneOfReel(reel, "save");
    if (!s) return;
    if (!kept.has(key)) {
      setKept((old) => new Set(old).add(key));
      void autoSave(store, s.recipe, s.surah, "video", () => import("../export").then((m) => m.thumbnail(s, 0)));
    }
    toast(store, t.reelSaved);
  };

  // The New reels pill: for PILL_MS at reel PILL_AT and again each PILL_AT reels further (from the top again after a
  // refresh).
  const [pill, setPill] = useState(false);
  const pillFrom = useRef(0);
  useEffect(() => {
    if (index < pillFrom.current) pillFrom.current = 0;
    if (status !== "ready" || session || index < PILL_AT || index - pillFrom.current < PILL_AT) return;
    pillFrom.current = index;
    setPill(true);
  }, [index, status]);
  useEffect(() => {
    if (!pill) return;
    const timer = setTimeout(() => setPill(false), PILL_MS);
    return () => clearTimeout(timer);
  }, [pill]);

  // Today's ayah (today.ts): while its reel is on screen, the top says so, with the day and, in the app, "Remind me",
  // which opens the daily reminder (owner, 12 Oct 2026).
  const todayOn = status === "ready" && reels[index]?.item.reason.kind === "today";
  const reminderOpen = active && route.sheet === "reminder";
  const [reminder, setReminder] = useState(reminderSetting);
  const [reminderTime, setReminderTime] = useState(reminder.time);
  useEffect(() => { if (reminderOpen) setReminderTime(reminderSetting().time); }, [reminderOpen]);
  const saveReminder = () => void turnOnReminder(reminderTime, defaultTranslation(prefs, lang), surahs).then((result) => {
    if (result !== "on") return toast(store, result === "denied" ? t.reminderDenied : t.reminderFailed);
    setReminder(reminderSetting());
    toast(store, t.reminderOnToast(shownTime(reminderTime)));
    closeSheet();
  });
  const stopReminder = () => void turnOffReminder().then(() => {
    setReminder(reminderSetting());
    toast(store, t.reminderOffToast);
    closeSheet();
  });

  const moods = MOODS.map((m) => ({ id: m.id, label: moodLabel(m.id, lang) }));
  const language = languageOf(lang);
  const job = ex.job;
  // The Export sheet opened for a reel's file closes once it is shared, saved and dismissed.
  useEffect(() => { if (active && job.phase === "idle" && getRoute().sheet === "export") closeSheet(); }, [active, job.phase]);
  const exporting = job.phase === "busy" && job.kind === "video" ? job : null;
  const showSwipe = !swiped && (layout === "phone" || coarsePointer());

  return (
    <div className={`feed-wrap${layout === "phone" ? "" : " wide"}`}>
      <div className="feed-top">
        {/* A whole surah (owner, 12 Oct 2026, like Discover's stories): how far along on top, then Back, the mark, how far
            in words over the surah's name, small; the details below keep only the reciter. */}
        {session && (
          <div className="surah-progress" aria-hidden="true">
            <i style={{ transform: `scaleX(${Math.min(1, ayahNow / session.surah.ayahs)})` }} />
          </div>
        )}
        <div className="reels-bar">
          <h1 className="sr-only">{t.navReels}</h1>
          {session && (
            <>
              <button type="button" className="reels-back" aria-label={t.back} onClick={leaveSurah}><BackIcon /></button>
              <span className="reel-avatar reels-surah-mark" aria-hidden="true"><img src="/icons/icon.svg" alt="" /></span>
            </>
          )}
          {session
            ? <p className="reels-surah">
                <span className="reel-reason">{t.surahAyahOf(ayahNow, session.surah.ayahs)}</span>
                <strong>{session.surah.name_en}</strong></p>
            : todayOn
            ? <p className="reels-today"><strong>{t.todayTitle}</strong><span>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span></p>
            : <button type="button" className="reels-mood" aria-haspopup="dialog" aria-expanded={moodsOpen} onClick={() => openSheet("moods")}>
                <span dir="auto">{mood ? moodLabel(mood, lang) : t.moodForYou}</span><DownIcon />
              </button>}
          {todayOn && remindersAvailable() && (
            <button type="button" className="reels-remind" aria-haspopup="dialog" aria-expanded={reminderOpen} onClick={() => openSheet("reminder")}>
              <BellIcon /><span>{reminder.on ? t.reminderAt(shownTime(reminder.time)) : t.remindMe}</span>
            </button>
          )}
          <button type="button" className="reels-mute" aria-label={sound ? t.soundOff : t.soundOn} onClick={toggleSound}>
            {sound ? <SoundOnIcon /> : <SoundOffIcon />}
          </button>
          <div className="reels-settings-wrap" hidden={todayOn && !session}>
            <button type="button" className="reels-mute" aria-label={t.reelSettings} aria-haspopup="dialog" aria-expanded={settingsOpen}
              onClick={() => { closeCoach(); openSheet("reelSettings"); }}><SlidersIcon /></button>
            {coach && <span className="meaning-coach" dir="auto">{t.meaningCoach(lang, languageName(lang).english)}</span>}
          </div>
        </div>
      </div>
      <Sheet open={moodsOpen} title={t.howFeeling} onClose={closeSheet} className="mood-sheet">
        <div className="mood-group" role="group" aria-label={t.feedMoods}>
          <button type="button" className="mood-you" aria-pressed={mood === null} onClick={() => pickMood(null)}>
            <span className="mood-you-text"><strong>{t.moodForYou}</strong><span>{t.moodForYouHint}</span></span>
            {mood === null && <CheckIcon />}
          </button>
          <div className="mood-list">
            {moods.map((m) => (
              <button key={m.id} type="button" dir="auto" aria-pressed={mood === m.id} onClick={() => pickMood(m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
      </Sheet>
      <Sheet open={reminderOpen} title={t.reminderSheetTitle} onClose={closeSheet} className="reminder-sheet">
        <p className="hint">{t.reminderIntro}</p>
        <div className="reminder-times" role="radiogroup" aria-label={t.reminderWhen}>
          {REMINDER_TIMES.map((time) => (
            <button key={time} type="button" role="radio" aria-checked={reminderTime === time} onClick={() => setReminderTime(time)}>
              {t.reminderTimes[time]}<span>{shownTime(time)}</span>
            </button>
          ))}
        </div>
        <label className="reminder-other">
          <span>{t.reminderOther}</span>
          <input type="time" value={reminderTime} onChange={(e) => { if (e.target.value) setReminderTime(e.target.value); }} />
        </label>
        <div className="reminder-actions">
          <button type="button" className="btn primary" onClick={saveReminder}>{reminder.on ? t.reminderSave : t.reminderTurnOn}</button>
          {reminder.on
            ? <button type="button" className="btn ghost" onClick={stopReminder}>{t.reminderTurnOff}</button>
            : <button type="button" className="btn ghost" onClick={closeSheet}>{t.notNow}</button>}
        </div>
      </Sheet>
      <FormatSheet {...format.sheet} open={active && format.sheet.open} />
      <Sheet open={settingsOpen} title={t.reelSettings} onClose={closeSheet} className="reel-settings-sheet">
        <PickRowButton label={t.myLanguage} value={language.native !== language.english ? `${language.native} · ${language.english}` : language.native}
          onClick={() => store.dispatch({ type: "langPicker", open: "change" })} />
        <PickRowButton label={t.myReciter} value={reciterChoice === "mix" ? t.reciterMix : reciterName(reciterChoice)} expanded={reciterOpen}
          onClick={() => openSheet("reelReciter", true)} />
        <div className="reel-voice">
          {voiceOption
            ? <><Toggle label={t.hearMeaning(lang)} on={feedVoice} onChange={() => toggleVoice()} /><p className="hint">{t.meaningHint(languageName(lang).english)}</p></>
            : <p className="hint">{t.noMeaningVoice(languageName(lang).english)}</p>}
        </div>
        <div className="reel-textsize">
          <span className="dd-label" id="reel-text-size">{t.textSize}</span>
          <Segmented<ReelTextSize> labelledBy="reel-text-size" value={textSize} onChange={chooseTextSize}
            options={REEL_TEXT_SIZES.map((s): [ReelTextSize, string] => [s, t.textSizes[s]])} />
        </div>
      </Sheet>
      <Sheet open={reciterOpen} title={asking ? t.reciterAsk : t.myReciter} onClose={closeSheet} className="reciter-sheet">
        {asking && <p className="hint">{t.reciterAskHint}</p>}
        <div className="reciter-choices" role="radiogroup" aria-label={t.myReciter}>
          <button type="button" role="radio" aria-checked={reciterChoice === "mix"} className="reciter-mix" onClick={() => chooseReciter("mix")}>
            <span><strong>{t.reciterMix}</strong><span>{t.reciterMixHint}</span></span>{reciterChoice === "mix" && <CheckIcon />}
          </button>
          {RECITERS.map(([folder, name]) => (
            <div key={folder} className="choice-row">
              <button type="button" role="radio" aria-checked={reciterChoice === folder} onClick={() => chooseReciter(folder)}>
                <span>{name}</span>{reciterChoice === folder && <CheckIcon />}
              </button>
              <SampleButton name={name} playing={sample.playing === folder} onClick={() => hearSample(folder)} />
            </div>
          ))}
        </div>
      </Sheet>
      {(pull > 0 || refreshing) && (
        <div className="pull-refresh" role="status" data-ready={pull >= PULL_PX || refreshing || undefined}
          style={{ transform: `translate(-50%, ${refreshing ? 0 : Math.min(pull, PULL_PX * 1.4) * 0.6 - 40}px)` }}>
          {refreshing ? <span className="spinner small" /> : <DownIcon />}
          <span>{refreshing ? t.refreshingReels : pull >= PULL_PX ? t.releaseForNew : t.pullForNew}</span>
        </div>
      )}
      {status === "ready" && pill && !refreshing && (
        <button type="button" className="new-reels" onClick={refresh}><ArrowUpIcon />{t.newReels}</button>
      )}
      <div ref={scroller} className="reels" onScroll={onScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onTouchCancel={() => { pullFrom.current = null; setPull(0); }} aria-label={t.feedLabel} aria-roledescription="feed" aria-busy={status === "loading"}>
        {status !== "ready" && (
          <div className="reel placeholder">
            {status === "failed"
              ? <p>{t.feedFailed} <button type="button" className="btn small" onClick={() => void start(mood)}>{t.retry}</button></p>
              : <p><span className="spinner" /> {t.feedLoading}</p>}
          </div>
        )}
        {status === "ready" && reels.map((reel, i) => {
          const near = i >= index - MOUNT_BEFORE && i <= index + MOUNT_AFTER;
          const isActive = active && i === index;
          const surah = surahs[reel.recipe.surah - 1];
          const ref = reel.item.ref, shownRef = reel.item.to ? `${ref}–${reel.item.to}` : ref;
          const fav = favourites.includes(ref);
          const mine = exporting && exporting.source === reel.item.key ? exporting : null;
          const sharing = via === "share" ? mine : null, downloading = via === "download" ? mine : null;
          const st = stats[ref];
          const likes = st ? Math.max(0, st.likes + (fav ? 1 : 0) - (likedThen.current[ref] ? 1 : 0)) : undefined;
          const ready = !!cache.current!.get(reel.item.key)?.ayahs;
          const saved = kept.has(reel.item.key);
          return (
            <article key={reel.item.key} className="reel" aria-label={t.reelLabel(surah?.name_en ?? "", shownRef)} aria-current={i === index ? "true" : undefined}
              data-ref={ref}>
              {near && (
                <ReelMedia reel={reel} prepared={cache.current!.get(reel.item.key)} size={size} scale={cw / size[0]} active={isActive} drawn={Math.abs(i - index) <= 1}
                  paused={paused} sound={sound} audio={audio} scrolling={scrolling} onTap={onReelTap} onLength={(s) => onLength(reel.item.key, s)}
                  onBlocked={onBlocked} onEnd={session && isActive ? onSurahEnd : undefined}
                  onAyah={session && isActive ? (n) => setHeard({ key: reel.item.key, ayah: n }) : undefined} />
              )}
              <div className="reel-info">
                <div className="reel-who">
                  {!session && <span className="reel-avatar" aria-hidden="true"><img src="/icons/icon.svg" alt="" /></span>}
                  <div className="reel-who-text">
                    {!session && <strong>{surah?.name_en} · {shownRef}</strong>}
                    <span className="reel-reciter"><WaveIcon /><span>{reciterName(reel.recipe.reciter)}</span></span>
                  </div>
                  <button type="button" className="reel-customize" aria-label={t.customizeReel(surah?.name_en ?? "", shownRef)} onClick={() => edit(reel)}>
                    <EditIcon /><span>{t.customize}</span></button>
                </div>
              </div>
              <div className="reel-rail">
                <button type="button" className="rail-btn like" aria-pressed={fav} aria-label={count(likes) ? `${t.likeReel}, ${count(likes)}` : t.likeReel}
                  onClick={() => void toggleFavourite(store, ref)}><HeartIcon /><span>{count(likes) ?? t.likeReel}</span></button>
                <button type="button" className="rail-btn" aria-pressed={saved} aria-label={t.saveReel} disabled={!ready && !saved}
                  onClick={() => keep(reel)}><BookmarkIcon /><span>{t.saveReel}</span></button>
                <button type="button" className="rail-btn" aria-label={sharing ? sharing.label : count(st?.shares) ? `${t.shareReel}, ${count(st?.shares)}` : t.shareReel}
                  disabled={!!exporting || !ready} onClick={() => share(reel)}>
                  {sharing ? <span className="pct">{t.sharing(sharing.pct)}</span> : <SendIcon />}<span>{count(st?.shares) ?? t.shareReel}</span></button>
                <button type="button" className="rail-btn" aria-label={downloading ? downloading.label : t.downloadReel}
                  disabled={!!exporting || !ready} onClick={() => download(reel)}>
                  {downloading ? <span className="pct">{t.sharing(downloading.pct)}</span> : <DownloadIcon />}<span>{t.downloadReel}</span></button>
                {/* Reflect last (owner, 12 Oct 2026: under Like, the names beside it ran over the ayah), low, by the
                    translation, so the scholars' names beside it stay clear of the Arabic. */}
                <div className="rail-reflect">
                  <button type="button" className="rail-btn" aria-label={t.reflect} onClick={() => reflect(reel)}><ReflectIcon /><span>{t.reflect}</span></button>
                  {isActive && (
                    <ScholarsNudge key={reel.item.key} refId={ref} lang={lang} playing={!paused && !blocked && !refreshing && !route.sheet}
                      allow={allowNudge} onShown={nudgeShown} onOpen={() => reflect(reel)} />
                  )}
                </div>
              </div>
              {isActive && blocked && <button type="button" className="sound-hint" onClick={() => setSoundOn(true)}><SoundOffIcon /> {t.tapForSound}</button>}
              {/* A play sign while paused (tapping the reel plays it again); "Paused" for screen readers. */}
              {isActive && paused && <span className="paused-badge" aria-live="polite"><PlayIcon /><span className="sr-only">{t.pausedReel}</span></span>}
              {isActive && voiceHint && <span key={voiceHint.n} className="voice-hint" role="status">{voiceHint.text}</span>}
              {isActive && i === 0 && showSwipe && <span className="swipe-hint"><ArrowUpIcon />{t.swipeHint}</span>}
            </article>
          );
        })}
      </div>
      {layout !== "phone" && status === "ready" && (
        <div className="feed-nav">
          <button type="button" className="icon-btn" aria-label={t.prevReel} disabled={index === 0} onClick={() => go(target.current - 1)}><UpIcon /></button>
          <button type="button" className="icon-btn" aria-label={t.nextReel} onClick={() => go(target.current + 1)}><DownIcon /></button>
          <p className="muted small">{t.feedHint}</p>
        </div>
      )}
      {session && surahDone && (
        <div className="surah-end" role="dialog" aria-modal="true" aria-labelledby="surah-end-title">
          <button type="button" className="surah-end-close" aria-label={t.close} onClick={leaveSurah}><CloseIcon /></button>
          <div className="surah-end-head">
            <span className="surah-end-ar" dir="rtl" lang="ar">{session.surah.name_ar}</span>
            <h2 id="surah-end-title">{t.reelsSurahDone} <span className="nowrap">{session.surah.name_en}</span></h2>
            <p>{t.reelsSurahMeta(session.surah.ayahs, reciterName(session.reciter))}</p>
          </div>
          {nextSurah && (
            <div className="surah-end-next">
              <span className="surah-end-count" aria-hidden="true">{endCount}</span>
              <span className="surah-end-next-text" aria-live="polite">
                <span>{t.reelsSurahNextIn(endCount)}</span>
                <strong>{nextSurah.name_en}</strong>
                <span>{t.surahAyahs(nextSurah.ayahs)}</span>
              </span>
              <span className="surah-end-ar small" dir="rtl" lang="ar">{nextSurah.name_ar}</span>
            </div>
          )}
          <div className="surah-end-actions">
            {nextSurah && <button type="button" className="surah-end-play" onClick={() => playSurah(nextSurah.n)}><PlayIcon />{t.reelsSurahPlayNow(nextSurah.name_en)}</button>}
            <button type="button" className="surah-end-again" onClick={() => playSurah(session.surah.n)}>{t.reelsSurahAgain(session.surah.name_en)}</button>
            <button type="button" className="surah-end-stop" onClick={leaveSurah}>{t.reelsSurahStop}</button>
          </div>
        </div>
      )}
      <audio ref={audio} preload="auto" />
    </div>
  );
}

/** One reel's live picture: the clip, the glass, the canvas text layer and its timeline. While it is the reel on
 *  screen it drives the shared recitation player: each ayah's recitation in turn, then a short pause, then again.
 *  `drawn`: its canvas has pixels (the reel on screen and its neighbours, the only ones a swipe can show: at the
 *  screen's density each canvas is about 10 MB, so the others keep none until they come near).
 *  For Discover's stories: `onEnd` is called once at the end (after the tail) instead of playing again, `onProgress`
 *  gets how far it is (0..1) on every frame, and `onBlocked` is called when the browser refuses the sound (the
 *  recitation then plays muted). When the reel's audio changes while it plays (the translation voice switched), it
 *  starts again from the ayah being heard. */
export function ReelMedia({ reel, prepared, size: [W, H], scale, active, drawn, paused, sound, audio, scrolling, onTap, onLength, onEnd, onProgress, onBlocked, onAyah }: {
  reel: Reel; prepared: Prepared | null; size: [number, number]; scale: number; active: boolean; drawn: boolean; paused: boolean; sound: boolean;
  audio: React.RefObject<HTMLAudioElement | null>; scrolling: React.RefObject<boolean>; onTap: () => void; onLength: (s: number) => void;
  onEnd?: () => void; onProgress?: (f: number) => void; onBlocked?: () => void;
  /** The ayah (its number in the surah) whose recitation starts, also within a reel of two or more ayahs (a whole surah). */
  onAyah?: (ayah: number) => void;
}) {
  const r = reel.recipe;
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLElement>(null);
  const layers = prepared?.layers && prepared.size[0] === W && prepared.size[1] === H ? prepared.layers : null;
  const ayahs = prepared?.ayahs ?? null;
  const clip = prepared?.clip ?? (r.bg.type === "clip" ? api.clipById(r.bg.id) : null);
  const p = useRef(prepared);
  p.current = prepared;

  // The clip: the in-memory copy when it is ready before the reel plays, else streamed. Chosen once per mount.
  const src = useRef<string | undefined>(undefined);
  if (!src.current && clip) {
    if (prepared?.video) src.current = prepared.video;
    else if (active) src.current = reelClipUrl(clip);
  }
  const poster = clip ? reelPosterUrl(clip) : undefined;

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const calls = useRef({ onEnd, onProgress, onBlocked, onAyah });
  calls.current = { onEnd, onProgress, onBlocked, onAyah };
  /** The tracks playing and the ayah being heard, so a change of audio goes on from that ayah. */
  const hearing = useRef<{ tracks: Track[]; ayah: number } | null>(null);
  // When this reel came on screen, and whether it was fully prepared then (time to play, for the checks).
  const activation = useRef<{ t: number; warm: boolean } | null>(null);
  useEffect(() => { activation.current = active ? { t: performance.now(), warm: !!p.current?.warm } : null; }, [active]);

  // The newest layers (a reel drawn with its poster's measurement is drawn again with its clip's): painting picks them
  // up without restarting the reel.
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const paint = useCallback((timing: Timing | null, time: number) => {
    const ctx = canvas.current?.getContext("2d"), l = layersRef.current;
    if (!ctx || !l) return;
    ctx.clearRect(0, 0, W, H);
    composeText(ctx, l, timing, time, 0);
  }, [W, H]);

  // The reel's animation (rise and zoom play as a fade for people who reduce motion).
  const animation = calmer(r.animation ?? "none", reducedMotion());
  /** The reel's audio in playing order: each ayah's recitation, then its translation voice when the reel has one. */
  const tracks = useMemo(() => audioTracks(r, numsOf(r)), [r]);
  /** The timeline for these recording lengths: each ayah in turn (through its voice), the last one through the tail. */
  const timeline = (d: number[]) => trackTiming(tracks, d, numsOf(r).length, animation, TAIL_SECONDS);

  // Not playing: the reel as it starts (the header and box; the text comes in with the recitation).
  useEffect(() => {
    if (bar.current) bar.current.style.transform = "scaleX(0)";
    if (active || !drawn || !layers || !ayahs) return;
    paint(timeline(tracks.map((tk) => estimateTrack(tk, ayahs))).timing, 0);
  }, [active, drawn, layers, ayahs, paint, animation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Playing: background, recitation (and translation voice) and the text timeline.
  useEffect(() => {
    const v = video.current, a = audio.current;
    if (!active) { v?.pause(); hearing.current = null; return; }
    if (v && !pausedRef.current) void v.play().catch(() => {});
    if (!layers || !ayahs) return;
    const n = tracks.length;
    const was = hearing.current;
    const first = was && was.tracks !== tracks ? Math.max(0, tracks.findIndex((tk) => tk.ayah === was.ayah)) : 0;
    let ended = false;
    const known: number[] = [];
    const durations = () => tracks.map((tk, k) => p.current?.durations[k] || known[k] || estimateTrack(tk, ayahs));
    let k = 0, mode: "audio" | "clock" = "audio", clock0 = performance.now(), pausedAt = 0, tail = 0, raf = 0, alive = true;
    let audioOn = false, videoOn = !v || !clip, played = false, endTimer = 0;
    const since = activation.current;

    const report = () => {
      if (played || !since || !audioOn || !videoOn) return;
      played = true;
      const ms = Math.round(performance.now() - since.t);
      reelTimings.push({ ref: reel.item.ref, warm: since.warm, ms });
      if (reelTimings.length > 50) reelTimings.shift();
      try { performance.measure("qd-reel", { start: since.t, end: performance.now(), detail: { ref: reel.item.ref, warm: since.warm, ms } }); } catch { /* old browsers */ }
    };
    const onVideo = () => { videoOn = true; report(); };
    v?.addEventListener("playing", onVideo);
    if (v && !v.paused && v.readyState >= 3) videoOn = true;

    const srcFor = (i: number) => p.current?.audio[i] ?? tracks[i].url;
    function playTrack(i: number) {
      k = i; tail = 0; clock0 = performance.now();
      hearing.current = { tracks, ayah: tracks[i].ayah };
      calls.current.onAyah?.(r.from + tracks[i].ayah);
      if (!a) { mode = "clock"; audioOn = true; report(); return; }
      mode = "audio";
      a.src = srcFor(i);
      a.muted = !soundRef.current;
      if (pausedRef.current) return;
      a.play().then(() => { audioOn = true; if (!a.muted) noteSoundHeard(); report(); }, (err: unknown) => {
        if (!alive) return;
        mode = "clock"; clock0 = performance.now(); audioOn = true; report(); // the text keeps time meanwhile
        // Only a refusal (no tap yet) turns the sound off for this reel; a play cut short by the next load or a pause is
        // not one: it is just tried again (the sound stays as the person chose).
        const refused = (err as { name?: string } | null)?.name === "NotAllowedError";
        if (refused && !a.muted && calls.current.onBlocked) { a.muted = true; calls.current.onBlocked(); void a.play().catch(() => {}); }
        else if (!refused && a.paused && !pausedRef.current) void a.play().catch(() => {});
      });
    }
    const advance = () => {
      if (!alive) return;
      if (k < n - 1) playTrack(k + 1);
      else {
        tail = performance.now();
        onLength(timeline(durations()).total + TAIL_SECONDS);
        // With the screen off (a whole surah, surah.ts) no frames are drawn, so the end comes from a timer instead.
        if (calls.current.onEnd) {
          clearInterval(endTimer);
          endTimer = window.setInterval(() => {
            if (!alive || ended) return clearInterval(endTimer);
            if (pausedRef.current || document.visibilityState !== "hidden" || performance.now() - tail < TAIL_SECONDS * 1000) return;
            ended = true;
            clearInterval(endTimer);
            calls.current.onEnd?.();
          }, 250);
        }
      }
    };
    const onEnded = () => { if (mode === "audio") advance(); };
    const onMeta = () => { if (a && Number.isFinite(a.duration)) known[k] = a.duration; };
    // The recitation started later (sound turned on after the browser refused to play it): it keeps the time again.
    const onPlaying = () => { if (a && !a.muted) noteSoundHeard(); if (mode === "clock" && !tail) { mode = "audio"; } };
    a?.addEventListener("ended", onEnded);
    a?.addEventListener("loadedmetadata", onMeta);
    a?.addEventListener("playing", onPlaying);
    playTrack(first);
    onLength(timeline(durations()).total + TAIL_SECONDS);

    const tick = () => {
      if (!alive) return;
      const now = performance.now(), d = durations(), { timing, at, total } = timeline(d);
      let time: number;
      if (pausedRef.current) {
        if (!pausedAt) pausedAt = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (pausedAt) { clock0 += now - pausedAt; if (tail) tail += now - pausedAt; pausedAt = 0; }
      if (tail) {
        const over = now - tail >= TAIL_SECONDS * 1000;
        if (over && calls.current.onEnd) { // a story: once, then it holds its last frame
          time = total + TAIL_SECONDS;
          if (!ended) { ended = true; calls.current.onEnd(); }
        } else if (over) { playTrack(0); time = 0; } // and again, like a reel
        else time = total + (now - tail) / 1000;
      } else if (mode === "audio" && a) {
        time = at[k] + Math.min(a.currentTime || 0, d[k]);
      } else {
        const el = (now - clock0) / 1000;
        if (el >= d[k]) advance();
        time = at[k] + Math.min(el, d[k]);
      }
      // The picture holds still while the reels are being scrolled (the frame of the next reel is what moves in).
      if (!scrolling.current) {
        paint(timing, time);
        const f = Math.max(0, Math.min(1, time / (timing.end || 1)));
        if (bar.current) bar.current.style.transform = `scaleX(${f})`;
        calls.current.onProgress?.(f);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(endTimer);
      v?.removeEventListener("playing", onVideo);
      a?.removeEventListener("ended", onEnded);
      a?.removeEventListener("loadedmetadata", onMeta);
      a?.removeEventListener("playing", onPlaying);
      a?.pause();
    };
  }, [active, !!layers, ayahs, tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1080p while watching: once this reel has been the one on screen for HD_AFTER_MS on a good connection (reels.ts
  // canUpgrade) and has all its own media in memory (so the 1080p download never competes with it or a slow network), its
  // 1080p file loads in a hidden video and takes over on its first frame (reels.ts upgradeVideo); from then on `video`
  // is that element. Swiping away first cancels the load; a failure, or no take-over within HD_STALL_MS, keeps the 720p
  // one. Leaving the screen lets the 1080p video go and puts the 720p one back (with its poster), so a reel scrolled
  // back to never shows an empty frame. Auto contrast keeps measuring the 720p file or the poster (reels.ts).
  const hdVideo = useRef<HTMLVideoElement | null>(null);
  const hdUrl = clip ? reelHdUrl(clip) : null;
  /** The reel's own <video> (React's), which the 1080p one replaces while it plays. */
  const base = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback((el: HTMLVideoElement | null) => { base.current = el; if (!hdVideo.current) video.current = el; }, []);
  useEffect(() => {
    if (!active || !hdUrl || hdVideo.current) return;
    const ctl = new AbortController();
    let stall = 0;
    const timer = setTimeout(() => {
      const v = video.current;
      if (!v || !v.getAttribute("src") || !p.current?.warm || !canUpgrade()) return;
      stall = window.setTimeout(() => ctl.abort(), HD_STALL_MS);
      upgradeVideo(v, hdUrl, ctl.signal).then((el) => { clearTimeout(stall); hdVideo.current = el; video.current = el; }, () => clearTimeout(stall));
    }, HD_AFTER_MS);
    return () => { clearTimeout(timer); clearTimeout(stall); ctl.abort(); };
  }, [active, hdUrl]);
  /** Lets the 1080p video go (not React's: it is removed by hand) and shows the reel's own video again. */
  const dropHd = useCallback(() => {
    const el = hdVideo.current, v = base.current;
    if (!el) return;
    hdVideo.current = null;
    el.pause();
    el.removeAttribute("src");
    el.load();
    el.remove();
    video.current = v;
    if (v) {
      v.style.visibility = "";
      if (src.current && !v.getAttribute("src")) v.src = src.current;
    }
  }, []);
  useEffect(() => { if (!active) dropHd(); }, [active, dropHd]);
  useEffect(() => dropHd, [dropHd]);

  // Pause and resume the reel on screen.
  useEffect(() => {
    if (!active) return;
    const v = video.current, a = audio.current;
    if (paused) { v?.pause(); a?.pause(); return; }
    void v?.play().catch(() => {});
    if (a && a.getAttribute("src") && a.paused && !a.ended) void a.play().catch(() => {});
  }, [paused, active, audio]);

  // Tap: sound on, then pause / resume. A vertical drag is the scroll, not a tap.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => { if (e.button === 0) down.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (d && Math.abs(e.clientX - d.x) < 10 && Math.abs(e.clientY - d.y) < 10) onTap();
  };

  const box = layers?.plan.box;
  const glass = !!(layers && box && clip && layers.plan.blur && scale);
  const pct = (n: number) => `${n * 100}%`;
  const label = ayahs?.[0] ? `${ayahs[0].ar} ${ayahs[0].tr}` : t.loadingAyahs;
  return (
    <div className="reel-frame" style={{ background: r.bg.type === "colour" ? r.bg.colour : "#000" }}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (down.current = null)}>
      {clip && <video ref={setVideo} muted loop playsInline preload="auto" src={src.current} poster={poster} />}
      {glass && (
        <div className="glass" aria-hidden="true" style={{
          left: pct(box!.x / W), top: pct(box!.y / H), width: pct(box!.w / W), height: pct(box!.h / H),
          borderRadius: box!.radius * scale, "--blur": `${layers!.plan.blur * scale}px`,
        } as CSSProperties} />
      )}
      <canvas ref={canvas} width={drawn || active ? W : 0} height={drawn || active ? H : 0} role="img" aria-label={label} />
      {!layers && <div className="loading"><span className="spinner" /></div>}
      <div className="reel-progress" aria-hidden="true"><i ref={bar} /></div>
    </div>
  );
}
