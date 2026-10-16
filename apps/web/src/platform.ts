// Platform adapter: everything that works differently in the browser and in the iOS / Android app goes through here
// (share sheet, saving files, clipboard, haptics, external links, Google sign-in, the sign-in session, app lifecycle,
// deep links and the launch screen). The web implementation is below. The app implementation is `platform-native.ts`
// (Capacitor plugins), loaded at start-up only when the page runs inside the app, so the web never downloads it and the
// rest of the code never checks where it runs.

import { installBusy } from "./pwa"; // keeps the install sheet away from an open share sheet

export interface GoogleSignIn {
  /** False when sign-in cannot work here even with the server's client id (the app: no client id for this platform
   *  was built in yet). The sign-in controls are then hidden. */
  readonly supported: boolean;
  /** Remembers the client id and what to do with the ID token once someone signs in. */
  init(clientId: string, onToken: (idToken: string) => void): void;
  /** Shows the sign-in control inside `el` (web: Google's button; app: a button that opens the system sign-in). */
  mount(el: HTMLElement, compact: boolean): Promise<void>;
  /** Starts sign-in without a button (web: the one-tap prompt). */
  prompt(): void;
  /** Called after signing out so the next visit does not sign in again on its own. */
  signOut(): void;
}

export type Lifecycle = "pause" | "resume";

export interface Platform {
  readonly kind: "web" | "ios" | "android";
  /** True when shareFile() can hand this file to the system share sheet. */
  canShareFile(file: File): boolean;
  /** Opens the system share sheet with a file. Resolves false when it was closed without sharing. */
  shareFile(file: File): Promise<boolean>;
  /** True when shareLink() opens a system share sheet (otherwise copy the link instead). */
  canShareLink(): boolean;
  /** Opens the system share sheet with a link. Resolves false when it was closed without sharing. */
  shareLink(url: string, title: string): Promise<boolean>;
  /** Opens the system share sheet with text (only where canShareLink()). Resolves false when closed without sharing. */
  shareText(text: string, title: string): Promise<boolean>;
  /** Saves a file on the device (web: download; app: Photos / Gallery or Files). */
  saveFile(file: Blob, name: string): Promise<void>;
  /** Copies text. Takes a promise so the copy can start inside the tap and finish when the text is ready (Safari). */
  copyText(text: string | Promise<string>): Promise<void>;
  /** A short tap of the vibration motor, where there is one. */
  haptic(kind?: "light" | "success"): void;
  /** Opens a link outside the app (web: new tab; app: system browser). */
  openExternal(url: string): void;
  /** The installed app's version ("1.0.2"); null on the web. */
  appVersion(): Promise<string | null>;
  googleSignIn: GoogleSignIn;
  /** Sign in with Apple, only where it is offered (the iOS app; App Store guideline 4.8): Apple's sheet, then the
   *  identity token, the name Apple gives on the first sign-in, and the one-time authorization code (exchanged by the
   *  Worker for the refresh token it revokes when the account is deleted). Resolves null when it was cancelled. */
  appleSignIn?: () => Promise<{ idToken: string; name?: string; authorizationCode?: string } | null>;
  /** App goes to the background / comes back. */
  on(event: Lifecycle, fn: () => void): void;
  /** The link that started the app, if any (the app only; on the web the page's own address is read instead). */
  launchUrl(): Promise<URL | null>;
  /** A link opened while the app is running (the app only; on the web a link loads the page). */
  onDeepLink(fn: (url: URL) => void): void;
  /** Keeps the sign-in session: the app stores the token and sends it with API requests; the web has a cookie. */
  saveSession(token: string | null): Promise<void>;
  /** The first screen is ready (the app hides its launch screen). */
  ready(): void;
  /** The daily reminder of today's ayah (the app only: notifications the device shows by itself, today.ts). */
  reminders?: Reminders;
  /** What is playing on the lock screen, the notification shade and the Control Centre, with its buttons (a whole surah,
   *  surah.ts). The web: the Media Session API; the app: the media-session plugin (on Android its service also keeps the
   *  recitation going with the screen off). */
  nowPlaying: NowPlaying;
}

export interface NowPlayingInfo { title: string; artist: string; album: string; artwork?: string }
export type NowPlayingAction = "play" | "pause" | "previoustrack" | "nexttrack";
export interface NowPlaying {
  /** What is playing (null: nothing; the lock screen card goes). */
  set(info: NowPlayingInfo | null): void;
  state(state: "playing" | "paused" | "none"): void;
  /** The lock screen buttons (null: that button goes). */
  handle(action: NowPlayingAction, fn: (() => void) | null): void;
}

export interface Reminder { id: number; at: Date; title: string; body: string }
export interface Reminders {
  /** "local": the device shows the reminders it is given (the app); "push": the server sends one a day at the time
   *  (the web, webpush.ts). */
  readonly kind: "local" | "push";
  /** Asks for permission to show notifications when it has not been given yet; false when it is refused. */
  allow(): Promise<boolean>;
  /** Replaces the reminders before: `list` (local) or the daily `time` "HH:MM" (push). */
  schedule(list: Reminder[], time: string): Promise<void>;
  /** Removes every scheduled reminder. */
  cancel(): Promise<void>;
  /** A reminder was tapped (also the one that opened the app). */
  onOpen(fn: () => void): void;
}

// ---------- web ----------

/** The Media Session API (Chrome, Safari, Firefox; nothing where it is missing). */
export const webNowPlaying: NowPlaying = {
  set(info) {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms || typeof MediaMetadata === "undefined") return;
    ms.metadata = info ? new MediaMetadata({ ...info, artwork: info.artwork ? [{ src: info.artwork, sizes: "512x512", type: "image/png" }] : [] }) : null;
  },
  state(state) { if (typeof navigator !== "undefined" && navigator.mediaSession) navigator.mediaSession.playbackState = state; },
  handle(action, fn) {
    try { navigator.mediaSession?.setActionHandler(action, fn); } catch { /* an action this browser does not have */ }
  },
};

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; use_fedcm_for_prompt?: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, string>): void;
  prompt(): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
    Capacitor?: { isNativePlatform?(): boolean; getPlatform?(): string };
  }
}

function webGoogleSignIn(): GoogleSignIn {
  let clientId = "", onToken: (t: string) => void = () => {};
  let gsi: Promise<GoogleId> | null = null;
  const load = () => (gsi ??= new Promise<GoogleId>((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: "https://accounts.google.com/gsi/client", async: true });
    s.onload = () => {
      const id = window.google!.accounts.id;
      id.initialize({ client_id: clientId, callback: (r) => onToken(r.credential), use_fedcm_for_prompt: true });
      resolve(id);
    };
    s.onerror = () => { gsi = null; reject(new Error("gsi")); };
    document.head.append(s);
  }));
  return {
    supported: true,
    init(id, fn) { clientId = id; onToken = fn; },
    async mount(el, compact) {
      const id = await load();
      el.replaceChildren();
      id.renderButton(el, {
        type: compact ? "icon" : "standard", size: compact ? "medium" : "large", shape: "pill", text: compact ? "signin" : "signin_with",
        theme: "filled_black", locale: document.documentElement.lang,
      });
    },
    prompt() { load().then((id) => id.prompt(), () => {}); },
    signOut() { window.google?.accounts.id.disableAutoSelect(); },
  };
}

async function writeClipboard(text: string | Promise<string>) {
  // ClipboardItem with a promise keeps the user gesture in Safari while the text is still being made.
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": Promise.resolve(text).then((s) => new Blob([s], { type: "text/plain" })) })]);
      return;
    } catch { /* fall back below */ }
  }
  await navigator.clipboard.writeText(await text);
}

const aborted = (e: unknown) => (e as Error)?.name === "AbortError";

export const webPlatform: Platform = {
  kind: "web",
  canShareFile: (file) => !!navigator.canShare?.({ files: [file] }),
  async shareFile(file) {
    const done = installBusy();
    try { await navigator.share({ files: [file] }); return true; } catch (e) { if (aborted(e)) return false; throw e; } finally { done(); }
  },
  canShareLink: () => typeof navigator.share === "function",
  async shareLink(url, title) {
    const done = installBusy();
    try { await navigator.share({ url, title }); return true; } catch (e) { if (aborted(e)) return false; throw e; } finally { done(); }
  },
  async shareText(text, title) {
    const done = installBusy();
    try { await navigator.share({ text, title }); return true; } catch (e) { if (aborted(e)) return false; throw e; } finally { done(); }
  },
  async saveFile(file, name) {
    const url = URL.createObjectURL(file);
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  copyText: writeClipboard,
  haptic(kind = "light") {
    try { navigator.vibrate?.(kind === "success" ? [12, 60, 12] : 8); } catch { /* not allowed before a tap */ }
  },
  openExternal(url) { window.open(url, "_blank", "noopener"); },
  appVersion: async () => null,
  googleSignIn: webGoogleSignIn(),
  on(event, fn) {
    document.addEventListener("visibilitychange", () => {
      if ((document.visibilityState === "hidden") === (event === "pause")) fn();
    });
  },
  launchUrl: async () => null,
  onDeepLink() { /* on the web a link opens the page itself, read at start-up */ },
  saveSession: async () => { /* HTTP-only cookie */ },
  ready() {},
  nowPlaying: webNowPlaying,
};

// ---------- selection ----------

/** The adapter in use. `initPlatform()` swaps in the app implementation when running inside the iOS / Android app. */
export let platform: Platform = webPlatform;

/** True inside the iOS / Android app (Capacitor's bridge is injected before the page's scripts run). */
export const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();

export async function initPlatform() {
  if (isNativeApp()) platform = await (await import("./platform-native")).startNative();
  document.documentElement.dataset.platform = platform.kind;
}
