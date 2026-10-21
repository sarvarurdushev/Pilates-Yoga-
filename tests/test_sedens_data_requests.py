"""Phase 4 Part 8: the facility side of customer erasure requests. The administrator of the
customer's own facility lists and decides them; nothing is deleted by SEDENS. All people and
facilities are fictional."""

from __future__ import annotations

import pytest

from pilates.sedens import http as sedens_http
from pilates.sedens.util import decode
from course_support import coach_creator, professor_studio, sedens_staff
from sedens_support import Client, facility, make_sedens, running_server


class World:
    pass


@pytest.fixture()
def world(tmp_path):
    sedens_http._LIMITS.clear()
    w = World()
    w.sedens = sedens = make_sedens(tmp_path / "s.db")
    w.root, w.reviewer, w.reviewer_token = sedens_staff(sedens)
    w.a, w.b = facility(sedens, "A"), facility(sedens, "B")
    coach_creator(sedens, w.a)
    w.prof = professor_studio(sedens)
    server, w.base = running_server(sedens.repo.path)
    yield w
    server.shutdown()


def call(world, token, path, method="GET", body=None):
    client = Client(world.base)
    if token:
        client.jar["motion_session"] = token
    if method == "GET":
        return client.call("GET", "/sedens/" + path)
    return client.call("POST", "/sedens/" + path, {"lang": "en", **(body or {})})


def ask(world, fac="a", who="customer_token", message="Please remove my Passport."):
    status, data = call(world, getattr(world, fac)[who], "passport/privacy/request", "POST", {"message": message})
    assert status == 200, data
    return data["requests"][0]["id"]


def rows(world, sql, *args):
    with world.sedens.db() as db:
        return [dict(r) for r in db.execute(sql, args)]


LIST, DECIDE = "facility/data-requests", "facility/data-requests/decide"


def test_only_the_own_facility_administrator_reads_and_decides(world):
    rid = ask(world)
    tokens = {"coach": world.a["coach_token"], "customer": world.a["customer_token"],
              "other customer": world.a["other_token"],
              "reviewer": world.reviewer_token,
              "sedens admin": world.sedens.repo.issue(world.root.user_id, world.root.role),
              "professor studio admin": world.sedens.repo.issue(world.prof.user_id, world.prof.role)}
    for who, token in tokens.items():
        status, data = call(world, token, LIST)
        assert status == 403, who
        status, data = call(world, token, DECIDE, "POST", {"id": rid, "decision": "completed"})
        assert status == 403, who
    assert call(world, None, LIST)[0] == 401
    assert call(world, None, DECIDE, "POST", {"id": rid, "decision": "completed"})[0] == 401
    assert rows(world, "SELECT state FROM s_data_requests WHERE id=?", rid) == [{"state": "received"}]
    status, data = call(world, world.a["admin_token"], LIST)
    assert status == 200 and [i["id"] for i in data["items"]] == [rid] and data["open"] == 1
    # Another facility's administrator is a facility administrator, but sees and decides nothing of this one.
    status, data = call(world, world.b["admin_token"], LIST)
    assert status == 200 and data["items"] == [] and data["open"] == 0
    status, data = call(world, world.b["admin_token"], DECIDE, "POST", {"id": rid, "decision": "completed"})
    assert (status, data["code"]) == (404, "unknown_request")
    assert rows(world, "SELECT state FROM s_data_requests WHERE id=?", rid) == [{"state": "received"}]


def test_the_list_shows_only_this_facilitys_requests_and_no_other_customer_data(world):
    mine = ask(world)
    other_facility = ask(world, "b")
    status, data = call(world, world.a["admin_token"], LIST)
    assert [i["id"] for i in data["items"]] == [mine]
    [item] = data["items"]
    assert set(item) == {"id", "kind", "state", "customer", "requested_at", "decided_at", "message", "note"}
    assert item["customer"] == "Customer A" and item["state"] == "received" and item["message"]
    assert [i["id"] for i in call(world, world.b["admin_token"], LIST)[1]["items"]] == [other_facility]
    # The organization is never taken from the request.
    status, data = call(world, world.a["admin_token"], LIST + f"?org_id={world.b['org_id']}")
    assert [i["id"] for i in data["items"]] == [mine]
    status, data = call(world, world.a["admin_token"], DECIDE, "POST",
                        {"id": other_facility, "decision": "completed", "org_id": world.b["org_id"]})
    assert (status, data["code"]) == (404, "unknown_request")
    assert rows(world, "SELECT state FROM s_data_requests WHERE id=?", other_facility) == [{"state": "received"}]


def test_decision_rules(world):
    rid = ask(world)
    admin = world.a["admin_token"]
    for body, code in (({"id": rid, "decision": "withdrawn"}, "invalid"), ({"id": rid}, "invalid"),
                       ({"id": rid, "decision": "declined"}, "note_required"),
                       ({"id": rid, "decision": "declined", "note": "   "}, "note_required"),
                       ({"id": rid, "decision": "completed", "note": "x" * 501}, "invalid"),
                       ({"id": rid, "decision": "completed", "note": ["x"]}, "invalid")):
        status, data = call(world, admin, DECIDE, "POST", body)
        assert (status, data["code"]) == (400, code), body
    for bad in (None, ["x"], "nope", ""):
        status, data = call(world, admin, DECIDE, "POST", {"id": bad, "decision": "completed"})
        assert (status, data["code"]) == (404, "unknown_request")
    assert rows(world, "SELECT state FROM s_data_requests WHERE id=?", rid) == [{"state": "received"}]
    status, data = call(world, admin, DECIDE, "POST", {"id": rid, "decision": "completed"})
    assert status == 200 and data["item"]["state"] == "completed" and data["open"] == 0
    # Only a received request can be decided.
    status, data = call(world, admin, DECIDE, "POST", {"id": rid, "decision": "declined", "note": "no"})
    assert (status, data["code"]) == (409, "not_open")
    withdrawn = ask(world)
    call(world, world.a["customer_token"], "passport/privacy/request/withdraw", "POST", {"id": withdrawn})
    status, data = call(world, admin, DECIDE, "POST", {"id": withdrawn, "decision": "completed"})
    assert (status, data["code"]) == (409, "not_open")


def test_the_customer_sees_the_decision_and_the_note(world):
    rid = ask(world)
    status, data = call(world, world.a["admin_token"], DECIDE, "POST",
                        {"id": rid, "decision": "declined", "note": "We must keep attendance records."})
    assert status == 200 and data["item"]["note"] == "We must keep attendance records."
    status, data = call(world, world.a["customer_token"], "passport/privacy?lang=en")
    [request] = data["requests"]
    assert (request["state"], request["note"]) == ("declined", "We must keep attendance records.")
    assert request["decided_at"]
    # Once decided, the customer can ask again.
    assert ask(world) != rid
    # A withdrawn-then-decided mix keeps each customer's own notes apart.
    status, data = call(world, world.a["other_token"], "passport/privacy?lang=en")
    assert data["requests"] == []


def test_a_decision_deletes_nothing_and_is_audited(world):
    from test_sedens_passport import add_scan, add_visit, add_workout

    org, me = world.a["org_id"], world.a["customer_id"]
    with world.sedens.db() as db:
        visit = add_visit(db, org, me, 2)
        add_workout(db, org, me, visit, "completed", 2, active=900, steps=("completed",) * 3)
        add_scan(db, org, me, visit, 2, images=1, sedens=world.sedens)
    tables = ["s_room_sessions", "s_workouts", "s_room_scans", "s_room_scan_views", "s_purchases", "s_enrollments",
              "s_consents", "p_users", "p_training_sessions"]
    before = {t: rows(world, f"SELECT * FROM {t}") for t in tables}
    rid = ask(world)
    status, data = call(world, world.a["admin_token"], DECIDE, "POST",
                        {"id": rid, "decision": "completed", "note": "Handled outside SEDENS."})
    assert status == 200
    assert {t: rows(world, f"SELECT * FROM {t}") for t in tables} == before
    [row] = rows(world, "SELECT * FROM s_data_requests WHERE id=?", rid)
    assert row["state"] == "completed" and row["decided_by"] == world.a["admin"].user_id and row["decided_at"]
    assert row["note"] == "Handled outside SEDENS."
    [audit] = rows(world, "SELECT * FROM p_audit WHERE action=? AND subject_id=?", "sedens:data_request:completed", rid)
    assert audit["org_id"] == org and audit["actor_id"] == world.a["admin"].user_id
    assert decode(audit["detail"], {}).get("deleted") is False
    # The scan photos are still there: only the customer deletes those.
    assert rows(world, "SELECT images_retained FROM s_room_scans WHERE student_id=?", me) == [{"images_retained": 1}]
