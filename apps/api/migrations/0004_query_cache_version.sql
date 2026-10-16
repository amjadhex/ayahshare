-- A stored full search result belongs to one topics.json build: src/routes/search.ts reads only rows of the current
-- version, at most 30 days old. Rows written before this (smoke tests, the Workers AI outage) get version '' and are
-- never served again; the nightly job removes them once they are 30 days old (src/rollup.ts).
ALTER TABLE query_cache ADD COLUMN version TEXT NOT NULL DEFAULT '';
