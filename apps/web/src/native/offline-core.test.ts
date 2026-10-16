// The app's offline store, pure parts: which paths are kept and how, file names, the size cap, checking the index
// against the disk, and the download queue.
import { describe, expect, it, vi } from "vitest";
import { createQueue, fileNameFor, hash, isLocalFirst, kindOf, parseIndex, reconcile, victims, type Index } from "./offline-core";

describe("kindOf", () => {
  it("media: clips, posters, thumbnails, recitations and translation voices", () => {
    for (const p of ["/media/clips/pb1/portrait.mp4", "/media/posters/pb1/portrait.webp", "/media/thumbs/pb1.webp",
      "/audio/Alafasy_128kbps/094005.mp3", "/audio/voice/en.walk/001001.mp3", "/media/voice/ml.lalithasaram/001001.mp3"]) {
      expect(kindOf(p), p).toBe("media");
    }
  });

  it("text: the Quran text and translations", () => {
    for (const p of ["/qapi/surah/1/quran-uthmani", "/qapi/surah/2/ml.qf-37", "/qapi/edition?format=text&type=translation",
      "/media/translations/ml.lalithasaram/1.json"]) {
      expect(kindOf(p), p).toBe("text");
    }
  });

  it("fresh: public JSON that can change; user: the signed-in person's data", () => {
    for (const p of ["/data/clips.json", "/data/bg/94.json", "/api/config", "/api/trending", "/api/trending?days=7",
      "/api/tafsir/2:255?lang=en", "/api/reflections/2:255?lang=en&page=2", "/api/clips/pb1", "/api/shares/AbC_12-x"]) {
      expect(kindOf(p), p).toBe("fresh");
    }
    for (const p of ["/api/me", "/api/creations", "/api/favourites"]) expect(kindOf(p), p).toBe("user");
  });

  it("never kept: writes and searches, share pages, stats, private thumbnails, legal pages, odd paths", () => {
    for (const p of ["/api/search?q=mercy&mode=fast", "/api/clips?limit=24&q=sea", "/api/events", "/api/auth/google",
      "/api/auth/email/start", "/api/stats/me", "/api/avatar/qr/x.jpg", "/s/abc", "/media/creations/u1/x.webp",
      "/media/legal/privacy-v2.html", "/media/../api/me", "/data/surahs.json", "/assets/index.js", "/audio/", "/media/", "/media/voice/x/"]) {
      expect(kindOf(p), p).toBeNull();
    }
  });

  it("only media and text are read from disk through apiUrl", () => {
    expect([isLocalFirst("media"), isLocalFirst("text"), isLocalFirst("fresh"), isLocalFirst("user"), isLocalFirst(null)])
      .toEqual([true, true, false, false, false]);
  });
});

describe("fileNameFor", () => {
  it("keeps the extension (the local server's content type) and differs per path", () => {
    expect(fileNameFor("/media/clips/a/portrait.mp4", "media")).toMatch(/^[0-9a-z]+\.mp4$/);
    expect(fileNameFor("/audio/x/001001.mp3", "media")).toMatch(/\.mp3$/);
    expect(fileNameFor("/media/thumbs/a.WEBP", "media")).toMatch(/\.webp$/);
    expect(fileNameFor("/qapi/surah/1/quran-uthmani", "text")).toMatch(/\.json$/);
    expect(fileNameFor("/api/tafsir/1:1?lang=en", "fresh")).toMatch(/\.json$/);
    expect(fileNameFor("/media/odd", "media")).toMatch(/\.bin$/);
    expect(fileNameFor("/a.mp4", "media")).not.toBe(fileNameFor("/b.mp4", "media"));
    expect(fileNameFor("/a.mp4", "media")).toBe(fileNameFor("/a.mp4", "media"));
  });

  it("hash: stable, and no collisions over many similar paths", () => {
    expect(hash("abc")).toBe(hash("abc"));
    const names = new Set<string>();
    for (let s = 1; s <= 114; s++) for (let a = 1; a <= 60; a++) names.add(hash(`/audio/Alafasy_128kbps/${s}/${a}.mp3`));
    expect(names.size).toBe(114 * 60);
  });
});

describe("victims (size cap)", () => {
  const MB = 1024 * 1024;
  const e = (kind: "media" | "text" | "fresh" | "user", size: number, used: number) => ({ file: `${used}.x`, size: size * MB, kind, used });

  it("removes the least recently used media until under the cap", () => {
    const index: Index = { "/a": e("media", 100, 1), "/b": e("media", 100, 3), "/c": e("media", 100, 2), "/d": e("media", 100, 4) };
    expect(victims(index, { media: 250 * MB, text: 0 })).toEqual(["/a", "/c"]);
    expect(victims(index, { media: 400 * MB, text: 0 })).toEqual([]);
  });

  it("text has its own cap: media never pushes the Quran text out", () => {
    const index: Index = { "/t1": e("text", 1, 0), "/f1": e("fresh", 1, 0), "/m1": e("media", 300, 5), "/m2": e("media", 10, 6) };
    expect(victims(index, { media: 300 * MB, text: 100 * MB })).toEqual(["/m1"]);
    expect(victims(index, { media: 400 * MB, text: 1.5 * MB })).toEqual(["/t1"]);
  });

  it("never removes the one just added", () => {
    const index: Index = { "/old": e("media", 10, 1), "/new": e("media", 500, 9) };
    expect(victims(index, { media: 300 * MB, text: 0 }, new Set(["/new"]))).toEqual(["/old"]);
  });
});

describe("reconcile / parseIndex", () => {
  it("drops entries whose file is gone and returns files no entry names", () => {
    const index: Index = {
      "/a": { file: "a.mp4", size: 1, kind: "media", used: 1 },
      "/b": { file: "b.mp4", size: 1, kind: "media", used: 1 },
    };
    const { index: kept, orphans } = reconcile(index, ["a.mp4", "c.mp4.part", "index.json"], "index.json");
    expect(Object.keys(kept)).toEqual(["/a"]);
    expect(orphans).toEqual(["c.mp4.part"]);
  });

  it("an unreadable index starts empty", () => {
    expect(parseIndex(null)).toEqual({});
    expect(parseIndex("{oops")).toEqual({});
    expect(parseIndex("[1]")).toEqual({});
    expect(parseIndex('{"/a":{"file":"a","size":1,"kind":"media","used":1}}')).toHaveProperty("/a");
  });
});

describe("createQueue", () => {
  const deferred = () => {
    let resolve!: () => void, reject!: (e: Error) => void;
    const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no; });
    return { promise, resolve, reject };
  };

  it("one download per path: a page's request joins a download already running", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const q = createQueue(run);
    const a = q.now("/x"), b = q.now("/x");
    expect(run).toHaveBeenCalledTimes(1);
    d.resolve();
    await Promise.all([a, b]);
    expect(q.size).toBe(0);
  });

  it("background downloads wait a moment, run `limit` at a time, and a page's request takes one over", async () => {
    vi.useFakeTimers();
    const jobs = new Map<string, ReturnType<typeof deferred>>();
    const run = vi.fn((p: string) => { const d = deferred(); jobs.set(p, d); return d.promise; });
    const q = createQueue(run, { limit: 2, delayMs: 100 });
    for (const p of ["/1", "/2", "/3", "/4"]) q.later(p);
    q.later("/1"); // already waiting
    expect(run).not.toHaveBeenCalled();
    void q.now("/3"); // the page wants it now: starts at once, leaves the waiting list
    expect(run.mock.calls.map(([p]) => p)).toEqual(["/3"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(run.mock.calls.map(([p]) => p)).toEqual(["/3", "/1", "/2"]);
    jobs.get("/1")!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.mock.calls.map(([p]) => p)).toEqual(["/3", "/1", "/2", "/4"]);
    vi.useRealTimers();
  });

  it("a failed path is not tried again in the background for a while", async () => {
    let t = 0;
    const run = vi.fn(async () => { throw new Error("offline"); });
    const q = createQueue(run, { delayMs: 0, retryMs: 1000, now: () => t });
    await expect(q.now("/x")).rejects.toThrow("offline");
    q.later("/x");
    expect(q.size).toBe(0);
    t = 1001;
    q.later("/x");
    expect(q.size).toBe(1);
  });
});
