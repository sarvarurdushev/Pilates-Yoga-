-- SEDENS 0006: room session inactivity.
-- A room session left without pressing End closes after a period with no room
-- request (SEDENS_ROOM_IDLE_MINUTES), so the next person at the screen cannot
-- continue it. NULL on older rows means "since started_at".
ALTER TABLE s_room_sessions ADD COLUMN last_activity_at TEXT;
