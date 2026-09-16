import {
  $,
  esc,
  id,
  date,
  num,
  views,
  icon,
  badge,
  empty,
  link,
  card,
  chart,
  bars,
  stat,
  download,
  localGet,
  localPut,
  workspace,
  request,
  safeSource,
  toast,
} from "./core.js";
import { exercises, exerciseById } from "./exercises.js";
import { renderReport, photoPanel, metricsTable } from "./reports.js";
import { capture } from "./capture.js";
let mode = localStorage.getItem("motion-yoga-mode") || "demo",
  key = workspace(mode),
  state = null,
  routeVersion = 0;
const collections = [
  "clients",
  "reports",
  "notes",
  "programs",
  "bookings",
  "payments",
  "equipment",
];
const titles = {
  home: "Overview",
  clients: "Clients",
  capture: "New assessment",
  reports: "Assessment reports",
  report: "Assessment report",
  compare: "Visit comparison",
  timeline: "Client timeline",
  programs: "Programs & sequences",
  library: "Exercise library",
  anatomy: "3D anatomy",
  schedule: "Schedule & attendance",
  notes: "Coaching notes",
  xray: "X-ray records",
  payments: "Payment records",
  equipment: "Studio equipment",
  settings: "Workspace settings",
};
const nav = [
  [
    "WORKSPACE",
    [
      ["home", "Overview"],
      ["clients", "Clients"],
      ["reports", "Assessments"],
      ["compare", "Compare visits"],
      ["timeline", "Client timeline"],
    ],
  ],
  [
    "PRACTICE",
    [
      ["programs", "Programs & sequences"],
      ["library", "Exercise library"],
      ["anatomy", "3D anatomy"],
      ["notes", "Coaching notes"],
      ["xray", "X-ray records"],
    ],
  ],
  [
    "STUDIO",
    [
      ["schedule", "Schedule & attendance"],
      ["payments", "Payment records"],
      ["equipment", "Equipment"],
      ["settings", "Settings & backup"],
    ],
  ],
];
const avatar = (c) =>
  `<span class="avatar">${esc(
    (c?.name || "MY")
      .split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join(""),
  )}</span>`;
const today = () =>
  state?.demo ? state.demo_date : new Date().toISOString().slice(0, 10);
const orderedReports = () =>
  [...(state?.reports || [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
const head = (title, subtitle, actions = "") =>
  `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
const chooseClient = (selected = "", all = false, id = "client-filter") =>
  `<select id="${id}" aria-label="Choose client">${all ? '<option value="">All clients</option>' : ""}${state.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;
const clientName = (cid) =>
  state.clients.find((c) => c.id === cid)?.name || "Client";
function ctx() {
  const capturedKey = key,
    target = state;
  return {
    key: capturedKey,
    state: target,
    save: (collection, item) => saveTo(capturedKey, target, collection, item),
    onComplete: async (report, client) => {
      upsert("reports", report, target);
      if (client)
        upsert(
          "clients",
          {
            ...(target.clients.find((c) => c.id === client.id) || {}),
            ...client,
          },
          target,
        );
      await localPut(`${capturedKey}:state`, target);
      if (key === capturedKey) {
        // A workspace may have been reloaded while the queued job was running.
        if (state !== target) {
          upsert("reports", report);
          if (client)
            upsert("clients", {
              ...state.clients.find((c) => c.id === client.id),
              ...client,
            });
          await cache();
        }
        location.hash = `report/${report.id}`;
      }
    },
  };
}
function upsert(collection, item, target = state) {
  const index = target[collection].findIndex((x) => x.id === item.id);
  if (index < 0) target[collection].unshift(item);
  else target[collection][index] = item;
}
async function cache() {
  await localPut(`${key}:state`, state);
}
async function saveTo(capturedKey, target, collection, item) {
  const out = await request(capturedKey, "save", {
    method: "POST",
    body: { collection, item },
  });
  upsert(collection, out, target);
  await localPut(`${capturedKey}:state`, target);
  return out;
}
async function save(collection, item) {
  return saveTo(key, state, collection, item);
}
async function load() {
  key = workspace(mode);
  const local = await localGet(`${key}:state`);
  try {
    state = await request(key, "state");
    if (local && !state.demo) {
      for (const c of collections) {
        const map = new Map(state[c].map((x) => [x.id, x]));
        for (const item of local[c] || []) {
          const remote = map.get(item.id);
          if (
            !remote ||
            (item.updated_at || item.created_at || "") >
              (remote.updated_at || remote.created_at || "")
          )
            map.set(item.id, item);
        }
        state[c] = [...map.values()];
      }
    }
    await cache();
  } catch (e) {
    if (local) {
      state = local;
      toast(
        "Using records saved on this device. Reconnect to save or analyze.",
      );
    } else if (mode === "demo") {
      const res = await fetch("/assets/studio/demo.json");
      if (!res.ok) throw e;
      state = await res.json();
      toast("Demo opened. The analysis server may still be waking up.");
    } else throw e;
  }
}
function shell(page) {
  $("#sidebar").innerHTML =
    `<a class="brand" href="#home"><span class="brand-mark">M</span><span>motion yoga<small>NEURO WELLNESS</small></span></a><nav aria-label="Studio navigation">${nav.map(([title, items]) => `<div class="nav-group">${title}</div>${items.map(([r, t]) => `<a class="nav-link ${page === r || (page === "report" && r === "reports") ? "active" : ""}" href="#${r}">${icon(r)}<span>${t}</span></a>`).join("")}`).join("")}</nav><div class="sidebar-bottom"><div class="studio-name">${state.demo ? "Investor demo studio" : "My personal studio"}<small style="display:block">${state.demo ? "24 fictional client profiles" : "Saved on this device"}</small></div><div class="person">${avatar({ name: state.coach })}<div><strong>${esc(state.coach || "Studio coach")}</strong><small>${state.demo ? "Demo coach profile" : "Workspace owner"}</small></div></div>`;
  $("#topbar").innerHTML =
    `<button class="mobile-menu ghost" aria-label="Open navigation">☰</button><span class="breadcrumb">Studio <span style="padding:0 10px">/</span><b>${titles[page] || "Overview"}</b></span><div class="tools"><select id="workspace-mode" aria-label="Workspace"><option value="demo" ${mode === "demo" ? "selected" : ""}>Investor demo</option><option value="live" ${mode === "live" ? "selected" : ""}>My studio</option></select>${link("+ New assessment", "capture", "primary")}${avatar({ name: state.coach })}</div>`;
  $("#mode-banner").innerHTML =
    `<div class="mode-banner ${mode === "live" ? "live" : ""}"><span>${state.demo ? "DEMO WORKSPACE · Fictional clients, synthetic trends and clearly labeled sample imagery." : "PERSONAL WORKSPACE · Real captures and measured evidence. Original media is kept on this device."}</span><a href="#settings">${state.demo ? "About demo data" : "Backup records"} ↗</a></div>`;
  $("#workspace-mode").onchange = async (e) => {
    mode = e.target.value;
    localStorage.setItem("motion-yoga-mode", mode);
    await load();
    location.hash = "home";
    route();
  };
  $(".mobile-menu").onclick = () => document.body.classList.toggle("menu-open");
  document
    .querySelectorAll(".nav-link")
    .forEach(
      (a) => (a.onclick = () => document.body.classList.remove("menu-open")),
    );
}
function reportRows(reports) {
  return `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Date</th><th>Assessment</th><th>Evidence</th><th></th></tr></thead><tbody>${reports.map((r) => `<tr><td><a href="#clients/${esc(r.client_id)}">${esc(r.client_name || clientName(r.client_id))}</a></td><td>${date(r.created_at)}</td><td>${r.kind === "movement" ? "Movement" : "Posture · " + r.views.length + " views"}</td><td>${badge(r.demo ? "Synthetic example" : r.summary?.complete_views ? "Captured" : "Needs review", r.demo ? "demo" : r.summary?.complete_views ? "green" : "amber")}</td><td>${link("Open report", `report/${r.id}`)}</td></tr>`).join("")}</tbody></table></div>`;
}
function overview() {
  const recent = orderedReports(),
    past = state.bookings.filter((b) =>
      ["attended", "missed"].includes(b.status),
    ),
    attended = past.filter((b) => b.status === "attended").length,
    attendance = past.length ? Math.round((attended / past.length) * 100) : 0,
    months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today());
      d.setMonth(d.getMonth() - 5 + i);
      return {
        label: d.toLocaleDateString("en-US", { month: "short" }),
        prefix: d.toISOString().slice(0, 7),
      };
    });
  const focus = state.clients[0],
    visits = recent.filter((r) => r.client_id === focus?.id).reverse();
  const next = state.bookings
    .filter((b) => b.status === "reserved" && b.date >= today())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  $("#app").innerHTML =
    head(
      "Your studio, in motion.",
      `A connected view of your clients, their practice, and what changes over time.`,
      `${link("Explore client history", "timeline")}${link("Start an assessment", "capture", "primary")}`,
    ) +
    `<div class="stats">${stat("Clients", state.clients.length, `${state.clients.filter((c) => c.status === "active").length} active profiles`, "clients")}${stat("Assessments", state.reports.length, "Posture & movement evidence", "reports")}${stat("Sessions attended", attended, "Recorded studio attendance", "schedule")}${stat("Attendance rate", past.length ? attendance + "%" : "—", `${past.length} completed session records`, "timeline")}</div><div class="grid cols-3"><section class="card hero span-2"><div><p class="eyebrow">A CLEARER PICTURE OF PROGRESS</p><h2>From a single capture<br>to a lasting practice.</h2><p>Bring posture, movement and coaching into one client story. Start with a guided capture, then follow the changes.</p><div class="actions">${link("New assessment", "capture", "primary")}${state.demo ? link("View a sample report", `report/${recent[0]?.id}`) : link("Your reports", "reports")}</div></div><div class="hero-photo"><img src="/assets/studio/bird-dog.png" alt="Generated bird dog exercise illustration"><small>AI-generated exercise illustration</small></div></section>${card("Session attendance", `<div class="ring" style="--value:${attendance}"><div><strong>${past.length ? attendance + "%" : "—"}</strong><small>attendance</small></div></div><div class="list-row"><span>Attended</span><b>${attended}</b></div><div class="list-row"><span>Missed</span><b>${past.length - attended}</b></div>`, link("Schedule", "schedule"))}</div><div class="grid cols-3 section-space">${card("Assessment activity", bars(months.map((m) => ({ label: m.label, value: state.reports.filter((r) => r.created_at.startsWith(m.prefix)).length }))), badge(state.demo ? "6-month demo" : "6 months", state.demo ? "demo" : ""))}${card(
      "A client’s journey",
      chart(
        visits.map((r) => r.summary?.score),
        {
          labels: visits.map((r) =>
            new Date(r.created_at).toLocaleDateString("en-US", {
              month: "short",
            }),
          ),
        },
      ) +
        `<div class="list-row"><span>${esc(focus?.name || "No client selected")}</span>${focus ? link("View history", `clients/${focus.id}`) : ""}</div><small>${state.demo ? "Synthetic alignment trend for demonstration." : "Image alignment index; camera changes can affect the trend."}</small>`,
    )}${card("Next on the schedule", next.length ? next.map((b) => `<div class="list-row"><div><strong>${esc(b.client_name)}</strong><p>${esc(b.title)}</p></div><small>${date(b.date)}<br>${new Date(b.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("") : empty("Space for the next session", "Add a session to your studio schedule.", link("Add a session", "schedule")))}</div><div class="grid cols-3 section-space"><div class="span-2">${card("Recent assessments", recent.length ? reportRows(recent.slice(0, 5)) : empty("Your first report starts here", "Upload front, back or side photographs, or a short movement video.", link("Start assessment", "capture", "primary")), link("View all", "reports"))}</div>${card(
      "Follow-up & coaching",
      state.clients
        .filter((c) => c.status === "follow-up")
        .map(
          (c) =>
            `<div class="list-row"><div class="person">${avatar(c)}<div><strong>${esc(c.name)}</strong><small>Check-in recommended</small></div></div>${link("Profile", `clients/${c.id}`)}</div>`,
        )
        .join("") ||
        '<p class="muted" style="font-size:12px">No clients marked for follow-up.</p>',
      link("Coaching notes", "notes"),
    )}</div>`;
}
function clientForm(c = {}) {
  form(
    c.id ? "Edit client" : "Add a client",
    `<label>Full name<input name="name" maxlength="80" value="${esc(c.name)}" required></label><label>Personal goal<textarea name="goal" maxlength="500">${esc(c.goal)}</textarea></label><div class="field-grid"><label>Height (cm)<input name="height_cm" type="number" min="50" max="250" step=".1" value="${c.height_cm || ""}"></label><label>Weight (kg)<input name="weight_kg" type="number" min="10" max="400" step=".1" value="${c.weight_kg || ""}"></label><label>Status<select name="status"><option value="active">Active</option><option value="follow-up" ${c.status === "follow-up" ? "selected" : ""}>Follow-up</option></select></label><label>Coach<input name="coach" value="${esc(c.coach || state.coach)}"></label></div><p class="subtle">Height and weight are entered manually from a measurement, never estimated from a photo.</p>`,
    async (data) => {
      for (const n of ["height_cm", "weight_kg"])
        data[n] = data[n] ? Number(data[n]) : null;
      await save("clients", { ...c, ...data, joined: c.joined || today() });
    },
  );
}
function clients(cid) {
  const c = state.clients.find((c) => c.id === cid);
  if (c) {
    const reports = orderedReports().filter((r) => r.client_id === cid),
      visits = [...reports].reverse();
    $("#app").innerHTML =
      head(
        c.name,
        c.goal || "Client profile",
        `<button id="edit-client">Edit profile</button>${link("New assessment", "capture", "primary")}`,
      ) +
      `<div class="grid cols-3">${card("Client profile", `<div class="profile-head">${avatar(c)}<div><h2>${esc(c.name)}</h2><p>Joined ${date(c.joined)}</p></div></div><div class="section-space"><div class="inline-value"><span>Coach</span><b>${esc(c.coach || state.coach)}</b></div><div class="inline-value"><span>Height</span><b>${num(c.height_cm, "cm")}</b></div><div class="inline-value"><span>Weight</span><b>${num(c.weight_kg, "kg")}</b></div><div class="inline-value"><span>Status</span>${badge(c.status || "active", "green")}</div></div><p class="subtle">${state.demo ? "Fictional client profile. Body measurements are synthetic." : "Body measurements are coach-entered, not inferred from images."}</p>`)}<div class="span-2">${card(
        "Assessment history",
        chart(
          visits.map((r) => r.summary?.score),
          {
            labels: visits.map((r) =>
              new Date(r.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }),
            ),
          },
        ) +
          `<div class="actions">${link("Compare visits", `compare/${cid}`)}${link("View timeline", `timeline/${cid}`)}${link("Add coach note", `notes/${cid}`)}</div>`,
      )}</div></div><div class="section-space">${card("Reports", reports.length ? reportRows(reports) : empty("No assessments yet", "Add a clear photo or movement video to build this client’s first report."))}</div>`;
    $("#edit-client").onclick = () => clientForm(c);
    return;
  }
  $("#app").innerHTML =
    head(
      "Clients",
      "Every assessment, goal and check-in in one place.",
      '<button id="add-client" class="primary">+ Add client</button>',
    ) +
    `<div class="filterbar"><input id="client-search" type="search" placeholder="Search clients…" aria-label="Search clients"><span class="muted" style="font-size:12px">${state.clients.length} client profiles</span></div><div id="client-grid" class="list-grid"></div>`;
  const draw = () => {
    const query = $("#client-search").value.toLowerCase(),
      rows = state.clients.filter((c) => c.name.toLowerCase().includes(query));
    $("#client-grid").innerHTML =
      rows
        .map((c) => {
          const reports = orderedReports().filter((r) => r.client_id === c.id);
          return `<a href="#clients/${esc(c.id)}" class="card client-card"><div class="person">${avatar(c)}<div><strong>${esc(c.name)}</strong><small>${esc(c.coach || state.coach)}</small></div></div><p>${esc(c.goal)}</p><div class="client-stats"><div><strong>${reports.length}</strong><small>Assessments</small></div><div><strong>${date(reports[0]?.created_at)}</strong><small>Last assessment</small></div></div></a>`;
        })
        .join("") ||
      empty(
        "No clients yet",
        "Add a client or start an assessment to create one.",
      );
  };
  $("#client-search").oninput = draw;
  $("#add-client").onclick = () => clientForm();
  draw();
}
function reports() {
  const all = orderedReports();
  $("#app").innerHTML =
    head(
      "Assessment reports",
      "Posture and movement share one evidence-based workflow.",
      link("New assessment", "capture", "primary"),
    ) +
    `<div class="filterbar">${chooseClient("", true)}<select id="kind-filter" aria-label="Assessment type"><option value="">All assessments</option><option value="posture">Posture</option><option value="movement">Movement</option></select></div><div id="report-list" class="card"></div>`;
  const draw = () => {
    const rows = all.filter(
      (r) =>
        (!$("#client-filter").value ||
          r.client_id === $("#client-filter").value) &&
        (!$("#kind-filter").value || r.kind === $("#kind-filter").value),
    );
    $("#report-list").innerHTML = rows.length
      ? reportRows(rows)
      : empty(
          "No matching reports",
          "Try another client or add an assessment.",
          link("New assessment", "capture", "primary"),
        );
  };
  $("#client-filter").onchange = draw;
  $("#kind-filter").onchange = draw;
  draw();
}
async function compare(cid) {
  cid = cid || state.clients[0]?.id;
  $("#app").innerHTML =
    head(
      "Compare visits",
      "Inspect the same camera view and protocol before interpreting a change.",
    ) +
    `<div class="filterbar">${chooseClient(cid)}</div><div id="comparison"></div>`;
  $("#client-filter").onchange = (e) => {
    location.hash = "compare/" + e.target.value;
  };
  const reports = orderedReports().filter((r) => r.client_id === cid);
  if (reports.length < 2) {
    $("#comparison").innerHTML = empty(
      "Two visits make a comparison",
      "Complete two assessments for the same client, then compare matching views.",
      link("Start assessment", "capture", "primary"),
    );
    return;
  }
  $("#comparison").innerHTML =
    `<div class="filterbar"><label>Earlier assessment<select id="compare-a">${reports.map((r, i) => `<option value="${r.id}" ${i === reports.length - 1 ? "selected" : ""}>${date(r.created_at)} · ${r.kind}</option>`).join("")}</select></label><label>Later assessment<select id="compare-b">${reports.map((r, i) => `<option value="${r.id}" ${i === 0 ? "selected" : ""}>${date(r.created_at)} · ${r.kind}</option>`).join("")}</select></label><label>View<select id="compare-view">${Object.entries(
      views,
    )
      .map(([v, t]) => `<option value="${v}">${t}</option>`)
      .join("")}</select></label></div><div id="comparison-body"></div>`;
  const draw = async () => {
    const a = reports.find((r) => r.id === $("#compare-a").value),
      b = reports.find((r) => r.id === $("#compare-b").value),
      view = $("#compare-view").value,
      av = a.views.find((v) => v.view === view),
      bv = b.views.find((v) => v.view === view);
    if (!av || !bv || a.kind !== b.kind) {
      $("#comparison-body").innerHTML = empty(
        "Choose matching captures",
        "Both visits need the same camera view and assessment type.",
      );
      return;
    }
    if (a.kind === "movement" && av.report.protocol !== bv.report.protocol) {
      $("#comparison-body").innerHTML = empty(
        "Movement protocols differ",
        "Repeat the same movement and camera view to compare range.",
      );
      return;
    }
    let pa = av.report.people?.[0],
      pb = bv.report.people?.[0];
    if (av.report.people.length !== 1 || bv.report.people.length !== 1) {
      $("#comparison-body").innerHTML = empty(
        "Individual comparison needs one person",
        "Multi-person tracking identifiers are not identities across visits. Capture each client individually for a reliable longitudinal comparison.",
      );
      return;
    }
    let rows =
      a.kind === "posture"
        ? (pb?.metrics || []).map((m) => {
            const before = pa?.metrics?.find((x) => x.id === m.id);
            return {
              name: m.name,
              unit: m.unit,
              before: before?.value,
              after: m.value,
            };
          })
        : Object.entries(pb?.signals || {}).map(([id, s]) => ({
            name: id.replaceAll("_", " ") + " ROM",
            unit: "deg",
            before: pa?.signals?.[id]?.rom,
            after: s.rom,
          }));
    rows = rows.filter((r) => r.before != null && r.after != null);
    $("#comparison-body").innerHTML =
      `<div class="grid cols-2">${card("Earlier · " + date(a.created_at), a.kind === "posture" ? await photoPanel(a, av, 0, { key }) : chart(pa?.signals?.left_knee?.series?.map((x) => x[1]) || [], { unit: "deg" }))}${card("Later · " + date(b.created_at), b.kind === "posture" ? await photoPanel(b, bv, 0, { key }) : chart(pb?.signals?.left_knee?.series?.map((x) => x[1]) || [], { unit: "deg" }))}</div><div class="section-space">${card("Measured differences", rows.length ? `<div class="table-wrap"><table><thead><tr><th>Measurement</th><th>Earlier</th><th>Later</th><th>Change</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${num(r.before, r.unit)}</td><td>${num(r.after, r.unit)}</td><td>${num(Math.round((r.after - r.before) * 1000) / 1000, r.unit)}</td></tr>`).join("")}</tbody></table></div>` : empty("No comparable measurements", "The two captures need reliable evidence for the same metric."))}</div><div class="notice">${a.demo || b.demo ? "Synthetic comparison: values illustrate a longitudinal report. The sample photograph is not evidence of improvement." : "Changes are calculated from saved measurements. Camera angle, distance, clothing, movement and tracking quality can affect them; a smaller number does not necessarily mean a better outcome."}</div>`;
  };
  ["#compare-a", "#compare-b", "#compare-view"].forEach(
    (s) => ($(s).onchange = draw),
  );
  await draw();
}
function noteForm(cid = "", note = {}) {
  form(
    note.id ? "Edit coaching note" : "New coaching note",
    `<label>Client${chooseClient(note.client_id || cid || state.clients[0]?.id, false, "note-client").replace('id="note-client"', 'name="client_id"')}</label><label>Title<input name="title" value="${esc(note.title || "Practice check-in")}" maxlength="100" required></label><label>Notes<textarea name="text" maxlength="5000" required>${esc(note.text)}</textarea></label><label>Goal<input name="goal" value="${esc(note.goal)}" maxlength="300"></label><div class="field-grid"><label>Visit date<input name="date" type="date" value="${note.date || today()}" required></label><label>Next check-in<input name="followup" type="date" value="${note.followup || ""}"></label></div><label class="check"><input type="checkbox" name="private" ${note.private !== false ? "checked" : ""}> Coach note (excluded from report exports)</label>`,
    async (data) => {
      data.private = data.private === "on";
      await save("notes", { ...note, ...data });
    },
  );
}
function timeline(cid = "", onlyNotes = false) {
  const filtered = cid || "";
  $("#app").innerHTML =
    head(
      onlyNotes ? "Coaching notes" : "Client timeline",
      onlyNotes
        ? "Goals, observations and the next step, in the coach’s own words."
        : "Follow assessments, practice sessions and coaching check-ins over time.",
      '<button id="new-note" class="primary">+ New note</button>',
    ) +
    `<div class="filterbar">${chooseClient(filtered, true)}${!onlyNotes ? '<select id="event-filter" aria-label="Event type"><option value="">All activity</option><option value="reports">Assessments</option><option value="notes">Coaching notes</option><option value="bookings">Sessions</option></select>' : ""}</div><div id="timeline-body" class="timeline"></div>`;
  const draw = () => {
    const client = $("#client-filter").value,
      kind = onlyNotes ? "notes" : $("#event-filter").value;
    let events = [];
    for (const type of ["reports", "notes", "bookings"]) {
      if (kind && type !== kind) continue;
      events.push(
        ...state[type]
          .filter(
            (x) => (!client || x.client_id === client) && x.kind !== "xray",
          )
          .map((x) => ({ ...x, type, when: x.created_at || x.date })),
      );
    }
    events.sort((a, b) => b.when.localeCompare(a.when));
    $("#timeline-body").innerHTML =
      events
        .slice(0, 100)
        .map(
          (e) =>
            `<article class="event"><div class="event-head"><div><h4>${esc(e.type === "reports" ? (e.kind === "movement" ? "Movement assessment" : "Posture assessment") : e.title)}</h4><small>${esc(clientName(e.client_id))} · ${date(e.when)}</small></div>${badge(e.type === "reports" ? "Assessment" : e.type === "notes" ? "Coach note" : e.status, e.demo ? "demo" : "")}</div><p>${esc(e.text || e.goal || "")}</p>${e.followup ? `<p class="subtle">Next check-in: ${date(e.followup)}</p>` : ""}<div class="actions" style="margin-top:10px">${e.type === "reports" ? link("Open report", `report/${e.id}`) : e.type === "notes" ? `<button data-edit-note="${esc(e.id)}">Edit note</button>` : ""}</div></article>`,
        )
        .join("") ||
      empty(
        "No activity yet",
        "Assessments, notes and session records will appear here.",
      );
    document.querySelectorAll("[data-edit-note]").forEach(
      (b) =>
        (b.onclick = () =>
          noteForm(
            "",
            state.notes.find((n) => n.id === b.dataset.editNote),
          )),
    );
  };
  $("#client-filter").onchange = draw;
  if ($("#event-filter")) $("#event-filter").onchange = draw;
  $("#new-note").onclick = () =>
    state.clients.length
      ? noteForm($("#client-filter").value)
      : toast("Add a client first.");
  draw();
}
function exerciseCard(e, add = false) {
  return `<section class="card exercise-card"><div class="exercise-media">${e.image ? `<img src="/assets/studio/${e.image}" alt="Generated ${esc(e.name)} exercise illustration"><small>AI-generated illustration</small>` : icon("anatomy")}</div><div class="exercise-info"><div class="card-head" style="margin:0"><h3>${esc(e.name)}</h3>${badge(e.area)}</div><p>${esc(e.cue)}</p><div class="actions">${safeSource(e.source)}${add ? `<button data-add-exercise="${e.id}">+ Add</button>` : ""}</div></div></section>`;
}
function library() {
  $("#app").innerHTML =
    head(
      "Exercise library",
      "A starting point for a coach-led practice. Adapt range, support and volume to the individual.",
      link("Build a sequence", "programs", "primary"),
    ) +
    `<div class="grid cols-3">${exercises.map((e) => exerciseCard(e)).join("")}</div><div class="notice">These general exercise descriptions are educational. A photograph does not determine which muscles need strengthening or stretching. Review exercise choices with the client and stop if an exercise causes pain.</div>`;
}
function programs(pid) {
  if (pid) {
    const existing = state.programs.find((p) => p.id === pid);
    if (!existing) return;
    let program = structuredClone(existing);
    $("#app").innerHTML =
      head(
        "Edit sequence",
        "Build a practice with a clear order, manageable volume and a coaching goal.",
        `${link("All programs", "programs")}<button id="save-program" class="primary">Save program</button>`,
      ) +
      `<section class="card"><div class="field-grid"><label>Program name<input id="program-name" value="${esc(program.name)}" maxlength="100"></label><label>Assign to client${chooseClient(program.client_id || "", true, "program-client")}</label></div><label>Description<textarea id="program-description" maxlength="1000">${esc(program.description)}</textarea></label><div class="actions"><span id="sequence-total" class="badge"></span><button id="add-step">+ Add movement</button></div></section><div id="sequence" class="section-space"></div><div class="notice">Estimated time is the sum of sets × seconds for each movement. Adjust the plan together; it is not an automated rehabilitation prescription.</div>`;
    const draw = () => {
      $("#sequence-total").textContent =
        `${program.steps.length} movements · ${num(program.steps.reduce((sum, s) => sum + s.sets * s.seconds, 0) / 60, "min")}`;
      $("#sequence").innerHTML =
        program.steps
          .map(
            (s, i) =>
              `<div class="sequence-row" draggable="true" data-step="${i}"><span class="order">${i + 1}</span><div class="step-info"><h4>${esc(exerciseById(s.exercise_id)?.name || s.exercise_id)}</h4><small>${esc(exerciseById(s.exercise_id)?.area)}</small></div>${["sets", "reps", "seconds"].map((prop) => `<label>${prop}<input type="number" data-step-field="${i}:${prop}" min="${prop === "seconds" ? 5 : 1}" max="${prop === "seconds" ? 3600 : 100}" value="${s[prop]}"></label>`).join("")}<button data-move="${i}:-1" aria-label="Move ${esc(exerciseById(s.exercise_id)?.name)} up">↑</button><button data-move="${i}:1" aria-label="Move ${esc(exerciseById(s.exercise_id)?.name)} down">↓</button><button data-delete-step="${i}" aria-label="Remove ${esc(exerciseById(s.exercise_id)?.name)}">×</button></div>`,
          )
          .join("") ||
        empty(
          "Add the first movement",
          "Choose movements from the exercise library.",
        );
      document.querySelectorAll("[data-step-field]").forEach(
        (input) =>
          (input.onchange = () => {
            const [i, p] = input.dataset.stepField.split(":");
            if (!input.reportValidity()) return;
            program.steps[i][p] = Number(input.value);
            draw();
          }),
      );
      document.querySelectorAll("[data-move]").forEach(
        (b) =>
          (b.onclick = () => {
            const [i, delta] = b.dataset.move.split(":").map(Number);
            if (i + delta >= 0 && i + delta < program.steps.length) {
              [program.steps[i], program.steps[i + delta]] = [
                program.steps[i + delta],
                program.steps[i],
              ];
              draw();
            }
          }),
      );
      document.querySelectorAll("[data-delete-step]").forEach(
        (b) =>
          (b.onclick = () => {
            program.steps.splice(Number(b.dataset.deleteStep), 1);
            draw();
          }),
      );
      document.querySelectorAll("[data-step]").forEach((row) => {
        row.ondragstart = (e) =>
          e.dataTransfer.setData("text/plain", row.dataset.step);
        row.ondragover = (e) => e.preventDefault();
        row.ondrop = (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData("text/plain")),
            to = Number(row.dataset.step);
          if (
            Number.isInteger(from) &&
            from >= 0 &&
            from < program.steps.length
          ) {
            program.steps.splice(to, 0, program.steps.splice(from, 1)[0]);
            draw();
          }
        };
      });
    };
    $("#add-step").onclick = () => {
      const modal = $("#modal");
      modal.innerHTML = `<h2>Add a movement</h2><div class="grid cols-2">${exercises.map((e) => exerciseCard(e, true)).join("")}</div><div class="actions"><button id="close-library">Done</button></div>`;
      modal.showModal();
      $("#close-library").onclick = () => modal.close();
      document.querySelectorAll("[data-add-exercise]").forEach(
        (b) =>
          (b.onclick = () => {
            program.steps.push({
              exercise_id: b.dataset.addExercise,
              sets: 1,
              reps: 8,
              seconds: 60,
            });
            draw();
            toast("Movement added to the sequence.");
          }),
      );
    };
    $("#save-program").onclick = async () => {
      try {
        program.name = $("#program-name").value.trim();
        if (!program.name) return toast("Enter a program name.");
        program.description = $("#program-description").value;
        program.client_id = $("#program-client").value;
        await save("programs", program);
        toast("Program saved.");
      } catch (e) {
        toast(e.message);
      }
    };
    draw();
    return;
  }
  $("#app").innerHTML =
    head(
      "Programs & sequences",
      "Turn a coaching goal into a practice you can repeat and review.",
      '<button id="new-program" class="primary">+ New program</button>',
    ) +
    `<div class="grid cols-2">${
      state.programs
        .map(
          (p) =>
            `<section class="card"><div class="card-head"><h2>${esc(p.name)}</h2>${badge(p.difficulty || "Custom")}</div><p class="muted" style="font-size:12px">${esc(p.description)}</p><div class="grid cols-3 section-space">${p.steps
              .slice(0, 3)
              .map((s) => {
                const e = exerciseById(s.exercise_id);
                return `<div class="exercise-media" style="height:110px;border-radius:7px">${e?.image ? `<img src="/assets/studio/${e.image}" alt="Generated exercise illustration">` : icon("anatomy")}</div>`;
              })
              .join(
                "",
              )}</div><div class="list-row"><span>${p.steps.length} movements · ${num(p.steps.reduce((n, s) => n + s.sets * s.seconds, 0) / 60, "min")}</span>${link("Edit sequence", `programs/${p.id}`, "primary")}</div><small>${p.client_id ? "Assigned to " + esc(clientName(p.client_id)) : "Reusable program template"} · Illustration images are AI-generated</small></section>`,
        )
        .join("") ||
      empty(
        "Build your first sequence",
        "Add a program, choose exercises, then set the order and volume.",
      )
    }</div>`;
  $("#new-program").onclick = () =>
    form(
      "Create a program",
      '<label>Name<input name="name" maxlength="100" required></label><label>Description<textarea name="description" maxlength="1000"></textarea></label>',
      async (data) => {
        const p = await save("programs", {
          ...data,
          steps: [],
          difficulty: "Custom",
        });
        location.hash = `programs/${p.id}`;
      },
    );
}
function schedule() {
  const selected = today();
  $("#app").innerHTML =
    head(
      "Schedule & attendance",
      "Plan studio sessions and keep a clear attendance record.",
      '<button id="new-booking" class="primary">+ Add session</button>',
    ) +
    `<div class="filterbar"><label>Show date<input id="schedule-date" type="date" value="${selected}"></label><button id="show-upcoming">Next 7 days</button><button id="show-all">All sessions</button></div><div id="schedule-body" class="card"></div>`;
  let scope = "day";
  const draw = () => {
    const start = $("#schedule-date").value,
      end = new Date(start);
    end.setDate(end.getDate() + 7);
    const rows = state.bookings
      .filter((b) =>
        scope === "all" || scope === "week"
          ? scope === "all" ||
            (b.date >= start && b.date < end.toISOString().slice(0, 10))
          : b.date.startsWith(start),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    $("#schedule-body").innerHTML = rows.length
      ? `<div class="table-wrap"><table><thead><tr><th>Date / time</th><th>Client</th><th>Session</th><th>Coach</th><th>Attendance</th></tr></thead><tbody>${rows
          .slice(0, 250)
          .map(
            (b) =>
              `<tr><td>${date(b.date)}<br><small>${new Date(b.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} · ${b.duration} min</small></td><td>${esc(b.client_name || clientName(b.client_id))}</td><td>${esc(b.title)}</td><td>${esc(b.coach)}</td><td><select data-booking="${b.id}" aria-label="Attendance for ${esc(b.client_name)}">${["reserved", "attended", "missed", "cancelled"].map((s) => `<option ${s === b.status ? "selected" : ""}>${s}</option>`).join("")}</select></td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div><p class="subtle">Showing ${Math.min(250, rows.length)} of ${rows.length} matching sessions.</p>`
      : empty(
          "No sessions on this date",
          "Add a session or look at the next seven days.",
        );
    document.querySelectorAll("[data-booking]").forEach(
      (s) =>
        (s.onchange = async () => {
          try {
            await save("bookings", {
              ...state.bookings.find((b) => b.id === s.dataset.booking),
              status: s.value,
            });
            toast("Attendance updated.");
          } catch (e) {
            toast(e.message);
            draw();
          }
        }),
    );
  };
  $("#schedule-date").onchange = () => {
    scope = "day";
    draw();
  };
  $("#show-upcoming").onclick = () => {
    scope = "week";
    draw();
  };
  $("#show-all").onclick = () => {
    scope = "all";
    draw();
  };
  $("#new-booking").onclick = () => {
    if (!state.clients.length)
      return toast("Add a client before scheduling a session.");
    form(
      "Add a session",
      `<label>Client${chooseClient("", false).replace('id="client-filter"', 'name="client_id"')}</label><label>Session title<input name="title" value="Mat foundations" maxlength="100" required></label><div class="field-grid"><label>Date and time<input name="date" type="datetime-local" value="${today()}T10:00" required></label><label>Duration (minutes)<input name="duration" type="number" min="5" max="240" value="50" required></label></div><label>Coach<input name="coach" value="${esc(state.coach)}" maxlength="80"></label>`,
      async (data) => {
        await save("bookings", {
          ...data,
          client_name: clientName(data.client_id),
          duration: Number(data.duration),
          status: "reserved",
        });
      },
    );
  };
  draw();
}
const radiographs = [
  {
    id: "shoulder",
    name: "Shoulder · Y projection",
    src: "/assets/studio/xray-shoulder.jpg",
    author: "Mikael Häggström · CC0 1.0",
    url: "https://commons.wikimedia.org/wiki/File:Y-projection_X-ray_of_a_normal_shoulder.jpg",
  },
  {
    id: "pelvis",
    name: "Pelvis · AP view",
    src: "/assets/studio/xray-pelvis.jpg",
    author: "UC San Diego Health, Department of Radiology · Public domain",
    url: "https://commons.wikimedia.org/wiki/File:X-ray_of_the_pelvis_of_an_18_year_old_male_-_case_1_-_anteroposterior.jpg",
  },
];
async function xrays() {
  const records = state.notes.filter((n) => n.kind === "xray");
  $("#app").innerHTML =
    head(
      "X-ray records",
      "Keep externally supplied imaging and clinician notes alongside the client history.",
      '<button id="add-xray" class="primary">+ Attach image</button>',
    ) +
    `<div class="notice">X-rays are uploaded records for manual review. This application does not analyze radiographs or infer internal anatomy from photographs. Public examples below are not scans of any demo client.</div><div class="grid cols-3" id="xray-list"></div><div class="section-space">${card("Public educational examples", `<div class="grid cols-2">${radiographs.map((r) => `<div class="card xray-card"><img src="${r.src}" alt="Public educational ${esc(r.name)} radiograph"><div><h3>${r.name}</h3><p>Public sample · not a client record</p><small>${esc(r.author)}</small><div class="actions section-space"><button data-sample-xray="${r.id}">Open viewer</button><a href="${r.url}" target="_blank" rel="noopener">Source & license ↗</a></div></div></div>`).join("")}</div>`)}</div>`;
  const list = $("#xray-list");
  for (const n of records) {
    const data = await localGet(`${key}:xray:${n.id}`);
    list.insertAdjacentHTML(
      "beforeend",
      `<section class="card"><h3>${esc(n.title)}</h3><p class="subtle">${esc(clientName(n.client_id))} · ${date(n.date)}</p>${data ? `<img src="${data}" alt="Uploaded ${esc(n.title)}" style="width:100%;height:220px;object-fit:contain;background:black;margin:15px 0">` : '<p class="notice">Image is on the device where it was attached.</p>'}<p class="muted" style="font-size:12px">${esc(n.text)}</p><div class="section-space"><button data-user-xray="${esc(n.id)}">Open record</button></div></section>`,
    );
  }
  if (!records.length)
    list.innerHTML = empty(
      "No client imaging attached",
      "Attach a supplied front or lateral spine, cervical, shoulder, or pelvis image.",
    );
  const viewer = (src, title, caption) => {
    const m = $("#modal");
    m.innerHTML = `<h2>${esc(title)}</h2>${src ? `<div style="overflow:auto;max-height:65vh;background:black"><img id="xray-image" class="xray-view" src="${esc(src)}" alt="${esc(title)}"></div><label class="section-space">Display contrast<input id="xray-contrast" type="range" min="50" max="200" value="100"></label>` : empty("Image not on this device", "The record’s notes remain available.")}<p class="subtle">${esc(caption)}</p><div class="actions"><button id="close-xray">Close</button></div>`;
    m.showModal();
    $("#close-xray").onclick = () => m.close();
    if ($("#xray-contrast"))
      $("#xray-contrast").oninput = (e) =>
        ($("#xray-image").style.filter = `contrast(${e.target.value}%)`);
  };
  document.querySelectorAll("[data-sample-xray]").forEach(
    (b) =>
      (b.onclick = () => {
        const r = radiographs.find((r) => r.id === b.dataset.sampleXray);
        viewer(
          r.src,
          r.name,
          "Public educational sample. Not this client’s image. " + r.author,
        );
      }),
  );
  document.querySelectorAll("[data-user-xray]").forEach(
    (b) =>
      (b.onclick = async () => {
        const n = records.find((n) => n.id === b.dataset.userXray);
        viewer(
          await localGet(`${key}:xray:${n.id}`),
          n.title,
          n.text || "No clinician notes entered.",
        );
      }),
  );
  $("#add-xray").onclick = () => {
    if (!state.clients.length) return toast("Add a client first.");
    form(
      "Attach supplied imaging",
      `<label>Client${chooseClient("", false).replace('id="client-filter"', 'name="client_id"')}</label><label>Image category<select name="title">${["Spine · front / AP", "Spine · lateral", "Cervical spine", "Shoulder joint", "Pelvis · AP", "Other supplied imaging"].map((v) => `<option>${v}</option>`).join("")}</select></label><label>Date<input name="date" type="date" value="${today()}" required></label><label>Clinician or coach notes<textarea name="text" maxlength="3000" placeholder="Transcribe the supplied report or record a note. No automatic interpretation is performed."></textarea></label><label>Image file<input id="xray-file" type="file" accept="image/jpeg,image/png,image/webp" required></label>`,
      async (data) => {
        const file = $("#xray-file").files[0];
        if (
          file.size > 10 * 1024 * 1024 ||
          !/^image\/(jpeg|png|webp)$/.test(file.type)
        )
          throw new Error("Choose a JPG, PNG or WebP smaller than 10 MB.");
        const image = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const record = await save("notes", {
          ...data,
          kind: "xray",
          private: true,
        });
        await localPut(`${key}:xray:${record.id}`, image);
      },
    );
  };
}
function ledger(type) {
  const payment = type === "payments",
    rows = state[type];
  $("#app").innerHTML =
    head(
      payment ? "Payment records" : "Studio equipment",
      payment
        ? "A manual ledger for your studio. No payments are charged or processed here."
        : "Keep an inventory and a simple readiness record.",
      `<button id="add-ledger" class="primary">+ Add ${payment ? "record" : "equipment"}</button>`,
    ) +
    card(
      payment ? "Membership ledger" : "Equipment inventory",
      rows.length
        ? `<div class="table-wrap"><table><thead><tr>${(payment ? ["Client", "Description", "Date", "Amount", "Status"] : ["Equipment", "Quantity", "Last checked", "Status"]).map((t) => `<th>${t}</th>`).join("")}<th></th></tr></thead><tbody>${rows.map((r) => `<tr>${(payment ? [clientName(r.client_id), r.description, date(r.date), num(r.amount, r.currency || "USD"), r.status] : [r.name, r.quantity, date(r.last_check), r.status]).map((t) => `<td>${esc(t)}</td>`).join("")}<td><button data-ledger="${esc(r.id)}">Edit</button></td></tr>`).join("")}</tbody></table></div>`
        : empty("No records yet", "Add your first entry to get started."),
    ) +
    (state.demo
      ? '<div class="notice">All entries in this demo workspace are fictional. No financial transactions have occurred.</div>'
      : "");
  const edit = (r = {}) =>
    form(
      payment ? "Payment record" : "Equipment record",
      payment
        ? `<label>Client${chooseClient(r.client_id, false).replace('id="client-filter"', 'name="client_id"')}</label><label>Description<input name="description" value="${esc(r.description)}" required maxlength="200"></label><div class="field-grid"><label>Amount (USD)<input name="amount" type="number" min="0" step=".01" value="${r.amount || ""}" required></label><label>Date<input name="date" type="date" value="${r.date || today()}" required></label></div><label>Status<select name="status"><option value="paid">Paid</option><option value="pending" ${r.status === "pending" ? "selected" : ""}>Pending</option></select></label>`
        : `<label>Equipment name<input name="name" value="${esc(r.name)}" maxlength="100" required></label><div class="field-grid"><label>Quantity<input name="quantity" type="number" min="0" max="10000" value="${r.quantity || 1}" required></label><label>Last checked<input name="last_check" type="date" value="${r.last_check || today()}" required></label></div><label>Status<select name="status"><option>Ready</option><option ${r.status === "Needs check" ? "selected" : ""}>Needs check</option><option ${r.status === "Out of service" ? "selected" : ""}>Out of service</option></select></label>`,
      async (data) => {
        if (payment) {
          data.amount = Number(data.amount);
          data.currency = "USD";
        } else data.quantity = Number(data.quantity);
        await save(type, { ...r, ...data });
      },
    );
  $("#add-ledger").onclick = () => {
    if (payment && !state.clients.length) return toast("Add a client first.");
    edit();
  };
  document
    .querySelectorAll("[data-ledger]")
    .forEach(
      (b) =>
        (b.onclick = () => edit(rows.find((r) => r.id === b.dataset.ledger))),
    );
}
function settings() {
  $("#app").innerHTML =
    head(
      "Workspace settings",
      "Understand your records, export a backup, and restore a saved workspace.",
    ) +
    `<div class="grid cols-2">${card("Data & storage", `<p class="muted" style="font-size:12px">This preview opens without sign-in. A random workspace identifier keeps records separate between browsers. It is not a replacement for production account security.</p><div class="list-row"><span>Workspace</span>${badge(state.demo ? "Investor demo" : "My studio", state.demo ? "demo" : "green")}</div><div class="list-row"><span>Original photos, videos and X-rays</span><small>This browser / device</small></div><div class="list-row"><span>Reports and studio records</span><small>Server + browser copy</small></div><div class="notice">The free preview server can reset its storage. This browser keeps a local copy. Clearing browser data removes that copy. Export important records before changing devices.</div><div class="actions"><button id="backup" class="primary">Download full backup</button><label class="button">Restore backup<input id="restore" type="file" accept="application/json" hidden></label></div><p class="subtle">The backup includes original media saved on this device, reports and notes. Keep it private.</p>`)}${card("Investor demo", `<p class="muted" style="font-size:12px">The demo has 24 fictional clients, six months of synthetic posture trends, 144 assessment reports, coaching notes, programs, sessions and manual payment examples. It is stored in a database and can be edited independently of your personal workspace.</p><div class="notice">Demo records do not represent real people or prove clinical effectiveness. Sample posture and exercise photographs are generated illustrations. Public radiographs are explicitly labeled and credited.</div><p class="muted" style="font-size:12px">The detailed anatomy viewer is an educational reference. A person's estimated 3D skeleton appears in an actual report only when the model and visibility checks support it.</p><div class="section-space">${link("Open studio", "home")}${link("Explore anatomy", "anatomy")}</div>`)}</div>`;
  $("#backup").onclick = async () => {
    const btn = $("#backup");
    btn.disabled = true;
    try {
      const media = {};
      for (const r of state.reports) {
        for (const view of [...r.views.map((v) => v.view), "video"]) {
          const k = `media:${r.id}:${view}`,
            v = await localGet(`${key}:${k}`);
          if (v instanceof Blob) {
            const data = await new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(fr.result);
              fr.onerror = reject;
              fr.readAsDataURL(v);
            });
            media[k] = { blob: true, data };
          } else if (v) media[k] = v;
        }
      }
      for (const n of state.notes.filter((n) => n.kind === "xray")) {
        const v = await localGet(`${key}:xray:${n.id}`);
        if (v) media[`xray:${n.id}`] = v;
      }
      download(`motion-yoga-${mode}-${today()}.json`, {
        schema: "motion-yoga-backup-1",
        demo: state.demo,
        exported_at: new Date().toISOString(),
        state,
        media,
      });
      toast("Backup downloaded. Store it securely.");
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
    }
  };
  $("#restore").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 300 * 1024 * 1024)
        throw new Error("This backup is too large to restore in the preview.");
      const b = JSON.parse(await file.text());
      if (
        b.schema !== "motion-yoga-backup-1" ||
        b.demo !== state.demo ||
        collections.some((c) => !Array.isArray(b.state?.[c]))
      )
        throw new Error(
          "Choose a Motion Yoga backup from the same workspace type (demo or personal).",
        );
      for (const c of collections)
        for (const item of b.state[c]) {
          if (!/^[a-zA-Z0-9_-]{1,90}$/.test(item.id || ""))
            throw new Error("The backup contains an invalid record.");
        }
      for (const [k, v] of Object.entries(b.media || {})) {
        if (!/^(media|xray):[a-zA-Z0-9_-]+(?::[a-z_]+)?$/.test(k))
          throw new Error("Invalid media record.");
        if (v?.blob) {
          if (
            !/^data:video\/(webm|mp4|quicktime)(?:;codecs=[a-zA-Z0-9., _-]+)?;base64,/.test(
              v.data,
            )
          )
            throw new Error("Invalid video in backup.");
          await localPut(`${key}:${k}`, await (await fetch(v.data)).blob());
        } else if (
          typeof v === "string" &&
          /^data:image\/(jpeg|png|webp);base64,/.test(v)
        )
          await localPut(`${key}:${k}`, v);
        else throw new Error("Invalid image in backup.");
      }
      for (const c of collections)
        for (const item of b.state[c]) upsert(c, { ...item, demo: state.demo });
      await cache();
      toast(
        "Backup restored on this device. Records are available in your workspace.",
      );
      route();
    } catch (e) {
      toast(e.message);
    }
  };
}
function form(title, fields, onSave) {
  const modal = $("#modal");
  modal.onclose = null;
  modal.innerHTML = `<form id="record-form"><h2>${esc(title)}</h2>${fields}<div id="form-error" role="alert"></div><div class="actions"><button type="button" id="cancel-form">Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
  modal.showModal();
  $("#cancel-form").onclick = () => modal.close();
  $("#record-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = modal.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await onSave(Object.fromEntries(new FormData(e.target)));
      modal.close();
      toast("Saved.");
      route();
    } catch (e) {
      $("#form-error").innerHTML =
        `<div class="notice error">${esc(e.message)}</div>`;
      btn.disabled = false;
    }
  };
}
async function route() {
  const version = ++routeVersion;
  try {
    let [page, arg] = location.hash.slice(1).split("/");
    page = page || "home";
    if (page === "capture" && mode !== "live") {
      mode = "live";
      localStorage.setItem("motion-yoga-mode", mode);
      await load();
    }
    if (!state) await load();
    if (version !== routeVersion) return;
    shell(page);
    document.body.classList.remove("menu-open");
    if (page === "home") overview();
    else if (page === "clients") clients(arg);
    else if (page === "reports") reports();
    else if (page === "report") {
      const r = state.reports.find((r) => r.id === arg);
      if (r) await renderReport(r, ctx());
      else
        $("#app").innerHTML = empty(
          "Report not in this workspace",
          "Switch workspaces or restore the backup that contains this report.",
          link("All reports", "reports"),
        );
    } else if (page === "capture")
      await capture(ctx(), arg === "movement" ? "movement" : "photo");
    else if (page === "compare") await compare(arg);
    else if (page === "timeline" || page === "notes")
      timeline(arg, page === "notes");
    else if (page === "programs") programs(arg);
    else if (page === "library") library();
    else if (page === "schedule") schedule();
    else if (page === "xray") await xrays();
    else if (page === "payments" || page === "equipment") ledger(page);
    else if (page === "settings") settings();
    else if (page === "anatomy")
      $("#app").innerHTML =
        head(
          "Explore the body in 3D",
          "Reference anatomy · muscles, bones, nerves, joints and movement.",
          `<a class="button" href="/anatomy.html">Full-screen viewer ↗</a>`,
        ) +
        `<iframe class="anatomy-frame" src="/anatomy.html?studio=1" title="Interactive reference anatomy" allow="fullscreen"></iframe><p class="subtle">General anatomy model. Actual uploaded poses are shown separately in their assessment reports.</p>`;
    else overview();
    window.scrollTo(0, 0);
  } catch (e) {
    $("#app").innerHTML = empty(
      "The studio could not open",
      e.message,
      '<button id="retry-open" class="primary">Try again</button>',
    );
    $("#retry-open").onclick = () => route();
  }
}
window.addEventListener("hashchange", route);
window.addEventListener("unhandledrejection", (e) =>
  toast(e.reason?.message || "Something went wrong. Please retry."),
);
await route();
