"""The long-term record.

Built for the case where this has been running in a studio for two years, which
is the only case where any of it matters.
"""
import pytest

from pilates.identity import CONFIRMED, PROPOSED, Link, Signature
from pilates.store import SOURCES, SessionMeta, Store


@pytest.fixture
def store():
    with Store.memory() as db:
        db.enrol("anna", "Anna Smith")
        db.enrol("ben", "Ben Jones")
        yield db


def a_session(store, key="tue-01", date="2026-01-06"):
    store.record_session(SessionMeta(key=key, date=date, video=f"{key}.mp4",
                                     studio="Main", students=12))
    return key


def confirmed(store, key, track_id=4, username="anna"):
    store.put_link(Link(session=key, track_id=track_id,
                        username=username).confirm("teacher@studio"))


class TestSessions:
    def test_a_session_is_recorded_once(self, store):
        a_session(store)
        a_session(store)
        assert len(store.sessions()) == 1

    def test_re_recording_updates_rather_than_duplicates(self, store):
        a_session(store)
        store.record_session(SessionMeta(key="tue-01", date="2026-01-06", students=20))
        assert store.sessions()[0]["students"] == 20

    def test_an_unknown_session_key_is_an_error_not_a_silent_insert(self, store):
        with pytest.raises(KeyError):
            store.add_measurement("never-recorded", 1, "left_hip", 60.0)


class TestIdentityIsSeparateFromMeasurement:
    """Measurements key to a track; which person that was is a separate fact.
    Joining at query time is what makes attribution retroactive and a mistake
    reversible."""

    def test_a_measurement_stores_before_anyone_is_identified(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        assert store.coverage()["measurements"] == 1
        assert store.coverage()["attributed"] == 0

    def test_confirming_later_attributes_it_retroactively(self, store):
        """Nothing is lost while an assignment waits to be checked."""
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        confirmed(store, key)
        assert len(store.history("anna")) == 1

    def test_an_unconfirmed_link_attributes_nothing(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        assert store.history("anna") == []

    def test_a_mistake_is_reversible_by_changing_one_row(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        confirmed(store, key, username="anna")
        assert len(store.history("anna")) == 1
        confirmed(store, key, username="ben")
        assert store.history("anna") == []
        assert len(store.history("ben")) == 1

    def test_pending_links_are_listed_as_a_queue(self, store):
        key = a_session(store)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        store.put_link(Link(session=key, track_id=5, username="ben").confirm("t"))
        pending = store.pending()
        assert [l.track_id for l in pending] == [4]

    def test_links_can_be_filtered_by_session_and_status(self, store):
        key = a_session(store)
        confirmed(store, key)
        assert len(store.links(session=key, status=CONFIRMED)) == 1
        assert store.links(session=key, status=PROPOSED) == []


class TestProvenance:
    """Every row carries where it came from. A training set assembled without
    that would be poisoned in a way nothing downstream could detect."""

    def test_the_source_is_stored(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "hip_range", 62.0, source="class")
        confirmed(store, key)
        assert store.history("anna")[0].source == "class"

    def test_an_unknown_source_is_refused(self, store):
        key = a_session(store)
        with pytest.raises(ValueError, match="unknown source"):
            store.add_measurement(key, 4, "x", 1.0, source="vibes")

    def test_every_named_source_is_accepted(self, store):
        key = a_session(store)
        for source in SOURCES:
            store.add_measurement(key, 4, "x", 1.0, source=source)
        confirmed(store, key)
        assert len(store.history("anna")) == len(SOURCES)

    def test_an_invalid_measurement_is_stored_and_flagged(self, store):
        """A load measured while somebody's hands were on the student is stored
        so it can be examined, not so it can be averaged."""
        key = a_session(store)
        store.add_measurement(key, 4, "hip_moment", 44.0, source="load",
                              valid=False, invalid_reason="instructor supporting the leg")
        confirmed(store, key)
        assert store.history("anna") == []
        held = store.history("anna", valid_only=False)
        assert held[0].invalid_reason == "instructor supporting the leg"

    def test_invalid_rows_are_counted_in_coverage(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "x", 1.0, valid=False, invalid_reason="y")
        assert store.coverage()["invalid"] == 1


class TestHistory:
    def _three_sessions(self, store):
        for i, date in enumerate(("2026-01-06", "2026-01-13", "2026-01-20")):
            key = a_session(store, key=f"s{i}", date=date)
            store.add_measurement(key, 4, "left_hip", 60.0 + i * 5, spread=2.0,
                                  samples=200, exercise="bridge")
            confirmed(store, key)

    def test_it_comes_back_oldest_first(self, store):
        self._three_sessions(store)
        assert [r.value for r in store.history("anna")] == [60.0, 65.0, 70.0]

    def test_it_can_be_filtered_by_subject_and_exercise(self, store):
        self._three_sessions(store)
        assert len(store.history("anna", subject="left_hip")) == 3
        assert store.history("anna", subject="right_hip") == []
        assert len(store.history("anna", exercise="bridge")) == 3

    def test_another_person_sees_nothing_of_it(self, store):
        self._three_sessions(store)
        assert store.history("ben") == []

    def test_the_subjects_measured_can_be_listed(self, store):
        self._three_sessions(store)
        assert store.subjects("anna") == ["left_hip"]

    def test_the_session_dates_can_be_listed(self, store):
        self._three_sessions(store)
        assert len(store.session_dates("anna")) == 3


class TestRecurringFindings:
    """Not "your hips were uneven today" but "in five of your last six classes"."""

    def _repeat(self, store, message, times, subject="hip"):
        for i in range(times):
            key = a_session(store, key=f"{message[:4]}{i}", date=f"2026-02-{i + 1:02d}")
            store.add_finding(key, 4, "improve", message, subject=subject,
                              deviation=12.0)
            confirmed(store, key)

    def test_a_repeated_correction_is_surfaced(self, store):
        self._repeat(store, "the hips were not level", 4)
        recurring = store.recurring_findings("anna")
        assert recurring[0]["sessions"] == 4

    def test_a_one_off_is_not(self, store):
        self._repeat(store, "the hips were not level", 1)
        assert store.recurring_findings("anna") == []

    def test_it_reports_when_it_started_and_last_happened(self, store):
        self._repeat(store, "the hips were not level", 3)
        entry = store.recurring_findings("anna")[0]
        assert entry["first_seen"] < entry["last_seen"]

    def test_the_most_persistent_comes_first(self, store):
        self._repeat(store, "the hips were not level", 5)
        self._repeat(store, "the knee drifted inward", 2)
        assert store.recurring_findings("anna")[0]["sessions"] == 5

    def test_only_corrections_count_not_praise(self, store):
        key = a_session(store)
        for _ in range(4):
            store.add_finding(key, 4, "good", "the legs stayed long")
        confirmed(store, key)
        assert store.recurring_findings("anna") == []


class TestCoverage:
    """Measurements piling up against unconfirmed tracks are not data yet."""

    def test_it_reports_the_attributed_share(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "x", 1.0)
        store.add_measurement(key, 5, "x", 1.0)
        confirmed(store, key, track_id=4)
        assert store.coverage()["share"] == pytest.approx(0.5)

    def test_an_empty_store_does_not_divide_by_zero(self, store):
        assert store.coverage()["share"] == 0.0

    def test_it_counts_the_confirmation_queue(self, store):
        key = a_session(store)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        assert store.coverage()["pending_links"] == 1


class TestWhatIsHeld:
    def test_everything_about_a_person_comes_back_in_one_call(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        store.add_finding(key, 4, "improve", "the hips were not level")
        confirmed(store, key)
        export = store.export_person("anna")
        assert export["person"]["display_name"] == "Anna Smith"
        assert export["measurements"] and export["findings"] and export["links"]

    def test_an_unknown_person_exports_an_empty_record_not_an_error(self, store):
        assert store.export_person("nobody")["measurements"] == []

    def test_forgetting_removes_the_measurements_too(self, store):
        """A row saying track 4 had a hip range of 62 degrees is still about
        that person; leaving it because the name column is gone would be
        erasure in name only."""
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        store.add_finding(key, 4, "improve", "x")
        confirmed(store, key)
        removed = store.forget("anna")
        assert removed["measurements"] == 1
        assert removed["findings"] == 1 and removed["links"] == 1
        assert store.coverage()["measurements"] == 0
        assert store.people() == [] or all(p["username"] != "anna"
                                           for p in store.people())

    def test_forgetting_one_person_leaves_another_intact(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "x", 1.0)
        store.add_measurement(key, 5, "x", 2.0)
        confirmed(store, key, track_id=4, username="anna")
        confirmed(store, key, track_id=5, username="ben")
        store.forget("anna")
        assert len(store.history("ben")) == 1

    def test_forgetting_somebody_unknown_is_harmless(self, store):
        assert store.forget("nobody")["links"] == 0


class TestSignatures:
    def test_a_signature_round_trips_through_the_store(self, store):
        signature = Signature({"shoulder_to_torso": 1.2}, frames=40)
        store.save_signature("anna", signature)
        assert store.signature("anna").ratios == {"shoulder_to_torso": 1.2}

    def test_saving_counts_a_confirmation(self, store):
        store.save_signature("anna", Signature({"a": 1.0}, frames=10))
        store.save_signature("anna", Signature({"a": 1.0}, frames=10))
        assert [p for p in store.people()
                if p["username"] == "anna"][0]["confirmations"] == 2

    def test_an_unknown_person_has_an_empty_signature(self, store):
        assert not store.signature("nobody").usable


class TestPersistence:
    def test_a_store_survives_being_closed_and_reopened(self, tmp_path):
        path = tmp_path / "studio.db"
        with Store.open(path) as db:
            db.enrol("anna")
            key = a_session(db)
            db.add_measurement(key, 4, "left_hip", 62.0)
            confirmed(db, key)
        with Store.open(path) as again:
            assert len(again.history("anna")) == 1

    def test_opening_creates_the_folder_and_schema(self, tmp_path):
        with Store.open(tmp_path / "nested" / "studio.db") as db:
            assert db.people() == []


class TestLearningFromConfirmation:
    """Confirming is what makes a shape belong to a person. Learning from an
    unconfirmed link would let one wrong guess drag a signature towards
    somebody else, and every later proposal would inherit the error."""

    def _with_signature(self, store, key, track_id=4):
        signature = Signature({"shoulder_to_torso": 1.2, "hip_to_torso": 0.8,
                               "thigh_to_torso": 1.1, "shank_to_thigh": 1.0},
                              frames=60)
        store.put_link(Link(session=key, track_id=track_id, username=""),
                       signature)
        return signature

    def test_a_signature_is_held_against_the_track_before_anyone_is_named(self, store):
        key = a_session(store)
        self._with_signature(store, key)
        assert store.link_signature(key, 4).usable

    def test_confirming_folds_it_into_the_person(self, store):
        key = a_session(store)
        self._with_signature(store, key)
        assert store.settle(Link(session=key, track_id=4,
                                 username="anna").confirm("teacher"))
        assert store.signature("anna").usable

    def test_a_rejection_teaches_nothing(self, store):
        """It says this shape was *not* that person; the way to use that is to
        stop proposing it, never to average it in."""
        key = a_session(store)
        self._with_signature(store, key)
        assert not store.settle(Link(session=key, track_id=4,
                                     username="anna").reject("teacher"))
        assert not store.signature("anna").usable

    def test_a_proposal_teaches_nothing_until_it_is_confirmed(self, store):
        key = a_session(store)
        self._with_signature(store, key)
        assert not store.settle(Link(session=key, track_id=4, username="anna"))
        assert not store.signature("anna").usable

    def test_confirmations_accumulate_across_sessions(self, store):
        for i in range(3):
            key = a_session(store, key=f"s{i}", date=f"2026-01-0{i + 1}")
            self._with_signature(store, key)
            store.settle(Link(session=key, track_id=4,
                              username="anna").confirm("teacher"))
        assert store.signature("anna").frames == 180

    def test_a_link_with_no_signature_settles_without_error(self, store):
        key = a_session(store)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        assert not store.settle(Link(session=key, track_id=4,
                                     username="anna").confirm("teacher"))

    def test_re_saving_a_link_keeps_the_signature_it_already_had(self, store):
        """Confirming goes through put_link, which must not wipe the shape it
        is about to learn from."""
        key = a_session(store)
        self._with_signature(store, key)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        assert store.link_signature(key, 4).usable


class TestMigration:
    """A store that has been collecting for a year has to stay usable when the
    schema grows. CREATE TABLE IF NOT EXISTS leaves an old table alone."""

    def test_a_missing_column_is_added_rather_than_silently_absent(self, tmp_path):
        import sqlite3

        path = tmp_path / "old.db"
        old = sqlite3.connect(str(path))
        old.executescript(
            "CREATE TABLE links (session_id INTEGER, track_id INTEGER, "
            "username TEXT, status TEXT, method TEXT, distance REAL, "
            "confirmed_by TEXT, confirmed_at TEXT, "
            "PRIMARY KEY (session_id, track_id));")
        old.commit()
        old.close()

        with Store.open(path) as store:
            columns = {r["name"] for r in store.db.execute("PRAGMA table_info(links)")}
            assert "signature" in columns

    def test_an_old_store_still_takes_new_writes(self, tmp_path):
        import sqlite3

        path = tmp_path / "old.db"
        old = sqlite3.connect(str(path))
        old.executescript(
            "CREATE TABLE measurements (id INTEGER PRIMARY KEY, session_id INTEGER, "
            "track_id INTEGER, exercise TEXT, subject TEXT, value REAL, "
            "spread REAL, samples INTEGER, unit TEXT, source TEXT, valid INTEGER, "
            "invalid_reason TEXT);")
        old.commit()
        old.close()

        with Store.open(path) as store:
            store.enrol("anna")
            key = a_session(store)
            store.add_measurement(key, 4, "left_hip", 60.0, at_time=12.5)
            confirmed(store, key)
            assert len(store.history("anna")) == 1


class TestArchiving:
    """Video is discarded, so the pose stream is the record. Everything else in
    a session can be recomputed from it; it can be recomputed from nothing."""

    def _stream(self, track_id=4, n=40):
        import numpy as np

        from pilates.archive import PoseStream
        from conftest import make_detection

        detections = [make_detection(x=100 + i) for i in range(n)]
        return PoseStream(
            track_id=track_id,
            times=(np.arange(n) / 5.0).astype(np.float32),
            points=np.stack([d.keypoints for d in detections]),
            scores=np.stack([d.scores for d in detections]))

    def test_a_stream_is_stored_and_comes_back(self, store):
        key = a_session(store)
        store.save_poses(key, self._stream())
        assert len(store.poses(key, 4)) == 40

    def test_the_size_is_recorded_so_disk_use_is_visible(self, store):
        key = a_session(store)
        written = store.save_poses(key, self._stream())
        assert store.archived_tracks(key)[0]["bytes"] == written

    def test_re_analysing_replaces_rather_than_duplicates(self, store):
        key = a_session(store)
        store.save_poses(key, self._stream())
        store.save_poses(key, self._stream(n=60))
        assert len(store.archived_tracks(key)) == 1
        assert store.archived_tracks(key)[0]["frames"] == 60

    def test_an_unarchived_track_returns_nothing(self, store):
        key = a_session(store)
        assert store.poses(key, 99) is None

    def test_coverage_reports_what_is_archived(self, store):
        key = a_session(store)
        store.save_poses(key, self._stream())
        report = store.coverage()
        assert report["archived_tracks"] == 1
        assert report["archived_frames"] == 40 and report["archive_bytes"] > 0

    def test_forgetting_erases_the_pose_stream_too(self, store):
        """It is the most personal thing held: the shape of their body, frame
        by frame. Erasing without it would not be erasing."""
        key = a_session(store)
        store.save_poses(key, self._stream())
        confirmed(store, key)
        removed = store.forget("anna")
        assert removed["pose_streams"] == 1
        assert store.poses(key, 4) is None


class TestEvents:
    """A measurement says what a quantity was; an event says something happened
    at a time. Without these the record is averages with no account of shape."""

    def test_an_event_is_stored_with_its_time(self, store):
        key = a_session(store)
        store.add_event(key, 4, "repetition", 12.0, 15.5, label="bridge")
        assert store.events(key)[0]["start_s"] == 12.0

    def test_an_unknown_kind_is_refused(self, store):
        key = a_session(store)
        with pytest.raises(ValueError, match="unknown event kind"):
            store.add_event(key, 4, "vibes", 1.0)

    def test_events_come_back_in_time_order(self, store):
        key = a_session(store)
        for t in (9.0, 1.0, 5.0):
            store.add_event(key, 4, "repetition", t)
        assert [e["start_s"] for e in store.events(key)] == [1.0, 5.0, 9.0]

    def test_they_can_be_filtered_by_track_and_kind(self, store):
        key = a_session(store)
        store.add_event(key, 4, "repetition", 1.0)
        store.add_event(key, 5, "adjustment", 2.0)
        assert len(store.events(key, track_id=4)) == 1
        assert len(store.events(key, kind="adjustment")) == 1

    def test_a_span_records_both_ends(self, store):
        key = a_session(store)
        store.add_event(key, 4, "adjustment", 10.0, 14.0, label="leg")
        event = store.events(key)[0]
        assert event["end_s"] == 14.0 and event["label"] == "leg"

    def test_forgetting_erases_events(self, store):
        key = a_session(store)
        store.add_event(key, 4, "repetition", 1.0)
        confirmed(store, key)
        assert store.forget("anna")["events"] == 1


class TestManifest:
    """A number from 2026 cannot be compared with one from 2028 unless
    something says what produced each."""

    def test_the_analysis_records_how_it_was_produced(self, store):
        key = a_session(store)
        store.save_manifest(key, "0.1.0", {"keypoint_threshold": 0.4},
                            source_fps=30.0, stride=6, width=1920, height=1080)
        manifest = store.manifest(key)
        assert manifest["version"] == "0.1.0"
        assert manifest["config"]["keypoint_threshold"] == 0.4
        assert manifest["stride"] == 6

    def test_re_analysing_updates_it(self, store):
        key = a_session(store)
        store.save_manifest(key, "0.1.0", {})
        store.save_manifest(key, "0.2.0", {})
        assert store.manifest(key)["version"] == "0.2.0"

    def test_a_session_without_one_is_counted_as_a_gap(self, store):
        a_session(store)
        assert store.coverage()["sessions_without_manifest"] == 1

    def test_a_session_with_one_is_not(self, store):
        key = a_session(store)
        store.save_manifest(key, "0.1.0", {})
        assert store.coverage()["sessions_without_manifest"] == 0

    def test_an_unanalysed_session_has_no_manifest(self, store):
        assert store.manifest(a_session(store)) is None


class TestExportIsComplete:
    def test_everything_held_includes_events_and_streams(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        store.add_finding(key, 4, "improve", "x")
        store.add_event(key, 4, "repetition", 1.0)
        store.save_poses(key, TestArchiving()._stream())
        confirmed(store, key)
        export = store.export_person("anna")
        for section in ("measurements", "findings", "events", "pose_streams"):
            assert export[section], section
