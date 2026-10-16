// Discover's stories (owner, 9 Oct 2026): played from a story circle on Discover, like Instagram Stories. Each story is a live reel, the
// same as in Reels (Feed.tsx ReelMedia: the clip, the canvas text layer and the recitation; nothing is encoded), prepared
// the same way (reels.ts: the one on screen and the next two in memory, the third lightly). A bar per story on top fills
// as it plays (the bars are the current circle's, `group`); at the end of its ayah (after the tail) the next one starts,
// then the next circle's. Tap the right half for the next story, the left half for the one before; hold to pause; swipe
// sideways to move, down (or ×, or Back) to close (to Browse, the rest of Discover).
// On a computer: a phone-sized frame in the middle with arrows beside it, and ← / → / Space. Each story keeps the reel's
// actions: Like (favourite), Share and Download (the MP4 made on the device), Reflect and Customize. Sound is on unless
// the person muted reels (reels.ts storedMuted); when the browser refuses it, the story plays muted with "Tap for sound".
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Recipe } from "../../../../../contracts/types";
import { openReflect, toggleFavourite } from "../../actions";
import { track } from "../../analytics";
import { designProps, translationLang } from "../../design";
import type { ExportScene } from "../../export";
import type { FeedItem } from "../../feed";
import { hdFor } from "../../prefs";
import { buildReels, createReelCache, newReelMix, preloadPlan, reelCanvasSize, saveData, noteSoundHeard, soundHeard, storedMuted, storeMuted, unlockOnGesture, withFeedVoice, type Reel, type ReelCache } from "../../reels";
import { recordSeen } from "../../signals";
import { closeSheet, getRoute, navigate, openSheet } from "../../router";
import { t } from "../../strings";
import { useExport } from "../exportJob";
import { FormatSheet, useFormatChoice, type Format, type Shape } from "../FormatSheet";
import { ReelMedia, reasonText, reciterName, storyInset, useBox } from "../Feed";
import { reducedMotion, useAppState, useRoute, useStore } from "../hooks";
import { CloseIcon, DownloadIcon, EditIcon, HeartIcon, NextIcon, PrevIcon, ReflectIcon, SendIcon, SoundOffIcon, SoundOnIcon, WaveIcon } from "../icons";
import "./stories.css";

/** Held this long, a press pauses the story instead of moving on. */
const HOLD_MS = 280;
/** A swipe: at least this far (px). */
const SWIPE = 48;

/** `group`: the story circle it belongs to (the bars on top count the stories of one circle). */
export interface StoryItem { item: FeedItem; bg: Recipe["bg"]; group?: string }

/** `active`: the stories are on screen (else nothing plays). `items`: the stories (null while loading). `onClose`: go to
 *  Browse (swiped down, the Browse chip, or after the last story). `onSeen`: a circle (`group`) had a story shown. */
export function Stories({ active, items, onClose, onSeen }: { active: boolean; items: StoryItem[] | null; onClose: () => void; onSeen?: (group: string) => void }) {
  const store = useStore();
  const { lang, surahs, editions, config, favourites, prefs, hd } = useAppState();
  const route = useRoute();
  const ex = useExport();
  const frame = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const bar = useRef<HTMLElement>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false); // Space on a computer
  const [sound, setSound] = useState(() => !storedMuted());
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  const [, setTick] = useState(0);
  const cache = useRef<ReelCache | null>(null);
  cache.current ??= createReelCache(() => setTick((n) => n + 1));
  useEffect(() => () => cache.current?.clear(), []);
  const scrolling = useRef(false); // stories never scroll; ReelMedia asks

  // ---------- the stories' designs (reels.ts buildReels, the backgrounds the thumbnails show) ----------
  const mix = useRef(newReelMix());
  useEffect(() => {
    if (!items?.length) return;
    let live = true;
    void buildReels(items.map((s) => s.item), mix.current, prefs, lang, new Map(items.map((s) => [s.item.key, s.bg]))).then((list) => {
      if (!live) return;
      cache.current!.clear();
      setReels(list);
      setIndex(0);
    }, () => {});
    return () => { live = false; };
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  // The translation voice switched (Reels or Profile): the stories follow in place.
  const feedVoice = !!prefs.feedVoice;
  useEffect(() => { setReels((old) => withFeedVoice(old, { ...prefs, feedVoice }, lang)); }, [feedVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- preparing: the same plan as Reels ----------
  const [cw, ch] = useBox(frame, active);
  const size = useMemo<[number, number]>(
    () => reelCanvasSize(cw, ch, window.devicePixelRatio || 1, (navigator as { deviceMemory?: number }).deviceMemory), [cw, ch]);
  const scene = useMemo(() => ({ surahs, editions, brand: config.appName, inset: storyInset(ch) }), [surahs, editions, config.appName, ch]);
  useEffect(() => {
    if (!reels.length || !surahs.length) return;
    const plan = preloadPlan(index, reels.length, saveData());
    cache.current!.sync(plan.map(({ i, level }) => ({ key: reels[i].item.key, recipe: reels[i].recipe, level })), size, scene);
  }, [index, reels, size, scene, surahs.length]);

  const n = reels.length;
  const current = active && n ? reels[index] : undefined;
  useEffect(() => { if (current) recordSeen([current.item.ref]); }, [current]);
  const group = current ? items?.find((s) => s.item.key === current.item.key)?.group : undefined;
  useEffect(() => { if (group) onSeen?.(group); }, [group]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (bar.current) bar.current.style.transform = "scaleX(0)"; }, [index]);

  // ---------- moving ----------
  const go = useCallback((i: number) => {
    setHeld(false);
    if (i < 0) return setIndex(0);
    if (i >= n) { onClose(); setIndex(0); return; } // after the last story: Browse (and from the start next time)
    setIndex(i);
  }, [n, onClose]);
  const next = () => go(index + 1);
  const prev = () => go(index - 1);
  const onEnd = useCallback(() => go(index + 1), [go, index]);
  const onProgress = useCallback((f: number) => { if (bar.current) bar.current.style.transform = `scaleX(${f})`; }, []);

  // ---------- sound: on unless muted here or in Reels; a refused sound waits for the first tap anywhere ----------
  function setSoundOn(on: boolean, remember = true) {
    const a = audio.current;
    setSound(on);
    blockedRef.current = false;
    setBlocked(false);
    if (remember) storeMuted(!on);
    // play() inside the tap even while it plays muted: Safari then lets this element play with sound on the next stories.
    if (a) { a.muted = !on; if (on && a.getAttribute("src")) void a.play().then(() => { if (!a.muted) noteSoundHeard(); }, () => {}); }
  }
  useEffect(() => { if (active) setSound(!storedMuted()); }, [active]);
  useEffect(() => unlockOnGesture(() => audio.current), []);
  // As on Reels: once sound has been heard this visit, a refused play keeps the person's choice (reels.ts soundHeard).
  const onBlocked = useCallback(() => { blockedRef.current = true; setBlocked(true); if (!soundHeard()) setSound(false); }, []);
  useEffect(() => {
    if (!blocked || !active) return;
    const on = () => { if (blockedRef.current) setSoundOn(true, false); };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  });
  useEffect(() => { if (!active) audio.current?.pause(); }, [active]);

  // ---------- touch: halves, hold, swipes ----------
  const down = useRef<{ x: number; y: number; at: number; timer: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const timer = window.setTimeout(() => setHeld(true), HOLD_MS);
    down.current = { x: e.clientX, y: e.clientY, at: performance.now(), timer };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (blockedRef.current) setSoundOn(true, false); // the first tap turns the refused sound on (and still moves on)
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (held) { setHeld(false); return; } // a hold pauses; letting go goes on
    if (dy > SWIPE && dy > Math.abs(dx)) { onClose(); return; }
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); return; }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientX - box.left >= box.width / 2) next(); else prev();
  };
  const onPointerCancel = () => { if (down.current) clearTimeout(down.current.timer); down.current = null; setHeld(false); };

  // ---------- keys (computer): ← / → for the stories, Space to pause, m for sound, Escape for Browse ----------
  useEffect(() => {
    if (!active || !n) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]")) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key;
      if (k === "ArrowRight") { if (!e.repeat) next(); }
      else if (k === "ArrowLeft") { if (!e.repeat) prev(); }
      else if (k === " " && !(el && el.closest("button, a"))) setStopped((s) => !s);
      else if (k === "m") setSoundOn(!sound);
      else if (k === "Escape") onClose();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }); // every render: it reads the current state

  // ---------- actions (as on a reel) ----------
  const sceneOf = (reel: Reel, purpose: "save" | "share"): ExportScene | null => {
    const p = cache.current!.get(reel.item.key), surah = surahs[reel.recipe.surah - 1];
    if (!p?.ayahs || !surah) return null;
    return { recipe: reel.recipe, surah, lang: translationLang(reel.recipe.translation, editions), brand: config.appName, ayahs: p.ayahs, current: 0, clip: p.clip, hd: hdFor(hd, purpose) };
  };
  const [via, setVia] = useState<"share" | "download">("share");
  /** Share or Download asks first: a video or an image (FormatSheet), over the stories (Back closes it, then them). */
  const format = useFormatChoice((reel: Reel, save: boolean, kind: Format, shape: Shape) => {
    const made = sceneOf(reel, save ? "save" : "share");
    if (!made) return;
    const s = { ...made, recipe: { ...made.recipe, orientation: shape } }; // the shape chosen (FormatSheet)
    setVia(save ? "download" : "share");
    if (kind === "image") void ex.image(s, reel.item.key, save ? { save: true } : undefined);
    else void ex.video(s, reel.item.key, save ? { save: true } : undefined);
  }, true);
  const share = (reel: Reel, save: boolean) => format.ask(reel, save);
  const edit = (reel: Reel) => {
    store.dispatch({ type: "recipe", recipe: structuredClone(reel.recipe) });
    track("ayah_select", { ...designProps(reel.recipe), source: "suggested" });
    navigate("create");
  };
  const reflect = (reel: Reel) => {
    openReflect(store, reel.item.ref, "feed");
    openSheet("reflect", true); // over the stories' own history entry: Back closes Reflect, then the stories
  };
  const job = ex.job;
  useEffect(() => { if (active && job.phase === "idle" && getRoute().sheet === "export") closeSheet(); }, [active, job.phase]);
  const exporting = job.phase === "busy" && job.kind === "video" ? job : null;

  // A sheet over the story (Reflect, Export) or a hold pauses it.
  const paused = held || stopped || (!!route.sheet && route.sheet !== "stories");
  // The bars count the current circle's stories.
  const groups = useMemo(() => new Map((items ?? []).map((s) => [s.item.key, s.group])), [items]);
  const groupOf = (k: number) => (reels[k] ? groups.get(reels[k].item.key) : undefined);
  const inGroup = reels.map((_, k) => k).filter((k) => groupOf(k) === groupOf(index));
  const calm = reducedMotion();

  if (!n) {
    return (
      <section className="stories" aria-label={t.storiesLabel} aria-busy="true">
        <div ref={frame} className="stories-frame">
          <p className="stories-note"><span className="spinner" /> {t.discoverLoading}</p>
          <div className="story-ui"><div className="story-head"><span className="story-title" /><button type="button" className="reels-mute story-close" aria-label={t.close} onClick={onClose}><CloseIcon /></button></div></div>
        </div>
        <audio ref={audio} preload="auto" />
      </section>
    );
  }

  return (
    <section className="stories" aria-label={t.storiesLabel} data-held={held || undefined} data-calm={calm || undefined}>
      <button type="button" className="story-arrow prev" aria-label={t.prevStory} disabled={index === 0} onClick={prev}><PrevIcon /></button>
      <div ref={frame} className="stories-frame">
        {reels.map((reel, i) => {
          if (Math.abs(i - index) > 1) return null; // the story on screen and its neighbours keep their media mounted
          const isCurrent = i === index;
          const surah = surahs[reel.recipe.surah - 1];
          const ref = reel.item.ref, shownRef = reel.item.to ? `${ref}–${reel.item.to}` : ref;
          const fav = favourites.includes(ref);
          const ready = !!cache.current!.get(reel.item.key)?.ayahs;
          const mine = exporting && exporting.source === reel.item.key ? exporting : null;
          const sharing = via === "share" ? mine : null, downloading = via === "download" ? mine : null;
          return (
            <article key={reel.item.key} className="story" data-current={isCurrent || undefined} aria-hidden={!isCurrent || undefined}
              aria-label={t.reelLabel(surah?.name_en ?? "", shownRef)} data-ref={ref}>
              <ReelMedia reel={reel} prepared={cache.current!.get(reel.item.key)} size={size} scale={cw / size[0]} active={active && isCurrent} drawn
                paused={paused} sound={sound} audio={audio} scrolling={scrolling} onTap={() => {}} onLength={() => {}}
                onEnd={isCurrent ? onEnd : undefined} onProgress={isCurrent ? onProgress : undefined} onBlocked={onBlocked} />
              {isCurrent && (
                <>
                  <div className="story-touch" aria-hidden="true" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
                    onContextMenu={(e) => e.preventDefault()} />
                  <div className="story-ui">
                    <div className="story-bars" aria-hidden="true">
                      {inGroup.map((k) => <span key={reels[k].item.key} data-state={k < index ? "done" : k > index ? "todo" : undefined}><i ref={k === index ? bar : undefined} /></span>)}
                    </div>
                    <p className="story-count">{t.storyOf(inGroup.indexOf(index) + 1, inGroup.length)}</p>
                    <div className="story-head">
                      <span className="reel-avatar" aria-hidden="true"><img src="/icons/icon.svg" alt="" /></span>
                      <div className="story-title">
                        <span className="reel-reason">{reasonText(reel.item.reason, lang)}</span>
                        <strong>{surah?.name_en} · {shownRef}</strong>
                      </div>
                      <button type="button" className="reels-mute" aria-label={sound ? t.soundOff : t.soundOn} onClick={() => setSoundOn(!sound)}>
                        {sound ? <SoundOnIcon /> : <SoundOffIcon />}
                      </button>
                      <button type="button" className="reels-mute story-close" aria-label={t.close} onClick={onClose}><CloseIcon /></button>
                    </div>
                    {blocked && <button type="button" className="sound-hint story-sound" onClick={() => setSoundOn(true, false)}><SoundOffIcon /> {t.tapForSound}</button>}
                    {stopped && <span className="paused-badge" aria-live="polite">{t.pausedReel}</span>}
                    <div className="reel-info">
                      <div className="reel-who">
                        <div className="reel-who-text">
                          <span className="reel-reciter"><WaveIcon /><span>{reciterName(reel.recipe.reciter)}</span></span>
                        </div>
                        <button type="button" className="reel-customize" aria-label={t.customizeReel(surah?.name_en ?? "", shownRef)} onClick={() => edit(reel)}>
                          <EditIcon /><span>{t.customize}</span></button>
                      </div>
                    </div>
                    <div className="reel-rail">
                      <button type="button" className="rail-btn like" aria-pressed={fav} aria-label={t.likeReel} onClick={() => void toggleFavourite(store, ref)}>
                        <HeartIcon /><span>{t.likeReel}</span></button>
                      <button type="button" className="rail-btn" aria-label={sharing ? sharing.label : t.shareReel} disabled={!!exporting || !ready} onClick={() => share(reel, false)}>
                        {sharing ? <span className="pct">{t.sharing(sharing.pct)}</span> : <SendIcon />}<span>{t.shareReel}</span></button>
                      <button type="button" className="rail-btn" aria-label={downloading ? downloading.label : t.downloadReel} disabled={!!exporting || !ready} onClick={() => share(reel, true)}>
                        {downloading ? <span className="pct">{t.sharing(downloading.pct)}</span> : <DownloadIcon />}<span>{t.downloadReel}</span></button>
                      <button type="button" className="rail-btn" aria-label={t.reflect} onClick={() => reflect(reel)}><ReflectIcon /><span>{t.reflect}</span></button>
                    </div>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
      <button type="button" className="story-arrow next" aria-label={t.nextStory} onClick={next}><NextIcon /></button>
      <p className="stories-hint muted small">{t.storiesHint}</p>
      <audio ref={audio} preload="auto" />
      <FormatSheet {...format.sheet} open={active && format.sheet.open} />
    </section>
  );
}
