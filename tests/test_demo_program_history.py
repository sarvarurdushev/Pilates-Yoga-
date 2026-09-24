"""Synthetic featured-client programs keep revisions, evidence, and sessions aligned."""

from datetime import datetime, timedelta, timezone
import pytest

from pilates.platform.repository import Actor, Refused, Repository, encode
from pilates.platform.designer import versions
from pilates.platform.demo_program_history import seed_featured_program_history


def _studio(tmp_path):
    repo = Repository(tmp_path / "demo.db")
    org = "demo-program-test"
    coach = Actor("coach-test", org, "coach", True)
    student = Actor("student-test", org, "student", True)
    start = datetime(2026, 4, 1, 1, tzinfo=timezone.utc)
    with repo.db() as db:
        db.execute("INSERT INTO p_organizations VALUES (?,?,1,?)", (org, "Demo", start.isoformat()))
        db.execute("INSERT INTO p_users(id,org_id,name,email) VALUES (?,?,?,?)", (coach.user_id, org, "Demo Coach", "coach@example.org"))
        db.execute("INSERT INTO p_roles VALUES (?,?)", (coach.user_id, "coach"))
        db.execute("INSERT INTO p_coaches VALUES (?,?)", (coach.user_id, ""))
        db.execute("INSERT INTO p_users(id,org_id,name,email) VALUES (?,?,?,?)", (student.user_id, org, "Featured Client", "student@example.org"))
        db.execute("INSERT INTO p_roles VALUES (?,?)", (student.user_id, "student"))
        db.execute("INSERT INTO p_students(id) VALUES (?)", (student.user_id,))
        db.execute("INSERT INTO p_coach_students VALUES (?,?)", (coach.user_id, student.user_id))
    exercises = [repo.save(coach, "exercises", {"name": name, "category": "Mobility", "region_id": "right_shoulder"}) for name in ("Breathing", "Shoulder control", "Wall slide")]
    base = repo.save(coach, "programs", {
        "name": "Shoulder alignment · coached practice", "goal": "Keep a comfortable range",
        "region_id": "right_shoulder", "steps": [
            {"exercise_id": exercise["id"], "phase": "Warm-up" if index == 0 else "Practice", "sets": 2, "reps": 8, "seconds": 60, "rest": 30}
            for index, exercise in enumerate(exercises)
        ],
    })
    aids = []
    with repo.db() as db:
        for visit in range(20):
            when = (start + timedelta(days=7 * visit)).isoformat()
            aid = f"analysis-{visit:02d}"
            aids.append(aid)
            db.execute("INSERT INTO p_analyses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (aid, org, student.user_id, coach.user_id, None, "movement", "Standing balance", when, "reviewed", 1, "{}", "{}"))
            db.execute("INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)", (f"session-{visit:02d}", student.user_id, None, base["id"], aid, when, encode([e["id"] for e in exercises]), "Synthetic demo session"))
            db.execute("INSERT INTO p_notes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (f"note-{visit:02d}", org, student.user_id, coach.user_id, aid, "right_shoulder", None, base["id"], exercises[1]["id"], "Demo coaching observation", "student", when, "{}"))
    repo.assign_program(coach, {"student_id": student.user_id, "program_id": base["id"], "analysis_id": aids[-1]})
    return repo, coach, student, base, aids


def test_featured_demo_program_story_is_connected_and_repeatable(tmp_path):
    repo, coach, student, base, aids = _studio(tmp_path)
    pid = seed_featured_program_history(repo, coach, student.user_id, base["id"], aids)
    assert pid != base["id"]
    program = repo.get(coach, "programs", pid)
    assert program["detail"]["demo"] is True
    assert program["detail"]["phase"] == "Progression"
    assert program["detail"]["student_id"] == student.user_id
    assert program["version"] == 4
    assert any(s.get("type") == "note" for s in program["steps"])
    assert program["steps"][2]["detail"]["target_region_ids"] == ["right_shoulder"]
    history = versions(repo, coach, pid)["items"]
    assert [r["version"] for r in history] == [4, 3, 2, 1]
    assert [r["source_id"] for r in history[:3]] == [aids[13], aids[6], aids[0]]
    assert all("Demo simulation" in r["reason"] for r in history)
    assert history[0]["snapshot"]["steps"][2]["reps"] > history[-2]["snapshot"]["steps"][2]["reps"]
    with repo.db() as db:
        active = db.execute("SELECT program_id FROM p_program_assignments WHERE student_id=? AND active=1", (student.user_id,)).fetchall()
        assert [r[0] for r in active] == [pid]
        sessions = db.execute("SELECT ts.analysis_id,pv.version FROM p_training_sessions ts JOIN p_training_session_program_versions pv ON pv.session_id=ts.id WHERE ts.student_id=? ORDER BY ts.performed_at", (student.user_id,)).fetchall()
        assert len(sessions) == 20
        assert [sessions[i]["version"] for i in (0, 7, 14, 19)] == [2, 3, 4, 4]
        assert db.execute("SELECT COUNT(*) FROM p_notes WHERE student_id=? AND program_id=?", (student.user_id, pid)).fetchone()[0] == 20
        assert "adjust repetitions" in db.execute("SELECT text FROM p_notes WHERE analysis_id=?", (aids[6],)).fetchone()[0]
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    assert seed_featured_program_history(repo, coach, student.user_id, base["id"], aids) == pid
    assert versions(repo, student, pid)["total"] == 4


def test_featured_history_rejects_real_or_cross_client_data(tmp_path):
    repo, coach, student, base, aids = _studio(tmp_path)
    with pytest.raises(Refused):
        seed_featured_program_history(repo, Actor(coach.user_id, coach.org_id, "coach", False), student.user_id, base["id"], aids)
    with repo.db() as db:
        db.execute("UPDATE p_analyses SET demo=0 WHERE id=?", (aids[4],))
    with pytest.raises(Refused):
        seed_featured_program_history(repo, coach, student.user_id, base["id"], aids)
    with repo.db() as db:
        assert db.execute("SELECT COUNT(*) FROM p_programs WHERE json_extract(detail,'$.demo_history_for')=?", (student.user_id,)).fetchone()[0] == 0
