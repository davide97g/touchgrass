import type { Experience } from '../core/Experience';
import { findSpawn, terrainBase } from '../world/common';
import type { Site } from '../world/realm/Realm';

export interface Destination {
  id: string;
  name: string;
  subtitle: string;
  x: number;
  z: number;
  yaw: number;
}

/** Yaw that looks from (x, z) toward (tx, tz) (yaw 0 looks down -Z). */
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** Arrival radius per kind of place: inside the plaza, on the road into a village, and so on. */
function radii(s: Site): number[] {
  switch (s.kind) {
    case 'city':
      return [12, 11, 13];
    case 'village':
      return [s.r + 8, s.r + 14, s.r + 4];
    case 'ruins':
      return [s.r + 6, s.r + 12, 22];
    case 'crystals':
      return [s.r * 0.75, s.r * 0.9, s.r * 1.1];
    default:
      return [s.r + 8, s.r + 16, s.r + 26];
  }
}

/**
 * Fast travel: a menu of every place in the realm. Pick one, the view fades out and you
 * open your eyes there, facing it.
 */
export class Travel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly veil: HTMLElement;
  private dests: Destination[] | null = null;
  visible = false;
  private busy = false;
  onChange: ((open: boolean) => void) | null = null;
  onArrive: ((d: Destination) => void) | null = null;

  constructor(private readonly exp: Experience) {
    this.el = document.createElement('div');
    this.el.className = 'travel';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Travel');
    this.el.innerHTML = `
      <div class="tr-card">
        <header><span class="tr-kicker">Travel</span><span class="tr-hint">pick a place · Q or Esc to close</span></header>
        <ol class="tr-list"></ol>
      </div>`;
    this.list = this.el.querySelector('.tr-list')!;
    document.body.appendChild(this.el);
    this.veil = document.createElement('div');
    this.veil.className = 'travel-veil';
    document.body.appendChild(this.veil);

    this.el.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-dest]');
      if (li) this.go(li.dataset.dest!);
      else if (e.target === this.el) this.hide();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'Escape') {
        this.hide();
        e.preventDefault();
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9 && this.dests && this.dests[n - 1]) this.go(this.dests[n - 1].id);
    });
  }

  private walkable(x: number, z: number): boolean {
    const e = this.exp;
    for (const [dx, dz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
      const px = x + dx;
      const pz = z + dz;
      if (e.realm.map.solidAt(px, pz) > 0.05 || e.features.waterDepth(px, pz) > 0.05 || !e.forest.clear(px, pz)) return false;
    }
    return true;
  }

  /** Places are resolved lazily (the forest and ponds must exist first). */
  destinations(): Destination[] {
    if (this.dests) return this.dests;
    const e = this.exp;
    const out: Destination[] = [];
    const spawn = findSpawn();
    out.push({ id: 'fields', name: 'Whispering Fields', subtitle: 'Where you woke', x: spawn.x, z: spawn.z, yaw: spawn.yaw });
    for (const s of e.realm.sites) {
      let best: { x: number; z: number; score: number } | null = null;
      for (const rr of radii(s)) {
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const x = s.x + Math.cos(a) * rr;
          const z = s.z + Math.sin(a) * rr;
          if (!this.walkable(x, z)) continue;
          // On a road or plaza, and on the side that faces the rest of the realm.
          const road = e.realm.map.roadAt(x, z);
          const toward = -Math.hypot(x - spawn.x, z - spawn.z) / 1000;
          const score = road * 2 + toward;
          if (!best || score > best.score) best = { x, z, score };
        }
        if (best) break;
      }
      const p = best ?? { x: s.x + s.r + 20, z: s.z };
      out.push({ id: s.id, name: s.name, subtitle: s.subtitle, x: p.x, z: p.z, yaw: yawTo(p.x, p.z, s.x, s.z) });
    }
    // A summit in the range, looking back over everything.
    // The highest spot you can actually stand on (gentle enough not to slide off).
    let peak = { x: -2000, z: 600, score: -Infinity };
    for (let x = -2500; x <= -1700; x += 12) {
      for (let z = 200; z <= 1100; z += 12) {
        const h = terrainBase(x, z);
        const e = 1.5;
        let worst = 0;
        for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
          const gx = (terrainBase(x + dx + e, z + dz) - terrainBase(x + dx - e, z + dz)) / (2 * e);
          const gz = (terrainBase(x + dx, z + dz + e) - terrainBase(x + dx, z + dz - e)) / (2 * e);
          worst = Math.max(worst, Math.hypot(gx, gz));
        }
        if (worst > 0.45) continue;
        let ring = 0;
        for (let k = 0; k < 8; k++) ring += terrainBase(x + Math.cos(k * 0.785) * 70, z + Math.sin(k * 0.785) * 70);
        const prominence = h - ring / 8;
        const score = h + prominence * 3 - worst * 60;
        if (score > peak.score) peak = { x, z, score };
      }
    }
    const sx = peak.x;
    const sz = peak.z;
    out.push({ id: 'summit', name: 'Skyreach Summit', subtitle: 'The Roof of the Realm', x: sx, z: sz, yaw: yawTo(sx, sz, -400, 100) });
    this.dests = out;
    return out;
  }

  private render(): void {
    const p = this.exp.controller.position;
    this.list.innerHTML = this.destinations()
      .map((d, i) => {
        const dist = Math.hypot(d.x - p.x, d.z - p.z);
        const ds = dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(1)} km`;
        return `<li><button type="button" data-dest="${d.id}"><span class="tr-n">${i < 9 ? i + 1 : ''}</span><span class="tr-name">${d.name}</span><span class="tr-sub">${d.subtitle}</span><span class="tr-d">${ds}</span></button></li>`;
      })
      .join('');
  }

  show(): void {
    if (this.busy) return;
    this.render();
    this.visible = true;
    this.el.classList.add('on');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onChange?.(true);
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('on');
    this.onChange?.(false);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  go(id: string): void {
    const d = this.destinations().find((x) => x.id === id);
    if (!d || this.busy) return;
    this.busy = true;
    this.hide();
    this.veil.classList.add('on');
    window.setTimeout(() => {
      const e = this.exp;
      e.setWander(false);
      if (e.macro) e.setMacro(false);
      e.controller.teleport(d.x, d.z, d.yaw);
      e.cut();
      window.setTimeout(() => {
        this.veil.classList.remove('on');
        this.busy = false;
        this.onArrive?.(d);
      }, 450);
    }, 700);
  }
}
