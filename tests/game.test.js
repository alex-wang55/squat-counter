import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, MODES, COUNTDOWN_MS, insertScore } from "../src/game.js";
import { createStore, memoryBackend } from "../src/storage.js";
import { comboMultiplier, comboProgress, tierFor, rankInfo, gradeFor } from "../src/scoring.js";

const ofType = (events, type) => events.filter((e) => e.type === type);
const rep = (flexion) => ({ type: "rep", flexion, minAngle: 172 - flexion, durationMs: 1200 });
const PERFECT = 105;
const GREAT = 90;
const GOOD = 70;
const SHALLOW = 45;

function playing(modeId = "free", store = createStore(memoryBackend())) {
  const game = new Game(store);
  game.start(modeId);
  let t = 0;
  game.handle({ type: "calibrated" }, t);
  if (MODES[modeId].countdown) {
    t = COUNTDOWN_MS;
    game.update(t);
  }
  assert.equal(game.state, "playing");
  return { game, store, t };
}

test("tiers follow depth and difficulty", () => {
  assert.equal(tierFor(PERFECT).id, "perfect");
  assert.equal(tierFor(GREAT).id, "great");
  assert.equal(tierFor(GOOD).id, "good");
  assert.equal(tierFor(SHALLOW).id, "shallow");
  assert.equal(tierFor(92, "easy").id, "perfect");
  assert.equal(tierFor(PERFECT, "hard").id, "great");
});

test("combo multiplier steps up every five reps", () => {
  assert.deepEqual([0, 4, 5, 9, 10, 15, 20, 99].map(comboMultiplier), [1, 1, 1.5, 1.5, 2, 2.5, 3, 3]);
  assert.equal(comboProgress(7), 0.4);
  assert.equal(comboProgress(25), null);
});

test("scores reps with combo multipliers", () => {
  const { game, t } = playing();
  const events = [];
  for (let i = 0; i < 5; i++) events.push(...game.handle(rep(PERFECT), t + i));
  const reps = ofType(events, "rep");
  assert.deepEqual(reps.map((r) => r.points), [100, 100, 100, 100, 150]);
  assert.equal(ofType(events, "multiplier").length, 1);
  assert.equal(game.session.score, 550);
  assert.equal(game.session.maxCombo, 5);
});

test("a shallow rep breaks the combo", () => {
  const { game, t } = playing();
  for (let i = 0; i < 4; i++) game.handle(rep(GREAT), t);
  const events = game.handle(rep(SHALLOW), t);
  assert.equal(ofType(events, "rep")[0].points, 10);
  assert.equal(ofType(events, "comboBroken")[0].combo, 4);
  assert.equal(game.session.combo, 0);
  assert.equal(game.session.tiers.shallow, 1);
});

test("reps outside of play are ignored", () => {
  const game = new Game(createStore(memoryBackend()));
  assert.deepEqual(game.handle(rep(PERFECT), 0), []);
  game.start("blitz");
  game.handle({ type: "calibrated" }, 0);
  assert.equal(game.state, "countdown");
  assert.deepEqual(game.handle(rep(PERFECT), 100), []);
});

test("blitz counts down, ends at 60 seconds and saves a leaderboard entry", () => {
  const store = createStore(memoryBackend());
  const game = new Game(store);
  game.start("blitz");
  const countdown = [...game.handle({ type: "calibrated" }, 0), ...game.update(1000), ...game.update(2000), ...game.update(3000)];
  assert.deepEqual(ofType(countdown, "countdown").map((e) => e.n), [3, 2, 1]);
  assert.equal(ofType(countdown, "go").length, 1);

  game.handle(rep(PERFECT), 4000);
  game.handle(rep(GREAT), 5000);
  assert.deepEqual(game.update(62999), []);
  const end = game.update(63000);
  const { results } = ofType(end, "finished")[0];
  assert.equal(results.score, 170);
  assert.equal(results.reps, 2);
  assert.equal(results.newBest, true);
  assert.equal(new Game(store).boards.blitz[0].value, 170, "leaderboard persists");
});

test("20-rep race only counts good reps and records the time", () => {
  const { game } = playing("race");
  let t = 3000;
  let finished = null;
  game.handle(rep(SHALLOW), (t += 1000));
  for (let i = 0; i < 20 && !finished; i++) {
    finished = ofType(game.handle(rep(GOOD), (t += 2000)), "finished")[0];
  }
  assert.ok(finished);
  assert.equal(finished.results.goodReps, 20);
  assert.equal(finished.results.reps, 21);
  assert.equal(finished.results.timeMs, t - 3000);
  assert.equal(finished.results.grade, "A");
});

test("ending a race early is a DNF with no leaderboard entry", () => {
  const { game, t } = playing("race");
  game.handle(rep(GOOD), t + 1000);
  const { results } = ofType(game.end(t + 5000), "finished")[0];
  assert.equal(results.completed, false);
  assert.equal(results.grade, null);
  assert.equal(results.boardRank, null);
  assert.equal(game.boards.race.length, 0);
});

test("squat hold times the hold and unlocks hold achievements", () => {
  const { game } = playing("hold");
  const holding = { calibrated: true, tracking: true, flexion: 80 };
  const standing = { calibrated: true, tracking: true, flexion: 5 };
  const events = [];
  let t = 0;
  for (; t <= 2000; t += 33) events.push(...game.update(t, standing));
  for (; t <= 33000; t += 33) events.push(...game.update(t, holding));
  for (; t <= 34000; t += 33) events.push(...game.update(t, standing));

  assert.equal(ofType(events, "holdStart").length, 1);
  assert.ok(ofType(events, "holdTick").length >= 30);
  const { results } = ofType(events, "finished")[0];
  close(results.holdMs, 31000, 100);
  assert.ok(ofType(events, "achievement").some((e) => e.achievement.id === "hold-30"));
  assert.ok(!ofType(events, "achievement").some((e) => e.achievement.id === "hold-60"));
});

test("a brief wobble during a hold is forgiven", () => {
  const { game } = playing("hold");
  const holding = { calibrated: true, tracking: true, flexion: 80 };
  const wobble = { calibrated: true, tracking: true, flexion: 60 };
  let t = 0;
  for (; t <= 3000; t += 33) game.update(t, holding);
  for (; t <= 3300; t += 33) game.update(t, wobble);
  for (; t <= 6000; t += 33) game.update(t, holding);
  assert.equal(game.state, "playing");
  assert.equal(game.session.holding, true);
});

test("achievements unlock once and persist", () => {
  const store = createStore(memoryBackend());
  const { game, t } = playing("free", store);
  const first = ofType(game.handle(rep(PERFECT), t), "achievement").map((e) => e.achievement.id);
  assert.deepEqual(first.sort(), ["first-rep", "perfect"]);
  assert.deepEqual(ofType(game.handle(rep(PERFECT), t), "achievement"), []);
  assert.ok(new Game(store).unlocked.has("first-rep"));
});

test("rank goes up with lifetime reps", () => {
  const { game, t } = playing();
  const events = [];
  for (let i = 0; i < 10; i++) events.push(...game.handle(rep(GOOD), t));
  assert.equal(ofType(events, "rankUp")[0].rank.name, "Rookie");
  assert.equal(rankInfo(10).next.name, "Regular");
  assert.equal(rankInfo(5000).next, null);
});

test("ending during calibration returns to idle without a result", () => {
  const game = new Game(createStore(memoryBackend()));
  game.start("blitz");
  const events = game.end(500);
  assert.equal(game.state, "idle");
  assert.equal(ofType(events, "finished").length, 0);
});

test("leaderboards keep the best five in the right order", () => {
  let list = [];
  for (const value of [30, 10, 50, 20, 40, 60]) list = insertScore(list, { value }, "higher").list;
  assert.deepEqual(list.map((e) => e.value), [60, 50, 40, 30, 20]);
  const { rank } = insertScore(list, { value: 5 }, "higher");
  assert.equal(rank, null);
  const times = insertScore([{ value: 50000 }], { value: 42000 }, "lower");
  assert.equal(times.rank, 1);
});

test("free play is graded on depth quality, not speed", () => {
  const tiers = { perfect: 5, great: 0, good: 0, shallow: 0 };
  assert.equal(gradeFor({ mode: "free", reps: 5, tiers }), "S");
  assert.equal(gradeFor({ mode: "free", reps: 3, tiers }), null, "too few reps to grade");
});

test("resetting progress wipes saved data", () => {
  const store = createStore(memoryBackend());
  const { game, t } = playing("free", store);
  game.handle(rep(PERFECT), t);
  game.end(t + 1000);
  game.resetProgress();
  const fresh = new Game(store);
  assert.equal(fresh.lifetime.totalReps, 0);
  assert.equal(fresh.unlocked.size, 0);
  assert.equal(fresh.boards.free.length, 0);
});

function close(actual, expected, tol) {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}±${tol}, got ${actual}`);
}
