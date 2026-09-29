"""Coach notes and scans may be attached to a selected visit without a capture."""

from io import BytesIO

import pytest
from PIL import Image

from pilates.platform.backup import export_archive, restore_archive
from pilates.platform.media import upload
from pilates.platform.repository import Refused, Repository


def studio(tmp_path):
    repo = Repository(tmp_path / "studio.db")
    admin = repo.actor(repo.create_org("Owner", "visit-owner@example.test", "long-visit-password", "Visit studio"))
    first = repo.save_person(admin, {"name": "First client", "roles": ["student"]})["id"]
    second = repo.save_person(admin, {"name": "Second client", "roles": ["student"]})["id"]
    first_visit = repo.complete_session(admin, {"student_id": first, "completed": []})["id"]
    later_visit = repo.complete_session(admin, {"student_id": first, "completed": []})["id"]
    other_client_visit = repo.complete_session(admin, {"student_id": second, "completed": []})["id"]
    picture = BytesIO()
    Image.new("RGB", (8, 8), "white").save(picture, format="PNG")
    data = picture.getvalue()
    media = upload(repo, admin, BytesIO(data), len(data), "example.png", "image/png", "scan", first)
    return repo, admin, first, second, first_visit, later_visit, other_client_visit, media


def test_explicit_visit_links_are_scoped_and_survive_edits(tmp_path):
    repo, admin, first, second, visit, later, second_visit, media = studio(tmp_path)
    scan = repo.save(admin, "scans", {
        "student_id": first, "media_id": media["id"], "name": "Uploaded reference",
        "scan_type": "Image", "captured_at": "2026-09-25", "session_id": visit,
    })
    note = repo.save(admin, "notes", {
        "student_id": first, "scan_id": scan["id"], "text": "Discussed at this visit",
        "session_id": visit,
    })
    assert scan["session_id"] == note["session_id"] == visit
    assert repo.get(admin, "notes", note["id"])["session_id"] == visit
    client = repo.client(admin, first)
    assert next(s for s in client["scans"] if s["id"] == scan["id"])["session_id"] == visit
    assert next(n for n in client["notes"] if n["id"] == note["id"])["session_id"] == visit
    assert next(n for n in repo.list(admin, "notes", student_id=first)["items"] if n["id"] == note["id"])["session_id"] == visit

    # Neither a foreign client nor an arbitrary record ID can be used as the visit.
    for invalid in (second_visit, "missing-visit"):
        with pytest.raises(Refused, match="visit belonging to this client"):
            repo.save(admin, "notes", {"id": note["id"], "session_id": invalid})
        with pytest.raises(Refused, match="visit belonging to this client"):
            repo.save(admin, "scans", {"id": scan["id"], "session_id": invalid})
    with pytest.raises(Refused, match="different visit"):
        repo.save(admin, "notes", {"id": note["id"], "session_id": later})
    with pytest.raises(Refused, match="Move linked coach notes"):
        repo.save(admin, "scans", {"id": scan["id"], "session_id": later})
    assert repo.get(admin, "notes", note["id"])["session_id"] == visit
    assert repo.get(admin, "scans", scan["id"])["session_id"] == visit

    stranger = repo.actor(repo.create_org("Stranger", "other-visit@example.test", "other-visit-password", "Other studio"))
    third = repo.save_person(stranger, {"name": "Third client", "roles": ["student"]})["id"]
    with pytest.raises(Refused, match="visit belonging to this client"):
        repo.save(stranger, "notes", {"student_id": third, "text": "Cross-organization", "session_id": visit})
    with pytest.raises(Refused, match="workspace"):
        repo.get(stranger, "notes", note["id"])

    # The link is explicit and can be cleared; existing records without it remain valid.
    unlinked = repo.save(admin, "notes", {"student_id": second, "text": "Standalone follow-up"})
    assert unlinked["session_id"] is None
    cleared = repo.save(admin, "notes", {"id": note["id"], "session_id": None})
    assert cleared["session_id"] is None
    scan = repo.save(admin, "scans", {"id": scan["id"], "session_id": None})
    assert scan["session_id"] is None
    with repo.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_analysis_conflicts_and_backup_round_trip(tmp_path):
    repo, admin, first, _, visit, later, _, media = studio(tmp_path)
    # The assessment itself is attached to a different visit.
    with repo.db() as db:
        db.execute(
            "INSERT INTO p_analyses(id,org_id,student_id,kind,protocol,created_at,status) VALUES (?,?,?,?,?,?,?)",
            ("assessment-later", admin.org_id, first, "posture", "Standing", "2026-09-25", "complete"),
        )
        db.execute("INSERT INTO p_session_analyses VALUES (?,?)", (later, "assessment-later"))
    with pytest.raises(Refused, match="assessment belongs to a different visit"):
        repo.save(admin, "notes", {"student_id": first, "analysis_id": "assessment-later", "text": "Wrong visit", "session_id": visit})
    with pytest.raises(Refused, match="assessment belongs to a different visit"):
        repo.save(admin, "scans", {"student_id": first, "analysis_id": "assessment-later", "media_id": media["id"], "name": "Wrong visit", "scan_type": "Image", "captured_at": "2026-09-25", "session_id": visit})
    scan = repo.save(admin, "scans", {
        "student_id": first, "media_id": media["id"], "name": "Uploaded reference",
        "scan_type": "Image", "captured_at": "2026-09-25", "session_id": visit,
    })
    note = repo.save(admin, "notes", {"student_id": first, "scan_id": scan["id"], "text": "Linked discussion", "session_id": visit})
    fresh = repo.actor(repo.create_org("Recovery", "visit-recovery@example.test", "visit-recovery-password", "Recovered studio"))
    with export_archive(repo, admin) as archive:
        restore_archive(repo, fresh, archive)
    restored_client = next(p for p in repo.people(fresh) if p["name"] == "First client")
    restored = repo.client(fresh, restored_client["id"])
    restored_scan = next(s for s in restored["scans"] if s["name"] == scan["name"])
    restored_note = next(n for n in restored["notes"] if n["text"] == note["text"])
    assert restored_scan["session_id"] == restored_note["session_id"]
    assert restored_scan["session_id"] in {s["id"] for s in restored["sessions"]}
    assert restored_scan["session_id"] != visit
    with repo.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
