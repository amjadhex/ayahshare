// Settings (the Settings button on Profile): three groups of cards. Account: sign-in or the person's account (name, email,
// location and WhatsApp number, sign out, delete account). The app: install, help and support, report a problem, and the appearance (System · Light · Dark). Then one
// row, "Credits & legal", that opens the Credits screen (the sources, the privacy policy and terms, the maker).
// What new designs start with (language, translation, voice, reciter, design defaults, interests) is in Preferences, a
// sheet on Profile. Back returns to Profile.
import { useId } from "react";
import { openReport } from "../../actions";
import { apiBase } from "../../endpoint";
import type { Theme } from "../../prefs";
import { back, getRoute, navigate } from "../../router";
import { t } from "../../strings";
import { setTheme } from "../../theme";
import { Segmented } from "../controls";
import { useAppState, useStore, useTheme } from "../hooks";
import { BackIcon, NextIcon, OpenIcon } from "../icons";
import { InstallRow } from "../Install";
import { AccountSections } from "../Profile";
import { MadeBy } from "../MadeBy";
import { BrandLogo } from "./BrandLogo";
import "./settings.css";

/** Back to Profile: the entry before (Settings opens from Profile), or Profile itself when Settings was opened directly. */
const toProfile = () => (getRoute().depth > 1 ? back() : navigate("profile"));

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener">
      <span>{children}<span className="set-sr"> {t.opensNewTab}</span></span><OpenIcon />
    </a>
  );
}

export function Settings({ active }: { active: boolean }) {
  const store = useStore();
  const { config } = useAppState();
  const theme = useTheme();
  const ids = { account: useId(), app: useId(), theme: useId() };
  return (
    <div className="set-page">
      <header className="set-bar">
        <button type="button" className="set-icon-btn" aria-label={t.backToProfile} title={t.backToProfile} onClick={toProfile}><BackIcon /></button>
        <h1>{t.settingsTitle}</h1>
      </header>
      <div className="set-body">
        <section className="set-group" aria-labelledby={ids.account}>
          <h2 id={ids.account} className="set-heading">{t.accountSection}</h2>
          <AccountSections active={active} />
        </section>

        <section className="set-group" aria-labelledby={ids.app}>
          <h2 id={ids.app} className="set-heading">{t.setApp}</h2>
          <ul className="set-list">
            <InstallRow />
            <li><Link href={`${apiBase()}/support`}>{t.helpSupport}</Link></li>
            <li><button type="button" onClick={() => openReport(store, { kind: "other" })}><span>{t.reportProblem}</span><NextIcon /></button></li>
          </ul>
          <div className="set-appearance">
            <span id={ids.theme}>{t.appearance}</span>
            <Segmented<Theme> labelledBy={ids.theme} value={theme} onChange={setTheme}
              options={[["system", t.themeSystem], ["light", t.themeLight], ["dark", t.themeDark]]} />
          </div>
        </section>

        <section className="set-group">
          <ul className="set-list">
            <li><button type="button" onClick={() => navigate("credits")}><span>{t.creditsLegal}</span><NextIcon /></button></li>
          </ul>
        </section>

        <footer className="set-brand">
          <BrandLogo name={config.appName} />
          <p>{t.brandTagline}</p>
          <MadeBy />
        </footer>
      </div>
    </div>
  );
}
