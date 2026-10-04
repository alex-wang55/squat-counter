import { test } from "node:test";
import assert from "node:assert/strict";
import { SquatDetector } from "../src/detector.js";
import { seeded, frames, stand, lost, squat, run, ofType } from "./helpers.js";

function calibrated() {
  const det = new SquatDetector();
  const { t } = run(det, stand(1300));
  assert.ok(det.calibrated, "detector should calibrate after standing still");
  return { det, t };
}

test("calibrates after about a second of standing still", () => {
  const det = new SquatDetector();
  const { events } = run(det, stand(1300, 171));
  const cal = ofType(events, "calibrated");
  assert.equal(cal.length, 1);
  assert.ok(Math.abs(cal[0].standAngle - 171) < 1);
  assert.ok(cal[0].t >= 1000 && cal[0].t < 1200);
});

test("does not calibrate while the legs are bent", () => {
  const det = new SquatDetector();
  run(det, stand(3000, 120, 0.25));
  assert.equal(det.calibrated, false);
});

test("calibration restarts if tracking drops out", () => {
  const det = new SquatDetector();
  const { t } = run(det, [...stand(700), ...lost(200), ...stand(700)]);
  assert.equal(det.calibrated, false, "only 700ms of continuous standing so far");
  run(det, stand(400), t);
  assert.equal(det.calibrated, true);
});

test("counts a clean squat and measures its depth", () => {
  const { det, t } = calibrated();
  const { events } = run(det, [...squat({ bottom: 66 }), ...stand(400)], t);
  const reps = ofType(events, "rep");
  assert.equal(reps.length, 1);
  assert.ok(Math.abs(reps[0].minAngle - 66) < 5, `min angle ${reps[0].minAngle}`);
  assert.ok(Math.abs(reps[0].flexion - (172 - 66)) < 5, `flexion ${reps[0].flexion}`);
  assert.ok(reps[0].durationMs > 600 && reps[0].durationMs < 2000);
});

test("counts consecutive squats one-for-one", () => {
  const { det, t } = calibrated();
  const seq = [];
  for (let i = 0; i < 6; i++) seq.push(...squat({ bottom: 70 + i * 5 }), ...stand(450));
  const { events } = run(det, seq, t);
  assert.equal(ofType(events, "rep").length, 6);
  assert.equal(ofType(events, "repRejected").length, 0);
});

test("ignores heavy jitter while standing", () => {
  const { det, t } = calibrated();
  const rand = seeded(7);
  const noisy = frames(8000, () => ({ angle: 172 + (rand() - 0.5) * 20, drop: 0.02 + (rand() - 0.5) * 0.06 }));
  const { events } = run(det, noisy, t);
  assert.equal(ofType(events, "repStart").length, 0);
  assert.equal(ofType(events, "rep").length, 0);
});

test("does not double count when wobbling near the top of a rep", () => {
  const { det, t } = calibrated();
  const rand = seeded(3);
  const wobble = frames(1500, () => ({ angle: 150 + (rand() - 0.5) * 10, drop: 0.08 + (rand() - 0.5) * 0.04 }));
  const { events } = run(
    det,
    [...squat({ bottom: 70 }).slice(0, 30), ...wobble, ...squat({ bottom: 70 }).slice(-20), ...stand(500)],
    t
  );
  assert.equal(ofType(events, "rep").length, 1);
});

test("rejects a knee lift because the hips never drop", () => {
  const { det, t } = calibrated();
  const { events } = run(det, [...squat({ bottom: 80, bottomDrop: 0.02 }), ...stand(400)], t);
  assert.equal(ofType(events, "rep").length, 0);
  assert.equal(ofType(events, "repRejected")[0]?.reason, "noHipDrop");
});

test("ignores a brief flicker that is too fast to be a squat", () => {
  const { det, t } = calibrated();
  const { events } = run(det, [...squat({ bottom: 90, downMs: 120, pauseMs: 0, upMs: 120 }), ...stand(400)], t);
  assert.equal(ofType(events, "rep").length, 0);
});

test("abandons a rep when tracking is lost mid-squat", () => {
  const { det, t } = calibrated();
  const down = squat({ bottom: 70 }).slice(0, 25);
  const { events } = run(det, [...down, ...lost(1200, "outOfFrame"), ...stand(1000)], t);
  assert.equal(ofType(events, "repAbandoned").length, 1);
  assert.equal(ofType(events, "trackingLost")[0].reason, "outOfFrame");
  assert.equal(ofType(events, "trackingRegained").length, 1);
  assert.equal(ofType(events, "rep").length, 0);
});

test("survives a short tracking glitch mid-rep", () => {
  const { det, t } = calibrated();
  const sq = squat({ bottom: 70 });
  const { events } = run(det, [...sq.slice(0, 25), ...lost(250), ...sq.slice(25), ...stand(400)], t);
  assert.equal(ofType(events, "rep").length, 1);
  assert.equal(ofType(events, "trackingLost").length, 0);
});

test("sitting down for a while and standing up is not a rep", () => {
  const { det, t } = calibrated();
  const sit = { angle: 92, drop: 0.38 };
  const { events } = run(det, [...squat({ bottom: 92, bottomDrop: 0.38 }).slice(0, 25), ...frames(12000, () => sit), ...squat({ bottom: 92, bottomDrop: 0.38 }).slice(-20), ...stand(400)], t);
  assert.equal(ofType(events, "rep").length, 0);
  assert.equal(ofType(events, "repRejected")[0]?.reason, "tooSlow");
});

test("straight-looking legs under a seated torso do not finish a rep", () => {
  const { det, t } = calibrated();
  // Model guesses straight knees while the hips stay low (the classic desk-chair hallucination).
  const hallucinated = frames(4000, () => ({ angle: 170, drop: 0.4 }));
  const { events } = run(det, [...squat({ bottom: 85 }).slice(0, 25), ...hallucinated], t);
  assert.equal(ofType(events, "rep").length, 0);
  assert.equal(det.state.phase, "down");
});

test("a long stretch of bad readings cannot drag the standing reference far", () => {
  const { det, t } = calibrated();
  const calDrop = det.state.standDrop;
  run(det, frames(20000, () => ({ angle: 172, drop: 0.5 })), t);
  assert.ok(det.state.standDrop <= calDrop + 0.1 + 1e-9);
});

test("frame rate does not change the result", () => {
  for (const fps of [15, 30, 60]) {
    const det = new SquatDetector();
    const dt = 1000 / fps;
    let t = 0;
    let reps = 0;
    const feed = (angle, drop) => {
      t += dt;
      reps += det.update({ ok: true, kneeAngle: angle, hipDrop: drop }, t).filter((e) => e.type === "rep").length;
    };
    for (let ms = 0; ms < 1300; ms += dt) feed(172, 0.02);
    for (let r = 0; r < 3; r++) {
      for (let ms = 0; ms < 1600; ms += dt) {
        const k = Math.sin((ms / 1600) * Math.PI);
        feed(172 - 100 * k, 0.02 + 0.42 * k);
      }
      for (let ms = 0; ms < 400; ms += dt) feed(172, 0.02);
    }
    assert.equal(reps, 3, `${fps} fps`);
  }
});

test("exposes live flexion for the depth gauge", () => {
  const { det, t } = calibrated();
  run(det, squat({ bottom: 80 }).slice(0, 30), t);
  assert.ok(det.state.flexion > 80);
  assert.equal(det.state.phase, "down");
  assert.ok(det.state.repMaxFlexion >= det.state.flexion);
});
