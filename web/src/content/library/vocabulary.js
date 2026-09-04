/**
 * The shared vocabulary the exercise library is written in.
 *
 * Three hundred exercises cannot be three hundred hand-written essays and stay consistent,
 * accurate or bilingual. So the *data* is per-exercise — which joints move, through what
 * range, which muscles in which role, which contraindications apply, what the breath does —
 * and the prose is composed from that data through this vocabulary.
 *
 * That is not a shortcut around the content: it is the content, in a form that can be
 * checked. A fault that belongs to trunk flexion appears on every exercise that flexes the
 * trunk and nowhere else, a contraindication class means the same thing everywhere it is
 * used, and `test/content.test.mjs` can verify all of it. Hand-written prose of variable
 * quality across three hundred entries could not be checked at all.
 *
 * Everything here is en + ko.
 */

/* ------------------------------------------------------------------ positions */
export const POSITION = {
  supine:      { en: 'lying on your back', ko: '바로 누운 자세' },
  prone:       { en: 'lying face down', ko: '엎드린 자세' },
  sidelying:   { en: 'lying on one side', ko: '옆으로 누운 자세' },
  seated:      { en: 'sitting', ko: '앉은 자세' },
  standing:    { en: 'standing', ko: '선 자세' },
  kneeling:    { en: 'kneeling', ko: '무릎 선 자세' },
  kneelingFold:{ en: 'kneeling, folded forward over the thighs',
                 ko: '무릎을 꿇고 허벅지 위로 접은 자세' },
  quadruped:   { en: 'on hands and knees', ko: '네발 자세' },
  plank:       { en: 'face down, supported on the hands or forearms', ko: '엎드려 손 또는 전완으로 지지한 자세' },
  plankSupine: { en: 'face up, supported on the hands and heels', ko: '위를 보고 손과 발뒤꿈치로 지지한 자세' },
  pike:        { en: 'hands and feet on the floor with the hips highest', ko: '손과 발을 딛고 골반을 가장 높이 든 자세' },
  armBalance:  { en: 'balanced on the hands, with nothing else on the floor', ko: '손으로만 균형을 잡고 다른 곳은 바닥에 닿지 않는 자세' },
  inverted:    { en: 'inverted, with the hips above the head', ko: '골반이 머리보다 높은 역자세' },
  reformer:    { en: 'on the reformer carriage', ko: '리포머 캐리지 위' },
  chairSeated: { en: 'seated on the apparatus', ko: '기구에 앉은 자세' },
  lunge:       { en: 'in a lunge, one foot forward', ko: '한 발을 앞으로 낸 런지 자세' },
  lowLunge:    { en: 'in a low lunge, chest down over the front leg', ko: '가슴을 앞다리 위로 낮춘 낮은 런지 자세' },
  squat:       { en: 'squatting, feet on the floor and hips low', ko: '발을 딛고 골반을 낮춘 스쿼트 자세' },
  balance:     { en: 'balanced on one foot', ko: '한 발로 균형 잡은 자세' },
  crossLegged: { en: 'sitting cross-legged', ko: '책상다리로 앉은 자세' },
  standingFold:{ en: 'standing, folded over the legs', ko: '선 채로 다리 위로 접은 자세' },
  supported:   { en: 'supported on props, with nothing to hold', ko: '도구에 몸을 맡기고 힘을 쓰지 않는 자세' },
};

/* ------------------------------------------------------------------- contacts
 * What carries the weight.
 *
 * Every position class has a default set — a lunge stands on two feet, a quadruped on two
 * hands and two knees — and those defaults are what the geometry tests hold every pose to:
 * the named contacts have to sit on ONE floor. Without that rule a pose passes with its
 * front foot fifteen centimetres in the air, which is how Warrior II came to be drawn as a
 * sagittal lunge with a floating foot: every angle legal, the class correct, the shape
 * wrong.
 *
 * A record overrides the default with its own `contacts` where the exercise is genuinely
 * asymmetric — a side plank is one hand and one foot, a bird dog is one hand and the
 * opposite knee. Writing it down is the point: it says which parts of this shape are load
 * bearing, which is a claim about the exercise and belongs in the record next to the rest.
 */
export const CONTACT = {
  foot_r: { en: 'the right foot', ko: '오른발' },
  foot_l: { en: 'the left foot', ko: '왼발' },
  knee_r: { en: 'the right knee', ko: '오른쪽 무릎' },
  knee_l: { en: 'the left knee', ko: '왼쪽 무릎' },
  hand_r: { en: 'the right hand', ko: '오른손' },
  hand_l: { en: 'the left hand', ko: '왼손' },
  forearm_r: { en: 'the right forearm', ko: '오른쪽 전완' },
  forearm_l: { en: 'the left forearm', ko: '왼쪽 전완' },
  head:      { en: 'the head', ko: '머리' },
};

/** What a position class stands on when the record does not say otherwise. */
export const DEFAULT_CONTACTS = {
  standing:     ['foot_r', 'foot_l'],
  standingFold: ['foot_r', 'foot_l'],
  lunge:        ['foot_r', 'foot_l'],
  lowLunge:     ['foot_r', 'foot_l', 'hand_r', 'hand_l'],
  squat:        ['foot_r', 'foot_l'],
  kneeling:     ['knee_r', 'knee_l'],
  // a kneeling fold sits back on the heels, so the tops of the feet carry weight too,
  // and the arms reach forward onto the mat
  kneelingFold: ['knee_r', 'knee_l', 'foot_r', 'foot_l', 'hand_r', 'hand_l'],
  quadruped:    ['knee_r', 'knee_l', 'hand_r', 'hand_l'],
  plank:        ['foot_r', 'foot_l', 'hand_r', 'hand_l'],
  plankSupine:  ['foot_r', 'foot_l', 'hand_r', 'hand_l'],
  pike:         ['foot_r', 'foot_l', 'hand_r', 'hand_l'],
  armBalance:   ['hand_r', 'hand_l'],
};

/* ------------------------------------------------------------------- actions
 * The joint actions an exercise performs. These drive the cues, the faults, the muscle
 * sanity checks and the plain-language summary. */
export const ACTION = {
  'trunk-flexion':      { en: 'trunk flexion', ko: '체간 굴곡',
                          plain: { en: 'curling the spine forward', ko: '척추를 앞으로 말기' } },
  'trunk-extension':    { en: 'trunk extension', ko: '체간 신전',
                          plain: { en: 'arching the spine back', ko: '척추를 뒤로 젖히기' } },
  'trunk-rotation':     { en: 'trunk rotation', ko: '체간 회전',
                          plain: { en: 'turning the ribcage', ko: '흉곽을 돌리기' } },
  'trunk-lateral':      { en: 'lateral trunk flexion', ko: '체간 측굴',
                          plain: { en: 'bending sideways', ko: '옆으로 굽히기' } },
  'segmental-articulation': { en: 'sequential spinal articulation', ko: '분절별 척추 움직임',
                          plain: { en: 'moving the spine one vertebra at a time', ko: '척추를 한 마디씩 움직이기' } },
  'hip-flexion':        { en: 'hip flexion', ko: '고관절 굴곡',
                          plain: { en: 'drawing the thigh toward the body', ko: '허벅지를 몸 쪽으로' } },
  'hip-extension':      { en: 'hip extension', ko: '고관절 신전',
                          plain: { en: 'driving the thigh behind you', ko: '허벅지를 뒤로 보내기' } },
  'hip-abduction':      { en: 'hip abduction', ko: '고관절 외전',
                          plain: { en: 'taking the leg out to the side', ko: '다리를 옆으로 벌리기' } },
  'hip-adduction':      { en: 'hip adduction', ko: '고관절 내전',
                          plain: { en: 'drawing the legs together', ko: '다리를 모으기' } },
  'hip-rotation':       { en: 'hip rotation', ko: '고관절 회전',
                          plain: { en: 'turning the thigh in its socket', ko: '허벅지를 관절 안에서 돌리기' } },
  'knee-extension':     { en: 'knee extension', ko: '슬관절 신전',
                          plain: { en: 'straightening the knee', ko: '무릎 펴기' } },
  'knee-flexion':       { en: 'knee flexion', ko: '슬관절 굴곡',
                          plain: { en: 'bending the knee', ko: '무릎 굽히기' } },
  'ankle-plantarflexion': { en: 'ankle plantarflexion', ko: '발목 족저굴곡',
                          plain: { en: 'pointing the foot', ko: '발끝을 밀어내기' } },
  'ankle-dorsiflexion': { en: 'ankle dorsiflexion', ko: '발목 배측굴곡',
                          plain: { en: 'flexing the foot', ko: '발끝을 당기기' } },
  'shoulder-flexion':   { en: 'shoulder flexion', ko: '어깨 굴곡',
                          plain: { en: 'lifting the arm forward and up', ko: '팔을 앞위로 올리기' } },
  'shoulder-extension': { en: 'shoulder extension', ko: '어깨 신전',
                          plain: { en: 'taking the arm behind you', ko: '팔을 뒤로 보내기' } },
  'shoulder-abduction': { en: 'shoulder abduction', ko: '어깨 외전',
                          plain: { en: 'lifting the arm out to the side', ko: '팔을 옆으로 올리기' } },
  'shoulder-adduction': { en: 'shoulder adduction', ko: '어깨 내전',
                          plain: { en: 'drawing the arm across the body', ko: '팔을 몸 앞으로 모으기' } },
  'scapular-stability': { en: 'scapular stabilisation', ko: '견갑골 안정화',
                          plain: { en: 'holding the shoulder blade steady', ko: '견갑골을 안정시키기' } },
  'elbow-flexion':      { en: 'elbow flexion', ko: '팔꿈치 굴곡',
                          plain: { en: 'bending the elbow', ko: '팔꿈치 굽히기' } },
  'elbow-extension':    { en: 'elbow extension', ko: '팔꿈치 신전',
                          plain: { en: 'straightening the elbow', ko: '팔꿈치 펴기' } },
  'balance':            { en: 'single-point balance', ko: '단일 지지 균형',
                          plain: { en: 'holding your balance on a small base', ko: '좁은 지지면에서 균형 잡기' } },
  'isometric-hold':     { en: 'isometric hold', ko: '등척성 유지',
                          plain: { en: 'holding still under load', ko: '부하를 받으며 정지 유지' } },
  'weight-bearing-arms':{ en: 'upper-limb weight bearing', ko: '상지 체중지지',
                          plain: { en: 'carrying your weight through the arms', ko: '팔로 체중을 지지하기' } },
  'inversion':          { en: 'inversion', ko: '역자세',
                          plain: { en: 'putting the hips above the heart', ko: '골반을 심장보다 높이기' } },
  'breath-focus':       { en: 'directed breathing', ko: '호흡 조절',
                          plain: { en: 'working the breath deliberately', ko: '호흡을 의도적으로 다루기' } },
  'forward-fold':       { en: 'hip flexion with a long spine', ko: '척추를 길게 유지한 고관절 굴곡',
                          plain: { en: 'folding forward from the hips rather than the waist', ko: '허리가 아니라 고관절에서 접기' } },
  'lateral-reach':      { en: 'lateral reach through one side', ko: '한쪽 옆면 신장',
                          plain: { en: 'reaching long through one side of the body', ko: '몸 한쪽을 길게 뻗기' } },
  'chest-expansion':    { en: 'anterior chest expansion', ko: '흉곽 전면 확장',
                          plain: { en: 'opening the front of the chest', ko: '가슴 앞면 열기' } },
  'hip-external-rotation': { en: 'hip external rotation', ko: '고관절 외회전',
                          plain: { en: 'turning the thigh outward in its socket', ko: '허벅지를 관절 안에서 바깥으로 돌리기' } },
  'shoulder-external-rotation': { en: 'shoulder external rotation', ko: '어깨 외회전',
                          plain: { en: 'turning the upper arm outward', ko: '위팔을 바깥으로 돌리기' } },
  'ankle-stability':    { en: 'ankle and foot stabilisation', ko: '발목·발 안정화',
                          plain: { en: 'holding the foot steady under load', ko: '부하 아래에서 발을 안정시키기' } },
};

/* ------------------------------------------------------------------- breath */
export const BREATH_PATTERN = {
  'lateral-costal': {
    en: { name: 'Lateral costal breathing',
          how: 'Inhale wide into the sides and back of the ribcage without letting the ribs flare forward, and exhale fully as the effort happens. The exhale is the working half — the ribs draw down and the deep abdominals engage on the way out.' },
    ko: { name: '측방 흉곽 호흡',
          how: '갈비뼈가 앞으로 벌어지지 않게 하면서 흉곽의 옆과 뒤로 넓게 들이쉬고, 힘을 쓰는 구간에서 충분히 내쉽니다. 내쉬는 쪽이 일하는 구간으로, 갈비뼈가 내려가고 심부 복부가 작동합니다.' } },
  'exhale-effort': {
    en: { name: 'Exhale on the effort',
          how: 'Exhale through the hardest part of the movement and inhale on the return. Nothing here is held: if the breath stops, the load has exceeded what you are controlling.' },
    ko: { name: '힘쓸 때 내쉬기',
          how: '가장 힘든 구간에서 내쉬고 돌아올 때 들이쉽니다. 숨을 참지 않습니다. 호흡이 멈춘다면 부하가 조절 범위를 넘은 것입니다.' } },
  'ujjayi': {
    en: { name: 'Ujjayi breath',
          how: 'Breathe in and out through the nose with a slight constriction at the back of the throat, so the breath is audible and even. The sound is the metronome: when it becomes ragged, the pose is past what you can hold.' },
    ko: { name: '우짜이 호흡',
          how: '목 뒤쪽을 살짝 좁혀 코로 들이쉬고 내쉬며, 호흡이 들릴 만큼 고르게 유지합니다. 그 소리가 메트로놈입니다. 소리가 거칠어지면 유지할 수 있는 범위를 넘은 것입니다.' } },
  'natural': {
    en: { name: 'Normal breathing',
          how: 'Breathe normally and continuously throughout. Holding the breath is a strategy for masking instability, so it is also a useful signal that the position is too hard.' },
    ko: { name: '평상 호흡',
          how: '처음부터 끝까지 평소처럼 계속 호흡합니다. 숨을 참는 것은 불안정을 감추는 전략이며, 그래서 자세가 너무 어렵다는 유용한 신호이기도 합니다.' } },
  'braced': {
    en: { name: 'Braced',
          how: 'Take a breath at the start of the repetition and hold it through the loaded portion, exhaling past the hardest point. This is a bracing pattern for load, not a Pilates or yoga breath.' },
    ko: { name: '브레이싱',
          how: '반복 시작에서 숨을 들이쉬고 부하 구간 동안 참았다가 가장 힘든 지점을 지나며 내쉽니다. 필라테스나 요가 호흡이 아니라 부하를 위한 브레이싱 패턴입니다.' } },
};

/* ---------------------------------------------------------- contraindications
 * Classes rather than free text, so the same caution reads the same everywhere and a new
 * exercise cannot quietly invent a softer version of an existing warning. */
export const CONTRA = {
  neck: {
    en: 'Sustained neck flexion with the head unsupported. Not for acute neck pain or cervical disc symptoms; support the head or keep it down instead.',
    ko: '머리를 받치지 않은 상태의 지속적인 경부 굴곡이 포함됩니다. 급성 경부 통증이나 경추 디스크 증상이 있으면 피하고, 머리를 받치거나 내려 두십시오.' },
  'lumbar-flexion': {
    en: 'Loaded lumbar flexion. Avoid with acute low back pain, disc-related symptoms, osteoporosis or known vertebral fragility.',
    ko: '부하가 실린 요추 굴곡이 포함됩니다. 급성 요통, 디스크 관련 증상, 골다공증, 척추 취약성이 있으면 피하십시오.' },
  'lumbar-extension': {
    en: 'End-range lumbar extension. Reduce range with spondylolisthesis, facet-related pain or spinal stenosis.',
    ko: '요추 신전의 최대 범위가 포함됩니다. 척추전방전위증, 후관절성 통증, 척추관 협착증이 있으면 범위를 줄이십시오.' },
  pregnancy: {
    en: 'Not appropriate during pregnancy past the first trimester — supine trunk flexion and prone positions both apply.',
    ko: '임신 1분기 이후에는 적합하지 않습니다. 바로 누운 체간 굴곡과 엎드린 자세 모두 해당됩니다.' },
  wrist: {
    en: 'Loaded wrist extension. Modify onto the forearms or fists with wrist pain or carpal tunnel symptoms.',
    ko: '부하가 실린 손목 신전이 포함됩니다. 손목 통증이나 손목터널증후군 증상이 있으면 전완이나 주먹 지지로 변경하십시오.' },
  shoulder: {
    en: 'Requires full overhead or weight-bearing shoulder range. Not appropriate with impingement, instability or a recent rotator cuff injury.',
    ko: '머리 위 또는 체중지지를 위한 완전한 어깨 가동범위가 필요합니다. 충돌증후군, 불안정성, 최근 회전근개 손상이 있으면 적합하지 않습니다.' },
  knee: {
    en: 'Deep knee flexion under load. Reduce range with meniscal symptoms, patellofemoral pain or after knee surgery.',
    ko: '부하 상태의 깊은 무릎 굴곡이 포함됩니다. 반월판 증상, 슬개대퇴 통증, 무릎 수술 후에는 범위를 줄이십시오.' },
  hip: {
    en: 'End-range hip flexion or rotation. Reduce range with femoroacetabular impingement or labral symptoms.',
    ko: '고관절 굴곡·회전의 최대 범위가 포함됩니다. 대퇴비구 충돌이나 관절와순 증상이 있으면 범위를 줄이십시오.' },
  inversion: {
    en: 'Inverted position. Not appropriate with uncontrolled hypertension, glaucoma or retinal disease, recent eye or ear surgery, or during menstruation if that is your teacher’s guidance.',
    ko: '역자세입니다. 조절되지 않는 고혈압, 녹내장이나 망막 질환, 최근 안과·이과 수술 후에는 적합하지 않으며, 생리 중 회피는 지도자의 지침을 따르십시오.' },
  balance: {
    en: 'Stand within reach of a wall or rail with any history of falls, vestibular disorder or peripheral neuropathy. The challenge is the point and so is the risk.',
    ko: '낙상 병력, 전정 질환, 말초신경병증이 있으면 벽이나 난간이 닿는 곳에서 수행하십시오. 도전이 목적인 만큼 위험도 같은 곳에서 나옵니다.' },
  'sacroiliac': {
    en: 'Asymmetric loading through the pelvis. Reduce range with sacroiliac pain or pubic symphysis symptoms.',
    ko: '골반에 비대칭 부하가 실립니다. 천장관절 통증이나 치골결합 증상이 있으면 범위를 줄이십시오.' },
  hamstring: {
    en: 'End-range hamstring lengthening. Back off with an acute or healing hamstring strain — a lengthened muscle under load is how they tear.',
    ko: '햄스트링을 최대로 늘립니다. 급성 또는 회복 중인 햄스트링 좌상이 있으면 강도를 낮추십시오. 늘어난 상태에서 부하를 받을 때 파열이 일어납니다.' },
  ankle: {
    en: 'Loaded ankle range at end position. Reduce depth with a recent sprain, ankle instability or restricted dorsiflexion — the restriction tends to reappear at the knee.',
    ko: '최대 범위에서 발목에 부하가 실립니다. 최근 염좌, 발목 불안정성, 배측굴곡 제한이 있으면 깊이를 줄이십시오. 제한은 대개 무릎에서 다시 나타납니다.' },
  'flexion-rotation': {
    en: 'Combines spinal flexion with rotation under load, which is the position most associated with disc injury. Take the rotation from the thoracic spine with the lumbar spine neutral, or leave this one out.',
    ko: '부하 상태에서 척추 굴곡과 회전이 결합되며, 디스크 손상과 가장 관련이 큰 자세입니다. 요추는 중립으로 두고 흉추에서 회전을 만들거나, 이 동작을 생략하십시오.' },
  'blood-pressure': {
    en: 'Raises intrathoracic pressure. Take care with uncontrolled hypertension or cardiovascular disease, and do not hold the breath.',
    ko: '흉강내압을 높입니다. 조절되지 않는 고혈압이나 심혈관 질환이 있으면 주의하고 숨을 참지 마십시오.' },
};

/* ------------------------------------------------------------------- faults
 * Keyed by the action that produces them, so an exercise inherits the faults its own joint
 * actions can actually generate rather than a generic list. */
export const FAULT = {
  'neck-lead': {
    action: 'trunk-flexion',
    en: ['Chin poking forward and the neck burning',
         'The sternocleidomastoid has taken over from the deep neck flexors. Support the head in one hand for a few breaths — if the burn goes and the position holds, it was control, not strength.'],
    ko: ['턱이 앞으로 나오고 목이 타는 느낌',
         '흉쇄유돌근이 심부 경부 굴곡근을 대신하고 있습니다. 몇 호흡 동안 한 손으로 머리를 받쳐 보세요. 타는 느낌이 사라지고 자세가 유지되면 근력이 아니라 조절의 문제입니다.'] },
  'doming': {
    action: 'trunk-flexion',
    en: ['The belly doming into a ridge',
         'Load has exceeded what the deep layer is managing. Reduce the lever — bend the knees, lower the legs, or shorten the range.'],
    ko: ['배가 산처럼 솟음',
         '부하가 심부층의 조절 범위를 넘었습니다. 지렛대를 줄이세요. 무릎을 굽히거나 다리를 낮추거나 범위를 줄입니다.'] },
  'block-flexion': {
    action: 'segmental-articulation',
    en: ['Coming up or going down in one rigid piece',
         'The spine is moving as a block because the segmental control is not there yet. Slow down and reduce the range until each part of the spine can be felt separately.'],
    ko: ['통째로 뻣뻣하게 올라가거나 내려옴',
         '분절 조절이 아직 없어 척추가 한 덩어리로 움직입니다. 속도를 늦추고 척추 각 부분을 따로 느낄 수 있는 범위까지 줄이세요.'] },
  'lumbar-arch': {
    action: 'hip-flexion',
    en: ['The low back arching away from the mat',
         'The lever is too long for the abdominal control available right now. Raise the legs or bend the knees — height is the regression, not a compromise.'],
    ko: ['허리가 매트에서 뜸',
         '현재의 복부 조절 능력에 비해 지렛대가 너무 깁니다. 다리를 올리거나 무릎을 굽히세요. 높이는 타협이 아니라 정당한 하향 조절입니다.'] },
  'rib-flare': {
    action: 'trunk-extension',
    en: ['Ribs flaring and the movement collecting in the low back',
         'This is lumbar extension, not thoracic. Draw the front ribs down and take the range from the mid-back instead.'],
    ko: ['갈비뼈가 벌어지고 움직임이 허리에 몰림',
         '흉추가 아니라 요추 신전입니다. 앞쪽 갈비뼈를 아래로 당기고 등 중간에서 범위를 만드세요.'] },
  'pelvis-rock': {
    action: 'hip-abduction',
    en: ['The pelvis rocking with the leg',
         'The whole exercise is the pelvis not rocking. Reduce the range until it stops, then rebuild from there.'],
    ko: ['다리와 함께 골반이 흔들림',
         '골반이 흔들리지 않는 것이 이 운동의 전부입니다. 흔들림이 멈출 때까지 범위를 줄인 뒤 다시 쌓아 올리세요.'] },
  'hip-drop': {
    action: 'balance',
    en: ['The standing hip dropping',
         'Gluteus medius on the standing side is not holding the pelvis level. Shorten the hold and rebuild it before adding challenge.'],
    ko: ['딛고 선 쪽 골반이 떨어짐',
         '지지하는 쪽 중둔근이 골반을 수평으로 잡지 못합니다. 유지 시간을 줄이고 다시 만든 뒤 난이도를 올리세요.'] },
  'toe-grip': {
    action: 'balance',
    en: ['Gripping with the toes',
         'A sign the strategy has moved to the ankle because the hip is not contributing. Soften the toes and find the hip.'],
    ko: ['발가락으로 바닥을 움켜쥠',
         '고관절이 기여하지 않아 전략이 발목으로 옮겨 갔다는 신호입니다. 발가락 힘을 빼고 고관절을 찾으세요.'] },
  'shoulder-hike': {
    action: 'scapular-stability',
    en: ['Shoulders rising toward the ears',
         'Upper trapezius has taken the job from the lower fibres and serratus anterior. Slide the shoulder blades down the back before you load the position.'],
    ko: ['어깨가 귀 쪽으로 올라감',
         '상부 승모근이 하부 섬유와 전거근의 역할을 가져갔습니다. 부하를 주기 전에 견갑골을 등 아래로 미끄러뜨리세요.'] },
  'wing-scapula': {
    action: 'weight-bearing-arms',
    en: ['The shoulder blade lifting off the ribs',
         'Serratus anterior is not holding the scapula against the thorax. Push the floor away rather than sinking between the shoulders.'],
    ko: ['견갑골이 갈비뼈에서 들림',
         '전거근이 견갑골을 흉곽에 고정하지 못하고 있습니다. 어깨 사이로 가라앉지 말고 바닥을 밀어내세요.'] },
  'knee-valgus': {
    action: 'knee-flexion',
    en: ['Knees collapsing inward',
         'Hip abductor control failing at the moment of highest demand. Track the knee over the second toe — it is usually a hip problem, not a knee one.'],
    ko: ['무릎이 안쪽으로 무너짐',
         '요구가 가장 큰 순간에 고관절 외전 조절이 무너집니다. 무릎이 둘째 발가락 위를 지나게 하세요. 대개 무릎이 아니라 고관절 문제입니다.'] },
  'hamstring-cramp': {
    action: 'hip-extension',
    en: ['Hamstrings cramping instead of the glutes working',
         'The hip extensor of first resort has not been recruited. Change the foot position slightly and drive the floor away rather than squeezing.'],
    ko: ['둔근 대신 햄스트링에 쥐가 남',
         '일차 고관절 신전근이 동원되지 않았습니다. 발 위치를 조금 바꾸고 조이는 대신 바닥을 밀어내세요.'] },
  'breath-hold': {
    action: 'isometric-hold',
    en: ['Holding the breath',
         'The diaphragm cannot do the postural job and the breathing job at once. If the breath stops, the position is too hard — and that is information, not failure.'],
    ko: ['숨을 참음',
         '횡격막이 자세와 호흡을 동시에 감당하지 못합니다. 호흡이 멈추면 그 자세는 너무 어렵습니다. 실패가 아니라 정보입니다.'] },
  'neck-compress': {
    action: 'inversion',
    en: ['Weight collecting in the neck',
         'The load belongs on the shoulders and arms. Come down rather than negotiate with this one — cervical loading is the specific risk of the position.'],
    ko: ['체중이 목에 실림',
         '부하는 어깨와 팔에 실려야 합니다. 이 문제는 타협하지 말고 내려오십시오. 경추 부하가 이 자세의 특정 위험입니다.'] },
  'lock-knee': {
    action: 'knee-extension',
    en: ['Knee locked back hard',
         'Hyperextension replaces quadriceps control with joint structure. Keep a hair of bend and let the muscle hold it.'],
    ko: ['무릎을 뒤로 완전히 잠금',
         '과신전은 대퇴사두근의 조절을 관절 구조로 대체합니다. 아주 살짝 굽힌 상태를 유지해 근육이 잡게 하세요.'] },
  'waist-fold': {
    action: 'forward-fold',
    en: ['Rounding at the waist instead of folding at the hip',
         'The hamstrings have run out before the pelvis has finished tipping, so the lumbar spine gives the range instead. Bend the knees until the pelvis can rotate over the femurs, and keep the length in the front of the body.'],
    ko: ['고관절에서 접히지 않고 허리에서 말림',
         '골반이 다 기울기 전에 햄스트링이 한계에 도달해 요추가 대신 범위를 내주고 있습니다. 골반이 대퇴골 위에서 회전할 수 있을 때까지 무릎을 굽히고 몸 앞면의 길이를 유지하세요.'] },
  'collapse-lower-side': {
    action: 'lateral-reach',
    en: ['The underneath side collapsing',
         'A side bend is two sides doing different jobs: the upper side lengthens, the lower side has to hold. If the lower ribs sink toward the pelvis you are hanging on the joint rather than working the position.'],
    ko: ['아래쪽 옆면이 무너짐',
         '측굴은 양쪽이 서로 다른 일을 합니다. 위쪽은 늘어나고 아래쪽은 버텨야 합니다. 아래 갈비뼈가 골반 쪽으로 내려앉으면 자세를 만드는 것이 아니라 관절에 매달린 것입니다.'] },
  'front-rib-thrust': {
    action: 'chest-expansion',
    en: ['Opening the chest by pushing the front ribs forward',
         'That is lumbar extension wearing a chest opening’s clothes. Let the movement come from the thoracic spine and the shoulder blades, with the front ribs staying knitted down.'],
    ko: ['앞쪽 갈비뼈를 밀어내며 가슴을 여는 것',
         '가슴 열기의 탈을 쓴 요추 신전입니다. 앞 갈비뼈를 아래로 붙인 채 흉추와 견갑골에서 움직임이 나오게 하세요.'] },
  'knee-over-toe-drift': {
    action: 'hip-external-rotation',
    en: ['Forcing the knee down toward the floor',
         'External rotation belongs to the hip. Pressing on the knee borrows range from the medial knee ligaments instead, and they do not give it back.'],
    ko: ['무릎을 바닥 쪽으로 억지로 누름',
         '외회전은 고관절의 몫입니다. 무릎을 누르면 내측 무릎 인대에서 범위를 빌려 오는 것이며, 그 인대는 되돌려주지 않습니다.'] },
  'ankle-roll': {
    action: 'ankle-stability',
    en: ['The weight rolling to the outside edge of the foot',
         'The arch has given up and the ankle is taking the load at its least stable angle. Spread the toes, press the base of the big toe down, and rebuild the tripod before adding depth.'],
    ko: ['체중이 발 바깥 모서리로 쏠림',
         '아치가 무너져 발목이 가장 불안정한 각도에서 부하를 받고 있습니다. 발가락을 펴고 엄지발가락 뿌리를 눌러 삼각 지지를 다시 만든 뒤 깊이를 더하세요.'] },
  'rush-eccentric': {
    action: 'trunk-flexion',
    en: ['Rushing the way down',
         'The lowering half is the half with the most to teach. Speed is how you hide the range you cannot control.'],
    ko: ['내려오는 동작을 서두름',
         '내리는 절반이 가장 배울 것이 많은 구간입니다. 속도는 조절하지 못하는 범위를 숨기는 방법입니다.'] },
};

/* ------------------------------------------------------------------- cues
 * External-focus cues by action, because a meta-analysis of 218 studies favours external
 * focus for performance and retention — and because Pilates and yoga are traditionally
 * taught with internal cues, which is a tension worth surfacing rather than hiding. */
export const CUE = {
  'trunk-flexion':  { en: 'Send the fingertips toward the far wall and let the ribcage follow.',
                      ko: '손끝을 먼 벽 쪽으로 보내고 흉곽이 따라오게 하세요.' },
  'segmental-articulation': { en: 'Peel the spine off the mat the way you would peel tape — one small piece at a time.',
                      ko: '테이프를 떼어 내듯 척추를 매트에서 한 조각씩 떼어 내세요.' },
  'trunk-extension':{ en: 'Lengthen the front of the body toward the far corner of the room rather than lifting higher.',
                      ko: '더 높이 들기보다 몸의 앞면을 방의 먼 모서리 쪽으로 길게 늘리세요.' },
  'trunk-rotation': { en: 'Turn as if you were looking behind a door you are holding open.',
                      ko: '열어 둔 문 뒤를 보듯 돌리세요.' },
  'hip-extension':  { en: 'Push the floor away with your feet.',
                      ko: '발로 바닥을 밀어내세요.' },
  'hip-abduction':  { en: 'Imagine a glass of water balanced on the top hip and do not spill it.',
                      ko: '위쪽 골반에 물컵이 놓여 있다고 상상하고 쏟지 마세요.' },
  'knee-flexion':   { en: 'Drive the floor apart with your feet.',
                      ko: '발로 바닥을 양옆으로 밀어 벌리세요.' },
  'balance':        { en: 'Fix your eyes on a point on the wall and let the foot sort itself out.',
                      ko: '벽의 한 점에 시선을 고정하고 발은 스스로 정리되게 두세요.' },
  'scapular-stability': { en: 'Widen the collarbones toward the walls either side of you.',
                      ko: '쇄골을 양옆 벽 쪽으로 넓히세요.' },
  'weight-bearing-arms': { en: 'Push the floor away until the space between the shoulder blades is full.',
                      ko: '견갑골 사이가 채워질 때까지 바닥을 밀어내세요.' },
  'inversion':      { en: 'Reach the soles of the feet toward the ceiling.',
                      ko: '발바닥을 천장 쪽으로 뻗으세요.' },
  'breath-focus':   { en: 'Send the breath into the back of the ribcage, where you cannot see it.',
                      ko: '보이지 않는 흉곽 뒤쪽으로 호흡을 보내세요.' },
  'isometric-hold': { en: 'Hold the shape and keep the breath moving through it.',
                      ko: '형태를 유지하면서 호흡이 계속 흐르게 하세요.' },
  'hip-flexion':    { en: 'Draw the knee toward the ceiling rather than toward your chest.',
                      ko: '무릎을 가슴이 아니라 천장 쪽으로 보내세요.' },
  'forward-fold':   { en: 'Send the sitting bones toward the wall behind you and the crown of the head toward the wall in front.',
                      ko: '좌골은 뒤쪽 벽으로, 정수리는 앞쪽 벽으로 보내세요.' },
  'lateral-reach':  { en: 'Reach over an imaginary barrel rather than bending down the side of one.',
                      ko: '옆으로 굽히지 말고 상상의 통 위를 넘어간다고 생각하세요.' },
  'chest-expansion':{ en: 'Widen the collarbones and let the sternum lift without the front ribs following it.',
                      ko: '쇄골을 넓히고 앞 갈비뼈가 따라 나오지 않게 하면서 흉골만 들어 올리세요.' },
  'hip-external-rotation': { en: 'Turn the inner thigh toward the ceiling and leave the knee alone.',
                      ko: '허벅지 안쪽을 천장 쪽으로 돌리고 무릎은 건드리지 마세요.' },
  'shoulder-external-rotation': { en: 'Turn the eyes of the elbows forward.',
                      ko: '팔꿈치 안쪽이 앞을 보게 돌리세요.' },
  'ankle-stability':{ en: 'Press the big toe, the little toe and the heel into the floor, all three at once.',
                      ko: '엄지발가락, 새끼발가락, 뒤꿈치 세 곳을 동시에 바닥으로 누르세요.' },
};

/* -------------------------------------------------------------------- families */
export const FAMILY = {
  // Pilates
  'mat-fundamentals': { discipline: 'pilates', en: 'Mat fundamentals', ko: '매트 기초' },
  'mat-classical':    { discipline: 'pilates', en: 'Classical mat order', ko: '클래식 매트 순서' },
  'mat-abdominal':    { discipline: 'pilates', en: 'Mat — abdominal series', ko: '매트 — 복부 시리즈' },
  'mat-sidelying':    { discipline: 'pilates', en: 'Mat — side-lying series', ko: '매트 — 옆누움 시리즈' },
  'mat-prone':        { discipline: 'pilates', en: 'Mat — prone and extension', ko: '매트 — 엎드림·신전' },
  'mat-seated':       { discipline: 'pilates', en: 'Mat — seated and rolling', ko: '매트 — 앉기·구르기' },
  'mat-quadruped':    { discipline: 'pilates', en: 'Mat — quadruped and kneeling', ko: '매트 — 네발·무릎' },
  'reformer':         { discipline: 'pilates', en: 'Reformer', ko: '리포머' },
  'cadillac':         { discipline: 'pilates', en: 'Cadillac / trapeze table', ko: '캐딜락' },
  'chair':            { discipline: 'pilates', en: 'Wunda chair', ko: '체어' },
  'barrel':           { discipline: 'pilates', en: 'Ladder barrel and spine corrector', ko: '배럴·스파인 코렉터' },
  // Yoga
  'standing':         { discipline: 'yoga', en: 'Standing poses', ko: '선 자세' },
  'balance-poses':    { discipline: 'yoga', en: 'Balance poses', ko: '균형 자세' },
  'seated-forward':   { discipline: 'yoga', en: 'Seated and forward folds', ko: '앉은 자세·전굴' },
  'backbend':         { discipline: 'yoga', en: 'Backbends', ko: '후굴' },
  'twist':            { discipline: 'yoga', en: 'Twists', ko: '비틀기' },
  'hip-opener':       { discipline: 'yoga', en: 'Hip openers', ko: '고관절 열기' },
  'arm-balance':      { discipline: 'yoga', en: 'Arm balances', ko: '팔 균형' },
  'inversion-poses':  { discipline: 'yoga', en: 'Inversions', ko: '역자세' },
  'core-yoga':        { discipline: 'yoga', en: 'Core and abdominals', ko: '코어·복부' },
  'restorative':      { discipline: 'yoga', en: 'Restorative and supine', ko: '이완·바로누움' },
  'sun-salutation':   { discipline: 'yoga', en: 'Sun salutation sequence', ko: '태양경배 시퀀스' },
  'pranayama':        { discipline: 'yoga', en: 'Pranayama and breath practice', ko: '프라나야마·호흡 수련' },
};

export const PROP = {
  none:    { en: 'No props', ko: '도구 없음' },
  block:   { en: 'Block', ko: '블록' },
  strap:   { en: 'Strap', ko: '스트랩' },
  bolster: { en: 'Bolster', ko: '볼스터' },
  wall:    { en: 'Wall', ko: '벽' },
  blanket: { en: 'Blanket', ko: '담요' },
  chairProp: { en: 'Chair', ko: '의자' },
};
