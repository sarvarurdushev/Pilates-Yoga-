/**
 * Anatomical atlas in canonical brain space.
 *
 *   +X right   +Y superior   +Z anterior
 *   origin = brain centroid, anterior-posterior length normalised to 1.0
 *   so z spans about -0.50 (occipital pole) .. +0.50 (frontal pole)
 *
 * Landmarks are expressed as tilted planes, which is how the real ones run:
 * the central sulcus slopes down-and-forward, the lateral (Sylvian) fissure
 * slopes up-and-back. Everything else falls out of those two plus the
 * parieto-occipital boundary.
 *
 * IMPORTANT HONESTY NOTE: this is a spatial approximation fitted to a generated
 * mesh, not a registered anatomical parcellation. It is reliable for lobes and
 * large surface landmarks. It is NOT a substitute for a real atlas (Desikan-Killiany,
 * AAL, etc.) and should never be presented as one.
 */

export const REGIONS = [
  { id: 0,  key: 'unassigned', name: 'Unassigned',        color: '#8a8a8a' },
  { id: 1,  key: 'frontal',    name: 'Frontal lobe',      color: '#4C8DF6' },
  { id: 2,  key: 'parietal',   name: 'Parietal lobe',     color: '#28B487' },
  { id: 3,  key: 'temporal',   name: 'Temporal lobe',     color: '#E9A13B' },
  { id: 4,  key: 'occipital',  name: 'Occipital lobe',    color: '#A05BE8' },
  { id: 5,  key: 'cerebellum', name: 'Cerebellum',        color: '#E255B4' },
  { id: 6,  key: 'brainstem',  name: 'Brainstem',         color: '#E2685F' },
  { id: 7,  key: 'motor',      name: 'Motor cortex',      color: '#1B4FC4' },
  { id: 8,  key: 'somato',     name: 'Somatosensory cortex', color: '#0E7C5A' },
  { id: 9,  key: 'broca',      name: "Broca's area",      color: '#F2C230' },
  { id: 10, key: 'wernicke',   name: "Wernicke's area",   color: '#F07E26' },
];

// --- landmark surfaces -------------------------------------------------------
// central sulcus: near-vertical, tilted so it sits further forward lower down
export const zCentral = (y) => 0.12 - 0.333 * y;
// lateral (Sylvian) fissure: rises as it runs backwards
export const ySylvian = (z) => -0.02 - 0.27 * z;
// parieto-occipital boundary
export const zParietoOcc = (y) => -0.28 - 0.10 * y;

const CEREBELLUM = { c: [0, -0.20, -0.27], r: 0.235 };
const BROCA      = { c: [-0.28, -0.03, 0.20], r: 0.105 };
const WERNICKE   = { c: [-0.30,  0.00, -0.15], r: 0.105 };

const d2 = (x, y, z, c) => (x-c[0])**2 + (y-c[1])**2 + (z-c[2])**2;

export function classify(x, y, z) {
  // 1. brainstem: thin midline column hanging below the cerebrum
  if (Math.abs(x) < 0.075 && y < -0.13 && z > -0.20 && z < 0.10) return 6;

  // 2. cerebellum: discrete posterior-inferior mass
  if (y < -0.02 && z < -0.10 && d2(x, y, z, CEREBELLUM.c) < CEREBELLUM.r ** 2) return 5;

  const aboveSylvian = y > ySylvian(z);

  // 3. language areas (left hemisphere only, by convention -X = left)
  if (x < 0) {
    if (d2(x, y, z, BROCA.c)    < BROCA.r ** 2    && z > 0.06) return 9;
    if (d2(x, y, z, WERNICKE.c) < WERNICKE.r ** 2 && z < 0.02) return 10;
  }

  if (!aboveSylvian) {
    // below the Sylvian fissure -> temporal, unless far enough back to be occipital
    return z < zParietoOcc(y) ? 4 : 3;
  }

  // 4. pre/post-central strips straddling the central sulcus
  const dz = z - zCentral(y);
  if (Math.abs(dz) < 0.055 && y > -0.05) return dz > 0 ? 7 : 8;

  // 5. remaining convexity: frontal / parietal / occipital
  if (dz > 0) return 1;
  return z < zParietoOcc(y) ? 4 : 2;
}
