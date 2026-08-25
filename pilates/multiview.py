"""Two cameras: associating students between views, and fusing their features.

A back bend leans towards a front-facing camera and barely moves in its image,
which is why it is confusable with a side bend. A second camera at an angle
sees that lean directly. Using it requires two things: knowing which student in
view A is which student in view B, and combining what both views say.

Association is done through a **floor-plane homography** rather than full 3D
reconstruction. Every student is on the floor, so their feet lie on a single
plane, and a plane maps between two views by a homography that can be fitted
once at install from four or more corresponding points -- the corners of the
mats are ideal. No camera intrinsics, no stereo calibration, no synchronised
shutter beyond frame-level alignment.

The foot position is used rather than the body centre for a specific reason:
hips are about a metre above the floor for a standing student and on the floor
for one lying down, so the hip is not a plane point and its mapping would drift
with posture. Ankles are on the floor in both cases.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import keypoints as kp
from .classifier import window_features
from .dataset import FEATURE_SIZE
from .types import Detection, TrackedPerson

#: Fused frames carry both views plus a validity flag per view.
FUSED_FEATURE_SIZE = FEATURE_SIZE * 2 + 2


class CalibrationError(ValueError):
    """A homography that cannot be trusted to associate students."""


@dataclass
class FloorHomography:
    """Maps floor points from one camera's image into another's.

    Fit once, at install, from points visible in both views and lying on the
    floor: mat corners, floor markings, tape crosses. Four is the minimum, more
    is better, and they must not be collinear.
    """

    matrix: np.ndarray            # 3x3
    residual: float = 0.0         # mean reprojection error, pixels
    points_used: int = 0

    @property
    def validated(self) -> bool:
        """Whether the residual actually tests anything.

        Four points always fit a homography exactly, whatever order they are
        in, so a zero residual from four points confirms nothing. Only a fifth
        point onwards is over-determined enough for the error to mean
        something. Six or more is the sensible install practice.
        """
        return self.points_used > 4

    @classmethod
    def fit(
        cls,
        source: np.ndarray,
        target: np.ndarray,
        max_residual: float = 25.0,
    ) -> "FloorHomography":
        """Fit from corresponding floor points in the two views.

        ``max_residual`` guards against the commonest installation mistake:
        clicking the points in a different order in each view, which produces a
        mathematically valid homography that maps everything to nonsense.

        That guard needs **more than four points**. Any four points map exactly
        onto any other four, so a four-point fit has zero residual however
        badly it is ordered, and :attr:`validated` will be False. Use six.
        """
        import cv2

        source = np.asarray(source, dtype=np.float32).reshape(-1, 2)
        target = np.asarray(target, dtype=np.float32).reshape(-1, 2)
        if len(source) != len(target):
            raise CalibrationError(
                f"{len(source)} source points but {len(target)} target points"
            )
        if len(source) < 4:
            raise CalibrationError(
                f"need at least 4 floor points, got {len(source)}"
            )
        if len({tuple(p) for p in source}) < len(source) or \
                len({tuple(p) for p in target}) < len(target):
            raise CalibrationError("the same point was given twice")

        matrix, _ = cv2.findHomography(source, target, cv2.RANSAC, 5.0)
        if matrix is None:
            raise CalibrationError(
                "could not fit a homography; are the points collinear?"
            )

        projected = _apply(matrix, source)
        residual = float(np.linalg.norm(projected - target, axis=1).mean())
        if residual > max_residual:
            raise CalibrationError(
                f"points map with {residual:.0f}px mean error, which is too "
                f"large to associate students. The usual cause is the points "
                f"being listed in a different order in the two views."
            )
        return cls(matrix=matrix, residual=residual, points_used=len(source))

    def project(self, points: np.ndarray) -> np.ndarray:
        """Map floor points from the source view into the target view."""
        return _apply(self.matrix, np.asarray(points, dtype=np.float32).reshape(-1, 2))

    def to_dict(self) -> dict:
        return {
            "matrix": self.matrix.tolist(),
            "residual": self.residual,
            "points_used": self.points_used,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "FloorHomography":
        return cls(
            matrix=np.asarray(data["matrix"], dtype=np.float64),
            residual=float(data.get("residual", 0.0)),
            points_used=int(data.get("points_used", 0)),
        )


def _apply(matrix: np.ndarray, points: np.ndarray) -> np.ndarray:
    homogeneous = np.hstack([points, np.ones((len(points), 1), dtype=points.dtype)])
    projected = homogeneous @ np.asarray(matrix, dtype=points.dtype).T
    scale = projected[:, 2:3]
    # A point on the camera's horizon projects to infinity. Guard rather than
    # emit inf, which would silently poison the distance matrix.
    scale = np.where(np.abs(scale) < 1e-9, np.nan, scale)
    return projected[:, :2] / scale


def floor_point(detection: Detection, threshold: float = 0.3) -> np.ndarray | None:
    """Where this student meets the floor, in image coordinates.

    Ankle midpoint, falling back to whichever ankle is visible. Returns None
    when neither is, since a student whose feet are hidden cannot be placed on
    the floor plane and guessing would associate them with the wrong person.
    """
    scores, points = detection.scores, detection.keypoints
    left_ok = scores[kp.L_ANKLE] >= threshold
    right_ok = scores[kp.R_ANKLE] >= threshold
    if left_ok and right_ok:
        return (points[kp.L_ANKLE] + points[kp.R_ANKLE]) / 2.0
    if left_ok:
        return points[kp.L_ANKLE].copy()
    if right_ok:
        return points[kp.R_ANKLE].copy()
    return None


@dataclass
class Association:
    """One student, seen from both cameras."""

    primary_id: int
    secondary_id: int
    distance: float


def associate(
    primary: list[TrackedPerson],
    secondary: list[TrackedPerson],
    homography: FloorHomography,
    max_distance: float = 120.0,
    keypoint_threshold: float = 0.3,
) -> tuple[list[Association], list[int], list[int]]:
    """Match students between two views for one frame.

    Returns ``(pairs, unmatched_primary, unmatched_secondary)``. Students whose
    feet are not visible in a view, or whose nearest candidate is further than
    ``max_distance`` after projection, are left unmatched rather than forced
    into a pair -- a wrong association is worse than a missing one, because it
    fuses two different people's movement into one record.
    """
    primary_points, primary_ids = [], []
    for person in primary:
        point = floor_point(person.detection, keypoint_threshold)
        if point is not None:
            primary_points.append(point)
            primary_ids.append(person.track_id)

    secondary_points, secondary_ids = [], []
    for person in secondary:
        point = floor_point(person.detection, keypoint_threshold)
        if point is not None:
            secondary_points.append(point)
            secondary_ids.append(person.track_id)

    all_primary = [p.track_id for p in primary]
    all_secondary = [p.track_id for p in secondary]
    if not primary_points or not secondary_points:
        return [], all_primary, all_secondary

    projected = homography.project(np.stack(primary_points))
    targets = np.stack(secondary_points)

    candidates: list[tuple[float, int, int]] = []
    for i, point in enumerate(projected):
        if not np.all(np.isfinite(point)):
            continue
        for j, target in enumerate(targets):
            distance = float(np.linalg.norm(point - target))
            if distance <= max_distance:
                candidates.append((distance, i, j))
    candidates.sort()

    used_primary: set[int] = set()
    used_secondary: set[int] = set()
    pairs: list[Association] = []
    for distance, i, j in candidates:
        if i in used_primary or j in used_secondary:
            continue
        used_primary.add(i)
        used_secondary.add(j)
        pairs.append(Association(primary_ids[i], secondary_ids[j], distance))

    matched_primary = {p.primary_id for p in pairs}
    matched_secondary = {p.secondary_id for p in pairs}
    return (
        pairs,
        [t for t in all_primary if t not in matched_primary],
        [t for t in all_secondary if t not in matched_secondary],
    )


def fuse_frame(
    primary: np.ndarray | None, secondary: np.ndarray | None
) -> np.ndarray:
    """Combine one frame's feature vector from each view.

    A missing view contributes zeros and a validity flag of zero rather than
    being dropped. The flag matters: without it a model cannot distinguish
    "this student was upright" from "this camera could not see this student",
    and would learn the second as if it were the first.
    """
    if primary is None and secondary is None:
        raise ValueError("at least one view must be present")
    a = np.zeros(FEATURE_SIZE, dtype=np.float32) if primary is None else primary
    b = np.zeros(FEATURE_SIZE, dtype=np.float32) if secondary is None else secondary
    flags = np.array(
        [0.0 if primary is None else 1.0, 0.0 if secondary is None else 1.0],
        dtype=np.float32,
    )
    return np.concatenate([a, b, flags])


def fuse_window(
    primary: np.ndarray | None, secondary: np.ndarray | None
) -> np.ndarray:
    """Summarise a two-view window into one vector for the classifier.

    Each view is summarised separately and then concatenated, rather than
    summarising the fused frames. Statistics of a channel that is zero half the
    time are meaningless; statistics of each view, plus how much of the window
    that view actually saw, are not.
    """
    if primary is None and secondary is None:
        raise ValueError("at least one view must be present")
    parts = []
    for window in (primary, secondary):
        if window is None:
            parts.append(np.zeros(FEATURE_SIZE * 7, dtype=np.float32))
            parts.append(np.zeros(1, dtype=np.float32))
        else:
            parts.append(window_features(window))
            parts.append(np.ones(1, dtype=np.float32))
    return np.concatenate(parts)
