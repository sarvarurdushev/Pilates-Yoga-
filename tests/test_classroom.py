import pytest

from pilates.classroom import (
    ClassPattern, ClassResult, Roster, StudentResult, class_patterns,
)
from pilates.coaching import Assessment, Finding
from conftest import make_detection


def student(name, exercise="mountain", improve=(), good=()):
    assessment = Assessment(exercise=exercise, samples=50, confidence=0.8)
    for message in improve:
        assessment.findings.append(Finding(
            kind="improve", subject="x", message=message,
            measured=12.0, target="within 8deg", deviation=4.0,
        ))
    for message in good:
        assessment.findings.append(Finding(
            kind="good", subject="y", message=message, measured=175.0,
        ))
    return StudentResult(track_id=1, name=name, exercise=exercise,
                         assessment=assessment, summary=None, frames=50)


class TestRoster:
    def test_stub_marks_everyone_unnamed(self):
        roster = Roster.stub([3, 1, 2])
        assert list(roster.names) == [1, 2, 3]
        assert all(v.startswith("?") for v in roster.names.values())

    def test_an_unfilled_stub_names_nobody(self):
        """Otherwise a studio gets a stack of pages addressed to 'student 7'."""
        assert Roster.stub([1, 2, 3]).named == 0

    def test_partially_filled(self):
        roster = Roster.stub([1, 2, 3])
        roster.names[2] = "Anna"
        assert roster.named == 1
        assert roster.name_for(2) == "Anna"
        assert roster.name_for(1).startswith("?")

    def test_round_trip(self, tmp_path):
        roster = Roster.stub([1, 2], video="class.mov")
        roster.names[1] = "Anna"
        path = tmp_path / "r.json"
        roster.save(path)
        loaded = Roster.load(path)
        assert loaded.name_for(1) == "Anna"
        assert loaded.video == "class.mov"

    def test_keys_survive_json_as_integers(self):
        """JSON has no integer keys, so this is a real chance to break."""
        import json
        roster = Roster.stub([7])
        roster.names[7] = "Ben"
        data = json.loads(json.dumps({
            "names": {str(k): v for k, v in roster.names.items()}
        }))
        rebuilt = Roster(names={int(k): v for k, v in data["names"].items()})
        assert rebuilt.name_for(7) == "Ben"

    def test_unknown_track_has_no_name(self):
        assert Roster.stub([1]).name_for(99) is None


class TestClassPatterns:
    """A single student with an uneven hip is a note for that student. Six of
    eight is a note about the teaching."""

    def _result(self, students):
        return ClassResult(video="c.mov", date="2026-01-01", students=students)

    def test_a_shared_problem_becomes_a_pattern(self):
        result = self._result([
            student("Anna", improve=["the hips were not level"]),
            student("Ben", improve=["the hips were not level"]),
            student("Cal", improve=[]),
        ])
        patterns = class_patterns(result)
        assert len(patterns) == 1
        assert patterns[0].affected == 2 and patterns[0].measured == 3

    def test_one_student_alone_is_not_a_pattern(self):
        result = self._result([
            student("Anna", improve=["the hips were not level"]),
            student("Ben", improve=[]),
        ])
        assert class_patterns(result) == []

    def test_the_threshold_is_adjustable(self):
        result = self._result([
            student("Anna", improve=["x"]), student("Ben", improve=["x"]),
        ])
        assert class_patterns(result, min_affected=3) == []
        assert len(class_patterns(result, min_affected=2)) == 1

    def test_patterns_name_the_students(self):
        result = self._result([
            student("Anna", improve=["x"]), student("Ben", improve=["x"]),
        ])
        assert class_patterns(result)[0].students == ["Anna", "Ben"]

    def test_most_widespread_first(self):
        result = self._result([
            student("Anna", improve=["common", "rare"]),
            student("Ben", improve=["common"]),
            student("Cal", improve=["common", "rare"]),
        ])
        patterns = class_patterns(result)
        assert patterns[0].message == "common"
        assert patterns[0].affected == 3

    def test_exercises_are_counted_separately(self):
        """Two students bending a knee in a plank is a different observation
        from two students bending one in a bridge."""
        result = self._result([
            student("Anna", exercise="plank", improve=["x"]),
            student("Ben", exercise="plank", improve=["x"]),
            student("Anna", exercise="bridge", improve=["x"]),
        ])
        patterns = class_patterns(result)
        assert len(patterns) == 1
        assert patterns[0].exercise == "plank"

    def test_share_is_out_of_those_measured(self):
        result = self._result([
            student("Anna", improve=["x"]), student("Ben", improve=["x"]),
            student("Cal", improve=[]), student("Dee", improve=[]),
        ])
        assert class_patterns(result)[0].share == pytest.approx(0.5)

    def test_description_uses_counts_not_bare_percentages(self):
        """'75%' hides that it meant three students out of four."""
        result = self._result([
            student("Anna", improve=["x"]), student("Ben", improve=["x"]),
        ])
        text = class_patterns(result)[0].describe()
        assert "2 of 2" in text
        assert "%" not in text


class TestClassResult:
    def test_names_are_deduplicated(self):
        result = ClassResult(video="c", date="d", students=[
            student("Anna", exercise="plank"), student("Anna", exercise="bridge"),
        ])
        assert result.names == ["Anna"]

    def test_filtering_by_exercise(self):
        result = ClassResult(video="c", date="d", students=[
            student("Anna", exercise="plank"), student("Ben", exercise="bridge"),
        ])
        assert len(result.by_exercise("plank")) == 1


class TestClassSummaryPage:
    def _render(self, students, skipped=()):
        from pilates.report import render_class_summary
        result = ClassResult(video="c.mov", date="2026-01-01",
                             students=students, skipped_unnamed=list(skipped),
                             exercises=["mountain"])
        return render_class_summary(result, class_patterns(result))

    def test_lists_every_student(self):
        html = self._render([student("Anna"), student("Ben")])
        assert "Anna" in html and "Ben" in html

    def test_shows_a_shared_problem_as_a_count(self):
        html = self._render([
            student("Anna", improve=["the hips were not level"]),
            student("Ben", improve=["the hips were not level"]),
        ])
        assert "2 of 2" in html

    def test_says_so_when_nothing_is_shared(self):
        html = self._render([student("Anna"), student("Ben")])
        assert "No correction applied to more than one student" in html

    def test_names_who_was_skipped(self):
        html = self._render([student("Anna")], skipped=[4, 9])
        assert "student 4" in html and "student 9" in html

    def test_escapes_student_names(self):
        html = self._render([student("<script>x</script>")])
        assert "<script>x</script>" not in html

    def test_explains_what_the_counts_are_out_of(self):
        html = self._render([student("Anna")])
        assert "not the whole register" in html


class TestRosterCoverage:
    """Found by running the real thing: a roster built from one shot was used
    against a whole edited video, naming 3 students and silently dropping 40.
    Track ids restart at every cut."""

    def _roster(self, named: dict):
        roster = Roster.stub(sorted(named))
        roster.names.update(named)
        return roster

    def test_a_matching_roster_passes(self):
        from pilates.classroom import check_coverage
        roster = self._roster({1: "Anna", 2: "Ben", 3: "Cal"})
        assert check_coverage(roster, [1, 2, 3]).ok

    def test_a_roster_from_another_shot_is_caught(self):
        from pilates.classroom import check_coverage
        roster = self._roster({1: "Anna", 2: "Ben", 3: "Cal"})
        check = check_coverage(roster, [1, 2, 3] + list(range(40, 80)))
        assert not check.ok
        assert check.named == 3 and check.tracked == 43

    def test_the_message_explains_the_cause(self):
        from pilates.classroom import check_coverage
        roster = self._roster({1: "Anna"})
        message = check_coverage(roster, list(range(1, 30))).message
        assert "restart at every cut" in message
        assert "one continuous shot" in message

    def test_partial_coverage_above_the_threshold_passes(self):
        from pilates.classroom import MIN_ROSTER_COVERAGE, check_coverage
        assert MIN_ROSTER_COVERAGE == 0.5
        roster = self._roster({1: "Anna", 2: "Ben", 3: "Cal"})
        assert check_coverage(roster, [1, 2, 3, 4, 5]).ok      # 3 of 5

    def test_just_below_the_threshold_fails(self):
        from pilates.classroom import check_coverage
        roster = self._roster({1: "Anna", 2: "Ben"})
        assert not check_coverage(roster, [1, 2, 3, 4, 5]).ok  # 2 of 5

    def test_placeholders_do_not_count_as_named(self):
        from pilates.classroom import check_coverage
        assert not check_coverage(Roster.stub([1, 2, 3]), [1, 2, 3]).ok

    def test_nobody_tracked_is_not_ok(self):
        from pilates.classroom import check_coverage
        check = check_coverage(self._roster({1: "Anna"}), [])
        assert not check.ok and "no student was tracked" in check.message


class TestRosterRange:
    def test_a_stub_records_the_range_it_was_built_from(self):
        roster = Roster.stub([1, 2], start_frame=3648, end_frame=4348)
        assert roster.range_note == "frames 3648-4348"

    def test_a_whole_video_roster_says_so(self):
        assert Roster.stub([1]).range_note == "the whole video"

    def test_the_range_survives_a_round_trip(self, tmp_path):
        path = tmp_path / "r.json"
        Roster.stub([1], start_frame=100, end_frame=900).save(path)
        assert Roster.load(path).range_note == "frames 100-900"

    def test_the_stub_warns_about_cuts(self):
        assert "restart at" in Roster.stub([1]).notes
