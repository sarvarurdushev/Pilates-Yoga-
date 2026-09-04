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
        groups = re.findall(r"<g>.*?</g>", svg, re.S)
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
        person's body measurements is fetched from somebody else's server."""
        fill(store)
        html = render(store, "anna", "Anna Smith")
        assert "http://" not in html and "https://" not in html
        assert "<script" not in html

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
