import { REGION_INFO } from './regionData.js';
import { UI } from './content/strings.js';
import { EXERCISE_BRAIN } from './content/evidence.js';

/**
 * The annotation on a cell.
 *
 * A tooltip appears beside the pointer and describes whatever is under it. This is not that:
 * it is anchored to the cell, joined to it by a leader, and it says what that cell *is* — the
 * parcel it belongs to, what that parcel does, and how strong the evidence for the claims
 * attached to it is. Hovering a neuron in an instrument should feel like putting a probe on
 * it, and a probe has a wire.
 *
 * **What a cell can honestly say.** There are no per-neuron measurements here and there never
 * will be: a soma in this scene stands for a population far below the resolution of any model
 * in this repository. So the note reports three things that are true — which Desikan-Killiany
 * parcel the cell sits in, which comes from the vertex it was sampled from; what that parcel
 * does, from `REGION_INFO`; and the best evidence tier among the claims attached to it, from
 * `EXERCISE_BRAIN`. The one number that is genuinely per-cell is its own firing phase, which
 * is what the shader is doing, and it is shown as a state rather than as a measurement.
 *
 * Inventing a performance score for a cell would be the single worst thing this file could do.
 * It would look exactly like the reference's readouts and it would be a fabrication presented
 * as an instrument reading, which is what the four disclaimers exist to prevent.
 */

/** Tier -> the colour the evidence chips already use, so one thing means one thing. */
const TIER_COLOUR = { A: '#3FBF97', B: '#5AA9E6', C: '#E9B45C', D: '#E9A13B', E: '#E2685F' };

export class CellNote {
  constructor(stage) {
    const el = document.createElement('div');
    el.id = 'cellnote';
    el.hidden = true;
    el.innerHTML = `
      <svg class="cnwire"><path fill="none" stroke-width="1"/></svg>
      <div class="cnbox">
        <div class="cnkick"><span class="cntier"></span><span class="cnid"></span></div>
        <div class="cnname"></div>
        <div class="cndoes"></div>
        <div class="cnstate"><span class="cnlab"></span><i class="cnbar"><b></b></i></div>
      </div>`;
    stage.appendChild(el);
    this.el = el;
    this.box = el.querySelector('.cnbox');
    this.wire = el.querySelector('.cnwire path');
    this.svg = el.querySelector('.cnwire');
    this.tier = el.querySelector('.cntier');
    this.idEl = el.querySelector('.cnid');
    this.name = el.querySelector('.cnname');
    this.does = el.querySelector('.cndoes');
    this.lab = el.querySelector('.cnlab');
    this.bar = el.querySelector('.cnbar b');
    this.shown = null;
  }

  hide() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.shown = null;
  }

  /**
   * @param at    the cell's position on screen, in stage pixels
   * @param node  { index, region } from `NeuralNet.pickNode`
   * @param fire  0..1, how hard this cell is firing right now
   */
  show(at, node, fire, lang) {
    const info = REGION_INFO[node.region];
    if (!info) return this.hide();
    const t = k => (UI[k]?.[lang] ?? '');

    if (this.shown !== node.index) {
      this.shown = node.index;
      /* `EXERCISE_BRAIN` is keyed by claim name and each entry lists the region ids it is
       * about in `structures` — so this is the set of published claims that touch the parcel
       * this cell sits in, and the tier is theirs, not the cell's. */
      const tiers = Object.values(EXERCISE_BRAIN)
        .filter(c => c.structures?.includes(node.region))
        .map(c => c.tier)
        .sort();
      const best = tiers[0] ?? null;
      this.tier.textContent = best ?? '';
      this.tier.style.display = best ? '' : 'none';
      this.tier.style.color = TIER_COLOUR[best] ?? 'var(--dim2)';
      this.tier.style.borderColor = TIER_COLOUR[best] ?? 'var(--line)';
      /* The cell's own index, which is the only identifier it has. It is shown because an
       * instrument that cannot tell you *which* one you are pointing at is a picture. */
      this.idEl.textContent = `CELL ${String(node.index).padStart(5, '0')}`;
      this.name.textContent = info[lang]?.name ?? info.en.name;
      this.does.textContent = info[lang]?.does ?? info.en.does ?? '';
      this.lab.textContent = t('cellFiring');
    }
    this.bar.style.width = `${Math.round(Math.min(1, fire) * 100)}%`;

    /* Place the plate clear of the cell and run a wire back to it. It flips to the other side
     * rather than being clamped at the edge: a note half off the stage is unreadable, and one
     * that has swapped sides still points at the right cell. */
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    const bw = this.box.offsetWidth || 210, bh = this.box.offsetHeight || 90;
    const flip = at.x > w - bw - 60;
    const bx = flip ? at.x - bw - 34 : at.x + 34;
    const by = Math.max(6, Math.min(h - bh - 6, at.y - bh / 2));
    this.box.style.left = `${Math.round(bx)}px`;
    this.box.style.top = `${Math.round(by)}px`;

    const ex = flip ? bx + bw : bx;
    const ey = by + bh / 2;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.wire.setAttribute('d',
      `M ${at.x.toFixed(1)} ${at.y.toFixed(1)} L ${((at.x + ex) / 2).toFixed(1)} ${at.y.toFixed(1)}`
      + ` L ${ex.toFixed(1)} ${ey.toFixed(1)}`);
    this.el.hidden = false;
  }
}
