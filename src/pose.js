// Turns raw MediaPipe pose landmarks into the two signals the rep detector
// needs — knee angle and hip drop — and rejects frames that can't be trusted.

export const LM = Object.freeze({
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
});

export const LEGS = Object.freeze([
  { side: "left", hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE },
  { side: "right", hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE },
]);

export const POSE_LIMITS = Object.freeze({
  // Every leg joint must individually clear this visibility score.
  minVisibility: 0.65,
  // A less-visible leg can still vouch for hip height (e.g. the far leg in a side view).
  supportVisibility: 0.4,
  // Ankles must sit below the knee and hip by at least this much (normalized height).
  minShinDrop: 0.02,
  // Hip->knee->ankle path length, in units of frame height. Hallucinated legs
  // under a desk tend to come out squashed.
  minLegLength: 0.16,
  // If the two knee angles disagree by more than this, it isn't a squat
  // (knee lift, kick, or one leg badly estimated) — trust the straighter one.
  maxLegDisagreement: 40,
  // Shoulders must be above the hips by at least this much.
  minTorsoRise: 0.03,
});

const FAILURE_PRIORITY = ["outOfFrame", "tooSmall", "visibility", "implausible"];

export function angle2D(a, b, c) {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  let deg = Math.abs(((ab - cb) * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

export function angle3D(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
  const v2 = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const n1 = Math.hypot(...v1);
  const n2 = Math.hypot(...v2);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

function inFrame(p) {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

// Normalized x and y are scaled by width and height respectively, so x must be
// stretched by the aspect ratio before measuring distances or angles.
function dist2D(a, b, aspect) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

function dist3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function worldJoints(world, leg) {
  const joints = world && [world[leg.hip], world[leg.knee], world[leg.ankle]];
  return joints && joints.every(Boolean) ? joints : null;
}

function readLeg(lms, world, leg, aspect, limits) {
  const hip = lms[leg.hip];
  const knee = lms[leg.knee];
  const ankle = lms[leg.ankle];
  const joints = [hip, knee, ankle];
  if (!joints.every(Boolean)) return { ok: false, reason: "visibility", visibility: 0 };

  const visibility = Math.min(...joints.map((p) => p.visibility ?? 0));
  if (!joints.every(inFrame)) return { ok: false, reason: "outOfFrame", visibility };
  if (visibility < limits.minVisibility) return { ok: false, reason: "visibility", visibility };
  if (ankle.y < knee.y + limits.minShinDrop || ankle.y < hip.y + limits.minShinDrop) {
    return { ok: false, reason: "implausible", visibility };
  }
  if (dist2D(hip, knee, aspect) + dist2D(knee, ankle, aspect) < limits.minLegLength) {
    return { ok: false, reason: "tooSmall", visibility };
  }

  // World landmarks are metric 3D, so the angle holds up even when facing the
  // camera, where a 2D angle barely changes as the knees bend toward the lens.
  const w = worldJoints(world, leg);
  let angle = w ? angle3D(...w) : NaN;
  if (!Number.isFinite(angle)) {
    const s = (p) => ({ x: p.x * aspect, y: p.y });
    angle = angle2D(s(hip), s(knee), s(ankle));
  }
  return { ok: true, side: leg.side, angle, visibility };
}

// 0 when the leg hangs straight below the hip, rising toward ~0.5 at the bottom
// of a deep squat. It's a ratio of the leg's own length, so it doesn't change
// when you step closer to or further from the camera.
function hipDrop(lms, world, leg, aspect) {
  const w = worldJoints(world, leg);
  if (w) {
    const [h, k, a] = w;
    const len = dist3D(h, k) + dist3D(k, a);
    if (len > 0) return 1 - Math.abs(a.y - h.y) / len;
  }
  const h = lms[leg.hip];
  const k = lms[leg.knee];
  const a = lms[leg.ankle];
  const len = dist2D(h, k, aspect) + dist2D(k, a, aspect);
  return len > 0 ? 1 - Math.abs(a.y - h.y) / len : NaN;
}

function isUpright(lms, limits) {
  const shoulders = [lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]].filter(
    (p) => p && (p.visibility ?? 0) >= 0.5 && inFrame(p)
  );
  const hips = [lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]].filter(Boolean);
  if (!shoulders.length || !hips.length) return false;
  const avgY = (pts) => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  return avgY(shoulders) < avgY(hips) - limits.minTorsoRise;
}

export function measurePose(result, aspect = 4 / 3, limits = POSE_LIMITS) {
  const lms = result?.landmarks?.[0];
  if (!lms || lms.length < 33) return { ok: false, reason: "noPerson" };
  const world = result.worldLandmarks?.[0] ?? null;

  const readings = LEGS.map((leg) => readLeg(lms, world, leg, aspect, limits));
  const valid = readings.filter((r) => r.ok);
  if (!valid.length) {
    const reasons = readings.map((r) => r.reason);
    return { ok: false, reason: FAILURE_PRIORITY.find((r) => reasons.includes(r)) ?? "visibility" };
  }
  if (!isUpright(lms, limits)) return { ok: false, reason: "notUpright" };

  let kneeAngle;
  if (valid.length === 2 && Math.abs(valid[0].angle - valid[1].angle) > limits.maxLegDisagreement) {
    kneeAngle = Math.max(valid[0].angle, valid[1].angle);
  } else {
    const weight = valid.reduce((sum, r) => sum + r.visibility, 0);
    kneeAngle = valid.reduce((sum, r) => sum + r.angle * r.visibility, 0) / weight;
  }

  // Use the least-dropped leg: in a real squat both hips go down together, but
  // a knee lift only shortens the lifted leg while the standing leg stays straight.
  const supportLegs = LEGS.filter((_, i) => {
    const r = readings[i];
    return r.ok || (r.reason === "visibility" && r.visibility >= limits.supportVisibility);
  });
  const drops = supportLegs.map((leg) => hipDrop(lms, world, leg, aspect)).filter(Number.isFinite);
  const drop = drops.length ? Math.min(...drops) : 0;

  const lh = lms[LM.LEFT_HIP];
  const rh = lms[LM.RIGHT_HIP];
  return {
    ok: true,
    kneeAngle,
    hipDrop: drop,
    legs: valid.map((r) => r.side),
    anchor: { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 },
  };
}
