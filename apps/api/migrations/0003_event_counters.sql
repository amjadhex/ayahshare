-- Event metrics kept in D1 (no Cloudflare API token needed). POST /api/events adds each batch to:
--   daily_stats   counters per UTC day (metric, dim): events by name, exports, searches, ... (src/lib/stats.ts)
--   device_stage  which devices reached which funnel stage on a day (open, search, ayah, export, share)
-- Analytics Engine still receives every raw event as the archive.

CREATE TABLE device_stage (
  day   TEXT NOT NULL,                  -- YYYY-MM-DD (UTC)
  anon  TEXT NOT NULL,                  -- anonymous device id
  stage TEXT NOT NULL,                  -- open | search | ayah | export | share
  PRIMARY KEY (day, anon, stage)
) WITHOUT ROWID;                        -- one b-tree: one row written per new (day, device, stage)

-- Admin queries read one metric over a day range (top lists, sums, daily series).
CREATE INDEX daily_stats_metric ON daily_stats(metric, day);
