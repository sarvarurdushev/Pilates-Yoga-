"""Builds the peripheral nervous system from Z-Anatomy into models/nervous.glb.

BodyParts3D has no peripheral nervous system — three of its 1522 parts match "nerve" and
the spinal cord has no mesh at all. Z-Anatomy does, and carries it as **bevelled curves**
rather than meshes, which is the right representation for a nerve: a centreline with a
radius. This script evaluates those curves, registers them into the body frame, and sweeps
them into tubes so they pick, label and colour exactly like every other layer.

Registration is measured, not assumed: a set of bones present in both models is matched by
name and a similarity transform is fitted by Umeyama, the same method derive_frame.py uses
for the brain. The residual is printed and asserted.

Runs *after* scripts/build_body.py, because it continues that script's id allocation and
appends to the same table. It refuses to run if the table is missing.

Z-Anatomy, by Gauthier Kervyn and Marcin Zielinski, licensed CC BY-SA 4.0.
Derived in turn from BodyParts3D (CC BY-SA 2.1 JP), which is why the two register so well.
Requires `pip install bpy`.
"""
import sys, os, re, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_common import write_glb, decimate
from derive_frame import umeyama

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND = os.path.join(ROOT, 'bpdata', 'zanatomy', 'Z-Anatomy', 'Startup.blend')
TABLE = os.path.join(ROOT, 'src', 'generated', 'structures.json')

ATTRIBUTION = ('Z-Anatomy by Gauthier Kervyn and Marcin Zielinski, licensed CC BY-SA 4.0, '
               'derived from BodyParts3D (CC BY-SA 2.1 JP)')

# Bones present in both models, used to fit Z-Anatomy -> body frame. Keyed by the name this
# project's build emits; the value is the Z-Anatomy object name without laterality.
REGISTRATION = {
    'sacrum': 'Sacrum',
    'hip bone': 'Hip bone',
    'femur': 'Femur',
    'humerus': 'Humerus',
    'tibia': 'Tibia',
    'scapula': 'Scapula',
    'sternum': 'Sternum',
    'atlas': 'Atlas',
    'talus': 'Talus',
    'clavicle': 'Clavicle',
}

# What counts as the peripheral nervous system for this app. Cranial nerve nuclei, choroid
# plexus and venous plexuses are excluded — they are not the motor/sensory route a muscle
# click travels, and the brain model already carries what is inside the skull.
KEEP = re.compile(
    r'\b(nerve|nerves|plexus|spinal cord|ganglion|ganglia|rami|ramus|roots? of|'
    r'trunk of|cauda equina|conus medullaris|filum terminale)\b', re.I)
DROP = re.compile(
    r'choroid plexus|venous plexus|pulmonary trunk|nucleus|nuclei|groove|'
    r'pterygoid plexus|prostatic plexus|vesical plexus|uterovaginal|rectal plexus|'
    r'\.(i|j|s|t)$', re.I)

# Named routes worth their own region id and their own entry. Everything else is merged into
# the trunk it branches from, so the layer does not become four hundred twigs.
GROUPS = [
    ('spinal cord',        r'spinal cord|conus medullaris|filum terminale|cauda equina|'
                           r'anterior horn|posterior horn|grey matter|white matter of spinal'),
    ('spinal nerve roots', r'\broots?\b|spinal ganglion|rami of|ramus of|'
                           r'anterior rami|posterior rami|spinal nerve'),
    ('cervical plexus',    r'cervical plexus|phrenic|ansa cervicalis|supraclavicular nerve'),
    ('brachial plexus',    r'brachial plexus|cord of brachial'),
    ('median nerve',       r'median nerve'),
    ('ulnar nerve',        r'ulnar nerve'),
    ('radial nerve',       r'radial nerve'),
    ('musculocutaneous nerve', r'musculocutaneous'),
    # `\b` is load-bearing: without it "M-axillary nerve" matches, and the maxillary
    # division of the trigeminal — which is in the face — was swept into the axillary nerve
    # along with its meningeal branch inside the skull. 336 of the resulting mesh's 396
    # vertices were at the cranium, the chain it was bound to ran from the humerus up the
    # whole cervical spine to the skull, and the nerve came apart across the shoulder in
    # every pose that moved the neck. `assert_word_boundary` below now refuses that class of
    # match outright rather than leaving it to be noticed.
    ('axillary nerve',     r'\baxillary nerve'),
    ('long thoracic nerve', r'long thoracic'),
    ('intercostal nerves', r'intercostal nerve|thoracic nerves|thoracoabdominal'),
    ('lumbar plexus',      r'lumbar plexus|iliohypogastric|ilioinguinal|genitofemoral'),
    ('femoral nerve',      r'femoral nerve|saphenous'),
    ('obturator nerve',    r'obturator nerve'),
    ('sacral plexus',      r'sacral plexus|lumbosacral|superior gluteal|inferior gluteal|pudendal'),
    ('sciatic nerve',      r'sciatic'),
    ('tibial nerve',       r'tibial nerve|plantar nerve'),
    ('common fibular nerve', r'fibular nerve|peroneal'),
    ('vagus nerve',        r'vagus'),
    ('sympathetic trunk',  r'sympathetic'),
    # The trigeminal's three divisions are named for themselves rather than for their
    # parent, so they have to be listed: without them the ophthalmic and both mandibular
    # divisions fell into no group at all and were dropped, and the maxillary went to the
    # wrong one. `vestibulocochlear` is spelt out for the same reason `\b` is used above —
    # so that every pattern here can be required to match at a word boundary.
    ('cranial nerves',     r'trigeminal|maxillary nerve|mandibular nerve|ophthalmic nerve|'
                           r'facial nerve|oculomotor|abducens|trochlear|hypoglossal|'
                           r'accessory nerve|glossopharyngeal|optic nerve|olfactory|'
                           r'vestibulocochlear|cochlear|vestibular'),
]
GROUPS = [(n, re.compile(p, re.I)) for n, p in GROUPS]

# How far apart two curves of one named route may be before it is two things rather than one.
# The axillary nerve's shoulder curves and the maxillary nerve in the face were 145 mm apart;
# the widest gap inside a route that is genuinely one nerve is the sacral plexus at 36 mm.
GROUP_LINK = 0.090      # metres, Z-Anatomy world units
# Two routes are a *collection* by design and the check does not apply to them. "Spinal nerve
# roots" is every root along the whole spine, from the brachial plexus at the neck to the
# sacral roots — 91 mm between the nearest two is what that is. "Spinal cord" deliberately
# merges the cord with the cauda equina and the filum terminale below it, which Z-Anatomy
# carries as separate objects with 208 mm between their nearest points. Neither is a
# mis-grouping; both are stated here rather than hidden by raising the threshold, because
# raising it to 210 mm would have let the axillary nerve's 145 mm through.
SCATTERED = {'spinal cord', 'spinal nerve roots'}
TUBE_SIDES = 6
RADIUS = {          # body-frame units; a nerve is a few millimetres, a cord is centimetres
    'spinal cord': 0.0075,
    'spinal nerve roots': 0.0022,
    'cauda equina': 0.0022,
}
DEFAULT_RADIUS = 0.0030
BUDGET = 2600


def group_of(name, report=None):
    """Which named route this object belongs to, or None.

    A match that starts in the *middle* of a word is not a match. "Maxillary nerve" contains
    "axillary nerve"; the maxillary division of the trigeminal was therefore swept into the
    axillary nerve, carrying the shoulder nerve's binding chain from the humerus up the whole
    cervical spine to the skull. Requiring a word boundary is the rule that makes that
    impossible rather than merely unlikely, and `report` collects what it refused so a
    rejected match is visible in the build log instead of silently vanishing.
    """
    for gname, pat in GROUPS:
        m = pat.search(name)
        if not m:
            continue
        if m.start() > 0 and (name[m.start() - 1].isalnum() or name[m.start() - 1] == '_'):
            if report is not None:
                report.append((name, gname, m.group(0)))
            continue
        return gname
    return None


def side_of(name):
    """L, R or M, from the suffix Z-Anatomy already puts on every paired object.

    This used to be thrown away, and throwing it away is what put the median nerve in both
    hands at once. A skinned mesh follows *one* chain of bones: a single object holding the
    left and the right nerve spans from one hand to the other, no chain can be right for both
    halves of it, and whichever is chosen drags the other half across the body. That is why
    the arm nerves came out as straight lines shooting off the figure the moment a leg moved —
    the arm nerve was bound to a femur.
    """
    m = re.search(r'\.(l|r)$', name.strip(), re.I)
    return m.group(1).upper() if m else 'M' 


def load_blend():
    import bpy
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    return bpy


def polylines_and_refs(bpy):
    """-> (group -> [polyline arrays in Z-Anatomy world mm], refname -> centroid, members)."""
    deps = bpy.context.evaluated_depsgraph_get()
    groups, refs, members, refused = {}, {}, {}, []

    wanted_refs = {v.lower(): k for k, v in REGISTRATION.items()}
    for o in bpy.data.objects:
        base = re.sub(r'\.(l|r)$', '', o.name).strip().lower()
        if o.type == 'MESH' and base in wanted_refs and len(o.data.vertices) > 32:
            M = np.array(o.matrix_world)
            V = np.array([v.co[:] for v in o.data.vertices])
            W = (M[:3, :3] @ V.T).T + M[:3, 3]
            key = wanted_refs[base]
            refs.setdefault(key, []).append(W)

    for o in bpy.data.objects:
        if o.type != 'CURVE':
            continue
        if not KEEP.search(o.name) or DROP.search(o.name):
            continue
        g = group_of(o.name, refused)
        if not g:
            continue
        g = (g, side_of(o.name))
        members.setdefault(g, []).append(o.name)
        M = np.array(o.matrix_world)
        for sp in o.data.splines:
            pts = ([p.co[:3] for p in sp.bezier_points] if sp.type == 'BEZIER'
                   else [p.co[:3] for p in sp.points])
            if len(pts) < 2:
                continue
            P = np.asarray(pts, dtype=np.float64)
            groups.setdefault(g, []).append((M[:3, :3] @ P.T).T + M[:3, 3])

    # the spinal cord is a mesh in Z-Anatomy, not a curve; take its centreline by slicing
    for o in bpy.data.objects:
        if o.type == 'MESH' and re.search(r'^(white|grey) matter of spinal cord$', o.name, re.I):
            M = np.array(o.matrix_world)
            V = np.array([v.co[:] for v in o.data.vertices])
            W = (M[:3, :3] @ V.T).T + M[:3, 3]
            groups.setdefault(('spinal cord', 'M'), []).append(centreline(W))
            members.setdefault(('spinal cord', 'M'), []).append(o.name)
    return groups, {k: np.vstack(v).mean(0) for k, v in refs.items()}, members, refused


def spread_of(polys, link=0.040):
    """How far apart the disjoint pieces of a group are, in metres.

    A named route is one anatomical thing, so its curves should form a single cluster: each
    one within a few centimetres of another. Two clusters fifteen centimetres apart is the
    signature of a mis-grouping — which is what the axillary nerve was, holding the maxillary
    division of the trigeminal in the face as well as the nerve at the shoulder. Single
    linkage over the curve endpoints, returning the largest gap that had to be bridged.
    """
    pts = [np.asarray(p, dtype=np.float64) for p in polys]
    if len(pts) < 2:
        return 0.0
    # nearest point to nearest point, not centroid to centroid: a nerve branch that runs the
    # length of a limb has a centroid nowhere near the trunk it leaves, and would read as
    # disjoint while touching it
    def gap(a, b):
        return float(np.min(np.linalg.norm(pts[a][:, None, :] - pts[b][None, :, :], axis=2)))
    joined, rest, worst = [0], list(range(1, len(pts))), 0.0
    while rest:
        best, at = None, 0
        for i, r in enumerate(rest):
            d = min(gap(r, j) for j in joined)
            if best is None or d < best:
                best, at = d, i
        worst = max(worst, best)
        joined.append(rest.pop(at))
    return float(worst)


def centreline(W, bins=48):
    """Mean cross-section centre per slice along the longest axis — a mesh to a polyline."""
    axis = int(np.argmax(W.max(0) - W.min(0)))
    lo, hi = W[:, axis].min(), W[:, axis].max()
    edges = np.linspace(lo, hi, bins + 1)
    out = []
    for i in range(bins):
        m = (W[:, axis] >= edges[i]) & (W[:, axis] < edges[i + 1])
        if m.sum() >= 3:
            out.append(W[m].mean(0))
    return np.asarray(out) if len(out) >= 2 else W[:2]


def tube(poly, radius, sides=TUBE_SIDES):
    """Sweep a circle along a polyline. Parallel-transport frames, so the tube does not
    twist where the curve turns sharply."""
    P = np.asarray(poly, dtype=np.float64)
    # drop duplicate points, which make a zero-length tangent and a NaN frame
    keep = np.concatenate([[True], (np.linalg.norm(np.diff(P, axis=0), axis=1) > 1e-7)])
    P = P[keep]
    if len(P) < 2:
        return None
    T = np.gradient(P, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    ref = np.array([0.0, 0.0, 1.0])
    if abs(T[0] @ ref) > 0.9:
        ref = np.array([1.0, 0.0, 0.0])
    N = np.cross(T[0], ref); N /= np.linalg.norm(N)
    verts, faces = [], []
    for i in range(len(P)):
        if i:
            # parallel transport: rotate the previous normal by the tangent's change
            v = np.cross(T[i - 1], T[i]); s = np.linalg.norm(v)
            if s > 1e-9:
                c = float(np.clip(T[i - 1] @ T[i], -1, 1))
                k = v / s; ang = np.arccos(c)
                N = (N * np.cos(ang) + np.cross(k, N) * np.sin(ang)
                     + k * (k @ N) * (1 - np.cos(ang)))
            N -= T[i] * (N @ T[i])
            n = np.linalg.norm(N)
            N = N / n if n > 1e-9 else np.array([1.0, 0.0, 0.0])
        B = np.cross(T[i], N)
        for k in range(sides):
            a = 2 * np.pi * k / sides
            verts.append(P[i] + radius * (np.cos(a) * N + np.sin(a) * B))
    for i in range(len(P) - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            faces.append([a, b, a + sides])
            faces.append([b, b + sides, a + sides])
    return np.asarray(verts, dtype=np.float64), np.asarray(faces, dtype=np.int64)


def main():
    if not os.path.exists(TABLE):
        sys.exit('run scripts/build_body.py first — this build continues its id allocation')
    doc = json.load(open(TABLE))
    body = {s['name']: s for s in doc['structures']}
    # from the rows this script does not own, so ids do not drift every time it is re-run
    next_id = max(s['id'] for s in doc['structures'] if s.get('layer') != 'nervous') + 1

    print('opening the Z-Anatomy blend (306 MB, takes a moment)')
    bpy = load_blend()
    groups, refs, members, refused = polylines_and_refs(bpy)
    print(f'  {len(groups)} nerve groups, '
          f'{sum(len(v) for v in groups.values())} polylines, {len(refs)} reference bones')

    # A pattern that matched inside a longer word is refused; say so rather than dropping it.
    for name, gname, hit in refused:
        print(f'  refused: "{name}" matched "{hit}" mid-word, not put in "{gname}"')

    # Which objects went into each route, and whether they are one thing in space. This is
    # printed rather than inferred: the axillary nerve held the maxillary division of the
    # trigeminal for as long as nobody read the membership, and the mesh that came out was
    # 85% skull.
    print(f'\n  {"route":24s} {"objects":>7s} {"widest gap":>11s}')
    worst_gap = ('', 0.0)
    for g in sorted(groups, key=lambda k: (k[0], k[1])):
        gap = spread_of(groups[g])
        loose = g[0] in SCATTERED
        if gap > worst_gap[1] and not loose:
            worst_gap = (f'{g[0]}|{g[1]}', gap)
        flag = ('  (a collection by design)' if loose
                else '  <-- disjoint' if gap > GROUP_LINK else '')
        print(f'  {g[0][:22]:22s}|{g[1]} {len(members.get(g, [])):7d} {gap * 1000:8.0f} mm{flag}')
        if gap > GROUP_LINK and not loose:
            for nm in sorted(members.get(g, [])):
                print(f'      {nm}')
    if worst_gap[1] > GROUP_LINK:
        sys.exit(f'"{worst_gap[0]}" is two structures {worst_gap[1] * 1000:.0f} mm apart, not one — '
                 'check GROUPS for a pattern matching something it should not')

    # ---------------------------------------------------------------- registration
    A, B, used = [], [], []
    for key, zcent in refs.items():
        s = body.get(key)
        if not s:
            continue
        A.append(zcent)
        B.append(np.asarray(s['centroid']))
        used.append(key)
    if len(A) < 4:
        sys.exit(f'only {len(A)} shared bones ({used}); need four for a stable fit')
    A, B = np.asarray(A), np.asarray(B)
    s, R, t = umeyama(A, B)
    resid = np.linalg.norm((s * (R @ A.T).T) + t - B, axis=1)
    mm = doc['frame']['heightMm']
    print(f'\nZ-Anatomy -> body frame, {len(A)} bones')
    print(f'  scale {s:.6f}   residual mean {resid.mean()*mm:6.1f} mm  max {resid.max()*mm:6.1f} mm')
    for lab, r in sorted(zip(used, resid), key=lambda kv: -kv[1]):
        print(f'      {lab:16s} {r*mm:6.1f} mm')
    if resid.mean() * mm > 30:
        sys.exit('registration residual too large to trust — check the reference bone names')

    # ------------------------------------------------------------------- geometry
    parts, rows, table = [], [], []
    ids, by_name = {}, {}
    for key in sorted(groups):
        gname, side = key
        radius = RADIUS.get(gname, DEFAULT_RADIUS)
        meshes = []
        for poly in groups[key]:
            W = (s * (R @ poly.T).T) + t
            tb = tube(W, radius)
            if tb:
                meshes.append(tb)
        if not meshes:
            continue
        Ps, Fs, off = [], [], 0
        for P, F in meshes:
            Ps.append(P); Fs.append(F + off); off += len(P)
        P, F = np.vstack(Ps), np.vstack(Fs)
        before = len(F)
        Pd, Fd, _ = decimate(P.astype(np.float32), F.astype(np.int32), BUDGET)
        # one region id per nerve, two meshes where it is paired — the same shape the body
        # build emits, so content stays keyed by name and each side skins to its own limb
        rid = ids.get(gname)
        if rid is None:
            rid = ids[gname] = next_id; next_id += 1
        parts.append((f'{gname}|{side}', Pd, Fd, rid))
        entry = by_name.get(gname)
        if entry is None:
            entry = by_name[gname] = {'id': rid, 'name': gname, 'layer': 'nervous',
                                      'system': 'nervous', 'fma': [], 'sides': [], 'tris': 0,
                                      'centroid': None, 'perSide': {}, 'source': 'z-anatomy'}
            table.append(entry)
        c = [round(float(v), 5) for v in Pd.astype(np.float64).mean(0)]
        entry['sides'] = sorted(set(entry['sides']) | {side})
        entry['tris'] += int(len(Fd))
        entry['perSide'][side] = c
        cs = list(entry['perSide'].values())
        entry['centroid'] = [round(sum(v[i] for v in cs) / len(cs), 5) for i in range(3)]
        rows.append((f'{gname}|{side}', rid, len(meshes), before, len(Fd)))

    path = os.path.join(ROOT, 'models', 'nervous.glb')
    size = write_glb(path, parts)
    total = sum(r[4] for r in rows)
    print(f'\nnervous: {len(rows)} structures, {sum(r[3] for r in rows):,} -> {total:,} tris, '
          f'{size/1e6:.2f} MB')
    print(f'  {"structure":26s} {"id":>5s} {"curves":>7s} {"tris in":>9s} {"out":>7s}')
    for gname, rid, n, b, a in sorted(rows, key=lambda r: -r[4]):
        print(f'  {gname[:26]:26s} {rid:5d} {n:7d} {b:9,d} {a:7,d}')

    # replace, never append: this script is re-runnable and the body build owns the rest of
    # the table, so the nervous rows have to be swapped out rather than stacked on top of the
    # ones a previous run left behind
    kept = [r for r in doc['structures'] if r.get('layer') != 'nervous']
    doc['structures'] = sorted(kept + table, key=lambda r: r['id'])
    doc.setdefault('sources', {})['nervous'] = {
        'attribution': ATTRIBUTION, 'licence': 'CC BY-SA 4.0',
        'registration': {'bones': used, 'residual_mm': round(float(resid.mean() * mm), 2)},
    }
    json.dump(doc, open(TABLE, 'w'), indent=1)
    print(f'\nwrote {len(table)} nervous structures into {os.path.relpath(TABLE, ROOT)}')


if __name__ == '__main__':
    main()
