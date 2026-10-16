// Watched story circles: grey and at the back for a day, then new again.
import { beforeEach, describe, expect, it } from "vitest";
import { markCircleSeen, orderCircles, seenCircles } from "./seenStories";

const DAY = 24 * 3600 * 1000;
beforeEach(() => localStorage.clear());

describe("seen story circles", () => {
  it("a watched circle is remembered for a day", () => {
    markCircleSeen("patience", 1000);
    expect(seenCircles(1000 + DAY - 1).has("patience")).toBe(true);
    expect(seenCircles(1000 + DAY).has("patience")).toBe(false);
  });

  it("circles not seen yet come first; seen ones stay at the back", () => {
    const c = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    expect(orderCircles(c, new Set(["a", "c"]), 2).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
    expect(orderCircles(c, new Set(), 3).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
