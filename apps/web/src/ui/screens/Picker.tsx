// Pick an ayah yourself: the surah list (search a name, meaning or number, or type a reference like 94:5), then the ayahs of
// the chosen surah: tap one, tap the next one or two to show them one after another (up to 3 in a row), read them, and
// Create. Opened with a surah and ayahs already chosen from the editor's "Choose different ayahs" (nav.ts openPicker).
import { useEffect, useMemo, useState } from "react";
import type { Surah } from "../../../../../contracts/types";
import { selectAyahs } from "../../actions";
import { MAX_AYAHS } from "../../config";
import { translationLang } from "../../design";
import { openPicker } from "../../nav";
import { ayahText, type ResultText } from "../../results";
import { back, navigate } from "../../router";
import { parseRef } from "../../search";
import { t } from "../../strings";
import { useAppState, usePickStart, useStore } from "../hooks";
import { BackIcon, CloseIcon, NextIcon, SearchIcon } from "../icons";
import "./picker.css";

interface Sel { a: number; b: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** "البقرة" from "سُورَةُ البَقَرَةِ": the word "surah" in front of the name is left out (the heading says it). */
const arabicName = (s: Surah) => {
  const [first, ...rest] = s.name_ar.split(" ");
  return rest.length && first.replace(/\p{M}/gu, "") === "سورة" ? rest.join(" ") : s.name_ar;
};
const refText = (surah: number, s: Sel) => `${surah}:${s.a}${s.b > s.a ? `–${s.b}` : ""}`;

/** The ayah tapped next, given what is chosen: the first tap picks one; a tap within reach of the first one makes a
 *  range up to MAX_AYAHS; tapping the only chosen one again clears it; anything else starts again from it. */
export function tapAyah(sel: Sel | null, k: number): Sel | null {
  if (!sel) return { a: k, b: k };
  if (k === sel.a && k === sel.b) return null;
  if (k >= sel.a && k <= sel.a + MAX_AYAHS - 1) return { a: sel.a, b: k };
  if (k < sel.a && sel.b - k <= MAX_AYAHS - 1) return { a: k, b: sel.b };
  return { a: k, b: k };
}

/** A typed reference ("94:5", "94 5", "94:5-6") that exists, as a surah and ayahs. */
function typedRef(q: string, surahs: Surah[]): { surah: number; sel: Sel } | null {
  const r = parseRef(q.trim().replace(/^(\d+)\s+(\d+)$/, "$1:$2"));
  const total = r ? surahs[r.surah - 1]?.ayahs : undefined;
  if (!r || !total || r.from < 1 || r.from > total) return null;
  return { surah: r.surah, sel: { a: r.from, b: Math.min(Math.max(r.to, r.from), total, r.from + MAX_AYAHS - 1) } };
}

/** The chosen ayahs' Arabic and translation, from the same cached surah files the editor uses. */
function usePreview(surah: number | null, sel: Sel | null, translation: string) {
  const [items, setItems] = useState<{ num: number; text: ResultText }[] | null | "failed">(null);
  const a = sel?.a, b = sel?.b;
  useEffect(() => {
    if (!surah || a === undefined || b === undefined) { setItems(null); return; }
    let alive = true;
    setItems(null);
    const nums = Array.from({ length: b - a + 1 }, (_, i) => a + i);
    Promise.all(nums.map((n) => ayahText(`${surah}:${n}`, translation))).then(
      (parts) => alive && setItems(parts.map((text, i) => ({ num: nums[i], text }))),
      () => alive && setItems("failed"),
    );
    return () => { alive = false; };
  }, [surah, a, b, translation]);
  return items;
}

export function Picker({ active }: { active: boolean }) {
  const store = useStore();
  const { surahs, recipe, editions } = useAppState();
  const start = usePickStart();
  const [surah, setSurah] = useState<number | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [q, setQ] = useState("");
  const preview = usePreview(surah, sel, recipe.translation);

  // Each time the picker opens: the surah list, or the surah and ayahs it was opened with.
  useEffect(() => {
    if (!active) return;
    const total = start ? surahs[start.surah - 1]?.ayahs : undefined;
    setQ("");
    if (!start || !total) { setSurah(null); setSel(null); return; }
    setSurah(start.surah);
    const a = Math.min(Math.max(1, start.from ?? 0), total);
    setSel(start.from ? { a, b: Math.min(Math.max(start.to ?? a, a), total, a + MAX_AYAHS - 1) } : null);
  }, [active, start, surahs]);
  // A different surah starts at the top.
  useEffect(() => { if (active) window.scrollTo?.({ top: 0 }); }, [active, surah]);

  const cur = surah ? surahs[surah - 1] : undefined;
  // One card per chosen ayah: its text, or an empty one while it loads.
  const cards: ({ num: number; text: ResultText } | null)[] = Array.isArray(preview) ? preview : Array.from({ length: sel ? sel.b - sel.a + 1 : 0 }, () => null);
  const hit = useMemo(() => typedRef(q, surahs), [q, surahs]);
  const list = useMemo(() => {
    const text = q.trim(), n = norm(text);
    if (!text || (/^\d+[\s:.-]+\d+/.test(text) && hit)) return surahs;
    return surahs.filter((s) => String(s.n) === text || (n && (norm(s.name_en).includes(n) || norm(s.meaning).includes(n))) || s.name_ar.includes(text));
  }, [q, surahs, hit]);

  const open = (n: number, chosen: Sel | null = null) => { setSurah(n); setSel(chosen); setQ(""); };
  const backToList = () => { setSurah(null); setSel(null); setQ(""); };
  const create = () => {
    if (!surah || !sel) return;
    store.dispatch({ type: "query", q: "" }); // backgrounds follow the surah, not an earlier search
    selectAyahs(store, surah, sel.a, sel.b);
    openPicker({ surah, from: sel.a, to: sel.b }); // coming back here shows this pick
    navigate("create");
  };

  return (
    <div className="pick" data-active={active || undefined}>
      <header className="pick-head">
        <div className="pick-head-in">
          <button type="button" className="pick-back" aria-label={cur ? t.pickBackToSurahs : t.close}
            onClick={() => (cur ? backToList() : back())}>
            {cur ? <BackIcon /> : <CloseIcon />}
          </button>
          <div className="pick-heading">
            <h1>{cur?.name_en ?? t.pickNew}</h1>
            <p>{cur ? `${cur.meaning} · ${t.resAyahCount(cur.ayahs)}` : t.pickSub}</p>
          </div>
          {cur && <span className="pick-ar" lang="ar" dir="rtl">{arabicName(cur)}</span>}
        </div>
      </header>

      {!cur ? (
        <div className="pick-body">
          <form className="pick-search" role="search" onSubmit={(e) => {
            e.preventDefault();
            if (hit) open(hit.surah, hit.sel);
            else if (list.length === 1) open(list[0].n);
          }}>
            <SearchIcon />
            <label className="pick-sr" htmlFor="pick-q">{t.pickSearchLabel}</label>
            <input id="pick-q" type="text" enterKeyHint="go" autoComplete="off" placeholder={t.pickSearchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          {hit && (
            <button type="button" className="pick-goto" onClick={() => open(hit.surah, hit.sel)}>
              <span>{t.pickGoTo(surahs[hit.surah - 1].name_en, refText(hit.surah, hit.sel))}</span><NextIcon />
            </button>
          )}
          {list.length ? (
            <ul className="pick-list">
              {list.map((s) => (
                <li key={s.n}>
                  <button type="button" onClick={() => open(s.n)}>
                    <span className="pick-num">{s.n}</span>
                    <span className="pick-names"><b>{s.name_en}</b><small>{s.meaning} · {t.resAyahCount(s.ayahs)}</small></span>
                    <span className="pick-ar" lang="ar" dir="rtl">{arabicName(s)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="pick-note">{t.pickNoSurah(q.trim())}</p>}
        </div>
      ) : (
        <>
          <div className="pick-body pick-ayahs">
            <p className="pick-hint">{t.pickHint}</p>
            <div className="pick-grid" role="group" aria-label={cur.name_en}>
              {Array.from({ length: cur.ayahs }, (_, i) => i + 1).map((n) => {
                const on = !!sel && n >= sel.a && n <= sel.b;
                return <button key={n} type="button" aria-pressed={on} aria-label={t.pickAyahNumber(n)} onClick={() => setSel(tapAyah(sel, n))}>{n}</button>;
              })}
            </div>
            {sel && (
              <section className="pick-preview" aria-label={t.previewLabel}>
                <h2>{t.previewLabel}</h2>
                {preview === "failed" ? <p className="pick-note">{t.pickPreviewFailed}</p>
                  : cards.map((p, i) => (
                    <div key={sel.a + i} className="pick-card" aria-busy={!p}>
                      {p ? (
                        <>
                          <p className="pick-card-ar" lang="ar" dir="rtl">{p.text.ar}</p>
                          {p.text.tr && <p className="pick-card-tr" lang={translationLang(recipe.translation, editions)} dir="auto">{p.text.tr}</p>}
                        </>
                      ) : <span className="pick-line" aria-hidden="true" />}
                      <p className="pick-card-ref">{surah}:{sel.a + i}</p>
                    </div>
                  ))}
              </section>
            )}
          </div>
          <div className="pick-foot">
            <div className="pick-foot-in">
              <button type="button" className="pick-create" aria-disabled={!sel} onClick={create}>
                {sel ? t.pickCreate(refText(surah!, sel)) : t.pickFirst}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
