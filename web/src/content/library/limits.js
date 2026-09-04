/**
 * What the rig cannot show, in the rig's own words.
 *
 * These are notes about the *model*, not about the exercise, and they are what an entry says
 * instead of quietly drawing something that is not the pose.
 *
 * They used to include two range clamps — arms stopping at 90 degrees of shoulder flexion, a
 * tuck stopping at 120 of knee — and those are gone, because they were never anatomy. They
 * were Rajagopal's gait-simulation limits: the model was built to walk, and walking does none
 * of those things. `parse_opensim.py` now gives those coordinates published goniometric
 * ranges instead and records, per coordinate, which of the two it got. What remains here is
 * structural: joints the model does not have, and contacts its two legs cannot make.
 *
 * A note that carries `belowFloor: true` is saying, in words a reader sees, that some part of
 * the figure ends up under the floor its contacts define. That is the one thing the geometry
 * tests otherwise refuse outright — a pose sunk through the mat is normally a sign the angles
 * are wrong — so the marker is what lets a documented limit through, and nothing else does.
 * Do not add it to make a failing pose pass: add it when the note next to it already explains,
 * in both languages, which range the model is short of and what that costs the picture.
 */

export const SHOULDER_RHYTHM = {
  en: 'The arms reach overhead through one joint rather than two. A real shoulder gets about 180 degrees of elevation from roughly 120 at the glenohumeral joint plus 60 from the scapula rotating on the ribcage, and this model has no scapula — its shoulder is a single three-degree-of-freedom ball. The reach is drawn at the published total, so the hand ends up where it belongs; what is missing is the scapular half of how it got there, which is also why the shoulder blade does not move on the back.',
  ko: '팔은 두 개가 아니라 하나의 관절로 머리 위에 도달합니다. 실제 어깨의 약 180도 거상은 견관절에서 약 120도, 견갑골이 흉곽 위에서 회전하며 약 60도가 더해져 만들어지지만, 이 모델에는 견갑골이 없고 어깨는 3자유도 볼 관절 하나입니다. 도달 범위는 공표된 총합으로 그려져 손의 최종 위치는 맞지만, 거기에 이르는 견갑골의 몫이 빠져 있습니다. 등에서 견갑골이 움직이지 않는 이유도 같습니다.',
};

export const APPARATUS_CAP = {
  en: 'The apparatus is not modelled. Springs, straps and a moving carriage change the load and the direction of resistance at every point in the movement, and none of that is represented here — what you see is the body doing the joint motion the exercise asks for, unloaded.',
  ko: '기구는 모델에 포함되어 있지 않습니다. 스프링, 스트랩, 움직이는 캐리지는 동작의 매 지점에서 부하와 저항 방향을 바꾸지만 그중 어떤 것도 여기 반영되어 있지 않습니다. 보이는 것은 그 운동이 요구하는 관절 움직임을 부하 없이 수행하는 몸입니다.',
};

export const SEQUENCE_CAP = {
  en: 'A salutation is a sequence, not a shape. The clip travels between two of its positions and holds the tempo of the whole round; it does not step through every posture in order. Each of those postures has its own entry in the library, with its own muscle attributions and its own clip.',
  ko: '경배 자세는 하나의 형태가 아니라 시퀀스입니다. 이 클립은 시퀀스의 두 지점 사이를 오가며 전체 라운드의 속도를 유지할 뿐, 모든 자세를 순서대로 거치지는 않습니다. 각 자세는 라이브러리에 자체 항목과 근육 배정, 자체 클립을 가지고 있습니다.',
  // the clip travels between two of the sequence's positions, so the actions it names
  // include ones that belong to the postures in between
  sequence: true,
};

export const FULL_SPLIT = {
  en: 'The back leg does not lie down. A full front split needs about ninety degrees of hip extension behind, and this model publishes thirty — normal adult goniometry, which is what a hip gives before the pelvis starts tipping with it. The front leg reaches the floor and the shape is drawn to the deepest angle the model has, so the joint angles you see are real; what is missing is the last sixty degrees behind, which is why the back knee hangs below the pelvis instead of resting on the mat.',
  ko: '뒷다리가 바닥에 눕지 않습니다. 완전한 앞뒤 스플릿에는 뒤쪽 고관절 신전이 약 90도 필요하지만 이 모델이 공표하는 범위는 30도입니다. 정상 성인 관절가동범위 측정값이며, 골반이 함께 기울기 전까지 고관절이 내주는 만큼입니다. 앞다리는 바닥에 닿고 자세는 모델이 가진 가장 깊은 각도로 그려지므로 보이는 관절 각도는 실제 값입니다. 빠진 것은 뒤쪽 마지막 60도이며, 그래서 뒷무릎이 매트에 놓이지 못하고 골반보다 아래에 남습니다.',
  belowFloor: true,
};

export const CROSS_LEGS = {
  en: 'The shins do not cross. The two legs are separate chains in this model and cannot pass through each other, and hip adduction stops at the midline, so the shins point forward and outward instead of folding one over the other. The hip and knee angles are right; what is missing is the crossing itself, which leaves the ankles sitting lower than they would on a floor.',
  ko: '정강이가 교차하지 않습니다. 이 모델에서 두 다리는 별개의 사슬이라 서로를 통과할 수 없고 고관절 내전은 정중선에서 멈춥니다. 따라서 정강이는 서로 포개지지 않고 앞·바깥으로 향합니다. 고관절과 무릎 각도는 정확하며, 빠진 것은 교차 자체입니다. 그 때문에 발목이 실제 바닥에서보다 낮게 놓입니다.',
  belowFloor: true,
};

export const PIGEON_ROTATION = {
  en: 'The front shin does not lie across the mat. A pigeon lays it there by turning the front hip out about seventy degrees, and this model publishes forty-five — normal adult goniometry, which is what a hip gives before the pelvis turns with it. The hip is drawn at the deepest turn and the widest opening the model has, so the angles you see are real; what is missing is the last twenty-five degrees of turn, which is why the shin stays angled and the front foot sits above the mat rather than on it.',
  ko: '앞다리 정강이가 매트를 가로질러 눕지 않습니다. 비둘기 자세는 앞쪽 고관절을 약 70도 외회전시켜 정강이를 눕히지만 이 모델이 공표하는 범위는 45도입니다. 정상 성인 관절가동범위 측정값이며, 골반이 함께 돌아가기 전까지 고관절이 내주는 만큼입니다. 고관절은 모델이 가진 가장 깊은 외회전과 가장 넓은 벌림으로 그려지므로 보이는 각도는 실제 값입니다. 빠진 것은 마지막 25도의 회전이며, 그래서 정강이가 비스듬히 남고 앞발이 매트에 닿지 못한 채 떠 있습니다.',
  belowFloor: true,
};
