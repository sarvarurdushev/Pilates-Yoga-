import pytest

from pilates.filters import (
    ExclusionZone, apply_exclusion_zones, drop_sparse, suppress_duplicates,
)
from conftest import make_detection

THR = 0.4


class TestExclusionZones:
    """A reflected instructor scored 0.81 in real footage, so confidence cannot
    be used to reject reflections -- only geometry can."""

    def test_detection_inside_the_mirror_is_excluded(self):
        mirror = ExclusionZone("left_mirror", (0, 0, 430, 1080))
        inside = make_detection(x=100, y=200, width=60, height=400)
        kept, excluded = apply_exclusion_zones([inside], [mirror], THR)
        assert kept == []
        assert excluded == [inside]

    def test_high_confidence_does_not_rescue_a_reflection(self):
        mirror = ExclusionZone("left_mirror", (0, 0, 430, 1080))
        reflection = make_detection(x=50, y=100, width=60, height=400, confidence=0.99)
        kept, excluded = apply_exclusion_zones([reflection], [mirror], THR)
        assert kept == [] and len(excluded) == 1

    def test_detection_outside_the_mirror_survives(self):
        mirror = ExclusionZone("left_mirror", (0, 0, 430, 1080))
        student = make_detection(x=900, y=200, width=60, height=400)
        kept, excluded = apply_exclusion_zones([student], [mirror], THR)
        assert kept == [student] and excluded == []

    def test_partial_overlap_below_threshold_is_kept(self):
        # Only a sliver of this student reaches into the mirror region.
        mirror = ExclusionZone("left_mirror", (0, 0, 430, 1080), min_overlap=0.6)
        straddling = make_detection(x=400, y=200, width=200, height=400)
        kept, _ = apply_exclusion_zones([straddling], [mirror], THR)
        assert kept == [straddling]

    def test_no_zones_configured_keeps_everything(self):
        dets = [make_detection(x=0), make_detection(x=500)]
        kept, excluded = apply_exclusion_zones(dets, [], THR)
        assert kept == dets and excluded == []

    def test_multiple_zones(self):
        zones = [
            ExclusionZone("left_mirror", (0, 0, 430, 1080)),
            ExclusionZone("right_mirror", (1500, 0, 1920, 1080)),
        ]
        left = make_detection(x=50, y=100, width=50, height=300)
        right = make_detection(x=1600, y=100, width=50, height=300)
        middle = make_detection(x=900, y=100, width=50, height=300)
        kept, excluded = apply_exclusion_zones([left, right, middle], zones, THR)
        assert kept == [middle]
        assert len(excluded) == 2


class TestDuplicateSuppression:
    def test_two_skeletons_on_one_body_collapse_to_one(self):
        a = make_detection(x=100, y=100, width=60, height=200, confidence=0.70)
        b = make_detection(x=104, y=103, width=60, height=200, confidence=0.66)
        kept, suppressed = suppress_duplicates([a, b], THR, iou_threshold=0.55)
        assert len(kept) == 1 and len(suppressed) == 1

    def test_the_more_confident_skeleton_wins(self):
        weak = make_detection(x=100, y=100, width=60, height=200, confidence=0.55)
        strong = make_detection(x=103, y=101, width=60, height=200, confidence=0.92)
        kept, _ = suppress_duplicates([weak, strong], THR, iou_threshold=0.55)
        assert kept[0].confidence == pytest.approx(0.92, abs=1e-6)

    def test_two_separate_students_both_survive(self):
        a = make_detection(x=100, y=100, width=60, height=200)
        b = make_detection(x=800, y=100, width=60, height=200)
        kept, suppressed = suppress_duplicates([a, b], THR, iou_threshold=0.55)
        assert len(kept) == 2 and suppressed == []

    def test_adjacent_students_on_neighbouring_mats_are_not_merged(self):
        # Overlapping boxes, but clearly two bodies -- IoU stays under threshold.
        a = make_detection(x=100, y=100, width=100, height=200)
        b = make_detection(x=190, y=100, width=100, height=200)
        kept, _ = suppress_duplicates([a, b], THR, iou_threshold=0.55)
        assert len(kept) == 2

    def test_empty_input(self):
        assert suppress_duplicates([], THR) == ([], [])


class TestDropSparse:
    def test_skeleton_with_too_few_joints_is_dropped(self):
        sparse = make_detection(visible=4)
        assert drop_sparse([sparse], THR, min_visible=8) == []

    def test_complete_skeleton_survives(self):
        full = make_detection()
        assert drop_sparse([full], THR, min_visible=8) == [full]

    def test_boundary_is_inclusive(self):
        det = make_detection(visible=8)
        assert drop_sparse([det], THR, min_visible=8) == [det]


class TestZoneNormalisation:
    def test_list_box_is_coerced_to_tuple(self):
        zone = ExclusionZone("mirror", [0, 0, 430, 1080])
        assert zone.box == (0.0, 0.0, 430.0, 1080.0)
        assert isinstance(zone.box, tuple)

    def test_wrong_length_box_is_rejected(self):
        with pytest.raises(ValueError, match="4 values"):
            ExclusionZone("mirror", (0, 0, 430))
