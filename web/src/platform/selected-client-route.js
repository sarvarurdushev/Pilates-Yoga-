/** Resolve a hash route against the signed-in role before loading client data. */
export function selectedClientRoute(route, me) {
  const client = route.get("client");
  if (me.role === "student") {
    // A copied link may name another client. Keep the visible URL in sync with
    // the student's own record so later links cannot inherit the foreign ID.
    if (client && client !== me.user.id) {
      route.set("client", me.user.id);
      return { id: me.user.id, changed: true };
    }
    return { id: me.user.id, changed: false };
  }
  if (client && me.role !== "admin" &&
      !me.students.some((student) => student.id === client)) {
    route.delete("client");
    return { id: null, changed: true };
  }
  return { id: client, changed: false };
}
