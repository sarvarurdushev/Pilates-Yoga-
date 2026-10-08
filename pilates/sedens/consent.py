"""Consent records: explicit, versioned, append-only, per person.

Each decision is a new row; the latest row for a (person, kind) is the current
state, so a withdrawal never erases the history of what was agreed and when.
Texts are versioned: changing a sentence means a new version, and a decision is
always stored with the exact version the person saw.
"""

from __future__ import annotations

from . import analytics
from .util import Denied, now, uid

TEXTS = {
    "scan_capture": {
        "version": "2026-10-v1",
        "en": "Use this room's camera to take still photos of my body for today's movement check. "
        "SEDENS describes what the camera observed in those photos. It does not diagnose pain, "
        "injury or any medical condition.",
        "ko": "오늘의 움직임 확인을 위해 이 룸의 카메라로 제 몸의 정지 사진을 촬영하는 데 동의합니다. "
        "SEDENS는 사진에서 카메라가 관찰한 내용을 설명할 뿐, 통증·부상·질환을 진단하지 않습니다.",
    },
    "scan_image_retention": {
        "version": "2026-10-v1",
        # Phase 1 records this decision only. The scan flow (Phase 3) must honour
        # it before any wording about what happens on refusal is added here.
        "en": "Keep my scan photos in my facility's SEDENS records so later scans can be compared with them.",
        "ko": "이후 스캔과 비교할 수 있도록 제 스캔 사진을 시설의 SEDENS 기록에 보관하는 데 동의합니다.",
    },
    "product_analytics": {
        "version": "2026-10-v1",
        "en": "Link my use of SEDENS screens and steps (not camera images or health answers) to my account "
        "so my facility and SEDENS can understand how the room is used.",
        "ko": "카메라 이미지나 건강 관련 답변을 제외한 SEDENS 화면·단계 이용 기록을 제 계정과 연결하여, "
        "시설과 SEDENS가 룸 이용 방식을 이해하는 데 동의합니다.",
    },
}
KINDS = tuple(TEXTS)


def texts() -> dict:
    return {kind: dict(value) for kind, value in TEXTS.items()}


def current(db, user_id) -> dict:
    state = {}
    for kind in KINDS:
        row = db.execute(
            "SELECT granted,text_version,recorded_at,channel FROM s_consents WHERE user_id=? AND kind=? "
            "ORDER BY recorded_at DESC, rowid DESC LIMIT 1",
            (user_id, kind),
        ).fetchone()
        state[kind] = None if row is None else {
            "granted": bool(row["granted"]),
            "text_version": row["text_version"],
            "recorded_at": row["recorded_at"],
            "channel": row["channel"],
            # A decision made on an older wording must be asked again.
            "current_version": row["text_version"] == TEXTS[kind]["version"],
        }
    return state


def record(db, *, org_id, user_id, kind, granted, text_version, channel, room_session_id=None,
           room_id=None, device_id=None, demo=False):
    if kind not in TEXTS:
        raise Denied("Choose a listed consent.", 400, "unknown_consent")
    if text_version != TEXTS[kind]["version"]:
        raise Denied("This consent text has changed. Read the current version and decide again.", 409, "stale_consent_text")
    if not isinstance(granted, bool):
        raise Denied("Choose agree or do not agree.", 400, "invalid")
    db.execute(
        "INSERT INTO s_consents(id,org_id,user_id,kind,text_version,granted,recorded_at,room_session_id,channel) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (uid(), org_id, user_id, kind, text_version, int(granted), now(), room_session_id, channel),
    )
    analytics.record(
        db, "consent_recorded", org_id=org_id, user_id=user_id, room_id=room_id, device_id=device_id,
        room_session_id=room_session_id, demo=demo, props={"kind": kind, "granted": granted, "channel": channel},
    )
    return current(db, user_id)
