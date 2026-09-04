/**
 * Drives the real app through a list of exercises and screenshots each one.
 *
 * The stick-figure sheet checks the rig. This checks everything downstream of it — whether
 * the meshes, the organs and the brain actually follow the skeleton, which is a different
 * question and the one that was wrong.
 *
 * Usage: node tools/appshots.mjs [outdir] [key,key,...]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = process.argv[2] || join(ROOT, '.render', 'app');
const KEYS = (process.argv[3] || 'hundred,phalakasana,adhoMukhaSvanasana,trikonasana,setuBandha,sideKickUpDown,balasana,sirsasana')
  .split(',');
/** Which layers to show, so a shot can isolate one instead of stacking all five. */
const LAYERS = (process.argv[4] || 'skeleton,muscles_superficial,muscles_deep,organs,brain').split(',');
const VIEW = process.argv[5] || 'lateral';
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.json': 'application/json', '.glb': 'model/gltf-binary', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURI(req.url.split('?')[0]));
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction('document.body.classList.contains("ready")', null, { timeout: 120000 });

// everything visible, labels off, so the picture is only the body
await page.evaluate(async () => {
  const m = await import('/src/main.js');
  m.setLabels(false);
  m.app.rotate = false;
  for (const l of ['skeleton', 'muscles_superficial', 'muscles_deep', 'organs', 'brain'])
    await m.setLayer(l, false);
});
await page.evaluate(async (want) => {
  const m = await import('/src/main.js');
  for (const l of want) await m.setLayer(l, true);
}, LAYERS);

for (const key of KEYS) {
  const info = await page.evaluate(async ([k, view, want]) => {
    const m = await import('/src/main.js');
    const THREE = await import('three');
    const dqs = await import('/src/dqs.js');
    // `rest` is the default pose with no exercise selected: the baseline every other
    // shot is judged against
    await m.setExercise(k === 'rest' ? null : k);
    for (const l of ['skeleton', 'muscles_superficial', 'muscles_deep', 'organs', 'brain'])
      await m.setLayer(l, want.includes(l));
    m.setShowMeshes(true);
    if (k !== 'rest') m.poseFromClip(0.5);
    m.setView(view, true);
    if (k !== 'rest') m.frameRig(true, true);

    // Does the brain ride the skull? It arrives in its own frame and is placed by a fitted
    // transform, which is right on a standing figure and nowhere at all once the head moves.
    const skull = new THREE.Vector3()
      .setFromMatrixPosition(m.rig.nodes.get('skull').body.matrixWorld);
    let brain = null;
    m.rig.root.parent.traverse(o => {
      if (o.userData.layer === 'brain' && o.isGroup && !brain)
        brain = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    });

    // Do the meshes still look like themselves? Deform every vertex the way the GPU would
    // and compare the result to the mesh at rest: a mesh whose weights drag it somewhere it
    // does not belong either grows or travels, and both are measurable.
    // the bones have moved; the dual quaternions have to be recomputed for *this* pose or
    // every measurement below describes the previous one
    m.rig.root.updateMatrixWorld(true);
    m.boneDQ?.update();
    let skinned = 0, rigid = 0;
    const bad = [];
    const box = new THREE.Box3(), sph = new THREE.Sphere();
    const acc = new THREE.Vector3(), tmp = new THREE.Vector3(), mat = new THREE.Matrix4();
    m.rig.root.parent.traverse(o => {
      if (!o.isMesh) return;
      const layer = String(o.userData.layer || '');
      if (!layer.startsWith('muscles') && layer !== 'skeleton' && layer !== 'organs'
          && layer !== 'nervous') return;
      o.isSkinnedMesh ? skinned++ : rigid++;
      const geo = o.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const rest = geo.boundingSphere.radius;
      box.makeEmpty();
      const pos = geo.getAttribute('position');
      const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
      const step = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += step) {
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (si && o.isSkinnedMesh) {
          // exactly what the GPU computes — using only the dominant bone hides precisely the
          // distortion this is looking for
          acc.copy(tmp);
          dqs.skinPoint(m.boneDQ.data,
            [si.getComponent(i, 0), si.getComponent(i, 1), si.getComponent(i, 2), si.getComponent(i, 3)],
            [sw.getComponent(i, 0), sw.getComponent(i, 1), sw.getComponent(i, 2), sw.getComponent(i, 3)],
            acc);
          box.expandByPoint(acc);
        } else {
          box.expandByPoint(tmp.clone().applyMatrix4(o.matrixWorld));
        }
      }
      if (box.isEmpty()) return;
      box.getBoundingSphere(sph);
      /* Growth of a bounding sphere does not see a *tear*. A mesh whose weights disagree
       * across a seam keeps roughly its extent and grows a sheet of long thin triangles out
       * of the gap — the "wings" that appear off a shoulder the moment the arm abducts. The
       * thing to measure is the edge: how much longer is a triangle's edge posed than it was
       * at rest. */
      let stretch = 1;
      const idx = geo.index;
      /* The same blend the GPU runs — dual quaternion, from src/dqs.js. Measuring linear
       * blend here while the shader blends dual quaternions would report a collapse that is
       * not on screen, which is worse than not measuring at all. */
      const deform = (i, out) => {
        out.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (!si || !o.isSkinnedMesh) return out.applyMatrix4(o.matrixWorld);
        return dqs.skinPoint(m.boneDQ.data,
          [si.getComponent(i, 0), si.getComponent(i, 1), si.getComponent(i, 2), si.getComponent(i, 3)],
          [sw.getComponent(i, 0), sw.getComponent(i, 1), sw.getComponent(i, 2), sw.getComponent(i, 3)],
          out);
      };
      if (idx) {
        const tris = idx.count / 3;
        const tstep = Math.max(1, Math.floor(tris / 4000));
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        const ra = new THREE.Vector3(), rb = new THREE.Vector3();
        for (let t = 0; t < tris; t += tstep) {
          for (const [u, v] of [[0, 1], [1, 2], [2, 0]]) {
            const ia = idx.getX(t * 3 + u), ib = idx.getX(t * 3 + v);
            ra.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
            rb.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
            const r0 = ra.distanceTo(rb);
            // ignore slivers: a decimated mesh carries edges a hundredth of a millimetre
            // long, and a ratio taken across one of those says nothing about what is drawn
            if (r0 < 0.002) continue;
            deform(ia, a); deform(ib, b);
            stretch = Math.max(stretch, a.distanceTo(b) / r0);
          }
        }
      }
      /* And has it kept its volume? Growth and edge stretch both miss the failure that is
       * left once a mesh is closed and its weights are smooth: linear blend skinning blends
       * two rotations *linearly*, so a vertex halfway across a joint is pulled toward the
       * chord between the two poses rather than round the arc, and a broad muscle crossing
       * that joint collapses into a flat sheet at its own full extent. The meshes are closed
       * now, so the signed tetrahedron sum is the real volume and the ratio is exact. */
      let volume = 1;
      if (idx) {
        const a2 = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3();
        const ra2 = new THREE.Vector3(), rb2 = new THREE.Vector3(), rc2 = new THREE.Vector3();
        let vp = 0, vr = 0;
        for (let t = 0; t < idx.count; t += 3) {
          const ia = idx.getX(t), ib = idx.getX(t + 1), ic = idx.getX(t + 2);
          ra2.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
          rb2.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
          rc2.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
          vr += ra2.dot(rb2.clone().cross(rc2));
          deform(ia, a2); deform(ib, b2); deform(ic, c2);
          vp += a2.dot(b2.clone().cross(c2));
        }
        if (Math.abs(vr) > 1e-12) volume = Math.abs(vp) / Math.abs(vr);
      }
      /* How many bones does this mesh actually ride? One means the fallback fired: `spanOf`
       * found no chain it was willing to use and the whole mesh was bound rigidly to the
       * capsule it sits nearest, which is how a muscle can be undistorted and still wrong —
       * it keeps its shape perfectly while the limb it attaches to walks away from it. */
      let bones = 0;
      if (si) {
        const seen = new Set();
        for (let i = 0; i < pos.count; i++)
          for (let k = 0; k < 4; k++)
            if (sw.getComponent(i, k) > 0.001) seen.add(si.getComponent(i, k));
        bones = seen.size;
      }
      const grew = sph.radius / Math.max(rest, 1e-4);
      // and: has it left the body? A mesh bound to the wrong segment keeps its shape and
      // simply flies off, which no growth metric sees.
      let near = Infinity;
      for (const b of m.rig.nodes.values()) {
        const j = new THREE.Vector3().setFromMatrixPosition(b.body.matrixWorld);
        near = Math.min(near, sph.center.distanceTo(j));
      }
      if (grew > 1.35 || near > 0.13 || stretch > 2.5 || volume < 0.7)
        bad.push([o.name, +grew.toFixed(1), +near.toFixed(2), o.userData.layer,
                  +stretch.toFixed(1), +volume.toFixed(2), bones, o.userData.span ?? '-']);
    });
    bad.sort((a, b) => (a[5] - b[5]) || (b[4] - a[4]) || (b[2] - a[2]));
    return { key: k, skinned, rigid, bad: bad.slice(0, 14),
             brainToSkull: brain ? +brain.distanceTo(skull).toFixed(3) : null };
  }, [key, VIEW, LAYERS]);
  await page.screenshot({ path: join(OUT, `${key}.png`), timeout: 90000, animations: 'disabled' });
  console.log(`${info.key.padEnd(24)} skinned ${String(info.skinned).padStart(3)} rigid ` +
    `${String(info.rigid).padStart(3)}  brain->skull ${info.brainToSkull ?? '-'}` +
    `  distorted ${info.bad.length}`);
  for (const [n, g, d, l, st, vol, bones, span] of info.bad)
    console.log(`     ${String(n).padEnd(34)} bones ${String(bones).padStart(2)} span ${String(span).padEnd(24)} vol ${String(vol).padEnd(5)} grew x${g}  stretch x${st}  ${d} from the ` +
      `nearest joint  [${l}]`);
}
console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log('  ✗', e);
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
