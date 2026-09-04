/** Screenshot a local HTML file, for looking at the pose sheet. */
import { chromium } from 'playwright';
const [, , file, out, width = '1200'] = process.argv;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: +width, height: 900 }, deviceScaleFactor: 1 });
await p.goto('file://' + file);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
