import * as THREE from 'three';

/**
 * A lateral view of the actual brain, rendered once, to sit behind the region map.
 *
 * The map's backdrop used to be a silhouette traced from the cell cloud — the furthest cell in
 * each of a hundred and twenty directions round the centroid. That was honest and it was also
 * a blob: the cells are a sample of the cortex's vertices, so their outline is the convex-ish
 * hull of a folded sheet and carries none of the shape a reader recognises as a brain. Asked
 * for "a real brain, not a drawn one", the right answer is not to draw a better outline. It is
 * to render the geometry the rest of the application is already drawing.
 *
 * So this is the fsaverage surface plus every deep structure, the same buffers on the same
 * GPU, seen down the left–right axis through an orthographic camera. Nothing is illustrated
 * and nothing is traced. What comes back is an RGBA image and the world rectangle it covers,
 * in the cortex geometry's own frame — the frame the region graph's node positions are in — so
 * the caller can place it under the nodes with no fitting and no guesswork.
 *
 * **Orientation is load-bearing.** The region map puts anterior on the right, so the plate has
 * to as well, and a plate mirrored against its own nodes would be worse than no plate: every
 * region would sit on the wrong lobe and the picture would look authoritative while being
 * exactly backwards. Three's camera looks down its local −Z, so a camera placed at −X with
 * +Y up has screen-right along +Z, which is anterior in this frame. `test/frame.test.mjs`
 * pins the frame's convention; this comment is the derivation.
 *
 * Rendered on demand and cached. It changes when the brain loads and never again — it is in
 * the organ's own frame, so posing the body, moving the camera and playing a clip all leave it
 * alone.
 */

/* Rendered well above the size it is shown at: the panel is a few hundred pixels wide and the
 * folds are the whole point, so a plate at display resolution is a smudge. This is the longer
 * side; the shorter one follows the brain's own proportions, because a square plate of a
 * lateral brain is a third empty and the caller would have to know how much. */
const LONG = 1100;

const VERT = `
varying vec3 vN;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/* A matte specimen, lit from the front and above, with the depth of a fold coming out of the
 * shading rather than out of an ambient-occlusion pass there is no budget for. Two terms do
 * it: a lambert against a key that sits where the reader is, and a downward-facing darkening,
 * because the wall of a sulcus faces the floor and a crown of a gyrus does not. */
const FRAG = `
precision highp float;
uniform vec3  uCol;
uniform vec3  uKey;
uniform float uAmb;
varying vec3 vN;
varying vec3 vP;

void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float key = max(dot(n, normalize(uKey)), 0.0);
  float down = clamp(-n.y * 0.5 + 0.5, 0.0, 1.0);   // 1 facing up, 0 facing down
  float shade = uAmb + key * 0.72;
  shade *= mix(0.55, 1.0, down);
  gl_FragColor = vec4(uCol * shade, 1.0);
}`;

export class BrainPlate {
  /**
   * @param renderer the app's own renderer — the plate has to be drawn by the context that
   *                 owns the geometry's GPU buffers, exactly as the section strip is
   */
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 20);
    this.target = null;      // sized to the brain's own proportions in build()
    this.tw = LONG; this.th = LONG;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        /* Cool and desaturated. The nodes are the subject and they are saturated colour; a
         * warm cream specimen underneath them competes for the same attention and the graph
         * stops reading. This has to recede — but it also has to be *visible*: the first pass
         * was so dark against the panel that the folds were only findable if you knew they
         * were there, which is the same failure as no plate at all. */
        uCol: { value: new THREE.Color(0xA9BED6) },
        uKey: { value: new THREE.Vector3(-0.45, 0.72, 0.52) },
        uAmb: { value: 0.40 },
      },
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    });
    this.image = null;   // an HTMLCanvasElement, ready to drawImage
    this.rect = null;    // { z0, z1, y0, y1 } in the cortex geometry's own frame
    this.ready = false;
  }

  /**
   * Bake the brain's meshes into a private scene, in the cortex geometry's own frame.
   *
   * Same frame as `sections.js`, for the same reason: the region graph's node positions come
   * from the cortex's own vertices, so anything drawn under them has to be measured the same
   * way or the two are pictures of different things.
   */
  build(holder, cortexMesh) {
    this.scene.clear();
    this.ready = false;
    this.image = null;
    if (!holder || !cortexMesh) return false;
    holder.updateMatrixWorld(true);
    const toHolder = new THREE.Matrix4().copy(holder.matrixWorld).invert();
    const intoCortex = new THREE.Matrix4()
      .multiplyMatrices(toHolder, cortexMesh.matrixWorld).invert();

    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    let n = 0;
    holder.traverse(o => {
      if (!o.isMesh || !o.geometry?.getAttribute('position')) return;
      const m = new THREE.Mesh(o.geometry, this.mat);
      m.matrixAutoUpdate = false;
      m.matrix.multiplyMatrices(intoCortex,
        new THREE.Matrix4().multiplyMatrices(toHolder, o.matrixWorld));
      m.matrixWorld.copy(m.matrix);
      this.scene.add(m);
      const pos = o.geometry.getAttribute('position');
      // a bounding box does not need every vertex of a 160k-vertex cortex
      const step = Math.max(1, Math.floor(pos.count / 2000));
      for (let i = 0; i < pos.count; i += step) {
        box.expandByPoint(v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrix));
      }
      n++;
    });
    if (!n || box.isEmpty()) return false;

    /* The frustum is the brain's own bounding box in the two axes that survive the projection,
     * with a hair of margin so the silhouette does not touch the edge. Non-square, and the
     * buffer follows it: a square plate of a lateral brain is a third empty space, and the
     * caller would then have to know how much of its rectangle was brain. */
    const cz = (box.min.z + box.max.z) / 2, cy = (box.min.y + box.max.y) / 2;
    const hz = (box.max.z - box.min.z) / 2 * 1.03;
    const hy = (box.max.y - box.min.y) / 2 * 1.03;
    this.rect = { z0: cz - hz, z1: cz + hz, y0: cy - hy, y1: cy + hy };
    /* Square pixels — the image is placed by its rectangle, so any stretch baked in here
     * would be a stretch the caller cannot see and cannot undo. */
    const px = LONG / (2 * Math.max(hz, hy));
    this.tw = Math.max(16, Math.round(hz * 2 * px));
    this.th = Math.max(16, Math.round(hy * 2 * px));
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(this.tw, this.th, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: true, stencilBuffer: false,
    });

    /* Down +X: three's camera looks along its own −Z, so a camera at −X sees +Z on the right,
     * which is anterior. That is the side the map labels anterior. */
    const depth = Math.max(box.max.x - box.min.x, 1e-3) * 1.2 + 0.02;
    this.camera.left = -hz; this.camera.right = hz;
    this.camera.top = hy;   this.camera.bottom = -hy;
    this.camera.near = 0.001; this.camera.far = depth * 2 + 0.01;
    this.camera.position.set(box.min.x - depth, cy, cz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(box.max.x + depth, cy, cz);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.ready = true;
    return true;
  }

  /**
   * Render it and read it back into a 2D canvas the lab can `drawImage`.
   *
   * It borrows the app's renderer, so it must put it back: the target, the clear colour and
   * `autoClear` all belong to the composed pipeline, and a pipeline handed back pointing at a
   * 1024-pixel offscreen buffer draws the whole scene into it. Same rule as the section strip.
   *
   * The alpha channel is the mask — the clear colour is transparent black and the shader
   * writes opaque — so the plate composites onto the panel's own background with no matte and
   * no key colour to go wrong.
   */
  draw() {
    if (!this.ready || !this.target) return null;
    if (this.image) return this.image;
    const { tw, th } = this;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.autoClear = true;
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    const buf = new Uint8Array(tw * th * 4);
    r.readRenderTargetPixels(this.target, 0, 0, tw, th, buf);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    r.setClearColor(prevClear, prevAlpha);

    const cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    const c = cv.getContext('2d');
    const img = c.createImageData(tw, th);
    // GL reads bottom-up; a canvas is top-down
    for (let y = 0; y < th; y++) {
      const src = (th - 1 - y) * tw * 4;
      img.data.set(buf.subarray(src, src + tw * 4), y * tw * 4);
    }
    c.putImageData(img, 0, 0);
    this.image = cv;
    return cv;
  }

  dispose() {
    this.target?.dispose();
    this.mat.dispose();
    this.scene.clear();
  }
}
