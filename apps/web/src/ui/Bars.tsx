// Navigation in Instagram's order, so it feels familiar: Home · Reels · Create · Discover (a compass: a place to explore, not
// search; owner, 12 Oct 2026) · Profile. Phones: the bottom
// bar (on the screens that have it). Tablets and computers: a side bar (icons; icons and labels on wide screens).
import type { JSX } from "react";
import { openPicker, retapTab } from "../nav";
import { navigate, type View } from "../router";
import { platform } from "../platform";
import { t } from "../strings";
import { useAppState } from "./hooks";
import { MadeBy } from "./MadeBy";
import { CompassIcon, HomeIcon, PlusSquareIcon, ReelsIcon, UserIcon } from "./icons";

type Tab = "find" | "discover" | "create" | "feed" | "profile";

/** Which tab a screen belongs to (Results and Activity are part of Home; Settings and Credits of Profile). */
const TAB_OF: Record<View, Tab> = {
  find: "find", results: "find", activity: "find", discover: "discover", surahs: "discover", pick: "create", create: "create", share: "create",
  feed: "feed", profile: "profile", settings: "profile", credits: "profile", login: "profile",
};

const TABS: [Tab, string, () => JSX.Element][] = [
  ["find", t.navHome, HomeIcon], ["feed", t.navReels, ReelsIcon], ["create", t.navCreate, PlusSquareIcon],
  ["discover", t.navDiscover, CompassIcon], ["profile", t.navProfile, UserIcon],
];

function go(tab: Tab) {
  platform.haptic();
  if (tab === "create") openPicker();
  else navigate(tab);
}

function NavButtons({ view }: { view: View }) {
  const current = TAB_OF[view];
  return (
    <>
      {TABS.map(([id, label, Icon]) => (
        <button key={id} type="button" className={`nav-btn nav-${id}`} aria-label={label} aria-current={current === id ? "page" : undefined}
          onClick={() => { if (current === id) retapTab(id); go(id); }}>
          <Icon /><span className="nav-label">{label}</span>
        </button>
      ))}
    </>
  );
}

/** `dark`: over a black screen (Reels, the stories). */
export function BottomNav({ view, dark = view === "feed" }: { view: View; dark?: boolean }) {
  return <nav className="bottombar" data-dark={dark ? "" : undefined} aria-label={t.navLabel}><NavButtons view={view} /></nav>;
}

export function SideNav({ view }: { view: View }) {
  const { config } = useAppState();
  return (
    <nav className="sidenav" aria-label={t.navLabel}>
      <button type="button" className="sidenav-brand" aria-label={config.appName} onClick={() => go("find")}>
        <img className="brand-mark" src="/icons/icon.svg" alt="" />
        <span className="brand-name">{config.appName}</span>
      </button>
      <NavButtons view={view} />
      <MadeBy className="sidenav-credit" />
    </nav>
  );
}
