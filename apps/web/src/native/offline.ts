// The app's offline store on Capacitor: what the app downloads from the Worker is kept in the app's cache folder, so it
// opens fast and keeps working with a weak or no connection. Loaded only inside the iOS / Android app (platform-native).
//
// - endpoint.ts apiUrl() hands out the local file (Capacitor.convertFileSrc) for a media or text path that is on disk,
//   so <video>, <audio>, <img> and fetch() read it from the device; a path that is not there yet goes to the network
//   and is queued for download, so what the Feed shows or prepares lands on disk.
// - window.fetch is wrapped for GET requests to the Worker: a media or text file the page fetches is downloaded once
//   (natively, straight to disk) and then read from disk; small JSON that can change is answered from disk at once and
//   refreshed behind the scenes (offline-core.ts Kind explains each group).
// - Size: 300 MB of media, 100 MB of everything else, least recently used removed first. The index is a JSON file next
//   to the files and is checked against them at start (the system may clear the cache folder at any time).
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { setLocalCopy } from "../endpoint";
import { CAPS, createQueue, fileNameFor, isLocalFirst, kindOf, parseIndex, reconcile, victims, type Caps, type Index, type Kind } from "./offline-core";

const DIR = "offline";
const INDEX = "index.json";
const at = (file: string) => ({ path: `${DIR}/${file}`, directory: Directory.Cache });
/** How long a request for the signed-in person's data waits for the network before the device's copy answers. */
const USER_WAIT_MS = 5000;

export interface OfflineStore {
  /** Removes the signed-in person's data (called when the session changes). */
  clearUser(): Promise<void>;
  /** Writes the index now (the app is going to the background). */
  flush(): Promise<void>;
}

/** `caps`: the size caps (tests pass smaller ones). */
export async function startOffline(apiBase: string, caps: Caps = CAPS): Promise<OfflineStore> {
  const base = apiBase.replace(/\/+$/, "");
  await Filesystem.mkdir({ ...at(""), recursive: true }).catch(() => {}); // exists already
  const root = (await Filesystem.getUri(at(""))).uri.replace(/\/+$/, "");
  const [saved, listing] = await Promise.all([
    Filesystem.readFile({ ...at(INDEX), encoding: Encoding.UTF8 }).then((r) => String(r.data), () => null),
    Filesystem.readdir(at("")).then((r) => r.files.map((f) => f.name), () => [] as string[]),
  ]);
  const checked = reconcile(parseIndex(saved), listing, INDEX);
  let index: Index = checked.index;
  for (const f of checked.orphans) void Filesystem.deleteFile(at(f)).catch(() => {});

  const localUrl = (file: string) => Capacitor.convertFileSrc(`${root}/${file}`);
  const localPrefix = localUrl("");
  const original = window.fetch.bind(window);

  /** A fetch of a file in the store. iOS answers a media file (mp4, mp3…) without an HTTP status, which fetch() reports
   *  as status 0 although the body is all there; it is passed on as the 200 it is. */
  async function fetchLocal(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const res = await original(input, init);
    if (res.status !== 0) return res;
    const blob = await res.blob();
    const url = String(input instanceof Request ? input.url : input);
    return new Response(blob, { status: 200, headers: { "Content-Type": blob.type || typeOf(url), "Content-Length": String(blob.size) } });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => Filesystem.writeFile({ ...at(INDEX), data: JSON.stringify(index), encoding: Encoding.UTF8 }).then(() => {}, () => {});
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => void save(), 2000); };

  function remember(path: string, file: string, size: number, kind: Kind) {
    index[path] = { file, size, kind, used: Date.now() };
    for (const p of victims(index, caps, new Set([path]))) {
      const e = index[p];
      delete index[p];
      if (e.file !== file) void Filesystem.deleteFile(at(e.file)).catch(() => {});
    }
    changed();
  }

  /** Downloads a media or text path to disk (media natively, never through the page's memory). */
  async function download(path: string) {
    const kind = kindOf(path);
    if (!kind) return;
    const file = fileNameFor(path, kind);
    if (kind === "media") {
      const part = `${file}.part`;
      await Filesystem.downloadFile({ url: base + path, ...at(part), recursive: true, connectTimeout: 15_000, readTimeout: 30_000 });
      const { size } = await Filesystem.stat(at(part));
      if (!size) throw new Error("empty download");
      await Filesystem.deleteFile(at(file)).catch(() => {}); // iOS will not rename onto an existing file
      await Filesystem.rename({ from: `${DIR}/${part}`, to: `${DIR}/${file}`, directory: Directory.Cache, toDirectory: Directory.Cache });
      remember(path, file, size, kind);
    } else {
      const res = await original(base + path, { credentials: "omit" });
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) throw new Error(`${res.status}`);
      await store(path, kind, await res.text());
    }
  }

  async function store(path: string, kind: Kind, text: string) {
    const file = fileNameFor(path, kind);
    await Filesystem.writeFile({ ...at(file), data: text, encoding: Encoding.UTF8 });
    remember(path, file, new Blob([text]).size, kind);
  }

  const queue = createQueue(download);

  setLocalCopy((path) => {
    const kind = kindOf(path);
    if (!isLocalFirst(kind)) return null;
    const e = index[path];
    if (!e) {
      queue.later(path);
      return null;
    }
    e.used = Date.now();
    changed();
    return localUrl(e.file);
  });

  /** The device's copy as a response (a fetch of the local file, so the body streams from disk). */
  async function fromDisk(path: string, signal?: AbortSignal | null): Promise<Response | null> {
    const e = index[path];
    if (!e) return null;
    e.used = Date.now();
    changed();
    const res = await fetchLocal(localUrl(e.file), { signal }).catch((err) => {
      if ((err as Error)?.name === "AbortError") throw err;
      return null;
    });
    if (res?.ok) return res;
    // The file went missing (cleared by the system): forget it.
    delete index[path];
    changed();
    return null;
  }

  const refreshing = new Set<string>();
  /** Fetches a fresh / user path from the network and keeps a copy of a good JSON answer. */
  async function network(path: string, kind: Kind, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const res = await original(input, init);
    if (res.ok && res.headers.get("content-type")?.includes("json")) {
      void res.clone().text().then((text) => store(path, kind, text)).catch(() => {});
    }
    return res;
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = req ? req.url : String(input);
    if (url.startsWith(localPrefix)) return fetchLocal(input, init); // a file apiUrl() handed out
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    if (method !== "GET" || !url.startsWith(`${base}/`)) return original(input, init);
    if (new Headers(init?.headers ?? req?.headers).has("Range")) return original(input, init);
    const path = url.slice(base.length);
    const kind = kindOf(path);
    if (!kind) return original(input, init);
    const signal = init?.signal ?? req?.signal;

    if (isLocalFirst(kind)) {
      // Usually apiUrl() already gave the local file; this is a path fetched before it was on disk.
      const hit = await fromDisk(path, signal);
      if (hit) return hit;
      try {
        await abortable(queue.now(path), signal);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") throw e;
        return original(input, init); // could not keep it (offline, an error page): answer as before
      }
      return (await fromDisk(path, signal)) ?? original(input, init);
    }

    if (kind === "fresh") {
      const hit = await fromDisk(path, signal);
      if (hit) {
        if (!refreshing.has(path)) {
          refreshing.add(path);
          void network(path, kind, url, { credentials: "omit", headers: init?.headers ?? req?.headers })
            .catch(() => {}).finally(() => refreshing.delete(path));
        }
        return hit;
      }
      return network(path, kind, input, init);
    }

    // user: the network first; the copy when it fails or is slow.
    const live = network(path, kind, input, init);
    if (!index[path]) return live;
    const slow = new Promise<null>((ok) => setTimeout(() => ok(null), USER_WAIT_MS));
    const first = await Promise.race([live.catch(() => null), slow]);
    if (first && first.status < 500) return first;
    return (await fromDisk(path, signal)) ?? live;
  };

  return {
    async clearUser() {
      for (const [path, e] of Object.entries(index)) {
        if (e.kind !== "user") continue;
        delete index[path];
        void Filesystem.deleteFile(at(e.file)).catch(() => {});
      }
      changed();
    },
    async flush() {
      clearTimeout(timer);
      await save();
    },
  };
}

/** Rejects with an AbortError when `signal` aborts first; the work itself goes on (the file is still worth keeping). */
function abortable<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

const TYPES: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg",
  webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", json: "application/json",
};
/** The content type for a file name's extension. */
export const typeOf = (url: string) => TYPES[url.split("?")[0].split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
