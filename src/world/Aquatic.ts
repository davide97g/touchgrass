import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Points,
  ShaderMaterial,
} from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL, terrainHeight } from './common';
import type { FeatureMap } from './Features';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- lily pads & lilies

const PAD_VERT = /* glsl */ `
${COMMON_GLSL}
attribute vec2 aCorner;
attribute vec3 aPos;
attribute vec4 aParams; // size, rotation, kind (0 pad, 1 lily), seed
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying vec3 vWorldPos;
void main() {
  float size = aParams.x;
  float rot = aParams.y + sin(uTime * 0.3 + aParams.w * 20.0) * 0.08;
  vec3 c = aPos;
  c.xz += vec2(sin(uTime * 0.21 + aParams.w * 9.0), cos(uTime * 0.17 + aParams.w * 7.0)) * 0.05;
  c.y += sin(uTime * 0.9 + aParams.w * 30.0) * 0.006;
  vec3 p;
  if (aParams.z < 0.5) {
    vec2 r = vec2(cos(rot) * aCorner.x - sin(rot) * aCorner.y, sin(rot) * aCorner.x + cos(rot) * aCorner.y);
    p = c + vec3(r.x, 0.0, r.y) * size;
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(0.0, 1.0, 0.0);
    p = c + vec3(0.0, size * 0.8, 0.0) + (right * aCorner.x + up * aCorner.y * 0.8) * size;
  }
  vUv = aCorner;
  vKind = aParams.z;
  vSeed = aParams.w;
  vWorldPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const PAD_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uTint;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying vec3 vWorldPos;
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  float r = length(vUv);
  float ang = atan(vUv.y, vUv.x);
  vec3 col;
  vec3 lightCol = uAmbient + uSunColor * 0.9 * max(uSunDir.y + 0.15, 0.0);
  if (vKind < 0.5) {
    // Round pad with a wedge notch and fine radial veins.
    float notch = smoothstep(0.22, 0.12, abs(ang - 0.4)) * step(0.08, r);
    if (r > 1.0 || notch > 0.5) discard;
    col = srgb(mix(vec3(0.22, 0.48, 0.2), vec3(0.42, 0.68, 0.26), fract(vSeed * 13.1)));
    col *= 0.85 + 0.15 * smoothstep(0.96, 1.0, abs(cos(ang * 9.0)));
    col *= mix(1.0, 0.7, smoothstep(0.82, 1.0, r));
    col *= uTint;
    vec3 V = normalize(cameraPosition - vWorldPos);
    float sheen = pow(1.0 - abs(V.y), 4.0) * 0.4;
    col = col * lightCol + uSunColor * sheen * 0.3;
  } else {
    // Water lily: pointed petals, warm heart.
    float petals = 0.55 + 0.45 * pow(abs(cos(ang * 4.0)), 0.6);
    float y = vUv.y * 0.5 + 0.5;
    if (r > petals || vUv.y < -0.6) discard;
    vec3 tip = fract(vSeed * 7.3) < 0.5 ? vec3(0.98, 0.72, 0.84) : vec3(0.98, 0.96, 0.92);
    col = srgb(mix(vec3(1.0, 0.86, 0.35), tip, smoothstep(0.12, 0.4, r)));
    col *= mix(0.8, 1.05, y);
    col *= lightCol * 1.1;
  }
  col *= cloudShadowAt(vWorldPos.xz);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- reeds & cattails

const REED_VERT = /* glsl */ `
${COMMON_GLSL}
attribute vec3 aPos;
attribute vec4 aParams; // height, rand, kind (0 reed, 1 cattail), lean
varying float vT;
varying float vKind;
varying float vRand;
varying vec3 vWorldPos;
void main() {
  float t = position.y;
  float side = position.x;
  float h = aParams.x;
  float theta = aParams.y * 6.2831;
  vec2 facing = vec2(cos(theta), sin(theta));
  vec2 bend = vec2(-facing.y, facing.x) * aParams.w * 0.25;
  float gust = gustAt(aPos.xz);
  float sway = swayAt(aPos.xz);
  bend += uWindDir * uWindStrength * (0.06 + 0.22 * sway + 0.45 * gust * uGustStrength);
  bend += uWindDir * uWindStrength * 0.05 * sin(uTime * 1.6 + aParams.y * 9.0);
  float A = clamp(length(bend), 0.0, 1.2);
  vec2 bd = length(bend) > 1e-4 ? normalize(bend) : vec2(1.0, 0.0);
  float a = A * t;
  float along = A < 1e-3 ? 0.0 : h * (1.0 - cos(a)) / A;
  float up = A < 1e-3 ? h * t : h * sin(a) / A;
  float w = 0.032 * (1.0 - t * 0.9);
  if (aParams.z > 0.5 && t > 0.7 && t < 0.88) w = 0.045;
  vec3 p = aPos + vec3(bd.x * along, up, bd.y * along) + vec3(facing.x, 0.0, facing.y) * side * w;
  vT = t;
  vKind = aParams.z;
  vRand = aParams.y;
  vWorldPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const REED_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uTint;
varying float vT;
varying float vKind;
varying float vRand;
varying vec3 vWorldPos;
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec3 col = srgb(mix(vec3(0.14, 0.36, 0.16), vec3(0.58, 0.78, 0.32), vT));
  col *= mix(0.85, 1.1, vRand);
  if (vKind > 0.5 && vT > 0.7 && vT < 0.88) col = srgb(vec3(0.42, 0.26, 0.14));
  col *= uTint;
  col *= uAmbient + uSunColor * 0.85 * max(uSunDir.y + 0.15, 0.0);
  col *= mix(0.45, 1.0, smoothstep(0.0, 0.4, vT));
  col *= cloudShadowAt(vWorldPos.xz);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- pond fireflies

const FLY_VERT = /* glsl */ `
${COMMON_GLSL}
uniform float uPixelRatio;
attribute vec4 aSeed;
varying float vA;
void main() {
  vec3 p = position;
  float s = aSeed.x * 50.0;
  p += vec3(sin(uTime * 0.31 + s), sin(uTime * 0.47 + s * 1.3) * 0.4, cos(uTime * 0.27 + s * 0.7)) * 1.3;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = smoothstep(0.35, 1.0, sin(uTime * (0.7 + aSeed.y * 1.3) + aSeed.z * 40.0));
  vA = blink * (smoothstep(0.08, 0.55, uNight) + 0.12 * aSeed.w);
  gl_PointSize = clamp(0.15 * uPixelRatio * 600.0 / -mv.z, 0.0, 26.0 * uPixelRatio);
}
`;

const FLY_FRAG = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.78, 1.0, 0.4) * 2.4 * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Aquatic {
  readonly group = new Group();
  private pads: Mesh;
  private reeds: Mesh;
  private flies: Points;

  constructor() {
    const padGeo = new InstancedBufferGeometry();
    padGeo.setAttribute('aCorner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
    padGeo.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    padGeo.setIndex([0, 1, 2, 1, 3, 2]);
    this.pads = new Mesh(
      padGeo,
      new ShaderMaterial({ uniforms: { ...U }, vertexShader: PAD_VERT, fragmentShader: PAD_FRAG, side: DoubleSide }),
    );

    const reedGeo = new InstancedBufferGeometry();
    const v: number[] = [];
    const segs = 6;
    for (let i = 0; i < segs; i++) v.push(-1, i / segs, 0, 1, i / segs, 0);
    v.push(0, 1, 0);
    const idx: number[] = [];
    for (let i = 0; i < segs - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    idx.push((segs - 1) * 2, (segs - 1) * 2 + 1, segs * 2);
    reedGeo.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
    reedGeo.setIndex(idx);
    this.reeds = new Mesh(
      reedGeo,
      new ShaderMaterial({ uniforms: { ...U }, vertexShader: REED_VERT, fragmentShader: REED_FRAG, side: DoubleSide }),
    );

    this.flies = new Points(
      new BufferGeometry(),
      new ShaderMaterial({
        uniforms: { ...U },
        vertexShader: FLY_VERT,
        fragmentShader: FLY_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.flies.renderOrder = 11;

    for (const m of [this.pads, this.reeds, this.flies]) m.frustumCulled = false;
    this.group.add(this.pads, this.reeds, this.flies);
  }

  rebuild(map: FeatureMap): void {
    const f = map.active;
    const padPos: number[] = [];
    const padPar: number[] = [];
    const reedPos: number[] = [];
    const reedPar: number[] = [];
    const flyPos: number[] = [];
    const flySeed: number[] = [];

    const clump = (r: () => number, cx: number, cz: number, n: number, spread: number) => {
      const cattails = r() < 0.6;
      for (let i = 0; i < n; i++) {
        const x = cx + (r() - 0.5) * spread;
        const z = cz + (r() - 0.5) * spread;
        if (map.waterDepth(x, z) > 0.3) continue;
        reedPos.push(x, terrainHeight(x, z) - 0.05, z);
        reedPar.push(0.9 + r() * 0.9, r(), cattails && r() < 0.35 ? 1 : 0, r() - 0.5);
      }
    };

    for (const p of f.pools) {
      const r = mulberry32(p.seed);
      // Lily pads drift in a couple of loose rafts.
      const rafts = 2 + Math.floor(r() * 3);
      for (let k = 0; k < rafts; k++) {
        const a = r() * Math.PI * 2;
        const d = p.r * (0.2 + r() * 0.5);
        const cx = p.x + Math.cos(a) * d;
        const cz = p.z + Math.sin(a) * d;
        const n = Math.floor(5 + p.r * 1.4 * (0.5 + r()));
        for (let i = 0; i < n; i++) {
          const x = cx + (r() - 0.5) * 2.4;
          const z = cz + (r() - 0.5) * 2.4;
          if (map.waterDepth(x, z) < 0.12) continue;
          const size = 0.2 + r() * 0.26;
          const seed = r();
          padPos.push(x, p.level + 0.012, z);
          padPar.push(size, r() * 6.28, 0, seed);
          if (r() < 0.35) {
            padPos.push(x, p.level + 0.02, z);
            padPar.push(size * 0.42, 0, 1, seed);
          }
        }
      }
      // Reeds and cattails crowd parts of the shore.
      const clumps = 2 + Math.floor(r() * 4);
      for (let k = 0; k < clumps; k++) {
        const a = r() * Math.PI * 2;
        const d = p.r * (0.92 + r() * 0.15);
        clump(r, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 16 + Math.floor(r() * 20), 1.0 + r() * 1.2);
      }
      // Fireflies hover over the water at dusk.
      for (let i = 0; i < 26 + p.r * 3; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * p.r * 1.4;
        flyPos.push(p.x + Math.cos(a) * d, p.level + 0.25 + r() * 1.6, p.z + Math.sin(a) * d);
        flySeed.push(r(), r(), r(), r());
      }
    }

    for (const s of f.streams) {
      const r = mulberry32(s.seed);
      const n = s.pts.length;
      for (let k = 0; k < 3; k++) {
        const i = Math.floor(r() * n);
        const a = s.pts[i];
        const b = s.pts[Math.min(n - 1, i + 1)];
        const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const side = r() < 0.5 ? -1 : 1;
        const off = s.halfW * (1.2 + r());
        clump(r, a.x - ((b.z - a.z) / tl) * off * side, a.z + ((b.x - a.x) / tl) * off * side, 5 + Math.floor(r() * 8), 1);
      }
      for (let i = 0; i < 10; i++) {
        const p = s.pts[Math.floor(r() * n)];
        flyPos.push(p.x + (r() - 0.5) * 3, s.levels[0] + 0.3 + r() * 1.2, p.z + (r() - 0.5) * 3);
        flySeed.push(r(), r(), r(), r());
      }
    }

    const setInst = (m: Mesh, pos: number[], par: number[]) => {
      const g = m.geometry as InstancedBufferGeometry;
      g.dispose(); // drop the old GPU buffers before swapping attributes
      g.setAttribute('aPos', new InstancedBufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('aParams', new InstancedBufferAttribute(new Float32Array(par), 4));
      g.instanceCount = pos.length / 3;
    };
    setInst(this.pads, padPos, padPar);
    setInst(this.reeds, reedPos, reedPar);

    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(new Float32Array(flyPos), 3));
    fg.setAttribute('aSeed', new BufferAttribute(new Float32Array(flySeed), 4));
    this.flies.geometry.dispose();
    this.flies.geometry = fg;
  }
}
