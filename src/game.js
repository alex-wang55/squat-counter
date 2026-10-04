import { tierFor, comboMultiplier, rankInfo, gradeFor, holdThreshold } from "./scoring.js";
import { ACHIEVEMENTS } from "./achievements.js";

export const MODES = Object.freeze({
  free: {
    id: "free",
    name: "Free Play",
    icon: "🎯",
    short: "Endless reps, build combos",
    desc: "No clock, no pressure. Chain good-depth reps to grow your combo multiplier and rack up points.",
    countdown: false,
    board: { better: "higher", format: "points" },
  },
  blitz: {
    id: "blitz",
    name: "Blitz",
    icon: "⚡",
    short: "60 seconds, max points",
    desc: "60 seconds on the clock. Deep reps and long combos score the most — speed alone won't cut it.",
    countdown: true,
    durationMs: 60000,
    board: { better: "higher", format: "points" },
  },
  race: {
    id: "race",
    name: "20-Rep Race",
    icon: "🏁",
    short: "20 good reps, fastest time",
    desc: "Hit 20 Good-or-better squats as fast as you can. Shallow reps don't count toward the 20.",
    countdown: true,
    targetReps: 20,
    board: { better: "lower", format: "time" },
  },
  hold: {
    id: "hold",
    name: "Squat Hold",
    icon: "🧱",
    short: "Hold the squat, beat the clock",
    desc: "Sink to Good depth or lower and hold it. The clock stops the moment you rise.",
    countdown: false,
    board: { better: "higher", format: "time" },
  },
});

export const COUNTDOWN_MS = 3000;
export const HOLD_ENTER_MS = 300;
export const HOLD_GRACE_MS = 600;
const BOARD_SIZE = 5;

const defaultLifetime = () => ({ totalReps: 0, totalPerfect: 0, sessions: 0, bestCombo: 0 });
const emptyBoards = () => ({ free: [], blitz: [], race: [], hold: [] });

function emptySession() {
  return {
    score: 0,
    reps: 0,
    goodReps: 0,
    combo: 0,
    maxCombo: 0,
    perfectStreak: 0,
    maxPerfectStreak: 0,
    tiers: { perfect: 0, great: 0, good: 0, shallow: 0 },
    angleSum: 0,
    startT: null,
    countdownEnd: null,
    lastCount: null,
    holding: false,
    holdStartT: null,
    holdMs: 0,
    holdPendingSince: null,
    holdBreakSince: null,
    lastHoldSecond: 0,
  };
}

export function insertScore(list, entry, better, max = BOARD_SIZE) {
  const sorted = [...list, entry]
    .sort((a, b) => (better === "higher" ? b.value - a.value : a.value - b.value))
    .slice(0, max);
  const idx = sorted.indexOf(entry);
  return { list: sorted, rank: idx === -1 ? null : idx + 1 };
}

function boardValue(r) {
  switch (r.mode) {
    case "race":
      return r.completed ? r.timeMs : null;
    case "hold":
      return r.holdMs > 0 ? r.holdMs : null;
    default:
      return r.reps > 0 ? r.score : null;
  }
}

let idCounter = 0;
const makeId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

// Game rules and progression. Like the detector, it's pure: callers pass in
// time and detector events, and get back a list of events to render.
export class Game {
  constructor(store) {
    this.store = store;
    this.lifetime = { ...defaultLifetime(), ...store.get("lifetime", {}) };
    this.unlocked = new Set(store.get("achievements", []));
    this.boards = { ...emptyBoards(), ...store.get("boards", {}) };
    this.state = "idle";
    this.mode = MODES.free;
    this.difficulty = "normal";
    this.session = emptySession();
    this.lastResults = null;
    this.lastEntryId = null;
  }

  get active() {
    return this.state === "calibrating" || this.state === "countdown" || this.state === "playing";
  }

  start(modeId, difficulty = "normal") {
    this.mode = MODES[modeId] ?? MODES.free;
    this.difficulty = difficulty;
    this.session = emptySession();
    this.lastResults = null;
    return this.#setState("calibrating");
  }

  reset() {
    this.session = emptySession();
    return this.#setState("idle");
  }

  end(t) {
    if (this.state === "playing") return this.#finish(t, false);
    if (this.state === "calibrating" || this.state === "countdown") return this.reset();
    return [];
  }

  resetProgress() {
    this.lifetime = defaultLifetime();
    this.unlocked = new Set();
    this.boards = emptyBoards();
    this.lastEntryId = null;
    this.store.set("lifetime", this.lifetime);
    this.store.set("achievements", []);
    this.store.set("boards", this.boards);
  }

  handle(evt, t) {
    if (evt.type === "calibrated" && this.state === "calibrating") return this.#afterCalibration(t);
    if (this.state !== "playing" || this.mode.id === "hold") return [];
    if (evt.type === "rep") return this.#scoreRep(evt, t);
    if (evt.type === "repRejected") return [{ type: "rejected", reason: evt.reason }];
    if (evt.type === "repAbandoned") return [{ type: "rejected", reason: "lost" }];
    return [];
  }

  update(t, det) {
    const s = this.session;
    if (this.state === "countdown") {
      const remaining = s.countdownEnd - t;
      if (remaining <= 0) return this.#begin(t);
      const n = Math.ceil(remaining / 1000);
      if (n === s.lastCount) return [];
      s.lastCount = n;
      return [{ type: "countdown", n }];
    }
    if (this.state !== "playing") return [];
    if (this.mode.id === "blitz" && t >= s.startT + this.mode.durationMs) return this.#finish(t, true);
    if (this.mode.id === "hold") return this.#updateHold(t, det);
    return [];
  }

  hud(t) {
    const s = this.session;
    const playing = this.state === "playing";
    const finished = this.state === "finished";
    switch (this.mode.id) {
      case "blitz":
        return {
          kind: "remaining",
          timer: playing ? Math.max(0, s.startT + this.mode.durationMs - t) : finished ? 0 : this.mode.durationMs,
        };
      case "hold":
        return { kind: "hold", timer: s.holding ? t - s.holdStartT : s.holdMs, holding: s.holding };
      default:
        return { kind: "elapsed", timer: playing ? t - s.startT : finished ? this.lastResults?.durationMs ?? 0 : 0 };
    }
  }

  #setState(state) {
    this.state = state;
    return [{ type: "state", state }];
  }

  #afterCalibration(t) {
    if (!this.mode.countdown) return this.#begin(t);
    this.session.countdownEnd = t + COUNTDOWN_MS;
    this.session.lastCount = null;
    return [...this.#setState("countdown"), ...this.update(t)];
  }

  #begin(t) {
    this.session.startT = t;
    return [...this.#setState("playing"), { type: "go" }];
  }

  #scoreRep(evt, t) {
    const s = this.session;
    const events = [];
    const tier = tierFor(evt.flexion, this.difficulty);
    const good = tier.id !== "shallow";
    const prevCombo = s.combo;

    s.combo = good ? s.combo + 1 : 0;
    const multiplier = good ? comboMultiplier(s.combo) : 1;
    const points = Math.round(tier.points * multiplier);
    s.score += points;
    s.reps += 1;
    s.tiers[tier.id] += 1;
    s.angleSum += evt.minAngle;
    if (good) s.goodReps += 1;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.perfectStreak = tier.id === "perfect" ? s.perfectStreak + 1 : 0;
    s.maxPerfectStreak = Math.max(s.maxPerfectStreak, s.perfectStreak);

    const rankBefore = rankInfo(this.lifetime.totalReps).rank;
    this.lifetime.totalReps += 1;
    if (tier.id === "perfect") this.lifetime.totalPerfect += 1;
    this.lifetime.bestCombo = Math.max(this.lifetime.bestCombo, s.combo);
    this.store.set("lifetime", this.lifetime);

    events.push({ type: "rep", tier, points, multiplier, combo: s.combo, minAngle: evt.minAngle, flexion: evt.flexion });
    if (!good && prevCombo >= 3) events.push({ type: "comboBroken", combo: prevCombo });
    if (good && multiplier > comboMultiplier(prevCombo)) events.push({ type: "multiplier", multiplier, combo: s.combo });

    const rankAfter = rankInfo(this.lifetime.totalReps).rank;
    if (rankAfter !== rankBefore) events.push({ type: "rankUp", rank: rankAfter });
    events.push(...this.#checkAchievements(t));

    if (this.mode.id === "race" && s.goodReps >= this.mode.targetReps) events.push(...this.#finish(t, true));
    return events;
  }

  #updateHold(t, det) {
    const s = this.session;
    const inPose = Boolean(det?.calibrated && det.tracking && det.flexion >= holdThreshold(this.difficulty));

    if (!s.holding) {
      if (!inPose) {
        s.holdPendingSince = null;
        return [];
      }
      s.holdPendingSince ??= t;
      if (t - s.holdPendingSince < HOLD_ENTER_MS) return [];
      s.holding = true;
      s.holdStartT = s.holdPendingSince;
      s.holdBreakSince = null;
      s.lastHoldSecond = 0;
      return [{ type: "holdStart" }];
    }

    if (inPose) {
      s.holdBreakSince = null;
      const secs = Math.floor((t - s.holdStartT) / 1000);
      if (secs <= s.lastHoldSecond) return [];
      s.lastHoldSecond = secs;
      return [{ type: "holdTick", seconds: secs }, ...this.#checkAchievements(t)];
    }

    s.holdBreakSince ??= t;
    if (t - s.holdBreakSince < HOLD_GRACE_MS) return [];
    s.holdMs = s.holdBreakSince - s.holdStartT;
    s.holding = false;
    return [{ type: "holdEnd", holdMs: s.holdMs }, ...this.#finish(t, true)];
  }

  #finish(t, completed) {
    const s = this.session;
    if (s.holding) {
      s.holdMs = t - s.holdStartT;
      s.holding = false;
    }
    const durationMs = s.startT == null ? 0 : t - s.startT;
    const results = {
      mode: this.mode.id,
      difficulty: this.difficulty,
      completed,
      score: s.score,
      reps: s.reps,
      goodReps: s.goodReps,
      tiers: { ...s.tiers },
      maxCombo: s.maxCombo,
      avgAngle: s.reps ? s.angleSum / s.reps : null,
      durationMs,
      timeMs: this.mode.id === "race" ? durationMs : null,
      holdMs: this.mode.id === "hold" ? s.holdMs : null,
    };
    results.grade = gradeFor(results);

    const value = boardValue(results);
    results.boardRank = null;
    this.lastEntryId = null;
    if (value != null) {
      const entry = { id: makeId(), value, date: Date.now(), difficulty: this.difficulty };
      const { list, rank } = insertScore(this.boards[this.mode.id], entry, this.mode.board.better);
      this.boards[this.mode.id] = list;
      this.store.set("boards", this.boards);
      results.boardRank = rank;
      if (rank) this.lastEntryId = entry.id;
    }
    results.newBest = results.boardRank === 1;

    this.lifetime.sessions += 1;
    this.store.set("lifetime", this.lifetime);
    this.lastResults = results;
    return [...this.#setState("finished"), { type: "finished", results }, ...this.#checkAchievements(t)];
  }

  #checkAchievements(t) {
    const s = this.session;
    const ctx = {
      lifetime: this.lifetime,
      session: s,
      mode: this.mode.id,
      holdMs: s.holding ? t - s.holdStartT : s.holdMs,
      result: this.state === "finished" ? this.lastResults : null,
    };
    const fresh = ACHIEVEMENTS.filter((a) => !this.unlocked.has(a.id) && a.test(ctx));
    if (!fresh.length) return [];
    fresh.forEach((a) => this.unlocked.add(a.id));
    this.store.set("achievements", [...this.unlocked]);
    return fresh.map((achievement) => ({ type: "achievement", achievement }));
  }
}
