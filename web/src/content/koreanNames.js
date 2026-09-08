/**
 * KO_NAME — the Korean name of every structure nobody wrote an entry for.
 *
 * The studio this is built for teaches in Korean. Three hundred and thirty-nine of
 * the four hundred and forty-nine structures in the body had no Korean name at all:
 * every bone, every organ, every nerve and ninety-seven muscles fell back to
 * `titleCase(name)` in `structures.js`, which is to say to English. On screen that
 * is a label a coach cannot read; in the search box it is worse, because
 * `structureText()` indexes `name.ko` and the fallback made it a copy of `name.en` —
 * so typing 요추 matched nothing while typing "lumbar" matched five vertebrae.
 *
 * This file is names only. What a structure *is* comes from KIND_OVERVIEW in
 * help.js, which already reads in both languages, and what it belongs to comes from
 * the ontology groups. A name is the part that has to be right for the thing to be
 * findable at all, and it is the part that can be written for all of them.
 *
 * ## Register
 *
 * Sino-Korean throughout (대퇴골, 요추, 견갑골), matching MUSCLE_INFO, the group
 * names in groups.js and how Korean clinical practice actually writes them — not
 * the revised native-Korean forms (넙다리뼈, 허리뼈, 어깨뼈). One register per
 * atlas: a coach who searches 요추 and a coach who searches 허리뼈 cannot both be
 * served by a substring match, and the Sino forms are the ones a Korean Pilates
 * qualification is taught in.
 *
 * ## Where two structures share one Sino name
 *
 * Hangul drops the Chinese characters that used to separate them, so a few
 * genuinely distinct structures collide. Each is resolved here rather than left to
 * chance, and `content.test.mjs` fails if any two structures end up with the
 * same Korean name:
 *
 *   - 관골 is both 寛骨 (hip bone) and 顴骨 (zygomatic bone). The hip bone keeps it,
 *     because it is the one a Pilates studio cues; the zygomatic bone takes 협골,
 *     which is a standard alternative. The two facial muscles keep 대관골근 and
 *     소관골근, which have no alternative.
 *   - 비골 is both 腓骨 (fibula) and 鼻骨 (nasal bone). The fibula keeps it — 비골골절
 *     means a broken fibula to every Korean clinician — and the nasal bone, which
 *     no movement class has ever named, takes the plain 코뼈.
 *   - 주상골 (舟狀骨) is the scaphoid of the wrist and the navicular of the foot.
 *     Both are qualified: 수근 주상골, 족근 주상골.
 *   - Hand and foot share 무지 (thumb/big toe) and 소지 (little finger/little toe),
 *     so muscles that exist in both are qualified 수부 or 족부. Where only one exists
 *     — 무지외전근 in the foot, 지신근 in the hand — it is left unqualified, as the
 *     entries already in MUSCLE_INFO have it.
 *
 * Terms follow the Korean Medical Association's anatomical terminology (대한의사협회
 * 의학용어집) and 대한해부학회, 해부학용어 6th ed.
 */

export const KO_NAME = {

  /* ------------------------------------------------------------------ spine */
  'atlas': '환추',
  'axis': '축추',
  'third cervical vertebra': '제3경추',
  'fourth cervical vertebra': '제4경추',
  'fifth cervical vertebra': '제5경추',
  'sixth cervical vertebra': '제6경추',
  'seventh cervical vertebra': '제7경추',
  'first thoracic vertebra': '제1흉추',
  'second thoracic vertebra': '제2흉추',
  'third thoracic vertebra': '제3흉추',
  'fourth thoracic vertebra': '제4흉추',
  'fifth thoracic vertebra': '제5흉추',
  'sixth thoracic vertebra': '제6흉추',
  'seventh thoracic vertebra': '제7흉추',
  'eighth thoracic vertebra': '제8흉추',
  'ninth thoracic vertebra': '제9흉추',
  'tenth thoracic vertebra': '제10흉추',
  'eleventh thoracic vertebra': '제11흉추',
  'twelfth thoracic vertebra': '제12흉추',
  'first lumbar vertebra': '제1요추',
  'second lumbar vertebra': '제2요추',
  'third lumbar vertebra': '제3요추',
  'fourth lumbar vertebra': '제4요추',
  'fifth lumbar vertebra': '제5요추',
  'sacrum': '천골',

  /* The disc is named for the vertebra above it, the way the build emits it. */
  'intervertebral disk of axis': '축추 추간판',
  'intervertebral disk of third cervical vertebra': '제3경추 추간판',
  'intervertebral disk of fourth cervical vertebra': '제4경추 추간판',
  'intervertebral disk of fifth cervical vertebra': '제5경추 추간판',
  'intervertebral disk of sixth cervical vertebra': '제6경추 추간판',
  'intervertebral disk of seventh cervical vertebra': '제7경추 추간판',
  'intervertebral disk of first thoracic vertebra': '제1흉추 추간판',
  'intervertebral disk of second thoracic vertebra': '제2흉추 추간판',
  'intervertebral disk of third thoracic vertebra': '제3흉추 추간판',
  'intervertebral disk of fourth thoracic vertebra': '제4흉추 추간판',
  'intervertebral disk of fifth thoracic vertebra': '제5흉추 추간판',
  'intervertebral disk of sixth thoracic vertebra': '제6흉추 추간판',
  'intervertebral disk of seventh thoracic vertebra': '제7흉추 추간판',
  'intervertebral disk of eighth thoracic vertebra': '제8흉추 추간판',
  'intervertebral disk of ninth thoracic vertebra': '제9흉추 추간판',
  'intervertebral disk of tenth thoracic vertebra': '제10흉추 추간판',
  'intervertebral disk of eleventh thoracic vertebra': '제11흉추 추간판',
  'intervertebral disk of twelfth thoracic vertebra': '제12흉추 추간판',
  'intervertebral disk of first lumbar vertebra': '제1요추 추간판',
  'intervertebral disk of second lumbar vertebra': '제2요추 추간판',
  'intervertebral disk of third lumbar vertebra': '제3요추 추간판',
  'intervertebral disk of fourth lumbar vertebra': '제4요추 추간판',
  'intervertebral disk of fifth lumbar vertebra': '제5요추 추간판',

  /* -------------------------------------------------------------- rib cage */
  'first rib': '제1늑골',
  'second rib': '제2늑골',
  'third rib': '제3늑골',
  'fourth rib': '제4늑골',
  'fifth rib': '제5늑골',
  'sixth rib': '제6늑골',
  'seventh rib': '제7늑골',
  'eighth rib': '제8늑골',
  'ninth rib': '제9늑골',
  'tenth rib': '제10늑골',
  'eleventh rib': '제11늑골',
  'twelfth rib': '제12늑골',
  'first costal cartilage': '제1늑연골',
  'second costal cartilage': '제2늑연골',
  'third costal cartilage': '제3늑연골',
  'fourth costal cartilage': '제4늑연골',
  'fifth costal cartilage': '제5늑연골',
  'sixth costal cartilage': '제6늑연골',
  'seventh costal cartilage': '제7늑연골',
  'manubrium': '흉골병',
  'body of sternum': '흉골체',
  'xiphoid process': '검상돌기',

  /* ------------------------------------------------------------------ skull */
  'frontal bone': '전두골',
  'parietal bone': '두정골',
  'temporal bone': '측두골',
  'occipital bone': '후두골',
  'sphenoid bone': '접형골',
  'ethmoid': '사골',
  'maxilla': '상악골',
  'mandible': '하악골',
  'palatine bone': '구개골',
  'zygomatic bone': '협골',
  'nasal bone': '코뼈',
  'inferior nasal concha': '하비갑개',
  'vomer': '서골',
  'hyoid bone': '설골',
  'eyeball': '안구',

  /* -------------------------------------------------------- arm and hand */
  'clavicle': '쇄골',
  'scapula': '견갑골',
  'humerus': '상완골',
  'radius': '요골',
  'ulna': '척골',
  'interosseous membrane of forearm': '전완골간막',
  'scaphoid': '수근 주상골',
  'lunate': '월상골',
  'triquetral': '삼각골',
  'pisiform': '두상골',
  'trapezium': '대능형골',
  'trapezoid': '소능형골',
  'capitate': '유두골',
  'hamate': '유구골',
  'first metacarpal bone': '제1중수골',
  'second metacarpal bone': '제2중수골',
  'third metacarpal bone': '제3중수골',
  'fourth metacarpal bone': '제4중수골',
  'fifth metacarpal bone': '제5중수골',
  'proximal phalanx of thumb': '엄지손가락 기절골',
  'distal phalanx of thumb': '엄지손가락 말절골',
  'proximal phalanx of index finger': '검지 기절골',
  'middle phalanx of index finger': '검지 중절골',
  'distal phalanx of index finger': '검지 말절골',
  'proximal phalanx of middle finger': '중지 기절골',
  'middle phalanx of middle finger': '중지 중절골',
  'distal phalanx of middle finger': '중지 말절골',
  'proximal phalanx of ring finger': '약지 기절골',
  'middle phalanx of ring finger': '약지 중절골',
  'distal phalanx of ring finger': '약지 말절골',
  'proximal phalanx of little finger': '새끼손가락 기절골',
  'middle phalanx of little finger': '새끼손가락 중절골',
  'distal phalanx of little finger': '새끼손가락 말절골',

  /* ------------------------------------------------------- leg and foot */
  'hip bone': '관골',
  'femur': '대퇴골',
  'patella': '슬개골',
  'tibia': '경골',
  'fibula': '비골',
  'interosseous membrane of leg': '하퇴골간막',
  'talus': '거골',
  'calcaneus': '종골',
  'navicular bone of foot': '족근 주상골',
  'cuboid bone': '입방골',
  'medial cuneiform bone': '내측설상골',
  'intermediate cuneiform bone': '중간설상골',
  'lateral cuneiform bone': '외측설상골',
  'sesamoid bone of foot': '족부 종자골',
  'long plantar ligament': '장족저인대',
  'first metatarsal bone': '제1중족골',
  'second metatarsal bone': '제2중족골',
  'third metatarsal bone': '제3중족골',
  'fourth metatarsal bone': '제4중족골',
  'fifth metatarsal bone': '제5중족골',
  'proximal phalanx of big toe': '엄지발가락 기절골',
  'distal phalanx of big toe': '엄지발가락 말절골',
  'proximal phalanx of second toe': '둘째발가락 기절골',
  'middle phalanx of second toe': '둘째발가락 중절골',
  'distal phalanx of second toe': '둘째발가락 말절골',
  'proximal phalanx of third toe': '셋째발가락 기절골',
  'middle phalanx of third toe': '셋째발가락 중절골',
  'distal phalanx of third toe': '셋째발가락 말절골',
  'proximal phalanx of fourth toe': '넷째발가락 기절골',
  'middle phalanx of fourth toe': '넷째발가락 중절골',
  'distal phalanx of fourth toe': '넷째발가락 말절골',
  'proximal phalanx of little toe': '새끼발가락 기절골',
  'middle phalanx of little toe': '새끼발가락 중절골',
  'distal phalanx of little toe': '새끼발가락 말절골',

  /* --------------------------------------------------------------- nerves
   *
   * These twenty names also have to match what the muscle entries say in their
   * `innervation` field, or the app shows a muscle supplied by 요골신경 next to a
   * nerve called something else and they read as two different nerves. */
  'spinal cord': '척수',
  'spinal nerve roots': '척수신경근',
  'cranial nerves': '뇌신경',
  'vagus nerve': '미주신경',
  'sympathetic trunk': '교감신경간',
  'brachial plexus': '상완신경총',
  'lumbar plexus': '요신경총',
  'sacral plexus': '천골신경총',
  'axillary nerve': '액와신경',
  'musculocutaneous nerve': '근피신경',
  'median nerve': '정중신경',
  'radial nerve': '요골신경',
  'ulnar nerve': '척골신경',
  'long thoracic nerve': '장흉신경',
  'intercostal nerves': '늑간신경',
  'femoral nerve': '대퇴신경',
  'obturator nerve': '폐쇄신경',
  'sciatic nerve': '좌골신경',
  'tibial nerve': '경골신경',
  'common fibular nerve': '총비골신경',

  /* --------------------------------------------------------------- organs
   *
   * Here for orientation rather than for training — what a muscle lies in front
   * of, what a movement compresses, where the breath goes. */
  'trachea': '기관',
  'bronchus': '기관지',
  'upper lobe of lung': '폐 상엽',
  'middle lobe of lung': '폐 중엽',
  'lower lobe of lung': '폐 하엽',
  'thyroid cartilage': '갑상연골',
  'esophagus': '식도',
  'stomach': '위',
  'duodenum': '십이지장',
  'jejunum': '공장',
  'ileum': '회장',
  'appendix': '충수',
  'rectum': '직장',
  'free taenia': '자유결장뉴',
  'mesocolic taenia': '간막결장뉴',
  'omental taenia': '대망결장뉴',
  'liver': '간',
  'gallbladder': '담낭',
  'pancreatic duct': '췌관',
  'kidney': '신장',
  'ureter': '요관',
  'urinary bladder': '방광',
  'urethra': '요도',
  'adrenal gland': '부신',
  'testis': '고환',
  'pituitary gland': '뇌하수체',
  'pineal body': '송과체',

  /* heart and great vessels */
  'wall of heart': '심장벽',
  'mitral valve': '승모판',
  'tricuspid valve': '삼첨판',
  'pulmonary valve': '폐동맥판',
  'anterior papillary muscle of ventricle': '심실 전유두근',
  'posterior papillary muscle of ventricle': '심실 후유두근',
  'septal papillary muscle of ventricle': '심실 중격유두근',
  'stem of coronary artery': '관상동맥 기시부',
  'trunk of coronary artery': '관상동맥 주간부',
  'circumflex branch of coronary artery': '관상동맥 회선지',
  'marginal branch of coronary artery': '관상동맥 변연지',
  'posterolateral branch of coronary artery': '관상동맥 후외측지',
  'great cardiac vein': '대심장정맥',
  'middle cardiac vein': '중심장정맥',
  'coronary sinus': '관상정맥동',
  'ascending aorta': '상행대동맥',
  'arch of aorta': '대동맥궁',
  'descending aorta': '하행대동맥',
  'pulmonary artery': '폐동맥',
  'pulmonary vein': '폐정맥',
  'superior vena cava': '상대정맥',
  'inferior vena cava': '하대정맥',
  'common carotid artery': '총경동맥',
  'internal jugular vein': '내경정맥',
  'subclavian artery': '쇄골하동맥',
  'subclavian vein': '쇄골하정맥',
  'brachiocephalic vein': '완두정맥',
  'celiac artery': '복강동맥',
  'common hepatic artery': '총간동맥',
  'gastric artery': '위동맥',
  'splenic artery': '비동맥',
  'splenic vein': '비정맥',
  'superior mesenteric artery': '상장간막동맥',
  'superior mesenteric vein': '상장간막정맥',
  'inferior mesenteric artery': '하장간막동맥',
  'renal artery': '신동맥',
  'renal vein': '신정맥',
  'common iliac artery': '총장골동맥',
  'common iliac vein': '총장골정맥',
  'internal iliac artery': '내장골동맥',
  'internal iliac vein': '내장골정맥',
  'external iliac artery': '외장골동맥',
  'external iliac vein': '외장골정맥',

  /* -------------------------------------------------------------- muscles
   *
   * The ninety-seven with no MUSCLE_INFO entry. A muscle that has one takes its
   * Korean name from there — this table never overrides it, and `content.test.mjs`
   * checks that no key here shadows one. Most of these are the intrinsics of the
   * hand and foot and the muscles of facial expression: real structures a coach
   * will click on the model, not things a class is ever cued to. */

  /* deep neck and head */
  'longissimus capitis': '두최장근',
  'longissimus cervicis': '경최장근',
  'iliocostalis cervicis': '경장늑근',
  'spinalis cervicis': '경극근',
  'semispinalis cervicis': '경반극근',
  'splenius cervicis': '경판상근',
  'cervical rotator': '경회전근',
  'obliquus capitis superior': '상두사근',
  'rectus capitis posterior minor': '소후두직근',
  'rectus capitis anterior': '전두직근',
  'rectus capitis lateralis': '외측두직근',
  'scalenus posterior': '후사각근',
  'platysma': '광경근',

  /* hyoid muscles — the floor of the mouth and the strap muscles under it */
  'digastric': '악이복근',
  'mylohyoid': '악설골근',
  'geniohyoid': '이설골근',
  'stylohyoid': '경돌설골근',
  'sternohyoid': '흉골설골근',
  'sternothyroid': '흉골갑상근',
  'thyrohyoid': '갑상설골근',
  'omohyoid': '견갑설골근',
  'intermediate tendon': '중간건',

  /* chewing */
  'masseter': '교근',
  'temporalis': '측두근',
  'lateral pterygoid': '외측익돌근',
  'medial pterygoid': '내측익돌근',

  /* facial expression */
  'frontalis': '전두근',
  'occipitalis': '후두근',
  'temporoparietalis': '측두두정근',
  'aponeurosis of epicranius': '모상건막',
  'orbicularis oculi': '안륜근',
  'orbicularis oris': '구륜근',
  'corrugator supercilii': '추미근',
  'procerus': '비근근',
  'nasalis': '비근',
  'depressor septi nasi': '비중격하제근',
  'buccinator': '협근',
  'risorius': '소근',
  'mentalis': '이근',
  'zygomaticus major': '대관골근',
  'zygomaticus minor': '소관골근',
  'levator anguli oris': '구각거근',
  'depressor anguli oris': '구각하제근',
  'levator labii superioris': '상순거근',
  'levator labii superioris alaeque nasi': '상순비익거근',
  'depressor labii inferioris': '하순하제근',

  /* trunk */
  'innermost intercostal muscle': '최내늑간근',
  'serratus posterior superior': '상후거근',
  'linea alba': '백선',
  'inguinal ligament': '서혜인대',
  'external anal sphincter': '외항문괄약근',
  'puborectalis': '치골직장근',
  'tendinous arch of levator ani': '항문거근 건궁',

  /* shoulder and arm */
  'subclavius': '쇄골하근',
  'gemellus superior': '상쌍자근',
  'gemellus inferior': '하쌍자근',
  'pronator teres': '원회내근',
  'pronator quadratus': '방형회내근',
  'supinator': '회외근',
  'palmaris longus': '장장근',

  /* forearm to the fingers */
  'flexor digitorum superficialis': '천지굴근',
  'flexor digitorum profundus': '심지굴근',
  'extensor digitorum': '지신근',
  'extensor digiti minimi': '소지신근',
  'extensor indicis': '시지신근',
  'flexor retinaculum of wrist': '수근 굴근지대',

  /* thumb — 무지 is thumb and big toe both, so the hand's are marked 수부 */
  'abductor pollicis longus': '장무지외전근',
  'abductor pollicis brevis': '단무지외전근',
  'flexor pollicis longus': '수부 장무지굴근',
  'flexor pollicis brevis': '수부 단무지굴근',
  'extensor pollicis longus': '수부 장무지신근',
  'extensor pollicis brevis': '수부 단무지신근',
  'adductor pollicis': '수부 무지내전근',
  'opponens pollicis': '무지대립근',

  /* little finger */
  'abductor digiti minimi of hand': '수부 소지외전근',
  'flexor digiti minimi brevis of hand': '수부 단소지굴근',
  'opponens digiti minimi of hand': '수부 소지대립근',

  /* leg */
  'adductor minimus': '최소내전근',
  'iliotibial tract': '장경인대',
  'fibularis tertius': '제3비골근',
  'calcaneal tendon': '아킬레스건',

  /* sole of the foot */
  'flexor digitorum brevis': '단지굴근',
  'extensor digitorum brevis': '단지신근',
  'extensor hallucis brevis': '단무지신근',
  'flexor hallucis brevis': '족부 단무지굴근',
  'adductor hallucis': '족부 무지내전근',
  'abductor digiti minimi of foot': '족부 소지외전근',
  'flexor digiti minimi brevis of foot': '족부 단소지굴근',
  'opponens digiti minimi of foot': '족부 소지대립근',
  'flexor accessorius': '족저방형근',
  'first lumbrical of foot': '족부 제1충양근',
  'second lumbrical of foot': '족부 제2충양근',
  'third lumbrical of foot': '족부 제3충양근',
  'fourth lumbrical of foot': '족부 제4충양근',
  'first plantar interosseous of foot': '제1족저골간근',
  'second plantar interosseous of foot': '제2족저골간근',
  'third plantar interosseous of foot': '제3족저골간근',
};
