import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Tone mapping and colour space, at the end of the composed chain.
 *
 * This exists instead of three's `OutputPass`, which renders black here. `OutputPass` builds
 * its quad from a **`RawShaderMaterial`** whose source carries no `#version` directive, so it
 * compiles as GLSL ES 1.00 while every other program in this scene is 3.00 — the same class of
 * version mismatch already recorded in CLAUDE.md, arrived at from the other direction, and it
 * fails silently: nothing throws, nothing is logged, the frame is simply empty. What found it
 * was bisecting the pass chain and measuring lit pixels, because the symptom of a broken final
 * pass and the symptom of a scene that drew nothing are identical.
 *
 * Doing it here has two advantages beyond working. The maths is the same fit three uses, so
 * the composed path and the direct `renderer.render` path agree — a frame must not change
 * colour when bloom is switched off. And the alpha is passed through deliberately rather than
 * incidentally: the canvas is transparent and the room behind it is CSS, so anything that
 * flattens alpha to 1 hides the room, and anything that drops it to 0 hides the render.
 *
 * `renderer.toneMapping` must be left alone: three disables its own tone mapping whenever it
 * is drawing into a render target, which is what the composer does, so there is no double
 * application and the direct path still works when the composer is off.
 */

const FRAG = `
uniform sampler2D tDiffuse;
uniform float uExposure;
varying vec2 vUv;

// three's ACES fit, verbatim, so the composed and direct paths cannot drift apart
vec3 rrtAndOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 IN = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602);
  color *= uExposure / 0.6;
  color = IN * color;
  color = rrtAndOdtFit(color);
  color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
// the sRGB transfer function, not a 2.2 gamma: the two differ most in the deep end, which is
// most of this image
vec3 srgb(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92,
             vec3(lessThanEqual(c, vec3(0.0031308))));
}

void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = aces(t.rgb);
  /* Whether this pass also encodes sRGB depends on what comes after it, which is why it is a
   * define rather than a constant. With bloom present, bloom is last and blits to the screen
   * through a built-in material — three converts linear→sRGB on that blit, so doing it here
   * as well would convert twice and wash the image out. With bloom absent this pass is last
   * and nothing else will do it. */
  #ifdef ENCODE_SRGB
    c = srgb(c);
  #endif
  gl_FragColor = vec4(c, t.a);
}`;

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export function makeFinalPass(exposure = 1, { encodeSRGB = false } = {}) {
  return new ShaderPass({
    name: 'FinalPass',
    defines: encodeSRGB ? { ENCODE_SRGB: '' } : {},
    uniforms: { tDiffuse: { value: null }, uExposure: { value: exposure } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

/**
 * The same maths as a plain material, for a caller that is not running a composer.
 *
 * Three applies neither tone mapping nor the colour-space encode when it is drawing into a
 * render target — `WebGLPrograms` sets `toneMapping = NoToneMapping` unless the target is
 * null, and the output colour space for a non-XR target is the linear working space. So every
 * offscreen panel render came out as raw linear radiance shown as though it were sRGB, which
 * is a picture with no midtones in it at all: the structure pair measured a mean of 3.4 out of
 * 255 with nothing anywhere above half brightness. Nothing was wrong with the render — the
 * last two steps of the stage's own pipeline were simply missing from it.
 *
 * Built from the same source as the pass above, so a panel and the stage cannot drift apart.
 * `encodeSRGB` is on by default here because an offscreen render is read straight back into a
 * canvas and there is nothing after it to do the encoding.
 */
export function makeFinalMaterial(exposure = 1, { encodeSRGB = true } = {}) {
  return new THREE.ShaderMaterial({
    name: 'FinalMaterial',
    defines: encodeSRGB ? { ENCODE_SRGB: '' } : {},
    uniforms: { tDiffuse: { value: null }, uExposure: { value: exposure } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
