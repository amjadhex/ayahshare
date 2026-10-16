import { describe, expect, it } from "vitest";
import { VOICES } from "../../../contracts/voices";
import { ayahWindow, partState, sectionAt, sectionWindows, type PartSpec, type TextPlan } from "./compose";
import { DEFAULT_RECIPE, sanitizeRecipe } from "./config";
import { initialState, reducer } from "./state";
import { audioTracks, fitVoice, trackTiming, voiceFor, voiceOf, voicesFor } from "./voice";

const design = (surah: number, translation: string, voice: string) => ({ ...DEFAULT_RECIPE, surah, translation, voice, reciter: "Alafasy_128kbps" });
const shape = (r: ReturnType<typeof design>, nums: number[]) =>
  audioTracks(r, nums).map((tk) => `${nums[tk.ayah]}:${tk.kind === "voice" ? "voice" : "recitation"}:${tk.url.replace(/^https?:\/\/[^/]+/, "")}`);

describe("the voices", () => {
  it("each has a unique id, a language, a narrator, the edition it reads and a source with the ayah in it", () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
    for (const v of VOICES) {
      expect(v.lang).toMatch(/^[a-z]{2}$/);
      expect(v.narrator.length).toBeGreaterThan(2);
      expect(v.text.startsWith(`${v.lang}.`)).toBe(true);
      expect(v.source).toMatch(/^(https:\/\/(cdn\.islamic\.network|everyayah\.com)\/|media:voice\/).*(\{N\}|\{SSS\}\{AAA\})\.mp3$/);
    }
    // Quran Lalithasaram: 21 pairs of ayahs share one sentence and one recording.
    expect(VOICES.find((v) => v.id === "ml.lalithasaram")!.joined).toHaveLength(21);
  });

  it("are offered by language: the one reading the design's translation first", () => {
    expect(voicesFor("hi")).toEqual([]);
    expect(voiceFor("en", "en.yusufali")?.id).toBe("en.walk");
    expect(voiceFor("fa", "fa.fooladvand")?.id).toBe("fa.hedayatfarfooladvand");
    expect(voiceFor("fa", "fa.makarem")?.id).toBe("fa.kabiri");
    // Only voices whose text the translation list has.
    expect(voicesFor("fa", { "fa.makarem": {} }).map((v) => v.id)).toEqual(["fa.kabiri"]);
  });
});

describe("a design's translation voice", () => {
  it("is on only with the translation it reads", () => {
    expect(voiceOf(design(94, "en.sahih", "en.walk"))?.narrator).toBe("Ibrahim Walk");
    expect(voiceOf(design(94, "en.yusufali", "en.walk"))).toBeNull();
    expect(voiceOf(design(94, "en.sahih", "none"))).toBeNull();
    expect(fitVoice(design(94, "en.yusufali", "en.walk")).voice).toBe("none");
    expect(fitVoice(design(94, "ml.lalithasaram", "ml.lalithasaram")).voice).toBe("ml.lalithasaram");
  });

  it("links and saved designs: a known voice with its own translation is kept, anything else is off", () => {
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, translation: "ur.jalandhry", voice: "ur.khan" }).voice).toBe("ur.khan");
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, translation: "ur.ahmedali", voice: "ur.khan" }).voice).toBe("none");
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, voice: "en.robot" }).voice).toBe("none");
    const { voice: _, ...older } = DEFAULT_RECIPE;
    expect(sanitizeRecipe(older).voice).toBe("none");
  });

  it("changing the translation to another one turns the voice off; turning it on brings its translation", () => {
    let s = initialState();
    s = reducer(s, { type: "patch", patch: { voice: "en.walk", translation: "en.sahih" } });
    expect(s.recipe).toMatchObject({ voice: "en.walk", translation: "en.sahih" });
    s = reducer(s, { type: "patch", patch: { reciter: "Husary_128kbps" } });
    expect(s.recipe.voice).toBe("en.walk");
    s = reducer(s, { type: "patch", patch: { translation: "en.pickthall" } });
    expect(s.recipe.voice).toBe("none");
  });
});

describe("the audio in playing order", () => {
  it("each ayah's recitation, then its translation read (94:5–6 in English)", () => {
    expect(shape(design(94, "en.sahih", "en.walk"), [5, 6])).toEqual([
      "5:recitation:/audio/Alafasy_128kbps/094005.mp3", "5:voice:/audio/voice/en.walk/094005.mp3",
      "6:recitation:/audio/Alafasy_128kbps/094006.mp3", "6:voice:/audio/voice/en.walk/094006.mp3",
    ]);
    expect(shape(design(94, "en.sahih", "none"), [5, 6])).toEqual(["5:recitation:/audio/Alafasy_128kbps/094005.mp3", "6:recitation:/audio/Alafasy_128kbps/094006.mp3"]);
  });

  it("Malayalam from our own media; two ayahs sharing one sentence are read once, after the second", () => {
    const ml = (surah: number) => design(surah, "ml.lalithasaram", "ml.lalithasaram");
    expect(shape(ml(1), [1, 2, 3])).toEqual([
      "1:recitation:/audio/Alafasy_128kbps/001001.mp3", "1:voice:/media/voice/ml.lalithasaram/001001.mp3",
      "2:recitation:/audio/Alafasy_128kbps/001002.mp3", "2:voice:/media/voice/ml.lalithasaram/001002.mp3",
      "3:recitation:/audio/Alafasy_128kbps/001003.mp3", "3:voice:/media/voice/ml.lalithasaram/001003.mp3",
    ]);
    // 3:3–4 is one sentence: no voice after 3:3, one after 3:4.
    expect(shape(ml(3), [3, 4, 5]).map((x) => x.split(":/")[0])).toEqual(["3:recitation", "4:recitation", "4:voice", "5:recitation", "5:voice"]);
    // Only one of the pair in the design: read after that one.
    expect(shape(ml(3), [2, 3]).map((x) => x.split(":/")[0])).toEqual(["2:recitation", "2:voice", "3:recitation", "3:voice"]);
    expect(shape(ml(3), [4, 5]).map((x) => x.split(":/")[0])).toEqual(["4:recitation", "4:voice", "5:recitation", "5:voice"]);
  });

  it("the text's timeline: each ayah from its recitation to the end of its voice; the video is all of them plus the tail", () => {
    const tracks = audioTracks(design(94, "en.sahih", "en.walk"), [5, 6]);
    const { timing, at, total } = trackTiming(tracks, [4, 3, 5, 2], 2, "fade", 1.5);
    expect(at).toEqual([0, 4, 7, 12]);
    expect(total).toBe(14);
    expect(timing).toEqual({ starts: [0, 7], durations: [4, 5], voices: [3, 2], animation: "fade", end: 15.5 });
    expect(ayahWindow(timing, 0)).toEqual([0, 7]);
    expect(ayahWindow(timing, 1)).toEqual([7, 15.5]);
    expect(ayahWindow({ ...timing, end: undefined }, 1)).toEqual([7, 14]);
    // Without a voice: as before.
    expect(trackTiming(audioTracks(design(94, "en.sahih", "none"), [5, 6]), [4, 5], 2, "none", 1.5).timing)
      .toEqual({ starts: [0, 4], durations: [4, 5], animation: "none", end: 10.5 });
    // A pair read once: the first ayah has no voice of its own.
    const joined = audioTracks(design(3, "ml.lalithasaram", "ml.lalithasaram"), [3, 4]);
    expect(trackTiming(joined, [6, 5, 9], 2, "fade", 1.5).timing).toMatchObject({ starts: [0, 6], durations: [6, 5], voices: [0, 9] });
  });

  it("the ayah's text stays through its voice and leaves as the voice ends", () => {
    const p: PartSpec = { ayah: 0, kind: "ar", x: 0, y: 0 };
    const plan = { width: 1080, height: 1920, parts: [p, { ...p, ayah: 1 }], sections: [[0], [0]] } as unknown as TextPlan;
    const { timing } = trackTiming(audioTracks(design(94, "en.sahih", "en.walk"), [5, 6]), [4, 3, 5, 2], 2, "fade", 1.5);
    expect(partState(plan, p, timing, 5.5).alpha).toBe(1); // the voice is reading ayah 0
    expect(partState(plan, p, timing, 6.9).alpha).toBeLessThan(0.5); // leaving as the voice ends
    expect(partState(plan, p, timing, 7.1).alpha).toBe(0);
    expect(partState(plan, plan.parts[1], timing, 13).alpha).toBe(1);
  });

  it("a long ayah's parts come again while the voice reads, each for its share", () => {
    const plan = { sections: [[0, 0.5]] } as Pick<TextPlan, "sections">;
    const timing = { starts: [0], durations: [10], voices: [6], animation: "none" as const, end: 17.5 };
    expect(sectionWindows(plan, timing, 0, 0)).toEqual([[0, 5], [10, 13]]);
    expect(sectionWindows(plan, timing, 0, 1)).toEqual([[5, 10], [13, 17.5]]);
    expect([1, 6, 11, 14, 17].map((t) => sectionAt(plan, timing, 0, t))).toEqual([0, 1, 0, 1, 1]);
  });
});
