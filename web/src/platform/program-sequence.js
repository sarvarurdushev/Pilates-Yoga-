/** Sequence operations shared by custom and library movements in the designer. */
export function exerciseStep(exercise, { uid, section = "Practice", targets = [], analysisId = "" }) {
  if (!uid || !exercise?.id) throw Error("A movement needs a saved exercise and card identity.");
  return {
    _uid: uid,
    exercise_id: exercise.id,
    sets: 1,
    reps: 8,
    seconds: 60,
    rest: 20,
    phase: section,
    notes: "",
    detail: {
      section,
      student_instructions: exercise.detail?.instructions || "",
      target_region_ids: targets,
      ...(analysisId ? { source: { kind: "analysis", id: analysisId } } : {}),
    },
  };
}

export function configureStep(step, prescription) {
  if (!step?._uid) throw Error("Choose a movement card before configuring it.");
  return {
    ...step,
    sets: Number(prescription.sets),
    reps: Number(prescription.reps),
    seconds: Number(prescription.seconds),
    rest: Number(prescription.rest),
    notes: prescription.notes || "",
    detail: { ...(step.detail || {}), ...(prescription.detail || {}) },
  };
}

const sectionOf = (step) => step.section || step.detail?.section || step.phase || "Practice";

/** Keep the stored order aligned with the order the sectioned editor displays. */
export function orderedStepsBySection(steps, sections = []) {
  const names = [...new Set([...sections, ...steps.map(sectionOf)])];
  return names.flatMap((name) => steps.filter((step) => sectionOf(step) === name));
}

function inSection(step, section) {
  const moved = { ...step, detail: { ...(step.detail || {}) } };
  if (moved.type === "note") moved.section = section;
  else moved.detail.section = section;
  return moved;
}

export function reorderStep(steps, uid, offset, sections = []) {
  const ordered = orderedStepsBySection(steps, sections);
  const from = ordered.findIndex((step) => step._uid === uid);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= ordered.length) return ordered;
  const target = ordered[to];
  const moved = inSection(ordered[from], sectionOf(target));
  const reordered = [...ordered];
  reordered[from] = target;
  reordered[to] = moved;
  return reordered;
}

export function moveStepBefore(steps, uid, targetUid, sections = []) {
  const ordered = orderedStepsBySection(steps, sections);
  const from = ordered.findIndex((step) => step._uid === uid);
  const target = ordered.find((step) => step._uid === targetUid);
  if (from < 0 || !target || uid === targetUid) return ordered;
  const [source] = ordered.splice(from, 1);
  ordered.splice(ordered.findIndex((step) => step._uid === targetUid), 0,
    inSection(source, sectionOf(target)));
  return ordered;
}

export function moveStepToSectionEnd(steps, uid, section, sections = []) {
  const ordered = orderedStepsBySection(steps, sections);
  const from = ordered.findIndex((step) => step._uid === uid);
  if (from < 0 || !sections.includes(section)) return ordered;
  const [source] = ordered.splice(from, 1);
  ordered.push(inSection(source, section));
  return orderedStepsBySection(ordered, sections);
}

export const removeStep = (steps, uid) => steps.filter((step) => step._uid !== uid);
