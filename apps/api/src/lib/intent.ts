// What a search is really after, for searches a plain embedding misreads (owner, 15 Oct 2026): "എനിക്ക് സങ്കടമുണ്ട്"
// ("I am sad") is close to verses that mention grief, while the person wants the verses that answer it. A small text
// model (INTENT_MODEL through OpenRouter) writes in English what the verses that would best answer the person say; the
// search embeds that instead. Kept in this colo's cache by model and normalised query; null on any error or after
// INTENT_TIMEOUT_MS, and the search goes on without it.
import { cacheUrl, edgeJson, normalise } from "./edge";
import { recordSpend } from "./luna";

const SYSTEM = "You help a Quran search app. The user message is exactly what a person typed into the search box, in any language. " +
  "Write in English, in one to three sentences, what the Quran verses that would best answer this person say: the meaning a " +
  "perfect result carries, not a restatement of their words. Plain text only, no verse numbers.";
const TTL = 30 * 86400;

export async function describeIntent(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, requestUrl: string, q: string): Promise<string | null> {
  const key = cacheUrl(requestUrl, `intent?m=${encodeURIComponent(env.INTENT_MODEL)}&q=${encodeURIComponent(normalise(q))}`);
  try {
    return await edgeJson(key, TTL, async () => {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.INTENT_MODEL, max_tokens: 150, reasoning: { enabled: false },
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }],
        }),
        signal: AbortSignal.timeout(Number(env.INTENT_TIMEOUT_MS) || 5000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const d = await res.json<{ choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; cost?: number } }>();
      recordSpend(env, ctx, d.usage?.prompt_tokens ?? 0, d.usage?.cost ?? 0);
      return d.choices?.[0]?.message?.content?.trim() || null;
    });
  } catch (e) {
    console.warn("intent unavailable:", String(e));
    return null;
  }
}
