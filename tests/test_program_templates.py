"""Shared starter plans remain editable without carrying another client's evidence."""

from pilates.platform.designer import duplicate, templates, versions
from pilates.platform.repository import Repository


def test_six_starter_templates_can_be_adapted_for_another_coach(tmp_path):
    repo = Repository(tmp_path / "templates.db")
    key = "b" * 32
    org = "demo-" + key
    first = repo.actor(repo.demo_login(key, "coach"))
    other = repo.actor(repo.demo_login(key, "coach", org + "-coach1"))
    client = next(person for person in repo.people(other) if "student08" in person["id"])
    rows = templates(repo, other)["items"]
    assert {row["name"] for row in rows} == {
        "Shoulder Mobility Foundation", "Hip Stability Foundation",
        "Posture Control Program", "Beginner Pilates Foundation",
        "Lower-Body Mobility", "Balance Development",
    }
    assert all(row["owner_id"] == first.user_id for row in rows)
    assert all(row["detail"]["template_visibility"] == "organization" for row in rows)
    chosen = next(row for row in rows if row["name"] == "Balance Development")
    adapted = duplicate(repo, other, {
        "program_id": chosen["id"], "student_id": client["id"],
        "name": "Balance Development · " + client["name"],
    })
    assert adapted["owner_id"] == other.user_id
    assert adapted["detail"]["student_id"] == client["id"]
    assert adapted["detail"]["template"] is False
    assert adapted["steps"] and versions(repo, other, adapted["id"])["total"] == 1
    assert repo.get(other, "programs", chosen["id"])["detail"]["template"] is True
