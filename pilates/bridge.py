"""Which 3D structure a measurement is about.

The join between what this system measures and what an anatomy model can draw.
It lives here rather than in the anatomy project because that project is
read-only to this one: it is imported from, never written to.

Three kinds of link, and they are not equally solid:

**Muscles carry an FMA id.** The Foundational Model of Anatomy is a standard
ontology, so ``FMA22342`` means psoas major to anything that speaks it -- a far
better contract than a name string that either side might reword. Every muscle
in the eight measurable groups has one.

**Bones carry one too**, and are used for a weaker claim: which bones a measured
joint articulates. That is navigation, not measurement. Nothing here estimates
what a bone carried.

**Nerves carry none.** The meshes exist and are named, but the source data has
no FMA id for any of them, so they can only be matched by name -- and a rename
on either side breaks the link silently. :func:`check` is what catches that.
The claim they support is weaker still: this nerve supplies a muscle that was
measured, which says where to look, not what fired.

Every entry is a judgement somebody should be able to check, so the tables are
written out rather than derived at runtime, and :func:`check` verifies them
against a fresh export of the model.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .anatomy import JOINT_BONES, NERVE_SUPPLY, canonical
from .biomechanics import MUSCLE_GROUPS

#: A measurement of this person, in this session.
MEASURED = "measured"
#: Anatomy, true of everybody. Lit to show where to look.
REFERENCE = "reference"


@dataclass(frozen=True)
class Mesh:
    """One drawable structure, and how confidently it is identified."""

    #: The name the anatomy model knows it by.
    name: str
    #: Foundational Model of Anatomy id, or "" when the source has none.
    fma: str = ""
    layer: str = ""

    @property
    def keyed_by_ontology(self) -> bool:
        """Whether this link survives either side renaming the structure."""
        return bool(self.fma)


#: Our muscle vocabulary -> the model's mesh. Where the two libraries split a
#: muscle differently, the synonym table in :mod:`pilates.anatomy` has already
#: reconciled them and this records the result.
MUSCLE_MESH: dict[str, Mesh] = {
    "anconeus": Mesh("anconeus", "FMA37705", "muscles_deep"),
    "anterior deltoid": Mesh("deltoid", "FMA34680", "muscles_superficial"),
    "biceps brachii": Mesh("biceps brachii", "FMA37684", "muscles_superficial"),
    "biceps femoris": Mesh("biceps femoris", "FMA45888", "muscles_superficial"),
    "brachialis": Mesh("brachialis", "FMA37668", "muscles_deep"),
    "brachioradialis": Mesh("brachioradialis", "FMA38486", "muscles_superficial"),
    "coracobrachialis": Mesh("coracobrachialis", "FMA37665", "muscles_deep"),
    "gastrocnemius": Mesh("gastrocnemius", "FMA45957", "muscles_superficial"),
    "gluteus maximus": Mesh("gluteus maximus", "FMA22328", "muscles_superficial"),
    # The model splits iliopsoas into its two heads, which is the more precise
    # anatomy; a gravitational moment cannot tell them apart, so the group
    # points at the larger of the two.
    "iliopsoas": Mesh("psoas major", "FMA22342", "muscles_deep"),
    "latissimus dorsi": Mesh("latissimus dorsi", "FMA13358", "muscles_superficial"),
    "pectoralis major (clavicular)": Mesh("pectoralis major", "FMA34690",
                                          "muscles_superficial"),
    "posterior deltoid": Mesh("deltoid", "FMA34680", "muscles_superficial"),
    "rectus femoris": Mesh("rectus femoris", "FMA38928", "muscles_superficial"),
    "sartorius": Mesh("sartorius", "FMA22354", "muscles_superficial"),
    "semimembranosus": Mesh("semimembranosus", "FMA22448", "muscles_deep"),
    "semitendinosus": Mesh("semitendinosus", "FMA22358", "muscles_superficial"),
    "tensor fasciae latae": Mesh("tensor fasciae latae", "FMA22425",
                                 "muscles_superficial"),
    "teres major": Mesh("teres major", "FMA32551", "muscles_deep"),
    "triceps brachii": Mesh("triceps brachii", "FMA37695", "muscles_superficial"),
    "vastus intermedius": Mesh("vastus intermedius", "FMA38934", "muscles_deep"),
    "vastus lateralis": Mesh("vastus lateralis", "FMA38930", "muscles_superficial"),
    "vastus medialis": Mesh("vastus medialis", "FMA38932", "muscles_superficial"),
}

#: Bones, for saying which ones a measured joint articulates.
BONE_MESH: dict[str, Mesh] = {
    "femur": Mesh("femur", "FMA24474", "skeleton"),
    "tibia": Mesh("tibia", "FMA24477", "skeleton"),
    "fibula": Mesh("fibula", "FMA24480", "skeleton"),
    "patella": Mesh("patella", "FMA24486", "skeleton"),
    "humerus": Mesh("humerus", "FMA23130", "skeleton"),
    "radius": Mesh("radius", "FMA23464", "skeleton"),
    "ulna": Mesh("ulna", "FMA23467", "skeleton"),
    "scapula": Mesh("scapula", "FMA13395", "skeleton"),
    "clavicle": Mesh("clavicle", "FMA13322", "skeleton"),
}

#: Nerves, by name only: the source model carries no FMA id for any of them.
#: A rename on either side breaks these silently, which is what :func:`check`
#: exists to catch.
NERVE_MESH: dict[str, Mesh] = {
    name: Mesh(name, "", "nervous") for name in (
        "axillary nerve", "brachial plexus", "common fibular nerve",
        "cranial nerves", "femoral nerve", "intercostal nerves",
        "long thoracic nerve", "lumbar plexus", "median nerve",
        "musculocutaneous nerve", "obturator nerve", "radial nerve",
        "sacral plexus", "sciatic nerve", "spinal cord", "spinal nerve roots",
        "sympathetic trunk", "tibial nerve", "ulnar nerve", "vagus nerve",
    )
}


def mesh_for_muscle(muscle: str) -> Mesh | None:
    """The mesh one muscle is drawn as, following the synonym table."""
    if muscle in MUSCLE_MESH:
        return MUSCLE_MESH[muscle]
    for name in canonical(muscle):
        if name in MUSCLE_MESH:
            return MUSCLE_MESH[name]
    return None


def meshes_for_group(group: str) -> list[Mesh]:
    """Every mesh a measured muscle group is drawn as, without duplicates.

    Deltoid appears in both shoulder groups because the model does not split
    its anterior and posterior fibres, and both really are the same mesh.
    """
    for key in MUSCLE_GROUPS:
        if MUSCLE_GROUPS[key].name != group:
            continue
        out: list[Mesh] = []
        for muscle in MUSCLE_GROUPS[key].members:
            mesh = mesh_for_muscle(muscle)
            if mesh is not None and mesh not in out:
                out.append(mesh)
        return out
    return []


def bones_for_joint(joint: str) -> list[Mesh]:
    """The bones a joint articulates. Navigation, never a load."""
    articulation = joint.split("_")[-1]
    return [BONE_MESH[b] for b in JOINT_BONES.get(articulation, ())
            if b in BONE_MESH]


def nerves_for_group(group: str) -> list[Mesh]:
    """Nerves supplying the muscles of a measured group.

    The weakest link in this module, and the one most likely to be misread:
    it means "supplies a muscle that was measured", never "this nerve fired".
    Nothing in this system observes a nerve.
    """
    out: list[Mesh] = []
    for mesh_muscle in MUSCLE_GROUPS:
        if MUSCLE_GROUPS[mesh_muscle].name != group:
            continue
        for muscle in MUSCLE_GROUPS[mesh_muscle].members:
            supply = NERVE_SUPPLY.get(muscle)
            if supply is None:
                continue
            for name, mesh in NERVE_MESH.items():
                # A supply description names its nerve in prose, so the match
                # is on the nerve's own name appearing in it.
                if name.rstrip("s") in supply.nerve.lower() and mesh not in out:
                    out.append(mesh)
    return out


@dataclass
class BridgeCheck:
    """Whether every link still resolves against the model as it stands."""

    checked: int = 0
    missing: list[str] = field(default_factory=list)
    renamed: list[str] = field(default_factory=list)
    without_fma: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing and not self.renamed

    def describe(self) -> str:
        lines = [f"{self.checked} link(s) checked, "
                 f"{len(self.missing) + len(self.renamed)} broken."]
        for name in sorted(self.missing):
            lines.append(f"  no mesh named {name!r} in the model any more")
        for name in sorted(self.renamed):
            lines.append(f"  {name}: the model's FMA id has changed")
        if self.without_fma:
            lines.append(f"  {len(self.without_fma)} link(s) matched by name "
                         f"alone, with no FMA id to fall back on: a rename on "
                         f"either side breaks these silently.")
        return "\n".join(lines)


def check(structures: list[dict]) -> BridgeCheck:
    """Verify every link against a fresh export of the anatomy model.

    Worth more than the tables themselves: it is what fails when either side
    renames a structure, instead of a body quietly lighting up the wrong part.
    """
    by_name = {s["name"]: s for s in structures}
    result = BridgeCheck()
    for table in (MUSCLE_MESH, BONE_MESH, NERVE_MESH):
        for mesh in table.values():
            result.checked += 1
            found = by_name.get(mesh.name)
            if found is None:
                result.missing.append(mesh.name)
                continue
            ids = found.get("fma") or []
            if not mesh.fma:
                result.without_fma.append(mesh.name)
            elif mesh.fma not in ids:
                result.renamed.append(mesh.name)
    return result
