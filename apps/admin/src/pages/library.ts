// Library: the tafsirs, reciters and translation voices the app offers (owner, 15 Oct 2026). Turning one off hides it in
// the app (pickers, defaults, Reflect) within a minute, five for the tafsir lists; turning it back on brings it back. Old
// links keep their reciter; a design whose voice is off plays the recitation only.
import { api, type AdminLibraryItem, type LibraryKind } from "../api";
import { h } from "../dom";
import { card, pageHead, placeholder, segmentedButtons, toast } from "../ui";

const KINDS: { kind: LibraryKind; label: string; key: "tafsirs" | "reciters" | "voices"; note: string }[] = [
  { kind: "tafsir", label: "Tafsirs", key: "tafsirs", note: "Off: not in Reflect's tafsir list. A language whose default is off gets its next tafsir." },
  { kind: "reciter", label: "Reciters", key: "reciters", note: "Off: not offered for new designs, reels or Play a surah. Shared links keep their reciter. One must stay on." },
  { kind: "voice", label: "Translation voices", key: "voices", note: "Off: the language has no voice option; designs with it play the recitation only." },
];

const langName = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  return (code: string | null) => { try { return code ? names.of(code) ?? code : ""; } catch { return code ?? ""; } };
})();

export async function library(q: URLSearchParams): Promise<HTMLElement> {
  const data = await api.library();
  let current = KINDS.find((k) => k.kind === q.get("kind")) ?? KINDS[0];
  let filter = "";
  const body = h("div", null);
  const tabs = h("div", null);

  async function toggle(item: AdminLibraryItem, input: HTMLInputElement) {
    const off = !input.checked;
    input.disabled = true;
    try {
      await api.setOff(current.kind, item.id, off);
      item.off = off;
      input.closest("tr")?.classList.toggle("is-off", off);
      toast(`${item.name}: ${off ? "hidden in the app within a minute" : "back in the app within a minute"}.`);
      paintTabs();
    } catch (err) {
      input.checked = !off;
      toast(`Could not change ${item.name}: ${(err as Error).message}`, true);
    } finally {
      input.disabled = false;
    }
  }

  function paintTabs() {
    tabs.replaceChildren(segmentedButtons("Kind", KINDS.map((k) => {
      const items = data[k.key];
      return { value: k.kind, label: k.label, count: items.filter((x) => !x.off).length };
    }), current.kind, (v) => {
      current = KINDS.find((k) => k.kind === v)!;
      history.replaceState(null, "", `#/library?kind=${v}`);
      paintTabs();
      paint();
    }));
  }

  function paint() {
    const needle = filter.trim().toLowerCase();
    const items = data[current.key].filter((x) => !needle || [x.name, x.detail, x.id, langName(x.lang)].some((s) => s?.toLowerCase().includes(needle)));
    const showLang = current.kind !== "reciter";
    body.replaceChildren(
      h("p", { class: "card-sub" }, current.note),
      items.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "data stack" },
          h("thead", null, h("tr", null, h("th", null, "Shown"), h("th", null, "Name"), showLang ? h("th", null, "Language") : null, h("th", null, "Id"))),
          h("tbody", null, ...items.map((x) => {
            const input = h("input", { type: "checkbox", role: "switch", class: "switch", checked: !x.off, "aria-label": `Show ${x.name} in the app` });
            input.addEventListener("change", () => void toggle(x, input));
            return h("tr", { class: x.off ? "is-off" : null },
              h("td", { "data-label": "Shown" }, input),
              h("td", { "data-label": "Name" }, h("b", null, x.name), x.detail ? h("div", { class: "muted" }, x.detail) : null),
              showLang ? h("td", { "data-label": "Language" }, langName(x.lang)) : null,
              h("td", { "data-label": "Id", class: "muted" }, x.id));
          }))))
        : placeholder("Nothing matches."));
  }

  const search = h("input", { class: "field search", type: "search", placeholder: "Search name, language or id", "aria-label": "Search" });
  search.addEventListener("input", () => { filter = search.value; paint(); });
  paintTabs();
  paint();
  return h("div", null,
    pageHead("Library"),
    card("What the app offers", "Switch an item off to hide it in the app; the change reaches everyone within a minute.",
      h("div", { class: "toolbar" }, tabs, search), body));
}
