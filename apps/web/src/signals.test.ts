import { beforeEach, describe, expect, it } from "vitest";
import { loadSignals, recordMood, recordSearch, recordSeen, recordWatch, resetSignals } from "./signals";

describe("feed signals (on the device)", () => {
  beforeEach(() => { localStorage.clear(); resetSignals(); });

  it("searches make their top ayahs interests; moods are counted", () => {
    recordSearch("  patience ", ["2:153", "39:10", "3:200", "2:45", "8:46", "16:127"]);
    recordSearch("patience", ["2:153"]);
    const s = loadSignals();
    expect(s.searches).toEqual(["patience"]);
    expect(s.refs["2:153"]).toBe(2);
    expect(s.refs["8:46"]).toBeCloseTo(0.4);
    expect(s.refs["16:127"]).toBeUndefined(); // only the top 5
    recordMood("hope");
    recordMood("hope");
    expect(loadSignals().moods).toEqual({ hope: 2 });
  });

  it("watched to the end → more like it; left within 2 s → a skip; in between → nothing", () => {
    recordWatch("94:5", 9000, 10_000);
    recordWatch("94:6", 900, 10_000);
    recordWatch("94:7", 4000, 10_000);
    expect(loadSignals().refs).toEqual({ "94:5": 1.5, "94:6": -1 });
  });

  it("survives a reload and stays small", () => {
    for (let i = 1; i <= 700; i++) recordSeen([`2:${(i % 286) + 1}`, `3:${(i % 200) + 1}`], i);
    const raw = JSON.parse(localStorage.getItem("qd.signals")!);
    expect(Object.keys(raw.seen).length).toBeLessThanOrEqual(600);
    expect(raw.seen["2:1"]).toBe(572); // the latest time it was shown (i = 286, 572)
  });
});
