import type { Controller } from './Controller';

/**
 * Mobile input: left half of the screen is a floating joystick, right half drags the view.
 */
export class TouchControls {
  private moveId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  constructor(private readonly el: HTMLElement, private readonly ctrl: Controller) {
    this.base = document.createElement('div');
    this.base.className = 'joy';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    el.addEventListener('touchstart', (e) => this.start(e), { passive: false });
    el.addEventListener('touchmove', (e) => this.move(e), { passive: false });
    el.addEventListener('touchend', (e) => this.end(e));
    el.addEventListener('touchcancel', (e) => this.end(e));
  }

  private start(e: TouchEvent): void {
    if (!this.ctrl.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && this.moveId === null) {
        this.moveId = t.identifier;
        this.origin = { x: t.clientX, y: t.clientY };
        this.base.style.left = `${t.clientX}px`;
        this.base.style.top = `${t.clientY}px`;
        this.base.classList.add('on');
        this.ctrl.onUserMove?.();
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.last = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private move(e: TouchEvent): void {
    if (!this.ctrl.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) {
        const max = 56;
        let dx = t.clientX - this.origin.x;
        let dy = t.clientY - this.origin.y;
        const len = Math.hypot(dx, dy);
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.ctrl.touchMove.set(dx / max, -dy / max);
      } else if (t.identifier === this.lookId) {
        const s = 0.0045 * this.ctrl.lookScale;
        this.ctrl.look((t.clientX - this.last.x) * s, (t.clientY - this.last.y) * s);
        this.last = { x: t.clientX, y: t.clientY };
        this.ctrl.onUserMove?.();
      }
    }
  }

  private end(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) {
        this.moveId = null;
        this.ctrl.touchMove.set(0, 0);
        this.knob.style.transform = '';
        this.base.classList.remove('on');
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
  }

  get element(): HTMLElement {
    return this.el;
  }
}
