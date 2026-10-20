"""Facility usage and a fee simulation that never invoices (Phase 4, Part 13).

A facility administrator sees, for one calendar month of their own organization,
how the AI Private Room was used and what the SEDENS usage fee would come to under
the plan assigned to the organization. Nothing here takes a payment, issues an
invoice or reports sales.

Everything is counted from the authoritative tables, never from ``s_events``
(product analytics): ``s_room_sessions``, ``s_workouts``, ``s_workout_steps``,
``s_room_scans``, ``s_room_scan_views`` and ``s_room_devices``. The answer is an
aggregate: no customer id or name, no scan image and no discomfort answer is
read into it.

Definitions (docs/SEDENS_PHASE_4_DESIGN.md section 5):

month               the calendar month in the organization's timezone
                    (``s_org_profiles.timezone``, default Asia/Seoul). A visit belongs to the
                    month its room session *started* in, so a workout finished after
                    midnight stays in the visit's month;
room session        one ``s_room_sessions`` row with ``origin='room'``; rows seeded for a
                    demonstration persona (``origin='demo_seed'``) are never counted;
billable session    a room session of the month with at least one workout in state
                    'completed', end reason 'completed', origin 'room' and at least one
                    step in state 'completed' (the Passport's completed-visit rule, see
                    :data:`pilates.sedens.passport.PERFORMED`). It counts once however many
                    workouts were completed in it, so a retry, a repeated completion
                    request or a second workout in the same visit adds nothing;
completed workout   state 'completed' with end reason 'completed';
incomplete workout  state 'stopped' or 'abandoned' after it started; a draft ('ready',
                    or replaced by a newer draft) is never counted;
used minutes        the sum of ``active_seconds`` of started workouts (pauses excluded);
licensed room       a distinct room with a screen (``s_room_devices``) that was active at
                    any point of the month: created before the month ended and not revoked
                    before it began;
repeat customer     a customer with two or more room sessions in the month.

Only activity that happened on this server is counted. A restore (backup.py) marks every room
session and screen it brings back with ``detail.restored``; those rows are history of another
organization (possibly one that still exists), so they are never counted, and neither are the
scans of a restored visit. A restored screen is not a licensed room until it is paired again.

Amounts: for KRW ``*_minor`` is a whole number of won (KRW has no minor unit), the
same convention as ``s_course_prices.amount_minor``.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
import json
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import capabilities
from .util import Denied, environment, parse

DEFAULT_PLAN = "proposal-2026-10"
DEFAULT_TIMEZONE = "Asia/Seoul"
FIRST_MONTH = (2025, 1)
_MONTH = re.compile(r"([0-9]{4})-(0[1-9]|1[0-2])")

BANDS = (("under_10", 0, 600), ("from_10_to_20", 600, 1200), ("from_20_to_30", 1200, 1800), ("over_30", 1800, None))
# s_creator_profiles.creator_type -> the program-type key shown to the facility.
PROGRAM_TYPES = ("standard", "coach", "professor", "expert", "editorial", "other")
_CREATOR_KEY = {"coach": "coach", "professor": "professor", "expert": "expert", "sedens_editorial": "editorial"}

# Language-neutral definitions; the page owns the wording (strings-usage.js).
DEFINITIONS = {
    "billable_unit": "visit_with_completed_workout",
    "counts": ("completed_workout_step", "one_per_visit"),
    "not_counted": ("stopped_or_abandoned_only", "all_steps_skipped", "retry_or_repeat_request",
                    "second_workout_same_visit", "seeded_demo_history", "analytics_events", "drafts"),
    "month_timezone": "facility_timezone",
    "visit_month": "visit_start",
    "licensed_room": "screen_active_in_month",
    "creator_type": "as_currently_declared",
    "amounts": "whole_won_vat_excluded",
}


def definitions(plan: dict | None) -> dict:
    """The language-neutral definitions; the amounts entry follows the plan's VAT basis."""
    out = {k: list(v) if isinstance(v, tuple) else v for k, v in DEFINITIONS.items()}
    if plan is not None and plan["vat_included"]:
        out["amounts"] = "whole_won_vat_included"
    return out


def restored(detail) -> bool:
    """True when a restore brought the row back (``detail.restored``); see backup.restore_row."""
    try:
        value = json.loads(detail) if isinstance(detail, str) else detail
    except ValueError:
        return False
    return isinstance(value, dict) and bool(value.get("restored"))

# A workout that counts for a visit: it ended as completed and at least one of its steps was
# performed. Mirrors passport.PERFORMED (kept here so the meter does not import the Passport).
_PERFORMED = ("w.state='completed' AND w.end_reason='completed' AND EXISTS "
              "(SELECT 1 FROM s_workout_steps st WHERE st.workout_id=w.id AND st.state='completed')")


# -- who may ask --------------------------------------------------------------------------------

def _facility_admin(sedens, db, actor) -> dict:
    """The organization the signed-in administrator of a facility belongs to."""
    if actor is None or actor.role != "admin":
        raise Denied("Only a facility administrator can see facility usage.", 403, "admin_required")
    org = sedens.org(db, actor.org_id)
    if org is None or org["kind"] != "facility":
        raise Denied("Facility usage is for facility administrators.", 403, "facility_required")
    return org


# -- the month ----------------------------------------------------------------------------------

def _zone(name) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def _timezone(db, org_id) -> str:
    row = db.execute("SELECT timezone FROM s_org_profiles WHERE org_id=?", (org_id,)).fetchone()
    return (row[0] if row and row[0] else DEFAULT_TIMEZONE)


def month_window(year: int, month: int, zone: ZoneInfo):
    """(start, end) of the calendar month as UTC datetimes: start inclusive, end exclusive."""
    first = datetime(year, month, 1, tzinfo=zone)
    following = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=zone)
    return first.astimezone(timezone.utc), following.astimezone(timezone.utc)


def parse_month(value, zone: ZoneInfo, current: datetime | None = None) -> tuple[int, int]:
    """'YYYY-MM' -> (year, month). Defaults to the current month of the facility; a month before
    the first supported month, or one that has not started yet, is refused."""
    today = (current or datetime.now(timezone.utc)).astimezone(zone)
    if value in (None, ""):
        return today.year, today.month
    found = _MONTH.fullmatch(str(value))
    if not found:
        raise Denied("Choose a month as YYYY-MM.", 400, "invalid_month")
    year, month = int(found.group(1)), int(found.group(2))
    if (year, month) < FIRST_MONTH or (year, month) > (today.year, today.month):
        raise Denied("Choose a month from January 2025 up to the current month.", 400, "invalid_month")
    return year, month


def _day(moment: datetime) -> str:
    return moment.date().isoformat()


def _loose(start: datetime, end: datetime) -> tuple[str, str]:
    """Calendar days (UTC) that bound the month, a day wider on each side. The exact test is made on
    parsed timestamps, so a stored format (``+00:00`` or ``Z``) never decides which month a row is in."""
    return _day(start - timedelta(days=1)), _day(end + timedelta(days=1))


# -- the fee simulation ---------------------------------------------------------------------------

def _plan_public(row, assigned: bool) -> dict:
    return {"id": row["id"], "label": row["label"], "currency": row["currency"],
            "room_month_minor": row["room_month_minor"], "per_session_minor": row["per_session_minor"],
            "vat_included": bool(row["vat_included"]), "billable_unit": row["billable_unit"], "assigned": assigned}


def plan_for(db, org_id) -> dict | None:
    """The plan assigned to the organization, or the default plan."""
    row = db.execute("SELECT p.*, 1 AS assigned FROM s_org_usage_plans a JOIN s_usage_price_plans p ON p.id=a.plan_id "
                     "WHERE a.org_id=?", (org_id,)).fetchone()
    if row is None:
        row = db.execute("SELECT p.*, 0 AS assigned FROM s_usage_price_plans p WHERE p.id=?", (DEFAULT_PLAN,)).fetchone()
    return _plan_public(row, bool(row["assigned"])) if row else None


def simulate(plan: dict | None, rooms: int, sessions: int) -> dict | None:
    """``rooms x room_month + sessions x per_session``. Whole won; never an invoice."""
    if plan is None:
        return None
    room_fee = rooms * plan["room_month_minor"]
    session_fee = sessions * plan["per_session_minor"]
    return {"invoice": False, "payment_taken": False, "vat_included": plan["vat_included"], "currency": plan["currency"],
            "plan": plan, "inputs": {"licensed_rooms": rooms, "billable_sessions": sessions},
            "room_fee": room_fee, "session_fee": session_fee, "total": room_fee + session_fee,
            "formula": "licensed_rooms * room_month + billable_sessions * per_session"}


# -- the meter ------------------------------------------------------------------------------------

def usage(sedens, db, actor, month=None, *, current: datetime | None = None) -> dict:
    org = _facility_admin(sedens, db, actor)
    tzname = _timezone(db, org["id"])
    zone = _zone(tzname)
    year, mon = parse_month(month, zone, current)
    start, end = month_window(year, mon, zone)
    lo, hi = _loose(start, end)

    def inside(value) -> bool:
        moment = parse(value)
        return moment is not None and start <= moment < end

    # Visits: the organization's own room sessions of the month. Seeded history is never counted.
    visits = {}
    simulated_visits = 0
    brought_back = set()  # visits a restore copied here: another organization's history
    for row in db.execute("SELECT id, student_id, started_at, simulated, detail FROM s_room_sessions WHERE org_id=? "
                          "AND origin='room' AND substr(started_at,1,10) BETWEEN ? AND ?", (org["id"], lo, hi)):
        if restored(row["detail"]):
            brought_back.add(row["id"])
        elif inside(row["started_at"]):
            visits[row["id"]] = row["student_id"]
            simulated_visits += row["simulated"]

    # Workouts of those visits (a visit's workouts belong to the visit's month).
    started = completed = incomplete = 0
    seconds = 0
    program = Counter()
    performed_visits = set()
    visit_seconds = Counter()
    for row in db.execute(
            "SELECT w.room_session_id AS visit, w.kind, w.state, w.end_reason, w.started_at, w.active_seconds, "
            f"cp.creator_type, ({_PERFORMED}) AS performed "
            "FROM s_workouts w JOIN s_room_sessions s ON s.id=w.room_session_id "
            "LEFT JOIN s_courses c ON c.id=w.course_id LEFT JOIN s_creator_profiles cp ON cp.id=c.creator_id "
            "WHERE w.org_id=? AND w.origin='room' AND s.org_id=w.org_id AND s.origin='room' "
            "AND substr(s.started_at,1,10) BETWEEN ? AND ?", (org["id"], lo, hi)):
        if row["visit"] not in visits:
            continue
        if row["performed"]:
            performed_visits.add(row["visit"])
        if row["state"] == "completed" and row["end_reason"] == "completed":
            completed += 1
        # A workout that never started (a draft, or one replaced by a newer draft) is not usage.
        if row["started_at"] is None or row["state"] == "ready" or row["end_reason"] == "replaced":
            continue
        started += 1
        seconds += row["active_seconds"] or 0
        visit_seconds[row["visit"]] += row["active_seconds"] or 0
        if row["state"] in ("stopped", "abandoned"):
            incomplete += 1
        program["standard" if row["kind"] == "standard" else _CREATOR_KEY.get(row["creator_type"], "other")] += 1

    billable = len(performed_visits)
    bands = {key: 0 for key, _, _ in BANDS}
    for visit in performed_visits:
        spent = visit_seconds[visit]
        for key, low, high in BANDS:
            if spent >= low and (high is None or spent < high):
                bands[key] += 1
                break

    # Scans: technical failures and retakes of this month's real scans.
    failures = retakes = 0
    for row in db.execute(
            "SELECT s.state, s.started_at, s.room_session_id, COALESCE((SELECT sum(v.retakes) FROM s_room_scan_views v WHERE v.scan_id=s.id),0) AS retakes "
            "FROM s_room_scans s WHERE s.org_id=? AND s.origin='room' AND substr(s.started_at,1,10) BETWEEN ? AND ?",
            (org["id"], lo, hi)):
        if row["room_session_id"] not in brought_back and inside(row["started_at"]):
            failures += row["state"] == "failed"
            retakes += row["retakes"]

    # Licensed rooms: a room whose screen was active at any point of the month.
    licensed, simulated_devices = set(), 0
    for row in db.execute("SELECT room_id, created_at, revoked_at, simulated, detail FROM s_room_devices WHERE org_id=? "
                          "AND room_id IS NOT NULL", (org["id"],)):
        if restored(row["detail"]):
            continue  # a screen a restore brought back was paired elsewhere, not here
        created, revoked = parse(row["created_at"]), parse(row["revoked_at"])
        if created is not None and created < end and (revoked is None or revoked >= start):
            licensed.add(row["room_id"])
            simulated_devices += row["simulated"]

    per_customer = Counter(visits.values())
    plan = plan_for(db, org["id"])
    demonstration = bool(org["demo"] or simulated_devices or simulated_visits)
    return {
        "month": f"{year:04d}-{mon:02d}",
        "timezone": zone.key,
        "window": {"from": start.astimezone(zone).date().isoformat(),
                   "to": (end.astimezone(zone) - timedelta(days=1)).date().isoformat()},
        "months": {"first": "%04d-%02d" % FIRST_MONTH, "last": "%04d-%02d" % _month_of(current, zone)},
        "demonstration": {"flagged": demonstration, "organization": bool(org["demo"]),
                          "simulated_devices": simulated_devices, "simulated_visits": simulated_visits,
                          "never_invoiced": True},
        "metrics": {
            "room_sessions": len(visits),
            "completed_workouts": completed,
            "incomplete_workouts": incomplete,
            "used_minutes": int(seconds / 60 + 0.5),
            "billable_sessions": billable,
            "licensed_rooms": len(licensed),
            "repeat_customers": sum(1 for n in per_customer.values() if n >= 2),
            "technical_failures": failures,
            "scan_retakes": int(retakes),
        },
        "duration_bands": [{"band": key, "from_seconds": low, "to_seconds": high, "sessions": bands[key]}
                           for key, low, high in BANDS],
        "program_types": [{"type": key, "workouts": program[key]} for key in PROGRAM_TYPES],
        "simulation": simulate(plan, len(licensed), billable),
        "definitions": definitions(plan),
    }


def _month_of(current, zone):
    today = (current or datetime.now(timezone.utc)).astimezone(zone)
    return today.year, today.month


# -- plans (SEDENS administrators) ----------------------------------------------------------------

def plans(sedens, db, actor) -> dict:
    capabilities.require(sedens, db, actor, "sedens_admin")
    return {"default_plan_id": DEFAULT_PLAN,
            "items": [_plan_public(r, False) | {"organizations": db.execute(
                "SELECT count(*) FROM s_org_usage_plans WHERE plan_id=?", (r["id"],)).fetchone()[0]}
                for r in db.execute("SELECT * FROM s_usage_price_plans ORDER BY created_at, id")]}


def assign_plan(sedens, db, actor, org_id, plan_id) -> dict:
    """Assign a price plan to a facility. Only a SEDENS administrator; audited."""
    capabilities.require(sedens, db, actor, "sedens_admin")
    if not isinstance(org_id, str) or not isinstance(plan_id, str) or not org_id or not plan_id:
        raise Denied("Choose an organization and a price plan.", 400, "invalid")
    target = sedens.org(db, org_id)
    if target is None or target["kind"] != "facility":
        raise Denied("Choose a facility.", 404, "unknown_org")
    here = sedens.org(db, actor.org_id)
    if environment(here) != environment(target):
        raise Denied("Choose a facility in the same environment.", 403, "environment_mismatch")
    plan = db.execute("SELECT * FROM s_usage_price_plans WHERE id=?", (plan_id,)).fetchone()
    if plan is None:
        raise Denied("Choose an existing price plan.", 404, "unknown_plan")
    before = db.execute("SELECT plan_id FROM s_org_usage_plans WHERE org_id=?", (org_id,)).fetchone()
    stamp = datetime.now(timezone.utc).isoformat()
    db.execute("INSERT INTO s_org_usage_plans(org_id,plan_id,assigned_by,assigned_at) VALUES (?,?,?,?) "
               "ON CONFLICT(org_id) DO UPDATE SET plan_id=excluded.plan_id, assigned_by=excluded.assigned_by, "
               "assigned_at=excluded.assigned_at", (org_id, plan_id, actor.user_id, stamp))
    sedens.audit(db, org_id, actor.user_id, "usage_plan:assign", org_id,
                 {"plan_id": plan_id, "previous": before[0] if before else None})
    return {"org_id": org_id, "plan": _plan_public(plan, True)}
