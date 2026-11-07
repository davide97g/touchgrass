import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';

/** Surface kinds understood by the structure shader (see Structures.ts). */
export const M = {
  stone: 0,
  plaster: 1,
  wood: 2,
  roof: 3,
  window: 4,
  lamp: 5,
  crystal: 6,
  metal: 7,
  rock: 8,
  turf: 9,
  rune: 10,
  hull: 11,
  paving: 12,
  foliage: 13,
  cloth: 14,
  snow: 15,
} as const;

const unit = {
  box: flat(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  cyl8: flat(new CylinderGeometry(1, 1, 1, 8, 1).translate(0, 0.5, 0)),
  cyl12: flat(new CylinderGeometry(1, 1, 1, 12, 1).translate(0, 0.5, 0)),
  cyl20: flat(new CylinderGeometry(1, 1, 1, 20, 1).translate(0, 0.5, 0)),
  cone8: flat(new ConeGeometry(1, 1, 8, 1).translate(0, 0.5, 0)),
  cone12: flat(new ConeGeometry(1, 1, 12, 1).translate(0, 0.5, 0)),
  cone6: flat(new ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0)),
  ico1: flat(new IcosahedronGeometry(1, 1)),
  ico0: flat(new IcosahedronGeometry(1, 0)),
  oct: flat(new OctahedronGeometry(1, 0)),
  sphere: flat(new SphereGeometry(1, 10, 7)),
};

function flat(g: BufferGeometry): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  return n;
}

/** A gable roof (slopes + soffit, open ends): ridge along local X, eaves at y=0, width w (x), depth d (z), height h. */
function gableGeometry(): BufferGeometry {
  const v = [
    // two slopes
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    // underside
    -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, 0.5,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}
const gable = gableGeometry();

/** Closed triangular prism (gable wall infill, ridge along X). */
function prismGeometry(): BufferGeometry {
  const g = gableGeometry();
  const p = Array.from(g.getAttribute('position').array as Float32Array);
  p.push(0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0);
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  out.computeVertexNormals();
  return out;
}
const prism = prismGeometry();

/** Hip-less pyramid (four slopes) for towers. */
const pyramid = flat(new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));
const torus = flat(new TorusGeometry(1, 0.08, 6, 48));

/** Hexagonal crystal: a prism with a pointed cap, base below y=0 so it pushes out of the ground. */
function crystalGeometry(): BufferGeometry {
  const body = new CylinderGeometry(1, 0.85, 0.78, 6, 1).translate(0, 0.39 - 0.12, 0);
  const cap = new ConeGeometry(1, 0.34, 6, 1).translate(0, 0.78 - 0.12 + 0.17, 0);
  const a = flat(body);
  const b = flat(cap);
  const pa = a.getAttribute('position').array as Float32Array;
  const pb = b.getAttribute('position').array as Float32Array;
  const g = new BufferGeometry();
  const p = new Float32Array(pa.length + pb.length);
  p.set(pa);
  p.set(pb, pa.length);
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
const crystal = crystalGeometry();

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();
const tmpV = new Vector3();
const tmpN = new Matrix3();
const Y = new Vector3(0, 1, 0);
const col = new Color();

/**
 * Accumulates flat-shaded parts into one big buffer: position, normal, albedo (linear) and
 * surface kind + a per-part random value the shader uses for variation (lit windows, tile tones).
 */
export class Builder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private colr: number[] = [];
  private mat: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  add(g: BufferGeometry, m: Matrix4, color: number | string | Color, kind: number, rnd = 0.5): void {
    const p = g.getAttribute('position') as BufferAttribute;
    const n = g.getAttribute('normal') as BufferAttribute;
    tmpN.getNormalMatrix(m);
    if (color instanceof Color) col.copy(color);
    else col.set(color);
    for (let i = 0; i < p.count; i++) {
      tmpV.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      tmpV.fromBufferAttribute(n, i).applyMatrix3(tmpN).normalize();
      this.nrm.push(tmpV.x, tmpV.y, tmpV.z);
      this.colr.push(col.r, col.g, col.b);
      this.mat.push(kind, rnd);
    }
  }

  /** Append a geometry built by another Builder (keeps its colours and kinds). */
  addRaw(g: BufferGeometry): void {
    const push = (dst: number[], name: string) => {
      const a = g.getAttribute(name).array as Float32Array;
      for (let i = 0; i < a.length; i++) dst.push(a[i]);
    };
    push(this.pos, 'position');
    push(this.nrm, 'normal');
    push(this.colr, 'color');
    push(this.mat, 'aMat');
  }

  private place(g: BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number, color: number | string | Color, kind: number, rnd?: number, tilt?: Quaternion): void {
    tmpQ.setFromAxisAngle(Y, rotY);
    if (tilt) tmpQ.multiply(tilt);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    this.add(g, tmpM, color, kind, rnd);
  }

  /** Box standing on (x, y, z): w along local X, d along local Z. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, rotY: number, color: number | string | Color, kind: number, rnd?: number, tilt?: Quaternion): void {
    this.place(unit.box, x, y, z, w, h, d, rotY, color, kind, rnd, tilt);
  }

  cyl(x: number, y: number, z: number, r: number, h: number, color: number | string | Color, kind: number, seg: 8 | 12 | 20 = 12, rnd?: number, tilt?: Quaternion): void {
    const g = seg === 8 ? unit.cyl8 : seg === 12 ? unit.cyl12 : unit.cyl20;
    this.place(g, x, y, z, r, h, r, 0, color, kind, rnd, tilt);
  }

  /** Cylinder with different top and bottom radius. */
  frustum(x: number, y: number, z: number, rBot: number, rTop: number, h: number, color: number | string | Color, kind: number, seg = 12, rnd?: number, rotY = 0): void {
    const g = flat(new CylinderGeometry(rTop, rBot, h, seg, 1).translate(0, h / 2, 0));
    tmpQ.setFromAxisAngle(Y, rotY);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
    this.add(g, tmpM, color, kind, rnd);
    g.dispose();
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: number | string | Color, kind: number, seg: 6 | 8 | 12 = 12, rnd?: number, rotY = 0): void {
    const g = seg === 6 ? unit.cone6 : seg === 8 ? unit.cone8 : unit.cone12;
    this.place(g, x, y, z, r, h, r, rotY, color, kind, rnd);
  }

  pyramid(x: number, y: number, z: number, w: number, h: number, d: number, rotY: number, color: number | string | Color, kind: number, rnd?: number): void {
    this.place(pyramid, x, y, z, w, h, d, rotY, color, kind, rnd);
  }

  /** Gable roof: ridge along local X. */
  gable(x: number, y: number, z: number, w: number, h: number, d: number, rotY: number, color: number | string | Color, kind: number, rnd?: number): void {
    this.place(gable, x, y, z, w, h, d, rotY, color, kind, rnd);
  }

  /** Closed triangular prism, ridge along local X. */
  prism(x: number, y: number, z: number, w: number, h: number, d: number, rotY: number, color: number | string | Color, kind: number, rnd?: number): void {
    this.place(prism, x, y, z, w, h, d, rotY, color, kind, rnd);
  }

  blob(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number, color: number | string | Color, kind: number, rnd?: number, smooth = false): void {
    this.place(smooth ? unit.sphere : unit.ico1, x, y, z, sx, sy, sz, rotY, color, kind, rnd);
  }

  gem(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number, color: number | string | Color, kind: number, rnd?: number, tilt?: Quaternion): void {
    this.place(unit.oct, x, y, z, sx, sy, sz, rotY, color, kind, rnd, tilt);
  }

  /** Hex crystal, w wide and h tall, leaning by `tilt`. */
  crystal(x: number, y: number, z: number, w: number, h: number, rotY: number, color: number | string | Color, rnd?: number, tilt?: Quaternion): void {
    this.place(crystal, x, y, z, w, h, w, rotY, color, M.crystal, rnd, tilt);
  }

  ring(x: number, y: number, z: number, r: number, thick: number, rotY: number, tiltX: number, color: number | string | Color, kind: number, rnd?: number): void {
    const t = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tiltX);
    this.place(torus, x, y, z, r, r, thick, rotY, color, kind, rnd, t);
  }

  /** Arbitrary geometry with a full transform. */
  geometry(g: BufferGeometry, m: Matrix4, color: number | string | Color, kind: number, rnd?: number): void {
    this.add(g.index ? flat(g) : g, m, color, kind, rnd);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colr), 3));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.mat), 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Tilt quaternion helper: lean by `amount` radians toward heading `dir`. */
export function lean(dir: number, amount: number): Quaternion {
  const axis = new Vector3(Math.cos(dir), 0, -Math.sin(dir));
  return new Quaternion().setFromAxisAngle(axis, amount);
}
