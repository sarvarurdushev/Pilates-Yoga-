-- SEDENS 0003: room devices, device pairing and room sessions.
-- A room device is a screen/computer bound to exactly one existing p_rooms row.
-- It becomes active only when a facility administrator confirms a pairing code
-- shown on that screen; the device token is then issued only to the browser
-- that started the pairing. Tokens are stored as SHA-256 hashes.
-- A room session binds one authenticated customer to one device, room, location
-- and organization for a bounded time. Simulated devices exist only in
-- demonstration organizations (enforced in code and tested).
-- Customers never sign in on the shared room screen. They identify with a CRM
-- credential, or with a short single-use room access code that they request
-- on their own signed-in device (s_room_access_codes).

CREATE TABLE IF NOT EXISTS s_room_devices(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES p_locations ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES p_rooms ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  token_hash TEXT UNIQUE,
  simulated INTEGER NOT NULL DEFAULT 0 CHECK(simulated IN (0,1)),
  created_by TEXT REFERENCES p_users ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  revoked_by TEXT REFERENCES p_users ON DELETE SET NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS s_room_device_pairings(
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','confirmed','claimed','expired','cancelled')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  client_hint TEXT NOT NULL DEFAULT '',
  device_id TEXT REFERENCES s_room_devices ON DELETE CASCADE,
  confirmed_by TEXT REFERENCES p_users ON DELETE SET NULL,
  confirmed_at TEXT,
  claimed_at TEXT
);

CREATE TABLE IF NOT EXISTS s_room_sessions(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  -- Location, room and device are nulled (not cascaded) on delete so the visit
  -- history survives a location being removed; a nulled session never authorizes.
  location_id TEXT REFERENCES p_locations ON DELETE SET NULL,
  room_id TEXT REFERENCES p_rooms ON DELETE SET NULL,
  device_id TEXT REFERENCES s_room_devices ON DELETE SET NULL,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  entry_method TEXT NOT NULL CHECK(entry_method IN ('access_code','qr','reservation','member_id')),
  crm_provider TEXT NOT NULL,
  crm_reference TEXT NOT NULL DEFAULT '',
  reservation_id TEXT REFERENCES p_reservations ON DELETE SET NULL,
  state TEXT NOT NULL CHECK(state IN ('active','ended','expired','revoked')),
  simulated INTEGER NOT NULL DEFAULT 0 CHECK(simulated IN (0,1)),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS s_room_access_codes(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_device_id TEXT REFERENCES s_room_devices ON DELETE SET NULL,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS s_room_devices_room ON s_room_devices(org_id, room_id, status);
CREATE INDEX IF NOT EXISTS s_room_sessions_device ON s_room_sessions(device_id, state);
CREATE INDEX IF NOT EXISTS s_room_sessions_student ON s_room_sessions(student_id, state);
CREATE INDEX IF NOT EXISTS s_room_access_codes_student ON s_room_access_codes(student_id, used_at);
CREATE INDEX IF NOT EXISTS s_room_pairings_state ON s_room_device_pairings(state, expires_at);
