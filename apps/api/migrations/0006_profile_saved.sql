-- Track G: the profile page and designs saved automatically on export / share.
-- users: what the person sets on their profile. All optional; NULL = not set.
ALTER TABLE users ADD COLUMN display_name TEXT;                          -- shown instead of the Google name
ALTER TABLE users ADD COLUMN prefs TEXT;                                 -- JSON contracts Prefs (defaults for new designs)
ALTER TABLE users ADD COLUMN interests TEXT;                             -- JSON array of topic ids (≤ 10)
ALTER TABLE users ADD COLUMN country TEXT;                               -- ISO 3166-1 alpha-2, chosen by the person
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;                                 -- E.164, not verified
ALTER TABLE users ADD COLUMN phone_opt_in INTEGER NOT NULL DEFAULT 0;    -- daily ayah on WhatsApp (coming later)
ALTER TABLE users ADD COLUMN updated_at INTEGER;                         -- last profile change

-- creations: how the design was saved, its small thumbnail in R2 (creations/<id>.jpg) and when it was last saved.
-- An identical design (same validated recipe JSON, user_id + recipe) is updated instead of copied (src/routes/account.ts).
ALTER TABLE creations ADD COLUMN kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'image', 'link'));
ALTER TABLE creations ADD COLUMN thumb_key TEXT;
ALTER TABLE creations ADD COLUMN updated_at INTEGER;
UPDATE creations SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX creations_user_updated ON creations(user_id, updated_at DESC);

-- Profile stats count share links per account; account deletion unlinks them.
CREATE INDEX shares_user ON shares(user_id) WHERE user_id IS NOT NULL;
