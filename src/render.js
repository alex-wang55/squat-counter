const BODY_LINKS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
];
const LEG_LINKS = [[23, 25], [25, 27], [24, 26], [26, 28]];
const FOOT_LINKS = [[27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
const BODY_JOINTS = [11, 12, 13, 14, 15, 16];
const LEG_JOINTS = [23, 24, 25, 26, 27, 28];
const MIN_VIS = 0.3;

export function drawSkeleton(ctx, lms, { w, h, legColor, bodyColor = "rgba(238, 241, 246, 0.9)", dim = false }) {
  const s = w / 640;
  const pt = (i) => ({ x: lms[i].x * w, y: lms[i].y * h, v: lms[i].visibility ?? 1 });

  ctx.save();
  ctx.globalAlpha = dim ? 0.4 : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const stroke = (links, color, width, glow) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * s;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow ? 16 * s : 0;
    ctx.beginPath();
    for (const [a, b] of links) {
      const p = pt(a);
      const q = pt(b);
      if (p.v < MIN_VIS || q.v < MIN_VIS) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  };

  stroke(BODY_LINKS, bodyColor, 4, false);
  stroke(FOOT_LINKS, legColor, 3, false);
  stroke(LEG_LINKS, legColor, 7, true);

  // Head: a circle around the nose/ears, sized from torso length so it works from any angle.
  const nose = pt(0);
  const ears = [pt(7), pt(8)].filter((p) => p.v >= MIN_VIS);
  if (nose.v >= MIN_VIS) {
    const cx = ears.length ? (nose.x + ears.reduce((sum, p) => sum + p.x, 0) / ears.length) / 2 : nose.x;
    const cy = ears.length ? (nose.y + ears.reduce((sum, p) => sum + p.y, 0) / ears.length) / 2 : nose.y;
    const sh = { x: (pt(11).x + pt(12).x) / 2, y: (pt(11).y + pt(12).y) / 2 };
    const hp = { x: (pt(23).x + pt(24).x) / 2, y: (pt(23).y + pt(24).y) / 2 };
    const r = Math.max(8 * s, Math.hypot(sh.x - hp.x, sh.y - hp.y) * 0.24);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  const dots = (joints, color, r) => {
    ctx.fillStyle = color;
    for (const i of joints) {
      const p = pt(i);
      if (p.v < MIN_VIS) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  dots(BODY_JOINTS, bodyColor, 4);
  dots(LEG_JOINTS, "#ffffff", 5);
  ctx.restore();
}

export function drawDemoBackdrop(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#161d31");
  sky.addColorStop(1, "#0c101a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += w / 16) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += h / 12) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  const floorY = h * 0.955;
  const floor = ctx.createLinearGradient(0, floorY, 0, h);
  floor.addColorStop(0, "#26304a");
  floor.addColorStop(1, "#151b2b");
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorY, w, h - floorY);
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
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
      const v = speed * scale * (0.4 + Math.random() * 0.8);
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        gravity: 900 * scale,
        life,
        maxLife: life,
        size: size * scale * (0.6 + Math.random() * 0.8),
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 14,
      });
    }
  }

  step(dt) {
    for (const p of this.items) {
      p.vy += p.gravity * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.life -= dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx) {
    for (const p of this.items) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.5));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }
}
