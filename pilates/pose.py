"""Pose-estimation backends.

RTMO is the default: it is one-stage, so it finds every person in the frame
without a separate detector, which matters when a whole class is in shot.
The :class:`PoseBackend` protocol keeps the rest of the pipeline independent of
it so alternatives can be benchmarked without rewriting anything downstream.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from .types import Detection

#: RTMO checkpoints published by OpenMMLab, smallest to largest.
RTMO_MODELS = {
    "s": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-s_8xb32-600e_body7-640x640-dac2bf74_20231211.zip",
    "m": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-m_16xb16-600e_body7-640x640-39e78cc4_20231211.zip",
    "l": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-l_16xb16-600e_body7-640x640-b37118ce_20231211.zip",
}


@runtime_checkable
class PoseBackend(Protocol):
    """Anything that turns a BGR frame into candidate skeletons."""

    def __call__(self, frame: np.ndarray) -> list[Detection]:
        ...


class RTMOBackend:
    """RTMO via :mod:`rtmlib` and ONNX Runtime.

    Weights download on first use and are cached under ``~/.cache/rtmlib``.
    """

    def __init__(
        self,
        size: str = "m",
        input_size: tuple[int, int] = (640, 640),
        score_threshold: float = 0.3,
        device: str = "cpu",
        backend: str = "onnxruntime",
    ) -> None:
        if size not in RTMO_MODELS:
            raise ValueError(f"unknown RTMO size {size!r}; choose from {sorted(RTMO_MODELS)}")
        from rtmlib import RTMO  # imported lazily so tests need no model

        self.size = size
        self._model = RTMO(
            RTMO_MODELS[size],
            model_input_size=input_size,
            score_thr=score_threshold,
            backend=backend,
            device=device,
        )

    def __call__(self, frame: np.ndarray) -> list[Detection]:
        keypoints, scores = self._model(frame)
        return [
            Detection(
                keypoints=np.asarray(keypoints[i], dtype=np.float32),
                scores=np.asarray(scores[i], dtype=np.float32),
            )
            for i in range(len(scores))
        ]


class TiledBackend:
    """Runs another backend over overlapping, upscaled tiles of the frame.

    The exported RTMO ONNX graph has a **fixed 640x640 input**, so a wide shot
    of a full class is downsampled until distant students are only a handful of
    pixels tall and vanish. Tiling is the only way to raise effective
    resolution without re-exporting the model.

    Measured on a packed 848x464 hall: a single full-frame pass found 15
    people, a 3x3 tiling at 2x upscale found 35 -- at roughly seven times the
    compute. Confidence falls (0.60 -> 0.51 mean) because the extra students
    are the small, distant, partly occluded ones.

    Tiles overlap, so one student can be detected in two tiles. Those become
    ordinary duplicate detections, which the pipeline's existing
    de-duplication stage already removes -- no special handling needed here.
    """

    def __init__(
        self,
        backend: PoseBackend,
        cols: int = 3,
        rows: int = 3,
        scale: float = 2.0,
        overlap: float = 0.25,
    ) -> None:
        if cols < 1 or rows < 1:
            raise ValueError("cols and rows must be at least 1")
        if scale <= 0:
            raise ValueError("scale must be positive")
        if not 0.0 <= overlap < 0.5:
            raise ValueError("overlap must be in [0, 0.5)")
        self.backend = backend
        self.cols, self.rows = cols, rows
        self.scale, self.overlap = scale, overlap

    def _tiles(self, width: int, height: int):
        tile_w, tile_h = width / self.cols, height / self.rows
        pad_x, pad_y = tile_w * self.overlap, tile_h * self.overlap
        for cx in range(self.cols):
            for cy in range(self.rows):
                x0 = max(0, int(cx * tile_w - pad_x))
                x1 = min(width, int((cx + 1) * tile_w + pad_x))
                y0 = max(0, int(cy * tile_h - pad_y))
                y1 = min(height, int((cy + 1) * tile_h + pad_y))
                if x1 > x0 and y1 > y0:
                    yield x0, y0, x1, y1

    def __call__(self, frame: np.ndarray) -> list[Detection]:
        import cv2

        height, width = frame.shape[:2]
        found: list[Detection] = []
        for x0, y0, x1, y1 in self._tiles(width, height):
            crop = frame[y0:y1, x0:x1]
            if self.scale != 1.0:
                crop = cv2.resize(
                    crop, None, fx=self.scale, fy=self.scale, interpolation=cv2.INTER_CUBIC
                )
            offset = np.array([x0, y0], dtype=np.float32)
            for det in self.backend(crop):
                found.append(
                    Detection(
                        keypoints=(det.keypoints / self.scale + offset).astype(np.float32),
                        scores=det.scores,
                    )
                )
        return found


class StubBackend:
    """Replays canned detections. Used by the tests so they need no weights."""

    def __init__(self, frames: list[list[Detection]]) -> None:
        self._frames = frames
        self._index = 0

    def __call__(self, frame: np.ndarray) -> list[Detection]:
        if self._index >= len(self._frames):
            return []
        out = self._frames[self._index]
        self._index += 1
        return out
