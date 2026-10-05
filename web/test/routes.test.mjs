import test from "node:test";
import assert from "node:assert/strict";
import { href } from "../src/platform/core.js";

test("links retain the selected client but omit absent optional IDs", () => {
  globalThis.location = { hash: "#page=client&client=sarah&tab=sessions" };
  const link = href("client", {
    tab: "notes",
    region: "right_shoulder",
    note: "n1",
    id: undefined,
    scan: null,
    session: "",
  });
  const p = new URLSearchParams(link.slice(1));
  assert.deepEqual(Object.fromEntries(p), {
    page: "client", client: "sarah", tab: "notes", region: "right_shoulder", note: "n1",
  });
});

test("an explicit empty client clears inherited context", () => {
  globalThis.location = { hash: "#page=client&client=sarah" };
  assert.equal(href("clients", { client: "" }), "#page=clients");
});
