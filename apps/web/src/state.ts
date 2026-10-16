// App state: a pure reducer and a tiny store (subscribe / getState / dispatch). Framework-free, so the UI (React) and
// the app logic (src/app.ts) share it, and tests can run it on its own.
// `recipe` (contracts Recipe) is the single source of truth for a design: what is previewed, shared, saved and exported.
import type { Clip, Me, Prefs, PublicConfig, Recipe, Ref, ReportBody, Surah } from "../../../contracts/types";
import { DEFAULT_RECIPE, DEFAULT_STYLE, offeredReciter } from "./config";
import { clampRange, type Edition, type LoadedAyah } from "./design";
import { guessLang, storedLang } from "./lang";
import { prefsPatch, storedHd, storedInterests, storedPrefs } from "./prefs";
import { t } from "./strings";
import { fitVoice } from "./voice";

/** Where the Reflect sheet was opened (analytics key of reflect_open). */
export type ReflectFrom = "feed" | "create" | "results" | "discover" | "profile";

export interface AppState {
  /** Config, surah list and a shared design (if the page was opened from a link) are loaded. */
  ready: boolean;
  config: PublicConfig;
  surahs: Surah[];
  editions: Record<string, Edition>;
  /** Bumped whenever the clip catalogue grows (see api.onCatalogue), so clip lookups re-render. */
  catalogue: number;
  recipe: Recipe;
  /** True once the person picked the background; suggestions then stop replacing it. */
  bgManual: boolean;
  /** Export quality the person picked: HD (1080p) or Standard (720p); null until they pick (prefs.ts hdFor: saving is
   *  then HD and sending Standard). Kept on this device. */
  hd: boolean | null;
  /** The text of the design's ayahs (loaded from the Quran text proxy). */
  ayahs: LoadedAyah[];
  loading: boolean;
  /** Index into `ayahs` shown in the preview. */
  current: number;
  /** For a long ayah shown in parts (draw.ts): the part shown in the preview (playing, the part being recited), which
   *  an image export shows too. 0 otherwise. */
  section: number;
  playing: boolean;
  /** Background suggestions for the first ayah; null while they load. */
  suggestions: Clip[] | null;
  /** Last search query (steers background suggestions when no precomputed list exists). */
  q: string;
  me: Me | null;
  /** Favourite ayahs: this device's list, or the account's once signed in (the device's are added to it). */
  favourites: Ref[];
  /** "My language" (lang.ts): translation of new designs and reels, chip language, tafsir and reflections language. */
  lang: string;
  /** Defaults for new designs (prefs.ts): this device's, or the account's once signed in. */
  prefs: Prefs;
  /** Topics that weight the Discover feed (prefs.ts), at most 10. */
  interests: string[];
  /** Bumped whenever a design is saved (exports and links save automatically), so Saved reloads. */
  savedVersion: number;
  /** The language picker: asked on first open ("first", skippable) or opened to change it. */
  langPicker: "first" | "change" | null;
  /** The ayah the Reflect sheet (tafsir and reflections) is about, and where it was opened. */
  reflect: { ref: Ref; from: ReflectFrom } | null;
  /** Open "Something looks wrong?" dialog. */
  report: ReportBody | null;
  /** Short status message (toast). `id` changes on every message so the same text shows again. */
  toast: { text: string; id: number } | null;
  /** What the editor makes (its Format card): a video, or a still image of the ayah (or part) on screen. Not part of
   *  the design. */
  format: "video" | "image";
  /** The editor's undo and redo: earlier and later versions of the design (at most EDITS_MAX each). `key` and `at`:
   *  the last change's fields and time, so a burst of the same change (a colour being picked, a size held) is one step. */
  edits: { past: Recipe[]; future: Recipe[]; key: string; at: number };
}

/** How many design changes the editor can undo. */
export const EDITS_MAX = 50;
/** Changes of the same fields this close together are one undo step. */
export const MERGE_MS = 1000;
const NO_EDITS: AppState["edits"] = { past: [], future: [], key: "", at: 0 };

/** The design's fields that differ between two versions ("" = the same design). */
export function changedKeys(a: Recipe, b: Recipe): string {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Recipe>;
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort().join(",");
}

/** The design changed by the person in the editor: the version before goes on the undo list (a burst of the same change
 *  joins the step before, unless `merge` is false), and redo is cleared. Nothing changed: the state stays. */
function edited(s: AppState, next: Recipe, extra: Partial<AppState> = {}, merge = true): AppState {
  const key = changedKeys(s.recipe, next);
  if (!key) return Object.keys(extra).length ? { ...s, ...extra } : s;
  const now = Date.now(), e = s.edits;
  const join = merge && e.key === key && now - e.at < MERGE_MS && e.past.length > 0;
  const past = join ? e.past : [...e.past, s.recipe].slice(-EDITS_MAX);
  return { ...s, ...extra, recipe: next, edits: { past, future: [], key: merge ? key : "", at: now } };
}

export type Action =
  | { type: "booted"; config: PublicConfig | null; surahs: Surah[]; recipe: Recipe | null }
  | { type: "editions"; editions: Record<string, Edition> }
  | { type: "catalogue" }
  /** Opens surah:from-to (clamped) as a new pick: the background follows the suggestions again, unless the pick comes
   *  with its own background (a search result shows the background it opens with). */
  | { type: "select"; surah: number; from: number; to: number; bg?: Recipe["bg"] }
  /** Changes some design settings (customise). */
  | { type: "patch"; patch: Partial<Recipe> }
  /** Replaces the whole design (a saved creation); its background is kept. */
  | { type: "recipe"; recipe: Recipe }
  | { type: "bg"; bg: Recipe["bg"]; manual: boolean }
  | { type: "resetStyle" }
  /** The editor's Ayah tab: an ayah added or removed at either end. The background stays. */
  | { type: "range"; from: number; to: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "format"; format: AppState["format"] }
  | { type: "hd"; hd: boolean }
  | { type: "loading" }
  | { type: "ayahs"; ayahs: LoadedAyah[] | null }
  /** Shows ayah `index` in the preview (its part `section`, for a long ayah; default its first). */
  | { type: "goTo"; index: number; section?: number }
  | { type: "play"; on: boolean }
  | { type: "suggestions"; clips: Clip[] | null }
  | { type: "query"; q: string }
  | { type: "me"; me: Me | null }
  | { type: "favourites"; refs: Ref[] }
  | { type: "favourite"; ref: Ref; on: boolean }
  | { type: "report"; body: ReportBody | null }
  | { type: "lang"; lang: string }
  | { type: "prefs"; prefs: Prefs }
  | { type: "interests"; ids: string[] }
  | { type: "saved" }
  | { type: "langPicker"; open: "first" | "change" | null }
  | { type: "reflect"; reflect: AppState["reflect"] }
  | { type: "toast"; text: string };

const FAVOURITES = "qd.favourites";
/** The device's favourite ayahs (signed out). */
export function storedFavourites(): Ref[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(FAVOURITES) ?? "[]");
    return Array.isArray(list) ? list.filter((r): r is Ref => typeof r === "string" && /^\d{1,3}:\d{1,3}$/.test(r)).slice(0, 1000) : [];
  } catch {
    return [];
  }
}
export function storeFavourites(refs: Ref[]) {
  try { localStorage.setItem(FAVOURITES, JSON.stringify(refs)); } catch { /* private mode: kept for this visit */ }
}

export function initialState(): AppState {
  const lang = storedLang() ?? guessLang();
  const prefs = storedPrefs();
  return {
    ready: false,
    config: { appName: t.appName, googleClientId: null, mediaBase: "/media/" },
    surahs: [], editions: {}, catalogue: 0,
    recipe: { ...structuredClone(DEFAULT_RECIPE), ...prefsPatch(prefs, lang) }, bgManual: false, hd: storedHd(),
    ayahs: [], loading: true, current: 0, section: 0, playing: false, suggestions: null,
    q: "", me: null, favourites: storedFavourites(), lang, prefs, interests: storedInterests(), savedVersion: 0,
    langPicker: null, reflect: null, report: null, toast: null, format: "video", edits: NO_EDITS,
  };
}

let toastId = 0;

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "booted": {
      const recipe = a.recipe ? clampRange(a.recipe, a.surahs) : offeredReciter(s.recipe);
      // A design opened from a link keeps its background.
      return { ...s, ready: true, config: a.config ?? s.config, surahs: a.surahs, recipe, bgManual: a.recipe ? true : s.bgManual, edits: NO_EDITS };
    }
    case "editions": return { ...s, editions: a.editions };
    case "catalogue": return { ...s, catalogue: s.catalogue + 1 };
    case "select": {
      if (!s.surahs[a.surah - 1]) return s;
      const recipe = clampRange({ ...s.recipe, surah: a.surah, from: a.from, to: a.to, ...(a.bg ? { bg: a.bg } : {}) }, s.surahs);
      return { ...s, recipe, bgManual: !!a.bg, edits: NO_EDITS };
    }
    // A translation voice reads one translation: changing the translation to another one turns it off.
    case "patch": return edited(s, fitVoice(clampRange({ ...s.recipe, ...a.patch }, s.surahs)));
    // A new design (a saved one, a reel's Customize): nothing to undo.
    case "recipe": return { ...s, recipe: clampRange(a.recipe, s.surahs), bgManual: true, edits: NO_EDITS };
    // Only the person's own pick is a change to undo (not a suggestion filling in).
    case "bg": return a.manual ? edited(s, { ...s.recipe, bg: a.bg }, { bgManual: true }, false) : { ...s, recipe: { ...s.recipe, bg: a.bg }, bgManual: false };
    case "resetStyle": return edited(s, { ...s.recipe, ...DEFAULT_STYLE }, {}, false);
    // (the background was the one on screen: it stays, also when the first ayah changes)
    case "range": return edited(s, clampRange({ ...s.recipe, from: a.from, to: a.to }, s.surahs), { bgManual: true }, false);
    case "undo": case "redo": {
      const e = s.edits, from = a.type === "undo" ? e.past : e.future, to = a.type === "undo" ? e.future : e.past;
      const recipe = from.at(-1);
      if (!recipe) return s;
      const moved = { past: from.slice(0, -1), future: [...to, s.recipe].slice(-EDITS_MAX) };
      const edits = a.type === "undo" ? { past: moved.past, future: moved.future } : { past: moved.future, future: moved.past };
      return { ...s, recipe, edits: { ...edits, key: "", at: 0 } };
    }
    case "format": return s.format === a.format ? s : { ...s, format: a.format, playing: a.format === "image" ? false : s.playing };
    case "hd": return { ...s, hd: a.hd };
    case "loading": return { ...s, loading: true };
    // New text: back to the first ayah, recitation stopped. null = failed to load (the previous text stays).
    case "ayahs": return a.ayahs ? { ...s, ayahs: a.ayahs, loading: false, current: 0, section: 0, playing: false } : { ...s, loading: false };
    case "goTo": return { ...s, current: Math.max(0, Math.min(a.index, s.ayahs.length - 1)), section: Math.max(0, a.section ?? 0) };
    case "play": return s.playing === a.on ? s : { ...s, playing: a.on };
    case "suggestions": return { ...s, suggestions: a.clips };
    case "query": return { ...s, q: a.q };
    // Signing out forgets the account's favourites on this device (the account keeps them).
    case "me": return { ...s, me: a.me, favourites: a.me ? s.favourites : s.me ? [] : s.favourites };
    case "favourites": return { ...s, favourites: a.refs };
    case "favourite": {
      const has = s.favourites.includes(a.ref);
      if (has === a.on) return s;
      return { ...s, favourites: a.on ? [...s.favourites, a.ref] : s.favourites.filter((r) => r !== a.ref) };
    }
    case "report": return { ...s, report: a.body };
    case "lang": return s.lang === a.lang ? s : { ...s, lang: a.lang };
    case "prefs": return { ...s, prefs: a.prefs };
    case "interests": return { ...s, interests: a.ids };
    case "saved": return { ...s, savedVersion: s.savedVersion + 1 };
    case "langPicker": return { ...s, langPicker: a.open };
    case "reflect": return { ...s, reflect: a.reflect };
    case "toast": return { ...s, toast: a.text ? { text: a.text, id: ++toastId } : null };
  }
}

export interface Store {
  getState(): AppState;
  dispatch(a: Action): void;
  subscribe(fn: () => void): () => void;
}

export function createStore(initial: AppState = initialState()): Store {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(a) {
      const next = reducer(state, a);
      if (next === state) return;
      state = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}
