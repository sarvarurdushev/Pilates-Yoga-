"""Movement screening: what a body can do, measured against a published range.

:mod:`pilates.intake` measures a body standing still. :mod:`pilates.coaching`
judges a body doing a named exercise in a class. This is the third question and
the one between them: *how far does this joint actually go, and does the other
side go as far?* A studio asks a new student to raise their arms, fold a knee,
sit into a squat and stand on one leg, and what comes out of it is a starting
point -- a number to work from, and a number to compare against in six weeks.

**What a screen is.** A named movement, an instruction the student can follow,
one joint angle it is measured on, one camera view it has to be filmed from,
and a published range it is compared against. Six of them are defined below.
The list is deliberately short: every entry needs a movement a studio actually
asks for, an angle COCO-17 can genuinely see, and a reference somebody else
published. Adding a seventh is adding a :class:`Screen`, and nothing else.

**Where the reference numbers come from.** The four joint ranges are the AAOS
normal active values as tabulated in Norkin & White, *Measurement of Joint
Motion: A Guide to Goniometry* -- the figures every clinical goniometry text
reproduces. The squat benchmark is not a clinical norm and is labelled as a
functional one. The balance figure is the ceiling of the single-leg stance
test. Each :class:`Screen` carries its own source string, so no number in a
report is unattributed, and a studio that prefers its own figures replaces the
table rather than editing the code.

**What the camera is not.** A goniometer is placed on the joint by a clinician
who has isolated the limb. This is a camera watching a whole person, and the
difference is not a detail:

* **Depth is invisible.** An angle with any component toward or away from the
  lens reads *smaller* than it is, and the error grows with the angle. This is
  why every range screen names the view it must be filmed from, and why a clip
  with no view stated is reported as ESTIMATED rather than as a measurement.
* **The reference is a ceiling, not a target.** 180 degrees of shoulder flexion
  is what an unrestricted shoulder does, not a score to beat. A screen that
  comes back at the reference has found nothing; a screen 30 degrees short has
  found something to work on.
* **A shortfall is a shortfall.** It is not a diagnosis, and nothing here names
  a cause. A joint that did not travel as far as the published range may be
  stiff, may be guarded, may be held back by a student who did not understand
  the instruction, or may have been filmed at the wrong angle. The report says
  what was measured and refuses to say why.

**Reuse, not reimplementation.** Every signal-processing decision already lives
in :mod:`pilates.movement` -- the smoothing window, the turning-point
detection, the repetition definition, the control ratio, the confidence floor.
This layer chooses which signal to read, converts it into the quantity a
clinician would name, compares it against the published range, and puts an
availability on the answer. It adds no new maths to the repetition problem.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from . import movement as mv
from .alignment import MIN_BODY_PIXELS, Availability, Metric, View
from .scoring import Component, Score

#: Frames with the signal actually measured, below which nothing is reported.
#: Twenty is roughly two thirds of a second at the 30 fps a phone films at,
#: which is the shortest window that can contain a turning point and the frames
#: either side of it.
MIN_FRAMES = 20

#: Mean joint confidence below which the signal is not trusted at all. Shared
#: with the movement layer rather than chosen again: a confidence floor that
#: differs between two modules reading the same keypoints is a bug waiting.
MIN_CONFIDENCE = mv.MIN_SIGNAL_CONFIDENCE

#: Degrees a single measurement of a joint angle is worth to.
#:
#: Goniometry repeated by one clinician on one joint is generally reproducible
#: to about five degrees, and a camera watching a whole person is not better
#: than a goniometer placed on the limb. Everything below is derived from this
#: one figure rather than chosen separately, so there is one number to argue
#: with instead of three.
MEASUREMENT_ERROR = 5.0

#: Degrees of left-right difference below which the two sides are called equal.
#: Two measurements, so twice the error of one: a gap has to clear both before
#: "one side goes further" is a statement about the body rather than about the
#: measuring.
SIDE_TOLERANCE = 2 * MEASUREMENT_ERROR

#: Smallest excursion counted as a repetition of a screen, in degrees. Larger
#: than the movement layer's default because a screen is a deliberate, full
#: movement: a fifteen-degree wobble during a shoulder raise is not a second
#: repetition of it.
MIN_EXCURSION = 25.0


@dataclass(frozen=True)
class Screen:
    """One named movement test.

    ``zero`` is the measured interior angle that corresponds to clinical zero,
    and it is the field that stops this whole module from being wrong. The
    geometry layer reports the angle *at* a joint: a straight knee is 180 and a
    folded one approaches 0. A clinician reports knee flexion the other way up
    -- a straight knee is 0 and a folded one is 135. Subtracting from ``zero``
    converts one into the other, and a screen that omitted it would compare a
    interior angle against a flexion range and call a straight knee superb.
    """

    key: str
    name: str
    name_ko: str
    #: What to ask the student to do. Held here for the same reason the intake
    #: protocol holds its instructions: the words appear on a screen, in a
    #: printed report and in the CLI, and three copies stop matching.
    instruction: str
    instruction_ko: str
    #: The geometry signal, with ``{side}`` where left or right goes. A screen
    #: with no ``{side}`` is measured once for the whole body.
    signal: str
    #: The interior angle that means clinical zero: 0 where the geometry and
    #: the clinic already agree, 180 where they are inverted.
    zero: float
    #: The published range, as (floor, ceiling) of the clinical quantity.
    reference: tuple[float, float]
    reference_source: str
    #: The camera view the movement happens in the plane of. A screen filmed
    #: from anywhere else reads short, by an amount nothing can recover.
    views: tuple[View, ...]
    #: ``range`` -- travel out and back, measured by how far it got.
    #: ``hold`` -- stay still, measured by how long and how steadily.
    kind: str = "range"
    unit: str = "deg"
    #: Whether the reference is a clinical normal or a functional benchmark.
    #: Printed beside the number, because they are not the same kind of claim.
    reference_kind: str = "clinical"

    @property
    def sided(self) -> bool:
        return "{side}" in self.signal

    def signal_for(self, side: str = "") -> str:
        return self.signal.format(side=side) if self.sided else self.signal

    def named(self, lang: str = "en") -> str:
        return self.name_ko if lang == "ko" else self.name

    def how(self, lang: str = "en") -> str:
        return self.instruction_ko if lang == "ko" else self.instruction

    def clinical(self, interior: float) -> float:
        """Convert a measured interior angle into the quantity a clinic names."""
        return abs(interior - self.zero)

    def shortfall(self, value: float) -> float:
        """Degrees short of the published ceiling. Zero at or above it."""
        return max(0.0, self.reference[1] - value)


#: The screens, in the order a studio runs them: standing and facing the
#: camera first, then turned side-on, then the two that need the floor.
#:
#: Six, not sixty. Each one here is a movement a Pilates or yoga studio already
#: asks a new student for, on an angle the seventeen-point skeleton genuinely
#: sees, against a range somebody else published. A screen that fails any of
#: those three is a screen that produces a confident number about nothing.
SCREENS: dict[str, Screen] = {
    "shoulder_abduction": Screen(
        key="shoulder_abduction",
        name="Shoulder abduction",
        name_ko="어깨 벌림",
        instruction=(
            "Face the camera. Arms straight down by your sides, palms forward. "
            "Raise both arms out sideways, as high as they will go, and lower "
            "them. Three times, slowly."),
        instruction_ko=(
            "카메라를 정면으로 봅니다. 팔을 몸 옆에 곧게 내리고 손바닥은 앞을 "
            "향합니다. 양팔을 옆으로 올릴 수 있는 만큼 올렸다가 내립니다. "
            "천천히 세 번 반복하세요."),
        signal="{side}_shoulder",
        zero=0.0,
        reference=(0.0, 180.0),
        reference_source=(
            "AAOS normal active range, as tabulated in Norkin & White, "
            "Measurement of Joint Motion: A Guide to Goniometry"),
        views=(View.FRONT, View.REAR),
    ),
    "shoulder_flexion": Screen(
        key="shoulder_flexion",
        name="Shoulder flexion",
        name_ko="어깨 굽힘",
        instruction=(
            "Turn side-on to the camera. Raise both arms forward and overhead, "
            "as far as they will go, and lower them. Three times, slowly."),
        instruction_ko=(
            "카메라를 옆으로 보고 섭니다. 양팔을 앞으로 들어 머리 위까지 올릴 수 "
            "있는 만큼 올렸다가 내립니다. 천천히 세 번 반복하세요."),
        signal="{side}_shoulder",
        zero=0.0,
        reference=(0.0, 180.0),
        reference_source=(
            "AAOS normal active range, as tabulated in Norkin & White, "
            "Measurement of Joint Motion: A Guide to Goniometry"),
        views=(View.SIDE_LEFT, View.SIDE_RIGHT),
    ),
    "hip_flexion": Screen(
        key="hip_flexion",
        name="Hip flexion",
        name_ko="엉덩관절 굽힘",
        instruction=(
            "Turn side-on to the camera. Lift one knee towards your chest as "
            "far as it will go, then lower it. Three times each leg."),
        instruction_ko=(
            "카메라를 옆으로 보고 섭니다. 한쪽 무릎을 가슴 쪽으로 올릴 수 있는 "
            "만큼 올렸다가 내립니다. 양쪽 다리 각각 세 번씩 반복하세요."),
        signal="{side}_hip",
        zero=180.0,
        reference=(0.0, 120.0),
        reference_source=(
            "AAOS normal active range with the knee flexed, as tabulated in "
            "Norkin & White, Measurement of Joint Motion"),
        views=(View.SIDE_LEFT, View.SIDE_RIGHT),
    ),
    "knee_flexion": Screen(
        key="knee_flexion",
        name="Knee flexion",
        name_ko="무릎 굽힘",
        instruction=(
            "Turn side-on to the camera, standing. Bend one knee to bring the "
            "heel towards your buttock, then lower it. Three times each leg."),
        instruction_ko=(
            "카메라를 옆으로 보고 섭니다. 한쪽 무릎을 굽혀 발뒤꿈치를 엉덩이 "
            "쪽으로 당겼다가 내립니다. 양쪽 다리 각각 세 번씩 반복하세요."),
        signal="{side}_knee",
        zero=180.0,
        reference=(0.0, 135.0),
        reference_source=(
            "AAOS normal active range, as tabulated in Norkin & White, "
            "Measurement of Joint Motion"),
        views=(View.SIDE_LEFT, View.SIDE_RIGHT),
    ),
    "squat_depth": Screen(
        key="squat_depth",
        name="Squat depth",
        name_ko="스쿼트 깊이",
        instruction=(
            "Turn side-on to the camera, feet under your hips. Sit down as far "
            "as you comfortably can and stand back up. Three times."),
        instruction_ko=(
            "카메라를 옆으로 보고 서서 발은 골반 너비로 둡니다. 편안한 범위까지 "
            "앉았다가 일어섭니다. 세 번 반복하세요."),
        signal="{side}_hip",
        zero=180.0,
        # Thigh parallel to the floor is 90 degrees of hip flexion, and it is
        # the depth a studio actually asks for. It is a benchmark a teacher
        # uses, not a range anybody published as normal, and it is labelled
        # that way in every report so the two are never read as one kind of
        # claim.
        reference=(0.0, 90.0),
        reference_source=(
            "functional benchmark: thigh parallel to the floor, which is 90 "
            "degrees of hip flexion. Not a clinical normal range"),
        reference_kind="functional",
        views=(View.SIDE_LEFT, View.SIDE_RIGHT),
    ),
    "single_leg_balance": Screen(
        key="single_leg_balance",
        name="Single-leg balance",
        name_ko="한 발 서기 균형",
        instruction=(
            "Face the camera. Stand on one leg, hands on hips, and hold it as "
            "long as you can, up to thirty seconds. Then the other leg."),
        instruction_ko=(
            "카메라를 정면으로 봅니다. 손을 허리에 얹고 한 발로 서서 최대 "
            "30초까지 버팁니다. 반대쪽 발도 같은 방법으로 합니다."),
        # Measured from the trunk staying upright; the number that matters is
        # how long and how steadily, not an angle.
        signal="trunk",
        zero=0.0,
        reference=(0.0, 30.0),
        reference_source=(
            "the ceiling of the single-leg stance test, which is timed to "
            "thirty seconds"),
        views=(View.FRONT, View.REAR),
        kind="hold",
        unit="s",
        reference_kind="functional",
    ),
}


def _metric(name: str, value: float | None, unit: str, *,
            confidence: float = 0.0, reason: str = "",
            normal: tuple[float, float] | None = None,
            estimated: bool = False) -> Metric:
    """One measurement in the vocabulary the posture side already speaks."""
    if value is None:
        return Metric(name, None, unit, Availability.UNAVAILABLE, 0.0, reason)
    availability = (Availability.ESTIMATED if estimated
                    else Availability.AVAILABLE)
    # Rounded by unit, not by habit. A tenth of a degree is below what any of
    # this can resolve, and a tenth of a *ratio* is most of the quantity: hip
    # sway during a balance runs at a few hundredths of a body height, so one
    # decimal place reported every hold in the product as perfectly still.
    places = 3 if unit == "ratio" else 1
    return Metric(name, round(float(value), places), unit, availability,
                  round(confidence, 3), reason, normal)


@dataclass
class SideResult:
    """One screen, one side of the body.

    Every number here is a :class:`~pilates.alignment.Metric`, so each carries
    its own availability and its own reason for being absent. A side that was
    filmed badly comes back with the same shape as one that was filmed well,
    and a reader never has to guess whether a missing number means zero.
    """

    screen: str
    side: str
    #: How far the joint actually travelled, as a clinician would name it.
    peak: Metric
    #: How far short of the published ceiling that is.
    shortfall: Metric
    #: Repetitions found, and how far each one travelled.
    repetitions: int = 0
    excursions: list[float] = field(default_factory=list)
    #: Spread of the per-repetition excursions, in degrees. None below two.
    consistency: Metric | None = None
    #: Seconds per repetition, and return time over out time.
    tempo: Metric | None = None
    tempo_ratio: Metric | None = None
    #: Direction reversals against the two a clean repetition needs.
    control: Metric | None = None
    #: Seconds held, for a hold screen.
    held: Metric | None = None
    #: Drift of the hips during a hold, as a share of body height.
    sway: Metric | None = None
    frames: int = 0
    confidence: float = 0.0
    #: Anything that changes how the numbers should be read.
    notes: list[str] = field(default_factory=list)

    @property
    def measured(self) -> bool:
        return self.peak.measured

    def to_dict(self) -> dict:
        out = {
            "screen": self.screen,
            "side": self.side,
            "frames": self.frames,
            "confidence": round(self.confidence, 3),
            "repetitions": self.repetitions,
            "excursions": [round(e, 1) for e in self.excursions],
            "notes": list(self.notes),
        }
        for name in ("peak", "shortfall", "consistency", "tempo",
                     "tempo_ratio", "control", "held", "sway"):
            metric = getattr(self, name)
            out[name] = None if metric is None else {
                "value": metric.value,
                "unit": metric.unit,
                "availability": metric.availability.value,
                "confidence": metric.confidence,
                "reason": metric.reason,
                "normal": list(metric.normal) if metric.normal else None,
            }
        return out


# ------------------------------------------------------------------ measuring

#: Ankle separation, as a share of body height, above which the body is on one
#: leg. Standing square the two ankles sit within a percent or two of each
#: other even on an uneven floor; a foot lifted to mid-calf clears a tenth of a
#: body height. Eight percent sits clear of the first and under the second.
SINGLE_LEG_OFFSET = 0.08

#: Degrees the trunk may wander and still count as one held position.
HOLD_TOLERANCE = 8.0


def _window(history: mv.TrackHistory, screen: Screen,
            side: str) -> tuple[list[float], list[float]] | None:
    """The stretch of the clip this screen is measured over.

    For a range screen that is the whole of it. For a balance hold it is the
    longest run of frames with the foot actually off the floor, which is not
    the same thing: a student who wobbles for four seconds, puts the foot
    down, and stands there for twenty has balanced for four. Measuring the
    clip would report twenty, and the number would be wrong in the direction
    that flatters.
    """
    if screen.kind != "hold":
        times, values = history.series(screen.signal_for(side))
        return (times, values) if values else None

    # The standing leg is the one still on the floor, so the offset points
    # away from it: standing on the left means the right foot is up, which is
    # a negative offset by the convention in the movement layer.
    want_positive = side == "right"
    best: tuple[int, int] | None = None
    run_start: int | None = None
    for i, sample in enumerate(history.samples):
        offset = sample.ankle_offset
        up = (offset is not None and abs(offset) >= SINGLE_LEG_OFFSET
              and (offset > 0) == want_positive)
        if up and run_start is None:
            run_start = i
        elif not up and run_start is not None:
            if best is None or i - run_start > best[1] - best[0]:
                best = (run_start, i)
            run_start = None
    if run_start is not None:
        end = len(history.samples)
        if best is None or end - run_start > best[1] - best[0]:
            best = (run_start, end)
    if best is None:
        return None
    times = [s.timestamp for s in history.samples[best[0]:best[1]]]
    values = [s.trunk for s in history.samples[best[0]:best[1]]
              if s.trunk is not None]
    if len(values) != len(times):
        # Trunk lost in part of the window: keep the pairs that survived
        # rather than lining up mismatched lists.
        pairs = [(s.timestamp, s.trunk)
                 for s in history.samples[best[0]:best[1]] if s.trunk is not None]
        times = [t for t, _ in pairs]
        values = [v for _, v in pairs]
    return (times, values) if values else None


def _sway(history: mv.TrackHistory, span: tuple[float, float]) -> float | None:
    """Side-to-side drift of the hips over a window, as a share of body height.

    Normalised by the body rather than left in pixels, because pixels are a
    fact about where the camera was standing. Reported with no reference band:
    nothing published describes camera-measured sway, and inventing a band for
    it would be the one thing this module is written to avoid. It is a number
    to compare against the same person six weeks later.
    """
    times, centres, scales = history.path()
    inside = [(c, s) for t, c, s in zip(times, centres, scales)
              if span[0] <= t <= span[1]]
    if len(inside) < 5:
        return None
    xs = [c[0] for c, _ in inside]
    scale = statistics.median([s for _, s in inside])
    if not scale:
        return None
    return float(statistics.pstdev(xs) / scale)


def _refuse(screen: Screen, side: str, reason: str, frames: int = 0,
            confidence: float = 0.0) -> SideResult:
    """A screen that could not be measured, saying which and why.

    The shape is identical to a successful one. A caller that has to branch on
    whether the answer exists will eventually forget to, and print a blank
    where a reason belongs.
    """
    return SideResult(
        screen=screen.key, side=side,
        peak=_metric(f"{screen.key}_peak", None, screen.unit, reason=reason),
        shortfall=_metric(f"{screen.key}_shortfall", None, screen.unit,
                          reason=reason),
        frames=frames, confidence=confidence, notes=[])


def measure_side(history: mv.TrackHistory, screen: Screen, side: str = "",
                 *, view: View | None = None) -> SideResult:
    """Measure one screen on one side of one student.

    ``view`` is supplied by the caller rather than inferred, on the same
    reasoning as the photograph intake: a studio knows where its camera is,
    and an estimate made from the landmarks being measured is the weaker of
    the two. Supplying nothing is allowed and costs the measurement its
    AVAILABLE standing -- the number is still worth having against the same
    person later, and is not worth comparing against a published range.
    """
    if screen.sided and side not in ("left", "right"):
        raise ValueError(f"{screen.key} is measured per side; got {side!r}")

    signal = screen.signal_for(side)
    confidence = history.confidence(signal)

    # Confidence before frame count, and the order is the message. A joint the
    # estimator was never sure of produces no measurable frames at all, so
    # checking the count first reports "nothing was measured" -- true, useless,
    # and it sends a studio to re-film a clip that was fine. The cause is that
    # the camera could not see the joint.
    if history.samples and confidence < MIN_CONFIDENCE:
        return _refuse(screen, side,
                       f"the joints behind this movement averaged "
                       f"{confidence:.2f} confidence; below {MIN_CONFIDENCE} "
                       f"an angle built on them is the estimator moving rather "
                       f"than the body",
                       frames=len(history.samples), confidence=confidence)

    window = _window(history, screen, side)
    if window is None or len(window[1]) < MIN_FRAMES:
        seen = 0 if window is None else len(window[1])
        if screen.kind == "hold" and window is None:
            return _refuse(screen, side,
                           f"the {side} foot was never seen clear of the floor "
                           f"for long enough to be a balance", confidence=confidence)
        return _refuse(screen, side,
                       f"{seen} frames measured the {signal.replace('_', ' ')}; "
                       f"{MIN_FRAMES} are needed before a range means anything",
                       frames=seen, confidence=confidence)
    times, raw = window
    frames = len(raw)

    scales = [s.scale for s in history.samples if s.scale]
    span = statistics.median(scales) if scales else None
    if span is not None and span < MIN_BODY_PIXELS:
        return _refuse(screen, side,
                       f"the body is {span:.0f} px from shoulder to ankle; "
                       f"below {MIN_BODY_PIXELS} px a degree is inside the "
                       f"landmark noise. Film closer",
                       frames=frames, confidence=confidence)

    off_plane = view is not None and view not in screen.views
    if off_plane:
        wanted = " or ".join(v.value.replace("_", " ") for v in screen.views)
        return _refuse(screen, side,
                       f"filmed from {view.value.replace('_', ' ')}; this "
                       f"movement happens in the plane seen from {wanted}, and "
                       f"from anywhere else it reads short by an amount "
                       f"nothing can recover",
                       frames=frames, confidence=confidence)

    notes: list[str] = []
    estimated = view is None
    if estimated:
        notes.append(
            "the camera angle was not stated. A movement partly toward or "
            "away from the lens reads smaller than it was, so this is a "
            "number to compare against this person's own later screens rather "
            "than against the published range")

    if screen.kind == "hold":
        return _hold_result(history, screen, side, times, raw, frames,
                            confidence, estimated, notes)
    return _range_result(screen, side, times, raw, frames, confidence,
                         estimated, notes)


def _range_result(screen: Screen, side: str, times: list[float],
                  raw: list[float], frames: int, confidence: float,
                  estimated: bool, notes: list[str]) -> SideResult:
    """Turn one angle signal into how far it went and how well."""
    clinical = [screen.clinical(v) for v in raw]
    # Smoothed before the peak is read, and that is not a detail. The largest
    # single frame in a raw signal is the most optimistic piece of keypoint
    # noise in the clip, so a peak taken from it overstates every range in
    # every report, always in the flattering direction.
    steady = mv.smooth(clinical, 5)
    peak = max(steady)

    reps = mv.find_repetitions(times, clinical, min_range=MIN_EXCURSION)
    excursions = [r.range_of_motion for r in reps]
    durations = [r.duration for r in reps]
    ratios = [r.tempo_ratio for r in reps if r.tempo_ratio is not None]

    if not reps:
        notes.append(
            "no complete repetition was seen, so the figure is the furthest "
            "the joint got rather than a range it travelled repeatably")

    shortfall = screen.shortfall(peak)
    result = SideResult(
        screen=screen.key, side=side,
        peak=_metric(f"{screen.key}_peak", peak, screen.unit,
                     confidence=confidence, normal=screen.reference,
                     estimated=estimated),
        shortfall=_metric(f"{screen.key}_shortfall", shortfall, screen.unit,
                          confidence=confidence, estimated=estimated),
        repetitions=len(reps),
        excursions=excursions,
        frames=frames, confidence=confidence, notes=notes,
    )
    if len(excursions) > 1:
        result.consistency = _metric(
            f"{screen.key}_consistency", statistics.pstdev(excursions),
            "deg", confidence=confidence, estimated=estimated)
    if durations:
        result.tempo = _metric(f"{screen.key}_tempo",
                               statistics.mean(durations), "s",
                               confidence=confidence, estimated=estimated)
    if ratios:
        # Below 1 the student let the movement drop back faster than they
        # lifted it, which is the single most common thing a teacher corrects.
        result.tempo_ratio = _metric(f"{screen.key}_tempo_ratio",
                                     statistics.mean(ratios), "ratio",
                                     confidence=confidence, estimated=estimated)
    control = mv.control_ratio(clinical, len(reps))
    if control is not None:
        result.control = _metric(f"{screen.key}_control", control, "ratio",
                                 confidence=confidence, estimated=estimated)
    return result


def _hold_result(history: mv.TrackHistory, screen: Screen, side: str,
                 times: list[float], raw: list[float], frames: int,
                 confidence: float, estimated: bool,
                 notes: list[str]) -> SideResult:
    """Turn a held position into how long it lasted and how still it was."""
    held = times[-1] - times[0] if len(times) > 1 else 0.0
    steady = mv.hold_durations(times, raw, tolerance=HOLD_TOLERANCE, minimum=1.0)
    if steady and max(steady) < held * 0.75:
        notes.append(
            "the trunk moved during the hold, so the time is how long the "
            "foot was up rather than how long the position was kept")
    result = SideResult(
        screen=screen.key, side=side,
        # The reference here is a test ceiling: thirty seconds is where the
        # single-leg stance test stops, not a score to beat.
        peak=_metric(f"{screen.key}_peak", min(held, screen.reference[1]),
                     screen.unit, confidence=confidence,
                     normal=screen.reference, estimated=estimated),
        shortfall=_metric(f"{screen.key}_shortfall",
                          screen.shortfall(min(held, screen.reference[1])),
                          screen.unit, confidence=confidence,
                          estimated=estimated),
        frames=frames, confidence=confidence, notes=notes,
    )
    result.held = _metric(f"{screen.key}_held", held, "s",
                          confidence=confidence, estimated=estimated)
    drift = _sway(history, (times[0], times[-1]))
    result.sway = _metric(
        f"{screen.key}_sway", drift, "ratio", confidence=confidence,
        estimated=estimated,
        reason="" if drift is not None else
        "the hips were not tracked steadily enough through the hold to "
        "measure how far the body drifted")
    return result


# -------------------------------------------------------------- both sides

@dataclass
class ScreenResult:
    """One screen, both sides, and what the difference between them is.

    Left and right are kept whole rather than averaged. Averaging is how a
    body with one shoulder at 180 and the other at 120 comes back reading 150
    and looking unremarkable, which is the opposite of what a screening is
    for: the difference *is* the finding.
    """

    screen: str
    left: SideResult | None = None
    right: SideResult | None = None
    #: Present only for a screen that has no sides.
    both: SideResult | None = None

    @property
    def sides(self) -> list[SideResult]:
        return [s for s in (self.left, self.right, self.both) if s is not None]

    @property
    def measured(self) -> list[SideResult]:
        return [s for s in self.sides if s.measured]

    @property
    def difference(self) -> Metric:
        """Degrees between the two sides, and which one went less far."""
        name = f"{self.screen}_asymmetry"
        screen = SCREENS[self.screen]
        if self.left is None or self.right is None:
            return _metric(name, None, screen.unit,
                           reason="this screen is not measured per side")
        if not (self.left.measured and self.right.measured):
            missing = "left" if not self.left.measured else "right"
            return _metric(
                name, None, screen.unit,
                reason=f"the {missing} side was not measured, so there is "
                       f"nothing to compare the other against")
        gap = abs(float(self.left.peak.value) - float(self.right.peak.value))
        estimated = any(s.peak.availability is Availability.ESTIMATED
                        for s in (self.left, self.right))
        return _metric(name, gap, screen.unit,
                       confidence=min(self.left.confidence, self.right.confidence),
                       normal=(0.0, side_tolerance(screen)), estimated=estimated)

    @property
    def shorter_side(self) -> str:
        """The side that went less far, or "" when they match or are unknown."""
        gap = self.difference
        if not gap.measured or float(gap.value) <= side_tolerance(SCREENS[self.screen]):
            return ""
        return ("left" if float(self.left.peak.value) < float(self.right.peak.value)
                else "right")

    def to_dict(self) -> dict:
        screen = SCREENS[self.screen]
        gap = self.difference
        return {
            "screen": self.screen,
            "name": screen.name,
            "name_ko": screen.name_ko,
            "kind": screen.kind,
            "unit": screen.unit,
            "reference": list(screen.reference),
            "reference_source": screen.reference_source,
            "reference_kind": screen.reference_kind,
            "views": [v.value for v in screen.views],
            "left": self.left.to_dict() if self.left else None,
            "right": self.right.to_dict() if self.right else None,
            "both": self.both.to_dict() if self.both else None,
            "asymmetry": {"value": gap.value, "unit": gap.unit,
                          "availability": gap.availability.value,
                          "reason": gap.reason,
                          "tolerance": side_tolerance(screen)},
            "shorter_side": self.shorter_side,
        }


def measure(histories: dict[str, mv.TrackHistory], screen: Screen, *,
            view: View | None = None) -> ScreenResult:
    """Measure one screen from one clip per side.

    ``histories`` is keyed ``"left"``/``"right"`` for a sided screen, or
    ``"both"`` for one that is not. Separate clips rather than one, because a
    studio films them separately: "lift the left knee three times" is one
    recording and the right leg is another, and asking for both in one take is
    asking for a clip nobody will get right.
    """
    result = ScreenResult(screen=screen.key)
    if screen.sided:
        for side in ("left", "right"):
            history = histories.get(side)
            if history is None:
                setattr(result, side, _refuse(
                    screen, side, f"no recording of the {side} side"))
                continue
            setattr(result, side, measure_side(history, screen, side, view=view))
        return result
    history = histories.get("both") or histories.get("")
    if history is None:
        result.both = _refuse(screen, "", "no recording")
    else:
        result.both = measure_side(history, screen, "", view=view)
    return result


# ------------------------------------------------------------------ findings

#: Severity names, shared with :mod:`pilates.guidance` rather than invented
#: again: a shortfall and a postural deviation appear on the same screen and a
#: reader should not have to learn two vocabularies to read one report.
WITHIN = "within_band"
WATCH = "watch"
NOTABLE = "notable"
MARKED = "marked"
SEVERITIES = (WITHIN, WATCH, NOTABLE, MARKED)


def step_for(screen: Screen) -> float:
    """How much of a shortfall counts as one grade, for this screen.

    A tenth of the published ceiling, rather than the fixed five degrees the
    posture side uses. A fixed step cannot serve both: five degrees is a
    genuine finding on a shoulder line, which should be level, and is nothing
    at all on a shoulder that travels through 180 of them. Scaling by the
    range being measured keeps one grade meaning one comparable amount of
    missing movement -- eighteen degrees of shoulder flexion, nine of squat
    depth, three seconds of balance.
    """
    return screen.reference[1] / 10.0


def noise_floor(screen: Screen) -> float:
    """Missing movement too small to be about the body, for this screen.

    Two things bound it, and both are needed. A measurement is worth about
    five degrees, so a joint five degrees short of the published range reached
    it as far as anything here can tell -- and the smoothing that stops one
    noisy frame setting the range costs a degree or two at the turn besides,
    always in this direction. But five is nonsense on a screen measured in
    seconds, where the whole reference is thirty of them, so the floor is
    never allowed past half of one grade.
    """
    return min(MEASUREMENT_ERROR, step_for(screen) / 2.0)


def side_tolerance(screen: Screen) -> float:
    """How far the two sides may differ on this screen and still be equal.

    Twice a measurement in degrees, and never more than one grade: ten seconds
    between legs on a thirty-second balance is a third of the test, and calling
    that equal would be calling almost anything equal.
    """
    return min(SIDE_TOLERANCE, step_for(screen))


def grade(deviation: float | None, screen: Screen) -> str:
    """How much of a finding a given amount of missing movement is."""
    if deviation is None or deviation <= noise_floor(screen):
        return WITHIN
    step = step_for(screen)
    if step <= 0:
        return WITHIN
    if deviation < step:
        return WATCH
    if deviation < 2 * step:
        return NOTABLE
    return MARKED


def severity(metric: Metric, screen: Screen) -> str:
    """Grade a metric that carries a band the deviation is taken against.

    Only some of them do, and the distinction is the one place this could go
    quietly wrong. The side-to-side gap has a real band -- equal within ten
    degrees -- so its distance outside that band is the finding. A *peak*
    does not: its band is the published range, and every value a body can
    reach lies inside it, so a peak graded this way is unremarkable at 180
    degrees and unremarkable at 20. Peaks are graded on their shortfall
    instead, through :func:`grade`.
    """
    if not metric.measured or metric.normal is None:
        return WITHIN
    return grade(metric.deviation, screen)


SIDE_WORD = {"left": ("left", "왼쪽"), "right": ("right", "오른쪽"),
             "": ("", "")}


@dataclass(frozen=True)
class Finding:
    """One thing a screening found, with the arithmetic that produced it."""

    screen: str
    #: ``range`` -- the joint did not travel as far as the published ceiling.
    #: ``asymmetry`` -- the two sides did not match.
    kind: str
    side: str
    severity: str
    #: What was reached, and what it was compared against.
    reached: float
    reference: float
    gap: float
    unit: str

    def title(self, lang: str = "en") -> str:
        screen = SCREENS[self.screen]
        name = screen.named(lang)
        side = SIDE_WORD.get(self.side, ("", ""))[1 if lang == "ko" else 0]
        if self.kind == "asymmetry":
            if lang == "ko":
                return f"{name}: 좌우 차이"
            return f"{name}: the two sides do not match"
        if lang == "ko":
            return f"{name}{f' ({side})' if side else ''}: 가동 범위 부족"
        return (f"{name}{f' ({side})' if side else ''}: "
                f"short of the reference range")

    def measurement(self, lang: str = "en") -> str:
        screen = SCREENS[self.screen]
        unit = "°" if self.unit == "deg" else (" s" if self.unit == "s" else "")
        if self.kind == "asymmetry":
            side = SIDE_WORD.get(self.side, ("", ""))[1 if lang == "ko" else 0]
            allowed = side_tolerance(screen)
            if lang == "ko":
                return (f"좌우 차이 {self.gap:.0f}{unit} — {side}이 더 적게 "
                        f"움직였습니다 (허용 {allowed:.0f}{unit})")
            return (f"{self.gap:.0f}{unit} between the sides, the {side} one "
                    f"travelling less (equal within {allowed:.0f}{unit})")
        if lang == "ko":
            return (f"기준 {self.reference:.0f}{unit} · 도달 "
                    f"{self.reached:.0f}{unit} · {self.gap:.0f}{unit} 부족")
        return (f"reference {self.reference:.0f}{unit}, reached "
                f"{self.reached:.0f}{unit}, {self.gap:.0f}{unit} short")

    def to_dict(self) -> dict:
        screen = SCREENS[self.screen]
        return {
            "screen": self.screen, "kind": self.kind, "side": self.side,
            "severity": self.severity,
            "reached": round(self.reached, 1),
            "reference": round(self.reference, 1),
            "gap": round(self.gap, 1),
            "unit": self.unit,
            "reference_kind": screen.reference_kind,
            "reference_source": screen.reference_source,
            "title": self.title(), "title_ko": self.title("ko"),
            "measurement": self.measurement(),
            "measurement_ko": self.measurement("ko"),
        }


# ------------------------------------------------------------- the assessment

@dataclass
class ScreeningAssessment:
    """Everything one screening session found, for one student."""

    results: dict[str, ScreenResult] = field(default_factory=dict)
    person_id: str = ""
    #: The day it was filmed, ISO-8601, supplied by the caller. Not defaulted
    #: to today: a clip recorded last week and analysed now would silently
    #: become today's screening, and a progress chart would be wrong.
    taken_on: str = ""
    #: Which camera view each screen was filmed from, when it was stated.
    views: dict[str, View] = field(default_factory=dict)

    # ------------------------------------------------------------- coverage

    @property
    def attempted(self) -> tuple[str, ...]:
        """Screens a recording was supplied for, in catalogue order."""
        return tuple(k for k in SCREENS if k in self.results)

    @property
    def checks(self) -> list[tuple[str, float]]:
        """Every scored check, as (name, 0-100), with nothing hidden.

        A peak against its published ceiling is a straight proportion: reached
        164 of 180 scores 91. A symmetry check is full marks inside the
        tolerance and falls away with the gap beyond it. Both are arithmetic a
        reader can repeat on the numbers printed beside them, which is the
        whole requirement a score has to meet here.
        """
        out: list[tuple[str, float]] = []
        for key in self.attempted:
            screen, result = SCREENS[key], self.results[key]
            ceiling = screen.reference[1]
            for side in result.measured:
                value = float(side.peak.value)
                out.append((f"{key}_{side.side or 'both'}",
                            max(0.0, min(100.0, 100.0 * value / ceiling))
                            if ceiling else 0.0))
            gap = result.difference
            if gap.measured and ceiling:
                over = max(0.0, float(gap.value) - side_tolerance(screen))
                out.append((f"{key}_symmetry",
                            max(0.0, min(100.0, 100.0 * (1.0 - over / ceiling)))))
        return out

    @property
    def measurable(self) -> int:
        """Checks the recordings supplied could have produced.

        The honest denominator, on the same principle as the photograph
        intake: a screening of one shoulder is not scored out of the whole
        body, and one that filmed six screens and measured two is not scored
        as though it filmed two.
        """
        total = 0
        for key in self.attempted:
            screen = SCREENS[key]
            total += 3 if screen.sided else 1
        return total

    def score(self) -> Score:
        """The screening score, on the shared scoring machinery.

        Same class as the posture score, which is what carries the coverage
        rule: a headline is withheld when too little was measured rather than
        computed from whatever happened to work.
        """
        score = Score(measurable=max(1, self.measurable))
        for key in self.attempted:
            comp = Component(key)
            prefix = f"{key}_"
            comp.checks = [(n, v) for n, v in self.checks if n.startswith(prefix)]
            if comp.n:
                score.components[key] = comp
        score.missing = [name for name, _ in self._expected()
                         if name not in {n for n, _ in self.checks}]
        doubts = self.doubts
        if doubts:
            first = doubts[0]
            more = (f", and {len(doubts) - 1} other thing"
                    f"{'s' if len(doubts) > 2 else ''}" if len(doubts) > 1 else "")
            score.blocked = (f"{first}{more}. Film that screen again and the "
                             f"measurements will stand on their own")
        return score

    def _expected(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for key in self.attempted:
            screen = SCREENS[key]
            if screen.sided:
                out += [(f"{key}_left", key), (f"{key}_right", key),
                        (f"{key}_symmetry", key)]
            else:
                out.append((f"{key}_both", key))
        return out

    @property
    def doubts(self) -> list[str]:
        """Reasons to distrust the numbers, rather than gaps in them.

        The same distinction the photograph intake draws, and for the same
        reason. A screen nobody filmed is a gap: coverage records it and
        everything measured is still true. A screen filmed from the wrong
        angle is a doubt: it produces a clean number about a movement the
        camera could not see, and a headline printed over one is the worst
        thing this system can put on a screen.
        """
        out: list[str] = []
        for key in self.attempted:
            screen = SCREENS[key]
            for side in self.results[key].sides:
                if side.measured:
                    continue
                reason = side.peak.reason
                if "no recording" in reason or "frames measured" in reason:
                    continue  # a gap, not a doubt
                where = f" ({side.side})" if side.side else ""
                out.append(f"{screen.name}{where}: {reason}")
        return out

    @property
    def reliable(self) -> bool:
        return not self.doubts and bool(self.attempted)

    # ------------------------------------------------------------- findings

    def findings(self) -> list[Finding]:
        """What was found, worst first.

        A screen inside its reference range produces nothing. That is the
        point of having a reference: reaching it is not an achievement to
        report, it is the absence of a finding.
        """
        found: list[Finding] = []
        for key in self.attempted:
            screen, result = SCREENS[key], self.results[key]
            for side in result.measured:
                short = float(side.shortfall.value or 0.0)
                grading = grade(short, screen)
                if grading == WITHIN:
                    continue
                found.append(Finding(
                    screen=key, kind="range", side=side.side, severity=grading,
                    reached=float(side.peak.value),
                    reference=screen.reference[1],
                    gap=float(side.shortfall.value or 0.0), unit=screen.unit))
            gap = result.difference
            if gap.measured and severity(gap, screen) != WITHIN:
                found.append(Finding(
                    screen=key, kind="asymmetry", side=result.shorter_side,
                    severity=severity(gap, screen),
                    reached=float(gap.value), reference=side_tolerance(screen),
                    gap=float(gap.value), unit=screen.unit))
        order = {name: i for i, name in enumerate(reversed(SEVERITIES))}
        return sorted(found, key=lambda f: (order.get(f.severity, 9), -f.gap))

    def refusals(self) -> list[SideResult]:
        """Every side that could not be measured, each carrying its reason."""
        return [side for key in self.attempted
                for side in self.results[key].sides if not side.measured]

    def to_dict(self) -> dict:
        score = self.score()
        found = self.findings()
        return {
            "person_id": self.person_id,
            "taken_on": self.taken_on,
            "catalogue": list(SCREENS),
            "attempted": list(self.attempted),
            "not_screened": [k for k in SCREENS if k not in self.results],
            "views": {k: v.value for k, v in self.views.items()},
            "overall_score": None if score.value is None else round(score.value, 1),
            "score_withheld_reason": score.withheld_reason,
            "coverage": round(score.coverage, 3),
            "checks": score.checks,
            "check_detail": [{"name": n, "score": round(v, 1)}
                             for n, v in self.checks],
            "components": {n: (None if c.score is None else round(c.score, 1))
                           for n, c in score.components.items()},
            "results": {k: r.to_dict() for k, r in self.results.items()},
            "findings": [f.to_dict() for f in found],
            "doubts": list(self.doubts),
            "reliable": self.reliable,
            "refused": [{"screen": s.screen, "side": s.side,
                         "reason": s.peak.reason} for s in self.refusals()],
        }


def screen_all(clips: dict[str, dict[str, mv.TrackHistory]], *,
               views: dict[str, View] | None = None,
               person_id: str = "", taken_on: str = "") -> ScreeningAssessment:
    """Measure every screen a studio supplied a recording for.

    ``clips`` maps a screen key to that screen's recordings, keyed by side.
    Screens with nothing supplied are simply absent: a screening is whatever
    the studio had time to film, and scoring a two-screen session out of six
    would punish a studio for not filming the other four.
    """
    views = views or {}
    out = ScreeningAssessment(person_id=person_id, taken_on=taken_on,
                              views=dict(views))
    for key, histories in clips.items():
        screen = SCREENS.get(key)
        if screen is None:
            raise KeyError(f"no such screen: {key!r}")
        out.results[key] = measure(histories, screen, view=views.get(key))
    return out


# ------------------------------------------------------------- then and now

@dataclass(frozen=True)
class ScreenChange:
    """One screen's measurement, then and now."""

    screen: str
    side: str
    before: float | None
    after: float | None
    unit: str
    comparable: bool
    reason: str = ""

    @property
    def difference(self) -> float | None:
        if not self.comparable or self.before is None or self.after is None:
            return None
        return round(self.after - self.before, 1)

    def sentence(self, lang: str = "en") -> str:
        screen = SCREENS[self.screen]
        name = screen.named(lang)
        side = SIDE_WORD.get(self.side, ("", ""))[1 if lang == "ko" else 0]
        if not self.comparable:
            return (f"{name}: 비교 불가 — {self.reason}" if lang == "ko"
                    else f"{name}: not compared — {self.reason}")
        delta = self.difference or 0.0
        unit = "°" if self.unit == "deg" else (" s" if self.unit == "s" else "")
        if lang == "ko":
            way = "더 멀리" if delta > 0 else ("더 적게" if delta < 0 else "동일")
            return (f"{name}{f' ({side})' if side else ''}: "
                    f"{self.before:.0f}{unit} → {self.after:.0f}{unit} "
                    f"({abs(delta):.0f}{unit} {way})")
        way = ("further" if delta > 0 else
               ("less far" if delta < 0 else "unchanged"))
        return (f"{name}{f' ({side})' if side else ''}: "
                f"{self.before:.0f}{unit} → {self.after:.0f}{unit} "
                f"({abs(delta):.0f}{unit} {way})")

    def to_dict(self) -> dict:
        return {"screen": self.screen, "side": self.side,
                "before": self.before, "after": self.after,
                "unit": self.unit, "comparable": self.comparable,
                "reason": self.reason, "difference": self.difference,
                "sentence": self.sentence(), "sentence_ko": self.sentence("ko")}


#: The sentence that refuses to turn a difference into a verdict. A joint that
#: travels further travels further; whether that is progress is a judgement
#: for the person teaching, who knows what the six weeks contained.
JUDGEMENT = ("A joint that travelled further travelled further. Whether that "
             "is progress is a judgement for the person teaching.")
JUDGEMENT_KO = ("더 멀리 움직였다는 것은 더 멀리 움직였다는 뜻입니다. 그것이 "
                "발전인지는 지도하는 사람이 판단할 일입니다.")


def compare(before: ScreeningAssessment,
            after: ScreeningAssessment) -> dict:
    """Two screenings of the same student, side by side.

    Only screens both sessions measured are compared, and only when both were
    filmed from a view the screen allows. Comparing a shoulder flexion filmed
    from the side against one filmed from the front would put a foreshortening
    error into a progress number and call it a change in the body.
    """
    changes: list[ScreenChange] = []
    for key in SCREENS:
        old, new = before.results.get(key), after.results.get(key)
        if old is None or new is None:
            continue
        screen = SCREENS[key]
        old_view, new_view = before.views.get(key), after.views.get(key)
        plane_shift = (old_view is not None and new_view is not None
                       and old_view is not new_view
                       and old_view.is_frontal is not new_view.is_frontal)
        for side in ("left", "right", "both"):
            a = getattr(old, side, None)
            b = getattr(new, side, None)
            if a is None and b is None:
                continue
            if plane_shift:
                changes.append(ScreenChange(
                    key, side if side != "both" else "", None, None,
                    screen.unit, False,
                    "filmed from a different plane the second time, so the "
                    "two numbers are not measurements of the same thing"))
                continue
            if a is None or b is None or not (a.measured and b.measured):
                missing = "the first" if a is None or not a.measured else "the second"
                changes.append(ScreenChange(
                    key, side if side != "both" else "", None, None,
                    screen.unit, False,
                    f"{missing} screening did not measure it"))
                continue
            changes.append(ScreenChange(
                key, side if side != "both" else "",
                float(a.peak.value), float(b.peak.value), screen.unit, True))

    before_score = before.score()
    after_score = after.score()
    both = before_score.value is not None and after_score.value is not None
    return {
        "before_taken_on": before.taken_on,
        "after_taken_on": after.taken_on,
        "score_before": None if before_score.value is None else round(before_score.value, 1),
        "score_after": None if after_score.value is None else round(after_score.value, 1),
        # Withheld whenever either side is: a difference against a number that
        # was not printed is a number nobody can check.
        "score_change": (round(after_score.value - before_score.value, 1)
                         if both else None),
        "changes": [c.to_dict() for c in changes],
        "compared": sum(1 for c in changes if c.comparable),
        "judgement": JUDGEMENT,
        "judgement_ko": JUDGEMENT_KO,
    }


#: What a screening report must carry, word for word, wherever it is shown.
#: Not a footer to be styled small: it is the sentence that decides how
#: everything above it is allowed to be read.
#:
#: Worded for movement rather than reusing the posture one. The claim being
#: limited here is different and more tempting to overreach on: a range of
#: motion compared against a published clinical figure looks like a clinical
#: result, and the second sentence exists because that resemblance is the
#: thing a reader has to be warned about rather than reassured by.
DISCLAIMER = (
    "This is a measurement of how far joints moved on camera, for training "
    "purposes. The reference ranges are published figures measured by "
    "clinicians with a goniometer on an isolated limb; a camera watching a "
    "whole person is a screening tool and not that instrument. It is not a "
    "medical assessment, it does not diagnose any condition, and it should "
    "not be used in place of advice from a qualified clinician.")

DISCLAIMER_KO = (
    "본 자료는 카메라로 측정한 관절 가동 범위이며 운동 지도를 위한 참고용입니다. "
    "기준 범위는 임상에서 각도계로 사지를 분리해 측정한 공개 수치이며, 전신을 "
    "촬영하는 카메라는 선별 도구일 뿐 그 장비가 아닙니다. 의학적 진단이 아니며, "
    "전문 의료인의 진료를 대신할 수 없습니다.")
