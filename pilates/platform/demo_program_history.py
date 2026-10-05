"""Explicitly synthetic, analysis-linked program history for featured demo clients."""

from datetime import datetime, timedelta
from .designer import duplicate
from .repository import Refused


def _steps(source, phase, region, analysis_id, stage):
    result = []
    for index, original in enumerate(source):
        if original.get("type") == "note":
            continue
        step = dict(original)
        section = str(step.get("phase") or "Practice")
        step["phase"] = phase
        detail = dict(step.get("detail") or {})
        detail.update(
            section=section.upper(),
            target_region_ids=[region] if region else [],
            purpose="Practice the movement pattern discussed in the simulated assessment.",
            student_instructions="Move in a comfortable range with steady control.",
            why_assigned="The coach linked this practice to this client's simulated assessment and body-region review.",
        )
        if index == 1:
            detail["source"] = {"kind": "analysis", "id": analysis_id}
            step["reps"] = min(24, int(step.get("reps", 8)) + (0, 2, 3)[stage])
        if index == 2 and stage == 2:
            step["seconds"] = min(300, int(step.get("seconds", 60)) + 15)
        step["detail"] = detail
        result.append(step)
        if index == 0:
            result.append({
                "type": "note", "phase": phase, "section": "WARM-UP",
                "visibility": "student",
                "text": "Demo coaching note: review the target body region and use a comfortable range.",
            })
    return result


def seed_featured_program_history(repo, actor, student_id, base_program_id, analysis_ids):
    """Return a per-client demo plan. Call after base assignment, before reservations."""
    if not actor.demo or actor.role not in {"coach", "admin"}:
        raise Refused("Synthetic history is available only in a demo studio.", 403)
    if not isinstance(analysis_ids, list) or len(analysis_ids) < 15:
        raise Refused("A featured demo journey needs at least 15 simulated visits.")
    repo.assert_student(actor, student_id, True)
    base = repo.get(actor, "programs", base_program_id)
    if not base["steps"]:
        raise Refused("Choose a complete demo program.")
    with repo.batch():
        with repo.db() as db:
            existing = db.execute(
                "SELECT id FROM p_programs WHERE org_id=? AND json_extract(detail,'$.demo_history_for')=? AND json_extract(detail,'$.copied_from')=?",
                (actor.org_id, student_id, base_program_id),
            ).fetchone()
            if existing:
                return existing["id"]
            visits = [db.execute(
                "SELECT id,student_id,created_at,demo FROM p_analyses WHERE id=? AND org_id=?",
                (aid, actor.org_id),
            ).fetchone() for aid in analysis_ids]
            if any(not v or v["student_id"] != student_id or not v["demo"] for v in visits):
                raise Refused("Demo program history requires only this client's simulated analyses.")
            if any(visits[i]["created_at"] >= visits[i + 1]["created_at"] for i in range(len(visits) - 1)):
                raise Refused("Demo visits must be ordered from earliest to latest.")
        program = duplicate(repo, actor, {
            "program_id": base_program_id, "student_id": student_id, "replace": True,
            "name": base["name"].replace(" · coached practice", "") + " · personal journey",
        })
        pid, region = program["id"], program["region_id"]
        first = visits[0]["created_at"]
        phases = [
            {"name": "Foundation", "weeks_start": 1, "weeks_end": 6, "goal": "Establish a repeatable, comfortable practice."},
            {"name": "Control", "weeks_start": 7, "weeks_end": 13, "goal": "Repeat the movement with steadier control."},
            {"name": "Progression", "weeks_start": 14, "weeks_end": 20, "goal": "Adjust dose while comparing the same capture view."},
        ]
        milestones = [0, len(visits) // 3, 2 * len(visits) // 3]
        reasons = [
            "Demo simulation — establish a foundation after the initial assessment.",
            "Demo simulation — adjust repetitions after the mid-program movement review.",
            "Demo simulation — progress selected drills after a later reassessment.",
        ]
        for stage, visit_index in enumerate(milestones):
            detail = dict(program["detail"])
            detail.update(
                demo=True, demo_history_for=student_id, student_id=student_id,
                provenance="Synthetic coach-plan journey for a fictional client; not a clinical prescription or inference from imagery.",
                status="Active", start_date=first[:10], duration_weeks=20,
                sessions_per_week=2 if stage < 2 else 3,
                target_region_ids=[region] if region else [], phases=phases,
                phase=phases[stage]["name"],
                description="A coach-authored demo plan connected to simulated assessment history.",
                coach_notes="Demo simulation: verify comfort and adapt the sequence before real use.",
            )
            program = repo.save(actor, "programs", {
                "id": pid, "goal": phases[stage]["goal"], "detail": detail,
                "steps": _steps(base["steps"], phases[stage]["name"], region,
                                analysis_ids[visit_index], stage),
                "change_reason": reasons[stage],
                "change_source": {"kind": "analysis", "id": analysis_ids[visit_index]},
            })
            with repo.db() as db:
                db.execute("UPDATE p_program_revisions SET created_at=? WHERE program_id=? AND version=?",
                           (visits[visit_index]["created_at"], pid, program["version"]))
                if stage:
                    db.execute("UPDATE p_notes SET text=? WHERE student_id=? AND analysis_id=? AND program_id=?",
                               (reasons[stage] + " The region remains linked to this demo visit.",
                                student_id, analysis_ids[visit_index], base_program_id))
        with repo.db() as db:
            baseline = (datetime.fromisoformat(first) - timedelta(days=1)).isoformat()
            db.execute("UPDATE p_program_revisions SET created_at=?,reason=? WHERE program_id=? AND version=1",
                       (baseline, "Demo simulation — copied starting template; no earlier edits are asserted.", pid))
            db.execute("UPDATE p_program_assignments SET starts_on=?,analysis_id=?,notes=? WHERE program_id=? AND student_id=?",
                       (first[:10], analysis_ids[0], "Synthetic plan linked to the initial simulated assessment.", pid, student_id))
            for table in ("p_training_sessions", "p_notes", "p_reservations"):
                db.execute(f"UPDATE {table} SET program_id=? WHERE student_id=? AND program_id=?",
                           (pid, student_id, base_program_id))
            for session in db.execute("SELECT id,performed_at FROM p_training_sessions WHERE student_id=? AND program_id=? ORDER BY performed_at",
                                      (student_id, pid)).fetchall():
                version = db.execute("SELECT COALESCE(MAX(version),1) FROM p_program_revisions WHERE program_id=? AND created_at<=?",
                                     (pid, session["performed_at"])).fetchone()[0]
                db.execute("INSERT OR REPLACE INTO p_training_session_program_versions VALUES (?,?,?)",
                           (session["id"], pid, version))
    return pid
