// All surahs: the searchable list, the reciter sheet (kept on the device) and Continue, with the network stood in for.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Surah } from "../../../../../contracts/types";
import surahList from "../../../public/data/surahs.json";
import { RECITERS } from "../../config";
import { getRoute, initRouter } from "../../router";
import { createStore } from "../../state";
import { takeSurahStart } from "../../surah";
import { StoreContext } from "../hooks";
import { Surahs } from "./Surahs";

vi.mock("../../analytics", () => ({ anon: "test", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../../api", async (original) => ({ ...(await original<typeof import("../../api")>()), loadAyahGroups: async () => {} }));

const surahs = surahList as Surah[];

function mount() {
  history.replaceState(null, "", "/surahs");
  initRouter();
  const store = createStore();
  store.dispatch({ type: "booted", config: null, surahs, recipe: null });
  const ui = (<StoreContext.Provider value={store}><Surahs active /></StoreContext.Provider>);
  return render(ui);
}

beforeEach(() => {
  localStorage.removeItem("qd.surahProgress");
  localStorage.removeItem("qd.surahReciter");
  takeSurahStart();
});

describe("All surahs", () => {
  it("lists all 114 surahs with their ayah counts and Arabic names", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "All surahs" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "114 surahs" })).toBeTruthy();
    const rows = screen.getAllByRole("button").filter((b) => b.classList.contains("srh-row"));
    expect(rows).toHaveLength(114);
    expect(within(rows[66]).getByText("Al-Mulk")).toBeTruthy();
    expect(within(rows[66]).getByText("30 ayahs")).toBeTruthy();
    expect(within(rows[66]).getByText(surahs[66].name_ar)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Continue" })).toBeNull();
  });

  it("filters by name (any spelling), number and Arabic name", async () => {
    const user = userEvent.setup();
    mount();
    const box = screen.getByRole("searchbox", { name: "Search a surah" });
    expect(box.getAttribute("placeholder")).toBe("Search a surah or its number");
    const names = () => screen.getAllByRole("button").filter((b) => b.classList.contains("srh-row")).map((b) => b.querySelector("strong")!.textContent);
    await user.type(box, "mulk");
    expect(names()).toEqual(["Al-Mulk"]);
    expect(screen.getByRole("heading", { name: "1 surah" })).toBeTruthy();
    await user.clear(box);
    await user.type(box, "ya-sin");
    expect(names()).toEqual(["Yaseen"]);
    await user.clear(box);
    await user.type(box, "55");
    expect(names()).toEqual([surahs[54].name_en]);
    await user.clear(box);
    await user.type(box, "المُلۡك");
    expect(names()).toEqual(["Al-Mulk"]);
    await user.clear(box);
    await user.type(box, "zzzz");
    expect(screen.getByText("No surah matches that.")).toBeTruthy();
  });

  it("a row plays the surah from its first ayah with the chosen reciter", async () => {
    const user = userEvent.setup();
    localStorage.setItem("qd.surahReciter", RECITERS[2][0]);
    mount();
    await user.click(screen.getByRole("button", { name: "Play Al-Kahf" }));
    expect(getRoute().view).toBe("feed");
    const handed = takeSurahStart()!;
    expect(handed.surah.n).toBe(18);
    expect(handed.reciter).toBe(RECITERS[2][0]);
    expect(handed.items[0].ref).toBe("18:1");
  });

  it("the reciter chip opens a sheet; choosing one is kept for whole surahs", async () => {
    const user = userEvent.setup();
    mount();
    const chip = screen.getByRole("button", { name: `Reciter: ${RECITERS[0][1]}. Change` });
    await user.click(chip);
    expect(getRoute().sheet).toBe("surahReciter");
    const group = await screen.findByRole("radiogroup", { name: "Reciter" });
    expect(within(group).getByRole("radio", { name: RECITERS[0][1] }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(group).getByRole("radio", { name: RECITERS[3][1] }));
    expect(localStorage.getItem("qd.surahReciter")).toBe(RECITERS[3][0]);
    await waitFor(() => expect(getRoute().sheet).toBeNull());
    expect(screen.getByRole("button", { name: `Reciter: ${RECITERS[3][1]}. Change` })).toBeTruthy();
  });

  it("Continue shows the surah in progress and resumes it; its row resumes too, the others start at ayah 1", async () => {
    const user = userEvent.setup();
    const reciter = RECITERS[1][0];
    localStorage.setItem("qd.surahProgress", JSON.stringify({ surah: 67, ayah: 12, reciter }));
    mount();
    const section = within(screen.getByRole("heading", { name: "Continue" }).closest("section")!);
    expect(section.getByText("Al-Mulk · from ayah 12")).toBeTruthy();
    await user.click(section.getByRole("button", { name: "Continue Al-Mulk from ayah 12" }));
    expect(getRoute().view).toBe("feed");
    const handed = takeSurahStart()!;
    expect(handed.reciter).toBe(reciter);
    expect(Number(handed.items[0].ref.split(":")[1])).toBeLessThanOrEqual(12);
    expect(handed.items[0].ref).not.toBe("67:1");
  });
});
