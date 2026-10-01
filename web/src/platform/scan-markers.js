// Marker numbers are scan-wide so the image and saved text use the same key.
export function scanAnnotationMarkers(findings = [], frameIndex = null) {
  const markers = findings.map((finding, index) => ({ ...finding, marker: index + 1 }));
  return frameIndex === null ? markers : markers.filter((finding) =>
    Number(finding.frame_index ?? 0) === frameIndex);
}

export function scanFrameIndex(value, count = 1) {
  const number = Number(value);
  const last = Math.max(0, Math.floor(Number(count) || 1) - 1);
  return Number.isFinite(number) ? Math.min(last, Math.max(0, Math.floor(number))) : 0;
}
