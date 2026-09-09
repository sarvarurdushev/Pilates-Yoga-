"""Builds the layers the curated body does not have, from BodyParts3D release 4.0.

`build_body.py` builds the taught body: the bones, the muscles and the viscera a Pilates
studio names, from the 934-mesh release-3.0 archive, one structure per FMA concept with the
two sides together. That is the right shape for the thing this application is *for*, and it
is 449 structures.

It is not the whole atlas. Release 4.0 ships the same body cut into 2,234 element files, and
most of what it adds is not in 3.0 at all: 562 arteries, 349 veins, the tracheobronchial and
biliary trees, the cranial nerves, the cartilages and ligaments. This script builds those,
into layers of their own, without touching a structure `build_body.py` owns.

What it emits:
    models/arteries.glb      the arterial tree, segment by segment
    models/veins.glb         the venous tree
    models/airways.glb       tracheobronchial and biliary trees
    models/connective.glb    cartilage, ligament, tendon, membrane
    models/nerves_cranial.glb  cranial and peripheral nerve trunks
    models/heart_detail.glb  valve cusps and papillary muscles
    models/detail.glb        every remaining named piece the archive has
    src/generated/structures.json   appended to, never overwritten

Rules inherited from the body build and not up for renegotiation:
  * decimation happens here, in Python, via glb_common.decimate, because mesh simplifiers
    average custom vertex attributes and a region id must stay an exact integer
  * region ids come from the allocator, never hand-maintained, and step over every id
    another build has already baked into a GLB
  * a piece keeps the FMA id it arrived with

BodyParts3D, (c) The Database Center for Life Science, licensed under
CC Attribution 4.0 International. See ATTRIBUTION.md.
"""
import sys, os, re, json, argparse, collections
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bp3d
from glb_common import decimate, write_glb
from build_body import side_of, ID_BASE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MODELS = os.path.join(ROOT, 'models')
OUT_GEN = os.path.join(ROOT, 'src', 'generated')

#: Layers this script owns. Anything else in structures.json is left exactly as it is.
#: The complete-atlas layers: BodyParts3D 4.0's own cut of anatomy the taught body
#: already has. Named apart from the taught structures -- see `key` below.
FULL_LAYERS = ('bones_full', 'muscles_full', 'organs_full')

LAYERS = ['arteries', 'veins', 'airways', 'connective', 'nerves_cranial',
          'heart_detail', 'detail',
          # The pieces the taught body already draws, at 4.0's own granularity:
          # sided, and split into the parts a whole muscle is made of. Human Atlas
          # shows these as separate pieces -- "Left Gluteus Maximus" is one of its
          # 2,234 -- and skipping them is why this atlas had half its count.
          'bones_full', 'muscles_full', 'organs_full']

#: Where each layer's members come from in the IS-A tree, most specific first.
#:
#: Order matters: an artery is a vessel and a vessel is a tree organ, so the arterial root
#: has to be tested before the tree-organ one or every artery lands in `airways`.
TYPE_ROOTS = [
    # A named artery, and the zones and segments its named parts are filed under: the
    # cerebral arteries are all *zone of artery*, so without that root the whole circle of
    # Willis fell out of the build with no error and nothing to see.
    ('arteries',      ['FMA50720', 'FMA66332', 'FMA3711', 'FMA86254']),
    ('veins',         ['FMA50723', 'FMA55677']),           # venous tree, then any hollow tree
    # Nerve trunks are *segment of neural tree organ*, which is where the optic nerve lives.
    ('nerves_cranial', ['FMA61284', 'FMA65132', 'FMA5913', 'FMA11195']),
    ('connective',    ['FMA55107', 'FMA21496', 'FMA9721', 'FMA7145']),
    # The heart's own working parts: valve cusps and papillary muscles, which are organ
    # components rather than organs and so belong to no system root at all. Narrow roots
    # on purpose -- `region of organ component` also holds the lateral ventricles, the
    # cerebral aqueduct, the hippocampus and the iris, and a layer called heart_detail
    # containing a hippocampus is a layer nobody can trust.
    ('heart_detail',  ['FMA7232', 'FMA268955', 'FMA86565']),
    ('airways',       ['FMA12224', 'FMA71856', 'FMA30320']),  # bronchial, biliary, duct
]

#: Systems the curated body already draws. A 4.0 piece under one of these is a second copy
#: of something already on screen, so it is skipped rather than drawn twice.
ALREADY = ['FMA5018',    # bone organ
           'FMA5022',    # muscle organ
           'FMA83143',   # cell part cluster of neuraxis — the brain, which we have better
           'FMA55661',   # parenchymatous organ
           'FMA55671',   # cavitated organ
           'FMA55652',   # anatomical set
           'FMA7163']    # skin

#: Triangles per structure. Vessels are tubes and a tube reads at very few triangles; the
#: cartilages are surfaces somebody may look at closely.
BUDGET = {'arteries': 320, 'veins': 320, 'airways': 480,
          'connective': 700, 'nerves_cranial': 400, 'heart_detail': 500,
          'detail': 420,
          'bones_full': 620, 'muscles_full': 520, 'organs_full': 520}


_SIDE = re.compile(r'\b(?:left|right)\b\s*', re.I)
#: `set of interspinales lumborum` is the ontology's word for a container, not part of the
#: muscle's name -- and the taught build strips it for the eleven of these it keeps, so a
#: reader seeing both atlases would meet the same muscle under two names, one of which reads
#: like a filing category. tests/test_atlas_ids.py holds the whole table to this.
_SET_PREFIX = re.compile(r'^set\s+of\s+', re.I)


def clean_name(name):
    return _SET_PREFIX.sub('', str(name).strip())


def unsided(name):
    """'left third rib' -> 'third rib', the key `build_body.py` files a structure under."""
    return re.sub(r'\s+', ' ', _SIDE.sub('', clean_name(name).lower())).strip()


#: The IS-A tree files a named vessel under `arterial tree organ`, but its *parts* -- an
#: arch, a trunk, a digital branch -- under organ zones and segments that have no system
#: above them at all. Six palmar digital veins and both palmar arches came out unfiled for
#: exactly that reason. Where the tree does not say, the name does: these are the only two
#: words in this vocabulary that are unambiguous about what a structure is.
_ARTERY = re.compile(r'\barter(?:y|ies|ial)\b', re.I)
_VEIN = re.compile(r'\b(?:vein|veins|venous)\b', re.I)

#: Left out on purpose rather than by accident. The cerebral gyri and sulci are in this
#: archive at 99% reduction; this project already carries the cortex properly parcellated
#: at far better quality, and drawing a second, coarser copy of it inside the head would be
#: two brains disagreeing. Cavities are holes -- a mesh of the inside of a ventricle drawn
#: solid is a lie about what is there.
_NOT_DRAWN = re.compile(r'\bgyrus\b|\bsulcus\b|\bcortex\b|\bcavity of\b', re.I)


def classify(best, kids, names_of, drawn=()):
    """element id -> (layer, concept), for the elements this build owns.

    `drawn` maps every structure name the rest of the atlas already carries to its layer. A 4.0 concept
    that matches one -- by its system root or by its name -- is the same anatomy the taught
    body already has, at 4.0's finer granularity: sided, and split into parts. Those go into
    the `_full` layers rather than being dropped, because they are most of what a complete
    atlas is, and they are kept apart from the taught layers rather than mixed in with them
    so that the two are never drawn at once. See `setAtlasDepth` on the application side.
    """
    #: The taught structure this 4.0 concept is a second cut of, by name -> its layer.
    #: Routing by IS-A membership alone put `set of interspinales cervicis` in
    #: organs_full: a *set of* muscles is filed under `anatomical set`, not under
    #: `muscle organ`, so the muscle test missed it. What the taught body already
    #: decided is the better answer, and it is one lookup away.
    have = {unsided(n): l for n, l in drawn.items()}
    TO_FULL = {'skeleton': 'bones_full',
               'muscles_superficial': 'muscles_full', 'muscles_deep': 'muscles_full',
               'organs': 'organs_full'}
    under = {}
    for layer, roots in TYPE_ROOTS:
        s = set()
        for r in roots:
            s |= bp3d.isa_descendants(kids, r) | {r}
        under[layer] = s
    already = set()
    for r in ALREADY:
        already |= bp3d.isa_descendants(kids, r) | {r}

    out, skipped = {}, collections.Counter()
    bone = bp3d.isa_descendants(kids, 'FMA5018') | {'FMA5018'}
    muscle = bp3d.isa_descendants(kids, 'FMA5022') | {'FMA5022'}

    for elem, concept in best.items():
        nm = names_of.get(concept, '')
        if _NOT_DRAWN.search(nm):
            skipped['drawn better elsewhere'] += 1
            continue
        twin = have.get(unsided(nm))
        if concept in already or twin:
            out[elem] = (TO_FULL.get(twin)
                         or ('bones_full' if concept in bone
                             else 'muscles_full' if concept in muscle
                             else 'organs_full'), concept)
            continue
        for layer, _ in TYPE_ROOTS:
            if concept in under[layer]:
                out[elem] = (layer, concept)
                break
        else:
            # the tree did not say; the name does, or it goes in the catch-all
            out[elem] = (('arteries' if _ARTERY.search(nm)
                          else 'veins' if _VEIN.search(nm) else 'detail'), concept)
    return out, skipped


def build_layer(layer, owned, names, el, frame, alloc, verbose=True):
    """One GLB and one table slice. Structures are concepts; meshes are elements."""
    byConcept = collections.defaultdict(list)
    for elem, (lay, concept) in owned.items():
        if lay == layer:
            byConcept[concept].append(elem)

    center = np.asarray(frame['center'])
    scale = frame['scale']
    budget = BUDGET[layer]
    parts_out, table, rows = [], [], []

    for concept in sorted(byConcept, key=lambda c: names.get(c, c)):
        nm = clean_name(names.get(concept, concept))
        elems = sorted(byConcept[concept])
        bySide = {}
        for e in elems:
            r = el.read(e)
            if r is None:
                continue
            P, F = r
            # archive LPS mm -> canonical mm -> body units, the same three lines as the
            # body build: the two releases are in one frame at one scale
            C = np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)
            bySide.setdefault(side_of(nm), []).append(((C - center) * scale, F))
        if not bySide:
            continue
        rid = alloc(f'{layer}:{nm}')
        before, emitted = 0, []
        for side, meshes in sorted(bySide.items()):
            P, F = bp3d.merge(meshes)
            before += len(F)
            share = max(120, budget // len(bySide))
            Pd, Fd, _ = decimate(P.astype(np.float32), F.astype(np.int32), share)
            if not len(Fd):
                continue
            parts_out.append((f'{nm}|{side}', Pd, Fd, rid))
            emitted.append((side, Pd, Fd))
        if not emitted:
            continue
        Pd = np.vstack([e[1] for e in emitted])
        Fd = np.vstack([e[2] for e in emitted])
        table.append({
            'id': rid,
            'name': nm,
            # The key the registry files this under, where that cannot be the name.
            #
            # The complete-atlas layers are the same anatomy the taught body already
            # carries, so "atlas" and "sacrum" and "liver" arrive a second time. The
            # registry is a Map keyed by name, and a second `atlas` would replace the
            # first -- taking every exercise, every written entry and all the Korean
            # keyed to that name with it, and pointing them at a record in a layer that
            # is switched off. The displayed name is unchanged; only the key is
            # qualified, and only for the layers that need it.
            'key': f'{nm} (4.0)' if layer in FULL_LAYERS else nm,
            'layer': layer,
            'system': layer,
            'fma': [concept],
            'sides': sorted({s for s, _, _ in emitted}),
            'tris': int(len(Fd)),
            'pieces': len(elems),
            'centroid': [round(float(v), 5) for v in Pd.astype(np.float64).mean(0)],
            'perSide': {sd: [round(float(v), 5) for v in P.astype(np.float64).mean(0)]
                        for sd, P, _ in emitted},
        })
        rows.append((nm, rid, len(elems), before, len(Fd)))

    if not parts_out:
        return [], 0
    path = os.path.join(OUT_MODELS, f'{layer}.glb')
    size = write_glb(path, parts_out)
    if verbose:
        print(f'\n{layer}: {len(rows)} structures, {len(parts_out)} pieces, '
              f'{sum(r[3] for r in rows):,} -> {sum(r[4] for r in rows):,} tris, '
              f'{size/1e6:.2f} MB')
        for nm, rid, n, b, a in sorted(rows, key=lambda r: -r[4])[:10]:
            print(f'  {nm[:46]:46s} {rid:5d} {n:4d} pieces {b:8,d} -> {a:6,d}')
        if len(rows) > 10:
            print(f'  ... and {len(rows)-10} more')
    return table, size


def existing_document(path):
    """Everything already in structures.json that this build does not own.

    Two other builds write this file and neither is cheap to re-run: `build_body.py` needs
    the 3.0 archive, `build_nervous.py` needs Blender and a 306 MB Z-Anatomy file. Their
    ids are baked into their GLBs as a per-vertex attribute and cannot be renumbered
    without rebuilding those files, so this build allocates *around* them.
    """
    if not os.path.exists(path):
        return {}, [], set()
    with open(path, encoding='utf-8') as f:
        doc = json.load(f)
    keep = [s for s in doc.get('structures', []) if s.get('layer') not in LAYERS]
    return doc, keep, {s['id'] for s in keep}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--layer', choices=LAYERS)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    frame_path = os.path.join(OUT_MODELS, 'body_frame.json')
    with open(frame_path, encoding='utf-8') as f:
        frame = json.load(f)

    claims, names = bp3d.load_elements()
    kids = bp3d.load_isa_tree()
    best = bp3d.most_specific(claims, kids)
    el = bp3d.Elements()

    missing = set(el.keys()) - set(best)
    if missing:
        print(f'WARNING: {len(missing)} element files have no concept and are not drawn')

    doc_path = os.path.join(OUT_GEN, 'structures.json')
    previous, keep, reserved = existing_document(doc_path)

    owned, skipped = classify(best, kids, names,
                              {s['name']: s['layer'] for s in keep})
    per = collections.Counter(l for l, _ in owned.values())
    print(f'{len(el.index)} element files, {len(best)} with a concept')
    for k, v in skipped.most_common():
        print(f'  skipped, {k}: {v}')
    for layer in LAYERS:
        print(f'  {layer:16s} {per[layer]:5d} pieces')
    if args.dry_run:
        return

    nxt = [max(reserved) + 1 if reserved else ID_BASE]
    seen = {}

    def alloc(name):
        if name in seen:
            return seen[name]
        while nxt[0] in reserved:
            nxt[0] += 1
        seen[name] = nxt[0]
        nxt[0] += 1
        return seen[name]

    table, total = [], 0
    for layer in (LAYERS if not args.layer else [args.layer]):
        t, size = build_layer(layer, owned, names, el, frame, alloc)
        table += t
        total += size

    doc = dict(previous)
    doc['structures'] = sorted(keep + table, key=lambda s: s['id'])
    # `sources` is keyed by layer -- see build_nervous.py, which records the nervous
    # layer's own share-alike there. One entry per layer this build owns, so a reader
    # asking where the arteries came from is answered without knowing which script ran.
    sources = dict(previous.get('sources', {}))
    for layer in LAYERS:
        sources[layer] = {
            'attribution': bp3d.ATTRIBUTION,
            'licence': 'CC BY 4.0',
            'release': bp3d.RELEASE_40,
            'url': 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/',
        }
    doc['sources'] = sources
    with open(doc_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    print(f'\n{len(table)} structures added, {total/1e6:.2f} MB, '
          f'{len(doc["structures"])} in the atlas')


if __name__ == '__main__':
    main()
