// Background library: GET /api/clips?q=...&limit=24 and GET /api/clips/:id.
// The catalogue is data/clips.json (active clips, curated order) minus clips hidden in admin; CLIPS_INDEX ids are clip ids.
import { Hono } from "hono";
import type { Clip, ClipsResponse } from "../../../../contracts/types";
import { hiddenClips, readData } from "../lib/data";
import { queryVector } from "../lib/embed";
import { intParam } from "../lib/http";

export const clips = new Hono<{ Bindings: Env }>();

async function catalogue(env: Env, url: string): Promise<Clip[]> {
  const [all, hidden] = await Promise.all([readData<Clip[]>(env, "clips.json"), hiddenClips(env, url)]);
  return (all ?? []).filter((clip) => !hidden.has(clip.id));
}

clips.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const limit = intParam(c, "limit", 24, 1, 50);
  const all = await catalogue(c.env, c.req.url);
  if (!q || !all.length) return c.json<ClipsResponse>({ results: all.slice(0, limit) });

  const byId = new Map(all.map((clip) => [clip.id, clip]));
  try {
    const v = await queryVector(c.env, c.req.url, q, "clip_query"); // text query → poster image + caption vectors
    // A few extra matches cover clips that were hidden after the index was built.
    const { matches } = await c.env.CLIPS_INDEX.query(v, { topK: limit + 10 });
    const results = matches.flatMap((m) => byId.get(m.id) ?? []).slice(0, limit);
    if (results.length) return c.json<ClipsResponse>({ results });
  } catch (e) {
    console.warn("clip search failed:", String(e)); // e.g. OpenRouter error or timeout
  }
  // No vector results: clips whose caption or tags contain a query word come first, then the default order.
  const words = q.toLowerCase().split(/\s+/);
  const hit = (clip: Clip) => words.some((w) => `${clip.caption} ${clip.tags.join(" ")}`.toLowerCase().includes(w));
  return c.json<ClipsResponse>({ results: [...all.filter(hit), ...all.filter((x) => !hit(x))].slice(0, limit) });
});

clips.get("/:id", async (c) => {
  const clip = (await catalogue(c.env, c.req.url)).find((x) => x.id === c.req.param("id"));
  return clip ? c.json(clip) : c.json({ error: "not found" }, 404);
});
