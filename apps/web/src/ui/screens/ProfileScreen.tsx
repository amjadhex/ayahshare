// Profile, Instagram-style: a top bar with the small streak pill (a tap opens its details, Streak.tsx); the picture in an
// emerald-gold ring with the name and three numbers beside it (Creations · Shares · Day streak), and under them
// Preferences (a sheet: language and translation, recitation, design defaults, interests) and Settings (a page: the
// account, the app, About and legal). Where sign-in is offered, signed-out visitors see the sign-up card and, under it,
// Preferences and Settings (kept on this device), but nothing of the account. Then two tabs: the creations grid (a
// tap opens Open in Create · Download again · Share link · Delete, with Undo) and the saved ayahs.
// Only real numbers: no counts are made up, and empty states say what will appear. The streak is seen by this person
// only. Designs kept on this device before signing in move to the account by themselves (Saved.tsx).
//
// The numbers: Creations = saved designs (the account's, or this device's). Shares = the person's exports and links:
// signed in, the account's share links plus its exported designs; signed out, this device's saved designs (each one
// was exported or linked at least once). Day streak = streak.ts, which also learns the days of the saved designs here.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { refreshProfile, signedInOnDevice } from "../../actions";
import { closeSheet, navigate, openSheet } from "../../router";
import { platform } from "../../platform";
import { formatCount } from "../../stats";
import { recordDays } from "../../streak";
import { t } from "../../strings";
import { Avatar } from "../Account";
import { useAppState, useRoute, useStore, useStreak } from "../hooks";
import { BookmarkIcon, GridIcon, UserIcon } from "../icons";
import { JoinCard, usePersonal } from "../Join";
import { MadeBy } from "../MadeBy";
import { NameCard } from "../NameForm";
import { PreferencesPanel } from "../Profile";
import { CreationSheet, KIND, KindBadge, SavedAyahs, savedDate, Thumb, useAgainProgress, useSaved, type Item } from "../Saved";
import { Sheet } from "../Sheet";
import { StreakPill } from "../Streak";
import "./profile.css";

type Tab = "creations" | "ayahs";

let oneTapShown = false;

export function ProfileScreen({ active }: { active: boolean }) {
  const store = useStore();
  const { me, config } = useAppState();
  const personal = usePersonal(); // signed out: the sign-up card instead (all of it is still kept on the device)
  const saved = useSaved(active);
  const [tab, setTab] = useState<Tab>("creations");
  const [sheet, setSheet] = useState<Item | null>(null);
  // The Preferences sheet is a history entry ("prefs"), so Back closes it. Its content is mounted once first opened. The
  // pickers and the topic list open over it as sheets of their own (more entries) and it stays open under them.
  const route = useRoute();
  const prefs = active && !!route.sheet && ["prefs", "translation", "picker", "interests"].includes(route.sheet);
  const [prefsUsed, setPrefsUsed] = useState(false);
  const openPrefs = () => { setPrefsUsed(true); openSheet("prefs"); };
  const ids = { name: useId(), creations: useId(), ayahs: useId(), panel: useId() };
  const tabs = useRef<HTMLDivElement>(null);

  // Fresh numbers each time the profile is shown (they change with every export and link).
  const id = me?.id;
  useEffect(() => { if (active && id) void refreshProfile(store); }, [active, id, store]);
  // The days designs were saved on count for the streak too (another device, or before the streak was kept).
  useEffect(() => { if (!saved.loading) recordDays(saved.items.map((i) => i.at)); }, [saved.loading, saved.items]);
  // Signed out on the web: Google's One Tap ("Continue as …") when Profile opens, once a visit (owner, 16 Oct 2026).
  useEffect(() => {
    if (!active || me || signedInOnDevice() || platform.kind !== "web" || !config.googleClientId || oneTapShown) return;
    oneTapShown = true;
    platform.googleSignIn.prompt();
  }, [active, me, config.googleClientId]);

  const creations = saved.loading ? me?.stats?.creations ?? null : saved.items.length;
  const shares = saved.loading ? null
    : me ? (me.stats?.shares ?? 0) + saved.items.filter((i) => i.kind !== "link").length : saved.items.length;
  const streak = useStreak();

  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Tab = tab === "creations" ? "ayahs" : "creations";
    setTab(next);
    tabs.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <div className="prof">
      <header className="prof-bar">
        <h1>{t.profileTitle}</h1>
        {personal && <StreakPill active={active} />}
      </header>

      {personal ? (
        <>
          <section className="prof-head" aria-labelledby={ids.name}>
            <span className="prof-ring"><span className="prof-avatar">{me ? <Avatar /> : <UserIcon />}</span></span>
            <div className="prof-who">
              <h2 id={ids.name} className="prof-name" dir="auto">{me ? me.displayName || me.name || t.profileYour : t.profileYour}</h2>
              <dl className="prof-stats">
                <Stat value={creations} label={t.statCreations(creations ?? 0)} />
                <Stat value={shares} label={t.statSharesCount(shares ?? 0)} />
                <Stat value={streak.days} label={t.statStreak} />
              </dl>
            </div>
            <div className="prof-actions">
              <button type="button" className="prof-btn soft" aria-haspopup="dialog" onClick={openPrefs}>{t.preferences}</button>
              <button type="button" className="prof-btn soft" onClick={() => navigate("settings")}>{t.settingsTitle}</button>
            </div>
          </section>
          {me && <NameCard active={active} />}

          <div className="prof-tabs" role="tablist" aria-label={t.profileTabs} ref={tabs} onKeyDown={onTabKey}>
            {([["creations", t.tabCreations, GridIcon], ["ayahs", t.tabSavedAyahs, BookmarkIcon]] as const).map(([key, label, Icon]) => (
              <button key={key} type="button" role="tab" id={ids[key]} data-tab={key} aria-selected={tab === key} aria-controls={ids.panel}
                tabIndex={tab === key ? 0 : -1} aria-label={label} title={label} onClick={() => setTab(key)}>
                <Icon />
              </button>
            ))}
          </div>
          <div className="prof-panel" role="tabpanel" id={ids.panel} aria-labelledby={ids[tab]}>
            {tab === "ayahs" ? <SavedAyahs active={active} /> : saved.loading ? (
              <ul className="prof-grid" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="prof-tile skeleton" />)}</ul>
            ) : saved.failed ? (
              <p className="prof-note">{t.savedFailed}</p>
            ) : saved.items.length === 0 ? (
              <div className="prof-empty">
                <span className="prof-empty-icon"><GridIcon /></span>
                <h2>{t.creationsEmptyTitle}</h2>
                <p>{t.savedEmptyText}</p>
                <button type="button" className="prof-btn primary" onClick={() => navigate("find")}>{t.startCreating}</button>
              </div>
            ) : (
              <ul className="prof-grid">
                {saved.items.map((i) => <Tile key={i.id} item={i} onOpen={() => setSheet(i)} />)}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          {!signedInOnDevice() && <JoinCard />}
          <div className="prof-actions prof-guest-actions">
            <button type="button" className="prof-btn soft" aria-haspopup="dialog" onClick={openPrefs}>{t.preferences}</button>
            <button type="button" className="prof-btn soft" onClick={() => navigate("settings")}>{t.settingsTitle}</button>
          </div>
        </>
      )}
      <MadeBy className="screen-credit" />

      <Sheet open={prefs} title={t.preferences} onClose={closeSheet} className="prof-prefs-sheet" done={t.done}>
        {prefsUsed && <PreferencesPanel active={active} />}
      </Sheet>
      <CreationSheet item={sheet} onClose={() => setSheet(null)} onDelete={saved.remove} />
      {saved.undo && (
        <div className="prof-snackbar" role="status">
          <span dir="auto">{t.deleted(saved.undo.title)}</span>
          <button type="button" onClick={saved.restore}>{t.undo}</button>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number | null; label: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null ? "–" : formatCount(value)}</dd>
    </div>
  );
}

function Tile({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const pct = useAgainProgress(item);
  const [kindLabel] = KIND[item.kind];
  return (
    <li className="prof-tile" data-kind={item.kind}>
      <button type="button" className="prof-tile-btn" aria-haspopup="dialog" onClick={onOpen}
        aria-label={t.creationOptions(t.savedLabel(item.title, kindLabel, savedDate(item.at)))}>
        <Thumb item={item} />
        <KindBadge kind={item.kind} />
        {pct !== null && <span className="prof-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>}
      </button>
    </li>
  );
}
