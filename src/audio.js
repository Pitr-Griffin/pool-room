// Весь звук синтезируется в браузере: тихий светлый эмбиент, плеск,
// шаги по кафелю с эхом, птицы днём и сверчки ночью.

const CHORD = [110, 164.81, 246.94, 277.18, 329.63]; // A add9 — светлый, без грусти

export class SoundScape {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.birdT = 2;
    this.cricketT = 1;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet);
    wet.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startPad();
    this.startWater();
  }

  impulse(seconds, decay) {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  out(node, wet) {
    node.connect(this.master);
    if (wet > 0) {
      const send = this.ctx.createGain();
      send.gain.value = wet;
      node.connect(send);
      send.connect(this.reverb);
    }
  }

  startPad() {
    const { ctx } = this;
    const now = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + 6);
    lp.connect(bus);
    this.out(bus, 0.9);

    CHORD.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.016 : 0.007;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.04 + Math.random() * 0.07;
      const depth = ctx.createGain();
      depth.gain.value = g.gain.value * 0.6;
      lfo.connect(depth);
      depth.connect(g.gain);
      osc.connect(g);
      g.connect(lp);
      osc.start();
      lfo.start();
    });
  }

  startWater() {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const depth = ctx.createGain();
    depth.gain.value = 0.022;
    lfo.connect(depth);
    depth.connect(g.gain);
    src.connect(lp);
    lp.connect(g);
    this.out(g, 0.6);
    src.start();
    lfo.start();
  }

  get ready() {
    return this.ctx && !this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.15);
    return this.muted;
  }

  // Короткий всплеск отфильтрованного шума.
  burst({ type = 'bandpass', freq, freqEnd, q = 1, attack = 0.004, decay, peak, wet, delay = 0 }) {
    const { ctx } = this;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f);
    f.connect(g);
    this.out(g, wet);
    src.start(t, Math.random() * 1.4, attack + decay + 0.05);
  }

  tone({ freq, freqEnd, type = 'sine', attack = 0.003, decay, peak, wet, delay = 0, pan = 0 }) {
    const { ctx } = this;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    let node = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    this.out(node, wet);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  step(kind) {
    if (!this.ready) return;
    const v = 0.8 + Math.random() * 0.4;
    if (kind === 'tile') {
      this.burst({ freq: 1900 * v, q: 1.4, decay: 0.07, peak: 0.16, wet: 0.9 });
      this.tone({ freq: 150 * v, freqEnd: 90, decay: 0.07, peak: 0.1, wet: 0.5 });
    } else if (kind === 'grass') {
      this.burst({ type: 'highpass', freq: 3200, decay: 0.12, attack: 0.02, peak: 0.035, wet: 0.2 });
      this.tone({ freq: 140 * v, freqEnd: 90, decay: 0.06, peak: 0.05, wet: 0.3 });
    } else if (kind === 'water') {
      this.splash(0.45 * v);
    }
  }

  splash(amount = 1) {
    if (!this.ready) return;
    const a = Math.min(amount, 1.4);
    this.burst({ freq: 1500, freqEnd: 380, q: 0.8, attack: 0.012, decay: 0.32 + a * 0.2, peak: 0.2 * a, wet: 0.5 });
    this.burst({ type: 'highpass', freq: 2600, attack: 0.01, decay: 0.18, peak: 0.05 * a, wet: 0.4, delay: 0.07 });
    for (let i = 0; i < 3; i++) {
      this.tone({ freq: 900 + Math.random() * 900, freqEnd: 1800 + Math.random() * 900, decay: 0.05, peak: 0.02 * a, wet: 0.6, delay: 0.1 + Math.random() * 0.3 });
    }
  }

  thump(strength = 1) {
    if (!this.ready) return;
    const a = Math.min(Math.max(strength, 0.15), 1.2);
    this.tone({ freq: 210, freqEnd: 120, decay: 0.16, peak: 0.12 * a, wet: 0.6 });
    this.burst({ type: 'lowpass', freq: 600, decay: 0.06, peak: 0.08 * a, wet: 0.5 });
  }

  chirp(vol) {
    const pan = (Math.random() - 0.5) * 1.2;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2400 + Math.random() * 1600;
    for (let i = 0; i < notes; i++) {
      const f = base * (0.85 + Math.random() * 0.4);
      this.tone({ freq: f, freqEnd: f * (0.7 + Math.random() * 0.7), decay: 0.05 + Math.random() * 0.06, peak: 0.018 * vol, wet: 0.25, delay: i * (0.09 + Math.random() * 0.05), pan });
    }
  }

  cricket(vol) {
    const pan = (Math.random() - 0.5) * 1.4;
    for (let i = 0; i < 3; i++) {
      this.tone({ freq: 4500, decay: 0.025, peak: 0.006 * vol, wet: 0.3, delay: i * 0.045, pan });
    }
  }

  update(dt, day, night) {
    if (!this.ready) return;
    this.birdT -= dt;
    if (this.birdT < 0) {
      if (day > 0.3) this.chirp(day);
      this.birdT = 2.5 + Math.random() * 6;
    }
    this.cricketT -= dt;
    if (this.cricketT < 0) {
      if (night > 0.3) this.cricket(night);
      this.cricketT = 0.5 + Math.random() * 0.9;
    }
  }
}
