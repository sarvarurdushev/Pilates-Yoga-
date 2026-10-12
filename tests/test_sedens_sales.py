"""Pausing new sales: an operational control of the course's creator, separate from
SEDENS review. It never changes the approved content, the published version or anyone's
existing access, and SEDENS suspension still takes the whole course down."""

from __future__ import annotations

import pytest

from pilates.sedens import access, course_review, courses, demo, demo_marketplace, marketplace, sales
from pilates.sedens.util import Denied
from course_support import approve, submit
from sedens_support import add_user, make_sedens

KEY = "e" * 32
ORG = "demo-" + KEY


@pytest.fixture()
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    sedens.repo.logout(sedens.repo.demo_login(KEY, "admin"))
    demo.ensure(sedens, ORG)
    people = {}
    for role in ("professor", "reviewer"):
        user_id, platform_role = demo_marketplace.actor_for(ORG, role)
        people[role] = sedens.repo.actor(sedens.repo.issue(user_id, platform_role))
    buyer = sedens.repo.actor(sedens.repo.demo_login(KEY, "student"))
    with sedens.repo.db() as db:
        location = db.execute("SELECT location_id FROM p_student_locations WHERE student_id=?",
                              (buyer.user_id,)).fetchone()
    newcomer_id = add_user(sedens.repo, ORG, "Newcomer", ["student"], location[0] if location else None)
    newcomer = sedens.repo.actor(sedens.repo.issue(newcomer_id, "student"))
    with sedens.db() as db:
        course = next(c for c in marketplace.catalog(sedens, db, buyer) if c["title"] == "Mobility Foundations")
    return sedens, people, buyer, newcomer, course["id"]


def call(sedens, fn, *args):
    with sedens.batch(), sedens.db() as db:
        return fn(sedens, db, *args)


def row(sedens, course_id):
    with sedens.db() as db:
        return courses.row(db, course_id)


def test_a_creator_pauses_and_resumes_new_sales_without_a_review(world):
    sedens, people, buyer, newcomer, cid = world
    professor = people["professor"]
    call(sedens, marketplace.purchase, buyer, cid)
    before = row(sedens, cid)
    with sedens.db() as db:
        snapshot = courses.version(db, cid, before["published_version"])["snapshot_sha256"]

    state = call(sedens, sales.set_paused, professor, {"id": cid, "paused": True})
    assert state["paused"] and state["can_resume"] and not state["can_pause"]
    after = row(sedens, cid)
    # Nothing reviewed changed: not the version, the snapshot, the revision or the archive state.
    assert (after["published_version"], after["revision"], after["archived_at"]) == \
        (before["published_version"], before["revision"], None)
    with sedens.db() as db:
        assert courses.version(db, cid, after["published_version"])["snapshot_sha256"] == snapshot
        # A new customer cannot buy; the page says why.
        assert access.enroll_option(sedens, db, newcomer, after)["reason"] == "sales_paused"
        card = access.course_card(sedens, db, newcomer, after)
        assert card["sales_paused"] and card["price"]["amount_minor"] == 29000
        # The customer who bought keeps the course.
        assert access.entitlements(sedens, db, buyer.user_id, after)
        assert access.can_view_metadata(sedens, db, buyer, after)
    with pytest.raises(Denied) as refused:
        call(sedens, marketplace.purchase, newcomer, cid)
    assert (refused.value.status, refused.value.code) == (409, "sales_paused")

    state = call(sedens, sales.set_paused, professor, {"id": cid, "paused": False})
    assert not state["paused"] and state["can_pause"]
    assert call(sedens, marketplace.purchase, newcomer, cid)["purchase"]["state"] == "demo_completed"
    assert row(sedens, cid)["revision"] == before["revision"]


def test_only_the_creator_pauses_and_only_a_published_course_on_sale(world):
    sedens, people, buyer, _, cid = world
    for intruder in (people["reviewer"], buyer, sedens.repo.actor(sedens.repo.demo_login(KEY, "admin"))):
        with pytest.raises(Denied) as refused:
            call(sedens, sales.set_paused, intruder, {"id": cid, "paused": True})
        assert refused.value.status == 404
    with pytest.raises(Denied) as refused:
        call(sedens, sales.set_paused, people["professor"], {"id": cid, "paused": False})
    assert refused.value.code == "not_paused"
    with pytest.raises(Denied) as refused:
        call(sedens, sales.set_paused, people["professor"], {"id": cid, "paused": "yes"})
    assert refused.value.code == "invalid"
    # A free course has no sales to pause.
    with sedens.db() as db:
        free = db.execute("SELECT id FROM s_courses WHERE owner_org_id=? AND title='4-Week Core Foundations'",
                          (ORG,)).fetchone()[0]
        minji = demo_marketplace.actor_for(ORG, "creator")
    coach = sedens.repo.actor(sedens.repo.issue(*minji))
    with pytest.raises(Denied) as refused:
        call(sedens, sales.set_paused, coach, {"id": free, "paused": True})
    assert refused.value.code == "not_for_sale"


def test_suspension_still_wins_and_blocks_resuming(world):
    sedens, people, buyer, newcomer, cid = world
    professor, reviewer = people["professor"], people["reviewer"]
    call(sedens, sales.set_paused, professor, {"id": cid, "paused": True})
    call(sedens, course_review.suspend, reviewer, {"course_id": cid, "reason": "Checking a rights question."})
    with sedens.db() as db:
        course = courses.row(db, cid)
        assert not access.published(course) and not access.can_view_metadata(sedens, db, newcomer, course)
    with pytest.raises(Denied) as refused:
        call(sedens, sales.set_paused, professor, {"id": cid, "paused": False})
    assert refused.value.code == "course_suspended"
    call(sedens, course_review.suspend, reviewer, {"course_id": cid, "suspend": False})
    # Reinstated, the creator's pause is still in place until they resume it.
    with sedens.db() as db:
        assert sales.paused(db, courses.row(db, cid))
    assert not call(sedens, sales.set_paused, professor, {"id": cid, "paused": False})["paused"]


def test_a_pause_covers_the_version_it_was_made_on(world):
    sedens, people, _, newcomer, cid = world
    professor, reviewer = people["professor"], people["reviewer"]
    call(sedens, sales.set_paused, professor, {"id": cid, "paused": True})
    with sedens.db() as db:
        view = courses.editor_view(sedens, db, professor, cid)
    assert view["sales"]["paused"] and view["sales"]["version"] == 1
    # The creator submits a new version; SEDENS approves it with its own reviewed sale status.
    with sedens.db() as db:
        view = courses.update(sedens, db, professor, {"id": cid, "revision": view["revision"],
                                                       "subtitle": view["course"]["subtitle"] + " (v2)"})
    submit(sedens, professor, view)
    with sedens.db() as db:
        assert sales.paused(db, courses.row(db, cid)), "still paused while version 2 waits for review"
    approve(sedens, reviewer, cid)
    with sedens.db() as db:
        course = courses.row(db, cid)
        assert course["published_version"] == 2 and not sales.paused(db, course)
        assert access.enroll_option(sedens, db, newcomer, course)["reason"] == "purchase_required"
    with pytest.raises(Denied) as refused:
        call(sedens, sales.set_paused, professor, {"id": cid, "paused": False})
    assert refused.value.code == "not_paused"
