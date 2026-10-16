// Daily ayah: the ayah everyone sees on Home and gets in the reminder (owner, 12 Oct 2026). The app chooses it by itself
// two weeks ahead (apps/web src/discover.ts loadAyahOfTheDay, run here in the browser so the page shows the same ayah the
// app will); a day replaced here is stored by the API (daily_ayah) and wins. Days are the person's local date, as the app
// uses them; the counts are by UTC day.
import type { Topic } from "../../../../contracts/types";
import { loadAyahOfTheDay } from "../../../web/src/discover";
import { api, ayahTexts, surahNames } from "../api";
import { fmtFull, h, icon } from "../dom";
import { badge, card, pageHead, tiles, toast } from "../ui";

const DAYS = 14;
const TRANSLATION = "en.sahih";
const TEXT_MAX = 120;

/** Calendar days as the app reads them: the browser's local date, written YYYY-MM-DD. */
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const noon = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const label = (day: string, i: number) =>
  i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const start = (text: string) => {
  if (text.length <= TEXT_MAX) return text;
  const cut = text.slice(0, TEXT_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), TEXT_MAX / 2))}…`;
};
const count = (n: number | undefined) => (n === undefined ? "—" : fmtFull(n));

export async function daily(): Promise<HTMLElement> {
  const today = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)));
  const [data, names, texts, topics] = await Promise.all([
    api.daily(days[0], DAYS),
    surahNames(),
    ayahTexts(),
    fetch("/data/topics.json").then((r) => r.json() as Promise<{ topics: Topic[] }>).then((f) => f.topics, () => null),
  ]);

  const picks = new Map(data.picks.map((p) => [p.day, p.ref]));
  /** The app's own pick per day: "loading" while it is being worked out, "failed" when it could not be. */
  const auto = new Map<string, "loading" | "failed" | { ref: string; tr: string }>();
  let editing: string | null = null;
  const rows = new Map<string, HTMLTableRowElement>();

  function ensureAuto(day: string) {
    if (auto.has(day) || !topics) return;
    auto.set(day, "loading");
    loadAyahOfTheDay(topics, noon(day), TRANSLATION)
      .then((r) => auto.set(day, r ? { ref: r.ref, tr: r.tr } : "failed"), () => auto.set(day, "failed"))
      .then(() => { if (editing !== day) paintRow(day); });
  }

  function ayahCell(day: string): Node {
    const found = auto.get(day);
    const own = typeof found === "object" ? found : undefined;
    const ref = picks.get(day) ?? own?.ref;
    if (!ref) return h("span", { class: "muted" }, found === "loading" ? "Working it out…" : "Not available");
    const [surah] = ref.split(":");
    const text = texts[ref] ?? own?.tr ?? "";
    return h("div", null,
      h("b", null, ref), " ", h("span", { class: "muted" }, names.get(Number(surah))?.name_en ?? ""),
      text ? h("span", { class: "ayah-text" }, start(text)) : null);
  }

  function editor(day: string, i: number): HTMLElement {
    const input = h("input", { class: "field ref", type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "2:255", value: picks.get(day) ?? "", "aria-label": `Ayah reference for ${label(day, i)}, like 2:255`, required: true });
    const error = h("span", { class: "error-text", role: "alert" });
    const save = h("button", { class: "btn small primary", type: "submit" }, "Save");
    const form = h("form", { class: "inline-form" }, input, save,
      h("button", { class: "btn small", type: "button", onclick: () => { editing = null; paintRow(day); } }, "Cancel"), error);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ref = input.value.trim();
      if (!/^\d{1,3}:\d{1,3}$/.test(ref)) { error.textContent = "Enter a reference like 2:255."; input.focus(); return; }
      save.disabled = true;
      error.textContent = "";
      try {
        await api.setDaily(day, ref);
        picks.set(day, ref);
        editing = null;
        paintRow(day);
        toast(`${label(day, i)} is now ${ref}.`);
      } catch (err) {
        save.disabled = false;
        error.textContent = (err as Error).message;
        input.focus();
      }
    });
    queueMicrotask(() => input.focus());
    return form;
  }

  async function backToAuto(day: string, i: number) {
    try {
      await api.clearDaily(day);
      picks.delete(day);
      auto.delete(day);
      ensureAuto(day);
      paintRow(day);
      toast(`${label(day, i)} is back to the app's own pick.`);
    } catch (err) {
      toast(`Could not change ${label(day, i)}: ${(err as Error).message}`, true);
    }
  }

  function paintRow(day: string) {
    const i = days.indexOf(day);
    const row = rows.get(day)!;
    const mine = picks.has(day);
    row.replaceChildren(
      h("td", { "data-label": "Day" }, h("b", null, label(day, i))),
      h("td", { "data-label": "Ayah" }, ayahCell(day)),
      h("td", { "data-label": "Chosen" }, mine ? badge("By you", "good", "check") : badge("Auto", "neutral")),
      h("td", null, editing === day ? editor(day, i) : h("div", { class: "flags" },
        h("a", { class: "btn small", href: "/discover", target: "_blank", rel: "noopener noreferrer" }, "Preview", icon("external")),
        h("button", { class: "btn small", type: "button", onclick: () => { const was = editing; editing = day; if (was) paintRow(was); paintRow(day); } }, "Replace"),
        mine ? h("button", { class: "btn small ghost", type: "button", onclick: () => void backToAuto(day, i) }, "Back to auto") : null)));
  }

  for (const day of days) {
    rows.set(day, h("tr", null));
    if (!picks.has(day)) ensureAuto(day);
    paintRow(day);
  }

  const yesterday = data.stats.at(-2);
  const known = data.eventsEnabled;
  const week = data.stats.slice(0, 7).reverse(); // the 7 whole days before today, newest first

  return h("div", null,
    pageHead("Daily ayah"),
    h("p", { class: "card-sub intro" }, "The ayah everyone sees on Home and gets in the reminder. It is chosen automatically two weeks ahead; replace any day you like before it starts."),
    tiles(
      { label: "Reminders on", value: known && data.remindersOn !== null ? fmtFull(data.remindersOn) : "—", note: "devices" },
      { label: "Seen yesterday", value: known ? count(yesterday?.seen) : "—" },
      { label: "Opened from the reminder", value: known ? count(yesterday?.opened) : "—", note: "yesterday" },
      { label: "Shared yesterday", value: known ? count(yesterday?.shared) : "—" }),
    h("div", { class: "cards" },
      card("Coming up", `The next ${DAYS} days.`,
        h("div", { class: "table-wrap" }, h("table", { class: "data stack" },
          h("thead", null, h("tr", null, ...["Day", "Ayah", "Chosen", ""].map((t) => h("th", null, t)))),
          h("tbody", null, ...days.map((d) => rows.get(d)!))))),
      card("Last 7 days", null,
        h("div", { class: "table-wrap" }, h("table", { class: "data" },
          h("thead", null, h("tr", null, h("th", null, "Day"), ...["Seen", "Opened", "Shared"].map((t) => h("th", { class: "num" }, t)))),
          h("tbody", null, ...week.map((s) => h("tr", null,
            h("td", null, new Date(`${s.day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })),
            ...[s.seen, s.opened, s.shared].map((n) => h("td", { class: "num" }, known ? fmtFull(n) : "—"))))))),
        h("p", { class: "card-note" }, "Seen: today's ayah watched in the app. Opened: taps on the reminder. Shared: videos and images of that day's ayah. Days are counted in UTC."),
        known ? null : h("p", { class: "card-note" }, "The numbers appear as soon as the app sends its first events."))));
}
