// Translation voice (owner, 8 Oct 2026): after each ayah's recitation, a recorded human voice reads its translation,
// then the next ayah comes; the background stays. The voices and where their files come from are in contracts/voices.ts
// (shared with the Worker). This module turns a design into its audio in playing order and that audio's lengths into the
// text's timeline, the same way for the preview, the Feed and the video export. Framework-free.
import type { Recipe } from "../../../contracts/types";
import { startsJoined, voiceById, voiceSource, VOICES, type Voice } from "../../../contracts/voices";
import { audioUrl, mediaUrl } from "./api";
import type { Animation, Timing } from "./compose";

export type { Voice };

/** The voices the admin turned off (admin Library, /api/config `off`); set once at start. */
let off = new Set<string>();
export const setVoicesOff = (ids: string[] = []) => { off = new Set(ids); };
const offered = (v: Voice | null) => (v && !off.has(v.id) ? v : null);

/** The design's voice, when it is on, offered and reads the design's translation (anything else plays the recitation
 *  only). */
export function voiceOf(r: Pick<Recipe, "voice" | "translation">): Voice | null {
  const v = offered(voiceById(r.voice));
  return v && v.text === r.translation ? v : null;
}

/** True when an offered voice reads this translation edition. */
export const isVoiced = (edition: string) => VOICES.some((v) => v.text === edition && !off.has(v.id));

/** The voices that read a translation in `lang`; with `editions` (the translation list once loaded), only those whose
 *  text the app can show. */
export const voicesFor = (lang: string, editions?: Record<string, unknown>) =>
  VOICES.filter((v) => v.lang === lang && !off.has(v.id) && (!editions || !Object.keys(editions).length || v.text in editions));

/** The voice to turn on for a design in `lang`: the one that reads the design's translation, else the language's first. */
export const voiceFor = (lang: string, translation: string, editions?: Record<string, unknown>) => {
  const list = voicesFor(lang, editions);
  return list.find((v) => v.text === translation) ?? list[0] ?? null;
};

/** A voice turned on shows the translation it reads; a translation changed to another one turns the voice off. */
export function fitVoice<R extends Pick<Recipe, "voice" | "translation">>(r: R): R {
  if (!r.voice || r.voice === "none" || voiceOf(r)) return r;
  return { ...r, voice: "none" };
}

/** Where the voice's file for surah:ayah is played from: our media bucket, or the Worker's voice proxy. */
export function voiceUrl(v: Voice, surah: number, ayah: number) {
  const src = voiceSource(v, surah, ayah);
  return src.startsWith("media:") ? mediaUrl(src.slice("media:".length)) : audioUrl(`voice/${v.id}`, surah, ayah);
}

/** One recording in the design's audio: ayah `ayah` (index into the design's ayahs) recited, or its translation read. */
export interface Track { ayah: number; kind: "recitation" | "voice"; url: string }

/** The design's audio in playing order: each ayah's recitation, then (voice on) the voice reading its translation. Two
 *  ayahs that share one sentence in the voice's translation (Voice.joined) share one recording: it is read once, after
 *  the second, when both are in the design (else after the one that is). */
export function audioTracks(r: Pick<Recipe, "voice" | "translation" | "reciter" | "surah">, nums: number[]): Track[] {
  const v = voiceOf(r);
  return nums.flatMap((num, i): Track[] => {
    const recitation: Track = { ayah: i, kind: "recitation", url: audioUrl(r.reciter, r.surah, num) };
    if (!v || (startsJoined(v, r.surah, num) && nums[i + 1] === num + 1)) return [recitation];
    return [recitation, { ayah: i, kind: "voice", url: voiceUrl(v, r.surah, num) }];
  });
}

/** Until a recording's length is known, it is estimated from its words. */
export const estimateTrack = (track: Track, ayahs: { ar: string; tr: string }[]) => {
  const a = ayahs[track.ayah];
  if (!a) return 1;
  return track.kind === "voice" ? 1 + a.tr.split(/\s+/).length * 0.42 : 1 + a.ar.split(/\s+/).length * 0.55;
};

/** The text's timeline for the tracks' lengths (`lengths[k]`, seconds): each ayah from the start of its recitation to the
 *  end of its voice, the last one through the tail. `at[k]`: when track k starts; `total`: the audio's length. */
export function trackTiming(tracks: Track[], lengths: number[], ayahCount: number, animation: Animation, tail: number) {
  const at: number[] = [];
  let total = 0;
  for (let k = 0; k < tracks.length; k++) { at.push(total); total += lengths[k] ?? 0; }
  const starts = Array<number>(ayahCount).fill(total), durations = Array<number>(ayahCount).fill(0), voices = Array<number>(ayahCount).fill(0);
  tracks.forEach((tk, k) => {
    if (tk.kind === "recitation") { starts[tk.ayah] = at[k]; durations[tk.ayah] = lengths[k] ?? 0; } else voices[tk.ayah] = lengths[k] ?? 0;
  });
  const timing: Timing = { starts, durations, ...(voices.some((v) => v > 0) ? { voices } : {}), animation, end: total + tail };
  return { timing, at, total };
}
