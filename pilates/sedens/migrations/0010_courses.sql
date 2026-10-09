-- SEDENS 0010: courses, edited as normalized draft rows.
-- A course belongs to its creator and to the organization the creator belongs
-- to (owner_org_id), which is the organization whose backup carries it.
-- Guided training is modules > sessions > ordered steps (one row per step, with
-- its dose, cues, media, equipment and anatomy); professional education is
-- modules > lessons. Customers never see these draft rows: they see the
-- published, immutable version snapshot (0011).
-- Three independent choices: distribution (who may offer it), price (below,
-- s_course_prices) and visibility (draft / submitted / published, derived from
-- the version states).
CREATE TABLE IF NOT EXISTS s_courses(
  id TEXT PRIMARY KEY,
  owner_org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES s_creator_profiles ON DELETE CASCADE,
  course_type TEXT NOT NULL CHECK(course_type IN ('guided_training','professional_education')),
  language TEXT NOT NULL CHECK(language IN ('ko','en')),
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'mobility'
    CHECK(category IN ('pilates','yoga','mobility','core','strength','balance','breathing','education')),
  level TEXT NOT NULL DEFAULT 'beginner' CHECK(level IN ('beginner','intermediate','advanced','all_levels')),
  audience TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  safety TEXT NOT NULL DEFAULT '',
  outcomes TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '[]',
  goals TEXT NOT NULL DEFAULT '[]',
  body_areas TEXT NOT NULL DEFAULT '[]',
  estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK(estimated_minutes BETWEEN 0 AND 600),
  weeks INTEGER NOT NULL DEFAULT 0 CHECK(weeks BETWEEN 0 AND 52),
  sessions_per_week INTEGER NOT NULL DEFAULT 0 CHECK(sessions_per_week BETWEEN 0 AND 14),
  cover_media_id TEXT REFERENCES s_media_objects ON DELETE SET NULL,
  distribution TEXT NOT NULL DEFAULT 'creator_only'
    CHECK(distribution IN ('creator_only','selected_facilities','network','marketplace')),
  revision INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  suspended_at TEXT,
  suspended_reason TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_by TEXT REFERENCES p_users ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The price axis. Free means amount 0; paid means a positive amount. Nothing
-- here is a payment: payments are simulated by the demo provider only.
CREATE TABLE IF NOT EXISTS s_course_prices(
  course_id TEXT PRIMARY KEY REFERENCES s_courses ON DELETE CASCADE,
  price_type TEXT NOT NULL CHECK(price_type IN ('free','paid')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0 AND amount_minor <= 100000000),
  currency TEXT NOT NULL DEFAULT 'KRW' CHECK(currency IN ('KRW','USD')),
  sale_state TEXT NOT NULL DEFAULT 'active' CHECK(sale_state IN ('active','paused','not_for_sale')),
  updated_at TEXT NOT NULL,
  CHECK((price_type = 'free') = (amount_minor = 0))
);

-- Facilities a creator selected (distribution 'selected_facilities'), and
-- facilities given the course free (any distribution, e.g. a partner facility
-- of a paid marketplace course). location_id NULL means every location.
CREATE TABLE IF NOT EXISTS s_course_facility_terms(
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  location_id TEXT REFERENCES p_locations ON DELETE CASCADE,
  free INTEGER NOT NULL DEFAULT 0 CHECK(free IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS s_course_facility_terms_target
  ON s_course_facility_terms(course_id, org_id, IFNULL(location_id, ''));

CREATE TABLE IF NOT EXISTS s_course_modules(
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS s_course_sessions(
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES s_course_modules ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK(estimated_minutes BETWEEN 0 AND 240),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One guided-training step. exercise_ref is a SEDENS Standard id or a catalog
-- key (text, validated in code; never a foreign key to a facility's exercises).
-- A step with variant_of is an easier or harder alternative of another step.
CREATE TABLE IF NOT EXISTS s_course_steps(
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES s_course_sessions ON DELETE CASCADE,
  position INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'main' CHECK(phase IN ('warm_up','main','cool_down')),
  exercise_source TEXT NOT NULL CHECK(exercise_source IN ('standard','catalog')),
  exercise_ref TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  sets INTEGER NOT NULL DEFAULT 1 CHECK(sets BETWEEN 1 AND 20),
  reps INTEGER NOT NULL DEFAULT 0 CHECK(reps BETWEEN 0 AND 100),
  hold_seconds INTEGER NOT NULL DEFAULT 0 CHECK(hold_seconds BETWEEN 0 AND 600),
  work_seconds INTEGER NOT NULL DEFAULT 0 CHECK(work_seconds BETWEEN 0 AND 3600),
  rest_seconds INTEGER NOT NULL DEFAULT 0 CHECK(rest_seconds BETWEEN 0 AND 600),
  sides TEXT NOT NULL DEFAULT 'none' CHECK(sides IN ('none','both','alternate','each_side')),
  regression TEXT NOT NULL DEFAULT '',
  progression TEXT NOT NULL DEFAULT '',
  customer_cue TEXT NOT NULL DEFAULT '',
  narration TEXT NOT NULL DEFAULT '',
  video_media_id TEXT REFERENCES s_media_objects ON DELETE SET NULL,
  image_media_id TEXT REFERENCES s_media_objects ON DELETE SET NULL,
  equipment TEXT NOT NULL DEFAULT '[]',
  advance TEXT NOT NULL DEFAULT 'manual' CHECK(advance IN ('manual','auto')),
  variant_of TEXT REFERENCES s_course_steps ON DELETE CASCADE,
  variant TEXT NOT NULL DEFAULT 'standard' CHECK(variant IN ('standard','easier','harder')),
  atlas_depth TEXT NOT NULL DEFAULT 'taught' CHECK(atlas_depth IN ('taught','complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((variant_of IS NULL) = (variant = 'standard'))
);

-- The structures a step is about, by atlas registry name (validated on save).
CREATE TABLE IF NOT EXISTS s_course_step_anatomy(
  step_id TEXT NOT NULL REFERENCES s_course_steps ON DELETE CASCADE,
  structure_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('focus','prime','assisting','steadying')),
  position INTEGER NOT NULL,
  PRIMARY KEY(step_id, structure_key)
);

-- Anatomy timeline segments within a step (room playback arrives in Phase 3).
CREATE TABLE IF NOT EXISTS s_course_step_timeline(
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES s_course_steps ON DELETE CASCADE,
  position INTEGER NOT NULL,
  start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
  end_ms INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('highlight','isolate')),
  layer TEXT NOT NULL DEFAULT '',
  structures TEXT NOT NULL DEFAULT '[]',
  cue TEXT NOT NULL DEFAULT '',
  CHECK(end_ms > start_ms)
);

-- Professional education: flexible lessons, never played by the room engine.
CREATE TABLE IF NOT EXISTS s_course_lessons(
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES s_courses ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES s_course_modules ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('video','pdf','article','image','anatomy_task','quiz','case','exercise_demo')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_id TEXT REFERENCES s_media_objects ON DELETE SET NULL,
  exercise_source TEXT CHECK(exercise_source IN ('standard','catalog')),
  exercise_ref TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS s_courses_owner ON s_courses(owner_org_id, creator_id);
CREATE INDEX IF NOT EXISTS s_course_modules_course ON s_course_modules(course_id, position);
CREATE INDEX IF NOT EXISTS s_course_sessions_module ON s_course_sessions(module_id, position);
CREATE INDEX IF NOT EXISTS s_course_steps_session ON s_course_steps(session_id, position);
CREATE INDEX IF NOT EXISTS s_course_lessons_module ON s_course_lessons(module_id, position);
CREATE INDEX IF NOT EXISTS s_course_facility_terms_org ON s_course_facility_terms(org_id);
