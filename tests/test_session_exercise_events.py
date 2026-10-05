"""Completed movements are ordered, source-linked events with honest timing."""

from datetime import datetime, timedelta, timezone
import pytest

from pilates.platform.backup import export_archive, restore_archive
from pilates.platform.repository import Refused, Repository, encode


def _context(tmp_path):
    repo = Repository(tmp_path / "exercise-events.db")
    key = "9" * 32
    coach = repo.actor(repo.demo_login(key, "coach"))
    client = repo.people(coach)[0]
    sid = client["id"]
    booking = repo.client(coach, sid)["reservations"][0]
    assignment = repo.client(coach, sid)["programs"][0]
    program = repo.get(coach, "programs", assignment["program_id"])
    steps = [step["id"] for step in program["steps"] if step.get("exercise_id")]
    return repo, coach, sid, booking, program, steps


def test_ordered_movements_keep_actual_mark_and_log_times(tmp_path):
    repo, coach, sid, booking, program, steps = _context(tmp_path)
    marked = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    saved = repo.complete_session(coach, {
        "student_id": sid, "reservation_id": booking["id"],
        "program_id": program["id"], "completed": [steps[0], steps[1], steps[0]],
        "completed_events": [
            {"key": steps[0], "completed_at": marked},
            {"key": steps[1]},
            {"key": steps[0], "completed_at": marked},
        ],
    })
    visit = next(s for s in repo.client(coach, sid)["sessions"] if s["id"] == saved["id"])
    events = visit["exercise_events"]
    assert [(e["session_id"], e["sequence"], e["completed_key"]) for e in events] == [
        (saved["id"], 1, steps[0]), (saved["id"], 2, steps[1]),
        (saved["id"], 3, steps[0]),
    ]
    assert events[0]["completed_at"] == marked
    assert events[1]["completed_at"] is None
    assert events[2]["completed_at"] == marked
    assert all(e["logged_at"] for e in events)
    assert len({e["id"] for e in events}) == 3
    original = [(e["id"], e["logged_at"], e["completed_at"]) for e in events]
    repo.complete_session(coach, {
        "student_id": sid, "reservation_id": booking["id"],
        "program_id": program["id"], "completed": [steps[0], steps[1], steps[0]],
    })
    updated = next(s for s in repo.client(coach, sid)["sessions"] if s["id"] == saved["id"])
    assert [(e["id"], e["logged_at"], e["completed_at"]) for e in updated["exercise_events"]] == original


def test_invalid_event_order_or_time_is_rejected(tmp_path):
    repo, coach, sid, booking, program, steps = _context(tmp_path)
    base = {"student_id": sid, "reservation_id": booking["id"],
            "program_id": program["id"], "completed": [steps[0]]}
    for events in ([{"key": steps[1]}], [{"key": steps[0], "completed_at": "yesterday"}],
                   [{"key": steps[0], "completed_at": "2026-01-01T10:00:00"}],
                   [{"key": steps[0], "completed_at": "2999-01-01T10:00:00Z"}], []):
        with pytest.raises(Refused):
            repo.complete_session(coach, {**base, "completed_events": events})
    assert not [s for s in repo.client(coach, sid)["sessions"] if s["reservation_id"] == booking["id"] and s["completed"] == [steps[0]]]


def test_legacy_events_have_unknown_times_and_new_archive_remaps_step_keys(tmp_path):
    repo, coach, sid, booking, program, steps = _context(tmp_path)
    with repo.db() as db:
        db.execute("INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
                   ("legacy-event-visit", sid, None, program["id"], None,
                    "2026-05-01T10:00:00+00:00", encode([steps[0]]), ""))
    reopened = Repository(repo.path)
    legacy = next(s for s in reopened.client(coach, sid)["sessions"] if s["id"] == "legacy-event-visit")
    assert len(legacy["exercise_events"]) == 1
    assert legacy["exercise_events"][0]["logged_at"] is None
    assert legacy["exercise_events"][0]["completed_at"] is None
    marked = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    saved = reopened.complete_session(coach, {
        "student_id": sid, "reservation_id": booking["id"], "program_id": program["id"],
        "completed": [steps[0]],
        "completed_events": [{"key": steps[0], "completed_at": marked}],
    })
    admin = reopened.actor(reopened.demo_login("9" * 32, "admin"))
    fresh = reopened.actor(reopened.create_org("New org", "exercise-events-restore@example.org",
                                                 "strong-new-password", "Restored admin"))
    with export_archive(reopened, admin) as archive:
        restore_archive(reopened, fresh, archive)
    name = reopened.client(coach, sid)["name"]
    restored_client = next(person for person in reopened.people(fresh) if person["name"] == name)
    restored = reopened.client(fresh, restored_client["id"])
    current = next(s for s in restored["sessions"] if s["reservation_id"] and s["completed"])
    assert current["exercise_events"][0]["completed_at"] == marked
    assert current["exercise_events"][0]["completed_key"] == current["completed"][0]
    assert current["exercise_events"][0]["session_id"] == current["id"]
    assert current["id"] != saved["id"]
    old = next(s for s in restored["sessions"] if s["notes"] == "" and s["performed_at"] == "2026-05-01T10:00:00+00:00")
    assert old["exercise_events"][0]["completed_at"] is None
    assert old["exercise_events"][0]["logged_at"] is None



def test_resaving_legacy_event_records_log_time_without_inventing_completion_time(tmp_path):
    repo, coach, sid, booking, program, steps = _context(tmp_path)
    with repo.db() as db:
        db.execute("INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
                   ("legacy-resave", sid, booking["id"], program["id"], None,
                    "2026-05-01T10:00:00+00:00", encode([steps[0]]), ""))
    repo = Repository(repo.path)
    before = next(s for s in repo.client(coach, sid)["sessions"] if s["id"] == "legacy-resave")
    old_id = before["exercise_events"][0]["id"]
    assert before["exercise_events"][0]["logged_at"] is None
    repo.complete_session(coach, {"student_id": sid, "reservation_id": booking["id"],
                                  "program_id": program["id"], "completed": [steps[0]]})
    after = next(s for s in repo.client(coach, sid)["sessions"] if s["id"] == "legacy-resave")
    assert after["exercise_events"][0]["id"] == old_id
    assert after["exercise_events"][0]["logged_at"]
    assert after["exercise_events"][0]["completed_at"] is None


def test_malformed_completed_list_is_refused_before_program_membership_check(tmp_path):
    repo, coach, sid, booking, program, _ = _context(tmp_path)
    for completed in ("step", [{"unhashable": "value"}]):
        with pytest.raises(Refused, match="Choose valid completed movements"):
            repo.complete_session(coach, {
                "student_id": sid, "reservation_id": booking["id"],
                "program_id": program["id"], "completed": completed,
            })
