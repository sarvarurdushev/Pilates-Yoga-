# SEDENS backup and restore

SEDENS records travel inside the platform's existing organization archive (`GET /platform/backup`, restore with `POST /platform/restore`, offline check with `python -m pilates.platform.backup_verify BACKUP.zip`). There is no second backup system: the platform's archive format, ID remapping, foreign-key checks and media handling are unchanged, and every `s_*` table is added through an explicit per-table policy in `pilates/sedens/backup.py`.

Three rules decide what an archive may carry and what a restore may believe:

1. **No live credentials.** Nothing that lets a device, screen or person in is ever exported.
2. **Only this organization's people.** A column that names a user of another organization (who granted, decided or verified something) is exported empty, and the platform audit log never names an outside user (`p_audit.actor_id` is emptied at export if it ever did).
3. **Decisions made outside the organization are re-checked against this server.** An administrator controls their own archive and can edit it, so a decision that another organization or SEDENS made is never taken from the archive: a SEDENS verification returns to the review queue, and an affiliation with an outside creator or facility is re-linked only while this server's own record still agrees. Everything else is the organization's own data to decide.

A policy exists for **every** `s_*` table. Export refuses to run while any `s_*` table has no policy, and `tests/test_sedens_backup.py::test_every_sedens_table_has_a_backup_policy` keeps it that way, so a future table cannot silently drop out of backups.

## What is backed up

| Table | Scope (rows in an organization's archive) | Backed up | Restore behaviour |
|---|---|---|---|
| `s_org_profiles` | this organization | kind (facility / creator studio), display name, language, timezone, detail | replaces the new organization's profile. An archive without a profile row is a facility's. A facility archive restores only into a facility, a creator-studio archive only into a creator studio (or an organization with no SEDENS profile yet). A `sedens` organization is **refused** both as an archive and as a restore target: it is recreated from the command line, never from an archive. |
| `s_capabilities` | this organization's accounts | `creator` grants and revocations | `sedens_reviewer` / `sedens_admin` are never exported or restored. `granted_by` / `revoked_by` are kept only for people inside the archive. |
| `s_creator_profiles` | this organization's accounts | the whole profile (name, type, biography, institution, qualifications, specialties, slug, state, dates, note) | a `verified` (or `pending`) profile comes back **`pending`** ("verification requested"), so a SEDENS reviewer confirms it again for its exact content; `verified_by` is never restored. Other states return as they were; a suspension or rejection already on this server always stays. The public address (slug) is kept when it has the form this server issues and is free; otherwise a new one is issued. |
| `s_creator_facility_affiliations` | affiliations addressed to this facility, and affiliations of this organization's creators with other facilities | status, dates, location, note | see "Cross-organization affiliations" below |
| `s_room_devices` | this organization | name, room, location, dates, last seen, simulated flag | restored **unpaired**: no token, `active` becomes `revoked`. Pair each screen again. |
| `s_room_sessions` | this organization | visit history: customer, room, entry method, CRM provider and reference, state, times, end reason | a fresh random token hash nobody holds; a session that was `active` is closed (`ended`, reason `restored`). |
| `s_crm_settings` | this organization | provider, enabled, non-secret policy (`config` never holds secrets; `save_settings` refuses them) | the demonstration provider is reset to `none` when the restored organization is not a demonstration. |
| `s_crm_member_links` | this organization | CRM member reference to client | as is |
| `s_consents` | this organization | every consent decision (append-only history) | as is, linked to the restored people |
| `s_events` | this organization | local analytics events | as is (integer ids renumbered) |
| `s_media_objects` | course files this organization owns | title, kind, size, the file itself (`sedens-media/` in the archive) | each file passes the upload checks again (byte sniffing, image re-encoding, PDF active-content refusal, size limits) and is stored under a new name; a refused or missing file refuses the whole restore. Repository illustrations are re-linked from the registry, never from the archive. |
| `s_media_rights` | rights of those files | licence, original creator, source and licence links, restrictions, identifiable person, attestation | a SEDENS rights **approval** returns to review (`unreviewed`); a rejection stays. Reviewer names are left out. |
| `s_verification_evidence` | evidence this organization's creators offered | description, link, document | as is |
| `s_courses`, `s_course_prices`, `s_course_facility_terms`, `s_course_modules`, `s_course_sessions`, `s_course_steps`, `s_course_step_anatomy`, `s_course_step_timeline`, `s_course_lessons` | courses this organization's creators own | the whole draft | the course comes back **unpublished** (see "Courses" below). Facility terms naming another facility come back only while that facility exists in the same environment. |
| `s_course_versions`, `s_course_version_media`, `s_course_reviews` | those courses | every submitted version and review comment | the version that was published returns to the review queue; snapshots are rebuilt with the new IDs and hashed by this server; reviewer names are left out. |
| `s_facility_course_settings` | this facility | enabled, included, featured | another organization's course keeps its setting only while it exists here; whether it is still offered is checked every time it is used. |
| `s_purchases`, `s_entitlements`, `s_enrollments`, `s_course_progress` | this organization's customers | simulated purchases, course access, enrolled version, completed sessions and lessons | see "Courses" below. |

## Deliberately excluded

| Excluded | Why |
|---|---|
| `s_room_devices.token_hash`, `s_room_sessions.token_hash` | live credentials; restored screens pair again, restored sessions are closed |
| `s_room_device_pairings` (codes, secrets) | short-lived pairing credentials |
| `s_room_access_codes` | single-use room codes |
| `s_affiliation_ledger` | this server's record of affiliation decisions, which restores are checked against |
| `s_demo_layers` | which demonstration content this server seeded |
| `s_schema` | this server's migration ledger |
| platform `p_sessions`, password hashes | unchanged platform rule |

The manifest records the SEDENS part as `"sedens": {"format": 1, "media_files": {object id: archive member}}`.

## Why nothing is sealed or trusted

An earlier draft sealed verifications and affiliations with a server secret. The review showed that a seal only proves the server once issued a record, not that it still stands: a creator suspended after a backup could restore the old "verified" state, and an affiliation revoked after a backup came back once its row was deleted. So restores now check the server's **current** truth instead:

- **Verifications** are SEDENS decisions about exact profile content. They are never restored: a verified profile returns to the review queue as "verification requested", and a reviewer confirms it again (one click when nothing changed).
- **Affiliations** are checked against `s_affiliation_ledger`, which database triggers keep up to date on every request, decision, withdrawal, deletion and restore, and which is not deleted when an affiliation, creator or facility is deleted. It records the creator's organization and whether the latest decision was the **facility's "no"**, decided when the decision is made; a restore can never change either.

## Cross-organization affiliations

An affiliation joins two organizations: a creator (in a facility or a creator studio) and a facility. Each side's archive carries it, but neither side's archive can prove the other side's consent. A restore therefore re-links an affiliation whose other side lives outside the archive only when **all** hold:

1. this server's ledger still records **exactly** what the archive says for that lineage (same creator, facility, location and status), so nothing this server never recorded is accepted. When the ledger holds a later **facility "no"** (a decline, or a revocation by the facility), the row comes back as that "no", dated by the ledger: it grants nothing and keeps the facility's 30-day cooldown, whatever dates or names the archive carries. Any other later decision (the creator's own withdrawal, or an affiliation that **ended** because its location or the creator's account was deleted while both organizations still existed) leaves the row out;
2. the other side still exists on this server, in the same demonstration/real environment (the creator's profile; or the facility, with the same location if the affiliation was location-scoped), the restored organization is a facility when it is the facility side, and the creator never belongs to the facility it is affiliated with;
3. **no live row descends from the same original** (`id` or `origin_id`). One archive therefore re-links an affiliation at most once: restoring a facility's archive into a second organization does not copy the creator's consent to it. A successful re-link moves the lineage to the restored copy, so after it only an archive of that restored organization can re-link it (an archive of the original organization cannot, even after the restored copy is deleted). This fails closed: the creator can ask again.

The other organization's users, members and records are never imported: an affiliation row keeps pointing at the creator's existing profile (or the facility's existing organization) on this server. It still grants content distribution only. Rows that cannot be re-linked are left out and counted in the restore result (`affiliations_not_restored`); the creator can ask again (a facility's earlier "no" still has its 30-day cooldown).

## Restore result

`restore_archive` returns the platform's counts plus a `sedens` summary: `room_screens_to_pair_again`, `room_sessions_closed`, `verifications_to_confirm`, `affiliations_restored`, `affiliations_not_restored`, `sedens_permissions_not_restored`, `crm_settings_reset`, `courses_to_confirm`, `media_rights_to_review`, `course_files`, `course_terms_not_restored`, `course_settings_not_restored`, `purchases_not_restored`, `course_access_not_restored`.

Restore still requires a new, empty organization containing only the restoring administrator. A creator studio may also be restored into a creator studio registered afresh: its administrator's own profile and permission are filled from the archive instead of blocking the restore.

## Compatibility

- Archives made before SEDENS, and Phase 1 archives (which carried no `s_*` tables), still restore: every SEDENS table is optional on restore, and the restored organization simply starts with no SEDENS records.
- `backup_verify` accepts SEDENS archives and dry-runs the restore in a disposable SEDENS-enabled studio.
- Restore now also refuses a media record whose type the studio would never accept on upload (anything other than JPEG, PNG, WebP, MP4, WebM or DICOM, or an unknown media purpose), and names restored files by their type, so a crafted archive cannot plant a page that the workspace would serve from its own origin.
- A restored media record's `detail` is **measured from the restored file** with the upload's own checks (image format and size, DICOM metadata and limits, video signature). From the archive only a few labelled facts of the expected types are kept (`generated`, `sample`, `demo`, `panel`, `provenance`, `attribution`, an `http(s)` `source_url`, `copied_from`).
- Every archived value must have its column's declared type (text, integer or real), and a record that appears twice in one table (the same primary key) refuses the restore. SQLite would otherwise keep text in an integer column, and an update could apply twice to one target. The workspace also coerces or escapes those values where it prints them.
- `backup_verify` reports any unexpected failure of its dry-run restore as a verification failure, never a crash.

## Courses (Phase 2)

Course content belongs to the **creator's organization** (`owner_org_id`) and travels in that organization's archive, files included. The rules follow the same three principles:

- **The creator's content comes back intact; SEDENS's decisions do not.** A restored course is not published: the version that was published returns to the SEDENS review queue as "submitted", with the note "Restored from a backup", and a reviewer confirms it (one decision). Every other version is kept as history (an approved or superseded version becomes `withdrawn`). Each snapshot names the course's own rows, so it is rebuilt with the new IDs and hashed again by this server; the archive's hash is never trusted. A crafted snapshot therefore reaches nobody without a reviewer seeing exactly it. Rights approvals return to review as well.
- **Enrollments keep their version while SEDENS stands behind it.** An enrollment whose version is no longer published or superseded (only a restore causes this) reads the course's published version instead, and progress is matched by the restored session and lesson IDs.
- **Records about another organization's course come back only while this server confirms them.** A facility's enabled/included/featured setting for another organization's course is kept while that course exists here, in the same environment (whether it is still offered is decided each time it is used). A customer's entitlement to another organization's course is kept when it is a facility offer (re-checked on every use) or a free marketplace enrollment for a course that is still free on the marketplace. **Simulated purchases never move between organizations**, and a purchase's entitlement and enrollment are left out with it. An enrollment needs its entitlement and a version this server published.

Restoring an organization that owns courses does not restore other facilities' settings or other organizations' customers' enrollments for those courses: those belong to the other organizations (and were removed with the course's original copy).

A creator's **course export** (a separate download, see `docs/SEDENS_MARKETPLACE_MODEL.md`) is for moving or keeping one course; the organization archive remains the way to recover a whole organization.
