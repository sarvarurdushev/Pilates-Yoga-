"""What is wrong, and what to do about it.

Two kinds of test here and they are worth telling apart.

The first kind checks **direction**, and it is the only part of this system
where being wrong is worse than being silent: telling somebody to strengthen
the left side for six weeks when it is the right one that needs it is an active
harm, and every step from a signed number to a sentence naming a side is a
place it can flip. Those tests are written from the fixture's own convention --
a positive tilt raises the person's left -- and traced all the way to the
English.

The second kind checks **drift**: that a suggestion still names an exercise the
application can open, that a refusal added to the measurement layer cannot
reach a Korean report in English, that every direction the code can produce has
advice written for it. None of those can be caught by reading the diff.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from pilates import alignment as al  # noqa: E402
from pilates import guidance as gd  # noqa: E402
from pilates import intake as ik  # noqa: E402
from pilates.alignment import View  # noqa: E402
from test_alignment import standing  # noqa: E402
from test_intake import four, photo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ALIGNMENT = ROOT / "pilates" / "alignment.py"


def report_for(**kw) -> dict:
    return gd.report(ik.assess_photos(four(**kw)))


class TestDirection:
    """The signed number to the named side. Every step, both ways."""

    @pytest.mark.parametrize("tilt,expected", [
        (9.0, "left_shoulder_high"), (-9.0, "right_shoulder_high")])
    def test_a_raised_shoulder_is_named_on_the_side_it_is_raised(self, tilt, expected):
        out = ik.assess_photos(four(shoulder_tilt=tilt))
        assert gd.direction(out.readings["shoulder_tilt"]) == expected

    @pytest.mark.parametrize("tilt,word", [(9.0, "Left"), (-9.0, "Right")])
    def test_the_sentence_names_the_same_side_as_the_number(self, tilt, word):
        found = gd.findings(ik.assess_photos(four(shoulder_tilt=tilt)))
        shoulder = next(f for f in found if f.name == "shoulder_tilt")
        assert shoulder.title().startswith(f"{word} shoulder")

    @pytest.mark.parametrize("tilt,word", [(9.0, "왼쪽"), (-9.0, "오른쪽")])
    def test_the_korean_names_the_same_side_as_the_english(self, tilt, word):
        found = gd.findings(ik.assess_photos(four(shoulder_tilt=tilt)))
        shoulder = next(f for f in found if f.name == "shoulder_tilt")
        assert shoulder.title("ko").startswith(word)

    @pytest.mark.parametrize("tilt,expected", [
        (9.0, "left_hip_high"), (-9.0, "right_hip_high")])
    def test_a_raised_hip_is_named_on_the_side_it_is_raised(self, tilt, expected):
        out = ik.assess_photos(four(hip_tilt=tilt))
        assert gd.direction(out.readings["pelvic_obliquity"]) == expected

    def test_a_high_left_ear_is_a_head_tilted_right(self):
        """Side-bending to the right drops the right ear and lifts the left, so
        left-ear-high is a head leaning right. The easiest thing here to get
        backwards, and the reason it is written down."""
        det = standing(cx=540)
        points = det.keypoints.copy()
        points[al.kp.L_EAR][1] -= 12          # the person's left ear, higher
        raised = al.Detection(points, det.scores)
        out = ik.assess_photos([photo(View.FRONT, raised)])
        assert out.readings["head_lateral_tilt"].value > 0
        assert gd.direction(out.readings["head_lateral_tilt"]) == "head_tilted_right"

    def test_an_ear_ahead_of_the_shoulder_is_a_head_carried_forward(self):
        out = ik.assess_photos(four(ear_ahead=44.0))
        assert gd.direction(out.readings["forward_head"]) == "head_ahead_of_shoulders"

    def test_the_body_photographed_from_behind_does_not_mirror_the_advice(self):
        """The whole reason the landmark labels are anatomical."""
        front = ik.assess_photos([photo(View.FRONT,
                                        standing(shoulder_tilt=9.0, cx=540))])
        rear = ik.assess_photos([photo(View.REAR,
                                       standing(facing="rear",
                                                shoulder_tilt=9.0, cx=540))])
        assert (gd.direction(front.readings["shoulder_tilt"])
                == gd.direction(rear.readings["shoulder_tilt"]))


class TestSeverity:
    def test_inside_the_band_is_not_a_finding(self):
        assert gd.findings(ik.assess_photos(four())) == []

    def test_a_metric_with_no_band_is_never_a_finding(self):
        """Torso rotation index has no value that is by itself remarkable."""
        out = ik.assess_photos(four())
        assert gd.severity(out.readings["torso_rotation_index"]) is gd.WITHIN
        assert "torso_rotation_index" not in [f.name for f in
                                              gd.findings(out)]

    @pytest.mark.parametrize("tilt,grade", [
        (3.5, gd.WATCH), (7.0, gd.NOTABLE), (14.0, gd.MARKED)])
    def test_the_further_out_the_heavier_the_grade(self, tilt, grade):
        out = ik.assess_photos(four(shoulder_tilt=tilt / 2))
        assert gd.severity(out.readings["shoulder_tilt"]) == grade

    def test_findings_come_back_worst_first(self):
        found = gd.findings(ik.assess_photos(four(shoulder_tilt=14.0,
                                                  hip_tilt=2.0)))
        assert [f.name for f in found][0] == "shoulder_tilt"

    def test_a_ratio_is_graded_on_its_own_scale_not_on_the_degree_one(self):
        out = ik.assess_photos(four(ear_ahead=60.0))
        assert gd.severity(out.readings["forward_head"]) in (gd.NOTABLE,
                                                             gd.MARKED)


class TestTheScoreBand:
    @pytest.mark.parametrize("value,expected", [
        (95.0, "Excellent"), (85.0, "Good"), (70.0, "Fair"),
        (50.0, "Needs attention"), (10.0, "Needs work")])
    def test_each_band_covers_the_range_it_says(self, value, expected):
        assert gd.band(value)[0] == expected

    def test_no_score_is_not_a_band(self):
        assert gd.band(None)[0] == "Not scored"

    def test_a_marked_finding_caps_the_band_below_the_average(self):
        """One shoulder far off level is not an 'Excellent' body however level
        everything else is."""
        assert gd.band(95.0, gd.MARKED)[0] == "Fair"
        assert gd.band_capped(95.0, gd.MARKED)

    def test_the_cap_can_only_move_the_band_downward(self):
        assert gd.band(30.0, gd.MARKED)[0] == "Needs work"

    def test_the_report_says_when_the_band_was_capped(self):
        out = report_for(shoulder_tilt=14.0)
        assert out["score"]["band_capped"]
        assert out["score"]["band_cap_reason"]
        assert out["score"]["band_cap_reason_ko"]

    def test_every_band_is_named_in_both_languages(self):
        for _, english, korean in gd.SCORE_BANDS:
            assert english and korean


class TestTheAdviceTable:
    def test_every_direction_the_code_can_produce_has_advice(self):
        for pair in gd.DIRECTIONS.values():
            for way in pair:
                assert way in gd.ADVICE, way

    def test_every_advice_entry_is_written_in_both_languages(self):
        for way, advice in gd.ADVICE.items():
            assert advice.title and advice.title_ko, way
            assert advice.means and advice.means_ko, way
            for english, korean in advice.habits:
                assert english and korean, way

    def test_every_suggested_exercise_exists_in_the_application(self):
        """A recommendation naming an exercise the library does not have is a
        dead link in the one place a coach will click."""
        known = gd.repertoire()
        assert len(known) > 100, "the repertoire did not load"
        for way, advice in gd.ADVICE.items():
            for suggestion in advice.exercises:
                assert suggestion.key in known, f"{way} -> {suggestion.key}"

    def test_every_suggestion_says_which_discipline_it_is_from(self):
        for advice in gd.ADVICE.values():
            for suggestion in advice.exercises:
                assert suggestion.discipline in ("pilates", "yoga")

    def test_every_suggestion_says_why(self):
        for advice in gd.ADVICE.values():
            for suggestion in advice.exercises:
                assert len(suggestion.why) > 20 and suggestion.why_ko

    def test_the_two_sides_of_a_mirrored_entry_are_not_the_same_text(self):
        assert (gd.ADVICE["left_shoulder_high"].title
                != gd.ADVICE["right_shoulder_high"].title)
        assert (gd.ADVICE["left_shoulder_high"].title_ko
                != gd.ADVICE["right_shoulder_high"].title_ko)

    def test_no_advice_names_a_condition(self):
        """Positional words only. This system does not diagnose."""
        forbidden = ("scoliosis", "kyphosis", "lordosis", "syndrome",
                     "disorder", "diagnos", "disease", "patholog")
        for way, advice in gd.ADVICE.items():
            blob = " ".join([advice.title, advice.means, advice.usually,
                             advice.caution]).lower()
            for word in forbidden:
                assert word not in blob, f"{way} says {word!r}"

    def test_every_direction_has_a_short_label_in_both_languages(self):
        for pair in gd.DIRECTIONS.values():
            for way in pair:
                english, korean = gd.SHORT[way]
                assert english and korean, way


class TestTranslationCannotDrift:
    def test_every_fixed_refusal_in_the_measurement_layer_has_korean(self):
        """A refusal added upstream reaches a Korean studio in English unless
        something fails. This is that something."""
        source = ALIGNMENT.read_text(encoding="utf-8")
        literals = re.findall(
            r'_unavailable\(\s*[^,]+,\s*"[a-z]+",\s*("(?:[^"\\]|\\.)*"'
            r'(?:\s*"(?:[^"\\]|\\.)*")*)\s*\)', source)
        found = set()
        for literal in literals:
            text = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', literal))
            if "{" in text:          # built per call; documented as English
                continue
            found.add(text)
        assert len(found) >= 15, f"the scan found only {len(found)} refusals"
        missing = sorted(f for f in found if f not in gd.REASON_KO)
        assert not missing, f"no Korean for: {missing}"

    def test_every_metric_the_layer_can_produce_has_a_name(self):
        for names in al.VIEW_METRICS.values():
            for name in names:
                assert name in gd.METRIC_NAME, name
        assert "sagittal_pelvic_tilt" in gd.METRIC_NAME

    def test_a_reason_with_no_korean_falls_back_rather_than_blanking(self):
        assert gd.reason_text("something new", "ko") == "something new"


class TestTheProgramme:
    def test_every_finding_gets_an_exercise_before_any_gets_a_second(self):
        """Depth-first fills the session from the worst finding and never
        reaches the third."""
        out = report_for(shoulder_tilt=14.0, hip_tilt=10.0, ear_ahead=60.0)
        assert len(out["findings"]) >= 3
        covered = {name for entry in out["programme"][:3]
                   for name in entry["for"]}
        assert len(covered) >= 3

    def test_an_exercise_suggested_twice_is_one_entry_with_two_reasons(self):
        out = report_for(shoulder_tilt=14.0, hip_tilt=10.0)
        keys = [entry["key"] for entry in out["programme"]]
        assert len(keys) == len(set(keys))

    def test_the_programme_carries_names_not_only_keys(self):
        out = report_for(shoulder_tilt=14.0)
        first = out["programme"][0]
        assert first["name"] and first["name"] != first["key"]
        assert first["name_ko"]

    def test_priorities_take_one_finding_per_region_first(self):
        out = report_for(shoulder_tilt=14.0, hip_tilt=10.0, ear_ahead=60.0)
        assert len(set(out["priorities"])) == len(out["priorities"])

    def test_habits_are_de_duplicated(self):
        out = report_for(shoulder_tilt=14.0, hip_tilt=10.0)
        texts = [habit["en"] for habit in out["habits"]]
        assert len(texts) == len(set(texts))


class TestTheReport:
    def test_it_carries_the_disclaimer_in_both_languages(self):
        out = report_for()
        assert "not a medical assessment" in out["disclaimer"]
        assert "의학적 진단이 아니며" in out["disclaimer_ko"]

    def test_it_carries_what_could_not_be_measured(self):
        out = report_for()
        assert "sagittal_pelvic_tilt" in out["refused"]
        assert any(e["reason_ko"] for e in out["refused_detail"])

    def test_it_names_the_photographs_that_were_not_supplied(self):
        out = gd.report(ik.assess_photos(four()[:1]))
        missing = {slot["view"] for slot in out["missing_photos"]}
        assert missing == {"side_left", "side_right", "rear"}
        assert all(slot["how_ko"] for slot in out["missing_photos"])

    def test_a_body_inside_every_band_says_so_rather_than_finding_something(self):
        out = report_for()
        assert out["findings"] == []
        assert out["unremarkable"]

    def test_every_finding_carries_both_languages_end_to_end(self):
        out = report_for(shoulder_tilt=14.0, ear_ahead=60.0)
        for finding in out["findings"]:
            for key in ("title", "title_ko", "means", "means_ko",
                        "measurement", "measurement_ko", "evidence",
                        "evidence_ko", "short", "short_ko"):
                assert finding[key], (finding["metric"], key)


@pytest.mark.parametrize("name,value,unit,expected", [
    ("shoulder_tilt", 12.0, "deg", "+12.0°"),
    ("forward_head", 0.217, "ratio", "+22%"),
    ("left_knee_deviation", -0.008, "ratio", "-1%"),
    ("torso_rotation_index", 1.6, "ratio", "1.60×"),
    ("shoulder_tilt", None, "deg", "—"),
])
def test_a_measurement_is_formatted_once_for_every_reader(name, value, unit,
                                                          expected):
    assert gd.format_value(name, value, unit) == expected
