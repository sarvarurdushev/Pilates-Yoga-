-- SEDENS 0002: creator profile foundation and creator <-> facility affiliations.
-- A creator profile belongs to an existing platform user (a facility coach keeps
-- their own account). creator_type is self-declared descriptive metadata; it is
-- never an authorization grant (see s_capabilities) and never implies
-- verification (verification_state is set only by a SEDENS reviewer).
--
-- An affiliation's only possible scope is content distribution. It never grants
-- access to that facility's members, records or media: customer-data access
-- remains exclusively the platform's role and coach-assignment model.

CREATE TABLE IF NOT EXISTS s_creator_profiles(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES p_users ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  creator_type TEXT NOT NULL CHECK(creator_type IN ('coach','professor','expert','sedens_editorial')),
  bio TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  qualifications TEXT NOT NULL DEFAULT '[]',
  specialties TEXT NOT NULL DEFAULT '[]',
  slug TEXT NOT NULL UNIQUE,
  verification_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK(verification_state IN ('unverified','pending','verified','rejected','suspended')),
  verified_by TEXT REFERENCES p_users ON DELETE SET NULL,
  verified_at TEXT,
  verification_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS s_creator_facility_affiliations(
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES s_creator_profiles ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  location_id TEXT REFERENCES p_locations ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'content_distribution' CHECK(scope IN ('content_distribution')),
  status TEXT NOT NULL CHECK(status IN ('requested','approved','declined','revoked')),
  requested_by TEXT REFERENCES p_users ON DELETE SET NULL,
  requested_at TEXT NOT NULL,
  decided_by TEXT REFERENCES p_users ON DELETE SET NULL,
  decided_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS s_affiliation_target
  ON s_creator_facility_affiliations(creator_id, org_id, IFNULL(location_id, ''));
CREATE INDEX IF NOT EXISTS s_affiliation_org ON s_creator_facility_affiliations(org_id, status);
