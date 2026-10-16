// Share or Download from a reel or a story (owner, 12 Oct 2026, from a person's feedback: many share pictures rather
// than videos, and the image was only in Customize): first the format, Video (the MP4 with the recitation) or Image (a
// picture of the ayah, ready at once). The one chosen last is kept on the device and comes first. Above them, the shape
// (owner, 13 Oct 2026: also only in Customize before): Story 9:16 (the reel's own), Square 1:1 or Wide 16:9, kept too.
import { useEffect, useId, useState, type JSX } from "react";
import type { Recipe } from "../../../../contracts/types";
import { closeSheet, openSheet } from "../router";
import { t } from "../strings";
import { useRoute } from "./hooks";
import { ImageIcon, VideoIcon } from "./icons";
import { Sheet } from "./Sheet";
import "./format-sheet.css";

export type Format = "video" | "image";
const KEY = "qd.shareFormat";
export const lastFormat = (): Format => { try { return localStorage.getItem(KEY) === "image" ? "image" : "video"; } catch { return "video"; } };
const remember = (f: Format) => { try { localStorage.setItem(KEY, f); } catch { /* this visit only */ } };

export type Shape = Recipe["orientation"];
const SHAPES: Shape[] = ["portrait", "square", "landscape"];
const SHAPE_KEY = "qd.shareShape";
export const lastShape = (): Shape => {
  try { const v = localStorage.getItem(SHAPE_KEY); return SHAPES.includes(v as Shape) ? (v as Shape) : "portrait"; } catch { return "portrait"; }
};
const rememberShape = (s: Shape) => { try { localStorage.setItem(SHAPE_KEY, s); } catch { /* this visit only */ } };

/** Asking for the format, then making the file once the sheet has closed (its history entry gone: a file ready at once,
 *  like an image, then opens the Export sheet on the screen's own entry, not on the one Back is taking away). `stack`:
 *  over another sheet's entry (the stories). */
export function useFormatChoice<T>(make: (target: T, save: boolean, format: Format, shape: Shape) => void, stack = false) {
  const route = useRoute();
  const [asking, setAsking] = useState<{ target: T; save: boolean } | null>(null);
  const [chosen, setChosen] = useState<{ target: T; save: boolean; format: Format; shape: Shape } | null>(null);
  useEffect(() => {
    if (!chosen || route.sheet === "format") return;
    setChosen(null);
    make(chosen.target, chosen.save, chosen.format, chosen.shape);
  }, [chosen, route.sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    ask: (target: T, save: boolean) => { setAsking({ target, save }); openSheet("format", stack); },
    sheet: {
      open: route.sheet === "format" && !!asking, save: !!asking?.save, onClose: closeSheet,
      onPick: (format: Format, shape: Shape) => { if (asking) setChosen({ ...asking, format, shape }); setAsking(null); closeSheet(); },
    },
  };
}

/** `save`: Download (the file goes to the device) rather than Share. */
export function FormatSheet({ open, save, onPick, onClose }: {
  open: boolean; save: boolean; onPick: (f: Format, s: Shape) => void; onClose: () => void;
}) {
  const first = lastFormat();
  const [shape, setShape] = useState(lastShape);
  useEffect(() => { if (open) setShape(lastShape()); }, [open]);
  const shapeId = useId();
  const choices: [Format, () => JSX.Element, string, string][] = [
    ["video", VideoIcon, t.formatVideo, t.formatVideoHint], ["image", ImageIcon, t.formatImage, t.formatImageHint],
  ];
  if (first === "image") choices.reverse();
  return (
    <Sheet open={open} title={save ? t.downloadAs : t.shareAs} onClose={onClose} className="format-sheet">
      <span className="dd-label" id={shapeId}>{t.shapeLabel}</span>
      <div className="format-shapes" role="group" aria-labelledby={shapeId}>
        {SHAPES.map((s) => (
          <button key={s} type="button" className="format-shape" aria-pressed={s === shape} onClick={() => { setShape(s); rememberShape(s); }}>
            <span className={`format-glyph ${s}`} aria-hidden="true" />
            <strong>{t.shapeNames[s]}</strong><span>{t.ratio[s]}</span>
          </button>
        ))}
      </div>
      <div className="format-choices">
        {choices.map(([f, Icon, label, hint]) => (
          <button key={f} type="button" className="format-choice" data-last={f === first || undefined}
            onClick={() => { remember(f); onPick(f, shape); }}>
            <span className="format-icon"><Icon /></span>
            <span className="format-text"><strong>{label}</strong><span>{hint}</span></span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
