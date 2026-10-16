// Installable app: service worker (production builds only, not inside the iOS / Android app, which carries its files
// with it) and the install prompt. Framework-free.
import { getJoin } from "./join";
import { isNativeApp } from "./platform";
import { followUpdates } from "./update";

interface InstallPrompt extends Event { prompt(): Promise<void> }

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** True while the browser offers to install the app (the Install button is shown). */
export const canInstall = () => !!deferred;
export function onInstallChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function install() {
  const d = deferred;
  deferred = null;
  emit();
  await d?.prompt();
}

// ---------- promoting the install (owner, 8 Oct 2026: the web app comes first, so ask browser visitors to install it) ----------

/** Opened from the home screen (installed) rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)")?.matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** In-app browsers (Instagram, Facebook…) cannot add to the home screen. */
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok/i.test(navigator.userAgent);

/** How this browser installs: its own prompt, the iPhone/iPad Share menu, or not at all (installed, the native app). */
export function installKind(): "prompt" | "ios" | null {
  if (isNativeApp() || isStandalone()) return null;
  if (deferred) return "prompt";
  return ios() && !inAppBrowser() ? "ios" : null;
}

// The install sheet asks on its own at most 3 times, 3 days apart: from the second day someone visits, and after they
// first make something. The Install button on Home opens it any time.
const KEY = "ayahshare.install.v1";
const GAP_MS = 3 * 24 * 3600 * 1000, MAX_ASKS = 3;
interface Seen { days: number; day: string; asked: number[] }
const today = () => new Date().toDateString();
function read(): Seen {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Seen | null;
    if (v && typeof v.days === "number" && typeof v.day === "string" && Array.isArray(v.asked)) return v;
  } catch { /* start again */ }
  return { days: 0, day: "", asked: [] };
}
const write = (v: Seen) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

let asking = false;
export const isAskingInstall = () => asking;
const setAsking = (on: boolean) => { if (asking !== on) { asking = on; emit(); } };
/** The Install button: open the sheet now. */
export const openInstall = () => setAsking(true);
export const closeInstall = () => setAsking(false);

// Never while a share sheet or an export is open, or within a minute after one: on iPhone the sheet would open behind
// the system share sheet. The ask waits (it is not used up) and is made once it is quiet again.
const QUIET_MS = 60_000;
let busy = 0, quietUntil = 0, pending: "visit" | "create" | null = null, retry: ReturnType<typeof setTimeout> | undefined;
function askWhenQuiet() {
  clearTimeout(retry);
  retry = setTimeout(() => { const reason = pending; pending = null; if (reason) askInstall(reason); }, Math.max(0, quietUntil - Date.now()) + 250);
}
/** A share sheet or an export starts. → call it when that ends (the quiet minute starts then). */
export function installBusy() {
  busy++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    busy--;
    quietUntil = Date.now() + QUIET_MS;
    if (pending && !busy) askWhenQuiet();
  };
}

/** Asks on its own if due ("visit": from the second day of visits; "create": after making something). */
export function askInstall(reason: "visit" | "create", now = Date.now()) {
  if (asking || getJoin() || !installKind()) return; // never on top of, or right after, a sign-up invitation
  const seen = read();
  if (reason === "visit" && seen.days < 2) return;
  if (seen.asked.length >= MAX_ASKS || now - (seen.asked.at(-1) ?? 0) < GAP_MS) return;
  if (busy > 0 || Date.now() < quietUntil) {
    if (reason === "create" || !pending) pending = reason;
    if (!busy) askWhenQuiet();
    return;
  }
  write({ ...seen, asked: [...seen.asked, now] });
  setAsking(true);
}

/** Counts this visit's day (once per local day). */
function countVisit() {
  const seen = read();
  if (seen.day !== today()) write({ ...seen, days: seen.days + 1, day: today() });
}

// Home's install strip: closed with ×, it stays away for a week.
const STRIP_KEY = "ayahshare.installStrip.v1", STRIP_MS = 7 * 24 * 3600 * 1000;
export function stripHidden(now = Date.now()) {
  try { return now - Number(localStorage.getItem(STRIP_KEY) ?? 0) < STRIP_MS; } catch { return false; }
}
export function hideStrip(now = Date.now()) {
  try { localStorage.setItem(STRIP_KEY, String(now)); } catch { /* private mode: back next visit */ }
  emit();
}

/** Tests: forget the visits and asks. */
export function resetInstallAsks() {
  asking = false;
  busy = 0; quietUntil = 0; pending = null;
  clearTimeout(retry);
  try { localStorage.removeItem(KEY); localStorage.removeItem(STRIP_KEY); } catch { /* ignore */ }
  emit();
}

export function initPwa(onOffline: () => void) {
  if (import.meta.env.PROD && "serviceWorker" in navigator && !isNativeApp()) {
    const register = () => navigator.serviceWorker.register("/sw.js").then(followUpdates, () => {});
    if (document.readyState === "complete") register(); else addEventListener("load", register);
  }
  countVisit();
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    emit();
    setTimeout(() => askInstall("visit"), 8000); // a moment after arriving, not over the first screen
  });
  addEventListener("appinstalled", () => { deferred = null; setAsking(false); emit(); });
  if (installKind() === "ios") setTimeout(() => askInstall("visit"), 8000);
  addEventListener("offline", onOffline);
}
