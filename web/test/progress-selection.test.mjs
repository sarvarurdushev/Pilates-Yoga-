import test from "node:test";
import assert from "node:assert/strict";
import { withSavedProgressEvidence } from "./progress-fixtures.mjs";
import {
  comparableProgressSeries, supportedProgressEvidence, informativeMetric, preferredProgressMetric, selectedProgressSeries, targetMetricRelevance,
} from "../src/platform/progress-selection.js";
import { programProgressCard } from "../src/platform/library.js";
globalThis.location = {hash:"", search:""};
const { regionHistory } = await import("../src/platform/anatomy.js");

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
  const html=programProgressCard(withSavedProgressEvidence(client),{starts_on:"2026-07-01"},{
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
  const html=programProgressCard(withSavedProgressEvidence(client),{starts_on:"2026-07-01"},{
    region_id:"pelvis",detail:{target_region_ids:["pelvis"]},
  });
  assert.match(html,/none provides a comparable, usable measurement/);
  assert.doesNotMatch(html,/<h4>left elbow/i);
});


test("body-map trend never compares different protocols, provenance, units, or clients", () => {
  const at = (day) => `2026-09-${String(day).padStart(2, "0")}T09:00:00Z`;
  const analyses = [
    {id:"real-1", student_id:"client", kind:"movement", protocol:"Arm raise", demo:false, status:"complete"},
    {id:"real-2", student_id:"client", kind:"movement", protocol:"Arm raise", demo:false, status:"complete"},
    {id:"demo", student_id:"client", kind:"movement", protocol:"Arm raise", demo:true, status:"complete"},
    {id:"other", student_id:"client", kind:"movement", protocol:"Wall slide", demo:false, status:"complete"},
    {id:"unit", student_id:"client", kind:"movement", protocol:"Arm raise", demo:false, status:"complete"},
    {id:"person", student_id:"other-client", kind:"movement", protocol:"Arm raise", demo:false, status:"complete"},
    {id:"refused", student_id:"client", kind:"movement", protocol:"Arm raise", demo:false, status:"refused"},
  ];
  const row = (analysis_id, day, value, unit="deg") => ({
    analysis_id, recorded_at:at(day), metric:"front:right_shoulder_rom", value, unit,
  });
  const client = {id:"client", analyses, observations:[], notes:[], progress:[
    row("real-1",1,62), row("real-2",8,69), row("demo",9,80),
    row("other",10,91), row("unit",11,0.82,"ratio"),
    row("person",12,45), row("refused",13,105),
  ]};
  const groups = comparableProgressSeries(withSavedProgressEvidence(client));
  const trend = regionHistory(withSavedProgressEvidence(client), {id:"right_shoulder"}).trend;
  assert.equal(groups.length, 4, "only valid client captures are grouped");
  assert.equal(trend.protocol, "Arm raise");
  assert.equal(trend.demo, false);
  assert.equal(trend.unit, "deg");
  assert.deepEqual(trend.rows.map((entry) => entry.analysis_id), ["real-1", "real-2"]);
  assert.equal(trend.previous.value, 62);
  assert.equal(trend.latest.value, 69);
});

test("body-map trend leaves a single capture without a fabricated previous value", () => {
  const client = {id:"client", observations:[], notes:[],
    analyses:[{id:"capture",kind:"movement",protocol:"Arm raise",demo:false}],
    progress:[{analysis_id:"capture",recorded_at:"2026-09-08T09:00:00Z",
      metric:"front:right_shoulder_rom",value:62,unit:"deg"}],
  };
  const trend = regionHistory(withSavedProgressEvidence(client), {id:"right_shoulder"}).trend;
  assert.equal(trend.previous, null);
  assert.equal(trend.latest.value, 62);
  assert.equal(regionHistory(withSavedProgressEvidence({...client, progress:[]}), {id:"right_shoulder"}).trend, null);
});


test("full-history navigation preserves the source's unit series and otherwise uses latest dates", () => {
  const older = {rows:[{analysis_id:"linked-source"}], latest:{recorded_at:"2026-09-08T09:00:00Z"}, unit:"deg"};
  const newer = {rows:[{analysis_id:"new-source"}], latest:{recorded_at:"2026-09-09T09:00:00Z"}, unit:"ratio"};
  assert.equal(selectedProgressSeries([newer, older], "linked-source"), older);
  assert.equal(selectedProgressSeries([older, newer]), newer);
  assert.equal(selectedProgressSeries([], "linked-source"), null);
});

test("progress ignores missing, non-finite and inconsistent provenance values", () => {
  const client = {id:"client", analyses:[{id:"capture",kind:"movement",protocol:"Arm raise",demo:false}],
    progress:[
      {analysis_id:"capture",recorded_at:"2026-09-08T09:00:00Z",metric:"front:right_shoulder_rom",value:62,unit:"deg",demo:0},
      {analysis_id:"missing",recorded_at:"2026-09-09T09:00:00Z",metric:"front:right_shoulder_rom",value:65,unit:"deg"},
      {analysis_id:"capture",recorded_at:"invalid",metric:"front:right_shoulder_rom",value:65,unit:"deg"},
      {analysis_id:"capture",recorded_at:"2026-09-10T09:00:00Z",metric:"front:right_shoulder_rom",value:null,unit:"deg"},
      {analysis_id:"capture",recorded_at:"2026-09-11T09:00:00Z",metric:"front:right_shoulder_rom",value:71,unit:"deg",demo:1},
    ],
  };
  const groups = comparableProgressSeries(withSavedProgressEvidence(client));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].latest.value, 62);
});


test("progress rejects every unverified confidence/status/context mismatch", () => {
  const client = withSavedProgressEvidence({id:"client",
    analyses:[{id:"source",kind:"movement",protocol:"Arm raise",demo:false}],
    progress:[{analysis_id:"source",recorded_at:"2026-09-08T09:00:00Z",metric:"front:right_shoulder_rom",value:62,unit:"deg"}],
  });
  const row = client.progress[0], source = client.analyses[0];
  assert.equal(supportedProgressEvidence(row, source, client.id), true);
  for (const patch of [
    {supported:false}, {authority:"index_only"}, {version:0},
    {confidence_basis:"person_average"}, {confidence:null}, {confidence:0.64}, {confidence:1.01}, {status:"unavailable"},
    {analysis_id:"other-source"}, {student_id:"other-client"}, {kind:"posture"},
    {protocol:"Squat"}, {demo:true}, {recorded_at:"2026-09-09T09:00:00Z"},
    {view:"rear"}, {metric_id:"left_shoulder_rom"}, {person_id:""},
    {person_scope:"unknown"}, {selection:"assumed"}, {value:63}, {unit:"ratio"},
  ]) {
    const changed = {...row, evidence:{...row.evidence, ...patch}};
    assert.equal(supportedProgressEvidence(changed, source, client.id), false, JSON.stringify(patch));
    assert.deepEqual(comparableProgressSeries({...client, progress:[changed]}), []);
  }
  assert.equal(supportedProgressEvidence({...row,evidence:undefined}, source, client.id), false);
  assert.equal(supportedProgressEvidence(row, {...source,protocol:""}, client.id), false);
  assert.equal(supportedProgressEvidence(row, {...source,status:"needs_capture"}, client.id), false);
});

test("person selection, view, measurement status and unit remain separate histories", () => {
  const variations = [
    {id:"first",day:1,value:62,status:"estimated",person_id:"1",view:"front",unit:"deg"},
    {id:"repeat",day:8,value:69,status:"estimated",person_id:"1",view:"front",unit:"deg"},
    {id:"other-person",day:9,value:81,status:"estimated",person_id:"2",view:"front",unit:"deg"},
    {id:"other-status",day:10,value:77,status:"measured",person_id:"1",view:"front",unit:"deg"},
    {id:"other-view",day:11,value:88,status:"estimated",person_id:"1",view:"side_left",unit:"deg"},
    {id:"other-unit",day:12,value:0.82,status:"estimated",person_id:"1",view:"front",unit:"ratio"},
  ];
  const client = withSavedProgressEvidence({id:"client",
    analyses:variations.map((v)=>({id:v.id,kind:"movement",protocol:"Arm raise",demo:false})),
    progress:variations.map((v)=>({analysis_id:v.id,recorded_at:`2026-09-${String(v.day).padStart(2,"0")}T09:00:00Z`,
      metric:`${v.view}:right_shoulder_rom`,value:v.value,unit:v.unit,evidence:{person_id:v.person_id,status:v.status}})),
  });
  const groups = comparableProgressSeries(client);
  assert.equal(groups.length, 5);
  const pair = groups.find((group)=>group.rows.length===2);
  assert.deepEqual(pair.rows.map((r)=>r.analysis_id), ["first","repeat"]);
  assert.equal(pair.status,"estimated");
  assert.equal(pair.person_id,"1");
  assert.equal(pair.person_scope,"capture_local");
});

test("a changed reviewed person cannot reuse stale cached evidence", () => {
  const client=withSavedProgressEvidence({id:"client",
    analyses:[{id:"source",kind:"movement",protocol:"Arm raise",demo:false,detail:{selected_people:{front:2}}}],
    progress:[{analysis_id:"source",recorded_at:"2026-09-08T09:00:00Z",metric:"front:right_shoulder_rom",value:62,unit:"deg",
      evidence:{person_id:"1",selection:"reviewed"}}],
  });
  assert.deepEqual(comparableProgressSeries(client), []);
  client.progress[0].evidence.person_id="2";
  assert.equal(comparableProgressSeries(client).length,1);
});

test("program measurements share strict evidence without losing assignment filtering", () => {
  const client=withSavedProgressEvidence({id:"client",
    analyses:[
      {id:"before",kind:"movement",protocol:"Arm raise",demo:false},
      {id:"first",kind:"movement",protocol:"Arm raise",demo:false},
      {id:"low",kind:"movement",protocol:"Arm raise",demo:false},
      {id:"latest",kind:"movement",protocol:"Arm raise",demo:false},
    ],
    progress:[
      {analysis_id:"before",recorded_at:"2026-07-01T09:00:00Z",metric:"front:right_shoulder_rom",value:55,unit:"deg"},
      {analysis_id:"first",recorded_at:"2026-08-01T09:00:00Z",metric:"front:right_shoulder_rom",value:62,unit:"deg"},
      {analysis_id:"low",recorded_at:"2026-08-04T09:00:00Z",metric:"front:right_shoulder_rom",value:99,unit:"deg",evidence:{confidence:0.5}},
      {analysis_id:"latest",recorded_at:"2026-08-08T09:00:00Z",metric:"front:right_shoulder_rom",value:69,unit:"deg"},
    ],
  });
  const html=programProgressCard(client,{starts_on:"2026-08-01"},{region_id:"right_shoulder",detail:{}});
  assert.match(html,/62°/);
  assert.match(html,/69°/);
  assert.doesNotMatch(html,/55°|99°/);
});


test("duplicate index rows cannot become a fabricated second capture", () => {
  const client=withSavedProgressEvidence({id:"client",
    analyses:[{id:"source",kind:"movement",protocol:"Arm raise",demo:false}],
    progress:[{analysis_id:"source",recorded_at:"2026-09-08T09:00:00Z",metric:"front:right_shoulder_rom",value:62,unit:"deg"}],
  });
  client.progress.push({...client.progress[0],id:"duplicate-index"});
  const series=comparableProgressSeries(client)[0];
  assert.equal(series.rows.length,1);
  assert.equal(series.previous,null);
});

test("legacy frame-score recovery identifies its complete contributing sample count", () => {
  const client=withSavedProgressEvidence({id:"client",
    analyses:[{id:"source",kind:"movement",protocol:"Arm raise",demo:false}],
    progress:[{analysis_id:"source",recorded_at:"2026-09-08T09:00:00Z",metric:"front:right_shoulder_rom",value:62,unit:"deg",
      evidence:{confidence_basis:"saved_accepted_frame_scores",confidence_sample_count:12}}],
  });
  assert.equal(comparableProgressSeries(client).length,1);
  delete client.progress[0].evidence.confidence_sample_count;
  assert.deepEqual(comparableProgressSeries(client),[]);
});
