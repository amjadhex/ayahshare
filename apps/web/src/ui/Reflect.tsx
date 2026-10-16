// Reflect sheet (from Reels, Results, Create and Profile): two tabs.
//  - Tafsir: the languages that have one as chips (My language's first, else English, labelled so; never
//    machine-translated), that language's tafsirs as cards with the start of their passage, "Read" for one alone
//    (remembered for My language, tafsirs.ts, and first next time). The Worker lays the source's HTML out for reading
//    (quoted ayahs set apart in the Quran font with the translation and reference the source gives; footnotes and page
//    numbers quieter); here it is only sanitised again and styled (reflect.css).
//  - Reflections: "Scholars' notes" first, only authors with QuranReflect's verified tick (their lessons, then their
//    reflections), then "Reflections" by everyone else (moderators' picks, then likes). Each section loads its own next
//    page. Every card: photo (through our Worker, else initials), name, verified tick, likes, text with "Read more", and
//    Report. At the foot, "Powered by QuranReflect.com" with its mark, linking to the site.
// The sheet opens on Reflections when the ayah has scholars' notes, else on Tafsir.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import type { ReflectionPost, ReflectionsResponse, TafsirId, TafsirInfo, TafsirResponse } from "../../../../contracts/types";
import { openReport, toast } from "../actions";
import * as api from "../api";
import { LANG_FONT, TAFSIR_FONT } from "../config";
import { ensureFont } from "../draw";
import { languageOf, LANGUAGES } from "../lang";
import { platform } from "../platform";
import { closeSheet } from "../router";
import { safeHtml } from "../sanitize";
import { t } from "../strings";
import { rememberedTafsir, rememberTafsir, tafsirGroups } from "../tafsirs";
import { useAppState, useRoute, useStore } from "./hooks";
import { BackIcon, CopyIcon, FlagIcon, SendIcon } from "./icons";
import { Sheet } from "./Sheet";
import { focusForKeyboard } from "./focus";
import "./reflect.css";

const RTL = new Set(["ar", "ur", "fa", "ps", "ku", "sd", "ug", "dv"]);
const names = (() => { try { return new Intl.DisplayNames(["en"], { type: "language" }); } catch { return null; } })();
/** "Urdu" for "ur". */
export const langName = (code: string) =>
  LANGUAGES.some((l) => l.code === code) ? languageOf(code).english : (() => { try { return names?.of(code) ?? code; } catch { return code; } })();

type Tab = "tafsir" | "reflections";
type Kind = "lessons" | "reflections";
interface Feed { pages: ReflectionsResponse[]; state: "loading" | "ready" | "failed" }
const LOADING: Feed = { pages: [], state: "loading" };
/** A sideways swipe at least this long (CSS px, and mostly sideways) changes the tab. */
const SWIPE_PX = 60;
/** How long the sheet waits for the scholars' notes before it opens on Tafsir. */
const DECIDE_MS = 2500;

const verified = (p: ReflectionPost) => p.by?.verified === true;
function unique(posts: ReflectionPost[]) {
  const seen = new Set<number>();
  return posts.filter((p) => !seen.has(p.id) && !!seen.add(p.id));
}

/** Lessons and reflections for the ayah while the sheet is open, page by page; `more` loads a section's next page in
 *  the language its first page was served in. */
function useFeeds(ref: string, lang: string, open: boolean) {
  const [feeds, setFeeds] = useState<Record<Kind, Feed>>({ lessons: LOADING, reflections: LOADING });
  const run = useRef(0);
  const load = (kind: Kind, page: number, served: string) => {
    const id = run.current;
    const set = (f: (old: Feed) => Feed) => { if (id === run.current) setFeeds((all) => ({ ...all, [kind]: f(all[kind]) })); };
    set((old) => ({ ...old, state: "loading" }));
    // Through a promise, so a missing function (older test stand-ins) is a failed load, not a crash.
    Promise.resolve().then(() => (kind === "lessons" ? api.getLessons : api.getReflections)(ref, served, page)).then(
      (d) => set((old) => ({ pages: [...old.pages.filter((p) => p.page < page), d], state: "ready" })),
      () => set((old) => ({ ...old, state: "failed" })),
    );
  };
  useEffect(() => {
    run.current++;
    setFeeds({ lessons: LOADING, reflections: LOADING });
    if (!open || !ref) return;
    load("lessons", 1, lang);
    load("reflections", 1, lang);
  }, [open, ref, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = (kind: Kind) => {
    const last = feeds[kind].pages.at(-1);
    if (last) load(kind, last.page + 1, last.lang);
  };
  return { feeds, more };
}

/** Scholars' notes (verified authors: lessons, then reflections) and everyone else's posts (page 1 of reflections with
 *  the unverified lessons, moderators' picks first, then likes; later pages after it). */
function sections(feeds: Record<Kind, Feed>) {
  const lessons = feeds.lessons.pages, reflections = feeds.reflections.pages;
  const scholars = unique([...lessons.flatMap((p) => p.posts), ...reflections.flatMap((p) => p.posts)].filter(verified));
  // Posts in the language each list was served in come first (QuranReflect also sends other languages when it has few).
  const served = (p: ReflectionPost) => p.lang === (p.kind === "lesson" ? lessons[0]?.lang : reflections[0]?.lang);
  const first = [...(reflections[0]?.posts ?? []), ...(lessons[0]?.posts ?? [])].filter((p) => !verified(p))
    .map((p, i) => ({ p, i })).sort((a, b) => +served(b.p) - +served(a.p) || +!!b.p.reviewed - +!!a.p.reviewed || b.p.likes - a.p.likes || a.i - b.i).map((x) => x.p);
  const later = [...reflections.slice(1), ...lessons.slice(1)].flatMap((p) => p.posts).filter((p) => !verified(p));
  return { scholars, community: unique([...first, ...later]) };
}

export function ReflectSheet() {
  const route = useRoute();
  const { reflect, surahs, lang } = useAppState();
  const open = route.sheet === "reflect" && !!reflect;
  const ref = reflect?.ref ?? "";
  const surah = surahs[+ref.split(":")[0] - 1];
  const { feeds, more } = useFeeds(ref, lang, open);
  const { scholars, community } = useMemo(() => sections(feeds), [feeds]);
  const ids = { tafsir: useId(), reflections: useId() };

  // The tab: the person's own pick, else Reflections when there are scholars' notes, else Tafsir. Decided once per
  // opening, so the content never jumps away from someone reading it.
  const [picked, setPicked] = useState<Tab | null>(null);
  const [from, setFrom] = useState<"left" | "right" | null>(null);
  const [decided, setDecided] = useState<Tab | null>(null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setPicked(null); setDecided(null); setWaited(false); setFrom(null);
    if (!open) return;
    const timer = setTimeout(() => setWaited(true), DECIDE_MS);
    return () => clearTimeout(timer);
  }, [open, ref]);
  const settled = (["lessons", "reflections"] as Kind[]).every((k) => feeds[k].pages.length || feeds[k].state === "failed");
  useEffect(() => {
    if (decided || !open) return;
    if (scholars.length) setDecided("reflections");
    else if (settled || waited) setDecided("tafsir");
  }, [decided, open, scholars.length, settled, waited]);
  const tab = picked ?? decided ?? "tafsir";
  const pending = !picked && !decided;
  // A tafsir being read fills the screen (owner, 12 Oct 2026): the sheet goes full height and the tabs step aside.
  // Closing it (the close button, Escape, All tafsirs) goes back to the sheet as it was, not out of the sheet.
  const [exitReading, setExitReading] = useState<(() => void) | null>(null);
  const reading = !!exitReading;
  useEffect(() => { if (!open) setExitReading(null); }, [open, ref]);
  // Switching tabs (a tap, the arrow keys or a swipe): the new one slides in from its side and starts at its top.
  const go = (next: Tab) => {
    if (next === tab) return;
    setFrom(next === "reflections" ? "right" : "left");
    setPicked(next);
    const body = document.getElementById(ids.tafsir)?.closest(".sheet-body");
    if (body && body.scrollTop > 0) body.scrollTop = 0;
  };
  const choose = (next: Tab) => { go(next); document.getElementById(`${ids[next]}-tab`)?.focus(); };
  // A sideways swipe on the content goes to the other tab (owner, 12 Oct 2026); not from the language chips, which
  // scroll sideways themselves, nor while a tafsir is being read.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeStart = (e: TouchEvent) => {
    const p = e.touches[0];
    swipe.current = !reading && !pending && e.touches.length === 1 && !(e.target as Element).closest?.(".rf-langs") ? { x: p.clientX, y: p.clientY } : null;
  };
  const swipeEnd = (e: TouchEvent) => {
    const s = swipe.current, p = e.changedTouches[0];
    swipe.current = null;
    if (!s || !p) return;
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? "reflections" : "tafsir");
  };

  return (
    <Sheet open={open} title={t.reflectTitle(`${surah?.name_en ?? ""} ${ref}`.trim())} onClose={() => (exitReading ? exitReading() : closeSheet())}
      className={`rf-sheet${reading ? " rf-reading" : ""}`}>
      <div className="rf-tabs" role="tablist" aria-label={t.reflect}>
        {(["tafsir", "reflections"] as Tab[]).map((id) => (
          <button key={id} type="button" role="tab" className="rf-tab" id={`${ids[id]}-tab`} aria-controls={ids[id]} aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1} onClick={() => go(id)}
            onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") choose(id === "tafsir" ? "reflections" : "tafsir"); }}>
            {id === "tafsir" ? t.tafsir : t.reflections}
          </button>
        ))}
      </div>
      {open && pending && <p className="rf-status" role="status"><span className="spinner small" /> {t.reflectLoading}</p>}
      <div className="rf-panes" data-from={from ?? undefined} onTouchStart={swipeStart} onTouchEnd={swipeEnd} onTouchCancel={() => { swipe.current = null; }}>
        <div role="tabpanel" id={ids.tafsir} aria-labelledby={`${ids.tafsir}-tab`} hidden={pending || tab !== "tafsir"}>
          {open && <Tafsir key={`${ref}/${lang}`} ayahRef={ref} onReading={(exit) => setExitReading(() => exit)} />}
        </div>
        <div role="tabpanel" id={ids.reflections} aria-labelledby={`${ids.reflections}-tab`} hidden={pending || tab !== "reflections"}>
          {open && <Reflections ayahRef={ref} feeds={feeds} scholars={scholars} community={community} more={more} />}
        </div>
      </div>
    </Sheet>
  );
}

/** Tafsir cards shown before "More tafsirs". */
const TAFSIR_FIRST = 3;

/** The start of a passage as plain text for its card: the commentary itself, its blocks a space apart, a quoted ayah
 *  as "…", without headings, footnotes and page numbers (all of it when that leaves nothing). Parsed, never inserted. */
function excerpt(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = () => [...doc.body.childNodes].map((n) => n.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
  const all = text();
  doc.querySelectorAll(".rf-fn, .rf-page, .rf-mark, h2, h3, h4").forEach((e) => e.remove());
  doc.querySelectorAll(".rf-q, .rf-aya").forEach((e) => e.replaceWith(" … "));
  return (text().replace(/^(… ?)+/, "").replace(/(… ?){2,}/g, "… ").slice(0, 600) || all.slice(0, 600));
}

/** The Tafsir tab (owner, 12 Oct 2026), in the Reflections pattern: the languages that have a tafsir as chips (My
 *  language's first, else English), that language's tafsirs as cards (an initials avatar, name, author, the start of
 *  its passage for this ayah), the first TAFSIR_FIRST then "More tafsirs"; "Read" opens that one alone, with a way back.
 *  The one last read is remembered for My language and comes first. */
function Tafsir({ ayahRef, onReading }: { ayahRef: string; onReading: (exit: (() => void) | null) => void }) {
  const { lang, surahs } = useAppState();
  const where = `${surahs[+ayahRef.split(":")[0] - 1]?.name_en ?? ""} ${ayahRef}`.trim();
  const [list, setList] = useState<TafsirInfo[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, TafsirResponse | "failed">>({});
  const asked = useRef(new Set<string>());
  const [shown, setShown] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [reading, setReading] = useState<TafsirId | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);
  const scrolled = useRef(0);
  // The order is fixed when the tab opens: reading one does not move the cards under the person's thumb.
  const [remembered] = useState(() => rememberedTafsir(lang));

  const load = (id: TafsirId | undefined) => {
    const key = String(id ?? "");
    if (asked.current.has(key)) return;
    asked.current.add(key);
    api.getTafsir(ayahRef, lang, id).then((d) => setAnswers((a) => ({ ...a, [key]: d })), () => setAnswers((a) => ({ ...a, [key]: "failed" })));
  };
  // Every tafsir (once per visit). Through a promise, so a missing function (older test stand-ins) is a failed load;
  // without the list, the default answer's own options are offered.
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => api.getTafsirs()).then((l) => alive && setList(l), () => { if (alive) load(undefined); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fallbackAnswer = answers[""];
  const tafsirs: TafsirInfo[] | null = list ?? (fallbackAnswer && fallbackAnswer !== "failed"
    ? fallbackAnswer.options.map((o) => ({ id: o.id, name: o.name, author: o.id === fallbackAnswer.tafsir.id ? fallbackAnswer.tafsir.author : null, lang: fallbackAnswer.fallback ? "en" : lang }))
    : null);

  const groups = useMemo(() => (tafsirs ? tafsirGroups(tafsirs, [lang, "en", "ar"]) : []), [tafsirs, lang]);
  const hasMine = groups.some((g) => g.code === lang);
  const current = groups.find((g) => g.code === shown) ?? groups.find((g) => g.code === lang) ?? groups.find((g) => g.code === "en") ?? groups[0];
  const cards = current ? [...current.tafsirs].sort((a, b) => +(b.id === remembered) - +(a.id === remembered)) : [];
  const visible = all ? cards : cards.slice(0, TAFSIR_FIRST);
  useEffect(() => { for (const x of visible) load(x.id); }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tafsirs) {
    return <p className="rf-status">{fallbackAnswer === "failed" ? t.tafsirFailed : <><span className="spinner small" /> {t.tafsirLoading}</>}</p>;
  }

  const read = (x: TafsirInfo) => {
    rememberTafsir(lang, x.id);
    returnTo.current = String(x.id);
    scrolled.current = top.current?.closest(".sheet-body")?.scrollTop ?? 0;
    setReading(x.id);
    onReading(back);
    requestAnimationFrame(() => { top.current?.scrollIntoView?.({ block: "start" }); top.current?.querySelector<HTMLElement>(".rf-back")?.focus({ preventScroll: true }); });
  };
  const back = () => {
    setReading(null);
    onReading(null);
    requestAnimationFrame(() => {
      // Back where the list was left, on the card that was read.
      const body = top.current?.closest(".sheet-body");
      if (body) body.scrollTop = scrolled.current;
      const b = [...(top.current?.querySelectorAll<HTMLElement>("[data-tafsir]") ?? [])].find((x) => x.dataset.tafsir === returnTo.current);
      focusForKeyboard(b);
    });
  };

  if (reading !== null) {
    const info = tafsirs.find((x) => x.id === reading);
    const data = answers[String(reading)];
    return (
      <div className="rf-tafsir rf-reader" ref={top}>
        {/* The reader's own top, in place of the sheet's (owner, 12 Oct 2026), kept in view while reading: back, the
            cover, the name, author and language, and the ayahs it explains on a third line. */}
        <div className="rf-reader-head">
          <button type="button" className="rf-back" aria-label={t.allTafsirs} onClick={back}><BackIcon /></button>
          <TafsirMark id={reading} name={info?.author ?? info?.name ?? ""} />
          <div className="rf-reader-title">
            <strong>{info?.name ?? (data && data !== "failed" ? data.tafsir.name : "")}</strong>
            <span>{[info?.author ?? (data && data !== "failed" ? data.tafsir.author : null), langName(data && data !== "failed" ? data.lang : info?.lang ?? lang)].filter(Boolean).join(" · ")}</span>
            {data && data !== "failed" && data.from !== data.to && <span className="rf-covers">{t.tafsirCovers(data.from, data.to)}</span>}
          </div>
        </div>
        {!data ? <p className="rf-status"><span className="spinner small" /> {t.tafsirLoading}</p>
          : data === "failed" ? <p className="rf-status">{t.tafsirFailed}</p>
          : <TafsirReader data={data} />}
      </div>
    );
  }

  return (
    <div className="rf-tafsir" ref={top}>
      <h3 className="rf-h">{t.tafsirNotes}</h3>
      <p className="rf-sub">{t.tafsirIntro}</p>
      {groups.length > 1 && (
        <div className="rf-langs" role="group" aria-label={t.tafsirLanguages}>
          {groups.map((g) => (
            <button key={g.code} type="button" aria-pressed={g.code === current?.code} onClick={() => { setShown(g.code); setAll(false); }}>{g.english}</button>
          ))}
        </div>
      )}
      {!hasMine && current?.code === "en" && <p className="rf-note">{t.tafsirFallback(langName(lang))}</p>}
      <ol className="rf-list">
        {visible.map((x) => {
          const d = answers[String(x.id)];
          const by = x.author && x.author.toLowerCase() !== x.name.toLowerCase() ? x.author : null;
          return (
            <li key={String(x.id)} className="rf-card rf-tcard">
              <div className="rf-card-head">
                <TafsirMark id={x.id} name={x.author ?? x.name} />
                <div className="rf-who">
                  <span className="rf-name"><bdi>{x.name}</bdi></span>
                  <span className="rf-meta">
                    {by && <bdi>{by}</bdi>}
                    {d && d !== "failed" && d.from !== d.to && <span className="rf-covers">{t.tafsirCovers(d.from, d.to)}</span>}
                  </span>
                </div>
              </div>
              <p className="rf-body rf-excerpt" dir={RTL.has(x.lang) ? "rtl" : "ltr"} lang={x.lang}>
                {!d ? <span className="rf-wait">{t.tafsirLoading}</span> : d === "failed" ? t.tafsirFailed : excerpt(d.html) || t.tafsirNone}
              </p>
              <CardFoot text={d && d !== "failed" ? () => tafsirSnippet(d, x.name, where) : undefined} title={x.name}>
                <button type="button" className="rf-link" data-tafsir={String(x.id)} aria-label={t.tafsirReadName(x.name)} onClick={() => read(x)}>{t.readMore}</button>
              </CardFoot>
            </li>
          );
        })}
      </ol>
      {cards.length > visible.length && (
        <button type="button" className="rf-more" onClick={() => setAll(true)}>{t.moreTafsirs(cards.length - visible.length)}</button>
      )}
    </div>
  );
}

/** A tafsir's mark: its book cover (public/tafsir-covers/<id>.webp, small thumbnails; manifest.json there names each
 *  one's source), else the initials of its author. Any tafsir without a cover just fails to load and shows the initials. */
function TafsirMark({ id, name }: { id: TafsirId; name: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="rf-avatar rf-tavatar" aria-hidden="true">{initials(name)}</span>;
  return <img className="rf-cover" src={`/tafsir-covers/${id}.webp`} alt="" width={36} height={52} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

/** One tafsir alone, for reading: its name, author, language and the ayahs it explains, then the Worker's layout
 *  (sanitised again here). */
function TafsirReader({ data }: { data: TafsirResponse }) {
  const html = useMemo(() => safeHtml(data.html), [data]);
  // The tafsir's web font: Malayalam (Thafheem) in its own serif (config.ts TAFSIR_FONT), else the translation's.
  useEffect(() => { const font = TAFSIR_FONT[data.lang] ?? LANG_FONT[data.lang]; if (font) void ensureFont(font); }, [data.lang]);
  return (
    <>
      {html ? <div className="rf-tafsir-text" lang={data.lang} dir={RTL.has(data.lang) ? "rtl" : data.lang === "ml" ? "auto" : "ltr"} dangerouslySetInnerHTML={{ __html: html }} />
        : <p className="rf-status">{t.tafsirNone}</p>}
    </>
  );
}

function Reflections({ ayahRef, feeds, scholars, community, more }: {
  ayahRef: string; feeds: Record<Kind, Feed>; scholars: ReflectionPost[]; community: ReflectionPost[]; more: (kind: Kind) => void;
}) {
  const store = useStore();
  const { lang } = useAppState();
  const scholarsId = useId(), communityId = useId();
  const lessons = feeds.lessons, reflections = feeds.reflections;
  const loading = lessons.state === "loading" || reflections.state === "loading";
  const report = (p: ReflectionPost) => openReport(store, { kind: "other", ref: ayahRef, note: `reflection ${p.id}` });

  if (!lessons.pages.length && !reflections.pages.length) {
    return <p className="rf-status">{loading ? <><span className="spinner small" /> {t.reflectionsLoading}</> : t.reflectionsFailed}</p>;
  }
  const lessonsLast = lessons.pages.at(-1), reflLast = reflections.pages.at(-1);
  const moreLessons = !!lessonsLast && lessonsLast.page < lessonsLast.pages;
  const moreReflections = !!reflLast && reflLast.page < reflLast.pages;
  if (!scholars.length && !community.length && !moreReflections) {
    return <p className="rf-status">{loading ? <><span className="spinner small" /> {t.reflectionsLoading}</> : t.reflectionsNone}</p>;
  }
  const mine = langName(lang);
  const scholarsFallback = (lessons.pages[0] ?? reflections.pages[0])?.fallback;
  return (
    <div className="rf-reflections">
      {scholars.length > 0 && (
        <section className="rf-section rf-scholars" aria-labelledby={scholarsId}>
          <h3 id={scholarsId} className="rf-h">{t.scholarsNotes}</h3>
          <p className="rf-sub">{t.scholarsIntro}</p>
          {scholarsFallback && <p className="rf-note">{t.scholarsFallback(mine)}</p>}
          <ol className="rf-list">
            {scholars.map((p) => <Card key={p.id} post={p} served={lessonsLast?.lang ?? reflLast?.lang ?? "en"} onReport={() => report(p)} />)}
          </ol>
          {lessons.state === "failed" && lessons.pages.length > 0 && <p className="rf-status">{t.reflectionsFailed}</p>}
          {moreLessons && (
            <button type="button" className="rf-more" disabled={lessons.state === "loading"} onClick={() => more("lessons")}>
              {lessons.state === "loading" ? t.reflectionsLoading : t.moreScholarsNotes}
            </button>
          )}
        </section>
      )}
      {(community.length > 0 || moreReflections) && (
        <section className="rf-section" aria-labelledby={communityId}>
          <h3 id={communityId} className="rf-h">{t.reflections}</h3>
          <p className="rf-sub">{reflections.pages[0] ? `${t.reflectionsCount(reflections.pages[0].total)} · ` : ""}{t.reflectionsIntro}</p>
          {reflections.pages[0]?.fallback && <p className="rf-note">{t.reflectionsFallback(mine)}</p>}
          <ol className="rf-list">
            {community.map((p) => <Card key={p.id} post={p} served={reflLast?.lang ?? lessonsLast?.lang ?? "en"} onReport={() => report(p)} />)}
          </ol>
          {reflections.state === "failed" && <p className="rf-status">{t.reflectionsFailed}</p>}
          {moreReflections && (
            <button type="button" className="rf-more" disabled={reflections.state === "loading"} onClick={() => more("reflections")}>
              {reflections.state === "loading" ? t.reflectionsLoading : t.moreReflections}
            </button>
          )}
        </section>
      )}
      <a className="rf-powered" href="https://quranreflect.com" target="_blank" rel="noopener noreferrer">
        <img src="/quranreflect-mark.svg" alt="" width={14} height={18} />{t.poweredByQuranReflect}
      </a>
    </div>
  );
}

const TAGS_LINE = /^\s*(#[\p{L}\p{N}_-]+[\s,]*)+$/u, CITE_LINE = /^\s*\[[^\]\n]+\]\s*$/;
/** A post's text for its card (owner, 12 Oct 2026): lines of hashtags taken out (shown apart, quietly) and a line that
 *  is only a reference in brackets ("[Agreed upon: Narrated by al-Bukhari …]") marked to be set apart (reflect.css). */
export function postParts(body: string) {
  const tags: string[] = [];
  const kept = body.split("\n").filter((l) => {
    if (!TAGS_LINE.test(l)) return true;
    tags.push(...(l.match(/#[\p{L}\p{N}_-]+/gu) ?? []));
    return false;
  });
  while (kept.length && !kept.at(-1)!.trim()) kept.pop();
  // A bracketed line of Arabic is a quoted text (a hadith's chain), not a reference: it stays as it is.
  const cite = (l: string) => CITE_LINE.test(l) && l.length <= 240 && !/\p{Script=Arabic}/u.test(l);
  const lines = kept.map((l) => (cite(l) ? { text: l.trim(), cite: true } : { text: l, cite: false }));
  return { lines, tags, text: kept.join("\n") };
}

/** A card's foot, the same on Tafsir and Reflections (owner, 12 Oct 2026): "Read more" on the left, then Copy and
 *  Share as icons on the right. Share opens the system share sheet where there is one, else copies. */
function CardFoot({ text, title, children }: { text?: () => string; title: string; children?: ReactNode }) {
  const store = useStore();
  const copy = () => text && platform.copyText(text()).then(() => toast(store, t.reflectionCopied), () => toast(store, t.copyFailed));
  const share = () => {
    if (!text) return;
    if (!platform.canShareLink()) return void copy();
    platform.shareText(text(), title).catch(() => toast(store, t.shareFailed));
  };
  return (
    <div className="rf-foot">
      {children}
      <span className="rf-acts">
        <button type="button" className="rf-act" aria-label={t.copyReflection} disabled={!text} onClick={copy}><CopyIcon /></button>
        <button type="button" className="rf-act" aria-label={t.shareReflection} disabled={!text} onClick={share}><SendIcon /></button>
      </span>
    </div>
  );
}

/** A tafsir passage as text to copy or share: its words (blocks a blank line apart), then the tafsir and the ayah. */
export function tafsirSnippet(d: TafsirResponse, name: string, ayah: string) {
  const doc = new DOMParser().parseFromString(d.html, "text/html");
  const text = [...doc.body.children].map((e) => (e.textContent ?? "").trim()).filter(Boolean).join("\n\n") || (doc.body.textContent ?? "").trim();
  return `${text}\n\n— ${[name, d.tafsir.author].filter(Boolean).join(", ")} · ${ayah}`;
}

/** "OS" for "Omar Suleiman"; one letter for one word. */
export function initials(name: string) {
  const words = name.replace(/^@/, "").split(/\s+/).map((w) => w.match(/\p{L}|\p{N}/u)?.[0] ?? "").filter(Boolean);
  return (words.length > 1 ? words[0] + words[words.length - 1] : words[0] ?? "?").toLocaleUpperCase();
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="rf-avatar" aria-hidden="true">
      {src && !broken
        ? <img src={src} alt="" width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : initials(name)}
    </span>
  );
}

const Tick = () => (
  <svg className="rf-tick" viewBox="0 0 24 24" role="img" aria-label={t.verifiedOnQuranReflect}>
    <title>{t.verifiedOnQuranReflect}</title>
    <circle cx="12" cy="12" r="10" />
    <path d="m7.5 12.5 3 3 6-6.5" />
  </svg>
);

/** A post as text to copy or share: its words, then who wrote it and the ayah, then where it was found (QuranReflect). */
export function postSnippet(body: string, name: string, ayah: string) {
  return `${body.trim()}\n\n— ${name} · ${ayah}\n${t.viaQuranReflect}`;
}

function Card({ post, served, onReport }: { post: ReflectionPost; served: string; onReport: () => void }) {
  const { reflect, surahs } = useAppState();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  // Older answers have only the username.
  const by = post.by ?? { name: "", username: post.author, verified: false, avatar: null };
  const name = by.name && by.name !== by.username ? by.name : `@${by.username}`;
  const parts = useMemo(() => postParts(post.body), [post.body]);
  const long = parts.text.length > 360 || parts.lines.length > 7;
  const other = post.lang && post.lang !== served ? langName(post.lang) : null;
  const ref = reflect?.ref ?? "";
  const snippet = () => postSnippet(parts.text, name, `${surahs[+ref.split(":")[0] - 1]?.name_en ?? ""} ${ref}`.trim());
  return (
    <li className="rf-card">
      <div className="rf-card-head">
        <Avatar name={name} src={api.avatarSrc(by.avatar)} />
        <div className="rf-who">
          <span className="rf-name"><bdi>{name}</bdi>{by.verified && <Tick />}</span>
          <span className="rf-meta">
            {name !== `@${by.username}` && by.username && <bdi>@{by.username}</bdi>}
            <span>{t.likes(post.likes)}</span>
            {post.kind === "lesson" && <span className="rf-tag">{t.lessonTag}</span>}
            {other && <span className="rf-tag">{t.inLanguage(other)}</span>}
          </span>
        </div>
        <button type="button" className="rf-flag" aria-label={t.reportReflection} title={t.reportReflection} onClick={onReport}><FlagIcon /></button>
      </div>
      <p id={bodyId} className={`rf-body${long && !open ? " rf-clamped" : ""}`} dir="auto" lang={post.lang || undefined}>
        {parts.lines.map((l, i) => (
          <Fragment key={i}>{i > 0 && !l.cite && !parts.lines[i - 1].cite && "\n"}{l.cite ? <span className="rf-cite">{l.text}</span> : l.text}</Fragment>
        ))}
      </p>
      {parts.tags.length > 0 && (!long || open) && <p className="rf-hashtags" dir="auto">{parts.tags.join(" ")}</p>}
      <CardFoot text={snippet} title={name}>
        {long && <button type="button" className="rf-link" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>{open ? t.showLess : t.readMore}</button>}
      </CardFoot>
    </li>
  );
}
