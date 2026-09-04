/**
 * MOTION — joint-angle timelines, breath markers and per-phase activation.
 *
 * §9 of the brief: an exercise gets a clip, a tempo, breath-phase markers (essential for
 * Pilates — the breath pattern is part of the exercise, not decoration) and per-phase
 * activation keyframes. Scrubbing matters more than playback: a user needs to stop at the
 * top of the movement and ask what is firing.
 *
 * **Provenance, stated plainly.** These angles are hand-keyed against published movement
 * descriptions and the joint definitions of the Rajagopal 2016 model. They are *not* motion
 * capture and *not* inverse kinematics from measured data. The brief lists hand-keying as
 * the expected route for Pilates because the motion-capture literature for mat repertoire
 * does not exist — so this is the sanctioned path, but it is authored data and the UI says
 * so on the timeline itself.
 *
 * The joint *centres* they are keyed against are no longer purely Rajagopal's, and the
 * timeline says that too. The rig and the body were built by different projects, so
 * `tools/fitjoints.mjs` moves each limb joint to the point that keeps this body's own two
 * bones together through the joint's range. Axes, coupling and ranges are unchanged.
 *
 * **Sequential articulation, which used to be impossible here.** Rajagopal's torso is a
 * single rigid body on one lumbar joint, so the first version of these clips flexed the
 * whole trunk as a block and every roll-up carried a `limitation` saying so.
 * `scripts/build_spine.py` replaced that joint with 24 vertebral joints taken from the
 * intervertebral disc centroids, with per-level ranges from White & Panjabi. A clip now
 * writes a *regional* command — `lumbar_flex`, `thoracic_flex`, `cervical_rot` — which the
 * rig distributes across that region's levels weighted by each level's own published range
 * on that axis. `lumbar_wave` adds a travelling front so the region engages one segment at
 * a time: positive peels from the head down, negative from the tail up.
 *
 * Angles are radians, in the model's own coordinates, and **positive `_flex` is flexion** —
 * the opposite sign to the `lumbar_extension` coordinate it replaced, and named so the sign
 * matches the word. `pelvis_tilt` rotates the whole body about the mediolateral axis, which
 * is how a supine exercise gets laid down: the root is a free joint and the mat is at
 * pelvis_ty.
 */

const D = Math.PI / 180;   // the tables read in degrees; the runtime wants radians
/**
 * The three coordinates that are lengths, not angles. Named explicitly rather than matched
 * by prefix: `pelvis_tilt` also begins with "pelvis_t", and a prefix test let 90 degrees
 * through as 90 *radians*, which threw the figure apart in a way that looked like a rigging
 * bug rather than a units bug.
 */
const TRANSLATIONS = new Set(['pelvis_tx', 'pelvis_ty', 'pelvis_tz']);
/** `lumbar_wave` and friends are a position along a sweep, not an angle. */
const WAVE = /_wave$/;
/**
 * Is this coordinate an angle, and therefore something that can be plotted in degrees?
 *
 * Exported because anything that reads a clip back has the same problem the writer had.
 * `sample()` hands out the *converted* values — radians for angles, metres for translations,
 * a fraction for a wave — so a plot that treats them alike labels a 0.09 radian arm swing as
 * "0.09 degrees" and drops it under any sensible threshold, which is exactly what happened.
 */
export const isAngle = k => !TRANSLATIONS.has(k) && !WAVE.test(k);

/**
 * What a coordinate is, in words a reader has.
 *
 * `hip_flexion_r` is the rig's name for it and it is the right name in the code; on a chart it
 * is a barrier. "I still could not understand the joint angles chart" was, in large part, six
 * traces labelled in a vocabulary nobody outside biomechanics has. The plain half says which
 * joint and which way it is moving; the side is appended by the reader of this table.
 *
 * Keyed by the coordinate with any `_r`/`_l` suffix removed. A coordinate with no entry falls
 * back to its own name with the underscores taken out, which is what it did before.
 */
export const COORD_NAME = {
  hip_flexion:      { en: 'hip, thigh forward',        ko: '엉덩관절 · 넓적다리 앞으로' },
  hip_adduction:    { en: 'hip, leg across the body',  ko: '엉덩관절 · 다리 모으기' },
  hip_rotation:     { en: 'hip, thigh turning',        ko: '엉덩관절 · 넓적다리 회전' },
  knee_angle:       { en: 'knee, bending',             ko: '무릎 · 굽힘' },
  ankle_angle:      { en: 'ankle, foot pointing',      ko: '발목 · 발끝 내리기' },
  subtalar_angle:   { en: 'ankle, sole tilting',       ko: '발목 · 발바닥 기울임' },
  mtp_angle:        { en: 'toes, bending',             ko: '발가락 · 굽힘' },
  lumbar_flex:      { en: 'lower back, curling',       ko: '허리 · 말기' },
  lumbar_bend:      { en: 'lower back, side bend',     ko: '허리 · 옆으로 굽힘' },
  lumbar_rot:       { en: 'lower back, twisting',      ko: '허리 · 비틀기' },
  thoracic_flex:    { en: 'mid back, curling',         ko: '등 · 말기' },
  thoracic_bend:    { en: 'mid back, side bend',       ko: '등 · 옆으로 굽힘' },
  thoracic_rot:     { en: 'mid back, twisting',        ko: '등 · 비틀기' },
  cervical_flex:    { en: 'neck, chin to chest',       ko: '목 · 턱 당기기' },
  cervical_bend:    { en: 'neck, ear to shoulder',     ko: '목 · 옆으로 기울임' },
  cervical_rot:     { en: 'neck, turning',             ko: '목 · 돌리기' },
  pelvis_tilt:      { en: 'whole body, tipping',       ko: '몸 전체 · 기울기' },
  pelvis_list:      { en: 'whole body, rolling',       ko: '몸 전체 · 좌우 회전' },
  pelvis_rotation:  { en: 'whole body, turning',       ko: '몸 전체 · 수평 회전' },
  arm_flex:         { en: 'shoulder, arm forward',     ko: '어깨 · 팔 앞으로' },
  arm_add:          { en: 'shoulder, arm to the side', ko: '어깨 · 팔 옆으로' },
  arm_rot:          { en: 'shoulder, arm turning',     ko: '어깨 · 팔 회전' },
  elbow_flex:       { en: 'elbow, bending',            ko: '팔꿈치 · 굽힘' },
  pro_sup:          { en: 'forearm, palm turning',     ko: '아래팔 · 손바닥 회전' },
  wrist_flex:       { en: 'wrist, bending',            ko: '손목 · 굽힘' },
  wrist_dev:        { en: 'wrist, side to side',       ko: '손목 · 좌우' },
};
const SIDE = { r: { en: 'right', ko: '오른쪽' }, l: { en: 'left', ko: '왼쪽' } };
/** A coordinate named for a reader: "right hip, thigh forward". */
export function coordLabel(key, lang = 'en') {
  const m = /^(.*)_(r|l)$/.exec(key);
  const base = m ? m[1] : key;
  const name = COORD_NAME[base]?.[lang] ?? base.replace(/_/g, ' ');
  if (!m) return name;
  const side = SIDE[m[2]]?.[lang] ?? m[2];
  return lang === 'ko' ? `${side} ${name}` : `${side} ${name}`;
}
const deg = o => Object.fromEntries(Object.entries(o).map(([k, v]) =>
  [k, (TRANSLATIONS.has(k) || WAVE.test(k)) ? v : v * D]));

/**
 * Lying on the back, and on one side. Rotation only — the figure turns about its own pelvis
 * and no attempt is made to drop it onto a mat. There is no floor in this scene, so an
 * absolute height would mean nothing; the camera frames whatever the pose produces.
 */
const SUPINE = { pelvis_tilt: 90 };
const SIDE_LYING = { pelvis_list: 90 };

export const BREATH = {
  in:   { en: 'Inhale', ko: '들숨', color: '#5EC8F2' },
  out:  { en: 'Exhale', ko: '날숨', color: '#E9A13B' },
  hold: { en: 'Hold / braced', ko: '숨 참기 · 브레이싱', color: '#8b95ab' },
};

export const MOTION = {
  hundred: {
    duration: 6000, loop: true,
    position: 'supine',
    provenance: 'handkeyed',
    limitation: null,
    phases: [
      { at: 0.00, breath: 'in',  en: 'Inhale, five beats', ko: '들숨, 다섯 박자' },
      { at: 0.50, breath: 'out', en: 'Exhale, five beats', ko: '날숨, 다섯 박자' },
    ],
    keys: [
      { t: 0.00, c: { ...SUPINE, lumbar_flex: 8, thoracic_flex: 20, cervical_flex: 26,
                      hip_flexion_r: 62, hip_flexion_l: 62, knee_angle_r: 8, knee_angle_l: 8,
                      arm_flex_r: 32, arm_flex_l: 32, arm_add_r: 6, arm_add_l: 6,
                      ankle_angle_r: -18, ankle_angle_l: -18 },
        act: { 'rectus abdominis': 0.72, 'external oblique': 0.62, 'transversus abdominis': 0.55,
               'sternocleidomastoid': 0.40, 'psoas major': 0.50, 'diaphragm': 0.75,
               'multifidus': 0.35, 'internal oblique': 0.45, 'serratus anterior': 0.30,
               'rectus femoris': 0.40 } },
      { t: 0.25, c: { ...SUPINE, lumbar_flex: 8, thoracic_flex: 22, cervical_flex: 28,
                      hip_flexion_r: 60, hip_flexion_l: 60, knee_angle_r: 6, knee_angle_l: 6,
                      arm_flex_r: 30, arm_flex_l: 30, arm_add_r: 6, arm_add_l: 6,
                      ankle_angle_r: -18, ankle_angle_l: -18 },
        act: { 'rectus abdominis': 0.78, 'external oblique': 0.66, 'transversus abdominis': 0.58,
               'sternocleidomastoid': 0.42, 'psoas major': 0.52, 'diaphragm': 0.85,
               'multifidus': 0.36, 'internal oblique': 0.48, 'serratus anterior': 0.32,
               'rectus femoris': 0.42 } },
      { t: 0.50, c: { ...SUPINE, lumbar_flex: 9, thoracic_flex: 24, cervical_flex: 30,
                      hip_flexion_r: 58, hip_flexion_l: 58, knee_angle_r: 5, knee_angle_l: 5,
                      arm_flex_r: 34, arm_flex_l: 34, arm_add_r: 6, arm_add_l: 6,
                      ankle_angle_r: -18, ankle_angle_l: -18 },
        act: { 'rectus abdominis': 0.85, 'external oblique': 0.78, 'transversus abdominis': 0.80,
               'sternocleidomastoid': 0.45, 'psoas major': 0.55, 'diaphragm': 0.55,
               'multifidus': 0.45, 'internal oblique': 0.70, 'serratus anterior': 0.35,
               'rectus femoris': 0.45 } },
      { t: 0.75, c: { ...SUPINE, lumbar_flex: 10, thoracic_flex: 25, cervical_flex: 31,
                      hip_flexion_r: 57, hip_flexion_l: 57, knee_angle_r: 5, knee_angle_l: 5,
                      arm_flex_r: 30, arm_flex_l: 30, arm_add_r: 6, arm_add_l: 6,
                      ankle_angle_r: -18, ankle_angle_l: -18 },
        act: { 'rectus abdominis': 0.90, 'external oblique': 0.82, 'transversus abdominis': 0.86,
               'sternocleidomastoid': 0.48, 'psoas major': 0.56, 'diaphragm': 0.40,
               'multifidus': 0.48, 'internal oblique': 0.75, 'serratus anterior': 0.36,
               'rectus femoris': 0.46 } },
      { t: 1.00, c: { ...SUPINE, lumbar_flex: 8, thoracic_flex: 20, cervical_flex: 26,
                      hip_flexion_r: 62, hip_flexion_l: 62, knee_angle_r: 8, knee_angle_l: 8,
                      arm_flex_r: 32, arm_flex_l: 32, arm_add_r: 6, arm_add_l: 6,
                      ankle_angle_r: -18, ankle_angle_l: -18 },
        act: { 'rectus abdominis': 0.72, 'external oblique': 0.62, 'transversus abdominis': 0.55,
               'sternocleidomastoid': 0.40, 'psoas major': 0.50, 'diaphragm': 0.75,
               'multifidus': 0.35, 'internal oblique': 0.45, 'serratus anterior': 0.30,
               'rectus femoris': 0.40 } },
    ],
  },

  rollup: {
    duration: 10000, loop: true, provenance: 'handkeyed',
    position: 'supine',
    limitation: {
      en: 'Sequential articulation is now modelled: the spine carries 24 joints and the lumbar and thoracic regions peel through a travelling front. What stays authored is the timing of that peel — the sweep rate is chosen to match how the exercise is taught, not measured from anyone performing it.',
      ko: '분절별 움직임이 이제 모델에 반영되어 있습니다. 척추는 24개 관절을 가지며 요추와 흉추가 이동하는 파형을 따라 순차적으로 말립니다. 다만 그 순서의 타이밍은 저작된 값입니다. 실제 수행자를 측정한 것이 아니라 지도 방식에 맞춰 정한 속도입니다.',
    },
    phases: [
      { at: 0.00, breath: 'in',  en: 'Inhale, reach the arms up', ko: '들숨, 팔을 위로' },
      { at: 0.15, breath: 'out', en: 'Exhale through the roll-up', ko: '날숨, 말아 올리기' },
      { at: 0.55, breath: 'in',  en: 'Inhale at the top', ko: '정점에서 들숨' },
      { at: 0.65, breath: 'out', en: 'Exhale to roll down', ko: '날숨, 말아 내리기' },
    ],
    keys: [
      { t: 0.00, c: { ...SUPINE, lumbar_flex: -4, thoracic_flex: -2, cervical_flex: 0,
                      lumbar_wave: 0, thoracic_wave: 0,
                      hip_flexion_r: 2, hip_flexion_l: 2,
                      arm_flex_r: 175, arm_flex_l: 175 },
        act: { 'rectus abdominis': 0.15, 'transversus abdominis': 0.30, 'psoas major': 0.15,
               'external oblique': 0.12, 'multifidus': 0.30, 'longissimus thoracis': 0.25 } },
      { t: 0.15, c: { ...SUPINE, lumbar_flex: 30, thoracic_flex: 30, cervical_flex: 30,
                      lumbar_wave: 0, thoracic_wave: 0.35,
                      hip_flexion_r: 4, hip_flexion_l: 4,
                      arm_flex_r: 155, arm_flex_l: 155 },
        act: { 'rectus abdominis': 0.55, 'transversus abdominis': 0.60, 'psoas major': 0.35,
               'external oblique': 0.45, 'multifidus': 0.30, 'internal oblique': 0.40 } },
      /* Long sitting: the seat is on the mat and the legs lie along it, so the hips have to
       * give back everything the pelvis takes. Written as `pelvis_tilt: -34, hip_flexion: 72`
       * this sat up correctly and pointed both legs forty-three centimetres down through the
       * floor. */
      { t: 0.55, pos: 'seated', c: { ...SUPINE, pelvis_tilt: 0,
                      lumbar_flex: 40, thoracic_flex: 34, cervical_flex: 38,
                      lumbar_wave: 1.1, thoracic_wave: 1.5,
                      hip_flexion_r: 88, hip_flexion_l: 88, arm_flex_r: 70, arm_flex_l: 70 },
        act: { 'rectus abdominis': 0.92, 'transversus abdominis': 0.80, 'psoas major': 0.80,
               'external oblique': 0.72, 'iliacus': 0.70, 'internal oblique': 0.62,
               'multifidus': 0.35, 'longissimus thoracis': 0.30 } },
      { t: 0.65, pos: 'seated', c: { ...SUPINE, pelvis_tilt: 2,
                      lumbar_flex: 42, thoracic_flex: 35, cervical_flex: 40,
                      lumbar_wave: 1.5, thoracic_wave: 1.6,
                      hip_flexion_r: 90, hip_flexion_l: 90, arm_flex_r: 74, arm_flex_l: 74 },
        act: { 'rectus abdominis': 0.88, 'transversus abdominis': 0.82, 'psoas major': 0.78,
               'external oblique': 0.70, 'iliacus': 0.68, 'internal oblique': 0.60,
               'multifidus': 0.38, 'longissimus thoracis': 0.32 } },
      { t: 1.00, c: { ...SUPINE, lumbar_flex: -4, thoracic_flex: -2, cervical_flex: 0,
                      lumbar_wave: 0, thoracic_wave: 0,
                      hip_flexion_r: 2, hip_flexion_l: 2,
                      arm_flex_r: 175, arm_flex_l: 175 },
        act: { 'rectus abdominis': 0.15, 'transversus abdominis': 0.30, 'psoas major': 0.15,
               'external oblique': 0.12, 'multifidus': 0.30, 'longissimus thoracis': 0.25 } },
    ],
  },

  shoulderbridge: {
    duration: 8000, loop: true, provenance: 'handkeyed',
    position: 'supine',
    limitation: {
      en: 'The pelvis lifts by translating rather than by rotating past the model’s limit, because this rig caps pelvic tilt at 90 degrees. The spinal peel itself is modelled — the wave runs tail to head, which is the direction the exercise is taught in.',
      ko: '이 리그는 골반 경사를 90도로 제한하므로, 골반은 한계를 넘어 회전하는 대신 이동으로 들어 올려집니다. 척추의 순차적 움직임 자체는 모델에 반영되어 있으며, 파형은 지도 방식과 같이 꼬리에서 머리 방향으로 진행합니다.',
    },
    phases: [
      { at: 0.00, breath: 'out', en: 'Exhale to lift', ko: '날숨, 들어 올리기' },
      { at: 0.40, breath: 'in',  en: 'Inhale at the top', ko: '정점에서 들숨' },
      { at: 0.55, breath: 'out', en: 'Exhale to lower', ko: '날숨, 내리기' },
    ],
    keys: [
      { t: 0.00, c: { ...SUPINE, lumbar_flex: 0, thoracic_flex: 0, lumbar_wave: -0.1,
                      hip_flexion_r: 46, hip_flexion_l: 46,
                      knee_angle_r: 84, knee_angle_l: 84, ankle_angle_r: 8, ankle_angle_l: 8 },
        act: { 'gluteus maximus': 0.20, 'biceps femoris': 0.20, 'semitendinosus': 0.20,
               'transversus abdominis': 0.35, 'multifidus': 0.30 } },
      { t: 0.40, c: { ...SUPINE, pelvis_ty: 1.06, lumbar_flex: -22, thoracic_flex: -10, lumbar_wave: -1.4,
                      hip_flexion_r: 8, hip_flexion_l: 8,
                      knee_angle_r: 74, knee_angle_l: 74, ankle_angle_r: 4, ankle_angle_l: 4 },
        act: { 'gluteus maximus': 0.90, 'biceps femoris': 0.72, 'semitendinosus': 0.70,
               'longissimus thoracis': 0.60, 'iliocostalis lumborum': 0.55,
               'multifidus': 0.65, 'transversus abdominis': 0.50, 'gluteus medius': 0.45 } },
      { t: 0.55, c: { ...SUPINE, pelvis_ty: 1.06, lumbar_flex: -22, thoracic_flex: -10, lumbar_wave: -1.4,
                      hip_flexion_r: 8, hip_flexion_l: 8,
                      knee_angle_r: 74, knee_angle_l: 74, ankle_angle_r: 4, ankle_angle_l: 4 },
        act: { 'gluteus maximus': 0.88, 'biceps femoris': 0.70, 'semitendinosus': 0.68,
               'longissimus thoracis': 0.58, 'iliocostalis lumborum': 0.54,
               'multifidus': 0.64, 'transversus abdominis': 0.52, 'gluteus medius': 0.44 } },
      { t: 1.00, c: { ...SUPINE, lumbar_flex: 0, thoracic_flex: 0, lumbar_wave: -0.1,
                      hip_flexion_r: 46, hip_flexion_l: 46,
                      knee_angle_r: 84, knee_angle_l: 84, ankle_angle_r: 8, ankle_angle_l: 8 },
        act: { 'gluteus maximus': 0.20, 'biceps femoris': 0.20, 'semitendinosus': 0.20,
               'transversus abdominis': 0.35, 'multifidus': 0.30 } },
    ],
  },

  sidekick: {
    duration: 5000, loop: true, provenance: 'handkeyed',
    position: 'sidelying',
    phases: [
      { at: 0.00, breath: 'out', en: 'Exhale as the leg swings forward', ko: '날숨, 다리 앞으로' },
      { at: 0.50, breath: 'in',  en: 'Inhale as it goes back', ko: '들숨, 다리 뒤로' },
    ],
    keys: [
      { t: 0.00, c: { ...SIDE_LYING, hip_flexion_l: 6, hip_adduction_l: -4, knee_angle_l: 4,
                      hip_flexion_r: 4, knee_angle_r: 4, arm_flex_r: -70, arm_flex_l: -20 },
        act: { 'gluteus medius': 0.70, 'quadratus lumborum': 0.55, 'external oblique': 0.50,
               'transversus abdominis': 0.50, 'internal oblique': 0.45 } },
      { t: 0.50, c: { ...SIDE_LYING, hip_flexion_l: 66, knee_angle_l: 8,
                      hip_flexion_r: 4, knee_angle_r: 4, arm_flex_r: -70, arm_flex_l: -20 },
        act: { 'gluteus medius': 0.62, 'psoas major': 0.72, 'rectus femoris': 0.55,
               'quadratus lumborum': 0.65, 'external oblique': 0.62,
               'transversus abdominis': 0.60, 'internal oblique': 0.55 } },
      { t: 1.00, c: { ...SIDE_LYING, hip_flexion_l: -22, knee_angle_l: 6,
                      hip_flexion_r: 4, knee_angle_r: 4, arm_flex_r: -70, arm_flex_l: -20 },
        act: { 'gluteus medius': 0.75, 'gluteus maximus': 0.68, 'quadratus lumborum': 0.60,
               'external oblique': 0.55, 'transversus abdominis': 0.58,
               'longissimus thoracis': 0.40 } },
    ],
  },

  footwork: {
    duration: 5000, loop: true, provenance: 'handkeyed',
    position: 'reformer',
    phases: [
      { at: 0.00, breath: 'in',  en: 'Inhale to push out', ko: '들숨, 밀어내기' },
      { at: 0.50, breath: 'out', en: 'Exhale to return', ko: '날숨, 돌아오기' },
    ],
    keys: [
      { t: 0.00, c: { ...SUPINE, hip_flexion_r: 96, hip_flexion_l: 96,
                      knee_angle_r: 112, knee_angle_l: 112, ankle_angle_r: 4, ankle_angle_l: 4,
                      arm_flex_r: -8, arm_flex_l: -8 },
        act: { 'rectus femoris': 0.35, 'gluteus maximus': 0.30, 'soleus': 0.30,
               'transversus abdominis': 0.40, 'multifidus': 0.35 } },
      { t: 0.50, c: { ...SUPINE, hip_flexion_r: 22, hip_flexion_l: 22,
                      knee_angle_r: 10, knee_angle_l: 10, ankle_angle_r: -6, ankle_angle_l: -6,
                      arm_flex_r: -8, arm_flex_l: -8 },
        act: { 'rectus femoris': 0.85, 'vastus lateralis': 0.80, 'gluteus maximus': 0.78,
               'gastrocnemius': 0.55, 'soleus': 0.60, 'biceps femoris': 0.35,
               'transversus abdominis': 0.45, 'multifidus': 0.40, 'gluteus medius': 0.40 } },
      { t: 1.00, c: { ...SUPINE, hip_flexion_r: 96, hip_flexion_l: 96,
                      knee_angle_r: 112, knee_angle_l: 112, ankle_angle_r: 4, ankle_angle_l: 4,
                      arm_flex_r: -8, arm_flex_l: -8 },
        act: { 'rectus femoris': 0.35, 'gluteus maximus': 0.30, 'soleus': 0.30,
               'transversus abdominis': 0.40, 'multifidus': 0.35 } },
    ],
  },

  backsquat: {
    duration: 5000, loop: true, provenance: 'handkeyed',
    position: 'standing',
    phases: [
      { at: 0.00, breath: 'hold', en: 'Braced through the descent', ko: '하강 내내 브레이싱' },
      { at: 0.50, breath: 'out',  en: 'Exhale past the hard point', ko: '가장 힘든 지점에서 날숨' },
    ],
    keys: [
      { t: 0.00, c: { lumbar_flex: -6, thoracic_flex: -4, hip_flexion_r: 2, hip_flexion_l: 2,
                      knee_angle_r: 4, knee_angle_l: 4, ankle_angle_r: 2, ankle_angle_l: 2,
                      arm_flex_r: -30, arm_flex_l: -30, arm_add_r: -70, arm_add_l: -70,
                      elbow_flex_r: 100, elbow_flex_l: 100 },
        act: { 'rectus femoris': 0.25, 'gluteus maximus': 0.20, 'longissimus thoracis': 0.40,
               'transversus abdominis': 0.45, 'multifidus': 0.45 } },
      { t: 0.50, pos: 'squat', c: { lumbar_flex: -2, thoracic_flex: -2, pelvis_tilt: -26, hip_flexion_r: 118, hip_flexion_l: 118,
                      knee_angle_r: 130, knee_angle_l: 130,
                      ankle_angle_r: -26, ankle_angle_l: -26,
                      hip_adduction_r: -8, hip_adduction_l: -8,
                      arm_flex_r: -30, arm_flex_l: -30, arm_add_r: -70, arm_add_l: -70,
                      elbow_flex_r: 100, elbow_flex_l: 100 },
        act: { 'rectus femoris': 0.92, 'vastus lateralis': 0.90, 'gluteus maximus': 0.88,
               'biceps femoris': 0.55, 'semitendinosus': 0.52, 'soleus': 0.60,
               'longissimus thoracis': 0.80, 'iliocostalis lumborum': 0.78,
               'multifidus': 0.75, 'transversus abdominis': 0.60, 'gluteus medius': 0.65 } },
      { t: 1.00, c: { lumbar_flex: -6, thoracic_flex: -4, hip_flexion_r: 2, hip_flexion_l: 2,
                      knee_angle_r: 4, knee_angle_l: 4, ankle_angle_r: 2, ankle_angle_l: 2,
                      arm_flex_r: -30, arm_flex_l: -30, arm_add_r: -70, arm_add_l: -70,
                      elbow_flex_r: 100, elbow_flex_l: 100 },
        act: { 'rectus femoris': 0.25, 'gluteus maximus': 0.20, 'longissimus thoracis': 0.40,
               'transversus abdominis': 0.45, 'multifidus': 0.45 } },
    ],
  },

  deadlift: {
    duration: 5000, loop: true, provenance: 'handkeyed',
    position: 'standingFold',
    phases: [
      { at: 0.00, breath: 'hold', en: 'Braced at the floor', ko: '바닥에서 브레이싱' },
      { at: 0.60, breath: 'out',  en: 'Exhale at lockout', ko: '정점에서 날숨' },
    ],
    keys: [
      { t: 0.00, c: { pelvis_tilt: -50, lumbar_flex: -10, thoracic_flex: -6,
                      hip_flexion_r: 96, hip_flexion_l: 96,
                      knee_angle_r: 62, knee_angle_l: 62,
                      ankle_angle_r: -12, ankle_angle_l: -12,
                      arm_flex_r: 30, arm_flex_l: 30 },
        act: { 'gluteus maximus': 0.90, 'biceps femoris': 0.88, 'semitendinosus': 0.85,
               'longissimus thoracis': 0.92, 'iliocostalis lumborum': 0.90,
               'multifidus': 0.85, 'transversus abdominis': 0.70, 'rectus femoris': 0.65,
               'latissimus dorsi': 0.60, 'trapezius': 0.55, 'quadratus lumborum': 0.62 } },
      { t: 0.60, pos: 'standing', c: { lumbar_flex: -4, thoracic_flex: -3, hip_flexion_r: 2, hip_flexion_l: 2,
                      knee_angle_r: 4, knee_angle_l: 4, ankle_angle_r: 0, ankle_angle_l: 0,
                      arm_flex_r: 4, arm_flex_l: 4 },
        act: { 'gluteus maximus': 0.55, 'biceps femoris': 0.40, 'semitendinosus': 0.38,
               'longissimus thoracis': 0.55, 'iliocostalis lumborum': 0.52,
               'multifidus': 0.50, 'transversus abdominis': 0.50, 'trapezius': 0.60,
               'latissimus dorsi': 0.45 } },
      { t: 1.00, c: { pelvis_tilt: -50, lumbar_flex: -10, thoracic_flex: -6,
                      hip_flexion_r: 96, hip_flexion_l: 96,
                      knee_angle_r: 62, knee_angle_l: 62,
                      ankle_angle_r: -12, ankle_angle_l: -12,
                      arm_flex_r: 30, arm_flex_l: 30 },
        act: { 'gluteus maximus': 0.90, 'biceps femoris': 0.88, 'semitendinosus': 0.85,
               'longissimus thoracis': 0.92, 'iliocostalis lumborum': 0.90,
               'multifidus': 0.85, 'transversus abdominis': 0.70, 'rectus femoris': 0.65,
               'latissimus dorsi': 0.60, 'trapezius': 0.55, 'quadratus lumborum': 0.62 } },
    ],
  },

  thruster: {
    duration: 4000, loop: true, provenance: 'handkeyed',
    position: 'standing',
    phases: [
      { at: 0.00, breath: 'hold', en: 'Braced in the front rack', ko: '프론트 랙에서 브레이싱' },
      { at: 0.55, breath: 'out',  en: 'Exhale through the press', ko: '프레스 구간에서 날숨' },
    ],
    keys: [
      { t: 0.00, c: { lumbar_flex: -6, thoracic_flex: -4, hip_flexion_r: 4, hip_flexion_l: 4,
                      knee_angle_r: 6, knee_angle_l: 6,
                      arm_flex_r: -70, arm_flex_l: -70, elbow_flex_r: 140, elbow_flex_l: 140 },
        act: { 'rectus femoris': 0.30, 'gluteus maximus': 0.25, 'deltoid': 0.35,
               'trapezius': 0.40, 'transversus abdominis': 0.45 } },
      { t: 0.30, pos: 'squat', c: { lumbar_flex: -2, thoracic_flex: -2, pelvis_tilt: -18, hip_flexion_r: 112, hip_flexion_l: 112,
                      knee_angle_r: 112, knee_angle_l: 112,
                      ankle_angle_r: -28, ankle_angle_l: -28,
                      arm_flex_r: -70, arm_flex_l: -70, elbow_flex_r: 140, elbow_flex_l: 140 },
        act: { 'rectus femoris': 0.95, 'vastus lateralis': 0.92, 'gluteus maximus': 0.90,
               'longissimus thoracis': 0.78, 'multifidus': 0.72, 'deltoid': 0.45,
               'trapezius': 0.55, 'transversus abdominis': 0.62, 'soleus': 0.55,
               'serratus anterior': 0.40, 'infraspinatus muscle': 0.35 } },
      { t: 0.55, c: { lumbar_flex: -6, thoracic_flex: -4, hip_flexion_r: 2, hip_flexion_l: 2,
                      knee_angle_r: 4, knee_angle_l: 4,
                      arm_flex_r: 20, arm_flex_l: 20, elbow_flex_r: 60, elbow_flex_l: 60 },
        act: { 'rectus femoris': 0.55, 'gluteus maximus': 0.60, 'deltoid': 0.85,
               'trapezius': 0.80, 'pectoralis major': 0.50, 'serratus anterior': 0.70,
               'infraspinatus muscle': 0.50, 'transversus abdominis': 0.55 } },
      { t: 0.72, c: { lumbar_flex: -4, thoracic_flex: -3, arm_flex_r: 78, arm_flex_l: 78,
                      elbow_flex_r: 6, elbow_flex_l: 6,
                      hip_flexion_r: 0, hip_flexion_l: 0, knee_angle_r: 2, knee_angle_l: 2 },
        act: { 'deltoid': 0.92, 'trapezius': 0.88, 'serratus anterior': 0.82,
               'triceps brachii': 0.80, 'infraspinatus muscle': 0.55,
               'transversus abdominis': 0.60, 'longissimus thoracis': 0.55 } },
      { t: 1.00, c: { lumbar_flex: -6, thoracic_flex: -4, hip_flexion_r: 4, hip_flexion_l: 4,
                      knee_angle_r: 6, knee_angle_l: 6,
                      arm_flex_r: -70, arm_flex_l: -70, elbow_flex_r: 140, elbow_flex_l: 140 },
        act: { 'rectus femoris': 0.30, 'gluteus maximus': 0.25, 'deltoid': 0.35,
               'trapezius': 0.40, 'transversus abdominis': 0.45 } },
    ],
  },

  singleleg: {
    duration: 6000, loop: true, provenance: 'handkeyed',
    position: 'standing',
    phases: [
      { at: 0.00, breath: 'in',  en: 'Breathe normally throughout', ko: '평소처럼 호흡' },
    ],
    keys: [
      { t: 0.00, c: { hip_flexion_l: 26, knee_angle_l: 66, ankle_angle_l: -8,
                      hip_flexion_r: 2, knee_angle_r: 3, pelvis_list: -2,
                      arm_add_r: -22, arm_add_l: -22 },
        act: { 'gluteus medius': 0.70, 'soleus': 0.60, 'gastrocnemius': 0.40,
               'quadratus lumborum': 0.45, 'multifidus': 0.50, 'transversus abdominis': 0.45 } },
      { t: 0.35, c: { hip_flexion_l: 28, knee_angle_l: 68, ankle_angle_l: -8,
                      hip_flexion_r: 4, knee_angle_r: 5, pelvis_list: -5,
                      arm_add_r: -26, arm_add_l: -18 },
        act: { 'gluteus medius': 0.85, 'soleus': 0.72, 'gastrocnemius': 0.48,
               'quadratus lumborum': 0.60, 'multifidus': 0.58, 'transversus abdominis': 0.52,
               'gluteus maximus': 0.40 } },
      { t: 0.70, c: { hip_flexion_l: 25, knee_angle_l: 65, ankle_angle_l: -6,
                      hip_flexion_r: 1, knee_angle_r: 2, pelvis_list: 1,
                      arm_add_r: -18, arm_add_l: -26 },
        act: { 'gluteus medius': 0.62, 'soleus': 0.55, 'gastrocnemius': 0.35,
               'quadratus lumborum': 0.40, 'multifidus': 0.46, 'transversus abdominis': 0.42,
               'gluteus maximus': 0.32 } },
      { t: 1.00, c: { hip_flexion_l: 26, knee_angle_l: 66, ankle_angle_l: -8,
                      hip_flexion_r: 2, knee_angle_r: 3, pelvis_list: -2,
                      arm_add_r: -22, arm_add_l: -22 },
        act: { 'gluteus medius': 0.70, 'soleus': 0.60, 'gastrocnemius': 0.40,
               'quadratus lumborum': 0.45, 'multifidus': 0.50, 'transversus abdominis': 0.45 } },
    ],
  },
};

// convert every key's coordinates from degrees to radians once, at module load
for (const m of Object.values(MOTION)) for (const k of m.keys) k.c = deg(k.c);

/**
 * The composed clips. `library/compose.js` builds one from the same `pose` a record already
 * states, so the animation and the anatomical claim ("this exercise puts the hip in 90
 * degrees of flexion") are literally the same numbers. There is no second, separately
 * authored version of the movement that could drift away from the text — which is the whole
 * reason the library is records rather than prose.
 *
 * Composed clips arrive already in radians; the loop above has run by then and does not
 * touch them.
 */
import { COMPOSED_MOTION } from './exercises.js';
for (const [key, clip] of Object.entries(COMPOSED_MOTION)) MOTION[key] ??= clip;

export const MOTION_KEYS = Object.keys(MOTION);

/** Coordinates and activation at normalised time t, linearly interpolated between keys. */
export function sample(key, t) {
  const m = MOTION[key];
  if (!m) return null;
  const keys = m.keys;
  t = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const span = Math.max(1e-6, b.t - a.t);
  const u = Math.max(0, Math.min(1, (t - a.t) / span));
  const c = {};
  for (const k of new Set([...Object.keys(a.c), ...Object.keys(b.c)]))
    c[k] = (a.c[k] ?? 0) * (1 - u) + (b.c[k] ?? 0) * u;
  const act = {};
  for (const k of new Set([...Object.keys(a.act ?? {}), ...Object.keys(b.act ?? {})]))
    act[k] = (a.act?.[k] ?? 0) * (1 - u) + (b.act?.[k] ?? 0) * u;
  return { coordinates: c, activation: act };
}

/** The breath phase covering normalised time t. */
export function phaseAt(key, t) {
  const ph = MOTION[key]?.phases ?? [];
  let cur = ph[0] ?? null;
  for (const p of ph) if (p.at <= t) cur = p;
  return cur;
}
