// Discover's choices with the real topic files: the ayah of the day is the same for everyone on the same date, topic
// chips find their ayahs, and the reels Discover hands over are taken once.
import { describe, expect, it } from "vitest";
import type { TopicsFile } from "../../../contracts/types";
import topicsFile from "../public/data/topics.json";
import { dailyCandidates, dayNumber, refsOfChip, seeded } from "./discover";
import { createMixer, hasReelStart, KAHF, startReelsWith, takeReelStart, type FeedItem } from "./feed";
import { empty } from "./signals";
import { TOPICS } from "./topics";

const topics = (topicsFile as TopicsFile).topics;
const TUESDAY = new Date(2026, 9, 6, 9, 0); // no special day (Rabi' al-Thani)
const FRIDAY = new Date(2026, 9, 9, 9, 0);
const item = (ref: string, i: number): FeedItem => ({ key: `${ref}#${i}`, ref, surah: +ref.split(":")[0], ayah: +ref.split(":")[1], reason: { kind: "discover" }, effect: "glass", animation: "rise" });

describe("ayah of the day", () => {
  it("is the same list all day and in every time zone's evening, and another on the next day", () => {
    const morning = dailyCandidates(topics, new Date(2026, 9, 6, 6, 0));
    expect(dailyCandidates(topics, new Date(2026, 9, 6, 23, 59))).toEqual(morning);
    expect(dailyCandidates(topics, new Date(2026, 9, 7, 6, 0))).not.toEqual(morning);
    expect(morning.length).toBeGreaterThanOrEqual(10);
    expect(new Set(morning).size).toBe(morning.length);
  });

  it("the time of day does not change it, even on a Thursday evening (the Islamic Friday starts then)", () => {
    expect(dailyCandidates(topics, new Date(2026, 9, 8, 9, 0))).toEqual(dailyCandidates(topics, new Date(2026, 9, 8, 20, 0)));
  });

  it("Friday leads with Surah Al-Kahf", () => {
    expect(KAHF).toContain(dailyCandidates(topics, FRIDAY)[0]);
  });

  it("every candidate is an ayah the topic files rank", () => {
    const ranked = new Set(topics.flatMap((tp) => tp.refs));
    for (const ref of dailyCandidates(topics, TUESDAY)) expect(ranked.has(ref), ref).toBe(true);
  });

  it("the day number is the local calendar day", () => {
    expect(dayNumber(new Date(2026, 9, 6, 0, 1))).toBe(dayNumber(new Date(2026, 9, 6, 23, 59)));
    expect(dayNumber(new Date(2026, 9, 7, 0, 1))).toBe(dayNumber(new Date(2026, 9, 6, 23, 59)) + 1);
    const a = seeded(5), b = seeded(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("topic chips", () => {
  it("every chip finds ayahs: its own reference, its topic list, or its mood's", () => {
    const missing = TOPICS.filter((tp) => !tp.ref && refsOfChip(tp.id, topics).length === 0).map((tp) => tp.id);
    expect(missing).toEqual([]);
  });

  it("a chip with a different id from its list uses that list", () => {
    expect(refsOfChip("anxious", topics)).toEqual(topics.find((tp) => tp.id === "anxiety")!.refs);
    expect(refsOfChip("sleep", topics)).toEqual(topics.find((tp) => tp.id === "sleep")!.refs);
  });
});

describe("reels handed to the feed", () => {
  it("are taken once, in the order given", () => {
    takeReelStart();
    expect(hasReelStart()).toBe(false);
    const list = [item("94:5", 0), item("2:153", 1)].map((i) => ({ item: i, bg: { type: "colour" as const, colour: "#000000" } }));
    startReelsWith(list);
    expect(hasReelStart()).toBe(true);
    expect(takeReelStart()).toEqual(list);
    expect(takeReelStart()).toBeNull();
    startReelsWith([]);
    expect(hasReelStart()).toBe(false);
  });

  it("the mix goes on after them: no repeats, and the looks keep rotating from where they stopped", () => {
    const handed = ["94:5", "94:6", "2:153"];
    const rnd = seeded(3);
    const mixer = createMixer({ topics, trending: [], now: TUESDAY, signals: empty(), favourites: [], mood: null, exclude: handed, startAt: handed.length, random: rnd });
    const next = Array.from({ length: 12 }, () => mixer.next()!);
    expect(next.some((n) => handed.includes(n.ref))).toBe(false);
    const fresh = createMixer({ topics, trending: [], now: TUESDAY, signals: empty(), favourites: [], mood: null, random: seeded(3) });
    // startAt only shifts the look rotation (animations cycle every 4; every reel has the Shade effect).
    expect(next[0].key.endsWith("#3")).toBe(true);
    expect(fresh.next()!.key.endsWith("#0")).toBe(true);
    expect(next[0].effect).toBe("shade");
  });
});
