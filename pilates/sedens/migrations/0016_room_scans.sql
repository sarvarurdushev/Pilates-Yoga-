-- SEDENS 0016: the four-view room scan and what the customer was shown.
--
-- source never mixes: 'demo_precomputed' (fictional precomputed measurements,
-- labelled DEMO), 'experimental_real' (real analysis of the captured photos on the
-- free demonstration host, labelled EXPERIMENTAL) or 'room_capture' (real analysis
-- in a local room). A real scan is also saved as a p_analyses row (protocol
-- sedens_room_scan_v1) so the visit links to it like any workspace capture.
-- summary is the exact customer summary shown, frozen with the rules version.
CREATE TABLE IF NOT EXISTS s_room_scans(
  id TEXT PRIMARY KEY,
  room_session_id TEXT REFERENCES s_room_sessions ON DELETE SET NULL,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES p_students ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('demo_precomputed','experimental_real','room_capture')),
  state TEXT NOT NULL CHECK(state IN ('capturing','processing','complete','failed','abandoned')),
  analysis_id TEXT REFERENCES p_analyses ON DELETE SET NULL,
  measurement_version TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  feedback_rules_version TEXT NOT NULL DEFAULT '',
  reliability TEXT CHECK(reliability IN ('clear','limited','retake')),
  focus TEXT,
  summary TEXT NOT NULL DEFAULT '{}',
  images_retained INTEGER NOT NULL DEFAULT 0 CHECK(images_retained IN (0,1)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS s_room_scans_student ON s_room_scans(student_id, completed_at);
CREATE INDEX IF NOT EXISTS s_room_scans_session ON s_room_scans(room_session_id);

CREATE TABLE IF NOT EXISTS s_room_scan_views(
  scan_id TEXT NOT NULL REFERENCES s_room_scans ON DELETE CASCADE,
  view TEXT NOT NULL CHECK(view IN ('front','left','back','right')),
  captured_at TEXT,
  image_key TEXT,
  retakes INTEGER NOT NULL DEFAULT 0,
  quality TEXT CHECK(quality IN ('clear','limited','retake')),
  quality_reason TEXT,
  PRIMARY KEY(scan_id, view)
);

-- One row per evidence rule evaluated: shown or withheld, with the measurement and
-- why. Lets a reviewer answer "which rule and which version produced this".
CREATE TABLE IF NOT EXISTS s_room_scan_observations(
  scan_id TEXT NOT NULL REFERENCES s_room_scans ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK(outcome IN ('shown','below_threshold','withheld')),
  reason TEXT NOT NULL DEFAULT '',
  threshold REAL,
  PRIMARY KEY(scan_id, rule_id)
);
