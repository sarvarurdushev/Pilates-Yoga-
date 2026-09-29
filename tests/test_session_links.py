"""A real capture and the practice performed for one booking share a visit record."""

import pytest

from pilates.platform.analysis import save_analysis
from pilates.platform.repository import Refused, Repository


def empty_posture():
    # The persistence contract does not depend on whether landmark inference
    # accepted the image; refused captures must remain traceable to the visit.
    return {"kind": "posture", "views": [{"view": "front", "report": {"people": []}}],
            "summary": {"metrics": []}}


def test_capture_reservation_and_practice_are_one_visit(tmp_path):
    repo = Repository(tmp_path / "visits.db")
    key = "c" * 32
    coach = repo.actor(repo.demo_login(key, "coach"))
    client = repo.people(coach)[0]
    sid = client["id"]
    booking = repo.client(coach, sid)["reservations"][0]
    active = repo.client(coach, sid)["programs"][0]
    program = repo.get(coach, "programs", active["program_id"])
    before = len(repo.client(coach, sid)["sessions"])
    aid = save_analysis(repo, coach, sid, empty_posture(), protocol="Standing posture",
                        location_id=booking["location_id"], reservation_id=booking["id"])
    after_capture = repo.client(coach, sid)
    assert len(after_capture["sessions"]) == before + 1
    visit = next(s for s in after_capture["sessions"] if s["analysis_id"] == aid)
    assert visit["reservation_id"] == booking["id"]
    assert not visit["completed"]
    completed = [next(s for s in program["steps"] if s.get("exercise_id"))["id"]]
    result = repo.complete_session(coach, {
        "student_id": sid, "reservation_id": booking["id"], "analysis_id": aid,
        "program_id": program["id"], "completed": completed,
        "notes": "Coach reviewed comfortable control.",
    })
    assert result["id"] == visit["id"]
    joined = repo.client(coach, sid)
    assert len(joined["sessions"]) == before + 1
    saved = next(s for s in joined["sessions"] if s["id"] == visit["id"])
    assert saved["analysis_id"] == aid and saved["completed"] == completed
    assert saved["program_id"] == program["id"] and saved["program_version"]
    assert saved["recorded_by"]["name"] == repo.bootstrap(coach)["user"]["name"]
    assert saved["recorded_by"]["role"] == "coach"
    assert next(r for r in joined["reservations"] if r["id"] == booking["id"])["status"] == "attended"
    assert repo.get(coach, "analyses", aid)["detail"]["recorded_by"]["role"] == "coach"


def test_booking_and_capture_cannot_cross_clients_or_locations(tmp_path):
    repo = Repository(tmp_path / "scope.db")
    key = "e" * 32
    coach = repo.actor(repo.demo_login(key, "coach"))
    clients = repo.people(coach)
    a, b = clients[:2]
    booking_a = repo.client(coach, a["id"])["reservations"][0]
    booking_b = repo.client(coach, b["id"])["reservations"][0]
    with pytest.raises(Refused, match="reservation"):
        save_analysis(repo, coach, a["id"], empty_posture(), location_id=booking_a["location_id"],
                      reservation_id=booking_b["id"])
    aid = save_analysis(repo, coach, a["id"], empty_posture(), location_id=booking_a["location_id"],
                        reservation_id=booking_a["id"])
    with pytest.raises(Refused, match="another client"):
        repo.complete_session(coach, {
            "student_id": b["id"], "analysis_id": aid, "completed": [],
        })
    other_location = next(l for l in repo.list(coach, "locations")["items"] if l["id"] != booking_a["location_id"]) if len(repo.list(coach, "locations")["items"]) > 1 else None
    if other_location:
        with pytest.raises(Refused, match="location"):
            save_analysis(repo, coach, a["id"], empty_posture(), location_id=other_location["id"],
                          reservation_id=booking_a["id"])


def test_two_assessments_share_one_booked_visit_without_losing_either(tmp_path):
    repo = Repository(tmp_path / "multi-visits.db")
    coach = repo.actor(repo.demo_login("f" * 32, "coach"))
    client = repo.people(coach)[0]
    sid = client["id"]
    booking = repo.client(coach, sid)["reservations"][0]
    before = len(repo.client(coach, sid)["sessions"])
    first = save_analysis(repo, coach, sid, empty_posture(), protocol="Standing posture",
                          location_id=booking["location_id"], reservation_id=booking["id"])
    second = save_analysis(repo, coach, sid, empty_posture(), protocol="Shoulder motion",
                           location_id=booking["location_id"], reservation_id=booking["id"])
    sessions = repo.client(coach, sid)["sessions"]
    assert len(sessions) == before + 1
    visit = next(s for s in sessions if s["reservation_id"] == booking["id"])
    assert visit["analysis_id"] == first
    assert set(visit["analysis_ids"]) == {first, second}
    result = repo.complete_session(coach, {
        "student_id": sid, "reservation_id": booking["id"], "analysis_id": second,
        "completed": [], "notes": "Reviewed both assessments.",
    })
    assert result["id"] == visit["id"]
    saved = next(s for s in repo.client(coach, sid)["sessions"] if s["id"] == visit["id"])
    assert set(saved["analysis_ids"]) == {first, second}
    from pilates.platform.backup import export_archive, restore_archive
    admin = repo.actor(repo.demo_login("f" * 32, "admin"))
    fresh = repo.actor(repo.create_org("Visit restore", "visits-restore@example.org",
                                           "a-strong-password", "Restored"))
    with export_archive(repo, admin) as archive:
        restore_archive(repo, fresh, archive)
    restored_person = next(p for p in repo.people(fresh) if p["name"] == client["name"])
    restored_sessions = repo.client(fresh, restored_person["id"])["sessions"]
    restored_visit = next(s for s in restored_sessions if len(s["analysis_ids"]) == 2)
    assert restored_visit["notes"] == "Reviewed both assessments."
    assert restored_visit["recorded_by"]["role"] == "coach"


def test_student_practice_records_its_author_without_a_capture(tmp_path):
    repo = Repository(tmp_path / "student-practice.db")
    student = repo.actor(repo.demo_login("a" * 32, "student"))
    client = repo.client(student, student.user_id)
    assignment = client["programs"][0]
    program = repo.get(student, "programs", assignment["program_id"])
    step_id = next(step["id"] for step in program["steps"] if step.get("exercise_id"))
    result = repo.complete_session(student, {
        "student_id": student.user_id, "program_id": program["id"], "completed": [step_id],
    })
    saved = next(s for s in repo.client(student, student.user_id)["sessions"] if s["id"] == result["id"])
    assert saved["analysis_ids"] == []
    assert saved["recorded_by"]["name"] == repo.bootstrap(student)["user"]["name"]
    assert saved["recorded_by"]["role"] == "student"
