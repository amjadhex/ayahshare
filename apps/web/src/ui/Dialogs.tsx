// "Something looks wrong?" dialog and the toast for status messages.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { sendReport } from "../actions";
import { t } from "../strings";
import { quietFocus } from "./focus";
import { useAppState, useStore } from "./hooks";

/** A modal <dialog> that follows `open`. Escape and the close button call `onClose`. */
function Modal({ open, onClose, labelledBy, children, className = "dialog" }: {
  open: boolean; onClose: () => void; labelledBy: string; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) { d.showModal(); quietFocus(d); }
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={className} aria-labelledby={labelledBy}
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && children}
    </dialog>
  );
}

export function ReportDialog() {
  const store = useStore();
  const { report } = useAppState();
  const [note, setNote] = useState("");
  useEffect(() => { if (report) setNote(""); }, [report]);
  const close = () => store.dispatch({ type: "report", body: null });
  const send = () => {
    if (report) void sendReport(store, report, note);
    close();
  };
  return (
    <Modal open={!!report} onClose={close} labelledBy="reportTitle">
      <form onSubmit={(e) => { e.preventDefault(); send(); }}>
        <h3 id="reportTitle">{t.reportTitle}</h3>
        <p className="muted">{t.reportIntro}</p>
        <label htmlFor="reportNote" className="label">{t.reportNote}</label>
        <textarea id="reportNote" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>{t.cancel}</button>
          <button type="submit" className="btn primary">{t.send}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Status messages. Shown in the top layer (popover) so they stay visible above an open sheet or dialog. */
export function Toast() {
  const { toast } = useAppState();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const el = ref.current!;
    setShown(true);
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover(); // the top of the top layer, above any sheet or dialog opened before
    } catch { /* no popover support: a fixed element is enough */ }
    const timer = setTimeout(() => setShown(false), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <div ref={ref} className={`toast${shown ? " show" : ""}`} popover="manual" role="status" aria-live="polite">
      {toast?.text}
    </div>
  );
}
