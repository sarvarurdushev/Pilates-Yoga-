"""The demonstration marketplace: fictional, labelled, isolated per visitor, and
the only place a (simulated) purchase can happen."""

from __future__ import annotations

import pytest

from pilates.sedens import access, courses, demo, demo_marketplace, marketplace, standard
from pilates.sedens.util import Denied
from sedens_support import make_sedens

KEY, OTHER = "c" * 32, "d" * 32


@pytest.fixture(scope="module")
def sedens(tmp_path_factory):
    sedens = make_sedens(tmp_path_factory.mktemp("demo") / "s.db")
    for key in (KEY, OTHER):
        sedens.repo.logout(sedens.repo.demo_login(key, "admin"))
        demo.ensure(sedens, "demo-" + key)
    return sedens


def student(sedens, key=KEY):
    return sedens.repo.actor(sedens.repo.demo_login(key, "student"))


def test_the_demo_catalog(sedens):
    with sedens.db() as db:
        cards = {c["title"]: c for c in marketplace.catalog(sedens, db, student(sedens))}
    assert set(cards) == {"4-Week Core Foundations", "SEDENS Standard: Foundations", "Mobility Foundations"}
    core, std, mobility = cards["4-Week Core Foundations"], cards["SEDENS Standard: Foundations"], cards["Mobility Foundations"]
    assert core["creator"]["display_name"] == "Minji Lee" and core["badge"] == "facility_program"
    assert core["included_here"] and core["free_here"] and core["featured_here"]
    assert std["badge"] == "sedens_standard" and std["included_here"]
    assert mobility["badge"] == "premium_expert" and mobility["price"]["amount_minor"] == 29000
    assert mobility["price"]["currency"] == "KRW" and not mobility["included_here"] and mobility["enabled_here"]
    assert mobility["subtitle"].startswith(demo_marketplace.DEMO_LABEL)
    assert all(c["demo"] for c in cards.values())


def test_the_professor_is_fictional_and_unverified(sedens):
    with sedens.db() as db:
        profile = db.execute("SELECT * FROM s_creator_profiles WHERE user_id=?",
                             (demo_marketplace.ids("demo-" + KEY)["professor"],)).fetchone()
    assert "fictional" in profile["display_name"].lower() and "Not a real person" in profile["bio"]
    assert profile["verification_state"] == "unverified" and not profile["institution"]
    assert profile["qualifications"] in ("[]", "")


def test_the_standard_course_keeps_its_review_label(sedens):
    with sedens.db() as db:
        course = db.execute("SELECT * FROM s_courses WHERE title='SEDENS Standard: Foundations' AND owner_org_id=?",
                            ("demo-" + KEY + "-sedens",)).fetchone()
        version = courses.version(db, course["id"], 1)
    refs = [s["exercise"]["ref"] for m in version["snapshot"]["modules"] for x in m["sessions"] for s in x["steps"]]
    assert set(refs) <= {e["id"] for e in standard.exercises()} and len(set(refs)) == 10
    assert all(s["exercise"]["review"]["status"] == "unreviewed"
               for m in version["snapshot"]["modules"] for x in m["sessions"] for s in x["steps"])
    assert standard.label()["en"] in course["description"]


def test_demonstrations_never_see_each_other(sedens):
    with sedens.db() as db:
        mine = {c["id"] for c in marketplace.catalog(sedens, db, student(sedens))}
        theirs = {c["id"] for c in marketplace.catalog(sedens, db, student(sedens, OTHER))}
        assert mine and theirs and not mine & theirs
        foreign = courses.row(db, next(iter(theirs)))
        assert not access.can_view_metadata(sedens, db, student(sedens), foreign)


def test_a_demo_purchase_is_simulated_and_grants_the_course(sedens):
    customer, other = student(sedens), student(sedens, OTHER)
    with sedens.db() as db:
        mobility = next(c for c in marketplace.catalog(sedens, db, customer) if c["title"] == "Mobility Foundations")
        bought = marketplace.purchase(sedens, db, customer, mobility["id"])
        assert bought["purchase"]["notice"]["en"] == "DEMO — no real payment occurred."
        assert bought["purchase"]["real_money"] is False and bought["course"]["card"]["purchased"]
        with pytest.raises(Denied) as again:
            marketplace.purchase(sedens, db, customer, mobility["id"])
        assert again.value.code == "already_entitled"
        # Another visitor cannot buy (or see) this demonstration's course.
        with pytest.raises(Denied) as refused:
            marketplace.purchase(sedens, db, other, mobility["id"])
        assert refused.value.status == 404


def test_seeding_runs_once(sedens):
    with sedens.db() as db:
        before = db.execute("SELECT count(*) FROM s_courses").fetchone()[0]
    demo.ensure(sedens, "demo-" + KEY)
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_courses").fetchone()[0] == before == 6
