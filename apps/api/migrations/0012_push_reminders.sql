-- The web's daily reminder (owner, 12 Oct 2026): one row per Web Push subscription (POST /api/push), sent by the
-- 15-minute cron (src/reminders.ts) when next_at has passed. No user id: the browser's endpoint is the only key, and
-- DELETE /api/push or the push service answering 404/410 removes the row.

CREATE TABLE push_reminders (
  endpoint   TEXT PRIMARY KEY,           -- the push service URL (https, from PushSubscription.endpoint)
  p256dh     TEXT NOT NULL,              -- the browser's P-256 public key (base64url, 65 bytes)
  auth       TEXT NOT NULL,              -- the browser's auth secret (base64url, 16 bytes)
  time       TEXT NOT NULL,              -- "HH:MM", the person's wall clock in tz
  tz         TEXT NOT NULL,              -- IANA zone, e.g. "Asia/Kolkata"
  next_at    INTEGER NOT NULL,           -- ms since epoch (UTC) of the next send
  created_at INTEGER NOT NULL,           -- ms since epoch
  fails      INTEGER NOT NULL DEFAULT 0  -- failed sends in a row (other than 404/410); the row goes after 10
);
CREATE INDEX push_reminders_next ON push_reminders (next_at);
