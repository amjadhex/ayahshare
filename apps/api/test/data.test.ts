// Clips hidden in admin drop out of the library, the static catalogue and the per-ayah suggestions.
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { CLIPS, FULL_DATA, call, makeEnv } from "./helpers";

const BG = { surah: 94, ayahs: { "5": ["pb1", "pb2", "pb3"], "6": ["pb2"] }, sensitive: [] };
const e = () => makeEnv({ ...FULL_DATA, "bg/94.json": BG });

it("nothing hidden → static files pass through unchanged", async () => {
  const res = await call("/data/bg/94.json", {}, e());
  expect(res.headers.get("ETag")).toBeNull(); // fake asset response (no ETag on JSON) passed through as is
  expect(await res.json()).toEqual(BG);
  expect(await (await call("/data/clips.json", {}, e())).json()).toEqual(CLIPS);
});

it("hidden clips are filtered from /data/clips.json, /data/bg/*, /api/clips and /api/clips/:id", async () => {
  await env.DB.prepare(
    `INSERT INTO clips (id, source, source_id, video_key, thumb_key, poster_key, status, created_at)
     VALUES ('pb2', 'pixabay', '2', '{}', 'thumbs/pb2.webp', '{}', 'hidden', 1)`,
  ).run();
  const { resetHiddenClips } = await import("../src/lib/data");
  await resetHiddenClips("http://localhost/");
  expect((await (await call("/data/clips.json", {}, e())).json<any[]>()).map((c) => c.id)).toEqual(["pb1", "pb3", "px4"]);
  expect((await (await call("/data/bg/94.json", {}, e())).json<any>()).ayahs).toEqual({ "5": ["pb1", "pb3"], "6": [] });
  expect((await (await call("/api/clips", {}, e())).json<any>()).results.map((c: any) => c.id)).toEqual(["pb1", "pb3", "px4"]);
  expect((await call("/api/clips/pb2", {}, e())).status).toBe(404);
  // Missing files keep the SPA fallback.
  expect((await call("/data/bg/1.json", {}, e())).headers.get("Content-Type")).toContain("text/html");
});
