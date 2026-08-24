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
