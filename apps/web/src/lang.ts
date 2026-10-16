// "My language": the person's language, picked on first open (skippable) and changeable on Find, in the feed and in
// Account. It sets the translation new designs and feed reels use, the language of the topic and mood chips, the tafsir
// language (English when there is none) and the reflections language, and it is ready to drive the UI language later.
// Kept on the device; the account keeps a copy when signed in (actions.ts). Framework-free.

export interface Language {
  code: string;      // ISO 639-1 (or -2 when there is no 639-1 code)
  native: string;    // the language's own name
  english: string;
  /** Default translation (alquran.cloud edition id), or "none" when the Arabic is the person's language. */
  translation: string;
}

/** Languages with a Quran translation (public/data/translations.json), the most used first, then the rest by English
 *  name. The default translation of a language added with that list (8 Oct 2026) is its first listed one. */
export const LANGUAGES: Language[] = [
  { code: "en", native: "English", english: "English", translation: "en.sahih" },
  { code: "ar", native: "العربية", english: "Arabic", translation: "none" },
  { code: "ur", native: "اردو", english: "Urdu", translation: "ur.jalandhry" },
  { code: "id", native: "Bahasa Indonesia", english: "Indonesian", translation: "id.indonesian" },
  { code: "bn", native: "বাংলা", english: "Bengali", translation: "bn.bengali" },
  { code: "tr", native: "Türkçe", english: "Turkish", translation: "tr.diyanet" },
  { code: "ml", native: "മലയാളം", english: "Malayalam", translation: "ml.abdulhameed" },
  { code: "hi", native: "हिन्दी", english: "Hindi", translation: "hi.hindi" },
  { code: "fr", native: "Français", english: "French", translation: "fr.hamidullah" },
  { code: "ms", native: "Bahasa Melayu", english: "Malay", translation: "ms.basmeih" },
  { code: "fa", native: "فارسی", english: "Persian", translation: "fa.makarem" },
  { code: "ru", native: "Русский", english: "Russian", translation: "ru.kuliev" },
  { code: "es", native: "Español", english: "Spanish", translation: "es.cortes" },
  { code: "de", native: "Deutsch", english: "German", translation: "de.aburida" },
  { code: "sw", native: "Kiswahili", english: "Swahili", translation: "sw.barwani" },
  { code: "ta", native: "தமிழ்", english: "Tamil", translation: "ta.tamil" },
  { code: "so", native: "Soomaali", english: "Somali", translation: "so.abduh" },
  { code: "ha", native: "Hausa", english: "Hausa", translation: "ha.gumi" },
  { code: "ps", native: "پښتو", english: "Pashto", translation: "ps.abdulwali" },
  { code: "ku", native: "Kurdî", english: "Kurdish", translation: "ku.asan" },
  { code: "az", native: "Azərbaycanca", english: "Azerbaijani", translation: "az.mammadaliyev" },
  { code: "uz", native: "Oʻzbekcha", english: "Uzbek", translation: "uz.sodik" },
  { code: "bs", native: "Bosanski", english: "Bosnian", translation: "bs.korkut" },
  { code: "sq", native: "Shqip", english: "Albanian", translation: "sq.ahmeti" },
  { code: "pt", native: "Português", english: "Portuguese", translation: "pt.elhayek" },
  { code: "it", native: "Italiano", english: "Italian", translation: "it.piccardo" },
  { code: "nl", native: "Nederlands", english: "Dutch", translation: "nl.siregar" },
  { code: "sv", native: "Svenska", english: "Swedish", translation: "sv.bernstrom" },
  { code: "zh", native: "中文", english: "Chinese", translation: "zh.jian" },
  { code: "ja", native: "日本語", english: "Japanese", translation: "ja.japanese" },
  { code: "ko", native: "한국어", english: "Korean", translation: "ko.korean" },
  { code: "th", native: "ไทย", english: "Thai", translation: "th.thai" },
  { code: "am", native: "አማርኛ", english: "Amharic", translation: "am.sadiq" },
  { code: "aa", native: "Qafaraf", english: "Afar", translation: "aa.qf-854" },
  { code: "ak", native: "Asante Twi", english: "Akan (Asante)", translation: "ak.qf-801" },
  { code: "ber", native: "Tamaziɣt", english: "Amazigh", translation: "ber.mensur" },
  { code: "as", native: "অসমীয়া", english: "Assamese", translation: "as.qf-120" },
  { code: "bm", native: "Bamanankan", english: "Bambara", translation: "bm.qf-795" },
  { code: "bg", native: "Български", english: "Bulgarian", translation: "bg.theophanov" },
  { code: "my", native: "မြန်မာ", english: "Burmese", translation: "my.ghazi" },
  { code: "ceb", native: "Binisaya", english: "Cebuano (Bisaya)", translation: "ceb.qf-998" },
  { code: "ce", native: "Нохчийн", english: "Chechen", translation: "ce.magomedov" },
  { code: "hr", native: "Hrvatski", english: "Croatian", translation: "hr.qf-997" },
  { code: "cs", native: "Čeština", english: "Czech", translation: "cs.hrbek" },
  { code: "prs", native: "دری", english: "Dari", translation: "prs.qf-785" },
  { code: "dv", native: "ދިވެހި", english: "Divehi", translation: "dv.divehi" },
  { code: "fi", native: "Suomi", english: "Finnish", translation: "fi.qf-30" },
  { code: "ff", native: "Fulfulde", english: "Fulah", translation: "ff.qf-800" },
  { code: "lg", native: "Luganda", english: "Ganda", translation: "lg.qf-232" },
  { code: "gu", native: "ગુજરાતી", english: "Gujarati", translation: "gu.qf-225" },
  { code: "he", native: "עברית", english: "Hebrew", translation: "he.qf-233" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada", translation: "kn.qf-771" },
  { code: "kk", native: "Қазақ тілі", english: "Kazakh", translation: "kk.qf-113" },
  { code: "km", native: "ខ្មែរ", english: "Khmer", translation: "km.qf-128" },
  { code: "rw", native: "Ikinyarwanda", english: "Kinyarwanda", translation: "rw.qf-774" },
  { code: "rn", native: "Ikirundi", english: "Kirundi", translation: "rn.qf-921" },
  { code: "ky", native: "Кыргызча", english: "Kyrgyz", translation: "ky.qf-858" },
  { code: "ln", native: "Lingála", english: "Lingala", translation: "ln.qf-855" },
  { code: "lt", native: "Lietuvių", english: "Lithuanian", translation: "lt.qf-904" },
  { code: "mk", native: "Македонски", english: "Macedonian", translation: "mk.qf-788" },
  { code: "mrw", native: "Mëranaw", english: "Maranao", translation: "mrw.qf-38" },
  { code: "mr", native: "मराठी", english: "Marathi", translation: "mr.qf-226" },
  { code: "mos", native: "Mooré", english: "Mossi", translation: "mos.qf-923" },
  { code: "ne", native: "नेपाली", english: "Nepali", translation: "ne.qf-108" },
  { code: "no", native: "Norsk", english: "Norwegian", translation: "no.berg" },
  { code: "om", native: "Afaan Oromoo", english: "Oromo", translation: "om.qf-111" },
  { code: "pl", native: "Polski", english: "Polish", translation: "pl.bielawskiego" },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi", translation: "pa.qf-857" },
  { code: "ro", native: "Română", english: "Romanian", translation: "ro.grigore" },
  { code: "sr", native: "Српски", english: "Serbian", translation: "sr.qf-215" },
  { code: "sd", native: "سنڌي", english: "Sindhi", translation: "sd.amroti" },
  { code: "si", native: "සිංහල", english: "Sinhala", translation: "si.naseemismail" },
  { code: "tl", native: "Tagalog", english: "Tagalog", translation: "tl.qf-211" },
  { code: "tg", native: "Тоҷикӣ", english: "Tajik", translation: "tg.ayati" },
  { code: "tt", native: "Татарча", english: "Tatar", translation: "tt.nugman" },
  { code: "te", native: "తెలుగు", english: "Telugu", translation: "te.qf-227" },
  { code: "uk", native: "Українська", english: "Ukrainian", translation: "uk.qf-217" },
  { code: "ug", native: "ئۇيغۇرچە", english: "Uyghur", translation: "ug.saleh" },
  { code: "vi", native: "Tiếng Việt", english: "Vietnamese", translation: "vi.qf-220" },
  { code: "yao", native: "Chiyao", english: "Yao", translation: "yao.qf-798" },
  { code: "yo", native: "Yorùbá", english: "Yoruba", translation: "yo.qf-125" },
];

export const DEFAULT_LANG = "en";
const KEY = "qd.lang";

export const languageOf = (code: string): Language => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
export const isLanguage = (code: unknown): code is string => typeof code === "string" && LANGUAGES.some((l) => l.code === code);
/** The translation a new design or reel uses for this language. */
export const translationFor = (code: string) => languageOf(code).translation;

/** The language saved on this device, or null when the person has not picked one yet (the first-open question). */
export function storedLang(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return isLanguage(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeLang(code: string) {
  try { localStorage.setItem(KEY, code); } catch { /* private mode: kept for this visit only */ }
}

/** The device's preferred language when we have it (the first-open picker suggests it), else English. */
export function guessLang(prefs: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]): string {
  for (const p of prefs) {
    const code = p?.toLowerCase().split("-")[0];
    if (isLanguage(code)) return code;
  }
  return DEFAULT_LANG;
}
