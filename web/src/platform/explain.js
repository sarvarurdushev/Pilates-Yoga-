import { esc, num } from "./core.js";

export const cameraLabels = {
  front: "Front view",
  rear: "Back view",
  back: "Back view",
  side_left: "Left side view",
  side_right: "Right side view",
  three_quarter: "45° view",
};

export function captureSummary(kind, protocol = "") {
  if (kind === "movement") return "A recorded movement was analyzed frame by frame.";
  if (String(protocol).trim().toLowerCase() === "standing posture")
    return "A standing posture photograph was analyzed for visible landmark positions.";
  return "A single still pose was analyzed for visible landmark positions. A photograph does not measure movement range or repetitions.";
}

export function recordedByLabel(item, coaches = []) {
  const recorder = item?.detail?.recorded_by;
  if (recorder?.name) {
    const role = recorder.role === "coach" ? "coach" : recorder.role === "admin" ? "administrator" : "studio member";
    return `${recorder.name} · ${role}`;
  }
  const coach = coaches.find((person) => person.id === item?.coach_id);
  return coach ? `${coach.name} · coach` : "Studio member not identified";
}

export function cameraPurpose(view, protocol = "") {
  const action = String(protocol).toLowerCase();
  if (/squat|hinge|lunge/.test(action) && String(view).startsWith("side_"))
    return "This side view helps show the projected hip, knee and trunk bend during the movement.";
  if (/shoulder|arm|overhead|flexion/.test(action) && view === "front")
    return "This front view helps compare the visible left and right arm paths.";
  if (view === "front")
    return "This view helps compare left and right landmark positions in the image.";
  if (view === "rear" || view === "back")
    return "This view helps compare visible left and right landmarks from behind.";
  if (String(view).startsWith("side_"))
    return "This side view helps show projected forward and backward position and joint bend.";
  return "This view records projected landmarks from this camera position; depth along the lens is not measured by the image alone.";
}

export function cameraGuide(view, protocol = "") {
  const positions = {
    front: [80, 79], rear: [80, 11], back: [80, 11],
    side_left: [15, 45], side_right: [145, 45], three_quarter: [139, 74],
  };
  const [cx, cy] = positions[view] || positions.front;
  return `<figure class="camera-guide" aria-label="Camera position: ${esc(cameraLabels[view] || view)}"><svg viewBox="0 0 160 90" role="img" aria-label="Camera facing the person from the ${esc(cameraLabels[view] || view)}"><circle cx="80" cy="45" r="19" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="80" cy="37" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M70 54q10-12 20 0M80 10v14M80 66v14M45 45h16M99 45h16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M${cx} ${cy}l${cx < 80 ? -5 : 5} -4v8z" fill="currentColor"/><circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="currentColor" stroke-width="2"/></svg><figcaption><strong>${esc(cameraLabels[view] || String(view).replaceAll("_", " "))}</strong><span>${esc(cameraPurpose(view, protocol))}</span></figcaption></figure>`;
}

const definitions = {
  shoulder_tilt: [
    "Angle of the line between the two visible shoulder landmarks relative to horizontal.",
    "It describes this photograph's shoulder-line position; it does not diagnose a shoulder condition.",
  ],
  pelvic_obliquity: [
    "Angle of the line between the two visible hip landmarks relative to horizontal.",
    "Compare captures made with the same camera position and stance before interpreting change.",
  ],
  head_lateral_tilt: [
    "Angle of the visible ear line relative to horizontal.",
    "The reading can change with head position and camera tilt.",
  ],
  trunk_lean_lateral: [
    "Projected side-to-side angle of the shoulder-to-hip axis in the image.",
    "It helps describe this pose; it is not a measure of spinal curvature.",
  ],
  trunk_lean_sagittal: [
    "Projected forward or backward angle of the shoulder-to-hip axis.",
    "It requires a suitable side view and does not measure vertebral alignment.",
  ],
  forward_head: [
    "Visible head offset relative to torso height in a side view.",
    "This is a 2D position proxy; camera perspective affects it.",
  ],
};
export function metricCopy(metric = {}) {
  if (definitions[metric.id]) {
    const [definition, why] = definitions[metric.id];
    return { definition, why };
  }
  const name = String(metric.name || metric.id || "measurement").toLowerCase();
  if (name.includes("rom") || name.includes("range of motion") || name.includes(" range"))
    return {
      definition: "Difference between the largest and smallest smoothed, accepted projected joint angles during this clip.",
      why: "It describes the range seen by this camera, not the full anatomical joint range.",
    };
  if (name.includes("velocity") || name.includes("speed"))
    return {
      definition: "How quickly the measured projected angle changed between accepted video frames.",
      why: "Frame gaps and camera motion affect this estimate; use it to inspect movement timing.",
    };
  if (name.includes("acceleration"))
    return {
      definition: "How quickly estimated angular speed changed between accepted video frames.",
      why: "This is a timing signal, not a measure of force or muscle activation.",
    };
  if (name.includes("shoulder") || name.includes("hip") || name.includes("knee") || name.includes("elbow"))
    return {
      definition: "A projected angle or offset calculated from visible pose landmarks in this camera view.",
      why: "It can support a repeatable visual comparison, but it does not establish tissue function or a diagnosis.",
    };
  return {
    definition: "A measurement calculated from the accepted visible pose landmarks for this capture.",
    why: "Compare the same protocol and camera view; perspective can change the reading.",
  };
}

export function comparisonText(current, previous, unit = "") {
  if (!Number.isFinite(current)) return "A reliable current value was unavailable.";
  if (!Number.isFinite(previous)) return "No earlier comparable measurement is available.";
  const delta = current - previous;
  return `Previous ${num(previous, unit)} → current ${num(current, unit)}; measured change ${delta > 0 ? "+" : ""}${num(delta, unit)}. A change alone does not show benefit or harm.`;
}

export function explainedChart({
  title, definition, why, notice, current, previous, comparisonNote = null, unit = "", source,
  chart = "", technical = "", regionLink = "", sessionLink = "",
}) {
  const value = Number.isFinite(current) ? num(current, unit) : "Unavailable";
  return `<article class="explained-chart panel"><header><p class="eyebrow">MEASUREMENT</p><h3>${esc(title)}</h3></header><div class="explained-chart-value"><strong>${esc(value)}</strong><span>${esc(comparisonNote ?? comparisonText(current, previous, unit))}</span></div><p><strong>What this measures</strong> ${esc(definition)}</p><p><strong>What to notice</strong> ${esc(notice || "Look for changes across comparable captures, not a single isolated number.")}</p><details><summary>What does this mean?</summary><p>${esc(why)}</p><p>Source: ${esc(source || "Visible pose landmarks")}</p></details>${chart}${regionLink || sessionLink ? `<div class="actions">${regionLink}${sessionLink}</div>` : ""}${technical ? `<details><summary>View technical data</summary>${technical}</details>` : ""}</article>`;
}
