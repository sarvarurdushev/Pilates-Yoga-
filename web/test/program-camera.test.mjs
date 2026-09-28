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
  revisionSourceLink,
} from "../src/platform/programs.js";

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
  assert.doesNotMatch(feedback, /page=report/);
});
