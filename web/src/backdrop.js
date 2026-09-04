import * as THREE from 'three';

/**
 * The room, in the scene.
 *
 * It used to be CSS behind a transparent canvas, which was the right answer while the frame
 * went straight to the screen: a colour set on `scene.background` goes through ACES and the
 * deep end of any gradient comes back a flat charcoal.
 *
 * A composed pipeline ends that option. `UnrealBloomPass` is the only pass that can be last —
 * anything after it reads an empty buffer — and when it is last it blits the composed frame
 * through an **opaque** `MeshBasicMaterial`, so the canvas comes out alpha 1 and whatever was
 * behind it is gone. The room therefore has to be something the renderer draws.
 *
 * It is a screen-space quad rather than a sky sphere. A sphere is geometry in the world: it
 * has to be big enough never to clip, it takes fog, it takes tone mapping across a surface
 * that is at a different distance in every direction, and it rotates with the camera in ways
 * that are hard to keep still. A quad drawn first with the depth test off is exactly the
 * background and nothing else, and it costs one full-screen pass of very cheap arithmetic.
 *
 * Tone mapping is still the constraint the CSS version was avoiding, so the gradient is built
 * to survive it: the deep end sits low enough that ACES has nothing to lift, and the contrast
 * that matters is carried by the cool wash near the subject rather than by the falloff.
 */

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  // already in clip space: this quad is the screen, not an object in the world
  gl_Position = vec4(position.xy * 2.0, 0.999, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec3 uTop, uBottom, uWash;
uniform vec2 uWashAt;
uniform float uGrid, uVignette, uAspect;

void main() {
  vec2 p = vUv;

  // the vertical falloff: a lit ceiling and a floor that goes to almost nothing
  vec3 col = mix(uBottom, uTop, pow(p.y, 1.35));

  /* A cool wash where the subject is. This is the part that has to read after ACES, so it is
   * placed and shaped rather than left to the gradient — it is what puts air between the
   * specimen and the back of the room. */
  vec2 d = (p - uWashAt) * vec2(uAspect, 1.0);
  col += uWash * exp(-dot(d, d) * 3.1);

  /* The measurement grid. Kept below the threshold where it would read as a pattern: it says
   * the room has a floor and a far wall, and if you can see it as graph paper it is too
   * strong. Faded out toward the edges so it never competes with the vignette. */
  vec2 g = abs(fract(vec2(p.x * uAspect, p.y) * 13.0) - 0.5);
  float line = smoothstep(0.49, 0.5, max(g.x, g.y));
  float grid = line * uGrid * exp(-dot(p - 0.5, p - 0.5) * 5.0);
  col += vec3(0.42, 0.58, 0.78) * grid;

  // vignette, so the frame has walls rather than edges
  float r = length((p - 0.5) * vec2(uAspect, 1.0));
  col *= 1.0 - smoothstep(0.35, 1.05, r) * uVignette;

  gl_FragColor = vec4(col, 1.0);
}`;

export function makeBackdrop() {
  const uniforms = {
    uTop:      { value: new THREE.Color(0x0B1524) },
    uBottom:   { value: new THREE.Color(0x010306) },
    uWash:     { value: new THREE.Color(0x16283F) },
    uWashAt:   { value: new THREE.Vector2(0.46, 0.56) },
    uGrid:     { value: 0.05 },
    uVignette: { value: 0.72 },
    uAspect:   { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    // it is the room: nothing may be lit by it, fogged into it, or sorted against it
    fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  // before everything, and it never occludes because it writes no depth
  mesh.renderOrder = -1000;
  mesh.name = 'backdrop';
  mesh.userData.backdrop = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}
