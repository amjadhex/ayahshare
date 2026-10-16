// Reports: what people flagged ("something looks wrong"), with a status per report. Only the chosen status is loaded, a page
// at a time; the tab counts come from one small count request per status.
import { api, media, surahNames, type AdminReport, type ReportStatus } from "../api";
import { ago, dateTime, fmtFull, h, icon, mount } from "../dom";
import { announceOpenReports, badge, pageHead, placeholder, segmented, toast, type Choice, type Tone } from "../ui";

const PAGE = 100;
const STATUSES = ["open", "done", "dismissed"] as const;
const KIND: Record<AdminReport["kind"], string> = { background: "Background", search: "Search results", text: "Quran text", other: "Other" };
const STATUS: Record<ReportStatus, { label: string; tone: Tone }> = { open: { label: "Open", tone: "warn" }, done: { label: "Done", tone: "good" }, dismissed: { label: "Dismissed", tone: "neutral" } };

export async function reports(q: URLSearchParams): Promise<HTMLElement> {
  const filter: "all" | ReportStatus = (["open", "done", "dismissed", "all"] as const).find((s) => s === q.get("status")) ?? "open";
  // The chosen status's page already carries its total, so only the other statuses need a count request.
  const [first, totals, names] = await Promise.all([
    api.reports(filter, 0, PAGE),
    Promise.all(STATUSES.map((s) => (s === filter ? null : api.reportCount(s)))),
    surahNames(),
  ]);
  const counts = Object.fromEntries(STATUSES.map((s, i) => [s, totals[i] ?? first.total])) as Record<ReportStatus, number>;
  const rows = [...first.reports];
  const bar = h("div", { class: "toolbar" });
  const list = h("div", { class: "card" });

  const about = (r: AdminReport): Node | string => {
    if (r.clip_id) {
      return h("a", { class: "cell-user", href: `#/backgrounds?q=${encodeURIComponent(r.clip_id)}`, title: "Open in Backgrounds" },
        h("img", { class: "thumb", src: media(`thumbs/${r.clip_id}.webp`), alt: "", loading: "lazy" }), r.clip_id);
    }
    if (!r.ref) return "–";
    const [surah, ayah] = r.ref.split(":");
    const name = names.get(Number(surah))?.name_en;
    return ayah && name ? `${name} ${r.ref}` : r.ref;
  };

  const move = (r: AdminReport, status: ReportStatus) => { counts[r.status]--; counts[status]++; r.status = status; };
  async function setStatus(r: AdminReport, status: ReportStatus) {
    const before = r.status;
    move(r, status);
    paint();
    try {
      await api.setReportStatus(r.id, status);
    } catch (e) {
      move(r, before);
      paint();
      toast(`Could not update report ${r.id}: ${(e as Error).message}`, true);
    }
  }
  async function hide(r: AdminReport) {
    if (!r.clip_id) return;
    try {
      await api.setClipStatus(r.clip_id, "hidden");
      toast(`${r.clip_id} is hidden. It leaves the app within a minute. Mark the report done when you are finished.`);
    } catch (e) {
      toast(`Could not hide ${r.clip_id}: ${(e as Error).message}`, true);
    }
  }
  /** Next page of this status. Reports moved out of it here have left the server's list too, so the offset is what is still shown. */
  async function loadMore(e: Event) {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      const seen = new Set(rows.map((r) => r.id));
      rows.push(...(await api.reports(filter, shown().length, PAGE)).reports.filter((r) => !seen.has(r.id)));
      paint();
    } catch (err) {
      btn.disabled = false;
      toast(`Could not load more reports: ${(err as Error).message}`, true);
    }
  }

  const action = (label: string, run: () => void, name?: Parameters<typeof icon>[0]) =>
    h("button", { class: "btn small", type: "button", onclick: run }, name ? icon(name) : null, label);
  const shown = () => rows.filter((r) => filter === "all" || r.status === filter);

  function paint() {
    const all = STATUSES.reduce((a, s) => a + counts[s], 0);
    const total = filter === "all" ? all : counts[filter];
    const choices: Choice[] = [...STATUSES.map((s) => ({ value: s, label: STATUS[s].label, count: counts[s] })), { value: "all", label: "All", count: all }];
    mount(bar, segmented("Status", choices, filter, (v) => `#/reports?status=${v}`));
    announceOpenReports(counts.open);
    const visible = shown();
    mount(list, ...(visible.length ? [
      h("div", { class: "table-wrap" }, h("table", { class: "data stack" },
        h("thead", null, h("tr", null, ...["Received", "About", "Type", "Note", "From", "Status", ""].map((t) => h("th", null, t)))),
        h("tbody", null, ...visible.map((r) => h("tr", null,
          h("td", { "data-label": "Received", title: dateTime(r.created_at) }, ago(r.created_at)),
          h("td", { "data-label": "About" }, about(r)),
          h("td", { "data-label": "Type" }, KIND[r.kind] ?? r.kind),
          h("td", { "data-label": "Note", class: "truncate", title: r.note ?? "" }, r.note ?? "–"),
          h("td", { "data-label": "From", class: "muted", title: r.user_id ?? r.anon_id ?? "" }, r.user_id ? "Signed in" : r.anon_id ? "Anonymous" : "–"),
          h("td", { "data-label": "Status" }, badge(STATUS[r.status].label, STATUS[r.status].tone, r.status === "dismissed" ? "x" : r.status === "open" ? "dot" : undefined)),
          h("td", null, h("div", { class: "flags" },
            ...(r.status === "open" ? [action("Done", () => setStatus(r, "done"), "check"), action("Dismiss", () => setStatus(r, "dismissed"))] : [action("Reopen", () => setStatus(r, "open"))]),
            r.clip_id ? action("Hide background", () => hide(r), "eye-off") : null))))))),
      visible.length < total
        ? h("div", { class: "more" }, h("button", { class: "btn", type: "button", onclick: loadMore }, `Show more (${fmtFull(visible.length)} of ${fmtFull(total)} shown)`))
        : null,
    ] : [placeholder(all ? `No ${filter} reports` : "No reports yet")]));
  }

  paint();
  return h("div", null, pageHead("Reports"), bar, list);
}
