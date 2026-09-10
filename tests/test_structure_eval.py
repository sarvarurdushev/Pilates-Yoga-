"""The coach names what they watched; this file owns almost nothing."""
from __future__ import annotations

import pytest

from pilates.structure_eval import (CLOSED, SCALE, SUGGESTED, VERDICTS,
                                    StructureEval, form_for, history)


class TestTheRubricIsNotOurs:
    def test_a_check_can_be_anything_the_coach_types(self):
        """The whole point. No enum, no fixed axes, no guessing."""
        one = StructureEval(username="ann", by="Coach", kind="muscle",
                            structure="psoas major",
                            checks=[{"label": "does it let go at the bottom",
                                     "verdict": "watch"}])
        assert one.labels == ["does it let go at the bottom"]

    def test_a_note_on_its_own_is_a_complete_reading(self):
        """A coach who wants to write a sentence should never have to press a
        button first."""
        one = StructureEval(username="ann", by="Coach", kind="muscle",
                            structure="psoas major",
                            note="took over from the abdominals every teaser")
        assert one.checks == [] and one.note.startswith("took over")

    def test_nothing_at_all_is_refused(self):
        with pytest.raises(ValueError, match="says nothing"):
            StructureEval(username="ann", by="Coach", kind="muscle",
                          structure="psoas major")

    def test_only_the_verdict_is_fixed_and_it_is_three_values(self):
        """Three rather than five: agreement on visual movement judgements
        improves with coarse rating and falls apart on fine graded ones."""
        assert set(VERDICTS) == {"fine", "watch", "problem"}
        with pytest.raises(ValueError, match="is not one of"):
            StructureEval(username="ann", by="Coach", kind="muscle",
                          structure="psoas major",
                          checks=[{"label": "x", "verdict": "4"}])

    def test_a_check_with_no_verdict_is_allowed(self):
        """Writing down what you watched, without judging it, is a real act."""
        one = StructureEval(username="ann", by="Coach", kind="muscle",
                            structure="psoas major",
                            checks=[{"label": "left against right"}])
        assert one.checks[0]["verdict"] == ""
        assert one.flagged == []

    def test_a_blank_label_is_dropped_rather_than_stored(self):
        one = StructureEval(username="ann", by="Coach", kind="muscle",
                            structure="psoas major", note="fine today",
                            checks=[{"label": "  ", "verdict": "fine"}])
        assert one.checks == []


class TestSuggestionsAreOnlySuggestions:
    def test_a_muscle_and_a_bone_are_offered_different_starting_points(self):
        assert form_for("muscle")["suggested"] != form_for("bone")["suggested"]

    def test_the_coach_s_own_wording_comes_first(self):
        """Whatever they called it last time beats anything we could invent."""
        form = form_for("muscle", seen=["does the shoulder shrug"])
        assert form["suggested"][0] == "does the shoulder shrug"
        assert form["yours"] == 1

    def test_their_wording_is_not_duplicated_by_a_suggestion(self):
        mine = SUGGESTED["muscle"][0]
        form = form_for("muscle", seen=[mine])
        assert form["suggested"].count(mine) == 1

    def test_a_nerve_carries_one_sentence_and_no_banner(self):
        """A yellow box on every nerve is noise; noise is what gets a real
        warning ignored."""
        form = form_for("nerve")
        assert "referral" in form["note"]
        assert "banner" not in form

    def test_a_muscle_carries_no_sentence_at_all(self):
        assert form_for("muscle")["note"] == ""

    def test_a_brain_takes_no_reading_and_says_why(self):
        form = form_for("brain")
        assert form["open"] is False
        assert "not the person to judge" in form["why"]

    def test_an_unknown_kind_gets_a_free_note_and_nothing_invented(self):
        form = form_for("ligament")
        assert form["open"] is True and form["suggested"] == []


class TestTheOnlyThingAllowedToShout:
    def test_a_nerve_called_a_problem_is_urgent(self):
        one = StructureEval(username="ann", by="C", kind="nerve",
                            structure="sciatic nerve",
                            checks=[{"label": "how long it lasted",
                                     "verdict": "problem"}])
        assert one.urgent is True

    def test_a_nerve_worth_watching_is_not(self):
        one = StructureEval(username="ann", by="C", kind="nerve",
                            structure="sciatic nerve",
                            checks=[{"label": "what they reported",
                                     "verdict": "watch"}])
        assert one.urgent is False

    def test_a_muscle_never_shouts_however_bad(self):
        """A system that alarms on everything gets switched off."""
        one = StructureEval(username="ann", by="C", kind="muscle",
                            structure="psoas major",
                            checks=[{"label": "how much work",
                                     "verdict": "problem"}])
        assert one.urgent is False

    def test_a_brain_cannot_be_written_about_through_the_back_door(self):
        with pytest.raises(ValueError, match="not assessable"):
            StructureEval(username="ann", by="C", kind="brain",
                          structure="frontal lobe", note="think harder")


class TestWhatComesBack:
    def _one(self, labels, on="2026-09-01"):
        return StructureEval(username="ann", by="C", kind="muscle",
                             structure="psoas major", made_on=on,
                             checks=[{"label": k, "verdict": v}
                                     for k, v in labels])

    def test_only_the_ones_that_were_not_fine(self):
        one = self._one([("how much work", "problem"), ("left vs right", "fine")])
        assert one.flagged == ["how much work — a problem"]

    def test_the_vocabulary_comes_back_for_next_time(self):
        """The second reading of a psoas should be one press, not the same
        phrase typed again."""
        rows = [self._one([("how much work", "fine")], "2026-09-01"),
                self._one([("does it let go", "watch")], "2026-09-08")]
        assert history(rows)["labels"] == ["does it let go", "how much work"]

    def test_a_label_used_twice_appears_once(self):
        rows = [self._one([("how much work", "fine")], "2026-09-01"),
                self._one([("how much work", "problem")], "2026-09-08")]
        assert history(rows)["labels"] == ["how much work"]

    def test_the_same_check_four_classes_running_is_the_run(self):
        """Once is a bad day."""
        rows = [self._one([("how much work", "problem")], f"2026-09-0{n}")
                for n in (1, 2, 3, 4)]
        run = history(rows)["runs"]["how much work"]
        assert [p["verdict"] for p in run] == ["problem"] * 4

    def test_nothing_written_is_answered_rather_than_crashing(self):
        out = history([])
        assert out["count"] == 0 and out["labels"] == [] and out["runs"] == {}

    def test_a_check_with_no_verdict_stays_out_of_the_runs(self):
        one = StructureEval(username="ann", by="C", kind="muscle",
                            structure="psoas major",
                            checks=[{"label": "left against right"}])
        out = history([one])
        assert out["runs"] == {}
        assert out["labels"] == ["left against right"]


class TestEveryKindIsCovered:
    def test_none_of_the_five_kinds_blows_up(self):
        for kind in ("muscle", "bone", "nerve", "organ", "brain"):
            form = form_for(kind)
            assert form["open"] or form["why"]

    def test_the_closed_kinds_explain_rather_than_shrug(self):
        for kind, why in CLOSED.items():
            assert len(why) > 80, f"{kind} needs a reason, not a shrug"


class TestScoredAndDrawable:
    """A verdict cannot be drawn as a line, which is what the chart needs."""

    def _one(self, **kw):
        base = dict(username="ann", by="Coach", kind="muscle",
                    structure="Psoas major")
        base.update(kw)
        return StructureEval(**base)

    def test_a_check_carries_a_score(self):
        one = self._one(checks=[{"label": "Its own job", "axis": "job",
                                 "score": 7}])
        assert one.checks[0]["score"] == 7

    def test_a_score_outside_the_scale_is_refused(self):
        with pytest.raises(ValueError, match="a score is 0 to"):
            self._one(checks=[{"label": "x", "axis": "job",
                               "score": SCALE + 1}])

    def test_zero_is_a_real_score_and_not_an_absence(self):
        one = self._one(checks=[{"label": "x", "axis": "job", "score": 0}])
        assert one.checks[0]["score"] == 0 and one.average == 0

    def test_a_check_with_no_score_is_still_allowed(self):
        one = self._one(checks=[{"label": "x", "axis": "job",
                                 "note": "looked, did not commit"}])
        assert one.checks[0]["score"] is None and one.average is None

    def test_the_axis_key_is_what_lines_up_across_classes(self):
        """The wording on screen can change; the anatomy it came from does not."""
        rows = [self._one(made_on="2026-06-01",
                          checks=[{"label": "Its own job", "axis": "job",
                                   "score": 3}]),
                self._one(made_on="2026-06-08",
                          checks=[{"label": "Its job", "axis": "job",
                                   "score": 6}])]
        lines = history(rows)["lines"]
        assert list(lines) == ["job"]
        assert [p["score"] for p in lines["job"]["points"]] == [3, 6]
        assert lines["job"]["moved"] == 3

    def test_a_free_typed_check_charts_by_its_label(self):
        rows = [self._one(checks=[{"label": "does it let go", "score": 4}])]
        assert list(history(rows)["lines"]) == ["does it let go"]

    def test_the_overall_is_the_mean_of_what_was_scored(self):
        one = self._one(checks=[{"label": "a", "axis": "x", "score": 4},
                                {"label": "b", "axis": "y", "score": 7},
                                {"label": "c", "axis": "z"}])
        assert one.average == 5.5


class TestWhatAStudentMaySee:
    """Charts and the line written for them. Nothing else on the row."""

    def _one(self, **kw):
        base = dict(username="ann", by="Coach", kind="muscle",
                    structure="Psoas major",
                    note="private working note",
                    shared="Your hips are letting go more",
                    checks=[{"label": "Its own job", "axis": "job", "score": 6,
                             "verdict": "watch", "note": "still gripping"}])
        base.update(kw)
        return StructureEval(**base)

    def test_the_coach_s_own_note_never_leaves(self):
        out = self._one().to_dict(private=False)
        assert "note" not in out and "by" not in out
        assert "private working note" not in str(out)

    def test_nor_does_a_per_check_note_or_verdict(self):
        out = self._one().to_dict(private=False)
        assert out["checks"] == [{"label": "Its own job", "axis": "job",
                                  "score": 6, "low": "", "high": "",
                                  "better": "", "xlabel": ""}]
        assert "still gripping" not in str(out)

    def test_the_axis_names_travel_with_the_scores(self):
        """What 0 and 10 mean is part of the chart, not coach vocabulary.

        The label already reaches the student -- a line has to be called
        something -- and the named ends are the same kind of thing: without
        them a student is shown a 6 out of 10 on a scale nobody defined, which
        is a number presented as if it meant something. The coach's *note* and
        *verdict* are the private half and are still dropped, which is what the
        test above holds.
        """
        out = self._one(checks=[{"label": "Does it let go?", "score": 8,
                                 "low": "holds on", "high": "lets go",
                                 "better": "high", "verdict": "fine",
                                 "note": "mine alone"}]).to_dict(private=False)
        check = out["checks"][0]
        assert check["low"] == "holds on" and check["high"] == "lets go"
        assert check["better"] == "high"
        assert "verdict" not in check and "note" not in check
        assert "mine alone" not in str(out)

    def test_the_newest_naming_labels_the_whole_line(self):
        """A coach who names the ends today labels every reading, not the rest.

        The definition rides on each reading because there is nowhere else to
        put it, but it describes the *axis*, which does not change: readings
        taken before anyone wrote down what 0 and 10 meant were taken on the
        same scale. Carrying it forward only would have drawn the same line
        half-labelled, and left the first months of a record unreadable.
        """
        from pilates.structure_eval import history
        early = self._one(made_on="2026-01-05",
                          checks=[{"label": "Does it let go?", "score": 3}])
        late = self._one(made_on="2026-02-05",
                         checks=[{"label": "Does it let go?", "score": 8,
                                  "low": "holds on", "high": "lets go",
                                  "better": "high"}])
        line = history([early, late])["lines"]["Does it let go?"]
        assert line["low"] == "holds on" and line["high"] == "lets go"
        assert line["better"] == "high"
        assert [p["score"] for p in line["points"]] == [3, 8]
        assert line["moved"] == 5

    def test_a_scale_with_no_named_better_end_says_so(self):
        """So the chart can decline to colour it rather than guess.

        Up is not good: eight out of ten on "is the internal oblique taking
        over?" is bad news. A line whose coach never said which end they
        wanted carries no direction, and `scoreLines` draws the movement
        without a colour instead of inventing one.
        """
        from pilates.structure_eval import history
        one = self._one(made_on="2026-01-05",
                        checks=[{"label": "Taking over?", "score": 2}])
        two = self._one(made_on="2026-02-05",
                        checks=[{"label": "Taking over?", "score": 9}])
        line = history([one, two])["lines"]["Taking over?"]
        assert line.get("better", "") == ""

    def test_the_line_written_for_them_does(self):
        assert self._one().to_dict(private=False)["shared"] == (
            "Your hips are letting go more")

    def test_the_history_they_get_is_drawable_and_nothing_more(self):
        past = history([self._one()], private=False)
        assert set(past) == {"count", "latest", "first_on", "lines", "overall",
                             "scale", "shared"}
        point = past["lines"]["job"]["points"][0]
        assert set(point) == {"date", "score"}

    def test_the_coach_s_history_keeps_all_of_it(self):
        past = history([self._one()])
        assert past["lines"]["job"]["points"][0]["note"] == "still gripping"
        assert past["latest"]["note"] == "private working note"

    def test_an_unscored_check_cannot_reach_them_at_all(self):
        """It would be a label with nothing to draw, and a label is vocabulary."""
        one = self._one(checks=[{"label": "Something delicate", "axis": "x",
                                 "note": "context they should not read"}])
        assert one.to_dict(private=False)["checks"] == []

    def test_a_reading_that_is_only_a_line_for_them_is_valid(self):
        one = StructureEval(username="ann", by="C", kind="muscle",
                            structure="Psoas major",
                            shared="Nothing to worry about")
        assert one.shared and one.checks == []
