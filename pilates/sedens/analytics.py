"""Local product-analytics events. SQLite only; nothing leaves the server.

Events record *that* something happened in the room, never what a person said
or what the camera saw. Names come from a fixed list; properties are a small
flat map of short values with personal-looking keys refused.

A person is linked to an event (``user_id``) only when they have granted the
``product_analytics`` consent; otherwise the event keeps only its room session,
which is the facility's own operational record of the visit.
"""

from __future__ import annotations

import math
import re

from .util import Denied, encode, now

# Recorded by the server as part of the action they describe.
SERVER_EVENTS = frozenset({
    "device_paired", "device_revoked",
    "room_entry_denied", "room_entered", "room_session_started", "room_session_ended",
    "consent_recorded",
    # Reserved for Phase 3+ server actions; listed so the schema is stable.
    "scan_started", "scan_completed", "scan_retake",
    "recommendation_shown", "recommendation_accepted",
    "workout_started", "session_completed", "session_abandoned",
    "course_viewed", "course_enrolled_demo",
})
# May be sent by an authorized room screen (POST /sedens/room/event).
CLIENT_EVENTS = frozenset({
    "room_screen_viewed", "exercise_started", "exercise_skipped",
    "anatomy_opened", "structure_isolated",
})
EVENTS = SERVER_EVENTS | CLIENT_EVENTS

_KEY = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_PERSONAL = re.compile(r"(email|phone|name|address|password|token|credential|pin|answer|note|comment|text|birth|born)", re.I)
MAX_PROPS = 16
MAX_VALUE = 120


def clean_props(props) -> dict:
    if props in (None, {}):
        return {}
    if not isinstance(props, dict) or len(props) > MAX_PROPS:
        raise Denied(f"Event properties must be a map of at most {MAX_PROPS} values.", 400, "invalid_event")
    clean = {}
    for key, value in props.items():
        if not isinstance(key, str) or not _KEY.match(key) or _PERSONAL.search(key):
            raise Denied(f"Event property {key!r} is not allowed.", 400, "invalid_event")
        if isinstance(value, bool) or value is None:
            clean[key] = value
        elif isinstance(value, int):
            clean[key] = value
        elif isinstance(value, float):
            if not math.isfinite(value):
                raise Denied("Event numbers must be finite.", 400, "invalid_event")
            clean[key] = value
        elif isinstance(value, str):
            if len(value) > MAX_VALUE:
                raise Denied("Event text values must be short codes.", 400, "invalid_event")
            clean[key] = value
        else:
            raise Denied("Event values must be plain text, numbers or true/false.", 400, "invalid_event")
    return clean


def consented(db, user_id) -> bool:
    if not user_id:
        return False
    row = db.execute(
        "SELECT granted FROM s_consents WHERE user_id=? AND kind='product_analytics' ORDER BY recorded_at DESC, rowid DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    return bool(row and row[0])


def record(db, name, *, org_id, source="server", user_id=None, room_id=None, device_id=None,
           room_session_id=None, demo=False, props=None):
    if name not in EVENTS:
        raise Denied("Unknown analytics event.", 400, "unknown_event")
    if source == "client" and name not in CLIENT_EVENTS:
        raise Denied("This event is recorded by the server, not the screen.", 400, "server_event")
    db.execute(
        "INSERT INTO s_events(org_id,name,at,source,user_id,room_id,device_id,room_session_id,demo,props) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            org_id, name, now(), source,
            user_id if consented(db, user_id) else None,
            room_id, device_id, room_session_id, int(bool(demo)), encode(clean_props(props)),
        ),
    )


def counts(db, org_id) -> dict:
    """Raw event counts for an organization. Not a dashboard: no derived rates."""
    return {
        r[0]: r[1]
        for r in db.execute("SELECT name,count(*) FROM s_events WHERE org_id=? GROUP BY name", (org_id,))
    }
