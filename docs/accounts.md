# Who is who: accounts, roles, studios and consent

This is the design for the part of the system that knows *people* rather than
*bodies*. The measurement half already works and has no idea who is allowed to
look at it. This half decides that.

It is written down before it is built because the research is unanimous on one
point: role systems rarely fail because the schema was wrong, they fail because
nobody wrote down the rules around the schema. So the rules are here, as a
contract, and the code is judged against this page.

---

## The one decision everything else follows from

**A role belongs to a membership, not to a person.**

The instinct is `accounts.role = 'coach'`. It is wrong, and it breaks on the
very first real case — which happens to be the first case this studio has:

> `sarvarurdushev@gmail.com` needs to be admin, coach *and* student.

With a role column on the account that is three accounts, three passwords,
three sets of measurements, and a person who is a stranger to themselves. With
the role on the membership it is **one account with three memberships**, a role
switcher in the corner, and one body of measurements that the student sees as
their own and the coach sees as a client's.

It also handles the case that arrives later and would otherwise be a rewrite: a
coach at the Gangnam studio who takes classes as a student at Hongdae.

```
account ──< membership >── studio
              │
              └── role: admin | coach | student
```

Every permission question in this system is therefore the same question:
*which membership is acting, and in which studio?*

---

## Entities

| Entity | What it is | Why it exists separately |
|---|---|---|
| **Account** | One human. Email, password, phone, name. | The login. Never carries a role. |
| **Studio** | One location. Name, city, country, timezone. | Everything is scoped to a place. |
| **Membership** | (account, studio, role, state) | Where roles live. The join table that is actually the point. |
| **Profile** | Body and contact facts: date of birth, height, weight, emergency contact. | Belongs to the person, shared per-studio by consent. |
| **Screening** | PAR-Q+ answers, conditions, medications, injuries, pregnancy. | Health data. Separated so it can be guarded and redacted on its own. |
| **Assignment** | (coach membership → student membership, since, until) | Being in the same building is not a relationship. This is. |
| **Consent** | (student, studio, scope, granted_at, revoked_at) | The student's own record of what they let a coach see. |
| **Invitation** | (email, studio, role, token, expires) | The safe way to create staff. |
| **RoleRequest** | (account, studio, wanted role, state) | What a signup actually produces. |
| **AuditEvent** | (who, what, on whom, when, why) | The answer to "who saw my health record". |

`Account.username` is the join back into the measurement half — the existing
`people` table, the links, the sessions, the observations. One person, one
username, one history, whichever hat they are wearing.

---

## Roles, and what each may do

Three roles. Resisting a fourth is deliberate: research on RBAC failure modes is
blunt that over-granting happens when roles are opaque — *"Editor" and "Manager"
both sound powerful, so somebody hands out Admin to be safe.*

| | student | coach | admin |
|---|:--:|:--:|:--:|
| See own measurements, charts, history | ✅ | ✅ | ✅ |
| See own feedback from a coach | ✅ | ✅ | ✅ |
| Record a class / upload a clip | ✅ own | ✅ any assigned student | ✅ |
| See the roster of students **assigned to them** | — | ✅ | ✅ |
| See the studio directory (names only) | — | ✅ | ✅ |
| Open a student on their roster | — | ✅ | ✅ |
| Write feedback, cues, contraindications, goals | — | ✅ assigned only | ✅ |
| Read a health screening | — | ✅ flags only | ✅ full |
| Approve a role request | — | — | ✅ |
| Grant admin | — | — | ✅ |
| Create a studio | — | — | ✅ |
| Add a student to their own roster | — | ✅ | ✅ |
| Add a student to somebody else's roster | — | — | ✅ |
| Remove a coach from their own record | ✅ | ✅ | ✅ |
| See every studio | — | — | ✅ |
| Erase a person | — | — | ✅ |
| Read the audit log | own | own actions | ✅ |

Two lines in that table are the ones that matter:

**"Open a student on their roster."** Same building is not permission — the
assignment is. A studio with two coaches is the first place the naive rule
leaks, and health data is the worst thing to leak.

**"Read a health screening — flags only."** A coach needs to know *"left knee,
no deep flexion"* and *"cleared by physician"*. They do not need the diagnosis,
the medication list, or the date of birth. That is the difference between
information a class needs and a medical record.

---

## Signing up

A signup **declares an intent; it does not grant a role.** This is the single
most common privilege-escalation hole in systems of this shape: a role dropdown
on a public form is an invitation to type "coach" and start reading strangers'
health data.

```
   sign up ──> account created, membership state = pending
      │              role_request(wanted = coach | student)
      │
      ├─ wanted student ──> auto-approved at the studio they chose
      │                     (a student can only ever see themselves)
      │
      └─ wanted coach ────> waits. An admin approves, or it stays pending
                            and the account can do nothing but see its own
                            empty record.
```

Students self-approve because the blast radius is zero — a pending student and
an approved student can both see exactly one record, their own. Coaches never
self-approve. Admin is never requestable at all: it is only ever *granted* by an
existing admin, and the first one is created from the command line.

The safer path for staff is the **invitation**: an admin invites an email into a
studio with a role already attached, and accepting the invitation is the signup.
Inviting scopes the role in the same step, which is what the security research
recommends over approving requests after the fact.

### What is asked for, and when

Asking for everything at signup is how you get a form nobody finishes and a
database full of `170` for height because it was mandatory.

**At signup (everyone):** name, email, password, phone, studio, role wanted.
Phone is the disambiguator the studio asked for — two students called Aziz with
similar emails are one phone call from a mix-up — and it is stored in E.164
(`+821012345678`) so that formatting never forks a person.

**Before a first class (students):** date of birth, height, weight, emergency
contact, and the PAR-Q+ screening. This is the industry-standard pre-exercise
questionnaire — seven yes/no questions, follow-ups, medications, conditions, and
whether a physician has cleared them. It is a *gate*, not a form: the coach's
sheet says **"not screened"** in amber until it is done, because taking somebody
through a teaser without knowing about their heart condition is the failure this
whole layer exists to prevent.

**Date of birth, not age.** An age typed in 2026 is wrong in 2027. Age is
computed; the coach sees the age, the admin sees the date.

---

## Locations, and how a coach finds their students

This is the part the studio said they did not know how to manage, so it is
spelled out.

**Nothing is global.** Every membership names a studio. A coach at Gangnam
cannot see Hongdae, and an admin sees both only because admin is scoped to the
studios they are admin *of*.

The flow, in the order it happens:

1. **Admin creates the studio.** Name, city, country, timezone.
2. **People sign up and choose that studio** from a list, or arrive by
   invitation with the studio already fixed.
3. **The coach opens the directory** — everybody at their studio, names and
   nothing else. Not a record, a phone book.
4. **The coach adds them.** One press, or **Add all** for the room, and it takes
   effect immediately.
5. **From then on** that student is on the coach's roster, and the coach can
   open the record, read the flags, write cues and goals, and watch the line
   move.
6. **Either side can end it.** The student opens *Who sees my record* and
   removes anybody; the coach removes from their own roster; the admin
   reassigns. The notes stay — they are the studio's record of care, and the
   research on clinical notes is unambiguous that they are kept — but the coach
   cannot read anything recorded after that moment.

### Why adding is immediate, when it used to need consent

Step 4 used to be a *request*, and nothing happened until the student accepted
it. That was a misreading of what this is. Nobody joins a gym and then
negotiates with each instructor separately: the studio assigns the coach, and
joining the studio was the consent. What the round trip actually produced was a
coach who could not put their own class on their own roster without waiting for
twelve people to log in, and a screen full of *waiting for their answer*.

The protection did not go anywhere; it moved to where it works. A prompt arrives
once, at a moment nobody is thinking about it, and afterwards there is nowhere
to go and look. **Who sees my record** is always there, always current, lists
exactly who can open the record and what they can see, and removes any of them
in one press — and every read is in the student's own log either way. Control
you can exercise beats a question you clicked through.

What did not change: a coach with no assignment sees a name and nothing else,
and being in the same building still grants nothing.

A student can have more than one coach. A coach has many students. Both are
scoped to a studio, and the assignment carries dates, so *"who was coaching them
in March"* is answerable a year later.

### Managing locations as an admin

Everything else in the console works inside the studio the admin happens to be
acting in. Moving somebody is by definition about a different one, so the
**Studios** tab is the only place that reaches across all of them:

- **Add location.** Name, city, country. The person who creates it becomes its
  admin in the same act — a location nobody can administer is not a location,
  it is a dead row, and creating one and then discovering you cannot open it is
  the kind of half-finished feature this project keeps trying not to ship.
- **Put somebody in a location.** Anybody, into any studio, in any role, with
  an optional *and leave the old one*. Without that box they hold both, which
  is a real case — a coach who teaches at two sites — rather than an error.
- **Give one coach every student at a location.** A studio with one instructor
  is the common case and should not be twenty presses. It skips the ones
  already on that roster rather than duplicating them.

Two small things that are deliberate. The location list opens on the studio you
are acting in, because a list that opens on whichever name sorts first points
at the wrong place and only tells you afterwards. And every confirmation reads
in names — *"Bae Soo-jin is now a student at Busan Pilates"*, never
`bae_soojin_example_com is a student at busan-pilates`. A username is a database
key that happens to be legible, and showing it makes a working feature look
broken.

The counts on each row — students, coaches, *acting here* — are the answer to
"did that do anything", which is the question every one of these buttons raises.

---

## What each role actually sees on screen

The same body, the same measurements, three different rooms.

**Student.** Their body, their numbers, their progress, and what their coach
wrote — in plain language, no jargon column, including every evaluation under
**My feedback**. One question answered: *am I getting better, and what should I
do next?* No roster, no directory, no other person anywhere in the interface,
except the standing **Who sees my record** panel.

**Coach.** Opens on the roster, not on a body: who is coming, who has a flag to
read before class, who has a goal past its review date. Picking a student opens
the body with that person's measurements on it and the writing tools live —
click any structure and the reading for it opens, on the axes that structure
actually takes, in their own words — plus **Notes** in the header, which is
everything already written about this body. The explore panel folds away,
because it is the widest thing on the screen and a coach reading a body does not
need four tabs of prose in front of it. And
the things the research says instructors actually track: contraindications, cues
in the student's own words, modifications and why, springs and props, one to
three live goals with review dates, and progress across the class as a group.
*How a coach gives feedback*, below, is the whole of it.

**Admin.** Everything above, plus the machinery: **Waiting** (role requests),
**People** (searchable, filtered by role, flagged first), **Studios** (add a
location, move anybody into any location in any role, give one coach a whole
location) and **Log** (the audit trail). Admin is the only place a role changes
hands.

A person with three memberships gets a switcher, and the interface changes
completely when they use it. That is the point — not a menu that grows, a room
that changes.

---

## How a coach gives feedback

**Click any structure on the body and the box to write about it opens.** No
toggle, no second click, and nothing else on the screen moves out of the way for
it — it takes its own column beside the explore panel rather than replacing it.

The shape of that box is the part worth explaining, because two earlier versions
of it were wrong.

### The rubric is the coach's, not ours

The first version scored a whole class on five fixed principles. The second
scored every structure on five fixed axes per kind — recruitment, timing,
endurance, length, symmetry for every muscle in the body. Both were wrong in the
same way: **they guessed.** The psoas and the anconeus do not raise the same
questions, and somebody who has taught for fifteen years does not need a form
telling them what to look at.

So the box holds two things:

- **What you saw.** Free prose. This on its own is a complete reading — a coach
  who wants to write one sentence should never have to press a button first.
- **Checks, in the coach's own words.** A check is a line they wrote — *"does it
  let go at the bottom"*, *"left vs right at the top"*, *"does the shoulder
  shrug"* — with an optional verdict and an optional note. They can add as many
  as they like, edit any of them, or use none.

**Whatever they wrote about a structure comes back the next time it is opened**,
as a chip, above the suggestions. The second reading of a psoas is one press,
and the vocabulary that builds up is theirs.

### The one thing that is fixed

The verdict, and it is three values: **fine · worth watching · a problem.**

Three rather than five because the reliability literature on visual movement
assessment is consistent that agreement improves with coarse rating and collapses
on fine graded scales — and because a scale nobody uses the ends of is a
three-point scale with extra typing anyway.

### Starting points, not requirements

Each kind of structure offers a few chips, because a blank box is its own kind of
hostile. They are suggestions to press, edit or ignore.

| Clicked | Offered as starting points |
|---|---|
| **Muscle** | how much work it's doing · when it comes in · does it hold through the set · left against right · what took over instead · does it let go between reps |
| **Bone** | where it sits at the start · does it stay there under load · how much range · where the control goes · against the segment above and below |
| **Nerve** | what they reported · what brought it on · how long it lasted · carried on / modified / sent them to get it looked at |
| **Brain, organ** | Nothing. The panel says why instead of greying a form out: nothing in a Pilates class measures a brain, and a coach is not the person to judge one |

The nerve list is the one place this still asserts something, and it is a
scope-of-practice boundary rather than a rubric. A coach does not assess a nerve;
they notice a symptom in its area and decide whether to carry on, modify, or send
the person to somebody qualified. One grey sentence under the heading says so.
It is not a banner and not a colour — a yellow box on every nerve is noise, and
noise is what gets a real warning ignored.

### Only a nerve is allowed to shout

A muscle called *a problem* is a note. A **nerve** called *a problem* is the one
thing that jumps the queue on the roster. A system that alarms on everything gets
switched off.

### Does a reading change the measured number? No.

This is the question worth being exact about. The **7.2 Nm** on a muscle came
off a camera: it is `measured`. A coach's verdict is what a person thought: it
is `observed`. Letting the second alter the first would be falsifying the
record, and the tier system in this application exists to stop precisely that.
A reading is written to `structure_evals` and reaches neither `measurements` nor
`findings` — there is a test that asserts exactly this, by counting rows.

What the two **do** share is a date axis, and that is where the value is. Under
the measured line, on the same dates, sits a lane of the coach's verdicts:

```
7.2 Nm  ·····•·····•·····•·····•·····•·····      the camera, twelve sessions
        ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
        ■ ■ ▪ ▪ ▪ ▪ ▪ ▪ ▫ ▪ ▪ ▪            a person, the same twelve dates
```

Read together they say something neither half can say alone: *the load has been
flat at 7.2 Nm for twelve weeks, and over the same twelve weeks the coach went
problem → worth watching.* The number did not move and the quality did. Or the
other way round: the number moved and nobody noticed.

The lane is drawn as blocks rather than a line, on no vertical scale, with the
sentence **"Not measured. This is what a person thought, on the same dates — it
does not move the number above it."** underneath. That is deliberate: it must
not be mistakable for a second measurement of the same thing.

The axis is the **union** of both sets of dates, so a class the coach wrote
about but the camera never recorded still gets a column. Dropping it would
quietly hide the sessions nobody filmed.

### Where it all shows up

- **On the structure**, when it is next selected: the runs of dots beside each
  check, so *"a problem, four classes running"* is visible immediately. Once is a
  bad day.
- **Beside the measurement**, as the verdict lane described above.
- **On the pre-class sheet** (*Before class*), under **Still open — from what
  you wrote**: everything whose latest verdict is not `fine`, worst first, with
  how many classes in a row it has come back. Anything now settled drops to
  **Settled since**, because a sheet that lists everything ever noticed is a
  sheet nobody reads twice — and *"this is fixed"* is worth one line, because it
  is a thing a coach wants to walk in knowing.
- **On the roster**, as the last flagged reading — *"psoas major: how much work —
  a problem"* — because a reading nobody sees on the way into the class changes
  nothing about the class.
- **In Notes**, in the header: everything written about this body, newest first,
  nerve flags at the top. Without it a reading exists only while that structure
  is on screen.

The student sees the same, under **My notes**. Nothing written about them is
hidden from them.

### One place to write, and one only

Selecting a muscle used to put a *second* note form in the explore panel as
well, in a different shape, asking for the same thing — so the same muscle had
two boxes. The explore panel is read-only now; writing about a structure happens
in the one panel that owns it. The bar at the bottom is **Before class**, which
is the pre-class sheet and not a third place to write.

### Two controls that stay out of the way

The explore panel **folds** to a strip labelled *Show panel* — the coach's
choice, never automatic, because it was hidden automatically once and the way
back was not obvious. And the four amber disclaimer chips are no longer stacked
over the body: all four are set out in full, with their reasoning, in the
**About** tab, which is where a reference belongs.

---

## Privacy rules, stated once

1. **Health data is not shared by location or by role.** Only by an assignment
   between one coach and one student, at one studio.
2. **Revoking is one press and takes effect immediately** for future reads, from
   either side, and the student can always see the whole list of who has it.
3. **Minimum necessary.** A coach sees screening *flags*, not the medical
   record. An admin sees the record because somebody has to, and every read is
   logged.
4. **Every read of a health record is audited** — who, whom, when. The student
   can see that log for their own record. This is the only way "who saw my data"
   has an answer.
5. **Leaving is deactivation; erasure is separate and total.** A deactivated
   membership stops working immediately and keeps the history. `forget()` — which
   already exists — removes the person and everything of theirs, and stays the
   only thing that does.
6. **The video is still never kept.** Unchanged, and worth repeating: the pose
   stream and the numbers survive, the footage does not.

---

## Security decisions

- **Passwords**: scrypt, `n = 2**17, r = 8, p = 1` — the current OWASP minimum.
  A 16-byte random salt per password, and the parameters stored beside the hash
  so they can be raised later without locking anybody out.
- **Sessions**: 32 bytes from `secrets.token_urlsafe`, stored hashed so that a
  stolen database is not a stolen set of live sessions. Rotated on login,
  destroyed on logout, expiring after 30 days.
- **Cookie**: `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` with the
  `__Host-` prefix whenever the request arrived over HTTPS. A studio serving
  plain HTTP on its own LAN gets the cookie without `Secure`, because the
  alternative is a login that silently does not work.
- **Timing**: password verification and session lookup both use constant-time
  comparison. A wrong email and a wrong password produce the same answer and
  take the same time.
- **Rate limiting**: failed logins are counted per email and per address, and
  slow down. Five wrong passwords is a typo; fifty is somebody else.
- **The passcode stays.** `PILATES_PASSCODE` guards a deployment with no
  accounts on it at all. Accounts supersede it where they exist.

---

## Nothing is served without an identity

There was a compatibility rule here, and it was a hole. A database that had no
accounts on it kept its old, unguarded behaviour — the reasoning being that a
studio which had not set accounts up should not have its existing deployment
broken. What that actually meant is that **the way to read every health record
in a studio was to find one that had not got round to making an account**, on
exactly the deployments least likely to notice.

So there is no such state any more:

- A database with no accounts serves **nothing**. Not the recordings list, not a
  bundle, not a coach sheet, not a note. Every one answers 401.
- What it does offer is one route, `POST /auth/setup`, which makes the first
  admin. It works exactly once, in a single exclusive transaction — two people
  opening the setup page of a fresh deployment at the same moment is not
  hypothetical, it is a URL somebody shared, and the loser of that race is
  refused rather than quietly made a second owner.
- The person who claims it gets all three roles, because the person setting a
  studio up is also the person who will teach in it and be measured by it.
- Records left over from before accounts existed — `people` rows nobody has
  claimed — are visible to an admin and to nobody else. They belong to somebody,
  and until an account is attached there is no way to know whether the person
  asking is them.

The passcode and the accounts are **two locks in series, not one instead of the
other**: `PILATES_PASSCODE` says this machine may be spoken to; the session says
who is speaking. A correct passcode with nobody signed in still reaches nothing.

## Getting back in

A studio locked out of its own record starts a new one, and this project's whole
value is that the record is long. So there are three ways back, and they are
independent on purpose — each works where another cannot.

| | Needs | Good for |
|---|---|---|
| **Recovery codes** | nothing | a studio with no mail server, which is most of them |
| **An emailed link** | `$PILATES_SMTP_URL` | the flow everybody expects |
| **An admin issues a link** | an admin | somebody standing at the desk |

**Recovery codes** are eight one-time codes, shown once when the account is
made and never recoverable afterwards. Forty bits each, stored hashed like
anything else that is shown once. Asking for a new set cancels the old one —
"generate new codes" means the old list is lost or compromised, and leaving it
live would make that sentence untrue.

**Email is optional and honestly optional.** One environment variable, and
`smtps://` or `smtp+starttls://` only: plain `smtp://` to anywhere but localhost
is refused, because a reset link crossing the internet in clear text is worse
than no reset link. Where it is unset, every path that would have used it says
so and names the other two.

**An admin issues a link, not a password.** This is the part worth being firm
about: an admin who *sets* somebody's password knows it, and then that student's
record has two people who can open it and only one who should. The link is
redeemed by the person, so the password they end up with is theirs alone.

Three rules hold across all three paths:

1. **Every path ends in a one-time token the person redeems themselves.**
2. **Redeeming signs every open session out**, on every device. A password is
   reset most often because somebody believes somebody else has it, and leaving
   that session alive answers the wrong half of the problem.
3. **A refusal never says which half was wrong.** An unknown address and a wrong
   code produce the same sentence; `forgot` answers identically whether or not
   the address is known. Anything else is a way to find out which of a studio's
   students have accounts, and those are the people this system holds health
   data about.

Email verification works the same way where mail is configured: a one-time link,
a separate token namespace from resets, and a `verified_at` that stays empty and
means nothing where there is no mail server.

## Testing it with people who do not exist

`pilates seed` fills a database with a studio group in Seoul and Busan, because
a permission system cannot be judged with one account in it. A coach with no
students never shows the roster; a roster with nobody unscreened never shows the
red row; an inbox with nothing waiting never shows what approving looks like.

It also writes **twelve weeks of coach readings** — around 300 of them, across
nine students — because the question a studio actually asks is not *does the box
open* but *what does this look like after a term*. A fixture with one reading in
it cannot answer that.

Those readings are written as arcs rather than as random verdicts, because the
only question anybody asks of a history is *is this getting better*, and a
scatter cannot answer it. Kim Min-ji's psoas runs
`problem problem problem watch watch watch watch fine watch fine fine fine` over
twelve weeks. Han Do-yun's sciatic nerve gets worse before it gets better and
carries a real referral in week six, because **a fixture where everybody
improves cannot show a coach what a problem looks like six weeks in**. Yang
Do-won's shoulder difference stays `worth watching` for all twelve weeks and is
noted as structural rather than a fault — the case where the right answer is to
leave it alone.

The prose is written some weeks and not others, because a coach with ninety
seconds between classes writes a sentence sometimes, and a fixture where every
week has a paragraph is a fixture flattering the interface.

What it deliberately contains, one per thing somebody has to be able to see:

| Person | Shows |
|---|---|
| Seo Ji-woo | admin, coach **and** student at one studio, plus admin at a second |
| Yoon Chae-won | coaches at Gangnam, trains as a student at Hongdae |
| Kang Tae-yang | asked to coach and is still waiting — the admin's inbox |
| Choi Seo-yeon | never screened — the red row at the top of the roster |
| Han Do-yun | a yes on the questionnaire with no doctor behind it |
| Jung Ha-eun | pregnant, with the contraindication written by her coach |
| Kim Min-ji | twelve weeks of measurements, a knee flag, an overdue goal |
| Oh Se-ah | asked by a coach and has not answered — the consent prompt |

Three things keep it from being mistaken for real data, and none of them is
making it look fake:

- every address is at **`example.com`**, reserved by RFC 2606 and unroutable, so
  a deployment with `$PILATES_SMTP_URL` set cannot send a verification email to
  a real person because a fixture invented their address;
- every number is in the **`010-0000-xxxx`** block, which Korean carriers do not
  issue, so nothing here dials a stranger;
- every person carries a marker in their record, and every session carries the
  same synthetic block the demo bundle does.

And it **refuses a database that already has accounts on it** unless you name a
studio of your own with `--studio`, or press the button in the admin console.
A fixture that can be poured into a working studio *by accident* is one that
will be; naming the studio is the consent that makes it deliberate. Where it is
poured into somewhere real, **nobody it creates becomes an admin of it** — an
admin role becomes a coach role, because a fictional person must not end up able
to read every health record in the building.

### The bug the button found

Pressing it the first time broke the page around it: `database is locked`. The
server opens a SQLite connection per request, because connections are not
shareable across threads, and under the rollback journal one writer blocks every
reader on the file. So a write of any length — filling a studio with fixtures, a
capture saving a long session — made every other request in flight fail.

Three changes, and they matter well beyond the fixture:

- **WAL journalling.** Readers no longer block the writer and the writer no
  longer blocks readers, so only writer-against-writer contends, and those are
  milliseconds long.
- **A twenty-second busy timeout.** When two writers do meet, wait rather than
  fail. The default five seconds is less than a capture takes to save.
- **The session row is no longer written on every request.** `last_seen` was a
  write per request — write contention per request — for a field nothing reads
  more precisely than *roughly when were they last here*.

`synchronous` stays at `FULL`. `NORMAL` is the usual WAL pairing and is faster,
and what it trades away is the last few transactions on power loss — which here
is a coach's note about somebody's knee.

## What this deliberately does not do yet

Named so that they are decisions rather than omissions:

- **No payments, packages or bookings.** A studio management system is a
  different product; this one measures movement.
- **No SSO.** One studio, one password.
- **No second factor.** Recovery codes here are a way back in, not a way to
  prove a second thing.
- **Under-18s are flagged, not handled.** A profile whose date of birth makes
  the person a minor is marked as needing a guardian, and nothing else changes.
  Doing it properly means guardian accounts and consent by proxy.
