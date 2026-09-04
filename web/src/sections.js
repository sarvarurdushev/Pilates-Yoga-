import * as THREE from 'three';

/**
 * A strip of true sections through the brain, along the plane the scan is using.
 *
 * The reference this was built against carries a row of MRI-like thumbnails along the bottom
 * edge. There is no volumetric imaging in this repository — no T1, no aseg, nothing with a
 * voxel in it — so there is nothing here that could honestly be labelled an MRI, and a
 * grey-and-noise picture that merely looked like one would be a fabrication in the shape of
 * an instrument reading. This is the honest version of the same thing: a real section of the
 * real surfaces, cut where the plane actually crosses them.
 *
 * It is the same measurement `tissue.js` makes. A fragment's own distance to the plane is
 * computed in the organ's frame and only the band within a hair of zero is lit, so what is
 * drawn is the set of points where the cortex, the cerebellum, the brainstem and every deep
 * structure cross that plane — a ragged contour through every gyrus the plane passes. No
 * geometry is cut, nothing is projected, and nothing is drawn that is not a surface of the
 * model. The caption says so, because a picture in this shape looks measured whatever it is.
 *
 * Blending is additive with the depth buffer off and both faces drawn, for the same reason as
 * the tissue: a ray down the plane normal crosses the surface many times near the section, and
 * summing those crossings is what makes a fold read as a fold. The camera is orthographic, so
 * the thumbnail is a section rather than a perspective view of one.
 *
 * Rendered on demand, never per frame. The sections live in the brain's own frame, so they do
 * not change when the camera moves, when the head is posed, or when a clip plays — only when
 * the plane changes. Five renders of the whole brain is not something to do sixty times a
 * second for a picture that would be identical each time.
 */

/* Render at more than they are shown at, so the contour stays a hairline rather than a
 * staircase when the strip is scaled up. At 76 px a section was a smudge you had to take on
 * trust; the whole point of them is that you can see what the plane is passing through. The
 * lab enlarges the same renders to about 280 px, so this is sized for that rather than for the
 * 136 px strip beside the stage — five readbacks happen when the plane changes, not per frame. */
const TW = 320, TH = 320;
/* Nine, not five.
 *
 * Five over the 0.62 span put the cuts 27.5 mm apart, and two of the five came back "outer
 * surface only" — a tenth of the strip spent saying nothing. Worse, a structure shorter than
 * the spacing can sit entirely between two cuts and be reported as present in none of them,
 * which reads as the series not containing it rather than as the series having missed it.
 * The thalamus is about 30 mm across and the amygdala under 20, so that was not hypothetical.
 * At nine the spacing is 13.75 mm, under the smallest named structure here.
 *
 * The cost is real and bounded: each slice is one render of the brain plus one readback, and
 * they happen when the plane or the selection changes rather than per frame. */
const SLICES = 9;
/* Warm, and brighter than the tissue's own gain, because a section is one thin band rather
 * than a whole volume: the same brightness that sums to white through a head is nearly black
 * through a slice of one. */
const COLOUR = new THREE.Color(0xFFC98A);

/* The band's own brightness, and what focusing does to it.
 *
 * Both halves are needed and the balance between them was measured rather than guessed. A cut
 * through the middle of a brain is overwhelmingly cortex, so against a full-strength one a
 * small deep structure cannot stand out however bright it is made — the rest has to come down.
 * But the first tuning came down too far: every thumbnail lost about two thirds of its total
 * brightness, including the one holding the structure, and "the chosen part stands out by
 * being lighter" turned into "the picture goes dark and one speck survives". Measured across
 * three passes on an axial series with the hippocampus selected, counting pixels above a
 * brightness threshold rather than summing the image — a small structure lifted hard changes
 * how many pixels are bright far more than it changes the total, and a sum-only measure
 * reported the picture getting darker while the structure was blazing. The lift is the larger
 * move and the mute the smaller one, so the cut holding the structure gains an unmistakable
 * bright shape and does not lose overall brightness doing it, while the rest of the series
 * only steps back. */
/* GLTFLoader lowercases custom attributes, so the cortex's per-vertex parcel arrives as
 * `_region` in the browser and `_REGION` in a file read by a node tool. Same helper as
 * `main.js`; kept local because this module has no other reason to import from there. */
const regionAttr = geo => geo.getAttribute('_region') || geo.getAttribute('_REGION');

/* How close the pointer has to be, as a fraction of the thumbnail's half-width, and how many
 * points a part is projected at for picking. The radius is generous on purpose: a section is a
 * ragged contour and the surface between two samples of it is real surface. */
const PICK_R = 0.055;
const PICK_SAMPLES = 3000;

const BASE_GAIN = 0.5;
const FOCUS_GAIN = 7.0;
const MUTED_GAIN = 0.72;

const VERT = `
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = `
precision highp float;
uniform vec3  uAxis;      // plane normal, in the brain's own frame
uniform vec3  uCentre;
uniform float uAt;        // where along that axis, same units
uniform float uEps;       // half-width of the band
uniform vec3  uCol;
uniform float uGain;
varying vec3 vP;

void main() {
  float d = dot(vP - uCentre, normalize(uAxis)) - uAt;
  float band = exp(-(d * d) / (uEps * uEps));
  // below this a fragment contributes less than a step of an 8-bit channel, so it is only cost
  if (band < 0.004) discard;
  gl_FragColor = vec4(uCol * band * uGain, 1.0);
}`;

export class SectionStrip {
  /**
   * @param renderer the app's own renderer — the sections have to be drawn by the context
   *                 that owns the geometry's GPU buffers
   */
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 10);
    this.target = new THREE.WebGLRenderTarget(TW, TH, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: false, stencilBuffer: false,
    });
    this.buf = new Uint8Array(TW * TH * 4);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uAxis:   { value: new THREE.Vector3(0, 1, 0) },
        uCentre: { value: new THREE.Vector3() },
        uAt:     { value: 0 },
        uEps:    { value: 0.01 },
        uCol:    { value: COLOUR.clone() },
        uGain:   { value: BASE_GAIN },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    this.ready = false;
    this.radius = 1;
  }

  /**
   * Bake the brain's meshes into a private scene, in the cortex geometry's own frame.
   *
   * That frame is the one `tissue.js` measures in — its `vObj` is the mesh's local `position`
   * and its centre and radius come from the cortex geometry's bounding sphere — so a position
   * along the axis means the same thing here as it does in the picture. Getting that wrong
   * would put the thumbnail and the plane it claims to show in two different places, which is
   * the failure the two shaders already had once between them.
   *
   * Geometry is shared, not copied. These are the same buffers the scene is drawing.
   */
  build(holder, cortexMesh, centre, radius, colourOf = null) {
    this.scene.clear();
    for (const m of this.clones ?? []) m.dispose();
    this.clones = [];
    if (!holder || !cortexMesh) { this.ready = false; return false; }
    holder.updateMatrixWorld(true);
    const toHolder = new THREE.Matrix4().copy(holder.matrixWorld).invert();
    const cortexInHolder = new THREE.Matrix4().multiplyMatrices(toHolder, cortexMesh.matrixWorld);
    const intoCortex = new THREE.Matrix4().copy(cortexInHolder).invert();

    let n = 0;
    this.parts = [];
    holder.traverse(o => {
      if (!o.isMesh || !o.geometry?.getAttribute('position')) return;
      const m = new THREE.Mesh(o.geometry, this.mat);
      m.matrixAutoUpdate = false;
      m.matrix.multiplyMatrices(intoCortex,
        new THREE.Matrix4().multiplyMatrices(toHolder, o.matrixWorld));
      m.matrixWorld.copy(m.matrix);
      this.scene.add(m);
      /* Which named structure this mesh is, so a slice can say what it passes through rather
       * than only where it is. The id lives on the mesh or on the group above it, depending
       * on which loader made it. The cortex has none — it is one mesh carrying every parcel —
       * and is deliberately left out of the *list*: "this section crosses the cortex" is true
       * of all five and tells a reader nothing.
       *
       * It does get its own colour, though. A section drawn in one colour is a shape a reader
       * has to be told about; drawn in each structure's own colour it answers "what is that
       * bright thing" by itself, and the legend under the strip names them. Each part gets a
       * clone of the material rather than a palette lookup — twenty meshes over five slices is
       * a hundred draw calls, which is nothing, and it keeps the shader as simple as it is. */
      let id = null;
      for (let p2 = o; p2 && id == null; p2 = p2.parent) id = p2.userData?.regionId ?? null;
      const col = id != null ? (colourOf?.(+id) ?? null) : null;
      if (col) {
        m.material = this.mat.clone();
        m.material.uniforms = THREE.UniformsUtils.clone(this.mat.uniforms);
        m.material.uniforms.uCol.value = new THREE.Color(col);
        this.clones.push(m.material);
      }
      if (id != null) this.parts.push({ id: +id, mesh: m, geo: o.geometry, mat: m.material });
      /* The cortex is one mesh carrying every parcel, and for a long time that meant the
       * thirteen cortical regions were the one thing this panel could not answer about.
       * `locate` looked its argument up in `parts`, `parts` held only meshes with a
       * `regionId` of their own, and so choosing the temporal lobe — or the motor cortex, or
       * any parcel at all — reported that the structure was "not one this series can cut",
       * which is false: it is *most* of what these sections cut through. Every vertex already
       * carries its Desikan-Killiany parcel, so the parcels are registered here as parts of
       * their own, each holding the list of vertex indices that belong to it. */
      if (id == null) {
        const reg = regionAttr(o.geometry);
        if (reg) for (const [rid, vi] of parcelVerts(reg))
          this.parts.push({ id: rid, mesh: m, geo: o.geometry, mat: null, vi, parcel: true });
      }
      n++;
    });
    this.cortex = this.parts.find(p2 => p2.parcel)?.mesh ?? null;
    this._focus = null;
    this.focusMesh = null;
    if (this.cortex) {
      /* One extra mesh, hidden until a parcel is chosen, drawing that parcel's own triangles
       * over the muted cortex. Drawn rather than shaded: lifting one parcel inside the
       * cortex's own fragment shader needs the region id as a varying, and a region varying
       * that is not `flat` interpolates across a triangle spanning two parcels into a
       * fraction that indexes an unrelated third — the trap the tissue shader already fell
       * into once. This has no such failure mode, costs one draw call per slice, and is
       * additive like everything else here, so the parcel's total is exactly the gain a deep
       * structure would get. */
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.cortex.geometry.getAttribute('position'));
      this.focusMat = this.mat.clone();
      this.focusMat.uniforms = THREE.UniformsUtils.clone(this.mat.uniforms);
      this.clones.push(this.focusMat);
      this.focusMesh = new THREE.Mesh(geo, this.focusMat);
      this.focusMesh.matrixAutoUpdate = false;
      this.focusMesh.matrix.copy(this.cortex.matrix);
      this.focusMesh.matrixWorld.copy(this.cortex.matrix);
      this.focusMesh.visible = false;
      this.scene.add(this.focusMesh);
    }
    this.centre = centre.clone();
    this.radius = Math.max(1e-4, radius);
    this.mat.uniforms.uCentre.value.copy(this.centre);
    // the same fraction of the organ the big plane's band is, so the two agree at a glance
    this.mat.uniforms.uEps.value = this.radius * 0.016;
    this.ready = n > 0;
    return this.ready;
  }

  /**
   * Which named structures a cut at `at` actually passes through.
   *
   * Measured off this model's own geometry — a structure is in the list when its vertices
   * straddle the plane — rather than quoted from an atlas. The distinction matters: a textbook
   * sentence about what sits at a given millimetre would be a claim about brains in general
   * dressed up as a caption on this picture, and this one is a statement about the thing on
   * screen. The extents are cached per axis, because they only change when the plane does.
   */
  contentsAt(axis, at) {
    if (!this.parts?.length) return [];
    const key = `${axis.x},${axis.y},${axis.z}`;
    if (this._spanKey !== key) {
      this._spanKey = key;
      const n = axis.clone().normalize();
      for (const part of this.parts) {
        // a stride: an extent does not need every vertex, and some of these are dense
        let lo = Infinity, hi = -Infinity;
        eachPoint(part, v => {
          const d = v.clone().sub(this.centre).dot(n);
          if (d < lo) lo = d;
          if (d > hi) hi = d;
        });
        part.lo = lo; part.hi = hi;
      }
    }
    const d = at * this.radius;
    /* Parcels are excluded from the *list*, though they are now parts like any other. Almost
     * every cut crosses most of them, so naming them would push the deep structures — the
     * answer a reader is actually looking for — out of the three the caption has room for.
     * And the legend beside the strip pairs a name with the colour it is drawn in: the cortex
     * is drawn in one colour whatever parcel a pixel belongs to, so thirteen swatches would
     * promise a distinction the picture does not make. `locate` and `setFocus` answer for
     * them, which is what "where is the temporal lobe" needs. */
    return this.parts.filter(p => !p.parcel && d >= p.lo && d <= p.hi).map(p => p.id);
  }

  /**
   * Light one structure and hold the rest back, so the chosen thing stands out in the picture.
   *
   * A ring drawn over the thumbnail was the first answer and it was the wrong one: it points
   * at a place rather than showing the thing, and on a picture this dense a circle reads as
   * one more mark among the marks. Brightness is the language this image already speaks —
   * every other value in it is an accumulation of surface crossings — so the honest way to
   * pick a structure out is to give it more of the same and give everything else less.
   *
   * It is a display gain and nothing else: the geometry, the plane and the band are
   * untouched, so what lights up is the same set of crossings that was there before. Passing
   * -1 puts every part back to its own gain, which is what "nothing selected" means.
   */
  setFocus(id, colourOf = null) {
    if (!this.parts?.length) return false;
    if (this._focus === id) return false;
    this._focus = id;
    const on = id != null && id > 0;
    for (const part of this.parts) {
      if (!part.mat?.uniforms?.uGain) continue;
      part.mat.uniforms.uGain.value = !on ? BASE_GAIN
        : (part.id === +id ? BASE_GAIN * FOCUS_GAIN : BASE_GAIN * MUTED_GAIN);
    }
    /* The cortex has no id of its own — it is one mesh carrying every parcel — so it shares
     * the base material. It is the ground everything else is seen against, and holding it
     * back is most of what makes a focused structure read. */
    this.mat.uniforms.uGain.value = on ? BASE_GAIN * MUTED_GAIN : BASE_GAIN;

    /* A chosen parcel is drawn a second time, over the cortex it is part of. The extra gain is
     * the *difference* the two carry, so a parcel and a deep structure end up at the same
     * `BASE_GAIN * FOCUS_GAIN` and the strip does not brighten by which kind of thing was
     * picked. The index is built on first use and kept: it is a walk over every triangle of a
     * dense surface, and a reader flicking between two regions should pay for it once. */
    const fm = this.focusMesh;
    if (!fm) return true;
    const part = on ? this.parts.find(p => p.parcel && p.id === +id) : null;
    fm.visible = !!part;
    if (part) {
      if (!part.index) part.index = parcelIndex(this.cortex.geometry,
                                                regionAttr(this.cortex.geometry), part.id);
      fm.geometry.setIndex(new THREE.BufferAttribute(part.index, 1));
      fm.geometry.setDrawRange(0, part.index.length);
      this.focusMat.uniforms.uGain.value = BASE_GAIN * (FOCUS_GAIN - MUTED_GAIN);
      const col = colourOf?.(part.id);
      this.focusMat.uniforms.uCol.value.copy(col ? new THREE.Color(col) : COLOUR);
    }
    return true;
  }

  /**
   * Where one named structure is, in the frame of a cut down `axis`.
   *
   * Two answers, both measured off this model's own geometry. `lo`/`hi` are its extent along
   * the axis in the same units `positions()` returns, so a caller can say which cuts pass
   * through it and how thick it is. `sx`/`sy` are its centroid in the thumbnail's own
   * normalised frame — −1 to 1 across and up — so a caller can ring it in the picture rather
   * than leave the reader to find it.
   *
   * The camera basis is rebuilt here exactly as `draw()` builds it, and the two must stay
   * together: three's `lookAt` puts the view's +Z along `eye − target`, its +X along
   * `up × Z` and its +Y along `Z × X`. A ring computed against a different basis would sit
   * confidently on the wrong lobe, which is worse than no ring.
   */
  locate(axis, id) {
    const part = this.parts?.find(p => p.id === +id);
    if (!part) return null;
    const n = axis.clone().normalize();
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const ex = new THREE.Vector3().crossVectors(up, n).normalize();
    const ey = new THREE.Vector3().crossVectors(n, ex).normalize();
    const d = new THREE.Vector3();
    let lo = Infinity, hi = -Infinity, sx = 0, sy = 0, k = 0;
    eachPoint(part, v => {
      d.copy(v).sub(this.centre);
      const along = d.dot(n);
      if (along < lo) lo = along;
      if (along > hi) hi = along;
      sx += d.dot(ex); sy += d.dot(ey);
      k++;
    });
    if (!k) return null;
    const half = this.radius * 1.06;         // the same window `draw()` frames the slice with
    return { lo: lo / this.radius, hi: hi / this.radius,
             sx: (sx / k) / half, sy: (sy / k) / half };
  }

  /**
   * Which structure the picture shows at a point, in the thumbnail's own −1..1 frame.
   *
   * The cuts named what they passed through and lit what was chosen, and the one thing a
   * reader kept asking for was the other direction: *that bright shape there — what is it, and
   * can I choose it?* This answers it off the same geometry the picture is drawn from. Every
   * part's vertices are projected once per axis into the frame `draw()` renders in; a pick
   * keeps the ones lying inside the band this cut actually lights and takes the nearest.
   *
   * So it is the real crossing that is picked, not a bounding box and not a colour read back
   * out of the canvas — a shape only answers where the surface genuinely meets the plane, and
   * a part that this cut misses cannot be picked in it however close the pointer is to where
   * it would be.
   *
   * The projection is denser than `locate`'s, because that measures an extent and this has to
   * land on the pointer: at four hundred samples a whole cortex is a scatter with centimetres
   * between points and the nearest one is nowhere near where you clicked.
   */
  pickAt(axis, at, sx, sy) {
    if (!this.parts?.length) return null;
    const key = `${axis.x},${axis.y},${axis.z}`;
    if (this._pickKey !== key) {
      this._pickKey = key;
      const n = axis.clone().normalize();
      const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const ex = new THREE.Vector3().crossVectors(up, n).normalize();
      const ey = new THREE.Vector3().crossVectors(n, ex).normalize();
      const d = new THREE.Vector3();
      const out = [];
      for (const part of this.parts)
        eachPoint(part, v => {
          d.copy(v).sub(this.centre);
          out.push(part.id, d.dot(n), d.dot(ex), d.dot(ey), part.parcel ? 1 : 0);
        }, PICK_SAMPLES);
      this._proj = out;
    }
    const half = this.radius * 1.06;
    /* A shade wider than the lit band. The shader's falloff is a gaussian, so a crossing is
     * visible a little past `uEps` — picking exactly at it would refuse shapes the reader can
     * plainly see. */
    const band = this.mat.uniforms.uEps.value * 2.2;
    const along = at * this.radius;
    const p = this._proj;
    let best = -1, bd = Infinity, bestParcel = 1;
    for (let i = 0; i < p.length; i += 5) {
      if (Math.abs(p[i + 1] - along) > band) continue;
      const dx = p[i + 2] / half - sx, dy = p[i + 3] / half - sy;
      const q = dx * dx + dy * dy;
      /* A named deep structure wins a tie with the cortex around it. Both are real answers at
       * that pixel — the hippocampus is inside the temporal lobe — and the specific one is
       * what a reader pointing at a distinct bright shape is asking about. */
      if (q < bd || (q < bd * 1.6 && p[i + 4] < bestParcel)) {
        if (q < bd) bd = q;
        best = p[i]; bestParcel = p[i + 4];
      }
    }
    return best >= 0 && bd <= PICK_R * PICK_R ? { id: best, dist: Math.sqrt(bd) } : null;
  }

  /** Where the five slices sit along the axis, as -1..1 of the organ's radius. */
  positions() {
    // the ends of a bounding sphere are empty space, so the series is taken across the middle
    const span = 0.62;
    return Array.from({ length: SLICES },
      (_, i) => -span + (2 * span * i) / (SLICES - 1));
  }

  /**
   * Draw the series into the canvases given, one per slice.
   *
   * The renderer's target and clear state are saved and put back: this borrows the app's
   * context mid-frame, and a composed pipeline that came back pointed at a 96-pixel buffer
   * would draw the whole scene into a thumbnail.
   */
  draw(axis, canvases) {
    if (!this.ready || !axis) return false;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();

    for (const m of [this.mat, ...(this.clones ?? [])]) {
      m.uniforms.uAxis.value.copy(axis).normalize();
      m.uniforms.uCentre.value.copy(this.centre);
      m.uniforms.uEps.value = this.mat.uniforms.uEps.value;
    }
    this.mat.uniforms.uAxis.value.copy(axis).normalize();
    // a square window on the organ, so every slice is at the same scale and they compare
    const h = this.radius * 1.06;
    this.camera.left = -h; this.camera.right = h;
    this.camera.top = h; this.camera.bottom = -h;
    this.camera.near = 0.001; this.camera.far = this.radius * 6;

    /* Looking down the plane's own normal. `up` is superior for the two vertical planes and
     * anterior for the axial one, which is the convention every atlas uses and the reason an
     * axial slice reads with the front of the head at the top. */
    const n = axis.clone().normalize();
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.camera.up.copy(up);
    this.camera.position.copy(this.centre).addScaledVector(n, this.radius * 3);
    this.camera.lookAt(this.centre);
    this.camera.updateProjectionMatrix();

    r.autoClear = true;
    r.setClearColor(0x000000, 1);
    const at = this.positions();
    for (let i = 0; i < SLICES && i < canvases.length; i++) {
      for (const m of [this.mat, ...(this.clones ?? [])])
        m.uniforms.uAt.value = at[i] * this.radius;
      r.setRenderTarget(this.target);
      r.clear(true, false, false);
      r.render(this.scene, this.camera);
      r.readRenderTargetPixels(this.target, 0, 0, TW, TH, this.buf);
      blit(this.buf, canvases[i]);
    }

    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    r.setClearColor(prevClear, prevAlpha);
    return true;
  }

  dispose() {
    this.target.dispose();
    this.mat.dispose();
    for (const m of this.clones ?? []) m.dispose();
    this.scene.clear();
  }
}

/** GL reads bottom-up and ImageData is top-down, so the rows are flipped on the way in. */
function blit(buf, canvas) {
  canvas.width = TW; canvas.height = TH;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(TW, TH);
  const row = TW * 4;
  for (let y = 0; y < TH; y++) {
    const src = (TH - 1 - y) * row;
    img.data.set(buf.subarray(src, src + row), y * row);
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Split a cortex geometry's vertices into its Desikan-Killiany parcels.
 *
 * Returns `id -> Uint32Array of vertex indices`, region 0 — unparcellated cortex — left out,
 * because a parcel with no name has nothing to say and would be offered as a structure the
 * reader could choose. Two passes rather than pushing into arrays: this runs once per brain
 * load over a few hundred thousand vertices, and the counted form allocates exactly what it
 * needs instead of growing thirteen arrays a doubling at a time.
 */
function parcelVerts(reg) {
  const n = reg.count;
  const count = new Map();
  for (let i = 0; i < n; i++) {
    const id = reg.getX(i) | 0;
    if (id > 0) count.set(id, (count.get(id) ?? 0) + 1);
  }
  const out = new Map(), fill = new Map();
  for (const [id, k] of count) { out.set(id, new Uint32Array(k)); fill.set(id, 0); }
  for (let i = 0; i < n; i++) {
    const id = reg.getX(i) | 0;
    if (id <= 0) continue;
    const k = fill.get(id);
    out.get(id)[k] = i;
    fill.set(id, k + 1);
  }
  return out;
}

/**
 * The triangles whose three corners all sit in one parcel.
 *
 * A triangle straddling a boundary belongs to neither and is dropped: the alternative is to
 * hand it to whichever corner is read first, which paints a ragged fringe of one parcel's
 * colour onto its neighbour. There are a few thousand of those against hundreds of thousands
 * of interior triangles, so what is lost is a hairline at the seam and what is gained is a
 * lit shape that is only ever the structure the reader asked for.
 */
function parcelIndex(geo, reg, id) {
  const idx = geo.getIndex();
  const n = idx ? idx.count : geo.getAttribute('position').count;
  const at = i => (idx ? idx.getX(i) : i);
  const keep = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    if ((reg.getX(a) | 0) === id && (reg.getX(b) | 0) === id && (reg.getX(c) | 0) === id)
      keep.push(a, b, c);
  }
  return new Uint32Array(keep);
}

/**
 * Every point of a part, in the cortex's own frame, at about four hundred samples.
 *
 * A part is either a whole mesh — a deep structure, a segmented one — or a parcel of the
 * cortex, which is a list of vertex indices into a mesh it shares with twelve others. An
 * extent measured over the shared mesh would be the whole cortex's extent for all thirteen,
 * so which of the two a part is has to be answered here rather than at each call site.
 */
function eachPoint(part, fn, max = 400) {
  const pos = part.geo.getAttribute('position');
  const v = new THREE.Vector3();
  const list = part.vi;
  const n = list ? list.length : pos.count;
  const step = Math.max(1, Math.floor(n / max));
  for (let i = 0; i < n; i += step) {
    const k = list ? list[i] : i;
    v.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(part.mesh.matrix);
    fn(v);
  }
}

export const SLICE_COUNT = SLICES;
