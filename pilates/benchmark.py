"""Resolution sweep: how many pixels does a student need?

Detection and identity fail for different reasons. Detection fails when a
student is too small for the model to find at all; identity fails earlier,
when a student is found but carries too little appearance and geometry for the
tracker to match them to the same person in the next frame.

This sweep isolates that. It takes footage where tracking is known to work,
downscales it in steps, and measures where each capability breaks. Because
only the pixel count changes -- same scene, same poses, same occlusion, same
lighting -- the resulting threshold is a property of pixels-per-student rather
than of that particular room.

The output is a camera specification: the minimum on-sensor height a student
must occupy for per-student history to hold.
"""
from __future__ import annotations

import statistics
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .config import StudioConfig
from .pipeline import Pipeline


@dataclass
class ScaleResult:
    """What the pipeline achieved at one downscale factor."""

    scale: float
    width: int
    height: int
    frames: int
    #: Median bounding-box height of a detected person, in pixels.
    median_person_px: float
    mean_people: float
    #: Distinct track IDs created across the clip.
    distinct_ids: int
    #: distinct_ids / expected_people. Measures coverage and identity together.
    fragmentation: float
    #: distinct_ids / people actually found per frame. This is the identity
    #: metric: it asks how many identities each *tracked* student was given,
    #: independent of how many students were missed entirely. Fragmentation
    #: alone flatters a run with poor recall, because undetected students
    #: cannot churn.
    churn: float
    median_track_life: float
    mean_confidence: float
    mean_visible_joints: float

    @property
    def detection_recall(self) -> float:
        """Mean people found per frame, as a fraction of the expected count."""
        return self._recall

    _recall: float = field(default=0.0, repr=False)

    @property
    def identity_holds(self) -> bool:
        """Whether per-student history is usable at this scale.

        Judged on :attr:`churn`, not fragmentation: a run that finds half the
        room and then loses every one of them scores well on fragmentation and
        is still useless. Churn at or below 1.5 means each tracked student was
        given at most one-and-a-half identities across the clip -- occasional
        breaks that can be stitched up afterwards. Beyond that, identities
        turn over faster than any downstream history can absorb.
        """
        return self.churn <= 1.5


def sweep(
    video: str,
    scales: list[float],
    expected_people: int,
    config: StudioConfig | None = None,
    start_frame: int = 0,
    end_frame: int | None = None,
    stride: int = 10,
    backend_factory=None,
) -> list[ScaleResult]:
    """Run the pipeline over ``video`` at each scale and measure degradation.

    ``expected_people`` is the true number of people in the clip, counted by
    hand. Everything is measured relative to it.
    """
    import cv2

    results: list[ScaleResult] = []
    base_config = config or StudioConfig()

    for scale in scales:
        cap = cv2.VideoCapture(video)
        if not cap.isOpened():
            raise IOError(f"could not open {video}")
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        last = total - 1 if end_frame is None else min(end_frame, total - 1)

        pipeline = Pipeline(
            config=base_config,
            backend=backend_factory() if backend_factory else None,
        )
        pipeline.reset()

        heights: list[float] = []
        confidences: list[float] = []
        joints: list[int] = []
        per_frame: list[int] = []
        id_counts: Counter[int] = Counter()
        width = height = 0
        frames = 0

        for index in range(start_frame, last + 1, stride):
            cap.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, frame = cap.read()
            if not ok:
                continue
            if scale != 1.0:
                frame = cv2.resize(
                    frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA
                )
            height, width = frame.shape[:2]
            result = pipeline.process_frame(frame, index, index / 30.0)
            frames += 1
            per_frame.append(result.n_people)
            for person in result.people:
                id_counts[person.track_id] += 1
                box = person.detection.bbox(base_config.keypoint_threshold)
                if box:
                    heights.append(box[3] - box[1])
                confidences.append(person.detection.confidence)
                joints.append(person.detection.n_visible(base_config.keypoint_threshold))
        cap.release()

        mean_people = statistics.mean(per_frame) if per_frame else 0.0
        lives = list(id_counts.values())
        results.append(
            ScaleResult(
                scale=scale,
                width=width,
                height=height,
                frames=frames,
                median_person_px=statistics.median(heights) if heights else 0.0,
                mean_people=mean_people,
                distinct_ids=len(id_counts),
                fragmentation=len(id_counts) / expected_people if expected_people else 0.0,
                churn=len(id_counts) / mean_people if mean_people else 0.0,
                median_track_life=statistics.median(lives) if lives else 0.0,
                mean_confidence=statistics.mean(confidences) if confidences else 0.0,
                mean_visible_joints=statistics.mean(joints) if joints else 0.0,
                _recall=mean_people / expected_people if expected_people else 0.0,
            )
        )
    return results


def crowding(boxes: list[tuple[float, float, float, float]]) -> tuple[float, float] | None:
    """Separation and overlap for one frame's detections.

    Returns ``(median separation, median overlap)`` where separation is the
    distance to the nearest other person divided by this person's box height,
    and overlap is the fraction of this person's box covered by their nearest
    neighbour. Overlap is the more trustworthy of the two: it needs no
    normalisation, so it compares cleanly between a room of standing students
    and a room of people lying down.
    """
    if len(boxes) < 2:
        return None
    separations: list[float] = []
    overlaps: list[float] = []
    for i, box in enumerate(boxes):
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        height = box[3] - box[1]
        area = (box[2] - box[0]) * height
        nearest = None
        worst_overlap = 0.0
        for j, other in enumerate(boxes):
            if i == j:
                continue
            ox, oy = (other[0] + other[2]) / 2, (other[1] + other[3]) / 2
            distance = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
            if nearest is None or distance < nearest:
                nearest = distance
            ix0, iy0 = max(box[0], other[0]), max(box[1], other[1])
            ix1, iy1 = min(box[2], other[2]), min(box[3], other[3])
            inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
            if area > 0:
                worst_overlap = max(worst_overlap, inter / area)
        if nearest is not None and height > 0:
            separations.append(nearest / height)
            overlaps.append(worst_overlap)
    if not separations:
        return None
    return statistics.median(separations), statistics.median(overlaps)


#: Measured limits, from a controlled downscale sweep plus two real classes.
#: See the README for the experiments these come from.
MIN_PERSON_PX = 30       # below this, detection recall starts falling
MAX_NEIGHBOUR_OVERLAP = 0.15  # above this, identity churns faster than it holds


def minimum_person_height(results: list[ScaleResult]) -> float | None:
    """Smallest measured person height at which identity still held.

    Returns ``None`` if identity held at no scale.
    """
    holding = [r for r in results if r.identity_holds and r.median_person_px > 0]
    return min(r.median_person_px for r in holding) if holding else None


def required_sensor_height(person_px: float, frame_fraction: float) -> int:
    """Sensor rows needed so a student occupies ``person_px``.

    ``frame_fraction`` is the share of frame height that student spans in the
    intended shot -- measure it once from a test photo at the real camera
    position. A student filling a quarter of the frame at a 100px requirement
    needs a 400-row sensor.
    """
    if not 0.0 < frame_fraction <= 1.0:
        raise ValueError("frame_fraction must be in (0, 1]")
    return int(round(person_px / frame_fraction))


def format_table(results: list[ScaleResult]) -> str:
    """Render a sweep as a fixed-width table."""
    head = (
        f"{'scale':>6} {'frame':>11} {'person_px':>10} {'found':>7} "
        f"{'recall':>7} {'ids':>5} {'churn':>6} {'life':>6} {'conf':>6} {'joints':>7} {'identity':>9}"
    )
    lines = [head, "-" * len(head)]
    for r in results:
        lines.append(
            f"{r.scale:>6.3f} {f'{r.width}x{r.height}':>11} {r.median_person_px:>10.0f} "
            f"{r.mean_people:>7.2f} {r.detection_recall * 100:>6.0f}% {r.distinct_ids:>5d} "
            f"{r.churn:>6.2f} {r.median_track_life:>6.0f} {r.mean_confidence:>6.2f} "
            f"{r.mean_visible_joints:>7.1f} {'HOLDS' if r.identity_holds else 'breaks':>9}"
        )
    return "\n".join(lines)
