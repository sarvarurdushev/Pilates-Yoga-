import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
const ROOT = '/home/user/Neuro_Wellness/';
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.css':'text/css' };
const server = createServer(async (req,res)=>{let p=normalize(decodeURI(req.url.split('?')[0]));if(p==='/')p='/index.html';
 try{const b=await readFile(join(ROOT,p));res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});res.end(b)}catch{res.writeHead(404).end('x')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const page = await browser.newPage({viewport:{width:800,height:600}});
const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction('document.body.classList.contains("ready")',null,{timeout:120000});
const out = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const THREE = await import('three');
  await m.setLayer('brain', true);
  await m.setLayer('organs', true);
  await m.setExercise('phalakasana');
  m.setShowMeshes(true);
  m.poseFromClip(0.5);
  const report = { skinning: m.app.skinning, brainCentre: !!m.app.brainCentre };
  // how far each visible muscle mesh's centroid is from the bone it is bound to
  const far = [];
  let skinned = 0, rigid = 0;
  m.rig.root.parent.traverse(o => {
    if (!o.isMesh || !String(o.userData.layer||'').startsWith('muscles')) return;
    o.isSkinnedMesh ? skinned++ : rigid++;
    o.geometry.computeBoundingSphere();
    const r = o.geometry.boundingSphere.radius;
    if (r > 0.35) far.push([o.name, +r.toFixed(2)]);
  });
  report.skinnedMeshes = skinned; report.rigidMeshes = rigid;
  report.oversizedAfterPose = far.slice(0, 8);
  // where the brain group sits versus the skull
  const skull = m.rig.nodes.get('skull');
  const s = new THREE.Vector3().setFromMatrixPosition(skull.body.matrixWorld);
  let brainPos = null;
  m.rig.root.parent.traverse(o => {
    if (o.userData.layer === 'brain' && o.type === 'Group' && !brainPos)
      brainPos = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  });
  report.skull = s.toArray().map(v=>+v.toFixed(3));
  report.brainGroup = brainPos ? brainPos.toArray().map(v=>+v.toFixed(3)) : null;
  report.brainToSkull = brainPos ? +brainPos.distanceTo(s).toFixed(3) : null;
  return report;
});
console.log(JSON.stringify(out, null, 1));
console.log('errors:', errs.length, errs.slice(0,3));
await browser.close(); server.close();
