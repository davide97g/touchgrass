import { Quaternion, Vector3 } from 'three';
import { terrainHeight } from '../common';
import { lean, M } from './geom';
import { Frame, house, lamp, ROOF_VILLAGE, roundTower, STONE } from './kit';
import { mulberry32, pick, range } from './rand';
import type { Plan, Site } from './Realm';

const TAU = Math.PI * 2;

function angDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * A farming village: cottages around a small square with a well, a windmill or two on the
 * rise, a fenced pasture, hay and carts. `roadAngles` are where roads leave the square.
 */
export function planVillage(plan: Plan, site: Site, roadAngles: number[], seed: number, mills: number, pasture: 'sheep' | 'horse'): void {
  const r = mulberry32(seed);
  const { x: cx, z: cz, r: R } = site;
  const y0 = site.level;
  plan.flat(cx, cz, R * 0.75, 30, y0);
  plan.pave(cx, cz, 10, 0.35);
  plan.disc(cx, cz, 1.4);
  plan.prop((b) => {
    // Well.
    b.cyl(cx, y0 - 0.5, cz, 1.3, 1.4, '#b8b0a0', M.stone, 12);
    b.cyl(cx, y0 + 0.85, cz, 1.05, 0.08, '#2a4050', M.window, 12, 0.1);
    for (const s of [-1, 1]) b.box(cx + s * 1.1, y0 + 0.9, cz, 0.18, 2.1, 0.18, 0, '#5a4232', M.wood);
    b.gable(cx, y0 + 2.9, cz, 2.8, 0.9, 2.0, 0, '#7c5a3a', M.roof);
  });

  const blocked = (a: number, rr: number, w: number) => roadAngles.some((g) => Math.abs(angDiff(a, g)) * rr < 4.2 + w * 0.6);
  const placed: { x: number; z: number; r: number }[] = [{ x: cx, z: cz, r: 9 }];
  const n = 11 + Math.floor(r() * 5);
  for (let i = 0, tries = 0; i < n && tries < 300; tries++) {
    const a = r() * TAU;
    const rr = range(r, 15, R * 0.7);
    const w = range(r, 5.5, 8.5);
    const d = range(r, 5, 7);
    if (blocked(a, rr, w)) continue;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const rad = Math.hypot(w, d) / 2 + 1.5;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + rad)) continue;
    placed.push({ x, z, r: rad });
    const rot = -a - Math.PI / 2 + range(r, -0.25, 0.25);
    const floors = r() < 0.3 ? 2 : 1;
    const style = r() < 0.6 ? 'cottage' : 'timber';
    const roof = pick(r, ROOF_VILLAGE);
    const s2 = r();
    plan.rect(x, z, w + 0.5, d + 0.5, rot);
    plan.prop((b) => {
      const f0 = new Frame(x, 0, z, rot);
      let yy = terrainHeight(x, z);
      for (const [u, v] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) yy = Math.min(yy, terrainHeight(f0.wx(u, v), f0.wz(u, v)));
      house(b, mulberry32(Math.floor(s2 * 1e9)), new Frame(x, yy, z, rot), { w, d, floors, front: 1, style, roof, cross: r() < 0.25, onChimney: (cx2, cy2, cz2) => s2 < 0.55 && plan.smokes.push({ x: cx2, y: cy2, z: cz2, s: 1 }) });
    });
    i++;
  }

  // Windmills on the edge of the village.
  for (let m = 0; m < mills; m++) {
    let a = r() * TAU;
    for (let k = 0; k < 20 && roadAngles.some((g) => Math.abs(angDiff(a, g)) < 0.5); k++) a = r() * TAU;
    const rr = R * range(r, 0.85, 1.05);
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    plan.disc(x, z, 4.2);
    const face = r() * TAU;
    plan.prop((b) => {
      const y = terrainHeight(x, z);
      b.frustum(x, y - 2, z, 4.0, 2.7, 15, '#e8e0cc', M.plaster, 12, r());
      b.frustum(x, y - 2, z, 4.25, 4.05, 3.2, pick(r, STONE), M.stone, 12);
      b.cone(x, y + 13, z, 3.4, 4.6, '#7c5a3a', M.roof, 12);
      for (let k = 0; k < 4; k++) {
        const aa = face + k * 1.6 + 0.4;
        b.box(x + Math.cos(aa) * 3.0, y + 4 + k * 2.4, z + Math.sin(aa) * 3.0, 0.8, 1.2, 0.14, -aa + Math.PI / 2, '#2a3446', M.window, r());
      }
      b.box(x + Math.cos(face) * 3.3, y, z + Math.sin(face) * 3.3, 1.3, 2.2, 0.2, -face + Math.PI / 2, '#5a3d2b', M.wood);
      plan.windmills.push({ x: x + Math.cos(face) * 3.4, y: y + 12.2, z: z + Math.sin(face) * 3.4, rot: face, r: 9 });
    });
  }

  // Pasture with a split-rail fence.
  let pa = r() * TAU;
  for (let k = 0; k < 30 && roadAngles.some((g) => Math.abs(angDiff(pa, g)) < 0.7); k++) pa = r() * TAU;
  const pr = 26;
  const px = cx + Math.cos(pa) * (R + pr * 0.9);
  const pz = cz + Math.sin(pa) * (R + pr * 0.9);
  plan.pastures.push({ x: px, z: pz, r: pr - 2, kind: pasture });
  const posts = 44;
  for (let i = 0; i < posts; i++) {
    const a0 = (i / posts) * TAU;
    const a1 = ((i + 1) / posts) * TAU;
    if (Math.abs(angDiff(a0, pa + Math.PI)) < 0.12) continue; // the gate faces the village
    const x0 = px + Math.cos(a0) * pr;
    const z0 = pz + Math.sin(a0) * pr;
    const x1 = px + Math.cos(a1) * pr;
    const z1 = pz + Math.sin(a1) * pr;
    plan.disc(x0, z0, 0.35);
    plan.prop((b) => {
      const y0p = terrainHeight(x0, z0);
      const y1p = terrainHeight(x1, z1);
      b.box(x0, y0p - 0.4, z0, 0.16, 1.7, 0.16, -a0, '#6a5038', M.wood);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const rot = Math.atan2(-(z1 - z0), x1 - x0);
      const slope = Math.atan2(y1p - y0p, len);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), slope);
      for (const hy of [0.55, 1.05]) {
        b.box((x0 + x1) / 2, (y0p + y1p) / 2 + hy, (z0 + z1) / 2, len + 0.1, 0.09, 0.07, rot, '#7a5c40', M.wood, 0.5, q);
      }
    });
  }
  // A shed and some hay inside the pasture.
  plan.rect(px + 8, pz - 6, 6, 4.5, 0.3);
  plan.prop((b) => {
    const y = terrainHeight(px + 8, pz - 6);
    b.box(px + 8, y - 1, pz - 6, 6, 3.6, 4.5, 0.3, '#6a4a32', M.wood);
    b.gable(px + 8, y + 2.6, pz - 6, 6.6, 2, 5.2, 0.3, '#7c5a3a', M.roof);
    b.prism(px + 8, y + 2.6, pz - 6, 5.98, 1.75, 4.48, 0.3, '#6a4a32', M.wood);
  });
  for (let k = 0; k < 6; k++) {
    const a = r() * TAU;
    const d = range(r, 6, R * 0.95);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (blocked(a, d, 2) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 1.5)) continue;
    plan.disc(x, z, 1.0);
    plan.prop((b) => {
      const y = terrainHeight(x, z);
      if (k % 2 === 0) {
        b.cyl(x, y - 0.2, z, 1.1, 1.2, '#d8b860', M.foliage, 12, 0.9);
        b.cone(x, y + 1.0, z, 1.1, 0.9, '#d8b860', M.foliage, 12, 0.9);
      } else {
        b.cyl(x, y - 0.2, z, 0.45, 1.1, '#6a4a32', M.wood, 8);
        b.cyl(x + 0.95, y - 0.2, z + 0.3, 0.42, 1.0, '#6a4a32', M.wood, 8);
      }
    });
  }
  // Lanterns on the square and a few village trees.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const x = cx + Math.cos(a) * 9.5;
    const z = cz + Math.sin(a) * 9.5;
    plan.lamps.push({ x, y: y0 + 3.6, z });
    plan.prop((b) => lamp(b, x, y0, z, a));
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU;
    const d = range(r, 12, R * 1.1);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (blocked(a, d, 3) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 2)) continue;
    plan.disc(x, z, 0.5);
    plan.treeSpots.push({ x, z, s: range(r, 0.8, 1.1), kind: r() < 0.5 ? 1 : r() < 0.6 ? 2 : 3 });
  }
}

/**
 * Ruins on a hilltop: a broken colonnade around an altar where a crystal turns in the air,
 * a cracked watchtower, fallen drums in the grass.
 */
export function planRuins(plan: Plan, site: Site): void {
  const r = mulberry32(0x5e11);
  const { x: cx, z: cz } = site;
  const y0 = site.level;
  plan.flat(cx, cz, site.r, 26, y0);
  plan.pave(cx, cz, 13, 1);
  const n = 18;
  const RC = 16;
  const heights: number[] = [];
  for (let i = 0; i < n; i++) heights.push(r() < 0.45 ? 9 : range(r, 1.2, 7));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = cx + Math.cos(a) * RC;
    const z = cz + Math.sin(a) * RC;
    plan.disc(x, z, 1.0);
  }
  plan.disc(cx, cz, 2.6);
  plan.gates.push({ x: cx, y: y0 + 4.2, z: cz });
  plan.prop((b) => {
    const st = '#d4ccbb';
    b.cyl(cx, y0 - 0.8, cz, 14.5, 1.0, '#c6bfae', M.paving, 20);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = cx + Math.cos(a) * RC;
      const z = cz + Math.sin(a) * RC;
      const h = heights[i];
      b.box(x, y0, z, 1.9, 0.6, 1.9, -a, st, M.stone, r());
      b.cyl(x, y0 + 0.6, z, 0.72, h, st, M.stone, 12, r());
      if (h >= 9) {
        b.box(x, y0 + 0.6 + h, z, 1.8, 0.55, 1.8, -a, st, M.stone, r());
        const j = (i + 1) % n;
        if (heights[j] >= 9) {
          const a2 = (j / n) * TAU;
          const mx = (x + cx + Math.cos(a2) * RC) / 2;
          const mz = (z + cz + Math.sin(a2) * RC) / 2;
          b.box(mx, y0 + 1.15 + h, mz, RC * Math.sin(TAU / n / 2) * 2 + 1.6, 1.0, 1.4, -(a + a2) / 2 - Math.PI / 2, st, M.stone, r());
        }
      }
    }
    // Altar.
    b.box(cx, y0 - 0.5, cz, 4.4, 1.4, 4.4, 0.4, '#cfc8b8', M.stone);
    b.box(cx, y0 + 0.9, cz, 2.6, 1.0, 2.6, 0.4, '#e2dccd', M.stone);
    b.box(cx, y0 + 1.86, cz, 2.2, 0.12, 2.2, 0.4, '#8fe8ff', M.rune, 0.3);
    // Fallen drums and blocks.
    for (let k = 0; k < 9; k++) {
      const a = r() * TAU;
      const d = range(r, 18, 30);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const y = terrainHeight(x, z);
      if (k % 2) b.cyl(x, y - 0.2, z, 0.72, range(r, 1.4, 3), st, M.stone, 12, r(), lean(r() * TAU, Math.PI / 2));
      else b.box(x, y - 0.3, z, range(r, 1.2, 2.5), range(r, 0.6, 1.2), range(r, 1, 2), r() * TAU, st, M.stone, r(), lean(r() * TAU, range(r, 0, 0.3)));
    }
  });
  // The broken watchtower.
  const { x: tx, z: tz } = watchtower(site);
  plan.disc(tx, tz, 5.6);
  plan.prop((b) => {
    const y = Math.min(terrainHeight(tx, tz), y0);
    b.cyl(tx, y - 3, tz, 5.2, 24, '#c8c0ae', M.stone, 20, 0.2);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      b.box(tx + Math.cos(a) * 4.8, y + 21, tz + Math.sin(a) * 4.8, 2.2, range(r, 0.5, 4), 1.2, -a + Math.PI / 2, '#c8c0ae', M.stone, r());
    }
    for (let k = 1; k < 5; k++) {
      const a = k * 1.7;
      b.box(tx + Math.cos(a) * 5.22, y + k * 4.4, tz + Math.sin(a) * 5.22, 0.8, 1.6, 0.14, -a + Math.PI / 2, '#1c2230', M.window, 0.05);
    }
  }, 'far');
}

/** Where the ruins' broken watchtower stands, and the height of its flat top (once the realm is baked). */
export function watchtower(site: Site): { x: number; z: number; top: () => number } {
  const ta = 2.2;
  const x = site.x + Math.cos(ta) * 27;
  const z = site.z + Math.sin(ta) * 27;
  return { x, z, top: () => Math.min(terrainHeight(x, z), site.level) - 3 + 24 };
}

/** A field of giant crystals pushing out of the ground. */
export function planCrystals(plan: Plan, site: Site): void {
  const r = mulberry32(0xc257);
  const { x: cx, z: cz, r: R } = site;
  const cols = ['#7fd8ff', '#9ab8ff', '#b49cff', '#8ff0e8', '#c8e8ff'];
  for (let c = 0; c < 34; c++) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * R;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const big = c < 6 ? 2.2 : 1;
    const k = 2 + Math.floor(r() * 5);
    plan.disc(x, z, 1.6 * big);
    const col = pick(r, cols);
    const parts: { dx: number; dz: number; h: number; w: number; dir: number; tilt: number; rnd: number }[] = [];
    for (let i = 0; i < k; i++) {
      parts.push({
        dx: range(r, -1, 1) * big,
        dz: range(r, -1, 1) * big,
        h: range(r, 3, 9) * big * (i === 0 ? 1.4 : 1),
        w: range(r, 0.6, 1.3) * big * (i === 0 ? 1.3 : 1),
        dir: r() * TAU,
        tilt: i === 0 ? range(r, 0, 0.2) : range(r, 0.2, 0.7),
        rnd: r(),
      });
    }
    plan.prop((b) => {
      const y = terrainHeight(x, z);
      for (const p of parts) {
        b.crystal(x + p.dx, y - 0.2, z + p.dz, p.w, p.h, p.dir, col, p.rnd, lean(p.dir, p.tilt));
      }
      b.blob(x, y - 0.4, z, 1.8 * big, 0.9, 1.6 * big, r() * TAU, '#8a8f98', M.rock, r());
    }, c < 6 ? 'far' : 'town');
  }
}

/** The last watchtower where the road gives out under the mountains. */
export function planWatch(plan: Plan, site: Site): void {
  const r = mulberry32(0x77a7c4);
  const { x, z } = site;
  const y0 = site.level;
  plan.flat(x, z, site.r, 24, y0);
  plan.pave(x, z, 9, 1);
  plan.disc(x, z, 5.4);
  plan.prop((b) => {
    roundTower(b, r, x, y0, z, 5, 26, '#3a5578', '#cfc6b4', { crenel: true });
    b.box(x + 5.3, y0, z, 1.4, 2.4, 1.8, 0, '#4a3426', M.wood);
    b.cyl(x, y0 + 27.4, z, 0.08, 4.5, '#3a3a40', M.metal, 8);
    b.box(x + 1.0, y0 + 30.4, z, 2, 1.1, 0.05, 0, '#2f5fa8', M.cloth, 0.3);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.6;
      const lx = x + Math.cos(a) * 8.5;
      const lz = z + Math.sin(a) * 8.5;
      lamp(b, lx, y0, lz, a);
      plan.lamps.push({ x: lx, y: y0 + 3.6, z: lz });
    }
  }, 'far');
}
