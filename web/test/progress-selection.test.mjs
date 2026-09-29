import test from "node:test";
import assert from "node:assert/strict";
import {
  informativeMetric, preferredProgressMetric, targetMetricRelevance,
} from "../src/platform/progress-selection.js";
import { programProgressCard } from "../src/platform/library.js";

globalThis.location = {hash:""};

test("body target matching does not treat an unrelated joint as evidence", () => {
  assert.equal(targetMetricRelevance("front:left_elbow_rom", ["pelvis"]), 0);
  assert.equal(targetMetricRelevance("front:left_hip_rom", ["pelvis"]), 2);
  assert.equal(targetMetricRelevance("front:pelvic_obliquity", ["pelvis"]), 3);
  assert.equal(targetMetricRelevance("side_left:trunk_inclination_rom", ["thorax"]), 3);
  assert.equal(targetMetricRelevance("front:shoulder_tilt", ["right_shoulder"]), 0);
  assert.equal(targetMetricRelevance("front:left_shoulder_rom", ["right_shoulder"]), 0);
  assert.equal(targetMetricRelevance("front:right_shoulder_rom", ["right_shoulder"]), 3);
});

test("default progress prefers a responsive target signal over stationary zero ROM", () => {
  const rows = [
    {metric:"front:left_hip_rom",value:0},
    {metric:"front:left_hip_rom",value:0},
    {metric:"front:left_shoulder_rom",value:53},
    {metric:"front:left_shoulder_rom",value:46},
  ];
  assert.equal(informativeMetric("front:left_hip_rom", rows.filter((r)=>r.metric==="front:left_hip_rom")), false);
  assert.equal(preferredProgressMetric(["front:left_hip_rom","front:left_shoulder_rom"], rows, ["left_shoulder"]),
    "front:left_shoulder_rom");
});

test("all stationary zero-ROM traces require an explicit raw-metric choice", () => {
  const rows = [{metric:"front:left_elbow_rom",value:0},
    {metric:"front:left_elbow_rom",value:0}];
  assert.equal(preferredProgressMetric(["front:left_elbow_rom"], rows, ["pelvis"]), "");
});

test("featured program trend uses the target hip rather than flat elbow data", () => {
  const client = {
    id:"client", analyses:[
      {id:"a1",kind:"movement",protocol:"Controlled squat",demo:true},
      {id:"a2",kind:"movement",protocol:"Controlled squat",demo:true},
    ], progress:[
      {analysis_id:"a1",recorded_at:"2026-08-01T09:00:00Z",metric:"front:left_elbow_rom",value:0,unit:"deg"},
      {analysis_id:"a2",recorded_at:"2026-08-08T09:00:00Z",metric:"front:left_elbow_rom",value:0,unit:"deg"},
      {analysis_id:"a1",recorded_at:"2026-08-01T09:00:00Z",metric:"front:left_hip_rom",value:25,unit:"deg"},
      {analysis_id:"a2",recorded_at:"2026-08-08T09:00:00Z",metric:"front:left_hip_rom",value:31,unit:"deg"},
    ],
  };
  const html=programProgressCard(client,{starts_on:"2026-07-01"},{
    region_id:"pelvis",detail:{target_region_ids:["pelvis"]},
  });
  assert.match(html,/left hip range of motion/i);
  assert.match(html,/25°/);
  assert.match(html,/31°/);
  assert.doesNotMatch(html,/left elbow range of motion/i);
});

test("no target signal stays unavailable instead of displaying unrelated zero ROM", () => {
  const client = {
    id:"client", analyses:[{id:"a1",kind:"movement",protocol:"Squat",demo:true},
      {id:"a2",kind:"movement",protocol:"Squat",demo:true}],
    progress:[
      {analysis_id:"a1",recorded_at:"2026-08-01T09:00:00Z",metric:"front:left_elbow_rom",value:0,unit:"deg"},
      {analysis_id:"a2",recorded_at:"2026-08-08T09:00:00Z",metric:"front:left_elbow_rom",value:0,unit:"deg"},
    ],
  };
  const html=programProgressCard(client,{starts_on:"2026-07-01"},{
    region_id:"pelvis",detail:{target_region_ids:["pelvis"]},
  });
  assert.match(html,/none provides a comparable, usable measurement/);
  assert.doesNotMatch(html,/<h4>left elbow/i);
});
