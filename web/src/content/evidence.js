/**
 * EXERCISE_BRAIN — what exercise does to the brain, with the strength of the evidence
 * attached to every claim and shown on screen.
 *
 * "Exercise rewires your brain" is a genre saturated with confident nonsense. The only
 * thing that makes this app worth building is that it refuses to join in, so the tier and
 * the citation are not metadata here — they are the content. A claim without both is a bug,
 * and test/content.test.mjs fails the build over it.
 *
 * Tiers:
 *   A  meta-analysis, or multiple human RCTs agreeing
 *   B  one human RCT, or consistent human observational evidence
 *   C  human mechanistic or imaging work, small samples
 *   D  animal models only
 *   E  mechanistic inference — reasoning, not finding, and labelled as reasoning
 *
 * Fields:
 *   claim        one sentence, the thing being asserted
 *   mechanism    why it would be true
 *   structures   region ids in the brain model this touches
 *   tier         A-E as above
 *   citation     primary source, enough to find it
 *   effect       the size of the thing, in its own units, or null when there isn't one
 *   population   who was studied — this is where over-generalisation gets caught
 *   species      'human' | 'animal'
 *   timescale    'acute' (one bout) | 'chronic' (a programme)
 *   caveat       the reason not to over-read it. Every entry has one.
 */

export const TIERS = {
  A: { en: 'Meta-analysis or multiple RCTs', ko: '메타분석 또는 다수의 무작위 대조시험',
       color: '#28B487' },
  B: { en: 'One human RCT, or consistent observational evidence',
       ko: '단일 무작위 대조시험 또는 일관된 관찰연구', color: '#5EC8F2' },
  C: { en: 'Human mechanistic or imaging work, small samples',
       ko: '소규모 인체 기전·영상 연구', color: '#E9A13B' },
  D: { en: 'Animal models only', ko: '동물 실험에 한함', color: '#E2685F' },
  E: { en: 'Mechanistic inference — reasoning, not a finding',
       ko: '기전적 추론 — 발견이 아닌 논리', color: '#8b95ab' },
};

export const EXERCISE_BRAIN = {
  hippocampus_aerobic: {
    en: { claim: 'A year of aerobic walking increased anterior hippocampal volume in older adults by about 2%.',
          mechanism: 'Aerobic work raises BDNF and cerebral blood flow; the hippocampus is one of the few sites of adult neurogenesis and is unusually sensitive to both.' },
    ko: { claim: '고령자를 대상으로 한 1년간의 유산소 걷기 운동에서 전측 해마 부피가 약 2% 증가했습니다.',
          mechanism: '유산소 운동은 BDNF와 뇌혈류를 증가시키며, 해마는 성인기 신경발생이 일어나는 드문 부위로 두 요인 모두에 민감합니다.' },
    structures: [20],
    tier: 'B',
    citation: 'Erickson KI et al., PNAS 2011;108(7):3017–22',
    effect: { en: '+2.0% anterior hippocampus vs −1.4% in controls over 12 months',
              ko: '12개월간 전측 해마 +2.0%, 대조군 −1.4%' },
    population: { en: '120 sedentary adults aged 55–80', ko: '55–80세 좌식 생활 성인 120명' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'Older, sedentary adults starting from low fitness. A later meta-analysis (Firth et al., NeuroImage 2018) found no reliable effect on total hippocampal volume across trials — the left hippocampus specifically held up. Do not read this as a promise for a fit 25-year-old.',
              ko: '체력이 낮은 고령 좌식 성인이 대상입니다. 이후 메타분석(Firth 외, NeuroImage 2018)에서는 전체 해마 부피에 대한 일관된 효과가 확인되지 않았고 좌측 해마에서만 효과가 남았습니다. 건강한 25세에게 그대로 적용할 수 없습니다.' },
  },

  bdnf: {
    en: { claim: 'A single bout of aerobic exercise raises circulating BDNF, and regular training raises resting levels.',
          mechanism: 'Contracting muscle and rising cerebral blood flow drive BDNF expression; BDNF supports synaptic plasticity and survival of new neurons.' },
    ko: { claim: '한 차례의 유산소 운동만으로도 혈중 BDNF가 상승하며, 규칙적 훈련은 안정 시 수치를 높입니다.',
          mechanism: '근수축과 뇌혈류 증가가 BDNF 발현을 촉진하며, BDNF는 시냅스 가소성과 신생 뉴런의 생존을 지원합니다.' },
    structures: [20, 1],
    tier: 'A',
    citation: 'Szuhany KL, Bugatti M, Otto MW, J Psychiatr Res 2015;60:56–64 (meta-analysis, 29 studies)',
    effect: { en: 'Moderate effect on post-exercise BDNF (Hedges g ≈ 0.46 acute, 0.27 resting after training)',
              ko: '운동 후 BDNF에 중간 크기 효과 (급성 g ≈ 0.46, 훈련 후 안정 시 0.27)' },
    population: { en: 'Mixed adult samples', ko: '다양한 성인 표본' },
    species: 'human', timescale: 'acute',
    caveat: { en: 'This is BDNF in blood, not in brain. The step from serum BDNF to human cognition is largely animal work, and the peripheral–central relationship in people is not established. Treat the molecule as a plausible mediator, not as the explanation.',
              ko: '이는 혈중 BDNF이지 뇌 내 BDNF가 아닙니다. 혈청 BDNF에서 인지 기능으로 이어지는 단계는 대부분 동물 연구이며, 사람에서 말초–중추 관계는 확립되지 않았습니다. 유력한 매개 인자로만 보아야 합니다.' },
  },

  myokines: {
    en: { claim: 'IGF-1, VEGF, cathepsin B and irisin/FNDC5 are candidate messengers carrying an exercise signal from muscle to brain.',
          mechanism: 'Exercising muscle secretes signalling proteins; several cross or act on the blood–brain barrier and increase hippocampal BDNF in rodents.' },
    ko: { claim: 'IGF-1, VEGF, 카텝신 B, 이리신/FNDC5는 근육에서 뇌로 운동 신호를 전달하는 후보 물질입니다.',
          mechanism: '운동하는 근육은 신호 단백질을 분비하며, 일부는 혈뇌장벽에 작용해 설치류에서 해마 BDNF를 증가시킵니다.' },
    structures: [20],
    tier: 'D',
    citation: 'Wrann CD et al., Cell Metab 2013;18(5):649–59 (FNDC5/irisin, mice); Moon HY et al., Cell Metab 2016;24(2):332–40 (cathepsin B, mice and a small human/primate arm)',
    effect: null,
    population: { en: 'Mice, with small confirmatory human samples for cathepsin B',
                  ko: '생쥐, 카텝신 B에 한해 소규모 인체 확인 표본' },
    species: 'animal', timescale: 'chronic',
    caveat: { en: 'This is the weakest link in the popular story and the one most often told as if it were settled. The irisin literature in particular has had antibody-specificity problems. Presented here because the mechanism is genuinely interesting, not because it is established in people.',
              ko: '대중적 설명에서 가장 취약한 고리이면서 가장 자주 확정된 사실처럼 전달되는 부분입니다. 특히 이리신 연구는 항체 특이성 문제가 있었습니다. 사람에서 확립되어서가 아니라 기전이 흥미롭기 때문에 실었습니다.' },
  },

  executive_function: {
    en: { claim: 'Physical activity produces small-to-moderate improvements in executive function in children and adolescents, and cognitively engaging activity beats rote aerobic work.',
          mechanism: 'Executive control is prefrontal; activity that demands decisions, coordination and adaptation loads the same circuitry that the test measures.' },
    ko: { claim: '신체활동은 아동·청소년의 실행기능을 작게서 중간 정도 향상시키며, 인지적으로 요구가 큰 활동이 단순 유산소 운동보다 효과적입니다.',
          mechanism: '실행 통제는 전전두엽 기능이며, 판단·협응·적응을 요구하는 활동은 검사가 측정하는 바로 그 회로를 사용합니다.' },
    structures: [1, 11],
    tier: 'A',
    citation: 'Ludyga S et al., Nat Hum Behav 2020;4:603–12 (meta-analysis); Álvarez-Bueno C et al., J Am Acad Child Adolesc Psychiatry 2017;56(9):729–38',
    effect: { en: 'Small overall effect (g ≈ 0.2–0.3), larger for coordinatively demanding activity',
              ko: '전반적으로 작은 효과 (g ≈ 0.2–0.3), 협응 요구가 큰 활동에서 더 큼' },
    population: { en: 'Children and adolescents, many trial designs', ko: '아동·청소년, 다양한 시험 설계' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'Dose-response is an inverted U — more is not linearly better, and hard exercise immediately before a cognitive task can hurt performance. Acute single-bout effects are inconsistent. Publication bias in this literature is well documented.',
              ko: '용량–반응은 역U자형입니다. 많을수록 좋은 것이 아니며, 인지 과제 직전의 고강도 운동은 오히려 수행을 떨어뜨릴 수 있습니다. 단일 운동의 급성 효과는 일관되지 않습니다. 출판 편향도 잘 알려져 있습니다.' },
  },

  neural_strength: {
    en: { claim: 'The first few weeks of strength training make you stronger by changing the nervous system, before the muscle grows at all.',
          mechanism: 'Motor unit discharge rates rise, recruitment thresholds fall, and antagonist co-contraction drops. Measurable hypertrophy lags weeks behind the strength gain.' },
    ko: { claim: '근력 운동 초기 몇 주간의 근력 증가는 근육이 커지기 전에 신경계가 변화하여 일어납니다.',
          mechanism: '운동단위 발화율이 증가하고 동원 역치가 낮아지며 길항근 동시수축이 감소합니다. 측정 가능한 근비대는 근력 증가보다 몇 주 늦게 나타납니다.' },
    structures: [7, 6, 25],
    tier: 'A',
    citation: 'Moritani T, deVries HA, Am J Phys Med 1979;58(3):115–30; Del Vecchio A et al., J Physiol 2019;597(7):1873–87',
    effect: { en: 'Most of the strength gain in weeks 1–4 is neural; hypertrophy contributes measurably from around week 4–6',
              ko: '1–4주차 근력 증가의 대부분은 신경성이며, 근비대는 대략 4–6주차부터 측정 가능하게 기여합니다' },
    population: { en: 'Healthy untrained adults', ko: '건강한 비훈련 성인' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'The classic time course comes from small samples and indirect EMG measures; modern high-density EMG supports the direction while revising the details. The crossover point depends on the person and the programme.',
              ko: '고전적 시간 경과는 소규모 표본과 간접적 근전도 측정에 기반합니다. 최신 고밀도 근전도는 방향은 지지하되 세부는 수정하고 있습니다. 전환 시점은 개인과 프로그램에 따라 다릅니다.' },
  },

  cross_education: {
    en: { claim: 'Training one limb makes the untrained limb on the other side measurably stronger.',
          mechanism: 'The gain is central, not local: bilateral cortical activation during unilateral effort, and changes in interhemispheric inhibition. The untrained muscle itself does not grow.' },
    ko: { claim: '한쪽 팔다리만 훈련해도 반대쪽 훈련하지 않은 팔다리의 근력이 측정 가능하게 증가합니다.',
          mechanism: '이 증가는 국소가 아닌 중추성입니다. 편측 노력 중 양측 피질이 활성화되고 반구 간 억제가 변합니다. 훈련하지 않은 근육 자체는 커지지 않습니다.' },
    structures: [7, 23],
    tier: 'A',
    citation: 'Manca A et al., Eur J Appl Physiol 2017;117(11):2335–54 (meta-analysis, 96 studies)',
    effect: { en: 'Roughly +11–18% strength in the untrained limb, about half the trained limb’s gain',
              ko: '훈련하지 않은 쪽 근력 약 +11–18%, 훈련한 쪽 증가폭의 약 절반' },
    population: { en: 'Healthy adults, and clinically after unilateral injury', ko: '건강한 성인 및 편측 손상 후 임상 환자' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'It is a real effect and a strange one, but it is strength expressed on a test, not muscle. It does not replace training the other side.',
              ko: '실재하고 기이한 효과이지만, 근육이 아니라 검사에서 발현되는 근력입니다. 반대쪽 훈련을 대체하지 않습니다.' },
  },

  apa_timing: {
    en: { claim: 'In healthy people the deep trunk muscles fire before the limb that is about to move — and that timing is delayed in recurrent low back pain.',
          mechanism: 'The nervous system predicts the postural disturbance a movement is about to cause and pre-stiffens the trunk. It is feedforward control, issued before any sensory feedback could arrive.' },
    ko: { claim: '건강한 사람에서는 심부 체간 근육이 움직일 팔다리보다 먼저 활성화되며, 재발성 요통에서는 이 타이밍이 지연됩니다.',
          mechanism: '신경계는 움직임이 유발할 자세 교란을 예측해 체간을 미리 단단하게 만듭니다. 감각 되먹임이 도달하기 전에 발생하는 예측적 제어입니다.' },
    structures: [7, 5],
    tier: 'B',
    citation: 'Hodges PW, Richardson CA, Spine 1996;21(22):2640–50; Exp Brain Res 1997;114:362–70',
    effect: { en: 'Transversus abdominis leads the prime mover by roughly 30 ms; in low back pain the lead is lost or reversed',
              ko: '복횡근이 주동근보다 약 30 ms 선행하며, 요통에서는 이 선행이 사라지거나 역전됩니다' },
    population: { en: 'Small laboratory samples of adults with and without low back pain',
                  ko: '요통이 있는/없는 성인의 소규모 실험실 표본' },
    species: 'human', timescale: 'acute',
    caveat: { en: 'This is the single best entry point for the Pilates story and also the most over-sold. The original bilateral-brace reading has been contested: Allison and colleagues (2008) showed the response is side-specific and direction-specific, not a uniform corset. And a delayed onset is an association with pain, not a demonstrated cause of it — training the timing has not reliably outperformed general exercise in trials.',
              ko: '필라테스 설명에서 가장 좋은 출발점이자 가장 과장되기 쉬운 지점입니다. 양측이 균일하게 조여진다는 초기 해석은 반박되었습니다(Allison 외, 2008: 반응은 측성·방향 특이적). 또한 지연된 발현은 통증과의 연관이지 원인으로 입증된 것이 아니며, 타이밍 훈련이 일반 운동보다 우수하다는 결과도 일관되지 않습니다.' },
  },

  motor_learning: {
    en: { claim: 'Learning a movement moves through distinct stages and distinct structures: fast within-session gains, then slow consolidation across days and sleep.',
          mechanism: 'Prefrontal and premotor areas dominate early while the movement is still being figured out; with practice the representation shifts toward primary motor cortex, cerebellum for error correction, and basal ganglia for chunking a sequence into one unit.' },
    ko: { claim: '동작 학습은 서로 다른 단계와 구조를 거칩니다. 한 세션 내 빠른 향상 후, 여러 날과 수면에 걸친 느린 공고화가 일어납니다.',
          mechanism: '초기에는 전전두·전운동 영역이 주도하고, 연습이 쌓이면 표상이 일차운동피질, 오차 수정을 담당하는 소뇌, 순서를 하나의 덩어리로 묶는 기저핵으로 이동합니다.' },
    structures: [7, 5, 25, 1],
    tier: 'A',
    citation: 'Dayan E, Cohen LG, Neuron 2011;72(3):443–54 (review); Doyon J, Benali H, Curr Opin Neurobiol 2005;15(2):161–7',
    effect: null,
    population: { en: 'Healthy adults, motor sequence and adaptation paradigms',
                  ko: '건강한 성인, 운동 순서 및 적응 과제' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'The staged account comes largely from finger-sequence and reaching tasks in a scanner. Whole-body movement under load is not the same problem, and the mapping to a Pilates repertoire is an extrapolation.',
              ko: '단계 모형은 대체로 스캐너 안에서의 손가락 순서·도달 과제에서 나왔습니다. 부하가 실린 전신 운동은 다른 문제이며, 필라테스 동작으로의 적용은 외삽입니다.' },
  },

  external_focus: {
    en: { claim: 'Directing attention outside the body — to the effect of the movement — produces better performance and better retention than directing it at the body part.',
          mechanism: 'The constrained action hypothesis: attending to your own limb interferes with automatic control processes that run better without conscious supervision.',
    },
    ko: { claim: '주의를 신체 부위가 아니라 몸 바깥, 즉 동작의 결과로 향하게 하면 수행과 파지가 모두 좋아집니다.',
          mechanism: '제한된 행위 가설: 자기 팔다리에 주의를 두면 의식적 감독 없이 더 잘 작동하는 자동 제어 과정을 방해합니다.' },
    structures: [7, 1],
    tier: 'A',
    citation: 'Chua L-K et al., Psychol Bull 2021;147(6):618–45 (meta-analysis, 218 studies); Wulf G, Int Rev Sport Exerc Psychol 2013;6(1):77–104',
    effect: { en: 'Small-to-moderate advantage for external focus across accuracy, force production and retention',
              ko: '정확성·힘 발생·파지 전반에서 외적 초점의 작은–중간 크기 이점' },
    population: { en: 'Mostly healthy adults, laboratory and sport tasks', ko: '주로 건강한 성인, 실험실 및 스포츠 과제' },
    species: 'human', timescale: 'acute',
    caveat: { en: 'This sits in real tension with how Pilates is traditionally taught — "draw your navel to your spine" is an internal cue, and the tradition is built on them. The honest position is that the evidence favours external cues for performance while internal cues may still be useful for teaching a person to find a muscle they cannot yet feel. This app surfaces the tension rather than resolving it.',
              ko: '이는 전통적인 필라테스 지도 방식과 실제로 충돌합니다. "배꼽을 척추 쪽으로 당기세요"는 내적 단서이며 전통은 그 위에 세워져 있습니다. 정직한 입장은, 수행 측면에서는 외적 단서가 유리하지만 아직 감각을 찾지 못한 근육을 가르칠 때는 내적 단서가 유용할 수 있다는 것입니다. 이 앱은 이 긴장을 해소하지 않고 드러냅니다.' },
  },

  interoception_breath: {
    en: { claim: 'Attending to the breath engages the insula and anterior cingulate, and nasal breathing entrains oscillations in limbic structures.',
          mechanism: 'The insula is the cortical destination for signals from inside the body. Airflow through the nose rhythmically drives piriform cortex, amygdala and hippocampus in phase with the breath.' },
    ko: { claim: '호흡에 주의를 기울이면 섬엽과 전대상피질이 활성화되며, 비강 호흡은 변연계 구조의 진동을 동조시킵니다.',
          mechanism: '섬엽은 신체 내부 신호가 도달하는 피질 종착지입니다. 코를 통한 기류는 이상피질·편도체·해마를 호흡과 위상을 맞추어 리듬적으로 구동합니다.' },
    structures: [12, 11, 21, 20],
    tier: 'C',
    citation: 'Zelano C et al., J Neurosci 2016;36(49):12448–67 (7 patients with intracranial electrodes); Critchley HD et al., Nat Neurosci 2004;7(2):189–95',
    effect: { en: 'Breath-locked oscillatory entrainment; behavioural effects on fear discrimination and recall were small and nasal-specific',
              ko: '호흡에 동조된 진동; 공포 변별과 회상에 대한 행동적 효과는 작았고 비강 호흡에 한정되었습니다' },
    population: { en: 'Seven epilepsy patients with implanted electrodes, plus healthy behavioural samples',
                  ko: '전극을 삽입한 뇌전증 환자 7명 및 건강한 행동 표본' },
    species: 'human', timescale: 'acute',
    caveat: { en: 'Seven patients. This is the finding most likely to be inflated into "breathwork rewires your brain", and it does not support that. Pilates lateral costal breathing has no direct imaging evidence at all — the link from this work to that practice is inference.',
              ko: '환자 7명입니다. "호흡법이 뇌를 재배선한다"로 과장되기 가장 쉬운 연구이며, 그런 주장을 뒷받침하지 않습니다. 필라테스의 측방 흉곽 호흡에 대한 직접적 영상 근거는 전혀 없으며, 이 연구에서 그 실천으로의 연결은 추론입니다.' },
  },

  scan: {
    en: { claim: 'The motor homunculus is interrupted by regions that are not effector-specific and connect instead to networks for arousal, planning and body control.',
          mechanism: 'Precision fMRI shows inter-effector regions between the foot, hand and mouth areas of the precentral gyrus, more connected to the cingulo-opercular network than to motor cortex proper.' },
    ko: { claim: '운동 호문쿨루스는 특정 효과기에 대응하지 않고 각성·계획·신체 조절 네트워크와 연결되는 영역들에 의해 분절되어 있습니다.',
          mechanism: '정밀 fMRI에서 중심전회의 발·손·입 영역 사이에 효과기 간 영역이 나타나며, 이들은 운동피질보다 대상–덮개 네트워크와 더 강하게 연결됩니다.' },
    structures: [7, 11],
    tier: 'C',
    citation: 'Gordon EM et al., Nature 2023;617:351–9; see the exchange with Muret D, Makin TR et al. for the counter-argument',
    effect: null,
    population: { en: 'Small numbers of densely scanned individuals', ko: '고밀도 스캔한 소수 개인' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'Recent and actively contested. It is included because it is the most interesting available evidence for a real anatomical link between whole-body action control and cognitive/autonomic control — which is the claim a Pilates app most wants to make and least deserves to assert. Read it as a live scientific question, not a foundation.',
              ko: '최근 연구이며 현재 논쟁 중입니다. 전신 동작 제어와 인지·자율 조절 사이의 실제 해부학적 연결에 대한 가장 흥미로운 근거이기 때문에 실었습니다. 이는 필라테스 앱이 가장 주장하고 싶어 하면서 가장 자격이 없는 주장이기도 합니다. 토대가 아니라 진행 중인 과학적 질문으로 읽으십시오.' },
  },

  balance_cerebellum: {
    en: { claim: 'Balance and coordination training changes cerebellar and cortical grey matter, and improves postural control in older adults.',
          mechanism: 'The cerebellum computes the error between the movement predicted and the movement that happened. Training that repeatedly generates and corrects that error is training the structure that does the correcting.' },
    ko: { claim: '균형·협응 훈련은 소뇌와 피질 회백질을 변화시키고 고령자의 자세 조절을 향상시킵니다.',
          mechanism: '소뇌는 예측된 움직임과 실제 움직임의 오차를 계산합니다. 그 오차를 반복적으로 만들고 교정하는 훈련은 교정을 담당하는 구조 자체를 훈련하는 것입니다.' },
    structures: [5, 8],
    tier: 'B',
    citation: 'Taubert M et al., J Neurosci 2010;30(35):11670–7; Lesinski M et al., Sports Med 2015;45(12):1721–38 (meta-analysis, balance training in older adults)',
    effect: { en: 'Moderate-to-large improvement in static and dynamic balance measures in older adults',
              ko: '고령자의 정적·동적 균형 지표에서 중간–큰 크기의 향상' },
    population: { en: 'Healthy adults; the balance meta-analysis is specifically older adults',
                  ko: '건강한 성인. 균형 메타분석은 고령자 대상' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'Structural MRI changes over weeks are small and their functional meaning is debated. The balance improvement is solid; the grey-matter story attached to it is much softer.',
              ko: '몇 주에 걸친 구조적 MRI 변화는 작고 그 기능적 의미는 논쟁 중입니다. 균형 향상은 확고하지만, 여기 덧붙는 회백질 이야기는 훨씬 약합니다.' },
  },

  /* ------------------------------------------------------------------------------------
   * The claims yoga makes that the aerobic and strength literature does not cover. These
   * are the ones a yoga app is most tempted to overstate, so each carries the specific
   * reason not to.
   */

  slow_breathing_hrv: {
    en: { claim: 'Breathing slowly, at around six breaths a minute, raises heart rate variability and shifts autonomic balance toward the parasympathetic side while it is happening.',
          mechanism: 'At roughly 0.1 Hz the breathing rhythm resonates with the baroreflex, so blood pressure oscillations and respiratory sinus arrhythmia line up and amplify each other. Vagal outflow to the heart rises with it.' },
    ko: { claim: '분당 약 6회로 느리게 호흡하면 그 동안 심박변이도가 증가하고 자율신경 균형이 부교감 쪽으로 이동합니다.',
          mechanism: '약 0.1 Hz에서 호흡 리듬이 압수용체 반사와 공명해 혈압 진동과 호흡성 동성 부정맥이 위상을 맞추며 서로를 증폭시킵니다. 이에 따라 심장으로 가는 미주신경 출력이 증가합니다.' },
    structures: [6, 12],
    tier: 'B',
    citation: 'Lehrer PM, Gevirtz R, Front Psychol 2014;5:756; Laborde S et al., Neurosci Biobehav Rev 2022;138:104711 (meta-analysis of slow-paced breathing)',
    effect: { en: 'Moderate increase in vagally-mediated HRV during and shortly after paced breathing (g ≈ 0.5)',
              ko: '조절 호흡 중과 직후 미주신경 매개 심박변이도의 중간 크기 증가 (g ≈ 0.5)' },
    population: { en: 'Healthy adults across many small trials', ko: '다수의 소규모 시험에 참여한 건강한 성인' },
    species: 'human', timescale: 'acute',
    caveat: { en: 'This is a state, not a trait: the effect is largest while you are breathing that way and shrinks afterwards. Higher HRV during a practice is not evidence that the practice made you a calmer person, and HRV itself is a noisy proxy for "vagal tone" rather than a measurement of it.',
              ko: '이는 특성이 아니라 상태입니다. 효과는 그렇게 호흡하는 동안 가장 크고 이후 줄어듭니다. 수련 중 심박변이도가 높다는 것이 그 수련이 당신을 더 차분한 사람으로 만들었다는 근거는 아니며, 심박변이도 자체도 "미주신경 긴장도"의 정밀한 측정이 아니라 잡음이 많은 대리 지표입니다.' },
  },

  stretch_tolerance: {
    en: { claim: 'Most of the range of motion gained from stretching is increased tolerance to the sensation, not a longer muscle.',
          mechanism: 'Passive torque at a given joint angle changes little over weeks of stretching, while the angle at which the stretch becomes intolerable moves. The change is in how the nervous system interprets and permits the position.' },
    ko: { claim: '스트레칭으로 얻는 가동범위 증가의 대부분은 근육이 길어진 것이 아니라 감각에 대한 내성이 커진 것입니다.',
          mechanism: '몇 주간의 스트레칭에도 특정 관절 각도에서의 수동 토크는 거의 변하지 않는 반면, 견딜 수 없어지는 각도는 이동합니다. 변화는 신경계가 그 자세를 해석하고 허용하는 방식에 있습니다.' },
    structures: [8, 12],
    tier: 'B',
    citation: 'Weppler CH, Magnusson SP, Phys Ther 2010;90(3):438–49; Freitas SR et al., Scand J Med Sci Sports 2018;28(3):794–806 (systematic review)',
    effect: { en: 'Range increases substantially; passive stiffness at matched angles changes little over programmes under about eight weeks',
              ko: '가동범위는 크게 증가하지만, 동일 각도에서의 수동 강성은 약 8주 이하 프로그램에서 거의 변하지 않습니다' },
    population: { en: 'Healthy adults, mostly hamstring and calf protocols', ko: '건강한 성인, 주로 햄스트링·종아리 프로토콜' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'It does not mean tissue never adapts — longer, heavier or loaded protocols do change muscle architecture. It means the fast gains a class produces are a nervous-system change, and describing them as "lengthening the muscle" is describing the wrong organ.',
              ko: '조직이 결코 적응하지 않는다는 뜻은 아닙니다. 더 길고 무겁거나 부하가 실린 프로토콜은 근육 구조를 바꿉니다. 다만 수업에서 즉시 얻는 변화는 신경계의 변화이며, 그것을 "근육을 늘렸다"고 설명하는 것은 다른 기관을 가리키는 것입니다.' },
  },

  yoga_affect: {
    en: { claim: 'Yoga programmes produce small-to-moderate reductions in depressive and anxiety symptoms compared with waitlist or usual care.',
          mechanism: 'Plausibly several things at once: the exercise component, the paced-breathing component, attentional training, and the non-specific effects of a scheduled group activity. No trial has isolated which one is doing the work.' },
    ko: { claim: '요가 프로그램은 대기자 대조군이나 통상 치료와 비교해 우울·불안 증상을 작거나 중간 정도로 감소시킵니다.',
          mechanism: '운동 요소, 조절 호흡, 주의 훈련, 그리고 정기적 집단 활동의 비특이적 효과가 동시에 작용하는 것으로 보입니다. 어느 요소가 작용하는지 분리한 시험은 없습니다.' },
    structures: [21, 11, 12],
    tier: 'B',
    citation: 'Cramer H et al., Depress Anxiety 2013;30(11):1068–83; Brinsley J et al., Br J Sports Med 2021;55(17):992–1000 (meta-analysis, 19 trials)',
    effect: { en: 'Standardised mean difference around −0.4 for depressive symptoms vs waitlist',
              ko: '대기자 대조군 대비 우울 증상 표준화 평균차 약 −0.4' },
    population: { en: 'Adults with depressive symptoms; most trials are small and short', ko: '우울 증상이 있는 성인. 대부분 소규모·단기 시험' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'Blinding is impossible and the comparator is usually waitlist, which inflates effect sizes. Against an active control — other exercise, or a stretching class — the advantage largely disappears. This is evidence that yoga helps, not evidence that yoga helps more than moving in some other way.',
              ko: '맹검이 불가능하고 비교군이 대개 대기자여서 효과 크기가 과대평가됩니다. 다른 운동이나 스트레칭 수업 같은 능동 대조군과 비교하면 이점은 대부분 사라집니다. 요가가 도움이 된다는 근거이지, 다른 방식으로 움직이는 것보다 낫다는 근거는 아닙니다.' },
  },

  body_schema: {
    en: { claim: 'Practising unfamiliar postures updates the body schema — the brain’s running model of where the body’s parts are — in posterior parietal cortex.',
          mechanism: 'Posterior parietal areas integrate proprioceptive, visual and vestibular input into a single estimate of body configuration. Repeatedly placing the body in configurations it has no stored estimate for is what forces that estimate to be rebuilt.' },
    ko: { claim: '익숙하지 않은 자세를 반복하면 후두정피질에 있는 신체도식, 즉 뇌가 유지하는 신체 각 부분의 위치 모델이 갱신됩니다.',
          mechanism: '후두정 영역은 고유감각·시각·전정 입력을 통합해 신체 배치에 대한 단일 추정치를 만듭니다. 저장된 추정치가 없는 배치에 몸을 반복적으로 놓는 것이 그 추정치를 다시 만들게 하는 요인입니다.' },
    structures: [2, 14, 8],
    tier: 'C',
    citation: 'Medina J, Coslett HB, Neuropsychologia 2010;48(3):645–54; Villemure C et al., Cereb Cortex 2014;24(10):2732–40 (insular grey matter in yoga practitioners)',
    effect: { en: 'Cross-sectional grey-matter differences in practitioners; no controlled longitudinal effect size available',
              ko: '수련자에서의 횡단적 회백질 차이. 통제된 종단 효과 크기는 없음' },
    population: { en: 'Small imaging samples; the yoga comparison is cross-sectional',
                  ko: '소규모 영상 표본. 요가 비교는 횡단 연구' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'The practitioner-versus-control imaging design cannot tell you whether practice built the difference or whether people with that brain take up the practice. It is the single most over-cited design in this literature and it does not support a causal sentence.',
              ko: '수련자와 대조군을 비교하는 영상 설계는 수련이 차이를 만들었는지, 그런 뇌를 가진 사람이 수련을 시작하는지를 구분하지 못합니다. 이 분야에서 가장 과도하게 인용되는 설계이며 인과 문장을 지지하지 않습니다.' },
  },

  default_mode: {
    en: { claim: 'Sustained attention practice is associated with reduced default-mode network activity and less mind-wandering.',
          mechanism: 'The default-mode network is most active when attention is not on a task, and its activity tracks self-referential thought. Practices that repeatedly return attention to a target — the breath, the sensation of a position — reduce time spent in that mode.' },
    ko: { claim: '지속적 주의 수련은 기본모드망 활동 감소 및 마음의 방황 감소와 연관됩니다.',
          mechanism: '기본모드망은 주의가 과제에 놓이지 않을 때 가장 활발하며 그 활동은 자기참조적 사고를 반영합니다. 호흡이나 자세의 감각 같은 대상으로 주의를 반복적으로 되돌리는 수련은 그 모드에 머무는 시간을 줄입니다.' },
    structures: [11, 15, 1],
    tier: 'C',
    citation: 'Brewer JA et al., PNAS 2011;108(50):20254–9; Fox KCR et al., Neurosci Biobehav Rev 2016;65:208–28 (meta-analysis of meditation neuroimaging)',
    effect: { en: 'Consistent direction across studies; individual effect sizes small and heterogeneous',
              ko: '연구 간 방향은 일관되나 개별 효과 크기는 작고 이질적' },
    population: { en: 'Experienced meditators and short-course novices, small samples',
                  ko: '숙련 수련자 및 단기 과정 초심자, 소규모 표본' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'Most of this is meditation research, not yoga asana research, and the transfer between them is assumed rather than demonstrated. Reverse inference is also a live problem: less default-mode activity does not by itself mean a quieter mind.',
              ko: '대부분 요가 아사나가 아니라 명상 연구이며, 둘 사이의 전이는 입증이 아니라 가정입니다. 역추론 문제도 있습니다. 기본모드 활동이 줄었다는 것 자체가 마음이 고요해졌다는 뜻은 아닙니다.' },
  },

  sleep_quality: {
    en: { claim: 'Regular exercise improves self-reported sleep quality, with mind–body practices showing effects comparable to aerobic training.',
          mechanism: 'Candidate routes include body-temperature rhythm, adenosine accumulation, reduced pre-sleep arousal and a more regular daily schedule. Which one dominates is not established.' },
    ko: { claim: '규칙적인 운동은 주관적 수면의 질을 개선하며, 심신 수련은 유산소 훈련과 비슷한 크기의 효과를 보입니다.',
          mechanism: '체온 리듬, 아데노신 축적, 수면 전 각성 감소, 더 규칙적인 일과 등이 후보 경로입니다. 어느 것이 주된 경로인지는 확립되지 않았습니다.' },
    structures: [6, 22],
    tier: 'A',
    citation: 'Kredlow MA et al., J Behav Med 2015;38(3):427–49 (meta-analysis, 66 studies); Wang WL et al., BMC Psychiatry 2020;20:195 (mind–body exercise and sleep, meta-analysis)',
    effect: { en: 'Small-to-moderate improvement in sleep quality scores (g ≈ 0.3–0.5)',
              ko: '수면의 질 점수에서 작거나 중간 크기의 개선 (g ≈ 0.3–0.5)' },
    population: { en: 'Mixed adult samples, including people with sleep complaints',
                  ko: '수면 문제를 가진 사람을 포함한 다양한 성인 표본' },
    species: 'human', timescale: 'chronic',
    caveat: { en: 'Almost all of it is questionnaire data. Where sleep is measured objectively with polysomnography or actigraphy the effects are much smaller, which is the usual pattern when a subjective and an objective measure disagree.',
              ko: '거의 전부가 설문 자료입니다. 수면다원검사나 활동기록계로 객관적으로 측정하면 효과는 훨씬 작아지며, 이는 주관적 지표와 객관적 지표가 어긋날 때 흔히 나타나는 양상입니다.' },
  },
};

/** Every claim that names a brain region, grouped by that region. */
export function claimsForRegion(id) {
  return Object.entries(EXERCISE_BRAIN)
    .filter(([, c]) => c.structures.includes(+id))
    .map(([key, c]) => ({ key, ...c }));
}

export const TIER_ORDER = ['A', 'B', 'C', 'D', 'E'];
