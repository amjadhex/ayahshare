// Reels' text size: Small, Medium or Large, kept on the device, applied to every reel's design.
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RECIPE } from "./config";
import { reelTextSize, sizedReel, storeReelTextSize } from "./reelText";
import { withReelTextSize } from "./reels";

beforeEach(() => localStorage.clear());

describe("reels' text size", () => {
  it("is Medium until another is chosen, and is kept on the device", () => {
    expect(reelTextSize()).toBe("medium");
    storeReelTextSize("large");
    expect(reelTextSize()).toBe("large");
    storeReelTextSize("medium");
    expect(localStorage.getItem("qd.reelTextSize")).toBeNull();
  });

  it("sets the Arabic and translation sizes from a new design's; Large grows the translation more", () => {
    const r = { ...DEFAULT_RECIPE, quranSize: 4, transSize: 3 };
    expect(sizedReel(r, "small")).toMatchObject({ quranSize: 3, transSize: 2 });
    expect(sizedReel(r, "medium")).toMatchObject({ quranSize: 4, transSize: 3 });
    expect(sizedReel(r, "large")).toMatchObject({ quranSize: 5, transSize: 5 });
    expect(sizedReel(sizedReel(r, "large"), "large")).toMatchObject({ quranSize: 5, transSize: 5 }); // not twice
  });

  it("the reels follow in place; nothing changes when the size is the same", () => {
    const reels = [{ item: {} as never, recipe: { ...DEFAULT_RECIPE } }];
    expect(withReelTextSize(reels)).toBe(reels);
    storeReelTextSize("large");
    const next = withReelTextSize(reels);
    expect(next).not.toBe(reels);
    expect(next[0].recipe).toMatchObject({ quranSize: 5, transSize: 5 });
  });
});
