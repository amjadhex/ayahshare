// Profile, Activity and Settings: the header (picture, name and numbers; Preferences and Settings), real numbers only
// (saved designs, the device's streak as a small pill with its details in a sheet), empty states when there are none,
// designs on this device moving to the account by themselves, the creation actions (open, download again, delete with
// undo), saved ayahs, Preferences (groups of rows with the app's own pickers, compact interests) and Settings (Account,
// The app, About & legal). The network and the export engine are stand-ins; ayah text here is filler.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImpactResponse, Me, Recipe, Surah } from "../../../../../contracts/types";
import surahList from "../../../public/data/surahs.json";
import * as api from "../../api";
import { clearDevice, listDevice, saveDevice } from "../../history";
import { platform } from "../../platform";
import { back, getRoute, initRouter, navigate } from "../../router";
import { createStore, type Store } from "../../state";
import { getStreak, resetStreak } from "../../streak";
import { saveSurahProgress } from "../../surah";
import { t } from "../../strings";
import { ExportProvider } from "../exportJob";
import { StoreContext } from "../hooks";
import { Activity } from "./Activity";
import { Credits } from "./Credits";
import { ProfileScreen } from "./ProfileScreen";
import { Settings } from "./Settings";

const world = vi.hoisted(() => ({ news: [] as { id: number; title: string; body: string; link: string | null; at: number }[],
  impact: null as ImpactResponse | null,
  creations: [] as unknown[],
  topicsFail: false,
}));

vi.mock("../../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../../topics", async (original) => ({ ...(await original<typeof import("../../topics")>()), momentsAt: () => new Set(), momentChip: () => null }));
const engine = vi.hoisted(() => ({
  canExportVideo: () => true,
  exportImage: vi.fn(async () => new Blob(["jpg"], { type: "image/jpeg" })),
  exportVideo: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
  previewImage: vi.fn(async () => undefined),
  thumbnail: vi.fn(async () => null),
}));
vi.mock("../../export", () => engine);

vi.mock("../../api", () => {
  const clip = (id: string) => ({
    id, duration: 8, caption: id, tags: ["sky", "calm"], thumb: `thumbs/${id}.webp`,
    video: { portrait: `clips/p/${id}.mp4`, landscape: `clips/l/${id}.mp4` }, poster: { portrait: `posters/p/${id}.jpg`, landscape: `posters/l/${id}.jpg` },
  });
  return {
    mediaUrl: (p: string) => `/media/${p}`,
    loadCatalogue: async () => {},
    ensureClip: async () => {},
    clipById: (id: string) => (id.startsWith("pb") ? clip(id) : null),
    getSurahBackgrounds: async (surah: number) => ({ surah, sensitive: [], ayahs: new Proxy({}, { get: (_, ayah) => [`pb${surah}x${String(ayah)}`] }) }),
    getTopics: async () => {
      if (world.topicsFail) throw new Error("offline");
      return (await import("../../../public/data/topics.json")).default;
    },
    getAyahText: async (_s: number, from: number, to: number, translation: string) => {
      const ayahs = Array.from({ length: to - from + 1 }, (_, i) => ({ numberInSurah: from + i, text: "نص" }));
      return translation === "none" ? [{ ayahs }] : [{ ayahs }, { ayahs: ayahs.map((a) => ({ ...a, text: "Filler" })) }];
    },
    getImpact: vi.fn(async () => { if (!world.impact) throw new Error("offline"); return world.impact; }),
    getAnnouncements: vi.fn(async () => world.news),
    getMe: vi.fn(async () => null),
    getCreations: vi.fn(async () => world.creations),
    deleteCreation: vi.fn(async () => undefined),
    saveCreation: vi.fn(async () => ({})),
    setFavourite: vi.fn(async () => undefined),
    patchMe: vi.fn(async (patch: Record<string, unknown>) => ({ id: "u1", name: "", email: "amina@example.test", avatar: null, ...patch })),
  };
});

const surahs = surahList as Surah[];
const RECIPE: Recipe = {
  v: 1, surah: 94, from: 5, to: 6, reciter: "Alafasy_128kbps", translation: "en.sahih", orientation: "portrait",
  bg: { type: "colour", colour: "#152238" }, font: "Amiri Quran", quranSize: 4, transSize: 3, textColor: "#ffffff",
  boxColor: "#000000", boxOpacity: 40, borderColor: "#e3b25e", borderWidth: 0,
};
const ME: Me = { id: "u1", name: "Amina", email: "amina@example.test", avatar: null, stats: { creations: 9, shares: 3 } };
let store: Store;

const wrap = (node: ReactNode) => <StoreContext.Provider value={store}><ExportProvider phone>{node}</ExportProvider></StoreContext.Provider>;
function mount(node: ReactNode, path = "/profile", me: Me | null = null) {
  history.replaceState(null, "", path);
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, mediaBase: "/media/" }, surahs, recipe: null });
  if (me) store.dispatch({ type: "me", me });
  return render(wrap(node));
}
const stat = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
/** The streak pill in the top bar, and its details (a sheet) once it is tapped. */
const pill = () => screen.getByRole("button", { name: /^Your streak: / });
const streakCard = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(pill());
  return screen.getByRole("dialog", { name: "Your streak" }).querySelector("section.prof-streak") as HTMLElement;
};

beforeEach(async () => {
  world.impact = null;
  world.news = [];
  world.creations = [];
  world.topicsFail = false;
  localStorage.clear();
  resetStreak([]);
  await clearDevice();
});

describe("Profile", () => {
  it("signed out with nothing yet: zeros, a small streak pill that opens a streak to start, the empty grid, and the Settings button opens Settings", async () => {
    const user = userEvent.setup();
    mount(<ProfileScreen active />);
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Your profile" })).toBeTruthy();
    expect(await screen.findByText("Your creations appear here")).toBeTruthy();
    expect(stat("Creations")).toBe("0");
    expect(stat("Shares")).toBe("0");
    expect(stat("Day streak")).toBe("0");
    // The streak is a small pill in the top bar, not a card on the page.
    expect(pill().textContent).toBe("0");
    expect(screen.getByRole("banner").contains(pill())).toBe(true);
    expect(screen.queryByRole("heading", { name: "Start a streak" })).toBeNull();
    expect(screen.queryByText("Your ayahs this week")).toBeNull(); // the impact card is gone
    const card = await streakCard(user);
    expect(within(card).getByRole("heading", { name: "Start a streak" })).toBeTruthy();
    expect(within(card).queryByRole("img", { name: /^The last 16 weeks/ })).toBeNull(); // no calendar before the first day
    expect(within(card).getByRole("button", { name: "Share today’s ayah" })).toBeTruthy();
    expect(within(card).getByText("Only you see your streak.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(getRoute().view).toBe("settings");
  });

  it("signed out where sign-in is offered: the sign-up card, then Preferences and Settings, and nothing of the account", async () => {
    const user = userEvent.setup();
    history.replaceState(null, "", "/profile");
    initRouter();
    store = createStore();
    store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, emailSignIn: true, mediaBase: "/media/" }, surahs, recipe: null });
    render(wrap(<ProfileScreen active />));
    expect(screen.getByRole("heading", { name: t.joinTitle })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Creations", { selector: "dt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Your streak: / })).toBeNull();
    await user.click(screen.getByRole("button", { name: t.preferences }));
    expect(getRoute().sheet).toBe("prefs");
    expect(within(await screen.findByRole("dialog", { name: t.preferences })).getByText(t.prefsDevice)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t.done }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    await user.click(screen.getByRole("button", { name: t.settingsTitle }));
    expect(getRoute().view).toBe("settings");
  });

  it("the header, Instagram-like: the picture, then the name with the three numbers under it, then Preferences and Settings; the name is shown once", async () => {
    const long = "Amina Abdulrahman Al-Hashimi bint Muhammad ibn Abdullah";
    mount(<ProfileScreen active />, "/profile", { ...ME, displayName: long });
    const head = screen.getByRole("region", { name: long });
    const parts = [...head.children].map((el) => el.className);
    expect(parts).toEqual(["prof-ring", "prof-who", "prof-actions"]); // the picture first, then who, then the buttons
    const who = head.querySelector(".prof-who")!;
    expect(who.firstElementChild?.tagName).toBe("H2"); // the name on top …
    expect(who.querySelector("dl.prof-stats")).toBeTruthy(); // … with the numbers under it
    await waitFor(() => expect(stat("Creations")).toBe("0"));
    expect([...who.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Creations", "Shares", "Day streak"]);
    expect(within(head).getAllByRole("button").map((b) => b.textContent)).toEqual(["Preferences", "Settings"]);
    expect(within(head).getByRole("button", { name: "Preferences" }).getAttribute("aria-haspopup")).toBe("dialog");
    // The top bar says where this is; the name is not repeated there, and there is no second Settings button.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Profile");
    expect(screen.getAllByText(long)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Settings" })).toHaveLength(1);
  });

  it("signed in without a name: a small card asks for one (at most once a day); saving it shows the name", async () => {
    const user = userEvent.setup();
    const nameless: Me = { ...ME, name: "", displayName: null };
    const first = mount(<ProfileScreen active />, "/profile", nameless);
    const card = screen.getByRole("region", { name: t.nameAskTitle });
    await user.click(within(card).getByRole("button", { name: t.joinNotNow }));
    expect(screen.queryByRole("region", { name: t.nameAskTitle })).toBeNull();
    first.unmount();
    mount(<ProfileScreen active />, "/profile", nameless); // the same day: not again
    expect(screen.queryByRole("region", { name: t.nameAskTitle })).toBeNull();

    localStorage.removeItem("ayahshare.name.v1"); // a day later
    const later = mount(<ProfileScreen active />, "/profile", nameless);
    const again = screen.getAllByRole("region", { name: t.nameAskTitle }).at(-1)!;
    await user.type(within(again).getByLabelText(t.displayName), "Amina K");
    await user.click(within(again).getByRole("button", { name: t.nameContinue }));
    expect(api.patchMe).toHaveBeenCalledWith({ displayName: "Amina K" });
    await waitFor(() => expect(within(later.container).queryByRole("region", { name: t.nameAskTitle })).toBeNull());
    expect(within(later.container).getByRole("heading", { level: 2, name: "Amina K" })).toBeTruthy();
  });

  it("Preferences: a sheet of grouped rows (language and translation, recitation, design defaults, interests) with the app's own pickers", async () => {
    const user = userEvent.setup();
    mount(<ProfileScreen active />);
    expect(screen.queryByRole("dialog", { name: "Preferences" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Preferences" }));
    const sheet = screen.getByRole("dialog", { name: "Preferences" });
    expect(within(sheet).getByText(t.prefsDevice)).toBeTruthy(); // signed out here: kept on this device
    expect(within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Language and translation", "Recitation", "Design defaults", "Interests0 of 10"]);
    expect(sheet.querySelector("select")).toBeNull(); // no native dropdowns
    // The reciter: a row with its value, a sheet of radios (a search, the list is long), a pick closes only that sheet.
    const reciter = within(sheet).getByRole("button", { name: /^Default reciter.*Mishary Rashid Alafasy$/ });
    await user.click(reciter);
    expect(getRoute().sheet).toBe("picker");
    const picker = screen.getByRole("dialog", { name: "Default reciter" });
    expect(within(picker).getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect((within(picker).getByRole("radio", { name: "Mishary Rashid Alafasy" }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(picker).getByRole("radio", { name: "Mahmoud Khalil Al-Husary" }));
    expect(store.getState().prefs).toMatchObject({ reciter: "Husary_128kbps" });
    await waitFor(() => expect(getRoute().sheet).toBe("prefs")); // Preferences stays open under it
    expect(reciter.textContent).toBe("Default reciterMahmoud Khalil Al-Husary");
    await user.click(within(within(sheet).getByRole("group", { name: "Default orientation" })).getByRole("button", { name: "Square" }));
    expect(store.getState().prefs).toMatchObject({ orientation: "square" });
    expect(within(sheet).getByRole("switch", { name: "Hear the meaning" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /^My language.*English$/ })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Preferences" })).toBeNull();
  });

  it("Interests are compact: the chosen ones and a few suggestions; Show all opens every topic, searchable, in a sheet", async () => {
    const user = userEvent.setup();
    mount(<ProfileScreen active />);
    await user.click(screen.getByRole("button", { name: "Preferences" }));
    const sheet = screen.getByRole("dialog", { name: "Preferences" });
    const chips = await within(sheet).findByRole("group", { name: /Interests/ });
    const few = within(chips).getAllByRole("button");
    expect(few.length).toBeGreaterThan(0);
    expect(few.length).toBeLessThanOrEqual(6); // a few suggestions, not the whole list
    const label = few[0].textContent!;
    await user.click(within(chips).getByRole("button", { name: label }));
    expect(JSON.parse(localStorage.getItem("qd.interests")!)).toHaveLength(1);
    expect(within(chips).getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("true");
    // The whole list, with a search, over Preferences.
    const showAll = within(sheet).getByRole("button", { name: /^Show all \d+ topics$/ });
    await user.click(showAll);
    expect(getRoute().sheet).toBe("interests");
    const all = screen.getByRole("dialog", { name: "Interests" });
    const everything = within(within(all).getByRole("group", { name: "Interests" })).getAllByRole("button");
    expect(everything.length).toBeGreaterThan(few.length);
    expect(everything[0].textContent).toBe(label); // the chosen ones first
    await user.type(within(all).getByRole("searchbox", { name: "Find a topic" }), "zzzzqq");
    expect(within(all).getByText("No topics match.")).toBeTruthy();
    await user.clear(within(all).getByRole("searchbox", { name: "Find a topic" }));
    await user.click(within(within(all).getByRole("group", { name: "Interests" })).getAllByRole("button", { pressed: false })[0]);
    expect(JSON.parse(localStorage.getItem("qd.interests")!)).toHaveLength(2);
    await user.click(within(all).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(getRoute().sheet).toBe("prefs"));
  });

  describe("the streak details", () => {
    const keyOf = (n: number) => { const x = new Date(); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    const run = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => keyOf(from - i)); // days ago, from >= to

    it("an active streak, done today: the pill says 12; its sheet has the big number, the next milestone (the ring), current, best and this week, the 16-week dots", async () => {
      const user = userEvent.setup();
      resetStreak([...run(60, 41), ...run(11, 0)]); // a 20-day streak long ago, and 12 days now
      mount(<ProfileScreen active />);
      expect(pill().textContent).toBe("12");
      expect(pill().getAttribute("aria-label")).toBe("Your streak: 12 days");
      const card = await streakCard(user);
      expect(within(card).getByRole("heading", { name: "12 day streak" })).toBeTruthy();
      expect(within(card).getByText("Done for today. Come back tomorrow to make it 13.")).toBeTruthy();
      expect(within(card).getByText("12 of 30 days")).toBeTruthy();
      expect(card.querySelector(".prof-flame circle.fill")?.getAttribute("stroke-dasharray")).toBe("40 100"); // 12 of 30
      const heat = within(card).getByRole("img", { name: "The last 16 weeks: 32 days done." });
      expect(heat.children).toHaveLength(112);
      expect(heat.lastElementChild?.getAttribute("data-today")).toBe("true");
      // Current, best and this week as three facts, and all active days under the dots.
      expect([...card.querySelectorAll(".streak-facts > div")].map((d) => [d.querySelector("dt")!.textContent, d.querySelector("dd")!.textContent]))
        .toEqual([["Current", "12 days"], ["Best", "20 days"], ["This week", "7 of 7 days"]]);
      expect([...card.querySelectorAll(".prof-facts span")].map((s) => s.textContent)).toEqual(["32 active days"]);
      expect(within(card).queryByText(/one missed day a week is forgiven/)).toBeNull(); // the legend only with a rest day in view
      expect(within(card).getByText("Only you see your streak.")).toBeTruthy();
      expect(within(card).queryByRole("button", { name: "Share today’s ayah" })).toBeNull();
    });

    it("today not done yet: still the streak, with today's ayah offered", async () => {
      const user = userEvent.setup();
      resetStreak(run(12, 1));
      mount(<ProfileScreen active />);
      const card = await streakCard(user);
      expect(within(card).getByRole("heading", { name: "12 day streak" })).toBeTruthy();
      expect(within(card).getByText("Share or make one ayah today to keep it going.")).toBeTruthy();
      expect(within(card).getByRole("button", { name: "Share today’s ayah" })).toBeTruthy();
    });

    it("one missed day is forgiven and shown with a short legend", async () => {
      const user = userEvent.setup();
      resetStreak([keyOf(5), keyOf(4), keyOf(2), keyOf(1), keyOf(0)]); // 3 days ago was missed
      mount(<ProfileScreen active />);
      const card = await streakCard(user);
      expect(within(card).getByRole("heading", { name: "5 day streak" })).toBeTruthy();
      const heat = within(card).getByRole("img", { name: "The last 16 weeks: 5 days done, 1 rest day forgiven." });
      expect(heat.querySelectorAll('[data-s="rest"]')).toHaveLength(1);
      expect(within(card).getByText("Rest day: one missed day a week is forgiven.")).toBeTruthy();
    });

    it("yesterday missed keeps it alive and says so kindly", async () => {
      const user = userEvent.setup();
      resetStreak([keyOf(4), keyOf(3), keyOf(2)]); // yesterday missed
      mount(<ProfileScreen active />);
      const card = await streakCard(user);
      expect(within(card).getByRole("heading", { name: "3 day streak" })).toBeTruthy();
      expect(within(card).getByText("Yesterday was a rest day, and that’s fine. Share one ayah today to keep it going.")).toBeTruthy();
      expect(within(card).getByRole("button", { name: "Share today’s ayah" })).toBeTruthy();
    });

    it("an ended streak: a gentle restart with the best, not a bare zero or a progress line", async () => {
      const user = userEvent.setup();
      resetStreak(run(20, 18));
      mount(<ProfileScreen active />);
      const card = await streakCard(user);
      expect(within(card).getByRole("heading", { name: "Start again today" })).toBeTruthy();
      expect(within(card).getByText("Your best is 3 days. A new streak starts with one ayah.")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Start a streak" })).toBeNull();
      expect(card.querySelector(".prof-streak-goal")).toBeNull(); // no progress line
      expect(card.querySelector(".prof-flame circle.fill")).toBeNull(); // an empty ring
      expect([...card.querySelectorAll(".streak-facts dd")].map((d) => d.textContent)).toEqual(["0 days", "3 days", "0 of 7 days"]);
      expect(within(card).getByText("3 active days")).toBeTruthy();
      expect(stat("Day streak")).toBe("0");
      expect(within(card).getByRole("button", { name: "Share today’s ayah" })).toBeTruthy();
    });
  });

  it("\"Your ayahs this week\" is gone: no impact card or hadith, whatever the week did", async () => {
    world.impact = { days: 7, opens: 1234, reshares: 5, makes: 2 };
    mount(<ProfileScreen active />);
    expect(await screen.findByText("Your creations appear here")).toBeTruthy();
    expect(screen.queryByText("Your ayahs this week")).toBeNull();
    expect(screen.queryByText(/Convey from me/)).toBeNull();
    expect(api.getImpact).not.toHaveBeenCalled();
  });

  it("designs on this device: counted, in the grid, the streak learns their days; a tile's actions open, download again and delete with undo", async () => {
    const now = Date.now();
    await saveDevice({ recipe: RECIPE, title: "Ash-Sharh 94:5–6", kind: "video", thumb: null }, now);
    await saveDevice({ recipe: { ...RECIPE, surah: 112, from: 1, to: 1 }, title: "Al-Ikhlas 112:1", kind: "image", thumb: null }, now - 86400_000);
    const user = userEvent.setup();
    mount(<ProfileScreen active />);
    const tile = await screen.findByRole("button", { name: /^Options for Ash-Sharh 94:5–6, Video, Today/ });
    expect(screen.getByRole("button", { name: /^Options for Al-Ikhlas 112:1, Image, Yesterday/ })).toBeTruthy();
    expect(stat("Creations")).toBe("2");
    expect(stat("Shares")).toBe("2");
    await waitFor(() => expect(getStreak()).toMatchObject({ days: 2, today: true }));
    expect(stat("Day streak")).toBe("2");
    expect(pill().textContent).toBe("2");
    expect(screen.queryByRole("button", { name: "Share today’s ayah" })).toBeNull(); // (only in the streak's sheet, and not when done for today)

    // Download again: the export engine renders the saved design on the device.
    await user.click(tile);
    let sheet = screen.getByRole("dialog", { name: "Ash-Sharh 94:5–6" });
    expect(within(sheet).getByText("Video · Today")).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Download again" }));
    await waitFor(() => expect(engine.exportVideo).toHaveBeenCalledTimes(1));
    expect((engine.exportVideo.mock.calls[0] as unknown[])[0]).toMatchObject({ recipe: { surah: 94, from: 5, to: 6 } });

    // Delete waits for Undo.
    await user.click(screen.getByRole("button", { name: /^Options for Al-Ikhlas/ }));
    sheet = screen.getByRole("dialog", { name: "Al-Ikhlas 112:1" });
    await user.click(within(sheet).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: /^Options for Al-Ikhlas/ })).toBeNull();
    expect(screen.getByText("Deleted Al-Ikhlas 112:1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: /^Options for Al-Ikhlas/ })).toBeTruthy();

    // Open in Create loads the design.
    await user.click(screen.getByRole("button", { name: /^Options for Ash-Sharh/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Ash-Sharh 94:5–6" })).getByRole("button", { name: "Open in Create" }));
    await waitFor(() => expect(getRoute().view).toBe("create"));
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 6, bg: { type: "colour", colour: "#152238" } });
  });

  it("signed in: the account's designs; Shares = the account's links + its exported designs", async () => {
    world.creations = [
      { id: "c1", title: "Ash-Sharh 94:5–6", kind: "video", created_at: 1, updated_at: Date.now(), thumb: "/api/creations/c1/thumb", recipe: RECIPE },
      { id: "c2", title: "Al-Ikhlas 112:1", kind: "link", created_at: 1, updated_at: Date.now(), thumb: null, recipe: { ...RECIPE, surah: 112, from: 1, to: 1 } },
    ];
    mount(<ProfileScreen active />, "/profile", ME);
    expect(screen.getByRole("heading", { level: 2, name: "Amina" })).toBeTruthy();
    const tile = await screen.findByRole("button", { name: /^Options for Ash-Sharh 94:5–6, Video/ });
    expect(tile.querySelector("img")?.getAttribute("src")).toBe("/api/creations/c1/thumb");
    expect(stat("Creations")).toBe("2");
    expect(stat("Shares")).toBe("4"); // 3 links + 1 exported design
  });

  describe("designs kept on this device before signing in", () => {
    const keep = async () => {
      await saveDevice({ recipe: { ...RECIPE, surah: 2, from: 255, to: 255 }, title: "Al-Baqarah 2:255", kind: "image", thumb: null }, 1759000000000);
      await saveDevice({ recipe: RECIPE, title: "Ash-Sharh 94:5–6", kind: "video", thumb: null }, 1759100000000);
    };

    it("move to the account by themselves, oldest first and keeping their times, with a short note and no question", async () => {
      await keep();
      vi.mocked(api.saveCreation).mockClear();
      mount(<ProfileScreen active />, "/profile", ME);
      await waitFor(() => expect(store.getState().toast?.text).toBe("Moved 2 designs to your account"));
      expect(vi.mocked(api.saveCreation).mock.calls.map(([c]) => [c.title, c.at])).toEqual([["Al-Baqarah 2:255", 1759000000000], ["Ash-Sharh 94:5–6", 1759100000000]]);
      expect(await listDevice()).toEqual([]);
      expect(screen.queryByRole("button", { name: /Move to my account/ })).toBeNull(); // nothing to answer
      expect(screen.queryByText(/saved on this device/)).toBeNull();
    });

    it("when it fails they stay on the device, without a note, and the move is tried again the next time Profile opens", async () => {
      await keep();
      vi.mocked(api.saveCreation).mockClear();
      vi.mocked(api.saveCreation).mockRejectedValueOnce(new Error("offline"));
      const view = mount(<ProfileScreen active />, "/profile", ME);
      await waitFor(() => expect(api.saveCreation).toHaveBeenCalledTimes(1));
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect((await listDevice()).map((d) => d.title).sort()).toEqual(["Al-Baqarah 2:255", "Ash-Sharh 94:5–6"]);
      expect(store.getState().toast).toBeNull();
      expect(api.saveCreation).toHaveBeenCalledTimes(1); // not again while the screen stays open

      view.rerender(wrap(<ProfileScreen active={false} />)); // away …
      view.rerender(wrap(<ProfileScreen active />)); // … and back
      await waitFor(() => expect(store.getState().toast?.text).toBe("Moved 2 designs to your account"));
      expect(api.saveCreation).toHaveBeenCalledTimes(3);
      expect(await listDevice()).toEqual([]);
    });

    it("signed out, they stay on this device (nothing moves)", async () => {
      await keep();
      vi.mocked(api.saveCreation).mockClear();
      mount(<ProfileScreen active />);
      expect(await screen.findByRole("button", { name: /^Options for Al-Baqarah 2:255/ })).toBeTruthy();
      expect(api.saveCreation).not.toHaveBeenCalled();
      expect(await listDevice()).toHaveLength(2);
    });
  });

  it("saved ayahs: each with its background, Arabic and reference; opening one starts a design, the bookmark removes it", async () => {
    const user = userEvent.setup();
    mount(<ProfileScreen active />);
    store.dispatch({ type: "favourites", refs: ["94:5"] });
    await user.click(screen.getByRole("tab", { name: "Saved ayahs" }));
    const open = await screen.findByRole("button", { name: "Open Ash-Sharh 94:5 in Create" });
    expect(within(open).getByText("Ash-Sharh · 94:5")).toBeTruthy();
    await waitFor(() => expect(within(open).getByText("نص")).toBeTruthy());
    await waitFor(() => expect(open.querySelector("img")?.getAttribute("src")).toBe("/media/thumbs/pb94x5.webp"));
    await user.click(screen.getByRole("button", { name: "Remove 94:5 from saved ayahs" }));
    expect(store.getState().favourites).toEqual([]);
    expect(await screen.findByText(/No saved ayahs yet/)).toBeTruthy();

    store.dispatch({ type: "favourites", refs: ["94:5"] });
    await user.click(await screen.findByRole("button", { name: "Open Ash-Sharh 94:5 in Create" }));
    expect(getRoute().view).toBe("create");
    expect(store.getState().recipe).toMatchObject({ surah: 94, from: 5, to: 5 });
  });
});

describe("Activity", () => {
  it("lists only real things: today's ayah (opens in Reels), the streak and the week's impact, with the footnote", async () => {
    resetStreak([]);
    const d = new Date(), key = (n: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    resetStreak([key(2), key(1)]); // 2 days, not yet today
    world.impact = { days: 7, opens: 3, reshares: 1, makes: 2 };
    const user = userEvent.setup();
    mount(<Activity active />, "/activity");
    const week = await screen.findByRole("region", { name: "This week" });
    expect(within(week).getByRole("button", { name: "3 opens of the links you shared." })).toBeTruthy();
    expect(within(week).getByRole("button", { name: "Shared on once by people who opened your links." })).toBeTruthy();
    expect(within(week).getByRole("button", { name: "2 designs made from yours by people who opened your links." })).toBeTruthy();
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByRole("button", { name: "2-day streak. Share one ayah today to keep it." })).toBeTruthy();
    const aotd = await within(today).findByRole("button", { name: /^Today's ayah: .+ is ready to watch\.$/ });
    expect(screen.getByText("Activity is counted without names. Nobody can see who you are.")).toBeTruthy();
    await user.click(aotd);
    await waitFor(() => expect(getRoute().view).toBe("feed"));
  });

  it("news from AyahShare first; the links used most this week by ayah, with their picture; an opens milestone passed", async () => {
    world.news = [{ id: 7, title: "21 more reciters", body: "Pick one in Language and audio.", link: "/discover", at: Date.now() }];
    world.impact = {
      days: 7, opens: 12, reshares: 1, makes: 0, total: { opens: 104, reshares: 3, makes: 1 },
      links: [{ code: "abc", ref: "94:5", to: 6, clip: "pb94x5", opens: 12, reshares: 1, makes: 0 }],
    };
    const user = userEvent.setup();
    mount(<Activity active />, "/activity");
    const news = await screen.findByRole("region", { name: "From AyahShare" });
    const item = within(news).getByRole("button", { name: "21 more reciters Pick one in Language and audio." });
    const week = await screen.findByRole("region", { name: "This week" });
    const link = within(week).getByRole("button", { name: "Ash-Sharh 94:5–6 · your link was opened 12 times this week." });
    expect(link.querySelector("img")?.getAttribute("src")).toBe("/media/thumbs/pb94x5.webp");
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getAllByRole("button")[0].textContent).toBe("100 opens! Your links have been opened that many times in all.");
    // Opening the page sees the newest announcement: the bell's dot goes (activitySeen.ts).
    await waitFor(() => expect(JSON.parse(localStorage.getItem("qd.activitySeen")!).news).toBe(7));
    await user.click(item);
    expect(getRoute().view).toBe("discover");
  });

  it("a surah played part of the way: Continue it from where it stopped", async () => {
    world.impact = { days: 7, opens: 0, reshares: 0, makes: 0 };
    saveSurahProgress({ surah: 18, ayah: 23, reciter: "Alafasy_128kbps" });
    mount(<Activity active />, "/activity");
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).getByRole("button", { name: "Continue Al-Kahf from ayah 23 of 110." })).toBeTruthy();
    saveSurahProgress(null);
  });

  it("an empty state when there is nothing real to show", async () => {
    world.impact = { days: 7, opens: 0, reshares: 0, makes: 0 };
    world.topicsFail = true;
    mount(<Activity active />, "/activity");
    expect(await screen.findByRole("heading", { name: "Nothing here yet" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "This week" })).toBeNull();
  });
});

describe("Settings", () => {
  it("two groups, Account and The app, then one Credits & legal row that opens Credits; back returns to Profile", async () => {
    const user = userEvent.setup();
    mount(<Settings active />, "/profile");
    act(() => navigate("settings"));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Account", "The app"]);
    expect(screen.getByText(t.signInUnavailable)).toBeTruthy(); // no Google client id here
    // The credits are one row now, and nobody is credited for the voice.
    expect(screen.queryByText(/Noushad|Lalithasaram|Thafheem/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Privacy policy/ })).toBeNull();
    // What new designs start with is in Preferences, not here.
    expect(screen.queryByText("Default reciter")).toBeNull();
    expect(screen.queryByText("Interests")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Hear the meaning" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Credits & legal" }));
    expect(getRoute().view).toBe("credits");
    expect(location.pathname).toBe("/credits");
    act(() => back());
    await user.click(screen.getByRole("button", { name: "Back to profile" }));
    await waitFor(() => expect(getRoute().view).toBe("profile"));
  });

  it("The app: help and support (new tab) and Report a problem", async () => {
    const user = userEvent.setup();
    mount(<Settings active />, "/profile");
    act(() => navigate("settings"));
    const app = screen.getByRole("region", { name: "The app" });
    expect(within(app).getByRole("link", { name: /Help and support/ }).getAttribute("href")).toBe("/support");
    await user.click(within(app).getByRole("button", { name: "Report a problem" }));
    expect(store.getState().report).toEqual({ kind: "other" });
  });

  it("The app: Appearance is System, Light or Dark; a choice shows on the page at once and is kept on the device", async () => {
    const user = userEvent.setup();
    mount(<Settings active />, "/profile");
    act(() => navigate("settings"));
    const app = screen.getByRole("region", { name: "The app" });
    const group = within(app).getByRole("group", { name: "Appearance" });
    const pressed = () => within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(pressed()).toEqual(["System"]);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await user.click(within(group).getByRole("button", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(pressed()).toEqual(["Dark"]);
    expect(JSON.parse(localStorage.getItem("qd.theme")!)).toBe("dark");
    await user.click(within(group).getByRole("button", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(within(group).getByRole("button", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(pressed()).toEqual(["System"]);
  });
});

describe("Credits", () => {
  it("groups the sources (Quran & translations, Tafsir & reflections, Recitations, Backgrounds, Fonts), then Legal and Made by; no voice credit", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(platform, "openExternal").mockImplementation(() => {});
    mount(<Credits active />, "/credits");
    expect(screen.getByRole("heading", { level: 1, name: "Credits" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent))
      .toEqual(["Quran & translations", "Tafsir & reflections", "Recitations", "Backgrounds", "Fonts", "Legal", "Made by"]);
    const group = (name: string) => screen.getByRole("region", { name }) as HTMLElement;
    const lalithasaram = within(group("Quran & translations")).getByRole("link", { name: /Quran Lalithasaram/ });
    expect(lalithasaram.getAttribute("href")).toBe("https://lalithasaram.net");
    expect(lalithasaram.getAttribute("target")).toBe("_blank");
    expect(within(group("Quran & translations")).getByRole("link", { name: /Al Quran Cloud/ }).getAttribute("href")).toBe("https://alquran.cloud");
    expect(within(group("Quran & translations")).getByRole("link", { name: /Quran Foundation/ })).toBeTruthy();
    expect(within(group("Tafsir & reflections")).getByRole("link", { name: /Thafheemul Quran/ }).getAttribute("href")).toBe("https://thafheem.net");
    expect(within(group("Tafsir & reflections")).getByRole("link", { name: /QuranReflect/ }).getAttribute("href")).toBe("https://quranreflect.com");
    expect(within(group("Tafsir & reflections")).getByRole("link", { name: /Quran Foundation/ })).toBeTruthy();
    expect(within(group("Recitations")).getByRole("link", { name: /EveryAyah/ }).getAttribute("href")).toBe("https://everyayah.com");
    expect(group("Recitations").textContent).toContain("Mishary Rashid Alafasy");
    expect(within(group("Backgrounds")).getByRole("link", { name: /Pixabay/ })).toBeTruthy();
    expect(group("Fonts").textContent).toContain("Amiri Quran");
    // Nobody is credited for the translation voice.
    expect(document.body.textContent).not.toMatch(/Noushad|voice:/i);
    // The source links open outside the app, like Made by.
    await user.click(lalithasaram);
    expect(open).toHaveBeenCalledWith("https://lalithasaram.net");
    // Legal: the same links as before and Report a problem.
    const legal = group("Legal");
    expect(within(legal).getByRole("link", { name: /Privacy policy/ }).getAttribute("href")).toBe("/privacy");
    expect(within(legal).getByRole("link", { name: /Terms of service/ }).getAttribute("href")).toBe("/terms");
    expect(within(legal).getByRole("link", { name: /Help and support/ }).getAttribute("href")).toBe("/support");
    await user.click(within(legal).getByRole("button", { name: "Report a problem" }));
    expect(store.getState().report).toEqual({ kind: "other" });
    expect(screen.getByText(/Made by/, { selector: "p" }).textContent).toContain("Amjad Ali");
    open.mockRestore();
  });

  it("Back returns to Settings", async () => {
    const user = userEvent.setup();
    mount(<Credits active />, "/credits");
    await user.click(screen.getByRole("button", { name: "Back to settings" }));
    await waitFor(() => expect(getRoute().view).toBe("settings"));
  });
});
