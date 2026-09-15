import { PoseCanvas } from "./poseCanvas.js";
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const BONES = [
  [5, 6],
  [5, 11],
  [6, 12],
  [11, 12],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
];
let tab = "photo",
  file = null,
  report = null,
  person = 0,
  sourceURL = null,
  history = [],
  busy = false,
  stream = null,
  recorder = null,
  recordTimer = null,
  discardRecording = false;
const localImages = new Map();
let beforeDetail = null,
  afterDetail = null;
async function api(url, body) {
  const r = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
const labelView = (v) =>
  ({
    auto: "View estimated",
    front: "Front",
    rear: "Back",
    side_left: "Left side",
    side_right: "Right side",
    three_quarter: "Three-quarter",
    unknown: "Unknown view",
  })[v] || v;
function status(s) {
  return `<span class="pill ${esc(s)}">${esc(s).toUpperCase()}</span>`;
}
function fmt(v, unit = "deg") {
  return v == null
    ? "—"
    : `${Number(v).toFixed(unit === "ratio" ? 3 : 1)}${unit === "deg" ? "°" : unit === "ratio" ? " ratio" : ""}`;
}
function setBusy(value) {
  busy = value;
  $("run").disabled = value || !file;
  $("file").disabled = value;
  $("camera").disabled = value;
  document
    .querySelectorAll(".tabs button")
    .forEach((b) => (b.disabled = value));
}
function chooseTab(next) {
  if (busy) return;
  tab = next;
  document
    .querySelectorAll(".tabs button")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("capture-panel").hidden = tab === "compare";
  $("comparison-panel").hidden = tab !== "compare";
  if (tab === "compare") {
    loadHistory();
    return;
  }
  $("capture-title").textContent =
    tab === "video" ? "Watch the movement" : "Start with a photograph";
  $("capture-help").textContent =
    tab === "video"
      ? "One continuous exercise, up to 2 minutes. Keep the camera still and the full body visible."
      : "Full body, head to feet. Even lighting. Camera level and square to the body.";
  $("drop-title").textContent =
    tab === "video" ? "Choose a video" : "Choose a photograph";
  $("file").accept =
    tab === "video" ? "video/*" : "image/jpeg,image/png,image/webp";
  $("file-label").textContent =
    tab === "video"
      ? "MP4 or WebM · up to 2 minutes"
      : "JPG, PNG or WebP · up to 8 MB";
  $("run").innerHTML =
    tab === "video"
      ? "Analyse movement <span>→</span>"
      : "Analyse photograph <span>→</span>";
  $("mode-field").hidden = tab === "video";
  $("depth-field").hidden = tab === "video";
  $("protocol-field").hidden = tab !== "video";
  clearInput();
}
function clearInput() {
  $("observation-title").textContent = "Your body, in context";
  $("empty").querySelector("p").textContent =
    tab === "video"
      ? "Upload a continuous movement video. Keep the full body visible."
      : "Upload a photograph or capture a frame. We’ll check the visible evidence.";
  file = null;
  report = null;
  person = 0;
  $("file").value = "";
  $("run").disabled = true;
  $("photo").hidden = true;
  $("video").hidden = true;
  $("video").pause();
  $("empty").hidden = false;
  $("overlay").innerHTML = "";
  $("person-tabs").innerHTML = "";
  $("report").innerHTML = "";
  $("error").textContent = "";
  $("progress").textContent = "";
  clearWorld(
    "A learned 3D skeleton appears only when the visible joints agree with the photograph’s pose estimate.",
  );
}
document
  .querySelectorAll(".tabs button")
  .forEach((b) => (b.onclick = () => chooseTab(b.dataset.tab)));
function useFile(f) {
  if (!f) return;
  if (
    (tab === "photo" && !f.type.startsWith("image/")) ||
    (tab === "video" && !f.type.startsWith("video/"))
  ) {
    $("error").textContent = "Choose a file for the selected assessment type.";
    return;
  }
  file = f;
  report = null;
  $("person-tabs").innerHTML = "";
  $("overlay").innerHTML = "";
  $("report").innerHTML = "";
  $("file-label").textContent = f.name;
  $("empty").hidden = true;
  $("error").textContent = "";
  sourceURL = URL.createObjectURL(f);
  if (tab === "photo") {
    $("photo").src = sourceURL;
    $("photo").hidden = false;
    $("video").hidden = true;
  } else {
    $("video").src = sourceURL;
    $("video").hidden = false;
    $("photo").hidden = true;
  }
  $("run").disabled = false;
  clearWorld("Ready to check the body.");
}
$("file").onchange = (e) => useFile(e.target.files[0]);
function dataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
$("run").onclick = async () => {
  if (!file || busy) return;
  setBusy(true);
  $("error").textContent = "";
  $("progress").textContent = "Finding people and checking visible evidence…";
  try {
    if (tab === "photo") {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Use a photograph smaller than 8 MB.");
      report = await api("/evidence/photo", {
        image: await dataURL(file),
        subject: $("subject").value || "Unnamed",
        view: $("view").value,
        mode: $("mode").value,
        tiled: $("tiled").checked,
        include_3d: $("depth").checked,
      });
    } else {
      const params = new URLSearchParams({
        subject: $("subject").value || "Unnamed",
        protocol: $("exercise-protocol").value,
        view: $("view").value,
        tiled: String($("tiled").checked),
      });
      const r = await fetch("/evidence/video?" + params, {
        method: "POST",
        headers: { "X-Filename": file.name },
        body: file,
      });
      let job = await r.json();
      if (!r.ok) throw new Error(job.error);
      while (!["done", "failed"].includes(job.state)) {
        $("progress").textContent =
          job.lines.at(-1) || `Analysing video · ${job.seconds}s elapsed`;
        await new Promise((r) => setTimeout(r, 1200));
        job = await api("/evidence/jobs?id=" + encodeURIComponent(job.id));
      }
      if (job.state === "failed") throw new Error(job.error);
      report = job.bundle;
    }
    person = 0;
    if (report.assessment_id) localImages.set(report.assessment_id, sourceURL);
    renderReport();
    await loadHistory();
    $("progress").textContent =
      `${report.people.length} ${report.people.length === 1 ? "person" : "people"} detected · inspect each overlay.`;
  } catch (e) {
    $("error").textContent = e.message;
    $("progress").textContent = "";
  } finally {
    setBusy(false);
  }
};
function renderPeople() {
  $("person-tabs").innerHTML = (report.people || [])
    .map(
      (p, i) =>
        `<button class="${person === i ? "active" : ""}" data-person="${i}">Person ${esc(p.person_id)}${p.suitable ? "" : " · review"}</button>`,
    )
    .join("");
  $("person-tabs")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          person = Number(b.dataset.person);
          renderReport();
        }),
    );
}
function skeleton(
  p,
  w,
  h,
  { labels = true, labelScale = null, leftEdge = 0, rightEdge = w } = {},
) {
  const lm = p?.landmarks;
  if (!lm || !p.suitable) return "";
  const k = lm.keypoints,
    s = lm.scores;
  const scale = labelScale || Math.max(w, h) / 350;
  let out = "";
  const color = p.suitable ? "#198c7a" : "#c88c58";
  for (const [a, b] of BONES)
    if (s[a] >= 0.5 && s[b] >= 0.5)
      out += `<line x1="${k[a][0]}" y1="${k[a][1]}" x2="${k[b][0]}" y2="${k[b][1]}" stroke="${color}" stroke-width="${2.4 * scale}"/>`;
  k.forEach(([x, y], i) => {
    if (s[i] >= 0.5)
      out += `<circle cx="${x}" cy="${y}" r="${3.3 * scale}" fill="${color}" stroke="white" stroke-width="${scale}"/>`;
  });
  if (!labels) return out;
  const names = {
    5: "L shoulder",
    6: "R shoulder",
    11: "L hip",
    12: "R hip",
    13: "L knee",
    14: "R knee",
  };
  const byId = Object.fromEntries((p.metrics || []).map((m) => [m.id, m]));
  let lanes = { left: [], right: [] };
  for (const [idx, name] of Object.entries(names)) {
    const j = Number(idx);
    if (s[j] < 0.5) continue;
    const lineId =
      j < 7
        ? "shoulder_tilt"
        : j < 13
          ? "pelvic_obliquity"
          : j === 13
            ? "left_knee_deviation"
            : "right_knee_deviation";
    const m = byId[lineId];
    const sign = j === 6 || j === 12 ? -1 : 1;
    let text = name;
    if (m?.value != null) text += ` ${fmt(sign * m.value, m.unit)}`;
    const x = k[j][0],
      y = k[j][1];
    const mid = (k[5][0] + k[6][0]) / 2;
    const lane = x < mid ? "left" : "right";
    lanes[lane].push({ x, y, text });
  }
  for (const [lane, items] of Object.entries(lanes)) {
    items.sort((a, b) => a.y - b.y);
    let last = -100;
    for (const a of items) {
      const ly = Math.max(
        Math.min(a.y, h - 15 * scale),
        last + 23 * scale,
        20 * scale,
      );
      last = ly;
      const tw = Math.min(145 * scale, (rightEdge - leftEdge) * 0.43);
      const left = lane === "left";
      const tx = left ? leftEdge + 6 * scale : rightEdge - tw - 6 * scale;
      out += `<path d="M${a.x},${a.y} L${left ? tx + tw : tx},${ly}" stroke="${color}" stroke-width="${scale}" fill="none"/><rect x="${tx}" y="${ly - 11 * scale}" width="${tw}" height="${21 * scale}" rx="${3 * scale}" fill="white" fill-opacity=".95"/><text x="${tx + 5 * scale}" y="${ly + 3.5 * scale}" font-size="${10 * scale}" fill="#21443e" font-family="system-ui">${esc(a.text)}</text>`;
    }
  }
  if (p.suitable && k[15] && k[16] && s[15] >= 0.5 && s[16] >= 0.5) {
    const x = (k[15][0] + k[16][0]) / 2;
    out =
      `<line x1="${x}" y1="${Math.min(...k.filter((_, i) => s[i] >= 0.5).map((q) => q[1]))}" x2="${x}" y2="${Math.max(k[15][1], k[16][1])}" stroke="#668d84" stroke-dasharray="${5 * scale},${4 * scale}" stroke-width="${scale}"/>` +
      out;
  }
  return out;
}
function drawOverlay() {
  if (!report) return;
  const p = report.people[person];
  const stage = $("image-stage");
  const factor = Math.min(
    stage.clientWidth / report.width,
    stage.clientHeight / report.height,
  );
  if (!factor) return;
  const viewWidth = stage.clientWidth / factor,
    viewHeight = stage.clientHeight / factor;
  const leftEdge = (report.width - viewWidth) / 2;
  const topEdge = (report.height - viewHeight) / 2;
  $("overlay").setAttribute(
    "viewBox",
    `${leftEdge} ${topEdge} ${viewWidth} ${viewHeight}`,
  );
  let draw = p;
  if (report.kind === "video" && p) {
    const t = $("video").currentTime;
    const f = p.frames.reduce(
      (best, f) =>
        Math.abs(f.time - t) < Math.abs((best?.time ?? Infinity) - t)
          ? f
          : best,
      null,
    );
    draw =
      f && Math.abs(f.time - t) < 0.3
        ? {
            ...p,
            landmarks: {
              ...f.landmarks,
              scores: f.landmarks.scores.map((score, index) =>
                f.uncertain_joints?.includes(index) ? 0 : score,
              ),
            },
            suitable: f.suitable,
          }
        : null;
  }
  $("overlay").innerHTML = skeleton(draw, report.width, report.height, {
    labels: $("labels").checked,
    labelScale: 1 / factor,
    leftEdge,
    rightEdge: leftEdge + viewWidth,
  });
}
new ResizeObserver(() => drawOverlay()).observe($("image-stage"));
$("labels").onchange = drawOverlay;
$("video").ontimeupdate = drawOverlay;
$("video").onseeked = drawOverlay;
function renderReport() {
  renderPeople();
  const p = report.people[person];
  $("observation-title").textContent = p
    ? `Person ${p.person_id} · ${report.kind === "video" ? "Movement" : labelView(p.view)}`
    : "No body detected";
  drawOverlay();
  if (!p) {
    $("report").innerHTML =
      `<div class="refusal"><h2>Analysis unavailable</h2><p>${esc(report.warnings.join(" "))}</p></div>`;
    clearWorld("No complete body was detected.");
    return;
  }
  showWorld(p.pose3d);
  if (report.kind === "video") {
    renderMovement(p);
    return;
  }
  const score = p.score?.value;
  const refused = !p.suitable
    ? `<div class="refusal"><h2>Posture analysis unavailable</h2><p>Insufficient visible body or an unsuitable pose. No measurements or score were produced.</p><ul>${[...new Set(p.validation.reasons)].map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>`
    : "";
  if (!p.suitable) {
    $("report").innerHTML =
      refused +
      `<div class="actions"><button id="download">Export refusal details</button></div>`;
    $("download").onclick = downloadReport;
    return;
  }
  $("report").innerHTML =
    `<div class="card result-heading"><div class="score"><b>${score == null ? "—" : Math.round(score)}</b><small>${score == null ? "NO SCORE" : "/ 100"}</small></div><div><p class="eyebrow">${p.mode === "standing" ? "IMAGE ALIGNMENT INDEX" : "EXERCISE POSE"}</p><h2>${p.suitable ? "A view of the available evidence" : "Capture needs attention"}</h2><p>${esc(labelView(p.view))} · ${esc(p.view_source)} · ${p.metrics.filter((m) => m.value != null).length} measurements</p><p>${score == null ? esc(p.score.reason) : "A transparent fitness rubric, based on the measured image angles."}</p></div><div class="actions"><button id="print">Print report</button><button id="download">Export JSON</button></div></div>
 <div class="card table-card"><table class="metric-table"><thead><tr><th>Measurement</th><th>Value</th><th>Evidence</th><th>Confidence</th></tr></thead><tbody>${p.metrics.map((m) => `<tr><td>${esc(m.name)}<small>${m.camera_views.length ? "View: " + esc(m.camera_views.map(labelView).join(" / ")) : "Not supported by this representation"}${m.scale_reference ? "<br>Ratio to " + esc(m.scale_reference.replaceAll("_", " ")) : ""}${m.reason ? "<br>" + esc(m.reason) : ""}</small></td><td class="value">${fmt(m.value, m.unit)}</td><td>${status(m.status)}</td><td>${m.value == null ? "—" : Math.round(m.confidence * 100) + "%"}<small>model score</small></td></tr>`).join("")}</tbody></table></div>
 <details class="card"><summary>How the score and suitability checks work</summary><p>${esc(p.score.formula)}</p><p>${p.score.checks.map((c) => esc(c.metric.replaceAll("_", " ")) + ": " + c.value.toFixed(1)).join(" · ") || "No contributing measurements."}</p><p>Visible core joints: ${p.validation.checks.visible_core_joints}/8 · Projected body chain: ${p.validation.checks.projected_body_chain_px}px</p><p>Thresholds are engineering heuristics, not validated clinical norms. A high model score does not prove anatomical correctness. Camera tilt changes alignment readings.</p></details><p class="fine-print">${esc(report.disclaimer)}</p>`;
  $("print").onclick = () => window.print();
  $("download").onclick = () => downloadReport();
}
function downloadReport() {
  const b = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = "motion-study-assessment.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function chart(series) {
  if (!series?.length) return "";
  const t0 = series[0][0],
    t1 = series.at(-1)[0];
  let lines = "",
    current = [];
  const emit = () => {
    if (current.length > 1)
      lines += `<polyline points="${current.join(" ")}" fill="none" stroke="#188775" stroke-width="2.5"/>`;
    current = [];
  };
  let last = null;
  for (const [t, v] of series) {
    if (v == null || (last != null && t - last > 0.6)) emit();
    if (v != null)
      current.push(
        `${45 + ((t - t0) / Math.max(0.1, t1 - t0)) * 610},${155 - (v / 180) * 130}`,
      );
    last = t;
  }
  emit();
  return `<svg class="chart" viewBox="0 0 690 185" role="img" aria-label="Joint angle over time; gaps indicate missing evidence">${[0, 90, 180].map((v) => `<line x1="45" y1="${155 - (v / 180) * 130}" x2="655" y2="${155 - (v / 180) * 130}" stroke="#dfe9e4"/><text x="8" y="${159 - (v / 180) * 130}" font-size="10" fill="#70827a">${v}°</text>`).join("")}${lines}<text x="45" y="176" font-size="10" fill="#70827a">${t0.toFixed(1)}s</text><text x="625" y="176" font-size="10" fill="#70827a">${t1.toFixed(1)}s</text></svg>`;
}
function renderMovement(p) {
  const signals = Object.entries(p.signals || {});
  $("report").innerHTML =
    `${!p.suitable ? `<div class="refusal"><h2>Movement analysis unavailable</h2><p>${esc(p.warnings.join(" "))}</p></div>` : ""}<div class="card movement-charts"><p class="eyebrow">MOVEMENT / PROJECTED ROM</p><h2>Follow the joint through time</h2><p class="fine-print">${Math.round(p.visible_fraction * 100)}% of tracked time has full-body evidence · Tracking churn ${report.tracking.churn} · ${report.sample_fps.toFixed(1)} analysed frames/s</p><div class="video-warning">Camera view: ${esc(labelView(report.view))}. These are image-plane angles, affected by depth and occlusion. No clinical reference or movement score is applied.</div>${signals.length ? '<label for="signal">Joint signal</label><select id="signal">' + signals.map(([k]) => `<option value="${k}">${esc(k.replaceAll("_", " "))}</option>`).join("") + '</select><div id="signal-report"></div>' : '<p class="muted">Try a closer, unobstructed camera view.</p>'}<div class="actions"><button id="download">Export JSON</button><button id="print">Print report</button></div></div><p class="fine-print">${esc(report.disclaimer)}</p>`;
  if (signals.length) {
    $("signal").onchange = () => {
      const s = p.signals[$("signal").value];
      $("signal-report").innerHTML =
        s.status === "unavailable"
          ? `<p>${esc(s.reason)}</p>`
          : `${chart(s.series)}<div class="stats"><div><b>${fmt(s.rom)}</b><span>Range of motion</span></div><div><b>${fmt(s.peak)}</b><span>Peak angle</span></div><div><b>${fmt(s.minimum)}</b><span>Minimum angle</span></div><div><b>${s.repetitions}</b><span>Complete cycles</span></div><div><b>${s.tempo_s ?? "—"}</b><span>Seconds per cycle</span></div></div><p class="fine-print">Model confidence: ${s.confidence == null ? "—" : Math.round(s.confidence * 100) + "%"} · Excluded angle jumps: ${s.rejected_spikes ?? 0} · Cycle ROM spread: ${fmt(s.rep_rom_sd)} · Tempo variation: ${s.tempo_cv == null ? "—" : (s.tempo_cv * 100).toFixed(1) + "%"} · ${s.continuous_segments} continuous segments. Trajectory deviation: ${p.trajectory_deviation_body_fraction ?? "—"} × projected body length.</p><p class="fine-print">${esc(s.reason)}</p><p class="fine-print">Paired left minus right mean angles: ${
              Object.entries(p.left_right_mean_angle_difference)
                .map(([k, v]) => esc(k) + " " + fmt(v))
                .join(" · ") || "Insufficient paired evidence."
            }</p>`;
    };
    $("signal").onchange();
  }
  $("download").onclick = downloadReport;
  $("print").onclick = () => window.print();
}
// Render only model-produced XYZ. No depth lift, template skeleton or body mesh.
let worldRenderer = null;
function clearWorld(reason) {
  $("world").hidden = true;
  $("world-empty").hidden = false;
  $("world-empty").innerHTML =
    `<span class="dimension">2D → 3D</span><h3>3D is unavailable.</h3><p>${esc(reason)}</p>`;
  $("world-controls").hidden = true;
  $("depth-status").className = "pill unavailable";
  $("depth-status").textContent = "UNAVAILABLE";
  $("world-note").textContent =
    "The original 2D landmarks remain the source of the measurements.";
}
function showWorld(pose) {
  if (!pose || pose.status !== "estimated" || !pose.joints) {
    clearWorld(pose?.reason || "No corroborated 3D estimate is available.");
    return;
  }
  if (!worldRenderer)
    worldRenderer = new PoseCanvas($("world"), $("world-stage"));
  $("world").hidden = false;
  $("world-empty").hidden = true;
  $("world-controls").hidden = false;
  $("depth-status").className = "pill estimated";
  $("depth-status").textContent = "ESTIMATED 3D";
  $("world-note").textContent = pose.reason;
  worldRenderer.set(pose);
}
document
  .querySelectorAll("[data-angle]")
  .forEach((b) => (b.onclick = () => worldRenderer?.angle(b.dataset.angle)));
async function loadHistory() {
  try {
    history = (await api("/evidence/history")).assessments || [];
    $("history-list").innerHTML = history.length
      ? history
          .slice(0, 8)
          .map(
            (h) =>
              `<div class="history-item"><strong>${esc(h.subject)}</strong><span>${esc(h.kind === "photo" ? "Photo assessment" : "Movement")}</span><span>${new Date(h.created_at).toLocaleString()}</span><button data-open="${h.id}">Open report ↗</button></div>`,
          )
          .join("")
      : '<p class="muted">Your first assessment will appear here.</p>';
    $("history-list")
      .querySelectorAll("button")
      .forEach((b) => (b.onclick = () => openSaved(b.dataset.open)));
    if (tab === "compare") {
      for (const id of ["before", "after"]) {
        const old = $(id).value;
        $(id).innerHTML = history
          .map(
            (h) =>
              `<option value="${h.id}">${esc(h.subject)} · ${esc(h.kind)} · ${new Date(h.created_at).toLocaleString()}</option>`,
          )
          .join("");
        if (history.some((h) => h.id === old)) $(id).value = old;
      }
      if (history.length > 1 && $("before").value === $("after").value)
        $("before").value = history[1].id;
      await comparisonOptions();
    }
  } catch (e) {
    $("history-list").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}
async function openSaved(id) {
  try {
    const data = await api("/evidence/detail?id=" + encodeURIComponent(id));
    chooseTab(data.report.kind === "video" ? "video" : "photo");
    report = data.report;
    report.assessment_id = id;
    person = 0;
    $("subject").value = data.subject;
    $("empty").hidden = true;
    const src = localImages.get(id);
    if (src) {
      const target = report.kind === "video" ? "video" : "photo";
      $(target).src = src;
      $(target).hidden = false;
    } else {
      $("photo").hidden = true;
      $("video").hidden = true;
      $("progress").textContent =
        "Original media was not stored. Showing the saved landmarks and measurements.";
    }
    renderReport();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    $("error").textContent = e.message;
  }
}
async function comparisonOptions() {
  for (const side of ["before", "after"]) {
    const id = $(side).value;
    if (!id) continue;
    const data = await api("/evidence/detail?id=" + encodeURIComponent(id));
    if (side === "before") beforeDetail = data;
    else afterDetail = data;
    $(side + "-person").innerHTML = data.report.people
      .map(
        (p) =>
          `<option value="${p.person_id}">Person ${p.person_id}${p.suitable ? "" : " · refused"}</option>`,
      )
      .join("");
  }
}
$("before").onchange = () =>
  comparisonOptions().catch(
    (e) => ($("compare-error").textContent = e.message),
  );
$("after").onchange = $("before").onchange;
$("compare").onclick = async () => {
  try {
    $("compare-error").textContent = "";
    if (!$("before").value || !$("after").value)
      throw new Error("Make two assessments first.");
    if ($("before").value === $("after").value)
      throw new Error("Choose two different assessments.");
    const result = await api("/evidence/compare", {
      before_id: $("before").value,
      after_id: $("after").value,
      before_person: $("before-person").value,
      after_person: $("after-person").value,
    });
    if (!result.comparable) {
      $("comparison-result").innerHTML =
        `<div class="refusal"><h2>These assessments cannot be compared</h2><p>${esc(result.reasons.join(" "))}</p></div>`;
      return;
    }
    const pictures = [
      ["Before", beforeDetail, $("before-person").value],
      ["After", afterDetail, $("after-person").value],
    ]
      .map(([name, d, id]) => {
        const p = d.report.people.find((p) => p.person_id === id);
        if (d.report.kind === "video") return "";
        const src = localImages.get(d.id);
        return `<div class="card"><h3>${name} · ${esc(d.subject)}</h3><svg viewBox="0 0 ${d.report.width} ${d.report.height}">${src ? `<image href="${esc(src)}" width="${d.report.width}" height="${d.report.height}"/>` : ""}${skeleton(p, d.report.width, d.report.height, { labels: false })}</svg><p class="fine-print">${src ? "Original photograph with saved landmarks" : "Original photograph not retained; saved landmark geometry shown."}</p></div>`;
      })
      .join("");
    $("comparison-result").innerHTML =
      `<div class="compare-images">${pictures}</div><div class="card table-card"><table class="metric-table"><thead><tr><th>Measurement</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${result.changes.map((c) => `<tr><td>${esc(c.name)}</td><td>${fmt(c.before, c.unit)}</td><td>${fmt(c.after, c.unit)}</td><td class="delta">${c.delta > 0 ? "+" : ""}${fmt(c.delta, c.unit)}</td></tr>`).join("") || '<tr><td colspan="4">No mutually available measurements.</td></tr>'}</tbody></table></div><p class="fine-print">Alignment index change: ${result.score_delta == null ? "Not comparable" : (result.score_delta > 0 ? "+" : "") + result.score_delta}. ${esc(result.note)}</p>`;
  } catch (e) {
    $("compare-error").textContent = e.message;
  }
};
function stopCamera() {
  if (recorder?.state === "recording") recorder.stop();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  clearTimeout(recordTimer);
}
$("camera").onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "environment",
      },
      audio: false,
    });
    $("camera-preview").srcObject = stream;
    $("camera-take").textContent =
      tab === "video" ? "Start recording" : "Capture photograph";
    $("camera-state").textContent = "";
    $("camera-dialog").showModal();
  } catch (e) {
    $("error").textContent = "Camera unavailable: " + e.message;
  }
};
$("camera-cancel").onclick = () => {
  discardRecording = true;
  stopCamera();
  $("camera-dialog").close();
};
$("camera-dialog").addEventListener("cancel", () => {
  discardRecording = true;
  stopCamera();
});
$("camera-take").onclick = () => {
  if (tab === "photo") {
    const v = $("camera-preview"),
      c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    if (!c.width) return;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob(
      (b) => useFile(new File([b], "camera-photo.jpg", { type: "image/jpeg" })),
      "image/jpeg",
      0.93,
    );
    stopCamera();
    $("camera-dialog").close();
    return;
  }
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  discardRecording = false;
  const parts = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(parts, { type: recorder.mimeType });
    if (!discardRecording)
      useFile(new File([blob], "camera-movement.webm", { type: blob.type }));
    stopCamera();
    $("camera-dialog").close();
  };
  recorder.start();
  $("camera-take").textContent = "Stop & use recording";
  $("camera-state").textContent =
    "Recording · one continuous movement. Recording stops at 2 minutes.";
  recordTimer = setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, 119000);
};
api("/evidence/capabilities")
  .then((c) => {
    $("connection").textContent = c.login_required
      ? "Authentication enabled"
      : c.deployment?.platform === "render"
        ? "Cloud analysis · no login"
        : "Local analysis · no login";
    $("depth").checked = c.three_d;
    if (!c.three_d)
      $("world-note").textContent =
        "Optional 3D model is not installed on this server.";
  })
  .catch(() => {
    $("connection").textContent = "Analysis server unavailable";
    $("error").textContent =
      "Start the Python application server to analyse media.";
  });
loadHistory();
