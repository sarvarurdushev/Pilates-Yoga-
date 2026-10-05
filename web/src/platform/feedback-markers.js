/** Mark only regions backed by feedback in the selected client's record. */
export function feedbackMarkerRegions(client, catalog) {
  const notes = (client?.notes || []).filter((note) =>
    note.region_id && (!note.student_id || note.student_id === client.id))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return (catalog || []).map((region) => {
    // A bilateral region can be related to a side-specific note for reading,
    // but placing both markers would imply two saved locations for one note.
    const linked = notes.filter((note) => note.region_id === region.id);
    const structureIds = (region.structures || [])
      .map((structure) => Number(structure.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const primary = (region.structures || []).find((structure) => structureIds.includes(Number(structure.id)));
    const opposite = region.side === "bilateral" && primary?.name?.startsWith("left ")
      ? region.structures.find((structure) => structure.name === "right " + primary.name.slice(5)) : null;
    return {
      id: region.id,
      name: region.name,
      count: linked.length,
      noteId: linked[0]?.id || null,
      structureIds,
      // A bilateral note sits between the matching structures, rather than
      // covering a separately saved left-side note on the same point.
      anchorIds: opposite ? [Number(primary.id), Number(opposite.id)] : structureIds,
      pairedAnchor: Boolean(opposite),
      jointCoordinates: feedbackJointCoordinates(region.id),
    };
  }).filter((region) => region.count && region.structureIds.length);
}

/** Use the shipped rig's joint centres for named coaching regions. */
export function feedbackJointCoordinates(regionId) {
  const midline = { head: "cervical_flex", thorax: "thoracic_flex", lumbar: "lumbar_flex", pelvis: "pelvis_tilt" };
  if (midline[regionId]) return [midline[regionId]];
  const match = /^(left|right|both)_(shoulder|elbow|wrist|hip|knee|ankle)$/.exec(regionId || "");
  if (!match) return [];
  const coordinates = { shoulder: "arm_flex", elbow: "elbow_flex", wrist: "wrist_flex", hip: "hip_flexion", knee: "knee_angle", ankle: "ankle_angle" };
  const sides = match[1] === "both" ? ["l", "r"] : [match[1] === "left" ? "l" : "r"];
  return sides.map(side => coordinates[match[2]] + "_" + side);
}

/** Keep the button and its focus ring on the stage at the projected anatomy. */
export function feedbackMarkerPosition(point, width, height, diameter = 33, padding = 7) {
  if (!point || ![point.x, point.y, point.z, width, height].every(Number.isFinite)
      || point.z < -1 || point.z > 1 || width <= 0 || height <= 0) return null;
  const x = (point.x + 1) / 2 * width;
  const y = (1 - point.y) / 2 * height;
  const margin = diameter / 2 + padding;
  return x >= margin && x <= width - margin && y >= margin && y <= height - margin
    ? { x, y } : null;
}

/** Nearby regions get separate callouts; the leader keeps their anatomy anchor. */
export function feedbackMarkerLayout(markers, width, height, diameter = 33, padding = 7) {
  const placed = [];
  const margin = diameter / 2 + padding;
  const spacing = diameter + padding * 2;
  const fits = (x, y) => x >= margin && x <= width - margin && y >= margin && y <= height - margin
    && placed.every(other => Math.hypot(x - other.x, y - other.y) >= spacing);
  for (const marker of markers) {
    const offsets = [[0, 0]];
    const direction = marker.x >= width / 2 ? 1 : -1;
    for (let step = 1; step <= 3; step++) {
      const gap = step * spacing;
      offsets.push([gap * direction, 0], [-gap * direction, 0], [0, -gap], [0, gap],
        [gap * direction, -gap], [-gap * direction, -gap], [gap * direction, gap], [-gap * direction, gap]);
    }
    const offset = offsets.find(([dx, dy]) => fits(marker.x + dx, marker.y + dy));
    if (offset) placed.push({ ...marker, anchorX: marker.x, anchorY: marker.y,
      x: marker.x + offset[0], y: marker.y + offset[1] });
  }
  return placed;
}

/** A source link is shown only when the note names that exact saved record. */
export function feedbackSourceURL(clientId, note) {
  const source = note?.session_id
    ? { session: note.session_id }
    : note?.analysis_id ? { assessment: note.analysis_id } : null;
  if (!clientId || !source) return null;
  return "/#" + new URLSearchParams({
    page: "client", client: clientId, tab: "sessions", ...source,
  });
}
