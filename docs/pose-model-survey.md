# Hugging Face: what was looked at, what was run, and why RTMO stayed

Written because "there is a newer model on the Hub" is not a reason to replace
anything, and because the reasoning needs to survive the person who did it. The
survey is reproducible: `tools/hfsurvey.py` queries the Hub, `tools/bench_pose.py`
runs the comparison.

Dates and figures are from the run on **14 September 2026**, on this project's
own container: **4 CPU cores, no GPU**, ONNX Runtime 1.29, PyTorch 2.14 CPU.

## The short version

**RTMO stays.** Not out of loyalty — it was benchmarked against the strongest
permissively-licensed alternative on the Hub and won on the axis this product is
built around. RTMO is *one-stage*: it finds every person in a frame in a single
pass, so its cost is flat in headcount. ViTPose is *top-down*: it needs a person
detector in front of it and then runs once per person, so its cost is linear in
headcount. For a wide shot of a Pilates class — the case this whole repository
exists for — that difference is the product.

## What was searched

643 unique Hub entries across 24 model queries and 16 dataset queries: pose
estimation, 2D and 3D human pose, RTMPose, RTMO, ViTPose, YOLO-pose, body
landmarks, yoga pose, exercise and action recognition, movement quality, posture
assessment, and the dataset equivalents.

**A warning about Hub keyword search**, because it wasted time here and will
waste somebody else's. Searching datasets for `gym`, `exercise` or `fitness`
returns almost entirely reinforcement-learning environments and LLM instruction
sets — `SWE-Gym`, `R2E-Gym`, `code_exercises`. Of 280 dataset hits, the number
that are human-movement datasets is in single figures. Download counts rank
those unrelated entries far above anything relevant, so ranking by popularity is
actively misleading in this domain.

## Models: the serious candidates

| Model | Task | Architecture | Multi-person | Wide camera | Speed (measured) | Licence | Verdict |
|---|---|---|---|---|---|---|---|
| **RTMO-m** (in use, via `rtmlib`) | 2D pose | one-stage | native, one pass | designed for it; `TiledBackend` raises effective resolution | **0.15–0.17 s/frame flat, 1–12 people** | Apache-2.0 | **Keep** |
| `usyd-community/vitpose-plus-base` | 2D pose | top-down ViT | needs a detector | inherits the detector's misses on small bodies | 1.02 s at 7 people, **1.72 s at 12** | Apache-2.0 | Benchmarked, rejected |
| `usyd-community/vitpose-base-simple` | 2D pose | top-down ViT | needs a detector | as above | as above | Apache-2.0 | Benchmarked, rejected |
| `stanfordmimi/synthpose-vitpose-huge-hf` | 2D pose, **anatomical markers** | top-down ViT | needs a detector | as above | not run (huge variant) | Apache-2.0 | **Worth revisiting** — see below |
| `facebook/sapiens2-pose-*` | 2D pose | ViT, 0.4b–5b | needs a detector | — | not run | **custom "sapiens2-license"** | **Flagged** — not Apache; read before any commercial use |
| `openvision/yolo26-*-pose`, `Xenova/yolov8*-pose`, `mobilint/YOLO11l-pose` | 2D pose | one-stage | native | plausible | not run | **AGPL-3.0** | **Refused on licence** |
| `onnx-community/yolo26*-pose-ONNX`, `Synaptics/RTMO_pose` | 2D pose | — | — | — | not run | **none declared** | **Refused** — see the licence trap |
| `qualcomm/RTMPose-Body2d` | 2D pose | top-down | needs a detector | — | not run | Apache-2.0 | Pointer to Qualcomm AI Hub; needs their SDK |

### The licence trap, stated plainly

`onnx-community/yolo26n-pose-ONNX` and similar conversions carry **no licence
field at all**. The absence of a licence is not permission. These are
conversions of Ultralytics YOLO, which is AGPL-3.0 upstream, and a format
conversion does not launder a licence. AGPL would require this codebase to be
open-sourced or a commercial licence bought — which is precisely why
`pilates/tracking.py` was written by hand instead of using Ultralytics'
bundled ByteTrack, and why `requirements.txt` says so.

Sapiens is a different shape of risk: a real licence, but a **custom** one, and
some Sapiens variants on the Hub are explicitly `cc-by-nc-4.0` — non-commercial.
Anything from that family needs the licence read line by line before it goes
near a paying studio.

## What was actually downloaded and run

`usyd-community/vitpose-base-simple` and `vitpose-plus-base` were downloaded and
run against the RTMO backend already in the pipeline, on three
**public-domain and CC-BY** class photographs from Wikimedia Commons (two US
military PD images, one CC-BY), each also tested at 0.5× and 0.25× scale to
simulate students further from the camera.

```
image            model                  people  median s  joint conf  peak MB
afth             RTMO-m                      7     0.156       0.597    422.7
afth@0.5x        RTMO-m                      4     0.154       0.708    422.7
afth@0.25x       RTMO-m                      1     0.152       0.661    422.7
sigonella        RTMO-m                      2     0.157       0.762    422.7
richmond         RTMO-m                     12     0.172       0.559    425.3
richmond@0.5x    RTMO-m                      6     0.163       0.635    425.3
afth             vitpose-base-simple         7     1.024       0.608   1279.9
afth@0.25x       vitpose-base-simple         1     0.140       0.717   1279.9
sigonella        vitpose-base-simple         2     0.275       0.836   1279.9
richmond         vitpose-base-simple        12     1.720       0.471   1386.7
richmond@0.5x    vitpose-base-simple         6     0.750       0.579   1386.7
```

Read the shape, not the individual numbers:

* **RTMO is flat.** 0.15 s at one person, 0.17 s at twelve. One pass is one
  pass. Extrapolated to a class of 20+, it stays about 0.17 s.
* **ViTPose is linear.** 0.14 s at one person, 1.72 s at twelve — about ten
  times RTMO at a headcount a Pilates class reaches easily, and it gets worse
  from there.
* **ViTPose needs about three times the memory**, 1280–1387 MB against 422–425 MB.
  The free Hugging Face Space this project targets has 16 GB, so that is
  survivable; the 2 vCPU is what the linear scaling would land on.
* **ViTPose could not find anybody by itself.** Every ViTPose row above was fed
  bounding boxes *by RTMO*. A top-down model is a pose estimator, not a person
  finder, and adopting one means also adopting a detector — more weights, more
  latency, and another licence to check.

### What these numbers are not

**They are not an accuracy comparison.** There is no annotated ground truth in
this repository, so no mAP, PCK or OKS figure can be computed here, and the
`joint conf` column is each model's own confidence on its own scale — it is a
measure of self-assurance, not of correctness, and the two models' scores are
not comparable to each other. Anyone who needs an accuracy answer should run
both against COCO val2017 or MPII with annotations; that is a day's work and it
is not done.

Adopting ViTPose would also mean adding **PyTorch and Transformers** to a
runtime that is deliberately four packages deep and ONNX-only so that it fits a
free 2 vCPU Space. That is roughly 2.5 GB of dependencies. It is not a reason on
its own, but it is a cost, and nothing in the benchmark buys it back.

## Where a Hugging Face model would genuinely help

**SynthPose** (`stanfordmimi/synthpose-vitpose-huge-hf`, Apache-2.0) is the one
worth coming back to. It is ViTPose fine-tuned to predict *anatomical* marker
sets — the kind of landmarks a motion-capture lab places — rather than the 17
COCO joints. `pilates/alignment.py` documents exactly where COCO-17 runs out:

> sagittal pelvic tilt needs the ASIS and PSIS landmarks, which a 17-point model
> does not mark

That is the measurement every posture product is asked for and this one refuses
to fake. A marker-set model is the honest route to it. It is still top-down, so
it would be a **second pass over already-detected people** for a standing
assessment — where there is one person, holding still, and a second of latency
does not matter — rather than a replacement for RTMO in the class pipeline. That
split is the sensible architecture and it is not built yet.

## Datasets

Of 280 dataset hits, these are the only ones relevant, and none was used:

| Dataset | Size / content | Licence | Commercial | Verdict |
|---|---|---|---|---|
| `Voxel51/MPII_Human_Pose_Dataset` | 25k images, 40k people, 16 keypoints | BSD-2-Clause | yes | The only clean ground-truth option found. Would enable a real accuracy benchmark. **Not used yet.** |
| `Surya2212/sarc-o-meter-exercise-skeleton` | exercise skeletons | CC-BY-4.0 | yes, with attribution | Small; unclear provenance of the skeletons |
| `omergoshen/yoga_poses` | yoga pose images | **none declared** | **unknown** | **Flagged.** No licence is not permission |
| `RepDB/exercise-dataset` | exercise video | `other` | unknown | Needs the licence read |
| `facebook/digit-pose-estimation` | — | CC-BY-NC-4.0 | **no** | Non-commercial; irrelevant anyway |

**No dataset was downloaded and no model was fine-tuned.** Part 3 of the brief
allows that explicitly — fine-tune only where there is evidence it fixes a real
failure mode — and the evidence is not there. The posture layer is deterministic
geometry over landmarks; its errors come from landmarks being *missing*
(occlusion, distance, a body turned part-way), which is a detection problem that
fine-tuning a pose head on MPII does not address. Fine-tuning would be motion
without progress.

The honest next step, if accuracy becomes the question, is to use MPII to
*measure* rather than to train: run RTMO against its annotations and find out
what the landmark error actually is at the body sizes a wide classroom shot
produces. That number does not exist yet, here or in the README.

## Reproducing this

```bash
python3 tools/hfsurvey.py survey.json          # the Hub sweep
pip install torch transformers                 # not in requirements.txt, deliberately
python3 tools/bench_pose.py IMAGE [IMAGE ...] --repeats 3
```

`tools/bench_pose.py --skip-vitpose` runs the RTMO half alone, with no torch.
