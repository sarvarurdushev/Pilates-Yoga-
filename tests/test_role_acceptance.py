"""Role and selected-client boundaries for connected studio records.

These tests exercise the repository methods used by the HTTP routes.  A UI
selection is only a hint: every read and write must apply the signed-in
actor's organization, assigned clients, and role on the server.
"""

from io import BytesIO

import pytest
from PIL import Image

from pilates.platform.designer import versions
from pilates.platform.media import media_path, upload
from pilates.platform.repository import Refused, Repository, now


@pytest.fixture(scope="module")
def workspace(tmp_path_factory):
    repo = Repository(tmp_path_factory.mktemp("role-acceptance") / "studio.db")
    key = "e" * 32
    coach = repo.actor(repo.demo_login(key, "coach"))
    admin = repo.actor(repo.demo_login(key, "admin"))
    assigned = repo.people(coach)[0]["id"]
    student = repo.actor(repo.demo_login(key, "student", assigned))
    unassigned = next(
        person["id"] for person in repo.people(admin)
        if person["id"] not in {p["id"] for p in repo.people(coach)}
    )
    other_student = repo.actor(repo.demo_login(key, "student", unassigned))
    other_coach_id = next(
        person["id"] for person in repo.people(admin, "coach")
        if person["id"] not in repo.client(admin, assigned)["coach_ids"]
    )
    other_coach = repo.actor(repo.demo_login(key, "coach", other_coach_id))
    outsider = repo.actor(repo.create_org(
        "Outside admin", "outside-role-acceptance@example.test",
        "strong-outside-password", "Outside studio",
    ))
    return repo, coach, admin, student, other_student, other_coach, outsider


def _png():
    image = Image.new("RGB", (24, 24), "#3565a2")
    buffer = BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def test_selected_client_and_coach_feedback_are_server_scoped(workspace):
    repo, coach, admin, student, other_student, other_coach, outsider = workspace
    sid = student.user_id
    student_note = repo.save(coach, "notes", {
        "student_id": sid, "text": "Keep the shoulder movement comfortable.",
        "visibility": "student", "detail": {"source": "coach_entered"},
    })
    private_note = repo.save(coach, "notes", {
        "student_id": sid, "text": "Coach-only shoulder observation.",
        "visibility": "coach", "detail": {"source": "coach_entered"},
    })
    assert {n["id"] for n in repo.client(student, sid)["notes"]} >= {student_note["id"]}
    assert private_note["id"] not in {n["id"] for n in repo.client(student, sid)["notes"]}
    assert private_note["id"] not in {n["id"] for n in repo.list(student, "notes")["items"]}
    assert repo.get(admin, "notes", private_note["id"])["text"] == private_note["text"]
    assert repo.get(coach, "notes", private_note["id"])["text"] == private_note["text"]
    for actor in (student, other_student, other_coach, outsider):
        with pytest.raises(Refused):
            repo.get(actor, "notes", private_note["id"])
    for actor in (other_student, other_coach, outsider):
        with pytest.raises(Refused):
            repo.client(actor, sid)
        with pytest.raises(Refused):
            repo.list(actor, "notes", student_id=sid)
        with pytest.raises(Refused):
            repo.save(actor, "notes", {
                "student_id": sid, "text": "Unauthorized note", "visibility": "student"
            })
    assert [p["id"] for p in repo.bootstrap(student)["students"]] == [sid]
    assert sid in {p["id"] for p in repo.bootstrap(coach)["students"]}
    assert sid not in {p["id"] for p in repo.bootstrap(other_coach)["students"]}
    other_assigned = next(p["id"] for p in repo.people(coach) if p["id"] != sid)
    foreign_analysis = repo.list(coach, "analyses", student_id=other_assigned)["items"][0]["id"]
    with pytest.raises(Refused):
        repo.save(coach, "notes", {
            "student_id": sid, "analysis_id": foreign_analysis,
            "text": "Should not attach another client's assessment",
            "visibility": "student",
        })


def test_scan_media_and_private_plan_do_not_escape_client_or_tenant(workspace):
    repo, coach, admin, student, other_student, other_coach, outsider = workspace
    sid = student.user_id
    image = _png()
    scan_media = upload(repo, coach, BytesIO(image), len(image), "scan.png", "image/png", "scan", student_id=sid)
    scan = repo.save(coach, "scans", {
        "student_id": sid, "media_id": scan_media["id"],
        "name": "Client-provided shoulder image", "scan_type": "Other",
        "captured_at": now(),
    })
    assert repo.get(student, "scans", scan["id"])["media_id"] == scan_media["id"]
    assert media_path(repo, student, scan_media["id"])[0].is_file()
    other_assigned = next(p["id"] for p in repo.people(coach) if p["id"] != sid)
    other_media = upload(repo, coach, BytesIO(image), len(image), "other-scan.png", "image/png", "scan", student_id=other_assigned)
    with pytest.raises(Refused):
        repo.save(coach, "scans", {
            "student_id": sid, "media_id": other_media["id"],
            "name": "Wrong client's image", "scan_type": "Other", "captured_at": now(),
        })
    for actor in (other_student, other_coach, outsider):
        with pytest.raises(Refused):
            repo.get(actor, "scans", scan["id"])
        with pytest.raises(Refused):
            media_path(repo, actor, scan_media["id"])

    exercise = repo.save(coach, "exercises", {
        "name": "Private shoulder exercise", "category": "Mobility",
        "visibility": "private", "detail": {"program_only": True},
    })
    coach_media = upload(repo, coach, BytesIO(image), len(image), "coach.png", "image/png", "exercise", exercise_id=exercise["id"])
    program = repo.save(coach, "programs", {
        "name": "Private client plan", "goal": "Comfortable range",
        "detail": {"student_id": sid, "status": "Active", "coach_notes": "Internal coach discussion"},
        "steps": [{"exercise_id": exercise["id"], "sets": 2, "reps": 6,
                   "detail": {"student_instructions": "Move slowly",
                              "coach_instructions": "Observe scapular control",
                              "media": [{"media_id": coach_media["id"], "kind": "coach_photo", "visibility": "coach"}]}}],
    })
    repo.assign_program(coach, {"program_id": program["id"], "student_id": sid})
    visible = repo.get(student, "programs", program["id"])
    assert "coach_notes" not in visible["detail"]
    assert "coach_instructions" not in visible["steps"][0]["detail"]
    assert visible["steps"][0]["detail"]["media"] == []
    assert "coach_notes" not in versions(repo, student, program["id"])["items"][0]["snapshot"]["detail"]
    assert "coach_notes" not in next(p for p in repo.list(student, "programs")["items"] if p["id"] == program["id"])["detail"]
    with pytest.raises(Refused):
        media_path(repo, student, coach_media["id"])
    for actor in (other_student, other_coach, outsider):
        with pytest.raises(Refused):
            repo.get(actor, "programs", program["id"])
        with pytest.raises(Refused):
            versions(repo, actor, program["id"])
    assert repo.get(admin, "programs", program["id"])["detail"]["coach_notes"] == "Internal coach discussion"
    assert repo.get(coach, "programs", program["id"])["steps"][0]["detail"]["media"][0]["media_id"] == coach_media["id"]


def test_http_routes_keep_selected_client_and_private_media_scoped(workspace):
    import json
    import threading
    import urllib.error
    import urllib.parse
    import urllib.request

    from pilates.serve import serve

    repo, coach, admin, student, other_student, other_coach, outsider = workspace
    sid = student.user_id
    another = other_student.user_id
    private = repo.save(coach, "notes", {
        "student_id": sid, "text": "Private HTTP coach review",
        "visibility": "coach",
    })
    image = _png()
    media = upload(repo, coach, BytesIO(image), len(image), "http-scan.png", "image/png", "scan", student_id=sid)
    server, url = serve(None, port=0, db=str(repo.path))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = url.rsplit("/", 1)[0]

    def request(path, actor=None, body=None):
        headers = {}
        if actor:
            headers["Cookie"] = "motion_session=" + repo.issue(actor.user_id, actor.role)
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers.update({"Content-Type": "application/json", "X-Platform-Request": "1"})
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            content = response.read()
            return response.status, json.loads(content) if response.headers.get_content_type() == "application/json" else content

    try:
        target = urllib.parse.quote(sid)
        private_id = urllib.parse.quote(private["id"])
        media_id = urllib.parse.quote(media["id"])
        assert request("/platform/client?id=" + target)[0] == 401
        assert request("/platform/client?id=" + target, admin)[0] == 200
        assert request("/platform/client?id=" + target, coach)[0] == 200
        assert request("/platform/client?id=" + target, student)[0] == 200
        for actor in (other_student, other_coach, outsider):
            assert request("/platform/client?id=" + target, actor)[0] == 403
            assert request("/platform/record?collection=notes&id=" + private_id, actor)[0] == 404
            assert request("/platform/media?id=" + media_id, actor)[0] == 404
        assert request("/platform/record?collection=notes&id=" + private_id, student)[0] == 404
        assert request("/platform/record?collection=notes&id=" + private_id, coach)[0] == 200
        assert request("/platform/media?id=" + media_id, student)[0] == 200
        assert request("/platform/list?collection=analyses&student_id=" + urllib.parse.quote(another), student)[0] == 403
        assert request("/platform/save", student, {
            "collection": "notes", "item": {"student_id": sid, "text": "Student edit"}
        })[0] == 403
    finally:
        server.shutdown()
        server.server_close()


def test_feedback_program_must_be_assigned_to_selected_client(workspace):
    repo, coach, admin, student, other_student, other_coach, outsider = workspace
    sid = student.user_id
    another = next(p["id"] for p in repo.people(coach) if p["id"] != sid)
    foreign = repo.save(coach, "programs", {
        "name": "Another client's personal plan",
        "detail": {"student_id": another, "status": "Active"},
        "steps": [],
    })
    repo.assign_program(coach, {"program_id": foreign["id"], "student_id": another})
    own = repo.save(coach, "programs", {
        "name": "Selected client's plan",
        "detail": {"student_id": sid, "status": "Active"},
        "steps": [],
    })
    note_data = {
        "student_id": sid, "text": "Review this client's comfortable range.",
        "visibility": "student", "region_id": "right_shoulder",
    }
    for actor in (coach, admin):
        with pytest.raises(Refused, match="Assign the program to this client"):
            repo.save(actor, "notes", {**note_data, "program_id": foreign["id"]})
        with pytest.raises(Refused, match="Assign the program to this client"):
            repo.save(actor, "notes", {**note_data, "program_id": own["id"]})
    repo.assign_program(coach, {"program_id": own["id"], "student_id": sid})
    note = repo.save(coach, "notes", {**note_data, "program_id": own["id"]})
    assert repo.get(student, "notes", note["id"])["program_id"] == own["id"]
    assert repo.get(student, "programs", own["id"])["id"] == own["id"]
    with pytest.raises(Refused, match="Assign the program to this client"):
        repo.save(coach, "notes", {"id": note["id"], "program_id": foreign["id"]})
    assert repo.get(student, "notes", note["id"])["program_id"] == own["id"]
    replacement = repo.save(coach, "programs", {
        "name": "Selected client's next plan",
        "detail": {"student_id": sid, "status": "Active"},
        "steps": [],
    })
    repo.assign_program(coach, {"program_id": replacement["id"], "student_id": sid})
    historical = repo.save(coach, "notes", {
        "id": note["id"], "text": "Earlier assigned plan remains linked to this feedback.",
    })
    assert historical["program_id"] == own["id"]
    assert repo.get(student, "programs", own["id"])["id"] == own["id"]
    general = repo.save(coach, "notes", note_data)
    assert general["program_id"] is None
