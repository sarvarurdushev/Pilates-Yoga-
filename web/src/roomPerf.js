/* Room-only performance mode for the anatomy viewer.
 *
 * The SEDENS room embeds this viewer at "/anatomy.html?room=1&embed=1". The professional
 * viewer never has room=1, so every function here returns exactly what main.js did before
 * this module existed when `room` is false (test/sedens-anatomy-performance.test.mjs pins
 * that). main.js computes the flag once, from location.search, at load.
 *
 *  - heartbeat: how long an idle viewer waits before it draws one frame anyway
 *    (500 ms for the professional viewer, 2000 ms in the room);
 *  - hold: no drawing while the page is hidden (room only). Only the page visibility
 *    is used: the room keeps the embedded viewer on screen at opacity 0 to warm it up,
 *    so an off-screen or display:none test would stop that warm-up;
 *  - pixel ratio: the room caps it at 1.25, and at 1 when the canvas is narrower than
 *    480 CSS pixels (the side panel).
 */
export const PROFESSIONAL_HEARTBEAT_MS = 500;
export const ROOM_HEARTBEAT_MS = 2000;
export const ROOM_PIXEL_CAP = 1.25;
export const ROOM_SMALL_PIXEL_CAP = 1;
export const SMALL_CANVAS_PX = 480;

/** Read once at load: { room, perf }. `perf` (a measurement counter) needs room=1 as well. */
export function roomMode(search) {
  let params;
  try { params = new URLSearchParams(search || ''); } catch { return { room: false, perf: false }; }
  const room = params.get('room') === '1';
  return { room, perf: room && params.get('perf') === '1' };
}

export const heartbeatMs = (room) => (room ? ROOM_HEARTBEAT_MS : PROFESSIONAL_HEARTBEAT_MS);

/** True when the loop must not draw this frame (it keeps its dirty frames for later). */
export const holdDrawing = (room, visibilityState) => !!room && visibilityState === 'hidden';

/** The renderer's pixel ratio: the device's, up to what the quality level asks for.
 *  `cssWidth` is the canvas width in CSS pixels (0 or undefined: unknown). */
export function pixelRatioFor(room, devicePixelRatio, wanted, cssWidth) {
  const base = Math.min(devicePixelRatio, wanted);
  if (!room) return base;
  const small = cssWidth > 0 && cssWidth < SMALL_CANVAS_PX;
  return Math.min(base, small ? ROOM_SMALL_PIXEL_CAP : ROOM_PIXEL_CAP);
}
