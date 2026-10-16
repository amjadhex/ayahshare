// Signed-in features (contracts Creation):
//   GET /api/creations → Creation[] (newest first)
//   POST /api/creations { recipe, title?, kind, thumb?, at? } → 201 Creation | 200 the same design, updated
//   GET /api/creations/:id/thumb → JPEG (owner only)   DELETE /api/creations/:id (with its thumbnail)
//   GET /api/favourites → Ref[]       PUT /api/favourites/:ref   DELETE /api/favourites/:ref
// Saved designs are recipes plus a small thumbnail (R2 creations/<id>.jpg, kept private: /media/creations/* is not
// served). The exported files are never uploaded; the app renders them again from the recipe.
import { Hono } from "hono";
import type { Creation, CreationKind, Ref } from "../../../../contracts/types";
import { maxBody, rateLimit, readJson } from "../lib/http";
import { parseRecipe, parseRef, storedRecipe } from "../lib/recipe";
import { requireUser, type AppEnv } from "../lib/session";

const MAX_CREATIONS = 500;
const MAX_FAVOURITES = 1000;
const THUMB_MAX = 60 * 1024;
const KINDS: CreationKind[] = ["video", "image", "link"];
/** A design saved again as a link keeps its video / image kind (the file is the stronger record). */
const RANK: Record<CreationKind, number> = { link: 0, image: 1, video: 1 };
const EARLIEST = Date.UTC(2026, 0, 1);

type Row = { id: string; title: string; recipe: string; kind: CreationKind; thumb_key: string | null; created_at: number; updated_at: number | null };
const COLS = "id, title, recipe, kind, thumb_key, created_at, updated_at";

const creation = (r: Row): Creation => ({
  id: r.id, title: r.title, recipe: storedRecipe(r.recipe), kind: r.kind, created_at: r.created_at, updated_at: r.updated_at ?? r.created_at,
  thumb: r.thumb_key ? `/api/creations/${r.id}/thumb?v=${r.updated_at ?? r.created_at}` : null,
});

/** The bytes of a `data:image/jpeg;base64,...` thumbnail up to 60 KB; null when absent; undefined when invalid. */
function thumbBytes(v: unknown): Uint8Array | null | undefined {
  if (v === undefined || v === null) return null;
  const m = typeof v === "string" ? v.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/) : null;
  if (!m || m[1].length > Math.ceil(THUMB_MAX / 3) * 4) return undefined;
  const bytes = Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0));
  return bytes.length <= THUMB_MAX && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : undefined;
}

/** R2 keys of every thumbnail of the account (account deletion). */
export async function thumbKeysOf(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT thumb_key FROM creations WHERE user_id = ? AND thumb_key IS NOT NULL").bind(userId).all<{ thumb_key: string }>();
  return results.map((r) => r.thumb_key);
}

export const creations = new Hono<AppEnv>();
creations.use("*", requireUser);

creations.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM creations WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) DESC`)
    .bind(c.var.user.id).all<Row>();
  return c.json<Creation[]>(results.map(creation));
});

creations.post("/", rateLimit("WRITE_LIMITER", 60), maxBody(120), async (c) => {
  const body = await readJson<{ recipe: unknown; title: unknown; kind: unknown; thumb: unknown; at: unknown }>(c);
  const recipe = parseRecipe(body?.recipe);
  if (!recipe) return c.json({ error: "invalid recipe" }, 400);
  const kind: CreationKind = body?.kind === undefined ? "video" : (body.kind as CreationKind); // older clients send none
  if (!KINDS.includes(kind)) return c.json({ error: "kind must be video, image or link" }, 400);
  const thumb = thumbBytes(body?.thumb);
  if (thumb === undefined) return c.json({ error: "thumb must be a JPEG data URL of at most 60 KB" }, 400);
  const title = typeof body?.title === "string" ? body.title.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) : "";
  // A design moved from the device keeps its time (never in the future, never before the app existed).
  const now = Date.now();
  const at = Number.isInteger(body?.at) ? Math.min(Math.max(body!.at as number, EARLIEST), now) : now;
  const user = c.var.user.id, db = c.env.DB, json = JSON.stringify(recipe);

  // The same design again: update it instead of adding a copy. A design saved before Auto contrast, Split long ayahs or
  // the translation voice existed is stored without those fields (on, on and off by default), so those forms are the
  // same design too; it is stored in the current form.
  const forms = (r: Record<string, unknown>) => {
    const { splitLong, ...noSplit } = r;
    const { autoContrast, ...before } = noSplit;
    return [JSON.stringify(r), ...(splitLong ? [JSON.stringify(noSplit)] : []), ...(splitLong && autoContrast ? [JSON.stringify(before)] : [])];
  };
  const { voice, ...noVoice } = recipe;
  const sameForms = [...new Set([...forms(recipe), ...(voice === "none" ? forms(noVoice) : [])])];
  const same = await db.prepare(`SELECT ${COLS} FROM creations WHERE user_id = ? AND recipe IN (${sameForms.map(() => "?").join(", ")}) LIMIT 1`)
    .bind(user, ...sameForms).first<Row>();
  if (same) {
    const newKind = RANK[kind] >= RANK[same.kind] ? kind : same.kind;
    const key = thumb ? `creations/${same.id}.jpg` : same.thumb_key;
    if (thumb) await c.env.MEDIA.put(key!, thumb, { httpMetadata: { contentType: "image/jpeg" } });
    const updated = Math.max(at, same.updated_at ?? same.created_at);
    await db.prepare("UPDATE creations SET kind = ?, thumb_key = ?, updated_at = ?, title = ?, recipe = ? WHERE id = ?")
      .bind(newKind, key, updated, title || same.title, json, same.id).run();
    return c.json(creation({ ...same, recipe: json, kind: newKind, thumb_key: key, updated_at: updated, title: title || same.title }), 200);
  }

  // Full: the oldest designs make room (auto-save must never fail because of an old limit).
  const { n } = (await db.prepare("SELECT COUNT(*) AS n FROM creations WHERE user_id = ?").bind(user).first<{ n: number }>())!;
  if (n >= MAX_CREATIONS) {
    const { results: old } = await db.prepare(
      "SELECT id, thumb_key FROM creations WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) ASC LIMIT ?",
    ).bind(user, n - MAX_CREATIONS + 1).all<{ id: string; thumb_key: string | null }>();
    await db.batch(old.map((o) => db.prepare("DELETE FROM creations WHERE id = ? AND user_id = ?").bind(o.id, user)));
    const keys = old.flatMap((o) => (o.thumb_key ? [o.thumb_key] : []));
    if (keys.length) await c.env.MEDIA.delete(keys);
  }
  const id = crypto.randomUUID();
  const key = thumb ? `creations/${id}.jpg` : null;
  if (thumb) await c.env.MEDIA.put(key!, thumb, { httpMetadata: { contentType: "image/jpeg" } });
  const row: Row = { id, title, recipe: json, kind, thumb_key: key, created_at: at, updated_at: at };
  await db.prepare("INSERT INTO creations (id, user_id, title, recipe, kind, thumb_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, user, title, json, kind, key, at, at).run();
  return c.json(creation(row), 201);
});

creations.get("/:id/thumb", async (c) => {
  const row = await c.env.DB.prepare("SELECT thumb_key FROM creations WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.user.id).first<{ thumb_key: string | null }>();
  const obj = row?.thumb_key ? await c.env.MEDIA.get(row.thumb_key) : null;
  if (!obj) return c.json({ error: "not found" }, 404);
  // The URL carries ?v=<updated_at>, so a new thumbnail gets a new URL; private: only this browser keeps it.
  return new Response(obj.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
});

creations.delete("/:id", async (c) => {
  const row = await c.env.DB.prepare("DELETE FROM creations WHERE id = ? AND user_id = ? RETURNING thumb_key")
    .bind(c.req.param("id"), c.var.user.id).first<{ thumb_key: string | null }>();
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.thumb_key) await c.env.MEDIA.delete(row.thumb_key);
  return c.json({ ok: true });
});

export const favourites = new Hono<AppEnv>();
favourites.use("*", requireUser);

favourites.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT ref FROM favourites WHERE user_id = ? ORDER BY created_at DESC")
    .bind(c.var.user.id).all<{ ref: Ref }>();
  return c.json<Ref[]>(results.map((r) => r.ref));
});

favourites.put("/:ref", async (c) => {
  const ref = parseRef(c.req.param("ref"));
  if (!ref) return c.json({ error: "invalid ref" }, 400);
  const { n } = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM favourites WHERE user_id = ?").bind(c.var.user.id).first<{ n: number }>())!;
  if (n >= MAX_FAVOURITES) return c.json({ error: `at most ${MAX_FAVOURITES} favourites` }, 409);
  await c.env.DB.prepare("INSERT OR IGNORE INTO favourites (user_id, ref, created_at) VALUES (?, ?, ?)").bind(c.var.user.id, ref, Date.now()).run();
  return c.json({ ok: true });
});

favourites.delete("/:ref", async (c) => {
  const ref = parseRef(c.req.param("ref"));
  if (!ref) return c.json({ error: "invalid ref" }, 400);
  await c.env.DB.prepare("DELETE FROM favourites WHERE user_id = ? AND ref = ?").bind(c.var.user.id, ref).run();
  return c.json({ ok: true });
});
