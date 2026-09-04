"""Importing a curated exercise library.

The fixture is a slice of the real Neuro Wellness export, taken verbatim, so
these tests fail if the schema drifts rather than passing against a hand-made
approximation of it.
"""
from pathlib import Path

import pytest

from pilates.anatomy import EMG, INFERRED
from pilates.neurowellness import (
    ACTION_JOINT, ALIASES, APPARATUS_EQUIPMENT, ImportReport, load_export,
    normalise, nerve_table,
)

SAMPLE = Path(__file__).parent / "data" / "neuro_wellness_sample.json"


@pytest.fixture(scope="module")
def imported():
    return load_export(SAMPLE)


class TestNames:
    """"Warrior II" and "warrior_two" have to meet somewhere."""

    def test_roman_numerals_become_words(self):
        assert normalise("Warrior II") == "warrior_two"
        assert normalise("Warrior III") == "warrior_three"

    def test_camel_case_keys_split_into_words(self):
        assert normalise("oneLegCircle") == "one_leg_circle"

    def test_pose_is_dropped_because_only_one_side_says_it(self):
        assert normalise("Tree Pose") == "tree"

    def test_a_possessive_is_stripped_rather_than_left_as_a_word(self):
        """Otherwise "Child's Pose" normalises to "child_s_pose" and matches
        nothing. It still needs the alias to reach "childs_pose"."""
        assert normalise("Child’s Pose") == "child"
        assert ALIASES["childs_pose"] == "balasana"

    def test_hyphens_and_ampersands_are_flattened(self):
        assert normalise("Downward-Facing Dog") == "downward_dog"

    def test_the_two_vocabularies_meet(self):
        assert normalise("Bridge Pose") == normalise("bridge")


class TestMatching:
    def test_wanted_names_are_matched_by_normalised_name(self):
        library, _ = load_export(SAMPLE, wanted=["tree", "plank"])
        assert library.get("tree") is not None
        assert library.get("plank") is not None

    def test_an_alias_bridges_what_normalisation_cannot(self):
        library, _ = load_export(SAMPLE, wanted=["the_hundred"])
        assert ALIASES["the_hundred"] == "hundredPrep"
        assert library.get("the_hundred") is not None

    def test_an_unmatched_name_is_reported_not_approximated(self):
        """Mapping "standing side bend" onto a side-lying "Side Bend" would
        attach a real muscle list to the wrong movement."""
        library, report = load_export(SAMPLE, wanted=["standing_side_bend"])
        assert library.get("standing_side_bend") is None
        assert report.unmatched == ["standing_side_bend"]

    def test_the_report_says_what_happens_to_the_unmatched(self):
        _, report = load_export(SAMPLE, wanted=["standing_side_bend"])
        assert "rather than being matched to something close" in report.describe()

    def test_without_a_wanted_list_everything_comes_across(self, imported):
        library, report = imported
        assert report.entries == len(library.entries) > 10


class TestMuscleProvenance:
    """Their library marks every role emg or inferred, per muscle. That
    distinction is the reason to import it rather than rewrite it."""

    def test_a_measured_role_is_kept_as_measured(self):
        library, _ = load_export(SAMPLE, wanted=["the_hundred"])
        entry = library.get("the_hundred")
        assert entry.support("rectus abdominis") == EMG

    def test_an_inferred_role_is_kept_as_inferred(self):
        library, _ = load_export(SAMPLE, wanted=["the_hundred"])
        assert library.get("the_hundred").support("transversus abdominis") == INFERRED

    def test_an_unlisted_muscle_defaults_to_inferred_not_measured(self):
        library, _ = load_export(SAMPLE, wanted=["the_hundred"])
        assert library.get("the_hundred").support("popliteus") == INFERRED

    def test_a_muscle_in_two_roles_keeps_the_stronger_claim(self):
        """Measured once is measured; downgrading it because it also appears as
        a stabiliser would lose the study."""
        from pilates.neurowellness import _muscle_roles

        _, evidence = _muscle_roles({"muscles": {
            "prime": [["rectus abdominis", "emg"]],
            "stabilisers": [["rectus abdominis", "inferred"]],
        }})
        assert evidence["rectus abdominis"] == EMG

    def test_measured_roles_can_be_listed(self):
        library, _ = load_export(SAMPLE, wanted=["the_hundred"])
        assert "rectus abdominis" in library.get("the_hundred").measured_roles


class TestApparatus:
    """32 of their 190 exercises are on apparatus, where a gravity-only load
    estimate is not true. Importing the field wires that in automatically."""

    def test_apparatus_exercises_are_reported(self, imported):
        _, report = imported
        assert report.on_apparatus

    def test_the_note_says_the_load_is_not_valid(self, imported):
        library, _ = imported
        entry = library.get("reformerHundred")
        assert "not valid" in entry.note and "reformer" in entry.note

    def test_a_mat_exercise_carries_no_such_note(self, imported):
        library, _ = imported
        assert "not valid" not in library.get("balasana").note

    def test_every_listed_apparatus_maps_to_the_equipment_vocabulary(self):
        from pilates.interaction import EQUIPMENT_EFFECT

        for name in APPARATUS_EQUIPMENT.values():
            assert name in EQUIPMENT_EFFECT or name == "barrel"


class TestJointsAndBones:
    def test_joints_come_from_the_action_vocabulary(self, imported):
        library, _ = imported
        assert "spine" in library.get("hundredPrep").joints

    def test_bones_follow_those_joints(self, imported):
        from pilates.anatomy import bones_for

        library, _ = imported
        entry = library.get("hundredPrep")
        assert set(entry.bones) == set(bones_for(entry.joints))

    def test_an_unmapped_action_contributes_no_joint(self):
        """Otherwise a new action in the source silently invents a joint."""
        from pilates.neurowellness import _entry_from

        entry = _entry_from({"actions": ["levitation"], "muscles": {}}, "x")
        assert entry.joints == ()

    def test_the_action_map_only_names_measurable_joints(self):
        from pilates.anatomy import JOINT_BONES

        assert set(ACTION_JOINT.values()) <= set(JOINT_BONES)


class TestNerves:
    """Their innervation table is sourced to Gray's Anatomy, and it corrected
    entries here that had been written from memory."""

    def test_the_imported_table_is_used_for_lookup(self, imported):
        library, _ = imported
        entry = library.get("hundredPrep")
        assert entry.nerves(library.nerves)

    def test_roots_come_across_in_full_not_as_endpoints(self, imported):
        library, _ = imported
        supply = library.nerves["rectus abdominis"]
        assert "T9" in supply.roots            # not just T7 and T12

    def test_a_segmental_supply_covers_its_whole_span(self, imported):
        """Representative levels read literally assert that the gaps are
        uninvolved, which is the opposite of what segmental means."""
        library, _ = imported
        supply = library.nerves.get("multifidus")
        if supply is not None and supply.segmental:
            assert len(supply.levels()) > len(supply.roots)

    def test_a_missing_nerve_is_reported_not_invented(self, imported):
        _, report = imported
        assert isinstance(report.without_nerves, list)

    def test_the_table_survives_a_record_with_no_roots(self):
        table = nerve_table({"x": {"nerves": "femoral nerve (L2-L4)"}})
        assert table["x"].roots == ("L2", "L3", "L4")


class TestResearch:
    """Every brain claim carries a tier, a citation, a population and a caveat.
    That is stricter than this module shipped with."""

    def test_claims_come_across_with_their_citation(self, imported):
        library, _ = imported
        note = library.research["apa_timing"][0]
        assert note.sourced and note.tier

    def test_the_caveat_is_carried_and_shown(self, imported):
        library, _ = imported
        note = library.research["apa_timing"][0]
        assert note.caveat
        assert "Caveat" in note.describe()

    def test_the_tier_is_shown_with_the_citation(self, imported):
        library, _ = imported
        assert "tier " in library.research["apa_timing"][0].describe()

    def test_animal_only_findings_are_flagged(self, imported):
        library, _ = imported
        for notes in library.research.values():
            for note in notes:
                assert note.animal_only == (note.species == "animal"
                                            or note.tier == "D")

    def test_an_exercise_points_at_its_claims(self, imported):
        library, _ = imported
        assert "apa_timing" in library.get("hundredPrep").research_keys


class TestActivation:
    def test_expected_activation_comes_across(self, imported):
        library, _ = imported
        assert library.get("hundredPrep").expected_activation["rectus abdominis"] > 0

    def test_it_is_named_so_it_cannot_be_read_as_a_measurement(self):
        """This system cannot see muscle activation. The field name is the only
        thing standing between a reference expectation and a false claim."""
        from pilates.anatomy import AnatomyEntry

        assert hasattr(AnatomyEntry, "__dataclass_fields__")
        assert "expected_activation" in AnatomyEntry.__dataclass_fields__
        assert "activation" not in AnatomyEntry.__dataclass_fields__


class TestRoundTrip:
    def test_an_imported_library_saves_and_reloads(self, tmp_path, imported):
        from pilates.anatomy import AnatomyLibrary

        library, _ = imported
        path = tmp_path / "a.json"
        library.save(path)
        again = AnatomyLibrary.load(path)
        assert len(again.entries) == len(library.entries)
        assert again.get("hundredPrep").support("rectus abdominis") == EMG

    def test_the_nerve_table_survives_the_round_trip(self, tmp_path, imported):
        from pilates.anatomy import AnatomyLibrary

        library, _ = imported
        path = tmp_path / "a.json"
        library.save(path)
        assert AnatomyLibrary.load(path).nerves["rectus abdominis"].roots \
            == library.nerves["rectus abdominis"].roots

    def test_contraindications_survive_it(self, tmp_path, imported):
        from pilates.anatomy import AnatomyLibrary

        library, _ = imported
        path = tmp_path / "a.json"
        library.save(path)
        assert AnatomyLibrary.load(path).get("hundredPrep").contraindications
