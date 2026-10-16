// Translation voices (owner, 8 Oct 2026): a recorded human voice reading an ayah's translation, played right after the
// ayah's recitation when a design turns it on (Recipe.voice). Human recordings only; one file per ayah. Each voice reads
// one translation edition word for word (checked by transcribing early, middle and late ayahs), and a design with the
// voice on shows that edition, so what is read on screen is what is heard. Shared by the Worker (it proxies the files
// and checks recipes) and the web app (it plays them).
//
// Files: a "media:" source is in our own media bucket and served at /media/<path>; any other source is fetched through
// the Worker at /audio/voice/<id>/<SSSAAA>.mp3 (edge-cached, only these sources). In a source, {SSS} and {AAA} are the
// surah and ayah numbers (three digits) and {N} is the ayah's number in the whole Quran (1..6236).

export interface Voice {
  /** Stored in Recipe.voice. */
  id: string;
  /** ISO 639-1 language of the reading. */
  lang: string;
  /** The reader (or the reading's name). Data only: the app does not show it (owner, 9 Oct 2026). */
  narrator: string;
  /** The translation edition the voice reads (an alquran.cloud edition id, or ml.lalithasaram from our media bucket). */
  text: string;
  source: string;
  /** Consecutive ayahs that share one sentence and one recording, by the first ayah of each pair ("3:3" = 3:3–4): the
   *  recording is played once, after the pair's second ayah when both are in the design. */
  joined?: string[];
}

export const VOICES: Voice[] = [
  { id: "en.walk", lang: "en", narrator: "Ibrahim Walk", text: "en.sahih", source: "https://cdn.islamic.network/quran/audio/192/en.walk/{N}.mp3" },
  { id: "ur.khan", lang: "ur", narrator: "Shamshad Ali Khan", text: "ur.jalandhry", source: "https://cdn.islamic.network/quran/audio/64/ur.khan/{N}.mp3" },
  {
    id: "ml.lalithasaram", lang: "ml", narrator: "Noushad Ibrahim", text: "ml.lalithasaram", source: "media:voice/ml.lalithasaram/{SSS}{AAA}.mp3",
    joined: ["3:3", "3:105", "11:54", "20:92", "23:55", "26:75", "26:92", "37:8", "37:22", "40:71", "40:73", "43:34", "44:43", "52:2",
      "53:50", "70:24", "70:40", "74:40", "74:50", "84:4", "96:9"],
  },
  { id: "fa.hedayatfarfooladvand", lang: "fa", narrator: "Hedayatfar", text: "fa.fooladvand", source: "https://cdn.islamic.network/quran/audio/40/fa.hedayatfarfooladvand/{N}.mp3" },
  { id: "fa.kabiri", lang: "fa", narrator: "Kabiri", text: "fa.makarem", source: "https://everyayah.com/data/translations/Makarem_Kabiri_16Kbps/{SSS}{AAA}.mp3" },
  { id: "ru.kuliev-audio", lang: "ru", narrator: "Kuliev (1MuslimApp)", text: "ru.kuliev", source: "https://cdn.islamic.network/quran/audio/128/ru.kuliev-audio/{N}.mp3" },
  { id: "tr.vakfi-audio", lang: "tr", narrator: "Diyanet Vakfı", text: "tr.vakfi", source: "https://cdn.islamic.network/quran/audio/128/tr.vakfi-audio/{N}.mp3" },
  { id: "zh.chinese", lang: "zh", narrator: "Ma Jian (read)", text: "zh.jian", source: "https://cdn.islamic.network/quran/audio/128/zh.chinese/{N}.mp3" },
  { id: "uz.sodik-audio", lang: "uz", narrator: "Muhammad Sodik Muhammad Yusuf", text: "uz.sodik", source: "https://cdn.islamic.network/quran/audio/128/uz.sodik-audio/{N}.mp3" },
  { id: "az.balayev", lang: "az", narrator: "Balayev", text: "az.musayev", source: "https://everyayah.com/data/translations/azerbaijani/balayev/{SSS}{AAA}.mp3" },
  { id: "bs.korkut-audio", lang: "bs", narrator: "Besim Korkut (read)", text: "bs.korkut", source: "https://everyayah.com/data/translations/besim_korkut_ajet_po_ajet/{SSS}{AAA}.mp3" },
];

/** Ayahs per surah (1..114), for {N}. */
export const AYAH_COUNTS = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60,
  34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11,
  18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5,
  8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];

export const voiceById = (id: unknown): Voice | null => VOICES.find((v) => v.id === id) ?? null;

/** True when surah:ayah exists. */
export const isAyah = (surah: number, ayah: number) =>
  Number.isInteger(surah) && Number.isInteger(ayah) && surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= AYAH_COUNTS[surah - 1];

/** The voice's file for surah:ayah: a URL, or "media:<path>" for our own bucket. */
export function voiceSource(v: Voice, surah: number, ayah: number) {
  const n = AYAH_COUNTS.slice(0, surah - 1).reduce((s, c) => s + c, 0) + ayah;
  return v.source.replace("{SSS}", String(surah).padStart(3, "0")).replace("{AAA}", String(ayah).padStart(3, "0")).replace("{N}", String(n));
}

/** The pair of joined ayahs that `surah:ayah` starts, for this voice. */
export const startsJoined = (v: Voice, surah: number, ayah: number) => !!v.joined?.includes(`${surah}:${ayah}`);
