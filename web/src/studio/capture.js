import {
  $,
  esc,
  id,
  views,
  badge,
  card,
  link,
  localGet,
  localPut,
  request,
  toast,
} from "./core.js";
const svg = (view) =>
  `<svg class="silhouette" viewBox="0 0 120 210" fill="none" stroke="currentColor" stroke-width="3"><path d="M10 8h15M10 8v15M110 8H95M110 8v15M10 200h15M10 200v-15M110 200H95M110 200v-15" stroke-width="1" stroke-dasharray="3 3"/>${view.startsWith("side") ? '<ellipse cx="60" cy="28" rx="11" ry="15"/><path d="M59 43 54 85 58 117 53 157 54 190h16 M58 49 67 88 64 120 M58 117 66 157 67 190h10"/>' : '<circle cx="60" cy="27" r="14"/><path d="M53 41 39 52 42 109 49 116 45 153 43 190h14l3-68 3 68h14l-2-37-4-37 7-7 3-57-14-11 M39 53 27 105 26 123 M81 53 93 105 94 123 M42 109h36"/>'}${view === "rear" ? '<path d="M60 47v61" stroke-dasharray="3 4"/>' : ""}</svg>`;
export async function capture(ctx, kind = "photo") {
  const { key, state, save, onComplete } = ctx;
  let draft = (await localGet(`${key}:draft`)) || {
    photos: {},
    kind,
    client_id: "",
    name: "",
    goal: "",
    mode: "standing",
    protocol: "squat",
    view: "side_left",
  };
  draft.kind = kind;
  let busy = false,
    cameraStream = null,
    recording = null;
  const persist = () => localPut(`${key}:draft`, draft);
  const hints = {
    front: "Face the camera. Let your arms rest naturally.",
    rear: "Turn your back to the camera. Keep both feet visible.",
    side_left: "Your left shoulder faces the camera.",
    side_right: "Your right shoulder faces the camera.",
  };
  $("#app").innerHTML =
    `<div class="page-head"><div><p class="eyebrow">GUIDED ASSESSMENT</p><h1>Start with a clear view.</h1><p>Choose the client, add your captures, then review the evidence.</p></div>${link("View saved reports", "reports")}</div><div class="steps"><span class="active"><b>1</b>Choose client</span><span class="active"><b>2</b>Add captures</span><span><b>3</b>Analyze</span><span><b>4</b>Review report</span></div><section class="card"><div class="card-head"><h3>Who are we assessing?</h3>${badge("Personal workspace", "green")}</div><div class="field-grid"><label>Client<select id="capture-client"><option value="">Add a new client</option>${state.clients.map((c) => `<option value="${esc(c.id)}" ${draft.client_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label><label>Client name<input id="capture-name" maxlength="80" placeholder="e.g. Alex Morgan" value="${esc(draft.name)}" required></label></div><label class="section-space">Personal goal <span class="muted">(optional)</span><input id="capture-goal" maxlength="200" placeholder="What would you like to work on?" value="${esc(draft.goal)}"></label></section><section class="card section-space"><div class="card-head"><div><h3>What would you like to capture?</h3></div><div class="segmented"><button id="choose-photo" class="${kind === "photo" ? "active" : ""}">Photographs</button><button id="choose-video" class="${kind === "movement" ? "active" : ""}">Movement video</button></div></div><div id="capture-inputs"></div><div class="notice">Keep the whole body in frame, from head to feet. Use even light and a level camera. For standing photographs, relax naturally; for video, keep your body visible through the full movement.</div><div class="actions"><button class="primary" id="start-analysis">Analyze ${kind === "photo" ? "captured views" : "movement"}</button><span id="capture-count" class="subtle"></span></div><div id="analysis-status" role="status" aria-live="polite"></div><p class="subtle">Captures are sent to the analysis server. Original media and a copy of your report are kept on this device for later review. Keep a backup of important records; the preview server's storage can reset.</p></section>`;
  $("#choose-photo").onclick = () => (location.hash = "capture");
  $("#choose-video").onclick = () => (location.hash = "capture/movement");
  $("#capture-client").onchange = async (e) => {
    draft.client_id = e.target.value;
    const c = state.clients.find((c) => c.id === draft.client_id);
    draft.name = c?.name || "";
    draft.goal = c?.goal || "";
    $("#capture-name").value = draft.name;
    $("#capture-goal").value = draft.goal;
    await persist();
  };
  for (const [field, prop] of [
    ["#capture-name", "name"],
    ["#capture-goal", "goal"],
  ])
    $(field).oninput = (e) => {
      draft[prop] = e.target.value;
      persist();
    };
  async function normalize(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type))
      throw new Error("Choose a JPG, PNG or WebP photograph.");
    if (file.size > 20 * 1024 * 1024)
      throw new Error("Choose a photograph smaller than 20 MB.");
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 80_000_000) {
      bitmap.close();
      throw new Error("This photo is too large. Export a smaller copy.");
    }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.9);
  }
  async function addPhoto(view, file) {
    try {
      draft.photos[view] = {
        data: await normalize(file),
        name: file.name || "Camera capture",
      };
      await persist();
      renderInputs();
    } catch (e) {
      toast(e.message);
    }
  }
  function renderInputs() {
    if (kind === "photo") {
      $("#capture-inputs").innerHTML =
        `<p class="muted" style="font-size:12px;margin-bottom:18px">Add any available view to begin. Four views give you a more complete assessment; missing views stay unavailable.</p><div class="capture-grid">${Object.entries(
          views,
        )
          .map(
            ([v, label]) =>
              `<div class="capture-slot ${draft.photos[v] ? "ready" : ""}">${badge(draft.photos[v] ? "Added" : "Optional", draft.photos[v] ? "green" : "")}<h3>${label}</h3><p>${hints[v]}</p><div class="preview">${draft.photos[v] ? `<img src="${draft.photos[v].data}" alt="${label} capture preview">` : svg(v)}</div><label for="upload-${v}" class="sr-only">Upload ${label.toLowerCase()} photograph</label><input id="upload-${v}" data-view="${v}" type="file" accept="image/jpeg,image/png,image/webp"><button class="small-btn ghost" data-camera="${v}">Use camera</button>${draft.photos[v] ? `<button class="small-btn ghost" data-remove="${v}">Remove</button>` : ""}</div>`,
          )
          .join(
            "",
          )}</div><details class="section-space"><summary>Exercise poses, groups & 3D options</summary><div class="field-grid"><label>Assessment type<select id="capture-mode"><option value="standing" ${draft.mode === "standing" ? "selected" : ""}>Relaxed standing posture</option><option value="pose" ${draft.mode === "pose" ? "selected" : ""}>Exercise / floor pose</option></select></label><div><label class="check"><input id="include-3d" type="checkbox" ${draft.include_3d !== false ? "checked" : ""}> Estimate a 3D skeleton when supported</label><label class="check"><input id="class-scan" type="checkbox" ${draft.class_scan ? "checked" : ""}> Wider class photo: look for distant people</label><small>Each person is reviewed separately. This option is only applied to large, wide images.</small></div></div></details>`;
      document.querySelectorAll("[data-view]").forEach(
        (input) =>
          (input.onchange = (e) => {
            if (e.target.files[0])
              addPhoto(input.dataset.view, e.target.files[0]);
          }),
      );
      document
        .querySelectorAll("[data-camera]")
        .forEach((b) => (b.onclick = () => camera(b.dataset.camera, false)));
      document.querySelectorAll("[data-remove]").forEach(
        (b) =>
          (b.onclick = async () => {
            delete draft.photos[b.dataset.remove];
            await persist();
            renderInputs();
          }),
      );
      $("#capture-mode").onchange = (e) => {
        draft.mode = e.target.value;
        persist();
      };
      $("#include-3d").onchange = (e) => {
        draft.include_3d = e.target.checked;
        persist();
      };
      $("#class-scan").onchange = (e) => {
        draft.class_scan = e.target.checked;
        persist();
      };
      $("#capture-count").textContent =
        `${Object.keys(draft.photos).length} of 4 views added`;
    } else {
      $("#capture-inputs").innerHTML =
        `<div class="field-grid"><label>Movement to repeat<select id="capture-protocol">${[
          ["squat", "Controlled squat"],
          ["arm_raise", "Arm raise"],
          ["balance", "Single-leg balance"],
          ["free_movement", "Pilates / yoga movement"],
        ]
          .map(
            ([v, t]) =>
              `<option value="${v}" ${draft.protocol === v ? "selected" : ""}>${t}</option>`,
          )
          .join(
            "",
          )}</select></label><label>Camera view<select id="video-view">${Object.entries(
          views,
        )
          .map(
            ([v, t]) =>
              `<option value="${v}" ${draft.view === v ? "selected" : ""}>${t}</option>`,
          )
          .join(
            "",
          )}</select></label></div><div class="grid cols-2 section-space"><div><div id="video-preview">${draft.video ? '<video id="input-video" controls playsinline></video>' : `<div class="empty">${svg(draft.view)}<h3>Record a short, steady clip</h3><p>About 10–20 seconds is a useful start. Keep the whole body visible throughout the movement.</p></div>`}</div></div><div><h3 id="video-direction">${views[draft.view]} view</h3><p class="muted section-space" style="font-size:12px" id="video-hint"></p><label class="section-space">Upload a movement video<input id="video-file" type="file" accept="video/mp4,video/webm,video/quicktime"></label><small>MP4 or WebM recommended · up to 64 MB</small><div class="section-space"><button id="record-video">Record with camera</button></div><p class="subtle">The server samples the video, checks visible body evidence, tracks each person, then calculates available joint angle traces. Longer clips take longer to analyze.</p></div></div>`;
      const hint = () => {
        $("#video-direction").textContent = views[draft.view] + " view";
        $("#video-hint").textContent =
          draft.protocol === "balance"
            ? "For balance, a front view helps show left/right movement. Stand near a stable support."
            : draft.protocol === "squat"
              ? "For a squat, use a side view to see the hip and knee bend. Keep the camera still and complete a few comfortable repetitions."
              : draft.protocol === "arm_raise"
                ? "Use a side view for forward arm raises, or a front view for raises out to the side. Keep the arm visible throughout."
                : "Choose the view that keeps the working joints visible. Repeat the same sequence and camera setup for later comparisons.";
      };
      hint();
      $("#video-view").onchange = (e) => {
        draft.view = e.target.value;
        persist();
        hint();
      };
      $("#capture-protocol").onchange = (e) => {
        draft.protocol = e.target.value;
        persist();
        hint();
      };
      $("#video-file").onchange = (e) => {
        if (e.target.files[0]) addVideo(e.target.files[0]);
      };
      $("#record-video").onclick = () => camera(draft.view, true);
      if (draft.video) $("#input-video").src = URL.createObjectURL(draft.video);
      $("#capture-count").textContent = draft.video
        ? `${draft.video.name || "Camera recording"} · ${(draft.video.size / 1024 / 1024).toFixed(1)} MB`
        : "No video selected";
    }
  }
  async function addVideo(file) {
    if (!file.type.startsWith("video/")) return toast("Choose a video file.");
    if (file.size > 64 * 1024 * 1024)
      return toast(
        "Choose a video under 64 MB. A short clip is enough to start.",
      );
    draft.video = file;
    await persist();
    renderInputs();
  }
  async function camera(view, isVideo) {
    const modal = $("#modal");
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      modal.innerHTML = `<h2>${isVideo ? "Record movement" : `Capture ${views[view].toLowerCase()} view`}</h2><p class="muted" style="font-size:12px">Step back until your entire body is visible. Use a stable camera.</p><video id="camera-preview" autoplay muted playsinline></video><div class="actions"><button id="close-camera">Cancel</button><button id="take-camera" class="primary">${isVideo ? "Start recording" : "Take photograph"}</button></div><p id="record-timer" class="subtle"></p>`;
      modal.showModal();
      $("#camera-preview").srcObject = cameraStream;
      let timer = null;
      const stop = () => {
        clearInterval(timer);
        if (recording?.state === "recording") recording.stop();
        cameraStream?.getTracks().forEach((t) => t.stop());
        cameraStream = null;
      };
      modal.onclose = stop;
      $("#close-camera").onclick = () => modal.close();
      $("#take-camera").onclick = () => {
        if (isVideo) {
          if (recording?.state === "recording") {
            recording.stop();
            return;
          }
          const chunks = [];
          recording = new MediaRecorder(cameraStream);
          recording.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          recording.onstop = async () => {
            await addVideo(
              new File(chunks, "camera-recording.webm", {
                type: recording.mimeType,
              }),
            );
            modal.close();
          };
          recording.start();
          $("#take-camera").textContent = "Finish recording";
          let elapsed = 0;
          timer = setInterval(() => {
            $("#record-timer").textContent = `Recording · ${++elapsed}s`;
            if (elapsed >= 30 && recording.state === "recording")
              recording.stop();
          }, 1000);
        } else {
          const video = $("#camera-preview"),
            canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d").drawImage(video, 0, 0);
          canvas.toBlob(
            async (blob) => {
              await addPhoto(
                view,
                new File([blob], "camera-photo.jpg", { type: "image/jpeg" }),
              );
              modal.close();
            },
            "image/jpeg",
            0.9,
          );
        }
      };
    } catch (e) {
      cameraStream?.getTracks().forEach((t) => t.stop());
      toast(
        "Camera unavailable. Allow camera access or upload a file instead.",
      );
    }
  }
  const statusBox = $("#analysis-status"),
    startButton = $("#start-analysis");
  function status(message, error = false) {
    const box = statusBox;
    if (!box?.isConnected) return;
    box.innerHTML = error
      ? `<div class="notice error">${esc(message)}</div>`
      : `<div class="progress"><span class="spinner"></span><div><strong>${esc(message)}</strong><small>Your upload is saved. You can keep this page open while the server processes it.</small></div></div>`;
  }
  async function watch(job, pending) {
    busy = true;
    if (startButton.isConnected) startButton.disabled = true;
    let failures = 0;
    try {
      while (job.state !== "done" && job.state !== "failed") {
        status(job.progress || "Analysis in progress");
        await new Promise((r) => setTimeout(r, 2000));
        try {
          job = await request(key, `job?id=${encodeURIComponent(job.id)}`);
          failures = 0;
        } catch (e) {
          if (++failures > 4) throw e;
          status("Reconnecting to your analysis…");
        }
      }
      if (job.state === "failed") throw new Error(job.error);
      const report = job.result;
      for (const [v, photo] of Object.entries(pending.photos || {}))
        await localPut(`${key}:media:${report.id}:${v}`, photo.data);
      if (pending.video)
        await localPut(`${key}:media:${report.id}:video`, pending.video);
      await localPut(`${key}:pending`, null);
      await onComplete(report, pending.client);
      toast("Assessment saved. Review the evidence and any capture warnings.");
    } catch (e) {
      status(e.message, true);
      await localPut(`${key}:pending`, null);
    } finally {
      busy = false;
      if (startButton.isConnected) startButton.disabled = false;
    }
  }
  $("#start-analysis").onclick = async () => {
    if (busy) return;
    draft.name = $("#capture-name").value.trim();
    draft.goal = $("#capture-goal").value.trim();
    if (!draft.name)
      return toast("Enter the client’s name to keep assessments together.");
    if (kind === "photo" && !Object.keys(draft.photos).length)
      return toast("Add at least one photograph to begin.");
    if (kind === "movement" && !draft.video)
      return toast("Add a movement video to begin.");
    busy = true;
    $("#start-analysis").disabled = true;
    status("Saving your captures and starting analysis…");
    try {
      const client = {
        id: draft.client_id || id(),
        name: draft.name,
        goal: draft.goal,
      };
      draft.client_id = client.id;
      await persist();
      await save("clients", {
        ...(state.clients.find((c) => c.id === client.id) || {}),
        ...client,
      });
      const pending = {
        photos: kind === "photo" ? draft.photos : {},
        video: kind === "movement" ? draft.video : null,
        client,
      };
      let job;
      if (kind === "photo")
        job = await request(key, "analyse", {
          method: "POST",
          body: {
            client,
            photos: Object.entries(draft.photos).map(([view, p]) => ({
              view,
              image: p.data,
            })),
            mode: draft.mode,
            include_3d: draft.include_3d !== false,
            class_scan: !!draft.class_scan,
          },
        });
      else {
        const query = new URLSearchParams({
          client_id: client.id,
          client_name: client.name,
          view: draft.view,
          protocol: draft.protocol,
        });
        job = await request(key, `video?${query}`, {
          method: "POST",
          body: draft.video,
          headers: {
            "X-Filename": encodeURIComponent(draft.video.name || "clip.webm"),
          },
          timeout: 120000,
        });
      }
      pending.job_id = job.id;
      await localPut(`${key}:pending`, pending);
      await watch(job, pending);
    } catch (e) {
      status(e.message, true);
      busy = false;
      $("#start-analysis").disabled = false;
    }
  };
  renderInputs();
  const pending = await localGet(`${key}:pending`);
  if (pending?.job_id)
    watch(
      {
        id: pending.job_id,
        state: "running",
        progress: "Reconnecting to your saved analysis",
      },
      pending,
    );
}
