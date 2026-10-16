// The editor's panel (Editor v2): one tab always open, Ayah · Look · Text · Sound, and the pages some of them open in
// place (all backgrounds and colours, the translation, all reciters) with a way back. Phones show the panel under the
// preview with the tabs at the bottom; tablets and computers show it beside the preview with the tabs at the top
// (Create.tsx). Every control edits the recipe through actions.ts, so each change can be undone.
import { useEffect, useId, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from "react";
import type { Clip, Recipe } from "../../../../contracts/types";
import { changeRange, chooseBg, customise, openReflect, openReport, setFormat, setVoice } from "../actions";
import * as api from "../api";
import { allClips, clipById, mediaUrl } from "../api";
import { findClips } from "../backgrounds";
import {
  BG_COLOURS, BORDER_COLOURS, BOX_COLOURS, DEFAULT_HEADER, DEFAULT_POSITION, headerMoved, MAX_AYAHS, QURAN_FONTS, RECIPE_EXTRAS, RECITERS,
  TEXT_COLOURS, textMoved,
} from "../config";
import { rangeText, stripBasmala, translationLang } from "../design";
import { LOOK_RESET, LOOKS, lookOf, TEXT_RESET, type Look } from "../looks";
import { openPicker } from "../nav";
import { openSheet } from "../router";
import { t } from "../strings";
import { voiceFor, voiceOf, voicesFor } from "../voice";
import { ClipThumbs, RadioRows, Segmented, Stepper, Swatches, Tiles, Toggle, type RadioRow } from "./controls";
import { useAppState, useStore } from "./hooks";
import { CheckIcon, DownIcon, MinusIcon, OpenBookIcon, PlayIcon, PlusIcon, ReflectIcon, SearchIcon, SparkleIcon, WaveIcon } from "./icons";
import { editionLabel, TranslationPicker } from "./TranslationPicker";

export type Tab = "ayah" | "look" | "text" | "sound";
/** A page a tab opens in the panel. */
export type View = "bg" | "colours" | "translation" | "reciters";
const AaIcon = () => <span className="aa" aria-hidden="true">Aa</span>;
const BookIcon = () => <OpenBookIcon />;
/** The tabs in their order: id, label and icon. */
export const TABS: [Tab, string, () => JSX.Element][] = [
  ["ayah", t.edTabAyah, BookIcon], ["look", t.edTabLook, SparkleIcon], ["text", t.edTabText, AaIcon], ["sound", t.edTabSound, WaveIcon],
];
/** The title of a page the panel opened. */
export const VIEW_TITLE: Record<View, string> = {
  bg: t.edBackground, colours: t.edBackground, translation: t.edTranslation, reciters: t.edAllRecitersTitle,
};

/** A section's small heading (its id labels the group under it). */
function Section({ label, children, className = "" }: { label: string; children: (id: string) => JSX.Element | (JSX.Element | false | null)[]; className?: string }) {
  const id = useId();
  return (
    <div className={`ed-section ${className}`.trim()}>
      <span className="label" id={id}>{label}</span>
      {children(id)}
    </div>
  );
}

/** "More options" under a tab: closed until opened (again closed when the tab changes). */
function More({ label, children }: { label: string; children: JSX.Element }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ed-more">
      <button type="button" className="ed-more-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span><DownIcon />
      </button>
      {open && <div className="ed-more-body">{children}</div>}
    </div>
  );
}

type ColourKey = "textColor" | "boxColor" | "borderColor";
/** Swatches for one colour of the design: every move of the custom picker updates the preview (one undo step), closing
 *  it commits. */
function ColourRow({ name, palette, labelledBy }: { name: ColourKey; palette: string[]; labelledBy: string }) {
  const store = useStore();
  const { recipe: r } = useAppState();
  const patch = (c: string): Partial<Recipe> => ({ [name]: c });
  return (
    <Swatches labelledBy={labelledBy} colours={palette} value={r[name]}
      onPick={(c) => store.dispatch({ type: "patch", patch: patch(c) })}
      onChange={(c) => customise(store, patch(c), name)} />
  );
}

/** The design's first words (the Looks' and fonts' samples). */
const firstWords = (s: string, n: number) => s.split(/\s+/).slice(0, n).join(" ");

// ---------- Look ----------

const rgba = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};
/** A Look's text block, drawn small with CSS on the design's own background (the preview draws it on a canvas). */
function lookBlock(l: Look): CSSProperties {
  const a = l.boxOpacity / 100;
  const css: CSSProperties = { color: l.textColor, border: l.borderWidth ? `${l.borderWidth * 2}px solid ${l.borderColor}` : 0 };
  if (l.effect === "shade") css.boxShadow = "0 0 0 100vmax rgba(0,0,0,0.45)"; // the whole swatch shaded
  else if (l.effect === "glass") Object.assign(css, { background: rgba(l.boxColor, a * 0.55), backdropFilter: "blur(14px)" });
  else if (l.effect === "solid") css.background = rgba(l.boxColor, a);
  else if (l.effect === "shadow") css.textShadow = `0 2px 14px ${rgba(l.boxColor, Math.min(1, a + 0.3))}, 0 1px 3px ${rgba(l.boxColor, Math.min(1, a + 0.2))}`;
  if (l.effect === "outline") Object.assign(css, { outline: `4px solid ${rgba(l.boxColor, a)}`, outlineOffset: -4 });
  return css;
}

function Looks() {
  const store = useStore();
  const { recipe: r, ayahs } = useAppState();
  const on = lookOf(r);
  const clip = r.bg.type === "clip" ? clipById(r.bg.id) : null;
  const ar = firstWords(ayahs[0]?.ar ?? "", 2), tr = firstWords(ayahs[0]?.tr ?? "", 4);
  return (
    <Section label={t.edLooks}>{(id) => (
      <div className="ed-looks" role="group" aria-labelledby={id} data-coach="looks">
        {LOOKS.map((l, i) => (
          <button key={i} type="button" className="ed-look" aria-pressed={on === i} onClick={() => customise(store, l, "look")}>
            <span className="ed-look-frame" aria-hidden="true" style={{ background: r.bg.type === "colour" ? r.bg.colour : "#10241f" }}>
              {clip && <img src={mediaUrl(clip.thumb)} alt="" loading="lazy" decoding="async" />}
              <span className="ed-look-canvas">
                <span className="ed-look-block" style={lookBlock(l)}>
                  <span dir="rtl" lang="ar" style={{ fontFamily: `"${l.font}", var(--font-quran)`, fontSize: 16 + r.quranSize * 3.5 }}>{ar}</span>
                  {(r.showTranslation ?? true) && tr && <span className="ed-look-tr" style={{ fontSize: 9 + r.transSize * 1.5 }}>{tr}</span>}
                </span>
              </span>
            </span>
            <span className="ed-look-name">{t.edLookNames[i]}</span>
          </button>
        ))}
      </div>
    )}</Section>
  );
}

/** This ayah's suggested backgrounds (5), a plain colour and See all. */
function BgStrip({ open }: { open: (v: View) => void }) {
  const store = useStore();
  const { recipe: r, suggestions } = useAppState();
  const selected = r.bg.type === "clip" ? r.bg.id : null;
  return (
    <Section label={t.edBgPicked} className="ed-strip">{(id) => [
      <button key="all" type="button" className="ed-see-all" onClick={() => open("bg")}>{t.seeAll}</button>,
      <div key="row" className="ed-strip-row" role="group" aria-labelledby={id}>
        {suggestions === null ? <p className="ed-strip-note">{t.findingBackgrounds}</p>
          : suggestions.length === 0 ? <p className="ed-strip-note">{t.stripEmpty}</p>
          : suggestions.slice(0, 5).map((c) => (
            <button key={c.id} type="button" className="ed-thumb" aria-pressed={c.id === selected} aria-label={c.caption}
              onClick={() => chooseBg(store, { type: "clip", id: c.id }, "suggested")}>
              <img src={mediaUrl(c.thumb)} alt="" loading="lazy" decoding="async" width={240} height={426} />
            </button>
          ))}
        <button type="button" className="ed-thumb ed-colour-btn" onClick={() => open("colours")}><span aria-hidden="true" />{t.edColour}</button>
      </div>,
    ]}</Section>
  );
}

type Effect = NonNullable<Recipe["effect"]>;
const EFFECTS: [Effect, string][] = [
  ["shade", t.effectShade], ["glass", t.effectGlass], ["solid", t.effectSolid], ["shadow", t.effectShadow], ["outline", t.effectOutline], ["none", t.effectNone],
];

export function LookTab({ open }: { open: (v: View) => void }) {
  const store = useStore();
  const { recipe: r } = useAppState();
  const x = RECIPE_EXTRAS;
  const effect = r.effect ?? x.effect;
  return (
    <div className="panel">
      <Looks />
      <BgStrip open={open} />
      <More label={t.edMoreLook}>
        <>
          <Section label={t.edBoxStyle}>{(id) => (
            <Tiles labelledBy={id} className="effect-tiles" value={effect} onChange={(v) => customise(store, { effect: v }, "effect")}
              options={EFFECTS.map(([v, label]) => [v, label, <span className={`fx fx-${v}`}>Aa</span>])} />
          )}</Section>
          {effect !== "none" && effect !== "shade" && (
            <Section label={t.edBoxLabel[effect]}>{(id) => (
              <div className="ed-row">
                <ColourRow name="boxColor" palette={BOX_COLOURS} labelledBy={id} />
                <Stepper labelledBy={id} value={r.boxOpacity} min={0} max={100} step={10} suffix="%" onChange={(v) => customise(store, { boxOpacity: v }, "boxOpacity")} />
              </div>
            )}</Section>
          )}
          <Section label={t.edBorder}>{(id) => (
            <div className="ed-row">
              <ColourRow name="borderColor" palette={BORDER_COLOURS} labelledBy={id} />
              <Stepper labelledBy={id} value={r.borderWidth} min={0} max={8} onChange={(v) => customise(store, { borderWidth: v }, "borderWidth")} />
            </div>
          )}</Section>
          <Section label={t.edAnimation}>{(id) => [
            <Segmented<NonNullable<Recipe["animation"]>> key="seg" labelledBy={id} value={r.animation ?? x.animation}
              options={[["none", t.animNone], ["fade", t.animFade], ["rise", t.animRise], ["zoom", t.animZoom]]}
              onChange={(v) => customise(store, { animation: v }, "animation")} />,
            <p key="hint" className="hint">{t.animHint}</p>,
          ]}</Section>
          <div className="ed-section">
            <div className="toggles">
              <Toggle label={t.autoContrast} on={r.autoContrast ?? x.autoContrast} onChange={(v) => customise(store, { autoContrast: v }, "autoContrast")} />
            </div>
            <p className="hint">{t.autoContrastHint}</p>
          </div>
          <button type="button" className="btn small ed-reset" onClick={() => customise(store, LOOK_RESET, "reset")}>{t.edResetLook}</button>
        </>
      </More>
    </div>
  );
}

// ---------- Background (a page of Look) ----------

type BgTab = "ayah" | "library" | "colours";

export function BackgroundView({ start }: { start: BgTab }) {
  const store = useStore();
  const { recipe: r, suggestions } = useAppState();
  const selected = r.bg.type === "clip" ? r.bg.id : null;
  const [tab, setTab] = useState<BgTab>(start);
  const [q, setQ] = useState("");
  const [library, setLibrary] = useState<Clip[] | null>(null);
  const ids = { tabs: useId(), lib: useId(), grid: useId() };
  const token = useRef(0);

  const browse = (query: string) => {
    const mine = ++token.current;
    setLibrary(null);
    void findClips(query, 24).then((clips) => { if (mine === token.current) setLibrary(clips); });
  };
  useEffect(() => browse(""), []);

  return (
    <div className="panel">
      <div className="field">
        <span id={ids.tabs} className="sr-only">{t.tabBackground}</span>
        <Segmented<BgTab> labelledBy={ids.tabs} value={tab} onChange={setTab}
          options={[["ayah", t.bgForAyah], ["library", t.library], ["colours", t.bgColours]]} />
      </div>
      {tab === "ayah" && (
        <div className="field">
          <span id={ids.grid} className="sr-only">{t.suggested}</span>
          <ClipThumbs labelledBy={ids.grid} clips={suggestions} selected={selected} empty={t.noSuggestions}
            onPick={(c) => chooseBg(store, { type: "clip", id: c.id }, "suggested")} />
        </div>
      )}
      {tab === "library" && (
        <div className="field">
          <label htmlFor={ids.lib} className="sr-only">{t.libraryLabel}</label>
          <form className="search small" role="search" onSubmit={(e) => { e.preventDefault(); browse(q.trim()); }}>
            <SearchIcon />
            <input id={ids.lib} type="search" enterKeyHint="search" autoComplete="off" placeholder={t.libraryPlaceholder}
              value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <span id={ids.grid} className="sr-only">{t.library}</span>
          <ClipThumbs labelledBy={ids.grid} clips={library} selected={selected} empty={allClips().length ? t.noMatches : t.libraryFailed}
            onPick={(c) => chooseBg(store, { type: "clip", id: c.id }, "library")} />
        </div>
      )}
      {tab === "colours" && (
        <div className="field">
          <span id={ids.grid} className="sr-only">{t.solidColours}</span>
          <Swatches labelledBy={ids.grid} colours={BG_COLOURS} custom={false} label={t.backgroundColour}
            value={r.bg.type === "colour" ? r.bg.colour : null}
            onChange={(c) => chooseBg(store, { type: "colour", colour: c }, "colour")} />
        </div>
      )}
      {selected && clipById(selected) && (
        <button type="button" className="link-btn report-link"
          onClick={() => openReport(store, { kind: "background", clip: selected, ref: `${r.surah}:${r.from}` })}>{t.reportBackground}</button>
      )}
    </div>
  );
}

// ---------- Text ----------

/** Where the text block's centre goes for Top · Middle · Bottom: the preview's snapping thirds, and the default place. */
type Place = "top" | "middle" | "bottom";
const PLACES: Record<Place, number> = { top: 0.333, middle: DEFAULT_POSITION.textY, bottom: 0.667 };

/** The Quran fonts, so each font tile shows its own lettering (the preview loads the chosen one itself, draw.ts). */
const FONTS_CSS = `https://fonts.googleapis.com/css2?${QURAN_FONTS.map((f) => `family=${f.replace(/ /g, "+")}`).join("&")}&display=swap`;
const FONT_NAMES: Record<string, string> = { "Amiri Quran": "Amiri", "Scheherazade New": "Scheherazade", "Noto Naskh Arabic": "Naskh" };

export function TextTab() {
  const store = useStore();
  const { recipe: r, ayahs } = useAppState();
  const x = RECIPE_EXTRAS;
  const sample = firstWords(ayahs[0]?.ar ?? "", 2);
  const textX = r.textX ?? x.textX, textY = r.textY ?? x.textY;
  const place = (Object.keys(PLACES) as Place[]).find((p) => textX === 0.5 && Math.abs(PLACES[p] - textY) < 0.002);
  const size = (key: "quranSize" | "transSize", label: string, name: string) => (
    <div className="ed-size">
      <span className="label">{label}</span>
      <div>
        <button type="button" aria-label={t.edSmaller(name)} disabled={r[key] <= 1} onClick={() => customise(store, { [key]: r[key] - 1 }, key)}>A−</button>
        <output aria-live="polite">{r[key]}</output>
        <button type="button" aria-label={t.edBigger(name)} disabled={r[key] >= 8} onClick={() => customise(store, { [key]: r[key] + 1 }, key)}>A+</button>
      </div>
    </div>
  );
  return (
    <div className="panel">
      <link rel="stylesheet" href={FONTS_CSS} />
      <div className="ed-sizes">
        {size("quranSize", t.edArabic, t.edArabic)}
        {size("transSize", t.edTranslation, t.edTranslation.toLowerCase())}
      </div>
      <Section label={t.edArabicFont}>{(id) => (
        <Tiles labelledBy={id} className="font-tiles" value={r.font} onChange={(f) => customise(store, { font: f }, "font")}
          options={QURAN_FONTS.map((f) => [f, FONT_NAMES[f] ?? f, <span dir="rtl" lang="ar" style={{ fontFamily: `"${f}", var(--font-quran)` }}>{sample}</span>])} />
      )}</Section>
      <Section label={t.textColour}>{(id) => <ColourRow name="textColor" palette={TEXT_COLOURS} labelledBy={id} />}</Section>
      <Section label={t.edPosition}>{(id) => [
        <Segmented<Place> key="seg" labelledBy={id} value={place as Place}
          options={[["top", t.positionTop], ["middle", t.edPositionMiddle], ["bottom", t.positionBottom]]}
          onChange={(p) => customise(store, { textX: 0.5, textY: PLACES[p] }, "position")} />,
        <p key="hint" className="hint">{t.edPositionHint}</p>,
      ]}</Section>
      <Section label={t.edShowOnPicture}>{(id) => (
        <div className="toggles" role="group" aria-labelledby={id}>
          <Toggle label={t.showTranslation} on={r.showTranslation ?? x.showTranslation} onChange={(v) => customise(store, { showTranslation: v }, "showTranslation")} />
          <Toggle label={t.showSurah} on={r.showSurah ?? x.showSurah} onChange={(v) => customise(store, { showSurah: v }, "showSurah")} />
          <Toggle label={t.showRef} on={r.showRef ?? x.showRef} onChange={(v) => customise(store, { showRef: v }, "showRef")} />
        </div>
      )}</Section>
      <More label={t.edMoreText}>
        <div className="ed-resets">
          <button type="button" className="btn small" disabled={!textMoved(r)} onClick={() => customise(store, DEFAULT_POSITION, "position")}>{t.edResetTextPosition}</button>
          {(r.showSurah ?? x.showSurah) && (
            <button type="button" className="btn small" disabled={!headerMoved(r)} onClick={() => customise(store, DEFAULT_HEADER, "headerPosition")}>{t.edResetHeader}</button>
          )}
          <button type="button" className="btn small" onClick={() => customise(store, TEXT_RESET, "reset")}>{t.edResetText}</button>
        </div>
      </More>
    </div>
  );
}

// ---------- Ayah ----------

/** The ayahs just before and after the design (their first words), for Add before / Add after. */
function useNeighbours(r: Recipe, max: number) {
  const [words, setWords] = useState<Record<number, string>>({});
  const before = r.from > 1 ? r.from - 1 : 0, after = r.to < max ? r.to + 1 : 0;
  useEffect(() => {
    let alive = true;
    const lo = before || r.from, hi = after || r.to;
    void api.getAyahText(r.surah, lo, hi, "none").then(([ar]) => {
      if (!alive) return;
      const out: Record<number, string> = {};
      for (const a of ar.ayahs) out[a.numberInSurah] = firstWords(stripBasmala(a.text, r.surah, a.numberInSurah), 3);
      setWords(out);
    }, () => {});
    return () => { alive = false; };
  }, [r.surah, before, after]); // eslint-disable-line react-hooks/exhaustive-deps
  return { before, after, words };
}

/** `onRange`: the range changed here (a line to say so, with Undo; the ayah to show once its text is in). */
export function AyahTab({ open, onRange }: { open: (v: View) => void; onRange: (message: string, show: number) => void }) {
  const store = useStore();
  const { recipe: r, ayahs, current, surahs, editions, lang } = useAppState();
  const max = surahs[r.surah - 1]?.ayahs ?? r.to;
  const { before, after, words } = useNeighbours(r, max);
  const count = r.to - r.from + 1, full = count >= MAX_AYAHS;
  const ref = (num: number) => `${r.surah}:${num}`;
  const range = `${r.surah}:${rangeText(r)}`;
  const id = useId();
  /** Shows that ayah on the preview (the recitation stops first, so Play starts from it). */
  const show = (i: number) => {
    store.dispatch({ type: "play", on: false });
    store.dispatch({ type: "goTo", index: i });
  };
  const add = (num: number) => {
    changeRange(store, Math.min(r.from, num), Math.max(r.to, num));
    onRange(t.edAdded(ref(num)), num);
  };
  const remove = (num: number) => {
    changeRange(store, num === r.from ? r.from + 1 : r.from, num === r.to ? r.to - 1 : r.to);
    onRange(t.edRemoved(ref(num)), num === r.from ? r.from + 1 : r.from);
  };
  const addRow = (num: number, label: string) => (
    <button type="button" className="ed-add" onClick={() => add(num)}>
      <span className="ed-add-plus" aria-hidden="true"><PlusIcon /></span>
      <span className="ed-add-label">{label}</span>
      <span className="ed-add-words" dir="rtl" lang="ar" aria-hidden="true">{words[num] ?? ""}</span>
    </button>
  );
  const here = ayahs[current];
  return (
    <div className="panel">
      <div className="ed-section">
        <span className="label" id={id}>{surahs[r.surah - 1]?.name_en ?? ""}</span>
        {before > 0 && !full && addRow(before, t.edAddBefore(ref(before)))}
        <div className="ed-sel" role="group" aria-labelledby={id}>
          <div className="ed-sel-head"><CheckIcon />{t.edSelected(count, range, MAX_AYAHS)}</div>
          {ayahs.map((a, i) => (
            <div key={a.num} className="ed-sel-row">
              <span className="ed-sel-check" aria-hidden="true"><CheckIcon /></span>
              <button type="button" className="ed-sel-show" aria-current={i === current ? "true" : undefined} aria-label={t.edShowRow(ref(a.num))}
                onClick={() => show(i)}>
                <span className="ed-sel-ref">{i === current && <PlayIcon />}{ref(a.num)}</span>
                <span className="ed-sel-ar" dir="rtl" lang="ar">{a.ar}</span>
              </button>
              {count > 1 && (i === 0 || i === ayahs.length - 1) && (
                <button type="button" className="ed-sel-remove" aria-label={t.edRemove(ref(a.num))} onClick={() => remove(a.num)}>
                  <span><MinusIcon /></span>
                </button>
              )}
            </div>
          ))}
        </div>
        {after > 0 && !full && addRow(after, t.edAddAfter(ref(after)))}
        {full && <p className="ed-note">{t.edAtMax}</p>}
        <div className="ed-sel-foot">
          <span><PlayIcon />{t.edOnPreview}</span>
          <button type="button" className="link-btn" onClick={() => openPicker({ surah: r.surah, from: r.from, to: r.to })}>{t.edChooseOther}</button>
        </div>
      </div>
      <Section label={t.edTranslation}>{() => (
        <button type="button" className="ed-row-btn" onClick={() => open("translation")}>
          <span><strong>{editionLabel(r.translation, editions, lang)}</strong><small>{t.edTranslationUnder}</small></span>
          <span className="ed-change">{t.edChange}</span>
        </button>
      )}</Section>
      <div className="ed-section">
        <div className="toggles">
          <Toggle label={t.edSplitLong} on={r.splitLong ?? RECIPE_EXTRAS.splitLong} onChange={(v) => customise(store, { splitLong: v }, "splitLong")} />
        </div>
        <p className="hint">{t.edSplitHint}</p>
      </div>
      {here && (
        <button type="button" className="btn small reflect-btn"
          onClick={() => { openReflect(store, ref(here.num), "create"); openSheet("reflect"); }}>
          <ReflectIcon /><span>{t.reflectOn(ref(here.num))}</span>
        </button>
      )}
    </div>
  );
}

export function TranslationView() {
  const store = useStore();
  const { recipe: r } = useAppState();
  return (
    <div className="panel">
      <TranslationPicker label={t.edTranslation} value={r.translation} onChange={(v) => customise(store, { translation: v }, "translation")} />
    </div>
  );
}

// ---------- Sound ----------

/** The reciters offered (RECITERS is set at start, less those the admin turned off). */
const reciterRows = (): RadioRow[] => RECITERS.map(([value, label]) => ({ value, label }));

/** Translation voice: offered when the design's translation is in a language with a recorded voice. */
function VoiceField() {
  const store = useStore();
  const { recipe: r, editions, lang: myLang } = useAppState();
  const voiceId = useId();
  const lang = r.translation === "none" ? null : translationLang(r.translation, editions);
  const voices = lang ? voicesFor(lang, editions) : [];
  const on = voiceOf(r), offer = on ?? (lang ? voiceFor(lang, r.translation, editions) : null);
  const edition = (e: string) => editions[e]?.englishName ?? e;
  if (!offer) return null;
  return (
    <div className="ed-section voice-field">
      <Toggle label={t.hearMeaning(myLang)} on={!!on} onChange={(v) => setVoice(store, v ? offer : null)} />
      <p className="hint" id={voiceId}>{t.voiceHint}{on && <> {t.voiceShowing(edition(on.text))}</>}</p>
      {on && voices.length > 1 && (
        <RadioRows labelledBy={voiceId} value={on.id} rows={voices.map((v) => ({ value: v.id, label: edition(v.text) }))}
          onChange={(v) => setVoice(store, voices.find((x) => x.id === v) ?? null)} />
      )}
    </div>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** `length`: the video's length in seconds (from the preview's recitation). */
export function SoundTab({ open, length }: { open: (v: View) => void; length: number }) {
  const store = useStore();
  const { recipe: r, format } = useAppState();
  // The first four reciters; the one chosen from all of them takes the fourth row.
  const all = reciterRows(), at = all.findIndex((row) => "value" in row && row.value === r.reciter);
  const rows = at > 3 ? [...all.slice(0, 3), all[at]] : all.slice(0, 4);
  return (
    <div className="panel">
      {format === "image" && (
        <div className="ed-card">
          <p>{t.edImageSilent}</p>
          <button type="button" className="ed-gold" onClick={() => setFormat(store, "video")}>{t.edSwitchVideo}</button>
        </div>
      )}
      <Section label={t.edReciter}>{(id) => [
        <RadioRows key="rows" labelledBy={id} value={r.reciter} rows={rows} onChange={(v) => customise(store, { reciter: v }, "reciter")} />,
        <button key="all" type="button" className="link-btn ed-all" onClick={() => open("reciters")}>{t.edAllReciters(RECITERS.length)}</button>,
      ]}</Section>
      <VoiceField />
      <div className="ed-card ed-length">
        <span><strong>{t.edLength}</strong><small>{voiceOf(r) ? t.edLengthVoice : t.edLengthNote}</small></span>
        <output>{mmss(length)}</output>
      </div>
    </div>
  );
}

export function RecitersView() {
  const store = useStore();
  const { recipe: r } = useAppState();
  const id = useId();
  return (
    <div className="panel">
      <span id={id} className="sr-only">{t.edAllRecitersTitle}</span>
      <RadioRows labelledBy={id} value={r.reciter} rows={reciterRows()} onChange={(v) => customise(store, { reciter: v }, "reciter")} />
    </div>
  );
}

// ---------- the tabs ----------

/** The four tabs: one is always selected (arrow keys, Home and End move between them). */
export function TabBar({ tab, onTab, panelId }: { tab: Tab; onTab: (tab: Tab) => void; panelId: string }) {
  const base = useId();
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const [id] = TABS[(next + TABS.length) % TABS.length];
    onTab(id);
    document.getElementById(`${base}-${id}`)?.focus();
  };
  return (
    <div className="ed-tabs" role="tablist" aria-label={t.edTabs}>
      {TABS.map(([id, label, Icon], i) => (
        <button key={id} id={`${base}-${id}`} type="button" role="tab" className="ed-tab" aria-selected={tab === id} aria-controls={panelId}
          tabIndex={tab === id ? 0 : -1} onClick={() => onTab(id)} onKeyDown={(e) => onKey(e, i)}>
          <span className="ed-tab-icon"><Icon /></span><span>{label}</span>
        </button>
      ))}
    </div>
  );
}
