// The My language dialog: every language with a translation, a search over their own and English names (any script,
// case and accents ignored), the first-open "Not now", and a choice that also sets the design's translation. On first
// open a language with several translations is followed by a second question, which one to read by default.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../../contracts/types";
import surahList from "../../public/data/surahs.json";
import translations from "../../public/data/translations.json";
import type { Edition } from "../design";
import { LANGUAGES } from "../lang";
import { initRouter } from "../router";
import { createStore, type Store } from "../state";
import { StoreContext } from "./hooks";
import { LanguageDialog } from "./Language";

vi.mock("../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../api", () => ({ saveLang: vi.fn(async () => ({})) }));

let store: Store;
const all = Object.fromEntries((translations.editions as Edition[]).map((e) => [e.identifier, e]));
all["ml.lalithasaram"] = { identifier: "ml.lalithasaram", language: "ml", englishName: "ഖുര്‍ആന്‍ ലളിതസാരം (Karakunnu & Elayavoor)", name: "ഖുര്‍ആന്‍ ലളിതസാരം" };
const EDITIONS = Object.fromEntries(["en.sahih", "en.pickthall", "ml.abdulhameed", "ml.lalithasaram", "fr.hamidullah"].map((id) => [id, all[id]]));
function open(how: "first" | "change", editions: Record<string, Edition> = EDITIONS) {
  history.replaceState(null, "", "/");
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, mediaBase: "/media/" }, surahs: surahList as Surah[], recipe: null });
  store.dispatch({ type: "editions", editions });
  render(<StoreContext.Provider value={store}><LanguageDialog /></StoreContext.Provider>);
  act(() => store.dispatch({ type: "langPicker", open: how }));
  return screen.getByRole("dialog");
}
const names = (dialog: HTMLElement) => within(within(dialog).getByRole("group", { name: "My language" })).getAllByRole("button").map((b) => b.getAttribute("lang"));

vi.setConfig({ testTimeout: 30_000 });
beforeEach(() => localStorage.clear());

describe("My language", () => {
  it("a search box above the languages finds them by their own or English name, in any script", async () => {
    const user = userEvent.setup();
    const dialog = open("change");
    expect(names(dialog)).toHaveLength(LANGUAGES.length);
    const search = within(dialog).getByRole("searchbox", { name: "Search languages" });
    await user.type(search, "മലയാ");
    expect(names(dialog)).toEqual(["ml"]);
    await user.clear(search);
    await user.type(search, "FRANCAIS");
    expect(names(dialog)).toEqual(["fr"]);
    await user.clear(search);
    await user.type(search, "اردو");
    expect(names(dialog)).toEqual(["ur"]);
    await user.clear(search);
    await user.type(search, "tel");
    expect(names(dialog)).toEqual(["te"]); // Telugu, one of the languages added with the Quran Foundation's translations
    await user.clear(search);
    await user.type(search, "zzz");
    expect(within(dialog).queryByRole("group", { name: "My language" })?.querySelectorAll("button")).toHaveLength(0);
    expect(within(dialog).getByRole("status").textContent).toBe("No language found for “zzz”.");
    // Escape clears the search first; the dialog stays open.
    await user.keyboard("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
    expect(store.getState().langPicker).toBe("change");
    expect(names(dialog)).toHaveLength(LANGUAGES.length);
  });

  it("right-to-left names are marked; a choice sets My language and the design's translation", async () => {
    const user = userEvent.setup();
    const dialog = open("change");
    expect(within(dialog).getByText("اردو").getAttribute("dir")).toBe("rtl");
    await user.type(within(dialog).getByRole("searchbox", { name: "Search languages" }), "telugu");
    await user.click(within(dialog).getByRole("button", { name: /Telugu/ }));
    expect(store.getState()).toMatchObject({ lang: "te", langPicker: null, recipe: { translation: "te.qf-227" } });
  });

  it("first open: the question, with Not now", async () => {
    const user = userEvent.setup();
    const dialog = open("first");
    expect(within(dialog).getByRole("heading", { name: "Choose your language" })).toBeTruthy();
    expect(within(dialog).getByRole("searchbox", { name: "Search languages" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(store.getState().langPicker).toBeNull();
    expect(localStorage.getItem("qd.lang")).toBe("en");
  });

  describe("first open: which translation", () => {
    const pickLanguage = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: RegExp) => {
      await user.click(within(dialog).getByRole("button", { name }));
    };

    it("after a language with several translations: its translations, the recommended one first and marked, a Voice badge, Decide later", async () => {
      const user = userEvent.setup();
      const dialog = open("first");
      await pickLanguage(user, dialog, /Malayalam/);
      // Still asking: nothing is stored yet.
      expect(store.getState()).toMatchObject({ lang: "en", langPicker: "first" });
      expect(within(dialog).getByRole("heading", { name: "Which translation?" })).toBeTruthy();
      const radios = within(dialog).getAllByRole("radio");
      expect(radios.map((r) => r.getAttribute("value"))).toEqual(["ml.abdulhameed", "ml.lalithasaram"]);
      expect(within(dialog).getByRole("radio", { name: "Abdul Hameed & Parappoor", description: /Recommended/ })).toBeTruthy();
      expect(within(dialog).getByRole("radio", { name: "Karakunnu & Elayavoor", description: /Voice/ })).toBeTruthy();
      expect(within(dialog).queryByRole("radio", { name: "Abdul Hameed & Parappoor", description: /Voice/ })).toBeNull();
      expect(within(dialog).getByRole("button", { name: "Decide later" })).toBeTruthy();
      // Back to the languages.
      await user.click(within(dialog).getByRole("button", { name: "Languages" }));
      expect(within(dialog).getByRole("heading", { name: "Choose your language" })).toBeTruthy();
    });

    it("a translation is stored as the default-translation preference, with the language", async () => {
      const user = userEvent.setup();
      const dialog = open("first");
      await pickLanguage(user, dialog, /Malayalam/);
      await user.click(within(dialog).getByRole("radio", { name: "Karakunnu & Elayavoor" }));
      expect(store.getState()).toMatchObject({ lang: "ml", langPicker: null, prefs: { translation: "ml.lalithasaram" }, recipe: { translation: "ml.lalithasaram" } });
      expect(localStorage.getItem("qd.lang")).toBe("ml");
      expect(JSON.parse(localStorage.getItem("qd.prefs")!)).toEqual({ translation: "ml.lalithasaram" });
    });

    it("Decide later keeps the language's own default", async () => {
      const user = userEvent.setup();
      const dialog = open("first");
      await pickLanguage(user, dialog, /Malayalam/);
      await user.click(within(dialog).getByRole("button", { name: "Decide later" }));
      expect(store.getState()).toMatchObject({ lang: "ml", langPicker: null, recipe: { translation: "ml.abdulhameed" } });
      expect(store.getState().prefs.translation).toBeUndefined();
      expect(localStorage.getItem("qd.prefs")).toBeNull();
    });

    it("closing the question counts as deciding later: the language stays", async () => {
      const user = userEvent.setup();
      const dialog = open("first");
      await pickLanguage(user, dialog, /Malayalam/);
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(store.getState()).toMatchObject({ lang: "ml", langPicker: null });
      expect(store.getState().prefs.translation).toBeUndefined();
    });

    it("arrow keys only move through the translations; a tap or Space picks", async () => {
      const user = userEvent.setup();
      const dialog = open("first");
      await pickLanguage(user, dialog, /Malayalam/);
      // A browser checks the next radio with the arrow key (a click without a pointer): that is not an answer.
      fireEvent.keyDown(within(dialog).getByRole("radio", { name: /Abdul Hameed/ }), { key: "ArrowDown" });
      fireEvent.click(within(dialog).getByRole("radio", { name: "Karakunnu & Elayavoor" }));
      expect(store.getState().langPicker).toBe("first");
      await user.click(within(dialog).getByRole("radio", { name: "Karakunnu & Elayavoor" }));
      expect(store.getState().prefs.translation).toBe("ml.lalithasaram");
    });

    it("a language with one translation skips the question", async () => {
      const user = userEvent.setup();
      const dialog = open("first");
      await pickLanguage(user, dialog, /Français/);
      expect(store.getState()).toMatchObject({ lang: "fr", langPicker: null });
      expect(store.getState().prefs.translation).toBeUndefined();
    });

    it("a list that has not loaded yet skips it too", async () => {
      const user = userEvent.setup();
      const dialog = open("first", {});
      await pickLanguage(user, dialog, /Malayalam/);
      expect(store.getState()).toMatchObject({ lang: "ml", langPicker: null });
    });

    it("changing My language later (Find, Preferences) does not ask", async () => {
      const user = userEvent.setup();
      const dialog = open("change");
      await pickLanguage(user, dialog, /Malayalam/);
      expect(store.getState()).toMatchObject({ lang: "ml", langPicker: null });
    });
  });
});
