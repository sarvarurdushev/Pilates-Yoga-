"""Movement over time: repetitions, range, tempo and control.

A single frame says where a body is. Pilates is about how it moves, so
everything worth coaching lives in the sequence: how far the movement went,
how long it took, whether it was controlled, whether the two sides matched.

This layer turns the per-frame geometry the pipeline already produces into
per-student time series and then into repetition-level measurements. It is
deliberately signal processing rather than machine learning: no training data
is required, every number is traceable to an angle in a frame, and an
instructor can check any of it by eye.

Naming the exercise being performed is a separate problem that does need
labelled data. This layer produces the input such a classifier would consume.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

from . import keypoints as kp
from .geometry import STANDARD_ANGLES, standard_angles, trunk_angle, whole_body
from .types import Detection


#: Which keypoints each candidate signal is computed from.
SIGNAL_JOINTS: dict[str, tuple[int, ...]] = {
    "trunk": kp.TRUNK,
    "shoulder_tilt": (kp.L_SHOULDER, kp.R_SHOULDER),
    "pelvis_tilt": (kp.L_HIP, kp.R_HIP),
    "neck": (kp.L_EAR, kp.R_EAR, kp.L_SHOULDER, kp.R_SHOULDER),
}
SIGNAL_JOINTS.update({name: (a, b, c) for name, a, b, c in STANDARD_ANGLES})


@dataclass
class Sample:
    """One student, one frame."""

    timestamp: float
    angles: dict[str, float | None]
    trunk: float | None
    confidence: float
    #: Mean keypoint confidence of the joints each angle was computed from.
    #: An angle is only as trustworthy as the joints behind it.
    angle_confidence: dict[str, float] = field(default_factory=dict)


@dataclass
class TrackHistory:
    """Every sample recorded for one tracked student."""

    track_id: int
    samples: list[Sample] = field(default_factory=list)

    def add(self, timestamp: float, detection: Detection, threshold: float) -> None:
        self.samples.append(
            Sample(
                timestamp=timestamp,
                # The whole body, not the six joints this began with. Video is
                # not kept, so an angle not taken here is gone with it.
                angles=whole_body(detection, threshold),
                trunk=trunk_angle(detection, threshold),
                confidence=detection.confidence,
                angle_confidence={
                    signal: float(sum(detection.scores[j] for j in joints) / len(joints))
                    for signal, joints in SIGNAL_JOINTS.items()
                },
            )
        )

    def confidence(self, signal: str) -> float:
        """Mean confidence of the joints behind one signal, across the clip."""
        values = [s.angle_confidence.get(signal, 0.0) for s in self.samples]
        return statistics.mean(values) if values else 0.0

    def series(self, signal: str) -> tuple[list[float], list[float]]:
        """Timestamps and values for one signal, skipping unmeasured frames."""
        times: list[float] = []
        values: list[float] = []
        for sample in self.samples:
            value = sample.trunk if signal == "trunk" else sample.angles.get(signal)
            if value is not None:
                times.append(sample.timestamp)
                values.append(value)
        return times, values

    @property
    def duration(self) -> float:
        if len(self.samples) < 2:
            return 0.0
        return self.samples[-1].timestamp - self.samples[0].timestamp


def smooth(values: list[float], window: int = 5) -> list[float]:
    """Centred moving average.

    Keypoint jitter of a degree or two would otherwise register as extra
    direction changes and inflate both the repetition count and the roughness
    score.
    """
    if window <= 1 or len(values) < window:
        return list(values)
    half = window // 2
    out: list[float] = []
    for i in range(len(values)):
        lo, hi = max(0, i - half), min(len(values), i + half + 1)
        out.append(sum(values[lo:hi]) / (hi - lo))
    return out


def _extrema(values: list[float], prominence: float) -> list[tuple[int, str]]:
    """Alternating peaks and troughs that clear ``prominence`` degrees.

    Walks the signal tracking the running extreme, and commits a turning point
    only once the signal has reversed by more than ``prominence``. Small wobbles
    never commit, so noise cannot create a repetition.
    """
    if len(values) < 3:
        return []
    points: list[tuple[int, str]] = []
    best_i, best_v = 0, values[0]
    direction: str | None = None
    for i, v in enumerate(values):
        if direction in (None, "up"):
            if v >= best_v:
                best_i, best_v = i, v
            elif best_v - v > prominence:
                points.append((best_i, "peak"))
                direction = "down"
                best_i, best_v = i, v
        if direction == "down":
            if v <= best_v:
                best_i, best_v = i, v
            elif v - best_v > prominence:
                points.append((best_i, "trough"))
                direction = "up"
                best_i, best_v = i, v
    return points


def rhythm_regularity(values: list[float], prominence: float = 7.5) -> float:
    """How evenly spaced a signal's turning points are, 0..1.

    A set of repetitions turns around at regular intervals. A yoga flow -- a
    sequence of different poses -- turns around at irregular ones, and a
    one-way movement barely turns around at all.

    Autocorrelation was tried first and does not work here: any signal with a
    trend correlates strongly with itself at short lags, so a steady one-way
    ramp scored 0.99, indistinguishable from a clean five-rep set. What
    separates them is not self-similarity but *recurrence at a steady period*,
    which is exactly what evenly spaced turning points are.

    Returns 0 when there are too few turning points to have a rhythm at all.
    """
    turns = _extrema(smooth(values, 5), prominence=prominence)
    if len(turns) < 4:
        return 0.0
    gaps = [b[0] - a[0] for a, b in zip(turns, turns[1:])]
    gaps = [g for g in gaps if g > 0]
    if len(gaps) < 3:
        return 0.0
    mean_gap = statistics.mean(gaps)
    if mean_gap <= 0:
        return 0.0
    # Coefficient of variation, inverted: even spacing scores near 1.
    spread = statistics.pstdev(gaps) / mean_gap
    return max(0.0, min(1.0, 1.0 - spread))


#: Turning-point regularity below which a signal is a sequence of poses
#: rather than a set of repetitions.
MIN_RHYTHM = 0.5

#: Repetitions required before a movement counts as a set at all.
MIN_REPETITIONS = 2


@dataclass
class Repetition:
    """One complete out-and-back cycle of a movement."""

    start: float
    end: float
    #: Degrees travelled between the turning points that bound this rep.
    range_of_motion: float
    #: Seconds spent moving away from the start position.
    out_duration: float
    #: Seconds spent returning.
    back_duration: float

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def tempo_ratio(self) -> float | None:
        """Return time divided by out time.

        Pilates generally asks for a controlled return. A ratio below 1 means
        the student let the movement drop back faster than they lifted it.
        """
        return self.back_duration / self.out_duration if self.out_duration > 0 else None


def find_repetitions(
    times: list[float],
    values: list[float],
    min_range: float = 15.0,
    smoothing: int = 5,
) -> list[Repetition]:
    """Detect repetitions in one angle signal.

    ``min_range`` is the smallest angular excursion counted as a repetition,
    in degrees. Below roughly 15 degrees the movement is indistinguishable
    from postural sway and keypoint noise.
    """
    if len(values) < 5:
        return []
    smoothed = smooth(values, smoothing)
    points = _extrema(smoothed, prominence=min_range / 2.0)
    reps: list[Repetition] = []
    # Step two turning points at a time. A repetition spans peak-trough-peak,
    # so the next one begins at the third point, not the second -- advancing by
    # one would count every overlapping triple and roughly double the tally.
    for i in range(0, len(points) - 2, 2):
        (a, kind_a), (b, _), (c, kind_c) = points[i], points[i + 1], points[i + 2]
        if kind_a != kind_c:
            continue  # not a full there-and-back
        excursion = abs(smoothed[b] - smoothed[a])
        if excursion < min_range:
            continue
        reps.append(
            Repetition(
                start=times[a],
                end=times[c],
                range_of_motion=excursion,
                out_duration=times[b] - times[a],
                back_duration=times[c] - times[b],
            )
        )
    return reps


def direction_changes(values: list[float]) -> int | None:
    """How many times the smoothed signal reversed direction."""
    if len(values) < 4:
        return None
    smoothed = smooth(values, 5)
    deltas = [b - a for a, b in zip(smoothed, smoothed[1:]) if b != a]
    if len(deltas) < 2:
        return 0
    return sum(1 for a, b in zip(deltas, deltas[1:]) if (a > 0) != (b > 0))


def control_ratio(values: list[float], repetitions: int) -> float | None:
    """Direction reversals against the minimum the movement required.

    A clean repetition reverses direction exactly twice, so a perfectly
    controlled set scores ``1.0`` and a wobbly one scores higher.

    Normalising by repetitions matters: a raw reversals-per-sample rate makes
    a student doing fast repetitions look less controlled than one doing slow
    ones, when both may be equally smooth. Returns ``None`` when no repetition
    was detected, because there is then nothing to normalise against -- an
    isometric hold is not a rough repetition.
    """
    if repetitions <= 0:
        return None
    changes = direction_changes(values)
    if changes is None:
        return None
    return changes / (2 * repetitions)


def hold_durations(
    times: list[float], values: list[float], tolerance: float = 5.0, minimum: float = 1.0
) -> list[float]:
    """Lengths of periods where the angle stayed within ``tolerance`` degrees.

    Isometric holds are half of mat work and are invisible to repetition
    counting, which by definition needs movement.
    """
    if len(values) < 2:
        return []
    holds: list[float] = []
    start, reference = 0, values[0]
    for i in range(1, len(values)):
        if abs(values[i] - reference) > tolerance:
            span = times[i - 1] - times[start]
            if span >= minimum:
                holds.append(span)
            start, reference = i, values[i]
    span = times[-1] - times[start]
    if span >= minimum:
        holds.append(span)
    return holds


@dataclass
class MovementSummary:
    """What one student did, over one clip, on one signal."""

    track_id: int
    #: Angle the movement numbers were measured on, or None when the student
    #: held a position rather than repeating one.
    signal: str | None
    #: "repetitive" (a countable set), "sequence" (a flow of different poses),
    #: or "held" (an isometric position). Repetition, tempo and control
    #: numbers are only meaningful for "repetitive".
    kind: str
    samples: int
    duration: float
    repetitions: int
    mean_range: float | None
    range_consistency: float | None
    mean_rep_duration: float | None
    mean_tempo_ratio: float | None
    #: Direction reversals against the two a clean repetition needs. 1.0 ideal.
    control_ratio: float | None
    #: Mean keypoint confidence behind the signal these numbers came from.
    signal_confidence: float
    longest_hold: float | None
    mean_symmetry: dict[str, float | None] = field(default_factory=dict)


#: Angles considered when choosing what a student's movement is "about".
CANDIDATE_SIGNALS = (
    "trunk", "left_knee", "right_knee", "left_hip", "right_hip",
    "left_elbow", "right_elbow",
)


def signal_quality(values: list[float]) -> float:
    """Purposeful movement divided by jitter, for one angle signal.

    Picking the widest-ranging joint sounds right and is not: on real mat
    footage it selects an elbow every time, because arms swing freely and
    wrist and elbow keypoints are the least stable in the skeleton. Spread
    alone cannot tell a large deliberate movement from a noisy estimate of a
    small one.

    So compare the smoothed signal against what smoothing removed. A hip
    driving a bridge has a large smooth component and a small residual; a
    jittery elbow has the opposite, whatever its raw spread.
    """
    if len(values) < 5:
        return 0.0
    smoothed = smooth(values, 5)
    residual = [v - s for v, s in zip(values, smoothed)]
    noise = statistics.pstdev(residual) if len(residual) > 1 else 0.0
    movement = statistics.pstdev(smoothed)
    return movement / (noise + 1.0)


#: Below this mean joint confidence a signal is not trusted to drive a report.
MIN_SIGNAL_CONFIDENCE = 0.5


def dominant_signal(
    history: TrackHistory, min_spread: float = 5.0, min_confidence: float = MIN_SIGNAL_CONFIDENCE
) -> str | None:
    """The angle the exercise is actually about.

    Scored on smoothness-to-jitter *and* on how confident the underlying
    keypoints were. Both are needed. On real mat footage the arms of a student
    lying prone point towards the camera, so the elbow is heavily foreshortened
    and its keypoint wanders across tens of degrees. That wander is smooth
    enough to score well on shape alone, and it is not movement -- it is the
    pose estimator losing the joint. Weighting by confidence demotes it, and
    the confidence floor rejects it outright when nothing better exists.
    """
    best, best_score = None, 0.0
    for signal in CANDIDATE_SIGNALS:
        _, values = history.series(signal)
        if len(values) < 5 or statistics.pstdev(values) < min_spread:
            continue
        confidence = history.confidence(signal)
        if confidence < min_confidence:
            continue
        score = signal_quality(values) * confidence
        if score > best_score:
            best, best_score = signal, score
    return best


def summarise(
    history: TrackHistory, signal: str | None = None, min_range: float = 15.0
) -> MovementSummary | None:
    """Reduce one student's history to session-level numbers."""
    if len(history.samples) < 5:
        return None

    chosen = signal or dominant_signal(history)

    if chosen is None:
        # Nothing moved enough, or nothing that moved was tracked confidently.
        # That is a real and common answer -- half of mat work is isometric --
        # so report the hold rather than inventing repetitions from noise.
        kind = "held"
        times, values = history.series("trunk")
        reps: list[Repetition] = []
        holds = hold_durations(times, values) if len(values) >= 2 else []
    else:
        times, values = history.series(chosen)
        if len(values) < 5:
            return None
        holds = hold_durations(times, values)
        if rhythm_regularity(values, prominence=min_range / 2.0) < MIN_RHYTHM:
            # A flow, not a set. Counting repetitions here would report the
            # single rise and fall spanning the whole sequence as one very
            # slow repetition, and divide the control score by it.
            kind = "sequence"
            reps = []
        else:
            reps = find_repetitions(times, values, min_range=min_range)
            # A rhythm needs something to repeat against. One cycle spanning
            # most of the clip is the whole sequence read as a single very slow
            # repetition -- the exact artefact the rhythm check exists to catch,
            # slipping through because two turning points can look evenly
            # spaced by accident.
            kind = "repetitive" if len(reps) >= MIN_REPETITIONS else "sequence"
            if kind == "sequence":
                reps = []

    ranges = [r.range_of_motion for r in reps]
    durations = [r.duration for r in reps]
    ratios = [r.tempo_ratio for r in reps if r.tempo_ratio is not None]

    symmetry: dict[str, float | None] = {}
    for joint in ("knee", "hip", "elbow"):
        diffs = [
            abs(s.angles[f"left_{joint}"] - s.angles[f"right_{joint}"])
            for s in history.samples
            if s.angles.get(f"left_{joint}") is not None
            and s.angles.get(f"right_{joint}") is not None
        ]
        symmetry[joint] = statistics.mean(diffs) if diffs else None

    return MovementSummary(
        track_id=history.track_id,
        signal=chosen,
        kind=kind,
        samples=len(history.samples),
        duration=history.duration,
        repetitions=len(reps),
        mean_range=statistics.mean(ranges) if ranges else None,
        # Standard deviation of range across reps: a student who fades over a
        # set shows a rising spread even when the mean looks respectable.
        range_consistency=statistics.pstdev(ranges) if len(ranges) > 1 else None,
        mean_rep_duration=statistics.mean(durations) if durations else None,
        mean_tempo_ratio=statistics.mean(ratios) if ratios else None,
        control_ratio=control_ratio(values, len(reps)) if kind == "repetitive" else None,
        signal_confidence=history.confidence(chosen) if chosen else 0.0,
        longest_hold=max(holds) if holds else None,
        mean_symmetry=symmetry,
    )


#: Identities per tracked student above which per-student reports are not
#: trustworthy. Derived from measurement: a well-framed studio class runs at
#: 1.02, a packed hall at 3.35.
MAX_TRUSTWORTHY_CHURN = 1.5


@dataclass
class SessionQuality:
    """Whether this class was tracked well enough to report on individuals."""

    frames: int
    mean_people: float
    distinct_tracks: int
    median_track_frames: float

    @property
    def churn(self) -> float:
        """Identities issued per student actually present. 1.0 is perfect."""
        return self.distinct_tracks / self.mean_people if self.mean_people else 0.0

    @property
    def coverage(self) -> float:
        """Fraction of the class each track was followed for, on average."""
        return self.median_track_frames / self.frames if self.frames else 0.0

    @property
    def reliable(self) -> bool:
        return self.churn <= MAX_TRUSTWORTHY_CHURN

    def explain(self) -> str:
        if self.reliable:
            return (
                f"Tracking is sound: {self.churn:.2f} identities per student, "
                f"each followed for {self.coverage * 100:.0f}% of the class."
            )
        return (
            f"Tracking is too unstable to report on individuals: "
            f"{self.churn:.2f} identities per student (needs {MAX_TRUSTWORTHY_CHURN}), "
            f"each followed for only {self.coverage * 100:.0f}% of the class. "
            f"Every per-student number below would describe a fragment of somebody, "
            f"not a person. Fix the camera view before trusting any of it."
        )


class SessionRecorder:
    """Accumulates per-student history across a whole class.

    Fed :class:`~pilates.types.FrameResult` objects as the pipeline produces
    them; produces one :class:`MovementSummary` per student at the end, plus a
    :class:`SessionQuality` saying whether those summaries mean anything.

    The quality check exists because the failure is otherwise silent. Run
    against a packed hall this class will cheerfully return 58 confident
    report cards for 60 students, each built from a third of one person's
    time -- output that looks entirely plausible and is worthless. A teacher
    reading it would have no way to tell.
    """

    def __init__(self, keypoint_threshold: float = 0.4, min_range: float = 15.0) -> None:
        self.keypoint_threshold = keypoint_threshold
        self.min_range = min_range
        self.histories: dict[int, TrackHistory] = {}
        self._frames = 0
        self._people_seen = 0

    def observe(self, result) -> None:
        self._frames += 1
        self._people_seen += len(result.people)
        for person in result.people:
            history = self.histories.setdefault(
                person.track_id, TrackHistory(track_id=person.track_id)
            )
            history.add(result.timestamp, person.detection, self.keypoint_threshold)

    def quality(self) -> SessionQuality:
        lengths = [len(h.samples) for h in self.histories.values()]
        return SessionQuality(
            frames=self._frames,
            mean_people=self._people_seen / self._frames if self._frames else 0.0,
            distinct_tracks=len(self.histories),
            median_track_frames=statistics.median(lengths) if lengths else 0.0,
        )

    def summaries(self, min_samples: int = 10) -> list[MovementSummary]:
        """One summary per student with enough data to say anything about.

        Students seen only briefly are dropped rather than reported with
        meaningless numbers: a two-frame track has no range of motion.
        """
        out: list[MovementSummary] = []
        for history in sorted(self.histories.values(), key=lambda h: h.track_id):
            if len(history.samples) < min_samples:
                continue
            summary = summarise(history, min_range=self.min_range)
            if summary is not None:
                out.append(summary)
        return out
