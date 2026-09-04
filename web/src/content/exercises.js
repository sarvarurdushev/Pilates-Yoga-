/**
 * EXERCISE — what a movement is, how it is taught, and which muscles do what.
 *
 * The muscle lists split into prime movers / synergists / stabilisers, and **every list
 * carries an evidence marker**. `emg` means there is a study measuring it. `inferred` means
 * it comes from biomechanics and anatomy and nobody has put electrodes on it. Most Pilates
 * mat work is `inferred`, and saying so is the point — presenting inference as measurement
 * is the exact failure mode this project exists to avoid.
 *
 * `reviewed` is the instructor sign-off. Cueing and contraindications can injure people, so
 * an entry that has not been reviewed says so on screen, in the panel, every time. The app
 * also has an anatomy-only mode that hides cueing and contraindications entirely; see
 * `instructionOn` in ui.js.
 */

/** Evidence marker for a muscle-role attribution. */
export const ROLE_EVIDENCE = {
  emg:      { en: 'Measured by EMG', ko: '근전도로 측정됨', color: '#28B487' },
  inferred: { en: 'Inferred from biomechanics — no direct EMG',
              ko: '생체역학에서 추론 — 직접 근전도 없음', color: '#E9A13B' },
};

export const DISCIPLINES = {
  pilates:   { en: 'Pilates', ko: '필라테스' },
  yoga:      { en: 'Yoga', ko: '요가' },
  gym:       { en: 'Gym / resistance', ko: '웨이트 트레이닝' },
  crossfit:  { en: 'CrossFit / high intensity', ko: '크로스핏 / 고강도' },
  endurance: { en: 'Endurance, mobility, balance', ko: '지구력 · 가동성 · 균형' },
};

export const APPARATUS = {
  mat:       { en: 'Mat', ko: '매트' },
  reformer:  { en: 'Reformer', ko: '리포머' },
  cadillac:  { en: 'Cadillac', ko: '캐딜락' },
  chair:     { en: 'Wunda chair', ko: '체어' },
  barrel:    { en: 'Ladder barrel', ko: '배럴' },
};

/**
 * The instructor of record for this project's Pilates content.
 *
 * `credential` is deliberately left null rather than filled in with a plausible-looking
 * qualification. The reviewer's name was given; their certification was not, and inventing
 * one would be exactly the sort of thing the disclaimers exist to prevent. The UI renders
 * the credit with or without it, and test/content.test.mjs allows null while requiring the
 * name — so filling it in later is a one-line change and forgetting to is visible.
 */
export const REVIEWER = { by: 'Dr. Hong Jong Gi', credential: null, date: '2026-08-18' };

/**
 * The disciplines the reviewer of record signed off. Dr. Hong Jong Gi teaches both Pilates
 * and yoga, so both carry the sign-off; gym, CrossFit and endurance entries stay unreviewed
 * and say so on their own panel, because they are outside that remit and claiming otherwise
 * would be a lie about who checked what.
 */
export const REVIEWED_DISCIPLINES = new Set(['pilates', 'yoga']);

/** Reviewed by the instructor of record. */
const REVIEWED = REVIEWER;
/** Not reviewed: gym, CrossFit and endurance work is outside the reviewer's remit. */
const UNREVIEWED = false;

export const EXERCISE = {
  hundred: {
    discipline: 'pilates', family: 'mat-classical', apparatus: 'mat', difficulty: 2,
    en: {
      name: 'The Hundred',
      summary: 'The classic Pilates warm-up: head and shoulders lifted, legs extended, arms beating at the sides while you breathe in for five and out for five, ten times.',
      setup: 'Supine, knees to tabletop. Curl the head and shoulders off the mat until the bottom tips of the shoulder blades stay down. Extend the legs to whatever height keeps the low back quiet. Arms long by the hips, a few inches off the mat.',
      breath: 'Inhale for five beats, exhale for five. Ten cycles, one hundred beats. The exhale is the working half — the ribs draw down and the deep abdominals engage on the way out.',
      tempo: 'One beat per arm pulse, roughly two beats per second. The beats are the metronome, not the muscle.',
      faults: [
        ['Chin poking forward and the neck burning', 'The sternocleidomastoid has taken over from the deep neck flexors. Support the head in one hand for a few breaths — if the burn goes and the position holds, it was control, not strength.'],
        ['The low back arching off the mat', 'The legs are too low for the abdominal control available right now. Raise them. Height is the regression, not a compromise.'],
        ['The belly doming into a ridge', 'Load has exceeded what the deep layer is managing. Lower the legs or bend the knees.'],
        ['Holding the breath', 'The diaphragm cannot do the postural job and the breathing job at once. If the breath stops, the position is too hard.'],
      ],
      contraindications: 'Not for anyone with acute neck pain, cervical disc symptoms, or during pregnancy past the first trimester. Sustained cervical flexion with a raised head is the specific problem. The head-down variation removes it.',
      progressions: ['Legs extended lower, toward 45 degrees', 'Legs at 45 with a longer exhale', 'Add a small external rotation of the legs'],
      regressions: ['Head down on the mat, arms beating only', 'Knees in tabletop rather than legs extended', 'Feet on the floor, knees bent'],
      focusCue: 'Send the fingertips toward the far wall — an external cue outperforms "pull your navel in" for holding the position, even though the traditional cue is internal.',
    },
    ko: {
      name: '헌드레드',
      summary: '고전적인 필라테스 준비 동작입니다. 머리와 어깨를 들고 다리를 뻗은 채 팔을 옆에서 두드리며 다섯 번 들이쉬고 다섯 번 내쉬기를 열 번 반복합니다.',
      setup: '바로 누워 무릎을 테이블탑으로 듭니다. 견갑골 아래 끝이 매트에 남을 때까지 머리와 어깨를 말아 올립니다. 허리가 편안한 높이까지 다리를 뻗습니다. 팔은 골반 옆으로 길게, 매트에서 몇 센티 띄웁니다.',
      breath: '다섯 박자 들이쉬고 다섯 박자 내쉽니다. 열 번 반복해 백 박자입니다. 내쉬는 쪽이 일하는 구간으로, 갈비뼈가 내려가고 심부 복부가 작동합니다.',
      tempo: '팔 한 번에 한 박자, 초당 약 두 박자. 박자는 메트로놈이지 근육이 아닙니다.',
      faults: [
        ['턱이 앞으로 나오고 목이 타는 느낌', '흉쇄유돌근이 심부 경부 굴곡근을 대신하고 있습니다. 몇 호흡 동안 한 손으로 머리를 받쳐 보세요. 타는 느낌이 사라지고 자세가 유지되면 근력이 아니라 조절의 문제입니다.'],
        ['허리가 매트에서 뜸', '현재의 복부 조절 능력에 비해 다리가 너무 낮습니다. 다리를 올리세요. 높이는 타협이 아니라 정당한 하향 조절입니다.'],
        ['배가 산처럼 솟음', '부하가 심부층의 조절 범위를 넘었습니다. 다리를 낮추거나 무릎을 굽히세요.'],
        ['숨을 참음', '횡격막이 자세와 호흡을 동시에 감당하지 못합니다. 호흡이 멈추면 그 자세는 너무 어렵습니다.'],
      ],
      contraindications: '급성 경부 통증, 경추 디스크 증상이 있는 경우, 임신 1분기 이후에는 권장하지 않습니다. 머리를 든 채 유지하는 경추 굴곡이 문제입니다. 머리를 내린 변형은 이 부담을 없앱니다.',
      progressions: ['다리를 45도 쪽으로 더 낮게 뻗기', '45도에서 날숨을 더 길게', '다리에 약간의 외회전 추가'],
      regressions: ['머리를 매트에 두고 팔만 두드리기', '다리를 뻗지 않고 테이블탑 유지', '발을 바닥에 두고 무릎 굽히기'],
      focusCue: '손끝을 먼 벽 쪽으로 보내세요. 전통적 단서는 내적이지만, 자세 유지에는 "배꼽을 당기세요"보다 외적 단서가 더 효과적입니다.',
    },
    muscles: {
      prime:      [['rectus abdominis', 'emg'], ['external oblique', 'emg']],
      synergists: [['internal oblique', 'emg'], ['psoas major', 'inferred'],
                   ['rectus femoris', 'inferred'], ['sternocleidomastoid', 'emg']],
      stabilisers:[['transversus abdominis', 'inferred'], ['multifidus', 'inferred'],
                   ['diaphragm', 'inferred'], ['serratus anterior', 'inferred']],
    },
    emgNote: {
      en: 'Surface EMG studies of the Hundred exist and consistently show high rectus abdominis and external oblique activity. Transversus abdominis and multifidus cannot be measured with surface electrodes at all — they need fine-wire or ultrasound — so their role here is inferred from anatomy and from separate studies of those muscles, not measured in this exercise.',
      ko: '헌드레드에 대한 표면 근전도 연구가 있으며 복직근과 외복사근의 높은 활성이 일관되게 나타납니다. 복횡근과 다열근은 표면 전극으로 측정 자체가 불가능하여(세침 근전도나 초음파가 필요) 이 동작에서 측정된 것이 아니라 해부학과 별도 연구에서 추론한 역할입니다.',
    },
    brain: ['apa_timing', 'interoception_breath', 'external_focus', 'motor_learning'],
    reviewed: REVIEWED,
  },

  rollup: {
    discipline: 'pilates', family: 'mat-classical', apparatus: 'mat', difficulty: 3,
    en: {
      name: 'The Roll-Up',
      summary: 'Rolling up from lying to sitting one vertebra at a time, then rolling back down the same way. It is a control exercise disguised as a sit-up.',
      setup: 'Supine, legs long, arms overhead. Reach the arms to the ceiling, drop the chin, and peel the spine off the mat sequentially rather than lifting it as a block.',
      breath: 'Inhale to reach the arms up. Exhale through the whole roll-up. Inhale at the top. Exhale to roll down.',
      tempo: 'Slow — four to six seconds each way. Speed is how you hide the segment you cannot control.',
      faults: [
        ['Coming up in one rigid piece', 'The spine is moving as a block because the segmental control is not there yet. Bend the knees or hold behind the thighs.'],
        ['Feet lifting off the mat', 'The hip flexors are outmuscling the abdominals. It is not cheating to anchor the feet, but it does tell you what to work on.'],
        ['A flat spot in the low back on the way down', 'That is the segment with no control. Slow down through exactly there.'],
      ],
      contraindications: 'Avoid with acute low back pain, osteoporosis or vertebral fragility — loaded lumbar flexion is the specific risk. Not appropriate during pregnancy.',
      progressions: ['Arms overhead throughout', 'Slower descent', 'Roll-up with legs in external rotation'],
      regressions: ['Knees bent, hands behind the thighs', 'Roll down only, walking the hands down the thighs', 'Use a resistance band around the feet'],
      focusCue: 'Roll the mat up under your spine as you go — an external image of sequencing, rather than naming vertebrae.',
    },
    ko: {
      name: '롤업',
      summary: '누운 자세에서 척추를 한 마디씩 말아 올려 앉고, 같은 방식으로 되돌아 내려옵니다. 윗몸일으키기로 위장한 조절 운동입니다.',
      setup: '바로 누워 다리를 길게 뻗고 팔은 머리 위로. 팔을 천장으로 올리고 턱을 당긴 뒤, 척추를 통째로 들지 말고 한 마디씩 매트에서 떼어 냅니다.',
      breath: '들이쉬며 팔을 올리고, 롤업 전체를 내쉬면서 진행합니다. 정점에서 들이쉬고, 내쉬며 내려옵니다.',
      tempo: '느리게 — 각 방향 4–6초. 속도는 조절하지 못하는 분절을 숨기는 방법입니다.',
      faults: [
        ['통째로 뻣뻣하게 올라옴', '분절 조절이 아직 없어 척추가 한 덩어리로 움직입니다. 무릎을 굽히거나 허벅지 뒤를 잡으세요.'],
        ['발이 매트에서 뜸', '고관절 굴곡근이 복부보다 우세합니다. 발을 고정하는 것이 반칙은 아니지만 무엇을 보완해야 하는지 알려 줍니다.'],
        ['내려올 때 허리에 평평한 구간이 생김', '그곳이 조절되지 않는 분절입니다. 정확히 그 지점에서 속도를 늦추세요.'],
      ],
      contraindications: '급성 요통, 골다공증, 척추 취약성이 있으면 피하십시오. 부하가 실린 요추 굴곡이 위험 요소입니다. 임신 중에는 적합하지 않습니다.',
      progressions: ['팔을 계속 머리 위로 유지', '더 느린 하강', '다리를 외회전한 상태에서 롤업'],
      regressions: ['무릎을 굽히고 허벅지 뒤를 잡기', '내려오는 동작만, 손으로 허벅지를 짚으며', '발에 저항 밴드 사용'],
      focusCue: '내려가면서 척추 아래의 매트를 말아 올린다고 상상하세요. 척추뼈를 하나씩 부르는 대신 순서를 외적 이미지로 전합니다.',
    },
    muscles: {
      prime:      [['rectus abdominis', 'emg'], ['external oblique', 'inferred']],
      synergists: [['internal oblique', 'inferred'], ['psoas major', 'emg'], ['iliacus', 'inferred']],
      stabilisers:[['transversus abdominis', 'inferred'], ['multifidus', 'inferred'],
                   ['longissimus thoracis', 'inferred']],
    },
    emgNote: {
      en: 'Hip flexor involvement in slow trunk curl-ups is well measured; the segmental sequencing claim that defines the exercise is not — no study has shown that a roll-up trains vertebra-by-vertebra control better than any other flexion exercise.',
      ko: '느린 체간 말아 올리기에서 고관절 굴곡근의 관여는 잘 측정되어 있습니다. 그러나 이 동작을 정의하는 분절별 순차 조절 주장은 측정되지 않았습니다. 롤업이 다른 굴곡 운동보다 마디별 조절을 더 잘 훈련한다는 연구는 없습니다.',
    },
    brain: ['motor_learning', 'apa_timing'],
    reviewed: REVIEWED,
  },

  shoulderbridge: {
    discipline: 'pilates', family: 'mat-fundamentals', apparatus: 'mat', difficulty: 2,
    en: {
      name: 'Shoulder Bridge',
      summary: 'Peeling the pelvis and spine off the mat into a bridge and lowering back down one segment at a time.',
      setup: 'Supine, knees bent, feet hip-width and flat. Tilt the pelvis, then lift sequentially from the tailbone up until the weight is on the shoulder blades, not the neck.',
      breath: 'Exhale to lift, inhale at the top, exhale to lower. The exhale on the way up keeps the ribs from flaring.',
      tempo: 'Three seconds up, three down, with a pause at the top.',
      faults: [
        ['Hamstrings cramping', 'The glutes have not been recruited and the hamstrings are doing hip extension alone. Move the feet slightly further from the pelvis.'],
        ['Ribs flaring and the low back arching', 'This is lumbar extension, not hip extension. Lower until the ribcage closes.'],
        ['Weight on the neck', 'Too high. The load belongs on the shoulder blades.'],
      ],
      contraindications: 'Avoid with acute neck injury or cervical disc symptoms — weight-bearing through the cervical spine is the risk. Modify with a lower range if the hamstrings cramp persistently.',
      progressions: ['Single-leg bridge', 'Feet on an unstable surface', 'Bridge with arms overhead'],
      regressions: ['Pelvic tilt only, no lift', 'Lift as one block rather than segmentally', 'Feet against a wall'],
      focusCue: 'Push the floor away with your feet — external, and it recruits the hip extensors better than "squeeze your glutes".',
    },
    ko: {
      name: '숄더 브릿지',
      summary: '골반과 척추를 매트에서 한 마디씩 떼어 브릿지를 만들고 같은 방식으로 내려옵니다.',
      setup: '바로 누워 무릎을 굽히고 발은 골반 너비로 바닥에 둡니다. 골반을 기울인 뒤 꼬리뼈부터 순차적으로 들어 올려 체중이 목이 아닌 견갑골에 실리게 합니다.',
      breath: '내쉬며 올리고, 정점에서 들이쉬고, 내쉬며 내려옵니다. 올라갈 때의 날숨이 갈비뼈가 벌어지는 것을 막습니다.',
      tempo: '3초 상승, 3초 하강, 정점에서 잠시 정지.',
      faults: [
        ['햄스트링에 쥐가 남', '둔근이 동원되지 않아 햄스트링이 혼자 고관절 신전을 하고 있습니다. 발을 골반에서 조금 더 멀리 두세요.'],
        ['갈비뼈가 벌어지고 허리가 젖혀짐', '고관절 신전이 아니라 요추 신전입니다. 흉곽이 닫힐 때까지 낮추세요.'],
        ['체중이 목에 실림', '너무 높습니다. 부하는 견갑골에 실려야 합니다.'],
      ],
      contraindications: '급성 경부 손상이나 경추 디스크 증상이 있으면 피하십시오. 경추에 체중이 실리는 것이 위험 요소입니다. 햄스트링 경련이 지속되면 가동범위를 줄이십시오.',
      progressions: ['한 다리 브릿지', '불안정한 표면에 발 올리기', '팔을 머리 위로 둔 브릿지'],
      regressions: ['들지 않고 골반 기울이기만', '분절이 아닌 한 덩어리로 들기', '발을 벽에 대기'],
      focusCue: '발로 바닥을 밀어내세요. 외적 단서이며 "엉덩이를 조이세요"보다 고관절 신전근을 잘 동원합니다.',
    },
    muscles: {
      prime:      [['gluteus maximus', 'emg'], ['biceps femoris', 'emg'], ['semitendinosus', 'emg']],
      synergists: [['longissimus thoracis', 'emg'], ['iliocostalis lumborum', 'inferred']],
      stabilisers:[['transversus abdominis', 'inferred'], ['multifidus', 'inferred'],
                   ['gluteus medius', 'inferred']],
    },
    emgNote: {
      en: 'Bridging is one of the better-measured rehabilitation exercises — glute and hamstring EMG ratios during bridge variations have been studied repeatedly. The deep stabiliser contribution is still inferred.',
      ko: '브릿지는 재활 운동 중 비교적 잘 측정된 동작으로, 변형 동작별 둔근·햄스트링 근전도 비율이 반복적으로 연구되었습니다. 심부 안정근의 기여는 여전히 추론입니다.',
    },
    brain: ['apa_timing', 'motor_learning'],
    reviewed: REVIEWED,
  },

  sidekick: {
    discipline: 'pilates', family: 'mat-sidelying', apparatus: 'mat', difficulty: 2,
    en: {
      name: 'Side Kick Series',
      summary: 'Lying on one side, the top leg swings forward and back while everything from the ribs to the standing hip refuses to move.',
      setup: 'Side-lying, body in one long line or slightly angled forward, head supported. The top leg lifts to hip height and moves in the hip joint alone.',
      breath: 'Exhale as the leg swings forward, inhale as it goes back. The breath marks the moment the trunk is most likely to give way.',
      tempo: 'Moderate and rhythmic; the leg is a pendulum, the trunk is the frame.',
      faults: [
        ['The pelvis rocking with the leg', 'The whole exercise is the pelvis not rocking. Reduce the range until it stops.'],
        ['The waist collapsing into the mat', 'Lift the underneath waist so there is a gap. Otherwise the lateral trunk is resting, not working.'],
      ],
      contraindications: 'Reduce range with hip impingement symptoms or acute sacroiliac pain.',
      progressions: ['Bottom leg lifted off the mat', 'Forearm-supported side-lying', 'Add ankle weights'],
      regressions: ['Bottom knee bent for a wider base', 'Smaller range', 'Back against a wall for feedback'],
      focusCue: 'Keep the top hip stacked over the bottom one — or better, imagine a glass of water balanced on your hip.',
    },
    ko: {
      name: '사이드 킥 시리즈',
      summary: '옆으로 누워 위쪽 다리를 앞뒤로 흔드는 동안 갈비뼈부터 지지하는 골반까지는 움직이지 않습니다.',
      setup: '옆으로 누워 몸을 한 줄로, 또는 약간 앞으로 기울여 두고 머리를 받칩니다. 위쪽 다리를 골반 높이로 들어 고관절에서만 움직입니다.',
      breath: '다리가 앞으로 갈 때 내쉬고 뒤로 갈 때 들이쉽니다. 호흡은 체간이 무너지기 쉬운 순간을 표시합니다.',
      tempo: '적당하고 리듬감 있게. 다리는 진자, 체간은 틀입니다.',
      faults: [
        ['다리와 함께 골반이 흔들림', '골반이 흔들리지 않는 것이 이 운동의 전부입니다. 흔들림이 멈출 때까지 가동범위를 줄이세요.'],
        ['허리가 매트로 무너짐', '아래쪽 허리를 들어 틈을 만드세요. 그렇지 않으면 측면 체간이 일하지 않고 쉬고 있는 것입니다.'],
      ],
      contraindications: '고관절 충돌 증상이나 급성 천장관절 통증이 있으면 가동범위를 줄이십시오.',
      progressions: ['아래쪽 다리도 매트에서 들기', '전완 지지 옆누움', '발목 중량 추가'],
      regressions: ['아래쪽 무릎을 굽혀 지지면 넓히기', '가동범위 축소', '등을 벽에 대어 피드백 받기'],
      focusCue: '위쪽 골반을 아래쪽 골반 위에 그대로 쌓아 두세요. 더 좋게는, 골반 위에 물컵이 놓여 있다고 상상하세요.',
    },
    muscles: {
      prime:      [['gluteus medius', 'emg'], ['psoas major', 'inferred']],
      synergists: [['gluteus maximus', 'emg'], ['rectus femoris', 'inferred']],
      stabilisers:[['quadratus lumborum', 'inferred'], ['external oblique', 'emg'],
                   ['internal oblique', 'inferred'], ['transversus abdominis', 'inferred']],
    },
    emgNote: {
      en: 'Side-lying hip abduction is among the best-measured gluteus medius exercises in the rehabilitation literature. What is not measured is the trunk-stability claim that makes it a Pilates exercise rather than a hip exercise.',
      ko: '옆누움 고관절 외전은 재활 문헌에서 중둔근 운동 중 가장 잘 측정된 동작입니다. 측정되지 않은 것은 이 동작을 고관절 운동이 아닌 필라테스 운동으로 만드는 체간 안정성 주장입니다.',
    },
    brain: ['apa_timing', 'balance_cerebellum'],
    reviewed: REVIEWED,
  },

  footwork: {
    discipline: 'pilates', family: 'reformer', apparatus: 'reformer', difficulty: 1,
    en: {
      name: 'Reformer Footwork',
      summary: 'Lying on the carriage, pushing away from the footbar against spring resistance. The first exercise in almost every reformer class.',
      setup: 'Supine on the carriage, feet on the bar in the prescribed position, pelvis neutral, ribs down. Push until the legs are straight without locking, return with control.',
      breath: 'Inhale to push out, exhale to return — or the reverse, depending on lineage. Both are taught; neither has evidence behind it.',
      tempo: 'Even both ways. The return is the half most people rush and the half the springs are teaching.',
      faults: [
        ['The pelvis tucking as the legs straighten', 'The range has exceeded hip extension control. Stop short.'],
        ['The carriage banging home', 'The eccentric phase is uncontrolled — that is the half of the movement with the most to teach.'],
        ['Knees falling inward', 'Track the knee over the second toe. Usually a hip control problem, not a knee one.'],
      ],
      contraindications: 'Spring load must be reduced for knee osteoarthritis and after any lower-limb surgery. The closed chain is generally knee-friendly, but load is load.',
      progressions: ['Single leg', 'Fewer springs, more control demand', 'Heels-raised variations'],
      regressions: ['More springs for support', 'Reduced range', 'Head rest raised'],
      focusCue: 'Press the carriage away from the bar, not your legs straight.',
    },
    ko: {
      name: '리포머 풋워크',
      summary: '캐리지에 누워 스프링 저항에 맞서 풋바를 밀어냅니다. 거의 모든 리포머 수업의 첫 동작입니다.',
      setup: '캐리지에 바로 누워 지정된 위치에 발을 올리고 골반은 중립, 갈비뼈는 내립니다. 무릎을 완전히 잠그지 않고 다리를 펴며 밀고, 조절하며 돌아옵니다.',
      breath: '밀 때 들이쉬고 돌아올 때 내쉬거나, 계보에 따라 반대로 합니다. 둘 다 가르쳐지며 어느 쪽에도 근거는 없습니다.',
      tempo: '양방향 균일하게. 대부분이 서두르는 복귀 구간이 스프링이 가르치는 구간입니다.',
      faults: [
        ['다리를 펴면서 골반이 말림', '가동범위가 고관절 신전 조절 능력을 넘었습니다. 조금 못 미쳐 멈추세요.'],
        ['캐리지가 쿵 하고 닿음', '원심성 구간이 조절되지 않고 있습니다. 가장 배울 것이 많은 절반입니다.'],
        ['무릎이 안쪽으로 무너짐', '무릎이 둘째 발가락 위를 지나게 하세요. 대개 무릎이 아니라 고관절 조절 문제입니다.'],
      ],
      contraindications: '무릎 골관절염이나 하지 수술 후에는 스프링 부하를 줄여야 합니다. 닫힌 사슬 운동이라 무릎에 비교적 부담이 적지만 부하는 부하입니다.',
      progressions: ['한 다리', '스프링을 줄여 조절 요구 증가', '뒤꿈치 든 변형'],
      regressions: ['스프링을 늘려 지지', '가동범위 축소', '헤드레스트 올리기'],
      focusCue: '다리를 편다고 생각하지 말고 캐리지를 바에서 밀어낸다고 생각하세요.',
    },
    muscles: {
      prime:      [['rectus femoris', 'emg'], ['gluteus maximus', 'emg'], ['soleus', 'inferred']],
      synergists: [['gastrocnemius', 'emg'], ['biceps femoris', 'inferred'], ['semitendinosus', 'inferred']],
      stabilisers:[['transversus abdominis', 'inferred'], ['multifidus', 'inferred'],
                   ['gluteus medius', 'inferred']],
    },
    emgNote: {
      en: 'Reformer-specific EMG is sparse. The muscle roles here transfer from leg-press biomechanics, which is the same closed-chain pattern under a different resistance curve — springs load differently from weight, and that difference has not been measured for these muscles.',
      ko: '리포머 전용 근전도 연구는 드뭅니다. 여기 근육 역할은 레그프레스 생체역학에서 가져온 것으로, 저항 곡선만 다른 동일한 닫힌 사슬 패턴입니다. 스프링은 중량과 다르게 부하를 주며 그 차이는 이 근육들에 대해 측정되지 않았습니다.',
    },
    brain: ['motor_learning', 'neural_strength'],
    reviewed: REVIEWED,
  },

  backsquat: {
    discipline: 'gym', apparatus: null, difficulty: 3,
    en: {
      name: 'Back Squat',
      summary: 'Bar on the upper back, hips and knees bend together until the hip crease passes the knee, then drive back up.',
      setup: 'Bar on the traps or rear delts, feet about shoulder-width, toes slightly out. Break at hip and knee together. Depth is whatever you can reach without the pelvis tucking.',
      breath: 'Big breath at the top, hold through the descent and the first half of the ascent, exhale past the hard point. This is a bracing pattern, not a Pilates breath.',
      tempo: 'Two to three seconds down, drive up.',
      faults: [
        ['Butt wink — the pelvis tucking at the bottom', 'You have run out of hip flexion range. Reduce depth or widen the stance.'],
        ['Knees collapsing inward under load', 'Hip abductor control failing at the moment of highest demand.'],
        ['Chest dropping forward', 'The bar drifts ahead of midfoot and the back extensors take load that the legs should.'],
      ],
      contraindications: 'Load must be individualised with any history of lumbar disc injury, and depth with hip impingement. This is a heavy compound lift — coaching is not optional at load.',
      progressions: ['Increase load', 'Pause squat at depth', 'Front squat for a more upright torso'],
      regressions: ['Goblet squat', 'Box squat to a fixed depth', 'Bodyweight squat'],
      focusCue: 'Drive the floor apart — external, and it consistently produces more force than "activate your glutes".',
    },
    ko: {
      name: '백 스쿼트',
      summary: '바를 등 위쪽에 얹고 고관절과 무릎을 함께 굽혀 고관절이 무릎보다 낮아질 때까지 내려간 뒤 밀어 올립니다.',
      setup: '바를 승모근 또는 후면 삼각근에 얹고 발은 어깨너비, 발끝은 약간 바깥으로. 고관절과 무릎을 동시에 굽힙니다. 깊이는 골반이 말리지 않는 범위까지입니다.',
      breath: '정점에서 크게 들이쉬고 하강과 상승 전반부까지 참았다가, 가장 힘든 지점을 지나며 내쉽니다. 필라테스 호흡이 아니라 브레이싱 패턴입니다.',
      tempo: '2–3초 하강, 강하게 상승.',
      faults: [
        ['바닥에서 골반이 말림 (버트 윙크)', '고관절 굴곡 가동범위를 다 썼습니다. 깊이를 줄이거나 스탠스를 넓히세요.'],
        ['부하가 걸리면 무릎이 안으로 무너짐', '요구가 가장 큰 순간에 고관절 외전 조절이 무너지고 있습니다.'],
        ['가슴이 앞으로 떨어짐', '바가 발 중앙보다 앞으로 나가면서 다리가 받아야 할 부하를 척추 신전근이 받습니다.'],
      ],
      contraindications: '요추 디스크 병력이 있으면 부하를, 고관절 충돌이 있으면 깊이를 개별 조정해야 합니다. 무거운 복합 운동이며 부하 상태에서 지도는 선택이 아닙니다.',
      progressions: ['부하 증가', '최저점 정지 스쿼트', '상체를 더 세우는 프론트 스쿼트'],
      regressions: ['고블릿 스쿼트', '고정 깊이의 박스 스쿼트', '맨몸 스쿼트'],
      focusCue: '바닥을 양옆으로 밀어 벌린다고 생각하세요. 외적 단서이며 "둔근을 활성화하세요"보다 일관되게 더 큰 힘을 냅니다.',
    },
    muscles: {
      prime:      [['rectus femoris', 'emg'], ['gluteus maximus', 'emg']],
      synergists: [['biceps femoris', 'emg'], ['semitendinosus', 'emg'], ['soleus', 'emg']],
      stabilisers:[['longissimus thoracis', 'emg'], ['iliocostalis lumborum', 'emg'],
                   ['multifidus', 'inferred'], ['transversus abdominis', 'inferred'],
                   ['gluteus medius', 'emg']],
    },
    emgNote: {
      en: 'The squat is one of the most heavily instrumented movements in sports science; almost every superficial muscle role here is directly measured across depths, stances and loads.',
      ko: '스쿼트는 스포츠 과학에서 가장 많이 계측된 동작 중 하나로, 여기 표층 근육 역할은 깊이·스탠스·부하별로 직접 측정되어 있습니다.',
    },
    brain: ['neural_strength', 'motor_learning', 'cross_education'],
    reviewed: UNREVIEWED,
  },

  deadlift: {
    discipline: 'gym', apparatus: null, difficulty: 4,
    en: {
      name: 'Deadlift',
      summary: 'Lifting a loaded bar from the floor to standing by extending the hips and knees together.',
      setup: 'Bar over midfoot, shins close, hips higher than a squat. Take the slack out of the bar before pulling, then push the floor away and stand up.',
      breath: 'Brace at the top of the set-up, hold through the pull, exhale at lockout.',
      tempo: 'Controlled pull, controlled lower. Dropping the bar removes the eccentric, which is most of the training stimulus.',
      faults: [
        ['The hips shooting up first', 'The legs disengage and the back becomes the prime mover.'],
        ['The bar drifting away from the shins', 'Every centimetre forward increases the moment arm on the lumbar spine.'],
        ['Rounding at the low back under load', 'Not automatically dangerous, but it is a load management question and needs a coach, not a rule.'],
      ],
      contraindications: 'Heaviest spinal loading of any common lift. Individualise carefully with any lumbar pathology. Not a movement to learn from an app.',
      progressions: ['Increase load', 'Deficit deadlift', 'Pause below the knee'],
      regressions: ['Rack pull from blocks', 'Romanian deadlift with lighter load', 'Hip hinge with a dowel'],
      focusCue: 'Push the floor down and away, rather than pulling the bar up.',
    },
    ko: {
      name: '데드리프트',
      summary: '바닥의 바를 고관절과 무릎을 함께 펴며 선 자세까지 들어 올립니다.',
      setup: '바를 발 중앙 위에, 정강이를 가깝게, 고관절은 스쿼트보다 높게. 당기기 전에 바의 유격을 없앤 뒤 바닥을 밀어내며 일어섭니다.',
      breath: '준비 자세 마지막에 브레이싱하고 당기는 내내 유지하다가 정점에서 내쉽니다.',
      tempo: '조절된 당김, 조절된 내림. 바를 떨어뜨리면 원심성 구간이 사라지는데 그것이 훈련 자극의 대부분입니다.',
      faults: [
        ['고관절이 먼저 솟구침', '다리가 빠지고 등이 주동근이 됩니다.'],
        ['바가 정강이에서 멀어짐', '앞으로 나간 1 cm마다 요추의 모멘트암이 커집니다.'],
        ['부하 상태에서 허리가 말림', '자동으로 위험한 것은 아니지만 부하 관리의 문제이며, 규칙이 아니라 지도자가 필요합니다.'],
      ],
      contraindications: '일반적인 리프트 중 척추 부하가 가장 큽니다. 요추 병변이 있으면 신중히 개별화해야 합니다. 앱으로 배울 동작이 아닙니다.',
      progressions: ['부하 증가', '데피싯 데드리프트', '무릎 아래 정지'],
      regressions: ['블록에서 시작하는 랙풀', '가벼운 루마니안 데드리프트', '봉을 이용한 힙 힌지'],
      focusCue: '바를 위로 당긴다기보다 바닥을 아래로 밀어낸다고 생각하세요.',
    },
    muscles: {
      prime:      [['gluteus maximus', 'emg'], ['biceps femoris', 'emg'], ['semitendinosus', 'emg']],
      synergists: [['rectus femoris', 'emg'], ['latissimus dorsi', 'emg'], ['trapezius', 'emg']],
      stabilisers:[['longissimus thoracis', 'emg'], ['iliocostalis lumborum', 'emg'],
                   ['multifidus', 'inferred'], ['transversus abdominis', 'inferred'],
                   ['quadratus lumborum', 'inferred']],
    },
    emgNote: {
      en: 'Erector spinae and hip extensor activity in the deadlift is very well measured. Deep stabiliser contribution under heavy load is inferred — you cannot put surface electrodes on transversus abdominis.',
      ko: '데드리프트의 척주기립근·고관절 신전근 활성은 매우 잘 측정되어 있습니다. 고부하에서 심부 안정근의 기여는 추론입니다. 복횡근에는 표면 전극을 붙일 수 없습니다.',
    },
    brain: ['neural_strength', 'motor_learning'],
    reviewed: UNREVIEWED,
  },

  thruster: {
    discipline: 'crossfit', apparatus: null, difficulty: 4,
    en: {
      name: 'Thruster',
      summary: 'A front squat flowing straight into an overhead press, usually for high repetitions under fatigue.',
      setup: 'Bar in the front rack, elbows high. Squat to depth, then drive up and let the momentum carry the bar overhead into a locked-out press.',
      breath: 'Breathe at the top of each rep. At high repetitions the breathing pattern is the limiter more often than the muscles.',
      tempo: 'Continuous and cyclical — this is a conditioning movement as much as a strength one.',
      faults: [
        ['Elbows dropping in the rack', 'The bar rolls forward and the squat becomes a good-morning.'],
        ['Pressing rather than using leg drive', 'The whole point is the transfer; pressing separately wastes it and fatigues the shoulder early.'],
        ['Form degrading with fatigue', 'The characteristic risk of the movement. Fatigue changes technique before it changes output.'],
      ],
      contraindications: 'Requires full overhead range — not appropriate with shoulder impingement or limited thoracic extension. High-repetition loaded overhead work under fatigue deserves real caution.',
      progressions: ['Increase load', 'Increase repetitions', 'Dumbbell thrusters for independent arms'],
      regressions: ['Split the movement into front squat and press', 'Empty bar', 'Air squat to overhead reach'],
      focusCue: 'Send the bar to the ceiling — one continuous movement rather than two.',
    },
    ko: {
      name: '스러스터',
      summary: '프론트 스쿼트에서 곧바로 오버헤드 프레스로 이어지는 동작이며, 보통 피로 상태에서 고반복으로 수행합니다.',
      setup: '바를 프론트 랙에 두고 팔꿈치를 높게. 최저점까지 스쿼트한 뒤 밀어 올리며 그 힘으로 바를 머리 위 잠금 위치까지 보냅니다.',
      breath: '매 반복 정점에서 호흡합니다. 고반복에서는 근육보다 호흡 패턴이 먼저 한계가 됩니다.',
      tempo: '연속적이고 순환적으로. 근력 운동인 만큼 컨디셔닝 운동이기도 합니다.',
      faults: [
        ['랙 자세에서 팔꿈치가 떨어짐', '바가 앞으로 굴러 스쿼트가 굿모닝으로 변합니다.'],
        ['다리 힘을 쓰지 않고 팔로만 밀기', '핵심은 힘의 전달입니다. 따로 밀면 그것을 낭비하고 어깨가 일찍 지칩니다.'],
        ['피로와 함께 자세가 무너짐', '이 동작의 특징적 위험입니다. 피로는 출력보다 기술을 먼저 바꿉니다.'],
      ],
      contraindications: '완전한 머리 위 가동범위가 필요합니다. 어깨 충돌이나 흉추 신전 제한이 있으면 적합하지 않습니다. 피로 상태의 고반복 머리 위 부하 운동은 각별한 주의가 필요합니다.',
      progressions: ['부하 증가', '반복 수 증가', '팔을 독립적으로 쓰는 덤벨 스러스터'],
      regressions: ['프론트 스쿼트와 프레스로 분리', '빈 바', '맨몸 스쿼트 후 머리 위 뻗기'],
      focusCue: '바를 천장으로 보내세요. 두 동작이 아니라 하나의 연속 동작입니다.',
    },
    muscles: {
      prime:      [['rectus femoris', 'emg'], ['gluteus maximus', 'emg'], ['deltoid', 'emg']],
      synergists: [['trapezius', 'emg'], ['pectoralis major', 'inferred'], ['soleus', 'inferred']],
      stabilisers:[['serratus anterior', 'inferred'], ['longissimus thoracis', 'emg'],
                   ['transversus abdominis', 'inferred'], ['infraspinatus muscle', 'inferred']],
    },
    emgNote: {
      en: 'Component movements (front squat, overhead press) are well measured separately. The thruster as a single fatigued cycle is not — and fatigue changes recruitment, so the separate measurements do not simply add.',
      ko: '구성 동작(프론트 스쿼트, 오버헤드 프레스)은 각각 잘 측정되어 있습니다. 피로 상태의 단일 순환으로서의 스러스터는 그렇지 않으며, 피로가 동원 양상을 바꾸므로 개별 측정치를 단순히 더할 수 없습니다.',
    },
    brain: ['motor_learning', 'executive_function'],
    reviewed: UNREVIEWED,
  },

  singleleg: {
    discipline: 'endurance', apparatus: null, difficulty: 1,
    en: {
      name: 'Single-Leg Balance',
      summary: 'Standing on one leg. The simplest possible test of the whole postural control loop, and the one with the best evidence behind it.',
      setup: 'Stand on one foot, other foot off the ground, hands free. Hold. Progress by closing the eyes, which removes vision and forces the system onto proprioception and the vestibular system.',
      breath: 'Normal and continuous. Holding the breath is a strategy for masking instability.',
      tempo: 'Held — 30 seconds is a reasonable target, eyes open, before progressing.',
      faults: [
        ['The standing hip dropping', 'Gluteus medius on the standing side is not holding the pelvis level.'],
        ['Gripping with the toes', 'A sign the strategy has moved to the ankle because the hip is not contributing.'],
      ],
      contraindications: 'Stand near a wall or rail with any history of falls, vestibular disorder, or peripheral neuropathy. The value of the exercise comes from the challenge; the risk comes from the same place.',
      progressions: ['Eyes closed', 'On a foam pad or cushion', 'Head turns while balancing'],
      regressions: ['Fingertips on a wall', 'Two feet, narrow stance', 'Shorter holds'],
      focusCue: 'Fix your eyes on a point on the wall — external, and better than thinking about your foot.',
    },
    ko: {
      name: '한 발 균형',
      summary: '한 발로 서기. 자세 조절 전체 회로에 대한 가장 단순한 검사이며, 근거가 가장 탄탄한 동작이기도 합니다.',
      setup: '한 발로 서고 다른 발은 바닥에서 떼며 손은 자유롭게 둡니다. 유지합니다. 눈을 감아 진행하면 시각이 제거되어 고유감각과 전정계에 의존하게 됩니다.',
      breath: '평소처럼 계속. 숨을 참는 것은 불안정을 감추는 전략입니다.',
      tempo: '정적 유지 — 눈을 뜬 상태로 30초가 다음 단계로 넘어가기 전 합리적인 목표입니다.',
      faults: [
        ['딛고 선 쪽 골반이 떨어짐', '지지하는 쪽 중둔근이 골반을 수평으로 잡지 못하고 있습니다.'],
        ['발가락으로 바닥을 움켜쥠', '고관절이 기여하지 않아 전략이 발목으로 옮겨 갔다는 신호입니다.'],
      ],
      contraindications: '낙상 병력, 전정 질환, 말초신경병증이 있으면 벽이나 난간 가까이에서 하십시오. 이 운동의 가치는 도전에서 나오고 위험도 같은 곳에서 나옵니다.',
      progressions: ['눈 감기', '폼패드나 쿠션 위에서', '균형을 유지하며 고개 돌리기'],
      regressions: ['손끝을 벽에 대기', '두 발, 좁은 스탠스', '유지 시간 단축'],
      focusCue: '벽의 한 점에 시선을 고정하세요. 외적 단서이며 발을 생각하는 것보다 낫습니다.',
    },
    muscles: {
      prime:      [['gluteus medius', 'emg'], ['soleus', 'emg']],
      synergists: [['gastrocnemius', 'emg'], ['gluteus maximus', 'inferred']],
      stabilisers:[['quadratus lumborum', 'inferred'], ['multifidus', 'inferred'],
                   ['transversus abdominis', 'inferred']],
    },
    emgNote: {
      en: 'Postural muscle activity in single-leg stance is directly measured and well replicated; soleus in particular is the principal controller of forward sway.',
      ko: '한 발 지지에서의 자세근 활성은 직접 측정되었고 재현성도 좋습니다. 특히 가자미근이 전방 동요의 주된 조절근입니다.',
    },
    brain: ['balance_cerebellum', 'motor_learning'],
    reviewed: UNREVIEWED,
  },
};

/* --------------------------------------------------------------------- the library
 * The nine entries above are written out longhand — every fault, every progression, every
 * sentence of prose, per exercise. That does not scale to a repertoire, and hand-written
 * prose of variable quality across two hundred entries could not be checked at all. So the
 * rest of the library is *records*: which joints move and through what range, which muscles
 * in which role with an evidence marker each, which contraindication classes apply, what the
 * breath does, which brain claims it touches. `library/compose.js` turns a record into an
 * entry of the same shape through the shared vocabulary, in both languages.
 *
 * A longhand entry always wins on a key collision, so composing can never overwrite one.
 */
import { PILATES } from './library/pilates.js';
import { YOGA } from './library/yoga.js';
import { composeExercise, composeMotion } from './library/compose.js';

/** Records that did not have a longhand entry, composed into one. */
export const COMPOSED = {};
/** Clips for those records, merged into MOTION by motion.js. */
export const COMPOSED_MOTION = {};

for (const r of [...PILATES, ...YOGA]) {
  if (EXERCISE[r.key]) continue;                    // the longhand entry stands
  const reviewer = r.reviewed === false ? false : REVIEWER;
  COMPOSED[r.key] = composeExercise(r, reviewer);
  const clip = composeMotion(r);
  if (clip) COMPOSED_MOTION[r.key] = clip;
  EXERCISE[r.key] = COMPOSED[r.key];
}

export const EXERCISE_KEYS = Object.keys(EXERCISE);

/** Every discipline present, with how many entries it carries. */
export function libraryCounts() {
  const out = {};
  for (const k of EXERCISE_KEYS) {
    const d = EXERCISE[k].discipline;
    (out[d] ??= { total: 0, families: new Set() }).total++;
    if (EXERCISE[k].family) out[d].families.add(EXERCISE[k].family);
  }
  return out;
}

/** Every muscle key an exercise names, across all three roles. */
export function musclesOf(ex) {
  const m = EXERCISE[ex]?.muscles;
  if (!m) return [];
  return [...m.prime, ...m.synergists, ...m.stabilisers];
}

/** Activation levels for the palette. Not a measurement — see the legend in the UI. */
export const ROLE_LEVEL = { prime: 1.0, synergists: 0.62, stabilisers: 0.34 };
