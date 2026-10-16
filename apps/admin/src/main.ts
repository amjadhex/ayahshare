// Admin dashboard shell: sign-in gate, top bar and a hash router (the Worker serves the web app for unknown paths, so routes
// live after the #).
import "./styles.css";
import { api, googleId, googleSignIn, loadConfig, signOut, Unauthorized } from "./api";
import { hideTip } from "./charts";
import { h, icon, mount } from "./dom";
import { backgrounds } from "./pages/backgrounds";
import { content } from "./pages/content";
import { cost } from "./pages/cost";
import { announcements } from "./pages/announcements";
import { daily } from "./pages/daily";
import { library } from "./pages/library";
import { overview } from "./pages/overview";
import { reports } from "./pages/reports";
import { users } from "./pages/users";
import { OPEN_REPORTS, placeholder } from "./ui";

type Page = (q: URLSearchParams) => Promise<HTMLElement>;
const ROUTES: Record<string, { label: string; page: Page }> = {
  overview: { label: "Overview", page: overview },
  content: { label: "Content", page: content },
  backgrounds: { label: "Backgrounds", page: backgrounds },
  library: { label: "Library", page: library },
  daily: { label: "Daily ayah", page: daily },
  announcements: { label: "Announcements", page: announcements },
  reports: { label: "Reports", page: reports },
  users: { label: "Users", page: users },
  cost: { label: "AI cost", page: cost },
};

/** The route in the URL hash ("#/reports?status=done" → "reports"); Overview when missing or unknown. */
function pageName(): string {
  const path = location.hash.slice(2).split("?")[0];
  return path in ROUTES ? path : "overview";
}

const app = document.getElementById("app")!;
let session: AbortController | undefined;   // listeners of the signed-in shell; ended when the sign-in form comes back
const brand = (suffix: string) => h("div", { class: "brand" }, icon("book"), "AyahShare", h("small", null, suffix));

type GoogleId = {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, o: Record<string, string>): void;
};
let gsi: Promise<GoogleId> | undefined;
/** Google's sign-in script, loaded once. */
const loadGsi = () => (gsi ??= new Promise<GoogleId>((resolve, reject) => {
  const s = Object.assign(document.createElement("script"), { src: "https://accounts.google.com/gsi/client", async: true });
  s.onload = () => resolve((window as unknown as { google: { accounts: { id: GoogleId } } }).google.accounts.id);
  s.onerror = () => { gsi = undefined; reject(new Error("Could not load Google sign-in. Check your connection and reload.")); };
  document.head.append(s);
}));

function showLogin(message = "") {
  session?.abort();
  const error = h("p", { class: "error", role: "alert" }, message);
  const button = h("div", { class: "google-btn" });
  mount(app, h("div", { class: "login" }, h("div", { class: "form" },
    brand("Admin"),
    h("p", null, "Sign in with your Google account to continue."),
    button, error)));
  void loadConfig().then(async () => {
    const clientId = googleId();
    if (!clientId) { error.textContent = "Google sign-in is not set up on the server."; return; }
    const id = await loadGsi();
    id.initialize({
      client_id: clientId,
      callback: async ({ credential }) => {
        error.textContent = "";
        try {
          await googleSignIn(credential);
          showShell(await api.whoami());
        } catch (err) {
          if (err instanceof Unauthorized) { await signOut(); error.textContent = "This Google account does not have admin access."; }
          else error.textContent = (err as Error).message;
        }
      },
    });
    id.renderButton(button, { type: "standard", size: "large", shape: "pill", text: "signin_with", theme: "outline" });
  }).catch((err: Error) => { error.textContent = err.message; });
}

function showShell(who: { via: "access" | "account" | "token"; email: string | null }) {
  session?.abort();
  session = new AbortController();
  const { signal } = session;
  const tabs = Object.entries(ROUTES).map(([key, r]) => h("a", { href: `#/${key}`, "data-route": key }, r.label));
  const reportsTab = tabs[Object.keys(ROUTES).indexOf("reports")];
  const main = h("main", { id: "main" });
  const refresh = h("button", { class: "icon-btn", type: "button", title: "Refresh", "aria-label": "Refresh", onclick: () => route() }, icon("refresh"));

  document.addEventListener(OPEN_REPORTS, (e) => {
    reportsTab.querySelector(".count")?.remove();
    const n = (e as CustomEvent<number>).detail;
    if (n > 0) reportsTab.append(h("span", { class: "count", "aria-label": `${n} open` }, n > 99 ? "99+" : String(n)));
  }, { signal });

  let navId = 0;
  let shown = "";
  async function route() {
    const id = ++navId;
    const query = location.hash.slice(2).split("?")[1] ?? "";
    const name = pageName();
    for (const a of tabs) {
      if (a.dataset.route === name) { a.setAttribute("aria-current", "page"); a.scrollIntoView({ inline: "nearest", block: "nearest" }); }
      else a.removeAttribute("aria-current");
    }
    document.title = `${ROUTES[name].label} · AyahShare admin`;
    hideTip();
    main.classList.add("stale");
    try {
      const page = await ROUTES[name].page(new URLSearchParams(query));
      if (id !== navId) return;
      mount(main, page);
      if (shown !== name) scrollTo(0, 0);
      shown = name;
    } catch (err) {
      if (id !== navId) return;
      if (err instanceof Unauthorized) { showLogin("Your sign-in has ended. Sign in again."); return; }
      mount(main, h("div", { class: "card" }, h("p", { class: "empty" }, (err as Error).message),
        h("div", { class: "more" }, h("button", { class: "btn", type: "button", onclick: () => route() }, "Try again"))));
    } finally {
      if (id === navId) main.classList.remove("stale");
    }
  }

  mount(app,
    h("header", { class: "topbar" }, h("div", { class: "topbar-in" },
      brand("Admin"),
      h("nav", { class: "tabs", "aria-label": "Sections" }, ...tabs),
      h("div", { class: "who" },
        who.email ? h("span", { class: "email", title: who.email }, who.email) : null,
        refresh,
        who.via === "account" ? h("button", { class: "icon-btn", type: "button", title: "Sign out", "aria-label": "Sign out", onclick: () => { void signOut().then(() => showLogin()); } }, icon("logout")) : null))),
    main);
  mount(main, placeholder("Loading..."));
  addEventListener("hashchange", () => route(), { signal });
  void route();
  // Overview and Reports announce the open-report count themselves; any other first page asks for it once.
  if (!["overview", "reports"].includes(pageName())) {
    api.reportCount("open").then((n) => document.dispatchEvent(new CustomEvent(OPEN_REPORTS, { detail: n })), () => undefined);
  }
}

async function start() {
  void loadConfig();
  try {
    showShell(await api.whoami());
  } catch (err) {
    if (err instanceof Unauthorized) showLogin();
    else mount(app, h("div", { class: "login" }, h("div", { class: "card" }, h("p", { class: "empty" }, (err as Error).message),
      h("div", { class: "more" }, h("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Try again")))));
  }
}

void start();
