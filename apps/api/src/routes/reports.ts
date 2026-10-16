// POST /api/reports { kind, ref?, clip?, note?, anon? } — "something looks wrong" from the app → D1 reports (admin queue).
import { Hono } from "hono";
import type { ReportBody } from "../../../../contracts/types";
import { maxBody, rateLimit, readJson } from "../lib/http";
import { isClipId, parseRef } from "../lib/recipe";
import { sessionUser } from "../lib/session";

const KINDS = ["background", "search", "text", "other"];

export const reports = new Hono<{ Bindings: Env }>();

reports.post("/", rateLimit("WRITE_LIMITER", 60), maxBody(16), async (c) => {
  const body = await readJson<ReportBody & { anon: string }>(c);
  if (!body || !KINDS.includes(body.kind as string)) return c.json({ error: "invalid kind" }, 400);
  const ref = body.ref === undefined ? null : parseRef(body.ref);
  const clip = body.clip === undefined ? null : isClipId(body.clip) ? body.clip : false;
  if ((ref === null && body.ref !== undefined) || clip === false) return c.json({ error: "invalid ref or clip" }, 400);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
  const anon = typeof body.anon === "string" && /^[\w-]{1,64}$/.test(body.anon) ? body.anon : null;
  const user = await sessionUser(c);
  const row = await c.env.DB.prepare(
    "INSERT INTO reports (created_at, anon_id, user_id, kind, ref, clip_id, note) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
  ).bind(Date.now(), anon, user?.id ?? null, body.kind, ref, clip, note).first<{ id: number }>();
  return c.json({ id: row!.id }, 201);
});
