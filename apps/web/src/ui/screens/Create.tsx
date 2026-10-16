// Create: the editor (Editor v2), dark on every screen size.
// Phones: full screen. A top bar (Close, Undo, Redo, the Format pill that opens the Format card: video or image, 9:16 ·
// 1:1 · 16:9; Next to Share), the preview at a fixed size with its player (Stage.tsx), and under it a panel that is
// always open, with one tab always selected (Look first) and the tabs at the bottom: Ayah · Look · Text · Sound. A tab's
// content changes in place; its further pages (all backgrounds, the translation, all reciters) open inside the panel with
// a way back. The first time on a device, three tips point at the text, the Looks and Next.
// Tablets and computers: the same, with Video / Image and the sizes in the top bar and the panel beside the preview
// (its tabs at the top).
// Every change to the design can be undone (state.ts edits); adding or removing an ayah says so, with Undo.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { customise, redo, setFormat, undo } from "../../actions";
import { designTitle } from "../../design";
import { platform } from "../../platform";
import { back, navigate } from "../../router";
import { t } from "../../strings";
import { useAppState, useStore } from "../hooks";
import { CloseIcon, DownIcon, NextIcon, PrevIcon, RedoIcon, UndoIcon } from "../icons";
import {
  AyahTab, BackgroundView, LookTab, RecitersView, SoundTab, TabBar, TABS, TextTab, TranslationView, VIEW_TITLE, type Tab, type View,
} from "../panels";
import { Stage } from "../Stage";
import "./create.css";

const ORIENTATIONS = ["portrait", "square", "landscape"] as const;
const TOAST_MS = 4000;

/** The tips are shown once on each device. */
const TIPS_SEEN = "qd.editorTips";
const tipsSeen = () => { try { return localStorage.getItem(TIPS_SEEN) === "1"; } catch { return true; } };
const seeTips = () => { try { localStorage.setItem(TIPS_SEEN, "1"); } catch { /* private mode: shown again next time */ } };

export function Create({ active, phone }: { active: boolean; phone: boolean }) {
  const store = useStore();
  const s = useAppState(), r = s.recipe;
  const [tab, setTab] = useState<Tab>("look");
  const [view, setView] = useState<View | null>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [length, setLength] = useState(0);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [tip, setTip] = useState(() => (tipsSeen() ? 0 : 1));
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  const openTab = (id: Tab) => {
    if (id !== tab) platform.haptic();
    setTab(id);
    setView(null);
  };
  // Added or removed an ayah: a line with Undo, and that ayah on the preview once its text is in.
  const showNum = useRef<number | null>(null);
  const onRange = (text: string, show: number) => {
    showNum.current = show;
    setToast({ text, id: Date.now() });
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const i = s.ayahs.findIndex((a) => a.num === showNum.current);
    if (i < 0) return;
    showNum.current = null;
    if (i > 0) store.dispatch({ type: "goTo", index: i });
  }, [s.ayahs, store]);

  const coach = phone && active && tip > 0;
  const endTips = () => { seeTips(); setTip(0); };

  const formatName = s.format === "video" ? t.video : t.image;
  const ratio = t.ratio[r.orientation];
  const formats = (
    <div className="ed-seg-group" role="group" aria-label={t.edMakeGroup}>
      {(["video", "image"] as const).map((f) => (
        <button key={f} type="button" aria-pressed={s.format === f} onClick={() => setFormat(store, f)}>{f === "video" ? t.video : t.image}</button>
      ))}
    </div>
  );
  const sizes = (
    <div className="ed-seg-group" role="group" aria-label={t.edSize}>
      {ORIENTATIONS.map((o) => (
        <button key={o} type="button" aria-pressed={r.orientation === o} onClick={() => customise(store, { orientation: o }, "orientation")}>{t.ratio[o]}</button>
      ))}
    </div>
  );

  const top = (
    <div className="ed-top">
      <button type="button" className="ed-close" aria-label={t.closeEditor} onClick={back}><CloseIcon /></button>
      {!phone && <h1 className="ed-title">{designTitle(r, s.surahs[r.surah - 1])}</h1>}
      <div className="ed-history">
        <button type="button" className="ed-icon-btn" aria-label={t.undo} disabled={!s.edits.past.length} onClick={() => undo(store)}><UndoIcon /></button>
        <button type="button" className="ed-icon-btn" aria-label={t.edRedo} disabled={!s.edits.future.length} onClick={() => redo(store)}><RedoIcon /></button>
      </div>
      {phone && (
        <button type="button" className="ed-format-pill" aria-haspopup="dialog" aria-expanded={formatOpen}
          aria-label={t.edFormatPill(formatName, ratio)} onClick={() => setFormatOpen(!formatOpen)}>
          {formatName} · {ratio}<DownIcon />
        </button>
      )}
      <span className="ed-spacer" />
      {!phone && <div className="ed-top-formats">{formats}{sizes}</div>}
      <button type="button" className="ed-next" data-coach="next" onClick={() => navigate("share")}>
        <span>{phone ? t.next : t.edNextShare}</span><NextIcon />
      </button>
    </div>
  );

  const tabLabel = TABS.find(([id]) => id === tab)![1];
  const body = view === "bg" || view === "colours" ? <BackgroundView start={view === "bg" ? "ayah" : "colours"} />
    : view === "translation" ? <TranslationView />
    : view === "reciters" ? <RecitersView />
    : tab === "look" ? <LookTab open={setView} />
    : tab === "text" ? <TextTab />
    : tab === "ayah" ? <AyahTab open={setView} onRange={onRange} />
    : <SoundTab open={setView} length={length} />;
  const tabs = <TabBar tab={tab} onTab={openTab} panelId={panelId} />;

  return (
    <div ref={root} className={`ed ${phone ? "ed-phone" : "ed-wide"}`}>
      {top}
      <div className="ed-body">
        <div className="ed-stage">
          <Stage active={active} image={s.format === "image"} dragHint={phone && !coach} onLength={setLength} />
        </div>
        <section id={panelId} className="ed-panel" role="tabpanel" aria-label={view ? VIEW_TITLE[view] : tabLabel}>
          {!phone && tabs}
          {view && (
            <div className="ed-view-head">
              <button type="button" className="ed-icon-btn" aria-label={t.edBackTo(tabLabel)} onClick={() => setView(null)}><PrevIcon /></button>
              <h2>{VIEW_TITLE[view]}</h2>
            </div>
          )}
          <div className="ed-panel-body" key={`${tab}:${view ?? ""}`}>{body}</div>
        </section>
        {phone && tabs}
      </div>

      {formatOpen && (
        <>
          <button type="button" className="ed-scrim" aria-label={t.edCloseFormat} onClick={() => setFormatOpen(false)} />
          <div className="ed-format" role="dialog" aria-label={t.edFormat}>
            <span className="label">{t.edMakeA}</span>
            <div className="ed-cards two">
              {(["video", "image"] as const).map((f) => (
                <button key={f} type="button" className="ed-card-btn" aria-pressed={s.format === f} onClick={() => setFormat(store, f)}>
                  <strong>{f === "video" ? t.video : t.image}</strong><small>{f === "video" ? t.edVideoNote : t.edImageNote}</small>
                </button>
              ))}
            </div>
            <span className="label">{t.edSize}</span>
            <div className="ed-cards three">
              {ORIENTATIONS.map((o) => (
                <button key={o} type="button" className="ed-card-btn" aria-pressed={r.orientation === o}
                  onClick={() => customise(store, { orientation: o }, "orientation")}>
                  <span className={`ed-shape ${o}`} aria-hidden="true" /><strong>{t.ratio[o]}</strong><small>{t.edSizeNote[o]}</small>
                </button>
              ))}
            </div>
            <button type="button" className="ed-gold" onClick={() => setFormatOpen(false)}>{t.done}</button>
          </div>
        </>
      )}

      {toast && (
        <div className="ed-toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => { undo(store); setToast(null); }}>{t.undo}</button>
        </div>
      )}

      {coach && <Tips step={tip} root={root} onNext={() => (tip >= 3 ? endTips() : setTip(tip + 1))} onSkip={endTips} />}
    </div>
  );
}

const TIP_TARGET = ["", ".text-block", "[data-coach=looks]", "[data-coach=next]"];

/** The first-run tips: a spotlight on what each one is about, and its bubble above or below it. */
function Tips({ step, root, onNext, onSkip }: { step: number; root: RefObject<HTMLDivElement | null>; onNext: () => void; onSkip: () => void }) {
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const box = root.current?.getBoundingClientRect(), el = root.current?.querySelector(TIP_TARGET[step])?.getBoundingClientRect();
      const next = box && el && el.width ? { x: el.left - box.left - 6, y: el.top - box.top - 6, w: el.width + 12, h: el.height + 12 } : null;
      setSpot((p) => (p && next && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : next));
    };
    measure();
    // The text block appears once the ayah is drawn; the layout moves with the window.
    const timer = setInterval(measure, 400);
    addEventListener("resize", measure);
    return () => { clearInterval(timer); removeEventListener("resize", measure); };
  }, [step, root]);
  const [title, body] = t.edTips[step - 1];
  const height = root.current?.clientHeight ?? 0;
  const below = !!spot && spot.y + spot.h / 2 < height / 2;
  const bubble: CSSProperties = !spot ? { top: "30%" } : below ? { top: spot.y + spot.h + 14 } : { bottom: height - spot.y + 14 };
  const arrow = spot ? Math.max(24, Math.min((root.current?.clientWidth ?? 0) - 56, spot.x + spot.w / 2 - 16)) : 0;
  return (
    <div className="ed-tips">
      {spot ? <div className="ed-tips-spot" style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} />
        : <div className="ed-tips-dim" />}
      <div className="ed-tip" role="dialog" aria-label={t.edTip(step, 3)} style={bubble}>
        {spot && <span className={`ed-tip-arrow ${below ? "up" : "down"}`} style={{ left: arrow }} />}
        <span className="ed-tip-count">{t.edTip(step, 3)}</span>
        <strong>{title}</strong>
        <span>{body}</span>
        <div>
          <button type="button" className="ed-tip-skip" onClick={onSkip}>{t.edSkipTips}</button>
          <button type="button" className="ed-tip-next" onClick={onNext}>{step >= 3 ? t.edGotIt : t.edNextTip}</button>
        </div>
      </div>
    </div>
  );
}
