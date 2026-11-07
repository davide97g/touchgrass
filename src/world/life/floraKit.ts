import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

/**
 * A tiny mesh kit for close-up flowers: petals as bent, cupped, twisted strips; stems as tubes
 * along curves; bells and trumpets as lathed profiles; little spheres for stamens and florets.
 * Every vertex carries what the flower shader needs:
 *   aUv   u along the part (0 base .. 1 tip), v across (-1 .. 1)
 *   aInfo x glow, y pattern, z random, w translucency
 *   aOpen xyz petal pivot, w extra closing angle (radians) applied when the bloom shuts
 *   aAxis hinge axis for opening
 */

export type RGB = [number, number, number];

export const PAT = {
  plain: 0,
  wool: 1,
  checker: 2,
  spots: 3,
  veins: 4,
  crystal: 5,
  wax: 6,
  leaf: 7,
  stem: 8,
  clover: 9,
  silk: 10,
} as const;

export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  // sRGB -> linear, so colours match the rest of the realm's shaders.
  const f = (c: number) => Math.pow(c / 255, 2.2);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface PartOpts {
  glow?: number;
  pattern?: number;
  /** 0 opaque .. 1 thin and backlit. */
  thin?: number;
  /** Petal hinge: when set, the part folds by `angle` around `axis` through `pivot` as the bloom closes. */
  hinge?: { pivot: Vector3; axis: Vector3; angle: number };
  rnd?: number;
}

export interface PetalOpts extends PartOpts {
  /** Base point. */
  at: Vector3;
  /** Horizontal azimuth the petal points to (radians). */
  az: number;
  /** Elevation of the petal at its base (radians; + up, - down). */
  elev: number;
  len: number;
  /** Half width at the widest point. */
  wid: number;
  /** Bend along the length (radians over the whole petal; + curls up, - recurves down). */
  curl?: number;
  /** Twist about the petal's own axis (radians at the tip). */
  twist?: number;
  /** Cross-section cupping (fraction of width the edges lift). */
  cup?: number;
  /** Width profile, u 0..1 -> 0..1. */
  shape?: (u: number) => number;
  /** Wavy margin amplitude (fraction of width). */
  ruffle?: number;
  color: (u: number, v: number) => RGB;
  nu?: number;
  nv?: number;
}

export const SHAPES = {
  /** Narrow at both ends, widest past the middle. */
  ellipse: (u: number) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.04)), 0.8),
  /** Widest near the tip (spoon). */
  spoon: (u: number) => Math.pow(u, 0.6) * Math.pow(Math.max(0, 1 - Math.pow(u, 4)), 0.4),
  /** Lance: widest near the base, long point. */
  lance: (u: number) => Math.pow(Math.min(1, u * 4), 0.6) * Math.pow(1 - u, 0.9),
  /** Broad, round (poppy, clover). */
  round: (u: number) => Math.sqrt(Math.max(0, 1 - Math.pow(u * 2 - 1, 2))) * (0.35 + 0.65 * Math.min(1, u * 1.6)),
  /** Strap: long, even width, pointed tip. */
  strap: (u: number) => Math.min(1, u * 8) * Math.pow(Math.max(0, 1 - Math.pow(u, 6)), 0.5),
  /** Heart (clover leaflet): broad at the tip. */
  heart: (u: number) => Math.pow(u, 0.5) * Math.pow(Math.max(0, 1 - Math.pow(u, 3)), 0.25) * 1.05,
};

const tmpA = new Vector3();
const tmpB = new Vector3();

export class FloraBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private info: number[] = [];
  private open: number[] = [];
  private axis: number[] = [];
  private idx: number[] = [];

  private vert(p: Vector3, n: Vector3, c: RGB, u: number, v: number, o: PartOpts): void {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, v);
    this.info.push(o.glow ?? 0, o.pattern ?? 0, o.rnd ?? Math.random(), o.thin ?? 0.5);
    const h = o.hinge;
    if (h) {
      this.open.push(h.pivot.x, h.pivot.y, h.pivot.z, h.angle);
      this.axis.push(h.axis.x, h.axis.y, h.axis.z);
    } else {
      this.open.push(0, 0, 0, 0);
      this.axis.push(1, 0, 0);
    }
  }

  /** A grid of points (rows along u, columns across v); normals from neighbours. */
  grid(P: Vector3[][], color: (u: number, v: number) => RGB, o: PartOpts, flipU = false): void {
    const nu = P.length - 1;
    const nv = P[0].length - 1;
    const base = this.pos.length / 3;
    const n = new Vector3();
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const du = tmpA.subVectors(P[Math.min(nu, i + 1)][j], P[Math.max(0, i - 1)][j]);
        const dv = tmpB.subVectors(P[i][Math.min(nv, j + 1)], P[i][Math.max(0, j - 1)]);
        n.crossVectors(dv, du);
        if (n.lengthSq() < 1e-14) n.set(0, 1, 0);
        n.normalize();
        if (flipU) n.negate();
        const u = i / nu;
        const v = (j / nv) * 2 - 1;
        this.vert(P[i][j], n, color(u, v), u, v, o);
      }
    }
    const w = nv + 1;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = base + i * w + j;
        this.idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
      }
    }
  }

  /** A petal or leaf: a strip bent along its length, cupped across, twisted. */
  petal(o: PetalOpts): void {
    const nu = o.nu ?? 9;
    const nv = o.nv ?? 4;
    const shape = o.shape ?? SHAPES.ellipse;
    const out = new Vector3(Math.cos(o.az), 0, Math.sin(o.az));
    const side = new Vector3(-Math.sin(o.az), 0, Math.cos(o.az));
    const up = new Vector3(0, 1, 0);
    const P: Vector3[][] = [];
    const c = new Vector3().copy(o.at);
    const step = o.len / nu;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const th = o.elev + (o.curl ?? 0) * u;
      const dir = new Vector3().addScaledVector(out, Math.cos(th)).addScaledVector(up, Math.sin(th));
      // Petal normal (facing "up" off the petal surface) and the twisted side axis.
      const pn = new Vector3().crossVectors(side, dir).normalize();
      const tw = (o.twist ?? 0) * u;
      const sd = new Vector3().copy(side).multiplyScalar(Math.cos(tw)).addScaledVector(pn, Math.sin(tw));
      const nn = new Vector3().crossVectors(sd, dir).normalize();
      const w = Math.max(0.0004, shape(u) * o.wid);
      const row: Vector3[] = [];
      for (let j = 0; j <= nv; j++) {
        const v = (j / nv) * 2 - 1;
        const ruf = (o.ruffle ?? 0) * Math.sin(v * 5.5 + u * 9 + (o.rnd ?? 0) * 20) * u * w;
        const lift = (o.cup ?? 0) * v * v * w + ruf;
        row.push(new Vector3().copy(c).addScaledVector(sd, v * w).addScaledVector(nn, lift));
      }
      P.push(row);
      if (i < nu) c.addScaledVector(dir, step);
    }
    // Two-sided: one sheet; the shader lights both faces.
    this.grid(P, o.color, o);
  }

  /** Tube along a polyline (stems, pedicels, stamens). */
  tube(pts: Vector3[], radius: (t: number) => number, color: (t: number) => RGB, o: PartOpts = {}, seg = 6): void {
    const P: Vector3[][] = [];
    const n = pts.length;
    let prevSide = new Vector3(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const d = new Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      let s = new Vector3().crossVectors(d, new Vector3(0, 0, 1));
      if (s.lengthSq() < 1e-6) s = new Vector3().crossVectors(d, new Vector3(1, 0, 0));
      s.normalize();
      if (s.dot(prevSide) < 0) s.negate();
      prevSide = s;
      const b = new Vector3().crossVectors(d, s).normalize();
      const r = radius(t);
      const ring: Vector3[] = [];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        ring.push(new Vector3().copy(pts[i]).addScaledVector(s, Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r));
      }
      P.push(ring);
    }
    this.grid(P, (u) => color(u), { pattern: PAT.stem, thin: 0.25, ...o });
  }

  /** Lathe: a profile (radius, height) turned around an axis through `at`, pointing along `dir`. */
  lathe(at: Vector3, dir: Vector3, profile: [number, number][], color: (u: number, a: number) => RGB, o: PartOpts = {}, seg = 14, lobes = 0, lobeAmp = 0): void {
    const d = dir.clone().normalize();
    let s = new Vector3().crossVectors(d, new Vector3(0, 0, 1));
    if (s.lengthSq() < 1e-6) s = new Vector3().crossVectors(d, new Vector3(1, 0, 0));
    s.normalize();
    const b = new Vector3().crossVectors(d, s).normalize();
    const P: Vector3[][] = [];
    profile.forEach(([r, h], i) => {
      const u = i / (profile.length - 1);
      const ring: Vector3[] = [];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const rr = r * (1 + (lobes ? lobeAmp * u * u * Math.cos(a * lobes) : 0));
        ring.push(new Vector3().copy(at).addScaledVector(d, h).addScaledVector(s, Math.cos(a) * rr).addScaledVector(b, Math.sin(a) * rr));
      }
      P.push(ring);
    });
    this.grid(P, (u, v) => color(u, (v + 1) / 2), o);
  }

  /** A small sphere (stamen tips, florets, pouches). */
  ball(at: Vector3, rx: number, ry: number, rz: number, color: (u: number) => RGB, o: PartOpts = {}, seg = 8): void {
    const P: Vector3[][] = [];
    const rings = Math.max(4, Math.round(seg * 0.6));
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI;
      const ring: Vector3[] = [];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        ring.push(new Vector3(at.x + Math.sin(th) * Math.cos(a) * rx, at.y - Math.cos(th) * ry, at.z + Math.sin(th) * Math.sin(a) * rz));
      }
      P.push(ring);
    }
    this.grid(P, (u) => color(u), o, true);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aUv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aInfo', new BufferAttribute(new Float32Array(this.info), 4));
    g.setAttribute('aOpen', new BufferAttribute(new Float32Array(this.open), 4));
    g.setAttribute('aAxis', new BufferAttribute(new Float32Array(this.axis), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Points along a curve from `a` rising to height h, bending over by `bend` toward azimuth `az`. */
export function stemCurve(a: Vector3, h: number, bend: number, az: number, n = 8): Vector3[] {
  const out: Vector3[] = [];
  const dx = Math.cos(az);
  const dz = Math.sin(az);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Integrate a direction that tilts from up toward (dx, dz) and beyond.
    let x = 0;
    let y = 0;
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      const tt = ((k + 0.5) / steps) * t;
      const aa = bend * tt * tt;
      x += Math.sin(aa) * (t / steps) * h;
      y += Math.cos(aa) * (t / steps) * h;
    }
    out.push(new Vector3(a.x + dx * x, a.y + y, a.z + dz * x));
  }
  return out;
}
