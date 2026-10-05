# Isolated scan acceptance fixture · 2026-09-30

This is a local, disposable QA fixture. Every scan pixel and annotation was generated for this test and belongs to the fictional client **Sarah Kim (fictional scan QA)**. These files are not X-rays or patient data. The existing copied demo records were not changed; a separate local organization was added inside the copied database.

## Browser handoff

The isolated server is running at `http://127.0.0.2:8144/index.html` using `/tmp/motion-scan-0930.db` and `/tmp/motion-scan-0930.db.media`. It does not use the app session on `127.0.0.1:8125` or the role test session on port 8133.

Sign in with the disposable Admin account whose email is `scan-qa-0930@example.invalid`; the local-only password is in `/tmp/motion-scan-0930-auth.json` (mode 0600). The fixture metadata without a password is in `/tmp/motion-scan-0930-fixture.json`.

- Fictional client ID: `0f01cee132424b90a818b3b82f1117dd`
- DICOM scan ID: `9ed31a5ea5824b029939e90b8ab84024`; [open scan](http://127.0.0.2:8144/index.html#page=client&client=0f01cee132424b90a818b3b82f1117dd&tab=scans&scan=9ed31a5ea5824b029939e90b8ab84024)
- Same scan, requested third frame: [open frame index 2](http://127.0.0.2:8144/index.html#page=client&client=0f01cee132424b90a818b3b82f1117dd&tab=scans&scan=9ed31a5ea5824b029939e90b8ab84024&scan_frame=2)
- PNG scan ID: `7427868750464b5197ece24346b80ec7`; [open scan](http://127.0.0.2:8144/index.html#page=client&client=0f01cee132424b90a818b3b82f1117dd&tab=scans&scan=7427868750464b5197ece24346b80ec7)

Expected DICOM annotations, in saved scan-wide order:

| Marker | Frame index | Saved text |
| --- | ---: | --- |
| 1 | 0 | SYNTHETIC marker A · first frame |
| 2 | 2 | SYNTHETIC marker B · third frame |
| 3 | 1 | SYNTHETIC marker C · second frame |
| 4 | 0 | SYNTHETIC marker D · first frame again |

This interleaving makes frame filtering visible: frame 0 should show markers 1 and 4, frame 1 marker 3, and frame 2 marker 2. The saved list should retain 1–4 on every frame, and its frame controls should select the corresponding zero-based frame. `scan_frame=2` should open the third image. The DICOM has three generated 64×64 grayscale frames; default window centre is 850 and width is 1700 on an artificial pixel-intensity scale. Changing centre/width should change the displayed rendering, not the saved original or annotations. The PNG is a generated color gradient with one synthetic marker. Its contrast control should begin at 100%, report its changed percentage, and leave its original image/marker unchanged.

## Completed evidence

- Created the database by SQLite's consistent `backup()` from `/tmp/motion-qa-0928.db`, copied its media tree, and rewrote media paths **in the copy**. New records were created through `Repository.create_org`, `save_person`, `media.upload`, `Repository.save`, and `Repository.annotate`.
- `media.upload` recognized the uncompressed Secondary Capture DICOM (`application/dicom`) as 3 frames. `dicom_png` decoded frame indexes 0, 1 and 2 into distinct 64×64 PNGs. Rendering frame 1 with centre 500/width 350 produced different PNG bytes. Frame index 3 was refused both for rendering and for annotation.
- Repository retrieval returned saved annotation frame indexes `[0, 2, 1, 0]` in scan-wide saved order, plus the PNG annotation. `PRAGMA foreign_key_check` found no broken relationships.
- Authenticated local HTTP sign-in succeeded for the disposable Admin. `/platform/record` returned all four DICOM markers and the PNG marker. `/platform/dicom` returned three distinct `image/png` frames; its window parameters changed the PNG output. `/index.html` returned HTTP 200.

## Root browser verification

The root task signed into the isolated QA organization in the Codex in-app Browser on `127.0.0.2:8144`. This was a real UI check of generated test images, not a patient-image or upload check.

- The DICOM page displayed the three-frame explanation, centre/width inputs, a zero-based frame-index input, and the current frame count. On frame 0, the image showed marker numbers **1 and 4** while the saved table showed all four annotations in stable order. The table's **View frame 2** control showed only marker **2**, set the frame input/status to index 2, and loaded `/platform/dicom?...frame=2`; the image rendered at 64 pixels wide. **View frame 1** showed only marker **3**.
- On frame 1, changing the window centre from 850 to 500 and width from 1700 to 350, then choosing **Apply window**, updated the displayed image source to `frame=1&center=500&width=350` and retained marker 3. The explanation states that these values map the file's post-rescale pixel intensity range for display; it does not call them Hounsfield units or physical measurements.
- The generated PNG page showed marker **1** in both image and table. Its contrast slider started at **100%**; one keyboard step displayed **101%**, applied `contrast(101%)`, and retained the same original media URL and marker.

The Browser showed the saved annotations and controls at the tested desktop size. It did not submit files through the upload picker, inspect patient images, validate every browser size, or verify the hosted Render service. Actual browser upload remains **unverified**.
