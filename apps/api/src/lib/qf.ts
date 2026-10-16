// Quran Foundation API client (tafsir, QuranReflect): OAuth client credentials with the Worker secrets QF_CLIENT_ID /
// QF_CLIENT_SECRET. The access token lasts an hour; it is kept in this isolate and renewed a minute before it expires
// (or at once when the API refuses it). QF_ENV picks the environment: "production" (default) or "prelive".
// The secret never leaves the Worker: only the token goes to the API, and nothing of either reaches a response.

const ENVS = {
  production: { token: "https://oauth2.quran.foundation/oauth2/token", base: "https://apis.quran.foundation" },
  prelive: { token: "https://prelive-oauth2.quran.foundation/oauth2/token", base: "https://apis-prelive.quran.foundation" },
} as const;
const SCOPE = "content post.read";
const TIMEOUT_MS = 8000;

export class QfError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type QfEnv = Pick<Env, "QF_CLIENT_ID" | "QF_CLIENT_SECRET" | "QF_ENV">;

const urlsOf = (env: QfEnv) => ENVS[env.QF_ENV === "prelive" ? "prelive" : "production"];
export const qfConfigured = (env: QfEnv) => !!(env.QF_CLIENT_ID && env.QF_CLIENT_SECRET);

let cached: { key: string; token: string; expires: number } | null = null;
let pending: { key: string; promise: Promise<string> } | null = null;

/** Forgets the isolate's token (tests; or after the API refused it). */
export const resetQfToken = () => { cached = null; pending = null; };

async function newToken(env: QfEnv, key: string): Promise<string> {
  const res = await fetch(urlsOf(env).token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.QF_CLIENT_ID}:${env.QF_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json<{ access_token?: string; expires_in?: number }>().catch(() => ({} as { access_token?: string; expires_in?: number }));
  if (!res.ok || !body.access_token) throw new QfError(502, `token ${res.status}`);
  const ttl = Math.max(60, Number(body.expires_in) || 3600);
  cached = { key, token: body.access_token, expires: Date.now() + (ttl - 60) * 1000 };
  return body.access_token;
}

/** The access token for this environment and client, from the isolate when still valid. Concurrent requests share one
 *  token request. */
async function token(env: QfEnv): Promise<string> {
  const key = `${env.QF_ENV ?? ""}:${env.QF_CLIENT_ID}`;
  if (cached?.key === key && cached.expires > Date.now()) return cached.token;
  if (pending?.key !== key) {
    const promise = newToken(env, key).finally(() => { if (pending?.promise === promise) pending = null; });
    pending = { key, promise };
  }
  return pending.promise;
}

/** GET a Quran Foundation API path (e.g. "/content/api/v4/resources/tafsirs") as JSON. Throws QfError: 503 when the
 *  credentials are missing, the upstream status for 4xx answers, 502 for anything else. */
export async function qfGet<T>(env: QfEnv, path: string): Promise<T> {
  if (!qfConfigured(env)) throw new QfError(503, "not configured");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(urlsOf(env).base + path, {
      headers: { "x-auth-token": await token(env), "x-client-id": env.QF_CLIENT_ID!, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((e) => { throw new QfError(502, `upstream ${String(e)}`); });
    if (res.status === 401 && attempt === 0) { cached = null; continue; } // token revoked or expired early: once more
    if (res.ok) return res.json<T>();
    throw new QfError(res.status >= 400 && res.status < 500 ? res.status : 502, `upstream ${res.status}`);
  }
}
