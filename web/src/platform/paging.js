import { state, list, field, notice, bindButtons } from "./core.js";

/** Page records on the server so every scoped record remains reachable. */
export async function pagedRecords(
  root,
  {
    collection,
    title,
    filters = {},
    renderRows,
    searchLabel = "Search records",
  },
) {
  root.innerHTML =
    title +
    `<div class="filter-row">${field(searchLabel, "record-search")}</div><p data-count role="status"></p><div data-rows></div><div class="actions"><button data-previous>Previous page</button><button data-next>Next page</button></div>`;
  let offset = 0,
    version = 0,
    timer;
  const size = 50,
    find = (s) => root.querySelector(s);
  async function draw() {
    const current = ++version;
    find("[data-count]").textContent = "Loading records…";
    try {
      const result = await list(collection, {
        ...filters,
        q: find("[name=record-search]").value,
        limit: size,
        offset,
      });
      if (current !== version || !root.isConnected) return;
      find("[data-rows]").innerHTML = renderRows(result.items);
      find("[data-count]").textContent =
        `${result.total} records · ${result.total ? offset + 1 : 0}–${Math.min(offset + size, result.total)} shown`;
      find("[data-previous]").disabled = offset === 0;
      find("[data-next]").disabled = offset + size >= result.total;
      bindButtons(root);
    } catch (error) {
      if (current === version)
        find("[data-rows]").innerHTML = notice(error.message);
      find("[data-count]").textContent =
        "Records could not be loaded. Change the search or retry the page.";
    }
  }
  find("[data-previous]").onclick = () => {
    offset = Math.max(0, offset - size);
    draw();
  };
  find("[data-next]").onclick = () => {
    offset += size;
    draw();
  };
  find("[name=record-search]").oninput = () => {
    offset = 0;
    clearTimeout(timer);
    timer = setTimeout(draw, 200);
  };
  state.dispose.push(() => {
    ++version;
    clearTimeout(timer);
  });
  await draw();
}
