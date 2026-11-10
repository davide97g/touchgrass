import { Quaternion, Vector3 } from 'three';
import { terrainHeight } from '../common';
import { lean, M, type Builder } from './geom';
import { Frame, house, lamp, ROOF_VILLAGE, STONE } from './kit';
import { mulberry32, pick, range, type Rng } from './rand';
import type { Plan, Pt, RealmMap, Site } from './Realm';

const TAU = Math.PI * 2;

/** Logs, a ring of stones and a flame (its glow, flicker and smoke come from Ambient). */
export function campfire(plan: Plan, x: number, z: number): void {
  plan.disc(x, z, 1.1);
  plan.prop((b) => {
    const y = terrainHeight(x, z);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      b.blob(x + Math.cos(a) * 0.9, y + 0.05, z + Math.sin(a) * 0.9, 0.24, 0.18, 0.22, a, '#8a8680', M.rock, i / 9);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      b.cyl(x + Math.cos(a) * 0.25, y + 0.05, z + Math.sin(a) * 0.25, 0.09, 0.9, '#4a3426', M.wood, 8, 0.5, lean(a + Math.PI, 1.1));
    }
    b.gem(x, y + 0.35, z, 0.28, 0.55, 0.28, 0, '#ff9a3a', M.lamp, 0.9);
    b.gem(x + 0.12, y + 0.25, z - 0.1, 0.18, 0.4, 0.18, 0.7, '#ffcf6a', M.lamp, 0.9);
    plan.fires.push({ x, y: y + 0.5, z });
    plan.smokes.push({ x, y: y + 1.2, z, s: 1.4 });
  });
}

/** Stone lantern with a glowing light box. */
export function stoneLantern(plan: Plan, b: Builder, x: number, y: number, z: number, rot: number): void {
  b.box(x, y - 0.3, z, 0.7, 0.5, 0.7, rot, '#bdb5a3', M.stone);
  b.cyl(x, y + 0.2, z, 0.16, 0.9, '#c9bfa8', M.stone, 8);
  b.box(x, y + 1.1, z, 0.55, 0.45, 0.55, rot, '#ffd590', M.lamp, 0.4);
  b.pyramid(x, y + 1.55, z, 0.95, 0.45, 0.95, rot, '#9a9284', M.stone);
  plan.lamps.push({ x, y: y + 1.3, z });
}

/** Fields of wheat, greens or lavender laid out on free ground around a centre. */
export function fieldsAround(plan: Plan, map: RealmMap, r: Rng, cx: number, cz: number, r0: number, r1: number, n: number, avoid: Site[]): void {
  let placed = 0;
  for (let t = 0; t < n * 12 && placed < n; t++) {
    const a = r() * TAU;
    const d = range(r, r0, r1);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const w = range(r, 22, 40);
    const dd = range(r, 30, 60);
    const rot = r() < 0.5 ? 0 : Math.PI / 2;
    const hw = (rot ? dd : w) / 2;
    const hd = (rot ? w : dd) / 2;
    const corners: Pt[] = [{ x: x - hw, z: z - hd }, { x: x + hw, z: z - hd }, { x: x - hw, z: z + hd }, { x: x + hw, z: z + hd }, { x, z }];
    if (corners.some((c) => map.roadDist(c.x, c.z) < 4)) continue;
    if (Math.min(map.roadDist(x - hw * 0.5, z), map.roadDist(x + hw * 0.5, z), map.roadDist(x, z - hd * 0.5), map.roadDist(x, z + hd * 0.5)) < 4) continue;
    if (avoid.some((s) => corners.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < s.r + 6))) continue;
    if (plan.fields.some((f) => Math.abs(f.x - x) < (f.w + w) / 2 + 4 && Math.abs(f.z - z) < (f.d + dd) / 2 + 4)) continue;
    if (Math.abs(map.groundNow(x - hw, z) - map.groundNow(x + hw, z)) > 6 || Math.abs(map.groundNow(x, z - hd) - map.groundNow(x, z + hd)) > 6) continue;
    const crop = r() < 0.55 ? 2 : r() < 0.7 ? 3 : 4;
    plan.field(x, z, w, dd, rot, crop);
    placed++;
    if (r() < 0.4) {
      // A scarecrow keeps watch.
      const sx = x + range(r, -hw, hw) * 0.5;
      const sz = z + range(r, -hd, hd) * 0.5;
      const coat = pick(r, ['#7a3b2e', '#3f5a7a', '#6a5a3a']);
      plan.prop((b) => {
        const y = terrainHeight(sx, sz);
        const ry = r() * TAU;
        b.cyl(sx, y - 0.4, sz, 0.07, 2.6, '#6a5038', M.wood, 8);
        b.box(sx, y + 1.55, sz, 1.8, 0.08, 0.08, ry, '#6a5038', M.wood);
        b.box(sx, y + 1.0, sz, 0.55, 0.85, 0.32, ry, coat, M.cloth, 0.5);
        b.blob(sx, y + 2.05, sz, 0.22, 0.24, 0.22, 0, '#d8c08a', M.cloth, 0.5);
        b.cone(sx, y + 2.18, sz, 0.42, 0.42, '#c8a050', M.foliage, 8);
      });
    }
  }
}

/** A farmstead by the road: house, barn, hay, a yard of hens, fields behind. */
export function planFarm(plan: Plan, map: RealmMap, x: number, z: number, faceRot: number, seed: number, avoid: Site[]): void {
  const r = mulberry32(seed);
  const y0 = map.groundNow(x, z);
  plan.flat(x, z, 13, 14, y0);
  const f = new Frame(x, y0, z, faceRot);
  const hx = f.wx(-6, 2);
  const hz = f.wz(-6, 2);
  plan.rect(hx, hz, 8.6, 7.4, faceRot);
  const bx = f.wx(7, -1);
  const bz = f.wz(7, -1);
  plan.rect(bx, bz, 9.6, 13.6, faceRot);
  const roof = pick(r, ROOF_VILLAGE);
  const barn = pick(r, ['#8a3a2a', '#7a4a32', '#6a3a2a']);
  const s2 = r();
  plan.prop((b) => {
    house(b, mulberry32(Math.floor(s2 * 1e9)), new Frame(hx, y0, hz, faceRot), {
      w: 8,
      d: 6.8,
      floors: r() < 0.5 ? 2 : 1,
      front: 1,
      style: 'cottage',
      roof,
      onChimney: (cx, cy, cz) => plan.smokes.push({ x: cx, y: cy, z: cz, s: 1 }),
    });
    const bf = new Frame(bx, y0, bz, faceRot);
    b.box(bx, y0 - 1.2, bz, 9.2, 6.6, 13.2, faceRot, barn, M.wood, r());
    b.gable(bx, y0 + 5.4, bz, 13.8, 4.6, 10, faceRot + Math.PI / 2, '#4a3a32', M.roof, r());
    b.prism(bx, y0 + 5.4, bz, 13.2, 4.2, 9.2, faceRot + Math.PI / 2, barn, M.wood, r());
    b.box(bf.wx(0, 6.65), y0, bf.wz(0, 6.65), 3.6, 4, 0.12, faceRot, '#3a2a22', M.wood);
    for (const s of [-1, 1]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), s * 0.85);
      b.box(bf.wx(s * 0.9, 6.72), y0 + 0.3, bf.wz(s * 0.9, 6.72), 0.16, 4.4, 0.06, faceRot, '#e8e0cc', M.wood, 0.5, q);
    }
    // Hay bales and a cart.
    for (let i = 0; i < 4; i++) {
      const u = range(r, -10, 10);
      const v = range(r, -10, -6);
      b.cyl(f.wx(u, v), y0 + 0.6, f.wz(u, v), 0.7, 1.2, '#d8b860', M.foliage, 12, 0.9, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
    }
    const cu = 1.5;
    const cv = 7;
    b.box(f.wx(cu, cv), y0 + 0.7, f.wz(cu, cv), 2.2, 0.5, 1.4, faceRot + 0.3, '#6a4a32', M.wood);
    for (const s of [-1, 1]) {
      b.ring(f.wx(cu, cv + s * 0.78), y0 + 0.62, f.wz(cu, cv + s * 0.78), 0.55, 4, faceRot + 0.3, 0, '#3a2a22', M.wood);
    }
  });
  plan.flocks.push({ x: f.wx(0, -3), z: f.wz(0, -3), r: 9, kind: 'chicken', n: 5 + Math.floor(r() * 4) });
  // The yard's fence.
  const R = 15;
  for (let i = 0; i < 26; i++) {
    const a0 = (i / 26) * TAU;
    const a1 = ((i + 1) / 26) * TAU;
    const ga = Math.atan2(Math.cos(faceRot), -Math.sin(faceRot)); // the road side stays open
    let dga = Math.abs(((a0 + 0.12 - ga) % TAU + TAU) % TAU);
    dga = Math.min(dga, TAU - dga);
    if (dga < 0.5) continue;
    const x0 = x + Math.cos(a0) * R;
    const z0 = z + Math.sin(a0) * R;
    const x1 = x + Math.cos(a1) * R;
    const z1 = z + Math.sin(a1) * R;
    plan.prop((b) => fenceSpan(b, x0, z0, x1, z1));
  }
  fieldsAround(plan, map, r, x, z, 40, 80, 3, avoid);
}

export function fenceSpan(b: Builder, x0: number, z0: number, x1: number, z1: number): void {
  const y0p = terrainHeight(x0, z0);
  const y1p = terrainHeight(x1, z1);
  b.box(x0, y0p - 0.4, z0, 0.15, 1.6, 0.15, 0, '#6a5038', M.wood);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const rot = Math.atan2(-(z1 - z0), x1 - x0);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.atan2(y1p - y0p, len));
  for (const hy of [0.5, 0.95]) b.box((x0 + x1) / 2, (y0p + y1p) / 2 + hy, (z0 + z1) / 2, len + 0.1, 0.08, 0.06, rot, '#7a5c40', M.wood, 0.5, q);
}

/** A grove of blossoming trees around a small shrine with a floating crystal. */
export function planGrove(plan: Plan, site: Site): void {
  const r = mulberry32(0x5a4c);
  const { x: cx, z: cz } = site;
  const y0 = site.level;
  plan.flat(cx, cz, 11, 16, y0);
  plan.pave(cx, cz, 7.5, 1);
  plan.disc(cx, cz, 4.4);
  plan.petals.push({ x: cx, z: cz, r: site.r + 10 });
  plan.gates.push({ x: cx, y: y0 + 2.6, z: cz });
  plan.prop((b) => {
    const st = '#d8d0bf';
    b.cyl(cx, y0 - 0.8, cz, 5.2, 1.1, '#c8c0ae', M.stone, 12);
    b.cyl(cx, y0 + 0.3, cz, 4.4, 0.35, st, M.stone, 12);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      b.cyl(cx + Math.cos(a) * 3.6, y0 + 0.65, cz + Math.sin(a) * 3.6, 0.3, 4.2, '#efe9dc', M.stone, 8);
    }
    b.cyl(cx, y0 + 4.85, cz, 4.6, 0.5, '#efe9dc', M.stone, 12);
    b.cone(cx, y0 + 5.35, cz, 5.8, 2.6, '#9a5a6a', M.roof, 12, 0.4);
    b.cone(cx, y0 + 7.6, cz, 0.6, 1.4, '#c8a24a', M.metal, 8);
    b.box(cx, y0 + 0.65, cz, 1.4, 1.2, 1.4, 0.3, '#e2dccd', M.stone);
  });
  // A paved path and lanterns.
  const pa = r() * TAU;
  for (let k = 1; k <= 5; k++) {
    const d = 6 + k * 5;
    for (const s of [-1, 1]) {
      const x = cx + Math.cos(pa) * d + Math.cos(pa + Math.PI / 2) * s * 2.6;
      const z = cz + Math.sin(pa) * d + Math.sin(pa + Math.PI / 2) * s * 2.6;
      plan.disc(x, z, 0.5);
      plan.prop((b) => stoneLantern(plan, b, x, terrainHeight(x, z), z, -pa));
    }
    plan.pave(cx + Math.cos(pa) * d, cz + Math.sin(pa) * d, 2.2, 1);
  }
  // Blossom trees.
  for (let i = 0; i < 46; i++) {
    const a = r() * TAU;
    const d = range(r, 10, site.r + 8);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (Math.abs(((a - pa) % TAU + TAU + Math.PI) % TAU - Math.PI) < 0.25) continue;
    if (plan.treeSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 5.5)) continue;
    plan.treeSpots.push({ x, z, s: range(r, 0.85, 1.35), kind: 4 });
  }
}

/** The labyrinth tower: a colossal pillar that climbs out of sight toward the sky. */
export function planPillar(plan: Plan, site: Site): void {
  const r = mulberry32(0x9111a);
  const { x: cx, z: cz } = site;
  const y0 = site.level;
  plan.flat(cx, cz, site.r, 40, y0);
  plan.pave(cx, cz, site.r - 4, 1);
  plan.disc(cx, cz, 33);
  const doorA = Math.atan2(-0.6, -0.8); // the door looks back toward the villages
  const dx = Math.cos(doorA);
  const dz = Math.sin(doorA);
  for (const s of [-1, 1]) {
    const fx = cx + dx * 40 + -dz * s * 7;
    const fz = cz + dz * 40 + dx * s * 7;
    plan.disc(fx, fz, 1.2);
    plan.prop((b) => {
      b.cyl(fx, y0 - 0.5, fz, 0.9, 1.6, '#8a8f98', M.stone, 8);
      b.frustum(fx, y0 + 1.1, fz, 0.6, 1.1, 0.7, '#3a3a40', M.metal, 8);
    }, 'far');
    plan.fires.push({ x: fx, y: y0 + 2.2, z: fz });
    plan.prop((b) => b.gem(fx, y0 + 1.7, fz, 0.6, 1.1, 0.6, 0, '#ff9a3a', M.lamp, 0.9), 'far');
  }
  plan.prop((b) => {
    const st = '#c8c4bc';
    // Stepped plinth.
    for (let k = 0; k < 4; k++) b.cyl(cx, y0 - 2 + k * 0.9, cz, 46 - k * 3.5, 1.4, k % 2 ? '#d2ccbe' : '#c4beb0', M.stone, 20, r());
    const N = 12;
    const H = 46;
    let y = y0 + 3.6;
    for (let k = 0; k < N; k++) {
      const R0 = 32 - k * 1.25;
      const R1 = 32 - (k + 1) * 1.25;
      b.frustum(cx, y, cz, R0, R1, H, k % 2 ? st : '#bcb8b0', M.hull, 20, r());
      // Ribs.
      const ribs = 10;
      for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * TAU + k * 0.05;
        b.box(cx + Math.cos(a) * (R0 - 0.2), y, cz + Math.sin(a) * (R0 - 0.2), 2.4, H, 2.6, -a, '#b0aca4', M.hull, r());
      }
      // A balcony ring and a band of runes.
      b.cyl(cx, y + H - 1.2, cz, R1 + 2.4, 1.2, '#b8b4ac', M.hull, 20, r());
      if (k % 2 === 0) b.cyl(cx, y + H * 0.5, cz, R0 - 0.35 + 0.25, 0.7, '#8fe8ff', M.rune, 20, k / N);
      y += H;
    }
    // Crown.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const R = 32 - N * 1.25;
      b.frustum(cx + Math.cos(a) * R, y, cz + Math.sin(a) * R, 2.2, 0.2, 30, '#b8b4ac', M.hull, 6, r());
    }
    b.gem(cx, y + 28, cz, 6, 16, 6, 0, '#9ff0ff', M.rune, 0.5);
    // The great door.
    const R = 32;
    const df = new Frame(cx + dx * (R - 0.6), y0 + 3.6, cz + dz * (R - 0.6), Math.atan2(dx, dz));
    // The door slab itself is drawn by Mysteries.ts (it opens); behind it, darkness.
    b.box(df.wx(0, -0.7), df.y, df.wz(0, -0.7), 9, 16, 0.4, df.rot, '#0a0c12', M.wood, 0.05);
    for (const s of [-1, 1]) b.box(df.wx(s * 5.6, 0), df.y - 0.5, df.wz(s * 5.6, 0), 2.4, 19, 3.4, df.rot, '#d8d4cc', M.stone, r());
    b.box(df.x, df.y + 16, df.z, 13.6, 3.2, 3.4, df.rot, '#d8d4cc', M.stone, r());
    b.box(df.x, df.y + 13.6, df.z, 9.2, 0.5, 1.8, df.rot, '#8fe8ff', M.rune, 0.3);
    // Stairs up the plinth.
    for (let k = 0; k < 5; k++) {
      const d = R + 14 - k * 2.2;
      b.box(cx + dx * d, y0 - 1 + k * 0.75, cz + dz * d, 14, 1, 2.6, Math.atan2(dx, dz), '#d2ccbe', M.stone);
    }
  }, 'far');
}

/** A ring of standing stones on a meadow, a rune stone glowing at its heart. */
export function planRing(plan: Plan, site: Site): void {
  const r = mulberry32(0x0721);
  const { x: cx, z: cz } = site;
  plan.flat(cx, cz, 12, 20, site.level);
  const y0 = site.level;
  const n = 14;
  const R = 15;
  const lintel: boolean[] = [];
  for (let i = 0; i < n; i++) lintel.push(i % 2 === 0 && r() < 0.7);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    plan.disc(cx + Math.cos(a) * R, cz + Math.sin(a) * R, 1.3);
  }
  plan.disc(cx, cz, 1.6);
  plan.gates.push({ x: cx, y: y0 + 3.2, z: cz });
  plan.prop((b) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = cx + Math.cos(a) * R;
      const z = cz + Math.sin(a) * R;
      const fallen = r() < 0.12;
      if (fallen) {
        b.box(x, y0 - 0.3, z, 4.8, 1.2, 1.9, r() * TAU, pick(r, STONE), M.stone, r());
        continue;
      }
      b.box(x, y0 - 0.8, z, 2.0, 6.2, 1.2, -a + Math.PI / 2, pick(r, STONE), M.stone, r(), lean(r() * TAU, range(r, 0, 0.06)));
      if (lintel[i]) {
        const a2 = ((i + 1) / n) * TAU;
        const x2 = cx + Math.cos(a2) * R;
        const z2 = cz + Math.sin(a2) * R;
        b.box((x + x2) / 2, y0 + 5.4, (z + z2) / 2, Math.hypot(x2 - x, z2 - z) + 2.2, 1.0, 1.3, Math.atan2(-(z2 - z), x2 - x), pick(r, STONE), M.stone, r());
      }
    }
    b.box(cx, y0 - 0.4, cz, 3.2, 1.2, 1.8, 0.4, '#bdb5a3', M.stone);
    b.box(cx, y0 + 0.82, cz, 2.6, 0.08, 1.2, 0.4, '#8fe8ff', M.rune, 0.6);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const x = cx + Math.cos(a) * 7;
      const z = cz + Math.sin(a) * 7;
      b.box(x, y0 - 0.4, z, 0.8, 2.2, 0.5, -a, '#c9bfa8', M.stone, r());
      b.box(x, y0 + 1.2, z, 0.82, 0.14, 0.52, -a, '#8fe8ff', M.rune, i / 4);
    }
  });
}

/** Wooden signpost with boards pointing along the roads that meet here. */
export function signpost(plan: Plan, x: number, z: number, dirs: number[]): void {
  plan.disc(x, z, 0.3);
  plan.prop((b) => {
    const y = terrainHeight(x, z);
    b.cyl(x, y - 0.4, z, 0.09, 3.0, '#6a5038', M.wood, 8);
    dirs.forEach((d, i) => {
      // Board along the direction, pushed out to one side of the post.
      const len = 1.3;
      const bx = x + Math.cos(d) * len * 0.45;
      const bz = z + Math.sin(d) * len * 0.45;
      const rot = -d;
      b.box(bx, y + 2.1 - i * 0.38, bz, len, 0.26, 0.06, rot, '#8a6a48', M.wood, 0.3 + i * 0.2);
      b.box(x + Math.cos(d) * len * 0.92, y + 2.1 - i * 0.38, z + Math.sin(d) * len * 0.92, 0.18, 0.18, 0.06, rot + Math.PI / 4, '#8a6a48', M.wood, 0.4);
    });
    b.pyramid(x, y + 2.6, z, 0.3, 0.25, 0.3, 0, '#4a3a2a', M.wood);
  });
}

export { lamp };
