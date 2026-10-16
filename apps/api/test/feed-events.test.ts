// The Discover feed's events (Track F) are accepted and counted by name like every other event.
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { send } from "./helpers";

it("feed_view (with watch ms), feed_skip and reflect_open are accepted and counted", async () => {
  const ev = (name: string, props: Record<string, unknown>) => ({ name, ts: Date.now(), anon: "anon-feed", session: "s-feed", props });
  const res = await send("POST", "/api/events", { events: [
    ev("feed_view", { ref: "94:5", ayahs: 1, clip: "pb1", ms: 12000, key: "you" }),
    ev("feed_skip", { ref: "2:153", ms: 800, key: "hope" }),
    ev("reflect_open", { ref: "2:153", key: "feed" }),
    ev("feed_unknown", {}),
  ] });
  expect(await res.json()).toEqual({ accepted: 3 });
  const day = new Date().toISOString().slice(0, 10);
  const { results } = await env.DB.prepare("SELECT dim, value FROM daily_stats WHERE day = ? AND metric = 'event' AND dim IN ('feed_view', 'feed_skip', 'reflect_open') ORDER BY dim")
    .bind(day).all<{ dim: string; value: number }>();
  expect(results).toEqual([{ dim: "feed_skip", value: 1 }, { dim: "feed_view", value: 1 }, { dim: "reflect_open", value: 1 }]);
});
