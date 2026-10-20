-- SEDENS 0019: the Fitness Passport on a phone.
--
-- origin separates activity actually performed in a room ('room', the default
-- every Phase 1-3 writer keeps using) from fictional history a demonstration
-- persona was seeded with ('demo_seed'). Only the demo seed writes 'demo_seed';
-- the Passport labels it and the facility usage meter never counts it.
ALTER TABLE s_room_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'room' CHECK(origin IN ('room','demo_seed'));
ALTER TABLE s_workouts      ADD COLUMN origin TEXT NOT NULL DEFAULT 'room' CHECK(origin IN ('room','demo_seed'));
ALTER TABLE s_room_scans    ADD COLUMN origin TEXT NOT NULL DEFAULT 'room' CHECK(origin IN ('room','demo_seed'));

-- A customer's own Passport preferences: one row per customer, written only by
-- that customer. Music uses the room's built-in modes (room-music.js).
CREATE TABLE IF NOT EXISTS s_passport_preferences(
  user_id TEXT PRIMARY KEY REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  exercise_style TEXT CHECK(exercise_style IN ('pilates','mobility','core','mixed')),
  intensity TEXT CHECK(intensity IN ('light','moderate')),
  music TEXT CHECK(music IN ('off','calm','focus','energy')),
  language TEXT CHECK(language IN ('ko','en')),
  updated_at TEXT NOT NULL
);

-- Requests a customer makes that the facility must decide. Phase 4 records an
-- 'erase_passport' request; nothing is deleted automatically.
CREATE TABLE IF NOT EXISTS s_data_requests(
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('erase_passport')),
  state TEXT NOT NULL CHECK(state IN ('received','completed','declined','withdrawn')),
  detail TEXT NOT NULL DEFAULT '{}',
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES p_users ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS s_data_requests_user ON s_data_requests(user_id, state);
