"""Measures BODY_FRAME and BRAIN_TO_BODY from the source data and emits them as constants.

Both were placeholders until this ran. The brief's rule for the brain frame applies here
too: the two numbers that define a frame come out of the build that produced the geometry,
not out of a person's judgement, and rebuilding from a different source means re-emitting
them.

  BODY_FRAME    origin = midpoint of the two ASIS, derived from the hip-bone meshes;
                scale  = 1 / standing height, from the skin mesh's superior-inferior extent.

  BRAIN_TO_BODY a similarity transform (uniform scale, rotation, translation — no shear)
                fitted by Umeyama's method to landmark pairs. Each pair is one structure
                that exists in both models: its centroid in BodyParts3D's brain, against its
                centroid in the fsaverage/aseg brain this project already ships. That makes
                the transform a measurement with a reported residual rather than an
                anthropometric estimate.

Usage: python3 scripts/derive_frame.py [--write]
"""
import sys, os, json, argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bp3d
from glb_read import region_centroids

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIN = 'FMA7163'
HIP  = {'left': 'FMA16587', 'right': 'FMA16586'}

# One structure, two independently built models. Left/right pairs are merged because the
# neurolab side carries them under a single bilateral region id.
#
# Resolved by name, never by FMA id written out here. Neighbouring ids in this ontology are
# not the same structure on the other side — FMA72666 is the left postcentral gyrus and
# FMA72667 is the right *supramarginal* gyrus — and an id that resolves to the wrong
# structure, or to nothing at all, biases the fit toward one hemisphere and shows up as a
# rotation the anatomy cannot have. It cost a spurious 12 degrees of roll to find that out.
LANDMARKS = [
    # (label, [BodyParts3D part names], neurolab region id)
    ('cerebellum',        ['cerebellum'],                                    5),
    ('brainstem',         ['pons', 'medulla oblongata'],                     6),
    ('motor cortex',      ['left precentral gyrus', 'right precentral gyrus'],   7),
    ('somatosensory',     ['left postcentral gyrus', 'right postcentral gyrus'], 8),
    ('hippocampus',       ['left hippocampus', 'right hippocampus'],        20),
    ('amygdala',          ['left amygdala', 'right amygdala'],              21),
    ('thalamus',          ['left thalamus', 'right thalamus'],              22),
    ('corpus callosum',   ['corpus callosum'],                              23),
    ('lateral ventricle', ['left lateral ventricle', 'right lateral ventricle'], 24),
    ('basal ganglia',     ['left putamen', 'right putamen',
                           'left caudate nucleus', 'right caudate nucleus',
                           'left globus pallidus', 'right globus pallidus'], 25),
]


def canonical(P):
    """BodyParts3D archive mm -> project axis convention, still in millimetres.

    Measured, not assumed: the left hip bone sits at +x and the right at -x, the eyeballs
    sit at the top of the z range, and the face sits at the *negative* end of y. So the
    archive is LPS (x LEFT, y POSTERIOR, z SUPERIOR) and the project wants (LEFT, SUPERIOR,
    ANTERIOR), which is a pure axis permutation with one sign flip. Both frames are
    right-handed, so no reflection is involved.
    """
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)


def asis(ar, side):
    """Anterior superior iliac spine: the most anterior vertex of the upper half of the
    hip bone. The upper-half restriction is what separates it from the pubic tubercle,
    which is also anterior but sits well below."""
    P, _ = ar.read(HIP[side])
    C = canonical(P)                       # X left, Y superior, Z anterior
    mid = (C[:, 1].min() + C[:, 1].max()) / 2
    upper = C[C[:, 1] > mid]
    return upper[np.argmax(upper[:, 2])]


def umeyama(A, B):
    """Least-squares similarity taking A onto B. Returns (scale, R 3x3, t).

    Umeyama 1991. The reflection guard matters: without it a noisy fit can return a
    left-handed R, which would silently mirror the brain inside the body.
    """
    n = len(A)
    mu_a, mu_b = A.mean(0), B.mean(0)
    Ac, Bc = A - mu_a, B - mu_b
    C = Bc.T @ Ac / n
    U, D, Vt = np.linalg.svd(C)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1
    R = U @ S @ Vt
    var_a = (Ac ** 2).sum() / n
    s = float(np.trace(np.diag(D) @ S) / var_a)
    t = mu_b - s * R @ mu_a
    return s, R, t


def euler_xyz(R):
    """R -> intrinsic XYZ Euler angles, matching THREE.Euler(order='XYZ')."""
    sy = R[0, 2]
    sy = max(-1.0, min(1.0, sy))
    y = np.arcsin(sy)
    if abs(sy) < 0.99999:
        x = np.arctan2(-R[1, 2], R[2, 2])
        z = np.arctan2(-R[0, 1], R[0, 0])
    else:
        x = np.arctan2(R[2, 1], R[1, 1])
        z = 0.0
    return [float(x), float(y), float(z)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='patch src/frame.js in place')
    args = ap.parse_args()

    ar = bp3d.Archive()

    # ---------------------------------------------------------------- body frame
    Pskin, _ = ar.read(SKIN)
    Cskin = canonical(Pskin)
    sole, vertex = float(Cskin[:, 1].min()), float(Cskin[:, 1].max())
    height = vertex - sole
    L, R_ = asis(ar, 'left'), asis(ar, 'right')
    origin = (L + R_) / 2

    print('body frame')
    print(f'  standing height   {height:8.1f} mm   (sole {sole:.1f} -> vertex {vertex:.1f})')
    print(f'  ASIS left         {np.round(L, 1)}')
    print(f'  ASIS right        {np.round(R_, 1)}')
    print(f'  ASIS midpoint     {np.round(origin, 1)} mm')
    print(f'  ASIS height       {(origin[1] - sole) / height:8.3f} of stature '
          f'(published anthropometry puts it near 0.57)')
    print(f'  inter-ASIS width  {abs(L[0] - R_[0]):8.1f} mm')
    scale = 1.0 / height

    # ---------------------------------------------------------- brain -> body fit
    brain = {}
    brain.update(region_centroids(os.path.join(ROOT, 'models', 'cortex.glb')))
    brain.update(region_centroids(os.path.join(ROOT, 'models', 'subcortical.glb')))

    by_name = {v: k for k, v in bp3d.load_names().items()}
    A, B, used = [], [], []
    for label, parts, rid in LANDMARKS:
        missing = [p for p in parts if p not in by_name]
        if missing:
            sys.exit(f'{label}: no such BodyParts3D part {missing} — check the name exactly')
        got = [ar.read(by_name[p]) for p in parts]
        absent = [p for p, g in zip(parts, got) if g is None]
        if absent:
            sys.exit(f'{label}: named parts {absent} have no mesh in the archive; a landmark '
                     f'present on one side only would bias the fit')
        got = [g for g in got if g is not None]
        if rid not in brain:
            print(f'  skip {label}: no region {rid} in the brain model')
            continue
        pts = np.vstack([canonical(P) for P, _ in got])
        A.append(brain[rid])                       # brain frame
        B.append((pts.mean(0) - origin) * scale)   # body frame
        used.append(label)

    A, B = np.asarray(A), np.asarray(B)
    if len(A) < 4:
        sys.exit(f'only {len(A)} landmark pairs; need at least 4 for a stable similarity fit')

    s, R, t = umeyama(A, B)
    fitted = (s * (R @ A.T).T) + t
    resid = np.linalg.norm(fitted - B, axis=1)

    print(f'\nbrain -> body, {len(A)} landmark pairs')
    print(f'  scale        {s:.6f}   (brain A-P length as a fraction of standing height)')
    print(f'  rotation     {np.round(np.degrees(euler_xyz(R)), 2)} deg XYZ')
    print(f'  translation  {np.round(t, 5)}')
    print(f'  residual     mean {resid.mean()*height:6.1f} mm   max {resid.max()*height:6.1f} mm')
    for lab, r in sorted(zip(used, resid), key=lambda kv: -kv[1]):
        print(f'      {lab:20s} {r*height:6.1f} mm')

    out = {
        'source': 'BodyParts3D 3.0 (20110915), 99% reduction',
        'attribution': bp3d.ATTRIBUTION,
        'note': 'archive mm -> canonical: X=x, Y=z, Z=-y, then (p-center)*scale',
        'center': [float(v) for v in origin],
        'scale': float(scale),
        'height_mm': float(height),
        'brainToBody': {
            'scale': float(s),
            'rotation': euler_xyz(R),
            'translation': [float(v) for v in t],
            'landmarks': used,
            'residual_mm': {'mean': float(resid.mean() * height),
                            'max': float(resid.max() * height)},
        },
    }
    path = os.path.join(ROOT, 'models', 'body_frame.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, 'w'), indent=2)
    print(f'\nwrote {os.path.relpath(path, ROOT)}')

    if args.write:
        patch_frame_js(out)


def patch_frame_js(out):
    import re
    path = os.path.join(ROOT, 'src', 'frame.js')
    src = open(path).read()
    b = out['brainToBody']
    fmt = lambda v: '[' + ', '.join(f'{x:.6g}' for x in v) + ']'
    body_block = (
        'export const BODY_FRAME = {\n'
        f'  center: {fmt(out["center"])},\n'
        f'  scale: {out["scale"]:.9g},\n'
        '  provisional: false,\n'
        "  landmark: 'ASIS midpoint',\n"
        "  unit: 'standing height = 1.0',\n"
        f'  heightMm: {out["height_mm"]:.6g},\n'
        '};')
    b2b_block = (
        'export const BRAIN_TO_BODY = {\n'
        f'  scale: {b["scale"]:.9g},\n'
        f'  rotation: {fmt(b["rotation"])},          // XYZ Euler radians\n'
        f'  translation: {fmt(b["translation"])},\n'
        '  provisional: false,\n'
        f'  landmarks: {json.dumps(b["landmarks"])},\n'
        f'  residualMm: {{ mean: {b["residual_mm"]["mean"]:.3g}, '
        f'max: {b["residual_mm"]["max"]:.3g} }},\n'
        '};')
    src = re.sub(r'export const BODY_FRAME = \{.*?\n\};', body_block, src, flags=re.S)
    src = re.sub(r'export const BRAIN_TO_BODY = \{.*?\n\};', b2b_block, src, flags=re.S)
    open(path, 'w').write(src)
    print('patched src/frame.js')


if __name__ == '__main__':
    main()
