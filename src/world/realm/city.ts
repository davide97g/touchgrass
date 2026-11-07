import { M } from './geom';
import { banner, CLOTH, Frame, house, lamp, PLASTER, ROOF_CITY, roundTower, STONE } from './kit';
import { mulberry32, pick, range } from './rand';
import type { Plan, Pt, Site } from './Realm';

const TAU = Math.PI * 2;

function angDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * The starting city: a ring wall with round towers and gatehouses, a paved plaza with the
 * gate of light at its heart, a bell tower, ring and radial streets lined with tall houses.
 * `gateAngles` are the directions the outside roads arrive from.
 */
export function planCity(plan: Plan, site: Site, gateAngles: number[]): { gates: Pt[] } {
  const r = mulberry32(0xc17e);
  const { x: cx, z: cz } = site;
  const R = site.r;
  const y0 = site.level;
  plan.flat(cx, cz, R + 8, 46, y0);

  const PLAZA = 24;
  const RINGS = [46, 84];
  const STREET = 2.5;

  // Radial streets: every gate, plus a few more so no block is too long.
  const radials = [...gateAngles];
  const extra = [0.5, 1.6, 2.7, 3.8, 4.9, 6.0];
  for (const a of extra) {
    if (radials.every((g) => Math.abs(angDiff(a, g)) > 0.55)) radials.push(a);
  }

  // ---- ground: plaza, streets ----
  plan.pave(cx, cz, PLAZA, 1);
  for (const rr of RINGS) {
    const pts: Pt[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * TAU;
      pts.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr });
    }
    plan.road(pts, STREET, 1);
  }
  for (const a of radials) {
    const isGate = gateAngles.some((g) => Math.abs(angDiff(a, g)) < 0.01);
    const end = isGate ? R + 10 : RINGS[1];
    const pts: Pt[] = [];
    for (let d = PLAZA - 2; d <= end; d += 4) pts.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d });
    plan.road(pts, isGate ? 3.0 : STREET, 1);
  }

  const gatePts: Pt[] = gateAngles.map((a) => ({ x: cx + Math.cos(a) * (R + 9), z: cz + Math.sin(a) * (R + 9) }));

  // ---- the gate of light ----
  plan.disc(cx, cz, 7.2);
  plan.gates.push({ x: cx, y: y0, z: cz });
  plan.prop((b) => {
    const st = '#d9d3c4';
    b.cyl(cx, y0 - 1, cz, 7.5, 1.35, st, M.paving, 20);
    b.cyl(cx, y0 + 0.35, cz, 6.2, 0.4, '#e6e0d2', M.stone, 20);
    b.cyl(cx, y0 + 0.75, cz, 5.0, 0.4, '#efe9dc', M.stone, 20);
    // Eight slender obelisks around the dais.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      const px = cx + Math.cos(a) * 6.6;
      const pz = cz + Math.sin(a) * 6.6;
      b.box(px, y0 + 0.35, pz, 0.7, 4.2, 0.7, -a, st, M.stone, r());
      b.pyramid(px, y0 + 4.55, pz, 0.7, 0.9, 0.7, -a, st, M.stone);
      b.box(px, y0 + 3.2, pz, 0.74, 0.25, 0.74, -a, '#8fe8ff', M.rune, i / 8);
    }
    // Two great arcs crossing over the dais.
    for (const rot of [0.3, 0.3 + Math.PI / 2]) {
      b.ring(cx, y0 + 1.15, cz, 4.6, 5, rot, 0, '#e8e2d4', M.stone, r());
    }
  });

  // ---- bell tower and hall on the plaza's north side ----
  const towerA = pickFree(-Math.PI / 2 - 0.25, radials, 0.32);
  const tx = cx + Math.cos(towerA) * (PLAZA + 6);
  const tz = cz + Math.sin(towerA) * (PLAZA + 6);
  const hallFrame = new Frame(cx + Math.cos(towerA) * (PLAZA + 13), y0, cz + Math.sin(towerA) * (PLAZA + 13), -towerA - Math.PI / 2);
  plan.rect(tx, tz, 9.5, 9.5, -towerA - Math.PI / 2);
  plan.bell = { x: tx, y: y0 + 26, z: tz };
  plan.rect(hallFrame.x, hallFrame.z, 20, 12, hallFrame.rot);
  plan.prop((b) => {
    const st = '#e2dccd';
    const rot = -towerA - Math.PI / 2;
    b.box(tx, y0 - 2, tz, 9, 4, 9, rot, '#c8c0ae', M.stone);
    b.box(tx, y0, tz, 8, 30, 8, rot, st, M.stone, 0.3);
    // Belfry: open arches suggested by dark panels, a gallery, then the spire.
    const f = new Frame(tx, y0, tz, rot);
    for (const [u, v, w, d] of [[0, 4.05, 2.4, 0.1], [0, -4.05, 2.4, 0.1], [4.05, 0, 0.1, 2.4], [-4.05, 0, 0.1, 2.4]] as const) {
      b.box(f.wx(u, v), y0 + 24, f.wz(u, v), w, 4.5, d, rot, '#1c2230', M.window, 0.9);
      b.box(f.wx(u, v), y0 + 12, f.wz(u, v), w * 0.5 + 0.05, 3, d, rot, '#2a3446', M.window, 0.6);
    }
    // Clock faces.
    for (const [u, v, w, d] of [[0, 4.06, 3.2, 0.12], [0, -4.06, 3.2, 0.12], [4.06, 0, 0.12, 3.2], [-4.06, 0, 0.12, 3.2]] as const) {
      b.box(f.wx(u, v), y0 + 16.6, f.wz(u, v), w, 3.2, d, rot, '#f4ecd0', M.lamp, 0.95);
    }
    b.box(tx, y0 + 30, tz, 9.2, 0.8, 9.2, rot, '#cfc8b8', M.stone);
    b.box(tx, y0 + 30.8, tz, 6.6, 4, 6.6, rot, st, M.stone);
    b.pyramid(tx, y0 + 34.8, tz, 7.6, 14, 7.6, rot, '#3a5578', M.roof, 0.2);
    b.cyl(tx, y0 + 48.6, tz, 0.08, 3.5, '#c8a24a', M.metal, 8);
    for (const [u, v] of [[3.6, 3.6], [-3.6, 3.6], [3.6, -3.6], [-3.6, -3.6]]) {
      b.cone(f.wx(u, v), y0 + 30.8, f.wz(u, v), 0.9, 5, '#3a5578', M.roof, 8);
    }
    // The hall: tall, buttressed, with a long steep roof.
    const h = hallFrame;
    b.box(h.x, y0 - 2, h.z, 20.6, 2.2, 12.6, h.rot, '#c8c0ae', M.stone);
    b.box(h.x, y0, h.z, 20, 11, 12, h.rot, st, M.stone, 0.5);
    for (let i = -3; i <= 3; i++) {
      for (const s of [-1, 1]) {
        const u = i * 2.8;
        b.box(h.wx(u, s * 6.4), y0, h.wz(u, s * 6.4), 0.9, 9, 1.0, h.rot, '#d2cab8', M.stone);
        if (i < 3) b.box(h.wx(u + 1.4, s * 6.02), y0 + 3.5, h.wz(u + 1.4, s * 6.02), 1.1, 5.5, 0.1, h.rot, '#2a3446', M.window, r());
      }
    }
    b.gable(h.x, y0 + 11, h.z, 21, 8.5, 13, h.rot, '#36506b', M.roof, 0.4);
    b.prism(h.x, y0 + 11, h.z, 19.96, 8.0, 11.96, h.rot, st, M.stone);
    // Rose window on the far gable.
    b.box(h.wx(10.04, 0), y0 + 12, h.wz(10.04, 0), 0.1, 3.4, 3.4, h.rot, '#7fb6ff', M.window, 0.97);
  });

  // ---- market stalls around the plaza ----
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.13;
    if (radials.some((g) => Math.abs(angDiff(a, g)) < 0.22) || Math.abs(angDiff(a, towerA)) < 0.45) continue;
    const d = PLAZA - 6.5;
    const sx = cx + Math.cos(a) * d;
    const sz = cz + Math.sin(a) * d;
    const rot = -a - Math.PI / 2;
    plan.rect(sx, sz, 3.4, 2.4, rot);
    const cloth = pick(r, CLOTH);
    const goods = pick(r, ['#d0503a', '#e8b040', '#7ab040', '#c06a9a', '#e0d8c0']);
    plan.prop((b) => {
      const f = new Frame(sx, y0, sz, rot);
      for (const [u, v] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) b.cyl(f.wx(u, v), y0, f.wz(u, v), 0.07, 2.5, '#5a4232', M.wood, 8);
      b.box(sx, y0, sz, 3.2, 0.95, 1.6, rot, '#6a4a32', M.wood);
      b.box(sx, y0 + 0.95, sz, 3.0, 0.25, 1.4, rot, goods, M.foliage, r());
      b.gable(sx, y0 + 2.45, sz, 3.6, 0.9, 2.6, rot, cloth, M.cloth, r());
    });
  }

  // ---- houses in rings between the streets ----
  const rows: { r0: number; r1: number; face: 1 | -1 }[] = [
    { r0: PLAZA + 3.5, r1: RINGS[0] - STREET - 1.2, face: 1 },
    { r0: RINGS[0] + STREET + 1.2, r1: 64, face: 1 },
    { r0: 66.5, r1: RINGS[1] - STREET - 1.2, face: -1 },
    { r0: RINGS[1] + STREET + 1.2, r1: 103, face: 1 },
  ];
  const towerBlock = (a: number, rr: number) => rr < RINGS[0] && Math.abs(angDiff(a, towerA)) < 0.62;
  let houses = 0;
  for (const row of rows) {
    const depthMax = row.r1 - row.r0;
    const rc = (row.r0 + row.r1) / 2;
    let a = r() * 0.3;
    while (a < TAU) {
      const w = range(r, 6, 9.5);
      const da = (w + 0.5) / rc;
      const mid = a + da / 2;
      const clear = radials.every((g) => Math.abs(angDiff(mid, g)) * row.r0 > STREET + 1.4 + w / 2);
      if (clear && !towerBlock(mid, rc) && r() > 0.06) {
        const d = Math.min(depthMax, range(r, 7, 11));
        // Hug the street the house faces.
        const rr = row.face > 0 ? row.r0 + d / 2 : row.r1 - d / 2;
        const hx = cx + Math.cos(mid) * rr;
        const hz = cz + Math.sin(mid) * rr;
        const rot = -mid - Math.PI / 2;
        // Local +Z points at the centre; face 1 = door toward the centre.
        const front: 1 | -1 = row.face > 0 ? 1 : -1;
        const floors = rc < 70 ? (r() < 0.6 ? 3 : 2) : r() < 0.35 ? 3 : 2;
        const style = r() < 0.45 ? 'timber' : r() < 0.6 ? 'city' : 'stone';
        const roof = pick(r, ROOF_CITY);
        const cross = r() < 0.3;
        const seed = r();
        plan.rect(hx, hz, w + 0.6, d + 0.6, rot);
        plan.prop((b) => {
          house(b, mulberry32(Math.floor(seed * 1e9)), new Frame(hx, y0, hz, rot), { w: w - 0.3, d, floors, front, style, roof, cross, onChimney: (x, y, z) => seed < 0.3 && plan.smokes.push({ x, y, z, s: 1 }) });
        });
        houses++;
      }
      a += da;
    }
  }

  // ---- gardens and trees in the outer strip against the wall ----
  for (let i = 0; i < 46; i++) {
    const a = r() * TAU;
    if (radials.some((g) => Math.abs(angDiff(a, g)) < 0.08)) continue;
    const rr = range(r, 106, R - 5);
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const s = range(r, 0.8, 1.25);
    plan.disc(x, z, 0.5);
    plan.treeSpots.push({ x, z, s: s * 0.75, kind: r() < 0.6 ? 1 : 2 });
  }

  // ---- street lamps ----
  for (const rr of RINGS) {
    const n = Math.round((TAU * rr) / 16);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      if (radials.some((g) => Math.abs(angDiff(a, g)) * rr < 4.5)) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const lr = rr + side * (STREET + 0.5);
      const x = cx + Math.cos(a) * lr;
      const z = cz + Math.sin(a) * lr;
      plan.lamps.push({ x, y: y0 + 3.6, z });
      plan.disc(x, z, 0.3);
      plan.prop((b) => lamp(b, x, y0, z, -a));
    }
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const x = cx + Math.cos(a) * (PLAZA - 1.2);
    const z = cz + Math.sin(a) * (PLAZA - 1.2);
    plan.lamps.push({ x, y: y0 + 3.6, z });
    plan.prop((b) => lamp(b, x, y0, z, -a));
  }

  // ---- the wall ----
  const towers = 16;
  const gateHalf = 7.5 / R;
  const towerAngles: number[] = [];
  for (let i = 0; i < towers; i++) {
    const a = (i / towers) * TAU + 0.11;
    if (gateAngles.some((g) => Math.abs(angDiff(a, g)) < gateHalf + 0.14)) continue;
    towerAngles.push(a);
  }
  const wallH = 9;
  const wallT = 2.6;
  const segs = 120;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU;
    const a1 = ((i + 1) / segs) * TAU;
    const mid = (a0 + a1) / 2;
    if (gateAngles.some((g) => Math.abs(angDiff(mid, g)) < gateHalf)) continue;
    const len = 2 * R * Math.sin((a1 - a0) / 2) + 0.15;
    const x = cx + Math.cos(mid) * R;
    const z = cz + Math.sin(mid) * R;
    const rot = -mid - Math.PI / 2;
    plan.rect(x, z, len, wallT + 0.4, rot);
    const stone = pick(r, STONE);
    plan.prop((b) => {
      const f = new Frame(x, y0, z, rot);
      b.box(x, y0 - 3, z, len, wallH + 3, wallT, rot, stone, M.stone, r());
      b.box(f.wx(0, -wallT / 2 + 0.2), y0 + wallH, f.wz(0, -wallT / 2 + 0.2), len * 0.5, 1.1, 0.5, rot, stone, M.stone, r());
      b.box(f.wx(0, wallT / 2 - 0.2), y0 + wallH, f.wz(0, wallT / 2 - 0.2), len * 0.45, 0.9, 0.4, rot, stone, M.stone, r());
    });
  }
  for (const a of towerAngles) {
    const x = cx + Math.cos(a) * R;
    const z = cz + Math.sin(a) * R;
    plan.disc(x, z, 4.6);
    const flag = pick(r, ['#2f5fa8', '#e8e0cc', '#2f5fa8']);
    plan.prop((b) => {
      const top = roundTower(b, r, x, y0, z, 4.3, 15, '#3a5578');
      void top;
      banner(b, x + Math.cos(a) * 4.9, y0 + 9, z + Math.sin(a) * 4.9, -a, flag, 1.6);
    }, 'far');
  }
  // Gatehouses: twin towers and a vaulted passage you can walk through.
  for (const g of gateAngles) {
    const rot = -g - Math.PI / 2;
    const f = new Frame(cx + Math.cos(g) * R, y0, cz + Math.sin(g) * R, rot);
    for (const s of [-1, 1]) {
      const x = f.wx(s * 6.4, 0);
      const z = f.wz(s * 6.4, 0);
      plan.disc(x, z, 4.4);
      plan.prop((b) => {
        roundTower(b, r, x, y0, z, 4.0, 18, '#3a5578', '#d6cebd');
      }, 'far');
    }
    plan.prop((b) => {
      b.box(f.x, y0 + 7.2, f.z, 9.4, 6, 4.2, rot, '#d6cebd', M.stone, r());
      b.box(f.x, y0 + 13.2, f.z, 9.8, 0.6, 4.6, rot, '#cfc8b8', M.stone);
      b.gable(f.x, y0 + 13.8, f.z, 10, 3.6, 5.2, rot, '#3a5578', M.roof);
      b.prism(f.x, y0 + 13.8, f.z, 9.6, 3.3, 4.6, rot, '#d6cebd', M.stone);
      // Portcullis glimpse and lanterns either side.
      b.box(f.wx(0, -2.15), y0 + 6.6, f.wz(0, -2.15), 5.2, 0.7, 0.2, rot, '#2e2f36', M.metal);
      for (const s of [-1, 1]) {
        b.box(f.wx(s * 3.0, -2.4), y0 + 4.4, f.wz(s * 3.0, -2.4), 0.4, 0.55, 0.4, rot, '#ffd590', M.lamp, 0.5);
        banner(b, f.wx(s * 2.4, -2.5), y0 + 9, f.wz(s * 2.4, -2.5), rot + Math.PI / 2, '#2f5fa8', 1.2);
      }
    });
    plan.lamps.push({ x: f.wx(-3, -2.4), y: y0 + 4.6, z: f.wz(-3, -2.4) }, { x: f.wx(3, -2.4), y: y0 + 4.6, z: f.wz(3, -2.4) });
  }

  // A couple of wells and statues for the squares where rings meet radials.
  for (const a of radials.slice(0, 4)) {
    const x = cx + Math.cos(a + 0.12) * (RINGS[0] + 6.5);
    const z = cz + Math.sin(a + 0.12) * (RINGS[0] + 6.5);
    void x;
    void z;
  }
  plan.flocks.push({ x: cx, z: cz, r: R - 12, kind: 'cat', n: 9 });
  void houses;
  void PLASTER;
  return { gates: gatePts };
}

/** Nearest angle to `want` that keeps `gap` radians from every radial street. */
function pickFree(want: number, radials: number[], gap: number): number {
  for (let k = 0; k < 40; k++) {
    for (const s of [1, -1]) {
      const a = want + s * k * 0.04;
      if (radials.every((g) => Math.abs(angDiff(a, g)) > gap)) return a;
    }
  }
  return want;
}
