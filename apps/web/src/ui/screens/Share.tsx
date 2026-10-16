// Share (Share v2, owner's design 9 Oct 2026): a large still of the design with a small Edit on its corner, "Video ·
// 9:16", then three actions: Share (the file to the system share menu; browsers without one for files save it instead),
// Save to phone with a tiny HD toggle inside it, and a quiet Copy link. Making: the still under a progress ring, one
// line, Cancel. Ready: ✓ what happened, one quiet line (the streak once signed in; kept on this device and Log in
// before that), Make another (Home), Edit again, and Share again. A file made while the person was elsewhere waits for a
// tap ("Your file is ready"); a video this device cannot make offers the image instead. Dark on every screen size, like
// the editor. Phones: one column; larger screens: the still on the left, the actions on the right.
// Quality (prefs.ts hdFor): until the person picks, Share sends Standard and Save keeps HD (the toggle shows Save's);
// the HD toggle picks one quality for both.
import { useEffect, useMemo, useRef, useState } from "react";
import { setHd } from "../../actions";
import { back, getRoute, navigate } from "../../router";
import { t } from "../../strings";
import { hdFor, type Purpose } from "../../prefs";
import { Ring, saveWords, Thumb } from "../ExportPanel";
import { sceneOf, useExport, type Kind } from "../exportJob";
import { useAppState, useLayout, useStore, useStreak } from "../hooks";
import { usePersonal } from "../Join";
import { CheckIcon, DownloadIcon, EditIcon, FlameIcon, PrevIcon, ShareIcon } from "../icons";
import "./share.css";

type Target = "share" | "save" | "link";

export function Share({ active }: { active: boolean }) {
  const store = useStore();
  const s = useAppState();
  const ex = useExport();
  const streak = useStreak();
  const personal = usePersonal(); // the streak line once signed in (kept on the device before that)
  const [save, saved] = saveWords(useLayout() === "phone");
  const r = s.recipe, job = ex.job;
  /** Video or image: the editor's Format card decides (app state), so both screens say the same; `fallback`: the image
   *  made here because this device could not make the video (until the person goes back to the editor). */
  const [fallback, setFallback] = useState(false);
  const kind: Kind = fallback ? "image" : s.format;
  const [target, setTarget] = useState<Target | null>(null);
  /** Done: what happened. Waiting: the file is ready, but the share menu needs a tap. Failed: the video could not be
   *  made here (the image is offered instead), for the place it was meant for. */
  const [outcome, setOutcome] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Target | null>(null);
  const [failed, setFailed] = useState<Target | null>(null);
  const canceled = useRef(false);

  const scene = useMemo(() => sceneOf(s), [s.recipe, s.ayahs, s.current, s.hd, s.loading, s.surahs, s.editions, s.config, s.catalogue]); // eslint-disable-line react-hooks/exhaustive-deps
  const notReady = !scene;
  const mine = job.phase === "busy" && job.source === "share";
  const busy = job.phase === "busy" || target !== null;
  const saveHd = hdFor(s.hd, "save");
  const purposeOf = (to: Target): Purpose => (to === "save" ? "save" : "share");
  /** The file made here last time, if it is still this design in this format and quality (sending it again needs no
   *  new file). */
  const madeFor = (purpose: Purpose) => job.phase === "ready" && job.source === "share" && job.kind === kind && !!scene
    && job.scene.recipe === scene.recipe && job.scene.hd === hdFor(s.hd, purpose) && (kind === "video" || job.scene.current === scene.current);

  // Back on this screen after editing: start again from the choices.
  useEffect(() => { if (!active) { setOutcome(null); setWaiting(null); setFailed(null); setFallback(false); } }, [active]);

  /** Sends the finished file on. `auto`: not straight after a tap, so the browser may want one first. */
  async function deliver(to: Target, auto: boolean) {
    setWaiting(null);
    if (to === "save") {
      if (await ex.saveFile()) setOutcome(saved);
      return;
    }
    const res = await ex.shareFile({ auto });
    if (res === "shared") setOutcome(t.shared);
    else if (res === "saved") setOutcome(saved); // no share menu for files here: saved instead
    else if (res === "blocked" || res === "closed") setWaiting(to);
  }

  async function send(to: Target, as: Kind = kind) {
    setOutcome(null);
    setWaiting(null);
    setFailed(null);
    setTarget(to);
    canceled.current = false;
    try {
      if (to === "link") {
        if (await ex.shareLink(undefined, "share", "copy")) setOutcome(t.linkCopied);
        return;
      }
      if (as === kind && madeFor(purposeOf(to))) return await deliver(to, false);
      const sc = sceneOf(store.getState(), purposeOf(to));
      if (!sc) return;
      if (!(await (as === "video" ? ex.video(sc, "share") : ex.image(sc, "share")))) {
        if (as === "video" && !canceled.current) setFailed(to); // this device could not make it
        return;
      }
      // Made while the person was elsewhere: the file waits here for a tap.
      if (getRoute().view !== "share") setWaiting(to);
      else await deliver(to, true);
    } finally {
      setTarget(null);
    }
  }

  const tryImage = () => {
    const to = failed ?? "save";
    setFallback(true);
    void send(to, "image");
  };

  const onScreen = s.ayahs[s.current];
  const backToEditor = () => (getRoute().depth > 1 ? back() : navigate("create"));
  // What happened, when it is worth saying on the choices (canceled, could not save or link; a link to copy by hand).
  const problems = [t.canceled, t.saveDenied, t.linkFailed, t.imageFailed];
  const said = ex.status && (problems.includes(ex.status) || /^https?:\/\//.test(ex.status)) ? ex.status : "";

  const phase = mine ? "making" : outcome ? "done" : waiting && job.phase === "ready" ? "waiting" : failed ? "error" : "choose";

  let panel;
  if (phase === "making" && job.phase === "busy") {
    panel = (
      <div className="share-making">
        <p className="share-making-title" role="status">{job.kind === "video" ? t.makingVideoNow : t.makingImageNow}</p>
        <button type="button" className="share-quiet muted" onClick={() => { canceled.current = true; ex.cancel(); }}>{t.cancel}</button>
      </div>
    );
  } else if (phase === "done") {
    panel = (
      <div className="share-stack">
        <div className="share-result">
          <p className="share-outcome" role="status"><CheckIcon />{outcome}</p>
          {personal ? (
            <p className="share-line">
              {streak.days > 0 && <FlameIcon />}
              {t.shareInProfile}{streak.days > 0 ? ` · ${t.streakDays(streak.days)}${streak.today ? `, ${t.doneForToday}` : ""}` : ""}
            </p>
          ) : (
            <p className="share-line">
              {t.shareKept} · <button type="button" className="share-login" onClick={() => navigate("login")}>{t.logIn}</button> {t.shareToKeep}
            </p>
          )}
        </div>
        <button type="button" className="share-btn gold" onClick={() => navigate("find")}>{t.makeAnother}</button>
        <button type="button" className="share-btn plain" onClick={backToEditor}>{t.editAgain}</button>
        <button type="button" className="share-quiet" onClick={() => setOutcome(null)}>{t.shareAgain}</button>
      </div>
    );
  } else if (phase === "waiting" && waiting) {
    panel = (
      <div className="share-stack">
        <p className="share-making-title">{t.ready}</p>
        <button type="button" className="share-btn emerald" onClick={() => void deliver(waiting === "save" ? "share" : waiting, false)}>{t.openShareMenu}</button>
        <button type="button" className="share-quiet" onClick={() => void deliver("save", false)}>{t.saveInstead(save)}</button>
      </div>
    );
  } else if (phase === "error") {
    panel = (
      <div className="share-stack">
        <p className="share-error" role="alert">{t.exportFailed}</p>
        <button type="button" className="share-btn gold" disabled={busy} onClick={tryImage}>{t.makeTheImage}</button>
        <button type="button" className="share-quiet muted" onClick={() => setFailed(null)}>{t.back}</button>
      </div>
    );
  } else {
    const off = notReady || busy;
    panel = (
      <div className="share-stack">
        {said && <p className="share-status" role="status">{said}</p>}
        <button type="button" className="share-btn emerald" disabled={off} onClick={() => void send("share")}><ShareIcon />{t.share}</button>
        <div className="share-save">
          <button type="button" className="share-save-main" disabled={off} onClick={() => void send("save")}><DownloadIcon />{save}</button>
          <button type="button" className="share-hd" aria-pressed={saveHd} aria-label={t.hdQuality} title={t.hdChipHint}
            disabled={busy} onClick={() => setHd(store, !saveHd)}><span>{t.hd}</span></button>
        </div>
        <button type="button" className="share-quiet" disabled={off || ex.linkBusy} onClick={() => void send("link")}>{t.copyLink}</button>
      </div>
    );
  }

  return (
    <div className="share" data-phase={phase}>
      <header className="share-top">
        <button type="button" className="share-back" aria-label={t.backToEditor} onClick={backToEditor}><PrevIcon /></button>
        <h1>{t.shareTitle}</h1>
      </header>
      <div className="share-body">
        <div className="share-head">
          <Thumb scene={active ? scene : null} className="share-thumb" alt={onScreen ? `${onScreen.ar} ${onScreen.tr}` : ""}>
            {phase === "making" && job.phase === "busy" && (
              <span className="xp-veil">
                <Ring pct={job.kind === "video" ? job.pct : null} label={job.kind === "video" ? t.makingVideoNow : t.makingImageNow} />
              </span>
            )}
            {phase === "done" && <span className="done-badge" aria-hidden="true"><CheckIcon /></span>}
            {phase === "choose" && (
              <button type="button" className="share-edit" onClick={backToEditor}><span><EditIcon />{t.shareEdit}</span></button>
            )}
          </Thumb>
          <span className="share-caption">{t.shareCaption(kind === "video" ? t.video : t.image, t.ratio[r.orientation])}</span>
        </div>
        <div className="share-panel">{panel}</div>
      </div>
    </div>
  );
}
