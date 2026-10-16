// One picker in two steps, for every long list the app has (the translations of the editor's Language tool, the default
// translation in Preferences and the first-run question, and Reflect's tafsirs): first the language (My language first,
// then the others by name, a search over their names and over what they contain, each row with its own name, its English
// name and how many items it has), then only that language's items (short name, the full name under it, badges such as
// "Voice", the current one marked). The second step opens on the current choice's language, with "‹ Languages" to go
// back; a language with a single item is picked by picking the language. Pinned choices that belong to no language
// (My language's default, "Arabic only") sit above the languages. Also here: `ItemRows`, the radio rows of one list (used
// by the first-run question and the option sheets of PickerRow.tsx).
// Keyboard: a labelled search box (Down goes into the languages), Up / Down / Home / End along the languages, radio keys
// along the items; Escape clears the search, then goes back to the languages, and only then reaches the host (a sheet
// closes, Reflect's chooser closes).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../strings";
import { matches, queryWords, type LanguageName } from "../translations";
import { focusForKeyboard } from "./focus";
import { BackIcon, NextIcon, SearchIcon } from "./icons";
import "./translation-picker.css";

/** A language's name as shown: its own name (right to left where it is written so), then its English name. */
export function LangName({ code, native, english, rtl }: { code: string; native: string; english: string; rtl: boolean }) {
  return (
    <>
      <span className="trp-native" lang={code} dir={rtl ? "rtl" : "ltr"}>{native}</span>
      {english !== native && <> <span className="trp-english">{english}</span></>}
    </>
  );
}

export interface PickItem {
  id: string;
  /** The short name. */
  name: string;
  /** Under the name: the full name, an author. */
  detail?: string;
  badges?: ReactNode;
  /** Language of `name` and `detail`, when it is not the page's. */
  lang?: string;
  /** More words the search matches. */
  search?: string[];
}
export interface PickGroup extends LanguageName { items: PickItem[] }

const ARROWS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/** The radio rows of one list. `onDone(id)`: after a pick by tap, click, Space or Enter (not by arrow keys), also for the
 *  current one tapped again. */
export function ItemRows({ items, value, onPick, onDone, label, dataAutofocus = true, confirm = false }: {
  items: PickItem[]; value: string; onPick: (id: string) => void; onDone?: (id: string) => void; label: string; dataAutofocus?: boolean;
  /** A choice that cannot be undone by moving on (the first-run question): the arrow keys only move, a tap or Space picks. */
  confirm?: boolean;
}) {
  const uid = useId();
  const arrows = useRef(false);
  const pick = (id: string) => {
    const byArrow = arrows.current;
    arrows.current = false;
    if (confirm && byArrow) return;
    if (id !== value) onPick(id);
    if (!byArrow) onDone?.(id);
  };
  return (
    <div className="trp-group" role="radiogroup" aria-label={label}
      onKeyDown={(e) => { arrows.current = e.key.startsWith("Arrow"); }} onPointerDown={() => { arrows.current = false; }}>
      {items.map((it, i) => (
        <label key={it.id} className="trp-row">
          <input type="radio" name={uid} value={it.id} checked={it.id === value} onChange={() => pick(it.id)} onClick={() => it.id === value && pick(it.id)}
            data-autofocus={(dataAutofocus && (it.id === value || (i === 0 && !items.some((x) => x.id === value)))) || undefined}
            aria-labelledby={`${uid}-${i}`} aria-describedby={it.detail || it.badges ? `${uid}-${i}-d` : undefined} />
          <span className="trp-dot" aria-hidden="true" />
          <span className="trp-text">
            <span id={`${uid}-${i}`} className="trp-name" lang={it.lang} dir="auto">{it.name}</span>
            {(it.detail || it.badges) && (
              <span id={`${uid}-${i}-d`} className="trp-detail">
                {it.detail && <span lang={it.lang} dir="auto">{it.detail}</span>}
                {it.badges}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

export function GroupedPicker({ groups, value, mine, onPick, onDone, label, searchLabel, noun, nothingFound, pinned = [], mineEmpty, loading }: {
  groups: PickGroup[];
  /** The current choice's id (it may be a pinned one, or in no group while the list loads). */
  value: string;
  /** My language's code. */
  mine: string;
  onPick: (id: string) => void;
  onDone?: (id: string) => void;
  /** The radio groups' name for screen readers (the language is added). */
  label: string;
  searchLabel: string;
  /** "3 translations". */
  noun: (n: number) => string;
  nothingFound: (q: string) => string;
  /** Choices that belong to no language, above the languages. */
  pinned?: PickItem[];
  /** What to say when My language has no items. */
  mineEmpty?: string;
  loading?: string;
}) {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const focusNext = useRef<string[] | null>(null);
  const [q, setQ] = useState("");
  const currentGroup = groups.find((g) => g.items.some((i) => i.id === value));
  /** The language whose items are shown; null: the languages. Opens on the current choice's language. */
  const [view, setView] = useState<string | null>(() => currentGroup?.code ?? null);
  const shown = view ? groups.find((g) => g.code === view) : undefined;
  const searching = !!q.trim();

  useEffect(() => {
    if (!focusNext.current) return;
    for (const sel of focusNext.current) {
      const el = root.current?.querySelector<HTMLElement>(sel);
      if (el) { focusForKeyboard(el); break; }
    }
    focusNext.current = null;
  });

  const ordered = useMemo(() => {
    const first = groups.filter((g) => g.code === mine), rest = groups.filter((g) => g.code !== mine);
    return [...first, ...rest];
  }, [groups, mine]);
  const found = useMemo(() => {
    const words = queryWords(q);
    if (!words.length) return [];
    return ordered.flatMap((g) => {
      const byName = matches(words, [g.native, g.english]);
      // An item matches by its own names and its language's ("tamil baqavi").
      const hits = g.items.filter((i) => matches(words, [i.name, i.detail ?? "", ...(i.search ?? []), g.native, g.english]));
      return byName || hits.length ? [{ g, hits: byName ? [] : hits }] : [];
    });
  }, [ordered, q]);

  const openLanguage = (g: PickGroup) => {
    if (g.items.length === 1) { // one item: the language is the choice
      onPick(g.items[0].id);
      onDone?.(g.items[0].id);
      return;
    }
    setView(g.code);
    setQ("");
    focusNext.current = [".trp-group input:checked", ".trp-group input"];
  };
  const leave = () => {
    const was = view;
    setView(null);
    focusNext.current = [`.trp-lang[data-code="${was}"]`, ".trp-lang"];
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (searching) { e.preventDefault(); e.stopPropagation(); setQ(""); searchBox.current?.focus(); }
      else if (view) { e.preventDefault(); e.stopPropagation(); leave(); }
      return;
    }
    if (view !== null || !ARROWS.has(e.key)) return;
    const items = [...root.current!.querySelectorAll<HTMLElement>(".trp-lang")];
    const at = document.activeElement;
    if (at === searchBox.current) {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      (items.find((b) => b.getAttribute("aria-current") === "true") ?? items[0])?.focus();
      return;
    }
    const i = items.indexOf(at as HTMLElement);
    if (i < 0) return;
    const next = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
    e.preventDefault();
    if (next < 0) searchBox.current?.focus(); else items[Math.min(next, items.length - 1)]?.focus();
  };

  const languageRow = (g: PickGroup, hits: PickItem[] = []) => (
    <li key={g.code}>
      <button type="button" className="trp-lang" data-code={g.code} aria-current={g.code === currentGroup?.code ? "true" : undefined} onClick={() => openLanguage(g)}>
        <span className="trp-lang-text">
          <span className="trp-lang-names"><LangName {...g} /></span>
          {hits.length > 0 && <span className="trp-lang-hits" dir="auto">{hits.slice(0, 2).map((h) => h.name).join(" · ")}</span>}
        </span>
        <span className="trp-lang-meta">
          {g.code === mine && <span className="trp-badge">{t.myLanguage}</span>}
          <span>{noun(g.items.length)}</span>
        </span>
        <NextIcon />
      </button>
    </li>
  );

  let body: ReactNode;
  if (!groups.length) {
    // Still loading: the current choice (if it is a pinned one, with them) and what is pinned.
    body = (
      <>
        {loading && <p className="hint">{loading}</p>}
        {pinned.length > 0 && <ItemRows items={pinned} value={value} onPick={onPick} onDone={onDone} label={label} />}
      </>
    );
  } else if (searching) {
    body = (
      <>
        <p className="sr-only" role="status">{found.length ? t.trLanguagesFound(found.length) : nothingFound(q.trim())}</p>
        {found.length === 0
          ? <p className="hint trp-empty" aria-hidden="true">{nothingFound(q.trim())}</p>
          : <ul className="trp-langs">{found.map(({ g, hits }) => languageRow(g, hits))}</ul>}
      </>
    );
  } else if (shown) {
    body = (
      <>
        <div className="trp-bar">
          <button type="button" className="trp-back" onClick={leave}><BackIcon /><span>{t.trLanguages}</span></button>
          <h3 className="trp-title" id={`${uid}-lang`}><LangName {...shown} /></h3>
        </div>
        <ItemRows items={shown.items} value={value} onPick={onPick} onDone={onDone} label={`${label}: ${shown.english}`} />
      </>
    );
  } else {
    body = (
      <>
        {pinned.length > 0 && <ItemRows items={pinned} value={value} onPick={onPick} onDone={onDone} label={label} />}
        <section className="trp-section" aria-labelledby={`${uid}-all`}>
          <h3 id={`${uid}-all`} className="trp-heading">{t.trLanguages} · {groups.length}</h3>
          {!groups.some((g) => g.code === mine) && mineEmpty && <p className="rf-none trp-mine-empty">{mineEmpty}</p>}
          <ul className="trp-langs">{ordered.map((g) => languageRow(g))}</ul>
        </section>
      </>
    );
  }

  return (
    <div className="trp" ref={root} tabIndex={-1} onKeyDown={onKeyDown}>
      {(view === null || searching) && (
        <div className="search small trp-search">
          <SearchIcon />
          <input ref={searchBox} type="search" aria-label={searchLabel} placeholder={searchLabel} value={q} autoComplete="off" spellCheck={false}
            enterKeyHint="search" aria-controls={`${uid}-list`} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="trp-list" id={`${uid}-list`}>{body}</div>
    </div>
  );
}
