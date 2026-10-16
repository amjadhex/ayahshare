// The app's own dropdown: a row with the label and the current value and a chevron. A tap opens a bottom sheet (a
// centred dialog on larger screens) with the options as radio rows, the current one marked, and a search when the list
// is long. It is a modal <dialog> (Sheet.tsx: focus stays inside, Escape closes it) and a history entry, so Back closes it
// too, and over another sheet (Preferences) only it closes. Replaces the browser's <select>.
import { useEffect, useId, useMemo, useState, type ReactNode, type Ref } from "react";
import { closeSheet, openSheet } from "../router";
import { t } from "../strings";
import { matches, queryWords } from "../translations";
import { ItemRows, type PickItem } from "./GroupedPicker";
import { useRoute } from "./hooks";
import { NextIcon, SearchIcon } from "./icons";
import { Sheet } from "./Sheet";
import "./dropdown.css";
import "./translation-picker.css";

/** The row itself: the label over the current value (shortened with an ellipsis, never wider than the screen) and a
 *  chevron. */
export function PickRowButton({ label, value, onClick, expanded, ref }: {
  label: string; value: string; onClick: () => void; expanded?: boolean; ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={ref} type="button" className="dd-row" aria-haspopup="dialog" aria-expanded={expanded ?? false} onClick={onClick}>
      <span className="dd-text">
        <span className="dd-label">{label}</span>
        <span className="dd-value" dir="auto">{value}</span>
      </span>
      <NextIcon />
    </button>
  );
}

export interface PickOption { value: string; label: string; detail?: string }

/** Lists longer than this get a search box. */
const SEARCH_FROM = 12;

export function PickerRow({ label, value, options, onChange, title = label, hint, className = "", display }: {
  label: string;
  value: string;
  /** What the row shows for the value (the option's label by default). */
  display?: string;
  options: PickOption[];
  onChange: (value: string) => void;
  /** The sheet's title and the radio group's name (the label by default). */
  title?: string;
  hint?: ReactNode;
  className?: string;
}) {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const uid = useId();
  const shown = open && route.sheet === "picker";
  // Back (or another sheet) closed it.
  useEffect(() => { if (route.sheet !== "picker") setOpen(false); }, [route.sheet]);
  const current = options.find((o) => o.value === value);
  const words = queryWords(q);
  const items = useMemo<PickItem[]>(
    () => options.filter((o) => !words.length || matches(words, [o.label, o.detail ?? ""])).map((o) => ({ id: o.value, name: o.label, detail: o.detail })),
    [options, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const close = () => { closeSheet(); };
  const show = () => { setQ(""); setOpen(true); openSheet("picker", true); };
  return (
    <div className={`dd ${className}`.trim()}>
      <PickRowButton label={label} value={display ?? current?.label ?? value} expanded={shown} onClick={show} />
      {hint && <p className="hint dd-hint">{hint}</p>}
      <Sheet open={shown} title={title} onClose={close} className="trp-sheet dd-sheet">
        {shown && (
          <div className="trp">
            {options.length > SEARCH_FROM && (
              <div className="search small trp-search">
                <SearchIcon />
                <input type="search" aria-label={t.pickSearch} placeholder={t.pickSearch} value={q} autoComplete="off" spellCheck={false} enterKeyHint="search"
                  aria-controls={`${uid}-list`} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); setQ(""); } }} />
              </div>
            )}
            <div className="trp-list" id={`${uid}-list`}>
              {items.length ? <ItemRows items={items} value={value} label={title} onPick={onChange} onDone={close} />
                : <p className="hint trp-empty" role="status">{t.pickNothing(q.trim())}</p>}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
