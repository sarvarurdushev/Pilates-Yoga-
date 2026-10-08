"""Explicit deployment modes: what this server is, and what it must not pretend.

``demo_free``        the free hosted demonstration (Render free tier). Storage is
                     never reported as persistent, nothing paid is called, and
                     demonstration analysis may be precomputed.
``local_room``       a facility's own room computer or a developer machine. The
                     real analysis pipeline and the local camera are available.
``cloud_production`` reserved. It is not implemented, so the server refuses to
                     start in it rather than run a half-configured production.

The mode comes from ``$SEDENS_MODE``. Without it, a Render instance is
``demo_free`` and anything else is ``local_room``.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

DEMO_FREE = "demo_free"
LOCAL_ROOM = "local_room"
CLOUD_PRODUCTION = "cloud_production"
MODES = (DEMO_FREE, LOCAL_ROOM, CLOUD_PRODUCTION)

LABELS = {
    DEMO_FREE: "Free demonstration",
    LOCAL_ROOM: "Local room",
    CLOUD_PRODUCTION: "Cloud production (not available)",
}


class ModeError(RuntimeError):
    """The configured mode is unknown or cannot run on this build."""


@dataclass(frozen=True)
class Mode:
    name: str
    db_path: str
    analysis_enabled: bool
    demo_enabled: bool
    render: bool

    @property
    def label(self) -> str:
        return LABELS[self.name]

    def storage(self) -> dict:
        """Whether saved records survive a restart, stated conservatively."""
        if self.name == DEMO_FREE:
            return {
                "persistent": False,
                "reason": "Free demonstration hosting: records and uploads can be erased "
                "on any restart or redeploy.",
            }
        path = Path(self.db_path).resolve() if self.db_path else None
        if path is None:
            return {"persistent": False, "reason": "No database is configured."}
        if self.render and not path.is_relative_to(Path("/var/data")):
            return {
                "persistent": False,
                "reason": "This hosted instance stores records outside a persistent disk.",
            }
        if path.is_relative_to(Path("/tmp")):
            return {
                "persistent": False,
                "reason": "The database is in a temporary directory.",
            }
        return {"persistent": True, "reason": "Records are stored on this computer's disk."}

    def describe(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "storage": self.storage(),
            "features": {
                # Real server-side analysis runs only when this server was started
                # with analysis enabled. On the free tier it is slow and labelled.
                "real_analysis": (
                    "unavailable"
                    if not self.analysis_enabled
                    else "limited" if self.name == DEMO_FREE else "available"
                ),
                "precomputed_demo_analysis": self.name == DEMO_FREE or self.demo_enabled,
                "local_camera": self.name == LOCAL_ROOM,
                "demo_workspaces": self.demo_enabled,
                "simulated_room_devices": self.demo_enabled,
                "paid_services": False,
            },
        }


def _flag(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() not in ("0", "false", "no", "off")


def resolve(env=None, *, db_path: str = "", analysis_enabled: bool = False) -> Mode:
    """Read the mode from the environment. Raises :class:`ModeError`."""
    env = os.environ if env is None else env
    render = env.get("RENDER", "").strip().lower() in ("true", "1")
    name = (env.get("SEDENS_MODE") or "").strip().lower() or (
        DEMO_FREE if render else LOCAL_ROOM
    )
    if name not in MODES:
        raise ModeError(
            f"SEDENS_MODE={name!r} is not a known mode. Use one of: {', '.join(MODES)}."
        )
    if name == CLOUD_PRODUCTION:
        raise ModeError(
            "SEDENS_MODE=cloud_production is reserved and not implemented: durable "
            "storage, managed secrets and production monitoring are not configured. "
            "Use demo_free or local_room."
        )
    # Demonstration workspaces are the point of demo_free. A real room computer
    # can switch them off with SEDENS_DEMO=0.
    demo = True if name == DEMO_FREE else _flag(env.get("SEDENS_DEMO"), True)
    return Mode(name, str(db_path or ""), bool(analysis_enabled), demo, render)
