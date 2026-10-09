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
| `s_org_profiles` | this organization | kind (facility / creator studio), display name, language, timezone, detail | replaces the new organization's profile. A `sedens` organization is **refused**: it is recreated from the command line, never from an archive. |
| `s_capabilities` | this organization's accounts | `creator` grants and revocations | `sedens_reviewer` / `sedens_admin` are never exported or restored. `granted_by` / `revoked_by` are kept only for people inside the archive. |
| `s_creator_profiles` | this organization's accounts | the whole profile (name, type, biography, institution, qualifications, specialties, slug, state, dates, note) | a `verified` profile comes back **`pending`** ("verification requested"), so a SEDENS reviewer confirms it again for its exact content; `verified_by` is never restored. Other states return as they were. A slug already used on this server gets a new suffix. |
| `s_creator_facility_affiliations` | affiliations addressed to this facility, and affiliations of this organization's creators with other facilities | status, dates, location, note | see "Cross-organization affiliations" below |
| `s_room_devices` | this organization | name, room, location, dates, last seen, simulated flag | restored **unpaired**: no token, `active` becomes `revoked`. Pair each screen again. |
| `s_room_sessions` | this organization | visit history: customer, room, entry method, CRM provider and reference, state, times, end reason | a fresh random token hash nobody holds; a session that was `active` is closed (`ended`, reason `restored`). |
| `s_crm_settings` | this organization | provider, enabled, non-secret policy (`config` never holds secrets; `save_settings` refuses them) | the demonstration provider is reset to `none` when the restored organization is not a demonstration. |
| `s_crm_member_links` | this organization | CRM member reference to client | as is |
| `s_consents` | this organization | every consent decision (append-only history) | as is, linked to the restored people |
| `s_events` | this organization | local analytics events | as is (integer ids renumbered) |

## Deliberately excluded

| Excluded | Why |
|---|---|
| `s_room_devices.token_hash`, `s_room_sessions.token_hash` | live credentials; restored screens pair again, restored sessions are closed |
| `s_room_device_pairings` (codes, secrets) | short-lived pairing credentials |
| `s_room_access_codes` | single-use room codes |
| `s_affiliation_ledger` | this server's record of affiliation decisions, which restores are checked against |
| `s_schema` | this server's migration ledger |
| platform `p_sessions`, password hashes | unchanged platform rule |

The manifest records the SEDENS part as `"sedens": {"format": 1}`.

## Why nothing is sealed or trusted

An earlier draft sealed verifications and affiliations with a server secret. The review showed that a seal only proves the server once issued a record, not that it still stands: a creator suspended after a backup could restore the old "verified" state, and an affiliation revoked after a backup came back once its row was deleted. So restores now check the server's **current** truth instead:

- **Verifications** are SEDENS decisions about exact profile content. They are never restored: a verified profile returns to the review queue as "verification requested", and a reviewer confirms it again (one click when nothing changed).
- **Affiliations** are checked against `s_affiliation_ledger`, which a database trigger keeps up to date on every request, decision, withdrawal and restore, and which is not deleted when an affiliation, creator or facility is deleted.

## Cross-organization affiliations

An affiliation joins two organizations: a creator (in a facility or a creator studio) and a facility. Each side's archive carries it, but neither side's archive can prove the other side's consent. A restore therefore re-links an affiliation whose other side lives outside the archive only when **all** hold:

1. this server's ledger still records **exactly** what the archive says for that lineage (same creator, facility, location and status), so a later withdrawal, decline or revocation is never undone, and nothing this server never recorded is accepted;
2. the other side still exists on this server, in the same demonstration/real environment (the creator's profile; or the facility, with the same location if the affiliation was location-scoped);
3. **no live row descends from the same original** (`id` or `origin_id`). One archive therefore re-links an affiliation at most once while that lineage lives: restoring a facility's archive into a second organization does not copy the creator's consent to it. Once the restored copy is deleted, the original can be re-linked again.

The other organization's users, members and records are never imported: an affiliation row keeps pointing at the creator's existing profile (or the facility's existing organization) on this server. It still grants content distribution only. Rows that cannot be re-linked are left out and counted in the restore result (`affiliations_not_restored`); the creator can ask again (a facility's earlier "no" still has its 30-day cooldown).

## Restore result

`restore_archive` returns the platform's counts plus a `sedens` summary: `room_screens_to_pair_again`, `room_sessions_closed`, `verifications_to_confirm`, `affiliations_restored`, `affiliations_not_restored`, `sedens_permissions_not_restored`, `crm_settings_reset`.

Restore still requires a new, empty organization containing only the restoring administrator. A creator studio may also be restored into a creator studio registered afresh: its administrator's own profile and permission are filled from the archive instead of blocking the restore.

## Compatibility

- Archives made before SEDENS, and Phase 1 archives (which carried no `s_*` tables), still restore: every SEDENS table is optional on restore, and the restored organization simply starts with no SEDENS records.
- `backup_verify` accepts SEDENS archives and dry-runs the restore in a disposable SEDENS-enabled studio.
- Restore now also refuses a media record whose type the studio would never accept on upload (anything other than JPEG, PNG, WebP, MP4, WebM or DICOM, or an unknown media purpose), and names restored files by their type, so a crafted archive cannot plant a page that the workspace would serve from its own origin.

## Creator-owned content (Phase 2)

Phase 2 course content follows the same rules; each new table gets its policy in the same commit that creates it.

- A course, its modules, sessions, steps, versions, prices, distribution choices, rights metadata and uploaded course media belong to the **creator's organization** and travel in that organization's archive (course media files go through the same file hook as platform media).
- A facility's archive carries only the facility's own decisions about other creators' courses (enabled, included, featured). On restore these are re-derived against the current access rules, never trusted from the archive: a facility cannot gain a course it may no longer receive.
- SEDENS course-review decisions are not restored, like verifications: a restored course that was published comes back waiting for review. Purchases and the entitlements they grant are checked against server-side records that survive deletion, the same way affiliations are; anything this server cannot confirm is not restored.
- A creator's **course export** (a separate download, see `docs/SEDENS_MARKETPLACE_MODEL.md`) is for moving or keeping a course; the organization archive remains the way to recover a whole organization.
