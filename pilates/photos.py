"""A photograph in, landmarks out -- and the photograph is not kept.

The narrow bridge between an upload and :mod:`pilates.intake`. It owns three
things nothing else should have to know about: how a browser hands over an
image, which person in it is the subject, and the fact that the file is gone
before the function returns.

**The photograph is never written to disk and never stored.** It arrives in
memory, is decoded, is measured, and the bytes are dropped. What survives is
seventeen coordinates and seventeen confidences -- about half a kilobyte
against about two megabytes -- and that asymmetry is the whole privacy
argument this project rests on. A studio that wants to keep the photographs
keeps them; this does not do it on their behalf without being asked.

**Which person.** A studio photograph has a receptionist in the doorway, a
reflection in the mirror, somebody waiting. Picking the highest-confidence
detection is wrong: confidence says how sure the model is that a body looks
like a body, and a small clear bystander beats a large partly-cropped subject.
The subject is the *largest* body, because a studio photographs the person they
are photographing from closer than the people they are not, and the presence of
anybody else is reported rather than silently resolved.

**A photograph of part of a person is refused, not measured.** The model
will not refuse it for you -- handed a head and shoulders it invents the rest
of the body a few dozen pixels below the chin and returns every joint at high
confidence -- so the landmarks are checked for human proportions before they
leave. See :func:`pilates.alignment.not_a_standing_body`.

**Downscaling is for the model, not for the caller.** A twelve-megapixel phone
photograph is resized before inference -- RTMO's exported graph takes 640x640
whatever it is handed, so the pixels past that are cost without benefit -- and
the landmarks are scaled back into the original photograph's coordinates
before they leave. The browser that drew the upload can then draw the overlay
without knowing any of this happened.
"""
from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass

import numpy as np

from .alignment import View, not_a_standing_body
from .intake import Photo
from .types import Detection

#: Bigger than this on the long side and the photograph is resized before the
#: model sees it. Above about this size RTMO is being handed detail it throws
#: away in its own 640-pixel resize, and the decode cost is real on a small
#: server.
MAX_EDGE = 1600

#: A photograph shorter than this cannot contain a measurable body.
#:
#: **On height, not on the smallest side.** The first version of this gate
#: tested ``min(height, width)`` and refused every correctly framed
#: photograph in the studio's first real set -- 161x361, 166x360, 151x366,
#: 116x360, four clean standing shots. A photograph of somebody standing is
#: tall and narrow, and its width is small *because* the framing is right.
#: Testing the short side punished the composition the instructions ask for.
#:
#: The number is :data:`pilates.alignment.MIN_BODY_PIXELS`, because a body
#: cannot span more pixels than the picture is tall. This is only the floor:
#: what actually decides whether a photograph is measurable is how much of it
#: the *body* fills, and that is checked where the body is found.
MIN_HEIGHT = 180

#: Refused before decoding. Four photographs at this size is 32 MB of image,
#: which base64 expands to about 43 MB on the wire -- see
#: :data:`pilates.serve.Handler.PAYLOAD_LIMITS`, which is what enforces the
#: ceiling for the request as a whole.
MAX_BYTES = 8 * 1024 * 1024

_DATA_URI = re.compile(r"^data:image/(png|jpe?g|webp);base64,", re.I)


class BadPhoto(ValueError):
    """The upload was not a photograph this can measure. Carries the reason."""


@dataclass(frozen=True)
class Subject:
    """The person measured, and who else was in the picture with them."""

    detection: Detection
    width: int
    height: int
    #: How many people the model found. More than one is not an error and is
    #: worth saying: it is the commonest cause of a landmark in the wrong place.
    people: int = 1
    note: str = ""
    #: Whether that note is bad enough to distrust the measurement.
    doubt: bool = False


def decode(data: str) -> np.ndarray:
    """A browser's data URI into a BGR image array.

    Raises :class:`BadPhoto` with something a receptionist can act on rather
    than letting a malformed upload become a stack trace in a log nobody reads.
    """
    import cv2

    if not isinstance(data, str) or not data:
        raise BadPhoto("no photograph in this slot")
    match = _DATA_URI.match(data)
    payload = data[match.end():] if match else data
    if len(payload) > MAX_BYTES * 4 // 3:
        raise BadPhoto(f"the photograph is larger than "
                       f"{MAX_BYTES // (1024 * 1024)} MB; resize it or take it "
                       f"again at a lower resolution")
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise BadPhoto("this was not an image file") from exc
    if len(raw) > MAX_BYTES:
        raise BadPhoto(f"the photograph is larger than "
                       f"{MAX_BYTES // (1024 * 1024)} MB")
    frame = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise BadPhoto("this file could not be opened as a photograph; JPEG, "
                       "PNG and WebP are understood")
    height, width = frame.shape[:2]
    if height < MIN_HEIGHT:
        raise BadPhoto(f"this photograph is {width}x{height}; a body in "
                       f"something less than {MIN_HEIGHT} px tall is too few "
                       f"pixels to measure an angle from")
    return frame


def _fit_for_model(frame: np.ndarray) -> tuple[np.ndarray, float]:
    """The frame at a size worth running, and the factor to undo it by."""
    import cv2

    height, width = frame.shape[:2]
    longest = max(height, width)
    if longest <= MAX_EDGE:
        return frame, 1.0
    scale = MAX_EDGE / float(longest)
    small = cv2.resize(frame, (int(round(width * scale)),
                               int(round(height * scale))),
                       interpolation=cv2.INTER_AREA)
    return small, scale


def _body_height(det: Detection, threshold: float = 0.4) -> float:
    """How tall the body is on screen, for choosing the subject.

    The bounding box would do it and would be wrong: an arm raised over the
    head makes a box half as tall again without making the person any larger,
    and a bystander with their hand up would win.
    """
    box = det.bbox(threshold)
    return 0.0 if box is None else float(box[3] - box[1])


def subject(frame: np.ndarray, backend) -> Subject:
    """Find the person this photograph is of, and note who else is in it."""
    small, scale = _fit_for_model(frame)
    found = backend(small)
    height, width = frame.shape[:2]
    if not found:
        raise BadPhoto("no person was found in this photograph; check the "
                       "whole body is in frame and the light is even")
    ranked = sorted(found, key=_body_height, reverse=True)
    chosen = ranked[0]
    if scale != 1.0:
        chosen = Detection(keypoints=chosen.keypoints / scale,
                           scores=chosen.scores)
    # Is what was found actually a whole body in this photograph?
    #
    # Asked here, before anything is measured, because the answer decides
    # whether there is a measurement at all. A pose model handed a
    # head-and-shoulders crop does not refuse it: it finds the head and
    # invents hips, knees and ankles below the chin, confidently. Every
    # number downstream then computes cleanly on a body that is not in the
    # picture, and the report comes back saying the legs are perfect.
    #
    # A photograph that fails this is refused rather than flagged. A doubt
    # withholds the score and prints the measurements underneath it, and the
    # measurements are the problem.
    from .validation import validate_body
    from .alignment import estimate_view
    shaped = validate_body(chosen, width=width, height=height, standing=True,
                           side=estimate_view(chosen).view.is_sagittal).reasons
    shaped += not_a_standing_body(chosen)
    if shaped:
        raise BadPhoto("Insufficient visibility: not a whole body suitable for standing assessment. It may be cropped. " + " ".join(dict.fromkeys(shaped)))

    note, doubt = "", False
    if len(found) > 1:
        biggest, second = _body_height(ranked[0]), _body_height(ranked[1])
        note = f"{len(found)} people were found; the largest was measured"
        if second > 0.75 * biggest:
            # Close in size is the case that goes wrong: the model can attach a
            # limb from one to the other, and no confidence score shows it.
            note += (" — and the next one is nearly the same size, so the "
                     "landmarks may be a mix of the two")
            doubt = True
    return Subject(chosen, width, height, len(found), note, doubt)


def photograph(data: str, view: View, backend, *, label: str = "") -> Photo:
    """One upload as a :class:`pilates.intake.Photo`, measured or refused.

    A photograph that could not be measured comes back as a Photo carrying the
    reason rather than as an exception, because three good photographs and one
    that needs retaking is a useful assessment and an exception is not.
    """
    try:
        frame = decode(data)
    except BadPhoto as exc:
        return Photo(view=view, label=label, problem=str(exc))
    try:
        found = subject(frame, backend)
    except BadPhoto as exc:
        height, width = frame.shape[:2]
        return Photo(view=view, width=width, height=height, label=label,
                     problem=str(exc))
    # The decoded frame is a local and nothing here keeps a reference to it:
    # the caller gets seventeen coordinates, and the pixels are collected with
    # this stack frame. Nothing is written to disk at any point above.
    return Photo(view=view, detection=found.detection, width=found.width,
                 height=found.height, label=label, note=found.note,
                 doubt=found.doubt)
