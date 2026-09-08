import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.css':'text/css'};
const server=createServer(async(req,res)=>{let p=normalize(decodeURI(req.url.split('?')[0]));if(p==='/')p='/index.html';
 try{const b=await readFile(join(ROOT,p));res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404).end('x');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const page=await browser.newPage({viewport:{width:1200,height:900}});
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push(m.text());});
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction('document.body.classList.contains("ready")',null,{timeout:180000});
await page.waitForTimeout(9000);
await page.evaluate(async () => {
  const m = await import('/src/main.js');
  m.setRotate(false);
  for (const l of ['muscles_superficial','muscles_deep','skeleton']) await m.setLayer(l, true);
});
await page.waitForTimeout(5000);
const ink = () => page.evaluate(() => {
  const c = document.getElementById('view');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  return { w: c.width, h: c.height };
});
for (const v of [0, 0.35, 1]) {
  await page.evaluate(async (x) => { (await import('/src/main.js')).setExplode(x); }, v);
  await page.waitForTimeout(5000);
  await page.locator('#stage').screenshot({ path: join(OUT, `explode-${String(v).replace('.','_')}.png`), timeout: 90000 });
  console.log('shot', v, JSON.stringify(await ink()));
}
const st = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  return { explode: m.app.explode, pickOff: m.pickAt(600, 450) };
});
console.log('state:', JSON.stringify(st));
console.log('errors:', errs.length, errs.slice(0,3));
await browser.close(); server.close();
