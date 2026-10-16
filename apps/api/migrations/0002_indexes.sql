-- Indexes for the admin dashboard, the nightly rollup and account deletion.
CREATE INDEX devices_first_seen ON devices(first_seen);
CREATE INDEX devices_user ON devices(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX users_last_login ON users(last_login);
CREATE INDEX users_created ON users(created_at);
CREATE INDEX shares_created ON shares(created_at);
CREATE INDEX reports_status ON reports(status, id);
CREATE INDEX reports_clip ON reports(clip_id) WHERE clip_id IS NOT NULL;
CREATE INDEX clips_status ON clips(status, created_at);
CREATE INDEX query_cache_hits ON query_cache(hits);
CREATE INDEX sessions_expires ON sessions(expires_at);
