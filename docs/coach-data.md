# Capturing the coach: how to turn professional judgement into a dataset

**What this document is for.** Not "how should the AI give feedback". The question
here is the one before that: *how do we record what a professional Pilates or
yoga instructor sees, concludes, says and expects, well enough that it can later
serve as ground truth?*

The coach is the expert labeller. The model comes afterwards and is not designed
here.

**What this document replaced.** A five-axis 1–5 rubric that scored a whole
class. It has since been removed from the application entirely, for the reasons
set out here: a scalar score per principle throws away the timestamp, the body
region, the reasoning, the wording and the outcome — which is to say, all of the
things that are actually worth money. What the app now has is a per-structure
reading whose checks the coach writes themselves
(`pilates/structure_eval.py`); that is closer to what this document argues for,
but it is still a studio instrument, not the annotation pipeline described
below.

---

## 1. How professional coaches actually evaluate movement

### 1.1 The pipeline is real, but it is not deliberative

The stage list in the brief — observe → identify → judge importance → decide what
to say → watch the result → decide again — is a fair description of what happens.
What the research says about *how* it happens is the part that changes the design.

Eye-tracking studies of expert coaches and clinicians converge on the same
finding across domains. Experts make **fewer fixations, of longer duration, on
different regions** than novices, who "sweep their gaze more broadly and
frequently". In climbing coaching specifically, expert coaches fixate distinctly
different areas of the display from novices, and that gaze behaviour is
"underpinned by hierarchical and complex knowledge structures relating to the
principles of movement". Expert physical therapists observing a sit-to-stand
transfer gaze at the head region longer and more often than novices — a region a
naive checklist would rank last.

The implication is blunt: **a coach is not running a checklist.** They are
pattern-matching against a stored library, and the region they look at is itself
a product of expertise. A form that walks them through twenty-five body parts in
order does not capture their expertise; it captures their compliance with your
form, and it destroys the very signal — *where did they choose to look, and
what did they choose to ignore* — that distinguishes them from a joint-angle
threshold.

### 1.2 The stages, with what is worth capturing at each

| Stage | What actually happens | Capturable? | Notes |
|---|---|---|---|
| **Client performs** | 1–20 reps, usually with the coach moving position mid-set | Yes — video, ideally 2 angles | Position changes matter: a coach who walks to the side did so *because* of something |
| **Coach observes** | Selective, hierarchical, fast. Gross before fine ("start with the larger muscle groups, then the more subtle elements") | Partially — via what they mark, not via introspection | Gaze data is capturable but expensive; the mark timestamp is a cheap proxy |
| **Coach identifies something** | A discrepancy from an expected pattern fires. Often pre-verbal | **Yes, and this is the highest-value single event** | Call it a *noticing*. One keypress. See §12 |
| **Coach decides whether it is a problem** | Triage against: safety, this person's history, this exercise's purpose, today's energy, how many things they have already said | **Yes, and almost nobody collects it** | The *rejected* noticings are as valuable as the acted-on ones |
| **Coach identifies what it is** | Interpretation: substitution, instability, mobility limit, misunderstanding of the instruction, fatigue, fear | Yes, free text + a light taxonomy | Lower inter-rater agreement than the observation. Keep separate |
| **Coach decides how important** | Not one axis. At minimum: *is it unsafe*, *is it the point of this exercise*, *will it resolve on its own* | Yes, 3–4 buttons | Do not use a slider |
| **Coach decides what to say** | Chooses register (verbal / tactile / imagery / demonstration), chooses wording, chooses whether to name the person | **Yes — verbatim, and this is the generation target** | Recording audio gets this for free and far better than typing |
| **Client attempts correction** | Next rep, or next set, or next week | Yes — same video | The temporal gap is itself a label |
| **Coach observes result** | Did it land, partially land, not land, or produce a new compensation | **Yes, and this is the causal label nobody has** | See §6 |
| **Coach decides again** | Repeat, rephrase, change register, change exercise, or let it go | Yes | "Let it go" is a decision, not an absence |

### 1.3 Two framings worth borrowing, and one to avoid

**Borrow: the kinesiopathologic model (Sahrmann).** Its premise is that
*repeated movement in a specific direction and sustained alignment in a non-ideal
position* induce pathology. This matters enormously for the schema: the unit of
harm is **direction × repetition**, not a posture snapshot. A knee that drifts
once is noise; a knee that drifts on every rep of every session for six weeks is
a finding. Your data model must be able to express "this, repeatedly, in this
direction" or you will train a system that flags single frames.

**Borrow: SOAP.** Pilates instructors working in clinical settings already
document in Subjective / Objective / Assessment / Plan, and in several
jurisdictions are legally obliged to (Australian guidance: notes kept seven
years, reassessment every six weeks, deregistration is possible for insufficient
notes). Coaches already know this shape. Fighting it costs you adoption.

**Avoid: the FMS-style composite score.** The Functional Movement Screen scores
seven patterns 0–3 and sums them. It is genuinely useful as a *common language*
— which is its own lesson — but as a label it collapses everything into an
ordinal with documented reliability problems (see §10). Borrow its vocabulary;
do not borrow its scalar.

---

## 2. What a coach observes

This is the list, split the way the brief correctly demands — because **what can
be seen, what can be heard, and what is concluded have different reliability and
different downstream uses, and merging them is the most common way movement
datasets go wrong.**

### 2.1 Visual — directly observable, low interpretation

Grouped as instructors actually work: gross first, then regional, then fine.

**Whole-body / gross**
- Overall alignment against gravity; where the mass is
- Base of support and weight distribution (left/right, fore/aft, through which part of the foot or hand)
- Symmetry, left against right, in position and in timing
- Global movement quality: smooth vs jerky, continuous vs stuttering
- Tempo and rhythm; whether the tempo matches what was asked
- Whether the movement starts and ends where it was supposed to
- Effort visible in the face, jaw, hands, neck

**Spine and trunk**
- Lumbar position: neutral, imprinted, extended, flexed; and whether it *stays*
- Thoracic contribution vs lumbar contribution to a flexion or extension
- Rib cage position: knitted vs flaring; whether ribs move with the arms
- Segmental articulation — does the spine roll bone by bone or move as a block
- Which segment the movement "hinges" at (a hinge point is a classic finding)
- Lateral shift; rotation coupled to a flexion that should be pure

**Pelvis and hips**
- Neutral vs anterior vs posterior tilt, and whether that is held or gripped
- Lateral tilt (one ASIS higher), rotation (one ASIS forward)
- Hip hinge vs lumbar flexion — which one is producing the range
- Femoral position: internal/external rotation, adduction drift

**Shoulder girdle**
- Scapular resting position; elevation, protraction, winging
- Scapulohumeral timing — does the scapula move before the arm should
- Whether the scapula is *organised* or *pinned* (over-cueing artefact)
- Shoulder shrug appearing as load increases

**Head, neck, gaze**
- Cervical curve continuing the spine, or chin poking / jamming
- Head position drifting as effort rises
- Where the client is looking, which often drives the neck

**Extremities**
- Knee tracking relative to foot; valgus/varus drift; hyperextension
- Foot: arch behaviour, weight through the tripod, toe gripping
- Ankle dorsiflexion available vs used
- Elbow position; wrist extension under load
- Hand pressure distribution in quadruped and plank positions

**Movement dynamics**
- Range of motion actually used vs available
- Where in the range control is lost (usually not at the end)
- Control on the eccentric vs the concentric — almost always the eccentric fails first
- The moment of transition between phases
- Tremor, wobble, or micro-corrections
- Compensation: what moved that should not have, to make the target move

**Breath (visible)**
- Whether they are breathing at all
- Where the breath goes: apical, belly-only, three-dimensional rib expansion
- Whether the breath is coupled to the movement phase or fighting it
- Breath-holding at the hardest point

**Equipment and setting (Pilates-specific)**
- Spring load and whether it is right for this person today
- Carriage/footbar behaviour — does the carriage bang, drift, or hesitate
- Prop use; whether the prop is doing the work
- Hand and foot placement on the apparatus

### 2.2 Audible and behavioural — heard, or inferred from conduct

- Breath sounds; audible holding; a sharp inhale at a moment of effort
- The client's own words: "I feel this here", "is that right?", "ow"
- Requests, hesitations, and the pause before an answer
- Facial expression, wincing, jaw clench, brow
- Whether they attempted the correction, and how fast
- Whether they understood the instruction — attempting the *wrong thing
  confidently* is a different label from not attempting
- Fatigue markers appearing across the set
- Fear or guarding, especially around a known injury
- Compliance patterns: do they always do this on the left and not the right
- Off-hand comments that recontextualise everything ("I slept badly", "my back
  was sore after last week")

**This category is systematically missing from every existing dataset**, because
every existing dataset is built from video of a body, and this is a record of a
*person*. It is also the cheapest to capture, because a microphone gets most of
it.

### 2.3 Interpretation — what the coach concludes

This is a different epistemic object from the two above and must live in a
different field. Typical interpretations:

- **Substitution** — a stronger muscle group is doing another's job (hip flexors
  for lower abdominals; upper traps for lower traps; hamstrings for glutes)
- **Insufficient stability** proximally, showing up distally
- **Mobility limitation** — the range genuinely is not there, at a named joint
- **Motor control / sequencing** — the parts are available but fire in the wrong order
- **Misunderstanding** — they are doing precisely what they think you asked
- **Fatigue** — it was fine for six reps and is not fine now
- **Fear / guarding** — often around a documented injury
- **Load is wrong** — the spring, the lever, the prop
- **Anatomical variation** — this is what their hip does; it is not correctable
- **Habit imported from elsewhere** — a runner's pelvis, a desk worker's thoracic spine
- **Today** — slept badly, ran yesterday, stressed

An interpretation is **inherently lower-agreement** than an observation, and that
is not a defect. Two coaches will agree that the left hip came forward and
disagree about why. If you merge the two fields you inherit the *lower* of the two
agreement rates for both. Keep them apart and you get a high-agreement perception
label and a genuinely interesting low-agreement reasoning label.

---

## 3. What a coach thinks and interprets — the four registers

The brief's section 7 is correct and is the single most important structural
decision in this document. Four registers, four fields, never merged:

| Register | Question it answers | Example | Agreement | Downstream use |
|---|---|---|---|---|
| **SEE** | What is observably true? | "Left ASIS is forward of the right at the top of every roll-up" | Highest | Perception target; the thing pose estimation could in principle verify |
| **THINK** | Why is that happening? | "She's initiating with the right hip flexor and letting the pelvis follow" | Low–moderate | Diagnosis target; the genuinely expert layer |
| **SAY** | What did you actually do about it? | "Both hip bones to the ceiling — like headlights facing straight up" | N/A (it is a fact, not a judgement) | Generation target; the product |
| **EXPECT** | What should have happened? | "Pelvis stays square through the whole range at this level" | Moderate | The **norm**, and the field nobody records |

**EXPECT is the one that fixes the "perfect form" problem.** Datasets encode a
fake ideal because the standard is implicit in the label. If a coach writes down
what they were holding this *particular person* to on this *particular day*, you
learn that the standard is conditional — on experience level, on injury history,
on the purpose of the exercise. Two coaches disagreeing about a knee often turn
out to agree completely once you can see they were applying different EXPECTs.
Without the field, that looks like noise.

**SAY must be verbatim.** A paraphrase ("told her about her pelvis") destroys the
asset. The specific words are the product: imagery vs anatomy vs external focus.
Which brings us to the one piece of hard evidence about cue *quality*:

> Twenty-five years of work by Wulf and colleagues shows an **external focus**
> (on the movement's effect) beats an **internal focus** (on the body part)
> for performance and learning, across tasks, skill levels and ages.
> "Push your knee towards the band" outperforms "activate your glute medius".

So the SAY field should also be *classifiable* — internal / external / imagery /
tactile / demonstration / negative-instruction — because that classification is
itself a research finding waiting to be extracted. Do not ask the coach to
classify it. Classify it afterwards from the verbatim text.

---

## 4. What a coach says — the intervention

Instructor training material consistently names four registers of cue, and they
are not interchangeable:

1. **Verbal — analytical.** Anatomical, precise. "Draw the ribs down towards the
   pelvis." Works on experienced clients and on people with body-awareness
   training; lands badly on beginners.
2. **Verbal — figurative / imagery.** "Zip up a tight pair of jeans." Instructor
   guidance is explicit that imagery only works when the client has *a prior
   somatic experience to map onto* — the practical order is establish the felt
   sense first (tactile, or a simpler movement), then add the image.
3. **Tactile.** Widely described in Pilates teaching as the most direct and
   time-efficient method — and the one with the largest consent and
   record-keeping implications. **A tactile cue is invisible on video.** If you
   do not capture it explicitly you will have unexplained corrections in your
   data: the client suddenly improves and nothing in the record says why.
4. **Visual / demonstration.** The coach shows it. Also invisible in a video
   framed on the client.

Plus the meta-decisions that are part of "what to say":
- **Say nothing** (and the reason: not now / not important / already said it / they are working it out)
- **Change the exercise** rather than cue it
- **Change the load** — spring, lever, prop
- **Stop** — safety

A dataset that only contains verbal cues on a client-framed camera will contain
systematic unexplained variance. Design for registers 3 and 4 from day one.

---

## 5. What a coach records today

**The honest finding: very little, and almost none of it is structured.**

What exists:

- **SOAP notes.** Real, used, and in clinical Pilates settings legally required.
  Subjective (what the client reported), Objective (what was observed and done),
  Assessment (interpretation), Plan (next session). Australian professional
  guidance: full initial assessment, brief subsequent notes in the same format,
  formal reassessment every six weeks, notes retained seven years, signed and
  dated, and administrative time budgeted *even for group classes*.
- **Intake and screening forms.** Near-universal. PAR-Q+ or equivalent, injury
  history, goals, contraindications, consent for tactile cueing.
- **Standardised movement screens.** FMS (seven patterns, 0–3), SFMA, and
  in-house postural assessments. Used at intake and periodically, not per-session.
- **Studio management software notes.** Free-text boxes, per client, per session.
  Overwhelmingly the real-world artefact.
- **Programme cards.** The exercise list, springs, reps, and modifications for
  this client — the operational document a coach actually re-reads.

What does **not** exist in any standard form:
- A per-repetition record of anything
- Timestamps
- A record of the cue given, in the coach's words
- Any record of whether the cue worked
- Any record of a noticed-but-ignored problem

That last group is your entire dataset. **You are not digitising an existing
practice — you are asking coaches to produce something they have never produced.**
Everything in §12 follows from taking that seriously: it must be fast, it must
feel like coaching, and it must pay them back with something they want.

---

## 6. The coach → client → coach loop

This is the crown jewel and the clearest whitespace in the literature. Every
public dataset in §15 labels *a performance*. None labels *an intervention and
its effect*.

### 6.1 The structure

```
observation_event
  ├── SEE / THINK / EXPECT           at t0, region R, rep n
  ├── triage decision                 (cue it / let it go / stop the exercise)
  └── if cued:
        intervention
          ├── register                (verbal / tactile / imagery / demo / load / exercise change)
          ├── verbatim text or audio span
          ├── t1                      when it was delivered
        └── response
              ├── attempted?          (yes / no / could not tell)
              ├── understood?         (yes / did something else / asked a question)
              ├── outcome             (resolved / partial / unchanged / new compensation / worse)
              ├── measured over       (next rep / rest of set / next exercise / next session)
              └── coach's next move   (nothing / repeat / rephrase / change register / change exercise / stop)
```

### 6.2 Why each field earns its place

- **Attempted vs understood vs succeeded are three different failures.** A cue
  that is ignored, a cue that is misunderstood, and a cue that is understood and
  attempted but does not produce the change are three distinct data points with
  three distinct fixes. Collapsing them into "did it work" throws away most of
  the information.
- **"New compensation appeared"** is the outcome that matters most clinically and
  is the one a naive system will never learn. Fixing the knee by locking the
  ankle is not a fix.
- **The measurement window** matters because a cue that works for one rep and
  decays is a different object from one that holds. This is also the honest place
  to record "I could not tell" — which will be common and must be a first-class
  value, not a missing field.
- **The next move** closes the loop and is the label for *persistence strategy*:
  how many times does an expert repeat before switching registers?

### 6.3 The negative examples are the point

Machine learning on this data will only be as good as its negatives. Three kinds
must be deliberately captured:

1. **Noticed, not cued.** Triage. The most under-collected label in movement AI
   and the reason existing systems are unbearable to use — they flag everything.
2. **Cued, did not work.** The counterfactual for cue selection.
3. **Nothing noticed.** A clean rep, explicitly marked clean, is a label. An
   unannotated rep is ambiguous between "clean" and "not reviewed", and that
   ambiguity will poison training. Make "clean set" one press.

---

## 7. Exactly what to collect

### 7.1 The three layers, and the thing that joins them

```
LAYER 1  MOVEMENT      video (2 angles), audio, derived pose, timestamps
LAYER 2  CONTEXT       who, what exercise, what load, what history, what happened today
LAYER 3  JUDGEMENT     the coach's observation events and the loop
                       ─────────────────────────────────────────────
JOIN KEY               a single monotonic session clock, in milliseconds
```

**Every stream must be stamped against one clock.** This is the least glamorous
and most frequently botched decision in a study like this. Camera clocks drift,
phone recordings start late, the annotation tool has its own idea of zero. Put a
visible and audible sync marker at the start of every capture (a clap on camera
is sufficient and free) and store every annotation as an offset from it.

### 7.2 Per capture

| Stream | Detail | Why |
|---|---|---|
| Video A | Frontal or 3/4, whole body in frame, 30 fps min, 1080p | Primary |
| Video B | Sagittal (side) | Spine, hip hinge and knee tracking are near-invisible frontally |
| Audio | Lapel on the **coach**, room mic as backup | The coach's words are the product. A room mic in a reformer studio picks up springs and nothing else |
| Pose | Derived offline, not captured | Do not spend study budget on motion capture. See §17 |
| Apparatus state | Spring setting, footbar, box, props — typed once per exercise | The single most-forgotten fact and the first thing needed next session |

### 7.3 Per person, once

Demographics as needed, plus: training history and years, injury history and
current restrictions, screening answers, goals, anatomical notes the coach makes
at intake (hip structure, torso:limb proportion, hypermobility), and **consent**,
separately, for: recording, tactile cueing, research use, and publication.

### 7.4 Per session

Date, coach, studio, exercises in order, and a 60-second close: what changed
since last time, what is next, overall effort, anything unusual today.

---

## 8. The coach annotation schema

Designed so that **the mandatory core is four fields** and everything else is
optional. A schema whose mandatory set is large is a schema that gets filled in
once.

### 8.1 `observation_event` — the unit

| Field | Type | Obj/Subj | Standardisable | Required | Notes |
|---|---|---|---|---|---|
| `id` | uuid | — | — | ✓ | |
| `session_id`, `coach_id`, `client_id` | ref | — | — | ✓ | |
| `exercise_id` | ref to library | objective | ✓ | ✓ | Free text if not in library; the free text *is* a finding |
| `t_start`, `t_end` | ms on session clock | objective | ✓ | ✓ | `t_end` may equal `t_start` for an instant |
| `rep_index` | int, nullable | objective | ✓ | — | Auto-derived where possible; never ask a coach to count |
| `phase` | enum: setup / concentric / eccentric / hold / transition / return / whole | objective | ✓ | — | |
| `region` | enum, ~18 values, from a body figure | objective | ✓ | ✓ | Clicked on a diagram, never a dropdown |
| `side` | left / right / both / n-a | objective | ✓ | — | |
| `see` | text ≤200 | **objective** | partly | ✓ | The one required prose field |
| `think` | text ≤300 | **subjective** | no | — | |
| `expect` | text ≤200 | subjective | partly | — | Prompted, not forced. See §11 |
| `issue_type` | enum, ~14 values | subjective | ✓ | — | Chosen *after* `see` is written, never before |
| `acceptability` | enum: unsafe / dysfunctional / acceptable-variation / preference | subjective | ✓ | ✓ | **Not severity.** See §11 |
| `matters_because` | enum: safety / purpose-of-exercise / their-goal / long-term-pattern / aesthetics-only | subjective | ✓ | — | |
| `confidence` | enum: sure / fairly / guessing | subjective | ✓ | ✓ | Cheap, and it is the field that makes disagreement analysable |
| `visible_in` | enum: video-a / video-b / both / not-visible-on-camera | objective | ✓ | ✓ | The honesty field. Flags what pose could never recover |
| `cued` | bool | objective | ✓ | ✓ | **False is a valid and valuable value** |
| `not_cued_because` | enum: not-important / not-today / already-said / let-them-find-it / no-time / not-my-call | subjective | ✓ | conditional | Required when `cued = false` |

### 8.2 `intervention` — zero or more per event

| Field | Type | Notes |
|---|---|---|
| `t_delivered` | ms | |
| `register` | enum: verbal / tactile / imagery / demonstration / load-change / exercise-change / stop | Multi-select; coaches routinely stack two |
| `verbatim` | text | **Pre-filled from ASR at `t_delivered`; the coach corrects rather than composes** |
| `audio_span` | (t0, t1) | Keeps the original even after editing |
| `target` | enum: same as `region`, or `whole-person` | The cue's target is not always the observation's region |
| `named_client` | bool | Whether it was addressed to them by name — group-class dynamics |

### 8.3 `response` — zero or one per intervention

| Field | Type | Notes |
|---|---|---|
| `attempted` | yes / no / could-not-tell | |
| `understood` | yes / did-something-else / asked / could-not-tell | |
| `outcome` | resolved / partial / unchanged / new-compensation / worse / could-not-tell | |
| `new_compensation_region` | enum | Required if `outcome = new-compensation` |
| `window` | next-rep / rest-of-set / later-in-session / next-session | |
| `next_move` | nothing / repeat / rephrase / change-register / change-exercise / stop | |

### 8.4 `clean_span` — the negative

| Field | Type | Notes |
|---|---|---|
| `t_start`, `t_end` | ms | |
| `exercise_id` | ref | |
| `nothing_worth_saying` | bool = true | One press. Distinguishes "clean" from "not reviewed" |

### 8.5 What is deliberately absent

No joint angles. No degrees. No "score out of 5" on the event. No muscle names as
a required field. No pain scale. See §13.

---

## 9. Live vs video vs hybrid

### 9.1 The trade

| | Live | Video |
|---|---|---|
| Natural triage | ✓✓ Genuine — they have limited time and attention | ✗ Unlimited replay changes what counts as a problem |
| Verbatim language | ✓✓ Real coaching language | ✗ Written cues are stiffer and shorter than spoken ones |
| Timestamp precision | ✗ | ✓✓ |
| Structured fields | ✗ Cannot fill a form and teach | ✓✓ |
| Sees tactile/demo | ✓ | ✗ unless a second camera catches the coach |
| Coach cost | Zero extra | 3–8× real time |
| Recall bias | None | Some — but bounded if done same-day |

### 9.2 Recommendation: hybrid, in this exact order

**Pass 0 — live, zero friction.** The coach teaches normally, wearing a lapel
mic. **They do nothing else.** This is not a preliminary step, it is a data
source: a coach talking during a class is already labelling, in natural
language, at natural rates, at zero marginal cost. Automatic speech recognition
plus speaker diarisation over the class audio yields the entire SAY register
without asking anyone for anything.

**Pass 1 — same day, the noticing pass.** Video plays at normal speed. One key
marks a noticing. No fields, no pausing, no scrubbing. Two to three minutes per
clip. This preserves triage — because it is watched once, at speed, like a class.

**Pass 2 — the fill pass, on the marks only.** Now scrubbing, slow motion and
structure are allowed, because the *decision* about what mattered has already
been made under realistic constraints. Five to eight minutes per clip.

**Pass 3 — the session close.** Sixty seconds.

The ordering is the whole trick. Marking under time pressure and filling under no
time pressure gives you natural triage *and* precise structure. Doing it in one
pass gives you neither.

**Total coach burden: roughly 10–12 minutes of annotation per 10 minutes of
video**, or about 1.1× real time, versus 3–8× for conventional video annotation.

---

## 10. Handling coach disagreement

### 10.1 What the reliability literature actually says

This is the section that should determine your design, so the numbers are worth
stating plainly:

- **Visual estimation of joint angles in gait**: intra-rater generally above 0.6;
  **inter-rater 0.04 to 0.59.** Neither reached a level considered sufficient,
  and validity against reference values was limited.
- **Multi-segmental single-leg squat**: inter-rater agreement ranged from
  *moderate* (knee) to *almost perfect* (foot) — same test, same raters, wildly
  different by region.
- **Lower-extremity functional screening**: intra-rater slight→almost perfect,
  inter-rater fair→good. Agreement **improved with clinical experience and with
  dichotomous rather than graded rating.**
- **FMS**: inter-rater percentage agreement 60–90%; kappa 0.12–0.79.

Four design rules fall straight out:

1. **Never treat one coach's label as ground truth.** Not for anything.
2. **Ask dichotomous or 3-level questions where you need agreement.** The
   evidence that dichotomous rating improves agreement is direct. This is the
   strongest single argument against the 1–5 scale as a labelling instrument.
3. **Regional/gross judgements are reliable; fine angular ones are not.** Ask
   "did the pelvis stay level" (reliable), never "how many degrees" (not).
4. **Longitudinal comparison should use the same coach** wherever possible,
   because intra-rater reliability is consistently and substantially higher than
   inter-rater.

### 10.2 Represent disagreement; do not resolve it

Store **every** coach's annotation. There is no `gold_label` column.

```
observation_event  ──< annotation >── coach
                        └── all the §8 fields, per coach
```

Then compute, per event, a **consensus object** rather than a consensus label:

| Derived field | How |
|---|---|
| `n_annotators` | count |
| `noticed_rate` | of coaches who reviewed this span, how many marked anything here |
| `region_agreement` | Krippendorff's α on `region` (nominal) |
| `acceptability_distribution` | the full histogram, kept, not collapsed |
| `cue_rate` | fraction who would have said something |
| `contested` | flag when `acceptability` spans the unsafe/acceptable boundary |

Krippendorff's α is the right statistic here rather than Cohen's or Fleiss' κ: it
handles missing data (coaches will not all annotate everything), any number of
raters, and mixed measurement levels — which is exactly this dataset's shape.

### 10.3 Disagreement is a target, not a defect

Three uses for it that a collapsed label destroys:

- **Calibration.** A model that outputs "70% of coaches would flag this" is more
  honest and more usable than one that says "error detected". A system that only
  flags what 90% of coaches would flag is one people will actually leave switched on.
- **Curriculum.** High-agreement events are the training set. Contested events
  are the evaluation set and the research question.
- **Detecting schema failure.** If agreement on a particular `issue_type` is
  persistently low, the category is badly defined — the same finding as in text
  annotation, where poorly-comprehended labels are exactly the ones where
  agreement collapses. Low α on a field is a bug report about your ontology.

**Overlap budget:** have every coach annotate a shared 15–20% of clips. That is
enough for stable α estimates without paying for full redundancy.

---

## 11. Anatomical variation and the "perfect form" trap

The deepest risk in this whole project: train on labels that assume one correct
position and you build a system that tells a person with retroverted hips that
their squat is wrong for ever.

### 11.1 Separate acceptability from severity

The single most important schema decision after the four registers. **Severity
answers "how bad", which presumes it is bad.** Acceptability answers "is it bad
at all", which is the contested question:

| Value | Meaning | Example |
|---|---|---|
| `unsafe` | Stop or modify now | Loaded lumbar flexion in someone with a disc history |
| `dysfunctional` | Not dangerous, but working against the purpose | Hip flexors doing an abdominal exercise's job |
| `acceptable-variation` | Different from the textbook, fine for **this** body | Wider foot stance because of hip structure |
| `preference` | The coach would do it differently; the client is not wrong | Arm position in a side-lying series |

The last two are the ones nobody records and the ones that prevent a fake ideal.
A dataset where every annotation is `unsafe` or `dysfunctional` is a dataset
where coaches were only asked about problems.

### 11.2 Record the standard, not just the deviation

The `expect` field again. Prompt for it specifically when a coach marks something
`acceptable-variation` or `preference` — that is exactly when the standard being
applied is interesting and non-obvious.

### 11.3 Structural notes at intake

A short, coach-authored, per-person list of things that are **not correctable and
must never be flagged**: hip anteversion/retroversion, femoral neck angle,
torso-to-limb proportion, hypermobility, fused or fixed segments, amputation or
prosthesis, permanent range restriction. Attach to the client, apply to every
session, and treat as a hard suppression list downstream. This is also the
single clearest safety feature you can offer a studio.

### 11.4 Philosophy is a variable

Classical vs contemporary Pilates; Iyengar vs vinyasa vs somatic yoga; STOTT vs
BASI vs Polestar. These schools genuinely disagree about neutral pelvis, about
whether scapulae should be depressed, about knee-over-toe. **Record each coach's
training lineage as a field on the coach**, and you can measure whether a
disagreement is idiosyncratic or systematic. Two coaches disagreeing is noise;
two *schools* disagreeing is a finding, and one you must not average away.

---

## 12. The annotation interface

Design principle: **the coach should feel like they are coaching, not filling in
a survey.** Every second of friction costs you data, and coaches are expensive.

### 12.1 Pass 1 — the noticing pass

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                     [ video, playing ]                   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  ▓▓▓░░░░▓░░░░░░▓▓░░░░░░░░░░░▓░░░░░░░░░░░  0:42 / 2:10    │
│      ▲      ▲     ▲              ▲                       │
└──────────────────────────────────────────────────────────┘
     SPACE = I noticed something        C = that set was clean
```

That is the entire interface. No pause. No scrub. No fields. It plays once, at
speed. The marks land on the timeline; a mark can be nudged later.

Two keys, because two keys is the difference between a coach doing this for
forty clips and doing it for four.

### 12.2 Pass 2 — the fill pass

For each mark, in sequence. The clip loops a 6-second window around the mark.

```
┌─── mark 3 of 7 ─────────────── 0:38 ── [◀ 2s] [▶] [0.25×] ──┐
│                                                              │
│   [ looping 6-second window ]        ┌──────────────┐        │
│                                      │   ○ head     │        │
│   What did you see?                  │   ○ neck     │        │
│   ┌────────────────────────────┐     │  ○○ shoulders│        │
│   │ left hip drifts forward at │     │   ○ ribs     │        │
│   │ the top                    │     │   ● pelvis   │  ← click│
│   └────────────────────────────┘     │  ○○ hips     │    the  │
│                                      │  ○○ knees    │   figure│
│   Why? (optional)                    │  ○○ feet     │        │
│   ┌────────────────────────────┐     └──────────────┘        │
│   │                            │      left ◉ right ○ both ○  │
│   └────────────────────────────┘                             │
│                                                              │
│   Is it?   [ unsafe ][ working against it ][ fine for her ][ my preference ]│
│   Sure?    [ sure ][ fairly ][ guessing ]                    │
│   Visible? [ front ][ side ][ both ][ can't see it on camera ]│
│                                                              │
│   ─── You said, at 0:39: ──────────────────────────────────  │
│   │ "both hip bones facing straight up — like headlights"  │ │
│   │                            [ that's right ] [ edit ]   │ │
│   ─────────────────────────────────────────────────────────  │
│   Also:  [ hands on ] [ showed her ] [ changed the spring ]  │
│                                                              │
│   Then?  [ fixed ][ partly ][ no change ][ something else    │
│           went wrong ][ couldn't tell ]                      │
│                                                              │
│              [ I didn't say anything — because ▾ ]           │
└──────────────────────────────────────────────────────────────┘
```

### 12.3 The rules behind that layout

| Control | Widget | Why |
|---|---|---|
| Body region | **Clickable figure** | A coach thinks in bodies. A dropdown of eighteen anatomical terms is a reading task |
| Acceptability | 4 buttons | Fewer than 6 options ⇒ never a dropdown |
| Confidence | 3 buttons | |
| Severity | **absent** | Deliberately. See §11.1 |
| `see` / `think` | Free text, autocompleting from this coach's own history | Their phrasing is the data. Autocomplete speeds them up without imposing vocabulary |
| `issue_type` | Suggested **after** `see` is typed, from the text | Showing the taxonomy first anchors them to it and destroys the free text |
| Verbatim cue | **Pre-filled from ASR, one click to accept** | The single largest speed win available. Correcting beats composing by roughly 10× |
| Outcome | 5 buttons, one of which is "couldn't tell" | An honest "don't know" must be as cheap as a confident answer, or you get confident answers |
| Timestamps | Never typed | |
| Anything numeric | Never typed | |

### 12.4 Non-negotiables

- **"Couldn't tell" and "didn't say anything" must each be one press.** If honesty
  is more expensive than certainty, you get certainty and it is fake.
- **Autosave every field on change.** A coach who loses twenty minutes of work
  never returns.
- **Show progress and time remaining.** "4 of 7 marks · about 3 minutes left".
- **Pay the annotation back.** The single strongest retention lever: the same
  annotations generate the client's progress view and the coach's pre-class
  sheet. A coach annotating purely for your dataset stops in week three. A coach
  whose annotation writes their own session notes keeps going.
- **Keyboard-first throughout.** 1–4 for acceptability, arrow keys between marks.

---

## 13. What not to ask a coach to do

Each of these produces actively harmful data — worse than no data, because it
looks usable.

| Do not ask | Why |
|---|---|
| **Estimate joint angles in degrees** | Inter-rater reliability for visual joint-angle estimation is 0.04–0.59 with limited validity against reference values. You would be paying an expert to generate noise, and then training on it |
| **Count repetitions** | Derivable from pose. Tedious, error-prone, and it is the one thing the machine already does better |
| **Score a whole session out of 5 or 100** | Non-comparable across coaches, non-decomposable, and it discards the location of the problem — everything that makes the label useful |
| **Name the muscle that is or is not firing** | They can see the *effect*; they cannot see activation. Let them describe the effect ("the shoulder is doing the work") and infer the muscle later. Forcing the muscle name manufactures false precision |
| **Give a medical diagnosis** | Outside scope of practice for most instructors, a liability, and unreliable |
| **Rate pain** | The client rates pain. The coach records what the client said |
| **Annotate something they cannot see on camera** | Hence the `visible_in` field. "I know she does this but you can't see it here" is a legitimate and useful answer |
| **Use your taxonomy before their own words** | Anchoring. Free text first, category second, always |
| **Annotate a client they have never taught** | Coaching judgement is contextual — history, goals, what was said last week. A cold read is a different task, and if you want it, label it as one |
| **Watch in slow motion during the noticing pass** | Destroys triage. Reserve it for the fill pass |
| **Fill in more than ~4 required fields per event** | Field count is inversely proportional to honesty. Long forms get satisficed |

---

## 14. Example records

Fifteen realistic events. Note how often `cued` is false, how often confidence is
not "sure", and how often the outcome is "couldn't tell" — that distribution is
what a truthful dataset looks like, and a dataset without it has been filled in
to please you.

**1 — the canonical case, cue works**
```yaml
exercise: reformer footwork, parallel heels     t: 00:41.2   rep: 4/10
region: pelvis   side: left      phase: concentric
see:    "left hip drifts forward as the carriage goes out"
think:  "she's pushing harder through the right leg — habit from the right knee"
expect: "pelvis square through the whole press at her level"
issue_type: asymmetry            acceptability: dysfunctional
matters_because: long-term-pattern
confidence: fairly               visible_in: video-a
cued: true
  intervention: {register: [verbal], t: 00:44.0,
                 verbatim: "even pressure through both feet — imagine the carriage
                            is going out perfectly straight", target: pelvis}
  response:     {attempted: yes, understood: yes, outcome: resolved,
                 window: rest-of-set, next_move: nothing}
```

**2 — noticed, deliberately not cued (the label nobody collects)**
```yaml
exercise: hundred                               t: 01:12.8   rep: 3/10
region: neck     side: both      phase: hold
see:    "chin tucking towards the chest, head heavy in the hands"
think:  "neck flexors fatiguing — it's rep 3, she'll self-correct"
acceptability: dysfunctional     confidence: sure    visible_in: video-b
cued: false      not_cued_because: let-them-find-it
```

**3 — cue misunderstood**
```yaml
exercise: roll-up                               t: 00:22.5   rep: 2/6
region: ribs     side: both      phase: concentric
see:    "ribs flare at the start of the roll-up, low back arches off the mat"
think:  "she's initiating with thoracic extension instead of head-and-arms"
expect: "ribs stay down, head leads"
issue_type: sequencing           acceptability: dysfunctional
confidence: sure                 visible_in: video-b
cued: true
  intervention: {register: [verbal, imagery], t: 00:25.1,
                 verbatim: "soften the front ribs down towards your hips first"}
  response:     {attempted: yes, understood: did-something-else,
                 outcome: new-compensation, new_compensation_region: neck,
                 window: next-rep, next_move: change-register}
```

**4 — the follow-up to 3, register changed to tactile**
```yaml
exercise: roll-up                               t: 00:31.0   rep: 3/6
region: ribs     side: both
see:    "same rib flare, now with the chin jammed down as well"
cued: true
  intervention: {register: [tactile], t: 00:32.4,
                 verbatim: "feel my hand here — melt the ribs away from it",
                 note: "hand flat on lower sternum, consent on file"}
  response:     {attempted: yes, understood: yes, outcome: partial,
                 window: rest-of-set, next_move: nothing}
```

**5 — acceptable variation, not an error**
```yaml
exercise: standing footwork                     t: 00:08.0
region: feet     side: both      phase: setup
see:    "feet turn out about 20 degrees rather than parallel"
think:  "that's her hip structure — she can't hold parallel without the knees
         collapsing in. This is the right stance for her"
expect: "parallel is the default; for her, this is parallel"
acceptability: acceptable-variation
matters_because: safety          confidence: sure     visible_in: video-a
cued: false      not_cued_because: not-important
structural_note_ref: client.structural[hip_external_rotation]
```

**6 — coach preference, explicitly flagged as such**
```yaml
exercise: side-lying leg series                 t: 02:03.0
region: shoulders side: both
see:    "top arm propped on the hip rather than reaching along the body"
think:  "I teach it reaching but there's nothing wrong with this"
acceptability: preference        confidence: sure
cued: false      not_cued_because: not-important
```

**7 — unsafe, exercise stopped**
```yaml
exercise: teaser                                t: 03:44.0   rep: 1/5
region: lumbar   side: n-a       phase: concentric
see:    "sharp lumbar hinge at L4-5, whole spine loads at one point"
think:  "she has a disc history — this is loaded flexion at exactly the wrong segment"
expect: "articulation through the whole spine, or not this exercise"
acceptability: unsafe            matters_because: safety
confidence: sure                 visible_in: video-b
cued: true
  intervention: {register: [stop, exercise-change], t: 03:45.5,
                 verbatim: "let's park that one — come down and we'll do the
                            half roll-back with the band instead"}
  response:     {attempted: yes, understood: yes, outcome: resolved,
                 window: later-in-session, next_move: change-exercise}
```

**8 — coach cannot see it on camera**
```yaml
exercise: quadruped                             t: 01:55.0
region: hands
see:    "I can feel from where she is that her weight is in the heel of the hand,
         but you can't see it from this angle"
acceptability: dysfunctional     confidence: fairly
visible_in: not-visible-on-camera
cued: true
  intervention: {register: [verbal], verbatim: "spread the fingers and press the
                 base of the index finger down"}
  response:     {attempted: yes, understood: yes, outcome: could-not-tell,
                 window: next-rep, next_move: nothing}
```

**9 — from the client's behaviour, not the movement**
```yaml
exercise: chest expansion                       t: 00:15.0
region: whole-person
see:    "she asked 'is this right?' halfway through the second rep"
think:  "she doesn't know what she's supposed to feel — my setup cue was vague"
issue_type: instruction-unclear   acceptability: dysfunctional
matters_because: purpose-of-exercise
confidence: sure
cued: true
  intervention: {register: [demonstration], verbatim: "let me show you — watch
                 where my shoulder blades go"}
  response:     {attempted: yes, understood: yes, outcome: resolved}
note: "my fault, not hers"
```

**10 — breath**
```yaml
exercise: spine stretch forward                 t: 02:20.0   rep: 2/5
region: whole-person             phase: concentric
see:    "holding the breath through the whole forward phase"
think:  "concentrating hard on the articulation and forgetting to breathe —
         normal at this stage"
acceptability: dysfunctional     confidence: sure    visible_in: both
cued: true
  intervention: {register: [verbal], verbatim: "breathe out as you go over —
                 let the air push you further"}
  response:     {attempted: yes, understood: yes, outcome: partial,
                 window: rest-of-set, next_move: repeat}
```

**11 — clean span (the essential negative)**
```yaml
type: clean_span
exercise: short spine massage    t: 04:10.0 – 05:02.0
nothing_worth_saying: true
note: "best I've seen her do it"
```

**12 — contested: coach A**
```yaml
coach: A       exercise: single leg stretch     t: 01:30.0   rep: 5/10
region: knees  side: left
see:    "left knee falls slightly inside the line of the hip on the pull-in"
acceptability: dysfunctional     confidence: fairly
cued: true
  intervention: {register: [verbal], verbatim: "knee towards your shoulder, not
                 across your body"}
```

**13 — the same moment, coach B**
```yaml
coach: B       exercise: single leg stretch     t: 01:30.0   rep: 5/10
region: knees  side: left
see:    "knee tracks slightly in but the pelvis stays completely still"
think:  "that's within normal for her hip width — the pelvis is what I'd watch
         and it's fine"
acceptability: acceptable-variation   confidence: fairly
cued: false    not_cued_because: not-important
# → derived: contested = true; acceptability spans dysfunctional/acceptable;
#   both fairly confident; note both wrote nearly the same `see`.
#   The disagreement is in the standard, not the perception. This is the
#   single most valuable record type in the set.
```

**14 — decay across the session**
```yaml
exercise: footwork (second set)                 t: 06:40.0   rep: 2/10
region: pelvis   side: left
see:    "the left hip drift from earlier is back"
think:  "it held for the rest of that set and has decayed. Needs a different
         approach, not a repeat"
issue_type: asymmetry            acceptability: dysfunctional
confidence: sure
links_to: event_1
cued: true
  intervention: {register: [load-change], verbatim: "let's drop to two reds —
                 I'd rather it be even than heavy",
                 apparatus_change: {springs_before: "3 red", springs_after: "2 red"}}
  response:     {attempted: yes, understood: yes, outcome: resolved,
                 window: rest-of-set, next_move: nothing}
```

**15 — session close**
```yaml
type: session_close
effort: steady
changed_since_last: "rib control on the roll-up is genuinely better — didn't
                     need the hands-on cue until rep 3, last week it was rep 1"
next_time: "start with the band half roll-back before anything loaded.
            Left hip: try single-leg work rather than cueing it in bilateral"
unusual_today: "said she slept badly"
```

---

## 15. Existing datasets and what they are worth

Ranked by how much **expert human judgement** they contain, which is the only
axis that matters here.

| Dataset | Contents | Who labelled | Format | Scale | Reusable? |
|---|---|---|---|---|---|
| **KIMORE** | RGB + depth + Kinect skeleton, 5 rehab exercises | **Clinicians**, via the Exercise Accuracy Assessment Questionnaire | Clinical score 0–50, per performance | 78 subjects (44 healthy, 34 with stroke / Parkinson's / LBP) | **The closest analogue.** Research licence; check before commercial use. Reusable as: proof that clinician scoring can be collected at scale. Not reusable as labels — one scalar per performance, no region, no timestamp, no cue |
| **MTL-AQA** | Competitive diving video | **Real judges**, in competition | 7 judge scores + final + difficulty + captions + action class | 1,412 samples | **The best model for representing disagreement**: seven independent expert scores per sample, kept separately. That is exactly the structure §10 recommends. Domain is unrelated |
| **FineDiving** | Diving video, procedure-aware | Competition judges + annotators | Action + sub-action types, coarse *and* fine temporal boundaries, scores | 3,000 samples, 52 actions, 29 sub-actions | **The best model for temporal granularity.** Its step-level boundaries are the pattern to copy for phase annotation |
| **UI-PRMD** | Vicon + Kinect, 10 rehab movements | **Nobody — the errors were instructed** | Binary correct/incorrect | 10 subjects × 10 movements × 10 reps | Limited. Participants were *told* to perform incorrectly. That is simulated error, not observed error, and it does not contain the thing you need |
| **EC3D** | 4 GoPro angles, squat / lunge / plank | Instructed, same as above | 11 instruction labels | 132 / 127 / 103 sequences, **4 subjects** | Very limited. Four subjects. Useful only as a schema reference |
| **Fit3D** | 3M+ images, MoCap ground truth, 37 repeated exercises | Trainer-derived *standards*, then automatic deviation detection | 3D pose + shape | Large | Good movement layer, no per-observation expert judgement. Useful as a pose/pretraining source |
| **FLAG3D** | MoCap + rendered + phone video, 60 fitness activities | Professional language instructions | Per-activity instruction text | 180K sequences | Instructions are **prescriptive** ("how to do it"), not **diagnostic** ("what went wrong with this person"). Useful for language grounding, not for judgement |
| **InfiniteRep** | Synthetic avatars, 10 exercises | **Synthetic — no human at all** | 18 annotations/video: rep counts, joint angles, keypoints, masks | 1,000 videos | Open source. Genuinely useful for rep-counting and pose robustness. Contains zero expert judgement by construction |
| **Yoga-82** | Web images, 82 poses | Manual pose-name annotation | Hierarchical 3-level class labels | ~28K images | Pose *classification* only. Static images. No quality assessment. There is still **no high-quality public video benchmark for yoga asana quality** |

### The gap, stated plainly

**No public dataset contains the coach's cue, the client's response to it, and
the outcome.** Every one of them labels a performance. None labels an
intervention. That correction loop (§6) is the whitespace, it is defensible, and
it is the thing a studio can produce and a research lab cannot.

Second gap: **no dataset separates what was seen from what was concluded.** They
all collapse to a single judgement.

Third gap: **no dataset records what an expert decided to ignore.**

---

## 16. Recommended collection protocol

### 16.1 Scale, in three stages

Reasoning first, since the brief asks for it. The unit that drives the numbers is
not hours of video — it is **observation events**. A coach in a one-to-one
Pilates session produces roughly **15–30 cue-worthy noticings per hour**, of
which perhaps 10–20 are acted on. So one hour of video ≈ 20 events ≈ 20 rows.
Compare with MTL-AQA at 1,412 samples and FineDiving at 3,000: those are *whole
performances*, and they are considered adequate for the task. Your events are
finer-grained, so you need more of them, but not an order of magnitude more.

| | Coaches | Clients | Exercises | Sessions | Video | Events | Loops | Purpose |
|---|---|---|---|---|---|---|---|---|
| **MVP** | 3–5 | 15–20 | 10–15 | 60–80 | 40–60 h | ~1,000 | ~600 | Prove the schema survives contact with real coaches. Measure α per field. Rewrite the ontology — you will |
| **Research** | 10–15 | 60–100 | 25–40 | 400–600 | 250–400 h | ~7,000 | ~4,000 | Enough per-cell data to model. 20% overlap gives stable disagreement statistics. Publishable |
| **Production** | 40–60 | 500+ | 60–100 | 3,000+ | 1,500–2,500 h | ~40,000 | ~25,000 | Enough coverage of body types, levels, injuries and schools to ship |

Two constraints that bind before the totals do:

- **Coaches, not clients, are the bottleneck.** 5 coaches × 100 clients gives you
  excellent client diversity and terrible judgement diversity — you will learn
  those five people's opinions. Recruit coaches aggressively, from **different
  schools** (§11.4).
- **Every exercise needs ~30 events minimum** before you can say anything about
  it. Fifteen exercises done deeply beats sixty done once. Pick the fifteen from
  what your studios actually teach most.

### 16.2 The MVP protocol, concretely

1. **Recruit 4 coaches** across at least two training lineages, and 16 clients
   spanning beginner→advanced, with at least 4 carrying a documented restriction.
2. **Consent**, separately and revocably: recording, tactile cueing, research
   use, publication. Written, and re-confirmed at each session for tactile.
3. **Rig**: two tripod phones (front + side), one lapel mic on the coach, a clap
   sync at the start. Total hardware cost under $600. **Do not buy motion
   capture** — see §17.
4. **Sessions**: each client, 5 sessions over 6 weeks, same coach. Longitudinal
   is where the value is: the second time a coach sees the same fault is a
   different and richer record than the first.
5. **Pass 0** live, normal teaching, mic on.
6. **Passes 1–3** same day, within 24 hours. Ideally within 4.
7. **Overlap**: 20% of clips also annotated by a second coach, who has *not* seen
   the first coach's annotations.
8. **Pay per clip, not per event.** Paying per event buys you events.
9. **After 20 sessions, stop and audit.** Compute α per field. Read every free-text
   `see`. Rewrite the `issue_type` enum from what coaches actually wrote. **Expect
   to throw the first ontology away** — that is what the MVP is for, and a team
   that does not plan for it ships a taxonomy nobody uses.

### 16.3 The answer to "what is more valuable"

The brief asks: 1,000 h unlabelled / 100 h annotated / 50 h deeply annotated /
500 h moderately annotated?

**Ranking: C > D > B > A.** And the gaps are large.

- **A (1,000 h unlabelled) is worth almost nothing here.** Pose estimation is a
  commodity — RTMO, and everything after it, will extract skeletons from any
  video, including video you do not own. Unlabelled movement is abundant and
  cheap. The scarce, expensive, defensible asset is *the mapping from movement to
  expert decision*. You would be stockpiling the free half.
- **C (50 h, deeply annotated) first**, because you cannot design the moderate
  schema until you have watched experts fill in the detailed one. At ~20 events
  per hour with the full loop, 50 h ≈ 1,000 events with causal structure — enough
  to prove the schema, measure agreement, and find out which fields coaches
  silently refuse to fill in.
- **D (500 h, moderate) second**, once the schema has stopped moving. This is
  where the model actually gets trained, and where the coverage of body types and
  restrictions comes from.
- **B is D at a tenth of the size** — a reasonable fallback, not a target.

**And yes, you need both layers, joined.** Expert judgement without synchronised
movement data is opinion; movement data without judgement is geometry. The join
is the millisecond timestamp (§7.1), and getting the clock right is more
important than getting the camera right.

---

## 17. What to build first

In order. Each item is justified by something above.

**1. The lapel mic and the transcript.** Before any interface. A coach teaching a
normal class with a mic on produces the SAY register — the generation target —
at zero marginal cost and in perfectly natural language. ASR plus diarisation
plus timestamps against the session clock. This is the highest yield-per-effort
item in the entire project and it asks nothing of anyone. *(It is also the
speech-to-text work already deferred twice in this project.)*

**2. The session clock and the sync marker.** Unglamorous, and everything
downstream is worthless without it. Two cameras, one mic, one clap, one
monotonic clock. Get this wrong and you will re-shoot.

**3. Pass 1 — the two-key noticing pass.** The smallest possible thing that
produces genuinely novel data: expert attention, timestamped, under realistic
time pressure. Buildable in days. Even with no other field filled in, "where do
experts look, and when do they decide it matters" is a dataset nobody has.

**4. Pass 2 — the fill panel**, with the clickable body figure and the
ASR-prefilled verbatim. This is where the schema meets reality and starts
changing.

**5. The loop.** `intervention → response → outcome`. The defensible asset.
Build it as soon as Pass 2 is stable, because it is what makes the dataset
unique and it is the hardest thing to retrofit.

**6. The disagreement view.** Two coaches, same clip, side by side, with α
computed per field. Not for the model — for you. It tells you which parts of your
ontology are real and which are wishful.

**7. Pay the coach back.** The pre-class sheet and the client's progress view,
generated from the annotations. This is the retention mechanism, and without it
the study dies in week three.

### What not to build yet

- **Any model.** You have no data.
- **Motion capture.** Two phones and derived pose are sufficient for everything
  above, and the money is better spent on coach hours. Fit3D already exists if you
  need MoCap-quality pose priors.
- **A bigger rubric.** The existing five-axis scale stays where it is — a studio
  feature for tracking a client over months. It is not the dataset instrument and
  should never be presented as one.
- **Automatic error detection.** Detecting deviation is easy and useless. The
  hard, valuable, unsolved part is triage — deciding which deviations are worth
  mentioning to *this* person *today*. That is exactly what §8's `cued: false`
  and `not_cued_because` are designed to teach, and it is why the annotation
  schema has to come first.

---

## Sources

Reliability of visual movement assessment
- [Physiotherapist agreement when visually rating movement quality during lower extremity functional screening tests](https://www.sciencedirect.com/science/article/abs/pii/S1466853X11000642)
- [Visual assessment of movement quality: intra- and interrater reliability of a multi-segmental single leg squat test](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8186063/)
- [Reliability and Validity of Observational Gait Analysis by Physical Therapists](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12445358/)
- [Assessing inter- and intra-rater reliability of movement scores using a custom visualisation tool](https://link.springer.com/article/10.1186/s13102-024-00988-1)
- [The Functional Movement Screen: Exploring Interrater Reliability](https://ijspt.scholasticahq.com/article/74724-the-functional-movement-screen-exploring-interrater-reliability-between-raters-in-the-updated-version)
- [Interrater Reliability of the Functional Movement Screen](https://www.researchgate.net/publication/41013331_Interrater_Reliability_of_the_Functional_Movement_Screen)

Expert perception and decision-making
- [The Visual Search Strategies Underpinning Effective Observational Analysis in the Coaching of Climbing Movement](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7326104/)
- [Quantitative analysis of the gaze of expert and novice physical therapists](https://pmc.ncbi.nlm.nih.gov/articles/PMC11617524/)
- [Differences in visual search behavior between expert and novice athletes: systematic review](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2026.1793747/full)
- [The use of cognitive task analysis in clinical and health services research — a systematic review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8903544/)
- [Think aloud protocol](https://en.wikipedia.org/wiki/Think_aloud_protocol)
- [Building bespoke exercise: clinical reasoning of physiotherapists prescribing exercise](https://onlinelibrary.wiley.com/doi/10.1002/msc.1704)

Coaching, cueing and motor learning
- [Attentional focus and motor learning: a review of 15 years (Wulf)](https://gwulf.faculty.unlv.edu/wp-content/uploads/2018/11/Wulf_AF_review_2013.pdf)
- [Enhancing motor learning through external-focus instructions and feedback](https://gwulf.faculty.unlv.edu/wp-content/uploads/2014/05/Shea-and-Wulf-HMS-1999.pdf)
- [Four Types of Cueing — Pilates ITC](https://pilatesitc.edu.au/four-types-of-cueing/)
- [Pilates Cuing: Visual, Verbal, Kinesthetic — IDEA](https://www.ideafit.com/cuing-visual-verbal-kinesthetic/)
- [Cueing and Pilates in Low Back Pain (trial NCT06340191)](https://clinicaltrials.gov/study/NCT06340191)
- [The Complete Guide to Yoga Cues for Teachers](https://liforme.com/blogs/blog/the-complete-guide-to-yoga-cues-for-teachers)
- [Yoga Cues: Verbal & Visual Instruction](https://www.yogabreezebali.com/blog/verbal-visual-yoga-instruction/)

Documentation practice
- [Clinical Note Taking for Pilates (SOAP) — Pilates Alliance Australasia](https://www.pilates.org.au/clinical-note-taking/)
- [Taking SOAP Notes — IDEA Health & Fitness](https://www.ideafit.com/personal-training/taking-soap-notes/)
- [SOAP Notes — Physiopedia](https://www.physio-pedia.com/SOAP_Notes)

Movement classification frameworks
- [Diagnosis and treatment of movement system impairment syndromes (Sahrmann)](https://www.rbf-bjpt.org.br/en-diagnosis-treatment-movement-system-impairment-articulo-S1413355517303660)
- [Movement Dysfunction — Physiopedia](https://www.physio-pedia.com/Movement_Dysfunction)

Annotation methodology
- [Krippendorff's Alpha for Annotation Agreement — Label Studio](https://labelstud.io/blog/how-to-use-krippendorff-s-alpha-to-measure-annotation-agreement/)
- [Assessing Data Quality of Annotations with Krippendorff Alpha for Computer Vision](https://arxiv.org/pdf/1912.10107)
- [Understanding Krippendorff's Alpha — Encord](https://encord.com/blog/interrater-reliability-krippendorffs-alpha/)
- [The Ultimate Guide to Video Annotation for Computer Vision — CVAT](https://www.cvat.ai/resources/blog/video-annotation-guide)
- [FEVA: Fast Event Video Annotation Tool](https://arxiv.org/pdf/2301.00482)

Datasets
- [KIMORE / rehabilitation exercise quality assessment](https://arxiv.org/html/2403.02772v2)
- [UI-PRMD and KIMORE benchmark comparison](https://www.tandfonline.com/doi/full/10.1080/24751839.2025.2454053)
- [EC3D — 3D Pose Based Feedback for Physical Exercises](https://arxiv.org/pdf/2208.03257)
- [Fit3D](https://fit3d.imar.ro/)
- [InfiniteRep](https://medium.com/infinity-ai/infiniterep-an-open-source-synthetic-dataset-for-remote-fitness-and-pt-applications-906946643e74)
- [FLAG3D: A 3D Fitness Activity Dataset with Language Instruction](https://arxiv.org/abs/2212.04638)
- [Yoga-82](https://sites.google.com/view/yoga-82/home)
- [FineDiving: A Fine-grained Dataset for Procedure-aware Action Quality Assessment](https://arxiv.org/pdf/2204.03646)
- [Awesome-AQA — index of action quality assessment datasets](https://github.com/ZhouKanglei/Awesome-AQA)
