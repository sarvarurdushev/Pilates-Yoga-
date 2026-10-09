-- SEDENS 0009: course media and its rights.
-- Course media never lives in p_media and is never served by /platform/media.
-- Files sit in a separate store (pilates/sedens/media_store.py); access is
-- decided only by pilates/sedens/access.py. Every object carries rights
-- metadata and the creator's attestation, recorded before the file is kept.
CREATE TABLE IF NOT EXISTS s_media_objects(
  id TEXT PRIMARY KEY,
  owner_org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  creator_id TEXT REFERENCES s_creator_profiles ON DELETE SET NULL,
  uploaded_by TEXT REFERENCES p_users ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('creator_upload','repo','stock')),
  kind TEXT NOT NULL CHECK(kind IN ('video','image','pdf')),
  mime TEXT NOT NULL CHECK(mime IN ('video/mp4','video/webm','image/jpeg','image/png','image/webp','application/pdf')),
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

CREATE TABLE IF NOT EXISTS s_media_rights(
  object_id TEXT PRIMARY KEY REFERENCES s_media_objects ON DELETE CASCADE,
  licence_type TEXT NOT NULL CHECK(licence_type IN
    ('own_work','permission_granted','pexels','pixabay','cc0','cc_by','cc_by_sa','repo_owned','other')),
  original_creator TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  licence_url TEXT NOT NULL DEFAULT '',
  restrictions TEXT NOT NULL DEFAULT '',
  identifiable_person TEXT NOT NULL CHECK(identifiable_person IN ('none','consented','unknown')),
  attestation_version TEXT NOT NULL,
  attested_by TEXT REFERENCES p_users ON DELETE SET NULL,
  attested_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(review_status IN ('unreviewed','approved','rejected')),
  reviewed_by TEXT REFERENCES p_users ON DELETE SET NULL,
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT ''
);

-- Evidence a creator offers for verification (a description, a link, or a document).
CREATE TABLE IF NOT EXISTS s_verification_evidence(
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES s_creator_profiles ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('qualification','institution','identity','other')),
  description TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  object_id TEXT REFERENCES s_media_objects ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS s_media_objects_owner ON s_media_objects(owner_org_id, creator_id, state);
CREATE INDEX IF NOT EXISTS s_verification_evidence_creator ON s_verification_evidence(creator_id);
