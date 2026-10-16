// Home: "What do you feel today?" The prompt sits in the middle; as soon as the person types it moves up (the heading
// folds away) and suggestions appear under it. Idle: a row of chips that say a feeling or a moment in the person's voice
// ("I need patience"; it scrolls sideways), "type a reference" and "Pick an ayah yourself".
// Submitting (or tapping a suggestion or chip) opens Results; references like 94:5 go there too.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Me } from "../../../../../contracts/types";
import { toast } from "../../actions";
import { openPicker, openSearch } from "../../nav";
import { defaultTranslation } from "../../prefs";
import { activityHasNew } from "../../activitySeen";
import { getAnnouncements } from "../../api";
import { myImpact } from "../../stats";
import { openToday, watchedToday } from "../../today";
import { navigate } from "../../router";
import { t } from "../../strings";
import { matchChips, nextChip, pickChips, type Chip } from "../../topics";
import { coarsePointer, reducedMotion, useAppState, useStore } from "../hooks";
import { ArrowUpIcon, ArrowUpRightIcon, BellIcon, CloseIcon, PlayIcon, PlusSquareIcon, RefreshIcon, SearchIcon } from "../icons";
import { InstallStrip } from "../Install";
import { HomeAccount, HomeMe, usePersonal } from "../Join";
import { MadeBy } from "../MadeBy";
import { StreakPill } from "../Streak";
import { BrandLogo, BrandMark } from "./BrandLogo";
import "./home.css";

const ROTATE_MS = 9000, PLACEHOLDER_MS = 2800, MAX_SUGGESTIONS = 5;
const focusVisible = (el: Element) => { try { return el.matches(":focus-visible"); } catch { return true; } };

/** "Assalamu alaikum, Amjad" when signed in (the first word of the name they chose, else Google's), else
 *  "Assalamu alaikum". */
export const greetingFor = (me: Pick<Me, "name" | "displayName"> | null) =>
  t.homeGreeting((me?.displayName || me?.name || "").trim().split(/\s+/)[0] || null);

interface Suggestion { key: string; text: string; q: string; lang?: string; chip?: Chip }

/** Under the box while typing: curated phrases and matching topics (about 5), else a plain "Search “…”" row. */
export function suggestionsFor(input: string, lang: string): Suggestion[] {
  const text = input.trim();
  if (!text) return [];
  const low = text.toLowerCase(), last = low.split(/\s+/).pop() ?? "";
  const phrases = t.homeSuggestions.filter((p) => { const l = p.toLowerCase(); return l.startsWith(low) || l.split(/\s+/).some((w) => w.startsWith(last)); });
  const first = phrases.filter((p) => p.toLowerCase().startsWith(low)), rest = phrases.filter((p) => !first.includes(p));
  const phrase = (p: string): Suggestion => ({ key: `p:${p}`, text: p, q: p });
  const topic = (c: Chip): Suggestion => ({ key: `t:${c.id}`, text: c.label, q: c.q, lang: c.lang, chip: c });
  const list = [...first.map(phrase), ...matchChips(text, lang, 2).map(topic), ...rest.map(phrase)].slice(0, MAX_SUGGESTIONS);
  return list.length ? list : [{ key: "search", text: t.homeSearchFor(text), q: text }];
}

/** Topic chips for this visit, re-picked when the translation's language changes, with one chip swapped every few
 *  seconds while Home is on screen, nobody is pointing at them and the row is not scrolled (never with reduced motion).
 *  Only chips past the first few change, so the ones in view stay put. */
function useChips(lang: string, active: boolean) {
  const [chips, setChips] = useState<Chip[]>(() => pickChips(new Date(), lang));
  const [fresh, setFresh] = useState<string | null>(null);
  const busy = useRef(false); // hovered or focused
  const row = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setChips(pickChips(new Date(), lang));
  }, [lang]);
  const current = useRef(chips);
  current.current = chips;
  useEffect(() => {
    if (!active || reducedMotion()) return;
    const id = setInterval(() => {
      const list = current.current;
      if (busy.current || document.hidden || list.length < 4 || Math.abs(row.current?.scrollLeft ?? 0) > 8) return;
      const add = nextChip(new Date(), lang, list.map((c) => c.id));
      if (!add) return;
      // Swap one of the later chips; the moment's own chips stay at the front.
      const i = 3 + Math.floor(Math.random() * (list.length - 3));
      setFresh(add.id);
      setChips(list.map((c, k) => (k === i ? add : c)));
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [active, lang]);
  const refresh = () => { setFresh(null); setChips(pickChips(new Date(), lang)); row.current?.scrollTo({ left: 0 }); };
  return { chips, fresh, refresh, busy, row };
}

/** The example in the empty box changes every few seconds (it stays still with reduced motion). */
function usePlaceholder(running: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!running || reducedMotion()) return;
    const id = setInterval(() => { if (!document.hidden) setI((n) => n + 1); }, PLACEHOLDER_MS);
    return () => clearInterval(id);
  }, [running]);
  return t.homeExamples[i % t.homeExamples.length];
}

export function Home({ active }: { active: boolean }) {
  const { config, lang, me, prefs } = useAppState();
  const store = useStore();
  // "Watch today's ayah" (owner, 12 Oct 2026: in place of "Pick an ayah yourself", which the Create tab also opens): the
  // day's ayah (today.ts: the admin's pick or the one Discover shows), first in Reels, then the usual reels. Once watched,
  // the button is "Create new" (the picker) for the rest of the day.
  const [opening, setOpening] = useState(false);
  const [watched, setWatched] = useState(watchedToday);
  const watchToday = () => {
    if (opening) return;
    setOpening(true);
    void openToday(defaultTranslation(prefs, lang), "home")
      .then((ok) => {
        if (!ok) return toast(store, t.todayFailed);
        setWatched(true); // openToday remembered it
      })
      .finally(() => setOpening(false));
  };
  // A new day while Home is open (or kept in the background): today's ayah again.
  useEffect(() => { if (active) setWatched(watchedToday()); }, [active]);
  const personal = usePersonal(); // the streak shows once signed in (it is kept on the device before that)
  // The bell's dot: Notifications has something new since it was last opened (activitySeen.ts): a new day's ayah not
  // watched yet, a newer announcement, or, signed in, more opens of the person's links.
  const [bellNew, setBellNew] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setBellNew(activityHasNew(null));
    void Promise.all([personal ? myImpact() : null, getAnnouncements()]).then(([impact, news]) => {
      if (alive) setBellNew(activityHasNew(impact, new Date(), news[0]?.id ?? 0));
    });
    return () => { alive = false; };
  }, [active, personal, watched]);
  const [input, setInput] = useState("");
  const typing = input.length > 0;
  const inputId = useId(), inputRef = useRef<HTMLInputElement>(null);
  const placeholder = usePlaceholder(active && !typing);
  const greeting = greetingFor(me);
  const { chips, fresh, refresh, busy, row } = useChips(lang, active);
  const suggestions = useMemo(() => suggestionsFor(input, lang), [input, lang]);

  // Computers: the cursor is in the box on arrival. Phones: no keyboard until it is tapped.
  useEffect(() => { if (active && !coarsePointer()) inputRef.current?.focus({ preventScroll: true }); }, [active]);

  /** A surah chip shows the whole surah (nav.ts). */
  const go = (q: string, chip?: Chip) => {
    if (!q.trim()) return;
    openSearch(q, { surah: chip?.surah });
    setInput(""); // Back lands on a fresh Home
  };
  // The arrow keys walk from the box into the suggestions and back.
  const walk = (e: KeyboardEvent<HTMLElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".home-suggest button")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" && at < items.length - 1) { e.preventDefault(); items[at + 1].focus(); }
    else if (e.key === "ArrowUp" && at >= 0) { e.preventDefault(); (at === 0 ? inputRef.current : items[at - 1])?.focus(); }
  };

  return (
    <div className="home" data-active={active || undefined} data-typing={typing || undefined}>
      <header className="home-bar">
        <BrandLogo name={config.appName} />
        <div className="home-actions">
          {/* Signed in: the streak and the picture as one pill; else Log in, or the streak alone where there is no sign-in. */}
          {me ? <HomeMe active={active} /> : <><HomeAccount />{personal && <StreakPill active={active} />}</>}
          <button type="button" className="home-activity" data-new={bellNew || undefined} aria-label={bellNew ? t.navActivityNew : t.navActivity}
            onClick={() => navigate("activity")}><BellIcon /></button>
        </div>
      </header>

      <div className="home-stage" onKeyDown={walk}>
        <div className="home-hero">
          <div className="home-intro" aria-hidden={typing || undefined}>
            <div className="home-intro-in">
              <BrandMark />
              <p className="home-greeting">{greeting}</p>
              <h1 className="home-title">{t.homeTitle}</h1>
            </div>
          </div>

          <form className="home-box" role="search" onSubmit={(e) => { e.preventDefault(); go(input); }}>
            <label className="home-sr" htmlFor={inputId}>{t.homeTitle}</label>
            <input id={inputId} ref={inputRef} type="text" enterKeyHint="search" autoComplete="off" autoCapitalize="sentences" spellCheck={false}
              placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} />
            {typing && (
              <button type="button" className="home-clear" aria-label={t.homeClear} onClick={() => { setInput(""); inputRef.current?.focus(); }}>
                <span><CloseIcon /></span>
              </button>
            )}
            <button type="submit" className="home-go" aria-label={t.findLabel}><ArrowUpIcon /></button>
          </form>

          {typing ? (
            <>
              <ul className="home-suggest" aria-label={t.findLabel}>
                {suggestions.map((s) => (
                  <li key={s.key}>
                    <button type="button" onClick={() => go(s.q, s.chip)}>
                      <SearchIcon />
                      <span lang={s.lang} dir="auto">{s.text}</span>
                      <ArrowUpRightIcon />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="home-hint">{t.homeAnyLanguage}</p>
            </>
          ) : (
            <>
              <div className="home-chips" role="group" aria-label={t.topicsLabel} ref={row}
                // A mouse wheel scrolls the row sideways.
                onWheel={(e) => { const el = e.currentTarget; if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY; }}
                onPointerEnter={() => (busy.current = true)} onPointerLeave={() => (busy.current = false)}
                // Keyboard focus pauses the rotation; a tap or click (which also focuses the button) does not.
                onFocus={(e) => (busy.current = focusVisible(e.target))} onBlur={() => (busy.current = false)}>
                {chips.map((c) => (
                  <button key={c.id} type="button" lang={c.lang} dir="auto" className={c.id === fresh ? "fresh" : undefined}
                    onClick={() => go(c.q, c)}>{c.say}</button>
                ))}
                <button type="button" className="home-more" aria-label={t.moreTopics} title={t.moreTopics} onClick={refresh}><RefreshIcon /></button>
              </div>
              <p className="home-hint">{t.homeRefHint}</p>
              {watched
                ? <button type="button" className="home-pick" onClick={() => openPicker()}><PlusSquareIcon />{t.createNew}</button>
                : <button type="button" className="home-pick" aria-busy={opening || undefined} disabled={opening} onClick={watchToday}>
                    {opening ? <span className="spinner small" aria-hidden="true" /> : <PlayIcon />}{t.watchToday}</button>}
            </>
          )}
        </div>
      </div>
      <InstallStrip />
      <MadeBy className="screen-credit home-credit" />
    </div>
  );
}
