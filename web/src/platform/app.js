import {
  $,
  state,
  api,
  list,
  record,
  params,
  href,
  go,
  esc,
  icon,
  badge,
  card,
  stat,
  empty,
  head,
  avatar,
  table,
  dt,
  date,
  clientName,
  coachName,
  locationName,
  bindButtons,
  modal,
  field,
  select,
  options,
  notice,
  toast,
  spark,
  regionName,
  regions,
  relatedRegion,
  mediaURL,
} from "./core.js";
import { edit } from "./forms.js";
import { metricCopy, explainedChart } from "./explain.js";
import { visitsForClient, visitPracticeLabel, visitRecorderLabel, visitConnections, visitTimeline } from "./visits.js";
import { preferredProgressMetric } from "./progress-selection.js";
// One client workspace is the entrance to all scoped records. Older tab URLs
// still resolve below; these tabs group the information by the user's task.
const workspaceTabs = [
  ["overview", "Overview"],
  ["sessions", "Sessions"],
  ["movement", "Movement"],
  ["posture", "Posture"],
  ["anatomy", "Body / 3D"],
  ["notes", "Coach feedback"],
  ["programs", "Program"],
  ["progress", "Progress"],
];
const pageTitles = {
  dashboard: "Dashboard",
  clients: "Clients",
  coaches: "Coaches",
  schedule: "Schedule",
  capture: "New assessment",
  report: "Assessment report",
  program: "Exercise program",
  exercise: "Exercise",
  programs: "Program library",
  exercises: "Exercise library",
  analysis: "Assessment records",
  anatomy: "Body / 3D anatomy",
  scans: "Scan records",
  progress: "Progress",
  notes: "Coach feedback",
  equipment: "Equipment",
  content: "My content",
  locations: "Locations",
  system: "System data",
  storage: "Storage & recovery",
};
function activeWorkspaceTab(page, p) {
  if (page === "report") {
    const report = state.client?.analyses.find((a) => a.id === p.get("id"));
    return report?.kind === "posture" ? "posture" : "movement";
  }
  if (page === "program" || page === "exercise") return "programs";
  if (page === "anatomy" || page === "scans") return "anatomy";
  if (page === "analysis" || page === "capture") return "sessions";
  if (page !== "client") return "";
  return {
    analysis: "sessions",
    scans: "anatomy",
    schedule: "sessions",
  }[p.get("tab")] || p.get("tab") || "overview";
}
function workspaceHref(tab, extra = {}) {
  return href("client", { client: state.client?.id, tab, ...extra });
}
function workspaceTabHref(tab, p) {
  // A finding can move from its report into anatomy and then into a program.
  const report = p.get("report") ||
    (["report", "client"].includes(p.get("page")) ? p.get("id") : "");
  if (tab === "programs")
    return workspaceHref(tab, {
      ...(p.get("region") ? { region: p.get("region") } : {}),
      ...(report ? { report } : {}),
      ...(p.get("finding") ? { finding: p.get("finding") } : {}),
    });
  if (tab === "anatomy" && (p.get("page") === "report" || p.get("region")))
    return workspaceHref(tab, {
      ...(p.get("region") ? { region: p.get("region") } : {}),
      ...(p.get("id") ? { id: p.get("id") } : {}),
    });
  if (tab === "notes" && p.get("region"))
    return workspaceHref(tab, { region: p.get("region") });
  return workspaceHref(tab);
}
function clientBreadcrumb(page, p) {
  const c = state.client;
  if (!c) return `<nav class="breadcrumb" aria-label="Breadcrumb"><strong>${esc(pageTitles[page] || page)}</strong></nav>`;
  const home = href("client", { client: c.id, tab: "overview" });
  const base = state.me.role === "student"
    ? `<a href="${home}">My workspace</a>`
    : `<a href="${href("clients", { client: "" })}">Clients</a>`;
  const section = activeWorkspaceTab(page, p);
  const sectionName = workspaceTabs.find(([key]) => key === section)?.[1];
  const isHome = page === "client" && section === "overview";
  const detailSession = page === "client" && (p.get("session") || p.get("assessment"));
  const alias = page === "client" && ["scans", "schedule", "analysis"].includes(p.get("tab"));
  const sectionLink = !sectionName || (page === "client" && !detailSession && !alias)
    ? ""
    : `<span aria-hidden="true">/</span><a href="${workspaceHref(section)}">${esc(sectionName)}</a>`;
  const current = page === "client"
    ? detailSession ? "Session"
      : { scans: "Scans", schedule: "Reservations", analysis: "Assessment records" }[p.get("tab")] ||
        sectionName || pageTitles[page] || page
    : pageTitles[page] || page;
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${base}<span aria-hidden="true">/</span>${isHome ? `<strong aria-current="page">${esc(c.name)}</strong>` : `<a href="${home}">${esc(c.name)}</a>${sectionLink}<span aria-hidden="true">/</span><strong aria-current="page">${esc(current)}</strong>`}</nav>`;
}
let generation = 0;
async function initialize() {
  try {
    state.me = await api("me");
    await render();
  } catch (e) {
    if (e.status === 401) login();
    else {
      $("#app").innerHTML = empty(
        "Workspace unavailable",
        esc(e.message),
        '<button id="retry">Try again</button>',
      );
      $("#retry").onclick = initialize;
    }
  }
}
function login() {
  document.body.classList.add("signed-out");
  $("#sidebar").innerHTML = "";
  $("#topbar").innerHTML = "";
  $("#mode-banner").innerHTML = "";
  $("#app").innerHTML =
    `<div class="auth-layout"><section><div class="brand"><span class="brand-mark">M</span>motion yoga</div><h1>One client.<br>One connected practice.</h1><p>Assess movement, explore anatomy, build a program, and follow progress.</p><div class="auth-loop">ASSESS → PLAN → TRAIN → COMPARE</div></section><section class="panel"><h2>Welcome to your studio</h2><form id="signin">${field("Email", "email", "", "email", 'required autocomplete="username"')}${field("Password", "password", "", "password", 'required autocomplete="current-password"')}<p class="form-error" role="alert"></p><button class="primary">Sign in</button> <button type="button" id="register">Create a studio</button></form><hr><h3>Explore the demonstration</h3><p class="muted">34 fictional clients, four locations, linked histories and an editable repertoire.</p><div class="actions">${["coach", "student", "admin"].map((r) => `<button data-demo="${r}">Explore as ${r}</button>`).join("")}</div><label class="check"><input type="checkbox" id="fresh-demo">Start a fresh demonstration</label><p id="demo-status" role="status"></p><small>Demo accounts are isolated from real studios. Scenario measurements and generated imagery are labelled.</small></section></div>`;
  $("#signin").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const b = form.querySelector("button");
    b.disabled = true;
    try {
      state.me = await api(
        "auth/login",
        Object.fromEntries(new FormData(form)),
      );
      location.hash = "";
      await render();
    } catch (err) {
      form.querySelector(".form-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
  $("#register").onclick = () =>
    modal(
      "Create your studio",
      field("Your name", "name", "", "text", "required") +
        field("Studio name", "organization", "", "text", "required") +
        field("Email", "email", "", "email", "required") +
        field(
          "Password · at least 10 characters",
          "password",
          "",
          "password",
          'required minlength="10"',
        ),
      async (f) => {
        state.me = await api("auth/register", Object.fromEntries(f));
        location.hash = "";
      },
    );
  document
    .querySelectorAll("[data-demo]")
    .forEach((b) => (b.onclick = () => demo(b.dataset.demo)));
}
async function demo(role, user_id) {
  let key = state.me?.organization?.demo
    ? state.me.organization.id.replace(/^demo-/, "")
    : sessionStorage.getItem("motion-demo-key");
  if (!key || $("#fresh-demo")?.checked) {
    key = crypto.randomUUID().replaceAll("-", "");
    sessionStorage.setItem("motion-demo-key", key);
  }
  const status = $("#demo-status");
  if (status)
    status.textContent =
      "Preparing your connected demonstration. First opening can take about a minute…";
  document.querySelectorAll("[data-demo]").forEach((b) => (b.disabled = true));
  try {
    state.me = await api("auth/demo", { key, role, user_id });
    state.client = null;
    history.replaceState(null, "", "#page=dashboard");
    await render();
  } catch (e) {
    toast(e.message);
    if (status) status.textContent = e.message;
  } finally {
    document
      .querySelectorAll("[data-demo]")
      .forEach((b) => (b.disabled = false));
  }
}
function shell() {
  document.body.classList.remove("signed-out");
  const me = state.me;
  const p = params();
  const page = p.get("page") || "dashboard";
  const isStudent = me.role === "student";
  const groups = isStudent
    ? [
        ["YOUR PRACTICE", [
          ["dashboard", "Today", "home"],
          ["client", "My workspace", "clients"],
          ["schedule", "My schedule", "schedule"],
        ]],
      ]
    : [
        ["CLIENTS & SESSIONS", [
          ["dashboard", me.role === "coach" ? "Coaching day" : "Operations", "home"],
          ["clients", me.role === "coach" ? "My clients" : "Clients", "clients"],
          ["schedule", "Schedule", "schedule"],
          ["analysis", "Assessment records", "reports"],
          ["scans", "Scan records", "xray"],
        ]],
        ["PRACTICE LIBRARY", [
          ["programs", "Programs", "programs"],
          ["exercises", "Exercises", "library"],
          ["content", "My content", "notes"],
          ["equipment", "Equipment", "equipment"],
        ]],
      ];
  if (me.role === "admin")
    groups.push(["ORGANIZATION", [
      ["coaches", "Coaches", "clients"],
      ["locations", "Locations", "home"],
      ["system", "System data", "settings"],
      ["storage", "Storage & recovery", "settings"],
    ]]);
  const navLink = ([target, title, ico]) => {
    const url = target === "client"
      ? href("client", { client: state.client?.id || me.user.id, tab: "overview" })
      : href(target);
    const active = target === page ||
      (target === "client" && state.client && [
        "report", "program", "exercise", "capture", "anatomy", "progress", "notes",
      ].includes(page));
    return `<a href="${url}" class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${icon(ico)} ${esc(title)}</a>`;
  };
  $("#sidebar").innerHTML =
    `<a class="brand" href="${href("dashboard")}"><span class="brand-mark">M</span><span>motion yoga<small>Connected movement</small></span></a>${groups.map(([title, entries]) => `<div class="nav-group">${esc(title)}</div><nav aria-label="${esc(title)}">${entries.map(navLink).join("")}</nav>`).join("")}<div class="sidebar-foot"><strong>${esc(me.user.name)}</strong><small>${esc(me.organization.name)}</small><button id="logout">Sign out</button></div>`;
  $("#topbar").innerHTML =
    `<button id="menu" aria-label="Toggle navigation">☰</button>${clientBreadcrumb(page, p)}${isStudent ? "" : '<form id="global-search"><input name="q" aria-label="Search clients, programs and exercises" placeholder="Search your workspace…"><button>Search</button></form>'}${
      me.organization.demo
        ? `<select id="demo-role" aria-label="Demo role">${options(
            ["coach", "student", "admin"].map((r) => [
              r,
              r[0].toUpperCase() + r.slice(1) + " demo",
            ]),
            me.role,
            null,
          )}</select>`
        : me.user.roles.length > 1
          ? `<select id="own-role" aria-label="Your role">${options(
              me.user.roles.map((r) => [r, r]),
              me.role,
              null,
            )}</select>`
          : ""
    }${!isStudent ? `<a class="button primary" href="${href("capture")}">+ Assessment</a>` : ""}`;
  $("#mode-banner").innerHTML = me.organization.demo
    ? "<b>DEMONSTRATION</b> · Fictional clients, synthetic histories, labelled illustrative imagery. New uploads run the real analysis pipeline."
    : "<b>YOUR STUDIO</b> · Captures and coaching records belong to this organization.";
  if (me.storage?.ephemeral)
    $("#mode-banner").innerHTML +=
      `<br><strong>Temporary Render storage:</strong> records can reset when this free service restarts. ${me.role === "admin" ? `<a href="${href("storage")}">Download a studio backup</a>` : "Ask your administrator to keep a studio backup."}`;
  $("#logout").onclick = async () => {
    await api("auth/logout", {});
    state.me = null;
    state.client = null;
    history.replaceState(null, "", "#");
    login();
  };
  $("#menu").onclick = () => document.body.classList.toggle("nav-open");
  if ($("#global-search"))
    $("#global-search").onsubmit = (e) => {
      e.preventDefault();
      go("search", { q: new FormData(e.target).get("q") });
    };
  if ($("#demo-role")) $("#demo-role").onchange = (e) => demo(e.target.value);
  if ($("#own-role"))
    $("#own-role").onchange = async (e) => {
      state.me = await api("auth/switch", { role: e.target.value });
      go("dashboard", { client: "" });
    };
}
function context() {
  const c = state.client;
  if (!c) return "";
  const p = params();
  const page = p.get("page") || "dashboard";
  const active = activeWorkspaceTab(page, p);
  const home = workspaceHref("overview");
  const latest = c.analyses?.[0] || c.latest_analysis;
  const scope = state.me.role === "student" ? "Your workspace" : "Current client";
  const summary = state.me.role === "admin"
    ? `<small>Coach · ${esc(c.coach_ids.map(coachName).join(", ") || "Unassigned")}</small><small>Location · ${esc(c.location_ids.map(locationName).join(", ") || "Unassigned")}</small>`
    : `<small>Current program · ${esc(c.programs.map((program) => program.name).join(", ") || "None assigned yet")}</small><small>Next reservation · ${dt(c.next_reservation?.starts_at)}</small>`;
  return `<section class="client-context" aria-label="${esc(c.name)} workspace"><div class="client-identity"><div class="client-person">${avatar(c)}<div><small class="eyebrow">${scope}</small><a href="${home}"><h2>${esc(c.name)}</h2></a>${page === "client" && active === "overview" ? "" : `<a class="client-return" href="${home}">← Return to ${esc(c.name)}'s workspace</a>`}</div></div><div class="context-summary">${summary}${latest ? `<a href="${workspaceHref("sessions", { assessment: latest.id })}">Latest assessment · ${date(latest.created_at)} →</a>` : ""}</div><div class="context-actions"><a href="${workspaceHref("scans")}">Scans</a><a href="${workspaceHref("schedule")}">Reservations</a>${state.me.role !== "student" ? `<a href="${href("clients", { client: "" })}">Change client</a>` : ""}</div></div><nav class="client-tabs" aria-label="${esc(c.name)} workspace sections">${workspaceTabs.map(([tab, label]) => `<a href="${workspaceTabHref(tab, p)}" class="${active === tab ? "active" : ""}" ${active === tab ? 'aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav></section>`;
}
async function render() {
  if (!state.me) return login();
  const myGeneration = ++generation;
  state.dispose.splice(0).forEach((fn) => fn());
  document.body.classList.remove("nav-open");
  const p = params();
  let cid = p.get("client");
  if (state.me.role === "student") cid = state.me.user.id;
  if (
    cid &&
    state.me.role !== "admin" &&
    !state.me.students.some((s) => s.id === cid)
  ) {
    cid = null;
    p.delete("client");
    history.replaceState(null, "", "#" + p);
  }
  try {
    state.client = cid
      ? await api("client?id=" + encodeURIComponent(cid))
      : null;
  } catch (error) {
    if (myGeneration !== generation) return;
    if (error.status === 401) {
      state.me = null;
      login();
      return;
    }
    state.client = null;
    shell();
    $("#app").innerHTML = empty(
      "Client record could not open",
      error.message,
      '<button id="client-retry">Try again</button><a class="button" href="#page=clients">Choose a client</a>',
    );
    $("#client-retry").onclick = render;
    return;
  }
  if (myGeneration !== generation) return;
  shell();
  window.scrollTo(0, 0);
  $("#app").innerHTML =
    context() +
    '<div id="page-content"><div class="loading" role="status">Opening linked records…</div></div>';
  const root = $("#page-content");
  const page = p.get("page") || "dashboard";
  let tab = p.get("tab") || "overview";
  try {
    if (page === "dashboard") await dashboard(root);
    else if (page === "clients" || page === "coaches")
      await peoplePage(root, page === "coaches");
    else if (page === "client") {
      if (!state.client) return go("clients");
      if (tab === "overview") await overview(root);
      else if (tab === "sessions") await sessions(root);
      else if (tab === "progress") progress(root);
      else await section(root, tab);
    } else if (page === "capture") {
      const m = await import("./capture.js");
      await m.capture(root);
    } else if (page === "report") {
      const m = await import("./reports.js");
      await m.report(root, p.get("id"));
    } else if (page === "program" || page === "exercise") {
      const m = await import("./forms.js");
      await m.detailPage(root, page, p.get("id"));
    } else if (page === "search") {
      const found = await api(
        "search?q=" + encodeURIComponent(p.get("q") || ""),
      );
      root.innerHTML =
        head("Search results", p.get("q") || "") +
        table(
          ["Type", "Record"],
          found.map((r) => [
            esc(r.type),
            `<a href="${href({ client: "client", coach: "coaches", programs: "program", exercises: "exercise", analyses: "report", locations: "locations", reservations: "schedule" }[r.type], { id: r.id, ...(r.type === "client" ? { client: r.id, tab: "overview" } : r.student_id ? { client: r.student_id } : {}) })}">${esc(r.name || r.id)}</a>`,
          ]),
        );
    } else if (page === "storage") {
      const { storage } = await import("./storage.js");
      if (state.me.role !== "admin")
        throw Error("Only administrators can manage storage.");
      storage(root);
    } else if (page === "system") {
      const { inspection } = await import("./inspection.js");
      await inspection(root);
    } else await section(root, page);
    bindButtons(root);
  } catch (e) {
    if (e.status === 401) {
      state.me = null;
      login();
      return;
    }
    root.innerHTML = empty(
      "This view could not open",
      esc(e.message),
      '<button id="view-retry">Try again</button>',
    );
    $("#view-retry").onclick = render;
  }
}
async function allReservations() {
  const items = [];
  let offset = 0;
  let total = 0;
  do {
    const page = await list("reservations", { limit: 200, offset });
    items.push(...page.items);
    offset += page.items.length;
    total = page.total;
    if (!page.items.length && offset < total)
      throw new Error("Reservation history could not be fully loaded.");
  } while (offset < total);
  return { items: [...new Map(items.map((item) => [item.id, item])).values()], total };
}
async function dashboard(root) {
  const student = state.me.role === "student";
  const [analysis, reservations, programs] = await Promise.all([
    list("analyses", { limit: 12 }),
    allReservations(),
    list("programs"),
  ]);
  const future = reservations.items
    .filter(
      (r) => new Date(r.starts_at) > new Date() && r.status === "reserved",
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const c = state.client || state.me.students[0];
  const today = reservations.items.filter(
    (r) =>
      new Date(r.starts_at).toDateString() === new Date().toDateString() &&
      r.status !== "cancelled",
  );
  const attention = state.me.students.filter(
    (c) =>
      !c.programs.length ||
      !c.latest_analysis ||
      c.latest_analysis.status !== "complete" ||
      new Date() - new Date(c.latest_analysis.created_at) > 30 * 86400000,
  );

  if (student) {
    const latestVisit = c ? visitsForClient(c)[0] : null;
    const latestCapture = latestVisit?.analysis;
    const visitLink = latestVisit?.session
      ? workspaceHref("sessions", { session: latestVisit.session.id })
      : latestCapture ? workspaceHref("sessions", { assessment: latestCapture.id }) : "";
    const note = c?.notes?.find((item) => item.visibility === "student");
    root.innerHTML =
      head("Your practice, today", "Start with your latest visit, coach feedback and the next exercise.") +
      `<div class="grid two">${card("Latest visit", latestVisit ? `<p><strong>${esc(latestCapture?.protocol || "Practice logged")}</strong> · ${date(latestVisit.occurredAt)}</p><p>${latestCapture ? `${esc(latestCapture.kind === "movement" ? "Movement analysis" : "Posture assessment")} · ${badge(latestCapture.demo ? "Demo simulation" : "Uploaded capture", latestCapture.demo ? "demo" : "")}` : esc(visitPracticeLabel(latestVisit))}</p><a class="button primary" href="${visitLink}">Open this visit →</a>` : notice("No visits have been saved yet. Log a practice or ask your coach to record an assessment."))}${card("Coach feedback", note ? notesHTML([note]) : notice("Your coach has not shared feedback yet. Check back after your next reviewed session."))}${card("Your program", programCards(c?.programs || []))}${card("Progress over time", `<p>Compare similar sessions and see which measurements changed.</p><a class="button" href="${workspaceHref("progress")}">View your progress →</a>`)}</div>`;
    return;
  }
  root.innerHTML =
    head(
      student
        ? "Your practice, today"
        : state.me.role === "coach"
          ? "Your coaching day"
          : "Organization overview",
      student
        ? "Follow your program and understand what changes over time."
        : "Client histories, planned sessions and the evidence behind each program.",
    ) +
    `<div class="stats">${stat(student ? "Assigned programs" : "Client profiles", student ? c?.programs.length || 0 : state.me.students.length, student ? "Chosen by your coach" : "Visible to your role", "clients")}${stat("Assessments", analysis.total, "Saved to client histories")}${stat("Upcoming sessions", future.length, "Confirmed reservations", "schedule")}${stat(student ? "Your coach" : "Locations", student ? coachName(c?.coach_ids[0]) : state.me.locations.length, student ? locationName(c?.location_ids[0]) : "Connected studios", "home")}</div><div class="grid two">${card(student ? "Today’s program" : "Next on your schedule", student ? programCards(programs.items) : reservationTable(future.slice(0, 6)))}${card("Recent analysis", analysisTable(analysis.items.slice(0, 6)))}</div>${!student ? card("Clients to review", `<div class="client-grid">${attention.slice(0, 8).map(clientCard).join("") || "<p>No clients currently need a missing-program, capture-quality or 30-day review follow-up.</p>"}</div>`) : c ? card("Your progress", `<p>Compare measurements only when the capture protocol and camera view match.</p><a class="button" href="${workspaceHref("progress")}">Review explained progress →</a>`) : ""}`;

  if (!student)
    root.innerHTML +=
      card(
        "Today’s sessions",
        today.length
          ? reservationTable(today)
          : notice("No sessions scheduled today."),
      ) +
      card(
        "Program participation",
        table(
          ["Client", "Recorded sessions", "Latest recorded session", "Practice in latest session"],
          state.me.students.map((p) => [
            `<a href="${href("client", { client: p.id, tab: "sessions" })}">${esc(p.name)}</a>`,
            p.session_count || 0,
            date(p.latest_session?.performed_at),
            lastPracticeLabel(p),
          ]),
        ),
      );
  if (state.me.role === "admin")
    root.innerHTML += card(
      "Location overview",
      table(
        ["Location", "Clients", "Coaches", "Upcoming reservations"],
        state.me.locations.map((l) => [
          esc(l.name),
          state.me.students.filter((c) => c.location_ids.includes(l.id)).length,
          state.me.coaches.filter((c) => c.location_ids.includes(l.id)).length,
          future.filter((r) => r.location_id === l.id).length,
        ]),
      ),
    );
}
function lastPracticeLabel(client) {
  if (!client.latest_session) return "No practice recorded";
  const completed = client.latest_session.completed?.length || 0;
  if (!completed) return "No exercises logged in latest session";
  return client.last_session_steps == null
    ? `${completed} ${completed === 1 ? "movement" : "movements"} completed · original plan count unavailable`
    : `${completed} / ${client.last_session_steps} planned ${client.last_session_steps === 1 ? "movement" : "movements"} completed`;
}
function ageFromBirthDate(born) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(born || "");
  if (!parts) return "";
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return "";
  const today = new Date();
  const age = today.getFullYear() - year -
    (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0);
  return age >= 0 && age <= 120 ? `${age} years` : "";
}
function clientCard(c) {
  const metadata = [ageFromBirthDate(c.born), (c.location_ids || []).map(locationName).join(", ")].filter(Boolean).join(" · ");
  return `<a class="client-card" href="${href("client", { client: c.id, tab: "overview", id: "" })}">${avatar(c)}<div><h3>${esc(c.name)}</h3>${metadata ? `<small>${esc(metadata)}</small>` : ""}<p>${esc(c.programs?.[0]?.name || "No assigned program")}</p><small>Latest assessment ${date(c.latest_analysis?.created_at)} · Next ${dt(c.next_reservation?.starts_at)}</small><small>Latest recorded session ${date(c.latest_session?.performed_at)} · ${c.session_count || 0} recorded sessions</small><small>Latest recorded-session practice: ${esc(lastPracticeLabel(c))}</small></div></a>`;
}
async function peoplePage(root, coaches = false) {
  const people = coaches ? await api("people?role=coach") : state.me.students;
  root.innerHTML =
    head(
      coaches
        ? "Coaches"
        : state.me.role === "coach"
          ? "My clients"
          : "Clients",
      "Select a person to open their complete connected workspace.",
      `<button data-edit="${coaches ? "coach" : "student"}">+ ${coaches ? "Coach" : "Client"}</button>`,
    ) +
    field("Filter by name", "filter") +
    `<div class="client-grid" id="people-list">${people.map((c) => (coaches ? card(c.name, `<p>${esc(c.location_ids.map(locationName).join(", "))}</p><button data-edit="coach" data-id="${c.id}">Edit coach</button>`) : `<div>${clientCard(c)}<button class="text-button" data-edit="student" data-id="${c.id}">Edit profile</button></div>`)).join("")}</div>`;
  root.querySelector("[name=filter]").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    root
      .querySelectorAll("#people-list > *")
      .forEach((el) => (el.hidden = !el.textContent.toLowerCase().includes(q)));
  };
}
async function overview(root) {
  const c = state.client;
  const latest = c.analyses[0];
  const latestSession = c.sessions[0];
  const latestLink = latest
    ? workspaceHref("sessions", { assessment: latest.id })
    : latestSession
      ? workspaceHref("sessions", { session: latestSession.id })
      : workspaceHref("sessions");
  const latestSummary = latest
    ? `<p><strong>${esc(latest.protocol)}</strong> · ${esc(latest.kind === "movement" ? "Movement analysis" : "Posture assessment")}</p><p>${dt(latest.created_at)} · ${badge(latest.demo ? "Demo simulation" : "Uploaded capture", latest.demo ? "demo" : "")}</p><a class="button" href="${latestLink}">Open this session →</a>`
    : `${notice("No assessment has been recorded yet. An assessment will appear here after a coach saves a capture.")}<a class="button" href="${workspaceHref("sessions")}">View sessions</a>`;
  const notes = c.notes.slice(0, 3);
  if (state.me.role === "student") {
    root.innerHTML =
      head("Your practice", c.goal || "Your sessions, coach feedback and assigned practice in one place.") +
      `<div class="grid two">${card("Your latest session", latestSummary)}${card("What your coach said", notes.length ? notesHTML(notes) : notice("Your coach has not shared feedback yet. It will appear here after a session review."))}${card("Your assigned program", programCards(c.programs))}${card("Your progress", `<p>Compare measurements from similar visits and open the source session for each result.</p><a class="button" href="${workspaceHref("progress")}">See progress over time →</a>`)}</div>${card("Your body map", `<p>Explore the body regions connected to your sessions, coach feedback and assigned exercises.</p><a class="button" href="${workspaceHref("anatomy")}">Open body / 3D anatomy →</a>`)}`;
    return;
  }
  if (state.me.role === "admin") {
    root.innerHTML =
      head(c.name + " · client overview", c.goal || "Client relationships, session records and program status.") +
      `<div class="stats">${stat("Assessment records", c.analyses.length, "Movement and posture") }${stat("Visits", visitsForClient(c).length, "Assessments and practice", "schedule")}${stat("Assigned coaches", c.coach_ids.length, c.coach_ids.map(coachName).join(", ") || "Not assigned", "clients")}${stat("Next reservation", dt(c.next_reservation?.starts_at), locationName(c.next_reservation?.location_id), "schedule")}</div><div class="grid two">${card("Latest session", latestSummary)}${card("Current program assignment", programCards(c.programs))}${card("Locations and access", `<p>Assigned locations: ${esc(c.location_ids.map(locationName).join(", ") || "None")}</p><p>Assigned coaches: ${esc(c.coach_ids.map(coachName).join(", ") || "None")}</p><a class="button" href="${workspaceHref("schedule")}">Review reservations →</a>`)}${card("Review status", `<p>${latest ? esc(latest.detail?.reviewed_at ? "Latest assessment reviewed " + dt(latest.detail.reviewed_at) : "Latest assessment awaits coach review.") : "No assessment to review yet."}</p><a class="button" href="${workspaceHref("sessions")}">Inspect client sessions →</a>`)}</div>`;
    return;
  }
  root.innerHTML =
    head(c.name + " · coaching workspace", c.goal || "Review the latest session, coach feedback and current practice.") +
    `<div class="stats">${stat("Assessment records", c.analyses.length, "Movement and posture")}${stat("Visits", visitsForClient(c).length, "Assessments and practice", "schedule")}${stat("Coach feedback", c.notes.length, "Linked to body regions", "notes")}${stat("Next reservation", dt(c.next_reservation?.starts_at), locationName(c.next_reservation?.location_id), "schedule")}</div><div class="grid two">${card("Latest session", latestSummary)}${card("Coaching focus", notes.length ? notesHTML(notes) : notice("No coach feedback has been saved yet. Open a session or body region to add feedback."))}${card("Current program", programCards(c.programs))}${card("Progress across visits", `<p>Review comparable measurements alongside their source sessions and coach notes.</p><a class="button" href="${workspaceHref("progress")}">Open progress →</a>`)}</div><div class="actions"><a class="button primary" href="${href("capture")}">New assessment</a><a class="button" href="${workspaceHref("anatomy")}">Explore body map</a></div>`;
}
export function analysisTable(rows) {
  if (!rows.length)
    return notice("No movement or posture assessments have been recorded for this selection.");
  return table(
    ["Session", "Client", "Assessment", "Source", "Report"],
    rows.map((a) => [
      `<a href="${href("client", { client: a.student_id, tab: "sessions", assessment: a.id })}">${dt(a.created_at)}</a>`,
      esc(clientName(a.student_id)),
      esc(a.protocol) + `<small class="block">${esc(a.kind === "movement" ? "Movement analysis" : "Posture assessment")}</small>`,
      badge(a.demo ? "Demo simulation" : a.status === "complete" ? "Uploaded capture" : "Needs capture", a.demo ? "demo" : ""),
      `<a href="${href("report", { client: a.student_id, id: a.id })}">Open report →</a>`,
    ]),
  );
}
function reservationTable(rows) {
  return table(
    ["When", "Client", "Coach / location", "Status"],
    rows.map((r) => [
      dt(r.starts_at),
      `<a href="${href("client", { client: r.student_id, tab: "schedule" })}">${esc(clientName(r.student_id))}</a>`,
      esc(coachName(r.coach_id)) +
        "<br><small>" +
        esc(locationName(r.location_id)) +
        "</small>",
      esc(r.status) +
        (state.me.role !== "student"
          ? ` <button data-edit="reservations" data-id="${r.id}">Edit</button>`
          : ""),
    ]),
  );
}
function programCards(rows) {
  return rows.length
    ? rows
        .map(
          (p) =>
            `<a class="record-link" href="${href("program", { id: p.program_id || p.id })}"><strong>${esc(p.name)}</strong><span>${esc(p.goal || p.notes || "Open your sequence")} →</span></a>`,
        )
        .join("")
    : notice(
        "No program assigned yet. Your coach can create and assign a sequence.",
      );
}
async function sessions(root) {
  const c = state.client;
  const p = params();
  if (p.get("session") || p.get("assessment"))
    return sessionDetail(root, p.get("session"), p.get("assessment"));
  const visits = visitsForClient(c);
  const visitTable = visits.length
    ? table(
        ["When", "Assessment", "Practice", "Recorded by", "Visit"],
        visits.map((visit) => {
          const captures = visit.analyses || (visit.analysis ? [visit.analysis] : []);
          const link = workspaceHref("sessions", visit.session
            ? { session: visit.session.id } : { assessment: visit.analysis.id });
          return [
            `<a href="${link}">${dt(visit.occurredAt)}</a>`,
            captures.length
              ? captures.map((analysis) => `${esc(analysis.protocol)}<small class="block">${esc(analysis.kind === "movement" ? "Movement analysis" : "Posture assessment")}</small>`).join("")
              : "No assessment recorded",
            esc(visitPracticeLabel(visit)),
            esc(visitRecorderLabel(visit)),
            `<a href="${link}">Open visit →</a>`,
          ];
        }),
      )
    : notice("No visits have been recorded for this client. Add an assessment or save a practice session to begin the history.");
  const reservations = c.reservations.filter((r) => r.status !== "cancelled").slice(0, 8);
  root.innerHTML =
    head("Client sessions", "Each visit connects its assessment, exercises, feedback and reservation in one record.",
      state.me.role === "student" ? "" : `<a class="button primary" href="${href("capture")}">New assessment</a>`) +
    card("Visits", visitTable) +
    card("Reservations", reservations.length
      ? reservationTable(reservations)
      : notice("No reservation is linked to this client yet. A coach or administrator can schedule the next visit.")) +
    `<a class="button" href="${workspaceHref("schedule")}">View full reservation history →</a>`;
}
async function sessionDetail(root, sessionId, assessmentId) {
  const c = state.client;
  const visitList = visitsForClient(c);
  const bySession = sessionId ? visitList.find((visit) => visit.session?.id === sessionId) : null;
  const byAssessment = assessmentId ? visitList.find((visit) =>
    visit.analyses.some((analysis) => analysis.id === assessmentId)) : null;
  // Two unrelated IDs must never construct a fictional combined visit.
  if ((sessionId && !bySession) || (assessmentId && !byAssessment) ||
      (bySession && byAssessment && bySession !== byAssessment)) {
    root.innerHTML = empty("Session not found", "These records do not belong to one visit.",
      `<a class="button" href="${workspaceHref("sessions")}">Return to sessions</a>`);
    return;
  }
  const visit = bySession || byAssessment;
  if (!visit) {
    root.innerHTML = empty("Session not found", "This session is no longer available in the selected client's record.",
      `<a class="button" href="${workspaceHref("sessions")}">Return to sessions</a>`);
    return;
  }
  const practice = visit.session;
  const analyses = visit.analyses;
  const assessment = analyses.find((item) => item.id === assessmentId) || analyses[0] || null;
  const initial = visitConnections(c, visit);
  const programIds = [...new Set([
    practice?.program_id,
    ...initial.assignments.map((assignment) => assignment.program_id),
    ...initial.notes.map((note) => note.program_id),
    ...(c.programs || []).map((assignment) => assignment.program_id),
  ].filter(Boolean))];
  const reservationId = practice?.reservation_id || assessment?.detail?.reservation_id;
  const reservation = reservationId ? c.reservations.find((r) => r.id === reservationId) : null;
  const roomId = reservation?.room_id || assessment?.detail?.room_id;
  const roomLocationId = reservation?.location_id || assessment?.location_id;
  const [analysisRecords, roomLocation, ...programData] = await Promise.all([
    Promise.all(analyses.map((item) => record("analyses", item.id).catch(() => null))),
    roomId && roomLocationId ? record("locations", roomLocationId).catch(() => null) : null,
    ...programIds.map(async (id) => ({
      id,
      program: await record("programs", id).catch(() => null),
      versions: await api("program/versions?id=" + encodeURIComponent(id)).then((x) => x.items).catch(() => []),
    })),
  ]);
  if (!root.isConnected) return;
  const programsById = new Map(programData.map((entry) => [entry.id, entry]));
  const program = programsById.get(practice?.program_id)?.program || null;
  const programVersions = programData.flatMap((entry) => entry.versions);
  const connections = visitConnections(c, visit, programVersions);
  const timeline = visitTimeline(visit, connections);
  const programAtSession = program && practice?.program_version
    ? programsById.get(program.id)?.versions.find((v) => v.version === practice.program_version)?.snapshot || null
    : program;
  const historicalSteps = programAtSession?.steps || [];
  const completed = Array.isArray(practice?.completed) ? practice.completed : [];
  const completionRows = completed.map((key) => {
    const step = historicalSteps.find((item) => item.id === key) ||
      historicalSteps.find((item) => item.exercise_id === key);
    return { exerciseId: step?.exercise_id || key, name: step?.exercise_name || "" };
  });
  const exercises = await Promise.all(completionRows.map((row) =>
    record("exercises", row.exerciseId).catch(() => null)));
  if (!root.isConnected) return;
  const exerciseRows = completionRows.map((row, index) =>
    `<li>${exercises[index] ? `<a href="${href("exercise", { id: row.exerciseId })}">${esc(row.name || exercises[index].name)}</a>` : esc(row.name || "Historical movement record unavailable")} <small>Logged</small></li>`,
  ).join("");
  const index = visitList.indexOf(visit);
  const ordinal = index < 0 ? "Visit" : `Visit ${visitList.length - index}`;
  const linkFor = (candidate) => workspaceHref("sessions", candidate.session
    ? { session: candidate.session.id } : { assessment: candidate.analysis.id });
  const previous = index >= 0 ? visitList[index + 1] : null;
  const next = index > 0 ? visitList[index - 1] : null;
  const earlierProtocol = assessment ? c.analyses.find((item) =>
    !analyses.some((current) => current.id === item.id) && item.kind === assessment.kind &&
    item.protocol === assessment.protocol && item.created_at < assessment.created_at) : null;
  const locationId = reservation?.location_id || assessment?.location_id;
  const assessmentLocationDiffers = reservation?.location_id && assessment?.location_id &&
    reservation.location_id !== assessment.location_id;
  const roomName = roomLocation?.rooms?.find((room) => room.id === roomId)?.name;
  const assignedCoach = reservation?.coach_id
    ? state.me.coaches.find((coach) => coach.id === reservation.coach_id) : null;
  const captureCoach = assessment?.coach_id
    ? state.me.coaches.find((coach) => coach.id === assessment.coach_id) : null;
  const coachLabel = reservation?.coach_id
    ? assignedCoach?.name || "Coach record unavailable"
    : captureCoach?.name || "No coach recorded";
  const coachSource = reservation?.coach_id ? "Reservation coach" :
    captureCoach ? "Capture coach" : "No coach linked";
  const when = visit.occurredAt;
  const reportLink = assessment
    ? `<a class="button primary" href="${href("report", { id: assessment.id })}">Open selected analysis →</a>` : "";
  const reportLinks = analyses.map((item) => `<a class="record-link" href="${href("report", { id: item.id })}"><strong>${esc(item.protocol)}</strong><span>${esc(item.kind === "movement" ? "Movement analysis" : "Posture assessment")} · ${dt(item.created_at)} →</span></a>`).join("");
  const whoAndWhere = `<dl class="session-facts"><div><dt>Client</dt><dd>${esc(c.name)}</dd></div><div><dt>Coach</dt><dd>${esc(coachLabel)}<small class="block">${esc(coachSource)}</small></dd></div><div><dt>Recorded by</dt><dd>${esc(visitRecorderLabel(visit))}</dd></div><div><dt>Location</dt><dd>${locationId ? `${esc(locationName(locationId))}<small class="block">From ${reservation?.location_id ? "reservation" : "assessment"}</small>` : "No location recorded"}${assessmentLocationDiffers ? `<small class="block">Capture recorded at ${esc(locationName(assessment.location_id))}</small>` : ""}</dd></div>${roomId ? `<div><dt>Room</dt><dd>${esc(roomName || "Linked room; name unavailable")}</dd></div>` : ""}<div><dt>Reservation</dt><dd>${reservation ? esc(dt(reservation.starts_at) + " · " + reservation.status) : "No reservation linked"}</dd></div></dl>`;
  const mediaViews = analysisRecords.flatMap((record, index) =>
    (record?.result?.views || []).filter((view) => view.media_id)
      .map((view) => ({ id: view.media_id, view: view.view, analysis: analyses[index] })));
  const mediaEvidence = mediaViews.length ? `<div class="session-media-grid">${mediaViews.map((item) =>
    `<figure>${item.analysis.kind === "movement" && !item.analysis.demo
      ? `<video controls preload="metadata" src="${mediaURL(item.id)}" aria-label="${esc(item.view.replaceAll("_", " "))} source video"></video>`
      : `<img src="${mediaURL(item.id)}" alt="${esc(item.view.replaceAll("_", " "))} ${item.analysis.demo ? "generated scenario illustration" : "source photograph"}" loading="lazy">`}
      <figcaption>${esc(item.analysis.protocol)} · ${esc(item.view.replaceAll("_", " "))} · ${item.analysis.demo ? "Generated scenario illustration; measurements use separate simulated coordinates" : "Original uploaded capture"}</figcaption></figure>`,
  ).join("")}</div>` : notice("No source media is available in this visit record. Open the analysis for the saved landmark evidence.");
  const demoCaptures = analyses.filter((item) => item.demo).length;
  const source = analyses.length
    ? `${demoCaptures ? badge(`${demoCaptures} demo simulation${demoCaptures === 1 ? "" : "s"}`, "demo") : ""}${analyses.length > demoCaptures ? badge(`${analyses.length - demoCaptures} uploaded capture${analyses.length - demoCaptures === 1 ? "" : "s"}`) : ""}`
    : badge("Practice record");
  const summary = `<div class="session-story-lead"><p>${analyses.length
    ? `${analyses.length} ${analyses.length === 1 ? "capture was" : "captures were"} recorded: ${analyses.map((item) => esc(item.protocol)).join(", ")}.`
    : "No movement or posture assessment is linked to this visit."}</p><p>${completed.length
    ? `${completed.length} movement${completed.length === 1 ? "" : "s"} ${completed.length === 1 ? "was" : "were"} logged${programAtSession ? ` in ${esc(programAtSession.name)}` : ""}.`
    : "No exercises were logged for this visit."} ${connections.notes.length
    ? `${connections.notes.length} coach feedback entr${connections.notes.length === 1 ? "y" : "ies"} linked.`
    : "No coach feedback is linked yet."}</p></div>`;
  const facts = `<div class="session-story-stats"><div><strong>${completed.length}</strong><span>Exercises</span></div><div><strong>${analyses.filter((item) => item.kind === "movement").length}</strong><span>Movement analyses</span></div><div><strong>${analyses.filter((item) => item.kind === "posture").length}</strong><span>Posture assessments</span></div><div><strong>${connections.notes.length}</strong><span>Coach notes</span></div><div><strong>${connections.regions.length}</strong><span>Body regions</span></div></div>`;
  const eventHTML = (event) => {
    const timestamp = event.at.length <= 10 ? date(event.at) : dt(event.at);
    let title = "";
    let body = "";
    if (event.type === "practice") {
      title = "Practice recorded";
      body = `${exerciseRows ? `<ol class="session-exercises">${exerciseRows}</ol>` : "No movements were logged."}${practice?.notes ? `<p>${esc(practice.notes)}</p>` : ""}${programAtSession ? `<a href="${href("program", { id: program.id, history: "1" })}">${esc(programAtSession.name)} · version ${esc(practice.program_version || "not recorded")}</a>` : ""}`;
    } else if (event.type === "capture") {
      title = event.record.kind === "movement" ? "Movement capture analyzed" : "Posture capture analyzed";
      body = `<p>${esc(event.record.protocol)} · ${esc(event.record.status)}</p><a href="${href("report", { id: event.id })}">Open source measurements and media →</a>`;
    } else if (event.type === "scan") {
      title = "Linked scan added";
      body = `<p>${esc(event.record.name)}</p><a href="${workspaceHref("scans", { scan: event.id, region: event.record.region_id, id: event.record.analysis_id })}">Open scan →</a>`;
    } else if (event.type === "findings") {
      const findings = event.record;
      title = `${findings.length} body measurement${findings.length === 1 ? "" : "s"} recorded`;
      const rows = findings.map((finding) => `<li><span>${esc(finding.text)}</span>${finding.region_id ? ` <a href="${workspaceHref("anatomy", { region: finding.region_id, id: finding.analysis_id || connections.scans.find((scan) => scan.id === finding.scan_id)?.analysis_id })}">${esc(regionName(finding.region_id))} →</a>` : ""}</li>`).join("");
      body = findings.length > 2 ? `<details class="session-findings"><summary>Inspect ${findings.length} measurements and linked regions</summary><ul>${rows}</ul></details>` : `<ul class="session-findings">${rows}</ul>`;
    } else if (event.type === "note") {
      title = event.record.scan_id && !event.record.analysis_id ? "Scan-linked coach note" : "Coach feedback";
      body = `<p>${esc(event.record.text)}</p><a href="${workspaceHref("notes", { region: event.record.region_id, note: event.record.id, id: event.record.analysis_id || connections.scans.find((scan) => scan.id === event.record.scan_id)?.analysis_id })}">Open linked feedback →</a>`;
    } else if (event.type === "review") {
      title = "Coach reviewed the assessment";
      const reviewer = state.me.coaches.find((coach) => coach.id === event.record.detail.reviewed_by)?.name ||
        (state.me.user.id === event.record.detail.reviewed_by ? state.me.user.name : "Studio reviewer");
      body = `<p>${esc(reviewer)} reviewed the captured evidence.</p><a href="${href("report", { id: event.id })}">Open reviewed assessment →</a>`;
    } else if (event.type === "assignment") {
      title = "Program assigned from this assessment";
      body = `<p>${esc(event.record.name || "Assigned program")}</p><a href="${href("program", { id: event.record.program_id, history: "1" })}">Open assignment and versions →</a>`;
    } else if (event.type === "program") {
      title = "Program version connected to this visit";
      body = `<p>${esc(event.record.reason || (event.record.source_kind === "analysis" ? "A coach saved a new version using this assessment as its reason source." : "A coach saved a new version using linked feedback as its reason source."))}</p><a href="${href("program", { id: event.record.program_id, history: "1" })}">Open version ${esc(event.record.version)} →</a>`;
    }
    return `<li class="session-event"><span class="session-event-dot" aria-hidden="true"></span><div><small>${esc(timestamp)}</small><h3>${esc(title)}</h3>${body}</div></li>`;
  };
  const timelineHTML = timeline.length
    ? `<ol class="session-timeline">${timeline.map(eventHTML).join("")}</ol>`
    : notice("No time-stamped activity is available for this visit.");
  const regionAnalysis = (region) => connections.observations.find((item) => item.region_id === region)?.analysis_id ||
    connections.notes.find((item) => item.region_id === region)?.analysis_id ||
    connections.scans.find((item) => item.region_id === region)?.analysis_id || assessment?.id;
  const regionsHTML = connections.regions.length
    ? connections.regions.map((region) => `<a class="session-region" href="${workspaceHref("anatomy", { region, id: regionAnalysis(region) })}">${esc(regionName(region))} →</a>`).join("")
    : notice("No body-region finding or feedback is linked to this visit.");
  const scansHTML = connections.scans.length
    ? connections.scans.map((scan) => `<a class="record-link" href="${workspaceHref("scans", { scan: scan.id, region: scan.region_id, id: scan.analysis_id })}"><strong>${esc(scan.name)}</strong><small>${esc(scan.detail?.demo ? "Educational reference · not this client's X-ray" : scan.scan_type + " · " + date(scan.captured_at))}</small></a>`).join("")
    : notice("No scan is linked to this visit.");
  const programHTML = program
    ? `<p><strong>${esc(programAtSession?.name || program.name)}</strong>${practice?.program_version ? ` · version ${esc(practice.program_version)} used at this visit` : ""}</p>${practice?.program_version && !programAtSession ? `<p>The historical version could not be loaded; current plan details are not used as visit evidence.</p>` : ""}<a class="button" href="${href("program", { id: program.id, history: "1" })}">Open program history →</a>`
    : connections.assignments.length
      ? connections.assignments.map((assignment) => `<a class="record-link" href="${href("program", { id: assignment.program_id, history: "1" })}">${esc(assignment.name || "Program assigned from this assessment")} →</a>`).join("")
      : notice("No program is linked to this visit.");
  root.innerHTML =
    head(`${ordinal} · ${analyses.length ? "Assessment & practice" : "Practice"}`,
      `${c.name} · ${date(when)}`,
      `<a class="button" href="${workspaceHref("sessions")}">← All sessions</a>${reportLink}${state.me.role === "student" ? "" : '<button data-edit="notes">+ Feedback for this visit</button>'}`) +
    `<div class="session-source">${source}${analyses.length ? badge(analyses.every((item) => item.detail?.reviewed_at) ? "Reviewed" : analyses.some((item) => item.detail?.reviewed_at) ? "Partly reviewed" : "Awaiting coach review") : ""}</div>` +
    summary + facts +
    `<div class="session-visit-nav">${previous ? `<a href="${linkFor(previous)}">← Previous visit · ${date(previous.occurredAt)}</a>` : "<span>First recorded visit</span>"}${next ? `<a href="${linkFor(next)}">Next visit · ${date(next.occurredAt)} →</a>` : "<span>Latest recorded visit</span>"}</div>` +
    `<div class="grid two session-story-grid"><div>${card("Visit & follow-up timeline", `${timelineHTML}<p class="muted">Movements are shown as one saved practice log because individual start times are not recorded. Later linked notes, scans and program changes appear on their own dates.</p>`)}</div><div>${card("Who and where", whoAndWhere)}${card("Source captures and measurements", analyses.length ? `${reportLinks}${mediaEvidence}` : notice("This practice has no linked assessment capture."))}</div></div>` +
    `<div class="grid two">${card("Program at this visit", programHTML)}${card("Body regions", regionsHTML)}${card("Coach feedback", connections.notes.length ? notesHTML(connections.notes) : notice("No coach feedback is linked to this visit yet."))}${card("Scans", scansHTML + (state.me.role === "student" ? "" : `<a class="button" href="${workspaceHref("scans", { ...(practice?.id ? { session: practice.id } : {}), ...(assessment?.id ? { id: assessment.id } : {}) })}">Add a scan to this visit →</a>`))}</div>` +
    (earlierProtocol ? card("Earlier same-protocol capture", `<p>${esc(earlierProtocol.protocol)} · ${date(earlierProtocol.created_at)}. Check that the camera view and capture setup match before interpreting a change.</p><a class="button" href="${workspaceHref("sessions", { assessment: earlierProtocol.id })}">Open earlier source visit →</a><a class="button" href="${href("report", { id: assessment.id })}">Compare in assessment report →</a>`) : "");
}

function progress(root) {
  const c = state.client;
  if (!c.progress.length || !c.analyses.length) {
    root.innerHTML =
      head("Progress across visits", "Comparable measurements will appear alongside their source sessions.") +
      notice("No comparable progress measurements have been recorded yet. A coach can save a movement or posture assessment; later visits can then be compared using the same capture setup.") +
      (state.me.role === "student" ? "" : `<a class="button primary" href="${href("capture")}">Start an assessment</a>`);
    return;
  }
  const groups = [
    ...new Set(
      c.analyses.map(
        (a) =>
          `${a.demo ? "Demo simulation" : "Uploaded media"} · ${a.kind} · ${a.protocol}`,
      ),
    ),
  ];
  const requestedMetric = params().get("metric");
  const requestedRow = c.progress
    .filter((row) => row.metric === requestedMetric)
    .sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)))
    .at(-1);
  const requestedAnalysis = c.analyses.find((analysis) => analysis.id === requestedRow?.analysis_id);
  const requestedGroup = requestedAnalysis
    ? `${requestedAnalysis.demo ? "Demo simulation" : "Uploaded media"} · ${requestedAnalysis.kind} · ${requestedAnalysis.protocol}`
    : groups[0];
  let pendingMetric = requestedMetric;
  root.innerHTML =
    head(
      "Progress across visits",
      "Compare measurements from the same capture kind, protocol and source. Click source sessions to inspect their evidence.",
    ) +
    `<div class="filter-row">${select(
      "Comparable protocol",
      "history-protocol",
      groups.map((x) => [x, x]),
      requestedGroup,
      null,
    )}${select("Measurement", "history-metric", [], "", null)}</div><div id="history-chart"></div><div id="history-records"></div>`;
  const sources = () =>
    c.analyses.filter(
      (a) =>
        `${a.demo ? "Demo simulation" : "Uploaded media"} · ${a.kind} · ${a.protocol}` ===
        root.querySelector("[name=history-protocol]").value,
    );
  function draw() {
    const sessions = sources(),
      ids = new Set(sessions.map((a) => a.id)),
      metric = root.querySelector("[name=history-metric]").value;
    if (!metric) {
      root.querySelector("#history-chart").innerHTML = notice("No measured movement changed enough to feature by default. Choose a raw measurement above if you want to inspect it.");
      root.querySelector("#history-records").innerHTML = card("Sessions in this protocol", analysisTable(sessions));
      return;
    }
    const rows = c.progress.filter(
      (r) => ids.has(r.analysis_id) && r.metric === metric,
    ).sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
    const current = rows.at(-1), previous = rows.at(-2);
    const sourceIds = new Set(rows.map((row) => row.analysis_id));
    const sourceSessions = sessions.filter((analysis) => sourceIds.has(analysis.id));
    const measure = metricCopy({
      id: metric.split(":").at(-1),
      name: metric.replace(/[:_]/g, " "),
    });
    const selectedSource = root.querySelector("[name=history-protocol]").value;
    const view = metric.includes(":") ? metric.split(":")[0].replaceAll("_", " ") + " view" : "";
    const trace = spark(
      rows.map((r) => [new Date(r.recorded_at).getTime(), r.value]),
      {
        label: metric.replace(/[:_]/g, " "),
        unit: current?.unit || "",
        xLabel: (v) => date(new Date(v)),
      },
    );
    root.querySelector("#history-chart").innerHTML =
      explainedChart({
        title: metric.replace(/[:_]/g, " "),
        definition: measure.definition,
        why: measure.why,
        notice: "Compare visits recorded with the same protocol and camera view. Open either source session to review the capture before interpreting a change.",
        current: current?.value,
        previous: previous?.value,
        unit: current?.unit || "",
        source: [selectedSource, view, selectedSource.startsWith("Demo simulation") ? "synthetic scenario coordinates" : "visible pose landmarks"].filter(Boolean).join(" · "),
        chart: trace,
        sessionLink: current ? `<a href="${workspaceHref("sessions", { assessment: current.analysis_id })}">Open latest source session →</a>` : "",
      }) +
      table(
        ["Date", "Value", "Source"],
        rows.map((r) => [
          date(r.recorded_at),
          `${r.value} ${esc(r.unit)}`,
          `<a href="${workspaceHref("sessions", { assessment: r.analysis_id })}">Open source session</a>`,
        ]),
      );
    const chartRows = rows.filter((row) => Number.isFinite(row.value));
    root.querySelectorAll("#history-chart .trace circle").forEach((point, index) => {
      const source = chartRows[index];
      if (!source) return;
      point.setAttribute("r", "7");
      point.setAttribute("role", "link");
      point.setAttribute("aria-label", "Open " + date(source.recorded_at) + " source session");
      point.addEventListener("click", () => go("client", {
        tab: "sessions", assessment: source.analysis_id,
      }));
      point.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          go("client", { tab: "sessions", assessment: source.analysis_id });
        }
      });
    });
    root.querySelector("#history-records").innerHTML = card(
      "Source sessions for this measurement",
      analysisTable(sourceSessions),
    );
  }
  function metrics() {
    const ids = new Set(sources().map((a) => a.id));
    const names = [
      ...new Set(
        c.progress.filter((r) => ids.has(r.analysis_id)).map((r) => r.metric),
      ),
    ];
    if (!names.length) {
      root.querySelector("#history-chart").innerHTML = notice("These sessions have no comparable measurements yet. Try another capture protocol.");
      root.querySelector("#history-records").innerHTML = card("Sessions in this protocol", analysisTable(sources()));
      return;
    }
    const scopedRows = c.progress.filter((row) => ids.has(row.analysis_id));
    const suggested = (pendingMetric && names.includes(pendingMetric) ? pendingMetric : null) ||
      preferredProgressMetric(names, scopedRows, [c.programs?.[0]?.region_id]);
    root.querySelector("[name=history-metric]").innerHTML = options(
      names.map((n) => [n, n.replaceAll("_", " ")]),
      suggested,
      suggested ? null : "Choose a raw measurement",
    );
    pendingMetric = "";
    draw();
  }
  root.querySelector("[name=history-protocol]").onchange = metrics;
  root.querySelector("[name=history-metric]").onchange = draw;
  metrics();
}
export function notesHTML(notes) {
  if (!notes.length)
    return notice(state.me.role === "student"
      ? "Your coach has not shared feedback for this selection yet."
      : "No coach feedback has been linked here. Open a session or body region to add a specific observation.");
  return notes.map((n) => {
    const author = state.me.coaches.find((coach) => coach.id === n.author_id)?.name ||
      (state.me.user.id === n.author_id ? state.me.user.name : "Studio staff");
    const demo = n.detail?.source === "demo_coach_feedback" ||
      (!n.detail?.source && state.me.organization.demo && /^Demo visit \d+:/.test(n.text || ""));
    const source = demo ? "Demo coach feedback" : "Coach feedback";
    const updated = n.detail?.updated_at ? " · Updated " + dt(n.detail.updated_at) : "";
    const finding = state.client?.observations?.find((item) => item.id === n.detail?.observation_id);
    const findingLabel = finding
      ? `<p><strong>Linked finding · ${esc(finding.source)}</strong> ${finding.analysis_id ? `<a href="${workspaceHref("sessions", { assessment: finding.analysis_id })}">${esc(finding.text)}</a>` : esc(finding.text)}</p>`
      : n.detail?.observation_id ? "<p>Linked finding is no longer available.</p>" : "";
    return `<article class="note">${badge(source, demo ? "demo" : "")}<h3><a href="${href("client", { tab: "anatomy", region: n.region_id, id: n.analysis_id })}">${esc(regionName(n.region_id))}</a></h3><p>${esc(n.text)}</p>${findingLabel}<small>${esc(author)} · ${date(n.created_at)}${updated} · ${n.visibility === "student" ? "Shared with student" : "Coach only"}</small><div class="actions">${n.session_id ? `<a href="${workspaceHref("sessions", { session: n.session_id })}">Source visit</a>` : n.analysis_id ? `<a href="${workspaceHref("sessions", { assessment: n.analysis_id })}">Source session</a>` : ""}${n.analysis_id ? `<a href="${href("report", { id: n.analysis_id })}">Assessment report</a>` : ""}${n.scan_id ? `<a href="${workspaceHref("scans", { scan: n.scan_id })}">Linked scan</a>` : ""}${n.program_id ? `<a href="${href("program", { id: n.program_id })}">Program</a>` : ""}${n.exercise_id ? `<a href="${href("exercise", { id: n.exercise_id })}">Exercise</a>` : ""}${state.me.role !== "student" ? `<button data-edit="notes" data-id="${n.id}">Edit feedback</button>` : ""}</div></article>`;
  }).join("");
}
async function section(root, section) {
  const c = state.client;
  const collection =
    {
      posture: "analyses",
      movement: "analyses",
      analysis: "analyses",
      schedule: "reservations",
      content: "exercises",
    }[section] || section;
  if (["anatomy", "scans"].includes(section)) {
    const m = await import("./anatomy.js");
    return section === "anatomy" ? m.anatomy(root) : m.scans(root);
  }
  if (section === "progress") {
    if (!c) return chooseClient(root);
    return progress(root);
  }
  if (section === "notes") {
    if (!c) return chooseClient(root);
    const selectedRegionId = params().get("region");
    const selectedNoteId = params().get("note");
    const selectedRegion = regions().find((region) => region.id === selectedRegionId);
    const { visibleFeedback } = await import("./feedback-navigation.js");
    const visibleNotes = selectedRegionId && !selectedRegion
      ? []
      : visibleFeedback(c.notes, { noteId: selectedNoteId || "", regionId: selectedRegionId || "" });
    const filter = selectedNoteId
      ? visibleNotes.length
        ? `<div class="filter-row"><p><strong>Source coach feedback</strong> · ${esc(regionName(visibleNotes[0].region_id))}</p>${selectedRegionId ? `<a class="button" href="${workspaceHref("notes", { region: selectedRegionId })}">All feedback in this region →</a>` : ""}<a class="button" href="${workspaceHref("notes")}">Show all feedback →</a></div>`
        : `${notice("This linked feedback is no longer available for this client.")}<a class="button" href="${workspaceHref("notes")}">Show all feedback →</a>`
      : selectedRegionId
        ? selectedRegion
          ? `<div class="filter-row"><p><strong>${esc(selectedRegion.name)}</strong> · ${visibleNotes.length} ${visibleNotes.length === 1 ? "feedback entry" : "feedback entries"}</p><a class="button" href="${workspaceHref("notes")}">Show all feedback →</a><a class="button" href="${workspaceHref("anatomy", { region: selectedRegion.id })}">Back to this body region →</a></div>`
          : `${notice("This body region is no longer available. Choose another region or show all feedback.")}<a class="button" href="${workspaceHref("notes")}">Show all feedback →</a>`
        : "";
    root.innerHTML =
      head(
        selectedRegion ? selectedRegion.name + " · coach feedback" : "Coach feedback",
        selectedRegion
          ? "Coach-written feedback connected to this body region across visits."
          : "Coach-written feedback linked to this client, a body region, session or exercise.",
        state.me.role === "student"
          ? ""
          : '<button data-edit="notes">+ Coach feedback</button>',
      ) + filter + (selectedNoteId && !visibleNotes.length ? "" : notesHTML(visibleNotes));
    return;
  }
  if (collection === "exercises" || collection === "programs") {
    const { library } = await import("./library.js");
    return library(root, collection, section === "content");
  }
  if (["analyses", "reservations"].includes(collection)) {
    const { pagedRecords } = await import("./paging.js");
    const analysis = collection === "analyses";
    const title = section === "movement"
      ? "Movement analyses"
      : section === "posture"
        ? "Posture assessments"
        : analysis
          ? "Assessment records"
          : "Reservations";
    return pagedRecords(root, {
      collection,
      filters: {
        ...(c ? { student_id: c.id } : {}),
        ...(["posture", "movement"].includes(section) ? { kind: section } : {}),
      },
      title: head(
        title,
        c
          ? c.name
          : analysis
            ? "Select a session to inspect its evidence."
            : "Reservations in your assigned workspace.",
        state.me.role === "student"
          ? ""
          : analysis
            ? `<a class="button primary" href="${href("capture")}">+ Assessment</a>`
            : '<button data-edit="reservations">+ Reservation</button>',
      ),
      searchLabel: analysis
        ? "Search protocol or assessment ID"
        : "Search session type or date",
      renderRows: (rows) => rows.length
        ? analysis ? analysisTable(rows) : reservationTable(rows)
        : notice(analysis
          ? section === "posture"
            ? "No posture assessment has been recorded for this client yet. A coach can start a new capture."
            : section === "movement"
              ? "No movement analysis has been recorded for this client yet. A coach can start a video assessment."
              : "No assessment matches this selection. Try another search or start a new capture."
          : "No reservation matches this selection. A coach or administrator can schedule the next visit."),
    });
  }
  const rows = (await list(collection, { limit: 200 })).items;
  if (collection === "locations")
    root.innerHTML =
      head(
        "Locations",
        "Manage rooms, capacity and connected people.",
        '<button data-edit="locations">+ Location</button>',
      ) +
      `<div class="grid two">${rows.map((l) => card(l.name, `<p>${esc(l.address)}</p><p>Capacity ${l.capacity} · ${state.me.students.filter((s) => s.location_ids.includes(l.id)).length} clients · ${state.me.coaches.filter((s) => s.location_ids.includes(l.id)).length} coaches</p><button data-edit="locations" data-id="${l.id}">Manage location</button>`)).join("")}</div>`;
  else if (collection === "equipment")
    root.innerHTML =
      head(
        "Equipment",
        "Availability at your assigned locations.",
        state.me.role === "admin"
          ? '<button data-edit="equipment">+ Equipment</button>'
          : "",
      ) +
      table(
        ["Equipment", "Location", "Available", "Total", ""],
        rows.map((e) => [
          esc(e.name),
          esc(locationName(e.location_id)),
          e.available,
          e.quantity,
          state.me.role === "admin"
            ? `<button data-edit="equipment" data-id="${e.id}">Edit</button>`
            : "",
        ]),
      );
  else root.innerHTML = notice("Choose a section from the sidebar.");
}
export function chooseClient(root) {
  root.innerHTML =
    head(
      "Select a client",
      "Body regions, scans and feedback stay connected to the selected client.",
    ) +
    `<div class="client-grid">${state.me.students.map(clientCard).join("")}</div>`;
}
window.addEventListener("hashchange", () =>
  render().catch((e) => toast(e.message)),
);
window.addEventListener("platform-refresh", async () => {
  if (state.me) {
    state.me = await api("me");
    await render();
  }
});
initialize();
