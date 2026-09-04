"""One session, as one file, for an anatomy viewer to read.

The boundary object between this system and the 3D model. Everything left of
it stays Python; everything right of it stays a static site with no build step.
A viewer with no bundle is the anatomy app on its own; a viewer with one is
that app plus a person.

The bundle is also the export a student is handed when they ask what is held
about them, which is not a coincidence -- if a file is fit to drive a rendering
of somebody's body, it is the file that describes them.

**The tier is the load-bearing field.** Every value carries one, and the
validator refuses a bundle where any value does not. A structure may only be
``measured`` if a measurement of this person produced it; everything else --
the bones a measured joint articulates, the nerves supplying a measured muscle
-- is ``reference``, which means "this is where to look", not "this was
observed". Each entry also carries the sentence a viewer may print, so the
wording cannot get stronger on the far side of the boundary.
"""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from pathlib import Path

from .archive import encode as encode_poses
from .bridge import (MEASURED, REFERENCE, bones_for_joint, meshes_for_group,
                     nerves_for_group)
from .scoring import score_from_store
from .store import Store
from .wording import quantity

FORMAT = "pilates-session-bundle"
VERSION = 1
POSE_ENCODING = "pilates-pose-stream-v1"

TIERS = (MEASURED, REFERENCE)


class InvalidBundle(ValueError):
    """A bundle that must not be shipped, and the reason."""


@dataclass
class Value:
    """One thing said about one person, with where it came from attached."""

    tier: str
    because: str
    value: float | None = None
    unit: str = ""
    source: str = ""

    def to_dict(self) -> dict:
        out = {"tier": self.tier, "because": self.because}
        if self.value is not None:
            out["value"] = round(self.value, 3)
            out["unit"] = self.unit
        if self.source:
            out["source"] = self.source
        return out


def _quantities(store: Store, username: str, session: str) -> list[dict]:
    """Every measured quantity, in both registers, with its validity."""
    session_id = store.session_id(session)
    rows = store.db.execute(
        "SELECT m.* FROM measurements m JOIN links l "
        "ON l.session_id = m.session_id AND l.track_id = m.track_id "
        "WHERE l.username = ? AND l.status = 'confirmed' AND m.session_id = ? "
        "ORDER BY m.subject", (username, session_id))
    out = []
    for row in rows:
        said = quantity(row["subject"])
        out.append({
            "name": row["subject"],
            "plain": said.plain,
            "technical": said.technical,
            "tier": MEASURED,
            "because": f"measured from this session's video over "
                       f"{row['samples']} frames",
            "value": round(row["value"], 3),
            "spread": round(row["spread"], 3),
            "samples": row["samples"],
            "unit": row["unit"],
            "source": row["source"],
            "valid": bool(row["valid"]),
            "invalid_reason": row["invalid_reason"],
        })
    return out


def _structures(quantities: list[dict]) -> list[dict]:
    """Which meshes to light, at which tier, and the sentence for each.

    Only a peak-moment quantity produces a ``measured`` structure: a joint
    angle says where a limb was, not what a muscle did, and lighting a muscle
    from it would be a claim the measurement does not make.
    """
    out: dict[str, dict] = {}

    def add(mesh, tier: str, because: str, value=None, unit="", origin=""):
        key = mesh.fma or f"name:{mesh.name}"
        existing = out.get(key)
        # A measured entry always wins over a reference one for the same mesh:
        # a muscle that was measured should not be downgraded because it also
        # happens to sit beside a measured joint.
        if existing and (existing["tier"] == MEASURED or tier != MEASURED):
            return
        out[key] = {
            "fma": mesh.fma, "name": mesh.name, "layer": mesh.layer,
            "tier": tier, "because": because,
            **({"value": round(value, 3), "unit": unit} if value is not None else {}),
            **({"from": origin} if origin else {}),
        }

    for item in quantities:
        name = item["name"]
        if name.endswith(" peak moment") and item["valid"]:
            group = name[: -len(" peak moment")]
            for mesh in meshes_for_group(group):
                add(mesh, MEASURED,
                    f"the {group} carried {item['value']:.0f} Nm in this "
                    f"session, and this is one of them",
                    value=item["value"], unit="Nm", origin=name)
            for mesh in nerves_for_group(group):
                add(mesh, REFERENCE,
                    f"supplies a muscle that was measured here. Nothing in "
                    f"this recording observed a nerve.", origin=name)
        elif name.startswith(("left_", "right_")):
            joint = name
            for mesh in bones_for_joint(joint):
                add(mesh, REFERENCE,
                    f"articulates the {joint.replace('_', ' ')}, which was "
                    f"measured. No load on this bone was estimated.",
                    origin=name)
    return sorted(out.values(), key=lambda s: (s["layer"], s["name"]))


def build(
    store: Store,
    username: str,
    session: str,
    include_poses: bool = True,
) -> dict:
    """Assemble one person's session as a bundle.

    ``include_poses`` carries the frame-by-frame stream, which is what lets a
    viewer scrub a session after the video is gone. It is most of the file's
    size, so a bundle meant only for a summary can leave it out.
    """
    people = {p["username"]: p for p in store.people()}
    if username not in people:
        raise InvalidBundle(f"{username!r} is not enrolled")
    session_row = next((s for s in store.sessions() if s["key"] == session), None)
    if session_row is None:
        raise InvalidBundle(f"no session recorded under {session!r}")

    quantities = _quantities(store, username, session)
    score = score_from_store(store, username, session)
    manifest = store.manifest(session) or {}

    bundle = {
        "format": FORMAT,
        "version": VERSION,
        "person": {
            "username": username,
            "display_name": people[username]["display_name"],
        },
        "session": {
            "key": session, "date": session_row["date"],
            "studio": session_row["studio"],
            "duration_s": session_row["duration_s"],
            "video": session_row["video"],
        },
        "produced_by": {
            "version": manifest.get("version", ""),
            "source_fps": manifest.get("source_fps", 0.0),
            "stride": manifest.get("stride", 1),
            "config": manifest.get("config", {}),
        },
        "score": {
            "value": None if score.value is None else round(score.value, 1),
            "withheld_reason": score.withheld_reason,
            "checks": score.checks,
            "measured": score.measured,
            "measurable": score.measurable,
            "coverage": round(score.coverage, 3),
            "components": [
                {"name": c.name, "score": round(c.score, 1), "checks": c.n}
                for c in score.components.values() if c.score is not None
            ],
            "missing": sorted(score.missing),
        },
        "quantities": quantities,
        "structures": _structures(quantities),
        "events": [],
        "notice": (
            "Every value carries a tier. 'measured' came from this person's "
            "video in this session. 'reference' is anatomy: it says where to "
            "look, not what was observed. Nothing here measured a nerve, a "
            "bone's load, or anything about a brain."
        ),
    }

    # Driven by the confirmed link, not by what happens to be archived: a
    # session with events but no pose stream was losing its events entirely.
    for link in store.links(session=session, status="confirmed"):
        if link.username != username:
            continue
        bundle["events"].extend(store.events(session, track_id=link.track_id))
        if not include_poses:
            continue
        stream = store.poses(session, link.track_id)
        if stream is not None:
            bundle["pose"] = {
                "encoding": POSE_ENCODING,
                "frames": len(stream),
                "duration_s": round(stream.duration, 2),
                "data": base64.b64encode(encode_poses(stream)).decode(),
            }
    bundle["events"].sort(key=lambda e: e["start_s"])
    return bundle


def validate(bundle: dict) -> list[str]:
    """Everything wrong with a bundle, or an empty list.

    The tier check is the point. A value without one is refused rather than
    defaulted, because defaulting it would decide -- silently, and in whichever
    direction the default happened to point -- how a claim about somebody's
    body is presented.
    """
    problems: list[str] = []
    if bundle.get("format") != FORMAT:
        problems.append(f"not a {FORMAT}")
    if bundle.get("version") != VERSION:
        problems.append(f"version {bundle.get('version')!r}, expected {VERSION}")
    if not bundle.get("person", {}).get("username"):
        problems.append("no person")
    if not bundle.get("session", {}).get("key"):
        problems.append("no session")

    for where in ("quantities", "structures"):
        for index, item in enumerate(bundle.get(where, [])):
            label = item.get("name", f"{where}[{index}]")
            tier = item.get("tier")
            if tier not in TIERS:
                problems.append(f"{label}: tier {tier!r} is not one of {TIERS}")
            if not item.get("because"):
                problems.append(f"{label}: no sentence saying where it came from")

    for structure in bundle.get("structures", []):
        if structure.get("tier") != MEASURED:
            continue
        if structure.get("value") is None:
            problems.append(f"{structure.get('name')}: marked measured with no "
                            f"value behind it")
        if not structure.get("from"):
            problems.append(f"{structure.get('name')}: marked measured without "
                            f"naming the measurement it came from")

    pose = bundle.get("pose")
    if pose is not None and pose.get("encoding") != POSE_ENCODING:
        problems.append(f"pose stream encoding {pose.get('encoding')!r} is not "
                        f"{POSE_ENCODING}")
    return problems


def write(bundle: dict, path: str | Path) -> Path:
    """Save a bundle, refusing to write an invalid one."""
    problems = validate(bundle)
    if problems:
        raise InvalidBundle("; ".join(problems))
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, indent=2) + "\n")
    return out
