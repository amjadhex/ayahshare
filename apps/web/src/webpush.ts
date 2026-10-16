// The web's daily reminder (owner, 12 Oct 2026): Web Push. The page cannot wake itself at 7:00, so the Worker sends the
// reminder at the person's time in their time zone (apps/api, cron every 15 minutes) and the service worker (sw.ts)
// shows it; a tap opens /app?today=reminder, which opens today's ayah (app.ts). Offered where the browser has push and a
// service worker (Chrome, Edge, Firefox, Android; on an iPhone only once AyahShare is added to the Home Screen) and the
// server has a VAPID key (PublicConfig.vapidPublicKey). The app uses local notifications instead (platform-native.ts).
import * as api from "./api";
import type { Reminders } from "./platform";

let publicKey: string | null = null;
/** The server's public VAPID key (app.ts, from /api/config); without it there is no web reminder. */
export const setVapidKey = (key: string | null | undefined) => { publicKey = key || null; };

const supported = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;

const bytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

const subscription = async (): Promise<PushSubscription | null> => {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
};

const web: Reminders = {
  kind: "push",
  async allow() {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  },
  async schedule(_list, time) {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(publicKey!) }));
    const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await api.pushSubscribe({ endpoint, keys, time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
  },
  async cancel() {
    const sub = await subscription().catch(() => null);
    if (!sub) return;
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => false);
  },
  onOpen() { /* a tap opens /app?today=reminder, read at start-up (app.ts) */ },
};

/** The web reminder, where this browser can have it. */
export const webReminders = (): Reminders | undefined => (publicKey && supported() ? web : undefined);
