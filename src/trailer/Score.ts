import { M, RUNE_NOTES } from './timeline';

/**
 * The trailer's score and sound design, written against the timeline marks.
 * Everything is synthesised (felt piano, string pads, choir, lyre, bells, hits,
 * risers, whooshes) and scheduled a little ahead of the audio clock.
 */

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Small deterministic PRNG so every take sounds the same. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cue = { t: number; fn: (at: number) => void };

export class Score {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly noise: AudioBuffer;
  private cues: Cue[] = [];
  private next = 0;
  private t0 = 0;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1.35;
    this.bus.connect(out);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.8;
    this.dry.connect(this.bus);
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(5.5, 2.4);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    this.wet = ctx.createGain();
    this.wet.gain.value = 1;
    this.wet.connect(hp).connect(verb);
    const wetOut = ctx.createGain();
    wetOut.gain.value = 1.1;
    verb.connect(wetOut).connect(this.bus);

    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.write();
    this.cues.sort((a, b) => a.t - b.t);
  }

  /** Start the score so that trailer time 0 falls at audio time `at`. */
  start(at: number): void {
    this.t0 = at;
    this.next = 0;
  }

  /** Schedule whatever starts in the next couple of seconds. */
  update(): void {
    const now = this.ctx.currentTime - this.t0;
    while (this.next < this.cues.length && this.cues[this.next].t < now + 1.5) {
      const c = this.cues[this.next++];
      if (c.t < now - 0.25) continue; // missed (tab stalled): skip rather than pile up
      c.fn(this.t0 + Math.max(c.t, now + 0.02));
    }
  }

  private at(t: number, fn: (at: number) => void): void {
    this.cues.push({ t, fn });
  }

  // ------------------------------------------------------------ the cue sheet

  private write(): void {
    const r = prng(7);

    // --- Opening: eyes open in the grass. A high pad breathes in, a lonely piano.
    this.at(0.2, (a) => this.pad([62, 69, 76, 78], a, M.rise + 0.5, 0.05, 1400, 3));
    this.at(0.2, (a) => this.pad([50, 57], a, M.rise, 0.035, 500, 3.5));
    const open: [number, number, number][] = [
      [1.4, 78, 0.32], [1.9, 76, 0.26], [2.4, 74, 0.28], [3.4, 69, 0.24],
      [M.flowers + 1.0, 78, 0.3], [M.flowers + 1.5, 76, 0.26], [M.flowers + 2.0, 74, 0.26],
      [M.flowers + 3.4, 74, 0.28], [M.flowers + 3.9, 76, 0.28], [M.flowers + 4.4, 78, 0.3], [M.flowers + 5.0, 81, 0.34],
    ];
    for (const [t, m, v] of open) this.at(t, (a) => this.piano(m, a, v));
    for (const [t, m] of [[1.4, 50], [M.flowers + 1.0, 47], [M.flowers + 3.4, 43]] as const) this.at(t, (a) => this.piano(m, a, 0.22));

    // --- Rise: strings swell into the reveal.
    this.at(M.rise, (a) => this.strings([43, 50, 59, 62, 67], a, 3.4, 0.11, 0.5));
    this.at(M.rise + 0.4, (a) => this.riser(a, 2.4, 0.05));
    this.at(M.rise + 2.9, (a) => this.boom(a, 0.5));
    this.at(M.rise + 2.9, (a) => {
      for (const m of [38, 45, 54, 57, 62, 66]) this.piano(m, a + (m - 38) * 0.004, 0.32);
      this.bell(86, a + 0.05, 0.12);
    });
    this.at(M.rise + 2.9, (a) => this.strings([38, 50, 57, 62, 66, 69], a, 9, 0.09, 2.5));

    // --- Walk: a warm arpeggio theme (D A/C# Bm G | D A G A).
    const beat = 0.79;
    const prog = [
      [38, 50, 54, 57, 62, 66], [37, 49, 52, 57, 61, 64], [35, 47, 50, 54, 59, 62], [31, 43, 50, 55, 59, 62],
      [38, 50, 54, 57, 62, 66], [33, 45, 49, 52, 57, 61], [31, 43, 47, 50, 55, 59], [33, 45, 49, 52, 57, 64],
    ];
    const t0 = M.walk + 0.7;
    prog.forEach((ch, i) => {
      const bar = t0 + i * beat * 4;
      if (bar > M.gust) return;
      this.at(bar, (a) => this.piano(ch[0], a, 0.3));
      const arp = [ch[1], ch[3], ch[4], ch[5], ch[4], ch[3], ch[2], ch[3]];
      arp.forEach((m, k) => this.at(bar + k * beat * 0.5, (a) => this.piano(m, a, 0.16 + (k === 0 ? 0.06 : 0) + r() * 0.04)));
      if (i >= 1) this.at(bar, (a) => this.strings(ch.slice(1).map((m) => m + 12), a, beat * 4 + 0.4, 0.03 + i * 0.006, 0.9));
    });
    // Melody over it.
    const mel: [number, number][] = [
      [4, 78], [5, 76], [6, 74], [7, 76], [8, 73], [10, 69],
      [12, 74], [13, 76], [14, 78], [15, 81], [16, 78], [18, 74],
      [20, 78], [21, 79], [22, 81], [23, 83], [24, 81], [26, 78], [28, 76], [29, 74], [30, 76],
    ];
    for (const [b, m] of mel) this.at(t0 + b * beat, (a) => this.piano(m, a, 0.3));
    // Swallows: bells glitter, a choir opens up as the clouds turn.
    for (let i = 0; i < 18; i++) {
      const t = M.swallows + 0.3 + i * 0.42 + r() * 0.1;
      this.at(t, (a) => this.bell([86, 88, 90, 93, 95][Math.floor(r() * 5)], a, 0.05 + r() * 0.03));
    }
    this.at(M.swallows + 1.5, (a) => this.choir([62, 66, 69, 74], a, 7.5, 0.05));
    // Sun: the big warm chord.
    this.at(M.sun - 0.6, (a) => this.riser(a, 1.6, 0.05));
    this.at(M.sun + 1.0, (a) => {
      this.boom(a, 0.55);
      for (const m of [31, 43, 50, 55, 59, 62, 66, 69]) this.piano(m, a + (m - 31) * 0.003, 0.3);
      this.bell(91, a + 0.1, 0.1);
    });
    this.at(M.sun + 1.0, (a) => this.strings([31, 43, 50, 55, 59, 62, 69, 74], a, 5.4, 0.12, 1.4));
    this.at(M.sun + 1.0, (a) => this.choir([55, 59, 62, 69], a, 5.2, 0.06));

    // --- Gust: the music holds its breath, the wind takes over.
    this.at(M.gust - 0.2, (a) => this.drone(38, a, 5.6, 0.07));
    this.at(M.gust + 0.2, (a) => this.whoosh(a, 4.2, 0.4, -0.7, 0.7, 300, 2400));
    this.at(M.gust + 1.4, (a) => this.whoosh(a, 3.4, 0.38, 0.8, -0.6, 500, 3800));
    this.at(M.gust + 2.6, (a) => this.whoosh(a, 2.6, 0.5, -0.4, 0.9, 250, 4500, 1.5));
    this.at(M.gust + 3.3, (a) => this.whoosh(a, 1.9, 0.45, 0.9, -0.9, 400, 5200, 2));
    // A low roar that swells right up to the moment the eyes shut, then cuts.
    this.at(M.gust + 0.8, (a) => this.roar(a, M.blink - M.gust - 0.8, 0.5));
    this.at(M.blink - 0.05, (a) => this.thump(a, 0.45));

    // --- Night: B minor, music-box notes blinking like the fireflies.
    this.at(M.night, (a) => this.pad([47, 54, 62, 73], a, M.white - M.night + 0.5, 0.05, 900, 3));
    this.at(M.night, (a) => this.pad([35, 42], a, M.white - M.night + 0.5, 0.04, 350, 4));
    const penta = [83, 86, 88, 90, 93, 95];
    let tb = M.night + 1.2;
    while (tb < M.perch) {
      const m = penta[Math.floor(r() * penta.length)];
      this.at(tb, (a) => this.bell(m, a, 0.035 + r() * 0.03, 2.2));
      tb += 0.55 + r() * 1.1;
    }
    const ost = [71, 66, 74, 66, 73, 66, 74, 78];
    for (let i = 0; i < 22; i++) {
      const t = M.fireflies + 0.3 + i * 0.5;
      if (t > M.perch + 1) break;
      this.at(t, (a) => this.piano(ost[i % ost.length], a, 0.13 + (i % 4 === 0 ? 0.05 : 0)));
    }
    this.at(M.fireflies + 4, (a) => this.strings([47, 54, 59, 62, 66], a, 8, 0.05, 2));
    // Perched firefly: the light swells.
    this.at(M.perch + 0.2, (a) => this.riser(a, M.white - M.perch - 0.1, 0.09));
    this.at(M.perch + 0.4, (a) => this.strings([59, 66, 71, 74, 78, 83], a, M.white - M.perch, 0.07, M.white - M.perch - 0.4));
    for (let i = 0; i < 26; i++) {
      const k = i / 26;
      const t = M.perch + 1 + k * k * (M.white - M.perch - 1.1);
      this.at(t, (a) => this.bell(penta[i % penta.length] + (i > 13 ? 12 : 0), a, 0.03 + k * 0.05, 1.5));
    }
    this.at(M.white - 1.6, (a) => this.reverseSwell(a, 1.6, 0.12));

    // --- Dawn: the bloom chord, then harp and piano by the water.
    this.at(M.dawn - 0.15, (a) => {
      this.boom(a, 0.45);
      this.bell(86, a, 0.12, 5);
      this.bell(93, a + 0.03, 0.08, 5);
    });
    this.at(M.dawn - 0.15, (a) => this.strings([43, 50, 57, 59, 62, 69, 74], a, 7, 0.1, 0.15));
    this.at(M.dawn - 0.15, (a) => this.choir([62, 67, 71, 74], a, 6.5, 0.06));
    const dawnProg = [[43, 55, 59, 62, 66], [42, 54, 57, 62, 64], [40, 52, 55, 59, 62], [36, 48, 55, 60, 64]];
    for (let i = 0; i < 7; i++) {
      const bar = M.dawn + 4 + i * 3.6;
      if (bar > M.call - 0.5) break;
      const ch = dawnProg[i % 4];
      this.at(bar, (a) => this.pad(ch.slice(1), a, 3.9, 0.035, 1100, 1.2));
      ch.forEach((m, k) => this.at(bar + k * 0.16, (a) => this.harp(m + 12, a, 0.22)));
      ch.forEach((m, k) => this.at(bar + 1.8 + k * 0.16, (a) => this.harp(m + 24 - (k === 0 ? 12 : 0), a, 0.12)));
    }
    const dawnMel: [number, number][] = [[0, 83], [1.2, 81], [2.4, 79], [4.2, 78], [7.2, 83], [8.4, 86], [9.6, 83], [11.4, 81]];
    for (const [b, m] of dawnMel) this.at(M.orbit + b, (a) => this.piano(m - 12, a, 0.22));

    // --- The call: everything falls away to one shimmering note.
    this.at(M.call - 0.3, (a) => this.glass([90, 93, 88], a, 0.07));
    this.at(M.call, (a) => this.shine(88, a, M.dive - M.call + 1.5, 0.03));
    this.at(M.call + 1.6, (a) => this.glass([93, 97, 95, 90], a, 0.05));

    // --- Dive: drawn in. Choir and risers, harp glissando into the flare.
    this.at(M.dive, (a) => this.choir([52, 59, 64, 67], a, 3, 0.05));
    this.at(M.dive + 2.8, (a) => this.choir([48, 55, 64, 67, 72], a, 3, 0.065));
    this.at(M.dive + 5.4, (a) => this.choir([50, 57, 66, 69, 74], a, 2.6, 0.08));
    this.at(M.dive + 0.5, (a) => this.riser(a, M.flare - M.dive - 0.5, 0.1));
    this.at(M.dive, (a) => this.strings([40, 52, 59, 64, 67, 71], a, M.flare - M.dive + 0.2, 0.08, M.flare - M.dive - 1));
    for (let i = 0; i < 24; i++) {
      const t = M.flare - 1.4 + i * 0.055;
      this.at(t, (a) => this.harp([62, 64, 66, 69, 71][i % 5] + 12 * Math.floor(i / 5), a, 0.15));
    }
    this.at(M.flare - 1.2, (a) => this.reverseSwell(a, 1.2, 0.14));
    this.at(M.flare, (a) => {
      this.sparkle(a, 2.2, 0.08);
      this.boom(a, 0.35);
    });

    // --- Fairy pool: an ancient tune on lyre and flute over a drone; each note lights a rune.
    this.at(M.fairy, (a) => this.drone(38, a, M.vortex - M.fairy + 0.5, 0.08));
    this.at(M.fairy, (a) => this.drone(45, a, M.vortex - M.fairy + 0.5, 0.045));
    this.at(M.fairy + 2.5, (a) => this.choir([50, 53, 57, 62], a, M.follow - M.fairy - 2, 0.04));
    for (const n of RUNE_NOTES) {
      if (n.t > M.vortex + 0.2) break;
      this.at(n.t, (a) => this.lyre(n.midi, a, 0.28 * n.vel));
      if (n.t < M.accel) this.at(n.t, (a) => this.chime(n.midi + 12, a, 0.035));
    }
    for (let i = 0; i < 20; i++) {
      const t = M.fairy + 1 + i * 0.55 * 2;
      if (t > M.follow) break;
      this.at(t, (a) => this.drum(a, i % 4 === 0 ? 0.3 : 0.16));
    }
    this.at(M.float, (a) => this.flute([74, 76, 77, 76, 74, 72, 74], a, 0.7, 0.05));
    this.at(M.follow, (a) => this.strings([50, 57, 62, 65, 69], a, M.vortex - M.follow, 0.06, 3));
    this.at(M.accel, (a) => this.riser(a, M.vortex - M.accel + 2.8, 0.12));
    for (let i = 0; i < 12; i++) {
      const t = M.accel + (i / 12) * (M.vortex - M.accel);
      this.at(t, (a) => this.drum(a, 0.15 + (i / 12) * 0.25));
    }
    // Vortex.
    this.at(M.vortex - 0.2, (a) => this.whoosh(a, 3.2, 0.3, -0.9, 0.9, 200, 5000, 3));
    this.at(M.vortex, (a) => this.choir([62, 69, 74, 77, 81], a, 3, 0.07));
    this.at(M.vortex + 0.6, (a) => this.sparkle(a, 2.4, 0.06));
    this.at(M.stars - 1.4, (a) => this.reverseSwell(a, 1.4, 0.16));

    // --- Stars: lying in the grass. Deep breath, wide chord, a falling star, the title.
    this.at(M.stars, (a) => {
      this.boom(a, 0.6);
      this.bell(74, a + 0.02, 0.1, 6);
    });
    this.at(M.stars, (a) => this.pad([50, 57, 64, 66, 69], a, M.end - M.stars, 0.05, 1000, 2.5));
    this.at(M.stars, (a) => this.pad([38, 45], a, M.end - M.stars, 0.045, 300, 3));
    for (const [t, m] of [[M.stars + 2.2, 78], [M.stars + 3.4, 76], [M.stars + 4.4, 81]] as const) {
      this.at(t, (a) => this.piano(m, a, 0.18));
    }
    this.at(M.meteor - 0.1, (a) => this.meteor(a, 3.2, 0.12));
    this.at(M.title, (a) => {
      for (const m of [26, 38, 45, 54, 57, 62, 64, 69, 74]) this.piano(m, a + (m - 26) * 0.004, 0.34);
      this.bell(93, a + 0.06, 0.09, 7);
      this.bell(81, a + 0.04, 0.07, 7);
      this.boom(a, 0.4);
    });
    this.at(M.title, (a) => this.strings([38, 50, 57, 62, 66, 69, 76], a, M.end - M.title, 0.08, 2));
    this.at(M.title + 0.5, (a) => this.choir([62, 66, 69, 74], a, M.end - M.title - 1, 0.045));
    this.at(M.title + 4.5, (a) => this.piano(78, a, 0.2));
    this.at(M.title + 5.6, (a) => this.piano(76, a, 0.18));
    this.at(M.title + 6.8, (a) => this.piano(74, a, 0.2));
  }

  // ------------------------------------------------------------ instruments

  private impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.85 - 0.75 * t);
        d[i] = lp * Math.pow(1 - t, decay) * Math.min(1, i / (rate * 0.02));
      }
    }
    return buf;
  }

  /** Voice output: a gain into dry + reverb, optionally panned. */
  private voice(gain: number, wet = 0.6, pan = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    const d = this.ctx.createGain();
    d.gain.value = 1 - wet * 0.5;
    const w = this.ctx.createGain();
    w.gain.value = wet;
    g.connect(p);
    p.connect(d).connect(this.dry);
    p.connect(w).connect(this.wet);
    return g;
  }

  private env(g: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): void {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, out: AudioNode, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseSrc(t: number, dur: number, out: AudioNode): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.connect(out);
    s.start(t, Math.random() * 3);
    s.stop(t + dur + 0.05);
    return s;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  /** Felt piano: stretched partials, a soft hammer, a filter that closes as it rings. */
  private piano(midi: number, t: number, vel: number): void {
    const f = mtof(midi);
    const dur = 2.5 + (90 - midi) * 0.07;
    const out = this.voice(vel * 0.55, 0.7, (midi - 64) / 60);
    const lp = this.filter('lowpass', Math.min(9000, f * 6 + 600));
    lp.frequency.setValueAtTime(Math.min(9000, f * 8 + 1200), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), t + dur);
    lp.connect(out);
    const parts = [1, 2.003, 3.01, 4.03];
    const amps = [1, 0.4, 0.16, 0.07];
    parts.forEach((p, i) => {
      const g = this.ctx.createGain();
      this.env(g.gain, t, amps[i], 0.006, 0, dur / (1 + i * 0.7));
      g.connect(lp);
      this.osc(i === 0 ? 'triangle' : 'sine', f * p, t, dur, g, (i - 1.5) * 1.5);
    });
    const hn = this.ctx.createGain();
    this.env(hn.gain, t, 0.12, 0.002, 0, 0.05);
    const bp = this.filter('bandpass', Math.min(6000, f * 3), 1.2);
    bp.connect(hn).connect(out);
    this.noiseSrc(t, 0.08, bp);
  }

  /** Slow, detuned saw pad through a soft lowpass. */
  private pad(midis: number[], t: number, dur: number, vol: number, cutoff: number, attack: number): void {
    const out = this.voice(vol, 0.8);
    const lp = this.filter('lowpass', cutoff, 0.5);
    lp.connect(out);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + attack);
    g.gain.setValueAtTime(1, t + Math.max(attack, dur - 2.5));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
    g.connect(lp);
    for (const m of midis) {
      for (const dt of [-7, 6]) this.osc('sawtooth', mtof(m), t, dur + 1.6, g, dt);
    }
  }

  /** String section swell: brighter as it grows. */
  private strings(midis: number[], t: number, dur: number, vol: number, attack: number): void {
    const out = this.voice(vol, 0.75);
    const lp = this.filter('lowpass', 600, 0.6);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(3200, t + attack);
    lp.frequency.linearRampToValueAtTime(1400, t + dur + 1);
    lp.connect(out);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + attack);
    g.gain.setValueAtTime(1, t + Math.max(attack, dur - 0.5));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.8);
    g.connect(lp);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vd = this.ctx.createGain();
    vd.gain.value = 6;
    vib.connect(vd);
    vib.start(t);
    vib.stop(t + dur + 2);
    for (const m of midis) {
      for (const dt of [-9, 0, 8]) {
        const o = this.osc('sawtooth', mtof(m), t, dur + 1.9, g, dt);
        vd.connect(o.detune);
      }
    }
  }

  /** Choir "aah": saws through vowel formants, with a slow vibrato. */
  private choir(midis: number[], t: number, dur: number, vol: number): void {
    const out = this.voice(vol, 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + Math.min(2, dur * 0.4));
    g.gain.setValueAtTime(1, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
    for (const [f, q, a] of [[750, 6, 1], [1150, 8, 0.6], [2800, 10, 0.25]] as const) {
      const bp = this.filter('bandpass', f, q);
      const ga = this.ctx.createGain();
      ga.gain.value = a * 2.4;
      g.connect(bp).connect(ga).connect(out);
    }
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 4.6;
    const vd = this.ctx.createGain();
    vd.gain.value = 9;
    vib.connect(vd);
    vib.start(t);
    vib.stop(t + dur + 1.3);
    for (const m of midis) {
      for (const dt of [-11, 10]) {
        const o = this.osc('sawtooth', mtof(m), t, dur + 1.25, g, dt);
        vd.connect(o.detune);
      }
    }
  }

  /** FM bell. */
  private bell(midi: number, t: number, vel: number, decay = 3): void {
    const f = mtof(midi);
    const out = this.voice(vel, 0.85, (Math.random() - 0.5) * 0.8);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 1, 0.003, 0, decay);
    g.connect(out);
    const car = this.osc('sine', f, t, decay + 0.1, g);
    const mod = this.ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + decay * 0.6);
    mod.connect(mg).connect(car.frequency);
    mod.start(t);
    mod.stop(t + decay + 0.1);
  }

  /** Glass harmonica figure (the glowing flower calling). */
  private glass(midis: number[], t: number, vol: number): void {
    midis.forEach((m, i) => this.bell(m, t + i * 0.32, vol, 4));
  }

  /** A held, slowly beating high sine. */
  private shine(midi: number, t: number, dur: number, vol: number): void {
    const out = this.voice(vol, 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 1.2);
    g.gain.setValueAtTime(1, t + dur - 1);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    this.osc('sine', mtof(midi), t, dur, g);
    this.osc('sine', mtof(midi) * 1.004, t, dur, g);
    this.osc('sine', mtof(midi + 7) * 0.5, t, dur, g);
  }

  /** Plucked harp: bright attack, quick filter close. */
  private harp(midi: number, t: number, vel: number): void {
    const f = mtof(midi);
    const out = this.voice(vel * 0.5, 0.75, (midi - 66) / 50);
    const lp = this.filter('lowpass', f * 10);
    lp.frequency.setValueAtTime(f * 12, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.8, t + 1.2);
    lp.connect(out);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 1, 0.003, 0, 2.6);
    g.connect(lp);
    this.osc('triangle', f, t, 2.7, g);
    this.osc('sine', f * 2, t, 1.2, g);
  }

  /** Lyre: harp with a little chorus and a buzzier body, for the ancient tune. */
  private lyre(midi: number, t: number, vel: number): void {
    const f = mtof(midi);
    const out = this.voice(vel * 0.5, 0.8, Math.sin(midi) * 0.4);
    const lp = this.filter('lowpass', f * 6, 1.5);
    lp.frequency.setValueAtTime(f * 9, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + 1.6);
    lp.connect(out);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 1, 0.004, 0, 2.2);
    g.connect(lp);
    this.osc('sawtooth', f, t, 2.3, g, -4);
    this.osc('triangle', f, t, 2.3, g, 5);
    this.osc('sine', f * 2, t, 1.0, g);
  }

  /** Small glassy chime doubling the lyre at the octave. */
  private chime(midi: number, t: number, vel: number): void {
    this.bell(midi, t, vel, 1.6);
  }

  /** Breathy flute line (sine + noise, vibrato). */
  private flute(midis: number[], t: number, step: number, vol: number): void {
    midis.forEach((m, i) => {
      const at = t + i * step;
      const out = this.voice(vol, 0.85, 0.2);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(1, at + 0.12);
      g.gain.setValueAtTime(1, at + step * 0.85);
      g.gain.linearRampToValueAtTime(0.0001, at + step * 1.3);
      g.connect(out);
      const o = this.osc('sine', mtof(m), at, step * 1.35, g);
      const vib = this.ctx.createOscillator();
      vib.frequency.value = 5;
      const vd = this.ctx.createGain();
      vd.gain.value = 12;
      vib.connect(vd).connect(o.detune);
      vib.start(at);
      vib.stop(at + step * 1.4);
      const bp = this.filter('bandpass', mtof(m) * 2, 3);
      const ng = this.ctx.createGain();
      ng.gain.value = 0.25;
      bp.connect(ng).connect(g);
      this.noiseSrc(at, step * 1.35, bp);
    });
  }

  /** Low drone: sine and a filtered saw a fifth up, slowly breathing. */
  private drone(midi: number, t: number, dur: number, vol: number): void {
    const out = this.voice(vol, 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 2);
    g.gain.setValueAtTime(1, t + dur - 1.5);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lp = this.filter('lowpass', 420, 0.8);
    g.connect(lp).connect(out);
    this.osc('sine', mtof(midi), t, dur, g);
    this.osc('sawtooth', mtof(midi), t, dur, g, 4);
    this.osc('sawtooth', mtof(midi + 12), t, dur, g, -5);
  }

  /** Soft frame drum. */
  private drum(t: number, vel: number): void {
    const out = this.voice(vel, 0.4);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 1, 0.004, 0, 0.45);
    g.connect(out);
    const o = this.osc('sine', 110, t, 0.5, g);
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.25);
    const ng = this.ctx.createGain();
    this.env(ng.gain, t, 0.3, 0.002, 0, 0.12);
    const bp = this.filter('bandpass', 900, 0.8);
    bp.connect(ng).connect(out);
    this.noiseSrc(t, 0.15, bp);
  }

  /** Cinematic hit: falling sub sine + a dark thump. */
  private boom(t: number, vel: number): void {
    const out = this.voice(vel, 0.5);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 1, 0.01, 0.1, 3.2);
    g.connect(out);
    const o = this.osc('sine', 70, t, 3.5, g);
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 2.5);
    const ng = this.ctx.createGain();
    this.env(ng.gain, t, 0.5, 0.005, 0, 0.9);
    const lp = this.filter('lowpass', 260, 0.9);
    lp.connect(ng).connect(out);
    this.noiseSrc(t, 1, lp);
  }

  private thump(t: number, vel: number): void {
    const out = this.voice(vel, 0.2);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 1, 0.005, 0, 0.35);
    const lp = this.filter('lowpass', 180, 0.7);
    lp.connect(g).connect(out);
    this.noiseSrc(t, 0.4, lp);
  }

  /** Deep wind roar: low noise swelling to t + dur, then cut. */
  private roar(t: number, dur: number, vol: number): void {
    const out = this.voice(vol, 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + dur);
    g.gain.setValueAtTime(1, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    const lp = this.filter('lowpass', 160, 0.9);
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.exponentialRampToValueAtTime(520, t + dur);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.7;
    const ld = this.ctx.createGain();
    ld.gain.value = 120;
    lfo.connect(ld).connect(lp.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.3);
    lp.connect(g).connect(out);
    this.noiseSrc(t, dur + 0.3, lp);
  }

  /** Rising noise + pitch, ending at t + dur. */
  private riser(t: number, dur: number, vol: number): void {
    const out = this.voice(vol, 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
    g.connect(out);
    const bp = this.filter('bandpass', 400, 2.5);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    bp.connect(g);
    this.noiseSrc(t, dur + 0.3, bp);
    const sg = this.ctx.createGain();
    sg.gain.value = 0.25;
    sg.connect(g);
    const o = this.osc('sine', 220, t, dur + 0.3, sg);
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + dur);
  }

  /** Reversed-cymbal style swell that stops dead at t + dur (into a cut). */
  private reverseSwell(t: number, dur: number, vol: number): void {
    const out = this.voice(vol, 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    const hp = this.filter('highpass', 2500, 0.5);
    hp.connect(g).connect(out);
    this.noiseSrc(t, dur + 0.02, hp);
  }

  /** Wind whoosh sweeping across the stereo field. */
  private whoosh(t: number, dur: number, vol: number, panFrom: number, panTo: number, f0: number, f1: number, wobble = 0): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(panFrom, t);
    p.pan.linearRampToValueAtTime(panTo, t + dur);
    if (wobble > 0) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.8, t);
      lfo.frequency.exponentialRampToValueAtTime(9, t + dur);
      const ld = this.ctx.createGain();
      ld.gain.value = 0.8;
      lfo.connect(ld).connect(p.pan);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
    const bp = this.filter('bandpass', f0, 1.2);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + dur);
    bp.connect(g).connect(p);
    const d = this.ctx.createGain();
    d.gain.value = 0.8;
    const w = this.ctx.createGain();
    w.gain.value = 0.4;
    p.connect(d).connect(this.dry);
    p.connect(w).connect(this.wet);
    this.noiseSrc(t, dur, bp);
  }

  /** A burst of magic: many tiny bells cascading over a high shimmer. */
  private sparkle(t: number, dur: number, vol: number): void {
    const notes = [86, 88, 90, 93, 95, 98, 100, 102];
    for (let i = 0; i < 26; i++) {
      const k = i / 26;
      this.bell(notes[(i * 5) % notes.length], t + k * dur * (0.6 + 0.4 * k), vol * (1 - k * 0.6), 1.4);
    }
    const out = this.voice(vol * 0.6, 0.9);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 1, 0.05, dur * 0.3, dur);
    const hp = this.filter('highpass', 6000, 0.6);
    hp.connect(g).connect(out);
    this.noiseSrc(t, dur * 1.4, hp);
  }

  /** The shooting star: a bright descending whistle with a sparkling tail. */
  private meteor(t: number, dur: number, vol: number): void {
    const out = this.voice(vol, 0.9, -0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    const o = this.osc('sine', 3200, t, dur, g);
    o.frequency.setValueAtTime(3600, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + dur);
    const bp = this.filter('bandpass', 5000, 3);
    bp.frequency.setValueAtTime(7000, t);
    bp.frequency.exponentialRampToValueAtTime(2500, t + dur);
    const ng = this.ctx.createGain();
    ng.gain.value = 0.6;
    bp.connect(ng).connect(g);
    this.noiseSrc(t, dur, bp);
    for (let i = 0; i < 10; i++) this.bell([98, 95, 93, 90, 88, 86, 83, 81, 78, 76][i], t + 0.3 + i * 0.22, vol * 0.4, 1.5);
  }
}
