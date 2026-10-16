-- Anonymous counts on ayahs and the person's private impact (GET /api/stats/ayahs, GET /api/stats/me; src/routes/stats.ts).
-- Only counts: nothing here says who opened a link or who made something from it.

-- shares.ref: the link's first ayah ("2:255"), so links per ayah are counted without reading every recipe.
ALTER TABLE shares ADD COLUMN ref TEXT;
UPDATE shares SET ref = json_extract(recipe, '$.surah') || ':' || json_extract(recipe, '$.from') WHERE ref IS NULL;
CREATE INDEX shares_ref ON shares(ref, created_at);
-- shares.anon_id (in the table since 0001, unused until now): the anonymous device id that created the link while signed
-- out, so that device alone can see how its links did. Signed in, shares.user_id says it.
CREATE INDEX shares_anon ON shares(anon_id) WHERE anon_id IS NOT NULL;

-- share_daily: per link and UTC day, how often the link was opened in the app (opens), and how often someone who opened
-- it exported or linked the same design again (reshares) or a design they changed (makes). Written through the counter
-- buffer (src/lib/counters.ts); rows exist only for links that were used that day.
CREATE TABLE share_daily (
  code     TEXT NOT NULL,
  day      TEXT NOT NULL,                -- YYYY-MM-DD (UTC)
  opens    INTEGER NOT NULL DEFAULT 0,
  reshares INTEGER NOT NULL DEFAULT 0,
  makes    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, day)
) WITHOUT ROWID;

-- Favourites per ayah (likes), and exports per ayah over all days: only export_ref rows pay for this index, and only
-- for the first export of an ayah on a day (later ones only change the value).
CREATE INDEX favourites_ref ON favourites(ref);
CREATE INDEX daily_stats_export_ref ON daily_stats(dim, day) WHERE metric = 'export_ref';
