"""The SEDENS service: one object over the platform repository and its database."""

from __future__ import annotations

from contextlib import contextmanager

from . import migrations, modes
from .util import encode, now

ORG_KINDS = ("facility", "creator_studio", "sedens")


class Sedens:
    """SEDENS state lives in the platform's SQLite file, beside ``p_*``.

    Construct it after :class:`pilates.platform.repository.Repository`, which
    creates the platform tables these migrations reference.
    """

    def __init__(self, repo, mode: modes.Mode | None = None):
        self.repo = repo
        self.mode = mode or modes.resolve(db_path=repo.path)
        with repo.db() as db:
            self.applied = migrations.migrate(db)

    @contextmanager
    def db(self):
        with self.repo.db() as conn:
            yield conn

    @contextmanager
    def batch(self):
        with self.repo.batch():
            yield

    # -- organizations -------------------------------------------------------

    @staticmethod
    def org(db, org_id: str) -> dict | None:
        row = db.execute(
            "SELECT o.id,o.name,o.demo,p.kind,p.display_name,p.default_language "
            "FROM p_organizations o LEFT JOIN s_org_profiles p ON p.org_id=o.id WHERE o.id=?",
            (org_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "name": row["name"],
            "demo": bool(row["demo"]),
            # An organization without a SEDENS profile predates SEDENS and is a facility.
            "kind": row["kind"] or "facility",
            "display_name": row["display_name"] or row["name"],
            "default_language": row["default_language"] or "ko",
        }

    @staticmethod
    def set_org_profile(db, org_id, kind, display_name="", default_language="ko"):
        if kind not in ORG_KINDS:
            raise ValueError("unknown organization kind")
        db.execute(
            "INSERT INTO s_org_profiles(org_id,kind,display_name,default_language,created_at) "
            "VALUES (?,?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET kind=excluded.kind, "
            "display_name=excluded.display_name, default_language=excluded.default_language",
            (org_id, kind, display_name, default_language, now()),
        )

    @staticmethod
    def audit(db, org_id, actor_id, action, subject, detail=None):
        """Write the platform's own audit log, so SEDENS actions sit beside it."""
        db.execute(
            "INSERT INTO p_audit(org_id,actor_id,action,subject_id,created_at,detail) VALUES (?,?,?,?,?,?)",
            (org_id, actor_id, "sedens:" + action, str(subject), now(), encode(detail or {})),
        )

    @staticmethod
    def user(db, user_id) -> dict | None:
        row = db.execute(
            "SELECT id,org_id,name,email,active FROM p_users WHERE id=?", (user_id,)
        ).fetchone()
        if row is None:
            return None
        value = dict(row)
        value["roles"] = [
            r[0] for r in db.execute("SELECT role FROM p_roles WHERE user_id=?", (user_id,))
        ]
        return value
