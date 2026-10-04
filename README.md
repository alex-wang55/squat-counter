# Depth

A squat game that runs entirely in the browser. [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) tracks your body through the webcam, and every rep is scored by depth. No video ever leaves your device.

No camera? Hit **Watch a demo run** for a simulated player that goes through the same tracking and scoring pipeline.

## Game modes

| Mode | Goal |
| --- | --- |
| **Free play** | Endless reps. Chain good-depth squats to build a combo multiplier. |
| **Blitz** | 60 seconds. Score as many points as you can. |
| **Race** | 20 Good-or-better reps as fast as possible. Shallow reps don't count. |
| **Hold** | Hold Good depth or lower for as long as you can. |

Each rep is graded **Perfect / Great / Good / Shallow** by depth. Consecutive good reps grow a combo multiplier (×1.5 at 5, up to ×3 at 20); a shallow rep breaks it. There are also letter grades, per-mode leaderboards, 12 achievements, and a rank that grows with your lifetime squats. Progress is saved in your browser.

## How the tracking stays accurate

- **Calibration.** Each run starts with one second of standing still, so depth is measured relative to *your* straight-leg position instead of a hard-coded angle.
- **3D knee angle.** The knee angle comes from MediaPipe's metric world landmarks, so it still works when you face the camera, where a flat 2D angle barely changes. The 2D fallback corrects for the frame's aspect ratio. Without that correction, a 90° knee reads as about 105° on a 4:3 camera.
- **Hip drop.** A rep also requires your hips to drop relative to your leg length, and the support leg is used to measure it. This rejects knee lifts and kicks, and the ratio doesn't change when you step closer or further away.
- **Pose sanity checks.** A frame is ignored unless both legs are fully inside the frame, every leg joint is clearly visible, the shoulders are above the hips, and the legs aren't implausibly squashed. These checks catch the "phantom legs" MediaPipe guesses when you're sitting at a desk.
- **Smoothing and debouncing.** A [One Euro filter](https://gery.casiez.net/1euro/) removes landmark jitter without lagging real movement. Phase changes must hold for 90 ms, and reps shorter than 0.45 s or longer than 10 s are rejected. If tracking drops mid-rep, that rep is abandoned instead of counting when tracking comes back.
- **Finishing a rep means standing up for real.** Both knees must be straight *and* the hips must be back at standing height. Straight-looking legs under a seated torso won't complete a rep.

## Running locally

It's a static site with no build step. Camera access needs `localhost` or HTTPS:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`.

## Tests

The rep detector, pose checks and game rules are plain JavaScript with no DOM, so they're unit tested with Node's built-in test runner. The suite also runs the synthetic demo player through the full pose → detector → game pipeline, with noise and at different frame rates.

```bash
npm test
```

## Project layout

```
index.html, style.css   UI
src/main.js             wires the camera/demo, detector, game and DOM together
src/pose.js             landmark → knee angle + hip drop, with validity checks
src/detector.js         calibration and the rep state machine
src/filters.js          One Euro filter
src/game.js             modes, scoring, combos, leaderboards
src/scoring.js          depth tiers, difficulty, multipliers, ranks, grades
src/achievements.js     achievement definitions
src/demo.js             synthetic squatter (demo mode + tests)
src/render.js           skeleton, particles
src/audio.js            synthesized sound effects
src/landmarker.js       lazy-loads MediaPipe
tests/                  node:test suites
```
