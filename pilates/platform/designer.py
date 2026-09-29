"""Validated coach program design, immutable revisions, and student-safe projection."""

from __future__ import annotations

from datetime import date
import json
from urllib.parse import urlparse

from .repository import Refused, encode, now, uid, unpack

STATUSES = {"Draft", "Active", "Completed", "Archived"}
MEDIA_KINDS = {
    "coach_demonstration", "coach_photo", "exercise_library", "client_capture",
    "ai_generated_visual", "demo_media",
}
REFERENCE_TYPES = {"youtube", "vimeo", "research", "article", "pdf", "website", "video", "other"}
SOURCE_KINDS = {"analysis", "coach_observation", "client_feedback", "manual"}


def _short(value, length=3000):
    value = str(value or "").strip()
    if len(value) > length:
        raise Refused("Program text is too long.")
    return value


def _region_ids(db, value):
    if not isinstance(value, list) or len(value) > 20 or any(not isinstance(v, str) for v in value):
        raise Refused("Choose up to 20 target body regions.")
    result = list(dict.fromkeys(value))
    for region in result:
        if not db.execute("SELECT 1 FROM p_regions WHERE id=?", (region,)).fetchone():
            raise Refused("Choose a listed anatomical region.")
    return result


def program_detail(repo, actor, value, db):
    if not isinstance(value, dict):
        raise Refused("Enter the program details.")
    result = dict(value)
    result.setdefault("status", "Draft")
    if result["status"] not in STATUSES:
        raise Refused("Choose Draft, Active, Completed or Archived status.")
    if "target_region_ids" in result:
        result["target_region_ids"] = _region_ids(db, result["target_region_ids"])
    if result.get("student_id"):
        repo.assert_student(actor, result["student_id"], True, db)
    if result.get("source_analysis_id"):
        source = repo.get(actor, "analyses", result["source_analysis_id"], db)
        if result.get("student_id") and source["student_id"] != result["student_id"]:
            raise Refused("The source analysis belongs to another client.")
    if "source_finding" in result:
        result["source_finding"] = _short(result["source_finding"], 300)
    if "start_date" in result and result["start_date"]:
        try:
            date.fromisoformat(result["start_date"])
        except (ValueError, TypeError) as exc:
            raise Refused("Enter a valid program start date.") from exc
    for field, minimum, maximum in (("duration_weeks", 1, 104), ("sessions_per_week", 1, 14)):
        if field in result and result[field] not in (None, ""):
            try:
                value = int(result[field])
            except (ValueError, TypeError) as exc:
                raise Refused("Enter valid program frequency and duration.") from exc
            if value < minimum or value > maximum:
                raise Refused("Enter valid program frequency and duration.")
            result[field] = value
    if "phases" in result:
        phases = result["phases"]
        if not isinstance(phases, list) or len(phases) > 16:
            raise Refused("Use at most 16 program phases.")
        names = set()
        for phase in phases:
            if not isinstance(phase, dict) or not _short(phase.get("name"), 80):
                raise Refused("Name each program phase.")
            if phase["name"] in names:
                raise Refused("Use distinct phase names.")
            names.add(phase["name"])
            for key in ("weeks_start", "weeks_end"):
                if key in phase and phase[key] not in (None, ""):
                    try:
                        phase[key] = int(phase[key])
                    except (ValueError, TypeError) as exc:
                        raise Refused("Enter valid phase weeks.") from exc
                    if not 1 <= phase[key] <= 104:
                        raise Refused("Enter valid phase weeks.")
            if phase.get("weeks_start") and phase.get("weeks_end") and phase["weeks_start"] > phase["weeks_end"]:
                raise Refused("A phase must end after it starts.")
    for key in ("description", "coach_notes", "phase"):
        if key in result:
            result[key] = _short(result[key], 5000 if key != "phase" else 80)
    for key in ("template", "program_only"):
        if key in result:
            result[key] = bool(result[key])
    if result.get("template_visibility", "private") not in {"private", "organization"}:
        raise Refused("Choose a valid template visibility.")
    if result.get("template") and result.get("template_visibility") == "organization" and (result.get("student_id") or result.get("source_analysis_id")):
        raise Refused("Remove client-specific evidence before sharing a template.")
    if len(encode(result)) > 60_000:
        raise Refused("Program details are too large.")
    return result


def _source(repo, actor, value, db, student_id=None):
    if value is None:
        return "manual", ""
    if not isinstance(value, dict) or value.get("kind") not in SOURCE_KINDS:
        raise Refused("Choose the reason source for this change.")
    kind = value["kind"]
    identifier = str(value.get("id") or "")
    if kind == "analysis":
        if not identifier:
            raise Refused("Select the related analysis.")
        target = repo.get(actor, "analyses", identifier, db)
        if student_id and target["student_id"] != student_id:
            raise Refused("The analysis belongs to another client.")
    elif kind in ("coach_observation", "client_feedback"):
        if not identifier:
            raise Refused("Select the related coach feedback.")
        target = repo.get(actor, "notes", identifier, db)
        if student_id and target["student_id"] != student_id:
            raise Refused("The feedback belongs to another client.")
    elif identifier:
        raise Refused("Manual changes do not use a source record.")
    return kind, identifier


def step_detail(repo, actor, exercise_id, value, db, student_id=None, program_location_id=None):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise Refused("Enter exercise step details.")
    result = dict(value)
    if "target_region_ids" in result:
        result["target_region_ids"] = _region_ids(db, result["target_region_ids"])
    if result.get("side", "Both") not in {"Left", "Right", "Both"}:
        raise Refused("Choose Left, Right or Both for the exercise side.")
    equipment = result.get("equipment", [])
    if not isinstance(equipment, list) or len(equipment) > 20:
        raise Refused("Choose up to 20 equipment items for a movement.")
    normalized_equipment = []
    seen_equipment = set()
    for entry in equipment:
        if not isinstance(entry, dict) or not isinstance(entry.get("equipment_id"), str):
            raise Refused("Choose equipment from the studio inventory.")
        equipment_id = entry["equipment_id"]
        if equipment_id in seen_equipment:
            raise Refused("Choose each equipment item once per movement.")
        seen_equipment.add(equipment_id)
        item = repo.get(actor, "equipment", equipment_id, db)
        if program_location_id and item["location_id"] != program_location_id:
            raise Refused("Choose equipment at the program location.")
        try:
            quantity = int(entry.get("quantity", 1))
        except (TypeError, ValueError) as exc:
            raise Refused("Enter a valid equipment quantity.") from exc
        if not 1 <= quantity <= 50 or quantity > item["quantity"]:
            raise Refused("Equipment quantity exceeds the studio inventory.")
        normalized_equipment.append({
            "equipment_id": equipment_id,
            "quantity": quantity,
            "name": item["name"],
        })
    if "equipment" in result:
        result["equipment"] = normalized_equipment
    media = result.get("media", [])
    if not isinstance(media, list) or len(media) > 16:
        raise Refused("Attach at most 16 photos or videos to a step.")
    primary = 0
    for entry in media:
        if not isinstance(entry, dict) or entry.get("kind") not in MEDIA_KINDS:
            raise Refused("Label each exercise photo or video source.")
        if entry.get("visibility", "student") not in {"student", "coach"}:
            raise Refused("Choose who can view this media.")
        if entry.get("stage", "other") not in {"start", "end", "other"}:
            raise Refused("Choose Start, End or Other for the photo position.")
        target = repo.get(actor, "media", entry.get("media_id"), db)
        if target["kind"] == "exercise":
            if target.get("exercise_id") != exercise_id:
                raise Refused("Attach media belonging to this exercise.")
        elif target["kind"] == "capture" and entry["kind"] == "client_capture":
            if not student_id or target.get("student_id") != student_id:
                raise Refused("A client capture can only appear in that client's program.")
        else:
            raise Refused("Choose an exercise illustration or the matching client capture.")
        if entry.get("primary"):
            if not target["mime"].startswith("video/"):
                raise Refused("The primary demonstration must be a video.")
            primary += 1
        entry["caption"] = _short(entry.get("caption"), 1000)
    if primary > 1:
        raise Refused("Select one primary demonstration video per step.")
    references = result.get("references", [])
    if not isinstance(references, list) or len(references) > 20:
        raise Refused("Attach at most 20 external references per step.")
    for ref in references:
        if not isinstance(ref, dict):
            raise Refused("Enter a valid reference.")
        parsed = urlparse(str(ref.get("url") or ""))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or len(ref["url"]) > 2000:
            raise Refused("References need a valid http or https URL.")
        if ref.get("type", "other") not in REFERENCE_TYPES:
            raise Refused("Choose a reference type.")
        if ref.get("visibility", "student") not in {"student", "coach"}:
            raise Refused("Choose who can view this reference.")
        ref["title"] = _short(ref.get("title") or ref["url"], 180)
        ref["description"] = _short(ref.get("description"), 1000)
    if "source" in result:
        kind, identifier = _source(repo, actor, result["source"], db, student_id)
        result["source"] = {"kind": kind, "id": identifier}
    for key in ("section", "purpose", "coach_instructions", "student_instructions", "tempo", "difficulty", "position", "progression", "regression", "precautions", "coach_cue", "common_mistake", "success_criteria", "why_assigned", "resistance"):
        if key in result:
            result[key] = _short(result[key], 4000)
    if len(encode(result)) > 50_000:
        raise Refused("Exercise step details are too large.")
    return result


def student_step(step):
    row = dict(step)
    row.pop("notes", None)
    detail = dict(row.get("detail") or {})
    for key in ("coach_instructions", "common_mistake"):
        detail.pop(key, None)
    detail["media"] = [m for m in detail.get("media", []) if m.get("visibility", "student") == "student"]
    detail["references"] = [r for r in detail.get("references", []) if r.get("visibility", "student") == "student"]
    row["detail"] = detail
    return row


def student_program(program):
    row = dict(program)
    detail = dict(row.get("detail") or {})
    detail.pop("coach_notes", None)
    detail.pop("copied_from", None)
    row["detail"] = detail
    row["steps"] = [student_step(step) for step in row.get("steps", []) if step.get("type") != "note" or step.get("visibility", "student") == "student"]
    return row


def snapshot(repo, program_id, db):
    program = unpack(db.execute("SELECT * FROM p_programs WHERE id=?", (program_id,)).fetchone())
    steps = []
    for row in db.execute("SELECT pe.*, sd.detail AS step_detail,e.name AS exercise_name,e.category AS exercise_category,e.region_id AS exercise_region_id,e.detail AS exercise_detail FROM p_program_exercises pe LEFT JOIN p_program_step_details sd ON sd.step_id=pe.id JOIN p_exercises e ON e.id=pe.exercise_id WHERE pe.program_id=? ORDER BY pe.position", (program_id,)):
        item = dict(row)
        item["detail"] = json.loads(item.pop("step_detail") or "{}")
        item["exercise_detail"] = json.loads(item["exercise_detail"] or "{}")
        steps.append(item)
    steps.extend({**dict(row), "type": "note"} for row in db.execute("SELECT * FROM p_program_step_notes WHERE program_id=?", (program_id,)))
    steps.sort(key=lambda row: row["position"])
    program["steps"] = steps
    return program


def record_revision(repo, actor, program_id, item, db):
    state = snapshot(repo, program_id, db)
    student_id = state["detail"].get("student_id")
    assignments = [r[0] for r in db.execute("SELECT DISTINCT student_id FROM p_program_assignments WHERE program_id=?", (program_id,))]
    if student_id and assignments and any(s != student_id for s in assignments):
        raise Refused("This plan is assigned to another client. Duplicate it first.")
    if len(assignments) > 1 and item.get("id"):
        raise Refused("This plan is shared by multiple clients. Duplicate it before editing.", 409)
    source_kind, source_id = _source(repo, actor, item.get("change_source"), db, student_id or (assignments[0] if len(assignments) == 1 else None))
    reason = _short(item.get("change_reason"), 2000)
    version = db.execute("SELECT COALESCE(MAX(version),0)+1 FROM p_program_revisions WHERE program_id=?", (program_id,)).fetchone()[0]
    db.execute("INSERT INTO p_program_revisions VALUES (?,?,?,?,?,?,?,?,?)", (uid(), program_id, version, now(), actor.user_id, reason, source_kind, source_id, encode(state)))


def versions(repo, actor, program_id):
    repo.get(actor, "programs", program_id)
    with repo.db() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM p_program_revisions WHERE program_id=? ORDER BY version DESC", (program_id,))]
    for row in rows:
        row["snapshot"] = json.loads(row["snapshot"])
        if actor.role == "student":
            row["snapshot"] = student_program(row["snapshot"])
    return {"items": rows, "total": len(rows)}


def templates(repo, actor):
    if actor.role == "student":
        raise Refused("Your coach manages program templates.", 403)
    with repo.db() as db:
        rows = [unpack(r) for r in db.execute("SELECT * FROM p_programs WHERE org_id=? AND json_extract(detail,'$.template')=1 AND (owner_id=? OR ?='admin' OR json_extract(detail,'$.template_visibility')='organization') ORDER BY name COLLATE NOCASE", (actor.org_id, actor.user_id, actor.role))]
    return {"items": rows, "total": len(rows)}


def duplicate(repo, actor, item):
    if actor.role == "student":
        raise Refused("Your coach designs programs.", 403)
    source = repo.get(actor, "programs", item.get("program_id"))
    student_id = item.get("student_id")
    if student_id:
        repo.assert_student(actor, student_id, True)
    detail = dict(source["detail"])
    detail.update(template=bool(item.get("as_template", False)), status="Draft", copied_from=source["id"])
    changing_client = bool(item.get("as_template")) or student_id != source["detail"].get("student_id")
    if changing_client:
        for key in ("source_analysis_id", "source_finding", "coach_notes"):
            detail.pop(key, None)
    if student_id:
        detail["student_id"] = student_id
        detail["template_visibility"] = "private"
    else:
        detail.pop("student_id", None)
    steps = []
    for original in source["steps"]:
        step = dict(original)
        extra = dict(step.get("detail") or {})
        if changing_client:
            extra.pop("source", None)
            extra.pop("why_assigned", None)
            extra["media"] = [m for m in extra.get("media", []) if m.get("kind") != "client_capture"]
        step["detail"] = extra
        steps.append(step)
    location_id = item.get("location_id", source["location_id"])
    if location_id:
        try:
            repo.get(actor, "locations", location_id)
        except Refused:
            if item.get("location_id"):
                raise
            location_id = None
    fields = {"name": _short(item.get("name") or source["name"] + " (copy)", 180), "goal": source["goal"], "region_id": source["region_id"], "location_id": location_id, "detail": detail, "steps": steps, "change_reason": "Duplicated from an existing plan"}
    created_paths = []
    try:
        with repo.batch():
            if changing_client:
                from .media import copy_exercise_media

                clones = {}
                for step in steps:
                    original_exercise_id = step.get("exercise_id")
                    if not original_exercise_id:
                        continue
                    if original_exercise_id not in clones:
                        exercise = repo.get(actor, "exercises", original_exercise_id)
                        if exercise["detail"].get("program_only"):
                            clone = repo.save(actor, "exercises", {
                                "name": exercise["name"], "category": exercise["category"],
                                "difficulty": exercise["difficulty"], "region_id": exercise["region_id"],
                                "visibility": "private", "detail": exercise["detail"],
                                "resources": exercise["resources"],
                            })
                            media_ids = [m["id"] for m in exercise["media"]]
                            copied_ids = copy_exercise_media(repo, actor, clone["id"], media_ids)["media_ids"] if media_ids else []
                            with repo.db() as db:
                                created_paths.extend(__import__("pathlib").Path(r[0]) for media_id in copied_ids for r in db.execute("SELECT path FROM p_media WHERE id=?", (media_id,)))
                            clones[original_exercise_id] = (clone["id"], dict(zip(media_ids, copied_ids)))
                        else:
                            clones[original_exercise_id] = (original_exercise_id, {})
                    step["exercise_id"], remap = clones[original_exercise_id]
                    for medium in step.get("detail", {}).get("media", []):
                        medium["media_id"] = remap.get(medium["media_id"], medium["media_id"])
            result = repo.save(actor, "programs", fields)
            if student_id:
                repo.assign_program(actor, {"program_id": result["id"], "student_id": student_id, "replace": item.get("replace", True)})
    except Exception:
        for path in created_paths:
            path.unlink(missing_ok=True)
        raise
    return repo.get(actor, "programs", result["id"])


def backfill_revisions(repo, org_id=None):
    """Record the current state of legacy/seeded plans without inventing past edits."""
    with repo.db() as db:
        sql = "SELECT p.id,p.owner_id FROM p_programs p WHERE NOT EXISTS (SELECT 1 FROM p_program_revisions r WHERE r.program_id=p.id)"
        args = []
        if org_id:
            sql += " AND p.org_id=?"
            args.append(org_id)
        for row in db.execute(sql, args).fetchall():
            db.execute(
                "INSERT INTO p_program_revisions VALUES (?,?,?,?,?,?,?,?,?)",
                (uid(), row["id"], 1, now(), row["owner_id"], "Current plan imported as baseline; earlier edits were not recorded", "manual", "", encode(snapshot(repo, row["id"], db))),
            )
