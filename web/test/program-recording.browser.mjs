/**
 * Local, disposable acceptance of the Coach camera → saved program → Student video.
 * Run against a separate `python -m pilates web` server and empty test database:
 * MOTION_BASE_URL=http://127.0.0.1:8149 CHROMIUM=/path/to/chrome \
 *   node test/program-recording.browser.mjs
 *
 * Chromium's native fake video device emits an animated synthetic test pattern.
 * getUserMedia, MediaRecorder, File, upload and playback are NOT mocked. This proves
 * browser wiring and decoding, not physical camera access or an exercise recording.
 * The program anatomy disclosure stays closed, so this test never loads WebGL.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.MOTION_BASE_URL || 'http://127.0.0.1:8149';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname),
  'Run this mutating acceptance only against a disposable local workspace.');
const key = process.env.MOTION_DEMO_KEY || randomBytes(16).toString('hex');
const caption = 'Synthetic Chromium camera test pattern — browser wiring acceptance';
const rationale = 'Synthetic acceptance rationale: this client-specific reason must appear before the general movement purpose.';
const genericPurpose = 'Generic movement purpose for the acceptance fixture.';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({viewport: {width: 1400, height: 1000}, permissions: ['camera']});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const report = {fixture: 'Chromium native fake video device: animated synthetic test pattern', base};
const info = async (path) => page.evaluate(async path => {
  const response = await fetch(path, {credentials: 'same-origin'});
  if (!response.ok) throw new Error(`${path} returned ${response.status()}`);
  return response.json();
}, path);
const noAtlas = async () => {
  assert.ok((await page.locator('.pd-atlas').evaluateAll(frames => frames.map(frame => frame.getAttribute('src'))))
    .every(src => !src || src === 'about:blank'), 'Camera acceptance must not load the anatomy atlas.');
};

try {
  await page.goto(base + '/workspace.html');
  await page.evaluate(value => sessionStorage.setItem('motion-demo-key', value), key);
  await page.getByRole('button', {name: 'Explore as coach', exact: true}).click();
  await page.getByRole('heading', {name: 'Your coaching day', exact: true}).waitFor({timeout: 180000});
  const profile = await info('/platform/me');
  assert.equal(profile.role, 'coach');
  const client = profile.students.find(student => student.name === 'Sarah Kim') || profile.students[0];
  assert.ok(client, 'The Coach needs an assigned disposable client.');
  const clientData = await info('/platform/client?id=' + encodeURIComponent(client.id));
  const assignment = clientData.programs.find(item => item.active) || clientData.programs[0];
  assert.ok(assignment?.program_id, 'The disposable client needs an assigned program.');
  const programId = assignment.program_id;
  report.client = client.id;
  report.program = programId;
  const route = base + '/workspace.html#' + new URLSearchParams({page: 'program', id: programId, client: client.id});
  await page.goto(route);
  await page.getByRole('button', {name: 'Edit program', exact: true}).click();
  const card = page.locator('.pd-edit-step:not(.pd-edit-note)').first();
  await card.waitFor({state: 'attached'});
  const movementName = await card.locator('.pd-edit-step-head strong').innerText();
  await card.getByText('Configure movement', {exact: true}).click();
  await card.locator('[name=why_assigned]').fill(rationale);
  await card.getByText('Advanced coaching details', {exact: true}).click();
  await card.locator('[name=purpose]').fill(genericPurpose);
  await card.getByText('Photos, videos and references', {exact: true}).click();
  await noAtlas();
  const nativeAPIs = await page.evaluate(() => ({
    getUserMedia: /\[native code\]/.test(Function.prototype.toString.call(navigator.mediaDevices.getUserMedia)),
    MediaRecorder: /\[native code\]/.test(Function.prototype.toString.call(MediaRecorder)),
    File: /\[native code\]/.test(Function.prototype.toString.call(File)),
  }));
  assert.ok(Object.values(nativeAPIs).every(Boolean), 'Acceptance must use native media APIs.');
  report.nativeAPIs = nativeAPIs;
  await card.getByRole('button', {name: 'Record a short coach demonstration', exact: true}).click();
  await card.locator('.pd-record-status').getByText('Camera ready. Start when the movement is in frame.', {exact: true}).waitFor({timeout: 30000});
  const preview = card.locator('.pd-recorder video');
  await page.waitForFunction(() => {
    const video = document.querySelector('.pd-recorder:not([hidden]) video');
    return video?.srcObject?.getVideoTracks().length === 1 && video.readyState >= 2 && video.videoWidth > 0;
  }, null, {timeout: 30000});
  const track = await preview.evaluateHandle(video => video.srcObject.getVideoTracks()[0]);
  report.preview = await preview.evaluate(video => ({width: video.videoWidth, height: video.videoHeight,
    readyState: video.readyState, trackState: video.srcObject.getVideoTracks()[0].readyState}));
  assert.equal(report.preview.trackState, 'live');
  await card.getByRole('button', {name: 'Start recording', exact: true}).click();
  await page.waitForFunction(() => /Recording [3-9] of 45 seconds/.test(document.querySelector('.pd-recorder:not([hidden]) .pd-record-status')?.textContent || ''), null, {timeout: 15000});
  await card.getByRole('button', {name: 'Stop and use clip', exact: true}).click();
  await card.locator('.pd-pending-item video').waitFor({timeout: 30000});
  assert.equal(await track.evaluate(value => value.readyState), 'ended', 'Stopping must release the actual native camera track.');
  assert.equal(await preview.evaluate(video => video.srcObject), null, 'Preview must detach the released stream.');
  await track.dispose();
  await card.locator('[name=pending_caption]').fill(caption);
  assert.equal(await card.locator('[name=pending_primary]').isChecked(), true);
  report.queued = await card.locator('.pd-pending-item').innerText();
  await page.locator('[name=change_reason]').fill('Disposable native synthetic-camera recording acceptance');
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/platform/save') &&
    response.request().postDataJSON()?.collection === 'programs');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  const saved = await savedResponse;
  assert.equal(saved.status(), 200, await saved.text());
  const savedProgram = await saved.json();
  await page.locator('dialog').waitFor({state: 'hidden', timeout: 60000});
  const savedStep = savedProgram.steps.find(step => step.detail?.media?.some(media => media.caption === caption));
  assert.ok(savedStep, 'The saved program must contain the recorded clip.');
  const mediaEntry = savedStep.detail.media.find(media => media.caption === caption);
  assert.equal(mediaEntry.kind, 'coach_demonstration');
  assert.equal(mediaEntry.primary, true);
  assert.equal(mediaEntry.visibility, 'student');
  assert.equal(savedStep.detail.why_assigned, rationale);
  assert.equal(savedStep.detail.purpose, genericPurpose);
  const media = await info('/platform/record?' + new URLSearchParams({collection: 'media', id: mediaEntry.media_id}));
  assert.match(media.mime, /^video\/(webm|mp4)$/);
  assert.ok(media.size > 0 && media.size < 64 * 1024 * 1024);
  assert.match(media.filename, /^coach-demonstration-.*\.(webm|mp4)$/);
  report.saved = {media: media.id, mime: media.mime, bytes: media.size, filename: media.filename,
    version: savedProgram.version, primary: mediaEntry.primary, visibility: mediaEntry.visibility};
  const studentLogin = page.waitForResponse(response => response.url().endsWith('/platform/auth/demo') &&
    response.request().postDataJSON()?.role === 'student');
  await page.locator('#demo-role').selectOption('student');
  assert.equal((await (await studentLogin).json()).role, 'student');
  await page.getByRole('heading', {name: 'Your practice, today', exact: true}).waitFor({timeout: 60000});
  const student = await info('/platform/me');
  assert.equal(student.user.id, client.id, 'The native recording must be reviewed by its assigned Student.');
  await page.goto(route);
  await page.reload();
  const practiceCard = page.locator('.pd-practice-card').filter({hasText: movementName}).first();
  const figure = practiceCard.locator('.pd-media').filter({hasText: caption});
  await figure.waitFor({state: 'visible', timeout: 60000});
  await figure.scrollIntoViewIfNeeded();
  assert.equal(await practiceCard.locator('.pd-why').innerText(), 'Why this movement? ' + rationale,
    'The actual saved client rationale must be visible instead of the generic purpose.');
  assert.equal(await figure.locator('.pd-media-badge').innerText(), 'Primary demonstration · Coach demonstration');
  const recordedVideo = figure.locator('video');
  assert.equal(await recordedVideo.getAttribute('src'), '/platform/media?id=' + encodeURIComponent(media.id));
  await page.waitForFunction(id => {
    const video = document.querySelector(`video[src="/platform/media?id=${id}"]`);
    return video?.readyState >= 2 && video.videoWidth > 0;
  }, media.id, {timeout: 30000});
  const playbackStart = await recordedVideo.evaluate(async video => {
    await video.play();
    return video.currentTime;
  });
  await page.waitForFunction(({id, from}) => {
    const video = document.querySelector(`video[src="/platform/media?id=${id}"]`);
    return video && video.currentTime > from + 0.4 && !video.error;
  }, {id: media.id, from: playbackStart}, {timeout: 15000});
  report.studentPlayback = await recordedVideo.evaluate(video => ({
    width: video.videoWidth, height: video.videoHeight, readyState: video.readyState,
    currentTime: video.currentTime, paused: video.paused, error: video.error?.message || null,
  }));
  assert.equal(report.studentPlayback.error, null);
  if (process.env.MOTION_SCREENSHOT) await page.screenshot({path: process.env.MOTION_SCREENSHOT});
  await recordedVideo.evaluate(video => video.pause());
  await noAtlas();
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
  report.result = 'PASS: native synthetic camera recording, released track, persisted clip and Student playback after reload';
  console.log(JSON.stringify(report, null, 2));
  if (process.env.MOTION_REPORT) await writeFile(process.env.MOTION_REPORT, JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  console.error('FAIL:', error.stack);
  process.exitCode = 1;
} finally {
  await browser.close();
}
