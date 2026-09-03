"""Which muscles, which nerves, which bones -- and where each fact came from.

A joint moment says the hip flexors carried 44 Nm. It does not say which
muscles those are, what innervates them, or which bones the joint articulates.
Those are real questions and they have real answers; they are simply answers
from anatomy rather than from the camera.

That distinction is the entire design here. Three kinds of statement live in
this module and are never allowed to blur:

``MEASURED``
    Computed from this student's video. "The hip flexors carried 44 Nm."
    Specific to this person, this session.

``REFERENCE``
    Anatomical fact, looked up by exercise name. "The hip flexors are
    iliopsoas, rectus femoris, sartorius and tensor fasciae latae; they are
    supplied by the femoral nerve from L2-L4." True of everybody, and true
    whether or not a camera was pointed at them.

``RESEARCH``
    A population-level finding. "Slow breathing shifts autonomic balance
    towards parasympathetic activity." Says something about groups of people
    in studies, and nothing whatsoever about this student today.

A product that shows all three without saying which is which is lying, even
when every individual statement is correct -- because the reader will assume
the nerve was observed and the brain effect was measured. Labelling them is
what makes it honest to show them at all.

The join between the first two is where this earns its place. Reference
anatomy says which muscles an exercise is *supposed* to work; measurement says
which ones actually carried the moment. When those disagree, that is
compensation, and it is a coaching observation neither source gives alone.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

#: Computed from this student's video.
MEASURED = "measured"
#: Anatomical fact, looked up by exercise name. True of everybody.
REFERENCE = "reference"
#: A population-level research finding. Not about this student.
RESEARCH = "research"


@dataclass(frozen=True)
class Innervation:
    """What supplies a muscle. Anatomy, not observation."""

    nerve: str
    roots: tuple[str, ...]
    plexus: str = ""

    def describe(self) -> str:
        roots = "-".join((self.roots[0], self.roots[-1])) if len(self.roots) > 1 \
            else self.roots[0]
        return f"{self.nerve} ({roots})"


#: Muscle -> what supplies it. Every muscle named anywhere in this module must
#: appear here; a test enforces that, so a new exercise cannot quietly
#: introduce a muscle whose nerve supply nobody filled in.
NERVE_SUPPLY: dict[str, Innervation] = {
    # --- hip and thigh -------------------------------------------------
    "iliopsoas": Innervation("femoral nerve and L1-L3 ventral rami",
                             ("L1", "L2", "L3", "L4"), "lumbar plexus"),
    "rectus femoris": Innervation("femoral nerve", ("L2", "L3", "L4"), "lumbar plexus"),
    "vastus lateralis": Innervation("femoral nerve", ("L2", "L3", "L4"), "lumbar plexus"),
    "vastus medialis": Innervation("femoral nerve", ("L2", "L3", "L4"), "lumbar plexus"),
    "vastus intermedius": Innervation("femoral nerve", ("L2", "L3", "L4"), "lumbar plexus"),
    "sartorius": Innervation("femoral nerve", ("L2", "L3"), "lumbar plexus"),
    "tensor fasciae latae": Innervation("superior gluteal nerve",
                                        ("L4", "L5", "S1"), "sacral plexus"),
    "gluteus maximus": Innervation("inferior gluteal nerve",
                                   ("L5", "S1", "S2"), "sacral plexus"),
    "gluteus medius": Innervation("superior gluteal nerve",
                                  ("L4", "L5", "S1"), "sacral plexus"),
    "gluteus minimus": Innervation("superior gluteal nerve",
                                   ("L4", "L5", "S1"), "sacral plexus"),
    "biceps femoris": Innervation("sciatic nerve (tibial division)",
                                  ("L5", "S1", "S2"), "sacral plexus"),
    "semitendinosus": Innervation("sciatic nerve (tibial division)",
                                  ("L5", "S1", "S2"), "sacral plexus"),
    "semimembranosus": Innervation("sciatic nerve (tibial division)",
                                   ("L5", "S1", "S2"), "sacral plexus"),
    "adductor magnus": Innervation("obturator and sciatic nerves",
                                   ("L2", "L3", "L4"), "lumbar plexus"),
    "adductor longus": Innervation("obturator nerve", ("L2", "L3", "L4"), "lumbar plexus"),
    "piriformis": Innervation("nerve to piriformis", ("S1", "S2"), "sacral plexus"),
    # --- leg and foot --------------------------------------------------
    "gastrocnemius": Innervation("tibial nerve", ("S1", "S2"), "sacral plexus"),
    "soleus": Innervation("tibial nerve", ("S1", "S2"), "sacral plexus"),
    "tibialis anterior": Innervation("deep fibular nerve", ("L4", "L5"), "sacral plexus"),
    "fibularis longus": Innervation("superficial fibular nerve",
                                    ("L5", "S1"), "sacral plexus"),
    # --- trunk ---------------------------------------------------------
    "rectus abdominis": Innervation("intercostal nerves", ("T7", "T12")),
    "external oblique": Innervation("intercostal nerves", ("T7", "T12")),
    "internal oblique": Innervation("intercostal, iliohypogastric and "
                                    "ilioinguinal nerves", ("T7", "L1")),
    "transversus abdominis": Innervation("intercostal, iliohypogastric and "
                                         "ilioinguinal nerves", ("T7", "L1")),
    "erector spinae": Innervation("dorsal rami of the spinal nerves", ("C1", "S5")),
    "multifidus": Innervation("dorsal rami of the spinal nerves", ("C1", "S5")),
    "quadratus lumborum": Innervation("subcostal nerve and lumbar plexus branches",
                                      ("T12", "L4"), "lumbar plexus"),
    "diaphragm": Innervation("phrenic nerve", ("C3", "C4", "C5"), "cervical plexus"),
    "pelvic floor": Innervation("pudendal nerve", ("S2", "S3", "S4"), "sacral plexus"),
    # --- shoulder girdle -----------------------------------------------
    "serratus anterior": Innervation("long thoracic nerve",
                                     ("C5", "C6", "C7"), "brachial plexus"),
    "trapezius": Innervation("accessory nerve (CN XI) and C3-C4", ("C3", "C4")),
    "rhomboids": Innervation("dorsal scapular nerve", ("C4", "C5"), "brachial plexus"),
    "levator scapulae": Innervation("dorsal scapular nerve and C3-C4",
                                    ("C3", "C5"), "brachial plexus"),
    "latissimus dorsi": Innervation("thoracodorsal nerve",
                                    ("C6", "C7", "C8"), "brachial plexus"),
    "pectoralis major": Innervation("lateral and medial pectoral nerves",
                                    ("C5", "T1"), "brachial plexus"),
    "pectoralis major (clavicular)": Innervation("lateral pectoral nerve",
                                                 ("C5", "C6", "C7"), "brachial plexus"),
    "pectoralis minor": Innervation("medial pectoral nerve",
                                    ("C8", "T1"), "brachial plexus"),
    # --- shoulder and arm ----------------------------------------------
    "anterior deltoid": Innervation("axillary nerve", ("C5", "C6"), "brachial plexus"),
    "posterior deltoid": Innervation("axillary nerve", ("C5", "C6"), "brachial plexus"),
    "deltoid": Innervation("axillary nerve", ("C5", "C6"), "brachial plexus"),
    "supraspinatus": Innervation("suprascapular nerve", ("C5", "C6"), "brachial plexus"),
    "infraspinatus": Innervation("suprascapular nerve", ("C5", "C6"), "brachial plexus"),
    "teres minor": Innervation("axillary nerve", ("C5", "C6"), "brachial plexus"),
    "teres major": Innervation("lower subscapular nerve",
                               ("C5", "C6"), "brachial plexus"),
    "subscapularis": Innervation("upper and lower subscapular nerves",
                                 ("C5", "C6", "C7"), "brachial plexus"),
    "biceps brachii": Innervation("musculocutaneous nerve",
                                  ("C5", "C6"), "brachial plexus"),
    "brachialis": Innervation("musculocutaneous nerve", ("C5", "C6"), "brachial plexus"),
    "coracobrachialis": Innervation("musculocutaneous nerve",
                                    ("C5", "C6", "C7"), "brachial plexus"),
    "brachioradialis": Innervation("radial nerve", ("C5", "C6"), "brachial plexus"),
    "triceps brachii": Innervation("radial nerve", ("C6", "C7", "C8"), "brachial plexus"),
    "anconeus": Innervation("radial nerve", ("C7", "C8"), "brachial plexus"),
    "wrist extensors": Innervation("radial nerve", ("C6", "C7", "C8"), "brachial plexus"),
    # --- neck ----------------------------------------------------------
    "sternocleidomastoid": Innervation("accessory nerve (CN XI) and C2-C3",
                                       ("C2", "C3")),
    "deep neck flexors": Innervation("cervical ventral rami", ("C1", "C6"),
                                     "cervical plexus"),
}


#: Which bones each joint articulates. Used to keep an entry's bone list
#: consistent with the joints it claims, so a hand-written entry cannot say
#: "shoulder" and then list only the spine.
JOINT_BONES: dict[str, tuple[str, ...]] = {
    "ankle": ("tibia", "fibula"),
    "knee": ("femur", "tibia"),
    "hip": ("femur", "pelvis"),
    "spine": ("vertebral column", "pelvis"),
    "shoulder": ("humerus", "scapula", "clavicle"),
    "elbow": ("humerus", "radius", "ulna"),
}


def bones_for(joints) -> tuple[str, ...]:
    """Every bone the named joints articulate, without duplicates."""
    out: list[str] = []
    for joint in joints:
        for bone in JOINT_BONES.get(joint, ()):
            if bone not in out:
                out.append(bone)
    return tuple(out)


def innervation(muscle: str) -> Innervation | None:
    """What supplies this muscle, or None if it is not in the table."""
    return NERVE_SUPPLY.get(muscle)


@dataclass
class AnatomyEntry:
    """The reference anatomy of one exercise. Looked up, never measured.

    ``bones`` lists the bones the working joints articulate. That is an
    anatomical fact. It is emphatically *not* a statement about bone loading,
    which needs joint reaction forces this system refuses to estimate -- see
    ``docs/what-cannot-be-measured.md``.
    """

    exercise: str
    prime_movers: tuple[str, ...] = ()
    synergists: tuple[str, ...] = ()
    stabilisers: tuple[str, ...] = ()
    joints: tuple[str, ...] = ()
    bones: tuple[str, ...] = ()
    note: str = ""
    #: Where this entry came from. Kept per-entry so an imported library can
    #: say which book or project it was taken from.
    source: str = ""

    @property
    def muscles(self) -> tuple[str, ...]:
        seen: list[str] = []
        for muscle in self.prime_movers + self.synergists + self.stabilisers:
            if muscle not in seen:
                seen.append(muscle)
        return tuple(seen)

    def nerves(self) -> list[tuple[str, Innervation]]:
        """Every named muscle paired with what supplies it, in order."""
        return [(m, NERVE_SUPPLY[m]) for m in self.muscles if m in NERVE_SUPPLY]

    def roots(self) -> list[str]:
        """The spinal levels involved, low to high, without duplicates."""
        order = ([f"C{i}" for i in range(1, 9)] + [f"T{i}" for i in range(1, 13)]
                 + [f"L{i}" for i in range(1, 6)] + [f"S{i}" for i in range(1, 6)])
        rank = {name: i for i, name in enumerate(order)}
        found = {root for _, supply in self.nerves() for root in supply.roots}
        return sorted(found, key=lambda r: rank.get(r, 999))

    def to_dict(self) -> dict:
        return {
            "exercise": self.exercise,
            "prime_movers": list(self.prime_movers),
            "synergists": list(self.synergists),
            "stabilisers": list(self.stabilisers),
            "joints": list(self.joints),
            "bones": list(self.bones),
            "note": self.note,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AnatomyEntry":
        """Rebuild an entry, deriving bones from joints when they are absent.

        Imported data is the case this matters for: a curated library will
        name the joints an exercise works and often not bother with bones, and
        listing none is worse than listing the ones those joints articulate.
        """
        joints = tuple(data.get("joints", ()))
        return cls(
            exercise=data["exercise"],
            prime_movers=tuple(data.get("prime_movers", ())),
            synergists=tuple(data.get("synergists", ())),
            stabilisers=tuple(data.get("stabilisers", ())),
            joints=joints,
            bones=tuple(data.get("bones", ())) or bones_for(joints),
            note=data.get("note", ""),
            source=data.get("source", ""),
        )


@dataclass
class ResearchNote:
    """A population-level finding, and the citation that makes it usable.

    Deliberately awkward to show. Anything in this class is about groups of
    people in studies and says nothing about the student in front of you, so
    an unsourced note is withheld by default rather than printed with a
    confident tone and no way to check it.
    """

    claim: str
    population: str = ""
    citation: str = ""

    @property
    def sourced(self) -> bool:
        return bool(self.citation.strip())

    def describe(self) -> str:
        where = f" ({self.population})" if self.population else ""
        cite = f" [{self.citation}]" if self.sourced else " [SOURCE NEEDED]"
        return f"{self.claim}{where}{cite}"


def _entry(name, prime, syn=(), stab=(), joints=(), bones=(), note=""):
    """One entry. Bones are derived from the joints unless given explicitly,
    so the two can never drift apart in hand-written data."""
    return AnatomyEntry(name, tuple(prime), tuple(syn), tuple(stab),
                        tuple(joints), tuple(bones) or bones_for(joints), note,
                        source="standard anatomical reference")


DEFAULT_ANATOMY: dict[str, AnatomyEntry] = {
    # --- standing ------------------------------------------------------
    "mountain": _entry(
        "mountain", ["erector spinae", "multifidus"],
        ["gluteus medius", "soleus", "tibialis anterior"],
        ["transversus abdominis", "diaphragm"],
        ["ankle", "knee", "hip", "spine"],
        note="Almost entirely postural: the demand is small and continuous, "
             "which is why a load estimate here is near zero and still correct."),
    "upward_salute": _entry(
        "upward_salute", ["anterior deltoid", "supraspinatus", "trapezius"],
        ["serratus anterior", "erector spinae"],
        ["transversus abdominis", "gluteus maximus"],
        ["shoulder", "spine"]),
    "forward_fold": _entry(
        "forward_fold", ["iliopsoas", "rectus abdominis"],
        ["erector spinae"],
        ["biceps femoris", "semitendinosus", "semimembranosus"],
        ["hip", "spine"],
        note="The hamstrings lengthen under tension here rather than shorten, "
             "so they appear as stabilisers, not prime movers."),
    "half_lift": _entry(
        "half_lift", ["erector spinae", "multifidus"],
        ["trapezius", "rhomboids"],
        ["transversus abdominis", "biceps femoris"],
        ["spine", "hip"]),
    "standing_back_bend": _entry(
        "standing_back_bend", ["erector spinae", "multifidus"],
        ["gluteus maximus", "quadratus lumborum"],
        ["transversus abdominis", "rectus abdominis"],
        ["spine", "hip"]),
    "standing_side_bend": _entry(
        "standing_side_bend", ["quadratus lumborum", "external oblique"],
        ["internal oblique", "erector spinae"],
        ["gluteus medius", "transversus abdominis"],
        ["spine", "hip"]),
    "chair": _entry(
        "chair", ["rectus femoris", "vastus lateralis", "vastus medialis",
                  "vastus intermedius"],
        ["gluteus maximus", "erector spinae", "soleus"],
        ["transversus abdominis", "tibialis anterior"],
        ["knee", "hip", "ankle", "spine"],
        note="Both feet are on the floor, so the measured load is refused: the "
             "ground reaction force dominates and is unmeasured."),
    "tree": _entry(
        "tree", ["gluteus medius", "gluteus minimus"],
        ["tensor fasciae latae", "soleus", "fibularis longus"],
        ["transversus abdominis", "multifidus", "tibialis anterior"],
        ["hip", "ankle", "knee"],
        note="The work is frontal-plane hip stability on the standing leg, "
             "which is why the standing side is the one that matters."),
    "warrior_one": _entry(
        "warrior_one", ["rectus femoris", "vastus lateralis", "gluteus maximus"],
        ["anterior deltoid", "erector spinae", "soleus"],
        ["transversus abdominis", "gluteus medius"],
        ["hip", "knee", "shoulder", "spine"]),
    "warrior_two": _entry(
        "warrior_two", ["rectus femoris", "vastus lateralis", "gluteus medius"],
        ["deltoid", "trapezius", "adductor magnus"],
        ["transversus abdominis", "erector spinae"],
        ["hip", "knee", "shoulder"]),
    "warrior_three": _entry(
        "warrior_three", ["gluteus maximus", "erector spinae"],
        ["biceps femoris", "semitendinosus", "gluteus medius"],
        ["transversus abdominis", "multifidus", "tibialis anterior"],
        ["hip", "spine", "ankle"],
        note="Asymmetric by design: the lifted leg and the standing leg are "
             "doing entirely different jobs."),
    "high_lunge": _entry(
        "high_lunge", ["rectus femoris", "vastus lateralis", "gluteus maximus"],
        ["iliopsoas", "erector spinae"],
        ["transversus abdominis", "gluteus medius"],
        ["hip", "knee"]),
    "low_lunge": _entry(
        "low_lunge", ["gluteus maximus", "rectus femoris"],
        ["iliopsoas", "erector spinae", "anterior deltoid"],
        ["transversus abdominis"],
        ["hip", "knee", "spine"]),
    # --- prone and quadruped -------------------------------------------
    "plank": _entry(
        "plank", ["transversus abdominis", "rectus abdominis", "serratus anterior"],
        ["anterior deltoid", "triceps brachii", "gluteus maximus"],
        ["multifidus", "quadratus lumborum"],
        ["shoulder", "spine", "hip"],
        note="Isometric throughout. Both hands and both feet are on the floor, "
             "so the load is refused rather than estimated."),
    "side_plank": _entry(
        "side_plank", ["external oblique", "internal oblique", "quadratus lumborum"],
        ["gluteus medius", "serratus anterior", "deltoid"],
        ["transversus abdominis", "multifidus"],
        ["spine", "shoulder", "hip"]),
    "chaturanga": _entry(
        "chaturanga", ["triceps brachii", "pectoralis major", "serratus anterior"],
        ["anterior deltoid", "rectus abdominis"],
        ["transversus abdominis", "gluteus maximus"],
        ["elbow", "shoulder", "spine"],
        note="Eccentric on the way down: the same muscles that would press up "
             "are lengthening under load."),
    "push_up": _entry(
        "push_up", ["pectoralis major", "triceps brachii", "anterior deltoid"],
        ["serratus anterior", "coracobrachialis"],
        ["transversus abdominis", "gluteus maximus"],
        ["elbow", "shoulder"]),
    "cobra": _entry(
        "cobra", ["erector spinae", "multifidus"],
        ["triceps brachii", "trapezius", "rhomboids"],
        ["gluteus maximus", "transversus abdominis"],
        ["spine", "shoulder"]),
    "upward_dog": _entry(
        "upward_dog", ["erector spinae", "triceps brachii"],
        ["gluteus maximus", "trapezius", "posterior deltoid"],
        ["transversus abdominis", "serratus anterior"],
        ["spine", "shoulder", "elbow"]),
    "downward_dog": _entry(
        "downward_dog", ["serratus anterior", "trapezius", "anterior deltoid"],
        ["triceps brachii", "erector spinae", "soleus"],
        ["transversus abdominis", "biceps femoris"],
        ["shoulder", "hip", "ankle"]),
    "childs_pose": _entry(
        "childs_pose", [],
        ["erector spinae"],
        ["diaphragm"],
        ["hip", "knee", "spine"],
        note="A rest position. Nothing is working concentrically, which is the "
             "correct answer rather than a failure to find one."),
    "swan": _entry(
        "swan", ["erector spinae", "multifidus"],
        ["gluteus maximus", "trapezius", "posterior deltoid"],
        ["transversus abdominis", "biceps femoris"],
        ["spine", "hip"]),
    "swimming": _entry(
        "swimming", ["erector spinae", "multifidus", "gluteus maximus"],
        ["posterior deltoid", "latissimus dorsi", "biceps femoris"],
        ["transversus abdominis", "quadratus lumborum"],
        ["spine", "hip", "shoulder"],
        note="Asymmetric by design: opposite arm and leg lift together."),
    "leg_pull_front": _entry(
        "leg_pull_front", ["gluteus maximus", "serratus anterior"],
        ["transversus abdominis", "triceps brachii", "anterior deltoid"],
        ["multifidus", "quadratus lumborum"],
        ["hip", "shoulder", "spine"]),
    # --- supine --------------------------------------------------------
    "bridge": _entry(
        "bridge", ["gluteus maximus", "biceps femoris", "semitendinosus"],
        ["erector spinae", "adductor magnus", "semimembranosus"],
        ["transversus abdominis", "multifidus"],
        ["hip", "spine", "knee"]),
    "the_hundred": _entry(
        "the_hundred", ["rectus abdominis", "transversus abdominis"],
        ["iliopsoas", "external oblique", "internal oblique", "anterior deltoid"],
        ["diaphragm", "deep neck flexors"],
        ["spine", "hip", "shoulder"],
        note="The breath pattern is part of the exercise, not decoration: five "
             "in, five out, against a held flexion."),
    "roll_up": _entry(
        "roll_up", ["rectus abdominis", "external oblique", "internal oblique"],
        ["iliopsoas", "transversus abdominis"],
        ["deep neck flexors", "erector spinae"],
        ["spine", "hip"]),
    "neck_pull": _entry(
        "neck_pull", ["rectus abdominis", "iliopsoas"],
        ["external oblique", "internal oblique", "erector spinae"],
        ["deep neck flexors", "transversus abdominis"],
        ["spine", "hip"]),
    "single_leg_stretch": _entry(
        "single_leg_stretch", ["rectus abdominis", "iliopsoas"],
        ["external oblique", "internal oblique", "rectus femoris"],
        ["transversus abdominis", "deep neck flexors"],
        ["hip", "spine"],
        note="Asymmetric by design: the legs alternate."),
    "double_leg_stretch": _entry(
        "double_leg_stretch", ["rectus abdominis", "transversus abdominis"],
        ["iliopsoas", "external oblique", "anterior deltoid"],
        ["multifidus", "deep neck flexors"],
        ["hip", "spine", "shoulder"]),
    "single_leg_circle": _entry(
        "single_leg_circle", ["iliopsoas", "rectus femoris"],
        ["adductor longus", "gluteus medius", "tensor fasciae latae"],
        ["transversus abdominis", "external oblique", "multifidus"],
        ["hip", "spine"],
        note="Asymmetric by design, and the point is what does *not* move: the "
             "pelvis is supposed to stay still while the leg circles."),
    "single_leg_kick": _entry(
        "single_leg_kick", ["biceps femoris", "semitendinosus", "semimembranosus"],
        ["gluteus maximus", "erector spinae"],
        ["transversus abdominis", "trapezius"],
        ["knee", "hip", "spine"],
        note="Asymmetric by design: the legs alternate."),
    "teaser": _entry(
        "teaser", ["rectus abdominis", "iliopsoas"],
        ["external oblique", "internal oblique", "rectus femoris"],
        ["transversus abdominis", "erector spinae", "multifidus"],
        ["hip", "spine"]),
    "rolling_like_a_ball": _entry(
        "rolling_like_a_ball", ["rectus abdominis", "transversus abdominis"],
        ["iliopsoas", "external oblique"],
        ["multifidus", "deep neck flexors"],
        ["spine", "hip"]),
    "seal": _entry(
        "seal", ["rectus abdominis", "transversus abdominis"],
        ["iliopsoas", "adductor longus"],
        ["multifidus", "deep neck flexors"],
        ["spine", "hip"]),
    "spine_stretch_forward": _entry(
        "spine_stretch_forward", ["rectus abdominis", "external oblique"],
        ["transversus abdominis"],
        ["erector spinae", "biceps femoris"],
        ["spine", "hip"],
        note="Seated. Sequential spinal flexion is the whole exercise, so a "
             "single trunk angle understates what is being asked."),
}


#: Population-level findings. Every one of these is about groups of people in
#: studies and none of them is about the student in front of you. They ship
#: unsourced on purpose: a claim about the nervous system or the brain is not
#: fit to show a paying customer until somebody has attached the paper it came
#: from, and leaving the field blank makes that visible instead of assumed.
RESEARCH_NOTES: dict[str, list[ResearchNote]] = {
    "slow_breathing": [
        ResearchNote(
            "Paced breathing at roughly six breaths per minute is associated "
            "with increased heart rate variability and a shift in autonomic "
            "balance towards parasympathetic activity",
            population="healthy adults, controlled breathing protocols"),
    ],
    "balance_work": [
        ResearchNote(
            "Balance training is associated with improved postural control and "
            "reduced fall risk in older adults",
            population="older adults, supervised programmes"),
    ],
    "sustained_holds": [
        ResearchNote(
            "Isometric resistance training is associated with reductions in "
            "resting blood pressure",
            population="adults, multi-week programmes"),
    ],
    "mind_body_practice": [
        ResearchNote(
            "Regular yoga or Pilates practice is associated with reduced "
            "self-reported anxiety and improved sleep quality",
            population="mixed adult samples, self-report instruments"),
    ],
}


@dataclass
class AnatomyLibrary:
    """Reference anatomy, loadable from JSON so curated data can be imported.

    A studio that already has an exercise-to-anatomy reference -- and anybody
    building this seriously will -- should not have to re-enter it here.
    """

    entries: dict[str, AnatomyEntry] = field(default_factory=dict)
    research: dict[str, list[ResearchNote]] = field(default_factory=dict)

    @classmethod
    def default(cls) -> "AnatomyLibrary":
        return cls(entries=dict(DEFAULT_ANATOMY), research=dict(RESEARCH_NOTES))

    def get(self, exercise: str) -> AnatomyEntry | None:
        return self.entries.get(exercise)

    def unknown_muscles(self) -> list[str]:
        """Muscles named by some entry with no nerve supply recorded.

        An imported library will have these, and they are the difference
        between "we do not list a nerve for this" and "we made one up".
        """
        missing = {m for entry in self.entries.values()
                   for m in entry.muscles if m not in NERVE_SUPPLY}
        return sorted(missing)

    def sourced_research(self, key: str) -> list[ResearchNote]:
        return [n for n in self.research.get(key, []) if n.sourced]

    @classmethod
    def load(cls, path: str | Path) -> "AnatomyLibrary":
        data = json.loads(Path(path).read_text())
        entries = {e["exercise"]: AnatomyEntry.from_dict(e)
                   for e in data.get("exercises", [])}
        research = {
            key: [ResearchNote(**n) for n in notes]
            for key, notes in data.get("research", {}).items()
        }
        return cls(entries=entries, research=research)

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps({
            "exercises": [e.to_dict() for e in self.entries.values()],
            "research": {
                key: [{"claim": n.claim, "population": n.population,
                       "citation": n.citation} for n in notes]
                for key, notes in self.research.items()
            },
        }, indent=2) + "\n")


# ---------------------------------------------------------------------------
# The join: what anatomy expects against what the camera measured.
# ---------------------------------------------------------------------------

#: Share of the peak measured moment a group must carry before an unexpected
#: reading is worth mentioning. Below this it is a rounding artefact.
NOTABLE_SHARE = 0.4


def groups_for(muscle: str) -> list[str]:
    """Which measurable muscle groups this muscle belongs to, if any."""
    from .biomechanics import MUSCLE_GROUPS

    return sorted({group.name for group in MUSCLE_GROUPS.values()
                   if muscle in group.members})


def measurable_groups() -> set[str]:
    """The groups joint moments can speak to at all.

    Everything else in an anatomy entry -- the whole trunk, the scapular
    stabilisers, the deep neck flexors -- is outside what a gravitational
    moment at a limb joint can address. That is a boundary of the measurement,
    not a finding about the student, and the difference matters enormously in
    a report.
    """
    from .biomechanics import MUSCLE_GROUPS

    return {group.name for group in MUSCLE_GROUPS.values()}


@dataclass
class Reconciliation:
    """Reference anatomy set against this student's measured joint moments.

    This is the only part of the module that is about a particular person.
    """

    exercise: str
    #: Groups anatomy expects and the measurement confirmed carried load.
    confirmed: dict[str, float] = field(default_factory=dict)
    #: Groups that carried real load but anatomy did not expect for this
    #: exercise. The interesting case: usually compensation.
    unexpected: dict[str, float] = field(default_factory=dict)
    #: Expected, measurable, and yet nothing was measured -- with the reason.
    silent: dict[str, str] = field(default_factory=dict)
    #: Expected muscles no joint moment can speak to. Reference only.
    beyond_measurement: tuple[str, ...] = ()

    @property
    def compensating(self) -> bool:
        return bool(self.unexpected)

    def describe(self) -> list[tuple[str, str]]:
        """Lines paired with their provenance, so a caller cannot lose it."""
        lines: list[tuple[str, str]] = []
        for name, moment in sorted(self.confirmed.items(), key=lambda kv: -kv[1]):
            lines.append((MEASURED,
                          f"the {name} carried {moment:.0f} Nm, which is what "
                          f"{self.exercise.replace('_', ' ')} asks of them"))
        for name, moment in sorted(self.unexpected.items(), key=lambda kv: -kv[1]):
            lines.append((MEASURED,
                          f"the {name} carried {moment:.0f} Nm, which this "
                          f"exercise does not usually ask for — worth watching "
                          f"for compensation"))
        for name, reason in sorted(self.silent.items()):
            lines.append((MEASURED, f"no load measured at the {name}: {reason}"))
        if self.beyond_measurement:
            lines.append((REFERENCE,
                          "also working, by anatomy rather than measurement: "
                          + ", ".join(self.beyond_measurement)))
        return lines


def reconcile(
    entry: AnatomyEntry,
    load_report=None,
    notable_share: float = NOTABLE_SHARE,
) -> Reconciliation:
    """Compare what the exercise should work against what actually carried load.

    Agreement is reassurance. Disagreement is the useful signal: a muscle group
    carrying substantial load that this exercise does not ask for is what
    compensation looks like from outside.

    Absence is deliberately *not* treated as evidence. A group that anatomy
    expects and the measurement is silent about is reported with the reason it
    was silent -- almost always a weight-bearing limb, where the ground
    reaction force is unmeasured -- and never as "this student did not use
    them".
    """
    expected: set[str] = set()
    for muscle in entry.prime_movers + entry.synergists:
        expected.update(groups_for(muscle))

    beyond = tuple(m for m in entry.prime_movers if not groups_for(m))

    result = Reconciliation(exercise=entry.exercise, beyond_measurement=beyond)
    if load_report is None:
        result.silent = {name: "no load report was supplied" for name in sorted(expected)}
        return result

    measured = load_report.by_group()
    peak = max(measured.values()) if measured else 0.0

    for name, moment in measured.items():
        if name in expected:
            result.confirmed[name] = moment
        elif peak and moment >= peak * notable_share:
            result.unexpected[name] = moment

    reasons = {joint: reason for joint, reason in load_report.skipped.items()}
    for name in sorted(expected - set(measured)):
        articulation = name.split()[0]
        reason = next(
            (r for joint, r in reasons.items() if joint.endswith(articulation)),
            "not visible, or not computable from this view",
        )
        result.silent[name] = reason
    return result
