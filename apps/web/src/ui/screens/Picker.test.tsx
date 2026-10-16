// Picker: the surah list and its search, jumping to a typed reference, choosing up to 3 ayahs in a row, the preview of
// their real text, and Create. The text comes from stand-ins for the Quran text loaders.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../../../contracts/types";
import surahList from "../../../public/data/surahs.json";
import { getPickStart, openPicker } from "../../nav";
import { getRoute, initRouter } from "../../router";
import { createStore, type Store } from "../../state";
import { t } from "../../strings";
import { StoreContext } from "../hooks";
import { Picker, tapAyah } from "./Picker";

vi.mock("../../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../../api", () => ({
  loadCatalogue: async () => {},
  allClips: () => [],
  searchClips: async () => [],
  clipById: () => null,
  getSurahBackgrounds: async () => null,
  getAyahFromSurah: vi.fn(async (surah: number, ayah: number, edition: string) => (edition === "quran-uthmani" ? `ar ${surah}:${ayah}` : `${edition} ${surah}:${ayah}`)),
}));

const surahs = surahList as Surah[];
const name = (n: number) => surahs[n - 1].name_en;
let store: Store;

function show() {
  store = createStore();
  store.dispatch({ type: "booted", config: null, surahs, recipe: null });
  render(<StoreContext.Provider value={store}><Picker active /></StoreContext.Provider>);
}
const search = () => screen.getByRole("textbox", { name: t.pickSearchLabel }) as HTMLInputElement;
// fireEvent, not userEvent: the surah list and the ayah grid have hundreds of buttons, which makes userEvent slow.
const tap = (el: HTMLElement) => fireEvent.click(el);
const typeIn = (value: string) => fireEvent.change(search(), { target: { value } });
const enter = () => fireEvent.submit(search().closest("form")!);
const ayah = (n: number) => screen.getByRole("button", { name: t.pickAyahNumber(n) });
const create = () => screen.getByRole("button", { name: new RegExp(`^(${t.pickFirst}|Create with .*)$`) });
const chosen = () => within(screen.getByRole("group", { name: /./ })).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("qd.lang", "en");
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  history.replaceState(null, "", "/");
  initRouter();
  openPicker(); // the surah list
});

describe("tapAyah", () => {
  it("picks one, extends to a range of up to 3, shrinks, restarts and clears", () => {
    expect(tapAyah(null, 5)).toEqual({ a: 5, b: 5 });
    expect(tapAyah({ a: 5, b: 5 }, 6)).toEqual({ a: 5, b: 6 });
    expect(tapAyah({ a: 5, b: 5 }, 7)).toEqual({ a: 5, b: 7 });
    expect(tapAyah({ a: 5, b: 7 }, 6)).toEqual({ a: 5, b: 6 }); // shrinks
    expect(tapAyah({ a: 5, b: 7 }, 5)).toEqual({ a: 5, b: 5 });
    expect(tapAyah({ a: 5, b: 5 }, 8)).toEqual({ a: 8, b: 8 }); // too far: starts again from it
    expect(tapAyah({ a: 5, b: 5 }, 3)).toEqual({ a: 3, b: 5 }); // backwards
    expect(tapAyah({ a: 5, b: 5 }, 2)).toEqual({ a: 2, b: 2 });
    expect(tapAyah({ a: 5, b: 7 }, 4)).toEqual({ a: 4, b: 4 }); // 4..7 would be 4 ayahs
    expect(tapAyah({ a: 5, b: 5 }, 5)).toBeNull();
  });
});

describe("Picker", () => {
  it("lists all 114 surahs with their meaning and ayah count; Close goes back", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t.pickNew);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(114);
    const first = within(rows[0]);
    expect(first.getByText(name(1))).toBeTruthy();
    expect(first.getByText(`${surahs[0].meaning} · ${t.resAyahCount(surahs[0].ayahs)}`)).toBeTruthy();
    expect(first.getByText("1")).toBeTruthy();
    // The Arabic name is shown without the word "surah" in front.
    expect(rows[0].querySelector(".pick-ar")!.textContent!.split(" ").length).toBeLessThan(surahs[0].name_ar.split(" ").length);
    tap(screen.getByRole("button", { name: t.close }));
    await waitFor(() => expect(getRoute().view).toBe("find"));
  });

  it("searches by name, meaning or number, and says when nothing matches", async () => {
    show();
    const listed = () => screen.queryAllByRole("listitem").map((li) => li.querySelector("b")!.textContent);
    typeIn("baqara");
    expect(listed()).toContain(name(2));
    expect(listed().length).toBeLessThan(5);
    typeIn(surahs[93].meaning.slice(0, 6).toLowerCase());
    expect(listed()).toContain(name(94));
    typeIn("94");
    expect(listed()).toEqual([name(94)]);
    typeIn("qqqqq");
    expect(listed()).toEqual([]);
    expect(screen.getByText(t.pickNoSurah("qqqqq"))).toBeTruthy();
  });

  it("opens a surah and lets the person choose 1 to 3 ayahs in a row", async () => {
    show();
    tap(screen.getByRole("button", { name: new RegExp(`^2\\s*${name(2)}`) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name(2));
    expect(screen.getAllByRole("button", { name: /^Ayah \d+$/ })).toHaveLength(surahs[1].ayahs);
    expect(create().textContent).toBe(t.pickFirst);
    expect(create().getAttribute("aria-disabled")).toBe("true");
    tap(create()); // nothing chosen: nothing happens
    expect(getRoute().view).toBe("pick");

    tap(ayah(5));
    expect(create().textContent).toBe(t.pickCreate("2:5"));
    tap(ayah(7));
    expect(chosen()).toEqual(["5", "6", "7"]);
    expect(create().textContent).toBe(t.pickCreate("2:5–7"));
    tap(ayah(9)); // out of reach: starts again from it
    expect(chosen()).toEqual(["9"]);
    tap(ayah(9));
    expect(chosen()).toEqual([]);
    expect(create().textContent).toBe(t.pickFirst);
  });

  it("shows the real text of the chosen ayahs (Arabic and translation)", async () => {
    show();
    store.dispatch({ type: "patch", patch: { translation: "ml.abdulhameed" } });
    tap(screen.getByRole("button", { name: new RegExp(`^94\\s*${name(94)}`) }));
    tap(ayah(5));
    tap(ayah(6));
    const preview = screen.getByRole("region", { name: t.previewLabel });
    await waitFor(() => expect(within(preview).getByText("ar 94:6")).toBeTruthy());
    expect(within(preview).getByText("ar 94:5")).toBeTruthy();
    expect(within(preview).getByText("ml.abdulhameed 94:5")).toBeTruthy();
    expect(within(preview).getByText("ml.abdulhameed 94:6")).toBeTruthy();
    expect(within(preview).getByText("94:5")).toBeTruthy();
  });

  it("Create sets the design's range and opens Create; coming back shows the same pick", async () => {
    show();
    store.dispatch({ type: "query", q: "earlier search" });
    tap(screen.getByRole("button", { name: new RegExp(`^94\\s*${name(94)}`) }));
    tap(ayah(5));
    tap(ayah(6));
    tap(create());
    const r = store.getState().recipe;
    expect([r.surah, r.from, r.to]).toEqual([94, 5, 6]);
    expect(store.getState().q).toBe(""); // backgrounds follow the surah, not the earlier search
    expect(getRoute().view).toBe("create");
    expect(getPickStart()).toEqual({ surah: 94, from: 5, to: 6 });
  });

  it("a typed reference jumps to that ayah (button or Enter), ranges included", async () => {
    show();
    typeIn("94:5");
    tap(screen.getByRole("button", { name: t.pickGoTo(name(94), "94:5") }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name(94));
    expect(chosen()).toEqual(["5"]);
    expect(create().textContent).toBe(t.pickCreate("94:5"));

    tap(screen.getByRole("button", { name: t.pickBackToSurahs }));
    expect(screen.getAllByRole("listitem")).toHaveLength(114);
    expect(search().value).toBe("");
    typeIn("2:255-258"); enter(); // up to 3 in a row
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name(2));
    expect(chosen()).toEqual(["255", "256", "257"]);
  });

  it("a reference that does not exist offers no jump", async () => {
    show();
    typeIn("94:99");
    expect(screen.queryByRole("button", { name: /^Go to/ })).toBeNull();
  });

  it("opens on a surah with ayahs already chosen when asked to; the back arrow returns to the list", async () => {
    show();
    await act(async () => openPicker({ surah: 94, from: 5, to: 6 }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name(94));
    expect(chosen()).toEqual(["5", "6"]);
    expect(create().textContent).toBe(t.pickCreate("94:5–6"));
    tap(screen.getByRole("button", { name: t.pickBackToSurahs }));
    expect(screen.getAllByRole("listitem")).toHaveLength(114);

    await act(async () => openPicker({ surah: 2 })); // a surah, no ayahs yet
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name(2));
    expect(chosen()).toEqual([]);
    await act(async () => openPicker()); // a fresh start
    expect(screen.getAllByRole("listitem")).toHaveLength(114);
  });

  it("keeps a start inside the surah and the 3-ayah limit", async () => {
    show();
    await act(async () => openPicker({ surah: 1, from: 6, to: 40 }));
    expect(chosen()).toEqual(["6", "7"]);
    await act(async () => openPicker({ surah: 2, from: 10, to: 40 }));
    expect(chosen()).toEqual(["10", "11", "12"]);
  });
});
