// Minimal History-API router: screens and bottom sheets are history entries, so the back button closes an open sheet
// first, then returns to the screen before. Home ("find") is the first entry, like a tab bar's first tab.
// Screens: Home (what do you feel today?) · Results · Pick (choose an ayah yourself) · Create (the editor) · Share ·
// Discover · Reels ("feed") · Profile · Activity · Settings · Credits (/credits) · Login (/login, full screen). Framework-free.

export type View = "find" | "results" | "pick" | "create" | "share" | "discover" | "feed" | "profile" | "activity" | "settings" | "credits" | "login" | "surahs";
export type SheetId = "ayahs" | "background" | "text" | "style" | "recite" | "language" | "export" | "reflect" | "translation" | "prefs" | "picker" | "streak" | "interests"
  /** Discover's stories, opened from a circle: a history entry, so Back closes them (to Browse). */
  | "stories"
  /** Reels: "How are you feeling?" (the moods) and Language and audio. */
  | "moods" | "reelSettings"
  /** Reels: My preferred reciter (from Language and audio, and asked once on the first Reels). */
  | "reelReciter"
  /** Reels: the daily reminder of today's ayah. */
  | "reminder"
  /** All surahs: the reciter for whole surahs. */
  | "surahReciter"
  /** Reels and stories: Share or Download as a video or an image (FormatSheet). */
  | "format";
/** `depth` counts the entries this app pushed above the first (Find) entry. */
export interface Route { view: View; sheet: SheetId | null; depth: number }
interface Entry extends Route { qd: 1 }

/** Home's address: /app on the web, where / is the landing page (served by the Worker, apps/api src/index.ts). The iOS /
 *  Android app loads its own bundled copy at /, which has no landing page. */
const HOME = window.Capacitor?.isNativePlatform?.() ? "/" : "/app";
const PATHS: Record<View, string> = {
  find: HOME, results: "/search", pick: "/pick", create: "/create", share: "/create/share", discover: "/discover",
  feed: "/feed", profile: "/profile", activity: "/activity", settings: "/settings", credits: "/credits", login: "/login", surahs: "/surahs",
};
/** Addresses of earlier versions of the app. */
const OLD_PATHS: Record<string, View> = { "/saved": "profile", "/account": "profile", "/reels": "feed" };

const isEntry = (s: unknown): s is Entry => !!s && typeof s === "object" && (s as Entry).qd === 1;
const entry = (r: Route): Entry => ({ qd: 1, ...r });

/** The screen an address opens: a share link (/s/:code, ?r=) opens Create. */
export function viewFromLocation(loc: Location = location): View {
  if (/^\/s\/[\w-]+/.test(loc.pathname) || new URLSearchParams(loc.search).has("r")) return "create";
  return (Object.keys(PATHS) as View[]).find((v) => v !== "find" && loc.pathname === PATHS[v]) ?? OLD_PATHS[loc.pathname] ?? "find";
}

let route: Route = { view: "find", sheet: null, depth: 0 };
/** A history.back() / go() is on its way; ignore further back requests until it lands (double taps, Escape + drag). */
let traversing = false;
const listeners = new Set<() => void>();

function set(next: Route) {
  route = next;
  for (const fn of [...listeners]) fn();
}

export const getRoute = () => route;
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function onPop(e: PopStateEvent) {
  traversing = false;
  set(isEntry(e.state) ? { view: e.state.view, sheet: e.state.sheet ?? null, depth: e.state.depth } : { view: viewFromLocation(), sheet: null, depth: 0 });
}

function traverse(delta: number) {
  if (traversing) return;
  traversing = true;
  history.go(delta);
  setTimeout(() => (traversing = false), 600); // in case no popstate arrives (nothing to go back to)
}

/** Reads the first route. Any screen but Find gets a Find entry underneath, so back returns there. A reload keeps the
 *  screen it was on (without its sheet). */
export function initRouter() {
  removeEventListener("popstate", onPop);
  addEventListener("popstate", onPop);
  traversing = false;
  const s: unknown = history.state;
  if (isEntry(s)) {
    route = { view: s.view, sheet: null, depth: s.depth };
    if (s.sheet) history.replaceState(entry(route), "");
  } else {
    const view = viewFromLocation();
    if (view === "find") {
      route = { view, sheet: null, depth: 0 };
      history.replaceState(entry(route), "", PATHS.find + location.search + location.hash);
    } else {
      const url = location.pathname + location.search + location.hash;
      history.replaceState(entry({ view: "find", sheet: null, depth: 0 }), "", PATHS.find);
      route = { view, sheet: null, depth: 1 };
      history.pushState(entry(route), "", url);
    }
  }
  set(route);
}

/** Shows a screen. Find goes back to the first entry (like a tab bar); other screens push an entry. */
export function navigate(view: View) {
  if (view === route.view && !route.sheet) return;
  if (view === "find" && route.depth > 0) return traverse(-route.depth);
  const next: Route = { view, sheet: null, depth: view === "find" ? 0 : route.sheet ? route.depth : route.depth + 1 };
  if (route.sheet || view === "find") history.replaceState(entry(next), "", PATHS[view]);
  else history.pushState(entry(next), "", PATHS[view]);
  set(next);
}

/** Shows `view` in place of the current entry (the login page hands over to the screen it was asked for, ?next=). */
export function replaceView(view: View) {
  if (view === "find") return navigate("find");
  const next: Route = { view, sheet: null, depth: route.depth };
  history.replaceState(entry(next), "", PATHS[view]);
  set(next);
}

/** The app bar's back arrow. */
export function back() {
  if (route.depth > 0) traverse(-1);
  else navigate("find");
}

/** `stack`: a sheet over the one that is open (a picker inside Preferences) gets its own entry, so Back closes only it. */
export function openSheet(sheet: SheetId, stack = false) {
  if (route.sheet === sheet) return;
  const next: Route = { ...route, sheet, depth: route.sheet && !stack ? route.depth : route.depth + 1 };
  if (route.sheet && !stack) history.replaceState(entry(next), ""); else history.pushState(entry(next), "");
  set(next);
}

export function closeSheet() {
  if (!route.sheet) return;
  const s: unknown = history.state;
  if (isEntry(s) && s.sheet) return traverse(-1); // the popstate closes it
  const next: Route = { ...route, sheet: null };
  history.replaceState(entry(next), "");
  set(next);
}
