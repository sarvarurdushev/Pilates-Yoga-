"""Shot-boundary detection.

Real class footage is edited. Session numbers only mean something within one
continuous shot, and labelling is far quicker when the cuts are found first --
an instructor annotating a class should be handed the segments, not asked to
scrub for them.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Shot:
    """One continuous run of frames between cuts."""

    start_frame: int
    end_frame: int
    fps: float

    @property
    def frames(self) -> int:
        return self.end_frame - self.start_frame

    @property
    def start_seconds(self) -> float:
        return self.start_frame / self.fps if self.fps else 0.0

    @property
    def end_seconds(self) -> float:
        return self.end_frame / self.fps if self.fps else 0.0

    @property
    def duration(self) -> float:
        return self.end_seconds - self.start_seconds


def detect_shots(
    video: str,
    sample_every: int = 4,
    min_duration: float = 3.0,
    threshold: float | None = None,
) -> list[Shot]:
    """Split a video into continuous shots.

    Compares consecutive sampled frames as small greyscale thumbnails; a cut
    shows up as a large jump. ``threshold`` defaults to an adaptive value so
    that footage which is simply busy -- a room full of moving people -- does
    not read as a cut on every frame.

    Shots shorter than ``min_duration`` are merged into the previous one:
    a two-second fragment is a transition artefact, not something to label.
    """
    import cv2

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise IOError(f"could not open {video}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    previous = None
    differences: list[tuple[int, float]] = []
    for index in range(0, total, sample_every):
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY).astype(np.float32)
        if previous is not None:
            differences.append((index, float(np.abs(small - previous).mean())))
        previous = small
    cap.release()

    if not differences:
        return [Shot(0, total, fps)]

    values = np.array([d for _, d in differences])
    limit = threshold if threshold is not None else max(12.0, float(np.percentile(values, 99)))
    cuts = [frame for (frame, value) in differences if value > limit]

    bounds = [0, *cuts, total]
    shots: list[Shot] = []
    for start, end in zip(bounds, bounds[1:]):
        if end <= start:
            continue
        candidate = Shot(start, end, fps)
        if candidate.duration < min_duration and shots:
            shots[-1] = Shot(shots[-1].start_frame, end, fps)
        else:
            shots.append(candidate)
    return shots or [Shot(0, total, fps)]


def longest(shots: list[Shot], count: int = 5) -> list[Shot]:
    """The longest shots, longest first. Where labelling is worth starting."""
    return sorted(shots, key=lambda s: -s.frames)[:count]
