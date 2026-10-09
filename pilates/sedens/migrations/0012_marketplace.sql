-- SEDENS 0012: facility course settings, demo purchases, entitlements,
-- enrollments and progress.
-- A facility decides only whether a course it may receive is enabled in its
-- rooms, included for its members (only where it is free there) and featured.
-- s_purchases records simulated purchases only: provider 'demo', no card data.
CREATE TABLE IF NOT EXISTS s_facility_course_settings(
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  included INTEGER NOT NULL DEFAULT 0 CHECK(included IN (0,1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  updated_by TEXT REFERENCES p_users ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(org_id, course_id)
);

CREATE TABLE IF NOT EXISTS s_purchases(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('demo')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL CHECK(currency IN ('KRW','USD')),
  state TEXT NOT NULL CHECK(state IN ('demo_completed','demo_refunded')),
  created_at TEXT NOT NULL
);

-- Stored entitlements: a free marketplace enrollment, a demo purchase, or a
-- facility's free or included offer (re-checked against the facility on use).
CREATE TABLE IF NOT EXISTS s_entitlements(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('marketplace_free','demo_purchase','facility_free','facility_included')),
  facility_id TEXT REFERENCES p_organizations ON DELETE SET NULL,
  purchase_id TEXT REFERENCES s_purchases ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(user_id, course_id, source)
);

CREATE TABLE IF NOT EXISTS s_enrollments(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  entitlement_id TEXT REFERENCES s_entitlements ON DELETE SET NULL,
  enrolled_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(user_id, course_id)
);

-- Completed sessions (guided training) and lessons (professional education),
-- by their id in the enrolled version's snapshot. No scores, no certificates.
CREATE TABLE IF NOT EXISTS s_course_progress(
  enrollment_id TEXT NOT NULL REFERENCES s_enrollments ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('session','lesson')),
  item_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY(enrollment_id, item_kind, item_id)
);

-- Which demonstration layers a demo organization has, so seeding runs once.
CREATE TABLE IF NOT EXISTS s_demo_layers(
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  layer TEXT NOT NULL,
  version INTEGER NOT NULL,
  seeded_at TEXT NOT NULL,
  PRIMARY KEY(org_id, layer)
);

CREATE INDEX IF NOT EXISTS s_facility_course_settings_course ON s_facility_course_settings(course_id);
CREATE INDEX IF NOT EXISTS s_entitlements_user ON s_entitlements(user_id, course_id);
CREATE INDEX IF NOT EXISTS s_enrollments_user ON s_enrollments(user_id);
CREATE INDEX IF NOT EXISTS s_purchases_user ON s_purchases(user_id, course_id);
