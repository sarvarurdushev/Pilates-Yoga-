import numpy as np
import pytest

from pilates.recognition import (
    MAX_NOVELTY, MIN_CONFIDENCE, MIN_MARGIN, MovementDescription,
    OpenSetRecogniser, Recognition, describe,
)

FRAMES, FEATURES = 24, 41


def window(value=0.5, frames=FRAMES):
    return np.full((frames, FEATURES), value, dtype=np.float32)


class FakeModel:
    """A model with dictated probabilities, so each rejection test is isolated."""

    def __init__(self, probabilities, classes=None):
        self.probabilities = np.asarray(probabilities, dtype=np.float64)
        self.classes_ = np.asarray(
            classes if classes is not None else range(len(self.probabilities))
        )

    def predict_proba(self, features):
        return np.tile(self.probabilities, (len(features), 1))


class FakeClassifier:
    def __init__(self, probabilities, names, classes=None):
        self.model = FakeModel(probabilities, classes)
        self.names = list(names)


def recogniser(probabilities, names=("hundred", "roll_up", "swan"),
               classes=None, **kwargs):
    return OpenSetRecogniser(
        classifier=FakeClassifier(probabilities, names, classes), **kwargs)


class TestNeverSayingUnknown:
    """The product rule: a student is never shown a failure message. A name is
    withheld when it is not trustworthy, but something true is always said."""

    def test_a_recognised_exercise_is_named(self):
        assert Recognition("roll_up", 0.9).headline("something else") == "roll up"

    def test_an_unrecognised_one_falls_back_to_what_was_measured(self):
        result = Recognition(None, 0.3, "top class only 0.30")
        assert result.headline("A held position, lying") == "A held position, lying"

    def test_the_fallback_never_apologises(self):
        result = Recognition(None, 0.3, "top class only 0.30")
        text = result.headline(MovementDescription(
            posture="lying", kind="held").summarise())
        for word in ("unknown", "unrecognised", "not recognised", "sorry", "cannot"):
            assert word not in text.lower()

    def test_the_reason_is_kept_for_logs_but_is_not_the_headline(self):
        result = Recognition(None, 0.3, "top class only 0.30")
        assert result.withheld_reason
        assert result.withheld_reason not in result.headline("A held position")

    def test_named_reports_whether_a_name_was_reached(self):
        assert Recognition("swan", 0.9).named
        assert not Recognition(None, 0.9).named


class TestOpenSetDecision:
    def test_a_clear_winner_is_named(self):
        result = recogniser([0.9, 0.05, 0.05]).recognise(window())
        assert result.name == "hundred"

    def test_low_confidence_withholds_the_name(self):
        result = recogniser([0.4, 0.35, 0.25]).recognise(window())
        assert result.name is None
        assert "0.40" in result.withheld_reason

    def test_a_narrow_margin_withholds_it_too(self):
        """A different failure from low confidence: the model is sure it is one
        of two things, which is common between exercises that look alike."""
        result = recogniser([0.56, 0.44, 0.0]).recognise(window())
        assert result.name is None
        assert "roll_up" in result.withheld_reason

    def test_the_margin_test_can_reject_a_confident_top_class(self):
        r = recogniser([0.6, 0.55, 0.05])
        assert 0.6 > MIN_CONFIDENCE          # confidence alone would accept
        assert r.recognise(window()).name is None

    def test_the_runner_up_is_reported_either_way(self):
        result = recogniser([0.9, 0.08, 0.02]).recognise(window())
        assert result.alternative == "roll_up"
        assert result.alternative_confidence == pytest.approx(0.08)

    def test_thresholds_are_adjustable(self):
        strict = recogniser([0.9, 0.05, 0.05], min_confidence=0.95)
        assert strict.recognise(window()).name is None


class TestNovelty:
    """A softmax will hand 0.99 to a movement it has never met. Distance to the
    training distribution is the only test that catches an unseen exercise."""

    def _fitted(self, probabilities, spread=0.5):
        rng = np.random.default_rng(0)
        train = rng.normal(0.0, spread, size=(50, FEATURES * 7))
        return OpenSetRecogniser.fit(
            FakeClassifier(probabilities, ["hundred", "roll_up", "swan"]), train)

    def test_a_familiar_window_is_named(self):
        result = self._fitted([0.9, 0.05, 0.05]).recognise(window(0.0))
        assert result.name == "hundred"

    def test_an_unseen_movement_is_not_named_however_confident_the_model(self):
        result = self._fitted([0.99, 0.005, 0.005]).recognise(window(50.0))
        assert result.name is None
        assert result.confidence > 0.95        # the model was certain
        assert "unlike anything in training" in result.withheld_reason

    def test_novelty_is_reported_as_a_number(self):
        result = self._fitted([0.99, 0.005, 0.005]).recognise(window(50.0))
        assert result.novelty > MAX_NOVELTY

    def test_novelty_uses_the_median_not_the_mean(self):
        """A couple of unusual features is normal variation; most of them being
        unusual is a new movement. A mean lets one outlier reject everything."""
        r = self._fitted([0.9, 0.05, 0.05])
        typical = np.zeros(FEATURES * 7)
        typical[0] = 500.0                     # one wild feature
        assert r.novelty(typical) < MAX_NOVELTY

    def test_without_training_statistics_novelty_is_not_claimed(self):
        r = recogniser([0.9, 0.05, 0.05])
        assert r.novelty(np.full(FEATURES * 7, 1e6)) == 0.0


class TestClassOrdering:
    """The model's column order follows its own class list, not the order the
    names happen to be listed in. Getting this wrong shifts every name by one."""

    def test_names_follow_the_models_class_labels(self):
        # Class 1 is absent from training, so the model knows only 0 and 2.
        r = recogniser([0.9, 0.1], names=("hundred", "roll_up", "swan"),
                       classes=[0, 2])
        assert r.recognise(window()).name == "hundred"

    def test_the_runner_up_follows_them_too(self):
        r = recogniser([0.1, 0.9], names=("hundred", "roll_up", "swan"),
                       classes=[0, 2])
        result = r.recognise(window())
        assert result.name == "swan"
        assert result.alternative == "hundred"


class TestMovementDescription:
    """Everything here is measured directly, so it survives not knowing the
    exercise -- which is the whole point of the fallback."""

    def test_a_held_position(self):
        text = MovementDescription(posture="lying", kind="held").summarise()
        assert text.startswith("A held position, lying")

    def test_repetitions_are_counted(self):
        text = MovementDescription(posture="upright", kind="repetitive",
                                   repetitions=8).summarise()
        assert "8 repetitions" in text

    def test_a_sequence_is_not_called_a_repetition(self):
        text = MovementDescription(posture="upright", kind="sequence").summarise()
        assert "sequence of positions" in text
        assert "repetition" not in text

    def test_the_leading_joint_and_its_range(self):
        text = MovementDescription(posture="lying", kind="held",
                                   leading_joint="left_hip",
                                   range_of_motion=40.0).summarise()
        assert "led by the left hip through 40 degrees" in text

    def test_the_muscle_group_is_named_with_the_load(self):
        text = MovementDescription(posture="lying", kind="held",
                                   working_group="hip flexors",
                                   peak_moment=43.9).summarise()
        assert "loading the hip flexors to 44 Nm" in text

    def test_the_joint_is_named_when_the_group_is_not_known(self):
        text = MovementDescription(posture="lying", kind="held",
                                   hardest_joint="left_hip",
                                   peak_moment=43.9).summarise()
        assert "left hip carrying 44 Nm" in text

    def test_asymmetry_is_mentioned(self):
        assert "uneven" in MovementDescription(
            posture="upright", kind="held", symmetric=False).summarise()

    def test_symmetry_is_mentioned_too(self):
        assert "evenly balanced" in MovementDescription(
            posture="upright", kind="held", symmetric=True).summarise()

    def test_nothing_is_said_about_symmetry_when_it_was_not_measured(self):
        text = MovementDescription(posture="upright", kind="held").summarise()
        assert "even" not in text

    def test_an_unclear_posture_does_not_read_as_an_error(self):
        text = MovementDescription(kind="held").summarise()
        assert "unclear position" in text
        assert "unknown" not in text

    def test_it_is_one_readable_sentence(self):
        text = MovementDescription(
            posture="lying", kind="held", leading_joint="left_hip",
            range_of_motion=40.0, working_group="hip flexors",
            peak_moment=43.9, symmetric=True,
        ).summarise()
        assert text.endswith(".")
        assert text.count(".") == 1


class TestDescribeFromMeasurements:
    def _summary(self, **kwargs):
        from pilates.movement import MovementSummary

        fields = dict(
            track_id=1, signal="left_hip", kind="held", samples=50,
            duration=12.0, repetitions=0, mean_range=40.0,
            range_consistency=None, mean_rep_duration=None,
            mean_tempo_ratio=None, control_ratio=None, signal_confidence=0.9,
            longest_hold=12.0, mean_symmetry={"hip": 4.0},
        )
        fields.update(kwargs)
        return MovementSummary(**fields)

    def _report(self):
        from pilates.biomechanics import JointLoad, LoadReport, MUSCLE_GROUPS

        return LoadReport(loads=[JointLoad(
            joint="left_hip", moment_nm=43.9, direction="flexion",
            group=MUSCLE_GROUPS[("hip", "flexion")], contraction="isometric",
            lever_m=0.21, load_kg=10.4,
        )], body_mass_kg=65.0)

    def test_it_carries_over_what_movement_measured(self):
        description = describe(self._summary(), posture="lying")
        assert description.kind == "held"
        assert description.leading_joint == "left_hip"
        assert description.range_of_motion == 40.0

    def test_it_carries_over_the_load(self):
        description = describe(self._summary(), self._report(), posture="lying")
        assert description.peak_moment == pytest.approx(43.9)
        assert description.working_group == "hip flexors"

    def test_a_small_symmetry_gap_counts_as_even(self):
        assert describe(self._summary(mean_symmetry={"hip": 4.0})).symmetric is True

    def test_a_large_one_does_not(self):
        assert describe(self._summary(mean_symmetry={"hip": 22.0})).symmetric is False

    def test_symmetry_is_left_unsaid_when_nothing_was_measurable(self):
        assert describe(self._summary(mean_symmetry={"hip": None})).symmetric is None

    def test_it_works_with_nothing_at_all(self):
        """The fallback has to hold up in the worst case, because that is when
        it is reached."""
        assert describe().summarise().endswith(".")

    def test_the_worst_case_still_says_something_rather_than_failing(self):
        text = describe().summarise()
        assert "unknown" not in text.lower()

    def test_a_load_report_with_nothing_computable_is_survived(self):
        from pilates.biomechanics import LoadReport

        description = describe(self._summary(), LoadReport(), posture="lying")
        assert description.peak_moment is None
        assert "led by the left hip" in description.summarise()
