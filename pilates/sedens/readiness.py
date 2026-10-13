"""The readiness check before an unsupervised workout.

Purpose: can this person reasonably proceed with a general self-guided workout
today? It never asks what condition someone has, and never diagnoses.

* The questions, their reasons, sources, response behaviour and customer copy
  live in ``data/sedens_readiness.v<n>.json`` (versioned); evidence is in
  ``data/evidence_registry.json`` and ``docs/SEDENS_FEEDBACK_EVIDENCE.md``.
* Answers are sent one at a time and the **server** decides: the first Yes stops
  the check (``do_not_start``), and a Yes to the follow-up of a symptom item stops
  it as ``urgent_help``. Only all-No is ``ready``. There is no "modified
  intensity" outcome: no fetched guideline supports one for a self-service room.
* A check stores the questionnaire version it was answered under. Its outcome is
  written once and never re-evaluated, even when a later version changes the rules.
* Only the answers up to the deciding one are stored (data minimisation).
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path

from .util import Denied, now, uid

DATA = Path(__file__).resolve().parents[2] / "data"
CURRENT = "sedens-readiness-1.0.0"
OUTCOMES = ("ready", "do_not_start", "urgent_help")
FILES = {"sedens-readiness-1.0.0": "sedens_readiness.v1.json"}


@lru_cache(maxsize=None)
def questionnaire(version: str = CURRENT) -> dict:
    if version not in FILES:
        raise Denied("This readiness questionnaire version is unknown.", 500, "unknown_questionnaire")
    data = json.loads((DATA / FILES[version]).read_text(encoding="utf-8"))
    if data["version"] != version:
        raise ValueError(f"{FILES[version]} declares version {data['version']}, expected {version}")
    return data


def _item(version, item_id):
    return next((i for i in questionnaire(version)["items"] if i["id"] == item_id), None)


def _text(value, locale):
    return value.get(locale) or value.get("en") if isinstance(value, dict) else value


def start(db, *, org_id, student_id, room_session_id, locale) -> dict:
    """The open check of this room visit, or a new one."""
    found = db.execute("SELECT * FROM s_readiness_checks WHERE room_session_id=? ORDER BY started_at DESC LIMIT 1",
                       (room_session_id,)).fetchone()
    if found is not None:
        return dict(found)
    check_id = uid()
    db.execute("INSERT INTO s_readiness_checks(id,room_session_id,org_id,student_id,questionnaire_version,locale,"
               "started_at) VALUES (?,?,?,?,?,?,?)",
               (check_id, room_session_id, org_id, student_id, CURRENT, locale if locale in ("en", "ko") else "ko",
                now()))
    return dict(db.execute("SELECT * FROM s_readiness_checks WHERE id=?", (check_id,)).fetchone())


def _answers(db, check_id) -> list[dict]:
    return [dict(r) for r in db.execute("SELECT * FROM s_readiness_answers WHERE check_id=? ORDER BY position",
                                        (check_id,))]


def progress(db, check, locale) -> dict:
    """Where the check is: the next question (with its copy) or the stored outcome."""
    version = check["questionnaire_version"]
    q = questionnaire(version)
    answers = _answers(db, check["id"])
    out = {"version": version, "total": len(q["items"]), "answered": len(answers),
           "intro": _text(q["intro"], locale), "outcome": check["outcome"], "triggered_item": check["triggered_item"]}
    if check["outcome"]:
        out["result"] = outcome_copy(version, check["outcome"], check["triggered_item"], locale)
        return out
    pending = answers[-1] if answers and answers[-1]["answer"] == 1 and answers[-1]["follow_up"] is None else None
    item = _item(version, pending["item_id"]) if pending else q["items"][len(answers)]
    out["next"] = {
        "item": item["id"], "position": (pending["position"] if pending else len(answers)) + 1,
        "follow_up": bool(pending),
        "question": _text(item["follow_up"] if pending else item["question"], locale),
        "why": _text(item["why"], locale),
    }
    return out


def answer(db, check, item_id, value, follow_up=None) -> dict:
    """Record one answer (or a follow-up). Returns {'outcome': None|...}."""
    if check["outcome"]:
        raise Denied("This readiness check is already complete.", 409, "readiness_complete")
    version = check["questionnaire_version"]
    q = questionnaire(version)
    answers = _answers(db, check["id"])
    pending = answers[-1] if answers and answers[-1]["answer"] == 1 and answers[-1]["follow_up"] is None else None
    expected = pending["item_id"] if pending else q["items"][len(answers)]["id"]
    if item_id != expected:
        raise Denied("Answer the question shown on the screen.", 409, "readiness_out_of_order")
    item = _item(version, item_id)
    stamp = now()
    if pending:
        if not isinstance(follow_up, bool):
            raise Denied("Choose Yes or No.", 400, "invalid")
        db.execute("UPDATE s_readiness_answers SET follow_up=? WHERE check_id=? AND item_id=?",
                   (int(follow_up), check["id"], item_id))
        return _decide(db, check, item["follow_up_yes"] if follow_up else item["on_yes"], item_id)
    if not isinstance(value, bool):
        raise Denied("Choose Yes or No.", 400, "invalid")
    db.execute("INSERT INTO s_readiness_answers(check_id,item_id,position,answer,answered_at) VALUES (?,?,?,?,?)",
               (check["id"], item_id, len(answers), int(value), stamp))
    if value:
        if item.get("follow_up"):
            return {"outcome": None, "follow_up": True}
        return _decide(db, check, item["on_yes"], item_id)
    if len(answers) + 1 == len(q["items"]):
        return _decide(db, check, "ready", None)
    return {"outcome": None}


def _decide(db, check, outcome, item_id) -> dict:
    if outcome not in OUTCOMES:
        raise ValueError(f"unknown readiness outcome {outcome}")
    changed = db.execute("UPDATE s_readiness_checks SET outcome=?, triggered_item=?, completed_at=? "
                         "WHERE id=? AND outcome IS NULL", (outcome, item_id, now(), check["id"])).rowcount
    if not changed:
        raise Denied("This readiness check is already complete.", 409, "readiness_complete")
    return {"outcome": outcome, "triggered_item": item_id}


def outcome_copy(version, outcome, item_id, locale) -> dict:
    q = questionnaire(version)
    copy = {k: _text(v, locale) for k, v in q["outcomes"][outcome].items()}
    if outcome == "do_not_start" and item_id:
        copy["next_action"] = _text(_item(version, item_id)["next_action"], locale)
    return copy


def stop_card(locale, version: str = CURRENT) -> dict:
    card = questionnaire(version)["stop_card"]
    return {"title": _text(card["title"], locale), "items": card["items"][locale if locale in card["items"] else "en"],
            "action": _text(card["action"], locale)}


def unwell_copy(locale, version: str = CURRENT) -> dict:
    u = questionnaire(version)["unwell"]
    pick = lambda v: v[locale] if isinstance(v, dict) and locale in v else (v.get("en") if isinstance(v, dict) else v)  # noqa: E731
    return {"urgent_question": pick(u["urgent_question"]), "urgent_signs": pick(u["urgent_signs"]),
            "category_question": pick(u["category_question"]),
            "categories": [{"id": k, "label": pick(v)} for k, v in u["categories"].items()],
            "guidance": pick(u["guidance"])}


UNWELL_CATEGORIES = ("pain", "dizzy", "unwell", "other")


def latest(db, room_session_id):
    found = db.execute("SELECT * FROM s_readiness_checks WHERE room_session_id=? ORDER BY started_at DESC LIMIT 1",
                       (room_session_id,)).fetchone()
    return dict(found) if found else None
