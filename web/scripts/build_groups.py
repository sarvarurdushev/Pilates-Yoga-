"""Anatomical groups: the ontology's own answer to "show me the adductors".

Every structure in this atlas is selectable one at a time, which is the wrong
granularity for most of what a coach says out loud. "The hamstrings", "the deep
neck flexors", "the lumbar spine", "the rotator cuff" — none of those is a mesh,
and until now none of them was a thing the application could point at.

They do not have to be invented. BodyParts3D ships the Foundational Model of
Anatomy's own hierarchy alongside the meshes: an IS-A tree (a semispinalis
capitis *is a* semispinalis) and a PART-OF tree (the iliocostalis *is part of*
the erector spinae). Every structure here already carries the FMA ids it arrived
with — that is the whole point of keying by FMA rather than by an id invented
here — so the hierarchy joins straight onto the atlas with nothing hand-drawn in
between.

**Three tables, unioned.** Release 4.0 publishes `isa_inclusion_relation_list`
and `partof_inclusion_relation_list`; release 3.0, which is where these meshes
came from, publishes `conventional_part_of`. All three are parent-FMA to
child-FMA and all three are the same database, so they are read as one directed
graph and closed transitively. The union matters: 3.0 alone misses `gluteal
muscle` and `postvertebral muscle`, 4.0 alone misses `pelvic diaphragm` and
`triceps surae`.

**What this script does not decide.** It emits every concept that resolves to
between two and forty structures here — 252 of them, including `irregular bone`
and `left ring finger`, which are true and useless. Which groups a reader is
actually offered is an editorial judgement and it lives in
`src/content/groups.js`, where it can be read and argued with. This file's job
is to make sure that whatever is offered has membership the ontology vouches
for rather than membership somebody typed.

    ./fetch_bodyparts3d.sh          # puts the tables in ../bpdata
    python3 build_groups.py         # writes ../src/generated/groups.json

Source: BodyParts3D, (c) The Database Center for Life Science, licensed under
CC Attribution 4.0 International. https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
"""
import json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
DATA = os.path.join(WEB, 'bpdata')
OUT = os.path.join(WEB, 'src', 'generated', 'groups.json')

ATTRIBUTION = ('BodyParts3D, (c) The Database Center for Life Science '
               'licensed under CC Attribution 4.0 International')

#: Smallest group worth having. One member is not a group, it is the structure.
MIN = 2
#: Largest. Above this the concept has stopped naming a group and started naming
#: a body region -- `head` resolves to forty structures across four layers.
MAX = 40

#: parent-FMA -> child-FMA tables, in the order they are read. The third is the
#: 3.0 release these meshes came from; the first two are 4.0. Same database.
EDGES = [
    ('isa_inclusion_relation_list.txt', 'isa'),
    ('partof_inclusion_relation_list.txt', 'part-of'),
    ('conventional_part_of.txt', 'part-of (3.0)'),
]

#: FMA -> English name. Later files do not overwrite earlier ones, so the 4.0
#: spelling wins where the releases disagree.
NAMES = [
    ('isa_parts_list_e.txt', 2),
    ('partof_parts_list_e.txt', 2),
    ('parts_list_e.txt', 1),
]


def _rows(name):
    path = os.path.join(DATA, name)
    with open(path, encoding='utf-8', errors='replace') as f:
        next(f)                                   # header
        for line in f:
            bits = line.rstrip('\n').split('\t')
            if bits and bits[0].startswith('FMA'):
                yield bits


def load_names():
    out = {}
    for name, col in NAMES:
        for bits in _rows(name):
            if len(bits) > col:
                out.setdefault(bits[0], bits[col].strip())
    return out


def load_graph():
    """parent -> children, and (parent, child) -> which tables said so."""
    kids = collections.defaultdict(set)
    via = collections.defaultdict(set)
    for name, tag in EDGES:
        for bits in _rows(name):
            # every table is parent-id, parent-name, child-id, child-name
            if len(bits) >= 3 and bits[2].startswith('FMA'):
                kids[bits[0]].add(bits[2])
                via[(bits[0], bits[2])].add(tag)
    return kids, via


def closure(kids, root):
    """Every descendant of `root`, cycles tolerated."""
    seen, stack = set(), [root]
    while stack:
        for child in kids.get(stack.pop(), ()):
            if child not in seen:
                seen.add(child)
                stack.append(child)
    return seen


def build(structures):
    names = load_names()
    kids, via = load_graph()

    #: The complete-atlas layers are BodyParts3D 4.0's own cut of anatomy the taught
    #: body already carries, and they are never drawn at the same time as it. Counted
    #: into these groups they double every membership -- `abdominal wall` went from
    #: nineteen structures to thirty-eight and straight past MAX, so the group was
    #: dropped and the curation in src/content/groups.js started naming concepts that
    #: no longer existed. A group is a set of things you can see at once; these are
    #: not, so they are not in one.
    FULL_LAYERS = {'bones_full', 'muscles_full', 'organs_full'}

    by_fma = collections.defaultdict(set)
    for s in structures:
        if s.get('layer') in FULL_LAYERS:
            continue
        for fma in s['fma']:
            by_fma[fma].add(s['id'])

    found = {}
    for root in kids:
        if root not in names:
            continue
        members = set()
        for fma in closure(kids, root) | {root}:
            members |= by_fma.get(fma, set())
        if MIN <= len(members) <= MAX:
            found[root] = (names[root], frozenset(members))

    """Concepts with identical membership are the same group said twice.

    `pelvic girdle`, `pelvic wall` and `pelvis` can all close over the same two
    bones, and offering a reader three names for one selection is worse than
    offering one -- so identical member sets collapse to a single group.

    **The names all survive.** Collapsing on the shortest label alone would have
    published `posterior chest` and thrown away `thoracic vertebra`, which is
    the same twelve bones under the name anybody would actually search for. So
    each group carries every concept id and label the ontology gave that set,
    and `src/content/groups.js` says which of them to show. Picking the label is
    editorial; inventing one is not allowed.
    """
    by_members = collections.defaultdict(list)
    for cid, (name, members) in found.items():
        by_members[members].append((cid, name))

    groups = []
    for members, concepts in by_members.items():
        concepts.sort(key=lambda c: (len(c[1]), c[0]))
        cid, name = concepts[0]
        tags = set()
        for child in kids.get(cid, ()):
            tags |= via[(cid, child)]
        groups.append({
            'id': cid,
            'name': name,
            'members': sorted(members),
            'aliases': [{'id': a, 'name': n} for a, n in concepts[1:]],
            'via': sorted(tags),
        })
    groups.sort(key=lambda g: g['name'])
    return groups


def main():
    with open(os.path.join(WEB, 'src', 'generated', 'structures.json'),
              encoding='utf-8') as f:
        structures = json.load(f)['structures']

    missing = [name for name, _ in EDGES if not os.path.exists(os.path.join(DATA, name))]
    if missing:
        raise SystemExit(
            'missing BodyParts3D tables: ' + ', '.join(missing) +
            '\nrun scripts/fetch_bodyparts3d.sh first')

    groups = build(structures)
    payload = {
        'source': ('BodyParts3D 4.0 IS-A and PART-OF inclusion tables, unioned with '
                   'the release 3.0 conventional PART-OF table'),
        'attribution': ATTRIBUTION,
        'licence': 'CC BY 4.0',
        'note': ('Membership is the transitive closure of the FMA hierarchy over this '
                 'atlas\'s own FMA ids. Nothing here is hand-assigned. Which groups are '
                 'shown is decided in src/content/groups.js, not here.'),
        'bounds': {'min': MIN, 'max': MAX},
        'groups': groups,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

    sizes = collections.Counter(len(g['members']) for g in groups)
    print(f'{len(groups)} groups, {sum(len(g["members"]) for g in groups)} memberships, '
          f'{sizes.most_common(1)[0][0]} the commonest size -> {OUT}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
