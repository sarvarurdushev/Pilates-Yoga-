import * as THREE from 'three';

/**
 * Per-region colour and activation, held in a texture instead of a uniform array.
 *
 * neurolab looked colours up in `uColors[16]`, which is why CLAUDE.md records that a
 * sixteenth named region means widening the array. A whole body has hundreds to thousands
 * of named structures, so the array has to go. An N x 1 texture indexed by region id
 * costs the same to sample at N = 16 and at N = 4096.
 *
 * Two things about the storage are deliberate and load-bearing:
 *
 * - **FloatType, not UnsignedByteType.** A uniform `vec3` carries float32. Quantising the
 *   palette to 8 bits per channel shifts every colour by up to 1/255 before tone mapping,
 *   which means the same scene renders differently than it did through the uniform array.
 *   Float texels make the swap exactly lossless, which is what lets test/render prove it.
 * - **NoColorSpace.** `THREE.Color` already holds linear-sRGB once ColorManagement has
 *   converted the hex string, and that is what the uniform path uploaded. texelFetch does
 *   no colour conversion of its own, so the texels must already be linear.
 *
 * Activation rides in the alpha channel rather than a second texture: it is the same
 * upload either way, and one texture means one uniform to keep pointed at the right object
 * when the palette grows.
 */

export const UNMAPPED = '#6e6a68';

export class RegionPalette {
  /** @param {number} capacity initial id capacity; grows by doubling as ids arrive */
  constructor(capacity = 64) {
    this._default = new THREE.Color(UNMAPPED);
    this._alloc(Math.max(1, capacity));
    this._dirty = true;
  }

  _alloc(size) {
    /* A second texture, sampled in the *vertex* shader, holding where each
     * structure moves to when the body is taken apart. It lives here rather
     * than in its own class because it is the same per-region indexing, the
     * same growth rule and the same upload, and two objects that must always
     * be the same size are one object.
     *
     * RGB is a displacement in body coordinates. **A is whether the structure is
     * drawn at all** — 1 by default, 0 to skip it — which is the one thing a
     * merged layer cannot do per mesh any more, because it no longer has one
     * mesh per structure to hide. It rides here rather than in a texture of its
     * own for the same reason activation rides in the colour texture's alpha: it
     * is the same indexing, the same growth rule and the same upload.
     *
     * Float, like the colours, because a quantised displacement makes structures
     * jitter as the slider moves. */
    const offsets = new Float32Array(size * 4);
    // shown by default: a structure with no flag written must draw, or a body
    // whose ids outran the texture would silently lose its far half
    for (let i = 0; i < size; i++) offsets[i*4+3] = 1;
    if (this.offsets) offsets.set(this.offsets.subarray(0, Math.min(this.offsets.length, offsets.length)));
    this.offsets = offsets;
    const oldOffset = this.offsetTexture;
    this.offsetTexture = new THREE.DataTexture(offsets, size, 1, THREE.RGBAFormat,
                                               THREE.FloatType);
    this.offsetTexture.magFilter = THREE.NearestFilter;
    this.offsetTexture.minFilter = THREE.NearestFilter;
    this.offsetTexture.generateMipmaps = false;
    this.offsetTexture.colorSpace = THREE.NoColorSpace;
    this.offsetTexture.needsUpdate = true;
    if (oldOffset) oldOffset.dispose();

    const data = new Float32Array(size * 4);
    // every texel starts unmapped, so an id with no content entry is grey rather than black
    const { r, g, b } = this._default;
    for (let i = 0; i < size; i++) { data[i*4] = r; data[i*4+1] = g; data[i*4+2] = b; }
    if (this.data) data.set(this.data.subarray(0, Math.min(this.data.length, data.length)));
    this.data = data;
    this.size = size;
    const old = this.texture;
    this.texture = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    // materials hold the texture object, so a resize has to be observable
    this.version = (this.version ?? -1) + 1;
    if (old) old.dispose();
  }

  /** Make room for `id`, doubling rather than fitting exactly so growth is amortised. */
  _fit(id) {
    if (id < this.size) return;
    let size = this.size;
    while (size <= id) size *= 2;
    this._alloc(size);
  }

  /** @param {number} id @param {THREE.Color|string|number} color */
  setColor(id, color) {
    this._fit(id);
    const c = color?.isColor ? color : new THREE.Color(color);
    this.data[id*4] = c.r; this.data[id*4+1] = c.g; this.data[id*4+2] = c.b;
    this._dirty = true;
    return this;
  }

  getColor(id, target = new THREE.Color()) {
    if (id >= this.size || id < 0) return target.copy(this._default);
    return target.setRGB(this.data[id*4], this.data[id*4+1], this.data[id*4+2],
                         THREE.LinearSRGBColorSpace);
  }

  /** @param {number} id @param {number} v 0..1 */
  setActivation(id, v) {
    this._fit(id);
    this.data[id*4+3] = v;
    this._dirty = true;
    return this;
  }

  getActivation(id) {
    return (id >= 0 && id < this.size) ? this.data[id*4+3] : 0;
  }

  clearActivation() {
    for (let i = 0; i < this.size; i++) this.data[i*4+3] = 0;
    this._dirty = true;
    return this;
  }

  /** Bulk-set colours from `{ id: '#hex' }` or `{ id: { color: '#hex' } }`. */
  setColors(map) {
    for (const [id, v] of Object.entries(map)) {
      const c = (v && typeof v === 'object' && 'color' in v) ? v.color : v;
      if (c != null) this.setColor(+id, c);
    }
    return this;
  }

  /** Where this structure sits when the body is fully taken apart. */
  setOffset(id, x, y, z) {
    this._fit(id);
    this.offsets[id*4] = x; this.offsets[id*4+1] = y; this.offsets[id*4+2] = z;
    this._offsetDirty = true;
    return this;
  }

  getOffset(id, target = new THREE.Vector3()) {
    if (id >= this.size || id < 0) return target.set(0, 0, 0);
    return target.set(this.offsets[id*4], this.offsets[id*4+1], this.offsets[id*4+2]);
  }

  clearOffsets() {
    // xyz only: the alpha is visibility, not displacement, and clearing it would
    // put the body back together by making all of it disappear
    for (let i = 0; i < this.size; i++) {
      this.offsets[i*4] = 0; this.offsets[i*4+1] = 0; this.offsets[i*4+2] = 0;
    }
    this._offsetDirty = true;
    return this;
  }

  /**
   * Whether a merged layer draws this structure.
   *
   * Per-structure visibility used to be `mesh.visible`, which a merged layer no
   * longer has one of. The vertex shader reads this and sends a hidden
   * structure's vertices outside the clip volume, so its triangles are thrown
   * away before rasterisation — the same cost a hidden mesh had, without the
   * draw call.
   *
   * @param {number} id @param {boolean} on
   */
  setShown(id, on) {
    this._fit(id);
    const v = on ? 1 : 0;
    if (this.offsets[id*4+3] !== v) { this.offsets[id*4+3] = v; this._offsetDirty = true; }
    return this;
  }

  isShown(id) {
    return (id >= 0 && id < this.size) ? this.offsets[id*4+3] > 0.5 : true;
  }

  /** Put every structure back on screen, before a pass writes the ones it wants off. */
  showAll() {
    for (let i = 0; i < this.size; i++) this.offsets[i*4+3] = 1;
    this._offsetDirty = true;
    return this;
  }

  /** Push pending writes to the GPU. Cheap and idempotent; call once per frame at most. */
  upload() {
    if (this._dirty) { this.texture.needsUpdate = true; this._dirty = false; }
    if (this._offsetDirty) { this.offsetTexture.needsUpdate = true; this._offsetDirty = false; }
    return this.texture;
  }

  dispose() { this.texture.dispose(); this.offsetTexture.dispose(); }
}
