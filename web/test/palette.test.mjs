import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RegionPalette, UNMAPPED } from '../src/regionPalette.js';
import { REGION_INFO } from '../src/regionData.js';

/**
 * The palette is what removes the 16-region ceiling, so the things worth pinning down are
 * the texel layout the shader reads, and that growth past the old cap loses nothing.
 */

const texel = (p, id) => [...p.data.subarray(id * 4, id * 4 + 4)];
/**
 * THREE.Color holds float64, the texture holds float32. That narrowing is not a loss
 * relative to the uniform array it replaces — `uniform3fv` narrows to float32 on upload
 * too, which is why the two paths render identically (see test/render). Compare at float32.
 */
const f32 = n => Math.fround(n);

test('every texel starts at the unmapped colour, not black', () => {
  const p = new RegionPalette(8);
  const grey = new THREE.Color(UNMAPPED);
  for (let i = 0; i < p.size; i++) {
    const [r, g, b, a] = texel(p, i);
    assert.deepEqual([r, g, b], [f32(grey.r), f32(grey.g), f32(grey.b)]);
    assert.equal(a, 0, 'activation starts at zero');
  }
});

test('colours are stored linear, which is what the uniform array uploaded', () => {
  const p = new RegionPalette(4);
  p.setColor(2, '#4C8DF6');
  const c = new THREE.Color('#4C8DF6');   // ColorManagement has already made this linear
  const [r, g, b] = texel(p, 2);
  assert.deepEqual([r, g, b], [f32(c.r), f32(c.g), f32(c.b)]);
  // and the raw texel is genuinely not the sRGB byte value
  assert.notEqual(Math.round(r * 255), 0x4C);
});

test('getColor round-trips through float32 exactly', () => {
  const p = new RegionPalette(4);
  for (const hex of ['#E255B4', '#39C2C9', '#ffffff', '#000000']) {
    p.setColor(1, hex);
    const back = p.getColor(1);
    const want = new THREE.Color(hex);
    assert.ok(Math.abs(back.r - want.r) < 1e-7 &&
              Math.abs(back.g - want.g) < 1e-7 &&
              Math.abs(back.b - want.b) < 1e-7, hex);
  }
});

test('activation lives in alpha and does not disturb colour', () => {
  const p = new RegionPalette(4);
  p.setColor(3, '#E9A13B');
  const before = texel(p, 3).slice(0, 3);
  p.setActivation(3, 0.42);
  assert.equal(p.getActivation(3), f32(0.42));
  assert.deepEqual(texel(p, 3).slice(0, 3), before);
  p.clearActivation();
  assert.equal(p.getActivation(3), 0);
  assert.deepEqual(texel(p, 3).slice(0, 3), before, 'clearing activation must not touch colour');
});

test('growth past the old 16-id ceiling preserves everything already written', () => {
  const p = new RegionPalette(16);
  p.setColor(1, '#E255B4').setColor(15, '#39C2C9').setActivation(15, 0.7);
  const beforeTexture = p.texture, beforeVersion = p.version;

  p.setColor(2000, '#ffcc00');

  assert.ok(p.size > 2000, `palette should have grown, size is ${p.size}`);
  assert.ok(p.size === 2048, 'growth doubles rather than fitting exactly');
  assert.notEqual(p.texture, beforeTexture, 'a resize must produce a new texture object');
  assert.equal(p.version, beforeVersion + 1, 'version must change so materials re-point');

  assert.deepEqual(p.getColor(1).getHexString(), new THREE.Color('#E255B4').getHexString());
  assert.deepEqual(p.getColor(15).getHexString(), new THREE.Color('#39C2C9').getHexString());
  assert.equal(p.getActivation(15), f32(0.7));
  assert.deepEqual(p.getColor(2000).getHexString(), new THREE.Color('#ffcc00').getHexString());
});

test('ids beyond the palette read as unmapped rather than throwing', () => {
  const p = new RegionPalette(8);
  assert.equal(p.getColor(9999).getHexString(), new THREE.Color(UNMAPPED).getHexString());
  assert.equal(p.getActivation(9999), 0);
});

test('the texture is nearest-filtered, unconverted float data', () => {
  const p = new RegionPalette(8);
  // NearestFilter because texel i must be region i and nothing in between; FloatType
  // because 8-bit quantisation would shift colours away from what uColors[] uploaded;
  // NoColorSpace because texelFetch does no conversion and Color is already linear.
  assert.equal(p.texture.magFilter, THREE.NearestFilter);
  assert.equal(p.texture.minFilter, THREE.NearestFilter);
  assert.equal(p.texture.type, THREE.FloatType);
  assert.equal(p.texture.format, THREE.RGBAFormat);
  assert.equal(p.texture.colorSpace, THREE.NoColorSpace);
  assert.equal(p.texture.generateMipmaps, false);
  assert.equal(p.texture.image.height, 1);
});

test('setColors accepts the REGION_INFO shape directly', () => {
  const p = new RegionPalette(64).setColors(REGION_INFO);
  for (const [id, info] of Object.entries(REGION_INFO)) {
    if (!info?.color) continue;
    assert.equal(p.getColor(+id).getHexString(), new THREE.Color(info.color).getHexString(),
      `region ${id}`);
  }
});

test('every region id in REGION_INFO fits the palette', () => {
  // the old uColors[16] array silently dropped anything from id 16 up
  const p = new RegionPalette(64).setColors(REGION_INFO);
  const ids = Object.keys(REGION_INFO).map(Number);
  assert.ok(ids.some(id => id >= 16), 'REGION_INFO should still contain interior ids 20+');
  for (const id of ids) assert.ok(id < p.size, `id ${id} outside palette of ${p.size}`);
});

test('upload re-uploads only when something changed', () => {
  // `needsUpdate` on a three Texture is write-only — it bumps `version` — so version is
  // what tells us whether an upload was actually queued.
  const p = new RegionPalette(4);
  p.setColor(1, '#fff');
  p.upload();
  const after = p.texture.version;

  p.upload();
  assert.equal(p.texture.version, after, 'a clean palette must not queue another upload');

  p.setActivation(1, 1);
  p.upload();
  assert.ok(p.texture.version > after, 'a written palette must queue an upload');
});
