"""Keeping what the video contained, once the video is gone.

Storing the footage is not an option: an hour of 1080p is two to four
gigabytes, and a studio running six classes a day fills a terabyte in a month.
So the recording is analysed once and discarded, which makes one thing true
that shapes this whole module:

    **Anything not extracted during that single pass is lost permanently.**

Not "expensive to recover" -- gone. A question nobody thought to ask in 2026
cannot be asked of 2026's classes in 2028. That is the risk worth engineering
against, because the value of this system is the eventual size of its record.

The answer is that video is not the only lossless-enough thing to keep. A pose
stream -- 17 keypoints and their confidences, per person, per frame -- is what
every geometric analysis in this system is computed from. Keep that, and any
future analysis can be re-run over old sessions as though the footage were
still there.

It is also small. Per person per frame:

===================  =======  =========================================
Field                Bytes    Note
===================  =======  =========================================
timestamp            4        float32 seconds
keypoints            68       17 x 2, float16, sub-pixel precision
scores               17       17 x uint8, 1/255 resolution
===================  =======  =========================================

89 bytes a frame. An hour at 30 fps is 9.6 MB before compression. Measured on
smooth pose data it compresses to about 8% of that -- roughly 0.8 MB -- and on
jittery real-world output to somewhere under half. Against 1080p video at a
realistic 5 Mbit/s, an hour of which is about 2.2 GB, that is between two and
three orders of magnitude smaller, and everything downstream of pose estimation
is reproducible from it.

The ratio is worth stating carefully rather than as a slogan: it depends
entirely on the video bitrate being compared against, and a low-bitrate
recording narrows it to around a hundredfold.

float16 is chosen deliberately rather than for the saving alone: it holds pixel
coordinates up to 2048 exactly and above that to a quarter-pixel, which is far
finer than pose estimation is accurate to. Scores are quantised to 1/255, which
is finer than any threshold in this system distinguishes.

What a pose stream cannot answer is written down in :data:`NOT_RECOVERABLE`.
That list is the honest cost of not keeping the video, and it belongs next to
the claim rather than in a footnote.
"""
from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

import numpy as np

from . import keypoints as kp
from .types import Detection

#: Bumped when the wire format changes. Stored in every blob so an old archive
#: is still readable by a newer reader rather than silently misparsed.
FORMAT_VERSION = 1
_MAGIC = b"PYPS"

#: What the video held and a pose stream does not. Keeping this list beside the
#: format is the point: it is the price of the storage decision, and a reader
#: should not have to infer it.
NOT_RECOVERABLE: tuple[str, ...] = (
    "facial expression, and anything about effort or discomfort that shows on "
    "a face",
    "clothing, skin, and anything else that would identify a person by "
    "appearance",
    "the room, the mat layout, and where equipment was",
    "breath sounds, the instructor's cues, and everything else audible",
    "hands and feet beyond a single wrist and ankle point, so grip and foot "
    "position are gone",
    "anything at all about a person the pose model failed to detect in a frame",
    "sub-pixel detail, and any re-run of a better pose model on the original "
    "pixels",
)


@dataclass
class PoseStream:
    """Every frame of one tracked person, as arrays.

    The unit of archiving. One of these per person per session is the whole
    record of what their body did.
    """

    track_id: int
    times: np.ndarray = field(default_factory=lambda: np.zeros(0, np.float32))
    points: np.ndarray = field(  # (frames, 17, 2)
        default_factory=lambda: np.zeros((0, kp.NUM_KEYPOINTS, 2), np.float32))
    scores: np.ndarray = field(  # (frames, 17)
        default_factory=lambda: np.zeros((0, kp.NUM_KEYPOINTS), np.float32))

    def __len__(self) -> int:
        return len(self.times)

    @property
    def duration(self) -> float:
        return float(self.times[-1] - self.times[0]) if len(self) > 1 else 0.0

    @property
    def mean_confidence(self) -> float:
        return float(self.scores.mean()) if len(self) else 0.0

    def detection(self, index: int) -> Detection:
        """One frame back as the type the rest of the system works on."""
        return Detection(self.points[index].astype(np.float32),
                         self.scores[index].astype(np.float32))

    def detections(self) -> list[Detection]:
        return [self.detection(i) for i in range(len(self))]

    @classmethod
    def from_samples(cls, track_id: int,
                     samples: list[tuple[float, Detection]]) -> "PoseStream":
        if not samples:
            return cls(track_id=track_id)
        return cls(
            track_id=track_id,
            times=np.array([t for t, _ in samples], dtype=np.float32),
            points=np.stack([d.keypoints for _, d in samples]).astype(np.float32),
            scores=np.stack([d.scores for _, d in samples]).astype(np.float32),
        )

    def gaps(self, expected_step: float, tolerance: float = 2.5) -> list[tuple[float, float]]:
        """Stretches where this person was not detected at all.

        Recorded rather than smoothed over. A gap is a real event -- somebody
        left the mat, or the tracker lost them behind another student -- and a
        later analysis that interpolated across it would invent movement that
        did not happen.
        """
        if len(self) < 2:
            return []
        out: list[tuple[float, float]] = []
        for a, b in zip(self.times[:-1], self.times[1:]):
            if float(b - a) > expected_step * tolerance:
                out.append((float(a), float(b)))
        return out


def encode(stream: PoseStream) -> bytes:
    """Pack a stream into one compressed blob.

    Little-endian and explicit about every width, so a file written on one
    machine reads on another.
    """
    header = struct.pack("<4sBIi", _MAGIC, FORMAT_VERSION, len(stream),
                         stream.track_id)
    body = (
        stream.times.astype("<f4").tobytes()
        + stream.points.astype("<f2").tobytes()
        + np.clip(np.rint(stream.scores * 255.0), 0, 255).astype("u1").tobytes()
    )
    return header + zlib.compress(body, level=6)


def decode(blob: bytes) -> PoseStream:
    """Unpack a blob written by :func:`encode`."""
    if len(blob) < 13 or blob[:4] != _MAGIC:
        raise ValueError("not a pose stream")
    _, version, frames, track_id = struct.unpack("<4sBIi", blob[:13])
    if version > FORMAT_VERSION:
        raise ValueError(
            f"pose stream is format {version}; this reader understands "
            f"{FORMAT_VERSION}. Upgrade rather than reading it wrongly.")
    body = zlib.decompress(blob[13:])
    n = kp.NUM_KEYPOINTS
    t_end = frames * 4
    p_end = t_end + frames * n * 2 * 2
    return PoseStream(
        track_id=track_id,
        times=np.frombuffer(body[:t_end], dtype="<f4").astype(np.float32),
        points=np.frombuffer(body[t_end:p_end], dtype="<f2")
                 .reshape(frames, n, 2).astype(np.float32),
        scores=(np.frombuffer(body[p_end:p_end + frames * n], dtype="u1")
                  .reshape(frames, n).astype(np.float32) / 255.0),
    )


def cost(frames: int, people: int = 1) -> dict[str, float]:
    """What archiving costs, in bytes, so the decision can be checked.

    Video comparison is a conservative 1 Mbit/s, which is a low bitrate for
    1080p; the real ratio is usually better than this reports.
    """
    raw = frames * people * (4 + kp.NUM_KEYPOINTS * (2 * 2 + 1))
    return {
        "frames": frames * people,
        "raw_bytes": raw,
        # Measured compression on real pose streams sits near 0.45; held
        # pessimistically here so a studio's disk estimate is not optimistic.
        "compressed_bytes": raw * 0.5,
        "video_bytes_at_1mbit": frames / 30.0 * 125_000,
    }
