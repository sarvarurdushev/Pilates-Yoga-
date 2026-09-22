import {
  api,
  state,
  head,
  card,
  table,
  esc,
  dt,
  select,
  href,
  mediaURL,
  coachName,
  clientName,
} from "./core.js";
export async function inspection(root) {
  const data = await api("inspect");
  root.innerHTML =
    head(
      "Organization data",
      "Inspect stored entities, their foreign keys and uploaded media. This view is restricted to administrators.",
    ) +
    `<div class="filter-row">${select(
      "Entity table",
      "entity-table",
      Object.entries(data.tables).map(([name, t]) => [
        name,
        `${name.replace("p_", "")} · ${t.count} records`,
      ]),
      "p_analyses",
      null,
    )}</div><div id="entity-relations"></div><div id="entity-records" class="table-scroll"></div><p id="entity-count" role="status"></p><div class="actions"><button id="entity-prev">Previous page</button><button id="entity-next">Next page</button></div>` +
    card(
      "Coach → client assignments",
      table(
        ["Coach", "Client"],
        data.coach_students.map((r) => [
          esc(coachName(r.coach_id)),
          `<a href="${href("client", { client: r.student_id, tab: "overview" })}">${esc(clientName(r.student_id))}</a>`,
        ]),
      ),
    ) +
    card(
      "Recent changes",
      table(
        ["Time", "Action", "Record"],
        data.audit.map((a) => [
          dt(a.created_at),
          esc(a.action),
          esc(a.subject_id),
        ]),
      ),
    );
  let offset = 0,
    version = 0;
  const el = (s) => root.querySelector(s);
  async function draw() {
    const current = ++version,
      name = el("[name=entity-table]").value,
      meta = data.tables[name];
    el("#entity-relations").innerHTML = card(
      "Foreign-key relationships",
      meta.foreign_keys.length
        ? table(
            ["Field", "References", "Delete behavior"],
            meta.foreign_keys.map((f) => [
              esc(f.from),
              esc(
                f.table +
                  "." +
                  (f.to ||
                    data.tables[f.table]?.primary_key?.join(", ") ||
                    "primary key"),
              ),
              esc(f.on_delete),
            ]),
          )
        : "Organization root / shared anatomical vocabulary.",
    );
    el("#entity-count").textContent = "Loading stored records…";
    try {
      const result = await api(
        "inspect-records?" + new URLSearchParams({ table: name, offset }),
      );
      if (current !== version || !root.isConnected) return;
      el("#entity-records").innerHTML = table(
        result.columns,
        result.items.map((r) =>
          result.columns.map((k) => {
            if (k === "id" && name === "p_media")
              return `<a href="${mediaURL(r.id)}" target="_blank" rel="noopener">${esc(r.id)} ↗</a>`;
            if (k === "id" && name === "p_analyses")
              return `<a href="${href("report", { client: r.student_id, id: r.id })}">${esc(r.id)}</a>`;
            return esc(r[k] == null ? "—" : r[k]);
          }),
        ),
      );
      el("#entity-count").textContent =
        `${result.total} records · ${result.total ? offset + 1 : 0}–${Math.min(offset + 50, result.total)} shown`;
      el("#entity-prev").disabled = offset === 0;
      el("#entity-next").disabled = offset + 50 >= result.total;
    } catch (e) {
      el("#entity-count").textContent = e.message;
    }
  }
  el("[name=entity-table]").onchange = () => {
    offset = 0;
    draw();
  };
  el("#entity-prev").onclick = () => {
    offset = Math.max(0, offset - 50);
    draw();
  };
  el("#entity-next").onclick = () => {
    offset += 50;
    draw();
  };
  state.dispose.push(() => ++version);
  await draw();
}
