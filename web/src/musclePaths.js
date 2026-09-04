import * as THREE from 'three';

/**
 * OpenSim muscle paths — origin, via points, insertion — swept as tubes that follow the rig.
 *
 * This is the animatable, physiologically grounded representation the brief asks for. The
 * detailed mesh is the anatomical picture; this is the mechanical one, and it is the source
 * of truth for anything numeric. Muscle-tendon length falls straight out of the geometry,
 * so as the skeleton moves the length changes for real rather than being asserted.
 *
 * What the numbers mean, exactly:
 *   length          the sum of the path segments, in metres, at the current pose
 *   normalised      length / length at the model's default pose. Above 1 the muscle-tendon
 *                   unit is longer than it is at anatomical neutral; below 1, shorter.
 *   maxIsometricForce, optimalFiberLength, tendonSlackLength, pennationAngle
 *                   published parameters of the actuator, carried through unchanged.
 *
 * Activation is *not* computed here. Solving for activation needs a dynamic simulation with
 * external loads, which this is not, and inventing a number would be exactly the kind of
 * confident nonsense the project exists to avoid. What drives the colour is the authored
 * per-phase activation from src/content/motion.js, and the legend says so.
 */

const TUBE_RADIUS = 0.0026;   // body-frame units; a muscle path is a line, not a volume

export class MusclePaths {
  /**
   * @param {object} data parsed src/generated/muscle_paths.json
   * @param {import('./rig.js').Rig} rig
   */
  constructor(data, rig) {
    this.data = data;
    this.rig = rig;
    this.group = new THREE.Group();
    this.group.name = 'musclePaths';
    this.entries = [];
    this.byStructure = new Map();   // structure name -> [entry]

    for (const m of data.muscles) {
      const pts = m.points.filter(p => rig.nodes.has(p.body));
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(
        pts.map(() => new THREE.Vector3()), false, 'catmullrom', 0.2);
      const geo = new THREE.TubeGeometry(curve, Math.max(12, pts.length * 6), TUBE_RADIUS, 6, false);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xE2685F, transparent: true, opacity: 0.9, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 8;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const e = { ...m, pts, curve, geo, mesh, mat, restLength: 0, length: 0 };
      this.entries.push(e);
      if (m.mapsTo) {
        if (!this.byStructure.has(m.mapsTo)) this.byStructure.set(m.mapsTo, []);
        this.byStructure.get(m.mapsTo).push(e);
      }
    }
    this.update();
    for (const e of this.entries) e.restLength = e.length;
  }

  /** Recompute every path from the rig's current pose. */
  update() {
    const v = new THREE.Vector3();
    for (const e of this.entries) {
      let len = 0;
      for (let i = 0; i < e.pts.length; i++) {
        const p = e.pts[i];
        this.rig.pointInSegment(p.body, p.p, v);
        e.curve.points[i].copy(v);
        if (i) len += e.curve.points[i].distanceTo(e.curve.points[i - 1]);
      }
      e.length = len;
      if (e.mesh.visible) {
        e.curve.updateArcLengths?.();
        const geo = new THREE.TubeGeometry(e.curve, Math.max(12, e.pts.length * 6),
                                           TUBE_RADIUS, 6, false);
        e.mesh.geometry.dispose();
        e.mesh.geometry = geo;
      }
    }
  }

  /** Colour each path by the activation it has been given, on a labelled ramp. */
  paint(activationOf) {
    for (const e of this.entries) {
      const a = e.mapsTo ? (activationOf(e.mapsTo) ?? 0) : 0;
      e.mat.color.copy(RAMP(a));
      e.mat.opacity = 0.35 + 0.6 * a;
    }
  }

  setVisible(on) {
    this.group.visible = on;
    for (const e of this.entries) e.mesh.visible = on;
  }

  /** Length report for one of this project's named structures, or null. */
  report(structureName) {
    const list = this.byStructure.get(structureName);
    if (!list?.length) return null;
    const len = list.reduce((s, e) => s + e.length, 0) / list.length;
    const rest = list.reduce((s, e) => s + e.restLength, 0) / list.length;
    return {
      actuators: list.map(e => e.name),
      lengthM: len,
      normalised: rest > 0 ? len / rest : 1,
      maxIsometricForce: Math.max(...list.map(e => e.maxIsometricForce)),
      optimalFiberLength: list[0].optimalFiberLength,
      tendonSlackLength: list[0].tendonSlackLength,
      pennationAngle: list[0].pennationAngle,
    };
  }
}

/**
 * Sequential colour ramp for the activation scale, with a legend beside it in the UI.
 * An unlabelled red glow reads as data while meaning nothing, so this one is always shown
 * with its numeric scale and with a statement of what the number is.
 */
const STOPS = [
  [0.00, new THREE.Color('#2b3242')],
  [0.25, new THREE.Color('#3f6fa8')],
  [0.50, new THREE.Color('#67a89b')],
  [0.75, new THREE.Color('#E9A13B')],
  [1.00, new THREE.Color('#E2503F')],
];
const _c = new THREE.Color();
export function RAMP(t) {
  t = Math.max(0, Math.min(1, t || 0));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
      return _c.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
    }
  }
  return _c.copy(STOPS[STOPS.length - 1][1]);
}

export const RAMP_STOPS = STOPS.map(([t, c]) => [t, '#' + c.getHexString()]);
