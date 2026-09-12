import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeStructureMaterial, makeBrainMaterial } from './brainMaterial.js';
import { mergeLayer, mergeByParent, PICK_LAYER } from './merged.js';
import { accelerate as accelerateRays, setRestTest, warm as warmRays,
         poseChanged as bvhPoseChanged } from './raybvh.js';
import { makeTissueMaterial } from './tissue.js';
import { NeuralNet } from './neuralNet.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { makeFinalPass, makeFinalMaterial } from './finalPass.js';
import { makeBackdrop } from './backdrop.js';
import { RegionPalette } from './regionPalette.js';
import { loadDeepStructures, INTERIOR_IDS, tintStructure } from './deepStructures.js';
import { REGION_INFO } from './regionData.js';
import { brainPlacement, BRAIN_TO_BODY, FRAME } from './frame.js';
import { buildRegistry, registry, get, nameOf, LAYER_ORDER, vertebra,
         drawnIds, isAggregate } from './structures.js';
import { buildGroups, groups, groupOf, groupsOf } from './content/groups.js';
import { PointerTap, slopFor } from './pointerTap.js';
import { ATLAS_FIT, FITTED_LAYERS } from './generated/atlas_fit.js';
import { activeBody, layerUrl, assetUrl } from './bodies.js';
import { EXERCISE, ROLE_LEVEL } from './content/exercises.js';
import { MOVEMENT_PATHWAY } from './content/pathways.js';
import { brainOf, analyse } from './content/analysis.js';
import { UI as UI_STR } from './content/strings.js';
import { MOTION, sample, phaseAt } from './content/motion.js';
import { Rig } from './rig.js';
import { MusclePaths } from './musclePaths.js';
import { buildSkeleton, skinMesh, dominantBone, neighbourhood, spanOf, meshNeighbourhood,
         MUSCLE_SHARE, NERVE_SMOOTH, NERVE_HALF_CAP, withOccupied, chainCoverage, CHAIN_COVER,
         buildBoneField, trimToBones, chainFromBones, meshName,
         indexAttachments, attachmentsOf, meshCentroid, nearestSegment } from './skin.js';
import { BoneDualQuats, useDualQuatRaycast } from './dqs.js';
import { mountUI } from './ui.js';
import { Hud } from './hud.js';
import { CellNote } from './cellNote.js';
import { SectionStrip, SLICE_COUNT } from './sections.js';
import { BrainPlate } from './brainPlate.js';

/* ------------------------------------------------------------------ app state */
export const app = {
  lang: 'en', selected: null, autoSelected: false, hover: null,
  atlas: 0, xray: 0, cutaway: false, labelsOn: true, rotate: true,
  register: 'both',          // 'plain' | 'clinical' | 'both'
  skinning: true,            // muscles deform with the rig rather than riding one bone
  instructionOn: true,       // §13.5 — anatomy-and-evidence-only mode turns this off
  exercise: null,
  /* The anatomical group on screen, by FMA concept id, or null. A group and an
   * exercise are two answers to the same question — "which muscles are we
   * talking about" — and they share the palette's activation channel, so
   * choosing either clears the other. See `setGroup`. */
  group: null,
  /* Structure ids drawn alone, or null for the whole body. Isolation is the one
   * visibility control that overrules every other: layers, x-ray and the shell
   * all answer "what should be in front of this", and isolation answers "there
   * is nothing else". It is also the cheapest picture this application can
   * draw -- one muscle is one draw call instead of seven hundred and sixty-nine
   * -- which is why the reader reaching for it on a slow machine is rewarded
   * rather than punished. */
  isolate: null,
  /** How far apart the body is pulled, 0 to 1. See `setExplode`. */
  explode: 0, explodeReady: false,
  /* Laid out as a catalogue by default, which is what the control is reached for:
   * "show me everything in here". `open` is the other layout -- see EXPLODE_LAYOUTS. */
  explodeLayout: 'inventory',
  /* 'taught' is the rigged 449-structure body every exercise is keyed to;
   * 'complete' is BodyParts3D 4.0's own 2,186 pieces. See `setAtlasDepth`. */
  atlasDepth: 'taught',
  // §9: the clip, where the scrubber is, and whether it is running
  t: 0, playing: false, hasMotion: false, showPaths: false, showMeshes: true,
  pathway: null,
  layers: {},                // name -> { on, opacity }
  centroids: {}, radii: {}, anchors: {},
  /* The furthest a structure reaches from its own centroid, where `radii` is the
   * average. The catalogue sizes its cells on this -- see `inventoryOffsets`. */
  extent: {},
  /* The laboratory look. `bloom` routes the frame through the composer; `neural` draws the
   * network inside the cortex; `activity` is how awake it is. All three are on by default —
   * this is what the app is, not an effect it can wear. */
  bloom: true, neural: true, activity: 0.35,
  /* The scan. `plane` is one of the three anatomical planes or null; `at` is where it sits,
   * -1..1 across the organ; `sweeping` runs it back and forth on its own. */
  scan: { plane: null, at: 0, sweeping: false },
  /* Which way the cortex is drawn: 'tissue' is the volume, 'anatomical' the lit surface with
   * flat parcel colours. See `setBrainLook`. */
  brainLook: 'tissue',
  /* Draw the chosen structure through whatever is in front of it. On by default:
   * the question a click asks about a deep structure is "where is that", and the
   * answer has to be visible without switching six layers off. */
  reveal: true,
  /** Whether the lab screen is covering the stage — see `lab.js`. */
  labOpen: false,
};

/* Which systems get named on the picture. Empty means all of them, which is the state the
 * app opens in; a reader who wants only the nerves named should not have to turn off four
 * layers to get there. */
app.labelKinds = new Set();
for (const l of LAYER_ORDER) {
  /* The app opens flayed — superficial muscles and bone — because that is what it is for.
   * There is no skin layer: BodyParts3D ships a closed body surface, but this app exists to
   * show what is under one, and an opaque outer surface is the single thing that cannot
   * honour either of the two requests readers actually make — x-ray, and selecting a
   * structure. `shell` gives the silhouette that the skin was otherwise providing. */
  app.layers[l] = { on: l === 'muscles_superficial' || l === 'skeleton', opacity: 1 };
}

/* ------------------------------------------------------------------ renderer */
const canvas = document.getElementById('view');
const stage  = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true,
  alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
/* The section strip borrows this renderer: the sections are drawn from the same geometry
 * buffers the scene is drawing, so they have to come out of the context that owns them. */
const sectionStrip = new SectionStrip(renderer);
const brainPlate = new BrainPlate(renderer);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
/* Down from 1.06. The old exposure lit every structure to a confident mid-tone, which is what
 * a product shot wants and an instrument does not: a specimen should fall off into the dark
 * and be *found* by the light rather than presented under it. The rim light below is what
 * carries the silhouette now, so the fill can come down without losing the shape. */
renderer.toneMappingExposure = 0.92;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
/* No background colour, and that is the point.
 *
 * A flat `scene.background` is what made the render read as a cut-out pasted on a page: the
 * subject had a silhouette and the space behind it had no depth at all. The canvas is
 * transparent instead and the room is built in CSS behind it — a vertical falloff, a faint
 * measurement grid, and a vignette, all in `#stage`. Compositing the environment there rather
 * than in the scene keeps it out of the tone mapper, so the deep end of the gradient stays
 * genuinely dark instead of being lifted to a flat charcoal by ACES.
 *
 * `fog` is in the scene, because that one has to be: it is a property of the space *between*
 * the camera and the far side of the body, and it is what stops a limb on the far side
 * reading at the same weight as the one in front of it. */
scene.background = null;
scene.fog = new THREE.Fog(0x04070c, 1.9, 4.6);
/**
 * The fog, as a share of how far away whatever is being looked at is.
 *
 * These were absolute distances, and the absolute distance was measured against a person
 * standing at the default view — 1.9 to 4.6 world units, with the camera 2.53 away. That is
 * correct for a body and only for a body. Take the same body apart into a catalogue of two
 * thousand pieces and the camera has to stand at 4.2 to see the sheet at all, which is 85% of
 * the way from `near` to `far`: every piece in the inventory came out at 85% fog colour, a
 * grid of dark brown smudges on near-black. It was not the lighting and it was not the size
 * of the pieces. It was this.
 *
 * The fix is to say what the fog is actually for. It is depth cueing *within the subject* —
 * it stops the far arm reading at the same weight as the near one — so it belongs to the
 * subject's own scale, not to a fixed distance from the origin. Anchored to the camera's
 * distance to what it is aimed at, the far side of a body is cued exactly as it was, a
 * catalogue read from four metres back is cued the same way, and nothing goes dark for the
 * sole reason that it is being looked at from further away.
 *
 * The ratios are the old constants over that default distance, so the whole-body view this
 * was tuned on is unchanged to the pixel.
 */
const FOG_NEAR = 1.9 / 2.532, FOG_FAR = 4.6 / 2.532;
/**
 * @param cam the camera about to render — not always the stage's. Every panel that borrows
 *   the renderer draws *this* scene through a camera of its own, at its own distance, so a
 *   fog fitted to the stage's camera and left there is fog fitted to the wrong subject: a
 *   close view of one structure through a fog sized for a whole standing body came out black.
 * @param at  what that camera is aimed at
 */
function fitFog(cam = camera, at = controls.target) {
  const d = Math.max(0.05, cam.position.distanceTo(at));
  scene.fog.near = d * FOG_NEAR;
  scene.fog.far = d * FOG_FAR;
}
/* The room. It was CSS behind a transparent canvas, which the composed pipeline ended — see
 * `backdrop.js` for why. `#stage`'s own gradient is still there underneath and is still what
 * shows on the un-composed path; this is what is actually seen. */
const backdrop = makeBackdrop();
scene.add(backdrop);
/* The apparatus around the specimen. Mounted on the stage rather than in the panel, because
 * it belongs to the picture — see `hud.js`. */
const hud = new Hud(stage);
/* The probe on a cell — see `cellNote.js`. */
const cellNote = new CellNote(stage);
const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 100);

/* Body-scale home: one unit is a standing height and the ASIS is the origin, so the male
 * figure spans y = -0.553 to +0.447 and the camera has to sit back far enough to hold it.
 *
 * These are that body's numbers, and they are the *opening* value only — a hand-written home
 * view is a fact about one person wearing the clothes of an app-wide constant. It did not even
 * hold the man it was written for: the view is 0.76 of a body height tall against a figure 1.0
 * tall, so his head and his feet were both off the canvas and it read as a deliberate torso
 * crop. `deriveHome` replaces it with a measurement of whichever body actually loaded. */
let HOME = { p: new THREE.Vector3(0.62, 0.10, 1.16), t: new THREE.Vector3(0, -0.06, 0) };
let REG_READY = false;   // `resetView` can fire before the body's structure table lands
camera.position.copy(HOME.p);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.075;
controls.minDistance = 0.04; controls.maxDistance = 24.0;
controls.autoRotate = true; controls.autoRotateSpeed = 0.34;
controls.target.copy(HOME.t);

/* ------------------------------------------------------------------ moving about
 *
 * Three fixes, all of them reports rather than preferences.
 *
 * **Panning parallel to the screen.** OrbitControls pans along the ground plane by
 * default, so dragging up on a body seen from the side walks the target *away*
 * along the floor instead of lifting it, and the figure appears to swing rather
 * than to move. `screenSpacePanning` makes a drag up mean up.
 *
 * **A right-drag, a middle-drag and two fingers all pan, always.** "When I zoom
 * in and try to go up or down it is rotating all the parts" is what one drag verb
 * for two intentions feels like: at any distance where you can read a structure,
 * orbiting is almost never what was meant. Left-drag still orbits the body,
 * because turning it round is the other thing people came to do — except in the
 * catalogue, where there is nothing to turn round and the layout is a sheet, so
 * left-drag pans there too (see `setExplodeLayout`).
 *
 * **Zoom to the cursor**, so magnifying a wrist keeps the wrist under the pointer
 * rather than sliding it off the edge while the middle of the body grows.
 *
 * The distance limits are widened to match: the catalogue is fifteen body heights
 * across at two thousand pieces, and the old 6.0 ceiling could not get far enough
 * back to see it — which read as the layout not fitting the screen.
 */
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
controls.panSpeed = 1.0;
const ORBIT_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY,
                        RIGHT: THREE.MOUSE.PAN };
const SHEET_BUTTONS = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY,
                        RIGHT: THREE.MOUSE.PAN };
controls.mouseButtons = { ...ORBIT_BUTTONS };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

/** Left-drag turns the body; in a flat catalogue there is nothing to turn, so it pans. */
function setDragVerb(sheet) {
  controls.mouseButtons = { ...(sheet ? SHEET_BUTTONS : ORBIT_BUTTONS) };
  controls.touches = { ONE: sheet ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
                       TWO: THREE.TOUCH.DOLLY_PAN };
  document.body.classList.toggle('sheet', !!sheet);
}

/** Step the camera in or out along its own line of sight, for the zoom buttons. */
export function zoomBy(factor) {
  const v = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(v.length() * factor,
                                    controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(v.setLength(len));
  controls.update();
  invalidate();
}

/** Frame whatever is on screen: the catalogue if it is open, the body if it is not. */
export function fitView() {
  if (app.explode > OPENED && explodeExtent) flyToExtent(explodeExtent);
  else resetView();
}

/* Image-based lighting. Three directional lights alone leave tissue looking like matte
 * plastic; a real environment is what gives muscle its soft gradient and bone its sheen. */
function buildEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(12, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0x0e1422, side: THREE.BackSide })));
  const panel = (hex, gain, pos, size) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(gain) }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  /* One bright key high and to the front-right, a wide cool fill from behind-left, and a
   * small warm bounce low. The warm panel is the only warmth in the environment and it is
   * deliberately weak — it is there so tissue does not go blue-grey and dead, not to tint the
   * image. Cooling the key from pure white to a faint blue is most of what moved this from
   * "3D model on a website" to "specimen under laboratory light". */
  panel(0xeaf2ff, 3.0, [ 5,  5,  4], 8);
  panel(0x8fb6f0, 1.7, [-6,  1, -4], 9);
  panel(0xffc7a8, 0.7, [-1,  4, -6], 6);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = 0.62;
scene.add(new THREE.HemisphereLight(0xcadff8, 0x181d28, 0.34));
const L = (c, i, p) => { const d = new THREE.DirectionalLight(c, i); d.position.set(...p); scene.add(d); return d; };
L(0xf2f7ff, 1.05, [2.6, 2.6, 2.4]);          // key, cooled and brought down
L(0x8fb0ee, 0.34, [-2.6, -0.4, -2.0]);       // cool fill
L(0xffd2b4, 0.26, [-0.6, 1.6, -3.0]);        // warm bounce, barely there
/* The rim. Placed behind the subject and slightly above, so it catches the edge of whatever
 * faces away from the camera and separates it from the background — the single light that
 * does most of the work in a scientific render, and the one this scene never had. It is the
 * reason the fill above could be halved without the body going flat. */
L(0xbcd8ff, 1.5, [-1.4, 1.1, -3.4]);

const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0.5);
const root = new THREE.Group(); scene.add(root);

/* --------------------------------------------------------------- one palette
 * Brain ids are 1-25 and body ids are 100+, so a single palette texture covers everything
 * in the scene. That is the whole reason the uColors[16] array had to go. */
const palette = new RegionPalette(512);
const materials = [];

/* ------------------------------------------------------------------ layers */
const LOOK = {
  /* The source meshes carry no colour — BodyParts3D is segmented geometry, not photography —
   * so every entry here is a choice rather than a measurement. */
  skeleton:            { color: 0xe8e2d4, roughness: 0.55, clearcoat: 0.18, sheen: 0.12 },
  muscles_superficial: { color: 0xb8544a, roughness: 0.68, clearcoat: 0.30, sheen: 0.35 },
  muscles_deep:        { color: 0xa04640, roughness: 0.70, clearcoat: 0.26, sheen: 0.30 },
  organs:             { color: 0xc09068, roughness: 0.62, clearcoat: 0.34, sheen: 0.30 },
  nervous:             { color: 0xF2D98B, roughness: 0.42, clearcoat: 0.45, sheen: 0.20 },
  /* The layers built from the 4.0 element archive -- see scripts/build_detail.py. Wet
   * surfaces, because that is what a vessel and an airway are. */
  arteries:            { color: 0xC0392B, roughness: 0.36, clearcoat: 0.55, sheen: 0.18 },
  veins:               { color: 0x3D6C9E, roughness: 0.38, clearcoat: 0.50, sheen: 0.18 },
  airways:             { color: 0x8FA9B8, roughness: 0.44, clearcoat: 0.40, sheen: 0.22 },
  connective:          { color: 0xCFC3A8, roughness: 0.66, clearcoat: 0.20, sheen: 0.28 },
  nerves_cranial:      { color: 0xE8C86B, roughness: 0.42, clearcoat: 0.45, sheen: 0.20 },
  heart_detail:        { color: 0xB05A52, roughness: 0.50, clearcoat: 0.40, sheen: 0.26 },
  detail:              { color: 0x9E8F7A, roughness: 0.58, clearcoat: 0.28, sheen: 0.24 },
  bones_full:          { color: 0xe8e2d4, roughness: 0.55, clearcoat: 0.18, sheen: 0.12 },
  muscles_full:        { color: 0xb04a41, roughness: 0.68, clearcoat: 0.30, sheen: 0.32 },
  organs_full:         { color: 0xc09068, roughness: 0.62, clearcoat: 0.34, sheen: 0.30 },
};

const layers = {};   // name -> { group, material, loaded, loading }
for (const name of LAYER_ORDER) {
  const group = new THREE.Group();
  group.name = name;
  group.visible = false;
  root.add(group);
  layers[name] = { group, material: null, loaded: false, loading: false };
}

/* Which scanned person is on screen. Every asset path below comes from this rather than
 * being spelled out, because none of them are properties of the app — see `bodies.js`. */
export const body = activeBody();

const regionAttr = geo => geo.getAttribute('_region') || geo.getAttribute('_REGION');

/** Rest-pose height per structure — see `restY[id] =` below, and `updateLabels`. */
const restY = Object.create(null);

/* ------------------------------------------------------------- the rig (§9)
 * A rigid-body skeleton driven by OpenSim's published joint definitions, with every mesh
 * bound to a segment at its bind pose. Bones do not deform, so no skinning is involved —
 * which is both simpler and more anatomically correct than deforming a bone.
 *
 * Muscle *meshes* are bound too, and they are the approximate half of this: a muscle that
 * spans a joint is carried rigidly by one segment and will visibly misbehave at large joint
 * angles. The muscle *paths* are the exact half and the source of truth for anything
 * numeric, which is why they exist alongside. The UI lets you show either or both, and says
 * which is which. */
export let rig = null, musclePaths = null, skeleton = null;
/* Every structure material samples this, so it is one object shared by all of them and
 * filled in once the skeleton exists — see src/dqs.js for why the blend is not three's. */
export let boneDQ = null;
const dqUniform = { value: null };
const bound = new Map();        // mesh -> { segment, bindCentroid }
const restByMesh = new Map();   // mesh -> Map<region id, { c: Vector3, pts: Vector3[] }>
const meshesOfId = new Map();   // region id -> mesh[]  (two, for anything paired)

let capsules = null, boneNames = null, boneIndex = null;

/**
 * Attach a layer to the rig.
 *
 * Bones ride one segment rigidly, which is correct — a bone does not deform. Muscles are
 * skinned, because almost every one of them crosses a joint and a rigid bind tears it open
 * the moment that joint moves. Both end up in the rig hierarchy, so `syncLayers` has to
 * handle visibility per mesh rather than per group.
 */
/**
 * Which segment owns which piece of space, read off the skeleton's own meshes.
 *
 * Every soft-tissue mesh here has to be told which bone it rides, and the only honest source
 * for that is the skeleton: its 245 meshes are bound to segments *by name*, so they are a
 * labelled map of the body at the resolution of real anatomy. Built once, when the skeleton
 * layer arrives, and every layer already loaded is re-bound against it — because a layer
 * bound before the field existed was bound by the rule the field replaces.
 */
let boneField = null;
function buildBoneRegions() {
  const L2 = layers.skeleton;
  if (boneField || !rig?.bind || !L2?.loaded || !boneIndex) return false;
  boneField = buildBoneField(L2.meshes ?? [], rig, boneIndex);
  /* Loudly, because the way this fails is silent. Every bone is looked up by name, and
   * `GLTFLoader` renames nodes on the way in — so when the lookup missed, the field came back
   * empty, every structure fell back to the joint-centre rule, and the only symptom was an
   * abdominal muscle drawn up at the shoulder. `test/smoke.mjs` fails on any console error,
   * so this makes an empty field break the build instead of the picture. */
  const named = (L2.meshes ?? []).filter(m => {
    const [b, sd] = meshName(m.name);
    return !!rig.segmentFor(b, sd || 'M');
  }).length;
  if (!boneField || named < (L2.meshes?.length ?? 0) * 0.9)
    console.error(`bone field: only ${named} of ${L2.meshes?.length ?? 0} skeleton meshes ` +
      `resolved to a segment — every structure will be bound by the rule the field replaces`);
  return !!boneField;
}

function bindLayer(name) {
  if (!rig || !rig.bind) return;
  const L2 = layers[name];
  if (!L2.loaded) return;
  /* The skeleton binds by name and needs no field; everything else waits for one, and is
   * bound by `buildBoneRegions`' re-bind pass the moment the skeleton arrives. Binding a
   * muscle early would home it on whichever joint centre happened to be nearest, which is
   * how an abdominal wall muscle ended up on a forearm. */
  if (name !== 'skeleton' && !boneField && !buildBoneRegions()) return;
  const meshes = [];
  L2.group.traverse(o => { if (o.isMesh && !bound.has(o)) meshes.push(o); });
  /* Nerves are skinned for the same reason muscles are, and more so: a peripheral nerve is
   * the longest thing in the body and crosses every joint on its way down a limb. Bound
   * rigidly to one segment — which is what it got, because `rig.segmentFor` knows nothing
   * about nerve names and the fallback picks the nearest joint centre — the sciatic nerve
   * stayed pointing wherever the pelvis pointed while the knee bent away from it, and shot
   * out of the body as a yellow spike. A nerve's candidate segments come from
   * `meshNeighbourhood` rather than a radius, because a radius cannot cross from the neck to
   * the arm at all. */
  /* The skin is skinned too, and it has to be. The shell can ride its segments rigidly
   * because it is a hidden backdrop and a crack at a bending knee costs nothing; a visible
   * surface that cracks is worse than no surface at all. It is cut per segment with a ring
   * of overlap for exactly this — each piece is an ordinary local mesh with a short chain,
   * so the muscle machinery handles it unchanged. */
  const skinnable = (name.startsWith('muscles') || name === 'nervous')
                    && skeleton && app.skinning;
  for (const o of meshes) {
    const [base, side] = meshName(o.name);
    const c = meshCentroid(o);
    let seg = rig.segmentFor(base, side || 'M');
    if (!seg) seg = nearestSegment(o, rig, boneField ?? capsules);
    if (!seg) continue;
    if (skinnable) {
      // weights come only from the segment this structure is bound to and its neighbours:
      // "the four nearest bones" across a whole body picks the other leg and the lumbar
      // spine as often as it picks the muscle's own joint
      /* Candidates come from where the mesh's own vertices lie, not from a ball around one
       * home segment.
       *
       * `neighbourhood` returns a segment's ancestors and descendants, so the set it gives
       * depends entirely on the home — and for a sheet lying across the whole trunk the home
       * is a coin toss between `pelvis` and `torso`, neither of which reaches the other end.
       * Rectus abdominis and the linea alba came out riding `torso` alone, which in this rig
       * is one rigid body hanging off T1; transversus abdominis and internal oblique came out
       * on `pelvis > L5 > L4`. So the belly stayed with the pelvis while the ribcage moved
       * with the thoracic spine, the abdominal wall pulled away from the ribs, and the chest
       * bones were left showing through the gap. The same coin toss made the two sides
       * disagree: internal oblique was `pelvis > L5 > L4` on the left and `torso` on the
       * right, and the right external oblique — an abdominal muscle — was handed `humerus_r`,
       * because from a home of `torso` the only capsule near the lateral abdomen is the arm
       * hanging beside it.
       *
       * Voting the mesh's vertices against the bone field instead gives rectus abdominis
       * `pelvis > L5 > L4 > L3 > L2 > L1 > T12` on both sides, which is pubis to lower ribs,
       * and transversus abdominis the same run up to T6.
       *
       * Reach 1, not 0: the union has to be wide enough to join the voted segments into one
       * connected chain. Reach 2 measured identically and 0 was worse. The nervous layer keeps
       * the capsules — the field's finer labelling over-broadens a long tube and took worst
       * nerve stretch from 2.8 to 18.5. */
      let allowed = name === 'nervous'
        ? meshNeighbourhood(o, rig, capsules, boneIndex, side ?? null)
        : meshNeighbourhood(o, rig, boneField, boneIndex, side ?? null, MUSCLE_REACH,
                            MUSCLE_SHARE);
      /* — but the capsule set has to contain the bones the nerve is actually lying on, and
       * for anything that is not a tube it does not. The eleven intercostal nerves wrap the
       * ribcage, and every point on the lateral chest is nearer the `torso` capsule up the
       * middle of the body, or the arm hanging beside it, than to the thoracic vertebra it
       * is lying against: the set came out `T1, T2, torso, humerus, ulna, radius` with no
       * vertebra below T2 in it, so nothing downstream could put them on one. `withOccupied`
       * adds what the bone field says the mesh occupies — no reach expansion — plus the run
       * of tree between, which is the thoracic spine. */
      if (name === 'nervous')
        allowed = withOccupied(allowed, o, rig, boneField, boneIndex);
      // and they run along the muscle's own span — from the OpenSim path where the muscle
      // has one, which names its real attachment bodies, and from the mesh's long axis
      // otherwise
      // and it is not trimmed to the joints it wraps: a nerve runs from a root to a limb and
      // the segments between are its route, not something it lies along
      let chain = spanOf(o, rig, capsules, boneIndex, allowed, attachmentsOf(base, side),
                         null, { trim: name !== 'nervous' });
      /* and it is trimmed to the bones it lies on instead. `spanOf` chooses the pair of ends
       * with the *longest* chain between them, which is what keeps a branching structure from
       * collapsing both ends into one place and is also greedy: the right sacral plexus, four
       * centimetres of nerve inside the pelvis, was handed a chain that ran up the whole spine
       * and back down the right arm, and a hundred per cent of its weight went to the forearm.
       * It does not stretch there — it rides one bone rigidly — so nothing measuring
       * distortion could see it. */
      /* Trimmed for every layer now, not just nerves. `spanOf` picks the pair of ends with
       * the *longest* chain between them, which is greedy: in the bind pose the arm hangs
       * beside the trunk and the femur's capsule starts at the hip, so the left external
       * oblique came out running `femur_l` through the whole spine to `humerus_l` while the
       * right one ran the other way — one abdominal muscle, two chains, each anchored to a
       * limb that does not move when the trunk does. Trimming to the bones the mesh actually
       * lies on gives both sides `pelvis > L5 … > torso`.
       *
       * It only became safe once `trimToBones` stopped returning a single segment: trimming a
       * muscle down to one bone welds it there, which is the failure the trim exists to
       * prevent. With the floor in place it *gains* deforming muscles rather than losing them
       * — 197/282 spanning to 207/295. */
      chain = trimToBones(chain, o, boneField, boneIndex,
                          { floor: name === 'nervous' ? 1 : 2 });
      /* And a chain that still came out as one segment is rebuilt from the bones the mesh
       * lies on. Extensor pollicis brevis, abductor pollicis longus and pronator quadratus
       * all resolved both ends onto `humerus` — the upper arm's capsule runs right alongside
       * a forearm muscle — so they stayed with the humerus while the forearm and hand moved
       * and the hand's own bones came out through them. */
      /* — and also when the chain, whole and self-consistent as it is, describes only a
       * fraction of the structure. `spanOf` resolves its ends against capsules and the trim
       * can only cut what those ends produced: the right vagus nerve runs skull to stomach
       * and came out `T11 > T12 > L1`, a third of its own bulk, with the neck and the whole
       * thorax welded to T11. `CHAIN_COVER` is the bar.
       *
       * Nerves only. A muscle's chain is short by construction and its trim already falls
       * back to the untrimmed chain rather than to one bone, so the coverage test buys it
       * nothing and costs a great deal: applied to every layer it took worst muscle edge
       * stretch from 4.10 to 6.40. */
      if ((chain?.length ?? 0) < 2
          || (name === 'nervous'
              && chainCoverage(chain, o, boneField, boneIndex) < CHAIN_COVER))
        chain = chainFromBones(o, rig, boneField, boneIndex, allowed,
                               { byCell: name === 'nervous' }) ?? chain;
      /* A nerve is a tube and the two blend numbers were tuned on sheets — see `NERVE_SMOOTH`
       * in skin.js. Forty-five smoothing passes on a 120-vertex sciatic nerve diffuse the
       * handover along the whole tube, so it arcs through a flexed hip while the flesh folds
       * and comes out through the buttock; the cap stops a femoral nerve 0.59 of a body
       * height long from blending over a quarter of a body. Sciatic 0.072 of a body height outside the flesh
       * to 0.013, femoral 0.055 to 0.015, worst nerve stretch 4.66 to 1.82. */
      const nerve = name === 'nervous';
      const sk = skinMesh(o, skeleton, capsules, { allowed, chain, index: boneIndex, rig, home: seg,
                          ...(nerve ? { passes: NERVE_SMOOTH, hCap: NERVE_HALF_CAP } : {}) });
      if (sk) {
        // what this muscle was decided to cross, so `npm run shots` can say why a mesh moves
        // the way it does instead of leaving it to be inferred from the picture
        sk.userData.span = chain?.join(' > ') ?? null;
        // the raycaster has to deform it the same way the shader does, or the muscle is
        // drawn where you see it and picked where linear blend would have put it
        if (boneDQ) useDualQuatRaycast(sk, boneDQ);
        o.parent?.remove(o);
        rig.root.parent.add(sk);
        const home = dominantBone(sk.geometry, boneNames) ?? seg;
        bound.set(sk, { segment: home, bindCentroid: c, skinned: true });
        // the rest measurements were taken against the original mesh object, and skinning
        // replaces it — they have to follow, or the structure loses its anchors entirely
        const own = restByMesh.get(o);
        if (own) { restByMesh.set(sk, own); restByMesh.delete(o); }
        for (const id of own?.keys() ?? []) {
          const list = meshesOfId.get(id);
          const at = list?.indexOf(o) ?? -1;
          if (at >= 0) list[at] = sk;
        }
        notePicking(sk);
        const i = L2.meshes?.indexOf(o) ?? -1;
        if (i >= 0) L2.meshes[i] = sk;
        continue;
      }
    }
    if (rig.attach(o, seg)) { bound.set(o, { segment: seg, bindCentroid: c }); notePicking(o); }
  }
  remerge(name);
}

/* ---------------------------------------------------- one draw call a layer
 *
 * See `merged.js` for why. In short: a whole body is 788 drawable meshes and
 * most of a frame on integrated graphics is spent submitting them, before a
 * pixel is shaded — which is why turning the quality down did not help.
 *
 * Only the skinned layers so far. Their meshes already sit at the identity under
 * one skeleton with an identity bind matrix, so merging them is a concatenation
 * and nothing else. The bones and the organs are rigid meshes reparented into
 * the rig hierarchy, and each would have to be rewritten as a single-bone skin
 * first; that is the next step, not this one.
 */
const MERGED = new Set(['muscles_superficial', 'muscles_deep', 'nervous',
                        'skeleton', 'organs',
                        /* The layers built from the 4.0 element archive. The arteries
                         * alone are 359 structures over 400-odd meshes, so leaving them
                         * out of the merge would have undone it: turning the vasculature
                         * on took the body from 86 draw calls back past 700. */
                        'arteries', 'veins', 'airways', 'connective',
                        'nerves_cranial', 'heart_detail', 'detail',
                        'bones_full', 'muscles_full', 'organs_full']);
/* The two that are not skinned. `rig.attach` reparents a bone into the rig, so
 * these cannot be one mesh — a mesh has one parent and the skeleton has
 * forty-seven — and they are merged per bone instead. See `mergeByParent` for
 * why that is the right stopping point rather than rewriting them as
 * single-bone skins. */
/* `muscles_full` is not in here, and that is not an oversight.
 *
 * `bindLayer` skins any layer whose name starts with `muscles`, so the complete
 * atlas's muscles arrive as SkinnedMesh like the taught ones do. Listing the layer
 * as rigid sent them to `mergeByParent`, which skips skinned meshes -- so it
 * merged nothing, said nothing, and 378 muscles were drawn one at a time. That was
 * 378 of the 644 draw calls a whole body cost. */
const RIGID = new Set(['skeleton', 'organs', 'arteries', 'veins', 'airways',
                       'connective', 'nerves_cranial', 'heart_detail', 'detail',
                       'bones_full', 'organs_full']);

/**
 * Rebuild a layer's drawables from the meshes it has just bound.
 *
 * Called at the end of `bindLayer`, because binding *replaces* meshes —
 * `skinMesh` returns a new object and `L2.meshes` is patched in place — so a
 * merge taken before it would be a merge of geometry nothing else refers to any
 * more. It is also the only point at which a rigid mesh's local matrix means
 * what it has to mean here: after `rig.attach`, and so relative to its bone.
 *
 * The source meshes are not removed and not hidden. They are moved to a layer
 * the camera does not render, which leaves them in the scene as the model:
 * picking still raycasts them, `bound` still poses them, `restByMesh` still
 * anchors labels to them. Only drawing moves.
 */
function remerge(name) {
  if (!MERGED.has(name)) return;
  const L2 = layers[name];
  if (!L2?.loaded || !L2.material) return;
  for (const m of L2.merged ?? []) { m.parent?.remove(m); m.geometry.dispose(); }
  L2.merged = null;

  const src = L2.meshes ?? [];
  const built = [];
  if (RIGID.has(name)) {
    const merged = mergeByParent(src, { material: L2.material, name });
    /* Only the meshes that ended up inside a merge move off the camera's layer.
     * A bone that is the only one on its segment is still drawn as itself —
     * merging it would buy no draw call and cost a second copy of it. */
    for (const { parent, mesh, sources } of merged) {
      parent.add(mesh);
      built.push(mesh);
      for (const o of sources) o.layers.set(PICK_LAYER);
    }
  } else {
    const m = mergeLayer(src, { material: L2.material, name });
    /* Layer 0 again if the merge refused, so a layer that cannot be merged is
     * drawn the way it always was rather than not at all. */
    for (const o of src) o.layers.set(m ? PICK_LAYER : 0);
    if (m) { L2.group.add(m); built.push(m); }
  }
  if (!built.length) {
    /* Loud, because this is how 378 draw calls hid: a layer that asks to be merged
     * and gets nothing back is a bug in the routing, not a property of the data. */
    if (src.length > 1)
      console.error(`merge: ${name} has ${src.length} meshes and merged none of them — ` +
        `${RIGID.has(name) ? 'listed as rigid' : 'merged as one'} but its meshes are ` +
        `${src[0]?.isSkinnedMesh ? 'skinned' : 'rigid'}`);
    return;
  }
  L2.merged = built;
  applyShown();
  cullWhileApart(app.explode <= 0);
  revealSelection();
  invalidate();
}

/**
 * Carry per-mesh visibility into the palette, where a merged layer can read it.
 *
 * `syncLayers` and `onlyMeshes` decide what is on screen by writing
 * `mesh.visible`, and that is still the one place the decision is made. This
 * only copies the answer somewhere a single draw call can see it: the alpha of
 * the offset texture, one texel per structure, read in the vertex shader.
 *
 * **A structure is shown if any mesh of it is.** A paired structure is one
 * region id over two meshes and the flag cannot separate them, so the left and
 * right of one muscle are on screen together or not at all — which is what every
 * caller already asks for, and what `onlyShow` and the isolate set both do.
 */
function applyShown() {
  const ls = [...MERGED].map(n => layers[n]).filter(L => L?.merged?.length);
  if (!ls.length) return;
  palette.showAll();
  for (const L2 of ls) {
    const on = new Set(), off = new Set();
    for (const o of L2.meshes ?? []) {
      const own = restByMesh.get(o);
      const ids = own ? [...own.keys()]
                      : (o.userData.regionId != null ? [o.userData.regionId] : []);
      for (const id of ids) (o.visible ? on : off).add(id);
    }
    let hiding = 0;
    for (const id of off) if (!on.has(id)) { palette.setShown(id, false); hiding = 1; }
    /* A drawable with nothing left to show is hidden rather than submitted for
     * every one of its triangles to be clipped away. */
    for (const m of L2.merged) {
      let any = false;
      for (const id of m.userData.regions) if (on.has(id)) { any = true; break; }
      m.visible = any;
    }
    /* And nothing hidden is a shader that does not look. The flag costs a
     * texture fetch per vertex to read, which on a body of 605k triangles is
     * more than the draw calls the merge saved -- so it is only read when
     * something is actually hidden, which is almost never. */
    const u = L2.material?.userData?.uniforms;
    if (u?.uHiding) u.uHiding.value = hiding;
    L2.shownIds = on; L2.hiddenIds = new Set([...off].filter(id => !on.has(id)));
  }
  palette.upload();
}

/**
 * What each merged layer is showing, for a test that cannot see pixels.
 *
 * Whether one structure is on screen inside a merged layer cannot be read off
 * the picture: the lone view and the body view are each framed to their own
 * subject, so they fill the same fraction of the same panel and a pixel count
 * cannot tell a muscle from a body — which is the trap `parcelShare` exists to
 * avoid on the brain side, and which one version of this test fell into. So the
 * mechanism reports itself instead.
 */
export const mergedState = () => Object.fromEntries([...MERGED].map(name => {
  const L2 = layers[name];
  return [name, !L2?.merged?.length ? null : {
    draws: L2.merged.length,
    sources: L2.merged.reduce((n, m) => n + m.userData.sources, 0),
    shown: L2.shownIds?.size ?? 0,
    hidden: L2.hiddenIds?.size ?? 0,
    visible: L2.merged.some(m => m.visible),
    hiding: L2.material?.userData?.uniforms?.uHiding?.value ?? 0,
  }];
}));

/**
 * Cache what the raycaster needs for a skinned mesh.
 *
 * A skinned mesh sits at the identity with its vertices deformed on the GPU, so its bounding
 * sphere — which is what `SkinnedMesh.raycast` tests before it looks at a single triangle —
 * describes the rest pose and rejects the ray wherever the pose has moved the muscle to.
 * Recomputing it properly walks every vertex through four bone matrices, far too slow for
 * three hundred meshes on a pointer move, so it is carried forward by the dominant bone and
 * inflated instead. `test/skin.test.mjs` holds a posed muscle under 2.2x its rest size; the
 * margin here is wider than that on purpose.
 */
function notePicking(mesh) {
  if (!mesh.isSkinnedMesh) return;
  mesh.geometry.computeBoundingSphere();
  const s = mesh.geometry.boundingSphere;
  mesh.userData.restSphere = { c: s.center.clone(), r: s.radius };
  mesh.boundingSphere = new THREE.Sphere(s.center.clone(), s.radius * PICK_MARGIN);
}
const PICK_MARGIN = 2.6;

/**
 * Whether the body is standing at the bind pose or has been moved by a clip.
 *
 * The one consumer is the skinned raycast, which can skip a blend that is the
 * identity — see `useDualQuatRaycast`. It is set rather than derived because
 * deriving it means walking forty-seven bones on every pointer move, which is the
 * cost this exists to avoid.
 */
function markPosed(on) {
  if (boneDQ) boneDQ.posed = !!on;
  /* The picking trees describe the bind pose and have to be told the rig moved,
   * or a ray searches boxes belonging to a body that is no longer there. */
  bvhPoseChanged();
}
/* `raybvh` answers from the geometry as it sits in the buffer, which for a skinned
 * mesh is the bind pose. That is what is on screen until a clip moves the rig, and
 * once one has, the tree describes a body that is no longer there — so this is how
 * it knows to hand those meshes back to three's own scan. */
setRestTest(() => !boneDQ || boneDQ.posed === false);
/* How far around each segment the mesh lies on the candidate set reaches, so the voted
 * segments join into one connected chain. Swept against `skinbench` and `bindcheck`
 * together: 0 leaves trunk sheets disconnected, 2 measures identically to 1. */
const MUSCLE_REACH = 1;



/**
 * The body's own envelope, drawn from the inside.
 *
 * The body is ~500 individually segmented structures and they do not tile into a closed
 * surface: between the external oblique and the serratus, between a rib and the sheet over
 * it, there is real empty space. At a glancing angle against a near-black page you look
 * straight through the trunk, and it reads as a hole punched in the back. It is not a hole in
 * any mesh — all 366 muscles and 90 organs are closed, zero open boundary edges — and it is
 * not backface culling or shading. The pixels really are the page.
 *
 * `scripts/build_shell.py` derives the missing surface from the structures themselves:
 * voxelise everything, close the volume, take its outer face, and cut it per rig segment so
 * each piece rides its own bone rigidly. What arrives here is 45 low-poly shells that
 * together enclose the body.
 *
 * **It is eroded a couple of centimetres and drawn opaque.** Sitting under the surface is
 * what lets it be opaque without hiding anything: every structure is in front of it, and the
 * only pixels it reaches are the ones where there was no structure at all — the gaps. Drawing
 * an *enclosing* shell instead, front-facing, hides the whole body; drawing it back-facing so
 * only the far wall shows was tried too and left the gaps black, because shells overlap each
 * other once they are grown to meet at the joints.
 *
 * The organ volume is **cut out of it** at build time, so turning the organ layer on does not
 * have to turn the shell off. That mattered more than it sounds: organs-on is the state most
 * people browse in, and hiding the shell there brought every gap straight back. It still
 * stands down for x-ray and for a selected structure, which really are requests to see
 * through the body wall.
 *
 * It is a backdrop and nothing else: no region id, not selectable, not labelled, not in the
 * structure table, and it makes no anatomical claim beyond the silhouette already implied by
 * the structures it was computed from.
 */
const shell = { group: new THREE.Group(), loaded: false, loading: false, meshes: [] };
shell.group.name = 'shell';
shell.group.visible = false;
root.add(shell.group);

function loadShell() {
  // a body need not have one: the shell is derived from a *closed* set of structures, and a
  // partial body has no inside for it to be the inside of
  if (!body.assets.shell) return Promise.resolve();
  if (shell.loaded || shell.loading || !rig?.bind) return Promise.resolve();
  shell.loading = true;
  return new Promise(res => {
    new GLTFLoader().load(assetUrl(body.assets.shell), (gltf) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3a2422, roughness: 0.95, metalness: 0.0,
        side: THREE.FrontSide, transparent: false, depthWrite: true,
      });
      const found = [];
      gltf.scene.traverse(o => { if (o.isMesh) found.push(o); });
      for (const o of found) {
        o.material = mat;
        o.frustumCulled = false;
        o.userData.layer = 'shell';
        // drawn before the anatomy so it can never win a depth tie at a coincident surface
        o.renderOrder = -1;
        shell.group.add(o);
      }
      shell.meshes = found;
      shell.loaded = true; shell.loading = false;
      bindShell();
      syncLayers();
      res();
    }, undefined, (e) => {
      // the app is complete without it; the gaps just show the page again
      console.warn('shell.glb not loaded', e?.message ?? e);
      shell.loading = false; res();
    });
  });
}

/** Each shell is named for the segment whose bones it encloses, so it binds by name. */
function bindShell() {
  if (!shell.loaded || !rig?.bind) return;
  for (const o of shell.meshes) {
    if (bound.has(o)) continue;
    const seg = meshName(o.name)[0];
    if (rig.attach(o, seg)) bound.set(o, { segment: seg, bindCentroid: meshCentroid(o) });
  }
}

let pending = 0;
/**
 * Does the body on screen carry this layer at all?
 *
 * The brain is not a body layer — it is one model shared between bodies — but it is *placed*
 * by that body's own `BRAIN_TO_BODY`, a fit whose rotation encodes one subject's head posture.
 * A body with no fit of its own must not borrow another's, so it is not offered the brain at
 * all rather than shown one hanging in the wrong place — a body with no head in its source
 * has no fit to place a brain by.
 */
export const hasLayer = (name) =>
  name === 'brain' ? !!body.brainToBody : body.assets.layers.includes(name);

function loadLayer(name) {
  const L2 = layers[name];
  /* Not every body has every layer, and a missing one is a fact about that person's atlas
   * rather than a failure: the peripheral nervous system comes from a source derived from the
   * male scan, so a different body cannot borrow it. Refusing here keeps the 404 out of the
   * console and the toggle honest. */
  if (!hasLayer(name)) return Promise.resolve();
  if (L2.loaded || L2.loading) return Promise.resolve();
  L2.loading = true;
  pending++;
  ui?.setBusy?.(true);
  if (name === 'brain') return loadBrain(L2);
  return new Promise(res => {
    new GLTFLoader().load(layerUrl(body, name), (gltf) => {
      const mat = makeStructureMaterial(palette, LOOK[name], dqUniform);
      materials.push(mat);
      L2.material = mat;
      // collect first: add() inside traverse() mutates the array being iterated
      const meshes = [];
      gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
      /* Put the two halves of the atlas in one frame, before anything measures this one.
       *
       * The taught body is BodyParts3D 3.0 and everything else is 4.0 -- the same cadaver,
       * delivered in frames this project's two build paths never reconciled. Over the 179
       * bones named in both, 4.0 sits 14 mm low on average and **44 mm low at the foot**,
       * because the error grows down the leg. Drawn together that is a second leg inside the
       * first: the taught skeleton and the 4.0 arteries, veins and detail at the ankle are
       * four centimetres apart, which is what "why do we still have 2 feet" was looking at,
       * and it showed on the taught body too, because the vessels are 4.0 as well.
       *
       * Baked into the geometry rather than hung on the group, because everything downstream
       * measures vertices: the centroids below, the anchors the labels hang from, the radii
       * the panel frames on, the bone field the binding uses, and the rays that pick. A group
       * transform would move the picture and leave every one of those describing where the
       * geometry used to be. `scripts/fit_atlases.py` solves it and prints the residual. */
      if (FITTED_LAYERS.includes(name)) {
        const fix = new THREE.Matrix4().set(...ATLAS_FIT);
        const done = new Set();
        for (const o of meshes)
          if (!done.has(o.geometry)) { done.add(o.geometry); o.geometry.applyMatrix4(fix); }
      }
      for (const o of meshes) {
        o.material = mat;
        o.userData.layer = name;
        const a = regionAttr(o.geometry);
        o.userData.regionId = a ? Math.round(a.getX(0)) : null;
        L2.group.add(o);
      }
      // kept independently of the scene graph: `rig.attach` reparents every bound mesh out
      // of this group, and picking used to raycast the group and so hit nothing at all
      L2.meshes = meshes;
      L2.loaded = true; L2.loading = false;
      indexGeometry(L2.group);
      bindLayer(name);
      /* After binding, because `skinMesh` replaces each mesh with a skinned one and
       * patches `L2.meshes` in place: installing before this would accelerate the
       * objects that were about to be thrown away and leave the ones that are picked
       * on the linear scan. */
      for (const m of L2.meshes ?? []) accelerateRays(m);
      warmRays(pickTargets);
      /* A layer that arrives after the body was taken apart has to be taken apart
       * too. The offsets were computed once, on the first drag of the slider, from
       * whichever structures had centroids at that moment -- and a centroid only
       * exists once its layer has loaded. So turning the arteries on with the body
       * already open left three hundred and seventy-two of them standing in a
       * figure in the middle of the catalogue, which is exactly what it looked
       * like. Nothing is recomputed while the body is assembled; the cost is one
       * pass over the registry when a layer lands mid-explode. */
      relayoutExplode();
      // the skeleton is the bone field's only source, so its arrival is what unblocks every
      // other layer — including any that loaded first and returned without binding
      if (name === 'skeleton' && buildBoneRegions())
        for (const other of LAYER_ORDER) if (other !== 'skeleton' && layers[other].loaded) bindLayer(other);
      // a layer that arrives while an exercise is on screen has to be moved into the pose
      // that is already showing, not left standing in its bind position
      refreshPosed();
      syncLayers();
      done();
      res();
    }, undefined, (e) => { console.error(`${name} failed to load`, e); L2.loading = false; done(); res(); });
  });
}

/* The brain is two files and its own material, and it arrives in brain-frame coordinates,
 * so it gets dropped into the body through the fitted BRAIN_TO_BODY transform rather than
 * being rebuilt in body units. */
let cortex = null;
/* ------------------------------------------------------------ the two looks
 *
 * The cortex can be drawn either way and the choice is the reader's.
 *
 * **Tissue** is the volume — `tissue.js` — additive, depth-write off, both faces, so a ray
 * through the head accumulates every wall of cortex it crosses and the far side shows through
 * the near side. Folds brighten where they overlap, which is why the sulci read as depth with
 * no shadow computed, and the network inside it is visible because there is nothing solid in
 * the way.
 *
 * **Anatomical** is the lit surface it was before — an opaque physical material carrying the
 * same Desikan-Killiany palette. Each parcel is a flat colour with a hard boundary, which is
 * what an atlas plate looks like and is the better picture for "which region is that". It is
 * also the only one of the two that can be x-rayed and cut away, because those are properties
 * of a surface with an inside.
 *
 * Both wear the **same palette object**, so selection, hover, atlas colouring and exercise
 * activation are one piece of state and do not have to be re-applied when the look changes.
 * Both carry `fitTo` and `setScan`, so the plane lands in the same place in either. */
const tissueMat = makeTissueMaterial(palette);
const anatomyMat = makeBrainMaterial(palette);
materials.push(tissueMat, anatomyMat);
/* A live binding: `export let` means everything importing this sees the swap. Reassigned only
 * by `setBrainLook`, which also re-points every mesh wearing the old one. */
export let brainMat = tissueMat;
/** The meshes wearing the cortex's material — cortex, cerebellum, brainstem. */
const brainSurfaces = new Set();
/** What the cortex geometry measured, so a look arriving later can be fitted to it too. */
let brainFit = null;

const BRAIN_LOOKS = ['tissue', 'anatomical', 'neurons'];
export function setBrainLook(look) {
  app.brainLook = BRAIN_LOOKS.includes(look) ? look : 'tissue';
  /* The neurons look has no surface of its own, so it keeps the volume's material: the meshes
   * wearing it are simply not drawn. That matters for coming back — switching neurons →
   * tissue is a visibility change rather than a material swap, and re-fitting a material that
   * never changed would be work for nothing. */
  const next = app.brainLook === 'anatomical' ? anatomyMat : tissueMat;
  /* Only the *material* swap is skippable. `syncLayers` is not: tissue → neurons keeps the
   * same material and changes nothing but visibility, so returning early here left the cortex
   * on screen and the look did nothing at all. */
  if (next !== brainMat) {
    brainMat = next;
    for (const o of brainSurfaces) o.material = next;
    if (layers.brain) layers.brain.material = next;
    /* Both of these live in the material's own uniforms, so the look arriving has to be told
     * where the organ is and where the plane is — otherwise the scan silently stops until the
     * next time something moves it. */
    if (brainFit) next.userData.fitTo?.(brainFit.centre, brainFit.radius);
    applyScan();
  }
  syncLayers();
  ui?.syncControls?.();
}
export const brainLook = () => app.brainLook;

/**
 * The brain rides the skull.
 *
 * It arrives in brain-frame coordinates and gets dropped into the body by the fitted
 * BRAIN_TO_BODY transform, which places it correctly on a *standing* figure and nowhere at
 * all once the rig moves the head. Binding the holder — not the individual meshes — to the
 * skull segment keeps the whole brain as one rigid unit riding the head, which is what a
 * skull does to a brain.
 */
let brainHolder = null;
function bindBrain() {
  if (!rig?.bind || !brainHolder || bound.has(brainHolder)) return;
  if (!rig.attach(brainHolder, 'skull')) return;
  bound.set(brainHolder, { segment: 'skull' });
  /* The *holder* is what gets attached — binding the meshes individually would let the
   * cortex and the deep structures drift apart, and a skull does not do that to a brain.
   * But `refreshPosed`, `anchorFor`, `posedSide` and `flyTo` all ask `bound` where a **mesh**
   * is, and a mesh that is not in that map keeps its rest-pose centroid for ever. So the
   * brain rode the head correctly and every label rope and every camera flight still aimed
   * at where it had been standing: in the Swan the brain is at y 0.19, z 0.37 and `flyTo`
   * pointed the camera at y 0.42, z −0.03 — **0.46 of a body height away**, which is a whole
   * body length. That is why selecting a brain region showed an empty frame with the brain a
   * small shape off in a corner, and why the Motor cortex rope pointed at nothing.
   *
   * Registering each mesh as riding `skull` costs nothing — the transform still comes from
   * the one holder — and makes every one of those four ask the right question. */
  brainHolder.traverse(o => { if (o.isMesh) bound.set(o, { segment: 'skull' }); });
}

function loadBrain(L2) {
  const holder = brainPlacement(new THREE.Group());
  // tagged so syncLayers' per-mesh pass can hide it: once it is bound to the skull it has
  // left its layer group, and hiding the group no longer reaches it
  holder.userData.layer = 'brain';
  brainHolder = holder;
  L2.group.add(holder);
  L2.material = brainMat;
  let left = 2;
  return new Promise(res => {
    const finish = () => {
      if (--left) return;
      L2.meshes = [];
      holder.traverse(o => { if (o.isMesh) L2.meshes.push(o); });
      for (const m of L2.meshes) accelerateRays(m);
      L2.loaded = true; L2.loading = false;
      indexGeometry(L2.group);
      bindBrain();
      warmRays(pickTargets);
      /* A brain that arrives while the sheet is already open has to go to its cells with
       * everything else, rather than standing in the middle of them until the slider is
       * touched again. */
      brainWhileApart();
      refreshPosed();
      syncLayers();
      pendingSections?.(); pendingSections = null;
      /* The brain may arrive after an exercise was chosen — the layer is loaded on demand and
       * the network is built here, so marks set before this point were written to a palette
       * with no meshes and a network that did not exist. Re-applying costs nothing and is the
       * same rule `buildBoneRegions` follows when the skeleton turns up late. */
      applyBrainMarks();
      done();
      res();
    };
    new GLTFLoader().load(assetUrl('models/cortex.glb'), (g) => {
      g.scene.traverse(o => {
        if (o.isMesh) { o.material = brainMat; o.renderOrder = 2; o.userData.layer = 'brain';
                        brainSurfaces.add(o); cortex = o; }
      });
      /* The shader measures "how deep in the head is this fragment" against the organ's own
       * centre and radius, so it has to be told them. Taken from the geometry rather than
       * written down: this is a property of whichever cortex loaded. */
      if (cortex) {
        cortex.geometry.computeBoundingSphere();
        const bs = cortex.geometry.boundingSphere;
        brainFit = { centre: bs.center.clone(), radius: bs.radius };
        tissueMat.userData.fitTo?.(bs.center, bs.radius);
        anatomyMat.userData.fitTo?.(bs.center, bs.radius);
        buildNeuralNet(cortex, holder);
        /* Deferred: the deep structures are still loading, and a strip built now would show
         * the cortex crossing the plane and nothing inside it. `finish()` runs when both
         * halves are in. */
        pendingSections = () => {
          // each structure in its own colour, so a bright shape in a slice identifies itself
          sections.build(holder, cortex, bs.center, bs.radius, id => get(id)?.color ?? null);
          /* The lateral plate the region map sits on, from the same meshes in the same frame.
           * Built here rather than in the lab because it needs the app's renderer and the
           * brain's holder, and both are private to this file. */
          brainPlate.build(holder, cortex);
          refreshSections(true);
        };
      }
      holder.add(g.scene);
      finish();
    }, undefined, finish);
    const seg = loadDeepStructures(assetUrl('models/subcortical.glb'), (g, ids) => {
      /* The cerebellum and the brainstem wear the cortex's own material — they are visible
       * brain surface rather than interior structures — so they have to follow the look. The
       * interior structures have their own additive material and stay as they are. */
      g.traverse(o => {
        if (!o.isMesh) return;
        o.userData.layer = 'brain';
        if (o.material === brainMat) brainSurfaces.add(o);
      });
      finish();
    }, brainMat);
    holder.add(seg);
    brainDeep = seg;
  });
}
let brainDeep = null;

/* ------------------------------------------------------------ neural net
 * Built from the cortex's own vertices once it has loaded — see `neuralNet.js`. It is a
 * child of the brain holder, so it rides the skull with everything else. */
let neuralNet = null;
function buildNeuralNet(cortexMesh, holder) {
  if (neuralNet) return;
  neuralNet = new NeuralNet(cortexMesh);
  holder.add(neuralNet.group);
  neuralNet.visible = app.neural;
}
function tickNeuralNet(t) {
  if (!neuralNet) return;
  /* Not in the solid look. The nodes are additive, so an opaque cortex does not occlude them —
   * they draw *over* it, and a web of threads across a flat parcel colour reads as scratches
   * on the plate rather than as cells inside a head. The help text for that look already says
   * the network is hidden, which is a promise this line has to keep.
   *
   * `app.neural` is untouched: it is the reader's own switch, and coming back to the volume
   * has to bring the network back with it rather than silently having turned it off. */
  /* And not over the catalogue. The network is a diagram of what connects to what, drawn
   * through the brain's own volume — there is no cell in an inventory of parts for it, and
   * spread over a sheet two metres wide it is a haze of threads across everything else. */
  neuralNet.visible = app.neural && app.layers.brain.on && app.brainLook !== 'anatomical'
    && app.explode <= OPENED
    /* And not behind something isolated. The network hangs off the brain's holder rather than
     * living in a layer, so the isolation pass never reached it: asking to see one artery
     * alone drew it in front of a full web of cells and threads. */
    && (!app.isolate?.size || [...app.isolate].some(id => get(id)?.layer === 'brain'));
  /* Turned up when it is on its own. Inside the volume the network is one layer of a picture
   * and has to sit under the tissue; with nothing around it the same values read as a thin
   * scatter of dust, because there is no longer anything for them to be inside of. */
  neuralNet.setEmphasis?.(app.brainLook === 'neurons');
  neuralNet.tick(t);
}
/* ------------------------------------------------------------------ the scan
 * The three anatomical planes, as normals in the canonical frame: +X LEFT, +Y SUPERIOR,
 * +Z ANTERIOR. A sagittal section is cut by a plane whose normal runs left-right, and so on —
 * the plane is named for the section it produces, not for its own normal, which is the usual
 * way to get this backwards. */
const SCAN_PLANES = {
  sagittal: new THREE.Vector3(1, 0, 0),
  coronal:  new THREE.Vector3(0, 0, 1),
  axial:    new THREE.Vector3(0, 1, 0),
};
export function setScan(plane, at = 0) {
  app.scan.plane = plane && SCAN_PLANES[plane] ? plane : null;
  app.scan.at = at;
  applyScan();
}
export function setScanAt(at) { app.scan.at = at; applyScan(); }
export function setSweep(on) { app.scan.sweeping = !!on; if (!on) applyScan(); }
function applyScan() {
  brainMat.userData.setScan?.(
    app.scan.plane ? SCAN_PLANES[app.scan.plane] : null, app.scan.at);
  /* The cells the plane is passing through fire harder. It is the same activity map the
   * region selection writes to, so a scan and a selection cannot both claim the network at
   * once — which is correct: they are two ways of asking the same question. */
  neuralNet?.setScan?.(app.scan.plane ? SCAN_PLANES[app.scan.plane] : null, app.scan.at);
  refreshSections();
}
export const scanState = () => ({ ...app.scan });

/* ---------------------------------------------------------- which way round
 * A lateral view of a brain is ambiguous without a caption: front could be either end, and a
 * reader who cannot tell has no way to know whether the label on the left belongs to the
 * frontal pole or the occipital one. Every atlas plate says which way it is facing; this is
 * the same sentence, derived from where the camera actually is rather than written down.
 *
 * The frame is +X LEFT, +Y SUPERIOR, +Z ANTERIOR, so the dominant component of the view
 * direction names the view, and the sign of anterior along the camera's own right vector says
 * which end of the subject is on the right of the screen. */
const _vd = new THREE.Vector3(), _cr = new THREE.Vector3();
function orientText() {
  camera.getWorldDirection(_vd);
  const ax = Math.abs(_vd.x), ay = Math.abs(_vd.y), az = Math.abs(_vd.z);
  let key;
  if (ax >= ay && ax >= az) key = _vd.x < 0 ? 'viewLeftLat' : 'viewRightLat';
  /* The camera's own direction points *from* the eye *into* the picture, so a viewer looking
   * at the anterior surface is looking along -Z in a frame where +Z is anterior. This read
   * the sign the other way and captioned every front view "Posterior view" and every back
   * view "Anterior view" — a readout that names the wrong side of the body is worse than no
   * readout, because it is believed. The left/right and superior/inferior arms of the same
   * test were already right, which is why it went unnoticed. */
  else if (az >= ay) key = _vd.z < 0 ? 'viewAnt' : 'viewPost';
  else key = _vd.y < 0 ? 'viewSup' : 'viewInf';
  const out = [UI_STR[key]?.[app.lang] ?? ''];
  // "front at right" only means anything on a view that has a front and a back on screen
  if (key === 'viewLeftLat' || key === 'viewRightLat' || key === 'viewSup' || key === 'viewInf') {
    _cr.setFromMatrixColumn(camera.matrixWorld, 0);       // the camera's own right vector
    out.push(UI_STR[_cr.z > 0 ? 'frontRight' : 'frontLeft']?.[app.lang] ?? '');
  }
  return out.filter(Boolean).join(' · ');
}
function drawOrient() {
  const el = document.getElementById('orient');
  if (!el) return;
  const t = app.labelsOn ? orientText() : '';
  if (el.textContent !== t) el.textContent = t;
}

/* ------------------------------------------------------------- the sections
 * A strip of true sections along the plane the scan is using — `sections.js` renders them,
 * this decides when. Three rules, and each one is the difference between a readout and a
 * decoration.
 *
 * **Redrawn on the plane, never on the position.** The sections live in the brain's own
 * frame, so they do not change when the camera moves, the head is posed, or a clip plays.
 * `applyScan` runs every frame of a sweep; five renders of the whole brain per frame, for
 * five pictures that would be identical, is how a feature like this ends a frame budget.
 *
 * **The strip appears with the brain and with no plane chosen.** A section series that only
 * exists once you have already found the scan control is a reward for knowing about it. It
 * opens on axial, and clicking a slice is what turns the plane on in the picture.
 *
 * **The captions are millimetres, and they are real ones.** `FRAME.scale` converts MNI
 * millimetres into brain-frame units, so dividing by it goes back — these are distances in
 * the fsaverage volume the cortex was built from, measured from the cortex's own centroid,
 * not a number chosen to look like an instrument. */
const sections = sectionStrip;
let pendingSections = null;
let sectDrawn = null;          // the plane whose pictures are currently in the canvases
let sectActive = -1;
const SECT_DEFAULT = 'axial';

function sectionEls() {
  const row = document.getElementById('sectRow');
  if (!row) return [];
  if (row.childElementCount !== SLICE_COUNT) {
    row.innerHTML = '';
    for (let i = 0; i < SLICE_COUNT; i++) {
      const b = document.createElement('button');
      b.className = 'sect';
      b.appendChild(document.createElement('canvas'));
      b.appendChild(document.createElement('span'));
      b.onclick = () => {
        const plane = app.scan.plane ?? SECT_DEFAULT;
        setScan(plane, sections.positions()[i]);
        ui?.syncControls?.();
      };
      row.appendChild(b);
    }
    row.addEventListener('scroll', sectArrows, { passive: true });
    new ResizeObserver(sectArrows).observe(row);
  }
  /* The arrows are wired on every call, not once with the row, and assigned rather than added.
   * Wiring them inside the build was one `getElementById` racing the moment the strip is first
   * asked for, and it lost: the buttons were drawn, they lit when there was somewhere to go,
   * and clicking one did nothing at all — which is indistinguishable from a scroller that
   * cannot scroll. `onclick` is idempotent, so running it every time costs a property write
   * and cannot stack handlers.
   *
   * They page by four fifths of the visible width. A step of one thumbnail makes a reader
   * click six times to cross the strip and reads as a stutter. */
  const page = d => {
    const by = d * Math.max(120, row.clientWidth * 0.8);
    row.scrollTo({ left: Math.max(0, Math.min(row.scrollWidth - row.clientWidth,
                                              row.scrollLeft + by)), behavior: 'smooth' });
  };
  const prev = document.getElementById('sectPrev');
  const next = document.getElementById('sectNext');
  if (prev) prev.onclick = () => page(-1);
  if (next) next.onclick = () => page(1);
  return [...row.children];
}

/**
 * Show each arrow only where there is something in that direction.
 *
 * A scroller whose arrows are always drawn tells a reader nothing about whether they are at
 * the end, and one whose arrows are never drawn is the state this shipped in: nine cuts, the
 * last four unreachable, and no mark on the screen saying they existed.
 */
function sectArrows() {
  const row = document.getElementById('sectRow');
  if (!row) return;
  const over = row.scrollWidth - row.clientWidth;
  document.getElementById('sectPrev')?.classList.toggle('on', over > 4 && row.scrollLeft > 2);
  document.getElementById('sectNext')
    ?.classList.toggle('on', over > 4 && row.scrollLeft < over - 2);
}

/**
 * Bring one slice into the visible window, without moving the page.
 *
 * `scrollIntoView` would do it and would also scroll every scrollable ancestor, which on a
 * stacked phone layout means the whole console jumps because the strip's active cut changed.
 */
function sectReveal(el) {
  const row = el?.parentElement;
  if (!row) return;
  const l = el.offsetLeft - row.offsetLeft, r = l + el.offsetWidth;
  if (l < row.scrollLeft) row.scrollTo({ left: Math.max(0, l - 8), behavior: 'smooth' });
  else if (r > row.scrollLeft + row.clientWidth)
    row.scrollTo({ left: r - row.clientWidth + 8, behavior: 'smooth' });
}

/**
 * Put the strip in step with the scan.
 *
 * @param force redraw the pictures even if the plane has not changed — for the first build,
 *              and for a language switch, which changes the caption but not the section
 */
function refreshSections(force = false) {
  invalidate();
  const host = document.getElementById('sections');
  if (!host) return;
  /* Not over the catalogue.
   *
   * The strip is nine cuts through the brain, and it sits along the bottom of the stage — a
   * quarter of the height. That is a fair trade while the picture is a head; it is a quarter
   * of the sheet covered while the picture is two thousand pieces laid out to be read, and
   * the pieces underneath it cannot even be pointed at. Taking the body apart is a request to
   * see the parts, so the cuts stand down until it is put back together. */
  const on = !!app.layers.brain?.on && !!sections?.ready && app.explode <= OPENED
    // nor beside something isolated that is not in the brain: the cuts would be of an organ
    // that is not on the screen
    && (!app.isolate?.size || [...app.isolate].some(id => get(id)?.layer === 'brain'));
  host.hidden = !on;
  if (!on) { sectDrawn = null; return; }

  const plane = app.scan.plane ?? SECT_DEFAULT;
  const els = sectionEls();
  const at = sections.positions();
  /* The strip follows the selection too: choosing a structure anywhere in the application
   * lights it in every cut it passes through, here as well as in the lab. `setFocus` reports
   * whether anything changed, so a selection that does not affect this series costs nothing. */
  const moved = sections.setFocus(app.selected ?? -1, id => get(id)?.color ?? null);
  if (force || plane !== sectDrawn || moved) {
    if (sections.draw(SCAN_PLANES[plane], els.map(e => e.firstChild))) sectDrawn = plane;
    const mm = d => `${d > 0 ? '+' : ''}${Math.round(d * sections.radius / FRAME.scale)}`;
    /* Each slice says what it goes through, not only where it is. "−28 mm" is a coordinate;
     * "−28 mm · cerebellum, brainstem" is a section. The list is measured off this model's own
     * geometry by `contentsAt`, so it is a statement about the picture rather than a textbook
     * sentence about brains in general. */
    els.forEach((e, i) => {
      const names = sections.contentsAt(SCAN_PLANES[plane], at[i])
        .map(id => nameOf(id, app.lang)).filter(Boolean).sort();
      // built as nodes rather than as innerHTML: these are structure names out of the
      // registry, and there is no reason for a caption to go near a string parser
      const cap = e.lastChild;
      cap.textContent = `${mm(at[i])} mm`;
      const what = document.createElement('i');
      what.textContent = names.slice(0, 3).join(', ')
        || (UI_STR.sectCortexOnly?.[app.lang] ?? '');
      cap.appendChild(what);
    });
    const lab = document.getElementById('sectLab');
    if (lab) lab.textContent = UI_STR.sections?.[app.lang] ?? 'Sections';
    const note = document.getElementById('sectNote');
    if (note) note.textContent = UI_STR.sectionsNote?.[app.lang] ?? '';
    const pl = document.getElementById('sectPlane');
    if (pl) pl.textContent = app.scan.plane
      ? (UI_STR[`scan${plane[0].toUpperCase()}${plane.slice(1)}`]?.[app.lang] ?? plane) : '';
  }

  /* The legend: what is in this series, in the colours the slices are drawn in. Without it the
   * colours are decoration; with it the picture answers "what is that bright thing" and the
   * caption no longer has to. Taken from the union across all five cuts, because a reader is
   * looking at the strip rather than at one thumbnail. */
  const legend = document.getElementById('sectLegend');
  if (legend && (force || plane !== sectDrawn)) {
    const seen = new Map();
    for (const a of at)
      for (const id of sections.contentsAt(SCAN_PLANES[plane], a))
        if (!seen.has(id)) seen.set(id, get(id));
    legend.textContent = '';
    for (const [id, r] of seen) {
      if (!r) continue;
      const el = document.createElement('button');
      el.className = 'sectkey';
      el.dataset.id = String(id);
      const dot = document.createElement('i');
      dot.style.background = r.color;
      const name = document.createElement('span');
      name.textContent = nameOf(id, app.lang);
      el.append(dot, name);
      el.onclick = () => selectStructure(id);
      legend.appendChild(el);
    }
    // the cortex is in every cut and has no id of its own, so it is named once, last
    const cx = document.createElement('span');
    cx.className = 'sectkey cortexkey';
    const cd = document.createElement('i');
    cd.style.background = '#FFC98A';
    const cn = document.createElement('span');
    cn.textContent = UI_STR.sectCortex?.[app.lang] ?? '';
    cx.append(cd, cn);
    legend.appendChild(cx);
  }

  /* Which slice the big plane is nearest. Written only when it changes: this is reached on
   * every frame of a sweep, and five attribute writes a frame is the thrash the labels
   * already made once. */
  let near = -1;
  if (app.scan.plane) {
    let best = Infinity;
    at.forEach((v, i) => { const d = Math.abs(v - app.scan.at); if (d < best) { best = d; near = i; } });
    // only when the plane is genuinely on that slice, not merely nearest to it
    if (best > 0.16) near = -1;
  }
  if (near !== sectActive) {
    sectActive = near;
    els.forEach((e, i) => e.setAttribute('aria-current', i === near));
    if (near >= 0) sectReveal(els[near]);
  }

  /* Which cuts cross the selected structure, marked on the outside of the thumbnail. The
   * structure is already lit *inside* them, but nine cuts do not all fit on the screen at
   * once, so "which of these has it" has to be answerable without scrolling through them —
   * and the first one that does is scrolled to. */
  if (moved) {
    const box = app.selected != null ? sections.locate(SCAN_PLANES[plane], app.selected) : null;
    let first = -1;
    els.forEach((e, i) => {
      const has = !!box && at[i] >= box.lo && at[i] <= box.hi;
      if (has && first < 0) first = i;
      e.classList.toggle('hasit', has);
    });
    if (first >= 0) sectReveal(els[first]);
  }
  sectArrows();
}

/** The brain regions this body actually carries, for the readout. */
function brainRegionIds() {
  if (!REG_READY) return [];
  const out = [];
  for (const [id, r] of registry().byId) if (r.layer === 'brain') out.push(id);
  return out;
}
/** What the network actually contains, so a test can assert it is not decoration. */
export const neuralStats = () => neuralNet?.stats() ?? null;
/** The same network collapsed to one node per region — see `connectome.js`. */
export const regionGraph = () => neuralNet?.regionGraph() ?? null;
/** Every cell and every fibre, for the bundled connectome — see `lab.js`. */
export const cellGraph = () => neuralNet?.cellGraph() ?? null;
/**
 * Whether a structure's layer is still coming in.
 *
 * Selecting something in an unloaded layer starts the load and returns immediately, so a panel
 * that renders straight away gets an empty picture. It has to be able to tell that apart from
 * a structure this model genuinely has no shape for — the two look identical and only one of
 * them is worth telling a reader about.
 */
export function layerPending(id) {
  const r = id != null ? get(id) : null;
  const L2 = r ? layers[r.layer] : null;
  return !!L2 && !L2.loaded;
}
/** The cortex mesh, so the lab's 3D panel can borrow its geometry rather than model a brain. */
export const cortexMesh = () => cortex;
/**
 * A lateral render of the real brain, for the region map to sit on — see `brainPlate.js`.
 *
 * Returns the image and the rectangle it covers in the cortex geometry's own frame, which is
 * the frame the region graph's nodes are in, so the caller places it without fitting anything.
 * Rendered on the first ask and cached: it borrows this module's renderer, and doing that on
 * every frame of a hovered panel would put a 1024-pixel readback in the frame budget.
 */
export const brainPlateImage = () => {
  const img = brainPlate.draw();
  return img ? { image: img, rect: brainPlate.rect } : null;
};

/**
 * The section series, for the lab to draw at a size a reader can actually read.
 *
 * The strip beside the stage is 136 pixels a slice, which is enough to see that a cut changed
 * and not enough to see what it cut. "I still don't understand what those sliced brain parts
 * mean" is a report about that: at thumbnail size the answer is not on the screen to be found.
 * The lab gets the same renders, four times the area, with what each one crosses spelled out.
 *
 * Draws into the canvases given and hands back what it drew: the position of each cut in
 * millimetres and the named structures it passes through, both measured off this model's own
 * geometry. Returns null when there is no brain loaded, which is a state the caller has to
 * render rather than one it can assume away.
 */
export function drawSections(canvases, plane = null, focus = -1) {
  if (!sections?.ready || !canvases?.length) return null;
  const key = plane && SCAN_PLANES[plane] ? plane : (app.scan.plane ?? SECT_DEFAULT);
  const axis = SCAN_PLANES[key];
  /* Before the render, not after: the gain is a uniform the draw reads, so a focus set
   * afterwards would show up one redraw late — which looks exactly like a control that needs
   * clicking twice. */
  sections.setFocus(focus, id => get(id)?.color ?? null);
  if (!sections.draw(axis, canvases)) return null;
  const at = sections.positions();
  return {
    plane: key,
    slices: at.map(a => ({
      at: a,
      mm: Math.round(a * sections.radius / FRAME.scale),
      ids: sections.contentsAt(axis, a),
    })),
  };
}
/** Move the big plane to one of those cuts, so a section in the lab is also a control. */
export function setScanToSlice(plane, at) { setScan(plane, at); }
/**
 * Where a named structure is in a given cut series — see `SectionStrip.locate`.
 *
 * Its extent along the cut axis, so a caller can say which cuts pass through it and how thick
 * it is, and its centroid in the thumbnail's own normalised frame, so a caller can ring it in
 * the picture. Both measured off this model's geometry rather than quoted from an atlas.
 */
/**
 * Which structure a cut is showing at a point on it, given in the thumbnail's own −1..1 frame.
 *
 * The one direction the cuts never worked in. They named what a cut passed through and lit
 * whatever was already selected, but the picture itself was inert: a reader looking at a bright
 * shape had no way to ask what it was or to choose it. This is that question, answered off the
 * same geometry the thumbnail is drawn from.
 */
export function pickInSection(plane, at, sx, sy) {
  if (!sections?.ready) return null;
  const key = plane && SCAN_PLANES[plane] ? plane : (app.scan.plane ?? SECT_DEFAULT);
  const hit = sections.pickAt(SCAN_PLANES[key], at, sx, sy);
  return hit ? { ...hit, name: nameOf(hit.id, app.lang) } : null;
}

export function locateInSections(id, plane = null) {
  if (!sections?.ready || id == null) return null;
  const key = plane && SCAN_PLANES[plane] ? plane : (app.scan.plane ?? SECT_DEFAULT);
  const at = sections.locate(SCAN_PLANES[key], id);
  if (!at) return null;
  const mm = v => Math.round(v * sections.radius / FRAME.scale);
  return { ...at, loMm: mm(at.lo), hiMm: mm(at.hi), plane: key };
}
/**
 * What each region is doing right now, as the shaders have been told it.
 *
 * Read back out of the activity texture rather than recomputed, for the same reason the cell
 * probe recomputes the vertex shader's own function: a readout that disagrees with the picture
 * is worse than no readout. An empty map means nothing is driving the network.
 */
export function regionActivity() {
  const out = new Map();
  const act = neuralNet?.act;
  if (!act?.data) return out;
  for (let i = 0; i < act.data.length; i++) if (act.data[i] > 0.001) out.set(i, act.data[i]);
  return out;
}

function done() {
  if (--pending <= 0) { pending = 0; ui?.setBusy?.(false); document.getElementById('loading')?.remove(); }
}

/* ------------------------------------------------- geometry index for labels
 * Per structure: a world-space centroid, an on-screen size proxy, and a spread of surface
 * points to hang a leader rope from. A centroid alone is inside the mesh, and a rope drawn
 * to it points at nothing. */
function indexGeometry(group) {
  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const pos = o.geometry.getAttribute('position');
    const reg = regionAttr(o.geometry);
    if (!pos) continue;
    o.updateWorldMatrix(true, false);
    const byId = new Map();
    const step = Math.max(1, Math.floor(pos.count / 3000));
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += step) {
      const id = reg ? Math.round(reg.getX(i)) : o.userData.regionId;
      if (id == null || id <= 0) continue;
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
      let e = byId.get(id);
      if (!e) byId.set(id, e = { sum: new THREE.Vector3(), n: 0, pts: [] });
      e.sum.add(v); e.n++;
      if (e.pts.length < 32 && !e.pts.some(q => q.distanceToSquared(v) < 1e-4)) e.pts.push(v.clone());
    }
    /* Kept per *mesh*, not per id. A paired structure — every limb muscle, every limb bone
     * — is two meshes sharing one region id, and its rest centroid is the midpoint between
     * them. Applying one side's delta matrix to that midpoint puts it somewhere neither
     * side is, which is what sent the camera to a hand's label and landed it beside the
     * hand, inside the ribcage. Each mesh carries its own rest measurements and its own
     * segment; the sides are recombined once per pose. */
    const own = new Map();
    for (const [id, e] of byId) {
      const c = e.sum.clone().divideScalar(e.n);
      own.set(id, { c, pts: e.pts.map(p => p.clone()) });
      const prev = app.centroids[id];
      /* `.clone()` on the single-mesh branch is load-bearing. `c` is the same Vector3 that
       * goes into `own`, which is this mesh's *rest* measurement; `refreshPosed` writes the
       * posed position with `app.centroids[id].copy(...)`, so handing it the un-cloned `c`
       * let it overwrite the rest centroid in place — and then read that overwritten value
       * as the rest position on the next frame, applying the pose delta again, and again.
       * Every unpaired structure's centroid therefore walked away from the body a little
       * more with every frame of every clip. Paired structures were accidentally safe,
       * because the second mesh takes the other branch and builds a fresh vector. */
      app.centroids[id] = prev ? prev.clone().add(c).multiplyScalar(0.5) : c.clone();
      /* Kept unposed, because it is what orders the label lanes. `app.centroids` is rewritten
       * by `refreshPosed` on every frame of a playing clip, so a lane sorted on it re-sorts
       * every frame and the names swap rows continuously — the diaphragm was second in the
       * list one frame and last the next. Anatomical order is a property of the body, not of
       * the instant. */
      restY[id] = app.centroids[id].y;
      app.anchors[id] = (app.anchors[id] ?? []).concat(e.pts).slice(0, 40);
      if (!meshesOfId.has(id)) meshesOfId.set(id, []);
      meshesOfId.get(id).push(o);
      let rad = 0, far = 0;
      for (const p of e.pts) {
        const d = p.distanceTo(c);
        rad += d;
        if (d > far) far = d;
      }
      app.radii[id] = Math.max(app.radii[id] ?? 0, e.pts.length ? rad / e.pts.length : 0.01);
      /* The furthest a structure reaches, as well as its average reach.
       *
       * `app.radii` is a *mean*, which is the right size proxy for "how big does
       * this look on screen" and badly wrong for "will this fit in a box". A
       * fascia sheet or a long strap muscle has a small mean and a long reach, so
       * a catalogue cell sized from the mean magnified it three times and it
       * sprawled across a dozen of its neighbours -- the dark shapes lying over
       * the middle of the sheet. */
      app.extent[id] = Math.max(app.extent[id] ?? 0, far || 0.01);
    }
    restByMesh.set(o, own);
  }
  buildLabelEls();
}

/* ------------------------------------------------------------------ palette */
function paintPalette() {
  invalidate();
  const { byId } = registry();
  for (const [id, r] of byId) palette.setColor(id, r.color);
  for (const m of materials) m.userData.sync?.();
}

/* --------------------------------------------------------------- visibility */
/**
 * X-ray on a body is not the same problem as x-ray on a brain.
 *
 * The brain's ghost mode is a fresnel shell: one closed surface, one alpha ramp, and the
 * interior shows through. A body is four hundred separate meshes, and the same shell over
 * all of them blends every wall of every muscle against every other with no depth sorting —
 * which reads as shattered glass, not as anatomy.
 *
 * So x-ray here fades whole layers by depth instead: the outermost goes first and the
 * skeleton stays solid. Same intent, and it composes with the per-layer opacity sliders
 * rather than fighting them. The fresnel shell is kept for the brain, where it works.
 */
const XRAY_DEPTH = { muscles_superficial: 0, muscles_deep: 1, organs: 2,
                     skeleton: 3, brain: 4,
                     /* The vasculature threads through every one of those, so it is not
                      * at a depth of its own -- it is put where the tissue it runs in is,
                      * which keeps a coronary from ghosting differently to the heart. */
                     arteries: 2, veins: 2, airways: 2, heart_detail: 2,
                     nerves_cranial: 2, connective: 3, detail: 2,
                     bones_full: 3, muscles_full: 0, organs_full: 2 };

/* Every camera move, including each damping step after the drag ends. This one
 * listener is what makes orbiting feel unchanged while the still body costs
 * nothing. */
controls.addEventListener('change', () => invalidate());

/* Belt and braces. Every state change that moves a pixel is supposed to reach
 * `syncLayers`, `paintPalette` or `refreshPosed`, and most do -- but this file
 * is four thousand lines and a setter that forgets shows up as a control that
 * does nothing until you nudge the camera, which is a maddening bug to find.
 * So anything the reader does to the page also asks for a few frames. It costs
 * three frames per interaction and it makes the whole class of mistake
 * invisible. */
for (const kind of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown',
                    'input', 'change', 'click'])
  addEventListener(kind, () => invalidate(), { capture: true, passive: true });
/* Coming back to the tab, and finishing a font or texture load, both leave the
 * canvas holding whatever was there when it left. */
addEventListener('visibilitychange', () => invalidate(8));
addEventListener('focus', () => invalidate(8));

export function syncLayers() {
  invalidate();
  // the strip has nothing to cut without the brain, and says so by not being there
  refreshSections();
  /* The shell only makes sense behind something. With every body layer off there is nothing
   * for it to be the inside of, and a bare dark silhouette is not what Explore is for. */
  const covering = ['muscles_superficial', 'muscles_deep', 'skeleton']
    .some(n => app.layers[n]?.on && layers[n].loaded);
  // an automatic selection is not a request to see inside — see `selectStructure`
  const chosen = app.selected != null && !app.autoSelected ? app.selected : null;
  /* The shell cannot come apart with the body: it is a derived envelope with no
   * region attribute, so the vertex shader has nothing to look its displacement
   * up by and it stays exactly where it was while everything else moves out
   * around it. Left on, it reads as a dark mass sitting in the middle of a body
   * that has just been opened, which is the opposite of what opening it was
   * for. */
  const seeingInside = app.xray > 0.12 || chosen != null || app.explode > 0.01;
  const showShell = shell.loaded && covering && !seeingInside;
  for (const o of shell.meshes) o.visible = showShell;
  shell.group.visible = showShell;
  for (const name of LAYER_ORDER) {
    const L2 = layers[name], st = app.layers[name];
    // showMeshes is a separate axis from the layer toggle: during a movement the detailed
    // muscle meshes are hidden in favour of the paths, without turning the layer off
    const muscleLayer = name.startsWith('muscles');
    L2.group.visible = st.on && L2.loaded && (!muscleLayer || app.showMeshes);
    /* The brain is not a body layer any more and this block cannot describe it. Everything
     * below — opacity as a scalar, an opaque fast path, FrontSide, a depth write — is written
     * for a lit closed surface, and the cortex is an additive volume whose brightness lives in
     * a uniform. It has its own block further down. Skipping it here is what stops `uShell`
     * being written onto a material that has never had one. */
    if (!L2.material || name === 'brain') continue;
    let o = st.opacity;
    const depth = XRAY_DEPTH[name] ?? 0;
    o *= 1 - app.xray * 0.92 * (1 - depth / 4);
    /* Selecting a deep structure peels away what is in front of it and leaves what is
     * behind. Fading every other layer equally — which is what the brain did, where there
     * was only ever one — buries the thing you asked about in a uniform haze instead of
     * revealing it. */
    /* Not while the body is laid out. The peel is a statement about depth -- what is
     * in front of the thing you asked for gets out of the way -- and a catalogue has
     * no depth: every piece is side by side on a sheet. Applied there it drops most
     * of the atlas to six per cent opacity over a black background, which is the
     * whole sheet going dark the moment anything is chosen. */
    const selRec = chosen != null && app.explode <= OPENED ? get(chosen) : null;
    if (selRec) {
      const selDepth = XRAY_DEPTH[selRec.layer] ?? 0;
      /* Gentle, when the selection is drawn through the body anyway.
       *
       * Dissolving what is in front to six per cent is a strong statement and it
       * was the only one available: without it a chosen structure behind a
       * ribcage simply could not be seen. It also produces the picture that came
       * back with "impossible to see what's inside" -- a body at six and fifty
       * per cent, drawn in the sorted pass without writing depth, is a haze with
       * black polygons punched through it where the far wall of a rib shows
       * through the near one.
       *
       * `revealSelection` answers the same question by drawing the one structure
       * over the top, which needs nothing from the body. So with it on, this goes
       * back to what a peel is for -- saying which layer the answer is in -- and
       * stays inside the opaque pass, where the picture is clean. Turn it off and
       * the old peel comes back, because then the fade is again the only way
       * through. */
      if (!app.reveal) {
        if (depth < selDepth) o *= 0.06;        // in front: nearly gone
        else if (depth > selDepth) o *= 0.5;    // behind: kept as context
      }
      if (depth === selDepth) o = Math.max(o, 0.96);   // its own layer: never faded
    }
    o = Math.max(0, o);
    /* An opaque layer has to be flagged opaque, not merely given opacity 1.
     * `transparent: true` puts the mesh in the sorted back-to-front pass, which throws away
     * early-z entirely: every fragment of every muscle hidden behind every other muscle
     * still runs a full MeshPhysicalMaterial shade, clearcoat and sheen and IBL included.
     * With four layers and 700k triangles that measured 0.2 frames per second. Front-to-back
     * opaque rendering discards most of it before shading.
     *
     * FrontSide for the same reason: these meshes are closed, so the back faces are never
     * visible and DoubleSide doubles the fragment work for nothing. */
    const opaque = o >= 0.999;
    L2.material.opacity = o;
    L2.material.transparent = !opaque;
    L2.material.depthWrite = opaque || o > 0.92;
    L2.material.clippingPlanes = app.cutaway ? [clipPlane] : null;
    L2.material.side = app.cutaway ? THREE.DoubleSide : THREE.FrontSide;
    const u = L2.material.userData.uniforms;
    if (u) { u.uXray.value = 0; u.uShell.value = 1; u.uAtlas.value = app.atlas; }
    L2.material.needsUpdate = true;
  }
  /* Isolation, applied last and over everything.
   *
   * Built from `meshesOfId` rather than from each mesh's own `regionId`,
   * because a paired structure is two meshes under one id and reading the
   * first vertex of each would have isolated one side of a body that has two.
   */
  const only = app.isolate?.size ? new Set() : null;
  if (only) for (const id of app.isolate)
    for (const mesh of meshesOfId.get(id) ?? []) only.add(mesh);

  /* Bound meshes live in the rig hierarchy, not in their layer's group, so hiding the group
   * no longer hides them. Visibility is therefore per mesh for anything the rig has taken
   * over — which is every bone and every muscle once the rig has loaded. */
  for (const [mesh, b] of bound) {
    const layer = mesh.userData.layer;
    const st = app.layers[layer];
    if (!st) continue;
    /* The neurons look draws the cells and nothing else — no cortex, no cerebellum, no deep
     * structures. Hiding the surfaces is the whole feature: the axons already carry travelling
     * impulses and have since the network was built, but behind a wall of tissue you can only
     * catch them at the silhouette. With the tissue gone the flow *is* the picture.
     *
     * **Meshes only.** The brain's *holder* is in `bound` too — it is what rides the skull, and
     * it is tagged with the layer so this pass can hide the whole brain when the layer goes
     * off. The network's group is a child of that holder, so hiding it by the same rule turned
     * off the very thing this look exists to show, and the picture came back empty. */
    const hideSurface = mesh.isMesh && layer === 'brain' && app.brainLook === 'neurons';
    mesh.visible = st.on && !hideSurface
                   && (!layer.startsWith('muscles') || app.showMeshes);
    /* A holder is not a mesh and must stay visible, or the thing hanging off it
     * goes with it -- the brain rides one, and so does every rig segment. */
    if (only && mesh.isMesh) mesh.visible = only.has(mesh);
  }
  if (only) {
    for (const name of LAYER_ORDER) {
      const L2 = layers[name];
      if (!L2.loaded) continue;
      // the group itself has to be open, or the meshes still inside it never draw
      L2.group.visible = true;
      for (const mesh of L2.meshes ?? []) mesh.visible = only.has(mesh);
    }
    for (const mesh of shell.meshes) mesh.visible = false;
    shell.group.visible = false;
  }

  /* The cortex is an additive volume now — see `tissue.js` — so none of the state this used
   * to set applies. It is always DoubleSide, because seeing the far wall through the near one
   * is the whole effect; it never writes depth, because an order-independent blend is what
   * makes that stable; and x-ray is a thickness rather than a mode. */
  /* Both looks are synced through here, and they do not carry the same uniforms. The volume
   * holds its opacity and its drive in the shader; the lit surface has an `opacity` of its own
   * and no notion of drive at all, because nothing in it glows. Writing the tissue's set onto
   * the other one threw on `uOpacity` and took the whole switch down with it — every uniform
   * a look does not have is a uniform this has to skip rather than assume. */
  const bu = brainMat.userData.uniforms;
  if (bu) {
    if (bu.uXray) bu.uXray.value = app.xray;
    /* The colour-code slider is the reader's, in both looks.
     *
     * The solid look forced it to 1 for a while, on the reasoning that a control called
     * "Solid atlas" ought to colour its parcels. That was wrong about what the look is for: a
     * specimen is cream, and the reference this was built against shows exactly that — an
     * opaque natural cortex with real gyral shading and the colour-code slider sitting at
     * zero. Saturated parcels are one thing you can ask that surface to do, not the only
     * thing it is; forcing them took the choice away and made the whole brain a diagram. */
    if (bu.uAtlas) bu.uAtlas.value = app.atlas;
    if (bu.uActivity) bu.uActivity.value = app.activity;
    if (bu.uOpacity) bu.uOpacity.value = app.layers.brain.opacity;
    else brainMat.opacity = app.layers.brain.opacity;
    /* Cutaway is a real clipping plane and it has to be handed to the material that is
     * actually drawing. The body layers get theirs in the loop above, which skips the brain,
     * so the cortex was the one surface in the scene a cutaway could not touch. It only means
     * anything on a surface with an inside — the volume look has no inside to expose, and
     * clipping an additive integral removes the near wall and leaves the far one glowing. */
    const solid = app.brainLook === 'anatomical';
    const clip = solid && app.cutaway ? [clipPlane] : null;
    if ((brainMat.clippingPlanes ?? null) !== clip) {
      brainMat.clippingPlanes = clip;
      // the cut face has to be filled from the inside, or the cortex is a hollow shell
      brainMat.side = clip ? THREE.DoubleSide : THREE.DoubleSide;
      brainMat.needsUpdate = true;
    }
    /* Opaque means opaque *pass*, not merely alpha 1.
     *
     * A transparent material is drawn in the sorted pass and does not write depth first, so
     * with the specimen marked transparent the additive network sorted in front of it and its
     * threads showed straight through a solid brain. It is only transparent when it actually
     * needs to be — the moment x-ray or the layer's own opacity asks for it — and opaque the
     * rest of the time, which is the same rule the body layers use. */
    if (!bu.uOpacity) {
      const wantAlpha = app.xray > 0.001 || app.layers.brain.opacity < 0.999;
      if (brainMat.transparent !== wantAlpha) {
        brainMat.transparent = wantAlpha;
        brainMat.needsUpdate = true;
      }
    }
  }
  /* Only when the network has cells there. The cells come out of the cortex, so a subcortical
   * structure has none — and `setSelected` dims everything that is not the selection, so
   * choosing the thalamus dimmed the whole network and lit nothing at all. */
  const selBrain = app.selected != null && get(app.selected)?.layer === 'brain';
  neuralNet?.setSelected(selBrain && neuralNet.hasRegion(app.selected) ? app.selected : -1);
  neuralNet?.setActivity(app.activity);

  if (brainDeep) {
    // the deep structures are surfaces too, and the cells-only look has none of those either
    const showInterior = app.layers.brain.on && app.brainLook !== 'neurons';
    for (const g of brainDeep.children) {
      const id = g.userData.regionId;
      /* Isolation reaches in here too.
       *
       * This loop writes `m.visible` from an opacity of its own, and it runs *after* the
       * isolation pass above — so isolating an artery hid every mesh in the body and then
       * this put the cerebellum, the brainstem and the six subcortical structures straight
       * back, and the picture was one small vessel in front of a whole brain. They are the
       * meshes this file gave a material to, so they are the meshes it has to hide. */
      const isolatedOut = !!app.isolate?.size && !app.isolate.has(+id);
      const interior = INTERIOR_IDS.has(id);
      const sel = app.selected != null && +id === +app.selected;
      /* The core never goes out.
       *
       * It used to: an interior structure was drawn at opacity 0 unless x-ray was up or it
       * was selected, because it was a solid hidden inside an opaque shell and showing it
       * would have meant drawing it *over* the cortex. The cortex is a volume now, so the
       * deep structures show through it at whatever brightness they are given — and the light
       * coming out of the middle of the head is the thing that makes the organ look alive.
       * X-ray and selection raise it rather than switching it on. */
      /* This overwrites the opacity the material was built with, so it is the only place the
       * core's brightness is actually decided — setting it at construction and again here is
       * how it ended up eight times too bright, a white hole where the deep structures are. */
      const deepBase = 0.10 + app.xray * 0.30;
      let o = interior ? (sel ? 0.55 : deepBase) : (0.30 + app.xray * 0.35);
      if (!sel && app.selected != null && !app.autoSelected) o *= interior ? 0.45 : 0.25;
      o *= showInterior && !isolatedOut ? app.layers.brain.opacity : 0;
      g.traverse(m => {
        if (!m.isMesh) return;
        m.material.opacity = o; m.visible = o > 0.01;
        m.material.clippingPlanes = app.cutaway ? [clipPlane] : null;
      });
      tintStructure(g, { selected: sel, atlas: app.atlas });
    }
  }
  /* Nothing to pick out when there is nothing to pick it out from.
   *
   * The selection highlight is a signal colour mixed over the structure's own — it exists so
   * one muscle can be found among four hundred that are all the same red. Isolated, that
   * muscle *is* the picture, and the highlight turned a specimen into a blue-white ghost:
   * the one view whose whole job is to show what a structure actually looks like was the one
   * view that did not show it. So while everything drawn is what the reader asked for, the
   * highlight stands down and the surface is the surface. */
  const soloLit = app.isolate?.size && app.selected != null && app.isolate.has(app.selected)
    && app.isolate.size === 1;
  for (const m of materials) {
    const u = m.userData.uniforms;
    if (u) {
      u.uSelected.value = soloLit ? -1 : (app.selected ?? -1);
      u.uHover.value = app.hover ?? -1;
    }
  }
  /* Last, because everything above is what decides it: the layer toggles, the
   * mesh switch, the isolate set. A merged layer has no `mesh.visible` of its
   * own, so this is where that decision reaches it. */
  applyShown();
}

/* ------------------------------------------------------------- seeing inside
 *
 * A structure buried in a body cannot be shown by making what is in front of it
 * translucent. That is what x-ray does and it is the right control for "what is
 * the layer under this one"; it is the wrong one for "where is this". Four
 * hundred overlapping translucent shells is a milky haze, and the aortic valve
 * behind the sternum behind the ribs behind the pectoralis is no more findable
 * at full x-ray than at none — which is exactly what was reported, with a
 * picture of it.
 *
 * So the answer is not to take things away. It is to draw the one structure the
 * reader asked about **again, afterwards, with the depth test off**, so it is
 * never behind anything. The body stays as it was and the structure sits in it
 * where it belongs, visible through whatever is in the way. It is what a reader
 * means by "show me where it is", and it is one extra draw call.
 *
 * The clone shares the geometry — no second copy of anything — and wears a
 * material whose only difference is `uOnly`, which sends every vertex that is
 * not this structure's outside the clip volume. A skinned clone is bound to the
 * same skeleton, so it deforms with the body; a rigid one is parented to the
 * same bone.
 */
let revealGroup = null;
const revealMats = new Map();

function revealMaterial(layer) {
  let mat = revealMats.get(layer);
  if (mat) return mat;
  mat = makeStructureMaterial(palette, LOOK[layer] ?? {}, dqUniform);
  /* Through everything, and never into the depth buffer: this is a marker on the
   * picture rather than a thing in the scene, and letting it write depth would
   * put whatever draws after it behind a structure that is not really in front. */
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.transparent = true;
  mat.opacity = 0.92;
  mat.side = THREE.DoubleSide;
  revealMats.set(layer, mat);
  materials.push(mat);
  return mat;
}

/**
 * Draw the selected structure over the body, or stop drawing it.
 *
 * Rebuilt on a change of selection rather than per frame: a selection changes
 * when somebody clicks, and the clones are cheap but not free.
 */
function revealSelection() {
  if (revealGroup) {
    for (const m of revealGroup) m.parent?.remove(m);
    revealGroup = null;
  }
  const id = app.selected;
  /* Not while the body is apart — every piece is already in the open, and a
   * second copy of one drawn through the sheet would be the only thing on it
   * that ignores the layout. Not while it is the only thing drawn either. */
  if (!app.reveal || id == null || app.explode > OPENED || app.isolate?.size) {
    invalidate();
    return;
  }
  const r = get(id);
  if (!r || !app.layers[r.layer]?.on) { invalidate(); return; }
  const made = [];
  for (const name of LAYER_ORDER) {
    const L2 = layers[name];
    if (!L2?.loaded || !app.layers[name]?.on) continue;
    /* Never the brain. The same rule `syncLayers` states: the cortex is not a
     * body layer and nothing written for one can describe it.
     *
     * `revealMaterial` builds a *structure* material, which displaces each
     * vertex by an offset looked up from its `_region`. On a body layer those
     * are structure ids and the offsets are where the catalogue puts them. On
     * the cortex they are Desikan-Killiany parcel ids, which index that table
     * as meaningless numbers -- so every vertex of the chosen parcel was thrown
     * somewhere unrelated and the triangles between them stretched into a
     * striped slab hanging in the middle of the head. That is what "what the
     * hell happened to my brain view" was looking at.
     *
     * It has nothing to reveal in any case. The reveal pass exists to draw a
     * structure through the *body* that covers it; a chosen brain region is
     * already lit by the palette, in whichever of the three looks is up, and
     * those looks are the brain's own answer to seeing inside it. */
    if (name === 'brain') continue;
    const mat = revealMaterial(name);
    const u = mat.userData.uniforms;
    if (u?.uOnly) u.uOnly.value = id;
    mat.userData.sync?.();
    const drawables = L2.merged?.length ? L2.merged
                    : (L2.meshes ?? []).filter(m => regionsOfMesh(m).has(id));
    for (const src of drawables) {
      if (src.userData.regions && !src.userData.regions.has(id)) continue;
      if (!src.userData.regions && !regionsOfMesh(src).has(id)) continue;
      const clone = src.isSkinnedMesh
        ? new THREE.SkinnedMesh(src.geometry, mat)
        : new THREE.Mesh(src.geometry, mat);
      if (src.isSkinnedMesh) clone.bind(src.skeleton, src.bindMatrix);
      else { clone.position.copy(src.position); clone.quaternion.copy(src.quaternion);
             clone.scale.copy(src.scale); }
      clone.frustumCulled = false;
      clone.renderOrder = 20;              // after the body, before the labels
      clone.userData = { layer: name, reveal: true };
      (src.parent ?? scene).add(clone);
      made.push(clone);
    }
  }
  revealGroup = made.length ? made : null;
  invalidate();
}

/** Which structures one un-merged mesh carries. */
function regionsOfMesh(mesh) {
  const own = restByMesh.get(mesh);
  if (own) return new Set(own.keys());
  const one = mesh.userData.regionId;
  return new Set(one == null ? [] : [one]);
}

/** Show the chosen structure through the body, or do not. */
export function setReveal(on) {
  app.reveal = !!on;
  revealSelection();
  ui?.syncControls?.();
}
export const revealOn = () => !!app.reveal;
/** How many reveal clones are in the scene, for a test. */
export const revealCount = () => revealGroup?.length ?? 0;

/* ------------------------------------------------- where a structure is now
 * `app.centroids`, `app.anchors` and `app.radii` are measured once, at load, in the rest
 * pose. That is the only pose in which every structure has been seen, so it is the right
 * place to measure them — but it is not where they are once the rig moves. Reading them raw
 * is what pointed every leader rope at empty space during an exercise.
 *
 * The correction is one matrix per segment: `body.matrixWorld * bindInverse` is exactly the
 * transform that segment applies to its own vertices, so putting a rest-pose point through
 * it lands the point where the pose has taken it. The same matrix serves a rigidly attached
 * mesh and a skinned one, because a rigid attach preserves the bind-pose local transform and
 * a skinned mesh's dominant bone is the segment it was recorded under.
 */
const _delta = new THREE.Matrix4();

function deltaFor(segment) {
  const recNode = rig?.nodes.get(segment);
  const bind = rig?.bind?.get(segment);
  if (!recNode || !bind) return null;
  return _delta.multiplyMatrices(recNode.body.matrixWorld, bind);
}

/**
 * Bring the indexed centroids forward to the current pose, and with them the bounding
 * spheres the raycaster tests.
 *
 * Rigid bodies, so a bind-pose point moves by exactly its segment's delta matrix — there is
 * no need to re-scan geometry, which would be far too slow while a clip is playing. Nothing
 * is allocated here: this runs on every frame of playback, and seven hundred structures
 * worth of fresh vectors per frame is enough garbage to be visible in the frame time.
 *
 * The anchors are deliberately *not* done here. There are up to forty per structure and only
 * a dozen labels are on screen at once, so they are transformed on demand in `anchorFor`.
 */
const _acc = new Map();         // region id -> { sum: Vector3, n: number }, reused each pose
function refreshPosed() {
  invalidate();
  if (!rig?.bind) return;
  for (const e of _acc.values()) { e.sum.set(0, 0, 0); e.n = 0; }
  for (const [mesh, b] of bound) {
    const m = deltaFor(b.segment);
    if (!m) continue;
    /* The raycaster tests a skinned mesh's bounding sphere before it looks at a triangle,
     * and that sphere describes the rest pose: recomputing it properly walks every vertex
     * through four bone matrices, far too slow for three hundred meshes on a pointer move.
     * It rides the dominant bone and is inflated instead. `test/skin.test.mjs` holds a posed
     * muscle under 2.2x its rest size; the margin here is wider than that on purpose. */
    const rs = mesh.userData.restSphere;
    if (rs && mesh.boundingSphere) {
      mesh.boundingSphere.center.copy(rs.c).applyMatrix4(m);
      mesh.boundingSphere.radius = rs.r * PICK_MARGIN;
    }
    const own = restByMesh.get(mesh);
    if (!own) continue;
    for (const [id, e] of own) {
      let a = _acc.get(id);
      if (!a) _acc.set(id, a = { sum: new THREE.Vector3(), n: 0 });
      a.sum.add(_p2.copy(e.c).applyMatrix4(m)); a.n++;
    }
  }
  for (const [id, a] of _acc)
    if (a.n && app.centroids[id]) app.centroids[id].copy(a.sum).divideScalar(a.n);
}
const _p2 = new THREE.Vector3();

/**
 * The side of a structure the camera is already nearest, posed.
 *
 * A paired structure is one region id over two meshes, and the midpoint between them is
 * inside the body: aiming a camera there to look at "the fifth metacarpal" puts it in the
 * middle of the ribcage with both hands off the edges of the frame, which is what happened.
 * Showing one hand is what the request meant.
 */
function posedSide(id) {
  let best = null, bestD = Infinity;
  for (const mesh of meshesOfId.get(id) ?? []) {
    const own = restByMesh.get(mesh)?.get(id);
    if (!own) continue;
    const b = bound.get(mesh);
    const m = b ? deltaFor(b.segment) : null;
    const c = own.c.clone();
    if (m) c.applyMatrix4(m);
    const d = camera.position.distanceToSquared(c);
    if (d < bestD) {
      bestD = d;
      best = { centre: c, points: own.pts.map(p => (m ? p.clone().applyMatrix4(m) : p.clone())) };
    }
  }
  return best;
}

/**
 * Where a structure is actually drawn — posed, and then taken apart.
 *
 * `posedSide` answers where a structure stands in the body. While the body is a body those
 * are the same question, and every camera flight, every label anchor and the pointer all
 * asked it. Taking the body apart makes them different questions, and the one nobody was
 * asking is the one that matters: the shader moves each piece to its cell in the catalogue
 * and scales it to fit, and none of that is in the geometry. So flying to a structure picked
 * out of the sheet flew to where that structure would be standing if the body were still
 * assembled — for an artery of the parietal lobe, inside the head, with the brain filling the
 * frame and the artery itself somewhere off in the grid. That is the whole of "it is still
 * not choosing properly".
 *
 * This applies the same two steps the vertex shader applies, in the same order. The shader
 * works in view space and this works in world space, which is the same transform: the view
 * matrix is a rotation and a translation, so scaling about a point and translating are both
 * unchanged by it.
 */
const _exC = new THREE.Vector3(), _exO = new THREE.Vector3();
/**
 * How far this structure has been moved and shrunk, right now.
 *
 * The palette is the shader's copy of the answer and it is the answer for almost everything.
 * The exception is a structure that shares a mesh with others — a cortical parcel — whose
 * palette entry is deliberately zeroed so no shader tears the sheet it is painted on, and
 * whose real displacement belongs to the mesh. See `liftWholeMeshes`.
 */
function explodeFor(id) {
  const w = wholeById.get(id);
  const scale = w ? w.scale : palette.getScale(id);
  if (w) _exC.copy(w.centre), _exO.copy(w.off);
  else palette.getScaleCentre(id, _exC), palette.getOffset(id, _exO);
  _exO.multiplyScalar(app.explode);
  return 1 + (scale - 1) * app.explode;
}
/** Apply it to a point, in place. `explodeFor` must have been called for the same id. */
const applyExplode = (p, k) => p.sub(_exC).multiplyScalar(k).add(_exC).add(_exO);

function drawnSide(id) {
  const side = posedSide(id);
  if (!side || app.explode <= 0) return side;
  const k = explodeFor(id);
  return { centre: applyExplode(side.centre, k),
           points: side.points.map(p => applyExplode(p, k)) };
}

/** The same, for a structure with no mesh of its own to measure — the centroid alone. */
function drawnPoint(id, target = new THREE.Vector3()) {
  const c = app.centroids[id];
  if (!c) return null;
  target.copy(c);
  if (app.explode <= 0) return target;
  return applyExplode(target, explodeFor(id));
}

/* ------------------------------------------------------------------ labels */
/* LAB_MAX must match `.lab3d`'s max-width in index.html. The lane is placed from the width
 * the label reports, so a cap here that is smaller than the stylesheet's lets a label run
 * past the edge of the stage — the same failure the `.act` class collision caused once. */
/**
 * How much of the right-hand edge the floating console covers.
 *
 * The panel used to be a grid column, which is why the lane could be placed at the stage's
 * full width: nothing was over it. Now the stage runs the whole window and the console floats
 * on top, so the lane has to stop where the glass starts — measured from the element rather
 * than written down, because its width is a clamp against the viewport and a constant here
 * would be wrong at two thirds of the sizes it takes.
 */
function panelInset() {
  /* The rail is always there and the panel only sometimes, so the lane is measured
   * against whichever is further left. A panel that is closed reserves nothing:
   * the labels used to give up a third of the stage to a console that was not on
   * screen, because the element existed whether or not it was shown. */
  /* Measured off the box, never off `offsetParent`.
   *
   * `offsetParent === null` was standing in for "not on screen", and for a `position: fixed`
   * element it is *always* null — which both of these are. So the test threw away the panel
   * and the rail whether they were open or not, this returned 10 pixels every time, and the
   * label lane has been running underneath the console since the console started floating:
   * a plate for a structure on the right of the subject was laid out into space that is
   * behind glass, and its name was simply not readable. A closed panel is caught by `hidden`
   * and by having no width, which is what the guard was for. */
  const c = canvas.getBoundingClientRect();
  let left = c.right;
  for (const id of ['panel', 'rail']) {
    const el = document.getElementById(id);
    if (!el || el.hidden) continue;
    if (getComputedStyle(el).display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.top > c.bottom - 4 || r.bottom < c.top + 4) continue;
    left = Math.min(left, r.left);
  }
  return Math.max(0, c.right - left + 10);
}
const LAB_H = 24, LAB_GAP = 7, LANE_PAD = 13, MAX_PER_SIDE = 8, LAB_MAX = 300, MIN_PX = 26;
/** How many candidates get a real anchor. Comfortably more than the 2 x MAX_PER_SIDE placed. */
const SHORTLIST = 28;
/* Clear air between the subject's own silhouette and the nearest edge of a plate. A leader
 * rope has to look like it connects a name to a thing; the gutter is what stops the plate
 * sitting on top of the thing, and everything past it is wasted line. */
const LANE_GUTTER = 44;
/* A label leaves at three quarters of the size it needs to arrive, so one sitting on the
 * threshold does not blink, and it slides to a new row rather than jumping to it. */
const MIN_PX_KEEP = 0.75, LAB_EASE = 0.22;
/** Role -> the singular string for the tag on a label. The panel's headings are plural. */
const ROLE_TAG = { prime: 'roleTagPrime', synergists: 'roleTagSyn', stabilisers: 'roleTagStab' };
let labels = [], labelLayer = null;

function buildLabelEls() {
  labelLayer = document.getElementById('labels');
  if (!labelLayer.querySelector('#leaders')) {
    labelLayer.innerHTML = '<svg id="leaders"></svg>';
    labels = [];
    /* A name plate takes a click and never a drag.
     *
     * The plates are buttons over the stage, so they take the pointer — which is right for
     * clicking a name and wrong for everything else: starting a pan or an orbit on one did
     * nothing at all, and there is no way to tell from the screen that the twelve small
     * rectangles floating over the picture are holes in it. It reads as the navigation
     * failing at random, because from the reader's side that is exactly what it is.
     *
     * So anything but a plain left press is handed straight to the canvas: the layer stops
     * taking events for the length of the gesture and the press is re-dispatched to the
     * control that should have had it. A left click still selects the structure named. */
    labelLayer.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      labelLayer.style.pointerEvents = 'none';
      const done = () => {
        labelLayer.style.pointerEvents = '';
        removeEventListener('pointerup', done);
        removeEventListener('pointercancel', done);
      };
      addEventListener('pointerup', done);
      addEventListener('pointercancel', done);
      canvas.dispatchEvent(new PointerEvent('pointerdown', e));
    }, true);
  }
  const have = new Set(labels.map(l => l.id));
  for (const id of Object.keys(app.centroids).map(Number)) {
    if (have.has(id) || !get(id)) continue;
    /* A record, and no elements.
     *
     * Sixteen names are ever on screen — eight a lane — and this used to build a button, a
     * ring, a leader path and two spans for **every structure in the atlas**: 2,087 of them,
     * 10,712 DOM nodes, all but a dozen of them permanently invisible. The browser still owns
     * every one: style recalculation walks them, the SVG carries two thousand paths, and the
     * memory is held for the life of the page. On the machine this is meant to run on that is
     * a real share of why it stopped answering.
     *
     * The state each label carries between frames — which lane it settled in, where it eased
     * to, the width its text measured — is a handful of numbers and stays here. The elements
     * are borrowed from a pool when a label is actually placed, and given back when it is
     * not. Nothing about which names appear changes; `updateLabels` still ranks every
     * structure and still places the same sixteen. */
    labels.push({ id, el: null, dot: null, rope: null, nameEl: null, roleEl: null,
                  side: null, text: null, role: null, w: null, hidden: true });
  }
}

/**
 * The elements a placed label borrows.
 *
 * Comfortably more than the sixteen that can be placed, so a label keeps its own elements
 * across frames while it stays on screen and the DOM does not churn every time the body
 * turns. Past that the least recently placed gives its set up.
 */
const LABEL_POOL = 40;
const livePlates = [];
function attachEls(l) {
  if (l.el) { markUsed(l); return l; }
  const svg = document.getElementById('leaders');
  if (!svg) return l;
  if (livePlates.length >= LABEL_POOL) {
    // the least recently placed, which by construction is not on screen
    const old = livePlates.shift();
    if (old && old !== l) detachEls(old);
  }
  const el = document.createElement('button');
  el.className = 'lab3d';
  el.onclick = (e) => { e.stopPropagation(); selectStructure(l.id); };
  /* Two nodes, not one string. The name is the label; the role tag is a second, dimmer
   * field that appears only on a muscle the loaded exercise actually works, which is a
   * handful of the four hundred rather than all of them. Keeping them separate is also
   * what lets the width be re-read when either changes without re-reading it every frame. */
  // so a test can ask what a label on screen is pointing at, without reaching into `labels`
  el.dataset.id = String(l.id);
  const nameEl = document.createElement('span');
  nameEl.className = 'labname';
  const roleEl = document.createElement('span');
  roleEl.className = 'labrole';
  el.append(nameEl, roleEl);
  const dot = document.createElement('div');
  dot.className = 'labdot';
  const rope = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rope.setAttribute('fill', 'none');
  rope.setAttribute('stroke-width', '0.75');   // hairline: a leader line, not a connector
  svg.appendChild(rope); labelLayer.appendChild(dot); labelLayer.appendChild(el);
  Object.assign(l, { el, dot, rope, nameEl, roleEl, text: null, role: null, w: null });
  livePlates.push(l);
  return l;
}
function detachEls(l) {
  l.el?.remove(); l.dot?.remove(); l.rope?.remove();
  l.el = l.dot = l.rope = l.nameEl = l.roleEl = null;
  l.text = l.role = l.w = null;
  l.hidden = true;
}
function markUsed(l) {
  const at = livePlates.indexOf(l);
  if (at >= 0 && at !== livePlates.length - 1) {
    livePlates.splice(at, 1);
    livePlates.push(l);
  }
}

/**
 * Labels size themselves; nothing computes a width and imposes it.
 *
 * Both earlier attempts got this wrong in the same way, from opposite directions. Measuring
 * a hidden DOM twin trusts shrink-to-fit at the exact moment it is read. Measuring with
 * canvas measureText looked safer but was worse: Chromium's canvas font parser rejects the
 * stylesheet's `system-ui, -apple-system, ...` stack outright, silently leaves ctx.font at
 * its `10px sans-serif` default, and every label came back about 12% too narrow and clipped
 * mid-word — a wrong answer that looks like a right one.
 *
 * So the element gets `width:auto` and a max-width rail in CSS, and the only thing read back
 * is `offsetWidth`, used to place the right-hand lane. A stale read there shifts a label a
 * few pixels sideways for one frame. It can no longer truncate anything.
 */

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _ap = new THREE.Vector3();
const _s = new THREE.Vector3();
/* The surface points `anchorFor` just walked, flat and reused, so the caller can ask how wide
 * the structure is on screen without walking them a second time or allocating. Valid only
 * until the next call, which is how it is used. */
const _pts = [];
/**
 * The surface point a leader rope lands on: the one nearest the camera, brought forward to
 * the current pose.
 *
 * The anchors were measured at load in the rest pose and used to be read raw, so during an
 * exercise every rope pointed at where the structure had been standing — a line drawn from
 * a label to nothing, which is exactly what a rope must never be.
 */
const _off = new THREE.Vector3();
const _lp = new THREE.Vector3();
/**
 * Roughly where a structure is, for deciding whether to name it at all.
 *
 * The centroid, carried out to wherever the body being apart has put it -- the same
 * displacement `anchorFor` applies, and the only part of it that is not cheap to
 * compute. Used to rank and reject; never used to place anything.
 */
function labelPoint(id) {
  _lp.copy(app.centroids[id] ?? _ORIGIN);
  if (app.explode > 0) applyExplode(_lp, explodeFor(id));
  return _lp;
}
const _ORIGIN = new THREE.Vector3();

function anchorFor(id) {
  _pts.length = 0;
  /* The shader moves a structure by its palette offset when the body is taken
   * apart, and the geometry the anchors were measured from does not move with
   * it. Without this every label went on pointing at where its structure used to
   * stand: laid out as a catalogue, four hundred ropes converged on the middle
   * of an empty grid, which is exactly what the picture showed. */
  /* Scaled as well as displaced. A catalogue shrinks a femur to a cell and blows a sesamoid up
   * to one, and an anchor that only carried the displacement landed a rope at where the piece
   * would have reached at full size — outside its cell, over its neighbours. `explodeFor`
   * loads the same transform `drawnSide` uses, so the rope ends on the shape it names. */
  const k = app.explode > 0 ? explodeFor(id) : 0;
  const spread = app.explode > 0;
  const owners = meshesOfId.get(id);
  if (!owners?.length) {
    _a.copy(app.centroids[id]);
    return spread ? applyExplode(_a, k) : _a;
  }
  let bestD = Infinity;
  _a.copy(app.centroids[id]);
  if (spread) applyExplode(_a, k);
  for (const mesh of owners) {
    const b = bound.get(mesh);
    const m = b ? deltaFor(b.segment) : null;
    const own = restByMesh.get(mesh)?.get(id);
    if (!own) continue;
    for (const p of own.pts) {
      _ap.copy(p);
      if (m) _ap.applyMatrix4(m);
      if (spread) applyExplode(_ap, k);
      _pts.push(_ap.x, _ap.y, _ap.z);
      const d = camera.position.distanceToSquared(_ap);
      if (d < bestD) { bestD = d; _a.copy(_ap); }
    }
  }
  return _a;
}

/** The structure's record when its name may be drawn at all, otherwise null. */
function labelVisible(id) {
  const r = get(id);
  if (!r) return null;
  /* No plates over a catalogue. Every piece in one is its own shape in its own
   * cell with nothing behind it, so a floating name on a leader rope names what
   * is already unambiguous -- and eighteen of them, in two columns at the edges
   * with ropes across the whole sheet, were the messiest thing in the picture.
   * Pointing at a piece still names it, and clicking it still opens its card. */
  if (app.explode > OPENED && app.explodeLayout === 'inventory'
      && app.selected !== id) return null;
  /* Isolation first, and before the selected-structure shortcut, because it is the
   * strongest statement a reader can make about what they want to see. Without it,
   * isolating the sacrum left fifteen muscle labels on screen with leader ropes
   * running to structures that were no longer drawn -- the picture said one thing
   * and the labels said another. */
  if (app.isolate?.size) return app.isolate.has(id) ? r : null;
  if (app.selected === id) return r;
  if (app.labelKinds.size && !app.labelKinds.has(r.kind)) return null;
  /* One name, when one structure has been chosen.
   *
   * Clicking a muscle used to leave eighteen other plates on screen, each on a leader rope,
   * and near the top of the frame those ropes all run up toward the head — which is what
   * "why does it show me ... connected to brain" was looking at. It is also simply the wrong
   * answer to the question the click asked: the reader pointed at one thing and wants that
   * thing named, not a lane of everything else that happened to be big enough.
   *
   * The two contexts that outrank it both survive, because in each the reader asked for the
   * other names: an exercise or a group, handled below, names what it activates; and naming
   * a whole system by kind is a standing request that a later click does not cancel. */
  if (app.selected != null && !app.exercise && !app.group && !app.labelKinds.size) return null;
  if (!app.layers[r.layer]?.on) return null;
  if (r.interior && app.xray === 0) return null;
  // during an exercise the muscles in the movement are the point of the picture,
  // and a chosen group is the same request said a different way
  if (app.exercise || app.group) return activation.has(id) ? r : null;
  return r;
}

function updateLabels() {
  if (!labels.length) return;
  const h = canvas.clientHeight;
  const wFull = canvas.clientWidth;
  // the lane's right edge, which is the console's left edge rather than the canvas's
  const w = wFull - panelInset();
  const projScale = h / (2 * Math.tan(camera.fov * Math.PI / 360));
  const cand = [], rough = [];
  for (const l of labels) {
    const r = app.labelsOn ? labelVisible(l.id) : null;
    if (!r) { hide(l); continue; }
    /* The centroid first, and the real anchor only for the ones that survive.
     *
     * `anchorFor` walks up to forty surface points through a bone matrix each, and
     * this loop runs once per frame per structure. At two thousand structures that
     * was 8.6 ms a frame -- more than the whole render -- to decide which sixteen
     * names to draw, when fifteen hundred of them are rejected on size or on being
     * off screen and never needed an anchor at all. The centroid is a cheap stand-in
     * for that decision and the true anchor is computed below, for the survivors,
     * so where a plate actually lands is unchanged. */
    const at = labelPoint(l.id);
    const distSq = camera.position.distanceToSquared(at);
    const sel = app.selected === l.id;
    const act = activation.has(l.id);
    /* Two thresholds, not one. A structure sitting exactly on the bar crosses it several
     * times a second as the body moves, and a label that blinks is harder to read than one
     * that is simply absent: it has to grow past MIN_PX to appear and shrink well under it
     * to leave again. */
    const bar = l.hidden ? MIN_PX : MIN_PX * MIN_PX_KEEP;
    const rad = app.radii[l.id] ?? 0.01;
    /* Sized before it is projected, and against a squared distance, and that order is most
     * of the cost of this loop.
     *
     * How big a structure is on screen needs only its distance from the camera; where it is
     * on screen needs the projection matrix. With the whole atlas on, two thousand of these
     * are rejected on size and about twenty survive — so projecting first meant two thousand
     * matrix multiplies a frame to throw away nineteen hundred and eighty of them, and it
     * was 4.5 ms, more than half the render. The comparison itself is rearranged the same
     * way: `rad / dist * projScale < bar` is `dist > rad * projScale / bar`, which is a
     * multiply rather than a division and can be tested squared, so the two thousand that
     * fail cost no square root either. Nothing about which labels appear changes — the bar
     * does not depend on the projection, so testing it earlier tests the same thing. */
    const reach = rad * projScale / bar;
    if (!sel && !act && distSq > reach * reach) { hide(l); continue; }
    const dist = Math.sqrt(distSq);
    const px = rad / Math.max(0.001, dist) * projScale;
    _v.copy(at).project(camera);
    if (_v.z > 1) { hide(l); continue; }
    /* Canvas pixels, not lane pixels.
     *
     * This is drawn: the dot is positioned at `ax` and the rope ends there, both in the
     * label layer, which is the size of the *canvas*. Scaling by the lane's width instead —
     * the canvas minus whatever the console covers — squashed every anchor toward x = 0 by
     * the ratio between them. On a 1848-wide window with a 400-wide console that is 0.78, so
     * a ring belonging to a structure at x 881 was drawn at 690: nearly two hundred pixels
     * away, on a different part of the brain. Every rope pointed at the wrong place, and it
     * got worse the further right the structure was and the wider the window.
     *
     * The lane's width still matters, but only for placing the *plate*, which must stop
     * short of the glass. That is `w`, applied where the plate is positioned. */
    const ax = (_v.x * 0.5 + 0.5) * wFull, ay = (-_v.y * 0.5 + 0.5) * h;
    /* A rope to an anchor that is off the edge of the picture is a line running out of
     * frame, which says nothing about which structure the name belongs to. Flying to one
     * structure puts most of the body outside the viewport, so without this the lanes fill
     * with names for things that are not on screen. */
    /* Against the *canvas*, not the lane: a structure whose anchor happens to project under
     * the console is still on screen and still worth naming — only its plate has to stop
     * short of the glass. */
    if (app.selected !== l.id && (ax < 0 || ax > wFull || ay < 0 || ay > h)) { hide(l); continue; }
    // the role itself, for the tag on the plate. `act` stays a boolean: it is sorted on
    // arithmetically two lines down and tested as a flag above.
    const role = activation.get(l.id) ?? null;
    // A structure with a written entry outranks one without. Without this the lanes fill
    // with metacarpals and phalanges: they are small but close to the camera, so their
    // projected size beats every trunk muscle in the picture.
    const told = !!(r.muscle || r.kind === 'brain');
    /* How wide this structure is on screen, from the surface points `anchorFor` just walked.
     * Done here rather than above the bar so it runs for the dozen labels that will be placed
     * rather than for all four hundred that will not.
     *
     * The lanes need this and not the anchor alone. An anchor is one point on one parcel and
     * the subject reaches well past the outermost of them: sized from the anchors the right
     * lane landed on the occipital lobe, and sized from anchor ± the structure's own radius
     * it still did, because a parcel's radius does not know about the cerebellum below it. */
    rough.push({ l, r, sel, act, role, told, px, ax, ay });
  }
  /* Ranked on the cheap proxy, then anchored -- and only the top of the list is
   * anchored at all.
   *
   * Sixteen plates are ever placed, eight a side. Walking every surviving
   * structure's forty surface points through a bone matrix to rank them was six
   * milliseconds a frame with the whole atlas on, to throw almost all of it away.
   * `SHORTLIST` is generously more than can be placed, so which sixteen win is
   * decided by exactly what decided it before. */
  rough.sort((a, b) => (b.sel - a.sel) || (b.act - a.act) || (b.told - a.told) || (b.px - a.px));
  for (const c of rough.slice(SHORTLIST)) hide(c.l);
  for (const c of rough.slice(0, SHORTLIST)) {
    /* The real anchor. `anchorFor` fills `_pts` as a side effect, which is what the
     * width below is measured from, so this both places the plate and sizes the lane. */
    _s.copy(anchorFor(c.l.id)).project(camera);
    c.ax = (_s.x * 0.5 + 0.5) * wFull;
    c.ay = (-_s.y * 0.5 + 0.5) * h;
    let x0 = c.ax, x1 = c.ax;
    for (let i = 0; i < _pts.length; i += 3) {
      _s.set(_pts[i], _pts[i + 1], _pts[i + 2]).project(camera);
      if (_s.z > 1) continue;
      const sx = (_s.x * 0.5 + 0.5) * wFull;
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
    }
    c.x0 = x0; c.x1 = x1;
    cand.push(c);
  }

  /* Stable lanes. Choosing the side from live screen position makes every label hop
   * sideways as the model turns; a label keeps its side until its anchor crosses well past
   * centre, and the vertical order comes from the anatomy rather than the camera.
   *
   * Centre means the *subject's* centre, not the stage's. Now that the figure is fitted to
   * the stage the console leaves rather than to the whole window, it no longer sits on the
   * stage's midline — and splitting on the midline put every one of its anchors on the same
   * side, so one lane carried twenty names and the other was empty. Splitting on the body's
   * own midline is also the more anatomical answer: what is on its left goes left. */
  const mid = cand.length
    ? cand.reduce((a, c) => a + c.ax, 0) / cand.length
    : w / 2;
  for (const c of cand) {
    const want = c.ax < mid ? 'left' : 'right';
    if (!c.l.side) c.l.side = want;
    else if (c.l.side !== want && Math.abs(c.ax - mid) > w * 0.14) c.l.side = want;
  }
  /* Where the lanes go.
   *
   * They used to be pinned to the edges of the stage, which is right only when the subject
   * fills it. On a wide screen it does not: at 1848 x 927 with the head framed, the brain
   * occupied x 390-1000 and the lanes sat at 13 and 1290, so every rope ran four to six
   * hundred pixels across empty space. At that length a leader stops reading as "this name
   * belongs to that structure" and starts reading as a line drawn over the picture — which
   * is exactly what it looked like.
   *
   * So the lane is placed against the *subject*: just outside the spread of its own anchors,
   * clamped to the stage. Rope length becomes a function of how big the subject is on screen
   * rather than of how wide the window happens to be, and when the subject does fill the
   * stage — the whole-body view — the clamp puts the lanes back exactly where they were.
   *
   * The plates are aligned on their *inner* edge, so every rope starts at the same x and the
   * ragged edge is on the outside where nothing attaches to it. */
  /* The spread of the *structures*, from their own projected surface points — see the
   * `x0`/`x1` computed per candidate above for why the anchor alone is not enough. */
  let sx0 = Infinity, sx1 = -Infinity;
  for (const c of cand) { if (c.x0 < sx0) sx0 = c.x0; if (c.x1 > sx1) sx1 = c.x1; }
  if (!cand.length) { sx0 = 0; sx1 = wFull; }
  const laneIn = {
    left:  Math.max(LANE_PAD + 40, Math.min(sx0 - LANE_GUTTER, w * 0.5)),
    right: Math.min(w - LANE_PAD - 40, Math.max(sx1 + LANE_GUTTER, w * 0.5)),
  };

  const lanes = { left: [], right: [] };
  /* A leader rope has to stay readable as a rope. Past about half the viewport it stops
   * reading as "this label belongs to that structure" and starts reading as a line drawn
   * across the picture — which is what a posed figure produces, because the body no longer
   * fills the frame the way a standing one does and the lanes stay pinned to the edges.
   * Rather than move the lanes, drop the labels that cannot reach one.
   *
   * Just over half, not just under. The subject is fitted to the middle of the stage the
   * console leaves, so the longest legitimate rope is half that width plus half the body —
   * inherently more than 0.46 of it. At the old figure every rope to the *far* lane failed
   * the test, so one lane carried every name and the other was empty however the sides were
   * assigned. */
  const MAX_ROPE = Math.max(180, (sx1 - sx0) + LANE_GUTTER * 2);
  for (const c of cand) {
    const side = c.l.side, other = side === 'left' ? 'right' : 'left';
    const lane = lanes[side].length < MAX_PER_SIDE ? side
               : lanes[other].length < MAX_PER_SIDE ? other : null;
    if (!lane) { hide(c.l); continue; }
    if (!c.sel && Math.abs(c.ax - laneIn[lane]) > MAX_ROPE) { hide(c.l); continue; }
    lanes[lane].push(c);
  }
  for (const side of ['left', 'right']) {
    const list = lanes[side];
    /* Ordered by where the anchor is on screen, **quantised to a row**, with the anatomy as
     * the tie-break.
     *
     * Sorting on the raw screen position is what made the names trade places continuously:
     * `app.centroids` is rewritten every frame while a clip plays, so two labels a pixel
     * apart swapped rows several times a second. Sorting on the anatomy alone is stable and
     * produces the crossings, because the rest-pose height of a structure has nothing to do
     * with where the camera has put it — six ropes crossed each other in the head view.
     *
     * Quantising to whole rows takes both: a label has to move a full row's worth before it
     * can change places with its neighbour, which no amount of per-frame jitter does, and
     * within a row the anatomy decides. Reordering is eased rather than snapped, so when a
     * camera move genuinely does reorder them they slide. */
    list.sort((a, b) => Math.round(a.ay / LAB_H) - Math.round(b.ay / LAB_H)
                     || (restY[b.l.id] ?? 0) - (restY[a.l.id] ?? 0));
    const block = list.length * LAB_H + Math.max(0, list.length - 1) * LAB_GAP;
    let y = Math.max(8, (h - block) / 2);
    for (const c of list) { c.y = y; y += LAB_H + LAB_GAP; place(c, side, laneIn[side], w); }
  }
}

function hide(l) {
  // short-circuit: with four hundred structures loaded, almost every label is hidden on
  // any given frame, and re-writing the same styles onto 380 elements every frame is
  // enough style-recalculation work to be visible in the frame time
  if (l.hidden) return;
  l.hidden = true;
  if (!l.el) return;                       // never placed, so it owns nothing to hide
  l.el.style.opacity = 0; l.el.style.pointerEvents = 'none';
  l.dot.style.opacity = 0; l.rope.setAttribute('stroke-opacity', '0');
}

/**
 * @param laneIn the lane's *inner* edge — where the rope attaches. Plates are aligned on it,
 *               so the ropes all start at one x and the ragged edge faces outward.
 * @param w      the lane's own width, for clamping a long plate back inside the stage
 */
function place(c, side, laneIn, w) {
  const { l, r, sel, act, role: actRole } = c;
  attachEls(l);
  if (!l.el) return;
  /* The block is centred on however many labels are in the lane, so one label appearing or
   * leaving moves every other one by half a row. Snapping to the new height is the shudder
   * that reads as the whole list twitching; easing toward it is the same layout, arrived at
   * over a fifth of a second. A label that was hidden starts where it belongs rather than
   * sliding in from wherever it last was. */
  l.y = l.hidden || l.y == null ? c.y : l.y + (c.y - l.y) * LAB_EASE;
  if (Math.abs(c.y - l.y) < 0.4) l.y = c.y;
  c.y = l.y;
  l.hidden = false;
  const text = nameOf(l.id, app.lang);
  /* What the exercise is asking this muscle to do, on the muscle. It is the one field worth
   * carrying onto the picture: it is real — it comes from the record's own role lists, the
   * same three roles the panel prints — it is sparse, because only the muscles a loaded
   * exercise names have one, and it answers the question a lit muscle raises, which is why
   * that one and not its neighbour. Nothing shows here at rest. */
  const roleKey = actRole ? (ROLE_TAG[actRole] ?? null) : null;
  // the rendered string, not the key: the key does not change when the language does
  const role = roleKey ? UI_STR[roleKey][app.lang] : '';
  /* Read the width back only when the text changed. Reading offsetWidth after writing a
   * style forces a synchronous reflow, and doing that for every label on every frame is
   * layout thrashing — it dropped the whole loop to single-digit frames per second, which
   * showed up as camera moves that appeared to hang rather than as a slow page. */
  if (l.text !== text || l.role !== role) {
    l.text = text; l.role = role;
    l.nameEl.textContent = text;
    l.roleEl.textContent = role;
    l.roleEl.style.display = role ? '' : 'none';
    l.el.style.height = LAB_H + 'px';
    l.w = Math.min(l.el.offsetWidth || 120, LAB_MAX);
  }
  const bw = l.w ?? 120;
  const x = side === 'left' ? Math.max(LANE_PAD, laneIn - bw)
                            : Math.min(w - LANE_PAD - bw, laneIn);
  l.el.style.left = x + 'px'; l.el.style.top = c.y + 'px';
  l.el.style.opacity = 1; l.el.style.pointerEvents = 'auto';
  l.el.classList.toggle('sel', sel);
  l.el.classList.toggle('working', !!act);   // not `act` — see .lab3d.working in index.html
  /* The left edge alone, not the whole box. A plate outlined in the structure's own colour
   * is a coloured card floating over the render; a hairline plate with one lit edge is a
   * marker attached to it. Writing `borderColor` set all four sides inline, which beat the
   * stylesheet's hairline and undid exactly that. */
  l.el.style.borderLeftColor = sel || act ? r.color : 'rgba(150,190,235,.34)';
  l.dot.style.left = c.ax + 'px'; l.dot.style.top = c.ay + 'px';
  /* `color`, not `background`: the anchor is a ring with a lit halo — see .labdot — and the
   * halo is drawn from currentColor. Filling the background turned the ring back into the
   * solid disc it replaced, which on translucent tissue reads as a blemish on the specimen
   * rather than a mark placed on it. */
  l.dot.style.color = r.color;
  l.dot.style.opacity = 1;
  const ex = side === 'left' ? x + bw : x;
  const ey = c.y + LAB_H / 2;
  const dx = c.ax - ex;
  l.rope.setAttribute('d',
    `M ${ex.toFixed(1)} ${ey.toFixed(1)} C ${(ex + dx * 0.45).toFixed(1)} ${ey.toFixed(1)},` +
    ` ${(c.ax - dx * 0.25).toFixed(1)} ${c.ay.toFixed(1)}, ${c.ax.toFixed(1)} ${c.ay.toFixed(1)}`);
  l.rope.setAttribute('stroke', sel || act ? r.color : 'rgba(168,200,236,.55)');
  /* Quieter at rest than it was. A dozen ropes at 0.4 read as a web over the specimen; at
   * 0.30 they read as annotation and the one you selected is unmistakably brighter. 0.22 was
   * a step too far: against the cortex's own value the leader disappeared entirely and the
   * plates read as captions floating beside the picture rather than as marks on it. */
  l.rope.setAttribute('stroke-opacity', sel ? '0.95' : act ? '0.75' : '0.30');
}

/**
 * The stage as one image, labels and ropes included.
 *
 * preserveDrawingBuffer is what lets the WebGL buffer still be read after the frame is
 * presented; without it drawImage yields a blank rectangle. The labels are HTML, absent
 * from that buffer entirely, so they are drawn onto the 2D canvas separately — the ropes as
 * Path2D from the same path data already on screen, so the printed figure is the one you
 * were looking at rather than a re-derivation.
 */
export function captureStage(scale = 2) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale); out.height = Math.round(h * scale);
  const ctx = out.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(canvas, 0, 0, w, h);
  for (const l of labels) {
    // a label that was never placed owns no elements at all -- see `attachEls`
    if (!l.el || l.el.style.opacity !== '1') continue;
    const d = l.rope.getAttribute('d');
    if (d && l.rope.getAttribute('stroke-opacity') !== '0') {
      ctx.save();
      ctx.strokeStyle = l.rope.getAttribute('stroke');
      ctx.globalAlpha = parseFloat(l.rope.getAttribute('stroke-opacity')) || 1;
      ctx.lineWidth = 1.25; ctx.lineCap = 'round';
      ctx.stroke(new Path2D(d));
      ctx.restore();
    }
    /* The anchor is a ring with a lit core, matching `.labdot` — and the colour is read from
     * `style.color`, which is where the region colour is written. It used to be read from
     * `style.background`, and when the ring replaced the filled disc on screen this quietly
     * became `ctx.fillStyle = ''`, which leaves the previous fill in place rather than
     * failing: every anchor in an exported figure took the colour of the last thing drawn. */
    const ax = parseFloat(l.dot.style.left), ay = parseFloat(l.dot.style.top);
    const rgb = l.dot.style.color || 'rgba(215,235,255,.85)';
    if (Number.isFinite(ax)) {
      ctx.save();
      ctx.beginPath(); ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
      ctx.lineWidth = 1.4; ctx.strokeStyle = rgb; ctx.stroke();
      ctx.beginPath(); ctx.arc(ax, ay, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = rgb; ctx.fill();
      ctx.restore();
    }
    const x = parseFloat(l.el.style.left), y = parseFloat(l.el.style.top);
    const bw = l.w ?? l.el.offsetWidth;
    ctx.save();
    /* A hairline plate with one lit edge, the same shape as `.lab3d`. Squared off, because
     * the 6px radius belonged to the card design this replaced. */
    ctx.fillStyle = 'rgba(6,11,19,.88)';
    ctx.strokeStyle = 'rgba(150,185,230,.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x, y, bw, LAB_H); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = l.el.style.borderLeftColor || 'rgba(150,190,235,.34)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + LAB_H); ctx.stroke();
    /* No `system-ui` in a canvas font stack: Chromium's canvas parser rejects the whole
     * declaration and silently leaves ctx.font at 10px sans-serif, so the export came out in
     * a different size and face from the screen. */
    const FACE = '"Helvetica Neue", Helvetica, Arial, "Noto Sans KR", sans-serif';
    ctx.textBaseline = 'middle';
    const tx = x + 10;
    if (l.role) {
      // right-aligned, so the name keeps the left edge it shares with every other label
      ctx.font = `8.5px ${FACE}`;
      ctx.fillStyle = '#5f6c82';
      const rw = ctx.measureText(l.role).width;
      ctx.fillText(l.role, x + bw - 10 - rw, y + LAB_H / 2);
      ctx.strokeStyle = 'rgba(150,185,230,.055)';
      ctx.beginPath();
      ctx.moveTo(x + bw - 18 - rw, y + 6); ctx.lineTo(x + bw - 18 - rw, y + LAB_H - 6);
      ctx.stroke();
    }
    ctx.font = `10.5px ${FACE}`;
    ctx.fillStyle = '#c9d6e8';
    ctx.fillText(nameOf(l.id, app.lang), tx, y + LAB_H / 2);
    ctx.restore();
  }
  return out.toDataURL('image/png');
}

/* ------------------------------------------------------------------ picking */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
/* The merged layers' source meshes are moved off the camera's layer so the
 * renderer skips them -- see `remerge`. They are still the things a ray is
 * meant to hit, and `Raycaster` tests an object's layer before it looks at a
 * triangle, so without this the muscles became unclickable the moment they
 * started drawing in one call. */
ray.layers.enable(PICK_LAYER);

/**
 * Everything a ray could hit, as meshes rather than as groups.
 *
 * This used to raycast the six layer groups. `rig.attach` reparents every bound mesh out of
 * its group and into the rig hierarchy, so once the rig finished loading the groups held
 * nothing and the whole model became unclickable — the body, the bones and the brain alike.
 * Each layer keeps its own mesh list now, which does not care where in the scene graph the
 * meshes ended up.
 */
function pickTargets() {
  const out = [];
  for (const name of LAYER_ORDER) {
    const L2 = layers[name], st = app.layers[name];
    if (!L2.loaded || !st?.on || (st.opacity ?? 1) <= 0.05) continue;
    if (name.startsWith('muscles') && !app.showMeshes) continue;
    for (const o of L2.meshes ?? []) if (shown(o)) out.push(o);
  }
  return out;
}
/**
 * How solid a layer looks right now.
 *
 * Selecting a deep structure ghosts everything in front of it, and a ray should go through
 * what has been ghosted rather than stopping on it — otherwise the first click selects a
 * muscle, that muscle ghosts the layer above, and the next click keeps hitting the ghost.
 * But a ghosted layer is still *there*, so it is a fallback rather than a nothing.
 */
const GHOST = 0.25;
const layerOpacity = name => layers[name]?.material?.opacity ?? 1;
/** Visible in the render, which means visible all the way up to the scene. */
function shown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Above this the projection and the geometry have parted company — see `setExplode`. */
const PICK_LIMIT = 0.02;

/**
 * Nearest sphere first, and stop when nothing left can be nearer.
 *
 * `intersectObjects` tests every object it is handed. Two thousand structures, most
 * of them skinned -- and a skinned raycast walks each candidate triangle's vertices
 * through a bone transform -- came to **119 ms for one pick**, on every pointer
 * move. That is not a slow frame, it is the application stopping dead every time
 * the mouse moves across the body, and it is most of what "my computer is lagging
 * a lot" was.
 *
 * Nothing about the answer changes. Each candidate's bounding sphere gives the
 * nearest distance along the ray at which that object could possibly be hit;
 * sorted by it, the first real hit at distance d proves that every candidate whose
 * sphere starts beyond d cannot beat it. Those are never tested. The hits that do
 * come back are the same hits, in the same order.
 */
const _rs = new THREE.Vector3();
function sphereEntry(mesh) {
  const s = mesh.boundingSphere ?? mesh.geometry?.boundingSphere;
  if (!s) return 0;                       // no sphere: cannot prune, so test it
  /* World space. A skinned mesh sits at the identity and keeps its sphere in body
   * coordinates; a bone-parented one carries its parent's transform. */
  _rs.copy(s.center);
  if (!mesh.isSkinnedMesh) _rs.applyMatrix4(mesh.matrixWorld);
  const scale = mesh.isSkinnedMesh ? 1
    : Math.max(1e-6, mesh.matrixWorld.getMaxScaleOnAxis());
  const rad = s.radius * scale;
  _rs.sub(ray.ray.origin);
  const along = _rs.dot(ray.ray.direction);
  const perp2 = _rs.lengthSq() - along * along;
  if (perp2 > rad * rad) return Infinity;      // the ray misses the sphere entirely
  return Math.max(0, along - Math.sqrt(Math.max(0, rad * rad - perp2)));
}

const _order = [];
function pick(ev) {
  const r0 = canvas.getBoundingClientRect();
  if (app.explode > PICK_LIMIT) return pickApart(ev, r0);
  ndc.x = ((ev.clientX - r0.left) / r0.width) * 2 - 1;
  ndc.y = -((ev.clientY - r0.top) / r0.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);

  _order.length = 0;
  for (const o of pickTargets()) {
    const d = sphereEntry(o);
    if (d !== Infinity) _order.push({ o, d });
  }
  _order.sort((a, b) => a.d - b.d);

  let ghosted = null, best = Infinity;
  const one = [];
  for (const { o, d } of _order) {
    // nothing beyond here can be nearer than the hit already found
    if (d > best) break;
    one.length = 0;
    o.raycast(ray, one);
    for (const h of one) {
      if (h.distance > best) continue;
      if (app.cutaway && clipPlane.distanceToPoint(h.point) < 0) continue;
      const geo = h.object.geometry;
      const reg = geo && regionAttr(geo);
      const id = reg && h.face ? Math.round(reg.getX(h.face.a))
               : (h.object.userData.regionId ?? null);
      if (id == null || !get(id)) continue;
      /* A ghosted layer is still there -- see `GHOST` -- so a hit on one is kept as
       * a fallback and does not stop the search, which is what lets a click go
       * through a peeled-away layer to the structure behind it. */
      if (layerOpacity(String(h.object.userData.layer)) >= GHOST) {
        best = h.distance;
        ghosted = id;
        break;
      }
      if (ghosted == null) ghosted = id;
    }
  }
  return ghosted;
}

/**
 * Picking while the body is apart, by projection rather than by ray.
 *
 * The raycaster tests the geometry where it really is, and taking the body apart
 * moves only the projection -- so a ray at a separated rib selects whatever is
 * still standing where that rib used to be. That is why clicking was simply
 * turned off above `PICK_LIMIT`, which is defensible while the answer is "the
 * body is open, look at it" and indefensible once the answer is a catalogue of
 * two thousand pieces laid out to be clicked.
 *
 * So it picks the way a catalogue is picked: every structure's anchor is
 * projected to the screen and the nearest one inside a radius wins. The pieces
 * are spread out by construction here -- that is what the layout is for -- so
 * nearest-on-screen is not an approximation of the right answer, it is the right
 * answer.
 */
const _pp = new THREE.Vector3();
function pickApart(ev, rect) {
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  /* Generous, because a piece in the grid is small on screen and the reader is
   * aiming at a shape rather than at a pixel. Scaled by the cell so it stays the
   * same fraction of a cell whatever the layout's size. */
  let bestD = (rect.width * 0.035) ** 2, best = null;
  for (const name of LAYER_ORDER) {
    const L2 = layers[name], st = app.layers[name];
    if (!L2.loaded || !st?.on || (st.opacity ?? 1) <= 0.05) continue;
    if (name.startsWith('muscles') && !app.showMeshes) continue;
    for (const mesh of L2.meshes ?? []) {
      if (!shown(mesh)) continue;
      for (const id of restByMesh.get(mesh)?.keys() ?? []) {
        const c = app.centroids[id];
        if (!c || !get(id)) continue;
        _pp.copy(c);
        applyExplode(_pp, explodeFor(id));
        _pp.project(camera);
        if (_pp.z > 1) continue;
        const px = (_pp.x + 1) / 2 * rect.width, py = (1 - _pp.y) / 2 * rect.height;
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        if (d < bestD) { bestD = d; best = id; }
      }
    }
  }
  return best;
}
const _off2 = new THREE.Vector3();

/** One layer's drawing material, so a test can ask how it is being drawn. */
export const layerMaterialOf = (n) => layers[n]?.material ?? null;

/** Whether the rig has been moved off the bind pose — see `raybvh`'s `setRestTest`. */
export const posedNow = () => !!boneDQ?.posed;

/** Where a structure is drawn right now, so a test can ask whether it can be pointed at. */
export const drawnPointOf = (id) => drawnPoint(+id, new THREE.Vector3());

/** Pick at a client coordinate. Exported so a test can ask what is under a point. */
export const pickAt = (clientX, clientY) => pick({ clientX, clientY });


const tap = new PointerTap();
canvas.addEventListener('pointerdown', e => {
  tap.down(e.pointerId, e.clientX, e.clientY, slopFor(e.pointerType));
  nudgeIdle();
});
canvas.addEventListener('pointercancel', e => tap.cancel(e.pointerId));
canvas.addEventListener('pointerup', e => {
  if (!tap.up(e.pointerId, e.clientX, e.clientY)) return;
  /* A cell first, then whatever surface is behind it.
   *
   * The probe could be hovered and not clicked, so a reader who found a cell and wanted to
   * keep it had nowhere to go — the note vanished the moment the pointer moved on. Clicking a
   * cell selects the region it was sampled from, which is the thing a cell can honestly stand
   * for: it flies the camera there, lights that region's cells and dims the rest, and fills
   * the panel with what that region does and the evidence behind it. */
  const cell = cellUnder(e);
  if (cell != null) { selectStructure(cell); return; }
  selectStructure(pick(e));
});
/**
 * Hover, at most once a frame.
 *
 * A pick costs a raycast through the meshes under the pointer, and a mouse
 * dragged across the stage delivers a `pointermove` far more often than the
 * screen is redrawn -- a fast sweep on a 120 Hz mouse is several hundred a
 * second. Picking on each one meant the main thread spent its whole budget
 * answering a question about pointer positions that were already stale before
 * the answer arrived, which is what "it is lagging really hard" was: not the
 * render, which is under eight milliseconds with the whole atlas on, but the
 * hover behind it.
 *
 * So the event only records where the pointer is and asks for a frame. The pick
 * happens once, in that frame, at the newest position -- the only one that can
 * still be seen. Everything between is coalesced, which is exactly what the
 * intermediate positions of a moving pointer are worth.
 */
let hoverAt = null, hoverQueued = false;
function runHover() {
  hoverQueued = false;
  const e = hoverAt;
  if (!e) return;
  const id = pick(e);
  if (id !== app.hover) { app.hover = id; syncLayers(); }
  canvas.style.cursor = id != null ? 'pointer' : (document.body.classList.contains('sheet') ? 'move' : 'grab');
  showHoverTip(id, e.clientX, e.clientY);
  pickCell(e);
}
canvas.addEventListener('pointermove', e => {
  tap.move(e.pointerId, e.clientX, e.clientY);
  if (e.buttons & 1) return;
  /* Hover picking is a mouse affordance. A finger already down is orbiting or
   * pinching, and running it then spent the frame budget deciding what was under
   * a gesture nobody was aiming. */
  if (tap.pointers) return;
  hoverAt = { clientX: e.clientX, clientY: e.clientY };
  if (hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(runHover);
});
canvas.addEventListener('pointerleave', () => {
  hoverAt = null;
  if (app.hover != null) { app.hover = null; syncLayers(); }
  showHoverTip(null, 0, 0);
});

/**
 * The name of whatever is under the pointer, beside the pointer.
 *
 * The catalogue draws no label plates -- see `labelVisible` -- because a sheet of
 * a thousand cells with eighteen names on ropes across it is less legible than
 * the sheet alone. This is the other half of that bargain: pointing at a piece
 * says what it is, immediately, without taking a click or covering anything.
 */
let tipEl = null;
function showHoverTip(id, x, y) {
  const r = id != null ? get(id) : null;
  if (!r) { if (tipEl) tipEl.hidden = true; return; }
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'hovertip';
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = r.name[app.lang];
  tipEl.hidden = false;
  /* Flipped to the other side of the cursor near the right edge, so the name of
   * something on the last column is not written off the screen. */
  const w = tipEl.offsetWidth || 140;
  tipEl.style.left = `${Math.min(x + 16, window.innerWidth - w - 12)}px`;
  tipEl.style.top = `${Math.max(6, y - 30)}px`;
}

/** The region of the cell under the pointer, or null. Used by the click path. */
function cellUnder(ev) {
  if (!neuralNet || !app.neural || !app.layers.brain.on
      || app.brainLook === 'anatomical') return null;
  pick(ev);                                   // aims `ray` at this event
  const hit = neuralNet.pickNode(ray);
  return hit && hit.region > 0 ? hit.region : null;
}

/**
 * The cell under the pointer.
 *
 * `ray` is already aimed by `pick` on the same event, so this costs one more `intersectObject`
 * against the soma cloud and nothing else. It runs only while the network is drawn, because a
 * probe on something that is not on the screen is worse than no probe.
 */
function pickCell(ev) {
  if (!neuralNet || !app.neural || !app.layers.brain.on
      || app.brainLook === 'anatomical') return dropCell();
  const hit = neuralNet.pickNode(ray);
  if (!hit) return dropCell();
  heldCell = hit;
  drawCell();
}
function dropCell() { heldCell = null; cellNote.hide(); }

/**
 * Redraw the held cell's note against the frame that is on screen now.
 *
 * Called from the render loop as well as from the pointer, for two reasons that are really
 * one: the scene moves under a stationary pointer. The brain rotates, so a note pinned where
 * the cell *was* points at tissue that has moved on; and the cell is firing, so a bar sampled
 * once at hover time freezes a spike that has already passed. A probe that stops reading the
 * moment you stop moving is a screenshot of a probe.
 */
function drawCell() {
  if (!heldCell || !neuralNet) return;
  const r = canvas.getBoundingClientRect();
  const stageBox = stage.getBoundingClientRect();
  const p = heldCell.point.clone().project(camera);
  // behind the camera, or off the stage: the wire would run to nowhere
  if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return cellNote.hide();
  cellNote.show(
    { x: (p.x * 0.5 + 0.5) * r.width + (r.left - stageBox.left),
      y: (-p.y * 0.5 + 0.5) * r.height + (r.top - stageBox.top) },
    heldCell, neuralNet.fireAt(heldCell.index, lastT), app.lang);
}
/** The cell under the pointer, held so the loop can keep its note current. */
let heldCell = null;
/** What the picture is doing right now, so the note can report it rather than guess. */
let lastT = 0;
canvas.addEventListener('wheel', nudgeIdle, { passive: true });

let idleAt = performance.now();
function nudgeIdle() { idleAt = performance.now(); }

/* ------------------------------------------------------------------ camera */
let flight = null;
/** Which call started the current camera move. Diagnostic only, but it is what showed that
  * a "stuck" flight was the test re-issuing the move immediately before reading it. */
let FLIGHT_BY = 'init';

/**
 * Start a camera move, or make it immediately if asked.
 *
 * Every camera move goes through here so there is one place that knows how to arrive. The
 * immediate path is not only for tests: a user who has asked their system for reduced motion
 * should not be flown anywhere, and a scene heavy enough to render at a frame every few
 * seconds should snap rather than crawl.
 */
const REDUCED_MOTION = matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
function flyToPose(toP, toT, immediate = false) {
  if (immediate || REDUCED_MOTION) {
    camera.position.copy(toP);
    controls.target.copy(toT);
    controls.update();
    flight = null;
    return;
  }
  flight = { t: 0, by: FLIGHT_BY, fromP: camera.position.clone(), toP: toP.clone(),
             fromT: controls.target.clone(), toT: toT.clone() };
}
const LEFT_VIEW = new THREE.Vector3(0.80, 0.18, 0.56).normalize();

/**
 * Fly to one structure.
 *
 * Two things this has to get right that a naive version does not. The centre is the *posed*
 * centroid, so clicking a label during an exercise goes to where the muscle is rather than
 * where it was standing. And the distance comes from the same fit as `frameRig` — solved
 * against the real fov and aspect, with the view bar's strip reserved — because scaling a
 * radius by a constant either buries the camera inside the body or leaves the structure a
 * speck, depending entirely on how big the structure happens to be.
 */
/**
 * Where to stand so the structure is actually visible.
 *
 * Ghosting the layers in front of a selection reveals a muscle under skin, but it does
 * nothing for a bone behind other bones: they are the same layer, so they stay solid and the
 * thing you asked for is drawn somewhere behind them. Rather than make the whole layer
 * translucent — which puts hundreds of meshes into the sorted pass and costs the frame rate
 * the opaque path was written to protect — this looks for a line of sight. Each candidate
 * direction is one ray back at the structure; the first that reaches it wins, and if none
 * do, the least obstructed does.
 */
const VANTAGES = [
  [0.80, 0.18, 0.56], [-0.80, 0.18, 0.56], [0.0, 0.20, 1.0], [0.0, 0.20, -1.0],
  [1.0, 0.20, 0.0], [-1.0, 0.20, 0.0], [0.55, 0.70, 0.45], [0.55, -0.55, 0.45],
].map(v => new THREE.Vector3(...v).normalize());
const _from = new THREE.Vector3(), _look = new THREE.Vector3();

/**
 * How much a clear line of sight is worth against looking at the thing the right way round.
 *
 * Clearance is scored 0..1 — the share of the way to the structure before something opaque
 * gets in front of it — so this is the fraction of a completely blocked view a natural
 * vantage is worth. Set so that a fully clear direction still beats a half-blocked one from
 * the opposite side, and no higher: the *first* job of this function is to find a view that
 * reaches the structure at all.
 */
const VANTAGE_BIAS = 0.22;

/**
 * How far along `ray` something that is not `id` gets in the way.
 *
 * Nearest first, and it stops at the first answer — the same pruning `pick` uses
 * and for a stronger reason: this runs **nine times per click**, once per vantage.
 * `intersectObjects` has no early-out and no ordering, so it tested every one of
 * two thousand structures nine times over to find out which surface is nearest,
 * and one click cost 140 milliseconds at rest and 580 posed. What it is actually
 * asking is a question about the *first* thing along a line.
 */
const _one = [];
function blockingDistance(targets, id) {
  _order.length = 0;
  for (const o of targets) {
    const d = sphereEntry(o);
    if (d !== Infinity) _order.push({ o, d });
  }
  _order.sort((a, b) => a.d - b.d);
  let blocked = Infinity;
  for (const { o, d } of _order) {
    if (d > blocked) break;              // nothing further out can be in front
    _one.length = 0;
    o.raycast(ray, _one);
    for (const h of _one) {
      if (h.distance > blocked) continue;
      const geo = h.object.geometry, reg = geo && regionAttr(geo);
      const hid = reg && h.face ? Math.round(reg.getX(h.face.a))
                : (h.object.userData.regionId ?? null);
      if (hid === id) return Infinity;                            // reached it: clear
      if (layerOpacity(String(h.object.userData.layer)) < GHOST) continue;  // see-through
      blocked = h.distance;
    }
  }
  return blocked;
}

function clearestDir(id, centre, distance, prefer) {
  const targets = pickTargets();
  if (!targets.length) return prefer;
  let best = prefer, bestScore = -Infinity;
  for (const dir of [prefer, ...VANTAGES]) {
    _from.copy(centre).addScaledVector(dir, distance);
    ray.set(_from, _look.copy(centre).sub(_from).normalize());
    // how far along the ray before something that is not the structure gets in the way
    const blockedAt = blockingDistance(targets, id);
    /* Scored, not maximised. This used to take the least obstructed direction outright, and
     * with the skin gone most of them reach a superficial muscle unobstructed — so the
     * winner among eight equally clear views was whichever happened to be tested first, and
     * for the rectus abdominis that was the one looking *up* at the body from below and in
     * front. A view of a person from underneath is not an answer to "show me this muscle".
     *
     * So clearance decides whether a direction is usable and the preference decides which
     * usable one is chosen. The preferred direction is the one the anatomy asks for — see
     * `facingDir` — and it wins every tie without ever overriding a genuinely blocked view. */
    const clear = blockedAt === Infinity
      ? 1 : Math.min(1, blockedAt / Math.max(1e-6, distance));
    const score = clear + VANTAGE_BIAS * dir.dot(prefer);
    if (score > bestScore + 1e-6) { bestScore = score; best = dir; }
  }
  return best;
}

/**
 * Which way a structure faces, so the camera can stand in front of it.
 *
 * A body part is a shape on the outside of a body, and the view that shows it is the one
 * looking in at the surface it belongs to: the rectus abdominis from the front, the
 * latissimus from behind, a rib from the side. That is what this computes — the structure's
 * own direction out of the body, in the transverse plane, so nothing ever looks up at a
 * person from underneath.
 *
 * It replaces a rule that sent every *paired* structure to a fixed left lateral vantage. The
 * reasoning was sound for the case it was written for — a paired structure's centroid sits on
 * the midline, so a direction derived from it points nowhere — but the conclusion did not
 * follow: being paired says nothing about which way the pair faces. The rectus abdominis is
 * paired, and seen from the left it is a flat strap edge-on, two pixels wide. Taking the
 * direction from where the structure sits *front to back* rather than left to right answers
 * the degenerate case without throwing away the answer.
 *
 * The result is a three-quarter view rather than face-on. A surface square to the camera has
 * no silhouette, and most of what makes a muscle recognisable is its outline.
 */
const _out = new THREE.Vector3(), _side = new THREE.Vector3();
function facingDir(c) {
  const mid = bodyCentre();
  _out.set(c.x - mid.x, 0, c.z - mid.z);
  /* Deep and central — a vertebral body, a psoas at the midline. Nothing about where it sits
   * says which way to look at it, and the standing lateral vantage is the one that shows a
   * spine. */
  if (_out.lengthSq() < 4e-4) return LEFT_VIEW.clone();
  _out.normalize();
  // turned toward the side the structure is on, so a left arm is seen from the left
  const hand = c.x < 0 ? -1 : 1;
  _side.set(-_out.z * hand, 0, _out.x * hand);
  return _out.addScaledVector(_side, 0.42).setY(0.13).normalize();
}

/**
 * The middle of the body as it has actually been loaded.
 *
 * `facingDir` needs to know which way is out, and out is measured from the body's own axis
 * rather than from the origin: the midline is x = 0 by construction but the coronal middle is
 * not z = 0, and taking it as zero puts the whole back half of the body on the "anterior"
 * side. Averaged over every structure that has arrived, and recomputed when more do — the
 * count is the only thing that can change it, since centroids are measured once at load.
 */
let bodyMid = null, bodyMidAt = -1;
function bodyCentre() {
  const ids = Object.keys(app.centroids);
  if (bodyMid && ids.length === bodyMidAt) return bodyMid;
  const m = new THREE.Vector3();
  let n = 0;
  for (const id of ids) { const p = app.centroids[id]; if (p) { m.add(p); n++; } }
  if (n) m.divideScalar(n);
  bodyMidAt = ids.length;
  return (bodyMid = m);
}

export function flyTo(id, immediate = false) {
  FLIGHT_BY = 'flyTo';
  /* Where it is drawn, not where it stands — see `drawnSide`. Taken apart, those differ by
   * the whole width of the catalogue. */
  const side = drawnSide(id);
  const c = side?.centre ?? drawnPoint(id);
  if (!c) return;
  // scaled with the piece, for the same reason `flyToGroup` scales its fallback radius
  const grow = app.explode > 0 ? 1 + (palette.getScale(id) - 1) * app.explode : 1;
  const radius = Math.max(0.03, (app.radii[id] ?? 0.05) * 1.9) * grow;
  /* Straight on, and no search for a line of sight, once the body is apart: a piece in a
   * catalogue has nothing in front of it by construction, and `clearestDir` would be reading
   * the geometry where it still stands rather than where it is drawn — so it would answer
   * about a body that is not on the screen. */
  let dir = app.explode > OPENED
    ? new THREE.Vector3(0, 0, 1)
    : clearestDir(id, c, Math.max(0.06, radius * 4), facingDir(c)).clone();
  // the structure's own extent, as a box of points the fit can measure
  const pts = side?.points ?? [];
  if (pts.length < 4) {
    for (const s of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
      pts.push(c.clone().addScaledVector(new THREE.Vector3(...s), radius));
  }
  /* Close enough to fill the frame, far enough to be outside the limb. A metacarpal is two
   * centimetres across and its own fit puts the camera five centimetres away — which is
   * inside the forearm, looking at the inside wall of a muscle. Ten centimetres clears any
   * body part while still filling the picture with a small bone.
   *
   * The padding is the structure's own size rather than a flesh-thickness constant, and the
   * headroom is small. `TOP_BAR` gives a sixth of the frame to the view bar, which is right
   * for a standing figure whose head would otherwise be behind it and wrong for one muscle
   * framed in the middle of the stage: paid on both the pad and the bar and again on the
   * console inset, the three of them together were most of "why does it show me from far". */
  const { target, distance } = frameFor(pts, dir, radius * 0.22, 0.05, STRUCTURE_TOP_BAR);
  flyToPose(target.clone().addScaledVector(dir, distance), target, immediate);
}
/* One structure sits in the middle of the stage, well under the bar floating over the top
 * left. It needs enough headroom that its name plate has somewhere to go, and no more. */
const STRUCTURE_TOP_BAR = 0.04;

/** Standard anatomical views. A body needs these; a brain did not. */
const VIEWS = {
  anterior:  [0, 0.0, 1.32], posterior: [0, 0.0, -1.32],
  lateral:   [1.32, 0.0, 0.0], superior: [0.01, 1.32, 0.0],
};
/* How far a brain structure's centroid sits inside the surface, in body heights. A cortical
 * parcel is a sheet folded over a gyrus, so its centroid is a couple of centimetres in —
 * nothing like the skull-and-foot-bone cloud HOME_PAD is padding — and each centroid is
 * already grown by its own radius below, so a pad much larger than this is counted twice and
 * simply pushes the camera back. */
const HEAD_PAD = 0.004;
/* The bar floats over the top *left*; the brain is framed in the middle of the stage, so it
 * needs a fraction of the headroom a standing figure does. */
const HEAD_TOP_BAR = 0.05;
const HEAD_DIR = new THREE.Vector3(0.31, 0.06, 0.25).normalize();

/**
 * Where to stand to look at the brain.
 *
 * The offset this replaces was a hand-written vantage, and like `HOME` it was a measurement
 * of one scan wearing the clothes of a constant: it held the organ at about two fifths of the
 * frame and gave the rest of the stage to empty page. Fitting it to the brain's own
 * structures through the same `frameFor` that frames a pose puts the subject in the frame at
 * the size of the subject.
 *
 * The offset survives as the fallback, and has to: this is reachable before the brain layer
 * has loaded, and `BRAIN_TO_BODY`'s translation is the brain centre in body units whether or
 * not any geometry has arrived. The centroids are the *posed* ones, so once the brain is
 * riding the skull this follows the head rather than the place it was standing.
 */
function headView() {
  const c = new THREE.Vector3(...BRAIN_TO_BODY.translation);
  const pts = [];
  for (const [id, p] of Object.entries(app.centroids)) {
    const r = get(id);
    if (r?.layer !== 'brain' || !p) continue;
    const rad = Math.max(0.004, app.radii[id] ?? 0.01);
    for (const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
      pts.push(p.clone().addScaledVector(new THREE.Vector3(...d), rad));
  }
  if (pts.length < 24) return { p: c.clone().add(new THREE.Vector3(0.31, 0.06, 0.25)), t: c };
  const { target, distance } = frameFor(pts, HEAD_DIR, HEAD_PAD, 0.02, HEAD_TOP_BAR);
  return { p: target.clone().addScaledVector(HEAD_DIR, distance), t: target };
}

export function setView(key, immediate = false) {
  FLIGHT_BY = 'setView';
  if (key === 'wholeBody') return resetView(immediate);
  if (key === 'head') {
    const { p, t } = headView();
    flyToPose(p, t, immediate);
    return;
  }
  const v = VIEWS[key];
  if (!v) return;
  const t = new THREE.Vector3(0, -0.05, 0);
  flyToPose(new THREE.Vector3(...v).add(t), t, immediate);
  nudgeIdle();
}

const FLESH = 0.07;            // body heights, roughly half a thigh's thickness
const FIT_MARGIN = 1.10;       // the viewbar and the layerbar float over the render

/**
 * Where to stand to watch this pose.
 *
 * A fixed three-quarter vantage is right for a standing figure and wrong for every other
 * pose in the library: it looks straight down the long axis of a supine body, so the
 * Hundred foreshortened into a heap and down dog read as noise. The plane a movement
 * happens in is the plane the joints spread across, so the camera looks along the *short*
 * horizontal axis of the joint cloud — lateral for anything lying or folding in the
 * sagittal plane, anterior for the wide-legged frontal-plane shapes.
 *
 * The axis comes from the 2x2 horizontal covariance rather than the bounding box, because
 * a box is axis-aligned and a lunge is not. A small azimuth offset keeps the result from
 * being a dead-flat elevation drawing, and the elevation is deliberately shallow: looking
 * down on a supine body is geometrically the widest view and anatomically useless.
 */
const AZIMUTH_OFFSET = 0.30;   // radians, ~17 degrees off dead-on
const ELEVATION = 0.22;        // radians, ~13 degrees above the horizon

function poseVantage(pts, c) {
  let sxx = 0, sxz = 0, szz = 0;
  for (const p of pts) {
    const x = p.x - c.x, z = p.z - c.z;
    sxx += x * x; sxz += x * z; szz += z * z;
  }
  const n = pts.length || 1;
  sxx /= n; sxz /= n; szz /= n;
  /* The eigenvector of the larger eigenvalue is the direction the body spreads along in
   * plan; the camera wants the perpendicular to it. */
  const tr = sxx + szz, disc = Math.sqrt(Math.max(0, tr * tr / 4 - (sxx * szz - sxz * sxz)));
  const big = tr / 2 + disc;
  let ex = sxz, ez = big - sxx;
  if (Math.abs(ex) + Math.abs(ez) < 1e-9) { ex = big - szz; ez = sxz; }
  const len = Math.hypot(ex, ez) || 1;
  ex /= len; ez /= len;
  let az = Math.atan2(ex, ez) + Math.PI / 2;   // perpendicular to the spread
  /* Face the front-left quadrant. Either perpendicular frames the pose equally well, so
   * pick the one that does not put the camera behind the figure. */
  if (Math.sin(az) < 0 || (Math.abs(Math.sin(az)) < 0.2 && Math.cos(az) < 0)) az += Math.PI;
  az += AZIMUTH_OFFSET;
  const ce = Math.cos(ELEVATION);
  return new THREE.Vector3(Math.sin(az) * ce, Math.sin(ELEVATION), Math.cos(az) * ce).normalize();
}

/**
 * Where to aim and how far back to stand.
 *
 * Half the bounding diagonal times a constant fits a sphere, and a body is not a sphere:
 * with a 2.3:1 stage the same constant that framed a standing figure clipped the heels off
 * an inverted one. This solves the real condition instead — the extent of the joint cloud in
 * the camera's own basis, against the actual fov and aspect.
 *
 * The top of the stage is not empty: the view bar floats over it. So the vertical extent is
 * padded at the top only, and the aim point moves to the middle of the padded extent, which
 * drops the figure clear of the bar instead of tucking its head behind it.
 */
const TOP_BAR = 0.16;          // share of the stage height the view bar floats over
/* `frameFor`'s `right` is screen right, and the shift that re-centres a subject is therefore
 * positive: three's `lookAt` puts the camera's +Z along `dir` (away from the target) and its
 * +X at cross(up, +Z) — the same cross product `frameFor` takes — and a camera's +X is screen
 * right. Moving the *target* right slides the subject left in frame, which is the direction
 * that takes it out from under the console. Getting this backwards pushes it further under,
 * so `test/frame.test.mjs` measures it rather than trusting the derivation. */
const RIGHT_ON_SCREEN = 1;

/**
 * @param topBar how much headroom to leave for the bar floating over the top of the stage,
 *   as a share of the subject's own height. It is a share of the *subject* rather than of the
 *   stage because that is what the fit can act on, and it is a parameter because the bar
 *   covers the top-left corner: framing a standing figure has to clear it, framing a compact
 *   organ in the middle of the stage does not, and paying the full 16% there is a sixth of
 *   the picture given away for nothing.
 */
function frameFor(pts, dir, pad = FLESH, min = 0.02, topBar = TOP_BAR,
                 { aspect = null, inset = true } = {}) {
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  /* The aspect is the *frame's*, and an offscreen panel is not the stage. Overriding the real
   * camera to fit one would reframe the live view every time a panel drew, which is the same
   * trap `renderStageInto` avoids by cloning. `inset` is the other half of it: the console
   * covers the right of the stage and nothing covers an offscreen panel, so a panel that paid
   * the console's width would push its subject off its own edge. */
  const tanH = tanV * Math.max(0.2, aspect ?? camera.aspect);

  // the cloud in the camera's basis, measured from an arbitrary origin
  const o = pts[0], v = new THREE.Vector3();
  let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
  let minD = Infinity, maxD = -Infinity;
  for (const p of pts) {
    v.subVectors(p, o);
    const r = v.dot(right), u = v.dot(up), d = v.dot(dir);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minD = Math.min(minD, d); maxD = Math.max(maxD, d);
  }
  minR -= pad; maxR += pad; minU -= pad; maxU += pad;
  maxU += (maxU - minU) * topBar;

  /* The console covers the right of the stage, so the frame is wider than the space the
   * subject can actually use. Fitting to the whole canvas puts a standing figure in the
   * middle of the *window* — which is off-centre in what you can see, and a third smaller
   * than it needs to be, because a third of what it was fitted to is behind glass.
   *
   * Two corrections, and both are needed: widen the horizontal requirement so the subject
   * fills the visible fraction rather than the whole frame, and slide the target along the
   * frame so the subject sits in the middle of what is left. Sliding without widening frames
   * it correctly and then pushes part of it off the edge. */
  const side = inset
    ? THREE.MathUtils.clamp(panelInset() / Math.max(1, canvas.clientWidth), 0, 0.6) : 0;
  const visible = 1 - side;

  const target = o.clone()
    .addScaledVector(right, (minR + maxR) / 2)
    .addScaledVector(up, (minU + maxU) / 2)
    .addScaledVector(dir, (minD + maxD) / 2);
  const halfU = (maxU - minU) / 2, halfD = (maxD - minD) / 2;
  const halfR = (maxR - minR) / 2 / visible;
  /* The floor is only there so a degenerate cloud cannot put the camera on top of its own
   * target. It used to be 0.3 — a third of the figure's height — which was harmless for a
   * whole body and wrong for everything else: a metacarpal is two centimetres across and was
   * viewed from thirty, so clicking any small structure's name showed a hip. */
  const distance = Math.max(min, (halfD + Math.max(halfR / tanH, halfU / tanV)) * FIT_MARGIN);

  /* Now slide the subject out from under the console — and it has to be *now*, because the
   * shift is half the covered width of the **frame**, and the frame's width is not known until
   * the distance is. The first version used the subject's own half-width instead, which for a
   * standing figure is a fraction of the frame it is fitted into: a fit that is limited by
   * height leaves the frame far wider than the body, so the correction came out at 19 px where
   * it needed 168. Measured, not assumed — see `.render/frame.mjs`. */
  target.addScaledVector(right, RIGHT_ON_SCREEN * distance * tanH * side);
  return { target, distance };
}

/**
 * Frame the figure as it is now.
 *
 * The bounds come from the rig's own joint positions rather than from the meshes, because
 * `Box3.expandByObject` on a SkinnedMesh uses the geometry's bounding box under the mesh's
 * world matrix — and a skinned mesh sits at the identity with its vertices deformed on the
 * GPU. So it returns the *rest* extents no matter what pose is on screen, and the camera
 * framed a standing figure while the viewer looked at a supine one. Joint centres plus a
 * flesh margin are correct for any pose and cost nothing.
 */
/** Every joint centre of the rig as it stands right now, appended to `out`. */
function jointCloud(out) {
  for (const [, rec] of rig.nodes)
    out.push(new THREE.Vector3().setFromMatrixPosition(rec.body.matrixWorld));
}

/**
 * How far the flesh reaches past the joint centres — measured on this body, not written down.
 *
 * `frameRig` frames the rig's joints because a skinned mesh's bounding box is a rest-pose
 * measurement (see below), and joints alone describe a stick figure, so the fit is padded. A
 * fixed `FLESH` is half a thigh, which is right for a limb seen side-on and much too small
 * where a segment's flesh runs a long way past its own joint centre — a lumped forefoot mesh
 * took a supine figure to 98% of the canvas width and cut the feet off at the edge.
 *
 * The correction is a measurement of the body: how far the surface gets from the **nearest**
 * joint centre, at rest. Nearest in the whole rig, not the one belonging to the segment the
 * mesh rides — OpenSim puts a body's frame at the joint where it meets its parent, so the
 * torso's own origin is down at the pelvis and measuring a shoulder against it returns most
 * of a trunk. That reading padded the male by nearly half a body height and framed the
 * Hundred at a third of the canvas.
 *
 * Both halves are read at *rest*: the anchors are rest-pose surface points and `rig.bind`
 * holds each segment's rest world matrix, inverted. A point's offset from the joints around
 * it is what a pose carries with it, so a number measured standing still is the right one
 * for any pose.
 *
 * It is the maximum rather than a quantile: the whole job of the pad is to keep the part that
 * pokes furthest out inside the frame, and a quantile is a licence to clip it. Cached against
 * the set of loaded layers, because a layer arriving adds flesh.
 */
let fleshPad = null, fleshPadKey = null;
const _fm = new THREE.Matrix4();
function bodyFlesh() {
  if (!rig?.bind) return FLESH;
  const key = LAYER_ORDER.filter(n => layers[n].loaded).join(',');
  if (fleshPadKey === key) return fleshPad;
  const joints = [];
  for (const [name] of rig.nodes)
    if (rig.bind.has(name))
      joints.push(new THREE.Vector3().setFromMatrixPosition(_fm.copy(rig.bind.get(name)).invert()));
  let worst = 0;
  for (const [mesh] of bound) {
    const own = restByMesh.get(mesh);
    if (!own) continue;
    for (const [, e] of own)
      for (const pt of e.pts) {
        let near = Infinity;
        for (const j of joints) near = Math.min(near, pt.distanceToSquared(j));
        worst = Math.max(worst, near);
      }
  }
  fleshPadKey = key;
  return (fleshPad = Math.max(FLESH, Math.sqrt(worst)));
}

/**
 * @param {boolean} immediate  snap rather than fly
 * @param {boolean} overClip   frame the whole movement rather than the instant on screen
 *
 * A clip is framed once, when the exercise is chosen, and then plays. Framing the first
 * instant means the widest moment of the movement is outside the viewport — the Hundred
 * opens with the legs down and raises them to forty-five degrees, so the legs left the top
 * of the picture a second in. Sampling the clip and fitting the union costs five forward
 * kinematics evaluations and holds the whole movement.
 */
export function frameRig(immediate = false, overClip = false) {
  FLIGHT_BY = 'frameRig';
  if (!rig) return resetView(immediate);
  const pts = [];
  const clip = overClip && app.exercise ? MOTION[app.exercise] : null;
  if (clip) {
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const s = sample(app.exercise, t);
      if (!s) continue;
      rig.setAll(s.coordinates); markPosed(true); rig.root.updateMatrixWorld(true); markPosed(true);
      jointCloud(pts);
    }
    const back = sample(app.exercise, app.t);       // put the pose on screen back
    if (back) { rig.setAll(back.coordinates); rig.root.updateMatrixWorld(true); markPosed(true); refreshPosed(); }
  } else jointCloud(pts);
  const box = new THREE.Box3();
  for (const p of pts) box.expandByPoint(p);
  if (!pts.length) return resetView(immediate);
  const dir = poseVantage(pts, box.getCenter(new THREE.Vector3()));
  const { target, distance } = frameFor(pts, dir, bodyFlesh());
  flyToPose(target.clone().addScaledVector(dir, distance), target, immediate);
  nudgeIdle();
}

export function resetView(immediate = false) {
  FLIGHT_BY = 'resetView';
  /* Re-derived rather than cached, because the fit is solved against the *aspect* and the
   * stage changes shape without the body changing at all — a phone rotating, a window
   * dragged, the header's disclaimer chips wrapping onto a second line after load. Cached,
   * "Reset view" would return to the framing for a stage that is no longer there. It is a
   * few hundred points and it runs on a deliberate button press. */
  deriveHome();
  flyToPose(HOME.p, HOME.t, immediate);
}

/**
 * The opening view, measured from the body that loaded rather than written down.
 *
 * A home view is not a property of the app, it is a property of the person on screen, and a
 * body of any other proportions needs a different one. So it is fitted, by the same
 * `frameFor` that frames a pose — the
 * real fov, the real aspect, solved against the real extent — and the male's opening view
 * moves by a few centimetres rather than staying pinned to a number somebody typed.
 *
 * The cloud is the structures' **centroids**, not their surfaces, so it understates the body
 * by however far a centroid sits inside its own mesh — the same approximation `frameRig`
 * already makes when it frames the rig from joint centres. But not by the same amount:
 * `FLESH` is half a thigh, and the structures at the *ends* of this cloud are a skull and a
 * foot bone whose centroids are within about five centimetres of the surface. Padding by half
 * a thigh at the head and the heels pushed the camera back far enough to lose a tenth of the
 * figure's height to empty page, so this pad is its own number.
 */
const HOME_PAD = 0.03;         // body heights, how far the outermost centroid sits inside

function deriveHome() {
  if (!REG_READY) return;                           // called before the body's table arrived
  const pts = [];
  for (const [, r] of registry().byId)
    if (r.layer !== 'brain' && r.centroid) pts.push(new THREE.Vector3().fromArray(r.centroid));
  if (pts.length < 8) return;                       // trust the constant over a stub
  const dir = HOME.p.clone().sub(HOME.t).normalize();
  const { target, distance } = frameFor(pts, dir, HOME_PAD);
  HOME = { p: target.clone().addScaledVector(dir, distance), t: target };
}

/* --------------------------------------------------------------- selection */
export function selectStructure(id, { auto = false } = {}) {
  /* A whole muscle that is drawn as parts has no mesh of its own. Selecting it
   * means selecting what it stands for -- the nearest part to the camera, so
   * the panel and the picture agree about what is lit -- rather than an id
   * nothing will ever paint. */
  if (id != null && isAggregate(id)) {
    const parts = drawnIds(id);
    id = parts.find(p => app.centroids[p]) ?? parts[0] ?? null;
  }
  app.selected = id;
  /* Whether the reader chose this or the application chose it for them.
   *
   * The two are the same selection and every panel reads it the same way — that is the point,
   * and it is why the exercise's own region is a real selection rather than a second idea of
   * one kept in the lab. What differs is what the *stage* does about it. A deliberate pick is
   * a request to see that structure, so the camera flies to it and everything in front of it
   * is peeled away. An automatic one is not a request at all: the reader asked to look at an
   * exercise. Treated as deliberate, choosing any exercise pulled the camera into the head and
   * dropped every muscle layer to six per cent opacity — the body the exercise is about, very
   * nearly invisible, because a brain region had been selected on the reader's behalf. It
   * still lights its own structure and still drives its own cells; it just does not take the
   * picture away from what the reader was looking at. */
  app.autoSelected = !!auto && id != null;
  const r = id != null ? get(id) : null;
  /* Selecting a region drives its own cells.
   *
   * The network's activity map is keyed by region id and every soma and every fibre carries
   * the parcel it belongs to, so this is a single texel write rather than a search: the cells
   * inside the selected region start firing harder and faster, their fibres carry more
   * traffic, and everything else falls back. That is the difference between highlighting a
   * shape and showing what the shape is doing. */
  if (neuralNet) {
    /* The exercise's own marked regions survive a selection and the selection sits on top of
     * them: they are two different statements — "these are the regions this exercise's claims
     * are about" and "this is the one you are looking at" — and clearing the first to show the
     * second meant that clicking any structure silently threw away the answer the exercise had
     * just given. Deselecting brings the marks back, because `applyBrainMarks` rewrites them. */
    applyBrainMarks();
    if (r?.layer === 'brain') neuralNet.setRegionActivity(id, 0.9);
  }
  // selecting something in a hidden layer has to reveal it, or the panel describes
  // something the user cannot see
  if (r && !app.layers[r.layer].on) {
    /* One deliberate act, so this is allowed to change atlas: the alternative is
     * choosing a structure and being shown nothing, because the body it belongs
     * to is not the one on the screen. */
    app.layers[r.layer].on = true;
    if (holdOneAtlas(r.layer)) relayoutExplode();
    loadLayer(r.layer);
  }
  /* No longer forced into x-ray.
   *
   * Choosing something with an inside used to push the x-ray slider to 1, because
   * otherwise the structure was behind an opaque body and nothing on screen
   * answered the click. It is a poor answer: four hundred translucent shells in a
   * sorted pass is a haze with black gaps punched through it — the picture that
   * came back reported as "impossible to see what's inside" — and it takes the
   * reader's own control away from them at the same time. The reveal pass shows
   * the chosen structure through the body without touching anything else, so the
   * body stays as it was and the slider stays where it was put. */
  syncLayers();
  /* And light it in the section strip: a structure the reader has just chosen should be the
   * bright thing in every cut that passes through it, not something they have to find. */
  refreshSections();
  revealSelection();
  if (id != null && !auto) flyTo(id);
  ui.showStructure(id);
}

export function setLang(l) {
  app.lang = l; hud?.relabel(l); ui.relabel();
  refreshSections(true);   // the strip's caption and plane name are drawn, not templated
}
export function setAtlas(v) { app.atlas = v; syncLayers(); }
export function setXray(v) { app.xray = v; syncLayers(); }
export function setCutaway(on) { app.cutaway = on; syncLayers(); }
export function setClip(v) { clipPlane.constant = v; invalidate(); }
export function setLabels(on) { app.labelsOn = on; invalidate(); }
/**
 * Name one system at a time.
 *
 * Turning a kind on turns its layer on too. Asking for the nerves and being shown an empty
 * picture because the nerve layer happened to be off is not a filter, it is a puzzle.
 */
export async function setLabelKind(kind, on) {
  if (on) app.labelKinds.add(kind); else app.labelKinds.delete(kind);
  if (on) {
    const want = new Set();
    for (const [, r] of registry().byId) if (r.kind === kind) want.add(r.layer);
    for (const layer of onThisAtlas([...want]))
      if (!app.layers[layer]?.on) await setLayer(layer, true);
  }
  app.labelsOn = true;
  syncLayers();
}
export function clearLabelKinds() { app.labelKinds.clear(); syncLayers(); }
export function setRotate(on) { app.rotate = on; nudgeIdle(); invalidate(); }
export function setRegister(r) { app.register = r; ui.relabel(); }
export function setInstruction(on) { app.instructionOn = on; ui.relabel(); }

export async function setLayer(name, on) {
  /* A body declares its own layers, so asking for one it does not carry is a legitimate
   * question with the answer "there is none" — it threw on `app.layers[name].on` instead,
   * which took down whatever asked. It warns rather than passing silently, because a typo
   * in a layer name and a body that genuinely lacks one look identical from here. */
  if (!app.layers[name]) { console.warn(`no layer "${name}" on this body`); return; }
  app.layers[name].on = on;
  /* The two atlases are one choice, and this is the other place it can be made.
   *
   * `setAtlasDepth` says it plainly — the taught body and the complete atlas are
   * the same anatomy at two granularities and drawing both is two copies of one
   * body in the same space — and then turns the other side off. The layer list
   * never did: switching "Muscles — every piece" on beside "Muscles — deep" left
   * **491 structures drawn twice**, two slightly different meshes of every leg
   * muscle fighting for the same pixels. That is what "why do we have 2 legs"
   * was looking at, and it is a rule that was stated in one place and enforced
   * in one place. */
  /* The catalogue is packed from the structures that are drawn, so switching sides
   * changes it — the same reason `setAtlasDepth` ends with a relayout. Free while
   * the body is assembled: it does nothing unless the body is open. */
  if (on && holdOneAtlas(name)) relayoutExplode();
  if (on) await loadLayer(name);
  syncLayers();
  /* The reveal clones hang off the layer's own drawables, so a layer arriving or
   * leaving is a rebuild — otherwise the marker either points at nothing or is
   * missing for the layer that just turned on. */
  revealSelection();
  ui.syncControls();
}
export function setLayerOpacity(name, v) { app.layers[name].opacity = v; syncLayers(); }
/* ------------------------------------------------ the body, off the stage
 * The live scene rendered into a canvas the lab can put beside a chart.
 *
 * "Copy paste the whole 3D body there and automatically highlight those parts" — and the
 * honest way to do that is not to load a second copy of four hundred meshes. It is to render
 * the scene that is already loaded, from the camera that is already framed, into an offscreen
 * target and blit the pixels. So the body in the lab is not a likeness of the one on the
 * stage: it is the same geometry, the same skinning, the same pose at the same instant, and
 * the same palette — which means the muscles the exercise works are already lit in it, by the
 * activation the main view is using, with nothing highlighted twice or highlighted differently.
 *
 * It borrows the app's renderer and must put it back: target, `autoClear` and clear colour,
 * the same rule the section strip and the brain plate follow. It renders straight rather than
 * through the composer, because the composed path is bloom over an additive brain and this is
 * a picture of flesh and bone; and because a composer pointed at a lab-sized buffer is the
 * failure mode those two modules already document.
 *
 * Never per frame. A full scene render plus a readback is what the stage does once a frame for
 * the whole window, and doing it again for a panel would halve the frame rate for a picture
 * that changes only when the pose does.
 */
let stageTarget = null, stageOut = null;
let stageBuf = null, stageImg = null;
/* The tone map and colour-space encode, as a quad. Three does neither of them when it is
 * drawing into a render target, so an offscreen panel gets the scene and not the look — see
 * `makeFinalMaterial`. Built once, on first use, because it needs a GL context. */
let stageQuad = null, stageQuadScene = null, stageQuadCam = null;
/* The longest side the body panel is ever rendered at. The panel is about 700 CSS pixels
 * wide, so this is still above one device pixel per screen pixel on a retina display. */
const STAGE_MAX = 1000;
/* ------------------------------------------- one structure, alone and in place
 * "If external oblique, I need the 3D look of this external oblique alone, and also where it
 * is located in the body — show the whole body and where it is standing. The same for the
 * nerves and cord levels and joints."
 *
 * Two renders of the scene that is already loaded, not two new models: the same geometry, the
 * same skinning, the same instant of the same clip. One frames the structure by itself with
 * everything else hidden, so its shape can be read without a body around it; the other frames
 * the whole figure with the structure lit where it sits, and hands back the point to ring so
 * the panel can point at it. Together they answer "what does it look like" and "where is it",
 * which are two questions and were being asked as one.
 *
 * A joint and a cord level are not meshes, and neither is invented here: a joint is shown as
 * the bones it moves between with its own centre of rotation ringed, and a cord level as the
 * vertebra at that level. The panel says which of those it is doing — the C5 root is not the
 * C5 vertebra, and a caption that let the two be read as the same thing would be worse than
 * showing nothing.
 */

/**
 * Where a joint the analysis names actually is, in the pose on screen.
 *
 * Two kinds of coordinate arrive here. A real one carries the segment it drives, and a
 * segment's `joint` node *is* its centre of rotation — not `body`, which is the child's own
 * offset frame and sits somewhere else entirely. A regional spine shorthand (`thoracic_flex`)
 * drives a whole region rather than one joint, so it resolves to the middle level of that
 * region: the movement is distributed across all of them and the middle is the honest single
 * point to ring for it.
 */
export function jointCentre(coord) {
  if (!rig) return null;
  let seg = rig.coordinates?.[coord]?.segment ?? null;
  if (!seg) {
    const m = /^(lumbar|thoracic|cervical)_(?:flex|bend|rot|wave)$/.exec(coord);
    const levels = m && rig.spine?.regions?.[m[1]];
    if (levels?.length) seg = levels[Math.floor(levels.length / 2)];
  }
  const rec = seg && rig.nodes.get(seg);
  if (!rec) return null;
  rec.joint.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(rec.joint.matrixWorld);
}

/**
 * One structure's own triangles, where its mesh carries more than one structure.
 *
 * The cortex is a single mesh carrying every Desikan-Killiany parcel, so "show the motor
 * cortex on its own" by showing its mesh shows the whole cortex — a caption saying one thing
 * over a picture of another, which is the same quiet substitution the cuts made before they
 * were fixed. Every vertex already carries its parcel, so this builds a mesh over the same
 * attributes with only that parcel's triangles indexed, parented beside the original so it
 * inherits the same transform and moves with the head.
 *
 * A triangle straddling two parcels belongs to neither and is dropped, rather than handed to
 * whichever corner is read first — that would paint a fringe of one parcel onto its neighbour.
 * If every triangle survives, the mesh is that structure and nothing needs building; that test
 * is also what keeps this away from the body meshes, which carry a region attribute of their
 * own and are almost all one structure each.
 *
 * Kept once built: it is a walk over every triangle of a dense surface, and a reader moving
 * between two regions should pay for it once. The total across all parcels cannot exceed the
 * mesh's own index count.
 */
const parcelMeshes = new Map();
function parcelMesh(mesh, id) {
  const key = `${mesh.uuid}|${id}`;
  if (parcelMeshes.has(key)) return parcelMeshes.get(key);
  const reg = regionAttr(mesh.geometry);
  const idx = mesh.geometry.getIndex();
  const n = idx ? idx.count : (reg?.count ?? 0);
  let out = null;
  if (reg && n >= 3) {
    const at = i => (idx ? idx.getX(i) : i);
    const keep = [];
    for (let i = 0; i + 2 < n; i += 3) {
      const a = at(i), b = at(i + 1), c = at(i + 2);
      if ((reg.getX(a) | 0) === id && (reg.getX(b) | 0) === id && (reg.getX(c) | 0) === id)
        keep.push(a, b, c);
    }
    if (keep.length && keep.length < n) {
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(mesh.geometry.attributes)) geo.setAttribute(name, attr);
      geo.setIndex(keep);
      out = new THREE.Mesh(geo, mesh.material);
      out.visible = false;
      out.position.copy(mesh.position);
      out.quaternion.copy(mesh.quaternion);
      out.scale.copy(mesh.scale);
      mesh.parent?.add(out);
    }
  }
  parcelMeshes.set(key, out);
  return out;
}

/**
 * Hide every drawable that is not in one of these layers. Returns the undo.
 *
 * "When I want to see the bones there should be only bones on the right, and highlight the
 * bone" — and the same for nerves and for the brain. The wide view was showing the whole
 * loaded body for every structure, which for a single vertebra is a figure with a speck in it,
 * and for anything under the muscles is a speck you cannot see at all. Worse, the body layers
 * are transparent, so the far side showed through the near one and the picture read as a body
 * seen from the back.
 *
 * Shown alone, a layer answers the question the picture is actually asking. The selected
 * structure still stands out inside it because `uSelected` is already set — the same highlight
 * the main view uses when a reader turns one layer on and picks something in it, which is the
 * behaviour this was asked to match.
 */
function onlyLayers(names) {
  const want = new Set();
  for (const n of names) for (const m of layers[n]?.meshes ?? []) want.add(m);
  return onlyMeshes(want);
}

/** Hide every drawable but the meshes of `ids`. Returns the undo. */
function onlyShow(ids, opts) {
  const want = new Set();
  const extra = [];
  for (const id of ids) for (const m of meshesOfId.get(id) ?? []) {
    const sub = parcelMesh(m, id);
    /* A parcel mesh is built once and kept, and it borrowed its material at that moment — so
     * a later look change, or the specimen swap below, would leave the parcel wearing the
     * material the cortex used to have. It follows its parent every time it is shown. */
    if (sub) { sub.material = m.material; extra.push(sub); } else want.add(m);
  }
  return onlyMeshes(want, extra, opts);
}

/**
 * Hide every drawable but these. Returns the undo, or null when there is nothing to show.
 *
 * **Leaves only.** Hiding a group would take its wanted children with it, and the brain's
 * holder and the rig's segments are groups that everything else in the scene hangs from.
 * `extra` is for meshes built for this render — a single cortical parcel — which are hidden
 * again rather than restored, because they were never visible in the first place.
 */
function onlyMeshes(want, extra = [], { merged = true } = {}) {
  if (!want.size && !extra.length) return null;
  const hidden = [];
  scene.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isLine) || want.has(o) || !o.visible) return;
    /* A merged layer is one mesh standing for four hundred structures, so hiding
     * it would hide the one that was asked for along with the rest. It is left
     * alone and `applyShown` narrows it to whatever `want` holds -- which is
     * also why the wanted meshes below still have their visibility set even
     * though the renderer no longer draws them: that flag is what the merged
     * layer reads. */
    if (o.userData.merged) return;
    hidden.push(o); o.visible = false;
  });
  for (const m of want) m.visible = true;
  for (const m of extra) m.visible = true;
  applyShown();
  /* And, for one structure on its own, the merged drawables go too.
   *
   * A merged layer is one mesh standing for hundreds of structures, and hiding all
   * but one of them is a *shader* decision: the vertices are still submitted and
   * still transformed, and only then collapsed out of the clip volume. That is the
   * right trade on the stage, where the layer is being drawn anyway. It is the wrong
   * one for a 340-pixel panel thumbnail of a single muscle, which paid a vertex pass
   * over half a million triangles to draw one — **3.4 seconds of synchronous
   * rendering per click**, twice, with the whole atlas loaded, and a tab that died
   * under it.
   *
   * The per-structure meshes are still there; merging moved them off the camera's
   * layer rather than throwing them away. So the panel draws those instead — the
   * cost becomes the size of the structure, which is what a picture of one structure
   * should cost — and `PICK_LAYER` on the panel's own camera is what lets it see
   * them. `applyShown` runs first, because it decides merged visibility itself and
   * would undo this. */
  const mergedOff = [];
  if (!merged) {
    for (const name of LAYER_ORDER)
      for (const m of layers[name]?.merged ?? [])
        if (m.visible) { m.visible = false; mergedOff.push(m); }
  }
  return () => {
    for (const m of mergedOff) m.visible = true;
    for (const o of hidden) o.visible = true;
    for (const m of extra) m.visible = false;
    applyShown();
  };
}

/**
 * What share of its own mesh one structure's triangles are — 1 when the mesh *is* it.
 *
 * For the test that "on its own" really means on its own. That was measured in lit pixels for
 * a while, comparing a small parcel's close-up against a large one's, and the comparison is
 * meaningless: each view is framed to its own subject's extent, so a big parcel and a small
 * one fill the same fraction of the panel by construction. It only ever passed because the
 * renders were dark and the two happened to sit either side of a brightness threshold — the
 * moment the tone map was put back, both counted the same and the check went red on correct
 * code. This is the invariant it was reaching for, read off the geometry instead.
 */
export function parcelShare(id) {
  let own = 0, all = 0;
  for (const m of meshesOfId.get(id) ?? []) {
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count : (regionAttr(m.geometry)?.count ?? 0);
    if (!n) continue;
    all += n;
    const sub = parcelMesh(m, id);
    own += sub ? (sub.geometry.getIndex()?.count ?? 0) : n;
  }
  return all ? own / all : null;
}

/**
 * Draw the brain as the opaque specimen for the length of one panel render. Returns the undo.
 *
 * The wide view's job is "the whole brain, with this region in it", and the volume look cannot
 * do that job. It is an additive emission integral: a ray accumulates every wall of tissue it
 * crosses, so seen from outside at panel size, with no bloom and no room behind it, a brain is
 * a translucent cloud with the far hemisphere showing through the near one. On the stage that
 * is exactly the point — there is a scan plane in it and cells behind it, and the sulci read
 * as depth because the walls sum. In a 340-pixel box it is the "so confusing and dark" that
 * was reported, and the opaque specimen is the picture that answers the question instead.
 *
 * The reader's own look control is not touched: this swaps the material for one render and
 * puts it straight back, the same way the isolation does with visibility. The scan is carried
 * across so the panel and the stage still agree about where the plane is.
 */
function specimenBrain() {
  if (app.brainLook === 'anatomical' || !brainSurfaces.size) return null;
  const was = new Map();
  for (const o of brainSurfaces) { was.set(o, o.material); o.material = anatomyMat; }
  anatomyMat.userData.setScan?.(app.scan.plane ? SCAN_PLANES[app.scan.plane] : null, app.scan.at);
  return () => { for (const [o, m] of was) o.material = m; };
}

/**
 * The bones a joint coordinate moves between.
 *
 * A joint is not a mesh, so its close view has to be assembled from the things it articulates.
 * Framing the whole skeleton on the joint's centre was the first version, and it is the wide
 * view again at a shorter distance — "when representing the bone, you must isolate that bone
 * and show that bone only, not the whole body".
 *
 * A regional spine coordinate drives every level of its region at once, so its bones are those
 * vertebrae and the picture is the run of them; the region turns as a whole and there is no
 * single joint to show. Anything else drives one joint, whose bones are its own segment and
 * the parent it swings against — a femur with no pelvis behind it is not a hip.
 */
function jointSegments(coord) {
  if (!rig) return [];
  const m = /^(lumbar|thoracic|cervical)_(?:flex|bend|rot|wave)$/.exec(coord);
  const levels = m && rig.spine?.regions?.[m[1]];
  if (levels?.length) return levels.slice();
  const seg = rig.coordinates?.[coord]?.segment;
  if (!seg) return [];
  const p = rig.nodes.get(seg)?.seg?.parent;
  return p ? [seg, p] : [seg];
}

/** The skeleton meshes riding these segments. */
function bonesOf(segments) {
  const set = new Set(segments);
  const out = new Set();
  for (const m of layers.skeleton?.meshes ?? [])
    if (set.has(bound.get(m)?.segment)) out.add(m);
  return out;
}

const BOX_CORNERS = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
/**
 * Where to stand to see those bones, framed on the bones themselves.
 *
 * Not on a sphere around the joint centre, which is what the first version did and which
 * doubles the frame for nothing: a joint sits at one end of what it articulates, so a sphere
 * big enough to contain the bones *from there* is twice the size of the bones. Framed that
 * way the thoracic spine came out an eighth of the panel wide in an otherwise black box, which
 * is a close-up in name only. The ring still marks the joint — it is projected from `at`
 * afterwards and needs no help from the framing.
 *
 * Eight corners per mesh rather than a centre and a radius, because `frameFor` fits a point
 * cloud and a bone is nothing like a sphere. Bones ride their segment rigidly, so a world
 * bounding box is the *posed* box; the same measurement on a skinned mesh returns the rest
 * pose, which is the trap `frameRig` already documents.
 */
function boneVantage(meshes, aspect, orbit, at) {
  const pts = [];
  const box = new THREE.Box3();
  for (const m of meshes) {
    box.makeEmpty();
    box.setFromObject(m);
    if (box.isEmpty()) continue;
    for (const [i, j, k] of BOX_CORNERS)
      pts.push(new THREE.Vector3(i ? box.max.x : box.min.x,
                                 j ? box.max.y : box.min.y,
                                 k ? box.max.z : box.min.z));
  }
  if (pts.length < 8) return null;
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  /* The same rule the structure vantage follows: a spine joint is on the midline, where the
   * direction from the centre degenerates, so it takes the lateral view — which is also the
   * view a flexing or rotating spine reads in. A limb joint is off the midline and is seen
   * from its own side. */
  const x = at?.x ?? c.x;
  const dir = Math.abs(x) < 0.02 ? LEFT_VIEW.clone()
            : new THREE.Vector3(x, 0, Math.abs(c.z) + 0.25).normalize();
  if (dir.x < 0.15) { dir.x = 0.5; dir.normalize(); }   // never straight down the midline
  const { target, distance } = frameFor(pts, dir, BONY_PAD, 0.02, 0, { aspect, inset: false });
  return { eye: target.clone().addScaledVector(orbited(dir, orbit), distance / zoomOf(orbit)),
           target };
}

/**
 * Where to stand to see one structure, for a frame of the given aspect.
 *
 * The same rule `flyTo` uses — a paired structure's centroid is on the midline, so its
 * direction from the centre is degenerate and it takes a fixed left-lateral vantage — minus
 * `clearestDir`, which exists to see past whatever is in front of a structure in the live
 * view. Nothing is in front of it here: everything else has been hidden.
 */
/**
 * Which layers the wide view shows for a structure.
 *
 * Its own, and only its own: a bone against the skeleton, a nerve against the nervous system,
 * a brain structure against the brain. The two muscle layers travel together because
 * superficial and deep are one anatomical picture split by depth for the layer switch, and a
 * muscle shown against only its own half sits in a body with holes in it.
 */
const VIEW_LAYERS = {
  muscles_superficial: ['muscles_superficial', 'muscles_deep'],
  muscles_deep: ['muscles_superficial', 'muscles_deep'],
};
const viewLayers = id => {
  const l = id != null ? get(id)?.layer : null;
  return l ? (VIEW_LAYERS[l] ?? [l]) : ['skeleton'];
};

const BONY_PAD = 0.012;   // body heights: a bone's surface barely leaves its joint centre
const UP_Y = new THREE.Vector3(0, 1, 0);
function vantageFor(id, aspect, at = null, span = 0.12, orbit = null) {
  const side = id != null ? posedSide(id) : null;
  const c = side?.centre ?? (id != null ? app.centroids[id] : null) ?? at;
  if (!c) return null;
  const r = id != null ? get(id) : null;
  /* The floor is a guard against a degenerate cloud, not a statement about how big a
   * structure is, and at 0.03 of a body height it was the second: the left colic artery has a
   * radius of 0.005, so it was framed for a sphere six times its own size and drawn as a
   * squiggle a few pixels across in the middle of a black panel. Sixty-six of seventy-four
   * sampled arteries covered under one per cent of the picture, and thirty of thirty-seven
   * veins. That is what "a lot of them don't have the 3d view" is: the view is there, and the
   * thing in it was framed too far away to see.
   *
   * Low enough now that it binds only where the extent really is degenerate, and the distance
   * floor below follows the subject instead of sitting at a fixed 0.06. */
  const radius = id != null ? Math.max(0.006, (app.radii[id] ?? 0.05) * 1.9) : span;
  const bilateral = r?.sides?.length === 2 || Math.abs(c.x) < 0.02;
  let dir = bilateral ? LEFT_VIEW.clone()
          : new THREE.Vector3(c.x, 0, Math.abs(c.z) + 0.25).normalize();
  if (dir.x < 0.15) { dir.x = 0.5; dir.normalize(); }
  const pts = (side?.points?.length ?? 0) >= 4 ? side.points.slice() : [];
  if (pts.length < 4)
    for (const v of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
      pts.push(c.clone().addScaledVector(new THREE.Vector3(...v), radius));
  const { target, distance } =
    frameFor(pts, dir, radius * 0.45, Math.max(0.02, radius * 1.2), 0,
             { aspect, inset: false });
  return { eye: target.clone().addScaledVector(orbited(dir, orbit), distance / zoomOf(orbit)),
           target };
}

/* Turning the specimen. The *fit* is left alone — the target and the distance are still solved
 * against the structure's own extent — and only the eye is swung around it, so a reader can
 * turn a muscle over without the framing jumping about as they do. Pitch is clamped short of
 * the pole, where the up vector degenerates and the view rolls. */
function orbited(dir, orbit) {
  if (!orbit) return dir.clone();
  const d = dir.clone().applyAxisAngle(UP_Y, orbit.yaw ?? 0);
  const right = new THREE.Vector3().crossVectors(UP_Y, d).normalize();
  const pitch = THREE.MathUtils.clamp(orbit.pitch ?? 0, -1.4, 1.4);
  return d.applyAxisAngle(right, pitch);
}
const zoomOf = orbit => THREE.MathUtils.clamp(orbit?.zoom ?? 1, 0.25, 6);

/**
 * Where to stand to see one whole layer, framed on its own structures.
 *
 * The cloud is the posed centroids of every structure in the layer, which `refreshPosed` keeps
 * current, so this follows the head when the head moves. Padded by each structure's own radius
 * rather than by a body constant: a centroid is inside its mesh, and for an organ the size of
 * a brain half a thigh of margin is most of the picture.
 */
function layerVantage(name, aspect, orbit = null) {
  const pts = [];
  for (const [id, r] of registry().byId) {
    if (r.layer !== name) continue;
    const c = app.centroids[id];
    if (!c) continue;
    const rad = Math.max(0.004, app.radii[id] ?? 0.01);
    for (const v of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
      pts.push(c.clone().addScaledVector(new THREE.Vector3(...v), rad));
  }
  if (pts.length < 6) return null;
  const box = new THREE.Box3();
  for (const p of pts) box.expandByPoint(p);
  const dir = HEAD_DIR.clone();
  const { target, distance } = frameFor(pts, dir, 0.004, 0.02, 0, { aspect, inset: false });
  return { eye: target.clone().addScaledVector(orbited(dir, orbit), distance / zoomOf(orbit)),
           target };
}

/** Where to stand to see the whole figure as it is posed right now. */
function bodyVantage(aspect, orbit = null, pad = null) {
  if (!rig) return null;
  const pts = [];
  jointCloud(pts);
  if (!pts.length) return null;
  const box = new THREE.Box3();
  for (const p of pts) box.expandByPoint(p);
  const dir = poseVantage(pts, box.getCenter(new THREE.Vector3()));
  const { target, distance } =
    frameFor(pts, dir, pad ?? bodyFlesh(), 0.02, 0, { aspect, inset: false });
  return { eye: target.clone().addScaledVector(orbited(dir, orbit), distance / zoomOf(orbit)),
           target };
}

/**
 * One structure, drawn into a panel canvas.
 *
 * `alone` hides everything else and frames the structure; otherwise the whole figure is framed
 * as it stands and the structure is left lit by the selection it already carries. Either way
 * the return carries `sx`/`sy` — the structure's own posed centre projected into the canvas,
 * 0 to 1 across and down — so the caller can ring it rather than leave the reader to find it.
 * `at` overrides that point, which is how a joint centre is ringed without being a mesh.
 */
export function renderStructureInto(canvas, width, height, id,
                                    { alone = true, at = null, span = 0.12, orbit = null,
                                      coord = null } = {}) {
  if (!canvas || !renderer || !(width > 0) || !(height > 0)) return null;
  const meshes = id != null ? (meshesOfId.get(id) ?? []) : [];
  if (alone && !meshes.length && !at) return null;
  const scale = Math.min(1, STAGE_MAX / Math.max(width, height));
  const w = Math.max(64, Math.round(width * scale)), h = Math.max(64, Math.round(height * scale));
  /* Measured before anything is framed: `boneVantage` reads world bounding boxes, and a stale
   * matrix would frame the joint where the body was standing before the clip moved it. */
  root.updateMatrixWorld();
  /* A joint's own bones, for the close view. `alone` with no id is a joint, and it is the one
   * case where what to show has to be worked out rather than looked up. */
  const jbones = alone && id == null && coord ? bonesOf(jointSegments(coord)) : null;
  /* The pad is how far the *flesh* reaches past the rig's joints, which is the right margin
   * for framing a muscled body and far too generous for a skeleton: with the meat hidden it
   * leaves the figure a small shape in a large black frame. A layer without flesh in it gets
   * a bare margin instead. */
  const shown = viewLayers(id);
  const bony = !alone && !shown.some(n => n.startsWith('muscles'));
  /* A layer that is not the body is not framed like one. Showing the brain alone and framing
   * the rig's joints puts a brain two per cent of the picture wide inside an empty figure —
   * the isolation and the framing pulling opposite ways. `layerVantage` fits the layer's own
   * structures instead, so "the brain, with this region lit" is a picture of a brain. */
  const aim = alone
            ? ((jbones?.size ? boneVantage(jbones, w / h, orbit, at) : null)
               ?? vantageFor(id, w / h, at, span, orbit))
            : (shown.length === 1 && shown[0] === 'brain'
                 ? layerVantage('brain', w / h, orbit)
                 : bodyVantage(w / h, orbit, bony ? BONY_PAD : null));
  if (!aim) return null;

  const cam = camera.clone();
  cam.aspect = w / h;
  cam.position.copy(aim.eye);
  cam.up.set(0, 1, 0);
  cam.lookAt(aim.target);
  cam.near = Math.max(0.001, aim.eye.distanceTo(aim.target) * 0.02);
  cam.far = aim.eye.distanceTo(aim.target) * 6 + 4;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  root.updateMatrixWorld();
  boneDQ?.update();
  /* The close view isolates the *structure*; the wide view isolates its *layer*.
   *
   * A joint has no mesh, so its close view is the skeleton framed on its own centre of
   * rotation — the two bones it moves between, which is what a joint looks like. Leaving the
   * flesh in place was the first version and it showed a whole muscled body with a ring on it,
   * which is the wide view again rather than a close one. */
  /* Before the isolation, so the parcel mesh the close view builds picks up the specimen
   * material rather than the volume one it would otherwise inherit. */
  const look = shown.length === 1 && shown[0] === 'brain' ? specimenBrain() : null;
  const undo = alone
    ? (id != null ? onlyShow([id], { merged: false })
                  : (jbones?.size ? onlyMeshes(jbones, [], { merged: false })
                                  : onlyLayers(['skeleton'])))
    : onlyLayers(viewLayers(id));
  /* The un-merged meshes live on the layer the stage's camera does not render — see
   * `merged.js`. This is the camera that has to see them. */
  if (alone) cam.layers.enable(PICK_LAYER);
  /* And the wide view is not subject to the stage's peel.
   *
   * Selecting a structure deliberately strips away everything in front of it, which is right
   * on the stage and wrong here: this picture's entire job is "where is it in the body", and
   * with a brain region chosen the peel took the body down to six per cent and left a ghost
   * with a ring floating at its head. The peel is a property of the stage, not of the
   * geometry, so it is suspended for the length of this one render and put straight back. */
  let peel = null;
  if (!alone && app.selected != null && !app.autoSelected) {
    app.autoSelected = true; syncLayers();
    peel = () => { app.autoSelected = false; syncLayers(); };
  }
  /* Both of those left the scene in a state only this function knows how to undo, so the undo
   * is in a `finally`: a throw inside the render would otherwise leave the body permanently
   * hidden, or the stage's peel permanently off, with nothing on screen to say why. */
  let ok = false;
  try { ok = paintInto(canvas, w, h, cam, aim.target); } finally { undo?.(); peel?.(); look?.(); }
  if (!ok) return null;

  const mark = at ?? (id != null ? posedSide(id)?.centre ?? app.centroids[id] : null) ?? null;
  if (!mark) return { sx: null, sy: null };
  const v = mark.clone().project(cam);
  return { sx: (v.x + 1) / 2, sy: (1 - v.y) / 2, front: v.z < 1 };
}

export function renderStageInto(canvas, width, height) {
  if (!canvas || !renderer || !(width > 0) || !(height > 0)) return false;
  /* Capped, because the cost of this is the readback and the readback is priced in pixels.
   * The panel asks in device pixels, so a retina display asked for four times the area of a
   * screen that looks identical at arm's length — 5.8 MB pulled back across the bus per
   * render, synchronously, mid-frame. `readRenderTargetPixels` is a pipeline stall by
   * construction: the GPU has to finish everything queued before it can answer. At the cap
   * this is 1.4 MB and the panel is still drawn at more pixels than it is shown at, so the
   * picture is sharp and the stall is a quarter of what it was. */
  const scale = Math.min(1, STAGE_MAX / Math.max(width, height));
  const w = Math.max(64, Math.round(width * scale)), h = Math.max(64, Math.round(height * scale));
  /* The stage's camera framed for the stage's aspect. The panel is a different shape, so the
   * aspect is overridden on a clone — writing it onto the real camera would reframe the live
   * view every time this panel drew. */
  const cam = camera.clone();
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  /* Self-sufficient about the pose. This is called from the lab's tick, which runs *before*
   * the loop updates the world matrices and the bone quaternions, so relying on them would
   * draw the body one frame behind — and after a scrub, one pose behind. */
  root.updateMatrixWorld();
  boneDQ?.update();

  return paintInto(canvas, w, h, cam);
}

/**
 * Render the loaded scene through `cam` into an offscreen target and blit it to a 2D canvas.
 *
 * Every panel that borrows the renderer goes through here, so the state it has to put back —
 * target, `autoClear`, clear colour, clear alpha — is saved and restored in one place rather
 * than in each of them. A composed pipeline handed back pointing at a panel-sized buffer draws
 * the whole window into a thumbnail, which is the failure this exists to make impossible.
 *
 * **It is two renders, and the second one is not optional.** Three applies neither tone
 * mapping nor the linear→sRGB encode when it is drawing into a render target: `WebGLPrograms`
 * forces `NoToneMapping` for any target that is not the canvas, and the output colour space
 * for a non-XR target is the linear working space. So the first version of this read back raw
 * linear radiance and painted it into a canvas that treats bytes as sRGB, which darkens every
 * midtone by more than half — the structure pair measured a **mean of 3.4 out of 255, with no
 * pixel anywhere above 126**, and read as an almost black box. The scene was drawing correctly
 * the whole time; the last two steps of the stage's own pipeline were missing from it.
 *
 * The scene therefore goes into a **half-float** buffer, and one full-screen quad carrying
 * `finalPass`'s own shader does ACES and sRGB into an 8-bit buffer that is what gets read
 * back. Half-float for the first one because ACES has to see the render's real range: tone
 * mapping an image that has already been quantised to eight bits of linear is tone mapping in
 * the dark, and the deep end — which is most of this picture — is exactly where the codes have
 * run out. The quad costs a fraction of the scene render it follows.
 */
/**
 * A key light that stands where the panel's camera stands.
 *
 * The scene's lights are fixed in world space -- key front-right-high, rim behind -- which is
 * the right rig for a body seen from the front and the wrong one for a panel, whose camera is
 * put wherever the *structure* is best seen. `facingDir` sends it round to the left for a left
 * latissimus and behind for a rhomboid, and from there the subject is lit by a 0.34 fill and a
 * rim it is facing away from. Measured on the serratus posterior inferior: a mean of **5.9 out
 * of 255** with nothing above 154, which is a black rectangle with a shape faintly in it, and
 * it is what "a lot of them don't have the 3d view" was looking at.
 *
 * So the panel carries its own key, placed at the camera and lifted, plus a soft fill from the
 * other side to keep the far half from going to pure black. Added for the length of one render
 * and taken out again: the stage's own look is deliberate and none of this touches it.
 */
const panelKey = new THREE.DirectionalLight(0xf4f8ff, 1.25);
const panelFill = new THREE.DirectionalLight(0x9fc0f0, 0.42);
const _pk = new THREE.Vector3(), _pu = new THREE.Vector3(), _pr = new THREE.Vector3();

function lightFor(cam, at) {
  /* Up and to the right of the lens, which is where a photographer puts a key: straight down
   * the lens is flat and tells you nothing about the shape. */
  cam.getWorldDirection(_pk);
  _pu.set(0, 1, 0);
  _pr.crossVectors(_pk, _pu).normalize();
  panelKey.position.copy(cam.position)
    .addScaledVector(_pr, 0.55).addScaledVector(_pu, 0.62);
  panelFill.position.copy(cam.position)
    .addScaledVector(_pr, -0.85).addScaledVector(_pu, -0.15);
  panelKey.target.position.copy(at ?? controls.target);
  panelFill.target.position.copy(panelKey.target.position);
  scene.add(panelKey, panelKey.target, panelFill, panelFill.target);
  return () => scene.remove(panelKey, panelKey.target, panelFill, panelFill.target);
}

function paintInto(canvas, w, h, cam, aimAt = null) {
  if (!stageTarget || stageTarget.width !== w || stageTarget.height !== h) {
    stageTarget?.dispose(); stageOut?.dispose();
    stageTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: true, stencilBuffer: false,
    });
    stageOut = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: false, stencilBuffer: false,
    });
  }
  if (!stageQuad) {
    stageQuadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    stageQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
                               makeFinalMaterial(renderer.toneMappingExposure));
    stageQuad.frustumCulled = false;
    stageQuadScene = new THREE.Scene();
    stageQuadScene.add(stageQuad);
  }
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  /* The fog belongs to the subject — see `fitFog` — and this camera has a different one.
   * Restored below with everything else this borrows, because the stage's next frame may
   * be drawn before its own `fitFog` runs. */
  const prevFog = { near: scene.fog.near, far: scene.fog.far };
  fitFog(cam, aimAt ?? controls.target);
  const unlight = lightFor(cam, aimAt);
  renderer.setRenderTarget(stageTarget);
  renderer.autoClear = true;
  renderer.setClearColor(0x060b14, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, cam);

  stageQuad.material.uniforms.tDiffuse.value = stageTarget.texture;
  stageQuad.material.uniforms.uExposure.value = renderer.toneMappingExposure;
  renderer.setRenderTarget(stageOut);
  renderer.clear(true, true, false);
  renderer.render(stageQuadScene, stageQuadCam);

  /* Both buffers are kept between calls. Allocating a megabyte and a half of typed array on
   * every render, several times a second, hands the collector a large short-lived object at
   * exactly the moment the frame is already stalled on the readback. */
  if (stageBuf?.length !== w * h * 4) stageBuf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(stageOut, 0, 0, w, h, stageBuf);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAuto;
  renderer.setClearColor(prevClear, prevAlpha);
  scene.fog.near = prevFog.near; scene.fog.far = prevFog.far;
  unlight();

  const c = canvas.getContext('2d');
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; stageImg = null; }
  if (!stageImg || stageImg.width !== w || stageImg.height !== h) stageImg = c.createImageData(w, h);
  for (let y = 0; y < h; y++) {           // GL reads bottom-up, a canvas is top-down
    const src = (h - 1 - y) * w * 4;
    stageImg.data.set(stageBuf.subarray(src, src + w * 4), y * w * 4);
  }
  c.putImageData(stageImg, 0, 0);
  return true;
}

/** The renderer and the composed pipeline, for tests that have to measure the real frame. */
export const gfx = {
  get renderer() { return renderer; },
  get composer() { return composer; },
  get bloomPass() { return bloomPass; },
  // so a test can project a point itself and compare with where a label was put
  get camera() { return camera; },
  // and so the session layer can light structures from a measurement rather
  // than from an authored role -- see src/session/. Read-only, like the rest.
  get palette() { return palette; },
};
/**
 * Rebuild the composed pipeline, keeping bloom unless told otherwise.
 *
 * It used to call `buildComposer(w, h)` with no third argument, so the one function whose
 * whole job is to rebuild the pipeline rebuilt it without the pass that makes the look —
 * silently, because a scene with no bloom is a scene, not an error. `withBloom` defaults to
 * whatever the pipeline currently has; pass it explicitly to force the composed look on a
 * software renderer, which is the only way to photograph it in a container with no GPU.
 */
export function rebuildComposer(withBloom = app.bloom) {
  const r = canvas.getBoundingClientRect();
  app.bloom = !!withBloom;
  buildComposer(Math.round(r.width), Math.round(r.height), app.bloom);
}

/* ------------------------------------------------------- exercise activation
 * Roles drive the palette's alpha channel, which is what the shader reads as activation.
 * This is a role, not a measurement — the legend in the UI says so in as many words. */
const activation = new Map();   // id -> role

export async function setExercise(key) {
  // An unknown key used to throw partway through and leave the app half-configured — the
  // palette cleared, the layers untouched, and nothing on screen to say why. It reads as
  // no exercise instead, which is a state the rest of this function already handles.
  if (key && !EXERCISE[key]) { console.warn(`no exercise "${key}"`); key = null; }
  app.exercise = key;
  app.group = null;               // one owner of the activation channel at a time
  activation.clear();
  palette.clearActivation();
  brainMarked = [];               // no exercise means nothing marked, including on the brain
  applyBrainMarks();
  if (key) {
    const ex = EXERCISE[key];
    await setLayer('muscles_superficial', true);
    await setLayer('muscles_deep', true);
    for (const role of ['prime', 'synergists', 'stabilisers']) {
      for (const [name] of ex.muscles[role]) {
        /* `drawnIds` rather than one record, because six muscles are kept as
         * their named parts: an entry naming `trapezius` lights all three of
         * them, which is nearer the truth than lighting one merged belly was. */
        const ids = drawnIds(name);
        if (!ids.length) { console.warn(`exercise ${key} names an unknown muscle: ${name}`); continue; }
        for (const id of ids) {
          activation.set(id, role);
          palette.setActivation(id, ROLE_LEVEL[role]);
        }
      }
    }
    /* And the brain. An exercise carries its own brain claims, each naming the structures it
     * is about, so "which parts of the brain does this exercise concern" has an answer already
     * written down with a tier and a citation on it — it does not have to be guessed and it
     * must not be. Those regions are marked here so a reader who picks an exercise sees them
     * without hunting.
     *
     * **Uniform, deliberately.** The obvious next step is to light them in proportion to how
     * many of the exercise's claims name each one, and that would be a fabrication in the
     * shape of an instrument reading: a gradient across regions reads as "this one is 75%
     * active", and nothing in this repository records a brain. The counts are real and are
     * printed as counts in the lab; the picture marks which regions, not how much. */
    await markBrainForExercise(key);
    setView('anterior');
  }
  // §9: an exercise with a clip gets the scrubber; one without says so rather than
  // pretending the pose on screen is the movement
  app.hasMotion = !!(key && MOTION[key]);
  app.t = 0; app.playing = false;
  if (app.hasMotion) {
    /* The movement view opens as skeleton plus muscle paths. The meshes no longer tear —
     * `skin.js` skins them to the rig — but they still cost seven hundred thousand triangles
     * a frame, and the paths are the source of truth for anything numeric because their
     * points attach to the bones the muscle really attaches to. So meshes stay one toggle
     * away, with what their skinning does and does not know attached. */
    await loadLayer('skeleton');
    app.layers.skeleton.on = true;
    // Meshes on. They used to be off here because a rigidly-bound muscle tore open the
    // moment a joint moved, and later because the skinning weights dragged the whole layer
    // into a blob. Neither is true now: weights run along each muscle's own span, so a
    // muscle bends with the joint it crosses. The paths stay one toggle away and remain the
    // source of truth for anything numeric.
    setShowMeshes(true);
    setShowPaths(false);
    poseFromClip(0);
    frameRig(false, true);
  } else if (rig) {
    rig.reset(); markPosed(false);
    setShowPaths(false);
    setShowMeshes(true);
    afterPose();
  }
  for (const m of materials) m.userData.sync?.();
  syncLayers();
  ui.relabel();
}

export const activationOf = id => activation.get(id) ?? null;

/**
 * Show an anatomical group: the hamstrings, the pelvic floor, the lumbar spine.
 *
 * A group is a set of structures the ontology already had a name for, and this
 * lights all of them at once. It uses the same channel an exercise uses, for
 * the reason given on `app.group`: the two are alternative answers to "which
 * muscles are we talking about", and two sets lit at the same level with
 * different meanings is a picture nobody can read.
 *
 * **Everything in the group is lit at the same level, deliberately.** An
 * exercise grades its muscles because it has roles to grade them by, each with
 * an evidence marker on it. A group has no roles — the ontology says these
 * eleven structures are the pelvic girdle's muscles, not that any of them
 * matters more — so a gradient here would be a number this repository does not
 * have, drawn in the shape of one it does.
 *
 * The layers the members live in are turned on first. A group lit under a layer
 * that is off is a statement nobody can see, and it was the first thing that
 * went wrong: choosing the deep spinal muscles from a default view lit fourteen
 * meshes inside a layer that had never been loaded.
 */
export async function setGroup(fma) {
  const g = fma ? groupOf(fma) : null;
  if (fma && !g) { console.warn(`no anatomical group "${fma}"`); fma = null; }
  app.group = g ? fma : null;
  app.exercise = null;
  activation.clear();
  palette.clearActivation();
  /* The sheet is laid out for whatever is chosen -- see `explodeSubject` -- so choosing or
   * clearing a group changes what it is a sheet of. Free while the body is together. */
  if (!g) { relayoutExplode(); for (const m of materials) m.userData.sync?.();
            syncLayers(); ui.relabel(); return; }
  for (const layer of onThisAtlas(g.layers.filter(hasLayer))) {
    app.layers[layer].on = true;
    holdOneAtlas(layer);
    await loadLayer(layer);
  }
  for (const id of g.members) {
    activation.set(id, 'group');
    palette.setActivation(id, GROUP_LEVEL);
  }
  relayoutExplode();
  for (const m of materials) m.userData.sync?.();
  syncLayers();
  flyToGroup(g.members);
  ui.relabel();
}

/**
 * Draw one structure, or one group, and nothing else.
 *
 * Pass an id, an array of ids, or null to put the body back. The layers the
 * isolated structures live in are turned on first, for the same reason
 * `setGroup` does it: isolating something inside a layer that is off leaves an
 * empty stage and no way to tell that from a bug.
 *
 * It is the fastest state this application has. Everything else is a question
 * about how to draw seven hundred meshes at once; this one draws two.
 */
export async function setIsolate(ids) {
  const list = ids == null ? [] : (Array.isArray(ids) ? ids : [ids]).map(Number)
    .filter(id => get(id));
  app.isolate = list.length ? new Set(list) : null;
  if (app.isolate) {
    for (const id of app.isolate) {
      const layer = get(id)?.layer;
      if (!layer || !hasLayer(layer)) continue;
      app.layers[layer].on = true;
      await loadLayer(layer);
    }
  }
  /* Isolating something selects it. Without this the panel could be describing one structure
   * while the stage drew another — and `flyTo` below, the labels, and the natural-colour
   * surface above are all keyed on the selection, so a piece isolated from the layer list
   * would have been framed as a group and named as a stranger. */
  if (list.length === 1 && app.selected !== list[0]) {
    app.selected = list[0];
    app.autoSelected = false;
    ui?.showStructure?.(list[0]);
  }
  /* Isolating puts the body back together.
   *
   * A catalogue is a way of seeing two thousand things at once; a catalogue of one piece is
   * not a catalogue, it is one piece a long way from the camera with two thousand empty cells
   * around it. Every reader who picks something out of the sheet and asks to see it alone
   * means "take it out of the sheet", so the sheet closes. The slider goes back to nothing
   * with it, so the control on screen says what the picture is doing.
   *
   * It happens before the flight, because the flight is fitted to where the piece is drawn
   * and this is what decides that. */
  if (app.isolate && app.explode > 0) { setExplode(0); ui?.syncControls?.(); }
  syncLayers();
  refreshSections();
  ui?.relabel?.();
  /* One piece is framed as a piece, not as a group.
   *
   * `flyToGroup` fits a cloud from a fixed left-lateral vantage with a flesh-thickness pad,
   * which is the right answer for a pelvic floor and the wrong one for a single structure:
   * it put the rectus abdominis edge-on, a flat strap seen from the side, a third of the way
   * across the stage. Isolating is the strongest way of asking to look at one thing, so it
   * gets the closest look this application has. */
  if (!app.isolate) resetView();
  else if (list.length === 1) flyTo(list[0]);
  else flyToGroup(list);
}

/* ------------------------------------------------------------- taking it apart
 *
 * A body is hundreds of structures packed into the shape of a person, and most
 * of them are behind another one. X-ray answers that by making what is in front
 * translucent; this answers it by moving what is in front out of the way.
 *
 * **Two layouts, because they answer two different questions.**
 *
 * `open` pushes every structure away from the body's own vertical axis at its
 * own height, deeper layers moving less -- so the ribs open like a cage and the
 * deep spinal muscles are left standing on the midline with nothing over them.
 * That is the picture for *how many layers deep does this go*.
 *
 * `inventory` lays every piece out on a regular grid, sorted by layer and then
 * by name, so the whole atlas can be read at once as a catalogue: every bone
 * together, every muscle together, each one separated from its neighbours and
 * none of them hiding any other. That is the picture for *what is in here*, and
 * it is the one this defaulted to being unable to draw. A comment here used to
 * dismiss it as sorting by nothing anatomical; that was wrong twice over, since
 * it sorts by exactly the grouping the layer list already uses, and since being
 * able to see the whole inventory is the thing an atlas is for.
 *
 * Both are computed once, from the centroids the geometry index already
 * measured, and uploaded as a texture the vertex shader reads. Moving the slider
 * costs one uniform write, not hundreds of matrix updates -- which matters,
 * because this is exactly the control somebody drags back and forth.
 */
const EXPLODE_REACH = 0.42;      // body heights at full separation, `open`
/** Structures nearer the midline than this get a direction rather than a wobble. */
const AXIS_EPSILON = 0.012;
/** One cell, in body heights. Every piece is scaled to sit inside one. */
const CELL = 0.052;
/** The share of a cell left empty, so neighbours never touch. */
const GUTTER = 0.22;
/** How much a small piece may be blown up. Past this a sesamoid reads as a femur. */
const MAX_MAGNIFY = 3.2;
/** Wider than tall, because a screen is. */
const GRID_ASPECT = 1.9;

export const EXPLODE_LAYOUTS = ['inventory', 'open'];

/** Where the laid-out grid sits and how big it is, so a camera can be fitted to it. */
let explodeExtent = null;
export const explodeLayoutExtent = () => explodeExtent;
/** Where a structure is displaced to when the body is apart. For diagnosing a piece that stays put. */
export const paletteOffsetOf = (id) => palette.getOffset(+id, new THREE.Vector3());

/** Everything with a mesh of its own, in the order the inventory reads. */
/**
 * What the sheet is a sheet *of*.
 *
 * Taking the body apart lays out every piece in the atlas, and that is right when the body is
 * the subject. It is wrong the moment something smaller is: a reader who picks the hamstrings
 * and then opens them got four muscles scattered to the four corners of a two-thousand-cell
 * page, each one a speck, with the rest of the body between them. What they asked to take
 * apart was the hamstrings.
 *
 * So the layout has a subject. A chosen group is it; failing that, an isolated set; failing
 * both, the whole atlas, which is the catalogue this was written for. Aggregates are expanded
 * to the pieces that are actually drawn, because a group names muscles and some of those are
 * drawn in parts.
 */
function explodeSubject() {
  const pick = new Set();
  const take = (id) => { for (const d of drawnIds(id)) if (app.centroids[d]) pick.add(d); };
  const g = app.group ? groupOf(app.group) : null;
  if (g?.members?.length) for (const id of g.members) take(id);
  else if (app.isolate?.size) for (const id of app.isolate) take(id);
  else return null;
  return pick.size ? pick : null;
}

function inventoryOrder() {
  const { byId } = registry();
  const only = explodeSubject();
  const rows = [];
  for (const [id, r] of byId) {
    // an aggregate has no geometry, so it has nothing to lay out -- its parts do
    if (r.parts || !app.centroids[id]) continue;
    if (only && !only.has(id)) continue;
    rows.push({ id, layer: r.layer, name: r.name.en });
  }
  const rank = n => { const i = LAYER_ORDER.indexOf(n); return i < 0 ? 99 : i; };
  for (const r of rows) r.rank = rank(r.layer);
  rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return rows;
}

/**
 * Lay every piece out so that no two of them touch.
 *
 * A fixed cell cannot do this. The pieces in this atlas run from a sesamoid bone
 * to a femur, a factor of thirty in size, so a cell sized for the median leaves
 * the long bones lying across four of their neighbours -- which is what the first
 * version drew, and it is the difference between a catalogue and a heap. A cell
 * sized for the femur instead spreads two thousand pieces over a field so wide
 * that everything in it is a speck.
 *
 * So the shelf packs rather than tiles. Pieces are sorted by size, which puts
 * things of a like size beside each other; each row is as tall as its own tallest
 * piece; and within a row each piece advances by its own width. Rows break at a
 * target width chosen so the whole thing comes out roughly as wide as a screen is.
 * Nothing overlaps at any count, and the grid stays dense, because those two are
 * only in tension if every cell has to be the same size.
 */
function inventoryOffsets() {
  const only = explodeSubject();
  const rows = inventoryOrder();
  if (!rows.length) { explodeExtent = null; return; }

  /* One cell for everything, and every piece scaled into it.
   *
   * Laid out at their true sizes these pieces cover three body heights, which puts
   * the camera nine body heights back and turns the sheet into a dark smear —
   * measured, not guessed. Normalised, the same 1,280 pieces are a page you can
   * read, which is what an inventory is for. A cap keeps a sesamoid bone from
   * being blown up to the size of a femur and reading as one. */
  /* Six columns is a page width for two thousand pieces and a scatter for four: the
   * hamstrings came out one per corner with nothing in between. A small subject gets a grid
   * shaped to it, so four pieces are a square and nine are three across. */
  const cols = rows.length <= 24
    ? Math.max(1, Math.round(Math.sqrt(rows.length * GRID_ASPECT)))
    : Math.max(6, Math.round(Math.sqrt(rows.length * GRID_ASPECT)));
  const lines = Math.ceil(rows.length / cols);
  const cell = CELL;
  const inner = cell * (1 - GUTTER);

  /* Centred on the body's own middle, measured from the pieces themselves rather
   * than from a frame constant -- `FRAME` describes the brain's placement, and
   * using it here put the catalogue at the height of somebody's forehead. */
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) {
    const y = app.centroids[r.id].y;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const midY = (lo + hi) / 2;

  /* Everything that is not the subject goes home. The layout only writes the cells it uses,
   * so without this a reader who laid out the whole atlas and then chose a group left two
   * thousand pieces standing where the previous sheet had put them. */
  if (only) {
    for (const [id] of registry().byId) {
      if (only.has(id) || !app.centroids[id]) continue;
      const c = app.centroids[id];
      palette.setOffset(id, 0, 0, 0);
      palette.setScale(id, 1, c.x, c.y, c.z);
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c = app.centroids[r.id];
    /* Sized on the reach, not the average: what has to fit in the cell is the
     * whole piece. Magnification is still capped, so a sesamoid is not blown up
     * to read as a femur, but nothing is ever made bigger than its cell. */
    const reach = Math.max(0.004, app.extent[r.id] ?? app.radii[r.id] ?? 0.02);
    const k = Math.min(MAX_MAGNIFY, inner / (2 * reach));
    const col = i % cols, ln = (i / cols) | 0;
    const x = (col - (cols - 1) / 2) * cell;
    const y = midY - (ln - (lines - 1) / 2) * cell;
    /* The piece shrinks about its own centroid and then the centroid is moved to
     * its cell, so the offset is measured from where the centroid ends up rather
     * than from where the geometry was. */
    palette.setScale(r.id, k, c.x, c.y, c.z);
    palette.setOffset(r.id, x - c.x, y - c.y, -c.z);
  }
  explodeExtent = { width: cols * cell, height: lines * cell,
                    centre: new THREE.Vector3(0, midY, 0),
                    cell, cols, rows: lines, pieces: rows.length };
  palette.upload();
}

function openOffsets() {
  const { byId } = registry();
  const only = explodeSubject();
  const out = new THREE.Vector3();
  /* Opening a handful of muscles is not opening a body, so the reach is the subject's own.
   * At the body's reach four hamstrings fly a third of a body height apart and the group
   * stops being a group. */
  let spread = EXPLODE_REACH;
  if (only) {
    let lo = Infinity, hi = -Infinity, loX = Infinity, hiX = -Infinity;
    for (const id of only) {
      const c = app.centroids[id]; if (!c) continue;
      lo = Math.min(lo, c.y); hi = Math.max(hi, c.y);
      loX = Math.min(loX, c.x); hiX = Math.max(hiX, c.x);
    }
    const reach = Math.max(hi - lo, hiX - loX);
    if (Number.isFinite(reach)) spread = Math.max(0.02, Math.min(EXPLODE_REACH, reach * 0.55));
  }
  for (const [id, r] of byId) {
    const c = app.centroids[id];
    if (!c) continue;
    if (only && !only.has(id)) { palette.setOffset(id, 0, 0, 0); palette.setScale(id, 1, c.x, c.y, c.z); continue; }
    /* Away from the vertical axis at this structure's own height. A structure
     * sitting on the midline -- the sternum, the spine itself, the linea alba --
     * has no radial direction, so it is pushed forward instead of being given an
     * arbitrary one that would differ between builds. */
    out.set(c.x, 0, c.z);
    if (out.lengthSq() < AXIS_EPSILON * AXIS_EPSILON) out.set(0, 0, 1);
    else out.normalize();
    /* Deeper layers move less, so the body opens rather than scattering: the
     * skin-side muscles get out of the way and the skeleton stays put. */
    const depth = XRAY_DEPTH[r.layer] ?? 0;
    const reach = spread * (1 - depth / 5);
    palette.setOffset(id, out.x * reach, 0, out.z * reach);
    // opened, not catalogued: every structure keeps its own size
    palette.setScale(id, 1, c.x, c.y, c.z);
  }
  explodeExtent = null;
  palette.upload();
}

function computeExplodeOffsets() {
  if (app.explodeLayout === 'open') openOffsets();
  else inventoryOffsets();
  liftWholeMeshes();
}

/**
 * Pieces that are regions of one surface, moved as that surface.
 *
 * The layout gives every structure a cell and the vertex shader takes each vertex to the cell
 * its `_region` names. That works because a structure is its own closed mesh — for two
 * thousand of them. The cortex is the exception and it is the one that matters: it is a single
 * folded sheet carrying fifteen parcels, so the triangles along every parcel boundary have
 * vertices bound for different cells, and displacing them per vertex tore the brain into
 * sheets stretched across the whole screen. The parcels are painted on that surface; they are
 * not pieces of it, and nothing in a shader can make them separable.
 *
 * So a mesh that carries several regions takes **one** cell and is moved by its own transform,
 * which is what a mesh that cannot be cut up honestly is: one piece. Its regions' palette
 * entries are zeroed so the shader leaves it alone in every look — the volume material has no
 * displacement in it and the specimen material does, and this is what stops the answer
 * depending on which one the reader happens to be in.
 *
 * `wholeMesh` is what `brainWhileApart` then reads: where the mesh goes, and how far it has to
 * shrink to sit in a cell. The shrink is measured off the mesh's own radius rather than taken
 * from any one parcel's, because a parcel's scale is sized for a parcel.
 */
const wholeMesh = new Map();
/** The same answer keyed by structure, for everything on the CPU that asks where a piece is. */
const wholeById = new Map();
const _wmC = new THREE.Vector3();
function liftWholeMeshes() {
  wholeMesh.clear();
  wholeById.clear();
  const cell = (explodeExtent?.cell ?? 0.05) * 0.78;
  for (const name of LAYER_ORDER) {
    for (const mesh of layers[name]?.meshes ?? []) {
      const own = restByMesh.get(mesh);
      if (!own || own.size < 2) continue;
      const ids = [...own.keys()].filter(id => get(id));
      if (ids.length < 2) continue;
      // the first cell the layout gave this mesh's regions; the rest go unused
      const home = ids.find(id => palette.getOffset(id, _exO).lengthSq() > 0) ?? ids[0];
      const off = palette.getOffset(home, new THREE.Vector3());
      palette.getScaleCentre(home, _wmC);
      mesh.updateWorldMatrix(true, false);
      const bs = mesh.geometry.boundingSphere
        ?? (mesh.geometry.computeBoundingSphere(), mesh.geometry.boundingSphere);
      const radius = Math.max(1e-4, (bs?.radius ?? 0.05) * mesh.matrixWorld.getMaxScaleOnAxis());
      const placed = { off, centre: _wmC.clone(), scale: Math.min(1, cell / radius) };
      wholeMesh.set(mesh, placed);
      for (const id of ids) wholeById.set(id, placed);
      /* Zeroed, so no shader displaces it: `setOffset` keeps the visibility flag and
       * `setScale` at 1 about the same point is the identity. */
      for (const id of ids) {
        palette.setOffset(id, 0, 0, 0);
        palette.setScale(id, 1, 0, 0, 0);
      }
    }
  }
  if (wholeMesh.size) palette.upload();
}

/**
 * The set of structures changed, so the layout has to be built again.
 *
 * Cheap and idempotent when the body is assembled: it just marks the offsets
 * stale, and the next `setExplode` above zero rebuilds them. When the body is
 * already apart it rebuilds now, because the alternative is a layer that arrived
 * late standing in the middle of a catalogue.
 */
function relayoutExplode() {
  app.explodeReady = false;
  if (app.explode > 0) {
    computeExplodeOffsets();
    app.explodeReady = true;
    invalidate();
  }
}

/* ------------------------------------------------------- taught, or complete
 *
 * Two sets of the same anatomy, and they must never both be on.
 *
 * The **taught body** is 449 structures from release 3.0: one per named muscle,
 * bone and organ, both sides together, rigged, skinned, and the thing every
 * exercise, every written entry and all the Korean is keyed to. It is what a
 * class is taught out of and it is what this application is for.
 *
 * The **complete atlas** is BodyParts3D 4.0's own 2,186 pieces: the same body cut
 * finer and sided, so the left and right gluteus maximus are two things and a
 * trapezius is three. It is what you want when the question is "what is in a
 * body" rather than "what does this muscle do".
 *
 * Drawn together they are two copies of one anatomy in the same space, fighting
 * for the same pixels. So they are one choice, and the choice turns the other
 * side off.
 */
const TAUGHT_LAYERS = ['skeleton', 'muscles_superficial', 'muscles_deep', 'organs'];
const FULL_LAYERS = ['bones_full', 'muscles_full', 'organs_full'];

/**
 * Turning one atlas's layer on turns the other atlas off.
 *
 * The rule is `setAtlasDepth`'s, and for a long time `setAtlasDepth` was the only
 * thing that enforced it — so every other way of turning a layer on could draw
 * both bodies at once, which is 491 structures rendered twice and reads on screen
 * as a second leg inside the first. There are three such ways: the layer list, a
 * structure selected in a layer that is off, and an anatomical group. A rule
 * stated in one place and enforced in one place is how that happened, so it lives
 * here now and each of them calls it.
 *
 * Returns whether `name` belongs to either atlas at all — the vessels, the nerves
 * and the brain are on neither side and are never touched by this.
 */
function holdOneAtlas(name) {
  const full = FULL_LAYERS.includes(name);
  const other = full ? TAUGHT_LAYERS : TAUGHT_LAYERS.includes(name) ? FULL_LAYERS : null;
  if (!other) return false;
  for (const n of other) if (app.layers[n]) app.layers[n].on = false;
  app.atlasDepth = full ? 'complete' : 'taught';
  return true;
}

/**
 * The layers of `want` that can be drawn without taking the reader's atlas away.
 *
 * A filter or a group is not a request to change atlas. "Label every muscle" walks
 * the registry and turns on the layer of each one it finds, so with the rule above
 * in force it would flip between the two bodies as it went and finish on whichever
 * the registry happened to visit last — the reader asks for labels and their body
 * is silently replaced. So these prefer the side already being shown, and change
 * sides only when the answer lies entirely on the other one, where not changing
 * would mean showing nothing at all.
 */
function onThisAtlas(want) {
  const there = app.atlasDepth === 'complete' ? TAUGHT_LAYERS : FULL_LAYERS;
  const mine = want.filter(n => !there.includes(n));
  return mine.length ? mine : want;
}

/* `want` must be every layer that carries the answer, not only the ones that
 * happen to be switched off.
 *
 * Handed the off ones alone, an empty `mine` means "nothing left to turn on over
 * here" — and the fallback above reads it as "nothing over here at all" and
 * changes sides. Those are opposites. Asking to label muscles with the taught
 * body's superficial and deep layers already on left exactly one layer off,
 * `muscles_full`, so the filter concluded the muscles were all on the other
 * atlas and swapped the reader's body for it. Measured: it ended on `complete`
 * having started on `taught`. */

export async function setAtlasDepth(which) {
  const full = which === 'complete';
  app.atlasDepth = full ? 'complete' : 'taught';
  for (const n of TAUGHT_LAYERS) app.layers[n].on = !full && app.layers[n].on;
  /* Turning the taught body off does not turn the whole complete atlas on: which
   * of its layers a reader wants is still theirs to choose, and switching should
   * not silently load ten megabytes. The three that replace what was showing come
   * on; the vessels and the rest stay as they were. */
  if (full) {
    for (const n of FULL_LAYERS) app.layers[n].on = true;
  } else {
    for (const n of FULL_LAYERS) app.layers[n].on = false;
    for (const n of ['skeleton', 'muscles_superficial']) app.layers[n].on = true;
  }
  await Promise.all(LAYER_ORDER.filter(n => app.layers[n].on).map(loadLayer));
  syncLayers();
  relayoutExplode();
  ui?.syncControls?.();
}
export const atlasDepth = () => app.atlasDepth;

/**
 * Which layers belong to which atlas, for a list that has to group them.
 *
 * The rule that only one atlas is drawn is enforced in `holdOneAtlas`, and until now it was
 * only *enforced* — nothing said it. A reader ticking "Muscles — every piece" watched three
 * other switches turn themselves off with no explanation on screen, which is a rule that
 * looks like a fault. The layer list groups by this instead, and shows one atlas at a time.
 *
 * `shared` is everything on neither side: the vessels, the nerves, the airways, the
 * cartilage, the brain. They exist once and are drawn with either body, so they never
 * conflict and are never switched off by a change of atlas.
 */
export const atlasLayers = () => ({
  taught: TAUGHT_LAYERS.filter(hasLayer),
  complete: FULL_LAYERS.filter(hasLayer),
  shared: LAYER_ORDER.filter(n => hasLayer(n)
    && !TAUGHT_LAYERS.includes(n) && !FULL_LAYERS.includes(n)),
});

/** Swap between opening the body and laying it out. Recomputes and keeps the slider where it is. */
export function setExplodeLayout(which) {
  const next = EXPLODE_LAYOUTS.includes(which) ? which : 'inventory';
  if (next === app.explodeLayout) return;
  app.explodeLayout = next;
  app.explodeReady = false;
  setExplode(app.explode);
  if (app.explode > OPENED && explodeExtent) flyToExtent(explodeExtent);
  ui?.syncControls?.();
}
export const explodeLayout = () => app.explodeLayout;

/**
 * How far apart the body is, 0 to 1.
 *
 * Picking is turned off above a threshold rather than corrected. The raycaster
 * tests the geometry where it really is, and the geometry has not moved -- only
 * its projection has -- so a click on a separated rib would select whatever is
 * still standing at that rib's original position, which is worse than not
 * answering. The labels keep working and stay attached to what they name, so
 * there is still a way to ask what something is.
 */
export function setExplode(v) {
  const next = Math.max(0, Math.min(1, +v || 0));
  if (!app.explodeReady) { computeExplodeOffsets(); app.explodeReady = true; }
  const was = app.explode;
  app.explode = next;
  for (const m of materials) {
    const u = m.userData.uniforms;
    if (u?.uExplode) u.uExplode.value = next;
    /* And re-point the offset texture, because a palette that grew since this material was
     * made handed it a new one — see `sync` in `brainMaterial.js`. The layout the shader is
     * about to read lives in that texture, so this is the moment it has to be the right one. */
    m.userData.sync?.();
  }
  brainWhileApart();
  revealSelection();
  refreshSections();
  /* The catalogue is far wider than the body it came out of, so a camera framed
   * on a standing figure sees the middle few rows of it and nothing else. It is
   * fitted once, on the way out, and the view is restored once on the way back
   * -- rather than on every step of the drag, which would take the camera off
   * whatever the reader had aimed it at while they were still moving it. */
  if (explodeExtent) {
    if (was <= OPENED && next > OPENED) flyToExtent(explodeExtent);
    else if (was > OPENED && next <= OPENED) resetView();
  }
  /* A sheet of pieces is read by moving across it, not by orbiting it: there is
   * no "round the back" of a catalogue. Left-drag pans while one is open and goes
   * back to turning the body the moment it closes. */
  setDragVerb(!!explodeExtent && next > OPENED);
  cullWhileApart(next <= 0);
  /* The skin shell is drawn only while the body is closed -- `syncLayers` decides
   * that from `seeingInside`, which this slider is one of the three inputs to.
   * Nothing was calling it, so the shell stayed on: a head and a pelvis sized for
   * a whole body, lying across the middle of a catalogue of two thousand cells,
   * dark and unlabelled and not answering to anything. Only on the crossing,
   * because `syncLayers` walks every structure and this is a drag. */
  if ((was > SHELL_OFF) !== (next > SHELL_OFF)) syncLayers();
  invalidate();
}

/**
 * Stop culling against bounding spheres the shader has moved away from.
 *
 * Taking the body apart moves vertices in the vertex shader, and three.js decides
 * whether to draw a mesh at all from a bounding sphere computed on the CPU from
 * the geometry as it sits. Those two stop agreeing the moment the slider leaves
 * zero: a piece can be in plain sight while the sphere it is culled by is off the
 * side of the screen, and it simply is not drawn. That is what "why does it
 * disappear as I zoom in" is -- zooming in is what takes the *old* position out
 * of the frustum while leaving the new one in it.
 *
 * Turned back on when the body is whole, because culling four hundred structures
 * that are where they say they are is worth having.
 */
function cullWhileApart(assembled) {
  for (const name of LAYER_ORDER) {
    const L2 = layers[name];
    if (!L2?.loaded) continue;
    for (const m of L2.merged ?? []) m.frustumCulled = assembled && !m.isSkinnedMesh;
    /* And the meshes that were never merged -- a bone alone on its segment is
     * still drawn as itself, and it vanished for the same reason. */
    for (const m of L2.meshes ?? [])
      if (!m.isSkinnedMesh) m.frustumCulled = assembled;
  }
}

/** Above this the body is opened rather than assembled — also `PICK_LIMIT`'s neighbour. */
const OPENED = 0.02;

/**
 * The brain, in the catalogue.
 *
 * It stood in the middle of the sheet at full size while two thousand other pieces went to
 * their cells — and it is the largest bright thing on the screen, so it is what the eye lands
 * on first. Three reasons, and none of them was the layout: the brain had cells waiting for it
 * the whole time.
 *
 *  * **The offset texture was stale.** `sync` re-pointed the colour texture when the palette
 *    outgrew its width and left `uOffset` aimed at the one the material was born with. Every
 *    body layer's material is made after its layer loads, long after the palette settled; the
 *    brain's two are made at module load, before a single structure exists. So the one
 *    material in the scene that could not read the layout was the brain's. Fixed in
 *    `brainMaterial.js`, where the comment is.
 *  * **The cortex cannot be displaced per vertex.** It is one folded sheet carrying fifteen
 *    parcels, so its boundary triangles have vertices bound for different cells. See
 *    `liftWholeMeshes`: it takes one cell and moves as one object, which is what it is.
 *  * **The six deep structures** wear a plain basic material each — no shader to displace
 *    them with, and no need for one, since each mesh is exactly one structure.
 *
 * So every brain mesh is placed here, by its own transform, and none of it depends on which
 * look the reader is in. The network is the one thing left out: it is a diagram of what
 * connects to what rather than a part, and an inventory of parts has no cell for it.
 */
const deepHome = new Map();
const _bhC = new THREE.Vector3(), _bhD = new THREE.Vector3(), _bhO = new THREE.Vector3();
function brainWhileApart() {
  const apart = app.explode > OPENED;
  if (neuralNet && apart) neuralNet.visible = false;
  const L2 = layers.brain;
  if (!L2?.loaded) return;
  for (const mesh of L2.meshes ?? []) {
    const whole = wholeMesh.get(mesh);
    const id = whole ? null : mesh.userData.regionId;
    if (!whole && id == null) continue;
    let home = deepHome.get(mesh);
    if (!home) deepHome.set(mesh, home = { p: mesh.position.clone(), s: mesh.scale.clone() });
    if (!apart) { mesh.position.copy(home.p); mesh.scale.copy(home.s); continue; }
    const parent = mesh.parent;
    if (!parent) continue;
    /* The shader scales a piece about its own centroid and then displaces it. The same
     * transform, written for a mesh whose origin is not that centroid: a point p goes to
     * `C + (p - C)k + D`, so the origin has to go to `O·k + C(1 - k) + D` for the geometry
     * around it to land in the same place. Everything is converted into the holder's own
     * space first, because the brain hangs off the skull at a scale of its own. */
    const target = whole ?? {
      scale: palette.getScale(id),
      centre: palette.getScaleCentre(id, new THREE.Vector3()),
      off: palette.getOffset(id, new THREE.Vector3()),
    };
    const k = 1 + (target.scale - 1) * app.explode;
    parent.updateWorldMatrix(true, false);
    _bhC.copy(target.centre);
    _bhD.copy(target.off).multiplyScalar(app.explode);
    _bhO.copy(_bhC).add(_bhD);
    parent.worldToLocal(_bhC);                          // C, in the holder's space
    parent.worldToLocal(_bhO);                          // C + D, so D is the difference
    _bhO.sub(_bhC);
    mesh.position.copy(home.p).multiplyScalar(k)
      .addScaledVector(_bhC, 1 - k).add(_bhO);
    mesh.scale.copy(home.s).multiplyScalar(k);
  }
}

/** The threshold `syncLayers` uses for `seeingInside`, and so for the skin shell. */
const SHELL_OFF = 0.01;

/** Frame the laid-out catalogue: face on, far enough back to hold all of it. */
function flyToExtent(ext, immediate = false) {
  FLIGHT_BY = 'flyToExtent';
  const half = new THREE.Vector3(ext.width / 2, ext.height / 2, ext.cell);
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    pts.push(new THREE.Vector3(ext.centre.x + sx * half.x,
                               ext.centre.y + sy * half.y,
                               ext.centre.z + sz * half.z));
  /* Straight on, because a grid read at an angle is a grid with its far rows
   * squeezed into a line. */
  const dir = new THREE.Vector3(0, 0, 1);
  const { target, distance } = frameFor(pts, dir, ext.cell * 1.4, 0.02);
  flyToPose(target.clone().addScaledVector(dir, distance), target, immediate);
}

/** What is isolated right now, as ids. Empty when the whole body is drawn. */
export const isolated = () => [...(app.isolate ?? [])];

/** Every group the loaded atlas offers, for the panel. */
export const anatomyGroups = () => groups().list;
/** The groups a structure belongs to, most specific first. */
export const groupsForStructure = groupsOf;

/* One level for every member — see `setGroup`. Sits between an exercise's
 * synergist and its prime mover so a group reads as emphatic without looking
 * like a measured maximum. */
const GROUP_LEVEL = 0.8;

/**
 * Frame a whole group rather than one structure.
 *
 * `flyTo` solves against one structure's own extent, and running it over a set
 * would fly to whichever member happened to be last. This gathers every
 * member's posed extent into one cloud and hands that to the same fit, so the
 * distance comes from the group's real size: the pelvic floor fills the frame
 * and the whole leg does not.
 */
export function flyToGroup(ids, immediate = false) {
  FLIGHT_BY = 'flyToGroup';
  const pts = [];
  for (const id of ids) {
    const side = drawnSide(id);
    const c = side?.centre ?? drawnPoint(id, new THREE.Vector3());
    if (!c) continue;
    if (side?.points?.length >= 4) { pts.push(...side.points); continue; }
    /* Scaled with the piece. A catalogue shrinks a femur and blows up a sesamoid so both fill
     * a cell, and a radius measured off the body frames the cell it used to need. */
    const k = app.explode > 0 ? 1 + (palette.getScale(id) - 1) * app.explode : 1;
    const radius = Math.max(0.02, app.radii[id] ?? 0.04) * k;
    for (const axis of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
      pts.push(c.clone().addScaledVector(new THREE.Vector3(...axis), radius));
  }
  if (pts.length < 4) return;
  /* A group is almost always bilateral, so its cloud straddles the midline and
   * a direction derived from its centre points nowhere. The standing left
   * lateral vantage is the one that shows a spine, a pelvic floor and a set of
   * ribs alike. */
  const dir = LEFT_VIEW.clone();
  const { target, distance } = frameFor(pts, dir, FLESH, 0.06);
  flyToPose(target.clone().addScaledVector(dir, distance), target, immediate);
}

/**
 * Mark the brain regions this exercise's own claims are about.
 *
 * Turns the brain layer on, because marking a region on a layer that is off is a statement
 * nobody can see, and drives the cells in those regions so the marking is visible in the
 * network as well as on the surface. The drive is the same for every marked region: this
 * says *which*, never *how much*.
 */
async function markBrainForExercise(key) {
  const { regions } = brainOf(key);
  brainMarked = regions.map(r => r.region);
  applyBrainMarks();
  if (!brainMarked.length) return;
  /* And one of them is *chosen*, not merely lit.
   *
   * Marking says "these are the regions this exercise's claims are about"; it does not answer
   * "which one am I looking at", and every panel that goes deeper — the cells of one region,
   * the traced cell, where it sits in the cuts — is keyed on the selection. Listing them and
   * leaving the reader to click each in turn is the whole of "I don't want to choose one by
   * one myself and analyse manually".
   *
   * Which one is not a judgement: `brainOf` orders the regions by how many of this exercise's
   * own claims name each, with the best evidence tier among them as the tie-break, and the
   * panel prints both numbers beside the name. So the chosen one is the one this exercise has
   * most to say about, and a reader can see that it is and pick another.
   *
   * Without flying the camera. A flight is a request to look at the thing, and the reader has
   * just asked to look at an exercise — the body is framed on the pose and pulling the camera
   * into the head would be answering a question nobody asked. */
  selectStructure(regions[0].region, { auto: true });
  if (app.layers.brain && !app.layers.brain.on) await setLayer('brain', true);
  applyBrainMarks();
  if (app.selected === regions[0].region) neuralNet?.setRegionActivity?.(app.selected, 0.9);
}

/** Write the current marks onto the palette and the network. Safe to call whenever. */
function applyBrainMarks() {
  neuralNet?.clearRegionActivity?.();
  for (const id of brainMarked) {
    palette.setActivation(id, BRAIN_MARK);
    neuralNet?.setRegionActivity?.(id, BRAIN_MARK);
  }
}
/* One level for every marked region — see the note in `setExercise` for why it is not a
 * gradient. High enough to be unmistakable against an unmarked parcel, below the 0.9 a direct
 * selection uses, so choosing a region still reads as the stronger statement. */
const BRAIN_MARK = 0.62;
let brainMarked = [];
/** The regions the current exercise's claims name, for the panels that list them. */
export const exerciseBrainRegions = () => brainMarked.slice();
/**
 * Everything this application can honestly say about what the current exercise works.
 *
 * Assembled by `content/analysis.js` from four sources that already exist: the exercise's own
 * authored muscle roles and activation curve, the clip's own joint angles, each muscle's cited
 * innervation, and the exercise's own brain claims with their tiers and citations. Nothing in
 * it is a measurement of a person and nothing in it is invented — see that file's header for
 * what each field is allowed to claim.
 */
export const exerciseAnalysis = (lang = app.lang) =>
  (app.exercise ? analyse(app.exercise, lang) : null);

/* ------------------------------------------------------------- playback (§9)
 * Scrubbing matters more than playback: a user needs to stop at the top of a movement and
 * ask what is firing. So the clip is a pure function of normalised time and every path here
 * goes through poseFromClip — play just advances t. */
const liveActivation = new Map();   // structure name -> 0..1 at the current instant

export function poseFromClip(t) {
  app.t = Math.max(0, Math.min(1, t));
  if (!app.exercise || !rig) { afterPose(); return; }
  const s = sample(app.exercise, app.t);
  if (!s) return;
  rig.setAll(s.coordinates);
  liveActivation.clear();
  palette.clearActivation();
  for (const [name, v] of Object.entries(s.activation)) {
    liveActivation.set(name, v);
    const r = registry().byName.get(name);
    if (r) palette.setActivation(r.id, v);
  }
  afterPose();
  ui?.syncTimeline?.();
}

/** Everything that has to follow a pose change: paths, label anchors, palette upload. */
function afterPose() {
  if (musclePaths) {
    musclePaths.update();
    musclePaths.paint(name => liveActivation.get(name) ?? 0);
  }
  refreshPosed();
  for (const m of materials) m.userData.sync?.();
}

export function setPlaying(on) { app.playing = !!on && app.hasMotion; ui.syncTimeline?.(); }
export function setShowPaths(on) {
  app.showPaths = !!on;
  if (on && musclePaths) musclePaths.setVisible(true);
  else musclePaths?.setVisible(false);
}
export function setShowMeshes(on) {
  app.showMeshes = !!on;
  syncLayers();
}
/** Live activation for the panel, so a muscle card can show its number at this instant. */
export const liveActivationOf = name => liveActivation.get(name) ?? null;
export const musclePathReport = name => musclePaths?.report(name) ?? null;
export const musclePathsVisible = () => !!musclePaths?.group.visible;

/** Camera position and target, for the smoke test to assert a view actually arrived. */
let frameCount = 0;
/* --------------------------------------------------- drawing only on change
 *
 * This loop drew the whole body sixty times a second whether or not anything
 * had moved: 769 draw calls and 960,000 triangles per frame, measured, with the
 * camera still and nothing selected. On a laptop with integrated graphics that
 * is the difference between a body you can turn and a body that is stuck, and
 * it is most of where the battery went.
 *
 * **Nothing in the body animates.** That is what makes this safe, and it was
 * worth checking rather than assuming: the body materials declare `uPulse` and
 * never read it, so writing a new phase into it every frame changes no pixel.
 * The things that genuinely move are enumerated in `animating()` below -- a
 * camera flight, damping, auto-rotate, a clip playing, the scan sweeping, a
 * pathway's travelling dots, and the brain, whose tissue shader really does
 * breathe and whose cells really do fire.
 *
 * `dirtyFrames` is a count rather than a flag on purpose. A state change often
 * lands across two frames -- a texture upload here, a material recompile there
 * -- so anything that invalidates asks for a few frames rather than one, and
 * the cost of being wrong is three frames of work instead of a picture that is
 * one change out of date.
 */
let dirtyFrames = 4;
let lastDrawn = 0;
const SETTLE = 3;
/** Something changed; draw again. Cheap enough to call from anywhere. */
export function invalidate(frames = SETTLE) {
  dirtyFrames = Math.max(dirtyFrames, frames);
}

/* ------------------------------------------------------- the frame budget
 *
 * Where a frame goes, in milliseconds, accumulated per phase since the last
 * read. Added because "it is slow and my laptop is hot" is not a bug report
 * anyone can act on, and every guess about which phase costs what had been
 * wrong at least once. `performance.now()` five times a frame is noise next to
 * anything it measures.
 *
 * Read it from the console: `(await import('/src/main.js')).frameStats()`.
 */
const phase = { skin: 0, render: 0, labels: 0, hud: 0, net: 0, frames: 0, drawn: 0, since: 0 };
const _t0 = () => performance.now();
const _add = (k, t) => { phase[k] += performance.now() - t; };

export const frameStats = () => {
  const now = performance.now();
  const span = now - (phase.since || now);
  const per = k => +(phase[k] / Math.max(1, phase.frames)).toFixed(3);
  const out = {
    frames: frameCount, labels: labels.length,
    drawn: phase.drawn, skipped: phase.frames - phase.drawn,
    /* Averages over the window since the last call, so two calls a few seconds
     * apart describe those seconds rather than the whole session. */
    window: { frames: phase.frames, seconds: +(span / 1000).toFixed(2),
              fps: +(phase.frames / Math.max(0.001, span / 1000)).toFixed(1) },
    msPerFrame: { skinning: per('skin'), render: per('render'), labels: per('labels'),
                  hud: per('hud'), neural: per('net') },
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs?.length ?? 0,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
  for (const k of ['skin', 'render', 'labels', 'hud', 'net']) phase[k] = 0;
  phase.frames = 0; phase.drawn = 0; phase.since = now;
  return out;
};
export const cameraState = () => ({
  p: camera.position.toArray().map(v => +v.toFixed(3)),
  t: controls.target.toArray().map(v => +v.toFixed(3)),
  flying: !!flight,
  flightTo: flight ? flight.toT.toArray().map(v => +v.toFixed(3)) : null,
  flightBy: flight ? flight.by : null,
});

/* ------------------------------------------------------- schematic pathways
 * Arcs between measured endpoints, with a travelling pulse to show direction of flow.
 * The UI labels them as a diagram; see MOVEMENT_PATHWAY for why they cannot be traced. */
let pathGroup = null, pathDots = [];

function endpointOf(at) {
  if (at.region != null) return app.centroids[at.region] ?? null;
  if (at.nerve) {
    // a real nerve from the nervous layer, so this endpoint is geometry rather than a guess
    const r = registry().byName.get(at.nerve);
    return r ? app.centroids[r.id] ?? null : null;
  }
  if (at.level) { const v = vertebra(at.level); return v ? app.centroids[v.id] ?? null : null; }
  if ('muscle' in at) {
    const name = at.muscle ?? firstExerciseMuscle();
    const r = name ? registry().byName.get(name) : null;
    return r ? app.centroids[r.id] ?? null : null;
  }
  return null;
}
function firstExerciseMuscle() {
  if (!app.exercise) return 'rectus abdominis';
  return EXERCISE[app.exercise].muscles.prime[0]?.[0] ?? null;
}

export async function setPathway(key) {
  app.pathway = key;
  if (pathGroup) { root.remove(pathGroup); pathGroup.traverse(o => o.geometry?.dispose()); }
  pathGroup = null; pathDots = [];
  if (!key) { ui.syncControls(); return; }
  // the route runs from cortex to a vertebra to a muscle, so all three have to be loaded
  await Promise.all([loadLayer('brain'), loadLayer('skeleton'), loadLayer('muscles_deep'),
                     loadLayer('muscles_superficial'), loadLayer('nervous')]);
  app.layers.nervous.on = true;
  const path = MOVEMENT_PATHWAY[key];
  pathGroup = new THREE.Group();
  root.add(pathGroup);
  const col = new THREE.Color(path.color);
  const pts = path.steps.map(s => endpointOf(s.at)).filter(Boolean);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // bow the arc away from the midline so it clears the body rather than tunnelling it
    mid.add(new THREE.Vector3(0.05, 0, 0.16).multiplyScalar(1 + a.distanceTo(b)));
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 48, 0.0032, 8, false),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    tube.renderOrder = 6;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 12, 12),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    dot.renderOrder = 7;
    pathGroup.add(tube, dot);
    pathDots.push({ dot, curve, phase: i / Math.max(1, pts.length - 1) });
  }
  ui.syncControls();
}

/* ------------------------------------------------------------------ startup */
const ui = mountUI({
  app, setScan, setScanAt, setSweep, setBrainLook, regionGraph, cellGraph, cortexMesh, brainPlateImage,
  drawSections, setScanToSlice, locateInSections, pickInSection, regionActivity, neuralStats, layerPending,
  exerciseBrainRegions, exerciseAnalysis, renderStageInto, renderStructureInto, jointCentre,
  selectStructure, setLang, setAtlas, setXray, setCutaway, setClip, setLabels,
  setReveal, revealOn,
  setRotate, setRegister, setInstruction, setLayer, setLayerOpacity, setView, resetView,
  setExercise, setPathway, captureStage, activationOf, flyTo,
  setGroup, anatomyGroups, groupsForStructure, setIsolate, isolated, setExplode,
  setExplodeLayout, explodeLayout, zoomBy, fitView, explodeLayoutExtent,
  setAtlasDepth, atlasDepth, atlasLayers,
  poseFromClip, setPlaying, setShowPaths, setShowMeshes, liveActivationOf, musclePathReport,
  frameRig, setLabelKind, clearLabelKinds,
  // a getter, not the value: the panel mounts before the rig has finished loading
  getRig: () => rig,
});

Promise.all([
  fetch(body.assets.structures).then(r => r.json()),
  // a body without a rig is a body to look at, not to move — see `motion` in bodies.js
  body.assets.rig ? fetch(body.assets.rig).then(r => r.json()).catch(() => null) : null,
  body.motion === false ? null
    : fetch(body.assets.musclePaths).then(r => r.json()).catch(() => null),
  /* Groups are a convenience, not a dependency: an atlas with no group table is
   * the atlas this was before it had one, so a missing file costs the group
   * chips and nothing else. */
  body.assets.groups
    ? fetch(body.assets.groups).then(r => r.json()).catch(() => null) : null,
])
  .then(async ([gen, rigData, pathData, groupData]) => {
    buildRegistry(gen, { brain: hasLayer('brain') });
    if (groupData) buildGroups(groupData, registry().byId, LAYER_ORDER);
    REG_READY = true;
    resetView(true);
    paintPalette();
    if (rigData) {
      rig = new Rig(rigData);
      root.add(rig.root);
      rig.captureBindPose();
      // the skeleton has to exist before any layer binds, because a muscle mesh becomes a
      // SkinnedMesh at bind time and cannot be converted afterwards
      const built = buildSkeleton(rig);
      skeleton = new THREE.Skeleton(built.bones);
      capsules = built.capsules;
      boneNames = [...rig.nodes.keys()];
      boneIndex = built.index;
      rig.root.updateMatrixWorld(true);
      skeleton.calculateInverses();
      boneDQ = new BoneDualQuats(skeleton);
      dqUniform.value = boneDQ.texture;
      if (pathData) {
        indexAttachments(pathData);
        musclePaths = new MusclePaths(pathData, rig);
        musclePaths.setVisible(false);
        root.add(musclePaths.group);
      }
      /* Layers that finished loading before the rig arrived still have to be bound — the
       * skeleton first and on its own, because it is what the bone field is built from and
       * every other layer's binding is decided against that field. */
      if (layers.skeleton.loaded) { bindLayer('skeleton'); buildBoneRegions(); }
      for (const name of LAYER_ORDER)
        if (name !== 'skeleton' && layers[name].loaded) bindLayer(name);
      bindBrain();
      refreshPosed();
    }
    ui.ready();
    await loadLayer('skeleton');
    loadShell();                       // backdrop; the body does not wait on it
    await loadLayer('muscles_superficial');
    syncLayers();
  })
  .catch(e => {
    console.error(e);
    document.getElementById('loading')?.replaceChildren(
      Object.assign(document.createElement('div'), {
        textContent: `Could not load ${body.assets.structures} — run scripts/build_body.py`,
      }));
  });

/**
 * Keep the drawing buffer the same shape as the box it is displayed in.
 *
 * Two things were wrong here, and together they are why about a seventh of the posed body
 * could not be clicked.
 *
 * It measured `stage`, and it only ran on a window resize. The stage is a grid row, so it
 * changes height whenever anything above it does — and the four disclaimer chips in the
 * header wrap onto a second line once they are populated, which happens after this module
 * loads and without any window resize at all. The renderer kept an 860x749 buffer for a box
 * that had become 860x719: the picture was squashed four per cent vertically, and `pick`
 * builds its ray from `getBoundingClientRect`, so every ray went through a point up to thirty
 * pixels away from the pixel under the pointer. A band of the body was drawn in one place and
 * picked in another, which no amount of bounding-sphere margin can fix because the ray was
 * never near the mesh.
 *
 * So: measure the canvas's own box, the same one `pick` uses, and watch the stage for any
 * layout change rather than waiting for the window. Observing the stage rather than the
 * canvas is deliberate — `setSize(w, h, false)` leaves the CSS size alone, but observing the
 * element whose size we are reacting to is one step away from a resize loop.
 */
/* ------------------------------------------------------- post-processing
 * Bloom is not decoration here, it is the reason the tissue reads as emitting rather than as
 * being lit. An additive volume without it is a flat wash of orange; with it, the bright
 * filaments and the firing nodes throw light into the space around them and the organ starts
 * to look like it is glowing rather than painted.
 *
 * `strength` is deliberately low and `threshold` high: everything above the knee blooms, and
 * the scene is built so that only the tissue's own emission gets there. Raising the strength
 * to make it more obvious is what turns this into neon — the reference's glow is soft and
 * mostly confined to the core, so the knee does the work, not the gain.
 *
 * **The threshold is read in display space, not in scene space, and that is why it is so
 * high.** The bloom pass runs *after* the ACES pass, because `UnrealBloomPass` blanks the
 * buffer unless it is last, so what it sees is already tone-mapped and compressed into 0–1.
 * The first numbers here were picked as if it were reading scene radiance: at threshold 0.62
 * most of the cortex was over the knee, the additive integral through ten or twenty walls of
 * a closed surface is brightest where the volume is deepest, and the whole core summed past
 * white — 825 pixels of pure 255,255,255, 2.2% of everything lit, drawn as a flat hole in the
 * middle of the brain exactly where its structure should be. Measured, not guessed:
 * `.render/bloomsweep.mjs` renders the same frame at four settings and counts clipped pixels
 * against lit ones. 0.45/0.65/0.80 clips nothing and holds the mean lit value at 160 against
 * 171, so it is the most glow this scene takes before it starts destroying its own subject.
 * If you raise `strength`, re-run that sweep — the number that matters is `clipped`, and the
 * failure it catches looks like a lighting choice rather than like a bug. */
let composer = null, bloomPass = null, finalPass = null;
const BLOOM = { strength: 0.45, radius: 0.65, threshold: 0.80 };
/* Bloom runs at half the canvas resolution. It is a low-frequency effect by construction —
 * five successive gaussian blurs — so full resolution costs four times the fill rate for a
 * result nobody can tell apart. */
const BLOOM_SCALE = 0.5;

/**
 * Is this a software rasteriser?
 *
 * SwiftShader is what runs the headless browser the tests drive, and it rendered this scene at
 * about a frame a second *before* an additive volume, twenty-five thousand line segments and
 * five gaussian blurs were added to it — after which a screenshot stopped arriving at all.
 * That is not a reason to make the product simpler; it is a reason to ask what is drawing it.
 * A machine with no GPU gets the anatomy without the post-processing — the same picture with
 * a softer glow — and every test stays able to finish.
 */
function softwareRenderer() {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                            : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch { return false; }
}

/**
 * The chain, and the order is forced rather than chosen.
 *
 * `UnrealBloomPass` has to be **last**. When it is not, it leaves the buffer black and every
 * pass after it renders nothing — measured by bisecting the chain and by flat-colouring the
 * final pass to prove it was running and reading an empty texture. And it is not three's
 * `OutputPass` doing the tone mapping, because that renders black here too, for an unrelated
 * reason: its quad is a `RawShaderMaterial` with no `#version`, so it compiles as GLSL ES
 * 1.00 against a 3.00 scene. Neither failure throws or logs anything.
 *
 * So: scene → ACES → bloom, and `finalPass` deliberately stops at the tone map. Bloom's blit
 * to the screen goes through a built-in material, and three applies linear→sRGB on that blit;
 * encoding it in `finalPass` as well would convert twice and wash the whole image out.
 */
/**
 * The composer is not optional, and only the bloom in it is.
 *
 * The cortex is a custom `ShaderMaterial`, so it carries none of three's shader chunks — and
 * `renderer.toneMapping` is one of those chunks. Rendered straight to the canvas the tissue
 * is written untone-mapped into eight bits, and an additive integral that reaches 2.0 through
 * the middle of the head clips flat white. Tone mapping an additive volume also has to happen
 * on the *sum* rather than on each wall as it is drawn, which is precisely what a float render
 * target plus one pass at the end is for. So every machine gets `scene → ACES`; a machine with
 * a GPU also gets bloom after it.
 */
function buildComposer(w, h, withBloom) {
  /* Rebuilt rather than reconfigured, because the bloom pass and the final pass
   * disagree about who encodes sRGB and the answer is baked in at construction.
   * Disposing first matters: the governor below rebuilds this whenever the
   * machine turns out to be slower than the last guess, and a composer left
   * behind keeps its render targets -- two full-size float buffers each. */
  composer?.dispose?.();
  composer = new EffectComposer(renderer);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  // sRGB is encoded here only when nothing follows to do it — see `finalPass.js`
  finalPass = makeFinalPass(renderer.toneMappingExposure, { encodeSRGB: !withBloom });
  composer.addPass(finalPass);
  if (!withBloom) return;
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w * BLOOM_SCALE, h * BLOOM_SCALE),
    BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloomPass);
}

/** One place that decides how a frame is drawn. */
function renderPipeline() {
  if (composer) composer.render();
  else renderer.render(scene, camera);          // only before the first resize
}

/* -------------------------------------------------- how hard to draw, measured
 *
 * The quality of a frame used to be decided once, from the GPU's *name*: if it
 * called itself SwiftShader or llvmpipe, drop the bloom; otherwise render at up
 * to twice the device's pixel ratio with the full chain. That is a guess about
 * a machine dressed up as a fact about it, and it is wrong in the direction
 * that hurts -- an integrated laptop GPU reports a real hardware name, gets the
 * full treatment, and turns a body you can spin into a body that is stuck.
 *
 * So the frame time decides instead. Four steps, from the full chain at twice
 * the pixel ratio down to no bloom at one, and the governor walks between them
 * on what it measures rather than what it was told.
 *
 * Three things it has to get right, all of them learned the hard way in the
 * general case and worth writing down here:
 *
 *  * **Median, not mean.** One 400 ms frame while a layer decodes must not
 *    convince it the machine is slow for ever.
 *  * **Hysteresis.** Stepping down at 45 fps and back up at 45 fps oscillates
 *    for ever, and an image that changes resolution twice a second is worse
 *    than one that is permanently soft. It steps down quickly and up slowly,
 *    and it needs real headroom to go up.
 *  * **Only drawn frames.** A skipped frame costs nothing and would otherwise
 *    look like enormous headroom.
 */
const QUALITY = [
  { pixels: 1,    bloom: false },
  { pixels: 1.25, bloom: false },
  { pixels: 1.5,  bloom: true  },
  { pixels: 2,    bloom: true  },
];
/** Start optimistic: a capable machine should never see a soft first frame. */
let quality = QUALITY.length - 1;
/** Recent drawn-frame costs, in ms. Short, because it has to react in a second. */
const recent = [];
const RECENT_N = 30;
/** Below 45 fps of *drawing* is where turning the body starts to feel stuck. */
const TOO_SLOW_MS = 22;
/** Above 100 fps there is room for more, but only if it holds. */
const HEADROOM_MS = 9;
let sinceStep = 0;

function judgeFrame(ms) {
  recent.push(ms);
  if (recent.length > RECENT_N) recent.shift();
  if (recent.length < RECENT_N || ++sinceStep < RECENT_N) return;
  const sorted = [...recent].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  if (median > TOO_SLOW_MS && quality > 0) setQuality(quality - 1);
  else if (median < HEADROOM_MS && quality < QUALITY.length - 1) setQuality(quality + 1);
}

function setQuality(level) {
  const next = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, level))];
  const was = QUALITY[quality];
  quality = QUALITY.indexOf(next);
  sinceStep = 0;
  recent.length = 0;
  renderer.setPixelRatio(Math.min(devicePixelRatio, next.pixels));
  const r = canvas.getBoundingClientRect();
  const w = Math.round(r.width), h = Math.round(r.height);
  if (next.bloom !== was.bloom && w && h) {
    app.bloom = next.bloom && !softwareRenderer();
    buildComposer(w, h, app.bloom);
  }
  composer?.setSize(w, h);
  bloomPass?.setSize(w * BLOOM_SCALE, h * BLOOM_SCALE);
  invalidate(4);
}

/** What the governor settled on, for the reading page and for a test. */
export const qualityLevel = () => ({
  level: quality, of: QUALITY.length, ...QUALITY[quality],
  pixelRatio: renderer.getPixelRatio(),
  medianMs: recent.length
    ? +[...recent].sort((a, b) => a - b)[recent.length >> 1].toFixed(2) : null,
});

function resize() {
  invalidate(8);
  const r = canvas.getBoundingClientRect();
  const w = Math.round(r.width), h = Math.round(r.height);
  if (!w || !h || (canvas.width === w && canvas.height === h)) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!composer) {
    /* The first build only. After this the governor decides, from frame times
     * rather than from the driver's name -- but a software rasteriser is worth
     * believing straight away rather than making it prove itself for a second. */
    if (softwareRenderer()) quality = 0;
    app.bloom = QUALITY[quality].bloom && !softwareRenderer();
    renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[quality].pixels));
    buildComposer(w, h, app.bloom);
  } else {
    composer.setSize(w, h);
    bloomPass?.setSize(w * BLOOM_SCALE, h * BLOOM_SCALE);
  }
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(stage);
resize();
/** What the render and the raycaster disagreed about, exported so a test can watch it. */
export const viewFit = () => {
  const r = canvas.getBoundingClientRect();
  return { buffer: [canvas.width, canvas.height], box: [+r.width.toFixed(1), +r.height.toFixed(1)],
           aspect: +(canvas.width / canvas.height).toFixed(4),
           boxAspect: +(r.width / r.height).toFixed(4) };
};

let clipT0 = null;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const FLIGHT_MS = 620;
const _p = new THREE.Vector3();
renderer.setAnimationLoop((now) => {
  frameCount++;
  if (flight) {
    /* Wall-clock, not a per-frame increment. A camera move used to be 34 frames long
     * regardless of how long a frame took, so a heavy scene on a slow machine turned a
     * half-second move into a twenty-second one. Accumulating a clamped delta instead has
     * the same failure once frames exceed the clamp, which is exactly when it matters —
     * so the elapsed time is read from the clock and nothing is accumulated. */
    if (flight.t0 == null) flight.t0 = now;
    flight.t = Math.min(1, (now - flight.t0) / FLIGHT_MS);
    const k = ease(flight.t);
    camera.position.lerpVectors(flight.fromP, flight.toP, k);
    controls.target.lerpVectors(flight.fromT, flight.toT, k);
    if (flight.t >= 1) flight = null;
  }
  controls.autoRotate = app.rotate && !flight && (now - idleAt) > 2600 && !app.playing;
  if (app.playing && app.exercise) {
    const dur = MOTION[app.exercise]?.duration ?? 5000;
    // wall-clock again: the clip is a fixed number of seconds, not a fixed number of frames
    if (clipT0 == null) clipT0 = now - app.t * dur;
    let t = ((now - clipT0) % dur) / dur;
    if (!MOTION[app.exercise]?.loop && now - clipT0 >= dur) { t = 1; app.playing = false; }
    poseFromClip(t);
  } else clipT0 = null;
  if (pathDots.length) {
    for (const d of pathDots) {
      const t = ((now * 0.00022) + d.phase) % 1;
      d.curve.getPoint(t, _p);
      d.dot.position.copy(_p);
      d.dot.material.opacity = 0.3 + 0.65 * Math.sin(t * Math.PI);
    }
  }
  /* `materials` is every region-shader material in the scene, and they no longer share one
   * uniform set: the body layers are lit surfaces carrying `uPulse`, the cortex is an
   * additive volume carrying `uTime`. Each is written only where it exists — the alternative
   * is giving both materials every other one's uniforms so a single loop can be careless. */
  const tsec = now * 0.001;
  lastT = tsec;
  // the instrument furniture is behind the lab too, and its trace is a canvas redrawn per frame
  const hudMark = _t0();
  if (!app.labOpen) hud?.tick(tsec, {
    drive: app.layers.brain.on ? app.activity : 0,
    regions: app.layers.brain.on ? brainRegionIds() : [],
    selected: app.selected != null ? nameOf(app.selected, app.lang) : null,
    structures: REG_READY ? registry().byId.size : 0,
    nodes: neuralNet?.stats().nodes ?? 0,
  });
  _add('hud', hudMark);
  for (const m of materials) {
    const u = m.userData.uniforms;
    if (u?.uPulse) u.uPulse.value = tsec;
    if (u?.uTime)  u.uTime.value  = tsec;
    m.userData.sync?.();
  }
  if (app.scan.sweeping && app.scan.plane) {
    // a slow pass back and forth, not a loop that jumps: a scanner returns the way it came
    app.scan.at = Math.sin(tsec * 0.42);
    applyScan();
  }
  const netMark = _t0(); tickNeuralNet(tsec); _add('net', netMark);

  /* **The lab covers the stage, so the stage stops drawing itself.**
   *
   * The lab is a full-screen overlay with its own WebGL scene in it, and underneath it this
   * loop was still running a full composed frame of the body — seven hundred thousand
   * triangles, the ACES pass and bloom — for pixels nobody can see, and then projecting and
   * laying out every label over them. Two scenes rendered per frame to show one. That is the
   * single largest thing the lab was paying for and none of it was visible.
   *
   * What still runs: the clock, the uniforms, the neural net's own advance, and the transforms
   * — because the lab's body panel renders this scene on demand and a stale matrix would put
   * it a frame behind the pose. What stops is everything whose only output is the hidden
   * canvas or the annotations over it. */
  const hidden = app.labOpen;
  if (!hidden) {
    drawCell();
    drawOrient();
    ui?.syncConn?.();
  }
  ui?.tickLab?.(tsec);
  /* `controls.update()` is what advances damping after a drag ends, and it fires
   * `change` while it does -- which is what keeps the picture dirty for the rest
   * of the glide. So it runs every frame; it is a few matrix operations. */
  controls.update();
  if (animating()) dirtyFrames = Math.max(dirtyFrames, 1);
  /* A heartbeat, so that forgetting to invalidate somewhere can never freeze the
   * picture -- the worst failure this whole mechanism can have, and the hardest
   * to attribute, because a stale frame looks exactly like a control that does
   * nothing. Twice a second against sixty is still ninety-seven per cent of the
   * work gone, and it buys the property that no missing `invalidate` can cost
   * more than half a second of staleness. */
  if (now - lastDrawn > 500) dirtyFrames = Math.max(dirtyFrames, 1);
  phase.frames++;
  if (!dirtyFrames) return;
  dirtyFrames--;
  lastDrawn = now;
  root.updateMatrixWorld();
  fitFog();
  // after the bones have their world matrices for this frame and before anything is drawn
  let mark = _t0(); boneDQ?.update(); _add('skin', mark);
  if (!hidden) {
    /* `renderer.info` resets itself on every `render()`, and the composer ends a
     * frame with a fullscreen copy -- so reading the counters afterwards reports
     * one draw call and one triangle for the whole body. Reset once per frame
     * instead and let the passes accumulate. */
    renderer.info.autoReset = false;
    renderer.info.reset();
    mark = _t0(); renderPipeline(); _add('render', mark);
    const drawMs = performance.now() - mark;
    mark = _t0(); updateLabels(); _add('labels', mark);
    // the whole cost of putting one frame on screen, which is what the reader feels
    judgeFrame(drawMs + (performance.now() - mark));
  }
  phase.drawn++;
});

/**
 * Is anything moving on its own?
 *
 * Everything here keeps the loop drawing without anybody touching the page, and
 * the list is meant to be exhaustive -- a missing entry shows up as an animation
 * that stutters or stops, which is a worse failure than a frame too many. The
 * brain is two of them: its tissue shader breathes on `uTime`, and its cells
 * fire on their own clock.
 */
function animating() {
  if (flight) return true;
  if (controls.autoRotate) return true;
  if (app.playing) return true;
  if (app.scan.sweeping) return true;
  if (pathDots.length) return true;
  if (heldCell != null) return true;
  if (app.layers.brain?.on && (app.neural || app.brainLook !== 'anatomical')) return true;
  return false;
}
