// Synthetic side-view squatter that emits MediaPipe-shaped results, so the
// game can be tried without a camera and the full pipeline can be tested.

const SEG = {
  shin: 0.43,
  thigh: 0.45,
  torso: 0.52,
  upperArm: 0.29,
  forearm: 0.26,
  ankleHeight: 0.08,
  hipHalfWidth: 0.1,
  shoulderHalfWidth: 0.18,
};

export const DEMO_STAND_ANGLE = 172;
const DEG = Math.PI / 180;

function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Builds a sagittal-plane skeleton (meters; x = forward, y = up) for a given knee angle.
function skeleton(kneeAngle) {
  const theta = kneeAngle * DEG;
  const bend = Math.PI - theta;
  const shinLean = bend * 0.38;
  const ankle = { x: 0, y: SEG.ankleHeight };
  const knee = { x: SEG.shin * Math.sin(shinLean), y: ankle.y + SEG.shin * Math.cos(shinLean) };
  // Thigh direction: rotate the knee->ankle direction clockwise by the knee angle.
  const v = { x: -Math.sin(shinLean), y: -Math.cos(shinLean) };
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  const hip = { x: knee.x + SEG.thigh * (v.x * c - v.y * s), y: knee.y + SEG.thigh * (v.x * s + v.y * c) };

  const torsoLean = bend * 0.42;
  const shoulder = { x: hip.x + SEG.torso * Math.sin(torsoLean), y: hip.y + SEG.torso * Math.cos(torsoLean) };
  const head = { x: shoulder.x + 0.2 * Math.sin(torsoLean) + 0.03, y: shoulder.y + 0.2 * Math.cos(torsoLean) };

  // Arms swing forward for balance as the squat deepens.
  const arm = 0.35 + Math.min(1, bend / (Math.PI * 0.6)) * 1.25;
  const dir = { x: Math.sin(arm), y: -Math.cos(arm) };
  const elbow = { x: shoulder.x + SEG.upperArm * dir.x, y: shoulder.y + SEG.upperArm * dir.y };
  const wrist = { x: elbow.x + SEG.forearm * dir.x, y: elbow.y + SEG.forearm * dir.y };

  return {
    ankle,
    knee,
    hip,
    shoulder,
    head,
    elbow,
    wrist,
    heel: { x: ankle.x - 0.06, y: ankle.y - 0.06 },
    toe: { x: ankle.x + 0.16, y: ankle.y - 0.07 },
  };
}

// Returns { landmarks: [33 normalized points], worldLandmarks: [33 metric points] }.
export function syntheticPose(kneeAngle, opts = {}) {
  const {
    aspect = 4 / 3,
    offsetX = 0,
    offsetY = 0,
    jitter = 0,
    worldJitter = 0,
    visibility = 0.97,
    farVisibility = 0.86,
    rand = Math.random,
  } = opts;
  const sk = skeleton(kneeAngle);
  const scaleY = 0.82 / 1.75;
  const scaleX = scaleY / aspect;
  const floorY = 0.955;
  const originX = 0.43;

  const lms = new Array(33);
  const world = new Array(33);
  const put = (idx, p, z, vis, imgShift = { x: 0, y: 0 }) => {
    const n = () => (jitter ? gaussian(rand) * jitter : 0);
    const wn = () => (worldJitter ? gaussian(rand) * worldJitter : 0);
    lms[idx] = {
      x: originX + p.x * scaleX + offsetX + imgShift.x + n(),
      y: floorY - p.y * scaleY + offsetY + imgShift.y + n(),
      z: z * 0.3,
      visibility: vis,
    };
    world[idx] = { x: p.x - sk.hip.x + wn(), y: -(p.y - sk.hip.y) + wn(), z: z + wn(), visibility: vis };
  };

  // Left side faces the camera; the right side is slightly offset so both legs show.
  const sides = [
    { prefix: "left", z: -1, vis: visibility, shift: { x: 0, y: 0 } },
    { prefix: "right", z: 1, vis: farVisibility, shift: { x: 0.012, y: -0.006 } },
  ];
  const IDX = {
    left: { shoulder: 11, elbow: 13, wrist: 15, pinky: 17, index: 19, thumb: 21, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, eyeIn: 1, eye: 2, eyeOut: 3, ear: 7, mouth: 9 },
    right: { shoulder: 12, elbow: 14, wrist: 16, pinky: 18, index: 20, thumb: 22, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, eyeIn: 4, eye: 5, eyeOut: 6, ear: 8, mouth: 10 },
  };

  for (const side of sides) {
    const i = IDX[side.prefix];
    const zHip = side.z * SEG.hipHalfWidth;
    const zSh = side.z * SEG.shoulderHalfWidth;
    put(i.hip, sk.hip, zHip, side.vis, side.shift);
    put(i.knee, sk.knee, zHip, side.vis, side.shift);
    put(i.ankle, sk.ankle, zHip, side.vis, side.shift);
    put(i.heel, sk.heel, zHip, side.vis, side.shift);
    put(i.toe, sk.toe, zHip, side.vis, side.shift);
    put(i.shoulder, sk.shoulder, zSh, side.vis, side.shift);
    put(i.elbow, sk.elbow, zSh, side.vis, side.shift);
    put(i.wrist, sk.wrist, zSh, side.vis, side.shift);
    const hand = { x: sk.wrist.x + 0.05, y: sk.wrist.y - 0.02 };
    put(i.pinky, hand, zSh, side.vis, side.shift);
    put(i.index, hand, zSh, side.vis, side.shift);
    put(i.thumb, hand, zSh, side.vis, side.shift);
    put(i.ear, { x: sk.head.x - 0.06, y: sk.head.y }, side.z * 0.07, side.vis, side.shift);
    put(i.eyeIn, { x: sk.head.x + 0.05, y: sk.head.y + 0.03 }, side.z * 0.02, side.vis, side.shift);
    put(i.eye, { x: sk.head.x + 0.05, y: sk.head.y + 0.03 }, side.z * 0.03, side.vis, side.shift);
    put(i.eyeOut, { x: sk.head.x + 0.04, y: sk.head.y + 0.03 }, side.z * 0.04, side.vis, side.shift);
    put(i.mouth, { x: sk.head.x + 0.06, y: sk.head.y - 0.05 }, side.z * 0.02, side.vis, side.shift);
  }
  put(0, { x: sk.head.x + 0.08, y: sk.head.y }, 0, visibility);

  return { landmarks: [lms], worldLandmarks: [world] };
}

const smoothstep = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, k) => a + (b - a) * k;

// Bottom angles for the scripted reps: mostly Perfect/Great to show combos
// building, with the odd shallow rep to show a combo breaking.
const REP_PLAN = [64, 78, 60, 94, 66, 124, 62, 76, 58, 96, 64, 80, 120, 62, 66, 78];
const DOWN_MS = 750;
const BOTTOM_MS = 140;
const UP_MS = 650;
const REST_MS = 450;
const REP_MS = DOWN_MS + BOTTOM_MS + UP_MS + REST_MS;

const HOLD_DOWN_MS = 1200;
const HOLD_MS = 33000;
const HOLD_ANGLE = 86;

// Stands still until begin() is called, so calibration and the countdown
// always finish first no matter how slowly frames arrive.
export class DemoSource {
  constructor({ rand = Math.random } = {}) {
    this.rand = rand;
    this.restart();
  }

  restart({ script = "reps" } = {}) {
    this.script = script;
    this.t0 = null;
  }

  begin(t, delayMs = 400) {
    this.t0 = t + delayMs;
  }

  kneeAngleAt(t) {
    const local = this.t0 === null ? -1 : t - this.t0;
    if (local < 0) return DEMO_STAND_ANGLE;
    return this.script === "hold" ? this.#holdAngle(local) : this.#repAngle(local);
  }

  #repAngle(local) {
    const i = Math.floor(local / REP_MS);
    const p = local - i * REP_MS;
    const bottom = REP_PLAN[i % REP_PLAN.length];
    if (p < DOWN_MS) return lerp(DEMO_STAND_ANGLE, bottom, smoothstep(p / DOWN_MS));
    if (p < DOWN_MS + BOTTOM_MS) return bottom;
    if (p < DOWN_MS + BOTTOM_MS + UP_MS) {
      return lerp(bottom, DEMO_STAND_ANGLE, smoothstep((p - DOWN_MS - BOTTOM_MS) / UP_MS));
    }
    return DEMO_STAND_ANGLE;
  }

  #holdAngle(local) {
    if (local < HOLD_DOWN_MS) return lerp(DEMO_STAND_ANGLE, HOLD_ANGLE, smoothstep(local / HOLD_DOWN_MS));
    const inHold = local - HOLD_DOWN_MS;
    if (inHold < HOLD_MS) return HOLD_ANGLE + 3 * Math.sin(inHold / 700) + 1.5 * Math.sin(inHold / 230);
    const rise = inHold - HOLD_MS;
    if (rise < 900) return lerp(HOLD_ANGLE, DEMO_STAND_ANGLE, smoothstep(rise / 900));
    return DEMO_STAND_ANGLE;
  }

  frame(t) {
    const sway = Math.sin(t / 900) * 0.004;
    return syntheticPose(this.kneeAngleAt(t), { offsetX: sway, jitter: 0.0025, worldJitter: 0.006, rand: this.rand });
  }
}
