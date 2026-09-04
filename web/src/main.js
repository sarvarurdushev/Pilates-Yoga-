import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeStructureMaterial, makeBrainMaterial } from './brainMaterial.js';
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
import { buildRegistry, registry, get, nameOf, LAYER_ORDER, vertebra } from './structures.js';
import { activeBody, layerUrl } from './bodies.js';
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
  // §9: the clip, where the scrubber is, and whether it is running
  t: 0, playing: false, hasMotion: false, showPaths: false, showMeshes: true,
  pathway: null,
  layers: {},                // name -> { on, opacity }
  centroids: {}, radii: {}, anchors: {},
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
controls.minDistance = 0.10; controls.maxDistance = 6.0;
controls.autoRotate = true; controls.autoRotateSpeed = 0.34;
controls.target.copy(HOME.t);

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
}

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
    new GLTFLoader().load(body.assets.shell, (gltf) => {
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
      L2.loaded = true; L2.loading = false;
      indexGeometry(L2.group);
      bindBrain();
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
    new GLTFLoader().load('models/cortex.glb', (g) => {
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
    const seg = loadDeepStructures('models/subcortical.glb', (g, ids) => {
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
  neuralNet.visible = app.neural && app.layers.brain.on && app.brainLook !== 'anatomical';
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
  else if (az >= ay) key = _vd.z < 0 ? 'viewPost' : 'viewAnt';
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
  const host = document.getElementById('sections');
  if (!host) return;
  const on = !!app.layers.brain?.on && !!sections?.ready;
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
      let rad = 0;
      for (const p of e.pts) rad += p.distanceTo(c);
      app.radii[id] = Math.max(app.radii[id] ?? 0, e.pts.length ? rad / e.pts.length : 0.01);
    }
    restByMesh.set(o, own);
  }
  buildLabelEls();
}

/* ------------------------------------------------------------------ palette */
function paintPalette() {
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
                     skeleton: 3, brain: 4 };

export function syncLayers() {
  // the strip has nothing to cut without the brain, and says so by not being there
  refreshSections();
  /* The shell only makes sense behind something. With every body layer off there is nothing
   * for it to be the inside of, and a bare dark silhouette is not what Explore is for. */
  const covering = ['muscles_superficial', 'muscles_deep', 'skeleton']
    .some(n => app.layers[n]?.on && layers[n].loaded);
  // an automatic selection is not a request to see inside — see `selectStructure`
  const chosen = app.selected != null && !app.autoSelected ? app.selected : null;
  const seeingInside = app.xray > 0.12 || chosen != null;
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
    const selRec = chosen != null ? get(chosen) : null;
    if (selRec) {
      const selDepth = XRAY_DEPTH[selRec.layer] ?? 0;
      if (depth < selDepth) o *= 0.06;          // in front: nearly gone
      else if (depth > selDepth) o *= 0.5;      // behind: kept as context
      else o = Math.max(o, 0.96);               // the layer it is in: never faded
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
      o *= showInterior ? app.layers.brain.opacity : 0;
      g.traverse(m => {
        if (!m.isMesh) return;
        m.material.opacity = o; m.visible = o > 0.01;
        m.material.clippingPlanes = app.cutaway ? [clipPlane] : null;
      });
      tintStructure(g, { selected: sel, atlas: app.atlas });
    }
  }
  for (const m of materials) {
    const u = m.userData.uniforms;
    if (u) { u.uSelected.value = app.selected ?? -1; u.uHover.value = app.hover ?? -1; }
  }
}

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
  const el = document.getElementById('panel');
  if (!el) return 0;
  const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  // docked to the bottom on a narrow window: it covers no part of the lane
  if (r.top > c.bottom - 4) return 0;
  return Math.max(0, c.right - r.left + 10);
}
const LAB_H = 24, LAB_GAP = 7, LANE_PAD = 13, MAX_PER_SIDE = 8, LAB_MAX = 300, MIN_PX = 26;
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
  }
  const svg = document.getElementById('leaders');
  const have = new Set(labels.map(l => l.id));
  for (const id of Object.keys(app.centroids).map(Number)) {
    if (have.has(id) || !get(id)) continue;
    const el = document.createElement('button');
    el.className = 'lab3d';
    el.onclick = (e) => { e.stopPropagation(); selectStructure(id); };
    /* Two nodes, not one string. The name is the label; the role tag is a second, dimmer
     * field that appears only on a muscle the loaded exercise actually works, which is a
     * handful of the four hundred rather than all of them. Keeping them separate is also
     * what lets the width be re-read when either changes without re-reading it every frame. */
    // so a test can ask what a label on screen is pointing at, without reaching into `labels`
    el.dataset.id = String(id);
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
    labels.push({ id, el, dot, rope, nameEl, roleEl,
                  side: null, text: null, role: null, w: null, hidden: false });
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
function anchorFor(id) {
  _pts.length = 0;
  const owners = meshesOfId.get(id);
  if (!owners?.length) return _a.copy(app.centroids[id]);
  let bestD = Infinity;
  _a.copy(app.centroids[id]);
  for (const mesh of owners) {
    const b = bound.get(mesh);
    const m = b ? deltaFor(b.segment) : null;
    const own = restByMesh.get(mesh)?.get(id);
    if (!own) continue;
    for (const p of own.pts) {
      _ap.copy(p);
      if (m) _ap.applyMatrix4(m);
      _pts.push(_ap.x, _ap.y, _ap.z);
      const d = camera.position.distanceToSquared(_ap);
      if (d < bestD) { bestD = d; _a.copy(_ap); }
    }
  }
  return _a;
}

function labelVisible(id) {
  const r = get(id);
  if (!r) return false;
  if (app.selected === id) return true;
  if (app.labelKinds.size && !app.labelKinds.has(r.kind)) return false;
  if (!app.layers[r.layer]?.on) return false;
  if (r.interior && app.xray === 0) return false;
  // during an exercise the muscles in the movement are the point of the picture
  if (app.exercise) return activation.has(id);
  return true;
}

function updateLabels() {
  if (!labels.length) return;
  const h = canvas.clientHeight;
  const wFull = canvas.clientWidth;
  // the lane's right edge, which is the console's left edge rather than the canvas's
  const w = wFull - panelInset();
  const projScale = h / (2 * Math.tan(camera.fov * Math.PI / 360));
  const cand = [];
  for (const l of labels) {
    if (!app.labelsOn || !labelVisible(l.id)) { hide(l); continue; }
    const r = get(l.id);
    _v.copy(anchorFor(l.id));
    const dist = camera.position.distanceTo(_v);
    _v.project(camera);
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
    const px = (app.radii[l.id] ?? 0.01) / Math.max(0.001, dist) * projScale;
    const sel = app.selected === l.id;
    const act = activation.has(l.id);
    // the role itself, for the tag on the plate. `act` stays a boolean: it is sorted on
    // arithmetically two lines down and tested as a flag above.
    const role = activation.get(l.id) ?? null;
    // A structure with a written entry outranks one without. Without this the lanes fill
    // with metacarpals and phalanges: they are small but close to the camera, so their
    // projected size beats every trunk muscle in the picture.
    const told = !!(r.muscle || r.kind === 'brain');
    /* Two thresholds, not one. A structure sitting exactly on the bar crosses it several
     * times a second as the body moves, and a label that blinks is harder to read than one
     * that is simply absent: it has to grow past MIN_PX to appear and shrink well under it
     * to leave again. */
    const bar = l.hidden ? MIN_PX : MIN_PX * MIN_PX_KEEP;
    if (px < bar && !sel && !act) { hide(l); continue; }
    /* How wide this structure is on screen, from the surface points `anchorFor` just walked.
     * Done here rather than above the bar so it runs for the dozen labels that will be placed
     * rather than for all four hundred that will not.
     *
     * The lanes need this and not the anchor alone. An anchor is one point on one parcel and
     * the subject reaches well past the outermost of them: sized from the anchors the right
     * lane landed on the occipital lobe, and sized from anchor ± the structure's own radius
     * it still did, because a parcel's radius does not know about the cerebellum below it. */
    let x0 = ax, x1 = ax;
    for (let i = 0; i < _pts.length; i += 3) {
      _s.set(_pts[i], _pts[i + 1], _pts[i + 2]).project(camera);
      if (_s.z > 1) continue;
      const sx = (_s.x * 0.5 + 0.5) * wFull;
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
    }
    cand.push({ l, r, sel, act, role, told, px, ax, ay, x0, x1 });
  }
  cand.sort((a, b) => (b.sel - a.sel) || (b.act - a.act) || (b.told - a.told) || (b.px - a.px));

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
    if (l.el.style.opacity !== '1') continue;
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
let downAt = null;

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

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickTargets(), false);
  let ghosted = null;
  for (const h of hits) {
    if (app.cutaway && clipPlane.distanceToPoint(h.point) < 0) continue;
    const geo = h.object.geometry;
    const reg = geo && regionAttr(geo);
    const id = reg && h.face ? Math.round(reg.getX(h.face.a))
             : (h.object.userData.regionId ?? null);
    if (id == null || !get(id)) continue;
    if (layerOpacity(String(h.object.userData.layer)) >= GHOST) return id;
    if (ghosted == null) ghosted = id;
  }
  return ghosted;
}

/** Pick at a client coordinate. Exported so a test can ask what is under a point. */
export const pickAt = (clientX, clientY) => pick({ clientX, clientY });


canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; nudgeIdle(); });
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
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
canvas.addEventListener('pointermove', e => {
  if (downAt && (e.buttons & 1)) return;
  const id = pick(e);
  if (id !== app.hover) { app.hover = id; syncLayers(); }
  canvas.style.cursor = id != null ? 'pointer' : 'grab';
  pickCell(e);
});

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

function clearestDir(id, centre, distance, prefer) {
  const targets = pickTargets();
  if (!targets.length) return prefer;
  let best = prefer, bestScore = -Infinity;
  for (const dir of [prefer, ...VANTAGES]) {
    _from.copy(centre).addScaledVector(dir, distance);
    ray.set(_from, _look.copy(centre).sub(_from).normalize());
    // how far along the ray before something that is not the structure gets in the way
    let blockedAt = Infinity;
    for (const h of ray.intersectObjects(targets, false)) {
      const geo = h.object.geometry, reg = geo && regionAttr(geo);
      const hid = reg && h.face ? Math.round(reg.getX(h.face.a))
                : (h.object.userData.regionId ?? null);
      if (hid === id) break;                                       // reached it: clear
      if (layerOpacity(String(h.object.userData.layer)) < GHOST) continue;   // see-through
      blockedAt = h.distance; break;
    }
    const score = blockedAt === Infinity ? 1e3 : blockedAt;
    if (score > bestScore + 1e-6) { bestScore = score; best = dir; }
  }
  return best;
}

export function flyTo(id, immediate = false) {
  FLIGHT_BY = 'flyTo';
  const side = posedSide(id);
  const c = side?.centre ?? app.centroids[id];
  if (!c) return;
  const r = get(id);
  const radius = Math.max(0.03, (app.radii[id] ?? 0.05) * 1.9);
  /* A paired structure's centroid sits on the midline, so its direction from the model
   * centre is degenerate and any camera derived from it points nowhere useful. Bilateral
   * structures and anything near the midline take a fixed left-lateral vantage instead. */
  const bilateral = r?.sides?.length === 2 || Math.abs(c.x) < 0.02;
  let dir = bilateral ? LEFT_VIEW.clone()
          : new THREE.Vector3(c.x, 0, Math.abs(c.z) + 0.25).normalize();
  if (dir.x < 0.15) { dir.x = 0.5; dir.normalize(); }
  dir = clearestDir(id, c, Math.max(0.06, radius * 4), dir).clone();
  // the structure's own extent, as a box of points the fit can measure
  const pts = side?.points ?? [];
  if (pts.length < 4) {
    for (const s of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
      pts.push(c.clone().addScaledVector(new THREE.Vector3(...s), radius));
  }
  /* Close enough to fill the frame, far enough to be outside the limb. A metacarpal is two
   * centimetres across and its own fit puts the camera five centimetres away — which is
   * inside the forearm, looking at the inside wall of a muscle. Ten centimetres clears any
   * body part while still filling the picture with a small bone. */
  const { target, distance } = frameFor(pts, dir, radius * 0.45, 0.06);
  flyToPose(target.clone().addScaledVector(dir, distance), target, immediate);
}

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
      rig.setAll(s.coordinates); rig.root.updateMatrixWorld(true);
      jointCloud(pts);
    }
    const back = sample(app.exercise, app.t);       // put the pose on screen back
    if (back) { rig.setAll(back.coordinates); rig.root.updateMatrixWorld(true); refreshPosed(); }
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
  if (r && !app.layers[r.layer].on) { app.layers[r.layer].on = true; loadLayer(r.layer); }
  if (r?.interior && app.xray === 0) app.xray = 1;
  syncLayers();
  /* And light it in the section strip: a structure the reader has just chosen should be the
   * bright thing in every cut that passes through it, not something they have to find. */
  refreshSections();
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
export function setClip(v) { clipPlane.constant = v; }
export function setLabels(on) { app.labelsOn = on; }
/**
 * Name one system at a time.
 *
 * Turning a kind on turns its layer on too. Asking for the nerves and being shown an empty
 * picture because the nerve layer happened to be off is not a filter, it is a puzzle.
 */
export async function setLabelKind(kind, on) {
  if (on) app.labelKinds.add(kind); else app.labelKinds.delete(kind);
  if (on) {
    for (const [id, r] of registry().byId) {
      void id;
      if (r.kind === kind && !app.layers[r.layer]?.on) await setLayer(r.layer, true);
    }
  }
  app.labelsOn = true;
  syncLayers();
}
export function clearLabelKinds() { app.labelKinds.clear(); syncLayers(); }
export function setRotate(on) { app.rotate = on; nudgeIdle(); }
export function setRegister(r) { app.register = r; ui.relabel(); }
export function setInstruction(on) { app.instructionOn = on; ui.relabel(); }

export async function setLayer(name, on) {
  /* A body declares its own layers, so asking for one it does not carry is a legitimate
   * question with the answer "there is none" — it threw on `app.layers[name].on` instead,
   * which took down whatever asked. It warns rather than passing silently, because a typo
   * in a layer name and a body that genuinely lacks one look identical from here. */
  if (!app.layers[name]) { console.warn(`no layer "${name}" on this body`); return; }
  app.layers[name].on = on;
  if (on) await loadLayer(name);
  syncLayers();
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
function onlyShow(ids) {
  const want = new Set();
  const extra = [];
  for (const id of ids) for (const m of meshesOfId.get(id) ?? []) {
    const sub = parcelMesh(m, id);
    /* A parcel mesh is built once and kept, and it borrowed its material at that moment — so
     * a later look change, or the specimen swap below, would leave the parcel wearing the
     * material the cortex used to have. It follows its parent every time it is shown. */
    if (sub) { sub.material = m.material; extra.push(sub); } else want.add(m);
  }
  return onlyMeshes(want, extra);
}

/**
 * Hide every drawable but these. Returns the undo, or null when there is nothing to show.
 *
 * **Leaves only.** Hiding a group would take its wanted children with it, and the brain's
 * holder and the rig's segments are groups that everything else in the scene hangs from.
 * `extra` is for meshes built for this render — a single cortical parcel — which are hidden
 * again rather than restored, because they were never visible in the first place.
 */
function onlyMeshes(want, extra = []) {
  if (!want.size && !extra.length) return null;
  const hidden = [];
  scene.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isLine) || want.has(o) || !o.visible) return;
    hidden.push(o); o.visible = false;
  });
  for (const m of want) m.visible = true;
  for (const m of extra) m.visible = true;
  return () => {
    for (const o of hidden) o.visible = true;
    for (const m of extra) m.visible = false;
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
  const radius = id != null ? Math.max(0.03, (app.radii[id] ?? 0.05) * 1.9) : span;
  const bilateral = r?.sides?.length === 2 || Math.abs(c.x) < 0.02;
  let dir = bilateral ? LEFT_VIEW.clone()
          : new THREE.Vector3(c.x, 0, Math.abs(c.z) + 0.25).normalize();
  if (dir.x < 0.15) { dir.x = 0.5; dir.normalize(); }
  const pts = (side?.points?.length ?? 0) >= 4 ? side.points.slice() : [];
  if (pts.length < 4)
    for (const v of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
      pts.push(c.clone().addScaledVector(new THREE.Vector3(...v), radius));
  const { target, distance } =
    frameFor(pts, dir, radius * 0.45, 0.06, 0, { aspect, inset: false });
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
    ? (id != null ? onlyShow([id])
                  : (jbones?.size ? onlyMeshes(jbones) : onlyLayers(['skeleton'])))
    : onlyLayers(viewLayers(id));
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
  try { ok = paintInto(canvas, w, h, cam); } finally { undo?.(); peel?.(); look?.(); }
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
function paintInto(canvas, w, h, cam) {
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
        const r = registry().byName.get(name);
        if (!r) { console.warn(`exercise ${key} names an unknown muscle: ${name}`); continue; }
        activation.set(r.id, role);
        palette.setActivation(r.id, ROLE_LEVEL[role]);
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
    rig.reset();
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
export const frameStats = () => ({ frames: frameCount, labels: labels.length });
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
  setRotate, setRegister, setInstruction, setLayer, setLayerOpacity, setView, resetView,
  setExercise, setPathway, captureStage, activationOf, flyTo,
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
])
  .then(async ([gen, rigData, pathData]) => {
    buildRegistry(gen, { brain: hasLayer('brain') });
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

function resize() {
  const r = canvas.getBoundingClientRect();
  const w = Math.round(r.width), h = Math.round(r.height);
  if (!w || !h || (canvas.width === w && canvas.height === h)) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!composer) {
    // decided once, on the first real size, when there is a context to ask
    app.bloom = !softwareRenderer();
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
  if (!app.labOpen) hud?.tick(tsec, {
    drive: app.layers.brain.on ? app.activity : 0,
    regions: app.layers.brain.on ? brainRegionIds() : [],
    selected: app.selected != null ? nameOf(app.selected, app.lang) : null,
    structures: REG_READY ? registry().byId.size : 0,
    nodes: neuralNet?.stats().nodes ?? 0,
  });
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
  tickNeuralNet(tsec);

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
  controls.update(); root.updateMatrixWorld();
  // after the bones have their world matrices for this frame and before anything is drawn
  boneDQ?.update();
  if (!hidden) {
    renderPipeline();
    updateLabels();
  }
});
