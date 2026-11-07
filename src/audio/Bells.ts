import type { AudioEngine } from './AudioEngine';

// Partials of a cast church bell relative to the strike note (hum, prime, minor third, fifth, octave, ...).
const PARTIALS: [number, number, number][] = [
  [0.5, 0.55, 9],
  [1, 0.8, 6],
  [1.183, 0.5, 4.5],
  [1.506, 0.32, 3.8],
  [2, 0.36, 3.2],
  [2.514, 0.16, 2.4],
  [2.662, 0.14, 2.2],
  [3.011, 0.1, 1.8],
  [4.166, 0.07, 1.2],
];

/**
 * The bell tower of the starting city tolls every couple of minutes. Heard across the fields,
 * dulled and quieter with distance, panned toward the tower.
 */
export class Bells {
  private next = 25;
  private queue: number[] = [];
  private t = 0;

  constructor(private readonly audio: AudioEngine, private readonly tower: { x: number; z: number } | null) {}

  update(dt: number, x: number, z: number, yaw: number): void {
    const ctx = this.audio.ctx;
    if (!ctx || !this.audio.running || !this.tower) return;
    this.t += dt;
    const d = Math.hypot(this.tower.x - x, this.tower.z - z);
    if (this.t > this.next) {
      this.next = this.t + 110 + Math.random() * 90;
      if (d < 900) {
        const n = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.queue.push(this.t + i * 2.8);
      }
    }
    while (this.queue.length && this.queue[0] <= this.t) {
      this.queue.shift();
      this.strike(d, x, z, yaw);
    }
  }

  private strike(d: number, x: number, z: number, yaw: number): void {
    const ctx = this.audio.ctx!;
    const now = ctx.currentTime + 0.02;
    const near = Math.max(0, 1 - d / 900);
    const level = 0.22 * near * near + 0.015;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const pan = Math.max(-0.9, Math.min(0.9, ((this.tower!.x - x) * rx + (this.tower!.z - z) * rz) / Math.max(d, 1)));
    const out = ctx.createGain();
    out.gain.value = level;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + 5000 * near;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(lp).connect(p).connect(this.audio.input);
    const f0 = 196 * (Math.random() < 0.5 ? 1 : 0.749);
    for (const [ratio, amp, decay] of PARTIALS) {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * ratio * (1 + (Math.random() - 0.5) * 0.002);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + decay + 0.1);
    }
    window.setTimeout(() => out.disconnect(), 10000);
  }
}
