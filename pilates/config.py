"""Per-studio configuration.

The exclusion zones in particular are studio-specific and must be set once when
a camera is installed -- there is no way to infer a mirror from the pixels.
Keeping this as data (JSON) rather than code means installing a second studio
does not mean editing Python.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .filters import ExclusionZone
from .tracking import TrackerConfig


@dataclass
class StudioConfig:
    """Everything that varies between one camera installation and another."""

    name: str = "studio"
    #: Confidence at which a joint counts as visible.
    keypoint_threshold: float = 0.4
    #: Skeletons with fewer confident joints than this are discarded.
    min_visible_keypoints: int = 8
    #: IoU above which two skeletons are treated as the same body.
    duplicate_iou: float = 0.55
    #: Regions that never contain a real student: mirrors, glass, doorways.
    exclusion_zones: list[ExclusionZone] = field(default_factory=list)
    tracker: TrackerConfig = field(default_factory=TrackerConfig)
    #: RTMO variant: "s" (fastest), "m" (balanced), "l" (most accurate).
    model_size: str = "m"
    device: str = "cpu"
    #: Analyse every Nth frame. Mat work is slow; 24fps is rarely necessary.
    frame_stride: int = 1
    #: Split each frame into a grid of overlapping, upscaled tiles before pose
    #: estimation. Needed for wide shots of large classes, where distant
    #: students are too few pixels to survive the model's fixed 640x640 input.
    #: ``1 x 1`` disables tiling. Costs roughly one inference per tile.
    tile_cols: int = 1
    tile_rows: int = 1
    tile_scale: float = 2.0
    tile_overlap: float = 0.25

    @property
    def tiling_enabled(self) -> bool:
        return self.tile_cols > 1 or self.tile_rows > 1

    def __post_init__(self) -> None:
        # Keep the tracker's notion of visibility in step with the studio's.
        self.tracker.keypoint_threshold = self.keypoint_threshold

    @classmethod
    def from_dict(cls, data: dict) -> "StudioConfig":
        payload = dict(data)
        zones = [ExclusionZone(**z) for z in payload.pop("exclusion_zones", [])]
        tracker = TrackerConfig(**payload.pop("tracker", {}))
        return cls(exclusion_zones=zones, tracker=tracker, **payload)

    @classmethod
    def load(cls, path: str | Path) -> "StudioConfig":
        return cls.from_dict(json.loads(Path(path).read_text()))

    def to_dict(self) -> dict:
        data = asdict(self)
        data["exclusion_zones"] = [asdict(z) for z in self.exclusion_zones]
        data["tracker"] = asdict(self.tracker)
        return data

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2) + "\n")
