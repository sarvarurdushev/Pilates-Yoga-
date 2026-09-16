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
    ? `${v.toFixed(unit === "ratio" ? 3 : 1).replace(/\.0$/, "")}${unit === "deg" ? "°" : unit ? ` ${unit}` : ""}`
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
  `<section class="card"><div class="card-head"><h3>${title}</h3>${extra}</div>${body}</section>`;
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
const database = new Promise((resolve, reject) => {
  const req = indexedDB.open("motion-yoga-studio", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("records");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export async function localGet(key) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const r = db.transaction("records").objectStore("records").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function localPut(key, value) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const t = db.transaction("records", "readwrite");
    t.objectStore("records").put(value, key);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
export function workspace(mode) {
  let key = localStorage.getItem(`motion-yoga-${mode}`);
  if (!new RegExp(`^${mode}-[a-f0-9]{32}$`).test(key || "")) {
    key = `${mode}-${id()}`;
    localStorage.setItem(`motion-yoga-${mode}`, key);
  }
  return key;
}
export async function request(
  key,
  path,
  { method = "GET", body, headers = {}, timeout = 60000 } = {},
) {
  let response;
  try {
    response = await fetch(`/studio/${path}`, {
      method,
      body:
        body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
      headers: {
        "X-Studio-Workspace": key,
        ...(body && !(body instanceof Blob)
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(
      e.name === "TimeoutError"
        ? "The server is taking longer to respond. Your capture is kept on this device; retry shortly."
        : "Could not reach the analysis server. Check your connection and retry.",
    );
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `The server returned an incomplete response (${response.status}). Your capture is kept on this device. Retry when the server is ready.`,
    );
  }
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
export function safeSource(source) {
  return /^https:\/\//.test(source || "")
    ? `<a href="${esc(source)}" target="_blank" rel="noopener">Read source ↗</a>`
    : esc(source || "");
}
export function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 5500);
}
