-- SEDENS 0015: the room journey (server-owned state) and the readiness check.
--
-- s_room_sessions.state stays the authorization lifecycle (active/ended/...).
-- What the customer is doing inside an authorized room is a separate, server-owned
-- state machine: one journey per room session. The screen never decides the state;
-- it asks for a transition and the server accepts or refuses it
-- (pilates/sedens/journey.py). A refresh reads the journey back.
CREATE TABLE IF NOT EXISTS s_room_journeys(
  room_session_id TEXT PRIMARY KEY REFERENCES s_room_sessions ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN (
    'identified','readiness','readiness_blocked',
    'scan_intro','scan_front','scan_left','scan_back','scan_right','scan_processing','scan_result',
    'session_choice','session_setup','recommendation','ready_to_train',
    'exercise','exercise_paused','session_complete','ended')),
  revision INTEGER NOT NULL DEFAULT 1,
  path TEXT CHECK(path IN ('course','personalized')),
  scan_skipped INTEGER NOT NULL DEFAULT 0 CHECK(scan_skipped IN (0,1)),
  booking_starts_at TEXT,
  booking_ends_at TEXT,
  -- The visit's p_training_sessions row (created by a real scan's analysis, or by
  -- the first workout), reused so a visit is one record in the shared history.
  training_session_id TEXT REFERENCES p_training_sessions ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS s_room_journeys_student ON s_room_journeys(student_id, state);

-- One readiness check per room visit (a new visit asks again). The outcome is stored
-- with the questionnaire version that produced it and is never re-evaluated under
-- later rules. Answers are stored only up to the answer that decided the outcome.
CREATE TABLE IF NOT EXISTS s_readiness_checks(
  id TEXT PRIMARY KEY,
  room_session_id TEXT REFERENCES s_room_sessions ON DELETE SET NULL,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  questionnaire_version TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('en','ko')),
  outcome TEXT CHECK(outcome IN ('ready','do_not_start','urgent_help')),
  triggered_item TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS s_readiness_checks_student ON s_readiness_checks(student_id, started_at);

CREATE TABLE IF NOT EXISTS s_readiness_answers(
  check_id TEXT NOT NULL REFERENCES s_readiness_checks ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  answer INTEGER NOT NULL CHECK(answer IN (0,1)),
  follow_up INTEGER CHECK(follow_up IN (0,1)),
  answered_at TEXT NOT NULL,
  PRIMARY KEY(check_id, item_id)
);
