"""Rejection stages that sit between the pose model and the tracker.

Two failure modes showed up when RTMO was benchmarked on real studio footage,
and both are handled here:

* **Mirror reflections.** A reflected instructor scored 0.81 -- as confident as
  a real person. Studios are full of mirrors, so reflections must be excluded
  by geometry, not by confidence.
* **Duplicate skeletons.** The model sometimes returns two overlapping
  skeletons for one body, which would otherwise become two tracked students.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from .geometry import Box, iou, overlap_fraction
from .types import Detection


@dataclass(frozen=True)
class ExclusionZone:
    """A rectangle of the frame where detections are not real people.

    Use for mirrors, glass partitions, doorways onto a corridor, or a reception
    area visible behind the studio.
    """

    name: str
    box: Box
    #: Fraction of a detection's area that must fall inside the zone to reject it.
    min_overlap: float = 0.6

    def __post_init__(self) -> None:
        # Zones usually arrive from JSON, where a tuple round-trips as a list.
        # Normalise so equality and typing hold however the zone was built.
        if len(self.box) != 4:
            raise ValueError(f"box must have 4 values, got {len(self.box)}")
        object.__setattr__(self, "box", tuple(float(v) for v in self.box))

    def rejects(self, det_box: Box) -> bool:
        return overlap_fraction(det_box, self.box) >= self.min_overlap


def apply_exclusion_zones(
    detections: Sequence[Detection],
    zones: Iterable[ExclusionZone],
    keypoint_threshold: float,
) -> tuple[list[Detection], list[Detection]]:
    """Split detections into (kept, excluded)."""
    zones = list(zones)
    if not zones:
        return list(detections), []
    kept: list[Detection] = []
    excluded: list[Detection] = []
    for det in detections:
        box = det.bbox(keypoint_threshold)
        if box is not None and any(z.rejects(box) for z in zones):
            excluded.append(det)
        else:
            kept.append(det)
    return kept, excluded


def suppress_duplicates(
    detections: Sequence[Detection],
    keypoint_threshold: float,
    iou_threshold: float = 0.55,
) -> tuple[list[Detection], list[Detection]]:
    """Greedy non-maximum suppression over detection boxes.

    Highest mean confidence wins. Returns (kept, suppressed).
    """
    scored = []
    for det in detections:
        box = det.bbox(keypoint_threshold)
        if box is None:
            continue
        scored.append((det, box))
    scored.sort(key=lambda pair: pair[0].confidence, reverse=True)

    kept: list[Detection] = []
    kept_boxes: list[Box] = []
    suppressed: list[Detection] = []
    for det, box in scored:
        if any(iou(box, other) >= iou_threshold for other in kept_boxes):
            suppressed.append(det)
        else:
            kept.append(det)
            kept_boxes.append(box)
    return kept, suppressed


def drop_sparse(
    detections: Sequence[Detection],
    keypoint_threshold: float,
    min_visible: int,
) -> list[Detection]:
    """Discard skeletons with too few confident joints to measure anything from."""
    return [d for d in detections if d.n_visible(keypoint_threshold) >= min_visible]
