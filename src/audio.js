// Tiny synthesized sound effects — no audio files to download.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
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

  // Punchy sub-bass thump for big hits.
  #kick({ at = 0, vol = 0.5 } = {}) {
    this.#tone(160, { at, dur: 0.28, type: "sine", vol, to: 42 });
  }

  // Filtered noise sweep, the "whoosh" under risers and the Go banner.
  #whoosh({ at = 0, dur = 0.45, vol = 0.12, from = 300, to = 5000 } = {}) {
    if (this.muted || !this.ctx) return;
    if (!this.noise) {
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  rep(tierId) {
    switch (tierId) {
      case "perfect":
        this.#kick({ vol: 0.55 });
        this.#arpeggio([523, 659, 784, 1047, 1319], 0.05, { dur: 0.2, type: "triangle", vol: 0.22 });
        this.#tone(2093, { at: 0.25, dur: 0.5, type: "sine", vol: 0.07 });
        break;
      case "great":
        this.#kick({ vol: 0.3 });
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
    this.#whoosh({ dur: 0.35, vol: 0.1 });
    this.#tone(330, { dur: 0.35, type: "sawtooth", vol: 0.07, to: 1320 });
    this.#kick({ at: 0.3, vol: 0.5 });
    this.#arpeggio([1047, 1319, 1568], 0.07, { at: 0.25, dur: 0.18, type: "triangle", vol: 0.18 });
  }

  comboBreak() {
    this.#tone(392, { dur: 0.35, type: "sawtooth", vol: 0.06, to: 110 });
  }

  countdown() {
    this.#tone(440, { dur: 0.16, type: "square", vol: 0.08 });
  }

  go() {
    this.#whoosh({ dur: 0.3, vol: 0.1, from: 600, to: 6000 });
    this.#kick({ vol: 0.45 });
    this.#arpeggio([659, 880], 0.08, { dur: 0.3, type: "square", vol: 0.09 });
  }

  tick() {
    this.#tone(1400, { dur: 0.04, type: "sine", vol: 0.06 });
  }

  achievement() {
    this.#arpeggio([784, 988, 1175, 1568, 1976], 0.06, { dur: 0.25, type: "triangle", vol: 0.16 });
  }

  finish() {
    this.#kick({ at: 0.4, vol: 0.45 });
    this.#arpeggio([523, 659, 784], 0.12, { dur: 0.22, type: "square", vol: 0.08 });
    this.#tone(1047, { at: 0.4, dur: 0.6, type: "triangle", vol: 0.2 });
  }
}
