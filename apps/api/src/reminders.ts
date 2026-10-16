// The web's daily reminder (owner, 12 Oct 2026), run by the 15-minute cron (wrangler.jsonc, src/index.ts): every
// subscription whose time has come (push_reminders.next_at, set by POST /api/push) gets one Web Push message, so a
// reminder arrives up to 15 minutes after the chosen time. The message names the admin's pick for the person's local
// date (table daily_ayah) when there is one; otherwise the app picks the ayah on the device, so the message just says
// it is ready. After a send the next one is the chosen time on a later local date, so a reminder that was late (the
// Worker down for a day) goes once and then keeps to its time. 404/410 from the push service = the browser
// unsubscribed: the row goes. Other failures retry an hour later; after 10 in a row the row goes.
import type { AyahsEn, PushMessage, Ref, Surah } from "../../../contracts/types";
import { readData } from "./lib/data";
import { localDay, nextSendAt } from "./lib/tz";
import { importVapidKey, pushSender, vapidKeys } from "./lib/webpush";

export const REMINDER_CRON = "*/15 * * * *";
// Up to 45 sends a run (one tick every 15 minutes: 4,320 a day), inside the Workers free plan's 50 outbound requests per
// invocation; raise it on the paid plan when more people use the reminder.
const BATCH = 45;
const CONCURRENCY = 20;
const MAX_FAILS = 10;
const RETRY_MS = 3600_000;
const BODY_MAX = 180;
const TITLE = "Today's ayah";
const DEFAULT_BODY = "Today's ayah is ready to watch and share.";
const URL_PATH = "/app?today=reminder";

type Row = { endpoint: string; p256dh: string; auth: string; time: string; tz: string; fails: number };

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The reminder for a local date: the admin's pick (surah name, reference, its English translation) or the plain one. */
export async function reminderMessage(env: Env, day: string): Promise<PushMessage> {
  const pick = await env.DB.prepare("SELECT ref FROM daily_ayah WHERE day = ?").bind(day).first<{ ref: Ref }>();
  if (!pick) return { title: TITLE, body: DEFAULT_BODY, url: URL_PATH };
  const [surahs, ayahsEn] = await Promise.all([readData<Surah[]>(env, "surahs.json"), readData<AyahsEn>(env, "ayahs-en.json")]);
  const name = surahs?.[Number(pick.ref.split(":")[0]) - 1]?.name_en;
  const text = ayahsEn?.[pick.ref];
  return { title: `${TITLE} · ${name ? `${name} ` : ""}${pick.ref}`, body: text ? cut(text, BODY_MAX) : DEFAULT_BODY, url: URL_PATH };
}

/** Sends the reminders that are due (up to BATCH a run) and returns what happened. Does nothing without the VAPID keys. */
export async function sendDueReminders(env: Env, now = Date.now()): Promise<{ sent: number; removed: number; failed: number }> {
  const done = { sent: 0, removed: 0, failed: 0 };
  const keys = vapidKeys(env);
  if (!keys) return done;
  let signingKey: CryptoKey;
  try {
    signingKey = await importVapidKey(keys);
  } catch (e) {
    console.error("reminders: bad VAPID keys:", String(e)); // keep the rows: a fixed secret sends them on the next run
    return done;
  }
  const { results: rows } = await env.DB.prepare("SELECT endpoint, p256dh, auth, time, tz, fails FROM push_reminders WHERE next_at <= ? ORDER BY next_at LIMIT ?")
    .bind(now, BATCH).all<Row>();
  if (!rows.length) return done;

  const send = pushSender(keys.publicKey, signingKey, now);
  const messages = new Map<string, Promise<string>>(); // per local date
  const message = (day: string) => {
    let m = messages.get(day);
    if (!m) messages.set(day, (m = reminderMessage(env, day).then((msg) => JSON.stringify(msg))));
    return m;
  };
  const statements: D1PreparedStatement[] = [];
  const remove = (row: Row) => {
    done.removed++;
    statements.push(env.DB.prepare("DELETE FROM push_reminders WHERE endpoint = ?").bind(row.endpoint));
  };

  const one = async (row: Row) => {
    let status = 0;
    try {
      const res = await send(row, await message(localDay(now, row.tz)));
      status = res.status;
      await res.body?.cancel();
      if (res.ok) {
        statements.push(env.DB.prepare("UPDATE push_reminders SET next_at = ?, fails = 0 WHERE endpoint = ?").bind(nextSendAt(row.time, row.tz, now + 60_000), row.endpoint));
        done.sent++;
        return;
      }
    } catch (e) {
      console.warn("reminder send failed:", String(e));
    }
    if (status === 404 || status === 410) return remove(row);
    done.failed++;
    if (row.fails + 1 >= MAX_FAILS) return remove(row);
    statements.push(env.DB.prepare("UPDATE push_reminders SET next_at = ?, fails = fails + 1 WHERE endpoint = ?").bind(now + RETRY_MS, row.endpoint));
  };

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) await one(rows[next++]);
  }));
  await env.DB.batch(statements);
  console.log("reminders:", JSON.stringify(done));
  return done;
}
