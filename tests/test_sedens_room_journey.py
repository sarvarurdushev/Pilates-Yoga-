"""Phase 3A: the room journey the server owns.

* the state machine (``journey.TRANSITIONS``, ``expect``, revisions, a refresh);
* the journey's lifecycle: created at ``identified`` on entry with the booking,
  stale journeys closed, ended by ``room/end`` and ``room/journey/end``, restored
  ended from a backup;
* the readiness check (the questionnaire ``readiness.CURRENT`` names, today
  ``data/sedens_readiness.v1.json``): one question at a time, first Yes stops,
  follow-ups, stored version, never re-evaluated;
* the gates every later step passes: a ready readiness check, then capture consent.

Logic runs through the real ``/sedens/room`` handlers called in-process (``Room``);
route behaviour (status codes, the room cookie) runs over HTTP (``Screen``).
All people, facilities and bookings are fictional.
"""

from __future__ import annotations

import atexit
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import types

import pytest

from pilates.platform.backup import export_archive, restore_archive
from pilates.sedens import backup as sedens_backup  # noqa: F401  (registers the SEDENS archive tables)
from pilates.sedens import consent, demo, journey, plans, readiness, rooms, scans
from pilates.sedens import http as sedens_http
from pilates.sedens.util import Denied, now, uid
from sedens_support import PASSWORD, Client, facility, make_sedens, pair, room_code, running_server

KEY = "5a" * 16  # the demonstration workspace these tests copy
ORG = "demo-" + KEY
QR = "SEDENS-QR-1001"  # the fictional demo member with a booking for this room
DATA = Path(__file__).resolve().parents[1] / "data"
# The questionnaire new checks are asked (version 1.0.0, eight items, when these tests were written).
VERSION = readiness.CURRENT
QUESTIONNAIRE = json.loads((DATA / readiness.FILES[VERSION]).read_text(encoding="utf-8"))
ITEMS = [item["id"] for item in QUESTIONNAIRE["items"]]
# A follow-up whose Yes lets the check carry on (none in 1.0.0).
CONTINUE = getattr(readiness, "CONTINUE", "continue")
# Every customer action the room flow document lists (docs/SEDENS_ROOM_FLOW.md §2).
DOCUMENTED_ACTIONS = {
    "readiness/start", "readiness/answer",
    "scan/begin", "scan/view", "scan/retake", "scan/skip", "scan/again", "scan/continue",
    "plan/personalized", "plan/request", "plan/change", "plan/back", "plan/accept",
    "course/start", "workout/start", "workout/step", "workout/previous", "workout/pause", "workout/resume",
    "workout/variant", "workout/settings", "workout/unwell", "workout/end", "workout/cancel",
    "workout/feedback", "workout/another", "end",
}
# The steps that need this visit's readiness check to have ended ``ready``.
GATED = ("scan/begin", "scan/skip", "plan/personalized", "course/start", "workout/start")


# -- databases (seeding a demonstration takes seconds, so each is built once and copied) ---


_TEMPLATES: dict = {}


def _template(name, mode, build):
    if name not in _TEMPLATES:
        folder = Path(tempfile.mkdtemp(prefix=f"sedens-room-{name}-"))
        atexit.register(shutil.rmtree, folder, True)
        path = folder / "template.db"
        meta = build(make_sedens(path, mode))
        _TEMPLATES[name] = (path, meta)
    return _TEMPLATES[name]


def _copy(source, target):
    src, dst = sqlite3.connect(source), sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    return target


def demo_database(target: Path) -> Path:
    """A private copy of one seeded demonstration workspace (demo CRM, room, courses)."""
    def build(sedens):
        sedens.repo.demo_login(KEY, "admin")
        demo.ensure(sedens, ORG)
        return None

    path, _ = _template("demo", "demo_free", build)
    return _copy(path, target)


def facility_database(target: Path) -> tuple[Path, dict]:
    """A private copy of one real (non-demo) facility with two rooms and two customers."""
    path, fac = _template("facility", "local_room",
                          lambda sedens: facility(sedens, "A", rooms=("AI Private Room 01", "AI Private Room 02")))
    return _copy(path, target), fac


@pytest.fixture
def world(tmp_path):
    """A real facility on a local room computer, with a paired screen in its first room."""
    sedens_http._LIMITS.clear()  # rate limits are per process; each test starts fresh
    path, fac = facility_database(tmp_path / "facility.db")
    sedens = make_sedens(path, "local_room")
    return sedens, fac, pair(sedens, fac)


@pytest.fixture
def demo_world(tmp_path):
    """The free demonstration host: a seeded demo facility and its simulated room screen."""
    sedens_http._LIMITS.clear()
    sedens = make_sedens(demo_database(tmp_path / "demo.db"), "demo_free")
    device, _ = rooms.ensure_demo_device(sedens, ORG, demo.room_id(ORG), None)
    return sedens, device


@pytest.fixture
def demo_server(tmp_path, monkeypatch):
    sedens_http._LIMITS.clear()
    monkeypatch.setenv("SEDENS_MODE", "demo_free")
    path = demo_database(tmp_path / "server.db")
    server, base = running_server(path)
    yield base, make_sedens(path, "demo_free")
    server.shutdown()
    server.server_close()


# -- one visit, through the real handlers in-process --------------------------------------


class Room:
    """A customer's visit on a room screen, driven through ``pilates.sedens.http``'s own
    handlers (no sockets): authorization, the transaction and the view are the real ones."""

    def __init__(self, sedens, device, *, customer_token=None, method="qr", credential=QR):
        self.sedens, self.device, self.token = sedens, device, ""
        if customer_token is not None:
            method, credential = "access_code", room_code(sedens, customer_token)
        request = self._request("room/enter", {"method": method, "credential": credential})
        self.entered = sedens_http._enter(request)
        self.token = request.cookies_set[rooms.ROOM_COOKIE]
        self.ctx = rooms.authorize(sedens, device, self.token)
        self.j = self.get()

    def _request(self, action, body=None, query=None):
        request = types.SimpleNamespace(
            sedens=self.sedens, action=action, body=dict(body or {}), query=dict(query or {}),
            device_token=self.device, room_token=self.token, platform_token="", cookies_set={},
            h=types.SimpleNamespace(headers={}, client_address=("192.0.2.10", 0), sedens=self.sedens))
        request.room = lambda: rooms.authorize(self.sedens, request.device_token, request.room_token, "")
        request.cookie = lambda name, value, path, max_age: request.cookies_set.__setitem__(name, value)
        return request

    def get(self, lang="en"):
        self.j = sedens_http._room_journey(self._request("room/journey", query={"lang": lang}))["journey"]
        return self.j

    def act(self, name, lang="en", **body):
        body.setdefault("expect", self.j["state"])
        body["lang"] = lang
        out = sedens_http._journey_action(self._request("room/journey/" + name, body))
        self.j = out["journey"]
        return out["notice"]

    def refused(self, name, code, status=409, **body):
        with pytest.raises(Denied) as exc:
            self.act(name, **body)
        assert (exc.value.status, exc.value.code) == (status, code), (name, exc.value.code, str(exc.value))
        return exc.value

    def consent(self, kind, granted=True, version=None):
        body = {"kind": kind, "granted": granted, "text_version": version or consent.TEXTS[kind]["version"]}
        return sedens_http._room_consent(self._request("room/consent", body))["current"]

    def answer_all(self, yes_item=None, follow_up=None):
        """Answer in order: No to everything except ``yes_item`` (and its follow-up)."""
        while self.j["state"] == "readiness":
            nxt = self.j["readiness"]["next"]
            if nxt["follow_up"]:
                self.act("readiness/answer", item=nxt["item"], follow_up=follow_up)
            else:
                self.act("readiness/answer", item=nxt["item"], answer=nxt["item"] == yes_item)
        return self.j

    def ready(self):
        self.act("readiness/start")
        assert self.answer_all()["state"] == "scan_intro"
        return self

    def end(self):
        return sedens_http._journey_action(self._request("room/journey/end", {}))

    def row(self, db):
        return dict(db.execute("SELECT * FROM s_room_journeys WHERE room_session_id=?",
                               (self.ctx.room_session_id,)).fetchone())


def visit(world, token_key="customer_token", device=None):
    sedens, fac, screen = world
    return Room(sedens, device or screen, customer_token=fac[token_key])


def events(db, room_session_id, name):
    return [json.loads(r[0]) for r in db.execute(
        "SELECT props FROM s_events WHERE room_session_id=? AND name=? ORDER BY id", (room_session_id, name))]


# -- over HTTP ------------------------------------------------------------------------------


def ok(result):
    status, body = result
    assert status == 200, body
    return body


class Screen:
    """The simulated demonstration room screen, over real HTTP with its cookies."""

    def __init__(self, base):
        self.client = Client(base)
        ok(self.client.call("POST", "/sedens/demo/room-device", {"key": KEY}))
        self.entered = ok(self.client.call("POST", "/sedens/room/enter", {"method": "qr", "credential": QR}))
        self.j = self.get()

    def get(self, lang="en"):
        self.j = ok(self.client.call("GET", f"/sedens/room/journey?lang={lang}"))["journey"]
        return self.j

    def post(self, name, lang="en", **body):
        body.setdefault("expect", self.j["state"])
        body["lang"] = lang
        return self.client.call("POST", "/sedens/room/journey/" + name, body)

    def act(self, name, lang="en", **body):
        out = ok(self.post(name, lang, **body))
        self.j = out["journey"]
        return out["notice"]

    def consent(self, kind, granted=True):
        return ok(self.client.call("POST", "/sedens/room/consent", {
            "kind": kind, "granted": granted, "text_version": consent.TEXTS[kind]["version"]}))

    def ready(self):
        self.act("readiness/start")
        while self.j["state"] == "readiness":
            self.act("readiness/answer", item=self.j["readiness"]["next"]["item"], answer=False)
        assert self.j["state"] == "scan_intro"
        return self


# == the state machine =========================================================================


def test_the_documented_actions_are_exactly_the_registered_ones():
    assert set(journey.ACTIONS) == DOCUMENTED_ACTIONS
    assert set(journey.TRANSITIONS) == set(journey.STATES)
    assert all(targets <= set(journey.STATES) for targets in journey.TRANSITIONS.values())
    # Every state can end the visit, and nothing leaves "ended".
    assert all("ended" in journey.TRANSITIONS[s] for s in journey.STATES if s != "ended")
    assert journey.TRANSITIONS["ended"] == set()
    assert journey.TRANSITIONS["readiness_blocked"] == {"ended"}


def test_every_transition_outside_the_table_is_refused_and_changes_nothing(world):
    """All 18 x 18 (from, to) pairs against ``journey.move`` itself."""
    room = visit(world)
    sedens = room.sedens
    refused = allowed = 0
    with sedens.batch(), sedens.db() as db:
        for start in journey.STATES:
            for target in journey.STATES:
                db.execute("UPDATE s_room_journeys SET state=?, revision=7, ended_at=NULL WHERE room_session_id=?",
                           (start, room.ctx.room_session_id))
                before = room.row(db)
                if target in journey.TRANSITIONS[start]:
                    after = journey.move(db, before, target, expect=start)
                    assert (after["state"], after["revision"]) == (target, 8), (start, target)
                    assert bool(after["ended_at"]) == (target == "ended")
                    allowed += 1
                else:
                    with pytest.raises(Denied) as exc:
                        journey.move(db, before, target, expect=start)
                    assert (exc.value.status, exc.value.code) == (409, "invalid_transition"), (start, target)
                    assert room.row(db) == before
                    refused += 1
        db.execute("ROLLBACK")  # leave nothing behind
    assert allowed == sum(len(v) for v in journey.TRANSITIONS.values())
    assert refused == len(journey.STATES) ** 2 - allowed


def test_a_stale_expect_or_revision_is_journey_changed_and_changes_nothing(world):
    room = visit(world)
    sedens = room.sedens
    with sedens.db() as db:
        before = room.row(db)
    # The screen believed it was somewhere else: refused, nothing written.
    room.refused("readiness/start", "journey_changed", expect="scan_intro")
    with sedens.db() as db:
        assert room.row(db) == before
        assert readiness.latest(db, room.ctx.room_session_id) is None  # the check was not started
        assert events(db, room.ctx.room_session_id, "readiness_started") == []
    # Another window moved on with the same snapshot: the second writer loses.
    with sedens.batch(), sedens.db() as db:
        snapshot = room.row(db)
        journey.move(db, snapshot, "readiness")
        with pytest.raises(Denied) as exc:
            journey.move(db, snapshot, "ended")
        assert exc.value.code == "journey_changed"
        assert room.row(db)["state"] == "readiness"


def test_a_stale_expect_on_a_later_step_rolls_back_its_side_effects(demo_world):
    sedens, device = demo_world
    room = Room(sedens, device).ready()
    room.consent("scan_capture")
    room.act("scan/begin", source="demo_precomputed")
    revision = room.j["revision"]
    room.refused("scan/skip", "journey_changed", expect="scan_left")
    with sedens.db() as db:
        scan = scans.current(db, room.ctx)
        assert scan["state"] == "capturing"  # not abandoned
        assert room.row(db)["revision"] == revision and room.row(db)["scan_skipped"] == 0
        assert events(db, room.ctx.room_session_id, "session_choice") == []


def test_actions_from_the_wrong_state_are_refused(world):
    room = visit(world)
    # Before the readiness check: the gated steps say so, everything else is unavailable.
    for name in sorted(DOCUMENTED_ACTIONS - {"readiness/start", "end"}):
        with room.sedens.db() as db:
            before = room.row(db)
        with pytest.raises(Denied) as exc:
            room.act(name)
        expected = "readiness_required" if name in GATED else exc.value.code
        assert exc.value.status == 409 and exc.value.code in ("invalid_transition", "readiness_required"), name
        assert exc.value.code == expected, name
        with room.sedens.db() as db:
            assert room.row(db) == before, name
    # Ready, on the scan introduction: only the scan, skipping it and ending are available.
    room.ready()
    for name in sorted(DOCUMENTED_ACTIONS - {"scan/begin", "scan/skip", "end"}):
        with room.sedens.db() as db:
            before = room.row(db)
        room.refused(name, "invalid_transition")
        with room.sedens.db() as db:
            assert room.row(db) == before, name


def test_revision_increments_once_per_transition_only(world):
    room = visit(world)
    assert (room.j["state"], room.j["revision"]) == ("identified", 1)
    room.act("readiness/start")
    assert (room.j["state"], room.j["revision"]) == ("readiness", 2)
    for item in ITEMS[:-1]:  # answering is not a transition
        room.act("readiness/answer", item=item, answer=False)
        assert (room.j["state"], room.j["revision"]) == ("readiness", 2)
    room.refused("readiness/answer", "invalid", status=400, item=ITEMS[-1], answer="no")
    assert room.get()["revision"] == 2
    room.act("readiness/answer", item=ITEMS[-1], answer=False)
    assert (room.j["state"], room.j["revision"]) == ("scan_intro", 3)
    room.act("scan/skip")
    assert (room.j["state"], room.j["revision"], room.j["scan_skipped"]) == ("session_choice", 4, True)


# == the journey's lifecycle ===================================================================


def test_entry_creates_the_journey_at_identified_with_the_demo_booking(demo_server):
    base, sedens = demo_server
    screen = Screen(base)
    booking = screen.entered["decision"]["booking"]
    assert booking["exists"] and booking["starts_at"] < booking["ends_at"]
    room_session_id = screen.entered["session"]["room_session_id"]
    with sedens.db() as db:
        row = db.execute("SELECT * FROM s_room_journeys WHERE room_session_id=?", (room_session_id,)).fetchone()
        member = db.execute("SELECT student_id FROM s_room_sessions WHERE id=?", (room_session_id,)).fetchone()[0]
    assert (row["state"], row["revision"], row["student_id"], row["org_id"]) == ("identified", 1, member, ORG)
    assert (row["booking_starts_at"], row["booking_ends_at"]) == (booking["starts_at"], booking["ends_at"])
    assert row["ended_at"] is None and row["end_reason"] == ""
    welcome = screen.j["welcome"]
    assert screen.j["state"] == "identified"
    assert welcome["booking"] == {"starts_at": booking["starts_at"], "ends_at": booking["ends_at"]}
    assert set(welcome["passport"]) >= {"visits", "last_visit", "room_sessions_completed"}
    assert any(c["title"] == "4-Week Core Foundations" for c in welcome["courses"])
    # Reading the journey again does not create a second one or move it.
    shown = screen.j
    assert screen.get() == shown
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_room_journeys WHERE room_session_id=?",
                          (room_session_id,)).fetchone()[0] == 1


def test_a_refresh_reads_back_the_same_state(demo_server):
    base, _ = demo_server
    screen = Screen(base)
    screen.act("readiness/start")
    screen.act("readiness/answer", item=ITEMS[0], answer=False)
    seen = screen.j
    again = screen.get()
    assert again == seen
    assert (again["state"], again["revision"], again["readiness"]["answered"]) == ("readiness", 2, 1)
    assert again["readiness"]["next"] == {
        "item": ITEMS[1], "position": 2, "follow_up": False,
        "question": QUESTIONNAIRE["items"][1]["question"]["en"], "why": QUESTIONNAIRE["items"][1]["why"]["en"]}
    korean = screen.get("ko")
    assert korean["revision"] == 2
    assert korean["readiness"]["next"]["question"] == QUESTIONNAIRE["items"][1]["question"]["ko"]
    assert korean["readiness"]["intro"] == QUESTIONNAIRE["intro"]["ko"]
    # A brand-new browser on the same screen (same cookies) sees the same step, too.
    fresh = Client(screen.client.base)
    fresh.jar = dict(screen.client.jar)
    assert ok(fresh.call("GET", "/sedens/room/journey?lang=en"))["journey"] == seen


def test_route_errors_carry_the_journey_codes(demo_server):
    base, _ = demo_server
    screen = Screen(base)
    status, body = screen.post("readiness/answer", item=ITEMS[0], answer=False)
    assert (status, body["code"]) == (409, "invalid_transition")
    status, body = screen.post("readiness/start", expect="readiness")
    assert (status, body["code"]) == (409, "journey_changed")
    status, body = screen.post("scan/begin", source="demo_precomputed")
    assert (status, body["code"]) == (409, "readiness_required")
    status, body = screen.post("no/such-step")
    assert (status, body["code"]) == (404, "not_found")
    assert screen.get()["revision"] == 1
    # Without the room cookie there is no journey to read or move.
    stranger = Client(base)
    stranger.jar = {k: v for k, v in screen.client.jar.items() if k != rooms.ROOM_COOKIE}
    status, body = stranger.call("GET", "/sedens/room/journey")
    assert (status, body["code"]) == (401, "room_session_required")


def test_a_stale_journey_of_an_earlier_visit_is_closed_on_next_use(demo_world):
    sedens, device = demo_world
    first = Room(sedens, device).ready()
    first.consent("scan_capture")
    first.act("scan/begin", source="demo_precomputed")
    second = Room(sedens, device)  # the same member enters again: the first room session is superseded
    assert (second.j["state"], second.j["revision"]) == ("identified", 1)
    with sedens.db() as db:
        old = first.row(db)
        assert (old["state"], old["end_reason"]) == ("ended", "room_session_closed")
        assert old["ended_at"] and old["revision"] == first.j["revision"] + 1
        session = db.execute("SELECT state, end_reason FROM s_room_sessions WHERE id=?",
                             (first.ctx.room_session_id,)).fetchone()
        assert tuple(session) == ("ended", "superseded")
        scan = db.execute("SELECT state FROM s_room_scans WHERE room_session_id=?",
                          (first.ctx.room_session_id,)).fetchone()
        assert scan[0] == "abandoned"
        assert second.row(db)["state"] == "identified"
    # The superseded screen cannot move its old journey any more.
    with pytest.raises(Denied) as exc:
        first.act("scan/view", view="front")
    assert exc.value.code == "room_session_ended"


def test_a_stale_open_workout_is_kept_as_incomplete(demo_world):
    sedens, device = demo_world
    first = Room(sedens, device).ready()
    first.act("scan/skip")
    first.act("plan/personalized")
    first.act("plan/request", goal="general", duration=30, intensity="light")
    first.act("plan/accept", recommendation=first.j["recommendation"]["id"])
    first.act("workout/start")
    assert first.j["state"] == "exercise"
    Room(sedens, device)
    with sedens.db() as db:
        workout = db.execute("SELECT state, end_reason FROM s_workouts WHERE room_session_id=?",
                             (first.ctx.room_session_id,)).fetchone()
        assert tuple(workout) == ("abandoned", "room_session_closed")
        assert first.row(db)["end_reason"] == "room_session_closed"


@pytest.mark.parametrize("route", ["/sedens/room/end", "/sedens/room/journey/end"])
def test_ending_the_visit_ends_journey_session_and_cookie(demo_server, route):
    base, sedens = demo_server
    screen = Screen(base).ready()
    screen.consent("scan_capture")
    screen.act("scan/begin", source="demo_precomputed")
    room_session_id = screen.entered["session"]["room_session_id"]
    assert rooms.ROOM_COOKIE in screen.client.jar
    status, body = screen.client.call("POST", route, {})
    assert (status, body) == (200, {"ended": True})
    cleared = [c for c in screen.client.last_headers.get_all("Set-Cookie") if c.startswith(rooms.ROOM_COOKIE + "=")]
    assert cleared and all("Max-Age=0" in c for c in cleared)
    assert rooms.ROOM_COOKIE not in screen.client.jar
    with sedens.db() as db:
        row = db.execute("SELECT * FROM s_room_journeys WHERE room_session_id=?", (room_session_id,)).fetchone()
        assert (row["state"], row["end_reason"]) == ("ended", "visit_ended") and row["ended_at"]
        session = db.execute("SELECT state, end_reason FROM s_room_sessions WHERE id=?", (room_session_id,)).fetchone()
        assert tuple(session) == ("ended", "customer_ended")
        assert db.execute("SELECT state FROM s_room_scans WHERE room_session_id=?",
                          (room_session_id,)).fetchone()[0] == "abandoned"
    status, body = screen.client.call("GET", "/sedens/room/journey")
    assert (status, body["code"]) == (401, "room_session_required")
    status, body = screen.client.call("POST", "/sedens/room/journey/readiness/start", {})
    assert status == 401


def test_backup_restores_journeys_ended_and_nothing_left_open(world, tmp_path, monkeypatch):
    sedens, fac, screen = world
    second_screen = pair(sedens, fac, fac["room_ids"][1], name="Room 02 screen")
    # An earlier visit that ended normally keeps its own reason.
    earlier = visit(world).ready()
    earlier.end()
    # The customer is mid-scan in room 01 (a local room capture is waiting for photos)...
    scanning = visit(world).ready()
    scanning.consent("scan_capture")
    scanning.act("scan/begin", source="room_capture")
    assert scanning.j["state"] == "scan_front"
    # ...and another customer is mid-workout in room 02. (This real facility has no
    # reviewed SEDENS Standard content yet; the plan builder is not under test here.)
    monkeypatch.setattr(plans, "allowed_statuses", lambda demo: ["unreviewed", "sedens_reviewed", "expert_reviewed"])
    training = visit(world, "other_token", device=second_screen).ready()
    training.act("scan/skip")
    training.act("plan/personalized")
    training.act("plan/request", goal="mobility", duration=30, intensity="light")
    training.act("plan/accept", recommendation=training.j["recommendation"]["id"])
    training.act("workout/start")
    assert training.j["state"] == "exercise"

    with export_archive(sedens.repo, fac["admin"]) as archive:
        path = Path(shutil.copy(archive, tmp_path / "a.zip"))
    with sedens.db() as db:
        db.execute("DELETE FROM p_organizations WHERE id=?", (fac["org_id"],))
    owner = sedens.repo.actor(sedens.repo.create_org("Owner", f"restore-{uid()[:6]}@example.test", PASSWORD,
                                                     "Restored"))
    restore_archive(sedens.repo, owner, path)

    with sedens.db() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM s_room_journeys WHERE org_id=?", (owner.org_id,))]
        assert len(rows) == 3 and {r["state"] for r in rows} == {"ended"}
        assert sorted(r["end_reason"] for r in rows) == ["restored", "restored", "visit_ended"]
        assert all(r["ended_at"] for r in rows)
        checks = db.execute("SELECT questionnaire_version, outcome FROM s_readiness_checks WHERE org_id=?",
                            (owner.org_id,)).fetchall()
        assert sorted(tuple(c) for c in checks) == [(readiness.CURRENT, "ready")] * 3
        assert db.execute("SELECT count(*) FROM s_readiness_answers a JOIN s_readiness_checks c ON c.id=a.check_id "
                          "WHERE c.org_id=?", (owner.org_id,)).fetchone()[0] == 3 * len(ITEMS)
        restored_scans = db.execute("SELECT state, images_retained FROM s_room_scans WHERE org_id=?",
                                    (owner.org_id,)).fetchall()
        assert [tuple(s) for s in restored_scans] == [("abandoned", 0)]
        assert not db.execute("SELECT 1 FROM s_room_scan_views v JOIN s_room_scans s ON s.id=v.scan_id "
                              "WHERE s.org_id=? AND v.image_key IS NOT NULL", (owner.org_id,)).fetchone()
        workouts = db.execute("SELECT state, end_reason, segment_started_at FROM s_workouts WHERE org_id=?",
                              (owner.org_id,)).fetchall()
        assert [tuple(w) for w in workouts] == [("abandoned", "room_session_closed", None)]
        assert not db.execute("SELECT 1 FROM s_room_sessions WHERE org_id=? AND state='active'",
                              (owner.org_id,)).fetchone()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


# == readiness =================================================================================


def _blocking_cases():
    for item in QUESTIONNAIRE["items"]:
        if item.get("follow_up"):
            if item["follow_up_yes"] != CONTINUE:
                yield pytest.param(item["id"], True, item["follow_up_yes"], id=f"{item['id']}-now")
            yield pytest.param(item["id"], False, item["on_yes"], id=f"{item['id']}-not-now")
        else:
            yield pytest.param(item["id"], None, item["on_yes"], id=item["id"])


@pytest.mark.parametrize("item_id, follow_up, outcome", list(_blocking_cases()))
def test_a_yes_stops_the_check(world, item_id, follow_up, outcome):
    room = visit(world)
    room.act("readiness/start")
    index = ITEMS.index(item_id)
    for earlier in ITEMS[:index]:
        room.act("readiness/answer", item=earlier, answer=False)
    item = QUESTIONNAIRE["items"][index]
    room.act("readiness/answer", item=item_id, answer=True)
    if follow_up is not None:
        # A symptom question asks whether it is happening right now before deciding.
        assert room.j["state"] == "readiness"
        assert room.j["readiness"]["next"] == {"item": item_id, "position": index + 1, "follow_up": True,
                                               "question": item["follow_up"]["en"], "why": item["why"]["en"]}
        room.act("readiness/answer", item=item_id, follow_up=follow_up)
    assert room.j["state"] == "readiness_blocked"
    shown = room.j["readiness"]
    assert (shown["outcome"], shown["triggered_item"], shown["answered"], shown["total"]) == (
        outcome, item_id, index + 1, len(ITEMS))
    assert "next" not in shown
    copy = QUESTIONNAIRE["outcomes"][outcome]
    assert shown["result"]["title"] == copy["title"]["en"] and shown["result"]["body"] == copy["body"]["en"]
    if outcome == "do_not_start":
        assert shown["result"]["next_action"] == item["next_action"]["en"]
        assert shown["result"]["emergency"] == copy["emergency"]["en"]
    else:
        assert "119" in shown["result"]["body"] and "next_action" not in shown["result"]
    assert room.get("ko")["readiness"]["result"]["title"] == copy["title"]["ko"]
    with room.sedens.db() as db:
        check = readiness.latest(db, room.ctx.room_session_id)
        assert (check["outcome"], check["triggered_item"], check["questionnaire_version"]) == (
            outcome, item_id, readiness.CURRENT)
        assert check["completed_at"]
        stored = [tuple(r) for r in db.execute("SELECT item_id, position, answer, follow_up FROM s_readiness_answers "
                                               "WHERE check_id=? ORDER BY position", (check["id"],))]
        # Only the answers up to the deciding one are kept.
        assert stored == [(i, n, 0, None) for n, i in enumerate(ITEMS[:index])] + [
            (item_id, index, 1, None if follow_up is None else int(follow_up))]
        blocked = events(db, room.ctx.room_session_id, "readiness_blocked")
        assert blocked == [{"outcome": outcome, "item": item_id, "version": readiness.CURRENT}]
        assert events(db, room.ctx.room_session_id, "readiness_completed") == []


def test_all_no_is_ready(world):
    room = visit(world)
    room.act("readiness/start")
    assert room.j["readiness"]["next"]["position"] == 1 and room.j["readiness"]["answered"] == 0
    room.answer_all()
    assert room.j["state"] == "scan_intro"
    with room.sedens.db() as db:
        check = readiness.latest(db, room.ctx.room_session_id)
        assert (check["outcome"], check["triggered_item"], check["questionnaire_version"]) == (
            "ready", None, readiness.CURRENT)
        answers = db.execute("SELECT item_id, answer FROM s_readiness_answers WHERE check_id=? ORDER BY position",
                             (check["id"],)).fetchall()
        assert [tuple(a) for a in answers] == [(i, 0) for i in ITEMS]
        assert events(db, room.ctx.room_session_id, "readiness_completed") == [
            {"outcome": "ready", "version": readiness.CURRENT}]
        assert journey.ready(db, room.ctx)
    # There is no "modified intensity" outcome: only three exist.
    assert readiness.OUTCOMES == ("ready", "do_not_start", "urgent_help")
    assert set(QUESTIONNAIRE["outcomes"]) == set(readiness.OUTCOMES)


def test_answers_out_of_order_or_not_yes_no_are_refused(world):
    room = visit(world)
    room.act("readiness/start")
    room.refused("readiness/answer", "readiness_out_of_order", item=ITEMS[1], answer=False)
    room.refused("readiness/answer", "readiness_out_of_order", item="unknown_item", answer=False)
    for value in ("no", 0, 1, None, "false", [False]):
        room.refused("readiness/answer", "invalid", status=400, item=ITEMS[0], answer=value)
    room.act("readiness/answer", item=ITEMS[0], answer=True)
    # While a follow-up is pending, the next question is out of order and the follow-up must be a bool.
    room.refused("readiness/answer", "readiness_out_of_order", item=ITEMS[1], answer=False)
    for value in ("yes", 1, None):
        room.refused("readiness/answer", "invalid", status=400, item=ITEMS[0], follow_up=value)
    with room.sedens.db() as db:
        check = readiness.latest(db, room.ctx.room_session_id)
        stored = db.execute("SELECT item_id, answer, follow_up FROM s_readiness_answers WHERE check_id=?",
                            (check["id"],)).fetchall()
        assert [tuple(r) for r in stored] == [(ITEMS[0], 1, None)] and check["outcome"] is None
    assert room.get()["readiness"]["next"]["follow_up"] is True


def test_answering_after_the_outcome_is_refused(world):
    room = visit(world)
    room.act("readiness/start")
    room.act("readiness/answer", item=ITEMS[0], answer=True)
    room.act("readiness/answer", item=ITEMS[0], follow_up=False)
    assert room.j["state"] == "readiness_blocked"
    # The journey moved on, and the check itself refuses any further answer.
    room.refused("readiness/answer", "invalid_transition", expect="readiness", item=ITEMS[1], answer=False)
    room.refused("readiness/start", "invalid_transition")
    with room.sedens.batch(), room.sedens.db() as db:
        check = readiness.latest(db, room.ctx.room_session_id)
        for item_id, value, follow in ((ITEMS[1], False, None), (ITEMS[0], None, True)):
            with pytest.raises(Denied) as exc:
                readiness.answer(db, check, item_id, value, follow)
            assert exc.value.code == "readiness_complete"
        with pytest.raises(Denied) as exc:
            readiness._decide(db, check, "ready", None)
        assert exc.value.code == "readiness_complete"
        assert readiness.latest(db, room.ctx.room_session_id)["outcome"] == "do_not_start"
    # A ready check is just as final.
    other = visit(world, "other_token").ready()
    with other.sedens.db() as db:
        check = readiness.latest(db, other.ctx.room_session_id)
        with pytest.raises(Denied) as exc:
            readiness.answer(db, check, ITEMS[0], True)
        assert exc.value.code == "readiness_complete"


def test_an_old_check_is_never_re_evaluated(world, tmp_path, monkeypatch):
    finished = visit(world)
    finished.act("readiness/start")
    finished.answer_all(yes_item="limiting_pain_today")
    blocked_view = finished.get()["readiness"]
    sedens, fac, _ = world
    open_check = visit(world, "other_token", device=pair(sedens, fac, fac["room_ids"][1]))  # another room
    open_check.act("readiness/start")
    open_check.act("readiness/answer", item=ITEMS[0], answer=False)
    open_view = open_check.get()["readiness"]

    # Version 2 rewrites the questions, drops the item that decided the first check
    # and changes every outcome's wording.
    v2 = json.loads(json.dumps(QUESTIONNAIRE))
    v2["version"] = "sedens-readiness-2.0.0"
    v2["intro"] = {"en": "Version two.", "ko": "버전 2."}
    v2["items"] = [i for i in v2["items"] if i["id"] != "limiting_pain_today"]
    for i in v2["items"]:
        i["question"] = {"en": "V2 " + i["question"]["en"], "ko": "V2 " + i["question"]["ko"]}
    for copy in v2["outcomes"].values():
        copy["title"] = {"en": "V2 title", "ko": "V2 제목"}
    (tmp_path / "readiness.v2.json").write_text(json.dumps(v2), encoding="utf-8")
    monkeypatch.setattr(readiness, "FILES", {**readiness.FILES, v2["version"]: str(tmp_path / "readiness.v2.json")})
    monkeypatch.setattr(readiness, "CURRENT", v2["version"])
    try:
        assert finished.get()["readiness"] == blocked_view
        assert open_check.get()["readiness"] == open_view
        # The open check keeps asking its own version's questions and decides by them.
        open_check.answer_all()
        assert open_check.j["state"] == "scan_intro"
        with open_check.sedens.db() as db:
            assert readiness.latest(db, open_check.ctx.room_session_id)["questionnaire_version"] == VERSION
            stored = db.execute("SELECT count(*) FROM s_readiness_answers WHERE check_id=?",
                                (readiness.latest(db, open_check.ctx.room_session_id)["id"],)).fetchone()[0]
            assert stored == len(ITEMS)
            check = readiness.latest(db, finished.ctx.room_session_id)
            assert (check["outcome"], check["triggered_item"]) == ("do_not_start", "limiting_pain_today")
        # A new visit is asked the new version (the patch is in effect).
        fresh = visit(world)
        fresh.act("readiness/start")
        assert fresh.j["readiness"]["version"] == v2["version"]
        assert fresh.j["readiness"]["next"]["question"].startswith("V2 ")
        assert fresh.j["readiness"]["total"] == len(ITEMS) - 1
    finally:
        readiness.questionnaire.cache_clear()


def test_readiness_blocked_only_allows_ending_the_visit(world):
    room = visit(world)
    room.act("readiness/start")
    room.answer_all(yes_item="not_comfortable_alone_today")
    assert room.j["state"] == "readiness_blocked"
    for name in sorted(DOCUMENTED_ACTIONS - {"end"}):
        with pytest.raises(Denied) as exc:
            room.act(name)
        assert exc.value.status == 409 and exc.value.code in ("invalid_transition", "readiness_required"), name
        if name in GATED:
            assert exc.value.code == "readiness_required", name
    assert room.get()["state"] == "readiness_blocked"
    with room.sedens.db() as db:
        assert room.row(db)["revision"] == room.j["revision"]
    assert room.end() == {"ended": True}
    with room.sedens.db() as db:
        row = room.row(db)
        assert (row["state"], row["end_reason"]) == ("ended", "visit_ended")


@pytest.mark.parametrize("version", sorted(readiness.FILES))
def test_every_item_has_bilingual_copy_and_sources(version):
    questionnaire = json.loads((DATA / readiness.FILES[version]).read_text(encoding="utf-8"))
    assert questionnaire["version"] == version
    ids = [item["id"] for item in questionnaire["items"]]
    assert len(ids) == len(set(ids)) >= 8
    if version == "sedens-readiness-1.0.0":
        assert len(ids) == 8
    for item in questionnaire["items"]:
        for field in ("question", "why", "next_action") + (("follow_up",) if item.get("follow_up") else ()):
            for lang in ("en", "ko"):
                assert isinstance(item[field].get(lang), str) and item[field][lang].strip(), (item["id"], field, lang)
        assert item["on_yes"] == "do_not_start"
        # A follow-up decides "get help now" or, where defined, lets the check carry on; never "ready" by itself.
        assert item.get("follow_up_yes") in (("urgent_help", CONTINUE) if item.get("follow_up") else (None,)), \
            item["id"]
        assert item["sources"] and all(isinstance(s, str) and s for s in item["sources"]), item["id"]
    for outcome in readiness.OUTCOMES:
        for field, text in questionnaire["outcomes"][outcome].items():
            assert text["en"].strip() and text["ko"].strip(), (outcome, field)
    assert set(questionnaire["outcomes"]) == set(readiness.OUTCOMES)


def _known_sources() -> dict:
    """Sources defined in the questionnaire's own evidence section or in the evidence
    registry (``data/evidence_registry.json``), by id."""
    known: dict = {}

    def collect(node):
        if isinstance(node, dict):
            known.update({k: v for k, v in node.items() if isinstance(v, dict)})
        elif isinstance(node, list):
            known.update({s["id"]: s for s in node if isinstance(s, dict) and isinstance(s.get("id"), str)})

    collect(QUESTIONNAIRE.get("evidence"))
    registry = DATA / "evidence_registry.json"
    if registry.exists():
        collect(json.loads(registry.read_text(encoding="utf-8")).get("sources"))
    return known


@pytest.mark.parametrize("name", sorted(set(readiness.FILES.values())))
def test_every_item_cites_sources_that_exist_and_were_retrieved(name):
    questionnaire = json.loads((DATA / name).read_text(encoding="utf-8"))
    known = _known_sources()
    for item in questionnaire["items"]:
        assert item["sources"], item["id"]
        assert set(item["sources"]) <= set(known), (item["id"], sorted(set(item["sources"]) - set(known)))
        # At least one source was actually read; a source marked NOT RETRIEVED is never relied on alone.
        assert any(known[s].get("fetched", True) for s in item["sources"]), item["id"]
    assert set(questionnaire["stop_card"]["sources"]) <= set(known)


# == the gates =================================================================================


def test_later_steps_need_a_ready_readiness_check(world):
    room = visit(world)
    for name in GATED:  # nothing answered yet
        room.refused(name, "readiness_required", course_id="x", source="room_capture")
    room.act("readiness/start")
    room.act("readiness/answer", item=ITEMS[0], answer=False)
    for name in GATED:  # part-way through
        room.refused(name, "readiness_required", course_id="x", source="room_capture")
    blocked = visit(world, "other_token")
    blocked.act("readiness/start")
    blocked.answer_all(yes_item="professional_restriction")
    for name in GATED:  # stopped
        blocked.refused(name, "readiness_required", course_id="x", source="room_capture")
    with room.sedens.db() as db:
        assert not db.execute("SELECT 1 FROM s_room_scans").fetchone()
        assert not db.execute("SELECT 1 FROM s_workouts").fetchone()


def test_a_ready_check_of_another_visit_does_not_count(world):
    earlier = visit(world).ready()
    earlier.end()
    again = visit(world)
    with again.sedens.db() as db:
        assert not journey.ready(db, again.ctx)
    again.refused("scan/begin", "readiness_required", source="room_capture")


def _insert_consent(sedens, ctx, kind, granted, version):
    with sedens.db() as db:
        db.execute("INSERT INTO s_consents(id,org_id,user_id,kind,text_version,granted,recorded_at,room_session_id,"
                   "channel) VALUES (?,?,?,?,?,?,?,?,?)",
                   (uid(), ctx.org_id, ctx.student_id, kind, version, int(granted), now(), ctx.room_session_id, "room"))


def test_the_scan_needs_current_capture_consent(world):
    room = visit(world).ready()
    assert set(room.j["consent"]["texts"]) == set(consent.TEXTS)
    assert room.j["consent"]["current"]["scan_capture"] is None
    room.refused("scan/begin", "consent_required", source="room_capture")
    room.consent("scan_capture", granted=False)
    room.refused("scan/begin", "consent_required", source="room_capture")
    # Agreed to an older wording: asked again.
    assert consent.TEXTS["scan_capture"]["version"] != "2026-10-v1"
    _insert_consent(room.sedens, room.ctx, "scan_capture", True, "2026-10-v1")
    shown = room.get()["consent"]["current"]["scan_capture"]
    assert shown["granted"] and not shown["current_version"]
    room.refused("scan/begin", "consent_required", source="room_capture")
    # The stale wording cannot be recorded through the room either.
    with pytest.raises(Denied) as exc:
        room.consent("scan_capture", version="2026-10-v1")
    assert exc.value.code == "stale_consent_text"
    with room.sedens.db() as db:
        assert not db.execute("SELECT 1 FROM s_room_scans").fetchone()
    room.consent("scan_capture")
    room.act("scan/begin", source="room_capture")
    assert room.j["state"] == "scan_front"


@pytest.mark.parametrize("decisions, source, retained", [
    pytest.param([], "experimental_real", 0, id="no-decision"),
    pytest.param([(False, None)], "experimental_real", 0, id="declined"),
    pytest.param([(True, "2026-10-v1")], "experimental_real", 0, id="older-wording"),
    pytest.param([(True, None), (False, None)], "experimental_real", 0, id="withdrawn"),
    pytest.param([(True, None)], "experimental_real", 1, id="agreed"),
    pytest.param([(True, None)], "demo_precomputed", 0, id="agreed-but-no-photos"),
])
def test_photo_retention_is_off_unless_agreed_at_the_current_version(demo_world, decisions, source, retained):
    sedens, device = demo_world
    room = Room(sedens, device).ready()
    room.consent("scan_capture")
    for granted, version in decisions:
        if version is None:
            room.consent("scan_image_retention", granted=granted)
        else:
            _insert_consent(sedens, room.ctx, "scan_image_retention", granted, version)
    room.act("scan/begin", source=source)
    with sedens.db() as db:
        scan = scans.current(db, room.ctx)
    assert (scan["source"], scan["state"], scan["images_retained"]) == (source, "capturing", retained)


def test_the_scan_offers_only_this_hosts_sources(world, demo_world):
    local = visit(world).ready()
    assert local.j["scan_options"] == ["room_capture"]
    local.consent("scan_capture")
    local.refused("scan/begin", "invalid", status=400, source="demo_precomputed")
    sedens, device = demo_world
    hosted = Room(sedens, device).ready()
    assert hosted.j["scan_options"] == ["demo_precomputed", "experimental_real"]
    hosted.consent("scan_capture")
    hosted.refused("scan/begin", "invalid", status=400, source="room_capture")
    hosted.act("scan/begin")  # the default on the free host is the precomputed demonstration
    with sedens.db() as db:
        assert scans.current(db, hosted.ctx)["source"] == "demo_precomputed"


# == readiness 1.1.0 (after the independent citation check) =====================================


def test_a_known_condition_continues_only_with_the_care_team_s_go_ahead(world):
    """1.1.0 asks about a treated heart, kidney or blood-sugar condition. Yes asks whether
    the customer's doctor or care team said general exercise like this is fine: Yes
    carries on to the next question, No stops the check (ACSM: clearance for people
    with known disease who are not already active)."""
    assert readiness.CURRENT == "sedens-readiness-1.1.0"
    item = next(i for i in QUESTIONNAIRE["items"] if i["id"] == "known_condition")
    assert (item["on_yes"], item["follow_up_yes"]) == ("do_not_start", CONTINUE)
    index = ITEMS.index("known_condition")

    room = visit(world)
    room.act("readiness/start")
    for earlier in ITEMS[:index]:
        room.act("readiness/answer", item=earlier, answer=False)
    room.act("readiness/answer", item="known_condition", answer=True)
    assert room.j["readiness"]["next"]["follow_up"] is True
    room.act("readiness/answer", item="known_condition", follow_up=True)
    # The check goes on to the next question, then all-No is ready.
    assert room.j["state"] == "readiness" and room.j["readiness"]["next"]["item"] == ITEMS[index + 1]
    for later in ITEMS[index + 1:]:
        room.act("readiness/answer", item=later, answer=False)
    assert room.j["state"] == "scan_intro"
    with room.sedens.db() as db:
        check = readiness.latest(db, room.ctx.room_session_id)
        assert (check["outcome"], check["triggered_item"]) == ("ready", None)
        stored = dict(((r[0], (r[1], r[2])) for r in db.execute(
            "SELECT item_id, answer, follow_up FROM s_readiness_answers WHERE check_id=?", (check["id"],))))
        assert stored["known_condition"] == (1, 1) and len(stored) == len(ITEMS)


def test_readiness_1_1_says_to_call_119_at_once_and_lists_loss_of_balance():
    q = readiness.questionnaire()
    for lang in ("en", "ko"):
        action = q["stop_card"]["action"][lang]
        assert "119" in action
        assert "doesn't settle" not in action and "가라앉지 않거나" not in action
    assert any("balance" in s for s in readiness.unwell_copy("en")["urgent_signs"])
    assert any("균형" in s for s in readiness.unwell_copy("ko")["urgent_signs"])
    # Symptom items send the customer to a doctor soon, before exercising again.
    for item_id in ("chest_discomfort", "unusual_heartbeat", "faint_or_dizzy", "unusual_breathlessness"):
        item = next(i for i in q["items"] if i["id"] == item_id)
        assert "soon" in item["next_action"]["en"] and item["follow_up_yes"] == "urgent_help"


def test_a_1_0_0_check_keeps_its_version_and_outcome(world):
    room = visit(world)
    room.act("readiness/start")
    with room.sedens.batch(), room.sedens.db() as db:
        check = readiness.latest(db, room.ctx.room_session_id)
        db.execute("UPDATE s_readiness_checks SET questionnaire_version='sedens-readiness-1.0.0' WHERE id=?",
                   (check["id"],))
    old_items = [i["id"] for i in readiness.questionnaire("sedens-readiness-1.0.0")["items"]]
    assert "known_condition" not in old_items and len(old_items) == 8
    for item_id in old_items:
        room.act("readiness/answer", item=item_id, answer=False)
    assert room.j["state"] == "scan_intro"
    with room.sedens.db() as db:
        check = readiness.latest(db, room.ctx.room_session_id)
        assert (check["questionnaire_version"], check["outcome"]) == ("sedens-readiness-1.0.0", "ready")
