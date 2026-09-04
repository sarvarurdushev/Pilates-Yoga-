"""How brightly a structure lights, and why that brightness is not a percentage.

The anatomy model has one channel for "how lit is this" -- the alpha of a
palette texel, read by the shader as activation. Today it carries an authored
role: prime mover 1.0, synergist 0.62, stabiliser 0.34. This module decides
what it carries when a session bundle is driving it instead, and the decision
is more delicate than it looks.

**Three things the level must not become.**

*A share of maximum voluntary contraction.* Nothing here measured one. What was
measured is a joint moment in newton-metres, computed from the pose and a
table of segment masses.

*A per-muscle activation.* A joint moment is the net torque at a joint. Every
muscle crossing it in that direction contributed some unknown fraction. So
every member of a measured group gets the **same** level: the measurement
cannot tell them apart, and a picture that ranked them would be inventing the
ranking. :func:`plan` enforces this by construction -- the level comes from the
group, never from the mesh.

*A gradient over reference structures.* A nerve is lit here because it supplies
a muscle that was measured. Lighting it in proportion to that muscle's moment
would read as "this nerve fired this hard", which is exactly the inference the
bridge exists to refuse. Reference is one flat level for everything at that
tier.

**What the level is.** Within one session, the share of that session's largest
measured moment. Hip flexors at 44 Nm and elbow extensors at 2 Nm really are
twenty-two times apart, and that comparison is between two measurements of the
same person in the same recording, which is the only comparison this data
supports without a population to normalise against.

**Why there is a band and not a ramp from zero.** A group measured at 2 Nm
against a 44 Nm top has a share of 0.05. Rendered as alpha 0.05 it is
indistinguishable from unlit -- and "unlit" here means *not measured*, which is
the one confusion this whole bridge exists to prevent. So measured levels are
mapped into a band whose floor is already unmistakably lit, and the gap below
that floor is wider than any step inside it. The band says "measured"; the
position inside the band says "this much of the session's biggest effort".

**Why linear and not logarithmic.** A log scale would lift 2 Nm to look like
real work. The question the picture answers is which muscles did the session's
work, and the linear share answers it correctly: a group that carried almost
nothing should look like a group that carried almost nothing.
"""
from __future__ import annotations

from dataclasses import dataclass

from .bridge import MEASURED, REFERENCE

#: Nothing to say about this structure at all.
UNLIT = 0.0
#: Every reference structure, flat. See the module note: a gradient here would
#: be a claim about an amount that nothing measured.
REFERENCE_LEVEL = 0.30
#: The dimmest a measured structure is ever drawn. Above this, "measured".
MEASURED_FLOOR = 0.70
#: The session's largest measured moment.
MEASURED_CEILING = 1.0

#: The empty band between the two tiers. Kept wider than the whole measured
#: band so that the tier is legible before the amount is: the nearest measured
#: and reference structures differ by more than the two most distant measured
#: ones do.
TIER_GAP = MEASURED_FLOOR - REFERENCE_LEVEL

SUFFIX = " peak moment"


@dataclass(frozen=True)
class Light:
    """One structure, and how it should be drawn."""

    #: Foundational Model of Anatomy id, or "" for a structure whose source has
    #: none -- every nerve mesh, as it happens.
    fma: str
    name: str
    layer: str
    tier: str
    #: 0..1, for the palette's alpha channel.
    level: float
    #: The sentence a viewer may print. Never strengthened downstream.
    because: str
    #: The same sentence in plain words, carried alongside rather than derived
    #: here: a register that is generated on the drawing side is one more place
    #: for the claim to get stronger than the measurement behind it.
    plain: str = ""
    #: Share of the session's largest measured moment, or None at reference
    #: tier. Kept separate from :attr:`level` so a caller can say "a fifth of
    #: the session's biggest effort" without unpicking the band arithmetic.
    share: float | None = None
    value: float | None = None
    unit: str = ""
    source: str = ""

    @property
    def carries_a_number(self) -> bool:
        """Whether this may be drawn with a figure beside it.

        The interface rule for the whole bridge is that measured and reference
        are never told apart by colour alone. A number is the other half of
        that, so only a measurement gets one.
        """
        return self.tier == MEASURED and self.value is not None


@dataclass(frozen=True)
class Plan:
    """Everything to light for one session, and the scale it was drawn to."""

    lights: tuple[Light, ...]
    #: The measurement that set the top of the band, if any.
    top_source: str = ""
    top_value: float | None = None
    top_unit: str = ""

    @property
    def measured(self) -> tuple[Light, ...]:
        return tuple(l for l in self.lights if l.tier == MEASURED)

    @property
    def reference(self) -> tuple[Light, ...]:
        return tuple(l for l in self.lights if l.tier == REFERENCE)

    def scheme(self) -> dict:
        """The band description a viewer needs to draw its own legend.

        Shipped in the bundle so the legend is read from the file rather than
        hardcoded on the far side, where it could drift out of step with the
        levels it is supposed to explain.
        """
        out = {
            "measured_band": [MEASURED_FLOOR, MEASURED_CEILING],
            "reference_level": REFERENCE_LEVEL,
            "unlit": UNLIT,
            "note": (
                "Level is not an activation percentage and not EMG. Within the "
                "measured band it is this group's share of the largest joint "
                "moment measured in this one session; every muscle in a group "
                "shares its level, because the measurement is of the joint and "
                "cannot tell them apart. Reference structures are all one "
                "level: they show where to look, not how much."
            ),
        }
        if self.top_source:
            out["scale"] = {
                "from": self.top_source,
                "value": self.top_value,
                "unit": self.top_unit,
            }
        return out


def level_for(value: float, top: float) -> float:
    """Where a measured moment sits inside the measured band.

    ``top`` is the largest measured moment in the same session. A top of zero
    -- every group at rest, or a single group that measured nothing -- puts
    everything at the floor rather than dividing by it: they are all equally
    small, which is true, and the floor still says "measured".
    """
    if top <= 0:
        return MEASURED_FLOOR
    share = max(0.0, min(1.0, value / top))
    return MEASURED_FLOOR + (MEASURED_CEILING - MEASURED_FLOOR) * share


def plan(structures: list[dict]) -> Plan:
    """Turn a bundle's structure list into levels.

    Reads the entries the bundle already carries rather than the store, so the
    same file a viewer receives is the one the levels were computed from -- a
    plan that consulted anything the file does not contain could not be checked
    against it.
    """
    values = [s["value"] for s in structures
              if s.get("tier") == MEASURED and s.get("value") is not None]
    top = max(values) if values else 0.0
    top_source, top_unit = "", ""
    for s in structures:
        if s.get("tier") == MEASURED and s.get("value") == top:
            top_source, top_unit = s.get("from", ""), s.get("unit", "")
            break

    lights = []
    for s in structures:
        tier = s.get("tier")
        if tier == MEASURED and s.get("value") is not None:
            value = float(s["value"])
            lights.append(Light(
                fma=s.get("fma", ""), name=s["name"], layer=s.get("layer", ""),
                tier=MEASURED, level=level_for(value, top),
                share=(value / top) if top > 0 else 1.0,
                because=s["because"], plain=s.get("plain", ""), value=value,
                unit=s.get("unit", ""), source=s.get("from", "")))
        else:
            lights.append(Light(
                fma=s.get("fma", ""), name=s["name"], layer=s.get("layer", ""),
                tier=REFERENCE, level=REFERENCE_LEVEL, because=s["because"],
                plain=s.get("plain", ""), source=s.get("from", "")))
    return Plan(tuple(lights), top_source, top or None, top_unit)


def group_of(source: str) -> str:
    """The muscle group a peak-moment measurement is about."""
    return source[: -len(SUFFIX)] if source.endswith(SUFFIX) else source
