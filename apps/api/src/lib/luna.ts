// Luna (OpenRouter Decisions endpoint) behind one decide() adapter, with a hard timeout and a daily spend cap.
// Request:  { model, state, questions: { <name>: { type: "choice", instructions, criteria: { value: description } } | { type: "noul", instructions } } }
// Response: { answers: { <name>: { choice, probabilities: { value: p } } | { noul: p } }, usage: { input_tokens, cost } }

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };
export interface Answer { choice?: string; probabilities?: Record<string, number>; noul?: number }

const today = () => new Date().toISOString().slice(0, 10);

/** Luna may be called: an API key is set, and today's spend and calls are below LUNA_DAILY_CAP_USD and LUNA_DAILY_CALLS
 *  (the call count still holds if a reply leaves out its cost). */
export async function lunaAllowed(env: Env): Promise<boolean> {
  if (!env.OPENROUTER_API_KEY) return false;
  const row = await env.DB.prepare("SELECT calls, cost_usd FROM luna_usage WHERE day = ?").bind(today()).first<{ calls: number; cost_usd: number }>();
  return (row?.cost_usd ?? 0) < Number(env.LUNA_DAILY_CAP_USD || 1) && (row?.calls ?? 0) < Number(env.LUNA_DAILY_CALLS || 6000);
}

/** One Luna call. null on timeout or any error, so callers keep the embedding order. */
export async function decide(
  env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, state: unknown, questions: Record<string, Question>,
  timeoutMs = Number(env.LUNA_TIMEOUT_MS) || 4000,
): Promise<Record<string, Answer> | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.LUNA_MODEL, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json<{ answers: Record<string, Answer>; usage?: { input_tokens?: number; cost?: number } }>();
    recordSpend(env, ctx, data.usage?.input_tokens ?? 0, data.usage?.cost ?? 0);
    return data.answers;
  } catch (e) {
    console.warn("luna unavailable:", String(e));
    return null;
  }
}

/** Counts one AI call (Luna, or the search's intent model) towards today's LUNA_DAILY_CAP_USD and LUNA_DAILY_CALLS. */
export function recordSpend(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, inputTokens: number, cost: number) {
  ctx.waitUntil(
    env.DB.prepare(
      `INSERT INTO luna_usage (day, calls, input_tokens, cost_usd) VALUES (?1, 1, ?2, ?3)
       ON CONFLICT(day) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + ?2, cost_usd = cost_usd + ?3`,
    ).bind(today(), inputTokens, cost).run(),
  );
}

/** Values ordered best-first by a choice answer's probabilities (ties keep the input order). */
export function ranked(answer: Answer | undefined, values: string[]): string[] | null {
  const p = answer?.probabilities ?? (answer?.choice ? { [answer.choice]: 1 } : null);
  if (!p) return null;
  return values.map((v, i) => ({ v, i, p: p[v] ?? 0 })).sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.v);
}
