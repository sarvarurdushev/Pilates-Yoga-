-- SEDENS 0018: guided workouts and the customer's own session feedback.
--
-- A visit's history stays in one place per fact (pilates/sedens/passport.py):
-- p_training_sessions + p_session_exercise_events hold the visit and the exercises
-- completed (shared with the coaching workspace); these tables hold what only the
-- room knows: how each step went, and how the session felt.

-- One guided workout: a SEDENS Standard plan or one session of a guided course,
-- pinned to the exact course version that was played. plan is the frozen ordered
-- list of steps as played, so a later course edit never changes this record.
CREATE TABLE IF NOT EXISTS s_workouts(
  id TEXT PRIMARY KEY,
  room_session_id TEXT REFERENCES s_room_sessions ON DELETE SET NULL,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('standard','course')),
  recommendation_id TEXT REFERENCES s_recommendations ON DELETE SET NULL,
  course_id TEXT REFERENCES s_courses ON DELETE SET NULL,
  course_version INTEGER,
  course_session_id TEXT,
  enrollment_id TEXT REFERENCES s_enrollments ON DELETE SET NULL,
  training_session_id TEXT REFERENCES p_training_sessions ON DELETE SET NULL,
  state TEXT NOT NULL CHECK(state IN ('ready','active','paused','completed','stopped','abandoned')),
  current_index INTEGER NOT NULL DEFAULT 0,
  position_ms INTEGER NOT NULL DEFAULT 0,
  auto_next INTEGER NOT NULL DEFAULT 1 CHECK(auto_next IN (0,1)),
  planned_seconds INTEGER NOT NULL DEFAULT 0,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  segment_started_at TEXT,
  plan TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  end_reason TEXT NOT NULL DEFAULT '' CHECK(end_reason IN ('','completed','safety_stop','customer_ended',
    'visit_ended','room_session_closed','replaced')),
  safety_category TEXT CHECK(safety_category IN ('urgent','pain','dizzy','unwell','other'))
);
CREATE INDEX IF NOT EXISTS s_workouts_student ON s_workouts(student_id, created_at);
CREATE INDEX IF NOT EXISTS s_workouts_session ON s_workouts(room_session_id, state);

-- One row per planned step. A step is completed or skipped once (idempotent).
CREATE TABLE IF NOT EXISTS s_workout_steps(
  workout_id TEXT NOT NULL REFERENCES s_workouts ON DELETE CASCADE,
  position INTEGER NOT NULL,
  step_ref TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('warm_up','main','cool_down')),
  exercise_ref TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT 'standard' CHECK(variant IN ('standard','easier','harder')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','completed','skipped')),
  planned_seconds INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  PRIMARY KEY(workout_id, position)
);

-- The customer's own report after a workout. Effort uses SEDENS's original 0-10
-- wording (effort_scale + version), a feeling, never a measurement. Discomfort is
-- stored as reported and never classified. One row per workout (idempotent).
CREATE TABLE IF NOT EXISTS s_session_feedback(
  workout_id TEXT PRIMARY KEY REFERENCES s_workouts ON DELETE CASCADE,
  room_session_id TEXT REFERENCES s_room_sessions ON DELETE SET NULL,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  training_session_id TEXT REFERENCES p_training_sessions ON DELETE SET NULL,
  questions_version TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('en','ko')),
  target_intensity TEXT CHECK(target_intensity IN ('light','moderate')),
  effort INTEGER CHECK(effort BETWEEN 0 AND 10),
  discomfort TEXT CHECK(discomfort IN ('no','yes')),
  discomfort_urgent INTEGER CHECK(discomfort_urgent IN (0,1)),
  discomfort_regions TEXT NOT NULL DEFAULT '[]',
  discomfort_when TEXT CHECK(discomfort_when IN ('during','after','not_sure')),
  discomfort_strength TEXT CHECK(discomfort_strength IN ('mild','moderate','strong')),
  discomfort_still INTEGER CHECK(discomfort_still IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK(outcome IN ('completed','stopped')),
  completed_steps INTEGER NOT NULL DEFAULT 0,
  skipped_steps INTEGER NOT NULL DEFAULT 0,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS s_session_feedback_student ON s_session_feedback(student_id, submitted_at);
