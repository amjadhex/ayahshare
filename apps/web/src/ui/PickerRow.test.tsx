// The app's own dropdown: a row with the label over the current value and a chevron; a tap opens a sheet with radio rows
// (the current one marked), a search only when the list is long; it is a dialog, Escape and Back close it, and a pick
// closes it. There is no native <select> left in the app.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECITERS } from "../config";
import { getRoute, initRouter } from "../router";
import { PickerRow, type PickOption } from "./PickerRow";

vi.setConfig({ testTimeout: 30_000 });

const SHORT: PickOption[] = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", detail: "The second" }, { value: "c", label: "Gamma" }];
const LONG: PickOption[] = Array.from({ length: 30 }, (_, i) => ({ value: `v${i}`, label: `Country ${String.fromCharCode(65 + (i % 26))}${i}` }));

function Host({ options, start, onPick }: { options: PickOption[]; start: string; onPick?: (v: string) => void }) {
  const [value, setValue] = useState(start);
  return <PickerRow label="Default reciter" value={value} options={options} onChange={(v) => { setValue(v); onPick?.(v); }} hint="A hint" />;
}
const row = () => screen.getByRole("button", { name: /^Default reciter/ });

beforeEach(() => {
  history.replaceState(null, "", "/");
  initRouter();
});

describe("PickerRow", () => {
  it("shows the label over the current value; a tap opens a dialog with the options as radios, the current one marked", async () => {
    const user = userEvent.setup();
    render(<Host options={SHORT} start="b" />);
    expect(row().textContent).toBe("Default reciterBeta");
    expect(row().getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getByText("A hint")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull(); // not a native <select>
    expect(screen.queryByRole("dialog", { name: "Default reciter" })).toBeNull();
    await user.click(row());
    expect(getRoute().sheet).toBe("picker");
    expect(row().getAttribute("aria-expanded")).toBe("true");
    const dialog = screen.getByRole("dialog", { name: "Default reciter" });
    expect(within(dialog).getAllByRole("radio").map((r) => [r.getAttribute("value"), (r as HTMLInputElement).checked])).toEqual([["a", false], ["b", true], ["c", false]]);
    expect(within(dialog).getByRole("radio", { name: "Beta", description: "The second" })).toBeTruthy();
    expect(within(dialog).queryByRole("searchbox")).toBeNull(); // short list: no search
    // The dialog itself holds focus (no ring on a button), inside a modal dialog.
    expect(document.activeElement).toBe(dialog);
  });

  it("a pick changes the value and closes the sheet; the same one again just closes it", async () => {
    const user = userEvent.setup();
    const picked = vi.fn();
    render(<Host options={SHORT} start="a" onPick={picked} />);
    await user.click(row());
    await user.click(screen.getByRole("radio", { name: "Gamma" }));
    expect(picked).toHaveBeenCalledWith("c");
    expect(row().textContent).toBe("Default reciterGamma");
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(false);
    await user.click(row());
    await user.click(screen.getByRole("radio", { name: "Gamma" }));
    expect(picked).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getRoute().sheet).toBeNull());
  });

  it("Escape closes it without a change; so does the Back button", async () => {
    const user = userEvent.setup();
    const picked = vi.fn();
    render(<Host options={SHORT} start="a" onPick={picked} />);
    await user.click(row());
    const dialog = screen.getByRole("dialog", { name: "Default reciter" });
    fireEvent(dialog, new Event("cancel", { cancelable: true })); // what Escape does to a modal dialog
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    expect(picked).not.toHaveBeenCalled();
    await user.click(row());
    expect(getRoute().sheet).toBe("picker");
    act(() => history.back());
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    await waitFor(() => expect(row().getAttribute("aria-expanded")).toBe("false"));
    expect(picked).not.toHaveBeenCalled();
  });

  it("a long list has a search that filters it, with a line when nothing matches; Escape clears it first", async () => {
    const user = userEvent.setup();
    render(<Host options={LONG} start="v0" />);
    await user.click(row());
    const dialog = screen.getByRole("dialog", { name: "Default reciter" });
    expect(within(dialog).getAllByRole("radio")).toHaveLength(30);
    const box = within(dialog).getByRole("searchbox", { name: "Search" });
    await user.type(box, "country b");
    expect(within(dialog).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["v1", "v27"]);
    await user.clear(box);
    await user.type(box, "zzz");
    expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
    expect(within(dialog).getByRole("status").textContent).toBe("Nothing found for “zzz”.");
    await user.keyboard("{Escape}");
    expect((box as HTMLInputElement).value).toBe("");
    expect(within(dialog).getAllByRole("radio")).toHaveLength(30);
  });

  it("the reciters list (17) is long enough for a search", async () => {
    const user = userEvent.setup();
    render(<Host options={RECITERS.map(([value, label]) => ({ value, label }))} start={RECITERS[0][0]} />);
    expect(row().textContent).toBe("Default reciterMishary Rashid Alafasy");
    await user.click(row());
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeTruthy();
  });
});
