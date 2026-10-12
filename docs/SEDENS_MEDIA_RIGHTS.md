# SEDENS media rights

Scope: the files a course uses (videos, photos, PDFs), the rights information each one carries, how files are checked, stored and served, and where they may come from. Everything here is enforced on the server in `pilates/sedens/course_media.py`, `media_store.py`, `access.py`, `video_providers.py`, `course_export.py` and `backup.py`, with the schema in `pilates/sedens/migrations/0009_course_media.sql`. Pages only show what the server returns.

What is **not** built or is demonstration only, stated once here and again where it matters:

- No stock clip has been curated: the import manifest in `data/content_sources.json` is empty.
- Higgsfield is an inactive provider. Nothing is generated, and no generated output is stored.
- No file has been reviewed for its movement by an expert. The repository illustrations are AI-generated. In a demonstration, the fictional "Demo Reviewer (fictional)" accepts the **rights** of the one illustration a demonstration course uses, so that course can be approved; that is a demonstration step about permission to distribute, not a review of the movement.
- Guided-training media plays only in an authorized room. Home playback is off (`access.HOME_PLAYBACK = False`), and the synchronized room player is Phase 3.
- Payments are simulated; nothing in this document involves money.

## 1. What a creator can upload

Course media has three kinds (`media_store.KINDS`). The server decides the type from the bytes, never from the file name or the type the browser claims.

| Kind | Accepted formats | Used for |
|---|---|---|
| `video` | MP4, WebM | a guided-training step's video; a professional-education video lesson |
| `image` (a photo) | JPEG, PNG, WebP (re-encoded on upload) | a course cover; a step's picture; an image lesson |
| `pdf` | PDF without active content | a PDF lesson; a supporting document for creator verification |

A **supporting document** is uploaded the same way (usually as a PDF) and then attached to a verification evidence record with `POST /sedens/creator/evidence` (`course_media.add_evidence`). The evidence record may only point at the creator's own file. See `docs/SEDENS_CONTENT_GOVERNANCE.md` for verification.

The upload route is `POST /sedens/creator/media/upload?kind=&filename=&title=&rights=<JSON>`, with the file as the request body (`course_http._media_upload`). Only a person with the `creator` capability and a creator profile can upload. The Creator Studio's media library is the page at `#/creator/media`.

## 2. The attestation

Every upload must carry the creator's attestation to this exact sentence (`course_media.ATTESTATION`):

| Language | Sentence |
|---|---|
| en | I own this material or have permission to distribute it through SEDENS. |
| ko | 이 자료를 직접 소유하고 있거나 SEDENS를 통해 배포할 권한이 있습니다. |

The attestation version is **`2026-10-v1`** (`course_media.ATTESTATION_VERSION`). The server does not receive the sentence itself; it checks that the creator agreed to the current version. An upload is accepted only when the rights JSON contains `"attest": true` (the boolean, not a string such as `"yes"`) and `"attestation_version": "2026-10-v1"`. Anything else is refused with `attestation_required` before the file is read. The Creator Studio receives the sentence and the version from `GET /sedens/creator/studio` (`course_http.vocabulary()`), so the page shows the sentence the server checks.

The attestation is stored with the person who gave it and when (`attested_by`, `attested_at`) and the version they agreed to (`attestation_version`). Repository illustrations (section 9) are recorded with the version `repository-registry`, because no creator made them.

Importing a course export also needs the importer's own attestation for its files (`?attest=1&attestation_version=2026-10-v1`); the exporter's attestation is never carried over.

## 3. Rights fields (`s_media_rights`)

One row per file, written together with the file record. A file without a rights row cannot be added to a course (`courses._own_media` refuses with `rights_required`).

| Field | Allowed values | Set by |
|---|---|---|
| `licence_type` | `own_work`, `permission_granted`, `pexels`, `pixabay`, `cc0`, `cc_by`, `cc_by_sa`, `other`; and `repo_owned`, which only the repository registry sets | creator (`course_media.LICENCES`) |
| `original_creator` | required text, up to 160 characters | creator |
| `source_url` | a web address (`http` or `https`), up to 500 characters; required for some licences (below) | creator |
| `licence_url` | a web address, up to 500 characters; required for some licences (below) | creator |
| `restrictions` | free text, up to 1,000 characters, optional | creator |
| `identifiable_person` | `none`, `consented`, `unknown` | creator (`course_media.PEOPLE`) |
| `attestation_version` | `2026-10-v1` for uploads, `repository-registry` for repository illustrations | server |
| `attested_by`, `attested_at` | the uploader and the time | server |
| `review_status` | `unreviewed` (always the starting value), `approved`, `rejected` | SEDENS reviewer |
| `reviewed_by`, `reviewed_at`, `review_note` | the reviewer, the time, the reason | SEDENS reviewer |

The file record itself (`s_media_objects`) holds the owner organization, the creator profile, the uploader, the source (`creator_upload`, `repo` or `stock`), the kind, the detected type, size, SHA-256, a private storage key, the original file name (base name only, up to 160 characters), a title, image width and height, and a state (`ready` or `retired`).

### When links are required

`course_media.rights_from` applies these rules; a missing or malformed link is refused with `rights_incomplete`.

| Licence | Original source link | Licence page link |
|---|---|---|
| `own_work`, `permission_granted` | optional | optional |
| `pexels`, `pixabay`, `cc0`, `cc_by`, `cc_by_sa` | required | required |
| `other` | required | optional |

A creator cannot choose `repo_owned`: it is not in `LICENCES`, so an upload claiming it is refused (`tests/test_sedens_phase2_security.py::test_9_no_file_enters_a_course_without_rights`).

## 4. Rights review

| Status | Meaning | Who sets it |
|---|---|---|
| `unreviewed` | nobody at SEDENS has looked at the rights yet | the server, on every upload, import and repository illustration |
| `approved` | a SEDENS reviewer accepted the rights information | a SEDENS reviewer, `POST /sedens/review/media/decide` (`course_review.decide_media`) |
| `rejected` | a SEDENS reviewer did not accept it; a note to the creator is required | a SEDENS reviewer, the same route |

- Only a holder of the `sedens_reviewer` capability can decide, and only for a file in the same environment (demonstration or real). Each decision is written to the audit log (`media:rights-review`). The creator cannot change the status; no route lets them.
- A reviewer never decides the rights of their own file: a file they uploaded, or one of their own creator profile, is refused with 403 `self_review` (`tests/test_sedens_courses.py::test_a_reviewer_never_decides_the_rights_of_their_own_file`).
- **A course version is approved only when every file it uses has `approved` rights.** Approval is not needed to submit, but the course decision refuses with 409 `rights_not_reviewed` while any file of the version is `unreviewed` or `rejected` (`course_review.decide`). A file therefore reaches customers only with rights a SEDENS reviewer accepted. The review page lists each file of the submitted version with its rights, its current status and approve/reject buttons, and says the files come first. Tests: `tests/test_sedens_courses.py::test_a_version_is_approved_only_after_every_file_has_accepted_rights`; over HTTP, `tests/test_sedens_course_http.py::test_investor_journey`; in a browser, `web/test/sedens-courses.browser.mjs`.
- The course reviewer also marks the `rights_licensing` checklist item for the version as a whole.
- A **rejected** file stops its course from being submitted: `courses.readiness` reports `media_rights_rejected` (`tests/test_sedens_courses.py::test_rejected_rights_block_submission`).
- Rejecting a file's rights after its course was published does not unpublish that version by itself. A reviewer takes a course down by suspending it (`docs/SEDENS_CONTENT_GOVERNANCE.md`).
- A restore from a backup returns every `approved` status to `unreviewed`; a rejection stays (section 13).

## 5. The order of checks on upload

Nothing is read from the request body until the person is authorized and the rights are valid. `tests/test_sedens_courses.py::test_upload_requires_rights_before_reading_the_file` and `tests/test_sedens_phase2_security.py::test_9_no_file_enters_a_course_without_rights` pass a body that fails the test if it is read at all.

1. **Request guard.** The POST must carry the `X-Sedens-Request: 1` header and, when present, a same-host `Origin` (`http._guard`, `csrf`, 403).
2. **Rate limit.** At most 12 uploads per minute per visitor address (`http.RATE["upload"]`, `rate_limited`, 429).
3. **Sign-in.** A valid platform session (401 otherwise).
4. **Rights present.** The `rights` query value must be JSON (`rights_required` otherwise).
5. **Creator, then rights.** The `creator` capability and a creator profile (`course_media._creator`; `no_profile` otherwise), then the rights are validated: attestation and version, licence, original creator, identifiable person, required links (`course_media.rights_from`).
6. **Kind and size.** The kind is `video`, `image` or `pdf`, and the declared `Content-Length` is above zero and within this deployment's limit for that kind (`media_store._capped`; `invalid_media_kind` 400, `media_too_large` 413).
7. **Upload slot.** At most two uploads are received at once on the server (`uploads_busy`, 429).
8. **Streaming.** The body is written to `incoming/` in 64 KB blocks while its SHA-256 is computed. A body shorter than declared is refused (`upload_interrupted`) and the partial file is removed (`tests/test_sedens_media_store.py::test_an_interrupted_upload_leaves_nothing_behind`).
9. **Byte checks** (below). Any failure removes the file.
10. **Keep.** The file moves into the store under a random name, then the file record and the rights record are written together. If the database write fails, the stored file is deleted.

### Byte checks (`media_store.check`)

| Kind | Check | Refusal |
|---|---|---|
| video | MP4: an `ftyp` box with a known brand (`isom`, `iso2`, `iso4`, `iso5`, `iso6`, `mp41`, `mp42`, `avc1`, `dash`, `M4V `, `MSNV`). WebM: the EBML header and the `webm` document type in the first 64 bytes. Only the header is checked; the video is not decoded or transcoded. | `media_type_mismatch` (415) |
| image | Must open and verify in Pillow as JPEG, PNG or WebP, at most 16 megapixels. It is then **re-encoded**: camera and location metadata (EXIF) and any bytes hidden after the image are dropped, and the SHA-256 is computed again over the stored bytes. SVG and other formats are refused. | `media_type_mismatch` (415), `media_too_large` (413) |
| pdf | Must start with `%PDF-`. Refused if the raw bytes contain `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile` or `/RichMedia`. This sees uncompressed markers only, which is why every PDF is also served as a sandboxed download (section 7). | `media_type_mismatch`, `pdf_active_content` (415) |

Tests: `tests/test_sedens_media_store.py::test_videos_are_recognised_by_their_bytes`, `test_images_are_re_encoded_without_location_data`, `test_pdfs_with_active_content_are_refused`; over HTTP, `tests/test_sedens_course_http.py::test_uploads_check_rights_before_the_file_and_the_bytes_after`.

### Size limits per deployment mode (`media_store.LIMITS`)

| Mode | Video | Image | PDF |
|---|---|---|---|
| `local_room` | 300 MB | 12 MB | 25 MB |
| `demo_free` | 25 MB | 8 MB | 10 MB |

Any other mode name falls back to the `demo_free` limits (`media_store.limit`). The free demonstration keeps files small because its storage can be erased on any restart (`modes.Mode.storage`, `docs/SEDENS_DEPLOYMENT_MODES.md`). Tested by `tests/test_sedens_media_store.py::test_size_limits_follow_the_deployment_mode`.

## 6. Where files are stored

Course files never enter the platform's `p_media` table and are never written under `web/` (everything under `web/` is public). They live in a separate folder beside the database:

```
<database file>.sedens-media/
  incoming/                     files being received and checked
  objects/<owner org id>/<random id>.<ext>
```

The folders are created with mode `0700` and each kept file with mode `0600`. The stored name is a random id plus the extension of the detected type; the uploaded file name is kept only as a label. `media_store.object_path` refuses any key that would resolve outside `objects/`. Tested by `tests/test_sedens_media_store.py::test_kept_files_are_private_and_outside_the_web_folder`.

On the free demonstration host this folder is not persistent: files can disappear on a restart or redeploy. A creator keeps their work with a course export (section 13).

## 7. How files are served

There is one route: `GET /sedens/media/file?id=` (`course_http._media_file`). It reads the optional platform sign-in and the optional room (device and room-session cookies), asks `access.media_access` whether this person or room may read the file, and only then streams it. Anything not allowed, including an id that does not exist, answers **404** (`media_not_found`), so a refusal does not reveal that a file exists.

`media_store.stream_file` sends:

| Header | Value |
|---|---|
| `Content-Type` | the type detected on upload |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; sandbox` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` | `private, no-store` |
| `Accept-Ranges` | `bytes` |
| `Content-Disposition` | `attachment; filename="…"` for every PDF (the name reduced to safe characters) |

It honours one byte range per request (`bytes=a-b`, `bytes=a-`, `bytes=-n`) with `206` and `Content-Range`, so a video can seek; an unsatisfiable range gets `416`. PDFs are always downloads, never shown inline. Tested by `tests/test_sedens_media_store.py::test_files_stream_with_ranges_and_safe_headers`.

### Who may read a file (`access.media_access`)

1. **The file's own creator**: signed in to the owner organization, holding the `creator` capability, with the creator profile the file belongs to. A colleague in the same organization is not the creator and gets 404. If the creator's profile was deleted, the file stays with the organization's administrator (who must also hold `creator` and a profile).
2. **A SEDENS reviewer** who may review the course (same environment, not their own course), for a file in a version that is `submitted`, `needs_revision` or `published`; and a SEDENS reviewer of the same environment for a file attached to another creator's **verification evidence** (`tests/test_sedens_courses.py::test_reviewers_can_open_verification_evidence`). The creator review page links each evidence file.
3. **Anyone who may see the course's description**, for the **cover picture** of the published version.
4. **An authorized room** where the course may be played (`access.can_play_in_room`: the facility enabled it there and the customer is entitled or it is free there), for a file of the **published** version or of the version the room's customer is enrolled in (an older, superseded version keeps its files: `tests/test_sedens_courses.py::test_a_customer_on_an_older_version_still_sees_its_pictures_in_the_room`).
5. **An enrolled customer** of a **professional-education** course with a standing entitlement (`access.can_download_resource`), for a file of the version they use (their enrolled version, or the published one). Guided-training media is never downloadable outside a room, even when the customer owns the course.

A file that is in no submitted version (a draft's file) is readable only by its creator.

## 8. Cross-organization rules

| Rule | Where it is enforced | Test |
|---|---|---|
| A course can use only files of its own creator: same organization, same creator profile, state `ready`, with a rights record. Never a colleague's file, even in the same facility. | `courses._own_media` | `tests/test_sedens_phase2_security.py::test_11_an_export_carries_only_the_course_s_own_files`; `tests/test_sedens_courses.py::test_media_with_rights_is_kept_and_served_only_to_those_allowed` (another facility's coach is refused `unknown_media`); `test_9_no_file_enters_a_course_without_rights` |
| Course steps and lessons point only at `s_media_objects` (foreign keys), and exercises only at SEDENS Standard ids or catalog keys, never at a facility's own exercises. A course therefore has no path to a facility's `p_media`. | `migrations/0010_courses.sql` | (schema) |
| Files are reachable only through a course version the person may use. Customers and administrators of other facilities get 404; so do the offering facility's own administrator and its customers outside the room. In that facility's room the guided step picture is served; a paid course's PDF is not. | `access.media_access` | `test_5_course_media_never_crosses_organizations` |
| A colleague never reads another creator's file. | `access.media_access` (creator branch) | `test_11_an_export_carries_only_the_course_s_own_files` |
| Another facility's coach, another facility's administrator, a customer, and the creator's own facility administrator cannot read a draft file. | `access.media_access` | `test_media_with_rights_is_kept_and_served_only_to_those_allowed` |
| Platform media routes never serve course files: course file ids are not in `p_media`. | `pilates/platform/media.py::media_path` | `test_5_course_media_never_crosses_organizations` (last assertion) |
| Another demonstration visitor never reads a file; an unknown id is 404 even without sign-in. | `access.media_access`, demonstration isolation | `tests/test_sedens_course_http.py::test_uploads_check_rights_before_the_file_and_the_bytes_after`, `test_course_routes_need_sign_in_and_the_csrf_header` |
| A facility administrator cannot retire a coach's file, even after granting themselves creator tools. | `course_media.retire` | `test_12_a_facility_admin_never_changes_a_creators_content` |
| An export carries only the course's own files. | `course_export.export` | `test_11_an_export_carries_only_the_course_s_own_files` |

## 9. Repository illustrations

`data/content_sources.json` lists the repository's own labelled assets. Each entry records its path, kind and type, what it shows, a description in English and Korean, its provenance, its **SHA-256**, a rights record and a label.

| Id | File | Shows |
|---|---|---|
| `repo-bridge` | `web/assets/studio/bridge.png` | a fictional adult in a bridge position (`pelvicCurl`) |
| `repo-bird-dog` | `web/assets/studio/bird-dog.png` | a fictional adult reaching opposite arm and leg (`birdDog`) |
| `repo-exercise-sheet` | `web/assets/platform/exercise-sheet.png` | a 3×3 sheet of fictional adults in mat exercises |

All three were generated with an image-generation tool for this repository (prompts in `docs/STUDIO_ASSETS.md` and `docs/PLATFORM_EXERCISE_IMAGE.json`). Their rights record is `licence_type: repo_owned`, original creator "SEDENS repository (generated imagery)", identifiable person `none`, review status `unreviewed` when added (a SEDENS reviewer must accept it before a course using it is approved), with the restriction "Show with the AI-generated label. Never present as a real instructor or a measured movement." Their label is:

- en: "AI-generated illustration — not a real instructor; movement not yet expert reviewed"
- ko: "AI 생성 일러스트 — 실제 강사가 아니며 동작은 아직 전문가 검토 전"

A creator adds one to their media with `POST /sedens/creator/media/repo-asset` (`course_media.add_repo_asset`). This creates a file record with source `repo` and a rights row copied from the registry; the bytes are read from the repository, not copied. `course_media.describe` returns the registry label with every such file. These images live under `web/assets/`, which the web app serves publicly anyway; inside a course they are still read through `GET /sedens/media/file` like any other course file.

`video_providers.problems()` checks the registry: every asset file must exist under `web/assets/`, match its recorded SHA-256 (a changed file is reported), and carry every rights field. `tests/test_sedens_media_store.py::test_content_sources_and_providers` requires it to report nothing.

## 10. Stock footage

The registry allows two stock sources, both `enabled` with `auto_download: false`:

| Source | Licence page | Export | Note in the registry |
|---|---|---|---|
| Pexels | `https://www.pexels.com/license/` | reference only (the licence allows use, not redistribution as a library) | People shown must not appear to endorse SEDENS; review each clip before use. |
| Pixabay | `https://pixabay.com/service/license-summary/` | reference only | Review each clip before use. |

The registry's rules: nothing is downloaded automatically; a stock clip is added only after a person watched it, checked the movement and the licence page, and recorded both; stock and generated media always show the stock label, which only an expert review of the movement (not built) could remove; social media, video sites and search results are never sources.

**The import manifest is empty** (`"status": "empty"`, `"entries": []`). Its recorded reason: "No stock clip has been watched and checked by a person yet, so none is listed. Demonstrations use the repository illustrations above." An entry, once added, must record `id`, `source`, `page_url`, `file_url`, `licence_url`, `original_creator`, `retrieved_at`, `sha256`, `shows_exercise`, `checked_by`, `checked_at`, `movement_notes` and `identifiable_person`; `video_providers.problems()` reports any entry without who checked it, when, its licence page and its checksum. The test asserts the manifest is empty and that no source downloads automatically.

No code imports manifest entries into courses yet. `LicensedStockVideoProvider` only reads the manifest, and nothing writes a file record with source `stock`. Today a creator who uses a Pexels or Pixabay clip uploads it themselves with licence `pexels` or `pixabay` (both links required). `course_media.describe` then attaches the stock label to that file:

- en: "Demo media — movement not yet expert reviewed"
- ko: "데모 미디어 — 동작은 아직 전문가 검토 전"

There is no movement-review state for files yet, so this label stays on every `pexels` or `pixabay` file whatever its rights review says. Rights approval is about permission to distribute, not about the movement.

## 11. Generated video (Higgsfield)

`video_providers.HiggsfieldVideoProvider` exists only as an inactive interface:

- `enabled = False`; the registry's `higgsfield` source is `enabled: false`, and `video_providers.problems()` reports it if anyone switches it on.
- It needs no API key: it reads no key or setting, so the app and tests run without one.
- `generate()` always refuses with `provider_disabled` (503). Nothing calls Higgsfield, and no generated output is stored or faked.
- The future workflow it records is `GENERATION_WORKFLOW`: approved reference movement → generation → comparison (automatic and by a person) → expert review → publish.
- Every provider has `starts_reviewed = False`. Generated video would enter as an ordinary unreviewed file and could never become approved content automatically: rights approval is a reviewer's decision (`decide_media`), and publication is a course reviewer's decision on an exact version.

Tested by `tests/test_sedens_media_store.py::test_content_sources_and_providers`. `GET /sedens/creator/media/sources` returns the registry, the stock label and the workflow for the Creator Studio.

## 12. Retiring a file

A creator retires one of their own files with `POST /sedens/creator/media/retire` (`course_media.retire`). Only the file's own creator in the owner organization can; anyone else gets 404.

- The file's state becomes `retired`: it leaves the media library and can no longer be attached (`_own_media` requires `ready`).
- It is removed from every draft that used it (step video and picture, lesson file, course cover).
- A submitted or published version that already uses it **keeps it**: `s_course_version_media` still links it, so customers of that version are not affected.
- The bytes are not deleted, and the file stays in organization backups. There is no deletion of a file's bytes today.

## 13. Backups, course exports and imports

**Organization backups** (`docs/SEDENS_BACKUP_RESTORE.md`) carry the organization's file records (`s_media_objects`, without the storage key), their rights rows and the files themselves under `sedens-media/` in the archive. A backup refuses to complete if a stored file is missing. On restore (`backup._restore_media`):

- every uploaded file passes the same kind, size and byte checks as an upload (`media_store.adopt`, with this server's mode limits) and is stored under a new name in the new organization. A refused or missing file refuses the whole restore (`tests/test_sedens_course_backup.py::test_course_files_are_checked_again_on_restore`);
- a repository illustration is re-linked from this server's registry, never taken from the archive; an unknown one refuses the restore;
- every rights **approval** returns to `unreviewed` with the note "Restored from a backup. Waiting for SEDENS to review the rights again."; a rejection stays; the reviewer's name is left out, as is any uploader or attester outside the archive;
- the restore result counts `course_files` and `media_rights_to_review` (`test_creator_studio_courses_and_files_survive_backup_and_restore`).

**Course exports** (`GET /sedens/creator/course/export?id=`, `course_export.export`) are for the course's own creator only. The ZIP holds `course.json`, one `versions/<n>.json` per version, `media.json` (each file's kind, type, title, size, SHA-256 and rights) and the uploaded files the draft or any version uses, under `media/<id>.<ext>`. `manifest.json` lists every other member with its SHA-256 and carries the labels "Educational anatomy — not measured muscle activation." and "General fitness content. Not medical advice." Repository illustrations are listed but not included. Files are taken only from the course's owner organization; a colleague's or an unused file is never included (`tests/test_sedens_phase2_security.py::test_11_an_export_carries_only_the_course_s_own_files`). A missing file stops the export (`media_missing`, 409).

**Course imports** (`POST /sedens/creator/course/import`) check every member against the manifest (`checksum_mismatch` on any change), refuse unexpected member names, and need the importer's attestation when the export contains files. Each file then goes through the normal upload function with the rights fields from the export: the same rights validation, byte checks and size limits, recorded with the importer's attestation and `unreviewed`. Repository illustrations are re-linked from the registry. The result is a new draft offered to nobody (`tests/test_sedens_course_http.py::test_course_export_and_import`).

## 14. Not built yet

| Item | State |
|---|---|
| Curated stock clips | none; the import manifest is empty and no import code exists |
| Movement review of media (stock, AI-generated, uploaded) | no field or workflow; labels stay |
| Higgsfield or any generator | inactive interface only |
| Deleting a file's bytes | not built; files can only be retired |
| Video transcoding or deep inspection | not built; only the container header is checked |
| Home playback of guided training | designed for and off (`HOME_PLAYBACK = False`) |
| Synchronized room player | Phase 3 |
