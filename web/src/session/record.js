/**
 * Where you start recording.
 *
 * The measurement half of this project is a Python pipeline, and until now the
 * only way to reach it was a terminal. This is the front door: point the camera
 * at yourself, or hand over a clip you already have, and watch the same
 * `pilates capture` a studio would type run over it.
 *
 * **The button is always there, and says so when it cannot work.** It used to be
 * drawn only when `/capabilities` answered, so that a static copy of the site
 * never offered an analysis it could not run. That was honest and it was wrong:
 * the first question anybody asks this project is *where do I record*, and a
 * page that answers by showing nothing reads as a page where the camera half
 * does not exist. So the button is in the header on every copy of the site. On
 * one that can analyse, it opens the recorder. On one that cannot -- a static
 * host, a folder, a memory stick -- it opens a page that says which half of the
 * project is missing and the one command that starts it.
 *
 * **Height and weight are asked for, and asked for once, in plain terms.** They
 * are not vanity fields: a joint moment in newton-metres is a mass and a lever
 * arm, and without them the pipeline can measure every angle and no load at all.
 * The form says exactly that rather than making them look optional-but-nagged.
 *
 * **The clip is never kept.** It goes up, it is analysed, the file is deleted
 * whether the analysis worked or not. What survives is the measurements and the
 * pose stream, which is the whole premise: about a megabyte an hour instead of
 * gigabytes of video of somebody's body.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
/* In the header, immediately after the title, before the disclaimer chips --
   which keep their own corner and do not move. A corner button over the 3D
   scene was findable only by somebody already looking for it. */
#ss-rec-open{flex:none;align-self:flex-start;display:inline-flex;gap:9px;
  align-items:center;padding:7px 15px 7px 12px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;font-weight:600;letter-spacing:.11em;
  text-transform:uppercase;white-space:nowrap;
  background:var(--acc);border:1px solid var(--acc);color:#04121f}
#ss-rec-open:hover{filter:brightness(1.12)}
#ss-rec-open i{width:9px;height:9px;border-radius:50%;background:#d0452f;
  box-shadow:0 0 0 3px rgba(208,69,47,.25)}
/* Nothing behind it: still there, still says what it is for, but not dressed as
   the thing you are meant to press next. */
#ss-rec-open.ss-off{background:var(--glass);border-color:var(--line2);
  color:var(--dim);font-weight:500}
#ss-rec-open.ss-off:hover{color:var(--txt);border-color:var(--acc)}
#ss-rec-open.ss-off i{background:var(--dim2);box-shadow:none}
/* If the application's header is not there to sit in, it falls back to the
   corner rather than to nowhere. */
#ss-rec-open.ss-loose{position:fixed;left:308px;bottom:70px;z-index:60}
#ss-rec{position:fixed;inset:0;z-index:120;display:flex;align-items:center;
  justify-content:center;background:rgba(2,5,10,.78);backdrop-filter:blur(3px)}
#ss-rec .box{width:min(560px,92vw);max-height:88vh;overflow:auto;border-radius:6px;
  background:linear-gradient(200deg,rgba(10,17,28,.98),rgba(5,9,16,.99));
  border:1px solid var(--line2);padding:22px 24px;
  box-shadow:0 40px 120px rgba(0,0,0,.6)}
#ss-rec h2{margin:0 0 4px;font-size:17px;font-weight:500;color:var(--txt)}
#ss-rec .sub{margin:0 0 18px;font-size:12px;color:var(--dim2);line-height:1.6}
#ss-rec .tabs{display:flex;gap:8px;margin:0 0 16px}
#ss-rec .tabs button{flex:1;padding:9px 0;border-radius:3px;font-size:12.5px;
  border:1px solid var(--line);background:var(--glass);color:var(--dim);
  cursor:pointer}
#ss-rec .tabs button[aria-selected=true]{border-color:var(--acc);color:var(--txt);
  background:rgba(90,169,230,.12)}
#ss-rec video{width:100%;border-radius:4px;background:#05070d;display:block;
  margin:0 0 12px;max-height:280px}
#ss-rec .drop{border:1px dashed var(--line2);border-radius:4px;padding:26px 18px;
  text-align:center;color:var(--dim);font-size:12.5px;cursor:pointer;
  margin:0 0 12px}
#ss-rec .drop:hover{border-color:var(--acc);color:var(--txt)}
#ss-rec .drop b{display:block;color:var(--txt);font-weight:500;margin-bottom:4px}
#ss-rec .about{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 8px}
#ss-rec #ss-who{margin:0 0 8px}
#ss-rec label{display:block;font-size:10px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2);margin:0 0 4px}
#ss-rec input{width:100%;padding:8px 10px;border-radius:3px;font:inherit;
  font-size:13px;background:var(--glass);border:1px solid var(--line);
  color:var(--txt)}
#ss-rec input:focus{outline:0;border-color:var(--acc)}
#ss-rec .why{font-size:11px;color:var(--dim2);line-height:1.6;margin:0 0 16px}
#ss-rec .go{display:flex;gap:10px;align-items:center}
#ss-rec .go button{padding:10px 18px;border-radius:3px;font-size:13px;
  border:1px solid var(--line2);background:var(--glass);color:var(--txt);
  cursor:pointer}
#ss-rec .go button.primary{background:var(--acc);border-color:var(--acc);color:#04121f}
#ss-rec .go button[disabled]{opacity:.45;cursor:default}
#ss-rec .go .spacer{margin-left:auto}
#ss-rec .log{margin:14px 0 0;padding:11px 13px;border-radius:3px;
  background:#05070d;border:1px solid var(--line);font-size:11px;
  color:var(--dim);line-height:1.65;max-height:190px;overflow:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
#ss-rec .bad{color:var(--gold)}
#ss-rec .privacy{margin:14px 0 0;font-size:11px;color:var(--dim2);line-height:1.6;
  border-left:2px solid var(--line2);padding-left:11px}
#ss-rec p.body{margin:0 0 13px;font-size:12.5px;color:var(--dim);line-height:1.7}
#ss-rec p.body b{color:var(--txt);font-weight:500}
#ss-rec ol{margin:0 0 14px;padding-left:19px;font-size:12.5px;color:var(--dim);
  line-height:1.75}
#ss-rec ol li{margin:0 0 7px}
#ss-rec pre{margin:7px 0;padding:11px 13px;border-radius:3px;background:#05070d;
  border:1px solid var(--line);color:var(--acc);font-size:11.5px;line-height:1.7;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto}
#ss-rec .stillhere{margin:16px 0 0;padding:12px 14px;border-radius:3px;
  background:rgba(90,169,230,.06);border:1px solid var(--line);
  font-size:11.5px;color:var(--dim2);line-height:1.7}
#ss-rec .stillhere b{color:var(--txt);font-weight:500}
`;

/**
 * The passcode this server asks for, if it asks for one.
 *
 * Held for the window and no longer. It is a shared word, not a login: it stops
 * a stranger who found the URL from uploading video to somebody's studio, and
 * claims nothing more than that. Where the server is open -- a machine on the
 * studio's own network, which is the design -- nothing is asked and nothing is
 * stored.
 */
export function passcode(can, renew = false) {
  if (!can?.passcode) return '';
  let held = '';
  try { held = sessionStorage.getItem('ss-pass') || ''; } catch { /* private */ }
  if (held && !renew) return held;
  const typed = (window.prompt(renew
    ? 'That passcode was not accepted. Try again:'
    : 'This studio asks for a passcode before it takes a video or keeps a note.'
    ) || '').trim();
  try {
    if (typed) sessionStorage.setItem('ss-pass', typed);
    else sessionStorage.removeItem('ss-pass');
  } catch { /* private */ }
  return typed;
}

/** Ask the server what it can do before offering it. */
export async function capabilities() {
  try {
    const response = await fetch('capabilities');
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

/**
 * Who this is, and what they weigh.
 *
 * The name is not bookkeeping. Every clip analysed here is written into the
 * studio's record under it, so it is the difference between a reading and a
 * line: record the same name twice and the second clip comes back with the
 * first one under it, a noise floor, and a verdict. Type a different name and
 * you have started a second person.
 *
 * The people already on record are offered as a list, because the way this goes
 * wrong is a typo -- "Anna" and "anna smith" as two students -- and the way to
 * stop that is to make picking easier than typing. Names are matched loosely
 * enough that case and spacing do not fork a record.
 */
const form = (remembers, people) => `
  <label for="ss-who">Who is this?</label>
  <input id="ss-who" list="ss-people" autocomplete="off"
    placeholder="${people.length ? esc(people[0].display_name
                                       || people[0].username) : 'Your name'}">
  <datalist id="ss-people">${people.map((p) =>
    `<option value="${esc(p.display_name || p.username)}"></option>`).join('')}
  </datalist>
  <p class="why">${remembers
    ? 'Recorded under this name, and added to everything already on record for '
      + 'it. Use the same name every time and the measurements become a line '
      + 'you can read; use a new one and you have started a new student.'
    : 'This server keeps no record, so this clip is measured on its own and '
      + 'the name is only a label on the result.'}</p>
  <div class="about">
    <div><label>Height</label><input id="ss-h" inputmode="decimal"
      placeholder="1.68 m"></div>
    <div><label>Weight</label><input id="ss-m" inputmode="decimal"
      placeholder="65 kg"></div>
  </div>
  <p class="why">Both are needed for the effort numbers — a joint moment in
    newton-metres is a mass on a lever, so without them every angle is still
    measured and no load is. Leave them blank and you get the angles.</p>`;

/** The people already on record here, so a name can be picked rather than typed. */
async function enrolled() {
  try {
    const response = await fetch('people');
    if (!response.ok) return [];
    return (await response.json()).people ?? [];
  } catch { return []; }
}

/**
 * Put the Record button where the eye already is.
 *
 * `can` is whatever `/capabilities` answered, or null where it answered nothing.
 * Either way a button is drawn: what changes is its treatment and what it opens.
 */
export function mount(nw, install, can) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const live = !!can?.analyse;
  const open = document.createElement('button');
  open.id = 'ss-rec-open';
  open.type = 'button';
  open.title = live ? 'Record or upload a video and measure it'
                    : 'This copy cannot analyse video — press to see how to turn it on';
  open.innerHTML = `<i></i><span>Record${live ? '' : ' — how to turn it on'}</span>`;
  if (!live) open.classList.add('ss-off');
  open.addEventListener('click', () => dialog(nw, install, can));

  /* Into the header, after the title and before the four disclaimer lines,
   * which keep their corner. Anywhere else and it is a button somebody has to
   * go looking for -- which is the failure this is fixing. */
  const bar = document.getElementById('topbar');
  const chips = document.getElementById('discBar');
  if (bar && chips) bar.insertBefore(open, chips);
  else if (bar) bar.appendChild(open);
  else { open.classList.add('ss-loose'); document.body.appendChild(open); }
  return open;
}

/**
 * What to say when the button cannot do the thing it names.
 *
 * Not an apology and not a dead end: the measurement half of this project is a
 * Python pipeline, this page is the viewing half, and the two are separable on
 * purpose -- video of a class should not have to leave the building for the
 * anatomy to be readable. So this says which half is running, why they are
 * split, and the one command that starts the other one.
 */
function explain(can) {
  const host = document.createElement('div');
  host.id = 'ss-rec';
  const served = can != null;
  host.innerHTML = `<div class="box">
    <h2>Recording needs the other half of this project</h2>
    <p class="sub">You are looking at the viewer. The camera, the pose tracking
      and the measurement are a Python pipeline that has to be running behind
      this page, and on this copy it is not.</p>
    <p class="body">${served
      ? 'This server is serving the site but was started without the analysis '
        + 'endpoint, so there is nowhere to send a clip.'
      : 'This is a static copy of the site — a folder, a memory stick, or a '
        + 'static host. There is no server behind it to send a clip to.'}</p>
    <p class="body"><b>To record and measure, run the studio yourself:</b></p>
    <ol>
      <li>Get the project onto the machine with the camera on it, then:
        <pre>pip install -e .
python -m pilates web --db studio.db</pre></li>
      <li>Open <b>http://localhost:8000</b>. This same page loads, and the
        Record button up there turns blue.</li>
      <li>Point the camera at the class, or hand it a clip you already have.
        The video is measured and then deleted; what is kept is the numbers and
        a pose stream of about a megabyte an hour.</li>
    </ol>
    <p class="body"><b>Why it is split like this.</b> Analysing in a data centre
      means video of real people leaves the building — the one thing this design
      is otherwise built to avoid. Running it on the studio's own machine is the
      honest default, so the hosted copy is a viewer and says so rather than
      quietly uploading bodies to somebody else's computer.</p>
    <div class="stillhere"><b>Everything else on this page is real.</b> The body,
      the measurements on it, the charts and the history all came out of that
      same pipeline — they were computed on a machine like the one above and
      exported to a file. This page is what you get afterwards.</div>
    <div class="go" style="margin-top:16px">
      <button type="button" class="primary" data-close>Got it</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  const shut = () => host.remove();
  host.querySelector('[data-close]').addEventListener('click', shut);
  host.addEventListener('click', (e) => { if (e.target === host) shut(); });
  return host;
}

async function dialog(nw, install, can) {
  if (!can?.analyse) return explain(can);
  const remembers = !!can.remembers;
  const people = remembers ? await enrolled() : [];
  const host = document.createElement('div');
  host.id = 'ss-rec';
  host.innerHTML = `<div class="box">
    <h2>Analyse a video</h2>
    <p class="sub">The clip is uploaded, measured, and deleted. What is kept is
      the measurements and a pose stream of about a megabyte an hour — never the
      video.${remembers
        ? ' They are written into this studio\u2019s record, so the same person '
          + 'recorded again builds a history.'
        : ' This server keeps no record between clips.'}</p>
    <div class="tabs" role="tablist">
      <button type="button" data-tab="file" aria-selected="true">Choose a file</button>
      <button type="button" data-tab="camera" aria-selected="false">Use my camera</button>
    </div>
    <div data-pane="file">
      <div class="drop"><b>Drop a video here, or click to choose</b>
        <span>mp4, mov or webm · one person in frame, whole body visible</span></div>
      <input type="file" accept="video/*" hidden>
    </div>
    <div data-pane="camera" hidden>
      <video muted playsinline></video>
      <div class="go" style="margin-bottom:12px">
        <button type="button" data-cam="start">Start camera</button>
        <button type="button" data-cam="record" disabled>Record</button>
        <button type="button" data-cam="stop" disabled>Stop</button>
        <span class="spacer"></span><span class="dim" data-cam="clock"></span>
      </div>
    </div>
    ${form(remembers, people)}
    <div class="go">
      <button type="button" class="primary" data-go disabled>Analyse</button>
      <button type="button" data-close>Close</button>
      <span class="spacer"></span><span data-chosen class="why"></span>
    </div>
    <div class="log" hidden></div>
    <p class="privacy">Nothing leaves this machine: the clip goes to the server
      running on it, and is removed when the analysis finishes or fails.</p>
  </div>`;
  document.body.appendChild(host);

  const $ = (sel) => host.querySelector(sel);
  const who = $('#ss-who');
  try { who.value = localStorage.getItem('ss-who') || ''; } catch { /* private */ }
  const log = $('.log');
  const goButton = $('[data-go]');
  const chosen = $('[data-chosen]');
  let clip = null, clipName = 'clip.mp4', stream = null, recorder = null;

  const say = (text, bad = false) => {
    log.hidden = false;
    log.innerHTML = `<span class="${bad ? 'bad' : ''}">${esc(text)}</span>`;
  };
  const choose = (blob, name) => {
    clip = blob; clipName = name;
    chosen.textContent = `${name} · ${(blob.size / 1e6).toFixed(1)} MB`;
    goButton.disabled = false;
  };

  for (const tab of host.querySelectorAll('.tabs button')) {
    tab.addEventListener('click', () => {
      for (const other of host.querySelectorAll('.tabs button')) {
        other.setAttribute('aria-selected', other === tab);
      }
      for (const pane of host.querySelectorAll('[data-pane]')) {
        pane.hidden = pane.dataset.pane !== tab.dataset.tab;
      }
    });
  }

  const file = $('input[type=file]');
  $('.drop').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    if (file.files[0]) choose(file.files[0], file.files[0].name);
  });
  const drop = $('.drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) choose(f, f.name);
  });

  // -- the camera ------------------------------------------------------
  const video = $('video');
  const clock = $('[data-cam=clock]');
  $('[data-cam=start]').addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream;
      await video.play();
      $('[data-cam=record]').disabled = false;
    } catch (error) {
      say(`The camera could not be opened: ${error.message}. A browser will only `
        + 'hand it over on localhost or https.', true);
    }
  });
  $('[data-cam=record]').addEventListener('click', () => {
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: pickType() });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      choose(blob, `camera.${recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
    };
    recorder.start();
    const from = Date.now();
    const tick = setInterval(() => {
      clock.textContent = `${Math.round((Date.now() - from) / 1000)}s`;
      if (recorder.state !== 'recording') clearInterval(tick);
    }, 500);
    $('[data-cam=record]').disabled = true;
    $('[data-cam=stop]').disabled = false;
  });
  $('[data-cam=stop]').addEventListener('click', () => {
    recorder?.stop();
    $('[data-cam=stop]').disabled = true;
    $('[data-cam=record]').disabled = false;
  });

  const shut = () => {
    stream?.getTracks().forEach((t) => t.stop());
    host.remove();
  };
  $('[data-close]').addEventListener('click', shut);
  host.addEventListener('click', (e) => { if (e.target === host) shut(); });

  // -- send it ---------------------------------------------------------
  goButton.addEventListener('click', async () => {
    if (!clip) return;
    goButton.disabled = true;
    say('Uploading…');
    const name = who.value.trim();
    if (remembers && !name) {
      say('Who is this? The clip is written into the record under a name, and '
        + 'without one every student on this machine becomes the same person.',
          true);
      goButton.disabled = false;
      who.focus();
      return;
    }
    try { if (name) localStorage.setItem('ss-who', name); } catch { /* private */ }

    const params = new URLSearchParams();
    const height = $('#ss-h').value.replace(/[^\d.]/g, '');
    const mass = $('#ss-m').value.replace(/[^\d.]/g, '');
    if (height) params.set('height', height);
    if (mass) params.set('mass', mass);
    if (name) { params.set('user', name); params.set('name', name); }
    params.set('session', `clip-${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '')}`);
    params.set('date', new Date().toISOString().slice(0, 10));

    let job;
    try {
      // Two attempts at most, and the second only to re-ask for a passcode that
      // was wrong. A clip is not re-uploaded for any other reason: it is the
      // largest thing this page ever sends.
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        const word = passcode(can, attempt > 0);
        response = await fetch(`analyse?${params}`, {
          method: 'POST', body: clip,
          headers: { 'X-Filename': clipName,
                     'Content-Type': 'application/octet-stream',
                     ...(word ? { 'X-Passcode': word } : {}) },
        });
        if (response.status !== 401) break;
      }
      job = await response.json();
      if (!response.ok) throw new Error(job.error || response.statusText);
    } catch (error) {
      say(`Upload failed: ${error.message}`, true);
      goButton.disabled = false;
      return;
    }

    /* Poll rather than stream. The pipeline's own output is what is shown, so a
     * reader can see it finding people and measuring joints rather than
     * watching a bar that means nothing. */
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      let state;
      try {
        state = await (await fetch(`job/${job.id}`)).json();
      } catch { continue; }
      log.hidden = false;
      log.textContent = `${state.seconds}s\n` + (state.lines || []).join('\n');
      if (state.state === 'done') {
        log.textContent += '\n\nDone. Loading it onto the body…';
        try {
          await install(state.bundle);
          shut();
        } catch (error) {
          say(`The result could not be shown: ${error.message}`, true);
        }
        return;
      }
      if (state.state === 'failed') {
        say(`${state.error}\\n\\n${(state.lines || []).join('\n')}`, true);
        goButton.disabled = false;
        return;
      }
    }
  });
}

/** The first container this browser will actually record. */
function pickType() {
  for (const type of ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}
