"""Replaces the rig's single lumbar joint with a 24-segment spine.

The limitation this removes: Rajagopal's torso is one rigid body on one lumbar joint, so a
roll-up flexed the trunk as a block and sequential segmental articulation — the entire point
of several Pilates exercises — could not be represented at all.

Nothing here is drawn. The joint centres are the **intervertebral disc centroids** already in
the model: BodyParts3D segments all 23 discs, each named for the vertebra above it, so the
disc of L4 sits between L4 and L5 and *is* the L4-L5 joint centre. The atlanto-axial and
atlanto-occipital joints have no disc and are placed at the midpoint of the two bones they
join, which is stated rather than hidden.

Range of motion per level is published: White AA, Panjabi MM, Clinical Biomechanics of the
Spine, 2nd ed., 1990, Table 2-1 — the standard segmental table. Flexion and extension are
split 60/40 in the lumbar spine and evenly elsewhere, which is the usual approximation.

The chain is *inserted* between pelvis and torso rather than replacing torso, and torso is
re-parented onto T1 with an offset that preserves its world position at the default pose. So
the OpenSim registration still holds, the arms still hang off torso, and every muscle path
point expressed in the torso frame is untouched — but the whole upper body now rides an
articulating spine.

Runs after scripts/parse_opensim.py, whose rig.json it rewrites.
"""
import sys, os, json
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


GEN = os.path.join(ROOT, 'src', 'generated')

ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
           'ninth', 'tenth', 'eleventh', 'twelfth']

# (segment, structure name, disc that is its joint centre, [flex+ext, bend, rot] degrees)
# Bottom to top. The disc named for a vertebra is the one below it, so it is the joint
# between that vertebra and its parent in this upward chain.
LUMBAR = [('L5', 5), ('L4', 4), ('L3', 3), ('L2', 2), ('L1', 1)]
THORACIC = [(f'T{n}', n) for n in range(12, 0, -1)]
CERVICAL = [(f'C{n}', n) for n in range(7, 2, -1)]

ROM = {   # White & Panjabi 1990, representative segmental values, degrees
    'L5': (20, 3, 5), 'L4': (17, 6, 2), 'L3': (15, 8, 2), 'L2': (14, 6, 2), 'L1': (12, 6, 2),
    'T12': (12, 8, 2), 'T11': (12, 9, 2), 'T10': (9, 7, 2), 'T9': (6, 6, 4),
    'T8': (6, 6, 6), 'T7': (6, 6, 8), 'T6': (5, 6, 8), 'T5': (4, 6, 8),
    'T4': (4, 6, 9), 'T3': (4, 6, 9), 'T2': (4, 6, 9), 'T1': (4, 6, 9),
    'C7': (9, 4, 2), 'C6': (17, 7, 6), 'C5': (20, 8, 7), 'C4': (20, 11, 7), 'C3': (15, 11, 7),
    'C2': (20, 5, 40),     # atlanto-axial: almost all of the head's rotation happens here
    'C1': (25, 5, 5),      # atlanto-occipital: the "yes" joint
}
# lumbar levels flex much further than they extend; elsewhere the split is even
FLEX_SHARE = {**{k: 0.6 for k in ('L5', 'L4', 'L3', 'L2', 'L1')},
              **{k: 0.5 for k in ROM if not k.startswith('L')}}

REGIONS = {
    'lumbar':   ['L5', 'L4', 'L3', 'L2', 'L1'],
    'thoracic': [f'T{n}' for n in range(12, 0, -1)],
    'cervical': ['C7', 'C6', 'C5', 'C4', 'C3', 'C2', 'C1'],
}

# OpenSim axes: +X forward, +Y up, +Z right. Matches the axes Rajagopal's own back joint uses.
#
# The sign matters and is easy to get backwards, because nothing about a rotation axis says
# which way the word "flexion" points. These are chosen so that **positive matches the name**,
# checked against the hip, which is the joint whose convention the rest of the rig already
# follows: standing, `hip_flexion` sends the thigh anterior, and `lumbar_flex` now sends the
# head the same way. Written with the opposite sign, every chest lift in the library extended
# the neck instead of curling it and every backbend folded forward, all while sitting neatly
# inside the published range. test/library.test.mjs asserts the direction now.
AXIS_FLEX = [0.0, 0.0, -1.0]    # sagittal;  + is flexion, - is extension
AXIS_BEND = [1.0, 0.0, 0.0]     # coronal;   + is lateral flexion toward the right
AXIS_ROT  = [0.0, 1.0, 0.0]     # transverse;+ turns the chest toward the left

CITATION = ('White AA, Panjabi MM. Clinical Biomechanics of the Spine, 2nd ed. '
            'Lippincott, 1990 — segmental range of motion')


def structure_map():
    doc = json.load(open(os.path.join(GEN, 'structures.json')))
    return doc, {s['name']: s for s in doc['structures']}


def vertebra_name(seg):
    kind, n = seg[0], int(seg[1:])
    if kind == 'C' and n == 1:
        return 'atlas'
    if kind == 'C' and n == 2:
        return 'axis'
    word = {'L': 'lumbar', 'T': 'thoracic', 'C': 'cervical'}[kind]
    return f'{ORDINAL[n - 1]} {word} vertebra'


def disc_name(seg):
    v = vertebra_name(seg)
    return f'intervertebral disk of {v}'


def main():
    doc, byname = structure_map()
    rig = json.load(open(os.path.join(GEN, 'rig.json')))
    reg = rig['registration']
    s = reg['scale']
    R = np.asarray(reg['rotation'])
    t = np.asarray(reg['translation'])
    Rinv = R.T                      # a rotation, so the transpose is the inverse

    def to_osim(p):
        """Body-frame point -> the OpenSim units the rig lives in under its root node."""
        return (Rinv @ (np.asarray(p) - t)) / s

    chain = [(seg, n) for seg, n in LUMBAR] + [(seg, n) for seg, n in THORACIC] + \
            [(seg, n) for seg, n in CERVICAL] + [('C2', 2), ('C1', 1)]
    order = [seg for seg, _ in chain]

    # joint centre per segment, in body frame
    centres, sourced = {}, {}
    for seg in order:
        d = byname.get(disc_name(seg))
        if d:
            centres[seg] = np.asarray(d['centroid'])
            sourced[seg] = 'disc'
        else:
            # no disc at C1-C2 or C0-C1: the midpoint of the two bones they join
            v = byname.get(vertebra_name(seg))
            below = {'C1': 'axis', 'C2': 'third cervical vertebra'}.get(seg)
            b = byname.get(below) if below else None
            if v is None or b is None:
                sys.exit(f'cannot place the joint for {seg}')
            centres[seg] = (np.asarray(v['centroid']) + np.asarray(b['centroid'])) / 2
            sourced[seg] = 'midpoint'
    # the skull rides on C1; its joint is the atlanto-occipital, already C1's
    skull_centre = byname['occipital bone']['centroid']

    segs = rig['segments']
    coords = rig['coordinates']

    # the old single lumbar joint goes; its three coordinates go with it
    old_back = segs.get('torso', {}).get('joint')
    for cname in [c for c, v in coords.items() if v.get('joint') == old_back]:
        del coords[cname]

    torso_world = np.asarray(segs['torso']['worldAtDefault'])

    prev = 'pelvis'
    prev_world = np.asarray(segs['pelvis']['worldAtDefault'])
    rows = []
    for seg in order:
        c = to_osim(centres[seg])
        rom = ROM[seg]
        share = FLEX_SHARE[seg]
        axes, ranges = [], {}
        for suffix, axis, deg in (('flex', AXIS_FLEX, rom[0]),
                                  ('bend', AXIS_BEND, rom[1]),
                                  ('rot',  AXIS_ROT,  rom[2])):
            cname = f'{seg}_{suffix}'
            axes.append({'coordinate': cname, 'axis': axis})
            if suffix == 'flex':
                # positive is flexion, negative is extension — the opposite of Rajagopal's
                # `lumbar_extension`, and named `_flex` so the sign matches the word
                lo, hi = -np.radians(deg * (1 - share)), np.radians(deg * share)
            else:
                lo, hi = -np.radians(deg), np.radians(deg)
            # White & Panjabi, not Rajagopal: the model has no vertebral joints to have an
            # opinion about. `rangeSource` is what the app reads to say where a limit came from.
            ranges[cname] = {'default': 0.0, 'range': [float(lo), float(hi)],
                             'rangeSource': 'published',
                             'joint': f'{seg}_joint', 'segment': seg}
        segs[seg] = {
            'name': seg, 'parent': prev, 'joint': f'{seg}_joint',
            'translation': (c - prev_world).tolist(),
            'orientation': [0.0, 0.0, 0.0],
            'childTranslation': [0.0, 0.0, 0.0], 'childOrientation': [0.0, 0.0, 0.0],
            'axes': axes, 'translationAxes': [],
            'worldAtDefault': c.tolist(),
            'jointSource': sourced[seg],
        }
        coords.update(ranges)
        rows.append((seg, sourced[seg], rom))
        prev, prev_world = seg, c

    # the skull is the last link, so head nod and turn have somewhere to live
    skull_o = to_osim(skull_centre)
    segs['skull'] = {
        'name': 'skull', 'parent': 'C1', 'joint': 'skull_joint',
        'translation': (skull_o - prev_world).tolist(), 'orientation': [0, 0, 0],
        'childTranslation': [0, 0, 0], 'childOrientation': [0, 0, 0],
        'axes': [], 'translationAxes': [], 'worldAtDefault': skull_o.tolist(),
        'jointSource': 'occipital centroid',
    }

    # torso rides the top of the thoracic chain, offset so its default world position — and
    # therefore the whole OpenSim registration and every torso-frame path point — is unchanged
    t1_world = np.asarray(segs['T1']['worldAtDefault'])
    segs['torso']['parent'] = 'T1'
    segs['torso']['joint'] = 'torso_ride'
    segs['torso']['translation'] = (torso_world - t1_world).tolist()
    segs['torso']['axes'] = []
    segs['torso']['translationAxes'] = []

    # ---------------------------------------------------------------- binding
    binding = rig['binding']
    for seg in order:
        for nm in (vertebra_name(seg), disc_name(seg)):
            st = byname.get(nm)
            if st:
                for sd in st['sides']:
                    binding[f'{nm}|{sd}'] = seg
    # every rib rides its own thoracic vertebra
    for n in range(1, 13):
        nm = f'{ORDINAL[n - 1]} rib'
        st = byname.get(nm)
        if st:
            for sd in st['sides']:
                binding[f'{nm}|{sd}'] = f'T{n}'
    # 'ethmoid' and 'eyeball' are the names BodyParts3D actually emits — the list said
    # 'ethmoid bone', which matched nothing, so both rode the torso and the eyes stayed at
    # the chest whenever the head turned
    for nm in ['occipital bone', 'mandible', 'frontal bone', 'parietal bone', 'temporal bone',
               'sphenoid bone', 'ethmoid', 'ethmoid bone', 'zygomatic bone', 'maxilla',
               'nasal bone', 'lacrimal bone', 'palatine bone', 'vomer', 'hyoid bone',
               'skeleton of skull', 'inferior nasal concha', 'eyeball']:
        st = byname.get(nm)
        if st:
            for sd in st['sides']:
                binding[f'{nm}|{sd}'] = 'skull'

    # How much of a regional command each level takes. Weighted **per axis** by that level's
    # own published range on that axis, which matters: T12 has 8 degrees of side bend and 2 of
    # rotation, so a share taken from the flexion column would have capped thoracic rotation
    # at the level that rotates least. Weighting each axis by its own column makes a regional
    # command's full travel equal the anatomical sum for that axis.
    AXES = ('flex', 'bend', 'rot')
    share = {r: {ax: {seg: float(ROM[seg][i]) / sum(ROM[x][i] for x in levels)
                      for seg in levels}
                 for i, ax in enumerate(AXES)}
             for r, levels in REGIONS.items()}
    # The usable range of each regional command, derived from the per-joint ranges actually
    # emitted above rather than restated — a regional value outside this drives at least one
    # joint past its published limit. test/content.test.mjs checks every clip against it.
    region_range = {}
    for r, levels in REGIONS.items():
        region_range[r] = {}
        for ax in AXES:
            lo, hi = -1e9, 1e9
            for seg in levels:
                c = coords[f'{seg}_{ax}']['range']
                f = share[r][ax][seg]
                lo, hi = max(lo, c[0] / f), min(hi, c[1] / f)
            region_range[r][ax] = [lo, hi]

    rig['spine'] = {
        'chain': order, 'regions': REGIONS, 'citation': CITATION,
        'jointSource': 'intervertebral disc centroids, BodyParts3D; C1-C2 and C0-C1 midpoints',
        'share': share,
        'regionRange': region_range,
    }

    json.dump(rig, open(os.path.join(GEN, 'rig.json'), 'w'), indent=1)

    print(f'spine: {len(order)} segments inserted between pelvis and torso')
    print(f'  {"seg":5s} {"joint centre from":18s} {"flex/ext":>9s} {"bend":>6s} {"rot":>5s}')
    for seg, src, rom in rows:
        print(f'  {seg:5s} {src:18s} {rom[0]:8d}° {rom[1]:5d}° {rom[2]:4d}°')
    print(f'\n  total sagittal range {sum(r[2][0] for r in rows)}° across the chain')
    print('  regional command travel, degrees:')
    for r in REGIONS:
        cells = '  '.join(f'{ax} {np.degrees(region_range[r][ax][0]):6.1f}..{np.degrees(region_range[r][ax][1]):5.1f}'
                          for ax in AXES)
        print(f'    {r:9s} {cells}')
    print(f'  torso re-parented onto T1, offset {np.round(segs["torso"]["translation"], 4)}')
    print(f'  {len(rig["coordinates"])} coordinates, {len(segs)} segments, '
          f'{len(binding)} bound meshes')


if __name__ == '__main__':
    main()
