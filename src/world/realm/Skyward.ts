import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { U } from '../../core/uniforms';
import { COMMON_GLSL } from '../common';
import { Builder, M } from './geom';
import { mulberry32, range, type Rng } from './rand';
import type { TreeSpot } from './Forest';
import { buildIsland } from './Island';
import { structureMaterial } from './Structures';

/** Flat-shaded jagged slab: an irregular disc of radius ~R, `thick` deep, top at y=0. */
function slab(R: number, thick: number, segs: number, r: Rng, jag: number, dome = 0): BufferGeometry {
  const ring: [number, number][] = [];
  const ph = r() * 10;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const k = 1 + jag * (Math.sin(a * 3 + ph) * 0.5 + Math.sin(a * 7 - ph * 2) * 0.3 + (r() - 0.5) * 0.6);
    ring.push([Math.cos(a) * R * k, Math.sin(a) * R * k]);
  }
  const p: number[] = [];
  const top = (x: number, z: number) => dome * R * (1 - Math.min(1, Math.hypot(x, z) / R) ** 2);
  for (let i = 0; i < segs; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % segs];
    p.push(0, dome * R, 0, x1, top(x1, z1), z1, x0, top(x0, z0), z0);
    p.push(x0, top(x0, z0), z0, x1, top(x1, z1), z1, x1, -thick, z1, x0, top(x0, z0), z0, x1, -thick, z1, x0, -thick, z0);
    p.push(0, -thick, 0, x0, -thick, z0, x1, -thick, z1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

/** The rocky root under a floating island: rings shrinking and wandering down to a point. */
function rockRoot(R: number, H: number, segs: number, r: Rng): BufferGeometry {
  const rings = 6;
  const pts: [number, number, number][][] = [];
  let ox = 0;
  let oz = 0;
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const rr = R * Math.pow(1 - t, 0.8) * (k === 0 ? 1 : 0.95);
    ox += (r() - 0.5) * R * 0.15 * t;
    oz += (r() - 0.5) * R * 0.15 * t;
    const row: [number, number, number][] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const j = k === 0 ? 1 : 1 + (r() - 0.5) * 0.45;
      row.push([ox + Math.cos(a) * rr * j, -t * H * (k === 0 ? 0 : 1 + (r() - 0.5) * 0.12), oz + Math.sin(a) * rr * j]);
    }
    pts.push(row);
  }
  const p: number[] = [];
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < segs; i++) {
      const a = pts[k][i];
      const b = pts[k][(i + 1) % segs];
      const c = pts[k + 1][i];
      const d = pts[k + 1][(i + 1) % segs];
      p.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

const FALL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWP;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FALL_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform float uHaze;
varying vec2 vUv;
varying vec3 vWP;
void main() {
  float v = 1.0 - vUv.y;
  float u = vUv.x;
  float s1 = nz(vec2(u * 2.3, v * 1.4 - uTime * 0.55)).a;
  float s2 = nz(vec2(u * 5.1 + 0.3, v * 3.2 - uTime * 0.9)).g;
  float streak = smoothstep(0.35, 0.8, s1 * 0.6 + s2 * 0.5);
  float edge = smoothstep(0.0, 0.18, u) * smoothstep(1.0, 0.82, u);
  float fade = 1.0 - smoothstep(0.45, 1.0, v);
  float a = (0.25 + 0.75 * streak) * edge * fade * mix(1.0, 0.55, smoothstep(0.2, 1.0, v));
  vec3 col = vec3(0.9, 0.95, 1.0) * (uAmbient * 1.2 + uSunColor * 0.8 * max(uSunDir.y + 0.15, 0.0));
  col = applyFogK(col, vWP, 0.5);
  col = mix(col, fogColorFor(normalize(vWP - cameraPosition)), uHaze);
  gl_FragColor = vec4(col, a * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function waterfall(width: number, height: number, haze: number): Mesh {
  const g = new PlaneGeometry(1, 1, 1, 12);
  const pos = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i); // 0.5 top .. -0.5 bottom
    const t = 0.5 - y;
    // Spreads and curls outward as it falls.
    pos.setXYZ(i, x * width * (1 + t * 1.6), -t * height, t * t * height * 0.08);
  }
  const m = new ShaderMaterial({
    uniforms: { ...U, uHaze: { value: haze } },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(g, m);
  mesh.renderOrder = 2;
  return mesh;
}

interface Island {
  x: number;
  y: number;
  z: number;
  R: number;
  seed: number;
  fall: number;
  shrine?: boolean;
}

export const ISLANDS: Island[] = [
  { x: 260, y: 150, z: -760, R: 42, seed: 11, fall: 1 },
  { x: -980, y: 230, z: -160, R: 64, seed: 23, fall: 2 },
  { x: 760, y: 190, z: 330, R: 36, seed: 37, fall: 1 },
  { x: -120, y: 290, z: 980, R: 80, seed: 41, fall: 2, shrine: true },
  { x: -1250, y: 340, z: 980, R: 52, seed: 53, fall: 1 },
  { x: 120, y: 120, z: 160, R: 18, seed: 67, fall: 0 },
  { x: -700, y: 420, z: -1100, R: 70, seed: 71, fall: 1 },
];

export const CASTLE = { x: -320, z: 2650, bottom: 640, top: 1300, R: 340 };

/**
 * Up in the sky: the floating castle, a stack of inhabited tiers held by pillars with a
 * spire at its crown, and smaller grassy islands drifting closer in, shedding waterfalls.
 */
export class Sky {
  readonly group = new Group();
  private readonly drifters: { obj: Group; y: number; amp: number; ph: number; spin: number }[] = [];
  /** Trees standing on the islands (planted by the forest, at absolute heights). */
  readonly treeSpots: TreeSpot[] = [];
  /** Where the sky shrine stands (world space). */
  shrine: Vector3 | null = null;

  constructor() {
    this.group.add(this.buildCastle());
    for (const isl of ISLANDS) {
      const built = buildIsland(isl);
      this.group.add(built.group);
      this.treeSpots.push(...built.trees);
      if (built.shrine) this.shrine = built.shrine;
      // Waterfalls over the lip.
      const r = mulberry32(isl.seed * 31);
      for (let i = 0; i < isl.fall; i++) {
        const a = r() * Math.PI * 2;
        const e = built.rim(a) * 0.97;
        const f = waterfall(range(r, 1.5, 3.2) * (isl.R / 40), isl.R * range(r, 3, 4.5), 0.05);
        f.position.set(Math.cos(a) * e, 0.2, Math.sin(a) * e);
        f.rotation.y = -a + Math.PI / 2;
        built.group.add(f);
      }
    }
  }

  private buildCastle(): Group {
    const r = mulberry32(0xa1c4);
    const g = new Group();
    const b = new Builder();
    const N = 21;
    const H = CASTLE.top - CASTLE.bottom;
    const tierH = H / N;
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const radiusAt = (t: number) => CASTLE.R * (0.62 + 0.38 * smooth(Math.min(1, t / 0.22))) * Math.pow(1 - 0.88 * t, 0.75);
    const id = new Matrix4();
    void id;
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1);
      const R = radiusAt(t);
      const y = CASTLE.bottom + k * tierH;
      const thick = 7 + r() * 3;
      const sl = slab(R, thick, 56, r, 0.07);
      const m = new Matrix4().makeTranslation(0, y, 0);
      // The tier: stone rim, a green landscape on top.
      const tm = new Matrix4().makeTranslation(0, y, 0);
      b.geometry(sl, m, '#9aa2b0', M.hull, r());
      const turf = slab(R * 0.93, 0.5, 40, r, 0.05, 0.004);
      b.geometry(turf, tm.clone().multiply(new Matrix4().makeTranslation(0, 0.6, 0)), '#6a9a50', M.turf, r());
      sl.dispose();
      turf.dispose();
      if (k === N - 1) break;
      // Pillars up to the next tier around the rim.
      const nextR = radiusAt((k + 1) / (N - 1));
      const pr = Math.min(R, nextR) * 0.9;
      const np = Math.max(8, Math.round((pr * Math.PI * 2) / 38));
      for (let i = 0; i < np; i++) {
        const a = (i / np) * Math.PI * 2 + k * 0.17;
        b.box(Math.cos(a) * pr, y, Math.sin(a) * pr, 5, tierH - thick + 0.5, 5, -a, '#a4acb8', M.hull, r());
      }
      // Towns, towers and woods on the tier.
      const nb = Math.round(R / 9);
      for (let i = 0; i < nb; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * R * 0.82;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (Math.hypot(x, z) > pr - 8 || Math.hypot(x, z) < R * 0.15) continue;
        const kind = r();
        const roomH = Math.min(tierH - thick - 3, 22);
        if (kind < 0.55) b.box(x, y + 0.5, z, range(r, 6, 16), range(r, 4, roomH * 0.7), range(r, 6, 16), r() * 6, '#c8c4bc', M.hull, r());
        else if (kind < 0.7) b.cyl(x, y + 0.5, z, range(r, 3, 6), range(r, 8, roomH), '#c0bcb4', M.hull, 12, r());
        else b.blob(x, y + 5, z, range(r, 6, 12), range(r, 4, 8), range(r, 6, 12), r() * 6, '#4f8a3c', M.foliage, r());
      }
      // The core shaft through the middle.
      b.cyl(0, y, 0, R * 0.16 + 6, tierH, '#8a92a0', M.hull, 20, r());
    }
    // The root of rock under the bottom tier.
    const root = rockRoot(radiusAt(0) * 0.95, 260, 40, r);
    b.geometry(root, new Matrix4().makeTranslation(0, CASTLE.bottom - 8, 0), '#7a7672', M.rock, 0.5);
    root.dispose();
    // The crown spire.
    const ty = CASTLE.top;
    b.cyl(0, ty, 0, 22, 70, '#b8bcc6', M.hull, 20, 0.4);
    b.cyl(0, ty + 70, 0, 26, 6, '#a4acb8', M.hull, 20, 0.4);
    b.cyl(0, ty + 76, 0, 14, 60, '#c0c4cc', M.hull, 20, 0.6);
    b.cone(0, ty + 136, 0, 16, 80, '#3a5578', M.roof, 12, 0.3);
    b.gem(0, ty + 236, 0, 7, 16, 7, 0, '#9ff0ff', M.rune, 0.2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.cyl(Math.cos(a) * 34, ty, Math.sin(a) * 34, 7, 46, '#b8bcc6', M.hull, 12, r());
      b.cone(Math.cos(a) * 34, ty + 46, Math.sin(a) * 34, 9, 30, '#3a5578', M.roof, 12, r());
    }
    const mat = structureMaterial({ haze: 0.14, groundAO: false, sway: 0, fog: 0.5 });
    const mesh = new Mesh(b.build(), mat);
    mesh.frustumCulled = false;
    g.add(mesh);
    // Long threads of water spilling from the lower tiers into the void.
    for (let i = 0; i < 5; i++) {
      const k = 1 + Math.floor(r() * 7);
      const t = k / (N - 1);
      const R = radiusAt(t) * 0.97;
      const a = r() * Math.PI * 2;
      const f = waterfall(range(r, 4, 9), range(r, 300, 520), 0.3);
      f.position.set(Math.cos(a) * R, CASTLE.bottom + k * tierH + 0.3, Math.sin(a) * R);
      f.rotation.y = -a + Math.PI / 2;
      g.add(f);
    }
    g.position.set(CASTLE.x, 0, CASTLE.z);
    this.drifters.push({ obj: g, y: 0, amp: 4, ph: 0, spin: 0.0012 });
    return g;
  }

  update(_dt: number, time: number): void {
    for (const d of this.drifters) {
      d.obj.position.y = d.y + Math.sin(time * 0.07 + d.ph) * d.amp;
      if (d.spin) d.obj.rotation.y = time * d.spin;
    }
  }
}
