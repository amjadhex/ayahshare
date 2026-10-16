// End-to-end component tests of the whole app (the real shell, router, store and screens): the navigation and the shell
// (bottom bar on phones, side bar on tablets and computers, old addresses, each screen's scroll place), then the journeys
// across screens: search → Results → Create (the editor and its sheets) → Share, Profile and Settings (signed in and
// out), Reels, and the owner's feedback cases. Each screen's own details are in screens/*.test.tsx and Feed.test.tsx.
// The network, analytics, canvas drawing and the export engine are replaced with stand-ins; ayah text here is filler.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Surah } from "../../../../contracts/types";
import surahList from "../../public/data/surahs.json";
import { startApp } from "../app";
import { clearDevice, listDevice, saveDevice } from "../history";
import { resetJoin } from "../join";
import { getPickStart, getQuery, setQuery } from "../nav";
import { platform } from "../platform";
import { getRoute, initRouter, navigate, type View } from "../router";
import { resetSignals } from "../signals";
import { createStore, type Store } from "../state";
import { getStreak, resetStreak } from "../streak";
import { t } from "../strings";
import { setTheme } from "../theme";
import { chipOf, TOPICS } from "../topics";
import { App } from "./App";

const PATIENCE = vi.hoisted(() => ["2:153", "39:10", "3:200", "2:45", "8:46", "16:127", "103:3", "11:115", "70:5", "40:55", "31:17", "2:155", "2:156", "2:157", "2:177"]);
const tracked = vi.hoisted(() => [] as { name: string; props?: Record<string, unknown> }[]);
vi.mock("../analytics", () => ({
  anon: "test-anon",
  flush: () => {},
  newDevice: () => {},
  track: (name: string, props?: Record<string, unknown>) => tracked.push({ name, props }),
}));

vi.mock("../draw", () => ({
  fontsReady: () => Promise.resolve(),
  // Layers with a known text block and header (centred on their default places), so the preview's drag areas have a place.
  drawLayers: (W: number, H: number, _ayahs: unknown, { recipe }: { recipe: { headerX: number; headerY: number } }) => ({
    plan: { width: W, height: H, box: { x: W * 0.07, y: H * 0.4, w: W * 0.86, h: H * 0.2, radius: 28 }, boxAt: { x: W * 0.07, y: H * 0.4 },
      area: { top: H * 0.03, bottom: H * 0.93 }, blur: 0, parts: [], brandAt: { x: W * 0.4, y: H * 0.94 },
      header: { rect: { x: (recipe.headerX - 0.2) * W, y: (recipe.headerY - 0.035) * H, w: W * 0.4, h: H * 0.07 },
        at: { x: (recipe.headerX - 0.2) * W, y: (recipe.headerY - 0.035) * H } } },
    brand: {}, header: {}, box: null, parts: [],
  }),
  drawCover: () => {},
}));

const engine = vi.hoisted(() => ({
  canExportVideo: (): boolean => true,
  exportImage: vi.fn(async (_scene: unknown) => new Blob(["jpg"], { type: "image/jpeg" })),
  exportVideo: vi.fn(async (_scene: unknown, _signal: AbortSignal, _progress: (n: number, phase: string) => void) => new Blob(["mp4"], { type: "video/mp4" })),
  previewImage: vi.fn(async () => undefined),
  thumbnail: vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })),
}));
vi.mock("../export", () => engine);
// The feed's day context depends on the clock; tests run without one (no moments), so the mix is the same at any hour.
vi.mock("../topics", async (original) => ({ ...(await original<typeof import("../topics")>()), momentsAt: () => new Set() }));

vi.mock("../api", async () => {
  const fast = [{ ref: "2:153", text: "Seek help through patience and prayer." }, { ref: "3:200", text: "Be patient and endure." }];
  const full = [{ ref: "3:200", text: "Be patient and endure." }, { ref: "2:153", text: "Seek help through patience and prayer." }, { ref: "39:10", text: "The patient will be given their reward." }];
  const surahs = (await import("../../public/data/surahs.json")).default;
  return {
    setMediaBase: () => {},
    mediaUrl: (p: string) => `/media/${p}`,
    clipUrl: () => "/media/clip.mp4",
    audioUrl: () => "/audio/x.mp3",
    getConfig: vi.fn(async () => ({ appName: "AyahShare", googleClientId: null as string | null, mediaBase: "/media/" })),
    getMe: vi.fn(async () => ({ id: "u1", name: "Amina", email: "amina@example.test", avatar: null })),
    getFavourites: vi.fn(async () => ["94:5"]),
    setFavourite: vi.fn(async () => undefined),
    getCreations: vi.fn(async () => [
      { id: "c1", title: "Ash-Sharh 94:5–6", kind: "video", created_at: 1760000000000, updated_at: Date.now(), thumb: "/api/creations/c1/thumb?v=1", recipe: { v: 1, surah: 94, from: 5, to: 6, reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "square", bg: { type: "colour", colour: "#152238" }, font: "Amiri Quran", quranSize: 4, transSize: 3, textColor: "#ffffff", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0 } },
      { id: "c2", title: "Al-Ikhlas 112:1", kind: "image", created_at: 1750000000000, updated_at: 1750000000000, thumb: null, recipe: { v: 1, surah: 112, from: 1, to: 1, reciter: "Husary_128kbps", translation: "en.sahih", orientation: "portrait", bg: { type: "colour", colour: "#10241f" }, font: "Amiri Quran", quranSize: 4, transSize: 3, textColor: "#ffffff", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0 } },
    ]),
    deleteCreation: vi.fn(async () => undefined),
    saveCreation: vi.fn(async (c: { recipe: unknown; title: string; kind: string }) => ({ id: "new", ...c, created_at: Date.now(), updated_at: Date.now(), thumb: null })),
    patchMe: vi.fn(async (patch: Record<string, unknown>) => ({ id: "u1", name: "Amina", email: "amina@example.test", avatar: null, ...patch })),
    deleteMe: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    getSurahs: async () => surahs,
    getEditions: async () => [
      { identifier: "en.sahih", language: "en", englishName: "Saheeh International", name: "" },
      { identifier: "ml.abdulhameed", language: "ml", englishName: "Abdul Hameed and Kunhi", name: "" },
    ],
    loadCatalogue: async () => {},
    loadAyahGroups: async () => {},
    onCatalogue: () => () => {},
    // Every pb… id is a clip; each ayah's suggestions are a shared clip first, then one of its own.
    clipById: (id: string) => (id.startsWith("pb") ? {
      id, duration: 8, caption: id, tags: [], thumb: `thumbs/${id}.webp`,
      video: { portrait: `clips/p/${id}.mp4`, landscape: `clips/l/${id}.mp4` }, poster: { portrait: `posters/p/${id}.jpg`, landscape: `posters/l/${id}.jpg` },
    } : null),
    allClips: () => [],
    ensureClip: async () => {},
    remember: (c: unknown) => c,
    getSurahBackgrounds: async (surah: number) => ({ surah, sensitive: [], ayahs: new Proxy({}, { get: (_, ayah) => ["pb1", `pb${surah}${String(ayah)}`] }) }),
    searchClips: async () => [],
    getAyahText: async (_s: number, from: number, to: number) => {
      const ayahs = Array.from({ length: to - from + 1 }, (_, i) => ({ numberInSurah: from + i, text: `نص ${from + i}` }));
      return [{ ayahs }, { ayahs: ayahs.map((a) => ({ ...a, text: `Text ${a.numberInSurah}` })) }];
    },
    search: vi.fn(async (_q: string, mode: "fast" | "full") => ({ q: _q, mode, topic: "patience", results: mode === "fast" ? fast : full })),
    getShare: vi.fn(async (): Promise<unknown> => { throw new Error("404"); }),
    createShare: async () => ({ code: "abc", url: "https://example.test/s/abc" }),
    sendReport: vi.fn(async () => undefined),
    reuseShare: async () => undefined,
    getAyahEnglish: async () => "English",
    getAyahFromSurah: vi.fn(async (surah: number, ayah: number, edition: string) => (edition === "quran-uthmani" ? `عربي ${surah}:${ayah}` : `${edition} ${surah}:${ayah}`)),
    // Discover, Reels and Reflect
    getTopics: async () => ({ version: "test", topics: [
      { id: "hope", label: "hope", refs: ["94:5", "94:6", "65:7"] },
      { id: "patience", label: "patience", refs: PATIENCE },
      { id: "guidance", label: "guidance", refs: ["1:6", "6:125", "93:7"] },
      { id: "remembrance", label: "remembrance", refs: ["13:28", "33:41", "2:152"] },
      { id: "sleep", label: "sleep", refs: ["2:255", "25:47", "78:9"] },
    ] }),
    getTrending: async () => ["94:5"],
    getTrendingCounts: async (days: number) => ({ days, refs: [] }),
    getAyahStats: async () => ({ stats: [] }), // no counts: tiles and reels show the words only
    getImpact: async () => { throw new Error("offline"); }, // Profile hides its impact card
    getAnnouncements: async () => [], // Notifications: no news from AyahShare
    getMyImpact: async () => { throw new Error("offline"); },
    getTafsir: vi.fn(async (ref: string, lang: string) => ({
      ref, lang: lang === "ur" ? "ur" : "en", fallback: lang !== "en" && lang !== "ur", tafsir: { id: 169, name: "Ibn Kathir (Abridged)", author: "Hafiz Ibn Kathir" },
      from: ref, to: ref, html: `<h2>Tafsir of ${ref}</h2><p>Text here.</p>`,
      options: [{ id: 169, name: "Ibn Kathir (Abridged)" }, { id: 168, name: "Ma'arif al-Qur'an" }],
    })),
    getReflections: vi.fn(async (ref: string, lang: string, page = 1) => ({ ref, lang, total: 0, page, pages: 1, posts: [] })),
    saveLang: vi.fn(async () => ({})),
  };
});

// The machine may be busy with other test runs: generous timeouts.
vi.setConfig({ testTimeout: 30_000 });

const surahs = surahList as Surah[];
const name = (n: number) => surahs[n - 1].name_en;
let store: Store, stop: () => void;
let firstOpen = false;

async function start(width: number, path = "/") {
  window.__width = width;
  if (!firstOpen) localStorage.setItem("qd.lang", "en");
  localStorage.setItem("qd.reciterAsked", "1"); // Reels' one-time reciter question (Feed.test.tsx)
  history.replaceState(null, "", path);
  initRouter();
  store = createStore();
  stop = startApp(store);
  const view = render(<App store={store} />);
  await waitFor(() => expect(store.getState().ready && !store.getState().loading).toBe(true));
  return view;
}

// The page's scroll place, which jsdom does not keep: window.scrollY follows window.scrollTo.
let scrollY = 0;

beforeEach(async () => {
  tracked.length = 0;
  firstOpen = false;
  localStorage.clear();
  localStorage.setItem("qd.editorTips", "1"); // the editor's first-run tips (Create.test.tsx) stay out of the way
  resetSignals();
  resetStreak([]);
  resetJoin(); // no sign-up sheet left over from another test
  await clearDevice();
  setQuery(""); // the search the Results screen shows is kept between visits (nav.ts)
  scrollY = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  window.scrollTo = vi.fn((x?: number | ScrollToOptions, y?: number) => { scrollY = typeof x === "object" ? x.top ?? 0 : y ?? 0; }) as typeof window.scrollTo;
  // Files go to the platform's share menu, save and clipboard: watched, not performed.
  vi.spyOn(platform, "canShareFile").mockReturnValue(true);
  vi.spyOn(platform, "shareFile").mockResolvedValue(true);
  vi.spyOn(platform, "saveFile").mockResolvedValue();
  vi.spyOn(platform, "copyText").mockResolvedValue();
  engine.exportImage.mockClear();
  engine.exportVideo.mockClear();
  engine.thumbnail.mockClear();
});
afterEach(() => { stop?.(); vi.restoreAllMocks(); });

// ---------- helpers ----------

const nav = () => screen.getByRole("navigation", { name: "Main" });
const tab = (label: string) => within(nav()).getByRole("button", { name: label });
/** The navigation's own buttons (the side bar also has the brand button, and may carry a credit). */
const tabLabels = () => within(nav()).getAllByRole("button").filter((b) => b.classList.contains("nav-btn")).map((b) => b.getAttribute("aria-label"));
const current = () => within(nav()).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.getAttribute("aria-label"));
/** One screen's content, hidden or not (every screen stays mounted; only the one shown is visible). */
const screenEl = (view: View) => document.querySelector<HTMLElement>(`[data-screen="${view}"]`)!;
const inScreen = (view: View) => within(screenEl(view));
const shown = () => (document.querySelector(".app") as HTMLElement).dataset.view;

type User = ReturnType<typeof userEvent.setup>;
const goBack = () => act(async () => { history.back(); await new Promise((r) => setTimeout(r, 20)); });
const homeBox = () => screen.getByRole("textbox", { name: t.homeTitle });
const search = (user: User, q: string) => user.type(homeBox(), `${q}{Enter}`);
const tiles = () => [...document.querySelectorAll<HTMLElement>("li.res-tile[data-key]")];
/** A result opens as reels from that one; "Customize" on its reel takes it into the editor. */
async function makeFromResult(user: User, label: string) {
  await user.click(await screen.findByRole("button", { name: t.watchAyah(...(label.split(" ") as [string, string])) }));
  expect(getRoute().view).toBe("feed");
  const reel = within(await screen.findByRole("article", { name: label }));
  await user.click(reel.getByRole("button", { name: t.customizeReel(...(label.split(" ") as [string, string])) }));
}
const keys = () => tiles().map((li) => li.dataset.key);
const stat = (label: string) => inScreen("profile").getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
const targets = () => screenEl("share");

/** The editor on the design as it is (Al-Faatiha 1:1 until something is chosen), reached the way the app does. */
async function openEditor() {
  act(() => navigate("create"));
  expect(getRoute().view).toBe("create");
  await screen.findByRole("tablist", { name: "Edit" });
}
/** The editor's tabs (Ayah · Look · Text · Sound) and its always-open panel. */
const edTab = (name: string) => within(screen.getByRole("tablist", { name: "Edit" })).getByRole("tab", { name });
const edPanel = () => within(screen.getByRole("tabpanel"));
async function openShare(user: User) {
  act(() => navigate("create"));
  await user.click(await inScreen("create").findByRole("button", { name: /^Next(:|$)/ }));
  expect(getRoute().view).toBe("share");
  await inScreen("share").findByRole("button", { name: "Copy link" });
}
/** Profile's Preferences sheet (language and translation, recitation, design defaults, interests). */
async function openPreferences(user: User) {
  await user.click(tab("Profile"));
  await user.click(screen.getByRole("button", { name: "Preferences" }));
  expect(getRoute().sheet).toBe("prefs");
  return within(screen.getByRole("dialog", { name: "Preferences" }));
}
async function openSettings(user: User) {
  await user.click(tab("Profile"));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(getRoute().view).toBe("settings");
  return inScreen("settings");
}

// ---------- the shell ----------

describe("shell: navigation", () => {
  it("is Home · Reels · Create · Discover · Profile, with a label on every tab (bottom bar on phones)", async () => {
    await start(390);
    expect(tabLabels()).toEqual(["Home", "Reels", "Create", "Discover", "Profile"]);
    expect(within(nav()).getAllByRole("button").filter((b) => b.classList.contains("nav-btn")).map((b) => b.textContent))
      .toEqual(["Home", "Reels", "Create", "Discover", "Profile"]);
    expect(nav().classList.contains("bottombar")).toBe(true);
    expect(current()).toEqual(["Home"]);
    expect((document.querySelector(".app") as HTMLElement).dataset.layout).toBe("phone");
  });

  it("the bottom bar is on Home, Results, Discover, Reels, Profile, Activity and the picker, and not on the editor, Share and Settings", async () => {
    await start(390);
    const withBar: View[] = ["find", "results", "discover", "feed", "profile", "activity", "pick"];
    const without: View[] = ["create", "share", "settings"];
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeNull(); // Home
    for (const view of [...withBar.slice(1), ...without]) {
      act(() => navigate(view));
      expect(getRoute().view).toBe(view);
      expect(shown()).toBe(view);
      expect(screen.queryByRole("navigation", { name: "Main" }) !== null).toBe(withBar.includes(view));
    }
    // Back to a screen with the bar: it is there again.
    act(() => navigate("profile"));
    expect(nav()).toBeTruthy();
  });

  it("marks the tab the screen belongs to: Results and Activity are Home, the picker, editor and Share are Create, Settings is Profile", async () => {
    await start(1440); // the side bar is on every screen
    const tabOf: [View, string][] = [["results", "Home"], ["activity", "Home"], ["discover", "Discover"], ["pick", "Create"],
      ["create", "Create"], ["share", "Create"], ["feed", "Reels"], ["profile", "Profile"], ["settings", "Profile"]];
    expect(current()).toEqual(["Home"]);
    for (const [view, label] of tabOf) {
      act(() => navigate(view));
      expect(current()).toEqual([label]);
    }
  });

  it("the tabs go to their screens; Home is the first entry, so Back from any tab ends at Home", async () => {
    const user = userEvent.setup();
    await start(390);
    await user.click(tab("Discover"));
    expect(getRoute().view).toBe("discover");
    expect(location.pathname).toBe("/discover");
    await user.click(tab("Profile"));
    expect(getRoute().view).toBe("profile");
    expect(location.pathname).toBe("/profile");
    await user.click(tab("Reels"));
    expect(getRoute().view).toBe("feed");
    expect(location.pathname).toBe("/feed");
    await user.click(tab("Home"));
    await waitFor(() => expect(getRoute().view).toBe("find"));
    expect(location.pathname).toBe("/app");
    expect(inScreen("find").getByRole("heading", { level: 1, name: t.homeTitle })).toBeTruthy();
  });

  it("Create (+) opens the ayah picker, not the editor", async () => {
    const user = userEvent.setup();
    await start(390);
    await user.click(tab("Create"));
    expect(getRoute().view).toBe("pick");
    expect(location.pathname).toBe("/pick");
    expect(screen.getByRole("heading", { level: 1, name: "New creation" })).toBeTruthy();
    expect(getPickStart()).toBeNull(); // the surah list, nothing chosen
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeNull(); // the bar stays, Create selected
    expect(inScreen("pick").getAllByRole("listitem")).toHaveLength(114);
  });

  it("choosing in the picker opens the editor with that range (a surah, up to 3 ayahs, Create)", async () => {
    await start(390);
    act(() => navigate("pick"));
    const picker = inScreen("pick");
    // fireEvent, not userEvent: the surah list and the ayah grid have hundreds of buttons.
    fireEvent.click(picker.getByRole("button", { name: new RegExp(`^94\\s*${name(94)}`) }));
    fireEvent.click(picker.getByRole("button", { name: "Ayah 5" }));
    fireEvent.click(picker.getByRole("button", { name: "Ayah 6" }));
    fireEvent.click(picker.getByRole("button", { name: "Create with 94:5–6" }));
    expect(getRoute().view).toBe("create");
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 6 });
    await waitFor(() => expect(store.getState().ayahs.map((a) => a.num)).toEqual([5, 6]));
    expect(screen.getByRole("slider", { name: "Seek through the whole video" })).toBeTruthy();
  });

  it("the Reels tab is dark: its bottom bar and the page behind the browser's bars are, the others are not", async () => {
    const user = userEvent.setup();
    await start(390);
    const page = () => document.documentElement.dataset.page;
    expect(nav().hasAttribute("data-dark")).toBe(false);
    expect(page()).toBeUndefined();
    await user.click(tab("Reels"));
    expect(getRoute().view).toBe("feed");
    expect(nav().hasAttribute("data-dark")).toBe(true);
    expect(page()).toBe("black");
    await user.click(tab("Discover")); // Browse first: light
    expect(nav().hasAttribute("data-dark")).toBe(false);
    expect(page()).toBeUndefined();
    // Stories from a circle: dark while they play, light again when they close.
    fireEvent.click(within(await screen.findByRole("list", { name: "Topics for today" }, { timeout: 4000 })).getAllByRole("button")[0]);
    await waitFor(() => expect(page()).toBe("black"));
    expect(nav().hasAttribute("data-dark")).toBe(true);
    await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect(page()).toBeUndefined());
    await user.click(tab("Profile"));
    expect(nav().hasAttribute("data-dark")).toBe(false);
    expect(page()).toBeUndefined();
  });

  it("the editor's page colour and the browser's theme colour follow the screen", async () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#ffffff">');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!;
    await start(390, "/create");
    expect(getRoute().view).toBe("create");
    expect(document.documentElement.dataset.page).toBe("editor");
    expect(meta.content).toBe("#0b0f0e");
    act(() => navigate("share")); // Share is dark like the editor
    expect(document.documentElement.dataset.page).toBe("editor");
    expect(meta.content).toBe("#0b0f0e");
    act(() => navigate("profile"));
    expect(document.documentElement.dataset.page).toBeUndefined();
    expect(meta.content).toBe("#ffffff");
    meta.remove();
  });

  it("the browser's theme colour on a light screen is the chosen appearance's, else the page's own", async () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#ffffff">');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!;
    await start(390, "/create");
    expect(meta.content).toBe("#0b0f0e");
    document.documentElement.dataset.theme = "dark";
    act(() => navigate("profile"));
    expect(meta.content).toBe("#0b0f0e"); // dark chosen: the dark colour on every screen
    act(() => setTheme("light"));
    expect(meta.content).toBe("#ffffff");
    act(() => setTheme("system"));
    expect(meta.content).toBe("#ffffff");
    meta.remove();
    delete document.documentElement.dataset.theme;
  });

  it.each([["/saved", "profile", "Profile"], ["/account", "profile", "Profile"], ["/reels", "feed", "Reels"]] as const)(
    "the old address %s opens %s", async (path, view, label) => {
      await start(390, path);
      expect(getRoute().view).toBe(view);
      expect(shown()).toBe(view);
      expect(screenEl(view).hidden).toBe(false);
      expect(screenEl("find").hidden).toBe(true);
      expect(current()).toEqual([label]);
      expect(getRoute().depth).toBe(1); // Home is underneath, so Back goes there
    });

  it("each screen keeps its own place when switching tabs; a screen opened for the first time starts at the top", async () => {
    const user = userEvent.setup();
    await start(390);
    scrollY = 120; // down the page on Home
    await user.click(tab("Discover"));
    expect(scrollY).toBe(0); // first visit: the top
    scrollY = 480;
    await user.click(tab("Profile"));
    expect(scrollY).toBe(0);
    scrollY = 700;
    await user.click(tab("Discover"));
    expect(scrollY).toBe(480); // Discover's own place, not Profile's
    await user.click(tab("Profile"));
    expect(scrollY).toBe(700);
    scrollY = 710;
    await user.click(tab("Home"));
    await waitFor(() => expect(getRoute().view).toBe("find"));
    expect(scrollY).toBe(120);
    await user.click(tab("Profile"));
    expect(scrollY).toBe(710); // saved again on the way out
  });

  it("Results keeps its place and its rows when another tab is visited in between", async () => {
    const user = userEvent.setup();
    await start(390);
    await search(user, "patience");
    await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]));
    scrollY = 900; // down the list
    await user.click(tab("Discover"));
    expect(scrollY).toBe(0);
    act(() => navigate("results")); // the rows are still there, and the same page place
    expect(scrollY).toBe(900);
    expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]);
    expect(getQuery()).toBe("patience");
  });
});

describe("shell: tablets and computers (side bar)", () => {
  it("1440 px: the side bar has the same five tabs in the same order, with the app's name first; no bottom bar", async () => {
    await start(1440);
    expect((document.querySelector(".app") as HTMLElement).dataset.layout).toBe("desktop");
    expect(nav().classList.contains("sidenav")).toBe(true);
    expect(document.querySelector(".bottombar")).toBeNull();
    expect(tabLabels()).toEqual(["Home", "Reels", "Create", "Discover", "Profile"]);
    expect(within(nav()).getByRole("button", { name: "AyahShare" })).toBeTruthy(); // the brand button, ahead of the tabs
    expect(within(nav()).getAllByRole("button")[0].getAttribute("aria-label")).toBe("AyahShare");
    expect(current()).toEqual(["Home"]);
  });

  it("the side bar stays on every screen, the editor and Share included; its brand button goes Home", async () => {
    const user = userEvent.setup();
    await start(1440);
    for (const view of ["results", "pick", "create", "share", "settings", "feed"] as const) {
      act(() => navigate(view));
      expect(nav().classList.contains("sidenav")).toBe(true);
    }
    await user.click(within(nav()).getByRole("button", { name: "AyahShare" }));
    await waitFor(() => expect(getRoute().view).toBe("find"));
  });

  it("tablets (900 px) have the side bar too", async () => {
    await start(900);
    expect((document.querySelector(".app") as HTMLElement).dataset.layout).toBe("tablet");
    expect(nav().classList.contains("sidenav")).toBe(true);
    expect(tabLabels()).toEqual(["Home", "Reels", "Create", "Discover", "Profile"]);
  });

  it("Create (+) in the side bar opens the picker, also from the editor", async () => {
    const user = userEvent.setup();
    await start(1440);
    await user.click(tab("Create"));
    expect(getRoute().view).toBe("pick");
    act(() => navigate("create"));
    await user.click(tab("Create"));
    expect(getRoute().view).toBe("pick");
  });

  it("computers: search on Home, pick a result, and the editor shows the tools as tabs beside the preview", async () => {
    const user = userEvent.setup();
    await start(1440);
    await search(user, "patience");
    await makeFromResult(user, `${name(39)} 39:10`);
    expect(getRoute().view).toBe("create");
    expect(store.getState().recipe).toMatchObject({ surah: 39, from: 10 });
    // The panel is on the right, its tabs at the top of it.
    const tabs = within(screen.getByRole("tabpanel").querySelector<HTMLElement>("[role=tablist]")!).getAllByRole("tab");
    expect(tabs.map((x) => x.textContent)).toEqual(["Ayah", "Look", "AaText", "Sound"]);
    expect(nav()).toBeTruthy(); // the side bar is still there
    await user.click(within(screen.getByRole("group", { name: "Size" })).getByRole("button", { name: "16:9" }));
    expect(store.getState().recipe.orientation).toBe("landscape");
    await user.click(screen.getByRole("button", { name: "Next: share" }));
    expect(getRoute().view).toBe("share");
  });
});

// ---------- search → Results → Create (phone) ----------

describe("phone: search, Results and the editor (390 px)", () => {
  it("search → quick results → refined order → a result opens Create with that ayah and its own background", async () => {
    const user = userEvent.setup();
    await start(390);
    expect(shown()).toBe("find");
    await search(user, "patience");
    expect(getRoute().view).toBe("results");
    expect(location.pathname).toBe("/search");
    // The refined answer reorders the quick one: 3:200 first, and a new row.
    await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]));
    expect(tracked.some((e) => e.name === "search" && e.props?.q === "patience")).toBe(true);
    expect(getQuery()).toBe("patience");

    // Each tile shows the Arabic, the translation and a background of its own.
    await waitFor(() => expect(tiles().map((li) => li.querySelector("[lang=ar]")?.textContent)).toEqual(["عربي 3:200", "عربي 2:153", "عربي 39:10"]));
    expect(tiles()[1].querySelector("[lang=ar]")?.getAttribute("dir")).toBe("rtl");
    expect(within(tiles()[1]).getByText("Seek help through patience and prayer.")).toBeTruthy();
    await waitFor(() => expect(tiles().map((li) => li.querySelector("img")?.getAttribute("src"))).toEqual(
      ["/media/thumbs/pb1.webp", "/media/thumbs/pb2153.webp", "/media/thumbs/pb3910.webp"]));

    await makeFromResult(user, `${name(2)} 2:153`);
    expect(getRoute().view).toBe("create");
    expect(location.pathname).toBe("/create");
    expect(store.getState().recipe).toMatchObject({ surah: 2, from: 153, to: 153, bg: { type: "clip", id: "pb2153" } });
    expect(store.getState().bgManual).toBe(true);
    expect(tracked.find((e) => e.name === "search_click")?.props).toMatchObject({ ref: "2:153", q: "patience" });
    // The editor is full screen: its tabs, no bottom bar.
    expect(screen.getByRole("tablist", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    await waitFor(() => expect(store.getState().suggestions?.map((c) => c.id)).toEqual(["pb1", "pb2153"]));
    expect(store.getState().recipe.bg).toEqual({ type: "clip", id: "pb2153" }); // the suggestions did not replace it
  });

  it("a search the server could not answer is tried again, then offers Try again (never 'Nothing found')", async () => {
    const api = await import("../api");
    for (let i = 0; i < 4; i++) vi.mocked(api.search).mockRejectedValueOnce(new Error("503")); // both requests, twice
    const user = userEvent.setup();
    await start(390);
    await search(user, "patience");
    expect(await screen.findByText("Search didn't answer this time.", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/Nothing found/)).toBeNull();
    expect(api.search).toHaveBeenCalledTimes(4);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]));
  });

  it("a reference like 94:5-6 shows both ayahs as one result, and opens both in the editor", async () => {
    const api = await import("../api");
    vi.mocked(api.search).mockClear();
    const user = userEvent.setup();
    await start(390);
    await search(user, "94:5-6");
    await waitFor(() => expect(keys()).toEqual(["94:5-6"]));
    expect(api.search).not.toHaveBeenCalled(); // references need no search
    await makeFromResult(user, `${name(94)} 94:5–6`);
    expect(getRoute().view).toBe("create");
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 6 });
    await waitFor(() => expect(store.getState().ayahs.map((a) => a.num)).toEqual([5, 6]));
    await userEvent.setup().click(edTab("Ayah"));
    expect(edPanel().getByText("2 ayahs selected · 94:5–6 · up to 3", { exact: false })).toBeTruthy();
    expect(edPanel().getByRole("button", { name: "Selected: 94:5. Show it on the preview" }).getAttribute("aria-current")).toBe("true");
    expect(edPanel().getByRole("button", { name: "Selected: 94:6. Show it on the preview" }).getAttribute("aria-current")).toBeNull();
  });

  it("report dialog sends a search report with the query", async () => {
    const user = userEvent.setup();
    await start(390);
    await search(user, "mercy");
    await user.click(await screen.findByRole("button", { name: "Results not right?" }));
    const dialog = screen.getByRole("dialog", { name: "Something looks wrong?" });
    await user.type(within(dialog).getByLabelText(/What did you notice/), "wrong order");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    const api = await import("../api");
    expect(api.sendReport).toHaveBeenCalledWith({ kind: "search", ref: undefined, note: '"mercy" — wrong order' });
  });

  it("the editor's panel is always open: its tabs swap it in place, its pages open inside it, and back leaves the editor", async () => {
    const user = userEvent.setup();
    await start(390);
    await openEditor();
    expect(edTab("Look").getAttribute("aria-selected")).toBe("true");
    await user.click(edPanel().getByRole("button", { name: "See all" }));
    expect(edPanel().getByRole("heading", { name: "Background" })).toBeTruthy();
    expect(getRoute()).toMatchObject({ view: "create", sheet: null }); // nothing opens over the editor
    await user.click(edPanel().getByRole("button", { name: "Back to Look" }));
    expect(edPanel().queryByRole("heading", { name: "Background" })).toBeNull();
    await user.click(edTab("Text"));
    expect(edTab("Text").getAttribute("aria-selected")).toBe("true");
    expect(edPanel().getByRole("group", { name: "Arabic font" })).toBeTruthy();
    // Browser back: Create → Home.
    await goBack();
    expect(getRoute().view).toBe("find");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
  });

  it("Close editor goes back to where the editor was opened from", async () => {
    const user = userEvent.setup();
    await start(390);
    await search(user, "patience");
    await makeFromResult(user, `${name(2)} 2:153`);
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    await waitFor(() => expect(getRoute().view).toBe("feed")); // back on the reel it was made from
    await goBack();
    await waitFor(() => expect(getRoute().view).toBe("results"));
    expect(keys()).toEqual(["3:200-200", "2:153-153", "39:10-10"]); // the results are still there
  });

  it("editing in the panel updates the recipe (single source of truth) and the controls", async () => {
    const user = userEvent.setup();
    await start(390);
    await openEditor();
    await user.click(edTab("Text"));
    const gold = within(edPanel().getByRole("group", { name: "Text colour" })).getByRole("button", { name: "Colour #e3b25e" });
    await user.click(gold);
    expect(store.getState().recipe.textColor).toBe("#e3b25e");
    expect(gold.getAttribute("aria-pressed")).toBe("true");
    expect(tracked.at(-1)).toMatchObject({ name: "customise", props: { key: "textColor" } });

    await user.click(edTab("Look"));
    await user.click(edPanel().getByRole("button", { name: "More options: box, border, animation" }));
    // Shade (the default) has no box to colour: Solid has.
    await user.click(within(edPanel().getByRole("group", { name: "Box style" })).getByRole("button", { name: /Solid/ }));
    await user.click(edPanel().getAllByRole("button", { name: "Increase" })[0]); // box opacity 40 → 50
    expect(store.getState().recipe.boxOpacity).toBe(50);
    expect(edPanel().getByText("50%")).toBeTruthy();
    await user.click(edPanel().getByRole("button", { name: "Reset the look" }));
    expect(store.getState().recipe).toMatchObject({ textColor: "#ffffff", boxOpacity: 40 });

    // The translation: Change opens the picker in the panel, in two steps. The languages (My language first), then one
    // language's translations.
    await user.click(edTab("Ayah"));
    await user.click(edPanel().getByRole("button", { name: /Change/ }));
    // It opens on the design's translation's language (English); Languages lists them all.
    expect(edPanel().getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["en.sahih"]);
    await user.click(edPanel().getByRole("button", { name: "Languages" }));
    expect(edPanel().getAllByRole("listitem").map((li) => li.textContent)).toEqual(["EnglishMy language1 translation", "മലയാളം Malayalam1 translation"]);
    await user.click(edPanel().getByRole("button", { name: /Malayalam/ })); // one translation: picking the language picks it
    expect(store.getState().recipe.translation).toBe("ml.abdulhameed");
    await waitFor(() => expect(store.getState().ayahs[0]?.tr).toBe("Text 1")); // the design's text follows the translation

    // Ayah: the ayahs of the design; choosing other ones opens the picker on this range.
    await user.click(edPanel().getByRole("button", { name: "Back to Ayah" }));
    expect(edPanel().getByRole("button", { name: "Selected: 1:1. Show it on the preview" })).toBeTruthy();
    await user.click(edPanel().getByRole("button", { name: "Choose other ayahs" }));
    expect(getRoute().view).toBe("pick");
    expect(getPickStart()).toEqual({ surah: 1, from: 1, to: 1 });
  });

  it("Text and Look: show toggles, animation, box style, auto contrast", async () => {
    const user = userEvent.setup();
    await start(390);
    await openEditor();
    await user.click(edTab("Text"));
    for (const label of ["Surah name", "Translation", "Ayah number"]) {
      const sw = edPanel().getByRole("switch", { name: label });
      expect(sw.getAttribute("aria-checked")).toBe("true");
      await user.click(sw);
      expect(sw.getAttribute("aria-checked")).toBe("false");
    }
    expect(store.getState().recipe).toMatchObject({ showSurah: false, showTranslation: false, showRef: false });
    await user.click(edTab("Look"));
    await user.click(edPanel().getByRole("button", { name: "More options: box, border, animation" }));
    expect(edPanel().queryByRole("button", { name: "Typewriter" })).toBeNull();
    for (const [label, value] of [["Rise", "rise"], ["Zoom", "zoom"], ["Fade", "fade"], ["None", "none"], ["Rise", "rise"]]) {
      await user.click(within(edPanel().getByRole("group", { name: "Animation (video)" })).getByRole("button", { name: label }));
      expect(store.getState().recipe.animation).toBe(value);
    }
    expect(tracked.at(-1)).toMatchObject({ name: "customise", props: { key: "animation" } });
    const effects = edPanel().getByRole("group", { name: "Box style" });
    await user.click(within(effects).getByRole("button", { name: /Glass/ }));
    expect(store.getState().recipe.effect).toBe("glass");
    expect(edPanel().getByText("Glass tint")).toBeTruthy();
    await user.click(within(effects).getByRole("button", { name: /None/ }));
    expect(edPanel().queryByText(/tint|Box colour/)).toBeNull(); // nothing to colour
    // Auto contrast: on by default, a switch under the Look's More options; Reset the look turns it back on.
    const auto = edPanel().getByRole("switch", { name: "Auto contrast" });
    expect(auto.getAttribute("aria-checked")).toBe("true");
    await user.click(auto);
    expect(store.getState().recipe.autoContrast).toBe(false);
    expect(tracked.at(-1)).toMatchObject({ name: "customise", props: { key: "autoContrast" } });
    await user.click(edPanel().getByRole("button", { name: "Reset the look" }));
    expect(store.getState().recipe.effect).toBe("shade");
    expect(store.getState().recipe.autoContrast).toBe(true);
  });

  it("the text block moves by dragging (snapping to the top third) and with the arrow keys; Reset position restores it", async () => {
    const user = userEvent.setup();
    await start(390);
    await openEditor();
    const frame = document.querySelector<HTMLElement>(".frame")!;
    frame.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640, toJSON() {} });
    const block = await screen.findByRole("button", { name: /Text block/ });
    // Canvas 1080×1920 shown at 360×640 (×3). The block's centre is at 960; the top third is at 640.
    fireEvent.pointerDown(block, { pointerId: 1, button: 0, clientX: 180, clientY: 320 });
    fireEvent.pointerMove(block, { pointerId: 1, clientX: 181, clientY: 260 });
    fireEvent.pointerMove(block, { pointerId: 1, clientX: 181, clientY: 216 }); // 960 − 312 = 648: within snapping distance
    expect(document.querySelector(".guide.h.on")).toBeTruthy();
    fireEvent.pointerUp(block, { pointerId: 1, clientX: 181, clientY: 216 });
    expect(store.getState().recipe).toMatchObject({ textX: 0.5, textY: 0.333 });
    expect(tracked.at(-1)).toMatchObject({ name: "customise", props: { key: "position" } });
    expect(store.getState().playing).toBe(false); // a drag is not a tap

    fireEvent.keyDown(block, { key: "ArrowRight" });
    expect(store.getState().recipe.textX).toBe(0.51);
    await user.click(screen.getByRole("button", { name: "Reset position" }));
    expect(store.getState().recipe).toMatchObject({ textX: 0.5, textY: 0.54, textWidth: 0 });
    expect(screen.queryByRole("button", { name: "Reset position" })).toBeNull();

    // A tap on the block is a tap on the preview: it shows the player (Play plays; so does Space on the preview).
    fireEvent.pointerDown(block, { pointerId: 2, button: 0, clientX: 100, clientY: 300 });
    fireEvent.pointerUp(block, { pointerId: 2, clientX: 101, clientY: 300 });
    expect(store.getState().playing).toBe(false);
    expect(document.querySelector(".stage-overlay.up")).toBeTruthy();
    fireEvent.keyDown(frame, { key: " " });
    expect(store.getState().playing).toBe(true);
  });

  it("the surah header moves by dragging (snapping to the bottom third) and with the arrow keys; Text resets it on its own", async () => {
    const user = userEvent.setup();
    await start(390);
    await openEditor();
    const frame = document.querySelector<HTMLElement>(".frame")!;
    frame.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640, toJSON() {} });
    const header = await screen.findByRole("button", { name: /Surah name/ });
    // Canvas 1080×1920 shown at 360×640 (×3). The header's centre is at 0.11 × 1920 = 211; the bottom third is at 1280.
    fireEvent.pointerDown(header, { pointerId: 3, button: 0, clientX: 180, clientY: 70 });
    fireEvent.pointerMove(header, { pointerId: 3, clientX: 181, clientY: 300 });
    fireEvent.pointerMove(header, { pointerId: 3, clientX: 181, clientY: 424 }); // 211 + 1062 = 1273: within snapping distance
    expect(document.querySelector(".guide.h.on")).toBeTruthy();
    fireEvent.pointerUp(header, { pointerId: 3, clientX: 181, clientY: 424 });
    expect(store.getState().recipe).toMatchObject({ headerX: 0.5, headerY: 0.667, textX: 0.5, textY: 0.54 });
    expect(tracked.at(-1)).toMatchObject({ name: "customise", props: { key: "headerPosition" } });
    expect(store.getState().playing).toBe(false);

    const moved = await screen.findByRole("button", { name: /Surah name/ });
    fireEvent.keyDown(moved, { key: "ArrowUp" });
    expect(store.getState().recipe.headerY).toBe(0.657);

    // The text block keeps its own place; Text's More options resets each one on its own.
    act(() => store.dispatch({ type: "patch", patch: { textY: 0.25 } }));
    await user.click(edTab("Text"));
    await user.click(edPanel().getByRole("button", { name: "More options: reset" }));
    await user.click(edPanel().getByRole("button", { name: "Reset surah name position" }));
    expect(store.getState().recipe).toMatchObject({ headerX: 0.5, headerY: 0.11, textY: 0.25 });
    expect((edPanel().getByRole("button", { name: "Reset surah name position" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(edPanel().getByRole("button", { name: "Reset text position" }));
    expect(store.getState().recipe.textY).toBe(0.54);
  });

  it("up to 3 ayahs: the Ayah tab shows each on the preview; Share's image is the ayah on screen, its video has all of them", async () => {
    const user = userEvent.setup();
    await start(390);
    await search(user, "94:5-8");
    await waitFor(() => expect(keys()).toEqual(["94:5-7", "94:8-8"])); // a longer range is split in tiles of 3
    await makeFromResult(user, `${name(94)} 94:5–7`);
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 7 });
    await waitFor(() => expect(store.getState().ayahs.map((a) => a.num)).toEqual([5, 6, 7]));
    await user.click(edTab("Ayah"));
    await user.click(edPanel().getByRole("button", { name: "Selected: 94:7. Show it on the preview" }));
    expect(store.getState().current).toBe(2);
    expect(edPanel().getByRole("button", { name: "Selected: 94:7. Show it on the preview" }).getAttribute("aria-current")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(getRoute().view).toBe("share");
    // The image (offered when the video cannot be made here) is the ayah on screen.
    const noVideo = vi.spyOn(engine, "canExportVideo").mockReturnValue(false);
    await user.click(within(targets()).getByRole("button", { name: "Save to phone" }));
    await user.click(await within(targets()).findByRole("button", { name: "Make the image" }));
    await waitFor(() => expect(engine.exportImage).toHaveBeenLastCalledWith(expect.objectContaining({ current: 2 })));
    noVideo.mockRestore();
    await user.click(await screen.findByRole("button", { name: "Edit again" }));
    await waitFor(() => expect(getRoute().view).toBe("create"));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(within(targets()).getByRole("button", { name: "Save to phone" })); // back to the video after editing
    await waitFor(() => expect(engine.exportVideo).toHaveBeenLastCalledWith(
      expect.objectContaining({ ayahs: [expect.objectContaining({ num: 5 }), expect.objectContaining({ num: 6 }), expect.objectContaining({ num: 7 })] }),
      expect.anything(), expect.any(Function), expect.anything()));
  });

  it("an older share link opens the editor with the newer fields' defaults, clamped to the surah", async () => {
    const api = await import("../api");
    vi.mocked(api.getShare).mockResolvedValueOnce({ recipe: {
      v: 1, surah: 94, from: 5, to: 40, reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "portrait",
      bg: { type: "colour", colour: "#10241f" }, font: "Amiri Quran", quranSize: 4, transSize: 3, textColor: "#ffffff",
      boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0,
    } });
    await start(390, "/s/old1");
    expect(store.getState().recipe).toMatchObject({
      surah: 94, from: 5, to: 8, bg: { type: "colour", colour: "#10241f" }, // Ash-Sharh ends at 8
      effect: "solid", showSurah: true, showTranslation: true, showRef: true, animation: "none", textX: 0.5, textY: 0.54, textWidth: 0,
      headerX: 0.5, headerY: 0.11,
    });
    expect(getRoute().view).toBe("create");
    expect(shown()).toBe("create");
    await waitFor(() => expect(store.getState().ayahs.map((a) => a.num)).toEqual([5, 6, 7, 8]));
  });
});

// ---------- Share and export ----------

describe("phone: Share and export", () => {
  it("a video this device cannot make → the image → saved, with nothing exported before an action is tapped", async () => {
    const user = userEvent.setup();
    await start(390);
    await openShare(user);
    expect(engine.exportImage).not.toHaveBeenCalled();
    expect(engine.exportVideo).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.page).toBe("editor"); // dark, like the editor
    await user.click(within(targets()).getByRole("button", { name: "HD quality" }));
    expect(store.getState().hd).toBe(false);
    vi.spyOn(engine, "canExportVideo").mockReturnValue(false);
    await user.click(within(targets()).getByRole("button", { name: "Save to phone" }));
    await user.click(await within(targets()).findByRole("button", { name: "Make the image" }));
    expect(await within(targets()).findByText("Saved to your phone")).toBeTruthy();
    expect(engine.exportImage).toHaveBeenCalledTimes(1);
    expect(engine.exportImage).toHaveBeenCalledWith(expect.objectContaining({ hd: false, brand: expect.any(String) }));
    expect(platform.saveFile).toHaveBeenCalledWith(expect.objectContaining({ name: "ayah-1-1.jpg" }), "ayah-1-1.jpg");
    expect(tracked.map((e) => e.name)).toEqual(expect.arrayContaining(["export_start", "export_done"]));
    // Ready: Share again brings the choices back.
    await user.click(within(targets()).getByRole("button", { name: "Share again" }));
    expect(within(targets()).getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("a video export keeps the design it started with when the design changes meanwhile", async () => {
    const user = userEvent.setup();
    await start(390);
    let finish!: (b: Blob) => void;
    engine.exportVideo.mockImplementationOnce(() => new Promise<Blob>((resolve) => (finish = resolve)));
    await openShare(user);
    await user.click(within(targets()).getByRole("button", { name: "Share" }));
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalled());
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    act(() => store.dispatch({ type: "select", surah: 112, from: 1, to: 2 }));
    await waitFor(() => expect(store.getState().ayahs.map((a) => a.num)).toEqual([1, 2]));
    await act(async () => finish(new Blob(["mp4"], { type: "video/mp4" })));
    await waitFor(() => expect(tracked.some((e) => e.name === "export_done")).toBe(true));
    expect(engine.exportVideo).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipe: expect.objectContaining({ surah: 1, from: 1 }) }), expect.anything(), expect.any(Function), expect.anything());
    expect(tracked.find((e) => e.name === "export_done")?.props).toMatchObject({ ref: "1:1", kind: "video" });
    expect(await screen.findByText("Shared")).toBeTruthy();
    expect(platform.shareFile).toHaveBeenCalledWith(expect.objectContaining({ name: "ayah-1-1.mp4" }));
  });
});

// ---------- signed in ----------

describe("signed in (phone)", () => {
  async function signedIn(width = 390) {
    const api = await import("../api");
    vi.mocked(api.getConfig).mockResolvedValueOnce({ appName: "AyahShare", googleClientId: "client-id", mediaBase: "/media/" });
    localStorage.setItem("qd.signedIn", "1");
    await start(width);
    await waitFor(() => expect(store.getState().me?.name).toBe("Amina"));
    return api;
  }
  afterEach(() => localStorage.removeItem("qd.signedIn"));

  const RECIPE = {
    v: 1, surah: 94, from: 5, to: 6, reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "portrait", bg: { type: "colour", colour: "#152238" },
    font: "Amiri Quran", quranSize: 4, transSize: 3, textColor: "#ffffff", boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0,
  };

  it("Profile: the account's creations as a grid of thumbnails with the kind; opening one loads it into Create", async () => {
    const user = userEvent.setup();
    await signedIn();
    await user.click(tab("Profile"));
    expect(getRoute().view).toBe("profile");
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
    expect(inScreen("profile").getByRole("heading", { level: 2, name: "Amina" })).toBeTruthy(); // beside the picture
    const open = await screen.findByRole("button", { name: /^Options for Ash-Sharh 94:5–6, Video, Today/ });
    expect(screen.getByRole("button", { name: /^Options for Al-Ikhlas 112:1, Image/ })).toBeTruthy();
    expect(open.querySelector("img")?.getAttribute("src")).toBe("/api/creations/c1/thumb?v=1");
    expect(stat("Creations")).toBe("2");
    expect(screen.queryByRole("heading", { name: t.joinTitle })).toBeNull(); // signed in: no invitation

    // The favourite ayahs are the other tab.
    await user.click(screen.getByRole("tab", { name: "Saved ayahs" }));
    expect(await screen.findByRole("button", { name: `Open ${name(94)} 94:5 in Create` })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "My creations" }));

    await user.click(await screen.findByRole("button", { name: /^Options for Ash-Sharh 94:5–6, Video/ }));
    const sheet = screen.getByRole("dialog", { name: "Ash-Sharh 94:5–6" });
    expect(within(sheet).getByRole("button", { name: "Open in Create" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Download again" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Share link" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Delete" })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Open in Create" }));
    await waitFor(() => expect(getRoute().view).toBe("create"));
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 6, orientation: "square", bg: { type: "colour", colour: "#152238" } });
    expect(store.getState().bgManual).toBe(true);
  });

  it("every export and share link saves the design to the account automatically, with a thumbnail", async () => {
    const user = userEvent.setup();
    const api = await signedIn();
    vi.mocked(api.saveCreation).mockClear();
    await openShare(user);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull(); // no Save button: saving is automatic
    await user.click(within(targets()).getByRole("button", { name: "Save to phone" }));
    await waitFor(() => expect(api.saveCreation).toHaveBeenCalledTimes(1));
    expect(api.saveCreation).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "video", title: "Al-Faatiha 1:1", recipe: expect.objectContaining({ surah: 1, from: 1 }), thumb: expect.stringMatching(/^data:image\/jpeg;base64,/),
    }));
    const thumbs = engine.thumbnail.mock.calls as unknown as [{ recipe: { surah: number } }, number][];
    expect(thumbs.some(([scene, ayah]) => scene.recipe.surah === 1 && ayah === 0)).toBe(true);
    expect(await within(targets()).findByText(/^In your profile/)).toBeTruthy();
    await user.click(within(targets()).getByRole("button", { name: "Share again" }));
    await user.click(within(targets()).getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(api.saveCreation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.saveCreation).mock.calls[1][0]).toMatchObject({ kind: "link" });
    expect(tracked.filter((e) => e.name === "creation_save").length).toBe(2);
    expect(await listDevice()).toEqual([]); // nothing kept on the device while signed in
  });

  it("Download again renders the saved design on the device; Delete waits for Undo, then deletes", async () => {
    const user = userEvent.setup();
    const api = await signedIn();
    await user.click(tab("Profile"));
    engine.exportVideo.mockClear();
    await user.click(await screen.findByRole("button", { name: /^Options for Ash-Sharh 94:5–6/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Ash-Sharh 94:5–6" })).getByRole("button", { name: "Download again" }));
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    expect((engine.exportVideo.mock.calls[0] as unknown[])[0]).toMatchObject({ recipe: { surah: 94, from: 5, to: 6, orientation: "square" } });
    // Phones then offer the file in the Export sheet.
    expect(await screen.findByRole("dialog", { name: "Export" })).toBeTruthy();
    await goBack();

    await user.click(screen.getByRole("button", { name: /^Options for Al-Ikhlas 112:1/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Al-Ikhlas 112:1" })).getByRole("button", { name: "Download again" }));
    await waitFor(() => expect(engine.exportImage).toHaveBeenCalledWith(expect.objectContaining({ recipe: expect.objectContaining({ surah: 112, reciter: "Husary_128kbps" }) })));
    await goBack();

    await user.click(screen.getByRole("button", { name: /^Options for Al-Ikhlas 112:1/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Al-Ikhlas 112:1" })).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: /^Options for Al-Ikhlas/ })).toBeNull();
    expect(screen.getByText("Deleted Al-Ikhlas 112:1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: /^Options for Al-Ikhlas/ })).toBeTruthy();
    expect(api.deleteCreation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Options for Al-Ikhlas 112:1/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Al-Ikhlas 112:1" })).getByRole("button", { name: "Delete" }));
    await user.click(tab("Home")); // leaving Profile carries the deletion out
    await waitFor(() => expect(api.deleteCreation).toHaveBeenCalledWith("c2"));
  });

  it("designs kept on this device before signing in move to the account by themselves when Profile opens, with a short note", async () => {
    await saveDevice({ recipe: { ...RECIPE, surah: 2, from: 255, to: 255 } as never, title: "Al-Baqarah 2:255", kind: "image", thumb: null }, 1759000000000);
    const user = userEvent.setup();
    const api = await signedIn();
    vi.mocked(api.saveCreation).mockClear();
    await user.click(tab("Profile"));
    await waitFor(() => expect(api.saveCreation).toHaveBeenCalledWith(expect.objectContaining({ title: "Al-Baqarah 2:255", kind: "image", at: 1759000000000 })));
    expect(await screen.findByText("Moved 1 design to your account")).toBeTruthy();
    expect(inScreen("profile").queryByRole("button", { name: /Move to my account/ })).toBeNull(); // no question to answer
    expect(await listDevice()).toEqual([]);
  });

  it("Settings: header, name, location and WhatsApp (code + number), About & legal, delete account", async () => {
    const api = await import("../api");
    const full = {
      id: "u1", name: "Amina", email: "amina@example.test", avatar: null, displayName: null, memberSince: Date.UTC(2026, 9, 1),
      prefs: {}, interests: [], country: null, city: null, phone: null, phoneOptIn: false, stats: { creations: 12, shares: 3 }, requestCountry: "IN",
    };
    vi.mocked(api.getMe).mockResolvedValue(full); // at sign-in, and again when the profile is shown (fresh numbers)
    onTestFinished(() => void vi.mocked(api.getMe).mockResolvedValue({ id: "u1", name: "Amina", email: "amina@example.test", avatar: null }));
    const user = userEvent.setup();
    await signedIn();
    await user.click(tab("Profile"));
    await waitFor(() => expect(stat("Creations")).toBe("2")); // the account's two designs, once loaded
    expect(stat("Shares")).toBe("5"); // 3 links + 2 exported designs
    const page = await openSettings(user);
    await waitFor(() => expect(vi.mocked(api.getMe).mock.calls.length).toBeGreaterThanOrEqual(2)); // read again when shown
    expect(page.getByText("amina@example.test")).toBeTruthy();
    expect(page.getByText("Member since October 2026")).toBeTruthy();
    expect(page.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Account", "Your details", "The app"]);

    // Name: in the details (the header's Edit name goes to the field); sent only when changed.
    const nameInput = page.getByLabelText("Your name") as HTMLInputElement;
    expect(nameInput.value).toBe("Amina");
    expect(nameInput.getAttribute("autocomplete")).toBe("name");
    await user.click(page.getByRole("button", { name: "Edit name" }));
    expect(document.activeElement).toBe(nameInput);
    await user.clear(nameInput);
    await user.click(page.getByRole("button", { name: "Save" }));
    expect(page.getByRole("alert").textContent).toBe(t.nameNeeded);
    await user.type(nameInput, "Amina K{Enter}");
    expect(api.patchMe).toHaveBeenLastCalledWith({ displayName: "Amina K", country: "IN", city: null, phone: null, phoneOptIn: false });

    // Location prefilled from the connection (a row with the app's own picker); the number's code follows it.
    expect(page.getByRole("button", { name: /^Country.*India$/ })).toBeTruthy();
    expect(page.getByRole("button", { name: /^Code.*\+91$/ })).toBeTruthy();
    expect(page.queryByRole("combobox")).toBeNull(); // no native dropdown
    await user.type(page.getByLabelText("City"), "Kochi");
    const phone = page.getByLabelText(/WhatsApp number/);
    expect(phone.getAttribute("autocomplete")).toBe("tel-national");
    expect(phone.getAttribute("inputmode")).toBe("tel");
    await user.type(phone, "98765");
    const calls = vi.mocked(api.patchMe).mock.calls.length;
    await user.click(page.getByRole("button", { name: "Save" }));
    expect(page.getByRole("alert").textContent).toBe(t.phoneLength);
    expect(vi.mocked(api.patchMe).mock.calls.length).toBe(calls);
    await user.type(phone, " 43210");
    await user.click(page.getByLabelText(/daily ayah on WhatsApp/));
    await user.click(page.getByRole("button", { name: "Save" }));
    expect(api.patchMe).toHaveBeenLastCalledWith({ country: "IN", city: "Kochi", phone: "+919876543210", phoneOptIn: true });
    // Another country, from the picker (a long list: it has a search). The code follows it until one is picked by hand.
    await user.click(page.getByRole("button", { name: /^Country(?! code)/ }));
    const picker = screen.getByRole("dialog", { name: "Country" });
    await user.type(within(picker).getByRole("searchbox", { name: "Search" }), "kenya");
    await user.click(within(picker).getByRole("radio", { name: "Kenya" }));
    await waitFor(() => expect(page.getByRole("button", { name: /^Country.*Kenya$/ })).toBeTruthy());
    expect(page.getByRole("button", { name: /^Code.*\+254$/ })).toBeTruthy();
    await user.click(page.getByRole("button", { name: "Save" }));
    expect(api.patchMe).toHaveBeenLastCalledWith({ country: "KE", city: "Kochi", phone: "+2549876543210", phoneOptIn: true });
    // A code picked by hand stays when the country changes.
    await user.click(page.getByRole("button", { name: /^Code/ }));
    const codes = screen.getByRole("dialog", { name: "Country code" });
    await user.type(within(codes).getByRole("searchbox", { name: "Search" }), "india");
    await user.click(within(codes).getByRole("radio", { name: /^\S+ India\b/ }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    expect(page.getByRole("button", { name: /^Code.*\+91$/ })).toBeTruthy();
    await user.click(page.getByRole("button", { name: /^Country(?! code)/ }));
    await user.type(within(screen.getByRole("dialog", { name: "Country" })).getByRole("searchbox", { name: "Search" }), "oman");
    await user.click(within(screen.getByRole("dialog", { name: "Country" })).getByRole("radio", { name: "Oman" }));
    await waitFor(() => expect(page.getByRole("button", { name: /^Country.*Oman$/ })).toBeTruthy());
    expect(page.getByRole("button", { name: /^Code.*\+91$/ })).toBeTruthy();
    await user.click(page.getByRole("button", { name: "Save" }));
    expect(api.patchMe).toHaveBeenLastCalledWith({ country: "OM", city: "Kochi", phone: "+919876543210", phoneOptIn: true });

    // Credits & legal: one row (the privacy notice and the terms are on the Credits screen).
    expect(page.getByRole("button", { name: "Credits & legal" })).toBeTruthy();

    // Delete account: type to confirm.
    await user.click(page.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    const go = within(dialog).getByRole("button", { name: "Delete my account" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("Type DELETE to confirm"), "delete");
    expect(go.disabled).toBe(false);
    await user.click(go);
    await waitFor(() => expect(api.deleteMe).toHaveBeenCalled());
    await waitFor(() => expect(store.getState().me).toBeNull());
  });

  it("Preferences (a sheet on Profile): reciter, orientation, translation voice and interests, kept with the account; the design follows", async () => {
    const api = await import("../api");
    const user = userEvent.setup();
    await signedIn();
    const prefs = await openPreferences(user);
    // The reciter: a row opening the app's own picker.
    await user.click(prefs.getByRole("button", { name: /^Default reciter/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Default reciter" })).getByRole("radio", { name: "Mahmoud Khalil Al-Husary" }));
    await waitFor(() => expect(api.patchMe).toHaveBeenLastCalledWith({ prefs: { reciter: "Husary_128kbps" } }));
    expect(store.getState().recipe.reciter).toBe("Husary_128kbps");
    expect(JSON.parse(localStorage.getItem("qd.prefs")!)).toEqual({ reciter: "Husary_128kbps" });
    await user.click(within(prefs.getByRole("group", { name: "Default orientation" })).getByRole("button", { name: "Square" }));
    expect(store.getState().recipe.orientation).toBe("square");
    expect(store.getState().prefs).toEqual({ reciter: "Husary_128kbps", orientation: "square" });
    // Translation voice: one switch for new designs and the Feed (the design in Create follows: English has a voice).
    await user.click(prefs.getByRole("switch", { name: "Hear the meaning" }));
    expect(store.getState().recipe).toMatchObject({ voice: "en.walk", translation: "en.sahih" });
    expect(api.patchMe).toHaveBeenLastCalledWith({ prefs: { reciter: "Husary_128kbps", orientation: "square", voice: true, feedVoice: true } });
    await user.click(prefs.getByRole("switch", { name: "Hear the meaning" }));
    expect(store.getState().recipe.voice).toBe("none");
    expect(store.getState().prefs).toEqual({ reciter: "Husary_128kbps", orientation: "square", voice: false, feedVoice: false });

    // Interests (chips from the topics file): a few suggestions, the rest behind "Show all".
    const interests = await prefs.findByRole("group", { name: /Interests/ });
    await user.click(within(interests).getByRole("button", { name: "Hope" }));
    expect(api.patchMe).toHaveBeenLastCalledWith({ interests: ["hope"] });
    expect(store.getState().interests).toEqual(["hope"]);
  });

  it("Settings: Sign out ends the session; Profile then shows the sign-in invitation again", async () => {
    const user = userEvent.setup();
    const api = await signedIn();
    const page = await openSettings(user);
    await user.click(page.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.signOut).toHaveBeenCalled());
    await waitFor(() => expect(store.getState().me).toBeNull());
    expect(await page.findByRole("heading", { name: t.joinTitle })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to profile" }));
    await waitFor(() => expect(getRoute().view).toBe("profile"));
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
    expect(inScreen("profile").getByRole("heading", { name: t.joinTitle })).toBeTruthy();
  });

  it("Sign out: the name and picture are gone from Settings, Profile and Home at once, nothing waits for a refresh", async () => {
    const user = userEvent.setup();
    const api = await signedIn();
    await user.click(tab("Profile"));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    // A name typed in the details form but not saved is the account's too.
    await user.type(inScreen("settings").getByRole("textbox", { name: /Your name/ }), " Jr");
    expect(inScreen("settings").getByRole("textbox", { name: /Your name/ })).toHaveProperty("value", "Amina Jr");
    expect(inScreen("profile").getByRole("heading", { level: 2, name: "Amina", hidden: true })).toBeTruthy();
    expect(inScreen("find").getByRole("button", { name: "Profile", hidden: true }).textContent).toBe("A");
    await user.click(inScreen("settings").getByRole("button", { name: "Sign out" }));
    // No awaiting the network: the signed-out state is there as soon as the click is handled.
    expect(store.getState().me).toBeNull();
    const gone = () => {
      for (const v of ["settings", "profile", "find"] as const) {
        expect([v, screenEl(v).textContent]).not.toEqual([v, expect.stringMatching(/Amina|amina@/)]);
        expect(screenEl(v).querySelector(".avatar, .home-me, .prof-avatar img, .prof-avatar span:not(:empty)")).toBeNull();
      }
    };
    gone();
    expect(inScreen("settings").queryByRole("textbox", { name: /Your name/ })).toBeNull();
    expect(inScreen("profile").getByRole("heading", { name: t.joinTitle, hidden: true })).toBeTruthy();
    await waitFor(() => expect(api.signOut).toHaveBeenCalled());
    gone();
    // Signing in as someone else shows that person, not the earlier details.
    act(() => store.dispatch({ type: "me", me: { id: "u2", name: "Bilal", email: "bilal@example.test", avatar: null } }));
    expect(inScreen("settings").getByRole("textbox", { name: /Your name/ })).toHaveProperty("value", "Bilal");
  });
});

// ---------- signed out ----------

describe("signed out: designs on this device, Settings with the device's preferences", () => {
  it("signed out, an export is kept on the device; Profile shows the sign-up card and Preferences and Settings (the account parts after sign-in)", async () => {
    const api = await import("../api");
    vi.mocked(api.getConfig).mockResolvedValueOnce({ appName: "AyahShare", googleClientId: "client-id", mediaBase: "/media/" });
    const user = userEvent.setup();
    await start(390);
    await user.click(tab("Profile"));
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
    expect(await inScreen("profile").findByRole("heading", { name: t.joinTitle })).toBeTruthy();
    expect(inScreen("profile").queryByText("Your creations appear here")).toBeNull(); // no grid, numbers or streak
    expect(inScreen("profile").queryByText("Day streak", { selector: "dt" })).toBeNull();
    expect(inScreen("profile").getByRole("button", { name: "Preferences" })).toBeTruthy(); // device preferences stay reachable
    expect(inScreen("profile").getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(inScreen("profile").queryByRole("tablist")).toBeNull();

    await openShare(user);
    await user.click(within(targets()).getByRole("button", { name: "Save to phone" }));
    await waitFor(async () => expect((await listDevice()).map((d) => [d.title, d.kind])).toEqual([["Al-Faatiha 1:1", "video"]]));
    expect((await listDevice())[0].thumb).toBeInstanceOf(Blob);
    expect(await within(targets()).findByText(/^Kept on this device ·/)).toBeTruthy();
    expect(within(targets()).queryByText(/^In your profile/)).toBeNull();
    await user.click(within(targets()).getByRole("button", { name: "Make another" }));
    await waitFor(() => expect(getRoute().view).toBe("find"));
    await user.click(tab("Profile"));
    expect(inScreen("profile").getByRole("heading", { name: t.joinTitle })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Options for Al-Faatiha 1:1, Video, Today/ })).toBeNull(); // kept, not shown
    expect(api.saveCreation).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Al-Faatiha 1:1" }));
  });

  it("Log in opens the login page, full screen (no bottom bar); Close returns to Home", async () => {
    const api = await import("../api");
    vi.mocked(api.getConfig).mockResolvedValueOnce({ appName: "AyahShare", googleClientId: "client-id", mediaBase: "/media/" });
    const user = userEvent.setup();
    await start(390);
    await user.click(await screen.findByRole("button", { name: t.logIn }));
    expect(getRoute().view).toBe("login");
    expect(location.pathname).toBe("/login");
    expect(shown()).toBe("login");
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(inScreen("login").getByRole("heading", { level: 1, name: t.joinTitle })).toBeTruthy();
    await user.click(inScreen("login").getByRole("button", { name: t.close }));
    await waitFor(() => expect(getRoute().view).toBe("find"));
    expect(nav()).toBeTruthy();
  });

  it("Settings shows sign-in and links the notices; Preferences keep the choices on the device; Back goes to Profile", async () => {
    const user = userEvent.setup();
    await start(390);
    const page = await openSettings(user);
    expect(page.getByText(t.signInUnavailable)).toBeTruthy(); // no Google client id in this test
    expect(page.queryByLabelText(/WhatsApp number/)).toBeNull(); // account-only fields
    await user.click(page.getByRole("button", { name: "Credits & legal" }));
    expect(getRoute().view).toBe("credits");
    const about = screenEl("credits");
    const privacy = within(about).getByRole("link", { name: /Privacy policy/ });
    expect(privacy.getAttribute("href")).toBe("/privacy");
    expect(privacy.getAttribute("target")).toBe("_blank");
    expect(within(about).getByRole("link", { name: /Terms of service/ }).getAttribute("href")).toBe("/terms");
    expect(within(about).getByRole("link", { name: /Terms of service/ }).getAttribute("target")).toBe("_blank");
    await user.click(within(about).getByRole("button", { name: "Back to settings" }));
    await waitFor(() => expect(getRoute().view).toBe("settings"));
    await user.click(within(page.getByRole("region", { name: "The app" })).getByRole("button", { name: "Report a problem" }));
    expect(store.getState().report).toEqual({ kind: "other" });
    await user.click(within(screen.getByRole("dialog", { name: "Something looks wrong?" })).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Back to profile" }));
    await waitFor(() => expect(getRoute().view).toBe("profile"));
    expect(nav()).toBeTruthy();

    // Preferences: kept on this device.
    const prefs = await openPreferences(user);
    await user.click(within(prefs.getByRole("group", { name: /Text effect/ })).getByRole("button", { name: "Glass" }));
    expect(store.getState().recipe.effect).toBe("glass");
    expect(JSON.parse(localStorage.getItem("qd.prefs")!)).toEqual({ effect: "glass" });
    await user.click(within(await prefs.findByRole("group", { name: /Interests/ })).getByRole("button", { name: "Hope" }));
    expect(JSON.parse(localStorage.getItem("qd.interests")!)).toEqual(["hope"]);
  });

  it("preferences are the defaults of the next visit's design", async () => {
    localStorage.setItem("qd.prefs", JSON.stringify({ reciter: "Husary_128kbps", orientation: "landscape", effect: "outline", animation: "typewriter", translation: "ml.abdulhameed" }));
    await start(390);
    // The typewriter animation was removed (8 Oct 2026): a preference stored before reads as fade.
    expect(store.getState().recipe).toMatchObject({ reciter: "Husary_128kbps", orientation: "landscape", effect: "outline", animation: "fade", translation: "ml.abdulhameed" });
  });
});

// ---------- the owner's feedback cases ----------

describe("owner feedback features (phone)", () => {
  it("topic chips on Home: about 8 per visit, other topics on refresh; a chip searches its English query", async () => {
    const user = userEvent.setup();
    await start(390);
    const group = screen.getByRole("group", { name: "Topics" });
    const chips = () => within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "Show other topics");
    expect(chips()).toHaveLength(8);
    const before = chips().map((c) => c.textContent).join();
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {
      await user.click(within(group).getByRole("button", { name: "Show other topics" }));
      changed = chips().map((c) => c.textContent).join() !== before;
    }
    expect(changed).toBe(true);
    // A chip says its sentence ("I feel …") and searches the topic's English query.
    const says = (tp: (typeof TOPICS)[number]) => chipOf(tp, "en").say;
    const chip = chips().find((c) => TOPICS.some((tp) => says(tp) === c.textContent && !tp.ref))!;
    const topic = TOPICS.find((tp) => says(tp) === chip.textContent)!;
    await user.click(chip);
    expect(getRoute().view).toBe("results");
    expect(getQuery()).toBe(topic.q ?? topic.en);
    expect(screen.getByRole("heading", { name: `For “${topic.q ?? topic.en}”` })).toBeTruthy();
    await waitFor(() => expect(tracked.find((e) => e.name === "search")?.props).toMatchObject({ q: topic.q ?? topic.en }));
  });

  it("chips speak My language; changing it in Preferences also switches the design's translation and is kept on the device", async () => {
    const user = userEvent.setup();
    await start(390);
    let prefs = await openPreferences(user);
    await user.click(prefs.getByRole("button", { name: /^My language/ }));
    const dialog = screen.getByRole("dialog", { name: "My language" });
    await user.click(within(dialog).getByRole("button", { name: /മലയാളം/ }));
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(store.getState()).toMatchObject({ lang: "ml", recipe: { translation: "ml.abdulhameed" } });
    expect(localStorage.getItem("qd.lang")).toBe("ml");
    expect(tracked.some((e) => e.name === "customise" && e.props?.key === "lang")).toBe(true);

    await user.click(within(screen.getByRole("dialog", { name: "Preferences" })).getByRole("button", { name: "Done" }));
    await user.click(tab("Home"));
    await waitFor(() => expect(getRoute().view).toBe("find"));
    const labels = within(screen.getByRole("group", { name: "Topics" })).getAllByRole("button").map((b) => b.textContent ?? "").filter(Boolean);
    expect(labels.every((l) => /[ഀ-ൿ]/.test(l))).toBe(true);

    // And back.
    prefs = await openPreferences(user);
    await user.click(prefs.getByRole("button", { name: /^My language/ }));
    await user.click(within(screen.getByRole("dialog", { name: "My language" })).getByRole("button", { name: /^English/ }));
    expect(store.getState()).toMatchObject({ lang: "en", recipe: { translation: "en.sahih" } });
  });

  it("first open asks for My language (skippable); later visits do not", async () => {
    const user = userEvent.setup();
    firstOpen = true;
    Object.defineProperty(navigator, "languages", { value: ["ur-PK", "en"], configurable: true });
    onTestFinished(() => void Object.defineProperty(navigator, "languages", { value: ["en-US"], configurable: true }));
    await start(390);
    const dialog = await screen.findByRole("dialog", { name: "Choose your language" });
    expect(within(dialog).getByRole("button", { name: /اردو/ }).getAttribute("aria-pressed")).toBe("true"); // the device's language
    expect(store.getState().recipe.translation).toBe("ur.jalandhry");
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(localStorage.getItem("qd.lang")).toBe("ur");
  });
});

// ---------- Reels ----------

describe("Reels", () => {
  // The mix always takes its first choice: popular (94:5) first, then the topics in order.
  beforeEach(() => { vi.spyOn(Math, "random").mockReturnValue(0); });
  async function openFeed(user: User, width = 390) {
    await start(width);
    await user.click(tab("Reels"));
    expect(getRoute().view).toBe("feed");
    expect(location.pathname).toBe("/feed");
    return within(await screen.findByRole("article", { name: /94:5/ }));
  }

  it("opens on its own tab with the mood on top, a sound switch, settings and live reels, under a dark bottom bar", async () => {
    const user = userEvent.setup();
    const reel = await openFeed(user);
    expect(current()).toEqual(["Reels"]);
    expect(nav().hasAttribute("data-dark")).toBe(true);
    expect(screen.getByRole("heading", { level: 1, name: "Reels" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "For you" }).getAttribute("aria-haspopup")).toBe("dialog"); // the moods are in a sheet
    // Popular first here (the test topics have no moment lists for every hour), a live canvas, the actions.
    expect(reel.getByRole("img")).toBeTruthy();
    for (const label of [t.likeReel, t.saveReel, t.shareReel, t.downloadReel, t.reflect, t.customizeReel("Ash-Sharh", "94:5")]) expect(reel.getByRole("button", { name: label })).toBeTruthy();
    expect(reel.queryByText("Make yours")).toBeNull(); // Customize replaced it, beside the surah and reciter
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy(); // sound on by default
    expect(screen.getAllByRole("article").length).toBeGreaterThanOrEqual(6);
    expect(new Set(screen.getAllByRole("article").map((a) => a.dataset.ref)).size).toBe(screen.getAllByRole("article").length); // no repeats
    // My language is in Language and audio (the settings button).
    await user.click(screen.getByRole("button", { name: "Language and audio" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Language and audio" })).getByRole("button", { name: /^My language/ }));
    const dialog = screen.getByRole("dialog", { name: "My language" });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect((dialog as HTMLDialogElement).open).toBe(false);
  });

  it("Like keeps the favourite (on the device signed out); Customize opens Create with the reel's design", async () => {
    const user = userEvent.setup();
    const reel = await openFeed(user);
    await user.click(reel.getByRole("button", { name: t.likeReel }));
    expect(store.getState().favourites).toContain("94:5");
    expect(JSON.parse(localStorage.getItem("qd.favourites")!)).toContain("94:5");
    expect(reel.getByRole("button", { name: t.likeReel }).getAttribute("aria-pressed")).toBe("true");

    await user.click(reel.getByRole("button", { name: t.customizeReel("Ash-Sharh", "94:5") }));
    expect(getRoute().view).toBe("create");
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 5, orientation: "portrait" });
    expect(store.getState().bgManual).toBe(true);
    await waitFor(() => expect(store.getState().ayahs.map((a) => a.num)).toEqual([5]));
  });

  it("Share makes the reel's MP4 with the export engine, then the Export sheet offers share / save / copy link", async () => {
    const user = userEvent.setup();
    const reel = await openFeed(user);
    await waitFor(() => expect((reel.getByRole("button", { name: t.shareReel }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(reel.getByRole("button", { name: t.shareReel }));
    // Share and Download ask first: a video or an image (FormatSheet).
    await user.click(within(await screen.findByRole("dialog", { name: /^(Share|Download) as$/ })).getByRole("button", { name: /^Video/ }));
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    const scene = (engine.exportVideo.mock.calls[0] as unknown[])[0] as { recipe: { surah: number; from: number }; hd: boolean; current: number };
    expect(scene).toMatchObject({ recipe: { surah: 94, from: 5 }, hd: false, current: 0 });
    const sheet = await screen.findByRole("dialog", { name: "Export" });
    // Ready: the reel's picture with ✓ Ready and the HD chip (a share is Standard until the person picks), then one row
    // of round actions; no Done button.
    expect(within(sheet).getByText("Ready")).toBeTruthy();
    expect(sheet.querySelector(".xp-thumb")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "HD" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(sheet).getAllByRole("button").filter((b) => b.closest(".xp-actions")).map((b) => b.textContent)).toEqual(["Share", "Save to phone", "Copy link"]);
    expect(within(sheet).queryByRole("button", { name: "Done" })).toBeNull();
    expect(within(sheet).queryByText("Your file is ready")).toBeNull(); // no status line repeating it
    expect(tracked.find((e) => e.name === "export_done")?.props).toMatchObject({ ref: "94:5", kind: "video" });
    // The HD chip makes the same reel again in HD.
    await user.click(within(sheet).getByRole("button", { name: "HD" }));
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(2));
    expect((engine.exportVideo.mock.calls[1] as unknown[])[0]).toMatchObject({ recipe: { surah: 94, from: 5 }, hd: true });
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "HD" }).getAttribute("aria-pressed")).toBe("true"));
    expect(store.getState().hd).toBe(true); // remembered
    // Closed with ×: the finished file is let go.
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    await waitFor(() => expect(sheet.querySelector(".xp-ready")).toBeNull());
  });

  it("Download makes the reel's MP4 and saves it straight to the device: no Export sheet, and it counts like a share", async () => {
    const user = userEvent.setup();
    const reel = await openFeed(user);
    await waitFor(() => expect((reel.getByRole("button", { name: t.downloadReel }) as HTMLButtonElement).disabled).toBe(false));
    vi.mocked(platform.shareFile).mockClear();
    await user.click(reel.getByRole("button", { name: t.downloadReel }));
    // Share and Download ask first: a video or an image (FormatSheet).
    await user.click(within(await screen.findByRole("dialog", { name: /^(Share|Download) as$/ })).getByRole("button", { name: /^Video/ }));
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    expect((engine.exportVideo.mock.calls[0] as unknown[])[0]).toMatchObject({ recipe: { surah: 94, from: 5 }, hd: true, current: 0 }); // a download: HD
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledWith(expect.objectContaining({ type: "video/mp4", name: expect.stringMatching(/\.mp4$/) }), expect.stringMatching(/\.mp4$/)));
    await waitFor(() => expect(store.getState().toast?.text).toMatch(/^Saved .*\.mp4$/));
    expect(getRoute().sheet).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Export" })).toBeNull();
    expect(platform.shareFile).not.toHaveBeenCalled();
    expect(tracked.find((e) => e.name === "export_done")?.props).toMatchObject({ ref: "94:5", kind: "video" });
    expect(getStreak()).toMatchObject({ days: 1, today: true });
    await waitFor(async () => expect((await listDevice()).map((d) => d.kind)).toEqual(["video"])); // auto-saved like a Share
  });

  it("the arrow keys move between reels; leaving one at once is a skip, a mood re-steers the reels", async () => {
    const user = userEvent.setup();
    await openFeed(user);
    const first = screen.getAllByRole("article")[0].dataset.ref;
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getAllByRole("article")[1].getAttribute("aria-current")).toBe("true"));
    expect(tracked.find((e) => e.name === "feed_skip")?.props).toMatchObject({ ref: first, key: "you" });
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(screen.getAllByRole("article")[0].getAttribute("aria-current")).toBe("true"));

    await user.click(screen.getByRole("button", { name: "For you" }));
    await user.click(within(await screen.findByRole("group", { name: "Moods" })).getByRole("button", { name: "Patience" }));
    // The mood's ayahs not shown yet in this visit come first.
    await waitFor(() => expect(PATIENCE).toContain(screen.getAllByRole("article")[0].dataset.ref));
    expect(screen.getByRole("button", { name: "Patience" })).toBeTruthy(); // the mood is the title
    expect(JSON.parse(localStorage.getItem("qd.signals")!).moods).toEqual({ patience: 1 });
  });

  it("Reflect opens its sheet from a reel and the back button closes it", async () => {
    const user = userEvent.setup();
    const reel = await openFeed(user);
    await user.click(reel.getByRole("button", { name: t.reflect }));
    expect(getRoute()).toMatchObject({ view: "feed", sheet: "reflect" });
    expect(store.getState().reflect).toMatchObject({ ref: "94:5" });
    expect(document.querySelector("dialog[open]")).toBeTruthy();
    await goBack();
    expect(getRoute()).toMatchObject({ view: "feed", sheet: null });
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("Reflect opens from the editor's Ayah tab too", async () => {
    const user = userEvent.setup();
    await start(390);
    await openEditor();
    await user.click(edTab("Ayah"));
    await user.click(edPanel().getByRole("button", { name: "Reflect on 1:1" }));
    expect(getRoute()).toMatchObject({ view: "create", sheet: "reflect" });
    expect(store.getState().reflect).toMatchObject({ ref: "1:1" });
    await goBack();
    expect(getRoute().sheet).toBeNull();
  });

  it("computers: a centred feed from the side bar, moved with the arrow buttons and keys", async () => {
    const user = userEvent.setup();
    await openFeed(user, 1440);
    expect(screenEl("find").hidden).toBe(true);
    expect(nav().classList.contains("sidenav")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next ayah" }));
    await waitFor(() => expect(screen.getAllByRole("article")[1].getAttribute("aria-current")).toBe("true"));
    await user.keyboard("{PageDown}");
    await waitFor(() => expect(screen.getAllByRole("article")[2].getAttribute("aria-current")).toBe("true"));
    await user.click(tab("Create"));
    await waitFor(() => expect(getRoute().view).toBe("pick"));
  });
});

// ---------- Discover ----------

describe("Discover", () => {
  it("its tab opens Browse (no stories, no Play stories); a circle plays its stories; Back and retap go back to Browse", async () => {
    const user = userEvent.setup();
    await start(390);
    await user.click(tab("Discover"));
    expect(getRoute().view).toBe("discover");
    expect(screen.getByRole("heading", { level: 1, name: "Discover" })).toBeTruthy();
    const circles = within(await screen.findByRole("list", { name: "Topics for today" }, { timeout: 4000 }));
    expect(screen.queryByRole("region", { name: "Stories" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play stories" })).toBeNull();
    await user.click(tab("Discover")); // retap: still Browse
    expect(screen.queryByRole("region", { name: "Stories" })).toBeNull();
    await user.click(circles.getAllByRole("button")[0]);
    expect(screen.getByRole("region", { name: "Stories" })).toBeTruthy();
    await screen.findByText(/^Story 1 of \d+$/, {}, { timeout: 4000 }); // the circle's first story is playing
    expect(current()).toEqual(["Discover"]);
    await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Stories" })).toBeNull());
    expect(getRoute()).toMatchObject({ view: "discover", sheet: null });
    expect(screen.getByRole("list", { name: "Topics for today" })).toBeTruthy();
  });
});
