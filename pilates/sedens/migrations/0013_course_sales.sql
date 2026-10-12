-- SEDENS 0013: commercial availability, kept apart from reviewed content.
--
-- A course's content, distribution and price change only through SEDENS review
-- (the published version's snapshot). Whether new customers may buy that approved
-- version right now is an operational decision of the course's creator, recorded
-- here: a row means "new sales of this published version are paused".
--
-- * version, price_type, amount_minor, currency: the published version and its
--   approved price when the pause was made. The pause applies only while the course
--   still publishes that version at that price; a newer approved version's own
--   sale status then applies.
-- * Nothing here touches enrollments, entitlements, facility settings or the
--   snapshot; SEDENS suspension (s_courses.suspended_at) is separate and wins.
CREATE TABLE IF NOT EXISTS s_course_sales(
  course_id TEXT PRIMARY KEY REFERENCES s_courses ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  price_type TEXT NOT NULL CHECK(price_type IN ('free','paid')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
  currency TEXT NOT NULL CHECK(currency IN ('KRW','USD')),
  paused_by TEXT REFERENCES p_users ON DELETE SET NULL,
  paused_at TEXT NOT NULL
);
