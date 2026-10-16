// The signed-in person's profile: reading it as contracts Me, and strict validation of PATCH /api/me.
import type { Me, Prefs } from "../../../../contracts/types";
import { readData } from "./data";
import { parseAnimation } from "./recipe";
import { RECITERS } from "./stats";

const ORIENTATIONS = ["portrait", "square", "landscape"];
const EFFECTS = ["glass", "solid", "shadow", "outline", "none", "shade"];
const TRANSLATION = /^(none|[a-z]{2,3}\.[\w-]{1,40})$/; // as lib/recipe.ts
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** E.164: "+", a country code that does not start with 0, at most 15 digits in all (8 at least, in practice). */
const E164 = /^\+[1-9]\d{7,14}$/;
export const MAX_INTERESTS = 10;

interface ProfileRow {
  id: string; email: string; name: string; avatar_url: string | null; lang: string | null; display_name: string | null;
  prefs: string | null; interests: string | null; country: string | null; city: string | null; phone: string | null;
  phone_opt_in: number; created_at: number; creations: number; shares: number;
}

const json = <T>(s: string | null, fallback: T): T => {
  try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};

/** The country Cloudflare sees this request coming from ("XX" / "T1" = unknown or Tor → null). */
export function requestCountry(req: Request): string | null {
  const cc = (req as Request & { cf?: { country?: string } }).cf?.country;
  return typeof cc === "string" && /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : null;
}

/** The whole profile of `id` as contracts Me (null when the account is gone). */
export async function profileOf(db: D1Database, id: string, req: Request): Promise<Me | null> {
  const r = await db.prepare(
    `SELECT u.id, u.email, u.name, u.avatar_url, u.lang, u.display_name, u.prefs, u.interests, u.country, u.city, u.phone,
       u.phone_opt_in, u.created_at,
       (SELECT COUNT(*) FROM creations WHERE user_id = u.id) AS creations,
       (SELECT COUNT(*) FROM shares WHERE user_id = u.id) AS shares
     FROM users u WHERE u.id = ?`,
  ).bind(id).first<ProfileRow>();
  if (!r) return null;
  return {
    id: r.id, name: r.name, email: r.email, avatar: r.avatar_url, lang: r.lang ?? null,
    displayName: r.display_name, memberSince: r.created_at, prefs: storedPrefs(r.prefs), interests: json<string[]>(r.interests, []),
    country: r.country, city: r.city, phone: r.phone, phoneOptIn: !!r.phone_opt_in && !!r.phone,
    stats: { creations: r.creations, shares: r.shares }, requestCountry: requestCountry(req),
  };
}

/** Preferences as stored; one saved before the typewriter animation was removed reads as "fade". */
function storedPrefs(v: string | null): Prefs {
  const p = json<Prefs>(v, {});
  if (p.animation !== undefined) p.animation = parseAnimation(p.animation) ?? "none";
  return p;
}

// ---------- PATCH /api/me ----------

export type PatchResult =
  | { ok: true; set: Record<string, string | number | null> }
  | { ok: false; field: string; error: string };

const FIELDS = new Set(["displayName", "prefs", "interests", "country", "city", "phone", "phoneOptIn", "lang"]);
const PREF_KEYS: Record<keyof Prefs, (v: unknown) => boolean> = {
  reciter: (v) => typeof v === "string" && RECITERS.has(v),
  translation: (v) => typeof v === "string" && TRANSLATION.test(v),
  orientation: (v) => ORIENTATIONS.includes(v as string),
  effect: (v) => EFFECTS.includes(v as string),
  animation: (v) => parseAnimation(v) !== undefined, // the removed "typewriter" is kept as "fade"
  voice: (v) => typeof v === "boolean",
  feedVoice: (v) => typeof v === "boolean",
  reelReciter: (v) => v === "mix" || (typeof v === "string" && RECITERS.has(v)),
};

/** Free text: NFC, spaces collapsed, trimmed; "" → null; undefined when it has control characters or is too long. */
function text(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.normalize("NFC").replace(/[ \t]+/g, " ").trim();
  if (!s) return null;
  return CONTROL.test(s) || [...s].length > max ? undefined : s;
}

const regions = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; }
})();
/** An ISO 3166-1 alpha-2 code of a real country or territory (user-assigned codes such as XX are not). */
export function isCountry(cc: string): boolean {
  if (!/^[A-Z]{2}$/.test(cc) || /^(AA|Q[M-Z]|X[A-JL-Z]|ZZ|EU|UN|EZ)$/.test(cc)) return false;
  try { return !regions || regions.of(cc) !== cc; } catch { return false; }
}

/** "+44 (0)7700 900123" → "+447700900123" (the "(0)" trunk prefix, spaces, dashes, dots and brackets dropped);
 *  undefined when it is not E.164. */
export function e164(v: string): string | undefined {
  const s = v.replace(/\(0\)/g, "").replace(/[\s\-.()]/g, "");
  return E164.test(s) ? s : undefined;
}

/** The columns a PATCH /api/me body sets, or the first invalid field. `phoneNow`: the number stored before. */
export async function parsePatch(env: Env, body: Record<string, unknown> | null, phoneNow: string | null): Promise<PatchResult> {
  if (!body) return { ok: false, field: "body", error: "JSON object required" };
  const unknown = Object.keys(body).find((k) => !FIELDS.has(k));
  if (unknown) return { ok: false, field: unknown, error: "unknown field" };
  const set: Record<string, string | number | null> = {};
  const bad = (field: string, error: string): PatchResult => ({ ok: false, field, error });

  if ("displayName" in body) {
    const v = text(body.displayName, 60);
    if (v === undefined) return bad("displayName", "1 to 60 characters");
    set.display_name = v;
  }
  if ("prefs" in body) {
    const p = body.prefs;
    if (p === null) set.prefs = null;
    else {
      if (!p || typeof p !== "object" || Array.isArray(p)) return bad("prefs", "object required");
      const out: Prefs = {};
      for (const [k, v] of Object.entries(p)) {
        const valid = PREF_KEYS[k as keyof Prefs];
        if (!valid) return bad(`prefs.${k}`, "unknown preference");
        if (v === null || v === undefined) continue;
        if (!valid(v)) return bad(`prefs.${k}`, "not one of the choices");
        (out as Record<string, unknown>)[k] = k === "animation" ? parseAnimation(v) : v;
      }
      set.prefs = Object.keys(out).length ? JSON.stringify(out) : null;
    }
  }
  if ("interests" in body) {
    const list = body.interests;
    if (list === null) set.interests = null;
    else {
      if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) return bad("interests", "list of topic ids required");
      const ids = [...new Set(list as string[])];
      if (ids.length > MAX_INTERESTS) return bad("interests", `at most ${MAX_INTERESTS} topics`);
      const topics = await readData<{ topics: { id: string }[] }>(env, "topics.json");
      if (!topics) return bad("interests", "topics are not available right now");
      const known = new Set(topics.topics.map((t) => t.id));
      const missing = ids.find((id) => !known.has(id));
      if (missing) return bad("interests", `unknown topic: ${missing.slice(0, 40)}`);
      set.interests = ids.length ? JSON.stringify(ids) : null;
    }
  }
  if ("country" in body) {
    const v = body.country;
    if (v === null || v === "") set.country = null;
    else if (typeof v === "string" && isCountry(v.toUpperCase())) set.country = v.toUpperCase();
    else return bad("country", "ISO country code required");
  }
  if ("city" in body) {
    const v = text(body.city, 80);
    if (v === undefined) return bad("city", "at most 80 characters");
    set.city = v;
  }
  if ("phone" in body) {
    const v = body.phone;
    if (v === null || v === "") {
      set.phone = null;
      set.phone_opt_in = 0;
    } else {
      const n = typeof v === "string" ? e164(v) : undefined;
      if (!n) return bad("phone", "international format required, e.g. +447700900123");
      set.phone = n;
    }
  }
  if ("phoneOptIn" in body) {
    if (typeof body.phoneOptIn !== "boolean") return bad("phoneOptIn", "true or false");
    const phone = "phone" in set ? set.phone : phoneNow;
    if (body.phoneOptIn && !phone) return bad("phoneOptIn", "a phone number is needed first");
    set.phone_opt_in = body.phoneOptIn && phone ? 1 : 0;
  }
  if ("lang" in body) {
    const v = body.lang;
    if (v !== null && !(typeof v === "string" && /^[a-z]{2,3}$/.test(v))) return bad("lang", "ISO language code required");
    set.lang = v as string | null;
  }
  return { ok: true, set };
}

/** "+447700900123" → "•••••••••123" (admin shows only the last three digits). */
export const maskPhone = (p: string | null) => (p ? `${"•".repeat(Math.max(0, p.length - 3))}${p.slice(-3)}` : null);
