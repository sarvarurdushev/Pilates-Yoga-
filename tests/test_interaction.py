import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.interaction import (
    CONTACT_DISTANCE, Contact, EQUIPMENT_EFFECT, EquipmentDeclaration,
    MODELLABLE, find_contacts, load_validity, touched_ids,
)
from pilates.types import Detection, TrackedPerson
from conftest import make_detection


def person(track_id, **kwargs):
    return TrackedPerson(track_id=track_id, detection=make_detection(**kwargs))


def reach(subject: TrackedPerson, target: np.ndarray,
          hand: int = kp.R_WRIST) -> TrackedPerson:
    """Put one of this person's hands at a chosen point."""
    points = subject.detection.keypoints.copy()
    points[hand] = target
    return TrackedPerson(
        track_id=subject.track_id,
        detection=Detection(points, subject.detection.scores.copy()),
    )


def _boxes_overlap(a: TrackedPerson, b: TrackedPerson, threshold: float = 0.4) -> bool:
    ax0, ay0, ax1, ay1 = a.detection.bbox(threshold)
    bx0, by0, bx1, by1 = b.detection.bbox(threshold)
    return ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1


def dim(subject: TrackedPerson, *joints: int) -> TrackedPerson:
    scores = subject.detection.scores.copy()
    for joint in joints:
        scores[joint] = 0.05
    return TrackedPerson(
        track_id=subject.track_id,
        detection=Detection(subject.detection.keypoints.copy(), scores),
    )


class TestFindingContacts:
    def test_two_people_apart_are_not_touching(self):
        assert find_contacts([person(1, x=100), person(2, x=600)]) == []

    def test_a_hand_on_a_knee_is_a_contact(self):
        student = person(1, x=100)
        instructor = reach(person(2, x=300), student.detection.keypoints[kp.L_KNEE])
        contacts = find_contacts([student, instructor])
        assert len(contacts) == 1
        assert contacts[0].toucher_id == 2 and contacts[0].touched_id == 1

    def test_overlapping_bodies_without_a_hand_are_not_a_contact(self):
        """One student behind another overlaps in the image constantly. Box
        overlap would call that an adjustment every frame; only the position of
        a hand changes the answer here, and the overlap is identical either
        way."""
        near = person(1, x=100, y=200, width=100, height=300)
        far = person(2, x=150, y=150, width=50, height=120)
        assert _boxes_overlap(near, far)

        # Both of the far student's hands raised well clear of anyone.
        clear = reach(reach(far, np.array([160.0, 20.0]), kp.L_WRIST),
                      np.array([190.0, 20.0]), kp.R_WRIST)
        assert find_contacts([near, clear]) == []

        # Same two bodies, same overlap; one hand moved onto a knee.
        touching = reach(clear, near.detection.keypoints[kp.L_KNEE])
        assert _boxes_overlap(near, touching)
        assert find_contacts([near, touching])

    def test_the_region_is_reported(self):
        student = person(1, x=100)
        cases = {
            kp.L_KNEE: "leg", kp.L_HIP: "hip",
            kp.L_SHOULDER: "shoulder", kp.NOSE: "torso",
        }
        for joint, expected in cases.items():
            instructor = reach(person(2, x=300), student.detection.keypoints[joint])
            contacts = find_contacts([student, instructor])
            assert contacts and contacts[0].region == expected, joint

    def test_an_unseen_hand_cannot_touch_anything(self):
        student = person(1, x=100)
        instructor = dim(reach(person(2, x=300),
                               student.detection.keypoints[kp.L_KNEE]), kp.R_WRIST)
        assert find_contacts([student, instructor]) == []

    def test_a_student_without_a_visible_trunk_is_skipped(self):
        """Distances are scaled by torso length. Without one there is no scale,
        and an unscaled pixel threshold means something different at every
        distance from the camera."""
        student = dim(person(1, x=100), kp.L_SHOULDER, kp.R_SHOULDER)
        instructor = reach(person(2, x=300),
                           student.detection.keypoints[kp.L_KNEE])
        assert find_contacts([student, instructor]) == []

    def test_nobody_touches_themselves(self):
        """Own wrist to own hip is closer than any threshold, every frame."""
        assert find_contacts([person(1, x=100)]) == []

    def test_hand_to_hand_is_not_counted_as_an_adjustment(self):
        """Adjacent arms are the commonest near-miss in a packed room, and a
        hand near a hand does not say who was supporting whom. Only the touched
        student's non-hand joints are candidate contact points."""
        student = person(1, x=100, lying=True)
        instructor = reach(person(2, x=600),
                           student.detection.keypoints[kp.L_WRIST])
        assert find_contacts([student, instructor]) == []

    def test_the_distance_is_scaled_by_body_size(self):
        """The same adjustment at the back of a room is fewer pixels, and must
        still be found."""
        near = person(1, x=100, height=360, width=120)
        far = person(3, x=1000, height=90, width=30)
        for student in (near, far):
            offset = np.array([0.30, 0.0]) * (
                student.detection.keypoints[kp.L_SHOULDER]
                - student.detection.keypoints[kp.L_HIP])
            instructor = reach(person(9, x=2000),
                               student.detection.keypoints[kp.L_KNEE] + offset)
            assert find_contacts([student, instructor]), student.track_id

    def test_the_threshold_is_adjustable(self):
        student = person(1, x=100)
        instructor = reach(person(2, x=300),
                           student.detection.keypoints[kp.L_KNEE] + np.array([0.0, 150.0]))
        assert find_contacts([student, instructor]) == []
        assert find_contacts([student, instructor], contact_distance=3.0)

    def test_touched_ids_collects_everyone_being_adjusted(self):
        contacts = [Contact(9, 1, 0.1, kp.L_HIP), Contact(9, 2, 0.2, kp.L_KNEE)]
        assert touched_ids(contacts) == {1, 2}

    def test_the_default_threshold_is_a_fraction_of_the_torso(self):
        assert 0.0 < CONTACT_DISTANCE < 1.0


class TestEquipment:
    def test_nothing_declared_blocks_nothing(self):
        assert not EquipmentDeclaration().blocks_load

    def test_hand_weights_are_modelled_rather_than_refused(self):
        """Their mass is declared, and they act at a keypoint the camera sees."""
        declaration = EquipmentDeclaration({"hand_weights": 2.0})
        assert not declaration.blocks_load
        assert declaration.added_mass() == {kp.L_WRIST: 2.0, kp.R_WRIST: 2.0}

    def test_ankle_weights_too(self):
        declaration = EquipmentDeclaration({"ankle_weights": 1.5})
        assert declaration.added_mass() == {kp.L_ANKLE: 1.5, kp.R_ANKLE: 1.5}

    def test_a_block_invalidates_the_load(self):
        declaration = EquipmentDeclaration({"block": 0.0})
        assert declaration.blocks_load
        assert declaration.invalidating == ["block"]

    def test_a_reformer_invalidates_it_because_the_mechanics_change(self):
        declaration = EquipmentDeclaration({"reformer": 0.0})
        assert declaration.blocks_load
        assert "mechanics" in EQUIPMENT_EFFECT["reformer"]

    def test_a_band_is_refused_rather_than_guessed(self):
        """Tension varies with stretch and nothing in the image shows it."""
        assert EquipmentDeclaration({"resistance_band": 0.0}).blocks_load

    def test_unknown_equipment_is_refused_rather_than_ignored(self):
        declaration = EquipmentDeclaration({"some_new_gadget": 0.0})
        assert declaration.blocks_load
        assert "not estimated" in declaration.explain()

    def test_the_modellable_set_is_small_and_explicit(self):
        assert MODELLABLE == ("hand_weights", "ankle_weights")

    def test_every_listed_item_says_what_it_does(self):
        for name, effect in EQUIPMENT_EFFECT.items():
            expected = "handled" if name in MODELLABLE else "invalidates load"
            assert effect.startswith(expected), name

    def test_explain_names_the_declared_mass(self):
        assert "2.0 kg" in EquipmentDeclaration({"hand_weights": 2.0}).explain()

    def test_explain_says_so_when_nothing_was_declared(self):
        assert EquipmentDeclaration().explain() == "No equipment declared."

    def test_zero_mass_weights_add_nothing(self):
        assert EquipmentDeclaration({"hand_weights": 0.0}).added_mass() == {}


class TestLoadValidity:
    def test_an_untouched_student_with_no_props_is_measurable(self):
        assert load_validity(1, [])

    def test_a_supported_student_is_not(self):
        """Somebody else's hands are taking part of the moment, by an amount
        nothing in the image reveals."""
        note = load_validity(1, [Contact(9, 1, 0.1, kp.L_KNEE)])
        assert not note
        assert "leg" in note.reason

    def test_a_neighbour_being_adjusted_does_not_invalidate_this_student(self):
        assert load_validity(1, [Contact(9, 2, 0.1, kp.L_KNEE)])

    def test_declared_props_invalidate_it(self):
        note = load_validity(1, [], EquipmentDeclaration({"bolster": 0.0}))
        assert not note
        assert "bolster" in note.reason

    def test_hand_weights_do_not(self):
        assert load_validity(1, [], EquipmentDeclaration({"hand_weights": 2.0}))

    def test_the_reason_explains_itself_to_a_person(self):
        note = load_validity(1, [Contact(9, 1, 0.1, kp.L_HIP)])
        assert "not producing this load alone" in note.reason

    def test_a_valid_note_carries_no_excuse(self):
        assert load_validity(1, []).reason == ""

    def test_it_reads_as_a_boolean(self):
        assert bool(load_validity(1, [])) is True
        assert bool(load_validity(1, [Contact(9, 1, 0.1, kp.L_HIP)])) is False


class TestContactLog:
    """One camera has no depth, so a hand passing in front of somebody further
    back is the same picture as a hand on their shoulder. Duration is what
    separates them."""

    def _log(self, **kwargs):
        from pilates.interaction import ContactLog

        return ContactLog(**kwargs)

    def _hold(self, log, start, end, step=0.1, touched=1, region=kp.L_SHOULDER):
        t = start
        while t <= end + 1e-9:
            log.observe(round(t, 3), [Contact(9, touched, 0.2, region)])
            t += step

    def test_a_brief_near_miss_is_not_an_adjustment(self):
        log = self._log()
        self._hold(log, 0.0, 0.2)
        assert log.adjustments() == []

    def test_a_sustained_contact_is(self):
        log = self._log()
        self._hold(log, 1.0, 4.0)
        adjustments = log.adjustments()
        assert len(adjustments) == 1
        assert adjustments[0].duration == pytest.approx(3.0)

    def test_a_dropped_wrist_does_not_split_one_adjustment_into_five(self):
        log = self._log()
        self._hold(log, 0.0, 1.0)
        self._hold(log, 1.3, 3.0)          # a 0.3s gap: keypoint lost
        assert len(log.adjustments()) == 1

    def test_a_real_gap_does_split_them(self):
        log = self._log()
        self._hold(log, 0.0, 1.0)
        self._hold(log, 9.0, 10.0)
        assert len(log.adjustments()) == 2

    def test_two_students_are_tracked_separately(self):
        log = self._log()
        self._hold(log, 0.0, 2.0, touched=1)
        self._hold(log, 0.0, 2.0, touched=2)
        assert len(log.for_student(1)) == 1
        assert len(log.for_student(2)) == 1

    def test_the_region_is_carried_through(self):
        log = self._log()
        self._hold(log, 0.0, 2.0, region=kp.L_KNEE)
        assert log.adjustments()[0].region == "leg"

    def test_adjusted_at_covers_the_span_and_nothing_outside_it(self):
        log = self._log()
        self._hold(log, 2.0, 5.0)
        assert log.adjusted_at(1, 3.0) is not None
        assert log.adjusted_at(1, 0.5) is None
        assert log.adjusted_at(1, 8.0) is None

    def test_a_student_nobody_touched_has_nothing(self):
        log = self._log()
        self._hold(log, 0.0, 3.0, touched=1)
        assert log.adjusted_at(2, 1.0) is None

    def test_adjustments_are_ordered_by_time(self):
        log = self._log()
        self._hold(log, 5.0, 7.0, touched=2)
        self._hold(log, 0.0, 2.0, touched=1)
        assert [a.start for a in log.adjustments()] == [0.0, 5.0]

    def test_the_minimum_duration_is_adjustable(self):
        log = self._log(min_duration=10.0)
        self._hold(log, 0.0, 3.0)
        assert log.adjustments() == []

    def test_it_describes_itself_for_a_report(self):
        log = self._log()
        self._hold(log, 2.0, 5.0, region=kp.L_HIP)
        text = log.adjustments()[0].describe()
        assert "hip" in text and "3.0s" in text


class TestSessionValidity:
    """The version that guards a student's history. A load measured while
    somebody's hands were on them is a reading of two people."""

    def _log_with(self, start, end, touched=1):
        from pilates.interaction import ContactLog

        log = ContactLog()
        t = start
        while t <= end + 1e-9:
            log.observe(round(t, 3), [Contact(9, touched, 0.2, kp.L_HIP)])
            t += 0.1
        return log

    def test_a_moment_inside_an_adjustment_is_not_valid(self):
        from pilates.interaction import session_validity

        note = session_validity(1, 3.0, self._log_with(2.0, 5.0))
        assert not note
        assert "hip" in note.reason

    def test_a_moment_outside_one_is(self):
        from pilates.interaction import session_validity

        assert session_validity(1, 8.0, self._log_with(2.0, 5.0))

    def test_a_momentary_pass_by_no_longer_invalidates_anything(self):
        """This is the whole reason for the log: the frame-level check refuses
        on a single frame, which over a class would throw away most of it."""
        from pilates.interaction import session_validity

        brief = self._log_with(2.0, 2.2)
        assert session_validity(1, 2.1, brief)
        assert not load_validity(1, [Contact(9, 1, 0.2, kp.L_HIP)])

    def test_equipment_still_blocks_it_regardless_of_time(self):
        from pilates.interaction import session_validity

        assert not session_validity(1, 0.0, None, EquipmentDeclaration({"ball": 0.0}))

    def test_with_neither_a_log_nor_equipment_it_is_valid(self):
        from pilates.interaction import session_validity

        assert session_validity(1, 0.0)
