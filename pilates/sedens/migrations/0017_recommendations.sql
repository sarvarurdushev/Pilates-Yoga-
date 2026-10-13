-- SEDENS 0017: SEDENS Standard recommendations shown in the room.
--
-- A visit's history stays in one place per fact (pilates/sedens/passport.py). This
-- table holds what only the recommender knows: why a plan was suggested.

-- One row per SEDENS Standard plan shown. The exact inputs, the rules that fired,
-- the plan and the reasons shown are frozen with the rules and library versions.
CREATE TABLE IF NOT EXISTS s_recommendations(
  id TEXT PRIMARY KEY,
  room_session_id TEXT REFERENCES s_room_sessions ON DELETE SET NULL,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  rules_version TEXT NOT NULL,
  library_version TEXT NOT NULL,
  readiness_check_id TEXT REFERENCES s_readiness_checks ON DELETE SET NULL,
  scan_id TEXT REFERENCES s_room_scans ON DELETE SET NULL,
  goal TEXT NOT NULL CHECK(goal IN ('mobility','pilates','core','general')),
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes IN (30,60)),
  intensity TEXT NOT NULL CHECK(intensity IN ('light','moderate')),
  estimated_seconds INTEGER NOT NULL,
  inputs TEXT NOT NULL DEFAULT '{}',
  rules_fired TEXT NOT NULL DEFAULT '[]',
  plan TEXT NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK(state IN ('shown','accepted','declined','superseded')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS s_recommendations_student ON s_recommendations(student_id, created_at);
CREATE INDEX IF NOT EXISTS s_recommendations_session ON s_recommendations(room_session_id);
