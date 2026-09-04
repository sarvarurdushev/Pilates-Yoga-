/**
 * Which body is on screen, and everything that is true of it rather than of the app.
 *
 * Until now there was exactly one body and every fact about it was spread across the code as
 * a constant: the frame in `frame.js`, the asset paths inline in `main.js`, the attribution
 * hard-coded in English in the About panel. None of that is a property of the *application* —
 * it is a property of one scanned person, and the moment there are two people it has to be
 * data.
 *
 * A body here is six generated artefacts, all fitted to one anatomy: the structure table, the
 * layer meshes, the body frame, the rig registration, the brain-to-body transform and the
 * envelope shell. Content is not among them — `MUSCLE_INFO`, the exercise library and
 * `REGION_INFO` are keyed by **name**, never by id, so "gluteus maximus" is the same entry
 * whichever body is loaded. That is what makes a second body a data drop rather than a
 * rewrite, and it is why the id-vs-name rule in CLAUDE.md is worth keeping.
 *
 * **Switching reloads the page.** It is not a live swap, deliberately. Half of `main.js`'s
 * state is per-body — the bone field, the `bound` map, the rest-pose index, the palette, the
 * label lanes — and tearing all of that down correctly is a large class of bugs in exchange
 * for saving a reload on an action a reader takes rarely and deliberately. `bodyHref()` builds
 * the link; the browser does the rest.
 */

/**
 * Every body the app knows about, available or not.
 *
 * An entry that is not `available` is still described in full. That is deliberate: a reader
 * who asks whether there is a female body deserves a straight answer, and the answer is in
 * this body's own `templateNote`: there is no female anatomy in this atlas at all. A second
 * body was built here once, from published proportions, and removed again; `docs/DECISIONS.md`
 * records what it cost and what it could not produce.
 */
export const BODIES = {
  male: {
    id: 'male',
    available: true,
    name: { en: 'Male', ko: '남성' },
    /* Said in the first person plural of the atlas, not of the user: this is who was scanned. */
    subject: {
      en: 'One adult male, imaged by MRI and segmented into 1,524 named parts.',
      ko: '성인 남성 한 명. MRI로 촬영되어 1,524개의 명명된 부위로 분할되었습니다.',
    },
    /** Whole body. A partial body states its bounds here and the app repeats them on screen. */
    bounds: null,
    /** The sentence this particular person's atlas owes the reader, on the template chip. */
    templateNote: {
      en: 'It is not a female body: this atlas has no female anatomy in it at all — the pelvis, the ribcage, the muscle proportions and the pelvic organs are all one man’s.',
      ko: '여성의 몸이 아닙니다. 이 아틀라스에는 여성 해부 구조가 전혀 없습니다. 골반, 흉곽, 근육 비율, 골반 장기 모두 한 남성의 것입니다.',
    },
    source: 'BodyParts3D/Anatomography, release 3.0 (20110915)',
    sourceUrl: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/',
    licence: 'CC BY-SA 2.1 Japan',
    attribution: 'BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan',
    citation: 'Mitsuhashi N et al., BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Res. 2009;37(Database issue):D782-5.',
    /* The peripheral nervous system comes from a second source, which is derived from the
     * first — so it is the same man, and a body that is not him cannot borrow it. */
    nervousSource: 'Z-Anatomy by Gauthier Kervyn and Marcin Zielinski, CC BY-SA 4.0, derived from BodyParts3D',
    assets: {
      structures: 'src/generated/structures.json',
      rig: 'src/generated/rig.json',
      musclePaths: 'src/generated/muscle_paths.json',
      models: 'models',
      layers: ['organs', 'muscles_superficial', 'muscles_deep', 'nervous', 'skeleton'],
      shell: 'models/shell.glb',
    },
    /**
     * Origin: ASIS midpoint. Scale: standing height = 1.0, so y = 0 is the pelvis,
     * y ≈ +0.447 the vertex and y ≈ −0.553 the floor.
     *
     * Measured, not chosen. `scripts/derive_frame.py` reads the skin mesh for the
     * sole-to-vertex extent and the two hip-bone meshes for the ASIS. Rebuilding a body from
     * a different source means re-running it — these numbers are never copied between bodies.
     * Sanity checks it prints: ASIS at 0.553 of stature against a published ~0.57, and an
     * inter-ASIS width of 233 mm.
     *
     * `center` is in canonical millimetres (+X LEFT, +Y SUPERIOR, +Z ANTERIOR), already
     * permuted out of the archive's own axes — see `bodyFromSource` in `frame.js`.
     */
    frame: {
      center: [1.7805, 902.37, 152.115],
      scale: 0.000604146195,
      provisional: false,
      landmark: 'ASIS midpoint',
      unit: 'standing height = 1.0',
      heightMm: 1655.23,
    },
    /**
     * Similarity transform (uniform scale + rotation + translation, no shear) taking a point
     * in the brain frame to the same point in this body's frame.
     *
     * Fitted, not estimated: `scripts/derive_frame.py` pairs ten structures present in both
     * models and solves by Umeyama, reflection guarded. Mean residual 6.5 mm, worst 15.4 mm,
     * about what registering two different people's brains by structure centroids should cost.
     *
     * The −15.6° pitch is real — the angle between fsaverage's AC-PC alignment and this
     * subject's head posture — which is why it could not have been guessed. An earlier attempt
     * that resolved the right-hemisphere landmarks by incrementing FMA ids picked up the right
     * supramarginal gyrus in place of the right postcentral, and the left-biased centroids came
     * back as 12° of roll the anatomy cannot have.
     */
    brainToBody: {
      scale: 0.0984331345,
      rotation: [-0.27194, 0.00676966, -0.0488966],          // XYZ Euler radians
      translation: [-0.00179225, 0.404775, -0.0410048],
      provisional: false,
      landmarks: ['cerebellum', 'brainstem', 'motor cortex', 'somatosensory', 'hippocampus',
                  'amygdala', 'thalamus', 'corpus callosum', 'lateral ventricle', 'basal ganglia'],
      residualMm: { mean: 6.52, max: 15.4 },
    },
  },

};

export const DEFAULT_BODY = 'male';

/** Ids of the bodies that can actually be loaded right now. */
export function availableBodies() {
  return Object.values(BODIES).filter(b => b.available).map(b => b.id);
}

/**
 * The body to load, from `?body=` where it names an available one.
 *
 * Guarded for Node, because the tools and the tests import this file with no DOM. An
 * unavailable or unknown id falls back rather than throwing: a stale bookmark should show the
 * app, not a blank page.
 */
export function activeBodyId() {
  if (typeof location === 'undefined') return DEFAULT_BODY;
  const want = new URLSearchParams(location.search).get('body');
  return want && BODIES[want]?.available ? want : DEFAULT_BODY;
}

/** The active body's record. */
export function activeBody() {
  return BODIES[activeBodyId()];
}

/** Where to point a link that switches body. Switching reloads — see the file header. */
export function bodyHref(id) {
  if (typeof location === 'undefined') return `?body=${id}`;
  const u = new URL(location.href);
  if (id === DEFAULT_BODY) u.searchParams.delete('body');
  else u.searchParams.set('body', id);
  return u.pathname + u.search + u.hash;
}

/**
 * The template disclaimer, for the body that is actually loaded.
 *
 * This is one of the four lines that must not move, and it is the one line among them that is
 * *about the body* rather than about the app — so leaving it as static English in
 * `strings.js` would mean a female body carrying a male body's disclaimer, which is worse
 * than no disclaimer at all. `strings.js` keeps the universal half; the sex, the subject and
 * the bounds come from here.
 */
/**
 * The first of the four lines that must not move, composed for the body that is loaded.
 *
 * There is one body, so this composes one disclaimer — but it composes it *from the body*
 * rather than from a literal, and that is worth keeping. A second body of any kind must carry
 * its own subject line and its own bounds, and a title that says which body it is; a body
 * wearing another body's disclaimer would be worse than no disclaimer at all.
 */
export function templateDisclaimer(body, lang, base) {
  const sex = body.name[lang] ?? body.name.en;
  const title = lang === 'ko'
    ? `한 ${sex}의 표준 인체이며 당신의 몸이 아닙니다`
    : `One ${sex.toLowerCase()} template body, not yours`;
  const parts = [base?.body, body.subject[lang], body.templateNote?.[lang], body.bounds?.[lang]];
  return { title, body: parts.filter(Boolean).join(' ') };
}

/** Absolute-ish path to one of a body's layer meshes. */
export function layerUrl(body, name) {
  return `${body.assets.models}/${name}.glb`;
}
