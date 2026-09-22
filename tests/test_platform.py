import io
import json
import sqlite3
from datetime import datetime, timedelta, timezone
import pytest
from pilates.platform.repository import Repository, Actor, Refused
from pilates.platform.kinematics import coordinates, derivatives
from pilates.platform.media import upload, dicom_png


@pytest.fixture(scope="module")
def state(tmp_path_factory):
    path = tmp_path_factory.mktemp("platform") / "studio.db"
    repo = Repository(path)
    coach = repo.actor(repo.demo_login("1" * 32))
    admin = repo.actor(repo.demo_login("1" * 32, "admin"))
    student = repo.actor(repo.demo_login("1" * 32, "student"))
    return repo, coach, admin, student


def test_demo_relations_and_tenants(state):
    r, c, a, s = state
    assert len(r.people(a)) == 34 and len(r.people(c)) == 8 and len(r.people(s)) == 1
    assert len(r.people(a, "coach")) == 4
    assert {l["name"] for l in r.list(a, "locations")["items"]} == {
        "Songdo",
        "Gangnam",
        "Seoul",
        "Incheon",
    }
    assert r.list(a, "exercises")["total"] == 199
    assert r.list(a, "analyses")["total"] == 204
    for p in r.people(a):
        client = r.client(a, p["id"])
        assert len(client["analyses"]) == 6 and len(client["sessions"]) == 6
        assert len(client["scans"]) == 1 and len(client["notes"]) == 6
        scan = client["scans"][0]
        assert scan["region_id"] == client["programs"][0]["region_id"]
        scan_media = r.get(a, "media", scan["media_id"])
        assert scan_media["detail"]["source_url"].startswith(
            "https://commons.wikimedia.org/"
        )
        assert scan_media["detail"]["attribution"]
        assert (
            client["progress"]
            and len(client["reservations"]) == 3
            and client["programs"]
        )
    with r.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    unrelated = r.people(a)[-1]["id"]
    with pytest.raises(Refused):
        r.client(c, unrelated)
    with pytest.raises(Refused):
        r.client(s, unrelated)
    with pytest.raises(Refused):
        r.inspect(s)
    other = r.actor(
        r.create_org("Other", "other@test.example", "strong-password-here", "Other")
    )
    assert not r.people(other)
    with pytest.raises(Refused):
        r.get(other, "analyses", r.list(c, "analyses")["items"][0]["id"])


def test_real_sessions_and_role_conversion(state):
    r, c, a, s = state
    user = r.save_person(
        a,
        {
            "name": "Temporary student",
            "roles": ["student"],
            "location_ids": [r.list(a, "locations")["items"][0]["id"]],
            "coach_ids": [c.user_id],
        },
    )
    assert user["id"] in [p["id"] for p in r.people(c)]
    r.save_person(a, {"id": user["id"], "name": "Temporary coach", "roles": ["coach"]})
    assert user["id"] not in [p["id"] for p in r.people(c)]
    assert user["id"] in [p["id"] for p in r.people(a, "coach")]
    r.delete(a, "users", user["id"])
    with r.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_content_and_links(state):
    r, c, a, s = state
    students = r.people(c)
    sid = students[0]["id"]
    other = students[1]["id"]
    ex = r.save(
        c,
        "exercises",
        {
            "name": "Coach authored arm raise",
            "category": "Shoulder",
            "region_id": "right_shoulder",
            "detail": {"instructions": "Raise within the chosen range"},
            "resources": [],
        },
    )
    ex = r.save(
        c,
        "exercises",
        {
            **ex,
            "resources": [
                {"title": "Coach resource", "url": "https://example.com/coach"}
            ],
        },
    )
    assert len(ex["resources"]) == 1
    ex = r.save(c, "exercises", {"id": ex["id"], "resources": []})
    assert not ex["resources"]
    program = r.save(
        c,
        "programs",
        {
            "name": "Assigned practice",
            "region_id": "right_shoulder",
            "steps": [
                {
                    "exercise_id": ex["id"],
                    "sets": 2,
                    "reps": 6,
                    "seconds": 30,
                    "rest": 20,
                }
            ],
        },
    )
    assert program["steps"][0]["reps"] == 6
    aid = r.list(c, "analyses", student_id=sid)["items"][0]["id"]
    r.assign_program(
        c, {"student_id": sid, "program_id": program["id"], "analysis_id": aid}
    )
    with pytest.raises(Refused):
        r.assign_program(
            c, {"student_id": other, "program_id": program["id"], "analysis_id": aid}
        )
    with pytest.raises(Refused):
        r.save(s, "exercises", {"name": "Forbidden"})
    r.complete_session(
        c, {"student_id": sid, "program_id": program["id"], "completed": [ex["id"]]}
    )
    with pytest.raises(Refused):
        r.complete_session(
            c,
            {
                "student_id": sid,
                "program_id": program["id"],
                "completed": ["wrong-exercise"],
            },
        )
    with pytest.raises(Refused):
        r.delete(c, "exercises", ex["id"])
    r.delete(c, "programs", program["id"])
    r.delete(c, "exercises", ex["id"])


def test_coordinates_and_derivatives():
    lm = {"keypoints": [[100, 200]] * 17, "scores": [0.9] * 17}
    c = coordinates(lm)
    assert all(p["z"] is None for p in c)
    assert all(
        p["status"] == "unavailable" for p in c if p["space"] == "model_estimated_m"
    )
    assert (
        next(p for p in c if p["landmark_id"] == "17" and p["space"] == "image_px")[
            "status"
        ]
        == "estimated"
    )
    assert coordinates(lm, suitable=False)[0]["x"] is None
    v, a = derivatives([[0, 0], [0.2, 2], [0.4, 4], [1.5, 10], [1.7, None], [1.9, 14]])
    assert v[1][1] == 10 and a[2][1] == 0 and v[3][1] is None and v[-1][1] is None


def test_reservations_conflicts(state):
    r, c, a, s = state
    old = r.list(c, "reservations")["items"][0]
    body = {
        k: old[k]
        for k in (
            "student_id",
            "coach_id",
            "location_id",
            "room_id",
            "program_id",
            "starts_at",
            "ends_at",
            "status",
            "session_type",
        )
    }
    with pytest.raises(Refused, match="already has"):
        r.save(c, "reservations", body)
    body["ends_at"] = body["starts_at"]
    with pytest.raises(Refused, match="end time"):
        r.save(c, "reservations", body)


def test_dicom_upload_window_annotation(state, tmp_path):
    import numpy as np
    import pydicom
    from pydicom.dataset import FileDataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid
    from PIL import Image

    r, c, a, s = state
    sid = r.people(c)[0]["id"]
    path = tmp_path / "scan.dcm"
    meta = FileMetaDataset()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.MediaStorageSOPClassUID = generate_uid()
    meta.MediaStorageSOPInstanceUID = generate_uid()
    ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.Rows = 8
    ds.Columns = 8
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = np.arange(64, dtype="<u2").tobytes()
    ds.save_as(path, enforce_file_format=True)
    content = path.read_bytes()
    record = upload(
        r,
        c,
        io.BytesIO(content),
        len(content),
        "scan.dcm",
        "application/dicom",
        "scan",
        sid,
    )
    assert record["detail"]["dicom"] and "path" not in record
    image = Image.open(io.BytesIO(dicom_png(path, center=32, width=64)))
    assert image.size == (8, 8)
    scan = r.save(
        c,
        "scans",
        {
            "student_id": sid,
            "media_id": record["id"],
            "region_id": "right_shoulder",
            "name": "Manual test scan",
            "scan_type": "DICOM",
            "captured_at": "2026-09-22",
        },
    )
    r.annotate(
        c,
        {
            "scan_id": scan["id"],
            "region_id": "right_shoulder",
            "x": 0.25,
            "y": 0.5,
            "text": "Educational annotation",
        },
    )
    assert len(r.get(c, "scans", scan["id"])["findings"]) == 1
    with pytest.raises(Refused):
        r.annotate(
            c,
            {
                "scan_id": scan["id"],
                "x": 0.5,
                "y": 0.5,
                "frame_index": 2,
                "text": "Invalid frame",
            },
        )
    r.delete(c, "scans", scan["id"])
    r.delete(c, "media", record["id"])


def test_reopen_regions_preserves_links(state):
    r, c, a, s = state
    Repository(r.path)
    with r.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_admin_inspector_boundaries(state):
    from pilates.platform.inspection import overview, records

    r, c, a, s = state
    # The legacy schema shares a file, but is not an organization-scoped entity.
    with r.db() as db:
        db.execute("CREATE TABLE IF NOT EXISTS poses (secret TEXT)")
    meta = overview(r, a)
    assert "poses" not in meta and "p_sessions" not in meta
    assert meta["p_students"]["count"] == 34
    assert (
        meta["p_observations"]["count"] > 0
    )  # nullable scan/author must not hide records
    assert meta["p_pose_frames"]["count"] > 1000
    assert meta["p_training_sessions"]["count"] >= 204
    other = r.actor(
        r.create_org(
            "Inspector", "inspect@example.test", "long-enough-password", "Private"
        )
    )
    theirs = overview(r, other)
    for table, info in theirs.items():
        if table not in {
            "p_regions",
            "p_landmarks",
            "p_schema",
            "p_organizations",
            "p_users",
            "p_roles",
            "p_audit",
        }:
            assert info["count"] == 0, table
    assert theirs["p_organizations"]["count"] == 1
    rows = records(r, a, "p_users")
    assert all(u["org_id"] == a.org_id for u in rows["items"])
    assert "password_hash" not in rows["columns"]
    assert "path" not in records(r, a, "p_media")["columns"]
    with pytest.raises(Refused):
        records(r, a, "p_sessions")
    with pytest.raises(Refused):
        records(r, a, "poses")
    with pytest.raises(Refused):
        overview(r, c)


def test_copied_exercise_media_is_independent(state):
    from PIL import Image
    from pilates.platform.media import copy_exercise_media, media_path

    r, c, a, s = state
    ex = r.save(
        c,
        "exercises",
        {
            "name": "Original with photo",
            "category": "Pilates",
            "visibility": "organization",
        },
    )
    image = io.BytesIO()
    Image.new("RGB", (20, 30), "blue").save(image, format="PNG")
    data = image.getvalue()
    source = upload(
        r,
        c,
        io.BytesIO(data),
        len(data),
        "coach.png",
        "image/png",
        "exercise",
        exercise_id=ex["id"],
    )
    coaches = r.people(a, "coach")
    other = next(p for p in coaches if p["id"] != c.user_id)
    actor = Actor(other["id"], a.org_id, "coach", True)
    duplicate = r.save(
        actor, "exercises", {"name": "My independent copy", "category": "Pilates"}
    )
    result = copy_exercise_media(r, actor, duplicate["id"], [source["id"]])
    clone = r.get(actor, "media", result["media_ids"][0])
    assert (
        clone["owner_id"] == actor.user_id and clone["exercise_id"] == duplicate["id"]
    )
    assert clone["id"] != source["id"]
    assert copy_exercise_media(r, actor, duplicate["id"], [source["id"]]) == result
    assert media_path(r, actor, clone["id"])[0].read_bytes() == data
    with pytest.raises(Refused):
        copy_exercise_media(r, actor, ex["id"], [source["id"]])
    with pytest.raises(Refused):
        r.get(s, "media", clone["id"])
    r.delete(actor, "media", clone["id"])
    assert media_path(r, c, source["id"])[0].read_bytes() == data
    assert r.get(s, "media", source["id"])["exercise_id"] == ex["id"]
    r.delete(actor, "exercises", duplicate["id"])
    r.delete(c, "exercises", ex["id"])


def test_multiperson_review_publishes_only_selected_person(state):
    from copy import deepcopy
    from pilates.platform.seed import simulation
    from pilates.platform.analysis import save_analysis

    r, c, a, s = state
    sid = r.people(c)[0]["id"]
    report = simulation(0, 0, "posture")
    view = report["views"][0]
    first = view["report"]["people"][0]
    second = deepcopy(first)
    second["person_id"] = 2
    first["metrics"] = [
        {
            "id": "shoulder_tilt",
            "name": "Shoulder tilt",
            "value": 2,
            "unit": "deg",
            "status": "available",
            "confidence": 0.9,
        }
    ]
    second["metrics"] = [
        {
            "id": "shoulder_tilt",
            "name": "Shoulder tilt",
            "value": 9,
            "unit": "deg",
            "status": "available",
            "confidence": 0.9,
        }
    ]
    view["report"]["people"] = [first, second]
    aid = save_analysis(r, c, sid, report, protocol="Review regression", synthetic=True)

    def values():
        with r.db() as db:
            return [
                row[0]
                for row in db.execute(
                    "SELECT value FROM p_progress_records WHERE analysis_id=?", (aid,)
                )
            ]

    assert values() == []
    r.review(c, {"analysis_id": aid, "selection": {view["view"]: first["person_id"]}})
    assert values() == [2]
    r.review(c, {"analysis_id": aid, "selection": {view["view"]: 2}})
    assert values() == [9]
    with r.db() as db:
        assert (
            db.execute(
                "SELECT count(*) FROM p_observations WHERE analysis_id=?", (aid,)
            ).fetchone()[0]
            == 1
        )
    with pytest.raises(Refused):
        r.review(c, {"analysis_id": aid, "selection": {view["view"]: 999}})


def test_library_pagination_search_and_unique_scenarios(state):
    from pilates.platform.seed import simulation

    r, c, a, s = state
    page1 = r.list(c, "exercises", limit=24, offset=0)
    page2 = r.list(c, "exercises", limit=24, offset=24)
    assert len(page1["items"]) == 24 and len(page2["items"]) == 24
    assert not {x["id"] for x in page1["items"]} & {x["id"] for x in page2["items"]}
    last = r.list(c, "exercises", limit=1, offset=198)["items"][0]
    assert last["id"] in {
        x["id"] for x in r.list(c, "exercises", q=last["name"])["items"]
    }
    traces = []
    for scenario in (0, 7, 2, 1, 4, 11):
        report = simulation(scenario, 0, "movement")
        p = report["views"][0]["report"]["people"][0]
        assert all(f["suitable"] for f in p["frames"]), scenario
        assert len(p["frames"]) == 61
        traces.append(json.dumps(p["frames"][15]["landmarks"]["keypoints"]))
    assert len(set(traces)) == 6


def test_backup_round_trip_and_role_boundaries(state):
    from pilates.platform.backup import export_archive, restore_archive
    from pilates.platform.inspection import overview
    from zipfile import ZipFile

    r, c, a, s = state
    with pytest.raises(Refused):
        with export_archive(r, c):
            pass
    fresh = r.actor(
        r.create_org(
            "Recovery owner",
            "recovery@example.test",
            "restore-strong-password",
            "Recovered studio",
        )
    )
    before = overview(r, a)
    with export_archive(r, a) as archive:
        with ZipFile(archive) as z:
            assert "records/p_sessions.jsonl" not in z.namelist()
            assert b"password_hash" not in z.read("records/p_users.jsonl")
        with pytest.raises(Refused):
            restore_archive(r, c, archive)
        with pytest.raises(Refused, match="empty studio"):
            restore_archive(r, a, archive)
        result = restore_archive(r, fresh, archive)
        assert result["restored_records"] > 10000
    after = overview(r, fresh)
    for table in [
        "p_students",
        "p_coaches",
        "p_locations",
        "p_programs",
        "p_exercises",
        "p_media",
        "p_scans",
        "p_analyses",
        "p_coordinates",
        "p_progress_records",
        "p_observations",
        "p_notes",
    ]:
        assert after[table]["count"] == before[table]["count"], table
    sarah = next(x for x in r.people(fresh) if x["name"] == "Sarah Kim")
    original = next(x for x in r.people(a) if x["name"] == "Sarah Kim")
    assert sarah["id"] != original["id"]
    client = r.client(fresh, sarah["id"])
    analysis = r.get(fresh, "analyses", client["analyses"][0]["id"])
    assert analysis["student_id"] == analysis["result"]["student_id"] == sarah["id"]
    assert analysis["id"] == analysis["result"]["id"]
    with r.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert not db.execute(
            "SELECT 1 FROM p_users WHERE org_id=? AND id<>? AND password_hash<>''",
            (fresh.org_id, fresh.user_id),
        ).fetchone()
        for row in db.execute(
            "SELECT path FROM p_media WHERE org_id=?", (fresh.org_id,)
        ):
            from pathlib import Path

            assert Path(row["path"]).is_file()


def test_equipment_availability_and_paged_analysis_filter(state):
    r, c, a, s = state
    equipment = next(e for e in r.list(c, "equipment")["items"] if e["name"] == "Mat")
    with pytest.raises(Refused, match="Update exercises"):
        r.delete(a, "equipment", equipment["id"])
    old = r.list(c, "reservations")["items"][0]
    body = {
        k: old[k]
        for k in (
            "student_id",
            "coach_id",
            "location_id",
            "room_id",
            "program_id",
            "status",
            "session_type",
        )
    }
    start = datetime.now(timezone.utc) + timedelta(days=90)
    body.update(
        starts_at=start.isoformat(),
        ends_at=(start + timedelta(hours=1)).isoformat(),
        status="reserved",
    )
    try:
        r.save(a, "equipment", {**equipment, "available": 0})
        with pytest.raises(Refused, match="Not enough mat"):
            r.save(c, "reservations", body)
    finally:
        r.save(a, "equipment", equipment)
    reservation = r.save(c, "reservations", body)
    r.delete(c, "reservations", reservation["id"])
    first = r.list(a, "analyses", kind="movement", limit=50)
    second = r.list(a, "analyses", kind="movement", limit=50, offset=50)
    assert first["total"] >= 102
    assert len(first["items"]) == len(second["items"]) == 50
    assert all(x["kind"] == "movement" for x in first["items"] + second["items"])
    assert not {x["id"] for x in first["items"]} & {x["id"] for x in second["items"]}


def test_http_auth_csrf_media_ranges_and_backup(state):
    import threading
    import urllib.request
    import urllib.error
    from pilates.serve import serve
    from pathlib import Path
    from zipfile import ZipFile

    r, c, a, s = state
    server, url = serve(None, port=0, db=str(r.path))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = url.rsplit("/", 1)[0]

    def request(path, token=None, payload=None, extra=None):
        headers = dict(extra or {})
        if token:
            headers["Cookie"] = "motion_session=" + token
        data = json.dumps(payload).encode() if payload is not None else None
        if data:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            return response.status, response.read(), response.headers

    try:
        admin_token = r.issue(a.user_id, "admin")
        student_token = r.issue(s.user_id, "student")
        assert request("/platform/me")[0] == 401
        assert request("/platform/inspect", student_token)[0] == 403
        assert (
            request(
                "/platform/save",
                admin_token,
                {"collection": "locations", "item": {"name": "Blocked"}},
            )[0]
            == 403
        )
        assert (
            request(
                "/platform/save",
                admin_token,
                {"collection": "locations", "item": {"name": "Blocked"}},
                {"X-Platform-Request": "1", "Origin": "https://other.example"},
            )[0]
            == 403
        )
        status, body, headers = request("/platform/me", student_token)
        assert status == 200 and json.loads(body)["role"] == "student"
        assert headers["Cache-Control"] == "no-store"
        mine = r.client(s, s.user_id)["scans"][0]["media_id"]
        original = r.get(s, "media", mine)
        status, data, headers = request(
            "/platform/media?id=" + mine, student_token, extra={"Range": "bytes=0-15"}
        )
        assert status == 206 and len(data) == 16
        assert headers["Content-Range"].startswith("bytes 0-15/")
        other = next(
            x for x in r.list(a, "scans")["items"] if x["student_id"] != s.user_id
        )["media_id"]
        assert request("/platform/media?id=" + other, student_token)[0] in (403, 404)
        status, data, headers = request("/platform/backup", admin_token)
        assert status == 200 and headers["Content-Type"] == "application/zip"
        with ZipFile(io.BytesIO(data)) as z:
            assert "manifest.json" in z.namelist()
    finally:
        server.shutdown()
        server.server_close()


def test_client_history_survives_api_page_boundary(state):
    r, c, a, s = state
    client = r.people(c)[0]["id"]
    created = []
    try:
        for i in range(205):
            note = r.save(
                c,
                "notes",
                {
                    "student_id": client,
                    "region_id": "right_shoulder",
                    "text": f"Pagination regression record {i}",
                },
            )
            created.append(note["id"])
        history = r.client(c, client)["notes"]
        assert set(created).issubset({n["id"] for n in history})
        assert len(history) >= 211
    finally:
        with r.db() as db:
            db.executemany("DELETE FROM p_notes WHERE id=?", [(i,) for i in created])
