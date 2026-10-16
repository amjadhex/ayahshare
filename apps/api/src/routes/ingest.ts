// Admin-only ingestion endpoints used by the offline pipeline (Bearer ADMIN_TOKEN).
import { Hono } from "hono";
import { EMBED_KINDS, embed, embedImages, type EmbedKind } from "../lib/embed";
import { bearerIs } from "../lib/http";

export const ingest = new Hono<{ Bindings: Env }>();

ingest.use("*", async (c, next) => {
  if (!(await bearerIs(c, c.env.ADMIN_TOKEN))) return c.json({ error: "unauthorized" }, 401);
  await next();
});

/** PUT /admin/api/ingest/media/<key> — raw body stored in R2 under <key>. */
ingest.put("/media/*", async (c) => {
  const key = c.req.path.replace(/^\/admin\/api\/ingest\/media\//, "");
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType: c.req.header("Content-Type") ?? "application/octet-stream" } });
  return c.json({ key });
});

/** POST /admin/api/ingest/embed { texts: string[], kind: "query" | "clip_query" | "document" } or { images: string[] }
 *  (https: or data: URLs) → { vectors: number[][] } (EMBED_DIM, unit length): the model and formats search uses. */
ingest.post("/embed", async (c) => {
  const { texts, kind, images } = await c.req.json<{ texts?: string[]; kind?: EmbedKind; images?: string[] }>();
  if (images?.length) return c.json({ vectors: await embedImages(c.env, images) });
  if (!texts?.length || !EMBED_KINDS.includes(kind!)) return c.json({ error: "texts and kind, or images, are required" }, 400);
  return c.json({ vectors: await embed(c.env, texts, kind!) });
});

/** POST /admin/api/ingest/vectors/:index { vectors: { id, values, metadata? }[] } — index: "ayahs" | "clips". */
ingest.post("/vectors/:index", async (c) => {
  const index = c.req.param("index") === "ayahs" ? c.env.AYAHS_INDEX : c.env.CLIPS_INDEX;
  const { vectors } = await c.req.json<{ vectors: VectorizeVector[] }>();
  return c.json(await index.upsert(vectors));
});
