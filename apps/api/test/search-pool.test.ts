// Own file: data files are cached per isolate, and this test needs different ones.
import { afterEach, expect, it, vi } from "vitest";
import { call, luna, makeEnv, mockFetch } from "./helpers";

afterEach(() => vi.restoreAllMocks());

it("full: rerank pool: vector 30 ∪ topic 20, at most 100, with 200-char descriptions", async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `2:${i + 1}`);
  const long = Object.fromEntries(ids.map((r) => [r, "x".repeat(500)]));
  const e = makeEnv({ "ayahs-en.json": long, "topics.json": { version: "", topics: [{ id: "t", label: "t", refs: Array.from({ length: 30 }, (_, i) => `3:${i + 1}`) }] } }, ids);
  const fetch = mockFetch((u, init) => {
    if (u.endsWith("/chat/completions")) return new Response("not this test", { status: 500 });
    const body = JSON.parse(String(init!.body));
    return body.questions.topic ? luna({ topic: { probabilities: { t: 0.4 } }, generic: { noul: 0 } }) : luna({ pick: { probabilities: {} } });
  });
  await call("/api/search?q=long%20pool&mode=full", {}, e);
  const criteria = fetch.mock.calls.map(([, i]) => JSON.parse(String(i!.body))).find((b) => b.questions?.pick).questions.pick.criteria;
  expect(Object.keys(criteria)).toHaveLength(50);
  expect(Object.keys(criteria).slice(28, 32)).toEqual(["2:29", "2:30", "3:1", "3:2"]);
  expect(criteria["2:1"]).toHaveLength(200);
});

