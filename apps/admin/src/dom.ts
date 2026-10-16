// Tiny DOM helpers. Everything from the API goes in through textContent / attributes, never innerHTML.

export type Child = Node | string | number | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | null | undefined>;

function apply(el: Element, props: Props | null, children: Child[]): void {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.setAttribute("class", String(v));
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
}

/** Creates an HTML element: h("div", { class: "card" }, "text", child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, props ?? null, children);
  return el;
}

/** Creates an SVG element. */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  apply(el, props ?? null, children);
  return el;
}

/** Replaces the children of `el`. */
export function mount(el: Element, ...children: Child[]): void {
  el.replaceChildren(...children.flatMap((c) => (c === null || c === undefined || c === false ? [] : [c instanceof Node ? c : String(c)])));
}

// --- icons (24x24 stroke icons) ---------------------------------------------------------------------------------------

const ICONS = {
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18M6 6l12 12"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  "eye-off": ["M17.9 17.9A10 10 0 0 1 12 19c-7 0-10-7-10-7a18 18 0 0 1 5-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 10 7 10 7a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"],
  refresh: ["M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"],
  alert: ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01"],
  external: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"],
  dot: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  table: ["M3 5h18v14H3zM3 10h18M3 15h18M9 5v14"],
  chart: ["M3 3v18h18M7 15l4-5 3 3 5-7"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"],
  book: ["M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z", "M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"],
} as const;
export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  return s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "icon" }, ...ICONS[name].map((d) => s("path", { d })));
}

// --- formatting -------------------------------------------------------------------------------------------------------

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");

/** 1,284 below 10,000; 12.9K / 4.2M above. */
export const fmt = (n: number): string => (Math.abs(n) >= 10_000 ? compact.format(n) : whole.format(Math.round(n * 100) / 100));
/** 1,284 always. */
export const fmtFull = (n: number): string => whole.format(n);
export const pct = (part: number, total: number, digits = 0): string => (total > 0 ? `${((part / total) * 100).toFixed(digits)}%` : "–");
export const usd = (n: number): string => `$${n < 0.1 ? n.toFixed(4) : n.toFixed(2)}`;
export const seconds = (ms: number | null): string => (ms === null ? "–" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const DAY_MS = 86400_000;
export const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const dayLabel = (ms: number): string => new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
export const dayLong = (ms: number): string => new Date(ms).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const dateTime = (ms: number): string => new Date(ms).toLocaleString("en", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "3 min ago", "2 days ago", then the date. */
export function ago(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < DAY_MS) return `${Math.floor(d / 3600_000)} h ago`;
  if (d < 30 * DAY_MS) return `${Math.floor(d / DAY_MS)} d ago`;
  return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

const regions = new Intl.DisplayNames("en", { type: "region" });
/** "IN" -> "India"; "" -> "Unknown". */
export function country(code: string): string {
  if (!code) return "Unknown";
  try { return regions.of(code.toUpperCase()) ?? code; } catch { return code; }
}
