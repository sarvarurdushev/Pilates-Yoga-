import { comparableProgressSeries, targetMetricRelevance } from "./progress-selection.js";
import { metricCopy } from "./explain.js";

export function visitMetricLabel(metric = "") {
  const plain = String(metric).split(":").at(-1).replaceAll("_", " ").trim()
    .replace(/\brom\b/gi, "range of motion");
  return plain ? plain[0].toUpperCase() + plain.slice(1) : "Measurement";
}

// An at-a-glance visit measurement must come from the same archived evidence
// gate as Progress. A nearby date, matching protocol, or textual finding alone
// is not enough to manufacture a numeric comparison.
export function visitAtAGlance(client, visit, connections = {}) {
  const captures = visit.analyses || (visit.analysis ? [visit.analysis] : []);
  const ids = new Set(captures.map((capture) => capture.id));
  const targets = connections.regions || [];
  const candidate = comparableProgressSeries(client)
    .map((series) => ({
      series,
      rows: series.rows.filter((row) => ids.has(row.analysis_id)),
      relevance: targetMetricRelevance(series.metric, targets),
      firstRegionRelevance: targetMetricRelevance(series.metric, targets.slice(0, 1)),
    }))
    .filter((item) => item.rows.length)
    .sort((a, b) => b.firstRegionRelevance - a.firstRegionRelevance ||
      b.relevance - a.relevance ||
      Number(b.series.informative) - Number(a.series.informative) ||
      Date.parse(b.rows.at(-1).recorded_at) - Date.parse(a.rows.at(-1).recorded_at) ||
      a.series.metric.localeCompare(b.series.metric))[0];
  const row = candidate?.rows.at(-1) || null;
  const source = row ? captures.find((capture) => capture.id === row.analysis_id) : null;
  const position = row ? candidate.series.rows.findIndex((item) => item.analysis_id === row.analysis_id) : -1;
  const previous = position > 0 ? candidate.series.rows[position - 1] : null;
  const metricId = row?.evidence?.metric_id || "";
  const copy = row ? metricCopy({ id: metricId, name: metricId }) : null;
  const note = [...(connections.notes || [])]
    .filter((item) => item.created_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  return {
    capture: source || captures[0] || null,
    view: row?.evidence?.view || "",
    measurement: row ? {
      metric: metricId, value: row.value, unit: row.unit, status: row.evidence.status,
      meaning: copy.definition, interpretation: copy.why,
      sourceId: row.analysis_id, previous,
    } : null,
    note,
    regions: targets,
  };
}
