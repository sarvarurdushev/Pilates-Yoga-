"""
Extract real anatomical surfaces from FreeSurfer's aseg segmentation.

Everything that is not cerebral cortex — cerebellum, brainstem, hippocampus, amygdala,
thalamus, basal ganglia, ventricles, corpus callosum — comes from here rather than being
modelled by hand. Source: fsaverage/mri/aseg.mgz (FreeSurfer automatic subcortical
segmentation, Fischl et al., Neuron 2002).

Output is one GLB per structure group, in the same canonical frame as the cortex.
"""
import numpy as np, nibabel as nib, json, struct, os, sys
from skimage import measure
from scipy import ndimage

ASEG  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/aseg.mgz'
OUTD  = sys.argv[2] if len(sys.argv) > 2 else 'public/models'
FRAME = json.load(open(os.path.join(OUTD, 'frame.json')))
CTR, SCALE = np.array(FRAME['center']), FRAME['scale']

# region id -> (label ids in aseg, display name)
GROUPS = {
  5:  ([7, 8, 46, 47],                 'cerebellum'),
  6:  ([16, 28, 60],                   'brainstem'),
  20: ([17, 53],                       'hippocampus'),
  21: ([18, 54],                       'amygdala'),
  22: ([10, 49],                       'thalamus'),
  23: ([251, 252, 253, 254, 255],      'corpus callosum'),
  24: ([4, 43, 14, 15],                'ventricles'),
  25: ([11, 12, 13, 50, 51, 52],       'basal ganglia'),
}
CORTEX = ([2, 3, 41, 42], 'cerebrum')

img = nib.load(ASEG)
vol = np.asarray(img.dataobj)
tkr = img.header.get_vox2ras_tkr()      # surfaces live in tkrRAS, not scanner RAS

def taubin(v, f, iters=24, lam=0.62, mu=-0.65):
    """Volume-preserving smoothing. Plain Laplacian shrinks structures noticeably."""
    n = len(v)
    nb = [[] for _ in range(n)]
    for a, b, c in f:
        nb[a] += [b, c]; nb[b] += [a, c]; nb[c] += [a, b]
    idx = np.concatenate([np.array(x, dtype=np.int64) for x in nb])
    own = np.repeat(np.arange(n), [len(x) for x in nb])
    deg = np.bincount(own, minlength=n).astype(np.float64)[:, None]
    deg[deg == 0] = 1
    for i in range(iters):
        acc = np.zeros_like(v)
        np.add.at(acc, own, v[idx])
        v = v + (lam if i % 2 == 0 else mu) * (acc / deg - v)
    return v

def extract(labels, name, level=0.5, smooth=24, pad=3):
    mask = np.isin(vol, labels)
    if not mask.any(): return None
    # crop for speed, then blur slightly so marching cubes is not stair-stepped
    sl = ndimage.find_objects(mask.astype(np.uint8))[0]
    sl = tuple(slice(max(0, s.start-pad), min(d, s.stop+pad)) for s, d in zip(sl, mask.shape))
    sub = ndimage.gaussian_filter(mask[sl].astype(np.float32), 0.7)
    v, f, _, _ = measure.marching_cubes(sub, level=level)
    v = v + np.array([s.start for s in sl])
    v = taubin(v, f, iters=smooth)
    ras = np.c_[v[:, [0, 1, 2]], np.ones(len(v))] @ tkr.T      # voxel -> tkrRAS
    P = np.stack([-ras[:, 0], ras[:, 2], ras[:, 1]], 1)        # -> canonical axes
    P = (P - CTR) * SCALE
    print(f"  {name:<16} {len(P):>7} verts  {len(f):>7} tris  "
          f"bbox {np.round(P.min(0),3)}..{np.round(P.max(0),3)}")
    return P.astype(np.float32), f.astype(np.uint32)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_common import decimate, write_glb

# per-structure triangle budgets: the cerebellum needs detail for its folia, a thalamus
# does not
BUDGET = {5:34000, 6:14000, 20:7000, 21:3500, 22:5000, 23:4000, 24:12000, 25:8000}

print("subcortical + cerebellum + brainstem:")
parts = []
for rid,(labels,name) in GROUPS.items():
    r = extract(labels, name)
    if not r: continue
    P, F = r
    P, F, _ = decimate(P, F, BUDGET.get(rid, 6000))
    print(f"    -> {len(F):,} tris after decimation")
    parts.append((name, P, F, rid))
sz = write_glb(os.path.join(OUTD,'subcortical.glb'), parts)
print(f"wrote subcortical.glb  {sz/1e6:.2f} MB  ({len(parts)} structures)")

# The aseg cerebral-cortex label was evaluated as a source for the outer surface and
# rejected: at 1 mm it marching-cubes into a pockmarked blob with the sulci filled in,
# clearly worse than the fsaverage surface. The cortex comes from build_cortex.py.
