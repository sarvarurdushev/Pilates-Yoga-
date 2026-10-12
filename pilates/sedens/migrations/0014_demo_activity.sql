-- SEDENS 0014: when each demonstration was created and last used.
--
-- Free hosting gives every visitor their own demonstration (about 76 MB each,
-- mostly the coaching workspace's sample analyses). demo_cleanup removes the ones
-- nobody has used for SEDENS_DEMO_TTL_HOURS. Keyed by the visitor's demonstration
-- key (the 32 hex characters in demo-<key>), so the row outlives nothing: it is
-- deleted with the demonstration. It holds no personal content.
CREATE TABLE IF NOT EXISTS s_demo_activity(
  demo_key TEXT PRIMARY KEY CHECK(length(demo_key) = 32 AND demo_key NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS s_demo_activity_last_used ON s_demo_activity(last_used_at);
