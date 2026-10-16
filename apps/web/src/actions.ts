// Everything a person can do to the design or their account, with its analytics event. Framework-free: the UI calls
// these with the app's store.
import type { CreationKind, Me, Prefs, ProfilePatch, PublicConfig, Recipe, Ref, ReportBody, SignedIn, Surah } from "../../../contracts/types";
import { newDevice, track } from "./analytics";
import * as api from "./api";
import { sanitizeRecipe } from "./config";
import { designProps, designTitle } from "./design";
import { hasSessionToken } from "./endpoint";
import { withGroups } from "./groups";
import { listDevice, removeDevice, saveDevice } from "./history";
import { askToJoin, type JoinReason } from "./join";
import { askInstall } from "./pwa";
import { isLanguage, storedLang, storeLang, translationFor } from "./lang";
import { platform } from "./platform";
import { cleanInterests, cleanPrefs, defaultTranslation, samePrefs, storeHd, storeInterests, storePrefs, voicePatch } from "./prefs";
import { storedFavourites, storeFavourites, type ReflectFrom, type Store } from "./state";
import { t } from "./strings";
import type { Voice } from "./voice";

export const toast = (store: Store, text: string) => store.dispatch({ type: "toast", text });

// ---------- design ----------

/** Opens surah:from-to (clamped to the surah), widened to the ayahs its meaning needs (107:4 → 107:4-7, groups.ts);
 *  suggestions then pick the background again, unless `bg` is given (the background a search result showed). */
export function selectAyahs(store: Store, surah: number, from: number, to: number, bg?: Recipe["bg"]) {
  store.dispatch({ type: "select", surah, ...withGroups(surah, from, to), bg });
  track("ayah_select", designProps(store.getState().recipe));
}

/** A customise setting changed (`key` names it in analytics). */
export function customise(store: Store, patch: Partial<Recipe>, key: string) {
  store.dispatch({ type: "patch", patch });
  track("customise", { ...designProps(store.getState().recipe), key });
}

/** Turns the design's translation voice on (`voice`) or off (null). On, the design shows the translation the voice
 *  reads; when that changes the translation, a short line says so. */
export function setVoice(store: Store, voice: Voice | null) {
  const before = store.getState().recipe.translation;
  customise(store, voice ? { voice: voice.id, translation: voice.text } : { voice: "none" }, "voice");
  if (voice && voice.text !== before) {
    const e = store.getState().editions[voice.text];
    toast(store, t.voiceShows(e?.englishName ?? voice.text));
  }
}

/** The editor's Ayah tab: the design's range grows or shrinks at one end (the background stays). */
export function changeRange(store: Store, from: number, to: number) {
  store.dispatch({ type: "range", from, to });
  track("customise", { ...designProps(store.getState().recipe), key: "range" });
}

/** The editor's Undo and Redo (every change to the design, a burst of the same change as one step). */
export const undo = (store: Store) => store.dispatch({ type: "undo" });
export const redo = (store: Store) => store.dispatch({ type: "redo" });

/** What the editor makes: a video or an image. */
export const setFormat = (store: Store, format: "video" | "image") => store.dispatch({ type: "format", format });

export function chooseBg(store: Store, bg: Recipe["bg"], source: "suggested" | "library" | "colour") {
  store.dispatch({ type: "bg", bg, manual: true });
  track("bg_select", { ...designProps(store.getState().recipe), source });
}

export function resetStyle(store: Store) {
  store.dispatch({ type: "resetStyle" });
  track("customise", { ...designProps(store.getState().recipe), key: "reset" });
}

/** The person's export quality (HD or Standard), remembered on this device for every later file. */
export function setHd(store: Store, hd: boolean) {
  store.dispatch({ type: "hd", hd });
  storeHd(hd);
  track("customise", { ...designProps(store.getState().recipe), key: "size" });
}

export function togglePlay(store: Store) {
  const on = !store.getState().playing;
  store.dispatch({ type: "play", on });
  if (on) track("preview_play", designProps(store.getState().recipe));
}

/** Opens a saved design (My creations). */
export async function openCreation(store: Store, recipe: unknown) {
  const r = sanitizeRecipe(recipe);
  if (r.bg.type === "clip") await api.ensureClip(r.bg.id);
  store.dispatch({ type: "recipe", recipe: r });
}

// ---------- report ----------

export const openReport = (store: Store, body: ReportBody) => store.dispatch({ type: "report", body });

export async function sendReport(store: Store, body: ReportBody, userNote: string) {
  const note = [body.note, userNote.trim()].filter(Boolean).join(" — ");
  track("report", { ref: body.ref, clip: body.clip });
  try {
    await api.sendReport({ ...body, note: note || undefined });
    toast(store, t.reportThanks);
  } catch {
    toast(store, t.reportFailed);
  }
}

// ---------- account (optional sign-in: Google, or a code by email) ----------

// The session cookie is HTTP-only, so remember on this device whether it signed in: signed-out visitors
// (most of them) then never call /api/me. (The app keeps a session token instead; having one means signed in.)
const HINT = "qd.signedIn";
const hint = (on: boolean) => { try { if (on) localStorage.setItem(HINT, "1"); else localStorage.removeItem(HINT); } catch { /* ignore */ } };
const hasHint = () => { try { return localStorage.getItem(HINT) === "1"; } catch { return false; } };
/** This device signed in before (the account may still be loading). */
export const signedInOnDevice = hasHint;

/** Some way to sign in is offered: Google (a client id for this platform), a code by email, or Apple (the iOS app). */
export const signInOffered = (config: PublicConfig) => !!config.googleClientId || !!config.emailSignIn || !!platform.appleSignIn;

/** A gentle invitation to sign up (join.ts decides whether it is due), only for someone signed out on a device that has
 *  never signed in, and only where sign-in is offered. */
export function inviteToJoin(store: Store, reason: Exclude<JoinReason, "login">) {
  const { me, config } = store.getState();
  if (me || hasHint() || !signInOffered(config)) return;
  askToJoin(reason);
}

/** After sign-in: the account's favourites, plus the ones this device kept while signed out (added to the account). */
async function loadFavourites(store: Store) {
  const account = await api.getFavourites().catch(() => null);
  if (!account || !store.getState().me) return; // signed out meanwhile: the account's favourites do not come back
  const local = storedFavourites().filter((r) => !account.includes(r));
  const added = (await Promise.all(local.slice(0, 100).map((r) => api.setFavourite(r, true).then(() => r, () => null)))).filter((r): r is Ref => !!r);
  storeFavourites(local.filter((r) => !added.includes(r))); // the rest stays on the device until it can be added
  store.dispatch({ type: "favourites", refs: [...added, ...account] });
}

/** After any way of signing in: the app keeps its session token, then the account, its language and profile, and the
 *  favourites (this device's added to the account's). */
async function signedIn(store: Store, { token, ...me }: SignedIn) {
  if (token) await platform.saveSession(token);
  store.dispatch({ type: "me", me });
  hint(true);
  track("sign_in");
  adoptAccountLang(store, me.lang);
  adoptAccountProfile(store, me);
  await loadFavourites(store);
}

/** Google sign-in with its ID token. */
export async function signInWith(store: Store, credential: string) {
  try {
    await signedIn(store, await api.signInWithGoogle(credential));
  } catch {
    toast(store, t.signInFailed);
  }
}

/** Sign in with Apple (the iOS app). Cancelling it does nothing; a failure says so. */
export async function signInWithApple(store: Store) {
  try {
    const apple = await platform.appleSignIn?.();
    if (apple) await signedIn(store, await api.signInWithApple(apple.idToken, apple.name, apple.authorizationCode));
  } catch (e) {
    console.warn("apple sign-in failed:", e);
    toast(store, t.signInFailed);
  }
}

/** Why an email sign-in step did not work (ui/EmailSignIn.tsx says it). */
export type EmailProblem = "invalid" | "botCheck" | "wrong" | "expired" | "tooMany" | "wait" | "sendFailed" | "failed";
const reasonOf = (e: unknown) => (e instanceof api.AuthError ? e.reason : "");

/** Email sign-in, step 1: sends a 6-digit code to `email` (`turnstile`: the bot check's token, where asked). null = sent. */
export async function sendEmailCode(email: string, turnstile?: string): Promise<EmailProblem | null> {
  try {
    await api.startEmailSignIn(email, turnstile);
    return null;
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return status === 400 ? "invalid" : status === 403 && reasonOf(e) === "bot_check" ? "botCheck" : status === 429 ? "wait" : "sendFailed";
  }
}

/** Email sign-in, step 2: signs in with the code (an account is made the first time). null = signed in. */
export async function signInWithEmail(store: Store, email: string, code: string): Promise<EmailProblem | null> {
  let res: SignedIn;
  try {
    res = await api.verifyEmailCode(email, code);
  } catch (e) {
    const reason = reasonOf(e);
    return reason === "wrong_code" ? "wrong" : reason === "expired" ? "expired" : reason === "too_many_attempts" ? "tooMany"
      : (e as { status?: number })?.status === 429 ? "wait" : "failed";
  }
  try {
    await signedIn(store, res);
    return null;
  } catch {
    return "failed";
  }
}

/** Sets up sign-in (only where the server offers a way) and restores a session from an earlier visit. */
export async function initAccount(store: Store) {
  const { config } = store.getState();
  if (!signInOffered(config)) return;
  const clientId = config.googleClientId;
  if (clientId) platform.googleSignIn.init(clientId, (token) => void signInWith(store, token));
  const me = hasHint() || hasSessionToken() ? await api.getMe().catch((e) => {
    if ((e as { status?: number })?.status === 401) void platform.saveSession(null); // expired or deleted
    return null;
  }) : null;
  hint(!!me);
  if (!me) return;
  store.dispatch({ type: "me", me });
  adoptAccountLang(store, me.lang);
  adoptAccountProfile(store, me);
  await loadFavourites(store);
}

function signedOut(store: Store) {
  hint(false);
  storeFavourites([]);
  void platform.saveSession(null);
  newDevice(); // signed-out use is anonymous again, not linked to that account
  store.dispatch({ type: "me", me: null });
  platform.googleSignIn.signOut();
}

/** Signs out: the screens show the signed-out state at once. The request is sent first (it carries the session) and not
 *  waited for, so a slow or failing network keeps nothing of the account on screen. */
export async function signOut(store: Store) {
  const ended = api.signOut().catch(() => {});
  signedOut(store);
  await ended;
}

/** Deletes the account and everything kept with it (the profile asks the person to type a word first). */
export async function deleteAccount(store: Store): Promise<boolean> {
  try {
    await api.deleteMe();
    signedOut(store);
    store.dispatch({ type: "saved" });
    toast(store, t.accountDeleted);
    return true;
  } catch {
    toast(store, t.deleteFailed);
    return false;
  }
}

export function promptSignIn(store: Store) {
  toast(store, t.signInToSave);
  platform.googleSignIn.prompt();
}

/** Favourites work signed out too (kept on the device); signed in, they are kept with the account. */
export async function toggleFavourite(store: Store, ref: Ref) {
  const on = !store.getState().favourites.includes(ref);
  store.dispatch({ type: "favourite", ref, on });
  platform.haptic();
  if (!store.getState().me) {
    storeFavourites(store.getState().favourites);
    if (on) inviteToJoin(store, "like");
    return;
  }
  try {
    await api.setFavourite(ref, on);
  } catch {
    store.dispatch({ type: "favourite", ref, on: !on });
    toast(store, t.saveFailed);
  }
}

// ---------- My language ----------

/** Sets "My language": kept on the device (and the account when signed in); the design being made switches to that
 *  language's translation (a design without a translation keeps none). */
export function setLanguage(store: Store, lang: string) {
  if (!isLanguage(lang)) return;
  const first = store.getState().langPicker === "first";
  storeLang(lang);
  store.dispatch({ type: "langPicker", open: null });
  if (first) inviteToJoin(store, "welcome");
  if (store.getState().lang === lang) return;
  store.dispatch({ type: "lang", lang });
  // My language picks the translation: a default translation chosen before gives way to it.
  const { translation, ...rest } = store.getState().prefs;
  if (translation) setPrefs(store, rest, { design: false });
  const r = store.getState().recipe;
  // (with the translation voice preference on, the language's voice too, when it has one)
  const next = translationFor(lang);
  if (r.translation !== "none" || next === "none") {
    store.dispatch({ type: "patch", patch: { translation: next, ...(store.getState().prefs.voice ? voicePatch(true, next) : {}) } });
  }
  track("customise", { ...designProps(store.getState().recipe), key: "lang" });
  if (store.getState().me) void api.saveLang(lang).catch(() => {});
}

/** First-open question skipped: the suggested language stays (asked again never). */
export function skipLanguage(store: Store) {
  storeLang(store.getState().lang);
  store.dispatch({ type: "langPicker", open: null });
  inviteToJoin(store, "welcome");
}

/** Signed in on a device that never picked a language: the account's language applies. A device that did pick one
 *  gives it to an account that has none. */
function adoptAccountLang(store: Store, lang: string | null | undefined) {
  const picked = storedLang();
  if (isLanguage(lang) && (!picked || store.getState().langPicker === "first")) setLanguage(store, lang);
  else if (!lang && picked) void api.saveLang(picked).catch(() => {});
}

// ---------- Reflect ----------

export function openReflect(store: Store, ref: Ref, from: ReflectFrom) {
  store.dispatch({ type: "reflect", reflect: { ref, from } });
  track("reflect_open", { ref, key: from });
}

// ---------- profile: preferences, interests and the rest ----------

/** Saves profile fields to the account (signed in only); the account answers with the whole profile. */
export async function saveProfile(store: Store, patch: ProfilePatch): Promise<boolean> {
  if (!store.getState().me) return false;
  try {
    const me = await api.patchMe(patch);
    if (store.getState().me?.id !== me.id) return false; // signed out (or in as someone else) meanwhile: not brought back
    store.dispatch({ type: "me", me });
    return true;
  } catch {
    toast(store, t.saveFailed);
    return false;
  }
}

/** Reads the account's profile again (its numbers change with every saved design and share link). */
export async function refreshProfile(store: Store) {
  const me = await api.getMe().catch(() => null);
  if (me && store.getState().me?.id === me.id) store.dispatch({ type: "me", me });
}

/** Sets the defaults for new designs: kept on the device (and the account when signed in). The design in Create takes
 *  the changed ones too, unless `design` is false. */
export function setPrefs(store: Store, prefs: Prefs, { sync = true, design = true } = {}) {
  const s = store.getState(), before = s.prefs, next = cleanPrefs(prefs);
  storePrefs(next);
  if (samePrefs(before, next)) return;
  store.dispatch({ type: "prefs", prefs: next });
  if (design) {
    const patch: Partial<Recipe> = {};
    for (const k of ["reciter", "orientation", "effect", "animation"] as const) if (next[k] && next[k] !== before[k]) Object.assign(patch, { [k]: next[k] });
    if (next.translation !== before.translation) patch.translation = defaultTranslation(next, s.lang);
    if (!!next.voice !== !!before.voice) Object.assign(patch, voicePatch(next.voice, patch.translation ?? s.recipe.translation));
    if (Object.keys(patch).length) store.dispatch({ type: "patch", patch });
  }
  if (sync && s.me) void saveProfile(store, { prefs: next });
}

/** Topics that weight the Discover feed (at most 10): the device keeps them, and the account when signed in. */
export function setInterests(store: Store, ids: string[], sync = true) {
  const next = cleanInterests(ids);
  storeInterests(next);
  if (JSON.stringify(next) === JSON.stringify(store.getState().interests)) return;
  store.dispatch({ type: "interests", ids: next });
  if (sync && store.getState().me) void saveProfile(store, { interests: next });
}

/** Signed in: the account's preferences and interests apply on this device; an account without them gets this
 *  device's. */
function adoptAccountProfile(store: Store, me: Me) {
  const s = store.getState(), patch: ProfilePatch = {};
  const prefs = cleanPrefs(me.prefs), interests = cleanInterests(me.interests);
  if (Object.keys(prefs).length) setPrefs(store, prefs, { sync: false });
  else if (Object.keys(s.prefs).length) patch.prefs = s.prefs;
  if (interests.length) setInterests(store, interests, false);
  else if (s.interests.length) patch.interests = s.interests;
  if (Object.keys(patch).length) void api.patchMe(patch).then((m) => { if (store.getState().me?.id === m.id) store.dispatch({ type: "me", me: m }); }, () => {});
}

// ---------- Saved: designs are saved automatically ----------

const dataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/** After every export and share link the design goes to Saved: the account when signed in, else this device (also
 *  when the account cannot be reached, so nothing is lost). Never throws: the export itself already worked. */
export async function autoSave(store: Store, recipe: Recipe, surah: Surah | undefined, kind: CreationKind, thumb: () => Promise<Blob | null>) {
  const title = designTitle(recipe, surah);
  const image = await thumb().catch(() => null);
  let saved = false;
  if (store.getState().me) {
    try {
      await api.saveCreation({ recipe: structuredClone(recipe), title, kind, thumb: image ? await dataUrl(image) : undefined });
      saved = true;
    } catch { /* kept on the device below */ }
  }
  if (!saved) await saveDevice({ recipe: structuredClone(recipe), title, kind, thumb: image }).catch(() => {});
  store.dispatch({ type: "saved" });
  track("creation_save", { ...designProps(recipe), ...(kind === "link" ? {} : { kind }) });
  inviteToJoin(store, "create"); // kept on this device only: an account keeps it everywhere
  askInstall("create"); // only when no sign-up invitation is showing
}

/** Moves the designs kept on this device to the account, oldest first and keeping their times. → how many moved. */
export async function moveDeviceDesigns(store: Store): Promise<number> {
  let moved = 0;
  for (const d of (await listDevice()).reverse()) {
    try {
      await api.saveCreation({ recipe: d.recipe, title: d.title, kind: d.kind, thumb: d.thumb ? await dataUrl(d.thumb) : undefined, at: d.updated_at });
    } catch {
      break; // the rest stays on the device for the next try
    }
    await removeDevice(d.id);
    moved++;
  }
  store.dispatch({ type: "saved" });
  return moved;
}

/** Deletes a saved design (after the undo time has passed). */
export async function deleteSaved(store: Store, id: string, where: "account" | "device") {
  try {
    if (where === "account") await api.deleteCreation(id);
    else await removeDevice(id);
  } catch {
    toast(store, t.deleteFailed);
  }
  store.dispatch({ type: "saved" });
}
