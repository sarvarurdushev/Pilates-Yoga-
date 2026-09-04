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
#: Chosen so that every one of them also has a standard on this side. The two
#: projects name exercises differently -- ``rollingLikeABall`` against
#: ``rolling_like_a_ball`` -- and the merge normaliser already reconciles them,
#: which is what makes a class judgeable exercise by exercise rather than
#: against one standing pose.
#: A mat sequence that holds one body shape throughout -- long, legs extended,
#: face down or supine -- so that a single set of joint angles is a truthful
#: description of the whole class.
#:
#: **That constraint is real, not a convenience.** A knee is at 170 degrees in a
#: teaser and tucked to 50 in rolling like a ball, and this file stores one
#: value per joint per class, as the measurement store does. Judging that one
#: value against both exercises produced a ninety-degree "error" that was an
#: artefact of the demo rather than anything about a student. Choosing a
#: coherent class avoids inventing a per-exercise model the rest of the system
#: does not yet have -- see the note in the README about what a joint angle
#: belongs to.
PLAN: tuple[tuple[str, int, int, int], ...] = (
    ("singleLegStretch", 0, 280, 10),
    ("doubleLegStretch", 280, 560, 8),
    ("neckPull", 560, 800, 6),
    ("swan", 800, 1060, 6),
    ("swimming", 1060, 1300, 12),
    ("singleLegKick", 1300, 1540, 10),
    ("legPullFront", 1540, 1800, 4),
)

#: Joint angles, in degrees, with the spread they varied by inside the session.
ANGLES: dict[str, tuple[float, float]] = {
    # The left knee starts outside every band that names it and comes into
    # them around week six, so the score has something real to do. Its
    # neighbour barely moves, so the two together show the instrument both
    # finding a change and refusing to call one.
    "left_knee": (142.0, 4.1), "right_knee": (171.0, 3.8),
    # And the right hip sits just under its band for the first half of the
    # run, so there is something the score is still waiting on after the
    # knee has resolved. A demo where everything lands at once teaches the
    # reader that progress arrives all together, which it does not.
    "left_hip": (170.0, 6.2), "right_hip": (156.0, 5.9),
    "left_elbow": (172.0, 3.0), "right_elbow": (169.0, 3.4),
    "left_shoulder": (58.0, 7.7), "right_shoulder": (61.0, 8.1),
    # Two degrees under the floor of every band that names it, and it stays
    # there: a class where everything resolves by the end teaches the reader
    # that everything always does.
    "neck": (12.0, 2.9), "trunk": (3.0, 3.3),
    "shoulder_tilt": (2.4, 1.4), "pelvis_tilt": (3.1, 1.6),
}

SYMMETRY: dict[str, float] = {
    # Outside its ten-degree tolerance to begin with, inside it by the
    # middle of the run.
    "knee symmetry": 3.0, "hip symmetry": 12.0,
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


def standard_for(key: str):
    """The standard this side holds for an exercise the library names.

    The two projects spell exercises differently -- ``rollingLikeABall`` here,
    ``rolling_like_a_ball`` there -- so the match goes through the same
    normaliser the library merge uses rather than a second table written beside
    it. Twelve of the library's hundred and ninety exercises have a standard;
    the rest are coached without one, which is what `pilates.universal` is for.
    """
    from .coaching import DEFAULT_STANDARDS
    from .neurowellness import normalise, squash

    by = {squash(name): name for name in DEFAULT_STANDARDS}
    found = by.get(squash(normalise(key)))
    return DEFAULT_STANDARDS[found] if found else None


def _judge(shift):
    """Findings from the demo's own numbers, using the real comparison.

    One assessment per exercise, which is what a capture produces: a class is
    not judged against a single standing pose, it is judged against whatever it
    was that the student was doing at the time. Seven exercises with standards
    make about thirty checks, where one standard made five -- and five was the
    floor below which a score is withheld, which is why the first version of
    this demo had gaps in its score line.

    Returns tuples rather than Finding objects so this file does not import the
    coaching dataclass; what matters is that the deviation and the thresholds
    are the standard's own, not a second opinion written here.
    """
    from .coaching import CLOSE, NOTABLE_DEGREES

    out = []
    for key, *_ in PLAN:
        standard = standard_for(key)
        if standard is None:
            continue
        for target in standard.angles:
            if target.joint not in ANGLES:
                continue
            median = shift(target.joint, ANGLES[target.joint][0])
            deviation = target.deviation(median)
            band = f"{target.low:.0f}-{target.high:.0f}deg"
            if deviation >= NOTABLE_DEGREES:
                kind, message = "improve", target.cue
            elif deviation > 0.0:
                kind, message = CLOSE, ""
            else:
                kind, message = "good", target.praise
            out.append((kind, message, target.joint, median, band, deviation, key))
        for target in standard.symmetry:
            name = f"{target.pair} symmetry"
            if name not in SYMMETRY:
                continue
            gap = max(0.0, shift(name, SYMMETRY[name]))
            band = f"within {target.tolerance:.0f}deg"
            if gap > target.tolerance:
                out.append(("improve", target.cue, name, gap, band,
                            gap - target.tolerance, key))
            else:
                out.append(("good", f"left and right {target.pair} matched closely",
                            name, gap, band, 0.0, key))
    return out


def _quality(shift):
    """The three checks that need no standard, judged by the real limits."""
    from .universal import CONTROL_LIMIT, RANGE_SPREAD_LIMIT, TEMPO_RATIO_FLOOR

    values = dict((name, value) for name, value, _ in QUALITY)
    control = values["control"]
    tempo = values["tempo ratio"]
    spread = values["range consistency"] * values["range of motion"]
    limit = RANGE_SPREAD_LIMIT * values["range of motion"]
    out = []
    if control > CONTROL_LIMIT:
        out.append(("improve", "the movement changed direction inside a repetition",
                    "control", control, f"below {CONTROL_LIMIT:.1f}",
                    (control - CONTROL_LIMIT) * 10.0, PLAN[-1][0]))
    else:
        out.append(("good", "the movement was smooth through each repetition",
                    "control", control, "", 0.0, PLAN[-1][0]))
    if spread > limit:
        out.append(("improve", "the repetitions were not the same size",
                    "consistency", spread, f"within {limit:.0f}deg",
                    spread - limit, PLAN[-1][0]))
    else:
        out.append(("good", "every repetition was about the same size",
                    "consistency", spread, f"within {limit:.0f}deg", 0.0, PLAN[-1][0]))
    if tempo < TEMPO_RATIO_FLOOR:
        out.append(("improve", "the return was quicker than the effort", "tempo",
                    tempo, f"at least {TEMPO_RATIO_FLOOR:.1f}",
                    (TEMPO_RATIO_FLOOR - tempo) * 10.0, PLAN[-1][0]))
    else:
        out.append(("good", "lowered as slowly as it was lifted", "tempo", tempo,
                    f"at least {TEMPO_RATIO_FLOOR:.1f}", 0.0, PLAN[-1][0]))
    return out


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
                              exercise=PLAN[2][0])
    for group, moment in MOMENTS.items():
        store.add_measurement(session, 1, f"{group} peak moment",
                              shift(f"{group} peak moment", moment),
                              spread=moment * 0.14, samples=880, unit="Nm",
                              source="load", exercise=PLAN[2][0])
    for subject, value, unit in QUALITY:
        store.add_measurement(session, 1, subject, value, spread=0.2, samples=900,
                              unit=unit, source="quality", exercise=PLAN[-1][0])

    # A score is derived from findings, not from measurements, because the
    # question it answers is "how close to the standard" rather than "what were
    # the numbers". So the demo has to be assessed as well as measured -- and it
    # is assessed by the real rule: the standard's own AngleTarget.deviation and
    # the same NOTABLE_DEGREES threshold `assess` applies to a capture. Made-up
    # inputs, real judgement.
    for kind, message, subject, measured, target, deviation, key in _judge(shift):
        store.add_finding(session, 1, kind, message, subject=subject,
                          exercise=key, measured=measured, target=target,
                          deviation=deviation, source="standard")
    for kind, message, subject, measured, target, deviation, key in _quality(shift):
        store.add_finding(session, 1, kind, message, subject=subject,
                          exercise=key, measured=measured, target=target,
                          deviation=deviation, source="quality")


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
    "left_hip": 0.2,                    # stays inside its band throughout
    "right_hip": 0.6,                   # comes into it around week eight
    "knee symmetry": -0.14,             # lower is better, and it clears
    "hip symmetry": -0.45,              # crosses the tolerance mid-run
    "left_knee": 2.6,                   # crosses into the band around week 7
    "right_knee": 0.05,                 # never clears: stays "steady"
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
