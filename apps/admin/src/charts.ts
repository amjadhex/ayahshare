// Small hand-rolled charts: time series (line / column), sparkline and horizontal bar lists, plus the shared tooltip.
// Marks: 2px lines, columns <= 24px with a 4px rounded top, hairline solid grid, a 2px surface ring on dots. Colours come from
// CSS tokens (--s1, --s2, ...), so light and dark follow the page. Tooltips show on hover and (time charts) on keyboard focus;
// every value is also in the page text or the table view.
import { dayLabel, dayLong, fmt, h, s, type Child } from "./dom";

// --- tooltip ----------------------------------------------------------------------------------------------------------

export interface TipContent { title?: string; rows: { label: string; value: string; color?: string }[] }

let tipEl: HTMLDivElement | undefined;

export function showTip(c: TipContent, x: number, y: number): void {
  if (!tipEl) {
    tipEl = h("div", { class: "tooltip", role: "tooltip" });
    document.body.append(tipEl);
  }
  tipEl.replaceChildren(
    ...(c.title ? [h("div", { class: "tip-title" }, c.title)] : []),
    ...c.rows.map((r) =>
      h("div", { class: "tip-row" },
        r.color ? h("i", { class: "tip-key", style: `background:${r.color}` }) : null,
        h("strong", null, r.value), h("span", null, r.label))),
  );
  tipEl.hidden = false;
  const { width, height } = tipEl.getBoundingClientRect();
  const left = x + 14 + width > innerWidth - 8 ? x - width - 14 : x + 14;
  const top = y + 14 + height > innerHeight - 8 ? y - height - 14 : y + 14;
  tipEl.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
}

export function hideTip(): void {
  if (tipEl) tipEl.hidden = true;
}

/** Shows `build()` while the pointer is over `el`. */
function hoverTip(el: Element, build: () => TipContent): void {
  const move = (e: Event) => { const p = e as PointerEvent; showTip(build(), p.clientX, p.clientY); };
  el.addEventListener("pointerenter", move);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerleave", hideTip);
}

// --- time series ------------------------------------------------------------------------------------------------------

const DAY = 86400_000;
export interface Point { x: number; y: number }   // x = unix ms (UTC midnight of the day)
export interface Series { name: string; color: string; points: Point[] }
export interface TimeChartOptions {
  kind: "line" | "column";
  series: Series[];
  /** Y axis title, e.g. "Devices". */
  unit: string;
  /** Value format for tooltips and end labels. */
  format: (n: number) => string;
  /** Format for the y axis ticks (default: format). */
  tick?: (n: number) => string;
  /** Counts: ticks are whole numbers. */
  integer?: boolean;
  /** Accessible name. */
  label: string;
  height?: number;
}

const M = { t: 28, r: 14, b: 26, l: 48 };

/** "Nice" tick values from 0 up to or just above `max`. */
function niceTicks(max: number, integer: boolean, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)) ?? raw;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) { ticks.push(Math.round(v * 1e9) / 1e9); if (v >= max) break; }
  return ticks;
}

export function timeChart(o: TimeChartOptions): HTMLElement {
  const root = h("div", { class: "chart" });
  const xs = [...new Set(o.series.flatMap((x) => x.points.map((p) => p.x)))].sort((a, b) => a - b);
  if (!xs.length) return h("div", { class: "empty" }, "No data yet");
  const H = o.height ?? 220;
  const column = o.kind === "column";
  let current = -1;                                        // index into xs shown by the crosshair / highlight
  let draw = () => {};

  const render = (W: number) => {
    const plotW = Math.max(40, W - M.l - M.r);
    const plotH = H - M.t - M.b;
    const days = (xs[xs.length - 1] - xs[0]) / DAY + 1;
    // Columns get half a day of room each side; a single line point sits in the middle.
    const x0 = column ? xs[0] - DAY / 2 : xs.length > 1 ? xs[0] : xs[0] - DAY;
    const x1 = column ? xs[xs.length - 1] + DAY / 2 : xs.length > 1 ? xs[xs.length - 1] : xs[0] + DAY;
    const X = (x: number) => M.l + ((x - x0) / (x1 - x0)) * plotW;
    const ticks = niceTicks(Math.max(...o.series.flatMap((x) => x.points.map((p) => p.y))), !!o.integer);
    const top = ticks[ticks.length - 1];
    const Y = (y: number) => M.t + plotH - (y / top) * plotH;
    const base = Y(0);

    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": o.label, tabindex: 0, class: "plot" });
    // grid + y ticks
    for (const t of ticks) {
      svg.append(s("line", { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t), class: t === 0 ? "axis" : "gridline" }),
        s("text", { x: M.l - 8, y: Y(t), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, (o.tick ?? o.format)(t)));
    }
    svg.append(s("text", { x: 0, y: 10, class: "tick", "dominant-baseline": "middle" }, o.unit));
    // x ticks
    const target = Math.max(2, Math.floor(plotW / 84));
    const step = [1, 2, 3, 5, 7, 10, 14, 21, 30, 60].find((d) => days / d <= target) ?? 90;
    const tickXs = xs.length === 1 ? [xs[0]] : Array.from({ length: Math.floor((days - 1) / step) + 1 }, (_, i) => xs[0] + i * step * DAY);
    for (const t of tickXs) {
      const x = X(t);
      const anchor = x - M.l < 24 ? "start" : W - M.r - x < 24 ? "end" : "middle";
      svg.append(s("text", { x, y: H - 6, class: "tick", "text-anchor": anchor }, dayLabel(t)));
    }

    const band = column ? Math.max(1, plotW / days) : 0;
    const bw = Math.max(1, Math.min(24, band - 2));
    const marks = s("g");
    for (const [si, ser] of o.series.entries()) {
      const col = `stroke:${ser.color}`;
      if (column) {
        for (const p of ser.points) {
          if (p.y <= 0) continue;
          const x = X(p.x) - bw / 2, y = Y(p.y), r = Math.min(4, bw / 2, base - y);
          marks.append(s("path", {
            class: "col", "data-x": p.x, style: `fill:${ser.color}`,
            d: `M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${base}Z`,
          }));
        }
      } else if (ser.points.length > 1) {
        const d = ser.points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join("");
        if (o.series.length === 1) {
          marks.append(s("path", { d: `${d}L${X(ser.points[ser.points.length - 1].x)} ${base}L${X(ser.points[0].x)} ${base}Z`, style: `fill:${ser.color};opacity:.1` }));
        }
        marks.append(s("path", { d, class: "line", style: col }));
      }
      if (!column && ser.points.length) {
        const last = ser.points[ser.points.length - 1];
        const cx = X(last.x), cy = Y(last.y);
        marks.append(s("circle", { cx, cy, r: 6, class: "ring" }), s("circle", { cx, cy, r: 4, style: `fill:${ser.color}` }));
        // End value label, unless another series' label is right there.
        const clash = o.series.slice(0, si).some((q) => q.points.length && Math.abs(Y(q.points[q.points.length - 1].y) - cy) < 14);
        if (!clash) marks.append(s("text", { x: Math.min(cx, W - M.r) - 2, y: cy - 12, class: "endlabel", "text-anchor": "end" }, o.format(last.y)));
      }
    }
    svg.append(marks);

    // hover layer: a crosshair (line) or a highlighted column
    const cross = s("line", { y1: M.t, y2: base, class: "crosshair", hidden: true });
    const dots = s("g");
    svg.append(cross, dots);
    const at = (x: number, y: number) => {                // x,y in client px
      const box = svg.getBoundingClientRect();
      let best = 0;
      for (const [i, v] of xs.entries()) if (Math.abs(X(v) - (x - box.left)) < Math.abs(X(xs[best]) - (x - box.left))) best = i;
      current = best;
      show(x, y);
    };
    const show = (cx: number, cy: number) => {
      const x = xs[current];
      cross.toggleAttribute("hidden", column);
      cross.setAttribute("x1", String(X(x))); cross.setAttribute("x2", String(X(x)));
      dots.replaceChildren();
      for (const m of marks.querySelectorAll<SVGElement>(".col")) m.classList.toggle("active", Number(m.dataset.x) === x);
      const rows = o.series.map((ser) => {
        const p = ser.points.find((q) => q.x === x);
        if (p && !column) dots.append(s("circle", { cx: X(x), cy: Y(p.y), r: 6, class: "ring" }), s("circle", { cx: X(x), cy: Y(p.y), r: 4, style: `fill:${ser.color}` }));
        return { label: ser.name, value: p ? o.format(p.y) : "–", color: ser.color };
      });
      showTip({ title: dayLong(x), rows }, cx, cy);
    };
    const clear = () => {
      current = -1; hideTip(); cross.setAttribute("hidden", ""); dots.replaceChildren();
      for (const m of marks.querySelectorAll(".col")) m.classList.remove("active");
    };
    const hit = s("rect", { x: M.l, y: M.t, width: plotW, height: plotH + 4, class: "hit" });
    hit.addEventListener("pointermove", (e) => at(e.clientX, e.clientY));
    hit.addEventListener("pointerdown", (e) => at(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", clear);
    svg.append(hit);
    svg.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      current = Math.min(xs.length - 1, Math.max(0, (current < 0 ? (d > 0 ? -1 : xs.length) : current) + d));
      const box = svg.getBoundingClientRect();
      show(box.left + X(xs[current]), box.top + M.t);
    });
    svg.addEventListener("blur", clear);
    root.replaceChildren(svg);
  };

  draw = () => { const w = root.clientWidth; if (w > 0) render(w); };
  let seen = 0;
  new ResizeObserver(() => { if (root.clientWidth !== seen) { seen = root.clientWidth; draw(); } }).observe(root);
  return root;
}

/** Day-by-day table twin of a time chart. */
export function timeTable(series: Series[], format: (n: number) => string): HTMLElement {
  const xs = [...new Set(series.flatMap((x) => x.points.map((p) => p.x)))].sort((a, b) => b - a);
  return h("div", { class: "table-wrap" }, h("table", { class: "data" },
    h("thead", null, h("tr", null, h("th", null, "Day (UTC)"), ...series.map((x) => h("th", { class: "num" }, x.name)))),
    h("tbody", null, ...xs.map((x) => h("tr", null, h("td", null, dayLong(x)),
      ...series.map((ser) => { const p = ser.points.find((q) => q.x === x); return h("td", { class: "num" }, p ? format(p.y) : "–"); }))))));
}

/** Last up to 30 values as a tiny line: grey, with the latest point in the accent. */
export function sparkline(values: number[]): SVGElement | null {
  const v = values.slice(-30);
  if (v.length < 2) return null;
  const W = 96, H = 28, max = Math.max(...v), min = Math.min(...v);
  const X = (i: number) => 3 + (i / (v.length - 1)) * (W - 6);
  const Y = (y: number) => (max === min ? H / 2 : H - 4 - ((y - min) / (max - min)) * (H - 8));
  const last = v.length - 1;
  return s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "spark", "aria-hidden": "true" },
    s("path", { d: v.map((y, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(y).toFixed(1)}`).join(""), class: "spark-line" }),
    s("circle", { cx: X(last), cy: Y(v[last]), r: 3, class: "spark-dot" }));
}

// --- bar lists --------------------------------------------------------------------------------------------------------

export interface BarRow {
  label: string;
  value: number;
  /** Small extra text under the label. */
  sub?: string;
  /** Text after the value, e.g. "62% of visitors". */
  note?: string;
  /** Thumbnail / swatch before the label. */
  lead?: Node;
  href?: string;
  /** Bar colour (default --s1). */
  color?: string;
}

/** Horizontal bars, one per row, with the value at the tip. One colour: the bars are one measure over different names. */
export function barList(rows: BarRow[], unit: string, format: (n: number) => string = fmt): HTMLElement {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return h("ul", { class: "bars" }, ...rows.map((r) => {
    const label: Child[] = [h("span", { class: "bar-label" }, r.label), r.sub ? h("span", { class: "bar-sub" }, r.sub) : null];
    const name = h("span", { class: "bar-name" }, r.lead ?? null, h("span", { class: "bar-text" }, ...label));
    const li = h("li", { class: "bar-row" },
      r.href ? h("a", { href: r.href, class: "bar-name-link" }, name) : name,
      h("span", { class: "bar-track" },
        h("span", { class: "bar", style: `--f:${r.value / max};${r.color ? `background:${r.color}` : ""}` }),
        h("span", { class: "bar-value" }, format(r.value)), r.note ? h("span", { class: "bar-note" }, r.note) : null));
    hoverTip(li, () => ({ title: r.label, rows: [{ label: unit, value: format(r.value) }] }));
    return li;
  }));
}
