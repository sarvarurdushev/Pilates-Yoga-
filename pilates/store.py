"""The long-term record: every session, every measurement, every finding.

Built for the case where this has been running in a studio for two years. That
changes what matters. A JSON file a person can read is right for one studio's
notes and wrong for a hundred thousand measurements, so this is SQLite --
stdlib, no server, one file, and it will answer "how has this person's hip
range moved over eighteen months" without loading eighteen months into memory.

Three decisions shape the schema.

**Measurements are keyed to a track, not to a person.** A row records that
track 4 in Tuesday's session had a hip range of 62 degrees. Which *person* that
was is a separate fact, in a separate table, with its own provenance. Joining
them at query time rather than at write time buys three things that matter more
than the join costs:

* nothing is lost while an assignment is unconfirmed -- the measurement is
  already stored, and confirming later attributes it retroactively;
* a mistaken assignment is **reversible**, because unpicking it changes one row
  in one table rather than hunting through the history;
* the analysis and the identity question stay independent, so a change to how
  identity is decided does not require re-deriving any measurement.

**Every row carries where it came from.** ``source`` says which mechanism
produced it: a library standard, the class baseline, the general movement
checks, or the load model. ``valid`` and ``invalid_reason`` carry the
interaction rules -- a load measured while an instructor's hands were on
somebody is stored and flagged, never silently dropped and never silently
averaged in. A training set assembled from this can filter on both. One
assembled without them would be quietly poisoned in a way nothing downstream
could detect.

**A person can be handed everything held about them, or erased.** Both are one
call. For a system accumulating body measurements against named people, that is
not a feature to add later.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .identity import CONFIRMED, Link, Signature

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    username     TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    enrolled_at  TEXT NOT NULL DEFAULT '',
    signature    TEXT NOT NULL DEFAULT '{}',
    confirmations INTEGER NOT NULL DEFAULT 0,
    notes        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY,
    key        TEXT UNIQUE NOT NULL,
    video      TEXT NOT NULL DEFAULT '',
    date       TEXT NOT NULL DEFAULT '',
    studio     TEXT NOT NULL DEFAULT '',
    duration_s REAL NOT NULL DEFAULT 0,
    students   INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT ''
);

-- Identity, kept apart from the measurements it attributes.
CREATE TABLE IF NOT EXISTS links (
    session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    track_id     INTEGER NOT NULL,
    username     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'proposed',
    method       TEXT NOT NULL DEFAULT 'proportions',
    distance     REAL,
    confirmed_by TEXT NOT NULL DEFAULT '',
    confirmed_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (session_id, track_id)
);

CREATE TABLE IF NOT EXISTS measurements (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    track_id   INTEGER NOT NULL,
    exercise   TEXT NOT NULL DEFAULT '',
    subject    TEXT NOT NULL,
    value      REAL NOT NULL,
    spread     REAL NOT NULL DEFAULT 0,
    samples    INTEGER NOT NULL DEFAULT 0,
    unit       TEXT NOT NULL DEFAULT 'deg',
    source     TEXT NOT NULL DEFAULT 'standard',
    valid      INTEGER NOT NULL DEFAULT 1,
    invalid_reason TEXT NOT NULL DEFAULT '',
    at_time    REAL
);

CREATE TABLE IF NOT EXISTS findings (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    track_id   INTEGER NOT NULL,
    exercise   TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL,
    subject    TEXT NOT NULL DEFAULT '',
    message    TEXT NOT NULL,
    measured   REAL,
    target     TEXT NOT NULL DEFAULT '',
    deviation  REAL NOT NULL DEFAULT 0,
    source     TEXT NOT NULL DEFAULT 'standard'
);

CREATE INDEX IF NOT EXISTS measurements_session ON measurements(session_id, track_id);
CREATE INDEX IF NOT EXISTS measurements_subject ON measurements(subject);
CREATE INDEX IF NOT EXISTS findings_session ON findings(session_id, track_id);
CREATE INDEX IF NOT EXISTS links_username ON links(username, status);

-- Only measurements a person confirmed the identity of. Everything that
-- reaches a history or a chart goes through here.
CREATE VIEW IF NOT EXISTS attributed_measurements AS
SELECT m.*, l.username, s.date, s.key AS session_key, s.studio
FROM measurements m
JOIN links l ON l.session_id = m.session_id AND l.track_id = m.track_id
JOIN sessions s ON s.id = m.session_id
WHERE l.status = 'confirmed';

CREATE VIEW IF NOT EXISTS attributed_findings AS
SELECT f.*, l.username, s.date, s.key AS session_key
FROM findings f
JOIN links l ON l.session_id = f.session_id AND l.track_id = f.track_id
JOIN sessions s ON s.id = f.session_id
WHERE l.status = 'confirmed';
"""

#: Which mechanism produced a row. A later model needs this to know what it is
#: learning from: a library target and a cohort comparison are different kinds
#: of claim and should never be pooled without saying so.
SOURCES = ("standard", "class", "quality", "load", "manual")


@dataclass
class SessionMeta:
    """What one recording was."""

    key: str
    video: str = ""
    date: str = ""
    studio: str = ""
    duration_s: float = 0.0
    students: int = 0
    notes: str = ""


@dataclass
class Row:
    """One stored measurement, as it comes back out."""

    subject: str
    value: float
    spread: float
    samples: int
    date: str
    exercise: str = ""
    unit: str = "deg"
    source: str = "standard"
    valid: bool = True
    invalid_reason: str = ""
    session_key: str = ""


class Store:
    """A studio's long-term record.

    Opening creates the schema if it is not there, so a first run needs no
    setup step.
    """

    def __init__(self, connection: sqlite3.Connection):
        self.db = connection
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(SCHEMA)
        self.db.commit()

    @classmethod
    def open(cls, path: str | Path) -> "Store":
        file = Path(path)
        file.parent.mkdir(parents=True, exist_ok=True)
        return cls(sqlite3.connect(str(file)))

    @classmethod
    def memory(cls) -> "Store":
        """An in-memory store, for tests and for a dry run."""
        return cls(sqlite3.connect(":memory:"))

    def close(self) -> None:
        self.db.commit()
        self.db.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- people ---------------------------------------------------------
    def enrol(self, username: str, display_name: str = "") -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO people (username, display_name, enrolled_at) "
            "VALUES (?, ?, ?)",
            (username, display_name,
             datetime.now(timezone.utc).isoformat(timespec="seconds")))
        self.db.commit()

    def people(self) -> list[dict]:
        return [dict(r) for r in
                self.db.execute("SELECT * FROM people ORDER BY username")]

    def save_signature(self, username: str, signature: Signature,
                       confirmations: int | None = None) -> None:
        if confirmations is None:
            self.db.execute(
                "UPDATE people SET signature = ?, confirmations = confirmations + 1 "
                "WHERE username = ?", (json.dumps(signature.to_dict()), username))
        else:
            self.db.execute(
                "UPDATE people SET signature = ?, confirmations = ? WHERE username = ?",
                (json.dumps(signature.to_dict()), confirmations, username))
        self.db.commit()

    def signature(self, username: str) -> Signature:
        row = self.db.execute(
            "SELECT signature FROM people WHERE username = ?", (username,)).fetchone()
        return Signature.from_dict(json.loads(row["signature"])) if row else Signature()

    # -- sessions -------------------------------------------------------
    def record_session(self, meta: SessionMeta) -> int:
        """Insert or update one recording, returning its id."""
        self.db.execute(
            "INSERT INTO sessions (key, video, date, studio, duration_s, students, "
            "recorded_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET video=excluded.video, date=excluded.date, "
            "studio=excluded.studio, duration_s=excluded.duration_s, "
            "students=excluded.students, notes=excluded.notes",
            (meta.key, meta.video, meta.date, meta.studio, meta.duration_s,
             meta.students,
             datetime.now(timezone.utc).isoformat(timespec="seconds"), meta.notes))
        self.db.commit()
        return self.session_id(meta.key)

    def session_id(self, key: str) -> int:
        row = self.db.execute("SELECT id FROM sessions WHERE key = ?", (key,)).fetchone()
        if row is None:
            raise KeyError(f"no session recorded under {key!r}")
        return int(row["id"])

    def sessions(self) -> list[dict]:
        return [dict(r) for r in
                self.db.execute("SELECT * FROM sessions ORDER BY date, key")]

    # -- identity -------------------------------------------------------
    def put_link(self, link: Link) -> None:
        self.db.execute(
            "INSERT INTO links (session_id, track_id, username, status, method, "
            "distance, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(session_id, track_id) DO UPDATE SET username=excluded.username, "
            "status=excluded.status, method=excluded.method, distance=excluded.distance, "
            "confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at",
            (self.session_id(link.session), link.track_id, link.username, link.status,
             link.method, link.distance, link.confirmed_by, link.confirmed_at))
        self.db.commit()

    def links(self, session: str | None = None,
              status: str | None = None) -> list[Link]:
        query = ("SELECT l.*, s.key FROM links l JOIN sessions s ON s.id = l.session_id")
        clauses, params = [], []
        if session is not None:
            clauses.append("s.key = ?")
            params.append(session)
        if status is not None:
            clauses.append("l.status = ?")
            params.append(status)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        return [
            Link(session=r["key"], track_id=r["track_id"], username=r["username"],
                 status=r["status"], method=r["method"], distance=r["distance"],
                 confirmed_by=r["confirmed_by"], confirmed_at=r["confirmed_at"])
            for r in self.db.execute(query + " ORDER BY l.track_id", params)
        ]

    def pending(self) -> list[Link]:
        """Links waiting for somebody to confirm or reject them.

        The queue that has to be empty before a session's numbers count. Data
        sitting here is not lost -- it is stored and unattributed, and
        confirming attributes it retroactively.
        """
        return [l for l in self.links() if l.status != CONFIRMED]

    # -- measurements and findings --------------------------------------
    def add_measurement(
        self, session: str, track_id: int, subject: str, value: float,
        spread: float = 0.0, samples: int = 0, exercise: str = "",
        unit: str = "deg", source: str = "standard", valid: bool = True,
        invalid_reason: str = "", at_time: float | None = None,
    ) -> None:
        if source not in SOURCES:
            raise ValueError(f"unknown source {source!r}; expected one of {SOURCES}")
        self.db.execute(
            "INSERT INTO measurements (session_id, track_id, exercise, subject, "
            "value, spread, samples, unit, source, valid, invalid_reason, at_time) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (self.session_id(session), track_id, exercise, subject, value, spread,
             samples, unit, source, int(valid), invalid_reason, at_time))
        self.db.commit()

    def add_finding(
        self, session: str, track_id: int, kind: str, message: str,
        subject: str = "", exercise: str = "", measured: float | None = None,
        target: str = "", deviation: float = 0.0, source: str = "standard",
    ) -> None:
        self.db.execute(
            "INSERT INTO findings (session_id, track_id, exercise, kind, subject, "
            "message, measured, target, deviation, source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (self.session_id(session), track_id, exercise, kind, subject, message,
             measured, target, deviation, source))
        self.db.commit()

    # -- reading back ---------------------------------------------------
    def history(
        self, username: str, subject: str | None = None,
        exercise: str | None = None, valid_only: bool = True,
    ) -> list[Row]:
        """One person's confirmed measurements, oldest first.

        ``valid_only`` is on by default: a load measured while somebody's hands
        were on the student is a reading of two people, and it is stored so it
        can be examined, not so it can be averaged.
        """
        query = "SELECT * FROM attributed_measurements WHERE username = ?"
        params: list = [username]
        if subject is not None:
            query += " AND subject = ?"
            params.append(subject)
        if exercise is not None:
            query += " AND exercise = ?"
            params.append(exercise)
        if valid_only:
            query += " AND valid = 1"
        return [
            Row(subject=r["subject"], value=r["value"], spread=r["spread"],
                samples=r["samples"], date=r["date"], exercise=r["exercise"],
                unit=r["unit"], source=r["source"], valid=bool(r["valid"]),
                invalid_reason=r["invalid_reason"], session_key=r["session_key"])
            for r in self.db.execute(query + " ORDER BY date, session_key", params)
        ]

    def findings_for(self, username: str, kind: str | None = None) -> list[dict]:
        query = "SELECT * FROM attributed_findings WHERE username = ?"
        params: list = [username]
        if kind is not None:
            query += " AND kind = ?"
            params.append(kind)
        return [dict(r) for r in
                self.db.execute(query + " ORDER BY date, deviation DESC", params)]

    def subjects(self, username: str) -> list[str]:
        return [r["subject"] for r in self.db.execute(
            "SELECT DISTINCT subject FROM attributed_measurements "
            "WHERE username = ? AND valid = 1 ORDER BY subject", (username,))]

    def session_dates(self, username: str) -> list[str]:
        return [r["date"] for r in self.db.execute(
            "SELECT DISTINCT date FROM attributed_measurements "
            "WHERE username = ? ORDER BY date", (username,))]

    def recurring_findings(self, username: str, min_sessions: int = 2) -> list[dict]:
        """Corrections this person has been given more than once.

        The thing a student most wants to know and a single report cannot say:
        not "your hips were uneven today" but "your hips have been uneven in
        five of your last six classes".
        """
        return [dict(r) for r in self.db.execute(
            "SELECT message, subject, exercise, COUNT(DISTINCT date) AS sessions, "
            "       MIN(date) AS first_seen, MAX(date) AS last_seen "
            "FROM attributed_findings WHERE username = ? AND kind = 'improve' "
            "GROUP BY message HAVING sessions >= ? "
            "ORDER BY sessions DESC, last_seen DESC", (username, min_sessions))]

    def coverage(self) -> dict:
        """How much of what was recorded is actually attributed to anybody.

        The number that says whether the long-term record is worth anything.
        Measurements piling up against unconfirmed tracks are not data yet.
        """
        total = self.db.execute("SELECT COUNT(*) AS n FROM measurements").fetchone()["n"]
        attributed = self.db.execute(
            "SELECT COUNT(*) AS n FROM attributed_measurements").fetchone()["n"]
        invalid = self.db.execute(
            "SELECT COUNT(*) AS n FROM measurements WHERE valid = 0").fetchone()["n"]
        return {
            "measurements": total,
            "attributed": attributed,
            "unattributed": total - attributed,
            "invalid": invalid,
            "share": attributed / total if total else 0.0,
            "pending_links": len(self.pending()),
        }

    # -- what is held about a person ------------------------------------
    def export_person(self, username: str) -> dict:
        """Everything held about one person, in one structure.

        Handed over on request. For a system accumulating body measurements
        against named people this is not a feature to add later.
        """
        person = self.db.execute(
            "SELECT * FROM people WHERE username = ?", (username,)).fetchone()
        return {
            "person": dict(person) if person else {"username": username},
            "links": [l.to_dict() for l in self.links() if l.username == username],
            "measurements": [
                dict(r) for r in self.db.execute(
                    "SELECT * FROM attributed_measurements WHERE username = ? "
                    "ORDER BY date", (username,))],
            "findings": self.findings_for(username),
        }

    def forget(self, username: str) -> dict:
        """Erase a person and unpick every measurement attributed to them.

        The measurements themselves are deleted rather than orphaned: a row
        that says "track 4 in Tuesday's class had a hip range of 62 degrees"
        is still about that person, and leaving it behind because the name
        column is gone would be erasure in name only.
        """
        ids = [(r["session_id"], r["track_id"]) for r in self.db.execute(
            "SELECT session_id, track_id FROM links WHERE username = ?", (username,))]
        removed = {"measurements": 0, "findings": 0, "links": len(ids)}
        for session_id, track_id in ids:
            removed["measurements"] += self.db.execute(
                "DELETE FROM measurements WHERE session_id = ? AND track_id = ?",
                (session_id, track_id)).rowcount
            removed["findings"] += self.db.execute(
                "DELETE FROM findings WHERE session_id = ? AND track_id = ?",
                (session_id, track_id)).rowcount
        self.db.execute("DELETE FROM links WHERE username = ?", (username,))
        self.db.execute("DELETE FROM people WHERE username = ?", (username,))
        self.db.commit()
        return removed
