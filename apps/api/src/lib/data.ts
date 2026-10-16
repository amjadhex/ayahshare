import { cacheUrl, edgeJson } from "./edge";

// Static data files written by the pipeline (apps/web/public/data → dist/data), read through the
// ASSETS binding and kept in isolate memory. A file that is not published yet reads as null.
const files = new Map<string, Promise<unknown>>();

export function readData<T>(env: Env, path: string): Promise<T | null> {
  let file = files.get(path);
  if (!file) {
    file = env.ASSETS.fetch(`https://assets.local/data/${path}`)
      // The single-page-app fallback answers a missing file with index.html, so check the type too.
      .then((res) => (res.ok && res.headers.get("Content-Type")?.includes("json") ? res.json() : null))
      .catch(() => null)
      .then((data) => {
        if (data === null) files.delete(path); // try again on the next request
        return data;
      });
    files.set(path, file);
  }
  return file as Promise<T | null>;
}

let hidden: { ids: Promise<Set<string>>; until: number } | null = null;
const HIDDEN_TTL = 60; // seconds

/** Clip ids set to hidden/rejected in admin (D1), re-read at most once a minute per isolate and per colo. */
export function hiddenClips(env: Env, requestUrl: string): Promise<Set<string>> {
  if (!hidden || hidden.until < Date.now()) {
    // IN rather than != 'active', so D1 reads the clips_status index instead of the whole table.
    const ids = edgeJson(cacheUrl(requestUrl, "hidden-clips"), HIDDEN_TTL, async () =>
      (await env.DB.prepare("SELECT id FROM clips WHERE status IN ('hidden', 'rejected')").all<{ id: string }>()).results.map((x) => x.id))
      .then((list) => new Set(list))
      .catch((e) => {
        console.warn("hidden clips unavailable:", String(e));
        return new Set<string>();
      });
    hidden = { ids, until: Date.now() + HIDDEN_TTL * 1000 };
  }
  return hidden.ids;
}

/** Forget the hidden-clip list after an admin change (this isolate and colo; others refresh within a minute). */
export async function resetHiddenClips(requestUrl: string) {
  hidden = null;
  await caches.default.delete(cacheUrl(requestUrl, "hidden-clips"));
}

const clipSets = new WeakMap<object, Set<string>>();

/** The clip ids in clips.json (empty until it is published), built once per loaded file. */
export async function clipIds(env: Env): Promise<ReadonlySet<string>> {
  const clips = await readData<{ id: string }[]>(env, "clips.json");
  if (!Array.isArray(clips)) return new Set();
  let ids = clipSets.get(clips);
  if (!ids) clipSets.set(clips, (ids = new Set(clips.map((c) => c.id))));
  return ids;
}
