"""Identity persistence across frames.

Deliberately dependency-free. The obvious alternative -- Ultralytics' bundled
ByteTrack -- is AGPL-3.0, which would force this whole project to be
open-sourced or licensed commercially. Mat classes are the easy case for
tracking (people stay on their own mat), so a well-tuned IoU tracker is enough
and keeps the licence clean.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from .appearance import blend, similarity
from .geometry import Box, iou
from .types import Detection, TrackedPerson


@dataclass
class _Track:
    track_id: int
    detection: Detection
    box: Box
    age: int = 0
    hits: int = 1
    misses: int = 0
    appearance: np.ndarray | None = None

    @property
    def confirmed_by(self) -> int:
        return self.hits


@dataclass
class TrackerConfig:
    #: Minimum IoU for a detection to be considered the same person.
    iou_threshold: float = 0.3
    #: Frames a track survives without a match before it is retired.
    max_misses: int = 30
    #: Matches required before a track is reported (suppresses one-frame flickers).
    min_hits: int = 3
    #: Keypoint confidence used when computing boxes.
    keypoint_threshold: float = 0.4
    #: How much clothing colour counts towards a match, 0..1. Zero is pure
    #: geometry. Raising it helps only where boxes are ambiguous -- in a
    #: sparse room every candidate is already unambiguous.
    #:
    #: Measured on a packed hall: churn 3.35 at 0.0, 2.83 at 0.3-0.5, and back
    #: up to 3.08 at 0.7 where colour starts overruling geometry. Measured on a
    #: sparse mat class: 1.02 at every weight, so it costs nothing there.
    #: Hence 0.3 by default -- the flat part of the curve, well clear of the
    #: point where it does harm.
    appearance_weight: float = 0.3
    #: Overlap a candidate must clear before appearance is even considered.
    #: Without this floor a student could be matched to someone across the
    #: room purely for wearing the same colour.
    min_iou_gate: float = 0.1
    #: Rate at which a track's appearance model follows new observations.
    appearance_learning_rate: float = 0.1


class IoUTracker:
    """Greedy IoU tracker with track confirmation and a grace period.

    Greedy assignment rather than the Hungarian algorithm: with at most a few
    dozen people whose boxes rarely compete, the optimal assignment and the
    greedy one agree, and greedy avoids a SciPy dependency.
    """

    def __init__(self, config: TrackerConfig | None = None) -> None:
        self.config = config or TrackerConfig()
        self._tracks: list[_Track] = []
        self._next_id = 1

    @property
    def active_tracks(self) -> list[_Track]:
        return list(self._tracks)

    def reset(self) -> None:
        self._tracks.clear()
        self._next_id = 1

    def update(self, detections: Sequence[Detection]) -> list[TrackedPerson]:
        """Advance the tracker by one frame and return the confirmed people."""
        cfg = self.config
        boxes: list[tuple[Detection, Box]] = []
        for det in detections:
            box = det.bbox(cfg.keypoint_threshold)
            if box is not None:
                boxes.append((det, box))

        for track in self._tracks:
            track.age += 1

        use_appearance = cfg.appearance_weight > 0.0
        pairs: list[tuple[float, int, int]] = []
        for t_idx, track in enumerate(self._tracks):
            for d_idx, (det, box) in enumerate(boxes):
                overlap = iou(track.box, box)
                if use_appearance:
                    # A loose gate keeps matching local; appearance then breaks
                    # ties between the several neighbours that clear it.
                    if overlap < cfg.min_iou_gate:
                        continue
                    look = similarity(track.appearance, det.appearance)
                    if look is None:
                        score = overlap
                    else:
                        score = (1.0 - cfg.appearance_weight) * overlap + cfg.appearance_weight * look
                    if overlap < cfg.iou_threshold and look is None:
                        continue
                else:
                    if overlap < cfg.iou_threshold:
                        continue
                    score = overlap
                pairs.append((score, t_idx, d_idx))
        pairs.sort(reverse=True)

        matched_tracks: set[int] = set()
        matched_dets: set[int] = set()
        for score, t_idx, d_idx in pairs:
            if t_idx in matched_tracks or d_idx in matched_dets:
                continue
            matched_tracks.add(t_idx)
            matched_dets.add(d_idx)
            det, box = boxes[d_idx]
            track = self._tracks[t_idx]
            track.detection, track.box = det, box
            track.appearance = blend(
                track.appearance, det.appearance, cfg.appearance_learning_rate
            )
            track.hits += 1
            track.misses = 0

        for t_idx, track in enumerate(self._tracks):
            if t_idx not in matched_tracks:
                track.misses += 1

        for d_idx, (det, box) in enumerate(boxes):
            if d_idx not in matched_dets:
                self._tracks.append(_Track(self._next_id, det, box, appearance=det.appearance))
                self._next_id += 1

        self._tracks = [t for t in self._tracks if t.misses <= cfg.max_misses]

        return [
            TrackedPerson(
                track_id=t.track_id,
                detection=t.detection,
                age=t.age,
                hits=t.hits,
                misses=t.misses,
            )
            for t in self._tracks
            if t.hits >= cfg.min_hits and t.misses == 0
        ]
