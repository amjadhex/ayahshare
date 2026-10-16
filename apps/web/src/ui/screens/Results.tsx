// Results: the ayahs for what the person said, as a grid of thumbnails (each with its own suggested background), with a
// box to say more. Quick results show first; the refined order then reorders the same tiles in place (they slide to their
// new place, new tiles fade in; focus is kept). Once that order is final, nearing the end of the grid (or "Show more")
// adds the next page of a topic search below, until the search has no more. Tapping a tile opens all the results shown
// as reels from that one (watch and listen, swipe to the next, Customize to design it), each with its tile's background.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Clip, Ref } from "../../../../../contracts/types";
import { openReflect, openReport, toggleFavourite } from "../../actions";
import { track } from "../../analytics";
import { mediaUrl } from "../../api";
import { translationLang } from "../../design";
import { reelFor, startReelsAt, type ReelStart } from "../../feed";
import { openPicker, setQuery, type Search } from "../../nav";
import { assignClips, resultClips, resultText, type ResultText } from "../../results";
import { navigate, openSheet } from "../../router";
import { hitKey, hitOf, parseRef, progressiveSearch, referenceHits, searchPage, surahPage, type Hit } from "../../search";
import { recordSearch } from "../../signals";
import { ayahStats, formatCount } from "../../stats";
import { tileFrame, type TileFrame } from "../../tileFrame";
import { registerTile, setTilesActive } from "../../tilePlay";
import { lingerProps, warmReel } from "../../warm";
import { t } from "../../strings";
import { reducedMotion, useAppState, useSearch, useStore } from "../hooks";
import { ArrowUpIcon, BackIcon, HeartIcon, ReflectIcon, SearchIcon } from "../icons";
import { LanguageButton } from "../Language";
import { BrandLogo } from "./BrandLogo";
import "./results.css";

type Status = "idle" | "searching" | "shown" | "empty" | "failed";
/** `next`: the page that adds more tiles (null: none); `final`: page 1 has its last order, so pages can follow it. */
interface Found { status: Status; hits: Hit[]; id: number; q: string; next: number | null; final: boolean }
/** How many ayahs the results cover: a range (Friday's 18:1-10) comes as cards of up to 3 ayahs, and the count says 10
 *  ayahs, not 4 cards. */
export const ayahsCovered = (hits: Hit[]) => hits.reduce((n, h) => n + Math.max(1, h.to - +h.ref.split(":")[1] + 1), 0);
const none = (status: Status, id: number, q: string): Found => ({ status, hits: [], id, q, next: null, final: true });

const SKELETONS = 6;
/** Tiles on the first screen (two columns on a phone, more on a computer): their pictures load at once, first. */
const ABOVE_FOLD = 6;
const label = (h: Hit) => (h.to > +h.ref.split(":")[1] ? `${h.ref}–${h.to}` : h.ref);

/** A tile's Arabic and translation (the ayahs of a range joined), loaded on first show. */
function useHitText(hit: Hit, translation: string) {
  const [text, setText] = useState<ResultText | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    const [surah, from] = hit.ref.split(":").map(Number);
    Promise.all(Array.from({ length: hit.to - from + 1 }, (_, i) => resultText(`${surah}:${from + i}`, translation))).then(
      (parts) => alive && setText({ ar: parts.map((p) => p.ar).join(" "), tr: parts.every((p) => p.tr) ? parts.map((p) => p.tr).join(" ") : null }),
      () => alive && setText("failed"),
    );
    return () => { alive = false; };
  }, [hit.ref, hit.to, translation]);
  return text;
}

function Tile({ hit, clip, eager, shares, fav, onPick, onWarm, onReflect, onFav }: {
  hit: Hit; clip: Clip | null | undefined; eager: boolean; shares: number; fav: boolean; onPick: () => void; onWarm: () => void; onReflect: () => void; onFav: () => void;
}) {
  const { surahs, recipe, editions, prefs, lang, config } = useAppState();
  const text = useHitText(hit, recipe.translation);
  const loaded = text && text !== "failed" ? text : null;
  const translated = loaded?.tr ?? null;
  const surah = surahs[+hit.ref.split(":")[0] - 1]?.name_en ?? "";
  const ref = label(hit);
  // The background moves while the tile is well in view (tilePlay.ts), over its still thumbnail.
  const tile = useRef<HTMLLIElement>(null), video = useRef<HTMLVideoElement>(null);
  const preview = clip?.preview ? mediaUrl(clip.preview) : null;
  useEffect(() => (preview && tile.current && video.current ? registerTile(tile.current, video.current, preview) : undefined), [preview]);
  // The reel's first frame (tileFrame.ts) over the background, once drawn; until then (or if it cannot be drawn) the
  // ayah as plain text.
  const [frame, setFrame] = useState<TileFrame | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setFrame(null);
    const w = tile.current?.clientWidth ?? 0;
    if (!clip || !w || !surahs.length) return;
    let alive = true;
    const width = Math.round(Math.min(720, Math.max(360, w * Math.min(2, window.devicePixelRatio || 1))));
    tileFrame(hit.ref, hit.to, clip, width, { prefs, lang, surahs, editions, brand: config.appName })
      .then((f) => alive && setFrame(f), () => {});
    return () => { alive = false; };
  }, [hit.ref, hit.to, clip?.id, prefs, lang, surahs, editions, config.appName]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren(...(frame ? [frame.canvas] : []));
  }, [frame]);
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const W = frame?.canvas.width ?? 1, H = frame?.canvas.height ?? 1;
  return (
    <li className="res-tile" data-key={hitKey(hit)} data-frame={frame ? "" : undefined} ref={tile}>
      <button type="button" className="res-open" data-act="open" aria-label={t.watchAyah(surah, ref)} onClick={onPick} {...lingerProps(onWarm)}>
        <span className="res-bg" aria-hidden="true">
          {clip && <img src={mediaUrl(clip.thumb)} alt="" loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} decoding="async" width={240} height={426} />}
          {preview && <video ref={video} muted loop playsInline preload="none" disablePictureInPicture tabIndex={-1} />}
        </span>
        {frame && frame.blur > 0 && (
          <span className="res-glass" aria-hidden="true" style={{
            left: pct(frame.box.x, W), top: pct(frame.box.y, H), width: pct(frame.box.w, W), height: pct(frame.box.h, H),
            borderRadius: `${(frame.box.radius / W) * 100}cqw`, "--blur": `${(frame.blur / W) * 100}cqw`,
          } as CSSProperties} />
        )}
        <span className="res-frame" ref={host} aria-hidden="true" />
        <span className="res-text">
          {loaded ? <span className="res-ar" lang="ar" dir="rtl">{loaded.ar}</span>
            : text === "failed" ? null : <span className="res-ar res-line" aria-hidden="true" />}
          <span className="res-tr" lang={translated ? translationLang(recipe.translation, editions) : "en"} dir="auto">{translated ?? hit.text}</span>
        </span>
        <span className="res-meta">
          <span className="res-ref">{surah} · {ref}</span>
          {shares > 0 && <span className="res-shares">{t.resShares(formatCount(shares), shares === 1)}</span>}
        </span>
      </button>
      <button type="button" className="res-corner res-reflect" data-act="reflect" aria-label={t.resReflectOn(surah, ref)} onClick={onReflect}>
        <span><ReflectIcon /></span>
      </button>
      <button type="button" className="res-corner res-fav" data-act="fav" aria-pressed={fav} aria-label={fav ? t.removeFavourite : t.addFavourite} onClick={onFav}>
        <span><HeartIcon /></span>
      </button>
    </li>
  );
}

export function Results({ active }: { active: boolean }) {
  const store = useStore();
  const { favourites, config, prefs, lang } = useAppState();
  const search = useSearch();
  const query = search.q;
  const [draft, setDraft] = useState(query);
  const [nonce, setNonce] = useState(0); // searching the same words again
  const [res, setRes] = useState<Found>(none("idle", 0, ""));
  const latest = useRef(res);
  latest.current = res;
  const [more, setMore] = useState<"idle" | "loading" | "failed">("idle"); // the next page
  const loadingMore = useRef(false);
  const [selected, setSelected] = useState<Ref | null>(null);
  const [lists, setLists] = useState<Record<Ref, Clip[] | undefined>>({});
  const [shares, setShares] = useState<Record<Ref, number>>({});
  const controller = useRef<AbortController | null>(null);
  const searchId = useRef(0);

  async function run({ q, surah }: Search) {
    controller.current?.abort();
    const c = (controller.current = new AbortController()), id = ++searchId.current;
    store.dispatch({ type: "query", q });
    setSelected(null);
    setLists({});
    setRes({ ...none("searching", id, q), final: false });
    setMore("idle");
    loadingMore.current = false;
    track("search", { q });
    const range = parseRef(q);
    if (surah) {
      const page = await surahPage(surah, store.getState().surahs).catch(() => null);
      if (id !== searchId.current) return;
      setRes({ ...none(!page ? "failed" : page.results.length ? "shown" : "empty", id, q), hits: page?.results ?? [], next: page?.next ?? null });
      return;
    }
    if (range) {
      const hits = await referenceHits(range, store.getState().surahs).catch(() => null);
      if (id !== searchId.current) return;
      setRes({ ...none(hits === null ? "failed" : hits.length ? "shown" : "empty", id, q), hits: hits ?? [] });
      return;
    }
    let found: Hit[] = [];
    const outcome = await progressiveSearch(q, c.signal, (results, _mode, next) => {
      found = results.map(hitOf);
      setRes({ status: "shown", hits: found, id, q, next, final: false });
    });
    if (id !== searchId.current) return;
    if (found.length) recordSearch(q, found.map((h) => h.ref)); // on this device only: the feed shows more like it
    if (outcome === "empty" || outcome === "failed") setRes(none(outcome, id, q));
    else setRes((old) => (old.id === id ? { ...old, final: true } : old));
  }

  // The next page of a topic search, below the tiles already shown (an ayah already shown is not added again). When
  // "Show more" had focus, it moves to the first new tile, as the button makes way for the loading row.
  const focusAfter = useRef<string | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  async function loadMore() {
    const { id, q, next, final } = latest.current;
    if (loadingMore.current || next === null || !final || id !== searchId.current) return;
    const refocus = document.activeElement === moreButton.current;
    loadingMore.current = true;
    setMore("loading");
    const signal = controller.current!.signal;
    try {
      const page = search.surah ? await surahPage(search.surah, store.getState().surahs, next)
        : await searchPage(q, next, signal).then((p) => ({ results: p.results.map(hitOf), next: p.next }));
      const cur = latest.current;
      if (cur.id !== id || signal.aborted) return;
      const have = new Set(cur.hits.map((h) => h.ref));
      const added = page.results.filter((h) => !have.has(h.ref));
      if (refocus && (!document.activeElement || document.activeElement === document.body)) {
        focusAfter.current = added.length ? hitKey(added[0]) : page.next !== null ? "more" : null;
      }
      setRes({ ...cur, hits: [...cur.hits, ...added], next: page.next });
      setMore("idle");
    } catch {
      if (id === searchId.current && !signal.aborted) setMore("failed");
    } finally {
      if (id === searchId.current) loadingMore.current = false;
    }
  }
  const load = useRef(loadMore);
  load.current = loadMore;
  const hasMore = res.status === "shown" && res.final && res.next !== null;
  // Nearing the end of the grid loads the next page; observing again after each page goes on while the end is in view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!active || !hasMore || more !== "idle" || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load.current();
    }, { rootMargin: "0px 0px 600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active, hasMore, more, res.hits.length]);

  // What Home (or a refinement) asked for.
  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => {
    if (query) void run(search);
    else { controller.current?.abort(); searchId.current++; setRes(none("idle", searchId.current, "")); }
  }, [search, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => setTilesActive(active), [active]);
  // A new search starts at the top.
  useEffect(() => { if (active && res.status === "searching") window.scrollTo?.({ top: 0 }); }, [active, res.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each result's background suggestions (cached per surah); the tiles then get one each, all different.
  useEffect(() => {
    if (res.status !== "shown") return;
    let alive = true;
    const { surahs } = store.getState();
    for (const h of res.hits) {
      if (lists[h.ref]) continue;
      const q = parseRef(res.q) || search.surah ? surahs[+h.ref.split(":")[0] - 1]?.meaning ?? "" : res.q;
      void resultClips(h.ref, q).then((clips) => alive && setLists((old) => (old[h.ref] ? old : { ...old, [h.ref]: clips })));
    }
    return () => { alive = false; };
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps
  const clips = assignClips(res.hits.map((h) => h.ref), lists);

  // How many people shared each ayah (anonymous; a count that does not load is simply not shown).
  useEffect(() => {
    if (res.status !== "shown") return;
    let alive = true;
    ayahStats(res.hits.map((h) => h.ref)).then((m) => {
      if (alive) setShares((old) => ({ ...old, ...Object.fromEntries([...m].map(([ref, s]) => [ref, s.shares])) }));
    }, () => {});
    return () => { alive = false; };
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (h: Hit) => {
    setSelected(h.ref);
    track("search_click", { ref: h.ref, q: store.getState().q });
    const reason = { kind: "search", q: res.q } as const;
    const list: ReelStart[] = res.hits.map((x, i) => {
      const clip = clips[x.ref];
      return { item: reelFor(x.ref, reason, i, x.to), bg: clip ? { type: "clip", id: clip.id } : undefined };
    });
    startReelsAt(list, res.hits.indexOf(h));
  };
  /** The reel that opening this result starts with: its text, recitation and poster, ahead of the tap. */
  const warm = (h: Hit) => {
    const clip = clips[h.ref];
    warmReel(h.ref, { to: h.to, bg: clip ? { type: "clip", id: clip.id } : undefined, prefs, lang });
  };
  // The first result is the likeliest to be opened: warmed as soon as its background is known.
  const firstHit = res.status === "shown" ? res.hits[0] : undefined;
  const firstReady = !!firstHit && !!lists[firstHit.ref];
  useEffect(() => { if (active && firstHit && firstReady) warm(firstHit); }, [active, firstHit?.ref, firstReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const reflect = (h: Hit) => { openReflect(store, h.ref, "results"); openSheet("reflect"); };
  const refine = () => {
    const q = draft.trim();
    if (!q) return;
    if (q === query) setNonce((n) => n + 1);
    else setQuery(q);
  };

  // FLIP: remember where each tile was, then animate the tiles of the same search from there.
  const grid = useRef<HTMLUListElement>(null);
  const prev = useRef({ id: -1, at: new Map<string, { x: number; y: number }>() });
  const focus = grid.current?.contains(document.activeElement)
    ? { key: (document.activeElement as HTMLElement).closest<HTMLElement>("li[data-key]")?.dataset.key, act: (document.activeElement as HTMLElement).dataset.act }
    : null;
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    if (focus?.key && focus.act && !el.contains(document.activeElement)) {
      el.querySelector<HTMLElement>(`li[data-key="${focus.key}"] [data-act="${focus.act}"]`)?.focus({ preventScroll: true });
    }
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target) (target === "more" ? moreButton.current : el.querySelector<HTMLElement>(`li[data-key="${target}"] [data-act="open"]`))?.focus();
    const at = new Map<string, { x: number; y: number }>();
    const animate = prev.current.id === res.id && !reducedMotion();
    for (const li of el.querySelectorAll<HTMLElement>("li[data-key]")) {
      const key = li.dataset.key!, x = li.offsetLeft, y = li.offsetTop, before = prev.current.at.get(key);
      at.set(key, { x, y });
      if (!animate || typeof li.animate !== "function") continue;
      if (!before) li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      else if (Math.abs(before.x - x) > 1 || Math.abs(before.y - y) > 1) {
        li.animate([{ transform: `translate(${before.x - x}px, ${before.y - y}px)` }, { transform: "none" }], { duration: 260, easing: "ease-out" });
      }
    }
    prev.current = { id: res.id, at };
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const showing = res.status === "shown" || res.status === "searching";
  return (
    <div className="res" data-active={active || undefined}>
      <header className="res-head">
        <div className="res-head-in">
          <div className="res-bar">
            <button type="button" className="res-back" aria-label={t.back} onClick={() => navigate("find")}><BackIcon /></button>
            <BrandLogo name={config.appName} />
            <span className="res-bar-end" />
          </div>
          <form className="res-refine" role="search" onSubmit={(e) => { e.preventDefault(); refine(); }}>
            <SearchIcon />
            <label className="res-sr" htmlFor="res-refine">{t.resRefineLabel}</label>
            <input id="res-refine" type="text" enterKeyHint="search" autoComplete="off" placeholder={t.resRefinePlaceholder}
              value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="res-go" aria-label={t.resSearchAgain}><ArrowUpIcon /></button>
          </form>
        </div>
      </header>

      <div className="res-body">
        {res.status !== "idle" && (
          <div className="res-title-row">
            <h2 className="res-title" id="res-title">{t.resultsFor(res.q)}</h2>
            {res.status === "shown" && <span className="res-count" role="status">{t.resAyahCount(ayahsCovered(res.hits))}</span>}
            <LanguageButton />
          </div>
        )}

        {showing && (
          <ul className="res-grid" ref={grid} aria-labelledby="res-title" aria-busy={res.status === "searching"}>
            {res.status === "shown"
              ? res.hits.map((h, i) => (
                <Tile key={hitKey(h)} hit={h} clip={lists[h.ref] ? clips[h.ref] : undefined} eager={i < ABOVE_FOLD} shares={shares[h.ref] ?? 0} fav={favourites.includes(h.ref)}
                  onPick={() => pick(h)} onWarm={() => warm(h)} onReflect={() => reflect(h)} onFav={() => void toggleFavourite(store, h.ref)} />
              ))
              : Array.from({ length: SKELETONS }, (_, i) => <li key={i} className="res-tile res-skeleton" aria-hidden="true" />)}
          </ul>
        )}
        {hasMore && (
          <div className="res-more" ref={sentinel}>
            {more === "loading"
              ? <p className="res-loading" role="status"><span className="res-spinner" aria-hidden="true" />{t.resLoadingMore}</p>
              : (
                <button type="button" ref={moreButton} className="btn small res-more-btn" onClick={() => void loadMore()}>
                  {more === "failed" ? t.resMoreFailed : t.resShowMore}
                </button>
              )}
          </div>
        )}
        {res.status === "searching" && <p className="res-note" role="status">{t.searching}</p>}
        {res.status === "idle" && <p className="res-note">{t.resultsIdle}</p>}
        {res.status === "empty" && <p className="res-note">{t.noResults}</p>}
        {res.status === "failed" && (
          // Not "nothing found": the search did not answer (it was already tried twice), so offer another try.
          <div className="res-note res-failed">
            <p>{t.searchFailed}</p>
            <button type="button" className="btn small" onClick={() => setNonce((n) => n + 1)}>{t.retry}</button>
          </div>
        )}

        {res.status !== "searching" && (
          <div className="res-foot">
            {res.status === "shown" && (
              <button type="button" className="link-btn report-link"
                onClick={() => openReport(store, { kind: "search", ref: selected ?? undefined, note: res.q ? `"${res.q}"` : undefined })}>
                {t.resultsWrong}
              </button>
            )}
            {res.status !== "idle" && <p>{t.resultsNotQuite}</p>}
            <button type="button" className="res-pick" onClick={() => openPicker()}>{t.pickYourself}</button>
          </div>
        )}
      </div>
    </div>
  );
}
