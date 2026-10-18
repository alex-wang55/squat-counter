const BODY_LINKS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
];
const LEG_LINKS = [[23, 25], [25, 27], [24, 26], [26, 28]];
const FOOT_LINKS = [[27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const KNEE = { left: [23, 25, 27], right: [24, 26, 28] };
const MIN_VIS = 0.3;
const OUTLINE = "rgba(0, 0, 0, 0.45)";
const FONT = "Archivo, ui-sans-serif, system-ui, sans-serif";

const visible = (lms, i) => (lms[i]?.visibility ?? 1) >= MIN_VIS;

function linkPath(ctx, lms, pairs, w, h) {
  ctx.beginPath();
  for (const [a, b] of pairs) {
    if (!visible(lms, a) || !visible(lms, b)) continue;
    ctx.moveTo(lms[a].x * w, lms[a].y * h);
    ctx.lineTo(lms[b].x * w, lms[b].y * h);
  }
}

// Each stroke gets a dark outline underneath so it reads on bright or busy video.
function outlined(ctx, color, width, s) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = (width + 3) * s;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * s;
  ctx.stroke();
}

export function drawSkeleton(ctx, lms, { w, h, legColor, bodyColor = "rgba(242, 241, 238, 0.8)", dim = false }) {
  const s = w / 640;

  ctx.save();
  ctx.globalAlpha = dim ? 0.4 : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  linkPath(ctx, lms, BODY_LINKS, w, h);
  outlined(ctx, bodyColor, 2.5, s);
  linkPath(ctx, lms, FOOT_LINKS, w, h);
  outlined(ctx, legColor, 2.5, s);
  linkPath(ctx, lms, LEG_LINKS, w, h);
  outlined(ctx, legColor, 5, s);

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
    outlined(ctx, bodyColor, 2.5, s);
  }

  ctx.beginPath();
  for (const i of JOINTS) {
    if (!visible(lms, i)) continue;
    const x = lms[i].x * w;
    const y = lms[i].y * h;
    ctx.moveTo(x + 3.5 * s, y);
    ctx.arc(x, y, 3.5 * s, 0, Math.PI * 2);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.restore();
}

// Knee-angle readout: a thin arc at the knee of the tracked leg and its value.
// `px` is canvas pixels per CSS pixel; it keeps the label readable on small screens.
export function drawKneeArc(ctx, lms, { w, h, side, angle, color, px = 1 }) {
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
  const r = Math.max(16 * s, Math.min(thigh, shin) * 0.3);

  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(knee.x, knee.y, r, a1, a1 + diff, diff < 0);
  outlined(ctx, color, 2, s);

  // Label sits outside the angle. The canvas is mirrored with CSS, so flip text back.
  const t = Math.max(s, px * 0.85);
  const out = a1 + diff / 2 + Math.PI;
  const lx = knee.x + Math.cos(out) * (r + 24 * t);
  const ly = knee.y + Math.sin(out) * (r + 24 * t);
  const text = `${Math.round(angle)}°`;
  ctx.translate(lx, ly);
  ctx.scale(-1, 1);
  ctx.font = `600 ${13 * t}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  roundRect(ctx, -tw / 2 - 7 * t, -11 * t, tw + 14 * t, 22 * t, 7 * t);
  ctx.fillStyle = "rgba(12, 12, 13, 0.78)";
  ctx.fill();
  ctx.fillStyle = "#f2f1ee";
  ctx.fillText(text, 0, 0.5 * t);
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

const backdropCache = { key: "", canvas: null };

// A quiet studio for the demo player: soft key light, floor, contact shadow.
// It never changes, so it's rendered once per size and blitted each frame.
export function drawDemoBackdrop(ctx, w, h) {
  const key = `${w}x${h}`;
  if (backdropCache.key !== key) {
    const canvas = backdropCache.canvas ?? document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d");
    const floorY = h * 0.955;

    const wall = c.createLinearGradient(0, 0, 0, floorY);
    wall.addColorStop(0, "#0f0f10");
    wall.addColorStop(1, "#18181a");
    c.fillStyle = wall;
    c.fillRect(0, 0, w, floorY);

    const light = c.createRadialGradient(w * 0.45, h * 0.5, 0, w * 0.45, h * 0.5, w * 0.55);
    light.addColorStop(0, "rgba(255, 255, 255, 0.05)");
    light.addColorStop(1, "rgba(255, 255, 255, 0)");
    c.fillStyle = light;
    c.fillRect(0, 0, w, floorY);

    c.fillStyle = "#1d1d20";
    c.fillRect(0, floorY, w, h - floorY);
    c.fillStyle = "rgba(255, 255, 255, 0.1)";
    c.fillRect(0, floorY, w, Math.max(1, w / 640));

    c.save();
    c.translate(w * 0.45, floorY);
    c.scale(1, 0.12);
    const shadow = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.16);
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    c.fillStyle = shadow;
    c.beginPath();
    c.arc(0, 0, w * 0.16, 0, Math.PI * 2);
    c.fill();
    c.restore();

    backdropCache.key = key;
    backdropCache.canvas = canvas;
  }
  ctx.drawImage(backdropCache.canvas, 0, 0);
}

// Expanding rings, used as a single "ping" when a Perfect rep lands.
export class Rings {
  constructor() {
    this.items = [];
  }

  clear() {
    this.items.length = 0;
  }

  add(x, y, { color, radius, life = 0.55, width = 2, scale = 1 }) {
    this.items.push({ x, y, color, radius: radius * scale, width: width * scale, life, maxLife: life });
  }

  step(dt) {
    for (const ring of this.items) ring.life -= dt;
    this.items = this.items.filter((ring) => ring.life > 0);
  }

  draw(ctx) {
    ctx.save();
    for (const ring of this.items) {
      const k = ring.life / ring.maxLife;
      const ease = 1 - k * k * k;
      ctx.globalAlpha = k;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius * (0.3 + ease * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
