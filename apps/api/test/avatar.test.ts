// /api/avatar/qr/*: QuranReflect authors' photos through our Worker. Only QuranReflect's own bucket, raster images only,
// at most 200 KB, no redirects; cached at the edge.
import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarPath, bucketPath } from "../src/routes/avatar";
import { call, mockFetch } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const BUCKET = "https://s3.amazonaws.com/qreflect-bucket/";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const image = (bytes: Uint8Array, type = "image/png", extra: Record<string, string> = {}) =>
  new Response(bytes, { headers: { "Content-Type": type, ...extra } });

describe("the allowlist", () => {
  it("accepts QuranReflect's bucket only, as our own path (query dropped, names encoded)", () => {
    expect(avatarPath(`${BUCKET}avatars/000/012/medium/photo.jpg?1600000000`)).toBe("/api/avatar/qr/avatars/000/012/medium/photo.jpg");
    expect(avatarPath(`${BUCKET}users/12/my%20photo.jpg`)).toBe("/api/avatar/qr/users/12/my%20photo.jpg");
    for (const bad of [
      "", null, undefined, 42, "/relative.png", "http://s3.amazonaws.com/qreflect-bucket/a.png", "https://s3.amazonaws.com/other-bucket/a.png",
      "https://s3.amazonaws.com/qreflect-bucket-evil/a.png", "https://s3.amazonaws.com.evil.example/qreflect-bucket/a.png",
      "https://evil.example/https://s3.amazonaws.com/qreflect-bucket/a.png", "https://s3.amazonaws.com/qreflect-bucket/../other/a.png",
      "https://s3.amazonaws.com/qreflect-bucket/a/%2e%2e/b.png", "https://s3.amazonaws.com/qreflect-bucket/a%2F..%2Fb.png",
      "https://s3.amazonaws.com/qreflect-bucket/", "https://s3.amazonaws.com/qreflect-bucket/a//b.png",
      "https://s3.amazonaws.com/qreflect-bucket/a\\b.png", "https://s3.amazonaws.com/qreflect-bucket/a%00.png",
      "https://s3.amazonaws.com/qreflect-bucket/<script>.png",
    ]) expect(avatarPath(bad), String(bad)).toBeNull();
  });

  it("checks every path segment", () => {
    expect(bucketPath("a/b.jpg")).toBe("a/b.jpg");
    for (const bad of ["", "..", "a/../b", "a/./b", "%2e%2e/b", "a%2Fb", "a/%E0%A4%A", "a?b", "a#b", "x".repeat(401)]) {
      expect(bucketPath(bad), bad).toBeNull();
    }
  });
});

describe("GET /api/avatar/qr/*", () => {
  it("proxies the image from the bucket (no redirects), as its real type, then serves the edge cache", async () => {
    const fetch = mockFetch(() => image(PNG, "image/jpeg"));
    const first = await call("/api/avatar/qr/avatars/1/medium/a.jpg");
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe("image/png"); // the bytes decide, not the upstream header
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=2592000, immutable");
    expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(first.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PNG);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`${BUCKET}avatars/1/medium/a.jpg`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    const again = await call("/api/avatar/qr/avatars/1/medium/a.jpg");
    expect(again.status).toBe(200);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(PNG);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses odd paths without asking upstream", async () => {
    const fetch = mockFetch(() => image(PNG));
    for (const bad of ["/api/avatar/qr/", "/api/avatar/qr/a%2F..%2Fb.png", "/api/avatar/qr/a.png?x=1", "/api/avatar/qr/a/%2E%2E%2Fsecret",
      "/api/avatar/qr/%3Cscript%3E.png", "/api/avatar/qr/a%5C..%5Cb.png", "/api/avatar/https://evil.example/a.png", "/api/avatar/qr/../../api/me"]) {
      expect((await call(bad)).status, bad).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
    // Dot segments are resolved before the route sees them, so they can only land inside the bucket.
    await call("/api/avatar/qr/a/%2e%2e/b.png");
    expect(fetch.mock.calls.map(([u]) => u)).toEqual([`${BUCKET}b.png`]);
  });

  it("refuses redirects, non-images, SVG, fake images and anything over 200 KB; nothing cached", async () => {
    const answers: Record<string, () => Response> = {
      "redirect.png": () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } }),
      "missing.png": () => new Response("<Error>AccessDenied</Error>", { status: 403, headers: { "Content-Type": "application/xml" } }),
      "page.png": () => new Response("<html>", { headers: { "Content-Type": "text/html" } }),
      "vector.svg": () => new Response('<svg onload="alert(1)"/>', { headers: { "Content-Type": "image/svg+xml" } }),
      "fake.png": () => new Response("<script>alert(1)</script>", { headers: { "Content-Type": "image/png" } }),
      "declared-big.jpg": () => image(JPEG, "image/jpeg", { "Content-Length": String(300 * 1024) }),
      "streamed-big.jpg": () => image(new Uint8Array([...JPEG, ...new Uint8Array(201 * 1024)]), "image/jpeg"),
    };
    const fetch = mockFetch((url) => answers[url.slice(BUCKET.length)]());
    for (const name of Object.keys(answers)) {
      const res = await call(`/api/avatar/qr/${name}`);
      expect(res.status, name).toBe(404);
      expect(res.headers.get("Content-Type"), name).toBeNull();
    }
    expect(fetch).toHaveBeenCalledTimes(Object.keys(answers).length);
    await call("/api/avatar/qr/redirect.png");
    expect(fetch).toHaveBeenCalledTimes(Object.keys(answers).length + 1);
  });

  it("a JPEG just under the cap is served; upstream failure is a 502", async () => {
    mockFetch(() => image(new Uint8Array([...JPEG, ...new Uint8Array(190 * 1024)]), "image/jpeg"));
    const ok = await call("/api/avatar/qr/ok/under-cap.jpg");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    vi.restoreAllMocks();
    mockFetch(() => { throw new Error("network"); });
    expect((await call("/api/avatar/qr/down.jpg")).status).toBe(502);
  });
});
