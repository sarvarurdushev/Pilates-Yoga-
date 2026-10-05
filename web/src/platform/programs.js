import {
  $, state, api, list, record, params, href, go, esc, field, area,
  select, options, modal, toast, regions, regionName, head, card,
  notice, mediaURL, safeURL, upload, date, dt, views as cameraViews, exerciseIllustration,
} from "./core.js";
import {
  exerciseStep, configureStep, orderedStepsBySection, reorderStep,
  moveStepBefore, moveStepToSectionEnd, removeStep,
} from "./program-sequence.js";
import { openCoachCamera } from "./program-camera.js";
import { visitsForClient, visitConnections } from "./visits.js";
import { programFirstScreenFacts, programSourceId } from "./first-screen-context.js";
import { programVersionChanges } from "./program-version-diff.js";
import { markCompletion, completedEventPayload } from "./completed-events.js";

const phaseChoices = ["Assessment", "Foundation", "Mobility", "Strength", "Control", "Progression", "Maintenance"];
const statuses = ["Draft", "Active", "Completed", "Archived"];
const mediaKinds = [
  ["coach_demonstration", "Coach demonstration"],
  ["coach_photo", "Coach photo"],
  ["exercise_library", "Exercise library media"],
  ["client_capture", "Client capture"],
  ["demo_media", "Demo media"],
  ["ai_generated_visual", "AI-generated visual"],
];
const referenceKinds = [["video","Reference video"],["youtube","YouTube video"],["vimeo","Vimeo video"],["research","Research article"],["article","Educational article"],["pdf","PDF"],["website","Exercise website"],["other","Other link"]];
const own = (item) => state.me.role === "admin" || item.owner_id === state.me.user.id;
const stepDetail = (step) => ({ ...(step.detail || {}) });
const sid = () => crypto.randomUUID().replaceAll("-", "");
const isVideo = (m) => (m?.mime || "").startsWith("video/");
const mediaLabel = (kind) => mediaKinds.find((k) => k[0] === kind)?.[1] || "Exercise media";
const shortCaptureText = (value, limit) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
};
export function clientCaptureOptions(entries = []) {
  const ids = entries.map((item) => String(item.id || "")).filter(Boolean);
  return entries.filter((item) => item.id).map((item) => {
    const id = String(item.id);
    let length = Math.min(6, id.length);
    while (length < id.length && ids.some((other) => other !== id && other.startsWith(id.slice(0, length))))
      length = Math.min(id.length, length + 2);
    const recorded = item.created_at ? new Date(item.created_at) : null;
    const uploaded = recorded && Number.isFinite(recorded.getTime())
      ? new Intl.DateTimeFormat(undefined, {year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(recorded)
      : null;
    const view = item.capture_view
      ? shortCaptureText(cameraViews[item.capture_view] || item.capture_view.replaceAll("_", " "), 20) + " view"
      : "";
    const label = [
      item.mime?.startsWith("video/") ? "Video" : "Photo",
      view,
      shortCaptureText(item.capture_protocol, 38),
      uploaded ? "uploaded " + uploaded : "upload date unavailable",
      shortCaptureText(item.filename || "Unnamed file", 28),
      "#" + id.slice(0, length),
    ].filter(Boolean).join(" · ");
    return [id, label];
  });
}
export function currentPhaseSteps(steps, phase = "Foundation") {
  const selectedPhase = phase || "Foundation";
  return (steps || []).filter((step) => {
    const assignedPhase = stepDetail(step).program_phase;
    return !assignedPhase || assignedPhase === "All phases" || assignedPhase === selectedPhase;
  });
}
export function programDurationEstimate(steps) {
  let timedSeconds = 0, untimed = 0;
  for (const step of steps) {
    if (!step.exercise_id) continue;
    const sets = Math.max(1, Number(step.sets) || 1);
    const workSeconds = Math.max(0, Number(step.seconds) || 0);
    const restSeconds = Math.max(0, Number(step.rest) || 0);
    if (workSeconds) timedSeconds += sets * workSeconds + (sets - 1) * restSeconds;
    else untimed += 1;
  }
  return { minutes: timedSeconds ? Math.ceil(timedSeconds / 60) : 0, untimed };
}
const duration = (steps) => programDurationEstimate(steps).minutes;
const durationLabel = (steps) => {
  const estimate = programDurationEstimate(steps);
  if (!estimate.minutes) return "Timing not set";
  return `${estimate.untimed ? "At least" : "About"} ${estimate.minutes} min`;
};
export const planPhaseFromForm = (formData) => formData.get("current_program_phase");
export function nextProgramPhase(phases) {
  if (phases.length >= 16) throw Error("A program can have at most 16 phases.");
  const lastWeek = Math.max(0, ...phases.map((phase) => Number(phase.weeks_end) || 0));
  if (lastWeek >= 104) throw Error("A program cannot extend beyond week 104.");
  let number = phases.length + 1;
  while (phases.some((phase) => phase.name === `Phase ${number}`)) number++;
  return {
    name: `Phase ${number}`,
    weeks_start: lastWeek + 1,
    weeks_end: Math.min(104, lastWeek + 4),
    goal: "",
  };
}
export function revisionVisitOptions(client) {
  if (!client) return [];
  return visitsForClient(client).filter((visit) => visit.session?.id).map((visit) => {
    const captures = visit.analyses?.length || 0;
    const movements = visit.exerciseCount || 0;
    const activity = [
      captures ? `${captures} assessment${captures === 1 ? "" : "s"}` : "",
      movements ? `${movements} movement${movements === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" · ") || "Recorded visit";
    return [visit.session.id, `${dt(visit.occurredAt)} · ${activity}`];
  });
}

export function revisionSourceOptions(client, kind, visitId = "") {
  const visit = visitId ? visitsForClient(client || {}).find((item) => item.session?.id === visitId) : null;
  if (visitId && !visit) return [];
  if (kind === "analysis") {
    const analyses = visit ? visit.analyses : client?.analyses || [];
    return analyses.map((analysis) => [analysis.id, `${analysis.kind || "Assessment"} · ${date(analysis.created_at)}`]);
  }
  if (["coach_observation", "client_feedback"].includes(kind)) {
    const notes = visit ? visitConnections(client, visit).notes : client?.notes || [];
    return notes.map((note) => [note.id, `${regionName(note.region_id)} · ${note.text?.slice(0,50) || "Coach feedback"}`]);
  }
  return [];
}

export function revisionAuthorLabel(version, currentUser = {}, coaches = []) {
  return version.actor_name || coaches.find((coach) => coach.id === version.actor_id)?.name ||
    (currentUser.id && currentUser.id === version.actor_id ? currentUser.name : "") || "Author unavailable";
}

export function revisionVisitLink(version, clientId) {
  if (!clientId) return "";
  if (version.session_id)
    return `<a href="${href("client", {client:clientId,tab:"sessions",session:version.session_id})}">Source visit</a>`;
  const detail = version.snapshot?.detail || {};
  const assigned = detail.student_id || detail.source_student_id;
  if (version.source_kind === "manual" && (assigned || version.version))
    return '<span>Manual coach decision · no visit linked</span>';
  if (assigned || version.source_id || ["analysis","coach_observation","client_feedback"].includes(version.source_kind))
    return '<span>Source visit not recorded</span>';
  return "";
}

export function revisionStepsHTML(steps, exercises = new Map()) {
  let movement = 0;
  return (steps || []).map((step) => {
    const section = stepDetail(step).section || step.section || step.phase || "Practice";
    if (step.type === "note") {
      return `<div class="pd-version-step"><strong>${step.visibility === "coach" ? "Coach planning note" : "Practice reminder"} · ${esc(section)}</strong><p>${esc(step.text)}</p></div>`;
    }
    if (!step.exercise_id) return "";
    movement++;
    return `<div class="pd-version-step">${movement}. ${esc(step.exercise_name || exercises.get(step.exercise_id)?.name || "Historical movement")} · ${esc(step.sets)} set${Number(step.sets) === 1 ? "" : "s"} × ${esc(step.reps)} rep${Number(step.reps) === 1 ? "" : "s"} · ${esc(section)}</div>`;
  }).join("");
}

export function revisionChangeHTML(version, versions) {
  const previous = (versions || []).find((item) => Number(item.version) === Number(version.version) - 1);
  const comparison = programVersionChanges(version, previous);
  const heading = comparison.kind === "initial" ? "Starting plan" : "What changed";
  return `<div class="pd-version-step pd-version-changes"><strong>${heading}</strong><ul>${comparison.lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></div>`;
}

export function revisionSourceLink(version, clientId, notes = []) {
  if (!version.source_id) return "";
  if (version.source_kind === "analysis")
    return `<a href="${href("report", {id:version.source_id,client:clientId})}">Source assessment</a>`;
  if (["coach_observation","client_feedback"].includes(version.source_kind) && clientId) {
    const note = notes.find((item) => item.id === version.source_id);
    if (note) return `<a href="${href("client", {client:clientId,tab:"notes",region:note.region_id || "",note:note.id})}">Source coach feedback${note.text ? ` · ${esc(note.text.slice(0,70))}` : ""}</a>`;
    return `<span>Source feedback unavailable · saved record ${esc(version.source_id.slice(0,8))}</span>`;
  }
  return `<span>Source record ${esc(version.source_id.slice(0,8))}</span>`;
}
export function appendCoachMedia(entries, file, mediaId, {caption = "", primary = false} = {}) {
  const video = file.type.startsWith("video/");
  const makePrimary = video && (primary || !entries.some((entry) => entry.primary));
  return [
    ...entries.map((entry) => makePrimary ? {...entry, primary:false} : entry),
    {media_id:mediaId,kind:video ? "coach_demonstration" : "coach_photo",
      caption,primary:makePrimary,visibility:"student",stage:"other"},
  ];
}
function targetButtons(selected) {
  return `<div class="pd-target-grid" role="group" aria-label="Target body regions">${regions().map((r) => `<button type="button" class="pd-target ${selected.includes(r.id) ? "selected" : ""}" data-target="${esc(r.id)}" aria-pressed="${selected.includes(r.id)}"><span>${esc(r.name)}</span><small>${esc(r.side || "")}</small></button>`).join("")}</div><p class="muted">These are coaching targets, not a diagnosis or a measurement of internal tissue. Select them here or click a mapped structure in the 3D body.</p>`;
}
function targetLinks(ids, clientId, reportId) {
  return (ids || []).map((r) => `<a class="pd-region-chip" href="${href("client", { client: clientId, tab: "anatomy", region: r, id: reportId || "" })}">${esc(regionName(r))} · View body</a>`).join("");
}
function mediaCard(media, label, caption = "") {
  if (!media) return "";
  const src = mediaURL(media.id || media.media_id);
  return `<figure class="pd-media"><div class="pd-media-badge">${esc(label)}</div>${isVideo(media) ? `<video controls preload="metadata" src="${src}"></video>` : `<img loading="lazy" src="${src}" alt="${esc(caption || media.filename || label)}">`}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
}
function mediaForStep(step, exercise, student = false, clientMedia = new Map()) {
  const entries = stepDetail(step).media || [];
  const chosen = entries.filter((m) => !student || m.visibility !== "coach");
  const lookup = new Map((exercise.media || []).map((m) => [m.id, m]));
  const ordered = [...chosen].sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
  const selected = ordered.map((m) => {
    const asset = lookup.get(m.media_id) || clientMedia.get(m.media_id);
    const position = m.stage === "start" ? "Start position" : m.stage === "end" ? "End position" : "";
    const label = [m.primary && isVideo(asset) ? "Primary demonstration" : "", position, mediaLabel(m.kind)].filter(Boolean).join(" · ");
    return asset ? mediaCard(asset, label, m.caption) : "";
  }).filter(Boolean);
  if (selected.length) return selected.join("");
  const fallback = (exercise.media || []).filter((m) => !student || m.kind === "exercise");
  return fallback.map((m) => mediaCard(m, "Exercise library media", m.filename)).join("") || exerciseIllustration(exercise) || "";
}
async function editableExerciseForUpload(step, exerciseMap) {
  const original = exerciseMap.get(step.exercise_id);
  if (!original || state.me.role === "admin" || original.owner_id === state.me.user.id) return original;
  const copied = await api("save", { collection:"exercises", item: {
    name:`${original.name} · ${state.client?.name || "coach copy"}`,
    category:original.category,difficulty:original.difficulty,region_id:original.region_id,
    visibility:"private",detail:{...(original.detail || {}),program_only:true,copied_from:original.id},
    resources:original.resources || [],equipment:original.equipment || [],
  }});
  const media = original.media || [];
  if (media.length) {
    const copiedMedia = await api("copy-exercise-media", {exercise_id:copied.id,media_ids:media.map((m)=>m.id)});
    const mapping = new Map(media.map((m,i)=>[m.id,copiedMedia.media_ids[i]]));
    step.detail.media = (step.detail.media || []).map((m)=>({...m,media_id:mapping.get(m.media_id)||m.media_id}));
  }
  const full = await record("exercises", copied.id);
  exerciseMap.set(full.id, full);
  step.exercise_id = full.id;
  return full;
}
function stepTile(step, exercise, index, clientId, student, clientMedia, allowedSourceIds) {
  const d = stepDetail(step);
  const ids = d.target_region_ids?.length ? d.target_region_ids : [exercise.region_id].filter(Boolean);
  const why = d.why_assigned || d.purpose || step.notes || "Your coach included this movement in your current plan.";
  const how = d.student_instructions || exercise.detail?.instructions || "Follow the demonstrated movement at a comfortable range.";
  const media = mediaForStep(step, exercise, student, clientMedia);
  const refs = (d.references || []).filter((r) => !student || r.visibility !== "coach");
  const equipment = (d.equipment || []).map((item)=>`${item.quantity || 1} × ${item.name || "Studio equipment"}`).join(", ");
  return `<article class="pd-practice-card"><div class="pd-practice-count">${index + 1}</div><div class="pd-practice-main"><div class="pd-practice-head"><div><small>${esc(exercise.category || "Movement")} · ${esc(d.side || "Both sides")}</small><h3>${esc(exercise.name)}</h3></div><span class="pd-dose">${esc(step.sets)} sets · ${esc(step.reps)} reps${step.seconds ? ` · ${esc(step.seconds)}s` : ""}</span></div><p class="pd-why"><strong>Why this movement?</strong> ${esc(why)}</p><div class="pd-instruction-grid"><div><h4>Coach instructions</h4><p>${esc(how)}</p>${d.coach_cue ? `<p><strong>Coach cue:</strong> ${esc(d.coach_cue)}</p>` : ""}${d.success_criteria ? `<p><strong>What success looks like:</strong> ${esc(d.success_criteria)}</p>` : ""}<p class="muted">Rest ${esc(step.rest)}s between sets${d.tempo ? ` · Tempo ${esc(d.tempo)}` : ""}${d.resistance ? ` · Resistance ${esc(d.resistance)}` : ""}${equipment ? ` · Equipment ${esc(equipment)}` : ""}</p><div class="pd-target-links">${targetLinks(ids, clientId, allowedSourceIds.has(d.source?.id) ? d.source.id : null)}</div></div>${media ? `<div class="pd-media-strip">${media}</div>` : ""}</div>${refs.length ? `<details class="pd-disclosure"><summary>Reference resources (${refs.length})</summary>${refs.map((r) => `<a class="record-link" target="_blank" rel="noopener" href="${esc(safeURL(r.url))}">${esc(r.title || r.type || "Reference")} · ${esc(r.type || "Link")} ↗<small>${esc(r.description || "")}</small></a>`).join("")}</details>` : ""}${d.progression || d.regression || d.precautions ? `<details class="pd-disclosure"><summary>Options and precautions</summary>${d.progression ? `<p><strong>Progression:</strong> ${esc(d.progression)}</p>` : ""}${d.regression ? `<p><strong>Easier option:</strong> ${esc(d.regression)}</p>` : ""}${d.precautions ? `<p><strong>Precautions:</strong> ${esc(d.precautions)}</p>` : ""}</details>` : ""}${student ? `<label class="pd-complete"><input class="completed-step" type="checkbox" value="${esc(step.id || step.exercise_id)}"> I completed this movement</label>` : `<details class="pd-disclosure"><summary>Coach details</summary><p>${esc(d.coach_instructions || "No separate coach instruction")}</p><p>Position: ${esc(d.position || "Coach adapted")} · Difficulty: ${esc(d.difficulty || exercise.difficulty || "Foundation")}</p>${d.common_mistake ? `<p>Common mistake: ${esc(d.common_mistake)}</p>` : ""}</details>`}</div></article>`;
}
function groupedSteps(steps) {
  const sections = [];
  for (const step of steps) {
    const section = step.section || stepDetail(step).section || step.phase || "Practice";
    let group = sections.find((g) => g.name === section);
    if (!group) sections.push((group = { name: section, steps: [] }));
    group.steps.push(step);
  }
  return sections;
}

export async function programDetail(root, id) {
  if (!id) throw Error("Choose a program to view its plan.");
  const item = await record("programs", id);
  const d = item.detail || {};
  const student = state.me.role === "student";
  const contextClientId = params().get("client") || state.client?.id || null;
  const clientId = contextClientId || d.source_student_id || item.assignments?.[0]?.student_id;
  const exIds = [...new Set((item.steps || []).map((s) => s.exercise_id).filter(Boolean))];
  const exercises = new Map((await Promise.all(exIds.map((eid) => record("exercises", eid)))).map((e) => [e.id, e]));
  const captureIds = [...new Set((item.steps || []).flatMap((s)=>stepDetail(s).media || []).filter((m)=>m.kind === "client_capture").map((m)=>m.media_id))];
  const clientMedia = new Map((await Promise.all(captureIds.map((mid)=>record("media",mid).catch(()=>null)))).filter(Boolean).map((m)=>[m.id,m]));
  const phaseSteps = currentPhaseSteps(item.steps, d.phase);
  const visibleSteps = student ? phaseSteps : item.steps || [];
  const allMovementCount = (item.steps || []).filter((step) => step.exercise_id).length;
  const phaseMovementCount = phaseSteps.filter((step) => step.exercise_id).length;
  const groups = groupedSteps(visibleSteps);
  const selected = d.target_region_ids?.length ? d.target_region_ids : [item.region_id].filter(Boolean);
  const canEdit = !student && own(item);
  const selectedClient = state.client?.id === clientId ? state.client : null;
  const sourceId = programSourceId(item, selectedClient);
  const sourceRecord = sourceId ? await record("analyses", sourceId).catch(() => null) : null;
  if (!root.isConnected) return;
  const contextFacts = programFirstScreenFacts(item, selectedClient, sourceRecord);
  const allowedSourceIds = new Set((selectedClient?.analyses || []).map((analysis) => analysis.id));
  if (contextFacts.source) allowedSourceIds.add(contextFacts.source.id);
  const sourceVisit = contextFacts.sourceVisit?.session?.id
    ? `<a href="${href("client", { client: clientId, tab: "sessions", session: contextFacts.sourceVisit.session.id })}">Open linked visit →</a>` : "";
  const sourceCopy = contextFacts.source
    ? `<strong>${esc(contextFacts.source.protocol || "Assessment")}</strong> · ${esc(date(contextFacts.source.created_at))} · ${esc(contextFacts.views.length ? contextFacts.views.map((view) => view.replaceAll("_", " ")).join(", ") + (contextFacts.views.length === 1 ? " view" : " views") : "Camera view unavailable")} · <a href="${href("report", { id: contextFacts.source.id, client: clientId })}">Open source assessment →</a> ${sourceVisit}`
    : contextFacts.clientName
      ? "No assessment source is linked and available for this selected client. Camera view and measured change are unavailable here."
      : "Choose a client to verify any assessment source, camera view and visit for this plan.";
  const nextCopy = student
    ? "Follow the current-phase movements below, then save only the practice you completed."
    : contextFacts.assigned && contextFacts.source
      ? "Review the linked evidence and visit, then edit this plan if the coach decides it should change."
      : contextFacts.assigned
        ? "Open this client's sessions to review available evidence before editing the plan."
        : "Review this plan and assign it to a client before treating it as their practice plan.";
  const contextCard = card("Client, source and next step",
    `<p><strong>Selected client:</strong> ${esc(contextFacts.clientName || "No client selected")}${contextFacts.clientName ? ` · ${contextFacts.assigned ? "Assigned plan" : "Not currently assigned to this client"}` : " · Open a client workspace to see personal evidence"}.</p><p><strong>Source:</strong> ${sourceCopy}</p><p><strong>What this is:</strong> A saved plan, not a record that these movements were performed. Completed practice appears in the client’s visits.</p><p><strong>Next:</strong> ${esc(nextCopy)}${selectedClient ? ` <a href="${href("client", { client: selectedClient.id, tab: "sessions" })}">Open client visits →</a>` : ""}</p>`);
  root.innerHTML = head(student ? "Today’s program" : item.name, student ? item.name : d.description || item.goal,
    student ? "" : `<div class="pd-head-actions">${canEdit ? '<button id="pd-edit" class="primary">Edit program</button>' : ""}<button id="pd-duplicate">Duplicate</button><button id="pd-template">Save as template</button><button id="pd-history">Version history</button><button id="pd-assign" class="primary">Assign to client</button>${clientId ? `<a class="button" href="${href("client", { client: clientId, tab: "programs" })}">← Client program</a>` : ""}</div>`) +
    contextCard +
    `<div class="pd-program-summary"><div class="pd-summary-intro"><small>${esc(d.status || "Active")} · ${esc(d.phase || "Foundation")}</small><h2>${esc(student ? item.name : item.goal || item.name)}</h2><p>${esc(student ? item.goal || d.description : d.description || item.goal)}</p>${contextFacts.source ? `<a class="pd-evidence" href="${href("report", { id: contextFacts.source.id, client: clientId })}">Source assessment →</a>` : ""}${d.copied_from ? `<a class="pd-evidence" href="${href("program", { id: d.copied_from, client: clientId })}">Previous program phase →</a>` : ""}</div><div class="pd-summary-facts"><div><strong>${esc(d.sessions_per_week || d.frequency || "Coach-set")}</strong><small>sessions per week</small></div><div><strong>${esc(d.duration_weeks || "—")}</strong><small>weeks planned</small></div><div><strong>${esc(durationLabel(phaseSteps))}</strong><small>estimated session · current phase</small></div><div><strong>${esc(phaseMovementCount)}</strong><small>movements · current phase${allMovementCount > phaseMovementCount ? ` (${esc(allMovementCount)} across all phases)` : ""}</small></div></div></div>` +
    `${(d.phases || []).length ? `<div class="pd-phase-track">${d.phases.map((phase) => `<span class="${phase.name === d.phase ? "active" : ""}">${esc(phase.name)} <small>Weeks ${esc(phase.weeks_start || "?")}–${esc(phase.weeks_end || "?")}</small></span>`).join("")}</div>` : ""}<section class="pd-target-summary"><div><small>TARGET BODY AREAS</small><h2>What this plan focuses on</h2><p>These areas connect coaching decisions to the body map. They are educational targets rather than a diagnosis.</p></div><div class="pd-target-explanations">${selected.map((id)=>`<article><a class="pd-region-chip" href="${href("client", { client: clientId, tab: "anatomy", region: id, id: contextFacts.source?.id || "" })}">${esc(regionName(id))} · Explore in 3D</a><p>${esc(d.target_explanations?.[id] || "A coach-selected area for this program.")}</p></article>`).join("") || "<span>Your coach has not chosen a specific body area.</span>"}</div></section>` +
    (groups.length ? groups.map((group) => `<section class="pd-practice-section"><div class="pd-section-heading"><span>${esc(group.name)}</span><small>${group.steps.filter((s)=>s.exercise_id).length} movement${group.steps.filter((s)=>s.exercise_id).length === 1 ? "" : "s"}</small></div>${group.steps.map((s) => s.type === "note" ? `<div class="pd-sequence-note"><strong>${s.visibility === "coach" ? "Coach planning note" : "Practice reminder"}</strong><p>${esc(s.text)}</p></div>` : stepTile(s, exercises.get(s.exercise_id) || {name:"Unavailable exercise",detail:{}}, visibleSteps.filter((x)=>x.exercise_id).indexOf(s), clientId, student, clientMedia, allowedSourceIds)).join("")}</section>`).join("") : notice("No exercises have been added yet. A coach can edit this program to build a sequence.")) +
    (!student && d.coach_notes ? card("Coach planning notes", `<p class="preserve">${esc(d.coach_notes)}</p>`) : "") +
    (student ? `<div class="pd-practice-save"><p>Check the movements you completed, then save this practice to your history. The time you check each box is saved as its marked-complete time.</p><button class="primary" id="pd-complete">Save completed practice</button></div><details class="pd-disclosure" id="pd-student-versions"><summary>Earlier program versions</summary><div id="pd-student-version-list">Open this section to review past plans.</div></details>` : `<div id="pd-history-panel"></div>`);
  if (student) {
    root.querySelectorAll(".completed-step").forEach((input) => {
      input.onchange = () => markCompletion(input);
    });
    root.querySelector("#pd-student-versions").ontoggle = async (event) => {
      if (!event.target.open || event.target.dataset.loaded) return;
      event.target.dataset.loaded = "1";
      const panel = root.querySelector("#pd-student-version-list");
      try { const result = await api("program/versions?id=" + encodeURIComponent(id));
        panel.innerHTML = result.items.map((v)=>`<div class="pd-version-step"><strong>Version ${esc(v.version)} · ${dt(v.created_at)}</strong><p>${esc(v.snapshot?.goal || v.snapshot?.name || "Earlier plan")}</p>${revisionChangeHTML(v,result.items)}${revisionVisitLink(v, clientId) ? `<p>${revisionVisitLink(v, clientId)}</p>` : ""}<p>${(v.snapshot?.steps || []).filter((s)=>s.exercise_id).map((s)=>esc(s.exercise_name || "Movement")).join(" · ")}</p></div>`).join("") || "This is the first saved version.";
      } catch (e) { panel.textContent = e.message; }
    };
    if (params().get("history") === "1") root.querySelector("#pd-student-versions").open = true;
    root.querySelector("#pd-complete").onclick = async () => {
      const completed = completedEventPayload(root.querySelectorAll(".completed-step"));
      if (!completed.completed.length) return toast("Choose at least one completed movement.");
      try {
        await api("complete-session", { student_id: state.me.user.id, program_id: id, ...completed });
        toast("Practice saved to your history");
        go("client", { client: clientId, tab: "sessions" });
      } catch (e) { toast(e.message); }
    };
    return;
  }
  if (canEdit) root.querySelector("#pd-edit").onclick = () => programEditor(id);
  root.querySelector("#pd-assign").onclick = () => modal("Assign this program", select("Client", "student_id", state.me.students, clientId) + area("Assignment note", "notes") + notice("The client’s previous assignment and practice history stay available."), async (data) => { const studentId = data.get("student_id"); if (!studentId) throw Error("Choose a client."); await api("assign", { student_id: studentId, program_id: id, analysis_id: d.source_student_id === studentId ? d.source_analysis_id || null : null, notes: data.get("notes") || "" }); go("client", { client: studentId, tab: "programs" }); });
  root.querySelector("#pd-duplicate").onclick = () => duplicateProgram(item, false, contextClientId);
  root.querySelector("#pd-template").onclick = () => duplicateProgram(item, true, null);
  root.querySelector("#pd-history").onclick = async () => {
    const panel = root.querySelector("#pd-history-panel");
    panel.innerHTML = `<div class="loading">Loading program history…</div>`;
    try {
      const result = await api("program/versions?id=" + encodeURIComponent(id));
      panel.innerHTML = `<section class="panel"><h2>Version history</h2><p>Every saved revision remains available for review. Current changes do not erase the earlier plan.</p>${result.items.map((v) => `<details class="pd-version"><summary>Version ${esc(v.version)} · ${dt(v.created_at)} · ${esc(revisionAuthorLabel(v, state.me.user, state.me.coaches))}</summary><p><strong>Why it changed:</strong> ${esc(v.reason || "No reason recorded")}</p><p><strong>Source:</strong> ${esc(v.source_kind || "Manual coach decision")}${v.source_id ? ` · ${revisionSourceLink(v, clientId, state.client?.notes || [])}` : ""}</p>${revisionVisitLink(v, clientId) ? `<p><strong>Visit:</strong> ${revisionVisitLink(v, clientId)}</p>` : ""}${revisionChangeHTML(v,result.items)}<p>${esc(v.snapshot?.name || "Program")} · ${(v.snapshot?.steps || []).filter((step) => step.exercise_id).length} movements</p>${revisionStepsHTML(v.snapshot?.steps, exercises)}</details>`).join("") || "<p>No prior revisions yet. The first saved version appears after an edit.</p>"}</section>`;
    } catch (e) { panel.innerHTML = notice(e.message); }
  };
  if (params().get("history") === "1") root.querySelector("#pd-history").click();
}
async function duplicateProgram(item, asTemplate, clientId) {
  try {
    const result = await api("program/duplicate", {
      program_id: item.id,
      ...(clientId && !asTemplate ? { student_id: clientId, assign: false } : {}),
      as_template: asTemplate,
      name: `${item.name} · ${asTemplate ? "template" : "copy"}`,
    });
    toast(asTemplate ? "Editable template saved" : "Program duplicated");
    go("program", { id: result.id, client: clientId || "" });
  } catch (e) { toast(e.message); }
}

function referenceEditor(ref, index) {
  return `<div class="pd-reference-row" data-ref="${index}">${field("Reference title", "ref_title", ref.title)}${field("URL", "ref_url", ref.url, "url")}${select("Type", "ref_type", referenceKinds, ref.type || "video", null)}${select("Visible to", "ref_visibility", [["student","Student and coach"],["coach","Coach only"]], ref.visibility || "student", null)}${area("Coach context", "ref_description", ref.description)}<button type="button" data-remove-ref="${index}">Remove reference</button></div>`;
}
function mediaEditor(media, exercise, index, clientMedia) {
  const asset = (exercise.media || []).find((m) => m.id === media.media_id) || clientMedia.find((m)=>m.id===media.media_id);
  return `<div class="pd-media-row" data-media="${index}"><span>${esc(asset?.filename || "Media unavailable")}</span>${select("Label", "media_kind", mediaKinds, media.kind || "exercise_library", null)}${select("Position", "media_stage", [["other","General"],["start","Start position"],["end","End position"]], media.stage || "other", null)}${field("Caption", "media_caption", media.caption)}<label class="check"><input type="checkbox" name="media_primary" ${media.primary ? "checked" : ""} ${isVideo(asset) ? "" : "disabled"}> Primary demonstration · video only</label>${select("Visible to", "media_visibility", [["student","Student and coach"],["coach","Coach only"]], media.visibility || "student", null)}<button type="button" data-remove-media="${index}">Remove attachment</button></div>`;
}
function equipmentEditor(selected, inventory, locations) {
  if (!inventory.length) return '<p class="muted">No equipment has been registered for your studio locations.</p>';
  const chosen = new Map((selected || []).map((item) => [item.equipment_id, item]));
  const place = new Map((locations || []).map((location) => [location.id, location.name]));
  return `<div class="pd-equipment-list" role="group" aria-label="Equipment for this movement">${inventory.map((item) => {
    const current = chosen.get(item.id);
    return `<div class="pd-equipment-item"><label class="check"><input type="checkbox" data-equipment-id="${esc(item.id)}" ${current ? "checked" : ""}> ${esc(item.name)} · ${esc(place.get(item.location_id) || "Studio location")} <small>${esc(item.available)} available</small></label><label>Quantity<input type="number" data-equipment-quantity="${esc(item.id)}" value="${esc(current?.quantity || 1)}" min="1" max="${Math.max(1,Math.min(50,Number(item.quantity)||1))}"></label></div>`;
  }).join("")}</div>`;
}
function stepEditor(step, exercise, allSections, targets, phaseNames, clientMedia, inventory) {
  const d = stepDetail(step);
  const dose = `${step.sets || 1} × ${step.reps ?? 8}${step.seconds ? ` · ${step.seconds}s` : ""}`;
  return `<article class="pd-edit-step" draggable="true" data-step="${esc(step._uid)}"><div class="pd-edit-step-head"><span class="pd-drag" title="Drag or use arrow keys to reorder" tabindex="0" role="button" aria-label="Reorder ${esc(exercise.name)} with up and down arrow keys" aria-keyshortcuts="ArrowUp ArrowDown">⋮⋮</span><div><small>${esc(exercise.category || "Movement")}</small><strong>${esc(exercise.name)}</strong><span>${esc(dose)}</span></div><div class="pd-card-actions"><button type="button" data-step-move="-1" aria-label="Move ${esc(exercise.name)} up">↑</button><button type="button" data-step-move="1" aria-label="Move ${esc(exercise.name)} down">↓</button><button type="button" data-step-copy>Duplicate</button><button type="button" data-step-remove>Remove</button></div></div><details class="pd-step-details"><summary>Configure movement</summary><div class="pd-step-body"><div class="pd-fields-four">${field("Sets", "sets", step.sets ?? 1, "number", 'min="1" max="100"')}${field("Repetitions", "reps", step.reps ?? 8, "number", 'min="0" max="7200"')}${field("Duration · seconds", "seconds", step.seconds ?? 60, "number", 'min="0" max="7200"')}${field("Rest · seconds", "rest", step.rest ?? 20, "number", 'min="0" max="7200"')}</div><div class="pd-fields-two">${select("Section", "section", allSections.map((x) => [x,x]), d.section || step.phase || "Practice", null)}${select("Body side", "side", [["Both","Both"],["Left","Left"],["Right","Right"]], d.side || "Both", null)}</div>${area("Why this movement is assigned", "why_assigned", d.why_assigned || d.purpose || step.notes)}${area("Student instructions", "student_instructions", d.student_instructions || exercise.detail?.instructions)}${area("Coach cue", "coach_cue", d.coach_cue)}${select("Program phase", "program_phase", ["All phases", ...phaseNames].map((x)=>[x,x]), d.program_phase || "All phases", null)}<details class="pd-advanced"><summary>Advanced coaching details</summary>${area("Movement purpose · optional", "purpose", d.purpose)}<div class="pd-fields-two">${field("Tempo", "tempo", d.tempo)}${select("Difficulty", "difficulty", ["Foundation","Intermediate","Advanced"].map((x) => [x,x]), d.difficulty || exercise.difficulty || "Foundation", null)}${select("Position", "position", ["Standing","Seated","Supine","Prone","Kneeling","Side-lying","Other"].map((x) => [x,x]), d.position || "Standing", null)}${field("Primary muscles · educational", "primary_muscles", d.primary_muscles || exercise.detail?.muscles)}</div>${field("Secondary muscles · optional", "secondary_muscles", d.secondary_muscles)}${field("Resistance / band setting", "resistance", d.resistance)}<h4>Equipment for this movement</h4>${equipmentEditor(Array.isArray(d.equipment) ? d.equipment : exercise.equipment?.map((item)=>({equipment_id:item.equipment_id,quantity:item.quantity})), inventory, state.me.locations)}${area("Coach-only instruction", "coach_instructions", d.coach_instructions)}${area("Common mistake", "common_mistake", d.common_mistake)}${area("Success criteria", "success_criteria", d.success_criteria)}${area("Progression", "progression", d.progression)}${area("Regression", "regression", d.regression)}${area("Precautions", "precautions", d.precautions)}${area("Change reason / step note", "notes", step.notes)}</details><details class="pd-advanced"><summary>Body areas and evidence</summary><button type="button" data-step-atlas="${esc(step._uid)}">Select this movement’s body targets on 3D anatomy</button>${targetButtons(d.target_region_ids?.length ? d.target_region_ids : targets)}${d.source?.id ? `<p>Linked to <a href="${href("report", { id: d.source.id })}">source assessment →</a></p>` : ""}</details><details class="pd-advanced"><summary>Photos, videos and references</summary><p class="muted">Attach images and clips from this exercise or upload your own. A shared movement is copied privately before your media is added. Labels tell students whether this is a coach demonstration or library reference.</p><div class="pd-step-media">${(d.media || []).map((m,i) => mediaEditor(m,exercise,i,clientMedia)).join("")}</div><div class="pd-fields-two">${select("Existing exercise media", "existing_media", (exercise.media || []).map((m)=>[m.id,m.filename]), "", "Select photo or video")}${select("Media label", "new_media_kind", mediaKinds.filter((pair)=>pair[0]!=="client_capture"), "exercise_library", null)}</div><button type="button" data-add-existing>Add selected media</button>${clientMedia.length ? `${select("Client capture", "client_capture", clientCaptureOptions(clientMedia), "", "Choose a capture from this client")}${field("Caption for client capture", "client_capture_caption")}<button type="button" data-add-client>Attach client capture</button>` : ""}<label>Upload your photo or demonstration video<input type="file" name="step_files" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple></label><button type="button" data-record-video>Record a short coach demonstration</button><div class="pd-recorder" hidden><video autoplay muted playsinline></video><p>Show the full movement. Recording stops after 45 seconds. The clip is attached when you save this program.</p><div class="actions"><button type="button" data-record-start>Start recording</button><button type="button" data-record-stop disabled>Stop and use clip</button><button type="button" data-record-cancel>Cancel camera</button></div><p class="pd-record-status" role="status"></p></div><div class="pd-pending-media"></div><p class="pd-file-status" role="status"></p><div class="pd-step-references">${(d.references || []).map(referenceEditor).join("")}</div><button type="button" data-add-reference>+ Reference video or link</button></details></div></details></article>`;
}

export function programEditorClientContext(source, client, {report = "", finding = ""} = {}) {
  const context = structuredClone(source);
  const detail = context.detail ||= {};
  const assigned = [...new Set((context.assignments || []).map((item)=>item.student_id))];
  const sourceClient = detail.student_id || detail.source_student_id || (assigned.length === 1 ? assigned[0] : null);
  const changedClient = Boolean(sourceClient && sourceClient !== client?.id);
  const assessments = new Set((client?.analyses || [])
    .filter((item)=>!item.student_id || item.student_id === client?.id).map((item)=>item.id));
  const notes = new Set((client?.notes || []).map((item)=>item.id));
  if (changedClient) {
    for (const key of ["source_analysis_id", "source_student_id", "source_finding", "coach_notes"])
      delete detail[key];
  }
  const selectedReport = report || detail.source_analysis_id || "";
  const savedForClient = Boolean(!report && client?.id && sourceClient === client.id);
  const sourceReport = selectedReport && (assessments.has(selectedReport) || savedForClient) ? selectedReport : "";
  const sourceFinding = sourceReport ? (report ? finding : detail.source_finding || "") : "";
  detail.source_analysis_id = sourceReport || null;
  detail.source_finding = sourceFinding || null;
  context.steps = (context.steps || []).map((step)=>{
    const extra = step.detail ||= {};
    if (changedClient) {
      delete extra.why_assigned;
      extra.media = (extra.media || []).filter((entry)=>entry.kind !== "client_capture");
    }
    if (extra.source?.id && !savedForClient && !(extra.source.kind === "analysis" ? assessments : notes).has(extra.source.id))
      delete extra.source;
    return step;
  });
  return {source:context, sourceReport, sourceFinding, changeAnalysis:report && sourceReport ? sourceReport : ""};
}

export async function programEditor(id, copy = false, addPhase = false) {
  let source = id ? await record("programs", id) : {};
  if (copy) id = null;
  const assignedClients = [...new Set((source.assignments || []).map((assignment) => assignment.student_id))];
  const clientId = params().get("client") || state.client?.id || source.detail?.student_id || source.detail?.source_student_id ||
    (assignedClients.length === 1 ? assignedClients[0] : null);
  const clientForVisits = clientId
    ? (state.client?.id === clientId ? state.client : await api("client?id=" + encodeURIComponent(clientId)))
    : null;
  const visitEntries = revisionVisitOptions(clientForVisits);
  const selectedVisit = params().get("session") || "";
  const context = programEditorClientContext(source, clientForVisits,
    {report:params().get("report") || "",finding:params().get("finding") || ""});
  source = context.source;
  const {changeAnalysis, sourceReport, sourceFinding} = context;
  const sourceRegion = params().get("region") || source.region_id || "";
  const [first, inventoryResult] = await Promise.all([list("exercises", { limit: 50 }), list("equipment", { limit: 200 })]);
  const inventory = inventoryResult.items;
  const clientMedia = clientId ? (await list("media",{student_id:clientId,limit:200})).items.filter((m)=>m.kind==="capture" && /^(image|video)\//.test(m.mime)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,40) : [];
  const exerciseMap = new Map(first.items.map((e) => [e.id,e]));
  for (const eid of [...new Set((source.steps || []).map((step) => step.exercise_id).filter(Boolean))]) {
    try { exerciseMap.set(eid, await record("exercises", eid)); } catch { /* removed legacy movement */ }
  }
  const base = source.detail || {};
  let selectedTargets = [...new Set([...(base.target_region_ids || []), sourceRegion].filter(Boolean))];
  const targetReasons = {...(base.target_explanations || {})};
  if (sourceRegion && sourceFinding && !targetReasons[sourceRegion]) targetReasons[sourceRegion] = `Linked to assessment finding: ${sourceFinding.replaceAll("_", " ")}.`;
  let sections = [...new Set([...(base.sections || []), ...(source.steps || []).map((s) => s.section || stepDetail(s).section || s.phase)].filter(Boolean))];
  if (!sections.length) sections = ["Warm-up", "Practice", "Cooldown"];
  let steps = (source.steps || []).map((s) => ({...structuredClone(s), _uid:sid(), detail:stepDetail(s)}));
  let phases = structuredClone(base.phases?.length ? base.phases : [{name:base.phase || "Foundation",weeks_start:1,weeks_end:base.duration_weeks || 4,goal:""}]);
  const pendingFiles = new Map();
  const pendingPreviews = new Map();
  let cameraController = null;
  let cameraToken = 0;
  const formatName = copy ? `Copy of ${source.name || ""}` : source.name || "";
  const html = `<div class="program-designer"><div class="pd-editor-lead"><div class="pd-eyebrow">COACH PROGRAM DESIGNER ${clientId ? `· ${esc(state.client?.name || "Selected client")}` : ""}</div><p>Build a plan that explains the movement, its body targets, the coach’s reasoning and how to practice it.</p></div><section class="pd-editor-section"><div class="pd-section-title"><span>01</span><div><h3>Plan</h3><p>Give the client a clear goal and a realistic schedule.</p></div></div>${field("Program name", "name", formatName, "text", "required")}${area("Main goal", "goal", source.goal)}<div class="pd-fields-two">${area("Description", "description", base.description)}${area("Coach planning notes · staff only", "coach_notes", base.coach_notes)}</div><details class="pd-advanced"><summary>Schedule, phase and status</summary><div class="pd-fields-four">${field("Start date", "start_date", base.start_date || new Date().toISOString().slice(0,10), "date")}${field("Expected duration · weeks", "duration_weeks", base.duration_weeks || 4, "number", 'min="1" max="104"')}${field("Sessions each week", "sessions_per_week", base.sessions_per_week || 2, "number", 'min="1" max="14"')}${select("Status", "status", statuses.map((x)=>[x,x]), base.status || "Draft", null)}</div><div class="pd-fields-two">${select("Program phase", "current_program_phase", phaseChoices.map((x)=>[x,x]), base.phase || "Foundation", null)}${select("Location", "location_id", state.me.locations, source.location_id || state.client?.location_ids?.[0], "Any assigned location")}</div><div id="pd-phase-rows"></div><button type="button" id="pd-add-phase">+ Program phase</button><label class="check"><input type="checkbox" name="template" ${base.template ? "checked" : ""}> Save as an editable template</label></details></section><section class="pd-editor-section"><div class="pd-section-title"><span>02</span><div><h3>Body targets</h3><p>Select the regions discussed in your analysis and coaching feedback.</p></div></div><div id="pd-target-picker">${targetButtons(selectedTargets)}</div><details class="pd-atlas-disclosure"><summary>Select on 3D anatomy</summary><button type="button" id="pd-atlas-plan-target">Select for whole plan</button>${clientId ? `<iframe class="pd-atlas" title="Select program target body areas" loading="lazy" data-src="/anatomy.html?${new URLSearchParams({ platform: "1", client: clientId, region: selectedTargets[0] || regions()[0]?.id || "" })}"></iframe><p class="muted" id="pd-atlas-status">Click an anatomical structure to add its mapped body region. The region buttons above work if 3D is unavailable.</p>` : `<p>Select a client before using the connected 3D body. The region buttons above remain available.</p>`}</details></section><section class="pd-editor-section"><div class="pd-section-title"><span>03</span><div><h3>Sequence</h3><p>Drag movement cards to reorder. Open a card for prescription, guidance, photos, video and references.</p></div></div><div class="pd-builder-toolbar"><div>${field("Search the exercise library", "exercise_search", "", "search")}${select("Movement to add", "exercise_id", [...exerciseMap.values()], "", "Choose a movement")}</div><button type="button" id="pd-add-exercise" class="primary">+ Add movement</button><button type="button" id="pd-add-section">+ Section</button><button type="button" id="pd-add-note">+ Note</button><button type="button" id="pd-new-exercise">+ Custom exercise</button></div><div id="pd-custom-exercise" hidden><h4>Create a custom movement</h4><div class="pd-fields-two">${field("Movement name", "custom_name")}${select("Category", "custom_category", ["Yoga","Pilates","Mobility","Flexibility","Strength","Balance","Breathing","Recovery"].map((x)=>[x,x]), "Mobility", null)}${select("Main body region", "custom_region", regions(), sourceRegion)}${select("Save to", "custom_scope", [["program","Only this client program"],["private","My exercise library"],["organization","Organization exercise library"]], "program", null)}</div>${area("What should the student do?", "custom_instruction")}<button type="button" class="primary" id="pd-save-custom">Create and add</button><p id="pd-custom-status" role="status"></p></div><div id="pd-section-name-editor" class="pd-note-fields" hidden><h4 id="pd-section-name-heading">Add a section</h4>${field("Section name", "section_name", "", "text", 'maxlength="120"')}<p id="pd-section-name-status" role="status"></p><button type="button" id="pd-apply-section-name">Add section</button> <button type="button" id="pd-cancel-section-name">Cancel section change</button></div><div id="pd-sections"></div></section><section class="pd-editor-section"><div class="pd-section-title"><span>04</span><div><h3>Change context</h3><p>Explain why you changed an active plan. Each save creates a reviewable version.</p></div></div><div class="pd-fields-two">${field("Reason for this version · optional", "change_reason", "")}${select("Reason source", "change_kind", [["manual","Manual coach decision"],["analysis","Movement or posture analysis"],["coach_observation","Coach observation"],["client_feedback","Client feedback"]], changeAnalysis ? "analysis" : "manual", null)}</div>${select("Related assessment or feedback", "change_source_id", [], sourceReport, "Choose a source record")}${clientId ? `${select("Related client visit · optional", "change_visit_id", visitEntries, selectedVisit, "No visit linked to this version")}<p class="muted">Choose the exact visit that led to this change, including a visit with practice but no assessment.</p>` : ""}${sourceReport ? `<p class="pd-source-link">Plan evidence: <a href="${href("report", { id: sourceReport, client: clientId })}">Open source assessment</a>${sourceFinding ? ` · ${esc(sourceFinding.replaceAll("_"," "))}` : ""}</p>` : ""}</section><p id="pd-upload-status" role="status"></p></div>`;
  const dialog = modal(copy ? "Duplicate program" : id ? "Edit program" : "Create program", html, async (formData, form) => {
    if (cameraController?.recording) throw Error("Stop and use the coach recording before saving the program.");
    readAll();
    dialog.querySelectorAll("[data-target-reason]").forEach((input)=>targetReasons[input.dataset.targetReason]=input.value);
    const values = Object.fromEntries(formData);
    readPhases();
    if (!phases.some((phase)=>phase.name===planPhaseFromForm(formData))) throw Error("Choose a current phase from the phase schedule.");
    if (!steps.some((s)=>s.exercise_id)) throw Error("Add at least one movement before saving the program.");
    if (!selectedTargets.length) throw Error("Select at least one target body region.");
    for (const step of steps) {
      const files = pendingFiles.get(step._uid) || [];
      if (!files.length) continue;
      const exercise = await editableExerciseForUpload(step, exerciseMap);
      for (const entry of [...files]) {
        const {file} = entry;
        form.querySelector("#pd-upload-status").textContent = `Uploading ${file.name}…`;
        const media = await upload(file,{kind:"exercise",exercise_id:step.exercise_id},n => form.querySelector("#pd-upload-status").textContent = `Uploading ${file.name} · ${n}%`);
        step.detail.media = appendCoachMedia(step.detail.media || [], file, media.id, entry);
        exercise.media = [...(exercise.media || []), media];
        const preview = pendingPreviews.get(file);
        if (preview) URL.revokeObjectURL(preview);
        pendingPreviews.delete(file);
        files.shift();
        if (!files.length) pendingFiles.delete(step._uid);
        // A later upload or revision error must leave the successful media in
        // the editor, so retrying does not upload a second copy or lose it.
        draw();
      }
    }
    const ordered = orderedStepsBySection(steps, sections);
    const cleaned = ordered.map(({_uid,...step},i) => ({...step,position:i,phase:step.detail?.section || step.section || step.phase || "Practice"}));
    const detail = {
      ...base, copied_from:copy ? source.id : base.copied_from,
      description:values.description,coach_notes:values.coach_notes,
      status:values.status,phase:planPhaseFromForm(formData),start_date:values.start_date,
      duration_weeks:Number(values.duration_weeks),sessions_per_week:Number(values.sessions_per_week),
      target_region_ids:selectedTargets,target_explanations:targetReasons,sections,phases,template:form.querySelector('[name=template]').checked,
      student_id:clientId || base.student_id || null,
      source_student_id:clientId || base.source_student_id || null,
      source_analysis_id:sourceReport || null,
      source_finding:sourceFinding || null,
      frequency:`${values.sessions_per_week} sessions weekly`,
      duration:duration(cleaned),
    };
    const assignedClients = new Set((source.assignments || []).map((assignment)=>assignment.student_id));
    if (id && clientId && (assignedClients.size > 1 || (assignedClients.size === 1 && !assignedClients.has(clientId)))) {
      source = await api("program/duplicate",{program_id:id,student_id:clientId,replace:true,name:values.name});
      id = source.id;
      toast("A client-specific copy was created so other clients keep their original plan.");
    }
    const needsAssignment = clientId && (!id || !(source.assignments || []).some((assignment) =>
      assignment.student_id === clientId && assignment.active));
    const saved = await api("save",{collection:"programs",item:{id,name:values.name,goal:values.goal,
      region_id:selectedTargets[0],location_id:values.location_id || null,detail,steps:cleaned,
      change_reason:values.change_reason || "",change_source:{kind:values.change_kind,id:values.change_kind === "manual" ? null : values.change_source_id || null},
      change_visit_id:values.change_visit_id || null}});
    id = saved.id;
    if (needsAssignment) {
      await api("assign", {
        student_id: clientId,
        program_id: saved.id,
        analysis_id: sourceReport || null,
        notes: "",
      });
    }
    go("program",{id:saved.id,client:clientId || ""});
  });
  dialog.classList.add("pd-dialog");
  const find = (s) => dialog.querySelector(s);
  function closeCamera() {
    cameraToken++;
    cameraController?.dispose();
    cameraController = null;
  }
  const cleanup = () => {
    closeCamera();
    pendingPreviews.forEach((url) => URL.revokeObjectURL(url));
    pendingPreviews.clear();
  };
  let closed = false;
  dialog.addEventListener("close", () => { closed = true; cleanup(); }, {once:true});
  state.dispose.push(() => { if (!closed) { if (dialog.open) dialog.close(); else cleanup(); } });
  function queueFile(el, file) {
    const uid = el.dataset.step;
    const items = pendingFiles.get(uid) || [];
    const existing = steps.find((step) => step._uid === uid)?.detail?.media || [];
    const valid = ["image/jpeg","image/png","image/webp","video/mp4","video/webm"].includes(file.type);
    if (!valid) { el.querySelector(".pd-file-status").textContent = "Use a JPEG, PNG, WebP, MP4 or WebM file."; return false; }
    if (file.size > (file.type.startsWith("image/") ? 12 : 64) * 1024 * 1024) {
      el.querySelector(".pd-file-status").textContent = "This file is too large for exercise media."; return false;
    }
    if (items.length + existing.length >= 16) {
      el.querySelector(".pd-file-status").textContent = "Attach at most 16 photos or videos to one movement."; return false;
    }
    items.push({file,caption:"",primary:file.type.startsWith("video/") && !existing.some((m)=>m.primary) && !items.some((m)=>m.primary)});
    pendingFiles.set(uid, items);
    renderPending(el);
    return true;
  }
  function renderPending(el) {
    const items = pendingFiles.get(el.dataset.step) || [];
    el.querySelector(".pd-pending-media").innerHTML = items.map((item, index) => {
      const video = item.file.type.startsWith("video/");
      if (video && !pendingPreviews.has(item.file)) pendingPreviews.set(item.file, URL.createObjectURL(item.file));
      return `<div class="pd-pending-item" data-pending="${index}"><strong>${esc(item.file.name)}</strong>${video ? `<video controls preload="metadata" src="${esc(pendingPreviews.get(item.file))}"></video>` : ""}${field("Caption for this media", "pending_caption", item.caption)}${video ? `<label class="check"><input type="checkbox" name="pending_primary" ${item.primary ? "checked" : ""}> Primary demonstration</label>` : ""}<button type="button" data-remove-pending="${index}">Remove queued file</button></div>`;
    }).join("");
    el.querySelector(".pd-file-status").textContent = items.length ? `${items.length} file(s) ready to attach when you save this program.` : "";
    el.querySelectorAll(".pd-pending-item").forEach((row) => {
      const index = Number(row.dataset.pending);
      row.querySelector('[name=pending_caption]').oninput = (event) => { items[index].caption = event.target.value; };
      if (row.querySelector('[name=pending_primary]')) row.querySelector('[name=pending_primary]').onchange = (event) => {
        items.forEach((item, i) => { item.primary = event.target.checked && i === index; });
        renderPending(el);
      };
      row.querySelector('[data-remove-pending]').onclick = () => {
        const [removed] = items.splice(index,1);
        const preview = pendingPreviews.get(removed.file);
        if (preview) URL.revokeObjectURL(preview);
        pendingPreviews.delete(removed.file);
        if (!items.length) pendingFiles.delete(el.dataset.step);
        renderPending(el);
      };
    });
  }
  const updateSource = () => {
    const kind = find("[name=change_kind]").value;
    const visitId = find("[name=change_visit_id]")?.value;
    const entries = revisionSourceOptions(clientForVisits, kind, visitId);
    if (kind === "analysis" && changeAnalysis && !visitId && !entries.some(([id])=>id===changeAnalysis)) entries.unshift([changeAnalysis,"Linked assessment"]);
    find("[name=change_source_id]").innerHTML = options(entries, kind === "analysis" ? changeAnalysis : "", kind === "manual" ? "Manual decision · no linked record" : "Choose a source record");
    find("[name=change_source_id]").disabled = kind === "manual";
  };
  find("[name=change_kind]").onchange = updateSource;
  if (find("[name=change_visit_id]")) find("[name=change_visit_id]").onchange = updateSource;
  updateSource();
  const selected = () => [...selectedTargets];
  function renderTargets() {
    find("#pd-target-picker").querySelectorAll("[data-target-reason]").forEach((input)=>targetReasons[input.dataset.targetReason]=input.value);
    find("#pd-target-picker").innerHTML = targetButtons(selectedTargets) + `<div class="pd-target-reasons">${selectedTargets.map((id)=>field(`Why ${regionName(id)} is targeted`, `reason_${id}`, targetReasons[id] || "")).join("")}</div>`;
    find("#pd-target-picker").querySelectorAll(".pd-target-reasons input").forEach((input,index)=>{input.dataset.targetReason=selectedTargets[index];input.oninput=()=>{targetReasons[input.dataset.targetReason]=input.value;};});
    find("#pd-target-picker").querySelectorAll("[data-target]").forEach((button) => button.onclick = () => {
      const id = button.dataset.target;
      if (!selectedTargets.includes(id) && selectedTargets.length >= 20) return toast("Choose up to 20 body regions.");
      selectedTargets = selectedTargets.includes(id) ? selectedTargets.filter((x)=>x!==id) : [...selectedTargets,id];
      renderTargets();
    });
  }
  renderTargets();
  let targetStepUid = null;
  const frame = find(".pd-atlas");
  const atlasDisclosure = find(".pd-atlas-disclosure");
  find("#pd-atlas-plan-target").onclick = () => {
    targetStepUid = null;
    dialog.querySelectorAll("[data-step-atlas]").forEach((button)=>button.setAttribute("aria-pressed", "false"));
    if (frame) find("#pd-atlas-status").textContent = "Selecting targets for the whole plan. Click a mapped structure or use the region buttons.";
  };
  if (frame) {
    atlasDisclosure.ontoggle = (event) => { if (event.target.open && !frame.getAttribute("src")) frame.src = frame.dataset.src; };
    const listener = (event) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === "motion-atlas-selection") {
        const region = event.data.region_id;
        if (!region || !regions().some((item)=>item.id === region)) {
          find("#pd-atlas-status").textContent = "This structure does not map to a selectable body region. Try another structure or use the region buttons.";
          return;
        }
        if (targetStepUid) {
          const step = steps.find((item)=>item._uid === targetStepUid);
          if (step) {
            const targets = new Set(step.detail?.target_region_ids || []);
            if (!targets.has(region) && targets.size >= 20) return toast("Choose up to 20 body regions for each movement.");
            if (!selectedTargets.includes(region) && selectedTargets.length >= 20) return toast("Choose up to 20 body regions for the whole plan.");
            targets.add(region);
            step.detail = {...(step.detail || {}), target_region_ids:[...targets]};
            const card = [...dialog.querySelectorAll(".pd-edit-step")].find((item)=>item.dataset.step === targetStepUid);
            const button = [...(card?.querySelectorAll(".pd-target") || [])].find((item)=>item.dataset.target === region);
            button?.classList.add("selected");
            button?.setAttribute("aria-pressed", "true");
            const name = card?.querySelector(".pd-edit-step-head strong")?.textContent || "this movement";
            find("#pd-atlas-status").textContent = `${regionName(region)} added to ${name}. Continue clicking to add more regions, or choose the whole plan above.`;
          }
        } else {
          if (!selectedTargets.includes(region) && selectedTargets.length >= 20) return toast("Choose up to 20 body regions.");
          if (!selectedTargets.includes(region)) selectedTargets.push(region);
          find("#pd-atlas-status").textContent = `${regionName(region)} added to program targets.`;
        }
        if (!selectedTargets.includes(region) && selectedTargets.length < 20) selectedTargets.push(region);
        renderTargets();
      } else if (event.data?.type === "motion-atlas-error") find("#pd-atlas-status").textContent = "3D is unavailable in this browser. Select body regions with the buttons above.";
    };
    window.addEventListener("message", listener);
    dialog.addEventListener("close", () => window.removeEventListener("message",listener),{once:true});
  }
  function readPhases() {
    phases = [...dialog.querySelectorAll(".pd-phase-row")].map((el)=>({
      name:el.querySelector("[name=phase_name]").value.trim(),
      weeks_start:Number(el.querySelector("[name=phase_start]").value),
      weeks_end:Number(el.querySelector("[name=phase_end]").value),
      goal:el.querySelector("[name=phase_goal]").value.trim(),
    })).filter((phase)=>phase.name);
  }
  function drawPhases() {
    find("#pd-phase-rows").innerHTML = phases.map((phase,index)=>`<div class="pd-phase-row"><div class="pd-fields-four">${field("Phase name", "phase_name", phase.name)}${field("From week", "phase_start", phase.weeks_start || 1, "number", "min=\"1\"")}${field("Through week", "phase_end", phase.weeks_end || 4, "number", "min=\"1\"")}${field("Phase goal", "phase_goal", phase.goal)}</div><button type="button" data-remove-phase="${index}" ${phases.length === 1 ? "disabled" : ""}>Remove phase</button></div>`).join("");
    const currentPhase = find("[name=current_program_phase]").value;
    find("[name=current_program_phase]").innerHTML = options(phases.map((p)=>[p.name,p.name]), phases.some((p)=>p.name===currentPhase) ? currentPhase : (base.phase || phases[0]?.name), null);
    find("#pd-phase-rows").querySelectorAll("[data-remove-phase]").forEach((b)=>b.onclick=()=>{readAll();readPhases();phases.splice(Number(b.dataset.removePhase),1);drawPhases();draw();});
    find("#pd-phase-rows").querySelectorAll("[name=phase_name]").forEach((input)=>input.onchange=()=>{readAll();readPhases();drawPhases();draw();});
  }
  find("#pd-add-phase").onclick=()=>{
    readAll();
    readPhases();
    let next;
    try { next = nextProgramPhase(phases); } catch (error) { return toast(error.message); }
    phases.push(next);
    drawPhases();
    find("[name=current_program_phase]").value = next.name;
    const durationInput = find("[name=duration_weeks]");
    durationInput.value = String(Math.max(Number(durationInput.value) || 0, next.weeks_end));
    draw();
  };
  drawPhases();
  if (addPhase) {
    find(".pd-advanced").open = true;
    find("#pd-add-phase").click();
  }
  function readStep(element) {
    const step = steps.find((s)=>s._uid === element.dataset.step);
    if (!step) return;
    if (step.type === "note") {
      step.text = element.querySelector("[name=note_text]")?.value || "";
      step.visibility = element.querySelector("[name=note_visibility]")?.value || "student";
      step.section = element.querySelector("[name=note_section]")?.value || "Practice";
      return;
    }
    const detailFields = ["why_assigned","purpose","student_instructions","coach_instructions","coach_cue","tempo",
      "difficulty","position","primary_muscles","secondary_muscles","resistance","common_mistake","success_criteria",
      "progression","regression","precautions","side","program_phase"];
    const detail = Object.fromEntries(detailFields.map((key) =>
      [key, element.querySelector("[name=" + key + "]")?.value || ""]));
    detail.section = element.querySelector('[name=section]')?.value || "Practice";
    Object.assign(step, configureStep(step, {
      ...Object.fromEntries(["sets","reps","seconds","rest"].map((key) =>
        [key, element.querySelector("[name=" + key + "]")?.value || 0])),
      notes: element.querySelector('[name=notes]')?.value || "",
      detail,
    }));
    if (step.detail.program_phase === "All phases") delete step.detail.program_phase;
    step.detail.references = [...element.querySelectorAll(".pd-reference-row")].map((el)=>({
      title:el.querySelector('[name=ref_title]').value,url:el.querySelector('[name=ref_url]').value,
      type:el.querySelector('[name=ref_type]').value,description:el.querySelector('[name=ref_description]').value,
      visibility:el.querySelector('[name=ref_visibility]').value,
    })).filter((r)=>r.url || r.title);
    step.detail.media = [...element.querySelectorAll(".pd-media-row")].map((el)=>({
      media_id:el.dataset.mediaId || step.detail.media?.[Number(el.dataset.media)]?.media_id,
      kind:el.querySelector('[name=media_kind]').value,caption:el.querySelector('[name=media_caption]').value,
      stage:el.querySelector('[name=media_stage]').value,visibility:el.querySelector('[name=media_visibility]').value,
      primary:el.querySelector('[name=media_primary]').checked,
    })).filter((m)=>m.media_id);
    step.detail.target_region_ids = [...element.querySelectorAll(".pd-target.selected")].map((b)=>b.dataset.target);
    step.detail.equipment = [...element.querySelectorAll("[data-equipment-id]:checked")].map((input)=>({
      equipment_id:input.dataset.equipmentId,
      quantity:Number(element.querySelector(`[data-equipment-quantity="${CSS.escape(input.dataset.equipmentId)}"]`)?.value || 1),
    }));
  }
  function readAll() { dialog.querySelectorAll(".pd-edit-step").forEach(readStep); }
  let dragged = null;
  function draw() {
    closeCamera();
    const groups = sections.map((name)=>({name,steps:steps.filter((s)=>(s.section || s.detail?.section || s.phase || "Practice")===name)}));
    find("#pd-sections").innerHTML = groups.map((g)=>`<section class="pd-builder-section" data-section="${esc(g.name)}"><header><div><span>${esc(g.name)}</span><small>${g.steps.filter((step)=>step.exercise_id).length} movements${g.steps.some((step)=>step.type === "note") ? ` · ${g.steps.filter((step)=>step.type === "note").length} coaching notes` : ""}</small></div><button type="button" data-rename-section="${esc(g.name)}">Rename</button><button type="button" data-remove-section="${esc(g.name)}" ${g.steps.length ? "disabled title=\"Move exercises to another section first\"" : ""}>Remove</button></header><div class="pd-section-drop" data-drop="${esc(g.name)}">${g.steps.map((s)=>s.type === "note" ? `<article class="pd-edit-step pd-edit-note" draggable="true" data-step="${esc(s._uid)}"><div class="pd-edit-step-head"><span class="pd-drag" title="Drag or use arrow keys to reorder" tabindex="0" role="button" aria-label="Reorder coaching note with up and down arrow keys" aria-keyshortcuts="ArrowUp ArrowDown">⋮⋮</span><strong>Coaching note between movements</strong><div class="pd-card-actions"><button type="button" data-step-move="-1" aria-label="Move coaching note up">↑</button><button type="button" data-step-move="1" aria-label="Move coaching note down">↓</button><button type="button" data-step-copy>Duplicate</button><button type="button" data-step-remove>Remove</button></div></div><div class="pd-note-fields">${area("Note text", "note_text", s.text)}<div class="pd-fields-two">${select("Section", "note_section", sections.map((x)=>[x,x]), s.section || "Practice", null)}${select("Visible to", "note_visibility", [["student","Student and coach"],["coach","Coach only"]], s.visibility || "student", null)}</div></div></article>` : stepEditor(s,exerciseMap.get(s.exercise_id)||{name:"Unavailable exercise",detail:{}},sections,selected(),phases.map((phase)=>phase.name),clientMedia,inventory)).join("") || '<p class="pd-drop-empty">Drag a movement here or choose one from the library.</p>'}</div></section>`).join("");
    if (targetStepUid && !steps.some((step)=>step._uid===targetStepUid)) targetStepUid = null;
    dialog.querySelectorAll(".pd-edit-step").forEach((el) => {
      el.querySelectorAll(".pd-target").forEach((b)=>b.onclick=()=>{ b.classList.toggle("selected"); b.setAttribute("aria-pressed",b.classList.contains("selected")); });
      el.querySelector("[data-step-atlas]")?.setAttribute("aria-pressed", String(el.dataset.step === targetStepUid));
      if (el.querySelector("[data-step-atlas]")) el.querySelector("[data-step-atlas]").onclick=()=>{
        if (!frame) return toast("Choose a client to use the connected 3D body. The body-region buttons still work here.");
        readAll();
        targetStepUid = el.dataset.step;
        dialog.querySelectorAll("[data-step-atlas]").forEach((button)=>button.setAttribute("aria-pressed", String(button.dataset.stepAtlas === targetStepUid)));
        atlasDisclosure.open = true;
        if (!frame.getAttribute("src")) frame.src = frame.dataset.src;
        find("#pd-atlas-status").textContent = `Selecting body targets for ${el.querySelector(".pd-edit-step-head strong")?.textContent || "this movement"}. Click a mapped structure.`;
        atlasDisclosure.scrollIntoView({behavior:"smooth",block:"start"});
      };
      el.querySelector('[data-step-move="-1"]').onclick=()=>moveStep(el,-1,'[data-step-move="-1"]');
      el.querySelector('[data-step-move="1"]').onclick=()=>moveStep(el,1,'[data-step-move="1"]');
      el.querySelector('.pd-drag').onkeydown=(event)=>{
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        moveStep(el,event.key === "ArrowUp" ? -1 : 1,'.pd-drag');
      };
      el.querySelector('[data-step-copy]').onclick=()=>{readAll(); const i=steps.findIndex((s)=>s._uid===el.dataset.step); const clone=structuredClone(steps[i]);clone._uid=sid();steps.splice(i+1,0,clone);draw();};
      el.querySelector('[data-step-remove]').onclick=()=>{readAll();steps=removeStep(steps,el.dataset.step);pendingFiles.delete(el.dataset.step);draw();};
      if (el.querySelector('[name=step_files]')) el.querySelector('[name=step_files]').onchange=(event)=>{[...event.target.files].forEach((file)=>queueFile(el,file));event.target.value="";};
      if (el.querySelector('[data-record-video]')) el.querySelector('[data-record-video]').onclick=async()=>{
        closeCamera();
        const token = cameraToken;
        const panel = el.querySelector('.pd-recorder');
        const message = panel.querySelector('.pd-record-status');
        panel.hidden = false;
        message.textContent = "Opening your camera…";
        panel.querySelector('[data-record-start]').disabled = true;
        panel.querySelector('[data-record-stop]').disabled = true;
        try {
          const controller = await openCoachCamera(panel.querySelector('video'), {
            onTick: (seconds) => { message.textContent = `Recording ${seconds} of 45 seconds…`; },
            onRecorded: (file) => {
              if (token !== cameraToken || !dialog.open) return;
              const queued = queueFile(el,file);
              message.textContent = queued
                ? "Clip ready. Add a caption, then save the program to share it with the student."
                : el.querySelector('.pd-file-status').textContent;
              panel.querySelector('[data-record-stop]').disabled = true;
              cameraController = null;
            },
            onError: (error) => { message.textContent = error; panel.querySelector('[data-record-stop]').disabled = true; cameraController = null; },
          });
          if (token !== cameraToken || !dialog.open) { controller.dispose(); return; }
          cameraController = controller;
          message.textContent = "Camera ready. Start when the movement is in frame.";
          panel.querySelector('[data-record-start]').disabled = false;
        } catch (error) { message.textContent = error.message; }
        panel.querySelector('[data-record-start]').onclick=()=>{
          try { cameraController?.start(); panel.querySelector('[data-record-start]').disabled=true; panel.querySelector('[data-record-stop]').disabled=false; }
          catch (error) { message.textContent=error.message; closeCamera(); }
        };
        panel.querySelector('[data-record-stop]').onclick=()=>{
          panel.querySelector('[data-record-stop]').disabled=true;
          message.textContent="Preparing the clip…";
          cameraController?.stop();
        };
        panel.querySelector('[data-record-cancel]').onclick=()=>{closeCamera();panel.hidden=true;};
      };
      if (el.querySelector('.pd-pending-media')) renderPending(el);
      if (el.querySelector('[data-add-existing]')) el.querySelector('[data-add-existing]').onclick=()=>{readAll();const step=steps.find((s)=>s._uid===el.dataset.step);const mid=el.querySelector('[name=existing_media]').value;if(!mid)return;const kind=el.querySelector('[name=new_media_kind]').value;step.detail.media=[...(step.detail.media||[]),{media_id:mid,kind,caption:"",primary:isVideo((exerciseMap.get(step.exercise_id)?.media || []).find((m)=>m.id===mid)) && !(step.detail.media||[]).some((m)=>m.primary),visibility:"student",stage:"other"}];draw();};
      if (el.querySelector('[data-add-client]')) el.querySelector('[data-add-client]').onclick=()=>{readAll();const step=steps.find((s)=>s._uid===el.dataset.step);const mid=el.querySelector('[name=client_capture]').value;if(!mid)return;step.detail.media=[...(step.detail.media||[]),{media_id:mid,kind:"client_capture",caption:el.querySelector('[name=client_capture_caption]').value,primary:false,visibility:"student",stage:"other"}];draw();};
      if (el.querySelector('[data-add-reference]')) el.querySelector('[data-add-reference]').onclick=()=>{readAll();const step=steps.find((s)=>s._uid===el.dataset.step);step.detail.references=[...(step.detail.references||[]),{title:"",url:"",type:"video",visibility:"student"}];draw();};
      el.querySelectorAll('[data-remove-ref]').forEach((b)=>b.onclick=()=>{readAll();const step=steps.find((s)=>s._uid===el.dataset.step);step.detail.references.splice(Number(b.dataset.removeRef),1);draw();});
      el.querySelectorAll('[data-remove-media]').forEach((b)=>b.onclick=()=>{readAll();const step=steps.find((s)=>s._uid===el.dataset.step);step.detail.media.splice(Number(b.dataset.removeMedia),1);draw();});
      el.ondragstart=(event)=>{ if(event.target.closest('input,textarea,select,button')){event.preventDefault();return;} readAll();dragged=el.dataset.step;event.dataTransfer.effectAllowed="move";};
      el.ondragend=()=>{dragged=null;};
      el.ondragover=(event)=>event.preventDefault();
      el.ondrop=(event)=>{event.preventDefault();event.stopPropagation();if(!dragged)return;readAll();steps=moveStepBefore(steps,dragged,el.dataset.step,sections);dragged=null;draw();};
    });
    dialog.querySelectorAll('[data-drop]').forEach((zone)=>{
      zone.ondragover=(event)=>event.preventDefault();zone.ondrop=(event)=>{event.preventDefault();if(!dragged)return;readAll();steps=moveStepToSectionEnd(steps,dragged,zone.dataset.drop,sections);dragged=null;draw();};
    });
    dialog.querySelectorAll('[data-rename-section]').forEach((button)=>button.onclick=()=>openSectionNameEditor(button.dataset.renameSection));
    dialog.querySelectorAll('[data-remove-section]').forEach((b)=>b.onclick=()=>{readAll();sections=sections.filter((s)=>s!==b.dataset.removeSection);draw();});
  }
  function moveStep(el,delta,focusSelector) {
    readAll();
    const uid=el.dataset.step;
    steps=reorderStep(steps,uid,delta,sections);
    draw();
    dialog.querySelectorAll('.pd-edit-step').forEach((card)=>{
      if(card.dataset.step===uid)card.querySelector(focusSelector)?.focus();
    });
  }
  find("#pd-add-exercise").onclick=async()=>{readAll();const eid=find('[name=exercise_id]').value;if(!eid)return toast("Choose an exercise first.");try{exerciseMap.set(eid,await record("exercises",eid));}catch(e){return toast(e.message);}const section=sections[0]||"Practice";steps.push(exerciseStep(exerciseMap.get(eid),{uid:sid(),section,targets:selected(),analysisId:sourceReport}));draw();};
  find("#pd-add-note").onclick=()=>{readAll();steps.push({_uid:sid(),type:"note",text:"",section:sections[0]||"Practice",phase:sections[0]||"Practice",visibility:"student"});draw();};
  let renamedSection = null;
  function openSectionNameEditor(old = null) {
    readAll();
    renamedSection = old;
    find("#pd-section-name-editor").hidden = false;
    find("#pd-section-name-heading").textContent = old ? "Rename section" : "Add a section";
    find("#pd-apply-section-name").textContent = old ? "Rename section" : "Add section";
    find("[name=section_name]").value = old || "";
    find("#pd-section-name-status").textContent = "";
    find("[name=section_name]").focus();
  }
  function applySectionName() {
    const name = find("[name=section_name]").value.trim();
    const status = find("#pd-section-name-status");
    if (!name) { status.textContent = "Enter a section name."; return; }
    if (sections.includes(name) && name !== renamedSection) {
      status.textContent = "That section already exists. Choose a different name."; return;
    }
    readAll();
    if (renamedSection) {
      sections = sections.map((section)=>section===renamedSection ? name : section);
      steps.forEach((step)=>{
        if (step.type === "note" && step.section === renamedSection) step.section = name;
        else if (step.detail?.section === renamedSection) step.detail.section = name;
      });
    } else sections.push(name);
    find("#pd-section-name-editor").hidden = true;
    draw();
    find("#pd-add-section").focus();
  }
  find("#pd-add-section").onclick = ()=>openSectionNameEditor();
  find("#pd-apply-section-name").onclick = applySectionName;
  find("#pd-cancel-section-name").onclick = ()=>{
    find("#pd-section-name-editor").hidden = true;
    find("#pd-add-section").focus();
  };
  find("[name=section_name]").onkeydown = (event)=>{
    if (event.key === "Enter") { event.preventDefault(); applySectionName(); }
    if (event.key === "Escape") { event.preventDefault(); find("#pd-cancel-section-name").click(); }
  };
  find("#pd-new-exercise").onclick=()=>{find("#pd-custom-exercise").hidden=!find("#pd-custom-exercise").hidden;};
  find("#pd-save-custom").onclick=async()=>{
    const box=find("#pd-custom-exercise");const name=box.querySelector('[name=custom_name]').value.trim();if(!name)return box.querySelector('#pd-custom-status').textContent="Name the movement first.";
    const scope=box.querySelector('[name=custom_scope]').value;
    try { const result=await api("save",{collection:"exercises",item:{name,category:box.querySelector('[name=custom_category]').value,difficulty:"Foundation",region_id:box.querySelector('[name=custom_region]').value||selectedTargets[0]||null,visibility:scope==="organization"?"organization":"private",detail:{description:"Coach-created movement",instructions:box.querySelector('[name=custom_instruction]').value,program_only:scope==="program"},resources:[],equipment:[]}});
      exerciseMap.set(result.id,result);readAll();const section=sections[0]||"Practice";steps.push(exerciseStep(result,{uid:sid(),section,targets:[result.region_id].filter(Boolean),analysisId:sourceReport}));draw();box.hidden=true;toast("Custom movement created and added");
    } catch(e) {box.querySelector('#pd-custom-status').textContent=e.message;}
  };
  let searchTimer,searchVersion=0;
  find('[name=exercise_search]').oninput=(event)=>{const q=event.target.value,version=++searchVersion;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{try{const result=await list("exercises",{q,limit:50});if(version!==searchVersion||!dialog.open)return;result.items.forEach((e)=>exerciseMap.set(e.id,e));find('[name=exercise_id]').innerHTML=options(result.items,"",`${result.total} matches · choose an exercise`);}catch(e){toast(e.message);}},220);};
  draw();
  return dialog;
}
