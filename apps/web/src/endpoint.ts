// Where requests go. The web app is served by the API's own Worker, so its paths stay relative and the session is an
// HTTP-only cookie. The iOS / Android app loads its pages from the device: the paths the Worker answers go to the
// deployed Worker instead (`setApiBase`, called by the app's platform adapter), and the session is a token sent as a
// Bearer header. Framework-free; imports nothing, so api.ts and analytics.ts can both use it.

let base = "";
let token: string | null = null;

/** Paths the Worker answers itself (apps/api/wrangler.jsonc `run_worker_first`). Everything else (the page, scripts,
 *  fonts, data/surahs.json…) is part of the app and loads from wherever the page came from. */
const WORKER = /^\/(?:api|qapi|audio|media|s)\/|^\/data\/(?:clips\.json|bg\/)/;

/** The app sets the API's origin (e.g. https://ayahshare.com); "" = this page's origin. */
export const setApiBase = (origin: string) => void (base = origin.replace(/\/+$/, ""));
export const apiBase = () => base;

/** The app's offline store (native/offline.ts): the device's copy of a Worker path (a local file URL), or null when
 *  it has none yet. Never set on the web. */
let local: ((path: string) => string | null) | null = null;
export const setLocalCopy = (fn: typeof local) => void (local = fn);

/** The URL to request for an app path: absolute for Worker paths in the app (or the device's copy, once it has one),
 *  the path itself otherwise. */
export const apiUrl = (path: string) => (base && WORKER.test(path) ? local?.(path) ?? base + path : path);

/** Whether an app path can load without the network: always on the web; in the app, only when the device already has
 *  its copy (asking queues a download, like apiUrl). For the Feed to skip uncached reels while offline. */
export const onDevice = (path: string) => !base || !WORKER.test(path) || !!local?.(path);

/** The app's sign-in session (null = signed out). The web leaves this null and relies on the cookie. */
export const setSessionToken = (value: string | null) => void (token = value);
export const hasSessionToken = () => !!token;

/** fetch() for an app path: the right host, and the session (cookie on the web, Bearer header in the app). */
export function request(path: string, init: RequestInit = {}): Promise<Response> {
  const url = apiUrl(path);
  if (url === path) return fetch(path, { credentials: "same-origin", ...init });
  const headers = new Headers(init.headers);
  if (token && path.startsWith("/api/")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, credentials: "omit", headers });
}
