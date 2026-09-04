/**
 * MOVEMENT_PATHWAY — intention to contraction, and the sensory loop back.
 *
 * This is the direct analogue of neurolab's PATHWAYS, which drew arcs between brain regions
 * for the journey of a word. Here the journey is longer: it leaves the brain, travels the
 * cord, reaches the muscle, and comes back.
 *
 * **Inside the skull the arcs are a diagram; outside it they are anatomy.**
 *
 * BodyParts3D has no peripheral nervous system, so the first version of this drew the whole
 * route as a labelled schematic. It no longer has to below the neck: Z-Anatomy carries the
 * real nerves as bevelled curves, `scripts/build_nervous.py` registers them into the body
 * frame, and a step can now anchor to an actual named nerve rather than to a curve drawn
 * between two endpoints. What is still schematic is the part inside the brain — the
 * corticospinal tract and the ascending columns are drawn as arcs between measured region
 * centroids, exactly as neurolab's word pathways were, because this model carries no
 * tractography. The UI says which is which.
 *
 * `at` is where a step lives:
 *   { region: id }      a brain region in the brain model — arc to the next step is schematic
 *   { level: 'C5' }     a vertebral level, resolved to that vertebra's centroid
 *   { muscle: 'name' }  a muscle in the body model
 *   { nerve: 'name' }   a real nerve from the nervous layer, with its own geometry
 */

export const MOVEMENT_PATHWAY = {
  descending: {
    en: { name: 'Intention to contraction',
          intro: 'The command side. Every deliberate movement starts as a plan and ends as a muscle fibre shortening, and it passes through these places on the way.' },
    ko: { name: '의도에서 수축까지',
          intro: '명령 경로입니다. 모든 의도적 움직임은 계획으로 시작해 근섬유의 수축으로 끝나며, 그 사이 이 지점들을 지나갑니다.' },
    color: '#4C8DF6',
    steps: [
      { at: { region: 1 },
        en: { title: 'Plan', text: 'Supplementary motor area and pre-SMA assemble the sequence before anything moves. In this model they sit inside the frontal lobe parcel — the Desikan-Killiany atlas does not separate them, and this app does not pretend otherwise.' },
        ko: { title: '계획', text: '보조운동영역과 전보조운동영역이 움직임 이전에 순서를 구성합니다. 이 모델에서는 전두엽 구획 안에 포함되어 있습니다. Desikan-Killiany 아틀라스는 이들을 분리하지 않으며, 이 앱도 분리된 척하지 않습니다.' } },
      { at: { region: 7 },
        en: { title: 'Command', text: 'Primary motor cortex. The precentral gyrus, arranged as the motor homunculus — although recent precision imaging shows that map is interrupted by regions belonging to a different network entirely.' },
        ko: { title: '명령', text: '일차운동피질. 중심전회이며 운동 호문쿨루스로 배열됩니다. 다만 최근 정밀 영상은 이 지도가 전혀 다른 네트워크에 속하는 영역들로 분절되어 있음을 보여 줍니다.' } },
      { at: { region: 6 },
        en: { title: 'Decussation', text: 'The corticospinal tract descends through the internal capsule and brainstem. About 85% of fibres cross to the other side at the medulla — which is why the left hemisphere moves the right side of the body.' },
        ko: { title: '교차', text: '피질척수로가 내섬유막과 뇌간을 따라 하행합니다. 약 85%의 섬유가 연수에서 반대편으로 교차하며, 좌반구가 오른쪽 몸을 움직이는 이유입니다.' } },
      { at: { nerve: 'spinal cord' },
        en: { title: 'Anterior horn', text: 'The tract synapses onto the alpha motor neuron in the anterior horn of the cord, at the segment that supplies the target muscle. This is the final common path — every command to that muscle, voluntary or reflex, goes through this cell.' },
        ko: { title: '전각', text: '피질척수로가 목표 근육을 지배하는 분절의 척수 전각에서 알파운동뉴런과 시냅스합니다. 최종 공통 경로이며, 그 근육으로 가는 모든 명령은 수의적이든 반사적이든 이 세포를 지나갑니다.' } },
      { at: { nerve: 'spinal nerve roots' },
        en: { title: 'Root and ramus', text: 'The axon leaves through the anterior root at its own segment. Those root levels are what a muscle entry lists under nerve supply, and they are why a lesion at one level weakens a specific set of muscles rather than a limb.' },
        ko: { title: '신경근과 분지', text: '축삭은 해당 분절의 전근을 통해 나갑니다. 근육 항목의 신경 지배에 표시된 분절이 바로 이것이며, 한 분절의 병변이 팔다리 전체가 아니라 특정 근육군을 약화시키는 이유입니다.' } },
      { at: { nerve: 'sacral plexus' },
        en: { title: 'Plexus', text: 'Roots recombine in a plexus before becoming named nerves, which is why one named nerve carries fibres from several segments and one segment reaches several nerves.' },
        ko: { title: '신경총', text: '신경근은 명명된 신경이 되기 전에 신경총에서 재조합됩니다. 하나의 신경이 여러 분절의 섬유를 나르고, 하나의 분절이 여러 신경에 닿는 이유입니다.' } },
      { at: { muscle: null },
        en: { title: 'Neuromuscular junction', text: 'The motor neuron releases acetylcholine onto the muscle fibre. One motor neuron and every fibre it supplies is a motor unit, and it is all-or-none: the nervous system grades force by choosing how many units to recruit and how fast to fire them.' },
        ko: { title: '신경근접합부', text: '운동뉴런이 근섬유에 아세틸콜린을 분비합니다. 하나의 운동뉴런과 그것이 지배하는 모든 섬유가 하나의 운동단위이며 실무율적으로 작동합니다. 신경계는 몇 개의 단위를 동원하고 얼마나 빠르게 발화할지로 힘을 조절합니다.' } },
    ],
  },

  ascending: {
    en: { name: 'What the body reports back',
          intro: 'The sensory side, and the reason movement is a loop rather than a broadcast. The muscle tells the brain what actually happened, and the difference between that and what was predicted is what learning is made of.' },
    ko: { name: '몸이 보고하는 것',
          intro: '감각 경로이며, 움직임이 일방적 송출이 아니라 순환인 이유입니다. 근육은 실제로 일어난 일을 뇌에 알리고, 예측과의 차이가 학습의 재료가 됩니다.' },
    color: '#28B487',
    steps: [
      { at: { muscle: null },
        en: { title: 'Muscle spindle', text: 'Stretch receptors inside the muscle belly report length and rate of change. The Golgi tendon organ, at the musculotendinous junction, reports tension instead.' },
        ko: { title: '근방추', text: '근복 내 신장 수용기가 길이와 변화 속도를 보고합니다. 근건 접합부의 골지건기관은 대신 장력을 보고합니다.' } },
      { at: { nerve: 'spinal nerve roots' },
        en: { title: 'Dorsal root', text: 'Sensory fibres enter the cord through the dorsal root — cell bodies sit outside the cord in the dorsal root ganglion. Proprioceptive fibres are among the fastest in the body.' },
        ko: { title: '후근', text: '감각섬유가 후근을 통해 척수로 들어갑니다. 세포체는 척수 밖 후근신경절에 있습니다. 고유감각 섬유는 인체에서 가장 빠른 축에 속합니다.' } },
      { at: { nerve: 'spinal cord' },
        en: { title: 'Dorsal column', text: 'Proprioception ascends the back of the cord on the same side it entered, and does not cross until the medulla.' },
        ko: { title: '후주', text: '고유감각은 들어온 쪽과 같은 편의 척수 후방을 따라 올라가며, 연수에 이르러서야 교차합니다.' } },
      { at: { region: 22 },
        en: { title: 'Thalamus', text: 'The dorsal column–medial lemniscus pathway carries proprioception up the back of the cord, crosses in the medulla, and relays in the thalamus. Almost everything reaching cortex is relayed here first.' },
        ko: { title: '시상', text: '후주–내측섬유대 경로가 고유감각을 척수 후방으로 올려 보내고 연수에서 교차한 뒤 시상에서 중계됩니다. 피질에 도달하는 거의 모든 정보가 여기를 먼저 거칩니다.' } },
      { at: { region: 8 },
        en: { title: 'Somatosensory cortex', text: 'The postcentral gyrus builds the body map. This is where position sense becomes something you can report — the sense that lets you find your own hand with your eyes closed.' },
        ko: { title: '체성감각피질', text: '중심후회가 신체 지도를 만듭니다. 위치 감각이 보고 가능한 경험이 되는 곳이며, 눈을 감고도 자기 손을 찾을 수 있게 하는 감각입니다.' } },
      { at: { region: 5 },
        en: { title: 'Cerebellar correction', text: 'The cerebellum receives a copy of the command and the sensory result, and computes the error between them. That error signal is what makes the next repetition different from this one.' },
        ko: { title: '소뇌의 오차 수정', text: '소뇌는 명령의 사본과 감각 결과를 함께 받아 둘 사이의 오차를 계산합니다. 그 오차 신호가 다음 반복을 이번과 다르게 만듭니다.' } },
    ],
  },

  interoceptive: {
    en: { name: 'Breath and the inside of the body',
          intro: 'The third loop, and the one Pilates leans on hardest. Signals from inside the body — breath, effort, the state of the viscera — arrive somewhere different from touch and position.' },
    ko: { name: '호흡과 몸 안쪽',
          intro: '세 번째 회로이며 필라테스가 가장 크게 기대는 부분입니다. 호흡, 노력감, 내장 상태 등 몸 안쪽에서 오는 신호는 촉각·위치감각과는 다른 곳에 도달합니다.' },
    color: '#C9A227',
    steps: [
      { at: { muscle: 'diaphragm' },
        en: { title: 'Diaphragm', text: 'Driven by the phrenic nerve from C3, C4 and C5 — a cervical nerve supplying a muscle at the bottom of the ribcage, because the diaphragm develops in the neck and migrates down.' },
        ko: { title: '횡격막', text: 'C3, C4, C5에서 나오는 횡격신경이 지배합니다. 경추 신경이 흉곽 바닥의 근육을 지배하는 이유는 횡격막이 목에서 발생해 아래로 이동하기 때문입니다.' } },
      // Z-Anatomy has no curve group that resolves to a cervical plexus, so this step falls
      // back to the vertebral level it arises from — a real bone rather than a nerve that
      // was not built. build_nervous.py prints what it did find.
      { at: { level: 'C4' },
        en: { title: 'Phrenic origin', text: 'C3, 4, 5 keeps the diaphragm alive. A cord injury above this level takes breathing with it, which is why the level matters clinically.' },
        ko: { title: '횡격신경 기시부', text: 'C3, 4, 5가 횡격막을 살립니다. 이 높이 위쪽의 척수 손상은 호흡까지 앗아가며, 그래서 이 분절이 임상적으로 중요합니다.' } },
      { at: { region: 6 },
        en: { title: 'Brainstem rhythm', text: 'The respiratory rhythm is generated in the medulla and runs without you. Voluntary control is layered on top of it, not instead of it.' },
        ko: { title: '뇌간 리듬', text: '호흡 리듬은 연수에서 생성되며 의식 없이 작동합니다. 수의적 조절은 그것을 대체하는 것이 아니라 그 위에 덧입혀집니다.' } },
      { at: { region: 12 },
        en: { title: 'Insula', text: 'The cortical destination for signals from inside the body. Attention to the breath engages it, and it is the best current candidate for where "how effortful this feels" is constructed.' },
        ko: { title: '섬엽', text: '몸 안쪽 신호가 도달하는 피질 종착지입니다. 호흡에 대한 주의가 이곳을 활성화하며, "얼마나 힘든지"라는 느낌이 만들어지는 곳으로 현재 가장 유력한 후보입니다.' } },
      { at: { region: 11 },
        en: { title: 'Anterior cingulate', text: 'Works with the insula on the effort-and-salience side: how much this matters and how much it is costing. Also the region the somato-cognitive action network connects to.' },
        ko: { title: '전대상피질', text: '섬엽과 함께 노력과 현저성을 담당합니다. 이것이 얼마나 중요하고 얼마나 비용이 드는지를 다룹니다. 체성–인지 행위 네트워크가 연결되는 영역이기도 합니다.' } },
    ],
  },
};

export const PATHWAY_KEYS = Object.keys(MOVEMENT_PATHWAY);
