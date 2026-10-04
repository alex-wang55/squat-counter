// Loaded lazily, so the page (and the demo) work without pulling in MediaPipe.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URLS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

export async function createLandmarker(model = "full") {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URLS[model] ?? MODEL_URLS.full, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.6,
    minPosePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  try {
    return await PoseLandmarker.createFromOptions(vision, options("GPU"));
  } catch (err) {
    console.warn("GPU delegate unavailable, falling back to CPU.", err);
    return PoseLandmarker.createFromOptions(vision, options("CPU"));
  }
}
