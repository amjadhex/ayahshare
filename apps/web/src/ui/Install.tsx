// Promoting the installed app (owner, 8 Oct 2026: the web app comes first). Home's install strip and the install sheet
// (pwa.ts says when it asks on its own). Android and computers: the browser's own install prompt. iPhone and iPad: the
// two steps in the Share menu. Nothing shows once installed, in the native app or in an in-app browser.
import { useEffect, useSyncExternalStore } from "react";
import { closeInstall, hideStrip, install, installBusy, installKind, isAskingInstall, onInstallChange, openInstall, stripHidden } from "../pwa";
import { t } from "../strings";
import { useExport } from "./exportJob";
import { useAppState, useRoute } from "./hooks";
import { CloseIcon, NextIcon } from "./icons";
import { Sheet } from "./Sheet";
import { BrandMark } from "./screens/BrandLogo";
import "./install.css";

const useKind = () => useSyncExternalStore(onInstallChange, installKind);

/** The install sheet. It waits while another sheet or the language question is open. */
export function InstallSheet() {
  const kind = useKind();
  const asking = useSyncExternalStore(onInstallChange, isAskingInstall);
  const { langPicker } = useAppState();
  const route = useRoute();
  // An export in progress (and the minute after it) keeps the sheet from asking on its own (pwa.ts).
  const { job, linkBusy } = useExport();
  const exporting = job.phase === "busy" || linkBusy;
  useEffect(() => (exporting ? installBusy() : undefined), [exporting]);
  const open = asking && !!kind && !route.sheet && !langPicker;
  const go = () => { closeInstall(); void install(); };
  return (
    <Sheet open={open} title={t.installTitle} onClose={closeInstall} className="install-sheet">
      {open && (
        <div className="install">
          <BrandMark size={56} />
          <p className="install-sub">{t.installSub}</p>
          {kind === "prompt" ? (
            <button type="button" className="install-go" onClick={go}>{t.installNow}</button>
          ) : (
            <ol className="install-steps">
              <li><span className="install-num">1</span><span>{t.installIosShare}</span></li>
              <li><span className="install-num">2</span><span>{t.installIosAdd}</span></li>
            </ol>
          )}
          <button type="button" className="install-later" onClick={closeInstall}>{t.notNow}</button>
        </div>
      )}
    </Sheet>
  );
}

/** Home's strip at the foot (owner: a strip, not an icon in the top bar), in a browser that can install the app. Install
 *  opens the browser's prompt (or the iPhone steps); × hides it for a week. */
export function InstallStrip() {
  const kind = useKind();
  const hidden = useSyncExternalStore(onInstallChange, () => stripHidden());
  if (!kind || hidden) return null;
  const go = () => (kind === "prompt" ? void install() : openInstall());
  return (
    <aside className="install-strip" aria-label={t.installTitle}>
      <img className="install-strip-icon" src="/icons/icon.svg" alt="" width="40" height="40" />
      <div className="install-strip-text">
        <strong>{t.installStripTitle}</strong>
        <span>{t.installStripSub}</span>
      </div>
      <button type="button" className="install-strip-go" onClick={go}>{t.installNow}</button>
      <button type="button" className="install-strip-close" aria-label={t.close} onClick={() => hideStrip()}><CloseIcon /></button>
    </aside>
  );
}

/** Settings → The app: a row like the others, only where the app can be installed (the browser's prompt, or the iPhone steps). */
export function InstallRow() {
  const kind = useKind();
  if (!kind) return null;
  return <li><button type="button" onClick={() => (kind === "prompt" ? void install() : openInstall())}><span>{t.install}</span><NextIcon /></button></li>;
}
