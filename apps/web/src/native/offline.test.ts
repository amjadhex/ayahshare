// The app's offline store on stand-in Capacitor plugins (an in-memory cache folder) and a stand-in network: what is
// served from disk, what is downloaded and kept, what happens offline, and that the web is unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaUrl } from "../api";
import { apiUrl, request, setApiBase, setLocalCopy } from "../endpoint";

const API = "https://api.example";
const LOCAL = "capacitor://localhost/_capacitor_file_/cache";

const fs = vi.hoisted(() => {
  const files = new Map<string, string>(); // "offline/<name>" → contents
  const key = (o: { path: string }) => o.path.replace(/\/+$/, "");
  return {
    files,
    net: { online: true, served: [] as string[], body: (url: string) => `body of ${url}` },
    Filesystem: {
      mkdir: vi.fn(async () => {}),
      getUri: vi.fn(async (o: { path: string }) => ({ uri: `file:///cache/${key(o)}` })),
      readFile: vi.fn(async (o: { path: string }) => {
        if (!files.has(key(o))) throw new Error("missing");
        return { data: files.get(key(o))! };
      }),
      readdir: vi.fn(async () => ({ files: [...files.keys()].map((k) => ({ name: k.slice("offline/".length) })) })),
      writeFile: vi.fn(async (o: { path: string; data: string }) => void files.set(key(o), o.data)),
      deleteFile: vi.fn(async (o: { path: string }) => void files.delete(key(o))),
      stat: vi.fn(async (o: { path: string }) => ({ size: files.get(key(o))?.length ?? 0 })),
      rename: vi.fn(async (o: { from: string; to: string }) => {
        files.set(o.to, files.get(o.from)!);
        files.delete(o.from);
      }),
      downloadFile: vi.fn(async (o: { url: string; path: string }) => {
        if (!fs.net.online) throw new Error("offline");
        fs.net.served.push(o.url);
        files.set(o.path, fs.net.body(o.url));
        return { path: o.path };
      }),
    },
  };
});

vi.mock("@capacitor/filesystem", () => ({ Filesystem: fs.Filesystem, Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" } }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { convertFileSrc: (uri: string) => uri.replace("file:///cache", LOCAL) },
}));

const { startOffline } = await import("./offline");

/** The stand-in network and the WebView's local file server. */
const network = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(LOCAL)) {
    const name = url.slice(`${LOCAL}/`.length);
    const body = fs.files.get(name);
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { headers: { "Content-Type": "application/json" } });
  }
  if (!fs.net.online) throw new TypeError("Load failed");
  fs.net.served.push(url);
  return Response.json({ from: "network", url, n: ++answers });
});

let answers = 0;
const flush = () => new Promise((ok) => setTimeout(ok, 0));
const original = window.fetch;

beforeEach(() => {
  fs.files.clear();
  fs.net.online = true;
  fs.net.served = [];
  answers = 0;
  window.fetch = network as typeof fetch;
  setApiBase(API);
});
afterEach(() => {
  window.fetch = original;
  setApiBase("");
  setLocalCopy(null);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("offline store", () => {
  it("a clip the page fetches is downloaded once, natively, and then read from disk", async () => {
    await startOffline(API);
    const url = apiUrl("/media/clips/pb1/portrait.mp4");
    expect(url).toBe(`${API}/media/clips/pb1/portrait.mp4`); // not on the device yet
    const res = await fetch(url);
    expect(await res.text()).toBe(`body of ${url}`);
    expect(fs.Filesystem.downloadFile).toHaveBeenCalledTimes(1);
    expect(network.mock.calls.map(([u]) => String(u))).toEqual([expect.stringMatching(new RegExp(`^${LOCAL}/offline/[0-9a-z]+\\.mp4$`))]);
    // From now on the page gets the local file, for <video> as for fetch().
    expect(apiUrl("/media/clips/pb1/portrait.mp4")).toMatch(new RegExp(`^${LOCAL}/offline/[0-9a-z]+\\.mp4$`));
    expect(mediaUrl("clips/pb1/portrait.mp4")).toBe(apiUrl("/media/clips/pb1/portrait.mp4"));
  });

  it("a path shown from the network is downloaded in the background, then served locally", async () => {
    vi.useFakeTimers();
    await startOffline(API);
    expect(apiUrl("/audio/Alafasy_128kbps/094005.mp3")).toBe(`${API}/audio/Alafasy_128kbps/094005.mp3`);
    expect(apiUrl("/media/voice/ml.lalithasaram/094005.mp3")).toBe(`${API}/media/voice/ml.lalithasaram/094005.mp3`);
    expect(fs.Filesystem.downloadFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fs.net.served).toEqual([`${API}/audio/Alafasy_128kbps/094005.mp3`, `${API}/media/voice/ml.lalithasaram/094005.mp3`]);
    expect(apiUrl("/audio/Alafasy_128kbps/094005.mp3")).toMatch(/^capacitor:\/\/localhost\/.+\.mp3$/);
    expect(apiUrl("/media/voice/ml.lalithasaram/094005.mp3")).toMatch(/^capacitor:\/\/localhost\/.+\.mp3$/);
    // Session and page paths never become local files.
    expect(apiUrl("/api/me")).toBe(`${API}/api/me`);
    expect(apiUrl("/data/surahs.json")).toBe("/data/surahs.json");
  });

  it("the Quran text is kept as JSON and read from disk afterwards, offline too", async () => {
    await startOffline(API);
    const first = await request("/qapi/surah/94/quran-uthmani");
    expect(await first.json()).toMatchObject({ url: `${API}/qapi/surah/94/quran-uthmani`, n: 1 });
    fs.net.online = false;
    expect(apiUrl("/qapi/surah/94/quran-uthmani")).toMatch(/\.json$/);
    const again = await request("/qapi/surah/94/quran-uthmani");
    expect(await again.json()).toMatchObject({ url: `${API}/qapi/surah/94/quran-uthmani`, n: 1 });
  });

  it("offline with nothing on disk: the request fails as it did before", async () => {
    await startOffline(API);
    fs.net.online = false;
    await expect(fetch(`${API}/media/clips/x/portrait.mp4`)).rejects.toThrow("Load failed");
  });

  it("fresh JSON: answered from disk at once and refreshed behind the scenes", async () => {
    await startOffline(API);
    expect(await (await request("/api/config")).json()).toMatchObject({ n: 1 });
    await flush();
    // The copy answers at once; the network's newer answer replaces it for next time.
    expect(await (await request("/api/config")).json()).toMatchObject({ n: 1 });
    await flush();
    expect(await (await request("/api/config")).json()).toMatchObject({ n: 2 });
    // Offline: the copy.
    fs.net.online = false;
    await flush();
    expect(await (await request("/api/config")).json()).toMatchObject({ from: "network" });
    // Offline with no copy: fails as before (the clip list then falls back to the copy bundled with the app).
    await expect(request("/data/clips.json")).rejects.toThrow("Load failed");
  });

  it("the signed-in person's data: network first, the copy when offline, gone after signing out", async () => {
    const store = await startOffline(API);
    await (await request("/api/creations")).json();
    await flush();
    fs.net.online = false;
    expect(await (await request("/api/creations")).json()).toMatchObject({ url: `${API}/api/creations`, n: 1 });
    await store.clearUser();
    await expect(request("/api/creations")).rejects.toThrow("Load failed");
  });

  it("iOS: a kept media file (answered without an HTTP status) reaches the page as a 200 with its type", async () => {
    await startOffline(API);
    await fetch(`${API}/media/clips/pb1/portrait.mp4`);
    const local = apiUrl("/media/clips/pb1/portrait.mp4");
    // WKWebView's answer for a local mp4: status 0, body intact.
    network.mockImplementationOnce(async () => ({ status: 0, ok: false, blob: async () => new Blob(["MP4"]) }) as unknown as Response);
    const res = await fetch(local);
    // (The body itself is the same Blob; jsdom's Blob cannot be read back through Node's Response here.)
    expect([res.status, res.ok, res.headers.get("Content-Type"), res.headers.get("Content-Length")]).toEqual([200, true, "video/mp4", "3"]);
    expect(apiUrl("/media/clips/pb1/portrait.mp4")).toBe(local); // still kept
  });

  it("writes, searches and Range requests are never touched", async () => {
    await startOffline(API);
    await fetch(`${API}/api/search?q=x`);
    await fetch(`${API}/api/events`, { method: "POST", body: "{}" });
    await fetch(`${API}/media/clips/a/portrait.mp4`, { headers: { Range: "bytes=0-" } });
    expect(fs.Filesystem.downloadFile).not.toHaveBeenCalled();
    expect(fs.files.size).toBe(0);
  });

  it("start-up checks the index against the disk: lost files are forgotten, stray files deleted", async () => {
    fs.files.set("offline/index.json", JSON.stringify({
      "/media/a.mp4": { file: "a.mp4", size: 1, kind: "media", used: 1 },
      "/media/b.mp4": { file: "b.mp4", size: 1, kind: "media", used: 1 },
    }));
    fs.files.set("offline/a.mp4", "A");
    fs.files.set("offline/half.mp4.part", "…");
    await startOffline(API);
    await flush();
    expect(apiUrl("/media/a.mp4")).toBe(`${LOCAL}/offline/a.mp4`);
    expect(apiUrl("/media/b.mp4")).toBe(`${API}/media/b.mp4`);
    expect(fs.files.has("offline/half.mp4.part")).toBe(false);
  });

  it("over the size cap: the least recently used file is deleted and comes from the network again", async () => {
    vi.useFakeTimers(); // the background download apiUrl() queues for the evicted path never runs
    const one = `body of ${API}/media/clips/a.mp4`.length;
    await startOffline(API, { media: one * 2, text: 1e9 });
    for (const p of ["/media/clips/a.mp4", "/media/clips/b.mp4", "/media/clips/c.mp4"]) await (await fetch(API + p)).text();
    await vi.advanceTimersByTimeAsync(0);
    expect([...fs.files.keys()].filter((k) => k.endsWith(".mp4"))).toHaveLength(2);
    expect(apiUrl("/media/clips/b.mp4")).toMatch(new RegExp(`^${LOCAL}/offline/`));
    expect(apiUrl("/media/clips/c.mp4")).toMatch(new RegExp(`^${LOCAL}/offline/`));
    expect(apiUrl("/media/clips/a.mp4")).toBe(`${API}/media/clips/a.mp4`);
  });
});

describe("the web is unchanged", () => {
  it("no API base: media, audio and data paths stay as they were", () => {
    setApiBase("");
    setLocalCopy(() => "capacitor://never");
    expect(mediaUrl("clips/pb1/portrait.mp4")).toBe(new URL("/media/clips/pb1/portrait.mp4", location.href).href);
    expect(apiUrl("/audio/x/001001.mp3")).toBe("/audio/x/001001.mp3");
    expect(apiUrl("/qapi/surah/1/quran-uthmani")).toBe("/qapi/surah/1/quran-uthmani");
  });

  it("an app API base without a store: the Worker's address, as before", () => {
    setLocalCopy(null);
    expect(mediaUrl("thumbs/pb1.webp")).toBe(`${API}/media/thumbs/pb1.webp`);
  });
});
