// GET /api/trending: the most exported and shared ayahs from the D1 counters and share links, cached at the edge.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { BROKEN_DB, RECIPE, call, makeEnv } from "./helpers";

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);

async function seed() {
  const stat = env.DB.prepare("INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, ?, ?, ?)");
  const share = env.DB.prepare("INSERT INTO shares (code, recipe, created_at) VALUES (?, ?, ?)");
  await env.DB.batch([
    stat.bind(day(1), "export_ref", "94:5", 4),
    stat.bind(day(3), "export_ref", "94:5", 2),
    stat.bind(day(2), "export_ref", "2:153", 5),
    stat.bind(day(20), "export_ref", "39:10", 9),   // only in the 30-day window
    stat.bind(day(40), "export_ref", "1:1", 50),    // too old
    stat.bind(day(1), "export_ref", "other", 99),   // the overflow key is not an ayah
    stat.bind(day(1), "export_surah", "2", 30),     // another metric
    share.bind("t1", JSON.stringify({ ...RECIPE, surah: 2, from: 255, to: 255 }), Date.now() - 86400_000),
    share.bind("t2", JSON.stringify({ ...RECIPE, surah: 2, from: 255, to: 256 }), Date.now() - 2 * 86400_000),
    share.bind("t3", JSON.stringify({ ...RECIPE, surah: 3, from: 1, to: 1 }), Date.now() - 60 * 86400_000), // too old
  ]);
}

describe("GET /api/trending", () => {
  it("ranks exports (1 each) and share links (2 each) over the window, ayah refs only, cached for an hour", async () => {
    await seed();
    const res = await call("/api/trending?days=7");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await res.json()).toEqual({ days: 7, refs: [{ ref: "94:5", n: 6 }, { ref: "2:153", n: 5 }, { ref: "2:255", n: 4 }] });

    const month = await (await call("/api/trending")).json<any>();
    expect(month.days).toBe(30);
    expect(month.refs[0]).toEqual({ ref: "39:10", n: 9 });
    expect(month.refs.map((r: { ref: string }) => r.ref)).not.toContain("1:1");

    // days=1: today (UTC) only.
    const today = await (await call("/api/trending?days=1")).json<any>();
    expect(today.days).toBe(1);
    expect(today.refs).toEqual([]); // the seeded exports and links are from earlier days

    // The edge cache answers the next request without D1.
    const e = makeEnv();
    const prepare = vi.spyOn(e.DB, "prepare");
    expect((await (await call("/api/trending?days=7", {}, e)).json<any>()).refs).toHaveLength(3);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("clamps the window to 1..30 days and answers an empty list when D1 is unavailable", async () => {
    expect((await (await call("/api/trending?days=0")).json<any>()).days).toBe(30); // missing or 0: the default
    expect((await (await call("/api/trending?days=-3")).json<any>()).days).toBe(1);
    expect((await (await call("/api/trending?days=90")).json<any>()).days).toBe(30);
    const res = await call("/api/trending?days=8", {}, { ...makeEnv(), DB: BROKEN_DB } as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({ days: 8, refs: [] });
  });
});
