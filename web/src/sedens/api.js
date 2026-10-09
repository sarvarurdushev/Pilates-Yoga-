// Same-origin JSON calls. Every SEDENS POST carries the CSRF header the server requires.

export class ApiError extends Error {
  constructor(message, status, code, body) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function call(path, body, { method } = {}) {
  const verb = method || (body === undefined ? "GET" : "POST");
  const headers = { "Content-Type": "application/json" };
  if (path.startsWith("/sedens/")) headers["X-Sedens-Request"] = "1";
  if (path.startsWith("/platform/")) headers["X-Platform-Request"] = "1";
  const response = await fetch(path, {
    method: verb,
    headers,
    credentials: "same-origin",
    body: verb === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new ApiError(payload.error || response.statusText, response.status, payload.code || "", payload);
  return payload;
}

export const sedens = (route, body, options) => call("/sedens/" + route, body, options);
export const platform = (route, body, options) => call("/platform/" + route, body, options);

/** The demonstration key is shared with the coaching workspace so both open the same fictional facility. */
export function demoKey(fresh = false) {
  let key = null;
  try {
    key = sessionStorage.getItem("motion-demo-key");
  } catch {
    key = null;
  }
  if (!key || fresh || !/^[a-f0-9]{32}$/.test(key)) {
    key = crypto.randomUUID().replaceAll("-", "");
    try {
      sessionStorage.setItem("motion-demo-key", key);
    } catch {
      // The demonstration still opens; it just cannot be resumed after a reload.
    }
  }
  return key;
}

// A demonstration whose workspace data was edited away (for example its only
// location deleted) answers "demo_changed"; a fresh demonstration is opened once.
export async function withDemo(path, body = {}) {
  try {
    return await sedens(path, { ...body, key: demoKey() });
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "demo_changed")) throw error;
    return sedens(path, { ...body, key: demoKey(true) });
  }
}

/** Send a file as the raw request body (the server checks the rights in `query` before
 * reading it). Resolves with the JSON answer; progress is reported from 0 to 1. */
export function upload(route, file, query = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/sedens/" + route + "?" + new URLSearchParams(query));
    xhr.setRequestHeader("X-Sedens-Request", "1");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.withCredentials = true;
    if (onProgress) xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body.error || xhr.statusText, xhr.status, body.code || "", body));
    };
    xhr.onerror = () => reject(new ApiError("The upload was interrupted. Choose the file and try again.", 0, "upload_interrupted", {}));
    xhr.send(file);
  });
}
