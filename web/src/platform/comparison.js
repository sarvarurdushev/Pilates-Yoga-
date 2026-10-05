// Comparisons only describe repeated observations from the same capture protocol.
// This module deliberately works from persisted evidence, not the order of a list.
const SUPPORTED_STATUSES = new Set(["measured", "estimated", "available"]);

function captureTime(analysis) {
  const time = Date.parse(analysis?.created_at || "");
  return Number.isFinite(time) ? time : null;
}

export function matchingPriorSummaries(current, summaries = []) {
  const time = captureTime(current);
  if (time == null) return [];
  return summaries.filter((candidate) =>
    candidate.id !== current.id &&
    candidate.student_id === current.student_id &&
    candidate.kind === current.kind &&
    candidate.protocol === current.protocol &&
    candidate.demo === current.demo &&
    captureTime(candidate) != null && captureTime(candidate) < time,
  ).sort((a, b) => captureTime(b) - captureTime(a) || String(b.id).localeCompare(String(a.id)));
}

export function selectedComparablePerson(analysis, cameraView) {
  const view = analysis?.result?.views?.find((entry) => entry.view === cameraView);
  const people = view?.report?.people || [];
  const suitable = people.filter((person) => person.suitable);
  const selected = analysis?.detail?.selected_people?.[cameraView];
  const person = selected != null
    ? suitable.find((candidate) => String(candidate.person_id) === String(selected))
    : people.length === 1 && suitable.length === 1 ? suitable[0] : null;
  return person ? { view, person } : null;
}

function measurement(person, kind, metricId) {
  if (kind === "movement") {
    const signal = person?.signals?.[metricId];
    return signal ? {
      id: metricId, name: metricId.replaceAll("_", " ") + " range", value: signal.rom,
      unit: signal.unit || "deg", status: signal.status,
      confidence: signal.confidence,
    } : null;
  }
  return person?.metrics?.find((metric) => metric.id === metricId) || null;
}

function supported(metric) {
  return !!metric && Number.isFinite(metric.value) &&
    SUPPORTED_STATUSES.has(metric.status) &&
    (!Number.isFinite(metric.confidence) || metric.confidence >= 0.65);
}

export function comparableMeasurements(currentPerson, priorPerson, kind) {
  if (!currentPerson?.suitable || !priorPerson?.suitable) return [];
  const ids = kind === "movement"
    ? Object.keys(currentPerson.signals || {})
    : (currentPerson.metrics || []).map((metric) => metric.id);
  return ids.map((id) => {
    const current = measurement(currentPerson, kind, id);
    const previous = measurement(priorPerson, kind, id);
    return supported(current) && supported(previous) &&
      current.unit === previous.unit && current.status === previous.status
      ? { id, name: current.name, unit: current.unit,
          current: current.value, previous: previous.value }
      : null;
  }).filter(Boolean);
}

export async function findComparableVisits(current, currentPerson, cameraView, summaries, load) {
  if (!currentPerson?.suitable) return [];
  const candidates = matchingPriorSummaries(current, summaries);
  const matches = [];
  // Bound concurrent record fetches on small hosted instances. Promise.all
  // preserves date order even if an older record responds first.
  for (let start = 0; start < candidates.length; start += 4) {
    const batch = await Promise.all(candidates.slice(start, start + 4).map(async (summary) => {
      const analysis = await load(summary).catch(() => null);
      if (!analysis || analysis.id !== summary.id ||
          analysis.student_id !== current.student_id ||
          analysis.kind !== current.kind ||
          analysis.protocol !== current.protocol ||
          analysis.demo !== current.demo ||
          captureTime(analysis) !== captureTime(summary)) return null;
      const selected = selectedComparablePerson(analysis, cameraView);
      if (!selected) return null;
      const metrics = comparableMeasurements(currentPerson, selected.person, current.kind);
      return metrics.length ? { analysis, view: selected.view, person: selected.person, metrics } : null;
    }));
    matches.push(...batch.filter(Boolean));
  }
  return matches;
}

export function nearestComparableMeasurement(visits, metricId) {
  for (const visit of visits) {
    const metric = visit.metrics.find((entry) => entry.id === metricId);
    if (metric) return { visit, metric };
  }
  return null;
}
