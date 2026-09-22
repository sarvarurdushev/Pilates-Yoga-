import {
  $,
  state,
  api,
  params,
  href,
  go,
  esc,
  field,
  select,
  options,
  head,
  notice,
  modal,
  upload,
  toast,
  views,
} from "./core.js";
const drafts = new Map();
const protocols = [
  "Standing posture",
  "Squat",
  "Forward bend",
  "Shoulder flexion",
  "Spinal rotation",
  "Lunge",
  "Standing balance",
  "Standing hip lift",
  "Pilates roll down",
];
const movementHelp = {
  Squat:
    "Use a side view. Start standing, bend at the hips and knees within a comfortable range, then stand again. Repeat two or three times.",
  "Forward bend":
    "Use a side view. Begin upright, hinge forward comfortably, pause, then return. Keep both feet visible and repeat slowly.",
  "Shoulder flexion":
    "Use a front view with space above and beside both arms. Raise the arms comfortably, pause, then lower. A side capture can show trunk compensation.",
  "Spinal rotation":
    "Use a front view. Keep the pelvis steady, turn the trunk comfortably in both directions, and return to centre. A single camera cannot measure true spinal rotation in depth.",
  Lunge:
    "Use a side view. Step into a comfortable lunge, pause, then return. Keep the full stride and both feet in frame.",
  "Standing balance":
    "Use a front view with a stable support within reach. Briefly balance on one leg, then return to both feet. Record each side separately.",
  "Standing hip lift":
    "Use a front view with a stable support within reach. Lift one knee comfortably, pause, then lower. Repeat each side slowly.",
  "Pilates roll down":
    "Use a side view. Begin standing, roll down only as far as comfortable, then return slowly. Keep the head and feet visible throughout.",
  "Standing posture":
    "For a static assessment choose Photographs. For a video, stand naturally and remain fully visible; a still pose does not produce repetition or movement-range evidence.",
};
const help = {
  front:
    "Face the camera. Let your arms rest naturally; include the head and both feet.",
  rear: "Turn your back to the camera. Keep both shoulders, hips, knees and feet visible.",
  side_left:
    "Your left shoulder faces the camera. Keep the head, hips and feet in frame.",
  side_right:
    "Your right shoulder faces the camera. Keep the head, hips and feet in frame.",
};
export async function capture(root) {
  if (!state.me.students.length) {
    root.innerHTML =
      head("Add your first client", "Assessments must belong to a client.") +
      '<button data-edit="student">+ New client</button>';
    return;
  }
  const cid =
    state.client?.id || params().get("client") || state.me.students[0].id;
  const draft = drafts.get(cid) || {
    kind: "posture",
    protocol: "Standing posture",
    files: {},
    view: "front",
  };
  drafts.set(cid, draft);
  root.innerHTML =
    head(
      "Guided assessment",
      "Choose a client, capture their movement, then review and save the evidence.",
    ) +
    `<ol class="capture-steps"><li class="active">1 Select client</li><li>2 Movement</li><li>3 Capture type</li><li>4 Upload / record</li><li>5 Pose detection</li><li>6 Verify skeleton</li><li>7 Biomechanical analysis</li><li>8 Review findings</li><li>9 Save to history</li><li>10 Explore anatomy</li></ol><form id="capture-form"><section class="panel"><div class="grid two">${select("Client", "student_id", state.me.students, cid, null)}${select(
      "Movement to assess",
      "protocol",
      protocols.map((x) => [x, x]),
      draft.protocol,
      null,
    )}</div><a class="text-button" href="#" id="new-client">+ New client</a><p class="muted">The selected client stays attached to every capture and saved result.</p></section><section class="panel"><div class="page-head"><h2>Capture the body clearly</h2><div class="segmented"><button type="button" data-kind="posture">Photographs</button><button type="button" data-kind="movement">Movement video</button></div></div><div id="capture-inputs"></div>${notice("Use a steady camera and even lighting. Capture the full body from head to feet. For movement, begin at rest, move through a comfortable range, then return.")}<details><summary>Capture settings</summary><label class="check"><input type="checkbox" name="include_3d" checked>Estimate depth when the independent models agree</label><label class="check"><input type="checkbox" name="class_scan">Wider class scan · use only for multiple people</label>${field("Optional coach target angle · degrees", "target_angle", "", "number", 'min="0" max="180"')}<small>A target is a coaching reference, not a diagnosis or population norm.</small></details><p class="form-error" role="alert"></p><p id="capture-progress" role="status"></p><progress id="capture-bar" max="100" value="0" hidden></progress><button id="analyze" class="primary" type="submit">Analyze and review</button></section></form>`;
  const form = root.querySelector("form");
  const markStep = (number) =>
    root.querySelectorAll(".capture-steps li").forEach((li, i) => {
      li.classList.toggle("active", i + 1 === number);
      li.classList.toggle("complete", i + 1 < number);
      if (i + 1 === number) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
  markStep(2);
  form.querySelector("[name=student_id]").onchange = (e) =>
    go("capture", { client: e.target.value });
  form.querySelector("[name=protocol]").onchange = (e) => {
    draft.protocol = e.target.value;
    markStep(3);
    if ($("#movement-help"))
      $("#movement-help").textContent = movementHelp[draft.protocol];
  };
  $("#new-client").onclick = async (e) => {
    e.preventDefault();
    const m = await import("./forms.js");
    m.edit("student");
  };
  function draw() {
    root
      .querySelectorAll("[data-kind]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.kind === draft.kind),
      );
    const box = $("#capture-inputs");
    if (draft.kind === "posture")
      box.innerHTML = `<p class="muted">Add front, back and side views. You can begin with one; missing views stay unavailable.</p><div class="capture-grid">${Object.entries(
        views,
      )
        .map(
          ([key, label]) =>
            `<div class="capture-slot"><span class="step-number">${Object.keys(views).indexOf(key) + 1}</span><h3>${label}</h3><p>${help[key]}</p><div class="capture-preview" id="preview-${key}">${draft.files[key] ? '<img alt="Selected ' + label + ' capture">' : `<span>${label} view</span>`}</div><label class="file-button">Upload ${label.toLowerCase()} photo<input type="file" data-view="${key}" accept="image/jpeg,image/png,image/webp"></label><button type="button" data-camera="${key}">Use camera</button><small id="file-${key}">${esc(draft.files[key]?.name || "No photo selected")}</small></div>`,
        )
        .join("")}</div>`;
    else
      box.innerHTML = `<div class="grid two"><div>${select("Camera view", "view", Object.entries(views), draft.view, null)}<p id="movement-help" class="notice">${movementHelp[draft.protocol]}</p><p id="view-help">${help[draft.view]}</p><p>Record a short clip, about 10–20 seconds, with a complete start → movement → peak → return.</p><label class="file-button">Upload movement video<input type="file" data-view="video" accept="video/mp4,video/webm"></label><button type="button" data-camera="video">Record with camera</button><small id="file-video">${esc(draft.files.video?.name || "MP4 or WebM · up to 64 MB")}</small></div><div id="preview-video" class="capture-preview">${draft.files.video ? "<video controls></video>" : "Your video preview appears here."}</div></div>`;
    for (const [key, file] of Object.entries(draft.files)) {
      const target = box.querySelector(
        "#preview-" + key + " " + (key === "video" ? "video" : "img"),
      );
      if (target) {
        const url = URL.createObjectURL(file);
        target.src = url;
        state.dispose.push(() => URL.revokeObjectURL(url));
      }
    }
    box.querySelectorAll("[data-view]").forEach(
      (input) =>
        (input.onchange = () => {
          const file = input.files[0];
          if (file) {
            draft.files[input.dataset.view] = file;
            markStep(4);
            draw();
          }
        }),
    );
    if (box.querySelector("[name=view]"))
      box.querySelector("[name=view]").onchange = (e) => {
        draft.view = e.target.value;
        $("#view-help").textContent = help[draft.view];
      };
    box.querySelectorAll("[data-camera]").forEach(
      (b) =>
        (b.onclick = () =>
          camera(b.dataset.camera, async (file) => {
            draft.files[b.dataset.camera] = file;
            draw();
          })),
    );
  }
  root.querySelectorAll("[data-kind]").forEach(
    (b) =>
      (b.onclick = () => {
        draft.kind = b.dataset.kind;
        markStep(4);
        draw();
      }),
  );
  draw();
  let disposed = false;
  state.dispose.push(() => (disposed = true));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const error = form.querySelector(".form-error");
    const button = $("#analyze");
    const progress = $("#capture-progress");
    const bar = $("#capture-bar");
    error.textContent = "";
    const selected =
      draft.kind === "posture"
        ? Object.entries(draft.files).filter(([k]) => k !== "video")
        : draft.files.video
          ? [[draft.view, draft.files.video]]
          : [];
    if (!selected.length) {
      error.textContent = "Upload a photograph or video before analyzing.";
      return;
    }
    button.disabled = true;
    bar.hidden = false;
    try {
      const captures = [];
      for (let i = 0; i < selected.length; i++) {
        const [view, original] = selected[i];
        const file =
          draft.kind === "posture" ? await compress(original) : original;
        progress.textContent = `Uploading ${i + 1}/${selected.length} · ${views[view]}`;
        const saved = await upload(
          file,
          { kind: "capture", student_id: cid },
          (n) => (bar.value = ((i + n / 100) / selected.length) * 100),
        );
        captures.push({ view, media_id: saved.id });
      }
      bar.removeAttribute("value");
      markStep(5);
      const target = form.querySelector("[name=target_angle]").value;
      const job = await api("analyse", {
        student_id: cid,
        kind: draft.kind,
        protocol: draft.protocol,
        mode: draft.protocol === "Standing posture" ? "standing" : "pose",
        captures,
        location_id: state.me.students.find((c) => c.id === cid)
          ?.location_ids[0],
        include_3d: form.querySelector("[name=include_3d]").checked,
        class_scan: form.querySelector("[name=class_scan]").checked,
        target_angle: target === "" ? null : Number(target),
      });
      sessionStorage.setItem("motion-pending-job", job.id);
      let status = job;
      while (!disposed && !["done", "failed"].includes(status.state)) {
        progress.textContent = status.progress;
        await new Promise((r) => setTimeout(r, 1800));
        status = await api("record?collection=jobs&id=" + job.id);
      }
      if (disposed) return;
      if (status.state === "failed") throw Error(status.error);
      sessionStorage.removeItem("motion-pending-job");
      drafts.delete(cid);
      markStep(6);
      progress.textContent =
        "Complete · opening skeleton verification and report";
      go("report", { client: cid, id: status.analysis_id });
    } catch (err) {
      error.textContent = err.message;
      progress.textContent = "Capture retained. Correct the issue and retry.";
    } finally {
      button.disabled = false;
      bar.hidden = true;
    }
  };
  const pending = sessionStorage.getItem("motion-pending-job");
  if (pending) {
    try {
      const job = await api("record?collection=jobs&id=" + pending);
      if (job.student_id === cid) {
        const div = document.createElement("div");
        div.className = "notice";
        div.textContent =
          job.state === "done"
            ? "Your previous analysis finished. "
            : job.progress + " ";
        const updatePending = async () => {
          let current = job;
          while (!disposed) {
            div.textContent =
              current.state === "done"
                ? "Your previous analysis finished. "
                : current.state === "failed"
                  ? current.error
                  : current.progress + " ";
            if (current.analysis_id) {
              const a = document.createElement("a");
              a.href = href("report", { client: cid, id: current.analysis_id });
              a.textContent = "Open saved report";
              div.append(a);
            }
            if (["done", "failed"].includes(current.state)) break;
            await new Promise((r) => setTimeout(r, 1800));
            if (disposed) break;
            try {
              current = await api("record?collection=jobs&id=" + pending);
            } catch (error) {
              div.textContent =
                error.message + " Reload to reconnect to the saved job.";
              break;
            }
          }
        };
        updatePending();
        root.prepend(div);
      }
    } catch {
      sessionStorage.removeItem("motion-pending-job");
    }
  }
}
async function compress(file) {
  if (file.size < 1_000_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.91));
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
  });
}
async function camera(view, save) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch {
    toast(
      "Camera access is unavailable. Allow camera permission or upload a file instead.",
    );
    return;
  }
  const d = modal(
    view === "video"
      ? "Record movement"
      : "Take " + views[view] + " photograph",
    `<video id="camera-preview" autoplay muted playsinline></video><p>Keep the full body visible. ${view === "video" ? "Begin still, move and return." : ""}</p><button type="button" id="camera-capture">${view === "video" ? "Start recording" : "Take photo"}</button><p id="camera-time" role="status"></p>`,
    null,
  );
  const video = d.querySelector("video");
  video.srcObject = stream;
  let recorder,
    timer,
    seconds = 0;
  const stop = () => {
    clearInterval(timer);
    if (recorder?.state === "recording") recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
  };
  d.addEventListener("close", stop, { once: true });
  state.dispose.push(() => {
    stop();
    d.close();
  });
  d.querySelector("#camera-capture").onclick = async (e) => {
    if (view === "video") {
      if (recorder?.state === "recording") {
        recorder.stop();
        return;
      }
      const type = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      if (!type) {
        toast(
          "This browser cannot record a supported video. Upload an MP4 or WebM.",
        );
        return;
      }
      const chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: type });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        await save(
          new File(
            chunks,
            "camera-movement." + (type.includes("mp4") ? "mp4" : "webm"),
            { type: type.split(";")[0] },
          ),
        );
        d.close();
      };
      recorder.start(500);
      e.target.textContent = "Stop and use recording";
      timer = setInterval(() => {
        seconds++;
        d.querySelector("#camera-time").textContent = seconds + " seconds";
        if (seconds >= 60) recorder.stop();
      }, 1000);
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const blob = await new Promise((r) =>
        canvas.toBlob(r, "image/jpeg", 0.92),
      );
      await save(
        new File([blob], "camera-" + view + ".jpg", { type: "image/jpeg" }),
      );
      d.close();
    }
  };
}
