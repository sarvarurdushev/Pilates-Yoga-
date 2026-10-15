"""Phase 3 security review (brief §56): each attack, tried for real.

Most attacks go over HTTP against a running server, with the cookies a room screen,
a customer's phone or a stranger would hold. Two facilities (A and B), each with a
paired room screen; facility A offers its coach's free course (with a picture on its
first step) and has switched on a professor's paid course that the customer has not
bought. All people and facilities are fictional.

 1. readiness bypass                     9. duplicate completion
 2. consent bypass                      10. cross-user Passport write
 3. scan without an active room         11. scan result for another user
 4. plan without readiness              12. customer technical-data leakage
 5. player without entitlement          13. raw media URL bypass
 6. playback after room expiration      14. session resume hijack
 7. another facility's course           15. forged analytics events changing state
 8. course version substitution
"""

from __future__ import annotations

from datetime import timedelta
import http.client
import json
from urllib.parse import urlparse

import pytest

from pilates.sedens import consent, course_media, courses, scans
from pilates.sedens import http as sedens_http
from pilates.sedens.util import iso, utcnow
from course_support import (approve, build_guided, coach_creator, facility_setting, professor_studio, publish,
                            submit)
from sedens_support import Client, facility, make_sedens, pair, room_code, running_server, sedens_staff
from test_sedens_room_journey import visit
from test_sedens_room_scan import VIEWS, Pipeline, keys_anywhere, strings_anywhere, upload

KRW_29000 = {"price_type": "paid", "amount_minor": 29000, "currency": "KRW", "sale_state": "active"}
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00fictional-png" * 8
STEPS = ("std-pelvic-curl", "std-breathing")


class Site:
    pass


@pytest.fixture
def site(tmp_path):
    sedens_http._LIMITS.clear()
    s = Site()
    s.sedens = sedens = make_sedens(tmp_path / "s.db")
    _, s.reviewer, _ = sedens_staff(sedens)
    s.a, s.b = facility(sedens, "A"), facility(sedens, "B")
    s.coach = coach = coach_creator(sedens, s.a)
    view = build_guided(sedens, coach, "Core Basics", sessions=2, steps=STEPS)
    with sedens.db() as db:  # a picture on the first step, so the course has a stored file
        picture = course_media.add_repo_asset(sedens, db, coach, "repo-bridge")
        session = view["modules"][0]["sessions"][0]
        step = session["steps"][0]
        view = courses.save_step(sedens, db, coach, {
            **{k: step[k] for k in ("id", "phase", "sets", "reps", "rest_seconds", "sides", "customer_cue")},
            "course_id": view["course"]["id"], "revision": view["revision"], "session_id": session["id"],
            "exercise_source": "standard", "exercise_ref": step["exercise"]["ref"], "image_media_id": picture["id"]})
    s.picture = picture["id"]
    view = publish(sedens, coach, s.reviewer, view, "selected_facilities", [{"org_id": s.a["org_id"], "free": True}])
    s.course = view["course"]["id"]
    s.sessions = [x["id"] for x in view["modules"][0]["sessions"]]
    facility_setting(sedens, s.a, s.course, enabled=True, included=True)
    professor = professor_studio(sedens)
    paid = publish(sedens, professor, s.reviewer, build_guided(sedens, professor, "Mobility Foundations"),
                   "marketplace", price=KRW_29000)
    s.paid = paid["course"]["id"]
    facility_setting(sedens, s.a, s.paid, enabled=True)
    s.screen_a, s.screen_a2, s.screen_b = pair(sedens, s.a), pair(sedens, s.a, name="Second screen"), pair(sedens, s.b)
    server, s.base = running_server(sedens.repo.path)
    yield s
    server.shutdown()
    server.server_close()


class Screen:
    """A room screen over HTTP: its paired-device cookie, then the room cookie of a visit."""

    def __init__(self, site, device):
        self.site, self.client, self.j = site, Client(site.base), None
        self.client.jar["sedens_device"] = device

    def enter(self, token):
        status, body = self.client.call("POST", "/sedens/room/enter", {
            "method": "access_code", "credential": room_code(self.site.sedens, token)})
        assert status == 200, body
        return self.get()

    def get(self):
        status, body = self.client.call("GET", "/sedens/room/journey?lang=en")
        assert status == 200, body
        self.j = body["journey"]
        return self.j

    def post(self, name, **body):
        body.setdefault("expect", self.j["state"] if self.j else "")
        body.setdefault("lang", "en")
        return self.client.call("POST", "/sedens/room/journey/" + name, body)

    def act(self, name, **body):
        status, out = self.post(name, **body)
        assert status == 200, (name, status, out)
        self.j = out.get("journey", self.j)  # "end" answers without one
        return out

    def refused(self, name, status, code=None, **body):
        got, out = self.post(name, **body)
        assert got == status and (code is None or out.get("code") == code), (name, got, out)
        return out

    def ready(self):
        self.act("readiness/start")
        while self.j["state"] == "readiness":
            ask = self.j["readiness"]["next"]
            self.act("readiness/answer", item=ask["item"], **({"follow_up": False} if ask["follow_up"] else
                                                              {"answer": False}))
        assert self.j["state"] == "scan_intro"
        return self

    def choice(self):
        self.ready().act("scan/skip")
        assert self.j["state"] == "session_choice"
        return self

    def finish(self):
        while self.j["state"] in ("exercise", "exercise_paused"):
            if self.j["state"] == "exercise_paused":
                self.act("workout/resume")
            self.act("workout/step", position=self.j["workout"]["current_index"], outcome="completed")
        assert self.j["state"] == "session_complete"
        return self


def screen(site, device=None, token_key="customer_token", fac=None):
    s = Screen(site, device or site.screen_a)
    s.enter((fac or site.a)[token_key])
    return s


def upload_photo(client, view="front", body=PNG):
    parsed = urlparse(client.base)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
    headers = {"X-Sedens-Request": "1", "Content-Type": "image/png",
               "Cookie": "; ".join(f"{k}={v}" for k, v in client.jar.items())}
    try:
        conn.request("POST", f"/sedens/room/scan/image?view={view}", body=body, headers=headers)
        response = conn.getresponse()
        return response.status, json.loads(response.read() or b"{}")
    finally:
        conn.close()


def rows(site, sql, *args):
    with site.sedens.db() as db:
        return [dict(r) for r in db.execute(sql, args)]


def media(client, object_id):
    return client.call("GET", f"/sedens/media/file?id={object_id}", raw=True)[0]


# == 1. readiness bypass ===========================================================================


def test_1_no_step_after_entry_can_skip_the_readiness_check(site):
    s = screen(site)
    assert s.j["state"] == "identified"
    for name, body in (("scan/begin", {"source": "room_capture"}), ("scan/skip", {}), ("plan/personalized", {}),
                       ("plan/request", {"duration": 30, "intensity": "light", "goal": "general"}),
                       ("course/start", {"course_id": site.course}), ("workout/start", {}),
                       ("workout/step", {"position": 0, "outcome": "completed"})):
        out = s.refused(name, 409, **body)
        assert out["code"] in ("invalid_transition", "readiness_required"), (name, out)
    # Claiming to be further along is a stale claim, not a shortcut.
    out = s.refused("plan/personalized", 409, expect="session_choice")
    assert out["code"] in ("journey_changed", "readiness_required"), out
    # An answer cannot carry its own verdict.
    s.act("readiness/start")
    first = s.j["readiness"]["next"]["item"]
    s.act("readiness/answer", item=first, answer=False, outcome="ready", state="session_choice")
    assert s.get()["state"] == "readiness"
    assert [not r["outcome"] for r in rows(site, "SELECT outcome FROM s_readiness_checks")] == [True]
    assert rows(site, "SELECT id FROM s_workouts") == [] and rows(site, "SELECT id FROM s_recommendations") == []


# == 2. consent bypass ==============================================================================


def test_2_the_scan_never_starts_without_current_camera_consent(site):
    s = screen(site).ready()
    s.refused("scan/begin", 409, "consent_required", source="room_capture")
    # An out-of-date consent text is refused, not counted.
    status, out = s.client.call("POST", "/sedens/room/consent", {"kind": "scan_capture", "granted": True,
                                                                 "text_version": "2026-10-v1"})
    assert status == 409 and out["code"] == "stale_consent_text", out
    s.refused("scan/begin", 409, "consent_required", source="room_capture")
    # Photos are refused while no scan is running.
    assert upload_photo(s.client)[0] == 409
    assert rows(site, "SELECT id FROM s_room_scans") == []


# == 3. scan without an active room ================================================================


def test_3_no_scan_from_a_phone_or_after_the_visit_ends(site):
    phone = Client(site.base)
    phone.jar["motion_session"] = site.a["customer_token"]
    status, out = phone.call("POST", "/sedens/room/journey/scan/begin", {"source": "room_capture"})
    assert status == 403, out
    assert upload_photo(phone)[0] == 403

    s = screen(site).ready()
    status, _ = s.client.call("POST", "/sedens/room/consent", {
        "kind": "scan_capture", "granted": True, "text_version": consent.TEXTS["scan_capture"]["version"]})
    assert status == 200
    s.act("end")
    status, out = s.post("scan/begin", source="room_capture")
    assert status in (401, 403), out
    assert upload_photo(s.client)[0] in (401, 403)
    assert rows(site, "SELECT id FROM s_room_scans") == []


# == 4. plan without readiness =====================================================================


def test_4_no_plan_without_this_visit_s_ready_check(site):
    s = screen(site)
    s.refused("plan/request", 409, duration=30, intensity="light", goal="general")
    # A journey pushed to the choice screen without a check (as if the database were edited).
    with site.sedens.db() as db:
        db.execute("UPDATE s_room_journeys SET state='session_choice'")
    s.get()
    s.refused("plan/personalized", 409, "readiness_required")
    # Another visit's ready check does not count for this one.
    other = screen(site, site.screen_a2, token_key="other_token")
    other.ready()
    s.refused("plan/personalized", 409, "readiness_required")
    assert rows(site, "SELECT id FROM s_recommendations") == []


# == 5. player without entitlement =================================================================


def test_5_a_paid_course_needs_the_purchase(site):
    s = screen(site).choice()
    assert site.paid not in {c["course_id"] for c in s.j["choice"]["courses"]}
    s.refused("course/start", 403, "purchase_required", course_id=site.paid)
    s.refused("workout/start", 409, "invalid_transition")
    assert rows(site, "SELECT id FROM s_workouts") == [] and rows(site, "SELECT id FROM s_enrollments") == []


# == 6. playback after room expiration ==============================================================


def test_6_nothing_plays_once_the_room_session_has_expired(site):
    s = screen(site).choice()
    s.act("course/start", course_id=site.course)
    s.act("workout/start")
    assert media(s.client, site.picture) == 200  # the room may show the course while the visit lasts
    with site.sedens.db() as db:
        db.execute("UPDATE s_room_sessions SET expires_at=?", (iso(utcnow() - timedelta(minutes=1)),))
    status, out = s.post("workout/step", position=0, outcome="completed")
    assert status in (401, 403), out
    assert s.client.call("GET", "/sedens/room/journey")[0] in (401, 403)
    assert media(s.client, site.picture) == 404
    assert rows(site, "SELECT state FROM s_workout_steps WHERE position=0") == [{"state": "active"}]
    assert rows(site, "SELECT id FROM p_session_exercise_events") == []


# == 7. another facility's course ===================================================================


def test_7_another_facility_s_room_cannot_play_or_read_this_course(site):
    s = screen(site, site.screen_b, fac=site.b).choice()
    assert site.course not in {c["course_id"] for c in s.j["choice"]["courses"]}
    out = s.post("course/start", course_id=site.course, session_id=site.sessions[0])
    assert out[0] in (403, 404), out
    assert media(s.client, site.picture) == 404
    # Facility A's customer on facility B's screen is no customer of B.
    stranger = Screen(site, site.screen_b)
    status, _ = stranger.client.call("POST", "/sedens/room/enter", {
        "method": "access_code", "credential": room_code(site.sedens, site.a["customer_token"])})
    assert status in (403, 404)
    assert rows(site, "SELECT id FROM s_workouts") == []


# == 8. course version substitution =================================================================


def test_8_a_client_cannot_choose_a_newer_or_older_version(site):
    s = screen(site).choice()
    s.act("course/start", course_id=site.course)
    s.act("workout/start")
    s.finish()
    s.act("end")
    with site.sedens.db() as db:  # version 2 adds a third session
        editor = courses.editor_view(site.sedens, db, site.coach, site.course)
        module = editor["modules"][0]["id"]
        editor = courses.save_session(site.sedens, db, site.coach, {"course_id": site.course, "revision": editor["revision"],
                                                                   "module_id": module, "title": "Session 3"})
        new_session = editor["modules"][0]["sessions"][2]["id"]
        editor = courses.save_step(site.sedens, db, site.coach, {
            "course_id": site.course, "revision": editor["revision"], "session_id": new_session,
            "exercise_source": "standard", "exercise_ref": "std-clam", "reps": 8, "sides": "each_side"})
    approve(site.sedens, site.reviewer, submit(site.sedens, site.coach, editor)["course"]["id"])
    with site.sedens.db() as db:
        assert courses.row(db, site.course)["published_version"] == 2

    s = screen(site).choice()
    # A forged version and a session that only version 2 has.
    s.refused("course/start", 404, "unknown_item", course_id=site.course, session_id=new_session, version=2)
    s.act("course/start", course_id=site.course, version=2, course_version=2)
    assert s.j["workout"]["course_version"] == 1
    assert rows(site, "SELECT version FROM s_enrollments") == [{"version": 1}]
    assert rows(site, "SELECT course_version FROM s_workouts WHERE state='ready'") == [{"course_version": 1}]


# == 9. duplicate completion ========================================================================


def test_9_a_step_and_a_course_session_are_completed_once(site):
    s = screen(site).choice()
    s.act("course/start", course_id=site.course)
    s.act("workout/start")
    s.act("workout/step", position=0, outcome="completed")
    again = s.post("workout/step", position=0, outcome="completed")
    assert again[0] in (200, 409), again
    assert len(rows(site, "SELECT id FROM p_session_exercise_events")) == 1
    s.act("workout/step", position=1, outcome="completed")
    assert s.j["state"] == "session_complete"
    body = {"course_id": site.course, "session_id": site.sessions[0]}
    for _ in range(3):
        status, out = s.client.call("POST", "/sedens/room/course/complete", body)
        assert status == 200 and out["progress"]["completed_items"] == 1, out
    assert len(rows(site, "SELECT * FROM s_course_progress")) == 1
    assert len(rows(site, "SELECT id FROM p_session_exercise_events")) == 2
    assert len(rows(site, "SELECT name FROM s_events WHERE name='workout_completed'")) == 1


# == 10. cross-user Passport write ===================================================================


def test_10_a_visit_writes_only_its_own_customer_s_passport(site):
    other = screen(site, site.screen_a2, token_key="other_token").choice()
    other.act("course/start", course_id=site.course)
    other.act("workout/start")
    other.finish()
    their_workout = rows(site, "SELECT id, training_session_id FROM s_workouts")[0]
    other.act("workout/feedback", effort=3, discomfort="no")

    s = screen(site).choice()
    s.act("course/start", course_id=site.course)
    s.act("workout/start")
    forged = {"student_id": site.a["other_id"], "user_id": site.a["other_id"],
              "training_session_id": their_workout["training_session_id"], "workout_id": their_workout["id"]}
    s.act("workout/step", position=0, outcome="completed", **forged)
    s.act("workout/step", position=1, outcome="completed", **forged)
    s.act("workout/feedback", effort=9, discomfort="yes", urgent=False, regions=["hip"], **forged)
    theirs = rows(site, "SELECT e.id FROM p_session_exercise_events e JOIN p_training_sessions t ON t.id=e.session_id "
                        "WHERE t.student_id=?", site.a["other_id"])
    assert len(theirs) == 2  # only their own two steps
    assert rows(site, "SELECT effort FROM s_session_feedback WHERE workout_id=?", their_workout["id"]) == [{"effort": 3}]
    mine = rows(site, "SELECT t.student_id FROM p_training_sessions t JOIN s_workouts w ON w.training_session_id=t.id "
                      "WHERE w.room_session_id<>(SELECT room_session_id FROM s_workouts WHERE id=?)", their_workout["id"])
    assert mine == [{"student_id": site.a["customer_id"]}]


# == 11 and 12. another customer's scan; technical data ================================================


def test_11_12_a_scan_is_shown_only_to_its_own_customer_and_only_as_plain_words(tmp_path, monkeypatch):
    from test_sedens_room_journey import facility_database
    sedens_http._LIMITS.clear()
    path, fac = facility_database(tmp_path / "facility.db")
    sedens = make_sedens(path, "local_room")
    world = (sedens, fac, pair(sedens, fac))
    Pipeline(monkeypatch)
    room = visit(world).ready()
    room.consent("scan_capture")
    room.act("scan/begin")
    for view in VIEWS:
        upload(room, view)
        room.act("scan/view", view=view)
    shown = room.get()
    assert shown["state"] == "scan_result"
    with sedens.db() as db:
        scan = dict(db.execute("SELECT * FROM s_room_scans").fetchone())
        image_keys = [r[0] for r in db.execute("SELECT image_key FROM s_room_scan_views WHERE image_key<>''")]
    # 12. The customer sees words and a few values, never the stored files or the machinery.
    leaked = keys_anywhere(shown) & {"image_key", "keypoints", "landmarks", "analysis_id", "threshold_deg", "model",
                                     "file", "folder", "student_id", "org_id", "people", "metrics"}
    assert leaked == set()
    text = json.dumps(shown)
    for secret in [scan["analysis_id"], ".sedens-media", "RTMO", *image_keys]:
        assert not secret or secret not in text, secret
    # 11. The next customer in the same room starts from nothing of theirs.
    room.end()
    other = visit(world, token_key="other_token").ready()
    assert scan["id"] not in json.dumps(other.j) and scan["analysis_id"] not in json.dumps(other.j)
    other.consent("scan_capture")
    other.act("scan/begin")
    for view in VIEWS:
        upload(other, view)
        other.act("scan/view", view=view)
    comparison = other.get()["scan"]["summary"]["comparison"]
    assert scan["id"] not in json.dumps(other.j)
    assert not comparison or not comparison.get("available"), comparison
    with sedens.db() as db:
        assert scans._previous(db, dict(db.execute("SELECT * FROM s_room_scans WHERE student_id=?",
                                                     (fac["other_id"],)).fetchone())) is None
    assert all("Customer A" not in s for s in strings_anywhere(other.j))


# == 13. raw media URL bypass =========================================================================


def test_13_course_files_only_through_an_entitled_live_room(site):
    anonymous = Client(site.base)
    phone = Client(site.base)
    phone.jar["motion_session"] = site.a["customer_token"]
    b_room = screen(site, site.screen_b, fac=site.b)
    for client in (anonymous, phone, b_room.client):
        assert media(client, site.picture) == 404
    s = screen(site).choice()
    assert media(s.client, site.picture) == 200
    s.act("end")
    assert media(s.client, site.picture) == 404
    # Scan photos have no address at all, and the media folder is outside the web root.
    for guess in ("/sedens/room/scan/image?view=front", "/s.db.sedens-media/objects", "/../s.db.sedens-media/scans",
                  f"/sedens/media/file?id={site.picture}x"):
        assert anonymous.call("GET", guess, raw=True)[0] in (403, 404, 405), guess


# == 14. session resume hijack =========================================================================


def test_14_a_room_cookie_works_only_on_its_own_screen_and_only_while_the_visit_lasts(site):
    s = screen(site)
    room_cookie = {k: v for k, v in s.client.jar.items() if k != "sedens_device"}
    assert room_cookie
    # The room cookie on another paired screen, on a phone, or with no device at all.
    elsewhere = Client(site.base)
    elsewhere.jar.update({**room_cookie, "sedens_device": site.screen_a2})
    phone = Client(site.base)
    phone.jar.update({**room_cookie, "motion_session": site.a["customer_token"]})
    bare = Client(site.base)
    bare.jar.update(room_cookie)
    for client in (elsewhere, phone, bare):
        status, out = client.call("GET", "/sedens/room/journey")
        assert status in (401, 403), out
        status, out = client.call("POST", "/sedens/room/journey/readiness/start", {"expect": "identified"})
        assert status in (401, 403), out
    assert s.get()["state"] == "identified"  # the real screen is unaffected
    s.act("end")
    replay = Client(site.base)
    replay.jar.update({**room_cookie, "sedens_device": site.screen_a})
    assert replay.call("GET", "/sedens/room/journey")[0] in (401, 403)


# == 15. forged analytics events =======================================================================


def test_15_screen_analytics_cannot_change_any_state(site):
    s = screen(site).choice()
    s.act("course/start", course_id=site.course)
    s.act("workout/start")
    before = (s.get()["state"], s.j["workout"]["current_index"], [x["state"] for x in s.j["workout"]["steps"]])
    for name, props in (("workout_completed", {}), ("safety_stop", {"category": "pain"}),
                        ("exercise_completed", {"position": 0}), ("scan_completed", {}),
                        ("session_feedback_submitted", {"effort": 1}), ("readiness_completed", {"outcome": "ready"})):
        status, out = s.client.call("POST", "/sedens/room/event", {"name": name, "props": props})
        assert status == 400 and out["code"] in ("server_event", "unknown_event"), (name, out)
    # The screen's own events are recorded, and change nothing either.
    for name, props in (("exercise_skipped", {"position": 0}), ("exercise_started", {"position": 1})):
        status, out = s.client.call("POST", "/sedens/room/event", {"name": name, "props": props})
        assert status == 200, out
    after = (s.get()["state"], s.j["workout"]["current_index"], [x["state"] for x in s.j["workout"]["steps"]])
    assert after == before
    assert rows(site, "SELECT id FROM p_session_exercise_events") == []
    client_names = {r["name"] for r in rows(site, "SELECT name FROM s_events WHERE source='client'")}
    assert client_names == {"exercise_skipped", "exercise_started"}
