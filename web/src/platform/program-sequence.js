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

export function reorderStep(steps, uid, offset) {
  const from = steps.findIndex((step) => step._uid === uid);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= steps.length) return steps;
  const target = steps[to];
  const section = target.section || target.detail?.section || target.phase || "Practice";
  const moved = { ...steps[from], detail: { ...(steps[from].detail || {}) } };
  if (moved.type === "note") moved.section = section;
  else moved.detail.section = section;
  const reordered = [...steps];
  reordered[from] = target;
  reordered[to] = moved;
  return reordered;
}

export const removeStep = (steps, uid) => steps.filter((step) => step._uid !== uid);
