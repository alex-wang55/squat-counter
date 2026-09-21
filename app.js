import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// Landmark indices from MediaPipe's 33-point pose model.
const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

// Angle thresholds that define a rep's bottom/top. Tuned for a
// side-on view; feel free to nudge if your stance reads differently.
const DOWN_ANGLE = 100; // knee angle below this = squat depth reached
const UP_ANGLE = 160; // knee angle above this = standing

// Depth tiers, checked from deepest to shallowest against the rep's minimum angle.
const DEPTH_TIERS = [
  { max: 85, tier: "perfect", label: "PERFECT", points: 25 },
  { max: 100, tier: "great", label: "GREAT", points: 15 },
  { max: 110, tier: "good", label: "GOOD", points: 10 },
  { max: Infinity, tier: "shallow", label: "SHALLOW", points: 5 },
];
const STREAK_BONUS_EVERY = 3;
const STREAK_BONUS_POINTS = 15;

// Every joint must individually clear this visibility score.
const VISIBILITY_THRESHOLD = 0.65;
// Minimum normalized vertical gap required between hip->knee and knee->ankle,
// and the minimum hip-to-ankle span overall. MediaPipe will happily "hallucinate"
// a plausible-looking but wrong leg pose when your legs are actually out of frame
// (e.g. sitting at a desk) — these sanity checks reject those guesses.
const MIN_JOINT_GAP = 0.03;
const MIN_LEG_SPAN = 0.16;
// How many consecutive good frames are needed before a phase change (down/up)
// is accepted, so single noisy frames can't flip state or count a rep.
const CONFIRM_FRAMES = 4;
// If tracking becomes invalid for this many consecutive frames while mid-squat,
// abandon that rep attempt instead of letting it resolve once tracking returns.
const TRACKING_LOST_GRACE_FRAMES = 20;

const RANKS = [
  { min: 0, emoji: "🐣", name: "Newbie" },
  { min: 10, emoji: "🏋️", name: "Squat Rookie" },
  { min: 50, emoji: "💪", name: "Squat Regular" },
  { min: 150, emoji: "⚙️", name: "Squat Machine" },
  { min: 400, emoji: "👑", name: "Squat Legend" },
];

const BEST_SCORE_KEY = "squatCounter.bestScore";
const TOTAL_REPS_KEY = "squatCounter.totalReps";

const videoEl = document.getElementById("video");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");
const loadingEl = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const repCountEl = document.getElementById("rep-count");
const scoreEl = document.getElementById("score");
const streakEl = document.getElementById("streak");
const bestScoreEl = document.getElementById("best-score");
const phaseEl = document.getElementById("phase");
const angleEl = document.getElementById("angle");
const feedbackEl = document.getElementById("feedback");
const startBtn = document.getElementById("start-btn");
const resetBtn = document.getElementById("reset-btn");
const popupLayer = document.getElementById("popup-layer");
const rankBadge = document.getElementById("rank-badge");
const rankEmojiEl = document.getElementById("rank-emoji");
const rankNameEl = document.getElementById("rank-name");
const repStatEl = repCountEl.closest(".stat");
const scoreStatEl = scoreEl.closest(".stat");
const streakStatEl = streakEl.closest(".stat");

let poseLandmarker = null;
let drawingUtils = null;
let running = false;
let animationHandle = null;

let repCount = 0;
let score = 0;
let streak = 0;
let bestScore = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
let totalReps = Number(localStorage.getItem(TOTAL_REPS_KEY) ?? 0);

let stage = "up"; // "up" | "down" (confirmed state used for rep counting)
let candidate = "up"; // instantaneous reading, debounced into `stage`
let candidateFrames = 0;
let minAngleThisRep = 180;
let trackingLostFrames = 0;

function angleBetween(a, b, c) {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

// Rejects leg poses MediaPipe guesses when the legs are actually off-screen:
// real legs read top-to-bottom (hip above knee above ankle) with real separation.
function isPlausibleLegPose(hip, knee, ankle) {
  if (!(knee.y > hip.y + MIN_JOINT_GAP)) return false;
  if (!(ankle.y > knee.y + MIN_JOINT_GAP)) return false;
  if (ankle.y - hip.y < MIN_LEG_SPAN) return false;
  return true;
}

function pickSide(landmarks) {
  const sides = [
    { hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE },
    { hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE },
  ];

  let best = null;
  let bestVis = -1;

  for (const s of sides) {
    const hip = landmarks[s.hip];
    const knee = landmarks[s.knee];
    const ankle = landmarks[s.ankle];
    if (!hip || !knee || !ankle) continue;

    const hipVis = hip.visibility ?? 0;
    const kneeVis = knee.visibility ?? 0;
    const ankleVis = ankle.visibility ?? 0;
    if (Math.min(hipVis, kneeVis, ankleVis) < VISIBILITY_THRESHOLD) continue;
    if (!isPlausibleLegPose(hip, knee, ankle)) continue;

    const vis = hipVis + kneeVis + ankleVis;
    if (vis > bestVis) {
      bestVis = vis;
      best = s;
    }
  }

  return best;
}

function setFeedback(text, level = "") {
  feedbackEl.textContent = text;
  feedbackEl.className = "feedback" + (level ? ` ${level}` : "");
}

function pop(el) {
  el.classList.remove("pop");
  // eslint-disable-next-line no-unused-expressions
  void el.offsetWidth; // restart animation
  el.classList.add("pop");
}

function spawnPopup(text, tierClass, sublabel) {
  const node = document.createElement("div");
  node.className = `point-popup ${tierClass}`;
  node.innerHTML = sublabel ? `${text}<span class="tier-label">${sublabel}</span>` : text;
  // Slight random horizontal jitter so consecutive popups don't fully stack.
  node.style.marginLeft = `${(Math.random() - 0.5) * 60}px`;
  popupLayer.appendChild(node);
  node.addEventListener("animationend", () => node.remove());
}

function currentRank(reps) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (reps >= r.min) rank = r;
  }
  return rank;
}

function updateRankBadge() {
  const rank = currentRank(totalReps);
  rankEmojiEl.textContent = rank.emoji;
  rankNameEl.textContent = rank.name;
  rankBadge.hidden = false;
}

function depthTierFor(minAngle) {
  return DEPTH_TIERS.find((t) => minAngle <= t.max);
}

function completeRep(minAngle) {
  repCount += 1;
  repCountEl.textContent = String(repCount);
  pop(repStatEl);

  totalReps += 1;
  localStorage.setItem(TOTAL_REPS_KEY, String(totalReps));
  const prevRank = currentRank(totalReps - 1);
  const newRank = currentRank(totalReps);

  const tier = depthTierFor(minAngle);
  let points = tier.points;

  const goodOrBetter = tier.tier !== "shallow";
  if (goodOrBetter) {
    streak += 1;
  } else {
    streak = 0;
  }

  let bonusText = "";
  if (goodOrBetter && streak > 0 && streak % STREAK_BONUS_EVERY === 0) {
    points += STREAK_BONUS_POINTS;
    bonusText = ` +${STREAK_BONUS_POINTS} streak!`;
  }

  score += points;
  scoreEl.textContent = String(score);
  streakEl.textContent = String(streak);
  pop(scoreStatEl);
  if (bonusText) pop(streakStatEl);

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
    bestScoreEl.textContent = String(bestScore);
  }

  spawnPopup(`+${points}`, `tier-${tier.tier}`, tier.label + bonusText);

  const messages = {
    perfect: "Perfect depth! That's textbook. 🔥",
    great: "Great rep — nice and deep!",
    good: "Good rep, counted!",
    shallow: "Rep counted, but go deeper next time for more points.",
  };
  setFeedback(messages[tier.tier], tier.tier === "shallow" ? "warn" : "");

  if (newRank.name !== prevRank.name) {
    updateRankBadge();
    pop(rankBadge);
    setFeedback(`Rank up! You're now a ${newRank.emoji} ${newRank.name}!`);
  } else if (repCount % 10 === 0) {
    setFeedback(`🎉 ${repCount} reps this session — keep it up!`);
  }
}

function resetTrackingState() {
  candidate = "up";
  candidateFrames = 0;
  minAngleThisRep = 180;
  trackingLostFrames = 0;
}

function abandonRepInProgress() {
  if (stage === "down") {
    setFeedback("Lost tracking mid-squat — that rep didn't count. Get your full leg back in frame.", "warn");
  }
  stage = "up";
  resetTrackingState();
}

function updateRepState(kneeAngle) {
  trackingLostFrames = 0;
  angleEl.textContent = `${Math.round(kneeAngle)}°`;

  let instant;
  if (kneeAngle < DOWN_ANGLE) instant = "down";
  else if (kneeAngle > UP_ANGLE) instant = "up";
  else instant = "mid";

  if (instant === "down") {
    minAngleThisRep = Math.min(minAngleThisRep, kneeAngle);
  }

  if (instant === candidate) {
    candidateFrames += 1;
  } else {
    candidate = instant;
    candidateFrames = 1;
  }

  if (candidateFrames >= CONFIRM_FRAMES) {
    if (candidate === "down" && stage !== "down") {
      stage = "down";
      setFeedback("In the hole — now drive back up!");
    } else if (candidate === "up" && stage === "down") {
      stage = "up";
      completeRep(minAngleThisRep);
      minAngleThisRep = 180;
    }
  }

  phaseEl.textContent = stage === "down" ? "DOWN" : instant === "mid" ? "MID" : "UP";
}

function drawFrame(result) {
  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (result.landmarks && result.landmarks.length > 0) {
    const landmarks = result.landmarks[0];

    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: "#4ade80",
      lineWidth: 3,
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: "#eef0f4",
      fillColor: "#4ade80",
      radius: 4,
    });

    const side = pickSide(landmarks);
    if (side) {
      const hip = landmarks[side.hip];
      const knee = landmarks[side.knee];
      const ankle = landmarks[side.ankle];
      const kneeAngle = angleBetween(hip, knee, ankle);
      updateRepState(kneeAngle);

      // Highlight the tracked knee joint.
      ctx.beginPath();
      ctx.arc(knee.x * canvasEl.width, knee.y * canvasEl.height, 9, 0, 2 * Math.PI);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      trackingLostFrames += 1;
      if (trackingLostFrames === TRACKING_LOST_GRACE_FRAMES) {
        abandonRepInProgress();
      }
      setFeedback("Can't see your full leg clearly — step back so hips, knees, and ankles are all in frame.", "warn");
      phaseEl.textContent = "—";
      angleEl.textContent = "—";
    }
  } else {
    trackingLostFrames += 1;
    if (trackingLostFrames === TRACKING_LOST_GRACE_FRAMES) {
      abandonRepInProgress();
    }
    setFeedback("No person detected. Step into frame.", "warn");
    phaseEl.textContent = "—";
    angleEl.textContent = "—";
  }

  ctx.restore();
}

async function predictLoop() {
  if (!running) return;

  if (videoEl.readyState >= 2) {
    const nowMs = performance.now();
    const result = poseLandmarker.detectForVideo(videoEl, nowMs);
    drawFrame(result);
  }

  animationHandle = requestAnimationFrame(predictLoop);
}

async function initPoseLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  drawingUtils = new DrawingUtils(ctx);
}

async function startCamera() {
  startBtn.disabled = true;
  loadingText.textContent = "Loading pose model…";
  loadingEl.hidden = false;

  try {
    if (!poseLandmarker) {
      await initPoseLandmarker();
    }

    loadingText.textContent = "Requesting camera access…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    videoEl.srcObject = stream;

    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => resolve();
    });

    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;

    loadingEl.hidden = true;
    running = true;
    resetBtn.disabled = false;
    startBtn.textContent = "Stop Camera";
    startBtn.disabled = false;
    setFeedback("Tracking started. Get into frame, side-on works best.");
    updateRankBadge();

    predictLoop();
  } catch (err) {
    console.error(err);
    loadingEl.hidden = true;
    startBtn.disabled = false;
    setFeedback(
      err.name === "NotAllowedError"
        ? "Camera permission denied. Allow camera access and try again."
        : `Couldn't start camera: ${err.message}`,
      "danger"
    );
  }
}

function stopCamera() {
  running = false;
  if (animationHandle) cancelAnimationFrame(animationHandle);

  const stream = videoEl.srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  videoEl.srcObject = null;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  startBtn.textContent = "Start Camera";
  phaseEl.textContent = "—";
  angleEl.textContent = "—";
  setFeedback("Camera stopped.");
}

function resetReps() {
  repCount = 0;
  score = 0;
  streak = 0;
  stage = "up";
  resetTrackingState();
  repCountEl.textContent = "0";
  scoreEl.textContent = "0";
  streakEl.textContent = "0";
  setFeedback("Reps reset. Keep going!");
}

bestScoreEl.textContent = String(bestScore);

startBtn.addEventListener("click", () => {
  if (running) {
    stopCamera();
  } else {
    startCamera();
  }
});

resetBtn.addEventListener("click", resetReps);
