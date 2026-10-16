// Bottom sheet (phones): a modal <dialog>, so the page behind is inert (focus stays inside) and Escape closes it.
// Closes with the close button, a tap on the scrim, Escape, a swipe down on the handle or header, and the back button
// (the sheet is a history entry; `onClose` goes back). Children stay mounted while it is closed, so panels keep state.
// A sheet that opens takes focus itself (focus.ts), never one of its buttons.
// `done` (optional): a text button with that label closes it instead of the close icon (the editor's "Done").
import { useEffect, useId, useRef, type ReactNode } from "react";
import { t } from "../strings";
import { quietFocus } from "./focus";
import { CloseIcon } from "./icons";

export function Sheet({ open, title, onClose, actions, children, className = "", done }: {
  open: boolean; title: string; onClose: () => void; actions?: ReactNode; children: ReactNode; className?: string; done?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) {
      d.showModal();
      quietFocus(d); // the sheet itself, not one of its buttons (focus.ts)
      d.querySelector(".sheet-body")?.scrollTo?.({ top: 0 }); // WebKit may have scrolled it
    } else if (!open && d.open) d.close();
  }, [open]);

  // Height of the open sheet, so the preview can shrink into the space above it.
  useEffect(() => {
    if (!open) return;
    const d = ref.current!, root = document.documentElement;
    const set = () => root.style.setProperty("--sheet-h", `${d.offsetHeight}px`);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    ro?.observe(d);
    set();
    return () => { ro?.disconnect(); root.style.setProperty("--sheet-h", "0px"); };
  }, [open]);

  // Swipe down on the handle or header to close.
  useEffect(() => {
    const d = ref.current!;
    let startY = 0, lastY = 0, lastT = 0, v = 0, dy = 0, id = -1, dragging = false;
    // (not the grips of a sheet nested inside this one's markup: it has its own)
    const grips = [...d.querySelectorAll<HTMLElement>(".sheet-grab, .sheet-head")].filter((g) => g.closest("dialog") === d);
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      id = e.pointerId; startY = lastY = e.clientY; lastT = e.timeStamp; dy = 0; v = 0;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 8) return;
        dragging = true;
        (e.currentTarget as HTMLElement).setPointerCapture(id);
        d.classList.add("dragging");
      }
      v = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT);
      lastY = e.clientY; lastT = e.timeStamp;
      d.style.transform = `translateY(${dy > 0 ? dy : dy / 4}px)`;
    };
    const up = () => {
      id = -1;
      if (!dragging) return;
      dragging = false;
      d.classList.remove("dragging");
      d.style.transform = "";
      if (dy > Math.min(140, d.offsetHeight * 0.3) || v > 0.6) close.current();
      // A drag must not also count as a tap on the button it started on.
      const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
      addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", stop, { capture: true }), 300);
    };
    for (const g of grips) {
      g.addEventListener("pointerdown", down);
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    }
    return () => {
      for (const g of grips) {
        g.removeEventListener("pointerdown", down);
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
      }
    };
  }, []);

  return (
    <dialog ref={ref} className={`sheet ${className}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); /* the scrim (::backdrop) */ }}>
      <div className="sheet-inner">
        <div className="sheet-grab" aria-hidden="true"><span /></div>
        <header className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          {actions}
          {done
            ? <button type="button" className="sheet-done" onClick={onClose}>{done}</button>
            : <button type="button" className="icon-btn" aria-label={t.close} onClick={onClose}><CloseIcon /></button>}
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </dialog>
  );
}
