import json

import pytest

from pilates.anatomy import (
    DEFAULT_ANATOMY, MEASURED, NERVE_SUPPLY, REFERENCE, RESEARCH,
    AnatomyEntry, AnatomyLibrary, Innervation, ResearchNote, groups_for,
    innervation, measurable_groups, reconcile,
)
from pilates.biomechanics import JointLoad, LoadReport, MUSCLE_GROUPS


def load_report(**groups):
    """A report where each named group carried the given peak moment."""
    loads = []
    for key, moment in groups.items():
        articulation, direction = key.rsplit("_", 1)
        group = MUSCLE_GROUPS[(articulation, direction)]
        loads.append(JointLoad(
            joint=f"left_{articulation}", moment_nm=moment, direction=direction,
            group=group, contraction="isometric", lever_m=0.2, load_kg=8.0))
    return LoadReport(loads=loads, body_mass_kg=65.0)


class TestNerveSupply:
    def test_every_muscle_named_anywhere_has_an_innervation(self):
        """The difference between "we do not list a nerve for this" and "we
        made one up". A new exercise must not be able to introduce a muscle
        whose supply nobody filled in."""
        assert AnatomyLibrary.default().unknown_muscles() == []

    def test_a_known_muscle_resolves(self):
        supply = innervation("gluteus maximus")
        assert supply is not None
        assert "inferior gluteal" in supply.nerve

    def test_an_unknown_one_returns_nothing_rather_than_guessing(self):
        assert innervation("gastrocsoleus complex") is None

    def test_the_description_reads_as_a_range(self):
        assert Innervation("femoral nerve", ("L2", "L3", "L4")).describe() == \
            "femoral nerve (L2-L4)"

    def test_a_single_root_is_not_written_as_a_range(self):
        assert Innervation("nerve", ("S1",)).describe() == "nerve (S1)"

    def test_the_diaphragm_is_cervical_which_is_the_one_people_get_wrong(self):
        assert innervation("diaphragm").roots == ("C3", "C4", "C5")

    def test_roots_are_ordered_head_to_tail(self):
        entry = DEFAULT_ANATOMY["the_hundred"]
        roots = entry.roots()
        assert roots.index("C5") < roots.index("T7") < roots.index("L2")


class TestCoverage:
    def test_every_assessable_exercise_has_reference_anatomy(self):
        """Otherwise a student is coached on an exercise the report cannot say
        anything anatomical about."""
        from pilates.coaching import DEFAULT_STANDARDS

        missing = sorted(set(DEFAULT_STANDARDS) - set(DEFAULT_ANATOMY))
        assert missing == []

    def test_no_anatomy_entry_is_orphaned(self):
        from pilates.coaching import DEFAULT_STANDARDS

        assert sorted(set(DEFAULT_ANATOMY) - set(DEFAULT_STANDARDS)) == []

    def test_every_entry_names_its_source(self):
        assert all(e.source for e in DEFAULT_ANATOMY.values())

    def test_a_rest_position_may_legitimately_have_no_prime_movers(self):
        """"Nothing is working concentrically" is the right answer for child's
        pose, not a gap to be filled in."""
        assert DEFAULT_ANATOMY["childs_pose"].prime_movers == ()
        assert DEFAULT_ANATOMY["childs_pose"].note

    def test_muscles_are_deduplicated_across_roles(self):
        entry = AnatomyEntry("x", ("gluteus maximus",), ("gluteus maximus",),
                             ("multifidus",))
        assert entry.muscles == ("gluteus maximus", "multifidus")

    def test_bones_are_listed_for_the_joints_involved(self):
        assert "femur" in DEFAULT_ANATOMY["bridge"].bones


class TestReconciliation:
    """Reference says what should work; the camera says what did. The gap is
    the only part of this module that is about a particular person."""

    def test_agreement_is_reported_as_confirmation(self):
        entry = DEFAULT_ANATOMY["the_hundred"]
        result = reconcile(entry, load_report(hip_flexion=44.0))
        assert "hip flexors" in result.confirmed
        assert not result.compensating

    def test_an_unexpected_group_is_flagged_as_compensation(self):
        entry = DEFAULT_ANATOMY["the_hundred"]
        result = reconcile(entry, load_report(hip_flexion=44.0, knee_extension=40.0))
        assert "knee extensors" in result.unexpected

    def test_a_small_unexpected_reading_is_not_worth_mentioning(self):
        entry = DEFAULT_ANATOMY["the_hundred"]
        result = reconcile(entry, load_report(hip_flexion=44.0, knee_extension=2.0))
        assert result.unexpected == {}

    def test_absence_is_never_reported_as_the_student_not_working(self):
        """A weight-bearing limb produces no measurement. Printing "you did not
        use your glutes" from that would be a lie with a number attached."""
        entry = DEFAULT_ANATOMY["bridge"]
        report = load_report()
        report.skipped["left_hip"] = "bearing weight through the floor"
        result = reconcile(entry, report)
        lines = " ".join(line for _, line in result.describe())
        assert "did not" not in lines
        assert "bearing weight" in lines

    def test_the_reason_for_silence_is_carried_through(self):
        entry = DEFAULT_ANATOMY["bridge"]
        report = load_report()
        report.skipped["left_hip"] = "bearing weight through the floor"
        assert "bearing weight" in result_reason(reconcile(entry, report))

    def test_trunk_muscles_are_reference_only_not_missing(self):
        """No gravitational moment at a limb joint can speak to transversus
        abdominis. That is a boundary of the measurement, not a finding."""
        entry = DEFAULT_ANATOMY["the_hundred"]
        result = reconcile(entry, load_report(hip_flexion=44.0))
        assert "rectus abdominis" in result.beyond_measurement
        assert "rectus abdominis" not in result.silent

    def test_without_a_load_report_nothing_is_claimed_as_measured(self):
        result = reconcile(DEFAULT_ANATOMY["the_hundred"])
        assert result.confirmed == {} and result.unexpected == {}
        assert all(provenance == REFERENCE or "no load" in line
                   for provenance, line in result.describe())

    def test_every_line_carries_its_provenance(self):
        result = reconcile(DEFAULT_ANATOMY["the_hundred"], load_report(hip_flexion=44.0))
        assert all(p in (MEASURED, REFERENCE, RESEARCH) for p, _ in result.describe())

    def test_measured_and_reference_lines_are_distinguishable(self):
        result = reconcile(DEFAULT_ANATOMY["the_hundred"], load_report(hip_flexion=44.0))
        kinds = {p for p, _ in result.describe()}
        assert kinds == {MEASURED, REFERENCE}


def result_reason(reconciliation):
    return " ".join(reconciliation.silent.values())


class TestMeasurableBoundary:
    def test_only_limb_joints_are_measurable(self):
        assert measurable_groups() == {
            "knee extensors", "knee flexors", "hip extensors", "hip flexors",
            "elbow flexors", "elbow extensors", "shoulder flexors",
            "shoulder extensors",
        }

    def test_a_muscle_can_belong_to_two_groups(self):
        """Rectus femoris crosses both the hip and the knee, which is why it
        shows up in an exercise that only meant to work one of them."""
        assert groups_for("rectus femoris") == ["hip flexors", "knee extensors"]

    def test_a_trunk_muscle_belongs_to_none(self):
        assert groups_for("transversus abdominis") == []


class TestResearchNotes:
    """Population-level findings. Not about the student in front of you."""

    def test_they_ship_unsourced_on_purpose(self):
        library = AnatomyLibrary.default()
        assert library.research["slow_breathing"]
        assert library.sourced_research("slow_breathing") == []

    def test_an_unsourced_note_says_so_loudly(self):
        assert "SOURCE NEEDED" in ResearchNote("x").describe()

    def test_a_sourced_one_carries_the_citation(self):
        note = ResearchNote("x", citation="Smith 2020")
        assert note.sourced and "Smith 2020" in note.describe()

    def test_the_population_is_part_of_the_claim(self):
        note = ResearchNote("x", population="older adults", citation="c")
        assert "older adults" in note.describe()

    def test_sourced_research_filters_rather_than_flags(self):
        library = AnatomyLibrary.default()
        library.research["x"] = [ResearchNote("a"), ResearchNote("b", citation="c")]
        assert [n.claim for n in library.sourced_research("x")] == ["b"]


class TestLibraryImport:
    """A studio with its own exercise-to-anatomy reference should not have to
    re-enter it here."""

    def test_a_round_trip_keeps_everything(self, tmp_path):
        path = tmp_path / "a.json"
        AnatomyLibrary.default().save(path)
        loaded = AnatomyLibrary.load(path)
        assert len(loaded.entries) == len(DEFAULT_ANATOMY)
        assert loaded.get("bridge").prime_movers == \
            DEFAULT_ANATOMY["bridge"].prime_movers

    def test_research_notes_survive_it(self, tmp_path):
        path = tmp_path / "a.json"
        library = AnatomyLibrary.default()
        library.research["x"] = [ResearchNote("claim", "adults", "Smith 2020")]
        library.save(path)
        assert AnatomyLibrary.load(path).research["x"][0].citation == "Smith 2020"

    def test_an_imported_muscle_with_no_nerve_supply_is_reported(self, tmp_path):
        """The honest outcome for imported data: named, not invented."""
        path = tmp_path / "a.json"
        path.write_text(json.dumps({"exercises": [{
            "exercise": "mystery", "prime_movers": ["popliteus"],
        }]}))
        assert AnatomyLibrary.load(path).unknown_muscles() == ["popliteus"]

    def test_an_unknown_exercise_returns_nothing(self):
        assert AnatomyLibrary.default().get("moon_salutation") is None

    def test_an_imported_entry_can_name_its_own_source(self, tmp_path):
        path = tmp_path / "a.json"
        path.write_text(json.dumps({"exercises": [{
            "exercise": "x", "source": "our own reference project",
        }]}))
        assert AnatomyLibrary.load(path).get("x").source == "our own reference project"


class TestBonesFollowJoints:
    """Hand-written bone lists drift out of step with the joints they belong
    to. This one said "shoulder" and listed only the spine."""

    def test_every_entry_names_the_bones_of_the_joints_it_claims(self):
        from pilates.anatomy import bones_for

        for name, entry in DEFAULT_ANATOMY.items():
            assert set(entry.bones) == set(bones_for(entry.joints)), name

    def test_bones_are_derived_when_not_given(self):
        from pilates.anatomy import bones_for

        assert bones_for(["knee", "hip"]) == ("femur", "tibia", "pelvis")

    def test_a_bone_shared_by_two_joints_appears_once(self):
        from pilates.anatomy import bones_for

        assert bones_for(["hip", "spine"]).count("pelvis") == 1

    def test_an_unknown_joint_contributes_nothing_rather_than_failing(self):
        from pilates.anatomy import bones_for

        assert bones_for(["wrist"]) == ()

    def test_bones_are_not_a_claim_about_bone_loading(self):
        """Bone stress needs joint reaction forces, which are refused. This is
        which bones the joint articulates, and the docstring has to say so."""
        from pilates.anatomy import AnatomyEntry

        assert "not" in AnatomyEntry.__doc__ and "bone loading" in AnatomyEntry.__doc__


class TestImportedBones:
    """A curated library names the joints and usually not the bones. Listing
    none is worse than listing the ones those joints articulate."""

    def test_bones_are_derived_for_an_imported_entry(self):
        entry = AnatomyEntry.from_dict({"exercise": "x", "joints": ["knee"]})
        assert entry.bones == ("femur", "tibia")

    def test_explicit_bones_are_kept_as_given(self):
        entry = AnatomyEntry.from_dict(
            {"exercise": "x", "joints": ["knee"], "bones": ["patella"]})
        assert entry.bones == ("patella",)

    def test_no_joints_means_no_bones_rather_than_a_guess(self):
        assert AnatomyEntry.from_dict({"exercise": "x"}).bones == ()
