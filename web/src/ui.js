import { UI, DISCLAIMERS } from './content/strings.js';
import { HELP, KIND_OVERVIEW } from './content/help.js';
import { EXERCISE, EXERCISE_KEYS, DISCIPLINES, APPARATUS, ROLE_EVIDENCE } from './content/exercises.js';
import { FAMILY, PROP } from './content/library/vocabulary.js';
import { EXERCISE_BRAIN, TIERS, claimsForRegion } from './content/evidence.js';
import { MOVEMENT_PATHWAY } from './content/pathways.js';
import { MOTION, BREATH, phaseAt } from './content/motion.js';
import { RAMP_STOPS } from './musclePaths.js';
import { registry, get, LAYER_ORDER, drawnIds, searchText } from './structures.js';
import { GROUP_REGIONS, groups as groupTable } from './content/groups.js';
import { BODY_FRAME, BRAIN_TO_BODY } from './frame.js';
import { activeBody, BODIES, templateDisclaimer, bodyHref, availableBodies } from './bodies.js';
import { openReport } from './report.js';
import { ActChart } from './actChart.js';
import { Connectome } from './connectome.js';
import { Lab } from './lab.js';

export function mountUI(ctx) {
  const body = activeBody();
  /* Defined here rather than imported from main.js: ui.js is imported *by* main.js, and a
   * cycle for a one-line predicate is not worth it. The brain is not a body layer. */
  const hasLayer = name =>
    name === 'brain' ? !!body.brainToBody : body.assets.layers.includes(name);
  /* The template line is the one disclaimer that is about the *body* rather than the app, so
   * it is composed per body — a female body must never carry a male body's disclaimer. */
  const disc = (i, lang) => (DISCLAIMERS[i].key === 'template'
    ? templateDisclaimer(body, lang, DISCLAIMERS[i][lang])
    : DISCLAIMERS[i][lang]);
  const { app, setScan, setScanAt, setSweep, setBrainLook, regionGraph, cellGraph, regionActivity,
          selectStructure, setLang, setAtlas, setXray, setCutaway, setClip, setLabels,
          setRotate, setRegister, setInstruction, setLayer, setLayerOpacity, setView,
          resetView, setExercise, setPathway, activationOf,
          setGroup, anatomyGroups, groupsForStructure, setIsolate, isolated, setExplode,
          setExplodeLayout, explodeLayout, zoomBy, fitView,
          poseFromClip, setPlaying, setShowPaths, setShowMeshes, liveActivationOf,
          musclePathReport, setLabelKind, clearLabelKinds } = ctx;

  const $ = id => document.getElementById(id);
  const rigData = () => ctx.getRig?.()?.data ?? null;
  const T = k => UI[k]?.[app.lang] ?? k;
  // quotes too, not only angle brackets: this goes into attributes as well as text, and the
  // search box puts whatever the user typed straight back into `value="..."`
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = o => (o && typeof o === 'object' ? (o[app.lang] ?? o.en ?? '') : (o ?? ''));

  /* What a control means, in whichever register the reader asked for.
   *
   * The Plain / Clinical / Both choice already decides how the anatomy is described; the
   * instrument is described the same way rather than through a second vocabulary. `both` is
   * the default and labels each half, because the two say different things and running them
   * together reads as one long sentence that contradicts itself. */
  function explain(key) {
    const h = HELP[key];
    if (!h) return '';
    const plain = esc(h.plain?.[app.lang] ?? '');
    const tech = esc(h.tech?.[app.lang] ?? '');
    if (app.register === 'plain') return plain;
    if (app.register === 'clinical') return tech;
    return `<b>${T('helpPlain')}</b>${plain}<b>${T('helpTech')}</b>${tech}`;
  }

  /* The same explanation, sized for a control rather than for a glossary.
   *
   * Under every control both halves at once made the console a wall of prose — "nobody wants
   * to scroll a long time and read the long texts" — and the reader who does want the
   * technical half wants it about *one* control, not about all of them at once. So the plain
   * sentence is always there, because that is the half that answers "what does this do", and
   * the technical half is one click away on the control it belongs to. The full pair for
   * everything lives in the About tab, which is where you go to read rather than to work.
   *
   * `clinical` is honoured as the reader asking for the technical half by default; it is their
   * explicit choice and this must not override it. */
  const openHelp = new Set();
  function inlineHelp(key, extraKey = null) {
    const h = HELP[key];
    if (!h) return '';
    const open = app.register === 'clinical' || openHelp.has(key);
    const body = app.register === 'clinical'
      ? esc(h.tech?.[app.lang] ?? '')
      : esc(h.plain?.[app.lang] ?? '') +
        (open ? `<b>${T('helpTech')}</b>${esc(h.tech?.[app.lang] ?? '')}` : '');
    const extra = extraKey && HELP[extraKey]
      ? `<b>${esc(T(EXTRA_NAME[extraKey] ?? extraKey))}</b>${
          esc(HELP[extraKey][app.register === 'clinical' ? 'tech' : 'plain']?.[app.lang] ?? '')}`
      : '';
    const more = app.register === 'clinical' ? ''
      : `<button class="whybtn" data-help="${esc(key)}" aria-expanded="${open}"
                 title="${esc(T('helpTech'))}">${open ? '−' : '?'}</button>`;
    return `${more}${body}${extra}`;
  }
  const EXTRA_NAME = {
    lookTissue: 'lookTissue', lookAnatomical: 'lookAnatomical', lookNeurons: 'lookNeurons',
    sagittal: 'scanSagittal', coronal: 'scanCoronal', axial: 'scanAxial', sweep: 'scanSweep',
  };

  /* Which panel is open, or null for none — the body is what the screen is for. */
  let tab = null;
  let ready = false;

  /* ------------------------------------------------------------------ chrome */
  function renderChrome() {
    $('title').textContent = T('title');
    $('subtitle').textContent = T('subtitle');
    $('langBtn').textContent = app.lang === 'en' ? '한국어' : 'English';
    renderBodyPick();
    for (const [id, k] of [['tabExplore', 'tabExplore'], ['tabExercise', 'tabExercise'],
                           ['tabEvidence', 'tabEvidence'], ['tabAbout', 'tabAbout']])
      $(id).textContent = T(k);
    $('viewsLabel').textContent = T('views');
    $('labBtn').textContent = T('labView');
    $('popclose').title = T('popClose');
    $('zoomIn').title = T('zoomIn');
    $('zoomOut').title = T('zoomOut');
    $('fitBtn').title = T('fitView');
    /* The rail is icons, and an icon nobody can read is a button nobody presses.
     * Every one of them carries its name, shown on hover and read out by a screen
     * reader, in whichever language the app is in. */
    for (const b of document.querySelectorAll('#rail [data-pop]')) {
      const sec = SECTIONS[b.dataset.pop];
      const name = T(sec?.title ?? b.dataset.pop);
      b.setAttribute('aria-label', name);
      if (b.dataset.pop !== 'structure') b.querySelector('em').textContent = name;
    }
    for (const [id, k] of [['vAnt', 'anterior'], ['vPost', 'posterior'], ['vLat', 'lateral'],
                           ['vSup', 'superior'], ['vHead', 'head'], ['vAll', 'wholeBody']])
      $(id).textContent = T(k);
    $('atlasLab').textContent = T('atlasSlider');
    $('xrayLab').textContent = T('xray');
    /* Named by where the slider is, not by what it does: "Take apart 40%" says
     * less than "Separated". The endpoints are the label. */
    $('explodeLab').textContent = app.explode > 0.01
      ? `${T('explode')} — ${Math.round(app.explode * 100)}%` : T('explode');
    const eh = $('explodeHelp');
    if (eh) {
      eh.textContent = T(explodeLayout?.() === 'open' ? 'explodeHelp' : 'exInventoryHelp');
      eh.hidden = app.explode <= 0.01;
    }
    const lay = explodeLayout?.() ?? 'inventory';
    const ell = $('explodeLayoutLab');
    if (ell) ell.textContent = T('exLayout');
    for (const [id, which] of [['exInventory', 'inventory'], ['exOpen', 'open']]) {
      const b = $(id);
      if (!b) continue;
      b.textContent = T(id);
      b.setAttribute('aria-pressed', String(lay === which));
    }
    const ex = $('explode');
    if (ex && document.activeElement !== ex) ex.value = String(app.explode);
    $('scanLab').textContent = T('scan');
    /* Name and result on every plane button: "Axial" alone was the word the reader did not
     * know, and "top | bottom" beside the picture of the cut is the half that answers it. */
    for (const [id, name, cut] of [['scanSag', 'scanSagittal', 'cutSagittal'],
                                   ['scanCor', 'scanCoronal', 'cutCoronal'],
                                   ['scanAx', 'scanAxial', 'cutAxial']]) {
      $(id).querySelector('b').textContent = T(name);
      $(id).querySelector('i').textContent = T(cut);
    }
    $('lookLab').textContent = T('brainLookLab');
    $('lookTissue').textContent = T('lookTissue');
    $('lookAnat').textContent = T('lookAnatomical');
    $('lookNeurons').textContent = T('lookNeurons');
    $('scanAtLab').textContent = T('scanAt');
    /* The three plane buttons are laid out above, into their own <b> and <i>. Writing
     * `textContent` on the button itself — which is what these lines used to do, back when a
     * plane button was a word — replaces every child with a text node, so the icon and both
     * labels vanished and the *next* call to this function threw on the missing <b>. It only
     * showed on the second call, which is why the first render looked correct. */
    $('scanOff').textContent = T('scanOff');
    $('scanSweep').textContent = T('scanSweep');
    $('clipLab').textContent = T('sliceSlider');
    $('mCut').textContent = T('cutaway');
    $('mRot').textContent = T('rotate');
    $('labToggle').textContent = T('labels');
    $('reset').textContent = T('reset');
    $('registerLab').textContent = T('register');
    $('regPlain').textContent = T('regPlain');
    $('regClinical').textContent = T('regClinical');
    $('regBoth').textContent = T('regBoth');
    $('instrLab').textContent = T('instruction');
    renderLayerList();
    renderDisclaimerBar();
  }

  /* Only drawn when there is a choice to make. One body is not a picker, it is a label the
   * reader cannot act on, and the About panel already names the subject in full. */
  function renderBodyPick() {
    const ids = availableBodies();
    const el = $('bodyPick');
    if (!el) return;
    el.innerHTML = ids.length < 2 ? '' : ids.map(id => (id === body.id
      ? `<span class="on" aria-current="true">${esc(BODIES[id].name[app.lang])}</span>`
      : `<a href="${esc(bodyHref(id))}">${esc(BODIES[id].name[app.lang])}</a>`)).join('');
  }

  function renderLayerList() {
    /* Only while its panel is open. The list used to live on the stage and be
     * rebuilt from `renderChrome`; it is a panel section now, so on every language
     * change and every body switch this was writing into an element that is not
     * there. */
    if (!$('layerList')) return;
    /* Only the layers this body actually carries. A toggle for a layer that does not exist is
     * a promise the atlas cannot keep — the peripheral nervous system comes from a source
     * derived from the male scan, so another body has no nerves to show and should not offer
     * a switch for them. */
    /* How many structures each layer holds, counted off the registry rather than
     * off what has loaded: a layer that is off has loaded nothing, and a row
     * reading "Arteries" with no number beside it does not tell a reader that
     * turning it on adds three hundred and fifty-three things. */
    const per = {};
    for (const r of registry().byId.values())
      if (!r.parts) per[r.layer] = (per[r.layer] ?? 0) + 1;
    const shown = LAYER_ORDER.filter(n2 => hasLayer(n2));
    const anyOn = shown.some(n2 => app.layers[n2].on);
    $('layerList').innerHTML = shown.map(name => `
      <div class="layerrow">
        <button class="lyr" data-layer="${name}" aria-pressed="${app.layers[name].on}">
          <i style="background:${layerSwatch(name)}"></i>${T(name)}
          <em class="lycount">${per[name] ?? 0}</em>
        </button>
        <input type="range" class="lyop" data-layer="${name}" min="0.08" max="1" step="0.01"
               value="${app.layers[name].opacity}" aria-label="${T(name)} opacity">
      </div>`).join('')
      + `<div class="layerall"><span>${Object.values(per).reduce((a, b) => a + b, 0)} ${
          T('structuresWord')}</span>
         <button class="mini" data-layerall="${anyOn ? 'off' : 'on'}">${
          T(anyOn ? 'hideAll' : 'showAll')}</button></div>`;
    for (const b of $('layerList').querySelectorAll('.lyr'))
      b.onclick = () => setLayer(b.dataset.layer, b.getAttribute('aria-pressed') !== 'true');
    for (const s of $('layerList').querySelectorAll('.lyop'))
      s.oninput = e => setLayerOpacity(s.dataset.layer, +e.target.value);
    const all = $('layerList').querySelector('[data-layerall]');
    if (all) all.onclick = async () => {
      const on = all.dataset.layerall === 'on';
      for (const n2 of shown) await setLayer(n2, on);
      renderLayerList();
    };
  }
  const SWATCH = { skeleton: '#e8e2d4', muscles_superficial: '#b8544a',
                   muscles_deep: '#8f3c36', organs: '#c09068', nervous: '#F2D98B',
                   brain: '#cfb2a8',
                   arteries: '#C0392B', veins: '#3D6C9E', airways: '#8FA9B8',
                   connective: '#CFC3A8', nerves_cranial: '#E8C86B',
                   heart_detail: '#B05A52', detail: '#9E8F7A' };
  const layerSwatch = n => SWATCH[n] ?? '#8b95ab';

  /** The four lines that must not move, rendered where the user is rather than in a footer. */
  function renderDisclaimerBar() {
    $('discBar').innerHTML = DISCLAIMERS.map((d, i) =>
      `<button class="disc" data-disc="${i}">${esc(disc(i, app.lang).title)}</button>`).join('');
    for (const b of $('discBar').querySelectorAll('.disc'))
      b.onclick = () => openDisclaimer(+b.dataset.disc);
  }
  function openDisclaimer(i) {
    const d = disc(i, app.lang);
    $('overlay').innerHTML = `<div class="card narrow">
      <div class="cbody"><h2>${esc(d.title)}</h2><p class="lead">${esc(d.body)}</p>
      <div class="cnav"><button id="ovClose" class="primary">${T('close')}</button></div></div></div>`;
    $('overlay').classList.add('on');
    $('ovClose').onclick = () => { $('overlay').classList.remove('on'); $('overlay').innerHTML = ''; };
  }

  /* ------------------------------------------------------------------- panel */
  /* The panel scrolls, and `innerHTML =` does not move the scroll. So opening an exercise
   * from the bottom of the library list put the reader a thousand pixels into its detail
   * page — past the name, the review status and the movement — with no way to know a page
   * had begun above them. Reset when the *subject* changes; a plain re-render must not,
   * because the search box re-renders on every keystroke and the filters on every click,
   * and jumping to the top mid-scroll is the same fault from the other side. */
  /* --------------------------------------------------------------- the panels
   *
   * One at a time, in one box, opened from the rail and closed by default.
   *
   * `SECTIONS` is the whole list: what its title is, which renderer fills its
   * body, and which of the three control blocks -- body, brain, reading -- sits
   * under it. A section with no renderer is controls only, which is what
   * separates "take the body apart" from "read about a muscle": they were in one
   * scrolling column and every reader had to scroll past the whole atlas to
   * reach a slider.
   */
  const SECTIONS = {
    structure: { title: 'popStructure', body: () => detailBlock(), rail: 'railStructure' },
    explore:   { title: 'tabExplore',  body: exploreTab },
    exercise:  { title: 'tabExercise', body: exerciseTab },
    evidence:  { title: 'tabEvidence', body: evidenceTab },
    about:     { title: 'tabAbout',    body: aboutTab },
    layers:    { title: 'layers',      body: () => '<div id="layerList"></div>' },
    display:   { title: 'popDisplay',  controls: ['controls', 'readControls'] },
    /* Every control in here is about the cortex, and every one of them hides itself
     * when the brain layer is off — which left an empty box with a title. It says
     * so instead, and offers the switch. */
    /* The region network moved in here from Explore. It is a brain instrument --
     * it has nothing to draw without a cortex -- and in Explore it sat between the
     * group chips and four hundred swatches, which is most of why that panel could
     * not be navigated. */
    brain:     { title: 'popBrain',    controls: ['brainControls'],
                 body: () => app.layers.brain?.on ? connBlock()
                   : `<p class="note">${T('brainOffNote')}</p>
                      <div class="soloRow"><button class="solobtn" data-brainon="1">${
                        T('brainOn')}</button></div>` },
  };
  const SECTION_KEYS = Object.keys(SECTIONS);

  let shownKey = null;
  function renderPanel() {
    const sec = SECTIONS[tab] ?? SECTIONS.explore;
    const open = !!tab;
    $('panel').hidden = !open;
    /* The section strip and the orientation caption run to the rail when nothing
     * is open and stop at the panel when something is: a strip of nine cuts with
     * its last three behind glass is a strip whose last three cuts do not exist. */
    document.body.classList.toggle('pop-open', open);
    for (const b of document.querySelectorAll('#rail [data-pop]'))
      b.setAttribute('aria-pressed', String(b.dataset.pop === tab));
    /* The structure button only exists while there is one, and it carries the
     * name so the rail says what is selected without the panel being open. */
    const rs = $('railStructure');
    if (rs) {
      const r = app.selected != null ? get(app.selected) : null;
      rs.hidden = !r;
      rs.querySelector('em').textContent = r ? r.name[app.lang] : '';
    }
    if (!open) { syncControlBlocks(null); return; }
    $('poptitle').textContent = T(sec.title);
    $('panelBody').innerHTML = sec.body ? sec.body() : '';
    syncControlBlocks(sec.controls ?? null);
    const key = `${tab}:${tab === 'exercise' ? (app.exercise ?? '')
                        : tab === 'structure' ? (app.selected ?? '') : ''}`;
    if (key !== shownKey) { shownKey = key; $('panelBody').scrollTop = 0; }
    if (tab === 'layers') renderLayerList();
    if (tab === 'about') {
      const chip = document.getElementById('demochip');
      const slot = $('demoslot');
      if (chip && slot && chip.parentElement !== slot) { slot.appendChild(chip); chip.hidden = false; }
    }
    wirePanel();
  }

  /** Show only the control blocks this section owns; the rest stay in the DOM, hidden. */
  function syncControlBlocks(want) {
    for (const id of ['controls', 'brainControls', 'readControls']) {
      const el = $(id);
      if (el) el.hidden = !want?.includes(id);
    }
  }

  /** Open a section, or close the panel when the one already open is asked for again. */
  function openPop(which) {
    tab = (which && which !== tab && SECTION_KEYS.includes(which)) ? which : null;
    renderPanel();
  }
  function closePop() { tab = null; renderPanel(); }

  /* ------------------------------------------------------------------ the lab
   * A screen rather than a panel. Everything it draws is a getter onto the live application
   * rather than a snapshot, because it is built once and the network, the clip and the
   * selection all arrive and change afterwards. */
  const lab = new Lab($('lab'), {
    lang: () => app.lang,
    register: () => app.register,
    graph: () => regionGraph?.() ?? null,
    cells: () => ctx.neuralStats?.()?.nodes ?? 0,
    cells2: () => cellGraph?.() ?? null,
    cortex: () => ctx.cortexMesh?.() ?? null,
    plate: () => ctx.brainPlateImage?.() ?? null,
    /* The lab draws the same sections the stage does, four times the area — see `drawSections`
     * in `main.js`. Handing it the canvases rather than an image keeps one renderer and one
     * SectionStrip: two would be two pictures that could disagree. */
    sections: (canvases, plane, focus) => ctx.drawSections?.(canvases, plane, focus) ?? null,
    scanPlane: () => app.scan?.plane ?? null,
    scanTo: (plane, at) => ctx.setScanToSlice?.(plane, at),
    /* Which structure a cut is showing at a point on it, so the picture can be pointed at and
     * chosen rather than only looked at. */
    pickCut: (plane, at, sx, sy) => ctx.pickInSection?.(plane, at, sx, sy) ?? null,
    locate: (id, plane) => ctx.locateInSections?.(id, plane) ?? null,
    /* What the chosen exercise works, assembled by `content/analysis.js` from the four things
     * this repository actually holds — see that file for what each is allowed to claim. */
    analysis: lang => ctx.exerciseAnalysis?.(lang) ?? null,
    /* The live scene rendered into a canvas — the same geometry the stage is drawing, not a
     * second copy of it. See `renderStageInto`. */
    stage: (canvas, w, h) => ctx.renderStageInto?.(canvas, w, h) ?? false,
    /* One structure of it, twice: framed on itself with everything else hidden, and framed on
     * the whole figure with the point to ring handed back. Same scene, same pose. */
    structure: (canvas, w, h, id, opts) => ctx.renderStructureInto?.(canvas, w, h, id, opts) ?? null,
    /* A joint's own centre of rotation in the pose on screen — a joint has no mesh, so the
     * panel rings a point rather than lighting a structure. */
    jointAt: coord => ctx.jointCentre?.(coord) ?? null,
    /* So the panel can tell "still arriving" from "this model has no shape for it". */
    pending: id => ctx.layerPending?.(id) ?? false,
    selected: () => app.selected ?? -1,
    exercise: () => app.exercise,
    t: () => app.t,
    select: id => { selectStructure(id); lab.draw(); },
    /* Chosen for the reader rather than by them — the tour stepping to the next muscle. It is
     * the same selection and every panel reads it the same way; what it does not do is fly the
     * camera behind the overlay or peel the body apart, twenty times in a row. */
    selectQuiet: id => { selectStructure(id, { auto: true }); lab.draw(); },
    close: () => setLab(false),
    /* The reading, assembled here rather than in `lab.js`, because it comes out of the same
     * GLOSSARY table and the same body registry the console uses — one description of each
     * thing, shown at two lengths in two places, so a control cannot be documented in one and
     * left undocumented in the other. */
    reference: () => ({
      groups: GLOSSARY.map(([head, keys]) => ({
        title: T(head),
        items: keys.map(k => ({
          name: T(GLOSS_NAME[k] ?? k),
          plain: HELP[k]?.plain?.[app.lang] ?? '',
          tech: HELP[k]?.tech?.[app.lang] ?? '',
        })),
      })),
      sources: sourceBlocks(),
    }),
  });
  /**
   * Open or close the lab.
   *
   * Opening it turns the brain layer on. Every panel on that screen is drawn from the network,
   * and the network is built when the cortex loads — so opening the lab with the brain off
   * gave a screen of empty grids that looked exactly like a broken lab. Turning the layer on
   * is also what the reader is asking for: nothing else on that screen is about the body.
   * The redraw is deferred to the load, because the meshes, the network and the lateral plate
   * all arrive after the click.
   */
  function setLab(on, view = null) {
    app.labOpen = !!on;
    lab.show(app.labOpen, view);
    $('labBtn').setAttribute('aria-pressed', app.labOpen);
    document.body.classList.toggle('lab-open', app.labOpen);
    if (app.labOpen && !app.layers.brain?.on) {
      Promise.resolve(setLayer('brain', true))
        .then(() => { if (app.labOpen) lab.draw(); })
        .catch(e => console.error(e));
    }
  }

  /* ------------------------------------------------------------- the network
   * The region graph, drawn from the live network — see `connectome.js`. It only appears with
   * the brain layer on, because with the brain off there is no network and a panel reading
   * "0 regions" is a worse answer than no panel. */
  let conn = null;
  function connBlock() {
    if (!app.layers.brain?.on) return '';
    return `<div class="blk">
      <h4>${T('connHead')}</h4>
      <div class="connplot" id="connPlot"></div>
      <div class="connread" id="connRead"></div>
      <div class="chelp" id="connHelp">${inlineHelp('connectome')}</div>
    </div>`;
  }

  function drawConn() {
    if (!conn || !conn.canvas.isConnected) return;
    if (!conn.draw(app.selected ?? -1, regionActivity?.(), app.lang)) return;
    const read = $('connRead');
    if (!read || !conn.graph) return;
    read.textContent = `${conn.graph.nodes.length} ${T('connCount')} · ` +
                       `${conn.graph.edges.length} ${T('connLinks')}`;
  }

  function wireConn() {
    const host = $('connPlot');
    if (!host) { conn = conn && (conn.hover = -1, conn); return; }
    conn ??= new Connectome();
    conn.attach(host, drawConn);
    const g = regionGraph?.();
    if (g) conn.load(g);
    conn.canvas.onpointermove = e => {
      const h = conn.hit(e.offsetX, e.offsetY);
      if (h === conn.hover) return;
      conn.hover = h;
      conn.canvas.style.cursor = h >= 0 ? 'pointer' : '';
      drawConn();
    };
    conn.canvas.onpointerleave = () => { conn.hover = -1; drawConn(); };
    /* Clicking a node selects that region, which is what makes this a control rather than a
     * diagram: the camera flies to it, the cortex highlights it and its cells fire harder. */
    conn.canvas.onclick = e => {
      const h = conn.hit(e.offsetX, e.offsetY);
      if (h >= 0) selectStructure(h);
    };
    drawConn();
  }

  /**
   * Where every number in this application came from.
   *
   * Lifted out of the About tab so the Lab's reading page and the console's short version are
   * the same list rather than two lists that can drift. Plain strings, not markup: the reading
   * page builds nodes.
   */
  function sourceBlocks() {
    const meta = registry().meta;
    const rig = rigData();
    const out = [
      { title: `${T('body')} — ${meta.structures.length} ${T('structures')}`,
        lines: [meta.attribution, `${meta.source} · ${meta.licence}`, body.citation,
                body.subject[app.lang] + (body.bounds ? ' ' + body.bounds[app.lang] : ''),
                body.nervousSource ?? ''].filter(Boolean) },
      { title: T('brain'),
        lines: ['fsaverage cortical surface with the Desikan-Killiany atlas, and subcortical ' +
                'structures marching-cubed from aseg.mgz.',
                'Fischl B et al., Neuron 2002;33(3):341–55; ' +
                'Desikan RS et al., NeuroImage 2006;31(3):968–80.'] },
      { title: T('frameHeading'),
        lines: [`${T('frameBody')} ${BODY_FRAME.heightMm.toFixed(0)} mm → 1.0.`,
                `${T('frameFit')} ${BRAIN_TO_BODY.landmarks.length}; ` +
                `${BRAIN_TO_BODY.residualMm.mean.toFixed(1)} mm / ` +
                `${BRAIN_TO_BODY.residualMm.max.toFixed(1)} mm.`] },
      { title: T('jointRanges'),
        lines: [T('jointRangesBody'), rig?.romCitation ?? '', rig?.spine?.citation ?? '']
                 .filter(Boolean) },
      { title: T('bodiesHeading'),
        lines: Object.values(BODIES).map(b =>
          `${b.name[app.lang]} — ${b.source} · ${b.licence}. ${b.subject[app.lang]}`) },
      { title: T('pathSchematic'), lines: [T('pathSchematicBody')] },
    ];
    /* The groups carry their own provenance because they came from a different
     * table of the same database than the meshes did — the 4.0 concept
     * hierarchy over 3.0 geometry — and a reader entitled to ask "where did
     * `the hamstrings` come from" should not have to infer it. */
    const gmeta = anatomyGroups?.().length ? groupTable().meta : null;
    if (gmeta) out.splice(1, 0, {
      title: `${T('groups')} — ${anatomyGroups().length}`,
      lines: [gmeta.attribution, `${gmeta.source} · ${gmeta.licence}`, gmeta.note].filter(Boolean),
    });
    return out.filter(g => g.lines.length);
  }

  /* --------------------------------------------------------------- glossary
   * Grouped the way the controls are grouped, so a reader who came looking for one thing
   * finds the things beside it. `GLOSS_NAME` maps a help key onto the UI string the control
   * itself carries — the glossary must call a control by the name printed on it, or it is a
   * second vocabulary rather than an explanation of the first. */
  const GLOSSARY = [
    ['scan', ['scanPlane', 'sagittal', 'coronal', 'axial', 'sweep', 'scanAt', 'sections']],
    ['brainLookLab', ['brainLook', 'lookTissue', 'lookAnatomical']],
    ['brain', ['network', 'connectome', 'networkDrive', 'cellProbe', 'cellsRead', 'regionsRead']],
    /* Every panel of the lab, described in the same place as every control. The panel notes
     * say the same thing under each chart; a reader who wants to read rather than click gets
     * the whole instrument as one page instead of scrolling a screen of graphs to find the
     * paragraph attached to one of them. */
    ['labView', ['labScreen']],
    ['labPanels', ['labAnalysis', 'labDetail', 'labConnectome', 'labRegionMap', 'labFibres', 'labRegionCells',
                   'labCellKey', 'labRoster', 'labSectionsBig', 'labJoints', 'labMuscles',
                   'labEvidence']],
    ['views', ['xray', 'atlasHelp', 'cutawayHelp', 'structuresRead']],
    ['activation', ['actChartHelp']],
  ];
  const GLOSS_NAME = {
    scanPlane: 'scan', sagittal: 'scanSagittal', coronal: 'scanCoronal', axial: 'scanAxial',
    sweep: 'scanSweep', scanAt: 'scanAt', sections: 'sections',
    brainLook: 'brainLookLab', lookTissue: 'lookTissue', lookAnatomical: 'lookAnatomical',
    network: 'brain', connectome: 'connHead', labScreen: 'labView',
    networkDrive: 'trace', cellProbe: 'cellProbeLab',
    cellsRead: 'hudNodes', regionsRead: 'hudRegions', structuresRead: 'hudStructures',
    xray: 'xray', atlasHelp: 'atlasSlider', cutawayHelp: 'cutaway',
    actChartHelp: 'chartHead',
    labConnectome: 'labConnectome', labRegionMap: 'labRegionMap', labFibres: 'labFibres',
    labCellKey: 'labCellKey', labRoster: 'labRoster', labSectionsBig: 'labSections',
    labRegionCells: 'labRegionCells', labAnalysis: 'labAnalysis',
    labJoints: 'labJoints', labMuscles: 'labMuscles', labEvidence: 'labEvidence',
  };

  /* -------------------------------------------------------------- explore tab */
  /**
   * Explore: the picture first, then a way into it.
   *
   * It used to open on a paragraph and then two long unstructured runs of chips — a hundred and
   * ninety muscle names in one wrapping block, which is a list you scroll past rather than a
   * list you use. The order is the fix as much as the styling: whatever is selected at the top,
   * then the network, then the systems, then the names as a two-column grid of colour swatches
   * where a colour is the thing you are actually matching against the picture.
   */
  /**
   * What the reader typed into the structure search, kept across re-renders.
   *
   * Outside `exploreTab` for the same reason `lib.q` is outside the library:
   * the panel is rebuilt from scratch on every keystroke, so anything held
   * inside the render function is a box that empties itself as you type.
   */
  const find = { q: '' };

  /* What a search term matches on one structure now lives in structures.js as
   * `searchText`, so content.test.mjs can search the atlas without a browser.
   *
   * It was called `haystack` here, and was the second function of that name in
   * this file -- the exercise library has one further down. Two function
   * declarations in one scope do not collide, they shadow: the later won, every
   * call here handed a registry record to a function expecting an exercise key,
   * and searching threw on the first keystroke. `tests/test_browser_sources.py`
   * now fails on a duplicate name rather than leaving it to be found by typing.
   */

  const KIND_ORDER = [['muscle', 'kindMuscle'], ['bone', 'kindBone'], ['nerve', 'kindNerve'],
                      ['vessel', 'kindVessel'], ['organ', 'kindOrgan'], ['brain', 'kindBrain']];

  /**
   * Explore: find it, or browse to it.
   *
   * The list used to be `documented()` — the ninety-one muscles with a written
   * entry, plus the brain regions. Everything else in the atlas, which is a
   * hundred and fifty-two bones, seventy organs and twenty nerves, was reachable
   * only by finding it on the body and clicking it. That is a fine way to meet a
   * structure and a hopeless way to look one up, and it is why the search box
   * comes first: four hundred and thirty structures and seventy-four groups, in
   * both languages, matched on name, Latin, and FMA id.
   *
   * With nothing typed it browses instead — the groups a class is cued in, then
   * every structure by kind — because a reader who does not yet know the name of
   * the thing they are looking for cannot search for it.
   */
  function exploreTab() {
    const q = find.q.trim().toLowerCase();
    const all = [...registry().byId.values()];
    const gs = anatomyGroups?.() ?? [];

    if (q) {
      const hitGroups = gs.filter(g =>
        `${g.name.en} ${g.name.ko} ${g.formal} ${g.fma}`.toLowerCase().includes(q));
      const hits = all.filter(r => searchText(r).includes(q));
      /* Shortest name first. Searching "rectus" should offer `rectus femoris`
       * before `rectus capitis posterior minor`, and length is the cheap proxy
       * for "less qualified, so more likely the one meant". */
      hits.sort((a, b) => a.name[app.lang].length - b.name[app.lang].length
                       || a.name[app.lang].localeCompare(b.name[app.lang]));
      const byKind = KIND_ORDER
        .map(([kind, str]) => [str, hits.filter(r => r.kind === kind)])
        .filter(([, list]) => list.length);
      return `
        ${findBox(hits.length + hitGroups.length)}
        ${hitGroups.length ? `<h3>${T('groups')}<em>${hitGroups.length}</em></h3>
          <div class="gchips">${hitGroups.map(groupChip).join('')}</div>` : ''}
        ${byKind.map(([str, list]) => `
          <h3>${T(str)}<em>${list.length}</em></h3>
          <div class="swatches">${list.slice(0, 60).map(swatch).join('')}</div>
          ${list.length > 60 ? `<p class="note small">${T('findMore')}</p>` : ''}`).join('')}
        ${hits.length + hitGroups.length ? '' : `<p class="note">${T('findNone')}</p>`}`;
    }

    const byKind = KIND_ORDER
      .map(([kind, str]) => [str, all.filter(r => r.kind === kind)
        .sort((a, b) => a.name[app.lang].localeCompare(b.name[app.lang]))])
      .filter(([, list]) => list.length);
    /* Groups come straight after the search box, above the region network and the
     * label filter, because they are the level a class is taught at and the
     * network is a brain instrument. Sitting fourth they were below the fold on
     * a laptop, which is indistinguishable from not being there. */
    return `
      ${findBox(null)}
      ${groupsSection(gs)}
      ${labelFilter()}
      ${byKind.map(([str, list]) => `
        <h3>${T(str)}<em>${list.length}</em></h3>
        <div class="swatches">${list.map(swatch).join('')}</div>`).join('')}
      <p class="note">${T('exploreBody')}</p>`;
  }

  function findBox(count) {
    return `<div class="findrow">
      <input id="anatQ" type="search" value="${esc(find.q)}"
             placeholder="${esc(T('findHint'))}" aria-label="${esc(T('findAnat'))}">
      ${count == null ? '' : `<span class="small-number">${count} ${T('findCount')}</span>`}
    </div>`;
  }

  const groupChip = g => `<button class="gchip${app.group === g.fma ? ' on' : ''}"
      data-group="${esc(g.fma)}" title="${esc(g.formal)}"
      aria-pressed="${app.group === g.fma}">${esc(g.name[app.lang])}
      <em>${g.members.length}</em></button>`;

  /**
   * The groups, in the sections a class works through.
   *
   * Shown above the four hundred individual names on purpose: "the hamstrings"
   * is what a coach says, and offering it before `semimembranosus` is offering
   * the reader the level they are already thinking at.
   */
  function groupsSection(gs) {
    if (!gs.length) return '';
    const on = app.group ? (gs.find(g => g.fma === app.group) ?? null) : null;
    /* Seventy-seven chips in seven sections is most of a screen, so the whole
     * thing folds -- open, because a reader who has never seen it cannot ask for
     * something they do not know is there. A native `details` rather than the
     * accordion in the session layer: this is one disclosure with no state to
     * keep, and the browser already does it. */
    return `
      <details class="groups" open>
        <summary><span>${T('groups')}</span><em>${gs.length}</em></summary>
        <p class="note small">${T('groupsHint')}</p>
          ${on ? `<div class="groupon">${T('groupOn')}: <b>${esc(on.name[app.lang])}</b>
          <span class="small-number">${on.members.length} ${T('groupMembers')}</span>
          <button class="mini" data-isolate="${on.members.join(' ')}">${T('isolate')}</button>
          <button class="mini" id="groupClear">${T('groupClear')}</button></div>` : ''}
        ${GROUP_REGIONS.map(region => {
          const list = gs.filter(g => g.region === region.id);
          if (!list.length) return '';
          return `<h4 class="gregion">${esc(region[app.lang] ?? region.en)}</h4>
            <div class="gchips">${list.map(groupChip).join('')}</div>`;
        }).join('')}
      </details>`;
  }
  /* A colour block and a name. The block is the point: it is what a reader matches against the
   * structure they are looking at on the picture, and at this size a row of them reads as a
   * palette rather than as prose. */
  const swatch = r => `<button class="swatch" data-id="${r.id}"
      aria-current="${app.selected === r.id}" title="${esc(r.name[app.lang])}">
      <i style="background:${r.color}"></i><span>${esc(r.name[app.lang])}</span></button>`;

  /* --------------------------------------------------------- the label filter
   * Four hundred structures share two label lanes, so with everything named at once the
   * lanes fill with whatever happens to be nearest the camera and the one system a reader
   * came to look at never gets a word on screen. These say which systems to name; nothing
   * selected means all of them, which is how the app opens.
   *
   * Choosing a system turns its layer on as well. Asking for the nerves and being shown an
   * empty picture because the nerve layer was off is not a filter, it is a puzzle. */
  const KINDS = [['bone', 'kindBone'], ['muscle', 'kindMuscle'], ['nerve', 'kindNerve'],
                 ['organ', 'kindOrgan'], ['brain', 'kindBrain']];
  function kindCounts() {
    const n = new Map();
    for (const [, r] of registry().byId) n.set(r.kind, (n.get(r.kind) ?? 0) + 1);
    return n;
  }
  function labelFilter() {
    const counts = kindCounts();
    const on = app.labelKinds;
    const chips = KINDS.filter(([k]) => counts.get(k)).map(([k, str]) =>
      `<button class="fchip" data-kind="${k}" aria-pressed="${on.has(k)}">${
        esc(T(str))}<em>${counts.get(k)}</em></button>`).join('');
    return `<h3>${T('showLabels')}</h3>
      <p class="note">${esc(T('labelHint'))}</p>
      <div class="facet">
        <button class="fchip" data-kind="" aria-pressed="${on.size === 0}">${T('filterAll')}</button>
        ${chips}
        <button class="fchip xrayChip" id="insideBtn" aria-pressed="${app.xray > 0.5}">${
          app.xray > 0.5 ? esc(T('seeInsideOff')) : esc(T('seeInside'))}</button>
      </div>`;
  }
  const chip = r => `<button class="chip" data-id="${r.id}" aria-current="${app.selected === r.id}">
      <i style="background:${r.color}"></i>${esc(r.name[app.lang])}</button>`;

  /** What is on screen, in whichever register the user asked for. */
  /**
   * Show this one thing, and nothing else.
   *
   * It used to be a `mini` button inside the group chips, three quarters of the
   * way down a card, and the report on that was "where is my isolation feature?"
   * — which is the correct reading of a control that small in that position. A
   * body of a thousand structures needs *show me only this* to be the loudest
   * thing on the card after the name, because it is the only way to actually see
   * most of them.
   */
  function soloAction(r) {
    const alone = (isolated?.() ?? []).includes(r.id);
    const many = (isolated?.() ?? []).length > 1;
    return `<div class="soloRow">
      <button class="solobtn${alone ? ' on' : ''}" data-isolate="${r.id}">
        ${T(alone && !many ? 'isolateOff' : 'isolate')}</button>
      <button class="mini flyto" data-flyto="${r.id}">${T('flyTo')}</button>
      ${alone ? `<p class="chelp">${T('isolateHint')}</p>` : ''}
    </div>`;
  }

  /**
   * The top of every structure card: what it is, and the two things to do with it.
   *
   * Above the description rather than below it, because "show me only this" is
   * what a reader wants *before* they read three paragraphs, not after — and
   * because on a bone or an artery the description is a system overview they have
   * read a hundred times, and burying the control under it made it invisible.
   */
  function structureHead(r) {
    const kind = T({ muscle: 'kindMuscle', bone: 'kindBone', nerve: 'kindNerve',
                     vessel: 'kindVessel', organ: 'kindOrgan', brain: 'kindBrain' }[r.kind]
                   ?? r.layer);
    return `<div class="shead">
      <div class="dname"><span class="dot" style="background:${r.color}"></span>${
        esc(r.name[app.lang])}</div>
      <div class="dwhere">${esc(kind)} · ${T(r.layer)}${
        r.sides?.includes('L') && r.sides?.includes('R') ? ' · L+R' : ''}${
        r.fma?.length ? ` · ${esc(r.fma[0])}` : ''}</div>
    </div>${soloAction(r)}`;
  }

  function detailBlock() {
    const id = app.selected;
    /* One line, not a paragraph. Nothing is selected yet, so this is the state a reader is in
     * for as long as it takes them to click something — it should not be the tallest thing on
     * the panel while they look for what to click. The full sentence is at the foot of the
     * tab, under the list it is about. */
    if (id == null) return `<p class="pickme">${T('explore')}</p>`;
    const r = get(id);
    if (!r) return '';
    if (r.kind === 'brain') return structureHead(r) + brainDetail(r);
    if (r.muscle) return structureHead(r) + muscleDetail(r);
    const overview = KIND_OVERVIEW[r.kind]?.[app.lang] ?? '';
    return `${structureHead(r)}<div class="detail">
      ${groupBlock(r)}
      ${overview ? `<div class="blk overview">
        <h4>${T('systemNote')}</h4>
        <p>${esc(overview)}</p></div>` : ''}
      <div class="empty small"><h2>${T('noContent')}</h2><p>${T('noContentBody')}</p></div>
    </div>`;
  }

  /**
   * Which named sets this structure belongs to.
   *
   * It earns its place hardest on the structures with no written entry — most of
   * the hundred and fifty-two bones. "Fourth lumbar vertebra" used to be a name
   * over an apology; it is now a name, and the lumbar spine, the vertebrae and
   * the disks it sits between, each of them one press away.
   *
   * Most specific first, and capped: `sacrum` is in seven of these and the last
   * three are `wall of abdomen`-shaped groups that tell a reader nothing they
   * could not see.
   */
  function groupBlock(r) {
    const gs = (groupsForStructure?.(r.id) ?? []).slice(0, 4);
    // isolation moved out of here and into `soloAction`, which is the whole width
    // of the card: a control nobody could find was a control that did not exist
    if (!gs.length) return '';
    return `<div class="groupsof"><h4>${T('groupOf')}</h4>${gs.map(g =>
      `<button class="gchip${app.group === g.fma ? ' on' : ''}" data-group="${esc(g.fma)}"
               title="${esc(g.formal)}">${esc(g.name[app.lang])}
        <em>${g.members.length}</em></button>`).join('')}</div>`;
  }

  const plain = () => app.register !== 'clinical';
  const clinical = () => app.register !== 'plain';

  function muscleDetail(r) {
    const m = r.muscle, t = m[app.lang];
    const role = activationOf(r.id);
    /* `group` is a fourth value on the same channel and it deliberately has no
     * label here: a group says these structures are the ones being talked about,
     * not what any of them is doing. Naming it "prime mover" would be a claim the
     * ontology never made. The group itself is named in `groupBlock` below. */
    const roleLabel = { prime: T('primeMovers'), synergists: T('synergistsEx'), stabilisers: T('stabilisers') };
    /* A synergist named as a whole muscle links to whichever part the picture
     * can actually show, so a chip is never a button that selects nothing. */
    const linkList = (arr) => (arr ?? []).map(n => {
      const s = registry().byName.get(n);
      if (!s) return '';
      const id = s.parts ? drawnIds(n)[0] : s.id;
      return `<button class="mini" data-id="${id}">${esc(s.name[app.lang])}</button>`;
    }).join('');
    return `<div class="detail">
      <div class="dko">${esc(m.latin)}</div>
      ${role && roleLabel[role] ? `<div class="rolechip" style="border-color:${r.color}">${roleLabel[role]}</div>` : ''}
      ${groupBlock(r)}
      ${plain() ? `<div class="blk"><h4>${T('does')}</h4><p>${esc(t.does)}</p></div>` : ''}
      ${plain() && t.feels ? `<div class="blk feels"><h4>${T('feels')}</h4><p>${esc(t.feels)}</p></div>` : ''}
      ${clinical() ? `<div class="blk sci"><h4>${T('sci')}</h4><p>${esc(t.sci)}</p></div>` : ''}
      ${clinical() ? `
      <div class="blk grid2">
        <div><h4>${T('origin')}</h4><p>${esc(L(m.origin))}</p></div>
        <div><h4>${T('insertion')}</h4><p>${esc(L(m.insertion))}</p></div>
      </div>
      <div class="blk nerve"><h4>${T('innervation')}</h4>
        <p>${esc(L(m.innervation.nerves))}</p>
        <div class="roots">${m.innervation.roots.map(x => `<span>${esc(x)}</span>`).join('')}</div>
        <button class="act ghost small" id="travelBtn">${T('travelUp')}</button>
      </div>
      <div class="blk"><h4>${T('actions')}</h4><p>${esc(L(m.actions))}</p></div>` : ''}
      ${m.synergists?.length ? `<div class="blk"><h4>${T('synergists')}</h4><div class="chipwrap">${linkList(m.synergists)}</div></div>` : ''}
      ${m.antagonists?.length ? `<div class="blk"><h4>${T('antagonists')}</h4><div class="chipwrap">${linkList(m.antagonists)}</div></div>` : ''}
      ${m.dysfunction ? `<div class="blk warn"><h4>${T('dysfunction')}</h4><p>${esc(L(m.dysfunction))}</p></div>` : ''}
      ${pathBlock(r.key)}
      ${m.evidence ? claimCard(m.evidence) : ''}
    </div>`;
  }

  /**
   * The physiological half: what the OpenSim actuator says about this muscle right now.
   * Length is geometry and therefore real. Activation is the authored clip value and is
   * labelled as such — solving for activation needs a dynamic simulation with external
   * loads, which this is not, and a made-up number would be worse than none.
   */
  function pathBlock(name) {
    const rep = musclePathReport?.(name);
    if (!rep) return '';
    const live = liveActivationOf?.(name);
    const pct = (rep.normalised * 100).toFixed(1);
    return `<div class="blk math">
      <h4>${T('osimSource')}</h4>
      <p class="note">${esc(rep.actuators.join(', '))}</p>
      <div class="numrow">
        <div><span class="n">${pct}%</span><small>${T('pathRest')}</small></div>
        <div><span class="n">${(rep.lengthM * 100).toFixed(1)}<em>cm</em></span>
          <small>${T('pathLength')}</small></div>
      </div>
      <div class="numrow">
        <div><span class="n">${rep.maxIsometricForce.toFixed(0)}<em>N</em></span>
          <small>${T('maxForce')}</small></div>
        <div><span class="n">${(rep.optimalFiberLength * 100).toFixed(1)}<em>cm</em></span>
          <small>${T('fiberLength')}</small></div>
        <div><span class="n">${(rep.pennationAngle * 180 / Math.PI).toFixed(0)}<em>°</em></span>
          <small>${T('pennation')}</small></div>
      </div>
      ${live != null ? `<p class="note">${T('activation')}: ${live.toFixed(2)} — ${T('activationNote')}</p>` : ''}
    </div>`;
  }

  function brainDetail(r) {
    const t = r.info[app.lang];
    const claims = claimsForRegion(r.id);
    return `<div class="detail">
      <div class="dko">${esc(r.info[app.lang === 'ko' ? 'en' : 'ko'].name)}</div>
      <p class="dwhere">${esc(t.where)}</p>
      ${plain() ? `<div class="blk"><h4>${T('does')}</h4><p>${esc(t.does)}</p></div>` : ''}
      ${clinical() ? `<div class="blk sci"><h4>${T('sci')}</h4><p>${esc(t.sci)}</p></div>` : ''}
      ${claims.length ? `<h4 class="sechead">${T('tabEvidence')}</h4>
        ${claims.map(c => claimCard(c.key)).join('')}` : ''}
    </div>`;
  }

  /* --------------------------------------------------------------- the library
   * Two hundred entries is a search problem, not a list. The facets are the ones a person
   * actually picks by: what they practise, what part of the repertoire it belongs to, what
   * equipment they have, and how hard it is. Search runs over both languages at once plus
   * the Sanskrit and the muscle names, because a user looking for "psoas" or for
   * "trikonasana" should not have to know which field it lives in. */
  /* Each facet holds a *set*, not a value. Within one facet the values are alternatives —
   * mat OR reformer — and across facets they narrow together, which is what anyone expects
   * of a filter row and what the single-value version could not do: choosing "mat" threw
   * away "yoga". Every row is labelled for the same reason; four unlabelled rows of chips
   * ask the reader to work out what each one is filtering by. */
  const FACETS = [
    ['discipline', 'filterDisc',   e => e.discipline],
    ['apparatus',  'filterApp',    e => e.apparatus],
    ['family',     'filterFamily', e => e.family],
    ['level',      'filterLevel',  e => e.difficulty],
    ['prop',       'filterProps',  e => (e.props?.length ? e.props : null)],
  ];
  const lib = { q: '', discipline: new Set(), apparatus: new Set(), family: new Set(),
                prop: new Set(), level: new Set() };
  const libActive = () => FACETS.some(([f]) => lib[f].size) || !!lib.q.trim();

  /** Everything a search term could reasonably match, lowercased, per exercise. */
  const HAYSTACK = new Map();
  function haystack(k) {
    let h = HAYSTACK.get(k);
    if (h) return h;
    const e = EXERCISE[k];
    const parts = [k, e.en?.name, e.ko?.name, e.sanskrit,
                   DISCIPLINES[e.discipline]?.en, DISCIPLINES[e.discipline]?.ko,
                   e.family && FAMILY[e.family]?.en, e.family && FAMILY[e.family]?.ko,
                   e.apparatus && APPARATUS[e.apparatus]?.en];
    for (const role of ['prime', 'synergists', 'stabilisers'])
      for (const [name] of e.muscles?.[role] ?? []) parts.push(name);
    h = parts.filter(Boolean).join(' ').toLowerCase();
    HAYSTACK.set(k, h);
    return h;
  }

  /** Does an exercise satisfy one facet? An empty facet asks nothing. */
  function facetOk(field, valueOf, e, skip) {
    const want = lib[field];
    if (field === skip || !want.size) return true;
    const v = valueOf(e);
    if (v == null) return false;
    for (const one of Array.isArray(v) ? v : [v]) if (want.has(one)) return true;
    return false;
  }

  function libraryMatches(skip = null) {
    const q = lib.q.trim().toLowerCase();
    return EXERCISE_KEYS.filter(k => {
      const e = EXERCISE[k];
      for (const [field, , valueOf] of FACETS) if (!facetOk(field, valueOf, e, skip)) return false;
      return !q || haystack(k).includes(q);
    });
  }

  /** Facet values that are still reachable given the other filters — a dead end is worse
    * than a missing option, so a chip that would return nothing is not offered. */
  function reachable(field, valueOf) {
    // counted with this facet's own choices lifted, so its chips still offer the
    // alternatives to what is already picked rather than only what is picked
    const seen = new Map();
    for (const k of libraryMatches(field)) {
      const v = valueOf(EXERCISE[k]);
      if (v == null) continue;
      for (const one of Array.isArray(v) ? v : [v]) seen.set(one, (seen.get(one) ?? 0) + 1);
    }
    return seen;
  }

  function chipRow(field, counts, label, heading) {
    if (counts.size < 2 && !lib[field].size) return '';
    const order = [...counts.entries()].sort((a, b) =>
      (typeof a[0] === 'number' && typeof b[0] === 'number') ? a[0] - b[0] : b[1] - a[1]);
    const chips = order.map(([v, n]) =>
      `<button class="fchip" data-facet="${field}" data-value="${esc(v)}"
        aria-pressed="${lib[field].has(v)}">${esc(label(v))}<em>${n}</em></button>`).join('');
    return `<div class="facetgrp"><h4>${esc(T(heading))}</h4><div class="facet">${chips}</div></div>`;
  }

  function libraryList() {
    const matches = libraryMatches();
    const LABEL = {
      discipline: v => DISCIPLINES[v]?.[app.lang] ?? v,
      apparatus:  v => APPARATUS[v]?.[app.lang] ?? v,
      family:     v => FAMILY[v]?.[app.lang] ?? v,
      level:      v => `${T('difficulty')} ${v}`,
      prop:       v => PROP[v]?.[app.lang] ?? v,
    };
    const rowsHtml = FACETS.map(([field, heading, valueOf]) =>
      chipRow(field, reachable(field, valueOf), LABEL[field], heading)).join('');
    const active = libActive();

    const rows = matches.map(k => {
      const e = EXERCISE[k];
      const bits = [DISCIPLINES[e.discipline]?.[app.lang],
                    e.family && FAMILY[e.family]?.[app.lang],
                    e.apparatus && APPARATUS[e.apparatus]?.[app.lang]].filter(Boolean);
      return `<button class="exrow" data-ex="${k}">
        <span class="exname">${esc(e[app.lang].name)}${
          e.sanskrit ? `<i class="sans">${esc(e.sanskrit)}</i>` : ''}
          <small>${esc(bits.join(' · '))} · ${T('difficulty')} ${e.difficulty}/5</small></span>
        <span class="exgo">→</span></button>`;
    }).join('');

    return `<div class="callout">${esc(DISCLAIMERS[1][app.lang].body)}</div>
      <div class="libbar">
        <input id="libQ" type="search" value="${esc(lib.q)}"
               placeholder="${T('searchHint')}" aria-label="${T('searchEx')}">
        <span class="libcount">${T('showingN')} ${matches.length} ${T('ofN')} ${EXERCISE_KEYS.length}</span>
      </div>
      ${rowsHtml}
      ${active ? `<button class="act ghost small" id="libClear">${T('clearFilters')}</button>` : ''}
      ${matches.length ? rows : `<p class="note">${T('noMatches')}</p>`}`;
  }

  /* ------------------------------------------------------------- exercise tab */
  function exerciseTab() {
    if (!app.exercise) return libraryList();
    const k = app.exercise, e = EXERCISE[k], t = e[app.lang];
    const clip = MOTION[k];
    const roleBlock = (role, key) => `
      <div class="roleblk">
        <h4>${T(key)}</h4>
        <div class="chipwrap">${e.muscles[role].map(([name, ev]) => {
          const s = registry().byName.get(name);
          if (!s) return '';
          const marker = ROLE_EVIDENCE[ev];
          return `<button class="chip ev-${ev}" data-id="${s.id}" title="${esc(marker[app.lang])}">
            <i style="background:${s.color}"></i>${esc(s.name[app.lang])}
            <em style="color:${marker.color}">${ev === 'emg' ? 'EMG' : '~'}</em></button>`;
        }).join('')}</div>
      </div>`;
    return `
      <button class="back" id="exBack">← ${T('tabExercise')}</button>
      <div class="detail">
        ${e.sanskrit ? `<div class="dko">${esc(e.sanskrit)}</div>` : ''}
        <div class="dname">${esc(t.name)}</div>
        <div class="dwhere">${esc(DISCIPLINES[e.discipline][app.lang])}${
          e.family && FAMILY[e.family] ? ' · ' + esc(FAMILY[e.family][app.lang]) : ''}${
          e.apparatus ? ' · ' + esc(APPARATUS[e.apparatus][app.lang]) : ''} · ${T('difficulty')} ${e.difficulty}/5</div>
        ${(e.props ?? []).length ? `<div class="dwhere">${T('filterProps')}: ${
          e.props.map(pr => esc(PROP[pr]?.[app.lang] ?? pr)).join(', ')}</div>` : ''}
        ${e.reviewed
          ? `<div class="callout ok"><b>${T('reviewedBy')}</b> ${esc(e.reviewed.by)}${
              e.reviewed.credential ? ', ' + esc(e.reviewed.credential) : ''}${
              e.reviewed.date ? ' · ' + esc(e.reviewed.date) : ''}</div>`
          : `<div class="callout warn"><b>${T('notReviewed')}</b> ${T('notReviewedBody')}</div>`}
        <p class="lead">${esc(t.summary)}</p>

        ${timelineBlock(k, clip)}
        ${roleBlock('prime', 'primeMovers')}
        ${roleBlock('synergists', 'synergistsEx')}
        ${roleBlock('stabilisers', 'stabilisers')}
        <div class="blk math"><h4>${T('activation')}</h4><p>${T('activationNote')}</p>
          <p class="note">${esc(L(e.emgNote))}</p></div>
        ${e.composed ? `<div class="blk warn small"><h4>${T('composedNote')}</h4>
          <p>${T('composedBody')}</p></div>` : ''}

        ${app.instructionOn ? `
          <div class="blk"><h4>${T('setup')}</h4><p>${esc(t.setup)}</p></div>
          <div class="blk"><h4>${T('breath')}</h4><p>${esc(t.breath)}</p></div>
          <div class="blk"><h4>${T('tempo')}</h4><p>${esc(t.tempo)}</p></div>
          <div class="blk"><h4>${T('focusCue')}</h4><p>${esc(t.focusCue)}</p></div>
          <div class="blk"><h4>${T('faults')}</h4>
            ${t.faults.map(([f, fix]) => `<div class="fault"><b>${esc(f)}</b><p>${esc(fix)}</p></div>`).join('')}</div>
          <div class="blk danger"><h4>${T('contra')}</h4><p>${esc(t.contraindications)}</p></div>
          <div class="blk grid2">
            <div><h4>${T('progressions')}</h4><ul>${t.progressions.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
            <div><h4>${T('regressions')}</h4><ul>${t.regressions.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
          </div>`
        : `<div class="callout">${T('instructionOff')}</div>`}

        <h4 class="sechead">${T('tabEvidence')}</h4>
        ${e.brain.map(claimCard).join('')}
        <button class="act ghost" id="reportBtn">${T('report')}</button>
      </div>`;
  }

  /* ------------------------------------------------------------- the timeline
   * §9 of the brief: a clip, a tempo, breath-phase markers, and a scrubber that matters
   * more than playback. The provenance note is not optional decoration — the skeleton and
   * the joint axes are published biomechanics, the pose over time is authored, and those
   * two facts have to arrive together. */
  function timelineBlock(key, clip) {
    /* A body with no rig of its own cannot be posed by any clip, and saying "no clip for this
     * exercise" would blame the exercise for the body's gap. */
    if (body.motion === false)
      return `<div class="callout warn">${esc(body.noMotion?.[app.lang] ?? T('noMotion'))}</div>`;
    if (!clip) return `<div class="callout warn">${T('noMotion')}</div>`;
    const partial = body.motionNote
      ? `<div class="callout">${esc(body.motionNote[app.lang])}</div>` : '';
    const ph = phaseAt(key, app.t);
    const marks = clip.phases.map(p => {
      const b = BREATH[p.breath];
      return `<span class="pmark" style="left:${(p.at * 100).toFixed(1)}%;background:${b.color}"
                title="${esc(p[app.lang])}"></span>`;
    }).join('');
    const secs = (clip.duration / 1000).toFixed(1);
    return `${partial}<div class="timeline">
      <div class="tlhead">
        <button id="playBtn" class="tlplay">${app.playing ? '❚❚' : '▶'}</button>
        <span class="tlnow">${ph ? `<i style="background:${BREATH[ph.breath].color}"></i>
          ${esc(BREATH[ph.breath][app.lang])} · ${esc(ph[app.lang])}` : ''}</span>
        <span class="tlsecs">${(app.t * clip.duration / 1000).toFixed(1)} / ${secs}s</span>
      </div>
      <div class="tltrack">${marks}
        <input id="scrub" type="range" min="0" max="1000" value="${Math.round(app.t * 1000)}"
               aria-label="${T('scrub')}">
      </div>
      <h4 class="acthead">${T('chartHead')}</h4>
      <div class="actplot" id="actPlot"></div>
      <div class="actread" id="actRead"></div>
      <p class="note">${T('chartNote')}</p>
      <div class="seg tlopts">
        <button id="pathToggle" class="tgl" aria-pressed="${app.showPaths}">${T('musclePaths')}</button>
        <button id="meshToggle" class="tgl" aria-pressed="${app.showMeshes}">${T('meshes')}</button>
      </div>
      ${app.showPaths ? rampLegend() : ''}
      ${app.showMeshes ? `<div class="blk danger small"><h4>${T('meshWarn')}</h4>
        <p>${T('meshWarnBody')}</p></div>` : ''}
      <div class="blk warn small"><h4>${T('handkeyed')}</h4><p>${T('handkeyedBody')}</p></div>
      ${clip.limitation ? `<div class="blk danger small"><h4>${T('rigLimit')}</h4>
        <p>${esc(L(clip.limitation))}</p></div>` : ''}
    </div>`;
  }

  /** The activation ramp, always with its numbers. An unlabelled heat glow reads as data
    * while meaning nothing, which is precisely what this app must not do. */
  function rampLegend() {
    const stops = RAMP_STOPS.map(([t, c]) => `${c} ${(t * 100).toFixed(0)}%`).join(', ');
    return `<div class="ramp">
      <div class="rampbar" style="background:linear-gradient(90deg, ${stops})"></div>
      <div class="ramplabels"><span>0</span><span>0.5</span><span>1.0</span></div>
      <p class="note">${T('activationNote')}</p></div>`;
  }

  /* ------------------------------------------------------------- evidence tab */
  function evidenceTab() {
    return `<div class="callout">${esc(DISCLAIMERS[3][app.lang].body)}</div>
      ${Object.keys(EXERCISE_BRAIN).map(claimCard).join('')}`;
  }

  function claimCard(key) {
    const c = EXERCISE_BRAIN[key];
    if (!c) return '';
    const t = c[app.lang], tier = TIERS[c.tier];
    return `<div class="claim" style="border-left-color:${tier.color}">
      <div class="ctier"><span class="tierbadge" style="background:${tier.color}">${c.tier}</span>
        <span>${esc(tier[app.lang])}</span>
        <span class="pill">${c.species === 'human' ? T('human') : T('animal')}</span>
        <span class="pill">${c.timescale === 'acute' ? T('acute') : T('chronic')}</span></div>
      <p class="cclaim">${esc(t.claim)}</p>
      <div class="blk"><h4>${T('mechanism')}</h4><p>${esc(t.mechanism)}</p></div>
      ${c.effect ? `<div class="blk"><h4>${T('effect')}</h4><p>${esc(L(c.effect))}</p></div>` : ''}
      <div class="blk"><h4>${T('population')}</h4><p>${esc(L(c.population))}</p></div>
      <div class="blk warn"><h4>${T('caveat')}</h4><p>${esc(L(c.caveat))}</p></div>
      <div class="cite"><b>${T('source')}</b> ${esc(c.citation)}</div>
      ${c.structures.length ? `<div class="chipwrap">${c.structures.map(id => {
        const r = get(id);
        return r ? `<button class="mini" data-id="${id}">${esc(r.name[app.lang])}</button>` : '';
      }).join('')}</div>` : ''}
    </div>`;
  }

  /* ---------------------------------------------------------------- about tab */
  /**
   * About: the four lines that must not move, and a door to the reading.
   *
   * It used to carry the whole glossary and the whole provenance list, which made it the
   * longest thing in a three-hundred-pixel column — "nobody wants to scroll a long time and
   * read the long texts" was exactly right about it. The disclaimers stay, because they are
   * the point of this tab and they are four of the sentences this project exists to keep on
   * screen. Everything else moved to the Lab's reference page, which has a page's width.
   */
  function aboutTab() {
    const meta = registry().meta;
    return `
      <div id="demoslot"></div>
      ${/* filled by session/boot.js, which creates the chip before this panel has
            ever been rendered — so it is adopted here rather than waiting for a
            slot that did not exist yet. */ ''}
      ${DISCLAIMERS.map((d, i) => { const x = disc(i, app.lang); return `<div class="claim">
        <p class="cclaim">${esc(x.title)}</p>
        <p>${esc(x.body)}</p></div>`; }).join('')}
      <div class="blk math">
        <h4>${T('sources')}</h4>
        <p class="note">${esc(meta.attribution)}</p>
        <p class="note">${esc(meta.source)} · ${esc(meta.licence)}</p>
        <p class="note">${esc(body.subject[app.lang])}</p>
      </div>
      <p class="intro">${T('aboutShort')}</p>
      <button class="act" id="aboutMore">${T('aboutMore')} →</button>`;
  }

  /* ------------------------------------------------------------- the plot
   * One chart, kept across panel renders, because the panel is rebuilt from innerHTML and
   * a fresh one would re-sample the clip on every keystroke in the library search. */
  let chart = null;
  let chartAt = null;              // normalised time under the pointer, or null

  function drawChart() {
    if (!chart || !chart.canvas.isConnected) return;
    // false means the plot is already showing this frame, so the readout is too
    if (!chart.draw(app.t, chartAt, app.lang)) return;
    const read = $('actRead');
    if (!read) return;
    /* The readout follows the pointer when there is one and the playhead when there is not,
     * so the numbers beside the plot are always the numbers at the upright line a reader is
     * looking at. Names come from the registry, so they are the same names as the chips. */
    const rows = chart.readAt(chartAt ?? app.t);
    read.innerHTML = rows.map(r => {
      const st = registry().byName.get(r.name);
      return `<span class="ard"><i style="background:${r.colour}"></i>${
        esc(st ? st.name[app.lang] : r.name)}<em>${r.value.toFixed(2)}</em></span>`;
    }).join('');
  }

  function wireChart() {
    const host = $('actPlot');
    if (!host) return;
    chart ??= new ActChart();
    chart.attach(host, drawChart);
    chart.load(app.exercise);
    chartAt = null;
    chart.canvas.onpointermove = e => { chartAt = chart.uAt(e.offsetX); drawChart(); };
    chart.canvas.onpointerleave = () => { chartAt = null; drawChart(); };
    /* Clicking the plot scrubs to that point. The x axis *is* the clip, so a place on it is
     * a time in the movement, and the surprising thing would be for it not to go there. */
    chart.canvas.onclick = e => {
      const u = chart.uAt(e.offsetX);
      if (u == null) return;
      setPlaying(false); poseFromClip(u); syncTimeline();
    };
    drawChart();
  }

  /* ----------------------------------------------------------------- wiring */
  function wirePanel() {
    for (const b of $('panelBody').querySelectorAll('[data-id]'))
      b.onclick = () => selectStructure(+b.dataset.id);
    for (const b of $('panelBody').querySelectorAll('[data-ex]'))
      b.onclick = () => { setExercise(b.dataset.ex); renderPanel(); };
    const aq = $('anatQ');
    if (aq) {
      /* Same caret dance as the library search below, and for the same reason:
       * the panel is rebuilt from scratch on every keystroke, so without this
       * the cursor jumps to the end after the first letter. */
      aq.oninput = () => {
        find.q = aq.value; const at = aq.selectionStart; renderPanel();
        const n = $('anatQ'); if (n) { n.focus(); n.setSelectionRange(at, at); }
      };
    }
    for (const b of $('panelBody').querySelectorAll('[data-group]'))
      b.onclick = async () => {
        // pressing the group that is already showing turns it off, so a chip is
        // a toggle rather than a one-way door
        await setGroup(app.group === b.dataset.group ? null : b.dataset.group);
        renderPanel(); syncControls();
      };
    for (const b of $('panelBody').querySelectorAll('[data-isolate]'))
      b.onclick = async () => {
        const ids = b.dataset.isolate.split(' ').map(Number);
        const now = isolated?.() ?? [];
        const same = ids.length === now.length && ids.every(id => now.includes(id));
        await setIsolate(same ? null : ids);
        renderPanel(); syncControls();
      };
    for (const b of $('panelBody').querySelectorAll('[data-flyto]'))
      b.onclick = () => selectStructure(+b.dataset.flyto);
    const bon = $('panelBody').querySelector('[data-brainon]');
    if (bon) bon.onclick = async () => { await setLayer('brain', true); renderPanel(); syncControls(); };
    const gclear = $('groupClear');
    if (gclear) gclear.onclick = async () => { await setGroup(null); renderPanel(); syncControls(); };
    const q = $('libQ');
    if (q) {
      // re-render on input, then put the caret back — the panel is rebuilt from scratch
      q.oninput = () => { lib.q = q.value; const at = q.selectionStart; renderPanel();
                          const n = $('libQ'); if (n) { n.focus(); n.setSelectionRange(at, at); } };
    }
    for (const b of $('panelBody').querySelectorAll('[data-facet]'))
      b.onclick = () => {
        const f = b.dataset.facet;
        const v = f === 'level' ? +b.dataset.value : b.dataset.value;
        lib[f].has(v) ? lib[f].delete(v) : lib[f].add(v);
        renderPanel();
      };
    const clear = $('libClear');
    if (clear) clear.onclick = () => {
      lib.q = ''; for (const [f] of FACETS) lib[f].clear(); renderPanel();
    };
    for (const b of $('panelBody').querySelectorAll('[data-kind]'))
      b.onclick = async () => {
        const k = b.dataset.kind;
        if (!k) clearLabelKinds();
        else await setLabelKind(k, !app.labelKinds.has(k));
        renderPanel(); syncControls();
      };
    const inside = $('insideBtn');
    if (inside) inside.onclick = () => {
      setXray(app.xray > 0.5 ? 0 : 1); renderPanel(); syncControls();
    };
    const back = $('exBack');
    if (back) back.onclick = () => { setExercise(null); renderPanel(); };
    const travel = $('travelBtn');
    if (travel) travel.onclick = () => { setPathway('descending'); syncControls(); };
    const pb = $('playBtn');
    if (pb) pb.onclick = () => { setPlaying(!app.playing); syncTimeline(); };
    const sc = $('scrub');
    if (sc) sc.oninput = e => { setPlaying(false); poseFromClip(+e.target.value / 1000); };
    const pt = $('pathToggle');
    if (pt) pt.onclick = () => { setShowPaths(!app.showPaths); renderPanel(); };
    const mt = $('meshToggle');
    if (mt) mt.onclick = () => { setShowMeshes(!app.showMeshes); syncControls(); };
    wireChart();
    wireConn();
    /* The "why" buttons inside the panel body. The ones in the controls block are wired in
     * `syncControls`; these live in markup that is rebuilt on every render, so they are wired
     * here, where everything else in the body is. */
    for (const b of $('panelBody').querySelectorAll('[data-help]'))
      b.onclick = () => {
        const k = b.dataset.help;
        openHelp.has(k) ? openHelp.delete(k) : openHelp.add(k);
        renderPanel();
      };
    const more = $('aboutMore');
    if (more) more.onclick = () => setLab(true, 'reference');
    const rb = $('reportBtn');
    if (rb) rb.onclick = () => {
      const image = ctx.captureStage ? ctx.captureStage(2) : null;
      const ok = openReport({ exercise: app.exercise, lang: app.lang, image,
                              register: app.register, instructionOn: app.instructionOn });
      if (!ok) alert(T('reportBlocked'));
    };
  }

  function renderPathPanel() {
    const key = app.pathway;
    $('pathPanel').classList.toggle('on', !!key);
    if (!key) { $('pathPanel').innerHTML = ''; return; }
    const p = MOVEMENT_PATHWAY[key];
    $('pathPanel').innerHTML = `
      <h4>${esc(p[app.lang].name)}</h4>
      <p class="intro">${esc(p[app.lang].intro)}</p>
      <div class="schem">${T('pathSchematic')}</div>
      ${p.steps.map((s, i) => `<div class="pstep">
        <span class="num" style="border-color:${p.color}">${i + 1}</span>
        <span><span class="pt">${esc(s[app.lang].title)}</span>
        <div class="pn">${esc(s[app.lang].text)}</div></span></div>`).join('')}
      <button class="act ghost small" id="pathOff">${T('close')}</button>`;
    $('pathOff').onclick = () => { setPathway(null); };
  }

  /* Static chrome that lives outside the panel body. */
  for (const [id, k] of [['vAnt', 'anterior'], ['vPost', 'posterior'], ['vLat', 'lateral'],
                         ['vSup', 'superior'], ['vHead', 'head'], ['vAll', 'wholeBody']])
    $(id).onclick = () => setView(k);
  $('labBtn').onclick = () => setLab(!app.labOpen);
  $('reset').onclick = resetView;
  $('atlas').oninput = e => setAtlas(+e.target.value);
  $('explode').oninput = e => { setExplode(+e.target.value); syncControls(); };
  /* Fold any panel away and remember it.
   *
   * Kept in localStorage per panel, because which ones somebody wants open is a
   * property of their screen rather than of the session: a coach on a laptop
   * folds the console to see the body and expects it folded next time, not every
   * time they select something. */
  const FOLD_KEY = 'nw.folded';
  const foldState = () => {
    try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { return {}; }
  };
  function applyFold(el, btn, on) {
    el.classList.toggle('folded', on);
    btn.textContent = on ? '+' : '−';
    btn.title = T(on ? 'unfoldPanel' : 'foldPanel');
    btn.setAttribute('aria-expanded', String(!on));
  }
  for (const btn of document.querySelectorAll('[data-fold]')) {
    const key = btn.dataset.fold;
    const el = $(key);
    if (!el) continue;
    el.dataset.foldname = T(key === 'layerbar' ? 'layers'
                          : key === 'viewbar' ? 'views'
                          : key === 'sections' ? 'sections' : 'panelWord');
    applyFold(el, btn, !!foldState()[key]);
    btn.onclick = () => {
      const now = !el.classList.contains('folded');
      applyFold(el, btn, now);
      const st = foldState();
      st[key] = now;
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(st)); } catch { /* private window */ }
      /* The stage is sized from the window minus the console, so folding the
       * console changes how much canvas there is. Without this the picture stays
       * the old width with a strip of background beside it. */
      window.dispatchEvent(new Event('resize'));
    };
  }

  $('exInventory').onclick = () => { setExplodeLayout('inventory'); syncControls(); };
  $('exOpen').onclick = () => { setExplodeLayout('open'); syncControls(); };
  $('xray').oninput  = e => setXray(+e.target.value);
  $('clip').oninput  = e => setClip(+e.target.value);
  /* The scan. `Off` is a plane like the others rather than a separate toggle, because the
   * four are one choice and a toggle beside three radio buttons reads as a fourth mode. */
  for (const [id, k] of [['scanOff', null], ['scanSag', 'sagittal'],
                         ['scanCor', 'coronal'], ['scanAx', 'axial']])
    $(id).onclick = () => { setScan(k, app.scan.at); syncControls(); };
  for (const [id, k] of [['lookTissue', 'tissue'], ['lookAnat', 'anatomical'],
                         ['lookNeurons', 'neurons']])
    $(id).onclick = () => { setBrainLook(k); syncControls(); };
  $('scanSweep').onclick = () => { setSweep(!app.scan.sweeping); syncControls(); };
  $('scanAt').oninput = e => { setSweep(false); setScanAt(+e.target.value); syncControls(); };
  $('mCut').onclick  = () => { setCutaway(!app.cutaway); syncControls(); };
  $('mRot').onclick  = () => { setRotate(!app.rotate); syncControls(); };
  $('labToggle').onclick = () => {
    const on = $('labToggle').getAttribute('aria-pressed') !== 'true';
    $('labToggle').setAttribute('aria-pressed', on); setLabels(on);
  };
  $('instrToggle').onclick = () => {
    const on = $('instrToggle').getAttribute('aria-pressed') !== 'true';
    setInstruction(on); syncControls();
  };
  for (const [id, r] of [['regPlain', 'plain'], ['regClinical', 'clinical'], ['regBoth', 'both']])
    $(id).onclick = () => {
      setRegister(r); syncControls();
      // the lab's captions are chosen by the register too, and they are written not templated
      if (app.labOpen) { lab.relabel(); lab.draw(); }
      renderPanel();
    };
  for (const [id, k] of [['pDesc', 'descending'], ['pAsc', 'ascending'], ['pInt', 'interoceptive']])
    $(id).onclick = () => setPathway(app.pathway === k ? null : k);
  $('langBtn').onclick = () => setLang(app.lang === 'en' ? 'ko' : 'en');
  $('tabExplore').onclick  = () => openPop('explore');
  $('tabExercise').onclick = () => openPop('exercise');
  $('tabEvidence').onclick = () => openPop('evidence');
  $('tabAbout').onclick    = () => openPop('about');
  for (const b of document.querySelectorAll('#rail [data-pop]'))
    b.onclick = () => openPop(b.dataset.pop);
  $('popclose').onclick = closePop;
  $('zoomIn').onclick = () => zoomBy?.(1 / 1.25);
  $('zoomOut').onclick = () => zoomBy?.(1.25);
  $('fitBtn').onclick = () => fitView?.();

  addEventListener('keydown', e => {
    if (e.key === 'Escape' && app.labOpen) { setLab(false); return; }
    if (e.key === 'Escape') {
      if ($('overlay').classList.contains('on')) {
        $('overlay').classList.remove('on'); $('overlay').innerHTML = '';
      } else if (tab) closePop();
      else selectStructure(null);
      return;
    }
    /* One key for the one thing a reader of a thousand-structure atlas does most.
     * Guarded on the focus being nowhere in particular, so typing a slash into the
     * search box itself, or into a note, still types a slash. */
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
                   || document.activeElement?.isContentEditable;
    if ((e.key === '/' || (e.key === 'f' && (e.metaKey || e.ctrlKey))) && !typing) {
      e.preventDefault();
      if (tab !== 'explore') openPop('explore');
      $('anatQ')?.focus();
      $('anatQ')?.select();
    }
  });

  /* The Explore tab grows a section when the brain arrives — the region network has nothing to
   * draw without it. `syncControls` runs on every layer change but does not re-render the
   * panel, so without this the section's host element is never created and the graph is
   * silently absent. Guarded on the state actually changing: re-rendering on every call would
   * take the caret out of the search box on every frame of a scan. */
  let lastBrainOn = null;
  function syncControls() {
    if (app.layers.brain?.on !== lastBrainOn) {
      const first = lastBrainOn === null;
      lastBrainOn = app.layers.brain?.on;
      if (!first && tab === 'explore') { renderPanel(); }
    }
    $('mCut').setAttribute('aria-pressed', !!app.cutaway);
    $('mRot').setAttribute('aria-pressed', !!app.rotate);
    $('clipRow').style.display = app.cutaway ? '' : 'none';
    /* A section through a brain that is not on the screen is not a control, it is a puzzle.
     * The row appears with the layer. */
    const canScan = !!app.layers.brain?.on;
    $('scanRow').style.display = canScan ? '' : 'none';
    $('scanOffRow').style.display = canScan ? '' : 'none';
    $('scanAtRow').style.display = canScan && app.scan.plane ? '' : 'none';
    $('lookRow').style.display = canScan ? '' : 'none';
    for (const [id, k] of [['lookTissue', 'tissue'], ['lookAnat', 'anatomical'],
                           ['lookNeurons', 'neurons']])
      $(id).setAttribute('aria-pressed', app.brainLook === k);
    /* The explanation sits under the control rather than behind a question mark. A control
     * whose meaning has to be hunted for is a control the reader will not use — "I have no
     * idea what axial and sweep do" was the report, and a tooltip would not have answered it.
     * Which plane is chosen decides which sentence: the general one when nothing is on, and
     * that plane's own when one is. */
    const LOOK_HELP = { tissue: 'lookTissue', anatomical: 'lookAnatomical',
                        neurons: 'lookNeurons' };
    const lookHelp = $('lookHelp');
    lookHelp.hidden = !canScan;
    if (canScan) lookHelp.innerHTML =
      inlineHelp('brainLook', LOOK_HELP[app.brainLook] ?? 'lookTissue');
    const scanHelp = $('scanHelp');
    scanHelp.hidden = !canScan;
    if (canScan) scanHelp.innerHTML = app.scan.plane
      ? inlineHelp(app.scan.plane, app.scan.sweeping ? 'sweep' : null)
      : inlineHelp('scanPlane');
    for (const b of $('controls').querySelectorAll('[data-help]'))
      b.onclick = () => {
        const k = b.dataset.help;
        openHelp.has(k) ? openHelp.delete(k) : openHelp.add(k);
        syncControls();
      };
    $('scanOff').setAttribute('aria-pressed', !app.scan.plane);
    for (const [id, k] of [['scanSag', 'sagittal'], ['scanCor', 'coronal'], ['scanAx', 'axial']])
      $(id).setAttribute('aria-pressed', app.scan.plane === k);
    $('scanSweep').setAttribute('aria-pressed', !!app.scan.sweeping);
    const at = $('scanAt');
    if (at && document.activeElement !== at) at.value = app.scan.at.toFixed(3);
    $('instrToggle').setAttribute('aria-pressed', !!app.instructionOn);
    for (const [id, r] of [['regPlain', 'plain'], ['regClinical', 'clinical'], ['regBoth', 'both']])
      $(id).setAttribute('aria-pressed', app.register === r);
    for (const [id, k] of [['pDesc', 'descending'], ['pAsc', 'ascending'], ['pInt', 'interoceptive']])
      $(id).setAttribute('aria-pressed', app.pathway === k);
    // the layer list is a panel section now, so it is only in the DOM while open
    for (const b of $('layerList')?.querySelectorAll('.lyr') ?? [])
      b.setAttribute('aria-pressed', app.layers[b.dataset.layer].on);
    renderPathPanel();
  }

  let tlRaf = 0;
  function syncTimeline() {
    // called from the render loop while playing, so it touches the two elements that change
    // rather than re-rendering the panel — a full re-render per frame would be absurd
    const sc = $('scrub');
    if (!sc) return;
    if (document.activeElement !== sc) sc.value = Math.round(app.t * 1000);
    const pb = $('playBtn');
    if (pb) pb.textContent = app.playing ? '❚❚' : '▶';
    const clip = MOTION[app.exercise];
    if (!clip) return;
    const now = $('panelBody').querySelector('.tlnow');
    const ph = phaseAt(app.exercise, app.t);
    if (now && ph) now.innerHTML = `<i style="background:${BREATH[ph.breath].color}"></i> ` +
      `${esc(BREATH[ph.breath][app.lang])} · ${esc(ph[app.lang])}`;
    const secs = $('panelBody').querySelector('.tlsecs');
    if (secs) secs.textContent =
      `${(app.t * clip.duration / 1000).toFixed(1)} / ${(clip.duration / 1000).toFixed(1)}s`;
    drawChart();
    if (app.labOpen) lab.draw();
  }

  return {
    syncTimeline,
    showStructure(id) {
      if (!ready) return;
      /* The lab is a screen over the app, and four of its panels are about the selection: the
       * cuts mark where the chosen structure is, the region map ringed it, the roster follows
       * it. Only the lab's own region map redrew it, so a structure chosen anywhere else —
       * the picture, the panel, the section legend, an exercise's own list — left every one of
       * those panels showing the structure before it, or the "choose a structure" placeholder
       * for ever. That is what "if I click on any region it just shows nothing" was. */
      if (app.labOpen) lab.draw();
      /* Choosing a structure opens the card about it and nothing else. It used to
       * open the whole Explore tab, so what a reader got for a click was the
       * structure's name at the top of a column holding seventy-seven group chips,
       * a region plot, a label filter and four hundred swatches -- and the one
       * control they wanted, Isolate, below the fold. */
      if (tab === 'exercise' && app.exercise) { renderPanel(); return; }
      if (id == null) { if (tab === 'structure') tab = null; renderPanel(); return; }
      tab = 'structure';
      renderPanel();
    },
    /* The graph is drawn, not templated, so a selection or a change in what the network is
     * doing has to reach it. Called from the render loop beside the timeline sync. */
    syncConn: drawConn,
    /** The lab's 3D panel animates, so it needs the clock the rest of the scene runs on. */
    tickLab: t => { if (app.labOpen) lab.tick(t); },
    relabel() {
      if (!ready) return;
      renderChrome(); renderPanel(); syncControls();
      if (app.labOpen) { lab.relabel(); lab.draw(); }
    },
    syncControls,
    setBusy(on) { document.body.classList.toggle('busy', !!on); },
    ready() {
      ready = true;
      document.body.classList.add('ready');
      renderChrome(); renderPanel(); syncControls();
    },
  };
}
