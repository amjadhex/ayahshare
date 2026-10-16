// Service worker. Built to /sw.js; the build replaces __SHELL__ / __VERSION__ (see vite.config.ts).
//  - app shell: precached on install, served cache-first, page navigations fall back to it offline
//  - fonts, /data/*, Quran text (/qapi): stale-while-revalidate (content never changes). That includes /data/clips.json,
//    so a visit never waits for the whole catalogue again: suggestions and library search come from the server, already
//    filtered, and a clip an admin hides leaves the library's first page (read from the catalogue) on the next visit
//  - /data/bg/*: network first (a clip hidden by an admin must drop out of the suggestions at once), cache offline
//  - thumbnails: cache-first; clips, posters and recitations (/audio/*: never change): cached when downloaded in full,
//    served from the cache (a range request gets a slice), only the most recent are kept (LIMITS)
//  - /api/*, /s/* and /admin/* always go to the network
declare const self: ServiceWorkerGlobalScope;
declare const __SHELL__: string[];
declare const __VERSION__: string;

const SHELL = `shell-${__VERSION__}`;
const STATIC = "static-v1";   // fonts, data files, Quran text
const THUMBS = "thumbs-v1";
const CLIPS = "clips-v1";
const POSTERS = "posters-v1";
const AUDIO = "audio-v1";
// How many of each are kept (the oldest go first), sized for a phone: about 80 MB in all.
//  - clips: 30 ≈ 36 MB (the library's clips are 1.2 MB on average, 3.3 MB at most). A Reels session keeps 7 reels in
//    memory; this covers swiping back further, reels seen again, Create's preview and the export of a clip just watched
//    (the export downloads the clip again), and offline viewing.
//  - posters: 60 ≈ 4 MB (about 70 KB each; reels warm the poster of the third reel ahead, so more posters than clips).
//  - recitations (and translation voices): 80 ≈ 32 MB (one ayah is 70 KB to 1 MB, about 400 KB for the feed's ayahs):
//    the last 20 to 40 reels' audio (a reel has 1 to 3 ayahs, twice that with a voice), and the editor's.
//  - thumbnails: 300 ≈ 5 MB (about 15 KB each).
const LIMITS: Record<string, number> = { [THUMBS]: 300, [CLIPS]: 30, [POSTERS]: 60, [AUDIO]: 80 };
const KEEP = [SHELL, STATIC, THUMBS, CLIPS, POSTERS, AUDIO];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(__SHELL__)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(name: string) {
  const cache = await caches.open(name), keys = await cache.keys(), max = LIMITS[name];
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function cacheFirst(req: Request, name: string) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) {
    const cache = await caches.open(name);
    await cache.put(req, res.clone());
    if (LIMITS[name]) trim(name);
  }
  return res;
}

/** Clips, posters and recitations: served from the cache once a full copy is there (the Feed and the export download
 *  whole files); the players' range requests get a slice of it. Range requests on a miss go straight to the network. */
async function media(req: Request, name: string) {
  const cache = await caches.open(name), hit = await cache.match(req.url);
  const range = req.headers.get("range");
  if (!hit) return range ? fetch(req) : cacheFirst(req, name);
  if (!range) return hit;
  const buf = await hit.arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m?.[1] ? +m[1] : 0, end = m?.[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (m && !m[1] && m[2]) [start, end] = [Math.max(0, size - +m[2]), size - 1];
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": hit.headers.get("Content-Type") ?? "application/octet-stream", "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
  });
}

async function staleWhileRevalidate(req: Request, event: FetchEvent) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res.ok) return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  if (hit) { event.waitUntil(update.catch(() => {})); return hit; }
  return update;
}

async function networkFirst(req: Request) {
  try {
    const res = await fetch(req);
    if (res.ok) await (await caches.open(STATIC)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req, { cacheName: STATIC })) ?? Response.error();
  }
}

async function navigate(req: Request) {
  try {
    return await fetch(req);
  } catch {
    return (await caches.match("/app", { cacheName: SHELL })) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const same = url.origin === location.origin, path = url.pathname;
  if (same && path.startsWith("/media/clips/")) return event.respondWith(media(req, CLIPS));
  if (same && path.startsWith("/media/posters/")) return event.respondWith(media(req, POSTERS));
  if (same && path.startsWith("/audio/")) return event.respondWith(media(req, AUDIO));
  if (req.headers.has("range") || (same && /^\/(api|s|admin)(\/|$)/.test(path))) return;
  if (req.mode === "navigate") return event.respondWith(navigate(req));
  if (same && (__SHELL__.includes(path) || path.startsWith("/assets/"))) return event.respondWith(cacheFirst(req, SHELL));
  if (same && path.startsWith("/media/thumbs/")) return event.respondWith(cacheFirst(req, THUMBS));
  if (same && path.startsWith("/data/bg/")) return event.respondWith(networkFirst(req));
  if ((same && /^\/(data|qapi)\//.test(path)) || /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    return event.respondWith(staleWhileRevalidate(req, event));
  }
});

// ---------- the daily reminder (Web Push, webpush.ts; sent by the Worker at the person's time) ----------

self.addEventListener("push", (event) => {
  let msg: { title?: string; body?: string; url?: string } = {};
  try { msg = event.data?.json() ?? {}; } catch { /* shown with the defaults below */ }
  event.waitUntil(self.registration.showNotification(msg.title || "Today's ayah", {
    body: msg.body || "Today's ayah is ready to watch and share.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "today", // a newer reminder replaces an unread one
    data: { url: msg.url || "/app?today=reminder" },
  }));
});

/** A tap opens today's ayah: in the AyahShare tab if one is open, else a new one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? "/app?today=reminder", location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === location.origin) as WindowClient | undefined;
    if (tab) {
      await tab.focus();
      await tab.navigate(url).catch(() => self.clients.openWindow(url));
    } else await self.clients.openWindow(url);
  })());
});

export {};
