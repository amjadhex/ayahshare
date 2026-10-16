// Home: greeting, the prompt that moves up as the person types, suggestions, topic chips, streak and the ways out.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasReelStart } from "../../feed";
import { resetJoin } from "../../join";
import { getQuery } from "../../nav";
import { getRoute, initRouter } from "../../router";
import { createStore } from "../../state";
import { resetStreak } from "../../streak";
import { t } from "../../strings";
import { chipOf, TOPICS } from "../../topics";
import { StoreContext } from "../hooks";
import { watchedToday } from "../../today";
import { greetingFor, Home, suggestionsFor } from "./Home";

// "Watch today's ayah": the ayah of the day without the network.
vi.mock("../../discover", async (original) => ({
  ...(await original<typeof import("../../discover")>()),
  loadAyahOfTheDay: vi.fn(async () => ({ ref: "94:5", ar: "", tr: "", bg: undefined as never, clip: null })),
}));
vi.mock("../../api", async (original) => ({ ...(await original<typeof import("../../api")>()), getTopics: vi.fn(async () => ({ topics: [] })) }));

function show() {
  const store = createStore();
  render(<StoreContext.Provider value={store}><Home active /></StoreContext.Provider>);
  return store;
}
const box = () => screen.getByRole("textbox", { name: t.homeTitle });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("qd.lang", "en");
  resetStreak([]);
  resetJoin();
  history.replaceState(null, "", "/");
  initRouter();
});

describe("Home", () => {
  it("greets with Assalamu alaikum, and the first name when signed in (no time of day)", () => {
    expect(greetingFor(null)).toBe("Assalamu alaikum");
    expect(greetingFor({ name: "Amjad Ali", displayName: null })).toBe("Assalamu alaikum, Amjad");
    expect(greetingFor({ name: "Amjad Ali", displayName: "Amju" })).toBe("Assalamu alaikum, Amju"); // the name they chose
    expect(greetingFor({ name: "", displayName: null })).toBe("Assalamu alaikum"); // an account made by email
  });

  it("shows the question, topics, the reference hint and the picker; nothing is typed yet", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t.homeTitle);
    expect(screen.getByText("Assalamu alaikum")).toBeTruthy();
    const chips = within(screen.getByRole("group", { name: t.topicsLabel })).getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== t.moreTopics);
    expect(chips).toHaveLength(8);
    expect(screen.getByText(t.homeRefHint)).toBeTruthy();
    expect(box().closest(".home")?.hasAttribute("data-typing")).toBe(false);
    expect(screen.queryByRole("list", { name: t.findLabel })).toBeNull();
  });

  it("Log in in the top bar opens the login page; none where sign-in is not offered or once signed in", async () => {
    const store = show();
    expect(screen.queryByRole("button", { name: t.logIn })).toBeNull(); // no Google client id
    act(() => store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: "id", mediaBase: "/media/" }, surahs: [], recipe: null }));
    await userEvent.setup().click(screen.getByRole("button", { name: t.logIn }));
    expect(getRoute().view).toBe("login");
    act(() => store.dispatch({ type: "me", me: { id: "u1", name: "Amjad", email: "a@example.com" } as never }));
    expect(screen.queryByRole("button", { name: t.logIn })).toBeNull();
    // Signed in: the streak and the picture as one pill (owner, 12 Oct 2026): the streak opens its details, the picture Profile.
    const streak = screen.getByRole("button", { name: t.homeStreak(0) });
    const pic = screen.getByRole("button", { name: t.navProfile });
    expect(streak.closest(".home-me")).toBe(pic.closest(".home-me"));
    expect(streak.getAttribute("aria-haspopup")).toBe("dialog");
    await userEvent.setup().click(pic);
    expect(getRoute().view).toBe("profile");
  });

  it("the streak is a small pill with the days; a tap opens its details in a sheet; the bell opens Notifications (Activity)", async () => {
    const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    resetStreak([day(2), day(1), day(0)]);
    show();
    const streak = screen.getByRole("button", { name: t.homeStreak(3) });
    expect(streak.textContent).toBe("3");
    expect(streak.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("dialog", { name: t.streakSheetTitle })).toBeNull();
    const user = userEvent.setup();
    await user.click(streak);
    expect(getRoute()).toMatchObject({ view: "find", sheet: "streak" }); // it stays on Home
    const sheet = screen.getByRole("dialog", { name: t.streakSheetTitle });
    expect(within(sheet).getByRole("heading", { name: "3 day streak" })).toBeTruthy();
    const facts = [...sheet.querySelectorAll(".streak-facts > div")].map((d) => [d.querySelector("dt")!.textContent, d.querySelector("dd")!.textContent]);
    expect(facts).toEqual([["Current", "3 days"], ["Best", "3 days"], ["This week", "3 of 7 days"]]);
    expect(within(sheet).getByText("Done for today. Come back tomorrow to make it 4.")).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: t.close }));
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    // A new day's ayah not watched yet: the bell has its dot (activitySeen.ts).
    const bell = screen.getByRole("button", { name: t.navActivityNew });
    expect(bell.hasAttribute("data-new")).toBe(true);
    await user.click(bell);
    expect(getRoute().view).toBe("activity");
  });

  it("typing folds the heading away and lists suggestions; tapping one opens Results", async () => {
    show();
    const user = userEvent.setup();
    await user.type(box(), "lonel");
    expect(box().closest(".home")?.hasAttribute("data-typing")).toBe(true);
    const list = screen.getByRole("list", { name: t.findLabel });
    const rows = within(list).getAllByRole("button").map((b) => b.textContent);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows).toContain("I feel lonely");
    expect(screen.getByText(t.homeAnyLanguage)).toBeTruthy();
    expect(screen.queryByText(t.homeRefHint)).toBeNull();

    await user.click(within(list).getByRole("button", { name: "I feel lonely at night" }));
    expect(getQuery()).toBe("I feel lonely at night");
    expect(getRoute().view).toBe("results");
    expect((box() as HTMLInputElement).value).toBe(""); // Back lands on a fresh Home
  });

  it("falls back to a plain search row; Enter and the arrow button search what was typed", async () => {
    show();
    const user = userEvent.setup();
    await user.type(box(), "zzzq");
    expect(within(screen.getByRole("list", { name: t.findLabel })).getAllByRole("button").map((b) => b.textContent)).toEqual([t.homeSearchFor("zzzq")]);
    await user.type(box(), "{Enter}");
    expect(getQuery()).toBe("zzzq");
    expect(getRoute().view).toBe("results");

    await user.click(screen.getByRole("button", { name: t.findLabel }));
    // The arrow button with nothing typed does nothing.
    expect(getQuery()).toBe("zzzq");
  });

  it("a typed reference goes to Results too", async () => {
    show();
    const user = userEvent.setup();
    await user.type(box(), "94:5-6{Enter}");
    expect(getQuery()).toBe("94:5-6");
    expect(getRoute().view).toBe("results");
  });

  it("Clear empties the box and brings the heading back", async () => {
    show();
    const user = userEvent.setup();
    await user.type(box(), "hope");
    await user.click(screen.getByRole("button", { name: t.homeClear }));
    expect((box() as HTMLInputElement).value).toBe("");
    expect(box().closest(".home")?.hasAttribute("data-typing")).toBe(false);
  });

  it("a chip says its sentence and searches the topic's query; Pick an ayah yourself opens the picker", async () => {
    show();
    const user = userEvent.setup();
    const says = (tp: (typeof TOPICS)[number]) => chipOf(tp, "en").say;
    const chip = within(screen.getByRole("group", { name: t.topicsLabel })).getAllByRole("button").find((b) => TOPICS.some((tp) => says(tp) === b.textContent && !tp.ref))!;
    const topic = TOPICS.find((tp) => says(tp) === chip.textContent)!;
    expect(chip.textContent).not.toBe(topic.en);
    await user.click(chip);
    expect(getQuery()).toBe(topic.q ?? topic.en);
    expect(getRoute().view).toBe("results");

    // In place of "Pick an ayah yourself" (the Create tab opens the picker): today's ayah, first in Reels.
    expect(screen.queryByRole("button", { name: t.pickYourself })).toBeNull();
    await user.click(screen.getByRole("button", { name: t.watchToday }));
    await waitFor(() => expect(getRoute().view).toBe("feed"));
    expect(hasReelStart()).toBe(true);
    // Watched today: the button is "Create new" (the picker) until tomorrow.
    expect(screen.queryByRole("button", { name: t.watchToday })).toBeNull();
    await user.click(screen.getByRole("button", { name: t.createNew }));
    expect(getRoute().view).toBe("pick");
    const tomorrow = new Date(Date.now() + 86_400_000);
    localStorage.setItem("qd.todayWatched", `${tomorrow.getFullYear()}-${tomorrow.getMonth() + 1}-${tomorrow.getDate()}`);
    expect(watchedToday()).toBe(false); // another day's mark: "Watch today's ayah" again
  });

  it("Show other topics swaps the chips", async () => {
    show();
    const user = userEvent.setup();
    const group = screen.getByRole("group", { name: t.topicsLabel });
    const labels = () => within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== t.moreTopics).map((b) => b.textContent).join();
    const before = labels();
    let changed = false;
    for (let i = 0; i < 10 && !changed; i++) {
      await user.click(screen.getByRole("button", { name: t.moreTopics }));
      changed = labels() !== before;
    }
    expect(changed).toBe(true);
  });
});

describe("suggestionsFor", () => {
  it("is empty for nothing, puts phrases that start like the text first and offers topics too", () => {
    expect(suggestionsFor("  ", "en")).toEqual([]);
    const list = suggestionsFor("I feel", "en");
    expect(list.length).toBeLessThanOrEqual(5);
    expect(list[0].text.toLowerCase().startsWith("i feel")).toBe(true);
    const patience = suggestionsFor("patien", "en");
    expect(patience.map((s) => s.key)).toContain("t:patience");
    expect(patience.find((s) => s.key === "t:patience")?.q).toBe("patience");
  });

  it("a surah chip searches the surah's name and carries the surah, not a 1-10 range", () => {
    const kahf = suggestionsFor("kahf", "en").find((s) => s.key === "t:kahf");
    expect(kahf?.q).toBe("Surah Al-Kahf");
    expect(kahf?.chip?.surah).toBe(18);
  });

  it("falls back to searching the words as typed", () => {
    expect(suggestionsFor("qqqq", "en")).toEqual([{ key: "search", text: t.homeSearchFor("qqqq"), q: "qqqq" }]);
  });
});
