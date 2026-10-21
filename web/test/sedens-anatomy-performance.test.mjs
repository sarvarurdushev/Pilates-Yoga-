// The room-only performance mode of the anatomy viewer is gated on ?room=1. These are the pure
// decisions main.js makes from it. Without room=1 every value must be exactly what the
// professional viewer used before the mode existed: a 500 ms heartbeat, drawing while hidden
// (the browser throttles that itself), and a pixel ratio of min(devicePixelRatio, level).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roomMode, heartbeatMs, holdDrawing, pixelRatioFor,
  PROFESSIONAL_HEARTBEAT_MS, ROOM_HEARTBEAT_MS, ROOM_PIXEL_CAP, ROOM_SMALL_PIXEL_CAP, SMALL_CANVAS_PX,
} from "../src/roomPerf.js";

test("only room=1 turns the mode on; perf needs room=1 as well", () => {
  assert.deepEqual(roomMode("?room=1&embed=1"), { room: true, perf: false });
  assert.deepEqual(roomMode("?room=1&embed=1&perf=1"), { room: true, perf: true });
  for (const search of ["", "?", "?platform=1&embed=1", "?room=0", "?room=true", "?room=", "?perf=1", "?platform=1&perf=1", undefined, null])
    assert.deepEqual(roomMode(search), { room: false, perf: false }, String(search));
});

test("heartbeat: 500 ms for the professional viewer, 2000 ms in the room", () => {
  assert.equal(PROFESSIONAL_HEARTBEAT_MS, 500);
  assert.equal(heartbeatMs(false), 500);
  assert.equal(heartbeatMs(true), ROOM_HEARTBEAT_MS);
  assert.equal(ROOM_HEARTBEAT_MS, 2000);
});

test("hidden page: the room holds drawing, the professional viewer never does", () => {
  assert.equal(holdDrawing(true, "hidden"), true);
  assert.equal(holdDrawing(true, "visible"), false);
  assert.equal(holdDrawing(true, undefined), false);
  for (const state of ["hidden", "visible", "prerender", undefined]) assert.equal(holdDrawing(false, state), false);
});

test("pixel ratio without room=1 is exactly the old min(devicePixelRatio, level)", () => {
  for (const dpr of [0.75, 1, 1.25, 1.5, 2, 2.625, 3])
    for (const level of [1, 1.25, 1.5, 2])
      for (const width of [0, 120, 479, 480, 900, 2400])
        assert.equal(pixelRatioFor(false, dpr, level, width), Math.min(dpr, level), `${dpr} ${level} ${width}`);
});

test("pixel ratio in the room: capped at 1.25, and at 1 for a canvas narrower than 480 px", () => {
  assert.equal(ROOM_PIXEL_CAP, 1.25);
  assert.equal(ROOM_SMALL_PIXEL_CAP, 1);
  assert.equal(SMALL_CANVAS_PX, 480);
  assert.equal(pixelRatioFor(true, 2, 2, 900), 1.25);
  assert.equal(pixelRatioFor(true, 3, 2, 480), 1.25, "480 is not small");
  assert.equal(pixelRatioFor(true, 2, 2, 479), 1);
  assert.equal(pixelRatioFor(true, 2, 2, 0), 1.25, "unknown width: only the general cap");
  assert.equal(pixelRatioFor(true, 1, 2, 300), 1);
  assert.equal(pixelRatioFor(true, 2, 1, 900), 1, "the quality level still lowers it");
  assert.equal(pixelRatioFor(true, 1.1, 2, 900), 1.1, "a low-density display is never raised");
});
