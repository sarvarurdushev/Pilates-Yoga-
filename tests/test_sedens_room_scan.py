"""Phase 3B: the four-view room scan and the customer feedback layer.

* the free host's precomputed demonstration (no photo leaves the browser), clearly
  labelled and never mixed with a real analysis;
* the real path (experimental analysis on the free host, room capture locally):
  photo uploads, the existing pipeline (the pose model is faked), the workspace
  analysis it saves, and what happens to the photos;
* ``pilates/sedens/feedback.py``: measurement → quality gate → evidence rule →
  customer wording, comparison and Advanced;
* banned customer copy across every customer-facing SEDENS string (brief §14, §40).

All people, facilities and measurements are fictional.
"""

from __future__ import annotations

import base64
import copy
import http.client
import io
import json
from pathlib import Path
import re
import stat
from urllib.parse import urlparse

import pytest

from pilates import assessment
from pilates.sedens import consent, demo, feedback, media_store, readiness, rooms, scans
from pilates.sedens import http as sedens_http
from pilates.sedens.util import encode, uid
from pilates.serve import WEB
from sedens_support import make_sedens, pair, running_server
from test_alignment import standing
from test_sedens_room_journey import ORG, Room, Screen, demo_database, events, facility_database, visit

DATA = Path(__file__).resolve().parents[1] / "data"
RULES = feedback.rules()
SHOULDER = next(rule for rule in RULES["observations"] if rule["id"] == "shoulder_line")
THRESHOLD = SHOULDER["threshold_deg"]
DEMO = json.loads((DATA / "sedens_demo_scan.v1.json").read_text(encoding="utf-8"))
VIEWS = ("front", "left", "back", "right")
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00fictional-png" * 8
JPEG = b"\xff\xd8\xff\xe0" + b"\x00fictional-jpeg" * 8
PHOTOS = {"front": PNG, "left": JPEG, "back": PNG + b"b", "right": JPEG + b"r"}
STORED = {"front": "front.png", "left": "left.jpg", "back": "back.png", "right": "right.jpg"}
SUMMARY_KEYS = {"rules_version", "quality", "quality_text", "views", "observations", "notes", "meaning", "focus",
                "comparison", "advanced", "label", "label_note", "source"}


# -- fixtures ---------------------------------------------------------------------------------


@pytest.fixture
def world(tmp_path):
    """A real facility on a local room computer, with a paired screen in its first room."""
    sedens_http._LIMITS.clear()
    path, fac = facility_database(tmp_path / "facility.db")
    sedens = make_sedens(path, "local_room")
    return sedens, fac, pair(sedens, fac)


@pytest.fixture
def demo_world(tmp_path):
    """The free demonstration host, driven in-process."""
    sedens_http._LIMITS.clear()
    sedens = make_sedens(demo_database(tmp_path / "demo.db"), "demo_free")
    device, _ = rooms.ensure_demo_device(sedens, ORG, demo.room_id(ORG), None)
    return sedens, device


@pytest.fixture
def demo_server(tmp_path, monkeypatch):
    """The free demonstration host over real HTTP."""
    sedens_http._LIMITS.clear()
    monkeypatch.setenv("SEDENS_MODE", "demo_free")
    path = demo_database(tmp_path / "server.db")
    server, base = running_server(path)
    yield base, make_sedens(path, "demo_free")
    server.shutdown()
    server.server_close()


# -- a faked pose model -----------------------------------------------------------------------


FRONT_PERSON = assessment.assess_person(standing(), 800, 900, view="front")
REAR_PERSON = assessment.assess_person(standing(facing="rear"), 800, 900, view="rear")


def person(view, shoulder=0.0, *, confidence=0.95):
    """One suitable person as ``assessment.photo`` reports them, with a chosen shoulder
    line. A side photo carries only side metrics, plus a large shoulder value that a
    side view must never turn into a customer observation."""
    if view in ("front", "rear"):
        p = copy.deepcopy(FRONT_PERSON if view == "front" else REAR_PERSON)
        for m in p["metrics"]:
            if m["id"] == "shoulder_tilt":
                m.update(value=shoulder, confidence=confidence, status="measured")
        return p
    p = copy.deepcopy(FRONT_PERSON)
    p["view"] = view
    keep = {"forward_head": 0.06, "shoulder_tilt": 12.0}
    p["metrics"] = [dict(m, value=keep[m["id"]], confidence=0.9, status="estimated")
                    for m in p["metrics"] if m["id"] in keep]
    return p


def report(*people):
    return {"version": assessment.VERSION, "kind": "photo", "width": 800, "height": 900, "people": list(people),
            "model": "RTMO-fixture", "tiled": False, "warnings": []}


def clear_reports(front=3.5, back=3.2):
    return {"front": report(person("front", front)), "rear": report(person("rear", back)),
            "side_left": report(person("side_left")), "side_right": report(person("side_right"))}


class Pipeline:
    """``assessment.photo`` answers from ``reports`` (by pipeline view); the scan's
    background job runs inline (``inline``) or when the test calls :meth:`run`."""

    def __init__(self, monkeypatch, reports=None, inline=True):
        self.reports, self.inline, self.calls, self.jobs = reports or clear_reports(), inline, [], []
        monkeypatch.setattr(assessment, "photo", self.photo)
        monkeypatch.setattr(scans, "_start_job", self.start)

    def photo(self, payload, backend=None):
        self.calls.append((payload["view"], base64.b64decode(payload["image"])))
        out = self.reports[payload["view"]]
        if isinstance(out, Exception):
            raise out
        return copy.deepcopy(out)

    def start(self, sedens, scan_id):
        if self.inline:
            scans._run_job(sedens, scan_id)
        else:
            self.jobs.append((sedens, scan_id))

    def run(self):
        for sedens, scan_id in self.jobs:
            scans._run_job(sedens, scan_id)
        self.jobs.clear()


# -- helpers ------------------------------------------------------------------------------------


def upload(room, view, body=None):
    """The room screen sends one photo (in-process)."""
    body = PHOTOS[view] if body is None else body
    return scans.upload_image(room.sedens, room.ctx, view, io.BytesIO(body), len(body))


def capture_all(room, photos=True):
    for view in VIEWS:
        if photos:
            upload(room, view)
        room.act("scan/view", view=view)
    return room.get()


def http_upload(screen, view, body, *, length=None):
    """POST room/scan/image with a raw body (or only a claimed Content-Length)."""
    parsed = urlparse(screen.client.base)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
    path = f"/sedens/room/scan/image?view={view}"
    headers = {"X-Sedens-Request": "1", "Content-Type": "image/png",
               "Cookie": "; ".join(f"{k}={v}" for k, v in screen.client.jar.items())}
    try:
        if length is None:
            conn.request("POST", path, body=body, headers=headers)
        else:
            conn.putrequest("POST", path)
            for key, value in {**headers, "Content-Length": str(length)}.items():
                conn.putheader(key, value)
            conn.endheaders()
        response = conn.getresponse()
        return response.status, json.loads(response.read() or b"{}")
    finally:
        conn.close()


def scan_row(db, room_session_id):
    return dict(db.execute("SELECT * FROM s_room_scans WHERE room_session_id=? ORDER BY started_at DESC, rowid DESC "
                           "LIMIT 1", (room_session_id,)).fetchone())


def photo_folder(sedens, scan):
    return media_store.root(sedens.repo) / "scans" / scan["org_id"] / scan["id"]


def keys_anywhere(node) -> set:
    found = set()
    if isinstance(node, dict):
        for key, value in node.items():
            found.add(key)
            found |= keys_anywhere(value)
    elif isinstance(node, list):
        for value in node:
            found |= keys_anywhere(value)
    return found


def strings_anywhere(node) -> list:
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        return [s for value in node.values() for s in strings_anywhere(value)]
    if isinstance(node, list):
        return [s for value in node for s in strings_anywhere(value)]
    return []


# == the demonstration scan (demo_free) =======================================================


def test_demo_scan_over_http_is_precomputed_labelled_and_needs_no_photo(demo_server):
    base, sedens = demo_server
    screen = Screen(base).ready()
    assert screen.j["scan_options"] == ["demo_precomputed", "experimental_real"]
    screen.consent("scan_capture")
    screen.act("scan/begin", source="demo_precomputed")
    assert screen.j["state"] == "scan_front"
    assert screen.j["scan"] == {"source": "demo_precomputed", "needs_images": False, "label": DEMO["label"]["en"],
                                "state": "capturing",
                                "views": {v: {"captured": False, "photo": False} for v in VIEWS}}
    # A photo is never accepted for the demonstration: nothing leaves the browser.
    status, body = http_upload(screen, "front", PNG)
    assert (status, body["code"]) == (409, "invalid_transition")
    # Four views, no upload at all, and the result at once.
    for view, following in zip(VIEWS, ("scan_left", "scan_back", "scan_right", "scan_result")):
        screen.act("scan/view", view=view)
        assert screen.j["state"] == following
    assert screen.j["scan"]["state"] == "complete" and screen.j["scan"]["failed"] is False
    summary = screen.j["scan"]["summary"]
    assert set(summary) == SUMMARY_KEYS
    assert (summary["label"], summary["label_note"], summary["source"]) == (
        "DEMO PRECOMPUTED ANALYSIS", DEMO["note"]["en"], "demo_precomputed")
    assert (summary["quality"], summary["quality_text"]) == ("clear", RULES["quality"]["copy"]["clear"]["en"])
    assert summary["views"] == {v: {"quality": "clear", "reason": None} for v in VIEWS}
    # -3.1 and -2.9 degrees: negative is the person's right shoulder higher, in both views.
    assert summary["observations"] == [{
        "id": "shoulder_line", "heading": SHOULDER["heading"]["en"],
        "text": SHOULDER["observed"]["en"].replace("{side}", "right"),
        "limitation": SHOULDER["limitation"]["en"], "provisional": True}]
    assert "right shoulder" in summary["observations"][0]["text"]
    assert summary["notes"] == [] and summary["meaning"] == RULES["meaning"]["en"]
    assert summary["focus"] == {"heading": RULES["focus"]["heading"]["en"],
                                "text": RULES["focus"]["shoulder_mobility"]["text"]["en"],
                                "why_heading": RULES["focus"]["why_heading"]["en"],
                                "why": RULES["focus"]["shoulder_mobility"]["why"]["en"]}
    assert summary["comparison"] == {"available": False, "text": RULES["comparison"]["none"]["en"]}
    assert {(a["view"], a["metric"]) for a in summary["advanced"]} == {
        (v, m) for v in VIEWS for m in DEMO["views"][v]["metrics"]}
    # No score, grade, percentage or model confidence anywhere a customer can see.
    shown_keys = keys_anywhere(summary)
    assert not shown_keys & {"score", "scores", "grade", "percent", "confidence", "evaluated", "focus_hint",
                             "threshold", "measurements"}
    assert not any("%" in s for s in strings_anywhere(summary))

    english = screen.j
    korean = screen.get("ko")["scan"]["summary"]
    assert (korean["label"], korean["label_note"]) == ("데모 사전 계산 분석", DEMO["note"]["ko"])
    assert korean["observations"][0]["text"] == SHOULDER["observed"]["ko"].replace("{side}", "오른쪽")
    assert korean["comparison"]["text"] == RULES["comparison"]["none"]["ko"]
    assert screen.get("en") == english  # a refresh shows the same result

    room_session_id = screen.entered["session"]["room_session_id"]
    with sedens.db() as db:
        scan = scan_row(db, room_session_id)
        assert (scan["source"], scan["state"], scan["reliability"], scan["focus"]) == (
            "demo_precomputed", "complete", "clear", "shoulder_mobility")
        assert (scan["protocol"], scan["feedback_rules_version"], scan["measurement_version"], scan["model"]) == (
            scans.PROTOCOL, feedback.CURRENT, "demo", "demo")
        assert scan["analysis_id"] is None and scan["images_retained"] == 0 and scan["error"] == ""
        stored = json.loads(scan["summary"])
        assert stored["measurements"] == DEMO["views"]
        assert stored["shown"]["en"] == summary and stored["shown"]["ko"] == korean
        rows = [dict(r) for r in db.execute("SELECT * FROM s_room_scan_observations WHERE scan_id=?", (scan["id"],))]
        assert len(rows) == len(RULES["observations"])
        assert rows == [{"scan_id": scan["id"], "rule_id": "shoulder_line", "metric": "shoulder_tilt", "value": -3.0,
                         "unit": "deg", "outcome": "shown", "reason": "above_threshold_in_both_views",
                         "threshold": THRESHOLD}]
        views = db.execute("SELECT view, captured_at, image_key, quality FROM s_room_scan_views WHERE scan_id=?",
                           (scan["id"],)).fetchall()
        assert {r["view"]: (bool(r["captured_at"]), r["image_key"], r["quality"]) for r in views} == {
            v: (True, None, "clear") for v in VIEWS}
        assert not db.execute("SELECT 1 FROM p_analyses WHERE protocol=?", (scans.PROTOCOL,)).fetchone()
        assert events(db, room_session_id, "scan_started") == [{"source": "demo_precomputed"}]
        assert events(db, room_session_id, "scan_view_completed") == [
            {"view": v, "source": "demo_precomputed"} for v in VIEWS]
        assert events(db, room_session_id, "scan_completed") == [
            {"source": "demo_precomputed", "quality": "clear", "observations": 1, "failed": False}]
        flags = db.execute("SELECT demo, user_id FROM s_events WHERE room_session_id=? AND name LIKE 'scan_%'",
                           (room_session_id,)).fetchall()
        assert len(flags) == 6 and all(f["demo"] == 1 for f in flags)
        assert all(f["user_id"] is None for f in flags)  # no product-analytics consent was given
    assert not (media_store.root(sedens.repo) / "scans").exists() or \
        not any((media_store.root(sedens.repo) / "scans").rglob("*.*"))
    screen.act("scan/continue")
    assert screen.j["state"] == "session_choice" and screen.j["scan_skipped"] is False


def test_a_second_demo_scan_compares_only_with_the_first(demo_world):
    sedens, device = demo_world
    room = Room(sedens, device).ready()
    room.consent("scan_capture")
    room.act("scan/begin", source="demo_precomputed")
    capture_all(room, photos=False)
    room.act("scan/again")
    assert room.j["state"] == "scan_intro"
    room.act("scan/begin", source="demo_precomputed")
    second = capture_all(room, photos=False)["scan"]["summary"]
    # The same fictional values: compared, and no difference beyond the usual variation.
    assert second["comparison"] == {"available": True, "text": RULES["comparison"]["no_difference"]["en"]}
    with sedens.db() as db:
        assert [r[0] for r in db.execute("SELECT state FROM s_room_scans WHERE room_session_id=? ORDER BY started_at",
                                         (room.ctx.room_session_id,))] == ["complete", "complete"]


def test_retaking_a_demo_view_goes_back_and_counts_the_retake(demo_world):
    sedens, device = demo_world
    room = Room(sedens, device).ready()
    room.consent("scan_capture")
    room.act("scan/begin")
    room.act("scan/view", view="front")
    room.act("scan/view", view="left")
    assert room.j["state"] == "scan_back"
    room.refused("scan/view", "invalid_transition", view="right")  # not the view on screen
    room.refused("scan/retake", "invalid_transition", view="sideways")
    room.act("scan/retake", view="left")
    assert room.j["state"] == "scan_left" and room.j["scan"]["views"]["left"]["captured"] is False
    room.act("scan/retake", view="left")  # retaking the view on screen stays there
    assert room.j["state"] == "scan_left"
    with sedens.db() as db:
        scan = scan_row(db, room.ctx.room_session_id)
        assert db.execute("SELECT retakes FROM s_room_scan_views WHERE scan_id=? AND view='left'",
                          (scan["id"],)).fetchone()[0] == 2
        assert events(db, room.ctx.room_session_id, "scan_retake") == [{"view": "left"}, {"view": "left"}]


# == the real path: experimental analysis (demo_free) and room capture (local_room) ============


def test_experimental_scan_over_http(demo_server, monkeypatch):
    base, sedens = demo_server
    pipeline = Pipeline(monkeypatch, inline=False, reports={
        "front": report(person("front", 3.5)), "rear": report(person("rear", 3.2)),
        # The real model refuses a front-facing body photographed as a side view.
        "side_left": report(assessment.assess_person(standing(), 800, 900, view="side_left")),
        "side_right": report(assessment.assess_person(standing(), 800, 900, view="side_right"))})
    screen = Screen(base).ready()
    screen.consent("scan_capture")
    screen.act("scan/begin", source="experimental_real")
    assert screen.j["scan"]["needs_images"] is True
    assert screen.j["scan"]["label"] == "EXPERIMENTAL REAL ANALYSIS"
    revision = screen.j["revision"]

    status, body = screen.post("scan/view", view="front")
    assert (status, body["code"]) == (409, "image_required")
    status, body = http_upload(screen, "front", b"GIF89a" + b"\x00" * 40)
    assert (status, body["code"]) == (415, "media_type_mismatch")
    status, body = http_upload(screen, "front", b"", length=scans.MAX_IMAGE + 1)
    assert (status, body["code"]) == (413, "media_too_large")
    status, body = http_upload(screen, "left", PNG)
    assert (status, body["code"]) == (409, "invalid_transition")
    status, body = http_upload(screen, "top", PNG)
    assert (status, body["code"]) == (400, "invalid")
    assert screen.get()["revision"] == revision and screen.j["scan"]["views"]["front"]["photo"] is False

    room_session_id = screen.entered["session"]["room_session_id"]
    for view, following in zip(VIEWS, ("scan_left", "scan_back", "scan_right", "scan_processing")):
        assert http_upload(screen, view, PHOTOS[view]) == (200, {"view": view, "received": True})
        assert screen.get()["scan"]["views"][view] == {"captured": False, "photo": True}
        screen.act("scan/view", view=view)
        assert screen.j["state"] == following
    with sedens.db() as db:
        scan = scan_row(db, room_session_id)
    folder = photo_folder(sedens, scan)
    assert sorted(p.name for p in folder.iterdir()) == sorted(STORED.values())
    # A refresh while the analysis runs shows the same "analysing" step.
    assert screen.get()["state"] == "scan_processing" and screen.j["scan"]["state"] == "processing"
    assert len(pipeline.jobs) == 1

    pipeline.run()
    result = screen.get()
    assert result["state"] == "scan_result" and result["scan"]["failed"] is False
    summary = result["scan"]["summary"]
    assert (summary["label"], summary["label_note"], summary["source"]) == (
        "EXPERIMENTAL REAL ANALYSIS", None, "experimental_real")
    assert screen.get("ko")["scan"]["summary"]["label"] == "실험적 실제 분석"
    # Front and back are clear; both side photos were refused, in customer words.
    assert summary["quality"] == "limited"
    assert summary["views"]["front"] == summary["views"]["back"] == {"quality": "clear", "reason": None}
    for side in ("left", "right"):
        assert summary["views"][side] == {"quality": "retake",
                                          "reason": RULES["quality"]["view_reasons"]["wrong_direction"]["en"]}
    assert [o["text"] for o in summary["observations"]] == [SHOULDER["observed"]["en"].replace("{side}", "left")]
    assert summary["comparison"]["available"] is False
    # The engineering report's alignment index never reaches the customer.
    assert "score" not in keys_anywhere(summary) and "alignment index" not in json.dumps(summary).lower()
    # The pipeline saw exactly the uploaded photos, as its own views.
    assert pipeline.calls == [(scans.PIPELINE_VIEW[v], PHOTOS[v]) for v in VIEWS]

    with sedens.db() as db:
        scan = scan_row(db, room_session_id)
        assert (scan["state"], scan["reliability"], scan["measurement_version"], scan["model"]) == (
            "complete", "limited", assessment.VERSION, "RTMO-fixture")
        analysis = db.execute("SELECT * FROM p_analyses WHERE id=?", (scan["analysis_id"],)).fetchone()
        member = db.execute("SELECT student_id FROM s_room_sessions WHERE id=?", (room_session_id,)).fetchone()[0]
        assert (analysis["protocol"], analysis["student_id"], analysis["kind"]) == (scans.PROTOCOL, member, "posture")
        assert json.loads(analysis["detail"])["room_scan_id"] == scan["id"]
        assert {r[0] for r in db.execute("SELECT view FROM p_image_analyses WHERE analysis_id=?", (analysis["id"],))} \
            == set(scans.PIPELINE_VIEW.values())
        visit_id = db.execute("SELECT session_id FROM p_session_analyses WHERE analysis_id=?",
                              (analysis["id"],)).fetchone()[0]
        journey_row = db.execute("SELECT training_session_id FROM s_room_journeys WHERE room_session_id=?",
                                 (room_session_id,)).fetchone()
        assert journey_row[0] == visit_id
        assert db.execute("SELECT student_id FROM p_training_sessions WHERE id=?", (visit_id,)).fetchone()[0] == member
        assert events(db, room_session_id, "scan_completed") == [
            {"source": "experimental_real", "quality": "limited", "observations": 1, "failed": False}]
        assert db.execute("SELECT demo FROM s_events WHERE room_session_id=? AND name='scan_completed'",
                          (room_session_id,)).fetchone()[0] == 1
    # Retention was not agreed: the photos went with the analysis.
    assert not folder.exists()


@pytest.mark.parametrize("retain", [False, True], ids=["photos-deleted", "photos-kept"])
def test_room_capture_keeps_photos_only_with_retention(world, monkeypatch, retain):
    Pipeline(monkeypatch)
    room = visit(world).ready()
    assert room.j["scan_options"] == ["room_capture"]
    room.consent("scan_capture")
    if retain:
        room.consent("scan_image_retention")
    room.act("scan/begin")
    for view in VIEWS:
        upload(room, view)
        with room.sedens.db() as db:
            scan = scan_row(db, room.ctx.room_session_id)
        stored = photo_folder(room.sedens, scan) / STORED[view]
        # Held privately while it waits for the analysis, whatever was decided.
        assert stored.read_bytes() == PHOTOS[view] and stat.S_IMODE(stored.stat().st_mode) == 0o600
        room.act("scan/view", view=view)
    shown = room.get()
    assert shown["state"] == "scan_result" and shown["scan"]["failed"] is False
    summary = shown["scan"]["summary"]
    assert (summary["label"], summary["label_note"], summary["source"]) == (None, None, "room_capture")
    assert summary["quality"] == "clear" and [o["id"] for o in summary["observations"]] == ["shoulder_line"]
    with room.sedens.db() as db:
        scan = scan_row(db, room.ctx.room_session_id)
        assert (scan["state"], scan["images_retained"]) == ("complete", int(retain))
        assert scan["analysis_id"]
        assert db.execute("SELECT demo FROM s_events WHERE room_session_id=? AND name='scan_completed'",
                          (room.ctx.room_session_id,)).fetchone()[0] == 0
    folder = photo_folder(room.sedens, scan)
    if not retain:
        assert not folder.exists()
        return
    root = media_store.root(room.sedens.repo).resolve()
    kept = sorted(folder.iterdir())
    assert [p.name for p in kept] == sorted(STORED.values())
    assert stat.S_IMODE(folder.stat().st_mode) == 0o700
    for path in kept:
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        assert path.resolve().is_relative_to(root / "scans")
        assert not path.resolve().is_relative_to(Path(WEB).resolve())
    assert {p.name: p.read_bytes() for p in kept}["left.jpg"] == PHOTOS["left"]


def test_retaking_a_view_deletes_its_photo(world, monkeypatch):
    Pipeline(monkeypatch)
    room = visit(world).ready()
    room.consent("scan_capture")
    room.act("scan/begin")
    upload(room, "front")
    room.act("scan/view", view="front")
    upload(room, "left")
    with room.sedens.db() as db:
        scan = scan_row(db, room.ctx.room_session_id)
    folder = photo_folder(room.sedens, scan)
    assert (folder / "front.png").exists()
    room.act("scan/retake", view="front")  # back one view, from the left side
    assert room.j["state"] == "scan_front"
    assert room.j["scan"]["views"]["front"] == {"captured": False, "photo": False}
    assert not (folder / "front.png").exists() and (folder / "left.jpg").exists()
    room.refused("scan/view", "image_required", view="front")
    with room.sedens.db() as db:
        assert events(db, room.ctx.room_session_id, "scan_retake") == [{"view": "front"}]


@pytest.mark.parametrize("leave", ["scan/skip", "end"])
def test_leaving_a_scan_part_way_deletes_its_photos(world, monkeypatch, leave):
    Pipeline(monkeypatch)
    room = visit(world).ready()
    room.consent("scan_capture")
    room.act("scan/begin")
    upload(room, "front")
    room.act("scan/view", view="front")
    upload(room, "left")
    with room.sedens.db() as db:
        scan = scan_row(db, room.ctx.room_session_id)
    folder = photo_folder(room.sedens, scan)
    assert len(list(folder.iterdir())) == 2
    if leave == "end":
        room.end()
    else:
        room.act(leave)
        assert room.j["state"] == "session_choice" and room.j["scan_skipped"] is True
    with room.sedens.db() as db:
        assert scan_row(db, room.ctx.room_session_id)["state"] == "abandoned"
    assert not folder.exists()


def test_a_failing_analysis_is_a_failed_scan_with_a_retake_never_a_500(demo_server, monkeypatch):
    base, sedens = demo_server
    Pipeline(monkeypatch, reports={v: RuntimeError("fictional model crash") for v in scans.PIPELINE_VIEW.values()})
    screen = Screen(base).ready()
    screen.consent("scan_capture")
    screen.act("scan/begin", source="experimental_real")
    for view in VIEWS:
        assert http_upload(screen, view, PHOTOS[view])[0] == 200
        status, body = screen.post("scan/view", view=view)
        assert status == 200, body
        screen.j = body["journey"]
    shown = screen.get()
    assert shown["state"] == "scan_result" and shown["scan"]["failed"] is True
    summary = shown["scan"]["summary"]
    assert (summary["quality"], summary["quality_text"]) == ("retake", RULES["quality"]["copy"]["retake"]["en"])
    assert summary["observations"] == [] and summary["notes"] == []
    assert all(v["quality"] == "retake" for v in summary["views"].values())
    assert summary["label"] == "EXPERIMENTAL REAL ANALYSIS"
    assert "RuntimeError" not in json.dumps(shown) and "crash" not in json.dumps(shown)
    room_session_id = screen.entered["session"]["room_session_id"]
    with sedens.db() as db:
        scan = scan_row(db, room_session_id)
        assert (scan["state"], scan["error"], scan["analysis_id"], scan["reliability"]) == (
            "failed", "RuntimeError", None, "retake")
        assert events(db, room_session_id, "scan_completed")[-1]["failed"] is True
        assert [r[0] for r in db.execute("SELECT outcome FROM s_room_scan_observations WHERE scan_id=?",
                                         (scan["id"],))] == ["withheld"]
    # The customer can simply scan again; the failed scan's photos are cleared then.
    screen.act("scan/again")
    assert screen.j["state"] == "scan_intro"
    assert not photo_folder(sedens, scan).exists()


def test_a_failed_analysis_deletes_its_photos_at_once(world, monkeypatch):
    Pipeline(monkeypatch, reports={v: RuntimeError("fictional model crash") for v in scans.PIPELINE_VIEW.values()})
    room = visit(world).ready()
    room.consent("scan_capture")
    room.act("scan/begin")
    capture_all(room)
    assert room.j["scan"]["failed"] is True
    room.act("scan/continue")  # the customer goes on to train without scanning again
    with room.sedens.db() as db:
        scan = scan_row(db, room.ctx.room_session_id)
    assert scan["images_retained"] == 0
    # "Unless I separately agree to keep them, the photos are deleted as soon as the analysis is finished."
    assert not photo_folder(room.sedens, scan).exists()


def test_a_real_scan_is_never_compared_with_the_demonstration(demo_world, monkeypatch):
    sedens, device = demo_world
    # The real photos measure exactly the demonstration's fictional values.
    Pipeline(monkeypatch, reports=clear_reports(front=-3.1, back=-2.9))
    room = Room(sedens, device).ready()
    room.consent("scan_capture")
    room.act("scan/begin", source="demo_precomputed")
    assert capture_all(room, photos=False)["scan"]["summary"]["source"] == "demo_precomputed"
    room.act("scan/again")
    room.act("scan/begin", source="experimental_real")
    first_real = capture_all(room)["scan"]["summary"]
    assert (first_real["label"], first_real["source"]) == ("EXPERIMENTAL REAL ANALYSIS", "experimental_real")
    assert first_real["label_note"] is None
    assert first_real["comparison"] == {"available": False, "text": RULES["comparison"]["none"]["en"]}
    room.act("scan/again")
    room.act("scan/begin", source="experimental_real")
    second_real = capture_all(room)["scan"]["summary"]
    assert second_real["comparison"] == {"available": True, "text": RULES["comparison"]["no_difference"]["en"]}
    with sedens.db() as db:
        rows = db.execute("SELECT source, analysis_id FROM s_room_scans WHERE room_session_id=? ORDER BY started_at",
                          (room.ctx.room_session_id,)).fetchall()
    assert [(r[0], bool(r[1])) for r in rows] == [
        ("demo_precomputed", False), ("experimental_real", True), ("experimental_real", True)]


def test_the_previous_scan_is_the_same_source_class_rules_version_and_a_clear_result(world):
    room = visit(world)
    sedens, fac, _ = world
    rows = [  # (marker, student, source, state, reliability, rules version, protocol, completed_at)
        ("real-match", fac["customer_id"], "room_capture", "complete", "clear", feedback.CURRENT, scans.PROTOCOL,
         "2026-10-01T09:00:00+00:00"),
        ("demo-match", fac["customer_id"], "demo_precomputed", "complete", "clear", feedback.CURRENT, scans.PROTOCOL,
         "2026-10-01T10:00:00+00:00"),
        ("old-rules", fac["customer_id"], "experimental_real", "complete", "clear", "sedens-feedback-0.9.0",
         scans.PROTOCOL, "2026-10-02T09:00:00+00:00"),
        ("limited", fac["customer_id"], "experimental_real", "complete", "limited", feedback.CURRENT, scans.PROTOCOL,
         "2026-10-03T09:00:00+00:00"),
        ("failed", fac["customer_id"], "experimental_real", "failed", "retake", feedback.CURRENT, scans.PROTOCOL,
         "2026-10-04T09:00:00+00:00"),
        ("other-protocol", fac["customer_id"], "room_capture", "complete", "clear", feedback.CURRENT, "workspace_v1",
         "2026-10-05T09:00:00+00:00"),
        ("other-person", fac["other_id"], "room_capture", "complete", "clear", feedback.CURRENT, scans.PROTOCOL,
         "2026-10-06T09:00:00+00:00"),
    ]
    with sedens.db() as db:
        for marker, student, source, state, reliability, version, protocol, completed in rows:
            db.execute("INSERT INTO s_room_scans(id,org_id,student_id,protocol,source,state,reliability,"
                       "feedback_rules_version,summary,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                       (uid(), fac["org_id"], student, protocol, source, state, reliability, version,
                        encode({"measurements": {"marker": marker}}), completed, completed))
        for source, expected in (("room_capture", "real-match"), ("experimental_real", "real-match"),
                                 ("demo_precomputed", "demo-match")):
            current = {"id": uid(), "student_id": fac["customer_id"], "protocol": scans.PROTOCOL, "source": source}
            assert scans._previous(db, current) == {"marker": expected}, source
        stranger = {"id": uid(), "student_id": fac["coach_id"], "protocol": scans.PROTOCOL, "source": "room_capture"}
        assert scans._previous(db, stranger) is None
    assert room.ctx.student_id == fac["customer_id"]


# == the feedback layer (pilates/sedens/feedback.py) ==========================================


def mview(shoulder=None, *, people=1, suitable=True, reason=None, confidence=0.9, status="measured", extra=None):
    metrics = {}
    if shoulder is not None:
        metrics["shoulder_tilt"] = {"value": shoulder, "unit": "deg", "confidence": confidence, "status": status}
    metrics.update(extra or {})
    out = {"people": people, "suitable": suitable, "metrics": metrics}
    if reason:
        out["reason"] = reason
    return out


SIDE = mview(extra={"forward_head": {"value": 0.05, "unit": "ratio", "confidence": 0.85, "status": "estimated"}})


def measured(front, back, left=SIDE, right=SIDE):
    out = {"front": front if isinstance(front, (dict, type(None))) else mview(front),
           "back": back if isinstance(back, (dict, type(None))) else mview(back), "left": left, "right": right}
    return {k: v for k, v in out.items() if v is not None}


@pytest.mark.parametrize("front, back, outcome, reason, side", [
    (-3.1, -2.9, "shown", "above_threshold_in_both_views", "right"),
    (3.0, 4.2, "shown", "above_threshold_in_both_views", "left"),
    (THRESHOLD, THRESHOLD, "shown", "above_threshold_in_both_views", "left"),
    (-THRESHOLD, -8.0, "shown", "above_threshold_in_both_views", "right"),
    (THRESHOLD - 0.01, 5.0, "below_threshold", "within_measurement_variation", None),
    (-1.0, -1.2, "below_threshold", "within_measurement_variation", None),
    (0.0, 0.0, "below_threshold", "views_disagree", None),
    (1.0, -1.0, "below_threshold", "views_disagree", None),
    (4.0, -4.0, "withheld", "views_disagree", None),
    (4.0, -1.0, "withheld", "views_disagree", None),
])
def test_the_shoulder_line_is_shown_only_when_front_and_back_agree_beyond_the_threshold(
        front, back, outcome, reason, side):
    for lang in ("en", "ko"):
        out = feedback.interpret(measured(front, back), locale=lang)
        assert out["quality"] == "clear"
        assert out["evaluated"] == [{"rule_id": "shoulder_line", "metric": "shoulder_tilt", "unit": "deg",
                                     "threshold": THRESHOLD, "value": round((front + back) / 2, 2),
                                     "outcome": outcome, "reason": reason, "side": side}]
        heading = SHOULDER["heading"][lang]
        if outcome == "shown":
            text = SHOULDER["observed"][lang].replace("{side}", SHOULDER["sides"][side][lang])
            assert out["observations"] == [{"id": "shoulder_line", "heading": heading, "text": text,
                                            "limitation": SHOULDER["limitation"][lang], "provisional": True}]
            assert out["notes"] == [] and out["focus_hint"] == "shoulder_mobility"
            assert out["focus"]["text"] == RULES["focus"]["shoulder_mobility"]["text"][lang]
        else:
            note = SHOULDER["below_threshold" if outcome == "below_threshold" else "withheld"][lang]
            assert out["observations"] == []
            assert out["notes"] == [{"id": "shoulder_line", "heading": heading, "text": note}]
            assert out["focus_hint"] is None
            assert out["focus"]["text"] == RULES["focus"]["general"]["text"][lang]
            assert out["focus"]["why"] == RULES["focus"]["general"]["why"][lang]


@pytest.mark.parametrize("front, quality, reason", [
    (mview(-5.0, people=0), "retake", "no_person"),
    (mview(-5.0, people=2), "retake", "several_people"),
    (mview(-5.0, suitable=False, reason="wrong_direction"), "retake", "wrong_direction"),
    (mview(-5.0, suitable=False, reason="not_standing"), "retake", "not_standing"),
    (mview(-5.0, suitable=False), "retake", "not_full_body"),
    (None, "retake", "unclear"),
    (mview(-5.0, confidence=RULES["quality"]["min_confidence"] - 0.01), "limited", "unclear"),
], ids=["nobody", "several-people", "wrong-direction", "not-standing", "not-full-body", "missing", "low-confidence"])
def test_an_unclear_view_withholds_the_observation_with_a_customer_reason(front, quality, reason):
    for lang in ("en", "ko"):
        out = feedback.interpret(measured(front, mview(-5.0)), locale=lang)
        assert out["views"]["front"] == {"quality": quality,
                                         "reason": RULES["quality"]["view_reasons"][reason][lang]}
        assert out["views"]["back"] == {"quality": "clear", "reason": None}
        assert out["quality"] == "limited" and out["quality_text"] == RULES["quality"]["copy"]["limited"][lang]
        assert out["observations"] == [] and out["focus_hint"] is None
        assert out["evaluated"][0]["outcome"] == "withheld" and out["evaluated"][0]["reason"] == "view_not_clear"
        assert out["notes"] == [{"id": "shoulder_line", "heading": SHOULDER["heading"][lang],
                                 "text": SHOULDER["withheld"][lang]}]
    # Customer reasons are plain directions, never model internals.
    for copy_ in RULES["quality"]["view_reasons"].values():
        assert not re.search(r"confidence|landmark|keypoint|threshold|model|%", copy_["en"], re.I)


def test_an_unusable_shoulder_value_in_a_clear_view_is_withheld():
    clear_other = {"pelvic_obliquity": {"value": 0.5, "unit": "deg", "confidence": 0.95, "status": "measured"}}
    for shoulder in (mview(-5.0, confidence=0.3, extra=clear_other),
                     mview(-5.0, status="unavailable", extra=clear_other),
                     mview(extra=clear_other)):
        out = feedback.interpret(measured(shoulder, mview(-5.0)), locale="en")
        assert out["views"]["front"]["quality"] == "clear"
        assert (out["evaluated"][0]["outcome"], out["evaluated"][0]["reason"]) == ("withheld", "metric_unavailable")
        assert out["observations"] == [] and out["notes"][0]["text"] == SHOULDER["withheld"]["en"]


def test_front_and_back_both_unclear_ask_for_a_retake_and_describe_nothing():
    out = feedback.interpret(measured(mview(-5.0, people=2), mview(-5.0, people=0)), locale="en")
    assert (out["quality"], out["quality_text"]) == ("retake", RULES["quality"]["copy"]["retake"]["en"])
    assert out["observations"] == [] and out["notes"] == []
    assert out["focus"]["text"] == RULES["focus"]["general"]["text"]["en"]
    nothing = feedback.interpret({}, locale="ko")
    assert nothing["quality"] == "retake" and all(v["quality"] == "retake" for v in nothing["views"].values())
    assert nothing["observations"] == [] and nothing["advanced"] == []


def test_side_views_never_produce_a_customer_observation():
    # Every observation rule uses front and back only; the withheld metrics have no rule.
    assert all(set(rule["views"]) <= {"front", "back"} for rule in RULES["observations"])
    withheld = {m["metric"] for m in RULES["withheld_metrics"]}
    assert {"forward_head", "pelvic_obliquity", "trunk_lean_lateral", "head_lateral_tilt"} <= withheld
    assert not withheld & {rule["metric"] for rule in RULES["observations"]}
    loud = {metric: {"value": 25.0, "unit": "deg", "confidence": 0.99, "status": "measured"}
            for metric in withheld | {"shoulder_tilt"}}
    side = mview(extra=loud)
    for front, back in ((0.4, 0.3), (None, None)):
        data = measured(front if front is None else mview(front, extra={k: v for k, v in loud.items()
                                                                        if k != "shoulder_tilt"}),
                        back if back is None else mview(back), left=side, right=side)
        out = feedback.interpret(data, locale="en")
        assert out["observations"] == [], (front, back)
        assert [e["rule_id"] for e in out["evaluated"]] == [rule["id"] for rule in RULES["observations"]]
        assert out["focus_hint"] is None
        # The side and withheld values stay available only under Advanced.
        assert {(a["view"], a["metric"]) for a in out["advanced"]} >= {("left", "forward_head"),
                                                                       ("right", "forward_head")}


def test_the_comparison_is_a_measured_difference_never_better_or_worse():
    def compare(now_front, now_back, before_front, before_back, lang="en"):
        before = None if before_front is None else measured(before_front, before_back)
        return feedback.compare(measured(now_front, now_back), before, lang)

    copy_ = RULES["comparison"]
    assert compare(-3.0, -3.0, None, None) == {"available": False, "text": copy_["none"]["en"]}
    assert compare(-3.0, -3.0, -3.1, -2.9) == {"available": True, "text": copy_["no_difference"]["en"]}
    assert compare(-3.0, -3.0, -4.0, -4.5)["text"] == copy_["no_difference"]["en"]  # within the change threshold
    further = compare(-6.0, -6.5, -3.1, -2.9)
    closer = compare(-0.5, -0.2, -3.6, -3.3)
    assert further == {"available": True, "text": copy_["difference"]["en"].replace(
        "{direction}", copy_["directions"]["less_level"]["en"])}
    assert closer["text"] == copy_["difference"]["en"].replace("{direction}", copy_["directions"]["more_level"]["en"])
    # A view either scan could not measure: nothing to compare.
    assert feedback.compare(measured(-6.0, -6.0), measured(-3.0, mview()), "en")["available"] is False
    assert feedback.compare(measured(-6.0, mview(-6.0, confidence=0.2)), measured(-3.0, -3.0), "en")[
        "available"] is False
    for lang in ("en", "ko"):
        for text in (compare(-6.0, -6.5, -3.1, -2.9, lang)["text"], compare(-0.5, -0.2, -3.6, -3.3, lang)["text"]):
            assert "측정" in text if lang == "ko" else "measured" in text
            # It says outright that a difference is neither better nor worse, and claims neither.
            negation = {"en": "It doesn't mean better or worse.", "ko": "좋아지거나 나빠졌다는 뜻은 아니에요."}[lang]
            assert text.endswith(negation)
            claim = text.replace(negation, "")
            assert not re.search(r"improv|better|worse|개선|악화|좋아|나빠|나아", claim, re.I), claim


def test_advanced_lists_technical_values_without_any_confidence():
    data = measured(mview(-3.1, extra={"pelvic_obliquity": {"value": 0.8, "unit": "deg", "confidence": 0.2,
                                                            "status": "measured"},
                                       "made_up_metric": {"value": 1.0, "unit": "deg", "confidence": 1.0,
                                                          "status": "measured"},
                                       "trunk_lean_lateral": {"value": None, "unit": "deg", "confidence": 0.0,
                                                              "status": "unavailable"}}),
                    mview(-2.9))
    for lang in ("en", "ko"):
        rows = feedback.advanced(data, lang)
        assert all(set(r) == {"view", "metric", "label", "value", "unit", "limitation"} for r in rows)
        assert [(r["view"], r["metric"], r["value"]) for r in rows] == [
            ("front", "pelvic_obliquity", 0.8), ("front", "shoulder_tilt", -3.1), ("left", "forward_head", 0.05),
            ("back", "shoulder_tilt", -2.9), ("right", "forward_head", 0.05)]
        labels = RULES["advanced"]
        assert rows[1]["label"] == labels["shoulder_tilt"]["label"][lang]
        assert rows[1]["limitation"] == labels["shoulder_tilt"]["limitation"][lang]
        summary = feedback.customer_summary(feedback.interpret(data, locale=lang))
        assert set(summary) == SUMMARY_KEYS
        assert "confidence" not in keys_anywhere(summary) and "confidence" not in json.dumps(summary)


# == banned customer copy ======================================================================

# Brief §40 (and §14: no score, grade or percentage), in both customer languages.
BANNED = [
    r"\bdiagnos", r"\bdisease", r"\bcorrect(s|ing)? (your )?posture", r"\bperfect posture", r"\bbad posture",
    r"\bfix(es)? your posture", r"\bprevents? injur", r"\binjury risk", r"\bposture score", r"\balignment score",
    r"\bmuscle weakness", r"\bmuscle activation measured", r"\bscor(e|es|ed|ing)\b", r"%", r"\bgrad(e|es|ed|ing)\b",
    r"\babnormal", r"\bsyndrome", r"\bdysfunction",
    # 질환 is the everyday word for a (medical) condition, as in the readiness questions; 질병 is "disease".
    "진단", "질병", "증후군", r"기능 ?장애", "점수", "등급", "비정상", "정상 범위", "나쁜 자세", "바른 자세",
    "완벽한 자세", "교정", r"부상(을)? ?예방", r"부상 ?위험", r"근력 ?약화", r"근육 ?약화", r"근육 ?활성도?(를|을|가)? ?측정",
]
# The only places the words may appear: the exact statement of what SEDENS does not do.
ALLOWED = ["does not diagnose or treat any condition", "does not diagnose",
           "어떤 질환도 진단하거나 치료하지 않습니다", "진단하거나 치료하지 않습니다"]
CUSTOMER_FILES = sorted({
    "sedens_readiness.v1.json", "sedens_feedback_rules.v1.json", "sedens_demo_scan.v1.json",
    "sedens_recommendation_rules.v1.json", "sedens_session_feedback.v1.json", "sedens_standard/exercises.v1.json",
    # Whatever the server is configured to read (a later version is customer copy too).
    *readiness.FILES.values(), *feedback.FILES.values()})


def banned_in(text: str) -> list[str]:
    for allowed in ALLOWED:
        text = text.replace(allowed, " ")
    return [pattern for pattern in BANNED if re.search(pattern, text, re.I)]


def customer_strings(node, path=""):
    """Customer copy in the data files is every bilingual ``{"en", "ko"}`` value;
    provenance, notes, definitions and evidence are plain strings and are skipped."""
    if isinstance(node, dict):
        if isinstance(node.get("en"), (str, list)) and isinstance(node.get("ko"), (str, list)):
            for lang in ("en", "ko"):
                for text in node[lang] if isinstance(node[lang], list) else [node[lang]]:
                    yield f"{path}.{lang}", lang, text
            return
        for key, value in node.items():
            yield from customer_strings(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from customer_strings(value, f"{path}[{index}]")


def test_the_banned_copy_check_catches_what_it_should():
    for bad in ("Your posture score is 63/100", "Bad posture detected", "This prevents injury",
                "Muscle weakness detected", "We diagnose nothing", "Alignment grade B", "자세 점수 63점",
                "비정상 소견", "거북목 증후군", "골반 기능 장애", "근육 활성도 측정 결과", "posture health 80%"):
        assert banned_in(bad), bad
    for fine in ("SEDENS does not diagnose or treat any condition.", "어떤 질환도 진단하거나 치료하지 않습니다.",
                 "교육용 해부학 — 측정된 근육 활성도가 아닙니다.", "Educational anatomy — not measured muscle activation.",
                 "Stand tall with your arms relaxed.", "Upgrade later"):
        assert not banned_in(fine), fine


@pytest.mark.parametrize("name", CUSTOMER_FILES)
def test_customer_copy_in_data_files_has_no_banned_language(name):
    found = list(customer_strings(json.loads((DATA / name).read_text(encoding="utf-8"))))
    assert {lang for _, lang, _ in found} == {"en", "ko"} and len(found) >= 4, name
    offending = [(path, text, banned_in(text)) for path, _, text in found if banned_in(text)]
    assert offending == [], offending


def test_consent_texts_and_scan_labels_have_no_banned_language():
    found = [(kind, lang, text[lang]) for kind, text in consent.TEXTS.items() for lang in ("en", "ko")]
    found += [(source, lang, label[lang]) for source, label in scans.LABELS.items() if label for lang in ("en", "ko")]
    assert len(found) == 2 * len(consent.TEXTS) + 4
    assert [(k, lang, banned_in(text)) for k, lang, text in found if banned_in(text)] == []
    # The scan consent states the one negation the copy may contain, in both languages.
    assert "does not diagnose" in consent.TEXTS["scan_capture"]["en"]
    assert "진단하거나 치료하지 않습니다" in consent.TEXTS["scan_capture"]["ko"]


def test_every_rendered_scan_summary_is_free_of_banned_language():
    grid = [
        measured(-3.1, -2.9), measured(4.0, 5.0), measured(1.0, 1.1), measured(4.0, -4.0),
        measured(mview(-5.0, people=2), mview(-5.0)), measured(mview(-5.0, people=0), mview(-5.0, people=0)),
        measured(mview(-5.0, confidence=0.1), mview(-5.0, suitable=False, reason="not_standing")),
        {"front": mview(-3.0), "back": mview(-3.0), "left": mview(people=0), "right": mview(suitable=False)},
        DEMO["views"], {},
    ]
    previous = [None, measured(-3.0, -3.0), measured(-9.0, -9.0), measured(0.0, 0.0)]
    seen = 0
    for data in grid:
        for before in previous:
            for lang in ("en", "ko"):
                summary = feedback.customer_summary(feedback.interpret(data, locale=lang, previous=before))
                assert not keys_anywhere(summary) & {"score", "grade", "percent", "confidence"}
                for text in strings_anywhere(summary):
                    assert not banned_in(text), (lang, text)
                    seen += 1
    assert seen > 200
