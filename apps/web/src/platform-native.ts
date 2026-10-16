// The iOS / Android app's side of the platform adapter (platform.ts), on Capacitor plugins. Loaded only inside the app
// (platform.ts → initPlatform), so the web never downloads it. The app bundles the web build; the paths the Worker
// answers go to the deployed Worker (endpoint.ts) or, once downloaded, to the device's copy (native/offline.ts), and the
// sign-in session is a token kept in the app's storage.
import { App } from "@capacitor/app";
import { Clipboard } from "@capacitor/clipboard";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { MediaSession } from "@capgo/capacitor-media-session";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { setApiBase, setSessionToken } from "./endpoint";
import { startOffline, type OfflineStore } from "./native/offline";
import type { GoogleSignIn, Lifecycle, NowPlaying, Platform, Reminders } from "./platform";
import { back, getRoute, navigate } from "./router";
import { t } from "./strings";

// Build-time settings (apps/web/.env or the environment of `npm run build`; see apps/mobile/README.md).
/** The API the app calls. */
const API_BASE = import.meta.env.VITE_APP_API_BASE || "https://ayahshare.com";
/** Google Cloud OAuth client ids of type iOS / Android. Empty → sign-in stays hidden on that platform. Both sign in
 *  for the server's web client id (`/api/config` googleClientId), so the Worker accepts their ID tokens as they are. */
const GOOGLE_IOS_CLIENT_ID = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID || "";
const GOOGLE_ANDROID_CLIENT_ID = import.meta.env.VITE_GOOGLE_ANDROID_CLIENT_ID || "";

const SESSION_KEY = "qd.session";
const EXPORTS = "exports"; // finished files handed to the share sheet / Photos, in the app's cache folder

/** The app's own plugin (ios/App/App/SaveToGalleryPlugin.swift, android/.../SaveToGalleryPlugin.java): adds an image or
 *  video file to Photos (iOS, add-only access) or to the Gallery (Android: Pictures/ or Movies/AyahShare). */
const SaveToGallery = registerPlugin<{ save(o: { path: string; type: string }): Promise<void> }>("SaveToGallery");

const canceled = (e: unknown) => /cancel/i.test(String((e as Error)?.message ?? e));

const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const CHUNK = 3 * 1024 * 1024; // a multiple of 3 bytes, so the slices' base64 joins up

/** Writes a file into the app's cache folder in slices (a long video never becomes one huge string on the bridge) and
 *  returns its file:// URI. Old files are removed at the next start. */
async function cacheFile(file: Blob, name: string): Promise<string> {
  const path = `${EXPORTS}/${name.replace(/[^\w.-]+/g, "_")}`;
  for (let at = 0; at === 0 || at < file.size; at += CHUNK) {
    const data = await base64(file.slice(at, at + CHUNK));
    if (at === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
  }
  return (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
}

/** Google's "G" mark (Sign in with Google branding). */
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function googleSignIn(kind: "ios" | "android"): GoogleSignIn {
  let webClientId = "", onToken: (token: string) => void = () => {};
  let ready: Promise<unknown> | null = null;
  const init = () => (ready ??= SocialLogin.initialize({
    google: { webClientId, iOSClientId: GOOGLE_IOS_CLIENT_ID || undefined, iOSServerClientId: webClientId, mode: "online" },
  }).catch((e) => { ready = null; throw e; }));
  async function signIn() {
    try {
      await init();
      // No scopes: email, profile and openid are the defaults, and on Android any scopes passed make the plugin refuse
      // ("CANNOT use scopes without modifying the main activity") before the account sheet opens.
      const { result } = await SocialLogin.login({ provider: "google", options: {} });
      if (result.responseType === "online" && result.idToken) onToken(result.idToken);
    } catch (e) {
      if (!canceled(e)) console.warn("sign-in failed:", e);
    }
  }
  return {
    supported: !!(kind === "ios" ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID),
    init(clientId, fn) { webClientId = clientId; onToken = fn; },
    async mount(el, compact) {
      // Google's own look (branding guidelines): the "G" mark on a neutral button, light or dark with the theme.
      const button = Object.assign(document.createElement("button"), { type: "button", className: `google-btn${compact ? " small" : ""}` });
      button.innerHTML = GOOGLE_G;
      button.append(compact ? t.signIn : t.signInWithGoogle);
      button.addEventListener("click", () => void signIn());
      el.replaceChildren(button);
    },
    prompt() { void signIn(); },
    signOut() { void init().then(() => SocialLogin.logout({ provider: "google" })).catch(() => {}); },
  };
}

/** Sign in with Apple (iOS): the system's own sheet (AuthenticationServices). With no scopes given the plugin asks for
 *  the full name and the email. Apple gives the name only the first time; the plugin keeps it and returns it again.
 *  Also returns Apple's one-time authorization code, which the Worker exchanges for the refresh token it revokes when
 *  the account is deleted (App Store guideline 5.1.1(v)); nothing is exchanged on the device. */
let appleReady: Promise<unknown> | null = null;
async function appleSignIn(): Promise<{ idToken: string; name?: string; authorizationCode?: string } | null> {
  try {
    // useProperTokenExchange: the plugin returns the code as `authorizationCode` (otherwise as accessToken.token). If
    // this fails, sign-in still works and the code is read from the old place.
    await (appleReady ??= SocialLogin.initialize({ apple: { useProperTokenExchange: true } })
      .catch((e) => { appleReady = null; console.warn("apple sign-in setup:", e); }));
    const { result } = await SocialLogin.login({ provider: "apple", options: {} });
    if (!("idToken" in result) || !result.idToken) throw new Error("no identity token");
    const name = [result.profile?.givenName, result.profile?.familyName].filter(Boolean).join(" ").trim();
    const code = ("authorizationCode" in result && result.authorizationCode) || result.accessToken?.token || "";
    return { idToken: result.idToken, ...(name ? { name } : {}), ...(code ? { authorizationCode: code } : {}) };
  } catch (e) {
    if ((e as { code?: string })?.code === "USER_CANCELLED" || canceled(e)) return null;
    throw e;
  }
}

/** Android back button: closes the top dialog or sheet, then goes back a screen, then leaves the app. */
function onBack() {
  const top = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1);
  // The same event Escape sends: each dialog's own cancel handler closes it (a sheet also leaves its history entry).
  if (top) return void top.dispatchEvent(new Event("cancel", { cancelable: true }));
  const route = getRoute();
  if (route.depth > 0) back();
  else if (route.view !== "find") navigate("find");
  else void App.minimizeApp();
}

/** Sets the app up (API host, saved session, status bar, back button) and returns its platform adapter. */
export async function startNative(): Promise<Platform> {
  const kind = Capacitor.getPlatform() === "android" ? "android" : "ios";
  setApiBase(API_BASE);
  setSessionToken((await Preferences.get({ key: SESSION_KEY }).catch(() => ({ value: null }))).value);
  // The device's copies of clips, recitations and text (the app still works, more slowly, if the store cannot start).
  const offline: OfflineStore | null = await startOffline(API_BASE).catch((e) => (console.warn("offline store:", e), null));
  void App.addListener("pause", () => void offline?.flush());
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {}); // light text on the dark app bar
  void App.addListener("backButton", onBack);
  void Filesystem.rmdir({ path: EXPORTS, directory: Directory.Cache, recursive: true }).catch(() => {});
  setTimeout(() => void SplashScreen.hide().catch(() => {}), 4000); // in case start-up never reports ready

  let launched: { url: string; at: number } | null = null;
  return {
    kind,
    canShareFile: () => true,
    async shareFile(file) {
      try {
        await Share.share({ files: [await cacheFile(file, file.name)] });
        return true;
      } catch (e) {
        if (canceled(e)) return false;
        throw e;
      }
    },
    canShareLink: () => true,
    async shareLink(url, title) {
      try {
        await Share.share({ url, title });
        return true;
      } catch (e) {
        if (canceled(e)) return false;
        throw e;
      }
    },
    async shareText(text, title) {
      try {
        await Share.share({ text, title });
        return true;
      } catch (e) {
        if (canceled(e)) return false;
        throw e;
      }
    },
    async saveFile(file, name) {
      await SaveToGallery.save({ path: await cacheFile(file, name), type: file.type });
    },
    async copyText(text) { await Clipboard.write({ string: await text }); },
    haptic(kind = "light") {
      void (kind === "success" ? Haptics.notification({ type: NotificationType.Success }) : Haptics.impact({ style: ImpactStyle.Light }))
        .catch(() => {});
    },
    openExternal(url) { window.open(url, "_blank"); }, // the app opens it in the system browser
    appVersion: () => App.getInfo().then((i) => i.version, () => null),
    googleSignIn: googleSignIn(kind),
    ...(kind === "ios" ? { appleSignIn } : {}),
    on(event: Lifecycle, fn) { void (event === "pause" ? App.addListener("pause", fn) : App.addListener("resume", fn)); },
    async launchUrl() {
      const url = (await App.getLaunchUrl().catch(() => undefined))?.url;
      if (!url) return null;
      launched = { url, at: Date.now() };
      try { return new URL(url); } catch { return null; }
    },
    onDeepLink(fn) {
      void App.addListener("appUrlOpen", ({ url }) => {
        // iOS also reports the link that started the app, which start-up has already opened.
        if (launched?.url === url && Date.now() - launched.at < 10_000) return void (launched = null);
        try { fn(new URL(url)); } catch { /* not a URL */ }
      });
    },
    async saveSession(token) {
      setSessionToken(token);
      void offline?.clearUser(); // another person's (or nobody's) data from now on
      await (token ? Preferences.set({ key: SESSION_KEY, value: token }) : Preferences.remove({ key: SESSION_KEY })).catch(() => {});
    },
    ready() { void SplashScreen.hide().catch(() => {}); },
    reminders,
    nowPlaying,
  };
}

// ---------- the lock screen card and buttons (the media-session plugin) ----------

/** iOS: MPNowPlayingInfoCenter and the remote commands. Android: a media notification, and while the state is playing or
 *  paused the plugin's foreground service, which is what keeps the web view's audio going with the screen off. The web
 *  view's own Media Session API does not reach either, so the app uses the plugin instead. */
const nowPlaying: NowPlaying = {
  set(info) {
    // The card needs an absolute image URL (the app's page is not served from the API's host).
    if (info) void MediaSession.setMetadata({ ...info, artwork: [{ src: info.artwork || `${API_BASE}/icons/icon-512.png`, sizes: "512x512", type: "image/png" }] }).catch(() => {});
    else void MediaSession.setMetadata({ title: "", artist: "", album: "", artwork: [] }).catch(() => {}); // the plugin has no clear
  },
  state(playbackState) { void MediaSession.setPlaybackState({ playbackState }).catch(() => {}); },
  handle(action, fn) { void MediaSession.setActionHandler({ action }, fn ? () => fn() : null).catch(() => {}); },
};

// ---------- the daily reminder (local notifications: the device shows them at their time, no server push) ----------

/** Reminder ids are REMINDER_IDS.from..to; other notifications (none yet) are left alone. */
const REMINDER_IDS = { from: 7000, to: 7099 };
const ours = (id: number) => id >= REMINDER_IDS.from && id <= REMINDER_IDS.to;
const reminders: Reminders = {
  kind: "local",
  async allow() {
    const now = await LocalNotifications.checkPermissions().catch(() => null);
    if (now?.display === "granted") return true;
    const asked = await LocalNotifications.requestPermissions().catch(() => null);
    return asked?.display === "granted";
  },
  async schedule(list) {
    await reminders.cancel();
    if (!list.length) return;
    await LocalNotifications.schedule({
      // Not exact (isExactNotification false): a daily reminder needs no exact alarm, and asking for one opens Android's
      // "Alarms & reminders" settings and needs a Play declaration (SCHEDULE_EXACT_ALARM is removed in the manifest).
      notifications: list.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true }, isExactNotification: false, extra: { kind: "today" } })),
    });
  },
  async cancel() {
    const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
    const mine = pending.notifications.filter((n) => ours(n.id)).map((n) => ({ id: n.id }));
    if (mine.length) await LocalNotifications.cancel({ notifications: mine }).catch(() => {});
  },
  onOpen(fn) {
    void LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
      if (ours(notification.id)) fn();
    });
  },
};
