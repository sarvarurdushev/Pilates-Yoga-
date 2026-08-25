"""Core data types passed between pipeline stages."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from . import keypoints as kp


@dataclass(frozen=True)
class Detection:
    """One candidate person in one frame, straight out of the pose model."""

    keypoints: np.ndarray  # (17, 2) float32, pixel coordinates
    scores: np.ndarray     # (17,)   float32, per-joint confidence 0..1
    #: Optional clothing-colour histogram, attached by the pipeline when
    #: appearance matching is enabled. None means "no evidence", which the
    #: tracker treats differently from a mismatch.
    appearance: np.ndarray | None = None

    def with_appearance(self, descriptor: np.ndarray | None) -> "Detection":
        return Detection(self.keypoints, self.scores, descriptor)

    def __post_init__(self) -> None:
        if self.keypoints.shape != (kp.NUM_KEYPOINTS, 2):
            raise ValueError(f"keypoints must be ({kp.NUM_KEYPOINTS}, 2), got {self.keypoints.shape}")
        if self.scores.shape != (kp.NUM_KEYPOINTS,):
            raise ValueError(f"scores must be ({kp.NUM_KEYPOINTS},), got {self.scores.shape}")

    @property
    def confidence(self) -> float:
        """Mean confidence across all joints."""
        return float(self.scores.mean())

    def visible(self, threshold: float) -> np.ndarray:
        """Boolean mask of joints at or above ``threshold``."""
        return self.scores >= threshold

    def n_visible(self, threshold: float) -> int:
        return int(self.visible(threshold).sum())

    def bbox(self, threshold: float) -> tuple[float, float, float, float] | None:
        """Axis-aligned box around the visible joints, or None if too few."""
        pts = self.keypoints[self.visible(threshold)]
        if len(pts) < 2:
            return None
        x0, y0 = pts.min(axis=0)
        x1, y1 = pts.max(axis=0)
        return float(x0), float(y0), float(x1), float(y1)

    def centroid(self, threshold: float) -> tuple[float, float] | None:
        pts = self.keypoints[self.visible(threshold)]
        if len(pts) == 0:
            return None
        cx, cy = pts.mean(axis=0)
        return float(cx), float(cy)


@dataclass
class TrackedPerson:
    """A detection that has been assigned a stable identity across frames."""

    track_id: int
    detection: Detection
    age: int = 0           # frames since the track was created
    hits: int = 0          # frames in which this track was matched
    misses: int = 0        # consecutive frames without a match


@dataclass
class FrameResult:
    """Everything the pipeline knows about one frame."""

    frame_index: int
    timestamp: float
    people: list[TrackedPerson] = field(default_factory=list)
    n_raw: int = 0          # detections returned by the model
    n_excluded: int = 0     # dropped by exclusion zones (mirrors, doorways)
    n_duplicates: int = 0   # dropped as duplicates of another detection

    @property
    def n_people(self) -> int:
        return len(self.people)


def stack_detections(dets: Sequence[Detection]) -> tuple[np.ndarray, np.ndarray]:
    """Pack detections back into the (N, 17, 2) / (N, 17) arrays drawing code expects."""
    if not dets:
        empty_k = np.zeros((0, kp.NUM_KEYPOINTS, 2), dtype=np.float32)
        empty_s = np.zeros((0, kp.NUM_KEYPOINTS), dtype=np.float32)
        return empty_k, empty_s
    return (
        np.stack([d.keypoints for d in dets]).astype(np.float32),
        np.stack([d.scores for d in dets]).astype(np.float32),
    )
