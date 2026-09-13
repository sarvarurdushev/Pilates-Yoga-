"""Shared GLB writing + decimation. Kept in Python so region labels are transferred by
nearest neighbour rather than averaged, which is what mesh simplifiers do to custom
vertex attributes and what silently corrupts region ids."""
import numpy as np, json, struct, os

def vertex_normals(P, F):
    """A unit normal for every vertex, including the ones the faces cannot answer for.

    The plain area-weighted sum leaves a normal of exactly (0,0,0) in two situations, and
    both of them are common here:

      * **A vertex no surviving face refers to.** The accumulator starts at zero and nothing
        adds to it. `weld` above drops collapsed triangles, so this is routine.
      * **A sheet with no thickness.** An intercostal muscle or the wall of the heart comes
        out of decimation with its two sides coincident and wound opposite ways, so the face
        normals meeting at a vertex are exact negatives and cancel. 58% of the internal
        intercostals' vertices came out this way.

    A zero normal is not a small error downstream: the fragment shader normalises it, which
    is a division by zero, so the lighting is NaN and the pixel is drawn black. That is the
    speckle that covered the thorax, the face and the hands at every x-ray setting. Measured
    on the built atlas before this: 6,458 zero normals of 318,357.

    So a broken vertex is asked again, three ways, in order. Sum the faces *outward* -- each
    face normal flipped to agree with the direction from the mesh's middle to the vertex --
    which makes the two sides of a sheet reinforce instead of cancel. Failing that (a flat
    sheet whose own plane contains that direction, so the flip cannot tell the sides apart),
    take one adjacent face's normal, which is a true surface normal even if the choice of
    side is arbitrary. Failing that -- a vertex with no faces at all -- take the outward
    direction itself, which is always defined.

    Well-behaved vertices are untouched: for a closed surface every face at a vertex already
    faces outward, so none of this runs and the answer is the one this always gave.
    """
    P = np.asarray(P, dtype=np.float64)
    N = np.zeros_like(P)
    if len(F):
        t = P[F]
        fn = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        for k in range(3):
            np.add.at(N, F[:, k], fn)

    l = np.linalg.norm(N, axis=1, keepdims=True)
    bad = (l[:, 0] <= 1e-20) | ~np.isfinite(l[:, 0])
    if bad.any():
        # which way is out, from the middle of the mesh; defined for every vertex
        mid = (P.max(0) + P.min(0)) / 2.0 if len(P) else np.zeros(3)
        out = P - mid
        ol = np.linalg.norm(out, axis=1, keepdims=True)
        out = np.divide(out, np.where(ol == 0, 1.0, ol))
        out[ol[:, 0] == 0] = (0.0, 1.0, 0.0)
        rest = bad

        if len(F):
            # sum again, with every face turned to face outward, so two sides reinforce
            M = np.zeros_like(P)
            for k in range(3):
                v = F[:, k]
                s = np.sign(np.einsum('ij,ij->i', fn, out[v]))
                s[s == 0] = 1.0
                np.add.at(M, v, fn * s[:, None])
            ml = np.linalg.norm(M, axis=1, keepdims=True)
            take = bad & (ml[:, 0] > 1e-20)
            N[take] = M[take] / ml[take]
            l[take] = 1.0
            rest = bad & ~take

            # one adjacent face each, for the vertices the outward sum could not separate
            if rest.any():
                fl = np.linalg.norm(fn, axis=1, keepdims=True)
                ok = fl[:, 0] > 1e-20
                A = np.zeros_like(P)
                for k in range(3):
                    A[F[ok][:, k]] = fn[ok] / fl[ok]   # later writes win; any of them will do
                al = np.linalg.norm(A, axis=1, keepdims=True)
                one = rest & (al[:, 0] > 1e-20)
                N[one] = A[one]
                l[one] = 1.0
                rest = rest & ~one

        # and a vertex no face could speak for keeps the outward direction itself
        N[rest] = out[rest]
        l[rest] = 1.0

    l[l <= 1e-20] = 1.0
    return (N / l).astype(np.float32)

def weld(P, F, rel=2e-4):
    """Merge vertices that sit at the same point, and re-index the faces onto them.

    BodyParts3D ships its meshes with split vertices — BP45 has 5937 of them over 3062
    distinct positions — so the surface is closed to look at and, to anything that walks
    edges, a heap of disconnected shells whose seams happen to line up.

    That is what wrecked the decimation. A quadric simplifier will not collapse an edge
    across a component boundary, so every one of those invisible seams was a wall: the
    simplifier stalled well above budget, and what it did collapse pulled the two sides of
    each seam apart. A quarter of every muscle's edges came out of the pipeline as an open
    boundary, which is why posed muscles showed ragged holes and spikes — the geometry was
    already torn before the rig ever touched it.

    The tolerance is relative to the mesh's own diagonal, so it means the same thing on a
    phalanx and on a femur.
    """
    span = P.max(0) - P.min(0)
    diag = float(np.linalg.norm(span))
    if diag <= 0:
        return P, F
    q = np.round(P / (diag * rel)).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    Pw = P[first]
    Fw = inv[F]
    # a collapsed triangle helps nobody downstream
    keep = (Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 2] != Fw[:, 0])
    return Pw, Fw[keep]


def decimate(P, F, target_tris, labels=None, max_passes=6):
    """Quadric decimation. Labels are re-attached from the original mesh by nearest
    neighbour, so every vertex keeps an exact integer region id.

    The mesh is welded first, and that is the whole difference between a closed result and a
    shredded one — see `weld`. With the seams joined the simplifier reaches the budget in a
    single pass and the output has no open boundary at all; without it, a 6300-triangle
    muscle asked down to 450 came back at 779 with 47% of its edges hanging free.

    The iteration is kept because a structure genuinely made of separate shells — the
    intercostals are 22 slabs — still cannot be collapsed below the sum of its parts, and the
    loop stops as soon as a pass buys less than 2%.

    Labels are matched against the *original* vertices every time, never against the previous
    pass's output, so repeated decimation cannot let an id drift across a boundary."""
    import fast_simplification
    from scipy.spatial import cKDTree
    P = np.asarray(P, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    Pw, Fw = weld(P, F)
    if len(Fw) <= target_tris:
        out = labels[cKDTree(P).query(Pw, k=1)[1]] if labels is not None else None
        return Pw.astype(np.float32), Fw.astype(np.uint32), out
    Pv, Fv = Pw.astype(np.float32), Fw.astype(np.int32)
    for _ in range(max_passes):
        if len(Fv) <= target_tris:
            break
        ratio = 1.0 - target_tris / len(Fv)
        before = len(Fv)
        Pv, Fv = fast_simplification.simplify(Pv, Fv.astype(np.int32), ratio)
        if len(Fv) > before * 0.98:
            break
    out = None
    if labels is not None:
        _, idx = cKDTree(P).query(Pv, k=1)
        out = labels[idx]
    return Pv.astype(np.float32), Fv.astype(np.uint32), out


def write_glb(path, parts):
    """parts: [(name, P, F, regionIds|int)]"""
    blob = b''; views=[]; accs=[]; meshes=[]; nodes=[]
    def add(arr, target):
        nonlocal blob
        off = len(blob); b = np.ascontiguousarray(arr).tobytes()
        blob += b + b'\x00'*(-len(b)%4)
        views.append({"buffer":0,"byteOffset":off,"byteLength":len(b),"target":target})
        return len(views)-1
    for i,(nm,P,F,reg) in enumerate(parts):
        P = P.astype(np.float32); F = F.astype(np.uint32)
        N = vertex_normals(P.astype(np.float64), F)
        R = (np.full(len(P), reg) if np.isscalar(reg) else reg).astype(np.float32)
        ap=len(accs); accs.append({"bufferView":add(P,34962),"componentType":5126,"count":len(P),
            "type":"VEC3","min":P.min(0).tolist(),"max":P.max(0).tolist()})
        an=len(accs); accs.append({"bufferView":add(N,34962),"componentType":5126,"count":len(P),"type":"VEC3"})
        ar=len(accs); accs.append({"bufferView":add(R,34962),"componentType":5126,"count":len(P),"type":"SCALAR"})
        ai=len(accs); accs.append({"bufferView":add(F.reshape(-1),34963),"componentType":5125,
            "count":F.size,"type":"SCALAR"})
        meshes.append({"name":nm,"primitives":[{"attributes":{"POSITION":ap,"NORMAL":an,"_REGION":ar},"indices":ai}]})
        nodes.append({"mesh":i,"name":nm})
    g={"asset":{"version":"2.0","generator":"neurolab"},"scene":0,
       "scenes":[{"nodes":list(range(len(nodes)))}],"nodes":nodes,"meshes":meshes,
       "buffers":[{"byteLength":len(blob)}],"bufferViews":views,"accessors":accs}
    js=json.dumps(g,separators=(',',':')).encode(); js += b' '*(-len(js)%4)
    out=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(blob))
    out+=struct.pack('<II',len(js),0x4E4F534A)+js
    out+=struct.pack('<II',len(blob),0x004E4942)+blob
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    open(path,'wb').write(out)
    return len(out)
