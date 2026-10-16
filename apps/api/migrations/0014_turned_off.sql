-- What the admin turned off (owner, 15 Oct 2026; admin Library): tafsirs, reciters and translation voices the app no
-- longer offers. A row = off; deleting it turns the item back on. Read by GET /api/config (`off`) and the tafsir routes.

CREATE TABLE turned_off (
  kind   TEXT NOT NULL CHECK (kind IN ('tafsir', 'reciter', 'voice')),
  id     TEXT NOT NULL,          -- tafsir id (as text), reciter folder, voice id
  by     TEXT,                   -- the admin's email (null for a script using ADMIN_TOKEN)
  at     INTEGER NOT NULL,       -- ms since epoch
  PRIMARY KEY (kind, id)
);
