"""The demonstration marketplace. Every name here is fictional and labelled DEMO.

For each demonstration visitor (``demo-<key>``), beside the demonstration
facility "SEDENS Demo Fitness Center", this seeds once:

* **Minji Lee**, a fictional coach of the demonstration facility, and her
  course "4-Week Core Foundations", free for the facility and included for its
  members;
* a fictional creator studio, "Mobility Lab (demo)", whose professor is not a
  real person and holds no real credentials, with "Mobility Foundations" at
  ₩29,000 on the marketplace, marked DEMO MARKETPLACE CONTENT: it can only be
  bought by a simulated purchase, and no money moves;
* a SEDENS demonstration organization with an editorial creator, a small
  "SEDENS Standard: Foundations" course built from the SEDENS Standard v0
  subset (itself labelled "Demo content — not yet expert-reviewed"), and a
  fictional reviewer who approved the three courses.

Every course went through the real submit and review functions. Nothing here
calls a paid service or the internet.
"""

from __future__ import annotations

from ..platform.repository import Actor
from . import capabilities, course_media, course_review, courses, creators, marketplace, standard
from .util import now

LAYER, LAYER_VERSION = "marketplace", 1
DEMO_LABEL = "DEMO MARKETPLACE CONTENT"
SAFETY = ("General fitness only. Move within a comfortable range. Stop and rest if anything hurts, if you feel dizzy "
          "or short of breath, or if you are unsure, and ask a facility coach before trying again.")
PASS = {item: {"result": "pass", "note": "Demonstration review."} for item in course_review.CHECKLIST}


def ids(org_id: str) -> dict:
    return {
        "sedens_org": f"{org_id}-sedens", "reviewer": f"{org_id}-sedens-reviewer", "editor": f"{org_id}-sedens-editor",
        "studio_org": f"{org_id}-professor", "professor": f"{org_id}-professor-admin", "minji": f"{org_id}-sedens-minji",
        "admin": f"{org_id}-admin",
    }


def _org(db, sedens, org_id, name, kind, display, language):
    if db.execute("SELECT 1 FROM p_organizations WHERE id=?", (org_id,)).fetchone() is None:
        db.execute("INSERT INTO p_organizations(id,name,demo,created_at) VALUES (?,?,1,?)", (org_id, name, now()))
    sedens.set_org_profile(db, org_id, kind, display, language)


def _user(db, user_id, org_id, name, role):
    if db.execute("SELECT 1 FROM p_users WHERE id=?", (user_id,)).fetchone() is None:
        db.execute("INSERT INTO p_users(id,org_id,name,email) VALUES (?,?,?,?)",
                   (user_id, org_id, name, f"{user_id}@demo.sedens.invalid"))
        db.execute("INSERT INTO p_roles VALUES (?,?)", (user_id, role))
        if role == "coach":
            db.execute("INSERT INTO p_coaches(id) VALUES (?)", (user_id,))
    return Actor(user_id, org_id, role, True)


def _creator(sedens, db, actor, profile):
    capabilities.grant(sedens, db, None, actor.user_id, "creator", cli=True)
    if creators.profile_row(db, actor.user_id) is None:
        creators.save_profile(sedens, db, actor, profile)


def _guided(sedens, db, actor, meta, modules):
    """modules: [(title, [(session title, [(standard id, dose)])])]"""
    view = courses.create(sedens, db, actor, {**meta, "course_type": "guided_training", "language": "en",
                                              "safety": SAFETY})
    cid = view["course"]["id"]
    for module_title, sessions in modules:
        view = courses.save_module(sedens, db, actor, {"course_id": cid, "revision": view["revision"],
                                                       "title": module_title})
        module_id = view["modules"][-1]["id"]
        for session_title, steps in sessions:
            view = courses.save_session(sedens, db, actor, {
                "course_id": cid, "revision": view["revision"], "module_id": module_id, "title": session_title,
                "estimated_minutes": 5 * len(steps) + 5})
            session_id = view["modules"][-1]["sessions"][-1]["id"]
            for ref, dose in steps:
                entry = standard.get(ref)
                view = courses.save_step(sedens, db, actor, {
                    "course_id": cid, "revision": view["revision"], "session_id": session_id,
                    "exercise_source": "standard", "exercise_ref": ref, "customer_cue": entry["cue"]["en"][:280],
                    "regression": entry["regressions"][0]["en"][:600] if entry["regressions"] else "",
                    "progression": entry["progressions"][0]["en"][:600] if entry["progressions"] else "",
                    "rest_seconds": 15, **dose})
    return view


def _publish(sedens, db, creator, reviewer, view, distribution, facilities=(), price=None):
    view = courses.set_access(sedens, db, creator, {
        "id": view["course"]["id"], "revision": view["revision"], "distribution": distribution,
        "facilities": list(facilities), "price": price or {"price_type": "free"}})
    view = courses.submit(sedens, db, creator, {"id": view["course"]["id"], "revision": view["revision"],
                                                "note": "Demonstration course."})
    cid = view["course"]["id"]
    found = courses.version(db, cid, 1)
    course_review.decide(sedens, db, reviewer, {
        "course_id": cid, "version": 1, "decision": "approved", "snapshot_sha256": found["snapshot_sha256"],
        "checklist": PASS, "comment": "Demonstration review: fictional content, approved for the demo only."})
    return cid


def ensure(sedens, org_id) -> None:
    """Seed once per demonstration (inside ``demo.ensure``'s batch)."""
    with sedens.db() as db:
        if db.execute("SELECT 1 FROM s_demo_layers WHERE org_id=? AND layer=? AND version>=?",
                      (org_id, LAYER, LAYER_VERSION)).fetchone():
            return
        if db.execute("SELECT 1 FROM p_users WHERE id=? AND org_id=?", (f"{org_id}-admin", org_id)).fetchone() is None:
            return  # the visitor removed the facility administrator; leave their demonstration as it is
        n = ids(org_id)
        location = db.execute("SELECT location_id FROM p_rooms WHERE id=?", (f"{org_id}-sedens-room01",)).fetchone()

        # SEDENS (demonstration): a fictional reviewer and an editorial creator.
        _org(db, sedens, n["sedens_org"], "SEDENS International · Demonstration", "sedens",
             "SEDENS International (demo)", "en")
        reviewer = _user(db, n["reviewer"], n["sedens_org"], "Demo Reviewer (fictional)", "coach")
        capabilities.grant(sedens, db, None, reviewer.user_id, "sedens_reviewer", cli=True)
        editor = _user(db, n["editor"], n["sedens_org"], "SEDENS Editorial (demo)", "coach")
        _creator(sedens, db, editor, {"display_name": "SEDENS Editorial", "creator_type": "sedens_editorial",
                                      "bio": "Demonstration editorial account."})

        # A fictional professor's creator studio.
        _org(db, sedens, n["studio_org"], "Mobility Lab · Demonstration creator studio", "creator_studio",
             "Mobility Lab (demo)", "en")
        professor = _user(db, n["professor"], n["studio_org"], "Prof. Sample Demo", "admin")
        _creator(sedens, db, professor, {
            "display_name": "Prof. Sample Demo (fictional)", "creator_type": "professor",
            "bio": "A fictional demonstration professor. Not a real person, and holds no real credentials."})

        # Minji Lee, a fictional coach of the demonstration facility.
        minji = _user(db, n["minji"], org_id, "Minji Lee", "coach")
        if location and not db.execute("SELECT 1 FROM p_coach_locations WHERE coach_id=?", (minji.user_id,)).fetchone():
            db.execute("INSERT INTO p_coach_locations VALUES (?,?)", (minji.user_id, location[0]))
        _creator(sedens, db, minji, {"display_name": "Minji Lee", "creator_type": "coach",
                                     "bio": "Fictional demonstration coach at SEDENS Demo Fitness Center."})

        standard_view = _guided(sedens, db, editor, {
            "title": "SEDENS Standard: Foundations", "subtitle": standard.label()["en"],
            "description": "Three short sessions from the SEDENS Standard v0 subset: breathing, pelvic control, "
                           "core control and gentle mobility. " + standard.label()["en"],
            "category": "pilates", "level": "beginner", "weeks": 2, "sessions_per_week": 2, "estimated_minutes": 20,
            "equipment": ["mat"], "goals": ["Learn the foundations"], "body_areas": ["core", "hips", "lower_back"],
            "audience": "Anyone new to mat Pilates.", "outcomes": "Familiarity with ten foundation movements."},
            [("Foundations", [
                ("Breath and pelvis", [("std-breathing", {"reps": 6}), ("std-imprint-release", {"reps": 8}),
                                       ("std-pelvic-curl", {"reps": 8})]),
                ("Core control", [("std-knee-folds", {"reps": 8, "sides": "alternate"}),
                                  ("std-dead-bug", {"reps": 6, "sides": "alternate"}),
                                  ("std-supine-spine-twist", {"reps": 6, "sides": "alternate"})]),
                ("Hips and back", [("std-cat-stretch", {"reps": 6}), ("std-opposite-reach", {"reps": 6, "sides": "alternate"}),
                                   ("std-clam", {"reps": 10, "sides": "each_side"}), ("std-arm-arcs", {"reps": 8})]),
            ])])
        standard_id = _publish(sedens, db, editor, reviewer, standard_view, "marketplace")

        core_view = _guided(sedens, db, minji, {
            "title": "4-Week Core Foundations", "subtitle": "Free for SEDENS Demo Fitness Center members",
            "description": "A fictional demonstration program by coach Minji Lee: breathing, bracing and bridging, "
                           "two short sessions a week.",
            "category": "core", "level": "beginner", "weeks": 4, "sessions_per_week": 2, "estimated_minutes": 25,
            "equipment": ["mat"], "goals": ["Build a steady core routine"], "body_areas": ["core"],
            "audience": "Members new to core training."},
            [("Weeks 1–2", [("Breath and brace", [("std-breathing", {"reps": 6}), ("std-dead-bug", {"reps": 6, "sides": "alternate"})])]),
             ("Weeks 3–4", [("Bridge and twist", [("std-pelvic-curl", {"reps": 10}),
                                                  ("std-supine-spine-twist", {"reps": 6, "sides": "alternate"})])])])
        picture = course_media.add_repo_asset(sedens, db, minji, "repo-bridge")
        step = core_view["modules"][1]["sessions"][0]["steps"][0]
        core_view = courses.save_step(sedens, db, minji, {
            **{k: step[k] for k in ("id", "phase", "sets", "reps", "rest_seconds", "sides", "customer_cue",
                                    "regression", "progression")},
            "course_id": core_view["course"]["id"], "revision": core_view["revision"],
            "session_id": core_view["modules"][1]["sessions"][0]["id"], "exercise_source": "standard",
            "exercise_ref": "std-pelvic-curl", "image_media_id": picture["id"]})
        core_id = _publish(sedens, db, minji, reviewer, core_view, "selected_facilities",
                           [{"org_id": org_id, "free": True}])

        mobility_view = _guided(sedens, db, professor, {
            "title": "Mobility Foundations", "subtitle": DEMO_LABEL + " — simulated purchase only",
            "description": DEMO_LABEL + ". A fictional professor's program of gentle mobility sessions. Buying it "
                           "is simulated: no payment is taken.",
            "category": "mobility", "level": "all_levels", "weeks": 3, "sessions_per_week": 2,
            "estimated_minutes": 30, "equipment": ["mat"], "goals": ["Move more comfortably every day"],
            "body_areas": ["hips", "upper_back", "shoulders"], "audience": "Adults who want gentle daily mobility."},
            [("Spine and hips", [("Spine mobility", [("std-cat-stretch", {"reps": 8}),
                                                      ("std-supine-spine-twist", {"reps": 6, "sides": "alternate"})]),
                                 ("Hips", [("std-clam", {"reps": 10, "sides": "each_side"}),
                                           ("std-opposite-reach", {"reps": 6, "sides": "alternate"})])]),
             ("Shoulders", [("Shoulder freedom", [("std-arm-arcs", {"reps": 8}), ("std-breathing", {"reps": 6})])])])
        mobility_id = _publish(sedens, db, professor, reviewer, mobility_view, "marketplace", price={
            "price_type": "paid", "amount_minor": 29000, "currency": "KRW", "sale_state": "active"})

        admin = Actor(n["admin"], org_id, "admin", True)
        for cid, included in ((standard_id, True), (core_id, True), (mobility_id, False)):
            marketplace.set_facility_course(sedens, db, admin, {"course_id": cid, "enabled": True,
                                                                 "included": included, "featured": cid == core_id})
        db.execute("INSERT INTO s_demo_layers(org_id,layer,version,seeded_at) VALUES (?,?,?,?) "
                   "ON CONFLICT(org_id,layer) DO UPDATE SET version=excluded.version, seeded_at=excluded.seeded_at",
                   (org_id, LAYER, LAYER_VERSION, now()))


def actor_for(org_id: str, role: str) -> tuple[str, str] | None:
    """(user id, platform role) for the demonstration roles this layer adds."""
    n = ids(org_id)
    return {"creator": (n["minji"], "coach"), "professor": (n["professor"], "admin"),
            "reviewer": (n["reviewer"], "coach")}.get(role)
