import { test } from "node:test";
import assert from "node:assert/strict";
import { angle2D, angle3D, measurePose, LM } from "../src/pose.js";
import { syntheticPose } from "../src/demo.js";

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} expected ${expected}±${tol}, got ${actual}`);

function clonePose(pose) {
  return structuredClone(pose);
}

test("angle helpers measure the interior angle", () => {
  close(angle2D({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 90, 1e-9);
  close(angle2D({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), 180, 1e-9);
  close(angle3D({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 90, 1e-9);
  assert.ok(Number.isNaN(angle3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })));
});

test("reads a standing pose", () => {
  const m = measurePose(syntheticPose(172));
  assert.equal(m.ok, true);
  close(m.kneeAngle, 172, 1);
  assert.ok(m.hipDrop < 0.03, `hip drop ${m.hipDrop}`);
  assert.deepEqual(m.legs, ["left", "right"]);
});

test("reads squat depth and hip drop", () => {
  for (const angle of [140, 110, 90, 70, 55]) {
    const m = measurePose(syntheticPose(angle));
    assert.equal(m.ok, true, `pose at ${angle}° should be valid`);
    close(m.kneeAngle, angle, 1, `${angle}°`);
  }
  const deep = measurePose(syntheticPose(66));
  assert.ok(deep.hipDrop > 0.35, `deep squat hip drop ${deep.hipDrop}`);
});

test("uses 3D world landmarks so foreshortened 2D views still read correctly", () => {
  const pose = syntheticPose(80);
  // Squash the image x-coordinates as if the knees pointed at the camera.
  for (const p of pose.landmarks[0]) p.x = 0.5 + (p.x - 0.5) * 0.15;
  const m = measurePose(pose);
  assert.equal(m.ok, true);
  close(m.kneeAngle, 80, 1);
});

test("falls back to an aspect-corrected 2D angle without world landmarks", () => {
  const pose = syntheticPose(90);
  delete pose.worldLandmarks;
  const m = measurePose(pose, 4 / 3);
  assert.equal(m.ok, true);
  close(m.kneeAngle, 90, 1.5);
});

test("rejects legs that extend past the bottom of the frame", () => {
  const m = measurePose(syntheticPose(172, { offsetY: 0.2 }));
  assert.deepEqual(m, { ok: false, reason: "outOfFrame" });
});

test("rejects low-visibility legs", () => {
  const m = measurePose(syntheticPose(172, { visibility: 0.4, farVisibility: 0.3 }));
  assert.equal(m.reason, "visibility");
});

test("rejects squashed legs that are too small to be real", () => {
  const pose = syntheticPose(172);
  for (const idx of [LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) {
    const p = pose.landmarks[0][idx];
    const hip = pose.landmarks[0][idx % 2 ? LM.LEFT_HIP : LM.RIGHT_HIP];
    p.y = hip.y + (p.y - hip.y) * 0.25;
  }
  assert.equal(measurePose(pose).ok, false);
});

test("rejects an upside-down or lying pose", () => {
  const pose = syntheticPose(172);
  for (const p of pose.landmarks[0]) p.y = 1 - p.y;
  assert.equal(measurePose(pose).ok, false);
});

test("rejects legs with no torso in view", () => {
  const pose = syntheticPose(172);
  pose.landmarks[0][LM.LEFT_SHOULDER].visibility = 0.1;
  pose.landmarks[0][LM.RIGHT_SHOULDER].visibility = 0.1;
  assert.deepEqual(measurePose(pose), { ok: false, reason: "notUpright" });
});

test("trusts the straighter leg when the two knees disagree wildly", () => {
  const pose = clonePose(syntheticPose(172));
  const bent = syntheticPose(80);
  // Swap only the far leg's world coordinates to a deeply bent knee (a knee lift).
  for (const idx of [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE]) {
    pose.worldLandmarks[0][idx] = bent.worldLandmarks[0][idx];
  }
  const m = measurePose(pose);
  assert.equal(m.ok, true);
  assert.ok(m.kneeAngle > 165, `knee angle ${m.kneeAngle}`);
  assert.ok(m.hipDrop < 0.05, "standing leg keeps the hip drop low");
});

test("no landmarks means no person", () => {
  assert.deepEqual(measurePose({ landmarks: [] }), { ok: false, reason: "noPerson" });
  assert.deepEqual(measurePose(null), { ok: false, reason: "noPerson" });
});
