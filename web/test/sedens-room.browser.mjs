/** Local end-to-end check of the SEDENS home, legacy redirect and room screen.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8145 CHROMIUM=/path/to/chrome \
 *   [SEDENS_SHOTS=/path/to/folder] node test/sedens-room.browser.mjs
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8145";
const shots = process.env.SEDENS_SHOTS || "";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
const errors = [];
async function context(viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("sedens-lang", "en"));
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { ctx, page };
}
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

// 1. Home and legacy links
const { page } = await context();
await page.goto(base + "/");
await page.getByRole("link", { name: "Enter AI Private Room" }).waitFor();
assert.match(await page.textContent("body"), /does not diagnose or treat/);
await shot(page, "01-home");
for (const legacy of ["/index.html#page=dashboard", "/#home", "/index.html?reset=abc"]) {
  await page.goto(base + legacy);
  await page.waitForURL(/\/workspace\.html/);
  assert.ok(page.url().endsWith(legacy.replace(/^\/(index\.html)?/, "")), page.url());
}
console.log("PASS home renders; legacy #page=, #home and ?reset= links open /workspace.html unchanged");

// 2. Demonstration room on a simulated screen
const key = randomBytes(16).toString("hex");
const room = await context({ width: 1920, height: 1080 });
await room.page.goto(base + "/room.html");
await room.page.evaluate((k) => sessionStorage.setItem("motion-demo-key", k), key);
await room.page.getByRole("heading", { name: "This screen is not a SEDENS room yet" }).waitFor();
await shot(room.page, "02-room-unpaired");
await room.page.getByRole("button", { name: "Use a demonstration room (simulated)" }).click();
await room.page.getByRole("heading", { name: "Welcome to AI Private Room 01" }).waitFor({ timeout: 180000 });
assert.match(await room.page.textContent("body"), /SIMULATED/);
await shot(room.page, "03-room-entry");
await room.page.getByRole("button", { name: /DEMO-1002/ }).click();
await room.page.getByText("There is no booking for this room right now.").waitFor();
await room.page.getByRole("button", { name: /DEMO-1001/ }).click();
await room.page.getByRole("heading", { name: /Hello, Sarah/ }).waitFor();
assert.match(await room.page.textContent("body"), /199 exercises are available in this room/);
await shot(room.page, "04-room-session");
await room.page.getByRole("button", { name: "End session" }).click();
await room.page.getByText("Session ended. Thank you.").waitFor();
console.log("PASS simulated demo room: denied without booking, entered with booking, room-only library, ended");

// 2b. The customer's own phone issues a single-use room code; the shared screen never signs anyone in.
const phone = await context({ width: 390, height: 844 });
await phone.page.goto(base + "/");
await phone.page.evaluate((k) => sessionStorage.setItem("motion-demo-key", k), key);
await phone.page.getByRole("button", { name: "Customer" }).click();
await phone.page.getByRole("button", { name: "Get a room code" }).click();
const roomCode = (await phone.page.locator("#room-code .sd-code").textContent()).trim();
assert.match(roomCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
await shot(phone.page, "04b-phone-room-code");
await room.page.fill("[name=credential]", roomCode);
await room.page.getByRole("button", { name: "Enter", exact: true }).click();
await room.page.getByRole("heading", { name: /Hello, Sarah/ }).waitFor();
const screenCookies = await room.ctx.cookies();
assert.ok(!screenCookies.some((c) => c.name === "motion_session"), "the shared screen must hold no account sign-in");
await room.page.getByRole("button", { name: "End session" }).click();
await room.page.getByText("Session ended. Thank you.").waitFor();
await room.page.fill("[name=credential]", roomCode);
await room.page.getByRole("button", { name: "Enter", exact: true }).click();
await room.page.getByText("This room code is not valid. Ask for a new code on your phone.").waitFor();
console.log("PASS room code from the customer's phone: entered once, single use, no sign-in left on the screen");

// 3. Real pairing protocol: the screen shows a code, the facility admin confirms it.
const screen = await context({ width: 1920, height: 1080 });
await screen.page.goto(base + "/room.html");
await screen.page.getByRole("button", { name: "Show pairing code" }).click();
const code = (await screen.page.locator(".sd-code").textContent()).trim();
assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
await shot(screen.page, "05-pairing-code");

// A demonstration admin (anonymous) must not be able to claim a real screen.
const demoAdmin = await context();
await demoAdmin.page.goto(base + "/");
await demoAdmin.page.evaluate((k) => sessionStorage.setItem("motion-demo-key", k), key);
await demoAdmin.page.getByRole("button", { name: "Facility admin" }).click();
await demoAdmin.page.getByRole("heading", { name: "Facility console" }).waitFor({ timeout: 180000 });
await demoAdmin.page.fill("[name=code]", code);
await demoAdmin.page.getByRole("button", { name: "Pair screen" }).click();
await demoAdmin.page.getByText("Demonstration facilities use simulated room screens").waitFor();
console.log("PASS a demonstration admin cannot claim a real screen's pairing code");

// A real facility: register through the existing platform, add a room, then pair.
const admin = await context();
await admin.page.goto(base + "/");
const email = `owner-${key.slice(0, 8)}@example.test`;
await admin.page.evaluate(async (email) => {
  const post = (path, body) => fetch(path, { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Platform-Request": "1" }, body: JSON.stringify(body) })
    .then(async (r) => { if (!r.ok) throw Error(await r.text()); return r.json(); });
  await post("/platform/auth/register", { name: "Owner", email, password: "correct horse battery", organization: "Real Gym" });
  await post("/platform/save", { collection: "locations", item: { name: "Gangnam", rooms: [{ name: "AI Private Room 01", capacity: 1 }] } });
}, email);
await admin.page.goto(base + "/#/facility");
await admin.page.getByRole("heading", { name: "Facility console" }).waitFor();
await admin.page.fill("[name=code]", code);
await admin.page.selectOption("[name=room_id]", { label: "AI Private Room 01 · Gangnam" });
await admin.page.fill("[name=name]", "Room 01 TV");
await admin.page.getByRole("button", { name: "Pair screen" }).click();
await admin.page.getByText("Room 01 TV").waitFor();
await shot(admin.page, "06-facility-console");
await screen.page.getByRole("heading", { name: "Welcome to AI Private Room 01" }).waitFor({ timeout: 20000 });
assert.match(await screen.page.textContent("body"), /Real Gym · Gangnam/);
console.log("PASS pairing: code on the room screen, confirmed by the facility admin, screen became a room");

// 4. The paired screen still refuses the engine without a customer room session.
const status = await screen.page.evaluate(async () => (await fetch("/sedens/room/library")).status);
assert.equal(status, 401);
console.log("PASS paired screen without a room session cannot open the room library");

assert.deepEqual(errors, []);
await browser.close();
console.log("0 page errors");
