import { POSITION, ACTION, BREATH_PATTERN, CONTRA, FAULT, CUE, FAMILY, PROP } from './vocabulary.js';

/**
 * Turns a compact exercise record into the full `EXERCISE` entry and its `MOTION` clip.
 *
 * A record carries only what is specific to the exercise: the position, the joint actions,
 * the target pose in degrees, the muscles in their roles with an evidence marker each, the
 * contraindication classes, the breath pattern, the brain claims. Everything a reader sees
 * is composed from that through the shared vocabulary, in both languages, deterministically.
 *
 * The pose is doing double duty and that is the point: it is both the anatomical claim
 * ("this exercise puts the hip in 90 degrees of flexion") and the animation. There is no
 * second, separately-authored version of the movement that could drift away from the text.
 */

const D = Math.PI / 180;
const TRANSLATIONS = new Set(['pelvis_tx', 'pelvis_ty', 'pelvis_tz']);
const WAVE = /_wave$/;

/** Degrees in the record become radians for the rig; translations and waves pass through. */
export function toRadians(pose) {
  const out = {};
  for (const [k, v] of Object.entries(pose ?? {}))
    out[k] = (TRANSLATIONS.has(k) || WAVE.test(k)) ? v : v * D;
  return out;
}

const listEn = a => a.length <= 1 ? (a[0] ?? '')
  : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const listKo = a => a.join(', ');

/* ---------------------------------------------------------------------- prose */

function summary(r, lang) {
  const pos = POSITION[r.position]?.[lang] ?? '';
  const acts = (r.actions ?? []).map(a => ACTION[a]?.plain?.[lang]).filter(Boolean);
  const list = lang === 'ko' ? listKo(acts) : listEn(acts);
  if (lang === 'ko') {
    const held = r.hold ? `${r.hold}초 유지합니다` : (r.reps ? `${r.reps}회 반복합니다` : '조절하며 반복합니다');
    return `${pos}에서 ${list}. ${held}.`;
  }
  const held = r.hold ? `Held for about ${r.hold} seconds`
             : (r.reps ? `Repeated ${r.reps} times` : 'Repeated with control');
  return `From ${pos}: ${list}. ${held}.`;
}

function setup(r, lang) {
  const pos = POSITION[r.position]?.[lang] ?? '';
  const extra = r.setup?.[lang];
  if (extra) return extra;
  const props = (r.props ?? []).map(p => PROP[p]?.[lang]).filter(Boolean);
  const propText = props.length
    ? (lang === 'ko' ? ` 준비물: ${listKo(props)}.` : ` Props: ${listEn(props)}.`)
    : '';
  return lang === 'ko'
    ? `${pos}로 시작합니다. 움직이기 전에 골반과 흉곽을 중립으로 놓고, 목표 자세로 가는 동안 그 관계를 유지하세요.${propText}`
    : `Begin ${pos}. Set the pelvis and ribcage in neutral before anything moves, and keep that relationship as you travel into the shape.${propText}`;
}

function tempo(r, lang) {
  if (r.tempo?.[lang]) return r.tempo[lang];
  if (r.hold) {
    return lang === 'ko'
      ? `약 ${r.hold}초 유지합니다. 유지 중에도 호흡은 계속 움직여야 합니다.`
      : `Held for about ${r.hold} seconds. The breath has to keep moving inside the hold.`;
  }
  return lang === 'ko'
    ? `${r.reps ?? 8}회. 각 방향 2–3초로 고르게, 돌아오는 구간을 서두르지 않습니다.`
    : `${r.reps ?? 8} repetitions, two to three seconds each way. The return is the half most people rush.`;
}

function faultsFor(r, lang) {
  const acts = new Set(r.actions ?? []);
  const keys = (r.faults ?? []).concat(
    Object.entries(FAULT).filter(([k, f]) => acts.has(f.action) && !(r.faults ?? []).includes(k))
      .map(([k]) => k));
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    const f = FAULT[k];
    if (!f || seen.has(k)) continue;
    seen.add(k);
    out.push(f[lang]);
    if (out.length >= 4) break;
  }
  if (!out.length) out.push(FAULT['breath-hold'][lang]);
  return out;
}

function contraindications(r, lang) {
  const classes = r.contra ?? [];
  const parts = classes.map(c => CONTRA[c]?.[lang]).filter(Boolean);
  if (!parts.length) {
    return lang === 'ko'
      ? '특정 금기는 없지만, 통증·부상·임신·질환이 있다면 시작 전에 전문가와 상담하십시오.'
      : 'No specific contraindication class applies, but see a professional before starting if you have pain, an injury, are pregnant or have a medical condition.';
  }
  return parts.join(' ');
}

function progressions(r, lang) {
  if (r.progressions?.[lang]) return r.progressions[lang];
  const acts = new Set(r.actions ?? []);
  const out = [];
  if (r.hold) out.push(lang === 'ko' ? '유지 시간 늘리기' : 'Hold for longer');
  else out.push(lang === 'ko' ? '가동범위 늘리기' : 'Take more range');
  if (acts.has('balance')) out.push(lang === 'ko' ? '눈 감기' : 'Close the eyes');
  if (acts.has('hip-flexion')) out.push(lang === 'ko' ? '다리를 더 길게 뻗어 지렛대 늘리기' : 'Lengthen the lever by extending the legs');
  out.push(lang === 'ko' ? '불안정한 지지면 추가' : 'Add an unstable surface');
  return out.slice(0, 3);
}

function regressions(r, lang) {
  if (r.regressions?.[lang]) return r.regressions[lang];
  const acts = new Set(r.actions ?? []);
  const out = [];
  out.push(lang === 'ko' ? '가동범위 줄이기' : 'Reduce the range');
  if (acts.has('trunk-flexion')) out.push(lang === 'ko' ? '머리를 매트에 두기' : 'Keep the head down on the mat');
  if (acts.has('hip-flexion')) out.push(lang === 'ko' ? '무릎 굽히기' : 'Bend the knees');
  if (acts.has('balance') || acts.has('weight-bearing-arms'))
    out.push(lang === 'ko' ? '벽이나 블록으로 지지하기' : 'Support at a wall or on blocks');
  out.push(lang === 'ko' ? '반복 수나 유지 시간 줄이기' : 'Fewer repetitions or a shorter hold');
  return out.slice(0, 3);
}

function focusCue(r, lang) {
  if (r.cue?.[lang]) return r.cue[lang];
  for (const a of r.actions ?? []) if (CUE[a]) return CUE[a][lang];
  return CUE['isometric-hold'][lang];
}

function breathText(r, lang) {
  const b = BREATH_PATTERN[r.breath] ?? BREATH_PATTERN.natural;
  return `${b[lang].name}. ${b[lang].how}`;
}

/**
 * The note that says what the muscle attributions rest on. Composed from the markers the
 * record actually carries, so it can never claim more than the data does.
 */
function emgNote(r, lang) {
  const all = [...r.muscles.prime, ...r.muscles.synergists, ...r.muscles.stabilisers];
  const measured = all.filter(([, ev]) => ev === 'emg').length;
  const total = all.length;
  if (lang === 'ko') {
    return measured === 0
      ? `이 동작의 ${total}개 근육 배정은 모두 해부학과 생체역학에서 추론한 것입니다. 이 운동을 직접 측정한 근전도 연구를 찾지 못했습니다. 복횡근과 다열근은 표면 전극으로 측정 자체가 불가능하며 세침 근전도나 초음파가 필요합니다.`
      : `${total}개 중 ${measured}개 근육은 이 동작 또는 동일한 관절 동작을 다룬 근전도 연구에서 확인된 것이고, 나머지는 해부학과 생체역학에서 추론했습니다. 심부 안정근은 표면 전극으로 측정할 수 없어 항상 추론입니다.`;
  }
  return measured === 0
    ? `All ${total} muscle attributions here are inferred from anatomy and biomechanics. No EMG study measuring this exercise was found. Transversus abdominis and multifidus cannot be measured with surface electrodes at all — they need fine-wire or ultrasound — so their role is always inference.`
    : `${measured} of ${total} muscle roles are supported by EMG measuring this exercise or the same joint action; the rest are inferred from anatomy and biomechanics. Deep stabilisers are always inferred, because surface electrodes cannot reach them.`;
}

/* ------------------------------------------------------------------ the entry */

export function composeExercise(r, reviewer) {
  const fam = FAMILY[r.family];
  const out = {
    discipline: fam.discipline,
    family: r.family,
    apparatus: r.apparatus ?? null,
    props: r.props ?? [],
    difficulty: r.difficulty,
    sanskrit: r.sanskrit ?? null,
    actions: r.actions ?? [],
    composed: true,
    muscles: r.muscles,
    emgNote: { en: emgNote(r, 'en'), ko: emgNote(r, 'ko') },
    brain: r.brain,
    reviewed: r.reviewed === false ? false : reviewer,
  };
  for (const lang of ['en', 'ko']) {
    out[lang] = {
      name: r[lang].name,
      summary: r[lang].summary ?? summary(r, lang),
      setup: setup(r, lang),
      breath: breathText(r, lang),
      tempo: tempo(r, lang),
      faults: faultsFor(r, lang),
      contraindications: contraindications(r, lang),
      progressions: progressions(r, lang),
      regressions: regressions(r, lang),
      focusCue: focusCue(r, lang),
    };
  }
  return out;
}

/* ------------------------------------------------------------------- the clip
 * A record's `pose` is the shape; `entry` is where the movement starts from. A held pose
 * travels in, holds, and travels out. A repeated movement oscillates between the two. Breath
 * phases follow the pattern rather than being written per exercise. */

const PHASE_FOR = {
  'exhale-effort':  [['in', 0], ['out', 0.3]],
  'lateral-costal': [['in', 0], ['out', 0.3]],
  'ujjayi':         [['in', 0], ['out', 0.45]],
  'braced':         [['hold', 0], ['out', 0.55]],
  'natural':        [['in', 0], ['out', 0.5]],
};

/**
 * Where a clip starts when the record does not say.
 *
 * Without this a supine exercise would begin at the model's default — standing, every
 * coordinate zero — and the clip would show the figure lying down and getting up again on
 * every loop. The resting shape of the position is the honest starting point, and a record
 * that wants something else states its own `entry`.
 */
const BASE = {
  supine:      { pelvis_tilt: -90 },
  supported:   { pelvis_tilt: -90 },
  prone:       { pelvis_tilt: 90 },
  sidelying:   { pelvis_tilt: -90, pelvis_list: 88 },
  inverted:    { pelvis_tilt: -90 },
  reformer:    { pelvis_tilt: -90 },
  seated:      { hip_flexion_r: 88, hip_flexion_l: 88, knee_angle_r: 6, knee_angle_l: 6 },
  chairSeated: { hip_flexion_r: 88, hip_flexion_l: 88, knee_angle_r: 88, knee_angle_l: 88 },
  crossLegged: { hip_flexion_r: 70, hip_flexion_l: 70, hip_adduction_r: -30, hip_adduction_l: -30,
                 hip_rotation_r: -30, hip_rotation_l: -30, knee_angle_r: 104, knee_angle_l: 104 },
  kneeling:    { hip_flexion_r: 12, hip_flexion_l: 12, knee_angle_r: 110, knee_angle_l: 110 },
  quadruped:   { pelvis_tilt: -84, hip_flexion_r: 88, hip_flexion_l: 88,
                 knee_angle_r: 92, knee_angle_l: 92, arm_flex_r: 82, arm_flex_l: 82 },
  plank:       { pelvis_tilt: 84, arm_flex_r: 86, arm_flex_l: 86, wrist_flex_r: -54, wrist_flex_l: -54 },
  // standing, lunge and the folds all start from the model's own standing default
};

export function composeMotion(r) {
  if (!r.pose) return null;
  const entry = toRadians(r.entry ?? BASE[r.position] ?? {});
  const pose = toRadians(r.pose);
  // anything neither the entry nor the position's resting shape mentions returns to the
  // model's default, so a record only has to state what it actually changes
  const full = { ...Object.fromEntries(Object.keys(pose).map(k => [k, entry[k] ?? 0])), ...entry };
  const act = r.activation ?? {};
  const rest = Object.fromEntries(Object.entries(act).map(([k, v]) => [k, v * 0.35]));

  const held = !!r.hold;
  const duration = held ? Math.max(4000, (r.hold ?? 5) * 1000)
                        : Math.max(3000, Math.round(60000 / (r.tempoBpm ?? 20)));
  const keys = held
    ? [{ t: 0, c: full, act: rest },
       { t: 0.3, c: pose, act },
       { t: 0.75, c: pose, act },
       { t: 1, c: full, act: rest }]
    : [{ t: 0, c: full, act: rest },
       { t: 0.5, c: pose, act },
       { t: 1, c: full, act: rest }];

  const pattern = PHASE_FOR[r.breath] ?? PHASE_FOR.natural;
  const phases = pattern.map(([breath, at]) => ({
    at, breath,
    en: BREATH_LABEL[breath].en, ko: BREATH_LABEL[breath].ko,
  }));

  return {
    duration, loop: true, provenance: 'handkeyed',
    composed: true,
    limitation: r.limitation ?? null,
    phases, keys,
  };
}

const BREATH_LABEL = {
  in:   { en: 'Inhale, travelling in', ko: '들숨, 들어가기' },
  out:  { en: 'Exhale through the effort', ko: '날숨, 힘쓰는 구간' },
  hold: { en: 'Braced', ko: '브레이싱' },
};
