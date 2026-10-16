// Activity, "Notifications" (the bell on Home): what happened this week to the links the person shared, their streak
// and today's ayah as a reminder. Built only from real data — the private impact (GET /api/stats/me), the device's
// streak and the ayah of the day — so there are no names, no times that are not known and no made-up numbers; with
// nothing to show, an empty state. Counted without names; only this person sees it.
import { useEffect, useState, type JSX, type ReactNode } from "react";
import type { Announcement, ImpactResponse } from "../../../../../contracts/types";
import { signedInOnDevice, toast } from "../../actions";
import { markActivitySeen } from "../../activitySeen";
import * as api from "../../api";
import type { DayAyah } from "../../discover";
import { openSearch } from "../../nav";
import { reelFor, startReelsAt } from "../../feed";
import { defaultTranslation } from "../../prefs";
import { back, navigate, openSheet, viewFromLocation } from "../../router";
import { formatCount, myImpact } from "../../stats";
import { t } from "../../strings";
import { openSurah, surahProgress } from "../../surah";
import { dayAyah, openToday, reminderSetting, remindersAvailable, shownTime, watchedToday } from "../../today";
import { momentChip } from "../../topics";
import { useAppState, useStore, useStreak } from "../hooks";
import { JoinCard, usePersonal } from "../Join";
import { BackIcon, BellIcon, BookIcon, EditIcon, FlameIcon, LinkIcon, PlayIcon, SearchIcon, SendIcon, SparkleIcon, SparkIcon } from "../icons";
import "./activity.css";

interface Entry { key: string; Icon: () => JSX.Element; text: readonly [string, string]; thumb?: string | null; onOpen: () => void }

/** Milestones (owner, 12 Oct 2026): all-time opens of the person's links, and streak days, worth a line of their own. */
const OPEN_MILESTONES = [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000];
const STREAK_MILESTONES = [7, 30, 100, 365];
/** The opens milestone the links passed in the impact's days (the largest), or null. */
export function openMilestone(impact: ImpactResponse): number | null {
  const total = impact.total?.opens ?? 0, before = total - impact.opens;
  return OPEN_MILESTONES.filter((m) => total >= m && before < m).pop() ?? null;
}

/** An announcement's link: a screen of the app ("/discover"), another app address (a share link: loaded), or a web page
 *  (a new tab). */
function openLink(link: string) {
  if (/^https:/.test(link)) { window.open(link, "_blank", "noopener"); return; }
  const url = new URL(link, location.origin);
  const view = viewFromLocation(url as unknown as Location);
  if (view !== "find" || url.pathname === "/app" || url.pathname === "/") navigate(view);
  else location.assign(url.pathname + url.search);
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function Activity({ active }: { active: boolean }) {
  const store = useStore();
  const { me, surahs, prefs, lang } = useAppState();
  const translation = defaultTranslation(prefs, lang);
  const streak = useStreak();
  // Signed out: the sign-up card and today's ayah; the streak and the links' reach show once signed in.
  const personal = usePersonal();
  const [impact, setImpact] = useState<ImpactResponse | null | undefined>(undefined);
  const [day, setDay] = useState<{ on: string; ayah: DayAyah | null } | null>(null);

  const id = me?.id;
  useEffect(() => { setImpact(undefined); }, [id]); // the account's numbers go with the account
  useEffect(() => {
    if (!active) return;
    if (!personal) { setImpact(null); return; }
    let alive = true;
    void myImpact().then((r) => { if (alive) setImpact(r); });
    return () => { alive = false; };
  }, [active, id, personal]);

  // Today's ayah: the same one Home, Discover and the reminder have (today.ts dayAyah: the admin's pick, else the app's
  // own), loaded once per day.
  const today = dayKey(new Date());
  useEffect(() => {
    if (!active || day?.on === today) return;
    let alive = true;
    dayAyah(new Date(), translation).then(
      (ayah) => { if (alive) setDay({ on: today, ayah }); },
      () => { if (alive) setDay({ on: today, ayah: null }); },
    );
    return () => { alive = false; };
  }, [active, today]); // eslint-disable-line react-hooks/exhaustive-deps
  // What changes while the page is away (watched today's ayah, the reminder, a surah played on): read when shown.
  const [local, setLocal] = useState(() => ({ watched: watchedToday(), reminder: reminderSetting(), progress: surahProgress() }));
  useEffect(() => { if (active) setLocal({ watched: watchedToday(), reminder: reminderSetting(), progress: surahProgress() }); }, [active]);
  // Opening the page sees what is new (the bell's dot on Home goes), once its numbers are in.
  // News from AyahShare (admin Announcements), newest first.
  const [news, setNews] = useState<Announcement[]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void api.getAnnouncements().then((items) => { if (alive) setNews(items); });
    return () => { alive = false; };
  }, [active]);
  useEffect(() => { if (active && impact !== undefined) markActivitySeen(impact, new Date(), news[0]?.id ?? 0); }, [active, impact, news]);

  /** Today's reel, in Reels (as Home's "Watch today's ayah"); `remind`: with the daily reminder's sheet open over it. */
  const watchToday = (remind = false) => void openToday(translation, "activity").then((ok) => {
    if (!ok) return toast(store, t.todayFailed);
    if (remind) openSheet("reminder");
  });

  const todayList: Entry[] = [];
  const weekList: Entry[] = [];
  const aotd = day?.ayah;
  if (aotd) {
    const s = Number(aotd.ref.split(":")[0]);
    const name = `${surahs[s - 1]?.name_en ?? ""} ${aotd.ref}`.trim();
    todayList.push({
      key: "aotd", Icon: PlayIcon, text: t.actTodayAyah(name, local.watched), thumb: aotd.clip ? api.mediaUrl(aotd.clip.thumb) : null,
      onOpen: () => watchToday(),
    });
  }
  if (remindersAvailable()) {
    todayList.push({
      key: "reminder", Icon: BellIcon,
      text: local.reminder.on ? t.actReminderOn(shownTime(local.reminder.time)) : t.actReminderOff, onOpen: () => watchToday(true),
    });
  }
  if (personal && streak.days > 0) {
    const milestone = streak.today && STREAK_MILESTONES.includes(streak.days);
    todayList.push({
      key: "streak", Icon: FlameIcon, text: milestone ? t.actStreakMilestone(streak.days) : t.actStreak(streak.days, streak.today), onOpen: () => navigate("profile"),
    });
  }
  // A surah played part of the way (Discover's "Play a whole surah"): on from where it stopped.
  const playing = local.progress && local.progress.ayah > 0 ? surahs[local.progress.surah - 1] : undefined;
  if (playing) {
    todayList.push({
      key: "surah", Icon: BookIcon, text: t.actContinue(playing.name_en, local.progress!.ayah, playing.ayahs),
      onOpen: () => void openSurah(playing, { own: prefs.reciter }),
    });
  }
  // The moment's own ayahs (Friday's Al-Kahf, the evening's remembrance, Ramadan…; topics.ts), when it is one.
  const moment = momentChip(new Date(), lang);
  if (moment) {
    todayList.push({ key: "moment", Icon: SearchIcon, text: t.actMoment(moment.label), onOpen: () => openSearch(moment.q, { surah: moment.surah }) });
  }
  if (impact) {
    const toProfile = () => navigate("profile");
    const m = openMilestone(impact);
    if (m) todayList.unshift({ key: "milestone", Icon: SparkleIcon, text: t.actOpensMilestone(formatCount(m)), onOpen: toProfile });
    // The links used most this week, one line each with the ayah's picture; a tap plays that ayah with its background.
    for (const l of impact.links ?? []) {
      if (weekList.length >= 3) break;
      const s = Number(l.ref.split(":")[0]);
      const name = `${surahs[s - 1]?.name_en ?? ""} ${l.ref}${l.to ? `–${l.to}` : ""}`.trim();
      const clip = l.clip ? api.clipById(l.clip) : null;
      weekList.push({
        key: `link-${l.code}`, Icon: LinkIcon, text: t.actLink(name, l.opens, l.reshares, l.makes), thumb: clip ? api.mediaUrl(clip.thumb) : null,
        onOpen: () => startReelsAt([{ item: reelFor(l.ref, { kind: "discover" }, 0, l.to), bg: l.clip ? { type: "clip", id: l.clip } : undefined }], 0),
      });
    }
    if (impact.opens > 0) weekList.push({ key: "opens", Icon: LinkIcon, text: t.actOpens(formatCount(impact.opens), impact.opens === 1), onOpen: toProfile });
    if (impact.reshares > 0) weekList.push({ key: "reshares", Icon: SendIcon, text: t.actReshares(formatCount(impact.reshares), impact.reshares === 1), onOpen: toProfile });
    if (impact.makes > 0) weekList.push({ key: "makes", Icon: EditIcon, text: t.actMakes(formatCount(impact.makes), impact.makes === 1), onOpen: toProfile });
  }
  const loading = impact === undefined || day === null;
  const newsList: Entry[] = news.map((a) => ({
    key: `news-${a.id}`, Icon: SparkIcon, text: [a.title, a.body] as const, onOpen: () => { if (a.link) openLink(a.link); },
  }));
  const empty = personal && !loading && !todayList.length && !weekList.length && !newsList.length;

  return (
    <div className="act">
      <header className="act-bar">
        <button type="button" className="act-icon-btn" aria-label={t.back} title={t.back} onClick={back}><BackIcon /></button>
        <h1>{t.navActivity}</h1>
      </header>
      {!personal && !signedInOnDevice() && <JoinCard sub={t.joinActivity} />}
      {empty ? (
        <div className="act-empty">
          <span className="act-empty-icon"><BellIcon /></span>
          <h2>{t.actEmptyTitle}</h2>
          <p>{t.actEmptyText}</p>
        </div>
      ) : (
        <div aria-busy={loading || undefined}>
          <Group title={t.actNews} entries={newsList} />
          <Group title={t.actToday} entries={todayList} />
          <Group title={t.actThisWeek} entries={weekList} />
        </div>
      )}
      <p className="act-foot">{t.actFootnote}</p>
    </div>
  );
}

function Group({ title, entries }: { title: string; entries: Entry[] }): ReactNode {
  if (!entries.length) return null;
  return (
    <section className="act-group" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {entries.map(({ key, Icon, text: [bold, rest], thumb, onOpen }) => (
          <li key={key}>
            <button type="button" className="act-item" onClick={onOpen}>
              <span className="act-icon"><Icon /></span>
              <span className="act-text"><strong>{bold}</strong> {rest}</span>
              {thumb && <img className="act-thumb" src={thumb} alt="" loading="lazy" decoding="async" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
