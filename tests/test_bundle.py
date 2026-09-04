"""One session as one file, for an anatomy viewer to read.

The tier is the load-bearing field: a viewer must never be able to say a nerve
fired because a muscle it supplies was measured.
"""
import base64
import json

import pytest

from pilates.bridge import MEASURED, REFERENCE
from pilates.bundle import (FORMAT, POSE_ENCODING, VERSION, InvalidBundle,
                            build, validate, write)
from pilates.identity import Link
from pilates.store import SessionMeta, Store


@pytest.fixture
def store():
    with Store.memory() as db:
        db.enrol("anna", "Anna Smith")
        db.record_session(SessionMeta(key="s1", date="2026-03-03",
                                      studio="Main", duration_s=2700,
                                      video="s1.mp4"))
        db.save_manifest("s1", "0.1.0", {"keypoint_threshold": 0.4},
                         source_fps=30.0, stride=6)
        db.put_link(Link(session="s1", track_id=1, username="anna",
                         method="declared").confirm("coach"))
        yield db


def measured(store, subject, value, unit="deg", source="standard", valid=True):
    store.add_measurement("s1", 1, subject, value, spread=2.0, samples=900,
                          unit=unit, source=source, valid=valid,
                          invalid_reason="" if valid else "hands on the leg")


class TestShape:
    def test_it_names_its_own_format_and_version(self, store):
        measured(store, "left_hip", 120.0)
        bundle = build(store, "anna", "s1")
        assert bundle["format"] == FORMAT and bundle["version"] == VERSION

    def test_it_carries_the_person_and_the_session(self, store):
        measured(store, "left_hip", 120.0)
        bundle = build(store, "anna", "s1")
        assert bundle["person"]["display_name"] == "Anna Smith"
        assert bundle["session"]["date"] == "2026-03-03"

    def test_it_records_how_the_analysis_was_produced(self, store):
        """A number from 2026 cannot be compared with one from 2028 unless
        something says what produced each."""
        measured(store, "left_hip", 120.0)
        bundle = build(store, "anna", "s1")
        assert bundle["produced_by"]["stride"] == 6
        assert bundle["produced_by"]["config"]["keypoint_threshold"] == 0.4

    def test_quantities_carry_both_registers(self, store):
        measured(store, "left_hip", 120.0)
        item = build(store, "anna", "s1")["quantities"][0]
        assert item["plain"] == "how open the left hip was"
        assert item["technical"] == "left hip angle"

    def test_an_unenrolled_person_is_refused(self, store):
        with pytest.raises(InvalidBundle, match="not enrolled"):
            build(store, "ghost", "s1")

    def test_an_unrecorded_session_is_refused(self, store):
        with pytest.raises(InvalidBundle, match="no session"):
            build(store, "anna", "never")

    def test_an_unconfirmed_session_carries_nothing(self, store):
        store.put_link(Link(session="s1", track_id=1, username="anna"))
        measured(store, "left_hip", 120.0)
        assert build(store, "anna", "s1")["quantities"] == []


class TestTiers:
    """A viewer must never be able to say a nerve fired."""

    def _bundle(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm", source="load")
        measured(store, "left_knee", 168.0)
        return build(store, "anna", "s1")

    def test_a_muscle_group_moment_lights_its_muscles_as_measured(self, store):
        structures = self._bundle(store)["structures"]
        psoas = next(s for s in structures if s["name"] == "psoas major")
        assert psoas["tier"] == MEASURED and psoas["value"] == 44.0

    def test_a_nerve_is_only_ever_reference(self, store):
        structures = self._bundle(store)["structures"]
        nerves = [s for s in structures if s["layer"] == "nervous"]
        assert nerves and all(s["tier"] == REFERENCE for s in nerves)

    def test_the_nerve_sentence_refuses_the_stronger_claim(self, store):
        structures = self._bundle(store)["structures"]
        nerve = next(s for s in structures if s["layer"] == "nervous")
        assert "supplies a muscle that was measured" in nerve["because"]
        assert "observed a nerve" in nerve["because"]

    def test_a_bone_is_only_ever_reference(self, store):
        structures = self._bundle(store)["structures"]
        bones = [s for s in structures if s["layer"] == "skeleton"]
        assert bones and all(s["tier"] == REFERENCE for s in bones)

    def test_the_bone_sentence_refuses_a_load(self, store):
        structures = self._bundle(store)["structures"]
        bone = next(s for s in structures if s["layer"] == "skeleton")
        assert "No load on this bone was estimated" in bone["because"]

    def test_a_joint_angle_does_not_light_a_muscle(self, store):
        """It says where a limb was, not what a muscle did."""
        measured(store, "left_knee", 168.0)
        structures = build(store, "anna", "s1")["structures"]
        assert not [s for s in structures if s["layer"].startswith("muscles")]

    def test_an_invalid_measurement_lights_nothing(self, store):
        """A load measured while somebody's hands were on the student is a
        reading of two people."""
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load", valid=False)
        structures = build(store, "anna", "s1")["structures"]
        assert not [s for s in structures if s["tier"] == MEASURED]

    def test_measured_beats_reference_for_the_same_mesh(self, store):
        """A muscle that was measured should not be downgraded because it also
        sits beside a measured joint."""
        measured(store, "knee extensors peak moment", 30.0, unit="Nm",
                 source="load")
        measured(store, "left_knee", 168.0)
        structures = build(store, "anna", "s1")["structures"]
        femoris = next(s for s in structures if s["name"] == "rectus femoris")
        assert femoris["tier"] == MEASURED

    def test_every_structure_says_where_it_came_from(self, store):
        for structure in self._bundle(store)["structures"]:
            assert structure["because"]

    def test_the_bundle_carries_a_notice_about_its_tiers(self, store):
        notice = self._bundle(store)["notice"]
        assert "measured" in notice and "reference" in notice
        assert "nerve" in notice and "brain" in notice


class TestValidation:
    """A value without a tier is refused rather than defaulted: defaulting it
    would decide silently how a claim about somebody's body is presented."""

    def _valid(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm", source="load")
        return build(store, "anna", "s1")

    def test_a_good_bundle_has_no_problems(self, store):
        assert validate(self._valid(store)) == []

    def test_a_missing_tier_is_refused(self, store):
        bundle = self._valid(store)
        del bundle["quantities"][0]["tier"]
        assert any("tier" in p for p in validate(bundle))

    def test_an_unknown_tier_is_refused(self, store):
        bundle = self._valid(store)
        bundle["structures"][0]["tier"] = "definitely"
        assert any("definitely" in p for p in validate(bundle))

    def test_a_value_with_no_provenance_sentence_is_refused(self, store):
        bundle = self._valid(store)
        bundle["structures"][0]["because"] = ""
        assert any("where it came from" in p for p in validate(bundle))

    def test_a_measured_structure_with_no_value_is_refused(self, store):
        bundle = self._valid(store)
        structure = next(s for s in bundle["structures"] if s["tier"] == MEASURED)
        del structure["value"]
        assert any("no value behind it" in p for p in validate(bundle))

    def test_a_measured_structure_must_name_its_measurement(self, store):
        bundle = self._valid(store)
        structure = next(s for s in bundle["structures"] if s["tier"] == MEASURED)
        del structure["from"]
        assert any("naming the measurement" in p for p in validate(bundle))

    def test_a_foreign_file_is_refused(self):
        assert any("not a" in p for p in validate({"format": "something else"}))

    def test_a_future_version_is_refused(self, store):
        bundle = self._valid(store)
        bundle["version"] = VERSION + 1
        assert any("expected" in p for p in validate(bundle))

    def test_an_invalid_bundle_is_never_written(self, store, tmp_path):
        bundle = self._valid(store)
        bundle["structures"][0]["tier"] = "vibes"
        with pytest.raises(InvalidBundle):
            write(bundle, tmp_path / "b.json")
        assert not (tmp_path / "b.json").exists()

    def test_a_valid_one_is(self, store, tmp_path):
        path = write(self._valid(store), tmp_path / "b.json")
        assert json.loads(path.read_text())["format"] == FORMAT


class TestPoseStream:
    """What lets a viewer scrub a session after the video is gone."""

    def _with_poses(self, store):
        import numpy as np

        from pilates.archive import PoseStream
        from conftest import make_detection

        detections = [make_detection(x=100 + i) for i in range(40)]
        store.save_poses("s1", PoseStream(
            track_id=1, times=(np.arange(40) / 5.0).astype(np.float32),
            points=np.stack([d.keypoints for d in detections]),
            scores=np.stack([d.scores for d in detections])))

    def test_it_travels_with_the_bundle(self, store):
        self._with_poses(store)
        pose = build(store, "anna", "s1")["pose"]
        assert pose["frames"] == 40 and pose["encoding"] == POSE_ENCODING

    def test_it_decodes_back_to_the_same_frames(self, store):
        from pilates.archive import decode

        self._with_poses(store)
        pose = build(store, "anna", "s1")["pose"]
        stream = decode(base64.b64decode(pose["data"]))
        assert len(stream) == 40

    def test_it_can_be_left_out_for_a_summary(self, store):
        self._with_poses(store)
        assert "pose" not in build(store, "anna", "s1", include_poses=False)

    def test_a_foreign_encoding_is_refused(self, store):
        self._with_poses(store)
        bundle = build(store, "anna", "s1")
        bundle["pose"]["encoding"] = "some other format"
        assert any("encoding" in p for p in validate(bundle))

    def test_events_travel_with_it(self, store):
        store.add_event("s1", 1, "repetition", 4.0, 7.0, label="left_knee")
        assert build(store, "anna", "s1")["events"]


class TestScore:
    def test_the_score_travels_with_its_coverage(self, store):
        from pilates.scoring import MEASURABLE

        for subject in MEASURABLE:
            measured(store, subject, 100.0)
            store.add_finding("s1", 1, "good", "x", subject=subject,
                              source="standard")
        score = build(store, "anna", "s1")["score"]
        assert score["value"] == 100.0
        assert score["measured"] == score["measurable"] == len(MEASURABLE)

    def test_a_withheld_score_carries_its_reason(self, store):
        measured(store, "left_hip", 120.0)
        score = build(store, "anna", "s1")["score"]
        assert score["value"] is None and score["withheld_reason"]


class TestEventsAreIndependentOfPoses:
    """A session with events but no archived pose stream was losing its events
    entirely, because the lookup was nested inside the archive scan."""

    def test_events_travel_without_a_pose_stream(self, store):
        store.add_event("s1", 1, "adjustment", 10.0, 14.0, label="leg")
        bundle = build(store, "anna", "s1")
        assert "pose" not in bundle
        assert bundle["events"][0]["label"] == "leg"

    def test_they_come_back_in_time_order(self, store):
        for t in (9.0, 1.0, 5.0):
            store.add_event("s1", 1, "repetition", t)
        starts = [e["start_s"] for e in build(store, "anna", "s1")["events"]]
        assert starts == sorted(starts)

    def test_another_person_s_events_do_not_leak_in(self, store):
        store.enrol("ben")
        store.put_link(Link(session="s1", track_id=2,
                            username="ben").confirm("coach"))
        store.add_event("s1", 2, "repetition", 3.0)
        store.add_event("s1", 1, "repetition", 4.0)
        events = build(store, "anna", "s1")["events"]
        assert [e["track_id"] for e in events] == [1]


class TestLighting:
    """The level is what a viewer writes into the palette, so it travels with
    the bundle rather than being worked out on the far side, where nothing
    tests it."""

    def test_every_structure_carries_a_level(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        for structure in build(store, "anna", "s1")["structures"]:
            assert isinstance(structure["level"], float)

    def test_the_scheme_says_what_the_bands_mean(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        lighting = build(store, "anna", "s1")["lighting"]
        floor, ceiling = lighting["measured_band"]
        assert lighting["reference_level"] < floor < ceiling
        assert lighting["scale"]["value"] == 44.0

    def test_reference_structures_are_all_at_one_level(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        measured(store, "elbow extensors peak moment", 2.0, unit="Nm",
                 source="load")
        bundle = build(store, "anna", "s1")
        flat = bundle["lighting"]["reference_level"]
        levels = {s["level"] for s in bundle["structures"]
                  if s["tier"] == REFERENCE}
        assert levels == {flat}

    def test_a_bundle_whose_levels_contradict_its_tiers_is_refused(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        bundle = build(store, "anna", "s1")
        bundle["structures"][0]["level"] = bundle["lighting"]["reference_level"]
        assert any("outside" in p or "not the flat" in p
                   for p in validate(bundle))

    def test_overlapping_bands_are_refused(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        bundle = build(store, "anna", "s1")
        bundle["lighting"]["reference_level"] = 0.9
        assert any("look alike" in p for p in validate(bundle))

    def test_a_structure_with_no_level_is_refused(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        bundle = build(store, "anna", "s1")
        del bundle["structures"][0]["level"]
        assert any("no level" in p for p in validate(bundle))


class TestAMuscleInTwoMeasuredGroups:
    """Biceps femoris is a hip extensor and a knee flexor; rectus femoris is a
    hip flexor and a knee extensor. Keeping whichever group sorted first left
    the hamstrings showing a hip number and never a knee one, for no reason a
    reader could see."""

    def test_the_larger_effort_sets_the_light(self, store):
        measured(store, "hip extensors peak moment", 21.0, unit="Nm",
                 source="load")
        measured(store, "knee flexors peak moment", 3.0, unit="Nm",
                 source="load")
        bundle = build(store, "anna", "s1")
        biceps = next(s for s in bundle["structures"]
                      if s["name"] == "biceps femoris")
        assert biceps["value"] == 21.0
        assert biceps["from"] == "hip extensors peak moment"

    def test_the_other_group_is_named_rather_than_dropped(self, store):
        measured(store, "hip extensors peak moment", 21.0, unit="Nm",
                 source="load")
        measured(store, "knee flexors peak moment", 3.0, unit="Nm",
                 source="load")
        biceps = next(s for s in build(store, "anna", "s1")["structures"]
                      if s["name"] == "biceps femoris")
        assert biceps["also"] == ["knee flexors peak moment"]
        assert "knee flexors" in biceps["because"]

    def test_a_muscle_in_one_group_carries_no_also(self, store):
        measured(store, "hip extensors peak moment", 21.0, unit="Nm",
                 source="load")
        gluteus = next(s for s in build(store, "anna", "s1")["structures"]
                       if s["name"] == "gluteus maximus")
        assert "also" not in gluteus


class TestBothRegisters:
    """A viewer holding only the technical half will show it to a student, and
    the student is the reader the plain half exists for."""

    def test_every_structure_carries_a_plain_sentence(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        for structure in build(store, "anna", "s1")["structures"]:
            assert structure["plain"]

    def test_a_structure_with_no_plain_half_is_refused(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        bundle = build(store, "anna", "s1")
        del bundle["structures"][0]["plain"]
        assert any("plain-words" in p for p in validate(bundle))

    def test_the_plain_half_keeps_the_caveat_the_technical_one_carries(self, store):
        """Both have to say the number is a peak across both sides. A plain
        register that quietly drops the caveats is the worse lie."""
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        psoas = next(s for s in build(store, "anna", "s1")["structures"]
                     if s["name"] == "psoas major")
        assert "either side" in psoas["plain"]
        assert "either side" in psoas["because"]

    def test_a_nerve_says_in_both_registers_that_it_was_not_observed(self, store):
        measured(store, "hip flexors peak moment", 44.0, unit="Nm",
                 source="load")
        nerve = next(s for s in build(store, "anna", "s1")["structures"]
                     if s["name"] == "femoral nerve")
        assert "not measured" in nerve["plain"]
        assert "observed a nerve" in nerve["because"]

    def test_a_bone_is_not_given_a_side_it_does_not_have(self, store):
        """One mesh serves both femurs. Naming the left one, because that angle
        came first in the list, printed an accident as a fact."""
        measured(store, "left_hip", 120.0)
        measured(store, "right_hip", 118.0)
        femur = next(s for s in build(store, "anna", "s1")["structures"]
                     if s["name"] == "femur")
        assert "left" not in femur["plain"] and "right" not in femur["plain"]


class TestSynthetic:
    """A demonstration that cannot be told from a measurement is the worst thing
    this project could publish: a student would believe it, and anyone who found
    out afterwards would be right to distrust everything beside it."""

    def _demo(self):
        from pilates.demo import build as build_demo
        from pilates.demo import fill, marker

        with Store.memory() as store:
            fill(store)
            return build(store, "anna", "tue-14", include_poses=False,
                         synthetic=marker())

    def test_a_real_capture_carries_no_marker(self, store):
        measured(store, "left_hip", 120.0)
        assert "synthetic" not in build(store, "anna", "s1")

    def test_the_demo_says_it_is_one(self):
        marker = self._demo()["synthetic"]
        assert marker["not_a_person"] is True
        assert "No camera recorded it" in marker["why"]

    def test_the_demo_is_otherwise_a_valid_bundle(self):
        assert validate(self._demo()) == []

    def test_a_marker_with_no_reason_is_refused(self, store):
        measured(store, "left_hip", 120.0)
        bundle = build(store, "anna", "s1")
        bundle["synthetic"] = {"not_a_person": True}
        assert any("without saying why" in p for p in validate(bundle))

    def test_a_marker_that_does_not_deny_a_person_is_refused(self, store):
        """The field a viewer reads to decide how loudly to say so."""
        measured(store, "left_hip", 120.0)
        bundle = build(store, "anna", "s1")
        bundle["synthetic"] = {"why": "made up"}
        assert any("not_a_person" in p for p in validate(bundle))

    def test_the_demo_carries_the_exercises_the_evidence_needs(self):
        keys = {e["key"] for e in self._demo()["exercises"]}
        assert {"pelvicCurl", "oneLegCircle", "plank"} <= keys

    def test_the_demo_is_shaped_like_a_mat_class(self):
        """Hips hardest, arms barely. A demo whose numbers are shaped wrongly
        teaches the reader something false about what the instrument makes."""
        moments = {s["name"]: s["value"] for s in self._demo()["structures"]
                   if s["tier"] == MEASURED}
        assert moments["psoas major"] > moments["triceps brachii"] * 5


class TestHistory:
    """A bundle that only ever shows the latest class can print a number. One
    that carries the series can say whether it moved, which is the question the
    person actually has."""

    def _weeks(self, store, n=4):
        from pilates.demo import fill

        for week in range(n):
            fill(store, session=f"w{week}", date=f"2026-0{week + 1}-05", drift=week)

    def test_every_quantity_carries_its_series(self):
        with Store.memory() as store:
            self._weeks(store)
            history = build(store, "anna", "w3", include_poses=False)["history"]
        assert history["left_hip"]["sessions"] == 4
        assert len(history["left_hip"]["points"]) == 4

    def test_the_current_session_is_marked_on_the_line(self):
        with Store.memory() as store:
            self._weeks(store)
            history = build(store, "anna", "w2", include_poses=False)["history"]
        current = [p for p in history["left_hip"]["points"] if p["current"]]
        assert len(current) == 1 and current[0]["date"] == "2026-03-05"

    def test_the_verdict_is_the_same_rule_the_report_uses(self):
        """Not recomputed here: the chart and the sentence must not be able to
        disagree in front of the person they are about."""
        from pilates.dashboard import collect

        with Store.memory() as store:
            self._weeks(store, 8)
            history = build(store, "anna", "w7", include_poses=False)["history"]
            for series in collect(store, "anna"):
                assert history[series.subject]["verdict"] == series.verdict
                assert history[series.subject]["noise_floor"] == round(series.floor, 3)

    def test_the_score_is_carried_for_every_session(self):
        with Store.memory() as store:
            self._weeks(store)
            runs = build(store, "anna", "w3", include_poses=False)["score_history"]
        assert [r["session"] for r in runs] == ["w0", "w1", "w2", "w3"]

    def test_a_withheld_score_carries_its_reason_rather_than_a_number(self):
        with Store.memory() as store:
            store.enrol("anna")
            store.record_session(SessionMeta(key="s1", date="2026-03-03",
                                             studio="", duration_s=0, video=""))
            store.put_link(Link(session="s1", track_id=1,
                                username="anna").confirm("coach"))
            store.add_measurement("s1", 1, "left_hip", 120.0, unit="deg",
                                  source="standard")
            runs = build(store, "anna", "s1", include_poses=False)["score_history"]
        assert runs[0]["value"] is None
        assert runs[0]["withheld_reason"]

    def test_another_person_s_sessions_do_not_appear(self):
        with Store.memory() as store:
            self._weeks(store)
            store.enrol("ben")
            store.record_session(SessionMeta(key="ben1", date="2026-05-05",
                                             studio="", duration_s=0, video=""))
            store.put_link(Link(session="ben1", track_id=1,
                                username="ben").confirm("coach"))
            runs = build(store, "anna", "w3", include_poses=False)["score_history"]
        assert all(r["session"] != "ben1" for r in runs)
