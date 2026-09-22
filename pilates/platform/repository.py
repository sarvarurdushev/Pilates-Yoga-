"""Relational organization data and authorization; no client-side scope decisions."""

from __future__ import annotations
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
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


class Repository:
    def __init__(self, path, media_root=None):
        self.path = str(path)
        self._transaction = threading.local()
        self.media_root = Path(media_root or (str(path) + ".media"))
        self.media_root.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript(Path(__file__).with_name("schema.sql").read_text())
            db.execute("INSERT OR IGNORE INTO p_schema VALUES (1,?)", (now(),))
        from .regions import seed_regions

        seed_regions(self)

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
            return (
                f"org_id=? AND (student_id IN ({marks}) OR owner_id=? OR exercise_id IN (SELECT id FROM p_exercises WHERE org_id=? AND visibility='organization') OR exercise_id IN (SELECT pe.exercise_id FROM p_program_exercises pe JOIN p_program_assignments pa ON pa.program_id=pe.program_id WHERE pa.student_id IN ({marks})))",
                [actor.org_id, *students, actor.user_id, actor.org_id, *students],
            )
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
            return (
                f"org_id=? AND (owner_id=? OR id IN (SELECT program_id FROM p_program_assignments WHERE student_id IN ({marks})))",
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
        row = db.execute(
            f"SELECT * FROM {TABLES[collection]} WHERE ({where}) AND id=?",
            args + [identifier],
        ).fetchone()
        if not row:
            raise Refused("This record is not available in your workspace.", 404)
        result = unpack(row)
        if collection == "programs":
            result["steps"] = [
                unpack(r)
                for r in db.execute(
                    "SELECT * FROM p_program_exercises WHERE program_id=? ORDER BY position",
                    (identifier,),
                )
            ]
            students = self.student_ids(actor, db)
            result["assignments"] = [
                unpack(r)
                for r in db.execute(
                    "SELECT * FROM p_program_assignments WHERE program_id=?",
                    (identifier,),
                )
                if r["student_id"] in students
            ]
        if collection == "exercises":
            result["resources"] = [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM p_resources WHERE exercise_id=?", (identifier,)
                )
            ]
            result["media"] = [
                {k: v for k, v in unpack(r).items() if k != "path"}
                for r in db.execute(
                    "SELECT m.* FROM p_media m JOIN p_exercise_media e ON e.media_id=m.id WHERE e.exercise_id=?",
                    (identifier,),
                )
            ]
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
                    "SELECT * FROM p_scan_findings WHERE scan_id=?", (identifier,)
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
                    u["last_session_steps"] = db.execute(
                        "SELECT count(*) FROM p_program_exercises WHERE program_id=?",
                        ((u["latest_session"] or {}).get("program_id"),),
                    ).fetchone()[0]
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
                    "SELECT * FROM p_training_sessions WHERE student_id=? ORDER BY performed_at DESC",
                    (identifier,),
                )
            ]
            client["progress"] = [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM p_progress_records WHERE student_id=? ORDER BY recorded_at",
                    (identifier,),
                )
            ]
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
            for k in list(fields):
                if k.endswith("_id") and fields[k] == "":
                    fields[k] = None
            merged = {**existing, **fields}
            self._linked(actor, merged, db, merged.get("student_id"))
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
            if collection == "programs" and "steps" in item:
                self._steps(actor, identifier, item["steps"], db)
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
        db.execute("DELETE FROM p_program_exercises WHERE program_id=?", (program,))
        for position, step in enumerate(steps):
            self.get(actor, "exercises", step["exercise_id"], db)
            values = [
                int(step.get(k, d))
                for k, d in [("sets", 1), ("reps", 8), ("seconds", 60), ("rest", 20)]
            ]
            if any(v < 0 or v > 7200 for v in values) or values[0] < 1:
                raise Refused("Enter valid sets, repetitions and durations.")
            db.execute(
                "INSERT INTO p_program_exercises VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    uid(),
                    program,
                    step["exercise_id"],
                    position,
                    str(step.get("phase", "Practice"))[:40],
                    *values,
                    str(step.get("notes", ""))[:3000],
                ),
            )

    def _exercise_links(self, actor, exercise, item, db):
        if "resources" in item:
            if len(item["resources"]) > 30:
                raise Refused("Use at most 30 resources per exercise.")
            db.execute("DELETE FROM p_resources WHERE exercise_id=?", (exercise,))
            for r in item["resources"]:
                if not re.match(r"^https?://[^\s]+$", str(r.get("url", ""))):
                    raise Refused("Resources need an http or https URL.")
                db.execute(
                    "INSERT INTO p_resources VALUES (?,?,?,?)",
                    (
                        uid(),
                        exercise,
                        str(r.get("title") or "Resource")[:150],
                        r["url"],
                    ),
                )
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
            SELECT lower(e.name) AS name, MAX(ee.quantity) AS quantity
            FROM p_program_exercises pe JOIN p_exercise_equipment ee ON ee.exercise_id=pe.exercise_id
            JOIN p_equipment e ON e.id=ee.equipment_id WHERE pe.program_id=? GROUP BY lower(e.name)
            """,
                (program_id,),
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
                if (
                    collection == "equipment"
                    and db.execute(
                        "SELECT 1 FROM p_exercise_equipment WHERE equipment_id=?",
                        (identifier,),
                    ).fetchone()
                ):
                    raise Refused(
                        "Update exercises that require this equipment before deleting it. Set availability to zero to mark it out of service.",
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
            self.get(actor, "programs", item["program_id"], db)
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

    def complete_session(self, actor, item):
        with self.db() as db:
            self.assert_student(actor, item["student_id"], True, db)
            if item.get("program_id"):
                program = self.get(actor, "programs", item["program_id"], db)
                if not db.execute(
                    "SELECT 1 FROM p_program_assignments WHERE student_id=? AND program_id=? AND active=1",
                    (item["student_id"], item["program_id"]),
                ).fetchone():
                    raise Refused(
                        "Assign this program to the client before recording a session."
                    )
                allowed = {s["exercise_id"] for s in program["steps"]}
                if any(x not in allowed for x in item.get("completed", [])):
                    raise Refused("Completed exercises must belong to the program.")

            if item.get("reservation_id"):
                r = self.get(actor, "reservations", item["reservation_id"], db)
                if r["student_id"] != item["student_id"]:
                    raise Refused("The reservation belongs to another client.")
            identifier = uid()
            db.execute(
                "INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
                (
                    identifier,
                    item["student_id"],
                    item.get("reservation_id") or None,
                    item.get("program_id") or None,
                    None,
                    now(),
                    encode(item.get("completed", [])),
                    str(item.get("notes", ""))[:3000],
                ),
            )
            if item.get("reservation_id"):
                db.execute(
                    "UPDATE p_reservations SET status='attended' WHERE id=?",
                    (item["reservation_id"],),
                )
        return {"id": identifier}

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
