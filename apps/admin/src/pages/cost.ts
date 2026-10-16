// AI cost: calls and spend per day against the daily cap. The cap switches AI search off for the rest of the day.
import { api } from "../api";
import { dayKey, dayMs, fmt, fmtFull, h, pct, usd } from "../dom";
import type { Point } from "../charts";
import { chartCard, DAY_CHOICES, daysOf, meter, pageHead, segmented, tiles } from "../ui";

export async function cost(q: URLSearchParams): Promise<HTMLElement> {
  const days = daysOf(q);
  const l = await api.luna(days);

  // One point per day in the window, zero where nothing was spent (the table only has days with calls).
  const byDay = new Map(l.days.map((d) => [d.day, d]));
  const today = dayMs(dayKey(Date.now()));
  const range = Array.from({ length: days }, (_, i) => today - (days - 1 - i) * 86400_000);
  const series = (pick: (d: (typeof l.days)[number]) => number): Point[] => range.map((x) => ({ x, y: pick(byDay.get(dayKey(x)) ?? { day: "", calls: 0, input_tokens: 0, cost_usd: 0 }) }));

  const spend = l.days.reduce((a, d) => a + d.cost_usd, 0);
  const calls = l.days.reduce((a, d) => a + d.calls, 0);
  const todayRow = byDay.get(dayKey(Date.now()));
  const todaySpend = todayRow?.cost_usd ?? 0;
  const peak = Math.max(0, ...l.days.map((d) => d.cost_usd));
  const frac = l.capUsd > 0 ? todaySpend / l.capUsd : 0;

  return h("div", null,
    pageHead("AI cost", segmented("Time window", DAY_CHOICES, String(days), (v) => `#/cost?days=${v}`)),
    tiles(
      h("div", { class: "tile" },
        h("span", { class: "tile-label" }, "Spent today"), h("span", { class: "tile-value" }, usd(todaySpend)),
        h("span", { class: "tile-note" }, `${pct(todaySpend, l.capUsd, 1)} of the ${usd(l.capUsd)} daily cap`), meter(frac, "Today's spend against the daily cap")),
      { label: `Spent, ${days} days`, value: usd(spend), note: `Highest day ${usd(peak)}` },
      { label: `AI calls, ${days} days`, value: fmtFull(calls), note: `${fmt(Math.round(calls / days))} a day on average` },
      { label: "Answered from saved answers", value: fmtFull(l.cache.hits), note: `${fmtFull(l.cache.rows)} questions saved; a repeat needs no AI call` }),
    h("div", { class: "cards two" },
      chartCard("Spend per day", `US dollars, last ${days} days. The daily cap is ${usd(l.capUsd)}.`, {
        kind: "column", series: [{ name: "Spend", color: "var(--s1)", points: series((d) => d.cost_usd) }], unit: "US dollars", format: usd, tick: (n) => `$${+n.toFixed(4)}`, label: "AI spend per day",
      }),
      chartCard("AI calls per day", `Calls to the AI service, last ${days} days`, {
        kind: "column", series: [{ name: "Calls", color: "var(--s1)", points: series((d) => d.calls) }], unit: "Calls", format: fmt, integer: true, label: "AI calls per day",
      }))
  );
}
