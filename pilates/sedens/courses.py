"""Courses as creators edit them: normalized draft rows and immutable versions.

A course belongs to its creator (``creator_id``) and to the organization the
creator belongs to (``owner_org_id``). Only that creator edits it
(:func:`pilates.sedens.access.can_edit`); a facility administrator decides only
whether a course it may receive is enabled in its own rooms.

* **Guided training** is modules > sessions > ordered steps. Each step is one
  row with its exercise (a SEDENS Standard id or a catalog key, never a
  facility's exercise row), dose, cues, media, equipment, an optional easier
  or harder variant, and its anatomy mapping and timeline (validated against
  the atlas registry).
* **Professional education** is modules > lessons (video, PDF, article,
  image, anatomy task, quiz, case, exercise demonstration).

Every draft edit carries the course's ``revision`` and bumps it, so two
editors never overwrite each other silently. Submitting freezes the whole draft
into an immutable version snapshot; customers only ever read versions, so
editing a published course never changes what anyone is using.

Three choices are independent: *distribution* (creator only, selected
facilities, the creator's approved facility network, or the marketplace),
*price* (free or paid, with per-facility free terms), and *visibility*
(derived from version states: draft, submitted for review, published).
"""

from __future__ import annotations

import hashlib

from . import atlas, capabilities, creators, standard, wording
from .util import Denied, decode, encode, now, text, uid

TYPES = ("guided_training", "professional_education")
LANGUAGES = ("ko", "en")
CATEGORIES = ("pilates", "yoga", "mobility", "core", "strength", "balance", "breathing", "education")
LEVELS = ("beginner", "intermediate", "advanced", "all_levels")
EQUIPMENT = ("mat", "block", "strap", "band", "ball", "foam_roller", "chair", "towel", "wall",
             "reformer", "cadillac", "barrel")
BODY_AREAS = ("neck", "shoulders", "upper_back", "lower_back", "core", "hips", "knees", "ankles_feet", "full_body")
DISTRIBUTIONS = ("creator_only", "selected_facilities", "network", "marketplace")
CURRENCIES = ("KRW", "USD")
SALE_STATES = ("active", "paused", "not_for_sale")
PHASES = ("warm_up", "main", "cool_down")
SIDES = ("none", "both", "alternate", "each_side")
ROLES = ("focus", "prime", "assisting", "steadying")
LESSON_KINDS = ("video", "pdf", "article", "image", "anatomy_task", "quiz", "case", "exercise_demo")
LAYERS = ("", "skeleton", "muscles_superficial", "muscles_deep", "organs", "bones_full", "muscles_full", "organs_full")
SNAPSHOT_SCHEMA = 1
MAX_MODULES, MAX_SESSIONS, MAX_STEPS, MAX_LESSONS, MAX_SEGMENTS = 52, 60, 40, 80, 24


# -- reading -------------------------------------------------------------------------


def row(db, course_id):
    found = db.execute("SELECT * FROM s_courses WHERE id=?", (course_id,)).fetchone() if course_id else None
    if found is None:
        raise Denied("This course does not exist.", 404, "unknown_course")
    return found


def price(db, course_id) -> dict:
    found = db.execute("SELECT * FROM s_course_prices WHERE course_id=?", (course_id,)).fetchone()
    if found is None:
        return {"price_type": "free", "amount_minor": 0, "currency": "KRW", "sale_state": "not_for_sale"}
    return {k: found[k] for k in ("price_type", "amount_minor", "currency", "sale_state")}


def terms(sedens, db, course_id) -> list[dict]:
    out = []
    for t in db.execute("SELECT * FROM s_course_facility_terms WHERE course_id=? ORDER BY created_at", (course_id,)):
        org = sedens.org(db, t["org_id"])
        location = db.execute("SELECT name FROM p_locations WHERE id=?", (t["location_id"],)).fetchone() \
            if t["location_id"] else None
        out.append({"org_id": t["org_id"], "facility_name": org["display_name"] if org else "",
                    "location_id": t["location_id"], "location_name": location[0] if location else None,
                    "free": bool(t["free"])})
    return out


def metadata(course) -> dict:
    return {
        "id": course["id"], "course_type": course["course_type"], "language": course["language"],
        "title": course["title"], "subtitle": course["subtitle"], "description": course["description"],
        "category": course["category"], "level": course["level"], "audience": course["audience"],
        "prerequisites": course["prerequisites"], "safety": course["safety"], "outcomes": course["outcomes"],
        "equipment": decode(course["equipment"], []), "goals": decode(course["goals"], []),
        "body_areas": decode(course["body_areas"], []), "estimated_minutes": course["estimated_minutes"],
        "weeks": course["weeks"], "sessions_per_week": course["sessions_per_week"],
        "cover_media_id": course["cover_media_id"], "distribution": course["distribution"],
    }


def visibility(db, course) -> str:
    """'published', 'submitted' or 'draft' (the owner's visibility axis)."""
    if course["published_version"] and not course["suspended_at"] and not course["archived_at"]:
        return "published"
    if db.execute("SELECT 1 FROM s_course_versions WHERE course_id=? AND state='submitted'", (course["id"],)).fetchone():
        return "submitted"
    return "draft"


def review_state(db, course) -> str:
    """Where the course is in review, for the creator: draft, submitted,
    needs_revision, published, suspended or archived."""
    if course["archived_at"]:
        return "archived"
    if course["suspended_at"]:
        return "suspended"
    latest = db.execute("SELECT state FROM s_course_versions WHERE course_id=? ORDER BY version DESC LIMIT 1",
                        (course["id"],)).fetchone()
    if latest and latest[0] in ("submitted", "needs_revision"):
        return latest[0]
    if course["published_version"]:
        return "published"
    return "draft"


def _step(db, s) -> dict:
    anatomy = [{"key": a["structure_key"], "role": a["role"]} for a in db.execute(
        "SELECT * FROM s_course_step_anatomy WHERE step_id=? ORDER BY position", (s["id"],))]
    timeline = [{"id": t["id"], "start_ms": t["start_ms"], "end_ms": t["end_ms"], "mode": t["mode"], "layer": t["layer"],
                 "structures": decode(t["structures"], []), "cue": t["cue"]} for t in db.execute(
        "SELECT * FROM s_course_step_timeline WHERE step_id=? ORDER BY position", (s["id"],))]
    return {
        "id": s["id"], "position": s["position"], "phase": s["phase"],
        "exercise": exercise(s["exercise_source"], s["exercise_ref"]), "title": s["title"],
        "sets": s["sets"], "reps": s["reps"], "hold_seconds": s["hold_seconds"], "work_seconds": s["work_seconds"],
        "rest_seconds": s["rest_seconds"], "sides": s["sides"], "regression": s["regression"],
        "progression": s["progression"], "customer_cue": s["customer_cue"], "narration": s["narration"],
        "video_media_id": s["video_media_id"], "image_media_id": s["image_media_id"],
        "equipment": decode(s["equipment"], []), "advance": s["advance"], "variant_of": s["variant_of"],
        "variant": s["variant"], "atlas_depth": s["atlas_depth"], "anatomy": anatomy, "timeline": timeline,
    }


def tree(db, course) -> list[dict]:
    """The draft's modules with their sessions and steps, or lessons."""
    modules = []
    for m in db.execute("SELECT * FROM s_course_modules WHERE course_id=? ORDER BY position", (course["id"],)):
        entry = {"id": m["id"], "position": m["position"], "title": m["title"], "summary": m["summary"]}
        if course["course_type"] == "guided_training":
            entry["sessions"] = []
            for s in db.execute("SELECT * FROM s_course_sessions WHERE module_id=? ORDER BY position", (m["id"],)):
                steps = [_step(db, x) for x in db.execute(
                    "SELECT * FROM s_course_steps WHERE session_id=? ORDER BY position", (s["id"],))]
                entry["sessions"].append({"id": s["id"], "position": s["position"], "title": s["title"],
                                          "summary": s["summary"], "estimated_minutes": s["estimated_minutes"],
                                          "steps": steps})
        else:
            entry["lessons"] = [{
                "id": x["id"], "position": x["position"], "kind": x["kind"], "title": x["title"], "body": x["body"],
                "media_id": x["media_id"], "exercise": exercise(x["exercise_source"], x["exercise_ref"])
                if x["exercise_ref"] else None, "detail": decode(x["detail"], {}),
            } for x in db.execute("SELECT * FROM s_course_lessons WHERE module_id=? ORDER BY position", (m["id"],))]
        modules.append(entry)
    return modules


def exercise(source, ref) -> dict | None:
    """The exercise a step points at, as the creator sees it."""
    if source == "standard":
        entry = standard.get(ref)
        if entry is None:
            return None
        return {"source": "standard", "ref": ref, "title": entry["title"], "level": entry["level"],
                "catalog_key": entry["catalog_key"], "review": entry["review"],
                "structures": entry["anatomy"]["structures"], "anatomy_exercise": entry["anatomy"]["exercise"]}
    if source == "catalog":
        entry = standard.catalog().get(ref)
        if entry is None:
            return None
        return {"source": "catalog", "ref": ref, "title": {"en": entry["name"], "ko": entry["name"]},
                "level": None, "catalog_key": ref, "review": {"status": "unreviewed"},
                "structures": [{"key": k, "role": "assisting"} for k in atlas.exercise_structures(entry["detail"]["muscles"])],
                "anatomy_exercise": entry["detail"].get("atlas_exercise") or ref}
    return None


def search_exercises(query: str = "", limit: int = 40) -> list[dict]:
    """SEDENS Standard first, then the read-only catalog."""
    q = str(query or "").strip().lower()[:80]
    out = []
    for e in standard.exercises():
        if not q or q in e["title"]["en"].lower() or q in e["title"]["ko"] or q in e["catalog_key"].lower():
            out.append(exercise("standard", e["id"]))
    for key, e in standard.catalog().items():
        if len(out) >= limit:
            break
        if not q or q in e["name"].lower() or q in key.lower():
            out.append(exercise("catalog", key))
    return out[:limit]


# -- writing -------------------------------------------------------------------------


def _strings(value, allowed=None, items=12, length=80, field="List"):
    if value in (None, ""):
        return []
    if not isinstance(value, list) or len(value) > items:
        raise Denied(f"{field}: choose up to {items}.", 400, "invalid")
    out = []
    for v in value:
        v = text(v, length, field)
        if not v:
            continue
        if allowed is not None and v not in allowed:
            raise Denied(f"{field}: “{v}” is not one of the choices.", 400, "invalid")
        if v not in out:
            out.append(v)
    return out


def _int(value, low, high, field, default=0):
    if value in (None, ""):
        return default
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise Denied(f"{field}: enter a whole number.", 400, "invalid") from exc
    if not low <= number <= high:
        raise Denied(f"{field}: choose a number from {low} to {high}.", 400, "invalid")
    return number


def _choice(value, allowed, field, default=None):
    value = default if value in (None, "") else value
    if value not in allowed:
        raise Denied(f"{field}: choose one of the options.", 400, "invalid")
    return value


def creator_of(sedens, db, actor):
    capabilities.require(sedens, db, actor, "creator")
    profile = creators.profile_row(db, actor.user_id)
    if profile is None:
        raise Denied("Create your creator profile first.", 400, "no_profile")
    return profile


def editable(sedens, db, actor, course_id, revision):
    """The course row, after checking the actor may edit it and the revision is current."""
    from .access import can_edit

    course = row(db, course_id)
    if not can_edit(sedens, db, actor, course):
        raise Denied("This course does not exist.", 404, "unknown_course")
    if course["archived_at"]:
        raise Denied("This course is archived.", 409, "course_archived")
    if revision is None or str(revision) != str(course["revision"]):
        raise Denied("This course changed in another window. Reload it and try again.", 409, "course_changed")
    return course


def _touch(db, course_id):
    stamp = now()
    db.execute("UPDATE s_courses SET revision=revision+1, updated_at=? WHERE id=?", (stamp, course_id))
    return db.execute("SELECT revision FROM s_courses WHERE id=?", (course_id,)).fetchone()[0]


def _guard_wording(course_type, *texts):
    if course_type == "guided_training":
        wording.require_general_fitness(*texts)


def _metadata_values(data, course_type):
    values = {
        "title": text(data.get("title"), 120, "Title"),
        "subtitle": text(data.get("subtitle", ""), 160, "Subtitle"),
        "description": text(data.get("description", ""), 4000, "Description"),
        "language": _choice(data.get("language"), LANGUAGES, "Language", "ko"),
        "category": _choice(data.get("category"), CATEGORIES, "Category",
                            "education" if course_type == "professional_education" else "mobility"),
        "level": _choice(data.get("level"), LEVELS, "Level", "beginner"),
        "audience": text(data.get("audience", ""), 2000, "Intended audience"),
        "prerequisites": text(data.get("prerequisites", ""), 2000, "Prerequisites"),
        "safety": text(data.get("safety", ""), 2000, "Safety information"),
        "outcomes": text(data.get("outcomes", ""), 2000, "Outcomes"),
        "equipment": encode(_strings(data.get("equipment"), EQUIPMENT, field="Equipment")),
        "goals": encode(_strings(data.get("goals"), None, 10, 80, "Goals")),
        "body_areas": encode(_strings(data.get("body_areas"), BODY_AREAS, field="Body areas")),
        "estimated_minutes": _int(data.get("estimated_minutes"), 0, 600, "Estimated duration"),
        "weeks": _int(data.get("weeks"), 0, 52, "Weeks"),
        "sessions_per_week": _int(data.get("sessions_per_week"), 0, 14, "Sessions per week"),
    }
    if not values["title"]:
        raise Denied("Give the course a title.", 400, "invalid")
    _guard_wording(course_type, values["title"], values["subtitle"], values["description"], values["audience"],
                   values["safety"], values["outcomes"], *decode(values["goals"], []))
    return values


def create(sedens, db, actor, data) -> dict:
    profile = creator_of(sedens, db, actor)
    course_type = _choice(data.get("course_type"), TYPES, "Course type", "guided_training")
    values = _metadata_values(data, course_type)
    identifier, stamp = uid(), now()
    db.execute(
        "INSERT INTO s_courses(id,owner_org_id,creator_id,course_type,language,title,subtitle,description,category,level,"
        "audience,prerequisites,safety,outcomes,equipment,goals,body_areas,estimated_minutes,weeks,sessions_per_week,"
        "distribution,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (identifier, actor.org_id, profile["id"], course_type, values["language"], values["title"], values["subtitle"],
         values["description"], values["category"], values["level"], values["audience"], values["prerequisites"],
         values["safety"], values["outcomes"], values["equipment"], values["goals"], values["body_areas"],
         values["estimated_minutes"], values["weeks"], values["sessions_per_week"], "creator_only", actor.user_id,
         stamp, stamp),
    )
    db.execute("INSERT INTO s_course_prices(course_id,price_type,amount_minor,currency,sale_state,updated_at) "
               "VALUES (?,?,?,?,?,?)", (identifier, "free", 0, "KRW", "not_for_sale", stamp))
    sedens.audit(db, actor.org_id, actor.user_id, "course:create", identifier, {"course_type": course_type})
    return editor_view(sedens, db, actor, identifier)


def update(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("id"), data.get("revision"))
    values = _metadata_values({**metadata(course), **data}, course["course_type"])
    cover = data.get("cover_media_id", course["cover_media_id"])
    if cover:
        _own_media(db, course, cover, "image")
    db.execute(
        "UPDATE s_courses SET title=?,subtitle=?,description=?,language=?,category=?,level=?,audience=?,prerequisites=?,"
        "safety=?,outcomes=?,equipment=?,goals=?,body_areas=?,estimated_minutes=?,weeks=?,sessions_per_week=?,"
        "cover_media_id=? WHERE id=?",
        (values["title"], values["subtitle"], values["description"], values["language"], values["category"],
         values["level"], values["audience"], values["prerequisites"], values["safety"], values["outcomes"],
         values["equipment"], values["goals"], values["body_areas"], values["estimated_minutes"], values["weeks"],
         values["sessions_per_week"], cover or None, course["id"]),
    )
    _touch(db, course["id"])
    return editor_view(sedens, db, actor, course["id"])


def set_access(sedens, db, actor, data) -> dict:
    """Distribution, per-facility terms and price, each chosen on its own."""
    course = editable(sedens, db, actor, data.get("id"), data.get("revision"))
    distribution = _choice(data.get("distribution"), DISTRIBUTIONS, "Who can offer it", course["distribution"])
    requested = data.get("facilities", [])
    if not isinstance(requested, list) or len(requested) > 50:
        raise Denied("Choose up to 50 facilities.", 400, "invalid")
    from .access import network_basis

    targets = []
    for item in requested:
        if not isinstance(item, dict):
            raise Denied("Choose facilities from the list.", 400, "invalid")
        org_id, location_id = item.get("org_id"), item.get("location_id") or None
        target = sedens.org(db, org_id) if isinstance(org_id, str) else None
        # Only the creator's own facility, or one that approved an affiliation with them.
        if target is None or target["kind"] != "facility" or network_basis(db, course, org_id, location_id) is None:
            raise Denied("Choose facilities from your network.", 404, "unknown_facility")
        if location_id and not db.execute("SELECT 1 FROM p_locations WHERE id=? AND org_id=?",
                                          (location_id, org_id)).fetchone():
            raise Denied("Choose a location of that facility.", 404, "unknown_location")
        if (org_id, location_id) not in [(t[0], t[1]) for t in targets]:
            targets.append((org_id, location_id, 1 if item.get("free") else 0))
    if distribution == "selected_facilities" and not targets:
        raise Denied("Choose at least one facility.", 400, "no_facilities")
    p = data.get("price") or {}
    price_type = _choice(p.get("price_type"), ("free", "paid"), "Price", "free")
    amount = _int(p.get("amount_minor"), 0, 100_000_000, "Price") if price_type == "paid" else 0
    if price_type == "paid" and amount <= 0:
        raise Denied("Enter a price above zero, or choose Free.", 400, "invalid_price")
    currency = _choice(p.get("currency"), CURRENCIES, "Currency", "KRW")
    sale_state = _choice(p.get("sale_state"), SALE_STATES, "Sale status", "active")
    stamp = now()
    db.execute("UPDATE s_courses SET distribution=? WHERE id=?", (distribution, course["id"]))
    db.execute("DELETE FROM s_course_facility_terms WHERE course_id=?", (course["id"],))
    for org_id, location_id, free in targets:
        db.execute("INSERT INTO s_course_facility_terms(id,course_id,org_id,location_id,free,created_at) VALUES (?,?,?,?,?,?)",
                   (uid(), course["id"], org_id, location_id, free, stamp))
    db.execute(
        "INSERT INTO s_course_prices(course_id,price_type,amount_minor,currency,sale_state,updated_at) VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(course_id) DO UPDATE SET price_type=excluded.price_type, amount_minor=excluded.amount_minor, "
        "currency=excluded.currency, sale_state=excluded.sale_state, updated_at=excluded.updated_at",
        (course["id"], price_type, amount, currency, sale_state, stamp),
    )
    _touch(db, course["id"])
    sedens.audit(db, actor.org_id, actor.user_id, "course:access", course["id"],
                 {"distribution": distribution, "facilities": len(targets), "price_type": price_type})
    return editor_view(sedens, db, actor, course["id"])


def _own_media(db, course, media_id, kind):
    """A file of this course's own creator (not a colleague's, even in the same
    organization), of the given kind, with rights recorded."""
    found = db.execute(
        "SELECT o.kind, o.state, o.owner_org_id, o.creator_id, r.object_id AS rights FROM s_media_objects o "
        "LEFT JOIN s_media_rights r ON r.object_id=o.id WHERE o.id=?", (media_id,)).fetchone()
    if found is None or found["owner_org_id"] != course["owner_org_id"] or found["creator_id"] != course["creator_id"] \
            or found["state"] != "ready":
        raise Denied("Choose a file from your course media.", 404, "unknown_media")
    if found["kind"] != kind:
        raise Denied(f"Choose a {kind} file here.", 400, "wrong_media_kind")
    if found["rights"] is None:
        raise Denied("This file has no rights information yet.", 400, "rights_required")


def _renumber(db, table, parent_column, parent_id, moved_id=None, target=None):
    ids = [r[0] for r in db.execute(f"SELECT id FROM {table} WHERE {parent_column}=? ORDER BY position, created_at",
                                    (parent_id,))]
    if moved_id is not None and moved_id in ids:
        ids.remove(moved_id)
        ids.insert(max(0, min(int(target), len(ids))), moved_id)
    for index, identifier in enumerate(ids):
        db.execute(f"UPDATE {table} SET position=? WHERE id=?", (index, identifier))


def save_module(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("course_id"), data.get("revision"))
    title = text(data.get("title"), 120, "Module title")
    summary = text(data.get("summary", ""), 1000, "Module summary")
    if not title:
        raise Denied("Give the module a title.", 400, "invalid")
    _guard_wording(course["course_type"], title, summary)
    stamp = now()
    if data.get("id"):
        changed = db.execute("UPDATE s_course_modules SET title=?, summary=?, updated_at=? WHERE id=? AND course_id=?",
                             (title, summary, stamp, data["id"], course["id"])).rowcount
        if not changed:
            raise Denied("This module does not exist.", 404, "unknown_module")
    else:
        if db.execute("SELECT count(*) FROM s_course_modules WHERE course_id=?", (course["id"],)).fetchone()[0] >= MAX_MODULES:
            raise Denied(f"A course has at most {MAX_MODULES} modules.", 400, "too_many")
        db.execute("INSERT INTO s_course_modules(id,course_id,position,title,summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                   (uid(), course["id"], 10_000, title, summary, stamp, stamp))
        _renumber(db, "s_course_modules", "course_id", course["id"])
    _touch(db, course["id"])
    return editor_view(sedens, db, actor, course["id"])


def _owned(db, table, item_id, course_id, label):
    found = db.execute(f"SELECT * FROM {table} WHERE id=? AND course_id=?", (item_id, course_id)).fetchone() \
        if item_id else None
    if found is None:
        raise Denied(f"This {label} does not exist.", 404, f"unknown_{label}")
    return found


def save_session(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("course_id"), data.get("revision"))
    if course["course_type"] != "guided_training":
        raise Denied("Workout sessions belong to guided training courses.", 400, "wrong_course_type")
    module = _owned(db, "s_course_modules", data.get("module_id"), course["id"], "module")
    title = text(data.get("title"), 120, "Session title")
    summary = text(data.get("summary", ""), 1000, "Session summary")
    minutes = _int(data.get("estimated_minutes"), 0, 240, "Session length")
    if not title:
        raise Denied("Give the session a title.", 400, "invalid")
    _guard_wording(course["course_type"], title, summary)
    stamp = now()
    if data.get("id"):
        session = _owned(db, "s_course_sessions", data["id"], course["id"], "session")
        db.execute("UPDATE s_course_sessions SET module_id=?, title=?, summary=?, estimated_minutes=?, updated_at=? WHERE id=?",
                   (module["id"], title, summary, minutes, stamp, session["id"]))
        if session["module_id"] != module["id"]:
            db.execute("UPDATE s_course_sessions SET position=10000 WHERE id=?", (session["id"],))
            _renumber(db, "s_course_sessions", "module_id", session["module_id"])
            _renumber(db, "s_course_sessions", "module_id", module["id"])
    else:
        if db.execute("SELECT count(*) FROM s_course_sessions WHERE course_id=?", (course["id"],)).fetchone()[0] >= MAX_SESSIONS:
            raise Denied(f"A course has at most {MAX_SESSIONS} sessions.", 400, "too_many")
        db.execute("INSERT INTO s_course_sessions(id,course_id,module_id,position,title,summary,estimated_minutes,created_at,updated_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?)", (uid(), course["id"], module["id"], 10_000, title, summary, minutes, stamp, stamp))
        _renumber(db, "s_course_sessions", "module_id", module["id"])
    _touch(db, course["id"])
    return editor_view(sedens, db, actor, course["id"])


def _step_values(course, data, session_id):
    source = _choice(data.get("exercise_source"), ("standard", "catalog"), "Exercise source", "standard")
    ref = text(data.get("exercise_ref"), 80, "Exercise")
    found = exercise(source, ref)
    if found is None:
        raise Denied("Choose an exercise from the library.", 400, "unknown_exercise")
    values = {
        "phase": _choice(data.get("phase"), PHASES, "Part of the session", "main"),
        "exercise_source": source, "exercise_ref": ref,
        "title": text(data.get("title", ""), 120, "Step title"),
        "sets": _int(data.get("sets"), 1, 20, "Sets", 1),
        "reps": _int(data.get("reps"), 0, 100, "Repetitions"),
        "hold_seconds": _int(data.get("hold_seconds"), 0, 600, "Hold"),
        "work_seconds": _int(data.get("work_seconds"), 0, 3600, "Work time"),
        "rest_seconds": _int(data.get("rest_seconds"), 0, 600, "Rest"),
        "sides": _choice(data.get("sides"), SIDES, "Sides", "none"),
        "regression": text(data.get("regression", ""), 600, "Easier option"),
        "progression": text(data.get("progression", ""), 600, "Harder option"),
        "customer_cue": text(data.get("customer_cue", ""), 280, "Cue"),
        "narration": text(data.get("narration", ""), 2000, "Narration"),
        "video_media_id": data.get("video_media_id") or None,
        "image_media_id": data.get("image_media_id") or None,
        "equipment": encode(_strings(data.get("equipment"), EQUIPMENT, field="Equipment")),
        "advance": _choice(data.get("advance"), ("manual", "auto"), "Next step", "manual"),
        "variant": _choice(data.get("variant"), ("standard", "easier", "harder"), "Variant", "standard"),
        "variant_of": data.get("variant_of") or None,
        "atlas_depth": _choice(data.get("atlas_depth"), atlas.DEPTHS, "Anatomy view", "taught"),
    }
    if values["reps"] == 0 and values["hold_seconds"] == 0 and values["work_seconds"] == 0:
        raise Denied("Set repetitions, a hold or a work time for this step.", 400, "invalid_dose")
    if (values["variant_of"] is None) != (values["variant"] == "standard"):
        raise Denied("An easier or harder variant belongs to another step of this session.", 400, "invalid_variant")
    _guard_wording(course["course_type"], values["title"], values["regression"], values["progression"],
                   values["customer_cue"], values["narration"])
    return values


def save_step(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("course_id"), data.get("revision"))
    if course["course_type"] != "guided_training":
        raise Denied("Steps belong to guided training sessions.", 400, "wrong_course_type")
    session = _owned(db, "s_course_sessions", data.get("session_id"), course["id"], "session")
    values = _step_values(course, data, session["id"])
    for column, kind in (("video_media_id", "video"), ("image_media_id", "image")):
        if values[column]:
            _own_media(db, course, values[column], kind)
    if values["variant_of"]:
        parent = _owned(db, "s_course_steps", values["variant_of"], course["id"], "step")
        if parent["session_id"] != session["id"] or parent["variant_of"] is not None or parent["id"] == data.get("id"):
            raise Denied("An easier or harder variant belongs to another step of this session.", 400, "invalid_variant")
    stamp = now()
    columns = list(values)
    if data.get("id"):
        step = _owned(db, "s_course_steps", data["id"], course["id"], "step")
        if step["session_id"] != session["id"]:
            raise Denied("Move a step between sessions by removing and adding it.", 400, "invalid")
        db.execute(f"UPDATE s_course_steps SET {', '.join(c + '=?' for c in columns)}, updated_at=? WHERE id=?",
                   (*values.values(), stamp, step["id"]))
        step_id = step["id"]
    else:
        if db.execute("SELECT count(*) FROM s_course_steps WHERE session_id=?", (session["id"],)).fetchone()[0] >= MAX_STEPS:
            raise Denied(f"A session has at most {MAX_STEPS} steps.", 400, "too_many")
        step_id = uid()
        db.execute(f"INSERT INTO s_course_steps(id,course_id,session_id,position,{', '.join(columns)},created_at,updated_at) "
                   f"VALUES (?,?,?,?,{', '.join('?' for _ in columns)},?,?)",
                   (step_id, course["id"], session["id"], 10_000, *values.values(), stamp, stamp))
        _renumber(db, "s_course_steps", "session_id", session["id"])
        # A new step starts with its exercise's own anatomy mapping.
        found = exercise(values["exercise_source"], values["exercise_ref"])
        keys = [s for s in found["structures"] if atlas.get(s["key"])][: atlas.MAX_STRUCTURES]
        _write_anatomy(db, step_id, keys)
    _touch(db, course["id"])
    view = editor_view(sedens, db, actor, course["id"])
    view["saved_step_id"] = step_id
    return view


def _write_anatomy(db, step_id, structures):
    db.execute("DELETE FROM s_course_step_anatomy WHERE step_id=?", (step_id,))
    for index, s in enumerate(structures):
        db.execute("INSERT INTO s_course_step_anatomy(step_id,structure_key,role,position) VALUES (?,?,?,?)",
                   (step_id, s["key"], s["role"], index))


def save_anatomy(sedens, db, actor, data) -> dict:
    """A step's structures (by atlas name) and its timeline segments."""
    course = editable(sedens, db, actor, data.get("course_id"), data.get("revision"))
    step = _owned(db, "s_course_steps", data.get("step_id"), course["id"], "step")
    raw = data.get("structures", [])
    if not isinstance(raw, list):
        raise Denied("Choose body structures from the anatomy list.", 400, "invalid_structures")
    roles = {}
    for item in raw:
        if not isinstance(item, dict):
            raise Denied("Choose body structures from the anatomy list.", 400, "invalid_structures")
        roles[item.get("key")] = _choice(item.get("role"), ROLES, "Role", "assisting")
    keys = atlas.validate(list(roles), step["atlas_depth"])
    segments = data.get("timeline", [])
    if not isinstance(segments, list) or len(segments) > MAX_SEGMENTS:
        raise Denied(f"A step has at most {MAX_SEGMENTS} anatomy moments.", 400, "invalid")
    clean, last_end = [], 0
    for seg in sorted(segments, key=lambda s: _int(s.get("start_ms"), 0, 3_600_000, "Start") if isinstance(s, dict) else 0):
        if not isinstance(seg, dict):
            raise Denied("Each anatomy moment needs a start, an end and structures.", 400, "invalid")
        start = _int(seg.get("start_ms"), 0, 3_600_000, "Start")
        end = _int(seg.get("end_ms"), 1, 3_600_000, "End")
        if end <= start or start < last_end:
            raise Denied("Anatomy moments must not overlap, and each must end after it starts.", 400, "invalid_timeline")
        last_end = end
        structures = atlas.validate(seg.get("structures", []), step["atlas_depth"])
        if not structures:
            raise Denied("Each anatomy moment shows at least one structure.", 400, "invalid_timeline")
        cue = text(seg.get("cue", ""), 280, "Cue")
        _guard_wording(course["course_type"], cue)
        clean.append((uid(), start, end, _choice(seg.get("mode"), ("highlight", "isolate"), "Display", "highlight"),
                      _choice(seg.get("layer", ""), LAYERS, "Layer", ""), encode(structures), cue))
    _write_anatomy(db, step["id"], [{"key": k, "role": roles[k]} for k in keys])
    db.execute("DELETE FROM s_course_step_timeline WHERE step_id=?", (step["id"],))
    for index, (sid, start, end, mode, layer, structures, cue) in enumerate(clean):
        db.execute("INSERT INTO s_course_step_timeline(id,step_id,position,start_ms,end_ms,mode,layer,structures,cue) "
                   "VALUES (?,?,?,?,?,?,?,?,?)", (sid, step["id"], index, start, end, mode, layer, structures, cue))
    _touch(db, course["id"])
    return editor_view(sedens, db, actor, course["id"])


def save_lesson(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("course_id"), data.get("revision"))
    if course["course_type"] != "professional_education":
        raise Denied("Lessons belong to professional education courses.", 400, "wrong_course_type")
    module = _owned(db, "s_course_modules", data.get("module_id"), course["id"], "module")
    kind = _choice(data.get("kind"), LESSON_KINDS, "Lesson type", "article")
    title = text(data.get("title"), 120, "Lesson title")
    body = text(data.get("body", ""), 20_000, "Lesson text")
    if not title:
        raise Denied("Give the lesson a title.", 400, "invalid")
    media_id = data.get("media_id") or None
    if media_id:
        _own_media(db, course, media_id, {"video": "video", "pdf": "pdf", "image": "image"}.get(kind, "image"))
    source = ref = None
    if data.get("exercise_ref"):
        source = _choice(data.get("exercise_source"), ("standard", "catalog"), "Exercise source", "standard")
        ref = text(data.get("exercise_ref"), 80, "Exercise")
        if exercise(source, ref) is None:
            raise Denied("Choose an exercise from the library.", 400, "unknown_exercise")
    detail = data.get("detail") or {}
    if not isinstance(detail, dict) or len(encode(detail)) > 20_000:
        raise Denied("This lesson's extra content is too large.", 400, "invalid")
    stamp = now()
    if data.get("id"):
        lesson = _owned(db, "s_course_lessons", data["id"], course["id"], "lesson")
        db.execute("UPDATE s_course_lessons SET module_id=?, kind=?, title=?, body=?, media_id=?, exercise_source=?, "
                   "exercise_ref=?, detail=?, updated_at=? WHERE id=?",
                   (module["id"], kind, title, body, media_id, source, ref, encode(detail), stamp, lesson["id"]))
    else:
        if db.execute("SELECT count(*) FROM s_course_lessons WHERE course_id=?", (course["id"],)).fetchone()[0] >= MAX_LESSONS:
            raise Denied(f"A course has at most {MAX_LESSONS} lessons.", 400, "too_many")
        db.execute("INSERT INTO s_course_lessons(id,course_id,module_id,position,kind,title,body,media_id,exercise_source,"
                   "exercise_ref,detail,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (uid(), course["id"], module["id"], 10_000, kind, title, body, media_id, source, ref, encode(detail),
                    stamp, stamp))
        _renumber(db, "s_course_lessons", "module_id", module["id"])
    _touch(db, course["id"])
    return editor_view(sedens, db, actor, course["id"])


ITEM_TABLES = {"module": ("s_course_modules", "course_id"), "session": ("s_course_sessions", "module_id"),
               "step": ("s_course_steps", "session_id"), "lesson": ("s_course_lessons", "module_id")}


def move(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("course_id"), data.get("revision"))
    kind = _choice(data.get("kind"), tuple(ITEM_TABLES), "Item")
    table, parent = ITEM_TABLES[kind]
    item = _owned(db, table, data.get("id"), course["id"], kind)
    _renumber(db, table, parent, item[parent], item["id"], _int(data.get("position"), 0, 1000, "Position"))
    _touch(db, course["id"])
    return editor_view(sedens, db, actor, course["id"])


def remove(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("course_id"), data.get("revision"))
    kind = _choice(data.get("kind"), tuple(ITEM_TABLES), "Item")
    table, parent = ITEM_TABLES[kind]
    item = _owned(db, table, data.get("id"), course["id"], kind)
    db.execute(f"DELETE FROM {table} WHERE id=?", (item["id"],))
    _renumber(db, table, parent, item[parent])
    _touch(db, course["id"])
    return editor_view(sedens, db, actor, course["id"])


# -- versions ------------------------------------------------------------------------


def _media_summary(db, media_id):
    if not media_id:
        return None
    o = db.execute("SELECT o.*, r.licence_type, r.original_creator, r.identifiable_person, r.review_status "
                   "FROM s_media_objects o LEFT JOIN s_media_rights r ON r.object_id=o.id WHERE o.id=?",
                   (media_id,)).fetchone()
    if o is None:
        return None
    return {"id": o["id"], "kind": o["kind"], "mime": o["mime"], "source": o["source"], "title": o["title"],
            "sha256": o["sha256"], "licence_type": o["licence_type"], "original_creator": o["original_creator"],
            "identifiable_person": o["identifiable_person"], "rights_review": o["review_status"]}


def snapshot(sedens, db, course) -> dict:
    """The whole course as customers will see it, frozen with everything it needs."""
    profile = db.execute("SELECT * FROM s_creator_profiles WHERE id=?", (course["creator_id"],)).fetchone()
    modules = tree(db, course)
    media_ids = {course["cover_media_id"]} - {None}
    for m in modules:
        for s in m.get("sessions", []):
            for step in s["steps"]:
                media_ids |= {step["video_media_id"], step["image_media_id"]} - {None}
                step["video"] = _media_summary(db, step["video_media_id"])
                step["image"] = _media_summary(db, step["image_media_id"])
        for lesson in m.get("lessons", []):
            media_ids |= {lesson["media_id"]} - {None}
            lesson["media"] = _media_summary(db, lesson["media_id"])
    return {
        "schema": SNAPSHOT_SCHEMA,
        "course": metadata(course),
        "cover": _media_summary(db, course["cover_media_id"]),
        "creator": {"id": profile["id"], "display_name": profile["display_name"],
                    "creator_type": profile["creator_type"], "verification_state": profile["verification_state"]},
        "owner_org_id": course["owner_org_id"],
        "price": price(db, course["id"]),
        "distribution": course["distribution"],
        "facilities": terms(sedens, db, course["id"]),
        "modules": modules,
        "media": sorted(media_ids),
        "standard_version": standard.document()["version"],
        "atlas_hash": atlas.atlas_hash(),
    }


def readiness(sedens, db, course) -> list[str]:
    """What still stops the draft from being submitted (codes the studio explains)."""
    problems = []
    modules = tree(db, course)
    if not modules:
        problems.append("no_modules")
    if course["course_type"] == "guided_training":
        sessions = [s for m in modules for s in m.get("sessions", [])]
        if not sessions:
            problems.append("no_sessions")
        if any(not s["steps"] for s in sessions):
            problems.append("empty_session")
    elif not any(m.get("lessons") for m in modules):
        problems.append("no_lessons")
    if course["distribution"] == "creator_only":
        problems.append("no_distribution")
    p = price(db, course["id"])
    if p["price_type"] == "paid" and p["sale_state"] != "active":
        problems.append("price_not_on_sale")
    if db.execute(
        "SELECT 1 FROM s_media_rights r JOIN s_media_objects o ON o.id=r.object_id WHERE r.review_status='rejected' "
        "AND o.id IN (SELECT value FROM json_each(?))", (encode(snapshot(sedens, db, course)["media"]),)).fetchone():
        problems.append("media_rights_rejected")
    return problems


def submit(sedens, db, actor, data) -> dict:
    """Freeze the draft into a new version and send it for SEDENS review.
    Run inside ``sedens.batch()``."""
    course = editable(sedens, db, actor, data.get("id"), data.get("revision"))
    if course["suspended_at"]:
        raise Denied("SEDENS suspended this course. Contact SEDENS before submitting again.", 409, "course_suspended")
    problems = readiness(sedens, db, course)
    if problems:
        raise Denied("This course is not ready to submit yet.", 400, "not_ready")
    body = snapshot(sedens, db, course)
    encoded = encode(body)
    number = db.execute("SELECT COALESCE(MAX(version),0)+1 FROM s_course_versions WHERE course_id=?",
                        (course["id"],)).fetchone()[0]
    stamp = now()
    db.execute("UPDATE s_course_versions SET state='withdrawn', decided_at=? WHERE course_id=? AND state IN ('submitted','needs_revision')",
               (stamp, course["id"]))
    version_id = uid()
    db.execute("INSERT INTO s_course_versions(id,course_id,version,state,snapshot,snapshot_sha256,submitted_by,submitted_at,note) "
               "VALUES (?,?,?,?,?,?,?,?,?)",
               (version_id, course["id"], number, "submitted", encoded, hashlib.sha256(encoded.encode()).hexdigest(),
                actor.user_id, stamp, text(data.get("note", ""), 1000, "Note for the reviewer")))
    for media_id in body["media"]:
        db.execute("INSERT OR IGNORE INTO s_course_version_media(version_id,object_id) VALUES (?,?)", (version_id, media_id))
    sedens.audit(db, actor.org_id, actor.user_id, "course:submit", course["id"], {"version": number})
    return editor_view(sedens, db, actor, course["id"])


def archive(sedens, db, actor, data) -> dict:
    course = editable(sedens, db, actor, data.get("id"), data.get("revision"))
    db.execute("UPDATE s_courses SET archived_at=?, revision=revision+1 WHERE id=?", (now(), course["id"]))
    sedens.audit(db, actor.org_id, actor.user_id, "course:archive", course["id"])
    return {"archived": True, "id": course["id"]}


def version(db, course_id, number) -> dict | None:
    found = db.execute("SELECT * FROM s_course_versions WHERE course_id=? AND version=?", (course_id, number)).fetchone()
    if found is None:
        return None
    return {"version": found["version"], "state": found["state"], "submitted_at": found["submitted_at"],
            "decided_at": found["decided_at"], "note": found["note"], "snapshot": decode(found["snapshot"], {}),
            "snapshot_sha256": found["snapshot_sha256"]}


def versions(db, course_id) -> list[dict]:
    return [{"version": v["version"], "state": v["state"], "submitted_at": v["submitted_at"],
             "decided_at": v["decided_at"], "note": v["note"]}
            for v in db.execute("SELECT * FROM s_course_versions WHERE course_id=? ORDER BY version DESC", (course_id,))]


def reviews(db, course_id) -> list[dict]:
    return [{"version": r["version"], "decision": r["decision"], "checklist": decode(r["checklist"], {}),
             "comment": r["comment"], "created_at": r["created_at"]}
            for r in db.execute("SELECT * FROM s_course_reviews WHERE course_id=? ORDER BY created_at DESC", (course_id,))]


def editor_view(sedens, db, actor, course_id) -> dict:
    """Everything the Creator Studio shows for one course."""
    course = row(db, course_id)
    return {
        "course": metadata(course),
        "revision": course["revision"],
        "review_state": review_state(db, course),
        "visibility": visibility(db, course),
        "published_version": course["published_version"],
        "suspended_reason": course["suspended_reason"] if course["suspended_at"] else "",
        "price": price(db, course_id),
        "facilities": terms(sedens, db, course_id),
        "modules": tree(db, course),
        "versions": versions(db, course_id),
        "reviews": reviews(db, course_id),
        "readiness": readiness(sedens, db, course),
        "wording_notes": wording.findings(course["title"], course["description"], course["outcomes"])
        if course["course_type"] == "professional_education" else [],
    }


def list_for_creator(sedens, db, actor) -> list[dict]:
    profile = creators.profile_row(db, actor.user_id)
    if profile is None:
        return []
    out = []
    for c in db.execute("SELECT * FROM s_courses WHERE creator_id=? AND owner_org_id=? ORDER BY updated_at DESC",
                        (profile["id"], actor.org_id)):
        out.append({"id": c["id"], "title": c["title"], "course_type": c["course_type"], "language": c["language"],
                    "review_state": review_state(db, c), "visibility": visibility(db, c),
                    "published_version": c["published_version"], "price": price(db, c["id"]),
                    "distribution": c["distribution"], "updated_at": c["updated_at"]})
    return out

