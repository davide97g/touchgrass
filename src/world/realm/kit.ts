import { Quaternion, Vector3 } from 'three';
import { M, type Builder } from './geom';
import { pick, range, type Rng } from './rand';

/** Palettes: pale limestone and plaster walls, slate-blue, teal and terracotta roofs. */
export const STONE = ['#cfc6b4', '#bdb5a3', '#d8d0bf', '#b3ab9a', '#c9bfa8'];
export const PLASTER = ['#efe6d2', '#f3ead9', '#e8dcc2', '#f0e2c8', '#e4e0d4', '#f2dfc4'];
export const TIMBER = ['#4a3426', '#5a3d2b', '#3e2c22'];
export const ROOF_CITY = ['#3f5577', '#36506b', '#2f6a6c', '#4a5f86', '#8e4a33', '#3b4558', '#a0563a'];
export const ROOF_VILLAGE = ['#b8955a', '#a8844e', '#7c5a3a', '#8e4a33', '#9b6b45'];
export const CLOTH = ['#2f5fa8', '#c8a24a', '#a83a3a', '#3a8a6a', '#e8e0cc', '#6a4a9a', '#d0703a'];

/** Local frame of a building: origin at its centre on the ground, rotation about Y. */
export class Frame {
  readonly c: number;
  readonly s: number;
  constructor(readonly x: number, readonly y: number, readonly z: number, readonly rot: number) {
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
  }
  /** Local (u along X, v along Z) to world XZ. */
  wx(u: number, v: number): number {
    return this.x + u * this.c + v * this.s;
  }
  wz(u: number, v: number): number {
    return this.z - u * this.s + v * this.c;
  }
}

export interface HouseOpts {
  w: number;
  d: number;
  floors: number;
  /** Which local Z side the door faces (+1 or -1). */
  front: 1 | -1;
  style: 'city' | 'timber' | 'cottage' | 'stone';
  roof: string;
  /** Ridge across the street (gable end facing the front) instead of along it. */
  cross?: boolean;
  /** Called with the chimney top (for smoke). */
  onChimney?: (x: number, y: number, z: number) => void;
}

const FLOOR_H = 3.1;

/** A house: stone plinth, plastered or half-timbered storeys, windows, door, steep roof, chimney. */
export function house(b: Builder, r: Rng, f: Frame, o: HouseOpts): number {
  const { w, d, floors } = o;
  const wall = o.style === 'stone' ? pick(r, STONE) : pick(r, PLASTER);
  const stone = pick(r, STONE);
  const timber = pick(r, TIMBER);
  const groundStone = o.style !== 'cottage' || r() < 0.5;
  const jetty = o.style === 'timber' ? 0.22 : 0;
  const R = f.rot;

  // Plinth sunk into the ground so slopes never show a gap.
  b.box(f.x, f.y - 1.5, f.z, w + 0.35, 1.9, d + 0.35, R, stone, M.stone, r());

  let y = f.y + 0.4;
  for (let i = 0; i < floors; i++) {
    const grow = i > 0 ? jetty * i : 0;
    const fw = w + grow * 2;
    const fd = d + grow * 2;
    const isStone = (i === 0 && groundStone) || o.style === 'stone';
    b.box(f.x, y, f.z, fw, FLOOR_H, fd, R, isStone ? stone : wall, isStone ? M.stone : M.plaster, r());

    if (o.style === 'timber' && i > 0) timberFrame(b, f, fw, fd, y, timber);
    if (i > 0 && o.style !== 'stone') {
      // Floor beam band.
      b.box(f.x, y - 0.12, f.z, fw + 0.06, 0.24, fd + 0.06, R, timber, M.wood, r());
    }
    windows(b, r, f, fw, fd, y, i, o, timber);
    y += FLOOR_H;
  }

  // Dressed corner stones up the walls (not on half-timbered upper floors).
  if (o.style !== 'timber') {
    const qc = pick(r, ['#e2dccd', '#d8d0bf', '#c9c1b0']);
    const qh = (o.style === 'cottage' ? 1 : floors) * FLOOR_H;
    for (let k = 0, qy = f.y + 0.4; qy < f.y + 0.4 + qh - 0.2; k++, qy += 0.62) {
      const long = k % 2 === 0;
      for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const u = su * (w / 2 - (long ? 0.3 : 0.2)) + su * 0.03;
        const v = sv * (d / 2 - (long ? 0.2 : 0.3)) + sv * 0.03;
        b.box(f.wx(u, v), qy, f.wz(u, v), long ? 0.66 : 0.46, 0.56, long ? 0.46 : 0.66, R, qc, M.stone, r());
      }
    }
  }
  // Door step.
  b.box(f.wx(0, (d / 2 + 0.35) * o.front), f.y - 0.3, f.wz(0, (d / 2 + 0.35) * o.front), 1.8, 0.62, 0.7, R, stone, M.stone, r());

  // Door on the front.
  const dv = (d / 2 + 0.04) * o.front;
  b.box(f.wx(0, dv - 0.02 * o.front), f.y + 0.25, f.wz(0, dv - 0.02 * o.front), 1.55, 2.5, 0.16, R, stone, M.stone, r());
  b.box(f.wx(0, dv + 0.02 * o.front), f.y + 0.3, f.wz(0, dv + 0.02 * o.front), 1.2, 2.25, 0.14, R, timber, M.wood, r());
  b.box(f.wx(0, dv + 0.08 * o.front), f.y + 2.55, f.wz(0, dv + 0.08 * o.front), 1.6, 0.25, 0.3, R, stone, M.stone, r());
  if (r() < 0.35) {
    // Hanging lantern by the door.
    const lu = 1.15;
    b.box(f.wx(lu, dv + 0.25 * o.front), f.y + 2.3, f.wz(lu, dv + 0.25 * o.front), 0.26, 0.36, 0.26, R, '#ffcf7a', M.lamp, r());
  }

  // Roof.
  const top = y;
  const ow = floors > 1 ? jetty * (floors - 1) : 0;
  const rw = w + ow * 2 + 0.8;
  const rd = d + ow * 2 + 0.8;
  const cross = o.cross ?? false;
  const span = cross ? rw : rd;
  const rh = span * (o.style === 'cottage' ? 0.62 : 0.72);
  const trim = pick(r, TIMBER);
  if (cross) roof(b, new Frame(f.x, top, f.z, R + Math.PI / 2), rd, rw, rh, o.roof, trim, r());
  else roof(b, new Frame(f.x, top, f.z, R), rw, rd, rh, o.roof, trim, r());
  // Fill the triangular gable ends with wall.
  const gw = w + ow * 2;
  const gd = d + ow * 2;
  if (cross) b.prism(f.x, top, f.z, gd, rh * (gw / rw) * 0.97, gw, R + Math.PI / 2, wall, M.plaster, r());
  else b.prism(f.x, top, f.z, gw, rh * (gd / rd) * 0.97, gd, R, wall, M.plaster, r());

  if (r() < 0.75) {
    const cu = range(r, -w * 0.3, w * 0.3);
    const cv = range(r, -d * 0.2, d * 0.2);
    b.box(f.wx(cu, cv), top + rh * 0.3, f.wz(cu, cv), 0.75, rh * 0.85 + 0.8, 0.75, R, stone, M.stone, r());
    o.onChimney?.(f.wx(cu, cv), top + rh * 1.15 + 0.8, f.wz(cu, cv));
  }
  return top + rh;
}

/**
 * A roof with real thickness: two tiled slabs meeting at a ridge cap, barge boards along
 * the gable edges, a fascia under the eaves. Ridge along the frame's local X.
 */
function roof(b: Builder, f: Frame, rw: number, rd: number, rh: number, color: string, trim: string, rnd: number): void {
  const R = f.rot;
  const half = rd / 2;
  const L = Math.hypot(half, rh) + 0.12;
  const th = Math.atan2(rh, half);
  const t = 0.24;
  for (const s of [1, -1]) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), s * th);
    // Slab centre line sits on the slope, lifted by half its thickness.
    const v = s * half * 0.5;
    b.box(f.wx(0, v), f.y + rh * 0.5 - Math.cos(th) * 0.04, f.wz(0, v), rw, t, L, R, color, M.roof, rnd, q);
    // Barge boards on both gable ends.
    for (const e of [-1, 1]) {
      b.box(f.wx(e * (rw / 2 + 0.03), v), f.y + rh * 0.5 - 0.12, f.wz(e * (rw / 2 + 0.03), v), 0.07, 0.36, L, R, trim, M.wood, 0.5, q);
    }
    // Fascia under the eave.
    b.box(f.wx(0, s * (half + 0.02)), f.y - 0.18, f.wz(0, s * (half + 0.02)), rw + 0.06, 0.2, 0.08, R, trim, M.wood);
  }
  // Ridge cap.
  b.box(f.x, f.y + rh - 0.02, f.z, rw + 0.12, 0.2, 0.32, R, color, M.roof, rnd * 0.5);
  // Soffit so the eaves are not see-through from below.
  b.box(f.x, f.y - 0.06, f.z, rw - 0.02, 0.04, rd - 0.02, R, trim, M.wood);
}

function timberFrame(b: Builder, f: Frame, fw: number, fd: number, y: number, col: string): void {
  const R = f.rot;
  const t = 0.16;
  // Posts around the long faces.
  const n = Math.max(2, Math.round(fw / 1.6));
  for (const side of [-1, 1]) {
    const v = side * (fd / 2 + 0.02);
    for (let i = 0; i <= n; i++) {
      const u = -fw / 2 + (fw * i) / n;
      b.box(f.wx(u, v), y, f.wz(u, v), t, FLOOR_H, 0.08, R, col, M.wood);
    }
    // Diagonal braces at the ends.
    for (const e of [-1, 1]) {
      const u = e * (fw / 2 - fw / n / 2);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), e * 0.75);
      b.box(f.wx(u, v), y + 0.25, f.wz(u, v), t, FLOOR_H * 0.9, 0.07, R, col, M.wood, 0.5, q);
    }
  }
  const m = Math.max(2, Math.round(fd / 1.6));
  for (const side of [-1, 1]) {
    const u = side * (fw / 2 + 0.02);
    for (let i = 0; i <= m; i++) {
      const v = -fd / 2 + (fd * i) / m;
      b.box(f.wx(u, v), y, f.wz(u, v), 0.08, FLOOR_H, t, R, col, M.wood);
    }
  }
  b.box(f.x, y + FLOOR_H - 0.12, f.z, fw + 0.04, 0.16, fd + 0.04, R, col, M.wood);
}

function windows(b: Builder, r: Rng, f: Frame, fw: number, fd: number, y: number, floor: number, o: HouseOpts, timber: string): void {
  const R = f.rot;
  const wy = y + 0.95;
  const n = Math.max(1, Math.floor((fw - 0.8) / 2.1));
  const shutters = o.style === 'cottage' || r() < 0.4;
  const shutterCol = pick(r, ['#3f6a5a', '#4a5f86', '#7a3b2e', '#5a6a3a', timber]);
  for (const side of [-1, 1]) {
    const v = side * (fd / 2 + 0.03);
    for (let i = 0; i < n; i++) {
      const u = -fw / 2 + (fw * (i + 0.5)) / n;
      if (floor === 0 && side === o.front && Math.abs(u) < 1.3) continue; // the door
      const frame = o.style === 'timber' || o.style === 'cottage' ? timber : '#e6e0d2';
      const fk = o.style === 'timber' || o.style === 'cottage' ? M.wood : M.stone;
      // Glass set back in the wall, a frame of four bars standing proud around it, glazing bars across.
      b.box(f.wx(u, v - 0.01 * side), wy, f.wz(u, v - 0.01 * side), 0.92, 1.36, 0.04, R, '#2a3446', M.window, r());
      for (const [du, dy, bw, bh] of [[0, 1.36, 1.14, 0.12], [0, -0.1, 1.14, 0.12], [-0.52, 0, 0.11, 1.36], [0.52, 0, 0.11, 1.36]] as const) {
        b.box(f.wx(u + du, v + side * 0.04), wy + dy, f.wz(u + du, v + side * 0.04), bw, bh, 0.1, R, frame, fk);
      }
      b.box(f.wx(u, v + side * 0.02), wy, f.wz(u, v + side * 0.02), 0.05, 1.36, 0.04, R, frame, M.wood);
      b.box(f.wx(u, v + side * 0.02), wy + 0.86, f.wz(u, v + side * 0.02), 0.92, 0.05, 0.04, R, frame, M.wood);
      b.box(f.wx(u, v + side * 0.07), wy - 0.2, f.wz(u, v + side * 0.07), 1.3, 0.12, 0.28, R, o.style === 'city' || o.style === 'stone' ? '#d8d0bf' : timber, M.stone);
      if (o.style !== 'timber') b.box(f.wx(u, v + side * 0.03), wy + 1.42, f.wz(u, v + side * 0.03), 1.35, 0.24, 0.14, R, '#d8d0bf', M.stone);
      if (shutters) {
        for (const s of [-1, 1]) {
          b.box(f.wx(u + s * 0.68, v + side * 0.02), wy, f.wz(u + s * 0.68, v + side * 0.02), 0.4, 1.35, 0.07, R, shutterCol, M.wood);
        }
      }
      if (floor > 0 && r() < 0.25) {
        // Flower box.
        b.box(f.wx(u, v + side * 0.2), wy - 0.32, f.wz(u, v + side * 0.2), 1.0, 0.25, 0.3, R, timber, M.wood);
        b.box(f.wx(u, v + side * 0.2), wy - 0.1, f.wz(u, v + side * 0.2), 0.95, 0.22, 0.26, R, pick(r, ['#d0405a', '#f0c040', '#e070b0', '#f4f0ff']), M.foliage, r());
      }
    }
  }
  if (floor > 0 || r() < 0.5) {
    for (const side of [-1, 1]) {
      const u = side * (fw / 2 + 0.03);
      b.box(f.wx(u, 0), wy, f.wz(u, 0), 0.1, 1.35, 0.95, R, '#2a3446', M.window, r());
    }
  }
}

/** Round tower with conical roof. Returns the roof tip height. */
export function roundTower(b: Builder, r: Rng, x: number, y: number, z: number, rad: number, h: number, roof: string, stone = pick(r, STONE), opts: { crenel?: boolean; windows?: boolean } = {}): number {
  b.cyl(x, y - 2, z, rad, h + 2, stone, M.stone, 20, r());
  b.cyl(x, y + h - 0.1, z, rad + 0.35, 0.5, stone, M.stone, 20, r());
  if (opts.windows !== false) {
    const rows = Math.floor(h / 5);
    for (let k = 1; k <= rows; k++) {
      const a = r() * Math.PI * 2;
      for (let i = 0; i < 3; i++) {
        const aa = a + (i * Math.PI * 2) / 3;
        b.box(x + Math.cos(aa) * (rad + 0.02), y + k * 4.2, z + Math.sin(aa) * (rad + 0.02), 0.7, 1.4, 0.14, -aa + Math.PI / 2, '#2a3446', M.window, r());
      }
    }
  }
  if (opts.crenel) {
    const n = Math.round(rad * 2.4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      b.box(x + Math.cos(a) * (rad + 0.1), y + h + 0.4, z + Math.sin(a) * (rad + 0.1), 0.8, 0.9, 0.6, -a + Math.PI / 2, stone, M.stone, r());
    }
    return y + h + 1.3;
  }
  const rh = rad * 2.6;
  b.cone(x, y + h + 0.4, z, rad + 0.7, rh, roof, M.roof, 12, r());
  b.cyl(x, y + h + 0.4 + rh - 0.4, z, 0.06, 2.2, '#3a3a40', M.metal, 8);
  return y + h + 0.4 + rh;
}

/** A pennant on a pole. */
export function banner(b: Builder, x: number, y: number, z: number, dir: number, color: string, len = 2.6): void {
  b.cyl(x, y, z, 0.06, 3.2, '#3a3a40', M.metal, 8);
  b.box(x + Math.cos(dir) * len * 0.5, y + 2.2, z - Math.sin(dir) * len * 0.5, len, 0.9, 0.05, dir, color, M.cloth, Math.random());
}

/** Street lamp: iron post, glass lantern that glows at dusk. */
export function lamp(b: Builder, x: number, y: number, z: number, rot = 0): void {
  b.cyl(x, y - 0.3, z, 0.22, 0.6, '#5a5a60', M.stone, 8);
  b.cyl(x, y, z, 0.07, 3.5, '#2e2f36', M.metal, 8);
  b.box(x, y + 3.4, z, 0.42, 0.55, 0.42, rot, '#ffd590', M.lamp, Math.random());
  b.pyramid(x, y + 3.92, z, 0.62, 0.38, 0.62, rot, '#2e2f36', M.metal);
}

/** Small round tree (for gardens and squares). */
export function smallTree(b: Builder, r: Rng, x: number, y: number, z: number, s = 1): void {
  b.cyl(x, y - 0.3, z, 0.18 * s, 2.4 * s, '#5a4232', M.wood, 8);
  const g = pick(r, ['#4c8a3a', '#5a9a40', '#3f7a3a', '#6aa048']);
  b.blob(x, y + 3.0 * s, z, 1.6 * s, 1.4 * s, 1.6 * s, r() * 6, g, M.foliage, r());
  b.blob(x + 0.7 * s, y + 3.5 * s, z + 0.3 * s, 1.1 * s, 1.0 * s, 1.1 * s, r() * 6, g, M.foliage, r());
  b.blob(x - 0.5 * s, y + 3.7 * s, z - 0.4 * s, 1.0 * s, 0.9 * s, 1.0 * s, r() * 6, g, M.foliage, r());
}
