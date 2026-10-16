// The streak, small: a compact pill (the flame and the number of days) in Home's top bar and Profile's. A tap opens a
// small sheet with the details: the days in a row inside a ring that fills towards the next milestone, where it stands in
// one line, the current and the best streak and this week, the last 16 weeks as dots, and today's ayah when today is not
// done yet. The streak is private (kept on this device, streak.ts). The sheet is a history entry ("streak"), so Back
// closes it; `active` says which screen shows it (Home and Profile both stay mounted).
import { useId, useState } from "react";
import { selectAyahs, toast } from "../actions";
import * as api from "../api";
import { loadAyahOfTheDay } from "../discover";
import { defaultTranslation } from "../prefs";
import { closeSheet, navigate, openSheet } from "../router";
import { nextMilestone, WEEKS } from "../streak";
import { t } from "../strings";
import { useRoute, useStore, useStreak } from "./hooks";
import { FlameIcon } from "./icons";
import { Sheet } from "./Sheet";
import "./streak.css";

export function StreakPill({ active, className = "" }: { active: boolean; className?: string }) {
  const streak = useStreak();
  const route = useRoute();
  const open = active && route.sheet === "streak";
  return (
    <>
      <button type="button" className={`streak-pill ${className}`.trim()} data-on={streak.days > 0 || undefined} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t.homeStreak(streak.days)} onClick={() => openSheet("streak")}>
        <FlameIcon /><b>{streak.days}</b>
      </button>
      <Sheet open={open} title={t.streakSheetTitle} onClose={closeSheet} className="streak-sheet">
        {open && <StreakDetails />}
      </Sheet>
    </>
  );
}

function StreakDetails() {
  const store = useStore();
  const streak = useStreak();
  const [busy, setBusy] = useState(false);
  const head = useId();
  const shareToday = async () => {
    setBusy(true);
    const { prefs, lang } = store.getState();
    const today = await api.getTopics().then((f) => loadAyahOfTheDay(f.topics, new Date(), defaultTranslation(prefs, lang))).catch(() => null);
    setBusy(false);
    if (!today) return toast(store, t.todaysAyahFailed);
    const [s, a] = today.ref.split(":").map(Number);
    selectAyahs(store, s, a, a, today.bg);
    navigate("create");
  };
  const ended = streak.days === 0 && streak.total > 0;
  const status = streak.today ? t.streakDone(streak.days + 1) : ended ? t.streakAgain(streak.best)
    : streak.missedYesterday ? t.streakMissed : streak.days ? t.streakKeep : t.streakStart;
  const goal = nextMilestone(streak.days);
  const done = streak.cells.filter((c) => c === "done").length;
  const rest = streak.cells.filter((c) => c === "rest").length;
  const week = streak.cells.slice(-7).filter((c) => c === "done").length;
  return (
    <section className="prof-streak" aria-labelledby={head} data-on={streak.days > 0 || undefined}>
      <div className="prof-streak-head">
        <span className="prof-flame" aria-hidden="true">
          <svg viewBox="0 0 56 56">
            <circle className="track" cx="28" cy="28" r="25" />
            {streak.days > 0 && <circle className="fill" cx="28" cy="28" r="25" pathLength={100} strokeDasharray={`${Math.max(4, Math.round((streak.days / goal) * 100))} 100`} />}
          </svg>
          <FlameIcon />
        </span>
        <div className="prof-streak-title">
          <h3 id={head}>
            {streak.days > 0
              ? <><span className="prof-streak-num">{streak.days}</span> <span className="prof-streak-unit">{t.streakUnit}</span></>
              : ended ? t.streakAgainTitle : t.streakTitle(0)}
          </h3>
          {streak.days > 0 && <p className="prof-streak-goal">{t.streakNext(streak.days, goal)}</p>}
        </div>
      </div>
      <p className="prof-streak-status">{status}</p>
      <dl className="streak-facts">
        <div><dt>{t.streakFactCurrent}</dt><dd>{t.streakDaysValue(streak.days)}</dd></div>
        <div><dt>{t.streakFactBest}</dt><dd>{t.streakDaysValue(streak.best)}</dd></div>
        <div><dt>{t.streakFactWeek}</dt><dd>{t.streakWeekValue(week)}</dd></div>
      </dl>
      {streak.total > 0 && (
        <>
          <div className="prof-heat" role="img" aria-label={t.streakCalendar(WEEKS, done, rest)}>
            {streak.cells.map((c, i) => <span key={i} data-s={c} data-today={i === streak.cells.length - 1 || undefined} />)}
          </div>
          <p className="prof-facts"><span>{t.streakTotalFact(streak.total)}</span></p>
          {rest > 0 && <p className="prof-legend"><span aria-hidden="true" />{t.streakRestKey}</p>}
        </>
      )}
      {!streak.today && (
        <button type="button" className="prof-btn primary wide" disabled={busy} aria-busy={busy || undefined} onClick={() => void shareToday()}>
          {t.shareTodaysAyah}
        </button>
      )}
      <p className="prof-private">{t.streakPrivate}</p>
    </section>
  );
}
