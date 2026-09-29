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
