import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoSource } from "../src/demo.js";
import { measurePose } from "../src/pose.js";
import { SquatDetector } from "../src/detector.js";
import { Game, COUNTDOWN_MS } from "../src/game.js";
import { createStore, memoryBackend } from "../src/storage.js";
import { seeded } from "./helpers.js";

function simulate(modeId, durationMs, fps = 30, { startDelayMs = 0 } = {}) {
  const demo = new DemoSource({ rand: seeded(11) });
  const detector = new SquatDetector();
  const game = new Game(createStore(memoryBackend()));
  demo.restart({ script: modeId === "hold" ? "hold" : "reps" });
  const events = [...game.start(modeId)];
  const take = (list, t) => {
    for (const e of list) {
      if (e.type === "go") demo.begin(t);
      events.push(e);
    }
  };
  for (let t = startDelayMs; t <= durationMs; t += 1000 / fps) {
    const m = measurePose(demo.frame(t));
    for (const e of detector.update(m, t)) take(game.handle(e, t), t);
    take(game.update(t, detector.state), t);
  }
  return { game, events };
}

test("the demo squatter plays a full Free Play session through the real pipeline", () => {
  const { game, events } = simulate("free", 1500 + 16 * 1990);
  const reps = events.filter((e) => e.type === "rep");
  assert.equal(reps.length, 16, "every scripted rep is counted exactly once");
  const tiers = reps.map((r) => r.tier.id);
  // Scripted bottoms: 64,78,60,94,66,124,62,76,58,96,64,80,120,62,66,78
  assert.deepEqual(tiers, [
    "perfect", "great", "perfect", "good", "perfect", "shallow", "perfect", "great",
    "perfect", "good", "perfect", "great", "shallow", "perfect", "perfect", "great",
  ]);
  assert.equal(game.session.maxCombo, 6);
});

test("the demo blitz finishes on time with a graded result", () => {
  const { events } = simulate("blitz", 1400 + COUNTDOWN_MS + 61000);
  const finished = events.find((e) => e.type === "finished");
  assert.ok(finished, "blitz should end by itself");
  assert.ok(finished.results.reps >= 28 && finished.results.reps <= 31, `reps ${finished.results.reps}`);
  assert.ok(finished.results.grade);
});

test("the demo hold lasts about 33 seconds", () => {
  const { events } = simulate("hold", 40000);
  const finished = events.find((e) => e.type === "finished");
  assert.ok(finished);
  assert.ok(Math.abs(finished.results.holdMs - 33000) < 1500, `hold ${finished.results.holdMs}`);
});

test("works at a low frame rate too", () => {
  const { events } = simulate("free", 1600 + 8 * 1990, 12);
  assert.equal(events.filter((e) => e.type === "rep").length, 8);
});

test("the demo waits for calibration even when frames arrive late", () => {
  const { events } = simulate("blitz", 20000 + 1500 + COUNTDOWN_MS + 61000, 30, { startDelayMs: 20000 });
  assert.ok(events.find((e) => e.type === "finished"), "blitz still completes");
});
