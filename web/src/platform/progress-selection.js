// Choose a featured measurement only when its recorded signal describes the
// selected body area. Keep every raw measurement available in source reports.
const signal = (metric) => String(metric || "").split(":").slice(1).join(":") || String(metric || "");
const paired = /^(left|right|both)_(shoulder|elbow|wrist|hip|knee|ankle)$/;

export function targetMetricRelevance(metric, regionIds = []) {
  const key = signal(metric);
  let best = 0;
  for (const region of regionIds.filter(Boolean)) {
    let value = 0;
    const joint = paired.exec(region);
    if (joint) {
      const sides = joint[1] === "both" ? ["left", "right"] : [joint[1]];
      if (sides.some((side) => key.startsWith(`${side}_${joint[2]}_`)))
        value = key.endsWith("_rom") ? 3 : 2;
      if (joint[2] === "knee" && sides.some((side) => key === `${side}_knee_deviation`))
        value = 3;
    } else if (region === "head" && /^(forward_head|head_lateral_tilt)$/.test(key)) value = 3;
    else if (["thorax", "lumbar"].includes(region) &&
      /^(trunk_lean_(lateral|sagittal)|trunk_inclination_(rom|tempo_cv|rep_rom_sd|repetitions))$/.test(key))
      value = key.endsWith("_rom") || key.startsWith("trunk_lean_") ? 3 : 2;
    else if (region === "pelvis") {
      if (/^(pelvic_obliquity|sagittal_pelvic_tilt)$/.test(key)) value = 3;
      else if (/^(left|right)_hip_rom$/.test(key)) value = 2;
    }
    best = Math.max(best, value);
  }
  return best;
}

export function informativeMetric(metric, rows = []) {
  const values = rows.map((row) => Number(row.value)).filter(Number.isFinite);
  if (!values.length) return false;
  const key = signal(metric);
  if (key.endsWith("_rom") && values.every((value) => Math.abs(value) <= 0.5))
    return false;
  if (key.endsWith("_repetitions") && values.every((value) => value <= 0))
    return false;
  return true;
}

export function preferredProgressMetric(names, rows, regionIds = []) {
  const informative = names.filter((name) => informativeMetric(name, rows.filter((row) => row.metric === name)));
  if (!informative.length) return "";
  const score = (name) => {
    const matching = rows.filter((row) => row.metric === name);
    const values = matching.map((row) => Number(row.value)).filter(Number.isFinite);
    const variation = values.length ? Math.max(...values) - Math.min(...values) : 0;
    return targetMetricRelevance(name, regionIds) * 100 +
      (signal(name).endsWith("_rom") ? 20 : 0) +
      (variation > 0.5 ? 10 : 0);
  };
  return [...informative].sort((a, b) => score(b) - score(a))[0] || "";
}

// The API resolves each compact index row against the archived selected person.
// Confidence is saved per metric/signal or recovered from its archived frame scores, never guessed.
// Person IDs remain capture-local and never assert identity across visits.
export function supportedProgressEvidence(row, source, clientId) {
  const evidence = row.evidence;
  const [view, ...parts] = String(row.metric || "").split(":");
  const metricId = parts.join(":");
  return Boolean(source && evidence?.authority === "saved_analysis" && evidence.version === 1 &&
    evidence.supported === true && source.status === "complete" &&
    source.student_id === clientId && row.student_id === clientId &&
    evidence.analysis_id === row.analysis_id && source.id === row.analysis_id &&
    evidence.student_id === clientId && evidence.kind === source.kind &&
    ["posture", "movement"].includes(source.kind) &&
    typeof source.protocol === "string" && source.protocol.trim() &&
    evidence.protocol === source.protocol && evidence.demo === Boolean(source.demo) &&
    Boolean(row.demo) === Boolean(source.demo) &&
    evidence.recorded_at === source.created_at && row.recorded_at === source.created_at &&
    Number.isFinite(Date.parse(row.recorded_at || "")) &&
    evidence.view === view && metricId && evidence.metric_id === metricId &&
    typeof evidence.person_id === "string" && evidence.person_id.trim() &&
    evidence.person_scope === "capture_local" &&
    ["single_suitable", "reviewed"].includes(evidence.selection) &&
    (evidence.selection !== "reviewed" ||
      String(source.detail?.selected_people?.[view]) === evidence.person_id) &&
    ["measured", "estimated", "available"].includes(evidence.status) &&
    (source.kind === "posture" ? evidence.confidence_basis === "saved_metric" :
      ["saved_signal", "saved_accepted_frame_scores"].includes(evidence.confidence_basis)) &&
    (evidence.confidence_basis !== "saved_accepted_frame_scores" ||
      Number.isInteger(evidence.confidence_sample_count) && evidence.confidence_sample_count > 0) &&
    Number.isFinite(evidence.confidence) && evidence.confidence >= 0.65 && evidence.confidence <= 1 &&
    Number.isFinite(row.value) && evidence.value === row.value &&
    typeof row.unit === "string" && row.unit.trim() && evidence.unit === row.unit);
}

export function comparableProgressSeries(client, includeMetric = () => true) {
  const sources = new Map((client.analyses || []).map((analysis) => [analysis.id, analysis]));
  const groups = new Map();
  const indexed = new Set();
  for (const row of client.progress || []) {
    const source = sources.get(row.analysis_id);
    if (!supportedProgressEvidence(row, source, client.id) || !includeMetric(row.metric)) continue;
    const evidence = row.evidence;
    const key = [source.demo ? "demo" : "capture", source.kind, source.protocol,
      row.metric, row.unit, evidence.status, evidence.person_id].join("\u001f");
    const observation = [row.analysis_id, key].join("\u001f");
    if (indexed.has(observation)) continue;
    indexed.add(observation);
    if (!groups.has(key)) groups.set(key, {
      metric: row.metric, unit: row.unit, protocol: source.protocol,
      kind: source.kind, demo: Boolean(source.demo), status: evidence.status,
      person_id: evidence.person_id, person_scope: evidence.person_scope, rows: [],
    });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map((series) => {
    series.rows.sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at) ||
      String(a.analysis_id).localeCompare(String(b.analysis_id)));
    series.latest = series.rows.at(-1);
    series.previous = series.rows.at(-2) || null;
    series.informative = informativeMetric(series.metric, series.rows);
    return series;
  }).sort((a, b) =>
    Number(b.informative && b.rows.length > 1) - Number(a.informative && a.rows.length > 1) ||
    Date.parse(b.latest.recorded_at) - Date.parse(a.latest.recorded_at) ||
    b.rows.length - a.rows.length || a.metric.localeCompare(b.metric));
}

export function selectedProgressSeries(series, sourceAssessment = "") {
  return (sourceAssessment && series.find((group) =>
    group.rows.some((row) => row.analysis_id === sourceAssessment))) ||
    [...series].sort((a, b) => Date.parse(b.latest.recorded_at) - Date.parse(a.latest.recorded_at))[0] || null;
}
