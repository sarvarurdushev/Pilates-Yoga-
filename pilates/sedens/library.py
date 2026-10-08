"""The exercise library as the room engine sees it in Phase 1.

Until the audited SEDENS Standard library exists (Phase 5), the room reads the
existing platform catalog *read-only* and labels every entry ``unreviewed``.
No entry claims expert or professor review: a review is recorded only with the
reviewer, date, evidence/version and scope that prove it.

Inside an authorized room the full list is available (:func:`room_library`).
Outside a room only aggregate counts are (:func:`preview`), so the exercise
engine cannot be used as a home-workout library.
"""

from __future__ import annotations

from collections import Counter
from functools import lru_cache
import json
from pathlib import Path

CATALOG = Path(__file__).resolve().parent.parent / "platform" / "catalog.json"
LIBRARY_VERSION = "platform-catalog-readonly-phase1"
REVIEW_STATUSES = ("unreviewed", "sedens_reviewed", "expert_reviewed")


def unreviewed() -> dict:
    return {"status": "unreviewed", "reviewer": None, "reviewed_at": None, "evidence": None, "scope": None}


@lru_cache(maxsize=1)
def _catalog():
    return json.loads(CATALOG.read_text())


def room_library() -> dict:
    items = []
    for entry in _catalog():
        detail = entry.get("detail", {})
        items.append({
            "id": entry["key"],
            "title": entry["name"],
            "category": entry["category"],
            "level": entry["difficulty"],
            "equipment": entry["equipment"],
            "duration_s": detail.get("duration"),
            "reps": detail.get("reps"),
            "anatomy_exercise": detail.get("atlas_exercise"),
            "review": unreviewed(),
        })
    return {
        "library_version": LIBRARY_VERSION,
        "notice": "Exercise content not yet reviewed for SEDENS Standard.",
        "items": items,
    }


def preview() -> dict:
    catalog = _catalog()
    return {
        "library_version": LIBRARY_VERSION,
        "total": len(catalog),
        "by_category": dict(Counter(e["category"] for e in catalog)),
        "by_equipment": dict(Counter(e["equipment"] for e in catalog)),
        "available_in": "an authorized SEDENS room",
    }
