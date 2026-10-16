// Results: the grid of ayahs for a search (quick results, then the refined order in place), tile actions, refining,
// references, and the empty and failed states. The network is replaced with stand-ins.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse, Surah } from "../../../../../contracts/types";
import surahList from "../../../public/data/surahs.json";
import * as api from "../../api";
import { takeReelStart } from "../../feed";
import { getQuery, openSearch, setQuery } from "../../nav";
import { getRoute, initRouter } from "../../router";
import { createStore, type Store } from "../../state";
import { t } from "../../strings";
import { StoreContext } from "../hooks";
import { Results } from "./Results";

const tracked = vi.hoisted(() => [] as { name: string; props?: Record<string, unknown> }[]);
vi.mock("../../analytics", () => ({
  anon: "test-anon", flush: () => {}, newDevice: () => {},
  track: (name: string, props?: Record<string, unknown>) => tracked.push({ name, props }),
}));

const answer = (mode: "fast" | "full", ...refs: string[]): SearchResponse =>
  ({ q: "patience", mode, topic: "patience", results: refs.map((ref) => ({ ref, text: `English ${ref}` })) });
/** The answer, saying there is a page `next` after it (none: this is the last). */
const paged = (r: SearchResponse, next?: number): SearchResponse => ({ ...r, more: next !== undefined, ...(next && { next }) });

vi.mock("../../api", () => ({
  mediaUrl: (p: string) => `/media/${p}`,
  search: vi.fn(),
  loadCatalogue: async () => {},
  allClips: () => [],
  searchClips: async () => [],
  clipById: (id: string) => (id.startsWith("pb") ? { id, duration: 8, caption: id, tags: [], thumb: `thumbs/${id}.webp`, video: { portrait: "", landscape: "" }, poster: { portrait: "", landscape: "" } } : null),
  // Each ayah's suggestions: one shared clip first, then one of its own (the tiles must all differ).
  getSurahBackgrounds: async (surah: number) => ({ surah, sensitive: [], ayahs: new Proxy({}, { get: (_, ayah) => ["pb1", `pb${surah}x${String(ayah)}`] }) }),
  getAyahFromSurah: vi.fn(async (surah: number, ayah: number, edition: string) => (edition === "quran-uthmani" ? `ar ${surah}:${ayah}` : `${edition} ${surah}:${ayah}`)),
  getAyahStats: vi.fn(async (refs: string[]) => ({ stats: refs.map((ref) => ({ ref, likes: 0, shares: ref === "2:153" ? 1200 : ref === "3:200" ? 1 : 0, makes: 0, week: 0 })) })),
  setFavourite: vi.fn(async () => undefined),
}));

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const surahs = surahList as Surah[];
const name = (n: number) => surahs[n - 1].name_en;
let store: Store;
const search = vi.mocked(api.search);

async function show(query?: string) {
  store = createStore();
  store.dispatch({ type: "booted", config: null, surahs, recipe: null });
  render(<StoreContext.Provider value={store}><Results active /></StoreContext.Provider>);
  if (query) await act(async () => openSearch(query));
}
const tiles = () => [...document.querySelectorAll<HTMLElement>("li.res-tile[data-key]")];
const keys = () => tiles().map((li) => li.dataset.key);

beforeEach(() => {
  tracked.length = 0;
  localStorage.clear();
  localStorage.setItem("qd.lang", "en");
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  setQuery("");
  history.replaceState(null, "", "/");
  initRouter();
  search.mockReset().mockImplementation(async (_q, mode) => (mode === "fast" ? answer("fast", "2:153", "3:200") : answer("full", "3:200", "2:153", "39:10")));
});

afterEach(() => vi.unstubAllGlobals());

describe("Results", () => {
  it("with nothing searched yet, says where to start and offers the picker", async () => {
    await show();
    expect(screen.getByText(t.resultsIdle)).toBeTruthy();
    expect(tiles()).toHaveLength(0);
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t.pickYourself })).toBeTruthy();
  });

  it("shows a tile per ayah in the refined order, each with its text, reference, share count and own background", async () => {
    await show("patience");
    await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]));
    expect(getQuery()).toBe("patience");
    expect(screen.getByRole("heading", { name: t.resultsFor("patience") })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(t.resAyahCount(3));

    const tile = screen.getByRole("button", { name: t.watchAyah(name(2), "2:153") }).closest("li")!;
    expect(within(tile).getByText("ar 2:153")).toBeTruthy(); // the Arabic
    expect(within(tile).getByText("English 2:153")).toBeTruthy(); // no other translation selected: the search's English
    expect(within(tile).getByText(`${name(2)} · 2:153`)).toBeTruthy();
    await waitFor(() => expect(within(tile).getByText("1.2k shares")).toBeTruthy());
    const other = screen.getByRole("button", { name: t.watchAyah(name(3), "3:200") }).closest("li")!;
    await waitFor(() => expect(within(other).getByText("1 share")).toBeTruthy());
    expect(screen.queryAllByText(/0 shares/)).toHaveLength(0); // hidden when 0
    expect(within(screen.getByRole("button", { name: t.watchAyah(name(39), "39:10") }).closest("li")!).queryByText(/share/)).toBeNull();

    // Every tile gets a different background (the shared clip goes to the first, the rest take their own).
    await waitFor(() => expect(tiles().every((li) => li.querySelector("img"))).toBe(true));
    const srcs = tiles().map((li) => li.querySelector("img")!.getAttribute("src"));
    expect(new Set(srcs).size).toBe(3);
    expect(srcs[0]).toBe("/media/thumbs/pb1.webp");
  });

  it("shows the quick results first, then reorders the same tiles in place and adds the new one", async () => {
    const fast = deferred<SearchResponse>(), full = deferred<SearchResponse>();
    search.mockReset().mockImplementation((_q, mode) => (mode === "fast" ? fast : full).promise);
    await show("patience");
    expect(document.querySelectorAll(".res-skeleton").length).toBeGreaterThan(0); // loading
    await act(async () => fast.resolve(answer("fast", "2:153", "3:200")));
    await waitFor(() => expect(keys()).toEqual(["2:153-153", "3:200-200"]));
    const kept = tiles()[0];
    await act(async () => full.resolve(answer("full", "3:200", "2:153", "39:10")));
    await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]));
    expect(tiles()[1]).toBe(kept); // the same element, moved
  });

  it("tapping a tile opens the results as reels from that one, each with its tile's background", async () => {
    await show("patience");
    await waitFor(() => expect(tiles()).toHaveLength(3));
    await waitFor(() => expect(tiles().every((li) => li.querySelector("img"))).toBe(true));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: t.watchAyah(name(2), "2:153") }));
    expect(getRoute().view).toBe("feed");
    const handed = takeReelStart()!;
    const refs = keys().map((k) => k!.replace(/-\d+$/, "")); // the tiles' refs
    expect(handed[0].item.ref).toBe("2:153"); // the one tapped first, then the other results
    expect(handed.map((h) => h.item.ref).sort()).toEqual(refs.sort());
    expect(handed[0].item.reason).toEqual({ kind: "search", q: "patience" });
    expect(handed[0].bg).toEqual({ type: "clip", id: "pb2x153" }); // its own clip: the first tile took the shared one
    expect(tracked.find((e) => e.name === "search_click")?.props).toMatchObject({ ref: "2:153", q: "patience" });
  });

  it("the heart keeps or removes a favourite; Reflect opens the sheet for that ayah", async () => {
    await show("patience");
    await waitFor(() => expect(tiles()).toHaveLength(3));
    const user = userEvent.setup();
    const li = screen.getByRole("button", { name: t.watchAyah(name(2), "2:153") }).closest("li")!;
    await user.click(within(li).getByRole("button", { name: t.addFavourite }));
    expect(store.getState().favourites).toContain("2:153");
    expect(within(li).getByRole("button", { name: t.removeFavourite }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(li).getByRole("button", { name: t.removeFavourite }));
    expect(store.getState().favourites).not.toContain("2:153");

    await user.click(within(li).getByRole("button", { name: t.resReflectOn(name(2), "2:153") }));
    expect(store.getState().reflect?.ref).toBe("2:153");
    expect(getRoute().sheet).toBe("reflect");
  });

  it("refining searches again in place: the box is prefilled and the new words replace the results", async () => {
    await show("patience");
    await waitFor(() => expect(tiles()).toHaveLength(3));
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: t.resRefineLabel }) as HTMLInputElement;
    expect(input.value).toBe("patience");
    search.mockImplementation(async (_q, mode) => answer(mode, "94:5"));
    await user.clear(input);
    await user.type(input, "hope after hardship{Enter}");
    await waitFor(() => expect(keys()).toEqual(["94:5-5"]));
    expect(getQuery()).toBe("hope after hardship");
    expect(search.mock.calls.some((c) => c[0] === "hope after hardship")).toBe(true);
    expect(getRoute().view).toBe("results"); // refining stays on this screen
    // The same words again search again.
    const calls = search.mock.calls.length;
    await user.type(input, "{Enter}");
    await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(calls));
  });

  it("a new search from Home replaces the refine box text", async () => {
    await show("patience");
    await waitFor(() => expect(tiles()).toHaveLength(3));
    await act(async () => openSearch("mercy"));
    expect((screen.getByRole("textbox", { name: t.resRefineLabel }) as HTMLInputElement).value).toBe("mercy");
  });

  it("says so when nothing is found", async () => {
    search.mockReset().mockImplementation(async (_q, mode) => answer(mode));
    await show("zzzz");
    await waitFor(() => expect(screen.getByText(t.noResults)).toBeTruthy());
    expect(tiles()).toHaveLength(0);
    expect(screen.getByRole("button", { name: t.pickYourself })).toBeTruthy();
  });

  it("says the search did not answer (not 'nothing found') and tries again on request", async () => {
    search.mockReset().mockRejectedValue(new Error("503"));
    await show("patience");
    await waitFor(() => expect(screen.getByText(t.searchFailed)).toBeTruthy(), { timeout: 4000 });
    search.mockReset().mockImplementation(async (_q, mode) => answer(mode, "2:153"));
    await userEvent.setup().click(screen.getByRole("button", { name: t.retry }));
    await waitFor(() => expect(keys()).toEqual(["2:153-153"]));
  });

  it("a surah chip shows the whole surah from its first ayah, a page at a time, without searching", async () => {
    await show();
    await act(async () => openSearch("Surah Al-Kahf", { surah: 18 }));
    await waitFor(() => expect(keys()).toHaveLength(10));
    expect(keys()[0]).toBe("18:1-1");
    await userEvent.setup().click(screen.getByRole("button", { name: t.resShowMore }));
    await waitFor(() => expect(keys()).toHaveLength(20));
    expect(keys()[10]).toBe("18:11-11");
    expect(search).not.toHaveBeenCalled();
  });

  it("a typed reference shows that ayah; a range of up to 3 is one tile that designs the whole range", async () => {
    await show("2:255");
    await waitFor(() => expect(keys()).toEqual(["2:255-255"]));
    expect(search).not.toHaveBeenCalled(); // references do not need the search

    await act(async () => openSearch("94:5-6"));
    await waitFor(() => expect(keys()).toEqual(["94:5-6"]));
    expect(within(tiles()[0]).getByText("ar 94:5 ar 94:6")).toBeTruthy();
    expect(within(tiles()[0]).getByText("en.sahih 94:5 en.sahih 94:6")).toBeTruthy();
    await waitFor(() => expect(tiles()[0].querySelector("img")).toBeTruthy());
    await userEvent.setup().click(screen.getByRole("button", { name: t.watchAyah(name(94), "94:5–6") }));
    expect(getRoute().view).toBe("feed");
    expect(takeReelStart()![0].item).toMatchObject({ ref: "94:5", surah: 94, ayah: 5, to: 6 }); // one reel for the range
  });

  it("a longer range is split into tiles of 3; a reference that does not exist finds nothing", async () => {
    await show("2:1-7");
    await waitFor(() => expect(keys()).toEqual(["2:1-3", "2:4-6", "2:7-7"]));
    expect(screen.getByRole("status").textContent).toBe(t.resAyahCount(7)); // the ayahs covered, not the 3 tiles
    await act(async () => openSearch("2:999"));
    await waitFor(() => expect(screen.getByText(t.noResults)).toBeTruthy());
    await act(async () => openSearch("999:1"));
    await waitFor(() => expect(screen.getByText(t.noResults)).toBeTruthy());
  });

  it("Results not right? opens the report with the search; Back goes Home", async () => {
    await show("patience");
    await waitFor(() => expect(tiles()).toHaveLength(3));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: t.resultsWrong }));
    expect(store.getState().report).toMatchObject({ kind: "search", note: '"patience"' });
    expect(getRoute().view).toBe("results");
    await user.click(screen.getByRole("button", { name: t.back }));
    await waitFor(() => expect(getRoute().view).toBe("find"));
  });

  it("shows the selected translation instead of the English when there is one", async () => {
    await show();
    store.dispatch({ type: "patch", patch: { translation: "ml.abdulhameed" } });
    await act(async () => openSearch("patience"));
    await waitFor(() => expect(keys()).toHaveLength(3));
    await waitFor(() => expect(screen.getByText("ml.abdulhameed 2:153")).toBeTruthy());
    expect(screen.queryByText("English 2:153")).toBeNull();
  });
  describe("more pages", () => {
    /** Page 1 (quick 2:153, 3:200; refined 3:200, 2:153, 39:10) offers page 2 (103:3, 2:153 again, 94:5), which offers
     *  page 3 (2:255), the last. */
    const pages = () => search.mockReset().mockImplementation(async (_q, mode, _signal, page = 1) =>
      page === 1 ? paged(mode === "fast" ? answer("fast", "2:153", "3:200") : answer("full", "3:200", "2:153", "39:10"), 2)
        : page === 2 ? paged(answer("full", "103:3", "2:153", "94:5"), 3) : paged(answer("full", "2:255")));
    const showMore = () => screen.getByRole("button", { name: t.resShowMore });
    const srcs = () => tiles().map((li) => li.querySelector("img")?.getAttribute("src"));

    it("Show more adds the next page below, without ayahs already shown; earlier tiles keep their backgrounds", async () => {
      pages();
      await show("patience");
      await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]));
      await waitFor(() => expect(tiles().every((li) => li.querySelector("img"))).toBe(true));
      const before = srcs();
      const user = userEvent.setup();
      await user.click(showMore());
      await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10", "103:3-3", "94:5-5"]));
      expect(search).toHaveBeenLastCalledWith("patience", "full", expect.any(AbortSignal), 2);
      expect(screen.getByRole("status").textContent).toBe(t.resAyahCount(5));
      // Focus moves to the first new tile (the button made way for the loading row).
      expect(document.activeElement).toBe(screen.getByRole("button", { name: t.watchAyah(name(103), "103:3") }));
      await waitFor(() => expect(tiles().every((li) => li.querySelector("img"))).toBe(true));
      expect(srcs().slice(0, 3)).toEqual(before);
      expect(new Set(srcs()).size).toBe(5); // the new ones take their own backgrounds too
      await waitFor(() => expect(within(tiles()[3]).getByText("ar 103:3")).toBeTruthy());

      await user.click(showMore()); // the last page: no more after it
      await waitFor(() => expect(keys()).toHaveLength(6));
      expect(screen.queryByRole("button", { name: t.resShowMore })).toBeNull();

      // Tapping an added tile opens the reels over every result shown, from that one.
      await user.click(screen.getByRole("button", { name: t.watchAyah(name(94), "94:5") }));
      const handed = takeReelStart()!;
      expect(handed[0].item.ref).toBe("94:5");
      expect(handed.map((h) => h.item.ref).sort()).toEqual(["103:3", "2:153", "2:255", "3:200", "39:10", "94:5"].sort());
      expect(handed[0].bg).toEqual({ type: "clip", id: "pb94x5" });
    });

    it("shows nothing more when page 1 is all there is; a failed page can be tried again; a new search starts at page 1", async () => {
      await show("patience");
      await waitFor(() => expect(tiles()).toHaveLength(3));
      expect(screen.queryByRole("button", { name: t.resShowMore })).toBeNull();
      expect(document.querySelector(".res-more")).toBeNull();

      pages();
      const ok = search.getMockImplementation()!;
      search.mockImplementation(async (q, mode, signal, page) => (page === 2 && q === "mercy" ? Promise.reject(new Error("503")) : ok(q, mode, signal, page)));
      await act(async () => openSearch("hope"));
      await waitFor(() => expect(tiles()).toHaveLength(3));
      const user = userEvent.setup();
      await user.click(showMore());
      await waitFor(() => expect(tiles()).toHaveLength(5));

      await act(async () => openSearch("mercy")); // page 1 of the new search only, and its own page 2 next
      await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]));
      await user.click(showMore());
      await waitFor(() => expect(screen.getByRole("button", { name: t.resMoreFailed })).toBeTruthy());
      expect(search).toHaveBeenLastCalledWith("mercy", "full", expect.any(AbortSignal), 2);
      expect(tiles()).toHaveLength(3);
      search.mockImplementation(ok);
      await user.click(screen.getByRole("button", { name: t.resMoreFailed }));
      await waitFor(() => expect(tiles()).toHaveLength(5));
    });

    it("nearing the end of the grid loads the next pages by itself, once the refined order is in", async () => {
      class Observer {
        live = true;
        constructor(private cb: IntersectionObserverCallback) {}
        observe() { queueMicrotask(() => this.live && this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); }
        disconnect() { this.live = false; }
      }
      vi.stubGlobal("IntersectionObserver", Observer);
      pages();
      const full = deferred<SearchResponse>();
      const impl = search.getMockImplementation()!;
      search.mockImplementation((q, mode, signal, page) => (mode === "full" && !page ? full.promise : impl(q, mode, signal, page)));
      await show("patience");
      await waitFor(() => expect(keys()).toEqual(["2:153-153", "3:200-200"]));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(search.mock.calls.some((c) => c[3])).toBe(false); // the quick order may still change
      await act(async () => full.resolve(paged(answer("full", "3:200", "2:153", "39:10"), 2)));
      await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10", "103:3-3", "94:5-5", "2:255-255"]));
      expect(search.mock.calls.map((c) => c[3]).filter(Boolean)).toEqual([2, 3]); // each page once
      expect(document.querySelector(".res-more")).toBeNull();
    });
  });
});
