// A short coach demonstration is kept in the editor until the program is saved.
// The upload remains the same authenticated exercise-media flow as a file upload.
export const MAX_COACH_VIDEO_BYTES = 64 * 1024 * 1024;
const RECORDING_TYPES = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];

export function supportedCoachRecordingType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder || typeof Recorder.isTypeSupported !== "function") return "";
  return RECORDING_TYPES.find((type) => Recorder.isTypeSupported(type)) || "";
}

export async function openCoachCamera(video, {
  devices = globalThis.navigator?.mediaDevices,
  Recorder = globalThis.MediaRecorder,
  FileClass = globalThis.File,
  maxSeconds = 45,
  onTick = () => {},
  onRecorded = () => {},
  onError = () => {},
} = {}) {
  const type = supportedCoachRecordingType(Recorder);
  if (!type) throw Error("This browser cannot record an MP4 or WebM clip. Upload a video file instead.");
  if (!devices?.getUserMedia) throw Error("Camera access is unavailable. Use HTTPS or localhost, or upload a video file.");
  let stream;
  try {
    stream = await devices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});
  } catch {
    throw Error("Camera permission was denied or the camera is unavailable. Allow access or upload a video file.");
  }
  video.srcObject = stream;
  video.play?.().catch?.(() => {});
  let recorder = null;
  let interval = null;
  let disposed = false;
  let ended = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(interval);
    interval = null;
    stream.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };
  const controller = {
    get recording() { return recorder?.state === "recording"; },
    start() {
      if (disposed || ended || recorder) throw Error("Open the camera again to record another clip.");
      const chunks = [];
      recorder = new Recorder(stream, {mimeType:type});
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => { release(); if (!disposed) { disposed = true; onError("Recording failed. Try again or upload a video file."); } };
      recorder.onstop = () => {
        ended = true;
        release();
        if (disposed) return;
        const mime = (recorder.mimeType || type).split(";")[0];
        const extension = mime === "video/mp4" ? "mp4" : "webm";
        const file = new FileClass(chunks, `coach-demonstration-${new Date().toISOString().replace(/[:.]/g,"-")}.${extension}`, {type:mime});
        if (!file.size) return onError("The camera recorded an empty clip. Try again.");
        if (file.size > MAX_COACH_VIDEO_BYTES) return onError("The clip exceeds 64 MB. Record a shorter demonstration.");
        onRecorded(file);
      };
      try { recorder.start(500); }
      catch (error) { release(); throw error; }
      let seconds = 0;
      onTick(seconds);
      interval = setInterval(() => {
        seconds++;
        onTick(seconds);
        if (seconds >= maxSeconds) controller.stop();
      }, 1000);
    },
    stop() {
      if (recorder?.state === "recording") recorder.stop();
    },
    dispose() {
      disposed = true;
      if (recorder?.state === "recording") recorder.stop();
      release();
    },
  };
  return controller;
}
