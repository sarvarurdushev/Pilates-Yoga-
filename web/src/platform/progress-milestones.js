import { visitsForClient, visitConnections } from "./visits.js";

// Dates order the story; stored visit/capture IDs decide what belongs in it.
// A nearby date or a shared reservation must never manufacture a relationship.
export function progressMilestones(client, rows, revisions = [], relevant = () => true) {
  const sourceIds = new Set(rows.map((row) => row.analysis_id).filter(Boolean));
  // A coach may revise a plan during a practice-only visit between captures.
  // Keep that exact client visit in the story even when it has no measurement.
  const visits = visitsForClient(client);
  const sessionIds = new Set(visits.map((visit) => visit.session?.id).filter(Boolean));
  const connectedNotes = new Map();
  const noteVisits = new Map();
  for (const visit of visits) {
    for (const note of visitConnections(client, visit).notes) {
      if (note.student_id && note.student_id !== client.id) continue;
      if (!relevant(note.region_id)) continue;
      connectedNotes.set(note.id, note);
      noteVisits.set(note.id, visit);
    }
  }
  const sourceVisit = (record) => record.session_id
    ? visits.find((visit) => visit.session?.id === record.session_id)
    : visits.find((visit) => visit.analyses.some((analysis) =>
      analysis.id === record.analysis_id || analysis.id === record.source_id));
  const events = [...connectedNotes.values()].map((note) => ({
    type: "feedback", id: note.id, at: note.created_at, record: note,
    visit: noteVisits.get(note.id),
  }));
  for (const revision of revisions) {
    const detail = revision.snapshot?.detail || {};
    const owner = detail.student_id || detail.source_student_id;
    if (owner && owner !== client.id) continue;
    const targets = [revision.snapshot?.region_id, ...(detail.target_region_ids || [])].filter(Boolean);
    if (targets.length && !targets.some(relevant)) continue;
    const noteSource = ["coach_observation", "client_feedback"].includes(revision.source_kind)
      ? connectedNotes.get(revision.source_id) : null;
    const linkedVisit = revision.session_id
      ? visits.find((visit) => visit.session?.id === revision.session_id) : null;
    const sourceMatchesVisit = revision.source_kind === "analysis"
      ? Boolean(revision.source_id && linkedVisit?.analyses.some((analysis) => analysis.id === revision.source_id))
      : ["coach_observation", "client_feedback"].includes(revision.source_kind)
        ? Boolean(revision.source_id && noteVisits.get(revision.source_id) === linkedVisit)
        : true;
    const connected = revision.session_id
      ? sessionIds.has(revision.session_id) && sourceMatchesVisit
      : (revision.source_kind === "analysis" && sourceIds.has(revision.source_id)) || Boolean(noteSource);
    if (!connected) continue;
    events.push({ type: "program", id: revision.id, at: revision.created_at,
      record: revision, visit: sourceVisit(revision) || noteVisits.get(noteSource?.id) });
  }
  const seen = new Set();
  return events.filter((event) => {
    const key = event.type + ":" + event.id;
    if (seen.has(key) || !Number.isFinite(Date.parse(event.at || ""))) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
    .map((event) => ({ ...event,
      nextMeasurement: rows.filter((row) => Date.parse(row.recorded_at) > Date.parse(event.at))
        .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))[0] || null,
    }));
}
