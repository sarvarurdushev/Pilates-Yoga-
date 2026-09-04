"""BodyParts3D source data: the parts list, the containment tree, and the OBJ meshes.

Same rule as the brain half — nothing is hand-modelled. Every body mesh in this project
comes out of this archive, and every structure keeps the FMA id it arrived with, which is
what makes the ids traceable to a standard ontology instead of invented here.

Source: BodyParts3D/Anatomography, release 3.0 (20110915), polygon reduction 99%.
        The Database Center for Life Science, licensed CC Attribution-Share Alike 2.1 Japan.
        https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
        Mitsuhashi N et al., Nucleic Acids Res. 2009;37(Database issue):D782-5.

Run scripts/fetch_bodyparts3d.sh first; it puts everything under bpdata/.
"""
import os, zipfile, io, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'bpdata')
ZIP  = os.path.join(DATA, 'obj99.zip')

ATTRIBUTION = ('BodyParts3D, (c) The Database Center for Life Science '
               'licensed under CC Attribution-Share Alike 2.1 Japan')

# roots of the containment tree, by FMA id
SYSTEMS = {
    'skeletal':      'FMA23881',
    'muscular':      'FMA72954',
    'nervous':       'FMA7157',
    'cardiovascular':'FMA7161',
    'respiratory':   'FMA7158',
    'alimentary':    'FMA7152',
    'urinary':       'FMA7159',
    'endocrine':     'FMA9668',
    'integumentary': 'FMA72979',
    'sense':         'FMA78499',
    'lymphoid':      'FMA74594',
    'genital':       'FMA7160',
}


def load_names(path=None):
    """FMA id -> English name."""
    path = path or os.path.join(DATA, 'parts_list_e.txt')
    out = {}
    with open(path, encoding='utf-8', errors='replace') as f:
        next(f)
        for line in f:
            bits = line.rstrip('\n').split('\t')
            if len(bits) >= 2 and bits[0].startswith('FMA'):
                out[bits[0]] = bits[1].strip()
    return out


def load_tree(path=None):
    """parent FMA id -> set of child FMA ids, from conventional_part_of.txt."""
    path = path or os.path.join(DATA, 'conventional_part_of.txt')
    kids = {}
    with open(path, encoding='utf-8', errors='replace') as f:
        next(f)
        for line in f:
            bits = line.rstrip('\n').split('\t')
            if len(bits) >= 3 and bits[0].startswith('FMA') and bits[2].startswith('FMA'):
                kids.setdefault(bits[0], set()).add(bits[2])
    return kids


def descendants(kids, root):
    """Every id under `root`, root excluded. Iterative: the tree has cycles in places."""
    seen, stack = set(), [root]
    while stack:
        cur = stack.pop()
        for c in kids.get(cur, ()):
            if c not in seen:
                seen.add(c)
                stack.append(c)
    return seen


class Archive:
    """The OBJ zip, indexed by FMA id."""

    def __init__(self, path=ZIP):
        self.zip = zipfile.ZipFile(path)
        self.index = {}
        for n in self.zip.namelist():
            m = re.search(r'(FMA\d+)\.obj$', n)
            if m:
                self.index[m.group(1)] = n

    def __contains__(self, fma):
        return fma in self.index

    def keys(self):
        return self.index.keys()

    def read(self, fma):
        """-> (P float64 [n,3], F int64 [m,3]) in the archive's own coordinates, or None."""
        name = self.index.get(fma)
        if not name:
            return None
        verts, faces = [], []
        with self.zip.open(name) as fh:
            for raw in io.TextIOWrapper(fh, encoding='utf-8', errors='replace'):
                if raw.startswith('v '):
                    verts.append([float(x) for x in raw.split()[1:4]])
                elif raw.startswith('f '):
                    # 'f a/b/c d/e/f g/h/i' or plain 'f a d g'; OBJ indices are 1-based
                    idx = [int(tok.split('/')[0]) for tok in raw.split()[1:]]
                    for k in range(1, len(idx) - 1):
                        faces.append([idx[0], idx[k], idx[k + 1]])
        if not verts or not faces:
            return None
        P = np.asarray(verts, dtype=np.float64)
        F = np.asarray(faces, dtype=np.int64) - 1
        F = F[(F >= 0).all(1) & (F < len(P)).all(1)]
        return (P, F) if len(F) else None


def to_canonical(P):
    """Archive coordinates -> the project's axis convention: +X LEFT, +Y SUPERIOR, +Z ANTERIOR.

    BodyParts3D OBJ files are in a right-handed frame with +x to the subject's LEFT,
    +y SUPERIOR and +z ANTERIOR already — the same convention this project uses, which is
    checked rather than assumed by scripts/check_frame.py. Kept as a named function so
    there is exactly one place to change if a future source disagrees.
    """
    return P.copy()


def merge(meshes):
    """[(P,F)] -> one (P,F), offsetting indices."""
    Ps, Fs, off = [], [], 0
    for P, F in meshes:
        Ps.append(P); Fs.append(F + off); off += len(P)
    if not Ps:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    return np.vstack(Ps), np.vstack(Fs)


def surface_area(P, F):
    t = P[F]
    return float(np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1).sum() / 2)
