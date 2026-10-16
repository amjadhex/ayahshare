// The app shell: one screen at a time, in the navigation's order (Bars.tsx). Phones: the screen, the bottom bar on the
// screens that have it, and bottom sheets. Tablets and computers: the side bar and the screen.
// Screens that hold work in progress stay mounted while hidden (the search results, the editor's preview and playback,
// the reels), so moving between tabs keeps them.
import { useEffect, useLayoutEffect, useRef, type JSX } from "react";
import { onRetap } from "../nav";
import { closeSheet, type View } from "../router";
import type { Store } from "../state";
import { t } from "../strings";
import { themeColour } from "../theme";
import { BottomNav, SideNav } from "./Bars";
import { ReportDialog, Toast } from "./Dialogs";
import { ExportPanel } from "./ExportPanel";
import { ExportProvider } from "./exportJob";
import { Feed } from "./Feed";
import { StoreContext, useLayout, useRoute, useStoriesPlaying } from "./hooks";
import { InstallSheet } from "./Install";
import { JoinSheet } from "./Join";
import { LanguageDialog } from "./Language";
import { ReflectSheet } from "./Reflect";
import { Sheet } from "./Sheet";
import { Activity } from "./screens/Activity";
import { Create } from "./screens/Create";
import { Credits } from "./screens/Credits";
import { Discover } from "./screens/Discover";
import { Home } from "./screens/Home";
import { Login } from "./screens/Login";
import { Picker } from "./screens/Picker";
import { ProfileScreen } from "./screens/ProfileScreen";
import { Results } from "./screens/Results";
import { Settings } from "./screens/Settings";
import { Share } from "./screens/Share";
import { Surahs } from "./screens/Surahs";

/** Screens with the bottom bar on phones, the picker (Create) among them (owner, 12 Oct 2026: the bar stays when + is
 *  tapped). The editor, Share and Settings are full screen. */
const WITH_NAV = new Set<View>(["find", "results", "discover", "feed", "profile", "activity", "surahs", "pick"]);

/** The page behind the status bar and Safari's floating toolbar: dark where the screen is (the editor and Share; Reels and the stories
 *  on phones), so no white band shows. Sets data-page on <html> (styles.css) and the browser's theme colour. */
const PAGE_COLOUR = { editor: "#0b0f0e", black: "#000000" } as const;
function setPageTone(tone: keyof typeof PAGE_COLOUR | null) {
  const root = document.documentElement;
  if (tone) root.dataset.page = tone; else delete root.dataset.page;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // The colour index.html gave it, for the other screens (index.html may already have darkened it for a deep link).
    meta.dataset.base ??= meta.dataset.html ?? meta.content;
    meta.content = tone ? PAGE_COLOUR[tone] : themeColour(meta.dataset.base);
  }
  nudgeBars();
}
/** Safari does not always look at the page again for its bar colours after a change of screen: the page colour's fixed
 *  edge strips (styles.css) change for a moment, which makes it look (now, and once more after the screen has settled). */
let nudgeTimer = 0;
export function nudgeBars() {
  const root = document.documentElement;
  root.dataset.pageNudge = "";
  clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(() => { delete root.dataset.pageNudge; }, 400);
}

export function App({ store }: { store: Store }) {
  return <StoreContext.Provider value={store}><Shell /></StoreContext.Provider>;
}

function Shell() {
  const layout = useLayout(), phone = layout === "phone";
  const route = useRoute(), view = route.view;
  const on = (v: View) => view === v;
  const stories = useStoriesPlaying();
  const tone = view === "create" || view === "share" ? "editor" : phone && (view === "feed" || (view === "discover" && stories)) ? "black" : null;
  // Before the screen paints, on every change of screen (not only of tone), and when Reels is tapped again.
  useLayoutEffect(() => { setPageTone(tone); }, [tone, view]);
  useEffect(() => onRetap(() => nudgeBars()), []);

  // The screens share the page's scroll: each screen keeps its own place (back to Results finds the same row), and a
  // screen opened for the first time starts at the top.
  const scrolls = useRef(new Map<View, number>());
  const shown = useRef(view);
  useLayoutEffect(() => {
    if (shown.current === view) return;
    scrolls.current.set(shown.current, window.scrollY);
    shown.current = view;
    window.scrollTo(0, scrolls.current.get(view) ?? 0);
  }, [view]);
  const screen = (v: View, label: string, body: JSX.Element) => (
    <section key={v} className="screen" data-screen={v} aria-label={label} hidden={!on(v)}>{body}</section>
  );

  return (
    <ExportProvider phone={phone}>
      <div className="app" data-layout={layout} data-view={view} data-sheet={route.sheet ?? undefined}>
        {!phone && <SideNav view={view} />}
        <main className="screens">
          {screen("find", t.navHome, <Home active={on("find")} />)}
          {screen("results", t.results, <Results active={on("results")} />)}
          {screen("pick", t.navCreate, <Picker active={on("pick")} />)}
          {screen("create", t.navCreate, <Create active={on("create")} phone={phone} />)}
          {screen("share", t.shareTitle, <Share active={on("share")} />)}
          {screen("discover", t.discoverTitle, <Discover active={on("discover")} />)}
          {screen("feed", t.feedLabel, <Feed active={on("feed")} />)}
          {screen("profile", t.profileTitle, <ProfileScreen active={on("profile")} />)}
          {screen("activity", t.navActivity, <Activity active={on("activity")} />)}
          {screen("settings", t.settingsTitle, <Settings active={on("settings")} />)}
          {screen("credits", t.creditsTitle, <Credits active={on("credits")} />)}
          {screen("surahs", t.allSurahs, <Surahs active={on("surahs")} />)}
          {screen("login", t.joinTitle, <Login active={on("login")} />)}
        </main>
        {phone && WITH_NAV.has(view) && <BottomNav view={view} dark={tone === "black"} />}
        <Sheet open={route.sheet === "export"} title={t.export} onClose={closeSheet} className="export-sheet">
          <ExportPanel variant="sheet" />
        </Sheet>
        <ReflectSheet />
        <LanguageDialog />
        <JoinSheet />
        <InstallSheet />
        <ReportDialog />
        <Toast />
      </div>
    </ExportProvider>
  );
}
