"""The Phase 2 journey over HTTP, as an investor demonstration walks it, and the
course routes' own guarantees (CSRF, sign-in, rights first, room-only media)."""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import pytest

from pilates.sedens import course_media, course_review, http as sedens_http
from sedens_support import Client, make_sedens, running_server
from test_sedens_courses import RIGHTS, png_bytes

KEY = "7" * 32
CHECKLIST = {item: {"result": "pass"} for item in course_review.CHECKLIST}


@pytest.fixture
def web(tmp_path):
    sedens_http._LIMITS.clear()
    sedens = make_sedens(tmp_path / "s.db")
    server, base = running_server(sedens.repo.path)
    yield sedens, base
    server.shutdown()
    server.server_close()


def demo(base, role):
    client = Client(base)
    status, body = client.call("POST", "/sedens/demo/enter", {"key": KEY, "role": role})
    assert status == 200, body
    return client


def ok(result):
    status, body = result
    assert status == 200, body
    return body


def raw(client, method, path, data=b"", headers=None):
    req = urllib.request.Request(client.base + path, data=data if method == "POST" else None, method=method)
    req.add_header("X-Sedens-Request", "1")
    req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in client.jar.items()))
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        response = urllib.request.urlopen(req, timeout=60)
        return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()


def upload(client, body, kind, filename, rights):
    query = urllib.parse.urlencode({"kind": kind, "filename": filename, "title": filename,
                                    "rights": json.dumps(rights) if rights is not None else ""})
    status, _, data = raw(client, "POST", "/sedens/creator/media/upload?" + query, body,
                          {"Content-Type": "application/octet-stream"})
    return status, json.loads(data)


def build(client, title, price=None, distribution="selected_facilities", facilities=None):
    view = ok(client.call("POST", "/sedens/creator/courses/create", {"title": title, "course_type": "guided_training",
                                                                     "language": "en", "category": "mobility"}))
    cid = view["course"]["id"]
    view = ok(client.call("POST", "/sedens/creator/course/module", {"course_id": cid, "revision": view["revision"],
                                                                    "title": "Week 1"}))
    view = ok(client.call("POST", "/sedens/creator/course/session", {
        "course_id": cid, "revision": view["revision"], "module_id": view["modules"][0]["id"], "title": "Day 1"}))
    session_id = view["modules"][0]["sessions"][0]["id"]
    view = ok(client.call("POST", "/sedens/creator/course/step", {
        "course_id": cid, "revision": view["revision"], "session_id": session_id, "exercise_source": "standard",
        "exercise_ref": "std-breathing", "reps": 6, "customer_cue": "Slow, even breaths."}))
    return view


def test_investor_journey(web):
    sedens, base = web
    org = "demo-" + KEY

    # 1. Coach Minji Lee builds a guided course in the Creator Studio.
    creator = demo(base, "creator")
    studio = ok(creator.call("GET", "/sedens/creator/studio"))
    assert studio["profile"]["display_name"] == "Minji Lee"
    assert [t["org_id"] for t in studio["targets"]] == [org]
    view = build(creator, "Morning Mobility")
    cid = view["course"]["id"]
    step = view["modules"][0]["sessions"][0]["steps"][0]
    # Demo media, with rights: one of the repository's labelled illustrations, and an upload.
    asset = ok(creator.call("POST", "/sedens/creator/media/repo-asset", {"asset_id": "repo-bird-dog"}))
    assert asset["label"]["en"].startswith("AI-generated illustration")
    status, picture = upload(creator, png_bytes(), "image", "cue.png", RIGHTS)
    assert status == 200 and picture["rights"]["licence_type"] == "own_work"
    view = ok(creator.call("POST", "/sedens/creator/course/step", {
        **{k: step[k] for k in ("id", "phase", "sets", "reps", "customer_cue")}, "course_id": cid,
        "revision": view["revision"], "session_id": view["modules"][0]["sessions"][0]["id"],
        "exercise_source": "standard", "exercise_ref": "std-breathing", "image_media_id": picture["id"]}))
    # Anatomy: the exercise's own structures, and one timeline moment.
    key = step["anatomy"][0]["key"]
    view = ok(creator.call("POST", "/sedens/creator/course/anatomy", {
        "course_id": cid, "revision": view["revision"], "step_id": step["id"],
        "structures": [{"key": key, "role": "focus"}],
        "timeline": [{"start_ms": 0, "end_ms": 5000, "mode": "highlight", "structures": [key]}]}))
    # Free for the demonstration facility, then submitted for review.
    view = ok(creator.call("POST", "/sedens/creator/course/access", {
        "id": cid, "revision": view["revision"], "distribution": "selected_facilities",
        "facilities": [{"org_id": org, "free": True}], "price": {"price_type": "free"}}))
    view = ok(creator.call("POST", "/sedens/creator/course/submit", {"id": cid, "revision": view["revision"]}))
    assert view["review_state"] == "submitted"

    # 2. A SEDENS reviewer approves exactly the submitted version.
    reviewer = demo(base, "reviewer")
    queue = ok(reviewer.call("GET", "/sedens/review/courses"))
    assert [q["title"] for q in queue["items"]] == ["Morning Mobility"]
    detail = ok(reviewer.call("GET", f"/sedens/review/course?id={cid}&version=1"))
    assert detail["media_rights"] and detail["creator"]["display_name"] == "Minji Lee"
    ok(reviewer.call("POST", "/sedens/review/course/decide", {
        "course_id": cid, "version": 1, "decision": "approved", "snapshot_sha256": detail["snapshot_sha256"],
        "checklist": CHECKLIST}))

    # 3. The facility enables and includes it.
    admin = demo(base, "admin")
    console = ok(admin.call("GET", "/sedens/facility/courses"))
    assert "Morning Mobility" in [c["title"] for c in console["items"]]
    ok(admin.call("POST", "/sedens/facility/courses/setting", {"course_id": cid, "enabled": True, "included": True}))

    # 4. A customer sees it included and free.
    phone = demo(base, "student")
    catalog = {c["title"]: c for c in ok(phone.call("GET", "/sedens/courses/catalog"))["items"]}
    assert catalog["Morning Mobility"]["included_here"] and catalog["Morning Mobility"]["free_here"]
    assert catalog["Morning Mobility"]["badge"] == "facility_program"
    assert catalog["SEDENS Standard: Foundations"]["badge"] == "sedens_standard"

    # 5. The fictional professor's ₩29,000 course, through review, enabled (not included).
    professor = demo(base, "professor")
    paid = build(professor, "Hip Mobility Lab")
    paid_id = paid["course"]["id"]
    paid = ok(professor.call("POST", "/sedens/creator/course/access", {
        "id": paid_id, "revision": paid["revision"], "distribution": "marketplace", "facilities": [],
        "price": {"price_type": "paid", "amount_minor": 29000, "currency": "KRW"}}))
    ok(professor.call("POST", "/sedens/creator/course/submit", {"id": paid_id, "revision": paid["revision"]}))
    detail = ok(reviewer.call("GET", f"/sedens/review/course?id={paid_id}&version=1"))
    ok(reviewer.call("POST", "/sedens/review/course/decide", {
        "course_id": paid_id, "version": 1, "decision": "approved", "snapshot_sha256": detail["snapshot_sha256"],
        "checklist": CHECKLIST}))
    ok(admin.call("POST", "/sedens/facility/courses/setting", {"course_id": paid_id, "enabled": True}))
    status, body = admin.call("POST", "/sedens/facility/courses/setting", {"course_id": paid_id, "enabled": True,
                                                                          "included": True})
    assert status == 400 and body["code"] == "paid_not_includable"

    # 6. The customer buys it in a DEMO purchase: an entitlement, no money.
    info = ok(phone.call("GET", f"/sedens/courses/detail?id={paid_id}"))
    assert info["enroll"]["reason"] == "purchase_required"
    bought = ok(phone.call("POST", "/sedens/courses/demo-purchase", {"course_id": paid_id}))
    assert bought["purchase"]["notice"]["en"] == "DEMO — no real payment occurred."
    assert bought["purchase"]["real_money"] is False and bought["purchase"]["demo"] is True
    assert bought["course"]["card"]["purchased"] and bought["course"]["progress"]["completed_items"] == 0
    with sedens.db() as db:
        purchase = dict(db.execute("SELECT * FROM s_purchases").fetchone())
    assert set(purchase) == {"id", "user_id", "org_id", "course_id", "provider", "amount_minor", "currency", "state",
                             "created_at"}  # no card data anywhere
    # 7. Outside the room: the course and its progress, never the workout.
    assert bought["course"]["play_here"] == {"ok": False, "reason": "room_only"}
    mine = ok(phone.call("GET", "/sedens/courses/mine"))["items"]
    assert "Hip Mobility Lab" in [m["card"]["title"] for m in mine]
    session_id = bought["course"]["outline"][0]["sessions"][0]["id"]
    status, body = phone.call("POST", "/sedens/room/course/session", {"course_id": paid_id, "session_id": session_id})
    assert status == 403 and body["code"] == "device_not_paired"  # a phone is not a paired room screen
    status, _, _ = raw(phone, "GET", f"/sedens/media/file?id={picture['id']}")
    assert status == 404  # guided training media plays in the room only

    # 8. In the room it plays.
    screen = Client(base)
    ok(screen.call("POST", "/sedens/demo/room-device", {"key": KEY}))
    code = ok(phone.call("POST", "/sedens/access-code"))["code"]
    ok(screen.call("POST", "/sedens/room/enter", {"method": "access_code", "credential": code}))
    rooms_courses = {c["title"]: c for c in ok(screen.call("GET", "/sedens/room/courses"))["items"]}
    assert rooms_courses["Hip Mobility Lab"]["playable"] and rooms_courses["Morning Mobility"]["playable"]
    assert rooms_courses["Mobility Foundations"]["reason"] == "purchase_required"
    plan = ok(screen.call("POST", "/sedens/room/course/session", {"course_id": cid,
                                                                  "session_id": rooms_courses["Morning Mobility"]["outline"][0]["sessions"][0]["id"]}))
    assert plan["session"]["steps"][0]["image_media_id"] == picture["id"]
    status, headers, data = raw(screen, "GET", f"/sedens/media/file?id={picture['id']}", headers={"Range": "bytes=0-9"})
    assert status == 206 and len(data) == 10 and headers["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in headers["Content-Security-Policy"] and headers["Content-Type"] == "image/png"


def test_course_routes_need_sign_in_and_the_csrf_header(web):
    _, base = web
    assert Client(base).call("GET", "/sedens/creator/studio")[0] == 401
    creator = demo(base, "creator")
    req = urllib.request.Request(base + "/sedens/creator/courses/create", data=b'{"title":"x"}', method="POST")
    req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in creator.jar.items()))
    with pytest.raises(urllib.error.HTTPError) as refused:
        urllib.request.urlopen(req)
    assert refused.value.code == 403
    status, _, _ = raw(Client(base), "GET", "/sedens/media/file?id=nothing")
    assert status == 404
    # A customer has no creator tools, and a creator no reviewer tools.
    assert demo(base, "student").call("GET", "/sedens/creator/studio")[0] == 403
    assert creator.call("GET", "/sedens/review/courses")[0] == 403


def test_uploads_check_rights_before_the_file_and_the_bytes_after(web):
    _, base = web
    creator = demo(base, "creator")
    status, body = upload(creator, png_bytes(), "image", "a.png", None)
    assert status == 400 and body["code"] == "rights_required"
    status, body = upload(creator, png_bytes(), "image", "a.png", {**RIGHTS, "attest": False})
    assert status == 400 and body["code"] == "attestation_required"
    status, body = upload(creator, b"<html><script>alert(1)</script></html>", "image", "a.png", RIGHTS)
    assert status == 415 and body["code"] == "media_type_mismatch"
    status, body = upload(creator, b"%PDF-1.4 /JavaScript (app.alert(1))", "pdf", "a.pdf", RIGHTS)
    assert status == 415 and body["code"] == "pdf_active_content"
    status, body = upload(creator, png_bytes(), "image", "a.png", RIGHTS)
    assert status == 200 and body["mime"] == "image/png"
    # The creator reads their own file; another demonstration visitor never does.
    status, headers, _ = raw(creator, "GET", f"/sedens/media/file?id={body['id']}")
    assert status == 200 and headers["Cache-Control"] == "private, no-store"
    stranger = Client(base)
    ok(stranger.call("POST", "/sedens/demo/enter", {"key": "8" * 32, "role": "creator"}))
    assert raw(stranger, "GET", f"/sedens/media/file?id={body['id']}")[0] == 404


def test_course_export_and_import(web):
    _, base = web
    creator = demo(base, "creator")
    view = build(creator, "Export me")
    status, picture = upload(creator, png_bytes(), "image", "cover.png", RIGHTS)
    view = ok(creator.call("POST", "/sedens/creator/course/update", {"id": view["course"]["id"],
                                                                     "revision": view["revision"],
                                                                     "cover_media_id": picture["id"]}))
    status, headers, data = raw(creator, "GET", f"/sedens/creator/course/export?id={view['course']['id']}")
    assert status == 200 and headers["Content-Type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set(z.namelist())
        manifest = json.loads(z.read("manifest.json"))
        text = b"".join(z.read(n) for n in names if n.endswith(".json")).decode()
    assert {"manifest.json", "course.json", "media.json"} <= names and set(manifest["files"]) == names - {"manifest.json"}
    for secret in ("password", "token_hash", "motion_session", "Customer"):
        assert secret not in text
    # Importing needs the importer's own attestation for the files.
    query = "/sedens/creator/course/import"
    status, _, body = raw(creator, "POST", query, data)
    assert status == 400 and json.loads(body)["code"] == "attestation_required"
    status, _, body = raw(creator, "POST", query + "?attest=1&attestation_version=" + course_media.ATTESTATION_VERSION,
                          data)
    imported = json.loads(body)
    assert status == 200 and imported["course"]["title"] == "Export me"
    assert imported["review_state"] == "draft" and imported["course"]["distribution"] == "creator_only"
    assert imported["course"]["cover_media_id"] not in (None, picture["id"])
    assert [s["exercise"]["ref"] for s in imported["modules"][0]["sessions"][0]["steps"]] == ["std-breathing"]
    # A changed export is refused.
    tampered = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as z, zipfile.ZipFile(tampered, "w") as out:
        for info in z.infolist():
            content = z.read(info)
            if info.filename == "course.json":
                content = content.replace(b"Export me", b"Exported!")
            out.writestr(info, content)
    status, _, body = raw(creator, "POST", query + "?attest=1&attestation_version=" + course_media.ATTESTATION_VERSION,
                          tampered.getvalue())
    assert status == 400 and json.loads(body)["code"] == "checksum_mismatch"
