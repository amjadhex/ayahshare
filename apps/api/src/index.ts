// AyahShare Worker (ayahshare.com; the Worker itself is named quran-design): the API, proxies and share pages; the web app
// itself is served as static assets.
import { Hono } from "hono";
import type { PublicConfig } from "../../../contracts/types";
import { emailSignInEnabled } from "./lib/email";
import { appCors, sameOrigin } from "./lib/http";
import { turnstileOn } from "./lib/turnstile";
import { turnedOff } from "./lib/turnedoff";
import { vapidKeys } from "./lib/webpush";
import { creations, favourites } from "./routes/account";
import { admin } from "./routes/admin";
import { avatar } from "./routes/avatar";
import { auth } from "./routes/auth";
import { clips } from "./routes/clips";
import { announcements } from "./routes/announcements";
import { daily } from "./routes/daily";
import { data } from "./routes/data";
import { events } from "./routes/events";
import { ingest } from "./routes/ingest";
import { proxy } from "./routes/proxy";
import { push } from "./routes/push";
import { reflect } from "./routes/reflect";
import { reports } from "./routes/reports";
import { search } from "./routes/search";
import { sharePage, shares } from "./routes/shares";
import { stats } from "./routes/stats";
import { trending } from "./routes/trending";
import { wellKnown } from "./routes/wellknown";
import { REMINDER_CRON, sendDueReminders } from "./reminders";
import { rollup } from "./rollup";

export const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  console.error("unhandled:", c.req.method, new URL(c.req.url).pathname, String(err));
  return c.json({ error: "internal error" }, 500);
});
app.use("/api/*", appCors, sameOrigin);

app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME }));
app.get("/api/config", async (c) =>
  c.json<PublicConfig>({
    appName: c.env.APP_NAME, googleClientId: c.env.GOOGLE_CLIENT_ID || null, emailSignIn: emailSignInEnabled(c.env), mediaBase: "/media/",
    turnstileSiteKey: turnstileOn(c.env) ? c.env.TURNSTILE_SITE_KEY : undefined,
    vapidPublicKey: vapidKeys(c.env)?.publicKey, // the web offers its daily reminder only with both VAPID keys set
    off: await turnedOff(c.env.DB), // admin Library
    minAppVersion: c.env.MIN_APP_VERSION_IOS || c.env.MIN_APP_VERSION_ANDROID
      ? { ios: c.env.MIN_APP_VERSION_IOS || undefined, android: c.env.MIN_APP_VERSION_ANDROID || undefined } : undefined,
  }, 200, { "Cache-Control": "public, max-age=60" }), // the same for everyone; a changed setting shows within a minute
);
app.route("/api/search", search);
app.route("/api/clips", clips);
app.route("/api/events", events);
app.route("/api/shares", shares);
app.route("/api/reports", reports);
app.route("/api", auth); // /api/auth/google, /api/auth/email/start|verify, /api/auth/logout, /api/me
app.route("/api/creations", creations);
app.route("/api/favourites", favourites);
app.route("/api/trending", trending);
app.route("/api/daily", daily); // the days an admin chose the ayah of the day for
app.route("/api/announcements", announcements); // news from AyahShare (admin Announcements), shown in Notifications
app.route("/api/push", push); // the web's daily reminder (Web Push subscriptions)
app.route("/api/stats", stats); // /api/stats/ayahs, /api/stats/me
app.route("/api", reflect); // /api/tafsir/:ref, /api/reflections/:ref
app.route("/api/avatar", avatar); // /api/avatar/qr/* — QuranReflect authors' photos
app.route("/admin/api/ingest", ingest); // before admin: ingest keeps its own Bearer-only guard
app.route("/admin/api", admin);
// The landing page (apps/web public/landing.html, served at /landing too, canonical /); the app is at /app. An old share
// link (/?r=<code>) still opens the app.
app.get("/", (c) => {
  const url = new URL(c.req.url);
  return c.env.ASSETS.fetch(new Request(new URL(url.searchParams.has("r") ? "/app" : "/landing", url), c.req.raw));
});
app.route("/", sharePage);
app.route("/", wellKnown);
app.route("/", data);
app.route("/", proxy);
app.notFound((c) => c.json({ error: "not found" }, 404));

export default {
  fetch: app.fetch,
  // Nightly rollup (30 0 * * *) and, every 15 minutes, the web's daily reminders (src/reminders.ts).
  scheduled: (controller, env, ctx) => ctx.waitUntil(controller.cron === REMINDER_CRON ? sendDueReminders(env) : rollup(env)),
} satisfies ExportedHandler<Env>;
