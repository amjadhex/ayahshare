// Announcements: news from AyahShare for everyone (owner, 12 Oct 2026), shown in the app's Notifications (the bell on
// Home), newest first; the app shows the newest 5 from the last 60 days and puts a dot on the bell for a new one.
// Deleting one removes it for everyone.
import { api, type AdminAnnouncement } from "../api";
import { dateTime, h } from "../dom";
import { card, pageHead, placeholder, toast } from "../ui";

const TITLE_MAX = 80, BODY_MAX = 280;
const SHOWN = 5, MAX_AGE = 60 * 86400_000;

export async function announcements(): Promise<HTMLElement> {
  let items = (await api.announcements()).items;
  const list = h("div", null);

  function paintList() {
    const shown = new Set(items.filter((a) => Date.now() - a.at < MAX_AGE).slice(0, SHOWN).map((a) => a.id));
    list.replaceChildren(items.length
      ? h("div", { class: "table-wrap" }, h("table", { class: "data stack" },
        h("thead", null, h("tr", null, h("th", null, "Written"), h("th", null, "Announcement"), h("th", null, "In the app"), h("th", null, ""))),
        h("tbody", null, ...items.map((a) => h("tr", null,
          h("td", { "data-label": "Written" }, dateTime(a.at)),
          h("td", { "data-label": "Announcement" }, h("b", null, a.title), a.body ? h("div", { class: "muted" }, a.body) : null,
            a.link ? h("div", { class: "muted" }, "Opens ", a.link) : null),
          h("td", { "data-label": "In the app" }, shown.has(a.id) ? "Shown" : h("span", { class: "muted" }, "No longer shown")),
          h("td", null, h("button", { class: "btn small ghost", type: "button", onclick: () => void remove(a) }, "Delete")))))))
      : placeholder("No announcements yet. Write the first one above."));
  }

  async function remove(a: AdminAnnouncement) {
    if (!confirm(`Delete “${a.title}” for everyone?`)) return;
    try {
      await api.deleteAnnouncement(a.id);
      items = items.filter((x) => x.id !== a.id);
      paintList();
      toast("Deleted.");
    } catch (err) {
      toast(`Could not delete: ${(err as Error).message}`, true);
    }
  }

  const title = h("input", { class: "field wide", type: "text", maxlength: TITLE_MAX, required: true, placeholder: "21 more reciters", "aria-label": `Title (at most ${TITLE_MAX} characters)` });
  const body = h("textarea", { class: "field wide area", maxlength: BODY_MAX, rows: 3, placeholder: "Pick one in Language and audio.", "aria-label": `Text (optional, at most ${BODY_MAX} characters)` });
  const link = h("input", { class: "field wide", type: "text", placeholder: "/feed  or  https://…", "aria-label": "Link (optional): an app path like /discover, or an https address" });
  const error = h("span", { class: "error-text", role: "alert" });
  const publish = h("button", { class: "btn primary", type: "submit" }, "Publish to everyone");
  const form = h("form", { class: "announce-form" },
    h("label", null, "Title", title), h("label", null, "Text (optional)", body), h("label", null, "Link (optional)", link),
    h("div", { class: "row" }, publish, error));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!title.value.trim()) { error.textContent = "Write a title."; title.focus(); return; }
    publish.disabled = true;
    error.textContent = "";
    try {
      const made = await api.addAnnouncement({ title: title.value, body: body.value, link: link.value.trim() || null });
      items = [made, ...items];
      paintList();
      form.reset();
      toast("Published. It shows in everyone's Notifications within five minutes.");
    } catch (err) {
      error.textContent = (err as Error).message;
    } finally {
      publish.disabled = false;
    }
  });

  paintList();
  return h("div", null,
    pageHead("Announcements"),
    card("Write an announcement", `Shown in the app's Notifications, newest first (the newest ${SHOWN} from the last 60 days), with a dot on the bell.`, form),
    card("Written", null, list));
}
