-- SEDENS 0004: facility CRM provider configuration and member links.
-- config holds non-secret settings only; the code refuses secret-looking keys.
-- A future provider's credentials belong in the deployment's secret store and
-- are referenced by name, never stored here. Member links map a CRM's own
-- member reference to an existing platform student in the same organization.

CREATE TABLE IF NOT EXISTS s_crm_settings(
  org_id TEXT PRIMARY KEY REFERENCES p_organizations ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('none','demo')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  config TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT REFERENCES p_users ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS s_crm_member_links(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_member_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, provider, external_member_id)
);

CREATE INDEX IF NOT EXISTS s_crm_member_links_student ON s_crm_member_links(student_id);
