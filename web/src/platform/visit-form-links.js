// Visit choices are backed by saved session IDs. Dates or shared reservations
// are never used to join unrelated captures and feedback.
export function visitAnalysisIds(session) {
  return new Set([
    ...(Array.isArray(session?.analysis_ids) ? session.analysis_ids : []),
    session?.analysis_id,
  ].filter(Boolean));
}

export function sessionForAnalysis(client, analysisId) {
  if (!analysisId) return null;
  const matches = (client?.sessions || []).filter((session) =>
    visitAnalysisIds(session).has(analysisId));
  return matches.length === 1 ? matches[0] : null;
}

export function visitFormOptions(client) {
  return (client?.sessions || []).map((session) => {
    const ids = visitAnalysisIds(session);
    const names = (client.analyses || [])
      .filter((analysis) => ids.has(analysis.id))
      .map((analysis) => analysis.protocol || analysis.kind || "Assessment");
    const stamp = new Date(session.performed_at || "");
    const when = Number.isFinite(stamp.getTime())
      ? stamp.toLocaleString([], { year: "numeric", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit" })
      : "Undated visit";
    return {
      id: session.id,
      name: `${when} · ${names.length ? names.join(" + ") : "Practice only"}`,
    };
  });
}

// A scan with a source assessment may be attached only to a visit that
// actually contains that assessment. More than one such visit can exist in
// imported data, so let the coach select the correct saved ID explicitly.
export function scanVisitLinkOptions(client, scan) {
  const matching = scan?.analysis_id
    ? new Set((client?.sessions || []).filter((session) =>
      visitAnalysisIds(session).has(scan.analysis_id)).map((session) => session.id))
    : null;
  return visitFormOptions(client).filter((visit) =>
    !matching || matching.has(visit.id));
}

export function initialVisitId(client, item = {}, route = new URLSearchParams(),
  analysisId = "", scanId = "") {
  const sessions = client?.sessions || [];
  const known = (id) => sessions.some((session) => session.id === id) ? id : "";
  // Opening an existing unlinked note must not silently move it to the visit
  // currently visible behind the editor.
  if (item.id) return known(item.session_id);
  const fromRoute = known(route.get("session"));
  if (fromRoute) return fromRoute;
  const scan = (client?.scans || []).find((entry) => entry.id === scanId);
  if (scan?.session_id && known(scan.session_id)) return scan.session_id;
  return sessionForAnalysis(client, analysisId || scan?.analysis_id)?.id || "";
}

export function compatibleAssessments(client, sessionId = "", scanId = "") {
  const session = (client?.sessions || []).find((entry) => entry.id === sessionId);
  if (sessionId && !session) return [];
  let allowed = session ? visitAnalysisIds(session) : null;
  if (!session && scanId) {
    const scan = (client?.scans || []).find((entry) => entry.id === scanId);
    if (scan) {
      const scanSession = scan.session_id
        ? (client?.sessions || []).find((entry) => entry.id === scan.session_id)
        : sessionForAnalysis(client, scan.analysis_id);
      allowed = scanSession ? visitAnalysisIds(scanSession)
        : scan.analysis_id ? new Set([scan.analysis_id])
          : scan.session_id ? new Set() : null;
    }
  }
  return (client?.analyses || []).filter((analysis) =>
    !allowed || allowed.has(analysis.id));
}

export function compatibleScans(client, sessionId = "", analysisId = "") {
  const session = (client?.sessions || []).find((entry) => entry.id === sessionId);
  if (sessionId && !session) return [];
  const assessmentSession = sessionForAnalysis(client, analysisId);
  const target = session || assessmentSession;
  const allowed = target ? visitAnalysisIds(target) : null;
  return (client?.scans || []).filter((scan) => {
    if (target && scan.session_id && scan.session_id !== target.id) return false;
    if (target && !scan.session_id && !scan.analysis_id) return false;
    if (allowed && scan.analysis_id && !allowed.has(scan.analysis_id))
      return false;
    if (!target && analysisId && scan.analysis_id !== analysisId) return false;
    return true;
  });
}

export function compatibleFindings(client, sessionId = "", analysisId = "") {
  const session = (client?.sessions || []).find((entry) => entry.id === sessionId);
  if (sessionId && !session) return [];
  const allowed = session ? visitAnalysisIds(session) : null;
  return (client?.observations || []).filter((finding) =>
    (!allowed || allowed.has(finding.analysis_id)) &&
    (!analysisId || finding.analysis_id === analysisId));
}

// Feedback may be shared with a student. Its program link must therefore come
// from that student's assigned plans, rather than the coach's wider library.
export function assignedProgramOptions(client) {
  return [...new Map([
    ...(client?.program_history || []), ...(client?.programs || []),
  ]
    .filter((assignment) => assignment.program_id)
    .map((assignment) => [assignment.program_id, {
      id: assignment.program_id,
      name: assignment.name || "Assigned program",
    }])).values()];
}
