# What a camera can and cannot tell you

A system that says everything confidently is worth less than one that says
fewer things and is right. This page draws the lines, so that what the system
does claim can be relied on.

Three tiers.

---

## Tier 1 — Measured

Computed from the image, with error bounds that have been checked against
instruments.

| | How | Trustworthiness |
|---|---|---|
| Joint angles | Directly from keypoints | Good where the joint is visible and not foreshortened |
| Range of motion, tempo, repetitions | Angle over time | Good on a continuous shot |
| Left/right symmetry | Paired angles | Good, but sensitive to camera angle |
| Hold duration, movement smoothness | Angle over time | Good |

The limits are honest and documented elsewhere: movements that turn in the
camera's depth axis are not measurable from one view
(`docs/depth-ambiguity.md`), and identity fails in a crowded room above about
15% neighbour overlap.

---

## Tier 2 — Modelled

Not read off the image, but derived from it by established biomechanics, with
stated assumptions. This is where mechanical **load** lives — the thing joint
angles cannot tell you.

### Joint moments

The turning force a joint must resist. Computed by inverse dynamics from
segment masses (Winter's anthropometric tables), limb geometry and gravity.

This is real, standard, and validated: [OpenCap](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10586693/)
reports joint-moment errors of **1.34% of body mass × height** from smartphone
video against force plates.

It answers what an angle cannot. Two students holding a leg at the same 45
degrees are under different demands if they are different sizes — same picture,
different load.

**Assumptions, stated:**

- Segment masses are population averages. An individual's differ.
- Body mass and height must be supplied. They are not visible.
- Only gravity is modelled. Valid for a limb held in the air; **invalid the
  moment that limb bears weight through the floor**, because an unmeasured
  ground reaction force then dominates. The system detects this and refuses,
  rather than reporting a number that is wrong by an unknown amount.
- Acceleration is neglected. Fine for slow mat work, wrong for anything fast.

### Which muscle group is working

Follows from the moment by mechanics, not inference: a net knee-extension
moment must be produced by the knee extensors, because nothing else crosses
that joint in that direction.

Naming the **group** is sound. Splitting load between individual muscles inside
a group is not, and is not attempted.

### Contraction type

Whether the working muscle is shortening (concentric), lengthening (eccentric)
or holding (isometric), from the moment against the direction of joint
movement. This is genuinely useful and invisible in a joint angle: lowering
under control is eccentric work, where much of the training effect and much of
the injury risk sit.

---

## Tier 3 — Not computable. Not attempted.

### Individual muscle activation

Estimating how hard one specific muscle is working requires static
optimisation to resolve the redundancy between synergists. That method
correlates with measured EMG at roughly **0.26 to 0.48**, and is documented as
[frequently failing to represent experimentally measured muscle activity](https://jneuroengrehab.biomedcentral.com/articles/10.1186/s12984-024-01490-y).

A number that weak, printed on a student's page as "your gluteus maximus was at
62%", would be invention wearing a decimal point. Measuring this properly needs
EMG electrodes on the skin.

### Nerve activity

Not observable from video, by any method. Nerves are not visible and their
activity has no reliable kinematic signature.

The nearest legitimate statement is anatomical rather than measured: certain
positions are known to place certain nerves under tension — a seated forward
fold with the neck flexed loads the sciatic nerve. That is a fact about the
position, not a measurement of the nerve, and it would have to be presented as
such.

### Brain function and cognitive benefit

Not measurable from a video of someone moving. There is no observable in the
image that maps to it.

Evidence about yoga, Pilates or meditation and cognition comes from controlled
trials on **populations**, measuring outcomes with instruments the camera does
not have. That evidence can legitimately be cited as context — "regular
practice of this kind has been associated with X in trials" — but it can never
be presented as a measurement of the person in the video. "Your prefrontal
function improved 12% this session" would be fabrication.

### Bone loading

Bone stress depends on joint reaction forces, which need the muscle forces that
Tier 3 already rules out, plus ground reaction forces. Joint *moments* are
computable; the forces through the bone are not, from video alone.

---

## Tier 4 — Computable, but not about this student

A separate category from the three above, and the one that produces the most
convincing wrong numbers, because nothing about the arithmetic fails.

Every load figure here assumes gravity is the only external force on the body.
Three situations break that assumption without breaking anything visible:

### Hands-on adjustment

An instructor pressing a student's back or lifting their leg is taking part of
the moment. The student's hip flexors are no longer producing what holds the
leg up, and the amount somebody else contributed is not in the image at any
resolution. The number is not noisy; it is a measurement of two people.

Detected from hands arriving at another person's body rather than from
overlapping boxes — students on neighbouring mats overlap constantly without
touching. One camera has no depth, so a hand passing in front of somebody
further back looks exactly like a hand on their shoulder; duration is what
separates them, since a correction lasts seconds and a near-miss lasts a frame.
Affected frames are dropped and counted, never averaged in.

The same signal answers a question that has no visual solution: **which track
is the instructor**. Whoever circulates putting hands on several different
people over a class is doing something no student does. It is offered as a
question — "Instructor? (track #9)" — and settled in the roster by a person,
because naming the wrong track would quietly discard a real student's
measurements.

### Props

A block under the hips, a bolster, a ball, a strap, a resistance band: each
adds an external force of unknown size at an unknown point. Band tension varies
with stretch and is invisible. These are **declared**, not detected — a block
under a hip is occluded by the hip, so asking the studio is both more accurate
and honest about where the knowledge came from.

Declared props invalidate the load estimate. They do not affect geometry:
range, tempo, symmetry and control are unchanged, and still reported.

### Machines

A reformer, chair or cadillac does not merely add a force. The carriage moves,
the springs resist along their own axis, and the body's segments are no longer
a free chain hanging in gravity. This is not an unmeasured term in the right
model; it is the wrong model. Refused outright.

### The exception

Declared hand or ankle weights are handled properly rather than refused: the
mass is stated rather than guessed, and it acts at a keypoint the camera can
already see.

---

## Where reference anatomy fits

Everything above concerns what a camera can compute. A second question sits
alongside it: what can be *looked up*.

Which muscles produce hip flexion, what nerve supplies them, which spinal
levels that nerve comes from, which bones the hip articulates — these are
anatomical facts. They are true of everybody, they do not need a camera, and
refusing to state them would be false modesty rather than rigour.

So they are stated, and labelled `[reference]`. The measurement is labelled
`[measured]`. The two are never merged, because a reader shown one undivided
list will assume the nerve was observed.

The rule that keeps this honest: **reference anatomy is keyed by exercise
name, so it requires a name.** When the recogniser withholds one, no anatomy is
printed. Attaching a real muscle list to a guessed exercise produces something
that looks more authoritative than the measurement and is wrong.

Two further rules follow from the tiers above:

- **Absence is not evidence.** A muscle group anatomy expects, where the
  measurement is silent, is reported with the reason for the silence — usually
  a weight-bearing limb. Never as "this student did not use them".
- **Population findings are a third category.** "Slow breathing is associated
  with increased heart rate variability" is about groups of people in studies.
  It is labelled `[research]`, it ships without a citation until somebody
  attaches one, and it is withheld by default rather than printed in a
  confident tone with nothing behind it.

---

## Why the refusals are the product

Anyone can produce a page of confident numbers. The difficulty is producing
numbers a physiotherapist would not laugh at, and being explicit about the rest.

Every refusal here removes a claim a competitor might happily make. That is the
intended trade: a studio can act on what this says, because it does not say
what it cannot support.

## What would move a line

- **A second camera** moves depth-axis movements from unmeasurable to
  measurable, and improves every Tier 2 estimate. See `docs/depth-ambiguity.md`.
- **A force plate or pressure mat** makes weight-bearing loads computable,
  which is most of standing practice. It would also measure the share an
  instructor's hands were taking, moving Tier 4 adjustments from "dropped" to
  "accounted for".
- **EMG** moves individual muscle activation from Tier 3 to Tier 1, for the
  muscles wearing an electrode.
- **Nothing** moves brain function into range. That one is not a hardware
  problem.
