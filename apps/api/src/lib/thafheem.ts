// Thafheemul Quran (Malayalam; Sayyid Abul A'la Maududi, thafheem.net / D4DX, used with permission): text only, from our
// own storage, never the Quran Foundation. tafsir/ml.thafheem/v2/<surah>.json holds, per surah, {surah, name,
// arabicName, intro, ayahs: [{numberInSurah, summary}], notes: [{n, text, from, to, ayah}]}: Thafheem's numbered notes
// each belong to a block of ayahs (from–to) and, for 85% of them, to the one ayah they explain (ayah; null when it could
// not be placed); some ayahs also have a short summary. Plain text with \n and \t (no HTML).
import type { TafsirInfo, TafsirResponse } from "../../../../contracts/types";
import { QfError } from "./qf";
import { formatTafsir } from "./tafsir";

export const THAFHEEM_ID = "ml.thafheem";
export const THAFHEEM: TafsirInfo = { id: THAFHEEM_ID, name: "തഫ്ഹീമുല്‍ ഖുര്‍ആന്‍", author: "Sayyid Abul A'la Maududi", lang: "ml" };

interface Note { n: number; text: string; from: number; to: number; /** the one ayah it explains, or null */ ayah?: number | null }
interface SurahFile {
  ayahs?: { numberInSurah: number; summary?: string }[];
  notes?: Note[];
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Thafheem's text carries glossary references glued to names ("ഖസ്‌റജ്N327", "ഉമര്‍(റ)N1512"): links to its people/places index that
 *  we don't have, so they are dropped. */
const unref = (s: string) => s.replace(/(?<=[^\s\x00-\x7F]|\))N\d+/g, "");

/** The text for one ayah (owner: ayah by ayah, not the whole block). Reflect's own header already names the ayah.
 *  - its summary when it has one, then the notes pinned to this ayah;
 *  - then the block's notes that are pinned to no ayah, under "other notes of this passage (2:8–20)";
 *  - an ayah with none of these, in a block whose notes all explain other ayahs, gets one line saying so and that
 *    block's notes, each marked with the ayah it explains.
 *  Each note starts with its number in bold ("11.", not in square brackets: the layout would take that for a footnote).
 *  The surah file is parsed once, by the caller. */
export function thafheemText(file: SurahFile, [surah, ayah]: [number, number]): Pick<TafsirResponse, "from" | "to" | "html"> {
  const block = (file.notes ?? []).filter((n) => n.from <= ayah && ayah <= n.to);
  const pinned = block.filter((n) => n.ayah === ayah);
  const loose = block.filter((n) => n.ayah == null);
  const summary = unref((file.ayahs ?? []).find((a) => a.numberInSurah === ayah)?.summary?.trim() ?? "");
  const lo = Math.min(...block.map((n) => n.from)), hi = Math.max(...block.map((n) => n.to));
  const range = `${surah}:${lo === hi ? lo : `${lo}–${hi}`}`;
  const note = (n: Note, mark = false) =>
    `<p><strong>${Math.trunc(n.n)}.</strong> ${mark && n.ayah ? `(${surah}:${n.ayah}) ` : ""}${escape(unref(String(n.text ?? "")))}</p>`;
  const parts: string[] = [];
  if (summary) parts.push(`<p>${escape(summary)}</p>`);
  parts.push(...pinned.map((n) => note(n)));
  if (loose.length) parts.push(`<h4>ഈ ഭാഗത്തെ മറ്റു കുറിപ്പുകൾ (${range})</h4>`, ...loose.map((n) => note(n)));
  if (!parts.length && block.length) {
    parts.push(`<p><em>ഈ ആയത്തിന് പ്രത്യേക കുറിപ്പില്ല; ${range} ഭാഗത്തിന്റെ കുറിപ്പുകൾ:</em></p>`, ...block.map((n) => note(n, true)));
  }
  // Plain text becomes paragraphs at its line breaks (formatTafsir); the text is escaped first, so it is never HTML.
  return { from: `${surah}:${ayah}`, to: `${surah}:${ayah}`, html: formatTafsir(parts.join(""), THAFHEEM.lang) };
}

/** The surah's file from storage, parsed once; the text for the ayah. */
export async function thafheem(media: R2Bucket, ayah: [number, number]) {
  const object = await media.get(`tafsir/${THAFHEEM_ID}/v2/${ayah[0]}.json`);
  if (!object) throw new QfError(404, "no tafsir");
  return thafheemText(await object.json<SurahFile>(), ayah);
}
