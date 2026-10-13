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
    # v2 (Phase 3): the scan flow now honours these decisions exactly as written
    # (pilates/sedens/scans.py; docs/SEDENS_ROOM_FLOW.md "Consent and photos").
    "scan_capture": {
        "version": "2026-10-v2",
        "en": "Use this room's camera to take four still photos of my body (front, both sides and back) for "
        "today's movement check. SEDENS estimates body keypoints in the photos and describes a few simple "
        "observations, such as whether my shoulder line looked level. The measurements and the summary I am "
        "shown are saved to my Fitness Passport at this facility. Unless I separately agree to keep them, the "
        "photos are deleted as soon as the analysis is finished. The camera does not record video and is off "
        "during the workout. This is general fitness guidance: SEDENS does not diagnose or treat any condition.",
        "ko": "오늘의 움직임 확인을 위해 이 룸의 카메라로 제 몸의 정지 사진 네 장(정면, 양옆, 뒷면)을 촬영하는 데 "
        "동의합니다. SEDENS는 사진에서 신체 관절 위치를 추정하고, 어깨선이 수평으로 보였는지와 같은 간단한 관찰 내용을 "
        "알려 줍니다. 측정값과 제게 보여 준 요약은 이 시설의 피트니스 패스포트에 저장됩니다. 사진 보관에 따로 동의하지 "
        "않으면 사진은 분석이 끝나는 즉시 삭제됩니다. 카메라는 영상을 녹화하지 않으며 운동 중에는 꺼져 있습니다. "
        "일반적인 피트니스 안내이며, SEDENS는 어떤 질환도 진단하거나 치료하지 않습니다.",
    },
    "scan_image_retention": {
        "version": "2026-10-v2",
        "en": "Keep my four scan photos in my facility's SEDENS records so they can be compared with later scans. "
        "If I don't agree, the photos are deleted after the analysis and only the measurements and the summary "
        "are kept. I can change this decision for future scans at any time.",
        "ko": "이후 스캔과 비교할 수 있도록 제 스캔 사진 네 장을 시설의 SEDENS 기록에 보관하는 데 동의합니다. "
        "동의하지 않으면 사진은 분석 후 삭제되고 측정값과 요약만 저장됩니다. 이 결정은 다음 스캔부터 언제든지 바꿀 수 "
        "있습니다.",
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
