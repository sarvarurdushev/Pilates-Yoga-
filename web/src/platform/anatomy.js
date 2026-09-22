import {
  $,
  state,
  api,
  record,
  list,
  clientName,
  params,
  href,
  go,
  esc,
  select,
  options,
  field,
  area,
  modal,
  upload,
  head,
  card,
  notice,
  table,
  mediaURL,
  regionName,
  regions,
  bindButtons,
  toast,
  dt,
  relatedRegion,
  safeURL,
} from "./core.js";
function choose(root) {
  root.innerHTML =
    head(
      "Choose a client",
      "Select a client to explore their body regions, scan records and coach notes.",
    ) +
    `<div class="client-grid">${state.me.students.map((c) => `<a class="client-card" href="${href("client", { client: c.id, tab: "anatomy" })}">${esc(c.name)} →</a>`).join("")}</div>`;
}
function linkedNotes(notes) {
  return (
    notes
      .map(
        (n) =>
          `<article class="note"><p>${esc(n.text)}</p><small>${dt(n.created_at)}</small>${n.analysis_id ? ` · <a href="${href("report", { id: n.analysis_id })}">Analysis</a>` : ""}${n.program_id ? ` · <a href="${href("program", { id: n.program_id })}">Program</a>` : ""}</article>`,
      )
      .join("") || '<p class="muted">No region notes yet.</p>'
  );
}
export async function anatomy(root) {
  if (!state.client) return choose(root);
  const c = state.client;
  let region =
    regions().find((r) => r.id === params().get("region")) ||
    regions().find((r) => r.id === c.programs[0]?.region_id) ||
    regions().find((r) => r.id === c.notes[0]?.region_id) ||
    regions().find((r) => r.id === c.observations[0]?.region_id) ||
    regions()[0];
  const aid = params().get("id") || c.latest_analysis?.id;
  const ex = params().get("exercise");
  const query = new URLSearchParams({
    platform: "1",
    client: c.id,
    region: region.id,
    ...(aid ? { analysis: aid } : {}),
    ...(ex ? { exercise: ex } : {}),
  });
  root.innerHTML =
    head(
      "Anatomy in context",
      c.name + " · " + region.name,
      `<a class="button" href="/anatomy.html?${query}" target="_blank" rel="noopener">Full-screen anatomy ↗</a>`,
    ) +
    `<div class="filter-row">${select("Body region", "body-region", regions(), region.id, null)}${select(
      "Anatomy view",
      "anatomy-layer",
      [
        ["region", "Relevant region"],
        ["bones_full", "Skeleton"],
        ["muscles_full", "Muscles"],
        ["connective", "Connective structures"],
        ["nervous", "Nerves"],
        ["whole", "Whole body"],
      ],
      "region",
      null,
    )}<button id="anatomy-refocus">Focus region</button></div><div class="anatomy-workspace"><div><div id="anatomy-status" role="status" class="notice">Loading the existing anatomy viewer…</div><iframe class="anatomy-frame" id="atlas" title="${esc(c.name)} · ${esc(region.name)} anatomy" src="/anatomy.html?${query}"></iframe></div><aside class="anatomy-context"><section class="panel"><div class="eyebrow">${esc(c.name)} / ${esc(region.side)}</div><h2>${esc(region.name)}</h2><p>${esc(region.explanation)}</p><h3>Mapped structures</h3><ul>${region.structures.map((s) => `<li><button class="text-button" data-structure="${s.id}">${esc(s.name)}</button></li>`).join("")}</ul>${notice("The atlas is an educational reference. It is not a reconstruction of this client’s internal anatomy.")}</section>${card(
      "Linked observations",
      c.observations
        .filter(
          (o) =>
            relatedRegion(o.region_id, region.id) &&
            (!aid || o.analysis_id === aid),
        )
        .map(
          (o) =>
            `<p><a href="${href("report", { id: o.analysis_id })}">${esc(o.text)}</a><small>${esc(o.source)} · ${dt(o.created_at)}</small></p>`,
        )
        .join("") ||
        "<p>No measured observation for this region in the selected session.</p>",
    )}${card("Coach notes", linkedNotes(c.notes.filter((n) => relatedRegion(n.region_id, region.id))) + (state.me.role !== "student" ? '<button data-edit="notes">+ Region note</button>' : ""))}${card(
      "Linked scans",
      c.scans
        .filter(
          (s) => relatedRegion(s.region_id, region.id) || s.analysis_id === aid,
        )
        .map(
          (s) =>
            `<a class="record-link" href="${href("client", { tab: "scans", scan: s.id, region: region.id, id: aid })}">${esc(s.name)} →</a>`,
        )
        .join("") || "<p>No scan linked to this region.</p>",
    )}${card("Analysis → program", `${aid ? `<a class="record-link" href="${href("report", { id: aid })}">Return to source analysis →</a>` : ""}${c.programs.map((p) => `<a class="record-link" href="${href("program", { id: p.program_id })}">${esc(p.name)} →</a>`).join("")}`)}</aside></div>`;
  const frame = $("#atlas");
  const send = (data = {}) =>
    frame.contentWindow?.postMessage(
      {
        type: "motion-context",
        client: { id: c.id, name: c.name },
        region,
        analysis_id: aid,
        notes: c.notes
          .filter((n) => relatedRegion(n.region_id, region.id))
          .map((n) => n.text),
        exercise: ex,
        ...data,
      },
      location.origin,
    );
  const listener = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow)
      return;
    if (e.data?.type === "motion-atlas-ready") send();
    if (e.data?.type === "motion-atlas-context")
      $("#anatomy-status").textContent =
        "Connected to " + c.name + " · " + region.name;
    if (e.data?.type === "motion-atlas-error")
      $("#anatomy-status").textContent = e.data.message;
  };
  window.addEventListener("message", listener);
  state.dispose.push(() => window.removeEventListener("message", listener));
  $("#anatomy-refocus").onclick = () => send();
  root.querySelector("[name=body-region]").onchange = (e) =>
    go("client", { tab: "anatomy", region: e.target.value, id: aid });
  root.querySelector("[name=anatomy-layer]").onchange = (e) =>
    send({ layer: e.target.value });
  root
    .querySelectorAll("[data-structure]")
    .forEach(
      (b) => (b.onclick = () => send({ structure_id: +b.dataset.structure })),
    );
  bindButtons(root);
}
export async function scans(root) {
  if (!state.client) {
    const { pagedRecords } = await import("./paging.js");
    return pagedRecords(root, {
      collection: "scans",
      title: head(
        "Client scans",
        "Choose a linked record to open its client, imaging and coaching notes.",
      ),
      searchLabel: "Search scan name",
      renderRows: (rows) =>
        table(
          ["Client", "Scan", "Region", "Captured"],
          rows.map((s) => [
            esc(clientName(s.student_id)),
            `<a href="${href("client", { client: s.student_id, tab: "scans", scan: s.id, region: s.region_id, id: s.analysis_id })}">${esc(s.name)}</a>`,
            esc(regionName(s.region_id)),
            esc(s.captured_at),
          ]),
        ),
    });
  }
  const c = state.client;
  root.innerHTML =
    head(
      "Scans & imaging records",
      "Upload, view and annotate educational imaging within " +
        c.name +
        "’s record.",
      state.me.role === "student"
        ? ""
        : '<button id="scan-upload" class="primary">+ Upload scan / X-ray</button>',
    ) +
    notice(
      "Medical images are displayed for educational review and manual coaching notes. No diagnostic or segmentation model is run on these records.",
    ) +
    `<div class="scan-layout"><aside id="scan-list">${c.scans.map((s) => `<a class="record-link ${params().get("scan") === s.id ? "active" : ""}" href="${href("client", { tab: "scans", scan: s.id, region: s.region_id, id: s.analysis_id })}"><strong>${esc(s.name)}</strong><small>${esc(s.scan_type)} · ${esc(regionName(s.region_id))}</small></a>`).join("") || "<p>No scans saved yet.</p>"}</aside><div id="scan-detail"></div></div>`;
  if ($("#scan-upload")) $("#scan-upload").onclick = () => scanUpload();
  const sid = params().get("scan") || c.scans[0]?.id;
  if (!sid) {
    $("#scan-detail").innerHTML = notice(
      "Add a supplied image or DICOM file to begin.",
    );
    return;
  }
  const scan = await record("scans", sid);
  if (scan.student_id !== c.id) {
    go("client", {
      client: scan.student_id,
      tab: "scans",
      scan: scan.id,
      region: scan.region_id,
      id: scan.analysis_id,
    });
    return;
  }
  if (!params().get("scan")) {
    const q = params();
    q.set("scan", scan.id);
    if (scan.region_id) q.set("region", scan.region_id);
    if (scan.analysis_id) q.set("id", scan.analysis_id);
    history.replaceState(null, "", "#" + q);
  }
  const m = await record("media", scan.media_id),
    dicom = m.mime === "application/dicom";
  let frameIndex = Math.min(
    (m.detail.frames || 1) - 1,
    Math.max(0, Number(params().get("scan_frame")) || 0),
  );
  const detail = $("#scan-detail");
  const credit = m.detail.attribution
    ? `<p class="muted">${esc(m.detail.attribution)}${safeURL(m.detail.source_url) ? ` · <a href="${esc(safeURL(m.detail.source_url))}" target="_blank" rel="noopener noreferrer">Original and license</a>` : ""}</p>`
    : "";
  detail.innerHTML =
    card(
      scan.name,
      `${notice(scan.detail.provenance || m.detail.provenance || "Supplied scan. Coach annotations are manual observations.")}${dicom ? `<div class="grid three">${field("Window centre", "center", m.detail.window_center || 0, "number")}${field("Window width", "width", m.detail.window_width || 0, "number", 'min="0"')}${field("Frame", "frame", 0, "number", `min="0" max="${(m.detail.frames || 1) - 1}"`)}</div><button id="window-apply">Apply window</button>` : `<label>Image contrast<input id="scan-contrast" type="range" min="50" max="180" value="100"></label>`}<div class="scan-image" id="scan-stage"><img id="scan-image" alt="${esc(scan.name)}"><svg id="scan-annotations" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Manual scan annotations"></svg></div><p id="scan-hint">${state.me.role === "student" ? "View your coach’s saved markers." : "Click the image to place an anatomical annotation."}</p><div class="actions"><a class="button" href="${href("client", { tab: "anatomy", region: scan.region_id, id: scan.analysis_id })}">Explore linked anatomy</a>${scan.analysis_id ? `<a class="button" href="${href("report", { id: scan.analysis_id })}">Source analysis</a>` : ""}${state.me.role === "student" ? "" : '<button data-edit="notes">+ Linked coach note</button>'}<a class="button" href="${mediaURL(m.id)}" download="${esc(m.filename)}">Download original</a></div>`,
    ) +
    card(
      "Saved annotations",
      table(
        ["Region", "Coach annotation", "Frame"],
        scan.findings.map((f) => [
          `<a href="${href("client", { tab: "anatomy", region: f.region_id, id: scan.analysis_id })}">${esc(regionName(f.region_id))}</a>`,
          esc(f.text),
          f.frame_index,
        ]),
      ),
    ) +
    card(
      "Related coach notes",
      linkedNotes(
        c.notes.filter(
          (n) => n.scan_id === scan.id || n.region_id === scan.region_id,
        ),
      ),
    );
  if (credit) detail.insertAdjacentHTML("beforeend", credit);
  if (dicom) {
    detail.querySelector("[name=frame]").value = frameIndex;
    for (const name of ["center", "width"]) {
      const saved = params().get("scan_" + name);
      if (saved !== null && Number.isFinite(Number(saved)))
        detail.querySelector(`[name=${name}]`).value = saved;
    }
  }
  const image = $("#scan-image");
  const annotations = () => {
    $("#scan-annotations").innerHTML = scan.findings
      .filter((f) => f.frame_index === frameIndex)
      .map(
        (f, i) =>
          `<g><circle cx="${f.x * 1000}" cy="${f.y * 1000}" r="13" fill="#53dbc0" stroke="#051522" stroke-width="4"/><text x="${f.x * 1000 + 18}" y="${f.y * 1000 + 8}" fill="#53dbc0" font-size="25">${i + 1}</text></g>`,
      )
      .join("");
  };
  const source = () => {
    image.src = dicom
      ? "/platform/dicom?" +
        new URLSearchParams({
          id: m.id,
          frame: frameIndex,
          center: detail.querySelector("[name=center]").value,
          width: detail.querySelector("[name=width]").value,
        })
      : mediaURL(m.id);
    annotations();
  };
  image.onerror = () => {
    $("#scan-hint").textContent =
      "This scan could not render. Retry with default window values, or export an uncompressed DICOM/PNG from the source viewer.";
  };
  source();
  if ($("#window-apply"))
    $("#window-apply").onclick = () => {
      frameIndex = Math.max(
        0,
        Math.min(
          (m.detail.frames || 1) - 1,
          Number(detail.querySelector("[name=frame]").value),
        ),
      );
      const q = params();
      q.set("scan_frame", frameIndex);
      q.set("scan_center", detail.querySelector("[name=center]").value);
      q.set("scan_width", detail.querySelector("[name=width]").value);
      history.replaceState(null, "", "#" + q);
      source();
    };
  if ($("#scan-contrast"))
    $("#scan-contrast").oninput = (e) =>
      (image.style.filter = `contrast(${e.target.value}%)`);
  if (state.me.role !== "student")
    $("#scan-stage").onclick = (e) => {
      const rect = image.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width,
        y = (e.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      modal(
        "Annotate this scan",
        select("Anatomical region", "region_id", regions(), scan.region_id) +
          area("Manual observation", "text") +
          notice(
            "This annotation is educational. It does not establish a diagnosis.",
          ),
        async (f) =>
          api("annotate", {
            ...Object.fromEntries(f),
            scan_id: scan.id,
            x,
            y,
            frame_index: frameIndex,
          }),
      );
    };
  bindButtons(detail);
}
function scanUpload() {
  const c = state.client;
  const d = modal(
    "Upload scan for " + c.name,
    `<label>Scan file<input name="file" type="file" accept="image/jpeg,image/png,image/webp,.dcm,.dicom" required></label>` +
      field("Record name", "name", "", "text", "required") +
      select(
        "Scan type",
        "scan_type",
        ["X-ray", "DICOM", "Body scan image", "Other supplied image"].map(
          (x) => [x, x],
        ),
        "X-ray",
        null,
      ) +
      select(
        "Anatomical region",
        "region_id",
        regions(),
        params().get("region"),
      ) +
      select(
        "Related assessment",
        "analysis_id",
        c.analyses.map((a) => [a.id, dt(a.created_at) + " · " + a.kind]),
        params().get("id"),
        "No linked assessment",
      ) +
      field(
        "Capture date",
        "captured_at",
        new Date().toISOString().slice(0, 10),
        "date",
        "required",
      ) +
      '<p id="scan-upload-progress" role="status"></p>',
    async (f, form) => {
      const file = form.querySelector("[name=file]").files[0];
      const m = await upload(
        file,
        { kind: "scan", student_id: c.id },
        (n) =>
          (form.querySelector("#scan-upload-progress").textContent =
            "Uploading · " + n + "%"),
      );
      const saved = await api("save", {
        collection: "scans",
        item: {
          ...Object.fromEntries([...f].filter(([k]) => k !== "file")),
          student_id: c.id,
          media_id: m.id,
        },
      });
      go("client", {
        tab: "scans",
        scan: saved.id,
        region: saved.region_id,
        id: saved.analysis_id,
      });
    },
  );
}
