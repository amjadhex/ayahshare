// Start-up and the work that follows the design: loading the ayahs' text when the range or translation changes, and
// background suggestions when the first ayah changes. Framework-free; the UI only renders the store.
import { initAccount, toast } from "./actions";
import { track } from "./analytics";
import * as api from "./api";
import { suggestionsFor } from "./backgrounds";
import { applyTurnedOff } from "./config";
import { designProps, stripBasmala, type Edition } from "./design";
import { storedLang } from "./lang";
import { platform } from "./platform";
import { warmFirstReel } from "./reels";
import { getRoute, navigate } from "./router";
import { loadShared, shareCodeInUrl, shareCodeOf } from "./share";
import { cleanPrefs, defaultTranslation } from "./prefs";
import { openedFromLink } from "./stats";
import type { Store } from "./state";
import { t } from "./strings";
import { openToday, scheduleReminders } from "./today";
import { setVoicesOff } from "./voice";
import { requireUpdate } from "./update";
import { setVapidKey } from "./webpush";
import type { Surah } from "../../../contracts/types";

/** The daily reminder (today.ts): a tapped reminder opens today's ayah (the app: its notification event; the web: the
 *  page opened at /app?today=reminder), and the reminder is set up again on start and whenever the app comes back
 *  (once a day: the app's local notifications each bring the next day's ayah; the web's push keeps its subscription). */
function startReminders(store: Store, surahs: Surah[]) {
  const translation = () => defaultTranslation(store.getState().prefs, store.getState().lang);
  const open = () => void openToday(translation(), "reminder").then((ok) => { if (!ok) toast(store, t.todayFailed); });
  platform.reminders?.onOpen(open);
  const url = new URL(location.href);
  if (url.searchParams.get("today") === "reminder") {
    url.searchParams.delete("today");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    open();
  }
  const again = () => void scheduleReminders(translation(), surahs).catch(() => {});
  again();
  platform.on("resume", again);
}

/** Starts the app on a store. Returns a function that stops following the design (tests). */
export function startApp(store: Store): () => void {
  const stops = [api.onCatalogue(() => store.dispatch({ type: "catalogue" })), follow(store)];
  void boot(store);
  return () => stops.forEach((stop) => stop());
}

async function boot(store: Store) {
  // Everything starts loading at once; only the surah list and config are needed for the first render.
  const surahs = api.getSurahs();
  const editions = api.getEditions().catch(() => [] as Edition[]);
  void api.loadCatalogue();
  void api.loadAyahGroups();
  const config = await api.getConfig().catch(() => null);
  if (config) api.setMediaBase(config.mediaBase);
  if (await requireUpdate(config)) return; // an app older than the server allows: only the Update screen
  // What the admin turned off (admin Library) is hidden from the first render on.
  applyTurnedOff(config?.off?.reciters);
  setVoicesOff(config?.off?.voices);
  store.dispatch({ type: "prefs", prefs: cleanPrefs(store.getState().prefs) }); // drops a default reciter that is off
  setVapidKey(config?.vapidPublicKey);
  // Sign-in needs the server's client id and, in the app, a client id built in for that platform.
  if (config && !platform.googleSignIn.supported) config.googleClientId = null;
  document.title = config?.appName ?? t.appName;

  let shared = null;
  // The page's address on the web; in the app, the link that started it (the page itself is always the app's start).
  const launch = shareCodeInUrl() ? null : shareCodeOf(await platform.launchUrl());
  const code = shareCodeInUrl() ?? launch;
  if (code) {
    try {
      shared = await loadShared(code);
      openedFromLink(code, shared);
      track("share_open", { ...designProps(shared), source: "share" });
    } catch {
      toast(store, t.shareOpenFailed);
    }
  }
  let list;
  try {
    list = await surahs;
  } catch {
    platform.ready();
    toast(store, t.ayahsFailed);
    return;
  }
  if (shared?.bg.type === "clip") await api.ensureClip(shared.bg.id);
  store.dispatch({ type: "booted", config, surahs: list, recipe: shared });
  if (launch && shared) navigate("create");
  // First open: which language? (Skippable; a shared design opens without the question, which waits for next time.)
  if (!storedLang() && !shared) store.dispatch({ type: "langPicker", open: "first" });
  platform.ready();
  platform.onDeepLink((url) => void openLink(store, url));
  track("app_open", designProps(store.getState().recipe));
  startReminders(store, list);

  void editions.then((all) => store.dispatch({ type: "editions", editions: Object.fromEntries(all.map((e) => [e.identifier, e])) }));
  void initAccount(store);
  void editions.then(() => warmReelsSoon(store));
}

/** Once the first screen is up and the page is idle (about 1.5 s on), the first reel of the Reels tab gets ready in
 *  memory (reels.ts warmFirstReel; not with data saver or on 2G), so Reels opens playing at once. Skipped when Reels is
 *  already open (it starts its own) and in tests. */
function warmReelsSoon(store: Store) {
  if (import.meta.env.MODE === "test" || (import.meta.env.DEV && new URLSearchParams(location.search).has("nowarm"))) return;
  const go = () => {
    const s = store.getState();
    if (getRoute().view === "feed" || !s.surahs.length) return;
    warmFirstReel({
      lang: s.lang, prefs: s.prefs, interests: s.interests, favourites: s.favourites,
      scene: { surahs: s.surahs, editions: s.editions, brand: s.config.appName },
    });
  };
  setTimeout(() => (typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: 2000 }) : go()), 1500);
}

/** A share link opened while the app is running (app only): its design replaces the current one and Create opens. */
async function openLink(store: Store, url: URL) {
  const code = shareCodeOf(url);
  if (!code) return;
  try {
    const recipe = await loadShared(code);
    openedFromLink(code, recipe);
    if (recipe.bg.type === "clip") await api.ensureClip(recipe.bg.id);
    store.dispatch({ type: "recipe", recipe });
    track("share_open", { ...designProps(recipe), source: "share" });
    navigate("create");
  } catch {
    toast(store, t.shareOpenFailed);
  }
}

/** Reloads the text and the suggestions when the parts of the design they depend on change. */
function follow(store: Store) {
  let textKey = "", bgKey = "", textToken = 0, bgToken = 0;

  async function loadText() {
    const token = ++textToken, r = store.getState().recipe;
    store.dispatch({ type: "loading" });
    try {
      const [ar, tr] = await api.getAyahText(r.surah, r.from, r.to, r.translation);
      if (token !== textToken) return;
      store.dispatch({
        type: "ayahs",
        ayahs: ar.ayahs.map((a, i) => ({ num: a.numberInSurah, ar: stripBasmala(a.text, r.surah, a.numberInSurah), tr: tr ? tr.ayahs[i].text : "" })),
      });
    } catch {
      if (token !== textToken) return;
      store.dispatch({ type: "ayahs", ayahs: null });
      toast(store, t.ayahsFailed);
    }
  }

  async function loadSuggestions() {
    const token = ++bgToken, s = store.getState(), r = s.recipe;
    store.dispatch({ type: "suggestions", clips: null });
    const clips = await suggestionsFor(r.surah, r.from, s.q || s.surahs[r.surah - 1]?.meaning || "");
    if (token !== bgToken) return;
    store.dispatch({ type: "suggestions", clips });
    if (!store.getState().bgManual && clips[0]) store.dispatch({ type: "bg", bg: { type: "clip", id: clips[0].id }, manual: false });
  }

  const check = () => {
    const s = store.getState();
    if (!s.ready) return;
    const r = s.recipe;
    const text = `${r.surah}:${r.from}-${r.to}/${r.translation}`, bg = `${r.surah}:${r.from}`;
    if (text !== textKey) { textKey = text; void loadText(); }
    if (bg !== bgKey) { bgKey = bg; void loadSuggestions(); }
  };
  const stop = store.subscribe(check);
  check();
  return stop;
}
