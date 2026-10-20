# Fitness Passport across facilities — architecture proposal

Status: **proposal only.** Nothing in this document is built. Phase 4 keeps every Passport read inside
one facility's customer account (`docs/SEDENS_PASSPORT_SPEC.md`). There is no automatic cross-facility
sharing, no global identity, and no merging of records from separate organizations.

## 1. Where we are

- A customer is a `p_users` row with the `student` role **inside one organization**
  (`p_users.id == p_students.id`). Every SEDENS record the room writes carries that organization
  (`s_room_sessions.org_id`, `s_workouts.org_id`, `s_room_scans.org_id`, `s_enrollments.org_id`, …).
- The same person training at Gym A and Gym B has two unrelated accounts. Nothing links them, and
  nothing should link them by matching an email address, phone number, name or birthday: those are
  neither secret nor unique, and staff can type them.
- The facility is the organization that collected the data and, for Korean facilities, the personal
  information controller. Moving a customer's data to another facility is a provision of personal
  information to a third party. Under Korea's Personal Information Protection Act this generally needs
  the person's consent after being told the recipient, the recipient's purpose, the items, how long
  the recipient keeps them, and that they may refuse. Body measurements may count as health
  information, which needs separate consent. **Counsel must confirm this before anything is built.**

## 2. Goals and non-goals

Goals: a customer can choose to carry their own training history, their own scan measurements, and
the courses they bought from one facility to another. They can see exactly what is shared with whom,
and stop it.

Non-goals: facilities browsing each other's customers; a SEDENS-wide customer directory; copying
facility notes or attendance; making scans from different rooms comparable without evidence.

## 3. Identity: a customer-owned SEDENS identity, linked by proof

```
s_persons(id, created_at, auth_kind, auth_ref_hash, deleted_at)
s_person_links(person_id, org_id, user_id, linked_at, proof, revoked_at, UNIQUE(org_id, user_id))
```

- A **person** is created only by the customer, with a credential the customer owns: a passkey, or a
  verified e-mail one-time code. It is never created, reset or linked by facility staff. This depends
  on the customer-controlled authentication proposed in `SEDENS_SECURITY_MODEL.md` (Phase 4, §11).
- A **link** joins one facility account to the person. It needs two proofs in the same flow: the
  customer is signed in to the facility account (with a password they chose), and authenticates as the
  person. The link records which proof was used. Staff cannot create, move or view links.
- One facility account links to at most one person. Unlinking is immediate and needs only the customer.
- Facility account deletion removes the link (cascade), never the person.

## 4. Data classes

| Class | Examples | Who controls | Portable? |
|---|---|---|---|
| Customer's own activity | room workouts, completed and skipped steps, active minutes, self-reported effort | the customer (facility keeps its copy) | yes, with a share grant |
| Customer's own measurements | scan summaries and measurements, with protocol, measurement version, model and rules version | the customer | yes, with a separate grant (health-related) |
| Customer's preferences | language, music, preferred intensity | the customer | yes |
| Purchased course entitlements | a professor course bought on the marketplace | the customer | yes (§6) |
| Facility-granted entitlements | a coach program included with Gym A membership | the facility | no |
| Facility records | attendance and billing records, CRM membership data, room and device identifiers | the facility | no |
| Facility staff notes | coach notes and observations in the coaching workspace | the facility | no |
| Scan photos | retained images | the customer, at the collecting facility | no (never sent across facilities) |

Discomfort and safety answers stay with the collecting facility. They are shown to the customer in
their own Passport and are never shared across facilities.

## 5. Sharing: explicit, scoped, revocable grants

```
s_passport_shares(id, person_id, source_org, target_org, scopes, text_version,
                  granted_at, expires_at, revoked_at)
```

- **Customer-initiated only.** The customer chooses the target facility and each scope
  (`activity`, `measurements`, `preferences`). Nothing is pre-ticked. The consent text names the
  recipient, purpose, items and retention period, and states that the customer may refuse.
- **Read-through, not copy.** The target facility's room and Passport read a *portable projection* of
  the source records at request time: no join of raw tables across organizations, no bulk copy. Each
  item carries its provenance ("recorded at Gym A, 12 Oct"). Facility staff at the target see only what
  the target's own Passport policy shows staff, which today is nothing.
- **Revocation** stops every future read at once. It cannot erase what was already displayed; the
  consent text says so plainly.
- **Expiry**: grants expire (for example after 12 months) unless the customer renews them.
- **Audit**: every cross-facility read writes an audit row in the source organization (external actor,
  no named user, as SEDENS already does) and an entry in the customer's own activity list.

## 6. Course entitlements across facilities

- A course **the customer bought** belongs to the person. At another facility it is playable only if
  that facility has enabled the course for its rooms (`s_facility_course_settings`) and the creator's
  facility terms allow it. Room-only playback is unchanged everywhere: no outside-room playback,
  enforced on the server.
- The entitlement keeps its **pinned version**. A customer who bought version 2 continues version 2.
  A newer revision is offered, never applied silently.
- A course **included by Gym A** for its members stays at Gym A. At Gym B the customer sees it in their
  history ("completed 5 of 8 sessions at Gym A") but cannot play it unless Gym B grants its own access.
- Refunds, sales pauses and suspensions follow the purchase, not the facility.

## 7. Measurements across facilities

Scans from different rooms differ in camera, distance, lighting and floor. The comparability gate
(`pilates/sedens/scan_history.py`) refuses different protocols, measurement versions, models and rules
versions, and low-quality captures. Across facilities it would also need a validated cross-room
compatibility rule, from repeatability testing with real captures in both rooms. Until then,
cross-facility scans are shown side by side as history, and are never compared.

## 8. Preventing cross-organization leakage

- Organization scoping stays the primary invariant: every existing repository read remains scoped
  by `org_id`. Person-level reads exist only in one module that checks a live, unexpired share grant
  for that exact (person, source, target, scope) on every call.
- No API takes a person id from a facility user. A person id never appears in facility-facing responses.
- Organization backups do not carry persons, links or shares from other organizations. Restore never
  recreates a link or a grant; the customer re-confirms.
- Demonstration organizations can never link to or share with real organizations (same rule as
  capability grants today).
- The test matrix covers each staff role, each scope, a revoked grant, an expired grant, an unlinked
  account, a demo/real mix, a deleted facility account, and attempts to enumerate persons.

## 9. Threats considered

| Threat | Defence |
|---|---|
| Staff link a customer's accounts by email or phone | Links need two customer-held proofs; matching on identifiers is never used |
| Staff at Gym A reset a password to impersonate a customer and grant sharing | Grants need the person credential, which staff cannot reset (prerequisite: §3) |
| Gym B enumerates Gym A's customers | No person-level search; reads need a grant naming Gym B |
| Customer revokes, but Gym B keeps reading | Grant checked on every read; projections are not cached across requests |
| Scan comparisons across rooms mislead | Cross-room comparisons are refused without a validated rule (§7) |
| Backups resurrect a revoked share | Restore never restores grants |

## 10. Prerequisites before building

1. Customer-owned authentication: a passkey or verified e-mail, and no staff-set credentials
   (Phase 4 starts this: staff can no longer choose customer passwords).
2. A legal review of consent texts, retention periods and controller/processor roles (Korea PIPA,
   and the law of any other market).
3. A versioned portable export schema (Phase 4's own-data export is the first step: one facility,
   the customer's own records, JSON).
4. Repeatability evidence before any cross-room measurement comparison.
