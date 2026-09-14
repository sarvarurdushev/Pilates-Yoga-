# Putting this on Hugging Face, click by click

Written because the last version of these instructions said "add a Dockerfile to
a Space" and that was not enough to act on. This one assumes you have never made
a Space, names every button, and says exactly what to paste. It takes about ten
minutes, most of which is waiting for a build.

**What you get.** A public URL running the whole application: the anatomy
explorer, the four-photograph posture check, and video analysis. Free, no card,
no trial clock.

**Why Hugging Face rather than Render.** The free tier is 2 vCPU and 16 GB
against Render's 0.1 CPU and 512 MB. That is the difference between a posture
check that answers in two seconds and one that runs out of memory loading the
pose model, and between a twenty-second clip taking four minutes and taking an
hour and a half. Both numbers are measured, on this code; the table is in the
README.

---

## What you need first

* A Hugging Face account — [huggingface.co/join](https://huggingface.co/join),
  free, email and password.
* Nothing else. You do not need Docker installed, you do not need to clone
  anything, and you do not upload any code: the Space builds itself from this
  repository.

---

## 1. Make the Space

1. Sign in at [huggingface.co](https://huggingface.co).
2. Click your avatar, top right → **New Space**. (Or go straight to
   [huggingface.co/new-space](https://huggingface.co/new-space).)
3. Fill the form:

   | Field | What to put |
   |---|---|
   | **Owner** | your username |
   | **Space name** | `pilates-studio` — anything, lowercase, no spaces |
   | **License** | leave blank, or pick one |
   | **Select the Space SDK** | **Docker** → then the **Blank** template |
   | **Space hardware** | **CPU basic · 2 vCPU · 16 GB · FREE** |
   | **Visibility** | **Public** (a private Space works too) |

4. Click **Create Space**.

You land on a page that says the Space is empty and shows some setup
instructions. Ignore those instructions. Go to step 2.

---

## 2. Add the one file

1. At the top of the Space page, click the **Files** tab.
2. Click **+ Add file** → **Create a new file**.
3. In the **Name your file** box type exactly:

   ```
   Dockerfile
   ```

   Capital D, no extension, nothing else.
4. Paste the entire contents of
   [`deploy/huggingface/Dockerfile`](../deploy/huggingface/Dockerfile) from this
   repository into the big text box. Open that file, select all, copy, paste.
   Do not retype it and do not paste only part of it.
5. Scroll to the bottom, leave the commit message as it is, and click
   **Commit new file to main**.

That is the whole deployment. There is no second file.

---

## 3. Wait for the build

The Space switches to a **Building** badge and a log appears. It takes roughly
five to eight minutes, most of it two steps:

* `pip install` — about two minutes.
* `RUN python -c "from pilates.pose import RTMOBackend..."` — this downloads the
  pose model, about 90 MB, into the image. It is done here so that the first
  person to use the Space does not wait for it.

When the badge turns to **Running**, click the **App** tab. The application
loads.

---

## 4. First run

The Space starts with an empty studio and no accounts.

1. The page asks you to create the first account. That account becomes the
   owner: admin, coach and student in one.
2. Press **Posture check** in the header. Add one to four photographs, press
   **Analyse these photographs**, and the report appears — score, findings,
   what to work on, and what the photographs could not measure.
3. Press **Record** for the video half.

---

## The three things to know before a studio relies on this

**Storage does not survive a rebuild.** The studio record lives at
`/home/user/data/studio.db` inside the container, and Hugging Face gives free
Spaces no persistent disk. Restarting the Space, editing the Dockerfile, or a
platform restart wipes it: accounts, measurements, history, coach notes. Paid
persistent storage exists; until you buy it, treat a Space as somewhere to
*show* the thing, and keep the real record on the studio's own machine.

**Photographs and video leave the building.** This is the trade a hosted
deployment makes and it is the one thing this design otherwise avoids. The
photographs are measured and dropped and the clip is deleted when the job ends
— neither is stored — but both travelled to somebody else's computer first. For
a studio with real clients, `python -m pilates web` on the studio's own machine
is the honest default and the reason that command exists.

**A public Space is public.** Anybody with the URL reaches the sign-in page.
Accounts gate the measurements; set the Space to **Private** in
*Settings → Change Space visibility* if you would rather it were not reachable
at all. `PILATES_PASSCODE` adds a second shared word in front of uploads: set it
in *Settings → Variables and secrets → New secret*.

---

## If it goes wrong

**Build fails at `git clone`.** The Dockerfile clones a branch by name:

```dockerfile
ARG BRANCH=claude/multi-person-pilates-analysis-w28tt0
```

If that branch has been merged or renamed, edit the line in the Space's
Dockerfile to the branch that exists. To build from a fork, change `ARG REPO`
too.

**Build fails on `pip install`.** Read the last twenty lines of the log. The
usual cause is a Hugging Face outage; **Settings → Factory rebuild** retries
from scratch.

**"Running" but the page is blank.** Open the browser console. A 404 on
`session.json` is normal with no session loaded. Anything else, copy the error.

**The posture check says the pose model could not be loaded.** That message
comes with a reason. On CPU basic it should not happen; on a smaller tier it
means exactly what it says and the fix is more memory.

**The Space sleeps.** Free Spaces pause after a period of no visitors and take
about thirty seconds to wake. That is the tier, not a fault.

---

## Updating it later

The Space builds from a branch, so it does not follow new commits by itself.
When this repository changes, go to **Settings → Factory rebuild** and it
re-clones. That also wipes the database — see above.
