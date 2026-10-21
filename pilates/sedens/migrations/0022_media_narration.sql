-- SEDENS 0022: creator narration. Course media gains an 'audio' kind (a step's
-- recorded narration), and a guided-training step gains timed narration cues
-- and an optional recording.
--
-- (a) s_media_objects: kind and mime are CHECK constraints, which SQLite cannot
-- alter, so the table is rebuilt. The runner applies this file in one
-- BEGIN IMMEDIATE transaction on a connection with foreign keys ON, where
-- PRAGMA foreign_keys cannot be switched off. That rules out the usual
-- rename-based rebuild: with foreign keys ON, ALTER TABLE ... RENAME rewrites
-- every child table's REFERENCES to the renamed table even with
-- legacy_alter_table=ON, and dropping that table then cascades into
-- s_media_rights and s_course_version_media and nulls every step, lesson,
-- cover and evidence reference. Instead:
--   1. defer foreign key checks to COMMIT (PRAGMA defer_foreign_keys resets
--      itself at COMMIT);
--   2. keep a plain copy of every row, rowid included;
--   3. give each old row an id no child refers to. The children's ON UPDATE
--      action is NO ACTION, so this only counts deferred violations; nothing
--      cascades and no child row changes;
--   4. drop the old table: its implicit DELETE matches no child row, so no
--      ON DELETE action fires;
--   5. create s_media_objects with the wider CHECKs under the same name. The
--      child tables' schema text is never touched: they keep referring to
--      s_media_objects by name;
--   6. insert the copied rows with their original ids and rowids; each insert
--      cancels the deferred violations of the children that refer to it;
--   7. restore the index, then verify inside the transaction (below). Any
--      lost row leaves a violation and COMMIT fails, so the runner rolls the
--      whole file back.
-- tests/test_sedens_narration.py proves this from a populated 0021 database.
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE s_0022_counts(
  name TEXT PRIMARY KEY,
  before INTEGER NOT NULL,
  after INTEGER,
  CHECK(after IS NULL OR after = before)
);
INSERT INTO s_0022_counts(name, before) VALUES
  ('s_media_objects', (SELECT count(*) FROM s_media_objects)),
  ('s_media_rights', (SELECT count(*) FROM s_media_rights)),
  ('s_verification_evidence', (SELECT count(object_id) FROM s_verification_evidence)),
  ('s_courses', (SELECT count(cover_media_id) FROM s_courses)),
  ('s_course_steps.video', (SELECT count(video_media_id) FROM s_course_steps)),
  ('s_course_steps.image', (SELECT count(image_media_id) FROM s_course_steps)),
  ('s_course_lessons', (SELECT count(media_id) FROM s_course_lessons)),
  ('s_course_version_media', (SELECT count(*) FROM s_course_version_media)),
  ('orphans', (SELECT count(*) FROM (
    SELECT parent FROM pragma_foreign_key_check('s_media_rights')
    UNION ALL SELECT parent FROM pragma_foreign_key_check('s_verification_evidence')
    UNION ALL SELECT parent FROM pragma_foreign_key_check('s_courses')
    UNION ALL SELECT parent FROM pragma_foreign_key_check('s_course_steps')
    UNION ALL SELECT parent FROM pragma_foreign_key_check('s_course_lessons')
    UNION ALL SELECT parent FROM pragma_foreign_key_check('s_course_version_media')
  ) WHERE parent = 's_media_objects'));

CREATE TABLE s_media_objects_0022 AS SELECT rowid AS old_rowid, * FROM s_media_objects;
UPDATE s_media_objects SET id = '0022-rebuild:' || id;
DROP TABLE s_media_objects;

CREATE TABLE s_media_objects(
  id TEXT PRIMARY KEY,
  owner_org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  creator_id TEXT REFERENCES s_creator_profiles ON DELETE SET NULL,
  uploaded_by TEXT REFERENCES p_users ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('creator_upload','repo','stock')),
  kind TEXT NOT NULL CHECK(kind IN ('video','image','pdf','audio')),
  mime TEXT NOT NULL CHECK(mime IN ('video/mp4','video/webm','image/jpeg','image/png','image/webp','application/pdf',
                                    'audio/mpeg','audio/mp4','audio/webm','audio/ogg')),
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT NOT NULL,
  object_key TEXT UNIQUE,
  repo_asset TEXT,
  original_filename TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  width INTEGER,
  height INTEGER,
  state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','retired')),
  created_at TEXT NOT NULL,
  CHECK((source = 'repo') = (repo_asset IS NOT NULL)),
  CHECK(source = 'repo' OR object_key IS NOT NULL)
);
INSERT INTO s_media_objects(rowid,id,owner_org_id,creator_id,uploaded_by,source,kind,mime,size,sha256,object_key,
                            repo_asset,original_filename,title,width,height,state,created_at)
  SELECT old_rowid,id,owner_org_id,creator_id,uploaded_by,source,kind,mime,size,sha256,object_key,
         repo_asset,original_filename,title,width,height,state,created_at
  FROM s_media_objects_0022 ORDER BY old_rowid;
DROP TABLE s_media_objects_0022;
CREATE INDEX IF NOT EXISTS s_media_objects_owner ON s_media_objects(owner_org_id, creator_id, state);

-- Verification: every row and every reference is still there ...
UPDATE s_0022_counts SET after = CASE name
  WHEN 's_media_objects' THEN (SELECT count(*) FROM s_media_objects)
  WHEN 's_media_rights' THEN (SELECT count(*) FROM s_media_rights)
  WHEN 's_verification_evidence' THEN (SELECT count(object_id) FROM s_verification_evidence)
  WHEN 's_courses' THEN (SELECT count(cover_media_id) FROM s_courses)
  WHEN 's_course_steps.video' THEN (SELECT count(video_media_id) FROM s_course_steps)
  WHEN 's_course_steps.image' THEN (SELECT count(image_media_id) FROM s_course_steps)
  WHEN 's_course_lessons' THEN (SELECT count(media_id) FROM s_course_lessons)
  WHEN 's_course_version_media' THEN (SELECT count(*) FROM s_course_version_media) END;
-- ... and every reference that found its file before still finds it (a
-- reference left dangling by older data is counted, not fixed, so it does not
-- block the upgrade).
UPDATE s_0022_counts SET after = (SELECT count(*) FROM (
  SELECT parent FROM pragma_foreign_key_check('s_media_rights')
  UNION ALL SELECT parent FROM pragma_foreign_key_check('s_verification_evidence')
  UNION ALL SELECT parent FROM pragma_foreign_key_check('s_courses')
  UNION ALL SELECT parent FROM pragma_foreign_key_check('s_course_steps')
  UNION ALL SELECT parent FROM pragma_foreign_key_check('s_course_lessons')
  UNION ALL SELECT parent FROM pragma_foreign_key_check('s_course_version_media')
) WHERE parent = 's_media_objects') WHERE name = 'orphans';
DROP TABLE s_0022_counts;

-- (b) Timed narration of a guided-training step. narration_cues is a JSON list
-- of {"text", "at_seconds", "speak"}, validated by courses.save_step: the
-- creator decides which lines are spoken and when; the others are subtitles
-- only. An empty list keeps the older narration text exactly as before.
-- narration_audio_media_id is the creator's own recording (kind 'audio').
ALTER TABLE s_course_steps ADD COLUMN narration_cues TEXT NOT NULL DEFAULT '[]';
ALTER TABLE s_course_steps ADD COLUMN narration_audio_media_id TEXT REFERENCES s_media_objects ON DELETE SET NULL;
