/**
 * A tap, told apart from an orbit, a pinch, a pan and a cancelled touch.
 *
 * The picking here used to be one module-level `downAt`: remember where the
 * pointer went down, and on the way up, if it has not moved more than five
 * pixels, treat it as a click. On a mouse that is right. On a touchscreen it is
 * wrong in three separate ways, and a Pilates studio runs this on a tablet.
 *
 *   * **A second finger overwrites the first.** Pinching to zoom fires two
 *     `pointerdown`s; the second one replaces `downAt`, and whichever finger
 *     lifts nearest its own starting point selects whatever is under it. So
 *     zooming in on the lumbar spine selected a rib.
 *   * **Five pixels is a mouse threshold.** A finger resting on glass wanders
 *     further than that without anyone intending to move, so deliberate taps
 *     were being dropped as drags.
 *   * **A cancelled sequence still counted.** `pointercancel` — the browser
 *     taking the gesture over for a scroll or a system edge swipe — never
 *     cleared `downAt`, so the next `pointerup` was measured against a start
 *     point from a gesture that had already been taken away.
 *
 * This tracks every live pointer by id, so a gesture that ever had two pointers
 * in it is not a tap however it ends, movement is measured per pointer against
 * that pointer's own threshold, and a cancel poisons the whole sequence rather
 * than one finger of it.
 *
 * Ported from Human Atlas (https://github.com/ashemag/human-atlas), MIT
 * licensed, © 2026 ashemag. The algorithm is theirs; see ATTRIBUTION.md.
 */
export class PointerTap {
  #active = new Map();
  #blocked = false;

  /** @param {number} threshold  slop in CSS pixels before this stops being a tap */
  down(id, x, y, threshold) {
    if (this.#active.size === 0) this.#blocked = false;
    this.#active.set(id, { x, y, threshold });
    // two fingers is a pinch or a two-finger pan, and neither is ever a tap
    if (this.#active.size > 1) this.#blocked = true;
  }

  move(id, x, y) {
    const start = this.#active.get(id);
    if (start && Math.hypot(x - start.x, y - start.y) > start.threshold) this.#blocked = true;
  }

  /** @returns {boolean} whether this release completes a tap */
  up(id, x, y) {
    this.move(id, x, y);
    const tap = this.#active.has(id) && this.#active.size === 1 && !this.#blocked;
    this.#active.delete(id);
    return tap;
  }

  cancel(id) {
    this.#active.delete(id);
    this.#blocked = true;
  }

  /** For tests and for anything that wants to know a gesture is in progress. */
  get pointers() { return this.#active.size; }
}

/** Slop per input kind. A finger wanders; a mouse does not. */
export const TAP_SLOP = { touch: 12, pen: 8, mouse: 5 };
export const slopFor = type => TAP_SLOP[type] ?? TAP_SLOP.mouse;
