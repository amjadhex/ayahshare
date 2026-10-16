// Reflect: tafsir and QuranReflect reflections for one ayah, from the Quran Foundation API (src/lib/qf.ts).
//   GET /api/tafsirs                                 contracts TafsirListResponse   edge cache 7 days (less those turned off
//                                                    in admin Library: lib/turnedoff.ts)
//   GET /api/tafsir/:ref?lang=<iso>&id=<tafsir id>   contracts TafsirResponse       edge cache 30 days (never changes)
//   GET /api/reflections/:ref?lang=<iso>&page=<n>[&kind=lessons]   contracts ReflectionsResponse  edge cache 1 day
// The tafsir is the one asked for (any tafsir on the list, in any language), else the person's language's default when
// there is one, else English's; it is never translated. Some tafsirs are ours (lib/owntafsir.ts): Thafheemul Quran
// (Malayalam, "ml.thafheem") and the spa5k/tafsir_api editions come from our own storage, never from the Quran Foundation, so
// they are listed and served without its credentials; Tafhim al-Qur'an in English ("en.tafheem") is read from it live.
// The HTML is sanitised and laid out for reading (src/lib/tafsir.ts).
// Reflections and lessons are QuranReflect posts: reported or flagged-toxic posts are left out, verified authors (the
// QuranReflect tick: mostly teachers, who write most lessons) come first, then posts in the person's language, and each
// links back to QuranReflect. Authors' photos go through our own Worker (routes/avatar.ts).
import { Hono, type Context } from "hono";
import type { ReflectionPost, ReflectionsResponse, TafsirInfo, TafsirListResponse, TafsirResponse } from "../../../../contracts/types";
import { cacheUrl, edgeJson } from "../lib/edge";
import { rateLimit } from "../lib/http";
import { QfError, qfConfigured, qfGet } from "../lib/qf";
import { plainText } from "../lib/sanitize";
import { formatTafsir } from "../lib/tafsir";
import { TAFHEEM_EN_ID, needsQf, ownText, ownTafsirs, qfNotes } from "../lib/owntafsir";
import { THAFHEEM_ID, thafheem } from "../lib/thafheem";
import { turnedOff } from "../lib/turnedoff";
import { avatarPath } from "./avatar";

const DAY = 86400;

export const reflect = new Hono<{ Bindings: Env }>();

/** "2:153" → [2, 153], or null. */
function parseAyah(ref: string): [number, number] | null {
  const m = ref.match(/^(\d{1,3}):(\d{1,3})$/);
  if (!m) return null;
  const s = +m[1], a = +m[2];
  return s >= 1 && s <= 114 && a >= 1 && a <= 286 ? [s, a] : null;
}
const isoOf = (lang: string | undefined) => (lang && /^[a-z]{2,3}$/.test(lang) ? lang : "en");

function failed(c: Context, e: unknown) {
  const status = e instanceof QfError ? e.status : 502;
  if (status >= 500) console.warn("quran foundation:", String(e));
  return c.json({ error: status === 503 ? "not available" : status === 404 ? "not found" : "upstream unavailable" },
    status === 503 ? 503 : status === 404 ? 404 : 502, { "Cache-Control": "no-store" });
}

// ---------- tafsir ----------

interface QfTafsirResource { id: number; name: string; author_name: string | null; language_name: string; translated_name?: { name: string } }
interface QfTafsir { tafsir: { verses?: Record<string, unknown>; resource_id: number; resource_name?: string; text: string; translated_name?: { name: string } } }

/** Quran Foundation language names → ISO codes: production's seven (Oct 2026), and QuranReflect's languages for any the
 *  source adds later. A tafsir in a language not named here is left out (it could not be labelled). */
const LANGUAGES: Record<string, string> = { arabic: "ar", bengali: "bn", english: "en", russian: "ru", swahili: "sw", urdu: "ur", kurdish: "ku" };
const languageOf = (name: string) => { const n = name.toLowerCase(); return LANGUAGES[n] ?? LANGUAGE_CODES[n]; };
/** The languages the Quran Foundation has tafsirs in: for any other, the default is one of ours and needs nothing from it. */
const QF_LANGUAGES = new Set(Object.values(LANGUAGES));
/** Preferred tafsirs per language, first = default: the most widely read, and the shorter ones for Arabic. Tafsirs not
 *  listed follow: the source's (in its order), then ours (in ours). */
const PREFERRED: Record<string, (number | string)[]> = {
  ml: [THAFHEEM_ID, "ml.amani", "ml.mukhtasar"], en: [169, TAFHEEM_EN_ID, 168, "en.mukhtasar", 817, "en.jalalayn", "en.ibnabbas"],
  ur: [160, "ur.tafheem", 159, "ur.usmani", 818, 157], ar: [16, 91, 14, 15, 90, 93, 94], bn: [164, 165, 166],
};
/** Listed by the source but not offered: 381 Fathul Majid (Bengali) answers with empty text for most ayahs (checked
 *  Oct 2026: 1:1, 2:153, 3:1, 18:10, 36:1, 94:5, 112:1… are empty; only a few, such as 2:255, have text). */
const NOT_OFFERED = new Set([381]);

/** The Quran Foundation's tafsirs by language (cached for a week). */
async function qfTafsirs(c: Context<{ Bindings: Env }>): Promise<TafsirInfo[]> {
  const list = await edgeJson(cacheUrl(c.req.url, `qf-tafsirs4-${c.env.QF_ENV || "production"}`), 7 * DAY, async () => {
    const d = await qfGet<{ tafsirs: QfTafsirResource[] }>(c.env, "/content/api/v4/resources/tafsirs");
    return d.tafsirs.flatMap((t): TafsirInfo[] => {
      const lang = languageOf(t.language_name ?? "");
      return lang && Number.isInteger(t.id) && !NOT_OFFERED.has(t.id)
        ? [{ id: t.id, name: t.translated_name?.name || t.name, author: t.author_name || null, lang }] : [];
    });
  });
  return list ?? [];
}

/** Every tafsir the app offers (ours, then the Quran Foundation's in `qf`), by language, in preference order. */
function sorted(c: Context<{ Bindings: Env }>, qf: TafsirInfo[]): TafsirInfo[] {
  // Not preferred: the source's before ours (number ids before strings).
  const rank = (t: TafsirInfo) => { const i = (PREFERRED[t.lang] ?? []).indexOf(t.id); return i < 0 ? (typeof t.id === "number" ? 99 : 100) : i; };
  return [...ownTafsirs(qfConfigured(c.env)), ...qf].map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
}

/** Every tafsir the app has, the ones the admin turned off too (admin Library). Without Quran Foundation credentials:
 *  ours only. */
export async function allTafsirs(c: Context<{ Bindings: Env }>): Promise<TafsirInfo[]> {
  return sorted(c, qfConfigured(c.env) ? await qfTafsirs(c) : []);
}

/** Leaves out the tafsirs the admin turned off. */
const offered = async (c: Context<{ Bindings: Env }>, list: TafsirInfo[]) => {
  const off = new Set((await turnedOff(c.env.DB)).tafsirs);
  return list.filter((t) => !off.has(String(t.id)));
};

reflect.get("/tafsirs", rateLimit("SEARCH_LIMITER", 300), async (c) => {
  try {
    // Five minutes in the browser: a tafsir the admin turns off or on shows soon.
    return c.json<TafsirListResponse>({ tafsirs: await offered(c, await allTafsirs(c)) }, 200, { "Cache-Control": "public, max-age=300" });
  } catch (e) {
    return failed(c, e);
  }
});

reflect.get("/tafsir/:ref", rateLimit("SEARCH_LIMITER", 300), async (c) => {
  const ayah = parseAyah(c.req.param("ref"));
  if (!ayah) return c.json({ error: "invalid ref" }, 400);
  const ref = `${ayah[0]}:${ayah[1]}`, lang = isoOf(c.req.query("lang"));
  const wanted = c.req.query("id") ?? "";
  // Ours is asked for by id (other than the one read from the Quran Foundation), or by a language the Quran Foundation has
  // no tafsir in, with no (numeric) id: that needs nothing from it.
  const mine = ownTafsirs(qfConfigured(c.env));
  const asked = mine.find((t) => String(t.id) === wanted);
  const ours = asked ? !needsQf(asked.id) : !/^\d+$/.test(wanted) && !QF_LANGUAGES.has(lang) && mine.some((t) => t.lang === lang && !needsQf(t.id));
  if (!ours && !qfConfigured(c.env)) return c.json({ error: "not available" }, 503);
  try {
    const qf = qfConfigured(c.env) ? await qfTafsirs(c).catch((e) => { if (ours) return []; throw e; }) : [];
    const all = await offered(c, sorted(c, qf));
    const own = all.filter((t) => t.lang === lang);
    const pool = own.length ? own : all.filter((t) => t.lang === "en");
    // Only a tafsir on the list is ever asked for; any other id gets the language's default.
    const pick = all.find((t) => String(t.id) === wanted) ?? pool[0];
    if (!pick) throw new QfError(404, "no tafsir");
    // The text is cached by ayah and tafsir; the rest of the answer depends on the language asked for.
    const id = String(pick.id), env = c.env.QF_ENV || "production";
    const key = cacheUrl(c.req.url, pick.id === THAFHEEM_ID ? `thafheem4/${ref}`
      : pick.id === TAFHEEM_EN_ID ? `qf-tafheem1-${env}/${ref}` : needsQf(pick.id) ? `qf-notes2-${env}/${id}/${ref}`
      : typeof pick.id === "string" ? `own-tafsir1/${id}/${ref}` : `qf-tafsir3-${env}/${ref}/${id}`);
    const text = await edgeJson<Pick<TafsirResponse, "from" | "to" | "html">>(key, 30 * DAY, async () => {
      if (pick.id === THAFHEEM_ID) return thafheem(c.env.MEDIA, ayah);
      if (needsQf(pick.id)) return qfNotes(c.env, pick.id, ayah);
      if (typeof pick.id === "string") return ownText(c.env.MEDIA, pick.id, pick.lang, ayah);
      const d = await qfGet<QfTafsir>(c.env, `/content/api/v4/tafsirs/${pick.id}/by_ayah/${ref}`);
      // The ayahs the passage explains, within this surah: some sources list ayahs of other surahs too (Tazkir ul Quran
      // gives 84:1–94:8 for 94:5).
      const verses = Object.keys(d.tafsir.verses ?? {}).filter((v) => /^\d+:\d+$/.test(v) && v.split(":")[0] === String(ayah[0]));
      return { from: verses[0] ?? ref, to: verses.at(-1) ?? ref, html: formatTafsir(d.tafsir.text ?? "", pick.lang) };
    });
    return c.json<TafsirResponse>({
      ref, lang: pick.lang, fallback: !own.length, tafsir: { id: pick.id, name: pick.name, author: pick.author }, ...text!,
      options: pool.map((t) => ({ id: t.id, name: t.name })),
    }, 200, { "Cache-Control": "public, max-age=3600" }); // the text is edge-cached; the options follow admin Library within the hour
  } catch (e) {
    return failed(c, e);
  }
});


// ---------- reflections and lessons ----------

interface QfPost {
  id: number; body: string; likesCount?: number; languageName?: string; publishedAt?: string; createdAt?: string;
  reported?: boolean; toxicityScore?: number;
  author?: { username?: string; fullName?: string; verified?: boolean; avatarUrls?: { small?: string; medium?: string; large?: string } };
}
interface QfFeed { data: QfPost[]; total: number; pages: number; currentPage: number }
type Kind = "reflections" | "lessons";

/** QuranReflect language ids (found by asking the feed for each id). Languages without reflections use English. */
export const REFLECT_LANGUAGES: Record<string, number> = {
  ar: 1, en: 2, es: 3, ms: 4, ur: 5, id: 6, fr: 7, fi: 8, am: 9, az: 10, de: 13, ja: 17, fa: 32, ko: 37, nl: 39, it: 41,
  so: 43, ps: 47, pt: 48, sv: 53, sw: 59, th: 62, tr: 65, ru: 67, bn: 69, zh: 71,
};
const LANGUAGE_CODES: Record<string, string> = Object.fromEntries(Object.entries({
  Arabic: "ar", English: "en", Spanish: "es", Malay: "ms", Urdu: "ur", Indonesian: "id", French: "fr", Finnish: "fi", Amharic: "am",
  Azeri: "az", German: "de", Japanese: "ja", Persian: "fa", Korean: "ko", Dutch: "nl", Italian: "it", Somali: "so", Pashto: "ps",
  Portuguese: "pt", Swedish: "sv", Swahili: "sw", Thai: "th", Turkish: "tr", Russian: "ru", Bengali: "bn", Chinese: "zh",
}).map(([k, v]) => [k.toLowerCase(), v]));
const MAX_TOXICITY = 60;
/** QuranReflect post types: 1 = reflection, 2 = lesson. */
const POST_TYPE: Record<Kind, string> = { reflections: "1", lessons: "2" };
const codeOf = (p: QfPost) => LANGUAGE_CODES[(p.languageName ?? "").toLowerCase()] ?? "";

/** One page (10 posts, QuranReflect's fixed size) of the feed for the ayah. tab "qdc" = reviewed by its moderators. */
function feed(env: Env, [s, a]: [number, number], lang: string, kind: Kind, page: number, tab: "popular" | "qdc" = "popular") {
  const q = new URLSearchParams({
    tab, languages: String(REFLECT_LANGUAGES[lang]), page: String(page), "filter[postTypeIds]": POST_TYPE[kind],
    "filter[references][0][chapterId]": String(s), "filter[references][0][from]": String(a), "filter[references][0][to]": String(a),
  });
  return qfGet<QfFeed>(env, `/quran-reflect/v1/posts/feed?${q}`);
}

function post(p: QfPost, kind: Kind, reviewed: Set<number>): ReflectionPost | null {
  if (!Number.isInteger(p.id) || p.reported || (p.toxicityScore ?? 0) > MAX_TOXICITY) return null;
  const body = plainText(String(p.body ?? ""));
  if (!body) return null;
  const a = p.author ?? {};
  const username = plainText(String(a.username ?? ""), 60);
  const photos = a.avatarUrls ?? {};
  return {
    id: p.id, body, author: username, likes: Math.max(0, Number(p.likesCount) || 0), lang: codeOf(p),
    date: String(p.publishedAt ?? p.createdAt ?? ""), url: `https://quranreflect.com/posts/${p.id}`,
    kind: kind === "lessons" ? "lesson" : "reflection", reviewed: reviewed.has(p.id),
    // fullName is the public name QuranReflect shows on the post; never first and last names on their own.
    by: {
      name: plainText(String(a.fullName ?? ""), 80) || username, username, verified: a.verified === true,
      avatar: avatarPath(photos.medium) ?? avatarPath(photos.small) ?? avatarPath(photos.large),
    },
  };
}

/** Verified authors first, then posts in the served language (QuranReflect also sends other languages when there are
 *  few), then the moderators' reviewed posts, then likes; otherwise QuranReflect's order. */
const ranked = (posts: ReflectionPost[], lang: string) => posts.map((p, i) => ({ p, i })).sort((x, y) =>
  +!!y.p.by?.verified - +!!x.p.by?.verified || +(y.p.lang === lang) - +(x.p.lang === lang) || +!!y.p.reviewed - +!!x.p.reviewed ||
  y.p.likes - x.p.likes || x.i - y.i).map((x) => x.p);

/** One page in one QuranReflect language. Reflections page 1 = popular pages 1–2 and the reviewed page 1 (up to three
 *  requests), so the few verified and reviewed posts can rise to the top; page n > 1 = popular page n + 1. Lessons:
 *  one request per page. `first` = popular page 1 when already fetched. */
async function build(env: Env, ayah: [number, number], lang: string, kind: Kind, page: number, first?: QfFeed): Promise<ReflectionsResponse> {
  const ref = `${ayah[0]}:${ayah[1]}`;
  const qfPage = kind === "reflections" && page > 1 ? page + 1 : page;
  const main = first ?? await feed(env, ayah, lang, kind, qfPage);
  const pages = Number(main.pages) || 0;
  let data = main.data ?? [];
  const reviewed = new Set<number>();
  if (kind === "reflections" && page === 1 && data.length) {
    // Extra pages only add to the ranking: if one fails, page 1 is still served.
    const [second, qdc] = await Promise.all([
      pages >= 2 ? feed(env, ayah, lang, kind, 2).catch(() => null) : null,
      feed(env, ayah, lang, kind, 1, "qdc").catch(() => null),
    ]);
    for (const p of qdc?.data ?? []) if (Number.isInteger(p.id)) reviewed.add(p.id);
    const seen = new Set<number>();
    data = [...data, ...(second?.data ?? []), ...(qdc?.data ?? [])].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  }
  const posts = ranked(data.map((p) => post(p, kind, reviewed)).filter((p): p is ReflectionPost => !!p), lang);
  return {
    ref, lang, kind, total: Number(main.total) || 0, page,
    pages: kind === "reflections" ? (pages > 2 ? pages - 1 : Math.min(pages, 1)) : pages, posts,
  };
}

/** The page in the person's language when QuranReflect has posts in it here, else the English one (shared cache). */
async function served(c: Context<{ Bindings: Env }>, ayah: [number, number], lang: string, kind: Kind, page: number): Promise<ReflectionsResponse> {
  const key = cacheUrl(c.req.url, `qf-reflections3-${c.env.QF_ENV || "production"}/${ayah[0]}:${ayah[1]}/${lang}/${kind}/${page}`);
  const body = await edgeJson<ReflectionsResponse>(key, DAY, async () => {
    if (lang === "en" || page > 1) return build(c.env, ayah, lang, kind, page);
    // QuranReflect puts posts in the asked-for language first: none at the top means none at all.
    const probe = await feed(c.env, ayah, lang, kind, 1);
    if ((probe.data ?? []).some((p) => codeOf(p) === lang)) return build(c.env, ayah, lang, kind, page, probe);
    return served(c, ayah, "en", kind, page);
  });
  return body!;
}

reflect.get("/reflections/:ref", rateLimit("SEARCH_LIMITER", 300), async (c) => {
  const ayah = parseAyah(c.req.param("ref"));
  if (!ayah) return c.json({ error: "invalid ref" }, 400);
  if (!qfConfigured(c.env)) return c.json({ error: "not available" }, 503);
  const page = Math.min(50, Math.max(1, Math.floor(Number(c.req.query("page")) || 1)));
  const kind: Kind = c.req.query("kind") === "lessons" ? "lessons" : "reflections";
  const requested = isoOf(c.req.query("lang"));
  try {
    const body = await served(c, ayah, requested in REFLECT_LANGUAGES ? requested : "en", kind, page);
    return c.json<ReflectionsResponse>({ ...body, fallback: body.lang !== requested }, 200, { "Cache-Control": "public, max-age=3600" });
  } catch (e) {
    return failed(c, e);
  }
});
