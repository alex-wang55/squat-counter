export const DT = 1000 / 30;

// Deterministic PRNG so noisy tests are reproducible.
export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function frames(ms, fn) {
  const n = Math.round(ms / DT);
  return Array.from({ length: n }, (_, i) => fn(i / Math.max(1, n - 1), i));
}

export const stand = (ms, angle = 172, drop = 0.02) => frames(ms, () => ({ angle, drop }));
export const lost = (ms, reason = "noPerson") => frames(ms, () => ({ ok: false, reason }));

const smooth = (x) => x * x * (3 - 2 * x);

// A squat as (angle, hipDrop) frames. Hip drop scales with depth like a real squat.
export function squat({ bottom = 66, downMs = 750, pauseMs = 140, upMs = 650, top = 172, bottomDrop = 0.45, baseDrop = 0.02 } = {}) {
  const at = (k) => ({ angle: top + (bottom - top) * k, drop: baseDrop + (bottomDrop - baseDrop) * k });
  return [
    ...frames(downMs, (p) => at(smooth(p))),
    ...frames(pauseMs, () => at(1)),
    ...frames(upMs, (p) => at(1 - smooth(p))),
  ];
}

export function run(detector, seq, t0 = 0) {
  const events = [];
  let t = t0;
  for (const f of seq) {
    t += DT;
    const m = f.ok === false ? { ok: false, reason: f.reason } : { ok: true, kneeAngle: f.angle, hipDrop: f.drop ?? 0.02 };
    for (const e of detector.update(m, t)) events.push({ ...e, t });
  }
  return { events, t };
}

export const ofType = (events, type) => events.filter((e) => e.type === type);
