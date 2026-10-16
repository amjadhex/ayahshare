// The editor (Create, Editor v2): the top bar (Close, Undo, Redo, the Format card, Next), the player over the preview
// (one seek bar over the whole video), the always-open panel with its four tabs (Ayah · Look · Text · Sound) and their
// pages, Looks, adding and removing ayahs, undo / redo, the first-run tips, and the side panel on computers. The network,
// analytics and drawing are stand-ins; the store, router and controls are the real ones.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECITERS } from "../../config";
import type { Clip, Surah } from "../../../../../contracts/types";
import surahList from "../../../public/data/surahs.json";
import { LOOKS } from "../../looks";
import { getPickStart } from "../../nav";
import { getRoute, initRouter } from "../../router";
import { createStore, type Store } from "../../state";
import { ExportProvider } from "../exportJob";
import { StoreContext } from "../hooks";
import { Create } from "./Create";

vi.mock("../../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../../draw", () => ({
  fontsReady: () => Promise.resolve(),
  // A text block and a header in their default places, so the preview has its drag areas.
  drawLayers: (W: number, H: number) => ({
    plan: { width: W, height: H, box: { x: W * 0.07, y: H * 0.4, w: W * 0.86, h: H * 0.2, radius: 28 }, boxAt: { x: W * 0.07, y: H * 0.4 },
      area: { top: H * 0.03, bottom: H * 0.93 }, blur: 0, parts: [], brandAt: { x: W * 0.4, y: H * 0.94 },
      header: { rect: { x: 0.3 * W, y: 0.075 * H, w: W * 0.4, h: H * 0.07 }, at: { x: 0.3 * W, y: 0.075 * H } } },
    brand: {}, header: {}, box: null, parts: [],
  }),
  drawCover: () => {},
}));
vi.mock("../../export", () => ({ canExportVideo: () => true, thumbnail: async () => null }));
const clip = (id: string): Clip => ({
  id, duration: 8, caption: `Clip ${id}`, tags: [], thumb: `thumbs/${id}.webp`,
  video: { portrait: `clips/p/${id}.mp4`, landscape: `clips/l/${id}.mp4` }, poster: { portrait: `posters/p/${id}.jpg`, landscape: `posters/l/${id}.jpg` },
} as Clip);
vi.mock("../../api", () => ({
  mediaUrl: (p: string) => `/media/${p}`,
  clipUrl: () => "/media/clip.mp4",
  // One file per ayah, so the preview's players can be told apart.
  audioUrl: (reciter: string, surah: number, ayah: number) => `/audio/${reciter}/${surah}/${ayah}.mp3`,
  clipById: (id: string) => (id.startsWith("pb") ? clip(id) : null),
  allClips: () => [clip("pb9")],
  loadCatalogue: async () => {},
  searchClips: async () => [clip("pb9")],
  getSurahBackgrounds: async () => null,
  ensureClip: async () => {},
  // The words of the ayahs around the design (Add before / Add after).
  getAyahText: async (_s: number, from: number, to: number) => [{
    ayahs: Array.from({ length: to - from + 1 }, (_, i) => ({ numberInSurah: from + i, text: `أول ${from + i} كلمات` })),
  }],
}));

// The machine may be busy with other test runs: generous timeouts.
vi.setConfig({ testTimeout: 30_000 });

const surahs = surahList as Surah[];
let store: Store;
const ayah = (num: number) => ({ num, ar: `نص ${num}`, tr: `Text ${num}` });

/** The editor on its own screen (phones: 390 px; computers: 1440 px), with the design's text already loaded. `tips`:
 *  this device has not seen the first-run tips. */
function start(width: number, ayahs = 1, { tips = false, from = 5 } = {}) {
  window.__width = width;
  localStorage.setItem("qd.lang", "en");
  if (!tips) localStorage.setItem("qd.editorTips", "1");
  history.replaceState(null, "", "/create");
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, mediaBase: "/media/" }, surahs, recipe: null });
  store.dispatch({ type: "select", surah: 94, from, to: from + ayahs - 1 });
  store.dispatch({ type: "ayahs", ayahs: Array.from({ length: ayahs }, (_, i) => ayah(from + i)) });
  store.dispatch({ type: "editions", editions: {
    "en.sahih": { identifier: "en.sahih", language: "en", englishName: "Saheeh International", name: "" },
    "ml.abdulhameed": { identifier: "ml.abdulhameed", language: "ml", englishName: "Abdul Hameed and Kunhi", name: "" },
  } });
  store.dispatch({ type: "suggestions", clips: [clip("pb1"), clip("pb2")] });
  const phone = width < 760;
  return render(
    <StoreContext.Provider value={store}>
      <ExportProvider phone={phone}><Create active phone={phone} /></ExportProvider>
    </StoreContext.Provider>,
  );
}
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const tabs = () => within(screen.getByRole("tablist", { name: "Edit" })).getAllByRole("tab");
const tab = (name: string) => within(screen.getByRole("tablist", { name: "Edit" })).getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");
const topBar = () => document.querySelector<HTMLElement>(".ed-top")!;
/** Text reloaded after the range changed (app.ts does this in the app). */
const loaded = () => act(() => {
  const r = store.getState().recipe;
  store.dispatch({ type: "ayahs", ayahs: Array.from({ length: r.to - r.from + 1 }, (_, i) => ayah(r.from + i)) });
});

beforeEach(() => localStorage.clear());

describe("editor on phones (390 px)", () => {
  it("one tab is always selected (Look first); each swaps the panel in place, and its pages open inside it with a way back", async () => {
    const user = userEvent.setup();
    start(390);
    expect(tabs().map((b) => b.textContent)).toEqual(["Ayah", "Look", "AaText", "Sound"]);
    const selected = () => tabs().filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.textContent);
    expect(selected()).toEqual(["Look"]);
    expect(within(panel()).getByRole("group", { name: "Looks" })).toBeTruthy();
    for (const [name, inside] of [["Text", "Arabic font"], ["Ayah", "Show long ayahs in parts"], ["Sound", "Reciter"], ["Look", "Looks"]]) {
      await user.click(tab(name));
      expect(selected()).toEqual([name === "Text" ? "AaText" : name]);
      expect(panel().textContent).toContain(inside);
      await user.click(tab(name)); // tapping the open tab keeps it open: the panel is never closed
      expect(selected()).toHaveLength(1);
    }
    // Arrow keys move between the tabs.
    fireEvent.keyDown(tab("Look"), { key: "ArrowRight" });
    expect(selected()).toEqual(["AaText"]);
    fireEvent.keyDown(tab("Text"), { key: "Home" });
    expect(selected()).toEqual(["Ayah"]);

    // A page: All reciters, inside the panel, with the way back to Sound.
    await user.click(tab("Sound"));
    await user.click(within(panel()).getByRole("button", { name: `All ${RECITERS.length} reciters` }));
    expect(within(panel()).getByRole("heading", { name: "All reciters" })).toBeTruthy();
    expect(within(panel()).getAllByRole("radio")).toHaveLength(RECITERS.length);
    await user.click(within(panel()).getByRole("button", { name: "Back to Sound" }));
    expect(within(panel()).queryByRole("heading", { name: "All reciters" })).toBeNull();
    expect(panel().textContent).toContain("Reciter");
    expect(getRoute().sheet).toBeNull(); // nothing opens over the editor
  });

  it("Looks: one tap sets the font, colour, box, border and animation together; More options has the rest and Reset the look", async () => {
    const user = userEvent.setup();
    start(390);
    const looks = within(panel()).getByRole("group", { name: "Looks" });
    expect(within(looks).getAllByRole("button").map((b) => b.querySelector(".ed-look-name")?.textContent)).toEqual(
      ["Shade", "Classic", "Soft glass", "Emerald", "Golden", "Paper", "Framed", "Plain"]);
    for (const [i, name] of [[3, "Emerald"], [5, "Paper"], [4, "Golden"]] as const) {
      await user.click(within(looks).getByRole("button", { name: new RegExp(name) }));
      expect(store.getState().recipe).toMatchObject(LOOKS[i]);
      expect(within(looks).getAllByRole("button", { pressed: true }).map((b) => b.querySelector(".ed-look-name")?.textContent)).toEqual([name]);
    }
    // The sizes and the position are not part of a Look.
    expect(store.getState().recipe).toMatchObject({ quranSize: 4, transSize: 3, textY: 0.54 });

    await user.click(within(panel()).getByRole("button", { name: "More options: box, border, animation" }));
    const effects = within(panel()).getByRole("group", { name: "Box style" });
    await user.click(within(effects).getByRole("button", { name: /Glass/ }));
    expect(store.getState().recipe.effect).toBe("glass");
    expect(within(looks).queryAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(0);
    expect(within(panel()).getByText("Glass tint")).toBeTruthy();
    const [opacity, border] = within(panel()).getAllByRole("button", { name: "Increase" }); // the tint's opacity, the border's size
    await user.click(opacity);
    expect(store.getState().recipe.boxOpacity).toBe(70);
    await user.click(border);
    expect(store.getState().recipe.borderWidth).toBe(1);
    await user.click(within(panel()).getByRole("button", { name: "Rise" }));
    expect(store.getState().recipe.animation).toBe("rise");
    await user.click(within(panel()).getByRole("switch", { name: "Auto contrast" }));
    expect(store.getState().recipe.autoContrast).toBe(false);
    await user.click(within(panel()).getByRole("button", { name: "Reset the look" }));
    expect(store.getState().recipe).toMatchObject({ effect: "shade", font: "Amiri Quran", textColor: "#ffffff", boxOpacity: 40, borderWidth: 0,
      animation: "none", autoContrast: true });
  });

  it("Look's backgrounds: this ayah's suggestions, Colour and See all (library, colours, report), inside the panel", async () => {
    const user = userEvent.setup();
    start(390);
    const strip = within(panel()).getByRole("group", { name: "Background · picked for this ayah" });
    await user.click(within(strip).getByRole("button", { name: "Clip pb2" }));
    expect(store.getState().recipe.bg).toEqual({ type: "clip", id: "pb2" });
    expect(store.getState().bgManual).toBe(true);
    expect(within(strip).getByRole("button", { name: "Clip pb2" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(within(panel()).getByRole("button", { name: "See all" }));
    expect(within(panel()).getByRole("heading", { name: "Background" })).toBeTruthy();
    expect(within(panel()).getByRole("button", { name: "Clip pb2" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(panel()).getByRole("button", { name: "Library" }));
    await user.click(await within(panel()).findByRole("button", { name: "Clip pb9" }, { timeout: 5000 }));
    expect(store.getState().recipe.bg).toEqual({ type: "clip", id: "pb9" });
    expect(within(panel()).getByRole("button", { name: "Report this background" })).toBeTruthy();
    await user.click(within(panel()).getByRole("button", { name: "Back to Look" }));

    await user.click(within(panel()).getByRole("button", { name: "Colour" }));
    expect(within(panel()).getByRole("button", { name: "Colours" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(panel()).getByRole("button", { name: "Background colour #152238" }));
    expect(store.getState().recipe.bg).toEqual({ type: "colour", colour: "#152238" });
  });

  it("Text: Arabic and translation sizes, font, colour, what to show, position, and the resets under More options", async () => {
    const user = userEvent.setup();
    start(390);
    await user.click(tab("Text"));
    await user.click(within(panel()).getByRole("button", { name: "Bigger Arabic" }));
    await user.click(within(panel()).getByRole("button", { name: "Smaller translation" }));
    expect(store.getState().recipe).toMatchObject({ quranSize: 5, transSize: 2 });
    const fonts = within(panel()).getByRole("group", { name: "Arabic font" });
    expect(within(fonts).getAllByRole("button").map((b) => b.textContent)).toEqual(["نص 5Amiri", "نص 5Scheherazade", "نص 5Naskh"]);
    await user.click(within(fonts).getByRole("button", { name: /Scheherazade/ }));
    expect(store.getState().recipe.font).toBe("Scheherazade New");
    await user.click(within(within(panel()).getByRole("group", { name: "Text colour" })).getByRole("button", { name: "Colour #e3b25e" }));
    expect(store.getState().recipe.textColor).toBe("#e3b25e");
    for (const [label, key] of [["Translation", "showTranslation"], ["Surah name", "showSurah"], ["Ayah number", "showRef"]]) {
      await user.click(within(panel()).getByRole("switch", { name: label }));
      expect(store.getState().recipe).toMatchObject({ [key]: false });
    }
    const position = within(panel()).getByRole("group", { name: "Position" });
    expect(within(position).getByRole("button", { name: "Middle" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(position).getByRole("button", { name: "Top" }));
    expect(store.getState().recipe).toMatchObject({ textX: 0.5, textY: 0.333 });

    await user.click(within(panel()).getByRole("button", { name: "More options: reset" }));
    expect(within(panel()).queryByRole("button", { name: "Reset surah name position" })).toBeNull(); // the surah name is hidden
    await user.click(within(panel()).getByRole("button", { name: "Reset text position" }));
    expect(store.getState().recipe.textY).toBe(0.54);
    await user.click(within(panel()).getByRole("button", { name: "Reset size, font and colour" }));
    expect(store.getState().recipe).toMatchObject({ quranSize: 4, transSize: 3, font: "Amiri Quran", textColor: "#ffffff" });
  });

  it("the Format pill opens the Format card (video or image, 9:16 · 1:1 · 16:9); Next opens Share; Close goes back", async () => {
    const user = userEvent.setup();
    start(390);
    const pill = screen.getByRole("button", { name: "Format: Video, size 9:16" });
    expect(pill.textContent).toBe("Video · 9:16");
    await user.click(pill);
    const card = screen.getByRole("dialog", { name: "Format" });
    await user.click(within(card).getByRole("button", { name: /^Image/ }));
    expect(store.getState().format).toBe("image");
    await user.click(within(card).getByRole("button", { name: /^1:1/ }));
    expect(store.getState().recipe.orientation).toBe("square");
    expect(document.querySelector(".stage-box")!.getAttribute("data-orientation")).toBe("square");
    await user.click(within(card).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Format" })).toBeNull();
    expect(screen.getByRole("button", { name: "Format: Image, size 1:1" })).toBeTruthy();
    // An image does not play: the player shows Frame instead of Play, and Sound offers the way back to video.
    expect(screen.queryByRole("button", { name: "Play recitation" })).toBeNull();
    expect(screen.getByText("Frame")).toBeTruthy();
    await user.click(tab("Sound"));
    await user.click(within(panel()).getByRole("button", { name: "Switch to Video" }));
    expect(store.getState().format).toBe("video");
    expect(screen.getByRole("button", { name: "Play recitation" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(getRoute().view).toBe("share");
    await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 20)); });
    expect(getRoute().view).toBe("create");
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    await tick();
    expect(getRoute().view).toBe("find");
  });

  it("Sound: the first four reciters, then all; Hear the meaning when the translation's language has a recorded voice; the length", async () => {
    const user = userEvent.setup();
    start(390);
    await user.click(tab("Sound"));
    const reciters = within(panel()).getByRole("radiogroup", { name: "Reciter" });
    expect(within(reciters).getAllByRole("radio")).toHaveLength(4);
    await user.click(within(reciters).getByRole("radio", { name: "Mahmoud Khalil Al-Husary" }));
    expect(store.getState().recipe.reciter).toBe("Husary_128kbps");
    await user.click(within(panel()).getByRole("button", { name: `All ${RECITERS.length} reciters` }));
    await user.click(within(panel()).getByRole("radio", { name: "Hani Ar-Rifai" }));
    await user.click(within(panel()).getByRole("button", { name: "Back to Sound" }));
    // The one chosen from all of them takes the fourth row.
    expect(within(within(panel()).getByRole("radiogroup", { name: "Reciter" })).getAllByRole("radio").map((r) => (r as HTMLInputElement).value))
      .toEqual(["Alafasy_128kbps", "Abdul_Basit_Murattal_192kbps", "Abdul_Basit_Mujawwad_128kbps", "Hani_Rifai_192kbps"]);
    expect(within(panel()).getByText("Length")).toBeTruthy();
    expect(within(panel()).getByText("Follows the recitation")).toBeTruthy();

    const voice = () => within(panel()).queryByRole("switch", { name: "Hear the meaning" });
    expect(voice()!.getAttribute("aria-checked")).toBe("false");
    expect(panel().textContent).toContain("a recorded voice reads its translation.");
    await user.click(voice()!);
    expect(store.getState().recipe).toMatchObject({ voice: "en.walk", translation: "en.sahih" });
    expect(panel().textContent).toContain("Shows the translation the voice reads: Saheeh International.");
    expect(within(panel()).getByText("The recitation, then the voice")).toBeTruthy();
    await user.click(voice()!);
    expect(store.getState().recipe.voice).toBe("none");
    // Malayalam: the voice reads Quran Lalithasaram, so turning it on switches the translation, and a line says so.
    act(() => {
      store.dispatch({ type: "editions", editions: { ...store.getState().editions,
        "ml.lalithasaram": { identifier: "ml.lalithasaram", language: "ml", englishName: "ഖുര്‍ആന്‍ ലളിതസാരം (Karakunnu & Elayavoor)", name: "" } } });
      store.dispatch({ type: "patch", patch: { translation: "ml.abdulhameed" } });
    });
    await user.click(voice()!);
    expect(store.getState().recipe).toMatchObject({ voice: "ml.lalithasaram", translation: "ml.lalithasaram" });
    expect(store.getState().toast?.text).toBe("Translation switched to ഖുര്‍ആന്‍ ലളിതസാരം (Karakunnu & Elayavoor), the one the voice reads.");
    // Hindi has no recorded voice: the voice goes off and the switch is not offered.
    act(() => store.dispatch({ type: "patch", patch: { translation: "hi.hindi" } }));
    expect(store.getState().recipe.voice).toBe("none");
    expect(voice()).toBeNull();
  });

  it("Ayah: add the ayah before or after in place (up to 3, with Undo), remove an end one, tap one to show it", async () => {
    const user = userEvent.setup();
    start(390, 1);
    await user.click(tab("Ayah"));
    const sel = () => within(panel()).getByRole("group", { name: "Ash-Sharh" });
    expect(sel().textContent).toContain("1 ayah selected · 94:5 · up to 3");
    expect(within(sel()).queryByRole("button", { name: /^Remove/ })).toBeNull(); // the only ayah cannot be removed
    expect(await within(panel()).findByText("أول 4 كلمات")).toBeTruthy(); // the words of the one before

    await user.click(within(panel()).getByRole("button", { name: "Add 94:6 (after)" }));
    expect(store.getState().recipe).toMatchObject({ from: 5, to: 6 });
    expect(screen.getByRole("status").textContent).toBe("Added 94:6Undo");
    loaded();
    await tick();
    expect(store.getState().current).toBe(1); // the ayah added is on the preview
    expect(within(sel()).getByRole("button", { name: "Selected: 94:6. Show it on the preview" }).getAttribute("aria-current")).toBe("true");

    await user.click(within(panel()).getByRole("button", { name: "Add 94:4 (before)" }));
    expect(store.getState().recipe).toMatchObject({ from: 4, to: 6 });
    expect(store.getState().bgManual).toBe(true);
    loaded();
    expect(sel().textContent).toContain("3 ayahs selected · 94:4–6 · up to 3");
    // Three: no more rows to add; only the end rows can be removed.
    expect(within(panel()).queryByRole("button", { name: /^Add 94/ })).toBeNull();
    expect(within(panel()).getByText("Up to 3 ayahs in one design. Remove one at either end to add another.")).toBeTruthy();
    expect(within(sel()).getAllByRole("button", { name: /^Remove/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Remove 94:4", "Remove 94:6"]);

    // Undo (from the line, or the top bar) and Redo.
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(store.getState().recipe).toMatchObject({ from: 5, to: 6 });
    expect(screen.queryByRole("status")).toBeNull();
    await user.click(within(topBar()).getByRole("button", { name: "Redo" }));
    expect(store.getState().recipe).toMatchObject({ from: 4, to: 6 });
    loaded();

    await user.click(within(sel()).getByRole("button", { name: "Remove 94:4" }));
    expect(store.getState().recipe).toMatchObject({ from: 5, to: 6 });
    expect(screen.getByRole("status").textContent).toBe("Removed 94:4Undo");
    loaded();
    await user.click(within(sel()).getByRole("button", { name: "Selected: 94:6. Show it on the preview" }));
    expect(store.getState().current).toBe(1);
    expect(within(panel()).getByRole("button", { name: "Reflect on 94:6" })).toBeTruthy();
    await user.click(within(topBar()).getByRole("button", { name: "Undo" }));
    expect(store.getState().recipe).toMatchObject({ from: 4, to: 6 });

    // The surah's last ayah: nothing to add after it.
    act(() => store.dispatch({ type: "range", from: 8, to: 8 }));
    expect(within(panel()).getByRole("button", { name: "Add 94:7 (before)" })).toBeTruthy();
    expect(within(panel()).queryByRole("button", { name: /after/ })).toBeNull();

    await user.click(within(panel()).getByRole("button", { name: "Choose other ayahs" }));
    expect(getRoute().view).toBe("pick");
    expect(getPickStart()).toEqual({ surah: 94, from: 8, to: 8 });
  });

  it("Ayah: the translation and Change (two steps, inside the panel); long ayahs in parts", async () => {
    const user = userEvent.setup();
    start(390);
    await user.click(tab("Ayah"));
    await user.click(within(panel()).getByRole("switch", { name: "Show long ayahs in parts" }));
    expect(store.getState().recipe.splitLong).toBe(false);
    await user.click(within(panel()).getByRole("button", { name: /Saheeh International.*Change/ }));
    expect(within(panel()).getByRole("heading", { name: "Translation" })).toBeTruthy();
    const radios = () => within(panel()).getAllByRole("radio").map((r) => r.getAttribute("value"));
    expect(within(panel()).getByRole("heading", { name: "English" })).toBeTruthy();
    expect(radios()).toEqual(["en.sahih"]);
    await user.click(within(panel()).getByRole("button", { name: "Languages" }));
    expect(within(panel()).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["EnglishMy language1 translation", "മലയാളം Malayalam1 translation"]);
    await user.type(within(panel()).getByRole("searchbox", { name: "Search languages or translators" }), "malay");
    await user.click(within(panel()).getByRole("button", { name: /Malayalam/ }));
    expect(store.getState().recipe.translation).toBe("ml.abdulhameed");
    await user.click(within(panel()).getByRole("button", { name: "Back to Ayah" }));
    expect(within(panel()).getByRole("button", { name: /Abdul Hameed and Kunhi.*Change/ })).toBeTruthy();
  });

  it("the seek bar runs over the whole video: seeking into another ayah shows it, and Play goes on from there", async () => {
    start(390, 2);
    await screen.findByRole("button", { name: /Text block/ }, { timeout: 5000 });
    const seek = screen.getByRole("slider", { name: "Seek through the whole video" }) as HTMLInputElement;
    // Until the recordings' lengths are known: 1 + 0.55 s a word, two words each (2.1 s), then the 1.5 s tail.
    await tick();
    expect(+seek.max).toBeCloseTo(5.7, 1);
    expect(document.querySelectorAll(".seek-mark")).toHaveLength(1); // where the second ayah starts
    expect(document.querySelector(".seek-time")!.textContent).toBe("0:00 / 0:05");
    const player = document.querySelectorAll("audio")[0];

    fireEvent.change(seek, { target: { value: "3" } });
    expect(store.getState()).toMatchObject({ current: 1, section: 0, playing: false });
    expect(player.dataset.net).toBe("/audio/Alafasy_128kbps/94/6.mp3"); // the second ayah's recording, ready at 0.9 s
    await tick();
    expect(seek.getAttribute("aria-valuetext")).toBe("0:03 of 0:05, 94:6 · ayah 2 of 2");
    expect(document.querySelector(".seek-time")!.textContent).toBe("0:03 / 0:05");
    const play = vi.spyOn(player, "play");
    fireEvent.click(screen.getByRole("button", { name: "Play recitation" }));
    expect(store.getState()).toMatchObject({ playing: true, current: 1 });
    expect(play).toHaveBeenCalled();
    expect(player.dataset.net).toBe("/audio/Alafasy_128kbps/94/6.mp3"); // the same element goes on there, not from ayah 1
    await tick();
    expect(document.querySelector(".seek-time")!.textContent).toBe("0:03 / 0:05");

    // Playing, back into the first ayah: its recitation takes over, and its text comes back.
    fireEvent.change(seek, { target: { value: "0.5" } });
    expect(store.getState()).toMatchObject({ playing: true, current: 0 });
    expect(player.dataset.net).toBe("/audio/Alafasy_128kbps/94/5.mp3");
    fireEvent.click(screen.getByRole("button", { name: "Pause recitation" }));
    expect(store.getState().playing).toBe(false);
  });

  it("undo and redo: a drag is one step however far it goes; a burst of the same change too", async () => {
    const user = userEvent.setup();
    start(390);
    const undoBtn = screen.getByRole("button", { name: "Undo" }), redoBtn = screen.getByRole("button", { name: "Redo" });
    expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
    const frame = document.querySelector<HTMLElement>(".frame")!;
    frame.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640, toJSON() {} });
    const block = await screen.findByRole("button", { name: /Text block/ }, { timeout: 5000 });
    fireEvent.pointerDown(block, { pointerId: 1, button: 0, clientX: 180, clientY: 320 });
    for (let y = 310; y >= 250; y -= 10) fireEvent.pointerMove(block, { pointerId: 1, clientX: 180, clientY: y });
    fireEvent.pointerUp(block, { pointerId: 1, clientX: 180, clientY: 250 });
    const dropped = store.getState().recipe.textY;
    expect(dropped).toBeLessThan(0.54);
    expect(store.getState().edits.past).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reset position" })).toBeTruthy(); // the Reset chip on the preview

    // A+ three times in a row: one step.
    await user.click(tab("Text"));
    for (let i = 0; i < 3; i++) await user.click(within(panel()).getByRole("button", { name: "Bigger Arabic" }));
    expect(store.getState().recipe.quranSize).toBe(7);
    expect(store.getState().edits.past).toHaveLength(2);

    await user.click(undoBtn);
    expect(store.getState().recipe).toMatchObject({ quranSize: 4, textY: dropped });
    await user.click(undoBtn);
    expect(store.getState().recipe).toMatchObject({ textX: 0.5, textY: 0.54 });
    expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
    await user.click(redoBtn);
    expect(store.getState().recipe.textY).toBe(dropped);
    // A new change clears what could be redone.
    await user.click(tab("Look"));
    await user.click(within(panel()).getByRole("button", { name: /Emerald/ }));
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
    await user.click(undoBtn);
    expect(store.getState().recipe).toMatchObject({ effect: "shade", textY: dropped });
  });

  it("the first-run tips (drag the text, try a Look, tap Next) show once on a device; Skip ends them", async () => {
    const user = userEvent.setup();
    const first = start(390, 1, { tips: true });
    expect(screen.getByRole("dialog", { name: "Tip 1 of 3" }).textContent).toContain("Drag the text");
    await user.click(screen.getByRole("button", { name: "Next tip" }));
    expect(screen.getByRole("dialog", { name: "Tip 2 of 3" }).textContent).toContain("Try a Look");
    await user.click(screen.getByRole("button", { name: "Next tip" }));
    expect(screen.getByRole("dialog", { name: "Tip 3 of 3" }).textContent).toContain("Tap Next to share");
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog", { name: /^Tip/ })).toBeNull();
    expect(localStorage.getItem("qd.editorTips")).toBe("1");
    first.unmount();
    start(390, 1, { tips: true });
    expect(screen.queryByRole("dialog", { name: /^Tip/ })).toBeNull(); // once per device
  });

  it("Skip tips ends the tips for good", async () => {
    const user = userEvent.setup();
    start(390, 1, { tips: true });
    await user.click(screen.getByRole("button", { name: "Skip tips" }));
    expect(screen.queryByRole("dialog", { name: /^Tip/ })).toBeNull();
    expect(localStorage.getItem("qd.editorTips")).toBe("1");
  });

  it("the player stays up while paused; a tap on the preview hides it while playing and brings it back", async () => {
    start(390);
    await screen.findByRole("button", { name: /Text block/ }, { timeout: 5000 });
    const overlay = document.querySelector(".stage-overlay")!;
    expect(overlay.classList.contains("up")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Play recitation" }));
    expect(overlay.classList.contains("up")).toBe(true); // for a moment after the touch
    const frame = document.querySelector<HTMLElement>(".frame")!;
    fireEvent.pointerDown(frame, { pointerId: 9, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(frame, { pointerId: 9, clientX: 50, clientY: 50 });
    expect(overlay.classList.contains("up")).toBe(false);
    expect(store.getState().playing).toBe(true); // a tap does not stop the recitation
    fireEvent.pointerDown(frame, { pointerId: 10, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(frame, { pointerId: 10, clientX: 50, clientY: 50 });
    expect(overlay.classList.contains("up")).toBe(true);
  });

  it("the text block's width changes from its left handle too", async () => {
    start(390);
    const frame = document.querySelector<HTMLElement>(".frame")!;
    frame.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640, toJSON() {} });
    await screen.findByRole("button", { name: /Text block/ }, { timeout: 5000 });
    const left = document.querySelector<HTMLElement>(".width-handle.left")!;
    // Canvas 1080 wide shown at 360 (×3): 30 px to the right on the left handle narrows the block by 2 × 90 px.
    fireEvent.pointerDown(left, { pointerId: 1, button: 0, clientX: 25, clientY: 320 });
    fireEvent.pointerMove(left, { pointerId: 1, clientX: 40, clientY: 320 });
    fireEvent.pointerMove(left, { pointerId: 1, clientX: 55, clientY: 320 });
    fireEvent.pointerUp(left, { pointerId: 1, clientX: 55, clientY: 320 });
    expect(store.getState().recipe.textWidth).toBe(Math.round(((1080 * 0.86 - 180) / 1080) * 1000) / 1000);
    expect(store.getState().playing).toBe(false);
  });
});

describe("editor on computers (1440 px)", () => {
  it("the panel is a column beside the preview with its tabs at the top; Video / Image and the sizes sit in the top bar", async () => {
    const user = userEvent.setup();
    start(1440, 1, { tips: true });
    expect(screen.queryByRole("dialog", { name: /^Tip/ })).toBeNull(); // the tips are for phones
    expect(screen.getByRole("heading", { level: 1, name: "Ash-Sharh 94:5" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Format:/ })).toBeNull();
    const panelEl = screen.getByRole("tabpanel");
    expect(within(panelEl).getByRole("tablist", { name: "Edit" })).toBeTruthy(); // the tabs are inside the panel, at the top
    expect(tabs().map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
    await user.click(within(screen.getByRole("group", { name: "Make a video or an image" })).getByRole("button", { name: "Image" }));
    expect(store.getState().format).toBe("image");
    await user.click(within(screen.getByRole("group", { name: "Size" })).getByRole("button", { name: "16:9" }));
    expect(store.getState().recipe.orientation).toBe("landscape");
    await user.click(tab("Sound"));
    expect(within(panelEl).getAllByRole("radio").length).toBe(4);
    await user.click(screen.getByRole("button", { name: "Next: share" }));
    expect(getRoute().view).toBe("share");
  });
});
