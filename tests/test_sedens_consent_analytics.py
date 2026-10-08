"""Consent records and local analytics events."""

import pytest

from pilates.sedens import analytics, consent, rooms
from pilates.sedens.util import Denied
from sedens_support import enter_with_code, facility, make_sedens, pair


@pytest.fixture
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    return sedens, facility(sedens, "A")


def version(kind):
    return consent.TEXTS[kind]["version"]


def test_consent_texts_are_bilingual_and_make_no_diagnostic_promise():
    for kind, value in consent.TEXTS.items():
        assert value["en"] and value["ko"] and value["version"]
        assert "diagnos" not in value["en"].lower().replace("does not diagnose", "")


def test_consent_is_append_only_and_latest_wins(world):
    sedens, a = world
    with sedens.db() as db:
        consent.record(db, org_id=a["org_id"], user_id=a["customer_id"], kind="scan_capture", granted=True,
                       text_version=version("scan_capture"), channel="account")
        state = consent.record(db, org_id=a["org_id"], user_id=a["customer_id"], kind="scan_capture", granted=False,
                               text_version=version("scan_capture"), channel="account")
        assert state["scan_capture"]["granted"] is False and state["scan_capture"]["current_version"]
        assert state["scan_image_retention"] is None
        assert db.execute("SELECT count(*) FROM s_consents").fetchone()[0] == 2


def test_consent_requires_the_current_text_and_a_real_choice(world):
    sedens, a = world
    with sedens.db() as db:
        with pytest.raises(Denied) as exc:
            consent.record(db, org_id=a["org_id"], user_id=a["customer_id"], kind="scan_capture", granted=True,
                           text_version="old", channel="account")
        assert exc.value.code == "stale_consent_text"
        with pytest.raises(Denied):
            consent.record(db, org_id=a["org_id"], user_id=a["customer_id"], kind="scan_capture", granted="yes",
                           text_version=version("scan_capture"), channel="account")
        with pytest.raises(Denied):
            consent.record(db, org_id=a["org_id"], user_id=a["customer_id"], kind="marketing", granted=True,
                           text_version="x", channel="account")


def test_room_entry_records_the_required_events(world):
    sedens, a = world
    device = pair(sedens, a)
    entered = enter_with_code(sedens, device, a["customer_token"])
    with pytest.raises(Denied):
        enter_with_code(sedens, device, a["customer_token"], screen_token=a["admin_token"])
    rooms.end(sedens, entered["context"])
    with sedens.db() as db:
        counts = analytics.counts(db, a["org_id"])
    for name in ("device_paired", "room_entered", "room_session_started", "room_session_ended", "room_entry_denied"):
        assert counts.get(name) == 1, (name, counts)


def test_events_link_a_person_only_with_analytics_consent(world):
    sedens, a = world
    device = pair(sedens, a)
    enter_with_code(sedens, device, a["customer_token"])
    with sedens.db() as db:
        row = db.execute("SELECT user_id, room_session_id FROM s_events WHERE name='room_entered'").fetchone()
        assert row["user_id"] is None and row["room_session_id"]
        consent.record(db, org_id=a["org_id"], user_id=a["customer_id"], kind="product_analytics", granted=True,
                       text_version=version("product_analytics"), channel="account")
    enter_with_code(sedens, device, a["customer_token"])
    with sedens.db() as db:
        rows = db.execute("SELECT user_id FROM s_events WHERE name='room_entered' ORDER BY id").fetchall()
        assert rows[-1]["user_id"] == a["customer_id"]


def test_future_journey_events_are_already_valid_names():
    for name in ("room_entered", "room_session_started", "scan_started", "recommendation_shown",
                 "workout_started", "session_completed"):
        assert name in analytics.EVENTS


@pytest.mark.parametrize("props", [
    {"email": "x@y.z"}, {"customer_name": "A"}, {"note": "knee hurts"}, {"Bad Key": 1},
    {"x": "y" * 500}, {"x": {"nested": 1}}, {"x": float("nan")}, {f"k{i}": 1 for i in range(20)},
])
def test_event_properties_refuse_personal_or_free_text(props):
    with pytest.raises(Denied):
        analytics.clean_props(props)


def test_screens_may_only_send_screen_events(world):
    sedens, a = world
    with sedens.db() as db:
        with pytest.raises(Denied):
            analytics.record(db, "session_completed", org_id=a["org_id"], source="client")
        with pytest.raises(Denied):
            analytics.record(db, "made_up", org_id=a["org_id"])
        analytics.record(db, "exercise_started", org_id=a["org_id"], source="client", props={"exercise": "hundred"})


def test_analytics_are_local_only():
    import inspect

    source = inspect.getsource(analytics)
    for marker in ("urllib", "requests", "http://", "https://", "socket"):
        assert marker not in source
