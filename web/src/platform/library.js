import {
  state,
  api,
  toast,
  modal,
  list,
  record,
  href,
  esc,
  field,
  select,
  head,
  card,
  notice,
  date,
  num,
  spark,
  regionName,
  bindButtons,
  exerciseIllustration,
} from "./core.js";
import { cameraLabels, metricCopy } from "./explain.js";
const categories = [
  "Yoga",
  "Pilates",
  "Mobility",
  "Flexibility",
  "Core",
  "Spine",
  "Shoulder",
  "Hip",
  "Knee",
  "Ankle",
  "Balance",
  "Breathing",
  "Recovery",
  "Strength",
  "Warm-up",
  "Cooldown",
  "Posture",
];
// Only compare observations captured after this assignment began with the
// same measurement, protocol and source type. The metric contains the camera
// view, so a front photograph cannot be pooled with a side photograph.
export function comparableProgramMeasurements(client, assignment, program) {
  const startedOn = String(assignment?.starts_on || program?.detail?.start_date || "").slice(0, 10);
  const sources = new Map((client.analyses || []).map((analysis) => [analysis.id, analysis]));
  const grouped = new Map();
  for (const row of client.progress || []) {
    const source = sources.get(row.analysis_id);
    const observedOn = String(row.recorded_at || "").slice(0, 10);
    if (!source || !/^\d{4}-\d{2}-\d{2}$/.test(observedOn) ||
        !Number.isFinite(Date.parse(row.recorded_at)) ||
        (startedOn && observedOn < startedOn) || !Number.isFinite(row.value) || !row.metric) continue;
    const key = [source.demo ? "demo" : "capture", source.kind, source.protocol, row.metric, row.unit].join("\u001f");
    if (!grouped.has(key)) grouped.set(key, {metric: row.metric, kind: source.kind, protocol: source.protocol,
      demo: Boolean(source.demo), unit: row.unit || "", rows: []});
    grouped.get(key).rows.push(row);
  }
  const targets = (program?.detail?.target_region_ids?.length
    ? program.detail.target_region_ids : [program?.region_id]).filter(Boolean);
  return [...grouped.values()].map((series) => {
    series.rows.sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
    series.first = series.rows[0];
    series.latest = series.rows.at(-1);
    series.targetMatch = targets.some((id) => series.metric.includes(id) ||
      series.metric.includes(id.replace(/^(left|right|both)_/, "")));
    return series;
  }).sort((a, b) =>
    Number(b.rows.length > 1) - Number(a.rows.length > 1) ||
    Number(b.targetMatch) - Number(a.targetMatch) ||
    Number(b.metric.endsWith("_rom")) - Number(a.metric.endsWith("_rom")) ||
    String(b.latest.recorded_at).localeCompare(String(a.latest.recorded_at))
  );
}
export async function library(root, collection = "exercises", own = false) {
  const exercises = collection === "exercises";
  if (!exercises && state.client && !own) return clientProgramWorkspace(root);
  root.innerHTML =
    head(
      own ? "My content" : exercises ? "Exercise repertoire" : "Programs",
      state.client && !exercises
        ? "Assigned to " + state.client.name
        : "Search the full repertoire and open a movement to review its instructions, media and anatomy.",
      state.me.role === "student"
        ? ""
        : `<button data-edit="${collection}" class="primary">+ ${exercises ? "Exercise" : "Program"}</button>`,
    ) +
    `<div class="filter-row">${field("Search repertoire", "repertoire-search")}${
      exercises
        ? select(
            "Category",
            "category",
            categories.map((c) => [c, c]),
            "",
            "All categories",
          )
        : ""
    }${select("Body region", "region", state.me.regions, "", "All regions")}</div><p id="repertoire-count" role="status"></p><div class="exercise-grid" id="repertoire-list"></div><div class="actions"><button id="repertoire-prev">Previous page</button><button id="repertoire-next">Next page</button></div>`;
  let offset = 0,
    version = 0,
    timer;
  const size = 24,
    find = (s) => root.querySelector(s);
  async function draw() {
    const current = ++version;
    find("#repertoire-count").textContent = "Loading repertoire…";
    try {
      const result = await list(collection, {
        limit: size,
        offset,
        q: find("[name=repertoire-search]").value,
        region: find("[name=region]").value,
        ...(exercises ? { category: find("[name=category]").value } : {}),
        ...(own ? { own: 1 } : {}),
        ...(!exercises && state.client ? { student_id: state.client.id } : {}),
      });
      if (current !== version || !root.isConnected) return;
      find("#repertoire-list").innerHTML =
        result.items
          .map(
            (e) =>
              `<a class="exercise-card" href="${href(exercises ? "exercise" : "program", { id: e.id })}">${exerciseIllustration(e)}<div class="exercise-tag">${esc(exercises ? e.category : "Program")} · ${esc(e.difficulty || e.detail.difficulty || "Coach adapted")}</div><h3>${esc(e.name)}</h3><p>${esc(e.detail.description || e.goal || "Coach-authored practice")}</p><small>${esc(regionName(e.region_id))} · ${esc(e.detail.equipment_type || e.detail.frequency || "")}</small><span>${exercises ? "Instructions, media & anatomy" : "Open sequence"} →</span></a>`,
          )
          .join("") || notice("No matches. Change the search or filters.");
      find("#repertoire-count").textContent =
        `${result.total} ${exercises ? "exercises" : "programs"} · ${result.total ? offset + 1 : 0}–${Math.min(offset + size, result.total)} shown`;
      find("#repertoire-prev").disabled = offset === 0;
      find("#repertoire-next").disabled = offset + size >= result.total;
    } catch (e) {
      if (current === version)
        find("#repertoire-count").textContent = e.message;
    }
  }
  find("#repertoire-prev").onclick = () => {
    offset = Math.max(0, offset - size);
    draw();
  };
  find("#repertoire-next").onclick = () => {
    offset += size;
    draw();
  };
  root.querySelectorAll("input,select").forEach(
    (el) =>
      (el.oninput = () => {
        offset = 0;
        clearTimeout(timer);
        timer = setTimeout(draw, 200);
      }),
  );
  state.dispose.push(() => {
    ++version;
    clearTimeout(timer);
  });
  bindButtons(root);
  await draw();
}

const programUnitNames = {
  deg: "degrees (°)",
  ratio: "ratio (unitless)",
  cycles: "completed movement cycles",
};

export function programMeasurementCopy(entry) {
  const [camera = "", id = ""] = String(entry.metric || "").split(":");
  const name = id.replace(/_rom$/, " range of motion").replaceAll("_", " ");
  const kind = entry.kind === "movement" ? "movement video" : "posture photograph";
  const cameraName = cameraLabels[camera] || camera.replaceAll("_", " ") || "Recorded view";
  const origin = entry.demo
    ? "Simulated pose coordinates in a labelled demo scenario. Sample imagery is illustrative and was not measured."
    : `Accepted visible pose landmarks from the uploaded ${kind}.`;
  let definition = metricCopy({ id, name }).definition;
  let meaning = "A difference means this camera-plane measurement changed between comparable captures; it does not by itself show benefit, harm or a diagnosis.";
  if (id.endsWith("_rom")) {
    meaning = "A larger value means the recorded joint angle swept through a wider visible range; a smaller value means a narrower sweep. Neither is automatically better.";
  } else if (id.endsWith("_tempo_cv")) {
    definition = "Variation in detected repetition durations divided by their average duration.";
    meaning = "A smaller ratio means the detected repetitions took more similar amounts of time; a larger ratio means more timing variation. This does not measure movement quality by itself.";
  } else if (id.endsWith("_rep_rom_sd")) {
    definition = "The spread of the measured angle range across detected repetitions.";
    meaning = "A smaller number means the detected repetitions used more similar visible ranges; a larger number means their ranges varied more. This is not a strength score.";
  } else if (id.endsWith("_repetitions")) {
    definition = "Number of complete movement cycles detected in the accepted video frames.";
    meaning = "A larger number means more complete cycles were detected in that clip. It does not indicate better form or a larger joint range.";
  }
  return {
    name,
    definition,
    source: `${entry.protocol || "Recorded assessment"} · ${cameraName} · ${origin}`,
    unit: programUnitNames[entry.unit] || entry.unit || "unitless value",
    meaning,
  };
}

export function programProgressCard(client, assignment, program) {
  const startedOn = assignment?.starts_on || program.detail?.start_date;
  const series = comparableProgramMeasurements(client, assignment, program);
  const paired = series.filter((entry) => entry.rows.length > 1);
  const selected = paired.slice(0, 2);
  const progressLink = href("client", {client: client.id, tab: "progress",
    ...(selected[0] ? {metric: selected[0].metric} : {})});
  let body = `<p>From ${esc(date(startedOn))}. Each trace uses one measurement, capture protocol, camera view and source type. Changes describe the recorded movement or posture; they do not prove the program caused them.</p>`;
  if (selected.length) {
    body += `<div class="grid two">${selected.map((entry) => {
      const copy = programMeasurementCopy(entry);
      const delta = entry.latest.value - entry.first.value;
      const points = entry.rows.map((row) => [new Date(row.recorded_at).getTime(), row.value]);
      const direction = delta === 0 ? "stayed the same" : delta > 0 ? "increased" : "decreased";
      return `<article class="panel"><h4>${esc(copy.name)}</h4><p class="muted">${esc(entry.rows.length)} matching assessments since this plan began</p><dl><div><dt>Before · ${esc(date(entry.first.recorded_at))}</dt><dd>${esc(num(entry.first.value, entry.unit))}</dd></div><div><dt>Latest · ${esc(date(entry.latest.recorded_at))}</dt><dd>${esc(num(entry.latest.value, entry.unit))}</dd></div></dl><p><strong>Measured change:</strong> ${esc(num(Math.abs(delta), entry.unit))} ${direction} from the first to latest assessment.</p><p><strong>What is measured:</strong> ${esc(copy.definition)}</p><p><strong>Source:</strong> ${esc(copy.source)}</p><p><strong>Unit:</strong> ${esc(copy.unit)}</p><p><strong>What the change means:</strong> ${esc(copy.meaning)}</p>${spark(points, {label: copy.name, unit: entry.unit, xLabel: (value) => date(new Date(value))})}<div class="actions"><a href="${href("client", {client: client.id, tab: "sessions", assessment: entry.first.analysis_id})}">Open before assessment</a><a href="${href("client", {client: client.id, tab: "sessions", assessment: entry.latest.analysis_id})}">Open latest assessment</a></div></article>`;
    }).join("")}</div>`;
  } else if (series.length) {
    body += notice("One matching measurement was recorded since this plan began. Repeat the same capture setup to see a comparison.") +
      `<a class="button" href="${href("client", {client: client.id, tab: "sessions", assessment: series[0].latest.analysis_id})}">Open source session →</a>`;
  } else {
    body += notice("No measured assessment has been recorded since this plan began. A future capture with the same setup will create a comparable trend.");
  }
  return card("Measured progress since program start", body +
    `<div class="actions"><a class="button" href="${progressLink}">Explore all measured progress →</a></div>`);
}

async function clientProgramWorkspace(root) {
  const client = state.client;
  const student = state.me.role === "student";
  const active = client.programs?.[0];
  let program = null, history = [], templates = [];
  if (active) {
    try {
      [program, history] = await Promise.all([
        record("programs", active.program_id),
        api("program/versions?id=" + encodeURIComponent(active.program_id)).then((x) => x.items).catch(() => []),
      ]);
    } catch { /* The assignment can outlive removed shared content. */ }
  }
  if (!student) {
    try { templates = (await api("program/templates")).items || []; } catch { templates = []; }
  }
  const contextRegion = new URLSearchParams(location.hash.slice(1)).get("region");
  const report = new URLSearchParams(location.hash.slice(1)).get("report");
  const finding = new URLSearchParams(location.hash.slice(1)).get("finding");
  const related = contextRegion || program?.region_id;
  const practice = client.sessions?.filter((s) => s.program_id === active?.program_id) || [];
  const practiceHistory = client.sessions || [];
  const latest = practice[0];
  const priorPrograms = [...(client.program_history || [])]
    .filter((assignment) => !assignment.active)
    .sort((a, b) => String(b.starts_on || "").localeCompare(String(a.starts_on || "")));
  const details = program?.detail || {};
  const total = (program?.steps || []).filter((step) => step.exercise_id && (!step.detail?.program_phase || step.detail.program_phase === (details.phase || "Foundation"))).length;
  const completed = latest?.completed?.length || 0;
  root.innerHTML = head(
    student ? "Your current program" : `${client.name} · program`,
    student ? "See what your coach assigned and why each movement matters." : "A client-specific plan linked to analysis, body areas and past practice.",
    student ? "" : '<button data-edit="programs" class="primary">+ Create program</button>',
  ) +
    (report || finding || contextRegion ? `<div class="pd-context-callout"><strong>From your client review</strong><p>${finding ? `Finding: ${esc(finding.replaceAll("_", " "))}. ` : ""}${contextRegion ? `Body area: ${esc(regionName(contextRegion))}. ` : ""}New and edited plans will retain this assessment connection.</p>${report ? `<a href="${href("report", { id: report, client: client.id })}">Return to assessment →</a>` : ""}</div>` : "") +
    (program ? `<section class="pd-current-dashboard"><div class="pd-current-main"><small>CURRENT PROGRAM · ${esc(details.status || "Active")}</small><h2><a href="${href("program", { id: program.id, client: client.id })}">${esc(program.name)}</a></h2><p>${esc(program.goal || details.description || "Follow your coach’s planned movement practice.")}</p><div class="pd-target-links">${(details.target_region_ids?.length ? details.target_region_ids : [program.region_id]).filter(Boolean).map((id) => `<a class="pd-region-chip" href="${href("client", { client: client.id, tab: "anatomy", region: id })}">${esc(regionName(id))} · Body map</a>`).join("")}</div><div class="actions"><a class="button primary" href="${href("program", { id: program.id, client: client.id })}">${student ? "Open today’s practice" : "Open full program"}</a>${student ? "" : `<button data-edit="programs" data-id="${esc(program.id)}">Edit program</button><details class="pd-more-actions"><summary>More program actions</summary><button id="pd-add-movement" type="button">Add exercise</button><button id="pd-new-phase" type="button">Create next phase</button><button id="pd-change-phase" type="button">Change phase</button><a class="button" href="${href("program", { id: program.id, client: client.id, history: "1" })}">View history</a><button id="pd-duplicate-client" type="button">Duplicate program</button><button id="pd-complete-program" type="button">Complete program</button></details>`}</div></div><div class="pd-current-facts"><div><strong>${esc(details.phase || "Foundation")}</strong><small>Current phase</small></div><div><strong>${esc(total)}</strong><small>Assigned movements</small></div><div><strong>${esc(practice.length)}</strong><small>Practice sessions</small></div><div><strong>${esc(total ? `${Math.round(completed / total * 100)}%` : "—")}</strong><small>Most recent session completed</small></div><div><strong>${esc(date(active?.starts_on || details.start_date))}</strong><small>Plan start</small></div><div><strong>${esc(history[0] ? date(history[0].created_at) : "—")}</strong><small>Latest revision</small></div></div></section>` : `<section class="pd-empty-plan"><h2>${student ? "No program assigned yet" : "Build a plan for this client"}</h2><p>${student ? "Your coach will assign exercises here. Previous completed sessions remain in your history." : "Start with this client’s findings, choose body targets, then create a sequence with clear instructions."}</p>${student ? "" : '<button data-edit="programs" class="primary">Create program</button>'}</section>`) +
    (program ? programProgressCard(client, active, program) : "") +
    (!student && program ? card("Program decisions", `<p><strong>Coach note:</strong> ${esc(details.coach_notes || "No coach planning note yet.")}</p><p><strong>Related assessment:</strong> ${details.source_analysis_id ? `<a href="${href("report", { id: details.source_analysis_id, client: client.id })}">Open source analysis →</a>` : "No assessment linked yet."}</p><p><strong>Historical versions:</strong> ${history.length} saved revision${history.length === 1 ? "" : "s"}.</p><a class="button" href="${href("program", { id: program.id, client: client.id })}">View version history</a>`) : "") +
    (!student && templates.length ? card("Start from an editable template", `<div class="pd-template-grid">${templates.slice(0,6).map((t) => `<article><small>${esc(t.detail?.phase || "Foundation")}</small><h3>${esc(t.name)}</h3><p>${esc(t.goal || t.detail?.description || "Adapt this plan to the client.")}</p><button data-template="${esc(t.id)}">Use for ${esc(client.name)}</button></article>`).join("")}</div>`) : "") +
    (priorPrograms.length ? card("Earlier programs", `<p>Previous plans remain available with their saved versions and practice records.</p><div class="pd-history-list">${priorPrograms.map((assignment) => `<div><span>${esc(date(assignment.starts_on))}</span><strong>${esc(assignment.name || "Earlier plan")}</strong><small>${String(assignment.notes || "").includes("Completed:") ? "Completed" : "Previous assignment"}</small><a href="${href("program", { id: assignment.program_id, client: client.id, history: "1" })}">Open plan and versions →</a></div>`).join("")}</div>`) : "") +
    (practiceHistory.length ? card("Practice history", `<div class="pd-history-list">${practiceHistory.slice(0,10).map((s) => `<div><span>${esc(date(s.performed_at))}</span><strong>${esc(s.completed?.length || 0)} movements completed</strong>${s.program_id ? `<a href="${href("program", { id: s.program_id, client: client.id, history: "1" })}">Open saved program →</a>` : ""}${s.analysis_id ? `<a href="${href("report", { id: s.analysis_id, client: client.id })}">Related assessment →</a>` : ""}</div>`).join("")}</div>`) : "");
  bindButtons(root);
  for (const selector of ["#pd-add-movement", "#pd-change-phase"]) if (root.querySelector(selector)) root.querySelector(selector).onclick = async () => {
    try { const { edit } = await import("./forms.js"); await edit("programs", program.id); } catch (e) { toast(e.message); }
  };
  if (root.querySelector("#pd-duplicate-client")) root.querySelector("#pd-duplicate-client").onclick = async () => {
    try { const copy = await api("program/duplicate", {program_id:program.id,student_id:client.id,replace:true,name:program.name + " · copy"}); location.hash = href("program",{id:copy.id,client:client.id}); } catch (e) { toast(e.message); }
  };
  if (root.querySelector("#pd-complete-program")) root.querySelector("#pd-complete-program").onclick = () => {
    const dialog = modal("Complete this client's program?", notice("This ends only this client's assignment. The program, its saved versions and practice history remain available; other clients sharing the plan keep their assignment.") +
      field("Completion note", "reason", "Program completed by coach", "text", 'maxlength="2000"'), async (form) => {
      await api("program/retire", {
        student_id: client.id,
        program_id: program.id,
        reason: String(form.get("reason") || "").trim() || "Program completed by coach",
      });
      location.hash = href("client", {client: client.id, tab: "programs"});
    });
    dialog.querySelector('[type="submit"]').textContent = "Complete program";
  };
  if (root.querySelector("#pd-new-phase")) root.querySelector("#pd-new-phase").onclick = async () => {
    try {
      const { programEditor } = await import("./programs.js");
      await programEditor(program.id, false, true);
    } catch (e) { toast(e.message); }
  };
  root.querySelectorAll("[data-template]").forEach((button) => button.onclick = async () => {
    button.disabled = true;
    try {
      const clone = await api("program/duplicate", {program_id:button.dataset.template,student_id:client.id,name:button.closest("article").querySelector("h3").textContent + " · " + client.name,as_template:false});
      location.hash = href("program",{id:clone.id,client:client.id});
    } catch (e) { button.disabled = false; toast(e.message); }
  });
}
