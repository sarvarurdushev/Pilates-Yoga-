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

-- ---------------------------------------------------------------- people
-- Who is who, where, and what they may see. The measurement tables above know
-- about bodies and nothing about permission; these know about permission and
-- nothing about bodies. They meet at one column: accounts.username is the same
-- key the links, observations and measurements are attributed to, so one person
-- has one history whichever role they are acting in.
--
-- The load-bearing decision is that ROLE LIVES ON THE MEMBERSHIP, not on the
-- account. See docs/accounts.md; the short version is that the first real user
-- of this system needs to be admin, coach and student at once, and a role
-- column on the account makes that three strangers.
CREATE TABLE IF NOT EXISTS accounts (
    username      TEXT PRIMARY KEY REFERENCES people(username) ON DELETE CASCADE,
    email         TEXT UNIQUE NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT '',
    active        INTEGER NOT NULL DEFAULT 1,
    -- Empty until the address has been proved, which needs an email service.
    -- Where there is none this stays empty for everybody and means nothing;
    -- where there is one it is the difference between an address somebody
    -- typed and an address somebody has.
    verified_at   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS studios (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    city       TEXT NOT NULL DEFAULT '',
    country    TEXT NOT NULL DEFAULT '',
    timezone   TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT NOT NULL DEFAULT ''
);

-- One person, at one studio, in one role. A person may hold several rows here
-- and acts as one of them at a time.
CREATE TABLE IF NOT EXISTS memberships (
    username   TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
    studio     TEXT NOT NULL REFERENCES studios(key) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    state      TEXT NOT NULL DEFAULT 'pending',
    since      TEXT NOT NULL DEFAULT '',
    decided_by TEXT NOT NULL DEFAULT '',
    decided_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (username, studio, role)
);

CREATE TABLE IF NOT EXISTS profiles (
    username        TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,
    born            TEXT NOT NULL DEFAULT '',
    height_m        REAL,
    mass_kg         REAL,
    emergency_name  TEXT NOT NULL DEFAULT '',
    emergency_phone TEXT NOT NULL DEFAULT '',
    goals           TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL DEFAULT ''
);

-- Health, in its own table so that it can be guarded and redacted on its own.
-- A coach is shown flags(); nothing here is served to one whole.
CREATE TABLE IF NOT EXISTS screenings (
    username             TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,
    answers              TEXT NOT NULL DEFAULT '{}',
    conditions           TEXT NOT NULL DEFAULT '',
    medications          TEXT NOT NULL DEFAULT '',
    injuries             TEXT NOT NULL DEFAULT '',
    pregnant             INTEGER NOT NULL DEFAULT 0,
    cleared_by_physician INTEGER NOT NULL DEFAULT 0,
    completed_on         TEXT NOT NULL DEFAULT '',
    updated_at           TEXT NOT NULL DEFAULT ''
);

-- A coach and a student, and the consent that makes it real. Being in the same
-- building is not permission; this row is.
CREATE TABLE IF NOT EXISTS assignments (
    coach    TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
    student  TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
    studio   TEXT NOT NULL REFERENCES studios(key) ON DELETE CASCADE,
    state    TEXT NOT NULL DEFAULT 'pending',
    scopes   TEXT NOT NULL DEFAULT '[]',
    since    TEXT NOT NULL DEFAULT '',
    until    TEXT NOT NULL DEFAULT '',
    asked_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (coach, student, studio)
);

-- Logins. The token is stored hashed: a stolen database should not be a stolen
-- set of live sessions.
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
    studio     TEXT NOT NULL DEFAULT '',
    role       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    last_seen  TEXT NOT NULL DEFAULT ''
);

-- The safe way to create staff: the role is scoped in the same step as the
-- invitation, rather than approved after the fact.
CREATE TABLE IF NOT EXISTS invitations (
    token_hash  TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    studio      TEXT NOT NULL REFERENCES studios(key) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    invited_by  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT '',
    expires_at  TEXT NOT NULL DEFAULT '',
    accepted_at TEXT NOT NULL DEFAULT ''
);

-- What a coach scored after a class, on the five principles instructor
-- training is built on. Kept apart from observations because they are
-- different jobs: a note is prose about one moment, an evaluation is the same
-- five judgements every time so that the third can be compared with the first.
CREATE TABLE IF NOT EXISTS evaluations (
    id       INTEGER PRIMARY KEY,
    username TEXT NOT NULL REFERENCES people(username) ON DELETE CASCADE,
    by       TEXT NOT NULL,
    scores   TEXT NOT NULL DEFAULT '{}',
    notes    TEXT NOT NULL DEFAULT '{}',
    did      TEXT NOT NULL DEFAULT '',
    settings TEXT NOT NULL DEFAULT '',
    cue      TEXT NOT NULL DEFAULT '',
    plan     TEXT NOT NULL DEFAULT '',
    effort   TEXT NOT NULL DEFAULT 'steady',
    session  TEXT NOT NULL DEFAULT '',
    made_on  TEXT NOT NULL DEFAULT '',
    made_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS evaluations_person ON evaluations(username, made_on);

-- One-time links: a password reset, or an email verification. Hashed, for the
-- same reason a session token is: the server needs to recognise one it is
-- shown, never to reproduce it, and a stolen database should not be a stolen
-- set of live reset links.
CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    issued_by  TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    used_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS tokens_person ON tokens(username, purpose);

-- Recovery codes: the way back in for a studio with no email service at all,
-- which is most of them. Printed once at signup, kept by the person, spent one
-- at a time. Hashed like everything else that is shown once.
CREATE TABLE IF NOT EXISTS recovery_codes (
    code_hash  TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT '',
    used_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS recovery_person ON recovery_codes(username, used_at);

-- Who did what to whom. The only way "who saw my health record" has an answer.
CREATE TABLE IF NOT EXISTS audit (
    id      INTEGER PRIMARY KEY,
    at      TEXT NOT NULL,
    actor   TEXT NOT NULL DEFAULT '',
    action  TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    studio  TEXT NOT NULL DEFAULT '',
    detail  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_subject ON audit(subject, at);
CREATE INDEX IF NOT EXISTS audit_actor ON audit(actor, at);
CREATE INDEX IF NOT EXISTS memberships_studio ON memberships(studio, role, state);
CREATE INDEX IF NOT EXISTS assignments_coach ON assignments(coach, state);
CREATE INDEX IF NOT EXISTS assignments_student ON assignments(student, state);

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

        # -- concurrency, learned the hard way ---------------------------
        #
        # The server opens a connection per request, because SQLite
        # connections are not shareable across threads. Under the rollback
        # journal that means one writer blocks every reader on the file, and a
        # write that takes a second -- filling a studio with fixture data,
        # a capture subprocess saving a session -- makes every other request in
        # flight fail with "database is locked". Which is exactly what
        # happened: pressing one button in the admin console broke the page
        # around it.
        #
        # WAL is the fix and the reason it is the fix is worth writing down:
        # readers no longer block on the writer and the writer no longer blocks
        # readers, so only writer-against-writer contends -- and those are all
        # milliseconds long.
        try:
            self.db.execute("PRAGMA journal_mode = WAL")
        except sqlite3.DatabaseError:
            # A read-only file or an exotic filesystem. The rest still works.
            pass
        # And when two writers do meet, wait rather than fail. The default is
        # five seconds, which a capture writing a long session can exceed.
        self.db.execute("PRAGMA busy_timeout = 20000")
        # Left at FULL deliberately. NORMAL is the usual WAL pairing and is
        # faster, and what it trades away is the last few transactions on power
        # loss -- which here is a coach's note about somebody's knee.
        self.db.execute("PRAGMA synchronous = FULL")

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
            "accounts": {"verified_at": "TEXT NOT NULL DEFAULT ''"},
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

    def recordings(self) -> list[dict]:
        """Every session, with who is in it -- newest first.

        What a person needs to find a recording again: whose it is, when, and
        how much came out of it. Newest first because the thing somebody is
        looking for is almost always the one they just made.

        A session with no attributed measurements is still listed. It happened,
        it is on record, and hiding it would leave somebody hunting for a
        recording the system is quietly refusing to mention.
        """
        rows = self.db.execute("""
            SELECT s.key, s.date, s.studio, s.duration_s,
                   l.username AS username,
                   p.display_name AS display_name,
                   COUNT(DISTINCT m.id) AS measurements
              FROM sessions s
              LEFT JOIN links l ON l.session_id = s.id AND l.status = 'confirmed'
              LEFT JOIN people p ON p.username = l.username
              LEFT JOIN measurements m
                     ON m.session_id = s.id AND m.track_id = l.track_id
             GROUP BY s.key, s.date, s.studio, s.duration_s, l.username,
                      p.display_name
             ORDER BY s.date DESC, s.key DESC
        """)
        return [dict(r) for r in rows]


    # -- accounts, studios and roles ------------------------------------
    #
    # The whole of this section is one idea: a role is a row joining a person
    # to a studio, and every question about permission is asked of that row.
    # See docs/accounts.md.

    def add_studio(self, studio: "Studio") -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO studios (key, name, city, country, "
            "timezone, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (studio.key, studio.name, studio.city, studio.country,
             studio.timezone, studio.created_at))
        self.db.commit()

    def studios(self) -> list[dict]:
        return [dict(r) for r in
                self.db.execute("SELECT * FROM studios ORDER BY name")]

    def studio(self, key: str) -> dict | None:
        row = self.db.execute("SELECT * FROM studios WHERE key = ?",
                              (key,)).fetchone()
        return dict(row) if row else None

    def claim_first_admin(self, account: "Account", password: str,
                          studio: "Studio") -> str:
        """Make the first admin, and only ever the first.

        Atomic on purpose. Two people opening the setup page of a fresh
        deployment at the same moment is not a hypothetical -- it is a URL
        somebody shared -- and the loser of that race must be refused rather
        than quietly made a second owner. SQLite gives us the guarantee for
        free if the check and the insert are in one exclusive transaction.
        """
        from .accounts import ACTIVE, ADMIN, COACH, Membership, STUDENT, now

        self.db.execute("BEGIN IMMEDIATE")
        try:
            if self.db.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
                raise ValueError("this studio already has an owner; sign in "
                                 "instead, or ask them for an invitation")
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise

        self.add_studio(studio)
        username = self.create_account(account, password=password)
        # All three roles, because the person setting a studio up is the person
        # who will also teach in it and be measured by it -- and finding out
        # what a student sees is something an owner should not have to make a
        # second account for.
        for role in (ADMIN, COACH, STUDENT):
            self.put_membership(Membership(username=username, studio=studio.key,
                                           role=role, state=ACTIVE,
                                           decided_by="setup", decided_at=now()))
        self.record_audit(actor=username, action="studio:created",
                          subject=username, studio=studio.key,
                          detail="first admin")
        return username

    def create_account(self, account: "Account", password: str = "") -> str:
        """Make a person who can log in.

        The `people` row comes with it, unconditionally: an account and a body
        of measurements are the same person and splitting them is how a studio
        ends up with a student whose history belongs to nobody.
        """
        from .passwords import hash_password

        if self.account_by_email(account.email):
            raise ValueError(f"{account.email} already has an account")
        self.enrol(account.username, account.display_name)
        self.db.execute(
            "INSERT INTO accounts (username, email, display_name, phone, "
            "password_hash, created_at, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (account.username, account.email, account.display_name,
             account.phone,
             hash_password(password) if password else account.password_hash,
             account.created_at, int(account.active)))
        self.db.commit()
        return account.username

    def _account(self, row) -> "Account | None":
        from .accounts import Account

        if row is None:
            return None
        return Account(email=row["email"], display_name=row["display_name"],
                       phone=row["phone"], password_hash=row["password_hash"],
                       username=row["username"], created_at=row["created_at"],
                       active=bool(row["active"]))

    def account(self, username: str) -> "Account | None":
        return self._account(self.db.execute(
            "SELECT * FROM accounts WHERE username = ?", (username,)).fetchone())

    def account_by_email(self, email: str) -> "Account | None":
        from .accounts import normalise_email

        return self._account(self.db.execute(
            "SELECT * FROM accounts WHERE email = ?",
            (normalise_email(email),)).fetchone())

    def accounts(self) -> list["Account"]:
        return [self._account(r) for r in
                self.db.execute("SELECT * FROM accounts ORDER BY display_name")]

    def set_password(self, username: str, password: str) -> None:
        from .passwords import hash_password

        self.db.execute("UPDATE accounts SET password_hash = ? WHERE username = ?",
                        (hash_password(password), username))
        self.db.commit()

    def set_active(self, username: str, active: bool) -> None:
        """Deactivation, which is not deletion. `forget` is still the only
        thing that erases, and it still takes everything."""
        self.db.execute("UPDATE accounts SET active = ? WHERE username = ?",
                        (int(active), username))
        if not active:
            self.db.execute("DELETE FROM auth_sessions WHERE username = ?",
                            (username,))
        self.db.commit()

    # -- memberships ----------------------------------------------------

    def put_membership(self, membership: "Membership") -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO memberships (username, studio, role, "
            "state, since, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (membership.username, membership.studio, membership.role,
             membership.state, membership.since, membership.decided_by,
             membership.decided_at))
        self.db.commit()

    def _membership(self, row) -> "Membership":
        from .accounts import Membership

        return Membership(username=row["username"], studio=row["studio"],
                          role=row["role"], state=row["state"],
                          since=row["since"], decided_by=row["decided_by"],
                          decided_at=row["decided_at"])

    def memberships(self, username: str = "", studio: str = "",
                    role: str = "", state: str = "") -> list["Membership"]:
        where, args = [], []
        for column, value in (("username", username), ("studio", studio),
                              ("role", role), ("state", state)):
            if value:
                where.append(f"{column} = ?")
                args.append(value)
        sql = "SELECT * FROM memberships"
        if where:
            sql += " WHERE " + " AND ".join(where)
        return [self._membership(r) for r in
                self.db.execute(sql + " ORDER BY studio, role", args)]

    def decide_membership(self, username: str, studio: str, role: str,
                          state: str, by: str) -> None:
        """Approve, suspend or end a role. Always by somebody, always dated."""
        from .accounts import STATES, now

        if state not in STATES:
            raise ValueError(f"{state!r} is not one of {sorted(STATES)}")
        cursor = self.db.execute(
            "UPDATE memberships SET state = ?, decided_by = ?, decided_at = ? "
            "WHERE username = ? AND studio = ? AND role = ?",
            (state, by, now(), username, studio, role))
        if not cursor.rowcount:
            raise KeyError(f"{username} holds no {role} role at {studio}")
        self.db.commit()
        self.record_audit(actor=by, action=f"membership:{state}",
                          subject=username, studio=studio, detail=role)

    # -- profile and screening ------------------------------------------

    def put_profile(self, profile: "Profile") -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO profiles (username, born, height_m, "
            "mass_kg, emergency_name, emergency_phone, goals, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (profile.username, profile.born, profile.height_m, profile.mass_kg,
             profile.emergency_name, profile.emergency_phone, profile.goals,
             profile.updated_at))
        self.db.commit()

    def profile(self, username: str) -> "Profile | None":
        from .accounts import Profile

        row = self.db.execute("SELECT * FROM profiles WHERE username = ?",
                              (username,)).fetchone()
        if row is None:
            return None
        return Profile(username=row["username"], born=row["born"],
                       height_m=row["height_m"], mass_kg=row["mass_kg"],
                       emergency_name=row["emergency_name"],
                       emergency_phone=row["emergency_phone"],
                       goals=row["goals"], updated_at=row["updated_at"])

    def put_screening(self, screening: "Screening") -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO screenings (username, answers, conditions, "
            "medications, injuries, pregnant, cleared_by_physician, "
            "completed_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (screening.username, json.dumps(screening.answers),
             screening.conditions, screening.medications, screening.injuries,
             int(screening.pregnant), int(screening.cleared_by_physician),
             screening.completed_on, screening.updated_at))
        self.db.commit()

    def screening(self, username: str) -> "Screening | None":
        from .accounts import Screening

        row = self.db.execute("SELECT * FROM screenings WHERE username = ?",
                              (username,)).fetchone()
        if row is None:
            return None
        return Screening(username=row["username"],
                         answers=json.loads(row["answers"] or "{}"),
                         conditions=row["conditions"],
                         medications=row["medications"],
                         injuries=row["injuries"],
                         pregnant=bool(row["pregnant"]),
                         cleared_by_physician=bool(row["cleared_by_physician"]),
                         completed_on=row["completed_on"],
                         updated_at=row["updated_at"])

    # -- assignments ----------------------------------------------------

    def put_assignment(self, assignment: "Assignment") -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO assignments (coach, student, studio, "
            "state, scopes, since, until, asked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (assignment.coach, assignment.student, assignment.studio,
             assignment.state, json.dumps(list(assignment.scopes)),
             assignment.since, assignment.until, assignment.asked_by))
        self.db.commit()

    def _assignment(self, row) -> "Assignment":
        from .accounts import Assignment

        return Assignment(coach=row["coach"], student=row["student"],
                          studio=row["studio"], state=row["state"],
                          scopes=tuple(json.loads(row["scopes"] or "[]")),
                          since=row["since"], until=row["until"],
                          asked_by=row["asked_by"])

    def assignments(self, coach: str = "", student: str = "",
                    studio: str = "", live_only: bool = False
                    ) -> list["Assignment"]:
        where, args = [], []
        for column, value in (("coach", coach), ("student", student),
                              ("studio", studio)):
            if value:
                where.append(f"{column} = ?")
                args.append(value)
        if live_only:
            where.append("state = 'active' AND until = ''")
        sql = "SELECT * FROM assignments"
        if where:
            sql += " WHERE " + " AND ".join(where)
        return [self._assignment(r) for r in self.db.execute(sql, args)]

    def assignment_between(self, coach: str, student: str,
                           studio: str = "") -> "Assignment | None":
        """The one row that decides whether a coach may open a record."""
        found = self.assignments(coach=coach, student=student, studio=studio)
        live = [a for a in found if a.live]
        return live[0] if live else (found[0] if found else None)

    def end_assignment(self, coach: str, student: str, studio: str,
                       by: str) -> None:
        """Consent revoked, or a coach moved on. The notes stay -- they are the
        studio's record of care -- but no new measurement is readable."""
        from .accounts import LEFT, today

        self.db.execute(
            "UPDATE assignments SET state = ?, until = ? "
            "WHERE coach = ? AND student = ? AND studio = ?",
            (LEFT, today(), coach, student, studio))
        self.db.commit()
        self.record_audit(actor=by, action="assignment:ended", subject=student,
                          studio=studio, detail=coach)

    # -- evaluations ----------------------------------------------------

    def evaluate(self, evaluation) -> int:
        """Score one class. Returns the row id."""
        cursor = self.db.execute(
            "INSERT INTO evaluations (username, by, scores, notes, did, "
            "settings, cue, plan, effort, session, made_on, made_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (evaluation.username, evaluation.by, json.dumps(evaluation.scores),
             json.dumps(evaluation.notes), evaluation.did, evaluation.settings,
             evaluation.cue, evaluation.plan, evaluation.effort,
             evaluation.session, evaluation.made_on, evaluation.made_at))
        self.db.commit()
        return int(cursor.lastrowid)

    def evaluations(self, username: str = "", limit: int = 400) -> list:
        from .evaluation import Evaluation

        sql = "SELECT * FROM evaluations"
        args: list = []
        if username:
            sql += " WHERE username = ?"
            args.append(username)
        args.append(int(limit))
        return [Evaluation(username=row["username"], by=row["by"],
                           scores=json.loads(row["scores"] or "{}"),
                           notes=json.loads(row["notes"] or "{}"),
                           did=row["did"], settings=row["settings"],
                           cue=row["cue"], plan=row["plan"],
                           effort=row["effort"], session=row["session"],
                           made_on=row["made_on"], made_at=row["made_at"],
                           id=row["id"])
                for row in self.db.execute(
                    sql + " ORDER BY made_on, made_at LIMIT ?", args)]

    # -- the audit log --------------------------------------------------

    def record_audit(self, actor: str, action: str, subject: str = "",
                     studio: str = "", detail: str = "") -> None:
        from .accounts import now

        self.db.execute(
            "INSERT INTO audit (at, actor, action, subject, studio, detail) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (now(), actor, action, subject, studio, detail))
        self.db.commit()

    def audit(self, subject: str = "", actor: str = "",
              limit: int = 200) -> list[dict]:
        where, args = [], []
        if subject:
            where.append("subject = ?")
            args.append(subject)
        if actor:
            where.append("actor = ?")
            args.append(actor)
        sql = "SELECT * FROM audit"
        if where:
            sql += " WHERE " + " AND ".join(where)
        args.append(int(limit))
        return [dict(r) for r in
                self.db.execute(sql + " ORDER BY at DESC, id DESC LIMIT ?", args)]

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
