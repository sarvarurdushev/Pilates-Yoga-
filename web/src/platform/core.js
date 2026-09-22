export const $ = (s) => document.querySelector(s);
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const id = () => crypto.randomUUID().replaceAll("-", "");
export const date = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export const num = (v, unit = "") =>
  Number.isFinite(v)
    ? `${v.toFixed(["ratio", "m", "m/s", "m/s²"].includes(unit) ? 3 : 1).replace(/\.0$/, "")}${unit === "deg" ? "°" : unit ? ` ${unit}` : ""}`
    : "—";
export const views = {
  front: "Front",
  rear: "Back",
  side_left: "Left side",
  side_right: "Right side",
};
const paths = {
  home: "M3 10 12 3 21 10 M5 9v12h5v-7h4v7h5V9",
  clients:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  reports: "M8 3H4v18h16V3h-4 M8 2h8v4H8z M8 11h8 M8 15h5",
  capture: "M8 4 6 7H2v14h20V7h-4l-2-3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  compare: "M4 5h7v14H4z M15 5h5v14h-5 M11 12h4",
  timeline: "M12 3v18 M5 6h7 M12 12h7 M5 18h7",
  programs: "M4 4h6v6H4z M14 14h6v6h-6z M14 4h6v6h-6z M7 10v7h7",
  library:
    "M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3z M12 6v16",
  anatomy:
    "M14 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M4 9h16 M12 7v7 M12 14 7 22 M12 14l5 8",
  schedule: "M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16",
  notes: "M4 3h12l4 4v14H4z M8 11h8 M8 15h6",
  xray: "M3 3h18v18H3z M12 5v14 M7 7l5 2 5-2 M7 11l5 2 5-2 M7 15l5 2 5-2",
  settings:
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  plus: "M12 4v16 M4 12h16",
  equipment: "M3 7v10 M7 5v14 M7 12h10 M17 5v14 M21 7v10",
  payments: "M3 5h18v14H3z M3 10h18 M6 15h4",
  check: "M4 12l5 5L20 6",
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.reports}"/></svg>`;
export const badge = (text, type = "") =>
  `<span class="badge ${type}">${esc(text)}</span>`;
export const empty = (title, body, action = "") =>
  `<div class="empty">${icon("reports")}<h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
export const button = (text, action, cls = "") =>
  `<button class="${cls}" data-action="${esc(action)}">${esc(text)}</button>`;
export const link = (text, hash, cls = "") =>
  `<a class="button ${cls}" href="#${esc(hash)}">${esc(text)}</a>`;
export const card = (title, body, extra = "") =>
  `<section class="card"><div class="card-head"><h3>${esc(title)}</h3>${extra}</div>${body}</section>`;
export function chart(
  values,
  { labels = [], color = "#5489ff", unit = "", height = 180 } = {},
) {
  const actual = values.filter(Number.isFinite);
  if (!actual.length)
    return empty(
      "No measurements yet",
      "Complete an assessment to start this chart.",
    );
  const max = Math.max(...actual) * 1.15 || 1,
    min = Math.min(0, ...actual),
    w = 560,
    h = height,
    p = 34;
  const point = (v, i) => [
    p + (i * (w - 2 * p)) / Math.max(1, values.length - 1),
    h - p - ((v - min) / (max - min)) * (h - 2 * p),
  ];
  let paths = [],
    current = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) paths.push(current);
      current = [];
    } else current.push(point(v, i));
  });
  if (current.length) paths.push(current);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(actual.map((v, i) => `${labels[i] || i + 1}: ${num(v, unit)}`).join(", "))}">${[0, 0.5, 1].map((t) => `<path d="M${p} ${h - p - t * (h - 2 * p)}H${w - p}" stroke="#25344a"/><text x="0" y="${h - p - t * (h - 2 * p) + 4}" fill="#8191aa" font-size="10">${num(min + t * (max - min))}</text>`).join("")}${paths.map((points) => `<polyline points="${points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="3"/>`).join("")}${values.map((v, i) => (v == null ? "" : `<circle cx="${point(v, i)[0]}" cy="${point(v, i)[1]}" r="${values.length > 20 ? 1.5 : 4}" fill="${color}"><title>${esc(labels[i] || i + 1)}: ${num(v, unit)}</title></circle>${labels[i] ? `<text x="${point(v, i)[0]}" y="${h - 7}" fill="#899ab2" text-anchor="middle" font-size="10">${esc(labels[i])}</text>` : ""}`)).join("")}</svg>`;
}
export function bars(items) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return `<div class="bars">${items.map((x) => `<div><span>${esc(x.label)}</span><div><i style="width:${Math.max(0, x.value / max) * 100}%"></i></div><b>${esc(x.value)}</b></div>`).join("")}</div>`;
}
export const stat = (label, value, detail, ico = "reports") =>
  `<div class="stat">${icon(ico)}<span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
export function download(name, data, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type },
    ),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const state = { me: null, client: null, dispose: [] };
export function relatedRegion(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const pair = /^(left|right|both)_(.+)$/;
  const aa = a.match(pair),
    bb = b.match(pair);
  return Boolean(
    aa && bb && aa[2] === bb[2] && (aa[1] === "both" || bb[1] === "both"),
  );
}
export const params = () => new URLSearchParams(location.hash.slice(1));
export function href(page, extra = {}) {
  const p = new URLSearchParams({
    page,
    ...(params().get("client") ? { client: params().get("client") } : {}),
    ...extra,
  });
  for (const [k, v] of [...p]) if (!v) p.delete(k);
  return "#" + p;
}
export function go(page, extra = {}) {
  location.hash = href(page, extra);
}
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 4500);
}
export async function api(path, body) {
  let r;
  try {
    r = await fetch("/platform/" + path, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(
        path.startsWith("auth/demo") ? 180000 : 60000,
      ),
      headers: body
        ? { "Content-Type": "application/json", "X-Platform-Request": "1" }
        : {},
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw Error(
      "The server is unavailable. Keep your selected files and retry when it is ready.",
    );
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error(
      `The server returned an incomplete response (${r.status}). Your selected files are still on this device. Retry shortly.`,
    );
  }
  if (!r.ok) {
    const e = Error(data.error || "This action could not finish.");
    e.status = r.status;
    throw e;
  }
  return data;
}
export const list = (collection, extra = {}) =>
  api("list?" + new URLSearchParams({ collection, limit: 200, ...extra }));
export const record = (collection, id) =>
  api("record?" + new URLSearchParams({ collection, id }));
export const mediaURL = (id) => "/platform/media?id=" + encodeURIComponent(id);
export const safeURL = (url) =>
  /^(https?:\/\/|\/(?!\/))/.test(url || "") ? url : "";
export const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const area = (label, name, value = "") =>
  `<label>${esc(label)}<textarea name="${esc(name)}" rows="3">${esc(value)}</textarea></label>`;
export const options = (items, selected = "", blank = "Choose…") =>
  (blank !== null ? `<option value="">${esc(blank)}</option>` : "") +
  items
    .map((i) => {
      const [v, t] = Array.isArray(i) ? i : [i.id, i.name];
      return `<option value="${esc(v)}" ${String(selected) === String(v) ? "selected" : ""}>${esc(t)}</option>`;
    })
    .join("");
export const select = (label, name, items, value = "", blank = "Choose…") =>
  `<label>${esc(label)}<select name="${esc(name)}">${options(items, value, blank)}</select></label>`;
export const regions = () => state.me?.regions || [];
export const regionName = (id) =>
  regions().find((x) => x.id === id)?.name || "Whole body";
export function head(title, subtitle = "", actions = "") {
  return `<div class="page-head"><div><div class="eyebrow">${esc(state.me?.role || "Motion Yoga")} WORKSPACE</div><h1>${esc(title)}</h1><p class="muted">${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
}
export function avatar(p, large = false) {
  if (p.avatar && Number.isInteger(p.detail?.avatar_cell)) {
    const cell = p.detail.avatar_cell;
    return `<div class="avatar-photo portrait-grid"><img src="${esc(safeURL(p.avatar))}" style="transform:translate(${-60 * (cell % 3)}px,${-60 * Math.floor(cell / 3)}px)" alt="${esc(p.name)} · generated illustration" loading="lazy"></div>`;
  }
  return p.avatar && safeURL(p.avatar)
    ? `<div class="avatar-photo ${large ? "large" : ""}"><img src="${esc(safeURL(p.avatar))}" alt="${esc(p.name)} · generated illustration"></div>`
    : `<div class="avatar-initial ${large ? "large" : ""}" aria-label="${esc(p.name)}">${esc(
        p.detail?.profile_initials ||
          p.name
            ?.split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join(""),
      )}</div>`;
}
export const clientName = (id) =>
  state.me.students.find((p) => p.id === id)?.name || "Archived client";
export const coachName = (id) =>
  state.me.coaches.find((p) => p.id === id)?.name || "Studio coach";
export const locationName = (id) =>
  state.me.locations.find((p) => p.id === id)?.name || "No location";
export const dt = (v) =>
  v
    ? new Date(v).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
export function table(headers, rows) {
  return `<div class="table-scroll"><table><thead><tr>${headers.map((t) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v ?? "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export function notice(text) {
  return `<div class="notice">${esc(text)}</div>`;
}
export function modal(title, content, onSubmit) {
  const d = $("#modal");
  d.innerHTML = `<form id="edit-form"><div class="page-head"><h2>${esc(title)}</h2><button type="button" data-close aria-label="Close dialog">✕</button></div>${content}<p class="form-error" role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button>${onSubmit ? '<button class="primary" type="submit">Save</button>' : ""}</div></form>`;
  d.querySelectorAll("[data-close]").forEach(
    (b) => (b.onclick = () => d.close()),
  );
  d.showModal();
  if (onSubmit)
    d.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = d.querySelector("[type=submit]");
      b.disabled = true;
      try {
        await onSubmit(new FormData(e.target), e.target);
        d.close();
        toast("Saved");
        window.dispatchEvent(new Event("platform-refresh"));
      } catch (err) {
        d.querySelector(".form-error").textContent = err.message;
      } finally {
        b.disabled = false;
      }
    };
  return d;
}
export function bindButtons(root = document) {
  root.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const m = await import("./forms.js");
          await m.edit(b.dataset.edit, b.dataset.id);
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  root.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = () =>
        modal(
          "Remove record?",
          notice(
            "This removes the selected record and its dependent links. Historical shared content retains its authorship reference where possible.",
          ),
          async () => {
            await api("delete", {
              collection: b.dataset.delete,
              id: b.dataset.id,
            });
          },
        )),
  );
}
export function upload(file, query, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.timeout = 120000;
    x.ontimeout = () =>
      reject(
        Error(
          "The upload timed out. Your original file is unchanged; retry on a stable connection.",
        ),
      );
    x.open(
      "POST",
      "/platform/upload?" +
        new URLSearchParams({ ...query, filename: file.name }),
    );
    x.setRequestHeader("X-Platform-Request", "1");
    x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.upload.onprogress = (e) =>
      onProgress(
        e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : 0,
      );
    x.onerror = () =>
      reject(
        Error(
          "Upload interrupted. Your original file is still available; retry.",
        ),
      );
    x.onload = () => {
      let data;
      try {
        data = JSON.parse(x.responseText);
      } catch {
        return reject(
          Error(
            "The upload server returned an incomplete response. Retry shortly.",
          ),
        );
      }
      x.status < 300
        ? resolve(data)
        : reject(Error(data.error || "Upload failed."));
    };
    x.send(file);
  });
}
export function spark(
  series,
  { label = "", unit = "", color = "#5d91ff", xLabel = num } = {},
) {
  const values = series.filter((p) => Number.isFinite(p[1]));
  if (!values.length)
    return notice("No reliable values available for this trace.");
  const xs = values.map((p) => p[0]),
    ys = values.map((p) => p[1]);
  const lo = Math.min(...ys),
    hi = Math.max(...ys),
    x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  const xy = ([x, y]) => [
    40 + ((x - x0) / (x1 - x0 || 1)) * 480,
    140 - ((y - lo) / (hi - lo || 1)) * 110,
  ];
  let path = "",
    open = false;
  for (const p of series) {
    if (!Number.isFinite(p[1])) {
      open = false;
      continue;
    }
    const [x, y] = xy(p);
    path += (open ? "L" : "M") + x + "," + y;
    open = true;
  }
  return `<figure class="trace"><figcaption>${esc(label)} <small>${esc(unit)}</small></figcaption><svg viewBox="0 0 550 170" role="img" aria-label="${esc(label)}"><path d="M40 20V140H530" stroke="#30425d" fill="none"/><text x="0" y="24">${num(hi)}</text><text x="0" y="142">${num(lo)}</text><path d="${path}" stroke="${color}" stroke-width="2" fill="none"/>${values
    .map((p) => {
      const [x, y] = xy(p);
      return `<circle cx="${x}" cy="${y}" r="3" fill="${color}" tabindex="0"><title>${esc(xLabel(p[0]))} : ${num(p[1], unit)}</title></circle>`;
    })
    .join(
      "",
    )}<text x="40" y="163">${esc(xLabel(x0))}</text><text x="480" y="163">${esc(xLabel(x1))}</text></svg></figure>`;
}

export function exerciseIllustration(e) {
  if (e.thumbnail_media_id)
    return `<img class="exercise-thumb" src="${mediaURL(e.thumbnail_media_id)}" alt="${esc(e.name)}" loading="lazy">`;
  const d = e.detail || {},
    url = safeURL(d.thumbnail);
  if (!url) return "";
  const cell = d.thumbnail_cell;
  return `<figure>${Number.isInteger(cell) ? `<div class="exercise-sprite" role="img" aria-label="${esc(e.name)} · generated illustration" style="background-image:url('${esc(url)}');background-position:${(cell % 3) * 50}% ${Math.floor(cell / 3) * 50}%"></div>` : `<img class="exercise-thumb" src="${esc(url)}" alt="${esc(e.name)} · generated illustration" loading="lazy">`}<figcaption class="muted">Generated exercise illustration</figcaption></figure>`;
}
