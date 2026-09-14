/**
 * Photograph a rendered report, whole or one panel of it.
 *
 *   node tools/shot.mjs posture en                 # the whole page
 *   node tools/shot.mjs posture en .ss-summary     # one panel
 *
 * $CHROMIUM points at a browser already on the machine, for the same reason
 * test/smoke.mjs takes one: Playwright resolves its browser by a build number
 * pinned to the npm package, and a machine that ships a different build fails
 * at launch for a render that would have worked against the browser on disk.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER = join(dirname(fileURLToPath(import.meta.url)), '..', '.render');
const [page = 'posture', lang = 'en', panel] = process.argv.slice(2);

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-gpu'],
});
const tab = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await tab.goto(`file://${join(RENDER, `${page}-${lang}.html`)}`);
/* Fonts and layout, not animation: nothing here moves. */
await tab.waitForTimeout(350);

const name = panel ? `${page}-${lang}-panel.png` : `${page}-${lang}.png`;
const target = panel ? await tab.$(panel) : tab;
if (!target) {
  console.error(`nothing matches ${panel}`);
  process.exit(1);
}
await target.screenshot({ path: join(RENDER, name),
                          ...(panel ? {} : { fullPage: true }) });
console.log(`wrote .render/${name}`);
await browser.close();
