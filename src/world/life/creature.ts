import { BufferAttribute, BufferGeometry, Color, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { U } from '../../core/uniforms';
import { COMMON_GLSL } from '../common';

/**
 * Anatomy kit for the animals: smooth skins lofted over a spine of elliptical sections, jointed
 * limbs, glossy eyes, and a fur shader. One geometry per species carries a small rig in its
 * vertex attributes (which part a vertex belongs to, how much it follows it, where it hinges),
 * so a whole herd animates in the vertex shader from a few numbers per animal.
 */

export type V3 = [number, number, number];

/** Surface kinds understood by the creature shader. */
export const K = {
  lamp: 5,
  crystal: 6,
  metal: 7,
  rune: 10,
  cloth: 14,
  /** Tinted by the animal's coat colour. */
  fur: 20,
  wool: 21,
  feather: 22,
  /** Bare skin: noses, inner ears, combs. Never tinted. */
  skin: 23,
  /** Fur of a fixed colour (socks, blazes, manes). */
  furx: 24,
  /** Coat fur that may carry pale spots, dark stripes or pied patches, depending on the animal. */
  spot: 25,
  stripe: 26,
  patch: 27,
  eye: 30,
  wet: 31,
  horn: 32,
  hoof: 33,
  beak: 34,
  glint: 35,
} as const;

/** Rig parts. Legs are 1..4 (front left, front right, back left, back right). */
export const P = { body: 0, head: 5, tail: 6, ear: 7, jaw: 8, lid: 9, wing: 10 } as const;

export interface St {
  p: V3;
  rx: number;
  ry: number;
  c?: string;
  u?: string;
}

/** A section of a loft: centre, half-width, half-height, colour on top and underneath. */
export const st = (x: number, y: number, z: number, rx: number, ry: number = rx, c?: string, u?: string): St => ({ p: [x, y, z], rx, ry, c, u });

export interface LoftOpts {
  c?: string;
  /** Colour of the underside (belly, throat, inner ear). */
  u?: string;
  kind?: number;
  rnd?: number;
  seg?: number;
  sub?: number;
  /** Roundness of the two ends (0 = cut flat). */
  cap?: [number, number];
  /** How much the two ends follow the part's motion (necks and tails bend along their length). */
  w?: [number, number];
  /** Where around the section the underside colour fades in. */
  ub?: [number, number];
  /** For parts that run sideways (wings): the section's width lies fore and aft. */
  across?: boolean;
}

export interface BallOpts {
  u?: string;
  q?: Quaternion;
  rnd?: number;
  seg?: number;
}

interface Vtx {
  p: Vector3;
  n: Vector3;
  c: Color;
}

const AX = new Vector3(1, 0, 0);
const AZ = new Vector3(0, 0, 1);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

interface Ctx {
  part: number;
  pivot: V3;
  pivot2: V3;
  w: number;
  a: number;
  b: number;
}

export class Rig {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private mat: number[] = [];
  private rig: number[] = [];
  private piv: number[] = [];
  private piv2: number[] = [];
  private ctx: Ctx = { part: 0, pivot: [0, 0, 0], pivot2: [0, 0, 0], w: 0, a: 0, b: 0 };
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly fn = new Vector3();

  /** detail 1 = seen up close, about 0.45 = the distant stand-in. */
  constructor(readonly detail = 1) {}

  get hi(): boolean {
    return this.detail > 0.8;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private bind(part: number, pivot: V3, fn: () => void, o: Partial<Ctx> = {}): void {
    const prev = this.ctx;
    this.ctx = { part, pivot, pivot2: o.pivot2 ?? [0, 0, 0], w: o.w ?? 1, a: o.a ?? 0, b: o.b ?? 0 };
    fn();
    this.ctx = prev;
  }

  /** Head and neck, hinged at the base of the neck. `graze` is how far the head drops to feed. */
  head(pivot: V3, graze: number, fn: () => void): void {
    this.bind(P.head, pivot, fn, { b: graze });
  }

  /** Tail hinged at its root: `sway` is how far it swings, `wag` whether it wags when pleased. */
  tail(pivot: V3, sway: number, fn: () => void, wag = 0): void {
    this.bind(P.tail, pivot, fn, { a: wag, b: sway });
  }

  /** An ear on the head: flicks now and then, lies back at a run. */
  ear(pivot: V3, side: number, fn: () => void): void {
    this.bind(P.ear, pivot, fn, { pivot2: this.ctx.pivot, a: side, b: this.ctx.b });
  }

  /** Lower jaw: chews while grazing. */
  jaw(pivot: V3, fn: () => void): void {
    this.bind(P.jaw, pivot, fn, { pivot2: this.ctx.pivot, b: this.ctx.b });
  }

  /** Eyelid: closes over the eye for a blink. */
  lid(pivot: V3, fn: () => void): void {
    this.bind(P.lid, pivot, fn, { pivot2: this.ctx.pivot, b: this.ctx.b });
  }

  /** A folded wing that beats when the bird runs. */
  wing(pivot: V3, side: number, fn: () => void): void {
    this.bind(P.wing, pivot, fn, { a: side });
  }

  /** A leg hinged at the hip, bending again at the knee. */
  limb(id: number, hip: V3, knee: V3, fn: () => void): void {
    const from = this.vertexCount;
    this.bind(id, hip, fn, { pivot2: knee });
    const blend = Math.max(0.01, (hip[1] - knee[1]) * 0.22);
    for (let i = from; i < this.vertexCount; i++) this.rig[i * 4 + 1] = smooth(knee[1] + blend, knee[1] - blend, this.pos[i * 3 + 1]);
  }

  private emit(v: Vtx, kind: number, rnd: number, w: number): void {
    const c = this.ctx;
    this.pos.push(v.p.x, v.p.y, v.p.z);
    this.nrm.push(v.n.x, v.n.y, v.n.z);
    this.col.push(v.c.r, v.c.g, v.c.b);
    this.mat.push(kind, rnd);
    this.rig.push(c.part, w, c.a, c.b);
    this.piv.push(c.pivot[0], c.pivot[1], c.pivot[2]);
    this.piv2.push(c.pivot2[0], c.pivot2[1], c.pivot2[2]);
  }

  /** One triangle, wound so it faces the way its vertex normals point; slivers are dropped. */
  private tri(a: Vtx, b: Vtx, c: Vtx, kind: number, rnd: number, wa: number, wb: number, wc: number): void {
    this.e1.subVectors(b.p, a.p);
    this.e2.subVectors(c.p, a.p);
    this.fn.crossVectors(this.e1, this.e2);
    if (this.fn.lengthSq() < 1e-18) return;
    const out = this.fn.dot(a.n) + this.fn.dot(b.n) + this.fn.dot(c.n);
    this.emit(a, kind, rnd, wa);
    if (out >= 0) {
      this.emit(b, kind, rnd, wb);
      this.emit(c, kind, rnd, wc);
    } else {
      this.emit(c, kind, rnd, wc);
      this.emit(b, kind, rnd, wb);
    }
  }

  /** A smooth skin over a row of elliptical sections (body, neck, leg, tail, horn, ear). */
  loft(sts: St[], o: LoftOpts = {}): void {
    const d = this.detail;
    const seg = Math.max(5, Math.round((o.seg ?? 12) * d));
    const sub = Math.max(1, Math.round((o.sub ?? 3) * d));
    const kind = o.kind ?? K.fur;
    const rnd = o.rnd ?? 0.5;
    const base = o.c ?? '#ffffff';
    const n = sts.length;
    const at = (i: number) => sts[Math.max(0, Math.min(n - 1, i))];
    const top = sts.map((s) => new Color(s.c ?? base));
    const und = sts.map((s) => new Color(s.u ?? o.u ?? s.c ?? base));

    // Resample the sections along a spline so a handful of them makes a flowing shape.
    interface Ring {
      p: Vector3;
      rx: number;
      ry: number;
      c: Color;
      u: Color;
      f: number;
      t: Vector3;
      pole: number;
    }
    const path: Ring[] = [];
    const add = (i: number, t: number) => {
      const a = at(i - 1);
      const b = at(i);
      const c = at(i + 1);
      const e = at(i + 2);
      const i1 = Math.min(n - 1, i + 1);
      path.push({
        p: new Vector3(cr(a.p[0], b.p[0], c.p[0], e.p[0], t), cr(a.p[1], b.p[1], c.p[1], e.p[1], t), cr(a.p[2], b.p[2], c.p[2], e.p[2], t)),
        rx: Math.max(0, cr(a.rx, b.rx, c.rx, e.rx, t)),
        ry: Math.max(0, cr(a.ry, b.ry, c.ry, e.ry, t)),
        c: top[i].clone().lerp(top[i1], t),
        u: und[i].clone().lerp(und[i1], t),
        f: (i + t) / (n - 1),
        t: new Vector3(),
        pole: 0,
      });
    };
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sub; j++) add(i, j / sub);
    add(n - 1, 0);
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)].p;
      const b = path[Math.min(path.length - 1, i + 1)].p;
      path[i].t.subVectors(b, a).normalize();
    }

    // Rounded ends: a few shrinking rings past each end, closing on a point.
    const m = this.hi ? 3 : 2;
    const cap = (end: Ring, len: number, dir: number): Ring[] => {
      const out: Ring[] = [];
      const steps = len > 0 ? m : 1;
      for (let j = 1; j <= steps; j++) {
        const a = (j / steps) * Math.PI * 0.5;
        const s = Math.cos(a);
        out.push({
          ...end,
          p: end.p.clone().addScaledVector(end.t, dir * Math.sin(a) * len * Math.min(end.rx, end.ry)),
          rx: j === steps ? 0 : end.rx * s,
          ry: j === steps ? 0 : end.ry * s,
          pole: j === steps ? dir : 0,
        });
      }
      return out;
    };
    const rings: Ring[] = [...cap(path[0], o.cap?.[0] ?? 0.7, -1).reverse(), ...path, ...cap(path[path.length - 1], o.cap?.[1] ?? 0.7, 1)];

    // Section frames: "side" stays as close to the animal's left-right axis as it can.
    const side = new Vector3();
    const up = new Vector3();
    const frame = (t: Vector3) => {
      side.copy(AX).addScaledVector(t, -t.x);
      if (o.across || side.lengthSq() < 0.003) side.copy(AZ).addScaledVector(t, -t.z);
      side.normalize();
      up.crossVectors(t, side).normalize();
    };
    frame(path[0].t);
    const flip = up.y < -1e-3 ? -1 : 1;
    const ub0 = o.ub?.[0] ?? 0;
    const ub1 = o.ub?.[1] ?? 0.75;

    const grid: Vtx[][] = [];
    for (const r of rings) {
      frame(r.t);
      up.multiplyScalar(flip);
      const row: Vtx[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        row.push({
          p: r.p.clone().addScaledVector(side, cs * r.rx).addScaledVector(up, sn * r.ry),
          n: r.pole ? r.t.clone().multiplyScalar(r.pole) : new Vector3(),
          c: r.c.clone().lerp(r.u, smooth(ub0, ub1, -sn)),
        });
      }
      grid.push(row);
    }
    // Smooth normals: every vertex takes the average of the faces around it.
    const centre = new Vector3();
    const acc = (a: Vtx, b: Vtx, c: Vtx, ra: Ring, rb: Ring) => {
      this.e1.subVectors(b.p, a.p);
      this.e2.subVectors(c.p, a.p);
      this.fn.crossVectors(this.e1, this.e2);
      if (this.fn.lengthSq() < 1e-18) return;
      centre.addVectors(ra.p, rb.p).multiplyScalar(0.5);
      this.e1.addVectors(a.p, b.p).add(c.p).multiplyScalar(1 / 3).sub(centre);
      // End faces look along the spine, not away from it.
      if (ra.pole) this.e1.addScaledVector(ra.t, ra.pole * (rb.rx + rb.ry) * 4);
      if (rb.pole) this.e1.addScaledVector(rb.t, rb.pole * (ra.rx + ra.ry) * 4);
      if (this.fn.dot(this.e1) < 0) this.fn.negate();
      a.n.add(this.fn);
      b.n.add(this.fn);
      c.n.add(this.fn);
    };
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if (!rings[r].pole && !rings[r + 1].pole) {
          acc(grid[r][k], grid[r][k1], grid[r + 1][k1], rings[r], rings[r + 1]);
          acc(grid[r][k], grid[r + 1][k1], grid[r + 1][k], rings[r], rings[r + 1]);
        } else if (rings[r].pole) acc(grid[r + 1][k], grid[r + 1][k1], grid[r][k], rings[r], rings[r + 1]);
        else acc(grid[r][k], grid[r][k1], grid[r + 1][k], rings[r], rings[r + 1]);
      }
    }
    for (let r = 0; r < rings.length; r++) for (const v of grid[r]) if (!rings[r].pole) v.n.normalize();
    for (const row of grid) for (const v of row) if (v.n.lengthSq() < 0.5) v.n.set(0, 1, 0);

    const w0 = o.w ? o.w[0] : this.ctx.w;
    const w1 = o.w ? o.w[1] : this.ctx.w;
    const wOf = (r: Ring) => w0 + (w1 - w0) * r.f;
    for (let r = 0; r < rings.length - 1; r++) {
      const wa = wOf(rings[r]);
      const wb = wOf(rings[r + 1]);
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        this.tri(grid[r][k], grid[r][k1], grid[r + 1][k1], kind, rnd, wa, wa, wb);
        this.tri(grid[r][k], grid[r + 1][k1], grid[r + 1][k], kind, rnd, wa, wb, wb);
      }
    }
  }

  /** A smooth ellipsoid. */
  ball(x: number, y: number, z: number, rx: number, ry: number, rz: number, c: string, kind: number = K.fur, o: BallOpts = {}): void {
    const d = this.detail * (o.seg ?? 1);
    const n = Math.max(6, Math.round(12 * d));
    const m = Math.max(4, Math.round(8 * d));
    const top = new Color(c);
    const und = new Color(o.u ?? c);
    const grid: Vtx[][] = [];
    for (let i = 0; i <= m; i++) {
      const phi = (i / m) * Math.PI;
      const row: Vtx[] = [];
      for (let j = 0; j < n; j++) {
        const th = (j / n) * Math.PI * 2;
        const ux = Math.sin(phi) * Math.cos(th);
        const uy = Math.cos(phi);
        const uz = Math.sin(phi) * Math.sin(th);
        const p = new Vector3(ux * rx, uy * ry, uz * rz);
        const nn = new Vector3(ux / rx, uy / ry, uz / rz).normalize();
        if (o.q) {
          p.applyQuaternion(o.q);
          nn.applyQuaternion(o.q);
        }
        p.x += x;
        p.y += y;
        p.z += z;
        row.push({ p, n: nn, c: top.clone().lerp(und, smooth(0, 0.7, -uy)) });
      }
      grid.push(row);
    }
    const rnd = o.rnd ?? 0.5;
    const w = this.ctx.w;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        this.tri(grid[i][j], grid[i][j1], grid[i + 1][j1], kind, rnd, w, w, w);
        this.tri(grid[i][j], grid[i + 1][j1], grid[i + 1][j], kind, rnd, w, w, w);
      }
    }
  }

  /** A tapering spike: tuft of hair, claw, tine, whisker. */
  spike(a: V3, b: V3, r: number, c: string, kind: number = K.fur, o: LoftOpts = {}): void {
    this.loft([st(a[0], a[1], a[2], r), st(b[0], b[1], b[2], r * 0.08)], { c, kind, seg: 6, sub: 1, cap: [0.4, 0], ...o });
  }

  /**
   * A pair of eyes: glossy ball, pupil, a bright catchlight, and (given a colour) a lid that blinks.
   * `out` is how far to the side they look (1 = straight sideways, 0 = straight ahead).
   */
  eyes(x: number, y: number, z: number, r: number, iris: string, o: { pupil?: string; lid?: string; lidKind?: number; kind?: number; out?: number } = {}): void {
    const out = o.out ?? 0.75;
    for (const s of [-1, 1]) {
      const dir = new Vector3(s * out, 0.12, 1 - out * 0.6).normalize();
      this.ball(s * x, y, z, r, r, r, iris, o.kind ?? K.eye, { seg: 0.7 });
      if (!this.hi) continue;
      if (o.pupil) this.ball(s * x + dir.x * r * 0.5, y + dir.y * r * 0.5, z + dir.z * r * 0.5, r * 0.62, r * 0.62, r * 0.62, o.pupil, K.eye, { seg: 0.6 });
      this.ball(s * x + dir.x * r * 0.86, y + dir.y * r * 0.86 + r * 0.4, z + dir.z * r * 0.86 + r * 0.22, r * 0.25, r * 0.25, r * 0.25, '#ffffff', K.glint, { seg: 0.5 });
      if (o.lid) {
        const lid = o.lid;
        this.lid([s * x, y, z], () => this.ball(s * x, y, z, r * 1.2, r * 1.2, r * 1.2, lid, o.lidKind ?? K.fur, { seg: 0.7 }));
      }
    }
  }

  /** A leaf-shaped ear from base to tip; the inner colour faces forward. */
  earLeaf(s: number, base: V3, tip: V3, width: number, c: string, inner: string, o: { kind?: number; tipC?: string; thick?: number } = {}): void {
    const th = o.thick ?? width * 0.22;
    const mid: V3 = [base[0] + (tip[0] - base[0]) * 0.45, base[1] + (tip[1] - base[1]) * 0.45, base[2] + (tip[2] - base[2]) * 0.45 - width * 0.12];
    this.ear(base, s, () =>
      this.loft(
        [st(base[0], base[1], base[2], width * 0.6, th * 1.4, c, c), st(mid[0], mid[1], mid[2], width, th, c, inner), st(tip[0], tip[1], tip[2], width * 0.14, th * 0.4, o.tipC ?? c, o.tipC ?? inner)],
        { kind: o.kind ?? K.fur, seg: 8, sub: 3, cap: [0.3, 0.6], ub: [-0.25, 0.25] },
      ),
    );
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.mat), 2));
    g.setAttribute('aRig', new BufferAttribute(new Float32Array(this.rig), 4));
    g.setAttribute('aPivot', new BufferAttribute(new Float32Array(this.piv), 3));
    g.setAttribute('aPivot2', new BufferAttribute(new Float32Array(this.piv2), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A hoofed leg with its joints: shoulder, forearm, knee, cannon, fetlock and hoof in front;
 * haunch, stifle, hock (set back), cannon, fetlock and hoof behind.
 */
export function hoofLeg(
  g: Rig,
  id: number,
  x: number,
  z: number,
  H: number,
  R: number,
  c: string,
  o: { c2?: string; hoof?: string; cloven?: boolean; kind?: number; kind2?: number; shag?: string; thigh?: number } = {},
): void {
  const fore = id < 3;
  const c2 = o.c2 ?? c;
  const th = o.thigh ?? 1;
  const knee: V3 = [x, H * (fore ? 0.46 : 0.44), z + (fore ? 0.012 : -0.11) * H];
  const pz = z + (fore ? 0.02 : -0.04) * H;
  g.limb(id, [x * 0.9, H, z], knee, () => {
    const upper = fore
      ? [st(x * 0.8, H * 1.12, z + 0.02 * H, R * 1.9 * th, R * 2.6 * th), st(x * 0.95, H * 0.86, z - 0.02 * H, R * 1.45 * th, R * 1.9 * th), st(x, H * 0.64, z, R * 1.05, R * 1.25), st(x, H * 0.47, z + 0.012 * H, R * 0.92, R * 1.0)]
      : [st(x * 0.75, H * 1.14, z + 0.06 * H, R * 2.2 * th, R * 3.4 * th), st(x * 0.92, H * 0.84, z + 0.08 * H, R * 1.7 * th, R * 2.5 * th), st(x, H * 0.62, z - 0.01 * H, R * 1.05, R * 1.4), st(x, H * 0.45, z - 0.11 * H, R * 0.86, R * 0.98)];
    const k = upper[3];
    const lower = fore
      ? [st(k.p[0], k.p[1], k.p[2], k.rx, k.ry), st(x, H * 0.28, z, R * 0.6, R * 0.66), st(x, H * 0.13, z - 0.012 * H, R * 0.78, R * 0.84), st(x, H * 0.07, pz, R * 0.62, R * 0.7)]
      : [st(k.p[0], k.p[1], k.p[2], k.rx, k.ry), st(x, H * 0.26, z - 0.075 * H, R * 0.6, R * 0.66), st(x, H * 0.12, z - 0.07 * H, R * 0.78, R * 0.84), st(x, H * 0.065, pz, R * 0.62, R * 0.7)];
    g.loft(upper, { c, kind: o.kind ?? K.fur, seg: 9, sub: 2, cap: [0.5, 0.3] });
    g.loft(lower, { c: c2, kind: o.kind2 ?? o.kind ?? K.fur, seg: 8, sub: 2, cap: [0.3, 0] });
    const hoof = o.hoof ?? '#2a2420';
    const toes = o.cloven ? [-0.46, 0.46] : [0];
    for (const t of toes) {
      const w = o.cloven ? 0.5 : 1;
      g.loft([st(x + t * R, H * 0.08, pz, R * 0.66 * w, R * 0.74), st(x + t * R * 1.1, 0.004, pz + 0.035 * H, R * 0.92 * w, R * 1.08)], { c: hoof, kind: K.hoof, seg: 8, sub: 1, cap: [0.3, 0] });
    }
    // Long hair hanging over the hooves.
    if (o.shag && g.hi) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        g.spike([x + Math.cos(a) * R * 0.6, H * 0.2, z + Math.sin(a) * R * 0.6], [x + Math.cos(a) * R * 1.25, H * 0.03, pz + Math.sin(a) * R * 1.25], R * 0.5, o.shag, o.kind ?? K.fur);
      }
    }
  });
}

/** A leg that ends in a paw: elbow tucked back in front; big thigh, knee forward, hock back behind. */
export function pawLeg(
  g: Rig,
  id: number,
  x: number,
  z: number,
  H: number,
  R: number,
  c: string,
  o: { c2?: string; claws?: string; kind?: number; kind2?: number; thigh?: number; toes?: string } = {},
): void {
  const fore = id < 3;
  const c2 = o.c2 ?? c;
  const th = o.thigh ?? 1;
  const knee: V3 = fore ? [x, H * 0.5, z] : [x, H * 0.36, z - 0.16 * H];
  const pz = z + (fore ? 0.01 : -0.05) * H;
  g.limb(id, [x * 0.9, H, z], knee, () => {
    const upper = fore
      ? [st(x * 0.8, H * 1.1, z + 0.02 * H, R * 1.8 * th, R * 2.4 * th), st(x * 0.95, H * 0.8, z - 0.05 * H, R * 1.4 * th, R * 1.75 * th), st(x, H * 0.5, z, R * 0.98, R * 1.08)]
      : [st(x * 0.75, H * 1.1, z + 0.08 * H, R * 2.2 * th, R * 3.2 * th), st(x * 0.92, H * 0.78, z + 0.12 * H, R * 1.75 * th, R * 2.35 * th), st(x, H * 0.54, z - 0.03 * H, R * 1.05, R * 1.3), st(x, H * 0.36, z - 0.16 * H, R * 0.82, R * 0.92)];
    const k = upper[upper.length - 1];
    const lower = fore
      ? [st(k.p[0], k.p[1], k.p[2], k.rx, k.ry), st(x, H * 0.22, z + 0.01 * H, R * 0.8, R * 0.86), st(x, R * 0.9, pz, R * 0.84, R * 0.94)]
      : [st(k.p[0], k.p[1], k.p[2], k.rx, k.ry), st(x, H * 0.17, z - 0.1 * H, R * 0.72, R * 0.78), st(x, R * 0.9, pz, R * 0.82, R * 0.92)];
    g.loft(upper, { c, kind: o.kind ?? K.fur, seg: 9, sub: 2, cap: [0.5, 0.3] });
    g.loft(lower, { c: c2, kind: o.kind2 ?? o.kind ?? K.fur, seg: 8, sub: 2, cap: [0.3, 0.3] });
    const tc = o.toes ?? c2;
    g.ball(x, R * 0.72, pz + R * 0.8, R * 1.2, R * 0.72, R * 1.6, tc, o.kind2 ?? o.kind ?? K.fur, { seg: 0.7 });
    if (!g.hi) return;
    for (let t = 0; t < 4; t++) {
      const tx = x + (t - 1.5) * R * 0.6;
      const tz = pz + R * (2.25 - Math.abs(t - 1.5) * 0.3);
      g.ball(tx, R * 0.46, tz, R * 0.36, R * 0.42, R * 0.5, tc, o.kind2 ?? o.kind ?? K.fur, { seg: 0.5 });
      if (o.claws) g.spike([tx, R * 0.5, tz + R * 0.3], [tx, R * 0.08, tz + R * 1.15], R * 0.16, o.claws, K.horn);
    }
  });
}

const VERT = /* glsl */ `
attribute vec2 aMat;
attribute vec3 color;
attribute vec4 aRig;    // part, weight, per-part parameters
attribute vec3 aPivot;
attribute vec3 aPivot2;
attribute vec4 aAnim;   // stride phase, gait (0 still .. 2 gallop), graze (head down), seed
attribute vec2 aAnim2;  // head turned toward the visitor (radians), mood (0 .. 1 pleased)
uniform float uTime;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying vec2 vMat;
varying vec3 vOP;
varying float vSeed;

vec3 rX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 rZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }

void main() {
  vec3 p = position;
  vec3 n = normal;
  float part = aRig.x;
  float w = aRig.y;
  float ph = aAnim.x;
  float gait = aAnim.y;
  float graze = aAnim.z;
  float seed = aAnim.w;
  float run = clamp(gait - 1.0, 0.0, 1.0);
  float walk = min(gait, 1.0);

  if (part < 0.5) {
    // Breathing; faster after a run.
    p.x *= 1.0 + 0.016 * sin(uTime * mix(1.5, 5.0, run) + seed * 30.0);
  } else if (part < 4.5) {
    // Diagonal pairs swing together. The lower leg folds while the foot travels forward.
    float off = (part < 1.5 || part > 3.5) ? 0.0 : 3.14159;
    float fore = part < 2.5 ? 1.0 : -1.0;
    float a = sin(ph + off) * (walk * 0.5 + run * 0.4);
    float fold = max(0.0, -cos(ph + off)) * (walk * 0.6 + run * 0.7) * fore * w;
    p = aPivot2 + rX(p - aPivot2, fold);
    n = rX(n, fold);
    p = aPivot + rX(p - aPivot, a);
    n = rX(n, a);
  } else if (part < 5.5 || (part > 6.5 && part < 9.5)) {
    vec3 hp = aPivot;
    float hw = w;
    if (part > 6.5) {
      hp = aPivot2;
      hw = 1.0;
      vec3 q = p - aPivot;
      if (part < 7.5) {
        // Ears flick now and then and lie back at a run.
        float tw = pow(max(0.0, sin(uTime * 1.1 + seed * 50.0 + aRig.z * 1.7)), 24.0);
        float a = tw * 0.3 - run * 0.6;
        q = rZ(rX(q, a), -aRig.z * tw * 0.35);
        n = rZ(rX(n, a), -aRig.z * tw * 0.35);
      } else if (part < 8.5) {
        float chew = (0.5 + 0.5 * sin(uTime * 7.0 + seed * 20.0)) * (graze * 0.2 + aAnim2.y * 0.28 + run * 0.2);
        q = rX(q, chew);
        n = rX(n, chew);
      } else {
        q *= step(0.962, fract(uTime * 0.21 + seed * 9.0));
      }
      p = aPivot + q;
    }
    float amp = aRig.w;
    float nod = graze * amp + sin(uTime * 1.3 + seed * 9.0) * 0.05 * (1.0 - graze) + sin(ph * 2.0) * 0.04 * gait;
    nod += graze * sin(uTime * 4.0 + seed * 20.0) * 0.05;
    float yaw = (aAnim2.x + sin(uTime * 0.55 + seed * 30.0) * 0.14 * (1.0 - walk)) * (1.0 - graze * 0.8);
    vec3 q = rY(rX(p - hp, nod * hw), yaw * hw);
    n = rY(rX(n, nod * hw), yaw * hw);
    p = hp + q;
  } else if (part < 6.5) {
    // The tail swings from its root, the wave running down its length; it streams out at a run.
    float wag = aAnim2.y * aRig.z;
    float sway = sin(uTime * mix(2.2, 13.0, wag) + seed * 12.0 - w * 1.6) * aRig.w * (1.0 + wag * 1.6);
    vec3 q = rX(rY(p - aPivot, sway * w), run * 0.35 * w);
    n = rX(rY(n, sway * w), run * 0.35 * w);
    p = aPivot + q;
  } else {
    float flap = run * (0.45 + 0.55 * sin(uTime * 24.0 + seed * 9.0)) * 1.2;
    p = aPivot + rZ(p - aPivot, aRig.z * flap);
    n = rZ(n, aRig.z * flap);
  }
#ifdef HOP
  // Hares bound: the whole body arcs up and stretches out on each leap.
  float hop = max(0.0, sin(ph * 0.5));
  p.y += hop * 0.22 * min(gait, 1.6);
  p.z *= 1.0 + hop * 0.12 * min(gait, 1.5);
#else
  p.y += abs(sin(ph)) * 0.035 * gait;
#endif

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vCol = color;
  float kind = floor(aMat.x + 0.5);
#ifdef USE_INSTANCING_COLOR
  if (kind == 14.0 || kind == 20.0 || kind == 21.0 || kind == 22.0 || kind > 24.5 && kind < 27.5) vCol *= instanceColor;
#endif
  vMat = aMat;
  vOP = position;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
uniform float uFogK;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying vec2 vMat;
varying vec3 vOP;
varying float vSeed;

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 G = N;
  vec3 wp = vWP;
  vec3 V = normalize(cameraPosition - wp);
  vec3 L = uSunDir;
  float id = floor(vMat.x + 0.5);
  float rnd = vMat.y;
  vec3 col = vCol;
  vec3 emit = vec3(0.0);
  float spec = 0.0;
  float specPow = 40.0;
  float fuzz = 0.0;
  float wrap = 0.0;
  // Coordinates that stay on the animal as it moves.
  vec3 op = vOP;
  vec2 pc = op.zy + op.x * vec2(0.37, 0.21);
  float upper = smoothstep(-0.3, 0.3, G.y);

  if (id == 25.0) {
    // Pale spots along the back and flanks of some.
    vec2 g = pc * mix(6.0, 14.0, rnd);
    vec2 c = floor(g);
    vec2 f = fract(g) - 0.5 - (vec2(h21(c), h21(c + 7.3)) - 0.5) * 0.5;
    float s = smoothstep(0.24, 0.13, length(f)) * step(0.35, h21(c + 3.1)) * upper * step(0.4, fract(vSeed * 5.3));
    col = mix(col, vec3(0.96, 0.93, 0.86), s * 0.85);
  } else if (id == 26.0) {
    // Tabby bars.
    float bands = sin(op.z * mix(30.0, 80.0, rnd) + nz(pc * 0.9).a * 7.0 + op.y * 6.0);
    col *= mix(1.0, 0.5, smoothstep(0.2, 0.7, bands) * step(0.3, fract(vSeed * 7.1)) * upper);
  } else if (id == 27.0) {
    // Pied: broad white patches on some.
    float q = nz(pc * mix(0.2, 1.2, rnd) + vSeed * 17.0).g;
    col = mix(col, vec3(0.95, 0.93, 0.89), smoothstep(0.5, 0.54, q) * step(fract(vSeed * 3.7), 0.4));
  }

  if (id == 21.0) {
    // Wool: soft lumps, deep creases between the curls.
    float lump = nz(pc * 1.3).a;
    col *= mix(0.74, 1.08, smoothstep(0.25, 0.75, lump));
    N = normalize(N + (nz(pc * 1.7).rga - 0.5) * 0.8);
    fuzz = 0.9;
    wrap = 0.45;
  } else if (id == 22.0) {
    // Feathers: overlapping rows, each with a darker edge.
    float F = mix(18.0, 80.0, rnd);
    vec2 q = vec2((op.x + op.y * 0.5) * F * 0.8, (op.z - op.y * 0.35) * F);
    q.x += mod(floor(q.y), 2.0) * 0.5;
    float d = length(fract(q) - vec2(0.5, 0.35));
    col *= mix(1.07, 0.72, smoothstep(0.3, 0.56, d));
    spec = 0.22;
    specPow = 24.0;
    fuzz = 0.35;
    wrap = 0.2;
  } else if (id == 14.0 || id == 20.0 || id > 23.5 && id < 27.5) {
    // Fur: clumps, a fine grain of hairs, and a soft halo where the light skims it.
    col *= mix(0.84, 1.08, nz(pc * 2.2).a) * mix(0.92, 1.06, nz(pc * 9.0 + 0.3).a);
    N = normalize(N + (nz(pc * 6.0).rga - 0.5) * 0.38);
    fuzz = 0.6;
    wrap = 0.3;
  } else if (id == 23.0) {
    fuzz = 0.2;
    spec = 0.12;
  } else if (id == 30.0) {
    spec = 1.6;
    specPow = 140.0;
    float c = pow(max(dot(reflect(-V, N), normalize(vec3(0.25, 0.85, 0.3))), 0.0), 30.0);
    emit += (uAmbient + uSunColor * 0.3) * c * 0.7;
  } else if (id == 31.0) {
    spec = 0.8;
    specPow = 70.0;
  } else if (id == 32.0) {
    // Growth rings.
    col *= 0.84 + 0.16 * smoothstep(0.3, 0.5, abs(fract(dot(op, vec3(0.0, 1.0, 0.6)) * mix(14.0, 60.0, rnd)) - 0.5));
    spec = 0.22;
  } else if (id == 33.0) {
    spec = 0.4;
    specPow = 50.0;
  } else if (id == 34.0) {
    spec = 0.35;
  } else if (id == 35.0) {
    col = vec3(1.0);
    emit += uAmbient * 0.6;
  } else if (id == 5.0) {
    col *= 0.7;
    emit += vCol * (0.25 + 3.2 * uLights);
  } else if (id == 6.0) {
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + rnd * 6.28 + wp.y * 0.3);
    col = vCol * 0.55;
    emit += vCol * (0.25 + 0.9 * fres + 0.9 * uLights) * pulse;
    emit += uSunColor * pow(max(dot(reflect(-V, N), L), 0.0), 60.0) * 1.5;
    spec = 1.4;
    specPow = 90.0;
  } else if (id == 7.0) {
    spec = 0.8;
    specPow = 60.0;
  } else if (id == 10.0) {
    float pulse = 0.6 + 0.4 * sin(uTime * 2.0 + rnd * 6.28);
    col *= 0.4;
    emit += vCol * (0.6 + 2.0 * uLights + 0.6 * pulse);
  }

  float above = wp.y - terrainHeight(wp.xz);
  float diff = smoothstep(-0.05 - wrap, 0.45 + wrap * 0.4, dot(N, L));
  // Darker underneath and where the legs meet the grass.
  float ao = mix(0.62, 1.0, smoothstep(0.0, 0.4, above)) * mix(0.7, 1.0, smoothstep(-0.95, 0.1, G.y));
  float sh = sunShadow(wp + G * 0.08);
  diff *= smoothstep(0.48, 1.0, sh);
  float sunUp = max(L.y + 0.15, 0.0);
  vec3 light = uAmbient * (0.72 + 0.28 * N.y) * ao * mix(0.85, 1.0, sh) + uSunColor * (0.12 + 0.88 * diff) * sunUp * 1.05;
  vec3 albedo = col;
  col *= light * cloudShadowAt(wp.xz);
  vec3 H = normalize(L + V);
  col += uSunColor * spec * pow(max(dot(N, H), 0.0), specPow) * diff;
  float rim = pow(1.0 - max(dot(G, V), 0.0), 3.0);
  float back = pow(max(dot(-V, L), 0.0), 2.0);
  col += mix(vec3(1.0), albedo, 0.65) * rim * fuzz * (uAmbient * 0.3 * ao + uSunColor * (0.18 + 0.7 * back) * sunUp * mix(0.3, 1.0, sh));
  col += emit;

  col = applyFogK(col, wp, uFogK);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The shared material of the animals; `hop` makes the whole body bound (hares, squirrels). */
export function creatureMaterial(hop = false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...U, uFogK: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: hop ? { HOP: '' } : {},
  });
}
