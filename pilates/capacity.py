"""How much machine this is, and therefore how long a clip will take.

A studio that presses Record and waits does not know whether the analysis is
working or hung, and the honest answer depends almost entirely on the box it is
running on. The same twenty-second clip is a minute and a half on a laptop and
well over an hour on the smallest free hosting tier -- not because anything is
wrong, but because one of them has four cores and the other has a tenth of one.

So the server measures its own allowance and says so before the upload, rather
than letting somebody discover it by waiting. That is the whole of this module.

**The cost is a measurement, not a guess.** :data:`CPU_SECONDS_PER_VIDEO_SECOND`
comes from timing the real pipeline over a real clip, and the number it reports
is CPU-seconds rather than wall-seconds precisely so that it divides by whatever
allowance the container turns out to have.
"""
from __future__ import annotations

import os
from pathlib import Path

#: CPU-seconds of work per second of video, for the default settings (RTMO-m,
#: every frame). Measured rather than estimated: 495 CPU-seconds over a
#: 20-second 1080p clip, one person in frame, six tracks.
#:
#: It is a rough figure and is used for a rough sentence -- "about twenty
#: minutes" -- which is the only kind of claim the number can support. Frame
#: rate, resolution and how many people are in shot all move it.
CPU_SECONDS_PER_VIDEO_SECOND = 24.8

#: Below this many cores, analysing anything longer than a few seconds is a
#: waiting game rather than a workflow. The smallest free tiers of most hosting
#: platforms are 0.1; a phone is more than this.
CRAMPED = 0.5


def _quota() -> float | None:
    """The container's CPU allowance, if it is in one.

    cgroup v2 first, then v1. A machine that is not in a container, or one whose
    cgroup says ``max``, has no quota and gets its core count instead.
    """
    v2 = Path("/sys/fs/cgroup/cpu.max")
    if v2.exists():
        try:
            quota, period = v2.read_text().split()
            if quota != "max" and float(period) > 0:
                return float(quota) / float(period)
        except (ValueError, OSError):
            pass
    try:
        quota = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read_text())
        period = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text())
        if quota > 0 and period > 0:
            return quota / period
    except (ValueError, OSError):
        pass
    return None


def cores() -> float:
    """How many cores' worth of work this machine can actually do at once.

    A cgroup quota wins over the core count, because a container on a
    sixty-four-core host that is capped at a tenth of one has a tenth of one --
    and ``os.cpu_count`` would cheerfully report sixty-four.
    """
    quota = _quota()
    if quota is not None:
        return round(quota, 2)
    return float(os.cpu_count() or 1)


def seconds_for(video_seconds: float, on: float | None = None) -> float:
    """Roughly how long this machine needs to analyse a clip that long."""
    have = on if on is not None else cores()
    return video_seconds * CPU_SECONDS_PER_VIDEO_SECOND / max(have, 0.05)


def in_words(seconds: float) -> str:
    """A duration a person can act on, rounded to how sure we are of it."""
    if seconds < 90:
        return f"about {max(round(seconds / 10) * 10, 10)} seconds"
    minutes = seconds / 60
    if minutes < 60:
        count = max(round(minutes), 2)
        return f"about {count} minutes"
    hours = minutes / 60
    if hours < 10:
        shown = f"{hours:.1f}".rstrip("0").rstrip(".")
    else:
        shown = str(round(hours))
    return f"about {shown} hour" + ("" if shown == "1" else "s")
