// Sign-in sessions: a random token in an HTTP-only __Host- cookie (web) or an `Authorization: Bearer` header (the iOS /
// Android app, which gets the token from /api/auth/google); D1 keeps only its SHA-256.
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, sha256 } from "./http";

export const SESSION_COOKIE = "__Host-qd_session";
const SESSION_MS = 30 * 86400_000;

export interface User { id: string; email: string; name: string; avatar_url: string | null; lang: string | null }
export type AppEnv = { Bindings: Env; Variables: { user: User } };

/** This request's session token: the Bearer header (the apps), else the cookie (web). */
function sessionToken(c: Context): string | undefined {
  return c.req.header("Authorization")?.match(/^Bearer ([\w-]{43})$/)?.[1] ?? getCookie(c, SESSION_COOKIE);
}

/** The signed-in user of this request, or null. */
export async function sessionUser<E extends { Bindings: Env }>(c: Context<E>): Promise<User | null> {
  const token = sessionToken(c);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.avatar_url, u.lang FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), Date.now()).first<User>();
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "not signed in" }, 401);
  c.set("user", user);
  await next();
};

/** Starts a session (cookie set) and returns its token, which the apps keep and send as a Bearer header. */
export async function startSession<E extends { Bindings: Env }>(c: Context<E>, userId: string): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now, now + SESSION_MS).run();
  setCookie(c, SESSION_COOKIE, token, { path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge: SESSION_MS / 1000 });
  return token;
}

export async function endSession<E extends { Bindings: Env }>(c: Context<E>) {
  const token = sessionToken(c);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
}
