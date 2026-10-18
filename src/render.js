const BODY_LINKS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
];
const LEG_LINKS = [[23, 25], [25, 27], [24, 26], [26, 28]];
const FOOT_LINKS = [[27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
const BODY_JOINTS = [11, 12, 13, 14, 15, 16];
const LEG_JOINTS = [23, 24, 25, 26, 27, 28];
const KNEE = { left: [23, 25, 27], right: [24, 26, 28] };
const MIN_VIS = 0.3;
const OUTLINE = "rgba(0, 0, 0, 0.5)";
const BODY_GLOW = "#22e6ff";

// Glow comes from stacked translucent strokes with additive blending rather
// than shadowBlur, which is very slow on software-rendered canvases.

const visible = (lms, i) => (lms[i]?.visibility ?? 1) >= MIN_VIS;

function linkPath(ctx, lms, pairs, w, h) {
  ctx.beginPath();
  for (const [a, b] of pairs) {
    if (!visible(lms, a) || !visible(lms, b)) continue;
    ctx.moveTo(lms[a].x * w, lms[a].y * h);
    ctx.lineTo(lms[b].x * w, lms[b].y * h);
  }
}

function glowStroke(ctx, color, width, s, strength = 1) {
  const alpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha * 0.1 * strength;
  ctx.lineWidth = width * 5 * s;
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.22 * strength;
  ctx.lineWidth = width * 2.6 * s;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "source-over";
}

// A neon tube: dark outline for contrast on busy video, a soft glow, the
// colored stroke, then a thin hot-white core.
function neon(ctx, color, glow, width, s, strength) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = (width + 4) * s;
  ctx.stroke();
  glowStroke(ctx, glow, width, s, strength);
  ctx.strokeStyle = color;
  ctx.lineWidth = width * s;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(1, width * 0.32) * s;
  ctx.stroke();
}

function jointDots(ctx, lms, ids, { w, h, r, glow, s }) {
  const pts = ids.filter((i) => visible(lms, i)).map((i) => [lms[i].x * w, lms[i].y * h]);
  if (!pts.length) return;
  const alpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha * 0.3;
  ctx.fillStyle = glow;
  ctx.beginPath();
  for (const [x, y] of pts) {
    ctx.moveTo(x + r * 2.6, y);
    ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  for (const [x, y] of pts) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

export function drawSkeleton(ctx, lms, { w, h, legColor, bodyColor = "rgba(200, 245, 255, 0.9)", dim = false }) {
  const s = w / 640;

  ctx.save();
  ctx.globalAlpha = dim ? 0.4 : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  linkPath(ctx, lms, BODY_LINKS, w, h);
  neon(ctx, bodyColor, BODY_GLOW, 3, s, 0.8);
  linkPath(ctx, lms, FOOT_LINKS, w, h);
  neon(ctx, legColor, legColor, 2.5, s, 1);
  linkPath(ctx, lms, LEG_LINKS, w, h);
  neon(ctx, legColor, legColor, 6, s, 1.3);

  // Head: a circle around the nose/ears, sized from torso length so it works from any angle.
  if (visible(lms, 0)) {
    const px = (i) => ({ x: lms[i].x * w, y: lms[i].y * h });
    const ears = [7, 8].filter((i) => visible(lms, i)).map(px);
    const nose = px(0);
    const avg = (key) => ears.reduce((sum, p) => sum + p[key], 0) / ears.length;
    const cx = ears.length ? (nose.x + avg("x")) / 2 : nose.x;
    const cy = ears.length ? (nose.y + avg("y")) / 2 : nose.y;
    const sh = { x: ((lms[11].x + lms[12].x) * w) / 2, y: ((lms[11].y + lms[12].y) * h) / 2 };
    const hp = { x: ((lms[23].x + lms[24].x) * w) / 2, y: ((lms[23].y + lms[24].y) * h) / 2 };
    const r = Math.max(8 * s, Math.hypot(sh.x - hp.x, sh.y - hp.y) * 0.24);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    neon(ctx, bodyColor, BODY_GLOW, 3, s, 0.8);
  }

  jointDots(ctx, lms, BODY_JOINTS, { w, h, r: 4 * s, glow: BODY_GLOW, s });
  jointDots(ctx, lms, LEG_JOINTS, { w, h, r: 5 * s, glow: legColor, s });
  ctx.restore();
}

// Ghost afterimages of recent leg positions, for a motion-blur streak.
export function drawTrails(ctx, trail, { w, h, now, span }) {
  const s = w / 640;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const snap of trail) {
    const age = (now - snap.t) / span;
    if (age <= 0.04 || age >= 1) continue;
    ctx.globalAlpha = (1 - age) * 0.28;
    ctx.strokeStyle = snap.color;
    ctx.lineWidth = (10 - age * 6) * s;
    linkPath(ctx, snap.lms, LEG_LINKS, w, h);
    ctx.stroke();
  }
  ctx.restore();
}

// Live knee-angle protractor drawn at the knee of the tracked leg.
export function drawKneeArc(ctx, lms, { w, h, side, angle, color }) {
  const ids = KNEE[side];
  if (!ids || angle == null || !ids.every((i) => visible(lms, i))) return;
  const s = w / 640;
  const [hip, knee, ankle] = ids.map((i) => ({ x: lms[i].x * w, y: lms[i].y * h }));
  const a1 = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const a2 = Math.atan2(ankle.y - knee.y, ankle.x - knee.x);
  let diff = a2 - a1;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const thigh = Math.hypot(hip.x - knee.x, hip.y - knee.y);
  const shin = Math.hypot(ankle.x - knee.x, ankle.y - knee.y);
  const r = Math.max(16 * s, Math.min(thigh, shin) * 0.34);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(knee.x, knee.y);
  ctx.arc(knee.x, knee.y, r, a1, a1 + diff, diff < 0);
  ctx.closePath();
  const fill = ctx.createRadialGradient(knee.x, knee.y, 0, knee.x, knee.y, r);
  fill.addColorStop(0, "rgba(255, 255, 255, 0)");
  fill.addColorStop(1, color);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(knee.x, knee.y, r, a1, a1 + diff, diff < 0);
  glowStroke(ctx, color, 2.5, s, 0.8);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * s;
  ctx.setLineDash([4 * s, 4 * s]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label sits outside the angle. The canvas is mirrored with CSS, so flip text back.
  const out = a1 + diff / 2 + Math.PI;
  const lx = knee.x + Math.cos(out) * (r + 26 * s);
  const ly = knee.y + Math.sin(out) * (r + 26 * s);
  const text = `${Math.round(angle)}°`;
  ctx.translate(lx, ly);
  ctx.scale(-1, 1);
  ctx.font = `800 ${15 * s}px Unbounded, Geist, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  roundRect(ctx, -tw / 2 - 8 * s, -12 * s, tw + 16 * s, 24 * s, 12 * s);
  ctx.fillStyle = "rgba(5, 5, 10, 0.72)";
  ctx.fill();
  ctx.lineWidth = 1.2 * s;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 0, 1 * s);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A pool of light under the feet so the demo player feels grounded.
export function drawFloorGlow(ctx, lms, { w, h, color }) {
  const feet = [27, 28, 31, 32].filter((i) => visible(lms, i));
  if (!feet.length) return;
  const x = (feet.reduce((sum, i) => sum + lms[i].x, 0) / feet.length) * w;
  const y = Math.max(...feet.map((i) => lms[i].y)) * h;
  const rx = w * 0.14;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(x, y);
  ctx.scale(1, 0.22);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Deterministic star field so it doesn't reshuffle every frame.
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = (n) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1), y: r(2) * 0.56, size: 0.6 + r(3) * 1.4, phase: r(4) * Math.PI * 2, speed: 0.6 + r(5) * 1.8 };
});

const HORIZON = 0.6;
const backdropCache = { key: "", canvas: null };

// Everything in the backdrop that doesn't move, rendered once per size/heat level.
function staticBackdrop(w, h, heat) {
  const key = `${w}x${h}:${heat}`;
  if (backdropCache.key === key) return backdropCache.canvas;
  const canvas = backdropCache.canvas ?? document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const s = w / 640;
  const horizon = h * HORIZON;
  const hot = heat >= 3;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#04030d");
  sky.addColorStop(0.7, hot ? "#22082c" : "#120a2c");
  sky.addColorStop(1, hot ? "#4a0f3a" : "#2b0f45");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  // Sun, off to one side (the canvas is mirrored, so this lands on the left on screen).
  const sunX = w * 0.82;
  const sunR = h * 0.17;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, horizon);
  ctx.clip();
  const halo = ctx.createRadialGradient(sunX, horizon, sunR * 0.5, sunX, horizon, sunR * 2.6);
  halo.addColorStop(0, `rgba(255, 77, 141, ${0.35 + heat * 0.08})`);
  halo.addColorStop(1, "rgba(255, 77, 141, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(sunX - sunR * 3, horizon - sunR * 3, sunR * 6, sunR * 3);
  const sun = ctx.createLinearGradient(0, horizon - sunR, 0, horizon);
  sun.addColorStop(0, "#ffe066");
  sun.addColorStop(0.55, "#ff8a4c");
  sun.addColorStop(1, "#ff2e88");
  ctx.fillStyle = sun;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.arc(sunX, horizon, sunR, Math.PI, 0);
  ctx.fill();
  // Classic horizontal cut-outs across the lower half of the sun.
  ctx.fillStyle = sky;
  ctx.globalAlpha = 1;
  for (let i = 0; i < 6; i++) {
    const y = horizon - sunR * 0.08 - i * sunR * 0.13;
    ctx.fillRect(sunX - sunR, y - (6 - i) * 0.55 * s, sunR * 2, (6 - i) * 1.1 * s);
  }
  ctx.restore();

  const floor = ctx.createLinearGradient(0, horizon, 0, h);
  floor.addColorStop(0, hot ? "#2a0b2a" : "#1a0b33");
  floor.addColorStop(1, "#04030a");
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Lines converging on a vanishing point.
  ctx.globalCompositeOperation = "lighter";
  const fade = ctx.createLinearGradient(0, horizon, 0, h);
  fade.addColorStop(0, "rgba(34, 230, 255, 0)");
  fade.addColorStop(1, "rgba(34, 230, 255, 0.5)");
  ctx.strokeStyle = fade;
  const vx = w / 2;
  ctx.beginPath();
  for (let i = -14; i <= 14; i++) {
    ctx.moveTo(vx + i * w * 0.012, horizon);
    ctx.lineTo(vx + i * w * 0.09, h);
  }
  ctx.lineWidth = 5 * s;
  ctx.globalAlpha = 0.18;
  ctx.stroke();
  ctx.lineWidth = 1.2 * s;
  ctx.globalAlpha = 1;
  ctx.stroke();

  // Hot horizon line.
  const line = ctx.createLinearGradient(0, 0, w, 0);
  line.addColorStop(0, "rgba(34, 230, 255, 0)");
  line.addColorStop(0.5, "rgba(255, 120, 220, 0.95)");
  line.addColorStop(1, "rgba(34, 230, 255, 0)");
  ctx.fillStyle = line;
  for (const [height, alpha] of [[16, 0.12], [7, 0.3], [2, 1]]) {
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, horizon - (height / 2) * s, w, height * s);
  }

  backdropCache.key = key;
  backdropCache.canvas = canvas;
  return canvas;
}

// Synthwave stage for the demo: starry sky, striped sun, scrolling neon grid.
export function drawDemoBackdrop(ctx, w, h, t = 0, intensity = 0) {
  const s = w / 640;
  const horizon = h * HORIZON;
  const time = t / 1000;
  const heat = Math.round(intensity * 4);
  ctx.drawImage(staticBackdrop(w, h, heat), 0, 0);

  ctx.save();
  ctx.fillStyle = "#ffffff";
  for (const star of STARS) {
    ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(time * star.speed + star.phase));
    ctx.fillRect(star.x * w, star.y * h, star.size * s, star.size * s);
  }

  // Horizontal lines rush toward the viewer, faster as the combo heats up.
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = heat >= 3 ? "#ff4d8d" : "#a855f7";
  const rows = 14;
  const phase = (time * (0.35 + intensity * 0.6)) % 1;
  for (let i = 0; i < rows; i++) {
    const u = (i + phase) / rows;
    const y = horizon + (h - horizon) * u * u;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.globalAlpha = (0.12 + u * 0.55) * 0.25;
    ctx.lineWidth = 5 * s;
    ctx.stroke();
    ctx.globalAlpha = 0.12 + u * 0.55;
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
  }
  ctx.restore();
}

export class Particles {
  constructor() {
    this.items = [];
  }

  clear() {
    this.items.length = 0;
  }

  get size() {
    return this.items.length;
  }

  burst(x, y, { count, colors, speed, size, life, scale = 1, kind = "spark", angle = -Math.PI / 2, spread = Math.PI * 1.5, gravity = 900 }) {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * scale * (0.4 + Math.random() * 0.8);
      const l = life * (0.7 + Math.random() * 0.6);
      this.items.push({
        kind,
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        gravity: gravity * scale,
        drag: kind === "confetti" ? 0.982 : 0.985,
        life: l,
        maxLife: l,
        size: size * scale * (0.6 + Math.random() * 0.8),
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 14,
        wobble: Math.random() * Math.PI * 2,
      });
    }
  }

  confetti(x, y, opts) {
    this.burst(x, y, { kind: "confetti", gravity: 520, life: 2.4, size: 9, speed: 700, ...opts });
  }

  ring(x, y, { color, radius, life = 0.6, width = 4, scale = 1, delay = 0 }) {
    this.items.push({ kind: "ring", x, y, color, radius: radius * scale, width: width * scale, life: life + delay, maxLife: life });
  }

  glints(x, y, { count, color, radius, scale = 1 }) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = radius * scale * (0.3 + Math.random() * 0.7);
      const l = 0.5 + Math.random() * 0.4;
      this.items.push({
        kind: "glint",
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        color,
        size: (10 + Math.random() * 14) * scale,
        life: l + i * 0.04,
        maxLife: l,
      });
    }
  }

  step(dt) {
    for (const p of this.items) {
      p.life -= dt;
      if (p.kind === "ring" || p.kind === "glint") continue;
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      if (p.kind === "confetti") p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.wobble += dt * 8;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.items) {
      const k = Math.min(1, p.life / p.maxLife);
      switch (p.kind) {
        case "ring": {
          if (p.life > p.maxLife) continue; // still delayed
          const ease = 1 - Math.pow(k, 3);
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * (0.15 + ease * 0.85), 0, Math.PI * 2);
          ctx.globalAlpha = k * 0.25;
          ctx.lineWidth = p.width * 3.5 * k + 1;
          ctx.stroke();
          ctx.globalAlpha = k * 0.95;
          ctx.lineWidth = Math.max(0.5, p.width * k);
          ctx.stroke();
          break;
        }
        case "glint": {
          if (p.life > p.maxLife) continue;
          const sz = p.size * Math.sin(Math.PI * Math.min(1, (1 - k) * 1.2));
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 0.3;
          star(ctx, p.x, p.y, sz * 1.8);
          ctx.fill();
          ctx.globalAlpha = 1;
          star(ctx, p.x, p.y, sz);
          ctx.fill();
          break;
        }
        case "confetti": {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.3));
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.wobble));
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        }
        default: {
          // Spark: a short glowing streak along its velocity.
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.5));
          ctx.strokeStyle = p.color;
          ctx.lineCap = "round";
          ctx.lineWidth = p.size * 0.55;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

function star(ctx, x, y, r) {
  const i = r * 0.18;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + i, y - i, x + r, y);
  ctx.quadraticCurveTo(x + i, y + i, x, y + r);
  ctx.quadraticCurveTo(x - i, y + i, x - r, y);
  ctx.quadraticCurveTo(x - i, y - i, x, y - r);
  ctx.closePath();
}
