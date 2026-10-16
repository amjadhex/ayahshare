// The feed's mix (real data/topics.json): the day leads, moods steer, popular and personal ayahs come in, nothing
// repeats, consecutive reels look different, sensitive ayahs only get calm backgrounds.
import { describe, expect, it } from "vitest";
import type { Clip, TopicsFile } from "../../../contracts/types";
import topicsFile from "../public/data/topics.json";
import { createMixer, isCalm, MOODS, pickBackground, reelRecipe, type FeedItem } from "./feed";
import { empty } from "./signals";
import { TOPICS } from "./topics";

const topics = (topicsFile as TopicsFile).topics;
/** A repeatable random sequence. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const TUESDAY_NOON = new Date(2026, 9, 6, 12, 0); // no moment (Rabi' al-Thani)
const FRIDAY_NOON = new Date(2026, 9, 9, 12, 0);
const take = (m: ReturnType<typeof createMixer>, n: number) => Array.from({ length: n }, () => m.next()).filter((x): x is FeedItem => !!x);
const base = { topics, trending: [] as string[], now: TUESDAY_NOON, signals: empty(), favourites: [] as string[], mood: null as string | null };

describe("feed mix", () => {
  it("every mood has a label (topic chip) and topics that exist", () => {
    const ids = new Set(topics.map((tp) => tp.id));
    for (const m of MOODS) {
      expect(TOPICS.some((tp) => tp.id === m.id), m.id).toBe(true);
      expect(m.topics.filter((id) => ids.has(id)).length, m.id).toBeGreaterThan(0);
    }
  });

  it("50 reels: no repeats, varied surahs, consecutive reels never share a look", () => {
    const items = take(createMixer({ ...base, random: seeded(1) }), 50);
    expect(items).toHaveLength(50);
    expect(new Set(items.map((i) => i.ref)).size).toBe(50);
    expect(new Set(items.map((i) => i.surah)).size).toBeGreaterThan(20);
    // Entry/exit animations only (the typewriter was removed), all four of them in the mix.
    expect(new Set(items.map((i) => i.animation))).toEqual(new Set(["none", "fade", "rise", "zoom"]));
    for (let i = 1; i < items.length; i++) {
      expect(items[i].effect !== items[i - 1].effect || items[i].animation !== items[i - 1].animation).toBe(true);
      expect(items[i].surah === items[i - 1].surah && items[i].ayah === items[i - 1].ayah).toBe(false);
    }
  });

  it("Friday leads with Surah Al-Kahf", () => {
    const [first, ...rest] = take(createMixer({ ...base, now: FRIDAY_NOON, random: seeded(2) }), 20);
    expect(first.surah).toBe(18);
    expect(first.reason).toEqual({ kind: "moment", moment: "friday" });
    expect(rest.filter((i) => i.surah === 18).length).toBeGreaterThan(2);
  });

  it("a mood steers most reels to its topics", () => {
    const mood = MOODS.find((m) => m.id === "grief")!;
    const refs = new Set(topics.filter((tp) => mood.topics.includes(tp.id)).flatMap((tp) => tp.refs));
    const items = take(createMixer({ ...base, mood: "grief", random: seeded(3) }), 20);
    expect(items[0].reason).toEqual({ kind: "mood", mood: "grief" });
    expect(items.filter((i) => refs.has(i.ref)).length).toBeGreaterThanOrEqual(14);
  });

  it("popular ayahs and the person's own interests come in; recently seen ones and this visit's do not", () => {
    const signals = { ...empty(), refs: { "2:286": 3, "65:3": 2 }, seen: { "94:5": TUESDAY_NOON.getTime() - 3600_000 } };
    const items = take(createMixer({ ...base, trending: ["94:5", "2:255", "39:53"], signals, favourites: ["13:28"], random: seeded(4), exclude: ["39:53"] }), 40);
    const refs = items.map((i) => i.ref);
    expect(refs).not.toContain("94:5"); // shown an hour ago
    expect(refs).not.toContain("39:53"); // already in the feed this visit
    expect(items.some((i) => i.reason.kind === "popular")).toBe(true);
    expect(items.filter((i) => i.reason.kind === "you").length).toBeGreaterThan(4);
  });

  it("skipped ayahs pull their topics down", () => {
    const signals = { ...empty(), refs: Object.fromEntries(topics.find((tp) => tp.id === "anxiety")!.refs.map((r) => [r, -3])) };
    const items = take(createMixer({ ...base, signals, random: seeded(5) }), 30);
    expect(items.some((i) => i.reason.kind === "you")).toBe(false);
  });
});

describe("feed backgrounds", () => {
  const clip = (id: string, tags: string[]): Clip => ({
    id, duration: 8, caption: tags.join(", "), tags, thumb: "", video: { portrait: "", landscape: "" }, poster: { portrait: "", landscape: "" },
  });
  const storm = clip("storm", ["thunder", "storm", "weather"]);
  const dark = clip("dark", ["forest", "fog", "dark", "mysterious"]);
  const sky = clip("sky", ["sky", "clouds", "calm"]);
  const sea = clip("sea", ["sea", "waves", "ocean"]);

  it("calm means nothing stormy or dark, and something peaceful", () => {
    expect([storm, dark, sky, sea].map(isCalm)).toEqual([false, false, true, true]);
  });

  it("a sensitive ayah gets a calm clip or a dark colour, never its stormy suggestions", () => {
    expect(pickBackground([storm, dark, sky], true, [], 0)).toEqual({ type: "clip", id: "sky" });
    expect(pickBackground([storm, dark], true, [], 0)).toMatchObject({ type: "colour" });
    expect(pickBackground([storm, dark], false, [], 0)).toEqual({ type: "clip", id: "storm" });
  });

  it("the best suggestion not used by the last reels", () => {
    expect(pickBackground([sky, sea], false, ["sky"], 0)).toEqual({ type: "clip", id: "sea" });
    expect(pickBackground([sky], false, ["sky"], 0)).toEqual({ type: "clip", id: "sky" });
  });

  it("the reel's design: the person's translation, one ayah, portrait, its look", () => {
    const item: FeedItem = { key: "k", ref: "94:5", surah: 94, ayah: 5, reason: { kind: "discover" }, effect: "glass", animation: "rise" };
    expect(reelRecipe(item, "ur.jalandhry", { type: "clip", id: "sky" })).toMatchObject({
      surah: 94, from: 5, to: 5, translation: "ur.jalandhry", orientation: "portrait", effect: "glass", animation: "rise", bg: { type: "clip", id: "sky" },
      autoContrast: true, // every reel stays readable
    });
  });

  it("interests picked on the profile weigh the mix: most reels come from those topics, still without repeats", () => {
    const picked = ["parents", "gratitude"];
    const refs = new Set(topics.filter((tp) => picked.includes(tp.id)).flatMap((tp) => tp.refs));
    const share = (interests: string[]) => {
      let n = 0;
      for (let seed = 1; seed <= 5; seed++) n += take(createMixer({ ...base, interests, random: seeded(seed) }), 20).filter((i) => refs.has(i.ref)).length;
      return n / 100;
    };
    const withInterests = share(picked), without = share([]);
    expect(withInterests).toBeGreaterThan(0.45);
    expect(withInterests).toBeGreaterThan(without * 3);
    const items = take(createMixer({ ...base, interests: picked, random: seeded(9) }), 40);
    expect(new Set(items.map((i) => i.ref)).size).toBe(40);
    expect(items.filter((i) => i.reason.kind === "you").length).toBeGreaterThan(15);
  });

  it("a reel uses the reciter preference", () => {
    const item = take(createMixer({ ...base, random: seeded(2) }), 1)[0];
    expect(reelRecipe(item, "en.sahih", { type: "colour", colour: "#000000" }, "Husary_128kbps").reciter).toBe("Husary_128kbps");
    expect(reelRecipe(item, "en.sahih", { type: "colour", colour: "#000000" }).reciter).toBe("Alafasy_128kbps");
  });
});
