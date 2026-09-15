/** Software projection of genuine model XYZ coordinates. No depth is generated.
 * Keeping this renderer independent of WebGL makes it work on integrated GPUs
 * and in the desktop preview. Coordinates use ONE common scale for x/y/z.
 */
export function rotatePoint([x, y, z], yaw, pitch = 0) {
  const a = Math.cos(yaw) * x + Math.sin(yaw) * z;
  const b = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  return [
    a,
    Math.cos(pitch) * y - Math.sin(pitch) * b,
    Math.sin(pitch) * y + Math.cos(pitch) * b,
  ];
}
export class PoseCanvas {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext("2d");
    this.yaw = 0;
    this.pitch = 0.08;
    this.pose = null;
    let last = null;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => {
      last = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!last) return;
      this.yaw += (e.clientX - last[0]) * 0.013;
      this.pitch = Math.max(
        -1,
        Math.min(1, this.pitch + (e.clientY - last[1]) * 0.008),
      );
      last = [e.clientX, e.clientY];
      this.draw();
    });
    canvas.addEventListener("pointerup", () => (last = null));
    canvas.addEventListener("pointercancel", () => (last = null));
    new ResizeObserver(() => this.draw()).observe(container);
  }
  set(pose) {
    this.pose = pose;
    this.yaw = 0;
    this.pitch = 0.08;
    this.draw();
  }
  angle(name) {
    this.yaw = { front: 0, side: Math.PI / 2, back: Math.PI }[name] ?? 0;
    this.pitch = 0.08;
    this.draw();
  }
  draw() {
    if (!this.pose) return;
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    const dpi = Math.min(devicePixelRatio, 2);
    this.canvas.width = w * dpi;
    this.canvas.height = h * dpi;
    const c = this.ctx;
    c.setTransform(dpi, 0, 0, dpi, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#f2f7f4";
    c.fillRect(0, 0, w, h);
    const raw = this.pose.joints,
      scores = this.pose.scores;
    const good = raw.filter((_, i) => scores[i] >= 0.65);
    if (!good.length) return;
    const bottom = Math.max(...good.map((p) => p[1]));
    const top = Math.min(...good.map((p) => p[1]));
    const span = Math.max(
      0.8,
      bottom - top,
      Math.max(...good.map((p) => Math.hypot(p[0], p[2]))) * 2,
    );
    const scale = Math.min(h * 0.7, w * 0.73) / span;
    const middle = (top + bottom) / 2;
    const project = (p) => {
      const q = rotatePoint([p[0], p[1] - middle, p[2]], this.yaw, this.pitch);
      return [w / 2 + q[0] * scale, h * 0.48 + q[1] * scale, q[2]];
    };
    const line = (a, b, color, width = 1, dash = []) => {
      c.beginPath();
      c.strokeStyle = color;
      c.lineWidth = width;
      c.setLineDash(dash);
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      c.stroke();
      c.setLineDash([]);
    };
    for (let i = -5; i <= 5; i++) {
      const k = i * 0.2;
      line(
        project([-1, bottom + 0.1, k]),
        project([1, bottom + 0.1, k]),
        "#dce7df",
      );
      line(
        project([k, bottom + 0.1, -1]),
        project([k, bottom + 0.1, 1]),
        "#dce7df",
      );
    }
    line(
      project([0, top - 0.12, 0]),
      project([0, bottom + 0.08, 0]),
      "#9bb8aa",
      1,
      [4, 4],
    );
    const points = raw.map(project);
    const left = new Set([1, 3, 5, 7, 9, 11, 13, 15]);
    const bones = this.pose.bones
      .filter(([a, b]) => scores[a] >= 0.65 && scores[b] >= 0.65)
      .sort(
        ([a, b], [d, e]) =>
          points[b][2] + points[a][2] - (points[d][2] + points[e][2]),
      );
    for (const [a, b] of bones) {
      line(points[a], points[b], "#fff", 6);
      line(points[a], points[b], left.has(a) ? "#348977" : "#ad8550", 3);
    }
    points.forEach((p, i) => {
      if (scores[i] < 0.65) return;
      c.beginPath();
      c.arc(p[0], p[1], 4.3, 0, Math.PI * 2);
      c.fillStyle = left.has(i) ? "#278673" : "#ae8550";
      c.fill();
      c.strokeStyle = "white";
      c.lineWidth = 1.5;
      c.stroke();
    });
    c.font = "10px system-ui";
    c.textAlign = "center";
    c.fillStyle = "#6f887e";
    c.fillText("LEARNED 3D · HIP-CENTRED", w / 2, 23);
    c.textAlign = "left";
    c.fillStyle = "#348977";
    c.fillText("● Anatomical left", 16, h - 17);
    c.fillStyle = "#a37c47";
    c.fillText("● Anatomical right", w - 125, h - 17);
  }
}
