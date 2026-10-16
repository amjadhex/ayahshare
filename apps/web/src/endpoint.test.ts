// Requests in the iOS / Android app: Worker paths go to the API's origin with the Bearer session; the app's own files
// stay local. On the web nothing changes (relative paths, cookie).
import { afterEach, describe, expect, it, vi } from "vitest";
import { audioUrl, getSurahBackgrounds, mediaUrl } from "./api";
import { apiUrl, onDevice, request, setApiBase, setLocalCopy, setSessionToken } from "./endpoint";
import { shareCodeOf } from "./share";

const API = "https://api.example";

afterEach(() => {
  setApiBase("");
  setSessionToken(null);
  setLocalCopy(null);
  vi.restoreAllMocks();
});

describe("endpoint", () => {
  it("web: every path stays relative and same-origin", async () => {
    expect(apiUrl("/api/search?q=x")).toBe("/api/search?q=x");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await request("/api/me");
    expect(fetch).toHaveBeenCalledWith("/api/me", { credentials: "same-origin" });
  });

  it("app: the Worker's paths go to the API, the app's own files stay local", () => {
    setApiBase(`${API}/`);
    for (const p of ["/api/config", "/qapi/surah/1/quran-uthmani", "/audio/x/001001.mp3", "/media/thumbs/a.webp", "/s/abc", "/data/clips.json", "/data/bg/94.json"]) {
      expect(apiUrl(p)).toBe(API + p);
    }
    for (const p of ["/data/surahs.json", "/assets/index.js", "/icons/icon.svg", "/"]) expect(apiUrl(p)).toBe(p);
    expect(audioUrl("Alafasy_128kbps", 94, 5)).toBe(`${API}/audio/Alafasy_128kbps/094005.mp3`);
    expect(mediaUrl("thumbs/pb1.webp")).toBe(`${API}/media/thumbs/pb1.webp`);
  });

  it("onDevice: always on the web; in the app only for paths the device already has", () => {
    expect(onDevice("/media/clips/a.mp4")).toBe(true);
    setApiBase(API);
    expect(onDevice("/media/clips/a.mp4")).toBe(false); // no offline store
    expect(onDevice("/data/surahs.json")).toBe(true); // bundled in the app
    setLocalCopy((p) => (p === "/media/clips/a.mp4" ? "capacitor://localhost/_capacitor_file_/a.mp4" : null));
    expect(onDevice("/media/clips/a.mp4")).toBe(true);
    expect(onDevice("/media/clips/b.mp4")).toBe(false);
  });

  it("app: API requests carry the session as a Bearer header and no cookies", async () => {
    setApiBase(API);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await request("/api/me");
    let [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/me`);
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);

    setSessionToken("t".repeat(43));
    await request("/api/creations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    [url, init] = fetch.mock.calls[1] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${"t".repeat(43)}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    // Proxies and media never get the session.
    await request("/qapi/surah/1/quran-uthmani");
    expect(new Headers((fetch.mock.calls[2][1] as RequestInit).headers).has("Authorization")).toBe(false);
  });

  it("app: background suggestions fall back to the bundled copy when the API cannot be reached", async () => {
    setApiBase(API);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith(API) ? Promise.reject(new TypeError("offline")) : Response.json({ surah: 93, ayahs: { 1: ["pb1"] }, sensitive: [] }));
    expect(await getSurahBackgrounds(93)).toEqual({ surah: 93, ayahs: { 1: ["pb1"] }, sensitive: [] });
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual([`${API}/data/bg/93.json`, "/data/bg/93.json"]);
  });
});

describe("shareCodeOf (links that open the app)", () => {
  it("reads the site's links, the app's own scheme and ?r=", () => {
    expect(shareCodeOf(new URL("https://ayahshare.com/s/AbC_12-x"))).toBe("AbC_12-x");
    expect(shareCodeOf(new URL("ayahshare://s/AbC_12-x"))).toBe("AbC_12-x");
    expect(shareCodeOf(new URL("ayahshare://open?r=xyz123"))).toBe("xyz123");
    expect(shareCodeOf(new URL("https://example.com/create"))).toBeNull();
    expect(shareCodeOf(new URL("ayahshare://settings"))).toBeNull();
    expect(shareCodeOf(null)).toBeNull();
  });
});
