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
  spark,
  bindButtons,
  toast,
  download,
} from "./core.js";
import { PoseCanvas } from "../poseCanvas.js";
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
export async function report(root, id) {
  const item = await record("analyses", id);
  if (!state.client || state.client.id !== item.student_id) {
    go("report", { client: item.student_id, id });
    return;
  }
  const result = item.result;
  let viewIndex = 0,
    personIndex = 0,
    frameIndex = 0,
    section = "evidence",
    landmark = "5",
    signal = "left_shoulder";
  let poseCanvas = null;
  const coords = await api("coordinates?analysis_id=" + encodeURIComponent(id));
  const notes = state.client.notes.filter(
    (n) => n.analysis_id === id || !n.analysis_id,
  );
  const comparisons = state.client.analyses.filter(
    (a) =>
      a.id !== id &&
      a.kind === item.kind &&
      a.protocol === item.protocol &&
      a.demo === item.demo &&
      a.created_at < item.created_at,
  );
  root.innerHTML =
    head(
      item.kind === "movement" ? "Movement analysis" : "Posture analysis",
      `${state.client.name} · ${dt(item.created_at)} · ${item.protocol}`,
      `<button id="download-report">Export report</button>${state.me.role !== "student" ? '<button id="review-session" class="primary">Save reviewed session</button>' : ""}`,
    ) +
    notice(
      result.simulation_notice ||
        "Measurements come from visible pose landmarks. Depth is independently estimated only when confidence checks pass. A body model does not establish a diagnosis.",
    ) +
    `<div class="report-meta">${badge(item.demo ? "DEMO SIMULATION" : "UPLOADED MEDIA", item.demo ? "demo" : "")}${badge(item.status)}<span id="review-state">${item.detail.reviewed_at ? "Reviewed " + dt(item.detail.reviewed_at) : "Review the selected person and skeleton before planning."}</span></div><nav class="report-tabs">${[
      ["evidence", "Skeleton & posture"],
      ["coordinates", "Body coordinates"],
      ["movement", "Movement"],
      ["comparison", "Compare visits"],
      ["anatomy", "Anatomy"],
      ["coaching", "Coaching & program"],
    ]
      .map(([key, title]) => `<button data-section="${key}">${title}</button>`)
      .join("")}</nav><div class="filter-row">${select(
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
    personIndex = 0;
    frameIndex = 0;
    people();
    draw();
  };
  root.querySelector("[name=report-person]").onchange = (e) => {
    personIndex = +e.target.value;
    frameIndex = 0;
    draw();
  };
  function people() {
    const selected =
      item.detail.selected_people?.[result.views[viewIndex].view];
    if (selected != null) {
      const index = result.views[viewIndex].report.people.findIndex(
        (p) => String(p.person_id) === String(selected),
      );
      if (index >= 0) personIndex = index;
    }
    root.querySelector("[name=report-person]").innerHTML = options(
      result.views[viewIndex].report.people.map((p, i) => [
        i,
        "Person " +
          p.person_id +
          (p.suitable ? " · visible body" : " · needs capture"),
      ]),
      personIndex,
      null,
    );
  }
  people();
  if ($("#review-session"))
    $("#review-session").onclick = async () => {
      try {
        const p = result.views[viewIndex].report.people[personIndex];
        await api("review", {
          analysis_id: id,
          selection: { [result.views[viewIndex].view]: p.person_id },
        });
        $("#review-state").textContent =
          "Reviewed · saved to " + state.client.name;
        toast("Reviewed session saved to this client");
      } catch (e) {
        toast(e.message);
      }
    };
  function chosen() {
    return result.views[viewIndex].report.people[personIndex];
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
      raw = v.report,
      p = chosen();
    if (!p) {
      body.innerHTML = notice(
        "No person was detected. Use a clear full-body image or shorter video and try again.",
      );
      return;
    }
    if (section === "evidence") evidence(body, v, p);
    if (section === "coordinates") coordinateView(body, v, p);
    if (section === "movement") movement(body, v, p);
    if (section === "comparison") comparison(body, v, p);
    if (section === "anatomy") {
      const relevant = [
        ...new Set([
          ...(p.metrics || [])
            .filter((m) => m.value != null)
            .map((m) => metricRegion(m.name)),
          ...Object.entries(p.signals || {})
            .filter(([, s]) => s.rom != null)
            .map(([name]) => metricRegion(name)),
        ]),
      ];
      body.innerHTML =
        head(
          "From measurement to anatomy",
          "Choose a region to open its structures, linked scans and coach feedback.",
        ) +
        `<div class="grid three">${relevant.map((r) => card(regionName(r), `<p>${esc(state.me.regions.find((x) => x.id === r)?.explanation)}</p><a class="button primary" href="${href("client", { tab: "anatomy", region: r, id })}">Explore ${esc(regionName(r))}</a>`)).join("")}</div>`;
    }
    if (section === "coaching")
      body.innerHTML = `<div class="grid two">${card("Coach observations", notes.map((n) => `<article class="note"><a href="${href("client", { tab: "anatomy", region: n.region_id, id })}">${esc(regionName(n.region_id))}</a><p>${esc(n.text)}</p></article>`).join("") || notice("No session notes yet."))}${card("Plan the next practice", `<p>Review the observed region and select an exercise with your coach. The pipeline measures visible movement; it does not infer muscle weakness.</p>${state.client.programs.map((p) => `<a class="record-link" href="${href("program", { id: p.program_id })}">${esc(p.name)} →</a>`).join("")}${state.me.role !== "student" ? '<button data-edit="notes">+ Coaching note</button> <button id="targeted-program">Create targeted program</button>' : ""}`)}</div>`;
    bindButtons(body);
    if (section === "coaching") wireTargetedProgram(p);
  }
  function wireTargetedProgram(p) {
    const button = $("#targeted-program");
    if (!button) return;
    const regionIds = [
      ...new Set(
        (p.metrics || [])
          .filter((m) => m.value != null)
          .map((m) => metricRegion(m.name)),
      ),
    ];
    button.insertAdjacentHTML(
      "beforebegin",
      select(
        "Observed region to focus on",
        "program-region",
        state.me.regions.filter((r) => regionIds.includes(r.id)),
        regionIds[0],
        "Choose a region",
      ),
    );
    button.onclick = async () => {
      const q = params();
      q.set("region", $("[name=program-region]").value);
      history.replaceState(null, "", "#" + q);
      const { edit } = await import("./forms.js");
      edit("programs");
    };
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
    body.innerHTML = `${!p.suitable ? notice((p.warnings || []).join(" ") || "Insufficient visible body evidence. Retake this view; no measurements have been invented.") : ""}<div class="grid two">${card(synthetic ? "Scenario skeleton · simulated coordinates" : "Original capture & landmarks", `${framesControl(p)}<div class="evidence-canvas"><canvas id="skeleton" width="${raw.width || 640}" height="${raw.height || 960}" aria-label="Anatomically labelled body skeleton"></canvas></div><small>Anatomical left is the person’s left, regardless of screen position. Proxy landmarks are not detected vertebrae.</small>`)}${card("Estimated body representation", `<div class="pose-box"><canvas id="pose3d" aria-label="Rotatable estimated 3D skeleton"></canvas><p id="pose-empty" class="muted"></p></div><small>${synthetic ? "DEMO: parametric coordinates illustrate the scenario." : "Independent model estimate in metres. Drag to rotate; missing depth remains unavailable."}</small>`)}</div>${v.media_id ? card(synthetic ? "Generated scenario imagery · separate from simulated coordinates" : "Original media", synthetic ? `<div class="session-illustration"><img src="${mediaURL(v.media_id)}" style="left:${item.detail.panel ? "-100%" : "0"}" alt="Fictional client illustration · ${item.detail.panel ? "later visit" : "baseline visit"}"></div><small>${item.detail.panel ? "Later" : "Baseline"} scenario illustration, linked to this visit. It is not the source of the simulated measurements.</small>` : item.kind === "movement" ? `<video id="evidence-video" controls src="${mediaURL(v.media_id)}"></video>` : `<img class="source-photo" src="${mediaURL(v.media_id)}" alt="Original captured posture">`) : ""}${card(item.kind === "movement" ? "Observed joint range of motion" : "Posture & joint measurements", metricsTable(p.metrics || []))}`;
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
      ["Measurement", "Value", "Confidence", "Evidence / region"],
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
        `<div class="panel"><h3>${esc(labels[+landmark])}</h3><p>${esc(selected?.reason || "Unavailable for this frame.")}</p><p>${esc(selected?.method || "")}</p><a class="button" href="${href("client", { tab: "anatomy", region: selected?.region_id || metricRegion(labels[+landmark]), id })}">Explore this anatomical region</a></div><div class="grid three">${[
          "x",
          "y",
          "z",
        ]
          .map((axis) =>
            spark(
              trajectory.map((c) => [c.time, c[axis]]),
              {
                label: axis.toUpperCase() + " vs time (s)",
                unit: space === "image_px" ? "px" : "m",
              },
            ),
          )
          .join("")}</div>`;
      $("#coordinate-table").innerHTML = table(
        ["Landmark", "X", "Y", "Z", "Confidence", "Time / frame", "Status"],
        at.map((c) => [
          `<button class="text-button" data-landmark="${c.landmark_id}">${esc(c.name)}</button>`,
          coordinateNumber(c.x),
          coordinateNumber(c.y),
          coordinateNumber(c.z),
          c.confidence == null ? "—" : Math.round(c.confidence * 100) + "%",
          `${num(c.time)}s / ${c.frame_index}`,
          esc(item.demo && c.status !== "unavailable" ? "simulated" : c.status),
        ]),
      );
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
      body.innerHTML =
        notice(
          "Movement requires a video. Capture a repeated movement to obtain trajectories, velocity, acceleration and repetition analysis.",
        ) +
        `<a class="button primary" href="${href("capture")}">Record movement</a>`;
      return;
    }
    const signals = p.signals || {};
    if (!signals[signal]) signal = Object.keys(signals)[0];
    body.innerHTML = `<div class="filter-row">${select(
      "Joint angle signal",
      "movement-signal",
      Object.keys(signals).map((s) => [s, s.replaceAll("_", " ")]),
      signal,
      null,
    )}</div><div id="movement-charts"></div>`;
    function plots() {
      signal = body.querySelector("select").value;
      const s = signals[signal] || {},
        k = result.kinematics?.[p.person_id]?.signals?.[signal] || {};
      const peer = signal.startsWith("left_")
        ? "right_" + signal.slice(5)
        : signal.startsWith("right_")
          ? "left_" + signal.slice(6)
          : null;
      $("#movement-charts").innerHTML = `<div class="stats">${[
        ["Observed ROM", num(s.rom, "deg")],
        ["Complete cycles", s.repetitions ?? "—"],
        ["Mean speed", num(k.mean_speed_deg_s, "deg/s")],
        ["Mean acceleration", num(k.mean_acceleration_deg_s2, "deg/s²")],
        ["Tempo", num(s.tempo_s, "s")],
        ["Target deviation", num(k.target_deviation_deg, "deg")],
      ]
        .map(
          ([label, value]) =>
            `<div class="panel"><small>${label}</small><h2>${value}</h2></div>`,
        )
        .join(
          "",
        )}</div><div class="phase-track">${["start", "peak", "return"].map((phase) => `<span>${phase === "return" && !k.phases?.complete_cycle ? "END · return unverified" : phase.toUpperCase()}<b>${k.phases?.[phase] ? num(k.phases[phase][0]) + "s · " + num(k.phases[phase][1], "deg") : "Unavailable"}</b></span>`).join("")}</div><div class="grid two">${spark(s.series || [], { label: "Joint angle vs time (s)", unit: "deg" })}${spark(k.velocity || [], { label: "Angular velocity vs time (s)", unit: "deg/s" })}${spark(k.acceleration || [], { label: "Angular acceleration vs time (s)", unit: "deg/s²" })}${peer ? spark(signals[peer]?.series || [], { label: peer.replaceAll("_", " ") + " · compare opposite side", unit: "deg", color: "#59d1b1" }) : ""}</div>${card(
        "Repetition analysis",
        table(
          ["Cycle", "Start", "Return complete", "Range", "Out", "Return"],
          (s.cycles || []).map((r, i) => [
            i + 1,
            num(r.start, "s"),
            num(r.end, "s"),
            num(r.rom, "deg"),
            num(r.out_seconds, "s"),
            num(r.return_seconds, "s"),
          ]),
        ),
      )}<div class="grid two">${card("Consistency", `<p>Tempo variation: ${num(s.tempo_cv)}</p><p>Cycle ROM variation: ${num(s.rep_rom_sd, "deg")}</p><p>Angular speed variation: ${num(k.speed_variation, "deg/s")}</p><small>${esc(k.smoothness_label || "Available only with enough continuous evidence.")}</small>`)}${card(
        "Stability & symmetry",
        `<p>Hip-centre trajectory variation / body span: ${num(p.trajectory_deviation_body_fraction, "ratio")}</p><small>A camera-plane stability proxy, not true centre of mass or clinical balance.</small>${table(
          ["Paired signal", "Mean left − right"],
          Object.entries(p.left_right_mean_angle_difference || {}).map(
            ([k, v]) => [esc(k), num(v, "deg")],
          ),
        )}`,
      )}</div>${notice(s.reason || "No gaps are interpolated. Camera motion and perspective affect projected angles and pixel trajectories.")}`;
    }
    body.querySelector("select").onchange = plots;
    plots();
  }
  async function comparison(body, v, p) {
    body.innerHTML =
      select(
        "Previous comparable session",
        "previous",
        comparisons.map((a) => [a.id, date(a.created_at) + " · " + a.protocol]),
        comparisons[0]?.id,
        "Choose a session",
      ) + '<div id="comparison-detail"></div>';
    const compare = async () => {
      const value = body.querySelector("select").value;
      if (!value) {
        $("#comparison-detail").innerHTML = notice(
          "No other session with the same capture kind and protocol is available. Repeat the assessment to build a comparison.",
        );
        return;
      }
      const previous = await record("analyses", value);
      const previousView = previous.result.views.find((x) => x.view === v.view);
      const candidates =
        previousView?.report.people.filter((p) => p.suitable) || [];
      const selected = previous.detail.selected_people?.[v.view];
      const prev =
        selected != null
          ? candidates.find((p) => String(p.person_id) === String(selected))
          : candidates.length === 1
            ? candidates[0]
            : null;
      if (!prev) {
        $("#comparison-detail").innerHTML = notice(
          "Choose and review the correct person in the earlier session, using the same camera view, before comparing.",
        );
        return;
      }
      const currentMetrics =
        item.kind === "movement"
          ? Object.entries(p.signals || {}).map(([key, s]) => ({
              id: key,
              name: key.replaceAll("_", " ") + " ROM",
              value: s.rom,
              unit: "deg",
            }))
          : p.metrics;
      const priorMetrics =
        item.kind === "movement"
          ? Object.entries(prev.signals || {}).map(([key, s]) => ({
              id: key,
              value: s.rom,
            }))
          : prev.metrics;
      $("#comparison-detail").innerHTML =
        `<div class="grid two">${card("Previous · " + date(previous.created_at), '<canvas id="before-skeleton" width="640" height="960"></canvas>')}${card("Current · " + date(item.created_at), '<canvas id="after-skeleton" width="640" height="960"></canvas>')}</div>` +
        table(
          ["Measurement", "Previous", "Current", "Change"],
          currentMetrics.map((m) => {
            const before = priorMetrics.find((b) => b.id === m.id)?.value;
            return [
              esc(m.name),
              num(before, m.unit),
              num(m.value, m.unit),
              num(
                Number.isFinite(before) && Number.isFinite(m.value)
                  ? m.value - before
                  : null,
                m.unit,
              ),
            ];
          }),
        ) +
        notice(
          "Compare matching camera views and protocols. A change is an observation; it does not establish treatment effect.",
        );
      $("#before-skeleton").width = previousView.report.width || 640;
      $("#before-skeleton").height = previousView.report.height || 960;
      $("#after-skeleton").width = v.report.width || 640;
      $("#after-skeleton").height = v.report.height || 960;
      for (const [canvasId, analysis, view, person] of [
        ["before-skeleton", previous, previousView, prev],
        ["after-skeleton", item, v, p],
      ]) {
        const canvas = $("#" + canvasId);
        const landmarks = person.frames?.[0]?.landmarks || person.landmarks;
        drawSkeleton(canvas, landmarks);
        if (view.media_id && analysis.demo) {
          canvas.insertAdjacentHTML(
            "afterend",
            `<div class="session-illustration"><img src="${mediaURL(view.media_id)}" style="left:${analysis.detail.panel ? "-100%" : "0"}" alt="Generated imagery for this client's visit"></div><small>Generated scenario imagery · measurements above use separate simulated coordinates.</small>`,
          );
        } else if (view.media_id && analysis.kind === "posture") {
          const image = new Image();
          image.onload = () => drawSkeleton(canvas, landmarks, image);
          image.src = mediaURL(view.media_id);
        }
      }
    };
    body.querySelector("select").onchange = () =>
      compare().catch((e) => toast(e.message));
    await compare();
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
