"""Connected coach plan editing, student privacy, history, and tenant scope."""

from io import BytesIO
from PIL import Image
import pytest

from pilates.platform.repository import Repository, Refused
from pilates.platform.media import upload
from pilates.platform.designer import versions, duplicate, templates


@pytest.fixture(scope="module")
def studio(tmp_path_factory):
    repo = Repository(tmp_path_factory.mktemp("designer") / "studio.db")
    key = "a" * 32
    coach = repo.actor(repo.demo_login(key, "coach"))
    admin = repo.actor(repo.demo_login(key, "admin"))
    student = repo.actor(repo.demo_login(key, "student"))
    return repo, coach, admin, student


def _image():
    image = Image.new("RGB", (32, 32), "#3565a2")
    buffer = BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def test_program_revisions_media_and_student_projection(studio):
    repo, coach, admin, student = studio
    sid = student.user_id
    analysis_id = repo.list(coach, "analyses", student_id=sid)["items"][0]["id"]
    exercise = repo.save(coach, "exercises", {
        "name": "Client shoulder control", "category": "Mobility",
        "region_id": "right_shoulder", "visibility": "private",
        "detail": {"program_only": True, "description": "Controlled movement", "target_region_ids": ["right_shoulder"]},
        "resources": [{"title": "Instruction", "url": "https://example.org/video", "type": "video", "visibility": "student"}],
    })
    assert exercise["id"] not in {item["id"] for item in repo.list(coach, "exercises", q="Client shoulder control")["items"]}
    still = repo.get(coach, "exercises", exercise["id"])
    assert still["resources"][0]["detail"]["type"] == "video"
    image = _image()
    photo = upload(repo, coach, BytesIO(image), len(image), "start.png", "image/png", "exercise", exercise_id=exercise["id"])
    video_data = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 32
    video = upload(repo, coach, BytesIO(video_data), len(video_data), "coach.mp4", "video/mp4", "exercise", exercise_id=exercise["id"])
    program = repo.save(coach, "programs", {
        "name": "Shoulder control · Phase 1", "goal": "Repeat a comfortable range", "region_id": "right_shoulder",
        "detail": {"student_id": sid, "description": "Client-specific foundation", "status": "Draft", "start_date": "2026-09-24", "duration_weeks": 4, "sessions_per_week": 2, "target_region_ids": ["right_shoulder"], "coach_notes": "Private discussion", "phases": [{"name": "Foundation", "weeks_start": 1, "weeks_end": 4}]},
        "steps": [{"exercise_id": exercise["id"], "phase": "Foundation", "sets": 2, "reps": 6, "seconds": 40, "rest": 25, "detail": {
            "section": "MOBILITY", "student_instructions": "Move gently", "coach_instructions": "Observe scapular rhythm", "why_assigned": "Shoulder movement observation", "target_region_ids": ["right_shoulder"],
            "media": [{"media_id": photo["id"], "kind": "coach_demonstration", "caption": "Start position", "stage": "start", "visibility": "coach"}, {"media_id": video["id"], "kind": "coach_demonstration", "caption": "Watch the shoulder", "primary": True, "visibility": "student"}],
            "references": [{"title": "Technique", "url": "https://example.org/shoulder", "type": "video", "visibility": "student"}],
            "source": {"kind": "analysis", "id": analysis_id},
        }}, {"type": "note", "text": "Pause after the mobility drill", "phase": "Foundation", "section": "MOBILITY", "visibility": "student"}, {"type": "note", "text": "Coach checks range", "phase": "Foundation", "section": "MOBILITY", "visibility": "coach"}],
        "change_reason": "Added after assessment", "change_source": {"kind": "analysis", "id": analysis_id},
    })
    assert program["version"] == 1
    assert program["steps"][0]["exercise_name"] == exercise["name"]
    assert len(program["steps"][0]["detail"]["media"]) == 2
    repo.assign_program(coach, {"program_id": program["id"], "student_id": sid, "analysis_id": analysis_id})
    assigned = repo.get(student, "programs", program["id"])
    assert assigned["detail"]["description"] == "Client-specific foundation"
    assert "coach_notes" not in assigned["detail"]
    assert "coach_instructions" not in assigned["steps"][0]["detail"]
    assert [m["media_id"] for m in assigned["steps"][0]["detail"]["media"]] == [video["id"]]
    assert [step["text"] for step in assigned["steps"] if step.get("type") == "note"] == ["Pause after the mobility drill"]
    with pytest.raises(Refused):
        repo.get(student, "media", photo["id"])
    assert repo.get(student, "media", video["id"])["id"] == video["id"]
    with pytest.raises(Refused, match="history"):
        repo.delete(coach, "programs", program["id"])
    changed = repo.save(coach, "programs", {"id": program["id"], "steps": [{**program["steps"][0], "reps": 9}, *program["steps"][1:]], "change_reason": "Range improved on reassessment", "change_source": {"kind": "analysis", "id": analysis_id}})
    assert changed["version"] == 2 and changed["steps"][0]["reps"] == 9
    history = versions(repo, coach, program["id"])
    assert [r["version"] for r in history["items"]] == [2, 1]
    assert history["items"][-1]["snapshot"]["steps"][0]["reps"] == 6
    assert history["items"][-1]["snapshot"]["steps"][0]["exercise_name"] == exercise["name"]
    assert history["items"][0]["reason"] == "Range improved on reassessment"
    assert history["items"][0]["source_id"] == analysis_id
    repo.complete_session(student, {"student_id": sid, "program_id": program["id"], "completed": [exercise["id"]]})
    assert repo.client(student, sid)["sessions"][0]["program_version"] == 2
    assert "coach_notes" not in versions(repo, student, program["id"])["items"][0]["snapshot"]["detail"]


def test_duplicate_template_client_scope_and_invalid_sources(studio):
    repo, coach, admin, student = studio
    source = next(p for p in repo.list(coach, "programs")["items"] if p["name"] == "Shoulder control · Phase 1")
    other = next(person["id"] for person in repo.people(coach) if person["id"] != student.user_id)
    with pytest.raises(Refused):
        repo.assign_program(coach, {"program_id": source["id"], "student_id": other})
    template = duplicate(repo, coach, {"program_id": source["id"], "name": "Shoulder foundation template", "as_template": True})
    assert template["detail"]["template"] is True
    assert template["version"] == 1 and template["detail"]["copied_from"] == source["id"]
    assert template["id"] in {p["id"] for p in templates(repo, coach)["items"]}
    assert template["steps"][0]["exercise_id"] != repo.get(coach, "programs", source["id"])["steps"][0]["exercise_id"]
    copy = duplicate(repo, coach, {"program_id": template["id"], "student_id": other, "name": "Other client plan"})
    assert copy["detail"]["student_id"] == other
    assert copy["assignments"][0]["student_id"] == other
    assert copy["detail"]["template"] is False
    assert len(copy["steps"]) == 3
    assert copy["steps"][0]["exercise_id"] != template["steps"][0]["exercise_id"]
    assert copy["steps"][0]["detail"]["media"][0]["media_id"] != template["steps"][0]["detail"]["media"][0]["media_id"]
    with pytest.raises(Refused):
        repo.get(student, "programs", copy["id"])
    with pytest.raises(Refused):
        versions(repo, student, copy["id"])
    with pytest.raises(Refused):
        templates(repo, student)
    other_org = repo.actor(repo.create_org("Other", "designer-other@example.org", "a-strong-password", "Other Studio"))
    with pytest.raises(Refused):
        duplicate(repo, other_org, {"program_id": source["id"]})
    with pytest.raises(Refused):
        repo.save(coach, "programs", {"id": source["id"], "change_source": {"kind": "analysis", "id": "bad-id"}})
    with repo.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_program_http_routes(studio):
    import json
    import threading
    import urllib.request
    import urllib.error
    from pilates.serve import serve

    repo, coach, admin, student = studio
    source = next(p for p in repo.list(coach, "programs")["items"] if p["name"] == "Shoulder control · Phase 1")
    server, url = serve(None, port=0, db=str(repo.path))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = url.rsplit("/", 1)[0]
    coach_token = repo.issue(coach.user_id, "coach")
    student_token = repo.issue(student.user_id, "student")

    def request(path, token, body=None):
        headers = {"Cookie": "motion_session=" + token}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers.update({"Content-Type": "application/json", "X-Platform-Request": "1"})
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            return response.status, json.loads(response.read())

    try:
        status, body = request("/platform/program/versions?id=" + source["id"], coach_token)
        assert status == 200 and body["total"] == 2 and body["items"][0]["version"] == 2
        status, body = request("/platform/program/templates", coach_token)
        assert status == 200 and any(item["name"] == "Shoulder foundation template" for item in body["items"])
        status, body = request("/platform/program/templates", student_token)
        assert status == 403
        status, body = request("/platform/program/duplicate", coach_token, {"program_id": source["id"], "name": "HTTP copy"})
        assert status == 200 and body["name"] == "HTTP copy" and body["version"] == 1
        assert body["steps"][0]["detail"]["section"] == "MOBILITY"
    finally:
        server.shutdown()
        server.server_close()


def test_revision_evidence_survives_backup_restore(studio):
    from pilates.platform.backup import export_archive, restore_archive
    repo, coach, admin, student = studio
    fresh = repo.actor(repo.create_org("Restored owner", "designer-restore@example.org", "a-strong-password", "Restored"))
    with export_archive(repo, admin) as archive:
        restore_archive(repo, fresh, archive)
    restored = next(p for p in repo.list(fresh, "programs")["items"] if p["name"] == "Shoulder control · Phase 1")
    latest = versions(repo, fresh, restored["id"])["items"][0]
    assert latest["source_kind"] == "analysis"
    assert repo.get(fresh, "analyses", latest["source_id"])["student_id"] == restored["detail"]["student_id"]
    assert latest["snapshot"]["steps"][0]["detail"]["source"]["id"] == latest["source_id"]
