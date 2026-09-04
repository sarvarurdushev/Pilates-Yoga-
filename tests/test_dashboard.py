"""A person's whole record as one page.

Verbal feedback answers "what happened today". These charts answer what a
single session cannot: is this moving, is it moving enough to mean anything,
and what keeps coming back.
"""
import re

import pytest

from pilates.dashboard import (PALETTE, STATUS, Point, Series, bar_chart,
                               collect, line_chart, render)
from pilates.history import MIN_PRACTICAL_CHANGE, MIN_SESSIONS_FOR_TREND
from pilates.identity import Link
from pilates.store import SessionMeta, Store


@pytest.fixture
def store():
    with Store.memory() as db:
        db.enrol("anna", "Anna Smith")
        yield db


def fill(store, subject="left_hip", values=(60, 65, 70), spread=2.0,
         username="anna", track_id=4):
    for i, value in enumerate(values):
        key = f"s{i}-{subject}"
        store.record_session(SessionMeta(key=key, date=f"2026-01-{i + 1:02d}"))
        store.put_link(Link(session=key, track_id=track_id,
                            username=username).confirm("teacher"))
        store.add_measurement(key, track_id, subject, float(value),
                              spread=spread, samples=200, exercise="bridge")


def series(values, spread=2.0, subject="left_hip", lower_is_better=False):
    return Series(subject=subject, unit="deg", lower_is_better=lower_is_better,
                  points=[Point(date=f"2026-01-{i + 1:02d}", value=float(v),
                                spread=spread, samples=200)
                          for i, v in enumerate(values)])


class TestVerdicts:
    """The same rule the written progress report uses, so the picture and the
    sentence can never disagree."""

    def test_a_change_clear_of_the_noise_is_called_one(self):
        assert series([60, 65, 70], spread=2.0).verdict == "changed"

    def test_a_change_inside_the_noise_is_not(self):
        assert series([60, 61, 60.5], spread=8.0).verdict == "steady"

    def test_two_sessions_is_never_a_trend(self):
        assert series([60, 90]).verdict == "too few sessions"
        assert MIN_SESSIONS_FOR_TREND == 3

    def test_a_tiny_change_in_a_very_steady_person_is_still_not_a_change(self):
        """Their noise floor is small, which would otherwise let a one-degree
        drift qualify — true of the arithmetic, useless to the person."""
        assert series([60, 60.5, 61], spread=0.1).verdict == "steady"
        assert MIN_PRACTICAL_CHANGE == 3.0

    def test_a_gap_closing_is_an_improvement_where_smaller_is_better(self):
        assert series([20, 14, 8], lower_is_better=True).verdict == "improved"

    def test_a_gap_widening_is_not(self):
        assert series([8, 14, 20], lower_is_better=True).verdict == "worsened"

    def test_a_bare_angle_moving_gets_no_verdict_on_direction(self):
        """There is no universally good direction for a joint angle."""
        assert series([60, 65, 70], lower_is_better=False).verdict == "changed"

    def test_the_explanation_names_the_floor_that_had_to_be_cleared(self):
        assert "noise floor" in series([60, 65, 70]).explain()

    def test_a_steady_explanation_says_what_it_stayed_inside(self):
        assert "varies anyway" in series([60, 61, 60.5], spread=8.0).explain()


class TestColour:
    """Only genuine judgements get a status colour."""

    def test_improvement_and_worsening_are_the_only_coloured_verdicts(self):
        neutral = STATUS["steady"]
        assert STATUS["changed"] == neutral
        assert STATUS["improved"] != neutral and STATUS["worsened"] != neutral

    def test_a_bare_angle_change_is_not_coloured_as_a_warning(self):
        """Colouring it amber would assert exactly what the wording refuses to."""
        assert STATUS["changed"] == STATUS["steady"]

    def test_both_modes_define_every_role(self):
        assert set(PALETTE["light"]) == set(PALETTE["dark"])


class TestLineChart:
    def test_it_draws_a_point_per_session(self):
        svg = line_chart(series([60, 65, 70]))
        assert svg.count("<circle") == 3

    def test_the_band_is_drawn_behind_the_line(self):
        svg = line_chart(series([60, 65, 70]))
        assert svg.index("polygon") < svg.index("class='line'")

    def test_every_point_carries_its_own_numbers_on_hover(self):
        svg = line_chart(series([60, 65, 70]))
        assert svg.count("<title>") == 3
        assert "varied" in svg and "frames" in svg

    def test_only_the_ends_are_labelled_not_every_point(self):
        """A number on every point is noise."""
        svg = line_chart(series([60, 62, 64, 66, 68]))
        assert svg.count("point-label") == 2

    def test_a_single_session_does_not_crash(self):
        assert "<circle" in line_chart(series([60]))

    def test_a_flat_series_does_not_divide_by_zero(self):
        assert "<circle" in line_chart(series([60, 60, 60], spread=0.0))

    def test_it_carries_a_text_alternative(self):
        assert "aria-label" in line_chart(series([60, 65, 70]))


class TestBarChart:
    def test_each_label_sits_with_its_own_bar(self):
        """Listing labels separately and bars below leaves a reader matching
        two ordered lists by eye."""
        svg = bar_chart([("the hips were not level", 6), ("the knee drifted", 4)])
        groups = re.findall(r"<g class='barrow'.*?</g>", svg, re.S)
        assert len(groups) == 2
        for group in groups:
            assert "bar-label" in group and "<rect" in group

    def test_the_longest_bar_fills_the_width(self):
        svg = bar_chart([("a", 6), ("b", 3)])
        widths = [float(w) for w in re.findall(r"<rect class='bar'[^>]*width='([\d.]+)'", svg)]
        assert widths[0] > widths[1] * 1.9

    def test_a_count_of_one_still_draws_something_visible(self):
        svg = bar_chart([("a", 10), ("b", 1)])
        widths = [float(w) for w in re.findall(r"width='([\d.]+)'", svg)]
        assert min(widths) >= 3.0

    def test_labels_are_escaped(self):
        assert "<script>" not in bar_chart([("<script>x</script>", 2)])

    def test_nothing_to_chart_renders_nothing(self):
        assert bar_chart([]) == ""


class TestCollect:
    def test_it_groups_measurements_into_series(self, store):
        fill(store)
        assert [s.subject for s in collect(store, "anna")] == ["left_hip"]

    def test_one_point_per_session(self, store):
        fill(store, values=(60, 65, 70))
        assert len(collect(store, "anna")[0].points) == 3

    def test_symmetry_is_recognised_as_lower_is_better(self, store):
        fill(store, subject="hip symmetry", values=(20, 14, 8))
        assert collect(store, "anna")[0].lower_is_better

    def test_unattributed_measurements_do_not_appear(self, store):
        store.record_session(SessionMeta(key="x", date="2026-01-01"))
        store.add_measurement("x", 4, "left_hip", 60.0)
        assert collect(store, "anna") == []

    def test_it_can_be_narrowed_to_one_exercise(self, store):
        fill(store)
        assert collect(store, "anna", exercise="bridge")
        assert collect(store, "anna", exercise="plank") == []


class TestPage:
    def test_it_is_self_contained(self, store):
        """A studio emails it or opens it with no network, and nothing about a
        person's body measurements is fetched from somebody else's server.

        The page carries an inline script for the linking, which is not a
        network dependency. What must never appear is a URL or a src.
        """
        fill(store)
        html = render(store, "anna", "Anna Smith")
        assert "http://" not in html and "https://" not in html
        assert "src=" not in html
        assert "<link" not in html and "@import" not in html

    def test_it_names_the_person_and_the_span(self, store):
        fill(store)
        html = render(store, "anna", "Anna Smith")
        assert "Anna Smith" in html and "2026-01-01" in html

    def test_it_shows_a_chart_per_quantity(self, store):
        fill(store, subject="left_hip")
        fill(store, subject="hip symmetry", values=(20, 14, 8))
        assert render(store, "anna").count("<svg") >= 2

    def test_the_table_carries_every_number_in_the_charts(self, store):
        fill(store, values=(60, 65, 70))
        html = render(store, "anna")
        for value in ("60.0deg", "65.0deg", "70.0deg"):
            assert value in html

    def test_recurring_corrections_are_charted(self, store):
        fill(store)
        for i in range(3):
            store.add_finding(f"s{i}-left_hip", 4, "improve", "the hips were not level")
        html = render(store, "anna")
        assert "the hips were not level" in html and "bar-label" in html

    def test_a_person_with_nothing_recorded_is_told_why(self, store):
        html = render(store, "anna", "Anna Smith")
        assert "only attributed once somebody confirms" in html

    def test_the_footer_says_what_the_numbers_are_and_are_not(self, store):
        fill(store)
        html = render(store, "anna")
        assert "not health advice" in html
        assert "confirmed which tracked body" in html

    def test_dark_mode_is_defined_under_both_scopes(self, store):
        fill(store)
        html = render(store, "anna")
        assert "prefers-color-scheme: dark" in html
        assert '[data-theme="dark"]' in html

    def test_names_are_escaped(self, store):
        fill(store)
        assert "<script>x</script>" not in render(store, "anna", "<script>x</script>")


class TestScoreOnThePage:
    """A student asks for a number out of a hundred. It has to be traceable."""

    def _scored(self, store, sessions=4, deviation=0.0):
        from pilates.scoring import MEASURABLE

        for i in range(sessions):
            key = f"sc{i}"
            store.record_session(SessionMeta(key=key, date=f"2026-02-{i + 1:02d}"))
            store.put_link(Link(session=key, track_id=4,
                                username="anna").confirm("t"))
            for subject in MEASURABLE:
                store.add_measurement(key, 4, subject, 100.0, spread=2.0,
                                      samples=200)
                store.add_finding(key, 4,
                                  "improve" if deviation else "good", "x",
                                  subject=subject, deviation=deviation,
                                  source="standard")

    def test_the_headline_number_is_shown(self, store):
        from pilates.dashboard import render

        self._scored(store)
        assert "out of 100" in render(store, "anna")

    def test_it_is_traceable_to_its_components(self, store):
        from pilates.dashboard import render

        self._scored(store)
        html = render(store, "anna")
        assert "What made up the score" in html or "made up the score" in html
        assert "form," in html

    def test_the_coverage_travels_with_it(self, store):
        from pilates.dashboard import render

        self._scored(store)
        assert "measurable quantities" in render(store, "anna")

    def test_a_body_map_marks_every_measurable_quantity(self, store):
        from pilates.dashboard import BODY_POINTS, render
        from pilates.scoring import MEASURABLE

        self._scored(store)
        html = render(store, "anna")
        assert set(BODY_POINTS) <= set(MEASURABLE)
        for name in BODY_POINTS:
            assert name.replace("_", " ") in html

    def test_unmeasured_is_visibly_not_a_low_score(self, store):
        from pilates.dashboard import render

        self._scored(store)
        html = render(store, "anna")
        assert "not measured" in html
        assert "Grey is not a low score" in html

    def test_the_axis_shows_dates_not_internal_session_keys(self, store):
        from pilates.dashboard import render

        self._scored(store)
        html = render(store, "anna")
        assert "2026-02-01" in html and "sc0" not in html

    def test_a_score_history_needs_more_than_one_session(self, store):
        from pilates.dashboard import render

        self._scored(store, sessions=1)
        assert "Score, session by session" not in render(store, "anna")

    def test_it_appears_once_there_are_several(self, store):
        from pilates.dashboard import render

        self._scored(store)
        assert "Score, session by session" in render(store, "anna")

    def test_the_footer_explains_how_a_score_is_built(self, store):
        from pilates.dashboard import render

        self._scored(store)
        html = render(store, "anna")
        assert "average of the checks that could actually be made" in html
        assert "Nothing unmeasured is counted" in html


class TestBodyMap:
    def test_markers_sit_on_the_figure_they_belong_to(self):
        """The first version listed marker positions separately from the
        skeleton's and they drifted off the limbs."""
        from pilates.dashboard import BODY_POINTS, _ANCHORS

        assert BODY_POINTS["left_elbow"] == _ANCHORS["l_elbow"]
        assert BODY_POINTS["right_knee"] == _ANCHORS["r_knee"]
        assert BODY_POINTS["neck"] == _ANCHORS["neck"]

    def test_a_tilt_sits_between_the_two_points_it_measures(self):
        from pilates.dashboard import BODY_POINTS, _ANCHORS

        left, right = _ANCHORS["l_shoulder"], _ANCHORS["r_shoulder"]
        assert BODY_POINTS["shoulder_tilt"] == ((left[0] + right[0]) / 2,
                                               (left[1] + right[1]) / 2)

    def test_the_trunk_marker_is_on_the_mid_line(self):
        from pilates.dashboard import BODY_POINTS

        assert BODY_POINTS["trunk"][0] == 100.0

    def test_bands_are_named_as_well_as_coloured(self):
        from pilates.dashboard import BANDS

        assert all(label for _, _, label in BANDS)

    def test_only_the_weakest_few_are_labelled(self):
        from pilates.dashboard import body_map

        svg = body_map({"left_knee": 20.0, "right_knee": 30.0, "neck": 40.0,
                        "trunk": 95.0, "left_hip": 96.0}, label_worst=3)
        assert svg.count("mark-label") == 3

    def test_every_marker_names_itself_on_hover(self):
        from pilates.dashboard import BODY_POINTS, body_map

        svg = body_map({"left_knee": 80.0})
        assert svg.count("<title>") == len(BODY_POINTS)

    def test_an_unmeasured_marker_says_so_rather_than_showing_a_number(self):
        from pilates.dashboard import body_map

        svg = body_map({"left_knee": None})
        assert "not measured often enough" in svg


class TestLinking:
    """One selection, both views. Clicking a knee should bring up the knee
    angle, the knee symmetry gap and the moments the knee muscles carried."""

    def test_a_joint_angle_belongs_to_its_own_marker(self):
        from pilates.dashboard import body_subjects_for

        assert body_subjects_for("left_knee") == {"left_knee"}

    def test_a_symmetry_gap_belongs_to_both_sides(self):
        from pilates.dashboard import body_subjects_for

        assert body_subjects_for("knee symmetry") == {"left_knee", "right_knee"}

    def test_a_muscle_group_moment_belongs_to_its_joint(self):
        from pilates.dashboard import body_subjects_for

        assert body_subjects_for("knee extensors peak moment") == \
            {"left_knee", "right_knee"}

    def test_a_whole_body_quality_belongs_to_no_marker(self):
        """Pretending otherwise would put a tempo chart under a knee."""
        from pilates.dashboard import body_subjects_for

        for subject in ("repetitions", "control", "tempo ratio", "longest hold"):
            assert body_subjects_for(subject) == set(), subject

    def test_a_single_sided_marker_maps_to_itself(self):
        from pilates.dashboard import body_subjects_for

        assert body_subjects_for("neck") == {"neck"}
        assert body_subjects_for("trunk") == {"trunk"}

    def test_chart_cards_declare_what_they_belong_to(self, store):
        from pilates.dashboard import render

        fill(store, subject="left_knee")
        fill(store, subject="knee symmetry", values=(9, 6, 3))
        html = render(store, "anna")
        assert "data-subjects='left_knee'" in html
        assert "data-subjects='left_knee right_knee'" in html

    def test_body_markers_are_real_controls(self, store):
        from pilates.dashboard import render

        fill(store)
        html = render(store, "anna")
        assert "role='button'" in html and "tabindex='0'" in html

    def test_each_marker_carries_the_subject_it_selects(self, store):
        from pilates.dashboard import render

        fill(store)
        assert "data-subject='left_knee'" in render(store, "anna")

    def test_the_filter_bar_starts_hidden(self, store):
        from pilates.dashboard import render

        fill(store)
        assert "<div class='filterbar' hidden>" in render(store, "anna")

    def test_chart_points_carry_their_own_numbers_for_a_readout(self, store):
        from pilates.dashboard import render

        fill(store)
        html = render(store, "anna")
        for attribute in ("data-date=", "data-value=", "data-spread=",
                          "data-samples="):
            assert attribute in html, attribute

    def test_hover_targets_are_bigger_than_the_dots(self, store):
        """Hovering a line should not require landing on a 9-pixel dot."""
        from pilates.dashboard import line_chart

        svg = line_chart(series([60, 65, 70]))
        assert svg.count("class='hit'") == 3

    def test_the_page_is_readable_without_the_script(self, store):
        """A page about somebody's body measurements should not go blank
        because a script failed to run."""
        from pilates.dashboard import render

        fill(store)
        html = render(store, "anna")
        body = html.split("<script>")[0]
        assert "60.0deg" in body and "left hip" in body


class TestSessionPicker:
    def _sessions(self, store, n=3):
        from pilates.scoring import MEASURABLE

        for i in range(n):
            key = f"p{i}"
            store.record_session(SessionMeta(key=key, date=f"2026-04-{i + 1:02d}"))
            store.put_link(Link(session=key, track_id=4,
                                username="anna").confirm("t"))
            for subject in MEASURABLE:
                store.add_measurement(key, 4, subject, 100.0, spread=2.0, samples=200)
                store.add_finding(key, 4, "good", "x", subject=subject,
                                  source="standard")

    def test_every_session_is_offered(self, store):
        from pilates.dashboard import render

        self._sessions(store)
        html = render(store, "anna")
        for date in ("2026-04-01", "2026-04-02", "2026-04-03"):
            assert f"data-session=" in html and date in html

    def test_each_button_shows_that_session_score(self, store):
        from pilates.dashboard import render

        self._sessions(store)
        assert "<em>100</em>" in render(store, "anna")

    def test_the_page_opens_on_the_most_recent(self, store):
        from pilates.dashboard import render

        self._sessions(store)
        html = render(store, "anna")
        assert "<div class='session' data-session='2'>" in html
        assert "<div class='session' data-session='0' hidden>" in html

    def test_every_session_panel_is_rendered_not_fetched(self, store):
        """Switching sessions must work with no network and no re-render."""
        from pilates.dashboard import render

        self._sessions(store)
        assert render(store, "anna").count("class='session'") == 3

    def test_one_session_needs_no_picker(self, store):
        from pilates.dashboard import render

        self._sessions(store, n=1)
        html = render(store, "anna")
        assert "class='picker'" not in html
        assert "Latest session" in html


class TestUnits:
    """A control figure of 1.5 is not "1.5 ratio"."""

    def test_real_units_are_printed(self):
        from pilates.dashboard import unit_suffix

        assert unit_suffix("deg") == "deg" and unit_suffix("Nm") == "Nm"

    def test_a_description_of_the_quantity_is_not(self):
        from pilates.dashboard import unit_suffix

        assert unit_suffix("ratio") == "" and unit_suffix("count") == ""

    def test_the_readout_data_carries_the_printable_unit(self, store):
        from pilates.dashboard import render

        fill(store)
        store.record_session(SessionMeta(key="r1", date="2026-05-01"))
        store.put_link(Link(session="r1", track_id=4,
                            username="anna").confirm("t"))
        store.add_measurement("r1", 4, "control", 1.5, unit="ratio",
                              samples=100, source="quality")
        html = render(store, "anna")
        assert "data-unit='ratio'" not in html


class TestNoLayoutLoop:
    """Showing the readout inside the heading reflowed it, which moved the chart
    out from under the pointer, which cleared the readout, which moved it back."""

    def test_the_readout_is_not_inside_the_heading(self, store):
        from pilates.dashboard import render

        fill(store)
        html = render(store, "anna")
        assert "<span class='readout'" not in html
        assert "<p class='readout'" in html

    def test_its_height_is_reserved_whether_or_not_it_has_text(self, store):
        from pilates.dashboard import render

        fill(store)
        assert "min-height:1.35em" in render(store, "anna")

    def test_hit_targets_stay_inside_the_plot(self):
        """One that stuck out above caught pointer events meant for the card's
        heading."""
        from pilates.dashboard import line_chart
        import re

        svg = line_chart(series([60, 65, 70]))
        for y in re.findall(r"class='hit'[^>]*y='(-?[\d.]+)'", svg):
            assert float(y) >= 0.0


class TestCorrectionsFollowTheSelection:
    """Somebody who clicked a hip wants the hip's corrections brought
    forward."""

    def test_a_correction_carries_the_markers_it_belongs_to(self):
        from pilates.dashboard import bar_chart

        svg = bar_chart([("the hips were not level", 6, "left_hip right_hip")])
        assert "data-subjects='left_hip right_hip'" in svg

    def test_a_correction_with_no_joint_carries_none(self):
        from pilates.dashboard import bar_chart

        svg = bar_chart([("the movement wobbled", 4, "")])
        assert "data-subjects=''" in svg

    def test_the_chart_still_works_without_the_third_element(self):
        """The signature has to stay usable for a plain label-and-count."""
        from pilates.dashboard import bar_chart

        assert "<rect" in bar_chart([("a", 3), ("b", 1)])

    def test_the_page_wires_findings_to_their_joint(self, store):
        from pilates.dashboard import render

        fill(store)
        for i in range(3):
            store.add_finding(f"s{i}-left_hip", 4, "improve",
                              "the hips were not level", subject="hip symmetry")
        html = render(store, "anna")
        assert "data-subjects='left_hip right_hip'" in html

    def test_they_fade_rather_than_vanish(self, store):
        """A correction that disappeared would lose its rank among the
        others."""
        from pilates.dashboard import render

        fill(store)
        assert ".barrow.dim { opacity:0.22; }" in render(store, "anna")
