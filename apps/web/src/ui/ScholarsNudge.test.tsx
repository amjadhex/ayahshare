import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReflectionPost, ReflectionsResponse } from "../../../../contracts/types";
import * as api from "../api";
import { NUDGE_AFTER_MS, NUDGE_LAST_MS, NUDGE_OUT_MS, NUDGE_TURN_MS, resetScholars, ScholarsNudge } from "./ScholarsNudge";

const post = (id: number, name: string, verified: boolean, avatar: string | null = null): ReflectionPost => ({
  id, body: "", author: name.toLowerCase().replace(/\s+/g, ""), likes: 0, lang: "en", date: "", url: "",
  by: { name, username: name.toLowerCase().replace(/\s+/g, ""), verified, avatar },
});
const page = (posts: ReflectionPost[]): ReflectionsResponse => ({ ref: "23:68", lang: "en", total: posts.length, page: 1, pages: 1, posts });

beforeEach(() => {
  vi.useFakeTimers();
  resetScholars();
  vi.spyOn(api, "getLessons").mockResolvedValue(page([post(1, "Maryam Amir", true, "/api/avatar/ma"), post(2, "Prophetic Commentary", true), post(3, "Someone", false)]));
  vi.spyOn(api, "getReflections").mockResolvedValue(page([post(4, "Maryam Amir", true), post(5, "Syaari Ab Rahman", true), post(6, "Another", true)]));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("ScholarsNudge", () => {
  it("after a while of playing, the verified authors' names come in turn beside Reflect, then go; a tap opens Reflect", async () => {
    const onShown = vi.fn(), onOpen = vi.fn();
    render(<ScholarsNudge refId="23:68" lang="en" playing allow={() => true} onShown={onShown} onOpen={onOpen} />);
    await advance(NUDGE_AFTER_MS - 100);
    expect(screen.queryByRole("button")).toBeNull();
    await advance(100);
    const nudge = screen.getByRole("button", { name: "Scholars' notes on this ayah from Maryam Amir and 3 more. Open Reflect" });
    expect(onShown).toHaveBeenCalledTimes(1);
    expect(nudge.querySelector(".sn-name")!.textContent).toBe("Maryam Amir"); // each author once, the unverified left out
    expect(nudge.querySelector(".sn-more")!.textContent).toBe("and 3 more reflected on this");
    expect([...nudge.querySelectorAll(".sn-faces > span")].map((s) => s.classList.contains("on"))).toEqual([true, false, false]); // three faces
    expect(nudge.querySelector(".sn-faces img")).toBeTruthy(); // a photo through our Worker, else initials
    await advance(NUDGE_TURN_MS);
    expect(nudge.querySelector(".sn-name")!.textContent).toBe("Prophetic Commentary");
    await advance(NUDGE_TURN_MS);
    expect(nudge.querySelector(".sn-name")!.textContent).toBe("Syaari Ab Rahman");
    fireEvent.click(nudge);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await advance(NUDGE_TURN_MS + NUDGE_LAST_MS);
    expect(screen.getByRole("button").classList.contains("out")).toBe(true);
    await advance(NUDGE_OUT_MS);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts playing time only, and does not load or show where it is not allowed or the ayah has no scholars' notes", async () => {
    const view = render(<ScholarsNudge refId="23:68" lang="en" playing={false} allow={() => true} onShown={() => {}} onOpen={() => {}} />);
    await advance(NUDGE_AFTER_MS * 2);
    expect(screen.queryByRole("button")).toBeNull(); // paused: the clock does not run
    view.rerender(<ScholarsNudge refId="23:68" lang="en" playing allow={() => true} onShown={() => {}} onOpen={() => {}} />);
    await advance(NUDGE_AFTER_MS);
    expect(screen.getByRole("button")).toBeTruthy();
    view.unmount();

    vi.mocked(api.getLessons).mockClear();
    render(<ScholarsNudge refId="1:1" lang="en" playing allow={() => false} onShown={() => {}} onOpen={() => {}} />);
    await advance(NUDGE_AFTER_MS);
    expect(api.getLessons).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();

    vi.mocked(api.getLessons).mockResolvedValue(page([post(7, "Someone", false)]));
    vi.mocked(api.getReflections).mockResolvedValue(page([]));
    render(<ScholarsNudge refId="2:2" lang="en" playing allow={() => true} onShown={() => {}} onOpen={() => {}} />);
    await advance(NUDGE_AFTER_MS);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
