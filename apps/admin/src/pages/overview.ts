// Overview: who is using the app (D1, always available) and what they do (events, when enabled).
import type { AdminOverview, Count } from "../../../api/src/admin-contract";
import { api } from "../api";
import { barList, type Point, type Series } from "../charts";
import { country, dayMs, fmt, fmtFull, h, pct, seconds } from "../dom";
import { topic } from "./users";
import { announceOpenReports, card, chartCard, DAY_CHOICES, daysOf, eventsNotice, NEEDS_EVENTS, pageHead, placeholder, segmented, tiles } from "../ui";

const points = (rows: { day: string; value: number }[] | undefined): Point[] => (rows ?? []).map((r) => ({ x: dayMs(r.day), y: r.value }));

export async function overview(q: URLSearchParams): Promise<HTMLElement> {
  const days = daysOf(q);
  const o = await api.overview(days);
  announceOpenReports(o.reports.open);
  const span = `Last ${o.days} days`;
  const events = o.eventsEnabled;

  // Active devices per day: distinct devices that opened the app (events) when counted, else the nightly D1 approximation.
  const opens = o.daily["funnel:open"];
  const active = opens ?? o.daily.devices_active;
  const series: Series[] = [
    { name: "Active devices", color: "var(--s1)", points: points(active) },
    { name: "New devices", color: "var(--s2)", points: points(o.daily.devices_new) },
  ];
  const sparkValues = (active ?? []).map((r) => r.value);

  const d = o.devices;
  return h("div", null,
    pageHead("Overview", segmented("Time window", DAY_CHOICES, String(o.days), (v) => `#/overview?days=${v}`)),
    events ? null : eventsNotice("devices, accounts, shares, reports and AI cost"),
    h("h2", { class: "section-title" }, "People"),
    tiles(
      { label: "Active in 24 hours", value: fmtFull(d.dau), note: `${fmtFull(d.total)} devices in total`, values: sparkValues },
      { label: "Active in 7 days", value: fmtFull(d.wau), note: d.mau ? `${pct(d.wau, d.mau)} of the 30-day number` : undefined },
      { label: "Active in 30 days", value: fmtFull(d.mau) },
      { label: "New devices, 7 days", value: fmtFull(d.new7), note: `${fmtFull(d.new1)} in 24 hours · ${fmtFull(d.new30)} in 30 days` },
    ),
    h("div", { style: "height:12px" }),
    tiles(
      { label: "Signed-in accounts", value: fmtFull(o.users.total), note: `${fmtFull(o.users.new7)} new in 7 days`, href: "#/users" },
      { label: "Signed-in and active, 30 days", value: fmtFull(o.users.active30), note: o.users.total ? `${pct(o.users.active30, o.users.total)} of accounts` : undefined },
      { label: "Share links", value: fmtFull(o.shares.total), note: `${fmtFull(o.shares.new7)} new in 7 days · ${fmtFull(o.shares.opens)} opens` },
      { label: "Open reports", value: fmtFull(o.reports.open), note: o.reports.open ? "Needs a decision" : "Nothing waiting", href: "#/reports" },
    ),
    h("div", { class: "cards" },
      chartCard("Devices per day", "Devices that used the app each day, and devices seen for the first time", {
        kind: "line", series, unit: "Devices", format: fmt, integer: true, label: "Active and new devices per day",
      }, active ? (opens ? undefined : "No app opens were counted in this window, so active devices are an approximation from the last-seen time of each device.")
        : "History fills in from the nightly summary, one point per day.")),
    h("h2", { class: "section-title" }, "What people do"),
    h("div", { class: "cards two" }, funnel(o, span), exportsCard(o, span)),
    h("div", { class: "cards" },
      card("Everything people do", `${span}, events counted`, o.events ? barList(o.events.map((e) => ({ label: eventName(e.key), value: e.n })), "events") : placeholder(NEEDS_EVENTS))),
    h("h2", { class: "section-title" }, "Where from"),
    h("div", { class: "cards three" },
      card("Countries", `${span}, devices`, list(o.countries, "devices", (c) => country(c.key))),
      card("Operating systems", `${span}, devices`, list(o.platforms, "devices", (c) => osName(c.key))),
      card("Device types", `${span}, app opens`, o.devicesByType ? list(o.devicesByType, "app opens", (c) => titleCase(c.key || "unknown")) : placeholder(NEEDS_EVENTS))),
    h("div", { class: "cards two" },
      card("App or website", `${span}, devices. App devices are told apart from 12 October, as each opens the app again`,
        list(appOrWeb(o.platforms), "devices", (c) => c.key)),
      card("Browsers", `${span}, app opens`, o.browsers ? list(o.browsers, "app opens", (c) => (c.key === "app" ? "AyahShare app" : c.key || "Unknown")) : placeholder(NEEDS_EVENTS))),
    h("h2", { class: "section-title" }, "Profiles"),
    h("div", { class: "cards two" },
      card("Interests", "Topics signed-in people picked on their profile, all time", list(o.interests ?? [], "accounts", (c) => topic(c.key))),
      card("Account countries", "The country people chose on their profile, all time", list(o.accountCountries ?? [], "accounts", (c) => country(c.key)))),
  );
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const OS: Record<string, string> = { ios: "iOS", macos: "macOS", mac: "macOS", android: "Android", windows: "Windows", linux: "Linux", other: "Other" };
/** "android-app" is the Android app (src/lib/ua.ts in apps/api); the OS alone is the website on that OS. */
const osName = (k: string) => {
  const app = k.endsWith("-app"), os = app ? k.slice(0, -4) : k;
  const name = OS[os.toLowerCase()] ?? (os ? titleCase(os) : "Unknown");
  return app ? `${name} app` : name;
};
/** Devices per platform folded into the app and the website. */
const appOrWeb = (platforms: Count[]): Count[] => {
  const app = platforms.filter((c) => c.key.endsWith("-app")).reduce((n, c) => n + c.n, 0);
  const web = platforms.reduce((n, c) => n + c.n, 0) - app;
  return [{ key: "App", n: app }, { key: "Website", n: web }].sort((a, b) => b.n - a.n);
};
const EVENT_NAMES: Record<string, string> = {
  app_open: "App opened", search: "Search", search_click: "Search result clicked", ayah_select: "Ayah selected", bg_select: "Background chosen",
  customise: "Setting changed", preview_play: "Preview played", export_start: "Export started", export_done: "Export finished",
  export_failed: "Export failed", share_native: "Shared with the share sheet", link_copy: "Link copied", share_open: "Share link opened",
  sign_in: "Signed in", creation_save: "Creation saved", report: "Report sent", error: "Error",
};
const eventName = (k: string) => EVENT_NAMES[k] ?? k;

function list(rows: Count[], unit: string, label: (c: Count) => string): HTMLElement {
  return rows.length ? barList(rows.slice(0, 10).map((c) => ({ label: label(c), value: c.n })), unit) : placeholder("Nothing recorded yet");
}

/** Distinct devices that opened the app, picked an ayah and finished an export. One ordinal ramp, since the stages are ordered. */
function funnel(o: AdminOverview, span: string): HTMLElement {
  if (!o.funnel) return card("From opening to export", `${span}, devices at each step`, placeholder(NEEDS_EVENTS));
  const f = o.funnel;
  if (!f.open) return card("From opening to export", `${span}, devices at each step`, placeholder("No visits recorded in this window"));
  const steps: [string, number, string][] = [["Opened the app", f.open, "var(--ord1)"], ["Selected an ayah", f.ayah, "var(--ord2)"], ["Finished an export", f.export, "var(--ord3)"]];
  const note = (i: number) => (i === 0 ? undefined : i === 1 ? `${pct(f.ayah, f.open)} of openers` : `${pct(f.export, f.open)} of openers · ${pct(f.export, f.ayah)} of ayah pickers`);
  return card("From opening to export", `${span}, devices at each step`,
    h("div", { class: "funnel" }, barList(steps.map(([label, value, color], i) => ({ label, value, color, note: note(i) })), "devices", fmtFull)));
}

function exportsCard(o: AdminOverview, span: string): HTMLElement {
  if (!o.exports) return card("Exports", `${span}, finished and failed`, placeholder(NEEDS_EVENTS));
  const rows = [["Video", o.exports.video], ["Image", o.exports.image]] as const;
  const done = rows.reduce((a, [, r]) => a + r.done, 0), failed = rows.reduce((a, [, r]) => a + r.failed, 0);
  if (!done && !failed) return card("Exports", `${span}, finished and failed`, placeholder("No exports in this window"));
  return card("Exports", `${span}: ${fmtFull(done)} finished, ${pct(done, done + failed)} success rate`,
    barList(rows.map(([label, r]) => ({ label, value: r.done })), "exports finished"),
    h("div", { class: "table-wrap", style: "margin-top:12px" }, h("table", { class: "data" },
      h("thead", null, h("tr", null, h("th", null, "Kind"), h("th", { class: "num" }, "Finished"), h("th", { class: "num" }, "Failed"), h("th", { class: "num" }, "Success"), h("th", { class: "num" }, "Avg time"))),
      h("tbody", null, ...rows.map(([label, r]) => h("tr", null,
        h("td", null, label), h("td", { class: "num" }, fmtFull(r.done)), h("td", { class: "num" }, fmtFull(r.failed)),
        h("td", { class: "num" }, pct(r.done, r.done + r.failed)), h("td", { class: "num" }, seconds(r.avgMs))))))));
}
