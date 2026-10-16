// POST /api/events { events: AppEvent[] } — batched analytics from the app (contracts AppEvent).
//   - invalid events are dropped, strings truncated; more than 20 events (the app's batch size) or 64 KB is refused
//   - the batch's counters and funnel stages for today (UTC) and, for an app_open batch (once per app session), the
//     device (the batch's first anon id: active users, sign-in link) go to the D1 counter buffer (src/lib/counters.ts:
//     one D1 batch per isolate every few seconds, within a daily row budget) — the admin metrics (src/lib/stats.ts)
//   - each event becomes one Analytics Engine data point when the EVENTS binding exists (raw-event archive, 3 months)
// No names, emails or IP addresses are stored; country comes from Cloudflare, device/browser/os from the UA.
//
// Analytics Engine layout (dataset quran_design_events; queried by hand in the Cloudflare dashboard / SQL API):
//   index1   anon id (sampling key: one device's events are kept or dropped together)
//   blob1    name          blob2  session      blob3  ref          blob4  clip         blob5  reciter
//   blob6    translation   blob7  orientation  blob8  source       blob9  key          blob10 kind
//   blob11   reason        blob12 q            blob13 country      blob14 device       blob15 browser
//   blob16   os            blob17 colo
//   double1  ayahs         double2 ms          double3 bytes       double4 client ts (ms)
import { Hono } from "hono";
import type { AppEvent, EventName } from "../../../../contracts/types";
import { clipIds } from "../lib/data";
import { maxBody, rateLimit, readJson } from "../lib/http";
import { addEvents } from "../lib/counters";
import { sessionUser } from "../lib/session";
import { tally } from "../lib/stats";
import { parseAgent, type Agent } from "../lib/ua";

export const MAX_EVENTS = 20;
const NAMES = new Set<EventName>([
  "app_open", "search", "search_click", "ayah_select", "bg_select", "customise", "preview_play",
  "export_start", "export_done", "export_failed", "share_native", "link_copy", "share_open",
  "sign_in", "creation_save", "report", "error",
  "feed_view", "feed_skip", "reflect_open", // Discover feed and Reflect (Track F); counted by name like the others
  "today_seen", "today_opened", "today_shared", "reminder_on", "reminder_off", // Today's ayah and its reminder (admin Daily ayah)
]);
/** String props and their maximum lengths (q and reason as in the contract). */
const STRINGS = { ref: 16, clip: 40, reciter: 80, translation: 40, orientation: 16, source: 16, key: 40, kind: 8, reason: 200, q: 100 } as const;
const NUMBERS = ["ayahs", "ms", "bytes"] as const;
const ID = /^[\w-]{1,64}$/;

type Props = NonNullable<AppEvent["props"]>;
type Clean = { name: EventName; ts: number; anon: string; session: string; props: Record<string, string | number> };

function clean(input: unknown): Clean | null {
  const e = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (!NAMES.has(e.name as EventName) || typeof e.anon !== "string" || !ID.test(e.anon) || typeof e.session !== "string" || !ID.test(e.session)) return null;
  const raw = (e.props && typeof e.props === "object" ? e.props : {}) as Record<string, unknown>;
  const props: Record<string, string | number> = {};
  for (const [k, max] of Object.entries(STRINGS)) if (typeof raw[k] === "string") props[k] = (raw[k] as string).slice(0, max);
  for (const k of NUMBERS) if (Number.isFinite(raw[k])) props[k] = raw[k] as number;
  return { name: e.name as EventName, ts: Number.isFinite(e.ts) ? (e.ts as number) : Date.now(), anon: e.anon, session: e.session, props };
}

export const events = new Hono<{ Bindings: Env }>();

events.post("/", rateLimit("EVENTS_LIMITER", 60), maxBody(64), async (c) => {
  const body = await readJson<{ events: unknown[] }>(c);
  if (!Array.isArray(body?.events)) return c.json({ error: "events required" }, 400);
  if (body.events.length > MAX_EVENTS) return c.json({ error: `at most ${MAX_EVENTS} events` }, 413);
  const list = body.events.flatMap((e) => clean(e) ?? []);
  if (!list.length) return c.json({ accepted: 0 });

  const cf = (c.req.raw.cf ?? {}) as { country?: string; colo?: string };
  const agent = parseAgent(c.req.header("User-Agent") ?? "");
  const country = cf.country ?? "";

  if (c.env.EVENTS) {
    for (const e of list) {
      const p = e.props as Props;
      c.env.EVENTS.writeDataPoint({
        indexes: [e.anon],
        blobs: [e.name, e.session, p.ref, p.clip, p.reciter, p.translation, p.orientation, p.source, p.key, p.kind, p.reason, p.q,
          country, agent.device, agent.browser, agent.os, cf.colo ?? ""].map((b) => b ?? ""),
        doubles: [p.ayahs ?? 0, p.ms ?? 0, p.bytes ?? 0, e.ts],
      });
    }
  }
  const opens = list.filter((e) => e.anon === list[0].anon && e.name === "app_open").length;
  const user = opens ? sessionUser(c) : Promise.resolve(null);
  c.executionCtx.waitUntil(record(c.env, list, country, agent, opens, user).catch((e) => console.warn("events write failed:", String(e))));
  return c.json({ accepted: list.length });
});

/** The batch's counters and funnel stages, and for an app_open batch the device (the batch's first anon id — the app
 *  sends one; app opens as sessions, the signed-in user), into the D1 counter buffer. */
async function record(env: Env, list: Clean[], country: string, agent: Agent, opens: number, user: Promise<{ id: string } | null>) {
  const [signedIn, clips] = await Promise.all([user, clipIds(env)]);
  const t = tally(list, { country, device: agent.device, browser: agent.browser }, clips);
  // The app's devices are "<os>-app" (android-app, ios-app); the website's are the OS alone.
  const platform = agent.app ? `${agent.os}-app` : agent.os;
  const device = { userId: signedIn?.id ?? null, country: country || null, platform, seen: Date.now(), sessions: opens };
  return addEvents(env, t, opens ? [list[0].anon, device] : null);
}
