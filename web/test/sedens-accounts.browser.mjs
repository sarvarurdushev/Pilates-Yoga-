/** Customer sign-in in a real browser (Phase 4, docs/SEDENS_SECURITY_MODEL.md section 11): the
 * workspace refuses a staff-chosen customer password and hides the field; the facility console creates
 * a one-time link shown once; the customer chooses a password on their phone (the token never appears
 * in a request URL); a used link is refused; the Passport shows "Sign-in activity" (ko and en).
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8197 CHROMIUM=/path/to/chrome SHOTS=/path/to/folder \
 *   node test/sedens-accounts.browser.mjs
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8197";
const shots = process.env.SHOTS || "";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
const errors = [];
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
async function context(viewport = DESKTOP, lang = "en") {
  const ctx = await browser.newContext({ viewport, locale: lang === "ko" ? "ko-KR" : "en-US" });
  await ctx.addInitScript((l) => { try { localStorage.setItem("sedens-lang", l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { ctx, page };
}
const shot = (page, name, full = false) => (shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage: full }) : null);
const part = (locator, name) => (shots ? locator.screenshot({ path: `${shots}/${name}.png` }) : null);
const post = (page, path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Platform-Request": "1", "X-Sedens-Request": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [path, body]);

// 1. A real facility: an administrator registers, adds a location and a customer (no password).
const suffix = randomBytes(4).toString("hex");
const admin = await context();
await admin.page.goto(base + "/");
const adminEmail = `owner-${suffix}@example.test`;
const customerEmail = `mina-${suffix}@example.test`;
let r = await post(admin.page, "/platform/auth/register", { name: "Jiwoo Han", email: adminEmail, password: "correct horse battery", organization: "Seongsu Pilates" });
assert.equal(r.status, 200);
r = await post(admin.page, "/platform/save", { collection: "locations", item: { name: "Seongsu", rooms: [{ name: "AI Private Room 01", capacity: 1 }] } });
assert.equal(r.status, 200);
r = await post(admin.page, "/platform/people/save", { name: "Mina Park", email: customerEmail, roles: ["student"] });
assert.equal(r.status, 200);
const customerId = r.body.id;
r = await post(admin.page, "/platform/people/save", { id: customerId, name: "Mina Park", email: customerEmail, roles: ["student"], password: "staff-chosen-pass" });
assert.equal(r.status, 409); assert.equal(r.body.code, "customer_sets_password");
console.log("PASS the workspace refuses a staff-chosen customer password:", r.body.error);

// 2. The workspace person form: no password field for a customer, a plain note instead.
await admin.page.goto(base + "/workspace.html#page=clients");
await admin.page.getByRole("button", { name: "Edit profile" }).first().click();
const dialog = admin.page.locator("#modal");
await dialog.getByText("Customers choose their own password").waitFor();
assert.equal(await dialog.locator("[data-staff-password]").isHidden(), true);
await shot(admin.page, "01-workspace-customer-form");
// Turning the account into a coach-only account brings the field back.
await dialog.getByLabel("student", { exact: true }).uncheck();
await dialog.getByLabel("coach", { exact: true }).check();
assert.equal(await dialog.locator("[data-staff-password]").isVisible(), true);
await dialog.getByRole("button", { name: "Cancel" }).click();
console.log("PASS workspace form hides the password for customers, shows it for staff");

// 3. The SEDENS facility console: Customer sign-in, create the link once.
await admin.page.goto(base + "/#/facility");
await admin.page.getByRole("heading", { name: "Customer sign-in" }).waitFor();
await admin.page.getByRole("button", { name: "Create sign-in link · Mina Park" }).click();
const linkField = admin.page.locator("#customer-link");
await linkField.waitFor();
const link = await linkField.inputValue();
assert.match(link, /\/#\/account\/setup\?token=[A-Za-z0-9_-]{43}$/);
await admin.page.locator("#customer-signin").scrollIntoViewIfNeeded();
await part(admin.page.locator("#customer-signin"), "02-facility-sign-in-link");
await admin.page.getByRole("button", { name: "Copy link" }).click();
console.log("PASS facility console created a one-time link and shows it once");
// Reloading never shows the link again.
await admin.page.reload();
await admin.page.getByRole("heading", { name: "Customer sign-in" }).waitFor();
await admin.page.getByText(/Link open until/).waitFor();
assert.equal(await admin.page.locator("#customer-link").count(), 0);
console.log("PASS after a reload only the expiry is shown, never the link");

// Phone layout of the panel, Korean.
const adminPhone = await context(PHONE, "ko");
await adminPhone.ctx.addCookies((await admin.ctx.cookies()).filter((c) => c.name === "motion_session"));
await adminPhone.page.goto(base + "/#/facility");
await adminPhone.page.getByRole("heading", { name: "고객 로그인" }).waitFor();
await adminPhone.page.locator("#customer-signin").scrollIntoViewIfNeeded();
await part(adminPhone.page.locator("#customer-signin"), "03-facility-panel-phone-ko");
const overflow = await adminPhone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
assert.equal(overflow, false, "no sideways scrolling on a phone");

// 4. The customer opens the link on their phone and chooses a password.
const customer = await context(PHONE, "ko");
const requests = [];
customer.page.on("request", (req) => requests.push(req.url()));
await customer.page.goto(link);
await customer.page.getByRole("heading", { name: "비밀번호 정하기" }).waitFor();
assert.ok(!customer.page.url().includes("token="), "the token is removed from the address bar");
await shot(customer.page, "04-setup-phone-ko", true);
await customer.page.getByLabel("새 비밀번호").fill("seongsu morning walk");
await customer.page.getByLabel("한 번 더 입력").fill("seongsu morning wall");
await customer.page.getByRole("button", { name: "비밀번호 저장" }).click();
await customer.page.getByText("두 비밀번호가 달라요").waitFor();
await customer.page.getByLabel("한 번 더 입력").fill("seongsu morning walk");
await customer.page.getByRole("button", { name: "비밀번호 저장" }).click();
await customer.page.getByRole("heading", { name: "비밀번호를 저장했어요" }).waitFor();
await shot(customer.page, "05-setup-done-phone-ko", true);
assert.ok(requests.every((u) => !u.includes("token=")), "the token is never in a request URL");
console.log("PASS customer chose a password; the token never appeared in a request URL");

// The same link again is refused with the plain message.
const again = await context(PHONE, "en");
await again.page.goto(link);
await again.page.getByLabel("New password").fill("another long password");
await again.page.getByLabel("Type it again").fill("another long password");
await again.page.getByRole("button", { name: "Save my password" }).click();
await again.page.getByText("This sign-in link can no longer be used").waitFor();
await shot(again.page, "06-link-used-phone-en");
console.log("PASS a used link is refused");

// 5. The customer signs in and sees their sign-in activity in the Passport.
await customer.page.goto(base + "/");
await customer.page.locator("#signin [name=email]").fill(customerEmail);
await customer.page.locator("#signin [name=password]").fill("seongsu morning walk");
await customer.page.locator("#signin button").click();
// Signed in. On a phone the name and "Sign out" sit behind the header's account button (Phase 4 header), so the
// button is the sign that the sign-in worked; open it and "Sign out" is there.
await customer.page.locator("[data-account]").waitFor();
await customer.page.locator("[data-account]").click();
await customer.page.locator("[data-signout]").waitFor();
await customer.page.goto(base + "/#/passport/privacy");
await customer.page.getByRole("heading", { name: "로그인 기록" }).waitFor();
const activity = customer.page.locator('section[aria-labelledby="pp-activity-h"]');
await activity.scrollIntoViewIfNeeded();
await part(activity, "07-passport-sign-in-activity-ko");
const text = await activity.textContent();
assert.match(text, /Jiwoo Han 님이 로그인 링크를 만들었어요/);
assert.match(text, /로그인 링크로 새 비밀번호가 정해졌어요/);
assert.match(text, /모든 기기에서 로그아웃되었어요/);
assert.match(text, /비밀번호를 정하려고 했지만 허용되지 않았어요/);
console.log("PASS Passport privacy shows sign-in activity in Korean");

// English layout of the same section.
await customer.page.locator("[data-lang]").click();
await customer.page.getByRole("heading", { name: "Sign-in activity" }).waitFor();
await part(customer.page.locator('section[aria-labelledby="pp-activity-h"]'), "08-passport-sign-in-activity-en");

// 6. The administrator cannot read the customer's activity.
r = await admin.page.evaluate(async () => (await fetch("/sedens/passport/account-activity")).status);
assert.equal(r, 403);
console.log("PASS staff cannot read a customer's sign-in activity");

assert.deepEqual(errors, []);
console.log("0 page errors");
await browser.close();
