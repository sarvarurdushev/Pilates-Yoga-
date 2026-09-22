import {
  state,
  list,
  href,
  esc,
  field,
  select,
  head,
  notice,
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
