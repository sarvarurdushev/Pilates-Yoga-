// Compare saved program snapshots. Step row IDs are recreated on every save,
// so a unique exercise ID is the only safe identity for a prescription change.
const movements = (snapshot) => (snapshot?.steps || []).filter((step) => step?.exercise_id);
const notes = (snapshot) => (snapshot?.steps || []).filter((step) => step?.type === "note")
  .map((step) => [step.text, step.visibility, normalizedSection(step.section), normalizedSection(step.phase)].join("\u0000"));
const sequence = (snapshot) => (snapshot?.steps || []).map((step) => step?.type === "note"
  ? ["reminder", step.text, step.visibility, normalizedSection(step.section), normalizedSection(step.phase)]
  : ["movement", step.exercise_id]);
const label = (id) => String(id || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const value = (item) => item === null || item === undefined || item === "" ? "not recorded" : String(item);
const sentence = (text) => /[.!?]$/.test(text) ? text : `${text}.`;
const normalizedSection = (item) => String(item || "").trim().toLowerCase();
const stable = (item) => JSON.stringify(item, (_key, value) => value && !Array.isArray(value) && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const regionIds = (snapshot) => [...new Set((snapshot?.detail?.target_region_ids ||
  (snapshot?.region_id ? [snapshot.region_id] : [])).filter(Boolean))];

function countByExercise(steps) {
  const counts = new Map();
  for (const step of steps) counts.set(step.exercise_id, (counts.get(step.exercise_id) || 0) + 1);
  return counts;
}

function nameFor(id, before, after) {
  return after.find((step) => step.exercise_id === id)?.exercise_name ||
    before.find((step) => step.exercise_id === id)?.exercise_name || label(id) || "Movement";
}

function prescriptionChanges(before, after) {
  const fields = [
    ["sets", (step) => step.sets],
    ["repetitions", (step) => step.reps],
    ["duration", (step) => step.seconds, " s"],
    ["rest", (step) => step.rest, " s"],
    ["side", (step) => step.detail?.side || "Both"],
    ["resistance", (step) => step.detail?.resistance],
    ["phase", (step) => step.detail?.program_phase || "All phases"],
    ["section", (step) => step.detail?.section || step.phase || "Practice"],
  ];
  const changes = fields.flatMap(([name, getter, suffix = ""]) => {
    const oldValue = getter(before), newValue = getter(after);
    if (name === "section" && normalizedSection(oldValue) === normalizedSection(newValue)) return [];
    return value(oldValue) === value(newValue) ? [] :
      [`${name} ${value(oldValue)}${oldValue == null ? "" : suffix} → ${value(newValue)}${newValue == null ? "" : suffix}`];
  });
  const oldRegions = new Set(before.detail?.target_region_ids || []);
  const newRegions = new Set(after.detail?.target_region_ids || []);
  if ([...oldRegions].some((id) => !newRegions.has(id)) || [...newRegions].some((id) => !oldRegions.has(id)))
    changes.push("body targets changed");
  const detailGroups = [
    ["photos or videos", ["media"]],
    ["reference links", ["references"]],
    ["equipment", ["equipment"]],
    ["movement guidance", ["purpose", "why_assigned", "student_instructions", "coach_instructions", "coach_cue", "common_mistake", "success_criteria", "progression", "regression", "precautions"]],
  ];
  for (const [name, keys] of detailGroups)
    if (keys.some((key) => stable(before.detail?.[key]) !== stable(after.detail?.[key])))
      changes.push(`${name} changed`);
  if (stable(before.detail?.source) !== stable(after.detail?.source)) {
    const kind = after.detail?.source?.kind || before.detail?.source?.kind;
    changes.push(kind === "analysis" ? "source assessment changed" : "source record changed");
  }
  if (value(before.notes) !== value(after.notes)) changes.push("step note changed");
  const known = new Set(["side", "resistance", "program_phase", "section", "target_region_ids", "source", ...detailGroups.flatMap(([, keys]) => keys)]);
  const other = (step) => Object.fromEntries(Object.entries(step.detail || {}).filter(([key]) => !known.has(key)));
  if (stable(other(before)) !== stable(other(after))) changes.push("other movement details changed");
  return changes;
}

export function programVersionChanges(revision, previousRevision) {
  const current = revision?.snapshot;
  if (!current) return {kind: "missing", lines: ["This saved version has no readable plan snapshot."]};
  const after = movements(current);
  if (!previousRevision && Number(revision.version) === 1) {
    const phase = current.detail?.phase;
    return {kind: "initial", lines: [`Starting plan: ${after.length} movement${after.length === 1 ? "" : "s"}${phase ? ` in ${phase} phase` : ""}.`]};
  }
  if (!previousRevision?.snapshot || Number(previousRevision.version) !== Number(revision.version) - 1)
    return {kind: "missing", lines: ["The immediately preceding saved version is unavailable for comparison."]};

  const previous = previousRevision.snapshot;
  const before = movements(previous);
  const changes = [];
  const planFields = [
    ["Program name", previous.name, current.name],
    ["Goal", previous.goal, current.goal],
    ["Phase", previous.detail?.phase, current.detail?.phase],
    ["Status", previous.detail?.status, current.detail?.status],
    ["Sessions per week", previous.detail?.sessions_per_week, current.detail?.sessions_per_week],
    ["Planned weeks", previous.detail?.duration_weeks, current.detail?.duration_weeks],
    ["Description", previous.detail?.description, current.detail?.description],
    ["Start date", previous.detail?.start_date, current.detail?.start_date],
  ];
  for (const [name, oldValue, newValue] of planFields)
    if (value(oldValue) !== value(newValue)) changes.push(sentence(`${name}: ${value(oldValue)} → ${value(newValue)}`));

  const oldRegions = new Set(regionIds(previous));
  const newRegions = new Set(regionIds(current));
  const addedRegions = [...newRegions].filter((id) => !oldRegions.has(id));
  const removedRegions = [...oldRegions].filter((id) => !newRegions.has(id));
  if (addedRegions.length) changes.push(`Body target added: ${addedRegions.map(label).join(", ")}.`);
  if (removedRegions.length) changes.push(`Body target removed: ${removedRegions.map(label).join(", ")}.`);
  if (stable(previous.detail?.phases) !== stable(current.detail?.phases))
    changes.push("Scheduled phase weeks or goals changed.");
  if (stable(previous.detail?.target_explanations) !== stable(current.detail?.target_explanations))
    changes.push("Body-target coaching reasons changed.");
  if (value(previous.detail?.coach_notes) !== value(current.detail?.coach_notes))
    changes.push("Coach planning notes changed.");
  if (value(previous.location_id) !== value(current.location_id))
    changes.push("Program location changed.");
  const listedPlanDetail = new Set(["phase", "status", "sessions_per_week", "duration_weeks", "description", "start_date", "target_region_ids", "phases", "target_explanations", "coach_notes", "demo", "demo_history_for", "provenance"]);
  const extraPlanDetail = (snapshot) => Object.fromEntries(Object.entries(snapshot.detail || {}).filter(([key]) => !listedPlanDetail.has(key)));
  if (stable(extraPlanDetail(previous)) !== stable(extraPlanDetail(current)))
    changes.push("Other saved plan details changed; review both versions below.");

  const oldCounts = countByExercise(before), newCounts = countByExercise(after);
  const ids = [...new Set([...oldCounts.keys(), ...newCounts.keys()])];
  for (const id of ids) {
    const oldCount = oldCounts.get(id) || 0, newCount = newCounts.get(id) || 0;
    const name = nameFor(id, before, after);
    if (newCount > oldCount) changes.push(`${name}: ${newCount - oldCount} assignment${newCount - oldCount === 1 ? "" : "s"} added.`);
    if (newCount < oldCount) changes.push(`${name}: ${oldCount - newCount} assignment${oldCount - newCount === 1 ? "" : "s"} removed.`);
    if (oldCount === 1 && newCount === 1) {
      const differences = prescriptionChanges(
        before.find((step) => step.exercise_id === id),
        after.find((step) => step.exercise_id === id),
      );
      if (differences.length) changes.push(`${name}: ${differences.join("; ")}.`);
      const oldStep = before.find((step) => step.exercise_id === id);
      const newStep = after.find((step) => step.exercise_id === id);
      if (stable([oldStep.exercise_name, oldStep.exercise_category, oldStep.exercise_region_id, oldStep.exercise_detail]) !==
          stable([newStep.exercise_name, newStep.exercise_category, newStep.exercise_region_id, newStep.exercise_detail]))
        changes.push(`${name}: exercise library reference details changed.`);
    } else if (oldCount > 0 && newCount > 0) {
      // Duplicate assignments have no stable row identity between revisions.
      const oldRows = before.filter((step) => step.exercise_id === id);
      const newRows = after.filter((step) => step.exercise_id === id);
      const assignment = (step) => Object.fromEntries(Object.entries(step).filter(([key]) => !["id", "program_id", "position"].includes(key)));
      const oldAssignments = oldRows.map((step) => stable(assignment(step))).sort();
      const newAssignments = newRows.map((step) => stable(assignment(step))).sort();
      if (stable(oldAssignments) !== stable(newAssignments))
        changes.push(`${name}: repeated assignments or prescriptions changed; review the saved sequences below for each dose.`);
    }
  }

  const shared = ids.filter((id) => oldCounts.get(id) === 1 && newCounts.get(id) === 1);
  const oldOrder = before.filter((step) => shared.includes(step.exercise_id)).map((step) => step.exercise_id);
  const newOrder = after.filter((step) => shared.includes(step.exercise_id)).map((step) => step.exercise_id);
  const movementOrderChanged = JSON.stringify(oldOrder) !== JSON.stringify(newOrder);
  if (movementOrderChanged) changes.push("The order of continuing movements changed.");
  if (JSON.stringify(notes(previous)) !== JSON.stringify(notes(current)))
    changes.push("Sequence reminders changed; review the saved sequences below.");
  const beforeSequence = sequence(previous).map(stable);
  const afterSequence = sequence(current).map(stable);
  if (!movementOrderChanged && notes(previous).length &&
      stable([...beforeSequence].sort()) === stable([...afterSequence].sort()) &&
      stable(beforeSequence) !== stable(afterSequence))
    changes.push("The placement of practice reminders changed.");
  if (!changes.length) changes.push("No plan, sequence or prescription change is recorded between these versions.");
  return {kind: changes.length === 1 && changes[0].startsWith("No plan") ? "unchanged" : "changed", lines: changes};
}
