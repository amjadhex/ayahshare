// Content: what people export, search for and choose. Event-based lists need app events; the cached-search list is from D1.
import type { Count } from "../../../api/src/admin-contract";
import { api, media, surahNames } from "../api";
import { barList, type BarRow } from "../charts";
import { h } from "../dom";
import { topic } from "./users";
import { card, DAY_CHOICES, daysOf, eventsNotice, NEEDS_EVENTS, pageHead, placeholder, segmented } from "../ui";

export async function content(q: URLSearchParams): Promise<HTMLElement> {
  const days = daysOf(q);
  const [c, names] = await Promise.all([api.content(days, 20), surahNames()]);
  const span = `Last ${c.days} days`;
  const surah = (n: string | number) => names.get(Number(n))?.name_en ?? `Surah ${n}`;
  const ayah = (ref: string) => `${surah(ref.split(":")[0])} ${ref}`;

  /** A list card for event data: a placeholder while events are off, or when the window has nothing. */
  const list = (title: string, subtitle: string, rows: Count[] | null, unit: string, row: (r: Count) => BarRow, empty = "Nothing recorded in this window") =>
    card(title, subtitle, rows === null ? placeholder(NEEDS_EVENTS) : rows.length ? barList(rows.map(row), unit) : placeholder(empty));

  const clipRow = (r: Count): BarRow => r.key === "colour"
    ? { label: "Solid colour", value: r.n, lead: h("span", { class: "swatch" }) }
    : { label: r.key, value: r.n, href: `#/backgrounds?q=${encodeURIComponent(r.key)}`, lead: h("img", { class: "thumb", src: media(`thumbs/${r.key}.webp`), alt: "", loading: "lazy" }) };
  const prettify = (r: Count): BarRow => ({ label: (r.key || "Unknown").replaceAll("_", " "), value: r.n });
  const plain = (r: Count): BarRow => ({ label: r.key || "Unknown", value: r.n });

  return h("div", null,
    pageHead("Content", segmented("Time window", DAY_CHOICES, String(c.days), (v) => `#/content?days=${v}`)),
    c.eventsEnabled ? null : eventsNotice("the questions asked in full search"),
    h("h2", { class: "section-title" }, "What people export"),
    h("div", { class: "cards two" },
      list("Top ayahs", `${span}, finished exports (by first ayah)`, c.ayahs, "exports", (r) => ({ label: ayah(r.key), value: r.n })),
      list("Top surahs", `${span}, finished exports from the surah`, c.surahs, "exports", (r) => ({ label: surah(r.key), sub: `Surah ${r.key}`, value: r.n }))),
    h("h2", { class: "section-title" }, "What people search for"),
    h("div", { class: "cards two" },
      list("Top searches", `${span}, times searched`, c.searches, "searches", plain),
      list("Searches nobody clicked", `${span}. People searched, then clicked no result: search may need fixing`, c.noClickSearches, "searches", plain,
        "Every search in this window led to a click")),
    h("div", { class: "cards" },
      card("Most asked questions in full search", "Answers kept for reuse, so repeat searches cost nothing. Counts are all time.",
        c.cachedSearches.length
          ? barList(c.cachedSearches.map((r) => ({ label: r.q, sub: r.topic ? `Topic: ${r.topic}` : undefined, value: r.n })), "times asked")
          : placeholder("No searches answered yet"))),
    h("div", { class: "cards" },
      card("Interests people picked", "Topics chosen on profiles (they weight each person's Discover feed). All time, accounts.",
        (c.interests ?? []).length ? barList((c.interests ?? []).map((r) => ({ label: topic(r.key), sub: r.key, value: r.n })), "accounts") : placeholder("No one has picked interests yet"))),
    h("h2", { class: "section-title" }, "Backgrounds and style"),
    h("div", { class: "cards two" },
      list("Top backgrounds", `${span}, times chosen`, c.clips, "times chosen", clipRow),
      list("Where backgrounds come from", `${span}, times chosen`, c.bgSources, "times chosen", (r) => ({ label: SOURCES[r.key] ?? r.key, value: r.n }))),
    h("div", { class: "cards three" },
      list("Reciters", `${span}, finished exports`, c.reciters, "exports", prettify),
      list("Translations", `${span}, finished exports`, c.translations, "exports", plain),
      list("Orientations", `${span}, finished exports`, c.orientations, "exports", (r) => ({ label: (r.key || "Unknown").replace(/^./, (x) => x.toUpperCase()), value: r.n }))),
  );
}

const SOURCES: Record<string, string> = { suggested: "Suggested for the ayah", library: "Picked from the library", colour: "Solid colour", share: "From a share link" };
