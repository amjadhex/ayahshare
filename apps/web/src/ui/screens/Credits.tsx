// Credits (opened from Settings → "Credits & legal", /credits): who the Quran text, translations, tafsir, recitations,
// backgrounds and fonts come from, then the legal pages and the maker. Same look as Settings (settings.css). The links to
// the sources open outside the app: a new tab on the web, the system browser in the app (platform.openExternal).
import { useId, type MouseEvent, type ReactNode } from "react";
import { openReport } from "../../actions";
import { RECITERS } from "../../config";
import { apiBase } from "../../endpoint";
import { platform } from "../../platform";
import { back, getRoute, navigate } from "../../router";
import { t } from "../../strings";
import { useStore } from "../hooks";
import { BackIcon, NextIcon, OpenIcon } from "../icons";
import { MadeBy } from "../MadeBy";
import "./settings.css";
import "./credits.css";

/** Back to Settings: the entry before (Credits opens from Settings), or Settings itself when Credits was opened directly. */
const toSettings = () => (getRoute().depth > 1 ? back() : navigate("settings"));

/** A source: its name and what it gave the app, opening its site outside the app. */
function Source({ href, name, children }: { href: string; name: string; children: string }) {
  const open = (e: MouseEvent) => { e.preventDefault(); platform.openExternal(href); };
  return (
    <li>
      <a href={href} target="_blank" rel="noopener" onClick={open}>
        <span className="cr-text"><strong>{name}</strong><small>{children}</small><span className="set-sr"> {t.opensNewTab}</span></span><OpenIcon />
      </a>
    </li>
  );
}

function Group({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  const id = useId();
  return (
    <section className="set-group" aria-labelledby={id}>
      <h2 id={id} className="set-heading">{title}</h2>
      {children}
      {note && <p className="cr-note">{note}</p>}
    </section>
  );
}

const RECITER_NAMES = RECITERS.map(([, name]) => name).join(", ");

export function Credits(_: { active: boolean }) {
  const store = useStore();
  const legal = useId();
  return (
    <div className="set-page cr-page">
      <header className="set-bar">
        <button type="button" className="set-icon-btn" aria-label={t.backToSettings} title={t.backToSettings} onClick={toSettings}><BackIcon /></button>
        <h1>{t.creditsTitle}</h1>
      </header>
      <div className="set-body">
        <p className="cr-intro">{t.creditsIntro}</p>

        <Group title={t.creditsQuran}>
          <ul className="set-list">
            <Source href="https://alquran.cloud" name="Al Quran Cloud · Tanzil">{t.crAlquran}</Source>
            <Source href="https://quran.foundation" name="Quran Foundation">{t.crQuranFoundation}</Source>
            <Source href="https://lalithasaram.net" name="Quran Lalithasaram">{t.crLalithasaram}</Source>
          </ul>
        </Group>

        <Group title={t.creditsTafsir}>
          <ul className="set-list">
            <Source href="https://quran.foundation" name="Quran Foundation">{t.crTafsirQf}</Source>
            <Source href="https://thafheem.net" name="Thafheemul Quran">{t.crThafheem}</Source>
            <Source href="https://quranreflect.com" name="QuranReflect">{t.crQuranReflect}</Source>
          </ul>
        </Group>

        <Group title={t.creditsRecitations} note={t.crReciters(RECITER_NAMES)}>
          <ul className="set-list">
            <Source href="https://everyayah.com" name="EveryAyah.com">{t.crEveryAyah}</Source>
            <Source href="https://mp3quran.net" name="MP3Quran.net">{t.crMp3Quran}</Source>
          </ul>
        </Group>

        <Group title={t.creditsBackgrounds}>
          <ul className="set-list">
            <Source href="https://pixabay.com" name="Pixabay">{t.crPixabay}</Source>
          </ul>
        </Group>

        <Group title={t.creditsFonts} note={t.crFonts}>
          <ul className="set-list">
            <Source href="https://fonts.google.com" name="Google Fonts">Amiri Quran · Figtree · Montserrat · Inter · Noto</Source>
          </ul>
        </Group>

        <section className="set-group" role="region" aria-labelledby={legal}>
          <h2 id={legal} className="set-heading">{t.creditsLegalHead}</h2>
          <ul className="set-list">
            <li><a href={`${apiBase()}/privacy`} target="_blank" rel="noopener"><span>{t.privacyPolicy}<span className="set-sr"> {t.opensNewTab}</span></span><OpenIcon /></a></li>
            <li><a href={`${apiBase()}/terms`} target="_blank" rel="noopener"><span>{t.termsOfService}<span className="set-sr"> {t.opensNewTab}</span></span><OpenIcon /></a></li>
            <li><a href={`${apiBase()}/support`} target="_blank" rel="noopener"><span>{t.helpSupport}<span className="set-sr"> {t.opensNewTab}</span></span><OpenIcon /></a></li>
            <li><button type="button" onClick={() => openReport(store, { kind: "other" })}><span>{t.reportProblem}</span><NextIcon /></button></li>
          </ul>
        </section>

        <footer className="set-brand cr-made">
          <h2 className="set-heading">{t.creditsMadeBy}</h2>
          <MadeBy />
        </footer>
      </div>
    </div>
  );
}
