import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
} from 'three';
import { U } from '../core/uniforms';
import { setFeatureSampler, smoothstep, terrainBase } from './common';

/**
 * Fairy pools: chains of clear pools stepping down a slope, joined by small
 * meandering streams with little cascades. Generated deterministically per
 * world cell, then baked into a player-centred map the GPU samples for terrain
 * carving, grass suppression and water depth; the CPU reads the same map.
 */

export interface Pool {
  x: number;
  z: number;
  r: number;
  level: number;
  seed: number;
}

export interface Stream {
  pts: { x: number; z: number }[];
  levels: number[];
  halfW: number;
  seed: number;
}

export interface Rock {
  x: number;
  z: number;
  s: number;
  rot: number;
  squash: number;
  sink: number;
}

interface CellFeatures {
  pools: Pool[];
  streams: Stream[];
  rocks: Rock[];
}

const CELL = 200;
const RES = 1024;
const SIZE = 512;
const TEXEL = SIZE / RES;
const RECENTER = 110;
const SNAP = 64;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellSeed(i: number, j: number): number {
  return (Math.imul(i, 0x1f1f1f1f) ^ Math.imul(j, 0x5bd1e995) ^ 0x9e3779b9) >>> 0;
}

/** Water level along a stream: mostly flat runs broken by two small cascades. */
function cascade(s: number): number {
  const c = 0.5 * smoothstep(0.26, 0.31, s) + 0.5 * smoothstep(0.63, 0.68, s);
  return 0.25 * s + 0.75 * c;
}

const cellCache = new Map<string, CellFeatures>();

function genCell(ci: number, cj: number): CellFeatures {
  const key = `${ci},${cj}`;
  const cached = cellCache.get(key);
  if (cached) return cached;
  const r = mulberry32(cellSeed(ci, cj));
  const out: CellFeatures = { pools: [], streams: [], rocks: [] };
  cellCache.set(key, out);
  if (r() > 0.68) return out;

  // The main pool settles in the lowest spot of the cell.
  let bx = 0;
  let bz = 0;
  let bh = Infinity;
  for (let k = 0; k < 24; k++) {
    const x = (ci + 0.2 + 0.6 * r()) * CELL;
    const z = (cj + 0.2 + 0.6 * r()) * CELL;
    const h = terrainBase(x, z);
    if (h < bh) {
      bh = h;
      bx = x;
      bz = z;
    }
  }
  const main: Pool = { x: bx, z: bz, r: 6 + r() * 6, level: bh - 0.2, seed: Math.floor(r() * 1e9) };
  const chain: Pool[] = [main];

  // Smaller pools step up the slope from it.
  const nUp = 1 + Math.floor(r() * 3);
  let cur = main;
  for (let k = 0; k < nUp; k++) {
    const e = 2;
    const gx = terrainBase(cur.x + e, cur.z) - terrainBase(cur.x - e, cur.z);
    const gz = terrainBase(cur.x, cur.z + e) - terrainBase(cur.x, cur.z - e);
    const gl = Math.hypot(gx, gz) || 1;
    const turn = (r() - 0.5) * 1.1;
    const dx = (gx / gl) * Math.cos(turn) - (gz / gl) * Math.sin(turn);
    const dz = (gx / gl) * Math.sin(turn) + (gz / gl) * Math.cos(turn);
    const pr = 2.4 + r() * 3.2;
    const step = cur.r + pr + 7 + r() * 11;
    const x = cur.x + dx * step;
    const z = cur.z + dz * step;
    const lvl = Math.max(terrainBase(x, z) - 0.2, cur.level + 0.45 + r() * 0.5);
    const p: Pool = { x, z, r: pr, level: lvl, seed: Math.floor(r() * 1e9) };
    chain.push(p);
    cur = p;
  }
  out.pools.push(...chain);

  // Streams from each upper pool down to the one below it.
  for (let k = chain.length - 1; k > 0; k--) {
    const up = chain[k];
    const lo = chain[k - 1];
    const dx = lo.x - up.x;
    const dz = lo.z - up.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const sx = up.x + ux * up.r * 0.7;
    const sz = up.z + uz * up.r * 0.7;
    const ex = lo.x - ux * lo.r * 0.7;
    const ez = lo.z - uz * lo.r * 0.7;
    const bend = (r() - 0.5) * len * 0.45;
    const cx = (sx + ex) / 2 - uz * bend;
    const cz = (sz + ez) / 2 + ux * bend;
    const pts: { x: number; z: number }[] = [];
    const levels: number[] = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      pts.push({ x: a * sx + b * cx + c * ex, z: a * sz + b * cz + c * ez });
      levels.push(up.level + (lo.level - up.level) * cascade(t));
    }
    const halfW = 0.55 + r() * 0.6;
    out.streams.push({ pts, levels, halfW, seed: Math.floor(r() * 1e9) });

    // Boulders at each cascade lip and along the banks.
    for (const s of [0.28, 0.65]) {
      const i = Math.round(s * N);
      const p = pts[i];
      const q = pts[Math.min(N, i + 1)];
      const tx = q.x - p.x;
      const tz = q.z - p.z;
      const tl = Math.hypot(tx, tz) || 1;
      for (const side of [-1, 1]) {
        out.rocks.push({
          x: p.x + (-tz / tl) * side * (halfW + 0.3 + r() * 0.5),
          z: p.z + (tx / tl) * side * (halfW + 0.3 + r() * 0.5),
          s: 0.6 + r() * 0.7, rot: r() * 6.28, squash: 0.55 + r() * 0.3, sink: 0.35,
        });
      }
    }
    for (let i = 0; i < 6; i++) {
      const t = r();
      const p = pts[Math.floor(t * N)];
      const side = r() < 0.5 ? -1 : 1;
      const off = halfW * (0.6 + r() * 2.2) * side;
      out.rocks.push({ x: p.x + off * -uz, z: p.z + off * ux, s: 0.2 + r() * 0.5, rot: r() * 6.28, squash: 0.5 + r() * 0.4, sink: 0.3 });
    }
  }

  // Granite rocks scattered around the rims, some half-drowned.
  for (const p of chain) {
    const n = Math.floor(4 + p.r * 0.9);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = p.r * (0.75 + r() * 0.6);
      out.rocks.push({
        x: p.x + Math.cos(a) * d,
        z: p.z + Math.sin(a) * d,
        s: 0.25 + r() * r() * 1.3,
        rot: r() * 6.28,
        squash: 0.45 + r() * 0.4,
        sink: 0.3 + r() * 0.2,
      });
    }
  }
  return out;
}

export interface ActiveFeatures {
  pools: Pool[];
  streams: Stream[];
  rocks: Rock[];
}

export class FeatureMap {
  readonly texture: DataTexture;
  readonly center = { x: 0, z: 0 };
  active: ActiveFeatures = { pools: [], streams: [], rocks: [] };
  version = 0;
  onChange: (() => void) | null = null;

  private readonly half = new Uint16Array(RES * RES * 4);
  private readonly dh = new Float32Array(RES * RES);
  private readonly bank = new Float32Array(RES * RES);
  private readonly level = new Float32Array(RES * RES);
  private readonly mask = new Float32Array(RES * RES);
  private built = false;

  constructor() {
    this.texture = new DataTexture(this.half, RES, RES, RGBAFormat, HalfFloatType);
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    U.uFeat.value = this.texture;
    U.uFeatSize.value = SIZE;
    setFeatureSampler((x, z) => this.sample(x, z, 0));
  }

  update(x: number, z: number): void {
    if (this.built && Math.hypot(x - this.center.x, z - this.center.z) < RECENTER) return;
    this.rebuild(Math.round(x / SNAP) * SNAP, Math.round(z / SNAP) * SNAP);
  }

  /** Bilinear sample of a channel (0 dh, 1 bank, 2 level, 3 mask), identical to the GPU. */
  sample(x: number, z: number, ch: 0 | 1 | 2 | 3): number {
    if (!this.built) return ch === 2 ? -1000 : 0;
    const u = (x - this.center.x) / SIZE + 0.5;
    const v = (z - this.center.z) / SIZE + 0.5;
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) return ch === 2 ? -1000 : 0;
    const arr = [this.dh, this.bank, this.level, this.mask][ch];
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

  /** Water depth at a point (0 when dry). */
  waterDepth(x: number, z: number): number {
    if (this.sample(x, z, 3) < 0.5) return 0;
    return Math.max(0, this.sample(x, z, 2) - (terrainBase(x, z) + this.sample(x, z, 0)));
  }

  /** Distance to the nearest stream (for the brook sound) and to the nearest pool edge. */
  nearestWater(x: number, z: number): { stream: number; pool: number; pan: { x: number; z: number } } {
    let stream = Infinity;
    let sp = { x, z };
    for (const s of this.active.streams) {
      for (let i = 0; i < s.pts.length; i += 2) {
        const d = Math.hypot(s.pts[i].x - x, s.pts[i].z - z);
        if (d < stream) {
          stream = d;
          sp = s.pts[i];
        }
      }
    }
    let pool = Infinity;
    for (const p of this.active.pools) pool = Math.min(pool, Math.max(0, Math.hypot(p.x - x, p.z - z) - p.r));
    return { stream, pool, pan: sp };
  }

  private rebuild(cx: number, cz: number): void {
    this.center.x = cx;
    this.center.z = cz;
    U.uFeatCenter.value.set(cx, cz);
    this.dh.fill(0);
    this.bank.fill(0);
    this.level.fill(0);
    this.mask.fill(0);
    this.half.fill(0);

    const margin = 40;
    const lo = { x: cx - SIZE / 2 + margin, z: cz - SIZE / 2 + margin };
    const hi = { x: cx + SIZE / 2 - margin, z: cz + SIZE / 2 - margin };
    const active: ActiveFeatures = { pools: [], streams: [], rocks: [] };
    for (let ci = Math.floor(lo.x / CELL) - 1; ci <= Math.floor(hi.x / CELL) + 1; ci++) {
      for (let cj = Math.floor(lo.z / CELL) - 1; cj <= Math.floor(hi.z / CELL) + 1; cj++) {
        const f = genCell(ci, cj);
        if (f.pools.length === 0) continue;
        // Keep a chain only if all of it fits inside the map.
        const inside = f.pools.every((p) => p.x - p.r * 2 > lo.x && p.x + p.r * 2 < hi.x && p.z - p.r * 2 > lo.z && p.z + p.r * 2 < hi.z);
        if (!inside) continue;
        active.pools.push(...f.pools);
        active.streams.push(...f.streams);
        active.rocks.push(...f.rocks);
      }
    }

    // Streams first (they cut channels), then pools (which respect those channels).
    const touched: [number, number, number, number][] = [];
    for (const s of active.streams) touched.push(this.stampStream(s));
    for (const p of active.pools) touched.push(this.stampPool(p));

    for (const [x0, y0, x1, y1] of touched) {
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const k = j * RES + i;
          const o = k * 4;
          this.half[o] = DataUtils.toHalfFloat(this.dh[k]);
          this.half[o + 1] = DataUtils.toHalfFloat(this.bank[k]);
          this.half[o + 2] = DataUtils.toHalfFloat(this.level[k]);
          this.half[o + 3] = DataUtils.toHalfFloat(this.mask[k]);
          this.dh[k] = DataUtils.fromHalfFloat(this.half[o]);
          this.bank[k] = DataUtils.fromHalfFloat(this.half[o + 1]);
          this.level[k] = DataUtils.fromHalfFloat(this.half[o + 2]);
          this.mask[k] = DataUtils.fromHalfFloat(this.half[o + 3]);
        }
      }
    }
    this.texture.needsUpdate = true;
    this.active = active;
    this.built = true;
    this.version++;
    this.onChange?.();
  }

  private bbox(x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
    const toI = (x: number, c: number) => Math.max(0, Math.min(RES - 1, Math.floor((x - c + SIZE / 2) / TEXEL)));
    return [toI(x0, this.center.x), toI(z0, this.center.z), toI(x1, this.center.x), toI(z1, this.center.z)];
  }

  private texelPos(i: number, j: number): [number, number] {
    return [this.center.x - SIZE / 2 + (i + 0.5) * TEXEL, this.center.z - SIZE / 2 + (j + 0.5) * TEXEL];
  }

  private merge(k: number, h0: number, h1: number, bank: number, mask: number, level: number): void {
    this.dh[k] += h1 - h0;
    this.bank[k] = Math.max(this.bank[k], bank);
    if (mask > this.mask[k] || this.mask[k] < 0.01) {
      this.level[k] = level;
    }
    this.mask[k] = Math.max(this.mask[k], mask);
  }

  private stampPool(p: Pool): [number, number, number, number] {
    const R2 = p.r * 2;
    const depth = Math.min(1.6, Math.max(0.55, p.r * 0.14));
    const box = this.bbox(p.x - R2, p.z - R2, p.x + R2, p.z + R2);
    for (let j = box[1]; j <= box[3]; j++) {
      for (let i = box[0]; i <= box[2]; i++) {
        const [x, z] = this.texelPos(i, j);
        const d = Math.hypot(x - p.x, z - p.z);
        if (d >= R2) continue;
        const k = j * RES + i;
        const h0 = terrainBase(x, z) + this.dh[k];
        let h1: number;
        if (d <= p.r) {
          const q = d / p.r;
          // Irregular, rocky bottom.
          const rough = (Math.sin(x * 1.7 + p.seed) * Math.sin(z * 1.3 - p.seed) * 0.5 + 0.5) * 0.15;
          h1 = p.level + 0.05 - depth * (1 - q * q) + rough * q;
        } else {
          const t = smoothstep(p.r, R2, d);
          const shore = p.level + 0.05 + (d - p.r) * 0.06;
          h1 = shore * (1 - t) + h0 * t;
          if (this.mask[k] > 0.3) h1 = Math.min(h1, h0); // keep stream channels open
        }
        const bank = 1 - smoothstep(p.r * 0.97, p.r * 1.12 + 1.6, d);
        const mask = 1 - smoothstep(p.r * 0.95, p.r * 1.12, d);
        this.merge(k, h0, h1, bank, mask, p.level);
      }
    }
    return box;
  }

  private stampStream(s: Stream): [number, number, number, number] {
    const w = s.halfW;
    const R2 = w * 3.4 + 0.6;
    const depth = 0.22 + w * 0.15;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of s.pts) {
      x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
    }
    const box = this.bbox(x0 - R2, z0 - R2, x1 + R2, z1 + R2);
    const n = s.pts.length - 1;
    for (let j = box[1]; j <= box[3]; j++) {
      for (let i = box[0]; i <= box[2]; i++) {
        const [x, z] = this.texelPos(i, j);
        // Closest point on the polyline.
        let best = Infinity;
        let bestS = 0;
        for (let k = 0; k < n; k++) {
          const a = s.pts[k];
          const b = s.pts[k + 1];
          const vx = b.x - a.x;
          const vz = b.z - a.z;
          const l2 = vx * vx + vz * vz || 1;
          const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
          const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
          if (d < best) {
            best = d;
            bestS = k + t;
          }
        }
        if (best >= R2) continue;
        const k0 = Math.floor(bestS);
        const W = s.levels[k0] + (s.levels[Math.min(n, k0 + 1)] - s.levels[k0]) * (bestS - k0);
        const k = j * RES + i;
        const h0 = terrainBase(x, z) + this.dh[k];
        let h1: number;
        if (best <= w) {
          const q = best / w;
          h1 = W + 0.03 - depth * (1 - q * q);
        } else {
          const t = smoothstep(w, R2, best);
          h1 = (W + 0.03 + (best - w) * 0.12) * (1 - t) + h0 * t;
        }
        const bank = 1 - smoothstep(w, w * 2.2 + 0.4, best);
        const mask = 1 - smoothstep(w * 0.95, w * 1.15, best);
        this.merge(k, h0, h1, bank, mask, W);
      }
    }
    return box;
  }
}
