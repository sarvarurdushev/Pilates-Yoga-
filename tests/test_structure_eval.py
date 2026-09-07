"""The coach names what they watched; this file owns almost nothing."""
from __future__ import annotations

import pytest

from pilates.structure_eval import (CLOSED, SUGGESTED, VERDICTS, StructureEval,
                                    form_for, history)


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
