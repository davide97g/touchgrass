import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { U } from '../../core/uniforms';
import { COMMON_GLSL } from '../common';
import type { SpeciesName } from '../flora/Arbor';
import { Builder, M } from './geom';
import { mulberry32, range, type Rng } from './rand';
import { structureMaterial } from './Structures';

/**
 * A floating island built like a piece of torn-out land: a softly domed meadow with an
 * irregular lip, a deep body of layered rock narrowing into stalactites, roots and creepers
 * hanging from the rim, real grass along the edge and real trees on top.
 */

export interface IslandSpec {
  x: number;
  y: number;
  z: number;
  R: number;
  seed: number;
}

/** Island outline radius at an angle, and the meadow height at a local point. */
function shape(R: number, seed: number) {
  const ph = seed * 1.37;
  const edge = (a: number) =>
    R * (1 + 0.12 * Math.sin(a * 3 + ph) + 0.07 * Math.sin(a * 7 - ph * 2) + 0.035 * Math.sin(a * 13 + ph * 3));
  const top = (x: number, z: number) => {
    const d = Math.hypot(x, z) / edge(Math.atan2(z, x));
    const dome = 0.07 * R * (1 - Math.min(1, d) ** 2);
    const bumps = 0.6 * Math.sin(x * 0.11 + ph) * Math.sin(z * 0.13 - ph) + 0.3 * Math.sin(x * 0.31 - z * 0.27 + ph);
    return dome + bumps * Math.min(1, R / 40) - Math.max(0, d - 0.9) * 6;
  };
  return { edge, top };
}

function geo(pos: number[], col: number[], kind: number[], idx?: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aMat', new BufferAttribute(new Float32Array(kind), 2));
  if (idx) g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Meadow top + layered rock body as one smooth mesh. */
function body(R: number, seed: number, r: Rng): BufferGeometry {
  const { edge, top } = shape(R, seed);
  const segs = 72;
  const rings = 10;
  const pos: number[] = [];
  const col: number[] = [];
  const mat: number[] = [];
  const idx: number[] = [];
  const turf = new Color('#7a6a52');
  const rock = new Color('#aaa294');
  // Top: centre + rings.
  pos.push(0, top(0, 0), 0);
  col.push(turf.r, turf.g, turf.b);
  mat.push(M.turf, 0.5);
  for (let k = 1; k <= rings; k++) {
    const t = k / rings;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const e = edge(a) * t;
      const x = Math.cos(a) * e;
      const z = Math.sin(a) * e;
      pos.push(x, top(x, z), z);
      col.push(turf.r, turf.g, turf.b);
      mat.push(M.turf, 0.5);
    }
  }
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    idx.push(0, 1 + j, 1 + i);
  }
  for (let k = 1; k < rings; k++) {
    const a0 = 1 + (k - 1) * segs;
    const a1 = 1 + k * segs;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      idx.push(a0 + i, a1 + j, a1 + i, a0 + i, a0 + j, a1 + j);
    }
  }
  // Rock body: rings descending, shrinking, with ledges (strata) and lumps.
  const H = R * range(r, 1.3, 1.9);
  const levels = 18;
  const start = 1 + (rings - 1) * segs;
  const lump: number[] = [];
  for (let i = 0; i < segs; i++) lump.push(r());
  let prev = start;
  let ox = 0;
  let oz = 0;
  for (let k = 1; k <= levels; k++) {
    const t = k / levels;
    ox += (r() - 0.5) * R * 0.06 * t;
    oz += (r() - 0.5) * R * 0.06 * t;
    const shrink = Math.pow(1 - t, 0.75) * (1 - 0.18 * t);
    const ledge = 1 + 0.07 * Math.sin(t * 34 + seed) * (1 - t);
    const base = pos.length / 3;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const lumpy = 1 + (lump[i] - 0.5) * 0.25 * Math.sin(t * Math.PI) + (r() - 0.5) * 0.12;
      const e = edge(a) * shrink * ledge * lumpy * (k === 1 ? 0.99 : 1);
      const x = ox + Math.cos(a) * e;
      const z = oz + Math.sin(a) * e;
      const y = -t * H * (1 + (r() - 0.5) * 0.04) - (k === 1 ? 1.2 : 0);
      pos.push(x, y, z);
      col.push(rock.r, rock.g, rock.b);
      mat.push(M.rock, 0.5);
    }
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      idx.push(prev + i, prev + j, base + i, prev + j, base + j, base + i);
    }
    prev = base;
  }
  // Close the tip.
  const tip = pos.length / 3;
  pos.push(ox, -H * 1.05, oz);
  col.push(rock.r, rock.g, rock.b);
  mat.push(M.rock, 0.5);
  for (let i = 0; i < segs; i++) idx.push(prev + i, prev + ((i + 1) % segs), tip);
  return geo(pos, col, mat, idx);
}

// ---- grass along the meadow: the same blades as the field, planted once ----

const BLADE_VERT = /* glsl */ `
${COMMON_GLSL}
uniform float uGrassHeight;
attribute vec3 aRoot;
attribute vec4 aRand;
varying float vT;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vVar;
void main() {
  float t = position.y;
  float side = position.x;
  vec3 root = (modelMatrix * vec4(aRoot, 1.0)).xyz;
  float h = uGrassHeight * mix(0.8, 1.5, aRand.x) * 1.1;
  float theta = aRand.z * 6.2831;
  vec2 facing = vec2(cos(theta), sin(theta));
  float gust = gustAt(root.xz);
  float flutter = sin(uTime * (2.8 + aRand.y * 2.0) + aRand.x * 6.28 - dot(root.xz, uWindDir) * 0.5);
  vec2 bend = vec2(-facing.y, facing.x) * (0.15 + 0.3 * aRand.w) + uWindDir * min(uWindStrength, 1.1) * (0.25 + 0.9 * gust * uGustStrength + 0.12 * flutter);
  float A = clamp(length(bend), 0.0, 1.4);
  vec2 bd = normalize(bend + 1e-4);
  float a = A * t;
  float along = A < 1e-3 ? 0.0 : h * (1.0 - cos(a)) / A;
  float up = A < 1e-3 ? h * t : h * sin(a) / A;
  float w = 0.07 * mix(0.7, 1.3, aRand.y) * (1.0 - t) * (1.0 + 0.35 * t);
  vec3 wAxis = vec3(facing.x, 0.0, facing.y);
  vec3 p = root + vec3(bd.x * along, up, bd.y * along) + wAxis * side * w;
  vec3 tangent = vec3(bd.x * sin(a), cos(a), bd.y * sin(a));
  vNormal = normalize(cross(wAxis, tangent));
  vT = t;
  vVar = aRand.y;
  vWorldPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BLADE_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassBase;
uniform vec3 uGrassMid;
uniform vec3 uGrassTip;
uniform vec3 uTint;
varying float vT;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vVar;
void main() {
  vec3 col = mix(uGrassBase, uGrassMid, smoothstep(0.0, 0.45, vT));
  col = mix(col, uGrassTip, smoothstep(0.38, 1.0, vT)) * mix(0.82, 1.12, vVar) * uTint;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float diff = smoothstep(-0.25, 0.55, dot(N, uSunDir));
  col *= uAmbient + uSunColor * (0.35 + 0.65 * diff) * max(uSunDir.y + 0.15, 0.0) * 1.15;
  col += uSunColor * uGrassTip * uTint * pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 3.0) * smoothstep(0.2, 1.0, vT) * 0.55;
  col *= mix(0.32, 1.0, smoothstep(0.0, 0.55, vT));
  col = applyFogK(col, vWorldPos, 0.45);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function grassGeometry(R: number, seed: number, r: Rng): BufferGeometry {
  const { edge, top } = shape(R, seed);
  const segs = 3;
  const roots: number[] = [];
  const rnd: number[] = [];
  const area = Math.PI * R * R;
  const n = Math.round(area * 2.2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    // Denser toward the rim, where it shows against the sky.
    const d = Math.pow(r(), 0.35) * 0.97;
    const e = edge(a) * d;
    const x = Math.cos(a) * e;
    const z = Math.sin(a) * e;
    roots.push(x, top(x, z) - 0.05, z);
    rnd.push(r(), r(), r(), r());
  }
  const pos: number[] = [];
  const root: number[] = [];
  const rr: number[] = [];
  const idx: number[] = [];
  const per = segs * 2 + 1;
  for (let b = 0; b < n; b++) {
    const base = b * per;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      pos.push(-1, t, 0, 1, t, 0);
    }
    pos.push(0, 1, 0);
    for (let k = 0; k < per; k++) {
      root.push(roots[b * 3], roots[b * 3 + 1], roots[b * 3 + 2]);
      rr.push(rnd[b * 4], rnd[b * 4 + 1], rnd[b * 4 + 2], rnd[b * 4 + 3]);
    }
    for (let i = 0; i < segs - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const l = base + (segs - 1) * 2;
    idx.push(l, l + 1, l + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aRoot', new BufferAttribute(new Float32Array(root), 3));
  g.setAttribute('aRand', new BufferAttribute(new Float32Array(rr), 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 2;
  return g;
}

let bladeMat: ShaderMaterial | null = null;

/** Build one island at the origin of its group. Returns the group and where trees should stand (world space). */
export function buildIsland(spec: IslandSpec): { group: Group; trees: { x: number; y: number; z: number; s: number; sp: SpeciesName }[]; rim: (a: number) => number } {
  const r = mulberry32(spec.seed * 7919);
  const R = spec.R;
  const g = new Group();
  const { edge, top } = shape(R, spec.seed);
  const mat = structureMaterial({ haze: 0.02, groundAO: false, sway: 0.5, fog: 0.45 });
  g.add(new Mesh(body(R, spec.seed, r), mat));

  if (!bladeMat) {
    bladeMat = new ShaderMaterial({ uniforms: { ...U }, vertexShader: BLADE_VERT, fragmentShader: BLADE_FRAG, side: DoubleSide });
  }
  g.add(new Mesh(grassGeometry(R, spec.seed, r), bladeMat));

  const b = new Builder();
  // Stalactites under the body and roots hanging from the lip.
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const d = edge(a) * range(r, 0.15, 0.5);
    const y = -R * range(r, 0.6, 1.1);
    const h = R * range(r, 0.2, 0.45);
    b.frustum(Math.cos(a) * d, y - h, Math.sin(a) * d, 0.05, R * range(r, 0.05, 0.1), h + 2, '#7e786f', M.rock, 7, r());
  }
  const roots = new Builder();
  const nRoots = Math.round(R * 0.9);
  for (let i = 0; i < nRoots; i++) {
    const a = r() * Math.PI * 2;
    const e = edge(a) * range(r, 0.88, 0.99);
    let x = Math.cos(a) * e;
    let z = Math.sin(a) * e;
    let y = -1.5 - r() * 2;
    const len = range(r, 4, 14) * Math.min(1.4, R / 40);
    const segs = 6;
    let rad = range(r, 0.08, 0.22);
    const leafy = r() < 0.45;
    for (let k = 0; k < segs; k++) {
      const sl = len / segs;
      const nx = x + (r() - 0.5) * 0.6 + Math.cos(a) * 0.15;
      const nz = z + (r() - 0.5) * 0.6 + Math.sin(a) * 0.15;
      const ny = y - sl;
      const dx = nx - x;
      const dz = nz - z;
      const tilt = new Vector3(dx, -sl, dz).normalize();
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), tilt);
      roots.cyl(x, y, z, rad, sl * 1.05, leafy ? '#4a3c2a' : '#5a4632', M.wood, 8, 0.5, q);
      if (leafy && k === 0) roots.blob(x, y + 0.2, z, 0.9, 0.5, 0.9, r() * 6, '#4f7a3a', M.foliage, r());
      x = nx;
      y = ny;
      z = nz;
      rad *= 0.82;
    }
  }
  // Mossy boulders on the meadow and loose rocks drifting around.
  for (let i = 0; i < Math.round(R / 8); i++) {
    const a = r() * Math.PI * 2;
    const d = edge(a) * range(r, 0.2, 0.85);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const s = range(r, 0.6, 2.2);
    b.blob(x, top(x, z) + s * 0.2, z, s, s * 0.6, s * 0.85, r() * 6, '#9a948a', M.rock, r(), true);
  }
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const d = R * range(r, 1.2, 1.9);
    const s = range(r, 1.5, 6) * (R / 50);
    const y = range(r, -R * 0.6, R * 0.2);
    // A small chunk of the same land: rocky cone below, a cap of turf on top.
    b.frustum(Math.cos(a) * d, y - s * 1.6, Math.sin(a) * d, s * 0.1, s, s * 1.6, '#aaa294', M.rock, 9, r(), r() * 6);
    b.frustum(Math.cos(a) * d, y - 0.05, Math.sin(a) * d, s * 1.0, s * 0.85, s * 0.3, '#6a8a40', M.turf, 9, r(), r() * 6);
  }
  // A ruin on the bigger islands.
  if (R > 30) {
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * R * 0.3;
    const z = Math.sin(a) * R * 0.3;
    const y = top(x, z);
    if (r() < 0.5) {
      for (const s of [-1, 1]) b.box(x + s * 3 * Math.cos(a + 1.57), y - 0.5, z + s * 3 * Math.sin(a + 1.57), 1.4, 8, 1.4, -a, '#e2dccd', M.stone, r());
      b.box(x, y + 7.5, z, 8, 1.4, 1.8, -a + Math.PI / 2, '#e2dccd', M.stone, r());
      b.box(x, y + 6.0, z, 0.9, 0.9, 0.9, -a, '#8fe8ff', M.rune, r());
    } else {
      for (let i = 0; i < 7; i++) {
        const aa = (i / 7) * Math.PI * 2;
        b.box(x + Math.cos(aa) * 6, y - 0.5, z + Math.sin(aa) * 6, 1.2, range(r, 3, 6), 0.8, -aa, '#d4ccbb', M.stone, r());
      }
      b.crystal(x, y - 0.2, z, 0.8, 3.2, 0, '#8fe8ff', r());
    }
  }
  const m2 = structureMaterial({ haze: 0.02, groundAO: false, sway: 0.5, fog: 0.45 });
  const extra = new Mesh(b.build(), m2);
  g.add(extra);
  g.add(new Mesh(roots.build(), m2));

  // Trees: a little wood on the meadow.
  const trees: { x: number; y: number; z: number; s: number; sp: SpeciesName }[] = [];
  const n = Math.round(R / 3.2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = edge(a) * Math.sqrt(r()) * 0.8;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (trees.some((t) => Math.hypot(t.x - spec.x - x, t.z - spec.z - z) < 5)) continue;
    const sp: SpeciesName = r() < 0.45 ? 'spruce' : r() < 0.6 ? 'oak' : r() < 0.5 ? 'birch' : 'bush';
    trees.push({ x: spec.x + x, y: spec.y + top(x, z) - 0.2, z: spec.z + z, s: range(r, 0.7, 1.15), sp });
  }
  g.position.set(spec.x, spec.y, spec.z);
  return { group: g, trees, rim: edge };
}
