import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat } from 'three';
import { U } from '../../core/uniforms';
import { mountainMask, setRealmSampler, smoothstep, terrainBase } from '../common';
import type { Builder } from './geom';
import type { Secret } from './hidden';

/**
 * The realm: one hand-planned world laid over the endless field. Sites (a walled city,
 * villages, ruins on a hill, a crystal field, a mountain pass), the roads between them,
 * and everything they change on the ground are baked once into a static map the GPU
 * samples next to the terrain noise:
 *   r = height change (flattened plazas and roadbeds, raised hills)
 *   g = paved surface (roads, streets, plazas)
 *   b = solid (buildings, walls, crystals: no grass, no walking)
 *   a = paving kind (0 packed earth .. 1 cobblestone)
 * The CPU keeps an identical copy for walking, placement and animals.
 */

export const REALM_CENTER = { x: -420, z: -80 };
export const REALM_SIZE = 3000;
const RES = 1400;
const TEXEL = REALM_SIZE / RES;

export type SiteKind = 'city' | 'village' | 'ruins' | 'crystals' | 'pass' | 'meadow' | 'grove' | 'pillar' | 'ring';

export interface Site {
  id: string;
  name: string;
  subtitle: string;
  kind: SiteKind;
  x: number;
  z: number;
  /** Radius of the built-up area. */
  r: number;
  /** Ground level of the flattened area (filled in by the planner). */
  level: number;
  /** Radius of the zone banner trigger. */
  zone: number;
}

export interface Pt {
  x: number;
  z: number;
}

export interface Road {
  pts: Pt[];
  halfW: number;
  pave: number;
  /** Heights of the roadbed per point (filled in by the bake). */
  levels: number[];
  name?: string;
}

interface Flat {
  x: number;
  z: number;
  r: number;
  fall: number;
  level: number;
}

interface Hill {
  x: number;
  z: number;
  r: number;
  h: number;
  seed: number;
}

interface Solid {
  x: number;
  z: number;
  /** Half extents along the rotated axes, or radius for discs (hz < 0). */
  hx: number;
  hz: number;
  rot: number;
}

interface Pave {
  x: number;
  z: number;
  r: number;
  pave: number;
  amount?: number;
}

/** What the site generators hand to the planner. */
export class Plan {
  readonly flats: Flat[] = [];
  readonly hills: Hill[] = [];
  readonly roads: Road[] = [];
  readonly solids: Solid[] = [];
  readonly paves: Pave[] = [];
  /** Mesh builders, run after the bake (when every height is final). */
  readonly props: { layer: 'town' | 'far'; fn: (b: Builder) => void }[] = [];
  /** Lamp positions (glow at night) and other point features for later systems. */
  readonly lamps: { x: number; y: number; z: number }[] = [];
  readonly windmills: { x: number; y: number; z: number; rot: number; r: number }[] = [];
  readonly gates: { x: number; y: number; z: number }[] = [];
  readonly pastures: { x: number; z: number; r: number; kind: 'sheep' | 'horse' }[] = [];
  readonly treeSpots: { x: number; z: number; s: number; kind: number }[] = [];
  /** Crop fields: rotated rects baked into the paving channel (2 wheat, 3 greens, 4 lavender). */
  readonly fields: { x: number; z: number; w: number; d: number; rot: number; crop: number }[] = [];
  readonly smokes: { x: number; y: number; z: number; s: number }[] = [];
  readonly fires: { x: number; y: number; z: number }[] = [];
  readonly flocks: { x: number; z: number; r: number; kind: 'chicken' | 'cat'; n: number }[] = [];
  /** Areas where petals drift (blossom groves). */
  readonly petals: { x: number; z: number; r: number }[] = [];
  /** Glades kept free of trees (hidden places). */
  readonly clearings: { x: number; z: number; r: number }[] = [];
  /** Hidden places (see hidden.ts). */
  readonly secrets: Secret[] = [];
  /** The city's bell tower (for the tolling bells). */
  bell: { x: number; y: number; z: number } | null = null;

  flat(x: number, z: number, r: number, fall: number, level: number): void {
    this.flats.push({ x, z, r, fall, level });
  }
  hill(x: number, z: number, r: number, h: number, seed = 1): void {
    this.hills.push({ x, z, r, h, seed });
  }
  road(pts: Pt[], halfW: number, pave = 0, name?: string): Road {
    const road = { pts, halfW, pave, levels: [], name };
    this.roads.push(road);
    return road;
  }
  rect(x: number, z: number, w: number, d: number, rot: number): void {
    this.solids.push({ x, z, hx: w / 2, hz: d / 2, rot });
  }
  disc(x: number, z: number, r: number): void {
    this.solids.push({ x, z, hx: r, hz: -1, rot: 0 });
  }
  /** Paved disc; `amount` < 1 only shortens the grass (glades, worn ground). */
  pave(x: number, z: number, r: number, pave = 1, amount = 1): void {
    this.paves.push({ x, z, r, pave, amount });
  }
  field(x: number, z: number, w: number, d: number, rot: number, crop: number): void {
    this.fields.push({ x, z, w, d, rot, crop });
  }
  prop(fn: (b: Builder) => void, layer: 'town' | 'far' = 'town'): void {
    this.props.push({ layer, fn });
  }
}

// ---------------------------------------------------------------------------------------------

export class RealmMap {
  readonly texture: DataTexture;
  private readonly dh = new Float32Array(RES * RES);
  private readonly road = new Float32Array(RES * RES);
  private readonly solid = new Float32Array(RES * RES);
  private readonly kind = new Float32Array(RES * RES);
  private flatW = new Float32Array(RES * RES);

  constructor(readonly plan: Plan, populate: (map: RealmMap) => void) {
    this.bakeHills();
    populate(this);
    this.bakeFlats();
    this.bakeRoads();
    this.bakePaves();
    this.bakeSolids();
    this.bakeFields();
    this.flatW = new Float32Array(0);

    const half = new Uint16Array(RES * RES * 4);
    for (let k = 0; k < RES * RES; k++) {
      const o = k * 4;
      half[o] = DataUtils.toHalfFloat(this.dh[k]);
      half[o + 1] = DataUtils.toHalfFloat(this.road[k]);
      half[o + 2] = DataUtils.toHalfFloat(this.solid[k]);
      half[o + 3] = DataUtils.toHalfFloat(this.kind[k]);
      this.dh[k] = DataUtils.fromHalfFloat(half[o]);
      this.road[k] = DataUtils.fromHalfFloat(half[o + 1]);
      this.solid[k] = DataUtils.fromHalfFloat(half[o + 2]);
      this.kind[k] = DataUtils.fromHalfFloat(half[o + 3]);
    }
    this.texture = new DataTexture(half, RES, RES, RGBAFormat, HalfFloatType);
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    U.uRealm.value = this.texture;
    U.uRealmBox.value.set(REALM_CENTER.x, REALM_CENTER.z, REALM_SIZE, 1);
    setRealmSampler((x, z) => this.sample(x, z, 0));
  }

  /** Bilinear sample of a channel (0 height, 1 road, 2 solid, 3 paving), identical to the GPU. */
  sample(x: number, z: number, ch: 0 | 1 | 2 | 3): number {
    const u = (x - REALM_CENTER.x) / REALM_SIZE + 0.5;
    const v = (z - REALM_CENTER.z) / REALM_SIZE + 0.5;
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) return 0;
    const arr = ch === 0 ? this.dh : ch === 1 ? this.road : ch === 2 ? this.solid : this.kind;
    const fx = u * RES - 0.5;
    const fy = v * RES - 0.5;
    const x0 = Math.max(0, Math.min(RES - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(RES - 1, Math.floor(fy)));
    const x1 = Math.min(RES - 1, x0 + 1);
    const y1 = Math.min(RES - 1, y0 + 1);
    const tx = Math.min(1, Math.max(0, fx - x0));
    const ty = Math.min(1, Math.max(0, fy - y0));
    const a = arr[y0 * RES + x0];
    const b = arr[y0 * RES + x1];
    const c = arr[y1 * RES + x0];
    const d = arr[y1 * RES + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  solidAt(x: number, z: number): number {
    return this.sample(x, z, 2);
  }
  roadAt(x: number, z: number): number {
    return this.sample(x, z, 1);
  }

  /** True when anything built (road, wall, plaza, raised ground) lies within `r` metres. */
  busy(x: number, z: number, r: number): boolean {
    const step = Math.max(TEXEL, r / 6);
    for (let dz = -r; dz <= r; dz += step) {
      for (let dx = -r; dx <= r; dx += step) {
        if (dx * dx + dz * dz > r * r) continue;
        if (this.sample(x + dx, z + dz, 1) > 0.05 || this.sample(x + dx, z + dz, 2) > 0.05) return true;
        if (Math.abs(this.sample(x + dx, z + dz, 0)) > 0.4) return true;
      }
    }
    return false;
  }

  // ---- bake ----

  private box(x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
    const toI = (v: number, c: number) => Math.max(0, Math.min(RES - 1, Math.floor((v - c + REALM_SIZE / 2) / TEXEL)));
    return [toI(x0, REALM_CENTER.x), toI(z0, REALM_CENTER.z), toI(x1, REALM_CENTER.x), toI(z1, REALM_CENTER.z)];
  }

  private pos(i: number): number {
    return REALM_CENTER.x - REALM_SIZE / 2 + (i + 0.5) * TEXEL;
  }
  private posZ(j: number): number {
    return REALM_CENTER.z - REALM_SIZE / 2 + (j + 0.5) * TEXEL;
  }

  private forEach(x0: number, z0: number, x1: number, z1: number, fn: (k: number, x: number, z: number) => void): void {
    const [i0, j0, i1, j1] = this.box(x0, z0, x1, z1);
    for (let j = j0; j <= j1; j++) {
      const z = this.posZ(j);
      for (let i = i0; i <= i1; i++) fn(j * RES + i, this.pos(i), z);
    }
  }

  /** Raw (pre-bake) ground height with the hills: what flats and roads are levelled against. */
  groundNow(x: number, z: number): number {
    const fx = (x - REALM_CENTER.x + REALM_SIZE / 2) / TEXEL - 0.5;
    const fz = (z - REALM_CENTER.z + REALM_SIZE / 2) / TEXEL - 0.5;
    const i = Math.max(0, Math.min(RES - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(RES - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i));
    const tz = Math.min(1, Math.max(0, fz - j));
    const k = j * RES + i;
    const d = this.dh;
    const v = d[k] * (1 - tx) * (1 - tz) + d[k + 1] * tx * (1 - tz) + d[k + RES] * (1 - tx) * tz + d[k + RES + 1] * tx * tz;
    return terrainBase(x, z) + v;
  }

  private bakeHills(): void {
    for (const h of this.plan.hills) {
      this.forEach(h.x - h.r, h.z - h.r, h.x + h.r, h.z + h.r, (k, x, z) => {
        const a = Math.atan2(z - h.z, x - h.x);
        // Lobed outline, steeper on one side: a real hill, not a dome.
        const lobe = 1 + 0.18 * Math.sin(a * 3 + h.seed) + 0.1 * Math.sin(a * 5 - h.seed * 2);
        const d = Math.hypot(x - h.x, z - h.z) / (h.r * 0.92 * lobe);
        if (d >= 1) return;
        const t = 1 - d;
        const prof = t * t * (3 - 2 * t);
        const crags = 1 + 0.08 * Math.sin(x * 0.11 + h.seed) * Math.sin(z * 0.13 - h.seed);
        this.dh[k] += h.h * Math.pow(prof, 1.25) * crags;
      });
    }
  }

  private bakeFlats(): void {
    for (const f of this.plan.flats) {
      const R = f.r + f.fall;
      this.forEach(f.x - R, f.z - R, f.x + R, f.z + R, (k, x, z) => {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d >= R) return;
        const w = 1 - smoothstep(f.r, R, d);
        const base = terrainBase(x, z);
        const cur = base + this.dh[k];
        this.dh[k] += (f.level - cur) * w;
        this.flatW[k] = Math.max(this.flatW[k], w);
      });
    }
  }

  private bakeRoads(): void {
    for (const road of this.plan.roads) {
      const pts = road.pts;
      // Roadbed heights: the ground under it, smoothed along the way (gentle grades, no bumps).
      const raw = pts.map((p) => this.groundNow(p.x, p.z));
      const lv = raw.slice();
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < pts.length; i++) {
          let s = 0;
          let n = 0;
          for (let j = Math.max(0, i - 4); j <= Math.min(pts.length - 1, i + 4); j++) {
            s += lv[j];
            n++;
          }
          lv[i] = s / n;
        }
      }
      // Keep the ends pinned to what they join.
      lv[0] = raw[0];
      lv[lv.length - 1] = raw[raw.length - 1];
      road.levels = lv;

      const w = road.halfW;
      const R = w * 2.6 + 4;
      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s];
        const b = pts[s + 1];
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const l2 = vx * vx + vz * vz || 1;
        this.forEach(Math.min(a.x, b.x) - R, Math.min(a.z, b.z) - R, Math.max(a.x, b.x) + R, Math.max(a.z, b.z) + R, (k, x, z) => {
          const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
          const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
          if (d >= R) return;
          const m = 1 - smoothstep(w - 0.4, w + 0.8, d);
          if (m > this.road[k]) {
            this.road[k] = m;
            this.kind[k] = road.pave;
          }
          // Level the roadbed and its shoulders (not inside levelled sites).
          const wr = (1 - smoothstep(w + 0.5, R, d)) * (1 - this.flatW[k]);
          if (wr <= 0) return;
          const target = lv[s] + (lv[s + 1] - lv[s]) * t;
          const cur = terrainBase(x, z) + this.dh[k];
          const prev = this.flatW[k];
          if (wr > prev) {
            this.dh[k] += (target - cur) * wr;
            this.flatW[k] = Math.max(prev, wr * 0.999);
          }
        });
      }
    }
  }

  private bakePaves(): void {
    for (const p of this.plan.paves) {
      this.forEach(p.x - p.r - 2, p.z - p.r - 2, p.x + p.r + 2, p.z + p.r + 2, (k, x, z) => {
        const d = Math.hypot(x - p.x, z - p.z);
        const m = (1 - smoothstep(p.r - 0.5, p.r + 0.8, d)) * (p.amount ?? 1);
        if (m > this.road[k]) {
          this.road[k] = m;
          this.kind[k] = p.pave;
        }
      });
    }
  }

  private bakeFields(): void {
    for (const f of this.plan.fields) {
      const R = Math.hypot(f.w, f.d) / 2 + 2;
      const c = Math.cos(f.rot);
      const sn = Math.sin(f.rot);
      this.forEach(f.x - R, f.z - R, f.x + R, f.z + R, (k, x, z) => {
        const dx = x - f.x;
        const dz = z - f.z;
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        if (Math.abs(lx) > f.w / 2 || Math.abs(lz) > f.d / 2) return;
        if (this.road[k] > 0.02 || this.solid[k] > 0.02) return;
        this.kind[k] = f.crop;
      });
    }
  }

  /** Distance from a point to the nearest planned road centreline. */
  roadDist(x: number, z: number): number {
    let best = Infinity;
    for (const r of this.plan.roads) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i];
        const b = p[i + 1];
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
        const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t) - r.halfW;
        if (d < best) best = d;
      }
    }
    return best;
  }

  private bakeSolids(): void {
    for (const s of this.plan.solids) {
      const disc = s.hz < 0;
      const R = (disc ? s.hx : Math.hypot(s.hx, s.hz)) + 2;
      const c = Math.cos(s.rot);
      const sn = Math.sin(s.rot);
      this.forEach(s.x - R, s.z - R, s.x + R, s.z + R, (k, x, z) => {
        const dx = x - s.x;
        const dz = z - s.z;
        let d: number;
        if (disc) d = Math.hypot(dx, dz) - s.hx;
        else {
          // Into the rect's frame (rotation about +Y, matching three.js).
          const lx = dx * c - dz * sn;
          const lz = dx * sn + dz * c;
          d = Math.max(Math.abs(lx) - s.hx, Math.abs(lz) - s.hz);
        }
        const m = 1 - smoothstep(-0.3, TEXEL * 0.9, d);
        if (m > this.solid[k]) this.solid[k] = m;
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------

/** Roads wander a little: subdivide, push sideways with smooth noise, then round the corners. */
export function meander(way: Pt[], amp: number, seed: number, step = 9): Pt[] {
  const out: Pt[] = [];
  let acc = 0;
  for (let s = 0; s < way.length - 1; s++) {
    const a = way[s];
    const b = way[s + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(L / step));
    const px = -(b.z - a.z) / L;
    const pz = (b.x - a.x) / L;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const d = acc + L * t;
      // Taper the wobble to zero at each waypoint so roads hit their gates squarely.
      const env = Math.sin(Math.PI * t);
      const off = (Math.sin(d * 0.011 + seed) * 0.6 + Math.sin(d * 0.029 + seed * 1.7) * 0.4) * amp * env;
      out.push({ x: a.x + (b.x - a.x) * t + px * off, z: a.z + (b.z - a.z) * t + pz * off });
    }
    acc += L;
  }
  out.push(way[way.length - 1]);
  // Chaikin smoothing keeps the ends.
  let pts = out;
  for (let it = 0; it < 2; it++) {
    const next: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/** Average natural ground over a disc (the level a site is flattened to). */
export function siteLevel(x: number, z: number, r: number): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const f of [0.3, 0.7, 1]) {
      s += terrainBase(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f);
      n++;
    }
  }
  return s / n;
}

export { mountainMask };
