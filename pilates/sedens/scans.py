"""The four-view room scan: front, left side, back, right side.

* **demo_free** (free demonstration host): by default the result is a clearly
  labelled precomputed demonstration (``demo_precomputed``): the camera flow runs
  so the visitor sees the experience, but no photo leaves the browser. The visitor
  may instead choose a real experimental analysis (``experimental_real``), warned
  that free hosting can take about two minutes; its result is labelled
  EXPERIMENTAL REAL ANALYSIS. The two are never mixed in one result.
* **local_room**: real captures through the existing analysis pipeline
  (``room_capture``), on the room computer, no paid GPU or API.

Photos are stored privately (never under ``web/``) only while they are analysed,
and deleted afterwards unless the customer agreed to image retention. The derived
measurements and the summary shown are kept: the capture consent says so.
"""

from __future__ import annotations

import base64
from functools import lru_cache
import json
import logging
from pathlib import Path
import shutil
import threading
import time

from . import analytics, consent, feedback, journey, media_store, scan_history
from .util import Denied, decode, encode, now, uid

log = logging.getLogger("sedens.scans")
PROTOCOL = "sedens_room_scan_v1"
VIEWS = journey.SCAN_VIEWS
PIPELINE_VIEW = {"front": "front", "back": "rear", "left": "side_left", "right": "side_right"}
MAX_IMAGE = 8 * 1024 * 1024
DATA = Path(__file__).resolve().parents[2] / "data"
LABELS = {
    "demo_precomputed": {"en": "DEMO PRECOMPUTED ANALYSIS", "ko": "데모 사전 계산 분석"},
    "experimental_real": {"en": "EXPERIMENTAL REAL ANALYSIS", "ko": "실험적 실제 분석"},
    "room_capture": None,
}
_JOB_LOCK = threading.Lock()


@lru_cache(maxsize=None)
def demo_scan() -> dict:
    return json.loads((DATA / "sedens_demo_scan.v1.json").read_text(encoding="utf-8"))


def sources(sedens) -> list[str]:
    return ["demo_precomputed", "experimental_real"] if sedens.mode.name == "demo_free" else ["room_capture"]


def _event(db, ctx, name, **props):
    analytics.record(db, name, org_id=ctx.org_id, user_id=ctx.student_id, room_id=ctx.room_id,
                     device_id=ctx.device_id, room_session_id=ctx.room_session_id, demo=ctx.demo, props=props)


def current(db, ctx) -> dict | None:
    found = db.execute("SELECT * FROM s_room_scans WHERE room_session_id=? ORDER BY started_at DESC, rowid DESC LIMIT 1",
                       (ctx.room_session_id,)).fetchone()
    return dict(found) if found else None


def _folder(sedens, scan) -> Path:
    base = (media_store.root(sedens.repo) / "scans").resolve()
    folder = (base / scan["org_id"] / scan["id"]).resolve()
    if not folder.is_relative_to(base):
        raise Denied("This scan cannot be stored.", 400, "invalid")
    return folder


def _needs_images(scan) -> bool:
    return scan["source"] in ("experimental_real", "room_capture")


# -- actions ---------------------------------------------------------------------------


def begin(sedens, db, ctx, journey_row, data):
    """scan_intro → scan_front. Needs a ready readiness check and current capture consent."""
    journey.require_ready(db, ctx)
    journey.require(journey_row, "scan_intro")
    decided = consent.current(db, ctx.student_id)["scan_capture"]
    if not decided or not decided["granted"] or not decided["current_version"]:
        raise Denied("Agree to the camera scan first, or skip the scan.", 409, "consent_required")
    source = data.get("source") or sources(sedens)[0]
    if source not in sources(sedens):
        raise Denied("Choose one of the scan options shown.", 400, "invalid")
    abandon_open(db, ctx.room_session_id)
    retention = consent.current(db, ctx.student_id)["scan_image_retention"]
    keep = bool(retention and retention["granted"] and retention["current_version"])
    scan_id = uid()
    db.execute("INSERT INTO s_room_scans(id,room_session_id,org_id,student_id,protocol,source,state,"
               "images_retained,started_at) VALUES (?,?,?,?,?,?,?,?,?)",
               (scan_id, ctx.room_session_id, ctx.org_id, ctx.student_id, PROTOCOL, source, "capturing",
                int(keep and source != "demo_precomputed"), now()))
    for view in VIEWS:
        db.execute("INSERT INTO s_room_scan_views(scan_id,view) VALUES (?,?)", (scan_id, view))
    _event(db, ctx, "scan_started", source=source)
    return journey.move(db, journey_row, "scan_front", expect=data.get("expect"))


def view_done(sedens, db, ctx, journey_row, data):
    """One view captured: move to the next view, or to processing after the last."""
    view = data.get("view")
    if view not in VIEWS or journey_row["state"] != f"scan_{view}":
        raise Denied("Capture the view shown on the screen.", 409, "invalid_transition")
    scan = current(db, ctx)
    if scan is None or scan["state"] != "capturing":
        raise Denied("Start the scan again.", 409, "invalid_transition")
    row = db.execute("SELECT * FROM s_room_scan_views WHERE scan_id=? AND view=?", (scan["id"], view)).fetchone()
    if _needs_images(scan) and not row["image_key"]:
        raise Denied("The photo for this view has not arrived yet.", 409, "image_required")
    db.execute("UPDATE s_room_scan_views SET captured_at=? WHERE scan_id=? AND view=?", (now(), scan["id"], view))
    _event(db, ctx, "scan_view_completed", view=view, source=scan["source"])
    index = VIEWS.index(view)
    if index + 1 < len(VIEWS):
        return journey.move(db, journey_row, f"scan_{VIEWS[index + 1]}", expect=data.get("expect"))
    journey_row = journey.move(db, journey_row, "scan_processing", expect=data.get("expect"))
    db.execute("UPDATE s_room_scans SET state='processing' WHERE id=?", (scan["id"],))
    if scan["source"] == "demo_precomputed":
        _complete(sedens, db, scan, demo_scan()["views"], measurement_version="demo", model="demo")
        return journey.move(db, journey_row, "scan_result")
    _start_job(sedens, scan["id"])
    return journey_row


def retake(sedens, db, ctx, journey_row, data):
    """Retake the current view or go back one view. Nothing is analysed until all four."""
    view = data.get("view")
    state = journey_row["state"]
    if view not in VIEWS or state not in {f"scan_{v}" for v in VIEWS}:
        raise Denied("That step is not available now.", 409, "invalid_transition")
    scan = current(db, ctx)
    if scan is None or scan["state"] != "capturing":
        raise Denied("Start the scan again.", 409, "invalid_transition")
    _drop_image(sedens, db, scan, view)
    db.execute("UPDATE s_room_scan_views SET captured_at=NULL, retakes=retakes+1 WHERE scan_id=? AND view=?",
               (scan["id"], view))
    _event(db, ctx, "scan_retake", view=view)
    if state == f"scan_{view}":
        return journey_row
    return journey.move(db, journey_row, f"scan_{view}", expect=data.get("expect"))


def again(sedens, db, ctx, journey_row, data):
    """From the result (or a stuck analysis): start a new scan from the introduction."""
    journey.require(journey_row, "scan_result", "scan_processing")
    abandon_open(db, ctx.room_session_id)
    return journey.move(db, journey_row, "scan_intro", expect=data.get("expect"))


def result_seen(sedens, db, ctx, journey_row, data):
    journey.require(journey_row, "scan_result")
    _event(db, ctx, "session_choice", stage="after_scan", skipped=False)
    return journey.move(db, journey_row, "session_choice", expect=data.get("expect"))


def skip(sedens, db, ctx, journey_row, data):
    """Skip the scan (or leave it part-way): straight to choosing a session."""
    journey.require_ready(db, ctx)
    journey.require(journey_row, "scan_intro", *(f"scan_{v}" for v in VIEWS), "scan_processing")
    abandon_open(db, ctx.room_session_id)
    _event(db, ctx, "session_choice", stage="after_scan", skipped=True)
    return journey.move(db, journey_row, "session_choice", expect=data.get("expect"), scan_skipped=1)


def upload_image(sedens, ctx, view, stream, length) -> dict:
    """The photo of one view (JPEG or PNG), held privately for analysis."""
    if view not in VIEWS:
        raise Denied("Choose a scan view.", 400, "invalid")
    if not 0 < length <= MAX_IMAGE:
        raise Denied("This photo is too large.", 413, "media_too_large")
    with sedens.db() as db:
        journey.require_live(db, ctx)
        j = journey.get(db, ctx)
        scan = current(db, ctx)
        if j is None or j["state"] != f"scan_{view}" or scan is None or scan["state"] != "capturing" \
                or not _needs_images(scan):
            raise Denied("This photo is not expected now.", 409, "invalid_transition")
    with media_store.upload_slot():
        body = stream.read(length)
    if len(body) != length:
        raise Denied("The upload was interrupted. Try again.", 400, "upload_interrupted")
    if not (body.startswith(b"\xff\xd8\xff") or body.startswith(b"\x89PNG\r\n\x1a\n")):
        raise Denied("Send a JPEG or PNG photo.", 415, "media_type_mismatch")
    folder = _folder(sedens, scan)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = f"{view}.{'png' if body.startswith(b'\x89PNG') else 'jpg'}"
    path = folder / key
    path.write_bytes(body)
    path.chmod(0o600)
    with sedens.db() as db:
        db.execute("UPDATE s_room_scan_views SET image_key=? WHERE scan_id=? AND view=?", (key, scan["id"], view))
    return {"view": view, "received": True}


def _drop_image(sedens, db, scan, view):
    row = db.execute("SELECT image_key FROM s_room_scan_views WHERE scan_id=? AND view=?", (scan["id"], view)).fetchone()
    if row and row["image_key"]:
        (_folder(sedens, scan) / row["image_key"]).unlink(missing_ok=True)
        db.execute("UPDATE s_room_scan_views SET image_key=NULL WHERE scan_id=? AND view=?", (scan["id"], view))


def abandon_open(db, room_session_id) -> None:
    """Scans of this visit still capturing are abandoned (their photos go later, in
    :func:`purge_abandoned`, outside the transaction)."""
    db.execute("UPDATE s_room_scans SET state='abandoned', completed_at=? WHERE room_session_id=? "
               "AND state='capturing'", (now(), room_session_id))


# -- analysis ------------------------------------------------------------------------


def _start_job(sedens, scan_id):
    threading.Thread(target=_run_job, args=(sedens, scan_id), name=f"sedens-scan-{scan_id[:6]}", daemon=True).start()


def _run_job(sedens, scan_id):
    with _JOB_LOCK:  # one analysis at a time on this server
        try:
            run_analysis(sedens, scan_id)
        except Exception as exc:  # the customer sees a retake, never a stack trace
            log.exception("SEDENS room scan %s failed", scan_id)
            with sedens.batch(), sedens.db() as db:
                scan = dict(db.execute("SELECT * FROM s_room_scans WHERE id=?", (scan_id,)).fetchone())
                _complete(sedens, db, scan, {}, measurement_version="", model="", error=type(exc).__name__)
                _finish_journey(db, scan)
            # "The photos are deleted as soon as the analysis is finished" holds for a failed one too.
            if not scan["images_retained"]:
                shutil.rmtree(_folder(sedens, scan), ignore_errors=True)


def measurements_from_report(report) -> dict:
    """One view of ``assessment.photo`` output → the feedback layer's input."""
    people = report.get("people", [])
    suitable = [p for p in people if p.get("suitable")]
    out = {"people": len(people), "suitable": len(people) == 1 and bool(suitable), "metrics": {}}
    if people and not suitable:
        reasons = " ".join((people[0].get("validation") or {}).get("reasons", [])).lower()
        out["reason"] = ("not_standing" if "bent" in reasons or "upright" in reasons else
                         "wrong_direction" if "camera plane" in reasons else "not_full_body")
    if len(people) == 1:
        for m in people[0].get("metrics", []):
            out["metrics"][m["id"]] = {"value": m.get("value"), "unit": m.get("unit", ""),
                                       "confidence": m.get("confidence"), "status": m.get("status")}
    return out


def run_analysis(sedens, scan_id) -> None:
    """Analyse the four photos with the existing pipeline, save the analysis and the
    customer summary, then delete the photos unless retention was agreed."""
    from .. import assessment
    from ..platform.analysis import save_analysis
    from ..platform.repository import Actor
    from ..studio import summarize

    with sedens.db() as db:
        scan = dict(db.execute("SELECT * FROM s_room_scans WHERE id=?", (scan_id,)).fetchone())
        views = {r["view"]: r["image_key"] for r in db.execute("SELECT view, image_key FROM s_room_scan_views WHERE scan_id=?",
                                                                 (scan_id,))}
        demo = bool(db.execute("SELECT demo FROM p_organizations WHERE id=?", (scan["org_id"],)).fetchone()[0])
        location = db.execute("SELECT location_id FROM s_room_sessions WHERE id=?", (scan["room_session_id"],)).fetchone()
    folder = _folder(sedens, scan)
    reports, measurements = [], {}
    model = ""
    for view in VIEWS:
        key = views.get(view)
        if not key:
            continue
        payload = {"image": base64.b64encode((folder / key).read_bytes()).decode(), "view": PIPELINE_VIEW[view],
                   "mode": "standing", "include_3d": False}
        report = _photo_when_free(assessment, payload)
        model = report.get("model", model)
        reports.append({"view": PIPELINE_VIEW[view], "media_id": None, "report": report})
        measurements[view] = measurements_from_report(report)
    actor = Actor(scan["student_id"], scan["org_id"], "student", demo)
    analysis_id = save_analysis(sedens.repo, actor, scan["student_id"],
                                {"kind": "posture", "views": reports, "summary": summarize(reports)},
                                {}, PROTOCOL, location[0] if location else None,
                                detail={"source": "sedens_room", "room_scan_id": scan_id, "scan_source": scan["source"]})
    with sedens.batch(), sedens.db() as db:
        scan = dict(db.execute("SELECT * FROM s_room_scans WHERE id=?", (scan_id,)).fetchone())
        db.execute("UPDATE s_room_scans SET analysis_id=? WHERE id=?", (analysis_id, scan_id))
        session = db.execute("SELECT session_id FROM p_session_analyses WHERE analysis_id=?", (analysis_id,)).fetchone()
        if session:
            db.execute("UPDATE s_room_journeys SET training_session_id=COALESCE(training_session_id, ?) "
                       "WHERE room_session_id=?", (session[0], scan["room_session_id"]))
        _complete(sedens, db, scan, measurements, measurement_version=assessment.VERSION, model=model)
        _finish_journey(db, scan)
    if not scan["images_retained"]:
        shutil.rmtree(folder, ignore_errors=True)


def _photo_when_free(assessment, payload):
    from ..api import Refused

    for _ in range(600):  # the workspace may be analysing; wait up to ~10 minutes
        try:
            return assessment.photo(payload)
        except Refused:
            time.sleep(1)
    raise TimeoutError("analysis busy")


def _finish_journey(db, scan):
    row = db.execute("SELECT * FROM s_room_journeys WHERE room_session_id=?", (scan["room_session_id"],)).fetchone()
    if row is not None and row["state"] == "scan_processing":
        journey.move(db, dict(row), "scan_result")


def _previous(db, scan) -> dict | None:
    """The measurements of the last scan this one may be compared with: exactly the rules
    of :mod:`scan_history`, so the room screen and the Passport never disagree. The scan
    being completed may carry its own ``reliability`` and ``summary`` (with the evaluated
    rules); without them it is taken as clear with the shoulder line evaluated, so only
    what identifies it is judged. The earlier scan must be complete, clear and have had
    its shoulder line evaluated (not withheld)."""
    probe = {**scan, "state": "complete", "reliability": scan.get("reliability") or "clear",
             "summary": scan.get("summary") or {"evaluated": [{"rule_id": scan_history.OBSERVATION,
                                                               "outcome": "shown"}]},
             "feedback_rules_version": scan.get("feedback_rules_version") or feedback.CURRENT}
    rows = db.execute("SELECT * FROM s_room_scans WHERE student_id=? AND id<>? AND protocol=? AND state='complete' "
                      "ORDER BY completed_at DESC, rowid DESC", (scan["student_id"], scan["id"], scan["protocol"]))
    for row in rows:
        row = dict(row)
        if not scan_history.reasons(row, {"org_id": row["org_id"], **probe}):
            return decode(row["summary"], {}).get("measurements")
    return None


def _complete(sedens, db, scan, measurements, *, measurement_version, model, error=""):
    # The scan's own quality and evaluated rules decide whether it can be compared at all.
    own = feedback.interpret(measurements, locale="en")
    previous = _previous(db, {**scan, "measurement_version": measurement_version, "model": model,
                              "reliability": own["quality"], "summary": {"evaluated": own["evaluated"]}})
    rendered = {loc: feedback.interpret(measurements, locale=loc, previous=previous) for loc in ("en", "ko")}
    base = rendered["en"]
    label = LABELS[scan["source"]]
    for loc in ("en", "ko"):
        rendered[loc]["source"] = scan["source"]
        rendered[loc]["label"] = label[loc] if label else None
        rendered[loc]["label_note"] = demo_scan()["note"][loc] if scan["source"] == "demo_precomputed" else None
    stored = {"measurements": measurements, "shown": {loc: feedback.customer_summary(rendered[loc]) for loc in rendered},
              "focus_hint": base["focus_hint"], "evaluated": base["evaluated"]}
    db.execute("UPDATE s_room_scans SET state=?, reliability=?, focus=?, summary=?, measurement_version=?, model=?, "
               "feedback_rules_version=?, completed_at=?, error=? WHERE id=?",
               ("failed" if error else "complete", base["quality"], base["focus_hint"], encode(stored),
                measurement_version, model, feedback.CURRENT, now(), error, scan["id"]))
    for e in base["evaluated"]:
        db.execute("INSERT OR REPLACE INTO s_room_scan_observations(scan_id,rule_id,metric,value,unit,outcome,reason,"
                   "threshold) VALUES (?,?,?,?,?,?,?,?)",
                   (scan["id"], e["rule_id"], e["metric"], e["value"], e["unit"], e["outcome"], e["reason"],
                    e["threshold"]))
    for view, part in base["views"].items():
        db.execute("UPDATE s_room_scan_views SET quality=? WHERE scan_id=? AND view=?",
                   (part["quality"], scan["id"], view))
    analytics.record(db, "scan_completed", org_id=scan["org_id"], user_id=scan["student_id"],
                     room_session_id=scan["room_session_id"], demo=scan["org_id"].startswith("demo-"),
                     props={"source": scan["source"], "quality": base["quality"],
                            "observations": len(base["observations"]), "failed": bool(error)})


def latest_complete(db, room_session_id) -> dict | None:
    row = db.execute("SELECT * FROM s_room_scans WHERE room_session_id=? AND state IN ('complete','failed') "
                     "ORDER BY completed_at DESC, rowid DESC LIMIT 1", (room_session_id,)).fetchone()
    return dict(row) if row else None


def view_part(sedens, db, ctx, journey_row, locale) -> dict:
    state = journey_row["state"]
    out = {}
    if state == "scan_intro":
        out["scan_options"] = sources(sedens)
    if state.startswith("scan_") and state != "scan_intro":
        scan = current(db, ctx)
        if scan is not None:
            views = {r["view"]: {"captured": bool(r["captured_at"]), "photo": bool(r["image_key"])}
                     for r in db.execute("SELECT * FROM s_room_scan_views WHERE scan_id=?", (scan["id"],))}
            out["scan"] = {"source": scan["source"], "needs_images": _needs_images(scan), "views": views,
                           "label": (LABELS[scan["source"]] or {}).get(locale), "state": scan["state"]}
            if state == "scan_result":
                done = latest_complete(db, ctx.room_session_id)
                if done:
                    out["scan"]["summary"] = decode(done["summary"], {}).get("shown", {}).get(locale)
                    out["scan"]["failed"] = done["state"] == "failed"
    return out


def purge_abandoned(sedens) -> None:
    """Delete photos of abandoned or failed scans that were not to be retained."""
    with sedens.db() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM s_room_scans WHERE state IN ('abandoned','failed') "
                                            "AND images_retained=0")]
    for scan in rows:
        shutil.rmtree(_folder(sedens, scan), ignore_errors=True)


journey.register({"scan/begin": begin, "scan/view": view_done, "scan/retake": retake, "scan/again": again,
                  "scan/continue": result_seen, "scan/skip": skip},
                 view_part=view_part, on_close=lambda db, room_session_id, reason: abandon_open(db, room_session_id))
