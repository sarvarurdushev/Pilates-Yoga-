// Page wiring: / is SEDENS, /workspace.html is the unchanged coaching workspace,
// /room.html is the room screen, and the production build covers all three.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("the SEDENS home loads only the SEDENS app", () => {
  const html = read("index.html");
  assert.match(html, /<title>SEDENS/);
  assert.match(html, /src="\/src\/sedens\/app\.js"/);
  assert.doesNotMatch(html, /platform\/app\.js/);
});

test("the coaching workspace keeps the platform page structure", () => {
  const html = read("workspace.html");
  assert.match(html, /<script type="module" src="\/src\/platform\/app\.js"><\/script>/);
  for (const id of ["sidebar", "workspace", "topbar", "mode-banner", "app", "modal", "toast"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const css of ["/src/studio/studio.css", "/src/platform/platform.css", "/src/platform/explain.css"]) {
    assert.ok(html.includes(css), css);
  }
});

test("the room screen loads the room module", () => {
  const html = read("room.html");
  assert.match(html, /src="\/src\/sedens\/room\.js"/);
  assert.match(html, /id="room"/);
});

test("the anatomy viewer is untouched by SEDENS", () => {
  const html = read("anatomy.html");
  assert.doesNotMatch(html, /sedens/i);
  assert.match(html, /href="\/#home"/);
});

test("the production build includes all three application pages", () => {
  const config = read("vite.config.js");
  for (const page of ["index.html", "workspace.html", "room.html"]) assert.ok(config.includes(`"${page}"`), page);
});

test("room access is never decided in the page", () => {
  const room = read("src/sedens/room.js");
  // The screen asks the server; it holds no tokens and reads no cookies itself.
  assert.doesNotMatch(room, /document\.cookie/);
  assert.doesNotMatch(room, /localStorage\.setItem\([^)]*(token|room|device)/i);
  assert.match(room, /sedens\("room\/session"\)/);
});
