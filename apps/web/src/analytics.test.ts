import { afterEach, expect, it, vi } from "vitest";
import type { AppEvent } from "../../../contracts/types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("sends batches every 30 s, and starts a new device id after sign-out (reports and sign-in use it too)", async () => {
  vi.useFakeTimers();
  const posts: { url: string; body: { events?: AppEvent[]; anon?: string } }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    posts.push({ url, body: JSON.parse(init.body as string) });
    return new Response(null, { status: 204 });
  }));
  const analytics = await import("./analytics");
  const api = await import("./api");
  const first = analytics.anon;
  expect(localStorage.getItem("qd.anon")).toBe(first);

  analytics.track("app_open");
  vi.advanceTimersByTime(29_000);
  expect(posts).toHaveLength(0);
  vi.advanceTimersByTime(1_000);
  expect(posts.map((p) => p.body.events?.[0].name)).toEqual(["app_open"]);

  analytics.track("search", { q: "patience" });
  analytics.newDevice();
  // Queued events were made before the sign-out, so they go out at once under the old ids.
  expect(posts[1].body.events?.[0]).toMatchObject({ name: "search", anon: first });
  expect(analytics.anon).not.toBe(first);
  expect(localStorage.getItem("qd.anon")).toBe(analytics.anon);

  analytics.track("search", { q: "mercy" });
  analytics.flush();
  expect(posts[2].body.events?.[0].anon).toBe(analytics.anon);
  expect(posts[2].body.events?.[0].session).not.toBe(posts[1].body.events?.[0].session);

  await api.sendReport({ kind: "search", note: "x" });
  expect(posts[3]).toMatchObject({ url: "/api/reports", body: { anon: analytics.anon } });
});

it("an automated browser (navigator.webdriver) sends no events", async () => {
  vi.resetModules();
  vi.stubGlobal("navigator", { ...navigator, webdriver: true });
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const analytics = await import("./analytics");
  analytics.track("app_open");
  analytics.flush();
  expect(fetch).not.toHaveBeenCalled();
});
