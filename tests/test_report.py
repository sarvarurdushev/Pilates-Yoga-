import pytest

from pilates.coaching import DEFAULT_STANDARDS, Assessment, Finding, assess
from pilates.history import HistoryStore, Measurement, SessionRecord
from pilates.movement import MovementSummary, TrackHistory
from pilates.report import StudentReport, build, render, write
from conftest import make_detection

STRAIGHT = {"left_knee": 175.0, "right_knee": 175.0,
            "left_hip": 172.0, "right_hip": 172.0,
            "left_elbow": 170.0, "right_elbow": 170.0}


def history(angles=None, frames=30, trunk=88.0):
    h = TrackHistory(track_id=1)
    det = make_detection(x=100, y=100)
    for i in range(frames):
        h.add(i * 0.1, det, 0.4)
        for name, value in (angles or STRAIGHT).items():
            h.samples[-1].angles[name] = value
        h.samples[-1].trunk = trunk
    return h


def report_for(angles=None, **kw):
    h = history(angles)
    return build(student="Anna", exercise="mountain",
                 assessment=assess(h, DEFAULT_STANDARDS["mountain"]), **kw)


class TestRender:
    def test_produces_a_whole_page(self):
        html = render(report_for())
        assert html.startswith("<!doctype html>")
        assert html.rstrip().endswith("</html>")

    def test_is_self_contained(self):
        """A studio should be able to email it without anything phoning home."""
        html = render(report_for())
        assert "<style>" in html
        for marker in ("http://", "https://", "<script", "src="):
            assert marker not in html, marker

    def test_names_the_student_and_exercise(self):
        html = render(report_for())
        assert "Anna" in html and "mountain" in html

    def test_shows_the_measurement_behind_each_claim(self):
        html = render(report_for(dict(STRAIGHT, left_knee=140.0)))
        assert "140" in html
        assert "160-185" in html

    def test_lists_what_could_not_be_judged(self):
        angles = dict(STRAIGHT)
        angles["left_knee"] = None
        html = render(report_for(angles))
        assert "Could not be judged" in html

    def test_carries_the_not_health_advice_note(self):
        assert "not health advice" in render(report_for())

    def test_states_how_much_data_it_saw(self):
        assert "analysed frames" in render(report_for())

    def test_leads_with_a_priority_when_there_is_one(self):
        html = render(report_for(dict(STRAIGHT, left_knee=130.0)))
        assert "One thing for next time" in html

    def test_says_so_when_nothing_needs_correcting(self):
        html = render(report_for())
        assert "Nothing stood out" in html


class TestEscaping:
    def test_a_name_cannot_inject_markup(self):
        report = report_for()
        report.student = "<script>alert(1)</script>"
        html = render(report)
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html

    def test_a_studio_name_is_escaped_too(self):
        report = report_for()
        report.studio = "Bob & Sons <b>"
        html = render(report)
        assert "Bob &amp; Sons &lt;b&gt;" in html

    def test_a_finding_message_is_escaped(self):
        assessment = Assessment(exercise="mountain", samples=30, confidence=0.9)
        assessment.findings.append(
            Finding(kind="improve", subject="x", message="<img onerror=1>",
                    measured=10.0, target="0-5deg", deviation=5.0)
        )
        html = render(StudentReport(student="A", exercise="mountain",
                                    date="2026-01-01", assessment=assessment))
        assert "<img onerror=1>" not in html


class TestMovementBlock:
    def _summary(self, kind="repetitive", **kw):
        base = dict(track_id=1, signal="left_hip", kind=kind, samples=100,
                    duration=45.0, repetitions=8, mean_range=40.0,
                    range_consistency=3.0, mean_rep_duration=4.0,
                    mean_tempo_ratio=1.0, control_ratio=1.2,
                    signal_confidence=0.9, longest_hold=None)
        base.update(kw)
        return MovementSummary(**base)

    def test_a_set_shows_repetitions(self):
        report = report_for()
        report.summary = self._summary()
        html = render(report)
        assert "Repetitions" in html and "Range of motion" in html

    def test_a_flow_is_described_as_one(self):
        report = report_for()
        report.summary = self._summary(kind="sequence")
        html = render(report)
        assert "sequence of poses" in html
        assert "Repetitions" not in html

    def test_a_hold_is_described_as_one(self):
        report = report_for()
        report.summary = self._summary(kind="held")
        assert "held a position" in render(report)


class TestProgress:
    def _store(self, values, spread=2.0):
        store = HistoryStore()
        for i, v in enumerate(values):
            store.add(SessionRecord(
                student="Anna", date=f"2026-01-{i + 1:02d}", exercise="mountain",
                measurements=[Measurement("hip symmetry", v, spread, 30)],
            ))
        return store

    def test_no_progress_section_without_history(self):
        assert "earlier sessions" not in render(report_for())

    def test_progress_appears_with_history(self):
        html = render(report_for(store=self._store([20.0, 13.0, 5.0])))
        assert "earlier sessions" in html
        assert "improved" in html

    def test_noise_is_reported_as_steady_not_progress(self):
        """The refusal has to survive into the printed page, which is read as
        more authoritative than a terminal."""
        html = render(report_for(store=self._store([12.0, 11.5, 12.5], spread=9.0)))
        assert "Steady" in html
        assert "improved" not in html

    def test_early_sessions_are_marked_as_such(self):
        html = render(report_for(store=self._store([20.0, 5.0])))
        assert "Not enough sessions yet" in html

    def test_session_count_is_stated(self):
        html = render(report_for(store=self._store([20.0, 13.0, 5.0])))
        assert "3 recorded session" in html


class TestWrite:
    def test_writes_a_file(self, tmp_path):
        path = write(report_for(), tmp_path / "sub" / "anna.html")
        assert path.exists()
        assert path.read_text(encoding="utf-8").startswith("<!doctype html>")


class TestReadableNames:
    def _store(self, values, spread=2.0, subject="left_knee"):
        store = HistoryStore()
        for i, v in enumerate(values):
            store.add(SessionRecord(
                student="Anna", date=f"2026-01-{i + 1:02d}", exercise="mountain",
                measurements=[Measurement(subject, v, spread, 30)],
            ))
        return store

    def test_underscores_do_not_reach_the_reader(self):
        html = render(report_for(store=self._store([175.0, 174.0, 176.0], spread=6.0)))
        assert "left knee" in html
        assert "left_knee" not in html

    def test_also_in_the_early_sessions_line(self):
        html = render(report_for(store=self._store([175.0, 160.0])))
        assert "left knee" in html and "left_knee" not in html
