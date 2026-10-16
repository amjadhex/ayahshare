// Own file: data files are cached per isolate, and this test needs ~300 topics.
import { afterEach, expect, it, vi } from "vitest";
import { call, luna, makeEnv, mockFetch } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const topics = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, label: `topic ${i}`, refs: [`2:${i + 1}`, `3:${(i % 200) + 1}`] }));
const ayahs = Object.fromEntries(topics.flatMap((t) => t.refs.map((r) => [r, `text ${r}`])));

it("full: ~300 topics → two parallel router requests (≤ 255 options each, both with 'other'), best topic wins", async () => {
  const e = makeEnv({ "topics.json": { version: "", topics }, "ayahs-en.json": ayahs });
  const fetch = mockFetch((u, init) => {
    if (u.endsWith("/chat/completions")) return new Response("not this test", { status: 500 });
    const body = JSON.parse(String(init!.body));
    if (body.questions.kind) return luna({ kind: { choice: "topic", probabilities: { topic: 1 } } });
    const ids = Object.keys(body.questions.topic.criteria);
    // First group: weak guess; second group: confident about t250.
    return ids.includes("t250")
      ? luna({ topic: { choice: "t250", probabilities: { t250: 0.8, other: 0.2 } } })
      : luna({ topic: { choice: "other", probabilities: { other: 0.7, t10: 0.3 } }, generic: { noul: 0.9 } });
  });
  const res = await (await call("/api/search?q=patience&mode=full", {}, e)).json<any>();
  expect(res.topic).toBe("t250");
  expect(res.results.map((r: any) => r.ref)).toEqual(["2:251", "3:51"]);

  const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init!.body))).filter((b) => b.questions?.topic);
  expect(fetch.mock.calls).toHaveLength(4); // the router's two, the kind of search and the intent step; generic topic: no pick
  for (const b of bodies) {
    const options = Object.keys(b.questions.topic.criteria);
    expect(options.length).toBeLessThanOrEqual(255);
    expect(options).toContain("other");
  }
  expect(bodies.map((b) => Object.keys(b.questions.topic.criteria).length)).toEqual([151, 151]);
  expect(bodies.filter((b) => b.questions.generic)).toHaveLength(1);
});

it("full: one router request failing still uses the other", async () => {
  const e = makeEnv({ "topics.json": { version: "", topics }, "ayahs-en.json": ayahs });
  mockFetch((_u, init) => {
    const body = JSON.parse(String(init!.body));
    if (body.questions.generic) return new Response("boom", { status: 500 });
    if (body.questions.topic) return luna({ topic: { choice: "t200", probabilities: { t200: 0.9 } } });
    return luna({ pick: { choice: "2:201", probabilities: { "2:201": 0.9 } } });
  });
  const res = await (await call("/api/search?q=one%20fails&mode=full", {}, e)).json<any>();
  expect(res.topic).toBe("t200"); // not generic (that answer was lost) → rerank over vector ∪ topic
  expect(res.results[0].ref).toBe("2:201");
});
