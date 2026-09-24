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
  regionName,
  bindButtons,
  exerciseIllustration,
} from "./core.js";
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
  const latest = practice[0];
  const details = program?.detail || {};
  const total = program?.steps?.length || 0;
  const completed = latest?.completed?.length || 0;
  root.innerHTML = head(
    student ? "Your current program" : `${client.name} · program`,
    student ? "See what your coach assigned and why each movement matters." : "A client-specific plan linked to analysis, body areas and past practice.",
    student ? "" : '<button data-edit="programs" class="primary">+ Create program</button>',
  ) +
    (report || finding || contextRegion ? `<div class="pd-context-callout"><strong>From your client review</strong><p>${finding ? `Finding: ${esc(finding.replaceAll("_", " "))}. ` : ""}${contextRegion ? `Body area: ${esc(regionName(contextRegion))}. ` : ""}New and edited plans will retain this assessment connection.</p>${report ? `<a href="${href("report", { id: report, client: client.id })}">Return to assessment →</a>` : ""}</div>` : "") +
    (program ? `<section class="pd-current-dashboard"><div class="pd-current-main"><small>CURRENT PROGRAM · ${esc(details.status || "Active")}</small><h2><a href="${href("program", { id: program.id, client: client.id })}">${esc(program.name)}</a></h2><p>${esc(program.goal || details.description || "Follow your coach’s planned movement practice.")}</p><div class="pd-target-links">${(details.target_region_ids?.length ? details.target_region_ids : [program.region_id]).filter(Boolean).map((id) => `<a class="pd-region-chip" href="${href("client", { client: client.id, tab: "anatomy", region: id })}">${esc(regionName(id))} · Body map</a>`).join("")}</div><div class="actions"><a class="button primary" href="${href("program", { id: program.id, client: client.id })}">${student ? "Open today’s practice" : "Open full program"}</a>${student ? "" : `<button data-edit="programs" data-id="${esc(program.id)}">Edit program</button><details class="pd-more-actions"><summary>More program actions</summary><button id="pd-add-movement" type="button">Add exercise</button><button id="pd-new-phase" type="button">Create next phase</button><button id="pd-change-phase" type="button">Change phase</button><a class="button" href="${href("program", { id: program.id, client: client.id, history: "1" })}">View history</a><button id="pd-duplicate-client" type="button">Duplicate program</button><button id="pd-complete-program" type="button">Complete program</button></details>`}</div></div><div class="pd-current-facts"><div><strong>${esc(details.phase || "Foundation")}</strong><small>Current phase</small></div><div><strong>${esc(total)}</strong><small>Assigned movements</small></div><div><strong>${esc(practice.length)}</strong><small>Practice sessions</small></div><div><strong>${esc(total ? `${Math.round(completed / total * 100)}%` : "—")}</strong><small>Most recent session completed</small></div><div><strong>${esc(date(details.start_date))}</strong><small>Plan start</small></div><div><strong>${esc(history[0] ? date(history[0].created_at) : "—")}</strong><small>Latest revision</small></div></div></section>` : `<section class="pd-empty-plan"><h2>${student ? "No program assigned yet" : "Build a plan for this client"}</h2><p>${student ? "Your coach will assign exercises here. Previous completed sessions remain in your history." : "Start with this client’s findings, choose body targets, then create a sequence with clear instructions."}</p>${student ? "" : '<button data-edit="programs" class="primary">Create program</button>'}</section>`) +
    (!student && program ? card("Program decisions", `<p><strong>Coach note:</strong> ${esc(details.coach_notes || "No coach planning note yet.")}</p><p><strong>Related assessment:</strong> ${details.source_analysis_id ? `<a href="${href("report", { id: details.source_analysis_id, client: client.id })}">Open source analysis →</a>` : "No assessment linked yet."}</p><p><strong>Historical versions:</strong> ${history.length} saved revision${history.length === 1 ? "" : "s"}.</p><a class="button" href="${href("program", { id: program.id, client: client.id })}">View version history</a>`) : "") +
    (!student && templates.length ? card("Start from an editable template", `<div class="pd-template-grid">${templates.slice(0,6).map((t) => `<article><small>${esc(t.detail?.phase || "Foundation")}</small><h3>${esc(t.name)}</h3><p>${esc(t.goal || t.detail?.description || "Adapt this plan to the client.")}</p><button data-template="${esc(t.id)}">Use for ${esc(client.name)}</button></article>`).join("")}</div>`) : "") +
    (practice.length ? card("Practice history", `<div class="pd-history-list">${practice.slice(0,10).map((s) => `<div><span>${esc(date(s.performed_at))}</span><strong>${esc(s.completed?.length || 0)} movements completed</strong>${s.analysis_id ? `<a href="${href("report", { id: s.analysis_id, client: client.id })}">Related assessment →</a>` : ""}</div>`).join("")}</div>`) : "");
  bindButtons(root);
  for (const selector of ["#pd-add-movement", "#pd-change-phase"]) if (root.querySelector(selector)) root.querySelector(selector).onclick = async () => {
    try { const { edit } = await import("./forms.js"); await edit("programs", program.id); } catch (e) { toast(e.message); }
  };
  if (root.querySelector("#pd-duplicate-client")) root.querySelector("#pd-duplicate-client").onclick = async () => {
    try { const copy = await api("program/duplicate", {program_id:program.id,student_id:client.id,replace:true,name:program.name + " · copy"}); location.hash = href("program",{id:copy.id,client:client.id}); } catch (e) { toast(e.message); }
  };
  if (root.querySelector("#pd-complete-program")) root.querySelector("#pd-complete-program").onclick = () => modal("Complete this program?", notice("This marks the current plan Completed. The full sequence and earlier versions remain in the client history."), async () => {
    let target = program;
    if (new Set((program.assignments || []).map((a)=>a.student_id)).size > 1) target = await api("program/duplicate",{program_id:program.id,student_id:client.id,replace:true,name:program.name});
    await api("save",{collection:"programs",item:{id:target.id,detail:{...target.detail,status:"Completed"},steps:target.steps,change_reason:"Program completed by coach",change_source:{kind:"manual"}}});
    location.hash = href("client",{client:client.id,tab:"programs"});
  });
  if (root.querySelector("#pd-new-phase")) root.querySelector("#pd-new-phase").onclick = async () => {
    try {
      const { edit } = await import("./forms.js");
      await edit("programs", program.id, true);
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
