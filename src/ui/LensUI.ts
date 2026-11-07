import { CATEGORY_LABEL } from '../discovery/catalog';
import type { LensState } from '../discovery/Discovery';

const RING = 2 * Math.PI * 46;

/**
 * The viewfinder drawn over the macro lens: a centre reticle with a focus ring that fills as the
 * focus settles, corner brackets that snap around whatever is being framed, the subject's name
 * (or "unknown" until you know it), a hint about what to fix, and a lens readout.
 */
export class LensUI {
  private readonly el: HTMLElement;
  private readonly ring: SVGCircleElement;
  private readonly brackets: HTMLElement;
  private readonly name: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly shutterBtn: HTMLButtonElement;
  private bx = 0.5;
  private by = 0.5;
  private br = 0.1;
  private lastText = '';
  onShutter: (() => void) | null = null;

  constructor(private readonly coarse: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'lens';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <div class="lens-frame"><i></i><i></i><i></i><i></i></div>
      <div class="lens-grid"></div>
      <svg class="lens-reticle" viewBox="0 0 100 100">
        <circle class="lr-base" cx="50" cy="50" r="46" />
        <circle class="lr-ring" cx="50" cy="50" r="46" />
        <path class="lr-cross" d="M50 40v6M50 54v6M40 50h6M54 50h6" />
      </svg>
      <div class="lens-brackets"><i></i><i></i><i></i><i></i></div>
      <div class="lens-label"><div class="ll-name"></div><div class="ll-hint"></div></div>
      <div class="lens-readout"></div>
      <div class="lens-help">${coarse ? 'tap the shutter' : 'click or space to shoot · scroll to zoom · Z to lower the lens'}</div>
    `;
    document.body.appendChild(this.el);
    this.ring = this.el.querySelector('.lr-ring')!;
    this.ring.style.strokeDasharray = `${RING}`;
    this.ring.style.strokeDashoffset = `${RING}`;
    this.brackets = this.el.querySelector('.lens-brackets')!;
    this.name = this.el.querySelector('.ll-name')!;
    this.hint = this.el.querySelector('.ll-hint')!;
    this.readout = this.el.querySelector('.lens-readout')!;
    this.flash = document.createElement('div');
    this.flash.className = 'shot-flash';
    document.body.appendChild(this.flash);
    this.shutterBtn = document.createElement('button');
    this.shutterBtn.type = 'button';
    this.shutterBtn.className = 'shutter-btn';
    this.shutterBtn.setAttribute('aria-label', 'Take a photo');
    this.shutterBtn.innerHTML = '<span></span>';
    this.shutterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onShutter?.();
    });
    document.body.appendChild(this.shutterBtn);
  }

  update(dt: number, on: boolean, s: LensState): void {
    this.el.classList.toggle('on', on);
    this.shutterBtn.classList.toggle('on', on && this.coarse);
    if (!on) return;
    const k = 1 - Math.exp(-dt * 14);
    const has = !!s.subject;
    const tx = has ? s.sx : 0.5;
    const ty = has ? s.sy : 0.5;
    const tr = has ? Math.max(0.035, Math.min(0.32, s.sr * 1.35 + 0.012)) : s.reticle * 1.6;
    this.bx += (tx - this.bx) * k;
    this.by += (ty - this.by) * k;
    this.br += (tr - this.br) * k;
    const H = window.innerHeight;
    const W = window.innerWidth;
    const size = this.br * 2 * H;
    this.brackets.style.transform = `translate(${(this.bx * W - size / 2).toFixed(1)}px, ${(this.by * H - size / 2).toFixed(1)}px)`;
    this.brackets.style.width = this.brackets.style.height = `${size.toFixed(1)}px`;
    this.brackets.className = `lens-brackets ${has ? `st-${s.status}` : ''}`;
    this.el.style.setProperty('--ret', `${(s.reticle * 2 * H).toFixed(1)}px`);
    this.ring.style.strokeDashoffset = `${(RING * (1 - s.progress)).toFixed(1)}`;
    this.el.classList.toggle('locked', s.status === 'locked');
    this.el.classList.toggle('has', has);

    let name = '';
    let hint = '';
    if (s.subject) {
      const e = s.subject;
      const what = e.cat === 'flora' ? 'unknown flower' : e.cat === 'fauna' ? 'unknown creature' : 'unknown place';
      name = s.known ? e.name : what;
      const d = s.dist;
      switch (s.status) {
        case 'near':
          hint = 'too close · step back';
          break;
        case 'far':
          hint = e.cat === 'flora' ? 'too far · come closer, kneel (C)' : 'too far · come closer';
          break;
        case 'small':
          hint = 'too small in the frame · scroll to zoom in';
          break;
        case 'asleep':
          hint = e.id === 'moonpetal' ? 'its petals are closed · it opens after sunset' : 'not now · come back another time of day';
          break;
        case 'hidden':
          hint = 'something is in the way · move or wait for a clear view';
          break;
        case 'shaky':
          hint = 'hold still…';
          break;
        case 'focus':
          hint = 'focusing…';
          break;
        case 'locked':
          hint = s.collected ? '✓ in your journal · shoot again to add a photo' : 'in focus';
          break;
        default:
          hint = '';
      }
      if (s.collected && s.status !== 'locked') hint = `✓ in your journal${hint ? ` · ${hint}` : ''}`;
      if (!s.known && s.status !== 'locked') hint = `${CATEGORY_LABEL[e.cat].one}${hint ? ` · ${hint}` : ''}`;
      void d;
    }
    const text = `${name}|${hint}`;
    if (text !== this.lastText) {
      this.lastText = text;
      this.name.textContent = name;
      this.hint.textContent = hint;
    }
    const dist = Number.isFinite(s.dist) ? (s.dist < 10 ? `${s.dist.toFixed(2)} m` : `${Math.round(s.dist)} m`) : '∞';
    const fstop = s.mm > 90 ? 'f/4' : 'f/2.8';
    this.readout.textContent = `${Math.round(s.mm)} mm · ${fstop} · ${dist}`;
  }

  /** White flash and a quick "snap" of the frame. */
  flashShot(): void {
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
    this.el.classList.remove('snap');
    void this.el.offsetWidth;
    this.el.classList.add('snap');
  }
}
