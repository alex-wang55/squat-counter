# Squat Counter

A real-time squat rep counter that runs entirely in the browser using [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker). No video ever leaves your device — all pose detection happens client-side.

## How it works

1. Your webcam feed is fed into MediaPipe's pose landmarker model (running on-device via WebAssembly/GPU).
2. The angle at your knee (hip–knee–ankle) is computed every frame.
3. A simple state machine counts a rep each time the angle drops below a "down" threshold and then rises back above an "up" threshold.
4. Depth feedback is given per rep based on the minimum angle reached.

## Running locally

This is a static site with no build step. Serve the folder with any static file server, for example:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`. Camera access requires a secure context (`localhost` or HTTPS).

## Tech

Vanilla HTML/CSS/JS, [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) loaded via CDN.

## Tips for best tracking

- Stand far enough back that your hips, knees, and ankles are all visible.
- A side-on (profile) view tracks squat depth most accurately.
- Good, even lighting helps — backlighting confuses the model.
