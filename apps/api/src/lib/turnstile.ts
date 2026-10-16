// Cloudflare Turnstile, the bot check before an email sign-in code is sent (POST /api/auth/email/start), so bots cannot
// use up the email quota or flood someone's inbox. Required only when both are set: TURNSTILE_SITE_KEY (wrangler.jsonc
// vars; public, the web app renders the widget with it via /api/config) and the TURNSTILE_SECRET secret. With either
// missing there is no check and email sign-in works as before.
import type { Context } from "hono";
import { isAppOrigin } from "./http";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** The widget's action (apps/web EmailSignIn.tsx renders it with the same), checked so a token made elsewhere fails. */
export const TURNSTILE_ACTION = "email-code";

export const turnstileOn = (env: Env) => !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET;

/** Whether `token` is a fresh Turnstile pass for this site and action. Fails closed: a missing or malformed token,
 *  siteverify refusing it or not answering, another hostname or action are all false. The page that made the token is
 *  the one this request came from (same-origin writes), or the iOS / Android app, whose pages are on "localhost". */
export async function passesTurnstile<E extends { Bindings: Env }>(c: Context<E>, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const remoteip = c.req.header("CF-Connecting-IP");
  let result: { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: c.env.TURNSTILE_SECRET, response: token, ...(remoteip ? { remoteip } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = await res.json();
  } catch (e) {
    console.warn("turnstile check failed:", String(e).slice(0, 200));
    return false;
  }
  const host = isAppOrigin(c) ? "localhost" : new URL(c.req.url).hostname;
  if (result.success && result.hostname === host && result.action === TURNSTILE_ACTION) return true;
  console.warn("turnstile refused:", JSON.stringify({ errors: result["error-codes"], hostname: result.hostname, action: result.action }));
  return false;
}
