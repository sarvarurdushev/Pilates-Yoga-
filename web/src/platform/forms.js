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
  field,
  area,
  select,
  options,
  modal,
  toast,
  regions,
  regionName,
  relatedRegion,
  head,
  card,
  notice,
  table,
  mediaURL,
  safeURL,
  upload,
  bindButtons,
  dt,
  exerciseIllustration,
} from "./core.js";
const asObject = (f) => Object.fromEntries(f);
const checks = (title, name, rows, selected = []) =>
  `<fieldset><legend>${esc(title)}</legend>${rows.map((r) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(r.id)}" ${selected.includes(r.id) ? "checked" : ""}>${esc(r.name)}</label>`).join("")}</fieldset>`;
function removeButton(kind, id) {
  return id
    ? `<button class="danger" type="button" data-remove="${kind}" data-id="${id}">Remove ${kind === "users" ? "account" : "record"}</button>`
    : "";
}
export async function edit(kind, id, copy = false) {
  if (kind === "programs") return programEditor(id, copy);
  if (kind === "exercises") return exerciseEditor(id, copy);
  const me = state.me;
  let item = {};
  if (id)
    item =
      kind === "student" || kind === "coach"
        ? [...me.students, ...me.coaches].find((p) => p.id === id) || {}
        : await record(kind, id);
  let html = "",
    save;
  if (kind === "student" || kind === "coach") {
    const role = item.roles || [kind];
    html =
      field("Name", "name", item.name, "text", "required") +
      field("Email", "email", item.email, "email") +
      field(
        "Set password · optional for an existing account",
        "password",
        "",
        "password",
        'minlength="10" autocomplete="new-password"',
      ) +
      field("Date of birth", "born", item.born, "date") +
      area("Personal goal", "goal", item.goal) +
      checks("Locations", "location_ids", me.locations, item.location_ids) +
      (me.role === "admin"
        ? checks("Assigned coaches", "coach_ids", me.coaches, item.coach_ids) +
          checks(
            "Account roles",
            "roles",
            ["student", "coach", "admin"].map((r) => ({ id: r, name: r })),
            role,
          )
        : "") +
      removeButton("users", id);
    save = async (f) => {
      const body = {
        ...item,
        ...asObject(f),
        ...(id ? { id } : {}),
        roles: me.role === "admin" ? f.getAll("roles") : ["student"],
        location_ids: f.getAll("location_ids"),
        coach_ids: f.getAll("coach_ids"),
      };
      delete body.password_hash;
      await api("people/save", body);
    };
  } else if (kind === "locations") {
    html =
      field("Name", "name", item.name, "text", "required") +
      field("Address", "address", item.address) +
      field(
        "Capacity",
        "capacity",
        item.capacity || 12,
        "number",
        'min="1" required',
      ) +
      `<h3>Rooms</h3><div id="room-rows"></div><button type="button" id="add-room">+ Room</button>` +
      removeButton(kind, id);
    const rooms = structuredClone(item.rooms || []);
    save = async (f, form) => {
      const rows = [...form.querySelectorAll(".room-row")].map((el, i) => ({
        id: rooms[i]?.id,
        name: el.querySelector("[data-room-name]").value,
        capacity: Number(el.querySelector("[data-room-capacity]").value),
      }));
      await api("save", {
        collection: kind,
        item: {
          ...asObject(f),
          id,
          capacity: Number(f.get("capacity")),
          rooms: rows,
        },
      });
    };
    const d = modal(id ? "Edit location" : "New location", html, save);
    const add = (r) => {
      const wrap = document.createElement("div");
      wrap.className = "room-row";
      wrap.innerHTML = `<input aria-label="Room name" data-room-name value="${esc(r.name || "")}" required><input aria-label="Room capacity" data-room-capacity type="number" min="1" value="${r.capacity || 8}">`;
      d.querySelector("#room-rows").append(wrap);
    };
    rooms.forEach(add);
    d.querySelector("#add-room").onclick = () => {
      rooms.push({});
      add({});
    };
    wireRemove(d, kind, id);
    return;
  } else if (kind === "equipment") {
    html =
      field("Equipment name", "name", item.name, "text", "required") +
      select("Location", "location_id", me.locations, item.location_id) +
      field(
        "Total quantity",
        "quantity",
        item.quantity ?? 1,
        "number",
        'min="0" required',
      ) +
      field(
        "Available for reservations",
        "available",
        item.available ?? 1,
        "number",
        'min="0" required',
      ) +
      removeButton(kind, id);
    save = async (f) =>
      api("save", {
        collection: kind,
        item: {
          ...asObject(f),
          id,
          quantity: Number(f.get("quantity")),
          available: Number(f.get("available")),
        },
      });
  } else if (kind === "reservations") {
    const programs = (await list("programs")).items;
    const sid = item.student_id || state.client?.id;
    html =
      select("Client", "student_id", me.students, sid) +
      select(
        "Coach",
        "coach_id",
        me.coaches,
        item.coach_id || state.client?.coach_ids?.[0] || me.user.id,
      ) +
      select(
        "Location",
        "location_id",
        me.locations,
        item.location_id || state.client?.location_ids?.[0],
      ) +
      select("Room", "room_id", [], item.room_id, "Location capacity only") +
      select(
        "Program",
        "program_id",
        programs,
        item.program_id || state.client?.programs?.[0]?.program_id,
        "No program",
      ) +
      field(
        "Start",
        "starts_at",
        localDate(item.starts_at),
        "datetime-local",
        "required",
      ) +
      field(
        "End",
        "ends_at",
        localDate(item.ends_at),
        "datetime-local",
        "required",
      ) +
      field(
        "Session type",
        "session_type",
        item.session_type || "Individual Pilates",
      ) +
      select(
        "Status",
        "status",
        ["reserved", "attended", "missed", "cancelled"].map((v) => [v, v]),
        item.status || "reserved",
        null,
      ) +
      removeButton(kind, id);
    save = async (f) =>
      api("save", {
        collection: kind,
        item: {
          ...asObject(f),
          id,
          starts_at: new Date(f.get("starts_at")).toISOString(),
          ends_at: new Date(f.get("ends_at")).toISOString(),
        },
      });
    const d = modal(id ? "Edit reservation" : "New reservation", html, save);
    const setRooms = async () => {
      const loc = d.querySelector("[name=location_id]").value;
      const l = loc ? await record("locations", loc) : {};
      d.querySelector("[name=room_id]").innerHTML = options(
        l.rooms || [],
        item.room_id,
        "Location capacity only",
      );
    };
    d.querySelector("[name=location_id]").onchange = setRooms;
    await setRooms();
    wireRemove(d, kind, id);
    return;
  } else if (kind === "notes") {
    if (!state.client)
      throw Error("Select a client before adding a coaching note.");
    const c = state.client;
    const programs = (await list("programs")).items;
    html =
      select(
        "Anatomical region",
        "region_id",
        regions(),
        item.region_id || params().get("region"),
      ) +
      select(
        "Analysis session",
        "analysis_id",
        c.analyses.map((a) => ({
          id: a.id,
          name: dt(a.created_at) + " · " + a.kind,
        })),
        item.analysis_id || params().get("id"),
        "General client note",
      ) +
      select(
        "Related scan",
        "scan_id",
        c.scans,
        item.scan_id || params().get("scan"),
        "No scan",
      ) +
      select(
        "Related program",
        "program_id",
        programs,
        item.program_id || c.programs[0]?.program_id,
        "No program",
      ) +
      area("Coach note", "text", item.text) +
      select(
        "Visibility",
        "visibility",
        [
          ["student", "Coach and student"],
          ["coach", "Coaches only"],
        ],
        item.visibility || "student",
        null,
      ) +
      removeButton(kind, id);
    save = async (f) =>
      api("save", {
        collection: kind,
        item: { ...asObject(f), id, student_id: c.id },
      });
  } else throw Error("Choose a supported record type.");
  const d = modal(id ? "Edit " + kind : "New " + kind, html, save);
  wireRemove(d, kind, id);
}
function localDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function wireRemove(d, kind, id) {
  const b = d.querySelector("[data-remove]");
  if (b)
    b.onclick = () => {
      modal(
        "Confirm removal",
        notice(
          "Remove this record and its dependent links? This cannot be undone from this page.",
        ),
        async () =>
          api("delete", {
            collection: kind === "student" || kind === "coach" ? "users" : kind,
            id,
          }),
      );
    };
}
async function exerciseEditor(id, copy) {
  const source = id ? await record("exercises", id) : {};
  if (copy) id = null;
  const e = source.detail || {};
  const equipment = (await list("equipment")).items;
  const html =
    field(
      "Exercise name",
      "name",
      (copy ? "Copy of " : "") + (source.name || ""),
      "text",
      "required",
    ) +
    `<div class="grid two">${select(
      "Category",
      "category",
      [
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
      ].map((x) => [x, x]),
      source.category || "Pilates",
      null,
    )}${select(
      "Difficulty",
      "difficulty",
      ["Foundation", "Intermediate", "Advanced"].map((x) => [x, x]),
      source.difficulty || "Foundation",
      null,
    )}${select("Body region", "region_id", regions(), source.region_id || params().get("region"))}${select(
      "Sharing",
      "visibility",
      [
        ["private", "My content and assigned clients"],
        ["organization", "Organization library"],
      ],
      source.visibility || "private",
      null,
    )}</div>` +
    area("Description", "description", e.description) +
    area("Instructions", "instructions", e.instructions) +
    field("Movement pattern", "pattern", e.pattern) +
    field("Target joints", "joints", e.joints) +
    field("Target muscles · educational", "muscles", e.muscles) +
    area("Breathing instructions", "breathing", e.breathing) +
    area("Coaching cues", "cues", e.cues) +
    area("Common mistakes", "mistakes", e.mistakes) +
    area("Safety notes", "safety", e.safety) +
    area("Coach content notes", "notes", e.notes) +
    field(
      "Default duration · seconds",
      "duration",
      e.duration || 60,
      "number",
      'min="0"',
    ) +
    checks(
      "Required equipment",
      "equipment",
      equipment.map((x) => ({
        id: x.id,
        name:
          x.name +
          " · " +
          state.me.locations.find((l) => l.id === x.location_id)?.name,
      })),
      source.equipment
        ?.map(
          (x) =>
            equipment.find((e) => e.id === x.equipment_id)?.id ||
            equipment.find((e) => e.name === x.name)?.id,
        )
        .filter(Boolean),
    ) +
    `<h3>Exercise media</h3><label>Upload images or videos<input name="files" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple></label><div>${(source.media || []).map((m) => `<span>${esc(m.filename)} <button type="button" data-media-remove="${m.id}">Remove</button></span>`).join("")}</div><h3>Optional resources</h3><p class="muted">Leave empty for no resources. Add only sources you choose.</p><div id="resource-rows"></div><button type="button" id="resource-add">+ Add resource</button><p id="media-status" role="status"></p>` +
    removeButton("exercises", id);
  const removed = [];
  const uploaded = new Set();
  const isNew = !id;
  const d = modal(
    copy ? "Duplicate exercise" : id ? "Edit exercise" : "Create exercise",
    html,
    async (f, form) => {
      const values = asObject(f);
      const detail = { ...e };
      for (const key of [
        "description",
        "instructions",
        "pattern",
        "joints",
        "muscles",
        "breathing",
        "cues",
        "mistakes",
        "safety",
        "notes",
      ])
        detail[key] = values[key];
      detail.duration = Number(values.duration);
      const resources = [...form.querySelectorAll(".resource-row")].map(
        (el) => ({
          title: el.querySelector("[data-title]").value,
          url: el.querySelector("[data-url]").value,
        }),
      );
      const saved = await api("save", {
        collection: "exercises",
        item: {
          id,
          name: values.name,
          category: values.category,
          difficulty: values.difficulty,
          region_id: values.region_id,
          visibility: values.visibility,
          detail,
          resources,
          equipment: f
            .getAll("equipment")
            .map((equipment_id) => ({ equipment_id, quantity: 1 })),
        },
      });
      id = saved.id; // Retry failed media uploads against the saved exercise.
      if (copy)
        await api("copy-exercise-media", {
          exercise_id: saved.id,
          media_ids: (source.media || [])
            .filter((m) => !removed.includes(m.id))
            .map((m) => m.id),
        });
      else
        for (const mid of removed)
          await api("delete", { collection: "media", id: mid });
      for (const file of form.querySelector("[name=files]").files) {
        if (uploaded.has(file)) continue;
        form.querySelector("#media-status").textContent =
          "Uploading " + file.name;
        await upload(
          file,
          { kind: "exercise", exercise_id: saved.id },
          (n) =>
            (form.querySelector("#media-status").textContent =
              `Uploading ${file.name} · ${n}%`),
        );
        uploaded.add(file);
      }
      if (isNew) go("exercise", { id: saved.id });
    },
  );
  const add = (r = {}) => {
    const el = document.createElement("div");
    el.className = "resource-row";
    el.innerHTML = `<input data-title aria-label="Resource title" placeholder="Title" value="${esc(r.title || "")}"><input data-url aria-label="Resource URL" type="url" placeholder="https://…" value="${esc(r.url || "")}" required><button type="button">Remove</button>`;
    el.querySelector("button").onclick = () => el.remove();
    d.querySelector("#resource-rows").append(el);
  };
  (source.resources || []).forEach(add);
  d.querySelector("#resource-add").onclick = () => add();
  d.querySelectorAll("[data-media-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        removed.push(b.dataset.mediaRemove);
        b.parentElement.remove();
      }),
  );
  wireRemove(d, "exercises", id);
}
async function programEditor(id, copy) {
  const source = id ? await record("programs", id) : {};
  if (copy) id = null;
  const first = await list("exercises", { limit: 50 });
  const ex = first.items;
  for (const step of source.steps || []) {
    if (!ex.some((e) => e.id === step.exercise_id))
      ex.push(await record("exercises", step.exercise_id));
  }
  const detail = source.detail || {};
  let steps = structuredClone(source.steps || []);
  const html =
    field(
      "Program name",
      "name",
      (copy ? "Copy of " : "") + (source.name || ""),
      "text",
      "required",
    ) +
    area("Description", "description", detail.description) +
    area("Goal", "goal", source.goal) +
    `<div class="grid two">${select(
      "Difficulty",
      "difficulty",
      ["Foundation", "Intermediate", "Advanced"].map((x) => [x, x]),
      detail.difficulty || "Foundation",
      null,
    )}${field("Frequency", "frequency", detail.frequency || "Twice weekly")}${select("Target region", "region_id", regions(), source.region_id || params().get("region"))}${select("Location", "location_id", state.me.locations, source.location_id || state.client?.location_ids?.[0], "Any assigned location")}</div>` +
    field("Movement focus", "movement_focus", detail.movement_focus) +
    `<h3>Exercise sequence</h3><p class="muted">Add movements, then drag steps or use the arrow controls.</p><div class="filter-row">${field("Find an exercise", "exercise_search")}${select("Exercise to add", "exercise_id", ex, "", "Choose an exercise")}<button type="button" id="step-add">+ Add movement</button></div><div id="program-steps"></div>` +
    removeButton("programs", id);
  const d = modal(
    copy ? "Duplicate program" : id ? "Edit program" : "New program",
    html,
    async (f) => {
      readSteps();
      const values = asObject(f);
      const saved = await api("save", {
        collection: "programs",
        item: {
          id,
          name: values.name,
          goal: values.goal,
          region_id: values.region_id,
          location_id: values.location_id,
          detail: {
            ...detail,
            source_analysis_id:
              detail.source_analysis_id ||
              (state.client?.analyses.some((a) => a.id === params().get("id"))
                ? params().get("id")
                : null),
            source_student_id:
              detail.source_student_id || state.client?.id || null,
            description: values.description,
            difficulty: values.difficulty,
            frequency: values.frequency,
            movement_focus: values.movement_focus,
            duration: Math.round(
              steps.reduce((n, s) => n + s.sets * (s.seconds + s.rest), 0) / 60,
            ),
          },
          steps,
        },
      });
      go("program", { id: saved.id });
    },
  );
  function readSteps() {
    d.querySelectorAll(".program-step").forEach((el, i) => {
      for (const key of ["sets", "reps", "seconds", "rest"])
        steps[i][key] = Number(el.querySelector(`[name=${key}]`).value);
      steps[i].notes = el.querySelector("[name=notes]").value;
      steps[i].phase = el.querySelector("[name=phase]").value;
    });
  }
  let dragged = null;
  function draw() {
    d.querySelector("#program-steps").innerHTML = steps
      .map(
        (s, i) =>
          `<div class="program-step" draggable="true" data-index="${i}"><div class="page-head"><h3>${i + 1}. ${esc(ex.find((e) => e.id === s.exercise_id)?.name || "Exercise")}</h3><div><button type="button" data-move="${i},-1" aria-label="Move step ${i + 1} up">↑</button><button type="button" data-move="${i},1" aria-label="Move step ${i + 1} down">↓</button><button type="button" data-duplicate="${i}">Duplicate</button><button type="button" data-step-delete="${i}">Remove</button></div></div><div class="grid five">${select(
            "Phase",
            "phase",
            ["Warm-up", "Practice", "Cooldown"].map((v) => [v, v]),
            s.phase || "Practice",
            null,
          )}${field("Sets", "sets", s.sets || 1, "number", 'min="1"')}${field("Reps", "reps", s.reps ?? 8, "number", 'min="0"')}${field("Duration (s)", "seconds", s.seconds ?? 60, "number", 'min="0"')}${field("Rest (s)", "rest", s.rest ?? 20, "number", 'min="0"')}</div>${area("Step coaching note", "notes", s.notes)}</div>`,
      )
      .join("");
    d.querySelectorAll("[data-move]").forEach(
      (b) =>
        (b.onclick = () => {
          readSteps();
          const [i, delta] = b.dataset.move.split(",").map(Number),
            j = i + delta;
          if (j >= 0 && j < steps.length)
            [steps[i], steps[j]] = [steps[j], steps[i]];
          draw();
        }),
    );
    d.querySelectorAll("[data-duplicate]").forEach(
      (b) =>
        (b.onclick = () => {
          readSteps();
          steps.splice(
            +b.dataset.duplicate + 1,
            0,
            structuredClone(steps[+b.dataset.duplicate]),
          );
          draw();
        }),
    );
    d.querySelectorAll("[data-step-delete]").forEach(
      (b) =>
        (b.onclick = () => {
          readSteps();
          steps.splice(+b.dataset.stepDelete, 1);
          draw();
        }),
    );
    d.querySelectorAll(".program-step").forEach((el) => {
      el.ondragstart = () => {
        readSteps();
        dragged = +el.dataset.index;
      };
      el.ondragover = (e) => e.preventDefault();
      el.ondrop = (e) => {
        e.preventDefault();
        if (dragged !== null) {
          const step = steps.splice(dragged, 1)[0];
          steps.splice(+el.dataset.index, 0, step);
          draw();
        }
      };
    });
  }
  d.querySelector("#step-add").onclick = () => {
    readSteps();
    const eid = d.querySelector("[name=exercise_id]").value;
    if (eid) {
      steps.push({
        exercise_id: eid,
        sets: 1,
        reps: 8,
        seconds: 60,
        rest: 20,
        phase: steps.length ? "Practice" : "Warm-up",
      });
      draw();
    }
  };
  let searchVersion = 0,
    searchTimer;
  d.querySelector("[name=exercise_search]").placeholder =
    "Search all exercises; refine to show up to 50 matches";
  d.querySelector("[name=exercise_search]").oninput = (e) => {
    const q = e.target.value,
      version = ++searchVersion;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const result = await list("exercises", { q, limit: 50 });
        if (version !== searchVersion || !d.isConnected) return;
        for (const item of result.items)
          if (!ex.some((x) => x.id === item.id)) ex.push(item);
        d.querySelector("[name=exercise_id]").innerHTML = options(
          result.items,
          "",
          `${result.total} matches · choose a movement`,
        );
      } catch (error) {
        toast(error.message);
      }
    }, 200);
  };
  draw();
  wireRemove(d, "programs", id);
}
export async function detailPage(root, kind, id) {
  const collection = kind === "program" ? "programs" : "exercises";
  const item = await record(collection, id);
  const d = item.detail || {};
  const canEdit =
    state.me.role === "admin" ||
    (state.me.role === "coach" && item.owner_id === state.me.user.id);
  const actions =
    state.me.role === "student"
      ? ""
      : `${canEdit ? `<button id="edit-content">Edit ${kind}</button>` : ""}<button id="copy-content">Duplicate</button>${kind === "program" ? '<button class="primary" id="assign-program">Assign to client</button>' : ""}`;
  root.innerHTML = head(
    item.name,
    kind === "program" ? item.goal : d.description,
    actions,
  );
  if (kind === "exercise") {
    root.innerHTML += `<div class="grid two">${card("Practice instructions", `<p>${esc(d.instructions)}</p><h3>Breathing</h3><p>${esc(d.breathing || "Breathe comfortably throughout.")}</p><h3>Coaching cues</h3><p>${esc(d.cues || "Coach guidance has not been added.")}</p><h3>Common mistakes</h3><p class="preserve">${esc(d.mistakes)}</p><h3>Safety</h3><p>${esc(d.safety)}</p>`)}${card("Movement & anatomy", `<p>${esc(d.pattern)}</p><p>Target region: <a href="${href("client", { tab: "anatomy", region: item.region_id })}">${esc(regionName(item.region_id))}</a></p><p>Muscles: ${esc(d.muscles || "Coach to specify")}</p><p>Joints: ${esc(d.joints || regionName(item.region_id))}</p>${d.atlas_exercise ? `<a class="button primary" href="${href("anatomy", { exercise: d.atlas_exercise, region: item.region_id })}">Open 3D movement demonstration</a>` : ""}<small>Educational anatomy. Muscle involvement is not measured from client images.</small>`)}${card("Exercise media", (item.media || []).map((m) => (m.mime.startsWith("video/") ? `<video controls src="${mediaURL(m.id)}"></video>` : `<img class="exercise-image" src="${mediaURL(m.id)}" alt="${esc(item.name)}">`)).join("") || exerciseIllustration(item) || notice("Use the 3D demonstration for this authored movement. The coach can add a photograph or video."))}${card("Optional resources", (item.resources || []).map((r) => `<a class="record-link" target="_blank" rel="noopener" href="${esc(safeURL(r.url))}">${esc(r.title)} ↗</a>`).join("") || "<p>No resources attached.</p>")}</div>`;
    if (d.notes)
      root.innerHTML += card(
        "Coach content notes",
        `<p class="preserve">${esc(d.notes)}</p>`,
      );
    if (state.client) {
      const notes = state.client.notes.filter((n) =>
        relatedRegion(n.region_id, item.region_id),
      );
      root.innerHTML += card(
        "Client coaching notes",
        notes
          .map(
            (n) =>
              `<p>${esc(n.text)} <a href="${href("client", { tab: "anatomy", region: n.region_id, id: n.analysis_id })}">Open linked anatomy →</a></p>`,
          )
          .join("") || "<p>No client note for this region yet.</p>",
      );
    }
  } else {
    const exercises = await Promise.all(
      item.steps.map((s) => record("exercises", s.exercise_id)),
    );
    root.innerHTML +=
      `<div class="stats"><div class="panel"><small>Frequency</small><h3>${esc(d.frequency || "Coach to set")}</h3></div><div class="panel"><small>Practice time</small><h3>${esc(Math.round(item.steps.reduce((n, s) => n + s.sets * (s.seconds + s.rest), 0) / 60))} min</h3></div><div class="panel"><small>Target</small><h3>${esc(regionName(item.region_id))}</h3></div></div>` +
      item.steps
        .map((s, i) =>
          card(
            `${i + 1} · ${s.phase} · ${exercises[i].name}`,
            `<div class="step-detail">${exerciseIllustration(exercises[i])}<div><p>${esc(exercises[i].detail.instructions)}</p><p><strong>${s.sets} sets · ${s.reps} repetitions · ${s.seconds}s · Rest ${s.rest}s</strong></p><p class="muted">${esc(s.notes)}</p><a class="button" href="${href("exercise", { id: s.exercise_id })}">Instructions & media</a></div>${state.me.role === "student" ? `<label class="check"><input class="completed-step" type="checkbox" value="${s.exercise_id}">Completed</label>` : ""}</div>`,
          ),
        )
        .join("");
    if (state.client)
      root.innerHTML += card(
        "Linked coach feedback",
        state.client.notes
          .filter((n) => n.program_id === id || n.region_id === item.region_id)
          .map(
            (n) =>
              `<p class="note"><a href="${href("client", { tab: "anatomy", region: n.region_id, id: n.analysis_id })}">${esc(regionName(n.region_id))}</a> · ${esc(n.text)}</p>`,
          )
          .join("") || "No linked notes yet.",
      );
    if (state.me.role === "student")
      root.innerHTML +=
        '<button id="complete-session" class="primary">Save completed practice</button>';
  }
  if ($("#edit-content"))
    $("#edit-content").onclick = () => edit(collection, id);
  if ($("#copy-content"))
    $("#copy-content").onclick = () => edit(collection, id, true);
  if ($("#assign-program"))
    $("#assign-program").onclick = () =>
      modal(
        "Assign program",
        select("Client", "student_id", state.me.students, state.client?.id) +
          area("Assignment notes", "notes") +
          notice(
            "This replaces the active program while retaining past assignments and sessions.",
          ),
        async (f) =>
          api("assign", {
            ...asObject(f),
            program_id: id,
            analysis_id:
              item.detail.source_student_id === asObject(f).student_id
                ? item.detail.source_analysis_id
                : state.me.students.find((c) => c.id === asObject(f).student_id)
                    ?.latest_analysis?.id || null,
          }),
      );
  if ($("#complete-session"))
    $("#complete-session").onclick = async () => {
      try {
        await api("complete-session", {
          student_id: state.me.user.id,
          program_id: id,
          completed: [...root.querySelectorAll(".completed-step:checked")].map(
            (e) => e.value,
          ),
        });
        toast("Practice saved to your history");
        go("client", { tab: "sessions" });
      } catch (e) {
        toast(e.message);
      }
    };
}
