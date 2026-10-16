// Everyone on the latest app (owner, 16 Oct 2026). Framework-free.
//  - Web: the service worker takes over as soon as a new version is installed (sw.ts skipWaiting), but the open page
//    still runs the old code. It reloads right away when the new version takes over in the first seconds after
//    opening (the old copy came from the cache), else the next time the app comes back after a while away; never
//    while a video or image is being made.
//  - iOS / Android app: older than /api/config minAppVersion → only an Update screen, with a link to the store.
import type { PublicConfig } from "../../../contracts/types";
import { platform } from "./platform";
import { t } from "./strings";

const STARTUP_MS = 10_000, AWAY_MS = 15 * 60_000;
const opened = Date.now();
let holds = 0;

/** Keeps the page from reloading for an update while something must not be cut off; call the result to let go. */
export function holdUpdates(): () => void {
  holds++;
  let done = false;
  return () => { if (!done) { done = true; holds--; } };
}

/** Web: reload into a new version when it is safe (see above). */
export function followUpdates(reg: ServiceWorkerRegistration) {
  const sw = navigator.serviceWorker;
  if (!sw.controller) return; // first visit: this page already runs the latest
  let ready = false, hiddenAt = 0;
  sw.addEventListener("controllerchange", () => {
    if (Date.now() - opened < STARTUP_MS && !holds) location.reload();
    else ready = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (ready && !holds && hiddenAt && Date.now() - hiddenAt >= AWAY_MS) location.reload();
    else void reg.update().catch(() => {}); // a long-open page looks for a new version when it comes back
  });
}

/** -1, 0 or 1, comparing "1.0.10" and "1.0.2" part by part. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const STORE: Record<"ios" | "android", string> = {
  ios: "https://apps.apple.com/app/id6820748453",
  android: "https://play.google.com/store/apps/details?id=com.ayahshare.app",
};

/** App: true (and the Update screen shown over everything) when this app is older than the server allows. */
export async function requireUpdate(config: PublicConfig | null): Promise<boolean> {
  const kind = platform.kind;
  if (kind === "web") return false;
  const min = config?.minAppVersion?.[kind], mine = await platform.appVersion();
  if (!min || !mine || compareVersions(mine, min) >= 0) return false;
  const screen = document.createElement("div");
  screen.className = "update-screen";
  screen.setAttribute("role", "alertdialog");
  screen.setAttribute("aria-labelledby", "update-title");
  const title = Object.assign(document.createElement("h1"), { id: "update-title", textContent: t.updateTitle });
  const text = Object.assign(document.createElement("p"), { textContent: t.updateText });
  const button = Object.assign(document.createElement("button"), { type: "button", className: "btn primary", textContent: t.updateButton });
  button.addEventListener("click", () => platform.openExternal(STORE[kind]));
  screen.append(title, text, button);
  document.body.append(screen);
  platform.ready();
  return true;
}
