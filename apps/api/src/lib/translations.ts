// Quran Foundation translations, served in the Quran API's (alquran.cloud) shape so the app reads every translation the
// same way: GET /qapi/surah/:n/<lang>.qf-<id> (routes/proxy.ts). pipeline/translations.py lists the ones the app offers
// (apps/web/public/data/translations.json). The words are never changed: only footnote markers and tags are removed.
import { AYAH_COUNTS } from "../../../../contracts/voices";
import { QfError, qfGet } from "./qf";
import { decodeEntities } from "./sanitize";

/** An app edition id for a Quran Foundation translation: its language, then "qf-" and the translation's id. */
export const QF_EDITION = /^[a-z]{2,3}\.qf-(\d{1,6})$/;

/** One ayah's translation as plain text: footnote markers (<sup>) dropped, paragraphs joined by a space, other tags
 *  removed, entities decoded, runs of spaces collapsed. */
export function qfText(html: string): string {
  const s = html
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup\s*>/gi, "")
    .replace(/<(?:\/?p|br|\/?div)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

interface QfChapter { translations: { verse_key?: string; text?: string }[] }
export interface SurahText { code: 200; data: { number: number; ayahs: { numberInSurah: number; text: string }[] } }

/** A whole surah of translation `id`, every ayah in order. Throws QfError: 404 for an id without text, 502 when the
 *  answer does not have every ayah. */
export async function qfSurah(env: Env, id: number, surah: number): Promise<SurahText> {
  const d = await qfGet<QfChapter>(env, `/content/api/v4/quran/translations/${id}?chapter_number=${surah}&fields=verse_key`);
  const list = d.translations ?? [];
  if (!list.length) throw new QfError(404, `translation ${id} has no text`);
  const ayahs = list.map((t, i) => ({ numberInSurah: Number(t.verse_key?.split(":")[1]) || i + 1, text: qfText(t.text ?? "") }))
    .sort((a, b) => a.numberInSurah - b.numberInSurah);
  if (ayahs.length !== AYAH_COUNTS[surah - 1] || ayahs.some((a, i) => a.numberInSurah !== i + 1)) {
    throw new QfError(502, `translation ${id} surah ${surah}: ${ayahs.length} ayahs`);
  }
  return { code: 200, data: { number: surah, ayahs } };
}
