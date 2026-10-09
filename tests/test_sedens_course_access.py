"""The course access model: the seven examples of the Phase 2 brief, and the
rules around them (room-only playback, suspension, locations, environments).

Every answer comes from pilates.sedens.access; nothing here reads tables directly
except to set up a world."""

from __future__ import annotations

import pytest

from pilates.platform.repository import uid
from pilates.sedens import access, course_review, courses, marketplace
from pilates.sedens.util import Denied
from course_support import (add_user, affiliate, build_guided, coach_creator, customer, facility, facility_setting,
                            make_sedens, professor_studio, publish, room_for, sedens_staff)
from sedens_support import enter_with_code, pair

KRW_29000 = {"price_type": "paid", "amount_minor": 29000, "currency": "KRW", "sale_state": "active"}


@pytest.fixture()
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    _, reviewer, _ = sedens_staff(sedens)
    return sedens, reviewer, facility(sedens, "A"), facility(sedens, "B"), facility(sedens, "C")


def course_row(sedens, course_id):
    with sedens.db() as db:
        return courses.row(db, course_id)


def decide(sedens, fn, *args):
    with sedens.db() as db:
        return fn(sedens, db, *args)


def can_view(sedens, actor, course_id):
    return decide(sedens, access.can_view_metadata, actor, course_row(sedens, course_id))


def enroll_option(sedens, actor, course_id):
    return decide(sedens, access.enroll_option, actor, course_row(sedens, course_id))


def play(sedens, room, course_id):
    return decide(sedens, access.can_play_in_room, room, course_row(sedens, course_id))


# -- 1. A coach at Gym A creates a course free for Gym A only -----------------------------


def test_coach_course_free_for_own_facility_only(world):
    sedens, reviewer, a, b, _ = world
    coach = coach_creator(sedens, a)
    view = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                   [{"org_id": a["org_id"], "free": True}])
    cid = view["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True, included=True)

    assert can_view(sedens, customer(sedens, a), cid)
    option = enroll_option(sedens, customer(sedens, a), cid)
    assert option["ok"] and option["source"] == "facility_included"
    assert play(sedens, room_for(sedens, a), cid) == {"ok": True, "reason": "free_here"}

    # Gym B is not offered the course: it cannot see it, enable it, or play it.
    assert not can_view(sedens, customer(sedens, b), cid)
    assert not can_view(sedens, b["admin"], cid)
    with pytest.raises(Denied) as refused:
        facility_setting(sedens, b, cid, enabled=True)
    assert refused.value.status == 404
    assert play(sedens, room_for(sedens, b), cid)["reason"] == "not_enabled_here"


# -- 2. A coach affiliated with Gym A and Gym B: free for both --------------------------------


def test_affiliated_coach_course_free_at_both_facilities(world):
    sedens, reviewer, a, b, c = world
    coach = coach_creator(sedens, a)
    affiliate(sedens, coach, b)
    view = publish(sedens, coach, reviewer, build_guided(sedens, coach), "network")
    cid = view["course"]["id"]
    with sedens.db() as db:
        course = courses.row(db, cid)
        assert access.offered_to(sedens, db, course, a["org_id"])["basis"] == "home_facility"
        assert access.offered_to(sedens, db, course, b["org_id"])["basis"] == "approved_affiliation"
        assert access.offered_to(sedens, db, course, c["org_id"]) is None
    for fac in (a, b):
        facility_setting(sedens, fac, cid, enabled=True)
        assert play(sedens, room_for(sedens, fac), cid) == {"ok": True, "reason": "free_here"}
    assert play(sedens, room_for(sedens, c), cid)["reason"] == "not_enabled_here"


def test_affiliation_only_distributes_content(world):
    """Affiliation is content distribution: it never shows the coach B's customers."""
    sedens, reviewer, a, b, _ = world
    coach = coach_creator(sedens, a)
    affiliate(sedens, coach, b)
    with pytest.raises(Exception):
        sedens.repo.assert_student(coach, b["customer_id"])


def test_revoked_affiliation_stops_the_offer(world):
    sedens, reviewer, a, b, _ = world
    coach = coach_creator(sedens, a)
    request = affiliate(sedens, coach, b)
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach), "network")["course"]["id"]
    facility_setting(sedens, b, cid, enabled=True)
    room = room_for(sedens, b)
    assert play(sedens, room, cid)["ok"]
    from pilates.sedens import creators

    with sedens.db() as db:
        creators.revoke_affiliation(sedens, db, b["admin"], request["id"])
    assert play(sedens, room, cid)["reason"] == "not_enabled_here"


# -- 3. A professor's ₩29,000 course enabled by Gym A, not Gym B ------------------------------


def test_paid_professor_course_enabled_by_one_facility(world):
    sedens, reviewer, a, b, _ = world
    professor = professor_studio(sedens)
    view = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Mobility Foundations"),
                   "marketplace", price=KRW_29000)
    cid = view["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    with pytest.raises(Denied) as refused:
        facility_setting(sedens, a, cid, enabled=True, included=True)
    assert refused.value.code == "paid_not_includable"

    for fac in (a, b):
        assert can_view(sedens, customer(sedens, fac), cid)  # a marketplace course is visible
        assert enroll_option(sedens, customer(sedens, fac), cid)["reason"] == "purchase_required"
    assert play(sedens, room_for(sedens, a), cid)["reason"] == "purchase_required"
    assert play(sedens, room_for(sedens, b), cid)["reason"] == "not_enabled_here"
    # Outside a demonstration nothing can be bought: there is no payment provider.
    with pytest.raises(Denied) as refused:
        decide(sedens, marketplace.purchase, customer(sedens, a), cid)
    assert refused.value.code == "payments_unavailable"
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_purchases").fetchone()[0] == 0


# -- 4. A paid marketplace course, free for one partner facility --------------------------------


def test_paid_marketplace_course_free_for_one_partner(world):
    sedens, reviewer, a, b, _ = world
    professor = professor_studio(sedens)
    request = affiliate(sedens, professor, a)  # the partner approved an affiliation
    view = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Mobility Foundations"),
                   "marketplace", [{"org_id": a["org_id"], "free": True}], KRW_29000)
    cid = view["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True, included=True)
    facility_setting(sedens, b, cid, enabled=True)

    option = enroll_option(sedens, customer(sedens, a), cid)
    assert option["ok"] and option["source"] == "facility_included"
    assert play(sedens, room_for(sedens, a), cid) == {"ok": True, "reason": "free_here"}
    assert enroll_option(sedens, customer(sedens, b), cid)["reason"] == "purchase_required"
    assert play(sedens, room_for(sedens, b), cid)["reason"] == "purchase_required"
    with sedens.db() as db:
        card = access.course_card(sedens, db, customer(sedens, a), courses.row(db, cid))
        assert card["included_here"] and card["free_here"]
        assert card["price"]["amount_minor"] == 29000
    # Ending the partnership ends the free offer: it is paid there too now.
    from pilates.sedens import creators

    with sedens.db() as db:
        creators.revoke_affiliation(sedens, db, a["admin"], request["id"])
    assert play(sedens, room_for(sedens, a), cid)["reason"] == "purchase_required"


def test_creators_offer_only_to_their_own_network(world):
    sedens, reviewer, a, b, _ = world
    professor = professor_studio(sedens)
    view = build_guided(sedens, professor)
    from course_support import set_access

    with pytest.raises(Denied) as refused:
        set_access(sedens, professor, view, "marketplace", [{"org_id": a["org_id"], "free": True}], KRW_29000)
    assert refused.value.status == 404
    affiliate(sedens, professor, a)
    view = set_access(sedens, professor, view, "marketplace", [{"org_id": a["org_id"], "free": True}], KRW_29000)
    assert [f["org_id"] for f in view["facilities"]] == [a["org_id"]]


# -- 5. A facility's internal program, free at all its locations --------------------------------


def second_location(sedens, fac):
    location_id = uid()
    with sedens.db() as db:
        db.execute("INSERT INTO p_locations(id,org_id,name) VALUES (?,?,?)", (location_id, fac["org_id"], "Second"))
        room_id = uid()
        db.execute("INSERT INTO p_rooms VALUES (?,?,?,?)", (room_id, location_id, "Room 02", 1))
    student = add_user(sedens.repo, fac["org_id"], "Second customer", ["student"], location_id)
    return location_id, room_id, sedens.repo.issue(student, "student")


def test_facility_program_free_at_every_location(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    _, room_two, token_two = second_location(sedens, a)
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach, "Studio basics"), "selected_facilities",
                  [{"org_id": a["org_id"], "free": True}])["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True, included=True)
    assert play(sedens, room_for(sedens, a), cid)["ok"]
    room = enter_with_code(sedens, pair(sedens, a, room_id=room_two), token_two)["context"]
    assert play(sedens, room, cid)["ok"]
    with sedens.db() as db:
        card = access.course_card(sedens, db, customer(sedens, a), courses.row(db, cid))
    assert card["badge"] == "facility_program"


def test_location_scoped_course_stays_at_its_location(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    _, room_two, token_two = second_location(sedens, a)
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach, "Gangnam only"), "selected_facilities",
                  [{"org_id": a["org_id"], "location_id": a["location_id"], "free": True}])["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    assert play(sedens, room_for(sedens, a), cid)["ok"]
    room = enter_with_code(sedens, pair(sedens, a, room_id=room_two), token_two)["context"]
    assert play(sedens, room, cid)["reason"] == "not_enabled_here"
    assert not can_view(sedens, sedens.repo.actor(token_two), cid)


# -- 6. A free (₩0) marketplace course ---------------------------------------------------------


def test_free_marketplace_course(world):
    sedens, reviewer, a, _, c = world
    professor = professor_studio(sedens)
    cid = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Free mobility"),
                  "marketplace")["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    member = customer(sedens, c)
    option = enroll_option(sedens, member, cid)
    assert option["ok"] and option["source"] == "marketplace_free"
    decide(sedens, marketplace.enroll, member, cid)
    # Owned, but C has not enabled it: it still plays only where a facility enabled it.
    assert play(sedens, room_for(sedens, c), cid)["reason"] == "not_enabled_here"
    assert play(sedens, room_for(sedens, a), cid)["ok"]


# -- 7. A course disabled by the facility cannot be launched there ------------------------------


def test_course_disabled_by_facility_cannot_launch(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                  [{"org_id": a["org_id"], "free": True}])["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True, included=True)
    member = customer(sedens, a)
    decide(sedens, marketplace.enroll, member, cid)
    room = room_for(sedens, a)
    assert play(sedens, room, cid)["ok"]
    facility_setting(sedens, a, cid, enabled=False, included=False, featured=False)
    assert play(sedens, room, cid)["reason"] == "not_enabled_here"
    with pytest.raises(Denied) as refused:
        decide(sedens, marketplace.room_session_plan, room, cid, "any")
    assert refused.value.status == 403
    # The facility's included entitlement no longer stands either.
    with sedens.db() as db:
        assert access.entitlements(sedens, db, member.user_id, courses.row(db, cid)) == []


# -- room-only playback, suspension, environments ----------------------------------------------


def test_guided_playback_is_room_only_even_when_owned(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    view = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                   [{"org_id": a["org_id"], "free": True}])
    cid = view["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    member = customer(sedens, a)
    detail = decide(sedens, marketplace.enroll, member, cid)
    assert detail["progress"] is not None and detail["outline"]
    assert detail["play_here"] == {"ok": False, "reason": "room_only"}
    assert access.HOME_PLAYBACK is False
    # No room context, no steps.
    assert play(sedens, None, cid) == {"ok": False, "reason": "room_only"}
    session_id = detail["outline"][0]["sessions"][0]["id"]
    assert detail["outline"][0]["sessions"][0]["steps"] == 1  # a count outside the room, never the steps
    plan = decide(sedens, marketplace.room_session_plan, room_for(sedens, a), cid, session_id)
    assert plan["session"]["steps"][0]["exercise"]["ref"] == "std-breathing"
    assert plan["anatomy_label"]["en"] == "Educational anatomy — not measured muscle activation."


def test_suspended_course_disappears_everywhere(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                  [{"org_id": a["org_id"], "free": True}])["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    room = room_for(sedens, a)
    assert play(sedens, room, cid)["ok"]
    with sedens.db() as db:
        course_review.suspend(sedens, db, reviewer, {"course_id": cid, "reason": "Rights question."})
    assert play(sedens, room, cid)["reason"] == "not_available"
    assert not can_view(sedens, customer(sedens, a), cid)
    with sedens.db() as db:
        assert marketplace.catalog(sedens, db, customer(sedens, a)) == []


def test_facility_admin_never_edits_a_coach_course(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    view = build_guided(sedens, coach)
    with sedens.db() as db:
        assert not access.can_edit(sedens, db, a["admin"], courses.row(db, view["course"]["id"]))
        with pytest.raises(Denied) as refused:
            courses.update(sedens, db, a["admin"], {"id": view["course"]["id"], "revision": view["revision"],
                                                    "title": "Taken over"})
    assert refused.value.status == 404


def test_drafts_are_invisible_to_customers_and_facilities(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    view = build_guided(sedens, coach)
    cid = view["course"]["id"]
    assert not can_view(sedens, customer(sedens, a), cid)
    assert not can_view(sedens, a["admin"], cid)
    assert can_view(sedens, coach, cid)
    with sedens.db() as db:
        assert marketplace.catalog(sedens, db, customer(sedens, a)) == []
        assert marketplace.facility_courses(sedens, db, a["admin"]) == []
