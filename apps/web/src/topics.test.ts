import { describe, expect, it } from "vitest";
import { assignClips } from "./results";
import type { Clip } from "../../../contracts/types";
import { SAY, SAY_ORDER } from "./topicPrompts";
import { chipLanguages, chipOf, hijriDate, momentChip, momentsAt, nextChip, pickChips, pickCollections, TOPICS } from "./topics";

// Fixed dates (local time). 2026-10-09 is a Friday; 2027-02-15 falls in Ramadan 1448; 2026-05-26 is 9 Dhul Hijjah
// 1447 (Arafah) by the Umm al-Qura calendar.
const seq = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("topic chips", () => {
  it("has a pool of about 60 topics, each written in every chip language", () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(55);
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    for (const t of TOPICS) for (const l of chipLanguages()) expect(t.l[l as keyof typeof t.l], `${t.id}/${l}`).toBeTruthy();
  });

  it("gives every topic a sentence in English and every chip language, shown in the chip's language", () => {
    for (const tp of TOPICS) {
      const say = SAY[tp.id];
      expect(say, tp.id).toBeDefined();
      for (const [i, line] of say.entries()) expect(line.trim(), `${tp.id}/${SAY_ORDER[i]}`).toBeTruthy();
    }
    expect(Object.keys(SAY).sort()).toEqual(TOPICS.map((tp) => tp.id).sort());
    const patience = TOPICS.find((tp) => tp.id === "patience")!;
    expect(chipOf(patience, "en")).toMatchObject({ label: "Patience", say: "I need patience", lang: "en", q: "patience" });
    expect(chipOf(patience, "ml")).toMatchObject({ label: "ക്ഷമ", say: SAY.patience[1], lang: "ml", q: "patience" });
    expect(chipOf(patience, "fr").say).toBe("I need patience");
  });

  it("shows 8 different chips per visit, and other ones with another random draw", () => {
    const a = pickChips(new Date(2026, 9, 7, 14), "en", 8, seq(1));
    const b = pickChips(new Date(2026, 9, 7, 14), "en", 8, seq(99));
    expect(a).toHaveLength(8);
    expect(new Set(a.map((c) => c.id)).size).toBe(8);
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
  });

  it("puts Surah Al-Kahf first on Friday, and morning or sleep chips by the time of day", () => {
    expect(pickChips(new Date(2026, 9, 9, 10), "en", 8, seq(3))[0]).toMatchObject({ id: "kahf", ref: "18:1-10" });
    expect(momentsAt(new Date(2026, 9, 8, 19))).toContain("thursdayNight");
    expect(pickChips(new Date(2026, 9, 7, 7), "en", 8, seq(4)).map((c) => c.id)).toContain("morning");
    expect(pickChips(new Date(2026, 9, 7, 23), "en", 8, seq(5)).map((c) => c.id)).toContain("sleep");
  });

  it("follows the Islamic calendar: Ramadan, Arafah", () => {
    const ramadan = new Date(2027, 1, 15, 13);
    if (hijriDate(ramadan)) {
      expect(hijriDate(ramadan)?.month).toBe(9);
      expect(pickChips(ramadan, "en", 8, seq(6)).slice(0, 3).map((c) => c.id)).toContain("ramadan");
    }
    const arafah = new Date(2026, 4, 26, 13);
    if (hijriDate(arafah)) expect(pickChips(arafah, "en", 8, seq(7)).slice(0, 3).map((c) => c.id)).toEqual(expect.arrayContaining(["arafah", "hajj"]));
  });

  it("speaks the translation's language where it can, else English; the search query stays English", () => {
    const ml = pickChips(new Date(2026, 9, 9, 10), "ml", 8, seq(8));
    expect(ml[0]).toMatchObject({ label: "വെള്ളിയാഴ്ച: സൂറത്തുൽ കഹ്ഫ്", lang: "ml" });
    const patience = TOPICS.find((t) => t.id === "patience")!;
    for (const [lang, label] of [["ar", "الصبر"], ["ur", "صبر"], ["hi", "सब्र"], ["id", "Sabar"], ["ml", "ക്ഷമ"]]) {
      expect(patience.l[lang as "ar"]).toBe(label);
    }
    expect(pickChips(new Date(2026, 9, 7, 14), "fr", 8, seq(9)).every((c) => c.lang === "en")).toBe(true);
    expect(pickChips(new Date(2026, 9, 7, 14), "ur", 8, seq(9)).every((c) => c.lang === "ur" && /^[a-z]/i.test(c.q))).toBe(true);
  });

  it("moment-only topics (Eid, Ramadan, before sleep) show only in their moment, in chips and collections", () => {
    const day = new Date(2026, 9, 7, 14); // a Wednesday afternoon, no special day
    for (let seed = 1; seed < 40; seed++) {
      const ids = [...pickChips(day, "en", 8, seq(seed)), ...pickCollections(day, "en", 10, [], seq(seed + 100))].map((c) => c.id);
      for (const id of ["eid", "sacrifice", "ramadan", "qadr", "sleep", "jumuah"]) expect(ids, `${id} seed ${seed}`).not.toContain(id);
    }
    expect(pickCollections(new Date(2026, 9, 7, 23), "en", 10, [], seq(3)).map((c) => c.id)).toContain("sleep"); // at night
    const stories = pickChips(day, "en", 7, seq(5)).map((c) => c.id);
    expect(pickCollections(day, "en", 10, stories, seq(6)).some((c) => stories.includes(c.id))).toBe(false); // no repeats
  });

  it("rotation brings a chip that is not on screen", () => {
    const shown = pickChips(new Date(2026, 9, 7, 14), "en", 8, seq(10)).map((c) => c.id);
    const next = nextChip(new Date(2026, 9, 7, 14), "en", shown, seq(11));
    expect(next && !shown.includes(next.id)).toBe(true);
  });
});

describe("result backgrounds", () => {
  const clip = (id: string) => ({ id }) as Clip;
  it("gives every result its own background, best suggestion first", () => {
    const got = assignClips(["2:153", "2:154", "3:200"], {
      "2:153": [clip("a"), clip("b")], "2:154": [clip("a"), clip("c")], "3:200": [clip("a")],
    });
    expect(Object.values(got).map((c) => c?.id)).toEqual(["a", "c", "a"]); // 3:200 has nothing else: reuses its best
    expect(assignClips(["1:1"], {})["1:1"]).toBeNull();
  });
});

describe("momentChip (Notifications: the moment's own ayahs)", () => {
  it("Friday's Al-Kahf on a Friday; nothing at an ordinary time", () => {
    expect(momentChip(new Date(2026, 9, 16, 12, 0), "en")?.id).toBe("kahf"); // a Friday, midday
    expect(momentChip(new Date(2026, 9, 14, 13, 0), "en")).toBeNull(); // a Wednesday afternoon
  });
});
