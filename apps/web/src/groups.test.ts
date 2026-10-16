import { afterEach, describe, expect, it } from "vitest";
import { groupItem, reelFor } from "./feed";
import { setAyahGroups, withGroups } from "./groups";

describe("ayah groups", () => {
  afterEach(() => setAyahGroups({}));

  it("widens a pick to the ayahs its meaning needs, and leaves standalone ayahs alone", () => {
    setAyahGroups({ "107:4": [4, 7], "107:5": [4, 7], "107:7": [4, 7], "1:6": [6, 7] });
    expect(withGroups(107, 4, 4)).toEqual({ from: 4, to: 7 });
    expect(withGroups(107, 5, 5)).toEqual({ from: 4, to: 7 }); // a pick inside a group starts at the group
    expect(withGroups(107, 4, 5)).toEqual({ from: 4, to: 7 }); // a range that cuts a group short
    expect(withGroups(107, 1, 1)).toEqual({ from: 1, to: 1 });
    expect(withGroups(2, 255, 255)).toEqual({ from: 255, to: 255 });
  });

  it("every ayah stands alone until the file is loaded", () => {
    expect(withGroups(107, 4, 4)).toEqual({ from: 4, to: 4 });
  });

  it("widens a reel and keeps its key", () => {
    setAyahGroups({ "107:5": [4, 7] });
    const item = reelFor("107:5", { kind: "discover" }, 0);
    expect(groupItem(item)).toMatchObject({ key: item.key, ref: "107:4", surah: 107, ayah: 4, to: 7 });
    const alone = reelFor("2:255", { kind: "discover" }, 0);
    expect(groupItem(alone)).toBe(alone);
  });
});
