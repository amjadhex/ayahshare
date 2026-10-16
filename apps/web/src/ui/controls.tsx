// Small form controls shared by the editing panels.
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import type { Clip } from "../../../../contracts/types";
import { mediaUrl } from "../api";
import { t } from "../strings";

/** A labelled group. `htmlFor` makes the label a <label> for one control; otherwise it labels the group. */
export function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: (labelId: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      {htmlFor ? <label htmlFor={htmlFor} id={id}>{label}</label> : <span className="label" id={id}>{label}</span>}
      {children(id)}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, labelledBy }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; labelledBy: string;
}) {
  return (
    <div className="seg" style={{ "--n": options.length } as CSSProperties} role="group" aria-labelledby={labelledBy}>
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => v !== value && onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

/** The HD chip: export quality as one small on/off (on = HD, off = Standard). `label`: its name when "HD" alone is not
 *  enough (a reel's Download). */
export function HdChip({ on, onChange, label, disabled, className = "" }: {
  on: boolean; onChange: (on: boolean) => void; label?: string; disabled?: boolean; className?: string;
}) {
  return (
    <button type="button" className={`hd-chip ${className}`.trim()} aria-pressed={on} aria-label={label} title={t.hdChipHint}
      disabled={disabled} onClick={() => onChange(!on)}>{t.hd}</button>
  );
}

/** An on/off switch with its label. */
export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className="toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}</span><span className="switch" aria-hidden="true" />
    </button>
  );
}

export function Stepper({ value, min, max, step = 1, suffix = "", onChange, labelledBy }: {
  value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; labelledBy: string;
}) {
  const set = (d: number) => onChange(Math.min(max, Math.max(min, value + d * step)));
  return (
    <div className="stepper" role="group" aria-labelledby={labelledBy}>
      <button type="button" aria-label={t.decrease} disabled={value <= min} onClick={() => set(-1)}>−</button>
      <output aria-live="polite">{value}{suffix}</output>
      <button type="button" aria-label={t.increase} disabled={value >= max} onClick={() => set(1)}>+</button>
    </div>
  );
}

/** Colour swatches with an optional custom colour picker. */
export function Swatches({ colours, value, onChange, onPick, custom = true, label = t.colour, labelledBy }: {
  colours: string[]; value: string | null; onChange: (c: string) => void; onPick?: (c: string) => void;
  custom?: boolean; label?: (c: string) => string; labelledBy: string;
}) {
  return (
    <div className="swatches" role="group" aria-labelledby={labelledBy}>
      {colours.map((c) => (
        <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={label(c)} aria-pressed={c === value} onClick={() => onChange(c)} />
      ))}
      {custom && <CustomColour value={value ?? "#ffffff"} onPick={onPick ?? onChange} onCommit={onChange} />}
    </div>
  );
}

/** While the picker is open every move updates the preview (`onPick`); closing it commits (`onCommit`, the native
 *  change event — React's onChange fires on every move). */
function CustomColour({ value, onPick, onCommit }: { value: string; onPick: (c: string) => void; onCommit: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const input = ref.current!;
    const done = () => commit.current(input.value);
    input.addEventListener("change", done);
    return () => input.removeEventListener("change", done);
  }, []);
  return (
    <label className="swatch custom" title={t.customColour}>
      <input ref={ref} type="color" aria-label={t.customColour} value={value} onChange={(e) => onPick(e.target.value)} />
    </label>
  );
}

export function ClipThumbs({ clips, selected, onPick, empty, labelledBy }: {
  clips: Clip[] | null; selected: string | null; onPick: (c: Clip) => void; empty: string; labelledBy: string;
}) {
  return (
    <div className="thumbs" role="group" aria-labelledby={labelledBy}>
      {clips === null ? <p className="hint">{t.findingBackgrounds}</p>
        : clips.length === 0 ? <p className="hint">{empty}</p>
        : clips.map((c) => (
          <button key={c.id} type="button" aria-pressed={c.id === selected} aria-label={c.caption} title={c.caption} onClick={() => onPick(c)}>
            <img src={mediaUrl(c.thumb)} alt="" loading="lazy" decoding="async" width={240} height={426} />
          </button>
        ))}
    </div>
  );
}

/** Large choice tiles (fonts, text effects): one is pressed. `preview` is drawn above each label. */
export function Tiles<T extends string>({ value, options, onChange, labelledBy, className = "" }: {
  value: T; options: [T, string, ReactNode][]; onChange: (v: T) => void; labelledBy: string; className?: string;
}) {
  return (
    <div className={`tiles ${className}`} role="group" aria-labelledby={labelledBy}>
      {options.map(([v, label, preview]) => (
        <button key={v} type="button" className="tile" aria-pressed={v === value} onClick={() => v !== value && onChange(v)}>
          <span className="tile-preview" aria-hidden="true">{preview}</span>
          <span className="tile-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** A list of radio rows (reciters, translations). `heading` rows group the options that follow them. */
export type RadioRow = { value: string; label: string; detail?: string } | { heading: string };
export function RadioRows({ value, rows, onChange, labelledBy }: {
  value: string; rows: RadioRow[]; onChange: (v: string) => void; labelledBy: string;
}) {
  const name = useId();
  return (
    <div className="radio-rows" role="radiogroup" aria-labelledby={labelledBy}>
      {rows.map((row) => ("heading" in row
        ? <p key={`h:${row.heading}`} className="radio-heading">{row.heading}</p>
        : (
          <label key={row.value} className="radio-row">
            <input type="radio" name={name} value={row.value} checked={row.value === value} onChange={() => onChange(row.value)} />
            <span className="radio-dot" aria-hidden="true" />
            <span className="radio-label">{row.label}</span>
            {row.detail && <small>{row.detail}</small>}
          </label>
        )))}
    </div>
  );
}
