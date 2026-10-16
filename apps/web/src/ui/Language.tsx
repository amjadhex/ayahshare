// "My language": the picker (asked once on first open, skippable; opened again from Find, the feed and Preferences) and the
// small button that shows the current language and opens it. On first open a language that has several translations is
// followed by a second question in the same dialog: which one to read by default (its recommended translation first,
// a "Voice" badge where a recorded voice reads it, and "Decide later"). The answer is the default-translation preference.
import { useEffect, useMemo, useRef, useState } from "react";
import { setLanguage, setPrefs, skipLanguage } from "../actions";
import { RTL } from "../config";
import { LANGUAGES, languageOf, translationFor } from "../lang";
import { t } from "../strings";
import { byLanguage, matches, queryWords } from "../translations";
import { focusForKeyboard, quietFocus } from "./focus";
import { ItemRows, LangName } from "./GroupedPicker";
import { useAppState, useStore } from "./hooks";
import { BackIcon, CloseIcon, GlobeIcon, SearchIcon } from "./icons";
import { translationItem } from "./TranslationPicker";

export function LanguageButton({ className = "lang-btn" }: { className?: string }) {
  const store = useStore();
  const { lang } = useAppState();
  const name = languageOf(lang).native;
  return (
    <button type="button" className={className} aria-label={t.languageLabel(name)} title={t.myLanguage}
      onClick={() => store.dispatch({ type: "langPicker", open: "change" })}>
      <GlobeIcon /><span dir="auto">{name}</span>
    </button>
  );
}

export function LanguageDialog() {
  const store = useStore();
  const { lang, langPicker, editions, prefs } = useAppState();
  const ref = useRef<HTMLDialogElement>(null);
  const first = langPicker === "first";
  // A search over the languages' own and English names (any script; case and accents ignored). Each opening starts
  // with the whole list.
  const [q, setQ] = useState("");
  useEffect(() => { if (!langPicker) { setQ(""); setChosen(null); } }, [langPicker]);
  /** First open: the language picked, while its translation is asked. */
  const [chosen, setChosen] = useState<string | null>(null);
  const offered = useMemo(() => (chosen ? byLanguage(editions, translationFor).find((g) => g.code === chosen) : undefined), [chosen, editions]);
  const words = queryWords(q);
  const shown = words.length ? LANGUAGES.filter((l) => matches(words, [l.native, l.english])) : LANGUAGES;
  useEffect(() => {
    const d = ref.current!;
    if (langPicker && !d.open) {
      d.showModal();
      quietFocus(d);
    } else if (!langPicker && d.open) d.close();
  }, [langPicker]);
  useEffect(() => { if (chosen) focusForKeyboard(ref.current?.querySelector<HTMLElement>(".lang-translations input")); }, [chosen]);
  const close = () => (first ? (chosen ? setLanguage(store, chosen) : skipLanguage(store)) : store.dispatch({ type: "langPicker", open: null }));
  /** A language picked. On first open, one with several translations asks which to read before the dialog closes. */
  const choose = (code: string) => {
    if (first && (byLanguage(editions, translationFor).find((g) => g.code === code)?.editions.length ?? 0) > 1) {
      setChosen(code);
      return;
    }
    setLanguage(store, code);
  };
  const chooseTranslation = (id: string) => {
    if (!chosen) return;
    setLanguage(store, chosen);
    setPrefs(store, { ...store.getState().prefs, translation: id });
  };
  return (
    <dialog ref={ref} className="dialog wide lang-dialog" aria-labelledby="langTitle" onCancel={(e) => { e.preventDefault(); close(); }}>
      {langPicker && chosen && offered && (
        <>
          <div className="dialog-head">
            <h3 id="langTitle">{t.firstTranslationTitle}</h3>
            <button type="button" className="icon-btn" aria-label={t.close} onClick={close}><CloseIcon /></button>
          </div>
          <p className="muted">{t.firstTranslationIntro}</p>
          <div className="trp lang-translations">
            <div className="trp-bar">
              <button type="button" className="trp-back" onClick={() => setChosen(null)}><BackIcon /><span>{t.trLanguages}</span></button>
              <h4 className="trp-title"><LangName {...offered} /></h4>
            </div>
            <ItemRows label={`${t.defaultTranslation}: ${offered.english}`} value={prefs.translation ?? ""} items={offered.editions.map((e) => translationItem(e, t.trRecommended))}
              onPick={chooseTranslation} dataAutofocus={false} confirm />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={close}>{t.decideLater}</button>
          </div>
        </>
      )}
      {langPicker && !(chosen && offered) && (
        <>
          <div className="dialog-head">
            <h3 id="langTitle">{first ? t.chooseLanguage : t.myLanguage}</h3>
            <button type="button" className="icon-btn" aria-label={t.close} onClick={close}><CloseIcon /></button>
          </div>
          <p className="muted">{t.languageIntro}</p>
          <div className="search small lang-search">
            <SearchIcon />
            <input type="search" aria-label={t.languageSearch} placeholder={t.languageSearch} value={q} autoComplete="off" spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); setQ(""); } }} />
          </div>
          <div className="lang-grid" role="group" aria-label={t.myLanguage}>
            {shown.map((l) => (
              <button key={l.code} type="button" lang={l.code} aria-pressed={l.code === lang} onClick={() => choose(l.code)}>
                <strong dir={RTL.has(l.code) ? "rtl" : "auto"}>{l.native}</strong>{l.native !== l.english && <small>{l.english}</small>}
              </button>
            ))}
          </div>
          {!shown.length && <p className="muted lang-none" role="status">{t.languageNothingFound(q.trim())}</p>}
          {first && (
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={close}>{t.languageSkip}</button>
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
