"""What a customer can change about their own Passport: preferences, retained scan
photos, a request to erase the Passport, and a download of their own data.

Everything is about the signed-in customer (:func:`passport.customer`), scoped by
``user_id`` and ``org_id``; no function takes a customer id. Deleting photos
removes this customer's scan image files and keeps the measurements. An erasure
request is only recorded: the facility decides, and attendance and purchase records
are not deleted without a defined retention policy.
"""

from __future__ import annotations

import shutil

from . import consent, marketplace, passport, scans
from .util import Denied, decode, encode, now, uid

EXPORT_FORMAT = "sedens-passport-export-1"
OPTIONS = {
    "exercise_style": ("pilates", "mobility", "core", "mixed"),
    "intensity": ("light", "moderate"),
    "music": ("off", "calm", "focus", "energy"),
    "language": ("ko", "en"),
}
MAX_MESSAGE = 500
STORED = {
    "en": ["Your room visits, workouts, the exercises you completed or skipped, and the effort you reported.",
           "The measurements and the summary of each room scan.",
           "Scan photos only if you agreed to keep them. Otherwise they are deleted after the analysis.",
           "Your course enrollments and progress.",
           "Your preferences, and your consent decisions with their dates."],
    "ko": ["룸 방문, 운동, 완료하거나 건너뛴 동작, 직접 알려 준 운동 강도 느낌.",
           "룸 스캔의 측정값과 요약.",
           "사진은 보관에 동의한 경우에만 남아요. 그렇지 않으면 분석 후 삭제돼요.",
           "코스 등록과 진행 상황.",
           "내 설정과 동의 기록(날짜 포함)."]}
ERASURE = {
    "en": "Asking to erase your Passport sends a request to your facility, which decides. Nothing is deleted "
          "automatically. Attendance and purchase records are not deleted without a retention policy.",
    "ko": "패스포트 삭제를 요청하면 시설에 요청이 전달되고, 시설이 결정해요. 자동으로 삭제되는 것은 없어요. "
          "출석과 구매 기록은 보관 기준이 정해지기 전에는 삭제되지 않아요."}
PHOTOS_NOTE = {
    "en": "Photos kept: {n}. Downloading photos is not supported yet.",
    "ko": "보관 중인 사진: {n}장. 사진 내려받기는 아직 지원하지 않아요."}
OPEN = ("received",)


# -- preferences -------------------------------------------------------------------------


def _preferences(db, me) -> dict:
    row = db.execute("SELECT * FROM s_passport_preferences WHERE user_id=? AND org_id=?",
                     (me["user_id"], me["org_id"])).fetchone()
    return {**{k: (row[k] if row else None) for k in OPTIONS}, "updated_at": row["updated_at"] if row else None}


def preferences(sedens, db, actor, locale) -> dict:
    me = passport.customer(sedens, db, actor)
    return {**passport.frame(sedens, db, actor, locale), "preferences": _preferences(db, me),
            "options": {k: list(v) for k, v in OPTIONS.items()}}


def save_preferences(sedens, db, actor, locale, data) -> dict:
    """Save the listed choices; one left out stays as it was, ``null`` clears it."""
    me = passport.customer(sedens, db, actor)
    unknown = set(data) - set(OPTIONS)
    if unknown:
        raise Denied("Choose from the listed preferences.", 400, "invalid")
    for key, value in data.items():
        if value is not None and value not in OPTIONS[key]:
            raise Denied("Choose from the listed options.", 400, "invalid")
    merged = {**{k: v for k, v in _preferences(db, me).items() if k in OPTIONS}, **data}
    db.execute("INSERT INTO s_passport_preferences(user_id,org_id,exercise_style,intensity,music,language,updated_at) "
               "VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET exercise_style=excluded.exercise_style, "
               "intensity=excluded.intensity, music=excluded.music, language=excluded.language, "
               "updated_at=excluded.updated_at",
               (me["user_id"], me["org_id"], merged["exercise_style"], merged["intensity"], merged["music"],
                merged["language"], now()))
    return preferences(sedens, db, actor, locale)


# -- privacy -----------------------------------------------------------------------------


def _photo_views(db, me) -> list[dict]:
    """Stored scan photos of this customer's finished scans (a scan still being taken keeps its photos)."""
    return [dict(r) for r in db.execute(
        "SELECT s.*, v.view, v.image_key FROM s_room_scans s JOIN s_room_scan_views v ON v.scan_id=s.id "
        "WHERE s.student_id=? AND s.org_id=? AND s.state NOT IN ('capturing','processing') "
        "AND v.image_key IS NOT NULL AND v.image_key<>''", (me["user_id"], me["org_id"]))]


def _requests(db, me) -> list[dict]:
    return [{"id": r["id"], "kind": r["kind"], "state": r["state"], "requested_at": r["requested_at"],
             "decided_at": r["decided_at"], "message": decode(r["detail"], {}).get("message", "")}
            for r in db.execute("SELECT * FROM s_data_requests WHERE user_id=? AND org_id=? "
                                "ORDER BY requested_at DESC, rowid DESC", (me["user_id"], me["org_id"]))]


def privacy(sedens, db, actor, locale) -> dict:
    me = passport.customer(sedens, db, actor)
    photos = _photo_views(db, me)
    return {**passport.frame(sedens, db, actor, locale),
            "consent": {"texts": consent.texts(), "current": consent.current(db, me["user_id"])},
            "stored": STORED[locale], "erasure_notice": ERASURE[locale],
            "photos": {"retained": len(photos), "scans": len({p["id"] for p in photos})},
            "requests": _requests(db, me)}


def delete_photos(sedens, db, actor, locale) -> dict:
    """Delete this customer's retained scan photos now: the files and their keys. The
    measurements and summaries stay. Files go first, so a failure never leaves a
    photo that the records say is gone."""
    me = passport.customer(sedens, db, actor)
    rows = _photo_views(db, me)
    scan_ids = sorted({r["id"] for r in rows})
    for r in rows:
        (scans._folder(sedens, r) / r["image_key"]).unlink(missing_ok=True)
    for scan in {r["id"]: r for r in rows}.values():
        shutil.rmtree(scans._folder(sedens, scan), ignore_errors=True)
    for scan_id in scan_ids:
        db.execute("UPDATE s_room_scan_views SET image_key=NULL WHERE scan_id=?", (scan_id,))
        db.execute("UPDATE s_room_scans SET images_retained=0 WHERE id=? AND student_id=? AND org_id=?",
                   (scan_id, me["user_id"], me["org_id"]))
    # Leftover image files of this customer's own scans marked as retained without a key.
    for scan in db.execute("SELECT * FROM s_room_scans WHERE student_id=? AND org_id=? AND images_retained=1 "
                           "AND state NOT IN ('capturing','processing')", (me["user_id"], me["org_id"])).fetchall():
        shutil.rmtree(scans._folder(sedens, dict(scan)), ignore_errors=True)
    # A scan marked as retained whose files were already gone is no longer retained either.
    db.execute("UPDATE s_room_scans SET images_retained=0 WHERE student_id=? AND org_id=? AND images_retained=1 "
               "AND state NOT IN ('capturing','processing')", (me["user_id"], me["org_id"]))
    if scan_ids:
        sedens.audit(db, me["org_id"], me["user_id"], "passport:photos_deleted", me["user_id"],
                     {"photos": len(rows), "scans": len(scan_ids)})
    return {**passport.frame(sedens, db, actor, locale), "deleted_photos": len(rows), "scans": len(scan_ids),
            "photos": {"retained": 0, "scans": 0}}


def request_erasure(sedens, db, actor, locale, data) -> dict:
    """Record a request for the facility to erase this Passport. One open request at a
    time: asking again returns it. Nothing is deleted."""
    me = passport.customer(sedens, db, actor)
    message = data.get("message") or ""
    if not isinstance(message, str) or len(message) > MAX_MESSAGE:
        raise Denied(f"Keep the message under {MAX_MESSAGE} characters.", 400, "invalid")
    open_one = db.execute("SELECT * FROM s_data_requests WHERE user_id=? AND org_id=? AND kind='erase_passport' "
                          "AND state='received'", (me["user_id"], me["org_id"])).fetchone()
    if open_one is None:
        request_id = uid()
        db.execute("INSERT INTO s_data_requests(id,org_id,user_id,kind,state,detail,requested_at) VALUES (?,?,?,?,?,?,?)",
                   (request_id, me["org_id"], me["user_id"], "erase_passport", "received",
                    encode({"message": message.strip()}), now()))
        sedens.audit(db, me["org_id"], me["user_id"], "passport:erasure_requested", request_id)
    return {**passport.frame(sedens, db, actor, locale), "requests": _requests(db, me), "erasure_notice": ERASURE[locale]}


def withdraw_request(sedens, db, actor, locale, data) -> dict:
    me = passport.customer(sedens, db, actor)
    wanted = data.get("id")
    if wanted is not None and not isinstance(wanted, str):
        raise Denied("There is no open request to withdraw.", 404, "no_open_request")
    found = db.execute("SELECT * FROM s_data_requests WHERE user_id=? AND org_id=? AND state='received' "
                       "AND (? IS NULL OR id=?) ORDER BY requested_at DESC LIMIT 1",
                       (me["user_id"], me["org_id"], wanted, wanted)).fetchone()
    if found is None:
        raise Denied("There is no open request to withdraw.", 404, "no_open_request")
    detail = decode(found["detail"], {})
    db.execute("UPDATE s_data_requests SET state='withdrawn', detail=? WHERE id=? AND state='received'",
               (encode({**detail, "withdrawn_at": now()}), found["id"]))
    sedens.audit(db, me["org_id"], me["user_id"], "passport:erasure_withdrawn", found["id"])
    return {**passport.frame(sedens, db, actor, locale), "requests": _requests(db, me)}


# -- export ------------------------------------------------------------------------------


def export(sedens, db, actor) -> dict:
    """The customer's own data. Excludes other people's data, the facility's staff notes
    and the photo files themselves."""
    me = passport.customer(sedens, db, actor)
    uid_, org = me["user_id"], me["org_id"]
    user = db.execute("SELECT name, email FROM p_users WHERE id=? AND org_id=?", (uid_, org)).fetchone()
    steps: dict = {}
    for r in db.execute("SELECT st.* FROM s_workout_steps st JOIN s_workouts w ON w.id=st.workout_id "
                        "WHERE w.student_id=? AND w.org_id=? ORDER BY st.workout_id, st.position", (uid_, org)):
        steps.setdefault(r["workout_id"], []).append({k: r[k] for k in (
            "position", "phase", "step_ref", "exercise_ref", "variant", "state", "planned_seconds", "started_at",
            "finished_at")})
    feedback = {r["workout_id"]: {("discomfort_level" if k == "discomfort_strength" else k): r[k] for k in r.keys()
                                  if k not in ("workout_id", "org_id", "student_id")}
                for r in db.execute("SELECT * FROM s_session_feedback WHERE student_id=? AND org_id=?", (uid_, org))}
    workouts = []
    for w in db.execute("SELECT * FROM s_workouts WHERE student_id=? AND org_id=? ORDER BY created_at, rowid", (uid_, org)):
        workouts.append({**{k: w[k] for k in (
            "id", "room_session_id", "kind", "state", "origin", "course_id", "course_version", "course_session_id",
            "planned_seconds", "active_seconds", "started_at", "ended_at", "end_reason", "safety_category")},
            "steps": steps.get(w["id"], []), "feedback": feedback.get(w["id"])})
    scan_rows = []
    for s in db.execute("SELECT * FROM s_room_scans WHERE student_id=? AND org_id=? ORDER BY started_at, rowid", (uid_, org)):
        stored = decode(s["summary"], {})
        scan_rows.append({
            **{k: s[k] for k in ("id", "room_session_id", "source", "origin", "state", "protocol", "reliability",
                                 "measurement_version", "model", "feedback_rules_version", "images_retained",
                                 "started_at", "completed_at")},
            "summary": stored.get("shown"), "measurements": stored.get("measurements"),
            "observations": [dict(o) for o in db.execute(
                "SELECT rule_id, metric, value, unit, outcome, reason, threshold FROM s_room_scan_observations "
                "WHERE scan_id=?", (s["id"],))]})
    enrollments = []
    for e in db.execute("SELECT * FROM s_enrollments WHERE user_id=? AND org_id=? ORDER BY enrolled_at", (uid_, org)):
        course = db.execute("SELECT * FROM s_courses WHERE id=?", (e["course_id"],)).fetchone()
        entitlement, _state = passport._entitlement(sedens, db, me, e, course) if course is not None else (None, "none")
        enrollments.append({
            "course_id": e["course_id"], "title": (marketplace._snapshot(db, e["course_id"], e["version"]).get("course") or {})
            .get("title") or (course["title"] if course else None),
            "version": e["version"], "enrolled_at": e["enrolled_at"], "completed_at": e["completed_at"],
            "entitlement": None if entitlement is None else {"source": entitlement["source"],
                                                              "granted_at": entitlement["granted_at"],
                                                              "revoked_at": entitlement["revoked_at"]},
            "progress": [{"item_kind": p["item_kind"], "item_id": p["item_id"], "completed_at": p["completed_at"]}
                         for p in db.execute("SELECT * FROM s_course_progress WHERE enrollment_id=? ORDER BY completed_at",
                                             (e["id"],))]})
    photos = len(_photo_views(db, me))
    return {
        "format": EXPORT_FORMAT, "exported_at": now(),
        "account": {"name": user["name"], "email": user["email"],
                    "facility": sedens.org(db, org)["display_name"], "demo": bool(sedens.org(db, org)["demo"])},
        "consents": [{k: r[k] for k in ("kind", "granted", "text_version", "recorded_at", "channel")}
                     for r in db.execute("SELECT * FROM s_consents WHERE user_id=? AND org_id=? ORDER BY recorded_at, rowid",
                                         (uid_, org))],
        "room_visits": [{k: r[k] for k in ("id", "origin", "state", "entry_method", "started_at", "ended_at", "end_reason")}
                        for r in db.execute("SELECT * FROM s_room_sessions WHERE student_id=? AND org_id=? "
                                            "ORDER BY started_at, rowid", (uid_, org))],
        "studio_sessions": [{"id": c["id"], "date": c["date"], "recorded_by": c["recorder"],
                             "exercises_completed": c["exercises_completed"]} for c in passport._studio(db, me)],
        "workouts": workouts, "scans": scan_rows, "enrollments": enrollments,
        "purchases": [{"course_id": r["course_id"], "provider": r["provider"], "amount_minor": r["amount_minor"],
                       "currency": r["currency"], "state": r["state"], "created_at": r["created_at"]}
                      for r in db.execute("SELECT * FROM s_purchases WHERE user_id=? AND org_id=? ORDER BY created_at",
                                          (uid_, org))],
        "preferences": _preferences(db, me),
        "data_requests": _requests(db, me),
        "photos": {"kept": photos, "note": PHOTOS_NOTE["en"].format(n=photos)},
        "not_included": ["Photo files", "Notes written by facility staff", "Other people's data"],
    }
