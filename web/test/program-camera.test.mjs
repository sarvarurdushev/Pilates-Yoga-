import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COACH_VIDEO_BYTES,
  openCoachCamera,
  supportedCoachRecordingType,
} from "../src/platform/program-camera.js";
import {
  appendCoachMedia,
  planPhaseFromForm,
  nextProgramPhase,
  revisionSourceLink,
  programDurationEstimate,
} from "../src/platform/programs.js";
import { visibleFeedback } from "../src/platform/feedback-navigation.js";

class FakeRecorder {
  static isTypeSupported(type) { return type === "video/webm"; }
  constructor(stream, {mimeType}) { this.stream = stream; this.mimeType = mimeType; this.state = "inactive"; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({data:new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,1,2])],{type:"video/webm"})});
    this.onstop?.();
  }
}

function cameraFixture() {
  let stops = 0;
  const track = {stop:()=>{stops++;}};
  const stream = {getTracks:()=>[track]};
  const video = {srcObject:null, play:async()=>{}};
  return {video,devices:{getUserMedia:async()=>stream},stops:()=>stops};
}

test("coach camera records a supported short clip and releases its track", async () => {
  const fixture = cameraFixture();
  const recorded = [];
  const camera = await openCoachCamera(fixture.video, {
    devices:fixture.devices,Recorder:FakeRecorder,onRecorded:(file)=>recorded.push(file),
  });
  assert.equal(supportedCoachRecordingType(FakeRecorder), "video/webm");
  assert.ok(fixture.video.srcObject);
  camera.start();
  assert.equal(camera.recording, true);
  camera.stop();
  assert.equal(camera.recording, false);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].type, "video/webm");
  assert.match(recorded[0].name, /^coach-demonstration-.*\.webm$/);
  assert.equal(fixture.video.srcObject, null);
  assert.equal(fixture.stops(), 1);
  assert.ok(recorded[0].size < MAX_COACH_VIDEO_BYTES);
});

test("cancelled camera discards its clip and closes the track", async () => {
  const fixture = cameraFixture();
  const recorded = [];
  const camera = await openCoachCamera(fixture.video, {
    devices:fixture.devices,Recorder:FakeRecorder,onRecorded:(file)=>recorded.push(file),
  });
  camera.start();
  camera.dispose();
  assert.deepEqual(recorded, []);
  assert.equal(fixture.stops(), 1);
  assert.equal(fixture.video.srcObject, null);
});

test("camera offers upload fallback when recording or permission is unavailable", async () => {
  const fixture = cameraFixture();
  await assert.rejects(openCoachCamera(fixture.video, {devices:fixture.devices,Recorder:null}), /Upload a video file/);
  await assert.rejects(openCoachCamera(fixture.video, {devices:{getUserMedia:async()=>{throw Error("denied");}},Recorder:FakeRecorder}), /Allow access or upload/);
});

test("plan phase cannot be overwritten by a movement's phase during save", () => {
  const data = new FormData();
  data.append("current_program_phase", "Foundation");
  data.append("program_phase", "All phases");
  data.append("program_phase", "Mobility");
  assert.equal(planPhaseFromForm(data), "Foundation");
});

test("creating the next program phase chooses a unique name and the next unused weeks", () => {
  const original = [
    {name:"Foundation",weeks_start:1,weeks_end:4,goal:"Establish a comfortable range"},
    {name:"Phase 3",weeks_start:5,weeks_end:8,goal:"Build control"},
  ];
  const next = nextProgramPhase(original);
  assert.deepEqual(next, {name:"Phase 4",weeks_start:9,weeks_end:12,goal:""});
  assert.equal(original.length, 2, "a draft phase must not mutate the saved phase schedule");
  assert.deepEqual(nextProgramPhase([{name:"Progression",weeks_start:101,weeks_end:103}]),
    {name:"Phase 2",weeks_start:104,weeks_end:104,goal:""});
  assert.throws(() => nextProgramPhase([{name:"Final",weeks_start:100,weeks_end:104}]), /week 104/);
});

test("uploaded coach photos and videos retain distinct provenance and one primary video", () => {
  const photo = new File(["image"], "start.jpg", {type:"image/jpeg"});
  const first = appendCoachMedia([], photo, "photo", {caption:"Start position",primary:true});
  assert.deepEqual(first, [{media_id:"photo",kind:"coach_photo",caption:"Start position",primary:false,visibility:"student",stage:"other"}]);
  const clip = new File(["video"], "demo.webm", {type:"video/webm"});
  const second = appendCoachMedia(first, clip, "video1", {caption:"Keep the pelvis level"});
  assert.equal(second[1].kind, "coach_demonstration");
  assert.equal(second[1].caption, "Keep the pelvis level");
  assert.equal(second[1].primary, true);
  const third = appendCoachMedia(second, clip, "video2", {caption:"Alternative view",primary:true});
  assert.deepEqual(third.filter((item)=>item.primary).map((item)=>item.media_id), ["video2"]);
});

test("version history links analysis and coach feedback to their distinct record views", () => {
  globalThis.location = {hash:"#page=program&client=client-a"};
  const analysis = revisionSourceLink({source_kind:"analysis",source_id:"analysis-a"}, "client-a");
  assert.match(analysis, /page=report/);
  assert.match(analysis, /analysis-a/);
  const feedback = revisionSourceLink({source_kind:"coach_observation",source_id:"note-a"}, "client-a", [{id:"note-a",region_id:"right_shoulder"}]);
  assert.match(feedback, /page=client/);
  assert.match(feedback, /tab=notes/);
  assert.match(feedback, /right_shoulder/);
  const route = new URLSearchParams(feedback.match(/href="([^"]+)"/)[1].slice(1));
  assert.equal(route.get("client"), "client-a");
  assert.equal(route.get("note"), "note-a");
  assert.doesNotMatch(feedback, /page=report/);
});

test("source feedback resolves the exact note, not another visit in the same region", () => {
  const clientNotes = [
    {id:"older",region_id:"right_shoulder",text:"Earlier visit"},
    {id:"source",region_id:"right_shoulder",text:"Revision source"},
    {id:"elsewhere",region_id:"left_knee",text:"Different region"},
  ];
  assert.deepEqual(visibleFeedback(clientNotes, {noteId:"source",regionId:"right_shoulder"}).map((note) => note.id), ["source"]);
  assert.deepEqual(visibleFeedback(clientNotes, {regionId:"right_shoulder"}).map((note) => note.id), ["older","source"]);
  assert.deepEqual(visibleFeedback(clientNotes, {noteId:"older",regionId:"left_knee"}), []);
  assert.deepEqual(visibleFeedback(clientNotes, {noteId:"removed",regionId:"right_shoulder"}), []);
  assert.deepEqual(visibleFeedback([], {noteId:"source"}), []);
});


test("session duration counts rest only between timed sets and identifies untimed work", () => {
  assert.deepEqual(programDurationEstimate([
    {exercise_id:"timed", sets:2, seconds:60, rest:30},
  ]), {minutes:3,untimed:0});
  assert.deepEqual(programDurationEstimate([
    {exercise_id:"rep-only", sets:3, seconds:0, rest:30},
  ]), {minutes:0,untimed:1});
  assert.deepEqual(programDurationEstimate([
    {type:"note", text:"Pause as needed"},
    {exercise_id:"timed", sets:1, seconds:45, rest:30},
    {exercise_id:"rep-only", sets:3, seconds:0, rest:30},
  ]), {minutes:1,untimed:1});
});
