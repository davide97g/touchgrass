import { sampleNoise } from '../../core/noise';
import { mountainMask, smoothstep, terrainHeight } from '../common';
import { findSummit } from '../summit';
import { Frame, house } from './kit';
import { M, lean } from './geom';
import { mulberry32, pick, range } from './rand';
import type { Plan, RealmMap, Site } from './Realm';
import { stoneLantern } from './more';

const TAU = Math.PI * 2;

/** A secret place: where it is, what the lens should frame, and where fast travel puts you. */
export interface Secret {
  id: string;
  x: number;
  z: number;
  /** Height of the subject above the ground at (x, z). */
  h: number;
  /** Subject radius. */
  r: number;
  /** A walkable spot to arrive at, facing the place. */
  approach: { x: number; z: number };
}

const wood = (x: number, z: number) => smoothstep(0.56, 0.68, sampleNoise(x / 1500 + 0.17, z / 1500 + 0.53, 1));

interface Search {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  step?: number;
  score: (x: number, z: number) => number;
  /** Expensive validation, run on the best candidates only. */
  valid: (x: number, z: number) => boolean;
}

function search(s: Search): { x: number; z: number } | null {
  const c: { x: number; z: number; s: number }[] = [];
  const st = s.step ?? 30;
  for (let x = s.x0; x <= s.x1; x += st) {
    for (let z = s.z0; z <= s.z1; z += st) {
      const v = s.score(x, z);
      if (v > -Infinity) c.push({ x, z, s: v });
    }
  }
  c.sort((a, b) => b.s - a.s);
  for (const k of c.slice(0, 120)) if (s.valid(k.x, k.z)) return k;
  return null;
}

/**
 * Hidden places: not on the compass, not in the travel list until found. A fairy ring in the
 * deepest eastern wood, a glowing well in a southern hollow, a swing on a knoll that looks at
 * the city, a sword in a stone on a bare north-eastern hill, a hermit's hut in the northern
 * woods, and the cairn on the summit. (The sky shrine sits on a floating island; see Island.ts.)
 */
export function planHidden(plan: Plan, m: RealmMap, sites: Site[]): void {
  const spawn = { x: -80, z: -120 };
  const nearSite = (x: number, z: number, pad: number) => sites.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + pad);
  const nearSolid = (x: number, z: number, r: number) =>
    plan.solids.some((s) => Math.abs(s.x - x) < r + 12 && Math.abs(s.z - z) < r + 12) || plan.secrets.some((q) => Math.hypot(q.x - x, q.z - z) < 150);
  const prominence = (x: number, z: number, R: number) => {
    let ring = 0;
    for (let k = 0; k < 10; k++) ring += m.groundNow(x + Math.cos(k * 0.628) * R, z + Math.sin(k * 0.628) * R);
    return m.groundNow(x, z) - ring / 10;
  };
  const slope = (x: number, z: number) => {
    const e = 3;
    return Math.hypot(m.groundNow(x + e, z) - m.groundNow(x - e, z), m.groundNow(x, z + e) - m.groundNow(x, z - e)) / (2 * e);
  };
  const free = (x: number, z: number, r: number, road = 40) =>
    mountainMask(x, z) < 0.02 && !nearSite(x, z, 70) && slope(x, z) < 0.25 && !nearSolid(x, z, r) && m.roadDist(x, z) > road && Math.hypot(x - spawn.x, z - spawn.z) > 160;
  const approach = (x: number, z: number, d: number, towardX = spawn.x, towardZ = spawn.z) => {
    const a = Math.atan2(towardZ - z, towardX - x);
    return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
  };

  // ---- The Fairy Ring: a glade in the deepest eastern wood ----
  const ring = search({
    x0: 0, x1: 1000, z0: -900, z1: 800,
    score: (x, z) => sampleNoise(x / 1500 + 0.17, z / 1500 + 0.53, 1) - Math.hypot(x - spawn.x, z - spawn.z) * 0.00004,
    valid: (x, z) => free(x, z, 16),
  });
  if (ring) {
    const { x: cx, z: cz } = ring;
    plan.clearings.push({ x: cx, z: cz, r: 14 });
    plan.pave(cx, cz, 7.5, 0, 0.3);
    plan.secrets.push({ id: 'fairyring', x: cx, z: cz, h: 0.4, r: 4.5, approach: approach(cx, cz, 10) });
    plan.props.push({
      layer: 'town',
      fn: (b) => {
        const r = mulberry32(0xfa1e);
        const n = 26;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + (r() - 0.5) * 0.12;
          const d = 4.3 + (r() - 0.5) * 0.5;
          const x = cx + Math.cos(a) * d;
          const z = cz + Math.sin(a) * d;
          const y = terrainHeight(x, z);
          const s = range(r, 1.0, 1.7);
          b.cyl(x, y - 0.05, z, 0.045 * s, 0.22 * s, '#efe6d6', M.plaster, 8, r());
          b.blob(x, y + 0.2 * s, z, 0.14 * s, 0.07 * s, 0.14 * s, r() * 6, pick(r, ['#5a8a80', '#6a8a98', '#628a72']), M.lamp, r());
        }
        // A few toadstools in the middle and a mossy stump.
        b.cyl(cx + 0.6, terrainHeight(cx + 0.6, cz) - 0.1, cz - 0.4, 0.45, 0.5, '#5a4632', M.wood, 12);
        b.cyl(cx + 0.6, terrainHeight(cx + 0.6, cz) + 0.38, cz - 0.4, 0.42, 0.06, '#6a8a40', M.turf, 12);
        for (let k = 0; k < 5; k++) {
          const x = cx + (r() - 0.5) * 2.5;
          const z = cz + (r() - 0.5) * 2.5;
          const y = terrainHeight(x, z);
          b.cyl(x, y - 0.05, z, 0.06, 0.32, '#f4eee0', M.plaster, 8, r());
          b.blob(x, y + 0.3, z, 0.2, 0.1, 0.2, 0, '#c8302a', M.cloth, r());
        }
      },
    });
    plan.disc(cx + 0.6, cz - 0.4, 0.5);
  }

  // ---- The Moonwell: a hollow in the southern woods ----
  const well = search({
    x0: -900, x1: 700, z0: 350, z1: 1100,
    score: (x, z) => -prominence(x, z, 40) * 0.5 + wood(x, z) * 3,
    valid: (x, z) => free(x, z, 10),
  });
  if (well) {
    const { x: cx, z: cz } = well;
    plan.clearings.push({ x: cx, z: cz, r: 9 });
    plan.disc(cx, cz, 1.3);
    plan.secrets.push({ id: 'moonwell', x: cx, z: cz, h: 0.9, r: 1.6, approach: approach(cx, cz, 6) });
    plan.lamps.push({ x: cx, y: terrainHeight(cx, cz) + 1.2, z: cz });
    plan.props.push({
      layer: 'town',
      fn: (b) => {
        const r = mulberry32(0x3e11);
        const y = terrainHeight(cx, cz);
        const n = 14;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          b.box(cx + Math.cos(a) * 1.05, y - 0.4, cz + Math.sin(a) * 1.05, 0.55, 1.25, 0.4, -a + Math.PI / 2, pick(r, ['#9a968a', '#8a8a80', '#a8a090']), M.stone, r(), lean(r() * TAU, 0.04));
        }
        b.cyl(cx, y + 0.55, cz, 0.85, 0.04, '#9ff8ff', M.rune, 20, 0.5);
        // Moss on the rim, a little roof on two posts.
        for (const s of [-1, 1]) b.cyl(cx + s * 1.2, y - 0.2, cz, 0.08, 2.6, '#5a4632', M.wood, 8);
        b.gable(cx, y + 2.35, cz, 3.0, 0.8, 1.6, 0, '#4a5a3a', M.roof, 0.4);
        b.box(cx, y + 1.8, cz, 2.3, 0.08, 0.08, 0, '#5a4632', M.wood);
        b.cyl(cx, y + 1.0, cz, 0.012, 0.8, '#3a3028', M.wood, 8);
        b.box(cx, y + 0.86, cz, 0.24, 0.2, 0.24, 0.4, '#6a5038', M.wood);
        const la = r() * TAU;
        const lx = cx + Math.cos(la) * 3.4;
        const lz = cz + Math.sin(la) * 3.4;
        stoneLantern(plan, b, lx, terrainHeight(lx, lz), lz, -la);
      },
    });
  }

  // ---- The Lone Swing: a knoll that looks across at the city ----
  const city = sites.find((s) => s.kind === 'city')!;
  const knoll = search({
    x0: city.x - 650, x1: city.x + 650, z0: city.z - 650, z1: city.z + 650,
    step: 25,
    score: (x, z) => {
      const d = Math.hypot(x - city.x, z - city.z);
      if (d < 260 || d > 640 || wood(x, z) > 0.05) return -Infinity;
      return prominence(x, z, 60) - Math.abs(d - 420) * 0.01;
    },
    valid: (x, z) => free(x, z, 8, 30),
  });
  if (knoll) {
    const { x: cx, z: cz } = knoll;
    const face = Math.atan2(city.z - cz, city.x - cx);
    plan.clearings.push({ x: cx, z: cz, r: 6 });
    plan.treeSpots.push({ x: cx, z: cz, s: 1.55, kind: 1 });
    const lx = cx + Math.cos(face) * 3.6;
    const lz = cz + Math.sin(face) * 3.6;
    plan.secrets.push({ id: 'swing', x: lx, z: lz, h: 1.4, r: 1.6, approach: { x: cx - Math.cos(face) * 7, z: cz - Math.sin(face) * 7 } });
    plan.props.push({
      layer: 'town',
      fn: (b) => {
        const y0 = terrainHeight(cx, cz);
        // A strong limb reaching out over the slope toward the view.
        const limbY = y0 + 4.6;
        const segs = 5;
        for (let i = 0; i < segs; i++) {
          const t0 = i / segs;
          const d0 = 0.4 + t0 * 4.6;
          const x0 = cx + Math.cos(face) * d0;
          const z0 = cz + Math.sin(face) * d0;
          const rad = 0.32 - t0 * 0.2;
          const q = lean(Math.PI / 2 - face, 1.45 - t0 * 0.1);
          b.cyl(x0, limbY - 0.35 + t0 * 0.5, z0, rad, 4.6 / segs + 0.1, '#5a4636', M.wood, 8, 0.5, q);
        }
        const sx = lx;
        const sz = lz;
        const sy = terrainHeight(sx, sz);
        const top = limbY + 0.2;
        const seatY = sy + 0.6;
        const px = Math.cos(face + Math.PI / 2);
        const pz = Math.sin(face + Math.PI / 2);
        for (const s of [-1, 1]) b.cyl(sx + px * s * 0.35, seatY, sz + pz * s * 0.35, 0.018, top - seatY, '#c8b890', M.cloth, 8, 0.4);
        b.box(sx, seatY - 0.03, sz, 0.9, 0.06, 0.32, -face + Math.PI / 2, '#8a6a48', M.wood, 0.5);
        // A small bench for watching the city, and wildflowers.
        const bx = cx + Math.cos(face + 0.9) * 2.6;
        const bz = cz + Math.sin(face + 0.9) * 2.6;
        const by = terrainHeight(bx, bz);
        b.box(bx, by + 0.42, bz, 1.6, 0.08, 0.42, -face + Math.PI / 2, '#7a5a3a', M.wood, 0.4);
        for (const s of [-1, 1]) b.box(bx + px * s * 0.65, by - 0.1, bz + pz * s * 0.65, 0.12, 0.52, 0.36, -face + Math.PI / 2, '#6a5034', M.wood, 0.5);
      },
    });
    plan.disc(bxOf(cx, face), bzOf(cz, face), 0.6);
  }

  // ---- The Unclaimed Blade: a bare north-eastern hilltop ----
  const hill = search({
    x0: 150, x1: 1000, z0: -1100, z1: -330,
    step: 25,
    score: (x, z) => (wood(x, z) > 0.02 ? -Infinity : prominence(x, z, 80)),
    valid: (x, z) => free(x, z, 8, 50),
  });
  if (hill) {
    const { x: cx, z: cz } = hill;
    plan.clearings.push({ x: cx, z: cz, r: 8 });
    plan.disc(cx, cz, 1.5);
    plan.secrets.push({ id: 'blade', x: cx, z: cz, h: 1.6, r: 1.2, approach: approach(cx, cz, 7) });
    plan.props.push({
      layer: 'far',
      fn: (b) => {
        const r = mulberry32(0xb1ade);
        const y = terrainHeight(cx, cz);
        b.blob(cx, y - 0.1, cz, 1.4, 0.75, 1.15, 0.3, '#8e8a80', M.rock, r());
        b.blob(cx + 0.9, y - 0.2, cz + 0.6, 0.7, 0.45, 0.6, 1.1, '#9a968a', M.rock, r());
        b.blob(cx - 1.0, y - 0.25, cz - 0.5, 0.6, 0.4, 0.7, 2.1, '#8a867c', M.rock, r());
        // The sword itself is drawn by Mysteries.ts (it can be pulled).
      },
    });
  }

  // ---- The Hermit's Hut: smoke out of the northern woods ----
  const hut = search({
    x0: -1200, x1: 300, z0: -1150, z1: -350,
    score: (x, z) => wood(x, z) * 2 - Math.hypot(x - spawn.x, z - spawn.z) * 0.0004,
    valid: (x, z) => free(x, z, 14, 45),
  });
  if (hut) {
    const { x: cx, z: cz } = hut;
    const rot = Math.atan2(spawn.x - cx, spawn.z - cz);
    plan.clearings.push({ x: cx, z: cz, r: 12 });
    plan.rect(cx, cz, 5.4, 4.6, rot);
    plan.secrets.push({ id: 'hut', x: cx, z: cz, h: 2.2, r: 3.4, approach: approach(cx, cz, 9) });
    const f = new Frame(cx, 0, cz, rot);
    plan.props.push({
      layer: 'town',
      fn: (b) => {
        const r = mulberry32(0x4e7);
        const y = terrainHeight(cx, cz);
        const fr = new Frame(cx, y, cz, rot);
        house(b, r, fr, {
          w: 4.6,
          d: 3.8,
          floors: 1,
          front: 1,
          style: 'cottage',
          roof: '#5a4a32',
          onChimney: (x, yy, z) => plan.smokes.push({ x, y: yy, z, s: 0.7 }),
        });
        // Woodpile and chopping block.
        for (let k = 0; k < 9; k++) {
          const u = 3.2 + (k % 3) * 0.32;
          b.cyl(fr.wx(u, -1 + Math.floor(k / 3) * 0.05), y + 0.15 + Math.floor(k / 3) * 0.28, fr.wz(u, -1 + Math.floor(k / 3) * 0.05), 0.14, 1.2, '#8a6a48', M.wood, 8, r(), lean(rot, Math.PI / 2));
        }
        b.cyl(fr.wx(-3, 2.8), y - 0.1, fr.wz(-3, 2.8), 0.32, 0.55, '#6a5038', M.wood, 12);
        void f;
      },
    });
    plan.lamps.push({ x: f.wx(1.6, 2.4), y: terrainHeight(f.wx(1.6, 2.4), f.wz(1.6, 2.4)) + 1.9, z: f.wz(1.6, 2.4) });
    plan.prop((b) => {
      const lx = f.wx(1.6, 2.4);
      const lz = f.wz(1.6, 2.4);
      const ly = terrainHeight(lx, lz);
      b.cyl(lx, ly - 0.2, lz, 0.05, 2.0, '#4a3a2a', M.wood, 8);
      b.box(lx, ly + 1.65, lz, 0.22, 0.3, 0.22, rot, '#ffcf7a', M.lamp, 0.8);
    });
    plan.fires.push({ x: f.wx(-2.2, 4.2), y: terrainHeight(f.wx(-2.2, 4.2), f.wz(-2.2, 4.2)) + 0.3, z: f.wz(-2.2, 4.2) });
    plan.prop((b) => {
      const fx = f.wx(-2.2, 4.2);
      const fz = f.wz(-2.2, 4.2);
      const fy = terrainHeight(fx, fz);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        b.blob(fx + Math.cos(a) * 0.55, fy, fz + Math.sin(a) * 0.55, 0.18, 0.14, 0.18, a, '#7a766c', M.rock, k / 8);
      }
      b.box(fx, fy + 0.1, fz, 0.7, 0.1, 0.12, 0.4, '#3a2a20', M.wood);
      b.box(fx, fy + 0.1, fz, 0.7, 0.1, 0.12, 1.9, '#3a2a20', M.wood);
    });
  }

  // ---- The summit cairn (Skyreach Summit): stones, a pole, prayer flags ----
  const sum = findSummit();
  {
    const cx = sum.x + 3.5;
    const cz = sum.z + 2;
    plan.disc(cx, cz, 1.0);
    plan.secrets.push({ id: 'summit', x: cx, z: cz, h: 1.4, r: 1.6, approach: { x: sum.x, z: sum.z } });
    plan.prop((b) => {
      const r = mulberry32(0xca12);
      const y = terrainHeight(cx, cz);
      let yy = y - 0.2;
      for (let k = 0; k < 7; k++) {
        const s = 0.75 - k * 0.09;
        b.blob(cx + (r() - 0.5) * 0.12, yy + s * 0.35, cz + (r() - 0.5) * 0.12, s, s * 0.45, s * 0.85, r() * 6, pick(r, ['#9a968c', '#a8a498', '#8a867e']), M.rock, r());
        yy += s * 0.62;
      }
      b.cyl(cx, yy, cz, 0.035, 2.6, '#5a4632', M.wood, 8);
      const top = yy + 2.5;
      const cols = ['#2f5fa8', '#e8e0cc', '#a83a3a', '#3a8a6a', '#c8a24a'];
      for (const dir of [0.4, 2.6, 4.4]) {
        const ex = cx + Math.cos(dir) * 6.5;
        const ez = cz + Math.sin(dir) * 6.5;
        const ey = terrainHeight(ex, ez) + 0.4;
        b.cyl(ex, ey - 0.6, ez, 0.03, 1.2, '#5a4632', M.wood, 8);
        const n = 9;
        for (let i = 1; i < n; i++) {
          const t = i / n;
          const sag = Math.sin(t * Math.PI) * 0.5;
          const fx = cx + (ex - cx) * t;
          const fz = cz + (ez - cz) * t;
          const fy = top + (ey + 0.6 - top) * t - sag;
          b.box(fx, fy - 0.32, fz, 0.26, 0.3, 0.012, -dir + Math.PI / 2, cols[i % cols.length], M.cloth, r());
        }
      }
    }, 'far');
  }
}

function bxOf(cx: number, face: number): number {
  return cx + Math.cos(face + 0.9) * 2.6;
}
function bzOf(cz: number, face: number): number {
  return cz + Math.sin(face + 0.9) * 2.6;
}
