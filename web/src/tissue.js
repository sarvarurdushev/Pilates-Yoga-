import * as THREE from 'three';
import { REGION_INFO } from './regionData.js';
import { RegionPalette } from './regionPalette.js';

/**
 * The cortex as living tissue rather than as a surface.
 *
 * Everything else in this app draws anatomy the way a museum draws it: an opaque surface,
 * lit from outside, described by its specular. That is right for a femur and wrong for a
 * brain — a brain seen in an imaging system is a *volume*, and what you are looking at is
 * light that went into it and came back out. So this material is not a lit surface at all.
 * It is an emission integral: additive, depth-write off, both faces drawn, so a ray through
 * the head accumulates every wall of tissue it crosses and the far side of the cortex shows
 * through the near side. Overlapping folds get brighter on their own, which is why the
 * sulci read as depth without a single shadow being computed.
 *
 * Three consequences worth knowing before changing anything here:
 *
 * - **`AdditiveBlending` ignores alpha.** The blend is `src·ONE + dst·ONE`, so opacity has
 *   to be folded into rgb. Setting `opacity` on this material does nothing; `uOpacity` is
 *   the knob.
 * - **It cannot be lit.** There is no `#include <lights_fragment>` and there must not be:
 *   the whole point is that the light comes from inside the object, so a key light on the
 *   outside would flatten it back into the plastic prop this replaces.
 * - **Draw order stops mattering, and that is why this is stable.** With depth-write off and
 *   an order-independent blend, the two hundred triangles a ray crosses can arrive in any
 *   sequence and sum to the same value. That is what a sorted transparent pass cannot give.
 *
 * The region-id machinery is carried over unchanged from `brainMaterial.js` — the flat
 * varying, the `texelFetch` palette, selection and hover — because those are what make the
 * anatomy selectable and none of it depends on how the surface is shaded.
 */

/* 3D simplex noise, Ian McEwan / Ashima Arts, public domain. Kept verbatim rather than
 * rewritten: it is the standard implementation, and a hand-rolled value noise does not give
 * filaments this thin without aliasing — gradient noise is what puts the ridge in the right
 * place at every scale. */
const SIMPLEX = `
vec3 _mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 _mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 _permute(vec4 x){return _mod289(((x*34.0)+1.0)*x);}
vec4 _taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=_mod289(i);
  vec4 p=_permute(_permute(_permute(
      i.z+vec4(0.0,i1.z,i2.z,1.0))
    + i.y+vec4(0.0,i1.y,i2.y,1.0))
    + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=_taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERT = `
attribute float _region;
flat varying float vRegion;
varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vView;

void main() {
  vRegion = _region;
  vObj = position;
  vNrm = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
precision highp float;
${SIMPLEX}

flat varying float vRegion;
varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vView;

uniform float uTime, uOpacity, uGain, uXray, uAtlas, uDim, uSelected, uHover;
uniform vec3  uScanAxis;      // the plane's normal in object space; zero = no scan
uniform float uScanAt;        // where it sits along that axis, in the same units as vObj
uniform float uScanWidth;     // half-thickness of the lit band
uniform vec3  uScanColour;
uniform float uVeinScale, uVeinSharp, uActivity;
uniform vec3  uDeep, uRim, uCore, uHighlight, uCentre;
uniform float uRadius;
uniform highp sampler2D uPalette;
uniform int   uPaletteSize;

vec4 _palette(float region) {
  int i = clamp(int(region + 0.5), 0, uPaletteSize - 1);
  return texelFetch(uPalette, ivec2(i, 0), 0);
}

/* Ridged fractal noise. \`1 - |2n-1|\` turns each octave's zero crossing into a crease, and
 * raising the sum to a power thins the crease into a filament. Three octaves: the coarse one
 * is the major vessel, the fine ones are what make it branch. */
float veins(vec3 p, float sharp) {
  float a = 0.0, amp = 0.5, f = 1.0;
  for (int i = 0; i < 3; i++) {
    float n = snoise(p * f);
    a += amp * (1.0 - abs(n));
    f *= 2.17; amp *= 0.55;
  }
  return pow(clamp(a / 1.05, 0.0, 1.0), sharp);
}

void main() {
  vec3 N = normalize(vNrm);
  vec3 V = normalize(vView);
  float ndv = abs(dot(N, V));
  float fres = 1.0 - ndv;

  /* How deep in the head this fragment is. The lateral surface is far from the centre and
   * the medial wall is near it, so this alone separates the outside of the cortex from the
   * parts you are seeing *through* it — which is what makes the interior read as interior
   * without any depth buffer being consulted. */
  float depth = clamp(length(vObj - uCentre) / uRadius, 0.0, 1.0);
  float inner = pow(1.0 - depth, 2.4);

  // the filament web, drifting slowly so the tissue is never quite static
  float v  = veins(vObj * uVeinScale + vec3(0.0, uTime * 0.012, 0.0), uVeinSharp);
  float v2 = veins(vObj * uVeinScale * 3.1 + 11.3, uVeinSharp * 1.6) * 0.55;
  float web = clamp(v + v2, 0.0, 1.5);

  /* Grazing angles cross more tissue, so they carry more of everything: it is the same
   * integral the additive blend is doing between fragments, done within one. */
  float thickness = 0.26 + fres * fres * 2.1;

  vec3 col = uDeep * thickness * 0.30;
  col += uRim * pow(fres, 2.6) * 0.85;
  col += uCore * inner * 0.55;
  col += uRim * web * (0.22 + fres * 0.6);

  // a slow travelling brightening, so the whole organ has a pulse under the local firing
  float breathe = 0.86 + 0.14 * sin(uTime * 0.7 - depth * 4.0);
  col *= breathe;
  col *= 0.72 + uActivity * 0.75;

  vec4 pal = _palette(vRegion);
  bool isSel = uSelected >= 0.0 && abs(vRegion - uSelected) < 0.5;
  bool isHov = uHover    >= 0.0 && abs(vRegion - uHover)    < 0.5;

  // a mapped region stays tinted while nothing is selected; the moment one is, that tint is
  // dropped so the answer to "which one did I click" is not competing with six others
  float actMix = uSelected >= 0.0 ? 0.0 : pal.a * 0.75;
  col = mix(col, pal.rgb * (0.5 + web * 0.8 + fres), actMix);
  col = mix(col, pal.rgb * (0.6 + web + fres), uAtlas * 0.85);

  if (isSel) {
    col = mix(col, uHighlight * (0.55 + web * 1.5 + pow(fres, 1.6) * 1.4), 0.82);
  } else if (uSelected >= 0.0) {
    col *= 1.0 - uDim * 0.8;
  } else if (isHov) {
    col += uHighlight * (web * 0.5 + pow(fres, 3.0)) * 0.5;
  }

  /* X-ray thins the shell rather than switching a mode. The interior structures are drawn
   * with their own emission, so taking the cortex down lets them through — the "see inside"
   * control is literally a thickness. */
  float shell = mix(1.0, 0.34, uXray);

  /* The scan plane.
   *
   * A section through a volume is not a decal laid on the surface — it is the set of points
   * where the surface crosses the plane, which on a folded cortex is a long ragged contour
   * through every gyrus the plane passes. Measuring the fragment's own distance to the plane
   * gives exactly that for free: the band lights wherever tissue is *at* the plane, so the
   * shape you see is the anatomy's own cross-section and it changes correctly as the plane
   * moves. Nothing is projected and no geometry is cut.
   *
   * The trailing edge is dimmer than the leading one, so a sweep has a direction. */
  if (dot(uScanAxis, uScanAxis) > 0.0) {
    float d = dot(vObj - uCentre, normalize(uScanAxis)) - uScanAt;
    float band = exp(-(d * d) / max(1e-6, uScanWidth * uScanWidth));
    float wake = exp(-(d * d) / max(1e-6, uScanWidth * uScanWidth * 26.0)) * step(0.0, -d);
    col += uScanColour * (band * 2.6 + wake * 0.30) * (0.55 + web);
  }

  /* uGain is the one number that keeps this in range, and it is small because the blend is
   * an integral: a ray through a gyrified cortex crosses ten to twenty walls, so a per-wall
   * value that looks correct on its own sums to a white hole through the middle of the head.
   * It was tuned by rendering the organ alone and looking — the first pass at a "reasonable"
   * per-fragment brightness blew the centre out completely. */
  gl_FragColor = vec4(col * uOpacity * uGain * shell, 1.0);
}`;

/** Warm tissue against a cool room — the one colour decision the whole look rests on. */
export const TISSUE_COLOURS = {
  deep: 0xD08A5E,   // the body of the tissue, seen edge-on
  rim:  0xFFD8AE,   // the lit edge and the filaments
  core: 0xFFD98F,   // the glow out of the deep structures
};

export function makeTissueMaterial(palette = null) {
  const pal = palette ?? new RegionPalette(64).setColors(REGION_INFO);
  pal.upload();

  const uniforms = {
    uTime:        { value: 0 },
    uOpacity:     { value: 1 },      // the layer's own opacity, 0..1
    uGain:        { value: 0.16 },   // see uGain in the shader — do not raise casually
    uXray:        { value: 0 },
    uAtlas:       { value: 0 },
    uDim:         { value: 0.84 },
    uSelected:    { value: -1 },
    uHover:       { value: -1 },
    uActivity:    { value: 0.35 },
    uVeinScale:   { value: 46.0 },
    uVeinSharp:   { value: 7.5 },
    uDeep:        { value: new THREE.Color(TISSUE_COLOURS.deep) },
    uRim:         { value: new THREE.Color(TISSUE_COLOURS.rim) },
    uCore:        { value: new THREE.Color(TISSUE_COLOURS.core) },
    uHighlight:   { value: new THREE.Color(0x7FD4E8) },
    uScanAxis:    { value: new THREE.Vector3(0, 0, 0) },
    uScanAt:      { value: 0 },
    uScanWidth:   { value: 0.01 },
    uScanColour:  { value: new THREE.Color(0xBFE9FF) },
    uCentre:      { value: new THREE.Vector3() },
    uRadius:      { value: 1 },
    uPalette:     { value: pal.texture },
    uPaletteSize: { value: pal.size },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  mat.userData.uniforms = uniforms;
  mat.userData.palette = pal;
  mat.userData.tissue = true;
  mat.userData.setActivation = (id, v) => pal.setActivation(id, v);
  mat.userData.clearActivation = () => pal.clearActivation();
  mat.userData.sync = () => {
    pal.upload();
    if (uniforms.uPalette.value !== pal.texture) {
      uniforms.uPalette.value = pal.texture;
      uniforms.uPaletteSize.value = pal.size;
    }
  };
  /** The shader needs the organ's own centre and size to know what "deep" means. */
  mat.userData.fitTo = (centre, radius) => {
    uniforms.uCentre.value.copy(centre);
    uniforms.uRadius.value = Math.max(1e-4, radius);
    // the filament scale is in object units, so it has to track the model's size or the web
    // is either invisible or a solid wash
    uniforms.uVeinScale.value = 8.5 / Math.max(1e-4, radius);
    // the band is a fraction of the organ, so it stays the same *slice* at any model scale
    uniforms.uScanWidth.value = radius * 0.022;
  };

  /**
   * Where the scan plane is, in the organ's own frame.
   *
   * @param axis one of the three anatomical planes as an object-space normal, or null to stop
   * @param at   -1..1, from one side of the organ to the other
   */
  mat.userData.setScan = (axis, at) => {
    if (!axis) { uniforms.uScanAxis.value.set(0, 0, 0); return; }
    uniforms.uScanAxis.value.copy(axis).normalize();
    uniforms.uScanAt.value = at * uniforms.uRadius.value;
  };
  return mat;
}
