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

from .archive import PoseStream, decode, encode
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
    -- The body proportions measured for this track. Held here rather than
    -- folded straight into the person, because confirming is what makes it
    -- theirs: learning from an unconfirmed link would let one wrong guess drag
    -- a person's signature towards somebody else, and every later proposal
    -- would inherit the error.
    signature TEXT NOT NULL DEFAULT '{}',
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

-- What the coach saw, which the camera cannot. A fourth tier: `observed`.
--
-- Not attached to a track, because a coach writes about a person and not about
-- whichever numbered box the tracker put them in that day -- and often about no
-- session at all: a contraindication is true of them, not of Tuesday.
CREATE TABLE IF NOT EXISTS observations (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES people(username) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL,
    text       TEXT NOT NULL,
    by         TEXT NOT NULL,
    made_on    TEXT NOT NULL,
    structure  TEXT NOT NULL DEFAULT '',
    fma        TEXT NOT NULL DEFAULT '',
    subject    TEXT NOT NULL DEFAULT '',
    exercise   TEXT NOT NULL DEFAULT '',
    rating     INTEGER,
    rates      TEXT NOT NULL DEFAULT '',
    review_on  TEXT NOT NULL DEFAULT '',
    retired    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS observations_person ON observations(username, made_on);

-- The pose stream: what the video contained, once the video is gone.
-- One blob per person per session, a few megabytes an hour, from which every
-- geometric analysis in this system can be re-derived.
CREATE TABLE IF NOT EXISTS poses (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    track_id   INTEGER NOT NULL,
    frames     INTEGER NOT NULL DEFAULT 0,
    duration_s REAL NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    bytes      INTEGER NOT NULL DEFAULT 0,
    stream     BLOB NOT NULL,
    PRIMARY KEY (session_id, track_id)
);

-- Discrete moments. A measurement says what a quantity was; an event says
-- something happened at a time -- a repetition, an adjustment, a student
-- leaving frame. Without these the record is a set of averages with no
-- account of the session's shape.
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    track_id   INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    start_s    REAL NOT NULL,
    end_s      REAL,
    label      TEXT NOT NULL DEFAULT '',
    value      REAL,
    detail     TEXT NOT NULL DEFAULT ''
);

-- How the analysis was produced. Without it, a number from 2026 cannot be
-- compared with one from 2028: a threshold moved, a model changed, and
-- nothing in the row would say so.
CREATE TABLE IF NOT EXISTS manifests (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    version    TEXT NOT NULL DEFAULT '',
    config     TEXT NOT NULL DEFAULT '{}',
    source_fps REAL NOT NULL DEFAULT 0,
    stride     INTEGER NOT NULL DEFAULT 1,
    width      INTEGER NOT NULL DEFAULT 0,
    height     INTEGER NOT NULL DEFAULT 0,
    notes      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS events_session ON events(session_id, track_id);
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

#: Kinds of event worth recording. Named rather than free text so a later
#: query can rely on them, and so adding one is a deliberate act.
EVENTS = (
    "repetition",      # one countable cycle, start to end
    "hold",            # a sustained position
    "adjustment",      # an instructor's hands on this student
    "absent",          # tracked, then not detected, then back
    "equipment",       # a declared prop came in or out of use
    "exercise",        # a labelled or recognised exercise segment
    "invalid",         # a stretch where measurements are not this student's
)

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
        self._migrate()
        self.db.commit()

    def _migrate(self) -> None:
        """Add columns a newer version needs to a database an older one made.

        CREATE TABLE IF NOT EXISTS leaves an existing table alone, so a store
        that has been collecting for a year would silently keep the old shape
        and every write against a new column would fail. Adding them here keeps
        a long-lived file usable across versions, which is the whole point of
        it being long-lived.
        """
        wanted = {
            "links": {"signature": "TEXT NOT NULL DEFAULT '{}'"},
            "measurements": {"at_time": "REAL"},
        }
        for table, columns in wanted.items():
            have = {row["name"] for row in
                    self.db.execute(f"PRAGMA table_info({table})")}
            for name, spec in columns.items():
                if name not in have:
                    self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {spec}")

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
    def put_link(self, link: Link, signature: Signature | None = None) -> None:
        """Record a link, optionally with the proportions measured for the track.

        Confirming a link is what folds that signature into the person: see
        :meth:`settle`.
        """
        kept = (json.dumps(signature.to_dict()) if signature is not None
                else self._link_signature_json(link))
        self.db.execute(
            "INSERT INTO links (session_id, track_id, username, status, method, "
            "distance, confirmed_by, confirmed_at, signature) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(session_id, track_id) DO UPDATE SET username=excluded.username, "
            "status=excluded.status, method=excluded.method, distance=excluded.distance, "
            "confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at, "
            "signature=excluded.signature",
            (self.session_id(link.session), link.track_id, link.username, link.status,
             link.method, link.distance, link.confirmed_by, link.confirmed_at, kept))
        self.db.commit()

    def _link_signature_json(self, link: Link) -> str:
        row = self.db.execute(
            "SELECT signature FROM links WHERE session_id = ? AND track_id = ?",
            (self.session_id(link.session), link.track_id)).fetchone()
        return row["signature"] if row else "{}"

    def link_signature(self, session: str, track_id: int) -> Signature:
        """The proportions measured for one track, whether or not it is settled."""
        row = self.db.execute(
            "SELECT signature FROM links WHERE session_id = ? AND track_id = ?",
            (self.session_id(session), track_id)).fetchone()
        return Signature.from_dict(json.loads(row["signature"])) if row else Signature()

    def settle(self, link: Link) -> bool:
        """Record a settled link, learning from it only if it was confirmed.

        The one place a person's signature grows. A rejection is stored and
        teaches nothing, which is the point: it says this shape was *not* that
        person, and the way to use that is to stop proposing it, never to
        average it in.
        """
        self.put_link(link)
        if not link.trustworthy:
            return False
        signature = self.link_signature(link.session, link.track_id)
        if not signature.ratios:
            return False
        self.save_signature(link.username,
                            self.signature(link.username).merge(signature))
        return True

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

    # -- what the coach saw ----------------------------------------------
    def observe(self, observation) -> int:
        """Record one coach observation. Returns its id.

        The session is looked up by key and may be absent: a note about a
        person -- an old injury, a cue that works for them -- belongs to them
        rather than to a class.
        """
        session_id = (self.session_id(observation.session)
                      if observation.session else None)
        cursor = self.db.execute(
            "INSERT INTO observations (username, session_id, kind, text, by, "
            "made_on, structure, fma, subject, exercise, rating, rates, "
            "review_on, retired) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (observation.username, session_id, observation.kind,
             observation.text, observation.by, observation.made_on,
             observation.structure, observation.fma, observation.subject,
             observation.exercise, observation.rating, observation.rates,
             observation.review_on, int(observation.retired)))
        self.db.commit()
        return int(cursor.lastrowid)

    def observations(self, username: str | None = None, kind: str | None = None,
                     structure: str | None = None,
                     include_retired: bool = False) -> list:
        """Read observations back, newest first.

        Retired ones are excluded by default and kept rather than deleted: a
        contraindication that was lifted is a different thing from one that was
        never there, and a coach reviewing a decision needs to see that it was
        made.
        """
        from .observations import Observation

        query = ("SELECT o.*, s.key AS session_key FROM observations o "
                 "LEFT JOIN sessions s ON s.id = o.session_id WHERE 1=1")
        params: list = []
        if username is not None:
            query += " AND o.username = ?"
            params.append(username)
        if kind is not None:
            query += " AND o.kind = ?"
            params.append(kind)
        if structure is not None:
            query += " AND o.structure = ?"
            params.append(structure)
        if not include_retired:
            query += " AND o.retired = 0"
        query += " ORDER BY o.made_on DESC, o.id DESC"
        return [
            Observation(
                id=r["id"], username=r["username"], kind=r["kind"],
                text=r["text"], by=r["by"], made_on=r["made_on"],
                session=r["session_key"] or "", structure=r["structure"],
                fma=r["fma"], subject=r["subject"], exercise=r["exercise"],
                rating=r["rating"], rates=r["rates"],
                review_on=r["review_on"], retired=bool(r["retired"]))
            for r in self.db.execute(query, params)
        ]

    def retire(self, observation_id: int, by: str) -> None:
        """Stop a standing observation applying, without erasing it.

        An injury that has healed and an injury that was never recorded are not
        the same, and a coach who lifted a restriction should be able to show
        that they did.
        """
        self.db.execute(
            "UPDATE observations SET retired = 1, "
            "text = text || ' [retired by ' || ? || ']' WHERE id = ?",
            (by, observation_id))
        self.db.commit()

    def coach_sheet(self, username: str):
        """Everything to read before this person's next class."""
        from .observations import sheet

        people = {p["username"]: p for p in self.people()}
        return sheet(self.observations(username), username,
                     people.get(username, {}).get("display_name", ""))

    # -- the pose stream -------------------------------------------------
    def save_poses(self, session: str, stream: PoseStream) -> int:
        """Archive one person's frames. Returns the bytes stored.

        This is the irreversible one. Everything else in a session can be
        recomputed from it; it can be recomputed from nothing.
        """
        blob = encode(stream)
        self.db.execute(
            "INSERT INTO poses (session_id, track_id, frames, duration_s, "
            "confidence, bytes, stream) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(session_id, track_id) DO UPDATE SET frames=excluded.frames, "
            "duration_s=excluded.duration_s, confidence=excluded.confidence, "
            "bytes=excluded.bytes, stream=excluded.stream",
            (self.session_id(session), stream.track_id, len(stream),
             stream.duration, stream.mean_confidence, len(blob), blob))
        self.db.commit()
        return len(blob)

    def poses(self, session: str, track_id: int) -> PoseStream | None:
        row = self.db.execute(
            "SELECT stream FROM poses WHERE session_id = ? AND track_id = ?",
            (self.session_id(session), track_id)).fetchone()
        return decode(row["stream"]) if row else None

    def archived_tracks(self, session: str) -> list[dict]:
        return [dict(r) for r in self.db.execute(
            "SELECT track_id, frames, duration_s, confidence, bytes FROM poses "
            "WHERE session_id = ? ORDER BY track_id", (self.session_id(session),))]

    # -- events ----------------------------------------------------------
    def add_event(self, session: str, track_id: int, kind: str, start_s: float,
                  end_s: float | None = None, label: str = "",
                  value: float | None = None, detail: str = "") -> None:
        if kind not in EVENTS:
            raise ValueError(f"unknown event kind {kind!r}; expected one of {EVENTS}")
        self.db.execute(
            "INSERT INTO events (session_id, track_id, kind, start_s, end_s, "
            "label, value, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (self.session_id(session), track_id, kind, start_s, end_s, label,
             value, detail))
        self.db.commit()

    def events(self, session: str, track_id: int | None = None,
               kind: str | None = None) -> list[dict]:
        query = "SELECT * FROM events WHERE session_id = ?"
        params: list = [self.session_id(session)]
        if track_id is not None:
            query += " AND track_id = ?"
            params.append(track_id)
        if kind is not None:
            query += " AND kind = ?"
            params.append(kind)
        return [dict(r) for r in
                self.db.execute(query + " ORDER BY start_s", params)]

    # -- provenance of the analysis itself --------------------------------
    def save_manifest(self, session: str, version: str, config: dict,
                      source_fps: float = 0.0, stride: int = 1,
                      width: int = 0, height: int = 0, notes: str = "") -> None:
        """Record how this session was analysed.

        A number from 2026 cannot be compared with one from 2028 unless
        something says what produced each. Thresholds move and models change,
        and nothing in a measurement row would show it.
        """
        self.db.execute(
            "INSERT INTO manifests (session_id, version, config, source_fps, "
            "stride, width, height, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(session_id) DO UPDATE SET version=excluded.version, "
            "config=excluded.config, source_fps=excluded.source_fps, "
            "stride=excluded.stride, width=excluded.width, "
            "height=excluded.height, notes=excluded.notes",
            (self.session_id(session), version, json.dumps(config, sort_keys=True),
             source_fps, stride, width, height, notes))
        self.db.commit()

    def manifest(self, session: str) -> dict | None:
        row = self.db.execute("SELECT * FROM manifests WHERE session_id = ?",
                              (self.session_id(session),)).fetchone()
        if row is None:
            return None
        out = dict(row)
        out["config"] = json.loads(out["config"])
        return out

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
        archived = self.db.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b, "
            "COALESCE(SUM(frames), 0) AS f FROM poses").fetchone()
        sessions = self.db.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"]
        with_manifest = self.db.execute(
            "SELECT COUNT(*) AS n FROM manifests").fetchone()["n"]
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
            "archived_tracks": archived["n"],
            "archived_frames": archived["f"],
            "archive_bytes": archived["b"],
            "sessions": sessions,
            # Sessions analysed without recording how. Their numbers cannot be
            # safely compared with later ones.
            "sessions_without_manifest": sessions - with_manifest,
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
            "events": [
                dict(r) for r in self.db.execute(
                    "SELECT e.* FROM events e JOIN links l "
                    "ON l.session_id = e.session_id AND l.track_id = e.track_id "
                    "WHERE l.username = ? AND l.status = 'confirmed' "
                    "ORDER BY e.session_id, e.start_s", (username,))],
            "pose_streams": [
                dict(r) for r in self.db.execute(
                    "SELECT p.session_id, p.track_id, p.frames, p.duration_s, "
                    "p.bytes FROM poses p JOIN links l "
                    "ON l.session_id = p.session_id AND l.track_id = p.track_id "
                    "WHERE l.username = ? AND l.status = 'confirmed'", (username,))],
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
        removed = {"measurements": 0, "findings": 0, "links": len(ids),
                   "events": 0, "pose_streams": 0}
        for session_id, track_id in ids:
            removed["measurements"] += self.db.execute(
                "DELETE FROM measurements WHERE session_id = ? AND track_id = ?",
                (session_id, track_id)).rowcount
            removed["findings"] += self.db.execute(
                "DELETE FROM findings WHERE session_id = ? AND track_id = ?",
                (session_id, track_id)).rowcount
            removed["events"] += self.db.execute(
                "DELETE FROM events WHERE session_id = ? AND track_id = ?",
                (session_id, track_id)).rowcount
            # The pose stream is the most personal thing held: it is the shape
            # of their body, frame by frame. Erasing without it would not be
            # erasing.
            removed["pose_streams"] += self.db.execute(
                "DELETE FROM poses WHERE session_id = ? AND track_id = ?",
                (session_id, track_id)).rowcount
        self.db.execute("DELETE FROM links WHERE username = ?", (username,))
        self.db.execute("DELETE FROM people WHERE username = ?", (username,))
        self.db.commit()
        return removed
