"""From a measurement to what a teacher should do about it.

The measurement layers stop at "the left shoulder sits 6.2 degrees higher than
the right, corroborated by two photographs". That is true and it is not yet
useful to the person who has to teach the next hour. This module is the step
after: what that means in plain words, which side it is on, how much it matters,
and what a first session might work on.

**Three registers, kept separate, because they carry different weight.**

* *What was measured* is geometry and is checkable. It comes from
  :mod:`pilates.intake` untouched and is never rephrased into something
  stronger than the number supports.
* *What that usually means* is general movement principle. It is not something
  the photographs measured, and it is marked as principle everywhere it is
  shown. A shoulder that sits higher is *often* accompanied by more upper
  trapezius activity on that side; these photographs did not measure muscle
  activity and saying so is not a caveat to be trimmed for space.
* *What to work on* is a teaching suggestion drawn from the studio's own
  repertoire, by key, so the application can open the exercise and show its
  cueing, its contraindications and whether an instructor has reviewed it.

**Nothing here names a condition.** Not scoliosis, not kyphosis, not leg-length
discrepancy, not a "misalignment" to be "corrected". The vocabulary is
positional -- higher, lower, ahead, behind, inward -- because those are the
words the measurement supports, and because a studio is not licensed to
diagnose and neither is a photograph.

**The direction is the part that is easy to get backwards**, and getting it
backwards means telling somebody to strengthen the wrong side for six weeks. So
every sign convention in this module is written out where it is used, traced
back to the metric it came from, and tested. :data:`DIRECTIONS` is the single
place that turns a signed number into a side.

**The advice table is data.** A studio that disagrees -- and a good one will --
edits :data:`ADVICE` rather than the code around it. The exercise keys are the
same keys the browser's library uses, and ``tests/test_guidance.py`` checks
that every one of them still exists, so a repertoire rename cannot quietly turn
a recommendation into a dead link.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from . import alignment as al
from . import intake as ik
from . import scoring
from .intake import PhotoAssessment, Reading

#: Measured outside its normal band, but by less than this, in the metric's own
#: units. Worth recording and not worth building a session around.
WATCH = "watch"
#: Clear of the noise floor: the thing to look at.
NOTABLE = "notable"
#: Far enough out that it is the first thing a teacher will see in the room.
MARKED = "marked"
#: Inside the normal band. Not a finding; reported as unremarkable.
WITHIN = "within_band"

SEVERITIES = (WITHIN, WATCH, NOTABLE, MARKED)

#: Where each severity starts, as a multiple of :data:`pilates.alignment.NOTABLE_DEGREES`
#: for degrees and of :data:`pilates.alignment.RATIO_ZERO_AT` scaled the same way
#: for ratios. One table so the two units cannot drift apart.
_STEP = {"deg": al.NOTABLE_DEGREES,
         "ratio": al.RATIO_ZERO_AT * al.NOTABLE_DEGREES / al.ZERO_AT}


def severity(reading: Reading) -> str:
    """How much of a finding a reading is.

    Graded on the deviation outside the normal band rather than on the raw
    value, so a metric whose neutral point is not zero -- forward head, whose
    band is asymmetric -- is judged against its own band and not against the
    origin.

    **A metric with no band is never a finding.** Torso rotation index is the
    case: shoulders really are wider than hips, by an amount that differs
    between people, so there is no value of it that is by itself remarkable and
    any threshold would be inventing one. It is reported, it is tracked against
    the same student's own earlier assessment, and it does not generate advice.
    """
    if reading.metric.normal is None:
        return WITHIN
    dev = reading.deviation
    if dev is None or dev <= 0:
        return WITHIN
    step = _STEP.get(reading.metric.unit, al.NOTABLE_DEGREES)
    if dev < step:
        return WATCH
    if dev < 2 * step:
        return NOTABLE
    return MARKED


#: Which way a signed measurement points, per metric, with the derivation.
#:
#: Each entry maps a metric to ``(negative direction, positive direction)``.
#: The conventions come from :mod:`pilates.alignment` and every one of them is
#: anatomical rather than image-based -- a COCO model labels the person's left
#: as left from in front and from behind alike -- which is what makes a front
#: and a back photograph two measurements of the same thing.
DIRECTIONS: dict[str, tuple[str, str]] = {
    # Positive is the left ear higher. A head side-bent to the *right* brings
    # the right ear down toward the right shoulder and lifts the left one, so
    # left-ear-high is a head tilted right. Named for the tilt, not the ear,
    # because the tilt is what a teacher cues.
    "head_lateral_tilt": ("head_tilted_left", "head_tilted_right"),
    "shoulder_tilt": ("right_shoulder_high", "left_shoulder_high"),
    "pelvic_obliquity": ("right_hip_high", "left_hip_high"),
    "trunk_lean_lateral": ("trunk_leans_right", "trunk_leans_left"),
    "trunk_lean_sagittal": ("trunk_leans_back", "trunk_leans_forward"),
    "forward_head": ("head_behind_shoulders", "head_ahead_of_shoulders"),
    "left_knee_deviation": ("left_knee_outward", "left_knee_inward"),
    "right_knee_deviation": ("right_knee_outward", "right_knee_inward"),
    "lateral_weight_bias": ("weight_toward_right", "weight_toward_left"),
}


def direction(reading: Reading) -> str:
    """Which of the two named directions this reading points, or "" for neither."""
    pair = DIRECTIONS.get(reading.name)
    if pair is None or reading.value is None:
        return ""
    return pair[1] if reading.value > 0 else pair[0]


#: Two or three words naming which way a measurement points, for a label with
#: no room for a sentence. The chip on a photograph says "shoulder level" and
#: "+12.0°"; without one of these it does not say *which* shoulder, and a
#: report whose pictures do not name a side is a report that gets acted on
#: backwards.
SHORT: dict[str, tuple[str, str]] = {
    "left_shoulder_high": ("left higher", "왼쪽 높음"),
    "right_shoulder_high": ("right higher", "오른쪽 높음"),
    "left_hip_high": ("left higher", "왼쪽 높음"),
    "right_hip_high": ("right higher", "오른쪽 높음"),
    "head_tilted_left": ("tilted left", "왼쪽 기울임"),
    "head_tilted_right": ("tilted right", "오른쪽 기울임"),
    "head_ahead_of_shoulders": ("forward", "앞으로"),
    "head_behind_shoulders": ("back", "뒤로"),
    "trunk_leans_left": ("to the left", "왼쪽으로"),
    "trunk_leans_right": ("to the right", "오른쪽으로"),
    "trunk_leans_forward": ("forward", "앞으로"),
    "trunk_leans_back": ("back", "뒤로"),
    "left_knee_inward": ("inward", "안쪽으로"),
    "right_knee_inward": ("inward", "안쪽으로"),
    "left_knee_outward": ("outward", "바깥쪽으로"),
    "right_knee_outward": ("outward", "바깥쪽으로"),
    "weight_toward_left": ("toward the left", "왼쪽으로"),
    "weight_toward_right": ("toward the right", "오른쪽으로"),
}


#: Metrics whose ratio is not a share of a body length and must not be shown as
#: a percentage. Torso rotation is shoulder span over hip span: 1.6 means the
#: shoulders are 1.6 times as wide, and "160%" invites the reader to think
#: something is 160% of where it should be.
_AS_MULTIPLE = ("torso_rotation_index",)


def format_value(name: str, value: float | None, unit: str) -> str:
    """A measurement as a report shows it, in one place.

    Degrees are degrees. Every other ratio here is a displacement expressed as
    a share of a body length -- a torso height, a leg length, a stance width --
    and ``+0.008`` is a number a reader cannot weigh while ``+1%`` is one they
    can. The bands are converted the same way wherever they are printed, so
    the number and the range it is judged against never end up in different
    units.
    """
    if value is None:
        return "—"
    if unit == "deg":
        return f"{value:+.1f}°"
    if name in _AS_MULTIPLE:
        return f"{value:.2f}\u00d7"
    return f"{value * 100:+.0f}%"


#: The repertoire files the browser reads, so a report names the same exercises
#: the application will open.
_LIBRARY = (Path(__file__).resolve().parent.parent / "web" / "src" / "content"
            / "library")

#: ``{ key: 'clam', ... en: { name: 'Clam' }, ko: { name: '클램' },``
_ENTRY = re.compile(
    r"\{\s*key:\s*'(?P<key>[A-Za-z0-9_-]+)'"
    r"(?P<middle>(?:.|\n){0,400}?)"
    r"en:\s*\{\s*name:\s*'(?P<en>[^']+)'\s*\}\s*,\s*"
    r"ko:\s*\{\s*name:\s*'(?P<ko>[^']+)'\s*\}")


@lru_cache(maxsize=1)
def repertoire() -> dict[str, tuple[str, str]]:
    """Every exercise the application can open, keyed as the browser keys it.

    Read from the browser's own library rather than copied into Python. A
    second list of exercise names here would be a second list to forget, and
    the failure would be silent: a report suggesting an exercise the
    application cannot open, or naming one something the screen calls
    otherwise.

    Missing files are not an error. The Python package can be installed without
    the web application beside it -- a studio running the pipeline headless --
    and a report that falls back to the key is worse than one with names but
    much better than one that will not render.
    """
    out: dict[str, tuple[str, str]] = {}
    for name in ("pilates.js", "yoga.js"):
        path = _LIBRARY / name
        try:
            source = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for match in _ENTRY.finditer(source):
            out.setdefault(match["key"], (match["en"], match["ko"]))
    return out


def exercise_name(key: str, lang: str = "en") -> str:
    """What to print for an exercise key. The key itself, if it is not known."""
    entry = repertoire().get(key)
    if entry is None:
        return key
    return entry[1] if lang == "ko" and entry[1] else entry[0]


@dataclass(frozen=True)
class Suggestion:
    """One exercise from the studio's repertoire, and why it was suggested.

    ``key`` is the key the browser's library uses, so the application opens the
    real entry -- with its cueing, its contraindications and its review status
    -- rather than showing a name this module made up.
    """

    key: str
    discipline: str                 # "pilates" | "yoga"
    why: str
    why_ko: str = ""

    def to_dict(self) -> dict:
        return {"key": self.key, "discipline": self.discipline,
                "name": exercise_name(self.key), "name_ko":
                    exercise_name(self.key, "ko"),
                "why": self.why, "why_ko": self.why_ko}


@dataclass(frozen=True)
class Advice:
    """What a studio does about one direction of one measurement."""

    title: str
    title_ko: str
    #: What the number describes, in the words a student would use.
    means: str
    means_ko: str
    #: What this pattern is *often* accompanied by. General movement principle,
    #: not a measurement, and labelled as such wherever it is shown.
    usually: str = ""
    usually_ko: str = ""
    exercises: tuple[Suggestion, ...] = ()
    #: The everyday habits worth changing. The reference products put these on
    #: cards; they are the part a student can act on between sessions.
    habits: tuple[tuple[str, str], ...] = ()
    caution: str = ""
    caution_ko: str = ""


def _s(key: str, discipline: str, why: str, why_ko: str = "") -> Suggestion:
    return Suggestion(key, discipline, why, why_ko)


# --------------------------------------------------------------- the table
#
# Written per direction rather than per metric: the work for a left shoulder
# sitting high is the mirror of the work for a right one, and a table keyed on
# the metric alone would have to decide sides in code, which is exactly where
# this kind of thing gets reversed.

ADVICE: dict[str, Advice] = {
    "left_shoulder_high": Advice(
        title="Left shoulder sits higher than the right",
        title_ko="왼쪽 어깨가 오른쪽보다 높습니다",
        means="Standing relaxed, the line across the shoulders is not level: "
              "the left one is carried higher.",
        means_ko="편하게 섰을 때 양쪽 어깨를 잇는 선이 수평이 아니며, 왼쪽이 더 높게 "
                 "올라가 있습니다.",
        usually="A shoulder held higher is often accompanied by more upper "
                "trapezius and levator scapulae activity on that side, and by "
                "the opposite side's lower trapezius and serratus anterior "
                "doing less. These photographs measured position, not muscle "
                "activity.",
        usually_ko="한쪽 어깨가 높은 경우 그쪽 위등세모근과 어깨올림근이 더 많이 "
                   "쓰이고, 반대쪽 아래등세모근과 앞톱니근은 덜 쓰이는 경우가 흔합니다. "
                   "이 사진은 위치를 측정한 것이지 근활성도를 측정한 것이 아닙니다.",
        exercises=(
            _s("shoulderPlacement", "pilates",
               "Teaches the shoulder blade to settle down the back before any "
               "arm work, which is where an uneven line is easiest to feel.",
               "팔 동작 전에 어깨뼈를 등 아래쪽으로 안정시키는 법을 익힙니다."),
            _s("threadTheNeedle", "pilates",
               "Opens the upper back and the shoulder blade on the side that "
               "is held high.",
               "높게 올라간 쪽의 등 위쪽과 어깨뼈 주변을 풀어 줍니다."),
            _s("mermaid", "pilates",
               "A side bend to each side makes the difference between them "
               "obvious to the student, not only to the teacher.",
               "좌우 옆굽힘으로 양쪽 차이를 학생 스스로 느끼게 합니다."),
            _s("birdDog", "pilates",
               "Loads one shoulder at a time against a still trunk, so the "
               "weaker side cannot borrow from the other.",
               "몸통을 고정한 채 한쪽씩 부하를 주어 약한 쪽이 보상하지 못하게 합니다."),
            _s("gomukhasana", "yoga",
               "Asymmetric shoulder position; the two sides will not feel the "
               "same, which is the information.",
               "좌우 비대칭 어깨 자세로, 양쪽 느낌 차이가 곧 정보가 됩니다."),
        ),
        habits=(
            ("Carry a bag on the other side, or across the body.",
             "가방을 반대쪽으로 메거나 크로스로 메세요."),
            ("At a desk, set both forearms at the same height — an armrest on "
             "one side only lifts that shoulder all day.",
             "책상에서 양쪽 팔을 같은 높이에 두세요. 한쪽만 팔걸이를 쓰면 하루 종일 "
             "그쪽 어깨가 올라갑니다."),
            ("Check which side you hold a phone on.",
             "휴대전화를 어느 쪽으로 드는지 확인해 보세요."),
        ),
    ),
    "left_hip_high": Advice(
        title="Left hip sits higher than the right",
        title_ko="왼쪽 골반이 오른쪽보다 높습니다",
        means="The line across the top of the pelvis is not level in standing; "
              "the left side is carried higher.",
        means_ko="선 자세에서 골반 위쪽을 잇는 선이 수평이 아니며, 왼쪽이 더 높습니다.",
        usually="A pelvis held unlevel in standing is often accompanied by a "
                "difference in how the two hip abductors work, and by more "
                "weight through one leg. It can also come from standing habit "
                "rather than from the body itself, which is why it is worth "
                "re-photographing on another day.",
        usually_ko="선 자세에서 골반이 기울어져 있으면 양쪽 엉덩벌림근 사용 차이나 "
                   "한쪽 다리 체중 쏠림이 함께 나타나는 경우가 많습니다. 몸 자체보다 "
                   "서는 습관 때문일 수도 있어 다른 날 다시 촬영해 보는 것이 좋습니다.",
        exercises=(
            _s("clam", "pilates",
               "Isolates the deep hip rotators and the gluteus medius one side "
               "at a time.",
               "한쪽씩 엉덩관절 심부 회전근과 중간볼기근을 분리해 씁니다."),
            _s("sideLyingLegLift", "pilates",
               "Direct work for the hip abductor that holds the pelvis level "
               "in single-leg stance.",
               "한 다리로 설 때 골반 수평을 유지하는 벌림근을 직접 단련합니다."),
            _s("pelvicCurl", "pilates",
               "Restores even movement through the pelvis and the low back "
               "before adding load.",
               "부하를 더하기 전에 골반과 허리의 균등한 움직임을 회복합니다."),
            _s("utthitaPadangusthaBalance", "yoga",
               "Single-leg balance shows immediately which side lets the "
               "pelvis drop.",
               "한 다리 균형으로 어느 쪽에서 골반이 떨어지는지 바로 드러납니다."),
        ),
        habits=(
            ("Notice which hip you rest on when you stand and wait.",
             "서서 기다릴 때 어느 쪽 골반에 기대는지 살펴보세요."),
            ("Avoid sitting on a wallet or a phone in a back pocket.",
             "뒷주머니에 지갑이나 휴대전화를 넣고 앉지 마세요."),
            ("Carrying a child on one hip is the most common single cause "
             "worth changing.",
             "아이를 한쪽 골반에 올려 안는 습관이 가장 흔한 원인입니다."),
        ),
    ),
    "head_tilted_right": Advice(
        title="Head tilted toward the right shoulder",
        title_ko="머리가 오른쪽 어깨 쪽으로 기울어 있습니다",
        means="The line between the ears is not level: the right ear sits "
              "closer to the right shoulder.",
        means_ko="양쪽 귀를 잇는 선이 수평이 아니며, 오른쪽 귀가 오른쪽 어깨에 더 "
                 "가깝습니다.",
        usually="A habitual head tilt is often accompanied by a shortened "
                "side-bending group on the side the head leans toward. Where a "
                "shoulder difference was measured on the same side, the two are "
                "usually worth treating as one pattern rather than separately.",
        usually_ko="습관적인 머리 기울임은 기울어진 쪽 목 옆굽힘 근육이 짧아져 있는 "
                   "경우가 많습니다. 같은 쪽 어깨 차이가 함께 측정되었다면 두 가지를 "
                   "하나의 패턴으로 보는 편이 낫습니다.",
        exercises=(
            _s("headNods", "pilates",
               "Re-teaches the small deep neck flexors before any load, which "
               "is where head position is actually held.",
               "부하를 주기 전에 목 심부 굽힘근의 작은 움직임을 다시 익힙니다."),
            _s("shoulderPlacement", "pilates",
               "The neck cannot be organised over shoulders that are not.",
               "어깨가 정리되지 않으면 목도 정리되지 않습니다."),
            _s("bhramari", "yoga",
               "A seated breath practice with the neck long; useful when the "
               "tilt increases under stress.",
               "목을 길게 둔 좌위 호흡. 긴장할 때 기울임이 심해지는 경우에 좋습니다."),
        ),
        habits=(
            ("Check the height of a monitor: one set low or off to the side "
             "produces exactly this.",
             "모니터 높이를 확인하세요. 낮거나 옆으로 치우친 배치가 바로 이 자세를 "
             "만듭니다."),
            ("Do not hold a phone between ear and shoulder.",
             "휴대전화를 귀와 어깨 사이에 끼우지 마세요."),
        ),
    ),
    "head_ahead_of_shoulders": Advice(
        title="Head carried ahead of the shoulders",
        title_ko="머리가 어깨보다 앞으로 나와 있습니다",
        means="Seen from the side, the ear sits forward of the point of the "
              "shoulder rather than above it.",
        means_ko="옆에서 보았을 때 귀가 어깨 위가 아니라 앞쪽에 있습니다.",
        usually="A head carried forward is often accompanied by more work in "
                "the neck extensors and less in the deep neck flexors, and it "
                "frequently sits alongside a rounded upper back. This is a "
                "position measured from a photograph, not a measurement of "
                "muscle or of the spine itself.",
        usually_ko="머리가 앞으로 나오면 목 폄근이 더 많이 쓰이고 심부 굽힘근은 덜 "
                   "쓰이는 경우가 많으며, 등 위쪽이 둥글게 말린 자세와 함께 나타나는 "
                   "일이 잦습니다. 이는 사진에서 측정한 위치이며 근육이나 척추 자체를 "
                   "측정한 것이 아닙니다.",
        exercises=(
            _s("headNods", "pilates",
               "The deep neck flexors, taught without lifting the head — the "
               "first thing to restore.",
               "머리를 들지 않고 목 심부 굽힘근을 먼저 회복시킵니다."),
            _s("swan", "pilates",
               "Extension through the upper back, which is usually where the "
               "room for the head to come back has to come from.",
               "머리가 제자리로 돌아올 공간은 대개 등 위쪽 폄에서 나옵니다."),
            _s("breastStroke", "pilates",
               "Upper-back extension with the shoulder blades working, rather "
               "than the neck doing the lifting.",
               "목이 아니라 어깨뼈가 일하며 등 위쪽을 폅니다."),
            _s("anahatasana", "yoga",
               "Opens the front of the chest and the upper back without "
               "loading the neck.",
               "목에 부담 없이 가슴 앞쪽과 등 위쪽을 엽니다."),
            _s("sphinx", "yoga",
               "A gentle, supported version of the same extension.",
               "같은 폄 동작의 부드럽고 지지된 형태입니다."),
        ),
        habits=(
            ("Raise the top of a screen to eye level.",
             "화면 상단을 눈높이에 맞추세요."),
            ("Hold a phone up rather than looking down at it.",
             "휴대전화를 내려다보지 말고 올려서 보세요."),
            ("Stand up from a desk every half hour; the position returns "
               "faster than it is trained away.",
             "30분마다 자리에서 일어나세요. 자세는 훈련보다 빨리 되돌아옵니다."),
        ),
    ),
    "head_behind_shoulders": Advice(
        title="Head carried behind the line of the shoulders",
        title_ko="머리가 어깨선보다 뒤에 있습니다",
        means="Seen from the side, the ear sits behind the point of the "
              "shoulder. This is the less common direction and is worth "
              "checking against the photograph before acting on it.",
        means_ko="옆에서 보았을 때 귀가 어깨보다 뒤에 있습니다. 드문 방향이므로 "
                 "조치를 취하기 전에 사진을 다시 확인하는 것이 좋습니다.",
        usually="Most often this is the photograph rather than the body: a "
                "student told to stand up straight will pull the chin back and "
                "hold it there for the shot. Re-take it with the student "
                "looking at a point on the far wall and walking on the spot "
                "twice first.",
        usually_ko="대부분 몸보다는 촬영 때문입니다. '똑바로 서세요'라는 말에 턱을 "
                   "당긴 채로 찍히는 경우가 많습니다. 먼 벽의 한 점을 보게 하고 제자리 "
                   "걸음을 두 번 시킨 뒤 다시 촬영하세요.",
        exercises=(
            _s("headNods", "pilates",
               "Restores a neutral head position rather than a held one.",
               "고정된 자세가 아니라 중립적인 머리 위치를 회복합니다."),
        ),
        habits=(("Stand as you normally stand for the photograph, not as you "
                 "think you should.",
                 "사진 촬영 시 '바르게'가 아니라 평소대로 서세요."),),
    ),
    "trunk_leans_left": Advice(
        title="Trunk carried toward the left",
        title_ko="몸통이 왼쪽으로 치우쳐 있습니다",
        means="The line from the middle of the hips to the middle of the "
              "shoulders is off vertical, toward the left.",
        means_ko="골반 중앙에서 어깨 중앙으로 이어지는 선이 수직에서 왼쪽으로 "
                 "기울어 있습니다.",
        usually="A trunk carried to one side in standing is usually the same "
                "pattern as an unlevel pelvis seen from a different angle. "
                "Where both were measured, work the pelvis first.",
        usually_ko="선 자세에서 몸통이 한쪽으로 치우친 것은 대개 골반 기울기와 같은 "
                   "패턴을 다른 각도에서 본 것입니다. 둘 다 측정되었다면 골반을 먼저 "
                   "다루세요.",
        exercises=(
            _s("sideBend", "pilates",
               "Loads both sides of the trunk evenly and shows which one "
               "gives way.",
               "몸통 양쪽에 고르게 부하를 주어 어느 쪽이 무너지는지 보여 줍니다."),
            _s("mermaid", "pilates",
               "Length through the side of the trunk, taught rather than "
               "forced.",
               "몸통 옆면의 길이를 억지로가 아니라 익히도록 합니다."),
            _s("sideKickUpDown", "pilates",
               "Hip abductors on both sides against a still trunk.",
               "몸통을 고정한 채 양쪽 엉덩벌림근을 씁니다."),
            _s("trikonasana", "yoga",
               "Makes the difference between the two sides plain.",
               "좌우 차이를 분명하게 드러냅니다."),
        ),
        habits=(("Notice which side you lean on at a counter or a desk.",
                 "카운터나 책상에서 어느 쪽으로 기대는지 살펴보세요."),),
    ),
    "trunk_leans_forward": Advice(
        title="Trunk carried forward of vertical",
        title_ko="몸통이 수직보다 앞으로 기울어 있습니다",
        means="Seen from the side, the shoulders sit ahead of the hips rather "
              "than stacked above them.",
        means_ko="옆에서 보았을 때 어깨가 골반 위가 아니라 앞쪽에 있습니다.",
        usually="Standing with the trunk forward is often accompanied by more "
                "work through the calves and the low back to stay upright. It "
                "also shifts where the load sits in every standing exercise, "
                "which is why it is worth addressing before adding load.",
        usually_ko="몸통이 앞으로 기운 자세는 버티기 위해 종아리와 허리가 더 많이 "
                   "일하는 경우가 많습니다. 모든 선 자세 운동에서 부하 위치가 달라지므로 "
                   "부하를 더하기 전에 다루는 것이 좋습니다.",
        exercises=(
            _s("rollDownStanding", "pilates",
               "Finds vertical from the top down, a segment at a time.",
               "위에서부터 한 마디씩 수직을 찾아갑니다."),
            _s("swan", "pilates",
               "Extension through the upper back and the hip flexors it "
               "usually needs.",
               "등 위쪽 폄과 그에 필요한 엉덩굽힘근을 함께 다룹니다."),
            _s("setuBandha", "yoga",
               "Opens the front of the hips, which is commonly where a "
               "forward trunk is anchored.",
               "앞으로 기운 몸통이 붙잡혀 있는 엉덩관절 앞쪽을 엽니다."),
            _s("salabhasana", "yoga",
               "Back-body strength to hold the new position rather than only "
               "reach it.",
               "새 자세에 도달만 하지 않고 유지할 뒷몸 힘을 기릅니다."),
        ),
        habits=(("Check the seat height at a desk: knees far below the hips "
                 "tips the trunk forward before you stand up.",
                 "의자 높이를 확인하세요. 무릎이 골반보다 많이 낮으면 일어서기 전부터 "
                 "몸통이 앞으로 기웁니다."),),
    ),
    "trunk_leans_back": Advice(
        title="Trunk carried behind vertical",
        title_ko="몸통이 수직보다 뒤로 기울어 있습니다",
        means="Seen from the side, the shoulders sit behind the hips.",
        means_ko="옆에서 보았을 때 어깨가 골반보다 뒤에 있습니다.",
        usually="Often accompanied by the pelvis pushed forward and the ribs "
                "lifted. The measurement here is the trunk line only; the rib "
                "and pelvis positions that usually go with it are not "
                "something a 17-point landmark model can see.",
        usually_ko="골반이 앞으로 밀리고 갈비뼈가 들리는 자세와 함께 나타나는 경우가 "
                   "많습니다. 여기서 측정한 것은 몸통 선뿐이며, 함께 나타나는 갈비뼈와 "
                   "골반 위치는 17점 랜드마크 모델이 볼 수 없습니다.",
        exercises=(
            _s("imprintRelease", "pilates",
               "Teaches the pelvis to move rather than be held at one end of "
               "its range.",
               "골반을 한쪽 끝에 고정하지 않고 움직이도록 가르칩니다."),
            _s("deadBug", "pilates",
               "Holds the ribs down while the limbs move, which is the "
               "control this pattern lacks.",
               "팔다리가 움직이는 동안 갈비뼈를 눌러 두는 조절력을 기릅니다."),
            _s("rollDownStanding", "pilates",
               "Finds vertical without the student bracing into it.",
               "힘을 주지 않고 수직을 찾습니다."),
        ),
        habits=(("Standing with the weight hung on the front of the hips is "
                 "the habit; unlock the knees slightly.",
                 "골반 앞쪽에 체중을 걸고 서는 습관입니다. 무릎을 살짝 풀어 주세요."),),
    ),
    "left_knee_inward": Advice(
        title="Left knee tracks inward of the hip-to-ankle line",
        title_ko="왼쪽 무릎이 엉덩–발목 선보다 안쪽으로 들어갑니다",
        means="In standing, the left knee sits toward the midline of the body "
              "rather than on the line between the hip and the ankle.",
        means_ko="선 자세에서 왼쪽 무릎이 엉덩관절과 발목을 잇는 선이 아니라 몸 "
                 "중앙 쪽으로 들어와 있습니다.",
        usually="A knee that falls inward is often accompanied by less hip "
                "abductor and external rotator control on that side, and by "
                "the arch of the foot flattening. The foot is not measured "
                "here — a 17-point model marks the ankle and nothing below it.",
        usually_ko="무릎이 안쪽으로 무너지면 그쪽 엉덩벌림근과 바깥돌림근 조절이 "
                   "부족하고 발 아치가 낮아지는 경우가 많습니다. 발은 여기서 측정되지 "
                   "않았습니다 — 17점 모델은 발목까지만 표시합니다.",
        exercises=(
            _s("clam", "pilates",
               "The hip external rotators, isolated, before any standing load.",
               "선 자세 부하 전에 엉덩관절 바깥돌림근을 분리해 씁니다."),
            _s("sideLyingLegLift", "pilates",
               "The abductor that keeps the knee out over the foot.",
               "무릎을 발 위에 두게 하는 벌림근을 단련합니다."),
            _s("chairFootwork", "pilates",
               "Loads the leg with the alignment visible and correctable.",
               "정렬을 보면서 교정할 수 있는 상태로 다리에 부하를 줍니다."),
            _s("utkatasana", "yoga",
               "Two-legged load where the knee position can be cued directly.",
               "양다리 부하 상태에서 무릎 위치를 직접 큐잉할 수 있습니다."),
        ),
        habits=(("Watch the knee on the way down into a chair — that is the "
                 "same movement under load.",
                 "의자에 앉을 때 무릎을 보세요. 부하가 실린 같은 동작입니다."),),
    ),
    "right_knee_inward": Advice(
        title="Right knee tracks inward of the hip-to-ankle line",
        title_ko="오른쪽 무릎이 엉덩–발목 선보다 안쪽으로 들어갑니다",
        means="In standing, the right knee sits toward the midline of the body "
              "rather than on the line between the hip and the ankle.",
        means_ko="선 자세에서 오른쪽 무릎이 엉덩관절과 발목을 잇는 선이 아니라 몸 "
                 "중앙 쪽으로 들어와 있습니다.",
        usually="A knee that falls inward is often accompanied by less hip "
                "abductor and external rotator control on that side, and by "
                "the arch of the foot flattening. The foot is not measured "
                "here — a 17-point model marks the ankle and nothing below it.",
        usually_ko="무릎이 안쪽으로 무너지면 그쪽 엉덩벌림근과 바깥돌림근 조절이 "
                   "부족하고 발 아치가 낮아지는 경우가 많습니다. 발은 여기서 측정되지 "
                   "않았습니다 — 17점 모델은 발목까지만 표시합니다.",
        exercises=(
            _s("clam", "pilates",
               "The hip external rotators, isolated, before any standing load.",
               "선 자세 부하 전에 엉덩관절 바깥돌림근을 분리해 씁니다."),
            _s("sideLyingLegLift", "pilates",
               "The abductor that keeps the knee out over the foot.",
               "무릎을 발 위에 두게 하는 벌림근을 단련합니다."),
            _s("chairFootwork", "pilates",
               "Loads the leg with the alignment visible and correctable.",
               "정렬을 보면서 교정할 수 있는 상태로 다리에 부하를 줍니다."),
            _s("utkatasana", "yoga",
               "Two-legged load where the knee position can be cued directly.",
               "양다리 부하 상태에서 무릎 위치를 직접 큐잉할 수 있습니다."),
        ),
        habits=(("Watch the knee on the way down into a chair — that is the "
                 "same movement under load.",
                 "의자에 앉을 때 무릎을 보세요. 부하가 실린 같은 동작입니다."),),
    ),
    "left_knee_outward": Advice(
        title="Left knee tracks outside the hip-to-ankle line",
        title_ko="왼쪽 무릎이 엉덩–발목 선보다 바깥쪽으로 벌어집니다",
        means="In standing, the left knee sits away from the midline relative "
              "to the line between the hip and the ankle.",
        means_ko="선 자세에서 왼쪽 무릎이 엉덩–발목 선보다 바깥쪽에 있습니다.",
        usually="Less common than the inward direction and more often a "
                "standing habit or a wide stance than anything else. Check the "
                "foot position in the photograph before treating it as a "
                "finding.",
        usually_ko="안쪽으로 무너지는 경우보다 드물며, 대개 서는 습관이나 넓은 보폭 "
                   "때문입니다. 소견으로 다루기 전에 사진에서 발 위치를 확인하세요.",
        exercises=(
            _s("chairFootwork", "pilates",
               "Loads the leg with the alignment visible and correctable.",
               "정렬을 보면서 교정할 수 있는 상태로 다리에 부하를 줍니다."),
            _s("sideLyingInnerThigh", "pilates",
               "The adductors, which are usually the quiet half of this "
               "pattern.",
               "이 패턴에서 대개 덜 쓰이는 모음근을 단련합니다."),
        ),
        habits=(("Set the feet under the hips for the photograph; a wide "
                 "stance produces this on its own.",
                 "촬영 시 발을 골반 너비에 두세요. 넓게 서면 그것만으로 이 결과가 "
                 "나옵니다."),),
    ),
    "right_knee_outward": Advice(
        title="Right knee tracks outside the hip-to-ankle line",
        title_ko="오른쪽 무릎이 엉덩–발목 선보다 바깥쪽으로 벌어집니다",
        means="In standing, the right knee sits away from the midline relative "
              "to the line between the hip and the ankle.",
        means_ko="선 자세에서 오른쪽 무릎이 엉덩–발목 선보다 바깥쪽에 있습니다.",
        usually="Less common than the inward direction and more often a "
                "standing habit or a wide stance than anything else. Check the "
                "foot position in the photograph before treating it as a "
                "finding.",
        usually_ko="안쪽으로 무너지는 경우보다 드물며, 대개 서는 습관이나 넓은 보폭 "
                   "때문입니다. 소견으로 다루기 전에 사진에서 발 위치를 확인하세요.",
        exercises=(
            _s("chairFootwork", "pilates",
               "Loads the leg with the alignment visible and correctable.",
               "정렬을 보면서 교정할 수 있는 상태로 다리에 부하를 줍니다."),
            _s("sideLyingInnerThigh", "pilates",
               "The adductors, which are usually the quiet half of this "
               "pattern.",
               "이 패턴에서 대개 덜 쓰이는 모음근을 단련합니다."),
        ),
        habits=(("Set the feet under the hips for the photograph; a wide "
                 "stance produces this on its own.",
                 "촬영 시 발을 골반 너비에 두세요. 넓게 서면 그것만으로 이 결과가 "
                 "나옵니다."),),
    ),
    "weight_toward_left": Advice(
        title="Upper body carried toward the left foot",
        title_ko="상체가 왼발 쪽으로 쏠려 있습니다",
        means="The middle of the shoulders sits toward the left of the middle "
              "of the feet. This is where the torso stands, not where the load "
              "goes — a camera cannot measure weight.",
        means_ko="어깨 중앙이 양발 중앙보다 왼쪽에 있습니다. 이는 몸통이 서 있는 "
                 "위치이지 체중이 실리는 위치가 아닙니다 — 카메라는 하중을 측정할 수 "
                 "없습니다.",
        usually="Standing habitually on one leg is common and is usually the "
                "same pattern as an unlevel pelvis. A force plate measures "
                "weight distribution; this does not.",
        usually_ko="한쪽 다리로 서는 습관은 흔하며 대개 골반 기울기와 같은 패턴입니다. "
                   "체중 분포는 힘판으로 측정하며, 이 방법으로는 측정할 수 없습니다.",
        exercises=(
            _s("vrksasana", "yoga",
               "Single-leg balance on each side, compared.",
               "양쪽 한 다리 균형을 비교합니다."),
            _s("sideLyingLegLift", "pilates",
               "The abductor on the side that is being avoided.",
               "덜 쓰는 쪽 벌림근을 단련합니다."),
            _s("rollDownStanding", "pilates",
               "Returns to standing with the weight evenly placed.",
               "체중을 고르게 둔 상태로 선 자세로 돌아옵니다."),
        ),
        habits=(("Standing on one leg while waiting is the habit; change "
                 "sides deliberately, or stand on both.",
                 "기다릴 때 한 다리로 서는 습관입니다. 의식적으로 바꾸거나 양발로 "
                 "서세요."),),
    ),
}


def _mirror(source: str, target: str, swaps: tuple[tuple[str, str], ...]) -> None:
    """Write the opposite-side entry from one already written.

    The advice for a right shoulder sitting high is the left one with the sides
    exchanged, and typing it out twice is how the two copies end up saying
    different things. The swap list is explicit rather than a general
    left/right substitution because "left" appears inside exercise names and
    Korean particles attach to the word.
    """
    base = ADVICE[source]

    def swap(text: str) -> str:
        out = text
        for a, b in swaps:
            out = out.replace(a, "\x00").replace(b, a).replace("\x00", b)
        return out

    ADVICE[target] = Advice(
        title=swap(base.title), title_ko=swap(base.title_ko),
        means=swap(base.means), means_ko=swap(base.means_ko),
        usually=base.usually, usually_ko=base.usually_ko,
        exercises=base.exercises,
        habits=base.habits,
        caution=base.caution, caution_ko=base.caution_ko)


_SIDE_WORDS = (("left", "right"), ("Left", "Right"), ("왼쪽", "오른쪽"), ("왼발", "오른발"))
_mirror("left_shoulder_high", "right_shoulder_high", _SIDE_WORDS)
_mirror("left_hip_high", "right_hip_high", _SIDE_WORDS)
_mirror("head_tilted_right", "head_tilted_left", _SIDE_WORDS)
_mirror("trunk_leans_left", "trunk_leans_right", _SIDE_WORDS)
_mirror("weight_toward_left", "weight_toward_right", _SIDE_WORDS)


@dataclass(frozen=True)
class Finding:
    """One measurement that is outside its normal band, and what to do."""

    reading: Reading
    region: str
    severity: str
    direction: str
    advice: Advice | None

    @property
    def name(self) -> str:
        return self.reading.name

    @property
    def measurement(self) -> str:
        """The number, its units and the band it is being judged against."""
        return self.measurement_text()

    def measurement_text(self, lang: str = "en") -> str:
        """The number and its range, in one language.

        The digits are the digits; what changes is the word for the range. A
        Korean report carrying an English parenthetical is the half-translation
        this codebase avoids elsewhere and would avoid here by accident
        otherwise, because the number looks language-neutral and the bracket
        after it does not.
        """
        metric = self.reading.metric
        if metric.value is None:
            return "측정되지 않음" if lang == "ko" else "not measured"
        text = format_value(metric.name, metric.value, metric.unit)
        if not metric.normal:
            return text
        low, high = metric.normal
        low_text = format_value(metric.name, low, metric.unit)
        high_text = format_value(metric.name, high, metric.unit)
        if lang == "ko":
            return f"{text} (정상 범위 {low_text} ~ {high_text})"
        return f"{text} (unremarkable {low_text} to {high_text})"

    def title(self, lang: str = "en") -> str:
        if self.advice is None:
            return self.name.replace("_", " ")
        return self.advice.title_ko if lang == "ko" and self.advice.title_ko \
            else self.advice.title

    def to_dict(self) -> dict:
        advice = self.advice
        return {
            "metric": self.name,
            "region": self.region,
            "severity": self.severity,
            "direction": self.direction,
            "measurement": self.measurement,
            "measurement_ko": self.measurement_text("ko"),
            "short": SHORT.get(self.direction, ("", ""))[0],
            "short_ko": SHORT.get(self.direction, ("", ""))[1],
            "display": format_value(self.name, self.reading.value,
                                    self.reading.metric.unit),
            "value": self.reading.value,
            "unit": self.reading.metric.unit,
            "deviation": (None if self.reading.deviation is None
                          else round(self.reading.deviation, 3)),
            "confidence": round(self.reading.metric.confidence, 3),
            "evidence": self.reading.evidence(),
            "evidence_ko": self.reading.evidence("ko"),
            "corroborated": self.reading.corroborated,
            "contested": self.reading.contested,
            "title": advice.title if advice else self.name.replace("_", " "),
            "title_ko": advice.title_ko if advice else "",
            "means": advice.means if advice else "",
            "means_ko": advice.means_ko if advice else "",
            "usually": advice.usually if advice else "",
            "usually_ko": advice.usually_ko if advice else "",
            "exercises": [s.to_dict() for s in (advice.exercises if advice else ())],
            "habits": [{"en": a, "ko": b} for a, b in (advice.habits if advice else ())],
            "caution": advice.caution if advice else "",
            "caution_ko": advice.caution_ko if advice else "",
        }


#: Order severities worst-first without sorting on the string.
_RANK = {MARKED: 0, NOTABLE: 1, WATCH: 2, WITHIN: 3}

#: Which region each metric belongs to, inverted from the alignment layer's
#: table so a region added there reaches the report without a second edit.
_REGION_OF: dict[str, str] = {name: region
                              for region, names in al.REGIONS.items()
                              for name in names}


def findings(assessment: PhotoAssessment, *,
             include_watch: bool = True) -> list[Finding]:
    """Every measurement outside its normal band, worst first.

    ``include_watch`` keeps the ones that are outside the band but below the
    noise floor. They belong on a report -- a studio tracking somebody over six
    months wants to see a two-degree difference before it becomes a six-degree
    one -- and they must never be presented at the same weight as the rest,
    which is what :func:`severity` is for.
    """
    out: list[Finding] = []
    for name, reading in assessment.readings.items():
        if not reading.measured:
            continue
        grade = severity(reading)
        if grade is WITHIN or (grade == WATCH and not include_watch):
            continue
        way = direction(reading)
        out.append(Finding(reading, _REGION_OF.get(name, "other"), grade, way,
                           ADVICE.get(way)))
    out.sort(key=lambda f: (_RANK[f.severity], -(f.reading.deviation or 0.0)))
    return out


def priorities(found: list[Finding], limit: int = 4) -> list[Finding]:
    """What to work on first, one finding per region.

    A list of four things from four parts of the body is a plan; a list of four
    things that are all the same shoulder is the same finding written out four
    times. Regions are visited worst-first, and a second finding from a region
    already represented waits for the next pass.
    """
    chosen: list[Finding] = []
    seen: set[str] = set()
    for finding in found:
        if finding.region in seen:
            continue
        chosen.append(finding)
        seen.add(finding.region)
        if len(chosen) >= limit:
            return chosen
    for finding in found:                      # second pass, if there is room
        if finding not in chosen:
            chosen.append(finding)
            if len(chosen) >= limit:
                break
    return chosen


def programme(found: list[Finding], limit: int = 8) -> list[dict]:
    """One session's worth of exercises, drawn from the findings.

    Two rules, and both of them are about what a coach would actually plan:

    * **Round-robin, not depth-first.** Taking the first eight suggestions in
      finding order fills the whole session from the worst one or two findings
      and never reaches the third. So each finding contributes one exercise
      before any finding contributes a second, worst finding first within each
      pass. A session that touches every finding beats a session that
      exhausts one.
    * **An exercise suggested twice is one exercise with two reasons.** The
      reasons accumulate onto the entry and the entry rises, because something
      that answers two findings at once is the best thing in the list.
    """
    entries: dict[str, dict] = {}
    order: list[str] = []
    lists = [(f, list(f.advice.exercises)) for f in found if f.advice]
    depth = max((len(e) for _, e in lists), default=0)
    for pass_number in range(depth):
        for finding, suggestions in lists:
            if pass_number >= len(suggestions):
                continue
            suggestion = suggestions[pass_number]
            entry = entries.get(suggestion.key)
            if entry is None:
                entry = {"key": suggestion.key,
                         "discipline": suggestion.discipline,
                         "name": exercise_name(suggestion.key),
                         "name_ko": exercise_name(suggestion.key, "ko"),
                         "why": [], "why_ko": [], "for": []}
                entries[suggestion.key] = entry
                order.append(suggestion.key)
            if suggestion.why not in entry["why"]:
                entry["why"].append(suggestion.why)
                entry["why_ko"].append(suggestion.why_ko)
            if finding.name not in entry["for"]:
                entry["for"].append(finding.name)
    ranked = sorted(order, key=lambda k: (-len(entries[k]["for"]), order.index(k)))
    return [entries[k] for k in ranked[:limit]]


def habits(found: list[Finding], limit: int = 6) -> list[dict]:
    """The everyday changes, de-duplicated, in finding order."""
    out: list[dict] = []
    seen: set[str] = set()
    for finding in found:
        if finding.advice is None:
            continue
        for english, korean in finding.advice.habits:
            if english in seen:
                continue
            seen.add(english)
            out.append({"en": english, "ko": korean, "for": finding.name})
            if len(out) >= limit:
                return out
    return out


#: What each measurement is called on a page, rather than in a payload.
#:
#: Both languages, and every metric the alignment layer can produce -- including
#: the two it can only ever refuse. A refusal shown under its variable name is a
#: refusal a reader skips.
METRIC_NAME: dict[str, tuple[str, str]] = {
    "head_lateral_tilt": ("head tilt", "머리 기울기"),
    "forward_head": ("head carried forward", "머리 전방 이동"),
    "shoulder_tilt": ("shoulder level", "어깨 수평"),
    "pelvic_obliquity": ("pelvis level", "골반 수평"),
    "trunk_lean_lateral": ("trunk lean, side to side", "몸통 좌우 기울기"),
    "trunk_lean_sagittal": ("trunk lean, front to back", "몸통 전후 기울기"),
    "left_knee_deviation": ("left knee tracking", "왼쪽 무릎 정렬"),
    "right_knee_deviation": ("right knee tracking", "오른쪽 무릎 정렬"),
    "lateral_weight_bias": ("where the body is carried", "체중 쏠림"),
    "torso_rotation_index": ("torso rotation index", "몸통 회전 지표"),
    "sagittal_pelvic_tilt": ("pelvic tilt, front to back", "골반 전후 경사"),
}


def metric_name(name: str, lang: str = "en") -> str:
    english, korean = METRIC_NAME.get(name, (name.replace("_", " "), ""))
    return korean if lang == "ko" and korean else english


#: Korean for every refusal the measurement layer writes as a fixed sentence.
#:
#: Keyed on the English, which is not the prettiest arrangement and is the one
#: that cannot go stale silently: ``tests/test_guidance.py`` reads every literal
#: reason out of :mod:`pilates.alignment` and fails if one of them is missing
#: here. A refusal added without Korean breaks the suite rather than appearing
#: in English on a Korean studio's report.
#:
#: Refusals built with an f-string -- the side of the body, a measured
#: percentage -- are not in the table and fall back to English. That is a known
#: gap, written down here rather than hidden, and the fallback is the sentence
#: itself rather than a blank.
REASON_KO: dict[str, str] = {
    "the ear line is edge-on from the side":
        "옆에서는 양쪽 귀를 잇는 선이 겹쳐 보여 측정할 수 없습니다",
    "one or both ears were not found": "한쪽 또는 양쪽 귀를 찾지 못했습니다",
    "the ears fell on the same point": "양쪽 귀가 같은 지점에 잡혔습니다",
    "front-on, the head's depth is along the lens axis":
        "정면에서는 머리의 앞뒤 위치가 렌즈 축과 겹쳐 보이지 않습니다",
    "the ear, shoulder or hip on the camera side was not found":
        "카메라 쪽 귀·어깨·골반 중 하나를 찾지 못했습니다",
    "the torso has no height on screen": "화면에서 몸통 높이가 0입니다",
    "the shoulder line is edge-on from the side":
        "옆에서는 어깨선이 겹쳐 보여 측정할 수 없습니다",
    "one or both shoulders were not found": "한쪽 또는 양쪽 어깨를 찾지 못했습니다",
    "the hip line is edge-on from the side":
        "옆에서는 골반선이 겹쳐 보여 측정할 수 없습니다",
    "one or both hips were not found": "한쪽 또는 양쪽 골반을 찾지 못했습니다",
    "the view could not be established": "촬영 방향을 판정하지 못했습니다",
    "the shoulders or hips were not found": "어깨 또는 골반을 찾지 못했습니다",
    "from the side this offset is knee flexion, not alignment":
        "옆에서 보이는 이 간격은 정렬이 아니라 무릎 굽힘입니다",
    "the leg has no length on screen": "화면에서 다리 길이가 0입니다",
    "stance width is not visible from the side": "옆에서는 두 발 간격이 보이지 않습니다",
    "the ankles or shoulders were not found": "발목 또는 어깨를 찾지 못했습니다",
    "both spans are foreshortened from the side":
        "옆에서는 어깨너비와 골반너비가 모두 단축되어 보입니다",
    "the hips project to nearly a point": "골반이 거의 한 점으로 보입니다",
    "the feet are too close together for stance width to mean anything; ask "
    "for the photograph again with the feet under the hips":
        "두 발이 너무 붙어 있어 발 간격을 기준으로 쓸 수 없습니다. 발을 골반 너비로 "
        "두고 다시 촬영해 주세요",
    "needs the ASIS and PSIS landmarks, which a 17-point model does not mark":
        "위앞엉덩뼈가시(ASIS)와 위뒤엉덩뼈가시(PSIS) 지점이 필요하지만, 17점 모델은 "
        "이 두 지점을 표시하지 않습니다",
    "where the torso stands, not where the load goes":
        "하중이 실리는 위치가 아니라 몸통이 서 있는 위치입니다",
    "needs this student's own baseline to mean rotation":
        "회전으로 해석하려면 이 회원 본인의 기준값이 필요합니다",
}


def reason_text(reason: str, lang: str = "en") -> str:
    """A refusal in one language, falling back to the English it was written in."""
    if lang != "ko" or not reason:
        return reason
    return REASON_KO.get(reason, reason)


#: What a report must carry, word for word, wherever it is shown. Not a footer
#: to be styled small: it is the sentence that decides how everything above it
#: is allowed to be read.
DISCLAIMER = ("This is a measurement of body position from photographs, for "
              "training purposes. It is not a medical assessment, it does not "
              "diagnose any condition, and it should not be used in place of "
              "advice from a qualified clinician.")

DISCLAIMER_KO = ("본 분석은 사진에서 측정한 신체 위치 자료이며 운동 지도를 위한 "
                 "참고용입니다. 의학적 진단이 아니며, 전문 의료인의 진료를 대신할 수 "
                 "없습니다.")

#: The bands a score falls into, and what each is called. Five, because a
#: three-band scale puts most of a normal population in the middle one and
#: tells a studio nothing. Lowest bound first.
SCORE_BANDS: tuple[tuple[float, str, str], ...] = (
    (90.0, "Excellent", "매우 우수"),
    (80.0, "Good", "우수"),
    (60.0, "Fair", "보통"),
    (40.0, "Needs attention", "주의"),
    (0.0, "Needs work", "관리 필요"),
)


#: The best band a body carrying a finding of each severity may be put in.
#: Indices into :data:`SCORE_BANDS`.
#:
#: The score is a mean, and a mean dilutes. A student with one shoulder twelve
#: degrees off level and everything else neutral averages into the eighties,
#: which reads as *Good* and is the single most misleading thing this report
#: could say -- the twelve degrees is exactly what they came in for. So the
#: number stays a mean, because that is what it is, and the *band* is capped by
#: the worst single finding, with the cap stated on the report rather than
#: quietly applied.
BAND_CAP: dict[str, int] = {MARKED: 2, NOTABLE: 1, WATCH: 0, WITHIN: 0}


def band(score: float | None, worst: str = WITHIN) -> tuple[str, str]:
    """The name of the band a score falls in, English and Korean.

    ``worst`` is the severity of the most marked finding, and it can only move
    the band downward -- see :data:`BAND_CAP`.
    """
    if score is None:
        return ("Not scored", "점수 없음")
    index = len(SCORE_BANDS) - 1
    for position, (floor, _, _) in enumerate(SCORE_BANDS):
        if score >= floor:
            index = position
            break
    index = max(index, BAND_CAP.get(worst, 0))
    return SCORE_BANDS[index][1], SCORE_BANDS[index][2]


def band_capped(score: float | None, worst: str) -> bool:
    """Whether the worst finding, not the score, decided the band."""
    if score is None:
        return False
    return band(score, worst) != band(score, WITHIN)


def _findings_note(assessment: PhotoAssessment,
                   found: list[Finding]) -> tuple[str, str]:
    """Why the findings list is not the whole story, when it is not.

    Two cases, and the second one was shipped wrong. A body whose photographs
    are in doubt has not been found to be unremarkable, it has not been
    measured -- that much was handled. But a set where *no* photograph could be
    used has no doubts at all: the refusals are photograph problems, not
    landmark problems, so the doubt list is empty, the findings list is empty,
    and the screen said "every measurement sits inside its usual range" over
    nothing whatsoever. That is the same lie as printing a score over an
    unusable photograph, one sentence further down the page.

    So the honest question is not "were there doubts" but "was anything
    actually measured", asked first.
    """
    if not assessment.supplied:
        return ("nothing was measured: none of the photographs could be used. "
                "There is no finding here, and no absence of one either",
                "측정된 항목이 없습니다. 사용할 수 있는 사진이 없어 판단을 내릴 수 "
                "없으며, 이상이 없다는 뜻도 아닙니다")
    if not any(r.measured for r in assessment.readings.values()):
        return ("nothing could be measured from the photographs that were "
                "supplied",
                "제출된 사진에서 측정할 수 있는 항목이 없었습니다")
    if assessment.doubts:
        return ("these measurements are held back until the photographs above "
                "are retaken: what they measured may not be this body",
                "위 사진을 다시 촬영할 때까지 측정 결과를 판단하지 않습니다. "
                "측정 대상이 이 회원이 아닐 수 있습니다")
    return ("", "")


def _withheld_ko(score) -> str:
    """Korean for the two shapes :class:`pilates.scoring.Score` withholds in.

    Rebuilt from the same numbers rather than translated from the English,
    because the English is an f-string in a module this one does not own and
    matching it by text would break the first time somebody reworded it. The
    rule it states -- too few checks, or too little of the body visible -- is
    the part that has to survive, and that is read from the score itself.
    """
    if score.checks < scoring.MIN_CHECKS:
        return (f"측정된 항목이 {score.checks}개뿐입니다. 이 정도로는 한 항목만 "
                f"달라져도 점수가 크게 흔들립니다")
    return (f"측정 가능한 {score.measurable}개 항목 중 {score.measured}개만 "
            f"보였습니다({score.coverage:.0%}). 점수를 내면 화면에 들어온 부분만 "
            f"설명하는 숫자가 됩니다")


def report(assessment: PhotoAssessment) -> dict:
    """The whole pre-session report, as one payload.

    Everything the screen and the printed page need, assembled once so the two
    cannot disagree: the measurement, what was refused and why, the findings in
    order, what to work on, and the sentence that says what none of it is.
    """
    found = findings(assessment)
    score = assessment.score()
    value = None if score.value is None else round(score.value, 1)
    worst = found[0].severity if found else WITHIN
    english, korean = band(value, worst)
    capped = band_capped(value, worst)
    cap_reason = (
        "the score is the average across the body; one measurement is far "
        "enough outside its range that the band is set by that finding "
        "rather than by the average" if capped else "")
    cap_reason_ko = (
        "점수는 신체 전체의 평균입니다. 한 항목이 정상 범위를 크게 벗어나 있어 "
        "등급은 평균이 아니라 그 항목을 기준으로 정했습니다" if capped else "")
    withheld_ko = _withheld_ko(score) if score.withheld_reason else ""
    return {
        "assessment": assessment.to_dict(),
        "score": {"value": value, "band": english, "band_ko": korean,
                  "worst_finding": worst,
                  "band_capped": capped,
                  "band_cap_reason": cap_reason,
                  "band_cap_reason_ko": cap_reason_ko,
                  "withheld_reason": score.withheld_reason,
                  "withheld_reason_ko": withheld_ko,
                  "note": (score.withheld_reason or cap_reason
                           or f"measured {score.checks} things, "
                              f"{score.coverage:.0%} of what these "
                              f"photographs can show"),
                  "note_ko": (withheld_ko or cap_reason_ko
                              or f"{score.checks}개 항목 측정 · 이 사진들이 보여 "
                                 f"줄 수 있는 것의 {score.coverage:.0%}"),
                  "coverage": round(score.coverage, 3),
                  "checks": score.checks,
                  "bands": [{"from": f, "en": e, "ko": k}
                            for f, e, k in SCORE_BANDS]},
        "findings": [f.to_dict() for f in found],
        # A body whose photographs are in doubt has not been found to be
        # unremarkable; it has not been measured. Saying "everything is inside
        # its usual range" over an unusable photograph is the same failure as
        # printing a score over one, one sentence further down the page.
        "findings_note": _findings_note(assessment, found)[0],
        "findings_note_ko": _findings_note(assessment, found)[1],
        "priorities": [f.name for f in priorities(found)],
        "programme": programme(found),
        "habits": habits(found),
        # What to call each measurement, for every reading rather than only the
        # refused ones. A screen listing them beside a photograph has room for
        # "shoulder level" and not for the sentence a finding is titled with.
        "names": {name: {"en": metric_name(name),
                         "ko": metric_name(name, "ko")}
                  for name in assessment.readings},
        "refused": {r.name: r.metric.reason for r in assessment.refusals()},
        "refused_detail": [{"metric": r.name,
                            "name": metric_name(r.name),
                            "name_ko": metric_name(r.name, "ko"),
                            "reason": r.metric.reason,
                            "reason_ko": reason_text(r.metric.reason, "ko")}
                           for r in assessment.refusals()],
        "unremarkable_detail": [{"metric": n,
                                 "name": metric_name(n),
                                 "name_ko": metric_name(n, "ko")}
                                for n, r in assessment.readings.items()
                                if r.measured and severity(r) is WITHIN],
        "unremarkable": [n for n, r in assessment.readings.items()
                         if r.measured and severity(r) is WITHIN],
        "warnings": list(assessment.warnings),
        "doubts": list(assessment.doubts),
        "missing_photos": [{"view": v.value,
                            "title": ik.instructions(v)[0],
                            "how": ik.instructions(v)[1],
                            "title_ko": ik.instructions(v, "ko")[0],
                            "how_ko": ik.instructions(v, "ko")[1]}
                           for v in assessment.missing_photos],
        "disclaimer": DISCLAIMER,
        "disclaimer_ko": DISCLAIMER_KO,
    }
