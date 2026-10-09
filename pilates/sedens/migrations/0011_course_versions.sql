-- SEDENS 0011: immutable course versions and version-linked reviews.
-- Submitting a draft freezes it into a snapshot (the whole course tree, with
-- exercise text, anatomy and media rights copied in). A version's snapshot can
-- never change; only its review state moves. Customers and enrollments always
-- read a version, so editing the draft never changes what anyone is using.
CREATE TABLE IF NOT EXISTS s_course_versions(
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  state TEXT NOT NULL CHECK(state IN ('submitted','needs_revision','approved','published','superseded','withdrawn')),
  snapshot TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  submitted_by TEXT REFERENCES p_users ON DELETE SET NULL,
  submitted_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  decided_at TEXT,
  UNIQUE(course_id, version)
);

CREATE TRIGGER IF NOT EXISTS s_course_versions_frozen
BEFORE UPDATE OF course_id, version, snapshot, snapshot_sha256, submitted_at ON s_course_versions
BEGIN
  SELECT RAISE(ABORT, 'course versions are immutable');
END;

-- Media a version uses; such media can be retired but stays available to it.
CREATE TABLE IF NOT EXISTS s_course_version_media(
  version_id TEXT NOT NULL REFERENCES s_course_versions ON DELETE CASCADE,
  object_id TEXT NOT NULL REFERENCES s_media_objects ON DELETE CASCADE,
  PRIMARY KEY(version_id, object_id)
);

CREATE TABLE IF NOT EXISTS s_course_reviews(
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  version INTEGER NOT NULL,
  reviewer_id TEXT REFERENCES p_users ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','needs_revision','rejected','suspended','reinstated')),
  checklist TEXT NOT NULL DEFAULT '{}',
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS s_course_versions_state ON s_course_versions(state, course_id);
CREATE INDEX IF NOT EXISTS s_course_reviews_course ON s_course_reviews(course_id, version);
CREATE INDEX IF NOT EXISTS s_course_version_media_object ON s_course_version_media(object_id);
