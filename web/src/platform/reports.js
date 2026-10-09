import {
  $,
  state,
  api,
  record,
  list,
  params,
  href,
  go,
  esc,
  select,
  options,
  head,
  card,
  notice,
  table,
  date,
  dt,
  num,
  badge,
  mediaURL,
  regionName,
  coachName,
  locationName,
  spark,
  bindButtons,
  toast,
  download,
} from "./core.js";
import { PoseCanvas } from "../poseCanvas.js";
import { findComparableVisits, nearestComparableMeasurement } from "./comparison.js";
import { cameraGuide, cameraLabels, captureSummary, comparisonText, explainedChart, metricCopy, recordedByLabel } from "./explain.js";
const edges = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];
const labels = [
  "Head / nose",
  "Left eye",
  "Right eye",
  "Left ear",
  "Right ear",
  "Left shoulder",
  "Right shoulder",
  "Left elbow",
  "Right elbow",
  "Left wrist",
  "Right wrist",
  "Left hip",
  "Right hip",
  "Left knee",
  "Right knee",
  "Left ankle",
  "Right ankle",
  "Neck base proxy",
  "Pelvis centre",
  "Trunk / spine proxy",
];
export function feedbackProvenanceLabel(note) {
  return note.detail?.source === "demo_coach_feedback" || note.detail?.simulation
    ? "DEMO COACH FEEDBACK" : "COACH-WRITTEN FEEDBACK";
}

export function analysisStatusLabel(status) {
  if (status === "needs_capture") return "Needs a clearer capture";
  if (status === "complete") return "Analysis complete";
  return String(status || "Analysis status unavailable").replaceAll("_", " ");
}

export function metricRegion(name) {
  name = (name || "").toLowerCase();
  const side = name.includes("left")
    ? "left"
    : name.includes("right")
      ? "right"
      : "both";
  if (/pelvi|hip height|cent[er]+ of mass/.test(name)) return "pelvis";
  if (/foot/.test(name)) return side + "_ankle";
  for (const part of ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"])
    if (name.includes(part)) return side + "_" + part;
  if (/head|neck|ear/.test(name)) return "head";
  if (/pelvi/.test(name)) return "pelvis";
  return "thorax";
}

// Advanced traces describe one capture. A prior angle range does not make
// derivative or coordinate traces comparable across visits.
export function movementDerivativeCharts(kinematics = {}, demo = false) {
  const source = demo
    ? "Demo simulated raw projected-angle samples from accepted video frames"
    : "Raw projected-angle samples from accepted uploaded-video frames";
  const speedCopy = metricCopy({ name: "angular speed" });
  const accelerationCopy = metricCopy({ name: "angular acceleration" });
  return '<div class="grid two">' + explainedChart({
    title: "Mean angular speed & signed velocity trace",
    definition: "The number is the mean absolute change in the projected angle per second. Each plotted value keeps the direction of that change.",
    why: speedCopy.why + " Positive and negative values mark opposite projected directions, not effort or strength.",
    notice: "Look for direction changes and gaps in this clip. No earlier clip is plotted here.",
    current: kinematics.mean_speed_deg_s, comparisonNote: "Single-video technical trace; no earlier clip is compared.", unit: "deg/s", source,
    chart: spark(kinematics.velocity || [], { label: "Signed angular velocity over clip time (seconds)", unit: "deg/s" }),
  }) + explainedChart({
    title: "Mean angular acceleration & signed trace",
    definition: "The number is the mean absolute change in angular velocity per second. Each plotted value keeps the direction of that change.",
    why: accelerationCopy.why + " Differencing successive raw samples amplifies noise; missing samples and gaps are not interpolated.",
    notice: "Inspect how sharply the projected speed changes in this clip. No earlier clip is plotted here.",
    current: kinematics.mean_acceleration_deg_s2, comparisonNote: "Single-video technical trace; no earlier clip is compared.", unit: "deg/s²", source,
    chart: spark(kinematics.acceleration || [], { label: "Signed angular acceleration over clip time (seconds)", unit: "deg/s²" }),
  }) + "</div>";
}

export function coordinateTraceChart({ axis, space, selected, trajectory = [], landmarkName, demo = false, kind = "posture" }) {
  if (!["x", "y", "z"].includes(axis)) throw new Error("Unknown coordinate axis");
  const image = space === "image_px";
  const unit = image ? "px" : "m";
  const definitions = image
    ? {
        x: "Horizontal position from the left edge of the original frame; larger values are farther right.",
        y: "Vertical position from the top edge of the original frame; larger values are farther down.",
        z: "A single camera image does not directly measure depth; image-plane Z is unavailable.",
      }
    : {
        x: "Model-estimated rightward offset from the hip centre.",
        y: "Model-estimated downward offset from the hip centre.",
        z: "Model-estimated depth offset from the hip centre; the camera does not measure it directly.",
      };
  const source = demo
    ? "Demo simulated " + (image ? "image-plane" : "3D model") + " coordinates; the illustration is separate"
    : image
      ? "Accepted 2D pose landmarks from the original " + (kind === "movement" ? "video frames" : "photograph")
      : "Independent 3D pose model applied to the original " + (kind === "movement" ? "video frames" : "photograph");
  const why = image
    ? "Camera movement, crop and perspective change pixel positions. They are not calibrated body displacement."
    : "The model uses a learned scale, so metres and depth are estimates, not calibrated body measurements or a scan. Low-confidence frames remain missing.";
  const unavailableDepth = image && axis === "z";
  const chart = unavailableDepth
    ? notice("No measured image-plane depth trace is available.")
    : kind === "movement"
      ? spark(trajectory.map((point) => [point.time, point[axis]]), {
          label: landmarkName + " " + axis.toUpperCase() + " position over clip time (seconds)", unit,
        })
      : notice("A photograph provides one position; it cannot show a movement trace.");
  return explainedChart({
    title: landmarkName + " · " + axis.toUpperCase() + " coordinate",
    definition: definitions[axis], why,
    notice: unavailableDepth
      ? "Switch to estimated 3D only when the independent model has supported depth evidence."
      : kind === "movement"
        ? "The value is for the selected frame; the trace follows accepted frames from this clip only."
        : "The value belongs to this selected photograph; no movement or earlier visit is plotted.",
    current: unavailableDepth ? null : selected?.[axis], comparisonNote: "Selected-frame technical coordinate; no earlier capture is compared.", unit, source, chart,
  });
}

export function movementTechnicalNumbers(signal = {}, kinematics = {}, person = {}, demo = false) {
  const entries = [
    ["Mean angular speed", kinematics.mean_speed_deg_s, "deg/s", "Mean absolute projected-angle change per second from accepted raw samples."],
    ["Mean angular acceleration", kinematics.mean_acceleration_deg_s2, "deg/s²", "Mean absolute change in angular velocity per second from accepted raw samples."],
    ["Tempo variation", signal.tempo_cv, "ratio", "Standard deviation of complete cycle durations divided by their mean duration; unitless."],
    ["Cycle range variation", signal.rep_rom_sd, "deg", "Standard deviation of projected angle ranges across complete detected cycles."],
    ["Angular speed variation", kinematics.speed_variation, "deg/s", "Standard deviation of absolute angular speeds. A variable-speed task can have a larger value without poorer form."],
    ["Hip-centre trajectory variation / body span", person.trajectory_deviation_body_fraction, "ratio", "Spread of the tracked hip midpoint divided by the median projected body span; unitless and affected by camera motion."],
  ];
  return `<p class="report-source">${demo ? "DEMO SIMULATED LANDMARKS" : "UPLOADED VIDEO LANDMARKS"} · Selected joint and accepted frames from this clip only. No earlier clip is compared.</p><dl class="metric-technical">${entries.map(([name, value, unit, definition]) => `<div><dt>${esc(name)}</dt><dd>${esc(num(value, unit))}</dd><small>${esc(definition)}</small></div>`).join("")}</dl><p>These are camera-plane estimates and describe timing or variation. They do not measure force, true centre of mass or clinical balance.</p>`;
}

export function acceptedFrameSummary(frames = []) {
  const accepted = frames.filter((frame) => frame.suitable);
  const times = accepted.map((frame) => frame.time).filter(Number.isFinite);
  return {
    accepted: accepted.length,
    span: times.length >= 2
      ? num(Math.max(...times) - Math.min(...times), "s")
      : "Not enough accepted frames",
  };
}

const POSTURE_ANGLE_IDS = [
  "shoulder_tilt", "pelvic_obliquity", "head_lateral_tilt",
  "trunk_lean_lateral", "trunk_lean_sagittal",
];

export function selectPostureObservation(metrics = []) {
  const available = metrics.filter((metric) =>
    Number.isFinite(metric?.value) &&
    !["unavailable", "refused", "unsupported"].includes(metric.status) &&
    (!Number.isFinite(metric.confidence) || metric.confidence >= 0.65),
  );
  const angles = available.filter((metric) =>
    metric.unit === "deg" && POSTURE_ANGLE_IDS.includes(metric.id),
  );
  const nonzeroAngles = angles.filter((metric) => Math.abs(metric.value) > 0);
  if (nonzeroAngles.length) {
    const directlyMeasured = nonzeroAngles.filter((metric) =>
      metric.status === "measured" || metric.status === "available",
    );
    const pool = directlyMeasured.length ? directlyMeasured : nonzeroAngles;
    return pool.reduce((best, metric) =>
      !best || Math.abs(metric.value) > Math.abs(best.value) ||
      (Math.abs(metric.value) === Math.abs(best.value) &&
        POSTURE_ANGLE_IDS.indexOf(metric.id) < POSTURE_ANGLE_IDS.indexOf(best.id))
        ? metric : best, null);
  }
  // If every comparable angle rounds to zero, show another available,
  // nonzero reading without comparing magnitudes across unlike units.
  const other = available.filter((metric) => Math.abs(metric.value) > 0);
  if (other.length) return other.find((metric) => metric.status === "measured") || other[0];
  return angles.find((metric) => metric.status === "measured") ||
    angles[0] || available.find((metric) => metric.status === "measured") ||
    available[0] || null;
}

// Detection numbers are local to one capture. Never silently bind the first
// detected body to the client when other bodies are present.
export function reportPersonIndex(view, selectedPeople = {}) {
  const people = view?.report?.people || [];
  const selected = selectedPeople?.[view?.view];
  if (selected != null)
    return people.findIndex((person) => String(person.person_id) === String(selected));
  return people.length === 1 ? 0 : -1;
}

export function reviewedPersonSelection(view, index) {
  const people = view?.report?.people || [];
  const person = Number.isInteger(index) && index >= 0 ? people[index] : null;
  if (!person) throw Error("Choose which detected person is this client before saving the review.");
  if (!person.suitable)
    throw Error("This detected person has insufficient visible body evidence. Retake the capture.");
  return { [view.view]: person.person_id };
}

export function reportPersonUnverified(view, selectedPeople = {}, index = -1) {
  const people = view?.report?.people || [];
  if (people.length <= 1) return false;
  const person = Number.isInteger(index) && index >= 0 ? people[index] : null;
  const reviewed = selectedPeople?.[view.view];
  return reviewed == null || !person?.suitable ||
    String(person.person_id) !== String(reviewed);
}

export async function report(root, id) {
  const item = await record("analyses", id);
  if (!state.client || state.client.id !== item.student_id) {
    go("report", { client: item.student_id, id });
    return;
  }
  const result = item.result;
  let viewIndex = 0,
    personIndex = -1,
    frameIndex = 0,
    section = "summary",
    landmark = "5",
    signal = "left_shoulder";
  let poseCanvas = null;
  const coords = await api("coordinates?analysis_id=" + encodeURIComponent(id));
  const notes = state.client.notes.filter(
    (n) => n.analysis_id === id || !n.analysis_id,
  );
  const exercise = (state.me.exercises || []).find((e) =>
    e.name?.toLowerCase() === item.protocol?.toLowerCase(),
  );
  const availableNotes = notes.filter((n) =>
    !n.analysis_id || n.analysis_id === id,
  );
  const priorCache = new Map();
  const loadPrior = (summary) => {
    if (!priorCache.has(summary.id))
      priorCache.set(summary.id, record("analyses", summary.id).catch(() => null));
    return priorCache.get(summary.id);
  };
  let comparableVisits = [];
  let drawVersion = 0;
  root.innerHTML =
    head(
      item.kind === "movement" ? "Movement session" : "Posture assessment",
      `${state.client.name} · ${dt(item.created_at)} · ${item.protocol}`,
      `<button id="download-report">Export report</button>${state.me.role !== "student" ? '<button id="review-session" class="primary">Save reviewed session</button>' : ""}`,
    ) +
    notice(
      result.simulation_notice ||
        "Measurements come from visible pose landmarks. Depth is independently estimated only when confidence checks pass. A body model does not establish a diagnosis.",
    ) +
    `<div class="report-meta">${badge(item.demo ? "DEMO SIMULATION" : "REAL CAPTURE", item.demo ? "demo" : "")}${badge(analysisStatusLabel(item.status))}<span id="review-state">${item.detail.reviewed_at ? "Coach reviewed · " + dt(item.detail.reviewed_at) : "Coach review pending"}</span></div><nav class="report-tabs">${[
      ["summary", "Session summary"],
      ["evidence", "Capture & posture"],
      ...(item.kind === "movement" ? [["movement", "Movement detail"]] : []),
      ["comparison", "Compare sessions"],
      ["anatomy", "Body regions"],
      ["coaching", "Coach feedback & program"],
    ]
      .map(([key, title]) => `<button data-section="${key}">${title}</button>`)
      .join("")}</nav><details class="report-advanced"><summary>Advanced measurements</summary><p>Body coordinates and model confidence are technical estimates; they are optional for understanding this session.</p><button type="button" data-section="coordinates">Body coordinates (X/Y/Z)</button></details><div class="filter-row">${select(
      "Camera view",
      "report-view",
      result.views.map((v, i) => [i, v.view.replaceAll("_", " ")]),
      0,
      null,
    )}${select("Person", "report-person", [], 0, null)}</div><div id="report-body"></div>`;
  $("#download-report").onclick = () =>
    download(state.client.name + "-" + item.kind + "-report.json", {
      analysis: item,
      coordinates: coords,
      notes,
    });
  root.querySelectorAll("[data-section]").forEach(
    (b) =>
      (b.onclick = () => {
        section = b.dataset.section;
        draw();
      }),
  );
  root.querySelector("[name=report-view]").onchange = (e) => {
    viewIndex = +e.target.value;
    personIndex = -1;
    frameIndex = 0;
    people();
    draw();
  };
  root.querySelector("[name=report-person]").onchange = (e) => {
    personIndex = e.target.value === "" ? -1 : Number(e.target.value);
    frameIndex = 0;
    draw();
  };
  function people() {
    const view = result.views[viewIndex];
    const detected = view.report.people || [];
    personIndex = reportPersonIndex(view, item.detail.selected_people);
    root.querySelector("[name=report-person]").innerHTML = options(
      detected.map((p, i) => [
        i,
        "Person " + p.person_id +
          (p.suitable ? " · visible body" : " · needs capture"),
      ]),
      personIndex,
      detected.length > 1 ? "Choose which detected person is " + state.client.name :
        detected.length ? null : "No person detected",
    );
  }
  function identityUnverified(view = result.views[viewIndex]) {
    return reportPersonUnverified(view, item.detail.selected_people, personIndex);
  }
  people();
  if ($("#review-session"))
    $("#review-session").onclick = async () => {
      try {
        const view = result.views[viewIndex];
        const selection = reviewedPersonSelection(view, personIndex);
        await api("review", { analysis_id: id, selection });
        item.detail.selected_people ||= {};
        Object.assign(item.detail.selected_people, selection);
        item.detail.reviewed_at = new Date().toISOString();
        draw();
        toast("Reviewed person saved to " + state.client.name);
      } catch (e) {
        toast(e.message);
      }
    };
  function chosen() {
    return personIndex >= 0
      ? result.views[viewIndex].report.people[personIndex] : null;
  }
  function currentFrame() {
    const p = chosen();
    return item.kind === "movement"
      ? p.frames?.[frameIndex]
      : {
          time: 0,
          landmarks: p.landmarks,
          pose3d: p.pose3d,
          suitable: p.suitable,
        };
  }
  function paintPersonChoices(body, view) {
    const canvas = body.querySelector("#person-choices");
    if (!canvas) return;
    canvas.width = view.report.width || 640;
    canvas.height = view.report.height || 960;
    const paint = (image) => {
      if (!canvas.isConnected) return;
      const ctx = canvas.getContext("2d");
      const width = canvas.width, height = canvas.height;
      ctx.fillStyle = "#091322";
      ctx.fillRect(0, 0, width, height);
      if (image) ctx.drawImage(image, 0, 0, width, height);
      (view.report.people || []).forEach((person, index) => {
        const landmarks = person.frames?.find((frame) => frame.landmarks)?.landmarks ||
          person.landmarks;
        const points = (landmarks?.keypoints || []).filter((point, i) =>
          (landmarks?.scores?.[i] ?? 0) >= 0.35 &&
          Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]));
        if (!points.length) return;
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        const pad = Math.max(10, width / 80);
        const left = Math.max(0, Math.min(...xs) - pad);
        const top = Math.max(0, Math.min(...ys) - pad);
        const right = Math.min(width, Math.max(...xs) + pad);
        const bottom = Math.min(height, Math.max(...ys) + pad);
        const color = ["#62d9ee", "#ffcf72", "#d6a6ff", "#8ee1a6"][index % 4];
        ctx.lineWidth = Math.max(3, width / 300);
        ctx.strokeStyle = color;
        ctx.strokeRect(left, top, right - left, bottom - top);
        const label = "Person " + person.person_id;
        ctx.font = Math.max(15, width / 52) + "px system-ui";
        const labelWidth = ctx.measureText(label).width + 16;
        const labelTop = Math.max(0, top - 28);
        ctx.fillStyle = "#07111eea";
        ctx.fillRect(left, labelTop, labelWidth, 28);
        ctx.fillStyle = color;
        ctx.fillText(label, left + 8, labelTop + 20);
      });
    };
    paint(null);
    if (item.kind === "posture" && view.media_id && !item.demo) {
      const image = new Image();
      image.onload = () => paint(image);
      image.src = mediaURL(view.media_id);
    }
  }
  function draw() {
    poseCanvas?.dispose();
    poseCanvas = null;
    root
      .querySelectorAll("[data-section]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.section === section),
      );
    const body = $("#report-body"),
      v = result.views[viewIndex],
      p = chosen();
    const version = ++drawVersion;
    const detected = v.report.people || [];
    const unverified = identityUnverified(v);
    const reviewButton = $("#review-session");
    if (reviewButton) {
      reviewButton.disabled = !p?.suitable;
      reviewButton.textContent = detected.length > 1
        ? "Confirm selected person is " + state.client.name
        : "Save reviewed session";
    }
    $("#review-state").textContent = unverified
      ? "Client identity unverified for this camera view"
      : item.detail.selected_people?.[v.view] != null
        ? "Reviewed person · saved to " + state.client.name
        : item.detail.reviewed_at ? "Coach reviewed · " + dt(item.detail.reviewed_at)
          : "Coach review pending";
    if (!p) {
      const retake = item.status === "needs_capture"
        ? `<div class="actions"><a class="button primary" href="${href("capture", { client: state.client.id, protocol: item.protocol, kind: item.kind, retry: "1" })}">Retake this capture →</a></div>`
        : "";
      if (detected.length > 1) {
        body.innerHTML = '<section class="panel person-choice"><h2>Which detected person is ' +
          esc(state.client.name) + '?</h2><p>The image contains ' + detected.length +
          ' detected people. Use the numbered outlines and original media to choose the client above. Detection numbers only identify bodies within this capture. No measurements from this view are assigned to the client until a coach confirms one.</p>' +
          '<canvas id="person-choices" aria-label="Numbered detected bodies in the source capture"></canvas>' +
          '<div class="actions">' + detected.map((person, index) =>
            '<button type="button" data-pick-person="' + index + '">Preview Person ' +
            esc(person.person_id) + (person.suitable ? '' : ' · needs recapture') +
            '</button>').join('') + '</div>' +
          (item.kind === "movement" && v.media_id
            ? '<video controls preload="metadata" src="' + mediaURL(v.media_id) + '" aria-label="Original movement video"></video>'
            : '') +
          '<p class="muted">If the client cannot be identified confidently, leave this view unreviewed and recapture one person at a time.</p>' + retake + '</section>';
        paintPersonChoices(body, v);
        body.querySelectorAll("[data-pick-person]").forEach((button) => {
          button.onclick = () => {
            personIndex = Number(button.dataset.pickPerson);
            root.querySelector("[name=report-person]").value = String(personIndex);
            draw();
          };
        });
      } else {
        body.innerHTML = notice(
          "No person was detected. Use a clear full-body image or shorter video and try again.",
        ) + retake;
      }
      return;
    }
    if (unverified && ["comparison", "anatomy", "coaching"].includes(section)) {
      body.innerHTML = notice("This detected person has not been confirmed as " +
        state.client.name + ". Confirm their identity above before connecting measurements to client history, anatomy notes or a program.");
      return;
    }
    const render = () => {
    if (section === "summary") summary(body, v, p);
    if (section === "evidence") evidence(body, v, p);
    if (section === "coordinates") coordinateView(body, v, p);
    if (section === "movement") movement(body, v, p);
    if (section === "comparison") comparison(body, v, p);
    if (section === "anatomy") {
      const measures = [
        ...(p.metrics || []).filter((m) => Number.isFinite(m.value)).map((m) => ({
          name: m.name, value: m.value, unit: m.unit, region: metricRegion(m.name),
        })),
        ...Object.entries(p.signals || {}).filter(([, s]) => Number.isFinite(s.rom) && s.rom > 0.5)
          .map(([name, s]) => ({ name: name.replaceAll("_", " ") + " range", value: s.rom, unit: "deg", region: metricRegion(name) })),
      ];
      const relevant = [...new Set(measures.map((m) => m.region))];
      body.innerHTML = head("Why these body regions?", "The body map links this session's visible measurements to an educational anatomy reference and coach decisions.") +
        `<div class="grid three">${relevant.map((r) => {
          const evidence = measures.filter((m) => m.region === r).slice(0, 3);
          const regionNotes = notes.filter((n) => n.region_id === r);
          const explanation = state.me.regions.find((x) => x.id === r)?.explanation || "A body area associated with this visible measurement.";
          return card(regionName(r), `<p>${esc(explanation)}</p><p><strong>Why it is highlighted:</strong> ${evidence.map((m) => `${esc(m.name)} ${esc(num(m.value, m.unit))}`).join(" · ")}</p><p>${regionNotes.length ? `${regionNotes.length} coach note${regionNotes.length === 1 ? "" : "s"} linked` : "No coach note linked yet"}</p><div class="actions"><a class="button primary" href="${href("client", { tab: "anatomy", region: r, id })}">Explore anatomy →</a>${state.me.role !== "student" ? `<a class="button" href="${href("client", { tab: "programs", region: r, report: id, finding: evidence[0]?.name || "" })}">Plan exercise →</a>` : ""}</div>`);
        }).join("") || notice("No reliable measurement was available to map onto anatomy.")}</div>`;
    }
    if (section === "coaching") {
      const relevant = notes.filter((n) => n.analysis_id === id);
      const general = notes.filter((n) => !n.analysis_id);
      const noteCard = (n, label) => `<article class="note"><p class="eyebrow">${esc(label)}</p><h3><a href="${href("client", { tab: "anatomy", region: n.region_id || "thorax", id })}">${esc(regionName(n.region_id || "thorax"))}</a></h3><p>${esc(n.text)}</p><small>${esc(coachName(n.author_id))} · ${esc(dt(n.created_at))}${n.visibility === "coach" ? " · Coach only" : " · Shared with student"}</small>${n.program_id ? `<p><a href="${href("program", { id: n.program_id, client: item.student_id })}">Linked program →</a></p>` : ""}</article>`;
      body.innerHTML = `<div class="grid two">${card("Coach feedback", relevant.map((n) => noteCard(n, "THIS SESSION · " + feedbackProvenanceLabel(n))).join("") + general.slice(0, 3).map((n) => noteCard(n, "CLIENT CONTEXT · " + feedbackProvenanceLabel(n))).join("") || notice("No coach feedback is linked to this session yet."))}${card("Plan the next practice", `<p>Review the measured region, then choose or create an exercise with the coach. A visible pose does not reveal muscle weakness.</p>${state.client.programs.map((program) => `<a class="record-link" href="${href("program", { id: program.program_id, client: item.student_id })}">${esc(program.name)} →</a>`).join("") || "<p>No program is assigned yet.</p>"}${state.me.role !== "student" ? '<button data-edit="notes">+ Coaching note</button> <button id="targeted-program">Create targeted program</button>' : ""}`)}</div>`;
    }
    bindButtons(body);
    if (section === "coaching") wireTargetedProgram(p);
    if (unverified) body.insertAdjacentHTML("afterbegin", notice(
      "Previewing detected Person " + p.person_id + " only. The coach has not confirmed that this body is " +
      state.client.name + ". These measurements are not in the client's progress history. Confirm the correct person above or recapture one person at a time."
    ));
    };
    if (unverified) {
      comparableVisits = [];
      render();
    } else if (["summary", "evidence", "movement", "comparison"].includes(section)) {
      body.innerHTML = notice("Checking earlier comparable captures…");
      findComparableVisits(item, p, v.view, state.client.analyses, loadPrior)
        .then((visits) => {
          if (version !== drawVersion) return;
          comparableVisits = visits;
          render();
        })
        .catch((error) => {
          if (version !== drawVersion) return;
          body.innerHTML = notice("Earlier captures could not be checked. Reload this report to try again.");
          toast(error.message);
        });
    } else render();
  }
  function wireTargetedProgram(p) {
    const button = $("#targeted-program");
    if (!button) return;
    const regionIds = [...new Set([
      ...(p.metrics || []).filter((m) => Number.isFinite(m.value)).map((m) => metricRegion(m.name)),
      ...Object.entries(p.signals || {}).filter(([, s]) => Number.isFinite(s.rom) && s.rom > 0.5).map(([name]) => metricRegion(name)),
    ])];
    button.insertAdjacentHTML("beforebegin", select(
      "Observed region to focus on", "program-region",
      state.me.regions.filter((r) => regionIds.includes(r.id)),
      regionIds[0], "Choose a region",
    ));
    button.onclick = () => {
      const region = $("[name=program-region]").value;
      go("client", { tab: "programs", region, report: id, finding: primaryMeasurement(p)?.id || "" });
    };
  }
  function primaryMeasurement(person) {
    if (item.kind === "movement") {
      const signals = person?.signals || {};
      const action = item.protocol.toLowerCase();
      const preferred = /squat|lunge|hinge/.test(action)
        ? ["left_knee", "right_knee", "left_hip", "right_hip"]
        : /shoulder|arm|overhead/.test(action)
          ? ["left_shoulder", "right_shoulder"]
          : ["trunk_inclination", "left_hip", "right_hip"];
      const key = [...preferred, ...Object.keys(signals)].find((name) =>
        Number.isFinite(signals[name]?.rom) && signals[name].rom > 0.5,
      );
      return key ? {
        id: key, name: key.replaceAll("_", " ") + " range during clip",
        value: signals[key].rom, unit: "deg",
        source: "Projected video landmarks", repetitions: signals[key].repetitions,
      } : null;
    }
    return selectPostureObservation(person?.metrics || []);
  }
  function previousMeasurement(view, metricId) {
    if (view !== result.views[viewIndex].view) return null;
    return nearestComparableMeasurement(comparableVisits, metricId)?.metric.previous ?? null;
  }
  function summary(body, v, p) {
    const unverified = identityUnverified(v);
    const metric = primaryMeasurement(p);
    const observationBasis = item.kind === "posture"
      ? metric?.unit === "deg" && POSTURE_ANGLE_IDS.includes(metric.id) && metric.value !== 0 && (metric.status === "measured" || metric.status === "available")
        ? "Shown because this is the largest absolute reading among directly measured comparable alignment angles in this view. This display choice is not a clinical severity ranking; every reading remains in Capture & posture."
        : "An available pose reading is shown for context. This is not a clinical severity ranking; every reading remains in Capture & posture."
      : "This projected joint range is one selected signal; all other traces remain in Movement detail.";
    const region = metric ? metricRegion(metric.name) : null;
    const priorMatch = metric ? nearestComparableMeasurement(comparableVisits, metric.id) : null;
    const prior = priorMatch?.metric.previous ?? null;
    const priorSource = priorMatch ? `Comparison source: ${date(priorMatch.visit.analysis.created_at)} · <a href="${href("report", { id: priorMatch.visit.analysis.id })}">open earlier assessment →</a>` : "No earlier capture has this supported measurement in the same camera view.";
    const source = item.demo ? "Demo simulation · synthetic coordinates" :
      item.kind === "movement" ? "Uploaded video · real pose analysis" : "Uploaded photograph · real pose analysis";
    const frames = p.frames || [];
    const { accepted, span: timeSpan } = acceptedFrameSummary(frames);
    const side = metric?.id?.startsWith("left_") ? "Left side" :
      metric?.id?.startsWith("right_") ? "Right side" : "Visible body / both sides";
    const equipment = exercise?.equipment?.join?.(", ") ||
      exercise?.detail?.equipment || "Not recorded for this capture";
    const relevantNotes = availableNotes.filter((n) => n.analysis_id === id);
    const note = relevantNotes[0] || availableNotes.find((n) => !n.analysis_id);
    const sourceSession = `<a class="button" href="${href("client", { tab: "sessions", assessment: id })}">Open this session →</a>${item.status === "needs_capture" ? `<a class="button primary" href="${href("capture", { client: state.client.id, protocol: item.protocol, kind: item.kind, retry: "1" })}">Retake this capture →</a>` : ""}`;
    const anatomyLink = region && !unverified ? `<a class="button" href="${href("client", { tab: "anatomy", region, id })}">Why this body region? →</a>` : "";
    const programLink = region && !unverified && state.me.role !== "student"
      ? `<a class="button" href="${href("client", { tab: "programs", region, report: id, finding: metric.id })}">Add finding to program →</a>` : "";
    body.innerHTML = `<div class="report-summary"><section class="panel"><p class="eyebrow">WHAT DID ${unverified ? "THIS DETECTED PERSON" : state.me.role === "student" ? "YOU" : "THE CLIENT"} DO?</p><h2>${esc(item.protocol)}</h2><p>${esc(captureSummary(item.kind, item.protocol, item.status))}</p><dl><div><dt>Linked client record</dt><dd>${esc(state.client.name)}${unverified ? " · detected person not confirmed" : ""}</dd></div><div><dt>Recorded by</dt><dd>${esc(recordedByLabel(item, state.me.coaches))}</dd></div><div><dt>Recorded</dt><dd>${esc(dt(item.created_at))}</dd></div><div><dt>Location</dt><dd>${esc(locationName(item.location_id))}</dd></div><div><dt>Exercise category</dt><dd>${esc(exercise?.category || (item.kind === "movement" ? "Movement assessment" : "Posture assessment"))}</dd></div><div><dt>Capture source</dt><dd>${esc(source)}</dd></div><div><dt>Body side analyzed</dt><dd>${esc(side)}</dd></div><div><dt>Equipment</dt><dd>${esc(equipment)}</dd></div>${item.kind === "movement" ? `<div><dt>Accepted frame span</dt><dd>${esc(timeSpan)}<small>First to last accepted frame; gaps may remain.</small></dd></div><div><dt>Accepted frames</dt><dd>${accepted} of ${frames.length}</dd></div><div><dt>Complete cycles for selected joint</dt><dd>${metric?.repetitions ?? "Not detected"}</dd></div>` : ""}<div><dt>AI measurement status</dt><dd>${p.suitable ? "Visible landmarks measured" : "Capture needs review"}</dd></div><div><dt>Coach review</dt><dd>${unverified ? "Identity pending for this view" : item.detail.reviewed_at ? "Reviewed" : "Pending"}</dd></div></dl><div class="actions">${sourceSession}</div></section><section class="panel"><p class="eyebrow">HOW WAS IT RECORDED?</p>${cameraGuide(v.view, item.protocol)}</section></div>${metric ? `<section class="report-finding"><p class="eyebrow">MAIN OBSERVATION · ${unverified ? "UNVERIFIED PERSON PREVIEW" : esc(item.demo ? "DEMO DATA" : "SYSTEM MEASUREMENT")}</p><h3>${esc(metric.name)}</h3><p>The visible landmark ${metric.status === "estimated" ? "estimate" : "measurement"} was <strong>${esc(num(metric.value, metric.unit))}</strong> in this ${esc(cameraLabels[v.view] || v.view)}. ${esc(metricCopy(metric).definition)}</p><small>${esc(observationBasis)}</small><p>${esc(comparisonText(metric.value, prior, metric.unit))}</p><small>Uses the nearest earlier same-protocol capture with a matching camera view, suitable selected person, measurement unit and evidence status. ${priorSource} Open Compare sessions to inspect other visits.</small><p>${esc(metricCopy(metric).why)}</p><div class="actions">${anatomyLink}${programLink}<button type="button" id="summary-detail">View captured evidence →</button></div></section>` : notice(p.warnings?.join(" ") || "No reliable landmark measurement was available. Review the capture before planning from it.")}${card("Coach feedback", unverified ? notice("Confirm which detected person is this client before connecting coach feedback to this view.") : note ? `<p class="eyebrow">${esc(feedbackProvenanceLabel(note))}</p><p>${esc(note.text)}</p><small>${esc(coachName(note.author_id))} · ${esc(dt(note.created_at))}${note.analysis_id ? " · This assessment" : " · General client note"}</small><div class="actions"><a class="button" href="${href("client", { tab: "notes", region: note.region_id, note: note.id, id })}">Read linked feedback →</a></div>` : `<p>${state.me.role === "student" ? "Your coach has not added feedback for this session." : "No coach feedback is linked to this session yet."}</p>${state.me.role === "student" || unverified ? "" : `<a class="button" href="${href("client", { tab: "anatomy", region: region || "thorax", id })}">Add feedback on the body map →</a>`}`)}${notice("This summary describes visible pose evidence. It does not diagnose injury, infer muscle weakness or establish a medical normal range.")}`;
    const detail = body.querySelector("#summary-detail");
    if (detail) detail.onclick = () => { section = "evidence"; draw(); };
  }
  function framesControl(p) {
    return item.kind === "movement"
      ? `<label>Frame time · <output id="frame-time">${num(p.frames?.[frameIndex]?.time || 0)} s</output><input id="frame-slider" type="range" min="0" max="${Math.max(0, (p.frames?.length || 1) - 1)}" value="${frameIndex}"></label>`
      : "";
  }
  function bindFrame(p, callback) {
    const slider = $("#frame-slider");
    if (slider)
      slider.oninput = (e) => {
        frameIndex = +e.target.value;
        $("#frame-time").textContent = num(p.frames[frameIndex].time) + " s";
        callback();
      };
  }
  function evidence(body, v, p) {
    const raw = v.report;
    const synthetic = !!item.demo;
    body.innerHTML = `${!p.suitable ? notice((p.warnings || []).join(" ") || "Insufficient visible body evidence. Retake this view; no measurements have been invented.") : ""}<div class="grid two">${card(synthetic ? "Scenario skeleton · simulated coordinates" : "Original capture & landmarks", `${framesControl(p)}<div class="evidence-canvas"><canvas id="skeleton" width="${Number(raw.width) || 640}" height="${Number(raw.height) || 960}" aria-label="Anatomically labelled body skeleton"></canvas></div><small>Anatomical left is the person’s left, regardless of screen position. Proxy landmarks are not detected vertebrae.</small>`)}${card("Estimated body representation", `<div class="pose-box"><canvas id="pose3d" aria-label="Rotatable estimated 3D skeleton"></canvas><p id="pose-empty" class="muted"></p></div><small>${synthetic ? "DEMO: parametric coordinates illustrate the scenario." : "Independent model estimate in metres. Drag to rotate; missing depth remains unavailable."}</small>`)}</div>${v.media_id ? card(synthetic ? "Generated scenario imagery · separate from simulated coordinates" : "Original media", synthetic ? `<div class="session-illustration"><img src="${mediaURL(v.media_id)}" style="left:${item.detail.panel ? "-100%" : "0"}" alt="Fictional client illustration · ${item.detail.panel ? "later visit" : "baseline visit"}"></div><small>${item.detail.panel ? "Later" : "Baseline"} scenario illustration, linked to this visit. It is not the source of the simulated measurements.</small>` : item.kind === "movement" ? `<video id="evidence-video" controls src="${mediaURL(v.media_id)}"></video>` : `<img class="source-photo" src="${mediaURL(v.media_id)}" alt="Original captured posture">`) : ""}${item.kind === "posture" ? `<div class="grid two">${(p.metrics || []).filter((m) => Number.isFinite(m.value)).map((m) => {
      const copy = metricCopy(m);
      return explainedChart({ title: m.name, definition: copy.definition, why: copy.why,
        notice: "Compare the same stance and camera view across visits.", current: m.value,
        previous: previousMeasurement(v.view, m.id), unit: m.unit,
        source: synthetic ? "Simulated pose coordinates" : "Original photograph landmarks",
        regionLink: identityUnverified(v) ? "" : `<a class="button" href="${href("client", { tab: "anatomy", region: metricRegion(m.name), id })}">Explore linked body region →</a>`,
      });
    }).join("") || notice("No reliable posture measurements were available for this view.")}</div>` : `<section class="panel"><h3>Movement measurement</h3><p>Joint range, timing and repetition findings are in Movement detail. This frame view shows the evidence used to calculate them.</p><button type="button" id="evidence-movement-detail">See movement findings →</button></section>`}<details class="report-advanced"><summary>Technical measurement table</summary><p>Model confidence describes landmark support, not a probability of medical correctness. Values retain their units; unavailable measurements are not scored.</p>${metricsTable(p.metrics || [])}</details>`;
    const movementDetail = body.querySelector("#evidence-movement-detail");
    if (movementDetail) movementDetail.onclick = () => { section = "movement"; draw(); };
    let photo = null;
    if (!synthetic && item.kind === "posture" && v.media_id) {
      photo = new Image();
      photo.onload = () => paint();
      photo.src = mediaURL(v.media_id);
    }
    const canvas = $("#skeleton");
    poseCanvas = new PoseCanvas($("#pose3d"), $("#pose3d").parentElement, {
      dark: true,
    });
    const paint = () => {
      const f = currentFrame();
      drawSkeleton(canvas, f?.landmarks, photo);
      showPose(f?.pose3d);
    };
    const video = $("#evidence-video");
    bindFrame(p, () => {
      if (video) video.currentTime = p.frames[frameIndex].time;
      else paint();
    });
    if (video)
      video.onseeked = video.ontimeupdate = () => {
        const frames = p.frames || [];
        const index = frames.reduce(
          (best, f, i) =>
            Math.abs(f.time - video.currentTime) <
            Math.abs(frames[best].time - video.currentTime)
              ? i
              : best,
          0,
        );
        frameIndex = index;
        if ($("#frame-slider")) $("#frame-slider").value = index;
        if ($("#frame-time"))
          $("#frame-time").textContent = num(frames[index]?.time) + " s";
        drawSkeleton(
          canvas,
          frames[index]?.landmarks,
          Math.abs((frames[index]?.time || 0) - video.currentTime) < 0.25
            ? video
            : null,
        );
        showPose(frames[index]?.pose3d);
      };
    paint();
  }
  function showPose(pose) {
    const el = $("#pose-empty");
    if (pose?.status === "estimated" && pose.joints?.length) {
      $("#pose3d").hidden = false;
      el.hidden = true;
      poseCanvas.set({
        ...pose,
        bones: pose.bones || edges,
        label: item.demo ? "DEMO COORDINATES · SIMULATED" : undefined,
      });
    } else {
      $("#pose3d").hidden = true;
      el.hidden = false;
      el.textContent =
        pose?.reason ||
        "Depth unavailable for this frame. Use the image-plane coordinates below.";
    }
  }
  function metricsTable(metrics) {
    return table(
      ["Measurement", "Value", "Model confidence", "Evidence / region"],
      metrics.map((m) => [
        esc(m.name),
        num(m.value, m.unit),
        Number.isFinite(m.confidence)
          ? Math.round(m.confidence * 100) + "%"
          : "—",
        `<a href="${href("client", { tab: "anatomy", region: metricRegion(m.name), id })}">${esc(regionName(metricRegion(m.name)))}</a><small class="block">${esc(item.demo && m.value != null ? "Calculated from simulated coordinates" : m.reason || m.status)}</small>`,
      ]),
    );
  }
  function coordinateView(body, v, p) {
    const all = coords.filter(
      (c) => c.person_id === String(p.person_id) && c.view === v.view,
    );
    body.innerHTML =
      notice(
        "Image X/Y use pixels from the original frame. Model X/Y/Z use hip-relative estimated metres when available. Confidence belongs to the pose model; it is not a probability of medical correctness.",
      ) +
      framesControl(p) +
      `<div class="filter-row">${select(
        "Landmark",
        "coordinate-landmark",
        labels.map((n, i) => [i, n]),
        landmark,
        null,
      )}${select(
        "Coordinate space",
        "coordinate-space",
        [
          ["image_px", "Original image · pixels"],
          ["model_estimated_m", "Estimated 3D · metres"],
        ],
        "image_px",
        null,
      )}</div><div id="coordinate-detail"></div><div id="coordinate-table"></div>`;
    function coordinateDraw() {
      landmark = body.querySelector("[name=coordinate-landmark]").value;
      const space = body.querySelector("[name=coordinate-space]").value;
      const rows = all.filter((c) => c.space === space);
      const at = rows
        .filter((c) => c.frame_index === frameIndex)
        .sort((a, b) => Number(a.landmark_id) - Number(b.landmark_id));
      const coordinateNumber = (v) =>
        v == null
          ? "Unavailable"
          : Number(v).toFixed(space === "image_px" ? 1 : 3);
      const selected = at.find((c) => c.landmark_id === landmark);
      const trajectory = rows.filter((c) => c.landmark_id === landmark);
      $("#coordinate-detail").innerHTML =
        `<div class="panel"><h3>${esc(labels[+landmark])}</h3><p>${esc(selected?.reason || "Unavailable for this frame.")}</p><p>${esc(selected?.method || "")}</p>${identityUnverified(v) ? "" : `<a class="button" href="${href("client", { tab: "anatomy", region: selected?.region_id || metricRegion(labels[+landmark]), id })}">Explore this anatomical region</a>`}</div><div class="grid three">${["x", "y", "z"].map((axis) =>
          coordinateTraceChart({
            axis, space, selected, trajectory,
            landmarkName: labels[+landmark], demo: item.demo, kind: item.kind,
          })
        ).join("")}</div>`;
      $("#coordinate-table").innerHTML = `<details class="report-advanced"><summary>All landmark values for this frame</summary>${table(
        ["Landmark", `X · ${space === "image_px" ? "px" : "estimated m"}`, `Y · ${space === "image_px" ? "px" : "estimated m"}`, `Z · ${space === "image_px" ? "unavailable" : "estimated m"}`, "Model confidence", "Time · seconds / sampled frame", "Status"],
        at.map((c) => [
          `<button class="text-button" data-landmark="${c.landmark_id}">${esc(c.name)}</button>`,
          coordinateNumber(c.x),
          coordinateNumber(c.y),
          coordinateNumber(c.z),
          c.confidence == null ? "—" : Math.round(c.confidence * 100) + "%",
          `${num(c.time)}s / ${esc(c.frame_index)}`,
          esc(item.demo && c.status !== "unavailable" ? "simulated" : c.status),
        ]),
      )}</details>`;
      body.querySelectorAll("[data-landmark]").forEach(
        (b) =>
          (b.onclick = () => {
            body.querySelector("[name=coordinate-landmark]").value =
              b.dataset.landmark;
            coordinateDraw();
          }),
      );
    }
    body
      .querySelectorAll("select")
      .forEach((s) => (s.onchange = coordinateDraw));
    bindFrame(p, coordinateDraw);
    coordinateDraw();
  }
  function movement(body, v, p) {
    if (item.kind !== "movement") {
      body.innerHTML = notice("Movement requires a video. Capture a repeated movement to obtain joint-angle traces and cycle analysis.") +
        `<a class="button primary" href="${href("capture")}">Record movement</a>`;
      return;
    }
    const signals = p.signals || {};
    if (!Object.keys(signals).length) {
      body.innerHTML = notice("No reliable joint-angle trace was available from this video. Review capture framing and visibility.");
      return;
    }
    if (!signals[signal]) signal = Object.keys(signals)[0];
    body.innerHTML = `<div class="filter-row">${select(
      "Body movement to inspect", "movement-signal",
      Object.keys(signals).map((s) => [s, s.replaceAll("_", " ")]),
      signal, null,
    )}</div><div id="movement-charts"></div>`;
    function plots() {
      signal = body.querySelector("select").value;
      const s = signals[signal] || {};
      const k = result.kinematics?.[p.person_id]?.signals?.[signal] || {};
      const peer = signal.startsWith("left_") ? "right_" + signal.slice(5)
        : signal.startsWith("right_") ? "left_" + signal.slice(6) : null;
      const region = metricRegion(signal);
      const name = signal.replaceAll("_", " ");
      const technical = movementTechnicalNumbers(s, k, p, item.demo);
      const main = explainedChart({ title: name + " range during " + item.protocol,
        definition: "Difference between the largest and smallest smoothed, accepted projected joint angles during this clip.",
        why: "This is a camera-view measurement, not the full anatomical range of the joint. The repeat count requires complete outward and return phases.",
        notice: `The system found ${s.repetitions ?? "no verified"} complete cycle${s.repetitions === 1 ? "" : "s"}. Compare the same movement and camera view on another visit.`,
        current: s.rom, previous: previousMeasurement(v.view, signal), unit: "deg",
        source: item.demo ? "Demo simulated video landmarks" : "Uploaded video pose landmarks",
        chart: s.smoothed_series ? spark(s.smoothed_series, { label: "Smoothed projected joint angle over clip time (seconds)", unit: "deg" }) : `<details class="report-advanced"><summary>View archived raw angle trace</summary><p>This older record has no plotted smoothed trace; its reported range was calculated after smoothing, so raw peaks can differ.</p>${spark(s.series || [], { label: "Raw projected joint angle over clip time (seconds)", unit: "deg" })}</details>`,
        regionLink: identityUnverified(v) ? "" : `<a class="button" href="${href("client", { tab: "anatomy", region, id })}">Explore ${esc(regionName(region))} →</a>`,
        sessionLink: state.me.role !== "student" && !identityUnverified(v) ? `<a class="button" href="${href("client", { tab: "programs", region, report: id, finding: signal })}">Use finding in program →</a>` : "",
      });
      const peerSignal = peer ? signals[peer] : null;
      const peerCard = peerSignal ? explainedChart({ title: peer.replaceAll("_", " ") + " range", definition: "Projected angle range for the opposite side from the same clip.", why: "Camera perspective and side visibility can make these estimates incomparable; a difference alone does not indicate a problem.", notice: "Inspect both traces before interpreting a side-to-side difference.", current: peerSignal.rom, previous: previousMeasurement(v.view, peer), unit: "deg", source: item.demo ? "Demo simulated landmarks" : "Uploaded video pose landmarks", chart: peerSignal.smoothed_series ? spark(peerSignal.smoothed_series, { label: "Smoothed opposite-side projected angle over time (seconds)", unit: "deg", color: "#59d1b1" }) : `<details class="report-advanced"><summary>View archived raw opposite-side trace</summary><p>This older record has no plotted smoothed trace; raw peaks can differ from the range.</p>${spark(peerSignal.series || [], { label: "Raw opposite-side projected angle over time (seconds)", unit: "deg", color: "#59d1b1" })}</details>` }) : "";
      const cycleTable = table(["Cycle", "Start", "Return complete", "Range", "Out", "Return"],
        (s.cycles || []).map((r, i) => [i + 1, num(r.start, "s"), num(r.end, "s"), num(r.rom, "deg"), num(r.out_seconds, "s"), num(r.return_seconds, "s")]));
      const phases = ["start", "peak", "return"].map((phase) => `<span>${phase === "return" && !k.phases?.complete_cycle ? "END · return unverified" : phase.toUpperCase()}<b>${k.phases?.[phase] ? num(k.phases[phase][0]) + "s · " + num(k.phases[phase][1], "deg") : "Unavailable"}</b></span>`).join("");
      $("#movement-charts").innerHTML = `<p class="report-source">${esc(item.protocol)} · ${esc(cameraLabels[v.view] || v.view)} · ${item.demo ? "DEMO SIMULATION" : "REAL CAPTURE"}</p>${main}${peerCard ? `<div class="grid two">${peerCard}${card("How the clip unfolded", `<p>Complete cycles: <strong>${s.repetitions ?? "Unavailable"}</strong>. Average detected cycle time: <strong>${num(s.tempo_s, "s")}</strong>.</p><div class="phase-track">${phases}</div><p>These phase labels come from the raw trace; the range cards and charts use smoothed angles. A return is shown only when the raw trace supports a complete cycle.</p>`)}</div>` : card("How the clip unfolded", `<p>Complete cycles: <strong>${s.repetitions ?? "Unavailable"}</strong>. Average detected cycle time: <strong>${num(s.tempo_s, "s")}</strong>.</p><div class="phase-track">${phases}</div><p>These phase labels come from the raw trace; the range card and chart use smoothed angles.</p>`)}<details class="report-advanced"><summary>Advanced timing, variation and cycle data</summary>${technical}${movementDerivativeCharts(k, item.demo)}${cycleTable}${table(["Paired movement", "Mean left minus right angle"], Object.entries(p.left_right_mean_angle_difference || {}).map(([key, value]) => [esc(key.replaceAll("_", " ")), num(value, "deg")]))}</details>${notice(s.reason || "No gaps are interpolated. Camera motion and perspective affect projected angles and trajectories.")}`;
    }
    body.querySelector("select").onchange = plots;
    plots();
  }
  function comparison(body, v, p) {
    body.innerHTML = select("Previous comparable session", "previous",
      comparableVisits.map(({ analysis }) => [analysis.id, date(analysis.created_at) + " · " + analysis.protocol]),
      comparableVisits[0]?.analysis.id, "Choose a session") + '<div id="comparison-detail"></div>';
    const compare = () => {
      const value = body.querySelector("select").value;
      const chosenVisit = comparableVisits.find(({ analysis }) => analysis.id === value);
      if (!chosenVisit) {
        $("#comparison-detail").innerHTML = notice("No earlier capture with this protocol, camera view, suitable selected person and matching supported measurement is available. Repeat the same assessment to build a comparison.");
        return;
      }
      const { analysis: earlier, view: earlierView, person: prior, metrics: matchingMetrics } = chosenVisit;
      const currentMetrics = item.kind === "movement"
        ? Object.entries(p.signals || {}).map(([key, signal]) => ({ id: key, name: key.replaceAll("_", " ") + " range", value: signal.rom, unit: "deg" }))
        : p.metrics || [];
      const preferred = primaryMeasurement(p)?.id;
      const main = matchingMetrics.find((metric) => metric.id === preferred)
        || matchingMetrics.find((metric) => Math.abs(metric.current) > 0.5)
        || matchingMetrics[0];
      const copy = metricCopy(main || {});
      $("#comparison-detail").innerHTML =
        `<p class="report-source">${esc(item.protocol)} · ${esc(cameraLabels[v.view] || v.view)} · ${item.demo ? "DEMO SIMULATION" : "REAL CAPTURE"}</p>` +
        (main ? explainedChart({ title: main.name + " across visits", definition: copy.definition,
          why: copy.why + " The measured change does not prove improvement or treatment effect.",
          notice: "Review both captures and ask whether camera setup, stance and movement matched.",
          current: main.current, previous: main.previous, unit: main.unit,
          source: item.demo ? "Separate simulated pose coordinates for each visit" : "Pose landmarks from uploaded captures",
          regionLink: `<a class="button" href="${href("client", { tab: "anatomy", region: metricRegion(main.name), id })}">Explore body region →</a>`,
          sessionLink: `<a class="button" href="${href("client", { tab: "sessions", assessment: value })}">Open earlier session →</a>`,
        }) : notice("Neither visit contains a reliable matching measurement for this view.")) +
        `<div class="grid two">${card("Previous · " + date(earlier.created_at), '<canvas id="before-skeleton" width="640" height="960"></canvas>')}${card("Current · " + date(item.created_at), '<canvas id="after-skeleton" width="640" height="960"></canvas>')}</div>` +
        `<details class="report-advanced"><summary>Compare all technical measurements</summary>${table(
          ["Measurement", "Previous", "Current", "Measured change"],
          currentMetrics.map((metric) => {
            const match = matchingMetrics.find((candidate) => candidate.id === metric.id);
            return [esc(metric.name), num(match?.previous, metric.unit), num(metric.value, metric.unit),
              num(match ? match.current - match.previous : null, metric.unit)];
          }),
        )}</details>` +
        notice("Only matching camera views, selected people, protocols, units and evidence status are compared. A change is an observation; it does not establish treatment effect.");
      $("#before-skeleton").width = earlierView.report.width || 640;
      $("#before-skeleton").height = earlierView.report.height || 960;
      $("#after-skeleton").width = v.report.width || 640;
      $("#after-skeleton").height = v.report.height || 960;
      for (const [canvasId, analysis, view, person] of [
        ["before-skeleton", earlier, earlierView, prior],
        ["after-skeleton", item, v, p],
      ]) {
        const canvas = $("#" + canvasId);
        const landmarks = person.frames?.[0]?.landmarks || person.landmarks;
        drawSkeleton(canvas, landmarks);
        if (view.media_id && analysis.demo) {
          canvas.insertAdjacentHTML("afterend", `<div class="session-illustration"><img src="${mediaURL(view.media_id)}" style="left:${analysis.detail.panel ? "-100%" : "0"}" alt="Generated imagery for this client's visit"></div><small>Generated scenario imagery · measurements above use separate simulated coordinates.</small>`);
        } else if (view.media_id && analysis.kind === "posture") {
          const image = new Image();
          image.onload = () => drawSkeleton(canvas, landmarks, image);
          image.src = mediaURL(view.media_id);
        }
      }
    };
    body.querySelector("select").onchange = compare;
    compare();
  }

  draw();
  state.dispose.push(() => poseCanvas?.dispose());
}
export function drawSkeleton(canvas, landmarks, image = null) {
  const c = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  c.fillStyle = "#091322";
  c.fillRect(0, 0, w, h);
  if (image && (image.complete || image.readyState >= 2))
    c.drawImage(image, 0, 0, w, h);
  if (!landmarks) return;
  const points = landmarks.keypoints,
    scores = landmarks.scores;
  c.lineWidth = Math.max(2, w / 260);
  for (const [a, b] of edges) {
    if (scores[a] < 0.5 || scores[b] < 0.5) continue;
    c.strokeStyle = a % 2 ? "#54dbc7" : "#85aaff";
    c.beginPath();
    c.moveTo(...points[a]);
    c.lineTo(...points[b]);
    c.stroke();
  }
  if ([5, 6, 11, 12].every((i) => scores[i] >= 0.5)) {
    const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const neck = midpoint(points[5], points[6]),
      pelvis = midpoint(points[11], points[12]);
    const spine = midpoint(neck, pelvis);
    c.save();
    c.setLineDash([w / 100, w / 150]);
    c.strokeStyle = "#ffd388";
    c.beginPath();
    c.moveTo(...neck);
    c.lineTo(...pelvis);
    c.stroke();
    c.setLineDash([]);
    for (const [point, label] of [
      [neck, "Neck base · proxy"],
      [spine, "Spine · trunk proxy"],
      [pelvis, "Pelvis centre"],
    ]) {
      c.fillStyle = "#ffd388";
      c.beginPath();
      c.arc(...point, Math.max(4, w / 150), 0, Math.PI * 2);
      c.fill();
      c.font = `${Math.max(11, w / 60)}px system-ui`;
      c.textAlign = "center";
      const tw = c.measureText(label).width;
      c.fillStyle = "#08101edf";
      c.fillRect(point[0] - tw / 2 - 3, point[1] + 5, tw + 6, 19);
      c.fillStyle = "#ffd388";
      c.fillText(label, point[0], point[1] + 19);
    }
    c.restore();
  }
  for (let i = 0; i < Math.min(17, points.length); i++) {
    if (scores[i] < 0.5) continue;
    const [x, y] = points[i];
    c.fillStyle = i % 2 ? "#54dbc7" : "#85aaff";
    c.beginPath();
    c.arc(x, y, Math.max(4, w / 150), 0, Math.PI * 2);
    c.fill();
    if ([0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(i)) {
      c.font = `${Math.max(11, w / 53)}px system-ui`;
      const text = labels[i];
      const right = i % 2 === 1;
      c.textAlign = right ? "left" : "right";
      const tx = x + (right ? 12 : -12);
      const tw = c.measureText(text).width;
      c.fillStyle = "#08101edf";
      c.fillRect(right ? tx - 3 : tx - tw - 3, y - 13, tw + 6, 18);
      c.fillStyle = "#e4eeff";
      c.fillText(text, tx, y);
    }
  }
}
