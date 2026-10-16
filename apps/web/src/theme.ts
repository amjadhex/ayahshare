// Appearance (owner, 9 Oct 2026): System · Light · Dark. A device preference (localStorage "qd.theme", prefs.ts), not
// the account's. The page follows it through <html data-theme> (styles.css and the screens' CSS have both themes; system =
// no attribute, so prefers-color-scheme decides) and the browser's theme colour. index.html reads the stored value before
// the CSS loads, so the first paint is already right. Framework-free; ui/hooks.ts has useTheme.
import { storedTheme, storeTheme, type Theme } from "./prefs";

/** The browser's theme colour on the light and dark theme (index.html's two meta tags). */
const THEME_COLOUR = { light: "#ffffff", dark: "#0b0f0e" } as const;

let current: Theme = "system";
const listeners = new Set<() => void>();

export const getTheme = () => current;
export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The theme the page shows: the one chosen, else the system's. */
export const resolveTheme = (theme: Theme, systemDark: boolean): "light" | "dark" => (theme === "system" ? (systemDark ? "dark" : "light") : theme);
export const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

/** The browser's theme colour for a screen with no colour of its own: the chosen theme's, else `base` (index.html's, which
 *  follows the system through the meta tag's media query). ui/App.tsx setPageTone uses it. */
export function themeColour(base: string): string {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "light" || chosen === "dark" ? THEME_COLOUR[chosen] : base;
}

/** Shows `theme` now: html data-theme (removed for the system's) and the theme colour, unless a dark screen holds it. */
export function applyTheme(theme: Theme) {
  current = theme;
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme; else root.dataset.theme = theme;
  if (!root.dataset.page) {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.dataset.base ??= meta.dataset.html ?? meta.content;
      meta.content = themeColour(meta.dataset.base);
    }
  }
  for (const fn of [...listeners]) fn();
}

/** At start: the stored choice. */
export const initTheme = () => applyTheme(storedTheme());

/** The person's choice: kept on the device and shown at once. */
export function setTheme(theme: Theme) {
  storeTheme(theme);
  applyTheme(theme);
}
