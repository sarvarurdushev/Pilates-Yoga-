"""What a coach scores, on the axes they already teach in.

The five are the STOTT PILATES Five Basic Principles, which is what
contemporary instructor training is built on -- so the tests that matter are
about keeping the rubric closed (five, always the same five, or there is no
line to draw) and about the difference between *not looked at* and *bad*.
"""
import pytest

from pilates.evaluation import (ANCHORS, EFFORT, PRINCIPLES, SCALE, Evaluation,
                                series, summary)
from pilates.store import Store


def scored(**overrides):
    marks = {key: 3 for key in PRINCIPLES}
    marks.update(overrides)
    return marks


class TestTheRubricIsClosed:
    def test_it_is_the_five_principles_and_nothing_else(self):
        assert set(PRINCIPLES) == {"breathing", "pelvic", "ribcage",
                                   "scapular", "cervical"}

    def test_every_axis_says_what_to_watch_for(self):
        """An axis with no guidance is an axis two coaches score differently."""
        assert all(meta["label"] and meta["watch"]
                   for meta in PRINCIPLES.values())

    def test_every_point_on_the_scale_means_something(self):
        """The only way two coaches at one studio mean the same by a 3."""
        assert set(ANCHORS) == set(range(1, SCALE + 1))
        assert all(ANCHORS.values())

    def test_an_invented_axis_is_refused(self):
        with pytest.raises(ValueError, match="not one of the five"):
            Evaluation(username="kim", by="Park", scores={"vibes": 4})

    def test_a_score_off_the_scale_is_refused(self):
        for bad in (0, 6, -1):
            with pytest.raises(ValueError, match="a score is 1 to 5"):
                Evaluation(username="kim", by="Park", scores={"breathing": bad})

    def test_an_invented_effort_is_refused(self):
        with pytest.raises(ValueError, match="not one of"):
            Evaluation(username="kim", by="Park", scores=scored(),
                       effort="incandescent")
        assert set(EFFORT) == {"light", "steady", "hard"}


class TestWhatAnEvaluationRefuses:
    def test_one_about_nobody(self):
        with pytest.raises(ValueError, match="about somebody"):
            Evaluation(username="  ", by="Park", scores=scored())

    def test_one_by_nobody(self):
        """Its whole authority is that a coach said it, on a date."""
        with pytest.raises(ValueError, match="who made it"):
            Evaluation(username="kim", by="", scores=scored())

    def test_one_with_nothing_in_it(self):
        with pytest.raises(ValueError, match="says nothing"):
            Evaluation(username="kim", by="Park")

    def test_but_prose_alone_is_enough(self):
        """A coach with ninety seconds writes the plan and no numbers, and a
        form that refuses that is a form nobody fills in twice."""
        assert Evaluation(username="kim", by="Park",
                          plan="wall roll-downs before the mat work")


class TestSkippingIsAGapNotAZero:
    def test_a_partial_evaluation_has_no_average(self):
        """A mean of the two axes somebody happened to fill in is not
        comparable with a mean of five."""
        partial = Evaluation(username="kim", by="Park",
                             scores={"breathing": 4, "pelvic": 2})
        assert partial.average is None
        assert not partial.to_dict()["complete"]

    def test_a_full_one_does(self):
        full = Evaluation(username="kim", by="Park", scores=scored(ribcage=5))
        assert full.average == 3.4 and full.to_dict()["complete"]

    def test_a_skipped_axis_leaves_a_gap_in_the_line(self):
        lines = series([
            Evaluation(username="kim", by="P", scores=scored(), made_on="2026-08-01"),
            Evaluation(username="kim", by="P", scores={"breathing": 4},
                       made_on="2026-08-08"),
        ])
        assert len(lines["breathing"]["points"]) == 2
        assert len(lines["pelvic"]["points"]) == 1

    def test_an_empty_score_is_not_a_zero(self):
        evaluation = Evaluation(username="kim", by="P",
                                scores={"breathing": 4, "pelvic": None,
                                        "ribcage": ""})
        assert set(evaluation.scores) == {"breathing"}


class TestTheNoteIsTheValuableHalf:
    def test_a_note_rides_with_its_score(self):
        evaluation = Evaluation(
            username="kim", by="P", scores=scored(ribcage=2),
            notes={"ribcage": "flares on the second half of every roll-down"})
        assert "roll-down" in evaluation.to_dict()["notes"]["ribcage"]

    def test_it_reaches_the_line(self):
        lines = series([Evaluation(username="kim", by="P", scores=scored(),
                                   notes={"pelvic": "grips to hold neutral"})])
        assert lines["pelvic"]["points"][0]["note"] == "grips to hold neutral"

    def test_a_note_on_an_axis_that_was_not_scored_is_dropped(self):
        """It would print under a number that does not exist."""
        evaluation = Evaluation(username="kim", by="P", scores={"breathing": 3},
                                notes={"invented": "nonsense"})
        assert evaluation.notes == {}


class TestWhatTheCoachOpensItFor:
    def _run(self, ribcage):
        return [Evaluation(username="kim", by="P", scores=scored(ribcage=r),
                           made_on=f"2026-08-{i + 1:02d}")
                for i, r in enumerate(ribcage)]

    def test_the_weakest_axis_is_named(self):
        one = Evaluation(username="kim", by="P", scores=scored(ribcage=1))
        assert one.weakest == "Rib cage placement"

    def test_the_focus_is_the_lowest_of_the_five_right_now(self):
        found = summary(self._run([2, 2, 1]))
        assert found["focus"] == "ribcage"
        assert found["focus_label"] == "Rib cage placement"

    def test_movement_is_measured_from_the_first_score(self):
        found = summary(self._run([2, 3, 4]))
        assert found["lines"]["ribcage"]["moved"] == 2
        assert found["lines"]["ribcage"]["latest"] == 4

    def test_one_score_has_not_moved_anywhere(self):
        found = summary(self._run([3]))
        assert found["lines"]["ribcage"]["moved"] == 0

    def test_nothing_scored_is_answered_rather_than_crashing(self):
        assert summary([])["evaluations"] == 0

    def test_the_lines_come_back_oldest_first(self):
        found = summary([
            Evaluation(username="kim", by="P", scores=scored(pelvic=5),
                       made_on="2026-09-01"),
            Evaluation(username="kim", by="P", scores=scored(pelvic=1),
                       made_on="2026-08-01"),
        ])
        assert [p["value"] for p in found["lines"]["pelvic"]["points"]] == [1, 5]


class TestTheStore:
    @pytest.fixture
    def db(self):
        with Store.memory() as store:
            store.enrol("kim", "Kim Min-ji")
            store.enrol("ben", "Ben")
            yield store

    def test_it_survives_the_round_trip_whole(self, db):
        db.evaluate(Evaluation(
            username="kim", by="Park Min-seok", scores=scored(ribcage=2),
            notes={"ribcage": "flares on the roll-down"},
            did="Footwork, hundred", settings="two reds and a blue",
            cue="reach the heel away", plan="wall roll-downs", effort="hard"))
        back = db.evaluations("kim")[0]
        assert back.scores["ribcage"] == 2
        assert back.notes["ribcage"] == "flares on the roll-down"
        assert back.settings == "two reds and a blue" and back.effort == "hard"
        assert back.id

    def test_another_person_s_scores_do_not_appear(self, db):
        db.evaluate(Evaluation(username="kim", by="P", scores=scored()))
        db.evaluate(Evaluation(username="ben", by="P", scores=scored()))
        assert len(db.evaluations("kim")) == 1

    def test_erasing_a_person_takes_their_evaluations(self, db):
        """Same rule as every other thing held about them."""
        db.evaluate(Evaluation(username="kim", by="P", scores=scored()))
        db.forget("kim")
        assert db.evaluations("kim") == []

    def test_they_come_back_in_order(self, db):
        for day in ("03", "01", "02"):
            db.evaluate(Evaluation(username="kim", by="P", scores=scored(),
                                   made_on=f"2026-08-{day}"))
        assert [e.made_on for e in db.evaluations("kim")] == [
            "2026-08-01", "2026-08-02", "2026-08-03"]
