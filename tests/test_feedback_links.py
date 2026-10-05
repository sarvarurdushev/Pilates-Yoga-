"""Coach feedback stays tied to the client evidence it interprets."""

import pytest

from pilates.platform.repository import Repository, Refused


def test_coach_feedback_finding_link_and_edit_provenance(tmp_path):
    repo = Repository(tmp_path / "feedback.db")
    coach = repo.actor(repo.demo_login("f" * 32))
    client = repo.people(coach)[0]
    history = repo.client(coach, client["id"])
    finding = history["observations"][0]
    note = repo.save(coach, "notes", {
        "student_id": client["id"],
        "region_id": finding["region_id"],
        "analysis_id": finding["analysis_id"],
        "text": "Practice a comfortable range and review the same view next visit.",
        "visibility": "student",
        "detail": {"observation_id": finding["id"]},
    })
    assert note["detail"]["source"] == "coach_entered"
    assert note["detail"]["observation_id"] == finding["id"]
    assert note["analysis_id"] == finding["analysis_id"]
    assert note["region_id"] == finding["region_id"]

    changed = repo.save(coach, "notes", {
        "id": note["id"], "text": "Continue the supported range; reassess next session.",
    })
    assert changed["detail"]["observation_id"] == finding["id"]
    assert changed["detail"]["updated_at"]
    assert changed["created_at"] == note["created_at"]

    other = repo.people(coach)[1]
    other_finding = repo.client(coach, other["id"])["observations"][0]
    with pytest.raises(Refused):
        repo.save(coach, "notes", {
            "student_id": client["id"],
            "text": "Must not link another client's finding.",
            "detail": {"observation_id": other_finding["id"]},
        })
