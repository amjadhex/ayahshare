// Shared page pieces: cards, chart cards with a table twin, stat tiles, meters, badges, notices, segmented controls, toasts.
import { sparkline, timeChart, timeTable, type Series, type TimeChartOptions } from "./charts";
import { h, icon, type Child, type IconName } from "./dom";

export function card(title: string, subtitle: string | null, ...body: Child[]): HTMLElement {
  return h("section", { class: "card" },
    h("header", { class: "card-head" }, h("div", null, h("h2", { class: "card-title" }, title), subtitle ? h("p", { class: "card-sub" }, subtitle) : null)),
    ...body);
}

/** A card holding a time chart, with a chart/table switch and a legend when there are two or more series. */
export function chartCard(title: string, subtitle: string, o: TimeChartOptions, note?: string): HTMLElement {
  const body = h("div", { class: "card-body" });
  let tableView = false;
  // A line needs two days to be a line; with fewer, say so instead of drawing a lone dot.
  const dayCount = new Set(o.series.flatMap((x) => x.points.map((p) => p.x))).size;
  const sparse = o.kind === "line" && dayCount < 2;
  const chart = sparse
    ? placeholder(`The chart appears once two days are recorded (the nightly summary adds one a day). Recorded so far: ${dayCount}.`)
    : timeChart(o);
  const toggle = h("button", { class: "btn small", type: "button", "aria-pressed": "false" }, icon("table"), h("span", null, "Table"));
  const paint = () => {
    toggle.setAttribute("aria-pressed", String(tableView));
    toggle.replaceChildren(icon(tableView ? "chart" : "table"), h("span", null, tableView ? "Chart" : "Table"));
    body.replaceChildren(tableView ? timeTable(o.series, o.format) : chart);
  };
  toggle.addEventListener("click", () => { tableView = !tableView; paint(); });
  paint();
  const legend = o.series.length > 1 && !sparse
    ? h("ul", { class: "legend" }, ...o.series.map((x: Series) => h("li", null, h("i", { class: o.kind === "line" ? "key-line" : "key-box", style: `background:${x.color}` }), x.name)))
    : null;
  const hasData = !sparse && o.series.some((x) => x.points.length);
  return h("section", { class: "card" },
    h("header", { class: "card-head" },
      h("div", null, h("h2", { class: "card-title" }, title), h("p", { class: "card-sub" }, subtitle)),
      hasData ? toggle : null),
    legend, body, note ? h("p", { class: "card-note" }, note) : null);
}

export interface Tile { label: string; value: string; note?: string; values?: number[]; href?: string }

export function statTile(t: Tile): HTMLElement {
  const spark = t.values ? sparkline(t.values) : null;
  const inner = [h("span", { class: "tile-label" }, t.label), h("span", { class: "tile-value" }, t.value),
    t.note ? h("span", { class: "tile-note" }, t.note) : null, spark];
  return t.href ? h("a", { class: "tile link", href: t.href }, ...inner) : h("div", { class: "tile" }, ...inner);
}

export const tiles = (...t: (Tile | HTMLElement)[]): HTMLElement => h("div", { class: "tiles" }, ...t.map((x) => (x instanceof HTMLElement ? x : statTile(x))));

/** A filled track for a ratio against a limit; the fill turns warning / critical near and past the limit. */
export function meter(fraction: number, label: string): HTMLElement {
  const tone = fraction >= 1 ? "crit" : fraction >= 0.8 ? "warn" : "ok";
  return h("div", { class: `meter ${tone}`, role: "meter", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(fraction * 100) },
    h("span", { style: `width:${Math.max(fraction > 0 ? 1 : 0, Math.min(100, fraction * 100))}%` }));
}

export type Tone = "good" | "warn" | "serious" | "crit" | "neutral";
/** Status chip: colour plus an icon and a word, never colour alone. */
export function badge(text: string, tone: Tone, name?: IconName): HTMLElement {
  const glyph: IconName = name ?? (tone === "good" ? "check" : tone === "neutral" ? "dot" : tone === "crit" ? "x" : "alert");
  return h("span", { class: `badge ${tone}` }, icon(glyph), text);
}

export function notice(title: string, body: string, name: IconName = "info"): HTMLElement {
  return h("div", { class: "notice", role: "note" }, icon(name), h("div", null, h("strong", null, title), h("p", null, body)));
}

/** Shown in place of a chart that needs app events while none are counted yet. */
export const NEEDS_EVENTS = "No app events counted yet. This fills in as soon as the app sends its first events.";
export const placeholder = (text: string): HTMLElement => h("p", { class: "empty" }, text);

/** Banner explaining why event-based numbers are missing. */
export function eventsNotice(kept: string): HTMLElement {
  return notice(
    "No app events counted yet",
    "Exports, the funnel, searches, top ayahs and the backgrounds people pick come from app events. They appear as soon as the app " +
    `sends its first events. Until then this page shows what the database already keeps: ${kept}.`,
  );
}

export interface Choice { value: string; label: string; count?: number }
/** Segmented control as links (the choice lives in the URL hash). */
export function segmented(label: string, choices: Choice[], current: string, href: (value: string) => string): HTMLElement {
  return h("nav", { class: "segmented", "aria-label": label },
    ...choices.map((c) => h("a", { href: href(c.value), "aria-current": c.value === current ? "true" : null },
      c.label, c.count !== undefined ? h("span", { class: "seg-count" }, String(c.count)) : null)));
}
/** Segmented control as buttons. */
export function segmentedButtons(label: string, choices: Choice[], current: string, pick: (value: string) => void): HTMLElement {
  return h("div", { class: "segmented", role: "group", "aria-label": label },
    ...choices.map((c) => h("button", { type: "button", "aria-pressed": String(c.value === current), onclick: () => pick(c.value) },
      c.label, c.count !== undefined ? h("span", { class: "seg-count" }, String(c.count)) : null)));
}

export const DAY_CHOICES: Choice[] = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];
/** The time window from the URL (7, 30 or 90 days; 30 when missing or odd). */
export const daysOf = (q: URLSearchParams): number => [7, 30, 90].find((d) => d === Number(q.get("days"))) ?? 30;

export function toast(message: string, error = false): void {
  const el = h("div", { class: `toast${error ? " error" : ""}` }, icon(error ? "alert" : "check"), message);
  document.getElementById("toasts")?.append(el);
  setTimeout(() => el.remove(), error ? 6000 : 3000);
}

/** Page title row: heading on the left, controls (days filter, refresh) on the right. */
export function pageHead(title: string, ...controls: Child[]): HTMLElement {
  return h("div", { class: "page-head" }, h("h1", null, title), h("div", { class: "page-controls" }, ...controls));
}

/** The top bar shows how many reports are open; pages that learn the number tell it. */
export const OPEN_REPORTS = "open-reports";
export const announceOpenReports = (n: number): void => { document.dispatchEvent(new CustomEvent<number>(OPEN_REPORTS, { detail: n })); };
