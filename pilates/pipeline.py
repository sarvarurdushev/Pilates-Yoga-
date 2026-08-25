"""Wiring: video frames in, tracked people out."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np

from .config import StudioConfig
from .filters import apply_exclusion_zones, drop_sparse, suppress_duplicates
from .pose import PoseBackend, RTMOBackend, TiledBackend
from .tracking import IoUTracker
from .types import FrameResult


class VideoSource:
    """Frames from a file or an RTSP stream, with optional striding."""

    def __init__(self, path: str | Path, stride: int = 1):
        import cv2

        self.path = str(path)
        self.stride = max(1, stride)
        self._cap = cv2.VideoCapture(self.path)
        if not self._cap.isOpened():
            raise IOError(f"could not open video source: {self.path}")
        self.fps = self._cap.get(cv2.CAP_PROP_FPS) or 30.0
        self.frame_count = int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.width = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    def __iter__(self) -> Iterator[tuple[int, float, np.ndarray]]:
        index = 0
        while True:
            ok, frame = self._cap.read()
            if not ok:
                break
            if index % self.stride == 0:
                yield index, index / self.fps, frame
            index += 1

    def close(self) -> None:
        self._cap.release()

    def __enter__(self) -> "VideoSource":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


@dataclass
class PipelineStats:
    """Running totals, useful for sanity-checking an install."""

    frames: int = 0
    raw_detections: int = 0
    excluded: int = 0
    duplicates: int = 0
    tracked: int = 0

    @property
    def exclusion_rate(self) -> float:
        return self.excluded / self.raw_detections if self.raw_detections else 0.0

    @property
    def duplicate_rate(self) -> float:
        return self.duplicates / self.raw_detections if self.raw_detections else 0.0


class Pipeline:
    """Pose estimation -> exclusion zones -> de-duplication -> tracking.

    The order matters. Reflections are removed before de-duplication so a
    reflection can never win a duplicate contest against the real person, and
    both run before tracking so neither can ever be issued a student ID.
    """

    def __init__(self, config: StudioConfig | None = None, backend: PoseBackend | None = None):
        self.config = config or StudioConfig()
        if backend is None:
            backend = RTMOBackend(size=self.config.model_size, device=self.config.device)
            if self.config.tiling_enabled:
                backend = TiledBackend(
                    backend,
                    cols=self.config.tile_cols,
                    rows=self.config.tile_rows,
                    scale=self.config.tile_scale,
                    overlap=self.config.tile_overlap,
                )
        self.backend = backend
        self.tracker = IoUTracker(self.config.tracker)
        self.stats = PipelineStats()

    def reset(self) -> None:
        self.tracker.reset()
        self.stats = PipelineStats()

    def process_frame(self, frame: np.ndarray, frame_index: int, timestamp: float) -> FrameResult:
        cfg = self.config
        detections = self.backend(frame)
        n_raw = len(detections)

        detections = drop_sparse(detections, cfg.keypoint_threshold, cfg.min_visible_keypoints)
        detections, excluded = apply_exclusion_zones(
            detections, cfg.exclusion_zones, cfg.keypoint_threshold
        )
        detections, duplicates = suppress_duplicates(
            detections, cfg.keypoint_threshold, cfg.duplicate_iou
        )
        people = self.tracker.update(detections)

        self.stats.frames += 1
        self.stats.raw_detections += n_raw
        self.stats.excluded += len(excluded)
        self.stats.duplicates += len(duplicates)
        self.stats.tracked += len(people)

        return FrameResult(
            frame_index=frame_index,
            timestamp=timestamp,
            people=people,
            n_raw=n_raw,
            n_excluded=len(excluded),
            n_duplicates=len(duplicates),
        )

    def run(self, source: VideoSource) -> Iterator[FrameResult]:
        for index, timestamp, frame in source:
            yield self.process_frame(frame, index, timestamp)
