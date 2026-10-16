// Users: signed-in accounts, most recently active first. Anonymous devices are counted on the Overview.
import { api, type AdminUser } from "../api";
import { ago, country, dateTime, fmtFull, h } from "../dom";
import { pageHead, placeholder } from "../ui";

const PAGE = 100;

export async function users(): Promise<HTMLElement> {
  const first = await api.users(0, PAGE);
  const rows = [...first.users];
  const body = h("tbody");
  const more = h("div", { class: "more" });
  const count = h("p", { class: "card-sub" });

  const row = (u: AdminUser) => h("tr", null,
    h("td", { "data-label": "Account" }, h("div", { class: "cell-user" },
      u.avatar_url ? h("img", { class: "avatar", src: u.avatar_url, alt: "", referrerpolicy: "no-referrer", loading: "lazy" }) : h("span", { class: "avatar" }, (u.name || u.email).charAt(0).toUpperCase()),
      h("div", { style: "min-width:0" },
        h("div", { class: "truncate", title: u.display_name && u.name ? `Google name: ${u.name}` : undefined }, u.display_name || u.name || "–"),
        h("div", { class: "truncate muted" }, u.email)))),
    h("td", { "data-label": "Location" }, place(u)),
    h("td", { "data-label": "Phone", title: u.phone ? (u.phone_opt_in ? "Opted in to a daily ayah on WhatsApp" : "Not opted in") : undefined },
      u.phone ? h("span", { class: "nowrap" }, u.phone, u.phone_opt_in ? h("span", { class: "muted" }, " · opted in") : null) : h("span", { class: "muted" }, "–")),
    h("td", { "data-label": "Interests", title: u.interests.join(", ") || undefined },
      u.interests.length ? h("span", { class: "truncate" }, u.interests.slice(0, 3).map(topic).join(", ") + (u.interests.length > 3 ? ` +${u.interests.length - 3}` : "")) : h("span", { class: "muted" }, "–")),
    h("td", { "data-label": "Signed up", title: dateTime(u.created_at) }, ago(u.created_at)),
    h("td", { "data-label": "Last sign-in", title: dateTime(u.last_login) }, ago(u.last_login)),
    h("td", { "data-label": "Last active", title: dateTime(u.last_active) }, ago(u.last_active)),
    h("td", { class: "num", "data-label": "Creations" }, fmtFull(u.creations)),
    h("td", { class: "num", "data-label": "Favourites" }, fmtFull(u.favourites)),
    h("td", { class: "num", "data-label": "Devices" }, fmtFull(u.devices)));

  function paint() {
    body.replaceChildren(...rows.map(row));
    count.textContent = `${fmtFull(rows.length)} of ${fmtFull(first.total)} shown`;
    more.replaceChildren(...(rows.length < first.total ? [h("button", { class: "btn", type: "button", onclick: loadMore }, "Show more")] : []));
  }
  async function loadMore(e: Event) {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      rows.push(...(await api.users(rows.length, PAGE)).users);
      paint();
    } catch {
      btn.disabled = false;
    }
  }
  paint();

  return h("div", null,
    pageHead("Users"),
    first.total
      ? h("section", { class: "card" },
        h("header", { class: "card-head" }, h("div", null, h("h2", { class: "card-title" }, "Signed-in accounts"), count)),
        h("div", { class: "table-wrap" }, h("table", { class: "data stack" },
          h("thead", null, h("tr", null, h("th", null, "Account"), h("th", null, "Location"), h("th", null, "Phone"), h("th", null, "Interests"), h("th", null, "Signed up"), h("th", null, "Last sign-in"), h("th", null, "Last active"), h("th", { class: "num" }, "Creations"), h("th", { class: "num" }, "Favourites"), h("th", { class: "num" }, "Devices"))),
          body)), more)
      : h("section", { class: "card" }, placeholder("Nobody has signed in yet. Signing in is optional, so anonymous visitors are counted on the Overview.")));
}

/** "Leeds, United Kingdom" from the profile (both optional). */
const place = (u: AdminUser) => [u.city, u.country ? country(u.country) : null].filter(Boolean).join(", ") || h("span", { class: "muted" }, "–");
/** "ease-after-hardship" → "Ease after hardship". */
export const topic = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replaceAll("-", " ");
