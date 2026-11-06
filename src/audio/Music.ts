import type { TimeName } from '../core/params';

/**
 * Endless generative ambient score: felt piano, slow pads, a low drone and the
 * odd bell, drowned in a long reverb with a little tape wobble. Harmony follows
 * the time of day; melody is a slow random walk built around a recurring motif,
 * so it feels composed rather than random. Nothing repeats exactly.
 */

interface Mood {
  key: number; // semitone offset from C
  bpm: number;
  scale: number[];
  chords: number[][]; // semitones from key root
  bell: number; // chance of a bell per bar
  density: number; // melody density 0..1
  brightness: number; // piano filter scale
}

const MOODS: Record<TimeName, Mood> = {
  Noon: {
    key: 2, bpm: 56, scale: [0, 2, 4, 6, 7, 9, 11], density: 0.5, bell: 0.18, brightness: 1,
    chords: [[0, 4, 7, 11, 14], [2, 6, 9, 13], [9, 12, 16, 19, 23], [7, 11, 14, 18]],
  },
  'Golden hour': {
    key: 0, bpm: 52, scale: [0, 2, 4, 5, 7, 9, 11], density: 0.45, bell: 0.22, brightness: 0.9,
    chords: [[0, 4, 7, 11, 14], [4, 7, 11, 14], [5, 9, 12, 16], [5, 8, 12, 14]],
  },
  Dusk: {
    key: 11, bpm: 48, scale: [0, 2, 3, 5, 7, 8, 10], density: 0.35, bell: 0.3, brightness: 0.7,
    chords: [[0, 3, 7, 10, 14], [8, 12, 15, 19], [3, 7, 10, 14], [10, 14, 17, 21]],
  },
  'Misty dawn': {
    key: 7, bpm: 50, scale: [0, 2, 4, 7, 9], density: 0.4, bell: 0.25, brightness: 0.8,
    chords: [[0, 2, 7, 14], [5, 9, 12, 19], [9, 12, 16, 19], [7, 12, 14, 19]],
  },
};

const BEATS_PER_BAR = 4;
const BARS_PER_CHORD = 2;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private readonly ctx: AudioContext;
  private readonly input: GainNode;
  private nextBar = 0;
  private bar = 0;
  private chordIdx = 0;
  private mood: Mood = MOODS.Noon;
  private pendingMood: Mood | null = null;
  private chord: number[] = MOODS.Noon.chords[0];
  private melodyDeg = 7; // index into the extended scale
  private phraseLeft = 0;
  private restLeft = 1;
  private motif: { at: number; step: number; vel: number }[] = [];
  private motifUses = 0;
  private padVoices: { gain: GainNode; oscs: OscillatorNode[] }[] = [];
  onChord: ((freqs: number[]) => void) | null = null;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;

    // Dark, slightly wobbly tape: lowpass, modulated delay (pitch wow), then reverb.
    this.input = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    tone.Q.value = 0.3;
    const wow = ctx.createDelay(0.1);
    wow.delayTime.value = 0.02;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.0018;
    lfo.connect(lfoGain).connect(wow.delayTime);
    lfo.start();
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 5.3;
    const flutterGain = ctx.createGain();
    flutterGain.gain.value = 0.00006;
    flutter.connect(flutterGain).connect(wow.delayTime);
    flutter.start();

    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    const wet = ctx.createGain();
    wet.gain.value = 1.45;
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(6.5, 2.6);
    const verbIn = ctx.createBiquadFilter();
    verbIn.type = 'highpass';
    verbIn.frequency.value = 180;

    this.input.connect(tone).connect(wow);
    wow.connect(dry).connect(out);
    wow.connect(verbIn).connect(verb).connect(wet).connect(out);

    this.nextBar = ctx.currentTime + 2.5;
  }

  /** Stereo impulse response: exponentially decaying noise with a soft, darkening tail. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const k = 0.15 + 0.8 * t; // tail gets darker
        lp = lp + (Math.random() * 2 - 1 - lp) * (1 - k);
        const pre = Math.min(1, i / (rate * 0.03));
        d[i] = lp * Math.pow(1 - t, decay) * pre;
      }
    }
    return buf;
  }

  setMood(name: TimeName): void {
    const m = MOODS[name];
    if (m !== this.mood) this.pendingMood = m;
  }

  /** Schedule ahead; call every frame. */
  update(): void {
    const now = this.ctx.currentTime;
    let guard = 0;
    while (this.nextBar < now + 1.2 && guard++ < 4) {
      if (this.nextBar < now - 0.5) this.nextBar = now + 0.1; // after a stall (hidden tab)
      this.scheduleBar(this.nextBar);
      this.nextBar += (60 / this.mood.bpm) * BEATS_PER_BAR;
    }
  }

  private scheduleBar(t0: number): void {
    const beat = 60 / this.mood.bpm;
    const barLen = beat * BEATS_PER_BAR;

    if (this.bar % BARS_PER_CHORD === 0) {
      if (this.pendingMood && this.chordIdx % 2 === 0) {
        this.mood = this.pendingMood;
        this.pendingMood = null;
        this.chordIdx = 0;
      }
      const prog = this.mood.chords;
      // Mostly follow the progression; now and then linger or step back.
      const r = Math.random();
      if (this.bar > 0) this.chordIdx = r < 0.82 ? (this.chordIdx + 1) % prog.length : r < 0.92 ? this.chordIdx : 0;
      this.chord = prog[this.chordIdx];
      this.pad(t0, barLen * BARS_PER_CHORD);
      this.drone(t0, barLen * BARS_PER_CHORD);
      this.onChord?.(this.chord.slice(0, 5).map((s) => mtof(48 + this.mood.key + (s % 12))));
    }

    this.leftHand(t0, beat);
    this.rightHand(t0, beat);
    if (Math.random() < this.mood.bell) this.bell(t0 + beat * pick([1, 1.5, 2.5, 3]));
    this.bar++;
  }

  // ---------- parts ----------

  private leftHand(t0: number, beat: number): void {
    const root = 38 + this.mood.key; // around D2
    const c = this.chord;
    const low = root + c[0] + (root + c[0] > 47 ? -12 : 0);
    const pattern = Math.random();
    if (pattern < 0.55) {
      this.piano(low, t0, rand(0.35, 0.5));
      this.piano(low + 12 + (c[2] - c[0]), t0 + beat * 1.5, rand(0.2, 0.3));
      if (Math.random() < 0.6) this.piano(low + 12 + (c[1] - c[0]) + 12, t0 + beat * 2.5, rand(0.15, 0.25));
    } else if (pattern < 0.85) {
      // Rolled chord.
      const notes = [low, low + 7, low + 12 + (c[1] - c[0]), low + 12 + (c[3 % c.length] - c[0])];
      notes.forEach((n, i) => this.piano(n, t0 + i * rand(0.07, 0.12), rand(0.2, 0.35) * (1 - i * 0.12)));
    } else {
      this.piano(low, t0, rand(0.3, 0.4));
    }
  }

  private scaleMidi(deg: number): number {
    const s = this.mood.scale;
    const oct = Math.floor(deg / s.length);
    const i = ((deg % s.length) + s.length) % s.length;
    return 60 + this.mood.key + s[i] + oct * 12;
  }

  private isChordTone(midi: number): boolean {
    const pc = (((midi - 60 - this.mood.key) % 12) + 12) % 12;
    return this.chord.some((s) => s % 12 === pc);
  }

  private rightHand(t0: number, beat: number): void {
    if (this.restLeft > 0) {
      this.restLeft--;
      if (this.restLeft === 0) this.phraseLeft = Math.random() < 0.5 ? 1 : 2;
      return;
    }
    const s = this.mood.scale.length;
    const lo = s; // keep melody around 4th-5th octave
    const hi = s * 2 + 3;

    // Re-use the motif sometimes, so the music has something to come back to.
    const useMotif = this.motif.length > 0 && Math.random() < 0.45 && this.motifUses < 4;
    if (useMotif) {
      this.motifUses++;
      let deg = this.melodyDeg;
      for (const n of this.motif) {
        deg = Math.min(hi, Math.max(lo, deg + n.step + (Math.random() < 0.15 ? pick([-1, 1]) : 0)));
        this.piano(this.scaleMidi(deg), t0 + n.at * beat + rand(-0.02, 0.03), n.vel * rand(0.85, 1.1));
      }
      this.melodyDeg = deg;
    } else {
      const fresh: { at: number; step: number; vel: number }[] = [];
      const slots = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
      let prevDeg = this.melodyDeg;
      for (const at of slots) {
        const strong = at % 1 === 0;
        const p = this.mood.density * (strong ? 0.55 : 0.25);
        if (Math.random() > p) continue;
        let step = pick([-2, -1, -1, 1, 1, 2, 0, -3, 3]);
        let deg = Math.min(hi, Math.max(lo, prevDeg + step));
        // Strong beats lean toward chord tones.
        if (strong && !this.isChordTone(this.scaleMidi(deg))) {
          for (const d of [1, -1, 2, -2]) {
            if (this.isChordTone(this.scaleMidi(deg + d))) {
              deg = Math.min(hi, Math.max(lo, deg + d));
              break;
            }
          }
        }
        step = deg - prevDeg;
        const vel = strong ? rand(0.3, 0.5) : rand(0.2, 0.35);
        this.piano(this.scaleMidi(deg), t0 + at * beat + rand(-0.02, 0.04), vel);
        fresh.push({ at, step, vel });
        prevDeg = deg;
      }
      this.melodyDeg = prevDeg;
      if (fresh.length >= 3 && (this.motif.length === 0 || Math.random() < 0.2)) {
        this.motif = fresh;
        this.motifUses = 0;
      }
    }

    this.phraseLeft--;
    if (this.phraseLeft <= 0) this.restLeft = Math.random() < 0.6 ? 1 : 2;
  }

  // ---------- instruments ----------

  /** Soft felt piano: stretched partials, fast attack, decay that darkens. */
  private piano(midi: number, t: number, vel: number): void {
    const ctx = this.ctx;
    const f = mtof(midi) * Math.pow(2, -14 / 1200); // a touch flat, "slowed" feel
    const out = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    const bright = (700 + vel * 3800) * this.mood.brightness;
    filt.frequency.setValueAtTime(bright, t);
    filt.frequency.setTargetAtTime(Math.max(350, bright * 0.25), t + 0.02, 0.9);
    filt.Q.value = 0.4;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 62) / 30)) + rand(-0.08, 0.08);
    filt.connect(out).connect(pan).connect(this.input);

    const sustain = 1.4 + Math.max(0, (72 - midi) / 24) * 2.2; // low notes ring longer
    const partials = [1, 2, 3, 4, 5.02];
    const amps = [1, 0.42, 0.18, 0.09, 0.05];
    const end = t + sustain * 5;
    for (let i = 0; i < partials.length; i++) {
      const n = partials[i];
      const fp = f * n * (1 + 0.00035 * n * n);
      if (fp > 12000) continue;
      const o = ctx.createOscillator();
      o.frequency.value = fp;
      o.detune.value = rand(-3, 3);
      const g = ctx.createGain();
      const a = amps[i] * vel * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.006, sustain / Math.pow(n, 0.7));
      o.connect(g).connect(filt);
      o.start(t);
      o.stop(end);
    }
    // Felt hammer thump.
    const len = Math.floor(ctx.sampleRate * 0.03);
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = Math.min(4000, f * 3);
    nf.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.value = vel * 0.05;
    ns.connect(nf).connect(ng).connect(filt);
    ns.start(t);
    out.gain.setValueAtTime(1, t);
    out.gain.setValueAtTime(1, end - 0.1);
    out.gain.linearRampToValueAtTime(0, end);
  }

  /** Warm pad: detuned saws through a slow, breathing lowpass. */
  private pad(t: number, len: number): void {
    const ctx = this.ctx;
    // Release whatever is still sounding.
    for (const v of this.padVoices) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 2.2);
      for (const o of v.oscs) o.stop(t + 12);
    }
    this.padVoices = [];

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + Math.min(5, len * 0.5));
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 0.5;
    filt.frequency.setValueAtTime(380, t);
    filt.frequency.linearRampToValueAtTime(900 * this.mood.brightness + 200, t + len * 0.55);
    filt.frequency.linearRampToValueAtTime(450, t + len + 6);
    filt.connect(gain).connect(this.input);

    const oscs: OscillatorNode[] = [];
    const base = 50 + this.mood.key;
    for (const s of this.chord.slice(1)) {
      const midi = base + (s % 12) + (s % 12 < 4 ? 12 : 0);
      for (const det of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(midi);
        o.detune.value = det + rand(-2, 2);
        const g = ctx.createGain();
        g.gain.value = 0.18;
        o.connect(g).connect(filt);
        o.start(t);
        oscs.push(o);
      }
    }
    this.padVoices.push({ gain, oscs });
  }

  private drone(t: number, len: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = mtof(26 + this.mood.key + this.chord[0] + 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 3);
    g.gain.setValueAtTime(0.06, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 4);
    o.connect(g).connect(this.input);
    o.start(t);
    o.stop(t + len + 4.5);
  }

  /** Small FM bell, far away. */
  private bell(t: number): void {
    const ctx = this.ctx;
    const midi = this.scaleMidi(this.mood.scale.length * 2 + Math.floor(rand(0, this.mood.scale.length)));
    const f = mtof(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.2, t);
    idx.gain.setTargetAtTime(0, t, 0.6);
    mod.connect(idx).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.01);
    g.gain.setTargetAtTime(0, t + 0.01, 1.4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.7, 0.7);
    car.connect(g).connect(pan).connect(this.input);
    car.start(t);
    mod.start(t);
    car.stop(t + 8);
    mod.stop(t + 8);
  }
}
