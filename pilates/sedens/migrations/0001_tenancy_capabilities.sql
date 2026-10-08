-- SEDENS 0001: organization type metadata and SEDENS capabilities.
-- Additive only. An organization without an s_org_profiles row is a facility,
-- so every organization created before SEDENS keeps working unchanged.
-- Capabilities are separate from the platform role enum (admin/coach/student):
-- a capability never replaces a role check, it is an additional grant.

CREATE TABLE IF NOT EXISTS s_org_profiles(
  org_id TEXT PRIMARY KEY REFERENCES p_organizations ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('facility','creator_studio','sedens')),
  display_name TEXT NOT NULL DEFAULT '',
  default_language TEXT NOT NULL DEFAULT 'ko' CHECK(default_language IN ('ko','en')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  created_at TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS s_capabilities(
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK(capability IN ('creator','sedens_reviewer','sedens_admin')),
  granted_by TEXT REFERENCES p_users ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  revoked_by TEXT REFERENCES p_users ON DELETE SET NULL,
  revoked_at TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(user_id, capability)
);

CREATE INDEX IF NOT EXISTS s_capabilities_active ON s_capabilities(capability, revoked_at);
