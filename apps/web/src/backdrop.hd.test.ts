// HD exports take the clip's 1080p rendition when it has one, and fall back to the 720p file.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "../../../contracts/types";
import { clipBlob } from "./backdrop";

vi.mock("./api", () => ({
  mediaUrl: (p: string) => `/media/${p}`,
  clipUrl: (c: Clip, _k: string, o: string) => `/media/${o === "landscape" ? c.video.landscape : c.video.portrait}`,
}));

const clip = (id: string, hd?: Clip["hd"]) =>
  ({ id, video: { portrait: `clips/p/${id}.mp4`, landscape: `clips/l/${id}.mp4` }, hd }) as unknown as Clip;

afterEach(() => vi.unstubAllGlobals());

describe("clipBlob", () => {
  it("HD uses the 1080p file for the orientation; Standard and clips without one use 720p", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { seen.push(url); return new Response("x"); }));
    await clipBlob(clip("a1", { portrait: "clips/p1080/a1.mp4", landscape: "clips/l1080/a1.mp4" }), "portrait", true);
    await clipBlob(clip("a2", { landscape: "clips/l1080/a2.mp4" }), "landscape", true);
    await clipBlob(clip("a3", { portrait: "clips/p1080/a3.mp4" }), "portrait", false);
    await clipBlob(clip("a4"), "square", true);
    expect(seen).toEqual(["/media/clips/p1080/a1.mp4", "/media/clips/l1080/a2.mp4", "/media/clips/p/a3.mp4", "/media/clips/p/a4.mp4"]);
  });

  it("falls back to the 720p file when the 1080p one does not load", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { seen.push(url); return new Response("x", { status: url.includes("1080") ? 404 : 200 }); }));
    await expect(clipBlob(clip("b1", { portrait: "clips/p1080/b1.mp4" }), "portrait", true)).resolves.toBeInstanceOf(Blob);
    expect(seen).toEqual(["/media/clips/p1080/b1.mp4", "/media/clips/p/b1.mp4"]);
  });
});
