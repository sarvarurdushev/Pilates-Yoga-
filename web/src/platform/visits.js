// A capture can create a visit record before any exercises are logged. Link by
// analysis ID only: sharing a reservation does not make two captures the same visit.
export function visitsForClient(client) {
  const analyses = Array.isArray(client.analyses) ? client.analyses : [];
  const sessions = Array.isArray(client.sessions) ? client.sessions : [];
  const byId = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  const linked = new Set();
  const visits = sessions.map((session) => {
    const analysis = byId.get(session.analysis_id) || null;
    if (analysis) linked.add(analysis.id);
    return {
      session,
      analysis,
      occurredAt: analysis?.created_at || session.performed_at,
      exerciseCount: Array.isArray(session.completed) ? session.completed.length : 0,
    };
  });
  for (const analysis of analyses) {
    if (!linked.has(analysis.id))
      visits.push({ session: null, analysis, occurredAt: analysis.created_at, exerciseCount: 0 });
  }
  return visits.sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")));
}

export function visitPracticeLabel(visit) {
  if (visit.exerciseCount) return `${visit.exerciseCount} movement${visit.exerciseCount === 1 ? "" : "s"} logged`;
  return visit.analysis ? "No exercises logged for this assessment" : "No exercises logged";
}

export function recordedByLabel(analysis) {
  const recorder = analysis?.detail?.recorded_by;
  if (!recorder || typeof recorder !== "object" || !recorder.name) return "Not recorded";
  const role = typeof recorder.role === "string" && recorder.role
    ? recorder.role[0].toUpperCase() + recorder.role.slice(1)
    : "";
  return role ? `${recorder.name} · ${role}` : recorder.name;
}
