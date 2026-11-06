import { params, type TimeName } from '../core/params';
import { Music } from './Music';

export interface AudioFrame {
  dt: number;
  speed: number;
  crouch: number;
  grassHeight: number;
  windStrength: number;
  gust: number;
  gustLeft: number;
  gustRight: number;
  windPan: number;
  night: number;
  breath: number;
  breathOn: boolean;
  mood: TimeName;
  brook: number;
  brookPan: number;
  pond: number;
  birdNear: number;
  birdPan: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Fully procedural soundscape. Nothing is sampled: wind, the hush of grass in
 * gusts, brushing through blades, footsteps, birds, crickets and a breathing pad
 * are all shaped noise and oscillators, driven by the same gust field the shader draws.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  /** Final mix (after the compressor), for extra sources (trailer score) and recording. */
  out!: GainNode;
  /** Pre-compressor sum: other sound sources can join the mix here. */
  get input(): GainNode {
    return this.master;
  }
  private buses!: { wind: GainNode; grass: GainNode; nature: GainNode; pad: GainNode; music: GainNode };
  private music: Music | null = null;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;

  private wind!: {
    low: GainNode;
    body: GainNode;
    bodyFilter: BiquadFilterNode;
    bodyPan: StereoPannerNode;
    whistle: GainNode;
    whistleFilter: BiquadFilterNode;
    hissL: GainNode;
    hissR: GainNode;
  };
  private swish!: GainNode;
  private brook!: { gain: GainNode; pan: StereoPannerNode; voices: { f: BiquadFilterNode; g: GainNode; next: number }[]; flow: GainNode };
  private nextDrop = 0;
  private pad!: { gain: GainNode; filter: BiquadFilterNode; oscs: OscillatorNode[] };

  private grainAcc = 0;
  private nextBird = 0;
  private crickets: { freq: number; pan: number; rate: number; next: number }[] = [];
  private stepSide = 1;
  private t = 0;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'playback' });
    this.ctx = ctx;

    this.white = this.makeNoise('white', 3);
    this.pink = this.makeNoise('pink', 6);
    this.brown = this.makeNoise('brown', 6);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // Brick-wall-ish limiter at the very end so big moments never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    this.out = ctx.createGain();
    this.out.gain.value = 0.92;
    this.master.connect(comp).connect(limiter).connect(this.out).connect(ctx.destination);

    const bus = () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.buses = { wind: bus(), grass: bus(), nature: bus(), pad: bus(), music: bus() };

    this.buildWind();
    this.buildSwish();
    this.buildBrook();
    this.buildPad();
    this.music = new Music(ctx, this.buses.music);
    this.music.onChord = (freqs) => this.retunePad(freqs);
    this.crickets = [
      { freq: 4400, pan: -0.6, rate: 0.62, next: 0 },
      { freq: 4950, pan: 0.5, rate: 0.71, next: 0.2 },
      { freq: 3900, pan: 0.05, rate: 0.83, next: 0.4 },
      { freq: 5300, pan: 0.85, rate: 0.55, next: 0.1 },
    ];
    this.nextBird = ctx.currentTime + 2;
    this.setVolumes(true);
    void ctx.resume();
  }

  /** A MediaStream of the final mix, for recording. */
  captureStream(): MediaStream | null {
    if (!this.ctx) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.out.connect(dest);
    return dest.stream;
  }

  setVolumes(fadeIn = false): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const a = params.audio;
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.master, now, fadeIn ? 1.5 : 0.1);
    this.buses.wind.gain.setTargetAtTime(a.wind, now, 0.1);
    this.buses.grass.gain.setTargetAtTime(a.grass, now, 0.1);
    this.buses.nature.gain.setTargetAtTime(a.nature, now, 0.1);
    this.buses.pad.gain.setTargetAtTime(a.pad, now, 0.1);
    this.buses.music.gain.setTargetAtTime(a.musicOn ? a.music : 0, now, fadeIn ? 4 : 0.6);
  }

  /** Keep the breathing pad in harmony with whatever the score is playing. */
  private retunePad(freqs: number[]): void {
    if (!this.ctx || !this.pad) return;
    const now = this.ctx.currentTime;
    this.pad.oscs.forEach((o, i) => {
      const f = freqs[i % freqs.length] * (i >= freqs.length ? 2 : 1) * (i === 0 ? 0.5 : 1);
      o.frequency.setTargetAtTime(f, now, 1.5);
    });
  }

  private makeNoise(kind: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade the loop seam.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
    }
    return buf;
  }

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * buf.duration);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  private buildWind(): void {
    const ctx = this.ctx!;
    const out = this.buses.wind;

    const low = this.gain();
    this.loop(this.brown).connect(this.filter('lowpass', 170)).connect(low).connect(out);

    const body = this.gain();
    const bodyFilter = this.filter('bandpass', 420, 0.6);
    const bodyPan = ctx.createStereoPanner();
    this.loop(this.pink).connect(bodyFilter).connect(body).connect(bodyPan).connect(out);

    const whistle = this.gain();
    const whistleFilter = this.filter('bandpass', 900, 9);
    this.loop(this.pink).connect(whistleFilter).connect(whistle).connect(out);

    const hiss = (pan: number) => {
      const g = this.gain();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      this.loop(this.white)
        .connect(this.filter('bandpass', 2600, 0.45))
        .connect(this.filter('lowpass', 6500))
        .connect(g)
        .connect(p)
        .connect(out);
      return g;
    };
    this.wind = { low, body, bodyFilter, bodyPan, whistle, whistleFilter, hissL: hiss(-0.85), hissR: hiss(0.85) };
  }

  private buildSwish(): void {
    this.swish = this.gain();
    this.loop(this.white)
      .connect(this.filter('bandpass', 2200, 0.7))
      .connect(this.filter('highpass', 900))
      .connect(this.swish)
      .connect(this.buses.grass);
  }

  /** Babbling brook: narrow noise bands that hop around quickly, over a soft flowing bed. */
  private buildBrook(): void {
    const ctx = this.ctx!;
    const gain = this.gain();
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(this.buses.nature);
    const flow = this.gain(0.5);
    this.loop(this.pink).connect(this.filter('lowpass', 650)).connect(flow).connect(gain);
    const voices = [];
    for (let i = 0; i < 4; i++) {
      const f = this.filter('bandpass', 1200, 7);
      const g = this.gain(0);
      const p = ctx.createStereoPanner();
      p.pan.value = (i / 3) * 1.2 - 0.6;
      this.loop(this.white).connect(f).connect(g).connect(p).connect(gain);
      voices.push({ f, g, next: 0 });
    }
    this.brook = { gain, pan, voices, flow };
  }

  private buildPad(): void {
    const ctx = this.ctx!;
    const gain = this.gain();
    const filter = this.filter('lowpass', 600, 0.4);
    filter.connect(gain).connect(this.buses.pad);
    const oscs: OscillatorNode[] = [];
    for (const [f, det] of [[110, -5], [164.81, 4], [220, -3], [277.18, 6], [329.63, -6]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      const g = this.gain(f > 250 ? 0.12 : 0.2);
      o.connect(g).connect(filter);
      o.start();
      oscs.push(o);
    }
    this.pad = { gain, filter, oscs };
  }

  update(f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.t += f.dt;
    const w = f.windStrength;
    const tc = 0.25;

    // --- Wind ---
    this.wind.low.gain.setTargetAtTime(0.32 * w * (0.35 + 0.65 * f.gust), now, tc);
    this.wind.body.gain.setTargetAtTime(0.2 * w * (0.25 + 0.75 * f.gust), now, tc);
    this.wind.bodyFilter.frequency.setTargetAtTime(280 + 420 * f.gust * Math.min(w, 1.5), now, tc);
    this.wind.bodyPan.pan.setTargetAtTime(f.windPan * 0.6, now, 0.5);
    this.wind.whistle.gain.setTargetAtTime(0.025 * w * w * f.gust, now, tc);
    this.wind.whistleFilter.frequency.setTargetAtTime(700 + 450 * f.gust + 90 * Math.sin(this.t * 0.37), now, 0.4);
    const grassAmt = clamp01(f.grassHeight / 0.85) * 0.7 + 0.3;
    this.wind.hissL.gain.setTargetAtTime(0.11 * w * grassAmt * (0.12 + 0.88 * f.gustLeft), now, tc);
    this.wind.hissR.gain.setTargetAtTime(0.11 * w * grassAmt * (0.12 + 0.88 * f.gustRight), now, tc);

    // --- Moving through grass ---
    const move = clamp01(f.speed / 1.4);
    const grassFactor = Math.min(1.6, Math.max(0.25, f.grassHeight / 0.85));
    this.swish.gain.setTargetAtTime(0.07 * move * grassFactor * (1 + f.crouch * 0.7), now, 0.08);
    this.grainAcc += f.dt * f.speed * 20 * grassFactor * (1 + f.crouch * 0.8);
    let guard = 0;
    while (this.grainAcc >= 1 && guard++ < 12) {
      this.grainAcc -= 1;
      this.grain(now + Math.random() * f.dt, 0.6 + 0.4 * move);
    }

    // --- Nature ---
    const day = clamp01(1 - f.night * 1.3);
    if (now >= this.nextBird) {
      const flock = f.birdNear > 0.15 && Math.random() < 0.7;
      if (day > 0.15) this.bird(day * (flock ? 1 + f.birdNear : 1), flock ? f.birdPan : null);
      this.nextBird = now + (flock ? rand(0.3, 1.4) : rand(1.8, 9)) / Math.max(day, 0.3);
    }
    if (f.night > 0.3) {
      for (const c of this.crickets) {
        if (now >= c.next) {
          this.cricket(c, f.night);
          c.next = now + c.rate * rand(0.85, 1.25) + (Math.random() < 0.1 ? rand(1, 3) : 0);
        }
      }
    }

    // --- Water ---
    this.brook.gain.gain.setTargetAtTime(0.32 * f.brook + 0.04 * f.pond, now, 0.4);
    this.brook.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, f.brookPan * 0.8)), now, 0.3);
    if (f.brook > 0.01) {
      for (const v of this.brook.voices) {
        if (now < v.next) continue;
        const dur = rand(0.04, 0.14);
        v.f.frequency.setTargetAtTime(rand(500, 2600), now, 0.012);
        v.g.gain.setTargetAtTime(rand(0.15, 0.9), now, 0.02);
        v.next = now + dur;
      }
    }
    if (f.pond > 0.2 && now > this.nextDrop) {
      this.drop(f.pond);
      this.nextDrop = now + rand(0.8, 4.5) / f.pond;
    }

    // --- Score ---
    if (this.music) {
      this.music.setMood(f.mood);
      this.music.update();
    }

    // --- Breathing pad ---
    const padTarget = f.breathOn ? 0.06 * (0.3 + 0.7 * f.breath) : 0;
    this.pad.gain.gain.setTargetAtTime(padTarget, now, f.breathOn ? 0.3 : 1.2);
    this.pad.filter.frequency.setTargetAtTime(380 + 900 * f.breath, now, 0.3);
  }

  private grain(at: number, level: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const dur = rand(0.03, 0.11);
    const bp = this.filter('bandpass', rand(1800, 6500), rand(0.9, 2.4));
    const g = this.gain();
    const p = ctx.createStereoPanner();
    p.pan.value = rand(-0.7, 0.7);
    const peak = rand(0.04, 0.14) * level;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp).connect(g).connect(p).connect(this.buses.grass);
    src.start(at, Math.random() * (this.white.duration - 0.2), dur + 0.02);
  }

  step(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.stepSide *= -1;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const lp = this.filter('lowpass', rand(220, 340), 0.9);
    const g = this.gain();
    const p = ctx.createStereoPanner();
    p.pan.value = this.stepSide * 0.18;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.5 * intensity, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(lp).connect(g).connect(p).connect(this.buses.grass);
    src.start(now, Math.random() * 4, 0.2);
    for (let i = 0; i < 4; i++) this.grain(now + i * rand(0.01, 0.03), 0.8 * intensity);
  }

  /** A single water drop "plip" near the pools. */
  private drop(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    const f0 = rand(700, 1300);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * rand(1.6, 2.4), t + 0.05);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    const p = ctx.createStereoPanner();
    p.pan.value = rand(-0.7, 0.7);
    o.connect(g).connect(p).connect(this.buses.nature);
    o.start(t);
    o.stop(t + 0.12);
  }

  private bird(day: number, panTo: number | null = null): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime + 0.02;
    const pan = ctx.createStereoPanner();
    pan.pan.value = panTo === null ? rand(-0.95, 0.95) : Math.max(-0.95, Math.min(0.95, panTo + rand(-0.2, 0.2)));
    const lp = this.filter('lowpass', rand(3500, 9000));
    const out = this.gain(rand(0.025, 0.07) * day);
    lp.connect(out).connect(pan).connect(this.buses.nature);

    const kind = Math.random();
    const voice = (start: number, f0: number, f1: number, dur: number, vib = 0) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, start);
      o.frequency.exponentialRampToValueAtTime(f1, start + dur);
      const g = this.gain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(1, start + dur * 0.15);
      g.gain.linearRampToValueAtTime(0.0, start + dur);
      if (vib > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rand(18, 32);
        const depth = this.gain(vib);
        lfo.connect(depth).connect(o.frequency);
        lfo.start(start);
        lfo.stop(start + dur + 0.05);
      }
      o.connect(g).connect(lp);
      o.start(start);
      o.stop(start + dur + 0.05);
    };

    if (kind < 0.4) {
      // Tweets: short rising chirps.
      const n = Math.floor(rand(2, 6));
      const base = rand(2800, 4200);
      let t = now;
      for (let i = 0; i < n; i++) {
        voice(t, base, base * rand(1.2, 1.45), rand(0.05, 0.09));
        t += rand(0.1, 0.17);
      }
    } else if (kind < 0.7) {
      // Distant two-note whistle.
      const a = rand(1900, 2600);
      voice(now, a, a * 1.32, 0.28);
      voice(now + 0.34, a * 1.25, a * 0.95, 0.36);
    } else {
      // Warbling trill.
      const base = rand(3000, 4600);
      voice(now, base, base * rand(0.85, 1.1), rand(0.45, 0.8), rand(250, 500));
    }
  }

  private cricket(c: { freq: number; pan: number }, night: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.frequency.value = c.freq;
    const g = this.gain();
    const p = ctx.createStereoPanner();
    p.pan.value = c.pan;
    const level = 0.018 * night;
    let t = now;
    const pulses = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < pulses; i++) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.006);
      g.gain.linearRampToValueAtTime(0, t + 0.028);
      t += 0.045;
    }
    o.connect(g).connect(p).connect(this.buses.nature);
    o.start(now);
    o.stop(t + 0.05);
  }
}
