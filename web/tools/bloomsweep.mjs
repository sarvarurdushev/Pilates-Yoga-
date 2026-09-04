/**
 * How much bloom this scene takes before it destroys its own subject.
 *
 * The bloom pass runs after the ACES pass — `UnrealBloomPass` blanks the buffer unless it is
 * last — so its threshold is read against tone-mapped, already-compressed values rather than
 * against scene radiance. Picked as if it were scene radiance, the threshold sat far below the
 * cortex's own brightness, and since an additive volume is brightest where it is deepest, the
 * whole core summed past white and drew as a flat hole in the middle of the brain. It looks
 * like a lighting choice, which is why it needs measuring rather than looking at.
 *
 * Renders one frame of the brain at each setting and counts pixels clipped to pure white
 * against pixels lit at all. `clipped: 0` is the bar. `meanLit` is the other half of the
 * reading: a setting that clips nothing because it glows nothing is not the answer, so take
 * the strongest row that still clips zero.
 *
 *   node tools/bloomsweep.mjs        # or: npm run bloomsweep
 *
 * Needs a browser that will finish the frame. Under SwiftShader each setting takes about a
 * minute, which is why the waits are long; on a real GPU they are wasted but harmless.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
const ROOT = new URL('..', import.meta.url).pathname;
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.glb':'model/gltf-binary'};
const say = m => console.log(m);
const server=createServer(async(q,r)=>{let p=normalize(decodeURI(q.url.split('?')[0]));if(p==='/')p='/index.html';
 try{const b=await readFile(join(ROOT,p));r.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});r.end(b);}catch{r.writeHead(404).end('nf');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox']});
const page=await b.newPage({viewport:{width:1100,height:760}});
page.on('pageerror',e=>say('PAGEERROR '+e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`,{timeout:120000});
await page.waitForFunction('document.body.classList.contains("ready")',null,{timeout:180000});
await page.evaluate(async()=>{const m=await import('/src/main.js');
  m.app.rotate=false;
  for(const l of ['organs','muscles_superficial','muscles_deep','nervous','skeleton']) await m.setLayer(l,false);
  await m.setLayer('brain',true); m.setView('head',true);});
await page.waitForTimeout(20000);
await page.evaluate(async()=>{const m=await import('/src/main.js'); m.rebuildComposer(true);});

/* Read the framebuffer straight out of the canvas: preserveDrawingBuffer is not set, so this
 * copies the canvas into a 2D context on the same frame instead. */
const stats = async () => await page.evaluate(async () => {
  const c = document.querySelector('#stage canvas');
  const off = document.createElement('canvas'); off.width = c.width; off.height = c.height;
  off.getContext('2d').drawImage(c, 0, 0);
  const d = off.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let clipped = 0, lit = 0, sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], bl = d[i+2];
    const v = Math.max(r, g, bl);
    if (v > 30) { lit++; sum += v; }
    if (r > 250 && g > 250 && bl > 250) clipped++;
    n++;
  }
  return { clipped, lit, meanLit: lit ? +(sum / lit).toFixed(1) : 0,
           clippedPctOfLit: lit ? +(100 * clipped / lit).toFixed(2) : 0 };
});

const set = async (s, r, t) => await page.evaluate(async ([s, r, t]) => {
  const m = await import('/src/main.js');
  const p = m.gfx.bloomPass; if (!p) return 'no pass';
  p.strength = s; p.radius = r; p.threshold = t; return 'ok';
}, [s, r, t]);

for (const [s, r, t] of [[0.62,0.72,0.62],[0.45,0.65,0.80],[0.34,0.60,0.88],[0.24,0.55,0.93]]) {
  await set(s, r, t);
  await page.waitForTimeout(55000);
  say(`strength=${s} radius=${r} threshold=${t} -> ${JSON.stringify(await stats())}`);
  await page.screenshot({path:`${ROOT}.render/bloom-${s}-${t}.png`,timeout:180000});
}
await b.close(); server.close();
