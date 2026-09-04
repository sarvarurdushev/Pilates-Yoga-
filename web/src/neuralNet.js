import * as THREE from 'three';

/**
 * A neural network that lives inside the cortex.
 *
 * The nodes are not scattered in a box and they are not decoration. Every vertex of the
 * cortex mesh already carries the Desikan-Killiany parcel it belongs to, baked in by
 * `build_cortex.py` as `_REGION` — so sampling that mesh gives, for free, a node cloud whose
 * clusters *are* anatomical regions. A node knows which parcel it is in, which is what makes
 * "the neurons in Broca's area fire when you select Broca's area" a lookup rather than a
 * fiction. It also means the network follows the folds, because the vertices do.
 *
 * The nodes are pulled a little way inward along the surface normal, so the network sits in
 * the cortical ribbon rather than on the outside of it and you look *through* tissue at it.
 *
 * Three things are drawn:
 *
 * - **Somas** — one instanced additive sprite per node, sized by how much it is firing.
 * - **Axons** — `LineSegments` between nodes, mostly short and within a parcel, with a few
 *   long-range association fibres between parcels. Each vertex carries how far along its own
 *   edge it sits, so a pulse can travel: the fragment lights where `fract(speed·t - along)`
 *   is small, which is one moving band per edge with no per-frame CPU work at all.
 * - **Dendrites** — a short branching spray at a fraction of the nodes. This is what stops a
 *   node reading as a dot: a neuron is a cell body *and* an arbor, and at this scale the
 *   arbor is most of what the eye uses to tell one from a star field.
 *
 * Everything animates from `uTime` in the shader. There is no per-frame attribute upload and
 * no per-node JavaScript, which is why it can be tens of thousands of edges and still cost
 * nothing per frame: the CPU writes one float.
 *
 * Per-region activity is a texture, one texel per region id, sampled by both shaders — the
 * same trick `RegionPalette` uses for colour, for the same reason: it means the id space is
 * not capped and one uniform upload retunes the whole network.
 */

const MAX_REGION = 64;

/** How many cortical vertices become somas. Above this the web reads as fog rather than net. */
const NODE_TARGET = 4200;
/** Short-range edges per node, and the chance of a long-range association fibre. */
const NEAR_K = 3, LONG_P = 0.055;

/* How fast a band crosses its fibre: `head = fract(uTime · rate · BAND_RATE + phase)`, so one
 * traversal takes `1 / (rate · BAND_RATE)` seconds. It is interpolated into the shader rather
 * than written there, because the trace panel reports the traversal time and a readout that
 * disagreed with the picture is the one thing a readout must never do — the same rule
 * `fireAt` follows for the soma. Nothing about it is a conduction velocity: the units are
 * seconds of screen time, and there is no electrophysiology in this repository. */
const BAND_RATE = 0.16;
/** Fraction of somas that grow a dendritic arbor, and how many branches each gets. */
const ARBOR_P = 0.22, ARBOR_BRANCHES = 3, ARBOR_SEGS = 3;

const NODE_VERT = `
attribute vec3 aOffset;
attribute float aRegion;
attribute float aPhase;
attribute float aRate;
attribute float aScale;
uniform float uTime, uSize, uActivity, uMaxSize;
uniform vec3  uScanAxis, uScanCentre;
uniform float uScanAt, uScanWidth;
uniform sampler2D uAct;
varying float vFire;
varying float vRegion;

void main() {
  vRegion = aRegion;
  /* Each soma has its own rate and phase, so the field never flashes in unison — a
   * synchronised network reads as a strobe, not as tissue. The region's own activity sets
   * how far the trough falls: an idle parcel still ticks over, a working one fires hard. */
  float act = texelFetch(uAct, ivec2(int(aRegion + 0.5), 0), 0).r;
  /* Cells at the scan plane fire. The plane is a place, not a region, so this is a distance
   * rather than a lookup — and it means the sweep reveals the network the same way it reveals
   * the tissue, which is the point of putting them in one frame. */
  float scan = 0.0;
  if (dot(uScanAxis, uScanAxis) > 0.0) {
    float d = dot(aOffset - uScanCentre, normalize(uScanAxis)) - uScanAt;
    scan = exp(-(d * d) / max(1e-6, uScanWidth * uScanWidth));
  }
  float drive = clamp(uActivity * 0.5 + act + scan, 0.0, 1.6);
  float f = sin(uTime * aRate + aPhase * 6.2831);
  vFire = pow(max(f, 0.0), mix(6.0, 1.4, drive)) * (0.25 + drive);

  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  gl_Position = projectionMatrix * mv;
  /* Perspective-correct, and then clamped — the clamp is the load-bearing half.
   *
   * A soma is a cell standing in for something far below the resolution of this model, so its
   * apparent size is a symbol rather than a measurement: past a few pixels it stops reading as
   * a cell and starts contributing area. Unclamped, one-over-z meant that closing on the brain grew
   * every one of four thousand additive sprites together, and their overlap turned the whole
   * organ into a flat cream haze with no folds in it — at a camera distance where the tissue
   * shader alone still looked right. Near is brighter and busier, not bigger without limit. */
  float px = uSize * aScale * (0.55 + vFire) * (1.0 / max(0.02, -mv.z));
  gl_PointSize = clamp(px, 0.7, uMaxSize);
}`;

const NODE_FRAG = `
precision highp float;
uniform vec3 uCold, uHot, uHighlight;
uniform float uSelected, uGain;
varying float vFire;
varying float vRegion;

void main() {
  // a round soma with a soft corona, from the point's own coordinates
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core  = pow(1.0 - r, 3.5);
  float halo  = pow(1.0 - r, 1.1) * 0.30;

  vec3 c = mix(uCold, uHot, clamp(vFire, 0.0, 1.0));
  bool sel = uSelected >= 0.0 && abs(vRegion - uSelected) < 0.5;
  /* Selected cells do not merely keep their brightness, they take the picture: pushed most of
   * the way to the signal colour and lifted well above their resting output, while everything
   * else falls to a tenth. Choosing a region from the panel used to change the network so
   * little that the honest answer to "did that do anything" was no. */
  if (sel) c = mix(c, uHighlight, 0.85);
  float dim = (uSelected >= 0.0 && !sel) ? 0.10 : 1.0;
  float lift = sel ? 2.6 : 1.0;

  gl_FragColor = vec4(c * (core + halo) * (0.16 + vFire * 1.15) * dim * lift * uGain, 1.0);
}`;

const EDGE_VERT = `
attribute float aAlong;
attribute float aRegion;
attribute float aPhase;
attribute float aRate;
attribute float aLong;
uniform float uTime, uActivity;
uniform vec3  uScanAxis, uScanCentre;
uniform float uScanAt, uScanWidth;
uniform sampler2D uAct;
varying float vAlong;
varying float vRegion;
varying float vPhase;
varying float vRate;
varying float vLong;
varying float vAct;

void main() {
  vAlong = aAlong; vRegion = aRegion; vPhase = aPhase; vRate = aRate; vLong = aLong;
  vAct = texelFetch(uAct, ivec2(int(aRegion + 0.5), 0), 0).r;
  if (dot(uScanAxis, uScanAxis) > 0.0) {
    float d = dot(position - uScanCentre, normalize(uScanAxis)) - uScanAt;
    vAct += exp(-(d * d) / max(1e-6, uScanWidth * uScanWidth));
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const EDGE_FRAG = `
precision highp float;
uniform float uTime, uActivity, uSelected, uGain;
uniform vec3 uDim, uPulse, uHighlight;
varying float vAlong;
varying float vRegion;
varying float vPhase;
varying float vRate;
varying float vLong;
varying float vAct;

void main() {
  float drive = clamp(uActivity * 0.5 + vAct, 0.0, 1.4);

  /* The resting fibre. Association fibres are drawn fainter than local ones: they are long,
   * there are far fewer of them, and at equal brightness they dominate the picture and the
   * network reads as a wire sculpture instead of as tissue. */
  float base = mix(0.090, 0.042, vLong) * (0.5 + drive * 0.8);

  /* The impulse. One band per edge travelling from one end to the other; 'fract' makes it
   * repeat and 'vPhase' staggers the edges against each other. The band is narrow so it
   * reads as a spike rather than as a glow sliding along a wire. */
  float head = fract(uTime * vRate * ${BAND_RATE.toFixed(3)} + vPhase);
  float d = abs(vAlong - head);
  d = min(d, 1.0 - d);                       // wrap, so the pulse does not blink at the join
  float spike = exp(-d * d * 900.0);

  /* Not every edge is conducting at once. An edge is only allowed to fire in bursts, so at
   * rest the network shows the occasional travelling spike and under load it is dense — the
   * difference between "low activity" and "high activity" is how much of the time this is
   * open, not how bright the line is. */
  float gate = step(0.62 - drive * 0.5, fract(vPhase * 7.31 + floor(uTime * vRate * ${BAND_RATE.toFixed(3)} + vPhase) * 0.618));

  vec3 c = uDim * base + uPulse * spike * gate * (0.55 + drive * 1.5);

  bool sel = uSelected >= 0.0 && abs(vRegion - uSelected) < 0.5;
  if (sel) c += uHighlight * (base * 6.0 + spike * gate * 1.2);
  else if (uSelected >= 0.0) c *= 0.16;

  gl_FragColor = vec4(c * uGain, 1.0);
}`;

/** One texel per region: r = activity 0..1. Same idea as RegionPalette, for the same reason. */
class ActivityMap {
  constructor(size = MAX_REGION) {
    this.size = size;
    this.data = new Float32Array(size);
    this.texture = new THREE.DataTexture(this.data, size, 1, THREE.RedFormat, THREE.FloatType);
    this.texture.needsUpdate = true;
  }
  set(id, v) {
    const i = Math.round(id);
    if (i < 0 || i >= this.size) return;
    this.data[i] = v;
    this.texture.needsUpdate = true;
  }
  clear() { this.data.fill(0); this.texture.needsUpdate = true; }
}

/**
 * Sample the cortex into a node cloud, keeping each node's parcel.
 *
 * Stride sampling rather than random: the mesh's vertices are in build order, which for a
 * marched surface walks the volume, so a fixed stride spreads the picks over the whole
 * cortex. Random picks clump, and a clump of somas reads as a defect.
 */
function sampleNodes(geo, target) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const reg = geo.getAttribute('_region') || geo.getAttribute('_REGION');
  const n = pos.count;
  const stride = Math.max(1, Math.floor(n / target));
  const out = [];
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < n; i += stride) {
    v.fromBufferAttribute(pos, i);
    if (nrm) {
      nv.fromBufferAttribute(nrm, i);
      // inward, into the cortical ribbon, by a jittered depth so the layer has thickness
      v.addScaledVector(nv, -(0.004 + Math.random() * 0.012));
    }
    out.push({ p: v.clone(), region: reg ? Math.round(reg.getX(i)) : 0 });
  }
  return out;
}

/** A uniform grid, so k-nearest is a neighbourhood walk rather than 5200². */
function gridOf(nodes, cell) {
  const g = new Map();
  const key = (a, b, c) => `${a}|${b}|${c}`;
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i].p;
    const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell));
    let l = g.get(k); if (!l) g.set(k, l = []);
    l.push(i);
  }
  return { g, cell, key };
}

function nearest(nodes, grid, i, k) {
  const p = nodes[i].p, { g, cell, key } = grid;
  const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
  const cand = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const l = g.get(key(cx + a, cy + b, cz + c));
    if (l) for (const j of l) if (j !== i) cand.push(j);
  }
  cand.sort((x, y) => p.distanceToSquared(nodes[x].p) - p.distanceToSquared(nodes[y].p));
  return cand.slice(0, k);
}

export class NeuralNet {
  constructor(cortexMesh) {
    this.group = new THREE.Group();
    this.group.name = 'neuralNet';
    this.act = new ActivityMap();
    this.uniforms = {
      uTime:      { value: 0 },
      uActivity:  { value: 0.3 },
      uSelected:  { value: -1 },
      uAct:       { value: this.act.texture },
      uScanAxis:  { value: new THREE.Vector3(0, 0, 0) },
      /* The organ's own centre, so `at` means the same thing here as it does in the tissue
       * shader. They agreed by accident while this cortex's bounding sphere sat on the
       * origin; a body whose brain does not would have put the plane and the cells it lights
       * in two different places. */
      uScanCentre:{ value: new THREE.Vector3(0, 0, 0) },
      uScanAt:    { value: 0 },
      uScanWidth: { value: 0.02 },
    };

    const geo = cortexMesh.geometry;
    const nodes = sampleNodes(geo, NODE_TARGET);
    geo.computeBoundingSphere();
    const radius = geo.boundingSphere.radius;

    this._buildSomas(nodes, radius);
    this._buildAxons(nodes, radius);
    this._buildArbors(nodes, radius);

    this.nodes = nodes;
    this.radius = radius;
    this.centre = geo.boundingSphere.center.clone();
    // the cortex is a child of the brain holder, so the net has to sit in the same frame
    this.group.applyMatrix4(cortexMesh.matrix);
  }

  _buildSomas(nodes, radius) {
    const n = nodes.length;
    const g = new THREE.BufferGeometry();
    const off = new Float32Array(n * 3), reg = new Float32Array(n);
    const ph = new Float32Array(n), rate = new Float32Array(n), sc = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      nodes[i].p.toArray(off, i * 3);
      reg[i] = nodes[i].region;
      ph[i] = Math.random();
      rate[i] = 0.8 + Math.random() * 2.6;
      // kept on the JS side too, so `fireAt` can answer for a cell without reading back GPU
      // memory — see the note there about the two copies
      nodes[i].phase = ph[i];
      nodes[i].rate = rate[i];
      // a few large cells among many small ones: an even size reads as a particle system
      sc[i] = Math.random() < 0.08 ? 1.7 + Math.random() * 1.3 : 0.55 + Math.random() * 0.55;
    }
    g.setAttribute('position', new THREE.BufferAttribute(off, 3));
    g.setAttribute('aOffset', new THREE.BufferAttribute(off, 3));
    g.setAttribute('aRegion', new THREE.BufferAttribute(reg, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aRate', new THREE.BufferAttribute(rate, 1));
    g.setAttribute('aScale', new THREE.BufferAttribute(sc, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uSize:      { value: 15.0 },
        uMaxSize:   { value: 4.5 },
        // 1 inside the volume, higher when the cells are the whole picture — see setEmphasis
        uGain:      { value: 1.0 },
        uCold:      { value: new THREE.Color(0xFFB870) },
        uHot:       { value: new THREE.Color(0xFFF3D2) },
        uHighlight: { value: new THREE.Color(0x9FE8FF) },
      },
      vertexShader: NODE_VERT, fragmentShader: NODE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true,
    });
    this.somaMat = mat;
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    /* Kept so a pointer can find a cell. `Points.raycast` tests every vertex against a
     * world-space threshold, which for four thousand points is a few hundred microseconds —
     * cheap enough to run on a pointer move, and the reason a soma can be an object you
     * interact with rather than a mark on a picture. */
    this.points = pts;
    this.group.add(pts);
  }

  _buildAxons(nodes, radius) {
    this.edgePairs = [];
    /* Per fibre, once — the vertex attributes carry these twice each, and a reader asking
     * "how fast is that band and why does this fibre exist" needs the answer per fibre. Both
     * are real properties of the build rather than anything measured: the rate is the number
     * the shader animates with, and the flag says which of the two construction rules put the
     * fibre there. */
    this.edgeRates = [];
    this.edgeLong = [];
    const grid = gridOf(nodes, radius * 0.09);
    const P = [], A = [], R = [], PH = [], RT = [], LG = [];
    const seen = new Set();
    const push = (i, j, long) => {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      // the pair itself, so the connectome can bundle the real fibres rather than a summary
      this.edgePairs.push(i, j);
      const a = nodes[i].p, b = nodes[j].p;
      P.push(a.x, a.y, a.z, b.x, b.y, b.z);
      A.push(0, 1);
      R.push(nodes[i].region, nodes[j].region);
      const ph = Math.random(), rt = 0.7 + Math.random() * 2.4;
      PH.push(ph, ph); RT.push(rt, rt); LG.push(long, long);
      this.edgeRates.push(rt);
      this.edgeLong.push(long);
    };
    for (let i = 0; i < nodes.length; i++) {
      for (const j of nearest(nodes, grid, i, NEAR_K)) push(i, j, 0);
      /* Association fibres. A cortex is not a lattice — most of its wiring is local and a
       * small proportion of it crosses to a distant parcel, and it is that minority which
       * makes the network read as *connected* rather than as a mesh. */
      if (Math.random() < LONG_P) {
        const j = (Math.random() * nodes.length) | 0;
        if (j !== i && nodes[j].region !== nodes[i].region) push(i, j, 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(A), 1));
    g.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array(R), 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(PH), 1));
    g.setAttribute('aRate', new THREE.BufferAttribute(new Float32Array(RT), 1));
    g.setAttribute('aLong', new THREE.BufferAttribute(new Float32Array(LG), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uDim:       { value: new THREE.Color(0xFFAE73) },
        uPulse:     { value: new THREE.Color(0xFFF0CE) },
        uHighlight: { value: new THREE.Color(0x9FE8FF) },
        // 1 inside the volume, higher when the network is the whole picture — see setEmphasis
        uGain:      { value: 1.0 },
      },
      vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true,
    });
    this.axonMat = mat;
    // kept so `regionGraph` can count what was actually built rather than re-deriving it
    this.axonRegions = g.getAttribute('aRegion').array;
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    this.edgeCount = A.length / 2;
    this.group.add(lines);
  }

  /**
   * Dendritic arbors: a short spray of branching segments off a fraction of the somas.
   *
   * This is the difference between a star field and a nervous system. A soma alone is a dot
   * however brightly it is drawn; a soma with three or four branches that fork once or twice
   * is legible as a *cell* even when it is four pixels across, because the silhouette is the
   * thing the eye recognises.
   */
  _buildArbors(nodes, radius) {
    const P = [], A = [], R = [], PH = [], RT = [], LG = [];
    const len = radius * 0.035;
    const dir = new THREE.Vector3(), tip = new THREE.Vector3(), from = new THREE.Vector3();
    for (const nd of nodes) {
      if (Math.random() > ARBOR_P) continue;
      for (let b = 0; b < ARBOR_BRANCHES; b++) {
        from.copy(nd.p);
        dir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        const ph = Math.random(), rt = 0.7 + Math.random() * 2.4;
        for (let s = 0; s < ARBOR_SEGS; s++) {
          // each segment shorter than the last and bent off the previous heading: that taper
          // is what makes it read as a branch rather than as a bent stick
          const step = len * Math.pow(0.62, s);
          dir.x += (Math.random() - 0.5) * 0.9;
          dir.y += (Math.random() - 0.5) * 0.9;
          dir.z += (Math.random() - 0.5) * 0.9;
          dir.normalize();
          tip.copy(from).addScaledVector(dir, step);
          P.push(from.x, from.y, from.z, tip.x, tip.y, tip.z);
          // along-edge runs outward from the soma, so a pulse leaves the cell body
          A.push(s / ARBOR_SEGS, (s + 1) / ARBOR_SEGS);
          R.push(nd.region, nd.region);
          PH.push(ph, ph); RT.push(rt, rt); LG.push(0, 0);
          from.copy(tip);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(A), 1));
    g.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array(R), 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(PH), 1));
    g.setAttribute('aRate', new THREE.BufferAttribute(new Float32Array(RT), 1));
    g.setAttribute('aLong', new THREE.BufferAttribute(new Float32Array(LG), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uDim:       { value: new THREE.Color(0xFF9E5E) },
        uPulse:     { value: new THREE.Color(0xFFE9BC) },
        uHighlight: { value: new THREE.Color(0x9FE8FF) },
        /* Shares EDGE_FRAG with the axons, so it has to carry every uniform that shader
         * declares. A uniform declared in GLSL and not supplied here reads as zero, which for
         * a gain means the dendrites simply stop being drawn — silently, and only in the look
         * that turns the gain up. */
        uGain:      { value: 1.0 },
      },
      vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true,
    });
    this.arborMat = mat;
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    this.arborCount = A.length / 2;
    this.group.add(lines);
  }

  /** One float per frame — everything else animates in the shader. */
  tick(t) {
    for (const m of [this.somaMat, this.axonMat, this.arborMat])
      if (m) m.uniforms.uTime.value = t;
  }

  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  /** Global drive: how awake the whole network is. */
  setActivity(v) {
    for (const m of [this.somaMat, this.axonMat, this.arborMat])
      if (m) m.uniforms.uActivity.value = v;
  }

  /** Which parcel is selected, so its own cells brighten and the rest fall back. */
  /**
   * Does the network actually contain cells from this region?
   *
   * The cells are sampled from the cortex, so no subcortical structure has any — and
   * `setSelected` dims every cell that is not the selected one. Selecting the thalamus
   * therefore dimmed the whole network to a fifth and lit nothing, which reads as the picture
   * breaking rather than as "this structure has no cells here".
   */
  hasRegion(id) {
    if (this._regions == null) this._regions = new Set(this.nodes.map(n => n.region));
    return this._regions.has(Math.round(id));
  }

  setSelected(id) {
    for (const m of [this.somaMat, this.axonMat, this.arborMat])
      if (m) m.uniforms.uSelected.value = id ?? -1;
  }

  /** Where the scan plane is, in the same object frame the nodes were sampled in. */
  setScan(axis, at) {
    for (const m of [this.somaMat, this.axonMat, this.arborMat]) {
      if (!m) continue;
      if (!axis) { m.uniforms.uScanAxis.value.set(0, 0, 0); continue; }
      m.uniforms.uScanAxis.value.copy(axis).normalize();
      m.uniforms.uScanCentre.value.copy(this.centre);
      m.uniforms.uScanAt.value = at * this.radius;
      m.uniforms.uScanWidth.value = this.radius * 0.05;
    }
  }

  /**
   * How hard one cell is firing, right now.
   *
   * **This is the vertex shader's `vFire`, written a second time.** The two must be changed
   * together — the same rule `dqs.js` already carries for the skinning blend, and for the same
   * reason: the GPU owns the animation and the CPU has to be able to answer a question about
   * it without reading memory back. If they drift, the probe reports a number the picture is
   * not showing, which is the one thing this readout must never do.
   */
  fireAt(i, t) {
    const n = this.nodes[i];
    if (!n) return 0;
    const act = this.act.data[Math.round(n.region)] ?? 0;
    const drive = Math.min(1.6, Math.max(0, this.somaMat.uniforms.uActivity.value * 0.5 + act));
    const f = Math.sin(t * n.rate + n.phase * 6.2831);
    const k = 6.0 + (1.4 - 6.0) * Math.min(1, Math.max(0, drive));   // mix(6.0, 1.4, drive)
    return Math.pow(Math.max(f, 0), k) * (0.25 + drive);
  }

  /**
   * The cell nearest a ray, with the parcel it belongs to.
   *
   * The threshold is a fraction of the organ rather than a constant: the same ray has to
   * find a cell whether the camera is outside the head or inside the cortex, and a fixed
   * world-space radius picks nothing at one end and everything at the other.
   */
  pickNode(raycaster) {
    if (!this.points) return null;
    const prev = raycaster.params.Points.threshold;
    raycaster.params.Points.threshold = this.radius * 0.018;
    const hits = raycaster.intersectObject(this.points, false);
    raycaster.params.Points.threshold = prev;
    if (!hits.length) return null;
    const h = hits[0];
    const n = this.nodes[h.index];
    if (!n) return null;
    return { index: h.index, region: n.region, point: h.point.clone() };
  }

  /**
   * Turn the network up when it is the whole picture.
   *
   * Inside the volume these values are tuned to sit *under* tissue — a soma has to be legible
   * through several walls of cortex without summing to a hole, which is why `uSize` is what it
   * is and why the point size is clamped hard. With the tissue gone that same tuning reads as
   * a thin scatter of dust in an empty frame, because there is nothing left for the cells to
   * be inside of. The clamp is still a clamp: a soma stands for a population far below this
   * model's resolution, so near is brighter and busier, never bigger without limit.
   */
  setEmphasis(on) {
    if (this._emph === !!on) return;
    this._emph = !!on;
    const u = this.somaMat?.uniforms;
    if (u) {
      u.uSize.value = on ? 26.0 : 15.0;
      u.uMaxSize.value = on ? 7.0 : 4.5;
      u.uGain.value = on ? 4.2 : 1.0;
    }
    /* The fibres get more than the somas do. In the volume you read the network mostly as a
     * field of points, because the tissue behind it supplies the mass; alone, it is the
     * *threads* that make it a network rather than a star field, and the travelling spike on
     * them is the only thing in the picture that is actually moving. */
    if (this.axonMat?.uniforms?.uGain) this.axonMat.uniforms.uGain.value = on ? 5.5 : 1.0;
    if (this.arborMat?.uniforms?.uGain) this.arborMat.uniforms.uGain.value = on ? 4.0 : 1.0;
  }

  setRegionActivity(id, v) { this.act.set(id, v); }
  clearRegionActivity() { this.act.clear(); }

  stats() {
    return {
      nodes: this.nodes.length, axons: this.edgeCount, dendrites: this.arborCount,
      // so a probe can see whether the emphasis actually reached the shaders
      emphasis: !!this._emph,
      gain: [this.somaMat?.uniforms?.uGain?.value, this.axonMat?.uniforms?.uGain?.value],
      size: this.somaMat?.uniforms?.uSize?.value,
    };
  }

  /**
   * The network collapsed to one node per anatomical region.
   *
   * Counted out of the buffers that were actually built rather than re-derived, so it can only
   * report what is in the picture. A region's weight is how many of its cells there are; an
   * edge's weight is how many axons in this network run between those two regions.
   *
   * **This is not a connectome and the panel that draws it says so.** The edges here are the
   * nearest-neighbour links and the small fraction of long-range ones that `_buildAxons` made;
   * they are a schematic of local connectivity, not tractography, and no claim is made about
   * which region projects to which in a real brain. What it is honestly good for is showing
   * which parcels are large, which sit near each other, and which the scan or a selection is
   * currently driving — all of which are true of this model.
   *
   * Positions are each region's own centroid in the brain's frame, so the layout is anatomy
   * rather than a force simulation: a node is where that part of the cortex actually is.
   */
  /**
   * The network as it actually is: every cell, and every fibre as a pair of cell indices.
   *
   * `regionGraph` collapses this to one node per parcel, which is the right summary for a map
   * and the wrong one for a connectome — a bundled diagram is dense because there really are
   * thousands of fibres, and a picture drawn from sixty region-pair totals cannot be. This
   * hands over the same arrays the GPU is drawing, so the diagram is the network rather than a
   * likeness of it.
   *
   * Positions come out in the brain's own frame. Nothing is copied: the caller gets typed
   * arrays it must not write to.
   */
  cellGraph() {
    return {
      count: this.nodes.length,
      region: i => this.nodes[i].region,
      pos: i => this.nodes[i].p,
      pairs: this.edgePairs ?? [],
      /* Per fibre, indexed by its position in `pairs` divided by two. `rate` is the shader's
       * own animation rate for that band — `BAND_RATE` below converts it to a traversal time —
       * and `long` says whether the fibre came from the nearest-neighbour pass or from the
       * long-range association pass. Neither is a measurement of anything. */
      rate: k => this.edgeRates?.[k] ?? 0,
      long: k => !!this.edgeLong?.[k],
    };
  }

  /** The constant the axon shader advances its band by, so a readout can agree with the picture. */
  static BAND_RATE = BAND_RATE;

  regionGraph() {
    const nodes = new Map();
    for (const n of this.nodes) {
      /* Region 0 is "no parcel". A cortex vertex can carry it where the atlas has no label —
       * the medial wall, mostly — and those cells are real and are drawn, but they do not
       * belong to a named region and a graph node standing for them would have no name, no
       * colour and nothing true to say. */
      if (!(n.region > 0)) continue;
      let e = nodes.get(n.region);
      if (!e) nodes.set(n.region, e = { region: n.region, count: 0, x: 0, y: 0, z: 0 });
      e.count++; e.x += n.p.x; e.y += n.p.y; e.z += n.p.z;
    }
    for (const e of nodes.values()) { e.x /= e.count; e.y /= e.count; e.z /= e.count; }

    const edges = new Map();
    const R = this.axonRegions;
    for (let i = 0; R && i + 1 < R.length; i += 2) {
      const a = Math.round(R[i]), b = Math.round(R[i + 1]);
      // within one parcel is not a link between regions; unparcellated has no region to link
      if (a === b || a <= 0 || b <= 0) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    return {
      nodes: [...nodes.values()].sort((p, q) => q.count - p.count),
      edges: [...edges].map(([k, w]) => {
        const [a, b] = k.split(',').map(Number);
        return { a, b, w };
      }).sort((p, q) => q.w - p.w),
    };
  }
}
