import {
  $,
  state,
  api,
  record,
  list,
  clientName,
  params,
  href,
  go,
  esc,
  select,
  options,
  field,
  area,
  modal,
  upload,
  head,
  card,
  empty,
  notice,
  table,
  mediaURL,
  regionName,
  regions,
  badge,
  coachName,
  date,
  spark,
  bindButtons,
  toast,
  dt,
  relatedRegion,
  safeURL,
} from "./core.js";
import { metricRegion } from "./reports.js";
import { feedbackVisitDisclosure } from "./feedback-source.js";
import { cameraLabels, explainedChart, metricCopy } from "./explain.js";
import { comparableProgressSeries } from "./progress-selection.js";
import { scanLinkedNotes } from "./anatomy-bridge.js";
import { isEducationalScanReference, scanAnnotationMarkers, scanFrameIndex } from "./scan-markers.js";
import {
  initialVisitId, visitFormOptions, compatibleAssessments, sessionForAnalysis,
  scanVisitLinkOptions,
} from "./visit-form-links.js";
export function anatomyClientChoice(students, role) {
  if (!students.length) return role === "student"
    ? empty("Your client record is not linked", "Ask your coach or studio administrator to connect your account before you open your body map.")
    : empty("No clients available here", "Add a client or ask an administrator to assign clients to your location.", `<a class="button" href="${href("clients", { client: "" })}">Open clients →</a>`);
  return `<div class="client-grid">${students.map((c) => `<a class="client-card" href="${href("client", { client: c.id, tab: "anatomy" })}">${esc(c.name)} →</a>`).join("")}</div>`;
}
function choose(root) {
  root.innerHTML =
    head("Choose a client", "Select a client to explore their body regions, scan records and coach notes.") +
    anatomyClientChoice(state.me.students, state.me.role);
}
export function linkedNotes(notes, client, emptyMessage) {
  return notes.map((n) => `<article class="note"><p class="eyebrow">${esc(n.detail?.simulation || n.detail?.source === "demo_coach_feedback" || (client.detail?.demo && !n.detail?.source) ? "DEMO COACH FEEDBACK" : "COACH FEEDBACK")}</p><p>${esc(n.text)}</p><small>${esc(coachName(n.author_id))} · ${esc(dt(n.created_at))} · ${n.visibility === "student" ? "Shared with student" : "Coach only"}</small>${feedbackVisitDisclosure(n, {role: state.me.role, clientId: client.id})}<div class="actions">${n.session_id ? `<a href="${href("client", { tab: "sessions", session: n.session_id })}">Source visit →</a>` : n.analysis_id ? `<a href="${href("client", { tab: "sessions", assessment: n.analysis_id })}">Source session →</a>` : ""}${n.program_id ? `<a href="${href("program", { id: n.program_id, client: client.id })}">Related program →</a>` : ""}${n.exercise_id ? `<a href="${href("exercise", { id: n.exercise_id, client: client.id })}">Related exercise →</a>` : ""}${n.detail?.updated_at ? `<small>Last edited ${esc(dt(n.detail.updated_at))}</small>` : ""}</div></article>`).join("") || `<p>${esc(emptyMessage || (client.detail?.demo ? "No simulated coach feedback is linked to this region." : "No coach feedback is linked to this region yet."))}</p>`;
}
export function markerVisitHTML(marker) {
  return marker.session_id
    ? `<a href="${href("client", { tab: "sessions", session: marker.session_id })}">Recorded visit →</a>`
    : "Visit not recorded · general annotation";
}
export function regionHistory(client, region) {
  const observations = client.observations.filter((o) => relatedRegion(o.region_id, region.id));
  const notes = client.notes.filter((n) => relatedRegion(n.region_id, region.id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const series = comparableProgressSeries(client, (metric) =>
    relatedRegion(metricRegion(metric.replaceAll("_", " ")), region.id));
  const connected = new Set([...observations.map((o) => o.analysis_id),
    ...series.flatMap((group) => group.rows.map((row) => row.analysis_id))].filter(Boolean));
  const sessions = client.analyses.filter((a) => connected.has(a.id)).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return { observations, notes, trend: series[0] || null, sessions };
}
export function initialAnatomyLayer(route, notes, analysisId, exercise) {
  const requested = route.get("view");
  const hasFeedback = notes.some((note) => note.region_id);
  if (requested === "feedback" && hasFeedback) return "feedback";
  if (requested === "region" || route.has("region") || analysisId || exercise || !hasFeedback)
    return "region";
  return "feedback";
}
export function anatomySourceContext(analysis, fullRecord) {
  if (!analysis) return "All visits";
  const views = [...new Set((fullRecord?.result?.views || []).map((view) => view.view).filter(Boolean))];
  const viewText = views.length ? views.map((view) => cameraLabels[view] || view.replaceAll("_", " ")).join(", ") : "No camera view recorded";
  return `${analysis.kind === "movement" ? "Movement analysis" : "Posture assessment"} · ${analysis.protocol || "Protocol not recorded"} · ${viewText} · ${dt(analysis.created_at)}`;
}
function bodyMapMarkers(client, selected, programs) {
  const noteIds = new Set(client.notes.map((note) => note.region_id).filter(Boolean));
  const targetIds = new Set(programs.flatMap((program) => [program.region_id, ...(program.detail?.target_region_ids || []), ...(program.steps || []).flatMap((step) => step.detail?.target_region_ids || [])]).filter(Boolean));
  const measuredIds = new Set(client.observations.map((observation) => observation.region_id).filter(Boolean));
  const relevant = regions().filter((region) => region.id === selected.id || noteIds.has(region.id) || targetIds.has(region.id) || measuredIds.has(region.id))
    .sort((a, b) => a.id === selected.id ? -1 : b.id === selected.id ? 1 : 0);
  const symbol = (id) => noteIds.has(id) ? "●" : targetIds.has(id) ? "◇" : "·";
  return `<div class="anatomy-feedback-map"><strong>Client body map</strong><small>● Coach feedback · ◇ Program target · · Measured finding</small><div class="anatomy-map-markers">${relevant.slice(0, 12).map((region) => `<button type="button" class="${region.id === selected.id ? "active" : ""}" data-map-region="${esc(region.id)}" title="Open ${esc(region.name)} history">${symbol(region.id)} ${esc(region.name)}${noteIds.has(region.id) ? ` <span>${client.notes.filter((note) => note.region_id === region.id).length}</span>` : ""}</button>`).join("") || "<span>No region findings or program targets yet.</span>"}</div></div>`;
}
export async function anatomy(root) {
  if (!state.client) return choose(root);
  const c = state.client;
  let region =
    regions().find((r) => r.id === params().get("region")) ||
    regions().find((r) => r.id === c.programs[0]?.region_id) ||
    regions().find((r) => r.id === c.notes[0]?.region_id) ||
    regions().find((r) => r.id === c.observations[0]?.region_id) ||
    regions()[0];
  const requestedAid = params().get("id");
  const aid = c.analyses.some((analysis) => analysis.id === requestedAid) ? requestedAid : null;
  const ex = params().get("exercise");
  const initialLayer = initialAnatomyLayer(params(), c.notes, aid, ex);
  let selectedLayer = initialLayer;
  const query = new URLSearchParams({
    platform: "1",
    client: c.id,
    region: region.id,
    ...(aid ? { analysis: aid } : {}),
    ...(ex ? { exercise: ex } : {}),
    layer: initialLayer,
  });
  const history = regionHistory(c, region);
  const [assigned, sourceRecord] = await Promise.all([
    Promise.allSettled(c.programs.map((assignment) => record("programs", assignment.program_id))),
    aid ? record("analyses", aid).catch(() => null) : null,
  ]);
  if (!root.isConnected) return;
  const programs = assigned.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const exercises = programs.flatMap((program) => (program.steps || [])
    .filter((step) => step.exercise_id && (
      (step.detail?.target_region_ids || []).some((id) => relatedRegion(id, region.id)) ||
      relatedRegion(step.exercise_region_id, region.id) ||
      relatedRegion(program.region_id, region.id)
    ))
    .map((step) => ({ ...step, program })));
  const scans = c.scans.filter((scan) => relatedRegion(scan.region_id, region.id));
  const trend = history.trend;
  const measure = trend ? metricCopy({ id: trend.metric.split(":").at(-1),
    name: trend.metric.replace(/[:_]/g, " ") }) : null;
  const camera = trend ? cameraLabels[trend.metric.split(":")[0]] || trend.metric.split(":")[0].replaceAll("_", " ") : "";
  const metricHistory = trend ? explainedChart({
    title: trend.metric.split(":").at(-1).replaceAll("_", " "),
    definition: measure.definition, why: measure.why,
    notice: trend.previous
      ? `Compare only the same ${trend.protocol} capture and ${camera}. Open both source visits to check camera setup and visibility. A measured change alone does not show benefit or harm.`
      : "Only one matching measurement is available for this capture setup. Repeat it to see a trend.",
    current: trend.latest.value, previous: trend.previous?.value, unit: trend.unit,
    source: `${trend.demo ? "Demo simulated coordinates" : "Uploaded media landmarks"} · ${trend.kind === "movement" ? "movement video" : "posture photograph"} · ${trend.protocol} · ${camera}. Check confidence and measurement status in each source report before interpreting change.`,
    chart: trend.previous ? spark(trend.rows.map((row) => [Date.parse(row.recorded_at), row.value]), {
      label: trend.metric.split(":").at(-1).replaceAll("_", " ") + " across matched visits",
      unit: trend.unit, xLabel: (value) => date(new Date(value)),
    }) : "",
    sessionLink: `<a href="${href("client", { tab: "sessions", assessment: trend.latest.analysis_id })}">Latest source visit →</a>${trend.previous ? `<a href="${href("client", { tab: "sessions", assessment: trend.previous.analysis_id })}">Previous source visit →</a>` : ""}<a href="${href("client", { tab: "progress", metric: trend.metric, assessment: trend.latest.analysis_id })}">Full history →</a>`,
  }) : card("Measured region history", `<p>No supported measurement is linked to this body region yet. ${state.me.role === "student" ? "Your coach can add a suitable posture or movement capture." : "Capture a clear, suitable view to begin a measured history."}</p>${state.me.role === "student" ? "" : `<a class="button" href="${href("capture", { client: c.id })}">Start an assessment →</a>`}`);
  const sourceAnalysis = c.analyses.find((analysis) => analysis.id === aid);
  const sourceText = anatomySourceContext(sourceAnalysis, sourceRecord);
  root.innerHTML =
    head("Client body map", c.name + " · " + region.name,
      `<a class="button" href="/anatomy.html?${query}" target="_blank" rel="noopener">Full-screen anatomy ↗</a>`) +
    `<p class="muted">Select a marked region to see why it matters, the sessions behind it, coach feedback, and assigned practice.</p>` +
    `<div class="filter-row">${select("Body region", "body-region", regions().map((r) => [r.id, r.name + (c.notes.some((n) => n.region_id === r.id) ? " · coach feedback" : "")]), region.id, null)}${select("Anatomy view", "anatomy-layer", [["feedback", "Coach feedback map"], ["region", "Relevant region"], ["bones_full", "Skeleton"], ["muscles_full", "Muscles"], ["connective", "Connective structures"], ["nervous", "Nerves"], ["whole", "Whole body"]], initialLayer, null)}<button id="anatomy-refocus">Focus region</button></div>` +
    `<div class="anatomy-workspace"><div class="anatomy-view-stage"><div id="anatomy-status" role="status" class="notice">Loading the existing anatomy viewer…</div><iframe class="anatomy-frame" id="atlas" title="${esc(c.name)} · ${esc(region.name)} anatomy" src="/anatomy.html?${query}&embed=1"></iframe>${bodyMapMarkers(c, region, programs)}</div><aside class="anatomy-context">` +
    `<section class="panel anatomy-region-summary"><p class="eyebrow">${esc(c.name)} · ${esc(region.side)} · ${esc(sourceText)}</p><h2>${esc(region.name)}</h2><p>${esc(region.explanation)}</p><div class="anatomy-counts"><span><strong>${history.observations.length}</strong> measured findings</span><span><strong>${history.notes.length}</strong> coach feedback</span><span><strong>${history.sessions.length}</strong> related assessments</span><span><strong>${exercises.length}</strong> assigned movements</span></div><p class="muted">The atlas is an educational reference, not a reconstruction of this client's internal anatomy.</p>${state.me.role !== "student" ? '<button data-edit="notes" class="primary">+ Add coach feedback here</button>' : ""}</section>` +
    `${metricHistory}` +
    `${card("Coach feedback", history.notes.length ? linkedNotes(history.notes.slice(0, 3), c) + (history.notes.length > 3 ? `<a class="record-link" href="${href("client", { tab: "notes", region: region.id })}">Read all ${history.notes.length} notes for this region →</a>` : "") : `<p>${state.me.role === "student" ? "Your coach has not shared feedback for this body region." : "No coach feedback is linked to this body region. Add a specific observation with the button above."}</p>`)}` +
    `${card("Assigned practice", exercises.slice(0, 6).map((step) => `<a class="record-link" href="${href("program", { id: step.program.id, client: c.id })}">${esc(step.exercise_name)} <small>${esc(step.program.name)} · ${esc(step.detail?.why_assigned || step.detail?.purpose || "Coach-assigned exercise")}</small></a>`).join("") || `<p>No assigned movement targets this body region yet.</p><a class="button" href="${href("client", { client: c.id, tab: "programs", region: region.id })}">${state.me.role === "student" ? "See your assigned program" : "Review this client's program"} →</a>`)}` +
    `<details class="panel anatomy-more"><summary>Measured findings and related sessions</summary>${history.observations.slice(0, 8).map((observation) => `<article class="anatomy-observation"><p class="eyebrow">${esc(observation.source || "SYSTEM MEASUREMENT")}</p><a href="${href("client", { tab: "sessions", assessment: observation.analysis_id })}">${esc(observation.text)}</a><small>${esc(dt(observation.created_at))}</small></article>`).join("") || "<p>No measured findings linked yet.</p>"}${history.sessions.slice(0, 6).map((analysis) => `<a class="record-link" href="${href("client", { tab: "sessions", assessment: analysis.id })}">${esc(analysis.protocol)} · ${esc(dt(analysis.created_at))} →</a>`).join("")}</details>` +
    `<details class="panel anatomy-more"><summary>Mapped structures and scans</summary><ul>${region.structures.map((structure) => `<li><button class="text-button" data-structure="${structure.id}">${esc(structure.name)}</button></li>`).join("")}</ul>${scans.map((scan) => `<a class="record-link" href="${href("client", { tab: "scans", scan: scan.id, region: region.id, id: scan.analysis_id })}">${esc(scan.name)} →</a>`).join("") || "<p>No scan linked to this region.</p>"}</details>` +
    `<div class="panel anatomy-next"><p class="eyebrow">NEXT STEP</p>${aid ? `<a class="record-link" href="${href("report", { id: aid })}">Return to source assessment →</a>` : ""}${state.me.role !== "student" ? `<a class="record-link" href="${href("client", { tab: "programs", region: region.id, report: aid || "" })}">Add this area to a program →</a>` : `<a class="record-link" href="${href("client", { tab: "programs" })}">See your assigned program →</a>`}</div></aside></div>`;
  const frame = $("#atlas");
  const send = (data = {}) =>
    frame.contentWindow?.postMessage(
      {
        type: "motion-context",
        client: { id: c.id, name: c.name },
        region,
        regions: state.me.regions,
        analysis_id: aid,
        notes: c.notes
          .filter((n) => relatedRegion(n.region_id, region.id))
          .map((n) => n.text),
        feedback: c.notes,
        layer: selectedLayer,
        exercise: ex,
        ...data,
      },
      location.origin,
    );
  const listener = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow)
      return;
    if (e.data?.type === "motion-atlas-ready") send();
    if (e.data?.type === "motion-atlas-context")
      $("#anatomy-status").textContent =
        "Connected to " + c.name + " · " + region.name;
    if (e.data?.type === "motion-atlas-error")
      $("#anatomy-status").textContent = e.data.message;
    if (e.data?.type === "motion-atlas-selection") {
      if (e.data.region_id && e.data.region_id !== region.id)
        go("client", { tab: "anatomy", region: e.data.region_id, id: aid, view: "region" });
      else if (!e.data.region_id)
        $("#anatomy-status").textContent = "This atlas structure has no mapped coaching region. Choose a region from the list.";
    }
    if (e.data?.type === "motion-atlas-feedback-region") {
      const note = c.notes.find((entry) => entry.id === e.data.note_id &&
        relatedRegion(entry.region_id, e.data.region_id));
      if (note && regions().some((entry) => entry.id === e.data.region_id))
        go("client", { tab: "anatomy", region: e.data.region_id,
          id: note.analysis_id || "", view: "region" });
    }
  };
  window.addEventListener("message", listener);
  state.dispose.push(() => window.removeEventListener("message", listener));
  $("#anatomy-refocus").onclick = () => send();
  root.querySelector("[name=body-region]").onchange = (e) =>
    go("client", { tab: "anatomy", region: e.target.value, id: aid, view: "region" });
  root.querySelector("[name=anatomy-layer]").onchange = (e) => {
    const layer = e.target.value;
    selectedLayer = layer;
    send({ layer });
    const next = params();
    if (layer === "region" || layer === "feedback") next.set("view", layer);
    else next.delete("view");
    window.history.replaceState(null, "", location.pathname + "#" + next);
  };
  root.querySelectorAll("[data-map-region]").forEach((button) =>
    button.onclick = () => {
      const note = c.notes.find((entry) => relatedRegion(entry.region_id, button.dataset.mapRegion));
      go("client", { tab: "anatomy", region: button.dataset.mapRegion,
        id: note?.analysis_id || "", view: "region" });
    });
  root
    .querySelectorAll("[data-structure]")
    .forEach(
      (b) => (b.onclick = () => send({ structure_id: +b.dataset.structure })),
    );
  bindButtons(root);
}
export function scanEmptyCopy(role) {
  return role === "student"
    ? {
        heading: "View imaging your coach has shared in your record.",
        list: "No imaging records have been shared with you yet.",
        detail: "Ask your coach if an existing scan should be added to your record. This page does not make a diagnosis.",
      }
    : {
        heading: "Upload and annotate supplied imaging in this client's record.",
        list: "No scans saved for this client. Use Upload scan / X-ray above to add an existing file.",
        detail: "Upload an existing image or DICOM file, then link it to the relevant visit or body region.",
      };
}
export async function scans(root) {
  if (!state.client) {
    const { pagedRecords } = await import("./paging.js");
    return pagedRecords(root, {
      collection: "scans",
      title: head(
        "Client scans",
        "Choose a linked record to open its client, imaging and coaching notes.",
      ),
      searchLabel: "Search scan name",
      renderRows: (rows) =>
        table(
          ["Client", "Scan", "Region", "Captured"],
          rows.map((s) => [
            esc(clientName(s.student_id)),
            `<a href="${href("client", { client: s.student_id, tab: "scans", scan: s.id, region: s.region_id, id: s.analysis_id })}">${esc(s.name)}</a>`,
            esc(regionName(s.region_id)),
            esc(s.captured_at),
          ]),
        ),
    });
  }
  const c = state.client;
  const noScan = scanEmptyCopy(state.me.role);
  root.innerHTML =
    head(
      "Scans & imaging records",
      c.name + " · " + noScan.heading,
      state.me.role === "student"
        ? ""
        : '<button id="scan-upload" class="primary">+ Upload scan / X-ray</button>',
    ) +
    notice(
      "Medical images are displayed for educational review and manual coaching notes. No diagnostic or segmentation model is run on these records.",
    ) +
    `<div class="scan-layout"><aside id="scan-list">${c.scans.map((s) => `<a class="record-link ${params().get("scan") === s.id ? "active" : ""}" href="${href("client", { tab: "scans", scan: s.id, region: s.region_id, id: s.analysis_id })}"><strong>${esc(s.name)}</strong><small>${esc(s.scan_type)} · ${esc(regionName(s.region_id))}</small></a>`).join("") || `<p>${esc(noScan.list)}</p>`}</aside><div id="scan-detail"></div></div>`;
  if ($("#scan-upload")) $("#scan-upload").onclick = () => scanUpload();
  const sid = params().get("scan") || c.scans[0]?.id;
  if (!sid) {
    $("#scan-detail").innerHTML = notice(noScan.detail);
    return;
  }
  const scan = await record("scans", sid);
  if (scan.student_id !== c.id) {
    go("client", {
      client: scan.student_id,
      tab: "scans",
      scan: scan.id,
      region: scan.region_id,
      id: scan.analysis_id,
    });
    return;
  }
  if (!params().get("scan")) {
    const q = params();
    q.set("scan", scan.id);
    if (scan.region_id) q.set("region", scan.region_id);
    if (scan.analysis_id) q.set("id", scan.analysis_id);
    history.replaceState(null, "", "#" + q);
  }
  const m = await record("media", scan.media_id),
    dicom = m.mime === "application/dicom";
  const demoReference = isEducationalScanReference(state.me.organization, scan, m);
  const canMark = Boolean(scan.session_id || demoReference);
  const sourceVisit = c.sessions.find((visit) => visit.id === scan.session_id);
  const frameCount = m.detail.frames || 1;
  let frameIndex = scanFrameIndex(params().get("scan_frame"), frameCount);
  const detail = $("#scan-detail");
  const credit = m.detail.attribution
    ? `<p class="muted">${esc(m.detail.attribution)}${safeURL(m.detail.source_url) ? ` · <a href="${esc(safeURL(m.detail.source_url))}" target="_blank" rel="noopener noreferrer">Original and license</a>` : ""}</p>`
    : "";
  detail.innerHTML =
    card(
      scan.name,
      `<p class="muted">${demoReference ? "Reference record date" : "Capture date"}: ${esc(scan.captured_at ? date(scan.captured_at) : "Date not recorded")}</p>${notice(scan.detail.provenance || m.detail.provenance || "Supplied scan. Coach annotations are manual observations.")}${dicom ? `<div class="grid three">${field("Window centre · pixel intensity", "center", m.detail.window_center || 0, "number", 'step="any"')}${field("Window width · intensity range", "width", m.detail.window_width || 0, "number", 'min="0" step="any"')}${field("Frame index · starts at 0", "frame", frameIndex, "number", `min="0" max="${frameCount - 1}" step="1"`)}</div><button id="window-apply">Apply window</button><p class="muted" id="scan-frame-status"></p><details><summary>What do these image controls mean?</summary><p>Window centre selects the middle of the displayed pixel intensity range. Window width selects how much of that range is mapped from black to white; 0 uses the full range in the selected frame. These values use this file’s intensity scale after its rescale metadata is applied. They are display settings, rather than body measurements.</p><p>This file contains ${frameCount} frame${frameCount === 1 ? "" : "s"}. Frame index 0 is the first image; ${frameCount - 1} is the last. A frame index identifies an image in the file; it does not measure an anatomical angle or elapsed time.</p></details>` : `<label for="scan-contrast">Image contrast · <output id="scan-contrast-value" for="scan-contrast">100%</output><input id="scan-contrast" type="range" min="50" max="180" value="100"></label><details><summary>What does image contrast mean?</summary><p>100% displays the original contrast. Lower values soften contrast and higher values increase it for viewing. The original file and saved annotation positions remain unchanged.</p></details>`}<div class="scan-image" id="scan-stage"><img id="scan-image" alt="${esc(scan.name)}"><svg id="scan-annotations" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Manual scan annotations"></svg></div><p id="scan-hint">${state.me.role === "student" ? "View your coach’s saved markers." : canMark ? "Click the image to place an anatomical annotation." : "Connect this scan to a recorded visit before placing a body marker."}</p><div class="actions"><a class="button" href="${href("client", { tab: "anatomy", region: scan.region_id, id: scan.analysis_id })}">Explore linked anatomy</a>${scan.session_id ? `<a class="button" href="${href("client", { tab: "sessions", session: scan.session_id })}">Source visit${sourceVisit?.performed_at ? ` · ${esc(date(sourceVisit.performed_at))}` : ""}</a>` : state.me.role === "student" || demoReference ? "" : '<button type="button" id="scan-link-visit">Connect to recorded visit</button>'}${scan.analysis_id ? `<a class="button" href="${href("report", { id: scan.analysis_id })}">Source analysis</a>` : ""}${state.me.role === "student" ? "" : '<button data-edit="notes">+ Linked coach note</button>'}<a class="button" href="${mediaURL(m.id)}" download="${esc(m.filename)}">Download original</a></div>`,
    ) +
    card(
      "Saved annotations",
      "<p class=\"muted\">Marker numbers match the image and remain the same when you change frames. Positions are relative to the image, with 0–1 coordinates; they are not calibrated physical distances. An older marker without its own saved visit link remains a general annotation, even when the scan is now linked to a visit.</p>" + table(
        ["Marker", "Region", "Coach annotation", "Frame index", "Visit"],
        scanAnnotationMarkers(scan.findings).map((f) => [
          `#${f.marker}`,
          `<a href="${href("client", { tab: "anatomy", region: f.region_id, id: scan.analysis_id })}">${esc(regionName(f.region_id))}</a>`,
          esc(f.text),
          dicom ? `<button type="button" data-scan-frame="${f.frame_index}">View frame ${f.frame_index}</button>` : "0 · Original image",
          markerVisitHTML(f),
        ]),
      ),
    ) +
    card(
      "Related coach notes",
      linkedNotes(
        scanLinkedNotes(c.notes, scan),
        c,
        "No coach feedback is linked to this scan or its source assessment.",
      ),
    );
  if (credit) detail.insertAdjacentHTML("beforeend", credit);
  const linkToVisit = () => {
    const choices = scanVisitLinkOptions(c, scan);
    if (!choices.length) {
      let recordedVisitId = "";
      modal("Record a scan review now",
        notice("No saved visit is available for this scan. This creates a review record at the current time. It does not reconstruct when the scan was taken or an earlier visit, and it records no completed exercise.") +
        (scan.analysis_id ? `<p>Source assessment: <a href="${href("report", { id: scan.analysis_id })}">Open assessment →</a>. It will be linked to this new review record.</p>` : "") +
        area("What did you review with this client?", "visit_context") +
        '<label class="check"><input type="checkbox" name="confirm_current_visit" required> Record this review now, with no practice claimed</label>',
        async (f) => {
          const context = String(f.get("visit_context") || "").trim();
          if (!context) throw Error("Describe this review before recording it.");
          if (!f.get("confirm_current_visit")) throw Error("Confirm that this is a review recorded now.");
          if (!recordedVisitId) {
            try {
              const saved = await api("complete-session", {
                student_id: c.id,
                analysis_id: scan.analysis_id || null,
                completed: [],
                notes: `Scan review: ${context}`,
                require_new: true,
              });
              recordedVisitId = saved.id;
            } catch (error) {
              if (error.status === 409) {
                throw Error("A visit was recorded for this assessment while this dialog was open. Close this dialog and reopen the scan to review that visit before linking it.");
              }
              throw error;
            }
          }
          await api("save", { collection: "scans", item: { id: scan.id, session_id: recordedVisitId } });
          go("client", { tab: "scans", scan: scan.id, region: scan.region_id, id: scan.analysis_id });
        });
      return;
    }
    modal("Connect this scan to a visit",
      select("Recorded visit", "session_id", choices, "", "Choose a saved visit") +
      notice("Choose the actual visit for this scan. A matching date alone does not establish a link."),
      async (f) => {
        const session_id = f.get("session_id");
        if (!session_id) throw Error("Choose a recorded visit for this scan.");
        await api("save", { collection: "scans", item: { id: scan.id, session_id } });
        go("client", { tab: "scans", scan: scan.id, region: scan.region_id, id: scan.analysis_id });
      });
  };
  if (detail.querySelector("#scan-link-visit"))
    detail.querySelector("#scan-link-visit").onclick = linkToVisit;
  if (dicom) {
    detail.querySelector("[name=frame]").value = frameIndex;
    for (const name of ["center", "width"]) {
      const saved = params().get("scan_" + name);
      if (saved !== null && Number.isFinite(Number(saved)))
        detail.querySelector(`[name=${name}]`).value = saved;
    }
  }
  const image = $("#scan-image");
  const annotations = () => {
    $("#scan-annotations").innerHTML = scanAnnotationMarkers(scan.findings, frameIndex)
      .map(
        (f) =>
          `<g><title>${esc(`Marker ${f.marker}: ${regionName(f.region_id)} · ${f.text}`)}</title><circle cx="${f.x * 1000}" cy="${f.y * 1000}" r="13" fill="#53dbc0" stroke="#051522" stroke-width="4"/><text x="${f.x * 1000 + 18}" y="${f.y * 1000 + 8}" fill="#53dbc0" font-size="25">${f.marker}</text></g>`,
      )
      .join("");
  };
  const source = () => {
    if (dicom) {
      detail.querySelector("[name=frame]").value = frameIndex;
      $("#scan-frame-status").textContent = `Viewing frame index ${frameIndex} · ${frameCount} frame${frameCount === 1 ? "" : "s"} in this file.`;
    }
    image.src = dicom
      ? "/platform/dicom?" +
        new URLSearchParams({
          id: m.id,
          frame: frameIndex,
          center: detail.querySelector("[name=center]").value,
          width: detail.querySelector("[name=width]").value,
        })
      : mediaURL(m.id);
    annotations();
  };
  image.onerror = () => {
    $("#scan-hint").textContent =
      "This scan could not render. Retry with default window values, or export an uncompressed DICOM/PNG from the source viewer.";
  };
  source();
  const applyWindow = () => {
    frameIndex = scanFrameIndex(detail.querySelector("[name=frame]").value, frameCount);
    const q = params();
    q.set("scan_frame", frameIndex);
    q.set("scan_center", detail.querySelector("[name=center]").value);
    q.set("scan_width", detail.querySelector("[name=width]").value);
    history.replaceState(null, "", "#" + q);
    source();
  };
  if ($("#window-apply")) $("#window-apply").onclick = applyWindow;
  detail.querySelectorAll("[data-scan-frame]").forEach((button) => {
    button.onclick = () => {
      detail.querySelector("[name=frame]").value = button.dataset.scanFrame;
      applyWindow();
    };
  });
  if ($("#scan-contrast"))
    $("#scan-contrast").oninput = (e) => {
      image.style.filter = `contrast(${e.target.value}%)`;
      $("#scan-contrast-value").textContent = `${e.target.value}%`;
    };
  if (state.me.role !== "student")
    $("#scan-stage").onclick = (e) => {
      if (!canMark) {
        linkToVisit();
        return;
      }
      const rect = image.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width,
        y = (e.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      modal(
        "Annotate this scan",
        select("Anatomical region", "region_id", regions(), scan.region_id) +
          area("Manual observation", "text") +
          notice(
            "This annotation is educational. It does not establish a diagnosis.",
          ),
        async (f) =>
          api("annotate", {
            ...Object.fromEntries(f),
            scan_id: scan.id,
            x,
            y,
            frame_index: frameIndex,
          }),
      );
    };
  bindButtons(detail);
}
function scanUpload() {
  const c = state.client;
  const route = params();
  const assessmentId = route.get("assessment") || route.get("report") || route.get("id") || "";
  const visitId = initialVisitId(c, {}, route, assessmentId, route.get("scan") || "");
  const assessments = compatibleAssessments(c, visitId);
  const visibleAssessmentId = assessments.some((analysis) => analysis.id === assessmentId)
    ? assessmentId : "";
  const d = modal(
    "Upload scan for " + c.name,
    `<label>Scan file<input name="file" type="file" accept="image/jpeg,image/png,image/webp,.dcm,.dicom" required></label>` +
      field("Record name", "name", "", "text", "required") +
      select(
        "Scan type",
        "scan_type",
        ["X-ray", "DICOM", "Body scan image", "Other supplied image"].map(
          (x) => [x, x],
        ),
        "X-ray",
        null,
      ) +
      select(
        "Anatomical region",
        "region_id",
        regions(),
        params().get("region"),
      ) +
      select("Recorded visit", "session_id", visitFormOptions(c), visitId,
        c.sessions?.length ? "No linked visit · general scan" : "No visit recorded yet") +
      select(
        "Related assessment",
        "analysis_id",
        assessments.map((a) => [a.id, dt(a.created_at) + " · " + (a.protocol || a.kind)]),
        visibleAssessmentId,
        "No linked assessment",
      ) +
      field(
        "Capture date",
        "captured_at",
        new Date().toISOString().slice(0, 10),
        "date",
        "required",
      ) +
      '<p id="scan-upload-progress" role="status"></p>',
    async (f, form) => {
      const file = form.querySelector("[name=file]").files[0];
      const m = await upload(
        file,
        { kind: "scan", student_id: c.id },
        (n) =>
          (form.querySelector("#scan-upload-progress").textContent =
            "Uploading · " + n + "%"),
      );
      const saved = await api("save", {
        collection: "scans",
        item: {
          ...Object.fromEntries([...f].filter(([k]) => k !== "file")),
          student_id: c.id,
          media_id: m.id,
        },
      });
      go("client", {
        tab: "scans",
        scan: saved.id,
        region: saved.region_id,
        id: saved.analysis_id,
      });
    },
  );
  const visit = d.querySelector('[name="session_id"]');
  const analysis = d.querySelector('[name="analysis_id"]');
  const updateAssessments = () => {
    const rows = compatibleAssessments(c, visit.value);
    const current = analysis.value;
    analysis.innerHTML = options(rows.map((a) => [
      a.id, dt(a.created_at) + " · " + (a.protocol || a.kind),
    ]), current, "No linked assessment");
    if (!rows.some((entry) => entry.id === current)) analysis.value = "";
  };
  visit.onchange = updateAssessments;
  analysis.onchange = () => {
    if (!visit.value && analysis.value) {
      visit.value = sessionForAnalysis(c, analysis.value)?.id || "";
      if (visit.value) updateAssessments();
    }
  };
}
