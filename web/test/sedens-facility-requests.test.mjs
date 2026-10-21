// Facility data requests page (src/sedens/facility-requests.js): the pure renderer, both languages,
// and the plain statement that SEDENS deletes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";

let language = "en";
globalThis.localStorage = { getItem: () => language, setItem() {} };
const { setLang } = await import("../src/sedens/i18n.js");
const { STRINGS } = await import("../src/sedens/strings.js");
const { REQUESTS } = await import("../src/sedens/strings-requests.js");
const page = await import("../src/sedens/facility-requests.js");
const { esc } = await import("../src/sedens/ui.js");

const use = (value) => {
  language = value;
  setLang(value);
};
const sample = () => ({
  max_note: 500,
  deletes_data: false,
  open: 1,
  items: [
    { id: "r1", kind: "erase_passport", state: "received", customer: "Customer <b>A</b>", requested_at: "2026-10-01T09:00:00Z", decided_at: null, message: "Please remove it.", note: "" },
    { id: "r2", kind: "erase_passport", state: "declined", customer: "Customer B", requested_at: "2026-09-01T09:00:00Z", decided_at: "2026-09-02T09:00:00Z", message: "", note: "We keep attendance." },
    { id: "r3", kind: "erase_passport", state: "completed", customer: "Customer C", requested_at: "2026-08-01T09:00:00Z", decided_at: "2026-08-02T09:00:00Z", message: "", note: "" },
  ],
});

test("both languages have every key, with the same placeholders", () => {
  assert.deepEqual(Object.keys(REQUESTS.en).sort(), Object.keys(REQUESTS.ko).sort());
  for (const key of Object.keys(REQUESTS.en)) {
    const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(holes(REQUESTS.ko[key]), holes(REQUESTS.en[key]), key);
    assert.equal(STRINGS.en[key], REQUESTS.en[key]);
    assert.equal(STRINGS.ko[key], REQUESTS.ko[key]);
  }
});

test("the page says plainly that nothing is deleted and what needs a policy", () => {
  for (const lang of ["en", "ko"]) {
    use(lang);
    const html = page.requestsHtml(sample());
    assert.ok(html.includes(esc(STRINGS[lang]["req.no_deletion"])));
    assert.ok(html.includes(STRINGS[lang]["req.can_photos"]));
    assert.ok(html.includes(STRINGS[lang]["req.policy_list"]));
  }
  use("en");
  assert.match(page.policyHtml(), /does not delete anything/);
});

test("open requests get a decision form; decided ones do not; names are escaped", () => {
  use("en");
  const html = page.requestsHtml(sample());
  assert.equal((html.match(/data-decide-form=/g) || []).length, 1);
  assert.ok(html.includes('data-decide-form="r1"'));
  assert.ok(html.includes("Customer &lt;b&gt;A&lt;/b&gt;") && !html.includes("<b>A</b>"));
  assert.ok(html.includes("We keep attendance.") && html.includes("Declined") && html.includes("Completed outside SEDENS"));
  assert.ok(html.includes('value="completed"') && html.includes('value="declined"'));
});

test("empty states and no misleading delete button", () => {
  use("en");
  assert.ok(page.requestsHtml({ items: [] }).includes(STRINGS.en["req.none"]));
  assert.ok(page.requestsHtml({ items: [{ ...sample().items[2] }] }).includes(STRINGS.en["req.none_open"]));
  assert.ok(!/delete (this|the) (customer|passport)|erase now/i.test(page.requestsHtml(sample())));
});

test("a decline needs a note", () => {
  assert.equal(page.decisionProblem("declined", "  "), "req.decline_needs_note");
  assert.equal(page.decisionProblem("declined", "why"), "");
  assert.equal(page.decisionProblem("completed", ""), "");
});

test("itemHtml keeps its tags balanced and the decide form outside the muted metadata", () => {
  use("en");
  const html = page.itemHtml({ id: "r1", state: "received", customer: "Mina", requested_at: "2026-10-01T00:00:00Z", message: "hi" });
  const count = (re) => (html.match(re) || []).length;
  assert.equal(count(/<div\b/g), count(/<\/div>/g));
  assert.equal(count(/<span\b/g), count(/<\/span>/g));
  assert.ok(html.indexOf("<form") > html.indexOf('</div><form') - 1 && /<\/div><form/.test(html));
});
