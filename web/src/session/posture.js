/**
 * The pre-session body assessment: four photographs, measured, on screen.
 *
 * This is the step before anybody gets on a reformer. A student stands against
 * a wall, four photographs are taken — front, left side, right side, back —
 * and this screen says what the standing alignment measures, what is outside
 * its usual range, and where a first session could start. Afterwards they move
 * on to a class, and the recording half of the application takes over.
 *
 * **The photographs stay in the browser.** They are sent once, measured, and
 * dropped: the server keeps no copy and returns none. What comes back is
 * seventeen coordinates per photograph, which is what lets the overlay be
 * drawn here, on the copy this page still holds, without the pictures making a
 * second trip. Everything on screen is drawn from those coordinates and from
 * the numbers the measurement layer produced; nothing is decided in this file.
 *
 * **The overlay is drawn in the photograph's own pixel coordinates.** The SVG
 * carries the photograph's dimensions as its `viewBox` and is stretched over
 * the image with CSS, so a landmark at (540, 712) is written as (540, 712) and
 * stays correct at every display size, on a phone and on a projector alike.
 * `vector-effect: non-scaling-stroke` keeps the lines one pixel wide while that
 * happens.
 *
 * **Both languages, everywhere, together.** The studio this is built for
 * teaches in Korean. Every phrase the server sends arrives in both and the
 * screen follows `app.lang`; the few words this file adds of its own are in the
 * table at the top for the same reason. A page that is Korean except for the
 * headings is a page a reader stops trusting.
 *
 * **What it will not do.** It does not name a condition, it does not say
 * "correct" or "abnormal", and it shows what could not be measured beside what
 * could — sagittal pelvic tilt, most of all, which is the measurement this kind
 * of product is asked for most and the one four photographs cannot give.
 */
import { EXERCISE } from '../content/exercises.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The words this file adds. Everything else arrives from the server in both. */
const T = {
  open:       { en: 'Posture check', ko: '체형 분석' },
  title:      { en: 'Pre-session posture check', ko: '세션 전 체형 분석' },
  lede:       { en: 'Four photographs of a body standing still. Take them once, before the first session, and again when you want to see what has changed.',
                ko: '가만히 선 자세를 네 방향에서 촬영합니다. 첫 세션 전에 한 번, 이후 변화를 확인하고 싶을 때 다시 촬영하세요.' },
  add:        { en: 'Add photograph', ko: '사진 추가' },
  replace:    { en: 'Replace', ko: '다시 선택' },
  remove:     { en: 'Remove', ko: '삭제' },
  analyse:    { en: 'Analyse these photographs', ko: '분석 시작' },
  working:    { en: 'Measuring…', ko: '측정 중…' },
  again:      { en: 'Start again', ko: '다시 하기' },
  print:      { en: 'Print', ko: '인쇄' },
  close:      { en: 'Close', ko: '닫기' },
  back:       { en: '\u2190  Back to the analysis', ko: '\u2190  분석으로 돌아가기' },
  other:      { en: '한국어', ko: 'English' },
  need:       { en: 'Add at least one photograph.', ko: '사진을 한 장 이상 추가하세요.' },
  privacy:    { en: 'The photographs are measured and then dropped. They are not stored, and they are not sent back. What is kept is the numbers.',
                ko: '사진은 측정 후 즉시 폐기됩니다. 저장하지 않으며 다시 전송하지도 않습니다. 남는 것은 측정값뿐입니다.' },
  forWhom:    { en: 'Whose assessment is this?', ko: '누구의 분석입니까?' },
  myself:     { en: 'Mine', ko: '내 것' },
  taken:      { en: 'Date the photographs were taken', ko: '촬영 날짜' },
  findings:   { en: 'What the photographs measured', ko: '사진에서 측정한 내용' },
  clear:      { en: 'Every measurement sits inside its usual range.', ko: '측정한 모든 항목이 정상 범위 안에 있습니다.' },
  plan:       { en: 'Where a first session could start', ko: '첫 세션 시작 지점' },
  habits:     { en: 'Between sessions', ko: '세션 사이에 할 일' },
  cannot:     { en: 'What these photographs cannot measure', ko: '이 사진으로 측정할 수 없는 것' },
  notTaken:   { en: 'Photographs not supplied', ko: '촬영되지 않은 사진' },
  worth:      { en: 'Worth checking', ko: '확인이 필요한 사항' },
  retake:     { en: 'Retake these photographs', ko: '다시 촬영이 필요한 사진' },
  inRange:    { en: 'Inside its usual range', ko: '정상 범위 안' },
  usually:    { en: 'Usually seen with', ko: '함께 나타나는 경우' },
  showOn:     { en: 'Show on the body', ko: '인체 모형에서 보기' },
  outOf:      { en: 'out of 100', ko: '100점 만점' },
  noScore:    { en: 'No score', ko: '점수 없음' },
  measured:   { en: 'measured', ko: '측정값' },
  failed:     { en: 'The photographs could not be measured.', ko: '사진을 측정하지 못했습니다.' },
  offline:    { en: 'This copy of the site has no measurement server behind it, so a photograph has nowhere to go. Run the studio yourself to turn this on.',
                ko: '이 사이트 사본에는 측정 서버가 연결되어 있지 않아 사진을 보낼 곳이 없습니다. 직접 스튜디오 서버를 실행하면 사용할 수 있습니다.' },
  signIn:     { en: 'Sign in first — an assessment belongs to somebody.',
                ko: '먼저 로그인하세요. 분석 결과는 특정 회원에게 속합니다.' },
  disputed:   { en: 'the two photographs disagreed', ko: '두 사진이 어긋났습니다' },
  onFile:     { en: 'Already on file', ko: '기록된 분석' },
  trend:      { en: 'Score over time', ko: '점수 변화' },
  changed:    { en: 'What has changed since', ko: '지난 분석 이후 변화' },
  since:      { en: 'since', ko: '이후' },
  toward:     { en: 'closer to level', ko: '수평에 가까워짐' },
  away:       { en: 'further from level', ko: '수평에서 멀어짐' },
  same:       { en: 'unchanged', ko: '변화 없음' },
  notCompared: { en: 'Not compared', ko: '비교하지 않음' },
  judgement:  { en: 'A smaller deviation is a smaller deviation. Whether it is an improvement is a judgement for the person teaching.',
                ko: '차이가 줄어든 것은 차이가 줄어든 것입니다. 그것이 개선인지는 지도하는 사람이 판단할 일입니다.' },
  firstOne:   { en: 'This is the first assessment on file. Take another in six to eight weeks and this page will show what moved.',
                ko: '첫 번째 분석입니다. 6~8주 뒤에 다시 촬영하면 이 화면에서 변화를 확인할 수 있습니다.' },
  pattern:    { en: 'What the measurements add up to', ko: '측정값이 말하는 것' },
  regions:    { en: 'By part of the body', ko: '부위별 결과' },
  priorities: { en: 'What to work on first', ko: '개선 우선순위' },
  evenness:   { en: 'Left against right', ko: '좌우 균형' },
  evenNote:   { en: 'averaged over {n} measurements that have a side to them',
                ko: '좌우가 있는 {n}개 항목의 평균' },
  leastEven:  { en: 'least even', ko: '가장 차이가 큰 항목' },
  comeBack:   { en: 'Photograph again', ko: '다음 촬영' },
  weakest:    { en: 'weakest', ko: '가장 낮음' },
  checksN:    { en: '{n} checks', ko: '{n}개 항목' },
  severityWords: {
    marked:     { en: 'Marked', ko: '뚜렷함' },
    notable:    { en: 'Notable', ko: '주의' },
    watch:      { en: 'Watch', ko: '관찰' },
    within_band: { en: 'In range', ko: '정상' },
  },
};

const say = (key, lang) => T[key]?.[lang] ?? T[key]?.en ?? '';

/** Severity to ink. The same four steps `pilates/guidance.py` grades with. */
const INK = {
  marked: '#e05a48', notable: '#e79a3c', watch: '#d9c05a', within_band: '#4fbf87',
};

/** Where each measurement is anchored on the body, in COCO-17 joint indices. */
const ANCHOR = {
  head_lateral_tilt: [3, 4], forward_head: [3, 4],
  shoulder_tilt: [5, 6], pelvic_obliquity: [11, 12],
  trunk_lean_lateral: [5, 6, 11, 12], trunk_lean_sagittal: [5, 6, 11, 12],
  left_knee_deviation: [13], right_knee_deviation: [14],
  lateral_weight_bias: [15, 16],
};

/** The lines that make a body out of seventeen points. */
const BONES = [[15, 13], [13, 11], [16, 14], [14, 12], [11, 12], [5, 11],
  [6, 12], [5, 6], [5, 7], [6, 8], [7, 9], [8, 10], [1, 2], [0, 1], [0, 2],
  [1, 3], [2, 4]];

/** Lines that should be level, and the reading that says whether they are. */
const LEVELS = [['head_lateral_tilt', 3, 4], ['shoulder_tilt', 5, 6],
  ['pelvic_obliquity', 11, 12]];

const CONF = 0.4;

const STYLE = `
/* The application underneath styles some of the same bare class names -- its
 * header disclaimer chips are \`.disc\`, its modal is \`.card\` -- and although
 * every rule below is id-scoped and wins on specificity, a property this file
 * does not set still leaks in. The first version of this screen inherited
 * \`text-transform: uppercase; white-space: nowrap\` from the header chips and
 * ran the medical disclaimer off the side of the page. So: every class here
 * carries an ss- prefix, and these three properties are reset for everything
 * inside, since they are the ones that travel furthest. */
#ss-pos, #ss-pos *{box-sizing:border-box;text-transform:none;
  letter-spacing:normal;white-space:normal;max-height:none}
/* The application draws its own headings as small uppercase rules with a hair
 * line trailing off them (\`h3::after\`). That is right for its panels and
 * wrong for a report, where a heading is a heading. */
#ss-pos h1,#ss-pos h2,#ss-pos h3{color:var(--txt);display:block;margin:0}
#ss-pos h1::after,#ss-pos h2::after,#ss-pos h3::after{content:none}
#ss-pos-open{flex:none;align-self:flex-start;display:inline-flex;gap:9px;
  align-items:center;padding:7px 15px 7px 12px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;font-weight:600;letter-spacing:.11em;
  text-transform:uppercase;white-space:nowrap;background:var(--glass);
  border:1px solid var(--line2);color:var(--dim)}
#ss-pos-open:hover{color:var(--txt);border-color:var(--acc)}
#ss-pos-open i{width:9px;height:9px;border-radius:2px;border:1.5px solid var(--acc)}
/* The way back from an exercise. Fixed, high, and over everything: the whole
   failure it fixes is a one-way door, so it must not be possible to miss. */
#ss-pos-back{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;
  z-index:140;padding:10px 20px;border-radius:22px;font:inherit;font-size:13px;
  font-weight:600;cursor:pointer;background:var(--acc);border:0;color:#04121f;
  box-shadow:0 8px 28px rgba(0,0,0,.5)}
#ss-pos-back:hover{filter:brightness(1.1)}
#ss-pos[hidden]{display:none}
#ss-pos{position:fixed;inset:0;z-index:130;overflow:auto;
  background:linear-gradient(180deg,#070b12,#04070c);color:var(--txt)}
#ss-pos .ss-sheet{max-width:1180px;margin:0 auto;padding:26px 22px 90px}
#ss-pos header.ss-top{display:flex;gap:14px;align-items:flex-start;
  margin:0 0 6px;flex-wrap:wrap}
#ss-pos h1{margin:0;font-size:21px;font-weight:500;letter-spacing:.01em}
#ss-pos .ss-lede{margin:6px 0 22px;font-size:12.5px;color:var(--dim2);
  line-height:1.7;max-width:70ch}
#ss-pos .ss-acts{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
#ss-pos button.ss-b{padding:8px 15px;border-radius:4px;font:inherit;font-size:12.5px;
  cursor:pointer;background:var(--glass);border:1px solid var(--line2);
  color:var(--txt)}
#ss-pos button.ss-b:hover{border-color:var(--acc)}
#ss-pos button.ss-b.ss-primary{background:var(--acc);border-color:var(--acc);color:#04121f;
  font-weight:600}
#ss-pos button.ss-b[disabled]{opacity:.4;cursor:default}
#ss-pos .ss-who{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 20px}
#ss-pos .ss-who label{display:block;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--dim2);margin:0 0 5px}
#ss-pos .ss-who input{padding:8px 10px;border-radius:3px;font:inherit;font-size:13px;
  background:var(--glass);border:1px solid var(--line);color:var(--txt)}
#ss-pos .ss-slots{display:grid;gap:14px;
  grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
#ss-pos .ss-slot{border:1px dashed var(--line2);border-radius:6px;overflow:hidden;
  background:rgba(255,255,255,.015);display:flex;flex-direction:column}
#ss-pos .ss-slot.ss-has{border-style:solid;border-color:var(--line2)}
#ss-pos .ss-slot .ss-cap{padding:9px 12px;font-size:12.5px;font-weight:600;
  background:rgba(255,255,255,.05)}
#ss-pos .ss-slot .ss-how{padding:9px 12px;font-size:10.5px;color:var(--dim2);
  line-height:1.65;flex:1}
#ss-pos .ss-slot .ss-shot{aspect-ratio:3/4;background:#05070d;display:block;
  width:100%;object-fit:cover}
#ss-pos .ss-slot .ss-row{display:flex;gap:7px;padding:9px 12px}
#ss-pos .ss-slot .ss-row button{flex:1;padding:6px 0;border-radius:3px;font:inherit;
  font-size:11px;cursor:pointer;background:var(--glass);
  border:1px solid var(--line);color:var(--dim)}
#ss-pos .ss-slot .ss-row button:hover{color:var(--txt);border-color:var(--acc)}
#ss-pos .ss-privacy{margin:18px 0 0;font-size:11.5px;color:var(--dim2);
  line-height:1.7;border-left:2px solid var(--line2);padding-left:12px;
  max-width:70ch}
#ss-pos .ss-go{margin:22px 0 0;display:flex;gap:12px;align-items:center;
  flex-wrap:wrap}
#ss-pos .ss-bad{color:var(--gold);font-size:12px}
#ss-pos .ss-grid{display:grid;gap:22px;grid-template-columns:260px 1fr;
  align-items:start;margin:8px 0 0}
@media(max-width:820px){#ss-pos .ss-grid{grid-template-columns:1fr}}
#ss-pos .ss-card{border:1px solid var(--line);border-radius:7px;padding:16px 17px;
  background:rgba(255,255,255,.02)}
#ss-pos .ss-card h2{margin:0 0 12px;font-size:12px;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;color:var(--dim2)}
#ss-pos .ss-dial{display:block;margin:0 auto 4px}
#ss-pos .ss-band{text-align:center;font-size:15px;font-weight:600;margin:0 0 4px}
#ss-pos .ss-bandnote{text-align:center;font-size:10.5px;color:var(--dim2);
  line-height:1.65;margin:0 0 14px}
#ss-pos .ss-ladder{display:grid;gap:5px;font-size:10.5px}
#ss-pos .ss-ladder div{display:flex;gap:8px;align-items:center;color:var(--dim2)}
#ss-pos .ss-ladder div.ss-now{color:var(--txt);font-weight:600}
#ss-pos .ss-ladder i{width:9px;height:9px;border-radius:2px;flex:none}
#ss-pos .ss-ladder em{margin-left:auto;font-style:normal;color:var(--dim2)}
#ss-pos .ss-shots{display:grid;gap:18px;
  grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin:0 0 22px}
#ss-pos figure{margin:0;border:1px solid var(--line);border-radius:7px;
  overflow:hidden;background:#05070d}
/* A fixed box, so four photographs of four different shapes make four cards
 * of the same height. The photograph letterboxes inside it with object-fit
 * contain, and the overlay letterboxes into the same box with xMidYMid meet
 * -- the two are the same transform, so the skeleton stays on the body
 * however odd the source aspect is. Stretching either one alone slides the
 * overlay off the person, which is worse than an unaligned card. */
/* Both children are taken out of flow, so the frame's own aspect-ratio is
 * what decides its height. With the image left in flow the browser has a
 * height from the content and ignores the ratio -- which is how four cards
 * with an explicit 3/4 box came out 602, 582, 651 and 833 px tall. */
#ss-pos .ss-frame{position:relative;line-height:0;background:#05070d}
#ss-pos .ss-frame img,#ss-pos .ss-frame svg{position:absolute;inset:0;
  width:100%;height:100%}
#ss-pos .ss-frame img{object-fit:contain}
#ss-pos figure{display:flex;flex-direction:column}
#ss-pos .ss-shots figcaption{flex:none}
#ss-pos figcaption{padding:8px 11px;font-size:12px;font-weight:600;
  background:rgba(255,255,255,.06);display:flex;gap:8px;align-items:center}
#ss-pos figcaption small{margin-left:auto;font-weight:400;font-size:10px;
  color:var(--dim2)}
#ss-pos .ss-marks{display:grid;gap:1px;padding:2px 0 0}
#ss-pos .ss-marks button{display:flex;gap:9px;align-items:baseline;width:100%;
  text-align:left;padding:6px 11px;font:inherit;font-size:11px;cursor:pointer;
  background:none;border:0;border-top:1px solid var(--line);color:var(--dim)}
#ss-pos .ss-marks button:hover,#ss-pos .ss-marks button.ss-on{background:rgba(255,255,255,.05);
  color:var(--txt)}
#ss-pos .ss-marks .ss-pip{width:8px;height:8px;border-radius:50%;flex:none;
  align-self:center}
#ss-pos .ss-marks .ss-val{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums}
#ss-pos .ss-marks .ss-way{font-size:9.5px;color:var(--dim2)}
#ss-pos .ss-find{border-left:3px solid var(--line2);padding:0 0 0 13px;
  margin:0 0 18px}
#ss-pos .ss-find h3{margin:0 0 3px;font-size:14px;font-weight:600}
#ss-pos .ss-find .ss-num{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
#ss-pos .ss-find p{margin:6px 0 0;font-size:12px;color:var(--dim);line-height:1.7}
#ss-pos .ss-find .ss-ev{font-size:10.5px;color:var(--dim2)}
#ss-pos .ss-find .ss-why{font-size:11px;color:var(--dim2);font-style:italic}
#ss-pos .ss-pills{display:flex;gap:7px;flex-wrap:wrap;margin:9px 0 0}
#ss-pos .ss-pills button{padding:5px 11px;border-radius:20px;font:inherit;
  font-size:11px;cursor:pointer;background:rgba(90,169,230,.1);
  border:1px solid rgba(90,169,230,.32);color:var(--acc)}
#ss-pos .ss-pills button:hover{background:rgba(90,169,230,.2)}
#ss-pos ol.ss-plan{margin:0;padding:0 0 0 20px;font-size:12px;line-height:1.7}
#ss-pos ol.ss-plan li{margin:0 0 11px;color:var(--dim)}
#ss-pos ol.ss-plan b{color:var(--txt);font-weight:600}
#ss-pos ul.ss-habits{margin:0;padding:0 0 0 18px;font-size:12px;line-height:1.8;
  color:var(--dim)}
#ss-pos .ss-limits{margin:22px 0 0;display:grid;gap:16px;
  grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
#ss-pos .ss-limits b{display:block;font-size:12px;margin:0 0 3px;color:var(--txt)}
#ss-pos .ss-limits p{margin:0 0 12px;font-size:11px;color:var(--dim2);line-height:1.7}
#ss-pos .ss-disc{margin:26px 0 0;padding:13px 15px;border-radius:6px;
  border:1px solid rgba(233,180,92,.35);background:rgba(233,180,92,.06);
  font-size:11.5px;color:var(--dim);line-height:1.75;max-width:80ch}
#ss-pos .ss-log{margin:14px 0 0;font-size:11.5px;color:var(--dim2);line-height:1.7}
#ss-pos .ss-hist{display:grid;gap:16px;grid-template-columns:1fr 260px;
  align-items:center;margin:0 0 22px}
@media(max-width:720px){#ss-pos .ss-hist{grid-template-columns:1fr}}
#ss-pos .ss-past{display:grid;gap:1px}
#ss-pos .ss-past div{display:flex;gap:10px;align-items:baseline;
  padding:5px 0;font-size:11.5px;color:var(--dim);
  border-top:1px solid var(--line)}
#ss-pos .ss-past div:first-child{border-top:0}
#ss-pos .ss-past b{font-weight:600;color:var(--txt);font-variant-numeric:tabular-nums}
#ss-pos .ss-past em{margin-left:auto;font-style:normal;font-size:10.5px}
#ss-pos .ss-spark{width:100%;height:88px;display:block}
#ss-pos .ss-chg{display:grid;gap:1px;margin:10px 0 0}
#ss-pos .ss-chg div{display:flex;gap:10px;align-items:baseline;padding:7px 0;
  font-size:11.5px;border-top:1px solid var(--line);color:var(--dim)}
#ss-pos .ss-chg b{color:var(--txt);font-weight:500}
#ss-pos .ss-chg .ss-num{margin-left:auto;font-weight:700;
  font-variant-numeric:tabular-nums}
#ss-pos .ss-chg .ss-was{font-size:10.5px;color:var(--dim2);
  font-variant-numeric:tabular-nums}
#ss-pos .ss-delta{font-size:26px;font-weight:700;
  font-variant-numeric:tabular-nums}
#ss-pos .ss-pat{margin:0 0 4px;font-size:14px;font-weight:600;line-height:1.6}
#ss-pos .ss-patwhy{margin:0;font-size:11.5px;color:var(--dim2);line-height:1.7}
#ss-pos .ss-reg{display:grid;gap:11px;margin:2px 0 0}
/* Direct children only. Without the combinator this also matched the wrapper
   inside each row, turning the label into a second two-column grid and
   breaking "weakest: head carried forward" one word per line. */
#ss-pos .ss-reg > div{display:grid;grid-template-columns:1fr 44px;gap:10px;
  align-items:center}
#ss-pos .ss-reg > div > div{min-width:0}
#ss-pos .ss-reg b{font-size:11.5px;font-weight:500;color:var(--txt)}
#ss-pos .ss-reg small{display:block;font-size:9.5px;color:var(--dim2);
  margin-top:1px}
#ss-pos .ss-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.07);
  overflow:hidden;margin-top:5px}
#ss-pos .ss-bar i{display:block;height:100%;border-radius:3px}
#ss-pos .ss-reg em{font-style:normal;font-size:14px;font-weight:700;
  text-align:right;font-variant-numeric:tabular-nums}
#ss-pos ol.ss-pri{margin:0;padding:0 0 0 20px;font-size:12px;line-height:1.7}
#ss-pos ol.ss-pri li{margin:0 0 9px;color:var(--dim)}
#ss-pos ol.ss-pri b{color:var(--txt);font-weight:600;display:block}
#ss-pos ol.ss-pri span{font-variant-numeric:tabular-nums;font-weight:600}
#ss-pos .ss-even{display:flex;gap:12px;align-items:baseline;margin:0 0 6px}
#ss-pos .ss-even b{font-size:26px;font-weight:700;
  font-variant-numeric:tabular-nums}
@media print{
  #ss-pos{position:static;background:#fff;color:#111;overflow:visible}
  #ss-pos .ss-acts,#ss-pos .ss-marks button{display:none}
  #ss-pos .ss-card,#ss-pos figure{border-color:#ccc;background:#fff}
  #ss-pos .ss-find p,#ss-pos ol.ss-plan li,#ss-pos ul.ss-habits{color:#333}
}
`;

/* ------------------------------------------------------------------ drawing */

const real = (pt, score) => score >= CONF && !(pt[0] === 0 && pt[1] === 0);

/** The mean of whichever of these joints were actually found. */
function anchorOf(land, joints) {
  const found = joints.filter((j) => real(land.keypoints[j], land.scores[j]));
  if (!found.length) return null;
  return [found.reduce((a, j) => a + land.keypoints[j][0], 0) / found.length,
          found.reduce((a, j) => a + land.keypoints[j][1], 0) / found.length];
}

/**
 * The overlay, in the photograph's own pixel coordinates.
 *
 * Nothing here is scaled to the display: the `viewBox` carries the
 * photograph's dimensions and CSS stretches the result over the image, so a
 * landmark at (540, 712) is written as (540, 712) and is right at every size.
 * `vector-effect` keeps the strokes from being stretched with it.
 */
function overlay(land, marks) {
  const { keypoints: k, scores: s, width, height } = land;
  const out = [];
  const feet = [15, 16].filter((j) => real(k[j], s[j]));
  if (feet.length) {
    const x = feet.reduce((a, j) => a + k[j][0], 0) / feet.length;
    out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#fff"
      stroke-width="2" stroke-dasharray="9 7" opacity=".6"
      vector-effect="non-scaling-stroke"/>`);
  }
  for (const [a, b] of BONES) {
    if (!real(k[a], s[a]) || !real(k[b], s[b])) continue;
    out.push(`<line x1="${k[a][0]}" y1="${k[a][1]}" x2="${k[b][0]}"
      y2="${k[b][1]}" stroke="#6fa8d8" stroke-width="2" stroke-linecap="round"
      opacity=".62" vector-effect="non-scaling-stroke"/>`);
  }
  for (const mark of marks) {
    if (!mark.level) continue;
    const [, a, b] = mark.level;
    if (!real(k[a], s[a]) || !real(k[b], s[b])) continue;
    const mid = (k[a][1] + k[b][1]) / 2;
    out.push(`<line x1="${k[a][0]}" y1="${mid}" x2="${k[b][0]}" y2="${mid}"
      stroke="#fff" stroke-width="1.5" stroke-dasharray="4 4" opacity=".75"
      vector-effect="non-scaling-stroke"/>`);
    out.push(`<line x1="${k[a][0]}" y1="${k[a][1]}" x2="${k[b][0]}"
      y2="${k[b][1]}" stroke="${mark.ink}" stroke-width="3"
      stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
  }
  for (const mark of marks) {
    if (!mark.at) continue;
    const r = Math.max(width, height) / 90;
    out.push(`<g data-pip="${esc(mark.metric)}" opacity=".95">
      <circle cx="${mark.at[0]}" cy="${mark.at[1]}" r="${r}"
        fill="${mark.ink}" stroke="#fff" stroke-width="2"
        vector-effect="non-scaling-stroke"/>
      <text x="${mark.at[0]}" y="${mark.at[1] + r * 0.38}"
        text-anchor="middle" font-size="${r * 1.15}" font-weight="700"
        fill="#04121f">${mark.n}</text></g>`);
  }
  /* `meet`, not `none`: the photograph beside it is fitted with
   * `object-fit: contain`, and these two are the same transform. Stretching
   * the overlay to the box while the photograph letterboxes inside it puts
   * the skeleton next to the body rather than on it. */
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"
    xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
}

/** The score as an arc, so the number has a scale behind it. */
function dial(value, ink, lang) {
  const R = 58, CX = 78, CY = 78, START = 150, SWEEP = 240;
  const at = (deg) => [CX + R * Math.cos(deg * Math.PI / 180),
                       CY + R * Math.sin(deg * Math.PI / 180)];
  const [x0, y0] = at(START);
  const [x1, y1] = at(START + SWEEP);
  let arc = '';
  if (value != null) {
    const filled = SWEEP * Math.max(0, Math.min(100, value)) / 100;
    const [fx, fy] = at(START + filled);
    arc = `<path d="M ${x0} ${y0} A ${R} ${R} 0 ${filled > 180 ? 1 : 0} 1
      ${fx} ${fy}" fill="none" stroke="${ink}" stroke-width="11"
      stroke-linecap="round"/>`;
  }
  const head = value == null ? '—' : Math.round(value);
  return `<svg class="ss-dial" width="156" height="126" viewBox="0 0 156 126">
    <path d="M ${x0} ${y0} A ${R} ${R} 0 1 1 ${x1} ${y1}" fill="none"
      stroke="rgba(255,255,255,.09)" stroke-width="11" stroke-linecap="round"/>
    ${arc}
    <text x="${CX}" y="${CY + 9}" text-anchor="middle" font-size="34"
      font-weight="700" fill="currentColor">${head}</text>
    <text x="${CX}" y="${CY + 27}" text-anchor="middle" font-size="10"
      fill="#8b95ab">${esc(value == null ? say('noScore', lang)
        : say('outOf', lang))}</text></svg>`;
}

/**
 * The score over time, as a line.
 *
 * Withheld scores are not in the series at all -- the server leaves them out of
 * `trend` for the same reason: a chart that plots a withheld score as zero
 * draws a collapse where there was no measurement. So the line joins the points
 * that exist, and the count underneath says how many there were.
 */
function spark(trend, ink) {
  if (!trend.length) return '';
  const W = 260, H = 88, PAD = 14;
  const lo = Math.min(40, ...trend.map((p) => p.score));
  const hi = Math.max(100, ...trend.map((p) => p.score));
  const x = (i) => PAD + (W - 2 * PAD) * (trend.length < 2 ? 0.5
    : i / (trend.length - 1));
  const y = (v) => H - PAD - (H - 2 * PAD) * ((v - lo) / Math.max(1, hi - lo));
  const line = trend.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
  const dots = trend.map((p, i) => `<circle cx="${x(i).toFixed(1)}"
    cy="${y(p.score).toFixed(1)}" r="${i === trend.length - 1 ? 4.5 : 3}"
    fill="${bandInk(p.band)}" stroke="#0b111b" stroke-width="1.5"/>`).join('');
  const last = trend[trend.length - 1];
  return `<svg class="ss-spark" viewBox="0 0 ${W} ${H}">
    <line x1="${PAD}" y1="${y(hi).toFixed(1)}" x2="${W - PAD}"
      y2="${y(hi).toFixed(1)}" stroke="rgba(255,255,255,.07)"/>
    <line x1="${PAD}" y1="${y(lo).toFixed(1)}" x2="${W - PAD}"
      y2="${y(lo).toFixed(1)}" stroke="rgba(255,255,255,.07)"/>
    <path d="${line}" fill="none" stroke="${ink}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <text x="${PAD}" y="${H - 2}" font-size="9"
      fill="#8b95ab">${esc(trend[0].on)}</text>
    <text x="${W - PAD}" y="${H - 2}" font-size="9" text-anchor="end"
      fill="#8b95ab">${esc(last.on)}</text>
    <text x="${W - PAD}" y="${(y(hi) - 4).toFixed(1)}" font-size="8.5"
      text-anchor="end" fill="#6c7789">${hi.toFixed(0)}</text></svg>`;
}

/** What is already on file, above the empty slots. */
function historyHtml(state, lang) {
  const rows = state.history?.assessments ?? [];
  if (!rows.length) return '';
  const trend = state.history?.trend ?? [];
  const listed = rows.slice(0, 5).map((row) => `<div>
    <b>${esc(row.taken_on || row.made_at.slice(0, 10))}</b>
    <span style="color:${row.score == null ? 'var(--dim2)' : bandInk(row.band)}">
      ${row.score == null ? esc(say('noScore', lang))
        : `${Math.round(row.score)} · ${esc(lang === 'ko' ? bandKo(row.band) : row.band)}`}</span>
    <em>${row.views.length}/4</em></div>`).join('');
  return `<div class="ss-card ss-hist">
    <div><h2>${esc(say('onFile', lang))}</h2>
      <div class="ss-past">${listed}</div></div>
    ${trend.length > 1 ? `<div><h2>${esc(say('trend', lang))}</h2>
      ${spark(trend, bandInk(trend[trend.length - 1].band))}</div>` : ''}
  </div>`;
}

/** Korean for a band name, without a second table: the server sends both. */
function bandKo(english) {
  return { Excellent: '매우 우수', Good: '우수', Fair: '보통',
           'Needs attention': '주의', 'Needs work': '관리 필요' }[english]
    ?? english;
}

/**
 * What the measurements add up to, which no single measurement says.
 *
 * The sagittal chain read as a shape, plus where in it to start. A head
 * forward of a shoulder that is itself forward of the ankle is a body
 * leaning; a head forward of a shoulder that is over the ankle is a neck.
 * Both produce the same forward-head number.
 */
function patternHtml(report, lang) {
  const p = report.pattern;
  if (!p?.shape) return '';
  const why = lang === 'ko' ? p.start_at_ko : p.start_at;
  return `<div class="ss-card" style="margin-top:16px">
    <h2>${esc(say('pattern', lang))}</h2>
    <p class="ss-pat">${esc(lang === 'ko' ? p.shape_ko : p.shape)}</p>
    ${why ? `<p class="ss-patwhy">${esc(why)}</p>` : ''}
  </div>`;
}

/** The score broken down by part of the body, which was computed and never shown. */
function regionsHtml(report, lang) {
  const rows = report.regions ?? [];
  if (!rows.length) return '';
  const bars = rows.map((r) => {
    const ink = r.score == null ? 'var(--dim2)'
      : (r.score >= 85 ? INK.within_band
        : (r.score >= 65 ? INK.watch
          : (r.score >= 45 ? INK.notable : INK.marked)));
    const weak = lang === 'ko' ? r.weakest_name_ko : r.weakest_name;
    return `<div>
      <div><b>${esc(lang === 'ko' ? r.name_ko : r.name)}</b>
        <small>${esc(say('checksN', lang).replace('{n}', r.checks))}${
          weak ? ` · ${esc(say('weakest', lang))}: ${esc(weak)}` : ''}</small>
        <div class="ss-bar"><i style="width:${Math.max(2, r.score ?? 0)}%;
          background:${ink}"></i></div></div>
      <em style="color:${ink}">${r.score == null ? '—' : Math.round(r.score)}</em>
    </div>`;
  }).join('');
  return `<div class="ss-card" style="margin-top:16px">
    <h2>${esc(say('regions', lang))}</h2>
    <div class="ss-reg">${bars}</div></div>`;
}

/** How even the two sides are, as one number over the checks it averaged. */
function evennessHtml(report, lang) {
  const b = report.balance;
  if (!b?.evenness && b?.evenness !== 0) return '';
  const ink = b.evenness >= 90 ? INK.within_band
    : (b.evenness >= 75 ? INK.watch : INK.notable);
  const worst = lang === 'ko' ? b.least_even_name_ko : b.least_even_name;
  return `<div class="ss-card" style="margin-top:16px">
    <h2>${esc(say('evenness', lang))}</h2>
    <div class="ss-even"><b style="color:${ink}">${Math.round(b.evenness)}</b>
      <span style="font-size:11px;color:var(--dim2)">${esc(
        say('evenNote', lang).replace('{n}', b.from_checks))}</span></div>
    ${worst ? `<p class="ss-patwhy">${esc(say('leastEven', lang))}: ${esc(worst)}</p>`
            : ''}</div>`;
}

/** The order to work in, and when to photograph again. */
function planHeadHtml(report, lang) {
  const pri = report.priorities ?? [];
  const review = report.review ?? {};
  if (!pri.length && !review.on) return '';
  const items = pri.map((entry) => `<li>
    <b>${esc(lang === 'ko' ? entry.title_ko : entry.title)}</b>
    <span style="color:${INK[entry.severity] ?? INK.within_band}">${esc(
      lang === 'ko' ? entry.measurement_ko : entry.measurement)}</span></li>`).join('');
  return `<div class="ss-card" style="margin-top:16px">
    ${pri.length ? `<h2>${esc(say('priorities', lang))}</h2>
      <ol class="ss-pri">${items}</ol>` : ''}
    ${review.on ? `<p class="ss-patwhy" style="margin-top:${pri.length ? 12 : 0}px">
      <b style="color:var(--txt)">${esc(say('comeBack', lang))}: ${esc(review.on)}</b><br>
      ${esc(lang === 'ko' ? review.why_ko : review.why)}</p>` : ''}
  </div>`;
}

/**
 * What moved since the last assessment.
 *
 * Nothing here calls a smaller deviation an improvement -- that is a clinical
 * judgement and it belongs to the person teaching, which the line at the bottom
 * says in as many words. What is shown is the two numbers and the difference,
 * and the metrics one visit did not measure are listed as not compared rather
 * than left out, because an absence that looks like a result is the way a
 * progress report lies.
 */
function changeHtml(state, lang) {
  const change = state.change;
  if (!change) {
    return (state.history?.assessments?.length ?? 0) > 1 ? '' :
      `<div class="ss-card" style="margin-top:16px">
        <h2>${esc(say('changed', lang))}</h2>
        <p style="margin:0;font-size:12px;color:var(--dim2);line-height:1.7">
          ${esc(say('firstOne', lang))}</p></div>`;
  }
  const named = (metric) => {
    const entry = change.names?.[metric];
    return (lang === 'ko' && entry?.ko) || entry?.en || metric.replace(/_/g, ' ');
  };
  const compared = Object.entries(change.changes)
    .filter(([, c]) => c.comparable);
  const refused = Object.entries(change.changes)
    .filter(([, c]) => !c.comparable);
  const rows = compared.map(([metric, c]) => {
    const toward = c.toward_neutral;
    const ink = c.absolute === 0 ? 'var(--dim2)'
      : (toward ? INK.within_band : INK.notable);
    const word = c.absolute === 0 ? say('same', lang)
      : (toward ? say('toward', lang) : say('away', lang));
    /* Degrees as degrees, everything else as a percentage of a body length
     * -- the same spelling the measurement layer uses, so a change and the
     * number it changed from are written in one unit. */
    const fmt = (v) => (c.unit === 'deg'
      ? `${v > 0 ? '+' : ''}${v.toFixed(1)}°`
      : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
    return `<div><b>${esc(named(metric))}</b>
      <span class="ss-was">${esc(fmt(c.before))} → ${esc(fmt(c.after))}</span>
      <span style="color:${ink};font-size:10.5px">${esc(word)}</span>
      <span class="ss-num" style="color:${ink}">${esc(fmt(c.absolute))}</span>
      </div>`;
  }).join('');
  const delta = change.score_change;
  const deltaInk = delta == null ? 'var(--dim2)'
    : (delta > 0 ? INK.within_band : (delta < 0 ? INK.notable : 'var(--dim2)'));
  return `<div class="ss-card" style="margin-top:16px">
    <h2>${esc(say('changed', lang))} ${esc(change.before_on)}</h2>
    ${delta == null ? '' : `<div class="ss-delta" style="color:${deltaInk}">
      ${delta > 0 ? '+' : ''}${delta.toFixed(1)}
      <span style="font-size:11px;font-weight:400;color:var(--dim2)">
      ${change.before_score == null ? '' : `${Math.round(change.before_score)} → ${Math.round(change.after_score)}`}
      </span></div>`}
    <div class="ss-chg">${rows}</div>
    ${refused.length ? `<p style="margin:12px 0 0;font-size:10.5px;
      color:var(--dim2);line-height:1.7">${esc(say('notCompared', lang))}:
      ${esc(refused.map(([m]) => named(m)).join(', '))}</p>` : ''}
    <p style="margin:12px 0 0;font-size:10.5px;color:var(--dim2);
      line-height:1.7">${esc(say('judgement', lang))}</p></div>`;
}

/* -------------------------------------------------------------------- state */

export function mount(nw, served, who) {
  /* `who` is a function, not a value: signing in, signing out and switching
   * studio all happen while this button is sitting in the header, and a
   * captured identity would still be the one from page load when somebody
   * finally presses it. */
  const identity = typeof who === 'function' ? who : () => who;
  if (document.getElementById('ss-pos-open')) return null;
  const style = document.createElement('style');
  style.id = 'ss-pos-style';
  style.textContent = STYLE;
  document.head.appendChild(style);

  const lang = () => nw?.app?.lang ?? 'en';
  const open = document.createElement('button');
  open.id = 'ss-pos-open';
  open.type = 'button';
  open.innerHTML = `<i></i><span>${esc(say('open', lang()))}</span>`;
  open.addEventListener('click', () => screen(nw, served, identity()));

  /* In the header beside Record, and before it: the assessment is what
   * happens at the door and the recording is what happens in the class, so
   * the order on screen is the order in the studio. */
  const bar = document.getElementById('topbar');
  const record = document.getElementById('ss-rec-open');
  const chips = document.getElementById('discBar');
  if (bar && record) bar.insertBefore(open, record);
  else if (bar && chips) bar.insertBefore(open, chips);
  else if (bar) bar.appendChild(open);
  else document.body.appendChild(open);
  return open;
}

function screen(nw, served, identity) {
  /* A screen already open may be *hidden* rather than closed -- somebody
   * stepped out to look at an exercise and pressed the header button instead
   * of the way back. Close it properly, or its photographs leak and its way
   * back floats over the new screen pointing at a detached node. */
  document.getElementById('ss-pos')?.dispatchEvent(new CustomEvent('ss-shut'));
  document.getElementById('ss-pos')?.remove();
  document.getElementById('ss-pos-back')?.remove();
  const host = document.createElement('div');
  host.id = 'ss-pos';
  document.body.appendChild(host);
  const state = {
    photos: new Map(),       // view -> { file, dataUrl, objectUrl }
    protocol: null,
    report: null,
    busy: false,
    error: '',
    who: '',
    taken: new Date().toISOString().slice(0, 10),
    history: null,          // what is already on file, newest first
    change: null,           // this assessment against the one before it
  };
  const lang = () => nw?.app?.lang ?? 'en';
  const shut = () => {
    for (const shot of state.photos.values()) URL.revokeObjectURL(shot.objectUrl);
    document.getElementById('ss-pos-back')?.remove();
    host.remove();
  };
  /* So a replacement screen can release this one's photographs without
   * reaching inside it for the state. */
  host.addEventListener('ss-shut', shut);
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });

  const draw = () => {
    host.innerHTML = state.report
      ? reportHtml(state, lang(), identity)
      : intakeHtml(state, served, lang(), identity);
    wire(host, state, nw, served, identity, draw, shut);
  };
  draw();
  host.tabIndex = -1;
  host.focus();
  /* What is already on file, fetched after the first paint rather than before
   * it: the screen is useful with no history and a page that waits on a
   * request before drawing anything is a page that looks broken on a slow
   * connection. */
  loadHistory(state, draw);
  return host;
}


async function loadHistory(state, draw) {
  try {
    const response = await fetch('/assessments');
    if (!response.ok) return;
    const body = await response.json();
    state.history = body;
    draw();
  } catch { /* no server behind this copy; the screen says so already */ }
}

/* ------------------------------------------------------------------- intake */

/** The four photographs, named here only until the server has answered once. */
const FALLBACK = [
  { view: 'front', title: 'Front', title_ko: '정면',
    how: 'Face the camera square on, arms relaxed at your sides, feet under your hips, looking straight ahead.',
    how_ko: '카메라를 정면으로 바라보고 서세요. 팔은 몸 옆에 편하게 내리고, 발은 골반 너비로, 시선은 앞을 봅니다.' },
  { view: 'side_left', title: 'Left side', title_ko: '좌측면',
    how: 'Turn so your left shoulder is toward the camera. Arms relaxed, look straight ahead — not at the camera.',
    how_ko: '왼쪽 어깨가 카메라를 향하도록 서세요. 팔은 편하게 내리고 카메라가 아니라 정면을 바라봅니다.' },
  { view: 'side_right', title: 'Right side', title_ko: '우측면',
    how: 'Turn so your right shoulder is toward the camera. Arms relaxed, look straight ahead — not at the camera.',
    how_ko: '오른쪽 어깨가 카메라를 향하도록 서세요. 팔은 편하게 내리고 카메라가 아니라 정면을 바라봅니다.' },
  { view: 'rear', title: 'Back', title_ko: '후면',
    how: 'Turn your back to the camera, arms relaxed at your sides, feet under your hips.',
    how_ko: '카메라를 등지고 서세요. 팔은 몸 옆에 편하게 내리고, 발은 골반 너비로 둡니다.' },
];

const titleOf = (slot, lang) => (lang === 'ko' && slot.title_ko) || slot.title;
const howOf = (slot, lang) => (lang === 'ko' && slot.how_ko) || slot.how;

function intakeHtml(state, served, lang, identity) {
  const slots = state.protocol ?? FALLBACK;
  const canRun = served?.intake !== false;
  const signedIn = identity?.signed_in !== false;
  const cards = slots.map((slot) => {
    const shot = state.photos.get(slot.view);
    return `<div class="ss-slot${shot ? ' ss-has' : ''}">
      <div class="ss-cap">${esc(titleOf(slot, lang))}</div>
      ${shot ? `<img class="ss-shot" src="${shot.objectUrl}" alt="">`
             : `<div class="ss-how">${esc(howOf(slot, lang))}</div>`}
      <div class="ss-row">
        <button type="button" data-pick="${slot.view}">${esc(
          shot ? say('replace', lang) : say('add', lang))}</button>
        ${shot ? `<button type="button" data-drop="${slot.view}">${esc(
          say('remove', lang))}</button>` : ''}
      </div>
      <input type="file" accept="image/*" hidden data-file="${slot.view}">
    </div>`;
  }).join('');

  return `<div class="ss-sheet">
    <header class="ss-top">
      <div>
        <h1>${esc(say('title', lang))}</h1>
      </div>
      <div class="ss-acts">
        <button type="button" class="ss-b" data-lang>${esc(say('other', lang))}</button>
        <button type="button" class="ss-b" data-close>${esc(say('close', lang))}</button>
      </div>
    </header>
    <p class="ss-lede">${esc(say('lede', lang))}</p>
    ${signedIn ? '' : `<p class="ss-bad">${esc(say('signIn', lang))}</p>`}
    ${canRun ? '' : `<p class="ss-bad">${esc(say('offline', lang))}</p>`}
    ${historyHtml(state, lang)}
    <div class="ss-who">
      <div><label>${esc(say('taken', lang))}</label>
        <input type="date" data-taken value="${esc(state.taken)}"></div>
      ${identity?.can?.coach ? `<div><label>${esc(say('forWhom', lang))}</label>
        <input type="text" data-who value="${esc(state.who)}"
          placeholder="${esc(say('myself', lang))}"></div>` : ''}
    </div>
    <div class="ss-slots">${cards}</div>
    <p class="ss-privacy">${esc(say('privacy', lang))}</p>
    <div class="ss-go">
      <button type="button" class="ss-b ss-primary" data-run
        ${state.busy || !state.photos.size || !canRun ? 'disabled' : ''}>${esc(
          state.busy ? say('working', lang) : say('analyse', lang))}</button>
      ${state.error ? `<span class="ss-bad">${esc(state.error)}</span>` : ''}
      ${!state.photos.size ? `<span class="ss-bad">${esc(say('need', lang))}</span>` : ''}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------- report */

function marksFor(report, view, lang) {
  const land = report.landmarks?.[view];
  if (!land) return [];
  const readings = report.assessment.readings ?? {};
  const bySeverity = new Map(
    (report.findings ?? []).map((f) => [f.metric, f]));
  const out = [];
  for (const [metric, joints] of Object.entries(ANCHOR)) {
    const reading = readings[metric];
    if (!reading || reading.value == null) continue;
    if (!reading.sources.includes(view)) continue;
    const at = anchorOf(land, joints);
    if (!at) continue;
    const finding = bySeverity.get(metric);
    const severity = finding?.severity ?? 'within_band';
    const level = LEVELS.find(([name]) => name === metric);
    out.push({
      metric, at, level, severity,
      ink: INK[severity] ?? INK.within_band,
      name: nameOf(report, metric, lang),
      value: finding?.display ?? formatValue(metric, reading),
      way: (lang === 'ko' ? finding?.short_ko : finding?.short) ?? '',
      disputed: reading.contested,
    });
  }
  out.sort((a, b) => a.at[1] - b.at[1]);
  out.forEach((mark, i) => { mark.n = i + 1; });
  return out;
}

/** Only ever a fallback: the server formats every number it sends. */
function formatValue(metric, reading) {
  if (reading.value == null) return '—';
  if (reading.unit === 'deg') return `${reading.value > 0 ? '+' : ''}${reading.value.toFixed(1)}°`;
  if (metric === 'torso_rotation_index') return `${reading.value.toFixed(2)}×`;
  return `${reading.value > 0 ? '+' : ''}${Math.round(reading.value * 100)}%`;
}

/**
 * What to call a measurement beside a photograph.
 *
 * The short name, never the finding's title: a legend row has room for
 * "shoulder level" and not for "Left shoulder sits higher than the right",
 * which belongs in the findings list underneath where there is room for the
 * sentence and for the number it rests on.
 */
function nameOf(report, metric, lang) {
  const named = report.names?.[metric];
  if (named) return (lang === 'ko' && named.ko) || named.en;
  return metric.replace(/_/g, ' ');
}

function bandInk(band) {
  return { Excellent: '#4fbf87', Good: '#7bc98a', Fair: '#d9c05a',
           'Needs attention': '#e79a3c', 'Needs work': '#e05a48' }[band]
    ?? '#8b95ab';
}

function reportHtml(state, lang, identity) {
  const report = state.report;
  const score = report.score;
  const ink = bandInk(score.band);
  const ladder = (score.bands ?? []).map((b) => {
    const now = b.en === score.band;
    return `<div class="${now ? 'now' : ''}"><i style="background:${bandInk(b.en)}"></i>
      <span>${esc(lang === 'ko' ? b.ko : b.en)}</span><em>${b.from}+</em></div>`;
  }).join('');

  /* One box for all four cards, shaped by the narrowest photograph in the set.
   *
   * A fixed ratio wastes the thing the report is about: a standing shot
   * cropped to the body is tall and thin -- 116x360 in the studio's first
   * real set -- and putting that in a 3:4 box is two thirds black. Taking the
   * narrowest aspect present means that photograph fills the box, the wider
   * ones letterbox by a little, and every body is drawn as large as the set
   * allows. Clamped so one freak crop cannot make four half-metre columns. */
  const ratio = Math.max(0.28, Math.min(0.9, Math.min(
    ...Object.values(report.landmarks ?? {})
      .map((l) => (l.width || 3) / (l.height || 4)), 0.75)));
  const frame = `style="aspect-ratio:${ratio.toFixed(4)}"`;

  const shots = (report.protocol ?? FALLBACK).map((slot) => {
    const shot = state.photos.get(slot.view);
    const land = report.landmarks?.[slot.view];
    const photo = report.assessment.photos?.[slot.view];
    if (!shot) {
      return `<figure><div class="ss-frame" ${frame}><div style="position:absolute;
        inset:0;display:flex;align-items:center;justify-content:center">
        <span style="font-size:11px;color:var(--dim2);padding:18px;
          text-align:center;line-height:1.7">${esc(howOf(slot, lang))}</span>
        </div></div><figcaption>${esc(titleOf(slot, lang))}
        <small>${esc(say('notTaken', lang))}</small></figcaption></figure>`;
    }
    const marks = land ? marksFor(report, slot.view, lang) : [];
    const rows = marks.map((mark) => `<button type="button"
      data-mark="${esc(slot.view)}:${esc(mark.metric)}">
      <i class="ss-pip" style="background:${mark.ink}"></i>
      <span>${mark.n}. ${esc(mark.name)}</span>
      ${mark.way ? `<span class="ss-way">${esc(mark.way)}</span>` : ''}
      <span class="ss-val" style="color:${mark.ink}">${esc(mark.value)}</span>
    </button>`).join('');
    return `<figure>
      <div class="ss-frame" ${frame}><img src="${shot.objectUrl}" alt="">
        ${land ? overlay(land, marks) : ''}</div>
      <figcaption>${esc(titleOf(slot, lang))}
        ${photo?.problem ? `<small>${esc(photo.problem)}</small>` : ''}</figcaption>
      <div class="ss-marks">${rows}</div>
    </figure>`;
  }).join('');

  const findings = (report.findings ?? []).map((f) => {
    const colour = INK[f.severity] ?? INK.within_band;
    const pills = (f.exercises ?? []).filter((e) => EXERCISE[e.key])
      .map((e) => `<button type="button" data-ex="${esc(e.key)}"
        title="${esc(lang === 'ko' ? e.why_ko : e.why)}">${esc(
          (lang === 'ko' && e.name_ko) || e.name || e.key)}</button>`).join('');
    const usually = lang === 'ko' ? f.usually_ko : f.usually;
    return `<div class="ss-find" style="border-left-color:${colour}">
      <h3>${esc((lang === 'ko' && f.title_ko) || f.title)}</h3>
      <div class="ss-num" style="color:${colour}">${esc(
        (lang === 'ko' && f.measurement_ko) || f.measurement)}
        <span style="font-size:10px;font-weight:400;color:var(--dim2)">
        ${esc(T.severityWords[f.severity]?.[lang] ?? f.severity)}</span></div>
      <p>${esc((lang === 'ko' && f.means_ko) || f.means)}</p>
      <p class="ss-ev">${esc((lang === 'ko' && f.evidence_ko) || f.evidence)}</p>
      ${usually ? `<p class="ss-why">${esc(say('usually', lang))}: ${esc(usually)}</p>` : ''}
      ${pills ? `<div class="ss-pills">${pills}</div>` : ''}
    </div>`;
  }).join('');

  const plan = (report.programme ?? []).map((entry) => {
    const name = (lang === 'ko' && entry.name_ko) || entry.name || entry.key;
    const why = (lang === 'ko' ? entry.why_ko?.[0] : entry.why?.[0]) ?? '';
    return `<li><b>${esc(name)}</b> — ${esc(why)}
      ${EXERCISE[entry.key] ? `<div class="ss-pills"><button type="button"
        data-ex="${esc(entry.key)}">${esc(say('showOn', lang))}</button></div>`
        : ''}</li>`;
  }).join('');

  const habits = (report.habits ?? []).map(
    (h) => `<li>${esc(lang === 'ko' ? h.ko : h.en)}</li>`).join('');

  const refused = (report.refused_detail ?? []).map((e) => `<div>
    <b>${esc(lang === 'ko' ? e.name_ko : e.name)}</b>
    <p>${esc(lang === 'ko' ? e.reason_ko : e.reason)}</p></div>`).join('');

  const missing = (report.missing_photos ?? []).map((slot) => `<div>
    <b>${esc(lang === 'ko' ? slot.title_ko : slot.title)}</b>
    <p>${esc(lang === 'ko' ? slot.how_ko : slot.how)}</p></div>`).join('');

  /* Doubts first and separately: a gap in the set is answered by taking the
   * missing photograph, and a doubt is answered by retaking one that was
   * taken. Showing them in one list makes the second look like the first. */
  const doubts = report.doubts ?? [];
  const warnings = (report.warnings ?? [])
    .filter((w) => !/^no .* photograph:/.test(w) && !doubts.includes(w));
  const held = (lang === 'ko' ? report.findings_note_ko
                              : report.findings_note) ?? '';
  /* Not listed while the photographs are in doubt: "inside its usual range" is
   * a finding, and a finding about a body that may not have been the one
   * measured is the same mistake as a score. */
  const inRange = held ? '' : (report.unremarkable_detail ?? [])
    .map((e) => (lang === 'ko' ? e.name_ko : e.name)).join(', ');

  return `<div class="ss-sheet">
    <header class="ss-top">
      <div><h1>${esc(say('title', lang))}</h1>
        <p class="ss-lede" style="margin-bottom:0">${esc(state.taken)}${
          state.who ? ` · ${esc(state.who)}` : ''}</p></div>
      <div class="ss-acts">
        <button type="button" class="ss-b" data-lang>${esc(say('other', lang))}</button>
        <button type="button" class="ss-b" data-again>${esc(say('again', lang))}</button>
        <button type="button" class="ss-b" data-print>${esc(say('print', lang))}</button>
        <button type="button" class="ss-b" data-close>${esc(say('close', lang))}</button>
      </div>
    </header>
    <div class="ss-shots">${shots}</div>
    <div class="ss-grid">
      <div>
        <div class="ss-card" style="color:${ink}">
          ${dial(score.value, ink, lang)}
          <div class="ss-band">${esc(lang === 'ko' ? score.band_ko : score.band)}</div>
          <div class="ss-bandnote">${esc(lang === 'ko' ? score.note_ko : score.note)}</div>
          <div class="ss-ladder">${ladder}</div>
        </div>
        ${evennessHtml(report, lang)}
        ${regionsHtml(report, lang)}
      </div>
      <div>
        ${patternHtml(report, lang)}
        <div class="ss-card" style="margin-top:16px">
          <h2>${esc(say('findings', lang))}</h2>
          ${held ? `<p style="margin:0 0 14px;font-size:12px;
            color:${INK.notable};line-height:1.7">${esc(held)}</p>` : ''}
          ${findings || (held ? '' : `<p style="margin:0;font-size:12px;
            color:${INK.within_band}">${esc(say('clear', lang))}</p>`)}
        </div>
        ${planHeadHtml(report, lang)}
        ${plan ? `<div class="ss-card" style="margin-top:16px">
          <h2>${esc(say('plan', lang))}</h2>
          <ol class="ss-plan">${plan}</ol></div>` : ''}
        ${habits ? `<div class="ss-card" style="margin-top:16px">
          <h2>${esc(say('habits', lang))}</h2>
          <ul class="ss-habits">${habits}</ul></div>` : ''}
        ${changeHtml(state, lang)}
      </div>
    </div>
    <div class="ss-limits">
      ${refused ? `<div class="ss-card"><h2>${esc(say('cannot', lang))}</h2>
        ${refused}</div>` : ''}
      ${missing ? `<div class="ss-card"><h2>${esc(say('notTaken', lang))}</h2>
        ${missing}</div>` : ''}
      ${doubts.length ? `<div class="ss-card"><h2>${esc(say('retake', lang))}</h2>
        ${doubts.map((w) => `<p style="margin:0 0 9px;font-size:11px;
          color:${INK.notable};line-height:1.7">${esc(w)}</p>`).join('')}</div>` : ''}
      ${warnings.length ? `<div class="ss-card"><h2>${esc(say('worth', lang))}</h2>
        ${warnings.map((w) => `<p style="margin:0 0 9px;font-size:11px;
          color:var(--dim2);line-height:1.7">${esc(w)}</p>`).join('')}</div>` : ''}
      ${inRange ? `<div class="ss-card"><h2>${esc(say('inRange', lang))}</h2>
        <p style="margin:0;font-size:11px;color:var(--dim2);line-height:1.7">
        ${esc(inRange)}</p></div>` : ''}
    </div>
    <p class="ss-disc">${esc(lang === 'ko' ? report.disclaimer_ko
                                        : report.disclaimer)}</p>
  </div>`;
}

/* ---------------------------------------------------------------- behaviour */

function wire(host, state, nw, served, identity, draw, shut) {
  host.querySelector('[data-close]')?.addEventListener('click', shut);
  host.querySelector('[data-again]')?.addEventListener('click', () => {
    state.report = null;
    state.error = '';
    draw();
  });
  host.querySelector('[data-print]')?.addEventListener('click', () => print());
  /* The application's own language button is behind this screen and its state
   * is only read when this one renders, so switching there while a report is
   * open does nothing visible. One here, which switches the whole application
   * and then redraws, is the same switch in the place it is wanted. */
  host.querySelector('[data-lang]')?.addEventListener('click', () => {
    const next = (nw?.app?.lang ?? 'en') === 'en' ? 'ko' : 'en';
    nw?.setLang?.(next);
    draw();
  });
  host.querySelector('[data-taken]')?.addEventListener('change', (e) => {
    state.taken = e.target.value;
  });
  host.querySelector('[data-who]')?.addEventListener('input', (e) => {
    state.who = e.target.value.trim();
  });

  for (const button of host.querySelectorAll('[data-pick]')) {
    button.addEventListener('click', () => {
      host.querySelector(`[data-file="${button.dataset.pick}"]`)?.click();
    });
  }
  for (const input of host.querySelectorAll('[data-file]')) {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const view = input.dataset.file;
      const old = state.photos.get(view);
      if (old) URL.revokeObjectURL(old.objectUrl);
      state.photos.set(view, {
        file,
        objectUrl: URL.createObjectURL(file),
        dataUrl: await readAsDataUrl(file),
      });
      state.error = '';
      draw();
    });
  }
  for (const button of host.querySelectorAll('[data-drop]')) {
    button.addEventListener('click', () => {
      const shot = state.photos.get(button.dataset.drop);
      if (shot) URL.revokeObjectURL(shot.objectUrl);
      state.photos.delete(button.dataset.drop);
      draw();
    });
  }
  host.querySelector('[data-run]')?.addEventListener('click',
    () => run(state, draw, identity));

  /* A row in the legend pulses its own dot on the photograph. The dot carries
   * a number and the row carries the same number, so the link survives the
   * pointer being somewhere else entirely -- a phone, or a printout. */
  for (const row of host.querySelectorAll('[data-mark]')) {
    const metric = row.dataset.mark.split(':')[1];
    /* Scoped to this figure: the same measurement is marked on the front and
     * the back photograph, and a document-wide lookup would light the wrong
     * one. Metric names are `[a-z_]` so they need no escaping. */
    const dot = row.closest('figure')?.querySelector(`[data-pip="${metric}"]`);
    const set = (lit) => {
      row.classList.toggle('ss-on', lit);
      if (!dot) return;
      dot.setAttribute('opacity', lit ? '1' : '.95');
      dot.style.transform = lit ? 'scale(1.35)' : '';
      dot.style.transformOrigin = 'center';
      dot.style.transformBox = 'fill-box';
    };
    row.addEventListener('mouseenter', () => set(true));
    row.addEventListener('mouseleave', () => set(false));
    row.addEventListener('focus', () => set(true));
    row.addEventListener('blur', () => set(false));
  }

  for (const pill of host.querySelectorAll('[data-ex]')) {
    pill.addEventListener('click', () => {
      /* Into the anatomy application underneath: the exercise's muscles light
       * on the body that is already loaded. A recommendation you can look at
       * beats a recommendation you can read.
       *
       * **Hidden, never closed.** This used to call shut(), which removed the
       * screen and revoked the photograph object URLs -- so the analysis was
       * gone, and reopening could not bring it back because the pictures had
       * been released. Pressing "show on the body" cost you the report you
       * were reading. */
      nw?.setExercise?.(pill.dataset.ex);
      peek(host, nw);
    });
  }
}

/**
 * Step out of the report to look at the body, with a way back.
 *
 * The screen is hidden rather than torn down, so the photographs, the
 * measurements and the scroll position are all still there when the button is
 * pressed. The button is the whole point: without it, looking at an exercise
 * is a one-way door.
 */
function peek(host, nw) {
  host.hidden = true;
  const lang = nw?.app?.lang ?? 'en';
  document.getElementById('ss-pos-back')?.remove();
  const back = document.createElement('button');
  back.id = 'ss-pos-back';
  back.type = 'button';
  back.textContent = say('back', lang);
  back.addEventListener('click', () => {
    host.hidden = false;
    back.remove();
  });
  document.body.appendChild(back);
  return back;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function run(state, draw, identity) {
  state.busy = true;
  state.error = '';
  draw();
  const photos = [...state.photos.entries()].map(([view, shot]) => ({
    view, image: shot.dataUrl, label: shot.file.name?.slice(0, 60) ?? '',
  }));
  try {
    const response = await fetch('/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos,
        taken_on: state.taken,
        ...(state.who ? { username: state.who } : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      state.error = body.error || `${response.status} ${response.statusText}`;
    } else {
      state.report = body;
      state.protocol = body.protocol ?? state.protocol;
      state.change = null;
      /* Against the one before it, automatically. A studio taking a second set
       * wants the difference, and asking them to go and find the first one is
       * asking them to do the comparison this already has both halves of. */
      const previous = state.history?.assessments?.[0];
      if (body.assessment_id && previous?.id) {
        await compareWith(state, previous.id, body.assessment_id);
      }
      loadHistory(state, draw);
    }
  } catch (error) {
    state.error = String(error?.message ?? error);
  } finally {
    state.busy = false;
    draw();
  }
  void identity;
}


async function compareWith(state, before, after) {
  try {
    const response = await fetch('/assessment/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before, after }),
    });
    if (response.ok) state.change = await response.json();
  } catch { /* the report stands on its own without it */ }
}

export const _internals = { overlay, marksFor, anchorOf, dial, spark,
                            historyHtml, changeHtml, patternHtml,
                            regionsHtml, evennessHtml, planHeadHtml,
                            formatValue, peek, INK, ANCHOR, CHIP: T };
