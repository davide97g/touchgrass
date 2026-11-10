import type { AudioEngine } from './AudioEngine';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export type Call = 'sheep' | 'horse' | 'chicken' | 'owl' | 'frog' | 'kite' | 'fox' | 'cat' | 'deer' | 'heron' | 'cow' | 'dog' | 'wolf' | 'raven' | 'bear' | 'duck' | 'squirrel';

/**
 * One-shot sounds, all synthesized: the camera shutter, discovery chimes, the sparkle of a new
 * journal entry, wind rushes in flight, and the voices of the animals you come near.
 */
export class Sfx {
  private noise: AudioBuffer | null = null;
  private next: Partial<Record<Call, number>> = {};

  constructor(private readonly audio: AudioEngine) {}

  private get ctx(): AudioContext | null {
    return this.audio.running ? this.audio.ctx : null;
  }

  private noiseBuf(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    return b;
  }

  /** An output chain: gain -> pan -> master (auto-disconnects). */
  private out(level: number, pan = 0, life = 4): GainNode {
    const ctx = this.audio.ctx!;
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.95, Math.min(0.95, pan));
    g.connect(p).connect(this.audio.input);
    window.setTimeout(() => {
      g.disconnect();
      p.disconnect();
    }, life * 1000);
    return g;
  }

  private burst(dst: AudioNode, at: number, dur: number, type: BiquadFilterType, f: number, q: number, level: number, attack = 0.002): void {
    const ctx = this.audio.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf(ctx);
    s.loopStart = Math.random();
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(fl).connect(g).connect(dst);
    s.start(at, Math.random() * 1.5);
    s.stop(at + dur + 0.05);
  }

  private tone(dst: AudioNode, at: number, f: number, dur: number, level: number, type: OscillatorType = 'sine', attack = 0.005, bend = 0): OscillatorNode {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (bend) o.frequency.exponentialRampToValueAtTime(f * bend, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dst);
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  }

  /** Mirror up, curtain, mirror down: a soft mechanical shutter. */
  shutter(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const o = this.out(0.5);
    this.burst(o, t, 0.035, 'bandpass', 3200, 1.2, 0.9);
    this.burst(o, t + 0.004, 0.05, 'lowpass', 900, 0.8, 0.5);
    this.burst(o, t + 0.075, 0.04, 'bandpass', 2400, 1.5, 0.7);
    this.burst(o, t + 0.08, 0.06, 'lowpass', 600, 0.7, 0.4);
  }

  /** A soft tick as the focus settles. */
  focusTick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const o = this.out(0.12);
    this.tone(o, t, 2600, 0.05, 0.6, 'sine');
    this.tone(o, t + 0.06, 3900, 0.06, 0.5, 'sine');
  }

  /** Discovery: a little bell phrase (longer and brighter for rarer things). */
  chime(rarity: 'common' | 'uncommon' | 'rare' | 'legendary'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const o = this.out(0.16, 0, 8);
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    const base = 523.25 * (rarity === 'legendary' ? 0.75 : 1);
    const n = rarity === 'common' ? 3 : rarity === 'uncommon' ? 4 : rarity === 'rare' ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const f = base * Math.pow(2, scale[(i * 2) % scale.length] / 12);
      const at = t + i * 0.11;
      this.tone(o, at, f, 2.2, 0.5, 'sine', 0.004);
      this.tone(o, at, f * 2.76, 0.9, 0.12, 'sine', 0.002);
      this.tone(o, at, f * 5.4, 0.4, 0.05, 'sine', 0.002);
    }
    if (rarity === 'legendary' || rarity === 'rare') {
      for (let i = 0; i < 14; i++) this.tone(o, t + 0.5 + i * 0.045, rand(2500, 6000), 0.5, 0.04, 'sine', 0.002);
    }
  }

  /** Collected: a rising sparkle and a warm chord. */
  collect(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const o = this.out(0.14, 0, 8);
    for (const [i, f] of [392, 493.88, 587.33, 783.99].entries()) this.tone(o, t + i * 0.03, f, 3, 0.35, 'triangle', 0.02);
    for (let i = 0; i < 18; i++) this.tone(o, t + 0.15 + i * 0.035, 1600 + i * 180 + rand(-60, 60), 0.35, 0.05, 'sine', 0.002);
  }

  /** Rushing air for take-off, boost and landing. */
  whoosh(level = 1, dur = 1.4, up = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.5 * level, 0, dur + 1);
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf(ctx);
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(up ? 300 : 1800, t);
    f.frequency.exponentialRampToValueAtTime(up ? 2200 : 260, t + dur * 0.45);
    f.frequency.exponentialRampToValueAtTime(up ? 500 : 180, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(o);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  /** A soft landing thump with grass rustle. */
  thud(level = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.5 * level);
    this.tone(o, t, 90, 0.25, 0.8, 'sine', 0.004, 0.5);
    this.burst(o, t, 0.5, 'bandpass', 1400, 0.6, 0.35, 0.01);
  }

  // ---------------------------------------------------------------- the game

  /** A light gathered: a glassy note that climbs with each one in a row. */
  pickup(combo: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const o = this.out(0.2, 0, 4);
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const f = 659.25 * Math.pow(2, scale[Math.min(combo, scale.length - 1)] / 12);
    this.tone(o, t, f, 1.4, 0.5, 'sine', 0.003);
    this.tone(o, t, f * 2, 0.7, 0.2, 'sine', 0.002);
    this.tone(o, t + 0.06, f * 1.5, 1.0, 0.25, 'sine', 0.003);
    for (let i = 0; i < 5; i++) this.tone(o, t + 0.03 * i, rand(3000, 6500), 0.25, 0.04, 'sine', 0.002);
  }

  /** Experience earned: a soft tick. */
  xp(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const o = this.out(0.07, 0, 2);
    this.tone(o, t, 1318, 0.18, 0.5, 'sine', 0.003);
    this.tone(o, t + 0.07, 1760, 0.22, 0.4, 'sine', 0.003);
  }

  /** A new rank: a bright rising fanfare. */
  levelUp(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const o = this.out(0.17, 0, 9);
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const at = t + i * 0.12;
      this.tone(o, at, f, i === notes.length - 1 ? 3.4 : 1.2, 0.4, 'triangle', 0.01);
      this.tone(o, at, f * 2, 0.8, 0.12, 'sine', 0.005);
    });
    for (const f of [523.25, 659.25, 783.99]) this.tone(o, t + 0.62, f, 3.6, 0.22, 'triangle', 0.05);
    for (let i = 0; i < 22; i++) this.tone(o, t + 0.6 + i * 0.05, rand(2200, 7000), 0.5, 0.035, 'sine', 0.002);
  }

  /** A quest finished: a warm cadence. */
  questDone(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const o = this.out(0.16, 0, 9);
    for (const [i, chord] of [[349.23, 440, 523.25], [392, 493.88, 587.33], [523.25, 659.25, 783.99, 1046.5]].entries()) {
      for (const f of chord) this.tone(o, t + i * 0.34, f, i === 2 ? 4 : 0.9, 0.24, 'triangle', 0.02);
    }
    for (let i = 0; i < 14; i++) this.tone(o, t + 0.75 + i * 0.05, rand(2000, 5200), 0.5, 0.035, 'sine', 0.002);
  }

  /** A sigil wakes: a deep bell, a rising shimmer. */
  sigil(n: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.03;
    const o = this.out(0.22, 0, 12);
    const base = 110 * Math.pow(2, [0, 3, 5, 7, 10][Math.min(4, Math.max(0, n - 1))] / 12);
    for (const [m, lv, d] of [[1, 0.6, 6], [2.01, 0.3, 4.5], [2.76, 0.22, 3.4], [5.4, 0.1, 2], [8.9, 0.05, 1.2]] as const) this.tone(o, t, base * m, d, lv, 'sine', 0.004);
    this.burst(o, t, 0.6, 'lowpass', 300, 0.7, 0.5, 0.01);
    for (let i = 0; i < 26; i++) this.tone(o, t + 0.4 + i * 0.07, base * 4 * Math.pow(2, [0, 3, 5, 7, 10, 12][i % 6] / 12) * (i > 12 ? 2 : 1), 0.9, 0.05, 'sine', 0.01);
  }

  /** A chest opens: latch, creak, a spill of gold. */
  chest(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.22, 0, 6);
    this.burst(o, t, 0.05, 'bandpass', 2600, 2, 0.8);
    this.tone(o, t + 0.08, 180, 0.5, 0.25, 'sawtooth', 0.05, 1.6);
    this.burst(o, t + 0.1, 0.5, 'bandpass', 700, 3, 0.25, 0.08);
    for (let i = 0; i < 16; i++) this.tone(o, t + 0.5 + i * 0.045, [1046.5, 1318.5, 1568, 2093][i % 4] * (1 + Math.floor(i / 8)), 0.6, 0.09, 'sine', 0.003);
  }

  /** Paper unpinned from a post. */
  page(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.2, 0, 3);
    this.burst(o, t, 0.16, 'highpass', 2500, 0.7, 0.5, 0.02);
    this.burst(o, t + 0.14, 0.22, 'bandpass', 4200, 0.9, 0.4, 0.04);
    this.tone(o, t + 0.3, 880, 0.9, 0.12, 'sine', 0.01);
    this.tone(o, t + 0.42, 1174.7, 1.1, 0.1, 'sine', 0.01);
  }

  /** Something refuses: two low dull notes. */
  deny(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.16, 0, 3);
    this.tone(o, t, 196, 0.25, 0.5, 'triangle', 0.01);
    this.tone(o, t + 0.16, 174.6, 0.45, 0.5, 'triangle', 0.01);
  }

  /** A contented little sound for an animal that let itself be stroked. */
  pet(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.13, 0, 3);
    this.tone(o, t, 783.99, 0.3, 0.4, 'sine', 0.01);
    this.tone(o, t + 0.12, 987.77, 0.3, 0.4, 'sine', 0.01);
    this.tone(o, t + 0.24, 1174.7, 0.6, 0.4, 'sine', 0.01);
  }

  /** Stone grinding on stone, for as long as the door moves. */
  rumble(dur: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.6, 0, dur + 2);
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf(ctx);
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 130;
    f.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lg = ctx.createGain();
    lg.gain.value = 60;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.6);
    g.gain.setValueAtTime(1, t + dur - 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    s.connect(f).connect(g).connect(o);
    s.start(t);
    lfo.start(t);
    s.stop(t + dur + 0.5);
    lfo.stop(t + dur + 0.5);
    this.tone(o, t, 41, dur, 0.5, 'sine', 0.5);
    this.tone(o, t + dur - 0.1, 55, 1.6, 0.9, 'sine', 0.005, 0.5);
  }

  /** The sky serpent wakes. */
  roar(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const o = this.out(0.5, 0, 8);
    for (const [f0, lv] of [[82, 0.6], [123, 0.4], [164.8, 0.25]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0 * 0.6, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 1.2);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + 4.2);
      const fl = ctx.createBiquadFilter();
      fl.type = 'bandpass';
      fl.frequency.setValueAtTime(300, t);
      fl.frequency.exponentialRampToValueAtTime(1400, t + 1.3);
      fl.frequency.exponentialRampToValueAtTime(350, t + 4.2);
      fl.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lv, t + 0.5);
      g.gain.setValueAtTime(lv, t + 2.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.6);
      osc.connect(fl).connect(g).connect(o);
      osc.start(t);
      osc.stop(t + 4.7);
    }
    this.burst(o, t, 4.2, 'bandpass', 900, 0.6, 0.5, 0.6);
    for (let i = 0; i < 20; i++) this.tone(o, t + 1.5 + i * 0.12, rand(1500, 4000), 1.2, 0.03, 'sine', 0.05);
  }

  /** The cloud whale sings: long notes sliding like weather. */
  whale(level: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const o = this.out(0.22 * level, pan, 12);
    const starts = [146.8, 196, 220, 261.6];
    for (let i = 0; i < 3; i++) {
      const f0 = starts[Math.floor(Math.random() * starts.length)];
      const at = t + i * rand(1.8, 2.6);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(f0 * rand(1.3, 2.1), at + 1.4);
      osc.frequency.exponentialRampToValueAtTime(f0 * rand(0.7, 1.1), at + 3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.5, at + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.2);
      osc.connect(g).connect(o);
      osc.start(at);
      osc.stop(at + 3.3);
    }
  }

  /** Kodama: a dry wooden rattle as the head turns. */
  rattle(pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.2, pan, 3);
    for (let i = 0; i < 9; i++) {
      const at = t + i * 0.05 + (i > 4 ? (i - 4) * 0.012 : 0);
      this.burst(o, at, 0.03, 'bandpass', rand(1700, 2600), 9, 0.9);
      this.tone(o, at, rand(900, 1300), 0.03, 0.2, 'triangle', 0.001);
    }
  }

  /** Through a ring of the wind trial. */
  ring(i: number, last: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const o = this.out(0.2, 0, 5);
    const f = 440 * Math.pow(2, [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19][i % 12] / 12);
    this.tone(o, t, f, 1.2, 0.5, 'triangle', 0.004);
    this.tone(o, t, f * 2, 0.6, 0.2, 'sine', 0.004);
    this.burst(o, t, 0.5, 'bandpass', 2400, 0.8, 0.25, 0.05);
    if (last) for (const m of [1.25, 1.5, 2]) this.tone(o, t + 0.12, f * m, 2.6, 0.3, 'triangle', 0.01);
  }

  /** A wish dropped into the well. */
  wish(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = this.out(0.2, 0, 7);
    this.tone(o, t, 1500, 0.12, 0.3, 'sine', 0.002, 0.4);
    this.burst(o, t + 0.05, 0.25, 'bandpass', 1800, 2, 0.3, 0.01);
    for (let i = 0; i < 7; i++) this.tone(o, t + 0.3 + i * 0.16, 523.25 * Math.pow(2, [0, 4, 7, 11, 12, 16, 19][i] / 12), 2.6, 0.16, 'sine', 0.02);
  }

  /** The voice of an animal: distance-dulled and panned. Rate-limited per kind. */
  call(kind: Call, dist: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if ((this.next[kind] ?? 0) > now) return;
    const gap: Record<Call, [number, number]> = {
      sheep: [5, 14],
      horse: [9, 22],
      chicken: [3, 9],
      owl: [6, 14],
      frog: [1.2, 4],
      kite: [12, 30],
      fox: [10, 25],
      cat: [14, 30],
      deer: [16, 40],
      heron: [20, 45],
      cow: [8, 20],
      dog: [5, 14],
      wolf: [9, 20],
      raven: [7, 18],
      bear: [14, 30],
      duck: [4, 12],
      squirrel: [8, 20],
    };
    this.next[kind] = now + rand(...gap[kind]);
    const near = Math.max(0, 1 - dist / 60);
    const level = 0.03 + near * near * 0.32;
    const o = this.out(level, pan, 6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200 + 7000 * near;
    lp.connect(o);
    const t = now + 0.02;
    switch (kind) {
      case 'sheep': {
        // Baa: a nasal buzz with vibrato that falls away.
        const f0 = rand(260, 340);
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.7);
        const vib = ctx.createOscillator();
        vib.frequency.value = 7;
        const vg = ctx.createGain();
        vg.gain.value = f0 * 0.04;
        vib.connect(vg).connect(osc.frequency);
        const form = ctx.createBiquadFilter();
        form.type = 'bandpass';
        form.frequency.value = 900;
        form.Q.value = 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.06);
        g.gain.setValueAtTime(0.45, t + 0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        osc.connect(form).connect(g).connect(lp);
        osc.start(t);
        vib.start(t);
        osc.stop(t + 0.85);
        vib.stop(t + 0.85);
        break;
      }
      case 'owl': {
        // Tawny: a short hoo, a pause, then a long quavering hooo.
        this.tone(lp, t, 410, 0.35, 0.5, 'sine', 0.04, 0.95);
        const o2 = this.tone(lp, t + 0.9, 400, 1.3, 0.5, 'sine', 0.08, 0.92);
        const vib = ctx.createOscillator();
        vib.frequency.value = 9;
        const vg = ctx.createGain();
        vg.gain.value = 9;
        vib.connect(vg).connect(o2.frequency);
        vib.start(t + 0.9);
        vib.stop(t + 2.3);
        break;
      }
      case 'frog': {
        // A purring croak: fast pulses of a low buzz.
        const n = 6 + Math.floor(Math.random() * 6);
        for (let i = 0; i < n; i++) this.tone(lp, t + i * 0.045, rand(180, 220), 0.05, 0.4, 'square', 0.004);
        break;
      }
      case 'kite': {
        // Mewing whistle: a long note that slides up then down.
        const o2 = ctx.createOscillator();
        o2.frequency.setValueAtTime(1600, t);
        o2.frequency.linearRampToValueAtTime(2300, t + 0.25);
        o2.frequency.linearRampToValueAtTime(1500, t + 0.9);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
        o2.connect(g).connect(lp);
        o2.start(t);
        o2.stop(t + 1.05);
        break;
      }
      case 'chicken': {
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const at = t + i * rand(0.12, 0.2);
          this.tone(lp, at, rand(500, 650), 0.09, 0.35, 'sawtooth', 0.005, 0.8);
        }
        break;
      }
      case 'fox': {
        // A hoarse double bark.
        for (let i = 0; i < 2; i++) {
          const at = t + i * 0.32;
          this.tone(lp, at, 520, 0.16, 0.3, 'sawtooth', 0.004, 0.55);
          this.burst(lp, at, 0.14, 'bandpass', 1300, 2, 0.4);
        }
        break;
      }
      case 'horse': {
        // A snort: a short gust of breath through the nostrils.
        this.burst(lp, t, 0.45, 'bandpass', 700, 1.5, 0.8, 0.02);
        this.burst(lp, t + 0.05, 0.3, 'lowpass', 300, 1, 0.5, 0.02);
        break;
      }
      case 'cat': {
        const o2 = this.tone(lp, t, 700, 0.6, 0.25, 'sawtooth', 0.05, 0.75);
        void o2;
        break;
      }
      case 'cow': {
        // A long low moo that swells and sags.
        const f0 = rand(105, 135);
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.5);
        osc.frequency.linearRampToValueAtTime(f0 * 0.92, t + 1.5);
        const form = ctx.createBiquadFilter();
        form.type = 'bandpass';
        form.frequency.setValueAtTime(380, t);
        form.frequency.linearRampToValueAtTime(620, t + 0.6);
        form.Q.value = 2.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.7, t + 0.2);
        g.gain.setValueAtTime(0.6, t + 1.0);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        osc.connect(form).connect(g).connect(lp);
        osc.start(t);
        osc.stop(t + 1.65);
        break;
      }
      case 'dog': {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const at = t + i * 0.26;
          this.tone(lp, at, rand(380, 440), 0.13, 0.4, 'sawtooth', 0.004, 0.6);
          this.burst(lp, at, 0.1, 'bandpass', 1100, 1.5, 0.35);
        }
        break;
      }
      case 'wolf': {
        // A howl: up, held with a quaver, falling away. A second voice answers.
        for (const [dt0, f0, lv] of [[0, rand(330, 380), 0.42], [1.1, rand(420, 470), 0.26]] as const) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f0 * 0.62, t + dt0);
          osc.frequency.exponentialRampToValueAtTime(f0, t + dt0 + 0.55);
          osc.frequency.setValueAtTime(f0, t + dt0 + 1.7);
          osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dt0 + 2.7);
          const vib = ctx.createOscillator();
          vib.frequency.value = 5.5;
          const vg = ctx.createGain();
          vg.gain.value = 5;
          vib.connect(vg).connect(osc.frequency);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t + dt0);
          g.gain.linearRampToValueAtTime(lv, t + dt0 + 0.4);
          g.gain.setValueAtTime(lv, t + dt0 + 1.8);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dt0 + 2.9);
          osc.connect(g).connect(lp);
          osc.start(t + dt0);
          vib.start(t + dt0);
          osc.stop(t + dt0 + 3);
          vib.stop(t + dt0 + 3);
        }
        break;
      }
      case 'raven': {
        // Kraa: a rough, rolling croak.
        const n = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) {
          const at = t + i * 0.34;
          this.tone(lp, at, rand(240, 280), 0.22, 0.35, 'sawtooth', 0.01, 0.8);
          this.tone(lp, at, rand(34, 40), 0.22, 0.3, 'square', 0.01);
          this.burst(lp, at, 0.2, 'bandpass', 1500, 1.2, 0.5, 0.01);
        }
        break;
      }
      case 'bear': {
        this.tone(lp, t, 70, 1.1, 0.6, 'sawtooth', 0.15, 0.75);
        this.burst(lp, t, 1.1, 'lowpass', 260, 1.2, 0.8, 0.2);
        break;
      }
      case 'duck': {
        const n = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const at = t + i * (0.17 + i * 0.012);
          this.tone(lp, at, 330 - i * 12, 0.11, 0.3 - i * 0.03, 'sawtooth', 0.006, 0.75);
          this.burst(lp, at, 0.09, 'bandpass', 1300, 3, 0.3);
        }
        break;
      }
      case 'squirrel': {
        for (let i = 0; i < 5; i++) this.tone(lp, t + i * 0.07, rand(2400, 3000), 0.04, 0.2, 'square', 0.002, 0.8);
        break;
      }
      case 'deer':
      case 'heron': {
        this.tone(lp, t, kind === 'deer' ? 300 : 220, 0.5, 0.3, 'sawtooth', 0.02, 0.7);
        break;
      }
    }
  }
}
