import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { call, mockFetch } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("/qapi/*", () => {
  it("proxies to alquran.cloud with CORS, then serves the edge cache", async () => {
    const fetch = mockFetch(() => Response.json({ code: 200, data: { number: 94 } }));
    const first = await call("/qapi/surah/94/editions/quran-uthmani,en.sahih?offset=0");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=2592000, immutable");
    expect(fetch.mock.calls[0][0]).toBe("https://api.alquran.cloud/v1/surah/94/editions/quran-uthmani,en.sahih?offset=0");
    const second = await call("/qapi/surah/94/editions/quran-uthmani,en.sahih?offset=0");
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(second.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await second.json()).toEqual({ code: 200, data: { number: 94 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache upstream errors", async () => {
    const fetch = mockFetch(() => Response.json({ code: 404 }, { status: 404 }));
    expect((await call("/qapi/surah/999")).status).toBe(404);
    const again = await call("/qapi/surah/999");
    expect(again.headers.get("Cache-Control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects odd paths and reports upstream failure as 502", async () => {
    mockFetch(() => { throw new Error("network"); });
    expect((await call("/qapi/surah/1%20x")).status).toBe(400);
    expect((await call("/qapi/surah/1%3Cscript%3E")).status).toBe(400);
    expect((await call("/qapi/meta")).status).toBe(502);
  });

  it("answers CORS preflight", async () => {
    const res = await call("/qapi/meta", { method: "OPTIONS", headers: { Origin: "https://x.example", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Range");
  });
});

describe("/audio/:folder/:file", () => {
  it("validates folder and SSSAAA.mp3", async () => {
    const fetch = mockFetch(() => new Response("mp3"));
    for (const bad of ["/audio/Alafasy_128kbps/1001.mp3", "/audio/Alafasy_128kbps/115001.mp3", "/audio/Alafasy_128kbps/001000.mp3",
      "/audio/Alafasy_128kbps/001001.wav", "/audio/..%2Fx/001001.mp3", "/audio/.hidden/001001.mp3", "/audio/a/b/001001.mp3"]) {
      expect([400, 404], bad).toContain((await call(bad)).status);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves our own reciters from the media bucket, never from everyayah", async () => {
    await env.MEDIA.put("audio/badr_alturki/094005.mp3", "0123456789", { httpMetadata: { contentType: "audio/mpeg" } });
    const fetch = mockFetch(() => new Response("unexpected", { status: 500 }));
    const res = await call("/audio/badr_alturki/094005.mp3", { headers: { Range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("2345");
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await call("/audio/badr_alturki/094009.mp3")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("proxies everyayah with CORS, caches, and serves Range from the cache", async () => {
    const fetch = mockFetch(() => new Response("0123456789", { headers: { "Content-Type": "audio/mpeg" } }));
    const first = await call("/audio/Alafasy_128kbps/094005.mp3");
    expect(fetch.mock.calls[0][0]).toBe("https://everyayah.com/data/Alafasy_128kbps/094005.mp3");
    expect(first.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const ranged = await call("/audio/Alafasy_128kbps/094005.mp3", { headers: { Range: "bytes=2-5" } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe("2345");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("/audio/voice/:id/:file", () => {
  it("serves only the listed translation voices, from their own sources, cached", async () => {
    const fetch = mockFetch(() => new Response("0123456789", { headers: { "Content-Type": "audio/mpeg" } }));
    const first = await call("/audio/voice/en.walk/002008.mp3");
    expect(first.status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe("https://cdn.islamic.network/quran/audio/192/en.walk/15.mp3"); // {N}: 7 + 8
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect((await call("/audio/voice/en.walk/002008.mp3")).headers.get("X-Cache")).toBe("HIT");
    await call("/audio/voice/ur.khan/114006.mp3");
    expect(fetch.mock.calls[1][0]).toBe("https://cdn.islamic.network/quran/audio/64/ur.khan/6236.mp3");
    await call("/audio/voice/az.balayev/094005.mp3");
    expect(fetch.mock.calls[2][0]).toBe("https://everyayah.com/data/translations/azerbaijani/balayev/094005.mp3");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects other voices, odd files and ayahs that do not exist; the bucket's own voice is at /media/", async () => {
    const fetch = mockFetch(() => new Response("mp3"));
    for (const bad of ["/audio/voice/en.robot/002008.mp3", "/audio/voice/en.walk/001008.mp3", "/audio/voice/en.walk/115001.mp3",
      "/audio/voice/en.walk/002000.mp3", "/audio/voice/en.walk/002008.wav", "/audio/voice/..%2Fx/002008.mp3"]) {
      expect((await call(bad)).status, bad).toBe(400);
    }
    expect((await call("/audio/voice/ml.lalithasaram/002008.mp3")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("/media/*", () => {
  it("legal/* (privacy notice, terms) is read from R2 every time, so a new upload shows at once", async () => {
    await env.MEDIA.put("legal/privacy.html", "<p>old</p>", { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    const first = await call("/media/legal/privacy.html");
    expect(await first.text()).toBe("<p>old</p>");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300");
    await env.MEDIA.put("legal/privacy.html", "<p>new</p>", { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    const second = await call("/media/legal/privacy.html");
    expect(await second.text()).toBe("<p>new</p>");
    expect(second.headers.get("X-Cache")).toBe("MISS");
  });

  it("serves R2 objects with ETag, Range, 304 and inferred content types", async () => {
    await env.MEDIA.put("clips/p/pb1.mp4", "0123456789abcdef");
    const full = await call("/media/clips/p/pb1.mp4");
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("video/mp4");
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
    expect(full.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(full.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await full.text()).toBe("0123456789abcdef");
    const etag = full.headers.get("ETag")!;
    expect(etag).toMatch(/^".+"$/);

    const part = await call("/media/clips/p/pb1.mp4", { headers: { Range: "bytes=4-7" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 4-7/16");
    expect(await part.text()).toBe("4567");

    const open = await call("/media/clips/p/pb1.mp4", { headers: { Range: "bytes=10-" } });
    expect(open.headers.get("Content-Range")).toBe("bytes 10-15/16");
    expect(await open.text()).toBe("abcdef");

    const suffix = await call("/media/clips/p/pb1.mp4", { headers: { Range: "bytes=-3" } });
    expect(suffix.headers.get("Content-Range")).toBe("bytes 13-15/16");
    expect(await suffix.text()).toBe("def");

    const notModified = await call("/media/clips/p/pb1.mp4", { headers: { "If-None-Match": etag } });
    expect(notModified.status).toBe(304);
  });

  it("serves repeat requests and seeks from the edge cache", async () => {
    await env.MEDIA.put("clips/l/pb9.mp4", "0123456789abcdef", { httpMetadata: { contentType: "video/mp4" } });
    const first = await call("/media/clips/l/pb9.mp4", { headers: { Range: "bytes=0-" } });
    expect(first.status).toBe(206);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    await env.MEDIA.delete("clips/l/pb9.mp4"); // from now on only the cache has it
    const again = await call("/media/clips/l/pb9.mp4");
    expect(again.headers.get("X-Cache")).toBe("HIT");
    expect(again.headers.get("Content-Type")).toBe("video/mp4");
    expect(again.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(again.headers.get("Content-Range")).toBeNull();
    expect(await again.text()).toBe("0123456789abcdef");
    const seek = await call("/media/clips/l/pb9.mp4", { headers: { Range: "bytes=8-11" } });
    expect(seek.status).toBe(206);
    expect(seek.headers.get("Content-Range")).toBe("bytes 8-11/16");
    expect(await seek.text()).toBe("89ab");
  });

  it("keeps an explicit content type, 404s unknown keys and odd paths", async () => {
    await env.MEDIA.put("thumbs/pb1.webp", "w", { httpMetadata: { contentType: "image/webp" } });
    expect((await call("/media/thumbs/pb1.webp")).headers.get("Content-Type")).toBe("image/webp");
    await env.MEDIA.put("posters/p/pb1.jpg", "j");
    expect((await call("/media/posters/p/pb1.jpg")).headers.get("Content-Type")).toBe("image/jpeg");
    expect((await call("/media/nope.mp4")).status).toBe(404);
    expect((await call("/media/creations/x.jpg")).status).toBe(404); // saved designs' thumbnails are private
    expect((await call("/media/a/%2E%2E/b.mp4")).status).toBe(404);
  });
});
