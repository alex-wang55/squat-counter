import { OneEuroFilter } from "./filters.js";

export const DETECTOR_DEFAULTS = Object.freeze({
  // Calibration: legs this straight, held this long, defines "standing".
  calibrationMs: 1000,
  minStandAngle: 150,
  maxStandDrop: 0.3,
  // Knee flexion (degrees past your calibrated standing angle) that starts a rep...
  startFlex: 35,
  // ...and the near-straight flexion that ends it.
  endFlex: 20,
  // Hips must drop at least this much (relative to standing) for the rep to count,
  // and come back within this much before the rep is considered finished.
  minRepDrop: 0.06,
  endDrop: 0.08,
  // A phase change must hold this long, so single noisy frames can't flip state.
  confirmMs: 90,
  minRepMs: 450,
  maxRepMs: 10000,
  // Tracking may drop out this long mid-rep before the rep is abandoned.
  lostGraceMs: 600,
  // How far the standing reference may drift from calibration while you play.
  maxAngleDrift: 10,
  maxDropDrift: 0.1,
});

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Turns a stream of pose measurements into rep events. Pure logic — no DOM,
// no camera — so it can be unit tested with synthetic data.
export class SquatDetector {
  constructor(options = {}) {
    this.cfg = { ...DETECTOR_DEFAULTS, ...options };
    this.angleFilter = new OneEuroFilter({ minCutoff: 1.8, beta: 0.05 });
    this.dropFilter = new OneEuroFilter({ minCutoff: 1.8, beta: 8 });
    this.tracking = false;
    this.reason = "noPerson";
    this.lostSince = null;
    this.lostNotified = false;
    this.recalibrate();
  }

  recalibrate() {
    this.calibrated = false;
    this.calibrationProgress = 0;
    this.calSamples = [];
    this.calStart = null;
    this.calAngle = null;
    this.calDrop = null;
    this.standAngle = null;
    this.standDrop = null;
    this.phase = "up";
    this.rep = null;
    this.pendingSince = null;
    this.angle = null;
    this.flexion = 0;
    this.relDrop = 0;
  }

  get state() {
    return {
      calibrated: this.calibrated,
      calibrationProgress: this.calibrationProgress,
      tracking: this.tracking,
      reason: this.reason,
      phase: this.phase,
      angle: this.angle,
      flexion: this.flexion,
      hipDrop: this.relDrop,
      standAngle: this.standAngle,
      standDrop: this.standDrop,
      repMaxFlexion: this.rep?.maxFlex ?? 0,
    };
  }

  update(m, t) {
    return m.ok ? this.#onValid(m, t) : this.#onInvalid(m, t);
  }

  #onInvalid(m, t) {
    const events = [];
    this.tracking = false;
    this.reason = m.reason;
    this.pendingSince = null;
    if (this.lostSince === null) this.lostSince = t;
    if (!this.calibrated) this.#resetCalibrationProgress();

    if (!this.lostNotified && t - this.lostSince >= this.cfg.lostGraceMs) {
      this.lostNotified = true;
      if (this.phase === "down") {
        this.phase = "up";
        this.rep = null;
        events.push({ type: "repAbandoned" });
      }
      events.push({ type: "trackingLost", reason: m.reason });
    }
    return events;
  }

  #onValid(m, t) {
    const events = [];
    if (this.lostSince !== null) {
      if (t - this.lostSince >= this.cfg.lostGraceMs) {
        this.angleFilter.reset();
        this.dropFilter.reset();
      }
      if (this.lostNotified) events.push({ type: "trackingRegained" });
      this.lostSince = null;
      this.lostNotified = false;
    }
    this.tracking = true;
    this.reason = null;

    const angle = this.angleFilter.filter(m.kneeAngle, t);
    const drop = this.dropFilter.filter(m.hipDrop, t);
    this.angle = angle;

    if (!this.calibrated) {
      this.#calibrate(angle, drop, t, events);
      return events;
    }

    const cfg = this.cfg;
    const flex = Math.max(0, this.standAngle - angle);
    const relDrop = drop - this.standDrop;
    this.flexion = flex;
    this.relDrop = relDrop;

    if (this.phase === "up") {
      if (flex < cfg.endFlex / 2) this.#drift(angle, drop);
      if (this.#confirm(flex >= cfg.startFlex, t)) {
        this.phase = "down";
        this.rep = { startT: this.confirmedSince, maxFlex: flex, minAngle: angle, maxDrop: relDrop };
        events.push({ type: "repStart" });
      }
      return events;
    }

    const rep = this.rep;
    rep.maxFlex = Math.max(rep.maxFlex, flex);
    rep.minAngle = Math.min(rep.minAngle, angle);
    rep.maxDrop = Math.max(rep.maxDrop, relDrop);

    // Standing back up means straight knees AND hips back at standing height —
    // straight-looking legs under a seated torso don't finish a rep.
    if (this.#confirm(flex < cfg.endFlex && relDrop < cfg.endDrop, t)) {
      const durationMs = t - rep.startT;
      let reason = null;
      if (durationMs < cfg.minRepMs) reason = "tooFast";
      else if (durationMs > cfg.maxRepMs) reason = "tooSlow";
      else if (rep.maxDrop < cfg.minRepDrop) reason = "noHipDrop";

      const detail = { flexion: rep.maxFlex, minAngle: rep.minAngle, hipDrop: rep.maxDrop, durationMs };
      events.push(reason ? { type: "repRejected", reason, ...detail } : { type: "rep", ...detail });
      this.phase = "up";
      this.rep = null;
    }
    return events;
  }

  #calibrate(angle, drop, t, events) {
    const cfg = this.cfg;
    const standing = angle >= cfg.minStandAngle && drop <= cfg.maxStandDrop;
    if (!standing) {
      this.#resetCalibrationProgress();
      return;
    }
    if (this.calStart === null) this.calStart = t;
    this.calSamples.push({ angle, drop });
    this.calibrationProgress = Math.min(1, (t - this.calStart) / cfg.calibrationMs);
    if (this.calibrationProgress < 1 || this.calSamples.length < 5) return;

    this.calAngle = Math.min(180, median(this.calSamples.map((s) => s.angle)));
    this.calDrop = median(this.calSamples.map((s) => s.drop));
    this.standAngle = this.calAngle;
    this.standDrop = this.calDrop;
    this.calibrated = true;
    events.push({ type: "calibrated", standAngle: this.standAngle });
  }

  #resetCalibrationProgress() {
    this.calSamples = [];
    this.calStart = null;
    this.calibrationProgress = 0;
  }

  // Slowly follow small stance changes while standing, but never far enough
  // for a long stretch of bad tracking to corrupt the reference.
  #drift(angle, drop) {
    const cfg = this.cfg;
    this.standAngle = clamp(
      this.standAngle + (angle - this.standAngle) * 0.01,
      this.calAngle - cfg.maxAngleDrift,
      Math.min(180, this.calAngle + cfg.maxAngleDrift)
    );
    this.standDrop = clamp(
      this.standDrop + (drop - this.standDrop) * 0.01,
      this.calDrop - cfg.maxDropDrift,
      this.calDrop + cfg.maxDropDrift
    );
  }

  #confirm(condition, t) {
    if (!condition) {
      this.pendingSince = null;
      return false;
    }
    if (this.pendingSince === null) this.pendingSince = t;
    if (t - this.pendingSince < this.cfg.confirmMs) return false;
    this.confirmedSince = this.pendingSince;
    this.pendingSince = null;
    return true;
  }
}
