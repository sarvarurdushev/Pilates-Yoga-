"""The rubric changes with what was clicked, and that is the whole point."""
from __future__ import annotations

import pytest

from pilates.structure_eval import (CLOSED, StructureEval, form_for, history)


class TestTheFormDependsOnWhatItIs:
    def test_a_muscle_is_asked_about_recruitment(self):
        keys = [a["key"] for a in form_for("muscle")["axes"]]
        assert "recruitment" in keys and "timing" in keys

    def test_a_bone_is_asked_about_placement_not_effort(self):
        keys = [a["key"] for a in form_for("bone")["axes"]]
        assert "alignment" in keys and "load" in keys
        assert "recruitment" not in keys, "a bone does not recruit"

    def test_a_nerve_is_not_scored_at_all(self):
        """It is a symptom report ending in stop, modify or refer."""
        form = form_for("nerve")
        keys = [a["key"] for a in form["axes"]]
        assert keys == ["symptom", "provoked", "settled", "action"]
        actions = {o[0] for a in form["axes"] if a["key"] == "action"
                   for o in a["options"]}
        assert {"stopped", "modified", "referred"} <= actions
        assert "diagnosis" in form["banner"]

    def test_a_brain_has_no_form_and_says_why(self):
        form = form_for("brain")
        assert form["open"] is False and form["axes"] == []
        assert "not the person to judge" in form["why"]

    def test_an_unknown_kind_is_closed_rather_than_guessed_at(self):
        """Inventing axes for something nobody thought about is how a form ends
        up asking a coach to rate the recruitment of a ligament."""
        form = form_for("ligament")
        assert form["open"] is False and form["axes"] == []

    def test_the_note_prompt_is_not_the_same_for_a_nerve(self):
        """A coach does not *see* a symptom; they are told about one."""
        assert "see" in form_for("muscle")["note_hint"]
        assert "see" not in form_for("nerve")["note_hint"]
        assert "words" in form_for("nerve")["note_hint"]

    def test_every_open_kind_names_its_settled_answer(self):
        """`mid` is what "nothing to do here" means on that axis, and the
        follow-up list reads it. An axis without one silently reports every
        answer as a finding."""
        for kind in ("muscle", "bone", "nerve"):
            for axis in form_for(kind)["axes"]:
                assert axis["mid"], f"{kind}.{axis['key']} has no settled answer"
                assert axis["mid"] in {o[0] for o in axis["options"]}


class TestWhatIsRecorded:
    def _muscle(self, **kw):
        base = dict(username="ann", by="Coach", structure="psoas major",
                    kind="muscle")
        base.update(kw)
        return StructureEval(**base)

    def test_only_the_unsettled_answers_come_back_as_findings(self):
        """What a coach wants back is not five answers, it is the two that were
        not fine."""
        one = self._muscle(marks={"recruitment": "over", "timing": "ontime",
                                  "endurance": "holds"})
        assert one.findings == ["recruitment: over-working"]

    def test_an_axis_from_another_kind_is_refused(self):
        with pytest.raises(ValueError, match="not an axis"):
            self._muscle(marks={"alignment": "neutral"})

    def test_an_answer_that_is_not_offered_is_refused(self):
        with pytest.raises(ValueError, match="not an answer"):
            self._muscle(marks={"recruitment": "excellent"})

    def test_a_note_survives_without_a_choice(self):
        """Somebody who types the observation and never presses a button has
        still said the useful half."""
        one = self._muscle(marks={"recruitment": {"choice": "",
                                                  "note": "let go at rep four"}})
        assert one.marks["recruitment"]["note"] == "let go at rep four"

    def test_but_a_note_without_a_choice_is_not_a_finding(self):
        """"recruitment:" with nothing after the colon is worse than silence."""
        one = self._muscle(marks={"recruitment": {"choice": "",
                                                  "note": "let go at rep four"}})
        assert one.findings == []

    def test_and_it_does_not_light_the_run_of_dots(self):
        one = self._muscle(marks={"recruitment": {"choice": "", "note": "hm"}})
        line = history([one])["axes"]["recruitment"]
        assert line["unsettled"] == 0
        assert line["points"][0]["note"] == "hm"

    def test_nothing_at_all_is_refused(self):
        with pytest.raises(ValueError, match="says nothing"):
            self._muscle(marks={}, fields={})

    def test_a_brain_cannot_be_evaluated_through_the_back_door(self):
        with pytest.raises(ValueError, match="not assessable"):
            StructureEval(username="ann", by="Coach", structure="frontal lobe",
                          kind="brain", fields={"cue": "think harder"})


class TestTheOnlyThingAllowedToShout:
    def _nerve(self, **marks):
        return StructureEval(username="ann", by="Coach", kind="nerve",
                             structure="sciatic nerve", marks=marks)

    def test_a_symptom_that_cleared_is_not_urgent(self):
        assert self._nerve(symptom="tingling", settled="under10").urgent is False

    def test_a_symptom_that_outlived_the_class_is(self):
        assert self._nerve(symptom="tingling", settled="persisted").urgent is True

    def test_so_is_one_that_is_spreading(self):
        assert self._nerve(symptom="numb", settled="spreading").urgent is True

    def test_and_one_they_get_away_from_class(self):
        assert self._nerve(symptom="numb", settled="unrelated").urgent is True

    def test_a_referral_is_urgent_however_it_settled(self):
        assert self._nerve(symptom="shooting", action="referred").urgent is True

    def test_a_muscle_never_shouts(self):
        """Only a nerve symptom escalates. An over-recruiting psoas is a note,
        not an alarm, and a system that alarms on everything gets ignored."""
        one = StructureEval(username="ann", by="C", structure="psoas major",
                            kind="muscle", marks={"recruitment": "gripping"})
        assert one.urgent is False


class TestOverTime:
    def test_nothing_written_is_answered_rather_than_crashing(self):
        out = history([])
        assert out["count"] == 0 and out["axes"] == {}

    def test_the_same_answer_four_classes_running_is_the_finding(self):
        """One class of over-recruitment is a bad day."""
        rows = [StructureEval(username="ann", by="C", structure="psoas major",
                              kind="muscle", marks={"recruitment": "over"},
                              made_on=f"2026-09-0{n}") for n in (1, 2, 3, 4)]
        out = history(rows)
        assert out["count"] == 4
        assert out["axes"]["recruitment"]["unsettled"] == 4

    def test_a_settled_answer_is_marked_settled(self):
        rows = [StructureEval(username="ann", by="C", structure="psoas major",
                              kind="muscle", marks={"recruitment": "right"})]
        assert history(rows)["axes"]["recruitment"]["points"][0]["settled"]

    def test_a_recent_nerve_referral_carries_to_the_top(self):
        rows = [StructureEval(username="ann", by="C", structure="sciatic nerve",
                              kind="nerve", marks={"symptom": "numb",
                                                   "settled": "persisted"})]
        assert history(rows)["urgent"] is True


class TestEveryKindIsCovered:
    def test_the_atlas_registry_kinds_all_have_an_answer(self):
        """The page can hand over any of five kinds and none may 500."""
        for kind in ("muscle", "bone", "nerve", "organ", "brain"):
            form = form_for(kind)
            assert "open" in form
            assert form["open"] or form["why"]

    def test_the_closed_kinds_explain_rather_than_grey_out(self):
        for kind, why in CLOSED.items():
            assert len(why) > 80, f"{kind} needs a reason, not a shrug"
