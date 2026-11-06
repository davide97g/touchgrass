import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearMipmapLinearFilter,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL, smoothstep, terrainBase, terrainHeight } from './common';
import type { FeatureMap } from './Features';

/**
 * The great tree on the hill: one lone, leaning broadleaf with a cloud of
 * foliage, standing where the land rises within sight of the spawn. Someone
 * carved a few words into its bark.
 */

export interface TreeSite {
  x: number;
  z: number;
  /** Unit vector (xz) from the trunk toward the spawn: the carving faces this way. */
  fx: number;
  fz: number;
}

const ROOT_RADIUS = 1.9;
const TRUNK_HEIGHT = 8.4;
const TRUNK_BURY = 0.7;
const CARVE_HEIGHT = 1.4;
const CARVE_W = 0.8;
const CARVE_H = 0.5;

/** Pick a hilltop 55-130 m from the spawn, preferably in view, dry and not too steep. */
export function findTreeSite(sx: number, sz: number, yaw: number, features: FeatureMap): TreeSite {
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  const eyeY = terrainBase(sx, sz) + 1.6;
  let best = { x: sx + fwdX * 80, z: sz + fwdZ * 80, score: -Infinity };
  for (let d = 55; d <= 130; d += 5) {
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const x = sx + Math.cos(a) * d;
      const z = sz + Math.sin(a) * d;

      const wet = features.active.pools.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 18) ||
        features.active.streams.some((s) => s.pts.some((q, i) => i % 4 === 0 && Math.hypot(q.x - x, q.z - z) < 14));
      if (wet) continue;

      const h = terrainBase(x, z);
      let ring = 0;
      for (let i = 0; i < 8; i++) {
        const b = (i / 8) * Math.PI * 2;
        ring += terrainBase(x + Math.cos(b) * 30, z + Math.sin(b) * 30);
      }
      const prominence = h - ring / 8;
      const e = 3;
      const slope = Math.hypot(terrainBase(x + e, z) - terrainBase(x - e, z), terrainBase(x, z + e) - terrainBase(x, z - e)) / (2 * e);

      // In front of the first view, and with the crown not hidden behind a rise.
      const c = ((x - sx) * fwdX + (z - sz) * fwdZ) / d;
      const view = smoothstep(Math.cos(1.2), Math.cos(0.35), c);
      let blocked = 0;
      const topY = h + 8;
      for (let i = 1; i < 24; i++) {
        const t = i / 24;
        const ly = eyeY + (topY - eyeY) * t;
        if (terrainBase(sx + (x - sx) * t, sz + (z - sz) * t) > ly - 0.5) blocked++;
      }

      const score = prominence + view * 12 - slope * 18 - blocked * 0.8 - Math.abs(d - 85) * 0.02;
      if (score > best.score) best = { x, z, score };
    }
  }
  const l = Math.hypot(sx - best.x, sz - best.z) || 1;
  return { x: best.x, z: best.z, fx: (sx - best.x) / l, fz: (sz - best.z) / l };
}

// ---------------------------------------------------------------- shaders

const BARK_VERT = /* glsl */ `
attribute vec2 aBark;
varying vec2 vBark;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vBark = aBark;
  vNormal = normal;
  vWorldPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const BARK_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassMid;
uniform vec3 uTint;
uniform sampler2D uCarve;
uniform vec3 uCarveCenter;
uniform vec3 uCarveDir;
uniform vec2 uCarveSize;
varying vec2 vBark;
varying vec3 vNormal;
varying vec3 vWorldPos;

float carveAt(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture(uCarve, uv).a;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;

  // Bark: long vertical plates split by dark furrows.
  float plate = nz(vec2(vBark.x * 1.5, vBark.y * 0.16)).a;
  float furrow = nz(vec2(vBark.x * 3.6, vBark.y * 0.35) + 0.37).a;
  float fine = nz(vBark * vec2(3.1, 1.2) + 0.71).a;
  vec3 col = pow(vec3(0.42, 0.37, 0.33), vec3(2.2));
  col *= mix(0.75, 1.1, plate) * mix(0.88, 1.06, fine);
  col *= mix(0.38, 1.0, smoothstep(0.16, 0.34, furrow));
  float bump = (plate - 0.5) * 0.5 + (smoothstep(0.16, 0.34, furrow) - 0.5) * 0.6;

  // The carving: projected straight onto the side that faces the spawn.
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uCarveDir));
  vec3 d = vWorldPos - uCarveCenter;
  vec2 cuv = vec2(dot(d, right) / uCarveSize.x + 0.5, d.y / uCarveSize.y + 0.5);
  float facing = smoothstep(0.35, 0.6, dot(N, uCarveDir)) * step(abs(dot(d, uCarveDir)), 0.35);
  float m = carveAt(cuv) * facing;
  float carved = 0.0;
  if (m > 0.0 || facing > 0.0) {
    vec2 o = vec2(0.0, 0.006);
    float up = carveAt(cuv + o) * facing;
    float dn = carveAt(cuv - o) * facing;
    float smoothBark = facing * (1.0 - smoothstep(0.45, 0.62, max(abs(cuv.x - 0.5), abs(cuv.y - 0.5))));
    col = mix(col, col * 1.08, smoothBark * 0.5); // the patch someone smoothed with a knife
    carved = smoothstep(0.3, 0.7, m);
    // An old cut: the groove has weathered dark, its lower wall still pale.
    vec3 groove = pow(vec3(0.2, 0.15, 0.11), vec3(2.2)) * mix(0.8, 1.1, fine);
    col = mix(col, groove, carved);
    col *= 1.0 - 0.6 * m * (1.0 - up);                               // upper wall, in shadow
    col = mix(col, pow(vec3(0.66, 0.56, 0.44), vec3(2.2)), 0.75 * m * (1.0 - dn)); // lower wall catches the light
    col *= 1.0 + 0.4 * up * (1.0 - m);                                // worn lip above each stroke
  }

  // Moss up the shaded, upward-facing side and around the roots.
  float h = vWorldPos.y;
  float mossN = nz(vWorldPos.xz * 0.9 + h * 0.35).a;
  float moss = 0.75 * smoothstep(0.62, 0.9, mossN + N.y * 0.3 + (1.0 - smoothstep(0.0, 1.5, h - uTree.z)) * 0.25 - dot(N, uSunDir) * 0.15);
  moss *= 1.0 - carved;
  col = mix(col, mix(vec3(0.05, 0.09, 0.03), uGrassMid * 0.35, 0.4) * uTint, moss * 0.75);

  float ndl = dot(N, L) + bump * 0.35;
  float diff = smoothstep(-0.15, 0.45, ndl);
  vec3 lit = uAmbient * (0.65 + 0.35 * N.y) + uSunColor * diff * max(L.y + 0.15, 0.0) * 1.1 * treeShadeAt(vWorldPos);
  col *= lit;
  col += uAmbient * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.06;
  col *= cloudShadowAt(vWorldPos.xz);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LEAF_VERT = /* glsl */ `
${COMMON_GLSL}
attribute vec3 aCenter;
attribute vec3 aDir;
attribute vec4 aData; // size, rotation, ao, seed
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorldPos;
varying float vAo;
varying float vSeed;
void main() {
  float seed = aData.w;
  vec3 c = aCenter;
  // The crown breathes with the wind; outer leaves move most.
  float gust = gustAt(c.xz);
  float sway = sin(uTime * 1.1 + seed * 6.2831 + dot(c.xz, uWindDir) * 0.25);
  float reach = aData.z;
  vec2 push = uWindDir * uWindStrength * (0.05 * sway + 0.22 * gust * uGustStrength) * (0.4 + reach);
  c.xz += push;
  c.y += 0.04 * sin(uTime * 1.7 + seed * 12.0) * uWindStrength;

  float rot = aData.y + sin(uTime * 2.3 + seed * 30.0) * 0.07 * (0.3 + uWindStrength);
  vec2 q = vec2(cos(rot) * position.x - sin(rot) * position.y, sin(rot) * position.x + cos(rot) * position.y);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * q.x + up * q.y) * aData.x;

  vUv = position.xy + 0.5;
  vN = aDir;
  vWorldPos = p;
  vAo = aData.z;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const LEAF_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uLeaves;
uniform vec3 uTint;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorldPos;
varying float vAo;
varying float vSeed;
void main() {
  vec4 tx = texture(uLeaves, vUv);
  // Crisp alpha-test edges at any distance.
  float a = (tx.a - 0.5) / max(fwidth(tx.a), 1e-4) + 0.5;
  if (a < 0.5) discard;

  vec3 N = normalize(vN + (vec3(tx.g, 0.5, tx.b) - 0.5) * 0.45);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  float ndl = dot(N, L);
  float lit = smoothstep(-0.05, 0.4, ndl) * smoothstep(0.05, 0.45, vAo);

  float v = mix(0.8, 1.0, tx.r) * (0.9 + 0.2 * fract(vSeed * 7.13));
  vec3 deep = vec3(0.05, 0.13, 0.14);
  vec3 body = vec3(0.07, 0.19, 0.13);
  vec3 sunny = vec3(0.3, 0.46, 0.26);
  vec3 alb = mix(deep, body, smoothstep(0.0, 0.7, vAo)) * v * mix(0.75, 1.15, fract(vSeed * 3.7));

  float sun = max(L.y + 0.15, 0.0);
  vec3 col = alb * (uAmbient * (0.65 + 0.45 * max(N.y, 0.0)) * mix(0.7, 1.1, vAo) + uSunColor * lit * sun * 1.15);
  // Pale, almost white glints on the leaves that face the sun (the painted highlights).
  float glint = smoothstep(0.5, 0.85, ndl) * smoothstep(0.88, 0.98, v) * lit;
  col += sunny * uSunColor * glint * sun * 0.9;
  // Light through the leaves when looking toward the sun.
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0) * vAo;
  col += uSunColor * vec3(0.1, 0.17, 0.04) * back * 0.6 * sun;
  col *= uTint;
  col *= cloudShadowAt(vWorldPos.xz);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- geometry

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class TubeBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly bark: number[] = [];
  readonly idx: number[] = [];

  /**
   * A tube along `center(t)`, t in 0..1, radius `radius(t, angle)`. Rings use
   * parallel-transport frames so they never twist; normals come from the grid.
   */
  add(center: (t: number) => Vector3, radius: (t: number, th: number) => number, segs: number, radial: number): void {
    const cs: Vector3[] = [];
    for (let i = 0; i <= segs; i++) cs.push(center(i / segs));
    const T: Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = cs[Math.max(0, i - 1)];
      const b = cs[Math.min(segs, i + 1)];
      T.push(b.clone().sub(a).normalize());
    }
    let N = new Vector3(1, 0, 0);
    if (Math.abs(T[0].x) > 0.9) N.set(0, 0, 1);
    N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize();

    const grid: Vector3[][] = [];
    let len = 0;
    const lens: number[] = [];
    for (let i = 0; i <= segs; i++) {
      if (i > 0) {
        N = N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))).normalize();
        len += cs[i].distanceTo(cs[i - 1]);
      }
      lens.push(len);
      const B = new Vector3().crossVectors(T[i], N);
      const ring: Vector3[] = [];
      for (let j = 0; j < radial; j++) {
        const th = (j / radial) * Math.PI * 2;
        const r = radius(i / segs, th);
        ring.push(cs[i].clone().addScaledVector(N, Math.cos(th) * r).addScaledVector(B, Math.sin(th) * r));
      }
      grid.push(ring);
    }

    const base = this.pos.length / 3;
    const circ = Math.PI * 2 * radius(0.3, 0);
    const n = new Vector3();
    const da = new Vector3();
    const dt = new Vector3();
    for (let i = 0; i <= segs; i++) {
      for (let j = 0; j <= radial; j++) {
        const jj = j % radial;
        const p = grid[i][jj];
        da.subVectors(grid[i][(jj + 1) % radial], grid[i][(jj + radial - 1) % radial]);
        dt.subVectors(grid[Math.min(segs, i + 1)][jj], grid[Math.max(0, i - 1)][jj]);
        n.crossVectors(da, dt).normalize();
        if (n.dot(p.clone().sub(cs[i])) < 0) n.negate();
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        this.bark.push((j / radial) * circ, lens[i]);
      }
    }
    const row = radial + 1;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * row + j;
        const b = a + row;
        const c = a + 1;
        const d = b + 1;
        this.idx.push(a, c, b, c, d, b);
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('aBark', new BufferAttribute(new Float32Array(this.bark), 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function bezier(a: Vector3, b: Vector3, c: Vector3): (t: number) => Vector3 {
  return (t) => {
    const u = 1 - t;
    return new Vector3()
      .addScaledVector(a, u * u)
      .addScaledVector(b, 2 * u * t)
      .addScaledVector(c, t * t);
  };
}

/** A soft cluster of small pointed leaves; r = shade, g/b = leaf tilt, a = coverage. */
function leafTexture(): CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const r = rng(77);
  ctx.translate(S / 2, S / 2);
  for (let i = 0; i < 70; i++) {
    const rr = Math.sqrt(r()) * S * 0.4;
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    const len = S * (0.1 + r() * 0.07);
    const wid = len * (0.38 + r() * 0.15);
    const rot = a + (r() - 0.5) * 1.6;
    const shade = Math.round(90 + r() * 165);
    const tx = Math.round(128 + Math.cos(rot) * 90);
    const ty = Math.round(128 + Math.sin(rot) * 90);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(0, -wid, len / 2, 0);
    ctx.quadraticCurveTo(0, wid, -len / 2, 0);
    ctx.fillStyle = `rgb(${shade},${tx},${ty})`;
    ctx.fill();
    ctx.restore();
  }
  const tex = new CanvasTexture(cv);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.premultiplyAlpha = false;
  return tex;
}

/** The dedication, cut by hand: slightly uneven letters, white on transparent. */
function drawCarving(cv: HTMLCanvasElement): void {
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r = rng(1854);
  const line = (text: string, font: string, y: number, spacing: number, stroke: number) => {
    ctx.font = font;
    const chars = [...text];
    const widths = chars.map((ch) => ctx.measureText(ch).width + spacing);
    let x = cv.width / 2 - (widths.reduce((s, w) => s + w, 0) - spacing) / 2;
    chars.forEach((ch, i) => {
      ctx.save();
      ctx.translate(x + widths[i] / 2 - spacing / 2, y + (r() - 0.5) * 6);
      ctx.rotate((r() - 0.5) * 0.08);
      ctx.lineWidth = stroke;
      ctx.lineJoin = 'round';
      ctx.fillText(ch, 0, 0);
      ctx.strokeText(ch, 0, 0);
      ctx.restore();
      x += widths[i];
    });
  };
  line('EREN JAEGER', '500 120px "Cormorant Garamond", Georgia, serif', 128, 12, 7);
  line('835 – 854', '500 86px "Cormorant Garamond", Georgia, serif', 268, 10, 6);
  line('いってらっしゃい、エレン', '500 70px "Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif', 392, 2, 5);
  // A short line under the name, as if underscored with the knife.
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cv.width * 0.3, 196);
  ctx.quadraticCurveTo(cv.width * 0.5, 204, cv.width * 0.7, 194);
  ctx.stroke();
}

function carvingTexture(): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  drawCarving(cv);
  const tex = new CanvasTexture(cv);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  // Redraw once the web fonts are in, so the knife follows the right letters.
  if (document.fonts) {
    Promise.all([
      document.fonts.load('500 118px "Cormorant Garamond"', 'EREN JAEGER 835 – 854'),
      document.fonts.load('500 70px "Shippori Mincho"', 'いってらっしゃい、エレン'),
    ])
      .then(() => {
        drawCarving(cv);
        tex.needsUpdate = true;
      })
      .catch(() => {});
  }
  return tex;
}

// ---------------------------------------------------------------- tree

export class Tree {
  readonly group = new Group();
  readonly site: TreeSite;
  private readonly baseX: number;
  private readonly baseZ: number;

  constructor(site: TreeSite) {
    this.site = site;
    const r = rng(Math.floor(site.x * 13 + site.z * 7) ^ 0x5eed);
    const gy = terrainHeight(site.x, site.z);
    const F = new Vector3(site.fx, 0, site.fz);
    const up = new Vector3(0, 1, 0);

    // Lean sideways to the viewer, toward the downhill side, like a tree that grew on a slope.
    const side = new Vector3().crossVectors(up, F).normalize();
    const e = 2;
    const downhill = terrainBase(site.x + side.x * e, site.z + side.z * e) - terrainBase(site.x - side.x * e, site.z - side.z * e);
    const lean = side.clone().multiplyScalar(downhill > 0 ? -1 : 1);
    const wob = new Vector3().crossVectors(up, lean);
    const ground = new Vector3(site.x, gy, site.z);

    const trunkC = (t: number) => {
      const y = -TRUNK_BURY + t * TRUNK_HEIGHT;
      return ground
        .clone()
        .addScaledVector(up, y)
        .addScaledVector(lean, 4.2 * (t - 0.55 * t * t))
        .addScaledVector(wob, 0.22 * Math.sin(t * 4.5));
    };
    const trunkR = (t: number, th: number) => {
      const hgt = Math.max(0, -TRUNK_BURY + t * TRUNK_HEIGHT);
      let rad = 0.8 * (1 - 0.7 * t);
      rad *= 1 + 0.75 * Math.exp(-hgt * 1.4);
      rad *= 1 + 0.5 * Math.max(0, Math.sin(5 * th + 0.7)) ** 3 * Math.exp(-hgt * 1.1)
        + 0.22 * Math.max(0, Math.sin(3 * th + 2.1)) ** 2 * Math.exp(-hgt * 0.7);
      rad *= 1 + 0.035 * Math.sin(th * 9 + t * 30) + 0.03 * Math.sin(th * 4 - t * 13);
      return rad * (1 - 0.9 * smoothstep(0.86, 1, t)); // tapers off inside the crown
    };

    const wood = new TubeBuilder();
    wood.add(trunkC, trunkR, 80, 40);

    // Main limbs fan out of the upper trunk; each splits once or twice.
    const tips: { p: Vector3; r: number }[] = [];
    const nLimbs = 6;
    const az0 = Math.atan2(lean.z, lean.x);
    const trunkDir = (t: number) => trunkC(Math.min(1, t + 0.01)).sub(trunkC(Math.max(0, t - 0.01))).normalize();
    for (let k = 0; k < nLimbs; k++) {
      const ts = 0.5 + r() * 0.3;
      const p0 = trunkC(ts);
      const az = az0 + (k / nLimbs) * Math.PI * 2 + (r() - 0.5) * 0.7;
      const el = 0.22 + r() * 0.4;
      const L = 5.2 + r() * 2.4 + (Math.cos(az - az0) > 0.3 ? 1.2 : 0);
      const h = new Vector3(Math.cos(az), 0, Math.sin(az));
      const dir = h.clone().multiplyScalar(Math.cos(el)).addScaledVector(up, Math.sin(el));
      const p1 = p0.clone().addScaledVector(dir, L * 0.5);
      const p2 = p0.clone().addScaledVector(h, L * 0.82).addScaledVector(up, L * (0.22 + Math.sin(el) * 0.3));
      const curve = bezier(p0, p1, p2);
      const r0 = trunkR(ts, 0) * 0.62;
      const limbR = (t: number) => r0 * (1 - 0.85 * t ** 0.8) + 0.02;
      wood.add(curve, (t, th) => limbR(t) * (1 + 0.05 * Math.sin(th * 5 + t * 17)), 22, 12);
      tips.push({ p: p2, r: 2.6 + r() * 0.7 });

      for (let s = 0; s < 2; s++) {
        const u = 0.45 + r() * 0.3;
        const q0 = curve(u);
        const tan = curve(u + 0.02).sub(curve(u - 0.02)).normalize();
        const turn = (s === 0 ? 1 : -1) * (0.5 + r() * 0.5);
        const tdir = tan.clone().applyAxisAngle(up, turn).addScaledVector(up, 0.4 + r() * 0.4).normalize();
        const sl = 2.0 + r() * 1.4;
        const q2 = q0.clone().addScaledVector(tdir, sl);
        const q1 = q0.clone().addScaledVector(tan, sl * 0.4).addScaledVector(tdir, sl * 0.2);
        const sr0 = limbR(u) * 0.6;
        wood.add(bezier(q0, q1, q2), (t) => sr0 * (1 - 0.8 * t) + 0.015, 12, 8);
        tips.push({ p: q2, r: 2.1 + r() * 0.6 });
      }
    }
    const top = trunkC(1);
    tips.push({ p: top.clone().addScaledVector(up, 1.2).addScaledVector(trunkDir(1), 0.6), r: 2.6 });

    // Crown: the volume the tips span, filled out on the top and sides.
    const cc = new Vector3();
    for (const t of tips) cc.add(t.p);
    cc.divideScalar(tips.length);
    cc.y += 0.6;
    let rxz = 0;
    for (const t of tips) rxz = Math.max(rxz, Math.hypot(t.p.x - cc.x, t.p.z - cc.z));
    rxz += 2.0;
    const ry = 3.6;
    const clumps = tips.map((t) => ({ p: t.p.clone(), r: t.r }));
    // Puffs over the dome, at uneven depths so the outline stays lumpy.
    for (let i = 0; i < 24; i++) {
      const a = r() * Math.PI * 2;
      const v = -0.35 + r() * 1.25;
      const ch = Math.sqrt(Math.max(0, 1 - Math.min(1, v) ** 2));
      const k = 0.55 + r() * 0.35;
      clumps.push({
        p: new Vector3(cc.x + Math.cos(a) * ch * rxz * k, cc.y + Math.min(1, v) * ry * k, cc.z + Math.sin(a) * ch * rxz * k),
        r: 2.0 + r() * 1.3,
      });
    }

    const centers: number[] = [];
    const dirs: number[] = [];
    const data: number[] = [];
    const tmp = new Vector3();
    for (const c of clumps) {
      const n = Math.round(34 * (c.r / 2.2) ** 2);
      for (let i = 0; i < n; i++) {
        // Points biased toward the clump surface.
        tmp.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
        if (tmp.lengthSq() > 1 || tmp.lengthSq() < 1e-4) {
          i--;
          continue;
        }
        tmp.normalize().multiplyScalar(c.r * (0.45 + 0.55 * Math.sqrt(r())));
        tmp.y *= 0.8;
        const p = c.p.clone().add(tmp);
        const out = tmp.length() / c.r;
        const fromCrown = p.clone().sub(cc);
        fromCrown.y *= rxz / ry;
        const dir = fromCrown.normalize().multiplyScalar(0.6).add(tmp.clone().normalize().multiplyScalar(0.4)).normalize();
        const vert = (p.y - cc.y) / ry;
        const ao = Math.min(1, Math.max(0, 0.15 + 0.5 * out + 0.45 * smoothstep(-1.1, 0.7, vert)));
        centers.push(p.x, p.y, p.z);
        dirs.push(dir.x, dir.y, dir.z);
        data.push(1.9 + r() * 1.1, r() * Math.PI * 2, ao, r());
      }
    }

    const leafGeo = new InstancedBufferGeometry();
    leafGeo.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    leafGeo.setIndex([0, 1, 2, 0, 2, 3]);
    leafGeo.setAttribute('aCenter', new InstancedBufferAttribute(new Float32Array(centers), 3));
    leafGeo.setAttribute('aDir', new InstancedBufferAttribute(new Float32Array(dirs), 3));
    leafGeo.setAttribute('aData', new InstancedBufferAttribute(new Float32Array(data), 4));
    leafGeo.instanceCount = centers.length / 3;
    const leaves = new Mesh(
      leafGeo,
      new ShaderMaterial({
        uniforms: { ...U, uLeaves: { value: leafTexture() } },
        vertexShader: LEAF_VERT,
        fragmentShader: LEAF_FRAG,
      }),
    );
    leaves.frustumCulled = false;

    // Carving: on the trunk at chest height, on the side that faces the spawn.
    const tc = (CARVE_HEIGHT + TRUNK_BURY) / TRUNK_HEIGHT;
    const c0 = trunkC(tc);
    const carveCenter = c0.clone().addScaledVector(F, 0.8 * (1 - 0.7 * tc) * (1 + 0.75 * Math.exp(-CARVE_HEIGHT * 1.4)));
    const bark = new Mesh(
      wood.build(),
      new ShaderMaterial({
        uniforms: {
          ...U,
          uCarve: { value: carvingTexture() },
          uCarveCenter: { value: carveCenter },
          uCarveDir: { value: F },
          uCarveSize: { value: new Vector2(CARVE_W, CARVE_H) },
        },
        vertexShader: BARK_VERT,
        fragmentShader: BARK_FRAG,
      }),
    );

    this.group.add(bark, leaves);
    const base = trunkC(TRUNK_BURY / TRUNK_HEIGHT);
    this.baseX = base.x;
    this.baseZ = base.z;
    U.uTree.value.set(base.x, base.z, gy, ROOT_RADIUS);
    U.uTreeCanopy.value.set(cc.x, cc.y - 0.6, cc.z, rxz * 0.92);
  }

  /** False inside the trunk and its roots. */
  clear(x: number, z: number): boolean {
    return Math.hypot(x - this.baseX, z - this.baseZ) > ROOT_RADIUS * 1.05;
  }
}
