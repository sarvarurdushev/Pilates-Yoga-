# Unified studio rebuild

User correction, 16 September 2026: retain the original dark, blue-accented
studio design; remove competing posture and movement entry points; guide photo
and video capture; fix actual analysis failures; provide the functionality of
all eight supplied reference screens, with useful investor demonstration data.

## Failure reproduced

The exact 127 × 304 photograph from the screenshot returns one valid body with
a full-frame pass. Enabling the old class tile option cuts it into four invalid
fragments. Preserve the full-frame pass and skip tiles for narrow photographs.
Synchronous photo HTTP requests and unchecked `response.json()` also expose
empty proxy/server responses as JSON syntax errors. New capture uses queued jobs,
explicit progress, bounded image sizes and readable retry behavior.

## Reference-to-product map

- Operations dashboard: members, assessment activity, attendance, assessment
  trends, follow-up list and recent assessments.
- Clients: fictitious demo profiles plus a separate personal workspace, six
  months of clearly synthetic attendance and assessment history.
- Guided assessment: neutral standing front, back, left and right; explicit
  optional views; named movement protocols and camera positions; one analysis engine.
- Summary/report: actual media overlays, view-aware values, regional detail,
  uncertainty, learned 3D when corroborated, reference anatomy, mobility curves,
  body measurements entered by a coach, findings and next steps.
- Comparison: same-view photos and available metrics, dates, longitudinal charts,
  explicit camera/measurement comparability. No invented improvement from imagery.
- Tracking notes/timeline: goals, subjective observations, session records,
  attachments, recommendations and follow-up dates.
- Programs/sequence editor/library: editable exercise sequences, order, sets,
  repetitions, duration and illustrated exercise guidance; reusable anatomy viewer.
- Medical image record: actual uploaded X-ray images for manual review and
  attributed public-domain educational samples, never synthesized from photos.
- Reports: printable summary and JSON export; demo labels retained in exports.
- Schedule/reservations, equipment, illustrative payments and settings: editable
  studio records; no external bookings, messages or financial transactions.

## Data and evidence contracts

Demo identities, visits, payments, attendance and trends are fabricated examples,
visibly marked in every relevant view/export. Photographic illustrations are
generated assets, not evidence of a patient's improvement. Real uploads and
analysis remain separate. Local browser storage retains a personal workspace and
media across Render deploys; server SQLite stores generated reports and seeds
the demo database reproducibly. Render's temporary filesystem is not durable
production storage; the interface includes export/restore.

Pixel angles do not establish muscle activation, vertebral alignment, spinal
curvature, body composition or a radiological diagnosis. Those report sections
accept attributed coach/clinician data or show the evidence still needed.
Recommendations are general coach-review suggestions grounded in visible results
and published exercise resources, not an automatic medical prescription.

## Completion checks

Reproduce the exact uploaded photograph with class scan on/off; meaningful
visibility refusals remain intact. Exercise the new HTTP queue and workspace
boundaries, multiview aggregation, demo persistence, client/notes/program saves,
media upload, printing/comparison and both desktop/mobile navigation. Verify the
final commit on the existing Render service and run an end-to-end live analysis.


## Verification record

- Exact failing 127 × 304 photograph: now one suitable person; browser workflow
  returned six measured values and a corroborated 3D estimate. Original image
  remained outside the repository and demo dataset.
- Re-ran the 26-case real/composited visual corpus. All declared negative cases
  remained refused. Composite 1/5/10/20-person cases retained the expected
  detection counts; distant figures often lack enough detail for measurements.
  This demonstrates contracts and observed behavior, not scientific accuracy.
- Browser verified photo capture, video upload/job/report, program reorder/save,
  coach-note save, educational radiograph viewer, same-view comparison and schedule
  presentation. Checked navigation and capture at a 390px mobile viewport.
- Automated checks: 2,434 Python tests passed, one skipped; 351 JavaScript tests
  passed. The affected pose-canvas tests also passed after the final styling changes.
- The in-app test browser cannot initialize WebGL (software graphics context
  failure). The preserved detailed anatomy viewer now shows recovery guidance
  instead of loading indefinitely. Its GPU rendering was not re-verified in this
  environment; measured pose skeletons use Canvas 2D and were verified separately.
- Demo financial records are a manual illustrative ledger, not payments. X-rays
  are supplied records, not automatic diagnostic analysis.
