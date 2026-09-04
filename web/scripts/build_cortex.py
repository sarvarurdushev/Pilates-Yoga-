"""
Build the cortical surface from real neuroimaging data.

Source data (both from FreeSurfer's fsaverage template, identical vertex indexing):
  * lh/rh.white        - white-matter surface of the fsaverage average brain
  * lh/rh.aparc.annot  - Desikan-Killiany parcellation (Desikan et al., NeuroImage 2006)

This replaces the earlier hand-fitted plane atlas. Boundaries here are the published
DK boundaries, not geometry guessed from a generated blob.

CANONICAL FRAME (used by every other file in this project):
    +X = LEFT   +Y = SUPERIOR   +Z = ANTERIOR      right-handed
    fsaverage/MNI RAS (x=right, y=anterior, z=superior)  ->  X=-x, Y=z, Z=y
    origin = mid-surface centroid, anterior-posterior length normalised to 1.0
"""
import numpy as np, nibabel.freesurfer as fsio, struct, json, sys, os

SURF_DIR = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
OUT      = sys.argv[2] if len(sys.argv) > 2 else 'public/models/cortex-raw.glb'

# teaching region ids  (must match src/regionData.js)
FRONTAL, PARIETAL, TEMPORAL, OCCIPITAL = 1, 2, 3, 4
CEREBELLUM, BRAINSTEM = 5, 6
MOTOR, SOMATO, BROCA, WERNICKE = 7, 8, 9, 10
CINGULATE, INSULA = 11, 12
AUDITORY, SUPRAMARG, ANGULAR = 13, 14, 15   # each maps to one assessment system

DK_MAP = {
    # frontal
    'superiorfrontal': FRONTAL, 'rostralmiddlefrontal': FRONTAL,
    'caudalmiddlefrontal': FRONTAL, 'parsorbitalis': FRONTAL,
    'lateralorbitofrontal': FRONTAL, 'medialorbitofrontal': FRONTAL,
    'frontalpole': FRONTAL, 'paracentral': FRONTAL,
    # Broca's area = pars opercularis + pars triangularis, left hemisphere only
    'parsopercularis': BROCA, 'parstriangularis': BROCA,
    # parietal
    'superiorparietal': PARIETAL,
    'precuneus': PARIETAL,
    # broken out because the English assessment maps a skill onto each of these
    'supramarginal': SUPRAMARG,      # phonological working memory
    'inferiorparietal': ANGULAR,     # vocabulary / word meaning (contains angular gyrus)
    'transversetemporal': AUDITORY,  # Heschl's gyrus, primary auditory cortex
    # temporal
    'superiortemporal': TEMPORAL, 'middletemporal': TEMPORAL,
    'inferiortemporal': TEMPORAL, 'bankssts': TEMPORAL, 'fusiform': TEMPORAL,
    'entorhinal': TEMPORAL,
    'temporalpole': TEMPORAL, 'parahippocampal': TEMPORAL,
    # occipital
    'lateraloccipital': OCCIPITAL, 'lingual': OCCIPITAL,
    'cuneus': OCCIPITAL, 'pericalcarine': OCCIPITAL,
    # central strips
    'precentral': MOTOR, 'postcentral': SOMATO,
    # limbic / insular
    'rostralanteriorcingulate': CINGULATE, 'caudalanteriorcingulate': CINGULATE,
    'posteriorcingulate': CINGULATE, 'isthmuscingulate': CINGULATE,
    'insula': INSULA,
    # medial wall — not real cortex, left unassigned
    'unknown': 0, 'corpuscallosum': 0,
}

# --- white -> pial approximation ---------------------------------------------
# fsaverage ships lh.white but not lh.pial on any reachable mirror. The pial surface is
# the white surface displaced outward along the normal by the cortical thickness, and
# thickness is not uniform: it is greatest on gyral crowns (~2.8 mm) and least in sulcal
# fundi (~1.2 mm). FreeSurfer's curv file encodes exactly that distinction (positive =
# sulcal, negative = gyral), so the displacement is modulated by it.
#
# Offsetting less inside sulci is also what keeps opposite banks from intersecting, which
# is the failure mode of a naive constant offset.
PIAL_MIN_MM, PIAL_MAX_MM = 1.15, 2.85

def to_pial(v, f, curv):
    n = np.zeros_like(v)
    tri = v[f]
    fn = np.cross(tri[:,1]-tri[:,0], tri[:,2]-tri[:,0])
    for k in range(3):
        np.add.at(n, f[:,k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True); ln[ln==0] = 1
    n /= ln
    c = np.clip(curv, np.percentile(curv, 2), np.percentile(curv, 98))
    t = (c - c.min()) / max(1e-9, (c.max() - c.min()))     # 0 = gyral crown, 1 = sulcal fundus
    mm = PIAL_MAX_MM + (PIAL_MIN_MM - PIAL_MAX_MM) * t
    return v + n * mm[:, None]

verts, faces, regs = [], [], []
offset = 0
stats = {}
for hemi in ('lh', 'rh'):
    v, f = fsio.read_geometry(os.path.join(SURF_DIR, f'{hemi}.white'))
    curv = fsio.read_morph_data(os.path.join(SURF_DIR, f'{hemi}.curv'))
    v = to_pial(v, f, curv)
    lab, ctab, names = fsio.read_annot(os.path.join(SURF_DIR, f'{hemi}.aparc.annot'))
    names = [n.decode() if isinstance(n, bytes) else n for n in names]

    r = np.zeros(len(v), dtype=np.int32)
    for i, nm in enumerate(names):
        sel = lab == i
        rid = DK_MAP.get(nm, 0)
        # Broca's and Wernicke's areas are left-lateralised: on the right hemisphere
        # the same gyri are ordinary frontal / parietal cortex and must not be labelled
        # as language areas.
        if hemi == 'rh' and rid == BROCA:
            rid = FRONTAL
        r[sel] = rid
        stats[(hemi, nm)] = int(sel.sum())

    # Wernicke's area: posterior superior temporal gyrus + banks of the superior
    # temporal sulcus, left hemisphere only. DK does not split superiortemporal,
    # so the posterior portion is taken by its own y-extent.
    if hemi == 'lh':
        i_st = names.index('superiortemporal')
        i_bk = names.index('bankssts')
        st = lab == i_st
        if st.any():
            y = v[:, 1]                       # anterior positive
            cut = np.percentile(y[st], 38)    # posterior ~38% of the gyrus
            r[st & (y < cut)] = WERNICKE
        r[lab == i_bk] = WERNICKE

    verts.append(v); regs.append(r); faces.append(f + offset)
    offset += len(v)

V = np.concatenate(verts).astype(np.float64)
F = np.concatenate(faces).astype(np.uint32)
R = np.concatenate(regs).astype(np.float32)

# ---- canonical frame ----------------------------------------------------------
P = np.stack([-V[:, 0], V[:, 2], V[:, 1]], axis=1)      # X=left, Y=superior, Z=anterior
lo, hi = P.min(0), P.max(0)
ctr = (lo + hi) / 2
scale = 1.0 / (hi[2] - lo[2])                            # A-P length -> 1.0
P = (P - ctr) * scale
print(f"canonical bbox  {P.min(0).round(3)}  ->  {P.max(0).round(3)}")
print(f"L:W:H ratio = {(np.ptp(P[:,2])/np.ptp(P[:,1])):.2f} : {(np.ptp(P[:,0])/np.ptp(P[:,1])):.2f} : 1.00")

# vertex normals
N = np.zeros_like(P)
tri = P[F]
fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
for k in range(3):
    np.add.at(N, F[:, k], fn)
ln = np.linalg.norm(N, axis=1, keepdims=True); ln[ln == 0] = 1
N /= ln

print(f"vertices {len(P):,}  triangles {len(F):,}")
counts = {int(k): int((R == k).sum()) for k in np.unique(R)}
NAMES = {0:'medial wall',1:'frontal',2:'parietal',3:'temporal',4:'occipital',
         7:'motor',8:'somatosensory',9:"Broca's",10:"Wernicke's",11:'cingulate',
         12:'insula',13:'auditory (Heschl)',14:'supramarginal',15:'angular'}
for k in sorted(counts):
    print(f"  {k:>2} {NAMES.get(k,'?'):<16} {counts[k]:>7}  {counts[k]/len(R)*100:5.1f}%")

# ---- decimate (labels transferred by nearest neighbour, never averaged) --------
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_common import decimate, write_glb
TARGET = int(os.environ.get('TARGET_TRIS', 300000))
P, F, R = decimate(P, F, TARGET, R)
print(f"decimated -> {len(P):,} verts  {len(F):,} tris")
R = np.round(R).astype(np.float32)
sz = write_glb(OUT, [('cortex', P, F, R)])
print(f"wrote {OUT}  {sz/1e6:.2f} MB")
c2 = {int(k): int((R==k).sum()) for k in np.unique(R)}
for k in sorted(c2): print(f"  {k:>2} {NAMES.get(k,'?'):<18} {c2[k]:>7}  {c2[k]/len(R)*100:5.1f}%")
raise SystemExit

# ---- (legacy inline writer below, unused) --------------------------------------
def pad4(b): return b + b'\x00' * (-len(b) % 4)
pos = P.astype(np.float32).tobytes()
nor = N.astype(np.float32).tobytes()
reg = R.astype(np.float32).tobytes()
idx = F.astype(np.uint32).tobytes()
blob = pad4(pos) + pad4(nor) + pad4(reg) + pad4(idx)
o1, o2, o3 = len(pad4(pos)), len(pad4(pos)) + len(pad4(nor)), len(pad4(pos)) + len(pad4(nor)) + len(pad4(reg))

gltf = {
 "asset": {"version": "2.0", "generator": "neurolab build_cortex.py (fsaverage + Desikan-Killiany)"},
 "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "cortex"}],
 "meshes": [{"name": "cortex", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "_REGION": 2}, "indices": 3}]}],
 "buffers": [{"byteLength": len(blob)}],
 "bufferViews": [
   {"buffer":0,"byteOffset":0, "byteLength":len(pos),"target":34962},
   {"buffer":0,"byteOffset":o1,"byteLength":len(nor),"target":34962},
   {"buffer":0,"byteOffset":o2,"byteLength":len(reg),"target":34962},
   {"buffer":0,"byteOffset":o3,"byteLength":len(idx),"target":34963}],
 "accessors": [
   {"bufferView":0,"componentType":5126,"count":len(P),"type":"VEC3",
    "min":P.min(0).tolist(),"max":P.max(0).tolist()},
   {"bufferView":1,"componentType":5126,"count":len(P),"type":"VEC3"},
   {"bufferView":2,"componentType":5126,"count":len(P),"type":"SCALAR"},
   {"bufferView":3,"componentType":5125,"count":len(F)*3,"type":"SCALAR"}],
}
# the JSON chunk must be padded with SPACES; the BIN chunk with nulls
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
out += struct.pack('<II', len(js), 0x4E4F534A) + js
out += struct.pack('<II', len(blob), 0x004E4942) + blob
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'wb').write(out)
print(f"\nwrote {OUT}  {len(out)/1e6:.1f} MB")
