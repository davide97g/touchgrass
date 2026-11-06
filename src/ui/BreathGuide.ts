const PHASES = [
  { label: 'breathe in', secs: 4, from: 0, to: 1 },
  { label: 'hold', secs: 2, from: 1, to: 1 },
  { label: 'breathe out', secs: 6, from: 1, to: 0 },
  { label: 'rest', secs: 1.5, from: 0, to: 0 },
];

const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);

/** 4-2-6 breathing ring. `value` (0..1) also drives the audio pad and the camera's breath. */
export class BreathGuide {
  active = false;
  value = 0;
  private phase = 0;
  private t = 0;
  private readonly el: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly label: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'breath';
    this.el.setAttribute('aria-live', 'polite');
    this.ring = document.createElement('div');
    this.ring.className = 'breath-ring';
    this.label = document.createElement('div');
    this.label.className = 'breath-label';
    this.el.append(this.ring, this.label);
    document.body.appendChild(this.el);
  }

  toggle(on = !this.active): void {
    this.active = on;
    this.phase = 0;
    this.t = 0;
    this.el.classList.toggle('on', on);
    this.label.textContent = PHASES[0].label;
  }

  update(dt: number): void {
    if (!this.active) {
      this.value += (0 - this.value) * Math.min(1, dt * 2);
      return;
    }
    this.t += dt;
    let p = PHASES[this.phase];
    if (this.t >= p.secs) {
      this.t -= p.secs;
      this.phase = (this.phase + 1) % PHASES.length;
      p = PHASES[this.phase];
      this.label.textContent = p.label;
    }
    const k = ease(this.t / p.secs);
    this.value = p.from + (p.to - p.from) * k;
    const s = 0.55 + 0.45 * this.value;
    this.ring.style.transform = `scale(${s.toFixed(4)})`;
    this.ring.style.opacity = (0.35 + 0.5 * this.value).toFixed(3);
  }
}
