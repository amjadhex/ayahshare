// All surahs (opened from Discover's "Play a whole surah"): every surah in a list that can be searched (by number, English
// name or Arabic name), the reciter they play with (a bottom sheet; kept on the device, surah.ts) and "Continue" for the
// surah last played. A row plays the surah from its first ayah in Reels, each reel going on to the next (surah.ts openSurah);
// the surah in progress resumes where the person stopped instead.
import { useMemo, useState } from "react";
import type { Surah } from "../../../../../contracts/types";
import { RECITERS } from "../../config";
import { fixedReciter } from "../../feed";
import { back, closeSheet, openSheet } from "../../router";
import { t } from "../../strings";
import { openSurah, setSurahReciter, surahProgress, surahReciter } from "../../surah";
import { useAppState, useRoute } from "../hooks";
import { BackIcon, CheckIcon, DownIcon, PlayIcon, SearchIcon, WaveIcon } from "../icons";
import { SampleButton, useReciterSample } from "../ReciterSample";
import { Sheet } from "../Sheet";
import "./surahs.css";

/** Letters only, lower case, without accents or hyphens, and with the spellings of one sound folded together
 *  ("Ya-Sin" and "Yaseen" both become "yasin"; "Ar-Rahman" and "Ar Rahmaan" both "arrahman"). */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "")
  .replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo|ou/g, "u").replace(/e/g, "i");
/** Arabic letters only: no vowel marks, small marks or tatweel. */
const foldAr = (s: string) => s.normalize("NFD").replace(/[^\u0621-\u064A\u0671]/g, "").replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627");

function matches(s: Surah, q: string): boolean {
  const query = q.trim();
  if (!query) return true;
  if (/^\d+$/.test(query)) return s.n === Number(query);
  const en = fold(query), ar = foldAr(query);
  return (!!en && (fold(s.name_en).includes(en) || fold(s.meaning).includes(en))) || (!!ar && foldAr(s.name_ar).includes(ar));
}

export function Surahs({ active }: { active: boolean }) {
  const { surahs, prefs } = useAppState();
  const route = useRoute();
  const [query, setQuery] = useState("");
  const [, picked] = useState(0); // the reciter lives on the device (surah.ts): shown again when it is chosen
  const progress = useMemo(() => surahProgress(), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const reciter = surahReciter(fixedReciter(prefs) ?? prefs.reciter);
  const reciterName = RECITERS.find(([folder]) => folder === reciter)?.[1] ?? reciter;
  const list = useMemo(() => surahs.filter((s) => matches(s, query)), [surahs, query]);
  const mine = progress ? surahs[progress.surah - 1] : undefined;
  const mineAyah = mine && progress ? Math.min(Math.max(1, progress.ayah), mine.ayahs) : 0;
  const sheetOpen = active && route.sheet === "surahReciter";
  const sample = useReciterSample(sheetOpen);

  const resume = (s: Surah) => void openSurah(s, { own: fixedReciter(prefs) ?? prefs.reciter });
  const play = (s: Surah) => (s.n === mine?.n ? resume(s) : void openSurah(s, { from: 1, reciter }));

  return (
    <div className="srh">
      <header className="srh-bar">
        <button type="button" className="srh-icon-btn" aria-label={t.back} title={t.back} onClick={back}><BackIcon /></button>
        <h1>{t.allSurahs}</h1>
      </header>

      <label className="srh-search">
        <SearchIcon />
        <input type="search" value={query} placeholder={t.surahSearchPlaceholder} aria-label={t.surahSearchLabel} enterKeyHint="search"
          autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <button type="button" className="srh-reciter" aria-haspopup="dialog" aria-expanded={sheetOpen} aria-label={t.surahReciterLabel(reciterName)}
        onClick={() => openSheet("surahReciter")}>
        <WaveIcon /><span>{reciterName}</span><DownIcon />
      </button>

      {mine && !query.trim() && (
        <section aria-labelledby="srh-continue">
          <h2 className="srh-h" id="srh-continue">{t.surahContinue}</h2>
          <button type="button" className="srh-continue" aria-label={t.surahContinueLabel(mine.name_en, mineAyah)} onClick={() => resume(mine)}>
            <span className="srh-play"><PlayIcon /></span>
            <span className="srh-continue-text">
              <strong>{t.surahFromAyah(mine.name_en, mineAyah)}</strong>
              <span className="srh-bar-track" aria-hidden="true"><i style={{ width: `${(mineAyah / mine.ayahs) * 100}%` }} /></span>
            </span>
            <span className="srh-ar" dir="rtl" lang="ar">{mine.name_ar}</span>
          </button>
        </section>
      )}

      <h2 className="srh-h" aria-live="polite">{t.surahCount(list.length)}</h2>
      {list.length ? (
        <ul className="srh-list">
          {list.map((s) => (
            <li key={s.n}>
              <button type="button" className="srh-row" aria-label={s.n === mine?.n ? t.surahContinueLabel(s.name_en, mineAyah) : t.surahPlayLabel(s.name_en)} onClick={() => play(s)}>
                <span className="srh-num" aria-hidden="true">{s.n}</span>
                <span className="srh-row-text"><strong>{s.name_en}</strong><span>{t.surahAyahs(s.ayahs)}</span></span>
                <span className="srh-ar" dir="rtl" lang="ar">{s.name_ar}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="srh-empty" role="status">{t.surahNoMatch}</p>}

      <Sheet open={sheetOpen} title={t.surahReciter} onClose={closeSheet} className="srh-sheet">
        <div className="srh-choices" role="radiogroup" aria-label={t.surahReciter}>
          {RECITERS.map(([folder, name]) => (
            <div key={folder} className="choice-row">
              <button type="button" role="radio" aria-checked={folder === reciter} onClick={() => { setSurahReciter(folder); picked((n) => n + 1); closeSheet(); }}>
                <span>{name}</span>{folder === reciter && <CheckIcon />}
              </button>
              <SampleButton name={name} playing={sample.playing === folder} onClick={() => sample.toggle(folder)} />
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
