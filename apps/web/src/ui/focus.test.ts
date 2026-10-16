// focus.ts: a ring is for the keyboard. The last input decides whether a script may move focus; a dialog that opens takes
// focus itself (a tabindex -1 box, no ring), unless it names a field of its own.
import { beforeEach, describe, expect, it } from "vitest";
import { focusForKeyboard, quietFocus, usingKeyboard } from "./focus";

const key = (k = "ArrowDown") => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const pointer = () => window.dispatchEvent(new Event("pointerdown", { bubbles: true }));

beforeEach(() => { document.body.innerHTML = ""; pointer(); });

describe("focus", () => {
  it("the last input decides: a key says keyboard, a touch or click says not (a modifier alone does not count)", () => {
    expect(usingKeyboard()).toBe(false);
    key("Shift");
    expect(usingKeyboard()).toBe(false);
    key("Tab");
    expect(usingKeyboard()).toBe(true);
    pointer();
    expect(usingKeyboard()).toBe(false);
  });

  it("a script moves focus after a change only for the keyboard", () => {
    const b = document.createElement("button");
    document.body.append(b);
    focusForKeyboard(b);
    expect(document.activeElement).not.toBe(b);
    key();
    focusForKeyboard(b);
    expect(document.activeElement).toBe(b);
    focusForKeyboard(null); // nothing to focus: no error
  });

  it("a dialog takes focus itself, not one of its buttons; a field that asks for focus keeps it", () => {
    document.body.innerHTML = '<dialog id="a"><button>Not now</button></dialog><dialog id="b"><input autofocus></dialog>';
    const a = document.getElementById("a") as HTMLDialogElement, b = document.getElementById("b") as HTMLDialogElement;
    a.setAttribute("open", "");
    a.querySelector("button")!.focus();
    quietFocus(a);
    expect(document.activeElement).toBe(a);
    expect(a.tabIndex).toBe(-1);
    b.setAttribute("open", "");
    b.querySelector("input")!.focus();
    quietFocus(b);
    expect(document.activeElement).toBe(b.querySelector("input"));
  });
});
