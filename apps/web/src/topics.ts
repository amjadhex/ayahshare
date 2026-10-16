// Topic chips on Find: a curated pool of feelings, situations and themes. Each visit shows a handful, weighted by the
// moment (time of day, Friday, the Islamic calendar) plus random rotation, in the language of the selected translation
// where we have it. A chip runs a normal search (its English query, so popular searches stay cached) or opens a
// reference directly. Framework-free.
import { SAY, SAY_ORDER } from "./topicPrompts";

export type Lang = "ml" | "ar" | "ur" | "hi" | "id";
/** Moments a chip is especially relevant for. */
export type Moment =
  | "morning" | "evening" | "night" | "friday" | "thursdayNight"
  | "ramadan" | "lastTenNights" | "eidFitr" | "hajjDays" | "arafah" | "eidAdha" | "muharram" | "newYear";

export interface TopicDef {
  id: string;
  en: string;
  /** Search query (English); defaults to `en`. */
  q?: string;
  /** The passage Discover's stories play for this chip. */
  ref?: string;
  /** A surah chip: Home shows this whole surah, page by page. */
  surah?: number;
  l: Record<Lang, string>;
  /** Weight multipliers for moments (a chip with a weight ≥ PIN at this moment is always shown). */
  at?: Partial<Record<Moment, number>>;
}

/** `label` names the topic (Discover, the suggestions while typing); `say` is what Home's chip says, a sentence in the
 *  person's voice (topicPrompts.ts), in the same language as the label. */
export interface Chip { id: string; label: string; say: string; q: string; ref?: string; surah?: number; lang: string }

export const PIN = 6;

export const TOPICS: TopicDef[] = [
  { id: "hope", en: "Hope after hardship", q: "hope after hardship", l: { ml: "പ്രയാസത്തിനു ശേഷം ആശ്വാസം", ar: "الأمل بعد العسر", ur: "مشکل کے بعد آسانی", hi: "मुश्किल के बाद आसानी", id: "Harapan setelah kesulitan" } },
  { id: "anxious", en: "Feeling anxious", q: "anxiety", l: { ml: "ഉത്കണ്ഠ", ar: "القلق", ur: "پریشانی", hi: "बेचैनी", id: "Merasa cemas" }, at: { night: 1.5 } },
  { id: "gratitude", en: "Gratitude", q: "gratitude", l: { ml: "നന്ദി", ar: "الشكر", ur: "شکر گزاری", hi: "शुक्र", id: "Bersyukur" }, at: { morning: 1.5, eidFitr: 3, eidAdha: 2 } },
  { id: "forgiveness", en: "Forgiveness", q: "forgiveness", l: { ml: "പാപമോചനം", ar: "المغفرة", ur: "مغفرت", hi: "माफ़ी", id: "Ampunan" }, at: { ramadan: 2, arafah: 3, night: 1.3 } },
  { id: "grief", en: "Grief and loss", q: "grief and loss of a loved one", l: { ml: "ദുഃഖവും നഷ്ടവും", ar: "الحزن والفقد", ur: "غم اور جدائی", hi: "ग़म और बिछड़ना", id: "Duka dan kehilangan" } },
  { id: "illness", en: "Illness and patience", q: "sickness and patience", l: { ml: "രോഗവും ക്ഷമയും", ar: "المرض والصبر", ur: "بیماری اور صبر", hi: "बीमारी और सब्र", id: "Sakit dan sabar" } },
  { id: "exams", en: "Exam stress", q: "exam stress, seeking help and success", l: { ml: "പരീക്ഷാ സമ്മർദ്ദം", ar: "قلق الامتحانات", ur: "امتحان کی فکر", hi: "इम्तिहान की फ़िक्र", id: "Stres ujian" } },
  { id: "baby", en: "New baby", q: "birth of a child", l: { ml: "പുതിയ കുഞ്ഞ്", ar: "مولود جديد", ur: "نومولود", hi: "नवजात बच्चा", id: "Bayi baru lahir" } },
  { id: "marriage", en: "Marriage", q: "marriage and love between spouses", l: { ml: "വിവാഹം", ar: "الزواج", ur: "نکاح", hi: "निकाह", id: "Pernikahan" } },
  { id: "travel", en: "Travel", q: "travel", l: { ml: "യാത്ര", ar: "السفر", ur: "سفر", hi: "सफ़र", id: "Perjalanan" } },
  { id: "provision", en: "Provision", q: "provision", l: { ml: "ഉപജീവനം", ar: "الرزق", ur: "رزق", hi: "रिज़्क़", id: "Rezeki" }, at: { morning: 1.3 } },
  { id: "parents", en: "Parents", q: "parents", l: { ml: "മാതാപിതാക്കൾ", ar: "الوالدان", ur: "والدین", hi: "माता-पिता", id: "Orang tua" } },
  { id: "mercy", en: "Mercy", q: "mercy", l: { ml: "കാരുണ്യം", ar: "الرحمة", ur: "رحمت", hi: "रहमत", id: "Rahmat" } },
  { id: "trust", en: "Trust in Allah", q: "trust in Allah", l: { ml: "അല്ലാഹുവിൽ ഭരമേൽപ്പിക്കൽ", ar: "التوكل على الله", ur: "اللہ پر بھروسہ", hi: "अल्लाह पर भरोसा", id: "Tawakal kepada Allah" } },
  { id: "lonely", en: "Loneliness", q: "loneliness", l: { ml: "ഏകാന്തത", ar: "الوحدة", ur: "تنہائی", hi: "अकेलापन", id: "Kesepian" }, at: { night: 1.5 } },
  { id: "guidance", en: "Guidance", q: "guidance", l: { ml: "സന്മാർഗം", ar: "الهداية", ur: "ہدایت", hi: "हिदायत", id: "Petunjuk" } },
  { id: "morning", en: "Morning remembrance", q: "morning remembrance", l: { ml: "പ്രഭാത ദിക്ർ", ar: "أذكار الصباح", ur: "صبح کے اذکار", hi: "सुबह का ज़िक्र", id: "Zikir pagi" }, at: { morning: 8 } },
  { id: "evening", en: "Evening remembrance", q: "evening remembrance", l: { ml: "സായാഹ്ന ദിക്ർ", ar: "أذكار المساء", ur: "شام کے اذکار", hi: "शाम का ज़िक्र", id: "Zikir petang" }, at: { evening: 8 } },
  { id: "sleep", en: "Before sleep", q: "before sleep", l: { ml: "ഉറങ്ങുന്നതിന് മുമ്പ്", ar: "قبل النوم", ur: "سونے سے پہلے", hi: "सोने से पहले", id: "Sebelum tidur" }, at: { night: 8 } },
  { id: "patience", en: "Patience", q: "patience", l: { ml: "ക്ഷമ", ar: "الصبر", ur: "صبر", hi: "सब्र", id: "Sabar" } },
  { id: "peace", en: "Peace of heart", q: "peace of heart", l: { ml: "മനസ്സമാധാനം", ar: "طمأنينة القلب", ur: "دل کا سکون", hi: "दिल का सुकून", id: "Ketenangan hati" }, at: { night: 1.3 } },
  { id: "repentance", en: "Repentance", q: "repentance", l: { ml: "പശ്ചാത്താപം", ar: "التوبة", ur: "توبہ", hi: "तौबा", id: "Taubat" }, at: { ramadan: 2 } },
  { id: "despair", en: "Never lose hope", q: "do not despair of Allah's mercy", l: { ml: "നിരാശരാകരുത്", ar: "لا تقنطوا من رحمة الله", ur: "مایوس نہ ہوں", hi: "मायूस न हों", id: "Jangan berputus asa" } },
  { id: "strength", en: "Strength", q: "strength and courage", l: { ml: "ശക്തിയും ധൈര്യവും", ar: "القوة والشجاعة", ur: "ہمت اور حوصلہ", hi: "हिम्मत और हौसला", id: "Kekuatan dan keberanian" } },
  { id: "fear", en: "Fear", q: "fear", l: { ml: "ഭയം", ar: "الخوف", ur: "خوف", hi: "डर", id: "Rasa takut" } },
  { id: "decisions", en: "Making decisions", q: "making decisions", l: { ml: "തീരുമാനമെടുക്കൽ", ar: "اتخاذ القرار", ur: "فیصلہ کرنا", hi: "फ़ैसला लेना", id: "Mengambil keputusan" } },
  { id: "dua", en: "Du'a", q: "dua", l: { ml: "ദുആ", ar: "الدعاء", ur: "دعا", hi: "दुआ", id: "Doa" }, at: { ramadan: 2, arafah: 4, lastTenNights: 2 } },
  { id: "contentment", en: "Contentment", q: "contentment", l: { ml: "സംതൃപ്തി", ar: "القناعة", ur: "قناعت", hi: "संतोष", id: "Rasa cukup" } },
  { id: "kindness", en: "Kindness", q: "kindness", l: { ml: "ദയ", ar: "الإحسان", ur: "حسن سلوک", hi: "नेकी और भलाई", id: "Kebaikan" } },
  { id: "family", en: "Family ties", q: "family ties", l: { ml: "കുടുംബബന്ധം", ar: "صلة الرحم", ur: "صلہ رحمی", hi: "रिश्तेदारी", id: "Silaturahmi" }, at: { eidFitr: 2, eidAdha: 2 } },
  { id: "children", en: "Children", q: "children", l: { ml: "മക്കൾ", ar: "الأبناء", ur: "اولاد", hi: "औलाद", id: "Anak-anak" } },
  { id: "friends", en: "Friendship", q: "friends", l: { ml: "സൗഹൃദം", ar: "الصداقة", ur: "دوستی", hi: "दोस्ती", id: "Persahabatan" } },
  { id: "charity", en: "Charity", q: "charity", l: { ml: "ദാനധർമ്മം", ar: "الصدقة", ur: "صدقہ", hi: "सदक़ा", id: "Sedekah" }, at: { ramadan: 2 } },
  { id: "honesty", en: "Honesty", q: "honesty", l: { ml: "സത്യസന്ധത", ar: "الصدق", ur: "سچائی", hi: "सच्चाई", id: "Kejujuran" } },
  { id: "justice", en: "Justice", q: "justice", l: { ml: "നീതി", ar: "العدل", ur: "انصاف", hi: "इंसाफ़", id: "Keadilan" } },
  { id: "humility", en: "Humility", q: "humility", l: { ml: "വിനയം", ar: "التواضع", ur: "عاجزی", hi: "विनम्रता", id: "Rendah hati" } },
  { id: "anger", en: "Controlling anger", q: "controlling anger", l: { ml: "കോപം അടക്കൽ", ar: "كظم الغيظ", ur: "غصے پر قابو", hi: "ग़ुस्से पर क़ाबू", id: "Menahan amarah" } },
  { id: "paradise", en: "Paradise", q: "paradise", l: { ml: "സ്വർഗം", ar: "الجنة", ur: "جنت", hi: "जन्नत", id: "Surga" } },
  { id: "short", en: "Life is short", q: "life is short", l: { ml: "ജീവിതം ക്ഷണികമാണ്", ar: "الحياة قصيرة", ur: "زندگی مختصر ہے", hi: "ज़िंदगी छोटी है", id: "Hidup itu singkat" } },
  { id: "nature", en: "Signs in nature", q: "signs in nature", l: { ml: "പ്രകൃതിയിലെ ദൃഷ്ടാന്തങ്ങൾ", ar: "آيات الله في الكون", ur: "کائنات میں نشانیاں", hi: "क़ुदरत की निशानियाँ", id: "Tanda-tanda di alam" } },
  { id: "rain", en: "Rain", q: "rain", l: { ml: "മഴ", ar: "المطر", ur: "بارش", hi: "बारिश", id: "Hujan" } },
  { id: "near", en: "Allah is near", q: "Allah is near", l: { ml: "അല്ലാഹു അടുത്തുണ്ട്", ar: "الله قريب", ur: "اللہ قریب ہے", hi: "अल्लाह क़रीब है", id: "Allah itu dekat" }, at: { night: 1.5 } },
  { id: "love", en: "Love of Allah", q: "love of Allah", l: { ml: "അല്ലാഹുവിന്റെ സ്നേഹം", ar: "محبة الله", ur: "اللہ کی محبت", hi: "अल्लाह की मोहब्बत", id: "Cinta Allah" } },
  { id: "prayer", en: "Prayer", q: "prayer", l: { ml: "നമസ്കാരം", ar: "الصلاة", ur: "نماز", hi: "नमाज़", id: "Salat" } },
  { id: "tahajjud", en: "Night prayer", q: "night prayer", l: { ml: "രാത്രി നമസ്കാരം", ar: "قيام الليل", ur: "تہجد", hi: "तहज्जुद", id: "Salat malam" }, at: { night: 3, lastTenNights: 3 } },
  { id: "quran", en: "Reciting the Quran", q: "reciting the Quran", l: { ml: "ഖുർആൻ പാരായണം", ar: "تلاوة القرآن", ur: "تلاوتِ قرآن", hi: "क़ुरआन की तिलावत", id: "Membaca Al-Qur'an" }, at: { ramadan: 3 } },
  { id: "knowledge", en: "Knowledge", q: "knowledge", l: { ml: "അറിവ്", ar: "العلم", ur: "علم", hi: "इल्म", id: "Ilmu" } },
  { id: "trials", en: "Trials", q: "trials and tests", l: { ml: "പരീക്ഷണങ്ങൾ", ar: "الابتلاء", ur: "آزمائش", hi: "आज़माइश", id: "Ujian hidup" } },
  { id: "debt", en: "Debt", q: "debt", l: { ml: "കടം", ar: "الدَّين", ur: "قرض", hi: "क़र्ज़", id: "Utang" } },
  { id: "work", en: "Work and earning", q: "earning a living", l: { ml: "ജോലിയും സമ്പാദ്യവും", ar: "طلب الرزق الحلال", ur: "حلال روزی", hi: "हलाल रोज़ी", id: "Bekerja dan mencari nafkah" }, at: { morning: 1.5 } },
  { id: "success", en: "Success", q: "success", l: { ml: "വിജയം", ar: "الفلاح", ur: "کامیابی", hi: "कामयाबी", id: "Kesuksesan" } },
  { id: "fresh", en: "Second chances", q: "second chance", l: { ml: "പുതിയ തുടക്കം", ar: "بداية جديدة", ur: "نئی شروعات", hi: "नई शुरुआत", id: "Kesempatan kedua" } },
  { id: "protection", en: "Protection", q: "protection from evil", l: { ml: "സംരക്ഷണം", ar: "الحفظ من الشر", ur: "حفاظت", hi: "हिफ़ाज़त", id: "Perlindungan" }, at: { night: 1.5, evening: 1.5 } },
  { id: "youth", en: "Youth", q: "youth", l: { ml: "യുവത്വം", ar: "الشباب", ur: "جوانی", hi: "जवानी", id: "Masa muda" } },
  { id: "oldage", en: "Old age", q: "old age", l: { ml: "വാർദ്ധക്യം", ar: "الكِبَر", ur: "بڑھاپا", hi: "बुढ़ापा", id: "Usia senja" } },
  { id: "home", en: "Home", q: "home", l: { ml: "വീട്", ar: "البيت", ur: "گھر", hi: "घर", id: "Rumah" } },
  { id: "joy", en: "Joy", q: "joy", l: { ml: "സന്തോഷം", ar: "الفرح", ur: "خوشی", hi: "ख़ुशी", id: "Kebahagiaan" }, at: { eidFitr: 4, eidAdha: 3 } },
  { id: "kahf", en: "Friday: Surah Al-Kahf", q: "Surah Al-Kahf", ref: "18:1-10", surah: 18, l: { ml: "വെള്ളിയാഴ്ച: സൂറത്തുൽ കഹ്ഫ്", ar: "الجمعة: سورة الكهف", ur: "جمعہ: سورۃ الکہف", hi: "जुमा: सूरह अल-कहफ़", id: "Jumat: Surah Al-Kahfi" }, at: { friday: 12, thursdayNight: 7 } },
  { id: "jumuah", en: "Jumu'ah", q: "Friday prayer", l: { ml: "ജുമുഅ", ar: "صلاة الجمعة", ur: "نمازِ جمعہ", hi: "जुमा की नमाज़", id: "Salat Jumat" }, at: { friday: 7 } },
  { id: "ramadan", en: "Ramadan", q: "Ramadan", l: { ml: "റമദാൻ", ar: "رمضان", ur: "رمضان", hi: "रमज़ान", id: "Ramadan" }, at: { ramadan: 12 } },
  { id: "fasting", en: "Fasting", q: "fasting", l: { ml: "നോമ്പ്", ar: "الصيام", ur: "روزہ", hi: "रोज़ा", id: "Puasa" }, at: { ramadan: 8 } },
  { id: "qadr", en: "Laylat al-Qadr", q: "night of power", l: { ml: "ലൈലത്തുൽ ഖദ്ർ", ar: "ليلة القدر", ur: "شبِ قدر", hi: "शब-ए-क़द्र", id: "Lailatul Qadar" }, at: { ramadan: 2, lastTenNights: 10 } },
  { id: "hajj", en: "Hajj", q: "hajj", l: { ml: "ഹജ്ജ്", ar: "الحج", ur: "حج", hi: "हज", id: "Haji" }, at: { hajjDays: 10, eidAdha: 3 } },
  { id: "arafah", en: "Day of Arafah", q: "hajj and the day of Arafah", l: { ml: "അറഫാ ദിനം", ar: "يوم عرفة", ur: "یومِ عرفہ", hi: "अरफ़ा का दिन", id: "Hari Arafah" }, at: { hajjDays: 3, arafah: 12 } },
  { id: "eid", en: "Eid", q: "joy and gratitude", l: { ml: "പെരുന്നാൾ", ar: "العيد", ur: "عید", hi: "ईद", id: "Hari Raya" }, at: { eidFitr: 12, eidAdha: 12 } },
  { id: "sacrifice", en: "Sacrifice", q: "sacrifice", l: { ml: "ബലി", ar: "الأضحية", ur: "قربانی", hi: "क़ुर्बानी", id: "Kurban" }, at: { eidAdha: 9, hajjDays: 2 } },
  { id: "muharram", en: "Sacred months", q: "sacred months", l: { ml: "മുഹർറം", ar: "الأشهر الحرم", ur: "محرم", hi: "मुहर्रम", id: "Bulan-bulan haram" }, at: { muharram: 8 } },
  { id: "hijra", en: "New Hijri year", q: "migration for the sake of Allah", l: { ml: "ഹിജ്റ പുതുവർഷം", ar: "العام الهجري الجديد", ur: "نیا ہجری سال", hi: "नया हिजरी साल", id: "Tahun baru Hijriah" }, at: { newYear: 10 } },
];

const LANGS = new Set<string>(["ml", "ar", "ur", "hi", "id"]);
/** Languages the chips are written in besides English. */
export const chipLanguages = () => [...LANGS];

/** Day and month in the Islamic (Umm al-Qura) calendar, or null when this browser has no Islamic calendar. */
export function hijriDate(now: Date): { month: number; day: number } | null {
  for (const calendar of ["islamic-umalqura", "islamic", "islamic-civil"]) {
    try {
      const f = new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`, { month: "numeric", day: "numeric" });
      if (!f.resolvedOptions().calendar.startsWith("islamic")) continue;
      const parts = f.formatToParts(now);
      const month = +(parts.find((p) => p.type === "month")?.value ?? NaN), day = +(parts.find((p) => p.type === "day")?.value ?? NaN);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 30) return { month, day };
    } catch { /* try the next calendar */ }
  }
  return null;
}

/** The moments that apply at `now` (local time). */
export function momentsAt(now: Date): Set<Moment> {
  const m = new Set<Moment>(), h = now.getHours(), dow = now.getDay();
  if (h >= 4 && h < 11) m.add("morning");
  else if (h >= 16 && h < 20) m.add("evening");
  else if (h >= 21 || h < 4) m.add("night");
  if (dow === 5) m.add("friday");
  if (dow === 4 && h >= 18) m.add("thursdayNight"); // the Islamic day of Friday starts at sunset
  const hijri = hijriDate(now);
  if (hijri) {
    const { month, day } = hijri;
    if (month === 9) { m.add("ramadan"); if (day >= 20) m.add("lastTenNights"); }
    if (month === 10 && day <= 3) m.add("eidFitr");
    if (month === 12 && day <= 9) m.add("hajjDays");
    if (month === 12 && day >= 8 && day <= 9) m.add("arafah");
    if (month === 12 && day >= 10 && day <= 13) m.add("eidAdha");
    if (month === 1) { m.add("muharram"); if (day <= 10) m.add("newYear"); }
  }
  return m;
}

export function weightOf(topic: TopicDef, moments: Set<Moment>) {
  let w = 1;
  for (const [moment, k] of Object.entries(topic.at ?? {}) as [Moment, number][]) if (moments.has(moment)) w = Math.max(w, k);
  // A moment-only chip (Friday, Ramadan, Eid, before sleep…) shows only in its moment (owner, 8 Oct 2026: Eid at Eid).
  const special = Object.values(topic.at ?? {}).some((k) => k >= PIN);
  return w > 1 ? w : special ? 0 : 1;
}

export function chipOf(topic: TopicDef, lang: string): Chip {
  const local = LANGS.has(lang) ? topic.l[lang as Lang] : undefined;
  const label = local ?? topic.en, say = SAY[topic.id]?.[SAY_ORDER.indexOf(local ? (lang as Lang) : "en")] ?? label;
  return { id: topic.id, label, say, q: topic.q ?? topic.en, ref: topic.ref, surah: topic.surah, lang: local ? lang : "en" };
}

/** The topic this moment is about (Friday's Al-Kahf, the evening's remembrance, Ramadan…): the one weighted most for it,
 *  when that weight pins it (≥ PIN); null at an ordinary time. Notifications shows it. */
export function momentChip(now: Date, lang: string): Chip | null {
  const moments = momentsAt(now);
  const best = TOPICS.map((tp) => ({ tp, w: weightOf(tp, moments) })).filter((x) => x.w >= PIN).sort((a, b) => b.w - a.w)[0];
  return best ? chipOf(best.tp, lang) : null;
}

/** Weighted random pick without replacement (each topic's key is random^(1/weight)). */
function sample(topics: TopicDef[], moments: Set<Moment>, n: number, random: () => number) {
  return topics
    .filter((tp) => weightOf(tp, moments) > 0)
    .map((tp) => ({ tp, key: Math.pow(random() || 1e-9, 1 / weightOf(tp, moments)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, n)
    .map((x) => x.tp);
}

/** The chips for a visit: the moment's own chips first (weight ≥ PIN, at most 3), then a weighted random mix. */
export function pickChips(now: Date, lang: string, n = 8, random: () => number = Math.random): Chip[] {
  const moments = momentsAt(now);
  const pinned = TOPICS.filter((tp) => weightOf(tp, moments) >= PIN).sort((a, b) => weightOf(b, moments) - weightOf(a, moments)).slice(0, 3);
  const rest = sample(TOPICS.filter((tp) => !pinned.includes(tp)), moments, n - pinned.length, random);
  return [...pinned, ...rest].map((tp) => chipOf(tp, lang));
}

/** Discover's collections for a visit: the moment's own first (at most 2), then a weighted mix, none of them already in
 *  `shown` (the stories above) and none that opens a single reference. Different at different times of day and year. */
export function pickCollections(now: Date, lang: string, n: number, shown: string[], random: () => number = Math.random): Chip[] {
  const moments = momentsAt(now);
  const pool = TOPICS.filter((tp) => !shown.includes(tp.id) && !tp.ref);
  const pinned = pool.filter((tp) => weightOf(tp, moments) >= PIN).sort((a, b) => weightOf(b, moments) - weightOf(a, moments)).slice(0, 2);
  const rest = sample(pool.filter((tp) => !pinned.includes(tp)), moments, n - pinned.length, random);
  return [...pinned, ...rest].map((tp) => chipOf(tp, lang));
}

/** One more chip that is not on screen yet (gentle rotation). */
export function nextChip(now: Date, lang: string, shown: string[], random: () => number = Math.random): Chip | null {
  const [tp] = sample(TOPICS.filter((x) => !shown.includes(x.id)), momentsAt(now), 1, random);
  return tp ? chipOf(tp, lang) : null;
}

/** Topics that match what is being typed on Home: the label (or its English name) starts with the text, or a word of it
 *  starts with the last word typed. Best matches first. */
export function matchChips(q: string, lang: string, limit = 3): Chip[] {
  const text = q.trim().toLowerCase(), last = text.split(/\s+/).pop() ?? "";
  if (!last) return [];
  const words = (s: string) => s.toLowerCase().split(/[\s:'’-]+/);
  const scored: { chip: Chip; score: number }[] = [];
  for (const tp of TOPICS) {
    const chip = chipOf(tp, lang);
    const labels = [chip.label.toLowerCase(), tp.en.toLowerCase()];
    const score = labels.some((l) => l.startsWith(text)) ? 2 : labels.some((l) => words(l).some((w) => w.startsWith(last))) ? 1 : 0;
    if (score) scored.push({ chip, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.chip);
}
