# Your first class

Twenty minutes, one recorded class, no prior setup. If anything here does not
match what you see, stop and say so rather than working around it — a step that
half-works produces reports that look fine and are wrong.

## Before you start

Everyone in the video needs to know they are being recorded and be fine with it.
The reports name people and describe how they moved.

## 1. Install

```bash
pip install -e .
pilates doctor
```

`doctor` checks Python, every dependency, disk space and whether the pose model
has been downloaded, and names anything missing:

```
  [ok  ] Python 3.10 or newer — found 3.11
  [ok  ] cv2 — video reading, from opencv-python-headless
  [ok  ] Pose model downloaded — 3 file(s) cached, largest 369 MB
  [ok  ] Processing speed — CPU only, 4 core(s) — expect roughly 0.20s per frame

Ready to run.
```

The model downloads itself (about 80 MB) the first time you analyse anything,
so the first run needs an internet connection. After that it works offline.

## 2. Ask what to do with your video

```bash
pilates quickstart class.mov
```

This looks at your actual video — its size, and where the cuts are — and prints
the exact commands for it, with the frame numbers already filled in. It also
warns you about the two things that quietly ruin results:

- **Low resolution.** Students need to be about 30 pixels tall.
- **Cuts.** Track ids restart at every cut, so one shot is analysed at a time.

Follow what it prints. The rest of this page explains what those steps are for.

## 3. Tell it where the mirrors are

```bash
pilates probe class.mov --grid 100 --out grid.jpg
```

Open `grid.jpg`. It has pixel coordinates drawn over your room. Read off the
corners of any mirror and put them in a `studio.json`:

```json
{
  "exclusion_zones": [
    {"name": "left_mirror", "box": [0, 0, 500, 1080]}
  ],
  "frame_stride": 4
}
```

This matters more than it sounds. A reflected instructor is detected as a real
person with high confidence — in one test, 18% of all detections were
reflections.

## 4. Say who is who

```bash
pilates roster class.mov --config studio.json --start 4352 --end 5824
```

This writes `roster.json` and a folder of reference pictures, one per person.
Open the pictures, and put the right name against each number:

```json
"names": { "1": "Anna", "2": "Ben", "3": "?student_3" }
```

Anyone still starting with `?` is skipped. Nothing here recognises faces — the
names come from you.

## 5. Say what was taught

```bash
pilates label class.mov --out class.labels.json
pilates check class.labels.json
```

`label` splits the video at the cuts and hands you the segments. Fill in what
each one was: `mountain`, `plank`, `the_hundred`. `check` catches typos against
a vocabulary of 36 exercises, so `downward dog` and `downward_dog` do not become
two different things.

Leave `transition` where nothing was being taught.

## 6. Run it

```bash
pilates class class.mov --labels class.labels.json --roster roster.json \
    --config studio.json --start 4352 --end 5824 \
    --history studio_history.json --out-dir reports/
```

You get one page per student, plus `class_summary.html` for you — which shows
what several students struggled with, not just individuals.

Run it again after next week's class with the same `--history` file, and each
student's page starts showing whether anything actually changed.

## What it will refuse to do

These are not bugs. Each one exists because the alternative is a confident,
wrong answer:

- **Report on a class it could not track.** If identities churn, it stops rather
  than describing fragments of people.
- **Use a roster from a different shot.** It checks and refuses, because track
  ids restart at every cut.
- **Call noise progress.** A change must clear both that student's own
  session-to-session variation and three degrees outright.
- **Judge a twist, a saw, or a triangle.** Those turn in the camera's depth
  axis. One camera cannot see it, and no amount of data fixes that.

## What to check before showing a student

Read `docs/depth-ambiguity.md` and the standards in `pilates/coaching.py`. The
36 exercise standards were written from movement geometry, not by an
instructor. They are deliberately generous, they are data you can edit, and a
teacher should read them before any of this reaches a student.
