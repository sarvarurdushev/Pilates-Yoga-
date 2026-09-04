import * as THREE from 'three';
import { useDualQuatSkinning } from './dqs.js';
import { REGION_INFO } from './regionData.js';
import { RegionPalette } from './regionPalette.js';

/**
 * Physical material extended with a per-vertex _REGION lookup.
 *
 * This is the piece that makes anatomy selectable: every vertex carries a region id baked
 * in by the build, and the shader decides per fragment whether it belongs to the selected
 * structure. The varying must stay `flat` — interpolating an id across a triangle that
 * spans two regions yields a fraction that indexes a third, unrelated colour. That bug bit
 * once with 15 ids; with a body's worth of structures it would bite constantly.
 *
 * Colours and activation come from a RegionPalette texture rather than the `uColors[16]` /
 * `uActive[16]` uniform arrays neurolab used, so the id space is not capped at 16. The
 * lookup is `texelFetch` with an integer index rather than a normalised `texture2D`
 * coordinate, because `(id + 0.5) / N` is only exactly right while N is small; an integer
 * fetch cannot land on the neighbouring structure's texel no matter how large the palette
 * gets.
 *
 * Do **not** set `glslVersion = GLSL3` to get texelFetch. Three already compiles built-in
 * materials as `#version 300 es`; that flag only suppresses the `gl_FragColor` define three
 * injects for its own chunks, and the whole shader then fails to compile.
 *
 * Physical rather than Standard for clearcoat: cortical tissue is damp, and a faint
 * specular coat over a rough diffuse base is most of what reads as "not plastic".
 */
/**
 * The defaults every structure material starts from. `main.js`'s LOOK table names only
 * colour, roughness, clearcoat and sheen per layer and inherits the rest from here, so this
 * has to stay what bone, muscle, organ and nerve were tuned against — it is not the brain's
 * look and must not be edited to change the brain. That coupling is why BRAIN_LOOK is now a
 * separate table: retuning the cortex used to retune the sheen colour of all six body layers
 * with it.
 */
const BASE_LOOK = {
  color: 0xcfb2a8, roughness: 0.72, metalness: 0.0,
  clearcoat: 0.34, clearcoatRoughness: 0.52,
  sheen: 0.3, sheenColor: 0xffd9cf, sheenRoughness: 0.8,
};

/**
 * The cortex's own surface.
 *
 * Fixed brain tissue is a cool, desaturated grey — it is not the warm putty pink a
 * rendering picks up from an untinted diffuse under a warm key, which is what this was and
 * what read as a rubber prop. Three things carry the change and they work together:
 * a cool low-saturation base so the light is what has colour rather than the object; a
 * strong, tight clearcoat, because a fixed specimen is damp and the wet film on the gyral
 * crowns is most of what separates tissue from plastic; and a cool sheen, so the grazing
 * edge picks up the rim light rather than going grey.
 *
 * The base is deliberately dark. The rim and the specular are what describe the folds, and
 * neither can be seen against a surface already near white — the first pass at this kept the
 * old brightness, went cool, and came out as pale ice: the gyral crowns clipped and the sulci
 * between them had nothing left to fall to. The clearcoat is tighter than it is strong for
 * the same reason. A broad wet wash lifts the whole surface; a small hard highlight sits on
 * the crowns and leaves the folds their depth.
 */
/* A fixed brain specimen is warm pale cream, not cool grey, and that is what the solid look
 * has to be: the reference is an opaque ivory cortex whose folds read through shading alone,
 * with no parcel colour on it at all. The old value was a cool blue-grey chosen back when this
 * material was the *only* brain and had to hold its own against a dark page — the volume look
 * does that job now, so this one is free to be a specimen. Kept well below the final
 * brightness because the clearcoat and sheen lift the crowns: a base that already reads cream
 * clips them and the sulci lose the contrast that makes them legible as depth. */
const BRAIN_LOOK = {
  ...BASE_LOOK,
  color: 0xB48A68, roughness: 0.68,
  /* Low, and rough. A strong clearcoat mirrors the room, and the room here is a cool
   * near-black blue — so the more of it the surface reflected the further from cream it went,
   * and at 0.55 the specimen came out grey-blue and nearly clipped. A fixed brain is matte. */
  clearcoat: 0.28, clearcoatRoughness: 0.40,
  sheen: 0.30, sheenColor: 0xFFE8D2, sheenRoughness: 0.7,
};

export function makeBrainMaterial(palette = null) {
  const mat = makeStructureMaterial(
    palette ?? new RegionPalette(64).setColors(REGION_INFO), BRAIN_LOOK);
  // the subsurface terms in the shader are the brain's alone — see uTissue below
  mat.userData.uniforms.uTissue.value = 1;
  /* Opaque *at rest*, which is not the same as opaque. This look is a specimen: a thing with
   * an inside, that you x-ray or cut away to see into — so its alpha has to stay live.
   *
   * `transparent = false` was the first attempt and it is exactly wrong: it makes the renderer
   * ignore the alpha channel altogether, so the x-ray slider computed a shell alpha that was
   * then thrown away and the control did nothing at all. `uSolid` does the job properly, by
   * pinning the *resting* alpha to 1 while leaving the x-ray path untouched. */
  mat.userData.uniforms.uSolid.value = 1;
  mat.depthWrite = true;
  return mat;
}

/**
 * The same region-id shader over any surface look. Bone is dry and bright, muscle is damp
 * and dark, and both need exactly the same picking, selection, x-ray and atlas behaviour as
 * the cortex — so the shader is shared and only the material constants differ.
 */
export function makeStructureMaterial(palette, look = {}, dqTexture = null) {
  const pal = palette;
  pal.upload();

  const uniforms = {
    uSelected:    { value: -1 },   // region id, -1 = nothing selected
    uHover:       { value: -1 },
    uAtlas:       { value: 0 },    // 0 = natural tissue, 1 = full colour-coded atlas
    uDim:         { value: 0.84 }, // how far unselected regions fade back
    /* One signal colour for "this is the thing you asked about", independent of the
     * structure's own palette entry. A selection used to be shown by mixing toward that
     * palette entry, which on a muscle is another shade of the red already filling the
     * screen — so the answer to "which one did I click" was a slightly different red among
     * four hundred reds. */
    uHighlight:   { value: new THREE.Color(0x59B8FF) },
    uXray:        { value: 0 },    // 0 = solid, 1 = translucent shell
    uShell:       { value: 1 },    // scales the x-ray shell alpha; Inside mode drops it
    uPulse:       { value: 0 },    // animation phase for the active highlight
    /* 1 on the cortex, 0 on every body layer. The subsurface terms below are written for a
     * single closed organ seen whole; applied to four hundred overlapping muscle meshes they
     * would light every seam between them. Gating them on a uniform rather than on a second
     * shader keeps one shader, and keeps the body layers' output bit-for-bit what it was. */
    uTissue:      { value: 0 },
    /* Opaque, for the solid look. `uTissue` cannot do this job as well: it gates the
     * subsurface terms and the scan band, which the solid look wants, and the slight
     * see-through, which it does not. Sharing one uniform for both meant the specimen showed
     * its own deep structures through the cortex — right for the volume, wrong for a plate. */
    uSolid:       { value: 0 },
    uPalette:     { value: pal.texture },     // rgb = region colour, a = activation 0..1
    uPaletteSize: { value: pal.size },
    /* The scan plane, so the anatomical look loses nothing by not being the volume one.
     * All of it is gated on `uTissue`, which is 0 on every body layer, so the four hundred
     * muscle and bone meshes sharing this material compile and shade exactly as before —
     * that is the property `test/render/` exists to prove. */
    uScanAxis:    { value: new THREE.Vector3(0, 0, 0) },
    uScanAt:      { value: 0 },
    uScanWidth:   { value: 0.02 },
    uScanCentre:  { value: new THREE.Vector3() },
    uScanColour:  { value: new THREE.Color(0x9FD4FF) },
  };

  const cfg = { ...BASE_LOOK, ...look };
  const mat = new THREE.MeshPhysicalMaterial({
    ...cfg,
    sheenColor: new THREE.Color(cfg.sheenColor),
    transparent: true, side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float _region;
        flat varying float vRegion;
        varying vec3 vObjPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRegion = _region;
        vObjPos = position;`);

    /* Muscles blend their bones as dual quaternions rather than as matrices, because
     * averaging two rotation matrices is not a rotation and squeezes a muscle flat through
     * its belly. All of it is inside `#ifdef USE_SKINNING`, so bone and organ meshes — which
     * share this material and are not skinned — compile to the shader they always did. */
    if (dqTexture) useDualQuatSkinning(shader, dqTexture);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying float vRegion;
        varying vec3 vObjPos;
        uniform float uSelected, uHover, uAtlas, uDim, uXray, uShell, uPulse, uTissue, uSolid;
        uniform vec3 uHighlight;
        uniform vec3 uScanAxis, uScanCentre, uScanColour;
        uniform float uScanAt, uScanWidth;
        uniform highp sampler2D uPalette;
        uniform int uPaletteSize;
        // clamped: a stray id past the end of the palette must fall back to a real texel
        // rather than read undefined memory
        vec4 _palette(float region) {
          int i = clamp(int(region + 0.5), 0, uPaletteSize - 1);
          return texelFetch(uPalette, ivec2(i, 0), 0);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 _pal = _palette(vRegion);
        vec3 _rc = _pal.rgb;
        float _act = _pal.a;
        diffuseColor.rgb = mix(diffuseColor.rgb, _rc, uAtlas * 0.85);
        bool _isSel = uSelected >= 0.0 && abs(vRegion - uSelected) < 0.5;
        bool _isHov = uHover    >= 0.0 && abs(vRegion - uHover)    < 0.5;
        // A mapped region stays tinted while nothing is selected, so the whole picture
        // reads at once. The moment one region is selected that tint is dropped
        // entirely: seven colours competing with the one you asked about is why nothing
        // could be seen inside the brain.
        float _actMix = uSelected >= 0.0 ? 0.0 : _act * 0.62;
        diffuseColor.rgb = mix(diffuseColor.rgb, _rc, _actMix);
        if (_isSel) {
          diffuseColor.rgb = mix(diffuseColor.rgb, _rc, 0.80);
          diffuseColor.rgb = mix(diffuseColor.rgb, uHighlight, 0.50);
        } else if (uSelected >= 0.0) {
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.27, 0.31), uDim);
        } else if (_isHov) {
          diffuseColor.rgb = mix(diffuseColor.rgb, _rc, 0.45);
          diffuseColor.rgb = mix(diffuseColor.rgb, uHighlight, 0.22);
        }`)
      .replace('#include <opaque_fragment>', `
        float _fres = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        _fres = pow(clamp(_fres, 0.0, 1.0), 1.5);
        vec4 _pal2 = _palette(vRegion);
        vec3 _rc2 = _pal2.rgb;
        bool _sel2 = uSelected >= 0.0 && abs(vRegion - uSelected) < 0.5;
        // rim light: reads as a wet edge on a solid brain and as a glass shell in x-ray
        float _actRim = uSelected >= 0.0 ? 0.0 : _pal2.a * 0.55;
        vec3 _lit = outgoingLight + _rc2 * pow(_fres, 3.0) * _actRim;
        // the selected structure carries a bright rim in the signal colour, which is what
        // makes it findable inside a mass of muscle that is all the same red
        if (_sel2) _lit += uHighlight * (pow(_fres, 2.0) * 0.85 + 0.10);
        _lit += vec3(0.34, 0.40, 0.52) * pow(_fres, 4.0) * 0.30;
        /* Translucent tissue — the cortex only, see uTissue.
         *
         * A surface lit only from outside reads as plastic however well its roughness is
         * tuned, because every photon it shows arrived and left at the same point. Tissue
         * carries light a short way in and lets it out somewhere else, and two consequences
         * of that are cheap and are most of the read: a cool bloom where the tissue between
         * the eye and the background is thinnest, and a warmer, scattered wash through the
         * facing centre where it is thickest.
         *
         * The bloom is on a high power on purpose. Fresnel cannot tell a silhouette from the
         * wall of a sulcus — on a gyrified surface both face away from the eye — so a broad
         * rim term lights every fold and the brain turns into the glowing HUD prop this is
         * meant to stop being. At this exponent it is confined to the true edge and the folds
         * stay dark, which is what makes them read as depth. */
        _lit += vec3(0.42, 0.58, 0.80) * pow(_fres, 5.0) * 1.10 * uTissue;
        _lit = mix(_lit, _lit * vec3(1.14, 0.99, 0.95), (1.0 - _fres) * 0.55 * uTissue);
        /* Where the plane crosses this surface. The same distance the tissue shader lights,
         * so the band lands in the same place in both looks — on a solid brain it reads as
         * the cut line rather than as a slab, which is what an opaque surface can honestly
         * show of a plane passing through it. */
        if (uTissue > 0.5 && dot(uScanAxis, uScanAxis) > 0.0) {
          float _sd = dot(vObjPos - uScanCentre, normalize(uScanAxis)) - uScanAt;
          float _band = exp(-(_sd * _sd) / max(1e-6, uScanWidth * uScanWidth));
          _lit += uScanColour * _band * 1.35;
        }
        float _shellA = clamp(_fres * 1.45 + 0.09, 0.0, 1.0) * uShell;
        /* At rest the cortex is very slightly see-through, and the profile is the opposite
         * way round from the x-ray shell: the facing centre lets a little light past and the
         * silhouette stays solid. That is the right way round physically — a convex body is
         * thickest through the middle, but it is also the only part with a lit background
         * directly behind it — and it is the way round that matters here, because a soft
         * edge on a specimen reads as a rendering fault while a soft centre reads as tissue.
         * It is deliberately shallow: past about a fifth the cerebellum shows through the
         * temporal lobe and the brain stops having an inside. */
        float _restA = mix(mix(1.0, 0.80 + _fres * 0.20, uTissue), 1.0, uSolid);
        float _alpha = mix(_restA, _shellA, uXray);
        if (_sel2) _alpha = mix(_alpha, min(1.0, _alpha + 0.55), uXray);
        gl_FragColor = vec4(_lit, diffuseColor.a * _alpha);`);

    mat.userData.shader = shader;
  };

  mat.userData.uniforms = uniforms;
  mat.userData.palette = pal;
  /** The organ's own centre and size — the scan band is a fraction of it, as in `tissue.js`. */
  mat.userData.fitTo = (centre, radius) => {
    uniforms.uScanCentre.value.copy(centre);
    uniforms.uScanWidth.value = Math.max(1e-4, radius) * 0.014;
    uniforms.uRadiusForScan = Math.max(1e-4, radius);
  };
  /**
   * @param axis an anatomical plane as an object-space normal, or null to stop
   * @param at   -1..1, from one side of the organ to the other — the same units `tissue.js`
   *             takes, so the two looks put the plane in the same place
   */
  mat.userData.setScan = (axis, at) => {
    if (!axis) { uniforms.uScanAxis.value.set(0, 0, 0); return; }
    uniforms.uScanAxis.value.copy(axis).normalize();
    uniforms.uScanAt.value = at * (uniforms.uRadiusForScan ?? 1);
  };
  mat.userData.setActivation = (id, v) => { pal.setActivation(id, v); };
  mat.userData.clearActivation = () => { pal.clearActivation(); };
  /** Upload pending palette writes, and re-point the uniform if the palette grew. */
  mat.userData.sync = () => {
    pal.upload();
    if (uniforms.uPalette.value !== pal.texture) {
      uniforms.uPalette.value = pal.texture;
      uniforms.uPaletteSize.value = pal.size;
    }
  };
  return mat;
}
