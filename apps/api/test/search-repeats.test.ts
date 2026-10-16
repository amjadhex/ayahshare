// Own file: data files are cached per isolate, and this test needs different ones.
import { afterEach, expect, it, vi } from "vitest";
import { call, FULL_DATA, makeEnv, mockFetch } from "./helpers";

afterEach(() => vi.restoreAllMocks());

it("ayahs that repeat word for word are shown once, as the first of them in the Quran", async () => {
  const deny = "So which of the favors of your Lord would you deny?";
  const e = makeEnv({ ...FULL_DATA, "ayahs-en.json": { "55:13": deny, "55:16": deny, "55:18": `${deny} `, "94:5": "For indeed, with hardship will be ease." } },
    ["55:16", "55:13", "94:5", "55:18"]);
  mockFetch(() => new Response("unexpected", { status: 500 }));
  const res = await (await call("/api/search?q=favors&mode=fast", {}, e)).json<any>();
  expect(res.results.map((r: any) => r.ref)).toEqual(["55:13", "94:5"]);
});
