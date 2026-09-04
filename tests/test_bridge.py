"""Which 3D structure a measurement is about.

The tables are written out rather than derived, so every entry is a judgement
somebody can check — and `check` is what fails when either side renames a
structure, instead of a body quietly lighting up the wrong part.
"""
import json
from pathlib import Path

import pytest

from pilates.biomechanics import MUSCLE_GROUPS
from pilates.bridge import (BONE_MESH, MEASURED, MUSCLE_MESH, NERVE_MESH,
                            REFERENCE, Mesh, bones_for_joint, check,
                            mesh_for_muscle, meshes_for_group,
                            nerves_for_group)

SAMPLE = Path(__file__).parent / "data" / "neuro_wellness_sample.json"


class TestMuscleLinks:
    def test_every_measurable_group_member_resolves(self):
        """The claim the whole integration rests on."""
        for group in MUSCLE_GROUPS.values():
            for muscle in group.members:
                assert mesh_for_muscle(muscle) is not None, muscle

    def test_a_group_gives_its_meshes(self):
        names = [m.name for m in meshes_for_group("knee extensors")]
        assert "rectus femoris" in names and "vastus lateralis" in names

    def test_a_split_muscle_follows_the_synonym_table(self):
        """The model splits iliopsoas into its heads, which is the more precise
        anatomy; a gravitational moment cannot tell them apart."""
        assert mesh_for_muscle("iliopsoas").name == "psoas major"

    def test_one_mesh_is_not_listed_twice_for_a_group(self):
        """Deltoid is both shoulder groups' mesh because the model does not
        split its fibres."""
        meshes = meshes_for_group("shoulder extensors")
        assert len(meshes) == len({m.name for m in meshes})

    def test_an_unknown_muscle_resolves_to_nothing(self):
        assert mesh_for_muscle("popliteus") is None

    def test_an_unknown_group_gives_an_empty_list(self):
        assert meshes_for_group("gill muscles") == []

    def test_every_muscle_link_carries_an_ontology_id(self):
        """A name string either side might reword is not a contract."""
        for mesh in MUSCLE_MESH.values():
            assert mesh.keyed_by_ontology, mesh.name
            assert mesh.fma.startswith("FMA")


class TestBoneAndNerveLinks:
    def test_a_joint_gives_the_bones_it_articulates(self):
        assert {m.name for m in bones_for_joint("left_knee")} == {"femur", "tibia"}

    def test_both_sides_of_a_joint_give_the_same_bones(self):
        assert bones_for_joint("left_hip") == bones_for_joint("right_hip")

    def test_bones_carry_an_ontology_id_too(self):
        assert all(m.keyed_by_ontology for m in BONE_MESH.values())

    def test_nerves_do_not_and_the_table_says_so(self):
        """The source model carries no FMA id for any nerve, so these can only
        be matched by name."""
        assert all(not m.keyed_by_ontology for m in NERVE_MESH.values())

    def test_a_group_gives_the_nerves_supplying_it(self):
        assert "femoral nerve" in [m.name for m in nerves_for_group("knee extensors")]

    def test_an_unknown_group_supplies_no_nerves(self):
        assert nerves_for_group("gill muscles") == []


class TestCheck:
    """Worth more than the tables themselves."""

    def _structures(self, overrides=None):
        base = [{"name": m.name, "fma": [m.fma] if m.fma else []}
                for table in (MUSCLE_MESH, BONE_MESH, NERVE_MESH)
                for m in table.values()]
        if overrides:
            base = [overrides.get(s["name"], s) for s in base]
        return base

    def test_a_matching_model_passes(self):
        result = check(self._structures())
        assert result.ok and result.checked == 52

    def test_a_removed_mesh_is_caught(self):
        structures = [s for s in self._structures() if s["name"] != "sartorius"]
        result = check(structures)
        assert not result.ok and "sartorius" in result.missing

    def test_a_changed_ontology_id_is_caught(self):
        result = check(self._structures(
            {"femur": {"name": "femur", "fma": ["FMA99999"]}}))
        assert not result.ok and "femur" in result.renamed

    def test_name_only_links_are_reported_but_do_not_fail(self):
        """They are a real weakness, not a broken link."""
        result = check(self._structures())
        assert result.ok
        assert len(result.without_fma) == len(NERVE_MESH)
        assert "matched by name alone" in result.describe()

    def test_the_real_model_still_resolves(self):
        """Run against the committed slice of the real export, so a schema
        change on that side fails here."""
        payload = json.loads(SAMPLE.read_text())
        if "structures" not in payload:
            pytest.skip("the sample export carries no structure list")
        assert check(payload["structures"]).checked == 52

    def test_the_description_counts_what_broke(self):
        structures = [s for s in self._structures() if s["name"] != "femur"]
        assert "1 broken" in check(structures).describe()


class TestTiers:
    def test_the_two_tiers_are_named(self):
        assert MEASURED == "measured" and REFERENCE == "reference"

    def test_a_mesh_without_an_id_says_it_is_not_keyed_by_ontology(self):
        assert not Mesh("x").keyed_by_ontology
