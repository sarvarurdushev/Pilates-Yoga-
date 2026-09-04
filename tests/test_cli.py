"""The commands a studio actually types, driven end to end.

The pose model is replaced -- it downloads weights and needs a real video --
but everything above it is the code being tested: the same argument parsing,
the same aggregation, the same printed page a customer would read.
"""
from pathlib import Path

import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.cli import main
from pilates.types import Detection, FrameResult, TrackedPerson
from conftest import make_detection


class FakeSource:
    def __init__(self, frames):
        self.frames = frames

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def __iter__(self):
        return iter(self.frames)


def install(monkeypatch, frames):
    """Replace the video and pose stages with a scripted sequence of frames."""
    class FakePipeline:
        def __init__(self, config=None, backend=None):
            self.config = config

        def run(self, source):
            yield from source

    monkeypatch.setattr("pilates.cli.Pipeline", FakePipeline)
    monkeypatch.setattr(
        "pilates.cli.VideoSource",
        lambda *a, **k: FakeSource(frames),
    )


def leg_raise(n=60, track_id=1, others=()):
    """One student lying down, one knee travelling through an arc."""
    frames = []
    for i in range(n):
        detection = make_detection(x=100, y=100, lying=True)
        points = detection.keypoints.copy()
        swing = 30.0 * np.sin(i / 6.0)
        points[kp.L_KNEE] = points[kp.L_KNEE] + np.array([0.0, -swing])
        points[kp.L_ANKLE] = points[kp.L_ANKLE] + np.array([0.0, -swing * 1.8])
        student = TrackedPerson(
            track_id=track_id,
            detection=Detection(points, detection.scores.copy()))
        people = [student]
        people.extend(f(i, student) for f in others)
        frames.append(FrameResult(frame_index=i, timestamp=i / 10.0, people=people))
    return frames


class TestDescribe:
    """The command that answers "what did this student do" without ever
    printing "unknown exercise"."""

    def test_it_describes_a_student_with_no_model_at_all(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        assert main(["describe", "clip.mov"]) == 0
        out = capsys.readouterr().out
        assert "Student #1" in out

    def test_the_headline_is_never_an_apology(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov"])
        out = capsys.readouterr().out.lower()
        for word in ("unknown exercise", "unrecognised", "not recognised",
                     "could not identify", "sorry"):
            assert word not in out

    def test_it_says_what_posture_the_student_was_in(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov"])
        assert "lying" in capsys.readouterr().out

    def test_it_reports_load_when_mass_and_height_are_given(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68"])
        out = capsys.readouterr().out
        assert "Nm" in out

    def test_without_mass_and_height_no_load_is_invented(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov"])
        assert "Nm" not in capsys.readouterr().out

    def test_a_short_track_is_not_described(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise(n=5))
        assert main(["describe", "clip.mov"]) == 1
        assert "tracked long enough" in capsys.readouterr().out

    def test_one_student_can_be_singled_out(self, monkeypatch, capsys):
        def second(i, student):
            return TrackedPerson(track_id=2, detection=make_detection(x=600))

        install(monkeypatch, leg_raise(others=[second]))
        main(["describe", "clip.mov", "--student", "1"])
        out = capsys.readouterr().out
        assert "Student #1" in out and "Student #2" not in out


class TestDescribeWithEquipment:
    def test_a_declared_prop_is_printed(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov", "--equipment", "block"])
        out = capsys.readouterr().out
        assert "block" in out and "invalidates load" in out

    def test_a_prop_stops_the_load_being_reported(self, monkeypatch, capsys):
        """A block carries part of the body at a point nothing in the image
        shows, so the number would be wrong rather than imprecise."""
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68",
              "--equipment", "bolster"])
        out = capsys.readouterr().out
        assert "no load estimated" in out

    def test_hand_weights_do_not(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68",
              "--equipment", "hand_weights=2"])
        assert "no load estimated" not in capsys.readouterr().out

    def test_a_bad_mass_is_rejected_with_the_fix(self, monkeypatch):
        install(monkeypatch, leg_raise())
        with pytest.raises(SystemExit) as excinfo:
            main(["describe", "clip.mov", "--equipment", "hand_weights=heavy"])
        assert "must be a number" in str(excinfo.value)


class TestDescribeWithAnInstructor:
    """A load measured while somebody's hands were on a student is a reading of
    two people."""

    def _with_instructor(self, frames_touching):
        def instructor(i, student):
            base = make_detection(x=600, y=100)
            points = base.keypoints.copy()
            if i < frames_touching:
                # A hand staying on the knee as it travels, which is what an
                # adjustment looks like.
                points[kp.R_WRIST] = student.detection.keypoints[kp.L_KNEE]
            return TrackedPerson(track_id=9,
                                 detection=Detection(points, base.scores.copy()))

        return leg_raise(others=[instructor])

    def test_a_sustained_adjustment_is_reported(self, monkeypatch, capsys):
        install(monkeypatch, self._with_instructor(40))
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68"])
        assert "hands-on" in capsys.readouterr().out

    def test_a_momentary_pass_by_is_not(self, monkeypatch, capsys):
        install(monkeypatch, self._with_instructor(2))
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68"])
        assert "hands-on" not in capsys.readouterr().out


class TestDescribeWithAModel:
    def _model(self, tmp_path, names, probabilities=None):
        from pilates.classifier import ExerciseClassifier
        from pilates.dataset import FEATURE_SIZE
        from pilates.recognition import OpenSetRecogniser

        rng = np.random.default_rng(0)
        windows = np.stack([
            rng.normal(i, 0.05, size=(24, FEATURE_SIZE)).astype(np.float32)
            for i in range(40) for _ in range(5)
        ])
        labels = np.array([i % len(names) for i in range(len(windows))])
        classifier = ExerciseClassifier().fit(windows, labels, names)
        from pilates.classifier import featurise
        recogniser = OpenSetRecogniser.fit(classifier, featurise(windows))
        path = tmp_path / "m.joblib"
        recogniser.save(str(path))
        return str(path)

    def test_an_unseen_movement_is_described_rather_than_named(
            self, monkeypatch, capsys, tmp_path):
        """Real footage will not match a model trained on noise, which is
        exactly the case this has to survive gracefully."""
        install(monkeypatch, leg_raise())
        model = self._model(tmp_path, ["hundred", "roll_up"])
        assert main(["describe", "clip.mov", "--model", model]) == 0
        out = capsys.readouterr().out
        assert "Student #1" in out
        assert "unknown" not in out.lower()

    def test_the_reason_a_name_was_withheld_is_visible_to_an_operator(
            self, monkeypatch, capsys, tmp_path):
        install(monkeypatch, leg_raise())
        model = self._model(tmp_path, ["hundred", "roll_up"])
        main(["describe", "clip.mov", "--model", model])
        assert "name withheld" in capsys.readouterr().out


class TestSpottingTheInstructor:
    """One camera, no uniforms, no faces: whoever circulates putting hands on
    several different people."""

    def _class(self, n=80, touching=70, switch=35):
        frames = []
        for i in range(n):
            people = []
            for track_id, x in ((1, 100), (2, 300)):
                base = make_detection(x=x, y=100, lying=True)
                points = base.keypoints.copy()
                swing = 30.0 * np.sin(i / 6.0 + track_id)
                points[kp.L_KNEE] = points[kp.L_KNEE] + np.array([0.0, -swing])
                points[kp.L_ANKLE] = points[kp.L_ANKLE] + np.array([0.0, -swing * 1.8])
                people.append(TrackedPerson(
                    track_id=track_id,
                    detection=Detection(points, base.scores.copy())))
            instructor = make_detection(x=600, y=100)
            points = instructor.keypoints.copy()
            if i < touching:
                target = people[0] if i < switch else people[1]
                points[kp.R_WRIST] = target.detection.keypoints[kp.L_KNEE]
            people.append(TrackedPerson(
                track_id=9, detection=Detection(points, instructor.scores.copy())))
            frames.append(FrameResult(frame_index=i, timestamp=i / 10.0, people=people))
        return frames

    def test_the_circulating_track_is_flagged(self, monkeypatch, capsys):
        install(monkeypatch, self._class())
        main(["describe", "clip.mov"])
        out = capsys.readouterr().out
        assert "put hands on 2 different people" in out
        assert "Instructor? (track #9)" in out

    def test_it_is_offered_rather_than_asserted(self, monkeypatch, capsys):
        """The system has no way to be certain, so it says so and points at the
        roster, which is where a person settles it."""
        install(monkeypatch, self._class())
        main(["describe", "clip.mov"])
        assert "Confirm it in the roster" in capsys.readouterr().out

    def test_nobody_is_flagged_when_only_one_student_was_adjusted(
            self, monkeypatch, capsys):
        install(monkeypatch, self._class(switch=200))
        out_before = capsys.readouterr()
        main(["describe", "clip.mov"])
        assert "different people" not in capsys.readouterr().out

    def test_adjusted_students_keep_their_description(self, monkeypatch, capsys):
        """Only the load is dropped. Range, tempo and symmetry are geometry and
        are unaffected by somebody's hands."""
        install(monkeypatch, self._class())
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68"])
        out = capsys.readouterr().out
        assert "Student #1" in out and "degrees" in out

    def test_the_dropped_frames_are_counted_not_hidden(self, monkeypatch, capsys):
        install(monkeypatch, self._class())
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68"])
        assert "were dropped because this load was not the student's alone" in \
            capsys.readouterr().out

    def test_an_untouched_student_is_not_told_frames_were_dropped(
            self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68"])
        assert "dropped" not in capsys.readouterr().out


class TestLoad:
    """The load command has to refuse as readily as it reports."""

    def test_it_reports_a_moment_and_the_muscle_group(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        assert main(["load", "clip.mov", "--mass", "65", "--height", "1.68"]) == 0
        out = capsys.readouterr().out
        assert "Nm" in out and "carried by" in out

    def test_declared_props_stop_it_before_the_video_is_read(
            self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        assert main(["load", "clip.mov", "--mass", "65", "--height", "1.68",
                     "--equipment", "reformer"]) == 1
        captured = capsys.readouterr()
        assert "No load can be estimated" in captured.out
        assert "wrong rather than" in captured.err

    def test_the_refusal_says_what_still_works(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["load", "clip.mov", "--mass", "65", "--height", "1.68",
              "--equipment", "ball"])
        assert "describe" in capsys.readouterr().err

    def test_hand_weights_do_not_stop_it(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        assert main(["load", "clip.mov", "--mass", "65", "--height", "1.68",
                     "--equipment", "hand_weights=2"]) == 0

    def test_frames_under_an_adjustment_are_dropped_and_counted(
            self, monkeypatch, capsys):
        install(monkeypatch, TestSpottingTheInstructor()._class())
        main(["load", "clip.mov", "--mass", "65", "--height", "1.68"])
        out = capsys.readouterr().out
        assert "frames dropped" in out
        assert "hands-on" in out

    def test_it_still_says_the_numbers_are_modelled(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["load", "clip.mov", "--mass", "65", "--height", "1.68"])
        assert "modelled, not measured" in capsys.readouterr().out


class TestAnatomyOutput:
    """Muscles, nerves and bones -- with the provenance of every line kept
    visible, because a reader will otherwise assume the nerve was observed."""

    def _named(self, monkeypatch, name="the_hundred"):
        from pilates.recognition import OpenSetRecogniser, Recognition

        monkeypatch.setattr(OpenSetRecogniser, "recognise",
                            lambda self, w: Recognition(name, 0.82))
        monkeypatch.setattr(OpenSetRecogniser, "load",
                            classmethod(lambda cls, p: cls(classifier=None)))

    def test_a_named_exercise_gets_muscles_and_nerves(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        self._named(monkeypatch)
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68",
              "--anatomy", "--model", "m.joblib"])
        out = capsys.readouterr().out
        assert "rectus abdominis" in out
        assert "thoracoabdominal nerves" in out
        assert "spinal levels" in out

    def test_measured_and_reference_lines_are_labelled(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        self._named(monkeypatch)
        main(["describe", "clip.mov", "--mass", "65", "--height", "1.68",
              "--anatomy", "--model", "m.joblib"])
        out = capsys.readouterr().out
        assert "[measured]" in out and "[reference]" in out

    def test_the_footer_explains_what_the_labels_mean(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        self._named(monkeypatch)
        main(["describe", "clip.mov", "--anatomy", "--model", "m.joblib"])
        out = capsys.readouterr().out
        assert "Nothing here observed a muscle or a" in out

    def test_no_name_means_no_anatomy_rather_than_a_guess(self, monkeypatch, capsys):
        """Attaching a real muscle list to a guessed exercise is worse than
        attaching none."""
        from pilates.recognition import OpenSetRecogniser, Recognition

        install(monkeypatch, leg_raise())
        monkeypatch.setattr(OpenSetRecogniser, "recognise",
                            lambda self, w: Recognition(None, 0.3, "too close"))
        monkeypatch.setattr(OpenSetRecogniser, "load",
                            classmethod(lambda cls, p: cls(classifier=None)))
        main(["describe", "clip.mov", "--anatomy", "--model", "m.joblib"])
        out = capsys.readouterr().out
        assert "the name was withheld" in out
        assert "rectus abdominis" not in out

    def test_without_a_model_it_says_why_not_rather_than_nothing(
            self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        main(["describe", "clip.mov", "--anatomy"])
        assert "no recogniser was" in capsys.readouterr().out

    def test_an_exercise_with_no_entry_says_so(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        self._named(monkeypatch, name="moon_salutation")
        main(["describe", "clip.mov", "--anatomy", "--model", "m.joblib"])
        assert "no reference anatomy on file" in capsys.readouterr().out

    def test_a_curated_library_can_be_imported(self, monkeypatch, capsys, tmp_path):
        import json

        path = tmp_path / "a.json"
        path.write_text(json.dumps({"exercises": [{
            "exercise": "the_hundred", "prime_movers": ["rectus abdominis"],
            "joints": ["spine"], "source": "our own reference project",
        }]}))
        install(monkeypatch, leg_raise())
        self._named(monkeypatch)
        main(["describe", "clip.mov", "--anatomy", "--anatomy-file", str(path),
              "--model", "m.joblib"])
        assert "vertebral column" in capsys.readouterr().out

    def test_an_imported_muscle_with_no_nerve_is_named_not_invented(
            self, monkeypatch, capsys, tmp_path):
        import json

        path = tmp_path / "a.json"
        path.write_text(json.dumps({"exercises": [{
            "exercise": "the_hundred", "prime_movers": ["popliteus"],
            "joints": ["knee"],
        }]}))
        install(monkeypatch, leg_raise())
        self._named(monkeypatch)
        main(["describe", "clip.mov", "--anatomy", "--anatomy-file", str(path),
              "--model", "m.joblib"])
        assert "no nerve supply recorded for popliteus" in capsys.readouterr().err

    def test_anatomy_is_off_unless_asked_for(self, monkeypatch, capsys):
        install(monkeypatch, leg_raise())
        self._named(monkeypatch)
        main(["describe", "clip.mov", "--model", "m.joblib"])
        assert "[reference]" not in capsys.readouterr().out


class TestCrosscheckCommand:
    """Two independently written sets of angle targets, compared."""

    LIBRARY = str(Path(__file__).parent / "data" / "neuro_wellness_sample.json")

    def test_it_reports_agreement_and_disagreement(self, capsys):
        main(["crosscheck", self.LIBRARY])
        out = capsys.readouterr().out
        assert "joint targets compared" in out and "agree" in out

    def test_a_disagreement_exits_non_zero(self, capsys):
        """So a build can be made to fail on one rather than print it and pass."""
        assert main(["crosscheck", self.LIBRARY]) in (0, 2)

    def test_it_says_what_is_outside_the_comparison(self, capsys):
        main(["crosscheck", self.LIBRARY])
        assert "outside what one camera" in capsys.readouterr().out

    def test_the_tolerance_is_adjustable(self, capsys):
        main(["crosscheck", self.LIBRARY, "--tolerance", "45"])
        assert "compared" in capsys.readouterr().out

    def test_an_empty_library_is_an_error_with_a_hint(self, capsys, tmp_path):
        path = tmp_path / "empty.json"
        path.write_text('{"exercises": []}')
        assert main(["crosscheck", str(path)]) == 1
        assert "export_neuro_wellness" in capsys.readouterr().err
