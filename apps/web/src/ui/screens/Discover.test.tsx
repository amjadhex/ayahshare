// Discover: Browse first (the story circles, the ayah of the day, the most shared ayahs, Watch and listen, short ayahs and
// collections), and the stories a circle plays (Stories.tsx), with the network, drawing and the export engine replaced by stand-ins.
// Ayah text here is filler, never Quran text.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah, TopicsFile } from "../../../../../contracts/types";
import surahList from "../../../public/data/surahs.json";
import topicsFile from "../../../public/data/topics.json";
import { RECITERS } from "../../config";
import { dailyCandidates } from "../../discover";
import { hasReelStart, takeReelStart } from "../../feed";
import { getQuery } from "../../nav";
import { getRoute, initRouter } from "../../router";
import { createStore, type Store } from "../../state";
import { takeSurahStart } from "../../surah";
import { chipOf, TOPICS } from "../../topics";
import { ExportProvider } from "../exportJob";
import { StoreContext } from "../hooks";
import { Discover } from "./Discover";

const file = topicsFile as TopicsFile;

const world = vi.hoisted(() => ({
  /** What the server says about today: refs with counts (null = cannot be reached). */
  today: null as { ref: string; n: number }[] | null,
  stats: null as null | ((ref: string) => { likes: number; shares: number; makes: number; week: number }),
  topicsFail: false,
}));

vi.mock("../../analytics", () => ({ anon: "test", flush: () => {}, newDevice: () => {}, track: () => {} }));
// No moments (the day's mix does not depend on the clock).
vi.mock("../../topics", async (original) => ({ ...(await original<typeof import("../../topics")>()), momentsAt: () => new Set() }));

vi.mock("../../draw", () => ({
  fontsReady: () => Promise.resolve(),
  drawLayers: (W: number, H: number) => ({ plan: { width: W, height: H, box: { x: 0, y: H * 0.4, w: W, h: H * 0.2, radius: 0 }, blur: 0, parts: [] }, brand: {}, header: {}, box: null, parts: [] }),
  drawCover: () => {},
}));
vi.mock("../../export", () => ({
  canExportVideo: () => true,
  exportImage: vi.fn(async () => new Blob(["jpg"], { type: "image/jpeg" })),
  exportVideo: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
  previewImage: vi.fn(async () => undefined),
  thumbnail: vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })),
}));

vi.mock("../../api", () => {
  const clip = (id: string) => ({
    id, duration: 8, caption: id, tags: ["sky", "calm"], thumb: `thumbs/${id}.webp`,
    video: { portrait: `clips/p/${id}.mp4`, landscape: `clips/l/${id}.mp4` }, poster: { portrait: `posters/p/${id}.jpg`, landscape: `posters/l/${id}.jpg` },
  });
  return {
    mediaUrl: (p: string) => `/media/${p}`,
    clipUrl: () => "/media/clip.mp4",
    audioUrl: () => "/audio/x.mp3",
    audioPath: (f: string, s: number, a: number) => `/audio/${f}/${s}-${a}.mp3`,
    onCatalogue: () => () => {},
    setFavourite: vi.fn(async () => undefined),
    loadCatalogue: async () => {},
    loadAyahGroups: async () => {},
    clipById: (id: string) => (id.startsWith("pb") ? clip(id) : null),
    getSurahBackgrounds: async (surah: number) => ({ surah, sensitive: [], ayahs: new Proxy({}, { get: (_, ayah) => [`pb${surah}`, `pb${String(ayah)}`] }) }),
    getTopics: async (): Promise<TopicsFile> => { if (world.topicsFail) throw new Error("offline"); return (await import("../../../public/data/topics.json")).default as TopicsFile; },
    getTrending: async () => ["94:5", "94:6", "93:3"],
    // Even ayahs are short, odd ones long (filler text).
    getAyahText: async (_surah: number, from: number, to: number, translation: string) => {
      const ayahs = Array.from({ length: to - from + 1 }, (_, i) => ({ numberInSurah: from + i, text: (from + i) % 2 === 0 ? "نص قصير" : `نص ${"طويل ".repeat(45)}` }));
      return translation === "none" ? [{ ayahs }] : [{ ayahs }, { ayahs: ayahs.map((a) => ({ ...a, text: `Translation ${a.numberInSurah}` })) }];
    },
    getTrendingCounts: async (days: number) => { if (!world.today) throw new Error("no stats"); return { days, refs: world.today }; },
    getAyahStats: async (refs: string[]) => { if (!world.stats) throw new Error("no stats"); return { stats: refs.map((ref) => ({ ref, ...world.stats!(ref) })) }; },
    getMyImpact: async () => { throw new Error("unused"); },
  };
});

const surahs = surahList as Surah[];
let store: Store;

function mount(active = true) {
  history.replaceState(null, "", "/discover");
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: null, surahs, recipe: null });
  const ui = (a: boolean) => <StoreContext.Provider value={store}><ExportProvider phone><Discover active={a} /></ExportProvider></StoreContext.Provider>;
  const view = render(ui(active));
  return { ...view, setActive: (a: boolean) => view.rerender(ui(a)) };
}

beforeEach(() => {
  localStorage.setItem("qd.lang", "en");
  // Every ayah that could be the ayah of the day was shared 7 times today.
  world.today = dailyCandidates(file.topics, new Date()).map((ref) => ({ ref, n: 7 }));
  world.stats = () => ({ likes: 3, shares: 12, makes: 5, week: 21 });
  world.topicsFail = false;
  takeReelStart();
});
afterEach(() => vi.useRealTimers());

/** Discover opens on Browse: waits for its story circles. */
const browse = async () => { await screen.findByRole("list", { name: "Topics for today" }, { timeout: 8000 }); };
/** Taps story circle `k` (Browse). */
const openCircle = async (k = 0) => {
  await browse();
  fireEvent.click(within(screen.getByRole("list", { name: "Topics for today" })).getAllByRole("button")[k]);
};

describe("Discover", () => {
  it("loads nothing until it is shown, then shows every section", async () => {
    const api = await import("../../api");
    const spy = vi.spyOn(api, "getTopics");
    const { setActive } = mount(false);
    expect(spy).not.toHaveBeenCalled();
    act(() => setActive(true));
    await browse();
    // The first test of the file also pays for loading the topic files: allow for a busy machine.
    expect(await screen.findByRole("region", { name: "Ayah of the day" }, { timeout: 8000 })).toBeTruthy();
    for (const name of ["Most shared today", "Watch and listen", "Short ayahs for your status", "Collections"]) {
      expect(await screen.findByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { level: 1, name: "Discover" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Topics for today" })).getAllByRole("button")).toHaveLength(7);
  });

  it("the search button goes to Find", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(getRoute().view).toBe("find");
  });

  it("opens on Browse with no Play stories button; a circle plays its stories (not a search); a collection runs its search", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    expect(screen.queryByRole("region", { name: "Stories" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play stories" })).toBeNull();
    await openCircle(0);
    expect(await screen.findByRole("region", { name: "Stories" })).toBeTruthy();
    expect(getRoute()).toMatchObject({ view: "discover", sheet: "stories" });
    await waitFor(() => expect(document.querySelector(".story[data-current]")).toBeTruthy(), { timeout: 8000 });
    fireEvent.click(within(document.querySelector<HTMLElement>(".story[data-current]")!).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Stories" })).toBeNull());

    const collections = within((await screen.findByRole("heading", { name: "Collections" })).closest("section")!);
    // The collections change with the moment; the first one runs its topic's search.
    const collection = collections.getAllByRole("button")[0];
    const topic = TOPICS.find((tp) => chipOf(tp, "en").label === collection.querySelector("strong")?.textContent)!;
    await user.click(collection);
    expect(getRoute().view).toBe("results");
    expect(getQuery()).toBe(topic.q ?? topic.en);
  });

  it("the ayah of the day is a short one from the day's list, with how many shared it today; View opens it in Reels with its background", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    const card = within(await screen.findByRole("region", { name: "Ayah of the day" }));
    expect(card.getByText("نص قصير")).toBeTruthy();
    expect(await card.findByText("Shared by 7 people today")).toBeTruthy();
    expect(card.getByText(/^Translation \d+$/)).toBeTruthy();
    const view = card.getByRole("button", { name: /^Watch / });
    expect(view.textContent).toBe("View");
    await user.click(view);
    await waitFor(() => expect(getRoute().view).toBe("feed"));
    const handed = takeReelStart()!;
    expect(handed).toHaveLength(1);
    expect(handed[0].item.reason).toEqual({ kind: "today" });
    expect(handed[0].item.ayah % 2).toBe(0);
    expect(handed[0].bg?.type).toBe("clip");
  });

  it("watched today already (from Home or here): the card says Watch again", async () => {
    const user = userEvent.setup();
    const d = new Date();
    localStorage.setItem("qd.todayWatched", `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    mount();
    await browse();
    const card = within(await screen.findByRole("region", { name: "Ayah of the day" }));
    expect(card.getByRole("button", { name: /^Watch / }).textContent).toBe("Watch again");
    localStorage.removeItem("qd.todayWatched");
    await user.click(card.getByRole("button", { name: /^Watch / })); // and watching from here marks it too
    await waitFor(() => expect(localStorage.getItem("qd.todayWatched")).not.toBeNull());
    takeReelStart();
  });

  it("is the same all day and changes with the date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14, 8, 0));
    const a = mount();
    await browse();
    // The ayah itself (its translation names the ayah in this test), not the counts, which arrive a moment later.
    const ayah = async () => (await within(await screen.findByRole("region", { name: "Ayah of the day" })).findByText(/^Translation \d+$/)).textContent;
    const first = await ayah();
    a.unmount();
    vi.setSystemTime(new Date(2026, 9, 14, 22, 30));
    const b = mount();
    await browse();
    expect(await ayah()).toBe(first);
    b.unmount();
    vi.setSystemTime(new Date(2026, 9, 15, 8, 0));
    mount();
    await browse();
    expect(await ayah()).not.toBe(first);
  });

  it("Most shared today ranks the day's ayahs with their counts and the note that nobody is named", async () => {
    const user = userEvent.setup();
    world.today = [{ ref: "94:6", n: 90 }, { ref: "93:4", n: 40 }, { ref: "1:2", n: 3 }];
    mount();
    await browse();
    const section = within((await screen.findByRole("heading", { name: "Most shared today" })).closest("section")!);
    expect(section.getByText("Counted without names. Nobody sees who shared what.")).toBeTruthy();
    const rows = section.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText(/Ash-Sharh · 94:6/)).toBeTruthy();
    expect(within(rows[0]).getByText("90 shares · 5 made their own")).toBeTruthy();
    expect(within(rows[2]).getByText(/Al-Faatiha · 1:2/)).toBeTruthy();
    await user.click(within(rows[1]).getByRole("button"));
    await waitFor(() => expect(getRoute().view).toBe("feed")); // the ranking as reels, from the one tapped
    expect(takeReelStart()!.map((h) => h.item.ref)).toEqual(["93:4", "1:2", "94:6"]);
  });

  it("counts the server cannot give are hidden, and so is the ranking", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 3, 12, 0)); // an ayah of the day no other test has asked the stats for
    world.today = null;
    world.stats = null;
    mount();
    await browse();
    const card = within(await screen.findByRole("region", { name: "Ayah of the day" }));
    expect(card.queryByText(/Shared by/)).toBeNull();
    await screen.findByRole("heading", { name: "Collections" });
    expect(screen.queryByRole("heading", { name: "Most shared today" })).toBeNull();
    expect(screen.queryByText(/Counted without names/)).toBeNull();
  });

  it("Watch and listen: a thumbnail opens Reels on that reel first, the ones before it after", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    const section = within((await screen.findByRole("heading", { name: "Watch and listen" })).closest("section")!);
    const tiles = await waitFor(() => {
      const list = section.getAllByRole("listitem").filter((li) => li.querySelector("button.disc-reel"));
      expect(list).toHaveLength(8);
      return list;
    });
    const labels = tiles.map((li) => li.querySelector("button")!.getAttribute("aria-label")!);
    await user.click(within(tiles[3]).getByRole("button"));
    expect(getRoute().view).toBe("feed");
    expect(hasReelStart()).toBe(true);
    const handed = takeReelStart()!;
    expect(handed).toHaveLength(8);
    expect(handed.map((h) => `${surahs[h.item.surah - 1].name_en} ${h.item.ref}`)).toEqual([...labels.slice(3), ...labels.slice(0, 3)]);
    expect(handed.every((h) => h.bg?.type === "clip")).toBe(true);
    expect(hasReelStart()).toBe(false); // taken once
  });

  it("Open Reels starts at the first reel", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    const open = await screen.findByRole("button", { name: "Open Reels" });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    await user.click(open);
    expect(getRoute().view).toBe("feed");
    expect(takeReelStart()).toHaveLength(8);
  });

  it("short ayahs: a grid of the ones that are really short, in threes, each opening as reels", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    const section = within((await screen.findByRole("heading", { name: "Short ayahs for your status" })).closest("section")!);
    const tiles = await waitFor(() => {
      const list = section.getAllByRole("button");
      expect(list.every((b) => b.classList.contains("disc-tile"))).toBe(true);
      return list;
    });
    expect(tiles.length % 3).toBe(0);
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    for (const tile of tiles) expect(within(tile).getByText("نص قصير")).toBeTruthy(); // the long ones were left out
    await user.click(tiles[1]);
    await waitFor(() => expect(getRoute().view).toBe("feed")); // the tiles as reels, from the one tapped
    const handed = takeReelStart()!;
    expect(handed).toHaveLength(tiles.length);
    expect(handed[0].item.ayah % 2).toBe(0);
    expect(handed.every((h) => h.bg?.type === "clip")).toBe(true);
  });

  it("offers Try again when the topic lists cannot be loaded", async () => {
    const user = userEvent.setup();
    world.topicsFail = true;
    mount();
    expect(await screen.findByText(/Discover could not load/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Ayah of the day" })).toBeNull();
    world.topicsFail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Ayah of the day" })).toBeTruthy(); // Browse, not the stories
    expect(screen.queryByRole("region", { name: "Stories" })).toBeNull();
  });
});

describe("Discover: play a whole surah", () => {
  beforeEach(() => { localStorage.removeItem("qd.surahProgress"); localStorage.removeItem("qd.surahReciter"); takeSurahStart(); });
  const section = async () => within((await screen.findByRole("heading", { name: "Play a whole surah" })).closest("section")!);

  it("sits after the ayah of the day and offers the popular surahs, each playing from its first ayah", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    const row = await section();
    const aotd = await screen.findByRole("region", { name: "Ayah of the day" }, { timeout: 8000 });
    const mostShared = await screen.findByRole("heading", { name: "Most shared today" });
    expect(aotd.compareDocumentPosition(row.getByRole("heading", { name: "Play a whole surah" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mostShared.compareDocumentPosition(row.getByRole("heading", { name: "Play a whole surah" })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(row.getByText("Every ayah in order, one reel after another.")).toBeTruthy();
    expect(row.getAllByRole("button").filter((b) => b.classList.contains("disc-surah")).map((b) => b.getAttribute("aria-label")))
      .toEqual([67, 36, 18, 55, 56].map((n) => `Play ${surahs[n - 1].name_en}`));
    expect(row.queryByText("Continue")).toBeNull();
    expect(row.getByText("30 ayahs")).toBeTruthy();
    await user.click(row.getByRole("button", { name: "Play Al-Mulk" }));
    expect(getRoute().view).toBe("feed");
    const handed = takeSurahStart()!;
    expect(handed.surah.n).toBe(67);
    expect(handed.items[0].ref).toBe("67:1");
  });

  it("the surah in progress comes first as Continue, with where the person stopped, and is not repeated", async () => {
    const user = userEvent.setup();
    const reciter = RECITERS[1][0];
    localStorage.setItem("qd.surahProgress", JSON.stringify({ surah: 67, ayah: 12, reciter }));
    mount();
    await browse();
    const row = await section();
    const cards = row.getAllByRole("button").filter((b) => b.classList.contains("disc-surah"));
    expect(cards).toHaveLength(5);
    expect(cards[0].getAttribute("aria-label")).toBe("Continue Al-Mulk from ayah 12");
    expect(within(cards[0]).getByText("Continue")).toBeTruthy();
    expect(within(cards[0]).getByText("Ayah 12 of 30")).toBeTruthy();
    expect(cards[0].querySelector<HTMLElement>(".disc-surah-bar i")!.style.width).toBe("40%");
    expect(row.queryByRole("button", { name: "Play Al-Mulk" })).toBeNull();
    await user.click(cards[0]);
    expect(getRoute().view).toBe("feed");
    const handed = takeSurahStart()!;
    expect(handed.reciter).toBe(reciter);
    expect(handed.items[0].ref.startsWith("67:")).toBe(true);
    expect(Number(handed.items[0].ref.split(":")[1])).toBeLessThanOrEqual(12);
    expect(handed.items.at(-1)!.ref.startsWith("67:")).toBe(true);
  });

  it("All surahs opens the full list", async () => {
    const user = userEvent.setup();
    mount();
    await browse();
    await user.click((await section()).getByRole("button", { name: "All surahs" }));
    expect(getRoute().view).toBe("surahs");
  });
});

describe("Discover stories", () => {
  const current = () => document.querySelector<HTMLElement>(".story[data-current]")!;
  const bars = () => [...document.querySelectorAll(".story-bars span")].map((b) => b.getAttribute("data-state") ?? "now");
  const touch = () => {
    const el = document.querySelector<HTMLElement>(".story-touch")!;
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 700, right: 400, bottom: 700, x: 0, y: 0, toJSON() {} });
    return el;
  };
  const press = (x: number, y = 300) => fireEvent.pointerDown(touch(), { pointerId: 1, button: 0, clientX: x, clientY: y });
  const release = (x: number, y = 300) => fireEvent.pointerUp(touch(), { pointerId: 1, clientX: x, clientY: y });
  const tap = (x: number) => { press(x); release(x); };
  const ready = () => waitFor(() => expect(document.querySelector(".story-touch")).toBeTruthy(), { timeout: 8000 });
  /** The story count of the circle playing ("Story n of m"; m: that circle's stories). */
  const at = (n: number) => expect(screen.getByText(new RegExp(`^Story ${n} of \\d+$`))).toBeTruthy();
  const total = () => +(document.querySelector(".story-count")?.textContent?.match(/of (\d+)/)?.[1] ?? 0);
  const play = async (k = 0) => { mount(); await openCircle(k); await ready(); };

  it("a circle plays its stories full screen: a bar per story of that circle, close, sound and the reel's actions", async () => {
    await play();
    expect(screen.getByRole("region", { name: "Stories" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Discover" })).toBeTruthy();
    at(1);
    expect(total()).toBeGreaterThan(1);
    expect(bars()).toEqual(["now", ...Array(total() - 1).fill("todo")]);
    const story = within(current());
    for (const name of ["Like", "Share", "Download", "Reflect", "Close"]) expect(story.getByRole("button", { name })).toBeTruthy();
    expect(story.getByRole("button", { name: /^Edit / })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Collections" })).toBeNull(); // Browse waits underneath
  });

  it("after a circle's last story come the next circle's, like Instagram", async () => {
    await play(0);
    const reason = () => current().querySelector(".reel-reason")?.textContent;
    const first = reason(), n = total();
    for (let k = 1; k < n; k++) tap(300);
    at(n);
    expect(reason()).toBe(first);
    tap(300);
    at(1); // the next circle: its own bars
    expect(bars()).toEqual(["now", ...Array(total() - 1).fill("todo")]);
    expect(reason()).not.toBe(first);
  });

  it("Back closes the stories to Browse (they are a history entry)", async () => {
    await play(1);
    expect(getRoute().sheet).toBe("stories");
    await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Stories" })).toBeNull());
    expect(getRoute()).toMatchObject({ view: "discover", sheet: null });
    expect(screen.getByRole("list", { name: "Topics for today" })).toBeTruthy();
  });

  it("the right half goes to the next story and the left half back; the arrows and ← → too", async () => {
    await play();
    const first = current().getAttribute("aria-label");
    tap(300);
    at(2);
    expect(current().getAttribute("aria-label")).not.toBe(first);
    expect(bars().slice(0, 3)).toEqual(["done", "now", "todo"]);
    tap(50);
    at(1);
    expect(current().getAttribute("aria-label")).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Next story" }));
    at(2);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    at(3);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    at(2);
    fireEvent.click(screen.getByRole("button", { name: "Previous story" }));
    at(1);
  });

  it("a long press pauses without moving on; a swipe down closes them to Browse, and a circle plays them again", async () => {
    await play();
    press(300);
    await waitFor(() => expect(document.querySelector(".stories[data-held]")).toBeTruthy());
    release(300);
    at(1); // held, not a tap
    expect(document.querySelector(".stories[data-held]")).toBeNull();
    press(200, 200);
    release(205, 420);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Stories" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Play stories" })).toBeNull();
    await openCircle(0);
    await ready();
    at(1);
  });

  it("goes on to the next story by itself at the end of the ayah", async () => {
    await play();
    const audio = document.querySelector<HTMLAudioElement>(".stories audio")!;
    await waitFor(() => expect(audio.getAttribute("src")).toBeTruthy(), { timeout: 4000 });
    // Each ayah's recitation ends in turn (a passage's story has up to 3); after the last one the tail (1.5 s) follows.
    const range = current().getAttribute("aria-label")?.match(/(\d+)–(\d+)/);
    const ayahs = range ? +range[2] - +range[1] + 1 : 1;
    for (let k = 0; k < ayahs; k++) {
      fireEvent(audio, new Event("ended"));
      await new Promise((r) => setTimeout(r, 20));
    }
    at(1);
    await waitFor(() => at(2), { timeout: 4000 });
    expect(bars().slice(0, 2)).toEqual(["done", "now"]);
  });
});
