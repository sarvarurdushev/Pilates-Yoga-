import test from "node:test";
import assert from "node:assert/strict";
import { selectedClientRoute } from "../src/platform/selected-client-route.js";

const people = [{ id: "sarah" }, { id: "minji" }];

test("Student refresh normalizes a copied foreign-client link to the signed-in record", () => {
  const route = new URLSearchParams("page=client&client=minji&tab=anatomy&region=right_shoulder");
  const selected = selectedClientRoute(route, {
    role: "student", user: { id: "sarah" }, students: [{ id: "sarah" }],
  });
  assert.deepEqual(selected, { id: "sarah", changed: true });
  assert.equal(route.get("client"), "sarah");
  assert.equal(route.get("tab"), "anatomy");
  assert.equal(route.get("region"), "right_shoulder");
});

test("Student no-client links still resolve to their own record", () => {
  const route = new URLSearchParams("page=client&tab=overview");
  assert.deepEqual(selectedClientRoute(route, {
    role: "student", user: { id: "sarah" }, students: [{ id: "sarah" }],
  }), { id: "sarah", changed: false });
  assert.equal(route.has("client"), false);
});

test("Coach refresh retains assigned client and clears unassigned client", () => {
  const me = { role: "coach", user: { id: "hana" }, students: people };
  const assigned = new URLSearchParams("page=client&client=sarah&tab=notes");
  assert.deepEqual(selectedClientRoute(assigned, me), { id: "sarah", changed: false });
  const foreign = new URLSearchParams("page=client&client=outside&tab=notes");
  assert.deepEqual(selectedClientRoute(foreign, me), { id: null, changed: true });
  assert.equal(foreign.has("client"), false);
  assert.equal(foreign.get("tab"), "notes");
});

test("Admin refresh retains a selected organization client", () => {
  const route = new URLSearchParams("page=client&client=minji&tab=progress");
  assert.deepEqual(selectedClientRoute(route, {
    role: "admin", user: { id: "jules" }, students: [],
  }), { id: "minji", changed: false });
  assert.equal(route.get("client"), "minji");
});
