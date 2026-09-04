import * as THREE from 'three';

/**
 * The rigid-body skeleton, driven by OpenSim's own joint definitions.
 *
 * Bones do not deform, so this is a hierarchy of joint nodes with meshes parented to them —
 * no skinning, which is both easier and more anatomically correct than deforming a bone.
 * The tree, the joint offsets and the rotation axis of every coordinate come from
 * `src/generated/rig.json`, which scripts/parse_opensim.py extracts from the Rajagopal 2016
 * model. Nothing here is a joint position somebody typed in.
 *
 * Two things in that file are not Rajagopal's. `scripts/build_spine.py` replaces the single
 * lumbar joint with 24 vertebral joints taken from this body's own intervertebral disc
 * centroids, and `tools/fitjoints.mjs` moves each limb joint's centre of rotation to the
 * point that keeps this body's two bones together through the joint's whole range — up to
 * 106 mm at the wrist. Neither is typed in either: one is a measurement of this anatomy, the
 * other is solved against it. The rotation axes, the coupled functions and the published
 * ranges are untouched by both.
 *
 * The whole rig lives under one root node carrying the registration (scale, rotation,
 * translation) that puts OpenSim's metres into the body frame. Inside that root everything
 * stays in the model's own units and axes, so joint offsets, rotation axes and muscle path
 * points are used exactly as published rather than pre-multiplied on the way through.
 *
 * Meshes are attached at their **bind pose**: a mesh keeps its body-frame geometry and gets
 * a local matrix of inverse(segment world matrix at the default pose), so at rest it does
 * not move at all and under a pose it follows its segment rigidly. That is what lets a body
 * built from one source ride a skeleton defined by another.
 */
/**
 * Evaluate a joint axis's transform function, as `parse_opensim.py` emitted it.
 *
 * A `TransformAxis` in OpenSim is a function of a coordinate, not the coordinate itself, and
 * for the knee that distinction is the whole joint. `knee_angle_r` drives two translations
 * through cubic splines whose entire range is about seven millimetres; treating the radian
 * value as the translation put the tibia more than a body height in front of the femur at 90
 * degrees of flexion, and every deep squat, kneel and tuck in the library came apart.
 *
 * Kept byte-identical in behaviour to `apply_function` in the build script, so the
 * registration the build fitted and the pose the viewer draws are the same pose.
 */
export function applyFunction(fn, q) {
  if (!fn) return q;                                  // pre-function rig.json, or a plain axis
  if (fn.kind === 'const') return fn.v;
  if (fn.kind === 'linear') return fn.a * q + fn.b;
  const { x, y } = fn;
  if (!x?.length) return 0;
  if (q <= x[0]) return y[0];
  if (q >= x[x.length - 1]) return y[y.length - 1];
  let i = 0;
  while (i < x.length - 2 && x[i + 1] < q) i++;
  const t = (q - x[i]) / (x[i + 1] - x[i]);
  return y[i] + t * (y[i + 1] - y[i]);
}

export class Rig {
  constructor(data) {
    this.data = data;
    this.nodes = new Map();          // segment name -> THREE.Object3D
    this.coordinates = data.coordinates;
    this.values = {};                // coordinate name -> radians
    this.root = new THREE.Group();
    this.root.name = 'rig';

    const reg = data.registration;
    const m = new THREE.Matrix4().set(
      reg.rotation[0][0], reg.rotation[0][1], reg.rotation[0][2], 0,
      reg.rotation[1][0], reg.rotation[1][1], reg.rotation[1][2], 0,
      reg.rotation[2][0], reg.rotation[2][1], reg.rotation[2][2], 0,
      0, 0, 0, 1);
    this.root.quaternion.setFromRotationMatrix(m);
    this.root.scale.setScalar(reg.scale);
    this.root.position.set(...reg.translation);
    // position is applied in the parent's frame, but scale/rotation are the child's, so the
    // translation has to be set after and must not be scaled by the root's own scale
    this.root.matrixAutoUpdate = true;

    // one node per segment; two nested objects each, so the joint offset and the joint
    // rotation cannot fight over the same transform
    for (const name of Object.keys(data.segments)) this._node(name);
    for (const [name, seg] of Object.entries(data.segments)) {
      const n = this.nodes.get(name);
      const parent = seg.parent && this.nodes.get(seg.parent);
      (parent ?? this.root).add(n.offset);
    }
    this.reset();
  }

  _node(name) {
    if (this.nodes.has(name)) return this.nodes.get(name);
    const seg = this.data.segments[name];
    const offset = new THREE.Group();          // joint location in the parent
    offset.name = `${name}:offset`;
    offset.position.set(...seg.translation);
    offset.rotation.set(...seg.orientation, 'XYZ');
    const joint = new THREE.Group();           // the rotating part
    joint.name = name;
    offset.add(joint);
    // the child frame's own offset, inverted: OpenSim expresses the joint in both frames
    /* The child frame, inverted.
     *
     * OpenSim expresses a joint in both bodies' frames: the parent's offset frame and the
     * child's. Getting from the joint to the child *body* means undoing the child's offset
     * frame, and that frame has a rotation as well as a translation —
     * `inverse(T(t) . R(o))` is `R(o)^T . T(-t)`, which as a local transform is
     * `position = R^T . (-t)`, `quaternion = R^T`.
     *
     * This used to apply `T(-t)` alone and drop the rotation. Fourteen of Rajagopal's
     * joints carry a non-zero child orientation — both knees, both ankles, both feet, and
     * every joint of both arms below the shoulder — and the wrist's is two right angles.
     * So the runtime rig disagreed with the forward kinematics the registration was fitted
     * against, worst exactly where the rotation was largest: the hand hung a hand's length
     * from its own wrist and swung about a pivot that was not there.
     */
    const body = new THREE.Group();
    body.name = `${name}:body`;
    const childQ = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(...(seg.childOrientation ?? [0, 0, 0]), 'XYZ')).invert();
    body.quaternion.copy(childQ);
    body.position.set(...seg.childTranslation).negate().applyQuaternion(childQ);
    joint.add(body);
    const rec = { offset, joint, body, seg, add: o => body.add(o) };
    rec.position = new THREE.Vector3();
    this.nodes.set(name, rec);
    return rec;
  }

  /** Every coordinate back to its default. */
  reset() {
    for (const [name, c] of Object.entries(this.coordinates)) this.values[name] = c.default ?? 0;
    this.apply();
  }

  /** The spine chain, caudal to cranial, for anything that wants to walk it. */
  get spine() { return this.data.spine ?? null; }

  /**
   * Write the current coordinate values onto the nodes.
   *
   * A joint imposes T(p) . R between its frames — rotations about the parent frame's axes,
   * then an offset along the translation axes — and three composes a node's matrix in
   * exactly that order, so position and quaternion on one node is the whole transform.
   *
   * Translation axes are read from the model rather than special-cased for the pelvis. It is
   * the only free joint in this model today, but hard-coding that meant the default pose
   * silently differed between the build (which computed 0) and the viewer (which applied
   * the model's real pelvis_ty of about 0.94 m), and the whole rig sat half a body-height
   * above the anatomy it was supposed to be driving.
   */
  apply() {
    const q = new THREE.Quaternion(), tmp = new THREE.Quaternion();
    const axis = new THREE.Vector3(), pos = new THREE.Vector3();
    for (const [, rec] of this.nodes) {
      q.identity();
      for (const a of rec.seg.axes) {
        const v = applyFunction(a.fn, this.values[a.coordinate] ?? 0);
        if (!v) continue;
        axis.set(...a.axis).normalize();
        q.multiply(tmp.setFromAxisAngle(axis, v));
      }
      rec.joint.quaternion.copy(q);
      pos.set(0, 0, 0);
      for (const a of rec.seg.translationAxes ?? []) {
        const v = applyFunction(a.fn, this.values[a.coordinate] ?? 0);
        if (v) pos.addScaledVector(axis.set(...a.axis), v);
      }
      rec.joint.position.copy(pos);
    }
    this.root.updateMatrixWorld(true);
  }

  set(name, value) {
    const c = this.coordinates[name];
    if (!c) return;
    const [lo, hi] = c.range;
    this.values[name] = Math.max(lo, Math.min(hi, value));
  }

  /**
   * Regional spine commands, distributed across the levels that make up that region.
   *
   * Authoring 24 vertebral angles per keyframe would be unusable, and averaging them evenly
   * would be wrong — L5-S1 contributes 20 degrees of sagittal motion and T3-T4 contributes
   * four. Each level therefore takes a share of the regional command proportional to its own
   * published range, so "40 degrees of lumbar flexion" lands where a lumbar spine actually
   * puts it.
   *
   * `wave` is what makes segmental articulation possible at all. It is a front sweeping
   * along the region: at 0 only the leading end has begun, and by about 1.5 every level is
   * fully engaged. A roll-up is exactly this — the head goes first and the front travels
   * down the spine — and it is the thing the single-lumbar-joint rig could not represent.
   * The sign picks the direction, which the body genuinely does both ways: positive peels
   * cranial to caudal (a roll-up), negative caudal to cranial (a shoulder bridge).
   *
   * Values are clamped per joint by `set`, so a regional command larger than the region's
   * published travel quietly flattens against the limit rather than throwing. `regionRange`
   * is what that travel is, and `test/library.test.mjs` checks no pose exceeds it.
   *
   * @param {string} region 'lumbar' | 'thoracic' | 'cervical'
   * @param {{flex?:number, bend?:number, rot?:number, wave?:number}} cmd angles in radians;
   *   `wave` is a sweep position of roughly -1.5..1.5, not an angle
   */
  setSpineRegion(region, cmd) {
    const levels = this.data.spine?.regions?.[region];
    if (!levels) return;
    const share = this.data.spine.share[region];
    const wave = cmd.wave;
    const n = levels.length;
    levels.forEach((seg, i) => {
      // levels are listed caudal to cranial, so p = 1 at the cranial end where a peel starts
      const p = n > 1 ? i / (n - 1) : 1;
      let w = 1;
      if (wave != null) {
        // A travelling front, so a region can engage one segment at a time instead of all
        // at once. Positive sweeps cranial to caudal — a roll-up, which peels head first.
        // Negative sweeps the other way — a shoulder bridge, which peels from the tail up.
        // |wave| runs 0 to about 1.5: past 1 the far end of the region is fully engaged.
        const BAND = 0.34;                    // how soft the front is
        const q = wave < 0 ? p : 1 - p;       // how far along the sweep this level sits
        w = Math.max(0, Math.min(1, ((Math.abs(wave) - q) / BAND) + 0.5));
      }
      for (const axis of ['flex', 'bend', 'rot']) {
        const total = cmd[axis];
        if (total == null) continue;
        // share is per axis: a level's slice of a side bend is not its slice of a rotation
        this.set(`${seg}_${axis}`, total * share[axis][seg] * w);
      }
    });
  }

  /**
   * Set coordinates, expanding the regional spine shorthands the clips are written in.
   * `lumbar_flex` is a command for a region; `L3_flex` is a command for one joint. Both work.
   */
  setAll(values) {
    /* Every pose is stated in full, so this starts from the model's defaults rather than
     * from whatever the last pose left behind. Without it a coordinate the new pose does not
     * mention keeps the old value: selecting the Hundred and then Warrior II left
     * `pelvis_tilt` at 90 — Warrior II never names it — and the standing pose performed
     * itself lying on its back, inside every published range and passing every test, because
     * the tools that draw the poses all call `reset()` first and the app did not. */
    for (const [name, c] of Object.entries(this.coordinates)) this.values[name] = c.default ?? 0;
    const spine = {};
    for (const [k, v] of Object.entries(values)) {
      const m = /^(lumbar|thoracic|cervical)_(flex|bend|rot|wave)$/.exec(k);
      if (m) { (spine[m[1]] ??= {})[m[2]] = v; continue; }
      this.set(k, v);
    }
    for (const [region, cmd] of Object.entries(spine)) this.setSpineRegion(region, cmd);
    this.apply();
  }

  /** True when a name is a regional shorthand rather than a real joint coordinate. */
  static isRegional(name) {
    return /^(lumbar|thoracic|cervical)_(flex|bend|rot|wave)$/.test(name);
  }

  /**
   * Usable travel of a regional spine command, in radians, as emitted by build_spine.py.
   * A value outside it drives at least one vertebral joint past its published limit.
   */
  regionRange(region, axis) {
    return this.data.spine?.regionRange?.[region]?.[axis] ?? null;
  }

  /** Record every segment's world matrix at the current (default) pose. */
  captureBindPose() {
    this.root.updateMatrixWorld(true);
    this.bind = new Map();
    for (const [name, rec] of this.nodes)
      this.bind.set(name, rec.body.matrixWorld.clone().invert());
  }

  /**
   * Attach a mesh that is already in body-frame coordinates to a segment, without moving it.
   * @returns the segment name it was bound to, or null
   */
  attach(object, segment) {
    const rec = this.nodes.get(segment);
    if (!rec || !this.bind) return null;
    object.updateWorldMatrix(true, false);
    const world = object.matrixWorld.clone();
    rec.add(object);
    object.matrix.copy(this.bind.get(segment)).multiply(world);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrixWorld(true);
    return segment;
  }

  /** Segment a structure's mesh belongs to, from the generated binding table. */
  segmentFor(name, side) {
    return this.data.binding[`${name}|${side}`] ?? this.data.binding[`${name}|M`] ?? null;
  }

  /** World position of a point given in a segment's local (OpenSim) frame. */
  pointInSegment(segment, p, target = new THREE.Vector3()) {
    const rec = this.nodes.get(segment);
    if (!rec) return target.set(0, 0, 0);
    return target.set(p[0], p[1], p[2]).applyMatrix4(rec.body.matrixWorld);
  }
}
