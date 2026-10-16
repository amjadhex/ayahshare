-- One-off cleanup (12 Oct 2026): the store-screenshot scripts (marketing/tools, headless Chrome on the owner's Mac in
-- Bahrain) ran against ayahshare.com on 8–9 Oct and were counted as 180 devices. Since then the web app sends no events
-- from automated browsers (apps/web/src/analytics.ts, navigator.webdriver).
-- Removes those devices and their funnel rows, and takes them out of the nightly snapshots for 8–11 Oct. Event
-- counters (daily_stats "event:*", searches, exports) cannot be split by device and stay as they are.
-- Run once: npx wrangler d1 execute quran-design --remote --file=maintenance/2026-10-12-remove-test-devices.sql

-- 1. Snapshots first, while the devices still exist (same rules as src/rollup.ts).
WITH t AS (SELECT first_seen, last_seen FROM devices WHERE platform = 'mac' AND country = 'BH' AND user_id IS NULL
  AND first_seen >= 1791417600000 AND first_seen < 1791590400000)
UPDATE daily_stats SET value = value - (
  SELECT COUNT(*) FROM t WHERE t.first_seen < (strftime('%s', daily_stats.day) + 86400) * 1000 AND (
    daily_stats.metric = 'devices_total'
    OR (daily_stats.metric = 'devices_new' AND t.first_seen >= strftime('%s', daily_stats.day) * 1000)
    OR (daily_stats.metric = 'devices_active' AND t.last_seen >= strftime('%s', daily_stats.day) * 1000)))
WHERE metric IN ('devices_total', 'devices_new', 'devices_active') AND dim = '' AND day BETWEEN '2026-10-08' AND '2026-10-11';

-- 2. Their funnel rows (299 expected).
DELETE FROM device_stage WHERE anon IN (SELECT anon_id FROM devices WHERE platform = 'mac' AND country = 'BH'
  AND user_id IS NULL AND first_seen >= 1791417600000 AND first_seen < 1791590400000);

-- 3. The devices (180 expected).
DELETE FROM devices WHERE platform = 'mac' AND country = 'BH' AND user_id IS NULL
  AND first_seen >= 1791417600000 AND first_seen < 1791590400000;
