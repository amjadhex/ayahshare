// The Export sheet. Idle (the design in Create): Video, Image and Share link as round actions, with the HD chip.
// Making: the design's picture under a progress ring (as on the Share screen), "Making your video…", Cancel as a quiet
// text button. Ready: the same picture with its ✓ badge, ✓ Ready and the HD chip (tapping it makes the file again in the other quality), then
// one row of round actions: Share (when the share menu can take the file), Save and Copy link. It closes with ×, a
// swipe or Back; closing it lets go of a finished file (exports from a feed reel or a saved design, phones and touch
// screens). The status line under it only says what happened (saved, copied, canceled, failed).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { setHd } from "../actions";
import { clipUrl } from "../api";
import { designTitle } from "../design";
import type { ExportScene } from "../export";
import { platform } from "../platform";
import { hdFor } from "../prefs";
import { t } from "../strings";
import { HdChip } from "./controls";
import { stillOf, useExport } from "./exportJob";
import { useAppState, useLayout, useRoute, useStore } from "./hooks";
import { CheckIcon, DownloadIcon, ImageIcon, LinkIcon, ShareIcon, VideoIcon } from "./icons";
import "./export.css";

/** Save's label and what is said once saved: Photos (the iOS app), Gallery (the Android app), the phone (a phone's
 *  browser) or the device (a computer's browser, which downloads the file). */
export const saveWords = (phone: boolean): [save: string, saved: string] =>
  platform.kind === "ios" ? [t.saveToPhotos, t.savedToPhotos] : platform.kind === "android" ? [t.saveToGallery, t.savedToGallery]
    : phone ? [t.saveToPhone, t.savedToPhone] : [t.download, t.savedToDevice];

/** Progress as a ring with the percentage in it; without a percentage (an image), a turning arc. */
export function Ring({ pct, label }: { pct: number | null; label: string }) {
  const C = 2 * Math.PI * 32, shown = pct ?? 25;
  return (
    <span className={`ring${pct === null ? " turning" : ""}`} role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <circle className="ring-track" cx="38" cy="38" r="32" />
        <circle className="ring-arc" cx="38" cy="38" r="32" strokeDasharray={`${(C * shown) / 100} ${C}`} />
      </svg>
      {pct !== null && <span className="ring-pct" aria-hidden="true">{pct}%</span>}
    </span>
  );
}

/** The design's picture: its clip's poster at once, then the export engine's still of it (with its text). `alt`: the
 *  picture is described (otherwise it is decorative); `children` sit on top of it (the ring, a badge, Edit). */
export function Thumb({ scene, alt, className = "", children }: { scene?: ExportScene | null; alt?: string; className?: string; children?: ReactNode }) {
  const [still, setStill] = useState<string | null>(null);
  const r = scene?.recipe;
  useEffect(() => {
    setStill(null);
    if (!scene) return;
    let alive = true, url = "";
    stillOf(scene).then((b) => { if (alive && b) setStill((url = URL.createObjectURL(b))); }, () => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [r, scene?.current, scene?.section]); // eslint-disable-line react-hooks/exhaustive-deps
  const poster = scene?.clip && r ? clipUrl(scene.clip, "poster", r.orientation) : null;
  return (
    <span className={`xp-thumb ${className}`.trim()} data-orientation={r?.orientation ?? "portrait"} aria-hidden={alt === undefined || undefined}
      style={{ background: r?.bg.type === "colour" ? r.bg.colour : undefined }}>
      {poster && <img src={poster} alt="" decoding="async" />}
      {still && <img className="xp-still" src={still} alt={alt ?? ""} />}
      {children}
    </span>
  );
}

/** A large round action with its label under it. */
function Action({ icon, label, hint, onClick, disabled, primary }: {
  icon: React.ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean; primary?: boolean;
}) {
  return (
    <button type="button" className={`xp-action${primary ? " primary" : ""}`} disabled={disabled} onClick={onClick}>
      <span className="xp-circle" aria-hidden="true">{icon}</span>
      <span className="xp-label">{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

export function ExportPanel({ variant }: { variant: "sheet" }) {
  const ex = useExport();
  const store = useStore();
  const { hd, loading, ayahs, surahs } = useAppState();
  const job = ex.job;
  const [saveLabel] = saveWords(useLayout() === "phone");
  const notReady = loading || !ayahs.length;

  // Closing the sheet lets go of a finished file (Done is gone): opening it again starts from the choices. The Share
  // screen keeps its own file.
  const open = useRoute().sheet === "export";
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && job.phase === "ready" && job.source !== "share") ex.dismiss();
    wasOpen.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = (scene?: ExportScene) => (scene ? designTitle(scene.recipe, surahs[scene.recipe.surah - 1]) : "");

  let body;
  if (job.phase === "busy") {
    const making = job.kind === "video" ? t.makingVideoNow : t.makingImageNow;
    body = (
      <div className="xp-card">
        <Thumb scene={job.scene} className="xp-thumb-lg">
          <span className="xp-veil"><Ring pct={job.kind === "video" ? job.pct : null} label={job.label} /></span>
        </Thumb>
        <div className="xp-info">
          <p className="xp-title">{making}</p>
          {job.scene && <p className="xp-meta">{title(job.scene)} · {t.qualityOf(job.scene.hd)}</p>}
          {job.kind === "video" && <button type="button" className="xp-cancel" onClick={ex.cancel}>{t.cancel}</button>}
        </div>
      </div>
    );
  } else if (job.phase === "ready") {
    const canShare = platform.canShareFile(job.file);
    const again = (on: boolean) => {
      setHd(store, on);
      const scene = { ...job.scene, hd: on };
      void (job.kind === "video" ? ex.video(scene, job.source) : ex.image(scene, job.source));
    };
    body = (
      <>
        <div className="xp-card">
          <Thumb scene={job.scene} className="xp-thumb-lg"><span className="done-badge" aria-hidden="true"><CheckIcon /></span></Thumb>
          <div className="xp-info">
            <p className="xp-title xp-ready"><span className="xp-check" aria-hidden="true"><CheckIcon /></span>{t.readyShort}</p>
            <p className="xp-meta">{title(job.scene)}</p>
          </div>
          <HdChip on={job.scene.hd} onChange={again} />
        </div>
        <div className="xp-actions">
          {canShare && <Action primary icon={<ShareIcon />} label={t.share} onClick={() => void ex.shareFile()} />}
          <Action primary={!canShare} icon={<DownloadIcon />} label={saveLabel} onClick={() => void ex.saveFile()} />
          <Action icon={<LinkIcon />} label={t.copyLink} disabled={ex.linkBusy} onClick={() => void ex.shareLink(job.scene)} />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="xp-actions">
          <Action icon={<VideoIcon />} label={t.video} hint={t.videoHint} disabled={notReady} onClick={() => void ex.video()} />
          <Action icon={<ImageIcon />} label={t.image} hint={t.imageHint} disabled={notReady} onClick={() => void ex.image()} />
          <Action icon={<LinkIcon />} label={t.shareLink} disabled={ex.linkBusy || notReady} onClick={() => void ex.shareLink()} />
        </div>
        <div className="xp-quality">
          <HdChip on={hdFor(hd, ex.purpose)} onChange={(on) => setHd(store, on)} />
          <span>{t.hdChipHint}</span>
        </div>
        <p className="xp-hint">{t.autoSaveHint}</p>
      </>
    );
  }

  // What happened (saved, copied, canceled, failed); not the progress or "ready", which the sheet shows itself.
  const said = job.phase === "busy" || ex.status === t.ready || ex.status === t.preparing ? "" : ex.status;
  return (
    <div className={`export export-${variant}`}>
      {body}
      <p className={`xp-status${said ? " on" : ""}`} role="status" aria-live="polite">{said}</p>
    </div>
  );
}
