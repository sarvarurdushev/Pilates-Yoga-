import { visitsForClient } from "./visits.js";

// These facts are display context, never an inferred assessment or a clinical conclusion.
export function programFirstScreenFacts(program, client, source) {
  const detail = program?.detail || {};
  const assignments = program?.assignments || [];
  const assigned = Boolean(client && (
    assignments.some((item) => item.student_id === client.id && item.active !== 0) ||
    (client.programs || []).some((item) => item.program_id === program?.id)
  ));
  const validSource = Boolean(client && source && detail.source_analysis_id === source.id &&
    source.student_id === client.id &&
    (!detail.source_student_id || detail.source_student_id === client.id));
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
