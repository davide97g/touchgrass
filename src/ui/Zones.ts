import { mountainMask } from '../world/common';
import { CASTLE } from '../world/realm/Skyward';
import type { Realm } from '../world/realm/World';

interface Zone {
  id: string;
  name: string;
  subtitle: string;
}

const FIELDS: Zone = { id: 'fields', name: 'Whispering Fields', subtitle: 'Grassland' };
const RANGE: Zone = { id: 'range', name: 'Skyreach Range', subtitle: 'The Mountains at the Edge' };
const WOODS: Zone = { id: 'road', name: 'King’s Road', subtitle: 'Highway' };

const TAU = Math.PI * 2;
const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/**
 * Where am I: a banner that slides in when you cross into a new place (city, village, ruins,
 * mountains), and a compass strip at the top with the cardinal points and the landmarks.
 */
export class Zones {
  private readonly banner: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly marks: { el: HTMLElement; x: number; z: number; label: string; dist: HTMLElement | null }[] = [];
  private current = '';
  private pending = '';
  private pendingT = 0;
  private hideTimer = 0;
  private readonly cards: { el: HTMLElement; a: number }[] = [];

  constructor(private readonly realm: Realm) {
    this.banner = document.createElement('div');
    this.banner.className = 'zone-banner';
    this.banner.setAttribute('role', 'status');
    this.banner.innerHTML = '<div class="zb-line"></div><div class="zb-sub"></div><div class="zb-name"></div><div class="zb-line"></div>';
    document.body.appendChild(this.banner);

    this.compass = document.createElement('div');
    this.compass.className = 'compass';
    this.compass.setAttribute('aria-hidden', 'true');
    this.strip = document.createElement('div');
    this.strip.className = 'compass-strip';
    this.compass.appendChild(this.strip);
    const needle = document.createElement('div');
    needle.className = 'compass-needle';
    this.compass.appendChild(needle);
    document.body.appendChild(this.compass);

    // Yaw 0 looks down -Z: call that north.
    const cardinal: [string, number][] = [['N', 0], ['NE', -Math.PI / 4], ['E', -Math.PI / 2], ['SE', (-3 * Math.PI) / 4], ['S', Math.PI], ['SW', (3 * Math.PI) / 4], ['W', Math.PI / 2], ['NW', Math.PI / 4]];
    for (const [l, a] of cardinal) {
      const el = document.createElement('span');
      el.className = l.length === 1 ? 'cp-card major' : 'cp-card';
      el.textContent = l;
      this.strip.appendChild(el);
      this.cards.push({ el, a });
    }
    for (let i = 0; i < 24; i++) {
      const el = document.createElement('span');
      el.className = 'cp-tick';
      this.strip.appendChild(el);
      this.cards.push({ el, a: (i / 24) * TAU + TAU / 48 });
    }
    const add = (x: number, z: number, label: string, kind: string) => {
      const el = document.createElement('span');
      el.className = `cp-mark ${kind}`;
      el.innerHTML = `<i></i><b>${label}</b><em></em>`;
      this.strip.appendChild(el);
      this.marks.push({ el, x, z, label, dist: el.querySelector('em') });
    };
    for (const s of realm.sites) add(s.x, s.z, s.name, s.kind);
    add(CASTLE.x, CASTLE.z, 'Floating Castle', 'castle');
  }

  private zoneAt(x: number, z: number): Zone {
    for (const s of this.realm.sites) {
      if (Math.hypot(x - s.x, z - s.z) < s.zone) return { id: s.id, name: s.name, subtitle: s.subtitle };
    }
    if (mountainMask(x, z) > 0.3) return RANGE;
    for (const road of this.realm.roads) {
      if (!road.name) continue;
      for (let i = 0; i < road.pts.length; i += 3) {
        if (Math.hypot(road.pts[i].x - x, road.pts[i].z - z) < 14) return { ...WOODS, name: road.name, id: `road-${road.name}` };
      }
    }
    return FIELDS;
  }

  show(z: Zone): void {
    this.banner.querySelector('.zb-name')!.textContent = z.name;
    this.banner.querySelector('.zb-sub')!.textContent = z.subtitle;
    this.banner.classList.remove('on');
    void this.banner.offsetWidth;
    this.banner.classList.add('on');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.banner.classList.remove('on'), 4200);
  }

  update(dt: number, x: number, z: number, yaw: number, active: boolean): void {
    this.compass.classList.toggle('on', active);
    if (!active) return;
    const zone = this.zoneAt(x, z);
    if (zone.id !== this.current) {
      if (zone.id !== this.pending) {
        this.pending = zone.id;
        this.pendingT = 0;
      }
      this.pendingT += dt;
      // Linger a moment before announcing (no flicker at borders); roads only if you follow them.
      if (this.pendingT > (zone.id.startsWith('road') ? 6 : 1.2)) {
        this.current = zone.id;
        this.show(zone);
      }
    } else this.pending = '';

    const W = this.strip.clientWidth || 420;
    const span = Math.PI * 0.9; // field of the strip
    const place = (el: HTMLElement, a: number) => {
      const rel = wrap(a - yaw);
      const px = (-rel / span) * W + W / 2;
      const vis = Math.abs(rel) < span / 2;
      el.style.transform = `translateX(${px.toFixed(1)}px)`;
      el.style.opacity = vis ? String(Math.max(0, 1 - Math.pow(Math.abs(rel) / (span / 2), 4))) : '0';
      return rel;
    };
    for (const c of this.cards) place(c.el, c.a);
    for (const m of this.marks) {
      const dx = m.x - x;
      const dz = m.z - z;
      const rel = place(m.el, Math.atan2(-dx, -dz));
      m.el.classList.toggle('near', Math.abs(rel) < 0.16);
      const d = Math.hypot(dx, dz);
      if (m.dist) m.dist.textContent = d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;
    }
  }
}
