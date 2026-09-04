"""Builds every body layer from BodyParts3D into GLBs with region ids baked per vertex.

Same shape as scripts/build_cortex.py: published source data in, one GLB per layer out,
a per-structure table printed so a regression shows up in the diff.

What it emits:
    models/skeleton.glb              bones
    models/muscles_superficial.glb   muscles you can see on a body
    models/muscles_deep.glb          everything under them
    models/organs.glb                viscera, heart, lungs, vessels
    src/generated/structures.json    FMA id <-> local region id <-> name, per structure

Why one script rather than the four the brief names: the layers share the frame, the id
allocator and the name normaliser, and an id table split across four processes is a table
that will disagree with itself. `--layer` runs one at a time.

Rules inherited from the brain build and not up for renegotiation:
  * decimation happens here, in Python, via glb_common.decimate, because mesh simplifiers
    average custom vertex attributes and a region id must stay an exact integer
  * per-structure triangle budgets, because a vertebra needs detail and a kidney does not
  * region ids come from a generated table, never hand-maintained

BodyParts3D, (c) The Database Center for Life Science, licensed under
CC Attribution-Share Alike 2.1 Japan.
"""
import sys, os, re, json, argparse, collections
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bp3d
from glb_common import decimate, write_glb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MODELS = os.path.join(ROOT, 'models')
OUT_GEN = os.path.join(ROOT, 'src', 'generated')

# Body ids start at 100; 1-25 belong to the brain and must not be reused.
ID_BASE = 100

# Muscles a user can see on a body. Everything else in the muscular system goes deep, so
# the superficial layer can be peeled off to reveal the rest.
SUPERFICIAL = {
    'trapezius', 'latissimus dorsi', 'deltoid', 'pectoralis major', 'rectus abdominis',
    'external oblique', 'sternocleidomastoid', 'gluteus maximus', 'biceps brachii',
    'triceps brachii', 'brachioradialis', 'rectus femoris', 'vastus lateralis',
    'vastus medialis', 'biceps femoris', 'semitendinosus', 'gastrocnemius', 'soleus',
    'tibialis anterior', 'serratus anterior', 'teres major', 'infraspinatus muscle',
    'gracilis', 'sartorius', 'adductor longus', 'tensor fasciae latae', 'extensor carpi radialis longus',
    'flexor carpi radialis', 'flexor carpi ulnaris', 'extensor digitorum', 'temporalis', 'masseter',
}

# Triangle budget per structure, by layer. Total across the file matters more than any one
# mesh; these were picked so the whole body lands near the brief's ~15 MB first paint.
BUDGET = {
    'skeleton': 2500,
    'muscles_superficial': 2500,
    'muscles_deep': 900,
    'organs': 1200,
}

# Which system a structure belongs to when it belongs to several. The FMA tree is a
# containment graph, not a partition: a tooth is part of the alimentary system, the muscles
# of mastication are too, and the diaphragm is under both muscular and respiratory. Without
# a priority the same mesh lands in two layers and the id table disagrees with itself.
SYSTEM_PRIORITY = ['skeletal', 'muscular', 'cardiovascular', 'respiratory',
                   'alimentary', 'urinary', 'endocrine']

LAYER_OF_SYSTEM = {
    'skeletal': 'skeleton',
    'muscular': 'muscles',              # split into superficial/deep by SUPERFICIAL
    'cardiovascular': 'organs', 'respiratory': 'organs', 'alimentary': 'organs',
    'urinary': 'organs', 'endocrine': 'organs',
}

LAYERS = ['skeleton', 'muscles_superficial', 'muscles_deep', 'organs']

# The nervous system is deliberately not a mesh layer.
#
# BodyParts3D has no peripheral nervous system: of 1522 named parts, the only ones matching
# "nerve" are the optic nerve and its two sides, and the spinal cord (FMA7647) has no mesh
# in the archive at all. What it does carry under the nervous system is brain internals —
# commissures, internal capsule, white matter — which this project already has at far better
# quality, correctly parcellated, in cortex.glb and subcortical.glb.
#
# So there is nothing here to build a nerve layer out of, and inventing one would break the
# rule the whole project rests on. The muscle -> nerve root -> cord -> brain traversal is
# therefore drawn as a schematic route between *measured* endpoints (a real muscle centroid,
# a real vertebral level, a real brain region), labelled in the UI as a diagram rather than
# anatomy — exactly what neurolab already does for its word pathways.
DROP_SYSTEMS = ['nervous', 'sense', 'integumentary', 'lymphoid', 'genital']

# Named things that are real anatomy but noise in an exercise app, or containers rather than
# structures. Matched against the normalised base name.
SKIP = re.compile(r'''
    tooth|gingiv|dental|periodont|pulp\b|enamel|dentine|cement\b|
    ^set\ of|nail|hair|eyelash|nasal\ hair|
    tarsal\ plate|lacrimal|conjunctiv
''', re.I | re.X)

_SIDE = re.compile(r'\b(?:left|right)\b\s*', re.I)
# 'ascending part of', 'long head of', 'anterior belly of' — subdivisions of one named muscle
_SUBDIV = re.compile(r'^.*?\b(?:part|head|belly|portion)\s+of\s+', re.I)


def base_name(name):
    """'ascending part of left trapezius' -> 'trapezius'.

    One region id per named structure, both sides together, because MUSCLE_INFO describes a
    muscle rather than a muscle-half and because every part-of and head-of subdivision in
    this ontology shares one origin, insertion and nerve supply.

    Laterality is removed in place rather than by dropping everything before it: 'skeleton of
    left foot' has to become 'skeleton of foot', not 'foot'.
    """
    n = _SIDE.sub('', name.strip().lower())
    n = _SUBDIV.sub('', n)
    return re.sub(r'\s+', ' ', n).strip()


def side_of(name):
    n = name.strip().lower()
    if re.search(r'\bleft\b', n):
        return 'L'
    if re.search(r'\bright\b', n):
        return 'R'
    return 'M'


def partition(ar, names, kids):
    """-> {base name: {'system','layer','parts':[(fma, full name)]}}, one layer each.

    Resolved once, globally, rather than per layer: a structure reachable from two systems
    takes the higher-priority one, and every layer build then reads the same answer.
    """
    member = {}
    for s in SYSTEM_PRIORITY:
        for fma in bp3d.descendants(kids, bp3d.SYSTEMS[s]):
            member.setdefault(fma, []).append(s)
    dropped = set()
    for s in DROP_SYSTEMS:
        dropped |= bp3d.descendants(kids, bp3d.SYSTEMS[s])

    groups = {}
    for fma in sorted(ar.keys()):
        nm = names.get(fma)
        if not nm:
            continue
        systems = member.get(fma)
        # in a dropped system and nothing else -> not body geometry we build
        if not systems or (fma in dropped and not systems):
            continue
        base = base_name(nm)
        if SKIP.search(base):
            continue
        sysname = min(systems, key=SYSTEM_PRIORITY.index)
        g = groups.setdefault(base, {'systems': set(), 'parts': []})
        g['systems'].add(sysname)
        g['parts'].append((fma, nm))

    out = {}
    for base, g in groups.items():
        sysname = min(g['systems'], key=SYSTEM_PRIORITY.index)
        layer = LAYER_OF_SYSTEM[sysname]
        if layer == 'muscles':
            layer = 'muscles_superficial' if base in SUPERFICIAL else 'muscles_deep'
        out[base] = {'system': sysname, 'layer': layer, 'parts': g['parts']}
    return out


def build_layer(layer, ar, parts_by_base, frame, alloc, verbose=True):
    merged = {b: g for b, g in parts_by_base.items() if g['layer'] == layer}

    center = np.asarray(frame['center'])
    scale = frame['scale']
    budget = BUDGET[layer]

    parts_out, table, rows = [], [], []
    for base in sorted(merged):
        g = merged[base]
        entries = g['parts']
        # One region id per named structure, but one *mesh* per side. The id carries the
        # anatomical identity that content and picking are keyed to; the side carries the
        # rigid body it belongs to, because the left femur and the right femur move
        # independently and a single merged mesh cannot be parented to two segments.
        bySide = {}
        for fma, nm in entries:
            r = ar.read(fma)
            if r is None:
                continue
            P, F = r
            # archive LPS mm -> canonical mm -> body units
            C = np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)
            bySide.setdefault(side_of(nm), []).append(((C - center) * scale, F))
        if not bySide:
            continue
        rid = alloc(base)
        before = 0
        emitted = []
        for side, meshes in sorted(bySide.items()):
            P, F = bp3d.merge(meshes)
            before += len(F)
            # budget is per structure, shared across its sides
            share = max(240, budget // len(bySide))
            Pd, Fd, _ = decimate(P.astype(np.float32), F.astype(np.int32), share)
            parts_out.append((f'{base}|{side}', Pd, Fd, rid))
            emitted.append((side, Pd, Fd))
        Pd = np.vstack([e[1] for e in emitted])
        Fd = np.vstack([e[2] for e in emitted])
        centroid = Pd.astype(np.float64).mean(0)
        table.append({
            'id': rid,
            'name': base,
            'layer': layer,
            'system': g['system'],
            'fma': [f for f, _ in entries],
            'sides': sorted(bySide),
            'tris': int(len(Fd)),
            'centroid': [round(float(v), 5) for v in centroid],
            # per-side centroids, so the rig can assign each mesh to a segment
            'perSide': {sd: [round(float(v), 5) for v in P.astype(np.float64).mean(0)]
                        for sd, P, _ in emitted},
        })
        rows.append((base, rid, len(entries), before, len(Fd)))

    if not parts_out:
        return [], 0

    path = os.path.join(OUT_MODELS, f'{layer}.glb')
    size = write_glb(path, parts_out)

    if verbose:
        total_before = sum(r[3] for r in rows)
        total_after = sum(r[4] for r in rows)
        print(f'\n{layer}: {len(rows)} structures, '
              f'{total_before:,} -> {total_after:,} tris, {size/1e6:.2f} MB')
        print(f'  {"structure":42s} {"id":>5s} {"parts":>5s} {"tris in":>9s} {"out":>7s} {"%":>6s}')
        for base, rid, n, b, a in sorted(rows, key=lambda r: -r[4])[:24]:
            print(f'  {base[:42]:42s} {rid:5d} {n:5d} {b:9,d} {a:7,d} {100*a/total_after:5.1f}%')
        if len(rows) > 24:
            print(f'  ... and {len(rows)-24} more')
    return table, size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--layer', choices=sorted(LAYERS), action='append')
    args = ap.parse_args()
    layers = args.layer or list(LAYERS)

    frame = json.load(open(os.path.join(OUT_MODELS, 'body_frame.json')))
    ar = bp3d.Archive()
    names = bp3d.load_names()
    kids = bp3d.load_tree()
    parts_by_base = partition(ar, names, kids)

    # One allocator across every layer, so an id means one structure globally and a rebuild
    # of a single layer cannot renumber another.
    assigned, order = {}, []

    def alloc(base):
        if base not in assigned:
            assigned[base] = ID_BASE + len(order)
            order.append(base)
        return assigned[base]

    table, total = [], 0
    for layer in layers:
        rows, size = build_layer(layer, ar, parts_by_base, frame, alloc)
        table.extend(rows)
        total += size

    os.makedirs(OUT_GEN, exist_ok=True)
    doc = {
        'source': frame['source'],
        'attribution': frame['attribution'],
        'licence': 'CC BY-SA 2.1 JP',
        'idBase': ID_BASE,
        'frame': {'center': frame['center'], 'scale': frame['scale'],
                  'heightMm': frame['height_mm'], 'note': frame['note']},
        'structures': sorted(table, key=lambda r: r['id']),
    }
    path = os.path.join(OUT_GEN, 'structures.json')
    json.dump(doc, open(path, 'w'), indent=1)
    print(f'\ntotal {total/1e6:.2f} MB across {len(layers)} layers, '
          f'{len(table)} structures -> {os.path.relpath(path, ROOT)}')


if __name__ == '__main__':
    main()
