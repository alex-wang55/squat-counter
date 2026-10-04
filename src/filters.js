// One Euro filter (Casiez et al. 2012): heavy smoothing when a signal is still,
// light smoothing when it moves fast — removes landmark jitter without adding
// noticeable lag during the actual squat.
export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  filter(value, tMs) {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = tMs;
      return value;
    }
    let dt = (tMs - this.t) / 1000;
    if (!(dt > 0)) dt = 1 / 60;

    const rawDx = (value - this.x) / dt;
    const aD = smoothingFactor(dt, this.dCutoff);
    this.dx = aD * rawDx + (1 - aD) * this.dx;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = smoothingFactor(dt, cutoff);
    this.x = a * value + (1 - a) * this.x;
    this.t = tMs;
    return this.x;
  }
}

function smoothingFactor(dt, cutoff) {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}
