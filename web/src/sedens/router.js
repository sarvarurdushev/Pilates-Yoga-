// Hash routes for the SEDENS app, kept free of the DOM so they can be tested.
// A route is "#/" + a pattern such as "creator/courses/:course"; parameters are
// identifiers (letters, digits, "-" and "_"), and anything after "?" in the hash
// is a query. Legacy workspace links never reach this: index.html redirects any
// hash that does not start with "#/".

const ID = /^[A-Za-z0-9_-]{1,100}$/;

export function compile(patterns) {
  return patterns.map(([pattern, name]) => ({ name, parts: pattern ? pattern.split("/") : [] }));
}

export function match(table, hash) {
  const raw = String(hash ?? "").replace(/^#\/?/, "");
  const [path, queryText = ""] = raw.split("?");
  const segments = path.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  });
  const query = Object.fromEntries(new URLSearchParams(queryText));
  if (segments.includes(null)) return { name: "not_found", params: {}, query };
  for (const route of table) {
    if (route.parts.length !== segments.length) continue;
    const params = {};
    const ok = route.parts.every((part, i) => {
      if (part.startsWith(":")) {
        if (!ID.test(segments[i])) return false;
        params[part.slice(1)] = segments[i];
        return true;
      }
      return part === segments[i];
    });
    if (ok) return { name: route.name, params, query };
  }
  return { name: segments.length ? "not_found" : "home", params: {}, query };
}

export const href = (...parts) => "#/" + parts.map((p) => encodeURIComponent(String(p))).join("/");
