"""
The body's own outer envelope, so the gaps between structures stop being holes.

The problem this solves is visible in every posed screenshot. The body here is ~500
individually segmented structures — BodyParts3D gives one closed mesh per muscle, bone and
organ — and they do not tile into a closed surface. Between the external oblique and the
serratus, between a rib and the sheet over it, there is real empty space. Seen at a glancing
angle against a near-black page you look straight *through* the trunk, and it reads as a hole
punched in the back. It is not a hole in any mesh (all 366 muscles and 90 organs are closed,
zero open boundary edges), not backface culling, and not shading: the pixels really are the
page.

What is missing is a body surface. BodyParts3D has skin; this build does not include it, and
fetching it is gigabytes. But the envelope does not have to be *scanned* — it can be
*derived*, and derived is what everything else here is. Voxelise every structure, close the
volume, and take its outer surface: that is the body's own silhouette, computed from the same
segmentation, claiming nothing that is not already in the data.

It is emitted **per rig segment** rather than as one shell. A single closed body would have to
be skinned across every joint in the model, which is the hardest possible case; forty-seven
shells each rigidly bound to the segment whose bones they enclose deform exactly as well as
the skeleton does, with no weights to get wrong. Each is dilated slightly so neighbours
overlap at the joints instead of parting.

This is a backdrop, not anatomy. It carries no region id, is not selectable, is not labelled,
and is not in the structure table — the app draws it behind everything as dark tissue so that
a gap shows the inside of the body rather than the page.

    python3 scripts/build_shell.py [--vox 0.004]
"""
import json, os, re, sys
import numpy as np
from scipy import ndimage
from skimage import measure

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_read import primitives_faces
from glb_common import decimate, weld, write_glb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'models')
GEN = os.path.join(ROOT, 'src', 'generated')

# Everything that makes up the body's bulk. Nerves are thin open tubes and would only add
# spikes to the envelope.
LAYERS = ['skeleton', 'muscles_superficial', 'muscles_deep', 'organs']
# The organs sit inside the shell, so an unbroken shell hides them the moment that layer is
# turned on — and hiding the shell instead brings the gaps straight back, which is the state
# most people browse in. Cutting the organ volume out of the shell lets both be true: the
# shell fills the gaps in the body wall, and where an organ is there is a cavity for it to
# show through.
ORGAN_LAYERS = ['organs']
ORGAN_GROW = 2         # voxels of clearance around an organ, so its cavity is never tight
VOX = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--vox=')), 0.004))
PAD = 6                # voxels of empty margin, so dilation and marching cubes have room
ERODE = 5              # voxels the shell sits *inside* the body surface, so it can never
                       # poke through the anatomy it is meant to sit behind
DILATE = 1             # voxels each segment's piece grows, so neighbours meet at a joint
TARGET_TRIS = 1200     # per segment; this is a backdrop, not a surface anyone inspects
# Only the axial body. The gaps this exists to close are a trunk problem — the trunk is a
# stack of overlapping sheets with real space between them — while a limb is a few big
# muscles wrapped round one bone and has no gaps to speak of. A limb shell is all cost: it is
# bound rigidly while the muscles over it are skinned, so at a flexed knee or elbow the two
# diverge and the shell pokes through the outside of the bend.
LIMB = re.compile(r'^(femur|tibia|patella|talus|calcn|toes|humerus|ulna|radius|hand)_')


def sample_triangles(P, F, step):
    """Points covering every triangle at no more than `step` apart — enough that the voxel
    grid sees a watertight surface rather than a sieve."""
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    out = [a, b, c]
    # longest edge of each triangle decides how finely it has to be split
    longest = np.maximum(np.linalg.norm(b - a, axis=1),
                         np.maximum(np.linalg.norm(c - b, axis=1),
                                    np.linalg.norm(a - c, axis=1)))
    n = np.clip(np.ceil(longest / step).astype(int), 1, 24)
    for k in np.unique(n):
        if k < 2:
            continue
        m = n == k
        A, B, C = a[m], b[m], c[m]
        # a regular barycentric lattice on each triangle in this bucket
        for i in range(k + 1):
            for j in range(k + 1 - i):
                u, v = i / k, j / k
                out.append(A * (1 - u - v) + B * u + C * v)
    return np.concatenate(out, 0)


def signed_volume(V, F):
    """Six times the signed volume. Positive when the faces wind counter-clockwise seen from
    outside, which is the direction three.js treats as front."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum())


def main():
    rig = json.load(open(os.path.join(GEN, 'rig.json')))
    binding = rig['binding']

    meshes = []           # (name, P, F, layer)
    for layer in LAYERS:
        path = os.path.join(MODELS, f'{layer}.glb')
        if not os.path.exists(path):
            sys.exit(f'missing {path} — run the body build first')
        for name, P, F in primitives_faces(path):
            meshes.append((name, P, F, layer))
    print(f'{len(meshes)} meshes over {len(LAYERS)} layers')

    allP = np.concatenate([m[1] for m in meshes], 0)
    lo = allP.min(0) - VOX * PAD
    hi = allP.max(0) + VOX * PAD
    dims = np.ceil((hi - lo) / VOX).astype(int) + 1
    print(f'grid {dims.tolist()} at {VOX} body units '
          f'({VOX * 1750:.1f} mm), {np.prod(dims) / 1e6:.1f}M voxels')

    def to_ijk(P):
        return np.clip(np.rint((P - lo) / VOX).astype(int), 0, dims - 1)

    solid = np.zeros(dims, dtype=bool)
    organ = np.zeros(dims, dtype=bool)
    # segment id per voxel of skeleton, 0 = none
    segs = sorted({v for v in binding.values()})
    seg_id = {s: i + 1 for i, s in enumerate(segs)}
    bone = np.zeros(dims, dtype=np.uint8)

    for name, P, F, layer in meshes:
        pts = to_ijk(sample_triangles(P, F, VOX * 0.7))
        solid[pts[:, 0], pts[:, 1], pts[:, 2]] = True
        if layer in ORGAN_LAYERS:
            organ[pts[:, 0], pts[:, 1], pts[:, 2]] = True
        if layer == 'skeleton':
            base, _, side = name.partition('|')
            seg = binding.get(f'{base}|{side}') or binding.get(f'{base}|M')
            if seg:
                bone[pts[:, 0], pts[:, 1], pts[:, 2]] = seg_id[seg]

    print(f'surface voxels {solid.sum() / 1e6:.2f}M, bone-labelled {np.count_nonzero(bone) / 1e6:.2f}M')

    # Close the shell, then fill it: the union of the structures is a hollow rind until the
    # holes between them are bridged, and it is the *filled* body whose outer face we want.
    solid = ndimage.binary_closing(solid, ndimage.generate_binary_structure(3, 2), iterations=2)
    solid = ndimage.binary_fill_holes(solid)
    print(f'filled {solid.sum() / 1e6:.2f}M voxels')

    # Which segment owns each voxel: the one whose bones are nearest. Same rule the binder
    # uses in the browser, computed here on a grid instead of per mesh.
    _, idx = ndimage.distance_transform_edt(bone == 0, return_indices=True)
    owner = bone[idx[0], idx[1], idx[2]]

    # The shell is drawn front-facing and opaque, so it has to sit *behind* every structure or
    # it would hide them. Eroding the filled body puts it a couple of centimetres under the
    # surface: far enough in that no muscle is thinner than the gap, close enough that it
    # still reads as the inside of the body rather than a small core.
    inner = ndimage.binary_erosion(solid, ndimage.generate_binary_structure(3, 1),
                                   iterations=ERODE)
    organ = ndimage.binary_fill_holes(
        ndimage.binary_closing(organ, ndimage.generate_binary_structure(3, 2), iterations=2))
    organ = ndimage.binary_dilation(organ, ndimage.generate_binary_structure(3, 1),
                                    iterations=ORGAN_GROW)
    inner &= ~organ
    print(f'inner {inner.sum() / 1e6:.2f}M voxels after eroding {ERODE} '
          f'and cutting {organ.sum() / 1e6:.2f}M of organ cavity')
    owner[~inner] = 0

    parts = []
    struct = ndimage.generate_binary_structure(3, 1)
    for seg, sid in seg_id.items():
        if LIMB.match(seg):
            continue
        m = owner == sid
        if m.sum() < 200:
            continue
        # grow just enough to meet the neighbouring segment, never past the eroded surface
        m = ndimage.binary_dilation(m, struct, iterations=DILATE) & inner
        # marching cubes needs a margin of empty voxels on every side
        sub = np.pad(m.astype(np.float32), 1)
        try:
            V, Fc, _, _ = measure.marching_cubes(sub, level=0.5)
        except (ValueError, RuntimeError):
            continue
        V = (V - 1) * VOX + lo
        V, Fc = weld(V, Fc)
        # Marching cubes orients its faces against the gradient, which for an occupancy
        # volume points *into* the solid — so the normals come out facing inward and a shell
        # drawn BackSide shows its outside and hides the anatomy it is meant to sit behind.
        # Signed volume says which way round it is, and it is a property of the mesh rather
        # than of the library's convention, so it cannot go stale.
        if signed_volume(V, Fc) < 0:
            Fc = Fc[:, ::-1]
        if len(Fc) > TARGET_TRIS:
            V, Fc, _ = decimate(V, Fc, TARGET_TRIS)   # (P, F, labels)
        parts.append((seg, V, Fc.astype(np.uint32), 0))
        print(f'  {seg:12s} {m.sum():8d} voxels -> {len(Fc):5d} tris')

    out = os.path.join(MODELS, 'shell.glb')
    write_glb(out, parts)
    print(f'\nwrote {out}: {len(parts)} shells, '
          f'{sum(len(p[2]) for p in parts)} triangles, '
          f'{os.path.getsize(out) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
