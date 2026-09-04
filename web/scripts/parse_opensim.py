"""Extracts a rig and muscle paths from an OpenSim model into the body frame.

This is where "which muscles does this movement use, and how much" stops being a blog claim
and starts being physics. The .osim file carries, as published data:

  * a kinematic tree — bodies, joints, the offset of each joint in its parent, and the axis
    each coordinate rotates about. That is a rig, defined by biomechanists rather than
    drawn by hand, and it is what lets the skeleton animate rigidly.
  * muscle-tendon actuators as **paths** — origin, via points, insertion, each expressed in
    the local frame of the body it attaches to, so the path follows the bones for free.
  * per-muscle max isometric force, optimal fibre length, tendon slack length and pennation
    angle, which are real numbers with units rather than a colour ramp.

Model: Rajagopal A et al., "Full-Body Musculoskeletal Model for Muscle-Driven Simulation of
Human Gait", IEEE Trans Biomed Eng 2016;63(10):2068-79. Distributed by opensim-org.

Registration into BODY_FRAME is measured: the model ships bone geometry, so bones present in
both models are matched by name and a similarity is fitted by Umeyama — the same method
derive_frame.py uses for the brain. The residual is printed.

Emits:
    src/generated/rig.json           segments, joints, coordinates, and the registration
    src/generated/muscle_paths.json  path points in segment-local metres, plus parameters
"""
import sys, os, re, json
import xml.etree.ElementTree as ET
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from derive_frame import umeyama

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSIM = os.path.join(ROOT, 'bpdata', 'osim', 'Rajagopal2016.osim')
GEOM = os.path.join(ROOT, 'bpdata', 'osim', 'Geometry')
TABLE = os.path.join(ROOT, 'src', 'generated', 'structures.json')
OUT = os.path.join(ROOT, 'src', 'generated')

CITATION = ('Rajagopal A, Dembia CL, DeMers MS, Delp DD, Hicks JL, Delp SL. '
            'Full-Body Musculoskeletal Model for Muscle-Driven Simulation of Human Gait. '
            'IEEE Trans Biomed Eng. 2016;63(10):2068-79')
LICENCE = 'Apache-2.0 (OpenSim); model files redistributable via opensim-org/opensim-models'

# OpenSim body -> the structures in this project's skeleton that ride on it. Matched against
# the built structure name; `side` picks which of the per-side meshes goes to which segment.
FINGERS = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger']
TOES = ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe']


def _phalanges(digits):
    # BodyParts3D names every phalanx individually; the thumb and the big toe have two
    return [f'{part} phalanx of {d}' for d in digits
            for part in ('proximal', 'middle', 'distal')]


# Which of this project's bones ride which segment of the rig.
#
# **A bone left out of this table falls through to the torso**, and a torso-bound bone does
# not move when its limb does. Twenty-eight phalanges, five metacarpals, both interosseous
# membranes and half the foot were missing, so every finger and toe bone stayed behind at
# the chest while the hand walked away — a hundred and one meshes of the two hundred and
# forty-five, which is why a raised arm trailed a scatter of small white bones. Anything
# genuinely part of the trunk is listed under TORSO_BONES below rather than left to fall
# through, so a bone that is merely missing shows up as missing.
SEGMENT_BONES = {
    'pelvis': ['hip bone', 'sacrum', 'pubic symphysis'],
    'femur':  ['femur'],
    'tibia':  ['tibia', 'fibula', 'interosseous membrane of leg'],
    'patella': ['patella'],
    'talus':  ['talus'],
    'calcn':  ['calcaneus', 'cuboid bone', 'navicular bone', 'navicular bone of foot',
               'lateral cuneiform bone', 'intermediate cuneiform bone',
               'medial cuneiform bone', 'long plantar ligament'],
    'toes':   ['skeleton of foot', 'first metatarsal bone', 'second metatarsal bone',
               'third metatarsal bone', 'fourth metatarsal bone', 'fifth metatarsal bone',
               'sesamoid bone of foot'] + _phalanges(TOES),
    'humerus': ['humerus'],
    'ulna':   ['ulna', 'interosseous membrane of forearm'],
    'radius': ['radius'],
    'hand':   ['skeleton of hand', 'scaphoid', 'lunate', 'capitate', 'hamate', 'trapezium',
               'trapezoid', 'triquetral bone', 'triquetral', 'pisiform',
               'first metacarpal bone', 'second metacarpal bone', 'third metacarpal bone',
               'fourth metacarpal bone', 'fifth metacarpal bone'] + _phalanges(FINGERS),
    'skull':  ['ethmoid', 'eyeball', 'frontal bone', 'inferior nasal concha', 'mandible',
               'maxilla', 'nasal bone', 'occipital bone', 'palatine bone', 'parietal bone',
               'sphenoid bone', 'temporal bone', 'vomer', 'zygomatic bone', 'hyoid bone'],
}
# The trunk really is one rigid body here below the neck, so these ride it by anatomy rather
# than by omission: the sternum and its cartilages are the front of the ribcage, and the
# shoulder girdle has nowhere else to go because the model has no scapulothoracic joint.
TORSO_BONES = ['manubrium', 'body of sternum', 'xiphoid process', 'clavicle', 'scapula'] + \
    [f'{n} costal cartilage' for n in
     ('first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth')]
# everything else in the skeleton rides on the torso, which in this model is one rigid body
TORSO_FALLBACK = 'torso'

# Bones present in both models, for the similarity fit. OpenSim mesh file -> (my structure
# name, side). 'M' means the mesh is not lateralised on my side.
#
# Pelvis and below only, deliberately. The two models are not in the same *pose* — this
# project's body comes from a supine MRI in anatomical position, Rajagopal's default pose is
# standing with its own arm and head configuration — and a similarity transform cannot absorb
# a pose difference. Registering on the pelvis-to-foot chain, where both are in neutral
# extension, gives 22 mm. Including the clavicle and skull dragged it to 89 mm with 298 mm
# outliers, because those bones are genuinely somewhere else, not because the fit was wrong.
# Pose differences above the pelvis do not matter downstream: every mesh is bound to its
# segment at its own bind pose and simply follows it.
REGISTRATION = [
    ('r_pelvis.vtp',  'pelvis',    'hip bone', 'R'),
    ('l_pelvis.vtp',  'pelvis',    'hip bone', 'L'),
    ('sacrum.vtp',    'pelvis',    'sacrum',   'M'),
    ('r_femur.vtp',   'femur_r',   'femur',    'R'),
    ('l_femur.vtp',   'femur_l',   'femur',    'L'),
    ('r_tibia.vtp',   'tibia_r',   'tibia',    'R'),
    ('l_tibia.vtp',   'tibia_l',   'tibia',    'L'),
    ('r_fibula.vtp',  'tibia_r',   'fibula',   'R'),
    ('l_fibula.vtp',  'tibia_l',   'fibula',   'L'),
]


def txt(e, path, default=None):
    n = e.find(path)
    return n.text.strip() if n is not None and n.text else default


def vec(s, n=3):
    v = [float(x) for x in (s or '').split()]
    return np.array(v[:n] if len(v) >= n else [0.0] * n)


def rot_xyz(a):
    """Body-fixed XYZ Euler -> matrix, matching OpenSim's PhysicalOffsetFrame orientation."""
    cx, cy, cz = np.cos(a); sx, sy, sz = np.sin(a)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz


def read_vtp(path):
    """ASCII VTK PolyData -> points [n,3]. Only the points are needed for a centroid."""
    r = ET.parse(path).getroot()
    da = r.find('.//Points/DataArray')
    if da is None or (da.get('format') or 'ascii') != 'ascii':
        return None
    vals = np.fromstring(da.text.replace('\n', ' '), sep=' ')
    return vals.reshape(-1, 3) if vals.size >= 9 else None


# ---------------------------------------------------------------------------------------
# Published joint range of motion, for the coordinates where Rajagopal's own limits are a
# gait-simulation convenience rather than a statement about what the joint can do.
#
# The model was built to simulate walking. Walking never flexes a knee past 120 degrees,
# never lifts an arm past shoulder height, and never folds a hip past 120, so the .osim caps
# them there — and a yoga and Pilates repertoire runs into all three caps immediately. Those
# caps are not measurements of a joint; they are the box the solver was asked to search.
#
# So the coordinates below take published goniometric ranges instead, and every coordinate
# in rig.json records which of the two it got. Nothing here widens a range to make a picture
# look right: each value is the normal adult range from a standard reference, and where the
# model is already at or beyond that value the model's own number is kept.
#
# Norkin CC, White DJ. Measurement of Joint Motion: A Guide to Goniometry, 5th ed.
# F.A. Davis, 2016 — Tables for the shoulder, hip, knee, ankle and first MTP joint.
ROM_CITATION = ('Norkin CC, White DJ. Measurement of Joint Motion: A Guide to Goniometry, '
                '5th ed. F.A. Davis, 2016 — normal adult range')
PUBLISHED_ROM = {
    # coordinate stem      (lo, hi) degrees   what the two ends are
    'arm_flex':   (-60.0, 180.0),   # extension 60, forward elevation 180
    'arm_add':    (-180.0, 45.0),   # abduction 180 (negative here), adduction across 45
    'arm_rot':    (-90.0, 90.0),    # external 90, internal 90 — the model already allows this
    'elbow_flex': (0.0, 150.0),     # unchanged; the model already matches
    'knee_angle': (0.0, 150.0),     # heel-to-buttock flexion, not the 120 a stride needs
    'hip_flexion': (-30.0, 135.0),  # extension 30, flexion 135 with the knee bent
    'hip_rotation': (-45.0, 45.0),  # 45 each way
    'mtp_angle':  (-45.0, 70.0),    # the toes extend far more than a stride asks of them
    'pro_sup':    (-80.0, 80.0),    # the forearm turns 80 each way and the model publishes
                                    # 0..90, so half of it is missing: a walking model never
                                    # supinates, and every palm in the library was stuck
                                    # facing one way
    'ankle_angle': (-50.0, 20.0),   # plantarflexion 50 — a stride needs 40, kneeling on the
                                    # tops of the feet needs all of it. The model's 30 of
                                    # dorsiflexion is already past the published 20 and is kept.
}


def published_range(name, lo, hi):
    """Widen a coordinate to its published range, or keep the model's if that is already wider.

    Returns (lo, hi, source). `source` is what the app shows: a range is either the model's
    or the literature's, and which one is not a detail a user should have to guess at.
    """
    stem = re.sub(r'_(r|l)$', '', name)
    pub = PUBLISHED_ROM.get(stem)
    if pub is None:
        return lo, hi, 'model'
    plo, phi = np.radians(pub[0]), np.radians(pub[1])
    nlo, nhi = min(lo, plo), max(hi, phi)
    if abs(nlo - lo) < 1e-9 and abs(nhi - hi) < 1e-9:
        return lo, hi, 'model'
    return nlo, nhi, 'published'


def transform_function(ax):
    """The function mapping a coordinate value onto one axis of a joint transform.

    A `TransformAxis` is not `angle * axis`. OpenSim puts a *function* on it, and for the
    knee that function is the difference between an anatomically-shaped joint and a wreck:
    `knee_angle_r` drives two translations through cubic splines whose whole range is about
    seven millimetres, and applying the raw radian value instead threw the tibia more than a
    body height forward at 90 degrees of flexion. Three kinds appear in this model:

      LinearFunction  a*q + b, with a of 1 or -1 — the sign is how a coordinate named for
                      flexion drives an axis defined in the other direction
      SimmSpline      a natural cubic through published sample points, used for the coupled
                      translations of the knee and for the patella
      Constant        a fixed offset with no coordinate at all

    Returned as data rather than a closure so it survives the trip through rig.json; both
    this script and src/rig.js evaluate it with the same rules.
    """
    lin = ax.find('LinearFunction')
    if lin is not None:
        c = vec(txt(lin, 'coefficients', '1 0'), 2)
        return {'kind': 'linear', 'a': float(c[0]), 'b': float(c[1])}
    sp = ax.find('SimmSpline') if ax.find('SimmSpline') is not None else ax.find('NaturalCubicSpline')
    if sp is not None:
        return {'kind': 'spline',
                'x': [float(v) for v in txt(sp, 'x', '').split()],
                'y': [float(v) for v in txt(sp, 'y', '').split()]}
    con = ax.find('Constant')
    if con is not None:
        return {'kind': 'const', 'v': float(txt(con, 'value', '0') or 0)}
    return {'kind': 'linear', 'a': 1.0, 'b': 0.0}


def apply_function(fn, q):
    """Evaluate a transform function. Mirrors `applyFunction` in src/rig.js exactly."""
    if fn is None:
        return q
    kind = fn.get('kind')
    if kind == 'const':
        return fn['v']
    if kind == 'linear':
        return fn['a'] * q + fn['b']
    xs, ys = fn['x'], fn['y']
    if not xs:
        return 0.0
    if q <= xs[0]:
        return ys[0]
    if q >= xs[-1]:
        return ys[-1]
    # the sample points are dense and evenly spaced here, so a linear read between them is
    # within a few micrometres of the cubic the file describes — and unlike a hand-rolled
    # spline it cannot overshoot
    i = 0
    while i < len(xs) - 2 and xs[i + 1] < q:
        i += 1
    t = (q - xs[i]) / (xs[i + 1] - xs[i])
    return ys[i] + t * (ys[i + 1] - ys[i])


def parse(osim):
    r = ET.parse(osim).getroot()
    m = r.find('Model')
    bodies, joints = {}, {}

    for b in m.find('BodySet/objects'):
        geoms = []
        for g in b.findall('.//Mesh'):
            f = txt(g, 'mesh_file')
            sc = vec(txt(g, 'scale_factors', '1 1 1'))
            if f:
                geoms.append((f, sc))
        bodies[b.get('name')] = {'name': b.get('name'), 'geoms': geoms,
                                 'mass': float(txt(b, 'mass', '0') or 0)}

    for j in m.find('JointSet/objects'):
        frames = {f.get('name'): f for f in j.findall('frames/PhysicalOffsetFrame')}
        pname = txt(j, 'socket_parent_frame')
        cname = txt(j, 'socket_child_frame')
        pf, cf = frames.get(pname), frames.get(cname)
        if pf is None or cf is None:
            continue
        parent = txt(pf, 'socket_parent', '').split('/')[-1]
        child = txt(cf, 'socket_parent', '').split('/')[-1]
        axes, taxes = [], []
        st = j.find('SpatialTransform')
        if st is not None:
            for ax in st.findall('TransformAxis'):
                kind = ax.get('name', '')
                co = txt(ax, 'coordinates')
                if not co:
                    continue
                rec = {'coordinate': co, 'axis': vec(txt(ax, 'axis', '0 0 1')).tolist(),
                       'fn': transform_function(ax)}
                if kind.startswith('rotation'):
                    axes.append(rec)
                elif kind.startswith('translation'):
                    taxes.append(rec)
        else:
            # PinJoint and UniversalJoint have implicit axes
            coords = [c.get('name') for c in j.findall('coordinates/Coordinate')]
            defaults = {'PinJoint': [[0, 0, 1]], 'UniversalJoint': [[1, 0, 0], [0, 0, 1]]}
            for i, c in enumerate(coords):
                a = defaults.get(j.tag, [[0, 0, 1]])
                axes.append({'coordinate': c, 'axis': a[i % len(a)]})
        coords = {}
        # `ground_pelvis` is not an anatomical joint: it is the six degrees of freedom that
        # place the whole model in the world. Its published +/-90 degree limits are a solver
        # convenience for gait, not a statement about what a pelvis can do, and holding a
        # figure to them makes every inverted posture unrepresentable. So the root's rotations
        # open to a full turn and every real joint keeps exactly the range the model states.
        root = j.get('name') == 'ground_pelvis'
        for c in j.findall('coordinates/Coordinate'):
            cname = c.get('name', '')
            rng = vec(txt(c, 'range', '-3.14 3.14'), 2)
            lo, hi = float(rng[0]), float(rng[1])
            source = 'model'
            if root and not cname.startswith(('pelvis_tx', 'pelvis_ty', 'pelvis_tz')):
                lo, hi, source = -np.pi, np.pi, 'world'
            elif not root:
                lo, hi, source = published_range(cname, lo, hi)
            coords[cname] = {'default': float(txt(c, 'default_value', '0') or 0),
                             'range': [lo, hi], 'rangeSource': source,
                             'worldPlacement': bool(root)}
        joints[j.get('name')] = {
            'name': j.get('name'), 'parent': parent, 'child': child, 'axes': axes,
            'translationAxes': taxes, 'coordinates': coords,
            'parentTranslation': vec(txt(pf, 'translation', '0 0 0')).tolist(),
            'parentOrientation': vec(txt(pf, 'orientation', '0 0 0')).tolist(),
            'childTranslation': vec(txt(cf, 'translation', '0 0 0')).tolist(),
            'childOrientation': vec(txt(cf, 'orientation', '0 0 0')).tolist(),
        }

    muscles = []
    for f in m.find('ForceSet/objects'):
        if not f.tag.endswith('Muscle'):
            continue
        pts = []
        for p in f.findall('.//PathPoint'):
            body = txt(p, 'socket_parent_frame', '').split('/')[-1]
            pts.append({'body': body, 'p': vec(txt(p, 'location', '0 0 0')).tolist()})
        if len(pts) < 2:
            continue
        muscles.append({
            'name': f.get('name'),
            'points': pts,
            'maxIsometricForce': float(txt(f, 'max_isometric_force', '0') or 0),
            'optimalFiberLength': float(txt(f, 'optimal_fiber_length', '0') or 0),
            'tendonSlackLength': float(txt(f, 'tendon_slack_length', '0') or 0),
            'pennationAngle': float(txt(f, 'pennation_angle_at_optimal', '0') or 0),
        })

    markers = {}
    ms = m.find('MarkerSet/objects')
    for k in (ms if ms is not None else []):
        markers[k.get('name')] = {'body': txt(k, 'socket_parent_frame', '').split('/')[-1],
                                  'p': vec(txt(k, 'location', '0 0 0')).tolist()}
    return bodies, joints, muscles, markers


def joint_transform(j, values):
    """The transform a joint imposes between its two frames, at the given coordinates.

    OpenSim composes the rotations about the parent frame's axes and then offsets by the
    translation axes, so the result is T(p) . R. The default pose is not the identity —
    Rajagopal's pelvis_ty defaults to about 0.94 m, which is the model standing on the
    ground — and leaving it out registers against a pose the viewer never shows.
    """
    R = np.eye(3)
    for a in j['axes']:
        v = apply_function(a.get('fn'), values.get(a['coordinate'], 0.0))
        if not v:
            continue
        k = np.asarray(a['axis'], dtype=float)
        n = np.linalg.norm(k)
        if n < 1e-12:
            continue
        k = k / n
        K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
        R = R @ (np.eye(3) + np.sin(v) * K + (1 - np.cos(v)) * (K @ K))
    p = np.zeros(3)
    for a in j.get('translationAxes', []):
        p = p + np.asarray(a['axis'], dtype=float) * apply_function(
            a.get('fn'), values.get(a['coordinate'], 0.0))
    X = np.eye(4)
    X[:3, :3] = R
    X[:3, 3] = p
    return X


def forward_kinematics(bodies, joints, values=None):
    """World transform of every body at the given pose; defaults when none is given."""
    child_of = {j['child']: j for j in joints.values()}
    if values is None:
        values = {}
        for j in joints.values():
            for cn, c in j['coordinates'].items():
                values[cn] = c['default']
    T = {'ground': np.eye(4)}

    def solve(body, seen=()):
        if body in T:
            return T[body]
        if body in seen:
            raise RuntimeError(f'cycle at {body}')
        j = child_of.get(body)
        if j is None:
            T[body] = np.eye(4)
            return T[body]
        Tp = solve(j['parent'], seen + (body,))
        A = np.eye(4)
        A[:3, :3] = rot_xyz(np.asarray(j['parentOrientation']))
        A[:3, 3] = j['parentTranslation']
        B = np.eye(4)
        B[:3, :3] = rot_xyz(np.asarray(j['childOrientation']))
        B[:3, 3] = j['childTranslation']
        T[body] = Tp @ A @ joint_transform(j, values) @ np.linalg.inv(B)
        return T[body]

    for b in bodies:
        solve(b)
    return T


def main():
    if not os.path.exists(TABLE):
        sys.exit('run scripts/build_body.py first')
    doc = json.load(open(TABLE))
    mine = {s['name']: s for s in doc['structures']}
    heightMm = doc['frame']['heightMm']

    bodies, joints, muscles, markers = parse(OSIM)
    T = forward_kinematics(bodies, joints)
    print(f'{len(bodies)} bodies, {len(joints)} joints, {len(muscles)} muscles, '
          f'{len(markers)} markers')

    # ---------------------------------------------------------------- registration
    A, B, used = [], [], []
    for meshfile, body, myname, side in REGISTRATION:
        path = os.path.join(GEOM, meshfile)
        s = mine.get(myname)
        if not os.path.exists(path) or s is None or body not in T:
            continue
        P = read_vtp(path)
        if P is None:
            continue
        c = T[body] @ np.append(P.mean(0), 1.0)
        target = s.get('perSide', {}).get(side) or (s['centroid'] if side == 'M' else None)
        if target is None:
            continue
        A.append(c[:3]); B.append(np.asarray(target)); used.append(f'{myname}.{side}')
    if len(A) < 5:
        sys.exit(f'only {len(A)} shared bones for registration: {used}')
    A, B = np.asarray(A), np.asarray(B)
    s, R, t = umeyama(A, B)
    resid = np.linalg.norm((s * (R @ A.T).T) + t - B, axis=1)
    print(f'\nOpenSim -> body frame, {len(A)} bones')
    print(f'  scale {s:.6f}   residual mean {resid.mean()*heightMm:6.1f} mm  '
          f'max {resid.max()*heightMm:6.1f} mm')
    for lab, rr in sorted(zip(used, resid), key=lambda kv: -kv[1])[:6]:
        print(f'      {lab:18s} {rr*heightMm:6.1f} mm')
    if resid.mean() * heightMm > 40:
        sys.exit('registration residual too large — a bone is probably in the wrong frame')

    # ------------------------------------------------------------------- the rig
    # The whole rig is emitted in OpenSim's own metres and axes, under one root node that
    # carries the registration. That keeps joint offsets, rotation axes and muscle path
    # points in the frame they were published in — nothing is pre-multiplied and no
    # convention is silently changed on the way through.
    segs = {}
    child_of = {j['child']: j for j in joints.values()}
    for name in bodies:
        j = child_of.get(name)
        segs[name] = {
            'name': name,
            'parent': j['parent'] if j else None,
            'joint': j['name'] if j else None,
            'translation': j['parentTranslation'] if j else [0, 0, 0],
            'orientation': j['parentOrientation'] if j else [0, 0, 0],
            'childTranslation': j['childTranslation'] if j else [0, 0, 0],
            'childOrientation': j['childOrientation'] if j else [0, 0, 0],
            'axes': j['axes'] if j else [],
            'translationAxes': j.get('translationAxes', []) if j else [],
            'worldAtDefault': (T[name][:3, 3]).tolist(),
        }

    coordinates = {}
    for j in joints.values():
        for cname, c in j['coordinates'].items():
            coordinates[cname] = {**c, 'joint': j['name'], 'segment': j['child']}

    # which of this project's structures rides on which segment
    binding = {}
    for segbase, names in SEGMENT_BONES.items():
        for n in names:
            st = mine.get(n)
            if not st:
                continue
            for sd in st['sides']:
                seg = segbase if segbase in ('pelvis', 'skull') else (
                    f'{segbase}_{sd.lower()}' if sd in ('L', 'R') else segbase)
                if seg in segs:
                    binding[f'{n}|{sd}'] = seg
    for n in TORSO_BONES:
        st = mine.get(n)
        if not st:
            continue
        for sd in st['sides']:
            binding.setdefault(f'{n}|{sd}', TORSO_FALLBACK)
    bound = set(binding)
    # Anything still unnamed rides the torso, as it always has — but say so. A bone that is
    # merely missing from the table is indistinguishable, once emitted, from one deliberately
    # placed on the trunk, and that is how every phalanx came to be welded to the chest.
    fell_through = []
    for st in doc['structures']:
        if st['layer'] != 'skeleton':
            continue
        for sd in st['sides']:
            k = f"{st['name']}|{sd}"
            if k not in bound:
                binding[k] = TORSO_FALLBACK
                fell_through.append(k)

    # ---------------------------------------------------------------- prune
    # A segment with no bone on it and no bone anywhere below it is not part of *this* body.
    # For the male that is a no-op — every segment carries bones. For a body that stops at the
    # pelvis it removes Rajagopal's whole trunk, arms and head, which otherwise linger as
    # phantom joints: nothing draws there, but `frameRig` measures the joint cloud to aim the
    # camera and would frame half a metre of empty air above her.
    kids = {}
    for nm, sg in segs.items():
        kids.setdefault(sg.get('parent'), []).append(nm)
    carries = set(binding.values())

    def keeps(nm):
        return nm in carries or any(keeps(k) for k in kids.get(nm, []))

    drop = {nm for nm in segs if not keeps(nm)}
    if drop:
        for nm in drop:
            segs.pop(nm, None)
        coordinates = {k: v for k, v in coordinates.items() if v.get('segment') not in drop}
        print(f'  pruned {len(drop)} segments this body has no bones for: '
              f'{", ".join(sorted(drop))}')
        print(f'  -> {len(segs)} segments, {len(coordinates)} coordinates')

    rig = {
        'source': 'Rajagopal2016.osim', 'citation': CITATION, 'licence': LICENCE,
        'units': 'metres, OpenSim axes; the root node carries the registration below',
        'registration': {'scale': float(s), 'rotation': R.tolist(),
                         'translation': t.tolist(), 'bones': used,
                         'residualMm': {'mean': round(float(resid.mean() * heightMm), 2),
                                        'max': round(float(resid.max() * heightMm), 2)}},
        'segments': segs, 'coordinates': coordinates, 'binding': binding,
        'romCitation': ROM_CITATION,
    }
    # This script rewrites the rig from the OpenSim file, so it wipes whatever the two
    # scripts after it added: the 24 vertebral joints from `build_spine.py` and the limb joint
    # centres fitted by `tools/fitjoints.mjs`. Losing those silently is the documented footgun
    # — every clip's `lumbar_flex` simply stops existing — so it is refused rather than
    # narrated, and the way through says what has to be re-run.
    prev_path = os.path.join(OUT, 'rig.json')
    if os.path.exists(prev_path) and '--force' not in sys.argv:
        prev = json.load(open(prev_path))
        lost = []
        if prev.get('spine'):
            lost.append(f"the {len(prev['spine'])}-joint spine from build_spine.py")
        if any(sg.get('fitted') for sg in prev.get('segments', {}).values()):
            lost.append('the joint centres fitted by tools/fitjoints.mjs')
        if lost:
            # The chain differs by body: the male's rig gets a spine inserted and then drives
            # every clip in the library, so re-fitting his joints moves where a bent arm
            # reaches. She has no spine to insert and no clips written against her.
            sys.exit(
                '\nrefusing to overwrite rig.json: it carries ' + ' and '.join(lost) +
                ',\nwhich this script does not produce and would silently destroy.\n'
                'Re-run the whole chain, in order:\n'
                '  npm run build:rig -- --force\n'
                '  npm run build:spine\n'
                '  npm run build:joints\n'
                '  node tools/solve.mjs --all --write && node tools/hands.mjs --write\n'
                '  npm run poses:check\n')

    json.dump(rig, open(os.path.join(OUT, 'rig.json'), 'w'), indent=1)
    widened = sorted({re.sub(r'_(r|l)$', '', k) for k, v in coordinates.items()
                      if v.get('rangeSource') == 'published'})
    print(f'\nrig: {len(segs)} segments, {len(coordinates)} coordinates, '
          f'{len(binding)} bound meshes')
    if fell_through:
        print(f'  {len(fell_through)} bones are on the torso only because nothing named them '
              f'— check each is really part of the trunk:')
        for k in sorted(fell_through):
            print(f'      {k}')
    if widened:
        print(f'  {len(widened)} coordinates take a published range instead of the model\'s '
              f'gait limits:')
        for stem in widened:
            for side in ('_r', '_l', ''):
                c = coordinates.get(stem + side)
                if c:
                    print(f'    {stem:14s} {np.degrees(c["range"][0]):7.0f} ..'
                          f' {np.degrees(c["range"][1]):6.0f}°')
                    break

    # -------------------------------------------------------------- muscle paths
    # Rajagopal names muscles in its own shorthand; this maps the ones that correspond to a
    # structure in this project so the panel can show real parameters beside the anatomy.
    NAME_MAP = {
        'glmax': 'gluteus maximus', 'glmed': 'gluteus medius', 'glmin': 'gluteus minimus',
        'psoas': 'psoas major', 'iliacus': 'iliacus', 'recfem': 'rectus femoris',
        'vaslat': 'vastus lateralis', 'vasmed': 'vastus medialis', 'vasint': 'vastus intermedius',
        'bflh': 'biceps femoris', 'bfsh': 'biceps femoris', 'semimem': 'semimembranosus',
        'semiten': 'semitendinosus', 'gasmed': 'gastrocnemius', 'gaslat': 'gastrocnemius',
        'soleus': 'soleus', 'tibant': 'tibialis anterior', 'tibpost': 'tibialis posterior',
        'grac': 'gracilis', 'sart': 'sartorius', 'tfl': 'tensor fasciae latae',
        'piri': 'piriformis', 'addlong': 'adductor longus', 'addbrev': 'adductor brevis',
        'addmag': 'adductor magnus', 'perlong': 'fibularis longus', 'perbrev': 'fibularis brevis',
        'edl': 'extensor digitorum longus', 'fdl': 'flexor digitorum longus',
        'ehl': 'extensor hallucis longus', 'fhl': 'flexor hallucis longus',
    }
    out = []
    matched = 0
    for mu in muscles:
        base = re.sub(r'_(r|l)$', '', mu['name'])
        side = 'R' if mu['name'].endswith('_r') else ('L' if mu['name'].endswith('_l') else 'M')
        key = re.sub(r'\d+$', '', base)
        target = NAME_MAP.get(key) or NAME_MAP.get(base)
        if target and target in mine:
            matched += 1
        else:
            target = None
        out.append({**mu, 'side': side, 'base': base, 'mapsTo': target})
    json.dump({'source': 'Rajagopal2016.osim', 'citation': CITATION, 'licence': LICENCE,
                   'note': 'path points are in the local frame of the named segment, in metres',
                   'muscles': out},
                  open(os.path.join(OUT, 'muscle_paths.json'), 'w'), indent=1)
    named = sorted({m['mapsTo'] for m in out if m['mapsTo']})
    print(f'muscle paths: {len(out)} actuators, {matched} mapped onto '
          f'{len(named)} named structures')
    print('  ' + ', '.join(named))


if __name__ == '__main__':
    main()
