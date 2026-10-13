"""SEDENS Standard: a small, audited copy of exercise content for the room.

The platform's 199-exercise catalog (``pilates/platform/catalog.json``) and the
anatomy content are read, never edited. SEDENS Standard is a separate file,
``data/sedens_standard/exercises.v1.json``, holding only the exercises that have
been rewritten for self-guided room use: plain customer steps in Korean and
English, one cue, breathing, exercise-specific regressions and progressions, a
plain stop rule, an anatomy mapping by structure name, provenance, and a review
record.

Version 1.0.0 supersedes v0 (``exercises.v0.json``, kept unchanged for history
and readable with :func:`previous`). Every v0 id and its customer text carry
over; v1 adds audited entries and the fields the room's session recommender
reads:

- ``categories`` (mobility, pilates, core, stability, breathing) and ``phases``
  (warm_up, main, cool_down): what an entry trains and where it fits;
- ``dose``: ``mode`` ``reps`` counts repetitions per side per set, each taking
  about ``seconds_per_rep`` seconds (3-8); ``mode`` ``hold`` is one hold of
  ``hold_seconds`` per side per set (``reps`` 0, ``seconds_per_rep`` null).
  ``sides`` ``each_side`` and ``alternate`` both mean the work is done on the
  left and on the right;
- ``effort`` (light, moderate) and ``body_focus``;
- ``easier`` / ``harder``: another entry of the same movement family, linked
  both ways, or null. The room offers no other easier/harder option;
- ``narration`` (two or three short spoken cues), ``setup`` (the starting
  position shown before the exercise), ``media`` (repository assets that show
  this very exercise) and ``scan_tags``.

Review statuses are ``unreviewed``, ``sedens_reviewed`` and ``expert_reviewed``.
Every entry starts ``unreviewed``; a status changes only with the reviewer,
date, evidence and scope that prove it. No entry carries an expert's name
without that evidence. The file's ``policy`` says which statuses a
demonstration room and a production room may recommend.
"""

from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path

from . import atlas

DATA = Path(__file__).resolve().parents[2] / "data"
FILE = DATA / "sedens_standard" / "exercises.v1.json"
HISTORY = {"v0": DATA / "sedens_standard" / "exercises.v0.json"}
CONTENT_SOURCES = DATA / "content_sources.json"
CATALOG = Path(__file__).resolve().parent.parent / "platform" / "catalog.json"
REVIEW_STATUSES = ("unreviewed", "sedens_reviewed", "expert_reviewed")
LEVELS = ("foundation", "intermediate", "advanced")
CATEGORIES = ("mobility", "pilates", "core", "stability", "breathing")
PHASES = ("warm_up", "main", "cool_down")
EFFORTS = ("light", "moderate")
BODY_FOCUS = ("spine", "hips", "shoulders", "core", "legs", "breathing", "full_body")
SCAN_TAGS = ("shoulder_mobility",)
ROLES = ("focus", "prime", "assisting", "steadying")
POSITIONS = ("supine", "side-lying", "prone", "quadruped", "kneeling", "seated", "standing")
EQUIPMENT = ("mat",)
DOSE_MODES = ("reps", "hold")
SIDES = ("none", "each_side", "alternate")
NARRATION_MAX = 70
ENTRIES = (8, 40)


@lru_cache(maxsize=1)
def document() -> dict:
    return json.loads(FILE.read_text())


def previous(version: str = "v0") -> dict:
    """A superseded Standard file, read-only history (for example, what a v0 course was built from)."""
    return json.loads(HISTORY[version].read_text())


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


@lru_cache(maxsize=1)
def content_assets() -> dict:
    """Repository media assets by id (``data/content_sources.json``)."""
    return {a["id"]: a for a in json.loads(CONTENT_SOURCES.read_text())["assets"]}


def label() -> dict:
    return document()["label"]


def policy_allows(entry: dict, demo: bool) -> bool:
    """Whether the file's review policy lets a demonstration (or production) room recommend ``entry``."""
    policy = document()["policy"]
    return entry["review"]["status"] in policy["demo_allowed_statuses" if demo else "production_allowed_statuses"]


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


def _bilingual(value) -> bool:
    return isinstance(value, dict) and all(isinstance(value.get(k), str) and value[k].strip() for k in ("en", "ko"))


def _choices(value, allowed, empty_ok=False) -> bool:
    return (isinstance(value, list) and (empty_ok or bool(value)) and len(set(value)) == len(value)
            and all(v in allowed for v in value))


def _int(value, low, high) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _dose_problems(entry: dict) -> list[str]:
    where, dose, found = entry.get("id", "?"), entry.get("dose"), []
    if not isinstance(dose, dict) or dose.get("mode") not in DOSE_MODES or dose.get("sides") not in SIDES:
        return [f"{where}: dose needs a mode ({', '.join(DOSE_MODES)}) and sides ({', '.join(SIDES)})"]
    if not (_int(dose.get("sets"), 1, 5) and _int(dose.get("rest_seconds"), 0, 120)
            and _int(dose.get("work_seconds"), 0, 0)):
        found.append(f"{where}: dose needs 1-5 sets, 0-120 s rest and no work time")
    spr = entry.get("seconds_per_rep")
    if dose["mode"] == "reps":
        if not (_int(dose.get("reps"), 1, 30) and dose.get("hold_seconds") == 0):
            found.append(f"{where}: a repetition dose needs 1-30 reps and no hold")
        if not _int(spr, 3, 8):
            found.append(f"{where}: seconds_per_rep must be a whole number from 3 to 8")
    else:
        if not (_int(dose.get("hold_seconds"), 5, 120) and dose.get("reps") == 0):
            found.append(f"{where}: a hold dose needs a 5-120 s hold and no reps")
        if spr is not None:
            found.append(f"{where}: seconds_per_rep must be null for a hold")
    return found


def _recommender_problems(entry: dict, ids: set, assets: dict) -> list[str]:
    """The fields the session recommender reads (added in v1)."""
    where, found = entry.get("id", "?"), []
    for field, allowed, empty_ok in (("categories", CATEGORIES, False), ("phases", PHASES, False),
                                     ("body_focus", BODY_FOCUS, False), ("scan_tags", SCAN_TAGS, True)):
        if not _choices(entry.get(field), allowed, empty_ok):
            found.append(f"{where}: {field} must be a list of distinct values from {', '.join(allowed)}"
                         + ("" if empty_ok else " (at least one)"))
    if entry.get("effort") not in EFFORTS:
        found.append(f"{where}: effort must be one of {', '.join(EFFORTS)}")
    if entry.get("position") not in POSITIONS:
        found.append(f"{where}: unknown position")
    if not _choices(entry.get("equipment"), EQUIPMENT, empty_ok=True):
        found.append(f"{where}: only mat or no equipment belongs in the Standard")
    found.extend(_dose_problems(entry))
    for field in ("easier", "harder"):
        other = entry.get(field)
        if other is None:
            continue
        if not isinstance(other, str) or other not in ids:
            found.append(f"{where}: {field} names an exercise that is not in the Standard")
        elif other == entry.get("id"):
            found.append(f"{where}: {field} cannot be the exercise itself")
    if entry.get("easier") is not None and entry.get("easier") == entry.get("harder"):
        found.append(f"{where}: easier and harder cannot be the same exercise")
    narration = entry.get("narration")
    if not (isinstance(narration, list) and 2 <= len(narration) <= 3 and all(_bilingual(n) for n in narration)):
        found.append(f"{where}: narration needs two or three cues in Korean and English")
    elif any(len(n[lang]) > NARRATION_MAX for n in narration for lang in ("en", "ko")):
        found.append(f"{where}: each narration cue must be at most {NARRATION_MAX} characters")
    if not _bilingual(entry.get("setup")):
        found.append(f"{where}: setup needs Korean and English")
    media = entry.get("media")
    if not isinstance(media, list):
        found.append(f"{where}: media must be a list")
    else:
        for asset_id in media:
            asset = assets.get(asset_id) if isinstance(asset_id, str) else None
            if asset is None:
                found.append(f"{where}: media {asset_id} is not a repository asset")
            elif asset.get("shows") != entry.get("catalog_key"):
                found.append(f"{where}: media {asset_id} shows a different exercise")
    return found


def _graph_problems(entries: list[dict]) -> list[str]:
    """Easier/harder links are reciprocal and never loop."""
    found, by_id = [], {e.get("id"): e for e in entries}
    for entry in entries:
        for field, back in (("easier", "harder"), ("harder", "easier")):
            other = by_id.get(entry.get(field))
            if other is not None and other.get(back) != entry.get("id"):
                found.append(f"{entry.get('id')}: {field} {other.get('id')} must name it back as {back}")
        seen, step = {entry.get("id")}, by_id.get(entry.get("harder"))
        while step is not None:
            if step.get("id") in seen:
                found.append(f"{entry.get('id')}: harder links loop")
                break
            seen.add(step.get("id"))
            step = by_id.get(step.get("harder"))
    return found


def problems() -> list[str]:
    """Integrity checks the test suite runs on the file (empty when sound)."""
    found = []
    doc = document()
    keys = catalog()
    assets = content_assets()
    if doc.get("catalog_sha256") != catalog_digest():
        found.append("catalog.json changed since the Standard was drafted; re-check every entry")
    entries = doc.get("exercises") or []
    if not ENTRIES[0] <= len(entries) <= ENTRIES[1]:
        found.append(f"the Standard holds {len(entries)} exercises; keep it between {ENTRIES[0]} and {ENTRIES[1]}")
    policy = doc.get("policy") or {}
    demo, production = policy.get("demo_allowed_statuses"), policy.get("production_allowed_statuses")
    if not _choices(demo, REVIEW_STATUSES):
        found.append("policy: demo_allowed_statuses must list review statuses")
    if not _choices(production, tuple(s for s in REVIEW_STATUSES if s != "unreviewed")):
        found.append("policy: production may only recommend reviewed content")
    ids = {e.get("id") for e in entries}
    for version in [doc["supersedes"]] if doc.get("supersedes") in HISTORY else []:
        lost = [e["id"] for e in previous(version)["exercises"] if e["id"] not in ids]
        if lost:
            found.append(f"ids from {version} are missing (courses may point at them): {', '.join(lost)}")
    seen = set()
    for entry in entries:
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
        if any(s.get("role") not in ROLES for s in entry["anatomy"]["structures"]):
            found.append(f"{where}: anatomy roles must be one of {', '.join(ROLES)}")
        if entry["anatomy"]["exercise"] != entry["catalog_key"]:
            found.append(f"{where}: anatomy clip must be the exercise's own")
        found.extend(_recommender_problems(entry, ids, assets))
    found.extend(_graph_problems(entries))
    return found
