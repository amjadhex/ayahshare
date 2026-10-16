// The pipeline may not have published data/*.json yet: everything still answers, from embeddings only.
import { afterEach, expect, it, vi } from "vitest";
import { call, makeEnv, mockFetch } from "./helpers";

afterEach(() => vi.restoreAllMocks());

it("search full without data files → embedding order, no Luna, empty texts", async () => {
  const fetch = mockFetch(() => new Response("unexpected", { status: 500 }));
  const res = await (await call("/api/search?q=no%20data&mode=full", {}, makeEnv({}))).json<any>();
  expect(res).toMatchObject({ mode: "full", topic: null });
  expect(res.results).toEqual([{ ref: "94:6", text: "" }, { ref: "2:155", text: "" }, { ref: "94:5", text: "" }]);
  expect(fetch).not.toHaveBeenCalled();
});

it("references still work without surahs.json", async () => {
  const res = await (await call("/api/search?q=2:255", {}, makeEnv({}))).json<any>();
  expect(res.results).toEqual([{ ref: "2:255", text: "" }]);
});

it("clips without clips.json → empty list, 404 by id", async () => {
  const e = makeEnv({});
  expect(await (await call("/api/clips", {}, e)).json()).toEqual({ results: [] });
  expect(await (await call("/api/clips?q=sea", {}, e)).json()).toEqual({ results: [] });
  expect((await call("/api/clips/pb1", {}, e)).status).toBe(404);
});
