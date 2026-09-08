/**
 * The tap machine, and the gestures that used to select a muscle by accident.
 *
 * Every case here is one that the previous single-`downAt` version got wrong on
 * a touchscreen — see the header of `src/pointerTap.js`. They are cheap to
 * assert and impossible to notice by hand, because the symptom is not an error:
 * it is the wrong rib being selected halfway through a pinch.
 */
import assert from 'node:assert/strict';
import { PointerTap, slopFor, TAP_SLOP } from '../src/pointerTap.js';

const t = new PointerTap();

// a mouse click that does not move
t.down(1, 10, 10, 5);
assert.equal(t.up(1, 10, 10), true, 'a still click is a tap');

// a click that wobbles inside the slop
t.down(1, 10, 10, 5);
t.move(1, 13, 12);
assert.equal(t.up(1, 13, 12), true, 'a wobble inside the threshold is still a tap');

// an orbit
t.down(1, 10, 10, 5);
t.move(1, 60, 10);
assert.equal(t.up(1, 10, 10), false, 'a drag that returns to its start is not a tap');

// a pinch: two fingers, and neither release is a tap however still they were
t.down(1, 10, 10, 12);
t.down(2, 200, 200, 12);
assert.equal(t.up(2, 200, 200), false, 'the second finger of a pinch is not a tap');
assert.equal(t.up(1, 10, 10), false, 'nor is the first');

// and the gesture recovers afterwards
t.down(1, 10, 10, 12);
assert.equal(t.up(1, 11, 10), true, 'the next single tap works again');

// a cancelled sequence
t.down(1, 10, 10, 12);
t.cancel(1);
assert.equal(t.up(1, 10, 10), false, 'a cancelled pointer is not a tap');
t.down(1, 10, 10, 12);
assert.equal(t.up(1, 10, 10), true, 'and the one after it is');

// a release for a pointer that never went down
assert.equal(t.up(99, 0, 0), false, 'an unknown pointer is not a tap');

// movement is measured against the pointer's own threshold, not a shared one
t.down(1, 0, 0, 12);
t.move(1, 8, 0);
assert.equal(t.up(1, 8, 0), true, 'eight pixels is inside a finger threshold');
t.down(1, 0, 0, 5);
t.move(1, 8, 0);
assert.equal(t.up(1, 8, 0), false, 'and outside a mouse one');

// the live-pointer count, which is what stops hover picking mid-gesture
assert.equal(t.pointers, 0);
t.down(1, 0, 0, 5);
assert.equal(t.pointers, 1);
t.down(2, 5, 5, 5);
assert.equal(t.pointers, 2);
t.up(1, 0, 0); t.up(2, 5, 5);
assert.equal(t.pointers, 0);

assert.equal(slopFor('touch'), TAP_SLOP.touch);
assert.equal(slopFor('mouse'), TAP_SLOP.mouse);
assert.equal(slopFor(undefined), TAP_SLOP.mouse, 'an unknown pointer type falls back');
assert.ok(TAP_SLOP.touch > TAP_SLOP.mouse, 'a finger wanders further than a mouse');

console.log('pointer: tap, drag, pinch, cancellation and per-kind slop passed.');
