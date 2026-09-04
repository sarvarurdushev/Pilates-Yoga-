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

  /** Push pending writes to the GPU. Cheap and idempotent; call once per frame at most. */
  upload() {
    if (this._dirty) { this.texture.needsUpdate = true; this._dirty = false; }
    return this.texture;
  }

  dispose() { this.texture.dispose(); }
}
