-- Quran.design initial schema. Times are unix milliseconds.

-- Anonymous devices (every visitor). user_id is set once the device signs in.
CREATE TABLE devices (
  anon_id    TEXT PRIMARY KEY,
  user_id    TEXT,
  country    TEXT,
  platform   TEXT,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  sessions   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX devices_last_seen ON devices(last_seen);

-- Signed-in accounts (Google).
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- sha256 of the cookie token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE creations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  recipe     TEXT NOT NULL,             -- JSON Recipe
  created_at INTEGER NOT NULL
);
CREATE INDEX creations_user ON creations(user_id, created_at DESC);

CREATE TABLE favourites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ref)
);

-- Background library (also published as data/clips.json for the client).
CREATE TABLE clips (
  id         TEXT PRIMARY KEY,          -- pb123 / px123
  source     TEXT NOT NULL,             -- pixabay | pexels
  source_id  TEXT NOT NULL,
  author     TEXT,
  author_url TEXT,
  page_url   TEXT,
  caption    TEXT,
  tags       TEXT,                      -- comma separated
  duration   REAL,
  width      INTEGER,
  height     INTEGER,
  bytes      INTEGER,
  video_key  TEXT NOT NULL,
  thumb_key  TEXT NOT NULL,
  poster_key TEXT NOT NULL,
  safety     TEXT,                      -- JSON {people: p, animals: p, ...}
  quality    REAL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'rejected')),
  created_at INTEGER NOT NULL
);

CREATE TABLE shares (
  code       TEXT PRIMARY KEY,
  recipe     TEXT NOT NULL,             -- JSON Recipe
  og_key     TEXT,
  user_id    TEXT,
  anon_id    TEXT,
  created_at INTEGER NOT NULL,
  opens      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE query_cache (
  q          TEXT PRIMARY KEY,          -- normalised query
  topic      TEXT,
  result     TEXT NOT NULL,             -- JSON SearchResponse (mode=full)
  created_at INTEGER NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  anon_id    TEXT,
  user_id    TEXT,
  kind       TEXT NOT NULL,
  ref        TEXT,
  clip_id    TEXT,
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed'))
);

-- Nightly rollups from Analytics Engine (which keeps raw events for 3 months).
CREATE TABLE daily_stats (
  day    TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
  metric TEXT NOT NULL,
  dim    TEXT NOT NULL DEFAULT '',
  value  REAL NOT NULL,
  PRIMARY KEY (day, metric, dim)
);

CREATE TABLE luna_usage (
  day          TEXT PRIMARY KEY,
  calls        INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0
);
