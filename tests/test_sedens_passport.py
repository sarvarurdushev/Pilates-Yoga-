"""Phase 4: the customer's Fitness Passport (pilates/sedens/passport.py, passport_privacy.py,
passport_http.py).

Records are inserted directly (one customer with completed, stopped, abandoned, replaced-draft and
skipped-step workouts, a seeded demonstration visit, a studio session, scans and a retained photo)
and read back through the real /sedens/passport/ routes over HTTP. The room flow that writes the
same records is tested in test_sedens_passport_integrity.py. All people, facilities and courses are
fictional.
"""

from __future__ import annotations

from datetime import timedelta
import json
import re
from zoneinfo import ZoneInfo

import pytest

from pilates.sedens import (access, consent, course_media, courses, feedback, http as sedens_http, marketplace, passport,
                            passport_privacy, scan_history, scans, standard)
from pilates.sedens.util import encode, iso, uid, utcnow
from course_support import approve, build_guided, coach_creator, professor_studio, publish, sedens_staff, submit
from sedens_support import Client, add_user, facility, make_sedens, pair, running_server
from test_sedens_room_workouts import course_visit, finish, guided_course

STD = standard.exercises()
STAFF_NOTE = "staff-note-marker-kiwi"
FORBIDDEN = ("calorie", "score", "improve", "strength", "injur", "fitness age",
             "칼로리", "점수", "개선", "근력", "부상", "체력 나이")
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00fictional-png" * 8


class World:
    pass


def values(node):
    """Every string VALUE (never a key) of a JSON document: what a customer can read."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for item in node.values():
            yield from values(item)
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from values(item)


def when(days_ago, minutes=0):
    return iso(utcnow() - timedelta(days=days_ago) + timedelta(minutes=minutes))


def add_visit(db, org_id, student, days_ago, *, origin="room", state="ended"):
    visit_id = uid()
    db.execute("INSERT INTO s_room_sessions(id,org_id,student_id,token_hash,entry_method,crm_provider,state,started_at,"
               "expires_at,ended_at,end_reason,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
               (visit_id, org_id, student, uid(), "access_code", "none", state, when(days_ago), when(days_ago, 90),
                when(days_ago, 40), "customer_ended", origin))
    return visit_id


def add_workout(db, org_id, student, visit_id, state, days_ago, *, active=0, steps=(), origin="room", kind="standard",
                started=True, end_reason=None, safety=None, effort=None, feedback=None, training_session=None,
                course=None):
    """One workout. ``steps`` is the state of each step in order (the library's exercises, in order)."""
    workout_id = uid()
    end_reason = end_reason if end_reason is not None else {
        "completed": "completed", "stopped": "safety_stop" if safety else "customer_ended",
        "abandoned": "room_session_closed"}[state]
    plan = {"kind": kind, "rules_version": "sedens-recommend-1.0.0", "goal": "core", "intensity": "moderate"}
    course = course or {}
    db.execute("INSERT INTO s_workouts(id,room_session_id,org_id,student_id,kind,course_id,course_version,"
               "course_session_id,enrollment_id,training_session_id,state,planned_seconds,active_seconds,plan,created_at,"
               "started_at,ended_at,end_reason,safety_category,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (workout_id, visit_id, org_id, student, kind, course.get("course_id"), course.get("version"),
                course.get("session_id"), course.get("enrollment_id"), training_session, state, 900, active,
                encode(plan), when(days_ago), when(days_ago) if started else None, when(days_ago, 15),
                end_reason, safety, origin))
    for position, step_state in enumerate(steps):
        entry = STD[position]
        db.execute("INSERT INTO s_workout_steps(workout_id,position,step_ref,phase,exercise_ref,state,planned_seconds,"
                   "finished_at) VALUES (?,?,?,?,?,?,?,?)",
                   (workout_id, position, entry["id"], "main", entry["catalog_key"], step_state, 60,
                    when(days_ago, 5) if step_state in ("completed", "skipped") else None))
    if effort is not None or feedback:
        feedback = feedback or {}
        db.execute("INSERT INTO s_session_feedback(workout_id,room_session_id,org_id,student_id,questions_version,locale,"
                   "effort,discomfort,discomfort_regions,discomfort_when,discomfort_strength,note,outcome,"
                   "completed_steps,skipped_steps,active_seconds,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (workout_id, visit_id, org_id, student, "sedens-session-feedback-1.0.0", "en", effort,
                    feedback.get("discomfort", "no"), encode(feedback.get("regions", [])), feedback.get("when"),
                    feedback.get("level"), feedback.get("note", ""), "completed" if state == "completed" else "stopped",
                    steps.count("completed"), steps.count("skipped"), active, when(days_ago, 20)))
    return workout_id


def add_scan(db, org_id, student, visit_id, days_ago, *, origin="room", source="room_capture", reliability="clear",
             images=0, version="version-a", model="model-a", front=-3.0, back=-3.0, state="complete",
             sedens=None):
    scan_id = uid()

    def view(value):
        return {"people": 1, "suitable": True, "metrics": {"shoulder_tilt": {
            "value": value, "unit": "deg", "confidence": 0.9, "status": "measured"}}}
    shown = {loc: {"label": None, "source": source, "quality": reliability, "rules_version": feedback.CURRENT,
                   "comparison": {"available": False, "text": f"summary-{loc}"}} for loc in ("en", "ko")}
    stored = {"measurements": {"front": view(front), "back": view(back)}, "shown": shown,
              "evaluated": [{"rule_id": "shoulder_line", "metric": "shoulder_tilt", "outcome": "shown"}]}
    db.execute("INSERT INTO s_room_scans(id,room_session_id,org_id,student_id,protocol,source,state,"
               "measurement_version,model,feedback_rules_version,reliability,summary,images_retained,started_at,"
               "completed_at,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (scan_id, visit_id, org_id, student, scans.PROTOCOL, source, state, version, model, feedback.CURRENT,
                reliability, encode(stored), int(bool(images)), when(days_ago), when(days_ago, 5), origin))
    for v in ("front", "left", "back", "right"):
        db.execute("INSERT INTO s_room_scan_views(scan_id,view,captured_at,image_key) VALUES (?,?,?,?)",
                   (scan_id, v, when(days_ago), f"{v}.png" if images else None))
    if images:
        folder = scans._folder(sedens, {"org_id": org_id, "id": scan_id})
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        for v in ("front", "left", "back", "right"):
            (folder / f"{v}.png").write_bytes(PNG)
    return scan_id


def add_studio(db, student, days_ago, coach_id=None, name="Coach A", completed=("breathing", "birdDog"), notes=""):
    session_id = uid()
    db.execute("INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
               (session_id, student, None, None, None, when(days_ago), encode(list(completed)), notes))
    db.execute("INSERT INTO p_session_recorders(session_id,user_id,name,role,recorded_at) VALUES (?,?,?,?,?)",
               (session_id, coach_id, name, "coach", when(days_ago)))
    return session_id


@pytest.fixture()
def world(tmp_path):
    sedens_http._LIMITS.clear()
    w = World()
    w.sedens = sedens = make_sedens(tmp_path / "s.db")
    w.root, w.reviewer, w.reviewer_token = sedens_staff(sedens)
    w.a, w.b = facility(sedens, "A"), facility(sedens, "B")
    # The same person (same email) as a customer of the other facility, and a second customer of A.
    with sedens.db() as db:
        email = db.execute("SELECT email FROM p_users WHERE id=?", (w.a["customer_id"],)).fetchone()[0]
    w.twin = add_user(sedens.repo, w.b["org_id"], "Customer A twin", ["student"], w.b["location_id"])
    with sedens.db() as db:
        db.execute("UPDATE p_users SET email=? WHERE id=?", (email, w.twin))
    w.twin_token = sedens.repo.issue(w.twin, "student")
    w.me, w.org = w.a["customer_id"], w.a["org_id"]
    with sedens.db() as db:
        w.ids = seed_customer(db, w.org, w.me, w.a["coach_id"], sedens)
        # What the other customers have: they must never appear in my Passport.
        o = add_visit(db, w.org, w.a["other_id"], 2)
        w.other_workout = add_workout(db, w.org, w.a["other_id"], o, "completed", 2, active=1500,
                                      steps=("completed",) * 4, effort=9, feedback={"note": "other-note-lemon"})
        w.other_scan = add_scan(db, w.org, w.a["other_id"], o, 2, images=1, sedens=sedens)
        add_studio(db, w.a["other_id"], 4, name="Other coach", notes="other-staff-note")
        t = add_visit(db, w.b["org_id"], w.twin, 2)
        w.twin_workout = add_workout(db, w.b["org_id"], w.twin, t, "completed", 2, active=999, steps=("completed",) * 2)
        w.twin_scan = add_scan(db, w.b["org_id"], w.twin, t, 2, images=1, sedens=sedens)
        b = add_visit(db, w.b["org_id"], w.b["customer_id"], 3)
        add_workout(db, w.b["org_id"], w.b["customer_id"], b, "completed", 3, active=1200, steps=("completed",) * 3)
    server, base = running_server(sedens.repo.path)
    w.base = base
    yield w
    server.shutdown()
    server.server_close()


def seed_customer(db, org, me, coach_id, sedens):
    ids = {}
    ids["v1"] = v1 = add_visit(db, org, me, 1)
    studio_linked = uid()  # the visit's shared history row, written by the room
    db.execute("INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
               (studio_linked, me, None, None, None, when(1), encode(["breathing"]), ""))
    db.execute("INSERT INTO p_session_recorders(session_id,user_id,name,role,recorded_at) VALUES (?,?,?,?,?)",
               (studio_linked, None, "SEDENS AI Private Room", "room", when(1)))
    ids["w1"] = add_workout(db, org, me, v1, "completed", 1, active=600, steps=("completed", "completed", "completed", "skipped"),
                            effort=6, training_session=studio_linked)
    ids["v2"] = v2 = add_visit(db, org, me, 3)
    ids["w2"] = add_workout(db, org, me, v2, "stopped", 3, active=120, steps=("completed", "pending", "pending"),
                            safety="pain", feedback={"discomfort": "yes", "regions": ["lower_back"], "when": "during",
                                                     "level": "mild", "note": "my-own-note-mango"})
    ids["v3"] = v3 = add_visit(db, org, me, 5)
    ids["w3"] = add_workout(db, org, me, v3, "abandoned", 5, active=60, steps=("pending", "pending"))
    ids["v4"] = v4 = add_visit(db, org, me, 8)
    ids["draft"] = add_workout(db, org, me, v4, "abandoned", 8, started=False, end_reason="replaced", steps=("pending",) * 2)
    ids["w4"] = add_workout(db, org, me, v4, "completed", 8, active=300, steps=("completed", "completed"), effort=4)
    ids["w4b"] = add_workout(db, org, me, v4, "completed", 8, active=200, steps=("completed",))
    ids["v5"] = v5 = add_visit(db, org, me, 40, origin="demo_seed")
    ids["w5"] = add_workout(db, org, me, v5, "completed", 40, active=900, steps=("completed",) * 3, origin="demo_seed")
    ids["studio"] = add_studio(db, me, 20, coach_id, "Coach A", notes=STAFF_NOTE)
    ids["scan1"] = add_scan(db, org, me, v4, 8, images=1, sedens=sedens)
    ids["scan2"] = add_scan(db, org, me, v1, 1, images=1, sedens=sedens, front=-1.0, back=-1.0)
    ids["seed_scan"] = add_scan(db, org, me, v5, 40, origin="demo_seed", source="demo_precomputed", version="demo",
                                model="demo", sedens=sedens)
    return ids


def call(world, token, path, method="GET", body=None, raw=False):
    client = Client(world.base)
    if token:
        client.jar["motion_session"] = token
    # English unless a test asks for Korean (the server's own default is Korean).
    if method == "GET" and "lang=" not in path and path != "export":
        path += ("&" if "?" in path else "?") + "lang=en"
    if method == "POST" and body is not None and "lang" not in body:
        body = {**body, "lang": "en"}
    status, data = client.call(method, "/sedens/passport/" + path, body, raw=raw)
    world.headers = client.last_headers
    return status, data


def ok(world, path, token=None, **kw):
    status, data = call(world, token or world.a["customer_token"], path, **kw)
    assert status == 200, (path, status, data)
    return data


def walk(value):
    """Every key and string in a response."""
    if isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from walk(v)
    elif isinstance(value, str):
        yield value


# == who may read it ============================================================================

GETS = ["overview", "history", "workout?id=x", "scans", "scans/compare", "programs", "achievements", "preferences",
        "privacy", "export"]
POSTS = ["preferences", "privacy/photos/delete", "privacy/request", "privacy/request/withdraw"]


def test_only_the_signed_in_customer_reads_a_passport(world):
    professor = professor_studio(world.sedens)
    coach_creator(world.sedens, world.a)
    tokens = {"coach": world.a["coach_token"], "admin": world.a["admin_token"], "reviewer": world.reviewer_token,
              "sedens admin": world.sedens.repo.issue(world.root.user_id, world.root.role),
              "creator": world.a["coach_token"],
              "professor": world.sedens.repo.issue(professor.user_id, professor.role)}
    for who, token in tokens.items():
        for path in GETS:
            status, data = call(world, token, path)
            assert (status, data["code"]) == (403, "passport_customer_only"), (who, path)
        for path in POSTS:
            status, data = call(world, token, path, "POST", {})
            assert (status, data["code"]) == (403, "passport_customer_only"), (who, path)
    for path in GETS:
        status, data = call(world, None, path)
        assert status == 401 and data["code"] == "sign_in_required", path
    for path in POSTS:
        status, data = call(world, None, path, "POST", {})
        assert status == 401, path
    # A room screen's device token is not a Passport credential.
    device = pair(world.sedens, world.a)
    client = Client(world.base)
    client.jar["sedens_device"] = device
    for path in GETS:
        assert client.call("GET", "/sedens/passport/" + path)[0] == 401, path


def test_no_route_takes_a_customer_id(world):
    victim = world.a["other_id"]
    for key in ("user_id", "student_id", "customer_id", "id"):
        data = ok(world, f"history?{key}={victim}")
        assert [i["id"] for i in data["items"] if i["kind"] == "room"] and world.other_workout not in \
            [i["id"] for i in data["items"]]
        assert ok(world, f"overview?{key}={victim}")["totals"]["completed_visits"] == 3
    # A body naming another customer changes nothing about whose preferences are saved.
    status, data = call(world, world.a["customer_token"], "preferences", "POST", {"user_id": victim, "music": "calm"})
    assert (status, data["code"]) == (400, "invalid")
    ok(world, "preferences", method="POST", body={"music": "calm"})
    assert ok(world, "preferences", token=world.a["other_token"])["preferences"]["music"] is None


def test_customers_and_facilities_never_see_each_others_records(world):
    recorders = {"Coach A", "Other coach"}
    for token, own_workout, visits, own_recorder in ((world.a["customer_token"], world.ids["w1"], 3, "Coach A"),
                                                     (world.a["other_token"], world.other_workout, 1, "Other coach"),
                                                     (world.twin_token, world.twin_workout, 1, None)):
        history = ok(world, "history", token=token)
        mine = [i["id"] for i in history["items"] if i["kind"] == "room"]
        assert own_workout in mine
        everything = {w for w in (world.ids["w1"], world.other_workout, world.twin_workout)} - {own_workout}
        assert not everything & set(mine)
        assert ok(world, "overview", token=token)["totals"]["completed_visits"] == visits
        text = json.dumps([ok(world, p, token=token) for p in ("overview", "history", "scans", "privacy")])
        # Staff notes are never shown; another customer's coach, note and records never appear.
        for marker in (STAFF_NOTE, "other-note-lemon", "other-staff-note", *(recorders - {own_recorder})):
            assert marker not in text, marker
    # A workout or scan of someone else (or of the other facility) is simply not found.
    for token in (world.a["customer_token"], world.twin_token):
        for wid in (world.other_workout, world.twin_workout if token == world.a["customer_token"] else world.ids["w1"]):
            status, data = call(world, token, f"workout?id={wid}")
            assert (status, data["code"]) == (404, "unknown_workout")
    status, data = call(world, world.a["customer_token"],
                        f"scans/compare?earlier={world.ids['scan1']}&later={world.other_scan}")
    assert (status, data["code"]) == (404, "unknown_scan")
    status, data = call(world, world.twin_token, f"scans/compare?earlier={world.twin_scan}&later={world.ids['scan2']}")
    assert (status, data["code"]) == (404, "unknown_scan")
    # The twin (same email, other facility) has only their own facility's records.
    twin = ok(world, "history", token=world.twin_token)
    assert [i["id"] for i in twin["items"]] == [world.twin_workout]


def test_responses_are_never_cached_and_the_export_is_an_attachment(world):
    for path in ("overview", "history", "scans", "programs", "achievements", "preferences", "privacy"):
        ok(world, path)
        assert world.headers["Cache-Control"] == "no-store", path
    status, body = call(world, world.a["customer_token"], "export", raw=True)
    assert status == 200
    assert world.headers["Cache-Control"] == "no-store"
    assert world.headers["Content-Disposition"].startswith('attachment; filename="sedens-passport-')
    assert world.headers["Content-Type"].startswith("application/json")
    assert world.headers["X-Content-Type-Options"] == "nosniff"
    assert json.loads(body)["format"] == "sedens-passport-export-1"
    status, data = call(world, world.a["customer_token"], "preferences", "POST", {"music": "calm"})
    assert status == 200 and world.headers["Cache-Control"] == "no-store"


# == totals, statuses and the definitions ======================================================


def test_totals_count_what_was_completed_and_nothing_else(world):
    o = ok(world, "overview")
    totals = o["totals"]
    # Completed visits: v1, v4 (two completed workouts, one visit) and the seeded v5. The stopped visit (v2),
    # the abandoned one (v3) and the replaced draft are not completed visits.
    assert totals["completed_visits"] == 3
    assert totals["workouts"] == {"completed": 4, "stopped": 1, "not_finished": 1}
    assert totals["active_minutes"] == round((600 + 120 + 60 + 300 + 200 + 900) / 60)
    assert totals["active_seconds"] == 600 + 120 + 60 + 300 + 200 + 900, "seconds are sent so a short workout can read 'under a minute'"
    assert totals["studio_sessions"] == 1
    assert totals["demo_seed"] == {"visits": 1, "workouts": 1, "scans": 1, "studio_sessions": 0}
    assert o["demo"] is False and o["deployment"]["demo_free"] is False and o["deployment"]["notice"] is None
    assert o["latest_workout"]["id"] == world.ids["w1"]
    assert [c["id"] for c in o["recent"]] == [world.ids["w1"], world.ids["w2"], world.ids["w3"]]
    assert o["last_effort"]["value"] == 6 and o["last_effort"]["workout_id"] == world.ids["w1"]
    assert o["last_effort"]["text"] == "You rated it 6/10"
    # Consistency: weeks with a completed visit out of the last 8 weeks. The completed visits were 1, 8 and 40
    # days ago; the stopped one (3 days ago) and the abandoned one (5 days ago) do not count.
    assert o["consistency"]["of"] == 8 and len(o["consistency"]["weeks"]) == 8
    zone = ZoneInfo("Asia/Seoul")

    def monday(days):
        day = (utcnow() - timedelta(days=days)).astimezone(zone).date()
        return (day - timedelta(days=day.weekday())).isoformat()
    assert {w["week_start"] for w in o["consistency"]["weeks"] if w["visited"]} == {monday(1), monday(8), monday(40)}
    assert o["consistency"]["weeks_with_visit"] == len({monday(1), monday(8), monday(40)})
    assert o["scans"]["complete"] == 3 and o["scans"]["photos_kept"] == 2 and o["scans"]["comparable_pair"] is True
    # Categories come from the Standard library's categories of completed standard steps.
    expected = {}
    for wid, completed in (("w1", 3), ("w2", 1), ("w4", 2), ("w4b", 1), ("w5", 3)):
        for entry in STD[:completed]:
            for category in entry["categories"]:
                expected[category] = expected.get(category, 0) + 1
    assert {c["id"]: c["completed"] for c in o["categories"]} == expected
    assert [c["completed"] for c in o["categories"]] == sorted((c["completed"] for c in o["categories"]), reverse=True)


def test_history_cards_use_the_defined_statuses_and_never_show_drafts(world):
    items = ok(world, "history")["items"]
    rooms_ = {i["id"]: i for i in items if i["kind"] == "room"}
    assert world.ids["draft"] not in rooms_ and len(rooms_) == 6
    assert [i["date"] for i in items] == sorted((i["date"] for i in items), reverse=True)
    w1, w2, w3 = rooms_[world.ids["w1"]], rooms_[world.ids["w2"]], rooms_[world.ids["w3"]]
    assert (w1["status"], w1["status_label"]) == ("completed", "Completed")
    assert (w2["status"], w2["status_label"], w2["ended_for_safety"]) == ("stopped", "Stopped early", True)
    assert (w3["status"], w3["status_label"]) == ("not_finished", "Not finished")
    # A skipped step is not an exercise completed.
    assert (w1["exercises_completed"], w1["exercises_skipped"], w1["exercises_total"]) == (3, 1, 4)
    assert (w2["exercises_completed"], w2["exercises_skipped"], w2["exercises_total"]) == (1, 0, 3)
    assert w3["exercises_completed"] == 0 and w3["active_minutes"] == 1
    assert w3["active_seconds"] == 60 and w1["active_seconds"] == 600
    assert w1["active_minutes"] == 10 and w1["effort"] == {"value": 6, "text": "You rated it 6/10"}
    assert w2["effort"] is None and rooms_[world.ids["w5"]]["origin"] == "demo_seed"
    assert w1["origin"] == "room" and w1["title"] == "SEDENS Standard session"
    # The Korean wording is a response of its own.
    ko = {i["id"]: i for i in ok(world, "history?lang=ko")["items"]}
    assert ko[world.ids["w2"]]["status_label"] == "도중에 멈춤" and ko[world.ids["w1"]]["effort"]["text"] == "6/10으로 평가했어요"


def test_coach_recorded_studio_sessions_are_simple_cards_and_room_sessions_are_not_repeated(world):
    items = ok(world, "history")["items"]
    studio = [i for i in items if i["kind"] == "studio"]
    # The room's own p_training_sessions row (linked to a workout) is not a second card.
    assert studio == [{"kind": "studio", "id": world.ids["studio"], "date": studio[0]["date"], "origin": "studio",
                       "recorder": "Coach A", "exercises_completed": 2}]
    assert set(studio[0]) == {"kind", "id", "date", "origin", "recorder", "exercises_completed"}  # no invented fields
    assert STAFF_NOTE not in json.dumps(ok(world, "history")) + json.dumps(ok(world, "overview"))


def test_history_pages_newest_first(world):
    first = ok(world, "history?limit=3")
    assert len(first["items"]) == 3 and first["next_before"]
    second = ok(world, "history?limit=3&before=" + first["next_before"].replace("|", "%7C"))
    third = ok(world, "history?limit=3&before=" + second["next_before"].replace("|", "%7C"))
    seen = [i["id"] for i in first["items"] + second["items"] + third["items"]]
    assert len(seen) == len(set(seen)) == 7 and third["next_before"] is None
    for bad in ("limit=0", "limit=51", "limit=many"):
        assert call(world, world.a["customer_token"], "history?" + bad)[0] == 400


def test_one_workout_in_detail(world):
    data = ok(world, f"workout?id={world.ids['w1']}")
    w = data["workout"]
    assert w["status"] == "completed" and w["origin"] == "room" and w["active_minutes"] == 10
    assert [(s["position"], s["state"]) for s in w["steps"]] == [(0, "completed"), (1, "completed"), (2, "completed"),
                                                                 (3, "skipped")]
    assert w["steps"][0]["title"] == STD[0]["title"]["en"]
    assert w["where"]["facility"] and w["feedback"]["effort"]["value"] == 6
    assert w["scan"]["id"] == world.ids["scan2"]
    # The discomfort answers (and the note) appear only on the customer's own workout, never in a list or total.
    stopped = ok(world, f"workout?id={world.ids['w2']}")["workout"]
    assert stopped["feedback"]["discomfort"] == "yes" and stopped["feedback"]["regions"] == ["lower_back"]
    assert stopped["feedback"]["note"] == "my-own-note-mango"
    for path in ("overview", "history", "scans", "programs", "achievements", "privacy"):
        text = json.dumps(ok(world, path))
        assert "my-own-note-mango" not in text and "lower_back" not in text, path
    assert call(world, world.a["customer_token"], f"workout?id={world.ids['draft']}")[0] == 404  # a draft is no record
    assert call(world, world.a["customer_token"], "workout")[0] == 404


def test_demo_marking_reaches_every_item(world):
    with world.sedens.db() as db:
        db.execute("UPDATE p_organizations SET demo=1 WHERE id=?", (world.org,))
    # (a demonstration sign-in is refused when demonstrations are off; this server has them on)
    o = ok(world, "overview")
    assert o["demo"] is True
    history = ok(world, "history")
    assert history["demo"] is True
    assert {i["origin"] for i in history["items"] if i["kind"] == "room"} == {"room", "demo_seed"}
    assert [i["origin"] for i in history["items"] if i["kind"] == "studio"] == ["demo_seed"]
    assert {s["origin"] for s in ok(world, "scans")["items"]} == {"room", "demo_seed"}
    assert o["totals"]["demo_seed"]["visits"] == 1 and o["totals"]["demo_seed"]["studio_sessions"] == 1
    for path in ("scans", "programs", "achievements", "preferences", "privacy"):
        assert ok(world, path)["demo"] is True, path
    assert ok(world, "workout?id=" + world.ids["w5"])["workout"]["origin"] == "demo_seed"


def test_a_free_demonstration_server_says_its_data_may_disappear(tmp_path):
    sedens = make_sedens(tmp_path / "d.db", "demo_free")
    fac = facility(sedens, "A")
    actor = sedens.repo.actor(fac["customer_token"])
    with sedens.db() as db:
        frame = passport.overview(sedens, db, actor, "en")["deployment"]
        ko = passport.overview(sedens, db, actor, "ko")["deployment"]
    assert frame == {"mode": "demo_free", "demo_free": True, "notice": passport.DEPLOYMENT_NOTICE["en"]}
    assert ko["notice"] == passport.DEPLOYMENT_NOTICE["ko"]
    with sedens.db() as db:
        assert passport_privacy.privacy(sedens, db, actor, "en")["deployment"]["demo_free"] is True


def test_achievements_state_only_facts(world):
    items = ok(world, "achievements")["items"]
    by_id = {i["id"]: i for i in items}
    assert set(by_id) == {"first_workout"}  # 3 completed visits so far: no milestone yet
    assert by_id["first_workout"]["origin"] == "demo_seed"  # the earliest completed workout is the seeded one
    assert all(i["date"] and i["fact"] for i in items)
    # More completed visits reach the milestones (and 4 weeks in a row).
    with world.sedens.db() as db:
        for days in (15, 22, 29, 36):
            v = add_visit(db, world.org, world.me, days)
            add_workout(db, world.org, world.me, v, "completed", days, active=60, steps=("completed",))
    items = {i["id"]: i for i in ok(world, "achievements")["items"]}
    assert set(items) == {"first_workout", "visits_5", "four_weeks"}  # 7 completed visits; no scan or effort awards
    assert items["visits_5"]["fact"] == "You have completed 5 room visits."
    assert items["four_weeks"]["fact"] == "You had a room visit in 4 weeks in a row."
    assert ok(world, "achievements?lang=ko")["items"][0]["fact"]


# == scans ======================================================================================


def test_scans_show_safe_summaries_versions_and_comparability(world):
    data = ok(world, "scans")
    items = data["items"]
    assert [i["id"] for i in items] == [world.ids["scan2"], world.ids["scan1"], world.ids["seed_scan"]]  # newest first
    newest, middle, oldest = items
    assert newest["summary"]["comparison"]["text"] == "summary-en" and newest["photos_kept"] is True
    assert (newest["measurement_version"], newest["feedback_rules_version"]) == ("version-a", feedback.CURRENT)
    assert newest["previous"] == {"id": world.ids["scan1"], "comparable": True, "reasons": []}
    assert oldest["previous"] is None and oldest["origin"] == "demo_seed"
    assert middle["previous"]["comparable"] is False
    assert [r["code"] for r in middle["previous"]["reasons"]] == ["demo_vs_real", "different_measurement_version",
                                                                  "different_model"]
    leaked = {k for k in walk(data) if k in ("image_key", "measurements", "evaluated", "analysis_id", "student_id")}
    assert leaked == set()
    assert ok(world, "scans?lang=ko")["items"][0]["summary"]["comparison"]["text"] == "summary-ko"


def test_a_comparison_or_a_refusal_with_reasons(world):
    data = ok(world, f"scans/compare?earlier={world.ids['scan1']}&later={world.ids['scan2']}")["comparison"]
    assert data["comparable"] is True and data["earlier"] == world.ids["scan1"]
    assert data["earlier_values"]["mean"] == -3.0 and data["later_values"]["mean"] == -1.0 and data["difference"] == 2.0
    # Given in the wrong order, they are still shown earlier then later.
    assert call(world, world.a["customer_token"],
                f"scans/compare?earlier={world.ids['scan1']}&later={world.ids['scan1']}")[0] == 400
    swapped = ok(world, f"scans/compare?earlier={world.ids['scan2']}&later={world.ids['scan1']}")["comparison"]
    assert swapped["earlier"] == world.ids["scan1"]
    assert ok(world, "scans/compare")["comparison"]["comparable"] is True  # the latest two
    refused = ok(world, f"scans/compare?earlier={world.ids['seed_scan']}&later={world.ids['scan2']}")["comparison"]
    assert refused["comparable"] is False and refused["message"] == "There isn't enough comparable information yet."
    assert [r["code"] for r in refused["reasons"]] == ["demo_vs_real", "different_measurement_version", "different_model"]
    assert all(r["text"] for r in refused["reasons"])
    only = ok(world, "scans/compare", token=world.a["other_token"])["comparison"]
    assert only["comparable"] is False and only["message"] == scan_history.NOT_ENOUGH["en"]
    ko = ok(world, f"scans/compare?lang=ko&earlier={world.ids['seed_scan']}&later={world.ids['scan2']}")["comparison"]
    assert ko["message"] != refused["message"]
    status, data = call(world, world.a["customer_token"], f"scans/compare?earlier={world.ids['scan1']}&later=nope")
    assert status == 404


# == courses ====================================================================================


@pytest.fixture()
def course_site(tmp_path):
    sedens_http._LIMITS.clear()
    w = World()
    w.sedens = sedens = make_sedens(tmp_path / "s.db")
    _, w.reviewer, _ = sedens_staff(sedens)
    w.a = fac = facility(sedens, "A")
    w.coach = coach = coach_creator(sedens, fac)
    w.device = pair(sedens, fac)
    server, w.base = running_server(sedens.repo.path)
    yield w
    server.shutdown()
    server.server_close()


def test_a_course_shows_the_version_the_customer_enrolled_in_while_a_newer_one_is_published(course_site):
    w = course_site
    sedens, fac, coach = w.sedens, w.a, w.coach
    view = guided_course(sedens, w.reviewer, fac, coach, "Core Basics", sessions=2)
    cid = view["course"]["id"]
    first, second = (s["id"] for s in view["modules"][0]["sessions"])
    v = course_visit(sedens, fac, w.device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    finish(v)
    v.leave()
    # Version 2: the second session is renamed and a third is added; the customer stays on version 1.
    with sedens.db() as db:
        editor = courses.editor_view(sedens, db, coach, cid)
        module = editor["modules"][0]["id"]
        editor = courses.save_session(sedens, db, coach, {"course_id": cid, "revision": editor["revision"],
                                                          "module_id": module, "id": second,
                                                          "title": "Session two, new wording", "estimated_minutes": 25})
        editor = courses.save_session(sedens, db, coach, {"course_id": cid, "revision": editor["revision"],
                                                          "module_id": module, "title": "Brand new session",
                                                          "estimated_minutes": 15})
        added = editor["modules"][0]["sessions"][-1]["id"]
        editor = courses.save_step(sedens, db, coach, {
            "course_id": cid, "revision": editor["revision"], "session_id": added, "exercise_source": "standard",
            "exercise_ref": "std-breathing", "reps": 6, "rest_seconds": 15, "customer_cue": "Breathe slowly."})
    approve(sedens, w.reviewer, submit(sedens, coach, editor)["course"]["id"])
    with sedens.db() as db:
        assert courses.row(db, cid)["published_version"] == 2

    programs = ok(w, "programs", token=fac["customer_token"])["items"]
    [p] = programs
    assert p["pinned_version"] == 1 and p["enrolled_version"] == 1
    assert p["next_session"]["session_title"] == "Session 2" and p["next_session"]["session_id"] == second
    assert p["sessions"] == {"done": 1, "total": 2, "remaining": 1}  # version 1 has two sessions, not three
    assert p["title"] == "Core Basics" and p["weeks"] == 4 and p["sessions_per_week"] == 2
    assert p["origin"]["code"] == "facility_included" and p["entitlement"]["status"] == "active"
    assert p["creator"] == {"display_name": "Minji Lee", "verification_state": coach_state(sedens, coach),
                            "verified": coach_state(sedens, coach) == "verified"}
    assert [h["session_id"] for h in p["history"]] == [first] and p["history"][0]["title"] == "Session 1"
    assert p["last_completed"]["session_id"] == first and p["history"][0]["workout_id"]
    assert p["next_eligible"] is True and p["offered_at_facility"] is True
    assert "steps" not in json.dumps(p) and "play_url" not in p  # information only: never a way to play it
    # Someone enrolling now is on version 2.
    other = course_visit(sedens, fac, pair(sedens, fac, name="Second screen"), token_key="other_token")
    other.act("course/start", course_id=cid, session_id=first)
    [q] = ok(w, "programs", token=fac["other_token"])["items"]
    assert q["pinned_version"] == 2 and q["sessions"]["total"] == 3
    # The overview names the same pinned next session.
    o = ok(w, "overview", token=fac["customer_token"])
    assert o["next_session"]["pinned_version"] == 1 and o["next_session"]["session_title"] == "Session 2"
    assert o["current_program"]["course_id"] == cid
    # Achievements: first course session.
    ach = {i["id"] for i in ok(w, "achievements", token=fac["customer_token"])["items"]}
    assert {"first_course_session", "first_workout"} <= ach


def coach_state(sedens, coach):
    with sedens.db() as db:
        return db.execute("SELECT verification_state FROM s_creator_profiles WHERE user_id=?", (coach.user_id,)).fetchone()[0]


def test_the_origin_and_status_of_a_course_come_from_its_entitlement(course_site):
    w = course_site
    sedens, fac, coach = w.sedens, w.a, w.coach
    view = guided_course(sedens, w.reviewer, fac, coach, "Core Basics", sessions=1)
    cid = view["course"]["id"]
    v = course_visit(sedens, fac, w.device)
    v.act("course/start", course_id=cid)  # enrolls on first play, through the facility's included offer
    token = fac["customer_token"]
    [p] = ok(w, "programs", token=token)["items"]
    assert (p["origin"]["code"], p["entitlement"]["status"]) == ("facility_included", "active")
    expected = {"facility_free": "Free at your facility", "marketplace_free": "Free course",
                "demo_purchase": "Demo purchase (no real payment)", "facility_included": "Included by your facility"}
    for source, label in expected.items():
        with sedens.db() as db:
            db.execute("UPDATE s_entitlements SET source=? WHERE user_id=? AND course_id=?",
                       (source, fac["customer_id"], cid))
        [p] = ok(w, "programs", token=token)["items"]
        assert p["origin"] == {"code": source, "label": label}, source
    ko = ok(w, "programs?lang=ko", token=token)["items"][0]
    assert ko["origin"]["label"] == passport.ORIGINS["facility_included"]["ko"]
    # Status is the stored entitlement (revoked_at), not what a catalogue card says.
    with sedens.db() as db:
        db.execute("UPDATE s_entitlements SET revoked_at=? WHERE user_id=? AND course_id=?",
                   (iso(utcnow()), fac["customer_id"], cid))
    [p] = ok(w, "programs", token=token)["items"]
    assert p["entitlement"]["status"] == "revoked" and p["next_eligible"] is False and p["entitlement"]["label"]
    assert ok(w, "overview", token=token)["current_program"] is None


def test_a_course_whose_entitlement_no_longer_stands_is_not_shown_as_included(course_site):
    """Status follows the same test as playback: a stored entitlement that is not revoked
    can still have ended (facility stopped offering it, or a demo purchase was refunded)."""
    w = course_site
    sedens, fac, coach = w.sedens, w.a, w.coach
    cid = guided_course(sedens, w.reviewer, fac, coach, "Core Basics", sessions=1)["course"]["id"]
    course_visit(sedens, fac, w.device).act("course/start", course_id=cid)
    token, me, org = fac["customer_token"], fac["customer_id"], fac["org_id"]

    def shown():
        [p] = ok(w, "programs", token=token)["items"]
        return p

    def standing(p):
        assert p["entitlement"]["status"] == "active" and p["next_eligible"] is True
        assert ok(w, "overview", token=token)["current_program"]["course_id"] == cid

    def ended(p):
        assert p["entitlement"]["status"] == "ended" and p["next_eligible"] is False
        assert p["entitlement"]["label"] == passport.ENTITLEMENT["ended"]["en"]
        assert ok(w, "overview", token=token)["current_program"] is None

    def setting(**values):
        with sedens.db() as db:
            for column, value in values.items():
                db.execute(f"UPDATE s_facility_course_settings SET {column}=? WHERE org_id=? AND course_id=?",
                           (value, org, cid))

    standing(shown())
    setting(enabled=0)
    ended(shown())
    setting(enabled=1)
    standing(shown())
    setting(included=0)
    ended(shown())
    setting(included=1)
    standing(shown())
    # A demonstration purchase stands only while it is completed.
    purchase = "purchase-" + cid
    with sedens.db() as db:
        db.execute("INSERT INTO s_purchases(id,user_id,org_id,course_id,provider,amount_minor,currency,state,created_at) "
                   "VALUES (?,?,?,?,'demo',1000,'KRW','demo_refunded',?)", (purchase, me, org, cid, iso(utcnow())))
        db.execute("UPDATE s_entitlements SET source='demo_purchase', purchase_id=? WHERE user_id=? AND course_id=?",
                   (purchase, me, cid))
    ended(shown())
    with sedens.db() as db:
        db.execute("UPDATE s_purchases SET state='demo_completed' WHERE id=?", (purchase,))
    standing(shown())


def test_a_free_marketplace_course_and_its_cover(course_site):
    w = course_site
    sedens = w.sedens
    professor = professor_studio(sedens)
    built = build_guided(sedens, professor, "Mobility Foundations", sessions=1)
    with sedens.db() as db:
        picture = course_media.add_repo_asset(sedens, db, professor, "repo-bridge")
        built = courses.update(sedens, db, professor, {"id": built["course"]["id"], "revision": built["revision"],
                                                       "cover_media_id": picture["id"]})
    pub = publish(sedens, professor, w.reviewer, built, "marketplace")
    cid = pub["course"]["id"]
    with sedens.batch(), sedens.db() as db:
        marketplace.enroll(sedens, db, sedens.repo.actor(w.a["customer_token"]), cid)
    [p] = ok(w, "programs", token=w.a["customer_token"])["items"]
    assert p["origin"]["code"] == "marketplace_free" and p["creator"]["display_name"] == "Dr. Example Mobility"
    assert p["cover_url"] == f"/sedens/media/file?id={picture['id']}"
    # The cover is a URL the existing media rules decide on, never bytes in the Passport.
    client = Client(w.base)
    client.jar["motion_session"] = w.a["customer_token"]
    status, body = client.call("GET", p["cover_url"], raw=True)
    assert status == 200
    assert Client(w.base).call("GET", p["cover_url"], raw=True)[0] == 404  # signed out: still refused


def test_the_passport_never_offers_playback_and_the_room_routes_still_refuse(course_site):
    w = course_site
    sedens, fac = w.sedens, w.a
    view = guided_course(sedens, w.reviewer, fac, w.coach, "Core Basics", sessions=1)
    cid, session = view["course"]["id"], view["modules"][0]["sessions"][0]["id"]
    v = course_visit(sedens, fac, w.device)
    v.act("course/start", course_id=cid)
    v.leave()  # the visit is over: the customer is now only on their phone
    phone = Client(w.base)
    phone.jar["motion_session"] = fac["customer_token"]
    for path in ("overview", "programs", "history"):
        text = json.dumps(phone.call("GET", "/sedens/passport/" + path)[1])
        assert "/sedens/media/file" not in text and "video" not in text.lower(), path
    # No room session: the room routes and the course files refuse the customer's phone.
    assert phone.call("POST", "/sedens/room/course/session", {"course_id": cid, "session_id": session})[0] in (401, 403)
    assert phone.call("POST", "/sedens/room/course/complete", {"course_id": cid, "session_id": session})[0] in (401, 403)
    assert phone.call("GET", "/sedens/room/courses")[0] in (401, 403)
    with sedens.db() as db:
        files = [r[0] for r in db.execute("SELECT id FROM s_media_objects")]
    for media_id in files:
        assert phone.call("GET", f"/sedens/media/file?id={media_id}", raw=True)[0] == 404
    with sedens.db() as db:
        course = courses.row(db, cid)
        assert access.can_play_in_room(sedens, db, None, course) == {"ok": False, "reason": "room_only"}


# == preferences and privacy ====================================================================


def test_preferences_are_the_customers_own_and_validated(world):
    first = ok(world, "preferences")
    assert first["preferences"] == {"exercise_style": None, "intensity": None, "music": None, "language": None,
                                    "updated_at": None}
    assert first["options"]["music"] == ["off", "calm", "focus", "energy"]
    saved = ok(world, "preferences", method="POST", body={"exercise_style": "mobility", "music": "focus", "lang": "en"})
    assert saved["preferences"]["exercise_style"] == "mobility" and saved["preferences"]["music"] == "focus"
    again = ok(world, "preferences", method="POST", body={"intensity": "light"})  # the rest stays
    assert again["preferences"]["music"] == "focus" and again["preferences"]["intensity"] == "light"
    cleared = ok(world, "preferences", method="POST", body={"music": None})
    assert cleared["preferences"]["music"] is None and cleared["preferences"]["intensity"] == "light"
    for bad in ({"music": "loud"}, {"intensity": "hard"}, {"language": "fr"}, {"exercise_style": 3}, {"nope": 1}):
        status, data = call(world, world.a["customer_token"], "preferences", "POST", bad)
        assert (status, data["code"]) == (400, "invalid"), bad
    assert ok(world, "preferences", token=world.twin_token)["preferences"]["intensity"] is None
    with world.sedens.db() as db:
        rows = db.execute("SELECT user_id, org_id FROM s_passport_preferences").fetchall()
    assert [tuple(r) for r in rows] == [(world.me, world.org)]


def test_withdrawing_retention_uses_the_consents_route_and_the_privacy_page_shows_it(world):
    privacy = ok(world, "privacy")
    assert privacy["photos"] == {"retained": 8, "scans": 2} and privacy["requests"] == []
    assert privacy["consent"]["current"]["scan_image_retention"] is None
    assert privacy["stored"] and "retention policy" in privacy["erasure_notice"]
    version = consent.TEXTS["scan_image_retention"]["version"]
    client = Client(world.base)
    client.jar["motion_session"] = world.a["customer_token"]
    for granted in (True, False):
        status, data = client.call("POST", "/sedens/consents", {"kind": "scan_image_retention", "granted": granted,
                                                                "text_version": version})
        assert status == 200, data
    current = ok(world, "privacy")["consent"]["current"]["scan_image_retention"]
    assert current["granted"] is False and current["channel"] == "account"
    with world.sedens.db() as db:
        history = [(r["granted"], r["channel"]) for r in db.execute(
            "SELECT * FROM s_consents WHERE user_id=? AND kind='scan_image_retention' ORDER BY rowid", (world.me,))]
    assert history == [(1, "account"), (0, "account")]  # a withdrawal is a new row; the history stays
    # It reaches future scans only: photos already kept stay until the customer deletes them.
    assert ok(world, "privacy")["photos"]["retained"] == 8


def photo_files(world, scan_id, org=None):
    folder = scans._folder(world.sedens, {"org_id": org or world.org, "id": scan_id})
    return sorted(p.name for p in folder.glob("*.png")) if folder.exists() else []


def test_deleting_photos_removes_only_this_customers_files_and_keeps_measurements(world):
    mine = [world.ids["scan1"], world.ids["scan2"]]
    assert all(len(photo_files(world, s)) == 4 for s in mine)
    data = ok(world, "privacy/photos/delete", method="POST", body={})
    assert data["deleted_photos"] == 8 and data["scans"] == 2 and data["photos"] == {"retained": 0, "scans": 0}
    assert all(photo_files(world, s) == [] for s in mine)
    # Another customer of the same facility, and the same person at the other facility, keep theirs.
    assert len(photo_files(world, world.other_scan)) == 4
    assert len(photo_files(world, world.twin_scan, world.b["org_id"])) == 4
    with world.sedens.db() as db:
        rows = {r["id"]: dict(r) for r in db.execute("SELECT * FROM s_room_scans")}
        keys = db.execute("SELECT count(*) FROM s_room_scan_views WHERE image_key IS NOT NULL AND scan_id IN (?,?)",
                          mine).fetchone()[0]
        other_keys = db.execute("SELECT count(*) FROM s_room_scan_views WHERE image_key IS NOT NULL AND scan_id IN (?,?)",
                                (world.other_scan, world.twin_scan)).fetchone()[0]
    assert keys == 0 and other_keys == 8
    assert all(rows[s]["images_retained"] == 0 for s in mine)
    assert rows[world.other_scan]["images_retained"] == 1 and rows[world.twin_scan]["images_retained"] == 1
    # The measurements and the summary shown stay.
    scans_ = ok(world, "scans")["items"]
    assert len(scans_) == 3 and all(not s["photos_kept"] for s in scans_)
    assert scans_[0]["previous"]["comparable"] is True
    assert ok(world, f"scans/compare?earlier={mine[0]}&later={mine[1]}")["comparison"]["comparable"] is True
    # Asking again deletes nothing more.
    again = ok(world, "privacy/photos/delete", method="POST", body={})
    assert again["deleted_photos"] == 0
    assert len(photo_files(world, world.other_scan)) == 4


def test_a_scan_still_being_taken_keeps_its_photos(world):
    with world.sedens.db() as db:
        v = add_visit(db, world.org, world.me, 0, state="active")
        live = add_scan(db, world.org, world.me, v, 0, images=1, state="capturing", sedens=world.sedens)
    ok(world, "privacy/photos/delete", method="POST", body={})
    assert len(photo_files(world, live)) == 4


def test_an_erasure_request_is_only_recorded_and_can_be_withdrawn(world):
    before = ok(world, "overview")["totals"]
    data = ok(world, "privacy/request", method="POST", body={"message": "Please remove my Passport."})
    [request] = data["requests"]
    assert request["state"] == "received" and request["kind"] == "erase_passport"
    assert request["message"] == "Please remove my Passport." and "retention policy" in data["erasure_notice"]
    # Asking twice returns the same open request.
    assert ok(world, "privacy/request", method="POST", body={})["requests"][0]["id"] == request["id"]
    assert len(ok(world, "privacy")["requests"]) == 1
    # Nothing was deleted.
    assert ok(world, "overview")["totals"] == before
    with world.sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_workouts WHERE student_id=?", (world.me,)).fetchone()[0] == 7
    # Another customer cannot withdraw it; the customer can.
    status, data = call(world, world.a["other_token"], "privacy/request/withdraw", "POST", {"id": request["id"]})
    assert (status, data["code"]) == (404, "no_open_request")
    done = ok(world, "privacy/request/withdraw", method="POST", body={"id": request["id"]})
    assert done["requests"][0]["state"] == "withdrawn"
    status, data = call(world, world.a["customer_token"], "privacy/request/withdraw", "POST", {})
    assert (status, data["code"]) == (404, "no_open_request")
    status, data = call(world, world.a["customer_token"], "privacy/request/withdraw", "POST", {"id": ["x"]})
    assert (status, data["code"]) == (404, "no_open_request")
    assert call(world, world.a["customer_token"], "privacy/request", "POST", {"message": "x" * 501})[0] == 400
    # After a withdrawal a new request can be made.
    assert ok(world, "privacy/request", method="POST", body={})["requests"][0]["state"] == "received"
    with world.sedens.db() as db:
        mine = [dict(r) for r in db.execute("SELECT user_id, org_id, state FROM s_data_requests ORDER BY rowid")]
    assert mine == [{"user_id": world.me, "org_id": world.org, "state": "withdrawn"},
                    {"user_id": world.me, "org_id": world.org, "state": "received"}]


def test_the_export_holds_only_their_own_data(world):
    ok(world, "preferences", method="POST", body={"music": "calm"})
    ok(world, "privacy/request", method="POST", body={})
    version = consent.TEXTS["scan_capture"]["version"]
    client = Client(world.base)
    client.jar["motion_session"] = world.a["customer_token"]
    assert client.call("POST", "/sedens/consents", {"kind": "scan_capture", "granted": True, "text_version": version})[0] == 200
    status, body = call(world, world.a["customer_token"], "export", raw=True)
    assert status == 200
    data = json.loads(body)
    text = body.decode()
    assert {w["id"] for w in data["workouts"]} == {world.ids[k] for k in ("w1", "w2", "w3", "draft", "w4", "w4b", "w5")}
    w1 = next(w for w in data["workouts"] if w["id"] == world.ids["w1"])
    assert [s["state"] for s in w1["steps"]] == ["completed", "completed", "completed", "skipped"]
    assert w1["feedback"]["effort"] == 6 and "plan" not in w1
    w2 = next(w for w in data["workouts"] if w["id"] == world.ids["w2"])
    assert w2["feedback"]["note"] == "my-own-note-mango"  # their own words come back to them
    assert [c["kind"] for c in data["consents"]] == ["scan_capture"] and data["consents"][0]["channel"] == "account"
    assert len(data["room_visits"]) == 5 and len(data["scans"]) == 3
    scan = next(s for s in data["scans"] if s["id"] == world.ids["scan2"])
    assert scan["measurement_version"] == "version-a" and scan["model"] == "model-a"
    assert scan["feedback_rules_version"] == feedback.CURRENT and scan["measurements"]["front"]
    assert scan["observations"] == [] and scan["images_retained"] == 1
    assert data["preferences"]["music"] == "calm" and data["data_requests"][0]["state"] == "received"
    assert data["photos"]["kept"] == 8 and "not supported yet" in data["photos"]["note"]
    assert data["studio_sessions"] == [{"id": world.ids["studio"], "date": data["studio_sessions"][0]["date"],
                                        "recorded_by": "Coach A", "exercises_completed": 2}]
    assert data["account"]["facility"] and data["account"]["email"]
    # Excluded: other people's data, staff notes, photo files and where they are kept.
    for marker in (STAFF_NOTE, "other-note-lemon", "other-staff-note", "Other coach", world.other_workout, world.twin_workout,
                   world.other_scan, world.twin_scan, "image_key", "front.png", "token_hash", ".sedens-media"):
        assert marker not in text, marker
    assert PNG.decode("latin-1") not in text


def test_no_response_uses_scores_calories_or_medical_wording(world):
    ok(world, "preferences", method="POST", body={"music": "calm"})
    ok(world, "privacy/request", method="POST", body={})
    for lang in ("en", "ko"):
        for path in ("overview", "history", "scans", "scans/compare", "programs", "achievements", "preferences", "privacy",
                     f"workout?id={world.ids['w1']}", f"workout?id={world.ids['w2']}", f"workout?id={world.ids['w5']}"):
            sep = "&" if "?" in path else "?"
            data = ok(world, f"{path}{sep}lang={lang}")
            text = "\n".join(values(data)).lower()
            for word in FORBIDDEN:
                assert word not in text, (lang, path, word)
            # No health scores or percentages either.
            assert not re.search(r'"[a-z_]*(score|grade|rating)[a-z_]*"', json.dumps(data).lower()), (lang, path)
    export = json.loads(call(world, world.a["customer_token"], "export", raw=True)[1])
    # The exported scan summary carries the one fixed disclaimer ("not about pain, injury or your health").
    meaning = {feedback.rules()["meaning"][lang] for lang in ("en", "ko")}
    text = "\n".join(v for v in values(export) if v not in meaning).lower()
    for word in FORBIDDEN:
        assert word not in text, word
    shown = [w for w in export["workouts"] if w["feedback"]]
    assert all("discomfort_strength" not in w["feedback"] and "discomfort_level" in w["feedback"] for w in shown)
    detail = ok(world, f"workout?id={world.ids['w2']}")["workout"]["feedback"]
    assert detail["discomfort_level"] == "mild" and "level" not in detail


# == backup ====================================================================================


def test_passport_records_survive_a_facility_backup_and_restore(tmp_path):
    import shutil

    from pilates.platform.backup import export_archive, restore_archive
    from sedens_support import PASSWORD

    sedens = make_sedens(tmp_path / "s.db")
    fac = facility(sedens, "A")
    me, org = fac["customer_id"], fac["org_id"]
    with sedens.db() as db:
        seed = seed_customer(db, org, me, fac["coach_id"], sedens)
        passport_privacy.save_preferences(sedens, db, sedens.repo.actor(fac["customer_token"]), "en", {"music": "calm"})
        passport_privacy.request_erasure(sedens, db, sedens.repo.actor(fac["customer_token"]), "en", {"message": "hello"})
    with export_archive(sedens.repo, fac["admin"]) as archive:
        shutil.copy(archive, tmp_path / "a.zip")
    with sedens.db() as db:
        db.execute("DELETE FROM p_organizations WHERE id=?", (org,))
    owner = sedens.repo.actor(sedens.repo.create_org("Owner", "restore-passport@example.test", PASSWORD, "Restored"))
    restore_archive(sedens.repo, owner, tmp_path / "a.zip")
    with sedens.db() as db:
        customer = db.execute("SELECT id FROM p_users WHERE org_id=? AND name='Customer A'", (owner.org_id,)).fetchone()[0]
        origins = {r[0]: r[1] for r in db.execute("SELECT id, origin FROM s_workouts WHERE org_id=?", (owner.org_id,))}
        scan_origins = sorted(r[0] for r in db.execute("SELECT origin FROM s_room_scans WHERE org_id=?", (owner.org_id,)))
        visits = sorted(r[0] for r in db.execute("SELECT origin FROM s_room_sessions WHERE org_id=?", (owner.org_id,)))
        prefs = db.execute("SELECT user_id, org_id, music FROM s_passport_preferences").fetchone()
        request = db.execute("SELECT user_id, org_id, state FROM s_data_requests").fetchone()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    assert sorted(origins.values()) == ["demo_seed"] + ["room"] * 6 and scan_origins == ["demo_seed", "room", "room"]
    assert visits == ["demo_seed"] + ["room"] * 4
    assert tuple(prefs) == (customer, owner.org_id, "calm") and tuple(request) == (customer, owner.org_id, "received")
    assert seed  # the restored customer reads their own Passport
    restored = sedens.repo.actor(sedens.repo.issue(customer, "student"))
    with sedens.db() as db:
        overview = passport.overview(sedens, db, restored, "en")
    assert overview["totals"]["completed_visits"] == 3 and overview["totals"]["demo_seed"]["visits"] == 1
    # The room welcome uses the same count of completed visits as the Passport.
    with sedens.db() as db:
        shown = passport.summary(db, customer)
    assert shown["completed_visits"] == overview["totals"]["completed_visits"]


def test_deleting_photos_also_removes_leftover_files_of_a_scan_marked_retained_without_keys(world):
    mine = world.ids["scan1"]
    with world.sedens.db() as db:
        db.execute("UPDATE s_room_scan_views SET image_key=NULL WHERE scan_id=?", (mine,))
    folder = scans._folder(world.sedens, {"org_id": world.org, "id": mine})
    (folder / "stray.png").write_bytes(PNG)
    assert folder.exists()
    ok(world, "privacy/photos/delete", method="POST", body={})
    assert not folder.exists()
    assert len(photo_files(world, world.other_scan)) == 4
    assert len(photo_files(world, world.twin_scan, world.b["org_id"])) == 4
