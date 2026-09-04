"""What the coach saw, which the camera cannot.

A fourth tier beside measured, reference and research. The tests that matter
are the refusals -- a rating with nothing attached, a note with no author -- and
the reading order, because a sheet sorted by date buries the one line that has
to be read before the class starts.
"""
import pytest

from pilates.observations import (KINDS, OBSERVED, SCALE, STANDING, Observation,
                                  ratings_over_time, sheet)
from pilates.store import SessionMeta, Store


def note(**kwargs):
    fields = dict(username="anna", kind="note", text="something", by="Sam",
                  made_on="2026-03-03")
    fields.update(kwargs)
    return Observation(**fields)


class TestWhatAnObservationRefuses:
    def test_a_rating_has_to_say_what_it_rates(self):
        """A bare 4 is the thing this project exists not to produce."""
        with pytest.raises(ValueError, match="what it rates"):
            note(rating=4)

    def test_a_rating_is_out_of_five_and_nothing_else(self):
        with pytest.raises(ValueError):
            note(rating=8, rates="control")
        with pytest.raises(ValueError):
            note(rating=0, rates="control")

    def test_an_observation_has_to_say_who_made_it(self):
        """Its whole authority is that a person said it, on a date."""
        with pytest.raises(ValueError, match="who made it"):
            note(by="  ")

    def test_an_empty_note_says_nothing(self):
        with pytest.raises(ValueError, match="says nothing"):
            note(text="   ")

    def test_an_invented_kind_is_refused_with_the_list(self):
        with pytest.raises(ValueError, match="not one of"):
            note(kind="vibes")

    def test_the_date_defaults_to_today_rather_than_to_nothing(self):
        assert Observation(username="anna", kind="note", text="x",
                           by="Sam").made_on


class TestWhatItCarries:
    def test_it_is_always_the_observed_tier(self):
        assert note().to_dict()["tier"] == OBSERVED

    def test_a_structure_is_what_it_is_about(self):
        assert note(structure="psoas major").about == "psoas major"

    def test_with_nothing_named_it_is_about_the_person(self):
        assert note().about == "the whole person"

    def test_a_rating_carries_its_scale_so_it_cannot_be_misread(self):
        out = note(rating=4, rates="control through the hips").to_dict()
        assert out["rating"] == 4 and out["scale"] == SCALE

    def test_long_notes_are_cut_rather_than_refused(self):
        """The guidance is thirty seconds of reading. A coach who writes an
        essay writes it once and never again -- but losing it outright would be
        worse than trimming it."""
        assert len(note(text="x" * 5000).text) < 5000

    def test_every_kind_says_when_it_is_read_back(self):
        assert set(STANDING) <= set(KINDS)
        assert all(KINDS.values())


class TestTheSheetReadsInReadingOrder:
    """A list sorted by date puts a March contraindication six screens below a
    note about a warm-up."""

    def _notes(self):
        return [
            note(kind="note", text="warm-up went fine", made_on="2026-08-01"),
            note(kind="contraindication", text="left knee, no deep flexion",
                 made_on="2026-03-01"),
            note(kind="cue", text="reach the heel away", made_on="2026-04-01"),
            note(kind="goal", text="teaser for five breaths",
                 review_on="2026-01-01", made_on="2026-05-01"),
        ]

    def test_the_flag_comes_first_however_old_it_is(self):
        result = sheet(self._notes(), "anna")
        assert result.urgent
        assert result.flags[0].text.startswith("left knee")

    def test_standing_notes_are_not_in_the_recent_list_as_well(self):
        result = sheet(self._notes(), "anna")
        assert [n.kind for n in result.recent] == ["note"]

    def test_a_goal_past_its_review_date_is_flagged_as_due(self):
        result = sheet(self._notes(), "anna")
        assert len(result.due(on="2026-06-01")) == 1
        assert result.due(on="2025-01-01") == []

    def test_another_person_s_notes_do_not_appear(self):
        mixed = self._notes() + [note(username="ben", kind="contraindication",
                                      text="ben's shoulder")]
        result = sheet(mixed, "anna")
        assert all("ben" not in n.text for n in result.flags)

    def test_a_retired_note_stops_standing(self):
        notes = [note(kind="contraindication", text="healed now", retired=True)]
        assert sheet(notes, "anna").flags == []


class TestRatingsAsASeries:
    def test_they_come_back_oldest_first(self):
        rows = ratings_over_time([
            note(rating=3, rates="control", made_on="2026-05-01"),
            note(rating=5, rates="control", made_on="2026-03-01"),
        ], "anna")
        assert [r["date"] for r in rows] == ["2026-03-01", "2026-05-01"]

    def test_only_the_subject_asked_for(self):
        rows = ratings_over_time([
            note(rating=3, rates="control"),
            note(rating=4, rates="range"),
        ], "anna", rates="control")
        assert len(rows) == 1

    def test_every_row_names_who_said_it(self):
        rows = ratings_over_time([note(rating=3, rates="control")], "anna")
        assert rows[0]["by"] == "Sam" and rows[0]["scale"] == SCALE


class TestTheStore:
    @pytest.fixture
    def store(self):
        with Store.memory() as db:
            db.enrol("anna", "Anna Smith")
            db.record_session(SessionMeta(key="s1", date="2026-03-03",
                                          studio="", duration_s=0, video=""))
            yield db

    def test_a_note_survives_the_round_trip_whole(self, store):
        store.observe(note(kind="cue", text="reach the heel away",
                           structure="rectus femoris", session="s1",
                           rating=4, rates="control"))
        back = store.observations("anna")[0]
        assert back.text == "reach the heel away"
        assert back.structure == "rectus femoris"
        assert back.session == "s1" and back.rating == 4

    def test_a_note_about_the_person_needs_no_session(self, store):
        store.observe(note(kind="contraindication", text="old knee injury"))
        assert store.observations("anna")[0].session == ""

    def test_retiring_keeps_it_and_says_who(self, store):
        note_id = store.observe(note(kind="contraindication", text="old injury"))
        store.retire(note_id, by="Sam")
        assert store.observations("anna") == []
        kept = store.observations("anna", include_retired=True)
        assert len(kept) == 1 and "retired by Sam" in kept[0].text

    def test_notes_can_be_read_back_for_one_structure(self, store):
        store.observe(note(structure="psoas major", text="a"))
        store.observe(note(structure="deltoid", text="b"))
        assert len(store.observations("anna", structure="deltoid")) == 1

    def test_erasing_a_person_takes_their_notes(self, store):
        """Same rule as every other thing held about them."""
        store.observe(note(text="something about anna"))
        store.forget("anna")
        assert store.observations() == []

    def test_the_sheet_comes_back_named(self, store):
        store.observe(note(kind="contraindication", text="old knee injury"))
        assert store.coach_sheet("anna").display_name == "Anna Smith"
