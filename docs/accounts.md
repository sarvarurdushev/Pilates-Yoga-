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
the body with that person's measurements on it and the writing tools live — the
click-a-muscle-and-write-a-cue flow, with no toggle in front of it — plus
**Evaluate** in the header for the five principles at the end of the class. And
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

There are two surfaces, and the split is not arbitrary — it is the difference
between prose about one moment and the same judgement made every time.

**A note, about one structure.** Click a muscle on the body and the box is
under it: kind (cue, modification, contraindication, goal…), the words, and an
optional rating that has to say *what* it rates — a bare "4" is exactly the
thing this project exists not to produce. The note sits with the measurements
because that is where it will be read.

There is no toggle in front of it. There used to be: "coach mode", a switch at
the bottom of the screen, and the result was a coach looking at their own
student's muscle with no way to say anything about it and no clue the switch
existed. If you are this person's coach, the box is there. If you are not, it
is not, and no switch changes that.

**An evaluation, about the class.** The `Evaluate` button in the header opens
five axes, scored 1–5, the same five every time.

### The five axes are not invented here

They are the **STOTT PILATES Five Basic Principles**, which is what
contemporary instructor training is built on and what an instructor is already
watching for, in this order, on every repetition:

| | Watching for |
|---|---|
| **Breathing** | Three-dimensional rib expansion, in synch with the deep abdominals and pelvic floor. |
| **Pelvic placement** | Neutral or imprint, held on purpose rather than by gripping. |
| **Rib cage placement** | Ribs staying knitted as the arms move, rather than flaring into extension. |
| **Scapular movement** | Organised on the rib cage and still free to move. |
| **Head and cervical** | The neck continuing the curve of the spine. |

A studio that scores anything else has to invent a vocabulary. A studio that
scores these is writing down the lesson it just taught.

Three consequences, and they are the design:

1. **The axes are fixed and closed.** A coach who can add their own axis ends
   up with fifteen, each used twice, and nothing that can be charted.
2. **Every score has an anchor.** 1 is *"not there yet, needs hands-on cueing
   every repetition"*; 5 is *"holds it under load, under fatigue, and in new
   movements"*. Two coaches at the same studio have to mean the same thing by
   a 3 or the line is not worth drawing.
3. **Every score carries a note, and the note is the valuable half.** *"3 — rib
   cage flares on the second half of every roll-down"* is worth more than the 3.

A skipped axis is a **gap in the line, not a zero** — the difference between
*not looked at* and *bad* is the whole reason for scoring anything. The average
is shown only when all five were scored; a mean of the two somebody happened to
fill in is not comparable with a mean of five.

Alongside the five, the four fields a studio actually re-reads: **what we did**,
**springs, box, props**, **the cue that worked** (their words where possible),
and **the plan for next time**. Plus how the class went — light, steady, hard —
which is not the average of the five and is not computed as one: a session can
be technically poor and exactly the right session for somebody who came in
exhausted.

The student sees the same panel under **My feedback**, with the scoring form
replaced by the progress lines. Nothing a coach writes about them is hidden
from them.

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
