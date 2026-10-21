// Customer sign-in (src/sedens/account-render.js, account.js): the activity lines and the facility
// console's link panel in both languages, and that the link's secret is never put in a request URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let language = "en";
globalThis.localStorage = { getItem: () => language, setItem() {} };
const { setLang } = await import("../src/sedens/i18n.js");
const { STRINGS } = await import("../src/sedens/strings.js");
const { ACCOUNT } = await import("../src/sedens/strings-account.js");
const view = await import("../src/sedens/account-render.js");
const { privacyBody } = await import("../src/sedens/passport-render.js");

const use = (value) => {
  language = value;
  setLang(value);
};

const AT = "2026-10-20T09:30:00+00:00";
const activity = {
  items: [
    { kind: "sessions_revoked", purpose: null, at: AT, by: "you", staff_name: null },
    { kind: "password_set_by_customer", purpose: "setup", at: AT, by: "link", staff_name: null },
    { kind: "link_issued", purpose: "setup", at: AT, by: "staff", staff_name: "Mina <Park>" },
    { kind: "link_issued", purpose: "reset", at: AT, by: "staff", staff_name: null },
    { kind: "staff_password_refused", purpose: null, at: AT, by: "staff", staff_name: "Coach Lee" },
    { kind: "staff_email_refused", purpose: null, at: AT, by: "staff", staff_name: "Coach Lee" },
    { kind: "customer_role_removed", purpose: null, at: AT, by: "staff", staff_name: "Admin Kim" },
    { kind: "customer_role_added", purpose: null, at: AT, by: "staff", staff_name: null },
  ],
};

test("the account copy exists in both languages and is merged once", () => {
  assert.deepEqual(Object.keys(ACCOUNT.ko).sort(), Object.keys(ACCOUNT.en).sort());
  for (const key of Object.keys(ACCOUNT.en)) {
    assert.equal(STRINGS.en[key], ACCOUNT.en[key]);
    assert.equal(STRINGS.ko[key], ACCOUNT.ko[key]);
  }
  // Korean copy speaks in 해요체 like the rest of the customer pages.
  for (const key of ["acct.setup_lead", "acct.done_body", "acct.links_hint", "acct.activity_lead"])
    assert.match(ACCOUNT.ko[key], /요\.?$|요\./, key);
});

test("every kind of activity has a plain line, in English and Korean", () => {
  for (const value of ["en", "ko"]) {
    use(value);
    const lines = activity.items.map((item) => view.activityText(item));
    assert.ok(lines.every((line) => line && !line.includes("acct.") && !line.includes("{")), lines.join(" | "));
  }
  use("en");
  assert.equal(view.activityText(activity.items[3]), "Someone at your facility created a password reset link for you.");
  assert.equal(view.activityText(activity.items[4]), "Coach Lee tried to set your password. It was not allowed.");
  // Whoever held the link chose the password: the customer is not told it was them.
  assert.doesNotMatch(view.activityText(activity.items[1]), /^You /);
  assert.match(view.activityText(activity.items[1]), /If it wasn't you, ask your facility for a reset link/);
  assert.equal(view.activityText(activity.items[6]), "Admin Kim turned off customer access for this account. You were signed out.");
  assert.match(view.activityText(activity.items[7]), /^Someone at your facility turned on customer access/);
  assert.equal(view.activityText({ kind: "something_new", at: AT }), "");
});

test("the activity card escapes names and says when nothing could be loaded", () => {
  use("en");
  const html = view.activitySection(activity);
  assert.match(html, /Sign-in activity/);
  assert.ok(html.includes("Mina &lt;Park&gt;") && !html.includes("<Park>"));
  assert.equal((html.match(/<li>/g) || []).length, 8);
  assert.match(view.activitySection({ items: [] }), /Nothing here yet/);
  assert.match(view.activitySection(null), /could not be loaded/);
  // The privacy page shows it only when the page asked for it.
  const privacy = { stored: [], consent: { texts: {}, current: {} }, photos: { retained: 0 }, requests: [] };
  assert.doesNotMatch(privacyBody(privacy), /Sign-in activity/);
  assert.match(privacyBody({ ...privacy, sign_in_activity: activity }), /Sign-in activity/);
});

test("the facility panel offers a setup or reset link per customer, and none in a demonstration", () => {
  use("en");
  const data = {
    demo: false,
    items: [
      { id: "c1", name: "Ara Kim", has_password: false, open_link: null },
      { id: "c2", name: "Bo Han", has_password: true, open_link: null },
      { id: "c3", name: "Chae <Yu>", has_password: false, open_link: { purpose: "setup", expires_at: AT } },
    ],
  };
  const html = view.customerList(data);
  assert.match(html, /data-link-for="c1" data-purpose="setup"/);
  assert.match(html, /data-link-for="c2" data-purpose="reset"/);
  assert.match(html, /Not set up yet/);
  assert.match(html, /Can sign in/);
  assert.match(html, /Link open until/);
  assert.ok(!html.includes("<Yu>"));
  assert.match(html, /Staff never see or set a customer&#39;s password/);
  const demo = view.customerList({ demo: true, items: data.items });
  assert.doesNotMatch(demo, /data-link-for/);
  assert.match(demo, /don&#39;t need a password/);
  assert.match(view.customerList({ demo: false, items: [] }), /No customers yet/);
});

test("the link box shows the link once with its expiry and a copy button", () => {
  for (const value of ["en", "ko"]) {
    use(value);
    const html = view.linkBox({ link: "/#/account/setup?token=abc_DEF-123", purpose: "setup", expires_at: AT,
                                customer: { id: "c1", name: "Ara Kim" } }, "https://example.test");
    assert.ok(html.includes('value="https://example.test/#/account/setup?token=abc_DEF-123"'));
    assert.match(html, /data-copy-link/);
    assert.ok(html.includes("Ara Kim"));
    assert.ok(!html.includes("{"), html);
  }
});

test("the setup page asks for the password twice and explains a missing link", () => {
  use("ko");
  const form = view.setupPage("form");
  assert.equal((form.match(/type="password"/g) || []).length, 2);
  assert.equal((form.match(/autocomplete="new-password"/g) || []).length, 2);
  assert.match(form, /비밀번호 정하기/);
  use("en");
  assert.match(view.setupPage("no_token"), /This link is not complete/);
  assert.match(view.setupPage("done"), /signed out on every device/);
});

test("the link's secret travels only in a request body", () => {
  const source = readFileSync(new URL("../src/sedens/account.js", import.meta.url), "utf8");
  assert.match(source, /sedens\("account\/password", \{ token: held, password \}\)/);
  assert.doesNotMatch(source, /account\/password\?/);
  assert.doesNotMatch(source, /token=\$\{/);
  // It is removed from the address bar as soon as it is read.
  assert.match(source, /history\.replaceState\(null, "", `\$\{location\.pathname\}\$\{location\.search\}#\/account\/setup`\)/);
});
