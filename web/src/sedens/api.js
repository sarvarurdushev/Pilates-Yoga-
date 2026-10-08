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
