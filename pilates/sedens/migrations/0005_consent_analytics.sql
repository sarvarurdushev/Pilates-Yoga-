-- SEDENS 0005: consent records and local product-analytics events.
-- Consent is append-only: each decision is a new row and the latest row per
-- (user, kind) is the current state. Withdrawal is a new row with granted=0.
-- Events stay in this SQLite file; nothing is sent to a third-party service.
-- props carry no free text about a person (validated in code).

CREATE TABLE IF NOT EXISTS s_consents(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('scan_capture','scan_image_retention','product_analytics')),
  text_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK(granted IN (0,1)),
  recorded_at TEXT NOT NULL,
  room_session_id TEXT REFERENCES s_room_sessions ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK(channel IN ('room','account'))
);

CREATE TABLE IF NOT EXISTS s_events(
  id INTEGER PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('server','client')),
  user_id TEXT REFERENCES p_users ON DELETE SET NULL,
  room_id TEXT REFERENCES p_rooms ON DELETE SET NULL,
  device_id TEXT REFERENCES s_room_devices ON DELETE SET NULL,
  room_session_id TEXT REFERENCES s_room_sessions ON DELETE SET NULL,
  demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN (0,1)),
  props TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS s_consents_user ON s_consents(user_id, kind, recorded_at);
CREATE INDEX IF NOT EXISTS s_events_org ON s_events(org_id, name, at);
CREATE INDEX IF NOT EXISTS s_events_session ON s_events(room_session_id);
