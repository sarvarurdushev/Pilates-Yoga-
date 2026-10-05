import { visitsForClient } from "./visits.js";

// An assignment can carry the assessment that led to this client's plan even when
// the reusable program itself has no client-specific source in its detail.
export function programSourceId(program, client) {
  if (!client) return null;
  const detail = program?.detail || {};
  // Older reusable programs can carry a source without source_student_id. The
  // selected client's loaded assessments, not the absence of an owner field,
  // establish whether that source belongs to this client's plan context.
  const ownsDetailSource = (client.analyses || []).some((analysis) =>
    analysis.id === detail.source_analysis_id && (!analysis.student_id || analysis.student_id === client.id));
  if (detail.source_analysis_id && ownsDetailSource &&
      (!detail.source_student_id || detail.source_student_id === client.id) &&
      (!detail.student_id || detail.student_id === client.id))
    return detail.source_analysis_id;
  const assignments = (program?.assignments || []).filter((item) => item.student_id === client.id);
  const assignment = assignments.find((item) => item.active !== 0) || assignments.at(-1);
  return assignment?.analysis_id || null;
}

// These facts are display context, never an inferred assessment or a clinical conclusion.
export function programFirstScreenFacts(program, client, source) {
  const assignments = program?.assignments || [];
  const assigned = Boolean(client && (
    assignments.some((item) => item.student_id === client.id && item.active !== 0) ||
    (client.programs || []).some((item) => item.program_id === program?.id)
  ));
  const validSource = Boolean(client && source && programSourceId(program, client) === source.id &&
    source.student_id === client.id);
  const visit = validSource ? visitsForClient(client).find((item) =>
    item.analyses.some((analysis) => analysis.id === source.id)) : null;
  const views = validSource ? [...new Set((source.result?.views || []).map((item) => item.view).filter(Boolean))] : [];
  return {
    clientName: client?.name || null,
    assigned,
    source: validSource ? source : null,
    sourceVisit: visit || null,
    views,
  };
}

export function progressFirstScreenFacts(client, rows, metric, events = []) {
  const latest = rows?.at(-1) || null;
  const candidate = latest && (client?.analyses || []).find((item) => item.id === latest.analysis_id);
  const source = candidate && (!candidate.student_id || candidate.student_id === client?.id) ? candidate : null;
  const visits = client ? visitsForClient(client) : [];
  const sourceVisit = source ? visits.find((item) =>
    item.analyses.some((analysis) => analysis.id === source.id)) || null : null;
  const view = metric?.includes(":") ? metric.split(":")[0] : null;
  const validVisit = (event) => visits.some((visit) =>
    event.visit?.session?.id ? visit.session?.id === event.visit.session.id :
      event.visit?.analyses?.length && event.visit.analyses.some((analysis) =>
        visit.analyses.some((own) => own.id === analysis.id)));
  const decision = [...events].reverse().find((event) =>
    validVisit(event) && (!event.record?.student_id || event.record.student_id === client?.id)) || null;
  return { clientName: client?.name || null, latest, source, sourceVisit, view, decision };
}
