"""SEDENS capabilities, creator profiles and creator <-> facility affiliations.

Security is capability-based: a self-declared creator type confers nothing.
An affiliation distributes content; it never opens a facility's customer data.
"""

import pytest

from pilates.platform.repository import Actor, Refused
from pilates.sedens import capabilities, creators, onboarding
from pilates.sedens.util import Denied
from sedens_support import PASSWORD, add_user, facility, make_sedens


@pytest.fixture
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    a = facility(sedens, "A")
    b = facility(sedens, "B")
    return sedens, a, b


def coach_actor(sedens, fac):
    return sedens.repo.actor(fac["coach_token"])


def test_platform_roles_are_unchanged(world):
    sedens, a, _ = world
    with sedens.db() as db:
        sql = db.execute("SELECT sql FROM sqlite_master WHERE name='p_roles'").fetchone()[0]
    assert "CHECK(role IN ('admin','coach','student'))" in sql


def test_facility_admin_grants_creator_to_own_coach(world):
    sedens, a, _ = world
    with sedens.db() as db:
        held = capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        assert held == ["creator"]
        assert capabilities.has(sedens, db, coach_actor(sedens, a), "creator")


def test_facility_admin_cannot_grant_to_another_facility(world):
    sedens, a, b = world
    with sedens.db() as db, pytest.raises(Denied) as exc:
        capabilities.grant(sedens, db, a["admin"], b["coach_id"], "creator")
    assert exc.value.code == "not_permitted"


def test_coach_cannot_grant_creator_to_themselves(world):
    sedens, a, _ = world
    with sedens.db() as db, pytest.raises(Denied):
        capabilities.grant(sedens, db, coach_actor(sedens, a), a["coach_id"], "creator")


def test_customers_cannot_hold_creator(world):
    sedens, a, _ = world
    with sedens.db() as db, pytest.raises(Denied) as exc:
        capabilities.grant(sedens, db, a["admin"], a["customer_id"], "creator")
    assert exc.value.code == "role_not_eligible"


def test_facility_admin_cannot_grant_sedens_permissions(world):
    sedens, a, _ = world
    with sedens.db() as db:
        for capability in ("sedens_reviewer", "sedens_admin"):
            with pytest.raises(Denied):
                capabilities.grant(sedens, db, a["admin"], a["admin"].user_id, capability)


def test_sedens_permissions_only_effective_in_the_sedens_org(world):
    """Even a grant row written directly is ignored outside the SEDENS org."""
    sedens, a, _ = world
    with sedens.db() as db:
        db.execute("INSERT INTO s_capabilities(user_id,capability,granted_at) VALUES (?,?,?)",
                   (a["admin"].user_id, "sedens_admin", "2026-01-01T00:00:00+00:00"))
        assert "sedens_admin" not in capabilities.held(sedens, db, a["admin"].user_id)
        assert not capabilities.has(sedens, db, a["admin"], "sedens_admin")


def test_sedens_org_bootstrap_and_admin_grants(world):
    sedens, a, _ = world
    created = onboarding.bootstrap_sedens_org(sedens, name="Root", email="root@sedens.test", password=PASSWORD)
    root = sedens.repo.actor(sedens.repo.login("root@sedens.test", PASSWORD))
    with sedens.db() as db:
        assert sedens.org(db, created["org_id"])["kind"] == "sedens"
        assert capabilities.effective(sedens, db, root) == {"sedens_admin", "sedens_reviewer"}
        reviewer_id = add_user(sedens.repo, root.org_id, "Reviewer", ["admin"])
        capabilities.grant(sedens, db, root, reviewer_id, "sedens_reviewer")
        # A SEDENS admin may grant creator anywhere in the same environment.
        assert "creator" in capabilities.grant(sedens, db, root, a["coach_id"], "creator")
        with pytest.raises(Denied, match="SEDENS organization"):
            capabilities.grant(sedens, db, root, a["admin"].user_id, "sedens_reviewer")


def test_capability_follows_the_session_role(world):
    sedens, a, _ = world
    dual = add_user(sedens.repo, a["org_id"], "Dual", ["coach", "student"], a["location_id"])
    as_coach = sedens.repo.actor(sedens.repo.issue(dual, "coach"))
    as_student = sedens.repo.actor(sedens.repo.issue(dual, "student"))
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], dual, "creator")
        assert capabilities.has(sedens, db, as_coach, "creator")
        assert not capabilities.has(sedens, db, as_student, "creator")


def test_losing_the_role_or_account_removes_the_capability(world):
    sedens, a, _ = world
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        db.execute("DELETE FROM p_roles WHERE user_id=? AND role='coach'", (a["coach_id"],))
        assert capabilities.held(sedens, db, a["coach_id"]) == set()
        db.execute("INSERT INTO p_roles VALUES (?,?)", (a["coach_id"], "coach"))
        db.execute("UPDATE p_users SET active=0 WHERE id=?", (a["coach_id"],))
        assert capabilities.held(sedens, db, a["coach_id"]) == set()


def test_revoke(world):
    sedens, a, _ = world
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        assert capabilities.revoke(sedens, db, a["admin"], a["coach_id"], "creator") == []
        assert not capabilities.has(sedens, db, coach_actor(sedens, a), "creator")


def test_grants_are_audited(world):
    sedens, a, _ = world
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        assert db.execute("SELECT 1 FROM p_audit WHERE action='sedens:capability:grant' AND subject_id=?",
                          (a["coach_id"],)).fetchone()


# -- creator profiles ------------------------------------------------------------


def test_profile_requires_the_creator_capability_not_a_title(world):
    sedens, a, _ = world
    with sedens.db() as db:
        with pytest.raises(Denied) as exc:
            creators.save_profile(sedens, db, coach_actor(sedens, a),
                                  {"display_name": "Prof. X", "creator_type": "professor"})
        assert exc.value.code == "capability_required"


def test_coach_keeps_their_account_and_gains_a_profile(world):
    sedens, a, _ = world
    with sedens.db() as db:
        users_before = db.execute("SELECT count(*) FROM p_users").fetchone()[0]
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        profile = creators.save_profile(sedens, db, coach_actor(sedens, a), {"display_name": "Coach A"})
        assert profile["creator_type"] == "coach"
        assert profile["verification_state"] == "unverified" and profile["self_declared"] is True
        assert db.execute("SELECT count(*) FROM p_users").fetchone()[0] == users_before
        assert db.execute("SELECT user_id FROM s_creator_profiles").fetchone()[0] == a["coach_id"]


def test_creator_cannot_verify_themselves(world):
    sedens, a, _ = world
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        coach = coach_actor(sedens, a)
        with pytest.raises(Denied) as exc:
            creators.save_profile(sedens, db, coach, {"display_name": "C", "verification_state": "verified"})
        assert exc.value.code == "read_only_field"
        creators.save_profile(sedens, db, coach, {"display_name": "C"})
        assert creators.request_verification(sedens, db, coach)["verification_state"] == "pending"
        profile_id = creators.own_profile(sedens, db, coach)["id"]
        with pytest.raises(Denied):
            creators.decide_verification(sedens, db, coach, profile_id, "verified")
        with pytest.raises(Denied):
            creators.decide_verification(sedens, db, a["admin"], profile_id, "verified")


def test_sedens_reviewer_verifies(world):
    sedens, a, _ = world
    onboarding.bootstrap_sedens_org(sedens, name="Root", email="root2@sedens.test", password=PASSWORD)
    root = sedens.repo.actor(sedens.repo.login("root2@sedens.test", PASSWORD))
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        coach = coach_actor(sedens, a)
        profile = creators.save_profile(sedens, db, coach, {"display_name": "C"})
        # Only a profile that asked for review can be verified.
        with pytest.raises(Denied) as exc:
            creators.decide_verification(sedens, db, root, profile["id"], "verified")
        assert exc.value.code == "not_pending"
        creators.request_verification(sedens, db, coach)
        decided = creators.decide_verification(sedens, db, root, profile["id"], "verified", "Checked certificate")
        assert decided["verification_state"] == "verified" and decided["self_declared"] is False
        # Re-saving identical details keeps the verification...
        same = creators.save_profile(sedens, db, coach, {"display_name": "C"})
        assert same["verification_state"] == "verified"
        # ...but changing what was reviewed needs a new review.
        changed = creators.save_profile(sedens, db, coach, {
            "display_name": "Dr. C, MD", "creator_type": "professor", "institution": "A hospital",
            "qualifications": ["MD"]})
        assert changed["verification_state"] == "unverified" and changed["self_declared"] is True
        row = db.execute("SELECT verified_by, verified_at FROM s_creator_profiles WHERE id=?", (profile["id"],)).fetchone()
        assert tuple(row) == (None, None)


def test_a_reviewer_cannot_verify_their_own_profile(world):
    sedens, a, _ = world
    onboarding.bootstrap_sedens_org(sedens, name="Root", email="root3@sedens.test", password=PASSWORD)
    root = sedens.repo.actor(sedens.repo.login("root3@sedens.test", PASSWORD))
    with sedens.db() as db:
        capabilities.grant(sedens, db, root, root.user_id, "creator")
        profile = creators.save_profile(sedens, db, root, {"display_name": "Root"})
        creators.request_verification(sedens, db, root)
        with pytest.raises(Denied) as exc:
            creators.decide_verification(sedens, db, root, profile["id"], "verified")
        assert exc.value.code == "self_review"


def test_independent_professor_gets_a_dedicated_creator_org(world):
    sedens, a, b = world
    token = onboarding.register_creator_studio(
        sedens, name="Prof Kim", email="prof@uni.test", password=PASSWORD, display_name="Prof. Kim",
        creator_type="professor",
    )
    prof = sedens.repo.actor(token)
    with sedens.db() as db:
        org = sedens.org(db, prof.org_id)
        assert org["kind"] == "creator_studio" and not org["demo"]
        assert prof.org_id not in (a["org_id"], b["org_id"])
        assert capabilities.effective(sedens, db, prof) == {"creator"}
        profile = creators.own_profile(sedens, db, prof)
        assert profile["creator_type"] == "professor" and profile["verification_state"] == "unverified"
        # A creator studio has no members and no rooms.
        assert db.execute("SELECT count(*) FROM p_users WHERE org_id=?", (prof.org_id,)).fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM p_locations WHERE org_id=?", (prof.org_id,)).fetchone()


# -- affiliations ------------------------------------------------------------------


@pytest.fixture
def affiliated(world):
    """Coach of facility A, approved to distribute content to facility B."""
    sedens, a, b = world
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        coach = coach_actor(sedens, a)
        creators.save_profile(sedens, db, coach, {"display_name": "Coach A"})
        request = creators.request_affiliation(sedens, db, coach, b["org_id"])
        decided = creators.decide_affiliation(sedens, db, b["admin"], request["id"], "approve")
        assert decided["status"] == "approved"
    return sedens, a, b, coach, decided


def test_affiliation_grants_content_distribution_only(affiliated):
    sedens, a, b, coach, decided = affiliated
    assert decided["grants"] == ["content_distribution"]
    assert "member_records" in decided["does_not_grant"]
    with sedens.db() as db:
        profile = creators.own_profile(sedens, db, coach)
        targets = creators.distribution_targets(sedens, db, profile["id"])
    assert {t["org_id"] for t in targets} == {a["org_id"], b["org_id"]}


def test_affiliation_never_opens_facility_b_customer_data(affiliated):
    sedens, a, b, coach, _ = affiliated
    repo = sedens.repo
    # The creator's platform identity is still facility A only.
    assert coach.org_id == a["org_id"]
    assert b["customer_id"] not in [p["id"] for p in repo.people(coach)]
    for collection in ("analyses", "notes", "media", "reservations", "scans"):
        for item in repo.list(coach, collection)["items"]:
            assert item.get("org_id") != b["org_id"]
    with pytest.raises(Refused):
        repo.client(coach, b["customer_id"])
    with pytest.raises(Refused):
        repo.assert_student(coach, b["customer_id"])
    with sedens.db() as db:
        # No membership, role or assignment was created in facility B.
        assert not db.execute("SELECT 1 FROM p_users WHERE org_id=? AND id=?", (b["org_id"], coach.user_id)).fetchone()
        assert not db.execute("SELECT 1 FROM p_coach_students WHERE coach_id=? AND student_id=?",
                              (coach.user_id, b["customer_id"])).fetchone()


def test_one_creator_distributes_to_several_facilities(world):
    sedens, a, b = world
    c = facility(sedens, "C")
    token = onboarding.register_creator_studio(sedens, name="Prof Lee", email="lee@uni.test", password=PASSWORD)
    prof = sedens.repo.actor(token)
    with sedens.db() as db:
        for fac in (a, b, c):
            req = creators.request_affiliation(sedens, db, prof, fac["org_id"])
            creators.decide_affiliation(sedens, db, fac["admin"], req["id"], "approve")
        profile = creators.own_profile(sedens, db, prof)
        targets = creators.distribution_targets(sedens, db, profile["id"])
    # A creator studio is not itself a distribution target.
    assert {t["org_id"] for t in targets} == {a["org_id"], b["org_id"], c["org_id"]}
    assert all(t["basis"] == "approved_affiliation" for t in targets)


def test_only_the_target_facility_admin_decides(world):
    sedens, a, b = world
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        coach = coach_actor(sedens, a)
        creators.save_profile(sedens, db, coach, {"display_name": "Coach A"})
        req = creators.request_affiliation(sedens, db, coach, b["org_id"])
        for wrong in (a["admin"], coach, sedens.repo.actor(b["coach_token"]), sedens.repo.actor(b["customer_token"])):
            with pytest.raises(Denied):
                creators.decide_affiliation(sedens, db, wrong, req["id"], "approve")
        creators.decide_affiliation(sedens, db, b["admin"], req["id"], "decline")
        assert not [t for t in creators.distribution_targets(sedens, db, creators.own_profile(sedens, db, coach)["id"])
                    if t["org_id"] == b["org_id"]]


def test_facility_admin_sees_public_creator_details_only(affiliated):
    sedens, a, b, coach, _ = affiliated
    with sedens.db() as db:
        items = creators.facility_affiliations(sedens, db, b["admin"])
    creator = items[0]["creator"]
    assert set(creator) == {"id", "display_name", "creator_type", "bio", "institution", "qualifications",
                            "specialties", "slug", "verification_state", "self_declared"}


def test_revocation_by_either_side(affiliated):
    sedens, a, b, coach, decided = affiliated
    with sedens.db() as db:
        assert creators.revoke_affiliation(sedens, db, b["admin"], decided["id"])["status"] == "revoked"
        profile = creators.own_profile(sedens, db, coach)
        assert {t["org_id"] for t in creators.distribution_targets(sedens, db, profile["id"])} == {a["org_id"]}
        with pytest.raises(Denied):
            creators.revoke_affiliation(sedens, db, sedens.repo.actor(b["customer_token"]), decided["id"])


def test_demo_and_real_never_affiliate(world, tmp_path):
    sedens, a, _ = world
    sedens.repo.demo_login("e" * 32, "admin")
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        coach = coach_actor(sedens, a)
        creators.save_profile(sedens, db, coach, {"display_name": "Coach A"})
        with pytest.raises(Denied) as exc:
            creators.request_affiliation(sedens, db, coach, "demo-" + "e" * 32)
        assert exc.value.code == "environment_mismatch"


def test_affiliation_requests_target_facilities_only(world):
    sedens, a, _ = world
    token = onboarding.register_creator_studio(sedens, name="Prof Park", email="park@uni.test", password=PASSWORD)
    prof = sedens.repo.actor(token)
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
        coach = coach_actor(sedens, a)
        creators.save_profile(sedens, db, coach, {"display_name": "Coach A"})
        with pytest.raises(Denied) as exc:
            creators.request_affiliation(sedens, db, coach, prof.org_id)
        assert exc.value.code == "unknown_facility"
        with pytest.raises(Denied):
            creators.request_affiliation(sedens, db, coach, a["org_id"])
