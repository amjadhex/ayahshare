-- Sign-in with a 6-digit code sent by email (POST /api/auth/email/start and /verify, src/routes/auth.ts), next to Google.

-- Email-only accounts: users.google_sub stays NOT NULL UNIQUE (no table rebuild). An account made by email gets the
-- placeholder 'email:<users.id>' there, which no Google subject (a number) can equal. Signing in with Google later, with
-- the same verified email, puts the Google subject in its place (the accounts are joined, not doubled).
-- Accounts are found by email case-insensitively: email sign-in, and Google finding an email-only account to join.
CREATE INDEX users_email ON users(lower(email));

-- One row per email address (trimmed, lower case): its current code and how many codes it was sent lately.
-- code_hash is HMAC-SHA256(AUTH_CODE_SECRET, email + code) in hex, never the code; NULL once used or voided. A new code
-- replaces the old one (attempts back to 0). The row itself stays until its hour is over, so the per-address limits
-- (one code per 30 s, five per hour) hold after a sign-in too; the nightly job removes old rows (src/rollup.ts).
CREATE TABLE email_codes (
  email        TEXT PRIMARY KEY,
  code_hash    TEXT,
  expires_at   INTEGER NOT NULL,          -- created_at + 10 minutes
  attempts     INTEGER NOT NULL DEFAULT 0, -- wrong guesses at this code (5 = void)
  created_at   INTEGER NOT NULL,          -- when this code was made and sent
  window_start INTEGER NOT NULL,          -- start of the current hour of sends
  sends        INTEGER NOT NULL DEFAULT 1 -- codes sent since window_start
) WITHOUT ROWID;
