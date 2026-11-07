import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  LinearMipmapLinearFilter,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { U } from '../../core/uniforms';
import { COMMON_GLSL } from '../common';

/**
 * Parametric trees in the style of the great tree: tapered, kinked tubes for trunk and
 * branches grown by species rules (taken from how the real trees are built), and a crown of
 * camera-facing leaf cards drawn from a hand-painted atlas. Each species ships a few variants
 * at two levels of detail.
 */

export type SpeciesName = 'oak' | 'spruce' | 'birch' | 'cherry' | 'bush';

export interface TreeLOD {
  bark: BufferGeometry;
  leaves: BufferGeometry;
}

export interface TreeVariant {
  near: TreeLOD;
  far: TreeLOD;
  height: number;
}

type Rng = () => number;

function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ bark tubes

class Tubes {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  /** Sweep rings along a polyline; radius per point; `flare` widens the base into roots. */
  add(pts: Vector3[], radii: number[], radial: number, flare = 0, uvLen0 = 0): void {
    const n = pts.length;
    const T: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      T.push(b.clone().sub(a).normalize());
    }
    let N = Math.abs(T[0].y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize();
    const base = this.pos.length / 3;
    let len = uvLen0;
    const circ0 = Math.PI * 2 * radii[0];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        N = N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))).normalize();
        len += pts[i].distanceTo(pts[i - 1]);
      }
      const B = new Vector3().crossVectors(T[i], N);
      for (let j = 0; j <= radial; j++) {
        const th = (j / radial) * Math.PI * 2;
        let r = radii[i];
        if (flare > 0 && i < 3) {
          const k = 1 - i / 3;
          r *= 1 + flare * k * k * (0.6 + 0.4 * Math.max(0, Math.sin(th * 5 + 1.3)) ** 2);
        }
        const c = Math.cos(th);
        const s = Math.sin(th);
        const nx = N.x * c + B.x * s;
        const ny = N.y * c + B.y * s;
        const nz = N.z * c + B.z * s;
        this.pos.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
        this.nor.push(nx, ny, nz);
        this.uv.push((j / radial) * Math.max(circ0, 0.3), len);
      }
    }
    const row = radial + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * row + j;
        const b = a + row;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('aBark', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

interface Card {
  p: Vector3;
  size: number;
  /** 0..1 how far out on the branch system (for wind and lighting). */
  reach: number;
}

function cardsGeometry(cards: Card[], center: Vector3, rxz: number, ry: number, r: Rng): BufferGeometry {
  const n = cards.length;
  const pos = new Float32Array(n * 4 * 3);
  const cen = new Float32Array(n * 4 * 3);
  const dir = new Float32Array(n * 4 * 3);
  const dat = new Float32Array(n * 4 * 4);
  const idx: number[] = [];
  const corners = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
  const d = new Vector3();
  cards.forEach((c, i) => {
    d.copy(c.p).sub(center);
    d.y *= rxz / Math.max(ry, 0.1);
    const out = Math.min(1, d.length() / Math.max(rxz, 0.1));
    d.normalize();
    const vert = (c.p.y - center.y) / Math.max(ry, 0.1);
    const ao = Math.min(1, Math.max(0, 0.12 + 0.55 * out + 0.4 * Math.min(1, Math.max(0, (vert + 1.1) / 1.8))));
    const rot = r() * Math.PI * 2;
    const seed = r();
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 3;
      pos[o] = corners[k * 2];
      pos[o + 1] = corners[k * 2 + 1];
      pos[o + 2] = 0;
      cen[o] = c.p.x;
      cen[o + 1] = c.p.y;
      cen[o + 2] = c.p.z;
      dir[o] = d.x;
      dir[o + 1] = d.y;
      dir[o + 2] = d.z;
      const q = (i * 4 + k) * 4;
      dat[q] = c.size;
      dat[q + 1] = rot;
      dat[q + 2] = ao;
      dat[q + 3] = seed + c.reach * 0.0001;
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new BufferAttribute(cen, 3));
  g.setAttribute('aDir', new BufferAttribute(dir, 3));
  g.setAttribute('aData', new BufferAttribute(dat, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ growth

interface Ctx {
  r: Rng;
  near: Tubes;
  far: Tubes;
  cards: Card[];
}

interface BranchRule {
  /** Children per branch at this depth. */
  kids: number;
  /** Where on the parent they start and end (0..1). */
  from: number;
  to: number;
  /** Angle away from the parent (radians). */
  angle: number;
  /** Length relative to the parent. */
  lenRatio: number;
  /** Upward (positive) or drooping (negative) pull per segment. */
  tropism: number;
  kink: number;
  segs: number;
  radial: number;
  /** Leaf cards per metre along the last part of the branch, and their size. */
  leaves: number;
  leafFrom: number;
  leafSize: number;
}

const GOLDEN = 2.39996;

function perpendicular(v: Vector3): Vector3 {
  const a = Math.abs(v.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  return new Vector3().crossVectors(v, a).normalize();
}

/** One branch and, recursively, its children. */
function grow(c: Ctx, p0: Vector3, d0: Vector3, len: number, r0: number, depth: number, rules: BranchRule[], reach: number, rollStart: number): void {
  const rule = rules[depth];
  const r = c.r;
  const pts: Vector3[] = [p0.clone()];
  const rad: number[] = [r0];
  const dir = d0.clone().normalize();
  const segs = rule.segs;
  const step = len / segs;
  for (let i = 1; i <= segs; i++) {
    dir.x += (r() - 0.5) * rule.kink;
    dir.y += (r() - 0.5) * rule.kink * 0.6 + rule.tropism;
    dir.z += (r() - 0.5) * rule.kink;
    dir.normalize();
    pts.push(pts[i - 1].clone().addScaledVector(dir, step));
    const t = i / segs;
    rad.push(Math.max(0.012, r0 * (1 - 0.82 * t)));
  }
  const flare = depth === 0 && d0.y > 0.8 ? 0.9 : 0;
  if (r0 > 0.02 || depth < 2) c.near.add(pts, rad, rule.radial, flare);
  if (depth <= 1 && r0 > 0.03) c.far.add(pts, rad.map((x) => x * 1.05), Math.max(4, Math.round(rule.radial * 0.6)), flare);

  const at = (t: number) => {
    const f = t * segs;
    const i = Math.min(segs - 1, Math.floor(f));
    return pts[i].clone().lerp(pts[i + 1], f - i);
  };
  const tangent = (t: number) => {
    const f = Math.min(segs - 1, Math.floor(t * segs));
    return pts[f + 1].clone().sub(pts[f]).normalize();
  };

  // Leaves along the outer part.
  if (rule.leaves > 0) {
    const L = len * (1 - rule.leafFrom);
    const n = Math.max(1, Math.round(L * rule.leaves));
    for (let i = 0; i < n; i++) {
      const t = rule.leafFrom + (1 - rule.leafFrom) * ((i + r()) / n);
      const p = at(Math.min(1, t));
      const off = perpendicular(tangent(Math.min(0.99, t))).applyAxisAngle(tangent(Math.min(0.99, t)), r() * Math.PI * 2);
      p.addScaledVector(off, rule.leafSize * (0.1 + r() * 0.3));
      c.cards.push({ p, size: rule.leafSize * (0.75 + r() * 0.5), reach: Math.min(1, reach + t * 0.3) });
    }
    // A cluster at the tip.
    const tip = pts[segs];
    c.cards.push({ p: tip.clone().addScaledVector(dir, rule.leafSize * 0.2), size: rule.leafSize * 1.1, reach: 1 });
  }

  if (depth + 1 >= rules.length) return;
  const kid = rules[depth + 1];
  const n = rule.kids;
  let roll = rollStart;
  for (let k = 0; k < n; k++) {
    const t = kid === rules[depth + 1] ? rule.from + (rule.to - rule.from) * ((k + 0.3 + r() * 0.4) / n) : 0;
    const p = at(t);
    const tan = tangent(Math.min(0.99, t));
    roll += GOLDEN + (r() - 0.5) * 0.5;
    const side = perpendicular(tan).applyAxisAngle(tan, roll);
    const a = rule.angle * (0.8 + r() * 0.4);
    const cd = tan.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
    const cl = len * rule.lenRatio * (1 - 0.45 * t) * (0.8 + r() * 0.4);
    const cr = rad[Math.min(segs, Math.round(t * segs))] * 0.72;
    grow(c, p, cd, cl, cr, depth + 1, rules, reach + 0.3, r() * 6);
  }
}

// ------------------------------------------------------------------ species

function finish(c: Ctx, r: Rng, height: number, farEvery = 5): TreeVariant {
  const center = new Vector3();
  for (const k of c.cards) center.add(k.p);
  center.divideScalar(Math.max(1, c.cards.length));
  let rxz = 0.5;
  let ry = 0.5;
  for (const k of c.cards) {
    rxz = Math.max(rxz, Math.hypot(k.p.x - center.x, k.p.z - center.z));
    ry = Math.max(ry, Math.abs(k.p.y - center.y));
  }
  // Far cards: one in five, bigger, so the crown keeps its mass.
  const farCards: Card[] = [];
  c.cards.forEach((k, i) => {
    if (i % farEvery === 0) farCards.push({ p: k.p, size: k.size * Math.sqrt(farEvery) * 0.95, reach: k.reach });
  });
  return {
    near: { bark: c.near.build(), leaves: cardsGeometry(c.cards, center, rxz, ry, r) },
    far: { bark: c.far.build(), leaves: cardsGeometry(farCards, center, rxz, ry, r) },
    height,
  };
}

/** Pedunculate oak: short, massive trunk; a few great sinuous limbs; a broad, lumpy dome. */
function oak(seed: number): TreeVariant {
  const r = rng(seed);
  const c: Ctx = { r, near: new Tubes(), far: new Tubes(), cards: [] };
  const H = 3.2 + r() * 1.6;
  const rules: BranchRule[] = [
    { kids: 4 + Math.floor(r() * 2), from: 0.65, to: 1.0, angle: 0.62, lenRatio: 1.25, tropism: 0.05, kink: 0.2, segs: 6, radial: 10, leaves: 0, leafFrom: 1, leafSize: 0 },
    { kids: 5, from: 0.2, to: 0.95, angle: 0.7, lenRatio: 0.55, tropism: 0.06, kink: 0.42, segs: 6, radial: 7, leaves: 0.9, leafFrom: 0.45, leafSize: 1.55 },
    { kids: 3, from: 0.25, to: 0.95, angle: 0.75, lenRatio: 0.6, tropism: 0.05, kink: 0.5, segs: 4, radial: 5, leaves: 2.4, leafFrom: 0.1, leafSize: 1.45 },
    { kids: 0, from: 0, to: 0, angle: 0.8, lenRatio: 0.5, tropism: 0.04, kink: 0.5, segs: 3, radial: 4, leaves: 2.8, leafFrom: 0.0, leafSize: 1.3 },
  ];
  grow(c, new Vector3(0, -0.4, 0), new Vector3((r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15), H, 0.42 + r() * 0.12, 0, rules, 0, r() * 6);
  return finish(c, r, H + 7);
}

/** Norway spruce: one straight leader, whorls of drooping branches that turn up at the tips. */
function spruce(seed: number): TreeVariant {
  const r = rng(seed);
  const c: Ctx = { r, near: new Tubes(), far: new Tubes(), cards: [] };
  const H = 13 + r() * 8;
  const trunk: Vector3[] = [];
  const tr: number[] = [];
  const R0 = 0.24 + H * 0.008;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    trunk.push(new Vector3((r() - 0.5) * 0.06, -0.4 + t * H, (r() - 0.5) * 0.06));
    tr.push(Math.max(0.02, R0 * (1 - 0.92 * t)));
  }
  c.near.add(trunk, tr, 8, 0.7);
  c.far.add(trunk, tr, 5, 0.7);
  const branch: BranchRule[] = [
    { kids: 0, from: 0, to: 0, angle: 0, lenRatio: 0, tropism: 0.07, kink: 0.12, segs: 4, radial: 4, leaves: 3.0, leafFrom: 0.05, leafSize: 1.5 },
  ];
  let y = 1.8 + r() * 0.8;
  let roll = r() * 6;
  const farTubes = c.far;
  c.far = new Tubes(); // whorl branches are lost in the needles from afar
  while (y < H - 0.6) {
    const t = (y + 0.4) / H;
    const whorl = 4 + Math.floor(r() * 3);
    const L = Math.max(0.5, 4.6 * Math.pow(1 - t, 0.95) + 0.3);
    for (let k = 0; k < whorl; k++) {
      roll += (Math.PI * 2) / whorl + (r() - 0.5) * 0.4;
      const droop = -0.25 - 0.35 * (1 - t) + (r() - 0.5) * 0.1;
      const d = new Vector3(Math.cos(roll), droop, Math.sin(roll)).normalize();
      const size = 1.1 + 0.7 * (1 - t);
      branch[0].leafSize = size;
      grow(c, new Vector3(0, y, 0), d, L * (0.85 + r() * 0.3), Math.max(0.02, R0 * (1 - t) * 0.35), 0, branch, t, 0);
    }
    y += 0.55 + r() * 0.35;
  }
  c.far = farTubes;
  // The leader.
  for (let i = 0; i < 4; i++) c.cards.push({ p: new Vector3(0, H - 0.4 - i * 0.45, 0), size: 0.9 - i * 0.05, reach: 1 });
  return finish(c, r, H, 9);
}

/** Silver birch: slim pale stem, ascending limbs, fine twigs that hang; an airy crown. */
function birch(seed: number): TreeVariant {
  const r = rng(seed);
  const c: Ctx = { r, near: new Tubes(), far: new Tubes(), cards: [] };
  const H = 7 + r() * 3;
  const rules: BranchRule[] = [
    { kids: 9, from: 0.35, to: 0.97, angle: 0.62, lenRatio: 0.42, tropism: 0.025, kink: 0.12, segs: 10, radial: 8, leaves: 0.9, leafFrom: 0.8, leafSize: 1.05 },
    { kids: 4, from: 0.2, to: 0.95, angle: 0.8, lenRatio: 0.55, tropism: -0.02, kink: 0.3, segs: 5, radial: 5, leaves: 2.4, leafFrom: 0.35, leafSize: 1.0 },
    { kids: 0, from: 0, to: 0, angle: 0.6, lenRatio: 0.5, tropism: -0.12, kink: 0.35, segs: 3, radial: 3, leaves: 3.2, leafFrom: 0.1, leafSize: 0.85 },
  ];
  grow(c, new Vector3(0, -0.4, 0), new Vector3((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25), H, 0.17 + r() * 0.05, 0, rules, 0, r() * 6);
  return finish(c, r, H + 1.5);
}

/** Somei-yoshino cherry: a short trunk splitting low into wide, rising limbs; an umbrella of blossom. */
function cherry(seed: number): TreeVariant {
  const r = rng(seed);
  const c: Ctx = { r, near: new Tubes(), far: new Tubes(), cards: [] };
  const H = 1.6 + r() * 0.8;
  const rules: BranchRule[] = [
    { kids: 4 + Math.floor(r() * 2), from: 0.85, to: 1.0, angle: 0.85, lenRatio: 2.6, tropism: -0.005, kink: 0.14, segs: 4, radial: 10, leaves: 0, leafFrom: 1, leafSize: 0 },
    { kids: 5, from: 0.3, to: 0.98, angle: 0.6, lenRatio: 0.5, tropism: -0.01, kink: 0.3, segs: 7, radial: 7, leaves: 0.8, leafFrom: 0.55, leafSize: 1.4 },
    { kids: 3, from: 0.25, to: 0.95, angle: 0.7, lenRatio: 0.55, tropism: 0.0, kink: 0.4, segs: 4, radial: 4, leaves: 3.0, leafFrom: 0.05, leafSize: 1.3 },
    { kids: 0, from: 0, to: 0, angle: 0.7, lenRatio: 0.5, tropism: 0.01, kink: 0.45, segs: 3, radial: 3, leaves: 3.2, leafFrom: 0.0, leafSize: 1.15 },
  ];
  grow(c, new Vector3(0, -0.4, 0), new Vector3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3), H, 0.32 + r() * 0.08, 0, rules, 0, r() * 6);
  return finish(c, r, 6.5);
}

/** A hazel-like shrub: several stems from the ground, leafy to the base. */
function bush(seed: number): TreeVariant {
  const r = rng(seed);
  const c: Ctx = { r, near: new Tubes(), far: new Tubes(), cards: [] };
  const rules: BranchRule[] = [
    { kids: 3, from: 0.3, to: 0.95, angle: 0.6, lenRatio: 0.55, tropism: 0.02, kink: 0.35, segs: 4, radial: 4, leaves: 2.5, leafFrom: 0.2, leafSize: 1.0 },
    { kids: 0, from: 0, to: 0, angle: 0.6, lenRatio: 0.5, tropism: 0.02, kink: 0.4, segs: 3, radial: 3, leaves: 3.5, leafFrom: 0.0, leafSize: 0.9 },
  ];
  const stems = 5 + Math.floor(r() * 4);
  for (let i = 0; i < stems; i++) {
    const a = r() * Math.PI * 2;
    const d = new Vector3(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45);
    grow(c, new Vector3(Math.cos(a) * 0.2, -0.2, Math.sin(a) * 0.2), d, 1.6 + r() * 1.2, 0.05, 0, rules, 0.3, r() * 6);
  }
  return finish(c, r, 2.6);
}

const GROW: Record<SpeciesName, (seed: number) => TreeVariant> = { oak, spruce, birch, cherry, bush };

export function makeVariants(sp: SpeciesName, n: number, seed: number): TreeVariant[] {
  const out: TreeVariant[] = [];
  for (let i = 0; i < n; i++) out.push(GROW[sp](seed * 977 + i * 7919 + 13));
  return out;
}

// ------------------------------------------------------------------ atlas

/** 2x2 atlas: oak leaves, spruce needles, birch leaves, cherry blossom. r = shade, g/b = tilt, a = coverage. */
function atlas(): CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * 2;
  const ctx = cv.getContext('2d')!;
  const r = rng(4242);
  const paint = (shade: number, rot: number) => {
    const tx = Math.round(128 + Math.cos(rot) * 90);
    const ty = Math.round(128 + Math.sin(rot) * 90);
    return `rgb(${Math.round(shade)},${tx},${ty})`;
  };

  // Oak: lobed leaves on short twigs.
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.strokeStyle = 'rgb(40,128,128)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * S * 0.3, Math.sin(a) * S * 0.3);
    ctx.stroke();
  }
  for (let i = 0; i < 64; i++) {
    const rr = Math.sqrt(r()) * S * 0.36;
    const a = r() * Math.PI * 2;
    const len = S * (0.12 + r() * 0.06);
    const wid = len * 0.32;
    const rot = a + (r() - 0.5) * 1.4;
    ctx.save();
    ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k <= 16; k++) {
        const t = side < 0 ? k / 16 : 1 - k / 16;
        const w = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8) * (0.72 + 0.28 * Math.abs(Math.sin(t * Math.PI * 4.5)));
        const x = -len / 2 + t * len;
        if (k === 0 && side < 0) ctx.moveTo(x, 0);
        else ctx.lineTo(x, w * side);
      }
    }
    ctx.closePath();
    ctx.fillStyle = paint(80 + r() * 175, rot);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Spruce: overlapping, mostly horizontal fronds, each a twig thick with short needles.
  ctx.save();
  ctx.translate(S * 1.5, S / 2);
  for (let i = 0; i < 26; i++) {
    const rr = Math.sqrt(r()) * S * 0.26;
    const a0 = r() * Math.PI * 2;
    const x0 = Math.cos(a0) * rr;
    const y0 = Math.sin(a0) * rr * 0.8;
    const dirSign = r() < 0.5 ? -1 : 1;
    const ang = (dirSign < 0 ? Math.PI : 0) + (r() - 0.5) * 0.9;
    const L = S * (0.18 + r() * 0.16);
    const droop = 0.25 + r() * 0.35;
    const steps = 46;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const ca = ang + dirSign * droop * t * t;
      const x = x0 + Math.cos(ang) * L * t;
      const y = y0 + Math.sin(ang) * L * t + droop * L * 0.35 * t * t;
      const nl = S * 0.042 * (1 - t * 0.55);
      for (const side of [-1, 1]) {
        for (let m = 0; m < 2; m++) {
          const na = ca + side * (0.7 + r() * 0.5) + (dirSign < 0 ? 0 : 0);
          ctx.strokeStyle = paint(60 + r() * 195, na);
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();

  // Birch: small toothed ovate leaves hanging from fine twigs.
  ctx.save();
  ctx.translate(S / 2, S * 1.5);
  ctx.strokeStyle = 'rgb(60,128,128)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const x0 = (r() - 0.5) * S * 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, -S * 0.4);
    ctx.quadraticCurveTo(x0 + (r() - 0.5) * 80, 0, x0 + (r() - 0.5) * 120, S * 0.38);
    ctx.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const x = (r() - 0.5) * S * 0.74;
    const y = (r() - 0.5) * S * 0.78;
    if (Math.hypot(x / 0.9, y) > S * 0.4) continue;
    const len = S * (0.07 + r() * 0.03);
    const rot = Math.PI / 2 + (r() - 0.5) * 1.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(-len * 0.1, -len * 0.5, len / 2, 0);
    ctx.quadraticCurveTo(-len * 0.1, len * 0.5, -len / 2, 0);
    ctx.fillStyle = paint(90 + r() * 165, rot);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Cherry: clusters of five-petalled blossoms, notched petals, darker hearts.
  ctx.save();
  ctx.translate(S * 1.5, S * 1.5);
  for (let i = 0; i < 46; i++) {
    const rr = Math.sqrt(r()) * S * 0.38;
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    const pr = S * (0.035 + r() * 0.015);
    const rot = r() * Math.PI * 2;
    const tilt = r() * Math.PI * 2;
    for (let p = 0; p < 5; p++) {
      const pa = rot + (p / 5) * Math.PI * 2;
      ctx.save();
      ctx.translate(x + Math.cos(pa) * pr * 0.9, y + Math.sin(pa) * pr * 0.9);
      ctx.rotate(pa);
      ctx.beginPath();
      ctx.ellipse(0, 0, pr * 0.95, pr * 0.7, 0, 0, Math.PI * 2);
      ctx.fillStyle = paint(170 + r() * 85, tilt);
      ctx.fill();
      // Notch.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(pr * 0.95, 0, pr * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(x, y, pr * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = paint(40, tilt);
    ctx.fill();
  }
  ctx.restore();

  const tex = new CanvasTexture(cv);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.premultiplyAlpha = false;
  return tex;
}

let atlasTex: CanvasTexture | null = null;
function getAtlas(): CanvasTexture {
  if (!atlasTex) atlasTex = atlas();
  return atlasTex;
}

// ------------------------------------------------------------------ materials

/** Whole-tree sway: bend grows with the square of height above the root. Shared by bark and leaves. */
const SWAY_GLSL = /* glsl */ `
uniform float uLodNear;
uniform float uLodBand;
uniform float uLodSide; // 0 near set (fades out past uLodNear), 1 far set (fades in)
vec3 treeRoot() {
#ifdef USE_INSTANCING
  return (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  return (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
}
vec3 swayed(vec3 wp, vec3 root, float H) {
  float h = max(wp.y - root.y, 0.0) / H;
  float g = gustAt(root.xz);
  float s = sin(uTime * 0.9 + dot(root.xz, vec2(0.13, 0.11)));
  float amt = uWindStrength * (0.12 * s + 0.4 * g * uGustStrength) * 0.06 * H;
  wp.xz += uWindDir * amt * h * h;
  return wp;
}
`;

const LOD_FRAG_GLSL = /* glsl */ `
uniform float uLodNear;
uniform float uLodBand;
uniform float uLodSide;
varying float vLodDist;
varying float vSeedL;
void lodDither() {
  // Each tree switches at its own distance inside the band: no screen-door pattern, no wall of pops.
  float d = vLodDist - uLodNear - (vSeedL - 0.5) * uLodBand;
  if (uLodSide < 0.5 ? d > 0.0 : d <= 0.0) discard;
}
`;

const BARK_VERT = /* glsl */ `
${COMMON_GLSL}
${SWAY_GLSL}
uniform float uHeight;
attribute vec2 aBark;
varying vec2 vBark;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vLodDist;
varying float vSeedL;
varying float vH;
void main() {
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
#else
  mat4 m = modelMatrix;
#endif
  vec3 root = treeRoot();
  vec3 wp = (m * vec4(position, 1.0)).xyz;
  float sc = length(m[0].xyz);
  wp = swayed(wp, root, uHeight * sc);
  vBark = aBark;
  vNormal = normalize(mat3(m) * normal);
  vWorldPos = wp;
  vH = (wp.y - root.y) / max(sc, 0.01);
  vLodDist = length(root.xz - cameraPosition.xz);
  vSeedL = fract(root.x * 0.137 + root.z * 0.271);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const BARK_FRAG = /* glsl */ `
${COMMON_GLSL}
${LOD_FRAG_GLSL}
uniform float uKind; // 0 oak, 1 spruce, 2 birch, 3 cherry
uniform vec3 uBarkA;
uniform vec3 uBarkB;
uniform vec3 uGrassMid;
uniform vec3 uTint;
varying vec2 vBark;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vH;
void main() {
#ifndef SHADOW_PASS
  lodDither();
#endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 L = uSunDir;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec2 b = vBark;
  vec3 col;
  float bump = 0.0;
  if (uKind < 0.5) {
    // Oak: deep, braided vertical furrows.
    float plate = nz(vec2(b.x * 1.6, b.y * 0.22)).a;
    float furrow = nz(vec2(b.x * 3.4 + b.y * 0.05, b.y * 0.45) + 0.37).a;
    col = mix(uBarkB, uBarkA, plate) * mix(0.35, 1.0, smoothstep(0.18, 0.36, furrow));
    bump = (smoothstep(0.18, 0.36, furrow) - 0.5) * 0.7;
  } else if (uKind < 1.5) {
    // Spruce: thin reddish scales.
    vec2 q = vec2(b.x * 5.0, b.y * 3.0);
    q.x += floor(q.y) * 0.5;
    float sc = smoothstep(0.5, 0.1, length(fract(q) - 0.5));
    col = mix(uBarkB, uBarkA, sc * 0.7 + nz(b * 0.7).a * 0.3);
    bump = sc - 0.5;
  } else if (uKind < 2.5) {
    // Birch: chalk-white with dark horizontal lenticels, black and fissured near the ground.
    float len = smoothstep(0.62, 0.8, nz(vec2(b.x * 1.3, b.y * 6.0)).a) * smoothstep(0.3, 0.7, nz(vec2(b.x * 0.5, b.y * 1.5) + 0.3).g);
    col = mix(uBarkA, uBarkB, len);
    float foot = 1.0 - smoothstep(0.4, 1.6 + nz(b * 0.8).a, vH);
    col = mix(col, uBarkB * mix(0.8, 1.4, nz(vec2(b.x * 3.0, b.y * 0.6)).a), foot);
    col *= mix(0.9, 1.04, nz(b * 2.0).b);
  } else {
    // Cherry: dark, glossy, banded with pale horizontal lenticels.
    float band = smoothstep(0.7, 0.85, nz(vec2(b.x * 0.9, b.y * 4.5)).a);
    col = mix(uBarkA, uBarkB, band) * mix(0.8, 1.1, nz(b * 1.3).a);
    bump = band * 0.4;
  }
  // Moss on the lower, upward and shaded side.
  float moss = smoothstep(0.62, 0.9, nz(vWorldPos.xz * 0.9 + vWorldPos.y * 0.3).a + N.y * 0.3 - dot(N, L) * 0.15) * (1.0 - smoothstep(0.0, 3.0, vH)) * (uKind > 1.5 && uKind < 2.5 ? 0.3 : 0.7);
  col = mix(col, uGrassMid * 0.3 * uTint, moss);
  float ndl = dot(N, L) + bump * 0.35;
  float diff = smoothstep(-0.15, 0.45, ndl);
  float sh = sunShadow(vWorldPos + N * 0.1);
  vec3 lit = uAmbient * (0.6 + 0.4 * N.y) * mix(0.55, 1.0, smoothstep(0.0, 3.0, vH)) + uSunColor * diff * max(L.y + 0.15, 0.0) * 1.1 * smoothstep(0.45, 1.0, sh);
  col *= lit;
  if (uKind > 2.5) col += uSunColor * pow(max(dot(reflect(-L, N), V), 0.0), 24.0) * 0.08 * diff;
  col *= cloudShadowAt(vWorldPos.xz);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LEAF_VERT = /* glsl */ `
${COMMON_GLSL}
${SWAY_GLSL}
uniform float uHeight;
attribute vec3 aCenter;
attribute vec3 aDir;
attribute vec4 aData; // size, rotation, ao, seed
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorldPos;
varying float vAo;
varying float vSeed;
varying float vLodDist;
varying float vSeedL;
void main() {
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
#else
  mat4 m = modelMatrix;
#endif
  vec3 root = treeRoot();
  float sc = length(m[0].xyz);
  vec3 c = (m * vec4(aCenter, 1.0)).xyz;
  c = swayed(c, root, uHeight * sc);
  float seed = aData.w;
  // Leaves flutter on top of the whole-tree sway.
  float gust = gustAt(c.xz);
  float flutter = sin(uTime * (2.4 + seed * 2.0) + seed * 40.0 + dot(c.xz, uWindDir) * 0.4);
  c.xz += uWindDir * uWindStrength * (0.04 * flutter + 0.08 * gust * uGustStrength) * aData.z;
  c.y += 0.03 * flutter * uWindStrength;

  float rot = aData.y + flutter * 0.06 * (0.3 + uWindStrength);
  vec2 q = vec2(cos(rot) * position.x - sin(rot) * position.y, sin(rot) * position.x + cos(rot) * position.y);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * q.x + up * q.y) * aData.x * sc;

  vUv = position.xy + 0.5;
  vN = normalize(mat3(m) * aDir);
  vWorldPos = p;
  vAo = aData.z;
  vSeed = seed;
  vLodDist = length(root.xz - cameraPosition.xz);
  vSeedL = fract(root.x * 0.137 + root.z * 0.271);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const LEAF_FRAG = /* glsl */ `
${COMMON_GLSL}
${LOD_FRAG_GLSL}
uniform sampler2D uAtlas;
uniform vec2 uTile;
uniform vec3 uDeep;
uniform vec3 uBody;
uniform vec3 uSunny;
uniform vec3 uBack;
uniform vec3 uTint;
uniform float uTintK;
uniform float uBlossom;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorldPos;
varying float vAo;
varying float vSeed;
void main() {
  vec2 uv = (uTile + clamp(vUv, 0.02, 0.98)) * 0.5;
  vec4 tx = texture(uAtlas, uv);
#ifdef SHADOW_PASS
  if (tx.a < 0.5) discard;
  gl_FragColor = vec4(1.0);
  return;
#endif
  lodDither();
  float a = (tx.a - 0.5) / max(fwidth(tx.a), 1e-4) + 0.5;
#ifdef A2C
  a = clamp(a, 0.0, 1.0);
  if (a < 0.01) discard;
#else
  if (a < 0.5) discard;
  a = 1.0;
#endif
  vec3 N = normalize(vN + (vec3(tx.g, 0.5, tx.b) - 0.5) * 0.5);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  float ndl = dot(N, L);
  float sh = sunShadow(vWorldPos);
  float lit = smoothstep(-0.05, 0.4, ndl) * smoothstep(0.05, 0.45, vAo) * smoothstep(0.42, 1.0, sh);

  float v = mix(0.78, 1.0, tx.r) * (0.9 + 0.2 * fract(vSeed * 7.13));
  vec3 alb = mix(uDeep, uBody, smoothstep(0.0, 0.75, vAo)) * v * mix(0.8, 1.12, fract(vSeed * 3.7));
  // Blossom hearts.
  if (uBlossom > 0.5) alb = mix(alb, vec3(0.62, 0.18, 0.28), smoothstep(0.3, 0.15, tx.r) * 0.8);
  // Autumn-ish tint on some crowns, per tree.
  alb = mix(alb, alb * vec3(1.15, 1.0, 0.6), uTintK * step(0.85, fract(vSeed * 13.1)));

  float sun = max(L.y + 0.15, 0.0);
  float aoK = uBlossom > 0.5 ? mix(0.85, 1.1, vAo) * 1.25 : mix(0.62, 1.1, vAo);
  vec3 col = alb * (uAmbient * (0.62 + 0.45 * max(N.y, 0.0)) * aoK + uSunColor * lit * sun * 1.15);
  // Petals scatter light: blossoms glow softly even in shade.
  if (uBlossom > 0.5) col += alb * uSunColor * sun * 0.18;
  float glint = smoothstep(0.5, 0.85, ndl) * smoothstep(0.86, 0.98, v) * lit;
  col += uSunny * uSunColor * glint * sun * 0.8;
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0) * vAo;
  col += uSunColor * uBack * back * 0.7 * sun;
  col *= uTint;
  col *= cloudShadowAt(vWorldPos.xz);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const lin = (hex: string) => new Color(hex);

export const SPECIES_LOOK: Record<SpeciesName, { tile: [number, number]; deep: string; body: string; sunny: string; back: string; barkA: string; barkB: string; kind: number; blossom?: boolean; tint?: number }> = {
  oak: { tile: [0, 0], deep: '#173a22', body: '#3c6c2a', sunny: '#9fc06a', back: '#3a5a10', barkA: '#7a7066', barkB: '#4a4038', kind: 0, tint: 0.4 },
  spruce: { tile: [1, 0], deep: '#0c2420', body: '#24473a', sunny: '#6f9a66', back: '#1a3010', barkA: '#7a4e36', barkB: '#4a2e22', kind: 1 },
  birch: { tile: [0, 1], deep: '#2a4a1c', body: '#6a9a34', sunny: '#d8ec8a', back: '#6a8a10', barkA: '#ece8de', barkB: '#2a2826', kind: 2, tint: 0.6 },
  cherry: { tile: [1, 1], deep: '#d08aa6', body: '#f8cfdf', sunny: '#fff2f8', back: '#ff9ab8', barkA: '#3a2a2a', barkB: '#8a6a62', kind: 3, blossom: true },
  bush: { tile: [0, 0], deep: '#0f2a1a', body: '#3a6a2a', sunny: '#a8c870', back: '#3a5a10', barkA: '#5a4a3a', barkB: '#3a2e24', kind: 0 },
};

export interface TreeMaterials {
  bark: ShaderMaterial;
  leaves: ShaderMaterial;
  barkShadow: ShaderMaterial;
  leavesShadow: ShaderMaterial;
}

/** Materials for one species, near (side 0) or far (side 1) set. */
export function treeMaterials(sp: SpeciesName, height: number, side: number, lod: { near: { value: number }; band: { value: number } }): TreeMaterials {
  const look = SPECIES_LOOK[sp];
  const common = { ...U, uHeight: { value: height }, uLodNear: lod.near, uLodBand: lod.band, uLodSide: { value: side } };
  const bark = new ShaderMaterial({
    uniforms: { ...common, uKind: { value: look.kind }, uBarkA: { value: lin(look.barkA) }, uBarkB: { value: lin(look.barkB) } },
    vertexShader: BARK_VERT,
    fragmentShader: BARK_FRAG,
  });
  const leaves = new ShaderMaterial({
    uniforms: {
      ...common,
      uAtlas: { value: getAtlas() },
      uTile: { value: new Vector2(look.tile[0], 1 - look.tile[1]) }, // canvas rows are flipped in the texture
      uDeep: { value: lin(look.deep) },
      uBody: { value: lin(look.body) },
      uSunny: { value: lin(look.sunny) },
      uBack: { value: lin(look.back) },
      uTintK: { value: look.tint ?? 0 },
      uBlossom: { value: look.blossom ? 1 : 0 },
    },
    vertexShader: LEAF_VERT,
    fragmentShader: LEAF_FRAG,
    side: DoubleSide,
  });
  const barkShadow = new ShaderMaterial({ uniforms: bark.uniforms, vertexShader: BARK_VERT, fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
  const leavesShadow = new ShaderMaterial({ uniforms: leaves.uniforms, vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, defines: { SHADOW_PASS: '' }, side: DoubleSide });
  return { bark, leaves, barkShadow, leavesShadow };
}

export function setLeafA2C(m: ShaderMaterial, on: boolean): void {
  if (m.alphaToCoverage === on) return;
  m.alphaToCoverage = on;
  m.defines = on ? { A2C: '' } : {};
  m.needsUpdate = true;
}
