"""Coach notes and scans may be attached to a selected visit without a capture."""

from io import BytesIO
import json
import zipfile

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
    marker = repo.annotate(admin, {
        "scan_id": scan["id"], "x": 0.2, "y": 0.4, "text": "Visit-linked body marker",
    })
    assert marker["session_id"] == visit
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
    assert restored_scan["findings"][0]["session_id"] == restored_scan["session_id"]
    with repo.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()

    # An archive made before marker-specific links cannot prove whether the
    # scan was linked before or after its marker. Keep that marker unlinked.
    legacy_archive = tmp_path / "pre-marker-visits.zip"
    with export_archive(repo, admin) as archive, zipfile.ZipFile(archive) as original, zipfile.ZipFile(legacy_archive, "w") as legacy:
        for entry in original.infolist():
            if entry.filename == "records/p_scan_finding_visits.jsonl":
                continue
            content = original.read(entry.filename)
            if entry.filename == "manifest.json":
                manifest = json.loads(content)
                manifest["tables"].remove("p_scan_finding_visits")
                content = json.dumps(manifest).encode()
            legacy.writestr(entry, content)
    legacy_owner = repo.actor(repo.create_org(
        "Older restore", "visit-legacy@example.test", "legacy-visit-password", "Older studio",
    ))
    restore_archive(repo, legacy_owner, legacy_archive)
    legacy_client = next(p for p in repo.people(legacy_owner) if p["name"] == "First client")
    legacy_scan = next(s for s in repo.client(legacy_owner, legacy_client["id"])["scans"]
                       if s["name"] == "Uploaded reference")
    assert legacy_scan["session_id"] is not None
    assert legacy_scan["findings"][0]["session_id"] is None


def test_client_visit_scan_list_carries_saved_markers_and_authors(tmp_path):
    repo, admin, first, second, visit, _, _, media = studio(tmp_path)
    scan = repo.save(admin, "scans", {
        "student_id": first, "media_id": media["id"], "name": "Client scan",
        "scan_type": "Image", "captured_at": "2026-09-25", "session_id": visit,
    })
    marker = repo.annotate(admin, {
        "scan_id": scan["id"], "x": 0.25, "y": 0.5,
        "frame_index": 0, "text": "Saved visual observation",
    })
    source = repo.get(admin, "scans", scan["id"])["findings"][0]
    stored = next(item for item in repo.client(admin, first)["scans"] if item["id"] == scan["id"])
    assert stored["session_id"] == visit
    assert len(stored["findings"]) == 1
    finding = stored["findings"][0]
    assert finding["id"] == marker["id"] == source["id"]
    assert marker["session_id"] == finding["session_id"] == source["session_id"] == visit
    assert finding["scan_id"] == scan["id"]
    assert finding["frame_index"] == source["frame_index"] == 0
    assert finding["created_at"] == source["created_at"]
    assert finding["author_id"] == admin.user_id
    assert finding["author_name"] == "Owner"
    assert finding["text"] == "Saved visual observation"
    assert repo.client(admin, second)["scans"] == []


def test_new_body_markers_require_exact_scan_visit_and_keep_it_on_edits(tmp_path):
    repo, admin, first, _, visit, later, _, media = studio(tmp_path)
    scan = repo.save(admin, "scans", {
        "student_id": first, "media_id": media["id"], "name": "Unlinked image",
        "scan_type": "Image", "captured_at": "2026-09-25",
    })
    with pytest.raises(Refused, match="Link this scan to a recorded visit"):
        repo.annotate(admin, {
            "scan_id": scan["id"], "x": 0.3, "y": 0.4,
            "text": "Would be orphaned",
        })
    # An ordinary studio cannot bypass the visit requirement by labelling
    # its own uploaded image as a demo reference.
    repo.save(admin, "scans", {"id": scan["id"], "detail": {"demo": True}})
    with pytest.raises(Refused, match="Link this scan to a recorded visit"):
        repo.annotate(admin, {
            "scan_id": scan["id"], "x": 0.3, "y": 0.4,
            "text": "Still has no visit",
        })
    # A coach in the investor demo can also edit scan detail. The uploaded
    # image must not become a seed reference just because demo=true was set.
    with repo.db() as db:
        db.execute("UPDATE p_organizations SET demo=1 WHERE id=?", (admin.org_id,))
    demo_admin = repo.actor(repo.issue(admin.user_id, "admin"))
    assert demo_admin.demo
    with pytest.raises(Refused, match="Link this scan to a recorded visit"):
        repo.annotate(demo_admin, {
            "scan_id": scan["id"], "x": 0.3, "y": 0.4,
            "text": "Uploaded demo-org image is not a seeded reference",
        })
    repo.save(admin, "scans", {"id": scan["id"], "detail": {}})
    assert not repo.get(admin, "scans", scan["id"])["findings"]
    scan = repo.save(admin, "scans", {"id": scan["id"], "session_id": visit})
    marker = repo.annotate(admin, {
        "scan_id": scan["id"], "x": 0.3, "y": 0.4,
        "text": "Now linked to this exact visit",
    })
    assert marker["session_id"] == visit
    for replacement in (later, None):
        with pytest.raises(Refused, match="scan marker belongs to another visit"):
            repo.save(admin, "scans", {"id": scan["id"], "session_id": replacement})
    assert repo.get(admin, "scans", scan["id"])["findings"][0]["session_id"] == visit


def test_legacy_markers_stay_unlinked_when_scan_link_order_is_unknown(tmp_path):
    repo, admin, first, _, visit, _, _, media = studio(tmp_path)
    linked = repo.save(admin, "scans", {
        "student_id": first, "media_id": media["id"], "name": "Legacy visit scan",
        "scan_type": "Image", "captured_at": "2026-09-25", "session_id": visit,
    })
    general = repo.save(admin, "scans", {
        "student_id": first, "media_id": media["id"], "name": "Legacy general scan",
        "scan_type": "Image", "captured_at": "2026-09-25",
    })
    with repo.db() as db:
        for identifier, scan in (("old-linked", linked), ("old-general", general)):
            db.execute(
                "INSERT INTO p_scan_findings(id,scan_id,x,y,text,created_at) "
                "VALUES (?,?,?,?,?,?)",
                (identifier, scan["id"], 0.5, 0.5, "Older marker", "2026-09-25T00:00:00Z"),
            )
    # Reopening an existing studio must not guess which visit was active when
    # the marker was saved, even if its scan currently has a visit link.
    Repository(repo.path)
    assert repo.get(admin, "scans", linked["id"])["findings"][0]["session_id"] is None
    assert repo.get(admin, "scans", general["id"])["findings"][0]["session_id"] is None
    with repo.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_restore_rejects_marker_pointing_to_another_valid_visit(tmp_path):
    repo, admin, first, _, visit, later, _, media = studio(tmp_path)
    scan = repo.save(admin, "scans", {
        "student_id": first, "media_id": media["id"], "name": "Visit scan",
        "scan_type": "Image", "captured_at": "2026-09-25", "session_id": visit,
    })
    repo.annotate(admin, {"scan_id": scan["id"], "x": 0.5, "y": 0.5, "text": "Visit marker"})
    tampered = tmp_path / "marker-wrong-visit.zip"
    with export_archive(repo, admin) as archive, zipfile.ZipFile(archive) as original, zipfile.ZipFile(tampered, "w") as changed:
        for entry in original.infolist():
            content = original.read(entry.filename)
            if entry.filename == "records/p_scan_finding_visits.jsonl":
                marker = json.loads(content)
                marker["session_id"] = later  # Valid FK, but the wrong visit.
                content = (json.dumps(marker) + "\n").encode()
            changed.writestr(entry, content)
    fresh = repo.actor(repo.create_org(
        "Tampered restore", "tampered-marker@example.test", "tampered-visit-password", "Fresh studio",
    ))
    with pytest.raises(Refused, match="different visit or client"):
        restore_archive(repo, fresh, tampered)
    assert repo.people(fresh) == []


def test_create_only_visit_conflict_keeps_existing_practice(tmp_path):
    repo, admin, first, _, _, _, _, _ = studio(tmp_path)
    with repo.db() as db:
        db.execute(
            "INSERT INTO p_analyses(id,org_id,student_id,kind,protocol,created_at,status) "
            "VALUES (?,?,?,?,?,?,?)",
            ("capture-for-visit", admin.org_id, first, "posture", "Standing", "2026-09-25", "complete"),
        )
    saved = repo.complete_session(admin, {
        "student_id": first, "analysis_id": "capture-for-visit",
        "completed": ["actual-practice"], "notes": "Original coaching note",
    })
    before = next(s for s in repo.client(admin, first)["sessions"] if s["id"] == saved["id"])
    with pytest.raises(Refused, match="already has a recorded visit") as refused:
        repo.complete_session(admin, {
            "student_id": first, "analysis_id": "capture-for-visit",
            "completed": [], "notes": "Review only", "require_new": True,
        })
    assert refused.value.status == 409
    after = next(s for s in repo.client(admin, first)["sessions"] if s["id"] == saved["id"])
    assert after["completed"] == before["completed"] == ["actual-practice"]
    assert after["notes"] == before["notes"] == "Original coaching note"
    assert after["exercise_events"] == before["exercise_events"]


def test_note_sources_cannot_claim_different_recorded_visits(tmp_path):
    repo, admin, client_id, _, first, later, _, media = studio(tmp_path)
    with repo.db() as db:
        for identifier, visit in (
            ("assessment-first", first),
            ("assessment-first-second", first),
            ("assessment-later", later),
        ):
            db.execute(
                "INSERT INTO p_analyses(id,org_id,student_id,kind,protocol,created_at,status) "
                "VALUES (?,?,?,?,?,?,?)",
                (identifier, admin.org_id, client_id, "posture", "Standing",
                 "2026-09-25", "complete"),
            )
            db.execute("INSERT INTO p_session_analyses VALUES (?,?)", (visit, identifier))

    later_scan = repo.save(admin, "scans", {
        "student_id": client_id, "media_id": media["id"],
        "analysis_id": "assessment-later", "session_id": later,
        "name": "Later scan", "scan_type": "Image", "captured_at": "2026-09-25",
    })
    with pytest.raises(Refused, match="scan and assessment do not share"):
        repo.save(admin, "notes", {
            "student_id": client_id, "analysis_id": "assessment-first",
            "scan_id": later_scan["id"], "text": "Conflicting sources",
        })

    first_scan = repo.save(admin, "scans", {
        "student_id": client_id, "media_id": media["id"],
        "analysis_id": "assessment-first", "session_id": first,
        "name": "First scan", "scan_type": "Image", "captured_at": "2026-09-25",
    })
    compatible = repo.save(admin, "notes", {
        "student_id": client_id, "analysis_id": "assessment-first-second",
        "scan_id": first_scan["id"], "text": "Same visit, two assessments",
    })
    assert compatible["session_id"] is None
    assert compatible["scan_id"] == first_scan["id"]

    # A scan without its own analysis can still be linked to an exact visit.
    # Do not let a later scan edit strand an already saved two-source note.
    plain_scan = repo.save(admin, "scans", {
        "student_id": client_id, "media_id": media["id"], "session_id": first,
        "name": "Visit scan", "scan_type": "Image", "captured_at": "2026-09-25",
    })
    note = repo.save(admin, "notes", {
        "student_id": client_id, "analysis_id": "assessment-first",
        "scan_id": plain_scan["id"], "text": "Both sources belong to first visit",
    })
    assert note["session_id"] is None
    with pytest.raises(Refused, match="linked coach note assessment"):
        repo.save(admin, "scans", {"id": plain_scan["id"], "session_id": later})
    assert repo.get(admin, "scans", plain_scan["id"])["session_id"] == first
