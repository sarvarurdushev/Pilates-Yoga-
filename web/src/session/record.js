/**
 * Where you start recording.
 *
 * The measurement half of this project is a Python pipeline, and until now the
 * only way to reach it was a terminal. This is the front door: point the camera
 * at yourself, or hand over a clip you already have, and watch the same
 * `pilates capture` a studio would type run over it.
 *
 * **The button only appears when there is something behind it.** The page asks
 * `/capabilities` first. Served as a static site -- on Render, from a folder,
 * from a memory stick -- that request fails, no button is drawn, and the site is
 * honestly a viewer rather than one that offers to analyse a clip and then
 * cannot. Served by `pilates web --analyse`, the button is there.
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
#ss-rec-open{position:fixed;left:22px;bottom:22px;z-index:60;display:flex;gap:9px;
  align-items:center;padding:10px 15px;border-radius:4px;cursor:pointer;
  background:rgba(90,169,230,.13);border:1px solid rgba(90,169,230,.45);
  color:var(--txt);font-size:12.5px;letter-spacing:.02em}
#ss-rec-open:hover{background:rgba(90,169,230,.2)}
#ss-rec-open em{font-style:normal;color:var(--acc);font-size:9.5px;
  letter-spacing:.12em;text-transform:uppercase}
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
`;

/** Ask the server what it can do before offering it. */
export async function capabilities() {
  try {
    const response = await fetch('capabilities');
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

const FORM = `
  <div class="about">
    <div><label>Height</label><input id="ss-h" inputmode="decimal"
      placeholder="1.68 m"></div>
    <div><label>Weight</label><input id="ss-m" inputmode="decimal"
      placeholder="65 kg"></div>
  </div>
  <p class="why">Both are needed for the effort numbers — a joint moment in
    newton-metres is a mass on a lever, so without them every angle is still
    measured and no load is. Leave them blank and you get the angles.</p>`;

export function mount(nw, install) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const open = document.createElement('button');
  open.id = 'ss-rec-open';
  open.type = 'button';
  open.innerHTML = '<em>Record</em><span>Analyse a video of yourself</span>';
  open.addEventListener('click', () => dialog(nw, install));
  document.body.appendChild(open);
  return open;
}

function dialog(nw, install) {
  const host = document.createElement('div');
  host.id = 'ss-rec';
  host.innerHTML = `<div class="box">
    <h2>Analyse a video</h2>
    <p class="sub">The clip is uploaded, measured, and deleted. What is kept is
      the measurements and a pose stream of about a megabyte an hour — never the
      video.</p>
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
    ${FORM}
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
    const params = new URLSearchParams();
    const height = $('#ss-h').value.replace(/[^\d.]/g, '');
    const mass = $('#ss-m').value.replace(/[^\d.]/g, '');
    if (height) params.set('height', height);
    if (mass) params.set('mass', mass);
    params.set('session', `clip-${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '')}`);
    params.set('date', new Date().toISOString().slice(0, 10));

    let job;
    try {
      const response = await fetch(`analyse?${params}`, {
        method: 'POST', body: clip,
        headers: { 'X-Filename': clipName, 'Content-Type': 'application/octet-stream' },
      });
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
