// React bindings for the framework-free store, router and layout.
import { createContext, useContext, useSyncExternalStore } from "react";
import { getPickStart, getQuery, getSearch, getStoriesPlaying, subscribeNav } from "../nav";
import { getRoute, subscribe as subscribeRoute } from "../router";
import { getStreak, subscribeStreak } from "../streak";
import { getTheme, subscribeTheme } from "../theme";
import type { AppState, Store } from "../state";

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("no store");
  return store;
}

/** The whole app state; the component re-renders on every change (the app is small). */
export function useAppState(): AppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export const useRoute = () => useSyncExternalStore(subscribeRoute, getRoute);
/** The search the Results screen shows, and where the ayah picker starts (nav.ts). */
export const useSearchQuery = () => useSyncExternalStore(subscribeNav, getQuery);
export const useSearch = () => useSyncExternalStore(subscribeNav, getSearch);
export const usePickStart = () => useSyncExternalStore(subscribeNav, getPickStart);
export const useStoriesPlaying = () => useSyncExternalStore(subscribeNav, getStoriesPlaying);
/** The appearance choice (theme.ts). */
export const useTheme = () => useSyncExternalStore(subscribeTheme, getTheme);
/** The private streak (streak.ts). */
export const useStreak = () => useSyncExternalStore(subscribeStreak, getStreak);

export type Layout = "phone" | "tablet" | "desktop";
const PHONE = "(max-width: 759px)";
const DESKTOP = "(min-width: 1180px)";

function subscribeLayout(fn: () => void) {
  const queries = [matchMedia(PHONE), matchMedia(DESKTOP)];
  for (const q of queries) q.addEventListener("change", fn);
  return () => queries.forEach((q) => q.removeEventListener("change", fn));
}
const layoutNow = (): Layout => (matchMedia(PHONE).matches ? "phone" : matchMedia(DESKTOP).matches ? "desktop" : "tablet");

/** Phone (< 760 px): app shell with screens and sheets. Tablet: two columns. Desktop (≥ 1180 px): three columns. */
export const useLayout = () => useSyncExternalStore(subscribeLayout, layoutNow);

/** Touch screens (share sheets need a fresh tap there). */
export const coarsePointer = () => matchMedia("(pointer: coarse)").matches;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
