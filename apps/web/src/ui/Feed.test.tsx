// Reels: the restyled controls (title and sound switch, Like / Save / Share / Download / Reflect with counts, the details with Customize beside them, the swipe hint and the progress bar) and the reels Discover opens it on. The network, canvas drawing and
// the export engine are replaced with stand-ins; ayah text is filler. See App.test.tsx for the same mocks in the whole app.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe, Surah } from "../../../../contracts/types";
import surahList from "../../public/data/surahs.json";
import { DEFAULT_RECIPE, RECITERS } from "../config";
import { clearDevice, listDevice } from "../history";
import { startReelsWith, type FeedItem } from "../feed";
import { openSurah } from "../surah";
import { retapTab } from "../nav";
import { HD_STALL_MS, noteClipDownload, resetClipSpeed, resetSoundHeard, resetWarmFeed, warmFirstReel, type Prepared } from "../reels";
import { resetJoin } from "../join";
import { platform } from "../platform";
import { getRoute, initRouter } from "../router";
import { resetSignals } from "../signals";
import { createStore, type Store } from "../state";
import { getStreak, resetStreak } from "../streak";
import { t } from "../strings";
import { Feed, REFRESH_MS, ReelMedia } from "./Feed";
import { ExportProvider } from "./exportJob";
import { StoreContext } from "./hooks";

const world = vi.hoisted(() => ({
  onDevice: (_path: string): boolean => true,
  stats: null as null | ((ref: string) => { likes: number; shares: number; makes: number; week: number }),
  /** The topic lists never come (a stalled network): a new mix waits forever. */
  topicsHang: false,
}));
vi.mock("../analytics", () => ({ anon: "test", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../draw", () => ({
  fontsReady: () => Promise.resolve(),
  drawLayers: (W: number, H: number) => ({ plan: { width: W, height: H, box: { x: 0, y: H * 0.4, w: W, h: H * 0.2, radius: 0 }, blur: 0, parts: [] }, brand: {}, header: {}, box: null, parts: [] }),
  drawCover: () => {},
}));
const engine = vi.hoisted(() => ({
  canExportVideo: () => true,
  exportImage: vi.fn(async () => new Blob(["jpg"], { type: "image/jpeg" })),
  exportVideo: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
  previewImage: vi.fn(async () => undefined),
  thumbnail: vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })),
}));
vi.mock("../export", () => engine);
vi.mock("../topics", async (original) => ({ ...(await original<typeof import("../topics")>()), momentsAt: () => new Set() }));
vi.mock("../endpoint", async (original) => ({ ...(await original<typeof import("../endpoint")>()), onDevice: (p: string) => world.onDevice(p) }));
vi.mock("../api", async () => {
  const surahs = (await import("../../public/data/surahs.json")).default;
  return {
    mediaUrl: (p: string) => `/media/${p}`,
    clipUrl: () => "/media/clip.mp4",
    audioUrl: () => "/audio/x.mp3",
    audioPath: (f: string, s: number, a: number) => `/audio/${f}/${s}-${a}.mp3`,
    getSurahs: async () => surahs,
    loadCatalogue: async () => {},
    loadAyahGroups: async () => {},
    onCatalogue: () => () => {},
    clipById: (id: string) => (id.startsWith("pb") ? {
      id, duration: 8, caption: id, tags: [], thumb: `thumbs/${id}.webp`,
      video: { portrait: `clips/p/${id}.mp4`, landscape: `clips/l/${id}.mp4` }, poster: { portrait: `posters/p/${id}.jpg`, landscape: `posters/l/${id}.jpg` },
    } : null),
    getSurahBackgrounds: async (surah: number) => ({ surah, sensitive: [], ayahs: new Proxy({}, { get: (_, ayah) => ["pb1", `pb${surah}${String(ayah)}`] }) }),
    getAyahText: async (_s: number, from: number, to: number) => {
      const ayahs = Array.from({ length: to - from + 1 }, (_, i) => ({ numberInSurah: from + i, text: `نص ${from + i}` }));
      return [{ ayahs }, { ayahs: ayahs.map((a) => ({ ...a, text: `Text ${a.numberInSurah}` })) }];
    },
    getTopics: async () => {
      if (world.topicsHang) await new Promise(() => {});
      return { version: "test", topics: [
      { id: "hope", label: "hope", refs: ["94:5", "94:6", "65:7"] },
      { id: "patience", label: "patience", refs: ["2:153", "39:10", "3:200", "2:45", "8:46", "16:127", "103:3"] },
      { id: "guidance", label: "guidance", refs: ["1:6", "6:125", "93:7"] },
    ] };
    },
    getTrending: async () => ["94:5"],
    getAyahStats: async (refs: string[]) => { if (!world.stats) throw new Error("no stats"); return { stats: refs.map((ref) => ({ ref, ...world.stats!(ref) })) }; },
    getTrendingCounts: async () => ({ days: 1, refs: [] }),
    setFavourite: vi.fn(async () => undefined),
  };
});

const surahs = surahList as Surah[];
let store: Store;

function mount(active = true) {
  window.__width = 390;
  history.replaceState(null, "", "/feed");
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: null, surahs, recipe: null });
  const ui = (a: boolean) => (
    <StoreContext.Provider value={store}><ExportProvider phone><Feed active={a} /></ExportProvider></StoreContext.Provider>
  );
  const view = render(ui(active));
  return { ...view, setActive: (a: boolean) => view.rerender(ui(a)) };
}
/** Opens the feed; the first reel is the popular 94:5. */
const reel0 = async () => { mount(); return within(await screen.findByRole("article", { name: /94:5/ })); };
/** Opens Language and audio (the settings button on top). */
const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Language and audio" }));
  return within(await screen.findByRole("dialog", { name: "Language and audio" }));
};
/** Share and Download first ask for the format (FormatSheet): picks one. */
const chooseFormat = async (user: ReturnType<typeof userEvent.setup>, format: "Video" | "Image") => {
  const sheet = within(await screen.findByRole("dialog", { name: /^(Share|Download) as$/ }));
  await user.click(sheet.getByRole("button", { name: new RegExp(`^${format}`) }));
};
const item = (ref: string): FeedItem => ({ key: `${ref}#0`, ref, surah: +ref.split(":")[0], ayah: +ref.split(":")[1], reason: { kind: "discover" }, effect: "glass", animation: "rise" });

beforeEach(async () => {
  // The mix always takes its first choice: popular (94:5) first.
  vi.spyOn(Math, "random").mockReturnValue(0);
  localStorage.clear();
  localStorage.setItem("qd.lang", "en");
  localStorage.setItem("qd.reciterAsked", "1"); // My preferred reciter has its own tests
  resetSignals();
  resetStreak([]);
  resetJoin();
  await clearDevice();
  world.stats = null;
  world.onDevice = () => true;
  world.topicsHang = false;
  resetWarmFeed();
  resetSoundHeard();
});
afterEach(() => vi.restoreAllMocks());

describe("Reels", () => {
  it("shows no counts when the server has none, and keeps the details and Customize", async () => {
    const reel = await reel0();
    expect(screen.getByRole("heading", { level: 1, name: "Reels" })).toBeTruthy();
    expect(reel.getByText(/Ash-Sharh · 94:5/)).toBeTruthy();
    expect(RECITERS.map(([, name]) => name)).toContain(document.querySelector("article .reel-reciter span")!.textContent); // the reel's own reciter
    for (const name of ["Like", "Save", "Share", "Download", "Reflect"]) expect(reel.getByRole("button", { name })).toBeTruthy(); // no counts yet: just the words
    expect(reel.getAllByRole("button").filter((b) => b.closest(".reel-rail")).map((b) => b.textContent)).toEqual(["Like", "Save", "Share", "Download", "Reflect"]); // no HD chip: a download is always HD
    // On top: the mood as the title, then sound and settings; no language pill or mood chips on the reels.
    expect(screen.getByRole("button", { name: "For you" }).getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getByRole("button", { name: "Language and audio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^My language/ })).toBeNull();
    // Customize is in the details row (not the rail), named after the ayah; "Make yours" is gone.
    const customize = reel.getByRole("button", { name: "Edit Ash-Sharh 94:5" });
    expect(customize.textContent).toBe("Edit");
    expect(customize.closest(".reel-who")).toBeTruthy();
    expect(customize.closest(".reel-rail")).toBeNull();
    expect(reel.queryByText("Make yours")).toBeNull();
    expect(reel.queryByRole("button", { name: /Make yours/ })).toBeNull();
    expect(reel.queryByText(/Shared by/)).toBeNull();
    expect(within(reel.getByRole("button", { name: "Like" })).getByText("Like")).toBeTruthy(); // no number: the word
    expect(reel.queryByRole("button", { name: /^Turn sound/ })).toBeNull(); // sound is one switch at the top
  });

  it("shows the counts on Like and Share, and no reason line or \"Shared by\" line in the details", async () => {
    world.stats = () => ({ likes: 3, shares: 12400, makes: 5, week: 21 });
    const reel = await reel0();
    expect(await reel.findByRole("button", { name: "Like, 3" })).toBeTruthy();
    expect(reel.getByRole("button", { name: "Share, 12k" })).toBeTruthy();
    expect(reel.queryByText(/Shared by|made their own/)).toBeNull(); // the counts on the rail say it (owner, 12 Oct 2026)
    expect(document.querySelector("article .reel-reason")).toBeNull(); // no "Popular this week" / "For you"
  });

  it("Like is the favourite: it keeps the ayah, moves the count by one, and turns off again", async () => {
    world.stats = () => ({ likes: 3, shares: 0, makes: 0, week: 0 });
    const user = userEvent.setup();
    const reel = await reel0();
    await user.click(await reel.findByRole("button", { name: "Like, 3" }));
    expect(store.getState().favourites).toContain("94:5");
    expect(reel.getByRole("button", { name: "Like, 4" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(reel.getByRole("button", { name: "Like, 4" }));
    expect(store.getState().favourites).not.toContain("94:5");
    expect(reel.getByRole("button", { name: "Like, 3" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("the sound switch is at the top; reels play with sound by default, and a mute is remembered on this device", async () => {
    const user = userEvent.setup();
    const view = mount();
    await screen.findByRole("article", { name: /94:5/ });
    const audio = () => document.querySelector("audio")!;
    await waitFor(() => expect(audio().getAttribute("src")).toBeTruthy(), { timeout: 4000 });
    expect(audio().muted).toBe(false);
    expect(screen.queryByText("Tap for sound")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Turn sound off" }));
    expect(audio().muted).toBe(true);
    expect(localStorage.getItem("qd.reelsMuted")).toBe("1");
    view.unmount();
    mount(); // next visit: still muted
    await screen.findByRole("article", { name: /94:5/ });
    expect(screen.getByRole("button", { name: "Turn sound on" })).toBeTruthy();
    await waitFor(() => expect(audio().getAttribute("src")).toBeTruthy(), { timeout: 4000 });
    expect(audio().muted).toBe(true);
    await user.click(screen.getByRole("button", { name: "Turn sound on" }));
    expect(localStorage.getItem("qd.reelsMuted")).toBeNull();
  }, 15000);

  it("when the browser refuses sound, the reel plays muted with Tap for sound, and the first tap anywhere turns it on", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      return this instanceof HTMLAudioElement && !this.muted ? Promise.reject(new DOMException("no tap yet", "NotAllowedError")) : Promise.resolve();
    });
    await reel0();
    expect(await screen.findByRole("button", { name: /Tap for sound/ }, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn sound on" })).toBeTruthy();
    expect(document.querySelector("audio")!.muted).toBe(true);
    expect(localStorage.getItem("qd.reelsMuted")).toBeNull(); // not the person's choice: not remembered
    play.mockRestore();
    fireEvent.click(document.body);
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy();
    expect(document.querySelector("audio")!.muted).toBe(false);
    expect(screen.queryByRole("button", { name: /Tap for sound/ })).toBeNull();
  }, 15000);

  it("once sound has been heard, the choice stays: a later refusal shows Tap for sound but keeps the switch on, and the next reel starts with sound", async () => {
    const user = userEvent.setup();
    let refuse = false;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      return this instanceof HTMLAudioElement && !this.muted && refuse ? Promise.reject(new DOMException("no", "NotAllowedError")) : Promise.resolve();
    });
    await reel0();
    const audio = () => document.querySelector("audio")!;
    await waitFor(() => expect(audio().getAttribute("src")).toBeTruthy(), { timeout: 4000 });
    expect(audio().muted).toBe(false); // heard with sound
    refuse = true; // the browser refuses the next one
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("button", { name: /Tap for sound/ }, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy(); // the person's choice: still on
    refuse = false;
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getAllByRole("article")[2].getAttribute("aria-current")).toBe("true"));
    await waitFor(() => expect(play.mock.contexts.some((c) => c === audio() && !audio().muted)).toBe(true));
    expect(audio().muted).toBe(false); // the next reel starts with sound
  }, 15000);

  it("a play cut short (a newer load or a pause) is not a refusal: no Tap for sound, the sound stays on", async () => {
    let first = true;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement && first) { first = false; return Promise.reject(new DOMException("interrupted", "AbortError")); }
      return Promise.resolve();
    });
    await reel0();
    await waitFor(() => expect(document.querySelector("audio")!.getAttribute("src")).toBeTruthy(), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /Tap for sound/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy();
    expect(document.querySelector("audio")!.muted).toBe(false);
  });

  it("Language and audio has My language, and the translation voice switch only where My language has a recorded voice", async () => {
    const user = userEvent.setup();
    localStorage.setItem("qd.lang", "fr");
    const view = mount();
    await screen.findAllByRole("article");
    let sheet = await openSettings(user);
    expect(sheet.queryByRole("switch")).toBeNull();
    expect(sheet.getByText(/has no recorded voice yet/)).toBeTruthy();
    await user.click(sheet.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    view.unmount();
    localStorage.setItem("qd.lang", "en");
    await reel0();
    sheet = await openSettings(user);
    const voice = sheet.getByRole("switch", { name: "Hear the meaning" });
    expect(voice.getAttribute("aria-checked")).toBe("false");
    expect(sheet.getByText("After each ayah is recited, a voice reads its meaning in English.")).toBeTruthy();
    // My language opens the language picker.
    await user.click(sheet.getByRole("button", { name: /^My language/ }));
    expect(store.getState().langPicker).toBe("change");
  });

  it("the switch and the toast are in English even when My language is Malayalam (it chooses the translation, not the app's language)", async () => {
    const user = userEvent.setup();
    localStorage.setItem("qd.lang", "ml");
    mount();
    await screen.findAllByRole("article");
    const voice = (await openSettings(user)).getByRole("switch", { name: "Hear the meaning" });
    await user.click(voice);
    expect(screen.getByRole("status").textContent).toBe("Meaning on");
    await user.click(voice);
    expect(screen.getByRole("status").textContent).toBe("Meaning off");
  });

  it("a coach mark under the settings button shows once, on the first reels with a voice, and goes on a tap, a toggle or time", async () => {
    const user = userEvent.setup();
    const view = mount();
    await screen.findAllByRole("article");
    const coach = await screen.findByText("Turn on to hear the meaning in English after each ayah", {}, { timeout: 3000 });
    await user.click(screen.getByRole("heading", { level: 1, name: "Reels" })); // a tap anywhere
    expect(coach.isConnected).toBe(false);
    expect(localStorage.getItem("qd.meaningCoach")).toBe("1");
    // Remembered on the device: not again.
    view.unmount();
    mount();
    await screen.findAllByRole("article");
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByText(/Turn on to hear the meaning/)).toBeNull();
  });

  it("the coach mark goes when the settings button is tapped, names Malayalam in English, and is not shown where there is no voice", async () => {
    const user = userEvent.setup();
    localStorage.setItem("qd.lang", "fr");
    const view = mount();
    await screen.findAllByRole("article");
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByText(/Turn on to hear the meaning/)).toBeNull();
    expect(localStorage.getItem("qd.meaningCoach")).toBeNull(); // still to come, once a voice exists
    view.unmount();
    localStorage.setItem("qd.lang", "ml");
    mount();
    const coach = await screen.findByText("Turn on to hear the meaning in Malayalam after each ayah", {}, { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Language and audio" }));
    expect(coach.isConnected).toBe(false);
  });

  it("the coach mark waits while Tap for sound is shown", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      return this instanceof HTMLAudioElement ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : Promise.resolve();
    });
    mount();
    await screen.findByRole("button", { name: /Tap for sound/ }, { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByText(/Turn on to hear the meaning/)).toBeNull();
    expect(localStorage.getItem("qd.meaningCoach")).toBeNull();
  });

  it("the translation voice switch applies at once to the reel on screen and the next ones, without a new mix, and is the Feed voice preference", async () => {
    const user = userEvent.setup();
    const reel = await reel0();
    const keys = () => screen.getAllByRole("article").map((a) => a.getAttribute("data-ref"));
    const before = keys();
    const sheet = await openSettings(user);
    const voice = sheet.getByRole("switch", { name: "Hear the meaning" });
    await user.click(voice);
    expect(voice.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Meaning on");
    await user.click(sheet.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    expect(store.getState().prefs).toMatchObject({ feedVoice: true, voice: true });
    expect(JSON.parse(localStorage.getItem("qd.prefs")!)).toMatchObject({ feedVoice: true });
    expect(keys()).toEqual(before); // the same reels, in place
    // The narrator's name is not shown (owner, 9 Oct 2026): the reciter alone.
    expect(screen.getAllByRole("article").some((a) => a.querySelector(".reel-reciter")!.textContent!.includes("Ibrahim Walk"))).toBe(false);
    // The reel on screen has the voice now (its video is made with it).
    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: /^Share/ }));
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    expect((engine.exportVideo.mock.calls.at(-1) as unknown[])[0]).toMatchObject({ recipe: { voice: "en.walk", translation: "en.sahih" } });
    // The next reel has it too (Customize carries its design).
    await user.click(within(screen.getAllByRole("article")[1]).getByRole("button", { name: /^Edit / }));
    expect(store.getState().recipe).toMatchObject({ voice: "en.walk", translation: "en.sahih" });
  });

  it("turned off, the reels drop the voice, and a reel shows Profile's setting when it changes there", async () => {
    const user = userEvent.setup();
    localStorage.setItem("qd.prefs", JSON.stringify({ feedVoice: true, voice: true }));
    const reel = await reel0();
    const reciterLine = () => reel.getByText((_, el) => !!el?.matches(".reel-reciter > span")).textContent!;
    const voice = (await openSettings(user)).getByRole("switch", { name: "Hear the meaning" });
    expect(voice.getAttribute("aria-checked")).toBe("true");
    expect(reciterLine()).not.toMatch(/Ibrahim Walk/); // the narrator's name is not shown
    await user.click(voice);
    expect(screen.getByRole("status").textContent).toBe("Meaning off");
    expect(store.getState().prefs.feedVoice).toBe(false);
    act(() => store.dispatch({ type: "prefs", prefs: { feedVoice: true, voice: true } })); // switched on in Profile
    expect(voice.getAttribute("aria-checked")).toBe("true");
  });

  it("tapping the Reels tab again goes back to the top with fresh reels, leaving out the ones already shown", async () => {
    const user = userEvent.setup();
    await reel0();
    const refs = () => screen.getAllByRole("article").map((a) => a.getAttribute("data-ref")!);
    const before = refs();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getAllByRole("article")[1].getAttribute("aria-current")).toBe("true"));
    act(() => retapTab("feed"));
    await waitFor(() => expect(refs().some((r) => before.includes(r))).toBe(false));
    expect(refs().length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByRole("article")[0].getAttribute("aria-current")).toBe("true"));
    act(() => retapTab("find")); // another tab: nothing
    expect(refs().some((r) => before.includes(r))).toBe(false);
  });

  it("new reels that do not come in time: the indicator always goes, a toast says so, and the reels there are stay", async () => {
    await reel0();
    const refs = () => screen.getAllByRole("article").map((a) => a.getAttribute("data-ref")!);
    const before = refs();
    world.topicsHang = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      act(() => retapTab("feed"));
      expect(screen.getByText("Getting new reels…")).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS - 1_000));
      expect(screen.getByText("Getting new reels…")).toBeTruthy(); // still trying
      await act(() => vi.advanceTimersByTimeAsync(1_100));
      expect(screen.queryByText("Getting new reels…")).toBeNull();
      expect(store.getState().toast?.text).toBe(t.refreshFailed);
      expect(refs()).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
    // A later refresh still works.
    world.topicsHang = false;
    act(() => retapTab("feed"));
    await waitFor(() => expect(refs().some((r) => before.includes(r))).toBe(false));
    expect(screen.queryByText("Getting new reels…")).toBeNull();
  });

  it("swiping on to another reel while new reels are coming lets the refresh go (the indicator clears)", async () => {
    const user = userEvent.setup();
    await reel0();
    world.topicsHang = true;
    act(() => retapTab("feed"));
    expect(screen.getByText("Getting new reels…")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300)); // the scroll back to the first reel lands
    expect(screen.getByText("Getting new reels…")).toBeTruthy();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getAllByRole("article")[1].getAttribute("aria-current")).toBe("true"));
    expect(screen.queryByText("Getting new reels…")).toBeNull();
    expect(store.getState().toast?.text).not.toBe(t.refreshFailed);
  });

  it("pulling the first reel down past the line brings fresh reels; a small pull does nothing", async () => {
    await reel0();
    const reels = document.querySelector<HTMLElement>(".reels")!;
    const refs = () => screen.getAllByRole("article").map((a) => a.getAttribute("data-ref")!);
    const before = refs();
    const drag = (to: number) => {
      fireEvent.touchStart(reels, { touches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.touchMove(reels, { touches: [{ clientX: 100, clientY: to }] });
    };
    drag(150); // 50 px: below the line
    expect(screen.getByRole("status").textContent).toBe("Pull for new reels");
    fireEvent.touchEnd(reels, { changedTouches: [{ clientX: 100, clientY: 150 }] });
    await new Promise((r) => setTimeout(r, 300));
    expect(refs()).toEqual(before);
    drag(60); // a swipe up (to the next reel) is not a pull
    expect(screen.queryByText(/new reels/i)).toBeNull();
    fireEvent.touchEnd(reels, { changedTouches: [{ clientX: 100, clientY: 60 }] });
    drag(240); // 140 px: past it
    expect(screen.getByRole("status").textContent).toBe("Release for new reels");
    fireEvent.touchEnd(reels, { changedTouches: [{ clientX: 100, clientY: 240 }] });
    await waitFor(() => expect(refs().some((r) => before.includes(r))).toBe(false));
  });

  it("opens on the first reel warmed on Home: the same reels, no second mix", async () => {
    warmFirstReel({ lang: "en", prefs: {}, interests: [], favourites: [], scene: { surahs, editions: {}, brand: "AyahShare" }, size: [390, 760] });
    const api = await import("../api");
    await new Promise((r) => setTimeout(r, 50)); // the warm-up has picked its reels
    const topics = vi.spyOn(api, "getTopics");
    const reel = await reel0();
    expect(reel.getByText(/Ash-Sharh · 94:5/)).toBeTruthy();
    expect(topics).not.toHaveBeenCalled(); // the warmed mix was taken over
    expect(screen.getAllByRole("article").length).toBeGreaterThanOrEqual(4);
  });

  it("Customize opens Create with the reel's design", async () => {
    const user = userEvent.setup();
    const reel = await reel0();
    await user.click(reel.getByRole("button", { name: "Edit Ash-Sharh 94:5" }));
    expect(getRoute().view).toBe("create");
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 5, orientation: "portrait" });
    expect(store.getState().bgManual).toBe(true);
  });

  it("Save keeps the design in Saved (once), Reflect opens the Reflect sheet, Share makes the video", async () => {
    const user = userEvent.setup();
    const reel = await reel0();
    await waitFor(() => expect((reel.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(reel.getByRole("button", { name: "Save" }));
    await user.click(reel.getByRole("button", { name: "Save" }));
    expect(reel.getByRole("button", { name: "Save" }).getAttribute("aria-pressed")).toBe("true");
    expect(store.getState().toast?.text).toBe("Saved to your profile");
    await waitFor(async () => expect(await listDevice()).toHaveLength(1));
    expect((await listDevice())[0].recipe).toMatchObject({ surah: 94, from: 5 });

    await user.click(reel.getByRole("button", { name: "Reflect" }));
    expect(store.getState().reflect).toEqual({ ref: "94:5", from: "feed" });
    expect(getRoute().sheet).toBe("reflect");

    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: /^Share/ })); // with its count when the server has one
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
  });

  it("Share and Download ask Video or Image first; Image makes a picture (saved straight to the device for Download), and comes first next time", async () => {
    vi.spyOn(platform, "saveFile").mockResolvedValue();
    const user = userEvent.setup();
    const reel = await reel0();
    await waitFor(() => expect((reel.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    engine.exportImage.mockClear();
    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: "Download" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Download as" }));
    expect(sheet.getAllByRole("button").filter((b) => b.classList.contains("format-choice")).map((b) => b.querySelector("strong")!.textContent)).toEqual(["Video", "Image"]);
    await user.click(sheet.getByRole("button", { name: /^Image/ }));
    await waitFor(() => expect(engine.exportImage).toHaveBeenCalledTimes(1));
    expect(engine.exportVideo).not.toHaveBeenCalled();
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledTimes(1));
    expect((vi.mocked(platform.saveFile).mock.calls[0] as [File, string])[1]).toMatch(/\.jpg$/);
    // The last choice comes first next time.
    await waitFor(() => expect((reel.getByRole("button", { name: /^Share/ }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(reel.getByRole("button", { name: /^Share/ }));
    const next = within(await screen.findByRole("dialog", { name: "Share as" }));
    expect(next.getAllByRole("button").filter((b) => b.classList.contains("format-choice")).map((b) => b.querySelector("strong")!.textContent)).toEqual(["Image", "Video"]);
    localStorage.removeItem("qd.shareFormat");
  });

  it("the shape is chosen in the same sheet: Story 9:16 by default, Square or Wide makes the file in that shape, and is kept", async () => {
    const user = userEvent.setup();
    const reel = await reel0();
    await waitFor(() => expect((reel.getByRole("button", { name: /^Share/ }) as HTMLButtonElement).disabled).toBe(false));
    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: /^Share/ }));
    const sheet = within(await screen.findByRole("dialog", { name: "Share as" }));
    const shapes = within(sheet.getByRole("group", { name: "Shape" }));
    expect(shapes.getAllByRole("button").map((b) => b.textContent)).toEqual(["Story9:16", "Square1:1", "Wide16:9"]);
    expect(shapes.getByRole("button", { name: /^Story/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(shapes.getByRole("button", { name: /^Square/ }));
    await user.click(sheet.getByRole("button", { name: /^Video/ }));
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    expect((engine.exportVideo.mock.calls[0] as unknown[])[0]).toMatchObject({ recipe: { surah: 94, from: 5, orientation: "square" } });
    expect(localStorage.getItem("qd.shareShape")).toBe("square");
    localStorage.removeItem("qd.shareShape");
  });

  it("Download makes the same MP4 as Share and saves it straight to the device, without the Export sheet", async () => {
    vi.spyOn(platform, "saveFile").mockResolvedValue();
    const user = userEvent.setup();
    const reel = await reel0();
    await waitFor(() => expect((reel.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: "Download" }));
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    const scene = (engine.exportVideo.mock.calls[0] as unknown[])[0] as { recipe: { surah: number; from: number }; hd: boolean; current: number };
    expect(scene).toMatchObject({ recipe: { surah: 94, from: 5 }, hd: true, current: 0 }); // the scene Share exports, in HD (a download)
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledTimes(1));
    const [file, name] = vi.mocked(platform.saveFile).mock.calls[0] as [File, string];
    expect(name).toMatch(/\.mp4$/);
    expect(file).toMatchObject({ name, type: "video/mp4" });
    // Said as a toast on the feed; no Export sheet, no "ready" file left behind.
    await waitFor(() => expect(store.getState().toast?.text).toBe(`Saved ${name}`));
    expect(getRoute().sheet).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
    // Counts like a Share: the streak day and the auto-saved design.
    expect(getStreak()).toMatchObject({ days: 1, today: true });
    await waitFor(async () => expect((await listDevice()).map((d) => [d.kind, d.recipe.surah, d.recipe.from])).toEqual([["video", 94, 5]]));
    await waitFor(() => expect((reel.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("while a reel is being made Share and Download are both busy, and the progress shows on the one that was tapped", async () => {
    vi.spyOn(platform, "saveFile").mockResolvedValue();
    let progress: (n: number, phase: string) => void = () => {}, finish: (b: Blob) => void = () => {};
    engine.exportVideo.mockImplementationOnce(((_scene: unknown, _signal: unknown, onProgress: typeof progress) => {
      progress = onProgress;
      return new Promise<Blob>((resolve) => (finish = resolve));
    }) as never);
    const user = userEvent.setup();
    const reel = await reel0();
    await waitFor(() => expect((reel.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(reel.getByRole("button", { name: "Download" }));
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalled());
    act(() => progress(0.4, "rendering"));
    const download = await reel.findByRole("button", { name: "Making video… 40%" });
    expect(download.textContent).toBe("40%Download");
    expect((download as HTMLButtonElement).disabled).toBe(true);
    const share = reel.getByRole("button", { name: /^Share/ }); // with its count when the server has one
    expect((share as HTMLButtonElement).disabled).toBe(true);
    expect(share.textContent).not.toContain("%"); // the progress is on Download only
    await act(async () => { finish(new Blob(["mp4"], { type: "video/mp4" })); });
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((reel.getByRole("button", { name: /^Share/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("Download always saves HD, even after Standard was picked elsewhere; Share follows the picked quality; the reels have no HD chip", async () => {
    vi.spyOn(platform, "saveFile").mockResolvedValue();
    localStorage.setItem("qd.hd", "false"); // Standard, picked in the Export sheet
    const user = userEvent.setup();
    const reel = await reel0();
    expect(reel.queryByRole("button", { name: /HD/ })).toBeNull();
    await waitFor(() => expect((reel.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    const hdOf = (k: number) => ((engine.exportVideo.mock.calls[k] as unknown[])[0] as { hd: boolean }).hd;
    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: /^Share/ }));
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    expect(hdOf(0)).toBe(false);
    await waitFor(() => expect((reel.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(reel.getByRole("button", { name: "Download" }));
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(2));
    expect(hdOf(1)).toBe(true);
  });

  it("the mood on top opens How are you feeling?; a mood picked there re-steers the reels and becomes the title", async () => {
    const user = userEvent.setup();
    await reel0();
    await user.click(screen.getByRole("button", { name: "For you" }));
    const sheet = within(await screen.findByRole("dialog", { name: "How are you feeling?" }));
    const moods = within(sheet.getByRole("group", { name: "Moods" }));
    expect(moods.getByRole("button", { name: /^For you/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(moods.getByRole("button", { name: "Patience" }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    await waitFor(() => expect(screen.getAllByRole("article")[0].dataset.ref).not.toBe("94:5")); // a new mix
    expect(screen.getByRole("button", { name: "Patience" }).getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("an HD video that cannot be made on the device is made in Standard instead, with a note", async () => {
    vi.spyOn(platform, "saveFile").mockResolvedValue();
    engine.exportVideo.mockImplementationOnce((async () => { throw new Error("h264 encoder"); }) as never);
    const user = userEvent.setup();
    const reel = await reel0();
    const toasts: string[] = [];
    store.subscribe(() => { const text = store.getState().toast?.text; if (text && toasts.at(-1) !== text) toasts.push(text); });
    await waitFor(() => expect((reel.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: "Download" }));
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledTimes(1));
    expect((engine.exportVideo.mock.calls as unknown[][]).map((c) => (c[0] as { hd: boolean }).hd)).toEqual([true, false]);
    expect(toasts[0]).toBe("HD didn't work on this device, so it was made in Standard.");
    expect(toasts.at(-1)).toMatch(/^Saved .*\.mp4$/); // then the usual "saved"
    expect(localStorage.getItem("qd.hd")).toBeNull(); // the person's choice is not changed
  });

  it("the swipe hint shows on the first reel until the person moves on, and not again", async () => {
    const user = userEvent.setup();
    const first = mount();
    await screen.findByRole("article", { name: /94:5/ });
    expect(screen.getByText("Swipe up for the next ayah")).toBeTruthy();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.queryByText("Swipe up for the next ayah")).toBeNull());
    expect(localStorage.getItem("qd.reelsHint")).toBe("1");
    first.unmount();
    mount();
    await screen.findByRole("article", { name: /94:5/ });
    expect(screen.queryByText("Swipe up for the next ayah")).toBeNull();
  });

  it("a trackpad swipe (a long burst of wheel events) moves exactly one reel", async () => {
    await reel0();
    const reels = document.querySelector<HTMLElement>(".reels")!;
    for (let i = 0; i < 80; i++) fireEvent.wheel(reels, { deltaY: Math.max(2, 100 - i * 1.5) });
    await waitFor(() => expect(screen.getAllByRole("article")[1].getAttribute("aria-current")).toBe("true"));
    await new Promise((r) => setTimeout(r, 600));
    const current = screen.getAllByRole("article").map((a) => a.getAttribute("aria-current"));
    expect(current.indexOf("true")).toBe(1); // not the third: the rest of the swipe's events did nothing
    expect(current.filter(Boolean)).toHaveLength(1);
  });

  it("arrow keys step one reel each, even pressed again before the first has landed", async () => {
    const user = userEvent.setup();
    await reel0();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(screen.getAllByRole("article")[2].getAttribute("aria-current")).toBe("true"));
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(screen.getAllByRole("article")[1].getAttribute("aria-current")).toBe("true"));
  });

  it("neighbouring reels use different reciters, and Customize carries the reel's own into the editor", async () => {
    const user = userEvent.setup();
    await reel0();
    const articles = screen.getAllByRole("article");
    const names = articles.map((a) => a.querySelector(".reel-reciter span")!.textContent);
    expect(names.every((n) => RECITERS.some(([, name]) => name === n))).toBe(true);
    for (let i = 1; i < names.length; i++) expect(names[i]).not.toBe(names[i - 1]);
    expect(new Set(names).size).toBeGreaterThanOrEqual(4);
    const last = articles[3];
    await user.click(within(last).getByRole("button", { name: /^Edit / }));
    const folder = RECITERS.find(([, name]) => name === names[3])![0];
    expect(store.getState().recipe.reciter).toBe(folder);
  });

  it("with Translation voice in Feed on, reels read My language's translation after the recitation, and share it so", async () => {
    const user = userEvent.setup();
    localStorage.setItem("qd.prefs", JSON.stringify({ feedVoice: true }));
    const reel = await reel0();
    expect(reel.queryByText(/Ibrahim Walk/)).toBeNull();
    engine.exportVideo.mockClear();
    await user.click(reel.getByRole("button", { name: /^Share/ }));
    await chooseFormat(user, "Video"); // Share and Download ask first: a video or an image
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    expect((engine.exportVideo.mock.calls.at(-1) as unknown[])[0]).toMatchObject({ recipe: { voice: "en.walk", translation: "en.sahih" } });
    await user.click(reel.getByRole("button", { name: "Edit Ash-Sharh 94:5" }));
    expect(store.getState().recipe).toMatchObject({ voice: "en.walk", translation: "en.sahih" });
  });

  it("reels play the recitation only by default", async () => {
    const reel = await reel0();
    expect(reel.queryByText(/· Ibrahim Walk$/)).toBeNull();
  });

  it("each reel has a progress bar", async () => {
    await reel0();
    expect(document.querySelectorAll("article .reel-progress i").length).toBeGreaterThan(0);
  });

  it("opens on the reels Discover handed over, in order, and goes on with its own mix after them", async () => {
    const bg: Recipe["bg"] = { type: "clip", id: "pb77" };
    startReelsWith([{ item: item("2:153"), bg }, { item: item("1:6"), bg }]);
    mount();
    await screen.findByRole("article", { name: /2:153/ });
    const refs = screen.getAllByRole("article").map((a) => a.dataset.ref);
    expect(refs.slice(0, 2)).toEqual(["2:153", "1:6"]);
    expect(refs.length).toBeGreaterThanOrEqual(6);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("Reels already on screen takes reels handed over later (a reminder tapped while watching opens today's ayah)", async () => {
    mount();
    await screen.findAllByRole("article");
    act(() => startReelsWith([{ item: { ...item("40:65"), reason: { kind: "today" } }, bg: { type: "clip", id: "pb77" } }]));
    await waitFor(() => expect(screen.getAllByRole("article")[0].dataset.ref).toBe("40:65"));
    expect(screen.getByText("Today's ayah")).toBeTruthy();
  });

  it("today's ayah says so on top, with the day, in place of the mood; Remind me only in the app; the next reel is back to the mood", async () => {
    const user = userEvent.setup();
    startReelsWith([{ item: { ...item("47:24"), reason: { kind: "today" } }, bg: { type: "clip", id: "pb77" } }]);
    mount();
    await screen.findByRole("article", { name: /47:24/ });
    expect(screen.getByText("Today's ayah")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "For you" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remind me" })).toBeNull(); // the web has no daily reminder
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getAllByRole("article")[1].getAttribute("aria-current")).toBe("true"));
    expect(screen.getByRole("button", { name: "For you" })).toBeTruthy();
  });

  it("asks once who to hear; a reciter chosen recites every reel, and Language and audio can change it back to the mix", async () => {
    const user = userEvent.setup();
    localStorage.removeItem("qd.reciterAsked");
    mount();
    await screen.findAllByRole("article");
    const ask = within(await screen.findByRole("dialog", { name: "Who would you like to hear?" }, { timeout: 4000 }));
    expect(ask.getAllByRole("radio")[0].textContent).toMatch(/^Mix of reciters/);
    await user.click(ask.getByRole("radio", { name: RECITERS[1][1] }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Who would you like to hear?" })).toBeNull());
    expect(JSON.parse(localStorage.getItem("qd.prefs")!).reelReciter).toBe(RECITERS[1][0]);
    // A new mix with that reciter on every reel.
    await waitFor(() => {
      const reels = screen.getAllByRole("article");
      expect(reels.every((a) => within(a).queryByText(RECITERS[1][1]))).toBe(true);
    });
    // Each reciter has a sample (Al-Fatiha 1:2): the reel pauses for it.
    const settings0 = await openSettings(user);
    await user.click(settings0.getByRole("button", { name: new RegExp(`My preferred reciter.*${RECITERS[1][1]}`) })); // shows who
    const list = within(await screen.findByRole("dialog", { name: "My preferred reciter" }));
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    await user.click(list.getByRole("button", { name: `Hear ${RECITERS[0][1]}` }));
    expect(play.mock.contexts.some((el) => el !== document.querySelector(".feed-wrap audio"))).toBe(true); // its own player
    expect(list.getByRole("button", { name: `Stop ${RECITERS[0][1]}` }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".paused-badge")).toBeTruthy();
    play.mockRestore();
    // The mix can be chosen again; never asked again.
    await user.click(list.getByRole("radio", { name: /Mix of reciters/ }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("qd.prefs")!).reelReciter).toBe("mix"));
    expect(localStorage.getItem("qd.reciterAsked")).toBe("1");
  }, 15_000);

  it("a whole surah plays in order with one reciter, goes on to the next reel by itself, keeps where it is, and ends with the next surah", async () => {
    const user = userEvent.setup();
    const set = vi.spyOn(platform.nowPlaying, "set");
    await openSurah(surahs[111], { reciter: RECITERS[1][0] });
    mount();
    await screen.findByRole("article", { name: /112:1/ });
    const articles = () => screen.getAllByRole("article");
    expect(articles().map((a) => a.dataset.ref)).toEqual(["112:1", "112:2", "112:3", "112:4"]);
    expect(screen.getByText("Al-Ikhlaas")).toBeTruthy();
    expect(screen.getByText("Ayah 1 of 4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "For you" })).toBeNull();
    expect(articles().map((a) => within(a).getByText(RECITERS[1][1])).length).toBe(4); // every reel, the same reciter
    await waitFor(() => expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Al-Ikhlaas · 112:1", artist: RECITERS[1][1] })));
    // The recitation ends: after the short pause the next reel comes on by itself.
    const audio = document.querySelector<HTMLAudioElement>(".feed-wrap audio")!;
    await waitFor(() => expect(audio.getAttribute("src")).toBeTruthy());
    fireEvent(audio, new Event("ended"));
    await waitFor(() => expect(articles()[1].getAttribute("aria-current")).toBe("true"), { timeout: 4000 });
    expect(screen.getByText("Ayah 2 of 4")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("qd.surahProgress")!)).toEqual({ surah: 112, ayah: 2, reciter: RECITERS[1][0] });
    // The last reel ends: the end screen, with the next surah on its way.
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(articles()[3].getAttribute("aria-current")).toBe("true"));
    await waitFor(() => expect(audio.getAttribute("src")).toMatch(/112-4|x\.mp3/));
    fireEvent(audio, new Event("ended"));
    const end = within(await screen.findByRole("dialog", { name: "You listened to all of Al-Ikhlaas" }, { timeout: 4000 }));
    expect(end.getByText("Al-Falaq")).toBeTruthy();
    expect(end.getByRole("button", { name: "Play Al-Falaq now" })).toBeTruthy();
    expect(localStorage.getItem("qd.surahProgress")).toBeNull(); // played to the end: nothing to continue
  }, 15_000);

  it("a reel handed over while the feed is already open starts the feed again from it", async () => {
    const { setActive } = mount();
    await screen.findByRole("article", { name: /94:5/ });
    act(() => setActive(false));
    startReelsWith([{ item: item("39:10"), bg: { type: "clip", id: "pb77" } }]);
    act(() => setActive(true));
    await waitFor(() => expect(screen.getAllByRole("article")[0].dataset.ref).toBe("39:10"));
    expect(screen.getAllByRole("article")[0].getAttribute("aria-current")).toBe("true");
  });
});

describe("Reels offline (the app)", () => {
  it("leaves out a reel whose recitation is not on the device, and gives an uncached clip a plain background", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    world.onDevice = (p) => !(p.startsWith("/audio/") && p.endsWith("/94-5.mp3")) && !p.startsWith("/media/");
    mount();
    const first = await screen.findAllByRole("article");
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((a) => /94:5/.test(a.getAttribute("aria-label") ?? ""))).toBe(false); // its recitation is not here
    expect(document.querySelector("article video")).toBeNull(); // no clip on the device: plain backgrounds
    online.mockRestore();
  });
});

describe("Reels in 1080p", () => {
  const clipOf = (hd?: string) => ({
    id: "pb9", duration: 8, caption: "pb9", tags: [], thumb: "thumbs/pb9.webp",
    video: { portrait: "clips/p/pb9.mp4", landscape: "clips/l/pb9.mp4" }, poster: { portrait: "posters/p/pb9.jpg", landscape: "posters/l/pb9.jpg" },
    ...(hd ? { hd: { portrait: hd } } : {}),
  });
  /** One reel's media on its own, on screen (`active`) or not. */
  /** `warm`: the reel has all its own media in memory (the 1080p file waits for that). */
  function media(hd?: string, warm = true) {
    const clip = clipOf(hd);
    const recipe: Recipe = { ...structuredClone(DEFAULT_RECIPE), surah: 94, from: 5, to: 5, bg: { type: "clip", id: clip.id } };
    const prepared: Prepared = { ayahs: null, layers: null, size: [720, 1280], clip, video: null, audio: [], durations: [], warm, failed: false };
    const audio = { current: null }, scrolling = { current: false };
    const ui = (active: boolean, paused = false) => (
      <ReelMedia reel={{ item: item("94:5"), recipe }} prepared={prepared} size={[720, 1280]} scale={0.5} active={active} drawn paused={paused}
        sound={false} audio={audio} scrolling={scrolling} onTap={() => {}} onLength={() => {}} />
    );
    const view = render(ui(true));
    return { videos: () => [...view.container.querySelectorAll("video")], set: (active: boolean, paused = false) => view.rerender(ui(active, paused)) };
  }
  const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); noteClipDownload(3_000_000, 1_200); }); // 20 Mbps
  afterEach(() => { vi.useRealTimers(); resetClipSpeed(); });

  it("starts on the 720p file and, once on screen for 1.5 s on a good connection, swaps to the 1080p one", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const m = media("clips/p1080/pb9.mp4");
    expect(m.videos().map((v) => v.getAttribute("src"))).toEqual(["/media/clip.mp4"]);
    await pass(1_400);
    expect(m.videos()).toHaveLength(1);
    await pass(200);
    const [hd, sd] = m.videos();
    expect(hd.getAttribute("src")).toBe("/media/clips/p1080/pb9.mp4");
    expect(sd.getAttribute("src")).toBe("/media/clip.mp4"); // still the one seen
    await act(async () => { hd.dispatchEvent(new Event("canplaythrough")); hd.dispatchEvent(new Event("playing")); });
    expect(sd.style.visibility).toBe("hidden");
    expect(sd.hasAttribute("src")).toBe(false);
    pause.mockClear();
    act(() => m.set(true, true)); // pausing the reel now pauses the 1080p video
    expect(pause.mock.contexts).toContain(hd);
  });

  it("no 1080p file, a slow or unknown connection, or data saver: it stays on 720p", async () => {
    const plain = media();
    await pass(3_000);
    expect(plain.videos()).toHaveLength(1);
    cleanup();
    resetClipSpeed(); // nothing measured (iOS has no connection info)
    const unknown = media("clips/p1080/pb9.mp4");
    await pass(3_000);
    expect(unknown.videos()).toHaveLength(1);
    cleanup();
    noteClipDownload(3_000_000, 1_200);
    Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g", downlink: 20 }, configurable: true });
    try {
      const saver = media("clips/p1080/pb9.mp4");
      await pass(3_000);
      expect(saver.videos()).toHaveLength(1);
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
  });

  it("swiping away before 1.5 s, or while the 1080p file loads, cancels it; a failed file keeps the 720p one", async () => {
    const m = media("clips/p1080/pb9.mp4");
    await pass(1_000);
    act(() => m.set(false));
    await pass(2_000);
    expect(m.videos()).toHaveLength(1); // never on screen long enough
    act(() => m.set(true));
    await pass(1_500);
    expect(m.videos()).toHaveLength(2);
    act(() => m.set(false)); // swiped away while loading
    expect(m.videos()).toHaveLength(1);
    expect(m.videos()[0].getAttribute("src")).toBe("/media/clip.mp4");
    act(() => m.set(true));
    await pass(1_500);
    const [hd, sd] = m.videos();
    act(() => { hd.dispatchEvent(new Event("error")); });
    expect(m.videos()).toEqual([sd]);
    expect(sd.style.visibility).toBe("");
  });

  it("waits for the reel's own media; a 1080p file that does not take over in time is given up (the 720p one plays on)", async () => {
    const cold = media("clips/p1080/pb9.mp4", false);
    await pass(3_000);
    expect(cold.videos()).toHaveLength(1); // still downloading its own clip and recitation: no 1080p yet
    cleanup();
    const m = media("clips/p1080/pb9.mp4");
    await pass(1_500);
    expect(m.videos()).toHaveLength(2); // loading
    await pass(HD_STALL_MS);
    expect(m.videos()).toHaveLength(1); // stalled: given up
    expect(m.videos()[0].getAttribute("src")).toBe("/media/clip.mp4");
    expect(m.videos()[0].style.visibility).toBe("");
  });

  it("leaving the screen lets the 1080p video go and shows the 720p one again, so a reel scrolled back to is never blank", async () => {
    const m = media("clips/p1080/pb9.mp4");
    await pass(1_500);
    const [hd, sd] = m.videos();
    await act(async () => { hd.dispatchEvent(new Event("canplaythrough")); hd.dispatchEvent(new Event("playing")); });
    expect(sd.style.visibility).toBe("hidden");
    act(() => m.set(false));
    expect(m.videos()).toEqual([sd]);
    expect(sd.style.visibility).toBe("");
    expect(sd.getAttribute("src")).toBe("/media/clip.mp4");
    expect(sd.getAttribute("poster")).toBeTruthy();
  });
});
