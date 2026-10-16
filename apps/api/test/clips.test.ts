import { expect, it } from "vitest";
import { CLIPS, call, embeddings, makeEnv } from "./helpers";

it("no q → curated order from clips.json, limited", async () => {
  const res = await (await call("/api/clips?limit=2")).json<any>();
  expect(res.results).toEqual(CLIPS.slice(0, 2));
  expect((await (await call("/api/clips")).json<any>()).results).toHaveLength(4);
  expect((await (await call("/api/clips?limit=-5")).json<any>()).results).toHaveLength(1);
});

it("q → CLIPS_INDEX order, unknown/hidden ids dropped", async () => {
  const e = makeEnv();
  const res = await (await call("/api/clips?q=calm%20sea&limit=24", {}, e)).json<any>();
  expect(res.results.map((c: any) => c.id)).toEqual(["px4", "pb2"]);
  expect(embeddings.mock.calls[0][0].input).toEqual(["task: search result | query: calm sea"]); // vs poster image + caption vectors
  expect(e.CLIPS_INDEX.query.mock.calls[0][0]).toHaveLength(384);
  expect(e.CLIPS_INDEX.query.mock.calls[0][1]).toEqual({ topK: 34 });
});

it("GET /api/clips/:id", async () => {
  expect(await (await call("/api/clips/pb3")).json()).toEqual(CLIPS[2]);
  expect((await (await call("/api/clips/pb3")).json<any>()).hd).toEqual({ portrait: "clips/p1080/pb3.mp4", landscape: "clips/l1080/pb3.mp4" });
  expect((await call("/api/clips/nope")).status).toBe(404);
});

it("embedding unavailable (e.g. OpenRouter error) → caption matches first, then the default order, never a 500", async () => {
  const e = makeEnv();
  embeddings.mockResolvedValueOnce(new Response("upstream error", { status: 502 }));
  const res = await call("/api/clips?q=clip%20pb3&limit=3", {}, e);
  expect(res.status).toBe(200);
  expect((await res.json<any>()).results.map((c: any) => c.id)).toEqual(["pb1", "pb2", "pb3"]); // every caption contains "clip"

  embeddings.mockRejectedValueOnce(new Error("timeout"));
  const only = await (await call("/api/clips?q=px4&limit=2", {}, e)).json<any>();
  expect(only.results.map((c: any) => c.id)).toEqual(["px4", "pb1"]);
});

it("empty vector results fall back the same way", async () => {
  const e = makeEnv(undefined, undefined, []);
  const res = await (await call("/api/clips?q=pb2&limit=2", {}, e)).json<any>();
  expect(res.results.map((c: any) => c.id)).toEqual(["pb2", "pb1"]);
});
