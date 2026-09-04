"""Minimal GLB reader — enough to get positions and _REGION ids back out of what
glb_common.write_glb wrote. Used by the frame derivation, which has to measure the brain
that already shipped rather than rebuild it."""
import json, struct
import numpy as np

_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
       5125: np.uint32, 5126: np.float32}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    """-> (gltf dict, bytes blob)"""
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, _ = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, f'{path} is not a GLB'
    off, js, blob = 12, None, b''
    while off < len(data):
        ln, kind = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + ln]
        if kind == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif kind == 0x004E4942:
            blob = chunk
        off += 8 + ln + (-ln % 4)
    return js, blob


def accessor(g, blob, i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    dt = _CT[a['componentType']]
    n = _NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(blob, dtype=dt, count=a['count'] * n, offset=start)
    return arr.reshape(a['count'], n) if n > 1 else arr


def primitives(path):
    """Yield (name, positions [n,3] float64, region ids [n] int or None) per primitive."""
    g, blob = read_glb(path)
    for mesh in g['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            P = accessor(g, blob, at['POSITION']).astype(np.float64)
            key = next((k for k in ('_REGION', '_region') if k in at), None)
            R = np.rint(accessor(g, blob, at[key])).astype(np.int64).ravel() if key else None
            yield mesh.get('name', ''), P, R


def primitives_faces(path):
    """Yield (name, positions [n,3] float64, faces [m,3] int) per primitive.

    `primitives` returns positions only, which is all the frame derivation ever needed.
    Anything that has to reason about the *surface* — voxelising the body to find its
    envelope, counting boundary edges — needs the triangles too."""
    g, blob = read_glb(path)
    for mesh in g['meshes']:
        for prim in mesh['primitives']:
            P = accessor(g, blob, prim['attributes']['POSITION']).astype(np.float64)
            F = accessor(g, blob, prim['indices']).astype(np.int64).reshape(-1, 3)
            yield mesh.get('name', ''), P, F


def region_centroids(path):
    """region id -> centroid, over every primitive in the file."""
    acc, cnt = {}, {}
    for _, P, R in primitives(path):
        if R is None:
            continue
        for rid in np.unique(R):
            m = R == rid
            acc[int(rid)] = acc.get(int(rid), np.zeros(3)) + P[m].sum(0)
            cnt[int(rid)] = cnt.get(int(rid), 0) + int(m.sum())
    return {k: acc[k] / cnt[k] for k in acc}
