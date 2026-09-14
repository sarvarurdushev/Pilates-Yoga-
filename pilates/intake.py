"""The pre-session assessment: four photographs, one report.

This is the half of the posture work a studio actually does at the door. Before
anybody gets on a reformer they stand against a wall and four photographs are
taken -- front, left side, right side, back -- and the question is *what does
this body look like standing still, and what should the first session work on*.
The class recording answers a different question, later, about how a movement
went; the two share a measurement engine and nothing else.

**Four photographs is a protocol, not an upload limit.** Each one exists to see
something the others cannot. The frontal pair -- front and back -- carry every
side-to-side measurement: a shoulder line, a hip line, where the knees track,
where the body is carried over the feet. The sagittal pair -- left and right --
carry the two that need depth: how far the head sits ahead of the shoulders,
and how far the trunk leans fore or aft. :data:`pilates.alignment.VIEW_METRICS`
is the table; this module is what happens when a studio supplies all four.

**Two photographs of the same quantity is the point, not redundancy.** The
landmark labels are anatomical, so the person's left shoulder is the left
shoulder from in front and from behind alike, and the front and back
photographs are therefore two independent measurements of the same shoulder
line. They will not agree exactly -- the student shifted, the camera was not
square, a landmark landed a few pixels out -- and *how far they disagree is the
error bar this product would otherwise not have*. A single photograph gives a
number with no way to tell whether it is real. A pair gives a number and a
reason to believe it, or a reason not to. See :class:`Reading`.

**What four photographs still cannot do.** They cannot recover depth, so
sagittal pelvic tilt is refused here exactly as it is refused in
:mod:`pilates.alignment` -- the ASIS and PSIS landmarks a 17-point model does
not mark. They cannot see the foot arch, the scapula against the ribs, or
anything under the skin. They are photographs of a person standing where they
chose to stand: two visits are comparable to the extent the setup was repeated,
which is why :func:`pilates.alignment.compare` refuses to compare across views
and why the protocol below asks for the same four every time.

**Not a diagnosis, in the code and not only in the footer.** Every number is
geometry over landmarks. Nothing here names a condition, and the wording in
:mod:`pilates.guidance` is generated from the measurement rather than chosen to
sound clinical.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from . import alignment as al
from .alignment import Availability, Metric, PostureAssessment, View
from .scoring import Component, Score
from .types import Detection

#: The four photographs, in the order a studio takes them. Front first because
#: it is the one a student expects; the back last because it is the one they
#: have to be talked into.
PROTOCOL: tuple[View, ...] = (View.FRONT, View.SIDE_LEFT, View.SIDE_RIGHT, View.REAR)

#: What to call each photograph on a screen, and what to ask the student to do.
#: Held here rather than in the browser because the same words have to appear on
#: a printed report, and two copies of a phrase is how they stop matching.
#:
#: Both languages, because the studio this is built for teaches in Korean and a
#: half-translated report is worse than either language on its own -- the reader
#: has to switch registers mid-sentence and stops trusting both halves.
INSTRUCTIONS: dict[View, tuple[str, str]] = {
    View.FRONT: ("Front",
                 "Face the camera square on, arms relaxed at your sides, "
                 "feet under your hips, looking straight ahead."),
    View.SIDE_LEFT: ("Left side",
                     "Turn so your left shoulder is toward the camera. Arms "
                     "relaxed, look straight ahead -- not at the camera."),
    View.SIDE_RIGHT: ("Right side",
                      "Turn so your right shoulder is toward the camera. Arms "
                      "relaxed, look straight ahead -- not at the camera."),
    View.REAR: ("Back",
                "Turn your back to the camera, arms relaxed at your sides, "
                "feet under your hips."),
}

INSTRUCTIONS_KO: dict[View, tuple[str, str]] = {
    View.FRONT: ("정면",
                 "카메라를 정면으로 바라보고 서세요. 팔은 몸 옆에 편하게 내리고, "
                 "발은 골반 너비로, 시선은 앞을 봅니다."),
    View.SIDE_LEFT: ("좌측면",
                     "왼쪽 어깨가 카메라를 향하도록 서세요. 팔은 편하게 내리고 "
                     "카메라가 아니라 정면을 바라봅니다."),
    View.SIDE_RIGHT: ("우측면",
                      "오른쪽 어깨가 카메라를 향하도록 서세요. 팔은 편하게 내리고 "
                      "카메라가 아니라 정면을 바라봅니다."),
    View.REAR: ("후면",
                "카메라를 등지고 서세요. 팔은 몸 옆에 편하게 내리고, 발은 골반 "
                "너비로 둡니다."),
}


def instructions(view: View, lang: str = "en") -> tuple[str, str]:
    """The name of a photograph and how to take it, in one language."""
    table = INSTRUCTIONS_KO if lang == "ko" else INSTRUCTIONS
    return table.get(view, INSTRUCTIONS.get(view, (view.value, "")))


#: Which photographs can measure each quantity. Inverted from the alignment
#: layer's table rather than written out again, so a metric added there cannot
#: be silently missing here.
MEASURED_BY: dict[str, tuple[View, ...]] = {}
for _view in PROTOCOL:
    for _name in al.VIEW_METRICS[_view]:
        MEASURED_BY[_name] = MEASURED_BY.get(_name, ()) + (_view,)
del _view, _name

#: How far two photographs of the same quantity may disagree before the pair
#: stops counting as corroboration. Two degrees is about where a shoulder
#: difference becomes visible across a room, and it is also about what a
#: student's own sway contributes between two shots -- so a disagreement
#: larger than this is the setup, not the body.
#:
#: Per unit rather than per metric: everything in degrees shares a scale, and
#: everything expressed as a share of a body length shares another.
TOLERANCE: dict[str, float] = {"deg": 2.5, "ratio": 0.05}

#: Below this, a photograph is not worth measuring from and is reported as a
#: photograph to retake rather than as a result. Matches the alignment layer.
MIN_BODY_FRACTION = al.MIN_BODY_FRACTION


@dataclass(frozen=True)
class Photo:
    """One photograph of the set: which view it is, and what was found in it.

    ``detection`` is None when the pose backend found nobody, which is a
    photograph to retake and not a measurement of zero. ``problem`` says why,
    in words a receptionist can act on.
    """

    view: View
    detection: Detection | None = None
    width: int = 0
    height: int = 0
    #: What the studio called the file. Never the stored path: the photographs
    #: are not kept, and a path in a report is a path somebody will try.
    label: str = ""
    problem: str = ""
    #: Something about the photograph worth saying that did not stop it being
    #: measured -- another person in the frame, most often. A problem refuses
    #: the photograph; a note travels with it.
    note: str = ""
    #: Whether that note is bad enough to put the measurement itself in doubt.
    #: One other person in the corner of the frame is a note. One the same size
    #: as the subject, standing next to them, is a reason not to print a score.
    doubt: bool = False

    @property
    def usable(self) -> bool:
        return self.detection is not None and not self.problem

    @property
    def title(self) -> str:
        return instructions(self.view)[0]

    def titled(self, lang: str = "en") -> str:
        return instructions(self.view, lang)[0]


@dataclass(frozen=True)
class Reading:
    """One quantity as the four-photograph set finally reports it.

    The difference from a :class:`pilates.alignment.Metric` is the provenance:
    which photographs produced it, whether they agreed, and how far apart they
    were. A reading corroborated by two photographs is a different kind of
    claim from one that rests on a single shot, and a report that does not say
    which is which invites the reader to treat them the same.
    """

    metric: Metric
    #: Every photograph that measured it, in protocol order.
    sources: tuple[View, ...] = ()
    #: Largest difference between the photographs that measured it. None when
    #: only one did, which is not the same as zero disagreement.
    spread: float | None = None
    #: What each photograph said, for a reader who wants to check the merge.
    values: dict[str, float] = field(default_factory=dict)

    @property
    def corroborated(self) -> bool:
        """Two photographs measured it and they agreed."""
        return self.spread is not None and self.spread <= TOLERANCE.get(self.metric.unit, 0.0)

    @property
    def contested(self) -> bool:
        """Two photographs measured it and they did not agree."""
        return self.spread is not None and not self.corroborated

    @property
    def name(self) -> str:
        return self.metric.name

    @property
    def value(self) -> float | None:
        return self.metric.value

    @property
    def measured(self) -> bool:
        return self.metric.measured

    @property
    def notable(self) -> bool:
        return self.metric.notable

    @property
    def deviation(self) -> float | None:
        return self.metric.deviation

    def evidence(self, lang: str = "en") -> str:
        """One sentence a reader can weigh the number against.

        Which photographs produced the number, and whether they agreed. It is
        the difference between a measurement and a reading, and a report that
        omits it asks to be trusted rather than checked.
        """
        if not self.measured:
            return self.metric.reason
        names = [instructions(v, lang)[0] for v in self.sources]
        if lang == "ko":
            seen = "·".join(names)
            if self.spread is None:
                return f"{seen} 사진 한 장에서만 측정"
            gap = (f"{self.spread:.1f}°" if self.metric.unit == "deg"
                   else f"신장 대비 {self.spread:.3f}")
            if self.corroborated:
                return f"{seen} 사진에서 측정, 두 장의 차이 {gap} 이내로 일치"
            return (f"{seen} 사진이 {gap}만큼 어긋났습니다. 측정 오차보다 크므로 "
                    f"참고값으로만 보세요")
        lowered = [n.lower() for n in names]
        seen = " and ".join(lowered) if len(lowered) < 3 \
            else ", ".join(lowered[:-1]) + " and " + lowered[-1]
        if self.spread is None:
            return f"measured from the {seen} photograph only"
        gap = (f"{self.spread:.1f}°" if self.metric.unit == "deg"
               else f"{self.spread:.3f} of a body length")
        if self.corroborated:
            return (f"measured from the {seen} photographs, which agreed to "
                    f"within {gap}")
        return (f"the {seen} photographs disagreed by {gap}, which is more "
                f"than measurement noise; treat it as indicative")

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "value": self.value,
            "unit": self.metric.unit,
            "availability": self.metric.availability.value,
            "confidence": round(self.metric.confidence, 3),
            "normal": list(self.metric.normal) if self.metric.normal else None,
            "deviation": (None if self.deviation is None
                          else round(self.deviation, 3)),
            "notable": self.notable,
            "reason": self.metric.reason,
            "sources": [v.value for v in self.sources],
            "spread": None if self.spread is None else round(self.spread, 3),
            "per_view": self.values,
            "corroborated": self.corroborated,
            "contested": self.contested,
            "evidence": self.evidence(),
            "evidence_ko": self.evidence("ko"),
        }


def _merge(name: str, found: list[tuple[View, Metric]]) -> Reading:
    """Combine what each photograph said about one quantity.

    The mean is used rather than the better-confidence one because both
    photographs are the same measurement made twice and there is no principled
    reason to throw half of it away -- and because the mean of two shots is
    what cancels the student having shifted slightly between them. Where they
    disagree beyond :data:`TOLERANCE` the mean is still reported, marked
    contested, and the confidence is cut in proportion: a number a reader can
    see is shaky beats a silent refusal they will fill in themselves.
    """
    if not found:
        raise ValueError(f"{name}: nothing to merge")
    views = tuple(v for v, _ in found)
    values = [float(m.value) for _, m in found]
    per_view = {v.value: round(float(m.value), 3) for v, m in found}
    first = found[0][1]
    if len(found) == 1:
        return Reading(first, views, None, per_view)

    spread = max(values) - min(values)
    mean = statistics.fmean(values)
    tolerance = TOLERANCE.get(first.unit, 0.0)
    confidence = statistics.fmean([m.confidence for _, m in found])
    reason = first.reason
    if spread > tolerance:
        # Halve it at the tolerance and let it fall away from there, so a small
        # excess is a small penalty rather than a cliff.
        confidence *= tolerance / spread
        note = (f"the two photographs differed by {spread:.1f}"
                f"{'°' if first.unit == 'deg' else ''}")
        reason = f"{reason}; {note}" if reason else note
    # ESTIMATED is contagious: a merge of an estimate and a measurement is an
    # estimate, because the assumption behind the estimate is still in there.
    availability = (Availability.ESTIMATED
                    if any(m.availability is Availability.ESTIMATED for _, m in found)
                    else first.availability)
    merged = Metric(name, al._zero(round(mean, 3 if first.unit == "ratio" else 2)),
                    first.unit, availability, round(confidence, 3), reason,
                    first.normal)
    return Reading(merged, views, round(spread, 3), per_view)


@dataclass
class PhotoAssessment:
    """A four-photograph pre-session assessment: the whole report's source.

    Holds the individual assessments as well as the merged readings. A studio
    arguing with a number needs to see which photograph produced it, and a
    developer debugging one needs the per-view assessment intact.
    """

    per_view: dict[View, PostureAssessment] = field(default_factory=dict)
    photos: dict[View, Photo] = field(default_factory=dict)
    readings: dict[str, Reading] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    #: The subset of the warnings that puts the *measurement* in doubt, rather
    #: than merely describing a gap in it.
    #:
    #: The distinction matters because they are answered differently. "No back
    #: photograph" is a gap: everything measured is still true, there is just
    #: less of it, and coverage already says so. "The right ankle is above the
    #: right knee" is a doubt: the numbers came out clean and they are about
    #: nobody. A gap lowers coverage; a doubt withholds the headline, because a
    #: score of 100 printed beside a warning that the photograph is unusable is
    #: the worst thing this system can put on a screen -- the number is what
    #: gets read and the warning is what gets skipped.
    doubts: list[str] = field(default_factory=list)
    #: Photographs whose landmarks do not look like the view they were
    #: labelled with. Held as data alongside the sentence in ``doubts``,
    #: because this is the one warning here that comes with an action -- see
    #: :attr:`swap`.
    mismatches: list[Mismatch] = field(default_factory=list)
    person_id: str = ""
    #: The day the photographs were taken, ISO-8601, supplied by the caller.
    #: Not defaulted to today: a set photographed last week and uploaded now
    #: would silently become today's assessment.
    taken_on: str = ""

    # ------------------------------------------------------------- coverage

    @property
    def supplied(self) -> tuple[View, ...]:
        """The photographs that produced landmarks, in protocol order."""
        return tuple(v for v in PROTOCOL
                     if v in self.photos and self.photos[v].usable)

    @property
    def missing_photos(self) -> tuple[View, ...]:
        return tuple(v for v in PROTOCOL if v not in self.supplied)

    @property
    def expected(self) -> tuple[str, ...]:
        """Quantities the photographs actually supplied could have measured.

        The honest denominator. Scoring a front-only set out of every metric
        in the module would charge it for forward head, which no frontal
        photograph can see; scoring the full four out of only what one of them
        sees would flatter it.
        """
        seen: list[str] = []
        for view in self.supplied:
            for name in al.VIEW_METRICS[view]:
                if name not in seen:
                    seen.append(name)
        return tuple(seen)

    @property
    def complete(self) -> bool:
        return not self.missing_photos

    @property
    def reliable(self) -> bool:
        return not self.doubts and bool(self.supplied)

    # ------------------------------------------------------------- the fix

    @property
    def swapped_pair(self) -> tuple[View, View] | None:
        """Two photographs that each look like the other, in protocol order.

        Mutual disagreement is what makes this safe to offer. One photograph
        flagged on its own is ambiguous -- it might be the labelling that is
        wrong, or the student who turned too far -- and exchanging it with a
        neighbour that nothing is wrong with would take a correct photograph
        and put it in the wrong slot. Two photographs that each look like the
        other is a different claim: there is one arrangement of these two files
        that both estimates agree with, and it is not the one that was
        uploaded.
        """
        for first in self.mismatches:
            if not first.fixable_by_swapping:
                continue
            for second in self.mismatches:
                if second is first or not second.fixable_by_swapping:
                    continue
                if (first.looks_like is second.view
                        and second.looks_like is first.view):
                    pair = sorted((first.view, second.view), key=PROTOCOL.index)
                    return (pair[0], pair[1])
        return None

    @property
    def mislabelled(self) -> tuple[View, View] | None:
        """One photograph that looks like a view nothing was supplied for.

        The single-photograph case the swap deliberately will not touch. If
        the only side photograph in the set is labelled left and looks like a
        right, there is nothing to exchange it with, and the correction is to
        change what it is called -- which also fills the gap that was being
        reported as a missing photograph.
        """
        loose = [m for m in self.mismatches if m.fixable_by_swapping
                 and m.looks_like not in self.photos]
        if len(loose) != 1:
            return None
        return (loose[0].view, loose[0].looks_like)

    def fix(self) -> dict | None:
        """The correction the mismatches point at, ready to put on a button.

        One shape for both cases so a screen has a single thing to look for,
        and None when the disagreement is real but the remedy is a camera
        rather than a click.
        """
        pair = self.swapped_pair
        if pair is not None:
            one, two = (instructions(v)[0].lower() for v in pair)
            one_ko, two_ko = (instructions(v, "ko")[0] for v in pair)
            return {
                "action": "swap",
                "views": [v.value for v in pair],
                "label": f"Exchange the {one} and {two} photographs",
                "label_ko": f"{one_ko}과 {two_ko} 사진 바꾸기",
                "why": (f"the {one} photograph looks like the {two} and the "
                        f"{two} looks like the {one}, which is what a set "
                        f"uploaded the wrong way round looks like"),
                "why_ko": (f"{one_ko} 사진은 {two_ko}처럼, {two_ko} 사진은 "
                           f"{one_ko}처럼 보입니다. 두 장이 서로 바뀌어 "
                           f"업로드된 경우에 나타나는 모습입니다"),
            }
        single = self.mislabelled
        if single is not None:
            was, is_really = single
            return {
                "action": "relabel",
                "views": [was.value, is_really.value],
                "label": (f"Call the {instructions(was)[0].lower()} photograph "
                          f"the {instructions(is_really)[0].lower()}"),
                "label_ko": (f"{instructions(was, 'ko')[0]} 사진을 "
                             f"{instructions(is_really, 'ko')[0]}으로 변경"),
                "why": (f"it looks like a "
                        f"{instructions(is_really)[0].lower()} view, and no "
                        f"{instructions(is_really)[0].lower()} photograph was "
                        f"supplied"),
                "why_ko": (f"{instructions(is_really, 'ko')[0]}처럼 보이고, "
                           f"{instructions(is_really, 'ko')[0]} 사진은 "
                           f"제출되지 않았습니다"),
            }
        return None

    # ---------------------------------------------------------------- score

    def component(self, region: str) -> Component:
        comp = Component(region)
        for name in al.REGIONS.get(region, ()):
            reading = self.readings.get(name)
            if reading is None or not reading.measured:
                continue
            dev = reading.deviation
            if dev is None:
                continue
            scale = al.ZERO_AT if reading.metric.unit == "deg" else al.RATIO_ZERO_AT
            comp.checks.append(
                (name, max(0.0, min(100.0, 100.0 * (1.0 - dev / scale)))))
        return comp

    def score(self) -> Score:
        """The standing-alignment score, on the shared scoring machinery.

        Same class as every other score in this project, which is what carries
        the coverage rule: a headline number is withheld when too little of the
        body was visible, rather than computed from whatever turned up.
        """
        score = Score(measurable=max(1, len(self.expected)))
        for region in al.REGIONS:
            comp = self.component(region)
            if comp.n:
                score.components[region] = comp
        score.missing = [n for n in self.expected
                         if not self.readings.get(n)
                         or not self.readings[n].measured]
        if self.doubts:
            first = self.doubts[0]
            more = (f", and {len(self.doubts) - 1} other thing"
                    f"{'s' if len(self.doubts) > 2 else ''}"
                    if len(self.doubts) > 1 else "")
            # No "no score:" prefix. Every other reason the scorer withholds
            # for is a bare sentence and the caller frames it -- the CLI says
            # "no score:", the screen puts it under a dash -- so one that
            # framed itself would come out doubled in both.
            score.blocked = (f"{first}{more}. Retake that photograph and the "
                             f"measurements will stand on their own")
        return score

    def attention(self) -> list[Reading]:
        """What to look at, worst first."""
        notable = [r for r in self.readings.values() if r.measured and r.notable]
        return sorted(notable, key=lambda r: -(r.deviation or 0.0))

    def refusals(self) -> list[Reading]:
        """Quantities that could not be measured, each with its reason.

        A report that silently omits these is a report a reader completes from
        imagination. Sagittal pelvic tilt is always in here, and always should
        be: it is the measurement this product is asked for most and the one it
        is least able to give.
        """
        return [r for r in self.readings.values() if not r.measured]

    # --------------------------------------------------------------- output

    def to_dict(self) -> dict:
        score = self.score()
        return {
            "person_id": self.person_id,
            "taken_on": self.taken_on,
            "protocol": [v.value for v in PROTOCOL],
            "supplied": [v.value for v in self.supplied],
            "missing_photos": [v.value for v in self.missing_photos],
            "complete": self.complete,
            "overall_score": None if score.value is None else round(score.value, 1),
            "score_withheld_reason": score.withheld_reason,
            "coverage": round(score.coverage, 3),
            "checks": score.checks,
            "components": {n: (None if c.score is None else round(c.score, 1))
                           for n, c in score.components.items()},
            "readings": {n: r.to_dict() for n, r in self.readings.items()},
            "attention": [r.name for r in self.attention()],
            "refused": {r.name: r.metric.reason for r in self.refusals()},
            "warnings": list(self.warnings),
            "doubts": list(self.doubts),
            "mismatches": [m.to_dict() for m in self.mismatches],
            # The one warning in this payload with a button attached.
            "fix": self.fix(),
            "reliable": self.reliable,
            "photos": {v.value: {"title": p.title, "width": p.width,
                                 "height": p.height, "label": p.label,
                                 "usable": p.usable, "problem": p.problem,
                                 "note": p.note, "doubt": p.doubt,
                                 "view_confidence": round(
                                     self.per_view[v].view.confidence, 3)
                                 if v in self.per_view else None}
                       for v, p in self.photos.items()},
        }


#: How sure the view estimator has to be before it is allowed to contradict
#: the label the studio typed. Below this it is guessing, and a guess that
#: argues with a person who was in the room is noise.
MIN_MISMATCH_CONFIDENCE = 0.6


@dataclass(frozen=True)
class Mismatch:
    """The estimator disagreeing with the label a photograph was given.

    Kept as data rather than as a sentence because it is the one warning in
    this system with a *fix* attached. "The left side photograph looks like a
    right side view" is not something to read and sigh at: if the other side
    photograph looks like this one, the two are simply the wrong way round, and
    the whole report can be made correct by exchanging them. A sentence cannot
    carry that offer; a screen would have to match text against a phrase to
    find it, and the phrase would change.
    """

    #: What the photograph was labelled.
    view: View
    #: What the landmarks in it look like.
    looks_like: View
    #: The estimator's own confidence, so a reader can weigh the disagreement.
    confidence: float
    #: ``mirrored`` -- the guess is the label's opposite within the same plane
    #: (left for right, front for back), which is what an out-of-order upload
    #: looks like and is fixable by exchanging photographs. ``off_square`` --
    #: the guess crosses planes, which is a student who did not turn far
    #: enough and is only fixable by taking the photograph again.
    kind: str

    @property
    def fixable_by_swapping(self) -> bool:
        return self.kind == "mirrored"

    def text(self, lang: str = "en") -> str:
        mine = instructions(self.view, lang)[0]
        theirs = instructions(self.looks_like, lang)[0]
        if lang == "ko":
            if self.kind == "off_square":
                return (f"{mine} 사진이 {theirs}처럼 보입니다. 카메라를 정면으로 "
                        f"보고 다시 촬영하세요")
            return (f"{mine} 사진이 {theirs}처럼 보입니다. 순서가 바뀌어 "
                    f"업로드되었다면 아래의 좌우가 모두 반대입니다")
        if self.kind == "off_square":
            return (f"the {mine.lower()} photograph looks like a "
                    f"{theirs.lower()} view -- ask for it again with the "
                    f"student square to the camera")
        return (f"the {mine.lower()} photograph looks like a "
                f"{theirs.lower()} view; if the set was uploaded out of order "
                f"every left and right below is reversed")

    def to_dict(self) -> dict:
        return {"view": self.view.value, "looks_like": self.looks_like.value,
                "kind": self.kind, "confidence": round(self.confidence, 3),
                "text": self.text(), "text_ko": self.text("ko")}


def _view_mismatch(photo: Photo) -> Mismatch | None:
    """Whether the photograph shows what the studio said it shows.

    The caller names each photograph, and that name is trusted for the
    measurement because a studio knows where its camera is. But a set uploaded
    in the wrong order -- back where front should be -- would then be measured
    with every left/right correction applied backwards, and every number would
    come out plausible and mirrored. So the estimator still runs, purely to
    disagree: it is not allowed to override the label, only to say the label
    looks wrong.
    """
    if photo.detection is None:
        return None
    guess = al.estimate_view(photo.detection)
    if guess.view is View.UNKNOWN or guess.confidence < MIN_MISMATCH_CONFIDENCE:
        return None
    if guess.view is photo.view:
        return None
    # Front against back is the mistake that mirrors a report; left against
    # right is the same mistake in the sagittal pair. Confusing a side for a
    # front is a student who did not turn far enough, which is a different
    # problem and gets its own words.
    kind = ("off_square" if guess.view.is_frontal is not photo.view.is_frontal
            else "mirrored")
    return Mismatch(photo.view, guess.view, guess.confidence, kind)


def assess_photos(photos: list[Photo], *, person_id: str = "",
                  taken_on: str = "",
                  threshold: float = al.THRESHOLD) -> PhotoAssessment:
    """Measure a set of photographs as one pre-session assessment.

    The view of each photograph is *told*, not inferred: a studio knows which
    way the student was facing, and a label is always more reliable than an
    estimate made from the same landmarks being measured. The estimator still
    runs as a check -- see :func:`_view_mismatch` -- because a set uploaded out
    of order is the one mistake that produces a complete, plausible, mirrored
    report.
    """
    out = PhotoAssessment(person_id=person_id, taken_on=taken_on)
    for photo in photos:
        out.photos[photo.view] = photo
        if photo.note:
            note = f"{photo.title}: {photo.note}"
            out.warnings.append(note)
            if photo.doubt:
                out.doubts.append(note)
        if not photo.usable:
            if photo.problem:
                out.warnings.append(f"{photo.title}: {photo.problem}")
            continue
        assessment = al.assess(photo.detection, view=photo.view,
                               person_id=person_id,
                               frame_height=photo.height or None,
                               threshold=threshold)
        out.per_view[photo.view] = assessment
        for warning in assessment.warnings:
            # Every warning the measurement layer raises is about the landmarks
            # it was handed -- too small, too unsure, or not a body -- so every
            # one of them is a doubt rather than a gap.
            out.warnings.append(f"{photo.title}: {warning}")
            out.doubts.append(f"{photo.title}: {warning}")
        mismatch = _view_mismatch(photo)
        if mismatch is not None:
            out.mismatches.append(mismatch)
            out.warnings.append(mismatch.text())
            out.doubts.append(mismatch.text())

    for view in PROTOCOL:
        if view not in out.photos:
            out.warnings.append(
                f"no {INSTRUCTIONS[view][0].lower()} photograph: " + _lost(view))

    names: list[str] = []
    for assessment in out.per_view.values():
        for name in assessment.metrics:
            if name not in names:
                names.append(name)
    for name in names:
        found = [(v, a.metrics[name]) for v, a in out.per_view.items()
                 if name in a.metrics and a.metrics[name].measured]
        if found:
            out.readings[name] = _merge(name, found)
            continue
        # Nothing measured it. Carry the clearest refusal rather than the first:
        # "the ear line is edge-on from the side" is the wrong reason to print
        # when a front photograph was supplied and the ears simply were not
        # found in it.
        candidates = [a.metrics[name] for v, a in out.per_view.items()
                      if name in a.metrics
                      and v in MEASURED_BY.get(name, PROTOCOL)]
        metric = (candidates or [a.metrics[name] for a in out.per_view.values()
                                 if name in a.metrics])[0]
        out.readings[name] = Reading(metric, ())
    return out


def _lost(view: View) -> str:
    """What a missing photograph costs, named."""
    only = [n for n in al.VIEW_METRICS[view]
            if all(v is view for v in MEASURED_BY.get(n, ()))]
    if only:
        pretty = ", ".join(n.replace("_", " ") for n in only)
        return f"nothing else can measure {pretty}"
    return ("the opposite photograph can still measure everything it would "
            "have, but with nothing to check it against")


def compare(before: PhotoAssessment, after: PhotoAssessment) -> al.Comparison:
    """Two visits, compared metric by metric.

    Delegates to :func:`pilates.alignment.compare` on purpose. That function
    already refuses to compare across views, already refuses a metric missing
    from either visit, and already declines to report a percentage change
    against a value near zero -- three refusals that would each have to be
    rewritten here, and would each eventually be written slightly differently.
    """
    return al.compare(_as_single(before), _as_single(after))


def _as_single(intake: PhotoAssessment) -> PostureAssessment:
    """A four-photograph assessment in the shape the comparison expects.

    The view is recorded as the set of photographs supplied rather than one
    orientation, so two visits photographed to different protocols are refused
    by the same rule that refuses a front against a back.
    """
    supplied = intake.supplied
    label = "+".join(v.value for v in supplied) or "none"
    # One view for every photograph set, so two visits are never refused
    # wholesale for having been shot to different protocols. They do not need
    # to be: a quantity one visit did not measure is already refused metric by
    # metric, with the better reason, and the readings are anatomically signed
    # so a front and a back photograph agree about which shoulder is high.
    estimate = al.ViewEstimate(
        View.FRONT if supplied else View.UNKNOWN,
        1.0 if supplied else 0.0,
        note=f"photograph set: {label}")
    return PostureAssessment(
        view=estimate,
        metrics={n: r.metric for n, r in intake.readings.items()},
        warnings=list(intake.doubts),
        person_id=intake.person_id,
        # The score asks what could have been measured. For a photograph set
        # that is the union of the views supplied, which is why the alignment
        # layer takes an override rather than always consulting its own table.
        expected_override=intake.expected)
