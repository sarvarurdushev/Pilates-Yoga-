import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { get, nameOf } from './structures.js';

/**
 * The network in three dimensions, in a panel, orbitable, with the brain's own surface round it.
 *
 * The ring diagram is a projection and throws two things away that a reader keeps asking for:
 * depth, and the ability to look at it from somewhere else. This is the same cells and the same
 * fibres in the positions they actually occupy, in their own scene, with their own camera —
 * so a region is not a slice of a circle but a place, and turning the view is how you find out
 * what is behind what.
 *
 * It borrows the cortex geometry rather than copying it: the surface drawn here is the same
 * buffer the main stage draws, at a low opacity, so the cells sit inside a brain rather than
 * floating in a box. Nothing is modelled and nothing is drawn by hand.
 *
 * Its own renderer, not the app's. The main renderer belongs to a composed pipeline pointed at
 * the stage, and lending it out mid-frame is how `sections.js` nearly drew the whole scene into
 * a thumbnail. A second context costs one more canvas and removes that whole class of bug.
 */

const SOMA_VERT = `
attribute float aRegion;
attribute float aPhase;
attribute float aRate;
uniform float uTime, uSize, uSelected, uDpr;
varying float vFire;
varying float vSel;
void main() {
  vSel = (uSelected >= 0.0 && abs(aRegion - uSelected) < 0.5) ? 1.0 : 0.0;
  float f = sin(uTime * aRate + aPhase * 6.2831);
  vFire = pow(max(f, 0.0), mix(6.0, 1.8, vSel)) * (0.3 + vSel * 0.9);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // clamped for the same reason as the main network: a soma is a symbol, not a measurement
  gl_PointSize = clamp(uSize * uDpr * (0.6 + vFire) / max(0.02, -mv.z), 1.0, 9.0 * uDpr);
}`;

const SOMA_FRAG = `
precision highp float;
uniform vec3 uCold, uHot, uHighlight;
uniform float uSelected;
varying float vFire;
varying float vSel;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = pow(1.0 - r, 3.2), halo = pow(1.0 - r, 1.1) * 0.3;
  vec3 c = mix(uCold, uHot, clamp(vFire, 0.0, 1.0));
  if (vSel > 0.5) c = mix(c, uHighlight, 0.85);
  float dim = (uSelected >= 0.0 && vSel < 0.5) ? 0.12 : 1.0;
  gl_FragColor = vec4(c * (core + halo) * (0.3 + vFire * 1.4) * dim * (1.0 + vSel * 1.8), 1.0);
}`;

const EDGE_VERT = `
attribute float aAlong;
attribute float aRegion;
attribute float aPhase;
attribute float aRate;
uniform float uSelected;
varying float vAlong, vPhase, vRate, vSel;
void main() {
  vAlong = aAlong; vPhase = aPhase; vRate = aRate;
  vSel = (uSelected >= 0.0 && abs(aRegion - uSelected) < 0.5) ? 1.0 : 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const EDGE_FRAG = `
precision highp float;
uniform float uTime, uSelected;
uniform vec3 uDim, uPulse, uHighlight;
varying float vAlong, vPhase, vRate, vSel;
void main() {
  // the travelling impulse, exactly as the main network draws it: one band per fibre
  float head = fract(uTime * vRate * 0.16 + vPhase);
  float d = abs(vAlong - head);
  d = min(d, 1.0 - d);
  float spike = exp(-d * d * 900.0);
  float base = 0.10;
  vec3 c = uDim * base + uPulse * spike * 0.8;
  if (vSel > 0.5) c += uHighlight * (base * 7.0 + spike * 1.4);
  else if (uSelected >= 0.0) c *= 0.12;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Connectome3D {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'c3d';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.ready = false;
    this.w = 0; this.h = 0;
    this.selected = -1;
    this.hover = -1;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  /** Deferred until the panel is on screen: a renderer for a hidden canvas is a wasted context. */
  init() {
    if (this.renderer) return true;
    try {
      /* `preserveDrawingBuffer` for the same reason the main renderer has it: without it the
       * drawing buffer is cleared once presented, so anything that reads the canvas back —
       * a capture, or a test asking whether this panel drew anything at all — gets a blank
       * rectangle and cannot tell a working scene from a broken one. */
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true,
                                                alpha: true, preserveDrawingBuffer: true });
    } catch { return false; }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.85;
    return true;
  }

  /**
   * Build from the live network and the live cortex.
   *
   * @param cell   `NeuralNet.cellGraph()` — positions, regions and fibre pairs
   * @param cortex the cortex mesh, for its geometry; shared, never copied
   */
  build(cell, cortex) {
    if (!cell?.count || this.built) return this.built;
    this.group.clear();

    const n = cell.count;
    const pos = new Float32Array(n * 3);
    const reg = new Float32Array(n);
    const ph = new Float32Array(n);
    const rt = new Float32Array(n);
    const centre = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = cell.pos(i);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      reg[i] = cell.region(i);
      ph[i] = Math.random();
      rt[i] = 0.7 + Math.random() * 2.2;
      centre.add(p);
    }
    centre.divideScalar(n);
    let radius = 0;
    for (let i = 0; i < n; i++)
      radius = Math.max(radius, centre.distanceTo(new THREE.Vector3(
        pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])));
    this.centre = centre; this.radius = radius;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRegion', new THREE.BufferAttribute(reg, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aRate', new THREE.BufferAttribute(rt, 1));
    this.somaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSize: { value: 22 }, uSelected: { value: -1 },
        uDpr: { value: Math.min(devicePixelRatio, 2) },
        uCold: { value: new THREE.Color(0xE07B45) },
        uHot: { value: new THREE.Color(0xFFF0D2) },
        uHighlight: { value: new THREE.Color(0x9FE8FF) },
      },
      vertexShader: SOMA_VERT, fragmentShader: SOMA_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.somaMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    // the fibres, as the network built them
    const pairs = cell.pairs;
    const m = pairs.length / 2;
    const ep = new Float32Array(m * 6), ea = new Float32Array(m * 2);
    const er = new Float32Array(m * 2), eph = new Float32Array(m * 2), ert = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      const i = pairs[k * 2], j = pairs[k * 2 + 1];
      ep.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2],
              pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], k * 6);
      ea[k * 2] = 0; ea[k * 2 + 1] = 1;
      er[k * 2] = reg[i]; er[k * 2 + 1] = reg[j];
      const p2 = Math.random(), r2 = 0.7 + Math.random() * 2.4;
      eph[k * 2] = p2; eph[k * 2 + 1] = p2;
      ert[k * 2] = r2; ert[k * 2 + 1] = r2;
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    eg.setAttribute('aAlong', new THREE.BufferAttribute(ea, 1));
    eg.setAttribute('aRegion', new THREE.BufferAttribute(er, 1));
    eg.setAttribute('aPhase', new THREE.BufferAttribute(eph, 1));
    eg.setAttribute('aRate', new THREE.BufferAttribute(ert, 1));
    this.edgeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSelected: { value: -1 },
        uDim: { value: new THREE.Color(0xFF9E5E) },
        uPulse: { value: new THREE.Color(0xFFF0CE) },
        uHighlight: { value: new THREE.Color(0x9FE8FF) },
      },
      vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const lines = new THREE.LineSegments(eg, this.edgeMat);
    lines.frustumCulled = false;
    this.group.add(lines);

    /* The brain around them, from the cortex's own geometry. Back faces only and very faint:
     * a front-facing shell would sit in front of the cells and hide the thing this panel is
     * for, and the far wall alone is enough to read as a head. */
    if (cortex?.geometry) {
      const shell = new THREE.Mesh(cortex.geometry, new THREE.MeshBasicMaterial({
        color: 0x4E6E96, transparent: true, opacity: 0.085,
        side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      shell.frustumCulled = false;
      this.group.add(shell);
      this.shell = shell;
    }

    this.camera.position.copy(centre).add(new THREE.Vector3(radius * 2.1, radius * 0.5,
                                                            radius * 1.5));
    this.controls?.target.copy(centre);
    this.camera.near = radius * 0.05;
    this.camera.far = radius * 20;
    this.camera.updateProjectionMatrix();
    this.built = true;
    this.ready = true;
    return true;
  }

  resize(w, h) {
    if (!this.renderer || (w === this.w && h === this.h) || !w || !h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSelected(id) {
    this.selected = id ?? -1;
    if (this.somaMat) this.somaMat.uniforms.uSelected.value = this.selected;
    if (this.edgeMat) this.edgeMat.uniforms.uSelected.value = this.selected;
  }

  /**
   * Swing the view round to face one region's cells. Returns whether it had any.
   *
   * Choosing a region elsewhere already lights its cells here through `uSelected`, and that is
   * not enough on its own: four thousand additive points fill the box, and a region that
   * happens to be on the far side of the head is lit *behind* the near hemisphere, which reads
   * as nothing having happened — "it should also be automatically chosen in the neural
   * connectome". So the eye moves to where the cells actually are.
   *
   * **The fit is left alone and only the eye swings**, the same rule the structure pair's
   * orbit follows: the target and the distance stay where the build put them, so the picture
   * turns rather than jumping to a new framing. And the caller only calls this when the
   * selection *changes* — running it every draw would fight the reader's own orbit, which is
   * the one thing a turnable panel must never do.
   */
  faceRegion(id) {
    if (!this.points || !this.controls || !(id >= 0)) return false;
    const pos = this.points.geometry.getAttribute('position');
    const reg = this.points.geometry.getAttribute('aRegion');
    if (!pos || !reg) return false;
    const c = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < reg.count; i++) {
      if (Math.round(reg.getX(i)) !== id) continue;
      c.x += pos.getX(i); c.y += pos.getY(i); c.z += pos.getZ(i); n++;
    }
    if (!n) return false;                       // no cells: a fact about the network, not a fault
    c.divideScalar(n);
    const target = this.controls.target;
    const dist = this.camera.position.distanceTo(target);
    const dir = c.clone().sub(target);
    if (dir.lengthSq() < 1e-9) return false;    // a region centred on the target has no side
    this.camera.position.copy(target).addScaledVector(dir.normalize(), dist);
    this.camera.lookAt(target);
    this.controls.update();
    return true;
  }

  /** The region of the cell nearest the pointer, or null. */
  regionAt(x, y) {
    if (!this.points || !this.w) return null;
    this.pointer.set((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Points.threshold = this.radius * 0.02;
    const hit = this.raycaster.intersectObject(this.points, false)[0];
    if (!hit) return null;
    const r = this.points.geometry.getAttribute('aRegion').getX(hit.index);
    return r > 0 ? Math.round(r) : null;
  }

  tick(t) {
    if (!this.renderer || !this.ready) return;
    if (this.somaMat) this.somaMat.uniforms.uTime.value = t;
    if (this.edgeMat) this.edgeMat.uniforms.uTime.value = t;
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** The name under the pointer, for the panel's own readout. */
  label(lang) {
    const id = this.hover >= 0 ? this.hover : this.selected;
    if (!(id >= 0)) return '';
    return nameAndCount(id, lang);
  }

  dispose() {
    this.renderer?.dispose();
    this.controls?.dispose();
  }
}

function nameAndCount(id, lang) {
  const r = get(id);
  return r ? nameOf(id, lang) : '';
}
