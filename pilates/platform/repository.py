"""Relational organization data and authorization; no client-side scope decisions."""

from __future__ import annotations
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import uuid


def uid():
    return uuid.uuid4().hex


def now():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, allow_nan=False, separators=(",", ":"))


def unpack(row):
    if row is None:
        return None
    value = dict(row)
    for field in (
        "detail",
        "result",
        "completed",
        "structures",
        "landmark_ids",
        "summary",
    ):
        if field in value:
            value[field] = json.loads(value[field])
    value.pop("password_hash", None)
    return value


class Refused(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Actor:
    user_id: str
    org_id: str
    role: str
    demo: bool = False


TABLES = {
    "locations": "p_locations",
    "equipment": "p_equipment",
    "exercises": "p_exercises",
    "programs": "p_programs",
    "analyses": "p_analyses",
    "reservations": "p_reservations",
    "scans": "p_scans",
    "notes": "p_notes",
    "media": "p_media",
    "jobs": "p_jobs",
}
WRITABLE = {
    "locations": ("name", "address", "capacity", "detail"),
    "equipment": ("location_id", "name", "quantity", "available", "detail"),
    "exercises": (
        "name",
        "category",
        "difficulty",
        "region_id",
        "visibility",
        "detail",
    ),
    "programs": ("name", "goal", "location_id", "region_id", "detail"),
    "reservations": (
        "student_id",
        "coach_id",
        "location_id",
        "room_id",
        "program_id",
        "starts_at",
        "ends_at",
        "status",
        "session_type",
        "detail",
    ),
    "scans": (
        "student_id",
        "analysis_id",
        "region_id",
        "media_id",
        "name",
        "scan_type",
        "captured_at",
        "detail",
    ),
    "notes": (
        "student_id",
        "analysis_id",
        "region_id",
        "scan_id",
        "program_id",
        "exercise_id",
        "text",
        "visibility",
        "detail",
    ),
}

# Separate link tables preserve the positional layout of existing note and scan rows.
VISIT_LINKS = {"notes": ("p_session_notes", "note_id"), "scans": ("p_session_scans", "scan_id")}


def password_hash(password):
    if not isinstance(password, str) or not 10 <= len(password) <= 1024:
        raise Refused("Use a password of 10–1024 characters.")
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 600_000
    ).hex()
    return f"pbkdf2_sha256$600000${salt}${hashed}"


def password_ok(password, stored):
    try:
        algo, iterations, salt, expected = stored.split("$")
        if algo != "pbkdf2_sha256" or int(iterations) != 600_000:
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", str(password).encode(), bytes.fromhex(salt), int(iterations)
        ).hex()
        return hmac.compare_digest(expected, actual)
    except (ValueError, TypeError):
        return False


def backfill_session_exercise_events(db):
    """Link legacy completed keys to their session without inventing timestamps."""
    for session in db.execute(
        "SELECT id,completed FROM p_training_sessions ts WHERE NOT EXISTS "
        "(SELECT 1 FROM p_session_exercise_events e WHERE e.session_id=ts.id)"
    ):
        for sequence, key in enumerate(json.loads(session["completed"] or "[]"), 1):
            if isinstance(key, str):
                db.execute("INSERT INTO p_session_exercise_events VALUES (?,?,?,?,?,?)",
                           (uid(), session["id"], sequence, key, None, None))


class Repository:
    def __init__(self, path, media_root=None):
        self.path = str(path)
        self._transaction = threading.local()
        self.media_root = Path(media_root or (str(path) + ".media"))
        self.media_root.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript(Path(__file__).with_name("schema.sql").read_text())
            db.execute("INSERT OR IGNORE INTO p_schema VALUES (1,?)", (now(),))
            db.execute(
                "INSERT OR IGNORE INTO p_session_analyses(session_id,analysis_id) "
                "SELECT id,analysis_id FROM p_training_sessions WHERE analysis_id IS NOT NULL"
            )
            backfill_session_exercise_events(db)
        from .regions import seed_regions

        seed_regions(self)
        from .designer import backfill_revisions

        backfill_revisions(self)

    @contextmanager
    def db(self):
        active = getattr(self._transaction, "connection", None)
        if active is not None:
            yield active
            return
        conn = sqlite3.connect(self.path, timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @contextmanager
    def batch(self):
        """One atomic transaction for a connected import, confined to this thread."""
        if getattr(self._transaction, "connection", None) is not None:
            yield
            return
        with self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self._transaction.connection = conn
            try:
                yield
            finally:
                del self._transaction.connection

    def create_org(self, name, email, password, organization):
        name, email = str(name).strip()[:100], str(email).strip().lower()[:254]
        if not name or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise Refused("Enter your name and a valid email address.")
        hashed = password_hash(password)
        with self.db() as db:
            if db.execute(
                "SELECT 1 FROM p_users u JOIN p_organizations o ON o.id=u.org_id WHERE u.email=? AND o.demo=0",
                (email,),
            ).fetchone():
                raise Refused("An account already uses that email. Sign in instead.")
            org, user = uid(), uid()
            db.execute(
                "INSERT INTO p_organizations VALUES (?,?,0,?)",
                (org, str(organization or "My studio")[:100], now()),
            )
            db.execute(
                "INSERT INTO p_users(id,org_id,name,email,password_hash) VALUES (?,?,?,?,?)",
                (user, org, name, email, hashed),
            )
            db.execute("INSERT INTO p_roles VALUES (?,?)", (user, "admin"))
        return self.issue(user, "admin")

    def issue(self, user, role):
        token = secrets.token_urlsafe(32)
        with self.db() as db:
            if not db.execute(
                "SELECT 1 FROM p_roles WHERE user_id=? AND role=?", (user, role)
            ).fetchone():
                raise Refused("That role is not assigned to this account.", 403)
            db.execute(
                "INSERT INTO p_sessions VALUES (?,?,?,?)",
                (
                    hashlib.sha256(token.encode()).hexdigest(),
                    user,
                    role,
                    time.time() + 86400 * 7,
                ),
            )
        return token

    def login(self, email, password):
        with self.db() as db:
            row = db.execute(
                "SELECT u.* FROM p_users u JOIN p_organizations o ON o.id=u.org_id WHERE lower(u.email)=? AND o.demo=0 AND u.active=1",
                (str(email).lower().strip(),),
            ).fetchone()
            # Spend the same KDF effort for unknown emails without allocating a model-sized buffer.
            stored = (
                row["password_hash"]
                if row
                else "pbkdf2_sha256$600000$" + "00" * 16 + "$" + "00" * 32
            )
            valid = password_ok(password, stored)
            if not row or not valid:
                raise Refused("Email or password was not recognized.", 401)
            roles = [
                r[0]
                for r in db.execute(
                    "SELECT role FROM p_roles WHERE user_id=?", (row["id"],)
                )
            ]
        return self.issue(
            row["id"], next(r for r in ("coach", "student", "admin") if r in roles)
        )

    def actor(self, token):
        with self.db() as db:
            row = db.execute(
                """SELECT u.id,u.org_id,s.role,o.demo FROM p_sessions s
                JOIN p_users u ON u.id=s.user_id JOIN p_organizations o ON o.id=u.org_id
                JOIN p_roles r ON r.user_id=u.id AND r.role=s.role
                WHERE s.token_hash=? AND s.expires>? AND u.active=1""",
                (hashlib.sha256((token or "").encode()).hexdigest(), time.time()),
            ).fetchone()
        if not row:
            raise Refused("Sign in to open your workspace.", 401)
        return Actor(row["id"], row["org_id"], row["role"], bool(row["demo"]))

    def logout(self, token):
        with self.db() as db:
            db.execute(
                "DELETE FROM p_sessions WHERE token_hash=?",
                (hashlib.sha256((token or "").encode()).hexdigest(),),
            )

    def demo_login(self, key, role="coach", user_id=None):
        if not re.fullmatch(r"[a-f0-9]{32}", str(key)):
            raise Refused("Open a new demonstration workspace.")
        if role not in ("admin", "coach", "student"):
            raise Refused("Choose a demonstration role.")
        org = "demo-" + key
        from .seed import seed_organization

        seed_organization(self, org)
        from .designer import backfill_revisions

        backfill_revisions(self, org)
        with self.db() as db:
            if user_id:
                row = db.execute(
                    "SELECT u.id FROM p_users u JOIN p_roles r ON r.user_id=u.id WHERE u.org_id=? AND u.id=? AND r.role=?",
                    (org, user_id, role),
                ).fetchone()
            else:
                row = db.execute(
                    "SELECT u.id FROM p_users u JOIN p_roles r ON r.user_id=u.id WHERE u.org_id=? AND r.role=? ORDER BY u.id LIMIT 1",
                    (org, role),
                ).fetchone()
            if not row:
                raise Refused("This demonstration profile is not available.", 404)
        return self.issue(row["id"], role)

    def assert_student(self, actor, student_id, write=False, db=None):
        if db is None:
            with self.db() as conn:
                return self.assert_student(actor, student_id, write, conn)
        found = db.execute(
            "SELECT 1 FROM p_students s JOIN p_users u ON u.id=s.id WHERE s.id=? AND u.org_id=?",
            (student_id, actor.org_id),
        ).fetchone()
        allowed = bool(found) and (
            actor.role == "admin"
            or (actor.role == "student" and actor.user_id == student_id)
            or (
                actor.role == "coach"
                and db.execute(
                    "SELECT 1 FROM p_coach_students WHERE coach_id=? AND student_id=?",
                    (actor.user_id, student_id),
                ).fetchone()
            )
        )
        if not allowed:
            raise Refused("This client is not in your assigned workspace.", 403)

    def student_ids(self, actor, db):
        sql = "SELECT s.id FROM p_students s JOIN p_users u ON u.id=s.id JOIN p_roles r ON r.user_id=s.id AND r.role='student' WHERE u.org_id=? AND u.active=1"
        args = [actor.org_id]
        if actor.role == "student":
            sql += " AND s.id=?"
            args.append(actor.user_id)
        elif actor.role == "coach":
            sql += " AND s.id IN (SELECT student_id FROM p_coach_students WHERE coach_id=?)"
            args.append(actor.user_id)
        return [r[0] for r in db.execute(sql, args)]

    def location_ids(self, actor, db):
        if actor.role == "admin":
            return [
                r[0]
                for r in db.execute(
                    "SELECT id FROM p_locations WHERE org_id=?", (actor.org_id,)
                )
            ]
        table, field = (
            ("p_coach_locations", "coach_id")
            if actor.role == "coach"
            else ("p_student_locations", "student_id")
        )
        return [
            r[0]
            for r in db.execute(
                f"SELECT location_id FROM {table} WHERE {field}=?", (actor.user_id,)
            )
        ]

    def _scope(self, actor, collection, db):
        if actor.role == "admin":
            return "org_id=?", [actor.org_id]
        students = self.student_ids(actor, db)
        marks = ",".join("?" for _ in students) or "NULL"
        if collection in ("analyses", "reservations", "scans", "notes", "jobs"):
            where, args = f"org_id=? AND student_id IN ({marks})", [
                actor.org_id,
                *students,
            ]
            if collection == "notes" and actor.role == "student":
                where += " AND visibility='student'"
            if collection == "reservations" and actor.role == "coach":
                where += " AND coach_id=?"
                args.append(actor.user_id)
            return where, args
        if collection == "media":
            if actor.role == "admin":
                return "org_id=?", [actor.org_id]
            where = f"org_id=? AND (student_id IN ({marks}) OR owner_id=? OR exercise_id IN (SELECT id FROM p_exercises WHERE org_id=? AND visibility='organization') OR exercise_id IN (SELECT pe.exercise_id FROM p_program_exercises pe JOIN p_program_assignments pa ON pa.program_id=pe.program_id WHERE pa.student_id IN ({marks})))"
            if actor.role == "student":
                where += " AND id NOT IN (SELECT json_extract(m.value,'$.media_id') FROM p_program_step_details sd, json_each(sd.detail,'$.media') m WHERE json_extract(m.value,'$.visibility')='coach')"
                where += " AND id NOT IN (SELECT json_extract(m.value,'$.media_id') FROM p_program_revisions r, json_each(r.snapshot,'$.steps') s, json_each(s.value,'$.detail.media') m WHERE json_extract(m.value,'$.visibility')='coach')"
            return where, [actor.org_id, *students, actor.user_id, actor.org_id, *students]
        if collection in ("locations", "equipment") and actor.role != "admin":
            locations = self.location_ids(actor, db)
            field = "id" if collection == "locations" else "location_id"
            return "org_id=? AND " + field + " IN (" + (
                ",".join("?" for _ in locations) or "NULL"
            ) + ")", [actor.org_id, *locations]
        if collection == "exercises" and actor.role != "admin":
            return (
                "org_id=? AND (visibility='organization' OR owner_id=? OR id IN (SELECT pe.exercise_id FROM p_program_exercises pe JOIN p_program_assignments pa ON pa.program_id=pe.program_id WHERE pa.student_id IN ("
                + marks
                + ")))",
                [actor.org_id, actor.user_id, *students],
            )
        if collection == "programs" and actor.role != "admin":
            template = " OR (json_extract(detail,'$.template')=1 AND json_extract(detail,'$.template_visibility')='organization')" if actor.role == "coach" else ""
            return (
                f"org_id=? AND (owner_id=? OR id IN (SELECT program_id FROM p_program_assignments WHERE student_id IN ({marks})){template})",
                [actor.org_id, actor.user_id, *students],
            )
        return "org_id=?", [actor.org_id]

    def list(
        self,
        actor,
        collection,
        *,
        student_id=None,
        q="",
        offset=0,
        limit=100,
        category=None,
        kind=None,
        region=None,
        own=False,
    ):
        if collection not in TABLES:
            raise Refused("Unknown collection.", 404)
        with self.db() as db:
            where, args = self._scope(actor, collection, db)
            if own and collection in ("exercises", "programs"):
                where += " AND owner_id=?"
                args.append(actor.user_id)
            if region and collection in ("exercises", "programs"):
                where += " AND region_id=?"
                args.append(region)
            if kind and collection == "analyses":
                where += " AND kind=?"
                args.append(kind)
            if collection == "exercises":
                where += " AND COALESCE(json_extract(detail,'$.program_only'),0)!=1"
            if category and collection == "exercises":
                where += " AND (category=? OR EXISTS (SELECT 1 FROM json_each(detail,'$.tags') WHERE value=?))"
                args.extend([category, category])
            if student_id and collection == "programs":
                self.assert_student(actor, student_id, db=db)
                where += " AND id IN (SELECT program_id FROM p_program_assignments WHERE student_id=? AND active=1)"
                args.append(student_id)
            if student_id and collection in (
                "analyses",
                "reservations",
                "scans",
                "notes",
                "jobs",
                "media",
            ):
                self.assert_student(actor, student_id, db=db)
                where += " AND student_id=?"
                args.append(student_id)
            if q:
                fields = {
                    "analyses": ["id", "protocol"],
                    "notes": ["text"],
                    "reservations": ["session_type", "starts_at"],
                    "jobs": ["progress"],
                    "media": ["filename"],
                    "exercises": ["name", "detail"],
                }.get(collection, ["name"])
                where += " AND (" + " OR ".join(f"{f} LIKE ?" for f in fields) + ")"
                args.extend(["%" + str(q)[:100] + "%"] * len(fields))
            count = db.execute(
                f"SELECT count(*) FROM {TABLES[collection]} WHERE {where}", args
            ).fetchone()[0]
            order = {
                "analyses": "created_at DESC",
                "notes": "created_at DESC",
                "reservations": "starts_at DESC",
                "exercises": "name COLLATE NOCASE, id",
                "programs": "name COLLATE NOCASE, id",
            }.get(collection, "id")
            fields = (
                "*"
                if collection != "analyses"
                else "id,org_id,student_id,coach_id,location_id,kind,protocol,created_at,status,demo,detail"
            )
            if collection in VISIT_LINKS:
                link_table, key = VISIT_LINKS[collection]
                fields += f", (SELECT session_id FROM {link_table} WHERE {key}={TABLES[collection]}.id) AS session_id"
            rows = [
                unpack(r)
                for r in db.execute(
                    f"SELECT {fields} FROM {TABLES[collection]} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
                    args + [min(max(int(limit), 1), 200), max(int(offset), 0)],
                )
            ]
            if collection == "media":
                for row in rows:
                    row.pop("path", None)
                capture_rows = [row for row in rows if row["kind"] == "capture"]
                if capture_rows:
                    by_id = {row["id"]: row for row in capture_rows}
                    ids = list(by_id)
                    marks = ",".join("?" for _ in ids)
                    sources = {identifier: [] for identifier in ids}
                    # The media upload predates analysis, so view and protocol
                    # live on the saved image/video analysis links. Read only
                    # those links for media already visible to this actor.
                    for linked in db.execute(
                        "SELECT source.media_id,source.view,a.protocol "
                        "FROM ("
                        f"SELECT media_id,view,analysis_id FROM p_image_analyses WHERE media_id IN ({marks}) "
                        "UNION ALL "
                        f"SELECT media_id,view,analysis_id FROM p_video_analyses WHERE media_id IN ({marks})"
                        ") source JOIN p_analyses a ON a.id=source.analysis_id "
                        "JOIN p_media m ON m.id=source.media_id "
                        "WHERE a.org_id=? AND a.student_id=m.student_id",
                        [*ids, *ids, actor.org_id],
                    ):
                        sources[linked["media_id"]].append(linked)
                    for identifier, linked in sources.items():
                        if not linked:
                            continue
                        views = {source["view"] for source in linked}
                        protocols = {source["protocol"] for source in linked}
                        # A capture can be reused. Do not describe it using
                        # one arbitrary analysis if the linked records disagree.
                        if len(views) == 1:
                            by_id[identifier]["capture_view"] = next(iter(views))
                        if len(protocols) == 1 and next(iter(protocols)):
                            by_id[identifier]["capture_protocol"] = next(iter(protocols))
            if collection == "programs" and actor.role == "student":
                for row in rows:
                    row["detail"].pop("coach_notes", None)
            if collection == "exercises":
                for row in rows:
                    first = db.execute(
                        "SELECT id FROM p_media WHERE exercise_id=? AND mime LIKE 'image/%' ORDER BY created_at DESC LIMIT 1",
                        (row["id"],),
                    ).fetchone()
                    row["thumbnail_media_id"] = first[0] if first else None
            return {"items": rows, "total": count, "offset": int(offset)}

    def get(self, actor, collection, identifier, db=None):
        if collection not in TABLES:
            raise Refused("Unknown collection.", 404)
        if db is None:
            with self.db() as conn:
                return self.get(actor, collection, identifier, conn)
        where, args = self._scope(actor, collection, db)
        fields = "*"
        if collection in VISIT_LINKS:
            link_table, key = VISIT_LINKS[collection]
            fields += f", (SELECT session_id FROM {link_table} WHERE {key}={TABLES[collection]}.id) AS session_id"
        row = db.execute(
            f"SELECT {fields} FROM {TABLES[collection]} WHERE ({where}) AND id=?",
            args + [identifier],
        ).fetchone()
        if not row:
            raise Refused("This record is not available in your workspace.", 404)
        result = unpack(row)
        if collection == "programs":
            from .designer import student_program

            result["steps"] = []
            for r in db.execute(
                "SELECT pe.*,sd.detail AS step_detail,e.name AS exercise_name,e.category AS exercise_category,e.region_id AS exercise_region_id FROM p_program_exercises pe LEFT JOIN p_program_step_details sd ON sd.step_id=pe.id JOIN p_exercises e ON e.id=pe.exercise_id WHERE pe.program_id=? ORDER BY pe.position",
                (identifier,),
            ):
                step = dict(r)
                step["detail"] = json.loads(step.pop("step_detail") or "{}")
                result["steps"].append(step)
            result["steps"].extend(
                {**dict(r), "type": "note"}
                for r in db.execute("SELECT * FROM p_program_step_notes WHERE program_id=?", (identifier,))
            )
            result["steps"].sort(key=lambda row: row["position"])
            result["version"] = db.execute("SELECT COALESCE(MAX(version),0) FROM p_program_revisions WHERE program_id=?", (identifier,)).fetchone()[0]
            students = self.student_ids(actor, db)
            result["assignments"] = [
                unpack(r)
                for r in db.execute(
                    "SELECT * FROM p_program_assignments WHERE program_id=?",
                    (identifier,),
                )
                if r["student_id"] in students
            ]
            if actor.role == "student":
                result = student_program(result)
        if collection == "exercises":
            result["resources"] = []
            for r in db.execute(
                "SELECT pr.*,rd.detail AS resource_detail FROM p_resources pr LEFT JOIN p_resource_details rd ON rd.resource_id=pr.id WHERE pr.exercise_id=?", (identifier,)
            ):
                resource = dict(r)
                resource["detail"] = json.loads(resource.pop("resource_detail") or "{}")
                if actor.role != "student" or resource["detail"].get("visibility", "student") == "student":
                    result["resources"].append(resource)
            result["media"] = []
            for r in db.execute(
                "SELECT m.* FROM p_media m JOIN p_exercise_media e ON e.media_id=m.id WHERE e.exercise_id=?",
                (identifier,),
            ):
                if actor.role == "student":
                    try:
                        self.get(actor, "media", r["id"], db)
                    except Refused:
                        continue
                result["media"].append({k: v for k, v in unpack(r).items() if k != "path"})
            result["equipment"] = [
                dict(r)
                for r in db.execute(
                    "SELECT ee.*, e.name FROM p_exercise_equipment ee JOIN p_equipment e ON e.id=ee.equipment_id WHERE ee.exercise_id=?",
                    (identifier,),
                )
            ]
        if collection == "scans":
            result["findings"] = [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM p_scan_findings WHERE scan_id=? ORDER BY created_at,rowid", (identifier,)
                )
            ]
        if collection == "locations":
            result["rooms"] = [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM p_rooms WHERE location_id=?", (identifier,)
                )
            ]
        result.pop("path", None)
        return result

    def people(self, actor, role="student", historical_id=None):
        with self.db() as db:
            if historical_id and actor.role == "admin" and role == "student":
                self.assert_student(actor, historical_id, db=db)
                ids = [historical_id]
            elif role == "student":
                ids = self.student_ids(actor, db)
            elif actor.role == "admin":
                ids = [
                    r[0]
                    for r in db.execute(
                        "SELECT u.id FROM p_users u JOIN p_roles r ON r.user_id=u.id WHERE u.org_id=? AND r.role=?",
                        (actor.org_id, role),
                    )
                ]
            elif role == "coach":
                ids = (
                    [actor.user_id]
                    if actor.role == "coach"
                    else [
                        r[0]
                        for r in db.execute(
                            "SELECT coach_id FROM p_coach_students WHERE student_id=?",
                            (actor.user_id,),
                        )
                    ]
                )
            else:
                raise Refused("Only administrators can inspect users.", 403)
            result = []
            for identifier in ids:
                u = unpack(
                    db.execute(
                        "SELECT * FROM p_users WHERE id=?", (identifier,)
                    ).fetchone()
                )
                u["roles"] = [
                    r[0]
                    for r in db.execute(
                        "SELECT role FROM p_roles WHERE user_id=?", (identifier,)
                    )
                ]
                profile = db.execute(
                    "SELECT * FROM "
                    + ("p_students" if role == "student" else "p_coaches")
                    + " WHERE id=?",
                    (identifier,),
                ).fetchone()
                if profile:
                    u.update(dict(profile))
                table, col = (
                    ("p_student_locations", "student_id")
                    if role == "student"
                    else ("p_coach_locations", "coach_id")
                )
                u["location_ids"] = [
                    r[0]
                    for r in db.execute(
                        f"SELECT location_id FROM {table} WHERE {col}=?", (identifier,)
                    )
                ]
                if role == "student":
                    u["latest_session"] = unpack(
                        db.execute(
                            "SELECT id,performed_at,completed,program_id FROM p_training_sessions WHERE student_id=? ORDER BY performed_at DESC LIMIT 1",
                            (identifier,),
                        ).fetchone()
                    )
                    u["session_count"] = db.execute(
                        "SELECT count(*) FROM p_training_sessions WHERE student_id=?",
                        (identifier,),
                    ).fetchone()[0]
                    u["last_session_steps"] = None
                    last_session = u["latest_session"]
                    if last_session and last_session.get("program_id"):
                        revision = db.execute(
                            "SELECT r.snapshot FROM p_training_session_program_versions sv "
                            "JOIN p_program_revisions r ON r.program_id=sv.program_id AND r.version=sv.version "
                            "WHERE sv.session_id=?",
                            (last_session["id"],),
                        ).fetchone()
                        if revision:
                            snapshot = json.loads(revision[0])
                            phase = (snapshot.get("detail") or {}).get("phase")
                            u["last_session_steps"] = sum(
                                bool(step.get("exercise_id")) and
                                (not (step.get("detail") or {}).get("program_phase") or
                                 (step.get("detail") or {}).get("program_phase") == phase)
                                for step in snapshot.get("steps", [])
                            )
                    u["coach_ids"] = [
                        r[0]
                        for r in db.execute(
                            "SELECT coach_id FROM p_coach_students WHERE student_id=?",
                            (identifier,),
                        )
                    ]
                    u["latest_analysis"] = unpack(
                        db.execute(
                            "SELECT id,created_at,kind,status,detail FROM p_analyses WHERE student_id=? ORDER BY created_at DESC LIMIT 1",
                            (identifier,),
                        ).fetchone()
                    )
                    u["next_reservation"] = unpack(
                        db.execute(
                            "SELECT * FROM p_reservations WHERE student_id=? AND starts_at>=? AND status='reserved' ORDER BY starts_at LIMIT 1",
                            (identifier, now()),
                        ).fetchone()
                    )
                    u["programs"] = [
                        dict(r)
                        for r in db.execute(
                            "SELECT a.*,p.name,p.region_id FROM p_program_assignments a JOIN p_programs p ON p.id=a.program_id WHERE a.student_id=? AND a.active=1",
                            (identifier,),
                        )
                    ]
                result.append(u)
            return result

    def bootstrap(self, actor):
        with self.db() as db:
            org = dict(
                db.execute(
                    "SELECT * FROM p_organizations WHERE id=?", (actor.org_id,)
                ).fetchone()
            )
            user = unpack(
                db.execute(
                    "SELECT * FROM p_users WHERE id=?", (actor.user_id,)
                ).fetchone()
            )
            user["roles"] = [
                r[0]
                for r in db.execute(
                    "SELECT role FROM p_roles WHERE user_id=?", (actor.user_id,)
                )
            ]
            regions = [unpack(r) for r in db.execute("SELECT * FROM p_regions")]
        return {
            "user": user,
            "role": actor.role,
            "organization": org,
            "students": self.people(actor),
            "coaches": self.people(actor, "coach"),
            "locations": self.list(actor, "locations")["items"],
            "regions": regions,
            "storage": {
                "ephemeral": bool(os.environ.get("RENDER"))
                and not Path(self.path).resolve().is_relative_to(Path("/var/data")),
                "backup_available": actor.role == "admin",
            },
        }

    def client(self, actor, identifier):
        self.assert_student(actor, identifier)
        client = next(
            (
                c
                for c in self.people(actor, historical_id=identifier)
                if c["id"] == identifier
            ),
            None,
        )
        if client is None:
            raise Refused(
                "This client profile is no longer active in your workspace.", 404
            )
        with self.db() as db:
            client["sessions"] = [
                unpack(r)
                for r in db.execute(
                    "SELECT ts.*,pv.version AS program_version FROM p_training_sessions ts LEFT JOIN p_training_session_program_versions pv ON pv.session_id=ts.id WHERE ts.student_id=? ORDER BY ts.performed_at DESC",
                    (identifier,),
                )
            ]
            for session in client["sessions"]:
                session["analysis_ids"] = list(dict.fromkeys(
                    [session["analysis_id"]] if session["analysis_id"] else []
                ))
            by_session = {session["id"]: session for session in client["sessions"]}
            for session in client["sessions"]:
                session["exercise_events"] = []
            for event in db.execute(
                "SELECT e.* FROM p_session_exercise_events e "
                "JOIN p_training_sessions ts ON ts.id=e.session_id "
                "WHERE ts.student_id=? ORDER BY ts.performed_at,e.sequence",
                (identifier,),
            ):
                session = by_session.get(event["session_id"])
                if session:
                    session["exercise_events"].append(dict(event))
            for recorder in db.execute(
                "SELECT sr.* FROM p_session_recorders sr "
                "JOIN p_training_sessions ts ON ts.id=sr.session_id WHERE ts.student_id=?",
                (identifier,),
            ):
                session = by_session.get(recorder["session_id"])
                if session:
                    session["recorded_by"] = dict(recorder)
            for link in db.execute(
                "SELECT sa.session_id,sa.analysis_id FROM p_session_analyses sa "
                "JOIN p_training_sessions ts ON ts.id=sa.session_id WHERE ts.student_id=?",
                (identifier,),
            ):
                session = by_session.get(link["session_id"])
                if session and link["analysis_id"] not in session["analysis_ids"]:
                    session["analysis_ids"].append(link["analysis_id"])
            client["program_history"] = [
                dict(r)
                for r in db.execute(
                    "SELECT a.*,p.name,p.region_id FROM p_program_assignments a "
                    "JOIN p_programs p ON p.id=a.program_id WHERE a.student_id=? "
                    "ORDER BY a.starts_on DESC,a.rowid DESC",
                    (identifier,),
                )
            ]
            client["visit_program_ids"] = []
            for linked in db.execute(
                "SELECT DISTINCT r.program_id FROM p_program_revision_visits rv "
                "JOIN p_program_revisions r ON r.id=rv.revision_id "
                "JOIN p_training_sessions ts ON ts.id=rv.session_id "
                "JOIN p_programs p ON p.id=r.program_id "
                "WHERE ts.student_id=? AND p.org_id=? ORDER BY r.program_id",
                (identifier, actor.org_id),
            ):
                try:
                    self.get(actor, "programs", linked["program_id"], db)
                except Refused as error:
                    if error.status not in (403, 404):
                        raise
                    continue
                client["visit_program_ids"].append(linked["program_id"])
            client["progress"] = [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM p_progress_records WHERE student_id=? ORDER BY recorded_at",
                    (identifier,),
                )
            ]
            # Reconcile the compact progress index with archived source evidence.
            # Older rows remain stored; unsupported/ambiguous values cannot become
            # comparable merely because they have a number in this index.
            from .progress_evidence import progress_evidence, selected_progress_measurements

            progress_sources = {}
            for source in db.execute(
                "SELECT DISTINCT a.id,a.student_id,a.kind,a.protocol,a.status,a.demo,"
                "a.created_at,a.result,a.detail FROM p_analyses a "
                "JOIN p_progress_records pr ON pr.analysis_id=a.id "
                "WHERE pr.student_id=? AND a.student_id=? AND a.org_id=?",
                (identifier, identifier, actor.org_id),
            ):
                source = unpack(source)
                progress_sources[source["id"]] = (
                    source, selected_progress_measurements(source["result"], source["detail"])
                )
            for record in client["progress"]:
                source, measurements = progress_sources.get(record["analysis_id"], (None, {}))
                record["evidence"] = progress_evidence(record, source, measurements)
            client["observations"] = [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM p_observations WHERE student_id=? ORDER BY created_at DESC",
                    (identifier,),
                )
            ]
        for collection in ("analyses", "notes", "scans", "reservations"):
            # This hub feeds comparisons and region links as well as lists. Do
            # not silently discard older sessions at the API's page boundary.
            client[collection] = []
            while True:
                page = self.list(
                    actor,
                    collection,
                    student_id=identifier,
                    offset=len(client[collection]),
                    limit=200,
                )
                client[collection].extend(page["items"])
                if not page["items"] or len(client[collection]) >= page["total"]:
                    break
        # The client hub needs saved markers for the exact visit timeline. Keep
        # the scan-wide order used by get("scans") so marker numbers agree with
        # the image and annotation table. Author names come from saved authors.
        scans_by_id = {scan["id"]: scan for scan in client["scans"]}
        for scan in scans_by_id.values():
            scan["findings"] = []
        with self.db() as db:
            for finding in db.execute(
                "SELECT f.*,u.name AS author_name FROM p_scan_findings f "
                "JOIN p_scans s ON s.id=f.scan_id "
                "LEFT JOIN p_users u ON u.id=f.author_id AND u.org_id=s.org_id "
                "WHERE s.student_id=? AND s.org_id=? "
                "ORDER BY f.scan_id,f.created_at,f.rowid",
                (identifier, actor.org_id),
            ):
                scan = scans_by_id.get(finding["scan_id"])
                if scan is not None:
                    scan["findings"].append(dict(finding))
        return client

    def _linked(self, actor, data, db, student=None):
        if data.get("student_id"):
            self.assert_student(actor, data["student_id"], True, db)
        for field, collection in [
            ("analysis_id", "analyses"),
            ("scan_id", "scans"),
            ("program_id", "programs"),
            ("exercise_id", "exercises"),
            ("location_id", "locations"),
            ("media_id", "media"),
        ]:
            if data.get(field):
                target = self.get(actor, collection, data[field], db)
                if (
                    student
                    and target.get("student_id")
                    and target["student_id"] != student
                ):
                    raise Refused("The linked record belongs to a different client.")
        if (
            data.get("region_id")
            and not db.execute(
                "SELECT 1 FROM p_regions WHERE id=?", (data["region_id"],)
            ).fetchone()
        ):
            raise Refused("Choose an anatomical region.")
        if data.get("coach_id"):
            row = db.execute(
                "SELECT 1 FROM p_coaches c JOIN p_users u ON u.id=c.id JOIN p_roles r ON r.user_id=c.id AND r.role='coach' WHERE c.id=? AND u.org_id=? AND u.active=1",
                (data["coach_id"], actor.org_id),
            ).fetchone()
            if not row:
                raise Refused("Choose a coach in this organization.")
            if actor.role == "coach" and data["coach_id"] != actor.user_id:
                raise Refused("Choose your own coaching profile.", 403)
        if data.get("room_id"):
            row = db.execute(
                "SELECT location_id FROM p_rooms WHERE id=?", (data["room_id"],)
            ).fetchone()
            if not row or row[0] != data.get("location_id"):
                raise Refused("The room must belong to the selected location.")

    @staticmethod
    def _analysis_in_visit(db, session_id, analysis_id):
        return bool(db.execute(
            "SELECT 1 FROM p_training_sessions WHERE id=? AND analysis_id=? "
            "UNION SELECT 1 FROM p_session_analyses WHERE session_id=? AND analysis_id=?",
            (session_id, analysis_id, session_id, analysis_id),
        ).fetchone())

    @staticmethod
    def _analysis_visit_ids(db, analysis_id):
        if not analysis_id:
            return set()
        return {row[0] for row in db.execute(
            "SELECT id FROM p_training_sessions WHERE analysis_id=? "
            "UNION SELECT session_id FROM p_session_analyses WHERE analysis_id=?",
            (analysis_id, analysis_id),
        )}

    def _sources_share_visit(self, db, analysis_id, scan, scan_session_id):
        """Different saved sources must not claim contradictory visits."""
        assessment_visits = self._analysis_visit_ids(db, analysis_id)
        scan_visits = ({scan_session_id} if scan_session_id else
                       self._analysis_visit_ids(db, scan.get("analysis_id")))
        if assessment_visits and scan_visits:
            return bool(assessment_visits & scan_visits)
        # Two different assessments cannot be called the same source before
        # either is assigned to a visit; a source without a visit stays unknown.
        return not scan.get("analysis_id") or scan["analysis_id"] == analysis_id

    def _check_visit_link(self, actor, collection, identifier, record, session_id, db):
        if session_id:
            session = db.execute(
                "SELECT ts.id FROM p_training_sessions ts "
                "JOIN p_users u ON u.id=ts.student_id "
                "WHERE ts.id=? AND ts.student_id=? AND u.org_id=?",
                (session_id, record.get("student_id"), actor.org_id),
            ).fetchone()
            if not session:
                raise Refused("Choose a visit belonging to this client.")
            if record.get("analysis_id") and not self._analysis_in_visit(
                db, session_id, record["analysis_id"]
            ):
                raise Refused("The assessment belongs to a different visit.")
        if collection == "notes" and record.get("scan_id"):
            scan = self.get(actor, "scans", record["scan_id"], db)
            if session_id and scan["session_id"] and scan["session_id"] != session_id:
                raise Refused("The scan belongs to a different visit.")
            if session_id and scan["analysis_id"] and not self._analysis_in_visit(
                db, session_id, scan["analysis_id"]
            ):
                raise Refused("The scan assessment belongs to a different visit.")
            if record.get("analysis_id") and not self._sources_share_visit(
                db, record["analysis_id"], scan, scan["session_id"]
            ):
                raise Refused("The scan and assessment do not share a recorded visit.")
        if collection == "scans":
            # A note explicitly tied to this scan and visit cannot be stranded by
            # moving or clearing the scan's own visit link.
            conflicting = db.execute(
                "SELECT 1 FROM p_notes n JOIN p_session_notes sn ON sn.note_id=n.id "
                "WHERE n.scan_id=? AND sn.session_id IS NOT ? LIMIT 1",
                (identifier, session_id),
            ).fetchone()
            if conflicting:
                raise Refused("Move linked coach notes before changing this scan's visit.")
            # A note without an explicit visit can still name both this scan
            # and an assessment. Moving the scan must preserve that relation.
            for note in db.execute(
                "SELECT analysis_id FROM p_notes WHERE scan_id=? AND analysis_id IS NOT NULL",
                (identifier,),
            ):
                if not self._sources_share_visit(db, note["analysis_id"], record, session_id):
                    raise Refused("A linked coach note assessment would belong to a different visit.")

    @staticmethod
    def _save_visit_link(collection, identifier, session_id, db):
        link_table, key = VISIT_LINKS[collection]
        if session_id:
            db.execute(
                f"INSERT INTO {link_table}({key},session_id) VALUES (?,?) "
                f"ON CONFLICT({key}) DO UPDATE SET session_id=excluded.session_id",
                (identifier, session_id),
            )
        else:
            db.execute(f"DELETE FROM {link_table} WHERE {key}=?", (identifier,))

    def save(self, actor, collection, item):
        if collection not in WRITABLE:
            raise Refused("This record is created by its workflow.", 403)
        if actor.role == "student":
            raise Refused("Ask your coach to change this record.", 403)
        if collection in ("locations", "equipment") and actor.role != "admin":
            raise Refused("Only administrators manage locations and equipment.", 403)
        identifier = str(item.get("id") or uid())
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", identifier):
            raise Refused("Invalid identifier.")
        with self.db() as db:
            old = db.execute(
                f"SELECT id FROM {TABLES[collection]} WHERE id=?", (identifier,)
            ).fetchone()
            existing = self.get(actor, collection, identifier, db) if old else {}
            if (
                actor.role == "coach"
                and collection in ("programs", "exercises")
                and existing
                and existing["owner_id"] != actor.user_id
            ):
                raise Refused("Duplicate this shared content before editing it.", 403)
            fields = {k: item[k] for k in WRITABLE[collection] if k in item}
            session_id = None
            if collection in VISIT_LINKS:
                session_id = item.get("session_id", existing.get("session_id"))
                if session_id is not None and (
                    not isinstance(session_id, str) or len(session_id) > 100
                ):
                    raise Refused("Choose a valid visit.")
                session_id = session_id or None
            if collection == "notes":
                detail = fields.get("detail", existing.get("detail", {}))
                if not isinstance(detail, dict):
                    raise Refused("Enter valid coach feedback details.")
                detail = {**existing.get("detail", {}), **detail}
                observation_id = detail.get("observation_id")
                if observation_id:
                    observation = db.execute(
                        "SELECT student_id,analysis_id,region_id FROM p_observations WHERE id=?",
                        (observation_id,),
                    ).fetchone()
                    if not observation or observation["student_id"] != fields.get("student_id", existing.get("student_id")):
                        raise Refused("Choose a finding belonging to this client.")
                    if fields.get("analysis_id", existing.get("analysis_id")) not in (None, "", observation["analysis_id"]):
                        raise Refused("The selected finding belongs to a different assessment.")
                    if not fields.get("analysis_id"):
                        fields["analysis_id"] = observation["analysis_id"]
                    if not fields.get("region_id"):
                        fields["region_id"] = observation["region_id"]
                detail["source"] = "coach_entered"
                if existing:
                    detail["updated_at"] = now()
                fields["detail"] = detail
            if collection == "programs" and not existing and "detail" not in fields:
                fields["detail"] = {"status": "Draft"}
            if collection == "programs" and "detail" in fields:
                from .designer import program_detail

                fields["detail"] = program_detail(self, actor, fields["detail"], db)
            if collection == "exercises" and "detail" in fields:
                detail = fields["detail"]
                if not isinstance(detail, dict):
                    raise Refused("Enter exercise details.")
                if "target_region_ids" in detail:
                    from .designer import _region_ids

                    detail["target_region_ids"] = _region_ids(db, detail["target_region_ids"])
                if "program_only" in detail:
                    detail["program_only"] = bool(detail["program_only"])
                    if detail["program_only"] and fields.get("visibility", existing.get("visibility", "private")) != "private":
                        raise Refused("Program-only exercises must stay private.")
            for k in list(fields):
                if k.endswith("_id") and fields[k] == "":
                    fields[k] = None
            merged = {**existing, **fields}
            if collection == "programs" and not str(merged.get("name") or "").strip():
                raise Refused("Name the program.")
            self._linked(actor, merged, db, merged.get("student_id"))
            if collection == "notes" and merged.get("program_id"):
                assigned = db.execute(
                    "SELECT 1 FROM p_program_assignments WHERE program_id=? AND student_id=?",
                    (merged["program_id"], merged.get("student_id")),
                ).fetchone()
                if not assigned:
                    raise Refused("Assign the program to this client before linking feedback.")
            if collection in VISIT_LINKS:
                self._check_visit_link(actor, collection, identifier, merged, session_id, db)
            for f in ("name", "text"):
                if f in fields and not str(fields[f]).strip():
                    raise Refused(f"Enter {f}.")
            if collection == "scans":
                media = self.get(actor, "media", merged.get("media_id"), db)
                if (
                    media.get("student_id") != merged.get("student_id")
                    or media["kind"] != "scan"
                ):
                    raise Refused("Upload a scan for this client before linking it.")
            if collection == "reservations":
                self.validate_reservation(actor, merged, identifier, db)
                fields.update(starts_at=merged["starts_at"], ends_at=merged["ends_at"])
            for k, v in fields.items():
                if isinstance(v, (dict, list)):
                    fields[k] = encode(v)
                elif isinstance(v, str) and len(v) > 10000:
                    raise Refused("This text is too long.")
            if len(encode(fields)) > 100_000:
                raise Refused("This record is too large.")
            if old:
                if fields:
                    db.execute(
                        f"UPDATE {TABLES[collection]} SET "
                        + ",".join(k + "=?" for k in fields)
                        + " WHERE id=?",
                        [*fields.values(), identifier],
                    )
            else:
                fields.update(id=identifier, org_id=actor.org_id)
                if collection in ("exercises", "programs"):
                    fields["owner_id"] = actor.user_id
                if collection == "notes":
                    fields.update(author_id=actor.user_id, created_at=now())
                db.execute(
                    f"INSERT INTO {TABLES[collection]} ("
                    + ",".join(fields)
                    + ") VALUES ("
                    + ",".join("?" for _ in fields)
                    + ")",
                    list(fields.values()),
                )
            if collection in VISIT_LINKS:
                self._save_visit_link(collection, identifier, session_id, db)
            if collection == "programs" and "steps" in item:
                self._steps(actor, identifier, item["steps"], db)
            if collection == "programs":
                from .designer import record_revision

                record_revision(self, actor, identifier, item, db)
            if collection == "exercises":
                self._exercise_links(actor, identifier, item, db)
            if collection == "locations" and "rooms" in item:
                # Preserve existing room IDs referenced by reservations.
                for room in item["rooms"]:
                    rid = room.get("id") or uid()
                    old_room = db.execute(
                        "SELECT location_id FROM p_rooms WHERE id=?", (rid,)
                    ).fetchone()
                    if old_room and old_room[0] != identifier:
                        raise Refused("The room belongs to another location.")
                    db.execute(
                        "INSERT INTO p_rooms VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,capacity=excluded.capacity",
                        (rid, identifier, room["name"], int(room["capacity"])),
                    )
            self.audit(db, actor, "save:" + collection, identifier)
        return self.get(actor, collection, identifier)

    def _steps(self, actor, program, steps, db):
        if not isinstance(steps, list) or len(steps) > 200:
            raise Refused("A program supports up to 200 sequence steps.")
        program_row = db.execute("SELECT detail,location_id FROM p_programs WHERE id=?", (program,)).fetchone()
        program_detail = unpack(program_row)["detail"]
        assigned = [r[0] for r in db.execute("SELECT DISTINCT student_id FROM p_program_assignments WHERE program_id=?", (program,))]
        student_id = program_detail.get("student_id") or (assigned[0] if len(assigned) == 1 else None)
        db.execute("DELETE FROM p_program_exercises WHERE program_id=?", (program,))
        db.execute("DELETE FROM p_program_step_notes WHERE program_id=?", (program,))
        for position, step in enumerate(steps):
            if not isinstance(step, dict):
                raise Refused("Enter a valid program step.")
            if step.get("type") == "note":
                text = str(step.get("text") or "").strip()
                if not text or len(text) > 3000 or step.get("visibility", "student") not in ("student", "coach"):
                    raise Refused("Enter a note and choose who can see it.")
                db.execute("INSERT INTO p_program_step_notes VALUES (?,?,?,?,?,?,?)", (uid(), program, position, str(step.get("phase", "Practice"))[:80], str(step.get("section", ""))[:80], text, step.get("visibility", "student")))
                continue
            self.get(actor, "exercises", step["exercise_id"], db)
            from .designer import step_detail

            extra = step_detail(self, actor, step["exercise_id"], step.get("detail"), db, student_id, program_location_id=program_row["location_id"])
            values = [
                int(step.get(k, d))
                for k, d in [("sets", 1), ("reps", 8), ("seconds", 60), ("rest", 20)]
            ]
            if any(v < 0 or v > 7200 for v in values) or values[0] < 1:
                raise Refused("Enter valid sets, repetitions and durations.")
            step_id = uid()
            db.execute(
                "INSERT INTO p_program_exercises VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    step_id,
                    program,
                    step["exercise_id"],
                    position,
                    str(step.get("phase", "Practice"))[:40],
                    *values,
                    str(step.get("notes", ""))[:3000],
                ),
            )
            if extra:
                db.execute("INSERT INTO p_program_step_details VALUES (?,?)", (step_id, encode(extra)))

    def _exercise_links(self, actor, exercise, item, db):
        if "resources" in item:
            if len(item["resources"]) > 30:
                raise Refused("Use at most 30 resources per exercise.")
            db.execute("DELETE FROM p_resources WHERE exercise_id=?", (exercise,))
            for r in item["resources"]:
                if not isinstance(r, dict) or not re.match(r"^https?://[^\s]+$", str(r.get("url", ""))):
                    raise Refused("Resources need an http or https URL.")
                from .designer import REFERENCE_TYPES

                detail = dict(r.get("detail") or {})
                for key in ("type", "description", "visibility"):
                    if key in r:
                        detail[key] = r[key]
                if detail.get("type", "other") not in REFERENCE_TYPES or detail.get("visibility", "student") not in ("student", "coach"):
                    raise Refused("Choose a valid reference type and audience.")
                detail["description"] = str(detail.get("description") or "")[:1000]
                resource_id = uid()
                db.execute(
                    "INSERT INTO p_resources VALUES (?,?,?,?)",
                    (
                        resource_id,
                        exercise,
                        str(r.get("title") or "Resource")[:150],
                        r["url"],
                    ),
                )
                db.execute("INSERT INTO p_resource_details VALUES (?,?)", (resource_id, encode(detail)))
        if "equipment" in item:
            db.execute(
                "DELETE FROM p_exercise_equipment WHERE exercise_id=?", (exercise,)
            )
            for e in item["equipment"]:
                self.get(actor, "equipment", e["equipment_id"], db)
                db.execute(
                    "INSERT INTO p_exercise_equipment VALUES (?,?,?)",
                    (exercise, e["equipment_id"], int(e.get("quantity", 1))),
                )

    def validate_reservation(self, actor, item, identifier, db):
        try:
            start, end = datetime.fromisoformat(
                item["starts_at"]
            ), datetime.fromisoformat(item["ends_at"])
            if end <= start:
                raise ValueError()
        except (KeyError, ValueError):
            raise Refused("The end time must be after the start time.")
        if start.tzinfo is None or end.tzinfo is None:
            raise Refused("Include a timezone in reservation times.")
        item["starts_at"] = start.astimezone(timezone.utc).isoformat()
        item["ends_at"] = end.astimezone(timezone.utc).isoformat()
        if item.get("status") not in ("reserved", "attended", "cancelled", "missed"):
            raise Refused("Choose a reservation status.")
        if not item.get("location_id") or not item.get("coach_id"):
            raise Refused("Select a location and a coach.")
        if not db.execute(
            "SELECT 1 FROM p_coach_students WHERE coach_id=? AND student_id=?",
            (item["coach_id"], item["student_id"]),
        ).fetchone():
            raise Refused("Assign this coach to the client before reserving.")
        for table, col, value in [
            ("p_coach_locations", "coach_id", item["coach_id"]),
            ("p_student_locations", "student_id", item["student_id"]),
        ]:
            if not db.execute(
                f"SELECT 1 FROM {table} WHERE {col}=? AND location_id=?",
                (value, item["location_id"]),
            ).fetchone():
                raise Refused("Coach and client must be assigned to this location.")
        if item.get("status") in ("cancelled", "missed"):
            return
        overlaps = db.execute(
            "SELECT * FROM p_reservations WHERE org_id=? AND id<>? AND status IN ('reserved','attended') AND starts_at<? AND ends_at>?",
            (actor.org_id, identifier, item["ends_at"], item["starts_at"]),
        ).fetchall()
        if any(
            r["student_id"] == item["student_id"] or r["coach_id"] == item["coach_id"]
            for r in overlaps
        ):
            raise Refused(
                "This client or coach already has a reservation at that time.", 409
            )
        if item.get("room_id"):
            capacity = db.execute(
                "SELECT capacity FROM p_rooms WHERE id=?", (item["room_id"],)
            ).fetchone()[0]
            if sum(r["room_id"] == item["room_id"] for r in overlaps) >= capacity:
                raise Refused("The room is at capacity.", 409)
        capacity = db.execute(
            "SELECT capacity FROM p_locations WHERE id=?", (item["location_id"],)
        ).fetchone()[0]
        if sum(r["location_id"] == item["location_id"] for r in overlaps) >= capacity:
            raise Refused("The location is at capacity.", 409)
        required = self.program_equipment(db, item.get("program_id"))
        for name, quantity in required.items():
            available = db.execute(
                "SELECT COALESCE(SUM(available),0) FROM p_equipment WHERE org_id=? AND location_id=? AND lower(name)=?",
                (actor.org_id, item["location_id"], name),
            ).fetchone()[0]
            reserved = sum(
                self.program_equipment(db, r["program_id"]).get(name, 0)
                for r in overlaps
                if r["location_id"] == item["location_id"]
            )
            if quantity + reserved > available:
                raise Refused(
                    f"Not enough {name} at this location for that time: {max(0,available-reserved)} available, {quantity} required.",
                    409,
                )

    @staticmethod
    def program_equipment(db, program_id):
        # Steps run sequentially, so reserve the largest simultaneous requirement
        # for each equipment type, not one unit for every occurrence in a program.
        return {
            r["name"]: r["quantity"]
            for r in db.execute(
                """
            SELECT name, MAX(quantity) AS quantity FROM (
                SELECT lower(e.name) AS name, ee.quantity AS quantity
                FROM p_program_exercises pe
                LEFT JOIN p_program_step_details sd ON sd.step_id=pe.id
                JOIN p_exercise_equipment ee ON ee.exercise_id=pe.exercise_id
                JOIN p_equipment e ON e.id=ee.equipment_id
                WHERE pe.program_id=? AND json_type(sd.detail,'$.equipment') IS NULL
                UNION ALL
                SELECT lower(e.name) AS name,
                       CAST(json_extract(j.value,'$.quantity') AS INTEGER) AS quantity
                FROM p_program_exercises pe
                JOIN p_program_step_details sd ON sd.step_id=pe.id
                JOIN json_each(sd.detail,'$.equipment') j
                JOIN p_equipment e ON e.id=json_extract(j.value,'$.equipment_id')
                WHERE pe.program_id=?
            ) GROUP BY name
            """,
                (program_id, program_id),
            )
        }

    @staticmethod
    def audit(db, actor, action, subject, detail=None):
        db.execute(
            "INSERT INTO p_audit(org_id,actor_id,action,subject_id,created_at,detail) VALUES (?,?,?,?,?,?)",
            (actor.org_id, actor.user_id, action, subject, now(), encode(detail or {})),
        )

    def save_person(self, actor, item):
        if actor.role == "student":
            raise Refused("Only coaches or administrators manage clients.", 403)
        identifier = item.get("id") or uid()
        roles = item.get("roles", ["student"])
        if not roles or any(r not in ("admin", "coach", "student") for r in roles):
            raise Refused("Choose at least one valid role.")
        if actor.role != "admin" and roles != ["student"]:
            raise Refused("Only administrators can assign roles.", 403)
        with self.db() as db:
            old = db.execute(
                "SELECT * FROM p_users WHERE id=?", (identifier,)
            ).fetchone()
            if old and old["org_id"] != actor.org_id:
                raise Refused("This account belongs to another organization.", 403)
            if old and actor.role == "coach":
                self.assert_student(actor, identifier, True, db)
                assigned_roles = [
                    r[0]
                    for r in db.execute(
                        "SELECT role FROM p_roles WHERE user_id=?", (identifier,)
                    )
                ]
                if assigned_roles != ["student"]:
                    raise Refused(
                        "Only an administrator can edit an account with staff roles.",
                        403,
                    )

            name = str(item.get("name", "")).strip()[:100]
            email = (
                str(item.get("email") or (identifier + "@example.invalid"))
                .lower()
                .strip()[:254]
            )
            if not name:
                raise Refused("Enter a name.")
            if (
                old
                and identifier == actor.user_id
                and "admin" not in roles
                and actor.role == "admin"
            ):
                admins = db.execute(
                    "SELECT count(*) FROM p_roles r JOIN p_users u ON u.id=r.user_id WHERE u.org_id=? AND r.role='admin'",
                    (actor.org_id,),
                ).fetchone()[0]
                if admins <= 1:
                    raise Refused(
                        "Keep at least one administrator in the organization."
                    )
            hashed = (
                password_hash(item["password"])
                if item.get("password")
                else (old["password_hash"] if old else "")
            )
            if not actor.demo:
                duplicate = db.execute(
                    "SELECT u.id FROM p_users u JOIN p_organizations o ON o.id=u.org_id WHERE u.email=? AND o.demo=0 AND u.id<>?",
                    (email, identifier),
                ).fetchone()
                if duplicate:
                    raise Refused("Another account already uses this email.")
            db.execute(
                "INSERT INTO p_users(id,org_id,name,email,password_hash,avatar,detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,password_hash=excluded.password_hash,avatar=excluded.avatar,detail=excluded.detail",
                (
                    identifier,
                    actor.org_id,
                    name,
                    email,
                    hashed,
                    str(item.get("avatar", old["avatar"] if old else "")),
                    encode(
                        item.get("detail", json.loads(old["detail"]) if old else {})
                    ),
                ),
            )
            db.execute("DELETE FROM p_roles WHERE user_id=?", (identifier,))
            db.executemany(
                "INSERT INTO p_roles VALUES (?,?)", [(identifier, r) for r in roles]
            )
            if "student" in roles:
                db.execute(
                    "INSERT INTO p_students(id,born,goal,height_cm,weight_kg) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET born=excluded.born,goal=excluded.goal,height_cm=excluded.height_cm,weight_kg=excluded.weight_kg",
                    (
                        identifier,
                        item.get("born", ""),
                        item.get("goal", ""),
                        item.get("height_cm") or None,
                        item.get("weight_kg") or None,
                    ),
                )
            # Historical student records stay connected during a role conversion.
            # Remove active assignments/reservations, not the person's historical evidence.
            else:
                db.execute(
                    "DELETE FROM p_coach_students WHERE student_id=?", (identifier,)
                )
                db.execute(
                    "UPDATE p_reservations SET status='cancelled' WHERE student_id=? AND status='reserved'",
                    (identifier,),
                )
            if "coach" in roles:
                db.execute(
                    "INSERT OR IGNORE INTO p_coaches(id) VALUES (?)", (identifier,)
                )
            else:
                db.execute(
                    "DELETE FROM p_coach_students WHERE coach_id=?", (identifier,)
                )
                db.execute(
                    "DELETE FROM p_coach_locations WHERE coach_id=?", (identifier,)
                )
                db.execute(
                    "UPDATE p_reservations SET status='cancelled' WHERE coach_id=? AND status='reserved'",
                    (identifier,),
                )
            for role, table, col in [
                ("student", "p_student_locations", "student_id"),
                ("coach", "p_coach_locations", "coach_id"),
            ]:
                if role in roles and "location_ids" in item:
                    db.execute(f"DELETE FROM {table} WHERE {col}=?", (identifier,))
                    for loc in item["location_ids"]:
                        self.get(actor, "locations", loc, db)
                        db.execute(
                            f"INSERT INTO {table} VALUES (?,?)", (identifier, loc)
                        )
            if "student" in roles:
                if actor.role == "coach":
                    db.execute(
                        "INSERT OR IGNORE INTO p_coach_students VALUES (?,?)",
                        (actor.user_id, identifier),
                    )
                elif "coach_ids" in item:
                    db.execute(
                        "DELETE FROM p_coach_students WHERE student_id=?", (identifier,)
                    )
                    for coach in item["coach_ids"]:
                        self._linked(actor, {"coach_id": coach}, db)
                        if not db.execute(
                            "SELECT 1 FROM p_roles WHERE user_id=? AND role='coach'",
                            (coach,),
                        ).fetchone():
                            raise Refused("This user no longer has a coach role.")
                        db.execute(
                            "INSERT INTO p_coach_students VALUES (?,?)",
                            (coach, identifier),
                        )
            # Changing a location or coach assignment invalidates future bookings
            # that relied on that relationship, while retaining their history.
            db.execute(
                """UPDATE p_reservations SET status='cancelled'
                WHERE org_id=? AND status='reserved' AND starts_at>=?
                AND (student_id=? OR coach_id=?) AND (
                  NOT EXISTS (SELECT 1 FROM p_coach_students cs WHERE cs.coach_id=p_reservations.coach_id AND cs.student_id=p_reservations.student_id)
                  OR NOT EXISTS (SELECT 1 FROM p_student_locations sl WHERE sl.student_id=p_reservations.student_id AND sl.location_id=p_reservations.location_id)
                  OR NOT EXISTS (SELECT 1 FROM p_coach_locations cl WHERE cl.coach_id=p_reservations.coach_id AND cl.location_id=p_reservations.location_id))""",
                (actor.org_id, now(), identifier, identifier),
            )
            self.audit(db, actor, "save:user", identifier, {"roles": roles})
        return {"id": identifier}

    def delete(self, actor, collection, identifier):
        if actor.role == "student":
            raise Refused("Only staff can remove records.", 403)
        with self.db() as db:
            if collection == "users":
                if actor.role != "admin":
                    raise Refused(
                        "Only administrators can delete clients and coaches.", 403
                    )
                row = db.execute(
                    "SELECT id FROM p_users WHERE id=? AND org_id=?",
                    (identifier, actor.org_id),
                ).fetchone()
                if not row:
                    raise Refused("Account not found.", 404)
                if identifier == actor.user_id:
                    raise Refused(
                        "Use another administrator to remove your own account."
                    )
                paths = [
                    r[0]
                    for r in db.execute(
                        "SELECT path FROM p_media WHERE student_id=?", (identifier,)
                    )
                ]
                db.execute("DELETE FROM p_users WHERE id=?", (identifier,))
                # Shared content authorship survives via nullable owner FKs.
            else:
                if collection not in WRITABLE and collection not in ("media",):
                    raise Refused("This record cannot be deleted here.")
                row = self.get(actor, collection, identifier, db)
                if actor.role != "admin" and (
                    collection in ("locations", "equipment")
                    or collection in ("exercises", "programs", "media")
                    and row.get("owner_id") != actor.user_id
                ):
                    raise Refused(
                        "Only the content owner or administrator can remove this record.",
                        403,
                    )
                if collection == "locations":
                    db.execute(
                        "UPDATE p_reservations SET status='cancelled' WHERE location_id=? AND status='reserved'",
                        (identifier,),
                    )
                if collection == "equipment" and (
                    db.execute(
                        "SELECT 1 FROM p_exercise_equipment WHERE equipment_id=?",
                        (identifier,),
                    ).fetchone()
                    or db.execute(
                        "SELECT 1 FROM p_program_step_details sd, json_each(sd.detail,'$.equipment') j "
                        "WHERE json_extract(j.value,'$.equipment_id')=? LIMIT 1",
                        (identifier,),
                    ).fetchone()
                    or db.execute(
                        "SELECT 1 FROM p_program_revisions WHERE instr(snapshot,?)>0 LIMIT 1",
                        (identifier,),
                    ).fetchone()
                ):
                    raise Refused(
                        "Update exercises that require this equipment before deleting it. Current or historical programs may also reference it; set availability to zero to mark it out of service.",
                        409,
                    )
                if (
                    collection == "exercises"
                    and db.execute(
                        "SELECT 1 FROM p_program_exercises WHERE exercise_id=?",
                        (identifier,),
                    ).fetchone()
                ):
                    raise Refused(
                        "Remove this exercise from its programs before deleting it.",
                        409,
                    )
                if collection == "programs" and (
                    db.execute("SELECT 1 FROM p_program_assignments WHERE program_id=?", (identifier,)).fetchone()
                    or db.execute("SELECT 1 FROM p_training_sessions WHERE program_id=?", (identifier,)).fetchone()
                    or db.execute("SELECT 1 FROM p_program_revisions WHERE program_id=? AND version>1", (identifier,)).fetchone()
                ):
                    raise Refused("Archive an assigned or edited program to preserve its history.", 409)
                if collection == "media" and db.execute("SELECT 1 FROM p_program_revisions WHERE instr(snapshot,?)>0 LIMIT 1", (identifier,)).fetchone():
                    raise Refused("This media belongs to a historical program version. Archive the plan instead.", 409)
                if collection == "exercises" and db.execute("SELECT 1 FROM p_program_revisions WHERE instr(snapshot,?)>0 LIMIT 1", (identifier,)).fetchone():
                    raise Refused("This exercise belongs to a historical program version.", 409)
                paths = (
                    [
                        r[0]
                        for r in db.execute(
                            "SELECT path FROM p_media WHERE id=? OR exercise_id=?",
                            (identifier, identifier),
                        )
                    ]
                    if collection in ("media", "exercises")
                    else []
                )
                db.execute(
                    f"DELETE FROM {TABLES[collection]} WHERE id=?", (identifier,)
                )
            self.audit(db, actor, "delete:" + collection, identifier)
        for path in paths:
            target = Path(path).resolve()
            if target.is_relative_to(self.media_root.resolve()):
                target.unlink(missing_ok=True)
        return {"deleted": identifier}

    def assign_program(self, actor, item):
        if actor.role == "student":
            raise Refused("Your coach assigns programs.", 403)
        with self.db() as db:
            self.assert_student(actor, item["student_id"], True, db)
            program = self.get(actor, "programs", item["program_id"], db)
            if program["detail"].get("student_id") and program["detail"]["student_id"] != item["student_id"]:
                raise Refused("This client-specific plan belongs to another client.", 403)
            from .designer import _source

            for step in program["steps"]:
                source = step.get("detail", {}).get("source")
                if source:
                    _source(self, actor, source, db, item["student_id"])
                for medium in step.get("detail", {}).get("media", []):
                    linked = self.get(actor, "media", medium.get("media_id"), db)
                    if linked["kind"] == "capture" and linked.get("student_id") != item["student_id"]:
                        raise Refused("A client capture belongs to another client.")
            self._linked(actor, item, db, item["student_id"])
            if item.get("replace", True):
                db.execute(
                    "UPDATE p_program_assignments SET active=0 WHERE student_id=?",
                    (item["student_id"],),
                )
            identifier = uid()
            db.execute(
                "INSERT INTO p_program_assignments VALUES (?,?,?,?,?,?,?)",
                (
                    identifier,
                    item["program_id"],
                    item["student_id"],
                    item.get("analysis_id") or None,
                    item.get("starts_on") or now()[:10],
                    1,
                    str(item.get("notes", ""))[:3000],
                ),
            )
            self.audit(db, actor, "assign:program", identifier)
        return {"id": identifier}

    def retire_program(self, actor, item):
        """End one client's assignment while keeping the program and its history."""
        if actor.role == "student":
            raise Refused("Your coach completes programs.", 403)
        student_id = item.get("student_id")
        program_id = item.get("program_id")
        reason = str(item.get("reason") or "Program completed by coach").strip()[:2000]
        with self.db() as db:
            self.assert_student(actor, student_id, True, db)
            self.get(actor, "programs", program_id, db)
            assignment = db.execute(
                "SELECT id,notes FROM p_program_assignments WHERE student_id=? AND program_id=? "
                "AND active=1 ORDER BY rowid DESC LIMIT 1",
                (student_id, program_id),
            ).fetchone()
            if not assignment:
                raise Refused("This client has no active assignment for the program.")
            history_note = (str(assignment["notes"] or "").strip() +
                            "\nCompleted: " + reason).strip()[:3000]
            db.execute(
                "UPDATE p_program_assignments SET active=0,notes=? WHERE id=?",
                (history_note, assignment["id"]),
            )
            self.audit(db, actor, "retire:program", assignment[0])
        return {"id": assignment[0], "active": False, "reason": reason}

    def complete_session(self, actor, item):
        with self.db() as db:
            self.assert_student(actor, item["student_id"], True, db)
            completed = item.get("completed", [])
            if not isinstance(completed, list) or len(completed) > 200 or any(
                not isinstance(value, str) or not value for value in completed
            ):
                raise Refused("Choose valid completed movements.")
            if item.get("program_id"):
                program = self.get(actor, "programs", item["program_id"], db)
                if program.get("detail", {}).get("status") == "Completed":
                    raise Refused("This program is completed. Ask the coach for a new active plan.")
                if not db.execute(
                    "SELECT 1 FROM p_program_assignments WHERE student_id=? AND program_id=? AND active=1",
                    (item["student_id"], item["program_id"]),
                ).fetchone():
                    raise Refused(
                        "Assign this program to the client before recording a session."
                    )
                allowed = {
                    value for step in program["steps"] if step.get("exercise_id")
                    for value in (step["exercise_id"], step["id"])
                }
                if any(x not in allowed for x in completed):
                    raise Refused("Completed movements must belong to the program.")

            reservation_id = item.get("reservation_id") or None
            analysis_id = item.get("analysis_id") or None
            if reservation_id:
                reservation = self.get(actor, "reservations", reservation_id, db)
                if reservation["student_id"] != item["student_id"]:
                    raise Refused("The reservation belongs to another client.")
            if analysis_id:
                analysis = self.get(actor, "analyses", analysis_id, db)
                if analysis["student_id"] != item["student_id"]:
                    raise Refused("The assessment belongs to another client.")
                if reservation_id and analysis["location_id"] and analysis["location_id"] != reservation["location_id"]:
                    raise Refused("The assessment and reservation have different locations.")
                recorded_reservation = analysis.get("detail", {}).get("reservation_id")
                if reservation_id and recorded_reservation and recorded_reservation != reservation_id:
                    raise Refused("The assessment belongs to another reservation.")
            by_analysis = db.execute(
                "SELECT ts.* FROM p_training_sessions ts LEFT JOIN p_session_analyses sa ON sa.session_id=ts.id "
                "WHERE ts.student_id=? AND (ts.analysis_id=? OR sa.analysis_id=?) LIMIT 1",
                (item["student_id"], analysis_id, analysis_id),
            ).fetchone() if analysis_id else None
            by_reservation = db.execute(
                "SELECT * FROM p_training_sessions WHERE student_id=? AND reservation_id=? ORDER BY performed_at DESC LIMIT 1",
                (item["student_id"], reservation_id),
            ).fetchone() if reservation_id else None
            if by_analysis and by_reservation and by_analysis["id"] != by_reservation["id"]:
                raise Refused("This assessment is already linked to another visit. Open that visit or choose its reservation.")
            linked = by_analysis or by_reservation
            if linked and linked["program_id"] and item.get("program_id") and linked["program_id"] != item["program_id"]:
                raise Refused("This visit is already linked to another program.")
            submitted_events = item.get("completed_events")
            if submitted_events is not None and (
                not isinstance(submitted_events, list) or len(submitted_events) != len(completed)
            ):
                raise Refused("Movement event order must match completed movements.")
            event_times = []
            for index, key in enumerate(completed):
                entry = submitted_events[index] if submitted_events is not None else None
                if entry is not None and (not isinstance(entry, dict) or entry.get("key") != key):
                    raise Refused("Movement event order must match completed movements.")
                value = entry.get("completed_at") if entry is not None else None
                if value in (None, ""):
                    event_times.append(None)
                    continue
                if not isinstance(value, str):
                    raise Refused("Choose a valid movement completion time.")
                try:
                    marked = datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise Refused("Choose a valid movement completion time.") from exc
                if marked.tzinfo is None or marked > datetime.now(timezone.utc) + timedelta(minutes=5):
                    raise Refused("Choose a valid movement completion time.")
                event_times.append(marked.astimezone(timezone.utc).isoformat())
            if linked:
                identifier = linked["id"]
                db.execute(
                    "UPDATE p_training_sessions SET reservation_id=?,program_id=?,analysis_id=?,completed=?,notes=? WHERE id=?",
                    (
                        reservation_id or linked["reservation_id"],
                        item.get("program_id") or linked["program_id"],
                        linked["analysis_id"] or analysis_id,
                        encode(completed),
                        str(item.get("notes") or linked["notes"] or "")[:3000],
                        identifier,
                    ),
                )
            else:
                identifier = uid()
                db.execute(
                    "INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
                    (
                        identifier, item["student_id"], reservation_id,
                        item.get("program_id") or None, analysis_id,
                        now(), encode(completed), str(item.get("notes", ""))[:3000],
                    ),
                )
            previous_events = db.execute(
                "SELECT * FROM p_session_exercise_events WHERE session_id=? ORDER BY sequence",
                (identifier,),
            ).fetchall()
            existing_by_key = {}
            for event in previous_events:
                existing_by_key.setdefault(event["completed_key"], []).append(event)
            db.execute("DELETE FROM p_session_exercise_events WHERE session_id=?", (identifier,))
            logged_at = now()
            for sequence, (key, completed_at) in enumerate(zip(completed, event_times), 1):
                pool = existing_by_key.get(key, [])
                old = pool.pop(0) if pool else None
                db.execute(
                    "INSERT INTO p_session_exercise_events VALUES (?,?,?,?,?,?)",
                    (old["id"] if old else uid(), identifier, sequence, key,
                     (old["logged_at"] or logged_at) if old else logged_at,
                     completed_at or (old["completed_at"] if old else None)),
                )
            recorder = db.execute(
                "SELECT name FROM p_users WHERE id=? AND org_id=?",
                (actor.user_id, actor.org_id),
            ).fetchone()
            db.execute(
                "INSERT INTO p_session_recorders(session_id,user_id,name,role,recorded_at) "
                "VALUES (?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET "
                "user_id=excluded.user_id,name=excluded.name,role=excluded.role,"
                "recorded_at=excluded.recorded_at",
                (identifier, actor.user_id, recorder["name"] if recorder else "Studio user", actor.role, now()),
            )
            if analysis_id:
                db.execute(
                    "INSERT OR IGNORE INTO p_session_analyses(session_id,analysis_id) VALUES (?,?)",
                    (identifier, analysis_id),
                )
            if item.get("program_id"):
                version = db.execute("SELECT MAX(version) FROM p_program_revisions WHERE program_id=?", (item["program_id"],)).fetchone()[0]
                if version:
                    db.execute(
                        "INSERT INTO p_training_session_program_versions VALUES (?,?,?) "
                        "ON CONFLICT(session_id) DO UPDATE SET program_id=excluded.program_id,version=excluded.version",
                        (identifier, item["program_id"], version),
                    )
            if reservation_id:
                db.execute(
                    "UPDATE p_reservations SET status='attended' WHERE id=?",
                    (reservation_id,),
                )
            self.audit(db, actor, "complete:session", identifier)
        return {"id": identifier, "analysis_id": analysis_id or (linked["analysis_id"] if linked else None)}

    def annotate(self, actor, item):
        if actor.role == "student":
            raise Refused("Ask your coach to annotate the scan.", 403)
        with self.db() as db:
            scan = self.get(actor, "scans", item["scan_id"], db)
            media = self.get(actor, "media", scan["media_id"], db)
            if (
                not 0
                <= int(item.get("frame_index", 0))
                < media["detail"].get("frames", 1)
            ):
                raise Refused("Choose a frame within the scan.")
            self._linked(actor, item, db)
            for key in ("x", "y", "x2", "y2"):
                if item.get(key) is not None and not 0 <= float(item[key]) <= 1:
                    raise Refused("Annotation coordinates must lie within the image.")
            if not str(item.get("text", "")).strip():
                raise Refused("Write an annotation.")
            identifier = uid()
            db.execute(
                "INSERT INTO p_scan_findings VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    identifier,
                    item["scan_id"],
                    item.get("region_id") or None,
                    float(item["x"]),
                    float(item["y"]),
                    item.get("x2"),
                    item.get("y2"),
                    int(item.get("frame_index", 0)),
                    str(item["text"])[:2000],
                    actor.user_id,
                    now(),
                ),
            )
        return {"id": identifier}

    def coordinates(self, actor, analysis_id, person_id=None):
        with self.db() as db:
            self.get(actor, "analyses", analysis_id, db)
            sql = """SELECT f.person_id,f.view,f.frame_index,f.time,f.suitable,c.*,l.name,l.region_id,l.method
                FROM p_pose_frames f JOIN p_coordinates c ON c.frame_id=f.id JOIN p_landmarks l ON l.id=c.landmark_id WHERE f.analysis_id=?"""
            args = [analysis_id]
            if person_id:
                sql += " AND f.person_id=?"
                args.append(person_id)
            return [
                dict(r)
                for r in db.execute(
                    sql + " ORDER BY f.view,f.time,CAST(l.id AS INTEGER)", args
                )
            ]

    def review(self, actor, item):
        identifier = item["analysis_id"]
        with self.db() as db:
            row = self.get(actor, "analyses", identifier, db)
            if actor.role == "student":
                raise Refused("Your coach reviews the assessment.", 403)
            selected = item.get("selection", {})
            if not selected:
                raise Refused("Select a person to review.")
            for view, person_id in selected.items():
                capture = next(
                    (v for v in row["result"]["views"] if v["view"] == view), None
                )
                person = next(
                    (
                        p
                        for p in (capture or {}).get("report", {}).get("people", [])
                        if str(p["person_id"]) == str(person_id)
                    ),
                    None,
                )
                if not person or not person.get("suitable"):
                    raise Refused(
                        "This person has insufficient visible body evidence. Retake the capture."
                    )
            detail = row["detail"]
            detail["reviewed_at"] = now()
            detail["reviewed_by"] = actor.user_id
            detail.setdefault("selected_people", {}).update(selected)
            db.execute(
                "UPDATE p_analyses SET detail=? WHERE id=?",
                (encode(detail), identifier),
            )
            from .analysis import publish_progress

            publish_progress(
                db,
                identifier,
                row["student_id"],
                row["result"],
                detail,
                row["created_at"],
                bool(row["demo"]),
            )
            self.audit(db, actor, "review:analysis", identifier, selected)
        return {"id": identifier, "reviewed": True}

    def search(self, actor, query):
        query = str(query).strip().lower()[:100]
        if not query:
            return []
        result = []
        for kind, role in [("client", "student"), ("coach", "coach")]:
            if kind == "coach" and actor.role != "admin":
                continue
            for p in self.people(actor, role):
                if query in (p["name"] + " " + p["email"]).lower():
                    result.append({"type": kind, "id": p["id"], "name": p["name"]})
        for collection in (
            "programs",
            "exercises",
            *(
                ("locations", "reservations", "analyses")
                if actor.role == "admin"
                else ()
            ),
        ):
            for p in self.list(actor, collection, q=query, limit=20)["items"]:
                result.append(
                    {
                        "type": collection,
                        "id": p["id"],
                        "name": p.get("name")
                        or p.get("protocol")
                        or p.get("session_type"),
                        "student_id": p.get("student_id"),
                    }
                )
        return result[:60]

    def inspect(self, actor):
        if actor.role != "admin":
            raise Refused("Only administrators can inspect the database.", 403)
        with self.db() as db:
            counts = {
                t: db.execute(
                    f"SELECT count(*) FROM {table} WHERE org_id=?", (actor.org_id,)
                ).fetchone()[0]
                for t, table in TABLES.items()
            }
            relationships = [
                dict(r)
                for r in db.execute(
                    "SELECT cs.* FROM p_coach_students cs JOIN p_users u ON u.id=cs.student_id WHERE u.org_id=?",
                    (actor.org_id,),
                )
            ]
            audit = [
                unpack(r)
                for r in db.execute(
                    "SELECT * FROM p_audit WHERE org_id=? ORDER BY id DESC LIMIT 100",
                    (actor.org_id,),
                )
            ]
        return {
            "counts": counts,
            "coach_students": relationships,
            "audit": audit,
            "schema_version": 1,
        }
