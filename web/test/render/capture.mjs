/**
 * Renders every harness scenario in headless Chromium and writes raw RGBA buffers.
 *
 * Raw buffers rather than PNGs so the comparison needs no image decoder: two runs of
 * the same scene must produce byte-identical output, and where they do not, the diff
 * is countable per channel.
 *
 * Usage: node test/render/capture.mjs <outdir>
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = process.argv[2];
if (!OUT) { console.error('usage: capture.mjs <outdir>'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.json':'application/json', '.glb':'model/gltf-binary', '.css':'text/css' };

const server = createServer(async (req, res) => {
  const path = join(ROOT, normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  // swiftshader rather than a real GPU: software rasterisation is what makes two runs
  // byte-comparable. --deterministic-mode is deliberately absent; it stalls WebGL init here.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', m => { if (m.type() === 'error') console.error('  [page]', m.text()); });
page.on('pageerror', e => console.error('  [page]', e.message));

await page.goto(`http://127.0.0.1:${port}/test/render/harness.html`);
await page.waitForFunction('window.__ready === true || window.__error', null, { timeout: 120000 });
const err = await page.evaluate('window.__error');
if (err) { console.error('load failed:', err); process.exit(1); }

const ids = await page.evaluate('window.__ids');
console.log('region ids in cortex:', ids.join(', '));

const names = await page.evaluate('window.__names');
for (const name of names) {
  const { w, h, b64, png } = await page.evaluate(n => window.__shot(n), name);
  writeFileSync(join(OUT, `${name}.bin`), Buffer.from(b64, 'base64'));
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  console.log(`  ${name}  ${w}x${h}`);
}

await browser.close();
server.close();
