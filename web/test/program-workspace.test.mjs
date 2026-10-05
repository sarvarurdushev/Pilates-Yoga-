import test from "node:test";
import assert from "node:assert/strict";
import { withSavedProgressEvidence } from "./progress-fixtures.mjs";
import { comparableProgramMeasurements, latestProgramSessionCompletion, programSessionsForAssignment } from "../src/platform/library.js";
import { clientCaptureOptions, currentPhaseSteps, programDurationEstimate, revisionVisitOptions, revisionVisitLink, revisionSourceOptions, revisionAuthorLabel, revisionStepsHTML, programEditorClientContext } from "../src/platform/programs.js";

test("reusing a plan for another client clears the original client's evidence and capture", () => {
  const original = {detail:{student_id:"a",source_student_id:"a",source_analysis_id:"analysis-a",source_finding:"shoulder-a",coach_notes:"Private A context"},
    steps:[{exercise_id:"bridge",detail:{source:{kind:"analysis",id:"analysis-a"},why_assigned:"A's reason",media:[{kind:"client_capture",media_id:"capture-a"},{kind:"exercise_library",media_id:"demo"}]}}]};
  const context = programEditorClientContext(original,{id:"b",analyses:[{id:"analysis-b",student_id:"b"}]});
  assert.equal(context.sourceReport, "");
  assert.equal(context.sourceFinding, "");
  assert.equal(context.source.detail.source_analysis_id, null);
  assert.equal(context.source.detail.coach_notes, undefined);
  assert.equal(context.source.steps[0].detail.source, undefined);
  assert.equal(context.source.steps[0].detail.why_assigned, undefined);
  assert.deepEqual(context.source.steps[0].detail.media,[{kind:"exercise_library",media_id:"demo"}]);
  assert.equal(original.detail.source_analysis_id,"analysis-a","preparing a reusable draft must not alter the original program");
});

test("the same client's saved assessment and step evidence remain available", () => {
  const context = programEditorClientContext({detail:{student_id:"a",source_analysis_id:"analysis-a",source_finding:"shoulder-a"},
    steps:[{detail:{source:{kind:"analysis",id:"analysis-a"},why_assigned:"A's reason"}}]},
    {id:"a",analyses:[{id:"analysis-a",student_id:"a"}]});
  assert.equal(context.sourceReport,"analysis-a");
  assert.equal(context.sourceFinding,"shoulder-a");
  assert.equal(context.source.steps[0].detail.source.id,"analysis-a");
  assert.equal(context.source.steps[0].detail.why_assigned,"A's reason");
});

test("an explicit destination-client report is retained and a foreign URL report is refused", () => {
  const source = {detail:{student_id:"a",source_analysis_id:"analysis-a",source_finding:"old finding"}};
  const client = {id:"b",analyses:[{id:"analysis-b",student_id:"b"}]};
  const own = programEditorClientContext(source,client,{report:"analysis-b",finding:"b finding"});
  assert.equal(own.sourceReport,"analysis-b");
  assert.equal(own.changeAnalysis,"analysis-b");
  assert.equal(own.sourceFinding,"b finding");
  const foreign = programEditorClientContext(source,client,{report:"analysis-a",finding:"foreign finding"});
  assert.equal(foreign.sourceReport,"");
  assert.equal(foreign.changeAnalysis,"");
  assert.equal(foreign.sourceFinding,"");
});

test("a validated saved same-client source remains when the current response omits its older assessment", () => {
  const context = programEditorClientContext({detail:{student_id:"a",source_analysis_id:"older",source_finding:"older finding"},
    steps:[{detail:{source:{kind:"analysis",id:"older"}}}]},{id:"a",analyses:[]});
  assert.equal(context.sourceReport,"older");
  assert.equal(context.sourceFinding,"older finding");
  assert.equal(context.source.steps[0].detail.source.id,"older");
  assert.equal(programEditorClientContext(context.source,{id:"a",analyses:[]},{report:"foreign"}).sourceReport,"");
});

const analysis = (id, protocol, demo = false, kind = "movement") =>
  ({id, protocol, demo, kind});
const measure = (analysis_id, at, metric, value, unit = "deg") =>
  ({analysis_id, recorded_at: at, metric, value, unit});

test("program progress compares only the same sourced metric after assignment start", () => {
  const client = {
    analyses: [
      analysis("before", "arm raise", true),
      analysis("one", "arm raise", true),
      analysis("two", "arm raise", true),
      analysis("real", "arm raise", false),
      analysis("other-protocol", "squat", true),
      analysis("other-kind", "arm raise", true, "posture"),
    ],
    progress: [
      measure("before", "2026-04-30T10:00:00", "front:right_shoulder_rom", 50),
      measure("one", "2026-05-01T10:00:00", "front:right_shoulder_rom", 61),
      measure("two", "2026-05-10T10:00:00", "front:right_shoulder_rom", 68),
      measure("two", "2026-05-10T10:00:00", "side_left:right_shoulder_rom", 91),
      measure("real", "2026-05-11T10:00:00", "front:right_shoulder_rom", 99),
      measure("other-protocol", "2026-05-12T10:00:00", "front:right_shoulder_rom", 15),
      measure("other-kind", "2026-05-13T10:00:00", "front:right_shoulder_rom", 18),
      measure("unknown", "2026-05-14T10:00:00", "front:right_shoulder_rom", 200),
      measure("two", "not-a-date", "front:right_shoulder_rom", 300),
    ],
  };
  const groups = comparableProgramMeasurements(
    withSavedProgressEvidence(client),
    {starts_on: "2026-05-01"},
    {region_id: "right_shoulder", detail: {target_region_ids: ["right_shoulder"]}},
  );
  const paired = groups.filter((series) => series.rows.length > 1);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].metric, "front:right_shoulder_rom");
  assert.equal(paired[0].demo, true);
  assert.deepEqual(paired[0].rows.map((row) => row.value), [61, 68]);
  assert.equal(paired[0].first.analysis_id, "one");
  assert.equal(paired[0].latest.analysis_id, "two");
  assert.equal(groups.find((series) => !series.demo && series.metric === "front:right_shoulder_rom").rows.length, 1);
});

test("one measurement remains visible without inventing a trend", () => {
  const groups = comparableProgramMeasurements(
    withSavedProgressEvidence({analyses: [analysis("only", "squat")],
      progress: [measure("only", "2026-07-02T08:30:00", "side_left:knee_rom", 90)]}),
    {starts_on: "2026-07-01"},
    {region_id: "left_knee", detail: {}},
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].first, groups[0].latest);
});


test("a coach can choose a practice-only visit without assigning an unrelated assessment", () => {
  const entries = revisionVisitOptions({
    analyses: [
      {id: "capture-one", created_at: "2026-09-29T09:00:00Z"},
      {id: "unlinked-capture", created_at: "2026-09-30T09:00:00Z"},
    ],
    sessions: [
      {id: "practice-only", performed_at: "2026-09-29T10:00:00Z", completed: ["bridge"]},
      {id: "captured-visit", performed_at: "2026-09-29T09:00:00Z", analysis_id: "capture-one", completed: []},
    ],
  });
  assert.deepEqual(entries.map(([id]) => id), ["practice-only", "captured-visit"]);
  assert.match(entries[0][1], /1 movement/);
  assert.doesNotMatch(entries[0][1], /assessment/);
  assert.match(entries[1][1], /1 assessment/);
  assert.deepEqual(revisionVisitOptions(null), []);
});

test("version history links to the exact saved source visit rather than guessing a date", () => {
  globalThis.location = {hash: "#page=program&client=student"};
  const html = revisionVisitLink({session_id: "practice-only"}, "student");
  assert.match(html, /page=client/);
  assert.match(html, /client=student/);
  assert.match(html, /tab=sessions/);
  assert.match(html, /session=practice-only/);
  assert.match(html, />Source visit<\/a>/);
  assert.equal(revisionVisitLink({session_id: null}, "student"), "");
  assert.equal(revisionVisitLink({session_id: "visit"}, null), "");
});

test("historical revision discloses an unrecorded source visit while manual planning remains valid", () => {
  const analysis = revisionVisitLink({version:2,source_kind:"analysis",source_id:"assessment",created_at:"2026-06-01"}, "student");
  assert.match(analysis, /Source visit not recorded/);
  assert.doesNotMatch(analysis, /href=|2026-06-01/);
  const manual = revisionVisitLink({version:2,source_kind:"manual",snapshot:{detail:{student_id:"student"}}}, "student");
  assert.match(manual, /Manual coach decision · no visit linked/);
  assert.doesNotMatch(manual, /not recorded|unavailable/);
  assert.equal(revisionVisitLink({snapshot:{detail:{template:true,status:"Draft"}}}, "student"), "");
});


test("visit-linked revision sources stay within the selected visit", () => {
  const client = {
    analyses:[{id:"analysis-a",kind:"posture",created_at:"2026-09-29T09:00:00Z"}],
    sessions:[
      {id:"visit-a",analysis_id:"analysis-a",performed_at:"2026-09-29T09:00:00Z"},
      {id:"practice-b",performed_at:"2026-09-29T10:00:00Z"},
    ],
    notes:[
      {id:"legacy-note-a",analysis_id:"analysis-a",text:"Legacy feedback for this capture"},
      {id:"note-b",session_id:"practice-b",text:"Feedback for the practice visit"},
      {id:"unlinked-note",text:"General feedback"},
    ],
  };
  assert.deepEqual(revisionSourceOptions(client,"analysis","visit-a").map(([id])=>id),["analysis-a"]);
  assert.deepEqual(revisionSourceOptions(client,"analysis","practice-b"),[]);
  assert.deepEqual(revisionSourceOptions(client,"coach_observation","visit-a").map(([id])=>id),["legacy-note-a"]);
  assert.deepEqual(revisionSourceOptions(client,"client_feedback","practice-b").map(([id])=>id),["note-b"]);
  assert.deepEqual(revisionSourceOptions(client,"analysis","unknown-visit"),[]);
  assert.deepEqual(revisionSourceOptions(client,"coach_observation").map(([id])=>id),["legacy-note-a","note-b","unlinked-note"]);
});


test("program history uses the actual revision author instead of the current viewer", () => {
  const viewer = {id:"coach-viewer",name:"Viewing Coach"};
  assert.equal(revisionAuthorLabel({actor_id:"admin-author",actor_name:"Studio Admin"},viewer),"Studio Admin");
  assert.equal(revisionAuthorLabel({actor_id:"other-coach"},viewer,[{id:"other-coach",name:"Original Coach"}]),"Original Coach");
  assert.equal(revisionAuthorLabel({actor_id:"coach-viewer"},viewer),"Viewing Coach");
  assert.equal(revisionAuthorLabel({actor_id:"missing-author"},viewer),"Author unavailable");
});


test("historical coaching notes render as notes without blank exercise doses", () => {
  const html = revisionStepsHTML([
    {exercise_id:"arm",exercise_name:"Arm Arcs",sets:2,reps:10,phase:"Warm-up"},
    {type:"note",text:"Pause and review the comfortable range.",visibility:"coach",section:"Warm-up"},
    {exercise_id:"bridge",exercise_name:"Bridge",sets:1,reps:8,phase:"Practice"},
  ]);
  assert.match(html, /1\. Arm Arcs · 2 sets × 10 reps/);
  assert.match(html, /Coach planning note · Warm-up/);
  assert.match(html, /Pause and review the comfortable range/);
  assert.match(html, /2\. Bridge · 1 set × 8 reps/);
  assert.doesNotMatch(html, /undefined|3\. Bridge|·  sets ×  reps/);
});


test("the current-phase movement count and session estimate use the same steps for every role", () => {
  const steps = [
    {id:"foundation",exercise_id:"breathing",sets:2,seconds:60,rest:30,detail:{program_phase:"Foundation"}},
    {id:"shared",exercise_id:"bridge",sets:1,seconds:45,detail:{}},
    {id:"later",exercise_id:"squat",sets:2,seconds:120,detail:{program_phase:"Strength"}},
    {id:"note",type:"note",text:"Check comfort",detail:{program_phase:"Foundation"}},
  ];
  const current = currentPhaseSteps(steps, "Foundation");
  assert.deepEqual(current.map((step) => step.id), ["foundation","shared","note"]);
  assert.equal(current.filter((step) => step.exercise_id).length, 2);
  assert.deepEqual(programDurationEstimate(current), {minutes:4,untimed:0});
  assert.equal(steps.filter((step) => step.exercise_id).length, 3, "all-phase total remains separate");
  assert.deepEqual(currentPhaseSteps(steps, "Strength").map((step) => step.id), ["shared","later"]);
  assert.deepEqual(currentPhaseSteps(steps, "").map((step) => step.id), ["foundation","shared","note"]);
});

test("latest practice uses its exact historical version, not the revised current plan", () => {
  const old = {version:2,snapshot:{
    id:"program-a",detail:{phase:"Foundation"},
    steps:[
      {id:"old-a",exercise_id:"breathing",detail:{program_phase:"Foundation"}},
      {id:"old-b",exercise_id:"bridge",detail:{}},
      {id:"later",exercise_id:"squat",detail:{program_phase:"Strength"}},
    ],
  }};
  const current = {version:3,snapshot:{
    id:"program-a",detail:{phase:"Strength"},
    steps:[
      {id:"new-a",exercise_id:"squat",detail:{program_phase:"Strength"}},
      {id:"new-b",exercise_id:"balance",detail:{program_phase:"Strength"}},
      {id:"new-c",exercise_id:"lunge",detail:{program_phase:"Strength"}},
    ],
  }};
  assert.deepEqual(
    latestProgramSessionCompletion({program_version:2,completed:["old-a","old-a","old-b","later"]},[current,old],"program-a"),
    {value:"100%",detail:"2 of 2 current-phase movements in saved version 2"},
  );
  assert.deepEqual(
    latestProgramSessionCompletion({program_version:2,completed:["old-a"]},[current,old],"program-a"),
    {value:"50%",detail:"1 of 2 current-phase movements in saved version 2"},
  );
  assert.deepEqual(
    latestProgramSessionCompletion({program_version:2,completed:["breathing"]},[current,old],"program-a"),
    {value:"50%",detail:"1 of 2 current-phase movements in saved version 2"},
    "an unambiguous legacy exercise ID can map to its one saved step",
  );
});

test("missing and ambiguous practice evidence never produces a percentage", () => {
  const repeated = {version:1,snapshot:{
    id:"program-a",detail:{phase:"Foundation"},
    steps:[
      {id:"one",exercise_id:"bridge",detail:{}},
      {id:"two",exercise_id:"bridge",detail:{}},
    ],
  }};
  assert.deepEqual(latestProgramSessionCompletion(null,[repeated],"program-a"),
    {value:"—",detail:"No practice recorded for this assignment"});
  assert.deepEqual(latestProgramSessionCompletion({program_version:1,completed:[]},[repeated],"program-a"),
    {value:"—",detail:"No completed movements logged in the latest visit"});
  assert.match(latestProgramSessionCompletion({program_version:null,completed:["one","one"]},[repeated],"program-a").value,/^1 logged$/);
  assert.match(latestProgramSessionCompletion({program_version:1,completed:["bridge"]},[repeated],"program-a").detail,/cannot be matched/);
  assert.match(latestProgramSessionCompletion({program_version:7,completed:["one"]},[repeated],"program-a").detail,/snapshot unavailable/);
  assert.match(latestProgramSessionCompletion({program_version:1,completed:["one"]},[repeated],"another-program").detail,/snapshot unavailable/);
  assert.match(latestProgramSessionCompletion({program_version:1,completed:["unknown"]},[repeated],"program-a").detail,/cannot be matched/);
  assert.deepEqual(latestProgramSessionCompletion({program_version:1,completed:["one","one","two"]},[repeated],"program-a"),
    {value:"100%",detail:"2 of 2 current-phase movements in saved version 1"});
});


test("program dashboard ignores sessions before the current assignment", () => {
  const sessions = [
    {id:"old-assignment",program_id:"program-a",performed_at:"2026-05-01T09:00:00Z",completed:["step"]},
    {id:"current-assignment",program_id:"program-a",performed_at:"2026-09-15T09:00:00Z",completed:["step"]},
    {id:"different-program",program_id:"program-b",performed_at:"2026-09-16T09:00:00Z",completed:["other"]},
    {id:"capture-only",program_id:"program-a",performed_at:"2026-09-17T09:00:00Z",completed:[]},
  ];
  assert.deepEqual(programSessionsForAssignment(sessions,{program_id:"program-a",starts_on:"2026-09-15"}).map((s)=>s.id),["current-assignment"]);
  assert.deepEqual(programSessionsForAssignment(sessions,{program_id:"program-a",starts_on:"2026-10-01"}),[]);
  assert.deepEqual(programSessionsForAssignment(sessions,null),[]);
  assert.deepEqual(programSessionsForAssignment([
    {id:"earlier",program_id:"program-a",performed_at:"2026-09-16T09:00:00Z",completed:["step"]},
    {id:"latest",program_id:"program-a",performed_at:"2026-09-18T09:00:00Z",completed:["step"]},
  ],{program_id:"program-a",starts_on:"2026-09-15"}).map((s)=>s.id),["latest","earlier"]);
});

test("client capture choices keep exact IDs and distinguish repeated filenames", () => {
  const uploaded = "2026-09-30T09:30:00Z";
  const options = clientCaptureOptions([
    {id:"abcdef00-one",filename:"sarah.png",created_at:uploaded,mime:"image/png",
      capture_view:"front",capture_protocol:"Neutral standing posture"},
    {id:"abcdef11-two",filename:"sarah.png",created_at:uploaded,mime:"image/png",
      capture_view:"rear",capture_protocol:"Neutral standing posture"},
    {id:"legacy-three",filename:"sarah.png",created_at:null,mime:"image/png"},
  ]);
  assert.deepEqual(options.map(([id])=>id), ["abcdef00-one","abcdef11-two","legacy-three"]);
  assert.equal(new Set(options.map(([,label])=>label)).size, options.length);
  assert.match(options[0][1], /Photo · Front view · Neutral standing posture · uploaded .*2026.* · sarah\.png · #abcdef00/);
  assert.match(options[1][1], /Back view/);
  assert.match(options[1][1], /#abcdef11/);
  assert.match(options[2][1], /upload date unavailable · sarah\.png · #legacy/);
  assert.doesNotMatch(options[2][1], /Front view|Neutral standing posture|Invalid Date/);
});

test("capture choice labels only show view and protocol saved on that media row", () => {
  const [withSource, reused, video] = clientCaptureOptions([
    {id:"linked-media",mime:"image/png",filename:"pose.png",capture_view:"side_left",
      capture_protocol:"Controlled squat",created_at:"2026-09-30T09:30:00Z"},
    {id:"reused-media",mime:"image/png",filename:"pose.png",created_at:"2026-09-30T09:30:00Z"},
    {id:"video-media",mime:"video/mp4",filename:"movement.mp4",created_at:"bad-timestamp"},
  ]);
  assert.match(withSource[1], /Left side view · Controlled squat/);
  assert.doesNotMatch(reused[1], /Left side view|Controlled squat/);
  assert.match(video[1], /^Video · upload date unavailable · movement\.mp4/);
});
