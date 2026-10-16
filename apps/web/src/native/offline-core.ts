// The app's offline store, the parts without Capacitor (offline.ts is the glue): which Worker paths are kept on the
// device and how, their file names, the size cap (least recently used goes first), checking the index against the files
// on disk, and the download queue. Framework-free; imported only by the iOS / Android app.

/** How a Worker path is kept:
 *  - media: clips, posters, thumbnails, recitations, translation voices. Read from disk once downloaded (endpoint.ts
 *    apiUrl gives the local file); the size cap applies.
 *  - text: the Quran text and translations (never change). Read from disk once downloaded; kept under their own,
 *    larger cap, so the text someone reads stays available offline.
 *  - fresh: small public JSON that can change (config, clip lists, trending, tafsir, reflections, shared designs).
 *    Served from disk at once when there is a copy and refreshed in the background; from the network otherwise.
 *  - user: the signed-in person's own data (me, creations, favourites). From the network,
 *    the copy on disk only when the network fails or is too slow; removed when the session changes. */
export type Kind = "media" | "text" | "fresh" | "user";

const RULES: [RegExp, Kind | null][] = [
  [/^\/api\/(?:me|creations|favourites)(?:\?|$)/, "user"],
  // Saved designs' private thumbnails, and the privacy notice and terms (they change): always from the network.
  [/^\/media\/(?:creations|legal)\//, null],
  [/^\/qapi\//, "text"],
  [/^\/media\/translations\//, "text"],
  [/^\/(?:audio|media)\//, "media"],
  [/^\/data\/(?:clips\.json|bg\/[\w.-]+)$/, "fresh"],
  [/^\/api\/(?:config|trending)(?:\?|$)/, "fresh"],
  [/^\/api\/(?:tafsir|reflections|clips|shares)\/[\w:.-]+(?:\?|$)/, "fresh"],
];

/** How the path is kept on the device, or null when it is never kept (writes, search, stats, share pages…). */
export function kindOf(path: string): Kind | null {
  // A folder ("/audio/", which code may resolve as a prefix) is never a file to keep.
  if (path.includes("..") || path.split("?")[0].endsWith("/")) return null;
  for (const [re, kind] of RULES) if (re.test(path)) return kind;
  return null;
}

/** Served from disk as soon as it is there (endpoint.ts apiUrl hands out the local file). */
export const isLocalFirst = (kind: Kind | null) => kind === "media" || kind === "text";

/** cyrb53: a fast 53-bit string hash (plenty for a few thousand file names). */
export function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const EXT = /\.(mp4|webm|mov|mp3|m4a|aac|ogg|webp|jpe?g|png|gif|svg|json)$/i;

/** The file a path is kept in. The extension matters: the WebView's local server takes the content type from it. */
export function fileNameFor(path: string, kind: Kind): string {
  const ext = path.split("?")[0].match(EXT)?.[1].toLowerCase();
  return `${hash(path)}.${ext ?? (kind === "media" ? "bin" : "json")}`;
}

export interface Entry {
  file: string;
  size: number;
  kind: Kind;
  /** Last used (ms). */
  used: number;
}
export type Index = Record<string, Entry>;

export interface Caps {
  /** Bytes for media. */
  media: number;
  /** Bytes for everything else (text, fresh, user). */
  text: number;
}
export const CAPS: Caps = { media: 300 * 1024 * 1024, text: 100 * 1024 * 1024 };

/** The paths to remove so each group is within its cap: least recently used first, never one in `keep`. */
export function victims(index: Index, caps: Caps, keep: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const media of [true, false]) {
    const group = Object.entries(index).filter(([, e]) => (e.kind === "media") === media);
    let total = group.reduce((n, [, e]) => n + e.size, 0);
    const cap = media ? caps.media : caps.text;
    for (const [path, e] of group.sort((a, b) => a[1].used - b[1].used)) {
      if (total <= cap) break;
      if (keep.has(path)) continue;
      out.push(path);
      total -= e.size;
    }
  }
  return out;
}

/** Checks the index against the files on disk (the system may clear the cache folder): entries whose file is gone are
 *  dropped, and files no entry names (half-done downloads, entries lost) are returned for deletion. */
export function reconcile(index: Index, files: readonly string[], indexFile: string): { index: Index; orphans: string[] } {
  const present = new Set(files);
  const kept: Index = {};
  for (const [path, e] of Object.entries(index)) if (e && typeof e.file === "string" && present.has(e.file)) kept[path] = e;
  const named = new Set(Object.values(kept).map((e) => e.file));
  return { index: kept, orphans: files.filter((f) => f !== indexFile && !named.has(f)) };
}

/** Reads a saved index; anything unreadable starts empty. */
export function parseIndex(text: string | null | undefined): Index {
  try {
    const v = JSON.parse(text ?? "") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Index) : {};
  } catch {
    return {};
  }
}

/** Downloads, one per path at a time. `urgent` (a page is waiting for it) starts at once; background ones (a path the
 *  page showed from the network) run `limit` at a time, after a short delay so the page's own request can claim the
 *  download first, and a path that failed is not tried again for `retryMs`. */
export function createQueue(run: (path: string) => Promise<void>, { limit = 2, delayMs = 1500, retryMs = 60_000, now = Date.now } = {}) {
  const running = new Map<string, Promise<void>>();
  const waiting: string[] = [];
  const failed = new Map<string, number>();
  let background = 0;

  function start(path: string, isBackground: boolean): Promise<void> {
    if (isBackground) background++;
    const job = run(path).then(
      () => void failed.delete(path),
      (e) => { failed.set(path, now()); throw e; },
    ).finally(() => {
      running.delete(path);
      if (isBackground) background--;
      pump();
    });
    running.set(path, job);
    return job;
  }

  function pump() {
    while (background < limit && waiting.length) {
      const path = waiting.shift()!;
      if (!running.has(path)) start(path, true).catch(() => {});
    }
  }

  return {
    /** Downloads `path` (or joins the download already running). Resolves when it is on disk. */
    now(path: string): Promise<void> {
      const i = waiting.indexOf(path);
      if (i >= 0) waiting.splice(i, 1);
      return running.get(path) ?? start(path, false);
    },
    /** Downloads `path` some time soon, unless it is already on its way or failed a moment ago. */
    later(path: string) {
      const at = failed.get(path);
      if (running.has(path) || waiting.includes(path) || (at !== undefined && now() - at < retryMs)) return;
      waiting.push(path);
      setTimeout(pump, delayMs);
    },
    get size() { return running.size + waiting.length; },
  };
}
