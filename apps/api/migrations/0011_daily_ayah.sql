-- Today's ayah (owner, 12 Oct 2026): the days an admin chose the ayah for (admin Daily ayah; GET /api/daily).
-- Every other day is the app's own pick (apps/web src/discover.ts), so a day has a row only when someone replaced it.

CREATE TABLE daily_ayah (
  day    TEXT PRIMARY KEY,               -- YYYY-MM-DD, the person's local date
  ref    TEXT NOT NULL,                  -- "2:255"
  set_by TEXT,                           -- the admin's email (null for a script using ADMIN_TOKEN)
  set_at INTEGER NOT NULL                -- ms since epoch
);
