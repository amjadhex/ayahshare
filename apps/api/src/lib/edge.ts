// Small JSON values kept in this colo's cache (caches.default) in front of D1. D1 reads cost ~0.4 s from far colos
// (measured from India), a cache hit a few ms. Keys live under <origin>/api/_cache/, a path that is never served;
// ayahshare.com and www.ayahshare.com share one set of keys.
import { publicOrigin } from "./http";

export const cacheUrl = (requestUrl: string, name: string) => `${publicOrigin(requestUrl)}/api/_cache/${name}`;

/** Lower case, NFKC, punctuation and runs of spaces collapsed: "Patience?" and "patience" share a cache row. */
export function normalise(q: string): string {
  return q.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim();
}

/** The cached value, else load() — stored for `ttl` seconds unless it is null. */
export async function edgeJson<T>(url: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = await caches.default.match(url);
  if (hit) return hit.json<T>();
  const value = await load();
  if (value !== null) await putJson(url, ttl, value);
  return value;
}

export const putJson = (url: string, ttl: number, value: unknown) =>
  caches.default.put(url, Response.json(value, { headers: { "Cache-Control": `public, max-age=${ttl}` } }));
