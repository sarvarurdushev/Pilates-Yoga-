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
from test_alignment import side_on, standing  # noqa: E402
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
        named = [entry["metric"] for entry in out["priorities"]]
        assert len(set(named)) == len(named)

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


def chained(ear=0.0, shoulder=0.0, hip=0.0, knee=0.0) -> ik.PhotoAssessment:
    """A body seen from its left, with each link pushed forward or back.

    ``side_on`` faces image right here, so a positive offset is forward. The
    near ear is the left one; moving the right one moves a landmark the model
    could not see anyway.
    """
    det = side_on(facing_image_left=False, cx=300.0)
    points = det.keypoints.copy()
    for joint, amount in ((al.kp.L_EAR, ear),
                          (al.kp.L_SHOULDER, shoulder),
                          (al.kp.R_SHOULDER, shoulder),
                          (al.kp.L_HIP, hip), (al.kp.R_HIP, hip),
                          (al.kp.L_KNEE, knee), (al.kp.R_KNEE, knee)):
        points[joint] = (points[joint][0] + amount, points[joint][1])
    return ik.assess_photos([ik.Photo(View.SIDE_LEFT,
                                      al.Detection(points, det.scores),
                                      1080, 1440)])


class TestReadingTheChain:
    """The thing a list of measurements cannot say."""

    def test_a_head_forward_of_a_square_body_is_the_head(self):
        out = gd.pattern(chained(ear=60))
        assert "head forward" in out["shape"]
        assert "shoulders" not in out["shape"]
        assert "the head rather than the body underneath it" in out["start_at"]

    def test_a_head_forward_of_a_forward_body_is_the_body(self):
        """Same forward-head number, different finding. Only the chain shows
        the difference, which is the whole reason it is measured."""
        out = gd.pattern(chained(ear=60, shoulder=50, hip=45))
        assert "hips forward" in out["shape"]
        assert "start at the hips" in out["start_at"]

    def test_the_lowest_link_off_the_vertical_is_where_to_start(self):
        out = gd.pattern(chained(hip=45, knee=-40))
        assert "start at the knees" in out["start_at"]

    def test_a_square_chain_says_so_rather_than_inventing_a_shape(self):
        out = gd.pattern(chained())
        assert "sits over the vertical" in out["shape"]
        assert out["start_at"] == ""

    def test_noise_below_the_floor_is_not_part_of_the_shape(self):
        assert "forward" not in gd.pattern(chained(ear=4))["shape"]

    def test_no_side_photograph_means_no_chain_to_read(self):
        assert gd.pattern(ik.assess_photos(
            [photo(View.FRONT, standing(cx=540))])) == {}

    def test_the_shape_is_described_in_both_languages(self):
        out = gd.pattern(chained(ear=60, hip=45))
        assert out["shape"] and out["shape_ko"]
        assert out["start_at"] and out["start_at_ko"]

    def test_the_shape_names_no_condition(self):
        """Positional words only. A posture *type* is the same move as a
        diagnosis: authoritative-sounding, unmeasured, and not a studio's to
        make."""
        forbidden = ("kyphot", "lordot", "sway", "scoliosis", "syndrome",
                     "postural type", "flat back")
        for kw in (dict(ear=60), dict(ear=60, shoulder=50, hip=45),
                   dict(hip=45, knee=-40), dict(shoulder=-40, hip=50)):
            blob = " ".join(str(v) for v in gd.pattern(chained(**kw)).values())
            for word in forbidden:
                assert word not in blob.lower(), (kw, word)


class TestHowEvenTheBodyIs:
    def test_a_level_body_is_close_to_wholly_even(self):
        out = gd.balance(ik.assess_photos(four()))
        assert out["evenness"] > 95

    def test_a_crooked_body_is_less_even(self):
        level = gd.balance(ik.assess_photos(four()))["evenness"]
        crooked = gd.balance(ik.assess_photos(
            four(shoulder_tilt=12.0, hip_tilt=9.0)))["evenness"]
        assert crooked < level

    def test_it_names_the_measurement_it_was_least_even_on(self):
        out = gd.balance(ik.assess_photos(four(shoulder_tilt=14.0)))
        assert out["least_even"] == "shoulder_tilt"
        assert out["least_even_name_ko"]

    def test_it_says_how_many_checks_it_averaged(self):
        out = gd.balance(ik.assess_photos(four()))
        assert out["from_checks"] >= 6

    def test_nothing_measured_means_no_number(self):
        assert gd.balance(ik.assess_photos(
            [ik.Photo(View.FRONT, None, 0, 0, problem="x")])) == {}


class TestWhenToComeBack:
    def test_something_marked_comes_back_sooner_than_a_level_body(self):
        marked = gd.report(ik.assess_photos(
            four(shoulder_tilt=14.0), taken_on="2026-01-01"))["review"]
        level = gd.report(ik.assess_photos(
            four(), taken_on="2026-01-01"))["review"]
        assert marked["weeks"] < level["weeks"]

    def test_it_gives_a_date_not_just_an_interval(self):
        out = gd.report(ik.assess_photos(four(shoulder_tilt=14.0),
                                         taken_on="2026-01-01"))["review"]
        assert out["on"] == "2026-02-12"

    def test_no_date_in_means_no_date_out_rather_than_today(self):
        out = gd.report(ik.assess_photos(four()))["review"]
        assert out["on"] == "" and out["weeks"]

    def test_the_interval_says_why_it_is_that_long(self):
        out = gd.report(ik.assess_photos(four()))["review"]
        assert "measurement noise" in out["why"] and out["why_ko"]


class TestTheRegionalBreakdown:
    def test_every_region_with_a_check_is_reported(self):
        out = gd.report(ik.assess_photos(four()))["regions"]
        assert {r["region"] for r in out} == set(al.REGIONS)

    def test_each_region_carries_a_name_a_score_and_its_weakest_check(self):
        for region in gd.report(ik.assess_photos(
                four(shoulder_tilt=9.0)))["regions"]:
            assert region["name"] and region["name_ko"]
            assert region["checks"] > 0
            assert region["weakest_name"], region["region"]

    def test_a_region_with_nothing_measured_is_left_out_not_scored_zero(self):
        out = gd.report(ik.assess_photos(
            [photo(View.SIDE_LEFT, side_on(cx=540))]))["regions"]
        assert "shoulders" in {r["region"] for r in out}
        assert all(r["checks"] > 0 for r in out)

    def test_priorities_carry_enough_to_be_shown(self):
        out = gd.report(ik.assess_photos(
            four(shoulder_tilt=14.0, hip_tilt=10.0, ear_ahead=60.0)))
        assert out["priorities"]
        for entry in out["priorities"]:
            assert entry["name"] and entry["name_ko"]
            assert entry["title"] and entry["measurement"]


class TestPrioritiesAreDistinct:
    def test_one_region_contributes_one_priority(self):
        """Two real head measurements are two findings and one thing to work
        on. A plan that lists both has three slots, not four."""
        out = report_for(shoulder_tilt=14.0, hip_tilt=10.0, ear_ahead=70.0)
        regions = [gd._REGION_OF[p["metric"]] for p in out["priorities"]]
        assert len(regions) == len(set(regions))

    def test_the_list_is_not_padded_to_a_fixed_length(self):
        out = report_for(shoulder_tilt=14.0)
        assert len(out["priorities"]) == 1
