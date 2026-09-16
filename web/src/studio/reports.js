import {
  $,
  esc,
  num,
  date,
  views,
  badge,
  card,
  chart,
  stat,
  empty,
  link,
  safeSource,
  localGet,
  download,
} from "./core.js";
import { PoseCanvas } from "../poseCanvas.js";
import { exerciseById } from "./exercises.js";
const bones = [
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
const names = {
  5: "L shoulder",
  6: "R shoulder",
  11: "L hip",
  12: "R hip",
  13: "L knee",
  14: "R knee",
};
export function skeleton(p, w, h, labels = true) {
  if (!p?.suitable || !p.landmarks) return "";
  const k = p.landmarks.keypoints,
    s = p.landmarks.scores,
    scale = Math.max(w, h) / 430;
  let out = "";
  for (const [a, b] of bones)
    if (s[a] >= 0.5 && s[b] >= 0.5)
      out += `<line x1="${k[a][0]}" y1="${k[a][1]}" x2="${k[b][0]}" y2="${k[b][1]}" stroke="#68efd5" stroke-width="${2 * scale}"/>`;
  k.forEach(([x, y], i) => {
    if (s[i] >= 0.5)
      out += `<circle cx="${x}" cy="${y}" r="${3 * scale}" fill="#68efd5" stroke="#0d383c" stroke-width="${scale}"/>`;
  });
  if (!labels) return out;
  const metrics = Object.fromEntries((p.metrics || []).map((m) => [m.id, m]));
  let lanes = { left: [], right: [] };
  for (const [idx, name] of Object.entries(names)) {
    const j = Number(idx);
    if (s[j] < 0.5) continue;
    const mid = (k[5][0] + k[6][0]) / 2;
    const m =
      metrics[
        j < 7
          ? "shoulder_tilt"
          : j < 13
            ? "pelvic_obliquity"
            : j === 13
              ? "left_knee_deviation"
              : "right_knee_deviation"
      ];
    lanes[k[j][0] < mid ? "left" : "right"].push({
      x: k[j][0],
      y: k[j][1],
      text:
        name +
        (m?.value != null
          ? " " + num((j === 6 || j === 12 ? -1 : 1) * m.value, m.unit)
          : ""),
    });
  }
  for (const [lane, items] of Object.entries(lanes)) {
    items.sort((a, b) => a.y - b.y);
    let last = -100;
    for (const a of items) {
      const ly = Math.max(
        Math.min(a.y, h - 12 * scale),
        last + 22 * scale,
        18 * scale,
      );
      last = ly;
      const tw = Math.min(112 * scale, w * 0.46),
        tx = lane === "left" ? 3 * scale : w - tw - 3 * scale;
      out += `<path d="M${a.x},${a.y} L${lane === "left" ? tx + tw : tx},${ly}" stroke="#74dacb" stroke-width="${scale}"/><rect x="${tx}" y="${ly - 10 * scale}" width="${tw}" height="${19 * scale}" rx="${3 * scale}" fill="#071b30" fill-opacity=".94"/><text x="${tx + 4 * scale}" y="${ly + 3 * scale}" font-size="${9 * scale}" fill="#c5f7ee" font-family="system-ui">${esc(a.text)}</text>`;
    }
  }
  return out;
}
export async function photoPanel(
  report,
  v,
  personIndex = 0,
  { labels = true, key = "" } = {},
) {
  const p = v?.report?.people?.[personIndex],
    raw = await localGet(`${key}:media:${report.id}:${v?.view}`);
  let image = raw?.data || raw;
  if (image instanceof Blob) image = URL.createObjectURL(image);
  const demo = report.demo && v?.image;
  const w = v?.report?.width || 400,
    h = v?.report?.height || 700;
  const visual = demo
    ? `<div class="demo-panel"><img src="${esc(v.image.src)}" alt="Generated illustrative ${esc(views[v.view])} posture photograph" style="left:${-v.image.panel * 100}%"></div>`
    : image
      ? `<img src="${esc(image)}" alt="Original ${esc(views[v.view])} capture">`
      : "";
  return `<div class="photo-frame">${visual ? `<div class="photo-stage" style="--ratio:${demo ? "384 / 1024" : `${w} / ${h}`}">${visual}${!demo ? `<svg viewBox="0 0 ${w} ${h}" aria-label="Detected body landmarks and anatomical side labels">${skeleton(p, w, h, labels)}</svg>` : ""}</div>` : empty("Original photo not on this device", "Photos are kept in the browser used for capture. The saved measurements remain available.")}</div><div class="photo-caption"><span>${esc(views[v?.view] || "Camera view")} · ${demo ? "Generated sample photo" : `Person ${personIndex + 1}`}</span>${badge(demo ? "Illustration" : p?.suitable ? "Landmarks measured" : "Capture needs review", demo ? "demo" : p?.suitable ? "green" : "amber")}</div><p class="subtle">${demo ? "This generated photo illustrates the capture workflow. The demo trend values are synthetic and were not measured from this image." : "L / R mean the person’s anatomical left and right. Side-view angles are projected onto the photograph."}</p>`;
}
export const metricsTable = (metrics) =>
  `<div class="table-wrap"><table><thead><tr><th>Region / measurement</th><th>View</th><th>Value</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>${metrics.map((m) => `<tr><td><strong>${esc(m.name || m.id?.replaceAll("_", " "))}</strong><br><small>${esc(m.region)}</small></td><td>${esc(views[m.view] || m.view || "—")}</td><td>${num(m.value, m.unit)}</td><td>${m.value != null && m.confidence != null ? Math.round(m.confidence * 100) + "%" : "—"}</td><td>${badge(m.status || "unavailable", m.status === "measured" ? "green" : m.status === "demo" ? "demo" : "amber")}<details><summary>Details</summary><p style="white-space:normal;max-width:350px">${esc(m.reason || m.source || "Projected image measurement. Camera angle affects the result.")} ${m.views ? "Required view: " + esc(m.camera_views.join(", ")) : ""}</p></details></td></tr>`).join("")}</tbody></table></div>`;
function recommendations(report) {
  const rows = report.summary?.recommendations || [];
  return rows.length
    ? rows
        .map((r) => {
          const exercise = (r.exercise_ids || [])
            .map(exerciseById)
            .find((e) => e?.image);
          return `<div class="recommendation">${exercise ? `<img src="/assets/studio/${exercise.image}" alt="Generated ${esc(exercise.name)} exercise illustration">` : ""}<div><h4>${esc(r.title)}</h4><p>${esc(r.reason)}</p><div class="actions" style="margin-top:10px">${safeSource(r.source)}${link("Build a program", "programs")}</div></div></div>`;
        })
        .join("")
    : empty(
        "Choose a plan with your coach",
        "Review the captured movement, comfortable range and personal goals before selecting exercises.",
        link("Exercise library", "library"),
      );
}
export async function renderReport(report, ctx) {
  const { key, state } = ctx;
  let viewIndex = 0,
    personIndex = 0,
    active = "summary",
    world = null;
  const client = state.clients.find((c) => c.id === report.client_id),
    allVisits = state.reports
      .filter((r) => r.client_id === report.client_id && r.kind === report.kind)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  $("#app").innerHTML =
    `<div class="page-head"><div><p class="eyebrow">${report.demo ? "INVESTOR DEMONSTRATION" : "ASSESSMENT REPORT"}</p><h1>${esc(report.client_name || client?.name || "Assessment")}</h1><p>${date(report.created_at)} · ${report.kind === "movement" ? "Movement analysis" : "Posture & alignment"} · ${esc(report.id.slice(0, 12))}</p></div><div class="actions"><button id="export-report">Export data</button><button id="print-report">Print / save PDF</button>${link("Compare visits", `compare/${report.client_id}`, "primary")}</div></div><div class="print-only">${report.demo ? "SYNTHETIC DEMONSTRATION — fictional client and measurements. Generated sample imagery. No clinical outcomes are claimed." : "Image evidence report · not a medical diagnosis"}</div><div class="report-tabs">${[
      ["summary", "Overview"],
      ["photos", "Photos & measurements"],
      ["movement", "Movement / ROM"],
      ["body", "3D & anatomy"],
      ["plan", "Plan & habits"],
      ["notes", "Coach review"],
    ]
      .map(
        ([id, label]) =>
          `<button data-report-tab="${id}" class="${id === active ? "active" : ""}">${label}</button>`,
      )
      .join("")}</div><div id="report-content"></div>`;
  $("#export-report").onclick = () =>
    download(`motion-yoga-${report.id}.json`, report);
  $("#print-report").onclick = async () => {
    if (active === "notes") {
      active = "summary";
      await render();
    }
    window.print();
  };
  async function render() {
    world?.dispose?.();
    world = null;
    const v = report.views[viewIndex],
      p = v?.report?.people?.[personIndex],
      summary = report.summary || {};
    const metrics = (p?.metrics || []).map((m) => ({ ...m, view: v.view }));
    const validMetrics = metrics.filter((m) => m.value != null);
    const select = `<div class="filterbar"><label>Camera view<select id="report-view">${report.views.map((v, i) => `<option value="${i}" ${i === viewIndex ? "selected" : ""}>${esc(views[v.view])}</option>`).join("")}</select></label><label>Person<select id="report-person">${(v?.report?.people || []).map((p, i) => `<option value="${i}" ${i === personIndex ? "selected" : ""}>Person ${i + 1} · ${p.suitable ? "visible body" : "review capture"}</option>`).join("") || "<option>No person detected</option>"}</select></label></div>`;
    let body = "";
    if (active === "summary") {
      const count = (summary.metrics || []).filter(
        (m) => m.value != null,
      ).length;
      body = `<div class="stats">${stat(summary.score_label || "Image alignment index", num(summary.score), report.demo ? "Synthetic trend" : "Transparent image-based rubric", "reports")}${stat("Views captured", `${summary.complete_views ?? 0} / ${report.views.length}`, "Full-body evidence", "capture")}${stat("Available measurements", count, "Across captured views", "compare")}${stat("Visit history", allVisits.length, "Saved assessments", "timeline")}</div><div class="grid cols-3"><section class="card"><div class="card-head"><h3>Capture evidence</h3>${badge(report.demo ? "Sample" : "Original", report.demo ? "demo" : "green")}</div>${report.kind === "posture" ? await photoPanel(report, v, 0, { key }) : `<p class="muted">Movement captured from the ${esc(views[v.view])?.toLowerCase()} view.</p><div class="section-space">${link("Review joint traces", `report/${report.id}`)}</div><div class="notice">Open Movement / ROM above for tracked frames, range, repetitions, tempo and confidence.</div>`}</section><section class="card"><div class="card-head"><h3>Regional review</h3>${badge("Evidence first")}</div>${(summary.findings || []).length ? summary.findings.map((f) => `<div class="finding"><span class="dot"></span><div><h4>${esc(f.region)}</h4><p>${esc(f.text)}</p><small>${esc(f.source)}</small></div></div>`).join("") : empty(report.kind === "movement" ? "Review the captured movement" : "Review the available measurements", report.kind === "movement" ? "Select a joint in Movement / ROM for the available evidence." : "Open Photos & measurements for the full ledger. Only supported measurements contribute to the index.")}<div class="notice">${report.demo ? "Synthetic values show how a long-term record can look." : "These observations describe the image. They do not establish pain, injury, muscle weakness or a diagnosis."}</div></section>${card(
        "Change over time",
        chart(
          allVisits.map((r) => r.summary?.score),
          {
            labels: allVisits.map((r) =>
              new Date(r.created_at).toLocaleDateString("en-US", {
                month: "short",
              }),
            ),
          },
        ) +
          `<p class="subtle">${report.demo ? "Illustrative longitudinal alignment trend." : "Only compare repeatable camera views and protocols. The index is a product rubric, not a validated clinical score."}</p><div class="section-space">${link("Compare two visits", `compare/${report.client_id}`)}</div><div class="section-space">${card("Body measurements", `<div class="inline-value"><span>Height</span><b>${num(report.body?.height_cm ?? client?.height_cm, "cm")}</b></div><div class="inline-value"><span>Weight</span><b>${num(report.body?.weight_kg ?? client?.weight_kg, "kg")}</b></div><p class="subtle">${report.demo ? "Simulated manual/device values." : "Coach-entered measurements; not inferred from photographs."}</p>`)}</div>`,
      )}</div><div class="grid cols-2 section-space">${card("Practice recommendations", recommendations(report))}${card("What this capture cannot establish", `<div class="notice">A useful report separates visible evidence from information that needs a different assessment.</div>${(summary.unavailable || ["Clinical diagnosis", "Internal anatomy or muscle activation", "True 3D joint range from monocular video"]).map((x) => `<div class="list-row">${esc(x)}${badge("Unavailable", "amber")}</div>`).join("")}<div class="section-space">${link("Explore reference anatomy", "anatomy")}${link("X-ray records", "xray")}</div>`)}</div>`;
    }
    if (active === "photos") {
      body =
        report.kind !== "posture"
          ? empty(
              "This is a movement recording",
              "Open Movement / ROM to review its tracked frames.",
            )
          : select +
            `<div class="grid cols-2">${card("Original photograph + landmarks", await photoPanel(report, v, personIndex, { key }))}${card("View-specific findings", p?.suitable ? `<div class="metric-grid">${validMetrics.map((m) => `<div class="metric"><h4>${esc(m.name)}</h4><strong>${num(m.value, m.unit)}</strong>${badge(m.status, m.status === "demo" ? "demo" : "green")}<small>${m.confidence == null ? "" : Math.round(m.confidence * 100) + "% model confidence"}</small></div>`).join("")}</div><details class="section-space"><summary>How the alignment index is calculated</summary><p>${esc(p.score?.formula || p.score?.reason || "Synthetic demonstration index")}</p></details>` : `<div class="notice error"><h3>Posture analysis unavailable</h3><p>${esc(p?.refusal || "No complete person was detected.")}</p><ul>${(p?.validation?.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>${link("Retake this view", "capture", "primary")}`)}</div>${card("Measurement ledger", metricsTable(metrics))}`;
    }
    if (active === "movement") {
      if (report.kind === "movement") {
        body =
          select +
          `<div class="grid cols-2">${card("Recording & tracked evidence", '<div id="video-evidence"></div>')}${card(
            "Joint motion",
            `<label>Joint signal<select id="signal">${Object.entries(
              p?.signals || {},
            )
              .map(
                ([id]) =>
                  `<option value="${esc(id)}">${esc(id.replaceAll("_", " "))}</option>`,
              )
              .join("")}</select></label><div id="joint-report"></div>`,
          )}</div><div class="notice">Projected 2D angles depend on camera view, depth and occlusion. Gaps remain gaps; no clinical range or exercise-quality score is invented.</div>`;
      } else if (report.demo) {
        const m = report.mobility_demo || {};
        body = card(
          "Illustrative movement history",
          `<div class="notice">These are synthetic sample values to demonstrate the longitudinal dashboard. They were not measured from the generated photos and are not clinical norms.</div><div class="stats">${["shoulder", "hip", "knee", "ankle"].map((j) => stat(j[0].toUpperCase() + j.slice(1) + " range", num(m[j], "deg"), "Synthetic movement example")).join("")}</div>${chart(
            allVisits.map((r) => r.mobility_demo?.shoulder),
            {
              labels: allVisits.map((r) =>
                new Date(r.created_at).toLocaleDateString("en-US", {
                  month: "short",
                }),
              ),
              unit: "deg",
            },
          )}${link("Analyze a real video", "capture/movement", "primary")}`,
        );
      } else
        body = empty(
          "Add movement to this assessment",
          "Upload a short front or side video to measure joint range, complete cycles, tempo and left/right differences.",
          link("Upload a video", "capture/movement", "primary"),
        );
    }
    if (active === "body") {
      body =
        select +
        `<div class="grid cols-2">${card("Photo evidence", report.kind === "posture" ? await photoPanel(report, v, personIndex, { key }) : '<p class="muted">Use Movement / ROM for video evidence.</p>')}${card("Estimated body coordinates", p?.pose3d?.status === "estimated" ? '<div id="pose-wrap" style="height:430px"><canvas id="pose-canvas"></canvas></div><p class="subtle">Drag to rotate the model-produced coordinates. Depth is estimated and is not used as a clinical measurement.</p>' : `<div class="empty"><h3>3D estimate unavailable</h3><p>${esc(p?.pose3d?.reason || "This capture does not support a reliable 3D estimate.")}</p></div>`)}</div><div class="section-space">${card("Explore the anatomy reference", `<p class="muted" style="font-size:12px">Inspect the existing detailed 3D muscles, bones, nerves and joints. This is a general anatomical reference, separate from the person’s estimated pose.</p><div class="section-space">${link("Open interactive anatomy", "anatomy", "primary")}</div>`)}</div>`;
    }
    if (active === "plan") {
      body = `<div class="grid cols-2">${card("Recommendations to discuss", recommendations(report))}${card("A repeatable next assessment", `<div class="finding"><span class="dot"></span><div><h4>Same views, same setup</h4><p>Keep the camera level, include head to feet, and repeat the same relaxed stance and movement protocol.</p></div></div><div class="finding"><span class="dot"></span><div><h4>Record how it feels</h4><p>Add comfort, fatigue and personal goals to a coach note. Photos cannot measure these experiences.</p></div></div><div class="finding"><span class="dot"></span><div><h4>Choose a comfortable practice</h4><p>A coach can adjust support, repetitions and range. Stop an exercise if it causes pain.</p></div></div>${link("Create a coaching note", `notes/${report.client_id}`, "primary")}`)}</div><div class="section-space">${card("Daily practice habits", `<div class="habit-grid"><div class="habit"><h4>Change position regularly</h4><p>Build comfortable movement breaks into a routine that works for you.</p></div><div class="habit"><h4>Keep the practice manageable</h4><p>Use a small, consistent sequence and review progress with your coach.</p></div><div class="habit"><h4>Track context as well as angles</h4><p>Note camera setup, activity, comfort and changes in the practice plan.</p></div></div>`)}</div>`;
    }
    if (active === "notes") {
      const notes = state.notes.filter((n) => n.client_id === report.client_id);
      body = card(
        "Coach notes & follow-up",
        `${link("Add note", `notes/${report.client_id}`, "primary")}<div class="section-space">${
          notes.length
            ? notes
                .slice(0, 10)
                .map(
                  (n) =>
                    `<article class="event"><div class="event-head"><h4>${esc(n.title)}</h4><small>${date(n.date)}</small></div><p>${esc(n.text)}</p><p class="subtle">Goal: ${esc(n.goal)} · Follow-up: ${date(n.followup)}</p></article>`,
                )
                .join("")
            : empty(
                "No coach notes yet",
                "Add personal goals, movement comfort and an agreed next step.",
              )
        }</div>`,
      );
    }
    $("#report-content").innerHTML = body;
    if ($("#report-view"))
      $("#report-view").onchange = (e) => {
        viewIndex = Number(e.target.value);
        personIndex = 0;
        render();
      };
    if ($("#report-person"))
      $("#report-person").onchange = (e) => {
        personIndex = Number(e.target.value);
        render();
      };
    if ($("#pose-canvas")) {
      world = new PoseCanvas($("#pose-canvas"), $("#pose-wrap"), {
        dark: true,
      });
      world.set(p.pose3d);
    }
    if ($("#joint-report")) {
      const update = () => {
        const s = p?.signals?.[$("#signal").value];
        $("#joint-report").innerHTML =
          !s || s.status === "unavailable"
            ? empty(
                "Signal unavailable",
                s?.reason ||
                  p?.warnings?.join(" ") ||
                  "Not enough continuous visible body evidence.",
              )
            : `${chart(
                s.series.map((x) => x[1]),
                {
                  unit: "deg",
                  labels: s.series.map(([t], i) =>
                    i % Math.max(1, Math.ceil(s.series.length / 5)) === 0
                      ? num(t) + "s"
                      : "",
                  ),
                },
              )}<div class="stats" style="grid-template-columns:repeat(3,1fr)">${stat("Range", num(s.rom, "deg"), "Image plane")}${stat("Peak", num(s.peak, "deg"), "Smoothed maximum")}${stat("Minimum", num(s.minimum, "deg"), "Smoothed minimum")}${stat("Cycles", s.repetitions, "Complete cycles")}${stat("Tempo", num(s.tempo_s, "s"), "Per complete cycle")}${stat("Confidence", s.confidence == null ? "—" : Math.round(s.confidence * 100) + "%", "Accepted landmarks")}</div><p class="subtle">Cycle ROM spread: ${num(s.rep_rom_sd, "deg")} · Tempo variation: ${num(s.tempo_cv == null ? null : s.tempo_cv * 100, "%")} · Excluded jumps: ${s.rejected_spikes ?? 0} · Continuous segments: ${s.continuous_segments ?? 0}</p><p class="subtle">${esc(s.reason)}</p><p class="subtle">Left minus right mean angle: ${
                Object.entries(p.left_right_mean_angle_difference || {})
                  .map(([k, v]) => esc(k) + " " + num(v, "deg"))
                  .join(" · ") || "Insufficient paired evidence."
              }</p><p class="subtle">Trajectory deviation: ${p.trajectory_deviation_body_fraction == null ? "—" : p.trajectory_deviation_body_fraction.toFixed(3)} × body length. ${Math.round((p.visible_fraction || 0) * 100)}% full-body visibility.</p>`;
      };
      $("#signal").onchange = update;
      update();
      const blob = await localGet(`${key}:media:${report.id}:video`);
      if (blob) {
        const src = URL.createObjectURL(blob);
        $("#video-evidence").innerHTML =
          `<div style="position:relative"><video id="report-video" controls src="${src}" playsinline></video><svg id="video-overlay" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none" viewBox="0 0 ${v.report.width} ${v.report.height}"></svg></div><p class="subtle">Markers show the nearest sampled frame, only within 0.2 seconds. Move through the video to inspect the evidence.</p>`;
        const video = $("#report-video");
        video.ontimeupdate = () => {
          let f = (p.frames || []).reduce(
            (best, f) =>
              !best ||
              Math.abs(f.time - video.currentTime) <
                Math.abs(best.time - video.currentTime)
                ? f
                : best,
            null,
          );
          $("#video-overlay").innerHTML =
            f && Math.abs(f.time - video.currentTime) < 0.2
              ? skeleton(
                  { ...f, suitable: f.suitable ?? f.valid },
                  v.report.width,
                  v.report.height,
                  false,
                )
              : "";
        };
      } else
        $("#video-evidence").innerHTML = empty(
          "Video is stored on the capture device",
          "Joint measurements and traces are preserved in this report.",
        );
    }
  }
  for (const b of document.querySelectorAll("[data-report-tab]"))
    b.onclick = () => {
      active = b.dataset.reportTab;
      document
        .querySelectorAll("[data-report-tab]")
        .forEach((x) => x.classList.toggle("active", x === b));
      render();
    };
  await render();
}
