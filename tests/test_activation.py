"""How brightly a structure lights, and what that brightness may not mean.

The level is the one number that crosses into a picture of somebody's body, so
these tests are mostly about what it must never imply: a per-muscle activation,
a percentage of maximum, or an amount for a structure that was only looked up.
"""
import pytest

from pilates.activation import (MEASURED_CEILING, MEASURED_FLOOR,
                                REFERENCE_LEVEL, TIER_GAP, UNLIT, Light,
                                group_of, level_for, plan)
from pilates.bridge import MEASURED, REFERENCE


def measured(name, value, source="hip flexors peak moment", fma="FMA1"):
    return {"fma": fma, "name": name, "layer": "muscles_deep", "tier": MEASURED,
            "because": f"the {group_of(source)} carried {value} Nm",
            "plain": "it worked this hard", "value": value, "unit": "Nm",
            "from": source}


def reference(name, fma=""):
    return {"fma": fma, "name": name, "layer": "nervous", "tier": REFERENCE,
            "because": "supplies a muscle that was measured",
            "plain": "it feeds a muscle we measured", "from": "x"}


class TestTheBands:
    def test_the_gap_between_tiers_is_wider_than_the_measured_band(self):
        """The tier has to be legible before the amount is.

        If the dimmest measured structure sat close to a reference one, a
        reader would have to know the scheme to tell a measurement from a
        lookup -- which is the whole thing this arrangement exists to prevent.
        """
        assert TIER_GAP > MEASURED_CEILING - MEASURED_FLOOR

    def test_reference_sits_below_every_measured_level(self):
        assert REFERENCE_LEVEL < MEASURED_FLOOR
        assert UNLIT < REFERENCE_LEVEL

    def test_the_smallest_measurement_still_lands_in_the_measured_band(self):
        assert level_for(0.0, 100.0) == MEASURED_FLOOR
        assert level_for(0.01, 100.0) >= MEASURED_FLOOR

    def test_the_largest_measurement_tops_the_band(self):
        assert level_for(44.0, 44.0) == MEASURED_CEILING

    def test_a_top_of_zero_does_not_divide_by_it(self):
        """Everything at rest is everything equally small, not an error."""
        assert level_for(0.0, 0.0) == MEASURED_FLOOR

    def test_a_value_above_the_top_is_clamped_rather_than_overflowing(self):
        assert level_for(120.0, 44.0) == MEASURED_CEILING


class TestWhatTheLevelMeans:
    def test_it_is_a_share_of_this_session_and_says_so(self):
        result = plan([measured("psoas major", 44.0),
                       measured("anconeus", 4.4,
                                source="elbow extensors peak moment")])
        by_name = {l.name: l for l in result.lights}
        assert by_name["anconeus"].share == pytest.approx(0.1)
        assert by_name["psoas major"].share == 1.0
        assert result.top_value == 44.0
        assert result.top_source == "hip flexors peak moment"

    def test_every_muscle_in_a_group_shares_one_level(self):
        """A joint moment is not attributable to the muscles that cross it.

        Ranking them would be inventing the ranking, so the level comes from
        the group's value and the members are indistinguishable by design.
        """
        result = plan([measured("psoas major", 44.0),
                       measured("sartorius", 44.0),
                       measured("tensor fasciae latae", 44.0)])
        assert len({l.level for l in result.lights}) == 1

    def test_reference_is_flat_whatever_it_is_connected_to(self):
        """A gradient here would be an amount that nothing measured."""
        result = plan([measured("psoas major", 44.0),
                       measured("anconeus", 2.0,
                                source="elbow extensors peak moment"),
                       reference("femoral nerve"), reference("radial nerve")])
        assert {l.level for l in result.reference} == {REFERENCE_LEVEL}

    def test_reference_carries_no_share_to_be_mistaken_for_one(self):
        result = plan([reference("femoral nerve")])
        assert result.reference[0].share is None

    def test_a_structure_marked_measured_with_no_value_falls_to_reference(self):
        """Rather than being lit at the floor, which would print as measured."""
        broken = {**measured("psoas major", 1.0)}
        broken["value"] = None
        result = plan([broken])
        assert result.lights[0].tier == REFERENCE


class TestWhatMayBePrinted:
    def test_only_a_measurement_may_carry_a_number(self):
        result = plan([measured("psoas major", 44.0), reference("femoral nerve")])
        carries = {l.name: l.carries_a_number for l in result.lights}
        assert carries == {"psoas major": True, "femoral nerve": False}

    def test_the_scheme_a_viewer_draws_its_legend_from_names_the_scale(self):
        result = plan([measured("psoas major", 44.0)])
        scheme = result.scheme()
        assert scheme["measured_band"] == [MEASURED_FLOOR, MEASURED_CEILING]
        assert scheme["reference_level"] == REFERENCE_LEVEL
        assert scheme["scale"]["value"] == 44.0
        assert scheme["scale"]["unit"] == "Nm"

    def test_the_note_refuses_the_readings_it_could_be_mistaken_for(self):
        note = plan([measured("psoas major", 44.0)]).scheme()["note"].lower()
        assert "not an activation percentage" in note
        assert "emg" in note

    def test_nothing_measured_means_no_scale_rather_than_a_made_up_one(self):
        result = plan([reference("femoral nerve")])
        assert "scale" not in result.scheme()

    def test_both_registers_survive_the_plan(self):
        result = plan([measured("psoas major", 44.0)])
        assert result.lights[0].plain == "it worked this hard"
        assert result.lights[0].because.startswith("the hip flexors")


class TestNames:
    def test_a_group_is_recovered_from_its_measurement_name(self):
        assert group_of("hip flexors peak moment") == "hip flexors"

    def test_a_name_that_is_not_a_peak_moment_is_left_alone(self):
        assert group_of("left_knee") == "left_knee"


def test_a_light_with_no_value_never_claims_to_carry_a_number():
    light = Light(fma="", name="sciatic nerve", layer="nervous",
                  tier=MEASURED, level=1.0, because="", plain="")
    assert not light.carries_a_number
