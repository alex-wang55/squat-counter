const BODY_LINKS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
];
const LEG_LINKS = [[23, 25], [25, 27], [24, 26], [26, 28]];
const FOOT_LINKS = [[27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const MIN_VIS = 0.3;
const OUTLINE = "rgba(0, 0, 0, 0.55)";

export function drawSkeleton(ctx, lms, { w, h, legColor, bodyColor = "rgba(255, 255, 255, 0.78)", dim = false }) {
  const s = w / 640;
  const pt = (i) => ({ x: lms[i].x * w, y: lms[i].y * h, v: lms[i].visibility ?? 1 });

  ctx.save();
  ctx.globalAlpha = dim ? 0.4 : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Each stroke gets a dark outline underneath so it reads on bright or busy video.
  const stroke = (color, width) => {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = (width + 3) * s;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * s;
    ctx.stroke();
  };
  const links = (pairs) => {
    ctx.beginPath();
    for (const [a, b] of pairs) {
      const p = pt(a);
      const q = pt(b);
      if (p.v < MIN_VIS || q.v < MIN_VIS) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
  };

  links(BODY_LINKS);
  stroke(bodyColor, 3);
  links(FOOT_LINKS);
  stroke(legColor, 2.5);
  links(LEG_LINKS);
  stroke(legColor, 5);

  // Head: a circle around the nose/ears, sized from torso length so it works from any angle.
  const nose = pt(0);
  if (nose.v >= MIN_VIS) {
    const ears = [pt(7), pt(8)].filter((p) => p.v >= MIN_VIS);
    const avg = (key) => ears.reduce((sum, p) => sum + p[key], 0) / ears.length;
    const cx = ears.length ? (nose.x + avg("x")) / 2 : nose.x;
    const cy = ears.length ? (nose.y + avg("y")) / 2 : nose.y;
    const sh = { x: (pt(11).x + pt(12).x) / 2, y: (pt(11).y + pt(12).y) / 2 };
    const hp = { x: (pt(23).x + pt(24).x) / 2, y: (pt(23).y + pt(24).y) / 2 };
    const r = Math.max(8 * s, Math.hypot(sh.x - hp.x, sh.y - hp.y) * 0.24);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    stroke(bodyColor, 3);
  }

  for (const i of JOINTS) {
    const p = pt(i);
    if (p.v < MIN_VIS) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawDemoBackdrop(ctx, w, h) {
  ctx.fillStyle = "#0c0c0c";
  ctx.fillRect(0, 0, w, h);

  const step = w / 24;
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  for (let x = step / 2; x < w; x += step) {
    for (let y = step / 2; y < h; y += step) {
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  const floorY = h * 0.955;
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.fillRect(0, floorY, w, 1);
}

export class Particles {
  constructor() {
    this.items = [];
  }

  clear() {
    this.items.length = 0;
  }

  burst(x, y, { count, colors, speed, size, life, scale = 1 }) {
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const v = speed * scale * (0.4 + Math.random() * 0.8);
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        gravity: 900 * scale,
        life,
        maxLife: life,
        size: size * scale * (0.6 + Math.random() * 0.6),
        color: colors[i % colors.length],
      });
    }
  }

  step(dt) {
    for (const p of this.items) {
      p.vy += p.gravity * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx) {
    for (const p of this.items) {
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.5));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
