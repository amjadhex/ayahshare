// The bell's dot: something new in Notifications since it was last opened.
import { beforeEach, describe, expect, it } from "vitest";
import { activityHasNew, markActivitySeen } from "./activitySeen";
import { dayKey } from "./today";

const impact = (opens: number) => ({ days: 7, opens, reshares: 0, makes: 0 });
beforeEach(() => localStorage.clear());

describe("the bell's dot", () => {
  it("a new day's ayah not watched yet is new; once opened, nothing is", () => {
    expect(activityHasNew(null)).toBe(true);
    markActivitySeen(null);
    expect(activityHasNew(null)).toBe(false);
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    expect(activityHasNew(null, tomorrow)).toBe(true);
    localStorage.setItem("qd.todayWatched", dayKey(tomorrow));
    expect(activityHasNew(null, tomorrow)).toBe(false); // watched it already (Home, Discover)
  });

  it("more opens of the person's links than when last opened is new", () => {
    markActivitySeen(impact(3));
    expect(activityHasNew(impact(3))).toBe(false);
    expect(activityHasNew(impact(5))).toBe(true);
    markActivitySeen(null); // signed out meanwhile: the numbers seen are kept
    expect(activityHasNew(impact(3))).toBe(false);
  });

  it("a newer announcement from AyahShare is new until Notifications is opened", () => {
    markActivitySeen(null, new Date(), 3);
    expect(activityHasNew(null, new Date(), 3)).toBe(false);
    expect(activityHasNew(null, new Date(), 4)).toBe(true);
    markActivitySeen(null, new Date(), 4);
    expect(activityHasNew(null, new Date(), 4)).toBe(false);
  });
});
