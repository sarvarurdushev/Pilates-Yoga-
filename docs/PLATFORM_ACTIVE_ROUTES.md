# Active routes and shared renderers — 5 October 2026

This is the bounded information-architecture audit for the later specification #2 and #30. It follows the actual entry points, route dispatch, source data and visible return actions. Global collections and selected-client collections can be different scopes of one renderer without being duplicate result interfaces.

## Active entry and selected-client contract

`web/index.html` loads **only** `web/src/platform/app.js`. The old studio stylesheet is reused for base styling; `web/src/studio/app.js` is not loaded. The same entry serves `/` and `/index.html`. `app.js::render()` resolves the permitted selected client through `selected-client-route.js`, fetches `/platform/client?id=…`, then draws the shared breadcrumb and `context()` before the selected screen. `core.js::href()` carries selected-client context and omits absent optional IDs. A Student's copied foreign-client URL is normalized to their permitted own client.

The persistent workspace has eight tabs: Overview, Sessions, Movement, Posture, Body / 3D, Coach feedback, Program and Progress. Scans and Reservations are related actions inside this workspace, rather than second result systems. `context()` names the client and has a **Return to [client]'s workspace** action; the breadcrumb has client and section links. Staff also have Change client. Report, exercise and program detail pages keep this wrapper.

## Route-to-renderer map

Hash parameters below are relative to `/index.html#`; `client=C` means a selected permitted client. Record IDs in detail routes select that exact record rather than the nearest record by date.

| Active route or branch | Renderer and source | Purpose / context / return |
|---|---|---|
| `page=dashboard` | `app.js::dashboard`, role-scoped `/platform/me`, client data and reservations | Admin operations, Coach assigned-client day, or Student own practice/progress. No second report renderer. Client actions enter the common workspace. |
| `page=clients` / `page=coaches` | `peoplePage`, role-visible people/relationships | Organization or assigned-client collection. Client cards enter `page=client&client=C`. |
| `page=client&client=C&tab=overview` | `overview`, selected client DTO | Named selected client, latest assessment, shared feedback, program/progress and operational context. Latest assessment is correctly distinguished from a newer practice visit. |
| `page=client&client=C&tab=sessions` | `sessions`, `visitsForClient` | One visit list, aggregating authoritative captures/practice/source relations. Reservations are separately labelled future bookings. |
| Same Sessions route with `session=V` or `assessment=A` | `sessionDetail`, exact `visitConnections`/`visitTimeline` | One visit detail with Who/when, named logged practice, capture views/measurements, feedback, scans and saved program decisions. Previous/next and client-return actions retain C. |
| `tab=movement` / `tab=posture` / retained `tab=analysis` | `section` → `pagedRecords` → **`analysisTable`**, filtered `analyses` collection | Movement/posture lists differ by kind filter. They all link the same exact report route, never render a competing result. Retained Analysis alias is an assessment collection, not another analysis tool. |
| `page=analysis` | The same `pagedRecords`/`analysisTable`, role-visible collection | Global assessment discovery. When C is present it uses the same client filter. Exact record links include the record's client. |
| `page=report&id=A&client=C` | **`reports.js::report`**, exact saved analysis, coordinates, source media, selected person and prior comparable records | The sole active movement/posture result renderer. Its Summary, Capture & posture, Movement detail, Comparison, Body regions, Coach feedback/program and Advanced measurements are disclosures of this one result. |
| `page=capture&client=C` | `capture.js::capture` | One guided photograph/video upload/record/review workflow. Saved results enter the sole report renderer and exact visit. |
| `tab=anatomy` / `page=anatomy&client=C` | **`anatomy.js::anatomy`**, region catalogue and selected client's observations/notes/progress/steps | One client body map. A report/finding can supply `id=A&region=R`; source task/views, measured history, feedback markers and assigned practice are linked from that region. |
| `tab=scans` / `page=scans&client=C` with optional `scan=S` | **`anatomy.js::scans`**, exact scan/media/marker/source-visit data | One scan collection/detail implementation. Ordinary images and DICOM have distinct display controls. Manual markers and capture/source dates are labelled; exact scan/frame return links retain C. |
| `tab=notes` / `page=notes&client=C`, optional `note=N&region=R` | `section` → `notesHTML` / `visibleFeedback`, saved role-visible notes | One feedback renderer, with exact-note and region filters. Saved author/provenance/visibility and source result/visit/exercise/program actions are explicit. |
| `tab=progress` / `page=progress&client=C` | **`app.js::progress`**, reconciled archived evidence and exact coaching/program milestones | One measured progress renderer. Matching protocol/view/person/unit/status/source creates comparisons; absent support stays unavailable. Points and milestones open exact visits/results/versions. |
| `tab=programs` | `library.js::clientProgramWorkspace` and shared program library | Selected client's assignment, current phase, saved-version practice, latest change/history and measured progress. This is an assignment/history summary, not a second editor. |
| `page=programs` / `page=exercises` / `page=content` | `library.js::library`, role-visible catalogues | Reusable program/exercise discovery and own-content scope. Opening a record goes to the shared detail/editor; client context is retained when supplied. |
| `page=program&id=P&client=C` | `forms.js::detailPage` → **`programs.js::programDetail`** / shared designer | One client-specific plan detail, visual editor, Student projection and immutable revision history. Source finding/feedback/visit links return to exact evidence in C. |
| `page=exercise&id=E&client=C` | `forms.js::detailPage`, exact accessible exercise/media/reference data | Shared exercise detail. Optional C keeps the same return context; library-only content does not pretend to have a performed visit. |
| `tab=schedule` / `page=schedule` | `section` → `pagedRecords` → **`reservationTable`**, reservations | Client or global booking scope. Scheduled reservation is not a completed visit; named source/client/location/status are visible. |
| `page=locations` / `page=equipment` | `section`, role-scoped location/stock collections | Operational management, simultaneous reservation capacity and base/time-dependent reservable quantities. Client-context facts are N/A when no client is selected. |
| `page=system` / `page=storage` | `inspection.js` / `storage.js`, Admin-only data/backup APIs | Technical organization inspection and archive/recovery. These are not Student measurements or new clinical result screens. |
| `page=search&q=…` | `app.js` search dispatch, role-visible records | Searches route each type to its shared renderer; client/results carry authoritative client IDs. |

## Anatomy and supported archived compatibility

| Entry | What actually mounts | Context and boundary |
|---|---|---|
| `/anatomy.html` with no `legacy`/`session` | `main.js` reference atlas; `session/boot.js::boot()` returns before mounting old assessment tools | Educational muscles/bones/nerves/brain/exercise model. The visible Motion Yoga studio link returns to the active app. It is not another default posture/movement dashboard. |
| `/anatomy.html?client=C&region=R…` embedded/fullscreen | Same atlas plus `platform/anatomy-bridge.js` | Same-client educational geometry linked to exact observations/feedback/program. The bridge rewrites the return link to the selected C/region/source workspace; embedded messages are validated by the parent. |
| `/anatomy.html?session=URL` | Same atlas plus explicitly loaded archived `Session` bundle, banner, selected-structure readings and Your progress Lab tab | Retains working historical bundle rendering. This is a distinct archived bundle schema, not a competing renderer for current `p_analyses` records. If `client=C` is supplied, the common bridge preserves that context; without an authoritative platform ID the app must not guess a client from a legacy display name. |
| `/anatomy.html?legacy` | Explicit compatibility recorder/posture/movement/recordings and legacy accounts | Preserved older API/tool compatibility, outside the current client workflow. No active platform tab or new report path directs the user here. The studio-return link is present. |
| `web/src/studio/*` | **Inactive** at both active HTML entries | Retained implementation/technical debt. Its old rings, score charts and comparisons are not rendered by the active app merely because `studio.css` is reused. |

## Consolidation result and verification

The active app has one exact report renderer, one visit detail, one client body map, one feedback list/editor, one measured progress renderer and one program designer. Collection scopes, version history, disclosures and role projections reuse those renderers. No separate current movement/posture result UI was found in the active route dispatch. Keeping explicit archived functionality satisfies the request to preserve working history; it does not expose three result pages for the same current analysis.

The [three-role QA](PLATFORM_ROLE_JOURNEY_QA_2026_09_30.md) exercised the requested Admin, Coach and Student client/session/report/body/feedback/program/progress/return paths, including Coach save and Student read of the same data. [Integrated QA](PLATFORM_INTEGRATED_QA_2026_09_30.md) adds exact visit, program revision, progress milestone, scan/frame and practice returns. Later routing browser QA refreshed selected-client links in all three roles and normalized foreign Student links. Feedback-marker QA follows exact report/marker/note/source paths. The common atlas smoke covers the shared actual geometry, selection and mobile viewport.

This route audit is local information-architecture evidence. It does not claim hosted deployment, repair unknown legacy source IDs by timestamp, or merge different archived schemas solely because both contain charts. The corrected old score/quantity explanations and actual renderer receipts are recorded in [the legacy chart/number audit](PLATFORM_LEGACY_CHART_NUMBER_AUDIT.md), separately from active route consolidation. The 5 October chart DOM audit also inspected ten client-specific movement collection links: each opened this same exact saved report renderer with the authoritative client ID.
