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
  notice,
  table,
  mediaURL,
  regionName,
  regions,
  badge,
  coachName,
  num,
  bindButtons,
  toast,
  dt,
  relatedRegion,
  safeURL,
} from "./core.js";
import { metricRegion } from "./reports.js";
import { comparisonText, metricCopy } from "./explain.js";
import { scanLinkedNotes } from "./anatomy-bridge.js";
import {
  initialVisitId, visitFormOptions, compatibleAssessments, sessionForAnalysis,
} from "./visit-form-links.js";
function choose(root) {
  root.innerHTML =
    head(
      "Choose a client",
      "Select a client to explore their body regions, scan records and coach notes.",
    ) +
    `<div class="client-grid">${state.me.students.map((c) => `<a class="client-card" href="${href("client", { client: c.id, tab: "anatomy" })}">${esc(c.name)} →</a>`).join("")}</div>`;
}
function linkedNotes(notes, client, emptyMessage) {
  return notes.map((n) => `<article class="note"><p class="eyebrow">${esc(n.detail?.simulation || n.detail?.source === "demo_coach_feedback" || (client.detail?.demo && !n.detail?.source) ? "DEMO COACH FEEDBACK" : "COACH FEEDBACK")}</p><p>${esc(n.text)}</p><small>${esc(coachName(n.author_id))} · ${esc(dt(n.created_at))} · ${n.visibility === "student" ? "Shared with student" : "Coach only"}</small><div class="actions">${n.session_id ? `<a href="${href("client", { tab: "sessions", session: n.session_id })}">Source visit →</a>` : n.analysis_id ? `<a href="${href("client", { tab: "sessions", assessment: n.analysis_id })}">Source session →</a>` : ""}${n.program_id ? `<a href="${href("program", { id: n.program_id, client: client.id })}">Related program →</a>` : ""}${n.exercise_id ? `<a href="${href("exercise", { id: n.exercise_id, client: client.id })}">Related exercise →</a>` : ""}${n.detail?.updated_at ? `<small>Last edited ${esc(dt(n.detail.updated_at))}</small>` : ""}</div></article>`).join("") || `<p>${esc(emptyMessage || (client.detail?.demo ? "No simulated coach feedback is linked to this region." : "No coach feedback is linked to this region yet."))}</p>`;
}
function regionHistory(client, region) {
  const observations = client.observations.filter((o) => relatedRegion(o.region_id, region.id));
  const notes = client.notes.filter((n) => relatedRegion(n.region_id, region.id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const progress = client.progress.filter((entry) =>
    relatedRegion(metricRegion(entry.metric.replaceAll("_", " ")), region.id) && Number.isFinite(entry.value));
  const grouped = new Map();
  for (const entry of progress) {
    if (!grouped.has(entry.metric)) grouped.set(entry.metric, []);
    grouped.get(entry.metric).push(entry);
  }
  const series = [...grouped.values()].sort((a, b) => b.length - a.length)[0] || [];
  const connected = new Set([...observations.map((o) => o.analysis_id), ...progress.map((r) => r.analysis_id)].filter(Boolean));
  const sessions = client.analyses.filter((a) => connected.has(a.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { observations, notes, series, sessions };
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
  const aid = params().get("id") || c.latest_analysis?.id;
  const ex = params().get("exercise");
  const query = new URLSearchParams({
    platform: "1",
    client: c.id,
    region: region.id,
    ...(aid ? { analysis: aid } : {}),
    ...(ex ? { exercise: ex } : {}),
  });
  const history = regionHistory(c, region);
  const assigned = await Promise.allSettled(c.programs.map((assignment) => record("programs", assignment.program_id)));
  const programs = assigned.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const exercises = programs.flatMap((program) => (program.steps || [])
    .filter((step) => step.exercise_id && (
      (step.detail?.target_region_ids || []).some((id) => relatedRegion(id, region.id)) ||
      relatedRegion(step.exercise_region_id, region.id) ||
      relatedRegion(program.region_id, region.id)
    ))
    .map((step) => ({ ...step, program })));
  const scans = c.scans.filter((scan) => relatedRegion(scan.region_id, region.id));
  const recent = history.series.at(-1), earlier = history.series.length > 1 ? history.series.at(-2) : null;
  const measure = recent ? metricCopy({ id: recent.metric, name: recent.metric.replaceAll("_", " ") }) : null;
  const metricHistory = recent ? `<p><strong>${esc(recent.metric.replaceAll("_", " "))}</strong> · ${esc(num(recent.value, recent.unit))}</p><p>${esc(comparisonText(recent.value, earlier?.value, recent.unit))}</p><p>${esc(measure.definition)}</p><small>${recent.demo ? "DEMO SIMULATION" : "SYSTEM MEASUREMENT"} · same metric across recorded visits</small><div class="actions"><a href="${href("client", { tab: "sessions", assessment: recent.analysis_id })}">Source session →</a><a href="${href("client", { tab: "progress", metric: recent.metric })}">Full history →</a></div>` : "<p>No comparable measurements from this region are available yet.</p>";
  const sourceAnalysis = c.analyses.find((analysis) => analysis.id === aid);
  const sourceText = sourceAnalysis ? `${sourceAnalysis.kind === "movement" ? "Movement analysis" : "Posture assessment"} · ${dt(sourceAnalysis.created_at)}` : "All visits";
  root.innerHTML =
    head("Client body map", c.name + " · " + region.name,
      `<a class="button" href="/anatomy.html?${query}" target="_blank" rel="noopener">Full-screen anatomy ↗</a>`) +
    `<p class="muted">Select a marked region to see why it matters, the sessions behind it, coach feedback, and assigned practice.</p>` +
    `<div class="filter-row">${select("Body region", "body-region", regions().map((r) => [r.id, r.name + (c.notes.some((n) => n.region_id === r.id) ? " · coach feedback" : "")]), region.id, null)}${select("Anatomy view", "anatomy-layer", [["region", "Relevant region"], ["bones_full", "Skeleton"], ["muscles_full", "Muscles"], ["connective", "Connective structures"], ["nervous", "Nerves"], ["whole", "Whole body"]], "region", null)}<button id="anatomy-refocus">Focus region</button></div>` +
    `<div class="anatomy-workspace"><div class="anatomy-view-stage"><div id="anatomy-status" role="status" class="notice">Loading the existing anatomy viewer…</div><iframe class="anatomy-frame" id="atlas" title="${esc(c.name)} · ${esc(region.name)} anatomy" src="/anatomy.html?${query}"></iframe>${bodyMapMarkers(c, region, programs)}</div><aside class="anatomy-context">` +
    `<section class="panel anatomy-region-summary"><p class="eyebrow">${esc(c.name)} · ${esc(region.side)} · ${esc(sourceText)}</p><h2>${esc(region.name)}</h2><p>${esc(region.explanation)}</p><div class="anatomy-counts"><span><strong>${history.observations.length}</strong> measured findings</span><span><strong>${history.notes.length}</strong> coach feedback</span><span><strong>${history.sessions.length}</strong> related assessments</span><span><strong>${exercises.length}</strong> assigned movements</span></div><p class="muted">The atlas is an educational reference, not a reconstruction of this client's internal anatomy.</p>${state.me.role !== "student" ? '<button data-edit="notes" class="primary">+ Add coach feedback here</button>' : ""}</section>` +
    `${card("Latest measured trend", metricHistory)}` +
    `${card("Coach feedback", linkedNotes(history.notes.slice(0, 3), c) + (history.notes.length > 3 ? `<a class="record-link" href="${href("client", { tab: "notes", region: region.id })}">Read all ${history.notes.length} notes for this region →</a>` : ""))}` +
    `${card("Assigned practice", exercises.slice(0, 6).map((step) => `<a class="record-link" href="${href("program", { id: step.program.id, client: c.id })}">${esc(step.exercise_name)} <small>${esc(step.program.name)} · ${esc(step.detail?.purpose || "Coach-assigned exercise")}</small></a>`).join("") || "<p>No assigned exercise targets this region yet.</p>")}` +
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
        go("client", { tab: "anatomy", region: e.data.region_id, id: aid });
      else if (!e.data.region_id)
        $("#anatomy-status").textContent = "This atlas structure has no mapped coaching region. Choose a region from the list.";
    }
  };
  window.addEventListener("message", listener);
  state.dispose.push(() => window.removeEventListener("message", listener));
  $("#anatomy-refocus").onclick = () => send();
  root.querySelector("[name=body-region]").onchange = (e) =>
    go("client", { tab: "anatomy", region: e.target.value, id: aid });
  root.querySelector("[name=anatomy-layer]").onchange = (e) =>
    send({ layer: e.target.value });
  root.querySelectorAll("[data-map-region]").forEach((button) =>
    button.onclick = () => go("client", { tab: "anatomy", region: button.dataset.mapRegion, id: aid }));
  root
    .querySelectorAll("[data-structure]")
    .forEach(
      (b) => (b.onclick = () => send({ structure_id: +b.dataset.structure })),
    );
  bindButtons(root);
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
  root.innerHTML =
    head(
      "Scans & imaging records",
      "Upload, view and annotate educational imaging within " +
        c.name +
        "’s record.",
      state.me.role === "student"
        ? ""
        : '<button id="scan-upload" class="primary">+ Upload scan / X-ray</button>',
    ) +
    notice(
      "Medical images are displayed for educational review and manual coaching notes. No diagnostic or segmentation model is run on these records.",
    ) +
    `<div class="scan-layout"><aside id="scan-list">${c.scans.map((s) => `<a class="record-link ${params().get("scan") === s.id ? "active" : ""}" href="${href("client", { tab: "scans", scan: s.id, region: s.region_id, id: s.analysis_id })}"><strong>${esc(s.name)}</strong><small>${esc(s.scan_type)} · ${esc(regionName(s.region_id))}</small></a>`).join("") || "<p>No scans saved yet.</p>"}</aside><div id="scan-detail"></div></div>`;
  if ($("#scan-upload")) $("#scan-upload").onclick = () => scanUpload();
  const sid = params().get("scan") || c.scans[0]?.id;
  if (!sid) {
    $("#scan-detail").innerHTML = notice(
      "Add a supplied image or DICOM file to begin.",
    );
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
  let frameIndex = Math.min(
    (m.detail.frames || 1) - 1,
    Math.max(0, Number(params().get("scan_frame")) || 0),
  );
  const detail = $("#scan-detail");
  const credit = m.detail.attribution
    ? `<p class="muted">${esc(m.detail.attribution)}${safeURL(m.detail.source_url) ? ` · <a href="${esc(safeURL(m.detail.source_url))}" target="_blank" rel="noopener noreferrer">Original and license</a>` : ""}</p>`
    : "";
  detail.innerHTML =
    card(
      scan.name,
      `${notice(scan.detail.provenance || m.detail.provenance || "Supplied scan. Coach annotations are manual observations.")}${dicom ? `<div class="grid three">${field("Window centre", "center", m.detail.window_center || 0, "number")}${field("Window width", "width", m.detail.window_width || 0, "number", 'min="0"')}${field("Frame", "frame", 0, "number", `min="0" max="${(m.detail.frames || 1) - 1}"`)}</div><button id="window-apply">Apply window</button>` : `<label>Image contrast<input id="scan-contrast" type="range" min="50" max="180" value="100"></label>`}<div class="scan-image" id="scan-stage"><img id="scan-image" alt="${esc(scan.name)}"><svg id="scan-annotations" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Manual scan annotations"></svg></div><p id="scan-hint">${state.me.role === "student" ? "View your coach’s saved markers." : "Click the image to place an anatomical annotation."}</p><div class="actions"><a class="button" href="${href("client", { tab: "anatomy", region: scan.region_id, id: scan.analysis_id })}">Explore linked anatomy</a>${scan.session_id ? `<a class="button" href="${href("client", { tab: "sessions", session: scan.session_id })}">Source visit</a>` : ""}${scan.analysis_id ? `<a class="button" href="${href("report", { id: scan.analysis_id })}">Source analysis</a>` : ""}${state.me.role === "student" ? "" : '<button data-edit="notes">+ Linked coach note</button>'}<a class="button" href="${mediaURL(m.id)}" download="${esc(m.filename)}">Download original</a></div>`,
    ) +
    card(
      "Saved annotations",
      table(
        ["Region", "Coach annotation", "Frame"],
        scan.findings.map((f) => [
          `<a href="${href("client", { tab: "anatomy", region: f.region_id, id: scan.analysis_id })}">${esc(regionName(f.region_id))}</a>`,
          esc(f.text),
          f.frame_index,
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
    $("#scan-annotations").innerHTML = scan.findings
      .filter((f) => f.frame_index === frameIndex)
      .map(
        (f, i) =>
          `<g><circle cx="${f.x * 1000}" cy="${f.y * 1000}" r="13" fill="#53dbc0" stroke="#051522" stroke-width="4"/><text x="${f.x * 1000 + 18}" y="${f.y * 1000 + 8}" fill="#53dbc0" font-size="25">${i + 1}</text></g>`,
      )
      .join("");
  };
  const source = () => {
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
  if ($("#window-apply"))
    $("#window-apply").onclick = () => {
      frameIndex = Math.max(
        0,
        Math.min(
          (m.detail.frames || 1) - 1,
          Number(detail.querySelector("[name=frame]").value),
        ),
      );
      const q = params();
      q.set("scan_frame", frameIndex);
      q.set("scan_center", detail.querySelector("[name=center]").value);
      q.set("scan_width", detail.querySelector("[name=width]").value);
      history.replaceState(null, "", "#" + q);
      source();
    };
  if ($("#scan-contrast"))
    $("#scan-contrast").oninput = (e) =>
      (image.style.filter = `contrast(${e.target.value}%)`);
  if (state.me.role !== "student")
    $("#scan-stage").onclick = (e) => {
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
