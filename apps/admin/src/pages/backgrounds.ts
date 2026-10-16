// Backgrounds: every clip in the library with its usage and safety flags; hide and unhide. Hidden and rejected clips leave
// the app within a minute (the API clears its cache when the status changes).
import { api, loadAll, media, type AdminClip, type ClipStatus } from "../api";
import { ago, fmtFull, h, icon, mount, pct } from "../dom";
import { badge, pageHead, placeholder, segmentedButtons, toast, type Choice } from "../ui";

const SAFETY: Record<string, { label: string; reject: number }> = {
  people: { label: "People", reject: 0.3 }, animals: { label: "Animals", reject: 0.3 }, other_religion: { label: "Other faith symbol", reject: 0.3 },
  immodest: { label: "Immodest", reject: 0.3 }, text_logo: { label: "Text or logo", reject: 0.5 },
};
/** Scores from the safety screening that deserve a look (shown as chips). abstract_dark is not a safety question. */
const flagsOf = (c: AdminClip) => Object.entries(c.safety ?? {}).filter(([k, v]) => k in SAFETY && v >= 0.1).sort((a, b) => b[1] - a[1]);

/** A muted, looping preview (the muted state has to be set as a property before autoplay is allowed). */
function player(src: string, poster: string): HTMLVideoElement {
  const v = h("video", { src: media(src), poster: media(poster), loop: true, autoplay: true, playsinline: true, controls: true });
  v.muted = true;
  return v;
}

const STATUS_LABEL: Record<ClipStatus, string> = { active: "Active", hidden: "Hidden", rejected: "Rejected" };
type Sort = "newest" | "used" | "reported" | "quality";

export async function backgrounds(q: URLSearchParams): Promise<HTMLElement> {
  let events = false;
  const clips = await loadAll(async (offset) => {
    const r = await api.clips(offset);
    events = r.eventsEnabled;
    return { rows: r.clips, total: r.total };
  });
  let filter: "all" | ClipStatus = "all";
  let text = q.get("q") ?? "";
  let sort: Sort = "newest";

  const grid = h("div", { class: "clips" });
  const bar = h("div", { class: "toolbar" });
  const dlg = h("dialog", { "aria-label": "Background details" });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.replaceChildren());

  async function setStatus(c: AdminClip, status: ClipStatus) {
    const before = c.status;
    c.status = status;
    paint();
    if (dlg.open) openClip(c);
    try {
      await api.setClipStatus(c.id, status);
      toast(status === "active" ? `${c.id} is back in the app.` : `${c.id} is ${status}. It leaves the app within a minute.`);
    } catch (e) {
      c.status = before;
      paint();
      if (dlg.open) openClip(c);
      toast(`Could not change ${c.id}: ${(e as Error).message}`, true);
    }
  }

  const toggle = (c: AdminClip) =>
    h("button", { class: "btn small", type: "button", onclick: () => setStatus(c, c.status === "active" ? "hidden" : "active") },
      icon(c.status === "active" ? "eye-off" : "eye"), c.status === "active" ? "Hide" : c.status === "rejected" ? "Restore" : "Unhide");

  const flagChips = (c: AdminClip) => h("div", { class: "flags" }, ...flagsOf(c).map(([k, v]) =>
    badge(`${SAFETY[k].label} ${Math.round(v * 100)}%`, v >= SAFETY[k].reject ? "crit" : "warn")));

  function cardOf(c: AdminClip): HTMLElement {
    return h("article", { class: `clip${c.status === "active" ? "" : " off"}` },
      h("button", { class: "clip-thumb", type: "button", onclick: () => openClip(c), "aria-label": `Open ${c.id}${c.caption ? `: ${c.caption}` : ""}` },
        h("img", { src: media(c.thumb), alt: "", loading: "lazy" }),
        h("span", { class: "clip-badges" },
          c.status === "active" ? h("span") : badge(STATUS_LABEL[c.status], c.status === "hidden" ? "neutral" : "crit", c.status === "hidden" ? "eye-off" : "x"),
          c.reports ? badge(`${c.reports} report${c.reports > 1 ? "s" : ""}`, "crit") : null)),
      h("div", { class: "clip-meta" }, h("b", { title: c.caption ?? "" }, c.id), c.uses !== null ? h("span", null, `${fmtFull(c.uses)} use${c.uses === 1 ? "" : "s"}`) : null),
      flagsOf(c).length ? flagChips(c) : null,
      toggle(c));
  }

  function openClip(c: AdminClip) {
    const row = (k: string, v: Node | string | null) => (v === null || v === "" ? [] : [h("dt", null, k), h("dd", null, v)]);
    const source = h("span", null, `${c.source}${c.author ? `, ${c.author} ` : " "}`, c.page_url && /^https?:\/\//.test(c.page_url) ? h("a", { href: c.page_url, target: "_blank", rel: "noopener noreferrer" }, "page", icon("external")) : null);
    mount(dlg,
      h("div", { class: "dlg" },
        c.video ? player(c.video.portrait, c.thumb) : h("img", { src: media(c.thumb), alt: "" }),
        h("div", null,
          h("h2", null, c.id),
          h("div", { class: "flags", style: "margin-top:8px" }, badge(STATUS_LABEL[c.status], c.status === "active" ? "good" : c.status === "hidden" ? "neutral" : "crit", c.status === "hidden" ? "eye-off" : undefined),
            ...flagsOf(c).map(([k, v]) => badge(`${SAFETY[k].label} ${Math.round(v * 100)}%`, v >= SAFETY[k].reject ? "crit" : "warn"))),
          h("dl", null,
            ...row("Caption", c.caption), ...row("Tags", c.tags.join(", ")), ...row("Source", source),
            ...row("Length", c.duration ? `${c.duration.toFixed(1)} s` : null), ...row("Quality", c.quality !== null ? pct(c.quality, 1) : null),
            ...row("Added", ago(c.created_at)), ...row("Reports", String(c.reports)), ...row("Used, 30 days", c.uses !== null ? fmtFull(c.uses) : null),
            ...row("Screening", Object.entries(c.safety ?? {}).map(([k, v]) => `${SAFETY[k]?.label ?? k.replaceAll("_", " ")} ${Math.round(v * 100)}%`).join(" · "))),
          segmentedButtons("Status", (["active", "hidden", "rejected"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] })), c.status, (v) => setStatus(c, v as ClipStatus)),
          h("div", { class: "dlg-actions" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Close")))));
    if (!dlg.open) dlg.showModal();
  }

  const shown = (): AdminClip[] => {
    const needle = text.trim().toLowerCase();
    const rows = clips.filter((c) => (filter === "all" || c.status === filter) &&
      (!needle || [c.id, c.caption, c.author, c.tags.join(" ")].some((f) => f?.toLowerCase().includes(needle))));
    const by: Record<Sort, (a: AdminClip, b: AdminClip) => number> = {
      newest: (a, b) => b.created_at - a.created_at,
      used: (a, b) => (b.uses ?? 0) - (a.uses ?? 0),
      reported: (a, b) => b.reports - a.reports || b.created_at - a.created_at,
      quality: (a, b) => (a.quality ?? 2) - (b.quality ?? 2),
    };
    return rows.sort(by[sort]);
  };

  const statusBar = h("div");
  const search = h("input", { class: "field search", type: "search", placeholder: "Search id, caption, tags", "aria-label": "Search backgrounds", value: text });
  search.addEventListener("input", () => { text = search.value; paintGrid(); });
  const order = h("select", { class: "field", "aria-label": "Sort" },
    ...([["newest", "Newest first"], ["used", "Most used"], ["reported", "Most reported"], ["quality", "Lowest quality"]] as const)
      .filter(([v]) => v !== "used" || events).map(([v, l]) => h("option", { value: v }, l)));
  order.addEventListener("change", () => { sort = order.value as Sort; paintGrid(); });
  bar.append(statusBar, search, order);

  function paint() {
    const count = (s: ClipStatus) => clips.filter((c) => c.status === s).length;
    const choices: Choice[] = [{ value: "all", label: "All", count: clips.length }, ...(["active", "hidden", "rejected"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s], count: count(s) }))];
    mount(statusBar, segmentedButtons("Status", choices, filter, (v) => { filter = v as typeof filter; paint(); }));
    paintGrid();
  }

  function paintGrid() {
    const rows = shown();
    mount(grid, ...(rows.length ? rows.map(cardOf) : [placeholder("No backgrounds match")]));
    grid.classList.toggle("clips", rows.length > 0);
  }

  paint();
  return h("div", null,
    pageHead("Backgrounds"),
    clips.length ? null : placeholder("The library is empty"),
    bar, grid,
    events ? null : h("p", { class: "more-note" }, "Usage counts appear as soon as the app sends its first events."),
    dlg);
}
