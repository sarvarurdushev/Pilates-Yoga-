/**
 * Groups: the things a coach names out loud that are not a single mesh.
 *
 * "Let the hamstrings go", "the deep neck flexors are asleep", "breathe into the
 * back of the ribs" — none of those is one structure, and until now none of them
 * was anything this application could point at. It could select `semitendinosus`
 * and it could select `semimembranosus`, one at a time, which is not how anybody
 * teaches.
 *
 * **The membership is not written here.** `scripts/build_groups.py` closes the
 * Foundational Model of Anatomy's own IS-A and PART-OF trees over this atlas's
 * FMA ids and writes `generated/groups.json`: 252 groups, every one of them a
 * concept the ontology already had, with members it already vouched for. That
 * matters more than it sounds. A hand-written list of "the hamstrings" is one
 * person's memory of an anatomy class, it drifts from the meshes the moment the
 * build renumbers anything, and nobody ever checks it. This one is derived, so
 * it is checkable — `test_groups.py` re-derives it and fails if it moved.
 *
 * **What is written here is which groups to offer, and what to call them.** The
 * generator emits `irregular bone` and `left ring finger` alongside `pelvic
 * diaphragm`, because the ontology classifies bones by shape and fingers by
 * name and both are true. Choosing the seventy-odd that a Pilates or yoga studio
 * actually uses is an editorial judgement, and editorial judgements belong in a
 * file somebody can read and argue with rather than in a filter expression.
 *
 * Three columns, and the third is doing real work: the FMA gives one member set
 * several names, and the id chosen here decides which of them shows. The twelve
 * thoracic vertebrae are `posterior chest`, `posterior thoracic wall`, `set of
 * thoracic vertebrae` and `thoracic vertebra` — the same twelve bones, and only
 * the last is the one anybody would look for.
 *
 * Korean is written out rather than transliterated. Where the standard term and
 * the everyday one differ, this takes the standard one: 넙다리, not 허벅지.
 */
/** The sections the groups are offered in, in the order a class works through. */
export const GROUP_REGIONS = [
  { id: 'core',     en: 'Core and trunk',   ko: '코어와 몸통' },
  { id: 'pelvis',   en: 'Pelvis and hip',   ko: '골반과 엉덩관절' },
  { id: 'shoulder', en: 'Shoulder and arm', ko: '어깨와 팔' },
  { id: 'neck',     en: 'Neck',             ko: '목' },
  { id: 'leg',      en: 'Leg and foot',     ko: '다리와 발' },
  { id: 'spine',    en: 'Spine and ribs',   ko: '척추와 갈비' },
  { id: 'frame',    en: 'Skeletal frame',   ko: '뼈대' },
];

/**
 * `[concept id, region, Korean, optional short English]`.
 *
 * The fourth column is a display label, not a rename: the ontology's own wording
 * stays on the group and is shown as its formal name. It exists because
 * `muscle of free lower limb` is exactly right and nobody says it.
 */
const CURATED = [
  // ---------------------------------------------------------------- core
  ['FMA86917',  'core',     '복부 근육',            'Abdominal muscles'],
  ['FMA259054', 'core',     '복벽',                 'Abdominal wall'],
  ['FMA71291',  'core',     '등 근육',              'Back muscles'],
  ['FMA22594',  'core',     '척주 근육',            'Muscles of the spine'],
  ['FMA32515',  'core',     '척추 뒤 근육',         'Behind the spine'],
  ['FMA32559',  'core',     '얕은 척추 뒤 근육',    'Erector spinae'],
  ['FMA32561',  'core',     '깊은 척추 뒤 근육',    'Deep segmental spine'],
  ['FMA32514',  'core',     '척추 앞 근육',         'In front of the spine'],
  ['FMA58274',  'core',     '몸통 근육',            'Trunk muscles'],
  ['FMA71293',  'core',     '가슴 근육',            'Chest muscles'],
  ['FMA9619',   'core',     '가슴우리 근육',        'Breathing muscles'],
  ['FMA13354',  'core',     '갈비사이근',           null],
  ['FMA77177',  'core',     '엉덩갈비근',           null],
  ['FMA77178',  'core',     '가장긴근',             null],
  ['FMA77179',  'core',     '가시근',               null],
  ['FMA22823',  'core',     '반가시근',             null],
  ['FMA77180',  'core',     '널판근',               null],
  ['FMA23081',  'core',     '돌림근',               'Rotatores'],
  ['FMA13400',  'core',     '뒤톱니근',             null],
  // -------------------------------------------------------------- pelvis
  ['FMA19726',  'pelvis',   '골반가로막',           'Pelvic floor'],
  ['FMA19087',  'pelvis',   '항문올림근',           null],
  ['FMA9579',   'pelvis',   '회음',                 null],
  ['FMA37367',  'pelvis',   '골반이음뼈 근육',      'Muscles of the pelvic girdle'],
  ['FMA64922',  'pelvis',   '볼기근',               'Glutes and deep rotators'],
  ['FMA19083',  'pelvis',   '폐쇄근',               null],
  ['FMA22319',  'pelvis',   '쌍둥이근',             null],
  ['FMA64918',  'pelvis',   '엉덩허리근',           null],
  // ------------------------------------------------------------ shoulder
  ['FMA23217',  'shoulder', '팔이음구조',           'Shoulder girdle'],
  ['FMA37347',  'shoulder', '팔이음뼈 근육',        'Muscles of the shoulder girdle'],
  ['FMA25200',  'shoulder', '어깨뼈 부분',          'Around the shoulder blade'],
  ['FMA33531',  'shoulder', '어깨 근육',            null],
  ['FMA32520',  'shoulder', '어깨 속근육',          'Deep shoulder'],
  ['FMA32516',  'shoulder', '어깨 바깥근육',        'Outer shoulder'],
  ['FMA37349',  'shoulder', '가슴근',               'Pectorals'],
  ['FMA37370',  'shoulder', '위팔 근육',            'Upper arm'],
  ['FMA37371',  'shoulder', '아래팔 근육',          'Forearm'],
  ['FMA37348',  'shoulder', '팔 근육',              'Whole arm'],
  // ----------------------------------------------------------------- neck
  ['FMA71290',  'neck',     '목 근육',              'Neck muscles'],
  ['FMA64829',  'neck',     '목갈비근',             'Scalenes'],
  ['FMA32582',  'neck',     '뒤통수밑근',           'Suboccipitals'],
  ['FMA64875',  'neck',     '앞통수밑근',           'Deep neck flexors'],
  ['FMA46290',  'neck',     '목뿔위근',             null],
  ['FMA13338',  'neck',     '목뿔아래근',           null],
  ['FMA64822',  'neck',     '얕은 목근육',          null],
  // ------------------------------------------------------------------ leg
  ['FMA22470',  'leg',      '넙다리 근육',          'Thigh muscles'],
  ['FMA45151',  'leg',      '넙다리 앞칸',          'Front of thigh'],
  ['FMA45160',  'leg',      '넙다리 안쪽칸',        'Adductors'],
  ['FMA45157',  'leg',      '넙다리 뒤칸',          'Hamstrings'],
  ['FMA22428',  'leg',      '넙다리네갈래근',       'Quadriceps'],
  ['FMA22471',  'leg',      '종아리 근육',          'Lower leg'],
  ['FMA45163',  'leg',      '종아리 앞칸',          'Front of lower leg'],
  ['FMA22474',  'leg',      '종아리 뒤칸',          'Back of lower leg'],
  ['FMA65008',  'leg',      '종아리 뒤칸 깊은근육', 'Deep calf'],
  ['FMA22473',  'leg',      '종아리 가쪽칸',        'Outside of lower leg'],
  ['FMA51062',  'leg',      '장딴지세갈래근',       'Calf'],
  ['FMA37369',  'leg',      '발 근육',              'Foot muscles'],
  ['FMA65046',  'leg',      '발바닥 고유근',        'Sole of the foot'],
  ['FMA37368',  'leg',      '다리 근육',            'Whole leg'],
  // ---------------------------------------------------------------- spine
  ['FMA9914',   'spine',    '척추뼈',               'Vertebrae'],
  ['FMA9915',   'spine',    '목뼈',                 'Cervical vertebrae'],
  ['FMA9139',   'spine',    '등뼈',                 'Thoracic vertebrae'],
  ['FMA9921',   'spine',    '허리뼈',               'Lumbar vertebrae'],
  ['FMA10446',  'spine',    '척추사이원반',         'Intervertebral disks'],
  ['FMA13895',  'spine',    '목뼈 사이원반',        'Cervical disks'],
  ['FMA10455',  'spine',    '등뼈 사이원반',        'Thoracic disks'],
  ['FMA13894',  'spine',    '허리뼈 사이원반',      'Lumbar disks'],
  ['FMA7480',   'spine',    '가슴우리',             'Rib cage'],
  ['FMA7574',   'spine',    '갈비뼈',               'Ribs'],
  ['FMA7485',   'spine',    '복장뼈',               'Sternum'],
  ['FMA7591',   'spine',    '갈비연골',             'Costal cartilage'],
  // ---------------------------------------------------------------- frame
  ['FMA16580',  'frame',    '뼈 골반',              'Bony pelvis'],
  ['FMA46565',  'frame',    '머리뼈',               'Skull'],
  ['FMA24140',  'frame',    '다리뼈',               'Bones of the leg'],
  ['FMA61406',  'frame',    '팔뼈',                 'Bones of the arm'],
  ['FMA24222',  'frame',    '발뼈',                 'Bones of the foot'],
  ['FMA23889',  'frame',    '손목뼈',               'Carpals'],
  ['FMA24491',  'frame',    '발목뼈',               'Tarsals'],
];

let GROUPS = null;

/**
 * Join the curated list onto the generated table.
 *
 * A curated id that the generator did not emit is a hard error rather than a
 * skip: it means the atlas changed under the curation — a structure renumbered,
 * a group that fell below two members — and silently offering one fewer group
 * is exactly the kind of drift this file exists to prevent. The build's own test
 * catches it before a browser does.
 *
 * @param {object} generated  parsed groups.json
 * @param {Map<number, object>} byId  the structure registry, for member lookup
 * @param {string[]} layerOrder  LAYER_ORDER, passed rather than imported so this
 *                               module and structures.js do not form a cycle
 */
export function buildGroups(generated, byId, layerOrder = []) {
  const table = new Map();
  for (const g of generated.groups) {
    table.set(g.id, g);
    for (const a of g.aliases) table.set(a.id, { ...g, id: a.id, name: a.name });
  }

  const list = [];
  const missing = [];
  for (const [fma, region, ko, short] of CURATED) {
    const g = table.get(fma);
    if (!g) { missing.push(fma); continue; }
    const members = g.members.filter(id => byId.has(id));
    list.push({
      fma,
      region,
      /* The formal name is the ontology's. `name` is what the interface says,
       * which is the formal name unless the curation gave a plainer one. */
      formal: g.name,
      name: { en: short ?? g.name, ko },
      members,
      /* Which layers have to be on for the group to be visible at all. A group
       * lit under a layer that is off is a claim nobody can see. */
      layers: layerOrder.filter(l => members.some(id => byId.get(id).layer === l)),
    });
  }
  if (missing.length)
    console.error(`groups.js names ${missing.length} concept(s) the build did not emit: ` +
                  missing.join(', '));

  const byFma = new Map(list.map(g => [g.fma, g]));
  const forStructure = new Map();
  for (const g of list)
    for (const id of g.members) {
      const at = forStructure.get(id) ?? [];
      at.push(g);
      forStructure.set(id, at);
    }
  /* Smallest first, so a muscle's own most specific group leads: semitendinosus
   * belongs to the hamstrings, the thigh and the whole leg, and the hamstrings is
   * the one worth reading. */
  for (const at of forStructure.values()) at.sort((a, b) => a.members.length - b.members.length);

  GROUPS = { list, byFma, forStructure, meta: generated };
  return GROUPS;
}

export function groups() {
  return GROUPS ?? { list: [], byFma: new Map(), forStructure: new Map(), meta: null };
}

/** The groups a structure belongs to, most specific first. */
export const groupsOf = id => groups().forStructure.get(+id) ?? [];

/** One group by concept id. */
export const groupOf = fma => groups().byFma.get(fma) ?? null;
