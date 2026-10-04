// Tiny synthesized sound effects — no audio files to download.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  // Browsers only allow audio after a user gesture, so call this from a click.
  unlock() {
    if (!this.ctx) {
      const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  #tone(freq, { at = 0, dur = 0.12, type = "sine", vol = 0.25, to = null } = {}) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  #arpeggio(freqs, step, opts) {
    freqs.forEach((f, i) => this.#tone(f, { ...opts, at: (opts.at ?? 0) + i * step }));
  }

  rep(tierId) {
    switch (tierId) {
      case "perfect":
        this.#arpeggio([523, 659, 784, 1047, 1319], 0.05, { dur: 0.2, type: "triangle", vol: 0.22 });
        break;
      case "great":
        this.#arpeggio([659, 880, 1175], 0.06, { dur: 0.18, type: "triangle", vol: 0.22 });
        break;
      case "good":
        this.#arpeggio([587, 784], 0.06, { dur: 0.14, type: "sine", vol: 0.25 });
        break;
      default:
        this.#tone(196, { dur: 0.2, type: "square", vol: 0.06, to: 150 });
    }
  }

  multiplier() {
    this.#tone(330, { dur: 0.35, type: "sawtooth", vol: 0.07, to: 1320 });
    this.#arpeggio([1047, 1319, 1568], 0.07, { at: 0.25, dur: 0.18, type: "triangle", vol: 0.18 });
  }

  comboBreak() {
    this.#tone(392, { dur: 0.35, type: "sawtooth", vol: 0.06, to: 110 });
  }

  countdown() {
    this.#tone(440, { dur: 0.16, type: "square", vol: 0.08 });
  }

  go() {
    this.#arpeggio([659, 880], 0.08, { dur: 0.3, type: "square", vol: 0.09 });
  }

  tick() {
    this.#tone(1400, { dur: 0.04, type: "sine", vol: 0.06 });
  }

  achievement() {
    this.#arpeggio([784, 988, 1175, 1568, 1976], 0.06, { dur: 0.25, type: "triangle", vol: 0.16 });
  }

  finish() {
    this.#arpeggio([523, 659, 784], 0.12, { dur: 0.22, type: "square", vol: 0.08 });
    this.#tone(1047, { at: 0.4, dur: 0.6, type: "triangle", vol: 0.2 });
  }
}
