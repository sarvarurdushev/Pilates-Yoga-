/**
 * The movement screening screen.
 *
 * The posture screen answers *what does this body look like standing still*.
 * This one answers the question a studio asks next and cannot answer from a
 * photograph: *how far does this joint actually go, and does the other side go
 * as far*. A student is filmed doing one named movement, once per side, and
 * what comes back is how far they got, how far the published range says a body
 * goes, and the difference between the two.
 *
 * **Nothing here decides anything.** The catalogue, the reference ranges, the
 * grading and the words all come from the server, because they also have to
 * appear in a printed report and in the terminal, and three copies of a
 * threshold is three thresholds that stop matching. This file uploads clips,
 * collects the landmarks that come back, asks for the measurement, and draws
 * it.
 *
 * **The clip is never kept and never travels twice.** It goes to /landmarks,
 * comes back as numbers, and the file is deleted server-side whether the
 * extraction worked or not. The two sides of a movement are filmed separately
 * and have to be measured together, so the numbers wait in this page until
 * both are in -- which is why they are numbers and not video.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Every phrase this screen says, in both languages, in one table. The studio
   this is built for teaches in Korean, and a half-translated screen makes a
   reader switch registers mid-sentence and stop trusting both halves. */
const T = {
  open:       { en: 'Movement screening', ko: '움직임 검사' },
  title:      { en: 'Movement screening', ko: '움직임 검사' },
  lede:       { en: 'Film one named movement, once per side. What comes back is how far the joint went, against the range a body is published as having.',
                ko: '지정된 동작을 좌우 각각 한 번씩 촬영합니다. 관절이 실제로 움직인 범위를 공개된 기준 범위와 비교해 보여 줍니다.' },
  pick:       { en: 'Choose a screen', ko: '검사 항목 선택' },
  how:        { en: 'How to film it', ko: '촬영 방법' },
  view:       { en: 'Where the camera was', ko: '카메라 위치' },
  noView:     { en: 'not stated', ko: '지정 안 함' },
  viewWhy:    { en: 'Without this the numbers come back estimated: a movement partly toward the lens reads smaller than it was, and nothing can recover the difference.',
                ko: '지정하지 않으면 측정값이 추정치로 표시됩니다. 카메라 쪽으로 향하는 동작은 실제보다 작게 보이며, 그 차이는 되돌릴 수 없습니다.' },
  left:       { en: 'Left side clip', ko: '왼쪽 영상' },
  right:      { en: 'Right side clip', ko: '오른쪽 영상' },
  whole:      { en: 'Clip', ko: '영상' },
  choose:     { en: 'Choose a file', ko: '파일 선택' },
  drop:       { en: 'Remove', ko: '제거' },
  run:        { en: 'Measure it', ko: '측정하기' },
  working:    { en: 'Measuring…', ko: '측정 중…' },
  reading:    { en: 'Reading the clip…', ko: '영상 분석 중…' },
  who:        { en: 'Who this is', ko: '대상자' },
  taken:      { en: 'Filmed on', ko: '촬영일' },
  need:       { en: 'Add a clip first.', ko: '먼저 영상을 추가하세요.' },
  again:      { en: 'Screen again', ko: '다시 검사' },
  print:      { en: 'Print', ko: '인쇄' },
  close:      { en: 'Close', ko: '닫기' },
  other:      { en: '한국어', ko: 'English' },
  reached:    { en: 'reached', ko: '도달' },
  reference:  { en: 'reference', ko: '기준' },
  short:      { en: 'short', ko: '부족' },
  atRange:    { en: 'at the reference range', ko: '기준 범위 도달' },
  reps:       { en: 'repetitions', ko: '반복' },
  spread:     { en: 'spread across them', ko: '반복 간 편차' },
  tempo:      { en: 'per repetition', ko: '회당 시간' },
  ratio:      { en: 'return over out', ko: '복귀/올림 비율' },
  held:       { en: 'held', ko: '유지' },
  sway:       { en: 'drifted', ko: '흔들림' },
  ofBody:     { en: 'of body height', ko: '(신장 대비)' },
  sides:      { en: 'Left against right', ko: '좌우 비교' },
  even:       { en: 'The two sides match within the measurement itself.',
                ko: '좌우 차이가 측정 오차 범위 안에 있습니다.' },
  lessFar:    { en: 'travelled less', ko: '쪽이 덜 움직였습니다' },
  findings:   { en: 'What was found', ko: '측정 결과' },
  clear:      { en: 'Nothing outside the reference range.', ko: '기준 범위를 벗어난 항목이 없습니다.' },
  notMeasured:{ en: 'Not measured', ko: '측정하지 못함' },
  score:      { en: 'Screening score', ko: '검사 점수' },
  noScore:    { en: 'No score', ko: '점수 없음' },
  source:     { en: 'Reference', ko: '기준 출처' },
  functional: { en: 'a functional benchmark, not a clinical normal range',
                ko: '임상 정상 범위가 아닌 기능 기준입니다' },
  estimated:  { en: 'estimated', ko: '추정' },
  plan:       { en: 'What to work on', ko: '추천 운동' },
  radar:      { en: 'Range measured against range expected', ko: '관절 가동 범위 비교' },
  radarNote:  { en: 'The outer ring is the published reference. Each spoke is the side that travelled less, because a body with one stiff shoulder is a body with a stiff shoulder.',
                ko: '바깥 원은 공개된 기준 범위입니다. 각 축은 덜 움직인 쪽을 표시합니다. 한쪽이 뻣뻣하면 그 몸은 뻣뻣한 쪽을 기준으로 봐야 하기 때문입니다.' },
  showOn:     { en: 'Show on the body', ko: '신체에서 보기' },
  history:    { en: 'Earlier screenings', ko: '이전 검사' },
  change:     { en: 'Against the last one', ko: '이전 검사와 비교' },
  noEarlier:  { en: 'Nothing earlier on file. This one is the starting point.',
                ko: '이전 기록이 없습니다. 이번 검사가 기준점이 됩니다.' },
  notCompared:{ en: 'Not compared', ko: '비교 불가' },
  offline:    { en: 'This copy of the site cannot measure a clip. It needs the analysis half of the project running behind it.',
                ko: '이 사이트에서는 영상을 측정할 수 없습니다. 분석 서버가 함께 실행되어야 합니다.' },
  loading:    { en: 'Fetching how to film this…', ko: '촬영 방법을 불러오는 중…' },
  checksN:    { en: '{n} checks', ko: '{n}개 항목' },
  back:       { en: '\u2190  Back to the screening', ko: '\u2190  검사 결과로 돌아가기' },
};

const say = (key, lang) => (T[key] ?? {})[lang] ?? (T[key] ?? {}).en ?? key;

/* The severity colours the posture screen already uses. One vocabulary across
   the product: a reader should not have to learn two. */
const INK = {
  marked: '#e0603f', notable: '#e8a33a', watch: '#d8c25e',
  within_band: '#5fb98a', none: '#7d8ea4',
};

const STYLE = `
#ss-mv-open{flex:none;align-self:flex-start;display:inline-flex;gap:9px;
  align-items:center;padding:7px 15px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;font-weight:500;letter-spacing:.11em;
  text-transform:uppercase;white-space:nowrap;background:var(--glass);
  border:1px solid var(--line2);color:var(--dim)}
#ss-mv-open:hover{color:var(--txt);border-color:var(--acc)}
#ss-mv-open i{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--acc)}
#ss-mv, #ss-mv *{box-sizing:border-box;text-transform:none;letter-spacing:normal;
  white-space:normal;max-height:none}
#ss-mv{position:fixed;inset:0;z-index:130;overflow:auto;
  background:linear-gradient(180deg,#070b12,#04070c);color:var(--txt)}
#ss-mv .ss-sheet{max-width:1080px;margin:0 auto;padding:26px 22px 90px}
#ss-mv h1{margin:0;font-size:21px;font-weight:500}
#ss-mv h2{margin:0 0 12px;font-size:12px;font-weight:600;color:var(--dim);
  letter-spacing:.08em;text-transform:uppercase}
#ss-mv .ss-top{display:flex;gap:18px;align-items:flex-start;
  justify-content:space-between;flex-wrap:wrap;margin:0 0 20px}
#ss-mv .ss-lede{margin:6px 0 0;font-size:12.5px;color:var(--dim2);
  line-height:1.75;max-width:62ch}
#ss-mv .ss-acts{display:flex;gap:8px;flex-wrap:wrap}
#ss-mv .ss-b{padding:8px 14px;border-radius:4px;font:inherit;font-size:12px;
  cursor:pointer;background:var(--glass);border:1px solid var(--line2);
  color:var(--dim)}
#ss-mv .ss-b:hover{color:var(--txt);border-color:var(--acc)}
#ss-mv .ss-card{border:1px solid var(--line);border-radius:8px;padding:18px;
  background:rgba(255,255,255,.02);margin:0 0 16px}
#ss-mv .ss-screens{display:grid;gap:10px;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
#ss-mv .ss-screens button{text-align:left;padding:13px 15px;border-radius:7px;
  font:inherit;cursor:pointer;background:var(--glass);
  border:1px solid var(--line2);color:var(--dim);line-height:1.6}
#ss-mv .ss-screens button b{display:block;font-size:13px;font-weight:600;
  color:var(--txt);margin:0 0 3px}
#ss-mv .ss-screens button small{font-size:10.5px;color:var(--dim2)}
#ss-mv .ss-screens button[aria-pressed=true]{border-color:var(--acc);
  background:rgba(90,169,230,.12)}
#ss-mv .ss-how{margin:0;font-size:12.5px;line-height:1.8;color:var(--txt)}
#ss-mv .ss-row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;
  margin:14px 0 0}
#ss-mv label{display:block;font-size:11px;color:var(--dim);margin:0 0 5px}
#ss-mv select, #ss-mv input[type=text], #ss-mv input[type=date]{
  padding:8px 10px;border-radius:4px;font:inherit;font-size:12.5px;
  background:#0a1017;border:1px solid var(--line2);color:var(--txt)}
#ss-mv .ss-clips{display:grid;gap:12px;margin:14px 0 0;
  grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
#ss-mv .ss-clip{border:1px dashed var(--line2);border-radius:7px;padding:16px;
  text-align:center;font-size:12px;color:var(--dim)}
#ss-mv .ss-clip.ss-has{border-style:solid;border-color:var(--acc);
  color:var(--txt)}
#ss-mv .ss-clip b{display:block;font-size:12px;margin:0 0 8px;color:var(--dim)}
#ss-mv .ss-clip button{margin:8px 4px 0;padding:6px 12px;border-radius:4px;
  font:inherit;font-size:11.5px;cursor:pointer;background:var(--glass);
  border:1px solid var(--line2);color:var(--dim)}
#ss-mv .ss-clip input{display:none}
#ss-mv .ss-go{margin:18px 0 0;padding:11px 22px;border-radius:5px;border:0;
  font:inherit;font-size:13px;font-weight:600;cursor:pointer;
  background:var(--acc);color:#04121f}
#ss-mv .ss-go:disabled{opacity:.5;cursor:default}
#ss-mv .ss-err{margin:12px 0 0;font-size:12px;color:${INK.marked};
  line-height:1.7}
#ss-mv .ss-log{margin:12px 0 0;font-size:11px;color:var(--dim2);
  line-height:1.7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
/* The bar: what was reached against what the reference says. Drawn rather than
   written because the question is "how much of it" and a proportion is the one
   thing a picture answers faster than a sentence. */
#ss-mv .ss-bar{position:relative;height:10px;border-radius:5px;
  background:rgba(255,255,255,.06);margin:9px 0 0;overflow:hidden}
#ss-mv .ss-bar i{position:absolute;inset:0 auto 0 0;border-radius:5px;
  display:block}
#ss-mv .ss-side{margin:0 0 18px}
#ss-mv .ss-side:last-child{margin-bottom:0}
#ss-mv .ss-side h3{margin:0 0 4px;font-size:12.5px;font-weight:600;
  color:var(--txt)}
#ss-mv .ss-num{font-size:19px;font-weight:600;letter-spacing:-.01em}
#ss-mv .ss-detail{margin:9px 0 0;font-size:11.5px;color:var(--dim2);
  line-height:1.8}
#ss-mv .ss-detail span{margin-right:14px;white-space:nowrap}
#ss-mv .ss-note{margin:7px 0 0;font-size:11px;color:${INK.watch};
  line-height:1.7}
#ss-mv .ss-find{border-left:2px solid var(--line2);padding:2px 0 2px 13px;
  margin:0 0 14px}
#ss-mv .ss-find b{display:block;font-size:12.5px;font-weight:600;
  margin:0 0 3px}
#ss-mv .ss-find p{margin:0;font-size:11.5px;color:var(--dim2);line-height:1.7}
#ss-mv .ss-plan{margin:0;padding:0 0 0 18px;font-size:12.5px;line-height:1.8}
#ss-mv .ss-plan li{margin:0 0 12px}
#ss-mv .ss-plan b{font-weight:600;color:var(--txt)}
#ss-mv .ss-plan small{display:block;font-size:10.5px;color:var(--dim2)}
#ss-mv .ss-plan button{margin:5px 0 0;padding:5px 11px;border-radius:4px;
  font:inherit;font-size:11px;cursor:pointer;background:var(--glass);
  border:1px solid var(--line2);color:var(--dim)}
#ss-mv .ss-plan button:hover{color:var(--txt);border-color:var(--acc)}
#ss-mv .ss-radar{width:100%;max-width:430px;height:auto;display:block;
  margin:0 auto 10px}
#ss-mv .ss-radarnote{margin:0;font-size:10.5px;color:var(--dim2);
  line-height:1.7}
#ss-mv .ss-grid{display:grid;gap:16px;
  grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
#ss-mv .ss-disc{margin:26px 0 0;font-size:10.5px;color:var(--dim2);
  line-height:1.8;max-width:76ch}
#ss-mv[hidden]{display:none}
#ss-mv-back{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;
  z-index:140;padding:10px 20px;border-radius:22px;font:inherit;font-size:13px;
  font-weight:600;cursor:pointer;background:var(--acc);border:0;color:#04121f;
  box-shadow:0 8px 28px rgba(0,0,0,.5)}
#ss-mv-back:hover{filter:brightness(1.1)}
@media print{
  #ss-mv{position:static;background:#fff;color:#000}
  #ss-mv .ss-acts,#ss-mv .ss-go,#ss-mv .ss-screens{display:none}
}
`;

/* ------------------------------------------------------------------ mount */

export function mount(nw, served, who) {
  const identity = typeof who === 'function' ? who : () => who;
  if (document.getElementById('ss-mv-open')) return null;
  const style = document.createElement('style');
  style.id = 'ss-mv-style';
  style.textContent = STYLE;
  document.head.appendChild(style);

  const lang = () => nw?.app?.lang ?? 'en';
  const open = document.createElement('button');
  open.id = 'ss-mv-open';
  open.type = 'button';
  open.innerHTML = `<i></i><span>${esc(say('open', lang()))}</span>`;
  open.addEventListener('click', () => screen(nw, served, identity()));

  /* After the posture button: a studio assesses somebody standing, screens
   * how they move, and then teaches the class. The header says so. */
  const bar = document.getElementById('topbar');
  const posture = document.getElementById('ss-pos-open');
  const record = document.getElementById('ss-rec-open');
  if (bar && record) bar.insertBefore(open, record);
  else if (bar && posture) bar.insertBefore(open, posture.nextSibling);
  else if (bar) bar.appendChild(open);
  else document.body.appendChild(open);
  return open;
}

function screen(nw, served, identity) {
  document.getElementById('ss-mv')?.remove();
  document.getElementById('ss-mv-back')?.remove();
  const host = document.createElement('div');
  host.id = 'ss-mv';
  document.body.appendChild(host);
  const state = {
    catalogue: CATALOGUE,
    chosen: CATALOGUE[0]?.key ?? '',
    view: '',
    clips: new Map(),      // side -> File
    busy: false,
    progress: '',
    error: '',
    who: '',
    taken: new Date().toISOString().slice(0, 10),
    report: null,
    history: null,     // what is already on file, newest first
    change: null,      // this screening against the one before it
  };
  const lang = () => nw?.app?.lang ?? 'en';
  const shut = () => {
    document.getElementById('ss-mv-back')?.remove();
    host.remove();
  };
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });

  const draw = () => {
    host.innerHTML = state.report
      ? reportHtml(state, lang())
      : setupHtml(state, served, lang());
    wire(host, state, nw, served, identity, draw, shut);
  };
  draw();
  host.tabIndex = -1;
  host.focus();
  /* After the first paint rather than before it: the screen is useful with
     the built-in list, and a page that waits on a request to draw anything is
     a page that looks broken on a slow connection. */
  loadCatalogue(state, draw);
  return host;
}

/* The catalogue as this page knows it before the server answers. Enough to
   draw the choice and the instruction; every number in a report still comes
   from the measurement, never from here. */
const CATALOGUE = [
  { key: 'shoulder_abduction', sided: true, kind: 'range',
    name: 'Shoulder abduction', name_ko: '어깨 벌림',
    views: ['front', 'rear'] },
  { key: 'shoulder_flexion', sided: true, kind: 'range',
    name: 'Shoulder flexion', name_ko: '어깨 굽힘',
    views: ['side_left', 'side_right'] },
  { key: 'hip_flexion', sided: true, kind: 'range',
    name: 'Hip flexion', name_ko: '엉덩관절 굽힘',
    views: ['side_left', 'side_right'] },
  { key: 'knee_flexion', sided: true, kind: 'range',
    name: 'Knee flexion', name_ko: '무릎 굽힘',
    views: ['side_left', 'side_right'] },
  { key: 'squat_depth', sided: true, kind: 'range',
    name: 'Squat depth', name_ko: '스쿼트 깊이',
    views: ['side_left', 'side_right'] },
  { key: 'single_leg_balance', sided: true, kind: 'hold',
    name: 'Single-leg balance', name_ko: '한 발 서기 균형',
    views: ['front', 'rear'] },
];

const VIEW_NAME = {
  front: { en: 'front', ko: '정면' }, rear: { en: 'back', ko: '후면' },
  side_left: { en: 'left side', ko: '좌측면' },
  side_right: { en: 'right side', ko: '우측면' },
};

const SIDE_NAME = {
  left: { en: 'Left', ko: '왼쪽' }, right: { en: 'Right', ko: '오른쪽' },
  both: { en: 'Whole body', ko: '몸 전체' },
};

const named = (entry, lang) => (lang === 'ko' && entry?.name_ko) || entry?.name || '';

/**
 * What to call a screen, from whichever list knows it.
 *
 * The history strip is given keys, not names -- a filed row stores what was
 * screened, not what it is called this month -- so it has to look them up.
 * The report's own catalogue first, then the page's, then the key itself,
 * which is how "shoulder_flexion" ended up printed on a Korean page.
 */
function screenName(state, key, lang) {
  const entry = (state.report?.catalogue_detail ?? [])
      .find((s) => s.key === key)
    ?? (state.catalogue ?? []).find((s) => s.key === key);
  return named(entry, lang) || key.replace(/_/g, ' ');
}

export function screenOf(state) {
  return state.catalogue.find((s) => s.key === state.chosen) ?? state.catalogue[0];
}

export function sidesOf(screenEntry) {
  return screenEntry?.sided ? ['left', 'right'] : ['both'];
}

/* ------------------------------------------------------------------- setup */

function setupHtml(state, served, lang) {
  if (served && served.screening === false) {
    return `<div class="ss-sheet">
      <div class="ss-top"><div><h1>${esc(say('title', lang))}</h1></div>
        <div class="ss-acts">
          <button type="button" class="ss-b" data-close>${esc(say('close', lang))}</button>
        </div></div>
      <div class="ss-card"><p class="ss-how">${esc(say('offline', lang))}</p></div>
    </div>`;
  }

  const entry = screenOf(state);
  const sides = sidesOf(entry);
  const chips = state.catalogue.map((s) => `<button type="button"
    data-screen="${esc(s.key)}" aria-pressed="${s.key === state.chosen}">
    <b>${esc(named(s, lang))}</b>
    <small>${esc(s.views.map((v) => VIEW_NAME[v]?.[lang] ?? v).join(' / '))}</small>
  </button>`).join('');

  const views = entry.views.map((v) => `<option value="${esc(v)}"
    ${state.view === v ? 'selected' : ''}>${esc(VIEW_NAME[v]?.[lang] ?? v)}</option>`).join('');

  const clips = sides.map((side) => {
    const file = state.clips.get(side);
    const label = side === 'both' ? say('whole', lang) : say(side, lang);
    return `<div class="ss-clip ${file ? 'ss-has' : ''}">
      <b>${esc(label)}</b>
      <div>${file ? esc(file.name.slice(0, 40)) : '—'}</div>
      <input type="file" accept="video/*" data-file="${esc(side)}">
      <button type="button" data-pick="${esc(side)}">${esc(say('choose', lang))}</button>
      ${file ? `<button type="button" data-drop="${esc(side)}">${
        esc(say('drop', lang))}</button>` : ''}
    </div>`;
  }).join('');

  return `<div class="ss-sheet">
    <div class="ss-top">
      <div><h1>${esc(say('title', lang))}</h1>
        <p class="ss-lede">${esc(say('lede', lang))}</p></div>
      <div class="ss-acts">
        <button type="button" class="ss-b" data-lang>${esc(say('other', lang))}</button>
        <button type="button" class="ss-b" data-close>${esc(say('close', lang))}</button>
      </div>
    </div>
    <div class="ss-card">
      <h2>${esc(say('pick', lang))}</h2>
      <div class="ss-screens">${chips}</div>
    </div>
    <div class="ss-card">
      <h2>${esc(say('how', lang))}</h2>
      <p class="ss-how" data-how>${esc(howOf(state, lang))}</p>
      <div class="ss-row">
        <div><label for="ss-mv-view">${esc(say('view', lang))}</label>
          <select id="ss-mv-view" data-view>
            <option value="">${esc(say('noView', lang))}</option>${views}
          </select></div>
        <div><label for="ss-mv-who">${esc(say('who', lang))}</label>
          <input id="ss-mv-who" type="text" data-who value="${esc(state.who)}"></div>
        <div><label for="ss-mv-on">${esc(say('taken', lang))}</label>
          <input id="ss-mv-on" type="date" data-taken value="${esc(state.taken)}"></div>
      </div>
      <p class="ss-detail">${esc(say('viewWhy', lang))}</p>
      <div class="ss-clips">${clips}</div>
      <button type="button" class="ss-go" data-run ${state.busy ? 'disabled' : ''}>${
        esc(state.busy ? say('working', lang) : say('run', lang))}</button>
      ${state.progress ? `<p class="ss-log">${esc(state.progress)}</p>` : ''}
      ${state.error ? `<p class="ss-err">${esc(state.error)}</p>` : ''}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ report */

const fmt = (metric, unit) => {
  if (!metric || metric.value === null || metric.value === undefined) return '—';
  if (unit === 's') return `${metric.value.toFixed(1)}s`;
  if (unit === 'ratio') return metric.value.toFixed(2);
  return `${Math.round(metric.value)}°`;
};

export function barHtml(reached, ceiling, ink) {
  const share = ceiling > 0
    ? Math.max(0, Math.min(1, reached / ceiling)) : 0;
  return `<div class="ss-bar"><i style="width:${(share * 100).toFixed(1)}%;
    background:${ink}"></i></div>`;
}

export function sideHtml(result, side, screenPayload, lang) {
  const entry = screenPayload;
  const unit = entry.unit;
  const label = SIDE_NAME[side]?.[lang] ?? side;
  if (!result) return '';
  if (result.peak?.value === null || result.peak?.value === undefined) {
    return `<div class="ss-side"><h3>${esc(label)}</h3>
      <p class="ss-detail" style="color:${INK.none}">${
        esc(say('notMeasured', lang))} — ${esc(result.peak?.reason ?? '')}</p></div>`;
  }
  const ceiling = entry.reference?.[1] ?? 0;
  const shortfall = result.shortfall?.value ?? 0;
  const ink = shortfall <= 0 ? INK.within_band
    : (shortfall > ceiling * 0.2 ? INK.marked
      : (shortfall > ceiling * 0.1 ? INK.notable : INK.watch));
  const estimated = result.peak?.availability === 'estimated'
    ? ` <span style="color:${INK.watch}">(${esc(say('estimated', lang))})</span>` : '';
  const bits = [];
  if (result.repetitions) {
    bits.push(`<span>${result.repetitions} ${esc(say('reps', lang))}</span>`);
  }
  if (result.consistency?.value !== null && result.consistency?.value !== undefined) {
    bits.push(`<span>${esc(say('spread', lang))} ${
      fmt(result.consistency, unit)}</span>`);
  }
  if (result.tempo?.value !== null && result.tempo?.value !== undefined) {
    bits.push(`<span>${fmt(result.tempo, 's')} ${esc(say('tempo', lang))}</span>`);
  }
  if (result.tempo_ratio?.value !== null && result.tempo_ratio?.value !== undefined) {
    bits.push(`<span>${esc(say('ratio', lang))} ${
      fmt(result.tempo_ratio, 'ratio')}</span>`);
  }
  if (result.held?.value !== null && result.held?.value !== undefined) {
    bits.push(`<span>${esc(say('held', lang))} ${fmt(result.held, 's')}</span>`);
  }
  if (result.sway?.value !== null && result.sway?.value !== undefined) {
    bits.push(`<span>${esc(say('sway', lang))} ${
      (result.sway.value * 100).toFixed(1)}% ${esc(say('ofBody', lang))}</span>`);
  }
  const summary = shortfall <= 0
    ? esc(say('atRange', lang))
    : `${Math.round(shortfall)}° ${esc(say('short', lang))}`;
  return `<div class="ss-side">
    <h3>${esc(label)}${estimated}</h3>
    <div><span class="ss-num" style="color:${ink}">${fmt(result.peak, unit)}</span>
      <span class="ss-detail" style="margin-left:8px">${esc(say('reference', lang))} ${
        unit === 's' ? `${ceiling}s` : `${ceiling}°`} · ${summary}</span></div>
    ${barHtml(result.peak.value, ceiling, ink)}
    ${bits.length ? `<div class="ss-detail">${bits.join('')}</div>` : ''}
    ${(result.notes ?? []).map((n) => `<p class="ss-note">${esc(n)}</p>`).join('')}
  </div>`;
}

export function asymmetryHtml(payload, lang) {
  const gap = payload.asymmetry ?? {};
  if (gap.value === null || gap.value === undefined) {
    return gap.reason
      ? `<p class="ss-detail">${esc(gap.reason)}</p>` : '';
  }
  const shorter = payload.shorter_side;
  const unit = payload.unit === 's' ? 's' : '°';
  const ink = shorter ? INK.notable : INK.within_band;
  const sentence = shorter
    ? (lang === 'ko'
      ? `${SIDE_NAME[shorter].ko}${say('lessFar', 'ko')}`
      : `the ${SIDE_NAME[shorter].en.toLowerCase()} side ${say('lessFar', 'en')}`)
    : say('even', lang);
  return `<div style="margin-top:4px">
    <span class="ss-num" style="color:${ink}">${Math.round(gap.value)}${unit}</span>
    <span class="ss-detail" style="margin-left:8px">${esc(sentence)}</span>
  </div>`;
}

/**
 * The exercises the measurement points at, from the studio's own library.
 *
 * Only for what came back short: a joint already at the published range needs
 * nothing suggested for it, and a list with a row for every screen filmed is a
 * list nobody reads. The names come from the server, which reads them from the
 * library the application already ships, so renaming an exercise renames it
 * once rather than in three places.
 */
export function programmeHtml(report, lang) {
  const plan = report.programme ?? [];
  if (!plan.length) return '';
  return `<div class="ss-card">
    <h2>${esc(say('plan', lang))}</h2>
    <ol class="ss-plan">${plan.map((row) => `<li>
      <b>${esc(lang === 'ko' ? row.name_ko : row.name)}</b>
      <small>${esc(lang === 'ko' ? row.screen_name_ko : row.screen_name)}</small>
      <div><button type="button" data-ex="${esc(row.key)}">${
        esc(say('showOn', lang))}</button></div>
    </li>`).join('')}</ol>
  </div>`;
}

/**
 * Every range measured, on one chart, against the range that was expected.
 *
 * A list of six screens with two numbers each is six comparisons a reader has
 * to hold at once. The same six drawn as a web is one shape: a body short in
 * one direction has a dent in it, and a body short everywhere is a small
 * polygon inside a large one. Nothing is said that the numbers do not say --
 * each spoke is that screen's reached-over-reference, which is the same
 * arithmetic the score uses and is printed beside it.
 *
 * The outer ring is the published reference, not a best-ever or a studio
 * average: a spoke touching the edge means the joint did what a body is
 * documented as doing, and there is no room beyond it to earn.
 */
export function radarHtml(report, lang) {
  const rows = (report.attempted ?? [])
    .map((key) => {
      const payload = report.results[key];
      const ceiling = payload.reference?.[1] ?? 0;
      const sides = ['left', 'right', 'both']
        .map((side) => payload[side]?.peak?.value)
        .filter((v) => v !== null && v !== undefined);
      if (!sides.length || !ceiling) return null;
      /* The *lesser* side, not the mean. A shoulder that goes to 180 on one
         side and 120 on the other is a body with a 120-degree shoulder, and
         averaging it to 150 draws a chart of a person who does not exist. */
      const reached = Math.min(...sides);
      return {
        key,
        name: lang === 'ko' ? payload.name_ko : payload.name,
        reached,
        ceiling,
        unit: payload.unit,
        share: Math.max(0, Math.min(1, reached / ceiling)),
      };
    })
    .filter(Boolean);
  if (rows.length < 3) return '';

  const R = 78;
  const cx = 0;
  const cy = 0;
  const at = (i, r) => {
    const angle = (Math.PI * 2 * i) / rows.length - Math.PI / 2;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };

  const rings = [0.25, 0.5, 0.75, 1].map((f) => {
    const points = rows.map((_, i) => at(i, R * f).map((n) => n.toFixed(1)).join(','));
    return `<polygon points="${points.join(' ')}" fill="none"
      stroke="#2a3a4c" stroke-width="${f === 1 ? 1.2 : 0.6}"/>`;
  }).join('');

  const spokes = rows.map((_, i) => {
    const [x, y] = at(i, R);
    return `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"
      stroke="#2a3a4c" stroke-width=".6"/>`;
  }).join('');

  const shape = rows.map((row, i) =>
    at(i, R * row.share).map((n) => n.toFixed(1)).join(',')).join(' ');

  const dots = rows.map((row, i) => {
    const [x, y] = at(i, R * row.share);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4"
      fill="${INK.within_band}"/>`;
  }).join('');

  const names = rows.map((row, i) => {
    const [x, y] = at(i, R + 15);
    const anchor = Math.abs(x) < 8 ? 'middle' : (x > 0 ? 'start' : 'end');
    const unit = row.unit === 's' ? 's' : '\u00b0';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}"
        text-anchor="${anchor}" font-size="7" font-weight="600"
        fill="#c9d6e4">${esc(row.name)}</text>
      <text x="${x.toFixed(1)}" y="${(y + 8).toFixed(1)}"
        text-anchor="${anchor}" font-size="6.4" fill="#7d8ea4"
        >${Math.round(row.reached)}${unit} / ${Math.round(row.ceiling)}${unit}</text>`;
  }).join('');

  return `<div class="ss-card">
    <h2>${esc(say('radar', lang))}</h2>
    <!-- Wide enough for the longest name in the catalogue. Drawn to the web
         alone it clipped "Shoulder abduction" to "Shoulder ab", which every
         test that checks the markup passes and every reader notices. -->
    <svg viewBox="-172 -112 344 224" class="ss-radar"
      xmlns="http://www.w3.org/2000/svg">
      ${rings}${spokes}
      <polygon points="${shape}" fill="${INK.within_band}" fill-opacity=".22"
        stroke="${INK.within_band}" stroke-width="1.4"/>
      ${dots}${names}
    </svg>
    <p class="ss-radarnote">${esc(say('radarNote', lang))}</p>
  </div>`;
}

export function findingsHtml(report, lang) {
  const found = report.findings ?? [];
  if (!found.length) {
    return `<p class="ss-detail" style="color:${INK.within_band}">${
      esc(say('clear', lang))}</p>`;
  }
  return found.map((f) => `<div class="ss-find"
    style="border-left-color:${INK[f.severity] ?? INK.none}">
    <b style="color:${INK[f.severity] ?? INK.none}">${
      esc(lang === 'ko' ? f.title_ko : f.title)}</b>
    <p>${esc(lang === 'ko' ? f.measurement_ko : f.measurement)}</p>
  </div>`).join('');
}

/**
 * What is already on file, and what changed since the last time.
 *
 * The whole reason a screening is filed. A single reading of a shoulder is a
 * number; two readings eight weeks apart is the thing a studio is actually
 * selling. Withheld scores are left off the strip rather than drawn as zero,
 * because a chart with a cliff in it where there was no measurement invents a
 * collapse that did not happen.
 */
export function historyHtml(state, lang) {
  const rows = state.history?.screenings ?? [];
  const earlier = rows.filter((r) => r.id !== state.report?.screening_id);
  if (!state.history) return '';
  if (!earlier.length) {
    return `<div class="ss-card"><h2>${esc(say('history', lang))}</h2>
      <p class="ss-detail">${esc(say('noEarlier', lang))}</p></div>`;
  }
  return `<div class="ss-card"><h2>${esc(say('history', lang))}</h2>
    ${earlier.slice(0, 8).map((row) => `<p class="ss-detail">
      <b>${esc(row.taken_on)}</b> —
      ${row.score === null || row.score === undefined
        ? esc(say('noScore', lang))
        : `${Math.round(row.score)}/100`}
      <span style="color:var(--dim2)"> · ${esc(row.screens.map(
        (key) => screenName(state, key, lang)).join(', '))}</span>
    </p>`).join('')}
  </div>`;
}

export function changeHtml(state, lang) {
  const change = state.change;
  if (!change) return '';
  const comparable = (change.changes ?? []).filter((c) => c.comparable);
  const refused = (change.changes ?? []).filter((c) => !c.comparable);
  if (!comparable.length && !refused.length) return '';
  return `<div class="ss-card"><h2>${esc(say('change', lang))}</h2>
    ${comparable.map((c) => `<p class="ss-detail">${
      esc(lang === 'ko' ? c.sentence_ko : c.sentence)}</p>`).join('')}
    ${refused.map((c) => `<p class="ss-detail" style="color:${INK.none}">${
      esc(say('notCompared', lang))}: ${esc(c.reason)}</p>`).join('')}
    <p class="ss-detail" style="margin-top:10px">${
      esc(lang === 'ko' ? change.judgement_ko : change.judgement)}</p>
  </div>`;
}

function reportHtml(state, lang) {
  const report = state.report;
  const blocks = (report.attempted ?? []).map((key) => {
    const payload = report.results[key];
    const entry = (report.catalogue_detail ?? []).find((s) => s.key === key)
      ?? { unit: payload.unit, reference: payload.reference };
    const merged = { ...entry, ...payload };
    const sides = ['left', 'right', 'both']
      .map((side) => sideHtml(payload[side], side, merged, lang)).join('');
    const source = lang === 'ko' && payload.reference_kind === 'functional'
      ? `${payload.reference_source} — ${say('functional', 'ko')}`
      : payload.reference_source;
    return `<div class="ss-card">
      <h2>${esc(lang === 'ko' ? payload.name_ko : payload.name)}</h2>
      ${sides}
      ${payload.left && payload.right ? `<div style="margin-top:16px">
        <h2 style="margin-bottom:6px">${esc(say('sides', lang))}</h2>
        ${asymmetryHtml(payload, lang)}</div>` : ''}
      <p class="ss-detail" style="margin-top:16px">${esc(say('source', lang))}: ${
        esc(source)}</p>
    </div>`;
  }).join('');

  const score = report.overall_score;
  const scoreCard = `<div class="ss-card">
    <h2>${esc(say('score', lang))}</h2>
    ${score === null || score === undefined
      ? `<p class="ss-detail">${esc(say('noScore', lang))} — ${
        esc(report.score_withheld_reason ?? '')}</p>`
      : `<div><span class="ss-num" style="font-size:32px">${Math.round(score)}</span>
         <span class="ss-detail" style="margin-left:8px">/ 100 · ${
           esc(say('checksN', lang).replace('{n}', report.checks))}</span></div>`}
  </div>`;

  const refused = (report.refused ?? []).map((r) => `<p class="ss-detail">
    <b>${esc(r.screen)}${r.side ? ` (${esc(r.side)})` : ''}</b> — ${esc(r.reason)}
  </p>`).join('');

  return `<div class="ss-sheet">
    <div class="ss-top">
      <div><h1>${esc(say('title', lang))}</h1>
        <p class="ss-lede" style="margin-bottom:0">${esc(state.taken)}${
          state.who ? ` · ${esc(state.who)}` : ''}</p></div>
      <div class="ss-acts">
        <button type="button" class="ss-b" data-lang>${esc(say('other', lang))}</button>
        <button type="button" class="ss-b" data-again>${esc(say('again', lang))}</button>
        <button type="button" class="ss-b" data-print>${esc(say('print', lang))}</button>
        <button type="button" class="ss-b" data-close>${esc(say('close', lang))}</button>
      </div>
    </div>
    <div class="ss-grid">
      <div>${blocks}</div>
      <div>
        ${radarHtml(report, lang)}
        ${scoreCard}
        <div class="ss-card">
          <h2>${esc(say('findings', lang))}</h2>
          ${findingsHtml(report, lang)}
        </div>
        ${programmeHtml(report, lang)}
        ${changeHtml(state, lang)}
        ${historyHtml(state, lang)}
        ${refused ? `<div class="ss-card">
          <h2>${esc(say('notMeasured', lang))}</h2>${refused}</div>` : ''}
      </div>
    </div>
    <p class="ss-disc">${esc(lang === 'ko' ? report.disclaimer_ko
                                           : report.disclaimer)}</p>
  </div>`;
}

/* ---------------------------------------------------------------- behaviour */

function wire(host, state, nw, served, identity, draw, shut) {
  host.querySelector('[data-close]')?.addEventListener('click', shut);
  host.querySelector('[data-print]')?.addEventListener('click', () => print());
  host.querySelector('[data-again]')?.addEventListener('click', () => {
    state.report = null;
    state.error = '';
    state.progress = '';
    draw();
  });
  host.querySelector('[data-lang]')?.addEventListener('click', () => {
    const next = (nw?.app?.lang ?? 'en') === 'en' ? 'ko' : 'en';
    nw?.setLang?.(next);
    draw();
  });

  for (const chip of host.querySelectorAll('[data-screen]')) {
    chip.addEventListener('click', () => {
      if (chip.dataset.screen === state.chosen) return;
      state.chosen = chip.dataset.screen;
      /* The clips go with the screen. A left-side shoulder raise is not a
       * left-side knee bend, and carrying the file across would measure the
       * wrong movement against the right reference and look plausible. */
      state.clips.clear();
      state.view = '';
      state.error = '';
      draw();
    });
  }
  host.querySelector('[data-view]')?.addEventListener('change', (e) => {
    state.view = e.target.value;
  });
  host.querySelector('[data-who]')?.addEventListener('input', (e) => {
    state.who = e.target.value.trim();
  });
  host.querySelector('[data-taken]')?.addEventListener('change', (e) => {
    state.taken = e.target.value;
  });
  for (const button of host.querySelectorAll('[data-pick]')) {
    button.addEventListener('click', () => {
      host.querySelector(`[data-file="${button.dataset.pick}"]`)?.click();
    });
  }
  for (const input of host.querySelectorAll('[data-file]')) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      state.clips.set(input.dataset.file, file);
      state.error = '';
      draw();
    });
  }
  for (const button of host.querySelectorAll('[data-drop]')) {
    button.addEventListener('click', () => {
      state.clips.delete(button.dataset.drop);
      draw();
    });
  }
  host.querySelector('[data-run]')?.addEventListener('click',
    () => run(state, draw, identity, nw?.app?.lang ?? 'en'));

  for (const pill of host.querySelectorAll('[data-ex]')) {
    pill.addEventListener('click', () => {
      /* Hidden, never closed -- the same rule the posture screen learned the
       * hard way. Tearing this down to look at an exercise would cost the
       * reader the measurement that suggested it, and there is no way back to
       * a report built from a clip that has already been deleted. */
      nw?.setExercise?.(pill.dataset.ex);
      peek(host, nw);
    });
  }
}

/**
 * Step out to the body, with a way back.
 *
 * The screen is hidden rather than removed, so the measurement, the findings
 * and the scroll position are all still there when the button is pressed.
 */
export function peek(host, nw) {
  host.hidden = true;
  const lang = nw?.app?.lang ?? 'en';
  document.getElementById('ss-mv-back')?.remove();
  const back = document.createElement('button');
  back.id = 'ss-mv-back';
  back.type = 'button';
  back.textContent = say('back', lang);
  back.addEventListener('click', () => {
    host.hidden = false;
    back.remove();
  });
  document.body.appendChild(back);
  return back;
}

/**
 * Replace the built-in catalogue with the server's own.
 *
 * The list below is enough to draw the choice before the server answers, so
 * the screen is never blank -- but the instructions, the reference ranges and
 * the sources are the measurement layer's, and a page that kept its own copy
 * would eventually be telling a studio to film something the server no longer
 * measures that way.
 */
let FETCHED = null;   // the server's catalogue, kept for the next open

async function loadCatalogue(state, draw) {
  if (FETCHED) { state.catalogue = FETCHED; draw(); return; }
  try {
    const response = await fetch('screens');
    if (!response.ok) return;
    const body = await response.json();
    if (Array.isArray(body.screens) && body.screens.length) {
      FETCHED = body.screens;
      state.catalogue = FETCHED;
      if (!state.catalogue.some((s) => s.key === state.chosen)) {
        state.chosen = state.catalogue[0].key;
      }
      draw();
    }
  } catch {
    /* The built-in list stands. A studio with no connection can still read
       what the screens are; it just cannot measure one. */
  }
}

/**
 * How to film the chosen screen.
 *
 * Deliberately absent from the built-in list above, which carries only the
 * names and the camera angles needed to draw the choice. The instruction is a
 * sentence a student is read aloud, it appears in a printed report and in the
 * terminal as well as here, and a copy of it in this file is a copy that
 * stops matching the day somebody rewords the other two.
 */
function howOf(state, lang) {
  const entry = screenOf(state);
  const text = (lang === 'ko' && entry?.instruction_ko) || entry?.instruction;
  return text || say('loading', lang);
}

/**
 * Upload one clip, wait for the landmarks, and hand back the longest track.
 *
 * The longest rather than the first: a reflection in the studio mirror, or the
 * same student picked up under a second identity after walking behind a
 * reformer, both produce extra tracks. The student is the one who was there
 * the whole time.
 */
export async function extract(file, onProgress) {
  const response = await fetch('landmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream',
               'X-Filename': file.name || 'clip.mp4' },
    body: file,
  });
  const started = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(started.error || `${response.status} ${response.statusText}`);
  }
  let job = started;
  while (job.state === 'queued' || job.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const poll = await fetch(`job/${job.id}`);
    if (!poll.ok) throw new Error(`${poll.status} ${poll.statusText}`);
    job = await poll.json();
    onProgress?.(job.lines?.[job.lines.length - 1] ?? '');
  }
  if (job.state !== 'done') {
    throw new Error(job.error || 'the clip could not be measured');
  }
  return longestTrack(job.landmarks);
}

export function longestTrack(landmarks) {
  const tracks = landmarks?.tracks ?? [];
  if (!tracks.length) throw new Error('nobody was tracked in that clip');
  const best = tracks.reduce((a, b) => (b.samples > a.samples ? b : a));
  return { times: best.times, frames: best.frames };
}

async function run(state, draw, identity, lang = 'en') {
  const entry = screenOf(state);
  const sides = sidesOf(entry);
  if (![...state.clips.values()].length) {
    state.error = say('need', lang);
    draw();
    return;
  }
  state.busy = true;
  state.error = '';
  state.progress = say('reading', lang);
  draw();

  try {
    const clip = { };
    if (state.view) clip.view = state.view;
    for (const side of sides) {
      const file = state.clips.get(side);
      if (!file) continue;
      const where = SIDE_NAME[side]?.[lang] ?? side;
      state.progress = `${where}: ${say('reading', lang)}`;
      draw();
      clip[side] = await extract(file, (line) => {
        state.progress = `${where}: ${line}`;
        draw();
      });
    }
    const response = await fetch('movement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clips: { [entry.key]: clip },
        taken_on: state.taken,
        ...(state.who ? { username: state.who } : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      state.error = body.error || `${response.status} ${response.statusText}`;
    } else {
      state.report = body;
      state.progress = '';
      state.change = null;
      /* Against the one before it, automatically. A studio filming a second
       * screening wants the difference, and asking them to go and find the
       * first one is asking them to do a comparison this already has both
       * halves of. */
      const previous = state.history?.screenings?.[0];
      if (body.screening_id && previous?.id) {
        await compareWith(state, previous.id, body.screening_id);
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

/** What is on file for whoever this screening is about. */
async function loadHistory(state, draw) {
  if (!state.who) { state.history = { screenings: [] }; draw(); return; }
  try {
    const response = await fetch(
      `screenings?username=${encodeURIComponent(state.who)}`);
    if (!response.ok) return;
    state.history = await response.json();
    draw();
  } catch {
    /* A report without a history is still a report. */
  }
}

async function compareWith(state, before, after) {
  try {
    const response = await fetch('movement/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before, after }),
    });
    if (!response.ok) return;
    state.change = await response.json();
  } catch {
    /* The comparison is an extra. Losing it does not lose the screening. */
  }
}

export const _internals = { setupHtml, reportHtml, sideHtml, asymmetryHtml,
                            findingsHtml, barHtml, longestTrack, screenOf,
                            sidesOf, howOf, programmeHtml, peek,
                            historyHtml, changeHtml, radarHtml,
                            INK, CHIP: T, CATALOGUE };
