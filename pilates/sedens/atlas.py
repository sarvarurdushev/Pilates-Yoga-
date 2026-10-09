"""The anatomy registry, read on the server so course content can be validated.

The browser builds its registry from ``web/src/generated/structures.json``
(``buildRegistry`` in ``web/src/structures.js``). This module reads the same
file with the same rules, so a creator can only save structures the viewer can
draw. Identity is the registry **key** (a structure name such as
``"rectus abdominis"``, ``"left scapula (4.0)"`` or ``"brain:7"``): numeric ids
are renumbered whenever the atlas is rebuilt, and FMA ids are shared by many
structures, so neither is stored in course content.

Six muscles are drawn as named parts (for example the three parts of the
trapezius). As in the browser, the whole muscle answers to its own name as an
*aggregate* over its parts.

The file lives under ``web/`` and is not package data; if it is missing,
validation fails closed rather than accepting unknown names.
"""

from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re

from .util import Denied

STRUCTURES = Path(__file__).resolve().parents[2] / "web" / "src" / "generated" / "structures.json"
# Hand-assigned brain regions (REGION_INFO in web/src/regionData.js).
BRAIN_REGIONS = tuple(range(1, 16)) + tuple(range(20, 26))
PART_OF = re.compile(r"^.*?\b(?:part|head|belly|portion)\s+of\s+(.+)$", re.IGNORECASE)
TAUGHT_LAYERS = frozenset({"skeleton", "muscles_superficial", "muscles_deep", "organs"})
COMPLETE_LAYERS = frozenset({"bones_full", "muscles_full", "organs_full"})
DEPTHS = ("taught", "complete")
MAX_STRUCTURES = 40


def whole_muscle(name: str) -> str | None:
    match = PART_OF.match(str(name or ""))
    return match.group(1).strip() if match else None


@lru_cache(maxsize=1)
def registry() -> dict:
    """``{"hash": str, "structures": {key: record}}``. Raises Denied if the atlas is missing."""
    try:
        raw = STRUCTURES.read_bytes()
    except OSError as exc:
        raise Denied("The anatomy atlas is not available on this server.", 503, "atlas_unavailable") from exc
    generated = json.loads(raw)
    found: dict[str, dict] = {}
    for region in BRAIN_REGIONS:
        found[f"brain:{region}"] = {"key": f"brain:{region}", "name": f"brain:{region}", "layer": "brain",
                                    "set": "brain", "parts": None}
    for row in generated["structures"]:
        key = row.get("key") or row["name"]
        found[key] = {
            "key": key,
            "name": row["name"],
            "layer": row["layer"],
            "set": "complete" if row.get("key") and row["key"] != row["name"] else "taught",
            "parts": None,
            "id": row["id"],
        }
    parts: dict[str, list] = {}
    for record in list(found.values()):
        whole = whole_muscle(record["key"])
        if whole:
            parts.setdefault(whole, []).append(record)
    for whole, members in parts.items():
        if whole in found or len(members) < 2:
            continue
        found[whole] = {
            "key": whole,
            "name": whole,
            "layer": members[0]["layer"],
            "set": members[0]["set"],
            "parts": sorted(m["key"] for m in members),
        }
    return {"hash": hashlib.sha256(raw).hexdigest()[:16], "structures": found}


def atlas_hash() -> str:
    return registry()["hash"]


def get(key: str) -> dict | None:
    return registry()["structures"].get(key)


def depth_of(record: dict) -> str | None:
    """Which atlas a structure needs, or None when it is drawn in both."""
    if record["layer"] in COMPLETE_LAYERS:
        return "complete"
    if record["layer"] in TAUGHT_LAYERS:
        return "taught"
    return None


def validate(keys, depth: str = "taught", limit: int = MAX_STRUCTURES) -> list[str]:
    """Return the keys, de-duplicated in order, or raise Denied naming the bad ones."""
    if depth not in DEPTHS:
        raise Denied("Choose the taught body or the complete atlas.", 400, "invalid_atlas_depth")
    if not isinstance(keys, (list, tuple)):
        raise Denied("Choose body structures from the anatomy list.", 400, "invalid_structures")
    clean: list[str] = []
    for key in keys:
        if not isinstance(key, str) or not key.strip():
            raise Denied("Choose body structures from the anatomy list.", 400, "invalid_structures")
        if key not in clean:
            clean.append(key)
    if len(clean) > limit:
        raise Denied(f"Choose at most {limit} body structures.", 400, "too_many_structures")
    structures = registry()["structures"]
    unknown = [k for k in clean if k not in structures]
    if unknown:
        raise Denied("These body structures are not in the anatomy atlas: " + ", ".join(unknown[:10]),
                     400, "unknown_structures")
    wrong = [k for k in clean if depth_of(structures[k]) not in (None, depth)]
    if wrong:
        raise Denied("These structures belong to the other atlas view: " + ", ".join(wrong[:10]),
                     400, "mixed_atlas")
    return clean


def exercise_structures(muscles: str) -> list[str]:
    """Structure keys named by a catalog entry's comma-separated ``muscles`` text."""
    out: list[str] = []
    structures = registry()["structures"]
    for name in str(muscles or "").split(","):
        name = name.strip()
        if name and name in structures and name not in out:
            out.append(name)
    return out
