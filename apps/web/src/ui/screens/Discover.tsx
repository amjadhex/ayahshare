// Discover opens on BROWSE (owner, 9 Oct 2026): the round story circles (topics for today), the ayah of the day, the most
// shared ayahs, "Watch and listen", short ayahs for a status, and collections. Tapping a circle plays its stories full
// screen (Stories.tsx: live reels, tap for the next or previous, swipe, hold to pause, a bar per story), then the next
// circles' stories, like Instagram. Closing them (×, swipe down, Back: they are a history entry, router "stories") goes
// back to Browse where it was. Tapping the Discover tab again scrolls Browse to the top. Everything is chosen on the device (src/discover.ts, feed.ts) from the topic
// lists and, for the counts, the anonymous stats (stats.ts); a count the server does not have is simply not shown.
// Nothing loads until the screen is first shown, and it loads again when shown after a while. Content column on larger
// screens, horizontal rows on phones.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AyahStats, Ref, Topic } from "../../../../../contracts/types";
import { toast } from "../../actions";
import * as api from "../../api";
import { translationLang } from "../../design";
import { backgroundFor, backgroundsFor, loadShortAyahs, refsOfChip, seeded, type DayAyah, type Picked } from "../../discover";
import { dayAyah, openToday, watchedToday } from "../../today";
import { createMixer, fixedReciter, reelFor, startReelsAt, type Reason, type ReelStart } from "../../feed";
import { onRetap, openSearch, setStoriesPlaying } from "../../nav";
import { defaultTranslation } from "../../prefs";
import { closeSheet, navigate, openSheet } from "../../router";
import { MAX_AYAHS } from "../../config";
import { openSurah, POPULAR_SURAHS, surahProgress } from "../../surah";
import { parseRef } from "../../search";
import { loadSignals } from "../../signals";
import { ayahStats, mostShared } from "../../stats";
import { t } from "../../strings";
import { chipOf, pickChips, pickCollections, TOPICS } from "../../topics";
import { lingerProps, warmReel } from "../../warm";
import { markCircleSeen, orderCircles, seenCircles } from "../../seenStories";
import { registerTile, setTilesActive } from "../../tilePlay";
import { reducedMotion, useAppState, useRoute, useStore } from "../hooks";
import { NextIcon, PlayIcon, SearchIcon, SendIcon } from "../icons";
import { MadeBy } from "../MadeBy";
import { Stories, type StoryItem } from "./Stories";
import "./discover.css";

/** Shown again after this long away (the day's counts and the reels strip move on). */
const REFRESH_MS = 10 * 60_000;
const STORIES = 7, STRIP = 8, RANKED = 5, SHORT_TILES = 6;
/** Stories per circle (a circle for a passage, like Friday's 18:1-10, plays the whole passage, up to 3 ayahs a story). */
const PER_CIRCLE = 3;
/** Collections: topic chips (topics.ts) picked for the moment (topics.ts pickCollections), each running its search. */
const COLLECTIONS = 10;

const parse = (ref: Ref) => ref.split(":").map(Number) as [number, number];

type Status = "idle" | "loading" | "ready" | "failed";
/** Runs `load` when `enabled` and again when `deps` change. The last answer stays while the next one loads. */
function useAsync<T>(enabled: boolean, load: () => Promise<T>, deps: unknown[]): [T | null, Status] {
  const [state, setState] = useState<{ value: T | null; status: Status }>({ value: null, status: "idle" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => (s.status === "ready" ? s : { value: s.value, status: "loading" }));
    load().then((value) => live && setState({ value, status: "ready" }), () => live && setState((s) => ({ value: s.value, status: s.value ? "ready" : "failed" })));
    return () => { live = false; };
  }, [enabled, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state.value, state.status];
}

/** A picture for a background: the clip's thumbnail (or poster, for big cards), or the plain colour. `eager`: on the
 *  first screen (loaded at once, first); the others load as they come near. `moving`: the clip's small preview plays
 *  over the picture while it is well in view (tilePlay.ts, as Results' tiles; a few at a time). */
function Pic({ picked, poster, eager, moving }: { picked: Picked | null; poster?: boolean; eager?: boolean; moving?: boolean }) {
  const box = useRef<HTMLSpanElement>(null), video = useRef<HTMLVideoElement>(null);
  const preview = moving && picked?.bg.type === "clip" && picked.clip?.preview ? api.mediaUrl(picked.clip.preview) : null;
  useEffect(() => (preview && box.current && video.current ? registerTile(box.current, video.current, preview, "discover") : undefined), [preview]);
  if (!picked) return <span className="disc-thumb" aria-hidden="true" />;
  if (picked.bg.type === "colour" || !picked.clip) return <span className="disc-thumb" aria-hidden="true" style={{ background: picked.bg.type === "colour" ? picked.bg.colour : undefined }} />;
  const src = api.mediaUrl(poster ? picked.clip.poster.portrait : picked.clip.thumb);
  return (
    <span className="disc-thumb" aria-hidden="true" ref={box}>
      <img src={src} alt="" loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} decoding="async" />
      {preview && <video ref={video} muted loop playsInline preload="none" disablePictureInPicture tabIndex={-1} />}
    </span>
  );
}

/** The background of an ayah (the one the editor opens with). */
function RefPic({ of, eager, moving }: { of: Ref | undefined; eager?: boolean; moving?: boolean }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    if (!of) return;
    let live = true;
    backgroundFor(of).then((p) => live && setPicked(p), () => {});
    return () => { live = false; };
  }, [of]);
  return <Pic picked={picked} eager={eager} moving={moving} />;
}

interface Base { topics: Topic[]; trending: Ref[]; now: Date; at: number }

export function Discover({ active }: { active: boolean }) {
  const store = useStore();
  const { ready, lang, surahs, editions, prefs, favourites, interests } = useAppState();
  const translation = defaultTranslation(prefs, lang);
  const surahName = (ref: Ref) => surahs[parse(ref)[0] - 1]?.name_en ?? "";

  // ---------- the topic lists: loaded when the screen is first shown, and again after a while ----------
  const [base, setBase] = useState<Base | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef<Base | null>(null);
  loaded.current = base;
  useEffect(() => {
    if (!active || !ready) return;
    if (loaded.current && Date.now() - loaded.current.at < REFRESH_MS) return;
    let live = true;
    setFailed(false);
    Promise.all([api.getTopics(), api.getTrending()]).then(
      ([file, trending]) => live && setBase({ topics: file.topics, trending, now: new Date(), at: Date.now() }),
      () => live && setFailed(true),
    );
    return () => { live = false; };
  }, [active, ready, attempt]);
  const on = !!base;
  const topics = base?.topics ?? [];

  // ---------- stories and collections: topic chips; their pictures come from each topic's best ayah ----------
  // Like Instagram (owner, 12 Oct 2026): circles not watched yet come first; a watched one turns grey and moves to the
  // back, and a new topic takes its place in front (twice as many are picked as shown). Watched = a story of it was shown.
  // The pick holds for the hour (seeded by it), so coming back from the stories shows the same circles, not new ones.
  const [seen, setSeen] = useState(() => seenCircles());
  const candidates = useMemo(() => (base
    ? pickChips(base.now, lang, STORIES * 2, seeded(Math.floor(base.now.getTime() / 3_600_000))).map((c) => ({ id: c.id }))
    : []), [base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) setSeen(seenCircles()); }, [active, base]);
  const storyIds = useMemo(() => orderCircles(candidates, seen, STORIES).map((c) => c.id), [candidates, seen]);
  const onSeen = useCallback((id: string) => { markCircleSeen(id); setSeen(seenCircles()); }, []);
  const collectionIds = useMemo(() => (base ? pickCollections(base.now, lang, COLLECTIONS, storyIds).map((c) => c.id) : []), [base, storyIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const chips = (ids: string[]) => ids.flatMap((id) => {
    const tp = TOPICS.find((x) => x.id === id);
    if (!tp) return [];
    const chip = chipOf(tp, lang);
    return [{ ...chip, pic: tp.ref ?? refsOfChip(id, topics)[0] }];
  });

  // ---------- ayah of the day ----------
  // The day's ayah as Home and the reminder have it (today.ts: the admin's pick, else the app's own).
  const [day, dayStatus] = useAsync<DayAyah | null>(on, () => dayAyah(base!.now, translation), [base, translation]);
  const [dayWeek] = useAsync<Map<Ref, AyahStats>>(!!day, () => ayahStats([day!.ref]), [day?.ref]);
  // Watched today already (from Home, here or the reminder: today.ts): the card's button says "Watch again".
  const [dayWatched, setDayWatched] = useState(watchedToday);
  useEffect(() => { if (active) setDayWatched(watchedToday()); }, [active]);

  // ---------- most shared today ----------
  const [ranking] = useAsync(on, async () => {
    const list = await mostShared(30, 1);
    const top = list.slice(0, RANKED);
    return { list, top, stats: top.length ? await ayahStats(top.map((x) => x.ref)) : new Map<Ref, AyahStats>() };
  }, [base]);

  // ---------- watch and listen: the next reels of this person's mix ----------
  const [strip, stripStatus] = useAsync(!!base, async () => {
    const mixer = createMixer({ topics, trending: base!.trending, now: base!.now, signals: loadSignals(), favourites, interests, mood: null });
    const items = Array.from({ length: STRIP }, () => mixer.next()).filter((x) => !!x);
    const picked = await backgroundsFor(items.map((i) => i.ref));
    return items.map((item, i) => ({ item, ...picked[i] }));
  }, [base]);

  // ---------- short ayahs for a status ----------
  const [short, shortStatus] = useAsync(on && surahs.length > 0, () => loadShortAyahs(topics, base!.trending, surahs, base!.now, SHORT_TILES), [base, surahs.length]);
  const tiles = short ? short.slice(0, short.length - (short.length % 3)) : [];

  // ---------- play a whole surah: where the person stopped, then the popular ones (surah.ts) ----------
  const progress = useMemo(() => surahProgress(), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const surahCards = useMemo(() => {
    const cards = surahs.length ? POPULAR_SURAHS.filter((n) => n !== progress?.surah).map((n) => ({ surah: surahs[n - 1], ayah: 0 })) : [];
    const mine = progress && surahs[progress.surah - 1];
    return (mine ? [{ surah: mine, ayah: Math.min(Math.max(1, progress.ayah), mine.ayahs) }, ...cards] : cards).filter((c) => !!c.surah);
  }, [surahs, progress]);

  // ---------- actions ----------
  /** Opens Reels on this strip, starting at reel `k` (the ones before it come after). */
  const openReels = (k: number) => {
    if (!strip?.length) return;
    startReelsAt(strip.map(({ item, bg }): ReelStart => ({ item, bg })), k);
  };
  /** Opens a list of ayahs (most shared, short ayahs) as reels from `k`, each with the background its picture shows. */
  const watch = (refs: Ref[], k: number, reason: Reason) =>
    void Promise.all(refs.map((ref) => backgroundFor(ref).then(({ bg }) => bg, () => undefined)))
      .then((bgs) => startReelsAt(refs.map((ref, i) => ({ item: reelFor(ref, reason, i), bg: bgs[i] })), k));

  const stories = chips(storyIds);
  const collections = chips(collectionIds);
  const todayShares = day ? ranking?.list.find((x) => x.ref === day.ref)?.shares ?? 0 : 0;
  const weekShares = day ? dayWeek?.get(day.ref)?.week ?? 0 : 0;
  const dayCount = todayShares > 0 ? t.sharedByToday(todayShares) : weekShares > 0 ? t.sharedByWeek(weekShares) : "";

  // ---------- stories: from the circle tapped, then the next circles ----------
  const route = useRoute();
  /** The circle the stories started at (null: Browse). They are open while their history entry is (router "stories",
   *  or a sheet opened over them, like Reflect); Back, ×, a swipe down or the end close them. */
  const [storyFrom, setStoryFrom] = useState<number | null>(null);
  const [storyItems, setStoryItems] = useState<StoryItem[] | null>(null);
  const playing = storyFrom !== null && route.view === "discover" && route.sheet !== null;
  useEffect(() => { if (storyFrom !== null && (route.view !== "discover" || !route.sheet)) setStoryFrom(null); }, [route, storyFrom]);
  useEffect(() => { setStoriesPlaying(playing); return () => setStoriesPlaying(false); }, [playing]);
  /** Browse's place, kept while the stories play (they fill the screen), and given back when they close. */
  const browseAt = useRef(0);
  const openStories = (k: number) => {
    browseAt.current = window.scrollY;
    setStoryItems(null);
    setStoryFrom(k);
    openSheet("stories");
  };
  const closeStories = useCallback(() => closeSheet(), []);
  const wasPlaying = useRef(false);
  useLayoutEffect(() => {
    if (playing) window.scrollTo(0, 0);
    else if (wasPlaying.current) window.scrollTo(0, browseAt.current);
    wasPlaying.current = playing;
  }, [playing]);
  // The circles' ayahs as stories, with the backgrounds their pictures show.
  useEffect(() => {
    if (storyFrom === null) return;
    let live = true;
    const plan = stories.slice(storyFrom).flatMap((c) => {
      const range = c.ref ? parseRef(c.ref) : null;
      const parts: [Ref, number | undefined][] = range
        ? Array.from({ length: Math.ceil((range.to - range.from + 1) / MAX_AYAHS) }, (_, i) => {
          const from = range.from + i * MAX_AYAHS;
          return [`${range.surah}:${from}`, Math.min(from + MAX_AYAHS - 1, range.to)] as [Ref, number];
        })
        : refsOfChip(c.id, topics).slice(0, PER_CIRCLE).map((ref) => [ref, undefined] as [Ref, undefined]);
      return parts.map(([ref, to]) => ({ ref, to, circle: c.id }));
    });
    backgroundsFor(plan.map((p) => p.ref)).then(
      (picked) => live && setStoryItems(plan.map((p, j) => ({ item: reelFor(p.ref, { kind: "mood", mood: p.circle }, j, p.to), bg: picked[j].bg, group: p.circle }))),
      () => live && setStoryItems([]),
    );
    return () => { live = false; };
  }, [storyFrom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (playing && storyItems && !storyItems.length) closeStories(); }, [playing, storyItems, closeStories]);
  // The moving pictures play only while Browse is the screen shown.
  useEffect(() => { setTilesActive(active && !playing, "discover"); }, [active, playing]);
  useEffect(() => () => setTilesActive(false, "discover"), []);
  // The Discover tab tapped again: Browse from the top (never the stories).
  useEffect(() => onRetap((tab) => {
    if (tab !== "discover" || !active) return;
    browseAt.current = 0;
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  }), [active]);

  if (playing) {
    return (
      <div className="disc disc-playing" data-active={active || undefined}>
        <h1 className="sr-only">{t.discoverTitle}</h1>
        <Stories active={active} items={storyItems} onClose={closeStories} onSeen={onSeen} />
      </div>
    );
  }

  return (
    <div className="disc" data-active={active || undefined}>
      <header className="disc-head">
        <h1>{t.discoverTitle}</h1>
        <button type="button" className="disc-icon" aria-label={t.searchLabel} onClick={() => navigate("find")}><SearchIcon /></button>
      </header>

      {failed && !base && (
        <p className="disc-note">{t.discoverFailed} <button type="button" className="btn small" onClick={() => setAttempt((n) => n + 1)}>{t.retry}</button></p>
      )}
      {!base && !failed && <p className="disc-note" role="status"><span className="spinner small" /> {t.discoverLoading}</p>}

      {base && (
        <>
          {stories.length > 0 && (
            <ul className="disc-stories" aria-label={t.discoverTopics}>
              {stories.map((s, k) => (
                <li key={s.id}>
                  <button type="button" className="disc-story" data-seen={seen.has(s.id) || undefined} onClick={() => openStories(k)}>
                    <span className="disc-ring"><RefPic of={s.pic} eager /></span>
                    <span className="disc-story-label" dir="auto" lang={s.lang}>{s.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Ayah of the day */}
          {!day && dayStatus !== "ready" && dayStatus !== "failed" && <div className="disc-skel disc-aotd-skel" aria-hidden="true" />}
          {day && (
            <section className="disc-aotd" aria-label={t.ayahOfTheDay}>
              <Pic picked={{ bg: day.bg, clip: day.clip, sensitive: false }} poster eager moving />
              <span className="disc-scrim" aria-hidden="true" />
              <span className="disc-badge">{t.ayahOfTheDay}</span>
              <div className="disc-aotd-body">
                <p className="disc-ar" dir="rtl" lang="ar">{day.ar}</p>
                {day.tr && <p className="disc-tr" dir="auto" lang={translationLang(translation, editions)}>{day.tr}</p>}
                {dayCount && <p className="disc-pill"><SendIcon />{dayCount}</p>}
                <div className="disc-aotd-foot">
                  <span>{surahName(day.ref)} · {day.ref}</span>
                  {/* View (owner, 12 Oct 2026), not Create: the day's ayah opens as Home's "Watch today's ayah" does. */}
                  <button type="button" className="disc-create" aria-label={t.watchAyah(surahName(day.ref), day.ref)}
                    onClick={() => void openToday(translation, "discover").then((ok) => { if (ok) setDayWatched(true); else toast(store, t.todayFailed); })}>
                    {dayWatched ? t.watchAgain : t.view}</button>
                </div>
              </div>
            </section>
          )}

          {/* Play a whole surah */}
          {surahCards.length > 0 && (
            <section aria-labelledby="disc-surahs">
              <div className="disc-h-row">
                <h2 className="disc-h" id="disc-surahs">{t.playWholeSurah}</h2>
                <button type="button" className="disc-pill-btn" onClick={() => navigate("surahs")}>{t.allSurahs}</button>
              </div>
              <p className="disc-sub">{t.playSurahSub}</p>
              <ul className="disc-strip disc-surahs">
                {surahCards.map(({ surah, ayah }) => (
                  <li key={surah.n}>
                    <button type="button" className="disc-surah" aria-label={ayah ? t.surahContinueLabel(surah.name_en, ayah) : t.surahPlayLabel(surah.name_en)}
                      onClick={() => void openSurah(surah, { own: fixedReciter(prefs) ?? prefs.reciter })}>
                      <RefPic of={`${surah.n}:1`} />
                      <span className="disc-tile-scrim" aria-hidden="true" />
                      {ayah > 0 && <span className="disc-surah-chip" aria-hidden="true"><PlayIcon />{t.surahContinue}</span>}
                      <span className="disc-surah-text">
                        <span className="disc-surah-ar" dir="rtl" lang="ar">{surah.name_ar}</span>
                        <strong>{surah.name_en}</strong>
                        <span>{ayah ? t.surahAyahOf(ayah, surah.ayahs) : t.surahAyahs(surah.ayahs)}</span>
                      </span>
                      {ayah > 0 && <span className="disc-surah-bar" aria-hidden="true"><i style={{ width: `${(ayah / surah.ayahs) * 100}%` }} /></span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Most shared today: hidden when the server has nothing */}
          {ranking && ranking.top.length > 0 && (
            <section aria-labelledby="disc-ranked">
              <h2 className="disc-h" id="disc-ranked">{t.mostSharedToday}</h2>
              <p className="disc-sub">{t.countedWithoutNames}</p>
              <ol className="disc-ranked">
                {ranking.top.map((r, i) => {
                  const makes = ranking.stats.get(r.ref)?.makes ?? 0;
                  return (
                    <li key={r.ref}>
                      <button type="button" onClick={() => watch(ranking.top.map((x) => x.ref), i, { kind: "popular" })}>
                        <span className="disc-rank" aria-hidden="true">{i + 1}</span>
                        <span className="disc-mini"><RefPic of={r.ref} /></span>
                        <span className="disc-ranked-text">
                          <strong>{surahName(r.ref)} · {r.ref}</strong>
                          <span><SendIcon />{[r.shares > 0 ? t.shareCount(r.shares) : "", makes > 0 ? t.madeTheirOwn(makes) : ""].filter(Boolean).join(" · ")}</span>
                        </span>
                        <NextIcon />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* Watch and listen */}
          {stripStatus !== "failed" && (strip === null || strip.length > 0) && (
            <section aria-labelledby="disc-watch">
              <div className="disc-h-row">
                <h2 className="disc-h" id="disc-watch">{t.watchAndListen}</h2>
                <button type="button" className="disc-pill-btn" disabled={!strip?.length} onClick={() => openReels(0)}>{t.openReels}</button>
              </div>
              <ul className="disc-strip" aria-busy={!strip}>
                {strip
                  ? strip.map((s, k) => (
                    <li key={s.item.key}>
                      <button type="button" className="disc-reel" aria-label={t.reelLabel(surahName(s.item.ref), s.item.ref)} onClick={() => openReels(k)}
                        {...lingerProps(() => warmReel(s.item.ref, { bg: s.bg, prefs, lang }))}>
                        <Pic picked={s} moving />
                        <span className="disc-reel-play" aria-hidden="true"><PlayIcon /></span>
                        <span className="disc-reel-label">{surahName(s.item.ref)} {s.item.ref}</span>
                      </button>
                    </li>
                  ))
                  : Array.from({ length: 4 }, (_, i) => <li key={i}><div className="disc-skel disc-reel" aria-hidden="true" /></li>)}
              </ul>
            </section>
          )}

          {/* Short ayahs for your status */}
          {shortStatus !== "failed" && (short === null || tiles.length > 0) && (
            <section aria-labelledby="disc-short">
              <h2 className="disc-h" id="disc-short">{t.shortAyahs}</h2>
              <ul className="disc-tiles" aria-busy={!short}>
                {short
                  ? tiles.map((s, k) => (
                    <li key={s.ref}>
                      <button type="button" className="disc-tile" aria-label={t.watchAyah(surahName(s.ref), s.ref)}
                        onClick={() => watch(tiles.map((x) => x.ref), k, { kind: "discover" })}>
                        <RefPic of={s.ref} moving />
                        <span className="disc-tile-scrim" aria-hidden="true" />
                        <span className="disc-tile-ar" dir="rtl" lang="ar">{s.ar}</span>
                        <span className="disc-tile-ref">{s.ref}</span>
                      </button>
                    </li>
                  ))
                  : Array.from({ length: 6 }, (_, i) => <li key={i}><div className="disc-skel disc-tile" aria-hidden="true" /></li>)}
              </ul>
            </section>
          )}

          {/* Collections */}
          {collections.length > 0 && (
            <section aria-labelledby="disc-collections">
              <h2 className="disc-h" id="disc-collections">{t.collections}</h2>
              <ul className="disc-collections">
                {collections.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="disc-collection" onClick={() => openSearch(c.q)}>
                      <RefPic of={c.pic} />
                      <span className="disc-collection-scrim" aria-hidden="true" />
                      <span className="disc-collection-text">
                        <strong dir="auto" lang={c.lang}>{c.label}</strong>
                        {c.pic && <span>{surahName(c.pic)} {c.pic}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <MadeBy className="screen-credit" />
    </div>
  );
}
