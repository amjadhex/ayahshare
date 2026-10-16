// The reciters the app offers (everyayah.com folders, audio via /audio/:folder/:SSSAAA.mp3), first = default. Shared by
// the web app and the Worker (admin Library turns reciters off: PublicConfig.off). Our own reciters (OWN_RECITERS) are
// not on everyayah.com: their ayah files are in our media bucket (pipeline/own_reciter.py), at the same /audio/ paths.
export const RECITERS: [folder: string, name: string][] = [
  ["Alafasy_128kbps", "Mishary Rashid Alafasy"],
  ["Abdul_Basit_Murattal_192kbps", "Abdul Basit Abdul Samad"],
  ["Abdul_Basit_Mujawwad_128kbps", "Abdul Basit (Mujawwad)"],
  ["Husary_128kbps", "Mahmoud Khalil Al-Husary"],
  ["Husary_128kbps_Mujawwad", "Al-Husary (Mujawwad)"],
  ["Minshawy_Murattal_128kbps", "Mohamed Siddiq Al-Minshawi"],
  ["MaherAlMuaiqly128kbps", "Maher Al-Muaiqly"],
  ["Abdurrahmaan_As-Sudais_192kbps", "Abdurrahman As-Sudais"],
  ["Saood_ash-Shuraym_128kbps", "Saud Ash-Shuraym"],
  ["Yasser_Ad-Dussary_128kbps", "Yasser Ad-Dossari"],
  ["Abu_Bakr_Ash-Shaatree_128kbps", "Abu Bakr Ash-Shatri"],
  ["Nasser_Alqatami_128kbps", "Nasser Al-Qatami"],
  ["Hudhaify_128kbps", "Ali Al-Hudhaify"],
  ["Muhammad_Ayyoub_128kbps", "Muhammad Ayyoub"],
  ["Muhammad_Jibreel_128kbps", "Muhammad Jibreel"],
  ["Salah_Al_Budair_128kbps", "Salah Al-Budair"],
  ["Hani_Rifai_192kbps", "Hani Ar-Rifai"],
  // Added 12 Oct 2026 (owner: more and more varied reciters); each checked complete on everyayah.com (every surah).
  ["Abdullah_Basfar_192kbps", "Abdullah Basfar"],
  ["Ghamadi_40kbps", "Saad Al-Ghamdi"],
  ["ahmed_ibn_ali_al_ajamy_128kbps", "Ahmed Al-Ajmy"],
  ["Abdullaah_3awwaad_Al-Juhaynee_128kbps", "Abdullah Al-Juhany"],
  ["Khaalid_Abdullaah_al-Qahtaanee_192kbps", "Khalid Al-Qahtani"],
  ["Fares_Abbad_64kbps", "Fares Abbad"],
  ["Ali_Jaber_64kbps", "Ali Jaber"],
  ["Salaah_AbdulRahman_Bukhatir_128kbps", "Salah Bukhatir"],
  ["Muhsin_Al_Qasim_192kbps", "Muhsin Al-Qasim"],
  ["Abdullah_Matroud_128kbps", "Abdullah Al-Matrood"],
  ["Mohammad_al_Tablaway_128kbps", "Mohamed At-Tablawi"],
  ["Minshawy_Mujawwad_192kbps", "Al-Minshawi (Mujawwad)"],
  ["Ahmed_Neana_128kbps", "Ahmed Neana"],
  ["Muhammad_AbdulKareem_128kbps", "Muhammad Abdul Kareem"],
  ["Ali_Hajjaj_AlSuesy_128kbps", "Ali Hajjaj Al-Souissi"],
  ["Sahl_Yassin_128kbps", "Sahl Yassin"],
  ["aziz_alili_128kbps", "Aziz Alili"],
  ["Yaser_Salamah_128kbps", "Yaser Salamah"],
  ["Akram_AlAlaqimy_128kbps", "Akram Al-Alaqimy"],
  ["khalefa_al_tunaiji_64kbps", "Khalifa At-Tunaiji"],
  ["Ayman_Sowaid_64kbps", "Ayman Suwaid"],
  // Added 16 Oct 2026 (owner): only published as whole surahs (mp3quran.net), cut per ayah by us; the owner approved using it.
  ["badr_alturki", "Badr Al-Turki"],
];

/** Reciters whose ayah files are ours: R2 audio/<folder>/SSSAAA.mp3, served at /audio/<folder>/SSSAAA.mp3. */
export const OWN_RECITERS = new Set(["badr_alturki"]);
