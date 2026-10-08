"""Numbered, checksummed, additive SQL migrations for the ``s_*`` tables.

Each ``migrations/NNNN_name.sql`` file runs once, inside its own transaction,
and is recorded in ``s_schema`` with the SHA-256 of its text. An applied file
whose text later changes is refused rather than silently diverging: a SEDENS
schema change is always a new numbered file.

The platform's own ``p_*`` tables are created by
:class:`pilates.platform.repository.Repository`; these migrations only add
tables that reference them, and every reference cascades or nulls on delete so
that existing platform deletions keep working unchanged.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re

DIRECTORY = Path(__file__).with_name("migrations")
_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

LEDGER = """CREATE TABLE IF NOT EXISTS s_schema(
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)"""


class MigrationError(RuntimeError):
    pass


def available(directory: Path = DIRECTORY) -> list[tuple[int, str, str]]:
    """(version, name, sql) for every migration file, in version order."""
    found = []
    for path in sorted(directory.glob("*.sql")):
        match = _NAME.match(path.name)
        if not match:
            raise MigrationError(f"Unexpected migration file name: {path.name}")
        found.append((int(match.group(1)), match.group(2), path.read_text()))
    versions = [v for v, _, _ in found]
    if len(set(versions)) != len(versions):
        raise MigrationError("Two migration files share a version number.")
    return found


def checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode()).hexdigest()


def applied(conn) -> dict[int, tuple[str, str]]:
    conn.execute(LEDGER)
    return {
        row[0]: (row[1], row[2])
        for row in conn.execute("SELECT version,name,checksum FROM s_schema")
    }


def migrate(conn, directory: Path = DIRECTORY) -> list[int]:
    """Apply pending migrations on an open sqlite3 connection. Returns versions."""
    conn.execute(LEDGER)
    conn.commit()
    done = applied(conn)
    newly = []
    for version, name, sql in available(directory):
        digest = checksum(sql)
        if version in done:
            if done[version][1] != digest:
                raise MigrationError(
                    f"Migration {version:04d}_{name} was changed after it was applied. "
                    "Add a new numbered migration instead of editing an applied one."
                )
            continue
        stamp = datetime.now(timezone.utc).isoformat()
        script = (
            "BEGIN IMMEDIATE;\n"
            + sql
            + "\nINSERT INTO s_schema(version,name,checksum,applied_at) VALUES ("
            + f"{version},'{name}','{digest}','{stamp}');\nCOMMIT;\n"
        )
        try:
            conn.executescript(script)
        except Exception:
            if conn.in_transaction:
                conn.rollback()
            raise
        newly.append(version)
    return newly
