// The SEDENS home must send every legacy coaching-workspace link to /workspace.html
// unchanged, and leave SEDENS routes alone. The real inline script from index.html runs here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script id="sedens-legacy-redirect">([\s\S]*?)<\/script>/)[1];

function visit(search = "", hash = "") {
  const replaced = [];
  const window = { location: { search, hash, replace: (url) => replaced.push(url) } };
  vm.runInNewContext(script, { window, globalThis: window });
  return replaced[0] ?? null;
}

test("SEDENS routes and the bare home stay on the SEDENS home", () => {
  for (const [search, hash] of [["", ""], ["", "#"], ["", "#/"], ["", "#/facility"], ["", "#/creator"], ["?", ""]]) {
    assert.equal(visit(search, hash), null, `${search}${hash}`);
  }
});

test("legacy workspace hashes open the same route in /workspace.html", () => {
  const cases = [
    "#page=dashboard",
    "#page=client&client=sarah&tab=sessions&assessment=analysis-19",
    "#page=client&client=C&tab=anatomy&region=right_shoulder&id=A",
    "#home",
    "#id=abc&client=C",
    "#page=report&id=A&client=C",
  ];
  for (const hash of cases) assert.equal(visit("", hash), "/workspace.html" + hash);
});

test("legacy query links keep their query and hash", () => {
  assert.equal(visit("?reset=TOKEN", ""), "/workspace.html?reset=TOKEN");
  assert.equal(visit("?verify=TOKEN", ""), "/workspace.html?verify=TOKEN");
  assert.equal(visit("?session=/session.json", ""), "/workspace.html?session=/session.json");
  assert.equal(visit("?x=1", "#page=dashboard"), "/workspace.html?x=1#page=dashboard");
});

test("campaign and click-tracking parameters alone keep the SEDENS home", () => {
  for (const search of ["?utm_source=newsletter&utm_campaign=launch", "?fbclid=IwAR0abc", "?gclid=x&UTM_MEDIUM=cpc", "?igshid=1"]) {
    assert.equal(visit(search, ""), null, search);
    assert.equal(visit(search, "#/facility"), null, search);
  }
  // A legacy parameter or hash still wins.
  assert.equal(visit("?utm_source=mail&reset=TOKEN", ""), "/workspace.html?utm_source=mail&reset=TOKEN");
  assert.equal(visit("?fbclid=1", "#page=dashboard"), "/workspace.html?fbclid=1#page=dashboard");
  assert.equal(visit("?%E0%A4%A=1", ""), "/workspace.html?%E0%A4%A=1");
});

test("a legacy hash pasted while on the SEDENS home also opens the workspace", () => {
  const app = readFileSync(new URL("../src/sedens/app.js", import.meta.url), "utf8");
  assert.match(app, /sedensLegacyWorkspaceTarget(\?\.)?\(location\.search, location\.hash\)/);
  assert.match(app, /addEventListener\("hashchange", onHashChange\)/);
});

test("the redirect runs before the SEDENS app module", () => {
  assert.ok(html.indexOf('id="sedens-legacy-redirect"') < html.indexOf("/src/sedens/app.js"));
  assert.ok(!/<script id="sedens-legacy-redirect"[^>]*type="module"/.test(html), "must be a classic, synchronous script");
});
