// GET /data/clips.json and /data/bg/:surah.json: the static files, minus clips hidden in admin.
// Nothing hidden (the usual case) → the asset response itself. Public, so any origin may read them (the iOS / Android
// app loads its pages from the device and reads these from here).
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Clip, SurahBackgrounds } from "../../../../contracts/types";
import { hiddenClips } from "../lib/data";

export const data = new Hono<{ Bindings: Env }>();

data.use("/data/*", cors({ origin: "*", allowMethods: ["GET", "HEAD"], maxAge: 86400 }));

data.get("/data/clips.json", async (c) => {
  const [res, hidden] = await Promise.all([c.env.ASSETS.fetch(c.req.raw), hiddenClips(c.env, c.req.url)]);
  if (!hidden.size || !isJson(res)) return res;
  const clips = (await res.json<Clip[]>()).filter((clip) => !hidden.has(clip.id));
  return c.json(clips, 200, { "Cache-Control": "public, max-age=0, must-revalidate" });
});

data.get("/data/bg/:file", async (c) => {
  const [res, hidden] = await Promise.all([c.env.ASSETS.fetch(c.req.raw), hiddenClips(c.env, c.req.url)]);
  if (!hidden.size || !isJson(res)) return res;
  const bg = await res.json<SurahBackgrounds>();
  for (const [ayah, ids] of Object.entries(bg.ayahs)) bg.ayahs[ayah] = ids.filter((id) => !hidden.has(id));
  return c.json(bg, 200, { "Cache-Control": "public, max-age=0, must-revalidate" });
});

// The single-page-app fallback answers a missing file with index.html.
const isJson = (res: Response) => res.ok && !!res.headers.get("Content-Type")?.includes("json");
