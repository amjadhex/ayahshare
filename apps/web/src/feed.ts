// The Discover feed's mix: which ayah comes next, chosen on the device without any AI call. It blends
//   - the day: time of day, Friday (Surah Al-Kahf), Ramadan and its last ten nights, Hajj, Arafah, the Eids, Muharram
//   - the person's own signals kept on this device (signals.ts): what their searches found, mood chips they pick,
//     favourites, reels watched to the end (more like them) and reels skipped (fewer)
//   - the interests picked on the profile (topic ids, prefs.ts), which weigh most of all the personal signals
//   - the mood chip on top of the feed, which re-steers it
//   - popular ayahs (most exported and shared, GET /api/trending)
//   - and gentle discovery from uplifting topics,
// using the offline-ranked topic lists in data/topics.json. It avoids repeats (this visit, and ayahs shown in the last
// three days) and gives consecutive reels a different look (text effect and entry/exit animation). Each reel uses its ayah's
// precomputed backgrounds (data/bg); a sensitive-flagged ayah only ever gets a calm background or a plain colour.
// Framework-free.
import type { Clip, Prefs, Recipe, Ref, Topic } from "../../../contracts/types";
import { BG_COLOURS, DEFAULT_RECIPE, RECITERS } from "./config";
import { withGroups } from "./groups";
import { translationFor } from "./lang";
import { defaultTranslation } from "./prefs";
import { navigate } from "./router";
import type { Signals } from "./signals";
import { momentsAt, type Moment } from "./topics";
import { voiceFor } from "./voice";
import { sizedReel } from "./reelText";

export type Reason =
  | { kind: "moment"; moment: Moment }
  | { kind: "mood"; mood: string }
  | { kind: "you" }
  | { kind: "popular" }
  | { kind: "discover" }
  /** A search result opened from Results (the reel says what was searched). */
  | { kind: "search"; q: string }
  /** Today's ayah (today.ts), opened from Home or the daily reminder: the reel shows the day and "Remind me". */
  | { kind: "today" }
  /** A whole surah played from Discover (surah.ts): Reels shows the surah and how far it is. */
  | { kind: "surah"; surah: number };

export interface FeedItem {
  /** Unique within the visit (the same ayah never shows twice in a visit, but keys stay unique anyway). */
  key: string;
  ref: Ref;
  surah: number;
  ayah: number;
  /** The last ayah when the reel is a short range (a search result like 94:5–6); one ayah when absent. */
  to?: number;
  reason: Reason;
  effect: NonNullable<Recipe["effect"]>;
  animation: NonNullable<Recipe["animation"]>;
}

/** Mood chips: the label comes from the topic chip with the same id (topics.ts), the ayahs from these topics. */
export const MOODS: { id: string; topics: string[] }[] = [
  { id: "hope", topics: ["hope", "ease-after-hardship", "do-not-despair", "relief-from-distress"] },
  { id: "peace", topics: ["peace-of-heart", "comfort", "remembrance", "contentment"] },
  { id: "anxious", topics: ["anxiety", "future-worry", "trust-in-allah", "allah-is-near"] },
  { id: "gratitude", topics: ["gratitude", "blessings", "praise-of-allah"] },
  { id: "patience", topics: ["patience", "steadfastness", "trials", "no-burden-beyond-capacity"] },
  { id: "forgiveness", topics: ["forgiveness", "istighfar", "repentance", "mercy", "second-chance"] },
  { id: "grief", topics: ["grief", "bereavement", "comfort", "return-to-allah"] },
  { id: "strength", topics: ["strength", "courage", "seeking-help", "allah-with-you"] },
  { id: "love", topics: ["love-of-allah", "allah-is-near", "mercy"] },
  { id: "family", topics: ["parents", "family-ties", "children", "love-between-spouses", "praying-for-parents"] },
  { id: "dua", topics: ["dua", "seeking-help", "seeking-refuge"] },
  { id: "lonely", topics: ["loneliness", "allah-is-near", "allah-with-you"] },
  { id: "paradise", topics: ["paradise", "reward-of-believers", "hereafter-is-better"] },
  { id: "nature", topics: ["signs-in-nature", "reflecting-on-creation", "rain", "stars", "night-and-day"] },
];

/** Topics for each moment of the day and year. */
export const MOMENT_TOPICS: Partial<Record<Moment, string[]>> = {
  morning: ["remembrance", "praise-of-allah", "dawn", "provision", "gratitude"],
  evening: ["remembrance", "night-and-day", "seeking-refuge", "protection-from-evil"],
  night: ["sleep", "night-prayer", "allah-is-near", "peace-of-heart", "forgiveness"],
  friday: ["people-of-the-cave", "friday-prayer"],
  thursdayNight: ["people-of-the-cave", "friday-prayer"],
  ramadan: ["fasting", "ramadan", "reciting-quran", "dua", "forgiveness"],
  lastTenNights: ["night-of-power", "night-prayer", "dua"],
  eidFitr: ["joy", "gratitude", "family-ties"],
  hajjDays: ["hajj", "kaaba", "sacrifice", "dua"],
  arafah: ["dua", "forgiveness", "hajj"],
  eidAdha: ["sacrifice", "hajj", "joy", "gratitude"],
  muharram: ["sacred-months", "migration", "patience"],
  newYear: ["migration", "value-of-time", "second-chance"],
};
/** Friday: Surah Al-Kahf (recited on Fridays) leads. */
export const KAHF: Ref[] = ["18:10", "18:46", "18:109", "18:110", "18:28", "18:13", "18:23", "18:24", "18:1", "18:2", "18:39", "18:65"];
/** Moments that lead the feed when no mood is picked (the time of day only adds to the mix). */
export const SPECIAL: Moment[] = ["friday", "thursdayNight", "lastTenNights", "ramadan", "arafah", "eidFitr", "eidAdha", "hajjDays", "newYear", "muharram"];
/** Gentle discovery beyond the moods. */
export const DISCOVER = [
  "guidance", "the-quran", "reflecting-on-quran", "kindness", "good-speech", "humility", "generosity", "helping-others", "wisdom",
  "light", "success", "allah-provider", "allah-creator", "names-of-allah", "life-is-short", "allah-guides", "small-deeds", "hope-in-reward",
];

// Every reel has the Shade effect (owner, 12 Oct 2026: one look, readable on any clip); consecutive reels differ by
// their entry/exit animation, which cycles every 4.
const EFFECTS: FeedItem["effect"][] = ["shade"];
const ANIMATIONS: FeedItem["animation"][] = ["rise", "fade", "zoom", "none"];
const SEEN_DAYS = 3;

export interface MixInput {
  topics: Topic[];
  trending: Ref[];
  now: Date;
  signals: Signals;
  favourites: Ref[];
  /** Topics picked on the profile (at most 10). */
  interests?: string[];
  mood: string | null;
  /** Ayahs already in the feed this visit (kept when the mood changes). */
  exclude?: Iterable<Ref>;
  /** How many reels came before (Discover handed some over), so the looks keep rotating from there. */
  startAt?: number;
  random?: () => number;
}

/** `refs`: a random pick (best-ranked more often); `list`: all of the pool's ayahs, best first (when picks keep
 *  landing on ayahs already shown). */
interface Pool { reason: Reason; weight: number; refs: () => Ref | null; list: () => Ref[] }

const parse = (ref: Ref) => ref.split(":").map(Number) as [number, number];
const valid = (ref: unknown): ref is Ref => typeof ref === "string" && /^\d{1,3}:\d{1,3}$/.test(ref);

/** A feed for one visit (or one mood): next() gives the next ayah, never the same twice. */
export function createMixer(input: MixInput) {
  const random = input.random ?? Math.random;
  const byId = new Map(input.topics.map((tp) => [tp.id, tp]));
  const topicsOf = (ids: string[]) => ids.map((id) => byId.get(id)).filter((tp): tp is Topic => !!tp && tp.refs.length > 0);
  const shown = new Set<Ref>(input.exclude ?? []);
  const recent = input.now.getTime() - SEEN_DAYS * 86400_000;
  let count = input.startAt ?? 0;
  let lastSurah = 0;

  /** Weighted pick from a list (weights ≥ 0). */
  function weighted<T>(list: T[], weight: (x: T, i: number) => number): T | null {
    const ws = list.map(weight), total = ws.reduce((s, w) => s + Math.max(0, w), 0);
    if (!list.length || total <= 0) return null;
    let r = random() * total;
    for (let i = 0; i < list.length; i++) { r -= Math.max(0, ws[i]); if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  /** Whether an ayah may come now: not shown this visit, not shown on this device lately (relaxed after many tries),
   *  not the same surah as the reel before (relaxed too). */
  const fresh = (ref: Ref, strict: boolean) =>
    !shown.has(ref) && (!strict || ((input.signals.seen[ref] ?? 0) < recent && parse(ref)[0] !== lastSurah));

  /** An ayah from a topic list, favouring its best-ranked ayahs. */
  const fromTopics = (list: Topic[], score?: (tp: Topic) => number) => () => {
    const tp = weighted(list, (x) => (score ? score(x) : 1));
    return tp ? weighted(tp.refs, (_, i) => 1 / (1 + i * 0.12)) : null;
  };
  /** Every ayah of the topics, by rank (the best of each topic first). */
  const allOf = (list: Topic[]) => () => {
    const longest = Math.max(0, ...list.map((tp) => tp.refs.length));
    return Array.from({ length: longest }, (_, i) => list.flatMap((tp) => tp.refs[i] ?? [])).flat();
  };

  // ---------- the person's own topics ----------
  const interest = new Map<Ref, number>(Object.entries(input.signals.refs));
  for (const f of input.favourites) interest.set(f, (interest.get(f) ?? 0) + 2);
  const picked = new Set(input.interests ?? []);
  const personal = new Map<Topic, number>();
  for (const tp of input.topics) {
    let s = 0;
    tp.refs.forEach((ref, i) => { const v = interest.get(ref); if (v) s += v / (1 + i * 0.1); });
    for (const m of MOODS) if (m.topics.includes(tp.id)) s += (input.signals.moods[m.id] ?? 0) * 0.5;
    if (picked.has(tp.id)) s += 6; // a topic picked on the profile outweighs what the device inferred
    if (s > 0.5) personal.set(tp, s);
  }
  const mine = [...personal.keys()].sort((a, b) => personal.get(b)! - personal.get(a)!).slice(0, Math.max(10, picked.size));

  // ---------- pools ----------
  const moments = [...momentsAt(input.now)];
  const special = moments.filter((m) => SPECIAL.includes(m));
  const momentPools: Pool[] = moments.flatMap((moment) => {
    const list = topicsOf(MOMENT_TOPICS[moment] ?? []);
    const kahf = moment === "friday" || moment === "thursdayNight";
    if (!list.length && !kahf) return [];
    const pick = fromTopics(list);
    return [{
      reason: { kind: "moment", moment }, weight: special.includes(moment) ? 0.4 / special.length : 0.2 / moments.length,
      refs: kahf ? () => (random() < 0.7 ? weighted(KAHF, (_, i) => 1 / (1 + i * 0.3)) : pick()) : pick,
      list: kahf ? () => [...KAHF, ...allOf(list)()] : allOf(list),
    }];
  });
  const mood = input.mood ? MOODS.find((m) => m.id === input.mood) : null;
  const pools: Pool[] = [];
  if (mood) pools.push({ reason: { kind: "mood", mood: mood.id }, weight: 0.8, refs: fromTopics(topicsOf(mood.topics)), list: allOf(topicsOf(mood.topics)) });
  for (const p of momentPools) pools.push({ ...p, weight: p.weight * (mood ? 0.25 : 1) });
  // Interests picked on the profile make "for you" the largest share of the mix (without a mood chip).
  const youWeight = mood ? (picked.size ? 0.12 : 0.08) : picked.size ? 0.55 : 0.3;
  if (mine.length) pools.push({ reason: { kind: "you" }, weight: youWeight, refs: fromTopics(mine, (tp) => personal.get(tp)!), list: allOf(mine) });
  const popular = input.trending.filter(valid);
  if (popular.length) {
    pools.push({ reason: { kind: "popular" }, weight: mood ? 0.04 : picked.size ? 0.1 : 0.15, refs: () => weighted(popular, (_, i) => 1 / (1 + i * 0.2)), list: () => popular });
  }
  const discoverTopics = topicsOf([...new Set([...MOODS.flatMap((m) => m.topics), ...DISCOVER])]);
  pools.push({ reason: { kind: "discover" }, weight: mood ? 0.05 : picked.size ? 0.18 : 0.3, refs: fromTopics(discoverTopics), list: allOf(discoverTopics) });

  /** The first reel: the mood's, or the special day's (Friday → Al-Kahf), else the usual mix. */
  let lead: Pool | null = mood ? pools[0] : momentPools.find((p) => p.reason.kind === "moment" && special.includes(p.reason.moment)) ?? null;

  function next(): FeedItem | null {
    let ref: Ref | null = null, reason: Reason | null = null;
    for (let attempt = 0; attempt < 60 && !ref; attempt++) {
      const pool = (attempt < 4 && lead) || weighted(pools, (p) => p.weight)!;
      const candidate = pool.refs();
      if (candidate && valid(candidate) && fresh(candidate, attempt < 40)) { ref = candidate; reason = pool.reason; }
    }
    // Random picks keep landing on ayahs already shown: the next unseen ayah of the mood (or the day), then of any pool.
    for (const pool of [...(mood ? [pools[0]] : lead ? [lead] : []), ...pools]) {
      if (ref) break;
      const found = pool.list().find((r) => valid(r) && fresh(r, false));
      if (found) { ref = found; reason = pool.reason; }
    }
    lead = null;
    if (!ref || !reason) {
      // Everything nearby was shown: any ayah of any listed topic not shown in this visit.
      const all = input.topics.flatMap((tp) => tp.refs).filter((r) => !shown.has(r));
      ref = all.length ? all[Math.floor(random() * all.length)] : null;
      reason = { kind: "discover" };
      if (!ref) return null;
    }
    shown.add(ref);
    const [surah, ayah] = parse(ref);
    lastSurah = surah;
    const i = count++;
    return { key: `${ref}#${i}`, ref, surah, ayah, reason, effect: EFFECTS[i % EFFECTS.length], animation: ANIMATIONS[i % ANIMATIONS.length] };
  }

  return { next, shown };
}

// ---------- reciters ----------

/** The reciters reels rotate through: the app's own list (every one has every ayah, less those the admin turned off),
 *  without the slow Mujawwad styles, which make a reel twice as long (unless only those are left). */
export const reelReciters = () => {
  const all = RECITERS.map(([folder]) => folder), quick = all.filter((folder) => !/Mujawwad/i.test(folder));
  return quick.length ? quick : all;
};
const RECENT_RECITERS = 4;

/** FNV-1a: the same text always gives the same number. */
const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/** The reciter for a reel: a different one from the last few reels (`recent`, newest first), chosen by the ayah itself so
 *  it is always the same for the same ayah and neighbours. The person's own reciter (`preferred`) comes in on about one
 *  reel in three, never twice running; every other reel rotates through the rest. */
/** The reciter every reel has when the person chose one (Reels' My preferred reciter); undefined for the mix. */
export const fixedReciter = (prefs: Prefs): string | undefined =>
  prefs.reelReciter && prefs.reelReciter !== "mix" && RECITERS.some(([f]) => f === prefs.reelReciter) ? prefs.reelReciter : undefined;

export function pickReciter(ref: Ref, recent: string[], preferred?: string): string {
  const h = hash(ref), pool = reelReciters(), own = preferred && RECITERS.some(([folder]) => folder === preferred) ? preferred : undefined;
  if (own && h % 3 === 0 && recent[0] !== own) return own;
  const avoid = recent.slice(0, RECENT_RECITERS);
  const others = pool.filter((folder) => folder !== own);
  const start = (h >>> 2) % others.length;
  for (let k = 0; k < others.length; k++) {
    const folder = others[(start + k) % others.length];
    if (!avoid.includes(folder)) return folder;
  }
  return others[start];
}

// ---------- reels handed over by Discover ----------

/** A reel opened from another screen (Discover, Results): the ayah and the background its thumbnail shows (when it
 *  has one; else the feed picks one). */
export interface ReelStart { item: FeedItem; bg?: Recipe["bg"] }
let handedOver: ReelStart[] | null = null;
/** Discover opens the feed on these reels (in this order); the feed goes on with its own mix after them. */
export function startReelsWith(list: ReelStart[]) { handedOver = list.length ? list : null; handOvers++; handOverListeners.forEach((f) => f()); }
export const hasReelStart = () => handedOver !== null;
/** Each hand-over, counted, so Reels already on screen takes one too (a reminder tapped while watching opens today's ayah). */
let handOvers = 0;
const handOverListeners = new Set<() => void>();
export const reelStarts = () => handOvers;
export function subscribeReelStarts(f: () => void) { handOverListeners.add(f); return () => { handOverListeners.delete(f); }; }
/** Opens Reels on `list` starting at reel `k` (the ones before it come after it), then the feed's own mix. */
export function startReelsAt(list: ReelStart[], k: number) {
  startReelsWith([...list.slice(k), ...list.slice(0, k)]);
  navigate("feed");
}
/** A reel for an ayah (or a short range) chosen on another screen; `i` gives it its look, as in the mix. */
export function reelFor(ref: Ref, reason: Reason, i: number, to?: number): FeedItem {
  const [surah, ayah] = ref.split(":").map(Number);
  return {
    key: `${ref}#${reason.kind}${i}`, ref, surah, ayah, ...(to && to > ayah ? { to } : {}), reason,
    effect: EFFECTS[i % EFFECTS.length], animation: ANIMATIONS[i % ANIMATIONS.length],
  };
}
/** The reel widened to the ayahs its meaning needs (107:4 → 107:4-7, groups.ts); the same object when it stands alone. */
export function groupItem(item: FeedItem): FeedItem {
  const { from, to } = withGroups(item.surah, item.ayah, item.to ?? item.ayah);
  if (from === item.ayah && to === (item.to ?? item.ayah)) return item;
  return { ...item, ref: `${item.surah}:${from}`, ayah: from, ...(to > from ? { to } : {}) };
}
/** The feed takes the reels handed over (once). */
export function takeReelStart(): ReelStart[] | null {
  const list = handedOver;
  handedOver = null;
  return list;
}

// ---------- backgrounds ----------

const INTENSE = /\b(storm|thunder|lightning|electric|electricity|energy|fire|flames?|lava|volcano|explosion|dark|darkness|mysterious|horror|smoke|tornado|hurricane|flood|war|blood|skull|scary|creepy)\b/i;
const CALM = /\b(calm|sky|clouds?|sea|ocean|water|lake|abstract|pattern|texture|bokeh|light|gradient|mist|sunrise|sunset|dawn|nature|landscape|mountains?|snow|stars?|moon|beach|river|flowers?|leaves|meadow|field|desert|sand)\b/i;

/** A clip calm enough for a sensitive ayah: nothing stormy, dark or violent in its tags, and something peaceful. */
export const isCalm = (clip: Clip) => {
  const words = `${clip.tags.join(", ")}, ${clip.caption}`;
  return !INTENSE.test(words) && CALM.test(words);
};

/** The reel's background: the ayah's best suggestion not used by the last few reels. A sensitive ayah only gets a calm
 *  clip, else a plain dark colour. */
export function pickBackground(suggestions: Clip[], sensitive: boolean, recentClips: string[], index: number): Recipe["bg"] {
  const usable = sensitive ? suggestions.filter(isCalm) : suggestions;
  const clip = usable.find((c) => !recentClips.includes(c.id)) ?? usable[0];
  if (clip) return { type: "clip", id: clip.id };
  const dark = BG_COLOURS.filter((c) => !["#f4efe6", "#ffffff", "#000000"].includes(c));
  return { type: "colour", colour: dark[index % dark.length] };
}

/** The reel's design: the defaults, the person's translation and reciter, the reel's background, look and animation. */
export function reelRecipe(item: FeedItem, translation: string, bg: Recipe["bg"], reciter = DEFAULT_RECIPE.reciter): Recipe {
  return {
    ...structuredClone(DEFAULT_RECIPE), surah: item.surah, from: item.ayah, to: item.to ?? item.ayah, translation, reciter, bg, orientation: "portrait",
    effect: item.effect, animation: item.animation, boxOpacity: item.effect === "glass" ? 22 : item.effect === "solid" ? 45 : 60,
    headerY: 0.19, // lower than in Create: the title, language and mood chips sit at the top of a reel
    // The text stays in the middle band, a little higher than in Create, and a little narrower: the reel's buttons sit on
    // the right and its details low on it (so Auto contrast does not move it into them; it still shades or darkens what
    // it needs to).
    textY: 0.5, textWidth: 0.8,
  };
}

/** A reel's whole design (the Feed's, and what Results and Discover warm before opening it): reelRecipe with the
 *  person's translation and, with "Translation voice in Feed" on, My language's voice reading its translation after
 *  the recitation (the reel then shows the translation it reads). */
export function reelDesign(item: FeedItem, bg: Recipe["bg"], reciter: string, prefs: Prefs, lang: string): Recipe {
  const recipe = reelRecipe(item, defaultTranslation(prefs, lang), bg, reciter);
  const voice = prefs.feedVoice ? voiceFor(lang, translationFor(lang)) : null;
  return sizedReel(voice ? { ...recipe, voice: voice.id, translation: voice.text } : recipe); // the person's text size (reelText.ts)
}
