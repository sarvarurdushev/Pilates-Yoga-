/** Local end-to-end route check against a running `python -m pilates web` server.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8144 CHROMIUM=/path/to/chrome \
 *   node test/platform-routing.browser.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8144";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function me() {
  return page.evaluate(async () => {
    const response = await fetch("/platform/me", { credentials: "same-origin" });
    if (!response.ok) throw Error(`Profile request failed: ${response.status}`);
    return response.json();
  });
}

async function openAndRefresh(hash, client, heading) {
  const waitForContent = async () => page.waitForFunction((expected) => {
    const content = document.querySelector("#page-content");
    return Boolean(content && !content.querySelector(".loading") &&
      !content.textContent.includes("This view could not open") &&
      content.querySelector(".page-head h1")?.textContent?.includes(expected));
  }, heading, { timeout: 60000 });
  await page.goto(`${base}/workspace.html${hash}`);
  await page.locator(`.client-context[aria-label="${client.name} workspace"]`).waitFor({ timeout: 60000 });
  await waitForContent();
  await page.reload();
  await page.locator(`.client-context[aria-label="${client.name} workspace"]`).waitFor({ timeout: 60000 });
  await waitForContent();
  const route = new URL(page.url()).hash;
  assert.equal(new URLSearchParams(route.slice(1)).get("client"), client.id);
  const home = page.locator(".client-return");
  await home.waitFor();
  assert.equal(new URLSearchParams((await home.getAttribute("href")).slice(1)).get("client"), client.id);
  await home.click();
  await page.locator(`.client-context[aria-label="${client.name} workspace"]`).waitFor();
  await page.waitForFunction((id) => {
    const route = new URLSearchParams(location.hash.slice(1));
    return route.get("page") === "client" && route.get("tab") === "overview" && route.get("client") === id;
  }, client.id);
}

try {
  await page.goto(`${base}/workspace.html`);
  if (process.env.MOTION_DEMO_KEY) {
    await page.evaluate((key) => sessionStorage.setItem("motion-demo-key", key),
      process.env.MOTION_DEMO_KEY);
  }
  await page.getByRole("button", { name: "Explore as admin" }).click();
  await page.locator("#demo-role").waitFor({ timeout: 180000 });
  let profile = await me();
  const client = profile.students.find((student) => student.name === "Sarah Kim") || profile.students[0];
  const other = profile.students.find((student) => student.id !== client.id);
  assert.ok(client && other, "demo must contain two distinct clients");
  await openAndRefresh(`#page=client&client=${client.id}&tab=sessions`, client, "Client sessions");
  console.log(`Admin session deep link, refresh and return: ${client.id}`);

  await page.locator("#demo-role").selectOption("coach");
  await page.waitForFunction(() => document.querySelector("#demo-role")?.value === "coach" &&
    document.querySelector(".page-head")?.textContent?.toLowerCase().includes("coaching"),
    null, { timeout: 180000 });
  profile = await me();
  const coachClient = profile.students.find((student) => student.id === client.id) || profile.students[0];
  assert.ok(coachClient, "coach must have an assigned client");
  await openAndRefresh(`#page=client&client=${coachClient.id}&tab=notes&region=right_shoulder`, coachClient, "coach feedback");
  console.log(`Coach feedback deep link, refresh and return: ${coachClient.id}`);

  await page.locator("#demo-role").selectOption("student");
  await page.waitForFunction(() => document.querySelector("#demo-role")?.value === "student" &&
    document.querySelector(".page-head")?.textContent?.includes("Your practice"),
    null, { timeout: 180000 });
  profile = await me();
  const own = profile.students.find((student) => student.id === profile.user.id);
  assert.ok(own, "student profile must contain its own client");
  await openAndRefresh(`#page=client&client=${own.id}&tab=programs`, own, "Your current program");
  console.log(`Student program deep link, refresh and return: ${own.id}`);

  // A shared URL naming another client must become the student's own URL too.
  await page.goto(`${base}/workspace.html#page=client&client=${other.id}&tab=notes`);
  await page.locator(`.client-context[aria-label="${own.name} workspace"]`).waitFor({ timeout: 60000 });
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("client"), own.id);
  const noteLinks = await page.locator('.client-context a[href*="client="]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")));
  assert.ok(noteLinks.length);
  assert.ok(noteLinks.every((link) => new URLSearchParams(link.slice(1)).get("client") === own.id));
  await page.reload();
  await page.locator(`.client-context[aria-label="${own.name} workspace"]`).waitFor({ timeout: 60000 });
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("client"), own.id);
  console.log("Student foreign-client copied link normalized before and after refresh");

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
