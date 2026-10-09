import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, match, href } from "../src/sedens/router.js";

const table = compile([
  ["", "home"],
  ["creator", "creator"],
  ["creator/courses/new", "course_new"],
  ["creator/courses/:course", "course_edit"],
  ["creator/courses/:course/sessions/:session", "session_edit"],
  ["courses/:course", "course_detail"],
]);

test("static and nested routes resolve with parameters", () => {
  assert.deepEqual(match(table, "#/"), { name: "home", params: {}, query: {} });
  assert.equal(match(table, "#/creator").name, "creator");
  assert.equal(match(table, "#/creator/courses/new").name, "course_new");
  assert.deepEqual(match(table, "#/creator/courses/abc-123").params, { course: "abc-123" });
  assert.deepEqual(match(table, "#/creator/courses/c1/sessions/s_2").params, { course: "c1", session: "s_2" });
});

test("queries are read from the hash", () => {
  assert.deepEqual(match(table, "#/courses/c1?tab=overview&x=1").query, { tab: "overview", x: "1" });
});

test("unknown or unsafe paths are not found instead of silently showing home", () => {
  for (const hash of ["#/nope", "#/creator/courses/a b", "#/courses/%E0%A4%A", "#/courses/..%2F..", "#/courses/<x>"]) {
    assert.equal(match(table, hash).name, "not_found", hash);
  }
});

test("links are built with encoded parts", () => {
  assert.equal(href("creator", "courses", "c1"), "#/creator/courses/c1");
  assert.equal(href("courses", "a/b"), "#/courses/a%2Fb");
});
