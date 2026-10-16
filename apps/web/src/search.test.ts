import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, SearchResponse } from "../../../contracts/types";
import * as api from "./api";
import { findClips } from "./backgrounds";
import { progressiveSearch, searchPage } from "./search";

vi.mock("./api", () => ({
  search: vi.fn(),
  searchClips: vi.fn(async () => []),
  loadCatalogue: vi.fn(async () => {}),
  allClips: vi.fn(() => Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, caption: "", tags: [] }) as unknown as Clip)),
  clipById: () => null,
  getSurahBackgrounds: async () => null,
}));

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const answer = (mode: "fast" | "full", ...refs: string[]): SearchResponse =>
  ({ q: "hope", mode, topic: null, results: refs.map((ref) => ({ ref, text: "" })) });

describe("progressiveSearch", () => {
  let fast: ReturnType<typeof deferred<SearchResponse>>, full: ReturnType<typeof deferred<SearchResponse>>, shown: string[];
  const run = (signal = new AbortController().signal) =>
    progressiveSearch("hope", signal, (r, mode) => shown.push(`${mode} ${r.map((x) => x.ref)}`), 0);
  beforeEach(() => {
    fast = deferred(); full = deferred(); shown = [];
    vi.mocked(api.search).mockReset().mockImplementation((_q, mode) => (mode === "fast" ? fast : full).promise);
  });

  it("starts both requests at once; the refined answer replaces the quick one", async () => {
    const done = run();
    expect(vi.mocked(api.search).mock.calls.map((c) => c[1])).toEqual(["fast", "full"]);
    fast.resolve(answer("fast", "2:153"));
    await vi.waitFor(() => expect(shown).toEqual(["fast 2:153"]));
    full.resolve(answer("full", "94:5", "2:153"));
    expect(await done).toBe("shown");
    expect(shown).toEqual(["fast 2:153", "full 94:5,2:153"]);
  });

  it("drops a quick answer that arrives after the refined one", async () => {
    const done = run();
    full.resolve(answer("full", "94:5"));
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    fast.resolve(answer("fast", "2:153"));
    expect(await done).toBe("shown");
    expect(shown).toEqual(["full 94:5"]);
  });

  it("keeps quick results when the refined request fails, and reports empty and failed searches", async () => {
    let done = run();
    fast.resolve(answer("fast", "2:153"));
    full.reject(new Error("503"));
    expect(await done).toBe("shown");

    fast = deferred(); full = deferred();
    done = run();
    fast.resolve(answer("fast"));
    full.resolve(answer("full"));
    expect(await done).toBe("empty");

    fast = deferred(); full = deferred();
    vi.mocked(api.search).mockClear();
    done = run();
    fast.reject(new Error("offline"));
    full.reject(new Error("offline"));
    expect(await done).toBe("failed");
    expect(api.search).toHaveBeenCalledTimes(4); // tried once more before giving up
  });

  it("a search the server could not answer (503, e.g. a slow first query) is tried once more, never shown as empty", async () => {
    const failed = Promise.reject(new Error("503"));
    failed.catch(() => {});
    let attempt = 0;
    vi.mocked(api.search).mockImplementation((_q, mode) => (++attempt <= 2 ? failed : (mode === "fast" ? fast : full).promise));
    const done = run();
    await vi.waitFor(() => expect(api.search).toHaveBeenCalledTimes(4));
    fast.resolve(answer("fast", "2:153"));
    full.resolve(answer("full", "2:153", "39:10"));
    expect(await done).toBe("shown");
    expect(shown).toEqual(["fast 2:153", "full 2:153,39:10"]);

    // A new search (abort) during the pause does not try again.
    attempt = 0;
    vi.mocked(api.search).mockClear();
    const c = new AbortController();
    const again = run(c.signal);
    c.abort();
    expect(await again).toBe("aborted");
    expect(api.search).toHaveBeenCalledTimes(2);
  });
});

it("hands on the page after each answer (null without one); searchPage asks for that page", async () => {
  const seen: (number | null)[] = [];
  vi.mocked(api.search).mockReset().mockImplementation(async (_q, mode, _s, page) =>
    page ? { ...answer("full", "94:5"), more: false } : mode === "fast" ? answer("fast", "2:153") : { ...answer("full", "2:153"), more: true, next: 2 });
  await progressiveSearch("hope", new AbortController().signal, (_r, _mode, next) => seen.push(next), 0);
  expect(seen.sort()).toEqual([2, null]); // the quick answer (an older server's shape) has none
  const signal = new AbortController().signal;
  expect(await searchPage("hope", 2, signal)).toEqual({ results: [{ ref: "94:5", text: "" }], next: null });
  expect(api.search).toHaveBeenLastCalledWith("hope", "full", signal, 2);
});

it("the library's first page comes from the catalogue, without a request", async () => {
  const clips = await findClips("", 24);
  expect(clips.map((c) => c.id)).toEqual(Array.from({ length: 24 }, (_, i) => `c${i}`));
  expect(api.searchClips).not.toHaveBeenCalled();
  await findClips("sea", 24);
  expect(api.searchClips).toHaveBeenCalledWith("sea", 24);
});
