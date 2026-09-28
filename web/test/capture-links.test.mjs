import test from "node:test";
import assert from "node:assert/strict";
import {
  eligibleCaptureReservations,
  captureSessionLinks,
} from "../src/platform/capture.js";

const places = [{id: "studio-a"}, {id: "studio-b"}];
const rows = [
  {id: "first", student_id: "alex", location_id: "studio-a", status: "reserved", starts_at: "2026-05-02T09:00:00", session_type: "Pilates"},
  {id: "second", student_id: "alex", location_id: "studio-a", status: "attended", starts_at: "2026-05-03T09:00:00"},
  {id: "other-client", student_id: "sam", location_id: "studio-a", status: "reserved", starts_at: "2026-05-04T09:00:00"},
  {id: "other-studio", student_id: "alex", location_id: "studio-b", status: "reserved", starts_at: "2026-05-05T09:00:00"},
  {id: "cancelled", student_id: "alex", location_id: "studio-a", status: "cancelled", starts_at: "2026-05-06T09:00:00"},
];

test("capture shows only the selected client's usable bookings at the selected studio", () => {
  assert.deepEqual(eligibleCaptureReservations(rows, "alex", "studio-a").map((row) => row.id),
    ["second", "first"]);
  assert.deepEqual(eligibleCaptureReservations(rows, "alex", "studio-b").map((row) => row.id),
    ["other-studio"]);
});

test("analysis links include selected location and optional reservation", () => {
  assert.deepEqual(captureSessionLinks("alex", "studio-a", "first", places, rows), {
    location_id: "studio-a", reservation_id: "first",
  });
  assert.deepEqual(captureSessionLinks("alex", "studio-a", "", places, rows), {
    location_id: "studio-a", reservation_id: null,
  });
});

test("capture refuses cross-client, cross-location, cancelled, or unassigned links", () => {
  for (const booking of ["other-client", "other-studio", "cancelled"])
    assert.throws(() => captureSessionLinks("alex", "studio-a", booking, places, rows));
  assert.throws(() => captureSessionLinks("alex", "outside", "", places, rows));
  assert.throws(() => captureSessionLinks("alex", "", "", places, rows));
  assert.throws(() => captureSessionLinks("alex", "outside", "", [], rows));
  assert.deepEqual(captureSessionLinks("alex", "", "", [], rows), {
    location_id: null, reservation_id: null,
  });
});
