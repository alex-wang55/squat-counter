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
const GOOD_DEPTH_ANGLE = 110; // min angle during the rep to count as "good depth"
const VISIBILITY_THRESHOLD = 0.5;

const videoEl = document.getElementById("video");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");
const loadingEl = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const repCountEl = document.getElementById("rep-count");
const phaseEl = document.getElementById("phase");
const angleEl = document.getElementById("angle");
const feedbackEl = document.getElementById("feedback");
const startBtn = document.getElementById("start-btn");
const resetBtn = document.getElementById("reset-btn");

let poseLandmarker = null;
let drawingUtils = null;
let running = false;
let animationHandle = null;

let repCount = 0;
let stage = "up"; // "up" | "down"
let minAngleThisRep = 180;

function angleBetween(a, b, c) {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

function pickSide(landmarks) {
  const leftVis =
    (landmarks[LM.LEFT_HIP]?.visibility ?? 0) +
    (landmarks[LM.LEFT_KNEE]?.visibility ?? 0) +
    (landmarks[LM.LEFT_ANKLE]?.visibility ?? 0);
  const rightVis =
    (landmarks[LM.RIGHT_HIP]?.visibility ?? 0) +
    (landmarks[LM.RIGHT_KNEE]?.visibility ?? 0) +
    (landmarks[LM.RIGHT_ANKLE]?.visibility ?? 0);

  if (leftVis < VISIBILITY_THRESHOLD * 3 && rightVis < VISIBILITY_THRESHOLD * 3) {
    return null;
  }
  return rightVis >= leftVis
    ? { hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE }
    : { hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE };
}

function setFeedback(text, level = "") {
  feedbackEl.textContent = text;
  feedbackEl.className = "feedback" + (level ? ` ${level}` : "");
}

function updateRepState(kneeAngle) {
  angleEl.textContent = `${Math.round(kneeAngle)}°`;

  if (kneeAngle < DOWN_ANGLE) {
    stage = "down";
    phaseEl.textContent = "DOWN";
    minAngleThisRep = Math.min(minAngleThisRep, kneeAngle);
    setFeedback("Good — now drive back up.");
  } else if (kneeAngle > UP_ANGLE) {
    phaseEl.textContent = "UP";
    if (stage === "down") {
      stage = "up";
      repCount += 1;
      repCountEl.textContent = String(repCount);

      if (minAngleThisRep > GOOD_DEPTH_ANGLE) {
        setFeedback(`Rep counted, but go deeper next time (min angle ${Math.round(minAngleThisRep)}°).`, "warn");
      } else {
        setFeedback(`Nice rep! Depth: ${Math.round(minAngleThisRep)}°.`);
      }
      minAngleThisRep = 180;
    } else {
      setFeedback("Get into frame and start squatting.");
    }
  } else {
    phaseEl.textContent = stage === "down" ? "DOWN" : "MID";
  }
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
      setFeedback("Can't see your hips/knees/ankles clearly — step back or turn side-on.", "warn");
      phaseEl.textContent = "—";
      angleEl.textContent = "—";
    }
  } else {
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
  stage = "up";
  minAngleThisRep = 180;
  repCountEl.textContent = "0";
  setFeedback("Reps reset. Keep going!");
}

startBtn.addEventListener("click", () => {
  if (running) {
    stopCamera();
  } else {
    startCamera();
  }
});

resetBtn.addEventListener("click", resetReps);
