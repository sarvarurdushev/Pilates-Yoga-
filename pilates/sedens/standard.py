"""SEDENS Standard: a small, audited copy of exercise content for the room.

The platform's 199-exercise catalog (``pilates/platform/catalog.json``) and the
anatomy content are read, never edited. SEDENS Standard is a separate file,
``data/sedens_standard/exercises.v0.json``, holding only the exercises that have
been rewritten for self-guided room use: plain customer steps in Korean and
English, one cue, breathing, exercise-specific regressions and progressions, a
plain stop rule, an anatomy mapping by structure name, provenance, and a review
record.

Review statuses are ``unreviewed``, ``sedens_reviewed`` and ``expert_reviewed``.
Every entry starts ``unreviewed``; a status changes only with the reviewer,
date, evidence and scope that prove it. No entry carries an expert's name
without that evidence.
"""

from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path

from . import atlas

FILE = Path(__file__).resolve().parents[2] / "data" / "sedens_standard" / "exercises.v0.json"
CATALOG = Path(__file__).resolve().parent.parent / "platform" / "catalog.json"
REVIEW_STATUSES = ("unreviewed", "sedens_reviewed", "expert_reviewed")
LEVELS = ("foundation", "intermediate", "advanced")


@lru_cache(maxsize=1)
def document() -> dict:
    return json.loads(FILE.read_text())


def exercises() -> list[dict]:
    return document()["exercises"]


@lru_cache(maxsize=1)
def _by_id() -> dict:
    return {e["id"]: e for e in exercises()}


def get(exercise_id: str) -> dict | None:
    return _by_id().get(exercise_id)


@lru_cache(maxsize=1)
def catalog() -> dict:
    return {e["key"]: e for e in json.loads(CATALOG.read_text())}


def catalog_digest() -> str:
    return hashlib.sha256(CATALOG.read_bytes()).hexdigest()


def label() -> dict:
    return document()["label"]


def summary(entry: dict) -> dict:
    """What a creator or customer list shows for one Standard exercise."""
    return {
        "id": entry["id"],
        "source": "sedens_standard",
        "title": entry["title"],
        "level": entry["level"],
        "position": entry["position"],
        "equipment": entry["equipment"],
        "dose": entry["dose"],
        "anatomy_exercise": entry["anatomy"]["exercise"],
        "review": entry["review"],
    }


def problems() -> list[str]:
    """Integrity checks the test suite runs on the file (empty when sound)."""
    found = []
    doc = document()
    keys = catalog()
    if doc.get("catalog_sha256") != catalog_digest():
        found.append("catalog.json changed since the Standard was drafted; re-check every entry")
    seen = set()
    for entry in doc["exercises"]:
        where = entry.get("id", "?")
        if entry["id"] in seen:
            found.append(f"{where}: duplicate id")
        seen.add(entry["id"])
        if entry["catalog_key"] not in keys:
            found.append(f"{where}: catalog key {entry['catalog_key']} is gone")
        if entry["level"] not in LEVELS:
            found.append(f"{where}: unknown level")
        review = entry["review"]
        if review["status"] not in REVIEW_STATUSES:
            found.append(f"{where}: unknown review status")
        if review["status"] != "unreviewed" and not (review.get("reviewer") and review.get("reviewed_at")
                                                      and review.get("evidence") and review.get("scope")):
            found.append(f"{where}: a review status needs reviewer, date, evidence and scope")
        for field in ("title", "cue", "breath", "stop_if"):
            if not (entry[field].get("en") and entry[field].get("ko")):
                found.append(f"{where}: {field} needs Korean and English")
        if not entry["steps"] or any(not (s.get("en") and s.get("ko")) for s in entry["steps"]):
            found.append(f"{where}: steps need Korean and English")
        try:
            atlas.validate([s["key"] for s in entry["anatomy"]["structures"]], entry["anatomy"]["atlas_depth"])
        except Exception as exc:  # noqa: BLE001 - reported, not raised
            found.append(f"{where}: {exc}")
        if entry["anatomy"]["exercise"] != entry["catalog_key"]:
            found.append(f"{where}: anatomy clip must be the exercise's own")
    return found
