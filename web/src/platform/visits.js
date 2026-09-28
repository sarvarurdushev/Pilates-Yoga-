// A capture can create a visit record before any exercises are logged. Link by
// analysis ID only: sharing a reservation does not make two captures the same visit.
export function visitsForClient(client) {
  const analyses = Array.isArray(client.analyses) ? client.analyses : [];
  const sessions = Array.isArray(client.sessions) ? client.sessions : [];
  const byId = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  const linked = new Set();
  const visits = sessions.map((session) => {
    const ids = [...new Set([
      ...(Array.isArray(session.analysis_ids) ? session.analysis_ids : []),
      session.analysis_id,
    ].filter(Boolean))];
    const captures = ids.map((id) => byId.get(id)).filter(Boolean)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    captures.forEach((capture) => linked.add(capture.id));
    return {
      session,
      analyses: captures,
      analysis: captures[0] || null,
      occurredAt: session.performed_at || captures[0]?.created_at,
      exerciseCount: Array.isArray(session.completed) ? session.completed.length : 0,
    };
  });
  for (const analysis of analyses) {
    if (!linked.has(analysis.id))
      visits.push({ session: null, analyses: [analysis], analysis, occurredAt: analysis.created_at, exerciseCount: 0 });
  }
  return visits.sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")));
}

export function visitPracticeLabel(visit) {
  if (visit.exerciseCount) return `${visit.exerciseCount} movement${visit.exerciseCount === 1 ? "" : "s"} logged`;
  return (visit.analyses?.length || visit.analysis) ? "No exercises logged for this assessment" : "No exercises logged";
}

export function recordedByLabel(analysis) {
  const recorder = analysis?.detail?.recorded_by;
  if (!recorder || typeof recorder !== "object" || !recorder.name) return "Not recorded";
  const role = typeof recorder.role === "string" && recorder.role
    ? recorder.role[0].toUpperCase() + recorder.role.slice(1)
    : "";
  return role ? `${recorder.name} · ${role}` : recorder.name;
}

// A visit is linked by stored IDs, never by proximity in time or a matching
// reservation alone. Scan notes can join through their exact scan ID only when
// they do not claim a different assessment.
export function visitConnections(client, visit, revisions = []) {
  const analysisIds = new Set((visit.analyses || (visit.analysis ? [visit.analysis] : []))
    .map((analysis) => analysis.id));
  const scans = (client.scans || []).filter((scan) => analysisIds.has(scan.analysis_id));
  const scanIds = new Set(scans.map((scan) => scan.id));
  const connected = (item) => Boolean(analysisIds.size && (
    analysisIds.has(item.analysis_id) ||
    (!item.analysis_id && item.scan_id && scanIds.has(item.scan_id))
  ));
  const notes = (client.notes || []).filter(connected);
  const observations = (client.observations || []).filter(connected);
  const assignments = (client.program_history || []).filter((assignment) =>
    analysisIds.has(assignment.analysis_id));
  const programChanges = revisions.filter((revision) =>
    analysisIds.has(revision.source_id) && revision.source_kind === "analysis");
  const regions = [...new Set([
    ...notes.map((note) => note.region_id),
    ...observations.map((observation) => observation.region_id),
    ...scans.map((scan) => scan.region_id),
  ].filter(Boolean))];
  return { scans, notes, observations, assignments, programChanges, regions };
}

export function visitTimeline(visit, connections) {
  const events = [];
  const add = (type, id, at, record, rank) => {
    if (at) events.push({ type, id, at, record, rank });
  };
  if (visit.session?.completed?.length || visit.session?.notes)
    add("practice", visit.session.id, visit.session.performed_at, visit.session, 0);
  for (const analysis of visit.analyses || (visit.analysis ? [visit.analysis] : []))
    add("capture", analysis.id, analysis.created_at, analysis, 1);
  for (const scan of connections.scans)
    add("scan", scan.id, scan.captured_at, scan, 2);
  const findingGroups = new Map();
  for (const observation of connections.observations) {
    const key = `${observation.analysis_id || observation.scan_id || observation.id}:${String(observation.created_at || "").slice(0, 10)}`;
    if (!findingGroups.has(key)) findingGroups.set(key, []);
    findingGroups.get(key).push(observation);
  }
  for (const [key, findings] of findingGroups)
    add("findings", key, findings.map((finding) => finding.created_at).sort()[0], findings, 3);
  for (const note of connections.notes)
    add("note", note.id, note.created_at, note, 4);
  for (const analysis of visit.analyses || (visit.analysis ? [visit.analysis] : [])) {
    if (analysis.detail?.reviewed_at)
      add("review", analysis.id, analysis.detail.reviewed_at, analysis, 5);
  }
  for (const assignment of connections.assignments)
    add("assignment", assignment.id, assignment.starts_on, assignment, 6);
  for (const revision of connections.programChanges)
    add("program", revision.id, revision.created_at, revision, 7);
  return events.sort((a, b) =>
    String(a.at).localeCompare(String(b.at)) || a.rank - b.rank ||
    String(a.id).localeCompare(String(b.id)));
}
