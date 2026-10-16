-- News from AyahShare for everyone (owner, 12 Oct 2026): written on the admin's Announcements page, shown in the app's
-- Notifications (GET /api/announcements). Deleting one removes it for everyone.

CREATE TABLE announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,              -- at most 80 characters
  body       TEXT NOT NULL DEFAULT '',   -- at most 280 characters
  link       TEXT,                       -- an app path ("/discover") or an https address
  created_by TEXT,                       -- the admin's email (null for a script using ADMIN_TOKEN)
  created_at INTEGER NOT NULL            -- ms since epoch
);
CREATE INDEX announcements_created ON announcements(created_at);
