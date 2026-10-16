// Reflect sheet: Scholars' notes (verified authors only: lessons, then reflections) above everyone else's reflections,
// each section with its own "More"; photos only through our Worker; the tab it opens on; the tafsir's layout classes
// as cards by language (My language's first, Read for one alone, remembered per My language); hashtags and references. The network is replaced with
// stand-ins (placeholder text, never Quran text).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReflectionPost, ReflectionsResponse, Surah, TafsirInfo, TafsirResponse } from "../../../../contracts/types";
import surahList from "../../public/data/surahs.json";
import { openReflect } from "../actions";
import * as api from "../api";
import { initRouter, openSheet } from "../router";
import { createStore, type Store } from "../state";
import { t } from "../strings";
import { StoreContext } from "./hooks";
import { postParts, postSnippet, ReflectSheet } from "./Reflect";

vi.mock("../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));

const card = (id: number, extra: Partial<ReflectionPost> = {}, by: Partial<NonNullable<ReflectionPost["by"]>> = {}): ReflectionPost => ({
  id, body: `Placeholder text ${id}`, author: `user${id}`, likes: id, lang: "en", date: "2025-01-01", url: `https://quranreflect.com/posts/${id}`,
  kind: "reflection", reviewed: false, by: { name: `Reader ${id}`, username: `user${id}`, verified: false, avatar: null, ...by }, ...extra,
});
const page = (posts: ReflectionPost[], extra: Partial<ReflectionsResponse> = {}): ReflectionsResponse =>
  ({ ref: "2:153", lang: "en", fallback: false, kind: "reflections", total: 25, page: 1, pages: 1, posts, ...extra });
const PHOTO = "/api/avatar/qr/avatars/1/medium/a.jpg";

vi.mock("../api", () => ({
  getTafsir: vi.fn(),
  getTafsirs: vi.fn(),
  getReflections: vi.fn(),
  getLessons: vi.fn(),
  avatarSrc: (path: string | null | undefined) => (path?.startsWith("/api/avatar/") ? path : null),
}));
vi.setConfig({ testTimeout: 30_000 });
const getTafsir = vi.mocked(api.getTafsir), getTafsirs = vi.mocked(api.getTafsirs);
const getReflections = vi.mocked(api.getReflections), getLessons = vi.mocked(api.getLessons);

const TAFSIR: TafsirResponse = {
  ref: "2:153", lang: "en", fallback: false, tafsir: { id: 169, name: "Ibn Kathir (Abridged)", author: "Hafiz Ibn Kathir" }, from: "2:153", to: "2:154",
  html: '<h3>A heading</h3><p>Before the quote:</p><div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">ابجد هوز</p><p class="rf-tr">(Placeholder translation)</p>'
    + '<p class="rf-ref">(2:45)</p></div><p class="rf-fn" onclick="x()">A footnote<script>alert(1)</script></p>',
  options: [{ id: 169, name: "Ibn Kathir (Abridged)" }, { id: 168, name: "Ma'arif al-Qur'an" }],
};
/** GET /api/tafsirs, as the Worker orders it (each language's default first). */
const TAFSIRS: TafsirInfo[] = [
  { id: 16, name: "Tafsir Muyassar", author: "Muyassar", lang: "ar" },
  { id: 169, name: "Ibn Kathir (Abridged)", author: "Hafiz Ibn Kathir", lang: "en" },
  { id: 168, name: "Ma'arif al-Qur'an", author: "Mufti Muhammad Shafi", lang: "en" },
  { id: 160, name: "Tafsir Ibn Kathir", author: "Hafiz Ibn Kathir", lang: "ur" },
  { id: 159, name: "Bayan ul Quran", author: "Dr. Israr Ahmad", lang: "ur" },
  { id: 231, name: "Abu Bakr and Khamis", author: "Abu Bakr and Khamis", lang: "sw" },
];

const surahs = surahList as Surah[];
let store: Store;

async function open(lang = "en") {
  localStorage.setItem("qd.lang", lang);
  history.replaceState(null, "", "/");
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: null, surahs, recipe: null });
  render(<StoreContext.Provider value={store}><ReflectSheet /></StoreContext.Provider>);
  await act(async () => { openReflect(store, "2:153", "feed"); openSheet("reflect"); });
  return screen.getByRole("dialog", { name: /Reflect · Al-Baqara 2:153/ });
}
const tab = (name: string) => screen.getByRole("tab", { name });
const section = (name: string) => screen.getByRole("region", { name });
const names = (el: HTMLElement) => within(el).getAllByRole("listitem").map((li) => li.querySelector(".rf-name bdi")!.textContent);

beforeEach(() => {
  localStorage.clear();
  getTafsir.mockReset().mockResolvedValue(TAFSIR);
  getTafsirs.mockReset().mockResolvedValue(TAFSIRS);
  getLessons.mockReset().mockImplementation(async (_ref, _lang, n = 1) => (n === 1
    ? page([card(1, { kind: "lesson", likes: 3 }, { name: "Teacher One", verified: true, avatar: PHOTO }), card(2, { kind: "lesson", likes: 40 }),
      card(3, { kind: "lesson", lang: "ar" }, { name: "Teacher Three", verified: true })], { kind: "lessons", total: 13, pages: 2 })
    : page([card(4, { kind: "lesson" }, { name: "Teacher Four", verified: true })], { kind: "lessons", page: 2, total: 13, pages: 2 })));
  getReflections.mockReset().mockImplementation(async (_ref, _lang, n = 1) => (n === 1
    ? page([card(10, {}, { name: "Teacher Ten", verified: true, avatar: "https://s3.amazonaws.com/qreflect-bucket/x.jpg" }),
      card(11, { reviewed: true, likes: 1, body: "Long ".repeat(100) }), card(12, { likes: 30 }), card(13, { likes: 5, lang: "ar" })], { total: 143, pages: 3 })
    : page([card(20)], { page: 2, total: 143, pages: 3 })));
});

describe("Reflect sheet: Scholars' notes and Reflections", () => {
  it("opens on Reflections when the ayah has scholars' notes: verified lessons, then verified reflections, then everyone else", async () => {
    await open();
    await waitFor(() => expect(tab(t.reflections).getAttribute("aria-selected")).toBe("true"));
    const scholars = section(t.scholarsNotes);
    expect(within(scholars).getByText(t.scholarsIntro)).toBeTruthy();
    expect(names(scholars)).toEqual(["Teacher One", "Teacher Three", "Teacher Ten"]);
    expect(within(scholars).getAllByRole("img", { name: t.verifiedOnQuranReflect })).toHaveLength(3);
    // Everyone else: the moderators' pick first, then likes; the unverified lesson is here, marked as a lesson.
    const community = section(t.reflections);
    expect(names(community)).toEqual(["Reader 11", "Reader 2", "Reader 12", "Reader 13"]);
    expect(within(community).queryByRole("img", { name: t.verifiedOnQuranReflect })).toBeNull();
    expect(within(community).getByText(t.lessonTag)).toBeTruthy();
    expect(within(community).getByText("In Arabic")).toBeTruthy();
    expect(within(community).getByText(/143 reflections/)).toBeTruthy();
    expect(within(community).getByText("40 likes")).toBeTruthy();
  });

  it("posts in the served language come before the other languages QuranReflect adds, even with more likes", async () => {
    getReflections.mockResolvedValue(page([card(30, { likes: 99, lang: "ar" }), card(31, { likes: 1 }), card(32, { likes: 2 })]));
    await open();
    const community = await waitFor(() => section(t.reflections));
    expect(names(community)).toEqual(["Reader 2", "Reader 32", "Reader 31", "Reader 30"]); // 2 = the unverified lesson (40 likes)
  });

  it("photos only through our Worker (initials otherwise, and when one fails to load)", async () => {
    await open();
    const scholars = await waitFor(() => section(t.scholarsNotes));
    const [one, three, ten] = within(scholars).getAllByRole("listitem");
    const img = one.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(PHOTO);
    expect(img.alt).toBe("");
    expect(three.querySelector("img")).toBeNull();
    expect(three.querySelector(".rf-avatar")!.textContent).toBe("TT");
    expect(ten.querySelector("img")).toBeNull(); // a third-party address is never loaded
    expect(document.querySelectorAll('img[src^="http"]')).toHaveLength(0);
    fireEvent.error(img);
    expect(one.querySelector("img")).toBeNull();
    expect(one.querySelector(".rf-avatar")!.textContent).toBe("TO");
  });

  it("cards: Read more, Read on QuranReflect, Report", async () => {
    const user = userEvent.setup();
    await open();
    const community = await waitFor(() => section(t.reflections));
    const long = within(community).getAllByRole("listitem")[0];
    const more = within(long).getByRole("button", { name: t.readMore });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(long.querySelector(".rf-body")!.classList.contains("rf-clamped")).toBe(true);
    await user.click(more);
    expect(within(long).getByRole("button", { name: t.showLess }).getAttribute("aria-expanded")).toBe("true");
    expect(within(long).queryByRole("link")).toBeNull(); // no "Read on QuranReflect" (owner, 12 Oct 2026)
    await user.click(within(long).getByRole("button", { name: t.reportReflection }));
    expect(store.getState().report).toEqual({ kind: "other", ref: "2:153", note: "reflection 11" });
  });

  it("each section loads its own next page", async () => {
    const user = userEvent.setup();
    await open();
    const scholars = await waitFor(() => section(t.scholarsNotes));
    await user.click(within(scholars).getByRole("button", { name: t.moreScholarsNotes }));
    await waitFor(() => expect(names(scholars)).toEqual(["Teacher One", "Teacher Three", "Teacher Four", "Teacher Ten"]));
    expect(getLessons).toHaveBeenLastCalledWith("2:153", "en", 2);
    expect(within(scholars).queryByRole("button", { name: t.moreScholarsNotes })).toBeNull(); // last page
    expect(getReflections).toHaveBeenCalledTimes(1);
    const community = section(t.reflections);
    await user.click(within(community).getByRole("button", { name: t.moreReflections }));
    await waitFor(() => expect(names(community).at(-1)).toBe("Reader 20"));
    expect(getReflections).toHaveBeenLastCalledWith("2:153", "en", 2);
  });

  it("opens on Tafsir without scholars' notes, and hides that section", async () => {
    const user = userEvent.setup();
    getLessons.mockResolvedValue(page([card(2, { kind: "lesson" })], { kind: "lessons" }));
    getReflections.mockResolvedValue(page([card(12)]));
    await open();
    await waitFor(() => expect(tab(t.tafsir).getAttribute("aria-selected")).toBe("true"));
    expect(screen.queryByRole("status")).toBeNull();
    await user.click(tab(t.reflections));
    expect(screen.queryByRole("region", { name: t.scholarsNotes })).toBeNull();
    expect(names(section(t.reflections))).toEqual(["Reader 12", "Reader 2"]);
  });

  it("says when the posts are in English because My language has none; lessons failing leaves the reflections", async () => {
    const user = userEvent.setup();
    getLessons.mockRejectedValue(new Error("502"));
    getReflections.mockResolvedValue(page([card(12)], { fallback: true }));
    await open("ml");
    await user.click(tab(t.reflections));
    const community = await waitFor(() => section(t.reflections));
    expect(within(community).getByText(t.reflectionsFallback("Malayalam"))).toBeTruthy();
    expect(getReflections).toHaveBeenCalledWith("2:153", "ml", 1);
  });

  it("older answers (username only) still show", async () => {
    const user = userEvent.setup();
    getLessons.mockResolvedValue(page([], { kind: "lessons" }));
    getReflections.mockResolvedValue(page([{ id: 5, body: "Old shape", author: "reader5", likes: 2, lang: "en", date: "", url: "https://quranreflect.com/posts/5" }]));
    await open();
    await user.click(tab(t.reflections));
    expect(await screen.findByText("@reader5")).toBeTruthy();
    expect(screen.getByText("2 likes")).toBeTruthy();
  });
});

describe("Reflect sheet: Tafsir", () => {
  const quiet = () => { getLessons.mockResolvedValue(page([], { kind: "lessons" })); getReflections.mockResolvedValue(page([])); };
  const ANSWERS: Record<string, Partial<TafsirResponse>> = {
    160: { lang: "ur", tafsir: { id: 160, name: "Tafsir Ibn Kathir", author: "Hafiz Ibn Kathir" }, html: "<p>Placeholder ur</p>" },
    159: { lang: "ur", tafsir: { id: 159, name: "Bayan ul Quran", author: "Dr. Israr Ahmad" }, html: "<p>Placeholder ur two</p>" },
    168: { tafsir: { id: 168, name: "Ma'arif al-Qur'an", author: "Mufti Muhammad Shafi" }, html: "<h3>Other</h3><p>Placeholder two</p>" },
  };
  /** Each tafsir answers as itself (TAFSIR for Ibn Kathir and anything else). */
  const byId = () => getTafsir.mockImplementation(async (_ref, _lang, id) => ({ ...TAFSIR, ...(id !== undefined ? ANSWERS[String(id)] : {}) }));
  const langs = (sheet: HTMLElement) => within(within(sheet).getByRole("group", { name: t.tafsirLanguages })).getAllByRole("button");
  const cardNames = (sheet: HTMLElement) => [...sheet.querySelectorAll(".rf-tcard .rf-name")].map((x) => x.textContent);
  /** The line under the tafsir's name in the reader: author · language · the ayahs it explains. */
  const meta = (sheet: HTMLElement) => [...sheet.querySelectorAll(".rf-reader-title > span")].map((x) => x.textContent).join(" · ");

  it("cards: My language's tafsirs (its chip first and pressed), each with its book cover (else initials), author and the start of its passage", async () => {
    quiet(); byId();
    const sheet = await open();
    await waitFor(() => expect(sheet.querySelector(".rf-excerpt")!.textContent).toBe("Before the quote: …"));
    expect(langs(sheet).map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["English", "true"], ["Arabic", "false"], ["Swahili", "false"], ["Urdu", "false"]]);
    expect(cardNames(sheet)).toEqual(["Ibn Kathir (Abridged)", "Ma'arif al-Qur'an"]);
    // The book cover; initials when it does not load.
    const cover = sheet.querySelector<HTMLImageElement>(".rf-tcard .rf-cover")!;
    expect(cover.getAttribute("src")).toBe("/tafsir-covers/169.webp");
    fireEvent.error(cover);
    expect(sheet.querySelector(".rf-tcard .rf-avatar")!.textContent).toBe("HK");
    expect(sheet.querySelector(".rf-tcard .rf-meta")!.textContent).toBe(`Hafiz Ibn Kathir${t.tafsirCovers("2:153", "2:154")}`);
    expect(getTafsir).toHaveBeenCalledWith("2:153", "en", 169);
    expect(getTafsir).toHaveBeenCalledWith("2:153", "en", 168);
    expect(sheet.querySelector(".rf-tafsir-text")).toBeNull(); // nothing laid out in full until Read
  });

  it("Read: that tafsir alone, the Worker's layout kept and anything else stripped; remembered; All tafsirs goes back", async () => {
    const user = userEvent.setup();
    quiet(); byId();
    const sheet = await open();
    await user.click(await within(sheet).findByRole("button", { name: t.tafsirReadName("Ibn Kathir (Abridged)") }));
    await within(sheet).findByRole("heading", { name: "A heading" });
    expect(meta(sheet)).toBe(`Hafiz Ibn Kathir · English · ${t.tafsirCovers("2:153", "2:154")}`);
    const text = sheet.querySelector(".rf-tafsir-text")!;
    expect(text.getAttribute("dir")).toBe("ltr");
    const quote = text.querySelector(".rf-q")!;
    expect(quote.querySelector(".rf-ar")!.getAttribute("dir")).toBe("rtl");
    expect(quote.querySelector(".rf-tr")!.textContent).toBe("(Placeholder translation)");
    expect(quote.querySelector(".rf-ref")!.textContent).toBe("(2:45)");
    expect(text.querySelector(".rf-fn")!.textContent).toBe("A footnote");
    expect(text.innerHTML).not.toMatch(/onclick|script/);
    expect(cardNames(sheet)).toEqual([]);
    expect(sheet.classList.contains("rf-reading")).toBe(true); // full screen while reading
    expect(JSON.parse(localStorage.getItem("qd.tafsir")!)).toEqual({ en: 169 });
    await user.click(within(sheet).getByRole("button", { name: t.allTafsirs }));
    expect(cardNames(sheet)).toEqual(["Ibn Kathir (Abridged)", "Ma'arif al-Qur'an"]);
    expect(sheet.classList.contains("rf-reading")).toBe(false);
    // The sheet's close button while reading goes back to the cards; the sheet stays open.
    await user.click(within(sheet).getByRole("button", { name: t.tafsirReadName("Ma'arif al-Qur'an") }));
    await within(sheet).findByRole("heading", { name: "Other" });
    await user.click(within(sheet).getByRole("button", { name: t.close }));
    expect(cardNames(sheet)).toEqual(["Ibn Kathir (Abridged)", "Ma'arif al-Qur'an"]); // as it was
    expect(sheet.hasAttribute("open")).toBe(true);
    expect(sheet.classList.contains("rf-reading")).toBe(false);
  });

  it("another language's chip shows its tafsirs (right to left for Urdu); its Read shows it", async () => {
    const user = userEvent.setup();
    quiet(); byId();
    const sheet = await open();
    await user.click(await within(sheet).findByRole("button", { name: "Urdu" }));
    expect(within(sheet).getByRole("button", { name: "Urdu" }).getAttribute("aria-pressed")).toBe("true");
    expect(cardNames(sheet)).toEqual(["Tafsir Ibn Kathir", "Bayan ul Quran"]);
    await waitFor(() => expect(sheet.querySelector(".rf-excerpt")!.textContent).toBe("Placeholder ur"));
    expect(sheet.querySelector(".rf-excerpt")!.getAttribute("dir")).toBe("rtl");
    await user.click(within(sheet).getByRole("button", { name: t.tafsirReadName("Bayan ul Quran") }));
    await waitFor(() => expect(sheet.querySelector(".rf-tafsir-text")!.getAttribute("dir")).toBe("rtl"));
    expect(meta(sheet)).toBe(`Dr. Israr Ahmad · Urdu · ${t.tafsirCovers("2:153", "2:154")}`);
    expect(JSON.parse(localStorage.getItem("qd.tafsir")!)).toEqual({ en: 159 });
  });

  it("the first three, then More tafsirs for the rest", async () => {
    const user = userEvent.setup();
    quiet(); byId();
    getTafsirs.mockResolvedValue([...TAFSIRS, ...[1, 2, 3].map((n) => ({ id: 900 + n, name: `Arabic ${n}`, author: null, lang: "ar" }))]);
    const sheet = await open();
    await user.click(await within(sheet).findByRole("button", { name: "Arabic" }));
    expect(cardNames(sheet)).toEqual(["Tafsir Muyassar", "Arabic 1", "Arabic 2"]);
    await user.click(within(sheet).getByRole("button", { name: t.moreTafsirs(1) }));
    expect(cardNames(sheet)).toEqual(["Tafsir Muyassar", "Arabic 1", "Arabic 2", "Arabic 3"]);
    expect(within(sheet).queryByRole("button", { name: t.moreTafsirs(1) })).toBeNull();
    await waitFor(() => expect(getTafsir).toHaveBeenCalledWith("2:153", "en", 903));
  });

  it("the tafsir last read for My language comes first", async () => {
    localStorage.setItem("qd.tafsir", JSON.stringify({ en: 168, ur: 159 }));
    quiet(); byId();
    const sheet = await open();
    await waitFor(() => expect(cardNames(sheet)).toEqual(["Ma'arif al-Qur'an", "Ibn Kathir (Abridged)"]));
  });

  it("English labelled as such when My language has no tafsir", async () => {
    quiet(); byId();
    const sheet = await open("ml");
    expect(await within(sheet).findByText(t.tafsirFallback("Malayalam"))).toBeTruthy();
    expect(langs(sheet)[0].textContent).toBe("English");
    expect(langs(sheet)[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("Malayalam: Thafheem is My language's card; read in its own font and dir=auto", async () => {
    const user = userEvent.setup();
    const THAFHEEM: TafsirInfo = { id: "ml.thafheem", name: "തഫ്ഹീമുല്‍ ഖുര്‍ആന്‍", author: "Sayyid Abul A'la Maududi", lang: "ml" };
    quiet();
    getTafsirs.mockResolvedValue([...TAFSIRS, THAFHEEM]);
    getTafsir.mockResolvedValue({
      ref: "2:153", lang: "ml", fallback: false, tafsir: { id: "ml.thafheem", name: THAFHEEM.name, author: THAFHEEM.author }, from: "2:153", to: "2:157",
      html: '<h4>2:153–157</h4><p>ആയത്ത് സംഗ്രഹം</p><p><strong>1.</strong> കുറിപ്പ് ഒന്ന്</p>', options: [{ id: "ml.thafheem", name: THAFHEEM.name }],
    });
    const sheet = await open("ml");
    await waitFor(() => expect(cardNames(sheet)).toEqual([THAFHEEM.name]));
    expect(langs(sheet)[0].textContent).toBe("Malayalam");
    expect(within(sheet).queryByText(t.tafsirFallback("Malayalam"))).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: t.tafsirReadName(THAFHEEM.name) }));
    await within(sheet).findByRole("heading", { name: "2:153–157" });
    expect(getTafsir).toHaveBeenCalledWith("2:153", "ml", "ml.thafheem");
    const text = sheet.querySelector(".rf-tafsir-text")!;
    expect([text.getAttribute("lang"), text.getAttribute("dir")]).toEqual(["ml", "auto"]);
    expect(text.querySelector("p > strong")!.textContent).toBe("1.");
  });

  it("without the list of tafsirs: the default answer's own, as cards, and no language chips", async () => {
    getTafsirs.mockRejectedValue(new Error("offline"));
    quiet(); byId();
    const sheet = await open();
    await waitFor(() => expect(cardNames(sheet)).toEqual(["Ibn Kathir (Abridged)", "Ma'arif al-Qur'an"]));
    expect(getTafsir).toHaveBeenCalledWith("2:153", "en", undefined);
    expect(within(sheet).queryByRole("group", { name: t.tafsirLanguages })).toBeNull();
  });
});

describe("Reflect sheet: swiping between the tabs", () => {
  it("a sideways swipe on the content changes the tab; a mostly vertical one does not; not from the language chips", async () => {
    getLessons.mockResolvedValue(page([], { kind: "lessons" })); getReflections.mockResolvedValue(page([]));
    const sheet = await open();
    await waitFor(() => expect(tab(t.tafsir).getAttribute("aria-selected")).toBe("true"));
    const panes = sheet.querySelector(".rf-panes")!;
    const swipe = (el: Element, x0: number, y0: number, x1: number, y1: number) => {
      fireEvent.touchStart(el, { touches: [{ clientX: x0, clientY: y0 }] });
      fireEvent.touchEnd(el, { changedTouches: [{ clientX: x1, clientY: y1 }] });
    };
    swipe(panes, 300, 400, 280, 200); // mostly vertical: a scroll
    expect(tab(t.tafsir).getAttribute("aria-selected")).toBe("true");
    swipe(panes, 300, 400, 150, 410); // to the left: the next tab
    expect(tab(t.reflections).getAttribute("aria-selected")).toBe("true");
    swipe(panes, 100, 400, 260, 395); // to the right: back
    expect(tab(t.tafsir).getAttribute("aria-selected")).toBe("true");
    const chips = await waitFor(() => sheet.querySelector(".rf-langs")!);
    swipe(chips, 300, 400, 100, 400); // the chips scroll sideways themselves
    expect(tab(t.tafsir).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Reflect sheet: copying a reflection", () => {
  it("Copy: its words (hashtags left out), who wrote it and the ayah, then QuranReflect", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    getLessons.mockResolvedValue(page([card(1, { kind: "lesson", body: "Placeholder words\n#tag #two" }, { name: "Teacher One", verified: true })], { kind: "lessons" }));
    getReflections.mockResolvedValue(page([]));
    const sheet = await open();
    const first = await waitFor(() => within(section(t.scholarsNotes)).getAllByRole("listitem")[0]);
    await act(async () => { fireEvent.click(within(first).getByRole("button", { name: t.copyReflection })); });
    expect(writeText).toHaveBeenCalledWith(postSnippet("Placeholder words", "Teacher One", "Al-Baqara 2:153"));
    expect(postSnippet("Placeholder words", "Teacher One", "Al-Baqara 2:153")).toBe(`Placeholder words\n\n— Teacher One · Al-Baqara 2:153\n${t.viaQuranReflect}`);
    // Share without a system share sheet (here) copies instead.
    await act(async () => { fireEvent.click(within(first).getByRole("button", { name: t.shareReflection })); });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(within(first).getByRole("button", { name: t.reportReflection })).toBeTruthy(); // the flag at the top right
    expect(sheet).toBeTruthy();
  });
});

describe("postParts: a post's text for its card", () => {
  it("hashtag lines apart, a bracketed reference marked; a bracketed Arabic quote is left as text", () => {
    const p = postParts("A narration:\n'Placeholder.'\n[Agreed upon: Narrated by al-Bukhari (97)]\n#hadith #faith\n");
    expect(p.tags).toEqual(["#hadith", "#faith"]);
    expect(p.lines).toEqual([
      { text: "A narration:", cite: false }, { text: "'Placeholder.'", cite: false }, { text: "[Agreed upon: Narrated by al-Bukhari (97)]", cite: true },
    ]);
    expect(postParts("[ابجد هوز]").lines[0].cite).toBe(false);
    expect(postParts("Text with #tag inside").tags).toEqual([]);
  });
});
