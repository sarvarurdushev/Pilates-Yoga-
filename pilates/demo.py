"""A class nobody attended, so the application can be shown to somebody.

Every screen in this project is driven by a session bundle, and a bundle comes
from a camera pointed at a person. That makes the thing impossible to
demonstrate to anyone who has not already installed it, pointed a camera at
themselves and waited -- which is most people, including everyone deciding
whether it is worth their time.

So this builds a session with no video behind it. **Every number in it is made
up.** That is not a caveat tucked into a docstring: the bundle carries a
``synthetic`` block, the validator refuses a bundle that claims to be synthetic
without saying why, and the viewer tags the session bar. The tag is deliberately
small: the marking that has to hold is the one in the file, which travels with
it, not a banner that shouts over the screen it is labelling.

The reason to be this careful is that a bundle drives a rendering of somebody's
body. A demonstration that cannot be told from a measurement is the single most
damaging thing this project could publish -- to a student who believes it, and
to anyone who later finds out that the impressive screenshot was of nobody.

The shape is real even though the numbers are not: the same store, the same
tables, the same exercise keys the anatomy library uses, the same units. Code
that works against this works against a capture.
"""
from __future__ import annotations

from pathlib import Path

from .identity import Link
from .store import SessionMeta, Store

#: Why this exists, carried in the bundle and printed by the viewer.
WHY = ("A demonstration session. No camera recorded it and no person performed "
       "it: every number here was written by hand to show what the application "
       "does with a real one.")

#: Exercise keys exactly as the anatomy library spells them, so the evidence
#: table has something to look up. A key it does not know would still be shown
#: -- the viewer keeps unknown exercises rather than shortening the list -- but
#: it would demonstrate nothing.
PLAN: tuple[tuple[str, int, int, int], ...] = (
    ("breathing", 0, 180, 0),
    ("pelvicCurl", 180, 480, 8),
    ("chestLift", 480, 760, 10),
    ("rollingLikeABall", 760, 980, 6),
    ("oneLegCircle", 980, 1340, 12),
    ("swan", 1340, 1600, 6),
    ("plank", 1600, 1780, 3),
)

#: Joint angles, in degrees, with the spread they varied by inside the session.
ANGLES: dict[str, tuple[float, float]] = {
    "left_knee": (168.0, 4.1), "right_knee": (171.0, 3.8),
    "left_hip": (128.0, 6.2), "right_hip": (124.0, 5.9),
    "left_elbow": (172.0, 3.0), "right_elbow": (169.0, 3.4),
    "left_shoulder": (58.0, 7.7), "right_shoulder": (61.0, 8.1),
    "neck": (12.0, 2.9), "trunk": (7.5, 3.3),
    "shoulder_tilt": (2.4, 1.4), "pelvis_tilt": (3.1, 1.6),
}

SYMMETRY: dict[str, float] = {
    "knee symmetry": 3.0, "hip symmetry": 4.0,
    "elbow symmetry": 3.0, "shoulder symmetry": 3.0,
}

#: Peak joint moments per muscle group, in newton-metres. Ordered the way a mat
#: class actually loads a body -- hips hardest, arms barely -- because a demo
#: whose numbers are shaped wrongly teaches the reader something false about
#: what the instrument produces.
MOMENTS: dict[str, float] = {
    "hip flexors": 41.8, "hip extensors": 33.2, "knee extensors": 22.6,
    "knee flexors": 12.4, "shoulder extensors": 9.1, "shoulder flexors": 7.4,
    "elbow flexors": 4.2, "elbow extensors": 3.1,
}

QUALITY: tuple[tuple[str, float, str], ...] = (
    ("repetitions", 45.0, ""), ("control", 1.9, ""),
    ("range of motion", 62.0, "deg"), ("tempo ratio", 0.94, ""),
    ("seconds per repetition", 3.4, "s"), ("longest hold", 41.0, "s"),
    ("range consistency", 0.19, ""),
)


def marker() -> dict:
    """The block a synthetic bundle carries, and the viewer reads.

    Kept in the file even though the viewer no longer paints a banner with it.
    The first version put a full-width amber bar on every screen, which was
    right about the risk and wrong about the dose -- it shouted over the thing
    it was labelling. The honest marking is the one that survives the file being
    passed around, not the one that survives being looked at once.
    """
    return {"not_a_person": True, "why": WHY, "label": "Sample data"}


def fill(store: Store, username: str = "anna", display: str = "Sample Student",
         session: str = "tue-14", date: str = "2026-08-25",
         drift: int = 0) -> None:
    """Write one made-up class into a store, in the shape a capture produces.

    ``drift`` is which week this is, and moves a few quantities a little. See
    :data:`DRIFT`: most of them move less than they wobble within one session,
    so the viewer's noise floor refuses to call them a change -- which is the
    behaviour worth demonstrating.
    """
    def shift(subject: str, base: float) -> float:
        return base + DRIFT.get(subject, 0.0) * drift + WOBBLE[drift % len(WOBBLE)]

    store.enrol(username, display)
    store.record_session(SessionMeta(key=session, date=date, studio="Demo studio",
                                     duration_s=1800, video=""))
    store.save_manifest(session, "demo", {"keypoint_threshold": 0.4},
                        source_fps=30.0, stride=6)
    store.put_link(Link(session=session, track_id=1, username=username,
                        method="declared").confirm("demo"))

    for key, start, end, reps in PLAN:
        store.add_event(session, 1, "exercise", float(start), float(end), label=key)
        for i in range(reps):
            at = start + (end - start) * (i + 0.5) / max(reps, 1)
            store.add_event(session, 1, "repetition", float(at), label="left_hip")

    for subject, (value, spread) in ANGLES.items():
        for key, start, end, _ in PLAN:
            store.add_measurement(session, 1, subject, shift(subject, value),
                                  spread=spread,
                                  samples=int((end - start) / 6), unit="deg",
                                  source="standard", exercise=key,
                                  at_time=float(start))
    for subject, value in SYMMETRY.items():
        store.add_measurement(session, 1, subject, max(0.0, shift(subject, value)),
                              spread=1.2, samples=900,
                              unit="deg", source="standard",
                              exercise="oneLegCircle")
    for group, moment in MOMENTS.items():
        store.add_measurement(session, 1, f"{group} peak moment",
                              shift(f"{group} peak moment", moment),
                              spread=moment * 0.14, samples=880, unit="Nm",
                              source="load", exercise="oneLegCircle")
    for subject, value, unit in QUALITY:
        store.add_measurement(session, 1, subject, value, spread=0.2, samples=900,
                              unit=unit, source="quality", exercise="plank")


#: Twelve weeks of Tuesdays. One session shows what the instrument produces;
#: a run of them shows the thing the instrument is for, which is whether
#: anything changed. The drift is deliberately smaller than the within-session
#: spread on most quantities, so the viewer's own noise floor refuses to call
#: most of them a change -- a demonstration where every line marches upward
#: would teach the reader that the instrument always finds progress.
WEEKS = 12
DRIFT: dict[str, float] = {
    "hip flexors peak moment": 0.9,     # clears the floor over twelve weeks
    "hip extensors peak moment": 0.7,
    "left_hip": 0.55, "right_hip": 0.5,
    "knee symmetry": -0.14,             # lower is better, and it clears
    "left_knee": 0.06, "right_knee": 0.05,   # never clears: stays "steady"
    "trunk": -0.04,
}
#: A little wobble, so the series is not a straight line -- a noise floor tested
#: against a perfectly smooth series is not tested at all.
WOBBLE = (0.0, 0.4, -0.3, 0.15, -0.45, 0.25, -0.1, 0.35, -0.25, 0.05, 0.3, -0.2)


def weeks(store: Store, username: str = "anna", display: str = "Sample Student",
          count: int = WEEKS) -> list[str]:
    """A run of classes, so there is a history to draw.

    Dates go backwards from the most recent so the last session is the one the
    bundle is built for -- the same shape a studio would have, where today's
    class is the newest row and the record grows behind it.
    """
    from datetime import date, timedelta

    last = date(2026, 8, 25)
    keys = []
    for week in range(count):
        at = last - timedelta(weeks=count - 1 - week)
        key = f"tue-{week + 1:02d}"
        fill(store, username=username, display=display, session=key,
             date=at.isoformat(), drift=week)
        keys.append(key)
    return keys


def build(out_dir: str | Path, username: str = "anna",
          session: str | None = None) -> tuple[Path, Path]:
    """Write the demo bundle and the manifest the viewer looks for.

    The manifest is what lets the application offer a demonstration without one
    being forced on anybody: with no session in the URL the viewer checks for
    ``demo/index.json`` and, if it is there, shows a chip that loads it. An
    installation that does not want a demo simply does not ship the folder.
    """
    from .bundle import build as build_bundle
    from .bundle import write as write_bundle

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with Store.memory() as store:
        keys = weeks(store, username=username)
        latest = session or keys[-1]
        bundle = build_bundle(store, username, latest, include_poses=False,
                              synthetic=marker())
    path = write_bundle(bundle, out / f"{username}-{latest}.json")

    manifest = out / "index.json"
    manifest.write_text(
        __import__("json").dumps({
            "sessions": [{
                "file": path.name,
                "label": bundle["person"]["display_name"],
                "date": bundle["session"]["date"],
                "synthetic": True,
            }],
            "note": WHY,
        }, indent=2) + "\n")
    return path, manifest
