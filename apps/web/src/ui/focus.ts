// Where focus goes when something opens or changes under the person's finger. The rule: a focus ring is for the keyboard.
// A dialog that opens takes focus itself (a tabindex -1 box with no ring), never one of its buttons, so a tap on "Open"
// never leaves a ring on "Not now"; and a script that moves focus after a change (a list that swaps, a chooser that
// closes) does it only when the last thing the person used was a key. Browsers (Safari above all) are not consistent about
// :focus-visible after a script's focus(), so this is decided here rather than left to them.

let keyboard = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key !== "Shift" && e.key !== "Meta" && e.key !== "Control" && e.key !== "Alt") keyboard = true; }, true);
  window.addEventListener("pointerdown", () => { keyboard = false; }, true);
}

/** The last input was a key (not a touch, a click or a pen). */
export const usingKeyboard = () => keyboard;

/** Moves focus to `el` for a keyboard user; for a touch or mouse user nothing moves (no ring appears). */
export function focusForKeyboard(el: HTMLElement | null | undefined) {
  if (el && keyboard) el.focus({ preventScroll: true });
}

/** A dialog that has just opened: focus the dialog itself (tabindex -1, no ring), unless it names its own autofocus (a text
 *  field that wants the keyboard). The focus stays inside it (the browser's modal dialog traps it) and returns to what
 *  opened it on close. */
export function quietFocus(d: HTMLDialogElement) {
  if (d.querySelector("[autofocus]")) return;
  d.tabIndex = -1;
  d.focus({ preventScroll: true });
}
