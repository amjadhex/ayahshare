// The translation picker, in two steps: the languages (My language first, how many translations each has, a search, and
// the choices that belong to no language pinned above), then one language's translations with short names, the full name
// under them, a "Voice" badge and the current one marked. It opens on the current choice's language; a language with one
// translation is picked by picking the language; the keyboard works (search, languages, radios, Escape). Then the same
// picker in Preferences, in a sheet over the Preferences sheet. Edition names are the data file's own
// (public/data/translations.json); there is no translation text here.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../../contracts/types";
import data from "../../public/data/translations.json";
import surahList from "../../public/data/surahs.json";
import type { Edition } from "../design";
import { getRoute, initRouter, openSheet } from "../router";
import { createStore, type Store } from "../state";
import { StoreContext, useAppState, useStore } from "./hooks";
import { PreferencesPanel } from "./Profile";
import { TranslationPicker } from "./TranslationPicker";

vi.mock("../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../export", () => ({ canExportVideo: () => true, thumbnail: async () => null }));
vi.mock("../api", () => ({
  mediaUrl: (p: string) => `/media/${p}`,
  loadCatalogue: async () => {},
  ensureClip: async () => {},
  clipById: () => null,
  getTopics: async () => ({ version: "test", topics: [] }),
  getImpact: async () => { throw new Error("offline"); },
  getMe: async () => null,
  getCreations: async () => [],
  getAyahText: async () => [{ ayahs: [] }],
}));

vi.setConfig({ testTimeout: 30_000 });

const IDS = ["en.sahih", "en.pickthall", "ml.abdulhameed", "ur.jalandhry", "ur.maududi", "fr.hamidullah", "ta.qf-133", "prs.qf-785"];
const all = Object.fromEntries((data.editions as Edition[]).map((e) => [e.identifier, e]));
// Our own Malayalam edition (api.ts OWN_EDITIONS): the one a recorded voice reads.
all["ml.lalithasaram"] = { identifier: "ml.lalithasaram", language: "ml", englishName: "ഖുര്‍ആന്‍ ലളിതസാരം (Karakunnu & Elayavoor)", name: "ഖുര്‍ആന്‍ ലളിതസാരം" };
const EDITIONS = Object.fromEntries([...IDS, "ml.lalithasaram"].map((id) => [id, all[id]]));
let store: Store;

function setup(lang: string, translation: string) {
  localStorage.setItem("qd.lang", lang);
  history.replaceState(null, "", "/");
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, mediaBase: "/media/" }, surahs: surahList as Surah[], recipe: null });
  store.dispatch({ type: "lang", lang });
  store.dispatch({ type: "editions", editions: EDITIONS });
  store.dispatch({ type: "patch", patch: { translation } });
}

/** The picker on the design's translation, as the editor uses it. */
function Host({ onPicked }: { onPicked?: () => void }) {
  const s = useStore();
  const { recipe } = useAppState();
  return <TranslationPicker label="Translation" value={recipe.translation} onPicked={onPicked}
    onChange={(v) => s.dispatch({ type: "patch", patch: { translation: v } })} />;
}
function mount(lang: string, translation: string, onPicked?: () => void) {
  setup(lang, translation);
  render(<StoreContext.Provider value={store}><Host onPicked={onPicked} /></StoreContext.Provider>);
}
const radios = () => screen.getAllByRole("radio").map((r) => r.getAttribute("value"));
const searchBox = () => screen.getByRole("searchbox", { name: "Search languages or translators" });
const languageRows = () => screen.getAllByRole("listitem").map((li) => li.textContent);
const languageButton = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => localStorage.clear());

describe("the translation picker", () => {
  it("step 2 opens on the current choice's language: short names, the full name under them, Default and Voice badges, a way back", () => {
    mount("en", "ml.abdulhameed");
    expect(screen.getByRole("heading", { name: "മലയാളം Malayalam" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Languages" })).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull(); // the search is in step 1
    expect(radios()).toEqual(["ml.abdulhameed", "ml.lalithasaram"]); // the language's default first
    const def = screen.getByRole("radio", { name: "Abdul Hameed & Parappoor" });
    expect((def as HTMLInputElement).checked).toBe(true);
    expect(def.getAttribute("aria-describedby")).toBeTruthy();
    // The full name is secondary text, with the Default mark.
    expect(screen.getByRole("radio", { name: "Abdul Hameed & Parappoor", description: /Cheriyamundam Abdul Hameed and Kunhi Mohammed Parappoor.*Default/ })).toBeTruthy();
    // Our own Malayalam translation is read by a recorded voice.
    expect(screen.getByRole("radio", { name: "Karakunnu & Elayavoor", description: /Voice/ })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Translation: Malayalam" })).toBeTruthy();
    expect(screen.getByText("മലയാളം").getAttribute("lang")).toBe("ml");
  });

  it("a hidden duplicate in an old design opens on its twin", () => {
    mount("en", "ml.karakunnu");
    expect((screen.getByRole("radio", { name: "Karakunnu & Elayavoor" }) as HTMLInputElement).checked).toBe(true);
  });

  it("step 1: My language first, then the others by name, each with its count; the current language is marked; None is pinned", async () => {
    const user = userEvent.setup();
    mount("ur", "ml.abdulhameed");
    await user.click(screen.getByRole("button", { name: "Languages" }));
    expect(languageRows()).toEqual([
      "اردو UrduMy language2 translations", "دری Dari1 translation", "English2 translations", "Français French1 translation", "മലയാളം Malayalam2 translations", "தமிழ் Tamil1 translation",
    ]);
    expect(screen.getByText("دری").getAttribute("dir")).toBe("rtl"); // Dari is written right to left
    expect(languageButton(/^മലയാളം Malayalam/).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("radio", { name: "No translation", description: "Arabic only" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "No translation" }));
    expect(store.getState().recipe.translation).toBe("none");
  });

  it("opening a language shows its translations; its Back returns to the languages on that language's row", async () => {
    const user = userEvent.setup();
    mount("ml", "none");
    // "none" belongs to no language: the languages come first, with it marked.
    expect((screen.getByRole("radio", { name: "No translation" }) as HTMLInputElement).checked).toBe(true);
    await user.click(languageButton(/^English/));
    expect(screen.getByRole("heading", { name: "English" })).toBeTruthy();
    expect(radios()).toEqual(["en.sahih", "en.pickthall"]);
    await user.click(screen.getByRole("radio", { name: "Pickthall" }));
    expect(store.getState().recipe.translation).toBe("en.pickthall");
    await user.click(screen.getByRole("button", { name: "Languages" }));
    expect(languageButton(/^English/).getAttribute("aria-current")).toBe("true");
  });

  it("a language with a single translation is picked by picking the language", async () => {
    const user = userEvent.setup();
    const picked = vi.fn();
    mount("ml", "none", picked);
    await user.click(languageButton(/^Français/));
    expect(store.getState().recipe.translation).toBe("fr.hamidullah");
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it("the search finds languages (any script, case and accents ignored) and translators; Escape clears it first", async () => {
    const user = userEvent.setup();
    mount("ml", "none");
    await user.type(searchBox(), "PICKTHALL");
    expect(languageRows()).toEqual(["EnglishPickthall2 translations"]); // the translator that matched, under its language
    expect(screen.getByRole("status").textContent).toBe("1 language found");
    await user.clear(searchBox());
    await user.type(searchBox(), "اردو");
    expect(languageRows()).toEqual(["اردو Urdu2 translations"]);
    await user.clear(searchBox());
    await user.type(searchBox(), "مودودی"); // a translator's name in its own script
    expect(languageRows().length).toBe(1);
    expect(languageRows()[0]).toMatch(/^اردو Urdu/);
    await user.clear(searchBox());
    await user.type(searchBox(), "francais");
    expect(languageRows()).toEqual(["Français French1 translation"]);
    await user.clear(searchBox());
    await user.type(searchBox(), "tamil baqavi"); // a language and a translator
    expect(languageRows().length).toBe(1);
    await user.clear(searchBox());
    await user.type(searchBox(), "zzzz");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getAllByText(/Nothing found for “zzzz”/).length).toBeGreaterThan(0);
    // Escape clears the search first (and does not reach the sheet).
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    await user.keyboard("{Escape}");
    document.removeEventListener("keydown", outside);
    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect(outside).not.toHaveBeenCalled();
    expect(languageRows()).toHaveLength(6);
  });

  it("keyboard: Down from the search goes into the languages, Up / Down / Home / End move, Escape in step 2 goes back", async () => {
    const user = userEvent.setup();
    mount("ml", "none");
    searchBox().focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(languageButton(/^മലയാളം Malayalam/)); // My language first
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(languageButton(/^دری Dari/));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.textContent).toContain("Urdu"); // the last by English name: Dari, English, French, Tamil, Urdu
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(languageButton(/^മലയാളം Malayalam/));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(searchBox());
    await user.click(languageButton(/^اردو/));
    expect(radios()).toEqual(["ur.jalandhry", "ur.maududi"]);
    // Escape in a language's translations goes back to the languages (a key was used, so focus follows).
    screen.getAllByRole("radio")[0].focus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("searchbox", { name: "Search languages or translators" })).toBeTruthy();
    expect(document.activeElement).toBe(languageButton(/^اردو/));
  });

  it("arrow keys move the choice without onPicked, a tap calls it, the current one again is still a pick", async () => {
    const user = userEvent.setup();
    const picked = vi.fn();
    mount("en", "en.sahih", picked);
    // A browser moves a radio group with the arrow keys by checking the next radio (a click without a pointer).
    fireEvent.keyDown(screen.getByRole("radio", { name: "Saheeh International" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("radio", { name: "Pickthall" }));
    expect(store.getState().recipe.translation).toBe("en.pickthall");
    expect(picked).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "Saheeh International" }));
    expect(store.getState().recipe.translation).toBe("en.sahih");
    expect(picked).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("radio", { name: "Saheeh International" }));
    expect(picked).toHaveBeenCalledTimes(2);
  });

  it("while the list loads, the current choice and None", () => {
    setup("en", "ta.qf-133");
    act(() => store.dispatch({ type: "editions", editions: {} }));
    render(<StoreContext.Provider value={store}><Host /></StoreContext.Provider>);
    expect(screen.getByText("Loading translations…")).toBeTruthy();
    expect(radios()).toEqual(["ta.qf-133", "none"]);
  });
});

describe("Preferences: the default translation", () => {
  it("a row opens the picker in a sheet over Preferences; a pick saves the preference and closes only that sheet", async () => {
    const user = userEvent.setup();
    setup("ml", "ml.abdulhameed");
    history.replaceState(null, "", "/profile");
    initRouter();
    render(<StoreContext.Provider value={store}><PreferencesPanel active /></StoreContext.Provider>);
    act(() => openSheet("prefs"));
    const row = screen.getByRole("button", { name: /^Default translation.*My language default · Abdul Hameed & Parappoor$/ });
    expect(row.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("combobox")).toBeNull(); // no native dropdowns
    await user.click(row);
    expect(getRoute().sheet).toBe("translation");
    const sheet = screen.getByRole("dialog", { name: "Default translation" });
    // Step 1: "My language default" (the current choice) and None are pinned above the languages.
    expect(within(sheet).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["", "none"]);
    expect((within(sheet).getByRole("radio", { name: "My language default · Abdul Hameed & Parappoor" }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(sheet).getByRole("button", { name: /^മലയാളം Malayalam/ }));
    await user.click(within(sheet).getByRole("radio", { name: "Karakunnu & Elayavoor" }));
    expect(store.getState().prefs.translation).toBe("ml.lalithasaram");
    expect(store.getState().recipe.translation).toBe("ml.lalithasaram"); // the design in progress follows the default
    await waitFor(() => expect(getRoute().sheet).toBe("prefs")); // Preferences stays open under it
    expect(sheet.hasAttribute("open")).toBe(false);
    expect(row.textContent).toBe("Default translationKarakunnu & Elayavoor");
  });
});
