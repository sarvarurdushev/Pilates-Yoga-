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
coach at the Tashkent studio who takes classes as a student at Samarkand.

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
| Open an assigned student's record | — | ✅ with consent | ✅ |
| Write feedback, cues, contraindications, goals | — | ✅ assigned only | ✅ |
| Read a health screening | — | ✅ flags only | ✅ full |
| Approve a role request | — | — | ✅ |
| Grant admin | — | — | ✅ |
| Create a studio | — | — | ✅ |
| Assign a coach to a student | — | request | ✅ |
| See every studio | — | — | ✅ |
| Erase a person | — | — | ✅ |
| Read the audit log | own | own actions | ✅ |

Two lines in that table are the ones that matter:

**"Open an assigned student's record — with consent."** Same building is not
permission. A studio with two coaches is the first place the naive rule leaks,
and health data is the worst thing to leak.

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
(`+998901234567`) so that formatting never forks a person.

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

**Nothing is global.** Every membership names a studio. A coach at Tashkent
cannot see Samarkand, and an admin sees both only because admin is scoped to the
studios they are admin *of*.

The flow, in the order it happens:

1. **Admin creates the studio.** Name, city, country, timezone.
2. **People sign up and choose that studio** from a list, or arrive by
   invitation with the studio already fixed.
3. **The coach opens the directory** — everybody at their studio, names and
   nothing else. Not a record, a phone book.
4. **The coach adds a student** from that directory. That creates an
   *assignment request*.
5. **The student accepts** — one tap, and it is also the consent: *"Sam may see
   my measurements and screening flags at Tashkent Pilates."* An admin can
   assign directly, and the student is told rather than asked.
6. **From then on** that student is on the coach's roster, and the coach can
   open the record, read the flags, write cues and goals, and watch the line
   move.
7. **Either side can end it.** The student revokes; the coach removes; the admin
   reassigns. The notes stay — they are the studio's record of care, and the
   research on clinical notes is unambiguous that they are kept — but the coach
   loses the ability to read new measurements the moment consent ends.

A student can have more than one coach. A coach has many students. Both are
scoped to a studio, and the assignment carries dates, so *"who was coaching them
in March"* is answerable a year later.

---

## What each role actually sees on screen

The same body, the same measurements, three different rooms.

**Student.** Their body, their numbers, their progress, and what their coach
wrote — in plain language, no jargon column. One question answered: *am I
getting better, and what should I do next?* No roster, no directory, no other
person anywhere in the interface.

**Coach.** Opens on the roster, not on a body: who is coming, who has a flag to
read before class, who has a goal past its review date. Picking a student opens
the body with that person's measurements on it and the writing tools live — the
click-a-muscle-and-write-a-cue flow that already exists. Plus the things the
research says instructors actually track: contraindications, cues in the
student's own words, modifications and why, springs and props, one to three live
goals with review dates, and progress across the class as a group.

**Admin.** Everything above, plus the machinery: studios, people, pending role
requests, invitations, assignments, the audit log, and the erase button. Admin
is the only place a role changes hands.

A person with three memberships gets a switcher, and the interface changes
completely when they use it. That is the point — not a menu that grows, a room
that changes.

---

## Privacy rules, stated once

1. **Health data is not shared by default.** Not by location, not by role. Only
   by an assignment the student accepted.
2. **Consent is revocable and dated.** Revoking is one tap and takes effect
   immediately for future reads.
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
