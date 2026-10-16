// What Discover shows, chosen on the device with no AI call: the day's ayah (the same for everyone on the same date), the
// topic list behind each story and collection, the background each thumbnail shows (and the editor opens with), and
// short ayahs for a status. Ayah text always comes from the Quran API (api.ts), never from here. Framework-free.
import type { Clip, Recipe, Ref, Surah, Topic } from "../../../contracts/types";
import * as api from "./api";
import { stripBasmala } from "./design";
import { DISCOVER, KAHF, MOMENT_TOPICS, MOODS, pickBackground, SPECIAL } from "./feed";
import { momentsAt, type Moment } from "./topics";

const parse = (ref: Ref) => ref.split(":").map(Number) as [number, number];

// ---------- topic chips → topic lists ----------

/** Chips whose id is not a topic list's id (data/topics.json), and the list they use. The rest match by id, or through
 *  the mood with the same id (feed.ts). A test checks that every chip resolves. */
const TOPIC_ALIAS: Record<string, string> = {
  anxious: "anxiety", illness: "sickness", exams: "seeking-help", baby: "birth-of-child", trust: "trust-in-allah", lonely: "loneliness",
  morning: "dawn", evening: "night-and-day", peace: "peace-of-heart", decisions: "making-decisions", family: "family-ties", short: "life-is-short",
  nature: "signs-in-nature", near: "allah-is-near", tahajjud: "night-prayer", quran: "reciting-quran", work: "earning-a-living",
  fresh: "second-chance", protection: "protection-from-evil", oldage: "old-age", jumuah: "friday-prayer", qadr: "night-of-power",
  arafah: "hajj", eid: "joy", muharram: "sacred-months", hijra: "migration",
};

/** The ranked ayahs behind a topic chip (best first), or [] when the topic files have none. */
export function refsOfChip(id: string, topics: Topic[]): Ref[] {
  const byId = new Map(topics.map((tp) => [tp.id, tp]));
  const direct = byId.get(TOPIC_ALIAS[id] ?? id);
  if (direct?.refs.length) return direct.refs;
  for (const tid of MOODS.find((m) => m.id === id)?.topics ?? []) {
    const tp = byId.get(tid);
    if (tp?.refs.length) return tp.refs;
  }
  return [];
}

// ---------- repeatable shuffling ----------

/** Days since 1970 on the local calendar: the same number all day, wherever the person is. */
export const dayNumber = (now: Date) => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400_000);

/** A repeatable random sequence (mulberry32). */
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const unique = (refs: Ref[]) => [...new Set(refs)];
const UPLIFTING = ["hope", "peace", "gratitude", "patience", "forgiveness", "strength", "love", "dua"];

/** Topics for the date-based moments only: the time of day must not change the ayah of the day. */
const DAY_MOMENTS = SPECIAL.filter((m): m is Moment => m !== "thursdayNight");

// ---------- ayah of the day ----------

/** The day's candidates, best first, the same for everyone on the same date: Friday leads with Surah Al-Kahf, a special
 *  day (Ramadan, Arafah, Eid…) with its own topics, then the uplifting moods. The first one that fits the card is
 *  the ayah of the day (loadAyahOfTheDay). */
export function dailyCandidates(topics: Topic[], now: Date): Ref[] {
  const random = seeded(dayNumber(now));
  const byId = new Map(topics.map((tp) => [tp.id, tp]));
  const top = (ids: string[], n: number) => ids.flatMap((id) => byId.get(id)?.refs.slice(0, n) ?? []);
  const moments = momentsAt(now);
  const lists: Ref[][] = [];
  if (moments.has("friday")) lists.push(KAHF);
  for (const m of DAY_MOMENTS) if (moments.has(m) && m !== "friday") lists.push(top(MOMENT_TOPICS[m] ?? [], 6));
  lists.push(top(UPLIFTING.flatMap((id) => MOODS.find((m) => m.id === id)?.topics ?? []).concat(DISCOVER.slice(0, 6)), 6));
  return unique(lists.flatMap((l) => shuffled(unique(l), random))).slice(0, 14);
}

// ---------- backgrounds ----------

export interface Picked { bg: Recipe["bg"]; clip: Clip | null; sensitive: boolean }

async function suggestions(ref: Ref) {
  await api.loadCatalogue();
  const [surah, ayah] = parse(ref);
  const file = await api.getSurahBackgrounds(surah);
  const clips = (file?.ayahs[String(ayah)] ?? []).map((id) => api.clipById(id)).filter((c): c is Clip => !!c);
  return { clips, sensitive: !!file?.sensitive.includes(ayah) };
}

/** The backgrounds for these ayahs, each the ayah's best suggestion not used by the last few (like the reels do). */
export async function backgroundsFor(refs: Ref[]): Promise<Picked[]> {
  const all = await Promise.all(refs.map(suggestions));
  let recent: string[] = [];
  return all.map(({ clips, sensitive }, i) => {
    const bg = pickBackground(clips, sensitive, recent, i);
    if (bg.type === "clip") recent = [bg.id, ...recent].slice(0, 6);
    return { bg, clip: bg.type === "clip" ? api.clipById(bg.id) : null, sensitive };
  });
}

const singles = new Map<Ref, Promise<Picked>>();
/** One ayah's background (kept for the visit, so a thumbnail and the editor agree). */
export function backgroundFor(ref: Ref): Promise<Picked> {
  let p = singles.get(ref);
  if (!p) {
    p = backgroundsFor([ref]).then(([x]) => x);
    p.catch(() => singles.delete(ref)); // try again next time
    singles.set(ref, p);
  }
  return p;
}

// ---------- loading texts ----------

/** An ayah's Arabic (without the basmala some surahs start with) and, unless "none", its translation. */
export async function loadText(ref: Ref, translation: string): Promise<{ ar: string; tr: string }> {
  const [surah, ayah] = parse(ref);
  const [ar, tr] = await api.getAyahText(surah, ayah, ayah, translation);
  const a = ar.ayahs[0];
  if (!a) throw new Error(`no text for ${ref}`);
  return { ar: stripBasmala(a.text, surah, a.numberInSurah), tr: tr?.ayahs[0]?.text ?? "" };
}

/** Longest Arabic text the ayah of the day shows in its card, and the longest a short ayah has (characters, with marks). */
export const CARD_MAX = 170, SHORT_MAX = 60;
const TRIES = 6;

export interface DayAyah { ref: Ref; ar: string; tr: string; bg: Recipe["bg"]; clip: Clip | null }

/** The ayah of the day: the first candidate that is not sensitive and fits the card; failing that, the first one that
 *  loads. null when nothing loads. */
export async function loadAyahOfTheDay(topics: Topic[], now: Date, translation: string): Promise<DayAyah | null> {
  let fallback: DayAyah | null = null;
  for (const ref of dailyCandidates(topics, now).slice(0, TRIES)) {
    try {
      const [text, picked] = await Promise.all([loadText(ref, translation), backgroundFor(ref)]);
      const found = { ref, ...text, bg: picked.bg, clip: picked.clip };
      if (!picked.sensitive && text.ar.length <= CARD_MAX) return found;
      if (!picked.sensitive) fallback ??= found;
    } catch { /* the next candidate */ }
  }
  return fallback;
}

// ---------- short ayahs ----------

/** Surahs whose text file is small enough to load for this: a short ayah of Al-Baqarah is not worth 150 KB. */
const SMALL_SURAH = 120;

/** Short ayahs for a status, from what people find and share: today's trending ayahs and the best of the uplifting
 *  topics, a different pick each day. Their text is loaded and only the ones that are really short are kept. */
export async function loadShortAyahs(topics: Topic[], trending: Ref[], surahs: Surah[], now: Date, want = 6): Promise<{ ref: Ref; ar: string }[]> {
  const byId = new Map(topics.map((tp) => [tp.id, tp]));
  const fromTopics = UPLIFTING.flatMap((id) => MOODS.find((m) => m.id === id)?.topics ?? []).flatMap((id) => byId.get(id)?.refs.slice(0, 12) ?? []);
  const small = (ref: Ref) => (surahs[parse(ref)[0] - 1]?.ayahs ?? Infinity) <= SMALL_SURAH;
  const pool = shuffled(unique([...trending.slice(0, 10), ...fromTopics]).filter(small), seeded(dayNumber(now) + 7)).slice(0, want * 3);
  const loaded = await Promise.all(pool.map((ref) => loadText(ref, "none").then(({ ar }) => ({ ref, ar }), () => null)));
  return loaded.filter((x): x is { ref: Ref; ar: string } => !!x && x.ar.length > 0 && x.ar.length < SHORT_MAX).slice(0, want);
}
