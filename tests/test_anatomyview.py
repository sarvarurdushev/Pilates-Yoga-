"""A body with one person's session on it, drawn flat.

The 2D half of the anatomy bridge. What matters here is not that it is pretty
but that a reader can always tell a measurement from a lookup -- which means
the tests are mostly about what the page refuses to draw.
"""
import re

import pytest

from pilates.activation import plan
from pilates.anatomyview import (BONE_SEGMENTS, PLACEMENTS, VIEWBOX, _band_ends,
                                 _opacity, figure, groups, legend, render)
from pilates.biomechanics import MUSCLE_GROUPS
from pilates.bridge import MEASURED, REFERENCE
from pilates.dashboard import _ANCHORS
from pilates.wording import BOTH, PLAIN, TECHNICAL


def measured(name, value, group="hip flexors", fma="FMA1"):
    return {"fma": fma, "name": name, "layer": "muscles_deep", "tier": MEASURED,
            "because": f"the {group} carried {value:.0f} Nm",
            "plain": f"that bit worked up to {value:.0f} newton metres",
            "value": value, "unit": "Nm", "from": f"{group} peak moment"}


def reference(name, fma=""):
    return {"fma": fma, "name": name, "layer": "nervous", "tier": REFERENCE,
            "because": "supplies a muscle that was measured",
            "plain": "it feeds a muscle we measured", "from": "x"}


def bundle(structures, date="2026-03-03"):
    lit = plan(structures)
    for entry in structures:
        light = next(l for l in lit.lights if l.name == entry["name"])
        entry["level"] = light.level
    return {"format": "pilates-session-bundle", "version": 1,
            "person": {"username": "anna", "display_name": "Anna Smith"},
            "session": {"key": "s1", "date": date},
            "structures": structures, "lighting": lit.scheme(),
            "notice": "every value carries a tier"}


class TestThePlacements:
    def test_every_measurable_group_has_somewhere_to_be_drawn(self):
        """A group with no placement is measured and then not shown."""
        for group in MUSCLE_GROUPS.values():
            assert group.name in PLACEMENTS, group.name

    def test_two_groups_on_one_limb_never_overlap(self):
        """They are told apart by where they sit, so they must not share it."""
        by_segment: dict[tuple[str, str], list] = {}
        for name, place in PLACEMENTS.items():
            by_segment.setdefault((place.frm, place.to), []).append(place)
        for placements in by_segment.values():
            spans = sorted((p.start, p.end) for p in placements)
            for (_, end), (start, _) in zip(spans, spans[1:]):
                assert start > end

    def test_a_band_stays_inside_the_limb_it_is_drawn_on(self):
        for place in PLACEMENTS.values():
            assert 0.0 <= place.start < place.end <= 1.0

    def test_the_two_sides_are_mirror_images(self):
        """A group must not sit higher on one leg than the other."""
        for place in PLACEMENTS.values():
            _, lay, _, lby = _band_ends("left", place)
            _, ray, _, rby = _band_ends("right", place)
            assert lay == pytest.approx(ray)
            assert lby == pytest.approx(rby)

    def test_every_named_bone_segment_exists_on_the_figure(self):
        for bone, segments in BONE_SEGMENTS.items():
            for a, b in segments:
                assert a in _ANCHORS and b in _ANCHORS, bone


class TestTheFigure:
    def test_a_measured_group_is_filled_and_numbered(self):
        svg = figure(plan([measured("psoas major", 24.0)]),
                     {"measured_band": [0.7, 1.0], "reference_level": 0.3})
        assert "class='band'" in svg
        assert ">24</text>" in svg

    def test_the_number_appears_once_though_both_sides_are_drawn(self):
        """The peak is taken across both sides, so one figure, not two."""
        svg = figure(plan([measured("psoas major", 24.0)]),
                     {"measured_band": [0.7, 1.0], "reference_level": 0.3})
        assert svg.count(">24</text>") == 1
        assert svg.count("class='band'") == 2

    def test_a_reference_bone_is_hatched_and_never_numbered(self):
        structures = [measured("psoas major", 24.0),
                      {"fma": "FMA24474", "name": "femur", "layer": "skeleton",
                       "tier": REFERENCE, "because": "articulates the hip",
                       "plain": "it meets the hip", "from": "left_hip"}]
        svg = figure(plan(structures),
                     {"measured_band": [0.7, 1.0], "reference_level": 0.3})
        assert "class='refbone'" in svg
        numbers = re.findall(r"class='num'[^>]*>([^<]+)<", svg)
        assert numbers == ["24"]

    def test_only_the_bones_the_bundle_names_are_hatched(self):
        """An earlier version matched anchor names ending in a joint word and
        hatched almost the whole skeleton, including the neck."""
        svg = figure(plan([measured("psoas major", 24.0)]),
                     {"measured_band": [0.7, 1.0], "reference_level": 0.3})
        assert "class='refbone'" not in svg

    def test_a_dim_measurement_is_still_unmistakably_lit(self):
        """Straight opacity would render the smallest measurement invisible,
        and invisible here means 'not measured'."""
        assert _opacity(0.7, 0.7, 1.0) >= 0.4

    def test_the_box_is_cropped_to_the_figure(self):
        assert VIEWBOX == "0 8 200 312"


class TestTheGroupList:
    def test_a_group_lists_every_muscle_in_it(self):
        """Not just the ones whose largest effort happened to be this group.

        The hamstrings belong to both the hip extensors and the knee flexors.
        Listing only the winners left the knee flexors reading as "the back of
        the thigh: gastrocnemius".
        """
        structures = [measured("biceps femoris", 21.0, group="hip extensors"),
                      measured("gastrocnemius", 3.0, group="knee flexors")]
        html = groups(plan(structures))
        assert "semitendinosus" in html
        assert "gastrocnemius" in html

    def test_it_is_ordered_by_effort(self):
        structures = [measured("anconeus", 2.0, group="elbow extensors"),
                      measured("psoas major", 24.0, group="hip flexors")]
        html = groups(plan(structures))
        assert html.index("hip flexors") < html.index("elbow extensors")

    def test_nothing_measured_draws_nothing_rather_than_an_empty_frame(self):
        assert groups(plan([reference("sciatic nerve")])) == ""


class TestTheLegend:
    def test_it_has_three_states_and_only_one_carries_a_number(self):
        html = legend({"measured_band": [0.7, 1.0], "reference_level": 0.3,
                       "note": "not a percentage"})
        assert html.count("<li>") == 3
        assert html.count("has-num") == 1

    def test_unlit_is_explained_as_unmeasured_not_as_zero(self):
        html = legend({"note": ""})
        assert "zero effort" in html


class TestThePage:
    def test_a_reference_row_has_an_empty_number_cell_not_a_dash(self):
        """A dash reads as a measurement of zero."""
        page = render(bundle([measured("psoas major", 24.0),
                              reference("femoral nerve")]))
        row = re.search(r"<tr class='ref'.*?</tr>", page, re.S).group(0)
        assert "<td class='r num'></td>" in row
        assert "—" not in row.split("class='why'")[0]

    def test_a_reference_row_is_not_dated_either(self):
        page = render(bundle([reference("femoral nerve")], date="2026-03-03"))
        row = re.search(r"<tr class='ref'.*?</tr>", page, re.S).group(0)
        assert "2026-03-03" not in row

    def test_a_measured_row_carries_both_a_number_and_a_date(self):
        page = render(bundle([measured("psoas major", 24.0)],
                             date="2026-03-03"))
        row = re.search(r"<tr class='meas'.*?</tr>", page, re.S).group(0)
        assert "24.0" in row and "2026-03-03" in row

    def test_every_sentence_arrives_in_both_registers(self):
        page = render(bundle([measured("psoas major", 24.0),
                              reference("femoral nerve")]))
        assert page.count("class='pl'") >= 2
        assert page.count("class='tc'") >= 2

    def test_the_register_it_was_asked_for_is_the_one_it_opens_in(self):
        for register in (PLAIN, BOTH, TECHNICAL):
            page = render(bundle([measured("psoas major", 24.0)]),
                          register=register)
            assert f"data-register='{register}'" in page

    def test_an_unknown_register_is_refused_rather_than_defaulted(self):
        with pytest.raises(ValueError):
            render(bundle([measured("psoas major", 24.0)]), register="clinical")

    def test_the_notice_about_tiers_is_carried_onto_the_page(self):
        page = render(bundle([measured("psoas major", 24.0)]))
        assert "every value carries a tier" in page

    def test_a_bundle_with_nothing_measured_still_renders(self):
        page = render(bundle([reference("femoral nerve")]))
        assert "femoral nerve" in page

    def test_a_structure_with_no_fma_says_so_rather_than_showing_a_gap(self):
        """Those links break silently on a rename, and the page admits it."""
        page = render(bundle([reference("femoral nerve")]))
        assert "no FMA id" in page
