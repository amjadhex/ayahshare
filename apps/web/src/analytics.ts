// Analytics client (contracts AppEvent). Batched, sent with sendBeacon when the page is hidden.
// Never blocks the UI and never throws: analytics failures are silently dropped.
import type { AppEvent, EventName } from "../../../contracts/types";
import { apiBase, apiUrl } from "./endpoint";

const ENDPOINT = "/api/events";
const MAX_BATCH = 20;
const FLUSH_MS = 30_000; // each POST costs a Worker request and a D1 batch, so a busy session sends a few, not dozens

function storedId(storage: () => Storage, key: string, renew = false) {
  try {
    const s = storage();
    let id = renew ? null : s.getItem(key);
    if (!id) s.setItem(key, (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID(); // private mode / blocked storage
  }
}

/** Anonymous device id. Also sent with sign-in and reports so the server can link them to this device.
 *  `let`: newDevice() replaces it, and modules that import it read the new value. */
export let anon = storedId(() => localStorage, "qd.anon");
let session = storedId(() => sessionStorage, "qd.session");

/** After sign-out or account deletion: new device and session ids, so what happens next on this device (another person's
 *  searches, a later sign-in) is not linked to that account. Queued events are from before, so they go out first. */
export function newDevice() {
  flush();
  anon = storedId(() => localStorage, "qd.anon", true);
  session = storedId(() => sessionStorage, "qd.session", true);
}

let queue: AppEvent[] = [];
let timer = 0;

const clip = (s: string | undefined, n: number) => (s === undefined ? undefined : s.slice(0, n));

/** Automated browsers (screenshot scripts, test runs: Playwright and Puppeteer set navigator.webdriver) send nothing, so
 *  they never count as devices or visits. */
const automated = typeof navigator !== "undefined" && navigator.webdriver === true;

export function track(name: EventName, props: AppEvent["props"] = {}) {
  if (automated) return;
  try {
    queue.push({ name, ts: Date.now(), anon, session, props: { ...props, q: clip(props.q, 100), reason: clip(props.reason, 200) } });
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = window.setTimeout(flush, FLUSH_MS);
  } catch { /* ignore */ }
}

export function flush(beacon = false) {
  clearTimeout(timer);
  timer = 0;
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  try {
    // A beacon to another origin (the app) must be text/plain: browsers refuse a cross-origin JSON beacon.
    const type = apiBase() ? "text/plain" : "application/json";
    if (beacon && navigator.sendBeacon?.(apiUrl(ENDPOINT), new Blob([body], { type }))) return;
    fetch(apiUrl(ENDPOINT), { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}

addEventListener("pagehide", () => flush(true));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
addEventListener("error", (e) => track("error", { reason: String(e.message) }));
addEventListener("unhandledrejection", (e) => track("error", { reason: String(e.reason?.message ?? e.reason) }));
