"""Removing demonstrations nobody uses any more.

Free hosting gives every visitor their own demonstration: the coaching
workspace's sample organization ``demo-<key>`` (about 76 MB, almost all of it
sample analyses) plus the marketplace's ``demo-<key>-sedens`` and
``demo-<key>-professor``. Nothing removed them while the server ran.

* **Tracking.** ``s_demo_activity`` records, per demonstration key, when it was
  created and last used. Every signed-in request of a demonstration account
  passes through :meth:`Repository.actor`, which calls :func:`touch`; it writes
  at most once every ``TOUCH_EVERY`` seconds per key, so it costs nothing
  noticeable.
* **Expiry.** A demonstration expires when it has not been used for
  ``SEDENS_DEMO_TTL_HOURS`` (default 6 in ``demo_free``; in ``local_room`` only
  when the variable is set; ``0`` switches cleanup off).
* **Safety.** Only organizations that are flagged ``demo`` **and** are named
  ``demo-<32 hex>`` (optionally ``-sedens`` / ``-professor``) are ever
  considered, and both are checked again inside the deleting transaction. A
  demonstration is kept while any of its room sessions is active, any of its
  analysis jobs is queued or running, or any course upload or import is being
  received. Any refusal by the database rolls the whole demonstration back.
* **When.** Once when the server starts, then at most every ``SWEEP_EVERY``
  seconds, triggered by demonstration use itself and run once in a short-lived
  thread (no permanent background thread). At most ``MAX_PER_SWEEP``
  demonstrations are removed per sweep, so a sweep stays short.
* **Logging.** Each removal logs the demonstration key and the approximate
  records, files and bytes reclaimed — never names or any other content.
"""

from __future__ import annotations

from datetime import timedelta
import logging
import os
from pathlib import Path
import re
import shutil
import threading
import time

from .util import now, parse, utcnow

log = logging.getLogger("sedens.demo_cleanup")

KEY = re.compile(r"^demo-([0-9a-f]{32})(?:-sedens|-professor)?$")
SUFFIXES = ("", "-sedens", "-professor")
DEFAULT_TTL_HOURS = 6.0
TOUCH_EVERY = 300
SWEEP_EVERY = 900
MAX_PER_SWEEP = 3

_touched: dict[str, float] = {}
_touch_lock = threading.Lock()
_sweep_lock = threading.Lock()
_last_sweep = [0.0]


def key_of(org_id) -> str | None:
    found = KEY.match(str(org_id or ""))
    return found.group(1) if found else None


def ttl_hours(mode_name: str, env=None) -> float | None:
    """Hours of disuse after which a demonstration is removed, or None (off)."""
    env = os.environ if env is None else env
    raw = env.get("SEDENS_DEMO_TTL_HOURS")
    if raw is None or not str(raw).strip():
        return DEFAULT_TTL_HOURS if mode_name == "demo_free" else None
    try:
        value = float(raw)
    except ValueError:
        log.warning("SEDENS_DEMO_TTL_HOURS=%r is not a number; demonstration cleanup is off", raw)
        return None
    if value <= 0:
        return None
    return max(value, 1.0)  # never sooner than an hour of disuse


def touch(sedens, org_id, *, force=False) -> None:
    """Record that a demonstration was used (throttled per key)."""
    key = key_of(org_id)
    if key is None:
        return
    current = time.monotonic()
    with _touch_lock:
        if not force and current - _touched.get(key, -TOUCH_EVERY * 2) < TOUCH_EVERY:
            return
        _touched[key] = current
    stamp = now()
    with sedens.db() as db:
        db.execute("INSERT INTO s_demo_activity(demo_key,created_at,last_used_at) VALUES (?,?,?) "
                   "ON CONFLICT(demo_key) DO UPDATE SET last_used_at=excluded.last_used_at", (key, stamp, stamp))
    maybe_sweep(sedens)


def _orgs(db, key) -> list[str]:
    """This demonstration's organizations: flagged demo AND named demo-<key>[...]."""
    names = ["demo-" + key + s for s in SUFFIXES]
    marks = ",".join("?" * len(names))
    return [r[0] for r in db.execute(f"SELECT id FROM p_organizations WHERE demo=1 AND id IN ({marks})", names)
            if key_of(r[0]) == key]


def expired(db, ttl: float, at=None) -> list[str]:
    """Demonstration keys unused for longer than ``ttl`` hours, oldest first."""
    cutoff = (at or utcnow()) - timedelta(hours=ttl)
    last: dict[str, object] = {}
    for org_id, created in db.execute("SELECT id, created_at FROM p_organizations WHERE demo=1 AND id GLOB 'demo-*'"):
        key = key_of(org_id)
        when = parse(created)
        if key and when is not None and (key not in last or when > last[key]):
            last[key] = when
    for key, used in db.execute("SELECT demo_key, last_used_at FROM s_demo_activity"):
        when = parse(used)
        if key in last and when is not None and when > last[key]:
            last[key] = when
    return [k for k, when in sorted(last.items(), key=lambda kv: kv[1]) if when < cutoff]


def busy(db, orgs) -> str | None:
    """Why this demonstration must be kept for now, or None."""
    from . import media_store

    if not orgs:
        return "gone"
    marks = ",".join("?" * len(orgs))
    if db.execute(f"SELECT 1 FROM s_room_sessions WHERE org_id IN ({marks}) AND state='active' AND expires_at>?",
                  (*orgs, now())).fetchone():
        return "room_session_active"
    if db.execute(f"SELECT 1 FROM p_jobs WHERE org_id IN ({marks}) AND state IN ('queued','running')", orgs).fetchone():
        return "analysis_running"
    if media_store.uploads_running():
        return "upload_running"
    return None


def remove(sedens, key) -> dict:
    """Delete one demonstration and its files. Returns what was reclaimed."""
    from . import media_store

    report = {"key": key, "removed": False}
    with sedens.batch(), sedens.db() as db:
        orgs = _orgs(db, key)
        reason = busy(db, orgs)
        if reason:
            report["kept"] = reason
            return report
        marks = ",".join("?" * len(orgs))
        # Re-check inside the transaction: never anything but a flagged, named demonstration.
        flags = db.execute(f"SELECT id, demo FROM p_organizations WHERE id IN ({marks})", orgs).fetchall()
        if any(not r["demo"] or key_of(r["id"]) != key for r in flags):
            report["kept"] = "not_a_demonstration"
            return report
        records = sum(db.execute(f"SELECT count(*) FROM {table} WHERE org_id IN ({marks})", orgs).fetchone()[0]
                      for table in _org_tables(db))
        files = [Path(r[0]) for r in db.execute(f"SELECT path FROM p_media WHERE org_id IN ({marks})", orgs)]
        free_before = db.execute("PRAGMA freelist_count").fetchone()[0]
        # Two platform links are ON DELETE RESTRICT: a demonstration's own program rows go first.
        programs = f"SELECT id FROM p_programs WHERE org_id IN ({marks})"
        sessions = (f"SELECT t.id FROM p_training_sessions t JOIN p_users u ON u.id=t.student_id "
                    f"WHERE u.org_id IN ({marks})")
        db.execute(f"DELETE FROM p_training_session_program_versions WHERE program_id IN ({programs}) "
                   f"AND session_id IN ({sessions})", (*orgs, *orgs))
        db.execute(f"DELETE FROM p_program_exercises WHERE program_id IN ({programs})", orgs)
        db.execute(f"DELETE FROM p_organizations WHERE id IN ({marks}) AND demo=1", orgs)
        db.execute("DELETE FROM s_demo_activity WHERE demo_key=?", (key,))
        page = db.execute("PRAGMA page_size").fetchone()[0]
        freed = (db.execute("PRAGMA freelist_count").fetchone()[0] - free_before) * page
    # Files go only after the rows are gone, and only from inside this server's own folders.
    media_root = Path(sedens.repo.media_root).resolve()
    removed_files = 0
    for path in files:
        try:
            resolved = path.resolve()
            if resolved.is_relative_to(media_root) and resolved.is_file():
                resolved.unlink()
                removed_files += 1
        except OSError:
            pass
    objects = (media_store.root(sedens.repo) / "objects").resolve()
    for org in orgs:
        folder = (objects / org).resolve()
        if folder.is_relative_to(objects) and folder != objects and folder.is_dir():
            removed_files += sum(1 for p in folder.rglob("*") if p.is_file())
            shutil.rmtree(folder, ignore_errors=True)
    with _touch_lock:
        _touched.pop(key, None)
    report.update(removed=True, organizations=len(orgs), records=records, files=removed_files,
                  bytes=max(freed, 0))
    log.warning("SEDENS demo cleanup: removed demonstration %s (%d organizations, about %d records, %d files, "
                "about %.1f MB of database pages)", key, len(orgs), records, removed_files, max(freed, 0) / 1e6)
    return report


def _org_tables(db) -> list[str]:
    tables = []
    for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'p_*' OR name GLOB 's_*')"):
        if any(col[1] == "org_id" for col in db.execute(f"PRAGMA table_info({name})")):
            tables.append(name)
    return tables


def sweep(sedens, *, ttl=None, at=None, limit=MAX_PER_SWEEP) -> list[dict]:
    """Remove up to ``limit`` expired demonstrations. Safe to call at any time."""
    ttl = ttl if ttl is not None else ttl_hours(sedens.mode.name)
    if ttl is None:
        return []
    if not _sweep_lock.acquire(blocking=False):
        return []
    try:
        with sedens.db() as db:
            keys = expired(db, ttl, at)
        reports = []
        for key in keys[:limit]:
            try:
                reports.append(remove(sedens, key))
            except Exception:  # a refusal by the database keeps the demonstration
                log.exception("SEDENS demo cleanup: kept demonstration %s after an error", key)
                reports.append({"key": key, "removed": False, "kept": "error"})
        return reports
    finally:
        _sweep_lock.release()


def maybe_sweep(sedens) -> bool:
    """Start a sweep in a short-lived thread if none ran recently. Returns True if started."""
    if ttl_hours(sedens.mode.name) is None:
        return False
    current = time.monotonic()
    with _touch_lock:
        if current - _last_sweep[0] < SWEEP_EVERY:
            return False
        _last_sweep[0] = current
    threading.Thread(target=_sweep_quietly, args=(sedens,), name="sedens-demo-cleanup", daemon=True).start()
    return True


def _sweep_quietly(sedens):
    try:
        sweep(sedens)
    except Exception:
        log.exception("SEDENS demo cleanup failed")
