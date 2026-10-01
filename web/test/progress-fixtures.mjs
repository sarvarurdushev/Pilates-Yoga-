// API-shaped fixtures; these fields are derived from saved source reports in
// repository.client(), never from UI-generated confidence or default values.
export function withSavedProgressEvidence(client) {
  const id = client.id || "client";
  const analyses = (client.analyses || []).map((analysis) => ({
    student_id: id, status: "complete", detail: {},
    created_at: (client.progress || []).find((row) => row.analysis_id === analysis.id)?.recorded_at,
    ...analysis,
  }));
  const sources = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  return {...client, id, analyses, progress: (client.progress || []).map((row) => {
    const source = sources.get(row.analysis_id);
    const [view, ...parts] = String(row.metric || "").split(":");
    const progress = {student_id: id, demo: Number(Boolean(source?.demo)), ...row};
    return {...progress, evidence: {
      authority: "saved_analysis", version: 1, supported: true,
      analysis_id: row.analysis_id, student_id: id, kind: source?.kind,
      protocol: source?.protocol, demo: Boolean(source?.demo), recorded_at: source?.created_at,
      view, metric_id: parts.join(":"), person_id: "1", person_scope: "capture_local",
      selection: "single_suitable", status: "estimated", confidence: 0.9,
      value: row.value, unit: row.unit, confidence_basis: source?.kind === "posture" ? "saved_metric" : "saved_signal", reason: "",
      ...row.evidence,
    }};
  })};
}
