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
from .activation import MEASURED_FLOOR, REFERENCE_LEVEL
from .activation import plan as activation_plan
from .bridge import (MEASURED, REFERENCE, bones_for_joint, meshes_for_group,
                     nerves_for_group)
from .scoring import score_from_store
from .store import Store
from .wording import MUSCLE_PLAIN, quantity

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


def _listed(items) -> str:
    """"a", "a and b", "a, b and c" -- so a sentence reads as a sentence."""
    parts = list(items)
    if len(parts) < 2:
        return "".join(parts)
    return f"{', '.join(parts[:-1])} and {parts[-1]}"


def spoken(group: str) -> str:
    """A muscle group the way a teacher points at it."""
    return MUSCLE_PLAIN.get(group, f"the {group}")


def _structures(quantities: list[dict]) -> list[dict]:
    """Which meshes to light, at which tier, the sentence and level for each.

    Only a peak-moment quantity produces a ``measured`` structure: a joint
    angle says where a limb was, not what a muscle did, and lighting a muscle
    from it would be a claim the measurement does not make.
    """
    out: dict[str, dict] = {}

    def key_of(mesh) -> str:
        return mesh.fma or f"name:{mesh.name}"

    def add(mesh, tier: str, because: str, plain: str, origin: str = ""):
        """A reference light. Never overwrites anything already recorded."""
        out.setdefault(key_of(mesh), {
            "fma": mesh.fma, "name": mesh.name, "layer": mesh.layer,
            "tier": tier, "because": because, "plain": plain,
            **({"from": origin} if origin else {}),
        })

    # Several muscles cross two measured joints -- biceps femoris is in the
    # knee flexors and the hip extensors, rectus femoris in the knee extensors
    # and the hip flexors. The first version kept whichever group came first
    # alphabetically, so the hamstrings showed a hip number and never a knee
    # one for no reason a reader could see. Gather every measured group a mesh
    # belongs to, then let the largest effort set the light and name the rest.
    efforts: dict[str, list[tuple[float, str, str]]] = {}
    meshes: dict[str, object] = {}

    for item in quantities:
        name = item["name"]
        if name.endswith(" peak moment") and item["valid"]:
            group = name[: -len(" peak moment")]
            for mesh in meshes_for_group(group):
                meshes[key_of(mesh)] = mesh
                efforts.setdefault(key_of(mesh), []).append(
                    (float(item["value"]), group, name))

    for key, carried in efforts.items():
        carried.sort(key=lambda c: -c[0])
        value, group, origin = carried[0]
        mesh = meshes[key]
        # "Peak" is across the session and across both sides: the store keys a
        # moment by its muscle group, and the left and right knee both produce
        # the knee extensors. So the number is the hardest this group worked at
        # any instant on either side, and the sentence has to say that rather
        # than let a reader take it for a reading of one leg.
        because = (f"the {group} carried up to {value:.0f} Nm in this session "
                   f"\u2014 the highest moment either side reached \u2014 and "
                   f"this muscle is one of them")
        plain = (f"{spoken(group)} worked up to {value:.0f} newton metres in "
                 f"this class \u2014 the hardest either side got to \u2014 and "
                 f"this muscle is one of them")
        if len(carried) > 1:
            because += ". It is also one of " + _listed(
                f"the {g}, which carried {v:.0f} Nm" for v, g, _ in carried[1:])
            plain += ". It also works as part of " + _listed(
                f"{spoken(g)}, which reached {v:.0f} newton metres"
                for v, g, _ in carried[1:])
        out[key] = {
            "fma": mesh.fma, "name": mesh.name, "layer": mesh.layer,
            "tier": MEASURED, "because": because, "plain": plain,
            "value": round(value, 3), "unit": "Nm", "from": origin,
            **({"also": [o for _, _, o in carried[1:]]} if len(carried) > 1 else {}),
        }

    for item in quantities:
        name = item["name"]
        if name.endswith(" peak moment") and item["valid"]:
            group = name[: -len(" peak moment")]
            for mesh in nerves_for_group(group):
                add(mesh, REFERENCE,
                    "supplies a muscle that was measured here. Nothing in "
                    "this recording observed a nerve.",
                    f"this nerve feeds {spoken(group)}, which we did measure. "
                    f"The nerve itself was not measured \u2014 no camera can "
                    f"see one.", origin=name)
        elif name.startswith(("left_", "right_")):
            # Named without a side. The model holds one mesh for a bilateral
            # bone, so a femur lit from the left hip was being described as
            # meeting "the left hip" when it is equally the right one -- an
            # accident of which angle came first in the list, printed as though
            # it were a fact about the bone.
            joint = name.split("_", 1)[1].replace("_", " ")
            for mesh in bones_for_joint(name):
                add(mesh, REFERENCE,
                    f"articulates the {joint}, which was measured. No load on "
                    f"this bone was estimated.",
                    f"this bone meets the {joint}, which we did measure. We "
                    f"did not work out what the bone itself carried.",
                    origin=name)

    ordered = sorted(out.values(), key=lambda s: (s["layer"], s["name"]))
    lit = activation_plan(ordered)
    by_name = {(l.fma or f"name:{l.name}"): l for l in lit.lights}
    for entry in ordered:
        light = by_name[entry.get("fma") or f"name:{entry['name']}"]
        entry["level"] = round(light.level, 4)
        if light.share is not None:
            entry["share"] = round(light.share, 4)
    return ordered


def _exercises(store: Store, username: str, session: str) -> list[dict]:
    """Which exercises this person actually did, and for how long.

    The link nothing else in either project could make. The anatomy side knows
    what every exercise is claimed to do -- to muscles, and to the brain, with a
    tier and a citation on each claim. It has never known which of them anybody
    did. This side watched somebody do them.

    Time comes from ``exercise`` events where they were recorded, and otherwise
    from the frames measured under that exercise's name -- a session labelled by
    hand has no segment boundaries, and refusing to say anything about it would
    throw away the labelling. Which of the two produced a row is recorded in
    ``from``, because "measured for 4 minutes" and "labelled, duration unknown"
    are different statements.
    """
    session_id = store.session_id(session)
    links = [l for l in store.links(session=session, status="confirmed")
             if l.username == username]
    if not links:
        return []
    tracks = {l.track_id for l in links}

    seconds: dict[str, float] = {}
    reps: dict[str, int] = {}
    source: dict[str, str] = {}
    spans: list[tuple[float, float, str]] = []
    mine = [e for e in store.events(session) if e["track_id"] in tracks]

    for event in mine:
        if event["kind"] == "exercise" and event["label"]:
            end = event["end_s"] if event["end_s"] is not None else event["start_s"]
            seconds[event["label"]] = seconds.get(event["label"], 0.0) + (
                end - event["start_s"])
            source[event["label"]] = "timed segments"
            spans.append((event["start_s"], end, event["label"]))

    rows = store.db.execute(
        "SELECT DISTINCT exercise FROM measurements "
        "WHERE session_id = ? AND exercise != ''", (session_id,))
    for row in rows:
        source.setdefault(row["exercise"], "labelled measurements")
        seconds.setdefault(row["exercise"], 0.0)

    # A repetition belongs to whichever exercise was running when it happened.
    # The first version matched the repetition's label against the exercise's
    # name -- a repetition is labelled with the joint that turned, so nothing
    # ever matched and every exercise reported zero.
    spans.sort()
    for event in mine:
        if event["kind"] != "repetition":
            continue
        at = event["start_s"]
        for start, end, name in spans:
            if start <= at <= end:
                reps[name] = reps.get(name, 0) + 1
                break

    return [{
        "key": name,
        "seconds": round(seconds[name], 1),
        "repetitions": reps.get(name, 0),
        "from": source.get(name, "labelled measurements"),
    } for name in sorted(seconds)]


def build(
    store: Store,
    username: str,
    session: str,
    include_poses: bool = True,
    synthetic: dict | None = None,
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
    structures = _structures(quantities)
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
        "exercises": _exercises(store, username, session),
        # Absent on a real capture. Present, loud, and checked by the validator
        # on anything generated, because a bundle is the file that drives a
        # picture of somebody's body -- and a demonstration that cannot be told
        # from a measurement is the single most damaging thing this project
        # could publish.
        **({"synthetic": synthetic} if synthetic else {}),
        "quantities": quantities,
        "structures": structures,
        "lighting": activation_plan(structures).scheme(),
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
            if where == "structures" and not item.get("plain"):
                # Both registers or neither: a viewer that has only the
                # technical half will show it to a student, and the whole point
                # of the plain half is that the student is the reader.
                problems.append(f"{label}: no plain-words version of the "
                                f"sentence, so a student would be shown the "
                                f"technical one")

    for structure in bundle.get("structures", []):
        if structure.get("tier") != MEASURED:
            continue
        if structure.get("value") is None:
            problems.append(f"{structure.get('name')}: marked measured with no "
                            f"value behind it")
        if not structure.get("from"):
            problems.append(f"{structure.get('name')}: marked measured without "
                            f"naming the measurement it came from")

    # The level is what a viewer writes into the palette, so a bundle whose
    # levels contradict its tiers would draw a measurement and a lookup the
    # same. Checked here rather than trusted on the far side, because the far
    # side is a static page with no test suite behind it.
    scheme = bundle.get("lighting") or {}
    floor, ceiling = scheme.get("measured_band", [MEASURED_FLOOR, 1.0])
    flat = scheme.get("reference_level", REFERENCE_LEVEL)
    if flat >= floor:
        problems.append(f"reference level {flat} is inside the measured band "
                        f"{floor}-{ceiling}: the two tiers would look alike")
    for structure in bundle.get("structures", []):
        level = structure.get("level")
        name = structure.get("name")
        if level is None:
            problems.append(f"{name}: no level, so a viewer would have to "
                            f"invent one")
        elif structure.get("tier") == MEASURED and not floor <= level <= ceiling:
            problems.append(f"{name}: measured but lit at {level}, outside the "
                            f"measured band {floor}-{ceiling}")
        elif structure.get("tier") == REFERENCE and level != flat:
            problems.append(f"{name}: reference lit at {level}, not the flat "
                            f"{flat} -- a gradient here is an amount nothing "
                            f"measured")

    synthetic = bundle.get("synthetic")
    if synthetic is not None:
        if not isinstance(synthetic, dict) or not synthetic.get("why"):
            problems.append("marked synthetic without saying why, which is the "
                            "half of the marking that does the work")
        elif not synthetic.get("not_a_person"):
            problems.append("marked synthetic without not_a_person: a viewer "
                            "reads that field to decide how loudly to say so")

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
