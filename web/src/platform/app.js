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
} from "./core.js";
import { edit } from "./forms.js";
const tabs = [
  "Overview",
  "Programs",
  "Sessions",
  "Posture",
  "Movement",
  "Analysis",
  "Anatomy",
  "Scans",
  "Progress",
  "Notes",
  "Schedule",
];
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
  const isStudent = me.role === "student";
  let nav = isStudent
    ? [
        ["dashboard", "Dashboard", "home"],
        ["programs", "My program", "programs"],
        ["analysis", "My analysis", "reports"],
        ["anatomy", "My body", "anatomy"],
        ["progress", "My progress", "timeline"],
        ["schedule", "Schedule", "schedule"],
      ]
    : [
        ["dashboard", "Dashboard", "home"],
        ["clients", me.role === "coach" ? "My clients" : "Clients", "clients"],
        ["schedule", "Schedule", "schedule"],
        ["programs", "Programs", "programs"],
        ["exercises", "Exercises", "library"],
        ["analysis", "Analysis", "reports"],
        ["anatomy", "Anatomy", "anatomy"],
        ["scans", "Scans", "scans"],
        ["equipment", "Equipment", "equipment"],
        ["content", "My content", "notes"],
      ];
  if (me.role === "admin")
    nav.push(
      ["coaches", "Coaches", "clients"],
      ["locations", "Locations", "home"],
      ["system", "System data", "settings"],
      ["storage", "Storage & recovery", "settings"],
    );
  $("#sidebar").innerHTML =
    `<a class="brand" href="${href("dashboard")}"><span class="brand-mark">M</span><span>motion yoga<small>Connected movement</small></span></a><div class="eyebrow">${esc(me.role)}</div><nav>${nav.map(([page, title, ico]) => `<a href="${href(page)}" class="${p.get("page") === page || (!p.get("page") && page === "dashboard") ? "active" : ""}">${icon(ico)} ${esc(title)}</a>`).join("")}</nav><div class="sidebar-foot"><strong>${esc(me.user.name)}</strong><small>${esc(me.organization.name)}</small><button id="logout">Sign out</button></div>`;
  $("#topbar").innerHTML =
    `<button id="menu" aria-label="Toggle navigation">☰</button><div class="breadcrumb">${esc(me.role)} / ${esc(p.get("page") || "Dashboard")}</div><form id="global-search"><input name="q" aria-label="Search clients, programs and exercises" placeholder="Search your workspace…"><button>Search</button></form>${
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
  return `<section class="client-context"><div class="client-identity">${avatar(c)}<div><a href="${href("client", { client: c.id, tab: "overview" })}"><h2>${esc(c.name)}</h2></a><small>${c.detail?.age ? esc(c.detail.age) + " years · " : ""}${esc(c.location_ids.map(locationName).join(", "))} · ${esc(c.coach_ids.map(coachName).join(", "))}</small></div><div class="context-summary"><small>Current program</small><span>${esc(c.programs.map((p) => p.name).join(", ") || "Choose a program")}</span><small>Next reservation · ${dt(c.next_reservation?.starts_at)}</small>${c.latest_analysis ? `<a href="${href("report", { id: c.latest_analysis.id })}">Latest analysis · ${date(c.latest_analysis.created_at)} →</a>` : ""}</div>${state.me.role !== "student" ? `<a class="button" href="${href("clients", { client: "" })}">Change client</a>` : ""}</div><nav class="client-tabs">${tabs.map((t) => `<a href="${href("client", { client: c.id, tab: t.toLowerCase(), id: "" })}" class="${params().get("tab") === t.toLowerCase() ? "active" : ""}">${esc(t)}</a>`).join("")}</nav></section>`;
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
      else if (tab === "sessions") sessions(root);
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
async function dashboard(root) {
  const student = state.me.role === "student";
  const [analysis, reservations, programs] = await Promise.all([
    list("analyses", { limit: 12 }),
    list("reservations"),
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
    `<div class="stats">${stat(student ? "Assigned programs" : "Active clients", student ? c?.programs.length || 0 : state.me.students.length, student ? "Chosen by your coach" : "Visible to your role", "clients")}${stat("Assessments", analysis.total, "Saved to client histories")}${stat("Upcoming sessions", future.length, "Confirmed reservations", "schedule")}${stat(student ? "Your coach" : "Locations", student ? coachName(c?.coach_ids[0]) : state.me.locations.length, student ? locationName(c?.location_ids[0]) : "Connected studios", "home")}</div><div class="grid two">${card(student ? "Today’s program" : "Next on your schedule", student ? programCards(programs.items) : reservationTable(future.slice(0, 6)))}${card("Recent analysis", analysisTable(analysis.items.slice(0, 6)))}</div>${!student ? card("Clients to review", `<div class="client-grid">${attention.slice(0, 8).map(clientCard).join("") || "<p>No clients currently need a missing-program, capture-quality or 30-day review follow-up.</p>"}</div>`) : c ? card("Your progress", progressChart(c.progress || [])) : ""}`;

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
          ["Client", "Sessions", "Latest practice", "Completed movements"],
          state.me.students.map((p) => [
            `<a href="${href("client", { client: p.id, tab: "sessions" })}">${esc(p.name)}</a>`,
            p.session_count || 0,
            date(p.latest_session?.performed_at),
            `${p.latest_session?.completed?.length || 0} / ${p.last_session_steps || 0}`,
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
function clientCard(c) {
  return `<a class="client-card" href="${href("client", { client: c.id, tab: "overview", id: "" })}">${avatar(c)}<div><h3>${esc(c.name)}</h3><small>${esc(c.detail?.age || "")} · ${esc(c.location_ids.map(locationName).join(", "))}</small><p>${esc(c.programs?.[0]?.name || "No assigned program")}</p><small>Latest assessment ${date(c.latest_analysis?.created_at)} · Next ${dt(c.next_reservation?.starts_at)}</small><small>Latest practice ${date(c.latest_session?.performed_at)} · ${c.session_count || 0} sessions</small><small>Last practice: ${c.latest_session?.completed?.length || 0}/${c.last_session_steps || 0} planned movements completed</small></div></a>`;
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
  root.innerHTML =
    head(
      "Client overview",
      c.goal,
      `<a class="button primary" href="${href("capture")}">New assessment</a>`,
    ) +
    `<div class="stats">${stat("Assessments", c.analyses.length, "Posture and movement")}${stat("Practice sessions", c.sessions.length, "Completed exercises", "programs")}${stat("Coach notes", c.notes.length, "Linked to body regions", "notes")}${stat("Next session", dt(c.next_reservation?.starts_at), locationName(c.next_reservation?.location_id), "schedule")}</div><div class="grid two">${card("History", analysisTable(c.analyses))}${card("Progress", progressChart(c.progress))}${card("Current practice", programCards(c.programs))}${card("Coaching focus", notesHTML(c.notes.slice(0, 3)))}</div>`;
}
export function analysisTable(rows) {
  return table(
    ["Session", "Client", "Protocol", "Evidence"],
    rows.map((a) => [
      `<a href="${href("report", { client: a.student_id, id: a.id })}">${date(a.created_at)} · ${esc(a.kind)}</a>`,
      esc(clientName(a.student_id)),
      esc(a.protocol),
      badge(
        a.demo
          ? "Demo simulation"
          : a.status === "complete"
            ? "Measured"
            : "Needs capture",
        a.demo ? "demo" : "",
      ),
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
function sessions(root) {
  root.innerHTML =
    head(
      "Client sessions",
      "Assessment evidence and completed practice, saved to this client.",
    ) +
    card("Assessment sessions", analysisTable(state.client.analyses)) +
    "<h2>Practice sessions</h2>" +
    table(
      ["Date", "Practice", "Evidence", "Coach note"],
      state.client.sessions.map((s) => [
        date(s.performed_at),
        `${s.completed.length} exercises · <a href="${href("program", { id: s.program_id })}">Open program</a>`,
        s.analysis_id
          ? `<a href="${href("report", { id: s.analysis_id })}">Open analysis</a>`
          : "Training record",
        esc(s.notes),
      ]),
    );
}
function progressChart(rows) {
  const metrics = [...new Set(rows.map((r) => r.metric))];
  const preferred = [
    "front:shoulder_tilt",
    "front:pelvic_obliquity",
    "front:left_shoulder_rom",
    "front:right_shoulder_rom",
  ];
  return (
    [
      ...preferred.filter((k) => metrics.includes(k)),
      ...metrics.filter((k) => !preferred.includes(k)),
    ]
      .slice(0, 4)
      .map((key) =>
        spark(
          rows.filter((r) => r.metric === key).map((r, i) => [i + 1, r.value]),
          {
            label: key.replaceAll("_", " "),
            unit: rows.find((r) => r.metric === key)?.unit,
          },
        ),
      )
      .join("") ||
    notice("Progress charts appear after comparable measurements are saved.")
  );
}
function progress(root) {
  const c = state.client;
  const groups = [
    ...new Set(
      c.analyses.map(
        (a) =>
          `${a.demo ? "Demo simulation" : "Uploaded media"} · ${a.kind} · ${a.protocol}`,
      ),
    ),
  ];
  root.innerHTML =
    head(
      "Progress across visits",
      "Compare measurements from the same capture kind, protocol and source. Click source sessions to inspect their evidence.",
    ) +
    `<div class="filter-row">${select(
      "Comparable protocol",
      "history-protocol",
      groups.map((x) => [x, x]),
      groups[0],
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
    const rows = c.progress.filter(
      (r) => ids.has(r.analysis_id) && r.metric === metric,
    );
    root.querySelector("#history-chart").innerHTML =
      spark(
        rows.map((r) => [new Date(r.recorded_at).getTime(), r.value]),
        {
          label: metric.replaceAll("_", " "),
          unit: rows[0]?.unit || "",
          xLabel: (v) => date(new Date(v)),
        },
      ) +
      table(
        ["Date", "Value", "Source"],
        rows.map((r) => [
          date(r.recorded_at),
          `${r.value} ${esc(r.unit)}`,
          `<a href="${href("report", { id: r.analysis_id })}">Open analysis</a>`,
        ]),
      );
    root.querySelector("#history-records").innerHTML = card(
      "Source sessions",
      analysisTable(sessions),
    );
  }
  function metrics() {
    const ids = new Set(sources().map((a) => a.id));
    const names = [
      ...new Set(
        c.progress.filter((r) => ids.has(r.analysis_id)).map((r) => r.metric),
      ),
    ];
    root.querySelector("[name=history-metric]").innerHTML = options(
      names.map((n) => [n, n.replaceAll("_", " ")]),
      names.find((n) =>
        /shoulder_rom|hip_rom|knee_rom|shoulder_tilt|head_tilt|forward_head/.test(
          n,
        ),
      ) ||
        names.find((n) => n.endsWith("_rom")) ||
        names[0],
      null,
    );
    draw();
  }
  root.querySelector("[name=history-protocol]").onchange = metrics;
  root.querySelector("[name=history-metric]").onchange = draw;
  metrics();
}
export function notesHTML(notes) {
  return (
    notes
      .map(
        (n) =>
          `<article class="note"><a href="${href("client", { tab: "anatomy", region: n.region_id, id: n.analysis_id })}">${esc(regionName(n.region_id))}</a><p>${esc(n.text)}</p><small>${date(n.created_at)} · ${esc(n.visibility)}</small>${n.analysis_id ? ` · <a href="${href("report", { id: n.analysis_id })}">Analysis</a>` : ""}${n.scan_id ? ` · <a href="${href("client", { tab: "scans", scan: n.scan_id })}">Scan</a>` : ""}${n.program_id ? ` · <a href="${href("program", { id: n.program_id })}">Program</a>` : ""}${state.me.role !== "student" ? ` <button data-edit="notes" data-id="${n.id}">Edit</button>` : ""}</article>`,
      )
      .join("") || notice("No notes for this selection.")
  );
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
    root.innerHTML =
      head(
        "Coaching notes",
        "Notes linked to this client, region, analysis and program.",
        state.me.role === "student"
          ? ""
          : '<button data-edit="notes">+ Note</button>',
      ) + notesHTML(c.notes);
    return;
  }
  if (collection === "exercises" || collection === "programs") {
    const { library } = await import("./library.js");
    return library(root, collection, section === "content");
  }
  if (["analyses", "reservations"].includes(collection)) {
    const { pagedRecords } = await import("./paging.js");
    const analysis = collection === "analyses";
    return pagedRecords(root, {
      collection,
      filters: {
        ...(c ? { student_id: c.id } : {}),
        ...(["posture", "movement"].includes(section) ? { kind: section } : {}),
      },
      title: head(
        analysis ? "Assessments" : "Schedule",
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
      renderRows: (rows) =>
        analysis ? analysisTable(rows) : reservationTable(rows),
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
